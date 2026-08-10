// uni-dnd.js — проверка drag&drop через события (мини-DOM):
//  1) заметки переставляются (в т.ч. бросок на фон ниже последней карточки);
//  2) фото → чип лейбла: лейбл навешивается;
//  3) чип лейбла → фото: лейбл навешивается;
//  4) фото → фото: порядок меняется;
//  5) карточки списков переставляются (порядок db.lists сохраняется).
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
  _handlers: {},
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

// id-элементы, которые приложение запрашивает при загрузке и в обработчиках
const PREIDS = ['notesGrid', 'photosGrid', 'labelBar', 'calendar', 'dayPanel', 'dragHint', 'photoSelBar', 'selCount',
  'jumpInfo', 'noteAddBtn', 'noteText', 'userChip', 'themeToggle', 'settingsThemeBtn',
  'calPrev', 'calNext', 'calMonthSelect', 'calYearSelect', 'jumpNextBtn', 'addEventBtn',
  'authOverlay', 'evModal', 'evTitle', 'evDate', 'evEnd', 'evRepeat', 'evSave', 'evModalTitle', 'evHeadSub',
  'datePop', 'dpDays', 'dpMonth', 'countdownTick', 'labelOverlay', 'labelNewName', 'labelNewBtn',
  'eventYears', 'eventMonths', 'eventTitles', 'eventReset', 'view-home', 'view-calendar', 'view-notes',
  'view-lists', 'view-wishlist', 'view-photos', 'view-song', 'view-settings', 'listsWrap'];
for (const id of PREIDS) { const el = makeEl('div'); el.id = id; registry['#' + id] = el; body.appendChild(el); }

const sandbox = {
  document,
  localStorage: { getItem(k) { return sandbox._store[k] ?? null; }, setItem(k, v) { sandbox._store[k] = String(v); }, removeItem(k) { delete sandbox._store[k]; } },
  sessionStorage: { getItem(k) { return sandbox._ss[k] ?? null; }, setItem(k, v) { sandbox._ss[k] = String(v); } },
  alert() {}, confirm() { return true; },
  URL: { createObjectURL() { return 'blob:x'; }, revokeObjectURL() {} },
  FileReader: function () { this.readAsDataURL = (f) => { this.onload({ target: { result: 'data:image/jpeg;base64,AA==' } }); }; },
  Blob: function () {}, HTMLAudioElement: function () {}, Image: function () {},
  setTimeout(f) { sandbox._timers.push(f); return 0; }, setInterval() { return 1; },
  addEventListener() {}, isNaN, console, Date, Math, JSON, Object, Array, Number, String, RegExp,
  _store: { universe: JSON.stringify({ events: [], notes: [], shopping: [], todos: [], photos: [], dates: [] }) },
  _ss: {}, _timers: [],
  // фейковый rAF. По умолчанию колбэки выполняются сразу (как в песочнице без rAF).
  // В режиме троттлинга (_throttleMode) — откладываются на «кадр», который тесты
  // прогоняют вручную (pumpRAF): проверяется, что перестановка применяется раз в кадр.
  requestAnimationFrame(fn) {
    if (sandbox._throttleMode) { sandbox._rAFQueue.push(fn); return ++sandbox._rAFSeq; }
    fn(); return 0;
  },
  cancelAnimationFrame() {},
  _throttleMode: false, _rAFQueue: [], _rAFSeq: 0
};

const suffix = `
;__TEST__(sandbox);
function __TEST__(s){
  Object.defineProperty(s, 'db', { get: () => db, set: v => { db = v; }, configurable: true });
  Object.defineProperty(s, 'currentLabel', { get: () => currentLabel, set: v => { currentLabel = v; }, configurable: true });
  Object.defineProperty(s, 'dragNoteId', { get: () => dragNoteId, set: v => { dragNoteId = v; }, configurable: true });
  Object.defineProperty(s, 'dragPhotoId', { get: () => dragPhotoId, set: v => { dragPhotoId = v; }, configurable: true });
  Object.defineProperty(s, 'dragLabel', { get: () => dragLabel, set: v => { dragLabel = v; }, configurable: true });
  Object.defineProperty(s, 'dragListId', { get: () => dragListId, set: v => { dragListId = v; }, configurable: true });
  s.renderNotes = renderNotes; s.renderPhotos = renderPhotos; s.renderLabels = renderLabels;
  s.go = go; s.migrateDB = migrateDB; s.reorderNoteIds = reorderNoteIds;
  s.selectedPhotos = selectedPhotos;
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
// Универсальный Pointer Events-драг: pointerdown на ручке ⠿ → pointermove за порог 6px
// (начало драга) → живая перестановка соседей (FLIP) → pointerup (дроп) / Esc / cancel.
const startDrag = (el, x, y) => el.dispatchEvent('pointerdown', { bubbles: true, clientX: x, clientY: y });
const pumpRAF = () => { while (sandbox._rAFQueue.length) sandbox._rAFQueue.shift()(); };
// в браузере перестановка и FLIP применяются раз в кадр — после каждого move прогоняем кадр
const moveDrag = (x, y, target) => {
  (target || sandbox.document.body).dispatchEvent('pointermove', { bubbles: true, clientX: x, clientY: y });
  pumpRAF();
};
const moveRaw = (x, y) => sandbox.document.body.dispatchEvent('pointermove', { bubbles: true, clientX: x, clientY: y });
const endDrag = (x, y, target) => (target || sandbox.document.body).dispatchEvent('pointerup', { bubbles: true, clientX: x, clientY: y });
const escDrag = root => root.dispatchEvent('keydown', { bubbles: true, key: 'Escape' });

// 1) Заметки: перестановка за ручку ⠿ (порядок — db.notes[].order)
sandbox.db = sandbox.migrateDB({ events: [], notes: [
  { id: 'a', text: 'A', ts: 1, pinned: false, author: 'gosha', order: 0 },
  { id: 'b', text: 'B', ts: 2, pinned: false, author: 'dasha', order: 1 },
  { id: 'c', text: 'C', ts: 3, pinned: false, author: 'gosha', order: 2 }
], shopping: [], todos: [], photos: [], dates: [], wishlist: [], labels: [] });
sandbox.go('notes');
const grid = sandbox.document.querySelector('#notesGrid');
const noteOrder = () => sandbox.document.querySelectorAll('.note').map(n => n.dataset.id);
const setRects = () => sandbox.document.querySelectorAll('.note').forEach((c, i) => {
  c._rect = { top: i * 100, left: 0, right: 200, bottom: i * 100 + 100, width: 200, height: 100, x: 0, y: i * 100 };
});
const note = id => grid.children.find(x => x.dataset.id === id);
const noteHandle = id => note(id) && note(id).querySelector('[data-note-drag]');
assert(JSON.stringify(noteOrder()) === '["a","b","c"]', 'заметки отрисованы в порядке a,b,c');
assert(!!noteHandle('a'), 'у заметки есть драг-ручка ⠿ (data-note-drag)');
setRects();

// «a» в конец: держим ручку, тащим ниже середины «c» и бросаем
startDrag(noteHandle('a'), 5, 5);
moveDrag(10, 280); // порог 6px пройден — драг начался
assert(sandbox.dragNoteId === 'a', 'после порога pointermove dragNoteId=a');
assert(note('a').classList.contains('dragging'), 'перетаскиваемая заметка получает класс dragging');
assert(sandbox.document.body.classList.contains('uni-dragging'), 'во время драга body получает uni-dragging');
assert(JSON.stringify(noteOrder()) === '["b","c","a"]', 'пока тащим — соседи «разъехались» (live-порядок)');
endDrag(10, 280);
assert(JSON.stringify(noteOrder()) === '["b","c","a"]', 'заметка a переехала после c');
assert(sandbox.db.notes.find(n => n.id === 'a').order === 2 && sandbox.db.notes.find(n => n.id === 'b').order === 0,
  'order пересчитан (b=0, a=2)');
assert(sandbox.dragNoteId === null, 'после дропа dragNoteId сброшен');

// 1а) Бросок на свою позицию ничего не ломает (порядок не меняется)
setRects();
startDrag(noteHandle('b'), 5, 5);
moveDrag(10, 50); // b остаётся наверху
endDrag(10, 50);
assert(JSON.stringify(noteOrder()) === '["b","c","a"]', 'бросок на свою позицию не меняет порядок');

// 1б) Бросок на фон НИЖЕ последней карточки — в конец
setRects();
startDrag(noteHandle('b'), 5, 5);
moveDrag(10, 9999);
assert(JSON.stringify(noteOrder()) === '["c","a","b"]', 'живой порядок: b уехала в конец');
endDrag(10, 9999);
assert(JSON.stringify(noteOrder()) === '["c","a","b"]', 'бросок на фон ниже списка ставит заметку в конец');

// 1в) Бросок на фон ВЫШЕ первой карточки — в начало
setRects();
startDrag(noteHandle('b'), 5, 5);
moveDrag(10, -9999);
assert(JSON.stringify(noteOrder()) === '["b","c","a"]', 'живой порядок: b снова в начале');
endDrag(10, -9999);
assert(JSON.stringify(noteOrder()) === '["b","c","a"]', 'бросок на фон выше списка ставит заметку в начало');

// 1г) Esc отменяет: порядок возвращается, db не трогается
setRects();
startDrag(noteHandle('c'), 5, 5);
moveDrag(10, 9999);
assert(JSON.stringify(noteOrder()) === '["b","a","c"]', 'пока тащим — порядок изменился');
escDrag(grid);
assert(JSON.stringify(noteOrder()) === '["b","c","a"]', 'Esc отменяет перестановку (порядок восстановлен)');
assert(sandbox.db.notes.find(n => n.id === 'a').order === 2 && sandbox.db.notes.find(n => n.id === 'c').order === 1,
  'Esc не трогает db (порядок как до драга)');
assert(sandbox.dragNoteId === null, 'после отмены dragNoteId сброшен');

// 1д) pointercancel тоже отменяет драг
setRects();
startDrag(noteHandle('b'), 5, 5);
moveDrag(10, 9999);
sandbox.document.body.dispatchEvent('pointercancel', { bubbles: true });
assert(JSON.stringify(noteOrder()) === '["b","c","a"]', 'pointercancel отменяет перестановку');
assert(sandbox.dragNoteId === null, 'после pointercancel dragNoteId сброшен');

// 2) Фото: перестановка за ручку ⠿, фото → чип лейбла, чип → фото
sandbox.db = sandbox.migrateDB({ events: [], notes: [], shopping: [], todos: [], dates: [], wishlist: [], labels: ['Поездка'],
  photos: [
    { id: 'p1', data: 'data:image/jpeg;base64,AA==', title: 'Ф1', pinned: false, order: 0, labels: [] },
    { id: 'p2', data: 'data:image/jpeg;base64,AA==', title: 'Ф2', pinned: false, order: 1, labels: [] }
  ] });
sandbox.currentLabel = '';
sandbox.go('photos');
const photosGrid = sandbox.document.querySelector('#photosGrid');
const photo = id => photosGrid.children.find(x => x.dataset.id === id);
const photoHandle = id => photo(id) && photo(id).querySelector('[data-photo-drag]');
const chip = () => sandbox.document.querySelector('#labelBar').children.find(x =>
  x.classList.contains('album-chip') && x.dataset.label === 'Поездка');
const setPRects = () => photosGrid.children.filter(x => x.classList.contains('photo')).forEach((c, i) => {
  c._rect = { top: i * 160, left: 0, right: 220, bottom: i * 160 + 150, width: 220, height: 150, x: 0, y: i * 160 };
});
assert(!!photo('p1') && !!photo('p2') && !!chip(), 'фото и чип лейбла отрисованы');
assert(!!photoHandle('p1'), 'у фото есть драг-ручка ⠿ (data-photo-drag)');
setPRects();

// 2а) Фото → чип лейбла: лейбл навешивается, порядок сетки возвращается
startDrag(photoHandle('p1'), 5, 5);
moveDrag(10, 20); // начали драг
assert(sandbox.dragPhotoId === 'p1', 'после порога pointermove dragPhotoId=p1');
moveDrag(400, 20, chip()); // курсор над чипом
assert(chip().classList.contains('drag-over'), 'чип подсвечивается при наведении фото');
endDrag(400, 20, chip());
assert(sandbox.db.photos.find(x => x.id === 'p1').labels.includes('Поездка'), 'лейбл навешен на перетащенное фото');
assert(!sandbox.db.photos.find(x => x.id === 'p2').labels.includes('Поездка'), 'другие фото не тронуты');
assert(sandbox.dragPhotoId === null, 'после дропа на чип dragPhotoId сброшен');
setPRects(); // renderPhotos перерисовала сетку — у новых узлов новые координаты

// 2б) Фото → фото: перестановка порядка (закреплённые всегда сверху)
startDrag(photoHandle('p1'), 5, 5);
moveDrag(10, 300); // ниже середины p2 (центр 160+75=235)
assert(JSON.stringify(photosGrid.children.filter(c => c.classList.contains('photo')).map(c => c.dataset.id)) === '["p2","p1"]',
  'живой порядок: p1 уехала за p2');
endDrag(10, 300);
assert(sandbox.db.photos.find(x => x.id === 'p1').order === 1 && sandbox.db.photos.find(x => x.id === 'p2').order === 0,
  'перетаскивание фото меняет порядок (p2 выше p1)');

// 2в) Чип лейбла → фото (обратное направление)
const chipEl = chip();
startDrag(chipEl, 5, 5);
moveDrag(10, 20);
assert(sandbox.dragLabel === 'Поездка', 'после порога pointermove чипа dragLabel=Поездка');
moveDrag(400, 20, photo('p2')); // курсор над фото
assert(photo('p2').classList.contains('drag-over'), 'фото подсвечивается при наведении чипа');
endDrag(400, 20, photo('p2'));
assert(sandbox.db.photos.find(x => x.id === 'p2').labels.includes('Поездка'), 'чип лейбла на фото навешивает лейбл');
assert(sandbox.dragLabel === null, 'после дропа чипа dragLabel сброшен');

// 3) Списки: перестановка карточек за ручку ⠿ (порядок — сам массив db.lists).
//    Во время перетаскивания карточки сдвигаются «по-живому» — видно место вставки.
sandbox.db = sandbox.migrateDB({ events: [], notes: [], shopping: [], todos: [], photos: [], dates: [], wishlist: [], labels: [],
  lists: [
    { id: 'l1', name: 'Подарки', items: [] },
    { id: 'l2', name: 'Дела', items: [] },
    { id: 'l3', name: 'Идеи', items: [] }
  ] });
sandbox.go('lists');
const lWrap = sandbox.document.querySelector('#listsWrap');
const listCard = id => lWrap.children.find(x => x.dataset.id === id);
const listOrder = () => lWrap.children.filter(x => x.classList.contains('list-card')).map(c => c.dataset.id);
const listHandle = id => listCard(id) && listCard(id).querySelector('[data-list-drag]');
const setLRects = () => listOrder().forEach((id, i) => {
  listCard(id)._rect = { top: i * 120, left: 0, right: 200, bottom: i * 120 + 100, width: 200, height: 100, x: 0, y: i * 120 };
});
assert(JSON.stringify(listOrder()) === '["l1","l2","l3"]', 'карточки списков отрисованы в порядке l1,l2,l3');
assert(!!listHandle('l1'), 'у карточки списка есть драг-ручка ⠿ (data-list-drag)');

// «первый на второй»: курсор в нижней половине второй карточки — сдвиг вниз
setLRects();
startDrag(listHandle('l1'), 5, 5);
moveDrag(10, 200); // l2: верх 120, низ 220, центр 170 → ниже центра
assert(sandbox.dragListId === 'l1', 'после порога pointermove dragListId=l1');
assert(JSON.stringify(listOrder()) === '["l2","l1","l3"]', 'живой порядок: l1 между l2 и l3');
endDrag(10, 200);
assert(JSON.stringify(sandbox.db.lists.map(l => l.id)) === '["l2","l1","l3"]', 'бросок первой на вторую меняет порядок в db');
assert(JSON.stringify(listOrder()) === '["l2","l1","l3"]', 'после дропа карточки в новом порядке');
assert(sandbox.dragListId === null, 'после дропа dragListId сброшен');

// первая на последнюю: курсор ниже середины последней — в конец
setLRects();
startDrag(listHandle('l2'), 5, 5);
moveDrag(10, 300); // l3: верх 240, низ 340, центр 290 → ниже середины
assert(JSON.stringify(listOrder()) === '["l1","l3","l2"]', 'живой порядок: l2 сдвигается за l3');
endDrag(10, 300);
assert(JSON.stringify(sandbox.db.lists.map(l => l.id)) === '["l1","l3","l2"]', 'бросок на нижнюю половину последней — в конец');

// отмена перетаскивания: порядок и db.lists возвращаются к исходному
sandbox.db = sandbox.migrateDB({ events: [], notes: [], shopping: [], todos: [], photos: [], dates: [], wishlist: [], labels: [],
  lists: [
    { id: 'l1', name: 'Подарки', items: [] },
    { id: 'l2', name: 'Дела', items: [] },
    { id: 'l3', name: 'Идеи', items: [] }
  ] });
sandbox.go('lists');
setLRects();
startDrag(listHandle('l1'), 5, 5);
moveDrag(10, 300);
assert(JSON.stringify(listOrder()) === '["l2","l3","l1"]', 'во время перетаскивания порядок меняется (живое превью)');
escDrag(lWrap);
assert(JSON.stringify(listOrder()) === '["l1","l2","l3"]', 'Esc отменяет: исходный порядок возвращён');
assert(JSON.stringify(sandbox.db.lists.map(l => l.id)) === '["l1","l2","l3"]', 'отмена не меняет db.lists');

// 4) Троттлинг живой перестановки: несколько pointermove за «кадр» — одна
//    перестановка по последней позиции курсора (без рывков между кадрами)
sandbox._throttleMode = true; sandbox._rAFQueue.length = 0;
sandbox.db = sandbox.migrateDB({ events: [], notes: [], shopping: [], todos: [], photos: [], dates: [], wishlist: [], labels: [],
  lists: [
    { id: 'l1', name: 'Подарки', items: [] },
    { id: 'l2', name: 'Дела', items: [] },
    { id: 'l3', name: 'Идеи', items: [] }
  ] });
sandbox.go('lists');
setLRects();
assert(JSON.stringify(listOrder()) === '["l1","l2","l3"]', 'троттлинг: база l1,l2,l3');
startDrag(listHandle('l1'), 5, 5);
moveRaw(10, 250); // граница между l2 и l3
moveRaw(10, 310); // ниже середины l3 — хвост
moveRaw(10, 400); // ещё ниже — хвост
assert(JSON.stringify(listOrder()) === '["l1","l2","l3"]', 'троттлинг: пока кадр не прошёл — порядок не меняется');
pumpRAF();
assert(JSON.stringify(listOrder()) === '["l2","l3","l1"]', 'троттлинг: за кадр применяется последняя позиция курсора');
endDrag(10, 400);
assert(JSON.stringify(sandbox.db.lists.map(l => l.id)) === '["l2","l3","l1"]', 'троттлинг: дроп сохраняет дожатый порядок');

// 4а) Дроп без прогона кадра: последняя позиция дожимается в uniDragEnd
sandbox.db = sandbox.migrateDB({ events: [], notes: [], shopping: [], todos: [], photos: [], dates: [], wishlist: [], labels: [],
  lists: [
    { id: 'l1', name: 'Подарки', items: [] },
    { id: 'l2', name: 'Дела', items: [] },
    { id: 'l3', name: 'Идеи', items: [] }
  ] });
sandbox.go('lists');
setLRects();
startDrag(listHandle('l1'), 5, 5);
moveRaw(10, 310); // кадр не прогоняем — перестановка висит в очереди rAF
endDrag(10, 310);
assert(JSON.stringify(listOrder()) === '["l2","l3","l1"]', 'дроп без кадра: порядок дожимается перед onDrop');
assert(JSON.stringify(sandbox.db.lists.map(l => l.id)) === '["l2","l3","l1"]', 'дроп без кадра: db сохранён в новом порядке');
sandbox._throttleMode = false;


// 2в) СЕТКА (узкое окно): 4 фото в 2 строки × 2 колонки — индекс вставки
//     стабилен и следует читающему порядку (без прыжков с 1 на 4 слот).
//     Раньше «ближайшая граница» в сетке давала ложные цели между строками →
//     осцилляция слота; теперь — «ближайшая карточка».
sandbox.db = sandbox.migrateDB({ events: [], notes: [], shopping: [], todos: [], dates: [], wishlist: [], labels: [],
  photos: [
    { id: 'g1', data: 'data:image/jpeg;base64,AA==', title: 'G1', pinned: false, order: 0, labels: [] },
    { id: 'g2', data: 'data:image/jpeg;base64,AA==', title: 'G2', pinned: false, order: 1, labels: [] },
    { id: 'g3', data: 'data:image/jpeg;base64,AA==', title: 'G3', pinned: false, order: 2, labels: [] },
    { id: 'g4', data: 'data:image/jpeg;base64,AA==', title: 'G4', pinned: false, order: 3, labels: [] }
  ] });
sandbox.go('photos');
const gridPhoto = id => photosGrid.children.find(x => x.classList.contains('photo') && x.dataset.id === id);
const gridOrder = () => photosGrid.children.filter(x => x.classList.contains('photo')).map(c => c.dataset.id);
const gridHandle = id => gridPhoto(id) && gridPhoto(id).querySelector('[data-photo-drag]');
const gridRects = {
  g1: { top: 0, left: 0, right: 300, bottom: 300, width: 300, height: 300, x: 0, y: 0 },
  g2: { top: 0, left: 320, right: 620, bottom: 300, width: 300, height: 300, x: 320, y: 0 },
  g3: { top: 320, left: 0, right: 300, bottom: 620, width: 300, height: 300, x: 0, y: 320 },
  g4: { top: 320, left: 320, right: 620, bottom: 620, width: 300, height: 300, x: 320, y: 320 }
};
const setGridRects = () => gridOrder().forEach(id => { gridPhoto(id)._rect = gridRects[id]; });
assert(JSON.stringify(gridOrder()) === '["g1","g2","g3","g4"]', 'сетка: фото отрисованы g1,g2,g3,g4');
assert(!!gridHandle('g1'), 'сетка: у g1 есть драг-ручка');

// g1 на свою позицию: порядок не меняется
setGridRects();
startDrag(gridHandle('g1'), 5, 5);
moveDrag(150, 150);
assert(JSON.stringify(gridOrder()) === '["g1","g2","g3","g4"]', 'сетка: курсор на своём месте — порядок не меняется');
endDrag(150, 150);

// g1 на g2 — ЛЮБАЯ часть карточки: g1 сразу после g2 (слот 2)
setGridRects();
startDrag(gridHandle('g1'), 5, 5);
moveDrag(340, 60); // левая половина g2 (раньше срабатывало только при наведении в правый бок)
assert(JSON.stringify(gridOrder()) === '["g2","g1","g3","g4"]', 'сетка: курсор над g2 (левая половина) → g1 после g2');
moveDrag(600, 280); // правая нижняя часть g2 — стабильно
assert(JSON.stringify(gridOrder()) === '["g2","g1","g3","g4"]', 'сетка: внутри g2 порядок стабилен');
endDrag(600, 280);

// g1 на g3 (нижний ряд): после g3
setGridRects();
startDrag(gridHandle('g1'), 5, 5);
moveDrag(60, 340);
assert(JSON.stringify(gridOrder()) === '["g2","g3","g1","g4"]', 'сетка: курсор над g3 → g1 после g3');
endDrag(60, 340);

// g1 на g4 (нижний ряд, правая колонка): СТАБИЛЬНЫЙ слот 4
setGridRects();
startDrag(gridHandle('g1'), 5, 5);
moveDrag(340, 340); // верхняя часть g4
assert(JSON.stringify(gridOrder()) === '["g2","g3","g4","g1"]', 'сетка: курсор над g4 → g1 в конец (после g4)');
moveDrag(500, 600); // низ g4 — порядок не осциллирует
assert(JSON.stringify(gridOrder()) === '["g2","g3","g4","g1"]', 'сетка: внутри g4 порядок стабилен (нет прыжков с 1 на 4)');
endDrag(500, 600);
const gOrder = id => sandbox.db.photos.find(p => p.id === id).order;
assert(gOrder('g2') === 0 && gOrder('g3') === 1 && gOrder('g4') === 2 && gOrder('g1') === 3,
  'сетка: дроп сохраняет новый порядок в db (order: g2,g3,g4,g1)');

console.log('OK: ' + checks + ' dnd checks passed');



