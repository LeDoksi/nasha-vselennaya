/* Юнит-тест Google-гейта и обмена общим ключом пары (src/01-gate.js).
   Мок Firebase Auth (Google-вход, allowlist по email) + мок Firebase RTDB —
   RTDB здесь нужен только под vaults/secret (общий AES-ключ пары, см. README).

   Раньше этот файл проверял ещё и блоб-синхронизацию (весь зашифрованный
   сейф целиком через vaults/shared, push/pull/live-обновление/конфликты) —
   она убрана целиком вместе с src/95-sync.js (переименован в
   src/95-photos-cloud.js, там осталась только выгрузка фото в Yandex Object
   Storage — см. tests/uni-photo-sync.js). Источник правды теперь Firestore,
   каждый экран пишет туда точечно (src/04-repo.js), кросс-девайсная
   персистентность данных проверяется в tests/uni-repo.js.

   Проверяет: гейт пускает только два email из ALLOWED_EMAILS; первый вход
   генерирует и публикует общий ключ пары в vaults/secret; второе устройство
   без локального кэша ключа и без пароля получает тот же ключ из облака.
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
// Мок Firebase RTDB: хранилище-объект, set/once/on/off (нужен только под vaults/secret)
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
  Object.defineProperty(s, 'currentUser', { get: () => currentUser, configurable: true });
  Object.defineProperty(s, 'gateUser', { get: () => gateUser, set: v => { gateUser = v; }, configurable: true });
  s.lock = lock; s.isLocked = isLocked;
  s.loadVault = loadVault;
  s.gateSignIn = gateSignIn; s.boot = boot; s.ensureMasterKey = ensureMasterKey; s.unlockWithKey = unlockWithKey;
  Object.defineProperty(s, 'masterKey', { get: () => masterKey, configurable: true });
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

  // 3. «Второе устройство»: Даша, локального кэша ключа и вовсе нет — ключ
  // приходит из vaults/secret, без единого пароля (сами данные пары теперь
  // синхронизируются через Firestore, а не через этот ключевой канал — см.
  // tests/uni-repo.js).
  w('(s)=>s.lock()');
  sandbox._store = {}; // «новое устройство» — локального кэша ключа нет
  mockPopupUser = { email: 'dashach98@gmail.com', uid: 'uid-dasha' };
  await w('(s)=>s.gateSignIn()');
  assert(w('(s)=>s.isLocked()') === false, 'Даша на новом устройстве проходит гейт');
  assert(w('(s)=>s.currentUser') === 'dasha', 'email определил профиль — Даша');

  console.log('OK: ' + results.length + ' sync checks passed');
})().catch(e => {
  console.log('FAIL: sync: ' + (e && e.message));
  process.exit(1);
});
