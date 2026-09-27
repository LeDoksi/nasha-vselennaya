/* ===== Списки ===== */
let editingSubtask = null; // {listId, itemId} в режиме инлайн-правки, иначе null
let editingListId = null; // id списка, у которого сейчас правится название, иначе null
function listItemHTML(listId, it) {
  const editing = editingSubtask && editingSubtask.listId === listId && editingSubtask.itemId === it.id;
  return html`<li class="${it.done ? 'done' : ''}" data-item="${it.id}">
    <button class="drag-handle subtask-drag" data-item-drag="${it.id}" title="Перетащить">⠿</button>
    <button class="check" data-toggle-item="${listId}" data-id="${it.id}" title="${it.done ? 'Вернуть в работу' : 'Готово'}" aria-pressed="${String(!!it.done)}"></button>
    ${
      editing
        ? html`<input type="text" class="subtask-editor" id="subtaskEdit-${it.id}" value="${it.text}">
         <button class="mini-x" data-save-item="${listId}" data-id="${it.id}" title="Сохранить" aria-label="Сохранить">${navIconHtml('check')}</button>
         <button class="mini-x" data-cancel-item title="Отмена" aria-label="Отмена">✕</button>`
        : html`<span>${it.text}</span>
         <button class="mini-x" data-edit-item="${listId}" data-id="${it.id}" title="Редактировать" aria-label="Редактировать">${navIconHtml('pencil')}</button>
         <button class="mini-x" data-del-item="${listId}" data-id="${it.id}" title="Удалить" aria-label="Удалить">${navIconHtml('trash')}</button>`
    }
  </li>`;
}
function startEditSubtask(listId, itemId) {
  editingSubtask = { listId, itemId };
  renderLists();
}
function cancelSubtaskEdit() {
  editingSubtask = null;
  renderLists();
}
function saveSubtaskEdit(listId, itemId, text) {
  const list = db.lists.find(x => x.id === listId);
  const it = list && list.items.find(x => x.id === itemId);
  editingSubtask = null;
  if (!it) {
    renderLists();
    return;
  }
  const inp = $('#subtaskEdit-' + itemId);
  const t = (text !== undefined ? text : (inp && inp.value) || '').trim();
  if (t) it.text = t;
  repoSet('lists', list); // подзадача живёт внутри документа списка — пишем список целиком
  renderLists();
}
// Редактирование названия списка — в отличие от подзадачи, список пересоздать
// (удалить+создать) нельзя без потери ВСЕХ подзадач, поэтому у него есть
// собственное переименование, а не только у подзадач.
function startEditListName(listId) {
  editingListId = listId;
  renderLists();
}
function cancelListNameEdit() {
  editingListId = null;
  renderLists();
}
function saveListNameEdit(listId, text) {
  const list = db.lists.find(x => x.id === listId);
  editingListId = null;
  if (!list) {
    renderLists();
    return;
  }
  const inp = $('#listNameEdit-' + listId);
  const t = (text !== undefined ? text : (inp && inp.value) || '').trim();
  if (t) list.name = t;
  repoSet('lists', list);
  renderLists();
}
// Выполненные подзадачи всегда внизу списка: устойчивая сортировка —
// внутри групп (невыполненные/выполненные) относительный порядок сохраняется.
function sortListItems(items) {
  return [...items].sort((a, b) => Number(!!a.done) - Number(!!b.done));
}
function listCardHTML(list) {
  const active = list.items.filter(i => !i.done).length;
  const editingName = editingListId === list.id;
  const items = list.items.length ? sortListItems(list.items).map(it => listItemHTML(list.id, it)) : html`<li class="empty-li">Пока пусто</li>`;
  return html`<div class="list-card" data-id="${list.id}">
      <div class="list-head">
        ${
          editingName
            ? html`<input type="text" class="list-name-editor" id="listNameEdit-${list.id}" value="${list.name}">
             <button class="mini-x" data-save-list="${list.id}" title="Сохранить" aria-label="Сохранить">${navIconHtml('check')}</button>
             <button class="mini-x" data-cancel-list title="Отмена" aria-label="Отмена">✕</button>`
            : html`<h3>${list.name} <small class="list-count">${active} в работе</small></h3>
             <button class="mini-x" data-edit-list="${list.id}" title="Переименовать список" aria-label="Переименовать список">${navIconHtml('pencil')}</button>`
        }
        <button class="drag-handle list-drag" data-list-drag="${list.id}" title="Перетащить">⠿</button>
      </div>
      <div class="list-add">
        <input type="text" id="listInput-${list.id}" placeholder="Добавить подзадачу…">
        <button class="btn" data-list-add="${list.id}" title="Добавить">＋</button>
      </div>
      <ul class="items" id="listItems-${list.id}">${items}</ul>
      <div class="list-actions">
        <button class="btn btn-ghost btn-sm" data-list-complete="${list.id}" title="Выполнить все подзадачи и удалить список">Выполнить список</button>
      </div>
    </div>`;
}
function renderLists() {
  const wrap = $('#listsWrap');
  if (!wrap) return;
  if (!db.lists.length) {
    render(wrap, html`<div class="empty-state rem-empty">Пока нет ни одного списка 🫧<br>Создайте первый — например, «Подарки на 8 марта».</div>`);
    return;
  }
  // Сортируем по order (как renderNotes) — сам db.lists может прийти из
  // Firestore в произвольном порядке документов, order — единственный
  // источник истины для позиции карточки.
  const sorted = [...db.lists].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
  render(wrap, html`${sorted.map(listCardHTML)}`);
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
  if (!list || !ul || !ul.querySelectorAll || typeof document.createElement !== 'function') {
    renderLists();
    return;
  }
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
        if (check && check.setAttribute) {
          check.setAttribute('aria-pressed', String(!!it.done));
          check.title = it.done ? 'Вернуть в работу' : 'Готово';
        }
      } else {
        li = document.createElement('li');
        render(li, listItemHTML(list.id, it));
        if (li.dataset) li.dataset.item = it.id; // для мини-DOM без парсинга innerHTML
      }
      keep.push(li);
    }
  }
  // убираем узлы, которых больше нет (удалённые подзадачи / пустое состояние)
  [...ul.querySelectorAll('li')].forEach(li => {
    if (keep.indexOf(li) < 0) li.remove();
  });
  // выстраиваем в правильном порядке (appendChild перемещает существующий узел)
  keep.forEach(li => {
    if (li.remove) li.remove();
    ul.appendChild(li);
  });
  if (!sorted.length) {
    const empty = document.createElement('li');
    empty.classList.add('empty-li');
    empty.textContent = 'Пока пусто';
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
    const dx = r1.left - r2.left,
      dy = r1.top - r2.top;
    if (!dx && !dy) return;
    if (!el.style) el.style = {};
    el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    moving.push(el);
  });
  if (!moving.length) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      moving.forEach(el => {
        el.style.transform = '';
      });
    })
  );
}

// Создать список с произвольным названием; возвращает список или null.
function createList(rawName) {
  const name = String(rawName || '').trim();
  if (!name) return null;
  const list = { id: uid(), name, items: [], order: 0 }; // order:0 — тот же приём, что у addNote/addPhoto
  db.lists.unshift(list); // новый список — сверху
  repoSet('lists', list);
  renderLists();
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
  repoSet('lists', list); // подзадача — часть документа списка
  if (inp) inp.value = '';
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
  repoSet('lists', list);
  refreshListCard(listId);
  // мини-«поп» галочки у переключённой подзадачи (анимация в CSS)
  const ul = $('#listItems-' + listId);
  const li = ul && ul.querySelector ? ul.querySelector('[data-item="' + itemId + '"]') : null;
  if (li) {
    li.classList.add('just-toggled');
    setTimeout(() => {
      if (li.classList.remove) li.classList.remove('just-toggled');
    }, 400);
  }
  return it.done;
}
function delSubtask(listId, itemId) {
  const list = db.lists.find(x => x.id === listId);
  if (!list) return false;
  list.items = list.items.filter(x => x.id !== itemId);
  repoSet('lists', list);
  refreshListCard(listId);
  return true;
}
// «Выполнить список»: после подтверждения удаляет весь блок вместе с подзадачами.
function completeList(listId) {
  const list = db.lists.find(x => x.id === listId);
  if (!list) return false;
  if (!confirm('Выполнить список «' + list.name + '»? Он будет удалён вместе с подзадачами.')) return false;
  db.lists = db.lists.filter(x => x.id !== listId);
  repoDelete('lists', listId); // «выполнить» на деле удаляет весь список вместе с подзадачами
  renderLists();
  return true;
}

// Перетаскивание карточек списков — SortableJS (forceFallback: нативный HTML5
// DnD не поддерживает тач). Порядок — поле order документа списка, тот же
// приём, что у notesSortEnd (src/50-notes.js): без него Firestore не
// гарантирует порядок документов, и перетаскивание не переживало reload /
// второе устройство (Critical-находка ревью задач 8-9).
function listsSortEnd(evt) {
  const ids = [...evt.to.children].filter(c => c.classList && c.classList.contains('list-card')).map(c => c.dataset.id);
  ids.forEach((id, i) => {
    const l = db.lists.find(x => x.id === id);
    if (l) l.order = i;
  });
  db.lists = ids.map(id => db.lists.find(l => l.id === id)).filter(Boolean);
  repoBatch('lists', db.lists); // порядок меняется у всех карточек разом — батч, не поштучно
}
if (typeof Sortable !== 'undefined') {
  Sortable.create($('#listsWrap'), {
    handle: '.list-drag',
    forceFallback: true,
    fallbackOnBody: true,
    animation: 150,
    scroll: true,
    scrollSensitivity: 80,
    scrollSpeed: 20,
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
  repoSet('lists', list); // порядок подзадач — часть документа списка, не отдельная сущность
}
function initSubtaskSortables() {
  if (typeof Sortable === 'undefined') return;
  subtaskSortables.forEach(inst => {
    if (inst && inst.destroy) inst.destroy();
  });
  subtaskSortables.clear();
  document.querySelectorAll('.list-card').forEach(card => {
    const listId = card.dataset.id;
    const ul = card.querySelector ? card.querySelector('.items') : null;
    if (!listId || !ul) return;
    subtaskSortables.set(
      listId,
      Sortable.create(ul, {
        handle: '.subtask-drag',
        filter: '.empty-li',
        forceFallback: true,
        fallbackOnBody: true,
        animation: 150,
        scroll: true,
        scrollSensitivity: 80,
        scrollSpeed: 20,
        onEnd: evt => subtaskSortEnd(listId, evt)
      })
    );
  });
}

$('#listCreateBtn').addEventListener('click', () => createList($('#listNameInput').value));
$('#listNameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') createList($('#listNameInput').value);
});
