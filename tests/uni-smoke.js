const fs = require('fs');
const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
const registry = {};
function makeEl() {
  return { id: '', dataset: {}, children: [], hidden: false, innerHTML: '', textContent: '',
    style: {}, value: '', options: [], _handlers: {}, _attrs: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); }, querySelectorAll() { return []; },
    appendChild() {}, remove() {}, focus() {}, click() {},
    setAttribute(k, v) { this._attrs[k] = String(v); }, getAttribute(k) { return this._attrs[k] ?? null; }, removeAttribute(k) { delete this._attrs[k]; } };
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
  FileReader: function () { this.result = null; this.readAsDataURL = (f) => { this.result = 'data:image/jpeg;base64,AA=='; if (this.onload) this.onload(); }; },
  Blob: function (parts, opts) {
    // минимальный Blob для photoStore: хранит байты и умеет отдавать arrayBuffer
    this._bytes = [];
    (parts || []).forEach(p => {
      if (p instanceof Uint8Array) this._bytes.push(...p);
      else if (p instanceof ArrayBuffer) this._bytes.push(...new Uint8Array(p));
      else if (typeof p === 'string') this._bytes.push(...[...p].map(ch => ch.charCodeAt(0)));
    });
    this.size = this._bytes.length;
    this.type = (opts && opts.type) || '';
    this.arrayBuffer = () => Promise.resolve(Uint8Array.from(this._bytes).buffer);
  }, HTMLAudioElement: function () {}, Image: function () {},
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
  Object.defineProperty(s, 'db', { get: () => db, set: v => { db = v; }, configurable: true });
  Object.defineProperty(s, 'selectedDate', { get: () => selectedDate, set: v => { selectedDate = v; }, configurable: true });
  Object.defineProperty(s, 'editingEventId', { get: () => editingEventId, set: v => { editingEventId = v; }, configurable: true });
  Object.defineProperty(s, 'countdownTarget', { get: () => countdownTarget, set: v => { countdownTarget = v; }, configurable: true });
  Object.defineProperty(s, 'currentUser', { get: () => currentUser, set: v => { currentUser = v; }, configurable: true });
  Object.defineProperty(s, 'masterKey', { get: () => masterKey, configurable: true });
  s.renderHome = renderHome; s.renderDates = renderDates;
  s.renderCalendar = renderCalendar; s.renderDayPanel = renderDayPanel; s.renderNotes = renderNotes;
  s.startEditNote = startEditNote; s.saveNoteEdit = saveNoteEdit; s.cancelNoteEdit = cancelNoteEdit;
  s.togglePinNote = togglePinNote; s.deleteNote = deleteNote;
  s.nextUpcoming = nextUpcoming; s.jumpToNearestEvent = jumpToNearestEvent; s.updateNearestJump = updateNearestJump;
  Object.defineProperty(s, 'calM', { get: () => calM, set: v => { calM = v; }, configurable: true });
  Object.defineProperty(s, 'calY', { get: () => calY, set: v => { calY = v; }, configurable: true });
  s.reorderNoteIds = reorderNoteIds;
  s.renderLists = renderLists; s.renderPhotos = renderPhotos;
  s.createList = createList; s.addListSubtask = addListSubtask;
  s.toggleSubtask = toggleSubtask; s.delSubtask = delSubtask; s.completeList = completeList;
  s.renderWishlist = renderWishlist; s.renderCountdown = renderCountdown; s.tickCountdown = tickCountdown; s.renderSettings = renderSettings;
  s.renderCompliment = renderCompliment;
  s.go = go; s.daysTogether = daysTogether; s.iso = iso;
  s.jumpCalendar = jumpCalendar; s.eventsOn = eventsOn; s.fmtShort = fmtShort; s.saveEventFromModal = saveEventFromModal;
  s.setUser = setUser; s.getUser = getUser;
  s.toggleTheme = toggleTheme; s.setTheme = setTheme; s.getTheme = getTheme; s.celebrate = celebrate; s.openEventModal = openEventModal;
  s.openDateModal = openDateModal; s.openWishModal = openWishModal;
  s.toggleDateDone = toggleDateDone;
  s.saveDateFromModal = saveDateFromModal; s.saveWishFromModal = saveWishFromModal;
  s.migrateDB = migrateDB;
  Object.defineProperty(s, 'currentLabel', { get: () => currentLabel, set: v => { currentLabel = v; }, configurable: true });
  Object.defineProperty(s, 'eventFilter', { get: () => eventFilter, set: v => { eventFilter = v; }, configurable: true });
  Object.defineProperty(s, 'evPhotoData', { get: () => evPhotoData, set: v => { evPhotoData = v; }, configurable: true });
  Object.defineProperty(s, 'dpInput', { get: () => dpInput, set: v => { dpInput = v; }, configurable: true });
  Object.defineProperty(s, 'dpM', { get: () => dpM, set: v => { dpM = v; }, configurable: true });
  Object.defineProperty(s, 'dpY', { get: () => dpY, set: v => { dpY = v; }, configurable: true });
  s.renderDatePop = renderDatePop; s.pickDpDate = pickDpDate; s.dpIso = dpIso;
  s.openDatePop = openDatePop; s.closeDatePop = closeDatePop;
  Object.defineProperty(s, 'dpFocus', { get: () => dpFocus, set: v => { dpFocus = v; }, configurable: true });
  s.datePopKeydown = datePopKeydown;
  s.getMotion = getMotion; s.applyMotion = applyMotion; s.setMotion = setMotion; s.motionReduced = motionReduced;
  Object.defineProperty(s, 'photosRenderQueued', { get: () => photosRenderQueued, set: v => { photosRenderQueued = v; }, configurable: true });
  s.selectedPhotos = selectedPhotos; s.renderLabels = renderLabels;
  s.deleteLabel = deleteLabel; s.deletePhoto = deletePhoto; s.applyLabelToSelected = applyLabelToSelected; s.openLabelOverlay = openLabelOverlay;
  s.applyLabelToPhotos = applyLabelToPhotos; s.removeLabelFromPhoto = removeLabelFromPhoto;
  s.filteredPhotos = filteredPhotos; s.renderEventBar = renderEventBar; s.eventsForPhoto = eventsForPhoto; s.photoByRef = photoByRef; s.addEventPhotosToGallery = addEventPhotosToGallery; s.evThumbs = evThumbs; s.dtThumbs = dtThumbs;
  s.wishCard = wishCard; s.fmtWishDate = fmtWishDate;
  s.relabelEventPhotos = relabelEventPhotos;
  s.createVault = createVault; s.unlockWith = unlockWith; s.savePassFor = savePassFor; s.changePass = changePass;
  s.lock = lock; s.isLocked = isLocked; s.loadVault = loadVault; s.legacyDB = legacyDB; s.save = save;
  s.exportData = exportData; s.importData = importData; s.showAuth = showAuth; s.unlockApp = unlockApp;
  Object.defineProperty(s, 'photoStore', { get: () => photoStore, configurable: true });
  s.migratePhotosToStore = migratePhotosToStore; s.dataUrlToBlob = dataUrlToBlob;
  s.photoUrl = photoUrl; s.photoSrc = photoSrc; s.warmThumbCache = warmThumbCache; s.clearPhotoStore = clearPhotoStore;
  s.initPhotoStore = initPhotoStore; s.getThumbUrl = getThumbUrl; s.setThumbUrl = setThumbUrl;
  s.makeThumbBlob = makeThumbBlob; s.canDraw = canDraw;
  s.photoDate = photoDate; s.onThisDayItems = onThisDayItems; s.memoryByDay = memoryByDay;
  s.renderMemory = renderMemory;
  s.memoryPhotosHtml = memoryPhotosHtml; s.toggleMemoryPhotos = toggleMemoryPhotos;
  s.renderProgressRing = renderProgressRing;
  s.onThisDayPhotos = onThisDayPhotos; s.pickHistoryPhotos = pickHistoryPhotos;
  s.shuffleHistoryPhotos = shuffleHistoryPhotos; s.historyPhotosHtml = historyPhotosHtml;
  Object.defineProperty(s, 'historyCollage', { get: () => historyCollage, set: v => { historyCollage = v; }, configurable: true });
  s.closeOverlay = closeOverlay;
  s.buildBottomNav = buildBottomNav; s.openNavSheet = openNavSheet; s.closeNavSheet = closeNavSheet; s.onNavDocClick = onNavDocClick;
  s.BOTTOM_PRIMARY = BOTTOM_PRIMARY; s.BOTTOM_MORE = BOTTOM_MORE;
  Object.defineProperty(s, 'activeView', { get: () => activeView, set: v => { activeView = v; }, configurable: true });
  Object.defineProperty(s, 'lightboxList', { get: () => lightboxList, set: v => { lightboxList = v; }, configurable: true });
  Object.defineProperty(s, 'lightboxIdx', { get: () => lightboxIdx, set: v => { lightboxIdx = v; }, configurable: true });
  Object.defineProperty(s, 'lightboxZoom', { get: () => lightboxZoom, set: v => { lightboxZoom = v; }, configurable: true });
  s.openLightbox = openLightbox; s.openLightboxFrom = openLightboxFrom;
  s.lbNav = lbNav; s.lbZoomTo = lbZoomTo; s.lbZoomToggle = lbZoomToggle; s.lbClose = lbClose; s.lbRender = lbRender;
}`;
const wrapped = new Function('sandbox', 'document', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'URL',
  'FileReader', 'Blob', 'HTMLAudioElement', 'Image', 'setTimeout', 'setInterval', 'addEventListener',
  src + suffix);
wrapped(sandbox, sandbox.document, sandbox.localStorage, sandbox.sessionStorage, sandbox.alert, sandbox.confirm,
  sandbox.URL, sandbox.FileReader, sandbox.Blob, sandbox.HTMLAudioElement, sandbox.Image,
  sandbox.setTimeout, sandbox.setInterval, sandbox.addEventListener);

const w = (f) => new Function('sandbox', 'return (' + f + ')(sandbox)')(sandbox);

(async () => {

// --- Замок: приложение закрыто, сейфа ещё нет ---
assert(w('(s)=>s.isLocked()') === true, 'приложение закрыто до входа');
assert(w('(s)=>s.loadVault()') === null, 'сейфа ещё нет');

// --- Первый запуск: старые открытые данные мигрируют и шифруются ---
await w('(s)=>s.createVault("gosha","123456")');
assert(w('(s)=>s.isLocked()') === true, 'создание сейфа само по себе не открывает приложение');
assert(w('(s)=>s.currentUser') === 'gosha', 'создавший сейф — Гоша');
const vault1 = w('(s)=>s.loadVault()');
assert(vault1 && vault1.ver === 1 && vault1.db && Array.isArray(vault1.keys), 'сейф имеет структуру: db + keys');
assert(vault1.keys.length === 1 && vault1.keys[0].who === 'gosha', 'ключ обёрнут только для Гоши');
const vaultRaw = w('(s)=>JSON.stringify(s.loadVault())');
assert(!vaultRaw.includes('Поездка') && !vaultRaw.includes('pOld'), 'в localStorage нет открытого текста');
assert(!vaultRaw.includes('"123456"'), 'пароль не хранится в сейфе');
assert(w('(s)=>s.localStorage.getItem("universe")') === null, 'старый открытый файл удалён после миграции');

// --- Миграция: старые данные получили version и новые поля ---
assert(w('(s)=>s.db.version') === 8, 'db.version = 8 после миграции');
assert(Array.isArray(w('(s)=>s.db.wishlist')), 'wishlist добавлен миграцией');
assert(w('(s)=>s.db.backupDate') === null, 'backupDate добавлен миграцией');
assert(Array.isArray(w('(s)=>s.db.labels')), 'labels добавлен миграцией');
assert(Array.isArray(w('(s)=>s.db.lists')), 'lists добавлен миграцией');
assert(w('(s)=>JSON.stringify(s.db.photos[0].labels)') === '["Поездка"]', 'старый альбом фото стал лейблом');
assert(w('(s)=>s.db.labels.includes("Поездка")'), 'лейблы собраны в общий список');

// --- Закрываем сессию, чтобы проверить вход с чистого листа ---
w('(s)=>s.lock()');
assert(w('(s)=>s.masterKey') === null, 'после создания и блокировки ключ очищен из памяти');
assert(w('(s)=>s.db.photos.length') === 0, 'данные очищены из памяти');

// --- Неверный пароль не открывает сейф ---
assert(await w('(s)=>s.unlockWith("gosha","wrong-pass")') === false, 'неверный пароль отклонён');
assert(w('(s)=>s.masterKey') === null, 'ключ закрыт при неверном пароле');

// --- Вход Гоши ---
assert(await w('(s)=>s.unlockWith("gosha","123456")') === true, 'правильный пароль открывает сейф');
assert(w('(s)=>s.isLocked()') === false, 'после входа приложение открыто');
assert(w('(s)=>s.currentUser') === 'gosha', 'система знает: вошёл Гоша');
assert(w('(s)=>s.db.labels.includes("Поездка")'), 'данные расшифрованы и на месте');

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

// --- Пользователь: чип показывает вошедшего ---
assert(registry['#userChip'].textContent === '👦 Гоша ▾', 'chip default gosha');
w('(s)=>s.setUser("dasha")');
assert(registry['#userChip'].textContent === '👧 Даша ▾', 'chip switches to dasha');
w('(s)=>s.setUser("gosha")');

// --- Свидание: приглашение от кого + ответы ---
w('(s)=>{s.db.dates.push({id:"d1",date:s.iso(2026,7,10),time:"19:00",from:"gosha",responses:{gosha:"yes",dasha:null},place:"Парк",note:"Пикник",emoji:"💘",done:false});s.renderHome();return s.db;}');
const datesHtml = registry['#dates'].innerHTML;
assert(datesHtml.includes('приглашение от Гоши'), 'date card: from gosha');
assert(datesHtml.includes('Гоша: 💌 позвал'), 'date card: inviter status');
assert(!datesHtml.includes('data-answer-date'), 'inviter has no answer buttons');
assert(datesHtml.includes('Даша: ⏳'), 'date card: dasha pending');

// --- Смена пользователя перекрашивает «моего» отвечающего ---
w('(s)=>s.setUser("dasha")');
w('(s)=>s.renderHome()');
assert(registry['#dates'].innerHTML.includes('resp-me'), 'current user highlighted');
assert(registry['#dates'].innerHTML.includes('data-answer-date="d1"'), 'invitee has answer buttons');
w('(s)=>s.setUser("gosha")');

// --- Модалки сами знают, кто вошёл: «кто» не выбирается, а берётся из сессии ---
// Свидание всегда записывается от имени вошедшего, вариант «Вместе» не создаётся.
w('(s)=>s.openDateModal()');
registry['#dtDate'].value = '2026-08-01';
w('(s)=>s.saveDateFromModal()');
assert(w('(s)=>s.db.dates[s.db.dates.length-1].from') === 'gosha', 'свидание от имени вошедшего (Гоша), выбрать нельзя');
assert(w('(s)=>s.db.dates.every(d=>d.from!=="both")'), 'вариант «Вместе» больше не создаётся');
w('(s)=>{s.setUser("dasha");s.openDateModal();}');
registry['#dtDate'].value = '2026-08-15';
w('(s)=>s.saveDateFromModal()');
assert(w('(s)=>s.db.dates[s.db.dates.length-1].from') === 'dasha', 'под Дашей свидание тоже только от её имени');
// Хотелка всегда в список вошедшего.
w('(s)=>{s.setUser("gosha");s.openWishModal();}');
registry['#wishText'].value = 'Новая мечта';
w('(s)=>s.saveWishFromModal()');
assert(w('(s)=>s.db.wishlist[0].owner') === 'gosha', 'хотелка Гоши попадает в его список');
w('(s)=>{s.setUser("dasha");s.openWishModal();}');
registry['#wishText'].value = 'Мечта Даши';
w('(s)=>s.saveWishFromModal()');
assert(w('(s)=>s.db.wishlist[0].owner') === 'dasha', 'хотелка Даши попадает в её список');
w('(s)=>s.setUser("gosha")');

// --- Коллаж «Наша история»: 2-3 случайных фото с асимметрией в блоке прогресса ---
w('(s)=>{s.db.photos=[{id:"p1",title:"Лето",data:"data:image/jpeg;base64,AA==",pinned:false,ts:1},{id:"p2",title:"Парк",data:"data:image/jpeg;base64,BB==",pinned:false,ts:2}];s.renderProgressRing();return 1;}');
const hisHtml = registry['#progressRing'].innerHTML;
assert((hisHtml.match(/class="history-photo"/g) || []).length === 2, 'коллаж показывает столько фото, сколько есть (2 из 3 слотов)');
assert(hisHtml.includes('data-photo="p1"') && hisHtml.includes('data-photo="p2"'), 'фото коллажа кликабельны (lightbox)');
assert(hisHtml.includes('data-photo-src'), 'без прогретого кэша миниатюр — fallback data-photo-src');
assert(hisHtml.includes('rotate:-7deg') && hisHtml.includes('rotate:5deg'), 'коллаж асимметричный: повороты у фото разные');
assert(hisHtml.includes('history-stats') && hisHtml.includes('hs-chip') && hisHtml.includes('📸 2'), 'в блоке «Наша история» — статистика счётчиков');
// Выбор фото стабилен в течение дня (seed по дате) — повторный рендер не меняет коллаж
w('(s)=>{s.renderProgressRing();return 1;}');
assert(registry['#progressRing'].innerHTML === hisHtml, 'коллаж стабилен при повторном рендере в тот же день');

// --- Коллаж: фото «в этот день» из прошлых лет приоритетнее случайных ---
w('(s)=>{const t=new Date();const d=new Date(t.getFullYear()-1,t.getMonth(),t.getDate());s.db.photos.push({id:"phOtd",title:"В этот день год назад",pinned:false,ts:9,takenAt:d.getTime()});s.renderProgressRing();return 1;}');
const hisOtd = registry['#progressRing'].innerHTML;
assert(hisOtd.includes('data-photo="phOtd"'), 'коллаж приоритетно показывает фото «в этот день»');
assert(hisOtd.includes('hp-badge') && hisOtd.includes('В этот день'), 'при фото «в этот день» на коллаже есть бейдж');
assert(hisOtd.includes('shuffleHistoryBtn'), 'в блоке «Наша история» есть кнопка «🎲 Перемешать»');
w('(s)=>{s.renderProgressRing();return 1;}');
assert(registry['#progressRing'].innerHTML === hisOtd, 'коллаж с «в этот день» стабилен при повторном рендере');

// --- Кнопка «🎲 Перемешать»: фиксирует новый выбор на день, «в этот день» не выкидывает ---
w('(s)=>{s.shuffleHistoryPhotos();return 1;}');
const afterIds = w('(s)=>s.historyCollage.ids.join(",")');
assert(typeof afterIds === 'string' && afterIds.length > 0 && afterIds.split(",").length === 3, 'перемес даёт полный набор из 3 фото');
assert(afterIds.includes('phOtd'), 'перемес не выкидывает фото «в этот день»');
assert(w('(s)=>s.historyCollage.day') === new Date().toDateString(), 'перемес закреплён до конца дня');
assert(((registry['#progressRing']._handlers || {}).click || []).length >= 1, 'кнопка «🎲 Перемешать» подключена через делегирование');
const hisSh = registry['#progressRing'].innerHTML;
w('(s)=>{s.renderProgressRing();return 1;}');
assert(registry['#progressRing'].innerHTML === hisSh, 'после перемеса коллаж стабилен при повторном рендере');

// --- Прогресс хотелок в статистике: счётчик 2/3 и полоска 67% ---
w('(s)=>{s.db.wishlist=[{id:"w1",text:"К1",done:true,owner:"gosha"},{id:"w2",text:"К2",done:true,owner:"gosha"},{id:"w3",text:"К3",done:false,owner:"gosha"}];s.renderProgressRing();return 1;}');
const hisWish = registry['#progressRing'].innerHTML;
assert(hisWish.includes('hs-wish') && hisWish.includes('2/3'), 'статистика показывает прогресс хотелок 2/3');
assert(hisWish.includes('width:67%'), 'полоска прогресса хотелок заполнена на 67%');
w('(s)=>{s.db.wishlist.push({id:"w4",text:"К4",done:false,owner:"gosha"});s.renderProgressRing();return 1;}');
assert(registry['#progressRing'].innerHTML.includes('2/4'), 'прогресс хотелок обновляется при изменении списка');
w('(s)=>{s.db.wishlist=[];s.renderProgressRing();return 1;}');
assert(registry['#progressRing'].innerHTML.includes('пока пусто'), 'без хотелок чип показывает «пока пусто»');

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
assert(registry['#evHeadSub'].textContent.includes('Сохрани важный день'), 'у модалки события есть подзаголовок (создание)');
w('(s)=>s.openEventModal("e1")');
assert(registry['#evHeadSub'].textContent.includes('Поправь детали'), 'подзаголовок меняется при редактировании');
w('(s)=>s.openEventModal()');

// --- Календарь: быстрый выбор месяца/года ---
w('(s)=>s.jumpCalendar(7,2027)');
assert(!registry['#calTitle'], 'месяц/год показывают только селекты (текст-заголовок удалён)');
assert(registry['#calMonthSelect'].value === '7' && registry['#calYearSelect'].value === '2027', 'селекты синхронизированы с текущим месяцем/годом');

// --- Кастомный date-picker (вместо системного календаря браузера) ---
assert(Array.isArray(registry['#evDate']._handlers.focus) && registry['#evDate']._handlers.focus.length > 0, 'поля дат открывают свой календарь (focus)');
assert(Array.isArray(registry['#evEnd']._handlers.focus) && registry['#evEnd']._handlers.focus.length > 0, 'у поля «До» тоже свой календарь');
assert(w('(s)=>s.dpIso(2026,7,9)') === '2026-08-09', 'dpIso собирает ISO-дату');
w('(s)=>{s.dpM=7;s.dpY=2026;s.renderDatePop();}');
assert(registry['#dpDays'].innerHTML.includes('dp-day'), 'date-picker рисует сетку дней');
assert(registry['#dpMonth'].innerHTML.includes('Август'), 'date-picker показывает селект месяца');
const fakeDp = w('(s)=>{s.dpInput={value:"",dispatchEvent(){}};return s.dpInput;}');
w('(s)=>s.pickDpDate("2026-08-09")');
assert(fakeDp.value === '2026-08-09', 'выбор даты пишет ISO в поле');
assert(registry['#datePop'].hidden === true, 'после выбора попап закрывается');
// --- date-picker: aria-паттерн «dialog + grid» и клавиатура ---
w('(s)=>{s.dpM=7;s.dpY=2026;s.dpFocus="2026-08-09";s.renderDatePop();}');
assert(registry['#dpDays'].innerHTML.includes('role="columnheader"'), 'шапка дней — columnheader');
assert(registry['#dpDays'].innerHTML.includes('aria-label="9 августа 2026 года"'), 'кнопка дня несёт полное aria-label');
assert(registry['#dpDays'].innerHTML.includes('aria-current="date"'), 'сегодня помечено aria-current');
const dpTab0 = (registry['#dpDays'].innerHTML.match(/tabindex="0"/g) || []).length;
assert(dpTab0 === 1, 'ровно одна ячейка с tabindex=0 (roving tabindex)');
assert(registry['#dpDays'].innerHTML.includes('aria-hidden="true"'), 'пустые ячейки скрыты от скринридера');
registry['#datePop'].hidden = false;
w('(s)=>{s.datePopKeydown({key:"ArrowRight",preventDefault(){}});}');
assert(w('(s)=>s.dpFocus') === '2026-08-10', 'ArrowRight: фокус на день вперёд');
w('(s)=>{s.datePopKeydown({key:"ArrowDown",preventDefault(){}});}');
assert(w('(s)=>s.dpFocus') === '2026-08-17', 'ArrowDown: фокус на неделю вперёд');
w('(s)=>{s.datePopKeydown({key:"ArrowLeft",preventDefault(){}});}');
assert(w('(s)=>s.dpFocus') === '2026-08-16', 'ArrowLeft: фокус на день назад');
w('(s)=>{s.datePopKeydown({key:"Home",preventDefault(){}});}');
assert(w('(s)=>s.dpFocus') === '2026-08-01', 'Home: первый день месяца');
w('(s)=>{s.datePopKeydown({key:"End",preventDefault(){}});}');
assert(w('(s)=>s.dpFocus') === '2026-08-31', 'End: последний день месяца');
w('(s)=>{s.datePopKeydown({key:"PageDown",preventDefault(){}});}');
assert(w('(s)=>s.dpM') === 8 && w('(s)=>s.dpFocus') === '2026-09-30', 'PageDown: следующий месяц, день зажат в границы');
w('(s)=>{s.datePopKeydown({key:"PageUp",preventDefault(){}});}');
assert(w('(s)=>s.dpM') === 7 && w('(s)=>s.dpFocus') === '2026-08-30', 'PageUp: возврат в август');
w('(s)=>{s.dpFocus="2026-08-01";s.datePopKeydown({key:"ArrowLeft",preventDefault(){}});}');
assert(w('(s)=>s.dpFocus') === '2026-08-01', 'ArrowLeft не уводит за границу месяца');
w('(s)=>{s.dpFocus="2026-08-31";s.datePopKeydown({key:"ArrowRight",preventDefault(){}});}');
assert(w('(s)=>s.dpFocus') === '2026-08-31', 'ArrowRight не уводит за границу месяца');
// Enter выбирает сфокусированный день и возвращает фокус в поле
const fakeDp2 = w('(s)=>{s.dpInput={value:"",dispatchEvent(){},focus(){}};return s.dpInput;}');
w('(s)=>{s.dpFocus="2026-08-15";s.datePopKeydown({key:"Enter",preventDefault(){}});}');
assert(fakeDp2.value === '2026-08-15', 'Enter выбирает сфокусированный день');
assert(registry['#datePop'].hidden === true, 'после Enter попап закрывается');
registry['#datePop'].hidden = false;
w('(s)=>{s.datePopKeydown({key:"Escape",preventDefault(){}});}');
assert(registry['#datePop'].hidden === true, 'Esc закрывает попап');
// Открытие: roving tabindex сразу на выбранной дате
w('(s)=>{const el={value:"2026-08-09",focus(){}};s.openDatePop(el);}');
assert(registry['#datePop'].hidden === false, 'openDatePop открывает попап');
assert(registry['#dpDays'].innerHTML.includes('data-dp-date="2026-08-09" tabindex="0"'), 'при открытии tabindex=0 на выбранной дате');
w('(s)=>s.closeDatePop()');
w('(s)=>s.jumpCalendar(0,2026)');
assert(registry['#calMonthSelect'].value === '0' && registry['#calYearSelect'].value === '2026', 'jumpCalendar умеет возвращаться (селекты)');

// --- Длительные события: диапазон дней ---
w('(s)=>{s.jumpCalendar(7,2026);s.db.events.push({id:"e9",title:"Путешествие",date:s.iso(2026,7,1),endDate:s.iso(2026,7,5),emoji:"✈️",repeat:false});s.renderCalendar();}');
assert(w('(s)=>s.eventsOn(s.iso(2026,7,1),7,1).some(e=>e.id==="e9")'), 'длительное событие есть в первый день');
assert(w('(s)=>s.eventsOn(s.iso(2026,7,3),7,3).some(e=>e.id==="e9")'), 'длительное событие есть в середине диапазона');
assert(!w('(s)=>s.eventsOn(s.iso(2026,7,6),7,6).some(e=>e.id==="e9")'), 'длительное событие не выходит за диапазон');
assert((registry['#calendar'].innerHTML.match(/✈️/g) || []).length === 5, 'календарь показывает событие на всех днях диапазона');
w('(s)=>{s.selectedDate=s.iso(2026,7,3);s.renderDayPanel();}');
assert(registry['#dayPanel'].innerHTML.includes('Путешествие'), 'длительное событие видно в панели дня');
assert(registry['#dayPanel'].innerHTML.includes('до 5 авг'), 'в панели дня показан конец диапазона');
w('(s)=>s.openEventModal("e9")');
assert(registry['#evEnd'].value === '2026-08-05', 'модалка помнит конец диапазона');

// --- Фото в событие через календарь ---
w('(s)=>{s.openEventModal();}');
registry['#evTitle'].value = 'Поездка в горы';
registry['#evDate'].value = '2026-08-20';
registry['#evEnd'].value = '2026-08-24';
w('(s)=>{s.evPhotoData=["data:image/jpeg;base64,BB=="];}');
w('(s)=>s.saveEventFromModal()');
const lastEv = w('(s)=>s.db.events[s.db.events.length-1]');
const evPhId = w('(s)=>s.db.events[s.db.events.length-1].photos[0]');
assert(lastEv.title === 'Поездка в горы' && Array.isArray(lastEv.photos) && lastEv.photos.length === 1 &&
  (() => { const ph = w(`(s)=>s.db.photos.find(p=>p.id==="${evPhId}")`); return ph && ph.id === evPhId; })(),
  'событие сохранило фото');
assert(lastEv.endDate === '2026-08-24' && lastEv.repeat === false, 'долгое событие сохраняет диапазон и не повторяется');
assert(w(`(s)=>s.db.photos.some(p=>p.id==="${evPhId}")`), 'фото события появилось в галерее');
assert(w('(s)=>s.db.labels.includes("📅 События")'), 'фото события получает общий лейбл «📅 События»');
assert(w('(s)=>s.db.labels.includes("Поездка в горы")') === false, 'лейбл-название события больше не создаётся');
assert(w(`(s)=>JSON.stringify(s.db.photos.find(p=>p.id==="${evPhId}").labels)`) === '["📅 События"]', 'фото события подписано общим лейблом');
assert(w(`(s)=>s.db.photos.find(p=>p.id==="${evPhId}").title`) === 'Поездка в горы', 'название события остаётся подписью фото');
await new Promise(r => setTimeout(r, 20)); // даём фоновой записи в photoStore завершиться
assert(w(`(s)=>s.db.photos.find(p=>p.id==="${evPhId}").data`) === undefined, 'данные фото события убраны из памяти после записи в store');
assert(w(`(s)=>s.photoStore.getMeta("${evPhId}")`) !== null, 'фото события записано в photoStore');
w('(s)=>{s.selectedDate="2026-08-20";s.renderDayPanel();}');
assert(registry['#dayPanel'].innerHTML.includes('ev-thumb'), 'панель дня показывает миниатюру фото события');
assert(registry['#dayPanel'].innerHTML.includes('data-photo-event'), 'в панели дня есть кнопка быстрого добавления фото');
// сиротский data-URL в старом событии без фото в галерее показывается напрямую
w('(s)=>{s.db.events.push({id:"orphanEv",title:"Сирота",date:s.iso(2026,8,5),repeat:false,photos:["data:image/jpeg;base64,DD=="]});return 1;}');
w('(s)=>{s.selectedDate=s.iso(2026,8,5);s.renderDayPanel();}');
assert(registry['#dayPanel'].innerHTML.includes('src="data:image/jpeg;base64,DD=="'), 'сиротский data-URL рефа показывается в панели дня напрямую');

// --- Витрина «📅 События» в галерее: фильтр кнопками «год → месяц → событие» ---
w('(s)=>{s.currentLabel="📅 События";s.renderPhotos();}');
assert(registry['#labelBar'].innerHTML.includes('📅 События'), 'в фильтре появился чип «События»');
assert(registry['#eventBar'].style.display === 'flex', 'витрина событий показана');
assert(registry['#eventYears'].innerHTML.includes('data-ev-year="2026"'), 'витрина показывает кнопки годов');
assert(registry['#eventMonths'].style.display === 'none', 'месяцы появляются только после выбора года');
assert(registry['#eventTitles'].style.display === 'none', 'события появляются только после выбора месяца');
assert(registry['#photosGrid'].innerHTML.includes('photo-caption'), 'в витрине фото подписаны названием события');
w('(s)=>{s.eventFilter.year="2026";s.renderPhotos();}');
assert(registry['#eventMonths'].style.display === 'flex' && registry['#eventMonths'].innerHTML.includes('Август'), 'после выбора года появляются кнопки месяцев');
assert(registry['#eventYears'].innerHTML.includes('ev-btn active'), 'выбранный год подсвечен');
w('(s)=>{s.eventFilter.month="08";s.renderPhotos();}');
assert(registry['#eventTitles'].style.display === 'flex' && registry['#eventTitles'].innerHTML.includes('Поездка в горы'), 'после выбора месяца появляются кнопки событий');
w('(s)=>{s.eventFilter.title="Поездка в горы";s.renderPhotos();}');
assert(registry['#photosGrid'].innerHTML.includes('Поездка в горы'), 'фильтр по событию внутри витрины работает');
assert(registry['#eventReset'].style.display === 'inline-block', 'при активном фильтре видна кнопка сброса');
w('(s)=>s.deleteLabel("📅 События")');
assert(w(`(s)=>s.db.photos.find(p=>p.id==="${evPhId}").labels.includes("📅 События")`), 'служебный лейбл «События» нельзя удалить');
w('(s)=>{s.eventFilter={year:"",month:"",title:""};s.currentLabel="";s.renderPhotos();}');

// --- Удаление фото убирает его и из события (в календаре не остаётся «мёртвых» миниатюр) ---
w(`(s)=>{const ph=s.db.photos.find(p=>p.id==="${evPhId}");s.deletePhoto(ph.id);}`);
assert(w(`(s)=>!s.db.photos.some(p=>p.id==="${evPhId}")`), 'удаление убирает фото из галереи');
assert(w('(s)=>{const ev=s.db.events.find(x=>x.title==="Поездка в горы");return !ev.photos || ev.photos.length===0;}'), 'удалённое фото убирается из события');

// --- v4-миграция: старые фото событий переходят на общий лейбл ---
w('(s)=>{s.db.events.push({id:"legacy",title:"Старое",date:s.iso(2026,6,1),photos:["data:legacy"]});s.db.photos.push({id:"oldph",data:"data:legacy",title:"Старое",labels:["Старое"],pinned:false,ts:1,order:0});s.relabelEventPhotos(s.db);}');
assert(w('(s)=>s.db.photos.find(p=>p.id==="oldph").labels.includes("📅 События")'), 'v4: старое фото события получает общий лейбл');
assert(w('(s)=>s.db.photos.find(p=>p.id==="oldph").labels.includes("Старое")') === false, 'v4: старый лейбл-название убран');

// --- После сохранения календарь перепрыгивает на месяц события ---
w('(s)=>{s.jumpCalendar(0,2026);s.openEventModal();}');
registry['#evTitle'].value = 'Отпуск на море';
registry['#evDate'].value = '2026-08-20';
registry['#evEnd'].value = '2026-08-24';
w('(s)=>s.saveEventFromModal()');
assert(registry['#calMonthSelect'].value === '7' && registry['#calYearSelect'].value === '2026', 'календарь перескочил на месяц сохранённого события (селекты)');
assert(registry['#calendar'].innerHTML.includes('Отпуск на море'), 'событие сразу видно в календаре после сохранения');
assert(/💜 Отпуск на море/.test(registry['#calendar'].innerHTML), 'в ячейке календаря видно название события рядом с эмодзи');
assert(w('(s)=>s.selectedDate') === '2026-08-20', 'после сохранения выделен день начала события');

// --- Конец раньше начала — событие не сохраняется ---
w('(s)=>{s.openEventModal();}');
registry['#evTitle'].value = 'Перепутанные даты';
registry['#evDate'].value = '2026-08-20';
registry['#evEnd'].value = '2026-08-19';
const evCountBefore = w('(s)=>s.db.events.length');
w('(s)=>s.saveEventFromModal()');
assert(w('(s)=>s.db.events.length') === evCountBefore, 'конец раньше начала не сохраняет событие');

// --- Календарь: «⏭ К ближайшему событию» ---
// Ближайшее событие — сегодня: в месяце ближайшего события кнопки и плашки нет
w('(s)=>{const d=new Date();s.db.events.push({id:"nx1",title:"Ближайшее событие",date:s.iso(d.getFullYear(),d.getMonth(),d.getDate()),emoji:"🎈",repeat:false});}');
const nx = w('(s)=>{const r=s.nextUpcoming();if(!r)return null;const [yy,mm]=r.date.split("-").map(Number);s.jumpToNearestEvent();return {date:r.date,title:r.title,m:mm-1,y:yy};}');
assert(nx && nx.date !== undefined, 'nextUpcoming: есть ближайшее событие/свидание');
assert(registry['#calMonthSelect'].value === String(nx.m) && registry['#calYearSelect'].value === String(nx.y), 'кнопка переключила календарь на месяц ближайшего события');
assert(w('(s)=>s.selectedDate') === nx.date, 'после прыжка выделен день ближайшего события');
assert(registry['#jumpInfo'].hidden === true, 'в месяце ближайшего события плашки нет');
assert(registry['#jumpNextBtn'].hidden === true, 'в месяце ближайшего события кнопки нет');

// Смотрим месяц без ближайшего события → появляются кнопка и плашка с описанием
w('(s)=>{s.jumpCalendar(0,2026);}');
assert(registry['#jumpInfo'].hidden === false && registry['#jumpInfo'].textContent.includes(nx.title), 'в другом месяце плашка рассказывает о ближайшем событии');
assert(registry['#jumpNextBtn'].hidden === false, 'в другом месяце кнопка перехода видна');

// Даже месяц со своими событиями (2027), но без ближайшего → кнопка есть
w('(s)=>{s.db.events.push({id:"far27",title:"Событие 2027",date:"2027-01-15",emoji:"🚀",repeat:false});s.jumpCalendar(0,2027);}');
assert(registry['#jumpNextBtn'].hidden === false, 'кнопка видна и в месяце со своими событиями, если ближайшее не здесь');

// Клик по кнопке возвращает к ближайшему событию
w('(s)=>s.jumpToNearestEvent()');
assert(w('(s)=>s.selectedDate') === nx.date, 'повторный клик снова прыгает к ближайшему событию');
assert(registry['#jumpInfo'].hidden === true, 'после возврата плашка скрыта');

// --- Календарь: открытие вкладки показывает текущий месяц, без прыжка ---
w('(s)=>{s.jumpCalendar(0,2020);s.go("calendar");}');
const nowCal = new Date();
assert(w('(s)=>s.calM') === nowCal.getMonth() && w('(s)=>s.calY') === nowCal.getFullYear(), 'открытие календаря показывает текущий месяц (без прыжка)');
assert(w('(s)=>s.selectedDate') === null, 'открытие календаря не выделяет день ближайшего события');

// --- drag&drop заметок: чистая логика перестановки (порядок ids) ---
assert(JSON.stringify(w('(s)=>s.reorderNoteIds(["a","b","c"],"a","c",true)')) === '["b","c","a"]', 'reorderNoteIds: перенос в конец');
assert(JSON.stringify(w('(s)=>s.reorderNoteIds(["a","b","c"],"c","a",false)')) === '["c","a","b"]', 'reorderNoteIds: перенос в начало');
assert(JSON.stringify(w('(s)=>s.reorderNoteIds(["a","b","c"],"b","c",true)')) === '["a","c","b"]', 'reorderNoteIds: перенос в середину');

// --- Заметки: автор, редактирование, drag&drop ---
w('(s)=>{s.db.notes.length=0;s.db.notes.push({id:"n1",text:"Заметка Гоши",ts:1,pinned:false,author:"gosha",order:1});s.db.notes.push({id:"n2",text:"Заметка Даши",ts:2,pinned:true,author:"dasha",order:0});s.go("notes");}');
const notesHtml = registry['#notesGrid'].innerHTML;
assert(notesHtml.includes('👦 Гоша') && notesHtml.includes('👧 Даша'), 'в заметке виден автор');
assert(notesHtml.includes('data-edit-note'), 'у заметки есть кнопка ✏️ редактирования');
assert(notesHtml.includes('data-note-drag'), 'у заметки есть драг-ручка ⠿ (Pointer Events drag)');
assert(notesHtml.indexOf('Заметка Даши') < notesHtml.indexOf('Заметка Гоши'), 'закреплённая заметка выше');
w('(s)=>{const a=s.db.notes.find(x=>x.id==="n1");const b=s.db.notes.find(x=>x.id==="n2");a.pinned=false;b.pinned=false;a.order=0;b.order=1;s.renderNotes();}');
assert(registry['#notesGrid'].innerHTML.indexOf('Заметка Гоши') < registry['#notesGrid'].innerHTML.indexOf('Заметка Даши'), 'drag&drop-порядок (order) применяется');
w('(s)=>s.startEditNote("n1")');
assert(registry['#notesGrid'].innerHTML.includes('note-editor'), 'редактирование: появилось поле ввода');
w('(s)=>s.saveNoteEdit("n1","Обновлённый текст")');
assert(w('(s)=>s.db.notes.find(x=>x.id==="n1").text') === 'Обновлённый текст', 'правка сохраняет текст заметки');
assert(w('(s)=>s.db.notes.find(x=>x.id==="n1").author') === 'gosha', 'автор сохраняется при правке');
assert(registry['#notesGrid'].innerHTML.includes('note-editor') === false, 'после сохранения поле ввода закрывается');
// Удалять и закреплять может любой
w('(s)=>s.togglePinNote("n1")');
assert(w('(s)=>s.db.notes.find(x=>x.id==="n1").pinned') === true, 'закрепить заметку может любой');
w('(s)=>s.deleteNote("n2")');
assert(!w('(s)=>s.db.notes.some(x=>x.id==="n2")'), 'удалить заметку может любой');



// --- Таймер до события ---
w('(s)=>{s.renderCountdown();}');
assert(registry['#countdown'].hidden === false, 'таймер показывается при будущем событии');
// Смысл проверки — тик реально заполнен, а не остался заглушкой «…».
// Формат не важен: если ближайшая цель ближе суток, будет «чч:мм:сс», иначе «N дн. чч:мм:сс»
// (зависит от текущей даты — фиксированных дат в тесте много).
const countdownTickText = registry['#countdownTick'].textContent || '';
assert(countdownTickText !== '' && countdownTickText !== '…' && /\d/.test(countdownTickText), 'таймер тикает (не заглушка «…»)');

// --- Хотелки ---
w('(s)=>{s.db.wishlist.push({id:"w1",type:"want",text:"Плед",link:"https://x",data:"",owner:"gosha",done:false,ts:1});s.db.wishlist.push({id:"w2",type:"give",text:"Билеты в театр",data:"",owner:"dasha",done:false,ts:2});s.renderWishlist();}');
const wishHtml = registry['#wishlistGrid'].innerHTML;
assert(wishHtml.includes('Плед'), 'хотелка Гоши отрисована');
assert(wishHtml.includes('Билеты в театр'), 'хотелка Даши отрисована');
assert(wishHtml.includes('Хотелки Гоши') && wishHtml.includes('Хотелки Даши'), 'вишлист разделён по людям');
assert(wishHtml.includes('wish-link'), 'ссылка в хотелке есть');
w('(s)=>{const x=s.db.wishlist.find(v=>v.id==="w1");x.done=true;s.renderWishlist();}');
assert(registry['#wishlistGrid'].innerHTML.includes('wish done'), 'выполненная хотелка помечена');

// --- Вишлист: «исполнено другим» + исполненные вниз списка ---
w('(s)=>{s.setUser("gosha");}');
w('(s)=>{s.db.wishlist.length=0;s.db.wishlist.push({id:"g1",text:"Мечта Гоши",owner:"gosha",done:false,ts:1});s.db.wishlist.push({id:"g2",text:"Ещё мечта",owner:"gosha",done:true,doneBy:"dasha",doneAt:1750000000000,ts:2});s.db.wishlist.push({id:"d1",text:"Мечта Даши",owner:"dasha",done:false,ts:3});s.renderWishlist();}');
const wgHtml = registry['#wishlistGrid'].innerHTML;
assert(wgHtml.includes('Исполнено Дашей'), 'видно, кто исполнил хотелку');
assert(wgHtml.indexOf('Ещё мечта') > wgHtml.indexOf('Мечта Гоши'), 'исполненная хотелка уходит вниз списка');
assert(wgHtml.includes('wish-hint'), 'свою хотелку нельзя исполнить самому — подсказка');
const wdCan = w('(s)=>s.wishCard({id:"d9",text:"x",owner:"dasha",done:false,ts:9})');
assert(wdCan.includes('data-wish-done'), 'чужую хотелку можно исполнить — кнопка есть');
const wdOwn = w('(s)=>s.wishCard({id:"g9",text:"x",owner:"gosha",done:false,ts:9})');
assert(!wdOwn.includes('data-wish-done'), 'своей хотелки кнопки «исполнить» нет');
const wdUndo = w('(s)=>s.wishCard({id:"x",text:"x",owner:"dasha",done:true,doneBy:"gosha",doneAt:1,ts:1})');
assert(wdUndo.includes('data-wish-done') && wdUndo.includes('Снять отметку'), 'исполнивший может снять отметку');
const wdLocked = w('(s)=>s.wishCard({id:"x",text:"x",owner:"dasha",done:true,doneBy:"dasha",doneAt:1,ts:1})');
assert(!wdLocked.includes('data-wish-done'), 'чужую отметку нельзя снять');

// --- Списки: произвольные блоки вместо жёстких «Покупки/Дела» ---
w('(s)=>{s.db.lists=[{id:"L1",name:"Подарки",items:[]},{id:"L2",name:"Дела",items:[]}];s.renderLists();return 1;}');
let listsHtml = registry['#listsWrap'].innerHTML;
assert(listsHtml.includes('Подарки') && listsHtml.includes('Дела'), 'произвольные списки рендерятся карточками');
assert(listsHtml.includes('listInput-L1') && listsHtml.includes('data-list-add="L1"'), 'у списка есть поле и кнопка подзадачи');
assert(listsHtml.includes('data-list-complete="L1"'), 'у списка есть действие «выполнить список»');
w('(s)=>{s.db.lists=[];s.renderLists();return 1;}');
assert(registry['#listsWrap'].innerHTML.includes('Пока нет ни одного списка'), 'пустое состояние списков');
// создание списка
const newList = w('(s)=>s.createList("План на выходные")');
assert(newList !== null && w('(s)=>s.db.lists.some(l=>l.name==="План на выходные")'), 'createList добавляет список с произвольным названием');
assert(w('(s)=>s.db.lists[0].name') === 'План на выходные', 'новый список появляется сверху');
assert(w('(s)=>s.createList("   ")') === null, 'пустое название списка отклоняется');
// подзадачи: добавить, выполнить/снять, удалить (L1 вернули после проверки пустого состояния)
w('(s)=>{s.db.lists.unshift({id:"L1",name:"Подарки",items:[]},{id:"L2",name:"Дела",items:[]}); return 1;}');
w('(s)=>{s.document.querySelector("#listInput-L1").value="Купить цветы"; return 1;}');
assert(w('(s)=>s.addListSubtask("L1","listInput-L1")') === true, 'добавление подзадачи в список');
assert(w('(s)=>s.db.lists.find(l=>l.id==="L1").items.length') === 1, 'подзадача сохранена в списке');
assert(w('(s)=>s.db.lists.find(l=>l.id==="L1").items[0].text') === 'Купить цветы', 'текст подзадачи сохранён');
const subId = w('(s)=>s.db.lists.find(l=>l.id==="L1").items[0].id');
assert(w(`(s)=>s.toggleSubtask("L1","${subId}")`) === true, 'подзадача выполняется (done=true)');
assert(w(`(s)=>s.toggleSubtask("L1","${subId}")`) === false, 'выполнение подзадачи снимается');
w(`(s)=>{const l=s.db.lists.find(x=>x.id==="L1");l.items=[{id:"i1",text:"х",done:false},{id:"i2",text:"y",done:false}];s.delSubtask("L1","i1");return 1;}`);
assert(w('(s)=>s.db.lists.find(l=>l.id==="L1").items.length') === 1, 'подзадача удаляется из списка');
// выполненные подзадачи улетают вниз списка (порядок в db и в рендере)
w('(s)=>{const l=s.db.lists.find(x=>x.id==="L1"); l.items=[{id:"a1",text:"Первая",done:false},{id:"b1",text:"Вторая",done:false}]; s.toggleSubtask("L1","b1"); return 1;}');
assert(w('(s)=>{const l=s.db.lists.find(x=>x.id==="L1"); return l.items.map(i=>i.id).join(",");}') === 'a1,b1', 'выполненная подзадача переезжает в конец списка');
w('(s)=>{const l=s.db.lists.find(x=>x.id==="L1"); l.items=[{id:"c1",text:"Сделано",done:true},{id:"d1",text:"Активно",done:false}]; s.renderLists(); return 1;}');
const subSortedHtml = registry['#listsWrap'].innerHTML;
assert(subSortedHtml.indexOf('Активно') < subSortedHtml.indexOf('class="done"'), 'в рендере выполненные подзадачи ниже невыполненных');
// «выполнить список» — подтверждение (confirm=true в песочнице) и удаление блока
assert(w('(s)=>s.completeList("L2")') === true, '«выполнить список» возвращает true');
assert(w('(s)=>!s.db.lists.some(l=>l.id==="L2")'), '«выполнить список» удаляет весь блок');
// миграция v8: старые «Покупки» и «Дела» становятся списками
assert(w('(s)=>s.migrateDB({events:[],notes:[],shopping:[{id:"s1",text:"Хлеб",done:false}],todos:[{id:"t1",text:"Позвонить",done:false}],photos:[],dates:[],wishlist:[],labels:[]}).lists.length') === 2,
  'миграция v8: старые покупки и дела стали списками');
assert(w('(s)=>s.migrateDB({events:[],notes:[],shopping:[{id:"s1",text:"Хлеб",done:false}],todos:[{id:"t1",text:"Позвонить",done:false}],photos:[],dates:[],wishlist:[],labels:[]}).shopping.length') === 0,
  'миграция v8: легаси-поле shopping очищено');

// --- Фото: лейблы вместо альбомов, выбор нескольких ---
w('(s)=>{s.db.photos.push({id:"p2",data:"data:image/jpeg;base64,AA==",title:"море",labels:["Поездка","Семья"],pinned:false,ts:2,order:1});s.db.photos.push({id:"p3",data:"data:image/jpeg;base64,AA==",title:"кафе",labels:["Свидание"],pinned:false,ts:3,order:2});s.db.labels=["Поездка","Семья","Свидание"];s.renderPhotos();}');
let phHtml = registry['#photosGrid'].innerHTML;
assert(phHtml.includes('data-photo-drag'), 'у фото есть драг-ручка ⠿ (Pointer Events drag)');
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

// --- Фото: дебаунс рендера (без requestAnimationFrame — синхронно) ---
w('(s)=>{s.photosRenderQueued=false;s.renderPhotos();}');
assert(registry['#photosGrid'].innerHTML.length > 0, 'renderPhotos без rAF рендерит синхронно');
assert(w('(s)=>{s.photosRenderQueued=true;return s.renderPhotos();}') === 'coalesced', 'повторный вызов в одном кадре схлопывается');
assert(w('(s)=>s.photosRenderQueued') === true, 'флаг очереди держится до фактического рендера');
w('(s)=>{s.photosRenderQueued=false;s.renderPhotos();}');

// --- Фото: drag&drop лейблов (логика) + крестик ✕ на бейдже фото ---
w('(s)=>{s.db.photos.push({id:"p4",data:"data:image/jpeg;base64,AA==",title:"п4",labels:[],pinned:false,ts:4,order:4});}');
w('(s)=>{s.applyLabelToPhotos("Драго",["p4","p2"]);}');
assert(w('(s)=>s.db.photos.find(p=>p.id==="p4").labels.includes("Драго")'), 'drag&drop: лейбл получило перетаскиваемое фото');
assert(w('(s)=>s.db.photos.find(p=>p.id==="p2").labels.includes("Драго")'), 'drag&drop: лейбл получили и отмеченные фото');
w('(s)=>{s.selectedPhotos.add("p2");s.applyLabelToSelected("Новое");}');
assert(w('(s)=>s.db.photos.find(p=>p.id==="p2").labels.includes("Новое")'), 'применение лейбла к выбранным работает');
assert(w('(s)=>s.selectedPhotos.size') === 0, 'после применения лейбла выделение снимается');
w('(s)=>s.removeLabelFromPhoto("p2","Новое")');
assert(w('(s)=>s.db.photos.find(p=>p.id==="p2").labels.includes("Новое")') === false, 'крестик ✕ убирает лейбл с конкретного фото');
assert(w('(s)=>s.db.photos.some(p=>p.id==="p2")'), 'фото при этом остаётся на месте');
w('(s)=>{s.db.photos.push({id:"pev",data:"data:image/jpeg;base64,AA==",title:"событие",labels:["📅 События"],pinned:false,ts:5,order:5});s.renderPhotos();}');
const pOffHtml = registry['#photosGrid'].innerHTML;
assert(pOffHtml.includes('data-label-off="Драго"'), 'у обычного лейбла на фото есть крестик ✕');
assert(!pOffHtml.includes('data-label-off="📅 События"'), 'у служебного лейбла «События» крестика нет');

// --- Настройки: резервная копия, место и личный кабинет ---
w('(s)=>s.go("settings")');
w('(s)=>s.renderSettings()');
assert(registry['#backupHint'].innerHTML.includes('копия ещё не делалась'), 'напоминание о бэкапе');
assert(/КБ|МБ/.test(registry['#storageInfo'].textContent), 'место в браузере показано');
assert(registry['#lkUser'].textContent === '👦 Гоша', 'в ЛК видно текущего пользователя');
assert(registry['#lkPassInfo'].innerHTML.includes('пароль есть') && registry['#lkPassInfo'].innerHTML.includes('пароля нет'), 'ЛК показывает статус паролей');
assert(registry['#addPassBtn'].style.display === '', 'кнопка «пароль для партнёра» видна');

// --- Настройки: переключатель «Отключить анимации» ---
w('(s)=>{s.localStorage.removeItem("universe_motion");s.applyMotion(null);}');
assert(w('(s)=>s.getMotion()') === null, 'анимации: явный выбор не сделан — по умолчанию уважаем систему');
assert(w('(s)=>s.motionReduced()') === false, 'в песочнице системного reduced-motion нет');
w('(s)=>s.setMotion("reduced")');
assert(w('(s)=>s.getMotion()') === 'reduced', 'переключатель запоминает выбор');
assert(w('(s)=>{const d=s.document.documentElement;return d.dataset.motion;}') === 'reduced', 'на <html> выставлен data-motion=reduced');
assert(w('(s)=>s.motionReduced()') === true, 'motionReduced видит отключённые анимации');
assert(registry['#motionToggle'].checked === true, 'чекбокс отмечен при выключенных анимациях');
w('(s)=>s.setMotion("full")');
assert(w('(s)=>s.getMotion()') === 'full', 'выбор «оставить анимации» сохраняется');
assert(w('(s)=>s.motionReduced()') === false, 'явное «full» перекрывает системную настройку');
assert(registry['#motionToggle'].checked === false, 'чекбокс снят при включённых анимациях');

// --- Пароль для Даши ---
assert(await w('(s)=>s.savePassFor("dasha","654321")') === true, 'пароль Даши добавлен');
assert(w('(s)=>s.loadVault().keys.length') === 2, 'в сейфе теперь два ключа');

// --- Смена пароля Гоши ---
assert(await w('(s)=>s.changePass("wrong","x")') === false, 'смена с неверным текущим паролем отклонена');
assert(await w('(s)=>s.changePass("123456","gosha-new")') === true, 'свой пароль сменён');
assert(await w('(s)=>s.unlockWith("gosha","123456")') === false, 'старый пароль больше не работает');
assert(await w('(s)=>s.unlockWith("gosha","gosha-new")') === true, 'новый пароль работает');

// --- Замок вычищает память ---
w('(s)=>s.lock()');
assert(w('(s)=>s.isLocked()') === true, 'замок активирован');
assert(w('(s)=>s.masterKey') === null, 'ключ выброшен из памяти при блокировке');
assert(w('(s)=>s.db.photos.length') === 0, 'данные очищены из памяти при блокировке');

// --- Вход Даши своим паролем ---
assert(await w('(s)=>s.unlockWith("dasha","654321")') === true, 'Даша входит своим паролем');
assert(w('(s)=>s.currentUser') === 'dasha', 'система знает: вошла Даша');
assert(w('(s)=>s.db.labels.includes("Поездка")'), 'Даша видит те же данные');
assert(registry['#userChip'].textContent === '👧 Даша ▾', 'чип показывает Дашу');

// --- Экспорт — зашифрованный сейф без открытого текста ---
const exp = await w('(s)=>s.exportData()');
const expJson = JSON.stringify(exp);
assert(expJson.includes('"keys"') && expJson.includes('"ver"'), 'экспорт — это сейф');
assert(!expJson.includes('Поездка') && !expJson.includes('кафе'), 'в экспорте нет открытого текста');
assert(await w('(s)=>s.importData(' + JSON.stringify(expJson) + ')') === true, 'импорт распознаёт сейф');

// --- Импорт старого открытого бэкапа — сразу шифруется ---
const legacyBackup = JSON.stringify({ events: [{ id: 'x1', title: 'Тайное', date: '2026-05-01', emoji: '💜', repeat: true }], notes: [], shopping: [], todos: [], photos: [], dates: [], wishlist: [] });
w('(s)=>s.importData(' + JSON.stringify(legacyBackup) + ')');
await w('(s)=>s.save()'); // дожидаемся очереди шифрования
assert(w('(s)=>s.db.events.some(e=>e.title==="Тайное")'), 'старый бэкап импортирован в db');
assert(!JSON.stringify(w('(s)=>s.loadVault()')).includes('Тайное'), 'импортированное сразу зашифровано');

// --- Конфетти не падает ---
w('(s)=>s.celebrate()');
assert(true, 'celebrate не бросает исключений');

// --- Все вкладки рендерятся ---
for (const v of ['home', 'calendar', 'notes', 'lists', 'wishlist', 'photos', 'song', 'settings']) {
  w('(s)=>s.go(' + JSON.stringify(v) + ')');
}
assert(true, 'all views rendered without errors');

// --- Регрессии после аудита ---
assert(registry['#calMonthSelect'] && !isNaN(+registry['#calMonthSelect'].value) && !isNaN(+registry['#calYearSelect'].value), 'селекты месяца/года без «undefined»');
assert(registry['#calendar'].innerHTML.includes('tabindex="0"'), 'ячейки календаря доступны с клавиатуры');
w('(s)=>{s.countdownTarget = Date.now() - 1000; s.tickCountdown(); return 1;}');
assert(/\d+\s*дн\./.test(registry['#countdownTick'].textContent || ''), 'таймер сам пересчитывает цель после наступления');

// --- Регрессия: создание события кликом по кнопке «＋ Добавить дату» ---
// Раньше addEventListener('click', openEventModal) передавал MouseEvent как id:
// модалка открывалась в режиме «Изменить дату» и событие молча терялось.
const addEvBtn = registry['#addEventBtn'];
const addEvClicks = (addEvBtn._handlers || {}).click || [];
assert(addEvClicks.length >= 1, 'на кнопке «＋ Добавить дату» есть обработчик клика');
addEvClicks[0]({ type: 'click', target: addEvBtn }); // браузер передаёт MouseEvent
assert(registry['#evModalTitle'].textContent === '💜 Памятная дата',
  'модалка нового события — «Памятная дата», а не «Изменить дату»');
assert(w('(s)=>s.editingEventId') === null, 'создание через кнопку не ставит editingEventId');
registry['#evTitle'].value = 'Клик-событие';
registry['#evDate'].value = '2026-08-10';
registry['#evEnd'].value = '2026-08-18';
registry['#evRepeat'].checked = false;
(registry['#evSave']._handlers.click || []).forEach(fn => fn());
assert(w('(s)=>s.db.events.some(e=>e.title==="Клик-событие" && e.date==="2026-08-10")'),
  'событие, созданное кликом по кнопке, сохранено в db.events');
assert(registry['#calendar'].innerHTML.includes('Клик-событие'),
  'созданное кликом событие видно в календаре');

// --- deletePhoto чистит и галерею, и события (ev.photos хранит id фото) ---
w('(s)=>{s.db.photos.push({id:"phDel",data:"data:image/jpeg;base64,AAA=",title:"Фото для удаления",labels:["📅 События"],pinned:false,ts:1,order:0});s.db.events[0].photos=["phDel"];return 1;}');
w('(s)=>s.deletePhoto("phDel")');
assert(w('(s)=>s.db.photos.some(p=>p.id==="phDel")') === false, 'deletePhoto удаляет фото из галереи');
assert(w('(s)=>s.db.events.every(e=>!(e.photos||[]).includes("phDel"))') === true,
  'deletePhoto убирает фото из событий');

// --- Витрина «📅 События»: фильтр «год → месяц → событие» ---
w('(s)=>{s.db.photos.push({id:"phEv",data:"data:image/jpeg;base64,BBB=",title:"Фото события",labels:["📅 События"],pinned:false,ts:2,order:0});s.db.events.push({id:"evF",title:"Поездка в горы",date:"2026-07-14",repeat:false,photos:["phEv"]});s.currentLabel="📅 События";s.eventFilter={year:"2026",month:"07",title:"Поездка в горы"};return 1;}');
w('(s)=>s.renderPhotos()');
assert(w('(s)=>s.filteredPhotos().some(p=>p.id==="phEv")') === true, 'фильтр «События» показывает фото с лейблом события');
assert(w('(s)=>s.filteredPhotos().length') === 1, 'фильтр год→месяц→событие сужает список до одного фото');
assert(registry['#eventYears'].innerHTML.includes('data-ev-year="2026"'), 'витрина показывает год');
assert(registry['#eventMonths'].innerHTML.includes('data-ev-month="07"'), 'витрина показывает месяц');
assert(registry['#eventTitles'].innerHTML.includes('data-ev-title="Поездка в горы"'), 'витрина показывает название события');
w('(s)=>{s.currentLabel="";s.eventFilter={year:"",month:"",title:""};return 1;}');

// --- safeUrl: «javascript:»-ссылка не попадает в href хотелки ---
w('(s)=>{s.db.wishlist.push({id:"wX",text:"Опасная",link:"javascript:alert(1)",owner:"gosha",done:false,ts:1});s.renderWishlist();return 1;}');
assert(!registry['#wishlistGrid'].innerHTML.includes('href="javascript:'), 'javascript:-ссылка заменена заглушкой');
w('(s)=>{s.db.wishlist.push({id:"wOK",text:"Безопасная",link:"https://example.com",owner:"gosha",done:false,ts:2});s.renderWishlist();return 1;}');
assert(registry['#wishlistGrid'].innerHTML.includes('href="https://example.com"'), 'обычная ссылка остаётся в href');

// --- photoStore: миграция, кэш миниатюр, экспорт/импорт блобов ---
await w('(s)=>{s.db.photos.push({id:"psOld",data:"data:image/webp;base64,"+btoa("photo1"),title:"Старое",labels:[],pinned:false,ts:1,order:0});return 1;}');
const movedCount = await w('(s)=>s.photoStore.migratePhotos(s.db)');
assert(movedCount >= 1, 'migratePhotos переносит data-URL в хранилище');
assert(await w('(s)=>s.photoStore.getMeta("psOld")') !== null, 'фото лежит в хранилище с метаданными');
assert(w('(s)=>s.db.photos.find(p=>p.id==="psOld").data') === undefined, 'p.data удалён из памяти после миграции');
// миграция переводит ссылки событий с data-URL на id фото
await w('(s)=>{s.db.photos.push({id:"psOld2",data:"data:image/webp;base64,"+btoa("photo2"),title:"Второе",labels:[],pinned:false,ts:2,order:0});s.db.events.push({id:"psEv",title:"Миграция",date:"2026-01-01",photos:["data:image/webp;base64,"+btoa("photo2")],repeat:true});return 1;}');
await w('(s)=>s.photoStore.migratePhotos(s.db)');
assert(w('(s)=>s.db.events.find(e=>e.id==="psEv").photos[0]') === 'psOld2', 'миграция переводит ссылку события на id фото');
assert(w('(s)=>s.db.photos.find(p=>p.id==="psOld2").data') === undefined, 'миграция удаляет data-URL из памяти');
// без canvas миниатюра не генерируется (graceful fallback)
assert(await w('(s)=>s.makeThumbBlob("data:image/jpeg;base64,AA==")') === null, 'без canvas миниатюра не генерируется (graceful)');
// кэш миниатюр: warmThumbCache прогревает, photoSrc отдаёт URL
await w('(s)=>s.warmThumbCache()');
assert(w('(s)=>s.getThumbUrl("psOld")') !== null, 'warmThumbCache заполняет кэш миниатюр');
assert(await w('(s)=>s.photoUrl(s.db.photos.find(p=>p.id==="psOld"), true)') !== '', 'photoUrl возвращает data-URL');
// photoSrc синхронно отдаёт из кэша
assert(w('(s)=>s.photoSrc(s.db.photos.find(p=>p.id==="psOld"))') !== '', 'photoSrc отдаёт src из кэша');
// --- Легаси p.data убран из рендеров: photoSrc/photoUrl отдают только кэш и store ---
w('(s)=>{s.db.photos.push({id:"nolegacy",data:"data:image/jpeg;base64,CC==",title:"x",labels:[],pinned:false,ts:99,order:99});return 1;}');
assert(w('(s)=>s.photoSrc(s.db.photos.find(p=>p.id==="nolegacy"))') === '', 'photoSrc не отдаёт p.data — только кэш миниатюр');
assert(await w('(s)=>s.photoUrl(s.db.photos.find(p=>p.id==="nolegacy"), true)') === '', 'photoUrl не отдаёт p.data, если фото нет в store');
assert(w('(s)=>s.photoByRef("data:image/jpeg;base64,CC==")') === null, 'photoByRef не ищет фото по data-URL');
assert(w('(s)=>s.photoByRef("psOld")') !== null, 'photoByRef находит фото по id');
assert(w('(s)=>JSON.stringify(s.addEventPhotosToGallery(["psOld"],"Ещё"))') === '["psOld"]', 'addEventPhotosToGallery находит существующее фото по id');
w('(s)=>{s.db.photos.splice(s.db.photos.findIndex(p=>p.id==="nolegacy"),1);return 1;}');
assert(w('(s)=>s.db.photos.filter(p=>p.id==="psOld").length') === 1, 'addEventPhotosToGallery по id не создаёт дубль фото');
// экспорт блобов и импорт
const blobs = await w('(s)=>s.photoStore.exportBlobs()');
assert(blobs.some(b => b.id === 'psOld' && b.full), 'exportBlobs отдаёт зашифрованные блобы');
await w('(s)=>{s.photoStore.clear(); return 1;}');
assert(await w('(s)=>s.photoStore.getMeta("psOld")') === null, 'после clear фото в хранилище нет');
await w('(s)=>s.photoStore.importBlobs(' + JSON.stringify(blobs) + ')');
assert(await w('(s)=>s.photoStore.getMeta("psOld")') !== null, 'importBlobs восстанавливает фото');
// refreshSizes считает байты
const sizes = await w('(s)=>s.photoStore.refreshSizes()');
assert(sizes.count >= 1 && sizes.bytes >= 0, 'refreshSizes возвращает количество и объём');
// блокировка очищает хранилище и кэш
await w('(s)=>s.save()'); // фиксируем фото в сейфе
w('(s)=>s.lock()');
assert(w('(s)=>s.getThumbUrl("psOld")') === null, 'lock очищает кэш миниатюр');
assert(await w('(s)=>s.unlockWith("dasha","654321")') === true, 'повторный вход Даши работает');
assert(w('(s)=>s.db.photos.some(p=>p.id==="psOld")'), 'после входа фото на месте');

// --- Сброс очищает сейф ---
w('(s)=>{s.localStorage.removeItem("universe_vault"); s.localStorage.removeItem("universe");}');
assert(w('(s)=>s.loadVault()') === null, 'после сброса сейфа нет');

// --- Фаза B: «В этот день», даты фото, память-дерево ---
w('(s)=>{s.db.events=[]; s.db.notes=[]; s.db.photos=[]; s.db.dates=[]; return 1;}');
// фото с EXIF-датой, фото с привязкой к событию и фото только с датой загрузки
w('(s)=>{s.db.photos.push({id:"ph1", takenAt:new Date(2025,7,7).getTime(), title:"Лето"}); return 1;}');
w('(s)=>{s.db.events.push({id:"ev1", date:"2025-08-07", title:"День в парке", emoji:"🌳", photos:["ph2"]}); s.db.photos.push({id:"ph2", title:"Парк"}); return 1;}');
w('(s)=>{s.db.photos.push({id:"ph3", ts:new Date(2025,7,7).getTime(), title:"Загрузка"}); return 1;}');
w('(s)=>{s.db.notes.push({id:"n1", text:"Вспомнили поездку", ts:new Date(2025,7,7,12).getTime(), author:"gosha", order:0}); return 1;}');
w('(s)=>{s.db.events.push({id:"ev2", date:"2025-08-07", title:"Пикник", emoji:"🧺"}); return 1;}');

assert(w('(s)=>s.photoDate(s.db.photos.find(p=>p.id==="ph1"))') === '2025-08-07', 'photoDate: EXIF-дата снимка');
assert(w('(s)=>s.photoDate(s.db.photos.find(p=>p.id==="ph2"))') === '2025-08-07', 'photoDate: дата события');
assert(w('(s)=>s.photoDate(s.db.photos.find(p=>p.id==="ph3"))') === null, 'photoDate: только дата загрузки → null');

const otd = w('(s)=>s.onThisDayItems(new Date(2026,7,7))');
assert(Array.isArray(otd) && otd.length === 5, 'в этот день: 2 события+заметка+2 фото, но не фото с ts');
assert(otd.some(i => i.kind === 'event' && i.title === 'Пикник'), 'в этот день: событие прошлого года');
assert(otd.some(i => i.kind === 'note' && i.text === 'Вспомнили поездку'), 'в этот день: заметка прошлого года');
assert(otd.some(i => i.kind === 'photo' && i.p && i.p.id === 'ph1'), 'в этот день: фото по EXIF');
assert(otd.some(i => i.kind === 'photo' && i.p && i.p.id === 'ph2'), 'в этот день: фото по дате события');
assert(!otd.some(i => i.p && i.p.id === 'ph3'), 'в этот день: фото только с датой загрузки НЕ показывается');

// Память-дерево: группировка по дням
const mb = w('(s)=>s.memoryByDay()');
assert(mb.some(d => d.date === '2025-08-07'), 'память: день с событиями есть');
assert(mb.some(d => d.photos.some(p => p.id === 'ph1')), 'память: фото с EXIF');
assert(mb.some(d => d.events.some(e => e.photos.some(p => p.id === 'ph2'))), 'память: фото события — в карточке события');
assert(!mb.some(d => d.photos.some(p => p.id === 'ph2')), 'память: фото события НЕ дублируется в сетке дня');
assert(!mb.some(d => d.photos.some(p => p.id === 'ph3')), 'память: фото только с ts НЕ попадает');
assert(mb.some(d => d.events.some(e => e.title === 'Пикник')), 'память: событие на месте');
assert(mb.every(d => !d.notes), 'память: заметок нет');
// Свидание — только done=true попадает
w('(s)=>{s.db.dates.push({id:"d1",date:"2025-08-07",place:"Кафе",emoji:"💘",done:true,responses:{}}); return 1;}');
w('(s)=>{s.db.dates.push({id:"d2",date:"2025-08-07",place:"Отмена",emoji:"💔",done:false,responses:{}}); return 1;}');
const mb2 = w('(s)=>s.memoryByDay()');
const day0807 = mb2.find(d => d.date === '2025-08-07');
assert(day0807 && day0807.dates.some(dd => dd.place === 'Кафе'), 'память: прошедшее свидание есть');
assert(day0807 && !day0807.dates.some(dd => dd.place === 'Отмена'), 'память: отменённое свидание не попадает');
// EXIF-фото, привязанное к событию, показывается только в карточке события — без дубля
w('(s)=>{s.db.photos.push({id:"ph4", takenAt:new Date(2025,7,7).getTime(), title:"Лето4"}); s.db.events[1].photos=["ph4"]; return 1;}');
const mb3 = w('(s)=>s.memoryByDay()');
const day3 = mb3.find(d => d.date === '2025-08-07');
assert(day3 && day3.events.some(e => e.title === 'Пикник' && e.photos.some(p => p.id === 'ph4')), 'память: EXIF-фото события в карточке события');
assert(day3 && !day3.photos.some(p => p.id === 'ph4'), 'память: EXIF-фото события НЕ в сетке дня');

// Рендер памяти-дерева не падает
w('(s)=>{s.db.photos=[{id:"ph1", takenAt:new Date(2025,7,7).getTime(), title:"Лето"}]; return 1;}');
w('(s)=>{s.renderMemory(); return 1;}');
assert(registry['#memoryFeed'].innerHTML.includes('tl-card'), 'дерево «Память» рендерит карточки');

// --- Память: фото ряда сворачиваются (3 сразу, остальные за кнопкой «ещё») ---
w('(s)=>{s.db.photos=' + JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ id: 'mp' + i, takenAt: new Date(2025, 7, 7).getTime(), title: 'Ф' + i }))) + '; return 1;}');
w('(s)=>{s.renderMemory(); return 1;}');
const memHtml = registry['#memoryFeed'].innerHTML;
assert((memHtml.match(/data-tl-expand/g) || []).length === 1, 'память: при 10 фото дня есть одна кнопка «ещё»');
assert((memHtml.match(/tl-more-photo/g) || []).length === 7, 'память: скрыты фото сверх превью (10−3=7)');
assert((memHtml.match(/<img/g) || []).length === 10, 'память: в HTML остаются все фото, скрытые — display:none');
assert(w('(s)=>s.memoryPhotosHtml([{id:"a",title:"1"},{id:"b",title:"2"},{id:"c",title:"3"},{id:"d",title:"4"}],"g1","tl-photos")').includes('Показать ещё 1'), 'memoryPhotosHtml: кнопка показывает число скрытых');
assert(!w('(s)=>s.memoryPhotosHtml([{id:"a",title:"1"},{id:"b",title:"2"}],"g2","tl-photos")').includes('data-tl-expand'), 'memoryPhotosHtml: при <=3 фото кнопки нет');
assert(w('(s)=>s.toggleMemoryPhotos("g1")') === 'more', 'память: первый клик раскрывает скрытые фото');
assert(w('(s)=>s.toggleMemoryPhotos("g1")') === 'less', 'память: повторный клик сворачивает обратно');
// «В этот день» больше не отдельный виджет: события прошлых лет — чипами в блоке «Наша история»
w('(s)=>{s.renderProgressRing(new Date(2026,7,7)); return 1;}');
assert(registry['#progressRing'].innerHTML.includes('history-otd'), 'в этот день: чипы событий в блоке истории');
assert(registry['#progressRing'].innerHTML.includes('Пикник'), 'в этот день: событие прошлого года видно в блоке истории');
assert(registry['#progressRing'].innerHTML.includes('Кафе'), 'в этот день: свидание прошлого года — чип в блоке истории');
assert(registry['#progressRing'].innerHTML.includes('ring-svg'), 'кольцо прогресса рендерится');
w('(s)=>{s.renderHome(); return 1;}');
assert(!registry['#onThisDay'] || registry['#onThisDay'].innerHTML === '', 'отдельный виджет «В этот день» больше не рендерится');

// Удаление фото чистит и свидания: без «мёртвой» рамки в панели дня
w('(s)=>{s.db.dates=[{id:"d1", date:"2025-08-07", place:"Кафе", emoji:"💘", photos:["ph1"], done:true, responses:{}}]; s.db.photos=[{id:"ph1", takenAt:new Date(2025,7,7).getTime(), title:"Лето"}]; return 1;}');
w('(s)=>{s.deletePhoto("ph1"); return 1;}');
assert(w('(s)=>(s.db.dates[0].photos === undefined)'), 'удаление фото чистит dt.photos (битая рамка не остаётся)');

// --- Свидание: «прошло» отмечается и снимается прямо из календаря (панель дня) ---
w('(s)=>{s.db.dates=[{id:"doneT", date:"2025-08-07", place:"Кафе", emoji:"💘", done:false, responses:{}}]; s.selectedDate="2025-08-07"; s.renderDayPanel(); return 1;}');
assert(registry['#dayPanel'].innerHTML.includes('data-done-date="doneT"'), 'панель дня: есть кнопка отметить/снять свидание');
assert(w('(s)=>s.toggleDateDone("doneT")') === true, 'панель дня: свидание помечено «прошло» (done=true)');
assert(w('(s)=>s.toggleDateDone("doneT")') === false, 'панель дня: отметку можно снять (done=false)');
w('(s)=>{s.db.dates=[]; return 1;}');
// Мёртвые id в ev.photos/dt.photos (например, из старых данных) не рисуют битую миниатюру
w('(s)=>{s.db.photos=[]; return 1;}');
assert(w('(s)=>s.dtThumbs({photos:["deadId"]})') === '', 'dtThumbs: мёртвый id — без битой рамки');
assert(w('(s)=>s.evThumbs({title:"Пикник", photos:["deadId"]})') === '', 'evThumbs: мёртвый id — без битой рамки');
assert(w('(s)=>s.dtThumbs({photos:["data:image/jpeg;base64,AA=="]})').includes('<img'), 'dtThumbs: легаси data-URL показывается напрямую');

// --- Фаза C: память — будущие события/свидания не попадают ---
w('(s)=>{s.db.events=[]; s.db.dates=[]; s.db.photos=[]; s.db.notes=[]; return 1;}');
const futureDate = new Date(); futureDate.setFullYear(futureDate.getFullYear() + 1);
const futureStr = futureDate.getFullYear() + '-' + String(futureDate.getMonth()+1).padStart(2,'0') + '-' + String(futureDate.getDate()).padStart(2,'0');
w(`(s)=>{s.db.events.push({id:"ev_future", date:"${futureStr}", title:"Грузия", emoji:"🇬🇪", repeat:false}); return 1;}`);
const mbFuture = w('(s)=>s.memoryByDay()');
assert(!mbFuture.some(d => d.events.some(e => e.title === 'Грузия')), 'память: будущее событие НЕ попадает');

// Будущее свидание (done:true, но дата ещё не наступила) — тоже НЕ попадает
w(`(s)=>{s.db.dates.push({id:"dt_future", date:"${futureStr}", place:"Грузия", done:true, responses:{}}); return 1;}`);
const mbFuture2 = w('(s)=>s.memoryByDay()');
assert(!mbFuture2.some(d => d.dates.some(dd => dd.place === 'Грузия')), 'память: будущее свидание (done:true) НЕ попадает');

// Удалённое свидание (из массива db.dates) — НЕ попадает
w('(s)=>{s.db.dates=[]; return 1;}');
const mbDeleted = w('(s)=>s.memoryByDay()');
assert(!mbDeleted.some(d => d.dates && d.dates.length > 0), 'память: после удаления свиданий — пусто');

// --- Фаза C: нижняя навигация «5 + Ещё» ---
assert(w('(s)=>s.BOTTOM_PRIMARY.length') === 5, 'навигация: 5 главных вкладок');
assert(w('(s)=>s.BOTTOM_MORE.length') === 4, 'навигация: 4 вкладки в «Ещё»');
assert(JSON.stringify(w('(s)=>s.BOTTOM_PRIMARY')) === '["home","calendar","memory","lists","photos"]',
  'навигация: главные вкладки — Главная, Календарь, Память, Списки, Фото');
assert(JSON.stringify(w('(s)=>s.BOTTOM_MORE')) === '["notes","wishlist","song","settings"]',
  'навигация: в «Ещё» — Заметки, Хотелки, Песня, Настройки');
const navAll = [...w('(s)=>s.BOTTOM_PRIMARY'), ...w('(s)=>s.BOTTOM_MORE')];
assert(navAll.length === new Set(navAll).size && navAll.length === 9, 'навигация: все 9 вкладок, без повторов');
w('(s)=>{s.buildBottomNav(); return 1;}');
assert(true, 'buildBottomNav не падает в песочнице');
w('(s)=>{s.openNavSheet(); return 1;}');
assert(registry['#navSheet'].hidden === false && registry['#navSheetOverlay'].hidden === false, '«Ещё»-шторка открывается');
w('(s)=>{s.closeNavSheet(); return 1;}');
assert(registry['#navSheet'].hidden === true && registry['#navSheetOverlay'].hidden === true, '«Ещё»-шторка закрывается');
// Регрессия: клик по «⋯ Ещё» (у кнопки нет data-view) должен открывать шторку
w('(s)=>{const ev = { target: { closest(sel) { return sel === "#navMoreBtn" ? { dataset: {} } : null; } } }; s.onNavDocClick(ev); return 1;}');
assert(registry['#navSheet'].hidden === false, 'клик по «⋯ Ещё» открывает шторку');
assert(w('(s)=>{const b = s.document.querySelector("#navMoreBtn"); return b.getAttribute ? b.getAttribute("aria-expanded") : null;}') === 'true', 'у «⋯ Ещё» выставляется aria-expanded=true');
// Клик по вкладке внутри шторки закрывает её и переходит (Заметки теперь в «Ещё»)
w('(s)=>{const ev = { target: { closest(sel) { return sel === "#bottomNav .nav-btn, #navSheet .nav-btn" ? { dataset: { view: "notes" } } : null; } } }; s.onNavDocClick(ev); return 1;}');
assert(registry['#navSheet'].hidden === true, 'клик по вкладке в шторке закрывает шторку');
assert(w('(s)=>s.activeView') === 'notes', 'клик по вкладке в шторке переходит на вкладку');

// --- Фаза D: View Transitions API — переключение вкладок и темы через startViewTransition ---
w('(s)=>{s.document.startViewTransition = cb => { cb(); return { finished: Promise.resolve() }; }; return 1;}');
w('(s)=>{s.go("lists"); return 1;}');
assert(w('(s)=>s.activeView') === 'lists', 'смена вкладки работает через startViewTransition');
w('(s)=>{s.setTheme("dark"); return 1;}');
assert(w('(s)=>s.document.documentElement.dataset.theme') === 'dark', 'смена темы работает через startViewTransition');
w('(s)=>{delete s.document.startViewTransition; return 1;}');
w('(s)=>{s.go("notes"); return 1;}');
assert(w('(s)=>s.activeView') === 'notes', 'без startViewTransition — мгновенное переключение');

// --- Фаза C: светбокс 2.0 (стрелки, зум, счётчик) ---
w('(s)=>{s.openLightbox(["phA","phB","phC"], 1); return 1;}');
assert(registry['#lightbox'].hidden === false, 'светбокс открывается');
assert(w('(s)=>s.lightboxIdx') === 1 && registry['#lbCounter'].textContent === '2 / 3', 'светбокс открыт на выбранном фото, счётчик корректен');
w('(s)=>{s.lbNav(1); return 1;}');
assert(w('(s)=>s.lightboxIdx') === 2 && registry['#lbCounter'].textContent === '3 / 3', 'стрелка вперёд листает и обновляет счётчик');
w('(s)=>{s.lbNav(1); return 1;}');
assert(w('(s)=>s.lightboxIdx') === 0, 'листание замыкается по кругу');
w('(s)=>{s.lbNav(-1); return 1;}');
assert(w('(s)=>s.lightboxIdx') === 2, 'стрелка назад тоже замыкается');
w('(s)=>{s.lbZoomToggle(); return 1;}');
assert(w('(s)=>s.lightboxZoom') === 2.5, 'зум включается');
assert(registry['#lightboxImg'].style.transform === 'scale(2.5)', 'к фото применён scale');
w('(s)=>{s.lbZoomToggle(); return 1;}');
assert(w('(s)=>s.lightboxZoom') === 1, 'повторный зум возвращает к 1');
w('(s)=>{s.lbZoomTo(8); return 1;}');
assert(w('(s)=>s.lightboxZoom') === 4, 'зум ограничен максимумом 4');
// data-URL (хотелки) показывается напрямую
w('(s)=>{s.openLightbox(["data:image/jpeg;base64,AB=="], 0); return 1;}');
assert(registry['#lightboxImg'].src === 'data:image/jpeg;base64,AB==', 'светбокс показывает data-URL напрямую (хотелки)');
assert(registry['#lbCounter'].textContent === '', 'одно фото — счётчик пуст');
assert(registry['#lbPrev'].style.display === 'none' && registry['#lbNext'].style.display === 'none', 'одно фото — стрелки скрыты');
// фото из галереи: миниатюра из кэша ставится сразу
w('(s)=>{s.db.photos.push({id:"gal1", title:"Фото"}); s.setThumbUrl("gal1", "data:image/jpeg;base64,GAL="); s.openLightbox(["gal1","gal2"], 0); return 1;}');
assert(registry['#lightboxImg'].src === 'data:image/jpeg;base64,GAL=', 'фото галереи: src из кэша миниатюр');
// закрытие сбрасывает состояние
w('(s)=>{s.closeOverlay("lightbox"); return 1;}');
assert(registry['#lightbox'].hidden === true, 'светбокс закрывается');
assert(w('(s)=>s.lightboxList.length') === 0, 'при закрытии список фото очищается');

console.log('OK: ' + results.length + ' checks passed\n' + results.join('\n'));

})().catch(e => { console.log('FAIL: async: ' + e.message); process.exit(1); });

