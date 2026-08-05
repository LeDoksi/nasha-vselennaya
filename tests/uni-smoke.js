const fs = require('fs');
const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
const registry = {};
function makeEl() {
  return { id: '', dataset: {}, children: [], hidden: false, innerHTML: '', textContent: '',
    style: {}, value: '', classList: { toggle() {} }, addEventListener() {}, querySelectorAll() { return []; },
    appendChild() {}, remove() {}, focus() {} };
}
const sandbox = {
  document: {
    body: makeEl(), documentElement: { dataset: {} }, createElement() { return makeEl(); }, addEventListener() {},
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
  alert() {}, confirm() { return true; },
  URL: { createObjectURL() { return 'blob:x'; }, revokeObjectURL() {} },
  FileReader: function () { this.readAsDataURL = (f) => { this.onload({ target: { result: 'data:image/jpeg;base64,AA==' } }); }; },
  Blob: function () {}, HTMLAudioElement: function () {}, Image: function () {},
  setTimeout(f) { sandbox._timers.push(f); return 0; }, setInterval() { return 1; },
  addEventListener() {}, isNaN, console, Date, Math, JSON, Object, Array, Number, String, RegExp,
  // старые данные без version/wishlist/backupDate/labels — проверяем миграцию
  _store: { universe: JSON.stringify({ events: [], notes: [], shopping: [], todos: [],
    photos: [{ id: 'pOld', data: 'x', title: 't', album: 'Поездка', pinned: false, ts: 1, order: 0 }], dates: [] }) },
  _ss: {},
  _timers: [],
};

let results = [];
function assert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); process.exit(1); }
  results.push(msg);
}

const suffix = `
;__TEST__(sandbox);
function __TEST__(s){
  s.db = db;
  Object.defineProperty(s, 'selectedDate', { get: () => selectedDate, set: v => { selectedDate = v; }, configurable: true });
  s.renderHome = renderHome; s.renderDates = renderDates; s.renderFloatingPhotos = renderFloatingPhotos;
  s.renderCalendar = renderCalendar; s.renderDayPanel = renderDayPanel; s.renderNotes = renderNotes;
  s.renderLists = renderLists; s.renderPhotos = renderPhotos;
  s.renderWishlist = renderWishlist; s.renderCountdown = renderCountdown; s.renderSettings = renderSettings;
  s.renderCompliment = renderCompliment; s.renderMobilePhotos = renderMobilePhotos;
  s.go = go; s.daysTogether = daysTogether; s.iso = iso;
  s.setUser = setUser; s.getUser = getUser; s.getStoredUser = getStoredUser;
  s.toggleTheme = toggleTheme; s.setTheme = setTheme; s.getTheme = getTheme; s.celebrate = celebrate; s.openEventModal = openEventModal;
  s.migrateDB = migrateDB;
  Object.defineProperty(s, 'currentLabel', { get: () => currentLabel, set: v => { currentLabel = v; }, configurable: true });
  s.selectedPhotos = selectedPhotos; s.renderLabels = renderLabels;
  s.deleteLabel = deleteLabel; s.applyLabelToSelected = applyLabelToSelected; s.openLabelOverlay = openLabelOverlay;
}`;
const wrapped = new Function('sandbox', 'document', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'URL',
  'FileReader', 'Blob', 'HTMLAudioElement', 'Image', 'setTimeout', 'setInterval', 'addEventListener',
  src + suffix);
wrapped(sandbox, sandbox.document, sandbox.localStorage, sandbox.sessionStorage, sandbox.alert, sandbox.confirm,
  sandbox.URL, sandbox.FileReader, sandbox.Blob, sandbox.HTMLAudioElement, sandbox.Image,
  sandbox.setTimeout, sandbox.setInterval, sandbox.addEventListener);

const w = (f) => new Function('sandbox', 'return (' + f + ')(sandbox)')(sandbox);

// --- Миграция: старые данные получают version и новые поля ---
assert(w('(s)=>s.db.version') === 3, 'db.version = 3 после миграции');
assert(Array.isArray(w('(s)=>s.db.wishlist')), 'wishlist добавлен миграцией');
assert(w('(s)=>s.db.backupDate') === null, 'backupDate добавлен миграцией');
assert(Array.isArray(w('(s)=>s.db.labels')), 'labels добавлен миграцией');
assert(w('(s)=>JSON.stringify(s.db.photos[0].labels)') === '["Поездка"]', 'старый альбом фото стал лейблом');
assert(w('(s)=>s.db.labels.includes("Поездка")'), 'лейблы собраны в общий список');

// --- Тема ---
assert(w('(s)=>s.getTheme()') === 'light', 'тема по умолчанию — светлая');
w('(s)=>s.toggleTheme()');
assert(sandbox.document.documentElement.dataset.theme === 'dark', 'data-theme=dark применён');
assert(registry['#themeToggle'].textContent === '☀️', 'кнопка темы показывает солнце');
w('(s)=>s.setTheme("light")');

// --- Главная ---
w('(s)=>s.renderHome()');
assert(typeof w('(s)=>s.renderHome') === 'function', 'renderHome defined');
assert(registry['#compliment'].innerHTML.includes('Комплимент'), 'комплимент дня на главной');
assert(registry['#countdown'].hidden === true, 'таймер скрыт, если событий нет');

// счётчик дней считаем динамически — тест не устаревает со временем
const startD = new Date(2026, 2, 30); startD.setHours(0, 0, 0, 0);
const todayD = new Date(); todayD.setHours(0, 0, 0, 0);
const expDays = Math.round((todayD - startD) / 86400000);
assert(w('(s)=>s.daysTogether()') === expDays, 'daysTogether совпадает с календарём');
assert(String(registry['#daysCount'].textContent) === String(expDays), 'счётчик дней на месте');

assert(registry['#dates'].innerHTML.includes('Свиданий пока нет'), 'empty dates state');

// --- Свидание: приглашение от кого + ответы ---
w('(s)=>{s.db.dates.push({id:"d1",date:s.iso(2026,7,10),time:"19:00",from:"gosha",responses:{gosha:"yes",dasha:null},place:"Парк",note:"Пикник",emoji:"💘",done:false});s.renderHome();return s.db;}');
const datesHtml = registry['#dates'].innerHTML;
assert(datesHtml.includes('приглашение от Гоши'), 'date card: from gosha');
assert(datesHtml.includes('Гоша: 💌 позвал'), 'date card: inviter status');
assert(!datesHtml.includes('data-answer-date'), 'inviter has no answer buttons');
assert(datesHtml.includes('Даша: ⏳'), 'date card: dasha pending');

// --- Пользователь ---
assert(registry['#userChip'].textContent === '👦 Гоша ▾', 'chip default gosha');
w('(s)=>s.setUser("dasha")');
assert(registry['#userChip'].textContent === '👧 Даша ▾', 'chip switches to dasha');
assert(registry['#userOverlay'].hidden === false, 'auth overlay asks on first load');

// --- Смена пользователя перекрашивает "моего" отвечающего ---
w('(s)=>s.renderHome()');
assert(registry['#dates'].innerHTML.includes('resp-me'), 'current user highlighted');
assert(registry['#dates'].innerHTML.includes('data-answer-date="d1"'), 'invitee has answer buttons');

// --- Бесшовные парящие фото: 5 гнёзд, 3 фото, слоты один раз ---
w('(s)=>{s.db.photos.push({id:"p1",data:"data:image/jpeg;base64,AA==",pinned:false,ts:1});s.renderFloatingPhotos();}');
const fp1 = registry['#floatPhotos'].innerHTML;
assert(fp1.includes('float-photo'), 'floating photos rendered');
assert((fp1.match(/data-slot=/g) || []).length === 5, 'five spawn spots');
assert(fp1.includes('left:-16px') && fp1.includes('right:-16px'), 'photos bound to hero block sides');

// --- Календарь отмечает дату со свиданием ---
w('(s)=>{s.go("calendar");s.renderCalendar();}');
assert(registry['#calendar'].innerHTML.includes('has-date'), 'calendar cell marked has-date');
const calHtml = registry['#calendar'].innerHTML;
assert(calHtml.includes('💘'), 'calendar has date marker');
w('(s)=>{s.selectedDate=s.iso(2026,7,10);s.renderDayPanel();}');
assert(registry['#dayPanel'].innerHTML.includes('Свидания'), 'date in day panel');

// --- Редактирование события календаря ---
w('(s)=>{s.db.events.push({id:"e1",title:"Годовщина",date:s.iso(2026,8,1),emoji:"💜",repeat:true});}');
w('(s)=>s.openEventModal("e1")');
assert(registry['#evModalTitle'].textContent === '✏️ Изменить дату', 'заголовок модалки для правки');
assert(registry['#evTitle'].value === 'Годовщина', 'поля модалки заполнены данными события');
w('(s)=>s.openEventModal()');
assert(registry['#evModalTitle'].textContent === '💜 Памятная дата', 'новая дата — обычный заголовок');
assert(registry['#evTitle'].value === '', 'новая дата — пустые поля');

// --- Таймер до события ---
w('(s)=>{const d=new Date();d.setDate(d.getDate()+2);s.renderCountdown();}');
assert(registry['#countdown'].hidden === false, 'таймер показывается при будущем событии');
assert(/\d+\s*дн\./.test(registry['#countdownTick'].textContent || ''), 'таймер тикает (не заглушка «…»)');

// --- Хотелки ---
w('(s)=>{s.db.wishlist.push({id:"w1",type:"want",text:"Плед",link:"https://x",data:"",owner:"gosha",done:false,ts:1});s.db.wishlist.push({id:"w2",type:"give",text:"Билеты в театр",data:"",owner:"dasha",done:false,ts:2});s.renderWishlist();}');
const wishHtml = registry['#wishlistGrid'].innerHTML;
assert(wishHtml.includes('Плед'), 'хотелка Гоши отрисована');
assert(wishHtml.includes('Билеты в театр'), 'хотелка Даши отрисована');
assert(wishHtml.includes('Хотелки Гоши') && wishHtml.includes('Хотелки Даши'), 'вишлист разделён по людям');
assert(wishHtml.includes('wish-link'), 'ссылка в хотелке есть');
w('(s)=>{const x=s.db.wishlist.find(v=>v.id==="w1");x.done=true;s.renderWishlist();}');
assert(registry['#wishlistGrid'].innerHTML.includes('wish done'), 'выполненная хотелка помечена');

// --- Фото: лейблы вместо альбомов, выбор нескольких ---
w('(s)=>{s.db.photos.push({id:"p2",data:"data:image/jpeg;base64,AA==",title:"море",labels:["Поездка","Семья"],pinned:false,ts:2,order:1});s.db.photos.push({id:"p3",data:"data:image/jpeg;base64,AA==",title:"кафе",labels:["Свидание"],pinned:false,ts:3,order:2});s.db.labels=["Поездка","Семья","Свидание"];s.renderPhotos();}');
let phHtml = registry['#photosGrid'].innerHTML;
assert(phHtml.includes('data-drag-photo'), 'фото перетаскиваемые');
assert(phHtml.includes('data-sel-photo'), 'у фото есть кнопка выбора');
assert(phHtml.includes('Поездка') && phHtml.includes('Свидание'), 'у фото несколько лейблов');
assert(!phHtml.includes('data-ren-photo'), 'переименование убрано');
const labHtml = registry['#labelBar'].innerHTML;
assert(labHtml.includes('Все фото'), 'кнопка «Все фото» в фильтре');
assert(labHtml.includes('Семья') && labHtml.includes('data-label-del'), 'лейбл в фильтре с кнопкой удаления');
w('(s)=>{s.currentLabel="Свидание";s.renderPhotos();}');
phHtml = registry['#photosGrid'].innerHTML;
assert(phHtml.includes('кафе') && !phHtml.includes('море'), 'фильтр по лейблу (только подходящие)');
w('(s)=>{s.currentLabel="";s.renderPhotos();}');
w('(s)=>{s.selectedPhotos.add("p2");s.renderPhotos();}');
phHtml = registry['#photosGrid'].innerHTML;
assert(phHtml.includes('photo selected'), 'выбранное фото подсвечено');
assert(registry['#photoSelBar'].style.display === 'flex', 'панель выбора показана');
w('(s)=>{s.applyLabelToSelected("Новое");s.renderPhotos();}');
assert(registry['#photosGrid'].innerHTML.includes('Новое'), 'лейбл добавлен выбранным фото');
w('(s)=>{s.deleteLabel("Семья");}');
assert(!registry['#labelBar'].innerHTML.includes('Семья'), 'лейбл удалён из фильтра');
assert(!registry['#photosGrid'].innerHTML.includes('Семья'), 'лейбл снят с фото, фото на месте');
w('(s)=>{s.selectedPhotos.clear();s.renderPhotos();}');

// --- Настройки: резервная копия и место ---
w('(s)=>s.renderSettings()');
assert(registry['#backupHint'].innerHTML.includes('копия ещё не делалась'), 'напоминание о бэкапе');
assert(/КБ|МБ/.test(registry['#storageInfo'].textContent), 'место в браузере показано');

// --- Конфетти не падает ---
w('(s)=>s.celebrate()');
assert(true, 'celebrate не бросает исключений');

// --- Все вкладки рендерятся ---
for (const v of ['home', 'calendar', 'notes', 'lists', 'wishlist', 'photos', 'song', 'settings']) {
  w('(s)=>s.go(' + JSON.stringify(v) + ')');
}
assert(true, 'all views rendered without errors');

console.log('OK: ' + results.length + ' checks passed\n' + results.join('\n'));

