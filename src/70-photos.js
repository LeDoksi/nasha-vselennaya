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
function renderLabels() {
  const bar = $('#labelBar');
  if (!bar) return;
  const evCount = db.photos.filter(p => (p.labels || []).includes(EVENT_LABEL)).length;
  const dtCount = db.photos.filter(p => (p.labels || []).includes(DATE_LABEL)).length;
  const sysLabels = [EVENT_LABEL, DATE_LABEL];
  bar.innerHTML =
    `<button class="album-chip${currentLabel === '' ? ' active' : ''}" data-label="">🖼 Все фото (${db.photos.length})</button>` +
    (evCount ? `<button class="album-chip${currentLabel === EVENT_LABEL ? ' active' : ''}" data-label="${esc(EVENT_LABEL)}">📅 События (${evCount})</button>` : '') +
    (dtCount ? `<button class="album-chip${currentLabel === DATE_LABEL ? ' active' : ''}" data-label="${esc(DATE_LABEL)}">💞 Свидания (${dtCount})</button>` : '') +
    // .label-del — отдельная кнопка-СОСЕД (не вложена в .album-chip): кнопка
    // внутри кнопки — невалидный HTML, и клавиатурная активация внешней
    // кнопки не могла «дотянуться» до вложенного крестика — с клавиатуры
    // удалить лейбл было физически невозможно.
    db.labels.filter(l => !sysLabels.includes(l)).map(l => `<span class="chip-wrap"><button class="album-chip${currentLabel === l ? ' active' : ''}" data-label="${esc(l)}" title="Перетащи на фото, чтобы навесить лейбл"># ${esc(l)}</button><button type="button" class="label-del" data-label-del="${esc(l)}" title="Удалить лейбл">✕</button></span>`).join('') +
    `<button class="btn album-add-btn" data-label-new title="Создать лейбл">＋ Лейбл</button>`;
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
      ${(p.labels || []).length ? `<div class="photo-labels">${p.labels.map(l =>
        `<span class="photo-label">${esc(l)}${l === EVENT_LABEL || l === DATE_LABEL ? '' : `<button type="button" class="photo-label-del" data-label-off="${esc(l)}" data-photo-off="${p.id}" title="Убрать лейбл с фото">✕</button>`}</span>`
      ).join('')}</div>` : ''}
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
// Лейблы: удаление (фото не трогаем), добавление выбранным, создание
function deleteLabel(name) {
  if (name === EVENT_LABEL || name === DATE_LABEL) return; // служебные лейблы защищены от удаления
  db.labels = db.labels.filter(l => l !== name);
  db.photos.forEach(p => { if (p.labels) p.labels = p.labels.filter(l => l !== name); });
  if (currentLabel === name) currentLabel = '';
  selectedPhotos.clear();
  save(); renderPhotos();
}
function applyLabelToPhotos(name, ids) {
  const set = new Set(ids);
  db.photos.forEach(p => {
    if (!set.has(p.id)) return;
    if (!Array.isArray(p.labels)) p.labels = [];
    if (!p.labels.includes(name)) p.labels.push(name);
  });
}
// Применение лейбла к выбранным фото; после действия выделение снимается.
function applyLabelToSelected(name) {
  applyLabelToPhotos(name, [...selectedPhotos]);
  selectedPhotos.clear();
}
// Убрать лейбл с конкретного фото (крестик ✕ на бейдже фото).
function removeLabelFromPhoto(photoId, name) {
  const p = db.photos.find(x => x.id === photoId);
  if (!p || !Array.isArray(p.labels) || !p.labels.includes(name)) return;
  p.labels = p.labels.filter(l => l !== name);
  save(); renderPhotos();
}
function openLabelOverlay() {
  $('#labelNewName').value = '';
  const pick = $('#labelPick');
  const manualLabels = db.labels.filter(l => l !== EVENT_LABEL && l !== DATE_LABEL);
  pick.innerHTML = manualLabels.length
    ? '<option value="">— выбери лейбл —</option>' + manualLabels.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('')
    : '<option value="">Сначала создай новый лейбл выше</option>';
  const hint = $('#labelModalHint');
  if (hint) hint.textContent = selectedPhotos.size ? `Фото выбрано: ${selectedPhotos.size}` : 'Можно просто создать лейбл — он появится в фильтре.';
  $('#labelOverlay').hidden = false;
  $('#labelNewName').focus();
}
$('#selAddLabelBtn').addEventListener('click', openLabelOverlay);
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
$('#labelNewBtn').addEventListener('click', () => {
  const name = $('#labelNewName').value.trim();
  if (!name) return;
  if (!db.labels.includes(name)) db.labels.push(name);
  applyLabelToSelected(name);
  save(); $('#labelOverlay').hidden = true; renderPhotos();
});
$('#labelApplyBtn').addEventListener('click', () => {
  const name = $('#labelPick').value;
  if (!name) return;
  applyLabelToSelected(name);
  save(); $('#labelOverlay').hidden = true; renderPhotos();
});
$('#labelNewName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#labelNewBtn').click(); });
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
  if (el.closest('[data-label-del]')) return null;
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

