/* ===== Репозиторий: единственный, кто ходит в Firestore =====
   db больше не «все наши данные», а кэш-проекция того, что нужно экрану:
   мелкие коллекции (заметки, списки, хотелки, лейблы) держим целиком, а
   события и фото — окнами и страницами. */

const PHOTO_PAGE = 60;

function monthKey(year, month) {
  return year + '-' + String(month + 1).padStart(2, '0');
}

// Запас назад на 31 день — максимальная длина события в интерфейсе. Без него
// событие с 28 июля по 3 августа выпало бы из запроса по августу, потому что
// его поле date лежит в июле.
function monthRange(year, month) {
  const from = new Date(year, month, 1);
  from.setDate(from.getDate() - 31);
  const to = new Date(year, month + 1, 0);
  // Внимание: iso() в этом проекте принимает (год, месяц, день), а не Date —
  // см. src/40-calendar.js.
  return [iso(from.getFullYear(), from.getMonth(), from.getDate()), iso(to.getFullYear(), to.getMonth(), to.getDate())];
}

function docsToArray(snap) {
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Офлайн .get() отвечает из локального кэша — частичного или пустого. Такой
// ответ не доказывает, что дальше ничего нет: флаги «загружено/дочитано» и
// курсоры по нему не двигаем, иначе прошлое до конца сессии считалось бы
// прочитанным (K6).
function fromCache(snap) {
  return !!(snap && snap.metadata && snap.metadata.fromCache);
}

// Курсор страницы: неполная страница — последняя, null сразу (без лишнего
// чтения пустой страницы, K1). Из кэша — вывода о конце нет (K6b): курсор на
// последнем документе, а пустой кэш — «читать с начала».
const PHOTOS_FROM_START = { fromStart: true };
function pageCursor(snap) {
  const n = snap.docs.length;
  if (fromCache(snap)) return n ? snap.docs[n - 1] : PHOTOS_FROM_START;
  return n === PHOTO_PAGE ? snap.docs[n - 1] : null;
}

// Firestore не гарантирует порядок документов ни между вызовами .get(), ни
// между срабатываниями onSnapshot — без этого элементы вроде лейблов или
// списков прыгают местами от захода к заходу и при каждом live-обновлении
// (NV-9). order — источник истины там, где он есть (lists), id — вторичный
// устойчивый признак для всех остальных.
function sortDocs(arr) {
  return arr.sort((a, b) => {
    const ao = a.order === undefined ? Infinity : a.order;
    const bo = b.order === undefined ? Infinity : b.order;
    return ao - bo || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

// Горячий набор при входе: всё, что нужно первому экрану и ближайшей навигации.
// Десятки-сотни килобайт; при повторных заходах отдаётся из офлайн-кэша мгновенно.
async function loadHotSet() {
  if (!fsReady) return;
  const now = new Date();
  const [fromIso, toIso] = monthRange(now.getFullYear(), now.getMonth());

  const [labels, notes, lists, wishes, repeats, events, dates, settings, photos] = await Promise.all([
    fsCol('labels').get(),
    fsCol('notes').get(),
    fsCol('lists').get(),
    fsCol('wishes').get(),
    fsCol('events').where('repeat', '==', true).get(),
    fsCol('events').where('date', '>=', fromIso).where('date', '<=', toIso).get(),
    // Свидания грузим целиком, без окна: «Память» (src/35-memory.js,
    // onThisDayItems) перебирает весь db.dates в поисках свиданий ПРОШЛЫХ
    // лет в этот же день. У свиданий, в отличие от годовщин-событий, нет
    // repeat — окно в месяц молча вымыло бы их из раздела. Объём того же
    // порядка, что у заметок, так что грузить целиком не накладно.
    fsCol('dates').get(),
    fsDoc().collection('meta').doc('settings').get(),
    fsCol('photos').orderBy('order', 'asc').limit(PHOTO_PAGE).get()
  ]);

  db.labels = sortDocs(docsToArray(labels));
  db.notes = docsToArray(notes);
  // lists читаем без orderBy (тот же .get(), что и раньше). order — источник
  // истины для позиции карточки (проставлен backfill'ом в migrateDB); sortDocs
  // добавляет id как вторичный устойчивый признак для списков без order.
  // Дозапись order в базу здесь не делаем — лишняя запись на каждом входе ради
  // ситуации, которая пользователям не встретится (order проставлен при миграции).
  db.lists = sortDocs(docsToArray(lists));
  db.wishlist = docsToArray(wishes);
  db.dates = docsToArray(dates);
  db.events = mergeById(docsToArray(repeats), docsToArray(events));
  db.photos = docsToArray(photos);
  const s = settings.exists ? settings.data() : {};
  db.pushSubs = s.pushSubs || {};

  photosCursor = pageCursor(photos);
  loadedMonths = new Set([monthKey(now.getFullYear(), now.getMonth())]);
  // Ось (NV-96): loadHotSet() подменяет db.events/db.photos свежим горячим
  // набором — без сброса этих флагов повторный вызов (importData(), новый
  // вход в той же сессии) оставил бы ось думать, что прошлое уже дочитано,
  // хотя в свежем db его снова нет. axisLoading НЕ трогаем: если в этот
  // момент уже летит другой loadAxisPage(), его finally сам снимет флаг —
  // обнулить его отсюда означало бы разрешить второй параллельный запрос
  // поверх незавершённого первого.
  axisEventsLoaded = false;
  axisPhotosCursor = null;
  axisPhotosDone = false;
  axisPrefetched = false;
}

// Одно и то же событие приходит и запросом повторяющихся, и запросом окна —
// склеиваем по id, чтобы в календаре не двоилось.
function mergeById(a, b) {
  const seen = new Set();
  const out = [];
  for (const item of a.concat(b)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

// Подгрузка месяца при переходе календаря. Уже загруженные не перезапрашиваем.
async function loadMonth(year, month) {
  if (!fsReady) return;
  const key = monthKey(year, month);
  if (loadedMonths.has(key)) return;
  const [fromIso, toIso] = monthRange(year, month);
  const snap = await fsCol('events').where('date', '>=', fromIso).where('date', '<=', toIso).get();
  db.events = mergeById(db.events, docsToArray(snap));
  if (!fromCache(snap)) loadedMonths.add(key);
}

// Следующая страница галереи. Возвращает, сколько фото добавилось (0 — конец).
// photosLoadingMore — защита от гонки: пока идёт запрос, второй параллельный
// вызов (см. photosObserver в src/71-photo-grid.js) выходит сразу же, не
// повторяя чтение того же photosCursor — иначе он держал бы старое значение
// курсора до завершения первого запроса и прочитал бы ту же страницу второй раз.
async function loadMorePhotos() {
  if (!fsReady || !photosCursor || photosLoadingMore) return 0;
  photosLoadingMore = true;
  try {
    let q = fsCol('photos').orderBy('order', 'asc');
    if (photosCursor !== PHOTOS_FROM_START) q = q.startAfter(photosCursor);
    const snap = await q.limit(PHOTO_PAGE).get();
    // Из кэша — 0: ни данных, ни курсора; метка останется на месте и
    // дочитает страницу, когда сеть вернётся (K6).
    if (fromCache(snap)) return 0;
    const rows = docsToArray(snap);
    db.photos = mergeById(db.photos, rows);
    photosCursor = pageCursor(snap);
    return rows.length;
  } finally {
    photosLoadingMore = false;
  }
}

// Ось времени (NV-96): прошлое, которого нет в горячем наборе. События — один
// раз все разовые раньше окна текущего месяца (их единицы-десятки, документы
// маленькие); фото — страницами по дате съёмки, от новых к старым. orderBy
// выкидывает только документы БЕЗ поля takenAt (фото, прикреплённые в
// календаре, src/41-calendar-photos.js), а takenAt:null (загрузка без EXIF,
// src/70-photos.js) приходит хвостом выборки по убыванию — дойдя до него,
// дальше по дате съёмки ничего нет (M5). Фото событий и свиданий без takenAt
// дотягиваются по id (loadAttachedPhotos). Дочитанные фото ложатся в тот же
// db.photos: галерея сортирует по order и покажет их на своём месте раньше,
// чем до них дойдёт её собственная страница, — это не дубль (mergeById), а
// ранний показ.
function axisHasMore() {
  return fsReady && (!axisEventsLoaded || !axisPhotosDone);
}

// Водяной знак оси (K4): до какой даты прошлое уже прочитано. Пока фото не
// дочитаны, ось рисует только дни не старше него (src/36-timeline.js,
// axisDays) — иначе человек пролистал бы старые дни без их фото, а фото потом
// приехали бы выше экрана. До первой страницы — начало окна горячего набора,
// дальше — дата съёмки последнего фото страницы. '' — ограничения нет.
function axisWatermark() {
  if (!fsReady || axisPhotosDone) return '';
  if (axisPhotosCursor) return isoFromMs(axisPhotosCursor.data().takenAt) || '';
  const now = new Date();
  return monthRange(now.getFullYear(), now.getMonth())[0];
}

// Фото событий и свиданий, которых нет в db.photos, — по id документа (K4).
// Строки со «/» — старые data-URL прямо в ev.photos, не id документа.
async function loadAttachedPhotos() {
  const have = new Set(db.photos.map(p => p.id));
  const ids = new Set();
  for (const item of db.events.concat(db.dates)) {
    for (const id of item.photos || []) if (typeof id === 'string' && id && !id.includes('/') && !have.has(id)) ids.add(id);
  }
  const snaps = await Promise.all([...ids].map(id => fsCol('photos').doc(id).get()));
  db.photos = mergeById(
    db.photos,
    snaps.filter(d => d.exists).map(d => ({ id: d.id, ...d.data() }))
  );
}

async function loadAxisPage() {
  if (!axisHasMore() || axisLoading) return 0;
  axisLoading = true;
  try {
    const before = db.events.length + db.photos.length;
    if (!axisEventsLoaded) {
      const now = new Date();
      const [fromIso] = monthRange(now.getFullYear(), now.getMonth());
      const snap = await fsCol('events').where('date', '<', fromIso).get();
      // Бросаем — наблюдатель оси покажет тост «Не удалось догрузить прошлое» (K6).
      if (fromCache(snap)) throw new Error('ось: события из офлайн-кэша');
      db.events = mergeById(db.events, docsToArray(snap));
      await loadAttachedPhotos();
      axisEventsLoaded = true;
    }
    let q = fsCol('photos').orderBy('takenAt', 'desc');
    if (axisPhotosCursor) q = q.startAfter(axisPhotosCursor);
    const snap = await q.limit(PHOTO_PAGE).get();
    if (fromCache(snap)) throw new Error('ось: фото из офлайн-кэша');
    const rows = docsToArray(snap);
    db.photos = mergeById(db.photos, rows);
    if (snap.docs.length) axisPhotosCursor = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PHOTO_PAGE || rows.some(r => r.takenAt == null)) axisPhotosDone = true;
    return db.events.length + db.photos.length - before;
  } finally {
    axisLoading = false;
  }
}

/* ===== Запись =====
   Пришли на смену save(), который пересохранял весь блоб целиком. Вызывающий
   код по-прежнему сначала меняет db (интерфейс читает его синхронно), а затем
   говорит репозиторию, что именно изменилось.

   Ждать эти промисы не обязательно: Firestore применяет запись к локальному
   кэшу сразу, а отправку и повторы берёт на себя — в том числе когда сети нет.
   НО ни один вызывающий код (во всём src/*.js) эти промисы не ждёт и не
   ловит — значит, если запись всё-таки не доехала (реального сбоя сети в
   момент сохранения, отказа в доступе, недоступного офлайн-кэша), об этом
   не узнавал никто: экран уже показал «сохранено», и партнёр либо никогда
   не получал свидание/событие, либо оно у автора само пропадало из вида на
   другом устройстве. Раньше это лечили точечно (ключ фото, гонка при его
   генерации) — теперь один guard здесь, а не в каждом из ~40 мест вызова:
   падение больше не тонет тихо, человек хотя бы видит, что не сохранилось. */

function stripId(obj) {
  const copy = { ...obj };
  delete copy.id;
  return copy;
}

// Не чаще раза в 5 секунд — иначе пачка (repoBatch на сотни строк, разом
// упавших офлайн) высыпала бы столько же alert()'ов подряд.
let lastRepoFailureAlertAt = 0;
function reportRepoFailure(e) {
  console.warn('[repo] запись не дошла до Firestore', e);
  const now = Date.now();
  if (now - lastRepoFailureAlertAt < 5000) return;
  lastRepoFailureAlertAt = now;
  if (typeof alert === 'function') alert('Не сохранилось: пропала сеть или отказал доступ. Проверь соединение и повтори действие');
}

async function repoSet(coll, obj) {
  const id = obj.id || uid();
  if (!fsReady) return id;
  try {
    await fsCol(coll).doc(id).set(stripId(obj));
  } catch (e) {
    reportRepoFailure(e);
  }
  return id;
}

async function repoDelete(coll, id) {
  if (!fsReady) return;
  try {
    await fsCol(coll).doc(id).delete();
  } catch (e) {
    reportRepoFailure(e);
  }
}

// Пачкой — для массовых изменений вроде нового порядка после перетаскивания.
// Firestore разрешает 500 операций на батч; у нас столько не бывает, но на
// всякий случай режем.
async function repoBatch(coll, objs) {
  if (!fsReady || !objs.length) return;
  for (let i = 0; i < objs.length; i += 400) {
    const batch = firebase.firestore(fbApp).batch();
    for (const obj of objs.slice(i, i + 400)) {
      batch.set(fsCol(coll).doc(obj.id || uid()), stripId(obj));
    }
    try {
      await batch.commit();
    } catch (e) {
      reportRepoFailure(e);
    }
  }
}

// Настройки — ОДИН документ на двоих, и пишут в него оба устройства. Поэтому
// только точечное обновление по пути поля: set() целиком затёр бы подписку
// партнёра на push, и уведомления тихо перестали бы к нему приходить.
async function repoMeta(patch) {
  if (!fsReady) return;
  const ref = fsDoc().collection('meta').doc('settings');
  try {
    await ref.update(patch);
  } catch (e) {
    // update() падает не только когда документа ещё нет — так же выглядит,
    // например, отказ в доступе или недоступность сети. Глушить всё подряд
    // нельзя: настоящая причина сбоя тогда потеряется, а на «нет доступа»
    // код молча попытается создать документ пустым set() и лишний раз
    // записать — то есть замаскирует ошибку лишней операцией. Пересоздаём
    // только когда это точно «документа нет».
    if (!(e && e.code === 'not-found')) {
      reportRepoFailure(e);
      throw e;
    }
    try {
      await ref.set({}, { merge: true });
      await ref.update(patch);
    } catch (e2) {
      reportRepoFailure(e2);
      throw e2;
    }
  }
}

/* ===== Живые обновления =====
   Подписываемся только на мелкие коллекции целиком: их десятки документов,
   и правка партнёра должна появляться сама. События и фото сюда не берём —
   они грузятся окнами и страницами, подписка на них стоила бы чтений на
   каждый пролистанный месяц ради выгоды, которой почти нет. */

const LIVE_COLLECTIONS = [
  ['notes', 'notes', () => renderNotes()],
  ['lists', 'lists', () => renderLists()],
  ['wishes', 'wishlist', () => renderWishlist()],
  ['labels', 'labels', () => renderPhotos()],
  [
    'dates',
    'dates',
    () => {
      renderHome();
      renderCalendar();
    }
  ]
];

function startLiveUpdates() {
  if (!fsReady || fsUnsubs.length) return;
  for (const [coll, field, rerender] of LIVE_COLLECTIONS) {
    const unsub = fsCol(coll).onSnapshot(snap => {
      db[field] = sortDocs(docsToArray(snap));
      if (!authLocked) rerender();
    });
    fsUnsubs.push(unsub);
  }
  const unsubMeta = fsDoc()
    .collection('meta')
    .doc('settings')
    .onSnapshot(doc => {
      const s = doc.exists ? doc.data() : {};
      db.pushSubs = s.pushSubs || {};
    });
  fsUnsubs.push(unsubMeta);
}

function stopLiveUpdates() {
  for (const unsub of fsUnsubs) {
    try {
      unsub();
    } catch (e) {}
  }
  fsUnsubs = [];
}
