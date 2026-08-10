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
  s.loadVault = loadVault; s.save = save;
  Object.defineProperty(s, 'masterKey', { get: () => masterKey, configurable: true });
  s.initSync = initSync; s.pushVault = pushVault; s.pullVault = pullVault; s.stopSync = stopSync;
  s.applyRemoteVault = applyRemoteVault;
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
  console.log('OK: ' + results.length + ' sync checks passed');
})().catch(e => { console.log('FAIL: sync: ' + (e && e.message)); process.exit(1); });

