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
        res(cv.toDataURL('image/jpeg', 0.82));
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
      db.photos.unshift({ id: uid(), data, title: f.name, labels: [], pinned: false, ts: Date.now(), order: 0 });
    } catch (err) { console.warn('Не удалось загрузить фото', err); }
  }
  e.target.value = '';
  save(); renderPhotos();
});
function renderLabels() {
  const bar = $('#labelBar');
  if (!bar) return;
  const evCount = db.photos.filter(p => (p.labels || []).includes(EVENT_LABEL)).length;
  bar.innerHTML =
    `<button class="album-chip${currentLabel === '' ? ' active' : ''}" data-label="">🖼 Все фото (${db.photos.length})</button>` +
    (evCount ? `<button class="album-chip${currentLabel === EVENT_LABEL ? ' active' : ''}" data-label="${esc(EVENT_LABEL)}">📅 События (${evCount})</button>` : '') +
    db.labels.filter(l => l !== EVENT_LABEL).map(l => `<button class="album-chip${currentLabel === l ? ' active' : ''}" data-label="${esc(l)}" draggable="true" title="Перетащи на фото, чтобы навесить лейбл"># ${esc(l)}<span class="label-del" data-label-del="${esc(l)}" title="Удалить лейбл">✕</span></button>`).join('') +
    `<button class="btn album-add-btn" data-label-new title="Создать лейбл">＋ Лейбл</button>`;
}
function deletePhoto(id) {
  const ph = db.photos.find(x => x.id === id);
  if (ph) {
    // фото удаляется и из событий, чтобы в календаре не оставалось «мёртвых» миниатюр
    db.events.forEach(ev => {
      if (!Array.isArray(ev.photos)) return;
      ev.photos = ev.photos.filter(d => d !== ph.data);
      if (!ev.photos.length) delete ev.photos;
    });
  }
  db.photos = db.photos.filter(x => x.id !== id);
  selectedPhotos.delete(id);
  save(); renderPhotos(); renderCalendar();
}
// К каким событиям привязано фото (data) — для фильтра «год → месяц → событие»
function eventsForPhoto(data) {
  const res = [];
  for (const ev of db.events) {
    if (!Array.isArray(ev.photos) || !ev.photos.includes(data)) continue;
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
        const evs = eventsForPhoto(p.data);
        if (f.year && !evs.some(e => e.year === f.year)) return false;
        if (f.month && !evs.some(e => e.month === f.month)) return false;
        if (f.title && !evs.some(e => e.title === f.title)) return false;
        return true;
      });
    }
  }
  return list;
}
function renderPhotos() {
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
  grid.innerHTML = list.length ? list.map(p => `
    <div class="photo${p.pinned ? ' pinned' : ''}${selectedPhotos.has(p.id) ? ' selected' : ''}" data-id="${p.id}" data-drag-photo draggable="true">
      <img src="${esc(p.data)}" alt="${esc(p.title)}" data-photo="${esc(p.data)}" loading="lazy">
      <button class="sel-photo${selectedPhotos.has(p.id) ? ' active' : ''}" data-sel-photo="${p.id}" title="${selectedPhotos.has(p.id) ? 'Снять выбор' : 'Выбрать'}">${selectedPhotos.has(p.id) ? '✓' : '○'}</button>
      <button class="pin-photo${p.pinned ? ' active' : ''}" data-pin-photo="${p.id}" title="${p.pinned ? 'Открепить' : 'Закрепить'}">${p.pinned ? '⭐' : '☆'}</button>
      <button class="del-photo" data-del-photo="${p.id}" title="Удалить">✕</button>
      ${(p.labels || []).length ? `<div class="photo-labels">${p.labels.map(l =>
        `<span class="photo-label">${esc(l)}${l === EVENT_LABEL ? '' : `<span class="photo-label-del" data-label-off="${esc(l)}" data-photo-off="${p.id}" title="Убрать лейбл с фото">✕</span>`}</span>`
      ).join('')}</div>` : ''}
      ${currentLabel === EVENT_LABEL && p.title ? `<span class="photo-caption">${esc(eventFilter.title || p.title)}</span>` : ''}
    </div>`).join('')
    : '<p class="cal-tip">📷 Загрузите ваши фото — они будут храниться локально, прямо в браузере.</p>';
}
// Витрина «📅 События»: кнопки «год → месяц → событие» появляются по мере выбора
function eventPhotosCount(year, month, title) {
  let n = 0;
  for (const p of db.photos) {
    if (!(p.labels || []).includes(EVENT_LABEL)) continue;
    if (eventsForPhoto(p.data).some(e =>
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
  // события, у которых есть фото в галерее
  const evs = db.events.filter(ev => Array.isArray(ev.photos) && ev.photos.some(d => db.photos.some(p => p.data === d)));
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
  if (name === EVENT_LABEL) return; // служебный лейбл витрины «📅 События» защищён от удаления
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
  const manualLabels = db.labels.filter(l => l !== EVENT_LABEL);
  pick.innerHTML = manualLabels.length
    ? '<option value="">— выбери лейбл —</option>' + manualLabels.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('')
    : '<option value="">Сначала создай новый лейбл выше</option>';
  const hint = $('#labelModalHint');
  if (hint) hint.textContent = selectedPhotos.size ? `Фото выбрано: ${selectedPhotos.size}` : 'Можно просто создать лейбл — он появится в фильтре.';
  $('#labelOverlay').hidden = false;
  $('#labelNewName').focus();
}
$('#selAddLabelBtn').addEventListener('click', openLabelOverlay);
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
// Перетаскивание: меняем порядок внутри текущего фильтра,
// а чип лейбла, брошенный на фото, навешивает лейбл.
let dragPhotoId = null;
let dragLabel = null; // название лейбла, чип которого сейчас тащим
$('#photosGrid').addEventListener('dragstart', e => {
  const el = e.target.closest('[data-drag-photo]');
  if (!el) return;
  dragPhotoId = el.dataset.id;
  e.dataTransfer.effectAllowed = 'copyMove'; // move — перестановка, copy — лейбл
  e.dataTransfer.setData('text/plain', dragPhotoId);
});
$('#photosGrid').addEventListener('dragover', e => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; });
$('#photosGrid').addEventListener('drop', e => {
  e.preventDefault();
  if (dragLabel) { // тащили чип лейбла: навешиваем на фото (и все отмеченные)
    const target = e.target.closest('[data-drag-photo]');
    const name = dragLabel;
    dragLabel = null;
    const ids = new Set(selectedPhotos);
    if (target) ids.add(target.dataset.id);
    if (ids.size) { applyLabelToPhotos(name, ids); selectedPhotos.clear(); save(); renderPhotos(); }
    return;
  }
  if (!dragPhotoId) return;
  const target = e.target.closest('[data-drag-photo]');
  const list = filteredPhotos();
  const fromIdx = list.findIndex(p => p.id === dragPhotoId);
  const toIdx = target ? list.findIndex(p => p.id === target.dataset.id) : list.length - 1;
  dragPhotoId = null;
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
  const moved = list.splice(fromIdx, 1)[0];
  list.splice(toIdx, 0, moved);
  // пересчитываем порядок: закреплённые всегда сверху, остальные — в перетащенном порядке
  [...list.filter(p => p.pinned), ...list.filter(p => !p.pinned)].forEach((p, i) => {
    const ph = db.photos.find(x => x.id === p.id);
    if (ph) ph.order = i;
  });
  save(); renderPhotos();
});
$('#photosGrid').addEventListener('dragend', () => { dragPhotoId = null; });
// Перетаскивание фото на кнопку лейбла: лейбл получает и перетаскиваемое фото, и все отмеченные (если есть)
$('#labelBar').addEventListener('dragover', e => {
  const chip = e.target.closest('.album-chip[data-label]');
  if (!chip || e.target.closest('[data-label-del]') || !chip.dataset.label || chip.dataset.label === EVENT_LABEL) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
$('#labelBar').addEventListener('dragenter', e => {
  e.preventDefault();
  const chip = e.target.closest('.album-chip[data-label]');
  if (!chip || e.target.closest('[data-label-del]') || !chip.dataset.label || chip.dataset.label === EVENT_LABEL) return;
  chip.classList.add('drag-over');
});
// Обратное направление: чип лейбла можно перетащить прямо на фото
$('#labelBar').addEventListener('dragstart', e => {
  const chip = e.target.closest('.album-chip[data-label]');
  if (!chip || e.target.closest('[data-label-del]') || !chip.dataset.label || chip.dataset.label === EVENT_LABEL) { e.preventDefault(); return; }
  dragLabel = chip.dataset.label;
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData('text/plain', dragLabel);
});
$('#labelBar').addEventListener('dragend', () => { dragLabel = null; });
$('#labelBar').addEventListener('dragleave', e => {
  const chip = e.target.closest('.album-chip[data-label]');
  if (!chip) return;
  if (e.relatedTarget && chip.contains(e.relatedTarget)) return; // ещё внутри чипа
  chip.classList.remove('drag-over');
});
$('#labelBar').addEventListener('drop', e => {
  e.preventDefault();
  const chip = e.target.closest('.album-chip[data-label]');
  if (chip) chip.classList.remove('drag-over');
  if (!dragPhotoId) return;
  const name = chip && chip.dataset.label;
  if (!name || name === EVENT_LABEL || e.target.closest('[data-label-del]')) return;
  const targets = new Set(selectedPhotos); // массовое назначение: всем отмеченным…
  targets.add(dragPhotoId);                // …и перетаскиваемому фото
  applyLabelToPhotos(name, targets);
  dragPhotoId = null;
  selectedPhotos.clear(); // действие выполнено — выделение снимаем
  save(); renderPhotos();
});

