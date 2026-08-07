// Воспроизведение бага: создание события через клик по кнопке «＋ Добавить дату».
// Раньше addEventListener('click', openEventModal) передавал объект MouseEvent как id,
// из-за чего модалка открывалась в режиме «Изменить дату» с несуществующим id,
// а saveEventFromModal молча терял событие (не создавал его).
const fs = require('fs');
const file = process.argv[2] || 'app.js';
let src = fs.readFileSync(file, 'utf8');
const registry = {};

function makeEl() {
  return {
    id: '', dataset: {}, children: [], hidden: false, innerHTML: '', textContent: '', checked: false,
    style: {}, value: '', options: [], _handlers: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    querySelectorAll() { return []; },
    appendChild() {}, remove() {}, focus() {}, click() {}, setAttribute() {}, removeAttribute() {}, add() {}
  };
}
const sandbox = {
  document: {
    body: makeEl(), documentElement: { dataset: {} }, createElement() { return makeEl(); },
    addEventListener() {},
    querySelector(sel) { return registry[sel] || (registry[sel] = makeEl()); },
    querySelectorAll() { return []; }
  },
  localStorage: {
    getItem(k) { return sandbox._store[k] ?? null; },
    setItem(k, v) { sandbox._store[k] = String(v); },
    removeItem(k) { delete sandbox._store[k]; }
  },
  sessionStorage: {
    getItem(k) { return sandbox._ss[k] ?? null; },
    setItem(k, v) { sandbox._ss[k] = String(v); }
  },
  alert(msg) { sandbox._alerts.push(String(msg)); }, confirm() { return true; },
  URL: { createObjectURL() { return 'blob:x'; }, revokeObjectURL() {} },
  FileReader: function () { this.readAsDataURL = (f) => { this.onload({ target: { result: 'data:image/jpeg;base64,AA==' } }); }; },
  Blob: function () {}, HTMLAudioElement: function () {}, Image: function () {},
  setTimeout(f) { sandbox._timers.push(f); return 0; }, setInterval() { return 1; },
  addEventListener() {}, isNaN, console, Date, Math, JSON, Object, Array, Number, String, RegExp,
  _store: { universe: JSON.stringify({ events: [], notes: [], shopping: [], todos: [], photos: [], dates: [], wishlist: [] }) },
  _ss: {}, _timers: [], _alerts: []
};

let results = [];
function assert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); process.exit(1); }
  results.push(msg);
}

const suffix = `
;__TEST__(sandbox);
function __TEST__(s){
  Object.defineProperty(s, 'db', { get: () => db, set: v => { db = v; }, configurable: true });
  Object.defineProperty(s, 'editingEventId', { get: () => editingEventId, set: v => { editingEventId = v; }, configurable: true });
  Object.defineProperty(s, 'calM', { get: () => calM, set: v => { calM = v; }, configurable: true });
  Object.defineProperty(s, 'calY', { get: () => calY, set: v => { calY = v; }, configurable: true });
  Object.defineProperty(s, 'selectedDate', { get: () => selectedDate, set: v => { selectedDate = v; }, configurable: true });
  s.openEventModal = openEventModal; s.eventsOn = eventsOn;
}`;
const wrapped = new Function('sandbox', 'document', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'URL',
  'FileReader', 'Blob', 'HTMLAudioElement', 'Image', 'setTimeout', 'setInterval', 'addEventListener',
  src + suffix);
try {
  wrapped(sandbox, sandbox.document, sandbox.localStorage, sandbox.sessionStorage, sandbox.alert, sandbox.confirm,
    sandbox.URL, sandbox.FileReader, sandbox.Blob, sandbox.HTMLAudioElement, sandbox.Image,
    sandbox.setTimeout, sandbox.setInterval, sandbox.addEventListener);
} catch (e) {
  console.log('LOAD ERROR: ' + e.message);
  process.exit(1);
}


const w = (f) => new Function('sandbox', 'return (' + f + ')(sandbox)')(sandbox);

// --- Эмуляция реального клика пользователя по кнопке «＋ Добавить дату» ---
const btnHandlers = registry['#addEventBtn']._handlers.click;
assert(Array.isArray(btnHandlers) && btnHandlers.length === 1, 'на кнопке «＋ Добавить дату» зарегистрирован обработчик клика');
btnHandlers[0]({ type: 'click', target: registry['#addEventBtn'] }); // браузер передаёт MouseEvent

// Модалка должна открыться в режиме СОЗДАНИЯ
assert(registry['#eventOverlay'].hidden === false, 'модалка открылась');
assert(registry['#evModalTitle'].textContent === '💜 Памятная дата',
  'заголовок модалки — «Памятная дата», а не «Изменить дату»');
assert(w('(s)=>s.editingEventId') === null, 'editingEventId не установлен (режим создания)');

// Пользователь вводит название и даты (10.08–18.08.2026), нажимает «Сохранить»
registry['#evTitle'].value = 'Тест поездка';
registry['#evDate'].value = '2026-08-10';
registry['#evEnd'].value = '2026-08-18';
registry['#evRepeat'].checked = false;
// Пользователь нажимает «Сохранить»
registry['#evSave']._handlers.click[0]();

// Событие должно попасть в db.events
const ev = w('(s)=>s.db.events.find(e=>e.title==="Тест поездка")');
assert(!!ev, 'событие сохранено в db.events');
assert(ev.date === '2026-08-10' && ev.endDate === '2026-08-18', 'сохранены обе даты: 10.08 и 18.08');
assert(ev.repeat === false, 'длительное событие не повторяется ежегодно');

// Календарь должен перейти на август, выделить день 10 и подсветить диапазон 10–18
assert(w('(s)=>s.calM') === 7 && w('(s)=>s.calY') === 2026, 'календарь перешёл на Август 2026');
assert(w('(s)=>s.selectedDate') === '2026-08-10', 'выбран день 10.08.2026');
const calHtml = registry['#calendar'].innerHTML;
assert(calHtml.includes('in-span'), 'диапазон 10–18 августа подсвечен (in-span)');
assert(calHtml.includes('Тест поездка'), 'точка события с названием видна в календаре');

// Панель дня на 10 августа показывает событие
assert(registry['#dayPanel'].innerHTML.includes('Тест поездка'), 'панель дня показывает событие');

// --- Регрессия: редактирование существующего события всё ещё работает ---
const evId = ev.id;
w('(s)=>{s.openEventModal(' + JSON.stringify(evId) + '); return 1;}');
assert(registry['#evModalTitle'].textContent === '✏️ Изменить дату', 'редактирование: заголовок «Изменить дату»');
assert(registry['#evTitle'].value === 'Тест поездка', 'редактирование: название подставлено');

// --- Регрессия: если редактируемое событие удалено в другой вкладке, данные не теряются ---
w('(s)=>{s.db.events = s.db.events.filter(e=>e.id!==' + JSON.stringify(evId) + '); s.openEventModal(' + JSON.stringify(evId) + '); return 1;}');
registry['#evTitle'].value = 'Поездка (восстановлено)';
registry['#evDate'].value = '2026-08-12';
registry['#evEnd'].value = '';
registry['#evRepeat'].checked = true;
registry['#evSave']._handlers.click[0]();
assert(!!w('(s)=>s.db.events.find(e=>e.title==="Поездка (восстановлено)")'),
  'событие создаётся заново, если редактируемое не найдено');

console.log('OK: ' + results.length + ' checks passed\n' + results.join('\n'));

wrapped(sandbox, sandbox.document, sandbox.localStorage, sandbox.sessionStorage, sandbox.alert, sandbox.confirm,
  sandbox.URL, sandbox.FileReader, sandbox.Blob, sandbox.HTMLAudioElement, sandbox.Image,
  sandbox.setTimeout, sandbox.setInterval, sandbox.addEventListener);
