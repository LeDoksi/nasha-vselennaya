/* ===== Фото ===== */
function readFile(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        const max = 900;
        if (w > max || h > max) { const k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
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
const photoSort = (a, b) => (b.pinned - a.pinned) || ((a.order || 0) - (b.order || 0));
$('#photoInput').addEventListener('change', async e => {
  const files = [...e.target.files].slice(0, 10);
  for (const f of files) {
    try {
      const data = await readFile(f);
      // Дата съёмки из EXIF (если камера её записала). Нужна для «В этот день»:
      // фото показывается только по EXIF-дате или по дате события, НЕ по дате загрузки.
      let takenAt = null;
      try { takenAt = await extractExifDate(f); } catch (e) {}
      const ph = { id: uid(), data, title: f.name, labels: [], pinned: false, ts: Date.now(), order: 0, takenAt };
      db.photos.unshift(ph);
      setThumbUrl(ph.id, data); // мгновенный показ из кэша миниатюр
      // Сразу кладём в photoStore — дальше фото живёт в IndexedDB (зашифровано).
      // Миниатюру (WebP) генерируем при загрузке; после записи убираем base64 из памяти.
      try {
        const blob = dataUrlToBlob(data);
        if (blob && photoStore) {
          let thumb = null, thumbType = null;
          try { thumb = await makeThumbBlob(data, 256); thumbType = (thumb && thumb.type) || 'image/webp'; } catch (e) {}
          const meta = { type: blob.type || 'image/jpeg', thumbType, title: f.name, size: blob.size, takenAt, origType: f.type || '' };
          await photoStore.put(ph.id, blob, thumb, meta, f); // f — оригинал (сырой файл камеры)
          delete ph.data;            // блоб в сторе — из памяти убираем base64
          if (typeof schedulePhotoSync === 'function') schedulePhotoSync(); // выгрузим в облако
        }
      } catch (err) { console.warn('Не удалось сохранить фото в хранилище', err); }
    } catch (err) { console.warn('Не удалось загрузить фото', err); }
  }
  e.target.value = '';
  save(); renderPhotos();
});
// Лейблы — {id,name,color}. Полоса чипов теперь только фильтр (клик всегда
// значит одно и то же); создание/переименование/цвет/удаление живут в
// отдельной модалке «Управление лейблами» (см. openLabelManageOverlay ниже),
// применение к фото — в модалке «Применить лейблы» (openLabelApplyOverlay).
function labelById(id) { return db.labels.find(l => l.id === id) || null; }
function renderLabels() {
  const bar = $('#labelBar');
  if (!bar) return;
  const evCount = db.photos.filter(p => (p.labels || []).includes(EVENT_LABEL)).length;
  const dtCount = db.photos.filter(p => (p.labels || []).includes(DATE_LABEL)).length;
  bar.innerHTML =
    `<button class="album-chip${currentLabel === '' ? ' active' : ''}" data-label="">🖼 Все фото (${db.photos.length})</button>` +
    (evCount ? `<button class="album-chip${currentLabel === EVENT_LABEL ? ' active' : ''}" data-label="${esc(EVENT_LABEL)}">📅 События (${evCount})</button>` : '') +
    (dtCount ? `<button class="album-chip${currentLabel === DATE_LABEL ? ' active' : ''}" data-label="${esc(DATE_LABEL)}">💞 Свидания (${dtCount})</button>` : '') +
    db.labels.map(l => `<button class="album-chip${currentLabel === l.id ? ' active' : ''}" data-label="${esc(l.id)}" title="Перетащи фото сюда, чтобы навесить лейбл"><span class="label-dot" style="background:${esc(l.color)}"></span>${esc(l.name)}</button>`).join('') +
    `<button class="btn album-add-btn" data-label-new title="Создать, переименовать, перекрасить или удалить лейблы">🏷 Лейблы</button>`;
}
// Чистка фото без подтверждения — общая часть deletePhoto()/deleteSelectedPhotos()
// (при массовом удалении confirm один, на всех отмеченных сразу).
function deletePhotoSilent(id) {
  const ph = db.photos.find(x => x.id === id);
  if (ph) {
    // фото удаляется и из событий, и из свиданий, чтобы в календаре не оставалось «мёртвых» миниатюр
    db.events.forEach(ev => {
      if (!Array.isArray(ev.photos)) return;
      ev.photos = ev.photos.filter(d => d !== ph.id);
      if (!ev.photos.length) delete ev.photos;
    });
    db.dates.forEach(dt => {
      if (!Array.isArray(dt.photos)) return;
      dt.photos = dt.photos.filter(d => d !== ph.id);
      if (!dt.photos.length) delete dt.photos;
    });
    if (photoStore && ph.id) photoStore.delete(ph.id); // убираем блоб из IndexedDB
  }
  db.photos = db.photos.filter(x => x.id !== id);
  selectedPhotos.delete(id);
  // Удаляем из кэша только удалённое фото — остальные миниатюры остаются
  if (id) thumbCache.delete(id);
}
function deletePhoto(id) {
  const ph = db.photos.find(x => x.id === id);
  if (!confirmDelete('Удалить фото' + (ph && ph.title ? ' «' + ph.title + '»' : '') + '? Это не отменить.')) return;
  deletePhotoSilent(id);
  save(); renderPhotos(); renderCalendar(); renderHome();
  if (typeof schedulePhotoSync === 'function') schedulePhotoSync(); // уберём и из облака
}
// Массовое удаление отмеченных фото (панель выбора «🗑 Удалить выбранные») —
// один confirm на все, без повторного диалога на каждое.
function deleteSelectedPhotos() {
  const ids = [...selectedPhotos];
  if (!ids.length) return;
  if (!confirmDelete(`Удалить ${ids.length} фото? Это не отменить.`)) return;
  ids.forEach(deletePhotoSilent);
  save(); renderPhotos(); renderCalendar(); renderHome();
  if (typeof schedulePhotoSync === 'function') schedulePhotoSync();
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
// Дебаунс: несколько вызовов renderPhotos() в одном кадре схлопываются в один
// рендер (requestAnimationFrame). Без rAF (песочница тестов) — рендер синхронный.
let photosRenderQueued = false;
function renderPhotos() {
  if (photosRenderQueued) return 'coalesced';
  photosRenderQueued = true;
  if (typeof requestAnimationFrame === 'function') {
    let done = false;
    const flush = () => {
      if (done) return;
      done = true;
      photosRenderQueued = false;
      renderPhotosNow();
    };
    requestAnimationFrame(flush);
    if (typeof setTimeout === 'function') setTimeout(flush, 120); // вкладка в фоне: rAF спит
  } else {
    photosRenderQueued = false;
    renderPhotosNow();
  }
}
function renderPhotosNow() {
  const grid = $('#photosGrid');
  if (!grid) return;
  renderLabels();
  // витрина «📅 События»: фильтр кнопками «год → месяц → событие»
  renderEventBar();
  const list = filteredPhotos();
  const hint = $('#dragHint');
  if (hint) hint.style.display = list.length > 1 ? 'block' : 'none';
  const selBar = $('#photoSelBar');
  if (selBar) {
    selBar.style.display = selectedPhotos.size ? 'flex' : 'none';
    if (selectedPhotos.size) { const c = $('#selCount'); if (c) c.textContent = selectedPhotos.size; }
  }
  grid.innerHTML = list.length ? list.map(p => {
    // Кэш миниатюр может быть ещё не прогрет — рисуем каркас и заполняем src
    // асинхронно (как в «Памяти» и на «Главной»), чтобы миниатюры появлялись сами.
    const url = photoSrc(p);
    return `
    <div class="photo${p.pinned ? ' pinned' : ''}${selectedPhotos.has(p.id) ? ' selected' : ''}" data-id="${p.id}">
      <img${url ? ' src="' + esc(url) + '"' : ' data-photo-src="' + esc(p.id) + '"'} alt="${esc(p.title)}" data-photo="${esc(p.id)}" loading="lazy">
      <button class="sel-photo${selectedPhotos.has(p.id) ? ' active' : ''}" data-sel-photo="${p.id}" title="${selectedPhotos.has(p.id) ? 'Снять выбор' : 'Выбрать'}">${selectedPhotos.has(p.id) ? '✓' : '○'}</button>
      <button class="pin-photo${p.pinned ? ' active' : ''}" data-pin-photo="${p.id}" title="${p.pinned ? 'Открепить' : 'Закрепить'}">${p.pinned ? '⭐' : '☆'}</button>
      <button class="del-photo" data-del-photo="${p.id}" title="Удалить">✕</button>
      <button class="drag-handle photo-drag" data-photo-drag="${p.id}" title="Перетащить">⠿</button>
      ${(p.labels || []).length ? `<div class="photo-labels">${p.labels.map(id => {
        const sys = id === EVENT_LABEL || id === DATE_LABEL;
        const tag = sys ? null : labelById(id);
        if (!sys && !tag) return ''; // ссылка на удалённый лейбл — не рисуем
        const name = sys ? id : tag.name;
        return `<span class="photo-label">${sys ? '' : `<span class="label-dot" style="background:${esc(tag.color)}"></span>`}${esc(name)}${sys ? '' : `<button type="button" class="photo-label-del" data-label-off="${esc(id)}" data-photo-off="${p.id}" title="Убрать лейбл с фото">✕</button>`}</span>`;
      }).join('')}</div>` : ''}
      ${currentLabel === EVENT_LABEL && p.title ? `<span class="photo-caption">${esc(eventFilter.title || p.title)}</span>` : ''}
    </div>`;
  }).join('')
    : '<p class="cal-tip">📷 Загрузите ваши фото — они зашифруются и будут доступны с обоих устройств, если настроена синхронизация в Настройках.</p>';
  hydratePhotoImgs(grid); // миниатюры из photoStore — заполняем src после рендера каркаса
}
// Витрина «📅 События»: кнопки «год → месяц → событие» появляются по мере выбора
function eventPhotosCount(year, month, title) {
  let n = 0;
  for (const p of db.photos) {
    if (!(p.labels || []).includes(EVENT_LABEL)) continue;
    if (eventsForPhoto(p).some(e =>
      (!year || e.year === year) && (!month || e.month === month) && (!title || e.title === title))) n++;
  }
  return n;
}
function renderEventBar() {
  const evBar = $('#eventBar');
  if (!evBar) return;
  const show = currentLabel === EVENT_LABEL;
  evBar.style.display = show ? 'flex' : 'none';
  if (!show) return;
  const f = eventFilter;
  // события, у которых есть фото в галерее (ev.photos хранит id фото)
  const photoIds = new Set(db.photos.map(p => p.id));
  const evs = db.events.filter(ev => Array.isArray(ev.photos) && ev.photos.some(d => photoIds.has(d)));
  const years = [...new Set(evs.map(e => (e.date || '').slice(0, 4)).filter(Boolean))].sort((a, b) => b - a);
  const monthsOf = year => [...new Set(evs.filter(e => (e.date || '').slice(0, 4) === year).map(e => (e.date || '').slice(5, 7)).filter(Boolean))].sort();
  const titlesOf = (year, month) => {
    const set = new Set();
    for (const e of evs) {
      const [y, m] = (e.date || '').split('-');
      if ((!year || y === year) && (!month || m === month)) set.add(e.title);
    }
    return [...set].sort();
  };
  const yearsEl = $('#eventYears');
  if (yearsEl) {
    yearsEl.style.display = years.length ? 'flex' : 'none';
    yearsEl.innerHTML = years.map(y =>
      `<button class="ev-btn${f.year === y ? ' active' : ''}" data-ev-year="${y}">${y} <span class="cnt">${eventPhotosCount(y, '', '')}</span></button>`).join('');
  }
  const monthsEl = $('#eventMonths');
  if (monthsEl) {
    const months = f.year ? monthsOf(f.year) : [];
    monthsEl.style.display = months.length ? 'flex' : 'none';
    monthsEl.innerHTML = months.map(m =>
      `<button class="ev-btn${f.month === m ? ' active' : ''}" data-ev-month="${m}">${MONTHS[Number(m) - 1]} <span class="cnt">${eventPhotosCount(f.year, m, '')}</span></button>`).join('');
  }
  const titlesEl = $('#eventTitles');
  if (titlesEl) {
    const titles = f.month ? titlesOf(f.year, f.month) : [];
    titlesEl.style.display = titles.length ? 'flex' : 'none';
    titlesEl.innerHTML = titles.map(t =>
      `<button class="ev-btn${f.title === t ? ' active' : ''}" data-ev-title="${esc(t)}">${esc(t)} <span class="cnt">${eventPhotosCount(f.year, f.month, t)}</span></button>`).join('');
  }
  const reset = $('#eventReset');
  if (reset) reset.style.display = (f.year || f.month || f.title) ? 'inline-block' : 'none';
}
// Лейблы: удаление (фото не трогаем), применение/снятие, создание.
// p.labels хранит id — у служебных EVENT_LABEL/DATE_LABEL id равен имени,
// у ручных лейблов id генерируется при создании (см. labelById в renderLabels).
function deleteLabelSilent(id) {
  if (id === EVENT_LABEL || id === DATE_LABEL) return; // служебные лейблы защищены от удаления
  db.labels = db.labels.filter(l => l.id !== id);
  db.photos.forEach(p => { if (p.labels) p.labels = p.labels.filter(l => l !== id); });
  if (currentLabel === id) currentLabel = '';
}
function deleteLabel(id) {
  const l = labelById(id);
  if (!l) return;
  const count = db.photos.filter(p => (p.labels || []).includes(id)).length;
  if (!confirmDelete(`Удалить лейбл «${l.name}»${count ? ` (снимется с ${count} фото)` : ''}? Это не отменить.`)) return;
  deleteLabelSilent(id);
  save(); renderLabelManageList(); renderPhotos();
}
function applyLabelToPhotos(id, ids) {
  const set = new Set(ids);
  db.photos.forEach(p => {
    if (!set.has(p.id)) return;
    if (!Array.isArray(p.labels)) p.labels = [];
    if (!p.labels.includes(id)) p.labels.push(id);
  });
}
// Тоггл лейбла сразу на всех целевых фото (попап «Применить лейблы»): если
// лейбл уже стоит на всех — снимаем со всех, иначе навешиваем на все.
function toggleLabelOnPhotos(id, ids) {
  const targets = db.photos.filter(p => ids.includes(p.id));
  const allHave = targets.length > 0 && targets.every(p => (p.labels || []).includes(id));
  targets.forEach(p => {
    if (!Array.isArray(p.labels)) p.labels = [];
    p.labels = allHave ? p.labels.filter(l => l !== id) : (p.labels.includes(id) ? p.labels : [...p.labels, id]);
  });
  save();
}
// Убрать лейбл с конкретного фото (крестик ✕ на бейдже фото).
function removeLabelFromPhoto(photoId, id) {
  const p = db.photos.find(x => x.id === photoId);
  if (!p || !Array.isArray(p.labels) || !p.labels.includes(id)) return;
  p.labels = p.labels.filter(l => l !== id);
  save(); renderPhotos();
}

/* ---- Модалка «Лейблы»: создание, переименование, цвет, удаление ---- */
let editingLabelId = null;     // id лейбла, у которого сейчас правится название
let colorPickerLabelId = null; // id лейбла с открытой палитрой цвета
function openLabelManageOverlay() {
  editingLabelId = null;
  colorPickerLabelId = null;
  $('#labelNewName').value = '';
  renderLabelManageList();
  $('#labelOverlay').hidden = false;
  $('#labelNewName').focus();
}
function renderLabelManageList() {
  const box = $('#labelManageList');
  if (!box) return;
  if (!db.labels.length) {
    box.innerHTML = '<p class="cal-tip">Пока нет ни одного лейбла — создай первый выше.</p>';
    return;
  }
  box.innerHTML = db.labels.map(l => {
    const count = db.photos.filter(p => (p.labels || []).includes(l.id)).length;
    const editing = editingLabelId === l.id;
    const pickerOpen = colorPickerLabelId === l.id;
    return `<div class="label-row">
      <button type="button" class="label-dot-btn" data-label-color-toggle="${l.id}" style="background:${esc(l.color)}" title="Изменить цвет"></button>
      ${editing
        ? `<input type="text" class="label-name-editor" id="labelNameEdit-${l.id}" value="${esc(l.name)}">
           <button class="mini-x" data-save-label="${l.id}" title="Сохранить">💜</button>
           <button class="mini-x" data-cancel-label title="Отмена">✕</button>`
        : `<span class="label-row-name">${esc(l.name)}</span>
           <span class="label-row-count">${count} фото</span>
           <button class="mini-x" data-edit-label="${l.id}" title="Переименовать">✏️</button>
           <button class="mini-x" data-del-label="${l.id}" title="Удалить лейбл">🗑</button>`}
    </div>${pickerOpen ? `<div class="label-color-picker">${LABEL_COLORS.map(c => `<button type="button" class="label-swatch${c === l.color ? ' active' : ''}" data-label-set-color="${l.id}" data-color="${c}" style="background:${c}"></button>`).join('')}</div>` : ''}`;
  }).join('');
}
function startEditLabelName(id) { editingLabelId = id; colorPickerLabelId = null; renderLabelManageList(); }
function cancelLabelNameEdit() { editingLabelId = null; renderLabelManageList(); }
function saveLabelNameEdit(id, text) {
  const l = labelById(id);
  editingLabelId = null;
  if (!l) { renderLabelManageList(); return; }
  const inp = $('#labelNameEdit-' + id);
  const t = (text !== undefined ? text : (inp && inp.value) || '').trim();
  if (t) l.name = t;
  save(); renderLabelManageList(); renderPhotos();
}
function toggleLabelColorPicker(id) {
  colorPickerLabelId = colorPickerLabelId === id ? null : id;
  editingLabelId = null;
  renderLabelManageList();
}
function setLabelColor(id, color) {
  const l = labelById(id);
  if (!l) return;
  l.color = color;
  colorPickerLabelId = null;
  save(); renderLabelManageList(); renderPhotos();
}
$('#labelNewBtn').addEventListener('click', () => {
  const name = $('#labelNewName').value.trim();
  if (!name) return;
  db.labels.push({ id: uid(), name, color: LABEL_COLORS[db.labels.length % LABEL_COLORS.length] });
  $('#labelNewName').value = '';
  save(); renderLabelManageList(); renderPhotos();
  $('#labelNewName').focus();
});
$('#labelNewName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#labelNewBtn').click(); });

/* ---- Модалка «Применить лейблы»: чек-лист для выбранных фото / лайтбокса ---- */
let applyTargetIds = [];
function openLabelApplyOverlay(ids) {
  applyTargetIds = [...ids];
  if (!applyTargetIds.length) return;
  $('#labelApplyNewName').value = '';
  renderLabelApplyList();
  $('#labelApplyOverlay').hidden = false;
}
function renderLabelApplyList() {
  const box = $('#labelApplyList');
  if (!box) return;
  const targets = db.photos.filter(p => applyTargetIds.includes(p.id));
  box.innerHTML = db.labels.length ? db.labels.map(l => {
    const on = targets.length > 0 && targets.every(p => (p.labels || []).includes(l.id));
    return `<button type="button" class="album-chip label-apply-chip${on ? ' active' : ''}" data-label-apply-toggle="${l.id}"><span class="label-dot" style="background:${esc(l.color)}"></span>${esc(l.name)}${on ? ' ✓' : ''}</button>`;
  }).join('') : '<p class="cal-tip">Лейблов пока нет — создай ниже.</p>';
}
$('#labelApplyNewBtn').addEventListener('click', () => {
  const name = $('#labelApplyNewName').value.trim();
  if (!name) return;
  const l = { id: uid(), name, color: LABEL_COLORS[db.labels.length % LABEL_COLORS.length] };
  db.labels.push(l);
  applyLabelToPhotos(l.id, applyTargetIds);
  $('#labelApplyNewName').value = '';
  save(); renderLabelApplyList(); renderPhotos();
});
$('#labelApplyNewName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#labelApplyNewBtn').click(); });
$('#selAddLabelBtn').addEventListener('click', () => openLabelApplyOverlay(selectedPhotos));
$('#selDeleteBtn').addEventListener('click', deleteSelectedPhotos);
$('#selClearBtn').addEventListener('click', () => { selectedPhotos.clear(); renderPhotos(); });
// Фильтр витрины «📅 События»: клик по кнопкам «год → месяц → событие» (повторный клик сбрасывает уровень)
document.addEventListener('click', e => {
  const yearBtn = e.target.closest('[data-ev-year]');
  if (yearBtn) {
    const val = yearBtn.dataset.evYear;
    eventFilter.year = eventFilter.year === val ? '' : val;
    eventFilter.month = ''; eventFilter.title = '';
    renderPhotos(); return;
  }
  const monthBtn = e.target.closest('[data-ev-month]');
  if (monthBtn) {
    const val = monthBtn.dataset.evMonth;
    eventFilter.month = eventFilter.month === val ? '' : val;
    eventFilter.title = '';
    renderPhotos(); return;
  }
  const titleBtn = e.target.closest('[data-ev-title]');
  if (titleBtn) {
    const val = titleBtn.dataset.evTitle;
    eventFilter.title = eventFilter.title === val ? '' : val;
    renderPhotos(); return;
  }
  const resetBtn = e.target.closest('[data-ev-reset]');
  if (resetBtn) {
    eventFilter = { year: '', month: '', title: '' };
    renderPhotos(); return;
  }
});
// Перетаскивание фото — SortableJS (forceFallback: нативный HTML5 DnD не
// поддерживает тач). Один инстанс, одна ручка .photo-drag, две развязки на
// отпускании (onEnd), различаются хит-тестом точки курсора:
// 1) отпустили над чипом лейбла — откатываем визуальную перестановку и вешаем
//    лейбл (и всем отмеченным) вместо сохранения нового порядка;
// 2) иначе — обычный реордер, пересчёт p.order по итоговому DOM-порядку.
// Обратное направление (чип → фото) не трогает #photosGrid вообще — отдельный
// маленький pointer-обработчик на #labelBar (05-dnd.js, chipDragSetup), с этим
// инстансом общих ручек/контейнеров нет, конфликтовать нечему.
function photoDropChip(evt) {
  const oe = evt.originalEvent || evt;
  // elementFromPoint — точнее (при forceFallback e.target часто указывает на
  // перехваченный элемент, а не на то, что реально под курсором); e.target —
  // запасной вариант, если elementFromPoint недоступен (напр. в тестах).
  let el = null;
  if (typeof document !== 'undefined' && typeof document.elementFromPoint === 'function'
    && (oe.clientX !== undefined || oe.clientY !== undefined)) {
    try { el = document.elementFromPoint(oe.clientX, oe.clientY); } catch (err) {}
  }
  if (!el) el = oe.target;
  if (!el || !el.closest) return null;
  const chip = el.closest('.album-chip[data-label]');
  if (!chip || !chip.dataset.label) return null;
  if (chip.dataset.label === EVENT_LABEL || chip.dataset.label === DATE_LABEL) return null;
  return chip;
}
// Живая подсветка чипа под курсором во время драга фото — read-only наблюдатель
// поверх SortableJS (только читает позицию, ничего не перехватывает), не второй
// драг-движок: событию pointermove это никак не мешает.
let photoChipHoverEl = null;
function photoChipHoverCheck(e) {
  const chip = photoDropChip(e);
  if (chip === photoChipHoverEl) return;
  if (photoChipHoverEl && photoChipHoverEl.classList) photoChipHoverEl.classList.remove('drag-over');
  if (chip && chip.classList) chip.classList.add('drag-over');
  photoChipHoverEl = chip;
}
function photosSortEnd(evt) {
  document.removeEventListener('pointermove', photoChipHoverCheck);
  if (photoChipHoverEl && photoChipHoverEl.classList) { photoChipHoverEl.classList.remove('drag-over'); photoChipHoverEl = null; }
  const chip = photoDropChip(evt);
  if (chip) {
    // не реордер — навешивание лейбла. DOM-перестановку, которую уже сделал
    // Sortable во время живого драга, отдельно откатывать не нужно: renderPhotos()
    // ниже перерисовывает сетку целиком синхронно, до первой отрисовки браузера —
    // промежуточное состояние DOM никогда не попадает на экран.
    const targets = new Set(selectedPhotos); // массовое назначение: всем отмеченным…
    targets.add(evt.item.dataset.id);        // …и перетаскиваемому фото
    applyLabelToPhotos(chip.dataset.label, targets);
    selectedPhotos.clear(); // действие выполнено — выделение снимаем
    save(); renderPhotos();
    return;
  }
  // обычный реордер: порядок из текущего DOM-порядка сетки, закреплённые сверху
  const domIds = [...evt.to.children].filter(c => c.classList && c.classList.contains('photo')).map(c => c.dataset.id);
  const list = domIds.map(id => db.photos.find(p => p.id === id)).filter(Boolean);
  [...list.filter(p => p.pinned), ...list.filter(p => !p.pinned)].forEach((p, i) => {
    const ph = db.photos.find(x => x.id === p.id);
    if (ph) ph.order = i;
  });
  save(); renderPhotos();
}
if (typeof Sortable !== 'undefined') {
  Sortable.create($('#photosGrid'), {
    handle: '.photo-drag', forceFallback: true, fallbackOnBody: true, animation: 150,
    scroll: true, scrollSensitivity: 80, scrollSpeed: 20,
    onStart() { document.addEventListener('pointermove', photoChipHoverCheck); },
    onEnd: photosSortEnd
  });
}
// Чип лейбла → фото (обратное направление) — см. 05-dnd.js/chipDragSetup.
chipDragSetup($('#labelBar'));

