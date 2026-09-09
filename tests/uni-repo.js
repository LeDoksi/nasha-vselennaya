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
  s.monthKey = monthKey; s.monthRange = monthRange;
  s.loadHotSet = loadHotSet; s.loadMonth = loadMonth; s.loadMorePhotos = loadMorePhotos;
  s.repoSet = repoSet; s.repoDelete = repoDelete; s.repoBatch = repoBatch; s.repoMeta = repoMeta;
  Object.defineProperty(s, 'db', { get: () => db, configurable: true });
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

  // Проверка батча с merge:true — нетронутые поля должны уцелеть
  const db = sandbox.firebase.firestore();
  const ref = db.doc('test/merge-check');

  // Создаём документ через батч
  const batch1 = db.batch();
  batch1.set(ref, { a: 1, b: 2 });
  await batch1.commit();
  const snap1 = await ref.get();
  const doc1 = snap1.data();
  assert(doc1.a === 1 && doc1.b === 2, 'батч создаёт полный документ');

  // Обновляем через батч с merge:true
  const batch2 = db.batch();
  batch2.set(ref, { a: 10 }, { merge: true });
  await batch2.commit();
  const snap2 = await ref.get();
  const doc2 = snap2.data();
  assert(doc2.a === 10, 'батч merge обновляет поле a');
  assert(doc2.b === 2, 'батч merge сохраняет поле b (ошибка без проброса opts)');

  // Окно месяца берётся с запасом назад: длительное событие, начавшееся
  // 28 июля и кончающееся 3 августа, обязано попасть в август.
  const range = w('(s)=>JSON.stringify(s.monthRange(2026, 7))'); // 7 = август
  assert(JSON.parse(range)[0] === '2026-07-01', 'окно августа начинается за 31 день до начала месяца');
  assert(JSON.parse(range)[1] === '2026-08-31', 'окно августа кончается последним днём месяца');

  // Наполняем мок напрямую и проверяем, что горячий набор разложился в db
  mock._store['couples/main/notes/n1'] = { text: 'Привет', author: 'gosha', pinned: false, order: 0, ts: 1 };
  mock._store['couples/main/labels/l1'] = { name: 'Семья', color: '#ec4899' };
  mock._store['couples/main/events/e1'] = { title: 'Годовщина', date: '2026-03-30', md: '03-30', repeat: true };
  mock._store['couples/main/meta/settings'] = { pushSubs: { gosha: { endpoint: 'x' } } };
  await w('(s)=>s.loadHotSet()');
  assert(w('(s)=>s.db.notes.length') === 1, 'заметки загружены целиком');
  assert(w('(s)=>s.db.notes[0].id') === 'n1', 'id документа попал в объект');
  assert(w('(s)=>s.db.labels[0].name') === 'Семья', 'лейблы загружены');
  assert(w('(s)=>s.db.events.some(e=>e.id==="e1")') === true, 'повторяющееся событие в наборе независимо от года');
  assert(w('(s)=>!!s.db.pushSubs.gosha') === true, 'подписки подтянулись из meta/settings');

  // Событие вне окна не грузится, пока не откроют его месяц
  mock._store['couples/main/events/e2'] = { title: 'Далёкое', date: '2027-12-01', md: '12-01', repeat: false };
  await w('(s)=>s.loadHotSet()');
  assert(w('(s)=>s.db.events.some(e=>e.id==="e2")') === false, 'далёкое событие не в горячем наборе');
  await w('(s)=>s.loadMonth(2027, 11)');
  assert(w('(s)=>s.db.events.some(e=>e.id==="e2")') === true, 'loadMonth дотянул нужный месяц');
  await w('(s)=>s.loadMonth(2027, 11)');
  assert(w('(s)=>s.db.events.filter(e=>e.id==="e2").length') === 1, 'повторный loadMonth не дублирует события');

  // РЕВЬЮ (Critical): тест выше на самом деле не проверял mergeById — второй
  // loadMonth(2027, 11) останавливается на guard'е `loadedMonths.has(key)` и
  // до mergeById не доходит. Настоящее пересечение возникает внутри одного
  // loadHotSet(): repeat:true-событие, чья дата попадает в окно текущего
  // месяца, приходит сразу от двух параллельных запросов (repeats и window) —
  // склеить их без дублей обязан именно mergeById.
  const today = new Date();
  const overlapDate = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-15';
  mock._store['couples/main/events/e3'] = { title: 'Пересечение', date: overlapDate, md: overlapDate.slice(5), repeat: true };
  await w('(s)=>s.loadHotSet()');
  assert(w('(s)=>s.db.events.filter(e=>e.id==="e3").length') === 1, 'repeat-событие внутри окна месяца не дублируется при склейке repeats+window');

  // Находка 2: свидания больше не режутся окном — «Память» ищет годовщины
  // свиданий среди ВСЕХ лет, а не только последнего месяца.
  const twoYearsAgo = today.getFullYear() - 2 + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-01';
  mock._store['couples/main/dates/d1'] = { place: 'Кафе', date: twoYearsAgo };
  await w('(s)=>s.loadHotSet()');
  assert(w('(s)=>s.db.dates.some(d=>d.id==="d1")') === true, 'старое свидание не отрезается окном загрузки');

  // repoSet кладёт документ и возвращает id, не сохраняя id внутрь документа
  const newId = await w('(s)=>s.repoSet("notes", {id:"n2", text:"Вторая", author:"dasha", pinned:false, order:1, ts:2})');
  assert(newId === 'n2', 'repoSet возвращает id');
  assert(mock._store['couples/main/notes/n2'].text === 'Вторая', 'документ записан');
  assert(mock._store['couples/main/notes/n2'].id === undefined, 'id не дублируется внутрь документа');

  // repoSet без id генерирует его сам
  const genId = await w('(s)=>s.repoSet("notes", {text:"Третья", author:"gosha", pinned:false, order:2, ts:3})');
  assert(typeof genId === 'string' && genId.length > 0, 'repoSet сам выдаёт id, если его нет');

  // repoDelete убирает документ
  await w('(s)=>s.repoDelete("notes","n2")');
  assert(mock._store['couples/main/notes/n2'] === undefined, 'repoDelete удаляет документ');

  // repoBatch пишет пачкой — так сохраняется новый порядок после перетаскивания
  await w('(s)=>s.repoBatch("notes", [{id:"n1", text:"Привет", order:5}, {id:"n3", text:"Ещё", order:6}])');
  assert(mock._store['couples/main/notes/n1'].order === 5, 'батч обновил первый документ');
  assert(mock._store['couples/main/notes/n3'].order === 6, 'батч создал второй документ');

  // repoMeta пишет ТОЧЕЧНО: подписка партнёра не должна пострадать
  mock._store['couples/main/meta/settings'] = { pushSubs: { gosha: { endpoint: 'g' }, dasha: { endpoint: 'd' } } };
  await w('(s)=>s.repoMeta({"pushSubs.gosha": {endpoint:"g2"}})');
  assert(mock._store['couples/main/meta/settings'].pushSubs.gosha.endpoint === 'g2', 'своя подписка обновилась');
  assert(mock._store['couples/main/meta/settings'].pushSubs.dasha.endpoint === 'd', 'подписка партнёра не затёрта');

  // РЕВЬЮ (Important, находка 2а): документа meta/settings ещё нет —
  // update() падает с code:'not-found', repoMeta обязан создать документ
  // слиянием и записать поле, а не просто перевыбросить ошибку.
  delete mock._store['couples/main/meta/settings'];
  await w('(s)=>s.repoMeta({"pushSubs.gosha": {endpoint:"g3"}})');
  assert(mock._store['couples/main/meta/settings'].pushSubs.gosha.endpoint === 'g3', 'repoMeta создаёт документ meta/settings, если его не было');

  // РЕВЬЮ (Important, находка 2б): ошибка с ЛЮБЫМ другим кодом (например,
  // отказ в доступе) не должна маскироваться под «документа нет» — repoMeta
  // обязан пробросить её наружу, а не тихо создать документ и повторить update().
  mock._failNextUpdate('couples/main/meta/settings', 'permission-denied');
  let repoMetaError = null;
  try {
    await w('(s)=>s.repoMeta({"pushSubs.gosha": {endpoint:"g4"}})');
  } catch (e) {
    repoMetaError = e;
  }
  assert(repoMetaError && repoMetaError.code === 'permission-denied', 'repoMeta пробрасывает не-not-found ошибку, а не глушит её');
  assert(mock._store['couples/main/meta/settings'].pushSubs.gosha.endpoint === 'g3', 'после проброшенной ошибки документ не тронут лишней записью');

  // РЕВЬЮ (Important, находка 1): repoBatch режет запись по 400 операций —
  // границу лимита Firestore (500 на батч) тесты выше не проверяли вообще
  // (там всего 2 объекта). Пишем 850: должны записаться первый, последний и
  // оба документа ровно на границе нарезки (400-й индекс), а commit() должен
  // вызваться трижды (400 + 400 + 50), а не один раз — иначе нарезка сломана.
  const bigItems = [];
  for (let i = 0; i < 850; i++) bigItems.push({ id: 'b' + i, order: i });
  const commitsBefore = mock._commitCount;
  await w('(s)=>s.repoBatch("notes", ' + JSON.stringify(bigItems) + ')');
  assert(mock._store['couples/main/notes/b0'].order === 0, 'батч на 850 объектов записал первый документ');
  assert(mock._store['couples/main/notes/b849'].order === 849, 'батч на 850 объектов записал последний документ');
  assert(mock._store['couples/main/notes/b399'].order === 399, 'документ на границе нарезки (конец первого куска) записан');
  assert(mock._store['couples/main/notes/b400'].order === 400, 'документ на границе нарезки (начало второго куска) записан');
  assert(mock._commitCount - commitsBefore === 3, 'нарезка реально произошла: 850 объектов ушли тремя commit() по ≤400');

  console.log('OK: ' + results.length + ' repo checks passed');
})().catch(e => {
  console.log('FAIL: repo: ' + (e && e.message));
  process.exit(1);
});
