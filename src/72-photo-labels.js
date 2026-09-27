// Лейблы: удаление (фото не трогаем), применение/снятие, создание.
// p.labels хранит id — у служебных EVENT_LABEL/DATE_LABEL id равен имени,
// у ручных лейблов id генерируется при создании (см. labelById в renderLabels).
// Побочный эффект удаления лейбла — он снимается со всех фото, где стоял;
// это отдельные сущности (коллекция photos), поэтому отдельная запись
// (repoBatch), а не только repoDelete самого лейбла.
function deleteLabelSilent(id) {
  if (id === EVENT_LABEL || id === DATE_LABEL) return; // служебные лейблы защищены от удаления
  db.labels = db.labels.filter(l => l.id !== id);
  repoDelete('labels', id);
  const touched = db.photos.filter(p => (p.labels || []).includes(id));
  touched.forEach(p => {
    p.labels = p.labels.filter(x => x !== id);
  });
  repoBatch('photos', touched);
  if (currentLabel === id) currentLabel = '';
}
function deleteLabel(id) {
  const l = labelById(id);
  if (!l) return;
  const count = db.photos.filter(p => (p.labels || []).includes(id)).length;
  if (!confirmDelete(`Удалить лейбл «${l.name}»${count ? ` (снимется с ${count} фото)` : ''}? Это не отменить.`)) return;
  deleteLabelSilent(id);
  renderLabelManageList();
  renderPhotos();
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
    p.labels = allHave ? p.labels.filter(l => l !== id) : p.labels.includes(id) ? p.labels : [...p.labels, id];
  });
  repoBatch('photos', targets);
}
/* ---- Модалка «Лейблы»: создание, переименование, цвет, удаление ---- */
let editingLabelId = null; // id лейбла, у которого сейчас правится название
let colorPickerLabelId = null; // id лейбла с открытой палитрой цвета
function openLabelManageOverlay() {
  editingLabelId = null;
  colorPickerLabelId = null;
  $('#labelNewName').value = '';
  renderLabelManageList();
  openOverlay('labelOverlay');
  $('#labelNewName').focus();
}
function renderLabelManageList() {
  const box = $('#labelManageList');
  if (!box) return;
  if (!db.labels.length) {
    render(box, html`<p class="cal-tip">Пока нет ни одного лейбла — создай первый выше.</p>`);
    return;
  }
  render(
    box,
    html`${db.labels.map(l => {
      const count = db.photos.filter(p => (p.labels || []).includes(l.id)).length;
      const editing = editingLabelId === l.id;
      const pickerOpen = colorPickerLabelId === l.id;
      return html`<div class="label-row">
      <button type="button" class="label-dot-btn" data-label-color-toggle="${l.id}" style="background:${l.color}" title="Изменить цвет"></button>
      ${
        editing
          ? html`<input type="text" class="label-name-editor" id="labelNameEdit-${l.id}" value="${l.name}">
           <button class="mini-x" data-save-label="${l.id}" title="Сохранить" aria-label="Сохранить">${navIconHtml('check')}</button>
           <button class="mini-x" data-cancel-label title="Отмена" aria-label="Отмена">✕</button>`
          : html`<span class="label-row-name">${l.name}</span>
           <span class="label-row-count">${count} фото</span>
           <button class="mini-x" data-edit-label="${l.id}" title="Переименовать" aria-label="Переименовать">${navIconHtml('pencil')}</button>
           <button class="mini-x" data-del-label="${l.id}" title="Удалить лейбл" aria-label="Удалить лейбл">${navIconHtml('trash')}</button>`
      }
    </div>${pickerOpen ? html`<div class="label-color-picker">${LABEL_COLORS.map(c => html`<button type="button" class="label-swatch${c === l.color ? ' active' : ''}" data-label-set-color="${l.id}" data-color="${c}" style="background:${c}"></button>`)}</div>` : ''}`;
    })}`
  );
}
function startEditLabelName(id) {
  editingLabelId = id;
  colorPickerLabelId = null;
  renderLabelManageList();
}
function cancelLabelNameEdit() {
  editingLabelId = null;
  renderLabelManageList();
}
function saveLabelNameEdit(id, text) {
  const l = labelById(id);
  editingLabelId = null;
  if (!l) {
    renderLabelManageList();
    return;
  }
  const inp = $('#labelNameEdit-' + id);
  const t = (text !== undefined ? text : (inp && inp.value) || '').trim();
  if (t) {
    l.name = t;
    repoSet('labels', l);
  }
  renderLabelManageList();
  renderPhotos();
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
  repoSet('labels', l);
  renderLabelManageList();
  renderPhotos();
}
$('#labelNewBtn').addEventListener('click', () => {
  const name = $('#labelNewName').value.trim();
  if (!name) return;
  const label = { id: uid(), name, color: LABEL_COLORS[db.labels.length % LABEL_COLORS.length] };
  db.labels.push(label);
  repoSet('labels', label);
  $('#labelNewName').value = '';
  renderLabelManageList();
  renderPhotos();
  $('#labelNewName').focus();
});
$('#labelNewName').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('#labelNewBtn').click();
});

/* ---- Модалка «Применить лейблы»: чек-лист для выбранных фото / лайтбокса ---- */
let applyTargetIds = [];
function openLabelApplyOverlay(ids) {
  applyTargetIds = [...ids];
  if (!applyTargetIds.length) return;
  $('#labelApplyNewName').value = '';
  renderLabelApplyList();
  openOverlay('labelApplyOverlay');
}
function renderLabelApplyList() {
  const box = $('#labelApplyList');
  if (!box) return;
  const targets = db.photos.filter(p => applyTargetIds.includes(p.id));
  render(
    box,
    db.labels.length
      ? html`${db.labels.map(l => {
          const on = targets.length > 0 && targets.every(p => (p.labels || []).includes(l.id));
          return html`<button type="button" class="album-chip label-apply-chip${on ? ' active' : ''}" data-label-apply-toggle="${l.id}"><span class="label-dot" style="background:${l.color}"></span>${l.name}${on ? ' ✓' : ''}</button>`;
        })}`
      : html`<p class="cal-tip">Лейблов пока нет — создай ниже.</p>`
  );
}
$('#labelApplyNewBtn').addEventListener('click', () => {
  const name = $('#labelApplyNewName').value.trim();
  if (!name) return;
  const l = { id: uid(), name, color: LABEL_COLORS[db.labels.length % LABEL_COLORS.length] };
  db.labels.push(l);
  repoSet('labels', l);
  applyLabelToPhotos(l.id, applyTargetIds);
  // новый лейбл и применение его к фото — разные сущности, две записи
  repoBatch(
    'photos',
    db.photos.filter(p => applyTargetIds.includes(p.id))
  );
  $('#labelApplyNewName').value = '';
  renderLabelApplyList();
  renderPhotos();
});
$('#labelApplyNewName').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('#labelApplyNewBtn').click();
});
$('#selAddLabelBtn').addEventListener('click', () => openLabelApplyOverlay(selectedPhotos));
$('#selPinBtn').addEventListener('click', toggleSelectedPin);
$('#selDeleteBtn').addEventListener('click', deleteSelectedPhotos);
$('#selClearBtn').addEventListener('click', () => {
  selectedPhotos.clear();
  renderPhotos();
});
// Фильтр витрины «📅 События»: клик по кнопкам «год → месяц → событие» (повторный клик сбрасывает уровень)
document.addEventListener('click', e => {
  const yearBtn = e.target.closest('[data-ev-year]');
  if (yearBtn) {
    const val = yearBtn.dataset.evYear;
    eventFilter.year = eventFilter.year === val ? '' : val;
    eventFilter.month = '';
    eventFilter.title = '';
    renderPhotos();
    return;
  }
  const monthBtn = e.target.closest('[data-ev-month]');
  if (monthBtn) {
    const val = monthBtn.dataset.evMonth;
    eventFilter.month = eventFilter.month === val ? '' : val;
    eventFilter.title = '';
    renderPhotos();
    return;
  }
  const titleBtn = e.target.closest('[data-ev-title]');
  if (titleBtn) {
    const val = titleBtn.dataset.evTitle;
    eventFilter.title = eventFilter.title === val ? '' : val;
    renderPhotos();
    return;
  }
  const resetBtn = e.target.closest('[data-ev-reset]');
  if (resetBtn) {
    eventFilter = { year: '', month: '', title: '' };
    renderPhotos();
    return;
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
  if (typeof document !== 'undefined' && typeof document.elementFromPoint === 'function' && (oe.clientX !== undefined || oe.clientY !== undefined)) {
    try {
      el = document.elementFromPoint(oe.clientX, oe.clientY);
    } catch (err) {}
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
  if (photoChipHoverEl && photoChipHoverEl.classList) {
    photoChipHoverEl.classList.remove('drag-over');
    photoChipHoverEl = null;
  }
  const chip = photoDropChip(evt);
  if (chip) {
    // не реордер — навешивание лейбла. DOM-перестановку, которую уже сделал
    // Sortable во время живого драга, отдельно откатывать не нужно: renderPhotos()
    // ниже перерисовывает сетку целиком синхронно, до первой отрисовки браузера —
    // промежуточное состояние DOM никогда не попадает на экран.
    const targets = new Set(selectedPhotos); // массовое назначение: всем отмеченным…
    targets.add(evt.item.dataset.id); // …и перетаскиваемому фото
    applyLabelToPhotos(chip.dataset.label, targets);
    selectedPhotos.clear(); // действие выполнено — выделение снимаем
    repoBatch(
      'photos',
      db.photos.filter(p => targets.has(p.id))
    );
    renderPhotos();
    return;
  }
  // обычный реордер: порядок из текущего DOM-порядка сетки, закреплённые сверху
  const domIds = [...evt.to.children].filter(c => c.classList && c.classList.contains('photo')).map(c => c.dataset.id);
  const list = domIds.map(id => db.photos.find(p => p.id === id)).filter(Boolean);
  const reordered = [...list.filter(p => p.pinned), ...list.filter(p => !p.pinned)];
  reordered.forEach((p, i) => {
    p.order = i;
  });
  repoBatch('photos', reordered);
  renderPhotos();
}
if (typeof Sortable !== 'undefined') {
  Sortable.create($('#photosGrid'), {
    handle: '.photo-drag',
    forceFallback: true,
    fallbackOnBody: true,
    animation: 150,
    scroll: true,
    scrollSensitivity: 80,
    scrollSpeed: 20,
    onStart() {
      document.addEventListener('pointermove', photoChipHoverCheck);
    },
    onEnd: photosSortEnd
  });
}
// Чип лейбла → фото (обратное направление) — см. 05-dnd.js/chipDragSetup.
chipDragSetup($('#labelBar'));
