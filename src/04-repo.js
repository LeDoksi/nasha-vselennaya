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

  db.labels = docsToArray(labels);
  db.notes = docsToArray(notes);
  db.lists = docsToArray(lists);
  db.wishlist = docsToArray(wishes);
  db.dates = docsToArray(dates);
  db.events = mergeById(docsToArray(repeats), docsToArray(events));
  db.photos = docsToArray(photos);
  const s = settings.exists ? settings.data() : {};
  db.pushSubs = s.pushSubs || {};

  photosCursor = photos.docs.length ? photos.docs[photos.docs.length - 1] : null;
  loadedMonths = new Set([monthKey(now.getFullYear(), now.getMonth())]);
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
  loadedMonths.add(key);
}

// Следующая страница галереи. Возвращает, сколько фото добавилось (0 — конец).
async function loadMorePhotos() {
  if (!fsReady || !photosCursor) return 0;
  const snap = await fsCol('photos').orderBy('order', 'asc').startAfter(photosCursor).limit(PHOTO_PAGE).get();
  const rows = docsToArray(snap);
  db.photos = mergeById(db.photos, rows);
  photosCursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
  return rows.length;
}

/* ===== Запись =====
   Пришли на смену save(), который пересохранял весь блоб целиком. Вызывающий
   код по-прежнему сначала меняет db (интерфейс читает его синхронно), а затем
   говорит репозиторию, что именно изменилось.

   Ждать эти промисы не обязательно: Firestore применяет запись к локальному
   кэшу сразу, а отправку и повторы берёт на себя — в том числе когда сети нет. */

function stripId(obj) {
  const copy = { ...obj };
  delete copy.id;
  return copy;
}

async function repoSet(coll, obj) {
  const id = obj.id || uid();
  if (!fsReady) return id;
  await fsCol(coll).doc(id).set(stripId(obj));
  return id;
}

async function repoDelete(coll, id) {
  if (!fsReady) return;
  await fsCol(coll).doc(id).delete();
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
    await batch.commit();
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
    // Документа ещё нет — update по нему падает, создаём слиянием.
    await ref.set({}, { merge: true });
    await ref.update(patch);
  }
}
