// Миниатюры фото события в панели дня (v6+: ev.photos хранит id фото)
function photoByRef(ref) {
  return db.photos.find(p => p.id === ref) || null;
}
// «Мёртвые» id (фото удалено из галереи) пропускаем — не рисуем битую рамку.
// Ещё не докачанные с другого устройства (фото есть в db.photos, но миниатюры
// в кэше пока нет) — тоже пропускаем, а не рисуем пустой каркас: свой ли,
// докачавшийся ли — событие/свидание просто не покажет эту миниатюру, пока
// она реально не готова. Как только докачается — warmThumbCache() дёрнет
// renderCalendar()/renderDayPanel(), и thumbRefs пропустит её уже как готовую
// (никакой отдельной дозаливки не нужно — миниатюра появится сразу с src).
// Легаси data-URL — готовы всегда, показываем напрямую.
function thumbRefs(refs) {
  return refs.filter(ref => {
    if (typeof ref === 'string' && ref.startsWith('data:')) return true;
    const p = photoByRef(ref);
    return !!(p && photoSrc(p));
  });
}
function evThumbHTML(ref, altText) {
  const p = photoByRef(ref);
  const src = p ? photoSrc(p) : ref; // сиротский data-URL из легаси-события показываем напрямую
  const attr = p ? p.id : ref;
  return `<img class="ev-thumb" src="${esc(src)}" alt="${esc(altText)}" data-photo="${esc(attr)}" loading="lazy">`;
}
function evThumbs(e) {
  if (!(e.photos && e.photos.length)) return '';
  const refs = thumbRefs(e.photos);
  if (!refs.length) return '';
  return `<span class="ev-thumbs">${refs.map(ref => evThumbHTML(ref, e.title)).join('')}</span>`;
}

// Фото события кладём в общую галерею под общим лейблом «📅 События»;
// название события остаётся подписью фото (title) и показывается в витрине событий.
// Отдельные лейблы-названия не создаём — иначе фильтр засоряется после 30+ событий.
// ev.photos хранит id фото (v6+). Новые фото события приходят как data-URL —
// на каждую создаётся фото галереи с id, а в событие пишутся эти id.
function addEventPhotosToGallery(photos, title) {
  if (!photos.length) return [];
  const ids = [];
  for (const item of photos) {
    // Элемент — либо data-URL (строка, как раньше), либо { data: dataURL, file: оригинал }
    const photoRef = item && typeof item === 'object' ? item.data : item;
    const origFile = item && typeof item === 'object' ? item.file : null;
    const existing = db.photos.find(p => p.id === photoRef);
    if (existing) {
      if (!Array.isArray(existing.labels)) existing.labels = [];
      if (!existing.labels.includes(EVENT_LABEL)) {
        existing.labels.push(EVENT_LABEL);
        repoSet('photos', existing); // лейбл поменялся у уже существующего фото — своя запись
      }
      ids.push(existing.id);
    } else {
      const ph = { id: uid(), data: photoRef, title, labels: [EVENT_LABEL], pinned: false, ts: Date.now(), order: 0 };
      db.photos.unshift(ph);
      ids.push(ph.id);
      setThumbUrl(ph.id, photoRef); // мгновенный показ из кэша миниатюр
      // Кладём копию в photoStore (в фоне), чтобы фото пережило перенос в IndexedDB.
      // Миниатюру (WebP) генерируем при загрузке; base64 из памяти убираем после записи.
      try {
        const blob = dataUrlToBlob(photoRef);
        if (blob && photoStore) {
          makeThumbBlob(photoRef, 256)
            .then(async thumb => {
              const meta = { type: blob.type || 'image/jpeg', thumbType: (thumb && thumb.type) || 'image/webp', title, size: blob.size, origType: origFile ? origFile.type || '' : '' };
              await photoStore.put(ph.id, blob, thumb, meta, origFile); // origFile — сырой файл, если есть
              if (ph.data === photoRef) delete ph.data; // блоб в сторе — base64 из памяти убираем
              repoSet('photos', ph); // метаданные без base64 — теперь можно писать в Firestore
              if (typeof schedulePhotoSync === 'function') schedulePhotoSync();
            })
            .catch(e => console.warn('Не удалось сохранить фото события в хранилище', e));
        }
      } catch (e) {
        console.warn('Не удалось сохранить фото события в хранилище', e);
      }
    }
  }
  return ids;
}

// Быстрое добавление фото к событию прямо из панели дня (кнопка 📷)
function addEventPhotoQuick(evId) {
  const ev = db.events.find(x => x.id === evId);
  if (!ev) return;
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.multiple = true;
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.addEventListener(
    'change',
    async () => {
      const ok = [];
      for (const f of [...inp.files].slice(0, 5)) {
        try {
          ok.push({ data: await readFile(f), file: f });
        } catch (err) {
          console.warn('Не удалось прочитать фото события', err);
        }
      }
      inp.remove();
      if (!ok.length) return;
      const ids = addEventPhotosToGallery(ok, ev.title);
      const refs = ids.length ? ids : ok.map(x => (x && typeof x === 'object' ? x.data : x));
      ev.photos = Array.isArray(ev.photos) ? ev.photos.concat(refs) : refs;
      // repoSet пишет документ целиком (не merge) — без явного md годовщина
      // потеряла бы дату повтора, хотя мы всего лишь добавили фото.
      ev.md = mdOf(ev.date);
      repoSet('events', ev);
      // repoSet выше пишет только сам документ события — метаданные фото
      // (новая карточка или лейбл на существующем) addEventPhotosToGallery()
      // уже сохранила сама через repoSet('photos', ...) для каждого задетого фото.
      renderCalendar();
      renderHome();
    },
    { once: true }
  );
  inp.click();
}

// Фото свидания кладём в общую галерею под лейблом «💞 Свидания»;
// dt.photos хранит id фото. Новые фото приходят как data-URL.
function addDatePhotosToGallery(photos, title) {
  if (!photos.length) return [];
  const ids = [];
  for (const item of photos) {
    // Элемент — либо data-URL (строка, как раньше), либо { data: dataURL, file: оригинал }
    const photoRef = item && typeof item === 'object' ? item.data : item;
    const origFile = item && typeof item === 'object' ? item.file : null;
    const existing = db.photos.find(p => p.id === photoRef);
    if (existing) {
      if (!Array.isArray(existing.labels)) existing.labels = [];
      if (!existing.labels.includes(DATE_LABEL)) {
        existing.labels.push(DATE_LABEL);
        repoSet('photos', existing); // лейбл поменялся у уже существующего фото — своя запись
      }
      ids.push(existing.id);
    } else {
      const ph = { id: uid(), data: photoRef, title, labels: [DATE_LABEL], pinned: false, ts: Date.now(), order: 0 };
      db.photos.unshift(ph);
      ids.push(ph.id);
      setThumbUrl(ph.id, photoRef);
      try {
        const blob = dataUrlToBlob(photoRef);
        if (blob && photoStore) {
          makeThumbBlob(photoRef, 256)
            .then(async thumb => {
              const meta = { type: blob.type || 'image/jpeg', thumbType: (thumb && thumb.type) || 'image/webp', title, size: blob.size, origType: origFile ? origFile.type || '' : '' };
              await photoStore.put(ph.id, blob, thumb, meta, origFile); // origFile — сырой файл, если есть
              if (ph.data === photoRef) delete ph.data;
              repoSet('photos', ph); // метаданные без base64 — теперь можно писать в Firestore
              if (typeof schedulePhotoSync === 'function') schedulePhotoSync();
            })
            .catch(e => console.warn('Не удалось сохранить фото свидания в хранилище', e));
        }
      } catch (e) {
        console.warn('Не удалось сохранить фото свидания в хранилище', e);
      }
    }
  }
  return ids;
}

// Быстрое добавление фото к свиданию из панели дня (кнопка 📷)
function addDatePhotoQuick(dtId) {
  const dt = db.dates.find(x => x.id === dtId);
  if (!dt) return;
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.multiple = true;
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.addEventListener(
    'change',
    async () => {
      const ok = [];
      for (const f of [...inp.files].slice(0, 5)) {
        try {
          ok.push({ data: await readFile(f), file: f });
        } catch (err) {
          console.warn('Не удалось прочитать фото свидания', err);
        }
      }
      inp.remove();
      if (!ok.length) return;
      const title = dt.place || dt.note || 'Свидание';
      const ids = addDatePhotosToGallery(ok, title);
      const refs = ids.length ? ids : ok.map(x => (x && typeof x === 'object' ? x.data : x));
      dt.photos = Array.isArray(dt.photos) ? dt.photos.concat(refs) : refs;
      repoSet('dates', dt);
      // repoSet выше пишет только сам документ свидания — метаданные фото
      // (новая карточка или лейбл на существующем) addDatePhotosToGallery()
      // уже сохранила сама через repoSet('photos', ...) для каждого задетого фото.
      renderCalendar();
      renderHome();
    },
    { once: true }
  );
  inp.click();
}

// Миниатюры фото свидания в панели дня
function dtThumbs(dt) {
  if (!(dt.photos && dt.photos.length)) return '';
  const refs = thumbRefs(dt.photos);
  if (!refs.length) return '';
  return '<span class="ev-thumbs">' + refs.map(ref => evThumbHTML(ref, '')).join('') + '</span>';
}
