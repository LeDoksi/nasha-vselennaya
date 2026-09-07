/* Юнит-тест облачной синхронизации + Google-гейта (src/01-gate.js, src/95-sync.js).
   Мок Firebase Auth (Google-вход, allowlist по email) + мок Firebase RTDB.
   Проверяет: гейт (доступ только двум email), единый ключ пары в vaults/secret
   (второе «устройство» получает его из облака без пароля), push/pull,
   «последняя правка выигрывает», игнорирование мусора/чужого ключа в облаке,
   live-обновление, stopSync.
   Запуск: node tests\uni-sync.js app.js */
const fs = require('fs');
const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');

const registry = {};
function makeEl() {
  return {
    id: '',
    dataset: {},
    children: [],
    hidden: false,
    innerHTML: '',
    textContent: '',
    style: {},
    value: '',
    options: [],
    _handlers: {},
    _attrs: {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      }
    },
    addEventListener(t, fn) {
      (this._handlers[t] = this._handlers[t] || []).push(fn);
    },
    querySelectorAll() {
      return [];
    },
    appendChild() {},
    remove() {},
    focus() {},
    click() {},
    setAttribute(k, v) {
      this._attrs[k] = String(v);
    },
    getAttribute(k) {
      return this._attrs[k] ?? null;
    },
    removeAttribute(k) {
      delete this._attrs[k];
    }
  };
}
// Мок Firebase RTDB: хранилище-объект, set/once/on/off
const mockDb = { data: {}, _onCb: null };
// Мок Firebase Auth: signInWithPopup/signInWithRedirect отдают mockPopupUser
// (или бросают, если он не задан — «закрыли окно входа»); onAuthStateChanged
// сразу отдаёт mockCurrentUser (как уже вошедшего с прошлого раза).
let mockPopupUser = null;
let mockCurrentUser = null;
function authObj() {
  return {
    signInWithPopup: async () => {
      if (!mockPopupUser) throw new Error('popup closed');
      mockCurrentUser = mockPopupUser;
      return { user: mockCurrentUser };
    },
    signInWithRedirect: async () => {
      mockCurrentUser = mockPopupUser;
    },
    getRedirectResult: async () => null,
    onAuthStateChanged: cb => {
      cb(mockCurrentUser);
      return () => {};
    },
    signOut: async () => {
      mockCurrentUser = null;
    },
    get currentUser() {
      return mockCurrentUser;
    }
  };
}
const firebase = {
  initializeApp(config, name) {
    return { name: name || 'default', config };
  },
  auth() {
    return authObj();
  },
  database() {
    return {
      ref(path) {
        const get = () => path.split('/').reduce((o, k) => (o == null ? o : o[k]), mockDb.data);
        const put = obj => {
          const keys = path.split('/');
          let o = mockDb.data;
          for (let i = 0; i < keys.length - 1; i++) {
            o = o[keys[i]] = o[keys[i]] || {};
          }
          o[keys[keys.length - 1]] = obj;
        };
        return {
          set(obj) {
            put(obj);
            return Promise.resolve();
          },
          once() {
            return Promise.resolve({ val: () => get() });
          },
          on(type, cb) {
            mockDb._onCb = cb;
          },
          off() {
            mockDb._onCb = null;
          }
        };
      }
    };
  }
};
firebase.auth.GoogleAuthProvider = function GoogleAuthProvider() {};
const sandbox = {
  document: {
    body: makeEl(),
    documentElement: { dataset: {} },
    createElement() {
      return makeEl();
    },
    addEventListener() {},
    querySelector(sel) {
      return registry[sel] || (registry[sel] = makeEl());
    },
    querySelectorAll() {
      return [];
    }
  },
  localStorage: {
    getItem(k) {
      return sandbox._store[k] ?? null;
    },
    setItem(k, v) {
      sandbox._store[k] = String(v);
    },
    removeItem(k) {
      delete sandbox._store[k];
    }
  },
  sessionStorage: {
    getItem(k) {
      return sandbox._ss[k] ?? null;
    },
    setItem(k, v) {
      sandbox._ss[k] = String(v);
    },
    removeItem(k) {
      delete sandbox._ss[k];
    }
  },
  alert() {},
  confirm() {
    return true;
  },
  URL: {
    createObjectURL() {
      return 'blob:x';
    },
    revokeObjectURL() {}
  },
  FileReader: function () {},
  Blob: function (parts) {
    this.size = (parts || []).join('').length;
    this.arrayBuffer = () => Promise.resolve(new Uint8Array(0).buffer);
  },
  HTMLAudioElement: function () {},
  Image: function () {},
  setTimeout() {
    return 0;
  },
  setInterval() {
    return 1;
  },
  addEventListener() {},
  isNaN,
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  Number,
  String,
  RegExp,
  firebase,
  _store: {},
  _ss: {}
};
const sleep = ms => new Promise(res => setTimeout(res, ms));
function assert(cond, msg) {
  if (!cond) {
    console.log('FAIL: ' + msg);
    process.exit(1);
  }
  results.push(msg);
}
let results = [];
const suffix = `
;__TEST__(sandbox);
function __TEST__(s){
  Object.defineProperty(s, 'db', { get: () => db, set: v => { db = v; }, configurable: true });
  Object.defineProperty(s, 'syncReady', { get: () => syncReady, set: v => { syncReady = v; }, configurable: true });
  Object.defineProperty(s, 'syncTs', { get: () => syncTs, set: v => { syncTs = v; }, configurable: true });
  Object.defineProperty(s, 'currentUser', { get: () => currentUser, configurable: true });
  Object.defineProperty(s, 'gateUser', { get: () => gateUser, set: v => { gateUser = v; }, configurable: true });
  s.lock = lock; s.isLocked = isLocked;
  s.loadVault = loadVault; s.save = save;
  s.gateSignIn = gateSignIn; s.boot = boot; s.ensureMasterKey = ensureMasterKey; s.unlockWithKey = unlockWithKey;
  Object.defineProperty(s, 'masterKey', { get: () => masterKey, configurable: true });
  s.initSync = initSync; s.pushVault = pushVault; s.pullVault = pullVault; s.stopSync = stopSync;
  s.applyRemoteVault = applyRemoteVault; s.forcePushVault = forcePushVault;
  Object.defineProperty(s, 'syncPushBlocked', { get: () => syncPushBlocked, set: v => { syncPushBlocked = v; }, configurable: true });
}
`;

const wrapped = new Function(
  'sandbox',
  'document',
  'localStorage',
  'sessionStorage',
  'alert',
  'confirm',
  'URL',
  'FileReader',
  'Blob',
  'HTMLAudioElement',
  'Image',
  'setTimeout',
  'setInterval',
  'addEventListener',
  'firebase',
  // sourceURL — даёт npm run coverage (c8) сопоставить покрытие с app.js
  // вместо анонимного eval внутри new Function().
  src + suffix + '\n//# sourceURL=' + file
);
wrapped(
  sandbox,
  sandbox.document,
  sandbox.localStorage,
  sandbox.sessionStorage,
  sandbox.alert,
  sandbox.confirm,
  sandbox.URL,
  sandbox.FileReader,
  sandbox.Blob,
  sandbox.HTMLAudioElement,
  sandbox.Image,
  sandbox.setTimeout,
  sandbox.setInterval,
  sandbox.addEventListener,
  firebase
);

const w = f => new Function('sandbox', 'return (' + f + ')(sandbox)')(sandbox);

(async () => {
  // 1. Гейт отклоняет чужой email — приложение остаётся закрытым
  mockPopupUser = { email: 'stranger@gmail.com', uid: 'uid-stranger' };
  await w('(s)=>s.gateSignIn()');
  assert(w('(s)=>s.isLocked()') === true, 'чужой email не проходит гейт');
  assert(w('(s)=>s.gateUser') === null, 'gateUser не выставлен для чужого email');

  // 2. Гейт пропускает Гошу — генерируется и публикуется общий ключ пары
  mockPopupUser = { email: 'shakov.georgy@gmail.com', uid: 'uid-gosha' };
  await w('(s)=>s.gateSignIn()');
  assert(w('(s)=>s.isLocked()') === false, 'Гоша проходит гейт');
  assert(w('(s)=>s.currentUser') === 'gosha', 'email определил профиль — Гоша');
  assert(typeof mockDb.data.vaults.secret === 'string' && mockDb.data.vaults.secret.length > 0, 'первый вход публикует общий ключ в vaults/secret');

  // 3. Push: vault уходит в облако
  await w('(s)=>{s.db.wishlist.push({id:"from-gosha",text:"Подарок",owner:"gosha",done:false,ts:1});return 1;}');
  await w('(s)=>s.save()');
  await w('(s)=>s.initSync()');
  assert(w('(s)=>s.syncReady') === true, 'syncReady=true после initSync');
  await w('(s)=>s.pushVault()');
  assert(!!mockDb.data.vaults.shared && !!mockDb.data.vaults.shared.vault, 'vault ушёл в облако');
  const ts1 = mockDb.data.vaults.shared.syncTs;
  assert(ts1 > 0 && w('(s)=>s.syncTs') === ts1, 'syncTs записан в облако и локально');

  // 4. «Второе устройство»: Даша, локального кэша ключа и вовсе нет — ключ
  // приходит из vaults/secret, без единого пароля, и данные Гоши уже видны
  w('(s)=>s.lock()');
  w('(s)=>s.stopSync()');
  sandbox._store = {}; // «новое устройство» — локального кэша ключа нет
  mockPopupUser = { email: 'dashach98@gmail.com', uid: 'uid-dasha' };
  await w('(s)=>s.gateSignIn()');
  assert(w('(s)=>s.isLocked()') === false, 'Даша на новом устройстве проходит гейт');
  assert(w('(s)=>s.currentUser') === 'dasha', 'email определил профиль — Даша');
  await w('(s)=>s.initSync()');
  await w('(s)=>s.pullVault()');
  assert(w('(s)=>s.db.wishlist.some(x=>x.id==="from-gosha")') === true, 'Даша на новом устройстве видит данные Гоши через общий ключ облака');

  // 5. Конфликт: старее облако не применяется, свежее — применяется
  mockDb.data.vaults.shared.syncTs = ts1 - 1000;
  await w('(s)=>s.pullVault()');
  assert(w('(s)=>s.syncTs') === ts1, 'старое облако не применяется (последняя правка выигрывает)');
  mockDb.data.vaults.shared.syncTs = ts1 + 5000;
  await w('(s)=>s.pullVault()');
  assert(w('(s)=>s.syncTs') === ts1 + 5000, 'свежее облако применяется');

  // 6. Мусор в облаке — игнорируется, локальные данные целы
  const dbBefore = JSON.stringify(w('(s)=>s.db'));
  mockDb.data.vaults.shared = { syncTs: Date.now(), vault: { db: { d: 'not-a-ciphertext', i: 'not-iv' } } };
  await w('(s)=>s.pullVault()');
  assert(w('(s)=>s.syncTs') === ts1 + 5000, 'мусор в облаке не применяется');
  assert(JSON.stringify(w('(s)=>s.db')) === dbBefore, 'локальные данные не пострадали');

  // 7. live-обновление с «другого устройства»
  const okVault = w('(s)=>s.loadVault()');
  mockDb.data.vaults.shared = { syncTs: Date.now() + 60000, vault: okVault };
  if (mockDb._onCb) mockDb._onCb({ val: () => mockDb.data.vaults.shared });
  await sleep(30);
  assert(w('(s)=>s.syncTs') > ts1 + 5000, 'live-обновление применилось');

  // 8. Облако зашифровано ЧУЖИМ ключом (не тем, что в vaults/secret) — push
  // не затирает его молча; forcePushVault — осознанное восстановление
  const foreignVaultRaw = { i: 'AAAAAAAAAAAAAAAA', d: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
  mockDb.data.vaults.shared = { syncTs: Date.now() + 120000, vault: { db: foreignVaultRaw } };
  if (mockDb._onCb) mockDb._onCb({ val: () => mockDb.data.vaults.shared }); // обновляем lastRemoteSnapshot, как это делает живой слушатель
  await sleep(10);
  await w('(s)=>s.pushVault()');
  assert(w('(s)=>s.syncPushBlocked') === true, 'push заблокирован: облачный сейф не расшифровывается текущим ключом');
  assert(JSON.stringify(mockDb.data.vaults.shared.vault.db) === JSON.stringify(foreignVaultRaw), 'чужой облачный сейф не тронут при конфликте');
  await w('(s)=>s.forcePushVault()');
  assert(w('(s)=>s.syncPushBlocked') === false, 'forcePushVault снимает блокировку');
  assert(JSON.stringify(mockDb.data.vaults.shared.vault.db) !== JSON.stringify(foreignVaultRaw), 'forcePushVault записал сейф этого устройства');

  // 9. stopSync
  w('(s)=>{s.stopSync(); return 1;}');
  assert(w('(s)=>s.syncReady') === false, 'stopSync выключает синхронизацию');
  assert(mockDb._onCb === null, 'слушатель снят при stopSync');
  assert(w('(s)=>s.isLocked()') === false, 'stopSync не разлогинивает — это не lock()');

  console.log('OK: ' + results.length + ' sync checks passed');
})().catch(e => {
  console.log('FAIL: sync: ' + (e && e.message));
  process.exit(1);
});
