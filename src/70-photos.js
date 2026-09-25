/* ===== Фото ===== */
function readFile(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        const max = 900;
        if (w > max || h > max) {
          const k = max / Math.max(w, h);
          w = Math.round(w * k);
          h = Math.round(h * k);
        }
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        // WebP, не JPEG: JPEG не умеет прозрачность — PNG-стикер/скриншот с
        // альфа-каналом заливался бы сплошным цветом. WebP её поддерживает;
        // в браузерах без кодирования в WebP toDataURL() по спецификации сам
        // откатывается на PNG (тоже с прозрачностью), так что фикс работает
        // одинаково независимо от поддержки WebP конкретным браузером.
        res(cv.toDataURL('image/webp', 0.82));
      };
      img.onerror = rej;
      img.src = fr.result;
    };
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}
/* ===== Фото: лейблы, выбор нескольких, перетаскивание ===== */
let currentLabel = ''; // фильтр: '' = все фото
let eventFilter = { year: '', month: '', title: '' }; // витрина «📅 События»: фильтр кнопками «год → месяц → событие»
const selectedPhotos = new Set(); // id выбранных фото (для массовых операций)
const photoSort = (a, b) => b.pinned - a.pinned || (a.order || 0) - (b.order || 0);
// Раньше на каждой карточке одновременно висели 4 постоянные кнопки (выбор/
// драг/закрепить/удалить) — на маленькой мобильной миниатюре они перекрывали
// до половины фото. Теперь по умолчанию карточка чистая; выбор и сортировка —
// два явных режима по требованию (кнопки в .photo-bar-actions), взаимно
// исключающие (нет смысла тащить фото и выбирать его одновременно — конфликт
// жестов на одной и той же карточке). Закрепить/удалить одно фото — в
// светбоксе (85-lightbox.js): не нужен отдельный режим ради одного действия.
let photoSelectMode = false;
let photoReorderMode = false;
function togglePhotoSelectMode() {
  photoSelectMode = !photoSelectMode;
  if (photoSelectMode) photoReorderMode = false;
  else selectedPhotos.clear();
  renderPhotos();
}
function togglePhotoReorderMode() {
  photoReorderMode = !photoReorderMode;
  if (photoReorderMode) {
    photoSelectMode = false;
    selectedPhotos.clear();
  }
  renderPhotos();
}
$('#photoInput').addEventListener('change', async e => {
  const files = [...e.target.files].slice(0, 10);
  for (const f of files) {
    try {
      const data = await readFile(f);
      // Дата съёмки из EXIF (если камера её записала). Нужна для «В этот день»:
      // фото показывается только по EXIF-дате или по дате события, НЕ по дате загрузки.
      let takenAt = null;
      try {
        takenAt = await extractExifDate(f);
      } catch (e) {}
      const ph = { id: uid(), data, title: f.name, labels: [], pinned: false, ts: Date.now(), order: 0, takenAt };
      db.photos.unshift(ph);
      setThumbUrl(ph.id, data); // мгновенный показ из кэша миниатюр
      // Сразу кладём в photoStore — дальше фото живёт в IndexedDB (зашифровано).
      // Миниатюру (WebP) генерируем при загрузке; после записи убираем base64 из памяти.
      try {
        const blob = dataUrlToBlob(data);
        if (blob && photoStore) {
          let thumb = null,
            thumbType = null;
          try {
            thumb = await makeThumbBlob(data, 256);
            thumbType = (thumb && thumb.type) || 'image/webp';
          } catch (e) {}
          const meta = { type: blob.type || 'image/jpeg', thumbType, title: f.name, size: blob.size, takenAt, origType: f.type || '' };
          await photoStore.put(ph.id, blob, thumb, meta, f); // f — оригинал (сырой файл камеры)
          delete ph.data; // блоб в сторе — из памяти убираем base64
          repoSet('photos', ph); // метаданные (без base64 — сам файл уже в photoStore/бакете)
          if (typeof schedulePhotoSync === 'function') schedulePhotoSync(); // выгрузим в облако
        }
      } catch (err) {
        console.warn('Не удалось сохранить фото в хранилище', err);
      }
    } catch (err) {
      console.warn('Не удалось загрузить фото', err);
    }
  }
  e.target.value = '';
  renderPhotos();
});
// Лейблы — {id,name,color}. Полоса чипов теперь только фильтр (клик всегда
// значит одно и то же); создание/переименование/цвет/удаление живут в
// отдельной модалке «Управление лейблами» (см. openLabelManageOverlay ниже),
// применение к фото — в модалке «Применить лейблы» (openLabelApplyOverlay).
function labelById(id) {
  return db.labels.find(l => l.id === id) || null;
}
function renderLabels() {
  const bar = $('#labelBar');
  if (!bar) return;
  const evCount = db.photos.filter(p => (p.labels || []).includes(EVENT_LABEL)).length;
  const dtCount = db.photos.filter(p => (p.labels || []).includes(DATE_LABEL)).length;
  bar.innerHTML =
    `<button class="album-chip${currentLabel === '' ? ' active' : ''}" data-label="">🖼 Все фото (${db.photos.length})</button>` +
    (evCount ? `<button class="album-chip${currentLabel === EVENT_LABEL ? ' active' : ''}" data-label="${esc(EVENT_LABEL)}">📅 События (${evCount})</button>` : '') +
    (dtCount ? `<button class="album-chip${currentLabel === DATE_LABEL ? ' active' : ''}" data-label="${esc(DATE_LABEL)}">💞 Свидания (${dtCount})</button>` : '') +
    db.labels
      .map(
        l =>
          `<button class="album-chip${currentLabel === l.id ? ' active' : ''}" data-label="${esc(l.id)}" title="Перетащи фото сюда, чтобы навесить лейбл"><span class="label-dot" style="background:${esc(l.color)}"></span>${esc(l.name)}</button>`
      )
      .join('') +
    `<button class="btn album-add-btn" data-label-new title="Создать, переименовать, перекрасить или удалить лейблы">🏷 Лейблы</button>`;
}
// Чистка фото без подтверждения — общая часть deletePhoto()/deleteSelectedPhotos()
// (при массовом удалении confirm один, на всех отмеченных сразу).
// touched (необязателен) собирает события/свидания, у которых поменялся
// массив photos — при массовом удалении (deleteSelectedPhotos) один и тот же
// ev/dt может задеть несколько удаляемых фото подряд; Set по ссылке схлопывает
// повторы, чтобы на каждое такое событие ушла одна запись, а не по одной на фото.
function deletePhotoSilent(id, touched) {
  const ph = db.photos.find(x => x.id === id);
  if (ph) {
    // фото удаляется и из событий, и из свиданий, чтобы в календаре не оставалось «мёртвых» миниатюр
    db.events.forEach(ev => {
      if (!Array.isArray(ev.photos) || !ev.photos.includes(ph.id)) return;
      ev.photos = ev.photos.filter(d => d !== ph.id);
      if (!ev.photos.length) delete ev.photos;
      if (touched) touched.events.add(ev);
    });
    db.dates.forEach(dt => {
      if (!Array.isArray(dt.photos) || !dt.photos.includes(ph.id)) return;
      dt.photos = dt.photos.filter(d => d !== ph.id);
      if (!dt.photos.length) delete dt.photos;
      if (touched) touched.dates.add(dt);
    });
    if (photoStore && ph.id) photoStore.delete(ph.id); // убираем блоб из IndexedDB
  }
  db.photos = db.photos.filter(x => x.id !== id);
  selectedPhotos.delete(id);
  // Удаляем из кэша только удалённое фото — остальные миниатюры остаются
  if (id) thumbCache.delete(id);
}
// Порядок записи важен: сначала метаданные фото и задетых событий/свиданий
// в Firestore, и только когда это подтвердилось — schedulePhotoSync() (реально
// стирает шифртекст из бакета). Обратный порядок оставил бы битую карточку:
// файл в бакете уже нет, а метаданные о нём — ещё есть.
function deletePhoto(id) {
  const ph = db.photos.find(x => x.id === id);
  if (!confirmDelete('Удалить фото' + (ph && ph.title ? ' «' + ph.title + '»' : '') + '? Это не отменить.')) return;
  const touched = { events: new Set(), dates: new Set() };
  deletePhotoSilent(id, touched);
  renderPhotos();
  renderCalendar();
  renderHome();
  touched.events.forEach(ev => repoSet('events', ev));
  touched.dates.forEach(dt => repoSet('dates', dt));
  repoDelete('photos', id).then(() => {
    if (typeof schedulePhotoSync === 'function') schedulePhotoSync(); // и только теперь — из облака
  });
}
// Массовое удаление отмеченных фото (панель выбора «🗑 Удалить выбранные») —
// один confirm на все, без повторного диалога на каждое.
function deleteSelectedPhotos() {
  const ids = [...selectedPhotos];
  if (!ids.length) return;
  if (!confirmDelete(`Удалить ${ids.length} фото? Это не отменить.`)) return;
  const touched = { events: new Set(), dates: new Set() };
  ids.forEach(id => deletePhotoSilent(id, touched));
  renderPhotos();
  renderCalendar();
  renderHome();
  touched.events.forEach(ev => repoSet('events', ev));
  touched.dates.forEach(dt => repoSet('dates', dt));
  Promise.all(ids.map(id => repoDelete('photos', id))).then(() => {
    if (typeof schedulePhotoSync === 'function') schedulePhotoSync();
  });
}
// Массовое закрепление (панель выбора «⭐/☆ Закрепить») — тот же тоггл-приём,
// что и у применения лейблов (toggleLabelOnPhotos): если закреплены уже ВСЕ
// отмеченные — снимаем закрепление со всех, иначе закрепляем все разом.
function toggleSelectedPin() {
  const ids = [...selectedPhotos];
  if (!ids.length) return;
  const targets = db.photos.filter(p => ids.includes(p.id));
  const allPinned = targets.length > 0 && targets.every(p => p.pinned);
  targets.forEach(p => {
    p.pinned = !allPinned;
  });
  repoBatch('photos', targets);
  renderPhotos();
}
// К каким событиям привязано фото — для фильтра «год → месяц → событие».
// ev.photos хранит id фото (v6+).
function eventsForPhoto(p) {
  const res = [];
  for (const ev of db.events) {
    if (!Array.isArray(ev.photos)) continue;
    const hit = ev.photos.includes(p.id);
    if (!hit) continue;
    const [y, m] = (ev.date || '').split('-');
    if (!y || !m) continue;
    res.push({ title: ev.title, year: y, month: m });
  }
  return res;
}
function filteredPhotos() {
  let list = [...db.photos].sort(photoSort).filter(p => !currentLabel || (p.labels || []).includes(currentLabel));
  if (currentLabel === EVENT_LABEL) {
    const f = eventFilter;
    if (f.year || f.month || f.title) {
      list = list.filter(p => {
        const evs = eventsForPhoto(p);
        if (f.year && !evs.some(e => e.year === f.year)) return false;
        if (f.month && !evs.some(e => e.month === f.month)) return false;
        if (f.title && !evs.some(e => e.title === f.title)) return false;
        return true;
      });
    }
  }
  return list;
}
