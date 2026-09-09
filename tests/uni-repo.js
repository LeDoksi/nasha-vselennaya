/* Юнит-тест слоя данных: мок Firestore (tests/fs-mock.js).
   Пока проверяет только подключение (initFirestore/fsReady/fsCol) — реальные
   CRUD-проверки репозитория появятся вместе с src/04-repo.js в задаче 2.
   Песочница скопирована из tests/uni-sync.js (тот же makeEl/sandbox/wrapped),
   в мок Firebase Auth добавлен сразу разрешённый пользователь — здесь не
   тестируется сам гейт, только то, что Firestore поднимается после него.
   Запуск: node tests\uni-repo.js app.js */
const fs = require('fs');
const { makeFsMock } = require('./fs-mock.js');
const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
const mock = makeFsMock();

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
// Мок Firebase Auth: onAuthStateChanged сразу отдаёт уже разрешённого
// пользователя (Гошу) — как будто вход уже был на предыдущем сеансе.
const mockCurrentUser = { email: 'shakov.georgy@gmail.com', uid: 'uid-gosha' };
function authObj() {
  return {
    signInWithPopup: async () => ({ user: mockCurrentUser }),
    signInWithRedirect: async () => {},
    getRedirectResult: async () => null,
    onAuthStateChanged: cb => {
      cb(mockCurrentUser);
      return () => {};
    },
    signOut: async () => {},
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
      ref() {
        return {
          set: async () => {},
          once: async () => ({ val: () => null }),
          on() {},
          off() {}
        };
      }
    };
  },
  // Firestore — из мока tests/fs-mock.js, за компанию с Auth/RTDB-моками выше.
  firestore: mock.firestore
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
  s.initFirestore = initFirestore; s.fsCol = fsCol; s.fsDoc = fsDoc;
  Object.defineProperty(s, 'fsReady', { get: () => fsReady, configurable: true });
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
  assert((await w('(s)=>s.initFirestore()')) === true, 'initFirestore поднимает Firestore');
  assert(w('(s)=>s.fsReady') === true, 'fsReady выставлен');
  assert(w('(s)=>s.fsCol("events").path') === 'couples/main/events', 'ссылка на коллекцию собрана верно');
  console.log('OK: ' + results.length + ' repo checks passed');
})().catch(e => {
  console.log('FAIL: repo: ' + (e && e.message));
  process.exit(1);
});
