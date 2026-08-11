// uni-dnd.js — проверка drag&drop-логики после перехода на SortableJS.
// Реальный SortableJS в этой мини-DOM (без getBoundingClientRect-геометрии,
// requestAnimationFrame с layout и т.п.) не запустить — Sortable.create() везде
// обёрнут в `if (typeof Sortable !== 'undefined')`, в тестах Sortable не
// определён, поэтому эти блоки просто не выполняются (проверено отдельно —
// см. «Sortable недоступен»). Вместо симуляции пиксельного перетаскивания тут
// проверяется своя клеевая логика — onEnd-хендлеры вызываются напрямую с
// рукотворным evt-объектом ({to:{children:[...]}}, как отдаёт SortableJS):
//  1) заметки — notesSortEnd (order, закреплённые всегда первыми);
//  2) карточки списков — listsSortEnd (порядок — сам массив db.lists);
//  3) подзадачи внутри списка — subtaskSortEnd (новая фича, порядок — позиция
//     в list.items, без миграции схемы; стабильность через toggleSubtask);
//  4) фото — photosSortEnd, обе развязки: обычный реордер и «отпущено над
//     чипом лейбла» (откат перестановки + применение лейбла);
//  5) чип лейбла → фото — единственный жест, оставшийся на pointer-обработчике
//     (chipDragSetup, 05-dnd.js), не на SortableJS: тут по-прежнему живая
//     симуляция pointerdown/move/up, как раньше.
// Запуск: node tests/uni-dnd.js app.js
'use strict';
const fs = require('fs');
const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');

/* ================= мини-DOM ================= */
const registry = {};
const STRUCTURED = new Set(['notesGrid', 'photosGrid', 'labelBar', 'listsWrap']);

function toCamel(s) { return s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()); }

function matches(el, sel) {
  return sel.split(',').some(part => {
    part = part.trim();
    if (!part) return false;
    const toks = part.match(/[.#][a-zA-Z0-9_-]+|\[[^\]]*\]|[a-zA-Z][a-zA-Z0-9]*/g) || [];
    for (const t of toks) {
      if (t[0] === '.') { if (!el.classList.contains(t.slice(1))) return false; }
      else if (t[0] === '#') { if (el.id !== t.slice(1)) return false; }
      else if (t[0] === '[') {
        const mm = /^\[([a-zA-Z][a-zA-Z0-9_-]*)(?:\s*=\s*"([^"]*)")?\]$/.exec(t);
        if (!mm) return false;
        const val = el.getAttribute(mm[1]);
        if (val === null) return false;
        if (mm[2] !== undefined && val !== mm[2]) return false;
      } else if (el.tag !== t) return false;
    }
    return true;
  });
}

function makeEl(tag) {
  const el = {
    tag, id: '', dataset: {}, attrs: {}, children: [], _parent: null, _text: '',
    hidden: false, style: {}, value: '', options: [], _html: '', _handlers: {},
    _rect: { top: 0, left: 0, right: 100, bottom: 50, width: 100, height: 50, x: 0, y: 0 },
    classList: {
      _s: new Set(),
      add(...cs) { for (const c of cs) if (c) this._s.add(c); },
      remove(...cs) { for (const c of cs) this._s.delete(c); },
      toggle(c, f) { if (f === undefined ? !this._s.has(c) : f) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); },
    appendChild(c) { c._parent = this; this.children.push(c); return c; },
    appendText(t) { this._text += String(t); },
    remove() { if (this._parent) { const i = this._parent.children.indexOf(this); if (i >= 0) this._parent.children.splice(i, 1); this._parent = null; } },
    focus() {}, click() {},
    setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[toCamel(k.slice(5))] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; if (k.startsWith('data-')) delete this.dataset[toCamel(k.slice(5))]; },
    getAttribute(k) { return (k in this.attrs) ? this.attrs[k] : null; },
    closest(sel) { let n = this; while (n) { if (matches(n, sel)) return n; n = n._parent; } return null; },
    matches(sel) { return matches(this, sel); },
    getBoundingClientRect() { return this._rect; },
    querySelectorAll(sel) { const out = []; (function walk(n) { for (const c of n.children) { if (matches(c, sel)) out.push(c); walk(c); } })(this); return out; },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    dispatchEvent(type, opts) {
      opts = opts || {};
      const dt = opts.dataTransfer || { effectAllowed: 'all', dropEffect: 'none', types: [], setData() {}, getData() { return ''; } };
      const ev = {
        type, target: this, bubbles: opts.bubbles !== false, cancelable: true,
        clientX: opts.clientX || 0, clientY: opts.clientY || 0,
        key: opts.key || '', relatedTarget: opts.relatedTarget || null, dataTransfer: dt, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }
      };
      let node = this;
      while (node) {
        for (const fn of (node._handlers[type] || []).slice()) fn(ev);
        if (!ev.bubbles) break;
        node = node._parent;
      }
      return ev;
    }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) {
      this._html = String(v);
      this.children.length = 0; this._text = '';
      if (STRUCTURED.has(this.id)) { try { parseHTML(String(v), this); } catch (e) { this.children.length = 0; } }
    }
  });
  Object.defineProperty(el, 'textContent', {
    get() { return this._text + this.children.map(c => c.textContent).join(''); },
    set(v) { this._text = String(v); this.children.length = 0; }
  });
  return el;
}

const SELF_CLOSING = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)(\/?)>/g;
const ATTR_RE = /([a-zA-Z_][-a-zA-Z0-9_:]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
function parseAttrs(el, str) {
  ATTR_RE.lastIndex = 0;
  let a;
  while ((a = ATTR_RE.exec(str))) {
    const name = a[1];
    const val = (a[2] !== undefined) ? a[2] : (a[3] !== undefined) ? a[3] : (a[4] !== undefined ? a[4] : '');
    if (name === 'class') { for (const c of val.split(/\s+/).filter(Boolean)) el.classList.add(c); }
    else if (name === 'id') { el.id = val; registry['#' + val] = el; }
    else if (name.startsWith('data-')) { el.attrs[name] = val; el.dataset[toCamel(name.slice(5))] = val; }
    else el.attrs[name] = val;
  }
}
function parseHTML(html, root) {
  TAG_RE.lastIndex = 0;
  let last = 0, m, stack = [root];
  while ((m = TAG_RE.exec(html))) {
    if (m.index > last) stack[stack.length - 1].appendText(html.slice(last, m.index));
    last = TAG_RE.lastIndex;
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const el = makeEl(m[2]);
    parseAttrs(el, m[3]);
    stack[stack.length - 1].appendChild(el);
    if (!m[4] && !SELF_CLOSING.has(m[2])) stack.push(el);
  }
  if (last < html.length) stack[stack.length - 1].appendText(html.slice(last));
}

function treeQSA(node, sel) {
  const out = [];
  (function walk(n) { for (const c of n.children) { if (matches(c, sel)) out.push(c); walk(c); } })(node);
  return out;
}

const docEl = makeEl('html');
const body = makeEl('body');
docEl.appendChild(body);
const document = {
  body, documentElement: docEl, hidden: false, visibilityState: 'visible', title: '',
  _handlers: {}, _efp: null, // элемент, который «отдаёт» elementFromPoint в тесте (null — метод отсутствует)
  addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); },
  removeEventListener() {},
  createElement(tag) { return makeEl(tag); },
  querySelector(sel) {
    if (registry[sel]) return registry[sel];
    const found = treeQSA(docEl, sel);
    if (found.length) { registry[sel] = found[0]; return found[0]; }
    const el = makeEl('div');
    if (sel[0] === '#') el.id = sel.slice(1);
    registry[sel] = el;
    return el;
  },
  querySelectorAll(sel) { return treeQSA(docEl, sel); }
};
// elementFromPoint нарочно не определяем на верхнем уровне: чип-драг (05-dnd.js)
// в его отсутствие падает на e.target (тот же приём, что был у старого движка) —
// events в этих тестах диспатчатся прямо на нужный элемент, так что e.target
// и есть искомая цель. Так проверяется реальный производственный фолбэк, а не
// геометрия, которую в мини-DOM всё равно негде взять без рисования layout.

// id-элементы, которые приложение запрашивает при загрузке и в обработчиках
const PREIDS = ['notesGrid', 'photosGrid', 'labelBar', 'calendar', 'dayPanel', 'dragHint', 'photoSelBar', 'selCount',
  'jumpInfo', 'noteAddBtn', 'noteText', 'themeToggle', 'settingsThemeBtn',
  'calPrev', 'calNext', 'calMonthSelect', 'calYearSelect', 'jumpNextBtn', 'addEventBtn',
  'authOverlay', 'evModal', 'evTitle', 'evDate', 'evEnd', 'evRepeat', 'evSave', 'evModalTitle', 'evHeadSub',
  'datePop', 'dpDays', 'dpMonth', 'countdownTick', 'labelOverlay', 'labelNewName', 'labelNewBtn',
  'eventYears', 'eventMonths', 'eventTitles', 'eventReset', 'view-home', 'view-calendar', 'view-notes',
  'view-lists', 'view-wishlist', 'view-photos', 'view-settings', 'listsWrap'];
for (const id of PREIDS) { const el = makeEl('div'); el.id = id; registry['#' + id] = el; body.appendChild(el); }

const sandbox = {
  document,
  localStorage: { getItem(k) { return sandbox._store[k] ?? null; }, setItem(k, v) { sandbox._store[k] = String(v); }, removeItem(k) { delete sandbox._store[k]; } },
  sessionStorage: { getItem(k) { return sandbox._ss[k] ?? null; }, setItem(k, v) { sandbox._ss[k] = String(v); }, removeItem(k) { delete sandbox._ss[k]; } },
  alert() {}, confirm() { return true; },
  URL: { createObjectURL() { return 'blob:x'; }, revokeObjectURL() {} },
  FileReader: function () { this.readAsDataURL = (f) => { this.onload({ target: { result: 'data:image/jpeg;base64,AA==' } }); }; },
  Blob: function () {}, HTMLAudioElement: function () {}, Image: function () {},
  setTimeout(f) { sandbox._timers.push(f); return 0; }, setInterval() { return 1; },
  addEventListener() {}, isNaN, console, Date, Math, JSON, Object, Array, Number, String, RegExp,
  _store: { universe: JSON.stringify({ events: [], notes: [], shopping: [], todos: [], photos: [], dates: [] }) },
  _ss: {}, _timers: [],
  requestAnimationFrame(fn) { fn(); return 0; },
  cancelAnimationFrame() {}
};

const suffix = `
;__TEST__(sandbox);
function __TEST__(s){
  Object.defineProperty(s, 'db', { get: () => db, set: v => { db = v; }, configurable: true });
  Object.defineProperty(s, 'currentLabel', { get: () => currentLabel, set: v => { currentLabel = v; }, configurable: true });
  s.renderNotes = renderNotes; s.renderPhotos = renderPhotos; s.renderLabels = renderLabels;
  s.renderLists = renderLists;
  s.go = go; s.migrateDB = migrateDB;
  s.selectedPhotos = selectedPhotos;
  s.notesSortEnd = notesSortEnd; s.listsSortEnd = listsSortEnd;
  s.subtaskSortEnd = subtaskSortEnd; s.photosSortEnd = photosSortEnd;
  s.toggleSubtask = toggleSubtask;
}
`;
const wrapped = new Function('sandbox', 'document', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'URL',
  'FileReader', 'Blob', 'HTMLAudioElement', 'Image', 'setTimeout', 'setInterval', 'addEventListener',
  'requestAnimationFrame', 'cancelAnimationFrame',
  src + suffix);
wrapped(sandbox, sandbox.document, sandbox.localStorage, sandbox.sessionStorage, sandbox.alert, sandbox.confirm,
  sandbox.URL, sandbox.FileReader, sandbox.Blob, sandbox.HTMLAudioElement, sandbox.Image,
  sandbox.setTimeout, sandbox.setInterval, sandbox.addEventListener,
  sandbox.requestAnimationFrame, sandbox.cancelAnimationFrame);

let checks = 0;
function assert(cond, msg) {
  checks++;
  if (!cond) { console.log('FAIL: ' + msg); process.exit(1); }
}

/* ================= тесты ================= */

// 0) Sortable недоступен в песочнице (нет браузера/vendor-скрипта) — все
//    Sortable.create() обёрнуты в typeof-проверку и должны молча пропускаться,
//    не роняя загрузку приложения (проверено самим фактом, что wrapped() выше
//    не бросил исключение). Явно фиксируем это как инвариант:
assert(typeof sandbox.Sortable === 'undefined', 'в песочнице Sortable не определён — Sortable.create() нигде не вызывается');

// 1) Заметки: notesSortEnd — order пересчитывается по итоговому DOM-порядку,
//    закреплённые всегда встают первыми независимо от того, где их бросили.
sandbox.db = sandbox.migrateDB({ events: [], notes: [
  { id: 'a', text: 'A', ts: 1, pinned: false, author: 'gosha', order: 0 },
  { id: 'b', text: 'B', ts: 2, pinned: false, author: 'dasha', order: 1 },
  { id: 'c', text: 'C', ts: 3, pinned: false, author: 'gosha', order: 2 }
], shopping: [], todos: [], photos: [], dates: [], wishlist: [], labels: [] });
sandbox.go('notes');
const notesGrid = sandbox.document.querySelector('#notesGrid');
const noteOrder = () => sandbox.document.querySelectorAll('.note').map(n => n.dataset.id);
const note = id => notesGrid.children.find(x => x.dataset.id === id);
assert(JSON.stringify(noteOrder()) === '["a","b","c"]', 'заметки отрисованы в порядке a,b,c');
assert(!!note('a').querySelector('[data-note-drag]'), 'у заметки есть драг-ручка ⠿ (data-note-drag)');

sandbox.notesSortEnd({ to: { children: [note('b'), note('c'), note('a')] } });
assert(sandbox.db.notes.find(n => n.id === 'b').order === 0
  && sandbox.db.notes.find(n => n.id === 'c').order === 1
  && sandbox.db.notes.find(n => n.id === 'a').order === 2,
  'notesSortEnd: order пересчитан по DOM-порядку из evt.to.children (b=0,c=1,a=2)');

// закреплённая заметка встаёт первой, даже если DOM-порядок говорит иное
sandbox.db.notes.find(n => n.id === 'c').pinned = true;
sandbox.notesSortEnd({ to: { children: [note('a'), note('b'), note('c')] } });
assert(sandbox.db.notes.find(n => n.id === 'c').order === 0, 'notesSortEnd: закреплённая заметка всегда order=0');

// 2) Карточки списков: listsSortEnd — порядок db.lists = порядок DOM (без order-поля)
sandbox.db = sandbox.migrateDB({ events: [], notes: [], shopping: [], todos: [], photos: [], dates: [], wishlist: [], labels: [],
  lists: [
    { id: 'l1', name: 'Подарки', items: [] },
    { id: 'l2', name: 'Дела', items: [] },
    { id: 'l3', name: 'Идеи', items: [] }
  ] });
sandbox.go('lists');
const lWrap = sandbox.document.querySelector('#listsWrap');
const listCard = id => lWrap.children.find(x => x.dataset.id === id);
assert(JSON.stringify(lWrap.children.filter(c => c.classList.contains('list-card')).map(c => c.dataset.id)) === '["l1","l2","l3"]',
  'карточки списков отрисованы в порядке l1,l2,l3');
assert(!!listCard('l1').querySelector('[data-list-drag]'), 'у карточки списка есть драг-ручка ⠿ (data-list-drag)');

sandbox.listsSortEnd({ to: { children: [listCard('l2'), listCard('l3'), listCard('l1')] } });
assert(JSON.stringify(sandbox.db.lists.map(l => l.id)) === '["l2","l3","l1"]',
  'listsSortEnd: db.lists переставлен по DOM-порядку из evt.to.children');

// 3) Подзадачи внутри списка — новая фича (раньше ручного порядка не было).
//    Порядок = позиция в list.items, без отдельного order-поля (тот же
//    паттерн, что у db.lists выше).
sandbox.db = sandbox.migrateDB({ events: [], notes: [], shopping: [], todos: [], photos: [], dates: [], wishlist: [], labels: [],
  lists: [{ id: 'l1', name: 'Список', items: [
    { id: 'i1', text: 'A', done: false },
    { id: 'i2', text: 'B', done: false },
    { id: 'i3', text: 'C', done: false }
  ] }] });
sandbox.go('lists');
const listUl = () => sandbox.document.querySelector('#listItems-l1');
const li = id => listUl().children.find(x => x.dataset.item === id);
assert(JSON.stringify(listUl().children.filter(c => c.dataset.item).map(c => c.dataset.item)) === '["i1","i2","i3"]',
  'подзадачи отрисованы в порядке i1,i2,i3');
assert(!!li('i1').querySelector('[data-item-drag]'), 'у подзадачи есть драг-ручка ⠿ (data-item-drag)');

sandbox.subtaskSortEnd('l1', { to: { children: [li('i2'), li('i3'), li('i1')] } });
assert(JSON.stringify(sandbox.db.lists.find(l => l.id === 'l1').items.map(i => i.id)) === '["i2","i3","i1"]',
  'subtaskSortEnd: список подзадач переставлен по DOM-порядку');

// защита от гонки: если детей в evt меньше, чем реально подзадач (например,
// рендер ещё не успел приехать) — порядок не трогаем, а не обрезаем список
sandbox.subtaskSortEnd('l1', { to: { children: [li('i3')] } });
assert(JSON.stringify(sandbox.db.lists.find(l => l.id === 'l1').items.map(i => i.id)) === '["i2","i3","i1"]',
  'subtaskSortEnd: несовпадение числа детей — список подзадач не обрезается');

// стабильность: ручной порядок внутри группы «не выполнено» переживает toggle
// (sortListItems — стабильная сортировка по done, применяется поверх)
sandbox.toggleSubtask('l1', 'i2'); // i2 → done, должна уйти вниз, остальные — как были
assert(JSON.stringify(sandbox.db.lists.find(l => l.id === 'l1').items.map(i => i.id)) === '["i3","i1","i2"]',
  'toggleSubtask сохраняет ручной порядок внутри групп (i2 done — в конец)');

// 4) Фото: photosSortEnd — обычный реордер и «отпущено над чипом лейбла»
sandbox.db = sandbox.migrateDB({ events: [], notes: [], shopping: [], todos: [], dates: [], wishlist: [],
  labels: [{ id: 'lTrip', name: 'Поездка', color: '#ec4899' }],
  photos: [
    { id: 'p1', data: 'data:image/jpeg;base64,AA==', title: 'Ф1', pinned: false, order: 0, labels: [] },
    { id: 'p2', data: 'data:image/jpeg;base64,AA==', title: 'Ф2', pinned: false, order: 1, labels: [] }
  ] });
sandbox.currentLabel = '';
sandbox.go('photos');
const photosGrid = sandbox.document.querySelector('#photosGrid');
const photo = id => photosGrid.children.find(x => x.dataset.id === id);
const chip = () => sandbox.document.querySelector('#labelBar').querySelector('.album-chip[data-label="lTrip"]');
assert(!!photo('p1') && !!photo('p2') && !!chip(), 'фото и чип лейбла отрисованы');
assert(!!photo('p1').querySelector('[data-photo-drag]'), 'у фото есть драг-ручка ⠿ (data-photo-drag)');

// 4а) обычный реордер: курсор не над чипом (elementFromPoint не задан, e.target
//     указывает на пустой div — не чип и не фото)
const emptyTarget = sandbox.document.createElement('div');
sandbox.photosSortEnd({
  to: { children: [photo('p2'), photo('p1')] }, item: photo('p1'), from: { children: [photo('p2'), photo('p1')] }, oldIndex: 0,
  originalEvent: { clientX: 999, clientY: 999, target: emptyTarget }
});
assert(sandbox.db.photos.find(p => p.id === 'p1').order === 1 && sandbox.db.photos.find(p => p.id === 'p2').order === 0,
  'photosSortEnd: обычный реордер пересчитывает order по DOM-порядку (p2=0, p1=1)');
assert(!sandbox.db.photos.find(p => p.id === 'p1').labels.includes('lTrip'), 'обычный реордер не навешивает лейбл');

// 4б) отпустили над чипом: перестановка откатывается назад (evt.from/oldIndex),
//     вместо order — применяется лейбл (и перетаскиваемому, и всем отмеченным)
sandbox.selectedPhotos.clear();
sandbox.selectedPhotos.add('p2'); // «все отмеченные» тоже получают лейбл
const fromList = { children: [photo('p1'), photo('p2')] }; // p1 «убрали» при живой перестановке…
fromList.insertBefore = (node, ref) => { // …insertBefore возвращает его на oldIndex=0
  const i = fromList.children.indexOf(ref);
  const cur = fromList.children.indexOf(node);
  if (cur >= 0) fromList.children.splice(cur, 1);
  fromList.children.splice(i < 0 ? fromList.children.length : i, 0, node);
};
sandbox.photosSortEnd({
  to: fromList, from: fromList, item: photo('p1'), oldIndex: 0,
  originalEvent: { clientX: 10, clientY: 10, target: chip() }
});
assert(sandbox.db.photos.find(p => p.id === 'p1').labels.includes('lTrip'), 'photosSortEnd: лейбл навешен на перетащенное фото (p1)');
assert(sandbox.db.photos.find(p => p.id === 'p2').labels.includes('lTrip'), 'photosSortEnd: лейбл навешен и на отмеченное фото (p2)');
assert(sandbox.selectedPhotos.size === 0, 'photosSortEnd: после навешивания лейбла выделение снято');

// 5) Чип лейбла → фото (обратное направление) — единственный жест на
//    самостоятельном pointer-обработчике (chipDragSetup, 05-dnd.js). Живая
//    симуляция pointerdown/move/up, e.target — цель (elementFromPoint нет).
const startDrag = (el, x, y) => el.dispatchEvent('pointerdown', { bubbles: true, clientX: x, clientY: y });
const moveDrag = (x, y, target) => (target || sandbox.document.body).dispatchEvent('pointermove', { bubbles: true, clientX: x, clientY: y });
const endDrag = (x, y, target) => (target || sandbox.document.body).dispatchEvent('pointerup', { bubbles: true, clientX: x, clientY: y });

sandbox.db.photos.forEach(p => { p.labels = []; }); // чистый лист под этот сценарий
const chipEl = chip();
startDrag(chipEl, 5, 5);
moveDrag(400, 20, photo('p2')); // курсор «над» фото p2 (событие диспатчится прямо на него)
assert(photo('p2').classList.contains('drag-over'), 'чип-драг: фото подсвечивается при наведении чипа (живая подсветка)');
endDrag(400, 20, photo('p2'));
assert(sandbox.db.photos.find(p => p.id === 'p2').labels.includes('lTrip'), 'чип-драг: бросок чипа на фото навешивает лейбл');
assert(!photo('p2').classList.contains('drag-over'), 'чип-драг: подсветка снята после дропа');

// Esc отменяет чип-драг без применения лейбла
startDrag(chipEl, 5, 5);
moveDrag(400, 20, photo('p1'));
assert(photo('p1').classList.contains('drag-over'), 'чип-драг: подсветка на p1 перед отменой');
chipEl.dispatchEvent('keydown', { bubbles: true, key: 'Escape' }); // keydown висит на #labelBar (фолбэк для тестов), не на body
assert(!sandbox.db.photos.find(p => p.id === 'p1').labels.includes('lTrip'), 'чип-драг: Esc отменяет — лейбл не навешен');
assert(!photo('p1').classList.contains('drag-over'), 'чип-драг: Esc снимает подсветку');

console.log('OK: ' + checks + ' dnd checks passed');
