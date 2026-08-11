/* Юнит-тест синхронизации (фаза B5): мок Firebase RTDB.
   Проверяет: инициализацию, push, pull, «последняя правка выигрывает»,
   игнорирование мусора/чужого сейфа в облаке, live-обновление, stopSync.
   Запуск: node tests\uni-sync.js app.js */
const fs = require('fs');
const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');

const registry = {};
function makeEl() {
  return { id: '', dataset: {}, children: [], hidden: false, innerHTML: '', textContent: '',
    style: {}, value: '', options: [], _handlers: {}, _attrs: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); }, querySelectorAll() { return []; },
    appendChild() {}, remove() {}, focus() {}, click() {},
    setAttribute(k, v) { this._attrs[k] = String(v); }, getAttribute(k) { return this._attrs[k] ?? null; }, removeAttribute(k) { delete this._attrs[k]; } };
}
// Мок Firebase: хранилище-объект, set/once/on/off
const mockDb = { data: {}, _onCb: null };
const firebase = {
  initializeApp(config, name) { return { name: name || 'default', config }; },
  auth() { return { signInAnonymously: async () => ({ user: { uid: 'mock-uid' } }), signOut: async () => {} }; },
  database() {
    return {
      ref(path) {
        const get = () => path.split('/').reduce((o, k) => (o == null ? o : o[k]), mockDb.data);
        const put = (obj) => {
          const keys = path.split('/');
          let o = mockDb.data;
          for (let i = 0; i < keys.length - 1; i++) { o = o[keys[i]] = o[keys[i]] || {}; }
          o[keys[keys.length - 1]] = obj;
        };
        return {
          set(obj) { put(obj); return Promise.resolve(); },
          once() { return Promise.resolve({ val: () => get() }); },
          on(type, cb) { mockDb._onCb = cb; },
          off() { mockDb._onCb = null; }
        };
      }
    };
  }
};
const sandbox = {
  document: {
    body: makeEl(), documentElement: { dataset: {} }, createElement() { return makeEl(); }, addEventListener() {},
    querySelector(sel) { return registry[sel] || (registry[sel] = makeEl()); },
    querySelectorAll() { return []; }
  },
  localStorage: { getItem(k) { return sandbox._store[k] ?? null; }, setItem(k, v) { sandbox._store[k] = String(v); }, removeItem(k) { delete sandbox._store[k]; } },
  sessionStorage: { getItem(k) { return sandbox._ss[k] ?? null; }, setItem(k, v) { sandbox._ss[k] = String(v); } },
  alert() {}, confirm() { return true; },
  URL: { createObjectURL() { return 'blob:x'; }, revokeObjectURL() {} },
  FileReader: function () {}, Blob: function (parts) { this.size = (parts || []).join('').length; this.arrayBuffer = () => Promise.resolve(new Uint8Array(0).buffer); },
  HTMLAudioElement: function () {}, Image: function () {},
  setTimeout() { return 0; }, setInterval() { return 1; }, addEventListener() {},
  isNaN, console, Date, Math, JSON, Object, Array, Number, String, RegExp,
  firebase,
  _store: {}, _ss: {}
};
const sleep = ms => new Promise(res => setTimeout(res, ms));
function assert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); process.exit(1); }
  results.push(msg);
}
let results = [];
const suffix = `
;__TEST__(sandbox);
function __TEST__(s){
  Object.defineProperty(s, 'db', { get: () => db, set: v => { db = v; }, configurable: true });
  Object.defineProperty(s, 'syncReady', { get: () => syncReady, set: v => { syncReady = v; }, configurable: true });
  Object.defineProperty(s, 'syncTs', { get: () => syncTs, set: v => { syncTs = v; }, configurable: true });
  Object.defineProperty(s, 'FIREBASE_CONFIG', { get: () => FIREBASE_CONFIG, set: v => { FIREBASE_CONFIG = v; }, configurable: true });
  s.createVault = createVault; s.unlockWith = unlockWith; s.lock = lock; s.isLocked = isLocked;
  s.loadVault = loadVault; s.save = save; s.tryUnlock = tryUnlock; s.tryUnwrapKey = tryUnwrapKey;
  s.__setPendingCloudVault = v => { pendingCloudVault = v; };
  Object.defineProperty(s, 'masterKey', { get: () => masterKey, configurable: true });
  s.initSync = initSync; s.pushVault = pushVault; s.pullVault = pullVault; s.stopSync = stopSync;
  s.applyRemoteVault = applyRemoteVault;
  s.fetchCloudVault = fetchCloudVault; s.forcePushVault = forcePushVault;
  Object.defineProperty(s, 'syncPushBlocked', { get: () => syncPushBlocked, set: v => { syncPushBlocked = v; }, configurable: true });
}
`;

const wrapped = new Function('sandbox', 'document', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'URL',
  'FileReader', 'Blob', 'HTMLAudioElement', 'Image', 'setTimeout', 'setInterval', 'addEventListener', 'firebase',
  src + suffix);
wrapped(sandbox, sandbox.document, sandbox.localStorage, sandbox.sessionStorage, sandbox.alert, sandbox.confirm,
  sandbox.URL, sandbox.FileReader, sandbox.Blob, sandbox.HTMLAudioElement, sandbox.Image,
  sandbox.setTimeout, sandbox.setInterval, sandbox.addEventListener, firebase);

const w = (f) => new Function('sandbox', 'return (' + f + ')(sandbox)')(sandbox);

(async () => {
  // 1. config + сейф
  w('(s)=>{s.FIREBASE_CONFIG = { projectId: "mock" }; return 1;}');
  await w('(s)=>s.createVault("gosha","123456")');
  // 2. инициализация с моком
  await w('(s)=>s.initSync()');
  assert(w('(s)=>s.syncReady') === true, 'syncReady=true с mock-firebase');
  // 3. push: vault уходит в облако
  await w('(s)=>s.pushVault()');
  assert(!!mockDb.data.vaults.shared && !!mockDb.data.vaults.shared.vault, 'vault ушёл в облако');
  const ts1 = mockDb.data.vaults.shared.syncTs;
  assert(ts1 > 0 && w('(s)=>s.syncTs') === ts1, 'syncTs записан в облако и локально');
  // 4. конфликт: облако СТАРЕЕ локального — не применяется
  mockDb.data.vaults.shared.syncTs = ts1 - 1000;
  await w('(s)=>s.pullVault(true)');
  assert(w('(s)=>s.syncTs') === ts1, 'старое облако не применяется (последняя правка выигрывает)');
  // 5. облако СВЕЖЕЕ — применяется
  mockDb.data.vaults.shared.syncTs = ts1 + 5000;
  await w('(s)=>s.pullVault(true)');
  assert(w('(s)=>s.syncTs') === ts1 + 5000, 'свежее облако применяется');
  // 6. мусор в облаке — игнорируется, локальные данные целы
  const dbBefore = JSON.stringify(w('(s)=>s.db'));
  mockDb.data.vaults.shared = { syncTs: Date.now(), vault: { db: { d: 'not-a-ciphertext', i: 'not-iv' } } };
  await w('(s)=>s.pullVault(true)');
  assert(w('(s)=>s.syncTs') === ts1 + 5000, 'мусор в облаке не применяется');
  assert(JSON.stringify(w('(s)=>s.db')) === dbBefore, 'локальные данные не пострадали');
  // 7. live-обновление с «другого устройства»
  const okVault = w('(s)=>s.loadVault()');
  mockDb.data.vaults.shared = { syncTs: Date.now() + 60000, vault: okVault };
  if (mockDb._onCb) mockDb._onCb({ val: () => mockDb.data.vaults.shared });
  await sleep(30);
  assert(w('(s)=>s.syncTs') > ts1 + 5000, 'live-обновление применилось');
  // 8. stopSync
  w('(s)=>{s.stopSync(); return 1;}');
  assert(w('(s)=>s.syncReady') === false, 'stopSync выключает синхронизацию');
  assert(mockDb._onCb === null, 'слушатель снят при stopSync');
  // 9. Новый браузер: локального сейфа нет, облачный виден ДО входа
  sandbox._store = {}; // «новый браузер»
  assert(w('(s)=>s.loadVault()') === null, 'новый браузер: локального сейфа нет');
  const cloud1 = await w('(s)=>s.fetchCloudVault()');
  assert(cloud1 && cloud1.vault && cloud1.ts > 0, 'облачный сейф найден до входа');
  const cloudVaultLiteral = JSON.stringify(cloud1.vault);
  const badUnlock = await w('(s)=>s.unlockWith("gosha","wrong-pass",' + cloudVaultLiteral + ')');
  assert(badUnlock === false, 'неверный пароль к облачному сейфу не проходит');
  const okUnlock = await w('(s)=>s.unlockWith("gosha","123456",' + cloudVaultLiteral + ')');
  assert(okUnlock === true, 'вход по облачному сейфу в новом браузере');
  assert(w('(s)=>s.loadVault()') !== null, 'облачный сейф усыновлён (записан в localStorage)');
  assert(w('(s)=>s.isLocked()') === false, 'после входа приложение разблокировано');
  // 10. Конфликт: свежий браузер создал СВОЙ сейф, а облако держит старый —
  // автоматический push не затирает облачный сейф (другой ключ = чужой сейф)
  sandbox._store = {};
  await w('(s)=>s.createVault("gosha","654321")'); // новый пароль → новый ключ
  await w('(s)=>s.initSync()');
  await w('(s)=>s.pushVault()');
  assert(w('(s)=>s.syncPushBlocked') === true, 'push заблокирован: чужой облачный сейф не затирается');
  assert(JSON.stringify(mockDb.data.vaults.shared.vault) === cloudVaultLiteral,
    'облачный сейф не тронут при конфликте');
  await w('(s)=>s.forcePushVault()'); // явное восстановление — человек нажал кнопку
  assert(w('(s)=>s.syncPushBlocked') === false, 'forcePushVault снимает блокировку');
  assert(JSON.stringify(mockDb.data.vaults.shared.vault) !== cloudVaultLiteral,
    'forcePushVault записал сейф этого устройства');
  // 11. Пустое облако → fetchCloudVault возвращает null
  mockDb.data.vaults.shared = null;
  assert(await w('(s)=>s.fetchCloudVault()') === null, 'пустое облако → null');
  // 12. Устройство держит локальный сейф с ДРУГИМ паролем, а пользователь вводит
  // пароль ОБЛАЧНОГО сейфа → вход идёт по облачному сейфу, данные приходят
  // из облака, старый локальный не затирает облако и уходит в резервную копию.
  sandbox._store = {}; // «свежий браузер»: создаём сейф пары и уводим его в облако
  await w('(s)=>s.createVault("gosha","cldpass")');
  await w('(s)=>{s.db.wishlist.push({id:"from-cloud", title:"Облачный подарок"}); return 1;}');
  await w('(s)=>s.save()');
  const cloudDb = JSON.stringify(w('(s)=>s.db'));
  await w('(s)=>s.initSync()');
  await w('(s)=>s.pushVault()');
  assert(!!mockDb.data.vaults.shared.vault, '12: облачный сейф ушёл в облако');
  const cloudVault = JSON.parse(JSON.stringify(mockDb.data.vaults.shared.vault));
  // «второй браузер»: на устройстве остался СТАРЫЙ локальный сейф (другой пароль)
  sandbox._store = {};
  await w('(s)=>s.createVault("gosha","locpass")');
  w('(s)=>{s.__setPendingCloudVault(' + JSON.stringify(cloudVault) + '); return 1;}'); // как после fetchCloudVault
  sandbox.document.querySelector('#authPass').value = 'cldpass'; // пользователь вводит пароль ОБЛАКА
  await w('(s)=>s.tryUnlock()');
  assert(w('(s)=>s.isLocked()') === false, '12: вход паролем облачного сейфа прошёл');
  const adopted12 = w('(s)=>s.loadVault()');
  assert(await w('(s)=>s.tryUnwrapKey("gosha","cldpass",' + JSON.stringify(adopted12) + ')') !== null,
    '12: облачный пароль открывает сейф на устройстве (усыновлён)');
  assert(await w('(s)=>s.tryUnwrapKey("gosha","locpass",' + JSON.stringify(adopted12) + ')') === null,
    '12: старый локальный пароль больше не подходит — на устройстве облачный сейф');
  assert(JSON.stringify(w('(s)=>s.db')) === cloudDb, '12: данные пришли из облака');
  assert(sandbox._store['universe_vault_prev'] !== undefined, '12: старый сейф сохранён в резервную копию');
  // 13. Устройство держит сейф, созданный тем ЖЕ паролем, но это отдельный сейф
  // (новая соль → другой ключ). Пароль открывает оба — входим облачным, чтобы
  // не терять облачные данные.
  sandbox._store = {};
  await w('(s)=>s.createVault("gosha","cldpass")'); // «второй» сейф тем же паролем
  assert(JSON.stringify(w('(s)=>s.loadVault()')) !== JSON.stringify(cloudVault),
    '13: это отдельный сейф (новая соль, другой ключ)');
  w('(s)=>{s.__setPendingCloudVault(' + JSON.stringify(cloudVault) + '); return 1;}');
  sandbox.document.querySelector('#authPass').value = 'cldpass';
  await w('(s)=>s.tryUnlock()');
  assert(w('(s)=>s.db.wishlist.some(x => x.id === "from-cloud")') === true,
    '13: открыт облачный сейф (данные из облака), а не локальный близнец');
  // 14. Пароль локального сейфа ≠ паролю облака: вход локальным паролем остаётся
  // на локальном сейфе, облачный не усыновляется и НЕ затирается.
  sandbox._store = {};
  await w('(s)=>s.createVault("gosha","locpass")');
  w('(s)=>{s.__setPendingCloudVault(' + JSON.stringify(cloudVault) + '); return 1;}');
  sandbox.document.querySelector('#authPass').value = 'locpass';
  await w('(s)=>s.tryUnlock()');
  assert(w('(s)=>s.isLocked()') === false, '14: локальный вход прошёл');
  const stayed14 = w('(s)=>s.loadVault()');
  assert(await w('(s)=>s.tryUnwrapKey("gosha","locpass",' + JSON.stringify(stayed14) + ')') !== null,
    '14: на устройстве остался локальный сейф');
  assert(await w('(s)=>s.tryUnwrapKey("gosha","cldpass",' + JSON.stringify(stayed14) + ')') === null,
    '14: облачный сейф не усыновлён');
  assert(JSON.stringify(mockDb.data.vaults.shared.vault) === JSON.stringify(cloudVault),
    '14: облако не тронуто');
  // 15. Неверный пароль — ни локальный, ни облачный не открылись: остаёмся на замке.
  await w('(s)=>s.lock()');
  sandbox.document.querySelector('#authPass').value = 'nope';
  await w('(s)=>s.tryUnlock()');
  assert(w('(s)=>s.isLocked()') === true, '15: неверный пароль — остаёмся на замке');
  // 16. Облачная копия — та же линия (расшифровывается тем же ключом): вход
  // остаётся на локальном сейфе, свежая правка этого устройства не теряется.
  mockDb.data.vaults.shared = null; // чистим облако: push в тесте 16 уйдёт свободно
  sandbox._store = {};
  await w('(s)=>s.createVault("gosha","cldpass")');
  await w('(s)=>s.initSync()');
  await w('(s)=>s.pushVault()'); // облако = копия того же сейфа (тот же мастер-ключ)
  const cloudCopy = JSON.parse(JSON.stringify(mockDb.data.vaults.shared.vault));
  await w('(s)=>{s.db.wishlist.push({id:"local-edit", title:"Свежая правка"}); return 1;}');
  await w('(s)=>s.save()');
  await w('(s)=>s.lock()');
  w('(s)=>{s.__setPendingCloudVault(' + JSON.stringify(cloudCopy) + '); return 1;}');
  sandbox.document.querySelector('#authPass').value = 'cldpass';
  await w('(s)=>s.tryUnlock()');
  assert(w('(s)=>s.db.wishlist.some(x => x.id === "local-edit")') === true,
    '16: свежая правка устройства сохранена (облачная копия не заменила её)');
  console.log('OK: ' + results.length + ' sync checks passed');
})().catch(e => { console.log('FAIL: sync: ' + (e && e.message)); process.exit(1); });

