// uni-dnd.js — проверка drag&drop через события (мини-DOM):
//  1) заметки переставляются (в т.ч. бросок на фон ниже последней карточки);
//  2) фото → чип лейбла: лейбл навешивается;
//  3) чип лейбла → фото: лейбл навешивается;
//  4) фото → фото: порядок меняется.
// Запуск: node tests/uni-dnd.js app.js
'use strict';
const fs = require('fs');
const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');

/* ================= мини-DOM ================= */
const registry = {};
const STRUCTURED = new Set(['notesGrid', 'photosGrid', 'labelBar']);

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
    dispatchEvent(type, opts) {
      opts = opts || {};
      const dt = opts.dataTransfer || { effectAllowed: 'all', dropEffect: 'none', types: [], setData() {}, getData() { return ''; } };
      const ev = {
        type, target: this, bubbles: opts.bubbles !== false, cancelable: true,
        clientX: opts.clientX || 0, clientY: opts.clientY || 0,
        relatedTarget: opts.relatedTarget || null, dataTransfer: dt, defaultPrevented: false,
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
  'view-lists', 'view-wishlist', 'view-photos', 'view-song', 'view-settings'];
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
  _ss: {}, _timers: []
};

const suffix = `
;__TEST__(sandbox);
function __TEST__(s){
  Object.defineProperty(s, 'db', { get: () => db, set: v => { db = v; }, configurable: true });
  Object.defineProperty(s, 'currentLabel', { get: () => currentLabel, set: v => { currentLabel = v; }, configurable: true });
  Object.defineProperty(s, 'dragNoteId', { get: () => dragNoteId, set: v => { dragNoteId = v; }, configurable: true });
  Object.defineProperty(s, 'dragPhotoId', { get: () => dragPhotoId, set: v => { dragPhotoId = v; }, configurable: true });
  Object.defineProperty(s, 'dragLabel', { get: () => dragLabel, set: v => { dragLabel = v; }, configurable: true });
  s.renderNotes = renderNotes; s.renderPhotos = renderPhotos; s.renderLabels = renderLabels;
  s.go = go; s.migrateDB = migrateDB; s.reorderNoteIds = reorderNoteIds;
  s.selectedPhotos = selectedPhotos;
}
`;
const wrapped = new Function('sandbox', 'document', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'URL',
  'FileReader', 'Blob', 'HTMLAudioElement', 'Image', 'setTimeout', 'setInterval', 'addEventListener',
  src + suffix);
wrapped(sandbox, sandbox.document, sandbox.localStorage, sandbox.sessionStorage, sandbox.alert, sandbox.confirm,
  sandbox.URL, sandbox.FileReader, sandbox.Blob, sandbox.HTMLAudioElement, sandbox.Image,
  sandbox.setTimeout, sandbox.setInterval, sandbox.addEventListener);

let checks = 0;
function assert(cond, msg) {
  checks++;
  if (!cond) { console.log('FAIL: ' + msg); process.exit(1); }
}

/* ================= тесты ================= */
// 1) Заметки: перестановка drag&drop
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
assert(JSON.stringify(noteOrder()) === '["a","b","c"]', 'заметки отрисованы в порядке a,b,c');
setRects();

note('a').dispatchEvent('dragstart', { bubbles: true });
assert(sandbox.dragNoteId === 'a', 'dragstart ставит dragNoteId=a');
note('c').dispatchEvent('dragover', { bubbles: true, clientY: 280 });
assert(note('c').classList.contains('drop-after'), 'dragover подсвечивает нижнюю половину цели');
note('c').dispatchEvent('drop', { bubbles: true, clientY: 280 });
assert(JSON.stringify(noteOrder()) === '["b","c","a"]', 'заметка a переехала после c');
assert(sandbox.db.notes.find(n => n.id === 'a').order === 2 && sandbox.db.notes.find(n => n.id === 'b').order === 0,
  'order пересчитан (b=0, a=2)');

// 1а) Бросок на саму заметку ничего не ломает (порядок не меняется)
setRects();
note('b').dispatchEvent('dragstart', { bubbles: true });
note('b').dispatchEvent('dragover', { bubbles: true, clientY: 50 });
note('b').dispatchEvent('drop', { bubbles: true, clientY: 50 });
assert(JSON.stringify(noteOrder()) === '["b","c","a"]', 'бросок на саму заметку не меняет порядок');

// 1б) Бросок на фон НИЖЕ последней карточки тоже переставляет в конец
setRects();
note('b').dispatchEvent('dragstart', { bubbles: true });
grid.dispatchEvent('dragover', { bubbles: true, clientY: 9999 });
grid.dispatchEvent('drop', { bubbles: true, clientY: 9999 });
assert(JSON.stringify(noteOrder()) === '["c","a","b"]', 'бросок на фон ниже списка ставит заметку в конец');

// 1в) Бросок на фон ВЫШЕ первой карточки — в начало
setRects();
note('b').dispatchEvent('dragstart', { bubbles: true });
grid.dispatchEvent('dragover', { bubbles: true, clientY: -9999 });
grid.dispatchEvent('drop', { bubbles: true, clientY: -9999 });
assert(JSON.stringify(noteOrder()) === '["b","c","a"]', 'бросок на фон выше списка ставит заметку в начало');

// 2) Фото → чип лейбла
sandbox.db = sandbox.migrateDB({ events: [], notes: [], shopping: [], todos: [], dates: [], wishlist: [], labels: ['Поездка'],
  photos: [
    { id: 'p1', data: 'data:image/jpeg;base64,AA==', title: 'Ф1', pinned: false, order: 0, labels: [] },
    { id: 'p2', data: 'data:image/jpeg;base64,AA==', title: 'Ф2', pinned: false, order: 1, labels: [] }
  ] });
sandbox.currentLabel = '';
sandbox.go('photos');
const photosGrid = sandbox.document.querySelector('#photosGrid');
const photo = id => photosGrid.children.find(x => x.dataset.id === id);
const chip = () => sandbox.document.querySelector('#labelBar').children.find(x =>
  x.classList.contains('album-chip') && x.dataset.label === 'Поездка');
assert(!!photo('p1') && !!photo('p2') && !!chip(), 'фото и чип лейбла отрисованы');

photo('p1').dispatchEvent('dragstart', { bubbles: true });
assert(sandbox.dragPhotoId === 'p1', 'dragstart фото ставит dragPhotoId');
chip().dispatchEvent('dragenter', { bubbles: true });
chip().dispatchEvent('dragover', { bubbles: true });
assert(chip().classList.contains('drag-over'), 'чип подсвечивается при наведении фото');
chip().dispatchEvent('drop', { bubbles: true });
assert(sandbox.db.photos.find(x => x.id === 'p1').labels.includes('Поездка'), 'лейбл навешен на перетащенное фото');
assert(!sandbox.db.photos.find(x => x.id === 'p2').labels.includes('Поездка'), 'другие фото не тронуты');
assert(sandbox.dragPhotoId === null, 'после дропа dragPhotoId сброшен');

// 3) Чип лейбла → фото (обратное направление)
const chipEl = chip();
chipEl.dispatchEvent('dragstart', { bubbles: true });
assert(sandbox.dragLabel === 'Поездка', 'dragstart чипа ставит dragLabel');
photo('p2').dispatchEvent('dragover', { bubbles: true });
photo('p2').dispatchEvent('drop', { bubbles: true });
assert(sandbox.db.photos.find(x => x.id === 'p2').labels.includes('Поездка'), 'чип лейбла на фото навешивает лейбл');
assert(sandbox.dragLabel === null, 'после дропа чипа dragLabel сброшен');

// 4) Фото → фото: перестановка порядка
const pg = sandbox.document.querySelector('#photosGrid');
const p1 = pg.children.find(x => x.dataset.id === 'p1');
const p2 = pg.children.find(x => x.dataset.id === 'p2');
p1.dispatchEvent('dragstart', { bubbles: true });
p2.dispatchEvent('dragover', { bubbles: true });
p2.dispatchEvent('drop', { bubbles: true });
assert(sandbox.db.photos.find(x => x.id === 'p1').order === 1 && sandbox.db.photos.find(x => x.id === 'p2').order === 0,
  'перетаскивание фото меняет порядок (p2 выше p1)');

console.log('OK: ' + checks + ' dnd checks passed');



