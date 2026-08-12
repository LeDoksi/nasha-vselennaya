/* ===== Списки ===== */
let editingSubtask = null; // {listId, itemId} в режиме инлайн-правки, иначе null
let editingListId = null;  // id списка, у которого сейчас правится название, иначе null
function listItemHTML(listId, it) {
  const editing = editingSubtask && editingSubtask.listId === listId && editingSubtask.itemId === it.id;
  return `<li class="${it.done ? 'done' : ''}" data-item="${esc(it.id)}">
    <button class="drag-handle subtask-drag" data-item-drag="${esc(it.id)}" title="Перетащить">⠿</button>
    <button class="check" data-toggle-item="${listId}" data-id="${it.id}" title="Готово">${it.done ? '✅' : '○'}</button>
    ${editing
      ? `<input type="text" class="subtask-editor" id="subtaskEdit-${esc(it.id)}" value="${esc(it.text)}">
         <button class="mini-x" data-save-item="${listId}" data-id="${it.id}" title="Сохранить">💜</button>
         <button class="mini-x" data-cancel-item title="Отмена">✕</button>`
      : `<span>${esc(it.text)}</span>
         <button class="mini-x" data-edit-item="${listId}" data-id="${it.id}" title="Редактировать">✏️</button>
         <button class="mini-x" data-del-item="${listId}" data-id="${it.id}" title="Удалить">✕</button>`}
  </li>`;
}
function startEditSubtask(listId, itemId) { editingSubtask = { listId, itemId }; renderLists(); }
function cancelSubtaskEdit() { editingSubtask = null; renderLists(); }
function saveSubtaskEdit(listId, itemId, text) {
  const list = db.lists.find(x => x.id === listId);
  const it = list && list.items.find(x => x.id === itemId);
  editingSubtask = null;
  if (!it) { renderLists(); return; }
  const inp = $('#subtaskEdit-' + itemId);
  const t = (text !== undefined ? text : (inp && inp.value) || '').trim();
  if (t) it.text = t;
  save(); renderLists();
}
// Редактирование названия списка — в отличие от подзадачи, список пересоздать
// (удалить+создать) нельзя без потери ВСЕХ подзадач, поэтому у него есть
// собственное переименование, а не только у подзадач.
function startEditListName(listId) { editingListId = listId; renderLists(); }
function cancelListNameEdit() { editingListId = null; renderLists(); }
function saveListNameEdit(listId, text) {
  const list = db.lists.find(x => x.id === listId);
  editingListId = null;
  if (!list) { renderLists(); return; }
  const inp = $('#listNameEdit-' + listId);
  const t = (text !== undefined ? text : (inp && inp.value) || '').trim();
  if (t) list.name = t;
  save(); renderLists();
}
// Выполненные подзадачи всегда внизу списка: устойчивая сортировка —
// внутри групп (невыполненные/выполненные) относительный порядок сохраняется.
function sortListItems(items) {
  return [...items].sort((a, b) => Number(!!a.done) - Number(!!b.done));
}
function renderLists() {
  const wrap = $('#listsWrap');
  if (!wrap) return;
  if (!db.lists.length) {
    wrap.innerHTML = '<div class="empty-state rem-empty">Пока нет ни одного списка 🫧<br>Создайте первый — например, «Подарки на 8 марта».</div>';
    return;
  }
  wrap.innerHTML = db.lists.map(list => {
    const active = list.items.filter(i => !i.done).length;
    const editingName = editingListId === list.id;
    const items = list.items.length
      ? sortListItems(list.items).map(it => listItemHTML(list.id, it)).join('')
      : '<li class="empty-li">Пока пусто 🫧</li>';
    return `<div class="list-card" data-id="${list.id}">
      <div class="list-head">
        ${editingName
          ? `<input type="text" class="list-name-editor" id="listNameEdit-${esc(list.id)}" value="${esc(list.name)}">
             <button class="mini-x" data-save-list="${list.id}" title="Сохранить">💜</button>
             <button class="mini-x" data-cancel-list title="Отмена">✕</button>`
          : `<h3>${esc(list.name)} <small class="list-count">${active} в работе</small></h3>
             <button class="mini-x" data-edit-list="${list.id}" title="Переименовать список">✏️</button>`}
        <button class="drag-handle list-drag" data-list-drag="${list.id}" title="Перетащить">⠿</button>
      </div>
      <div class="list-add">
        <input type="text" id="listInput-${list.id}" placeholder="Добавить подзадачу…">
        <button class="btn" data-list-add="${list.id}" title="Добавить">＋</button>
      </div>
      <ul class="items" id="listItems-${list.id}">${items}</ul>
      <div class="list-actions">
        <button class="btn btn-danger btn-small" data-list-complete="${list.id}" title="Выполнить все подзадачи и удалить список">✔ Выполнить список</button>
      </div>
    </div>`;
  }).join('');
  initSubtaskSortables();
}
// Точечное обновление подзадач ОДНОГО списка (без перерисовки всех карточек): в DOM
// переезжают только существующие <li> — FLIP-анимация плавно показывает, как
// выполненная подзадача уезжает вниз. Полный renderLists остаётся для структурных
// изменений (создание/удаление списка).
function refreshListCard(listId) {
  const card = [...document.querySelectorAll('.list-card')].find(c => c.dataset.id === listId);
  if (card) {
    const list = db.lists.find(l => l.id === listId);
    if (list) {
      const small = card.querySelector && card.querySelector('h3 small');
      if (small) small.textContent = list.items.filter(i => !i.done).length + ' в работе';
    }
  }
  renderListItems(listId);
}
function renderListItems(listId) {
  const list = db.lists.find(x => x.id === listId);
  const ul = $('#listItems-' + listId);
  if (!list || !ul || !ul.querySelectorAll || typeof document.createElement !== 'function') { renderLists(); return; }
  const before = new Map();
  const oldItems = new Map();
  [...ul.querySelectorAll('li')].forEach(li => {
    if (li.dataset && li.dataset.item) {
      before.set(li, li.getBoundingClientRect());
      oldItems.set(li.dataset.item, li);
    }
  });
  const sorted = sortListItems(list.items);
  const keep = [];
  if (sorted.length) {
    for (const it of sorted) {
      let li = oldItems.get(it.id);
      if (li) {
        li.classList.toggle('done', !!it.done);
        const check = li.querySelector && li.querySelector('.check');
        if (check) check.textContent = it.done ? '✅' : '○';
      } else {
        li = document.createElement('li');
        li.innerHTML = listItemHTML(list.id, it);
        if (li.dataset) li.dataset.item = it.id; // для мини-DOM без парсинга innerHTML
      }
      keep.push(li);
    }
  }
  // убираем узлы, которых больше нет (удалённые подзадачи / пустое состояние)
  [...ul.querySelectorAll('li')].forEach(li => { if (keep.indexOf(li) < 0) li.remove(); });
  // выстраиваем в правильном порядке (appendChild перемещает существующий узел)
  keep.forEach(li => { if (li.remove) li.remove(); ul.appendChild(li); });
  if (!sorted.length) {
    const empty = document.createElement('li');
    empty.classList.add('empty-li');
    empty.textContent = 'Пока пусто 🫧';
    ul.appendChild(empty);
  }
  listFlipAnimate(ul, before);
}
// FLIP: элементы, чьи координаты изменились, «переезжают» через transform (CSS transition)
function listFlipAnimate(scope, before) {
  if (typeof requestAnimationFrame === 'undefined' || !scope || !before || !scope.children) return;
  const moving = [];
  [...scope.children].forEach(el => {
    if (!before.has(el)) return;
    const r1 = before.get(el);
    const r2 = el.getBoundingClientRect();
    const dx = r1.left - r2.left, dy = r1.top - r2.top;
    if (!dx && !dy) return;
    if (!el.style) el.style = {};
    el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    moving.push(el);
  });
  if (!moving.length) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    moving.forEach(el => { el.style.transform = ''; });
  }));
}

// Создать список с произвольным названием; возвращает список или null.
function createList(rawName) {
  const name = String(rawName || '').trim();
  if (!name) return null;
  const list = { id: uid(), name, items: [] };
  db.lists.unshift(list); // новый список — сверху
  save(); renderLists();
  const inp = $('#listNameInput');
  if (inp) inp.value = '';
  return list;
}
function addListSubtask(listId, inputId) {
  const list = db.lists.find(x => x.id === listId);
  if (!list) return false;
  const inp = $('#' + inputId);
  const text = (inp && inp.value ? String(inp.value) : '').trim();
  if (!text) return false;
  list.items.unshift({ id: uid(), text, done: false });
  save(); if (inp) inp.value = '';
  refreshListCard(listId);
  return true;
}
function toggleSubtask(listId, itemId) {
  const list = db.lists.find(x => x.id === listId);
  if (!list) return false;
  const it = list.items.find(x => x.id === itemId);
  if (!it) return false;
  it.done = !it.done;
  list.items = sortListItems(list.items); // выполненные — вниз
  save(); refreshListCard(listId);
  // мини-«поп» галочки у переключённой подзадачи (анимация в CSS)
  const ul = $('#listItems-' + listId);
  const li = ul && ul.querySelector ? ul.querySelector('[data-item="' + itemId + '"]') : null;
  if (li) {
    li.classList.add('just-toggled');
    setTimeout(() => { if (li.classList.remove) li.classList.remove('just-toggled'); }, 400);
  }
  return it.done;
}
function delSubtask(listId, itemId) {
  const list = db.lists.find(x => x.id === listId);
  if (!list) return false;
  list.items = list.items.filter(x => x.id !== itemId);
  save(); refreshListCard(listId);
  return true;
}
// «Выполнить список»: после подтверждения удаляет весь блок вместе с подзадачами.
function completeList(listId) {
  const list = db.lists.find(x => x.id === listId);
  if (!list) return false;
  if (!confirm('Выполнить список «' + list.name + '»? Он будет удалён вместе с подзадачами.')) return false;
  db.lists = db.lists.filter(x => x.id !== listId);
  save(); renderLists();
  return true;
}

// Перетаскивание карточек списков — SortableJS (forceFallback: нативный HTML5
// DnD не поддерживает тач). Порядок — сам массив db.lists (без отдельного
// order-поля), как и раньше.
function listsSortEnd(evt) {
  db.lists = [...evt.to.children]
    .filter(c => c.classList && c.classList.contains('list-card'))
    .map(c => db.lists.find(l => l.id === c.dataset.id)).filter(Boolean);
  save();
}
if (typeof Sortable !== 'undefined') {
  Sortable.create($('#listsWrap'), {
    handle: '.list-drag', forceFallback: true, fallbackOnBody: true, animation: 150,
    scroll: true, scrollSensitivity: 80, scrollSpeed: 20,
    onEnd: listsSortEnd
  });
}

// Перетаскивание подзадач внутри списка — новая фича (раньше подзадачи можно
// было только переключать/удалять, ручного порядка не было). Порядок — позиция
// в list.items, тот же паттерн, что у db.lists выше: отдельного order-поля нет,
// схему/DB_VERSION трогать не нужно. sortListItems() (стабильная сортировка по
// done) применяется поверх при каждом рендере — ручной порядок внутри групп
// «не выполнено»/«выполнено» стабильностью сортировки не портится.
// Один Sortable-инстанс на каждую карточку списка — своя <ul>, свой Map-реестр,
// чтобы при полной перерисовке #listsWrap (renderLists) не плодить дубли.
const subtaskSortables = new Map(); // listId -> Sortable instance
function subtaskSortEnd(listId, evt) {
  const list = db.lists.find(l => l.id === listId);
  if (!list) return;
  const items = [...evt.to.children]
    .filter(li => li.dataset && li.dataset.item)
    .map(li => list.items.find(it => it.id === li.dataset.item))
    .filter(Boolean);
  if (items.length === list.items.length) list.items = items;
  save();
}
function initSubtaskSortables() {
  if (typeof Sortable === 'undefined') return;
  subtaskSortables.forEach(inst => { if (inst && inst.destroy) inst.destroy(); });
  subtaskSortables.clear();
  document.querySelectorAll('.list-card').forEach(card => {
    const listId = card.dataset.id;
    const ul = card.querySelector ? card.querySelector('.items') : null;
    if (!listId || !ul) return;
    subtaskSortables.set(listId, Sortable.create(ul, {
      handle: '.subtask-drag', filter: '.empty-li', forceFallback: true, fallbackOnBody: true, animation: 150,
      scroll: true, scrollSensitivity: 80, scrollSpeed: 20,
      onEnd: evt => subtaskSortEnd(listId, evt)
    }));
  });
}

$('#listCreateBtn').addEventListener('click', () => createList($('#listNameInput').value));
$('#listNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') createList($('#listNameInput').value); });

/* ===== Хотелки (общие, но разделены по людям: у каждого свой список) ===== */
let wishPhotoData = null;
function fmtWishDate(ts) {
  try { return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch (e) { return ''; }
}
// «Исполнено другим»: свою хотелку исполнить нельзя — только партнёр.
// Снять отметку может только тот, кто её поставил.
function wishToggleHTML(w) {
  const me = getUser();
  if (w.done) {
    return w.doneBy === me
      ? `<button class="check" data-wish-done="${w.id}" title="Снять отметку">↩️</button>`
      : '';
  }
  if (w.owner === me) return `<span class="wish-hint">Только ${me === 'gosha' ? 'Даша' : 'Гоша'} исполнит 💜</span>`;
  return `<button class="check" data-wish-done="${w.id}" title="Исполнить!">○</button>`;
}
function wishCard(w) {
  const doneBy = w.doneBy ? (w.doneBy === 'gosha' ? 'Гошей' : 'Дашей') : '';
  // Фото хотелки — в photoStore под своим id (не в общей галерее, см. lbPhoto()
  // в 85-lightbox.js). Каркас + асинхронная дозаливка src — как у остальной
  // галереи, кэш миниатюр мог ещё не прогреться.
  const wPhotoSrc = w.photoId ? photoSrc({ id: w.photoId }) : '';
  return `<div class="wish${w.done ? ' done' : ''}">
    ${w.photoId
      ? `<img class="wish-img"${wPhotoSrc ? ' src="' + esc(wPhotoSrc) + '"' : ' data-photo-src="' + esc(w.photoId) + '"'} alt="${esc(w.text)}" data-photo="${esc(w.photoId)}" loading="lazy">`
      : `<div class="wish-img" style="display:grid;place-items:center;font-size:34px">💝</div>`}
    <div class="wish-body">
      <div class="wish-title">${esc(w.text)}</div>
      ${w.done ? `<span class="wish-done-by">💜 Исполнено${doneBy ? ' ' + doneBy : ''}${w.doneAt ? ' · ' + fmtWishDate(w.doneAt) : ''}</span>` : ''}
      ${w.link ? `<a class="wish-link" href="${safeUrl(w.link)}" target="_blank" rel="noopener">🔗 Открыть ссылку</a>` : ''}
      <div class="wish-btns">
        ${wishToggleHTML(w)}
        <button class="mini-x" data-edit-wish="${w.id}" title="Изменить">✏️</button>
        <button class="mini-x" data-wish-del="${w.id}" title="Удалить">✕</button>
      </div>
    </div>
  </div>`;
}
function renderWishlist() {
  const grid = $('#wishlistGrid');
  if (!grid) return;
  const byOwner = who => [...db.wishlist].filter(w => w.owner === who).sort((a, b) => (a.done - b.done) || (b.ts - a.ts));
  const sec = (who, label, emoji, empty) =>
    `<div class="wish-section"><h4>${esc(emoji)} Хотелки ${label}</h4>
      ${byOwner(who).length ? `<div class="wishlist-grid">${byOwner(who).map(wishCard).join('')}</div>` : `<p class="cal-tip">${empty}</p>`}
    </div>`;
  grid.innerHTML =
    sec('gosha', 'Гоши', '👦', 'Пока пусто. Нажми «Добавить» — мечты должны сбываться ✨') +
    sec('dasha', 'Даши', '👧', 'Пока пусто. Нажми «Добавить» — мечты должны сбываться ✨');
  if (typeof hydratePhotoImgs === 'function') hydratePhotoImgs(grid);
}
let editingWishId = null;
// id — только настоящая строка (клик по «＋ Добавить» передаёт MouseEvent).
function openWishModal(id) {
  editingWishId = typeof id === 'string' ? id : null;
  const wish = editingWishId ? db.wishlist.find(x => x.id === editingWishId) : null;
  const title = $('#wishModalTitle');
  if (title) title.textContent = wish ? '✏️ Изменить хотелку' : '🎁 Хотелка';
  wishPhotoData = null; // новое фото выбирается заново; старое (wish.photoId) остаётся, если не тронуть выбор
  $('#wishText').value = wish ? wish.text : '';
  $('#wishLink').value = wish ? (wish.link || '') : '';
  $('#wishPhotoName').textContent = wish && wish.photoId ? '✅ фото уже есть — выбери новое, чтобы заменить' : '';
  $('#wishPhoto').value = '';
  $('#wishOverlay').hidden = false;
  $('#wishText').focus();
}
$('#addWishBtn').addEventListener('click', () => openWishModal());
$('#wishPhoto').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try { wishPhotoData = await readFile(f); $('#wishPhotoName').textContent = '✅ фото готово'; }
  catch (err) { $('#wishPhotoName').textContent = 'не вышло :('; }
});
// Хотелка всегда в список вошедшего — выбора «для кого» нет.
// Фото хотелки — в photoStore (IndexedDB), как и остальные фото, а не сырым
// base64 в самом db (зашифрованный сейф в localStorage, лимит ~5 МБ — при
// нескольких хотелках с фото сохранение могло молча не пройти). В db.photos
// (общую галерею) НЕ попадает — хотелки показывают своё фото только у себя.
async function saveWishFromModal() {
  const text = $('#wishText').value.trim();
  if (!text) { alert('Напиши, что хочешь 💜'); return; }
  let photoId = null;
  if (wishPhotoData && photoStore) {
    try {
      const blob = dataUrlToBlob(wishPhotoData);
      if (blob) {
        photoId = uid();
        let thumb = null;
        try { thumb = await makeThumbBlob(wishPhotoData, 256); } catch (e) {}
        await photoStore.put(photoId, blob, thumb, { type: blob.type || 'image/webp', title: text, size: blob.size });
      }
    } catch (e) { console.warn('Не удалось сохранить фото хотелки', e); }
  }
  const existing = editingWishId ? db.wishlist.find(x => x.id === editingWishId) : null;
  if (existing) {
    // Владелец/статус «исполнено» правка не трогает — только текст/ссылку/фото.
    existing.text = text;
    existing.link = $('#wishLink').value.trim() || '';
    if (photoId) existing.photoId = photoId; // новое фото выбрано — заменяем; иначе старое остаётся
    editingWishId = null;
  } else {
    const wish = { id: uid(), text, link: $('#wishLink').value.trim() || '', owner: getUser(), done: false, ts: Date.now() };
    if (photoId) wish.photoId = photoId;
    db.wishlist.unshift(wish);
  }
  save(); $('#wishOverlay').hidden = true; renderWishlist();
  if (typeof schedulePhotoSync === 'function') schedulePhotoSync();
}
$('#wishSave').addEventListener('click', saveWishFromModal);

// Отметить свидание «прошло» / снять отметку (кнопка есть на главной и в календаре).
function toggleDateDone(id) {
  const d = db.dates.find(x => x.id === id);
  if (!d) return false;
  d.done = !d.done;
  save(); renderHome(); renderCalendar();
  return d.done;
}

/* ===== Глобальные клики ===== */
function closeOverlay(id) {
  $('#' + id).hidden = true;
  if (id === 'lightbox') lbResetState(); // светбокс закрыт — сбрасываем список и зум
  if (id === 'eventOverlay') editingEventId = null;
  // Закрыли не ответив — запоминаем на время сессии, чтобы не всплывало
  // повторно при каждом заходе на главную (см. src/30-home.js).
  if (id === 'dateInviteOverlay') markInvitesDismissed(pendingDateInvites().map(d => d.id));
}
document.addEventListener('click', e => {
  const userBtn = e.target.closest('[data-user]');
  if (userBtn) { setUser(userBtn.dataset.user); return; }

  const day = e.target.closest('[data-day]');
  if (day) { selectedDate = day.dataset.day; renderCalendar(); return; }

  const delEv = e.target.closest('[data-del-event]');
  if (delEv) {
    if (!confirmDelete('Удалить событие? Это не отменить.')) return;
    db.events = db.events.filter(x => x.id !== delEv.dataset.delEvent); save(); renderCalendar(); renderHome(); return;
  }

  const editEv = e.target.closest('[data-edit-event]');
  if (editEv) { openEventModal(editEv.dataset.editEvent); return; }

  const editDt = e.target.closest('[data-edit-date]');
  if (editDt) { openDateModal(editDt.dataset.editDate); return; }

  const openInvites = e.target.closest('[data-open-invites]');
  if (openInvites) { openDateInviteOverlay(); return; }

  const photoEv = e.target.closest('[data-photo-event]');
  if (photoEv) { addEventPhotoQuick(photoEv.dataset.photoEvent); return; }

  const photoDate = e.target.closest('[data-photo-date]');
  if (photoDate) { addDatePhotoQuick(photoDate.dataset.photoDate); return; }

  const answerDate = e.target.closest('[data-answer-date]');
  if (answerDate) {
    const d = db.dates.find(x => x.id === answerDate.dataset.answerDate);
    if (d) {
      const who = getUser();
      const val = answerDate.dataset.answer;
      d.responses = d.responses || {};
      d.responses[who] = d.responses[who] === val ? null : val;
      if (d.responses.gosha === 'yes' && d.responses.dasha === 'yes') celebrate(); // оба согласились — салют!
      save(); renderHome(); renderCalendar();
    }
    return;
  }
  const doneDate = e.target.closest('[data-done-date]');
  if (doneDate) { toggleDateDone(doneDate.dataset.doneDate); return; }
  const delDate = e.target.closest('[data-del-date]');
  if (delDate) {
    if (!confirmDelete('Удалить свидание? Это не отменить.')) return;
    db.dates = db.dates.filter(x => x.id !== delDate.dataset.delDate); save(); renderHome(); renderCalendar(); return;
  }

  const pinNote = e.target.closest('[data-pin-note]');
  if (pinNote) { togglePinNote(pinNote.dataset.pinNote); return; }
  const delNote = e.target.closest('[data-del-note]');
  if (delNote) { deleteNote(delNote.dataset.delNote); return; }
  const editNote = e.target.closest('[data-edit-note]');
  if (editNote) { startEditNote(editNote.dataset.editNote); return; }
  const saveNoteBtn = e.target.closest('[data-save-note]');
  if (saveNoteBtn) { saveNoteEdit(saveNoteBtn.dataset.saveNote); return; }
  const cancelNoteBtn = e.target.closest('[data-cancel-note]');
  if (cancelNoteBtn) { cancelNoteEdit(); return; }

  const togItem = e.target.closest('[data-toggle-item]');
  if (togItem) { toggleSubtask(togItem.dataset.toggleItem, togItem.dataset.id); return; }
  const delItem = e.target.closest('[data-del-item]');
  if (delItem) { delSubtask(delItem.dataset.delItem, delItem.dataset.id); return; }
  const editItem = e.target.closest('[data-edit-item]');
  if (editItem) { startEditSubtask(editItem.dataset.editItem, editItem.dataset.id); return; }
  const saveItemBtn = e.target.closest('[data-save-item]');
  if (saveItemBtn) { saveSubtaskEdit(saveItemBtn.dataset.saveItem, saveItemBtn.dataset.id); return; }
  const cancelItemBtn = e.target.closest('[data-cancel-item]');
  if (cancelItemBtn) { cancelSubtaskEdit(); return; }
  const listAdd = e.target.closest('[data-list-add]');
  if (listAdd) { addListSubtask(listAdd.dataset.listAdd, 'listInput-' + listAdd.dataset.listAdd); return; }
  const listDone = e.target.closest('[data-list-complete]');
  if (listDone) { completeList(listDone.dataset.listComplete); return; }
  const editList = e.target.closest('[data-edit-list]');
  if (editList) { startEditListName(editList.dataset.editList); return; }
  const saveListBtn = e.target.closest('[data-save-list]');
  if (saveListBtn) { saveListNameEdit(saveListBtn.dataset.saveList); return; }
  const cancelListBtn = e.target.closest('[data-cancel-list]');
  if (cancelListBtn) { cancelListNameEdit(); return; }

  const photoSelectToggle = e.target.closest('[data-photo-select-toggle]');
  if (photoSelectToggle) { togglePhotoSelectMode(); return; }
  const photoReorderToggle = e.target.closest('[data-photo-reorder-toggle]');
  if (photoReorderToggle) { togglePhotoReorderMode(); return; }
  const selPhoto = e.target.closest('[data-sel-photo]');
  if (selPhoto) {
    const id = selPhoto.dataset.selPhoto;
    if (selectedPhotos.has(id)) selectedPhotos.delete(id); else selectedPhotos.add(id);
    renderPhotos(); return;
  }
  const photo = e.target.closest('[data-photo]');
  if (photo) { openLightboxFrom(photo); return; }

  const wishDone = e.target.closest('[data-wish-done]');
  if (wishDone) {
    const w = db.wishlist.find(x => x.id === wishDone.dataset.wishDone);
    if (w) {
      const me = getUser();
      // Исполнить может только партнёр; снять отметку — только исполнивший.
      if (w.owner !== me && (!w.done || w.doneBy === me)) {
        if (w.done) { w.done = false; w.doneBy = null; w.doneAt = null; }
        else { w.done = true; w.doneBy = me; w.doneAt = Date.now(); }
        save();
      }
      renderWishlist();
    }
    return;
  }
  const editWish = e.target.closest('[data-edit-wish]');
  if (editWish) { openWishModal(editWish.dataset.editWish); return; }
  const wishDel = e.target.closest('[data-wish-del]');
  if (wishDel) {
    if (!confirmDelete('Удалить хотелку? Это не отменить.')) return;
    db.wishlist = db.wishlist.filter(x => x.id !== wishDel.dataset.wishDel); save(); renderWishlist(); return;
  }

  const labelOff = e.target.closest('[data-label-off]');
  if (labelOff) { removeLabelFromPhoto(labelOff.dataset.photoOff, labelOff.dataset.labelOff); return; }

  const labelNew = e.target.closest('[data-label-new]');
  if (labelNew) { openLabelManageOverlay(); return; }
  const labelChip = e.target.closest('[data-label]');
  if (labelChip) {
    currentLabel = labelChip.dataset.label; eventFilter = { year: '', month: '', title: '' }; renderPhotos(); return;
  }

  const labelColorToggle = e.target.closest('[data-label-color-toggle]');
  if (labelColorToggle) { toggleLabelColorPicker(labelColorToggle.dataset.labelColorToggle); return; }
  const labelSetColor = e.target.closest('[data-label-set-color]');
  if (labelSetColor) { setLabelColor(labelSetColor.dataset.labelSetColor, labelSetColor.dataset.color); return; }
  const editLabel = e.target.closest('[data-edit-label]');
  if (editLabel) { startEditLabelName(editLabel.dataset.editLabel); return; }
  const saveLabelBtn = e.target.closest('[data-save-label]');
  if (saveLabelBtn) { saveLabelNameEdit(saveLabelBtn.dataset.saveLabel); return; }
  const cancelLabelBtn = e.target.closest('[data-cancel-label]');
  if (cancelLabelBtn) { cancelLabelNameEdit(); return; }
  const delLabelBtn = e.target.closest('[data-del-label]');
  if (delLabelBtn) { deleteLabel(delLabelBtn.dataset.delLabel); return; }
  const applyToggle = e.target.closest('[data-label-apply-toggle]');
  if (applyToggle) { toggleLabelOnPhotos(applyToggle.dataset.labelApplyToggle, applyTargetIds); renderLabelApplyList(); renderPhotos(); return; }

  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) { closeOverlay(closeBtn.dataset.close); return; }
  if (e.target.classList && e.target.classList.contains('overlay')) closeOverlay(e.target.id);
});
// Двойной клик по подзадаче — как ✏️ (пара с редактированием заметок)
const listsWrapEl = $('#listsWrap');
if (listsWrapEl) listsWrapEl.addEventListener('dblclick', e => {
  const li = e.target.closest('li[data-item]');
  if (!li || e.target.closest('.check, .drag-handle, button, input')) return;
  const card = li.closest('.list-card');
  if (card) startEditSubtask(card.dataset.id, li.dataset.item);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const open = document.querySelector('.overlay:not([hidden])');
    if (open) closeOverlay(open.id);
    return;
  }
  // Списки: Enter в поле подзадачи добавляет её
  if (e.key === 'Enter' && e.target && e.target.id && e.target.id.indexOf('listInput-') === 0) {
    e.preventDefault();
    addListSubtask(e.target.id.slice('listInput-'.length), e.target.id);
    return;
  }
  // Списки: Enter в поле правки подзадачи — сохранить
  if (e.key === 'Enter' && e.target && e.target.id && e.target.id.indexOf('subtaskEdit-') === 0 && editingSubtask) {
    e.preventDefault();
    saveSubtaskEdit(editingSubtask.listId, editingSubtask.itemId);
    return;
  }
  // Списки: Enter в поле правки названия списка — сохранить
  if (e.key === 'Enter' && e.target && e.target.id && e.target.id.indexOf('listNameEdit-') === 0 && editingListId) {
    e.preventDefault();
    saveListNameEdit(editingListId);
    return;
  }
  // Лейблы: Enter в поле переименования — сохранить
  if (e.key === 'Enter' && e.target && e.target.id && e.target.id.indexOf('labelNameEdit-') === 0 && editingLabelId) {
    e.preventDefault();
    saveLabelNameEdit(editingLabelId);
    return;
  }
  // Календарь: Enter / пробел на дне — как клик по ячейке
  if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.closest) {
    const day = e.target.closest('[data-day]');
    if (day) { e.preventDefault(); selectedDate = day.dataset.day; renderCalendar(); }
  }
});

