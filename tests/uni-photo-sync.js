/* Юнит-тест синхронизации фото: мок Firebase RTDB (вход/сейф) + мок fetch для
   Yandex Object Storage (чтение — анонимно напрямую в бакет; запись — через
   мок Cloud Function photo-sign, которая отдаёт «подписанную» ссылку — см.
   src/95-sync.js и functions/photo-sign/).
   Проверяет: выгрузку оригинала/показ-версии/миниатюры в облако, скачивание
   на «другом устройстве», докачку фото партнёра, бэкфилл старых фото без
   оригинала, очистку удалённых фото из облака и локального стора,
   zero-knowledge (в облаке — шифртекст), и что «чужие» фото (другой мастер-
   ключ) не считаются мусором и не трогаются.
   Запуск: node tests\uni-photo-sync.js app.js */
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
// Мок Firebase: только RTDB (сейф). Фото больше не идут через Firebase.
const mockDb = { data: {}, _onCb: null };
const firebase = {
  initializeApp(config, name) {
    return { name: name || 'default', config };
  },
  auth() {
    return { signInAnonymously: async () => ({ user: { uid: 'mock-uid' } }), signOut: async () => {} };
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

// ===== Мок fetch для Yandex Object Storage + мок Cloud Function photo-sign =====
// mockBucket: '/photos/{part}/{id}' → текст тела (шифртекст-обёртка JSON).
const mockBucket = {};
const SIGN_FN_URL = 'https://functions.yandexcloud.net/mock-photo-sign';
const signCalls = []; // для проверки, что запись реально идёт через функцию
const getCalls = []; // GET-запросы к конкретным объектам (не список) — для проверки, что уже свои фото не перепроверяются заново
const timeoutCalls = []; // задержки setTimeout из sync-модуля — проверить, что «висящее» фото планирует быстрый повтор (3с), а не 20с
let paginateLimit = null; // не null в тесте пагинации — режет список на страницы по N ключей
function xmlList(prefix, token) {
  const keys = Object.keys(mockBucket)
    .filter(k => k.slice(1).startsWith(prefix))
    .map(k => k.slice(1))
    .sort();
  if (!paginateLimit) {
    return '<ListBucketResult>' + keys.map(k => '<Contents><Key>' + k + '</Key></Contents>').join('') + '</ListBucketResult>';
  }
  const start = token ? keys.indexOf(token) + 1 : 0;
  const page = keys.slice(start, start + paginateLimit);
  const truncated = start + paginateLimit < keys.length;
  return (
    '<ListBucketResult>' +
    page.map(k => '<Contents><Key>' + k + '</Key></Contents>').join('') +
    '<IsTruncated>' +
    (truncated ? 'true' : 'false') +
    '</IsTruncated>' +
    (truncated ? '<NextContinuationToken>' + page[page.length - 1] + '</NextContinuationToken>' : '') +
    '</ListBucketResult>'
  );
}
async function fetchMock(url, opts) {
  const method = (opts && opts.method) || 'GET';
  const full = String(url).replace(/^https?:\/\/[^/]+/, '');
  const qIdx = full.indexOf('?');
  const pathname = qIdx === -1 ? full : full.slice(0, qIdx);
  if (String(url).indexOf(SIGN_FN_URL) === 0) {
    // Мок функции подписи: не проверяет секрет (его тут и нет), просто
    // возвращает «подписанную» ссылку на тот же мок-бакет — signature фиктивна,
    // мок PUT/DELETE её не проверяет (проверка подписи — забота реального S3,
    // а не нашего кода; здесь тестируем контракт «функция → presigned URL → PUT»).
    const qs = new URLSearchParams(full.slice(qIdx + 1));
    signCalls.push({ method: qs.get('method'), part: qs.get('part'), id: qs.get('id') });
    const target = 'https://nasha-vselennaya.storage.yandexcloud.net/photos/' + qs.get('part') + '/' + qs.get('id') + '?X-Amz-Signature=mock';
    return { ok: true, status: 200, json: () => Promise.resolve({ url: target }) };
  }
  if (pathname === '/' && full.indexOf('list-type=2') !== -1) {
    const m = /prefix=([^&]+)/.exec(full);
    const prefix = m ? decodeURIComponent(m[1]) : '';
    const tm = /continuation-token=([^&]+)/.exec(full);
    const token = tm ? decodeURIComponent(tm[1]) : null;
    return { ok: true, status: 200, text: () => Promise.resolve(xmlList(prefix, token)) };
  }
  if (method === 'PUT') {
    mockBucket[pathname] = opts.body;
    return { ok: true, status: 200, text: () => Promise.resolve(''), blob: () => Promise.resolve(new Blob([opts.body])) };
  }
  if (method === 'DELETE') {
    delete mockBucket[pathname];
    return { ok: true, status: 204, text: () => Promise.resolve('') };
  }
  // GET один объект
  getCalls.push(pathname);
  const body = mockBucket[pathname];
  if (body === undefined) return { ok: false, status: 404, text: () => Promise.resolve('NoSuchKey') };
  return { ok: true, status: 200, text: () => Promise.resolve(body), blob: () => Promise.resolve(new Blob([body], { type: 'application/json' })) };
}

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
  Blob: function (parts, opts) {
    this.type = (opts && opts.type) || '';
    const chunks = [];
    for (const p of parts || []) {
      if (p instanceof Uint8Array) chunks.push(String.fromCharCode(...p));
      else if (p != null) chunks.push(String(p));
    }
    this._text = chunks.join('');
    this.size = this._text.length;
    this.arrayBuffer = () => Promise.resolve(new TextEncoder().encode(this._text).buffer);
    this.text = () => Promise.resolve(this._text);
  },
  HTMLAudioElement: function () {},
  Image: function () {},
  setTimeout(fn, ms) {
    timeoutCalls.push(ms);
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
  fetch: fetchMock,
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
  Object.defineProperty(s, 'masterKey', { get: () => masterKey, configurable: true });
  Object.defineProperty(s, 'photoStore', { get: () => photoStore, configurable: true });
  Object.defineProperty(s, 'syncReady', { get: () => syncReady, set: v => { syncReady = v; }, configurable: true });
  Object.defineProperty(s, 'syncStorage', { get: () => syncStorage, set: v => { syncStorage = v; }, configurable: true });
  Object.defineProperty(s, 'photoSyncing', { get: () => photoSyncing, set: v => { photoSyncing = v; }, configurable: true });
  Object.defineProperty(s, 'FIREBASE_CONFIG', { get: () => FIREBASE_CONFIG, set: v => { FIREBASE_CONFIG = v; }, configurable: true });
  Object.defineProperty(s, 'YANDEX_CLOUD_CONFIG', { get: () => YANDEX_CLOUD_CONFIG, set: v => { YANDEX_CLOUD_CONFIG = v; }, configurable: true });
  s.createVault = createVault; s.lock = lock; s.save = save; s.loadVault = loadVault;
  s.initSync = initSync; s.stopSync = stopSync;
  s.syncPhotos = syncPhotos; s.schedulePhotoSync = schedulePhotoSync; s.listCloudPhotos = listCloudPhotos;
  s.probeCloudKeys = probeCloudKeys;
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
  'fetch',
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
  firebase,
  fetchMock
);

const w = f => new Function('sandbox', 'return (' + f + ')(sandbox)')(sandbox);

(async () => {
  // 1. config + сейф + инициализация (Yandex Object Storage подключился)
  w('(s)=>{s.FIREBASE_CONFIG = { projectId: "mock" }; return 1;}');
  w(`(s)=>{s.YANDEX_CLOUD_CONFIG = { bucket: "nasha-vselennaya", region: "ru-central1", signFnUrl: "${SIGN_FN_URL}" }; return 1;}`);
  await w('(s)=>s.createVault("gosha","123456")');
  await w('(s)=>s.initSync()');
  assert(w('(s)=>s.syncReady') === true, 'syncReady=true с mock-firebase');
  assert(w('(s)=>s.syncStorage') !== null, 'syncStorage инициализирован (Yandex Object Storage)');
  assert(JSON.stringify(await w('(s)=>s.listCloudPhotos()')) === '{}', 'пустой бакет = пустой список');

  // 2. Фото на устройстве А → выгружается в облако (оригинал + показ + миниатюра)
  await w('(s)=>{s.db.photos.unshift({id:"pA",title:"Фото А",labels:[],pinned:false,ts:1,order:0});return 1;}');
  await w('(s)=>s.photoStore.put("pA", new Blob(["FULL-A"]), new Blob(["THUMB-A"]), {type:"image/jpeg",thumbType:"image/webp",title:"Фото А"}, new Blob(["ORIG-A"]))');
  await w('(s)=>s.syncPhotos()');
  assert(!!mockBucket['/photos/orig/pA'], 'оригинал ушёл в облако');
  assert(!!mockBucket['/photos/full/pA'], 'показ-версия ушла в облако');
  assert(!!mockBucket['/photos/thumb/pA'], 'миниатюра ушла в облако');
  assert(
    !String(mockBucket['/photos/orig/pA'] || '').includes('ORIG-A') && !String(mockBucket['/photos/full/pA'] || '').includes('FULL-A'),
    'в облаке лежит шифртекст, а не открытое фото (zero-knowledge)'
  );
  assert(
    signCalls.some(c => c.method === 'PUT' && c.part === 'orig' && c.id === 'pA'),
    'запись оригинала запросила подписанную ссылку у функции photo-sign (не голый PUT в бакет)'
  );

  // 2b. Повторная сверка без изменений: pA уже полностью локально и всё ещё в
  // db.photos — повторно проверять его расшифровку (сетевой GET) не нужно,
  // мы его и так сами зашифровали/скачали. Раньше probeCloudKeys() дёргала
  // ВСЕ облачные фото при каждой сверке — эта проверка ловит регресс.
  getCalls.length = 0;
  await w('(s)=>s.syncPhotos()');
  assert(!getCalls.some(p => p.indexOf('/pA') !== -1), 'уже свои фото (в db.photos + полностью локально) не перепроверяются заново при повторной сверке');

  // 2c. Гонка с другим устройством: сейф (через живой слушатель) уже принёс
  // запись о новом фото pRace в db.photos, а сам файл другое устройство ещё
  // грузит — в облаке его пока нет, локально тоже. Без фикса sync тихо
  // завершался бы «успешно», ничего не скачав, и не повторялся бы — фото
  // оставалось бы «битым», пока кто-то не нажмёт «Синхронизировать сейчас»
  // вручную. С фиксом — должен запланировать быстрый повтор (3с), а не
  // молчать и не ждать 20с, как при настоящей ошибке сети.
  w('(s)=>{s.db.photos.unshift({id:"pRace",title:"Гонка",labels:[],pinned:false,ts:9,order:0});return 1;}');
  timeoutCalls.length = 0;
  await w('(s)=>s.syncPhotos()');
  assert(timeoutCalls.includes(3000), '«висящее» (ещё нигде не появившееся) фото планирует быстрый повтор через 3с');
  assert(!timeoutCalls.includes(20000), 'быстрый повтор не путается с 20-секундным (это не сбой, а ожидание)');
  // Другое устройство наконец докачало файл — при следующей сверке подхватываем.
  await w('(s)=>s.photoStore.put("pRace", new Blob(["FULL-RACE"]), new Blob(["THUMB-RACE"]), {type:"image/jpeg",thumbType:"image/webp",title:"Гонка"}, null)');
  await w('(s)=>s.syncPhotos()');
  w('(s)=>{s.db.photos = s.db.photos.filter(p => p.id !== "pRace"); return 1;}');
  await w('(s)=>s.syncPhotos()'); // чистим за собой, чтобы не мешать следующим сценариям

  // 3. «Второе устройство»: стор пуст, облако уже знает фото — скачиваем всё назад
  await w('(s)=>{s.photoStore.clear(); return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert((await w('(s)=>s.photoStore.getMeta("pA")')) !== null, 'фото скачано из облака в store');
  const idsA = await w('(s)=>s.photoStore.listIds()');
  assert(
    idsA.some(i => i.id === 'pA' && i.hasOrig && i.hasFull && i.hasThumb),
    'скачаны все три части фото'
  );

  // 4. Фото, загруженное партнёром (в облаке есть pB, локально нет) — докачивается.
  await w('(s)=>s.photoStore.put("pB", new Blob(["FULL-B"]), new Blob(["THUMB-B"]), {type:"image/png",thumbType:"image/webp",title:"Фото Б"}, new Blob(["ORIG-B"]))');
  w('(s)=>{s.db.photos.unshift({id:"pB",title:"Фото Б",labels:[],pinned:false,ts:2,order:1});return 1;}');
  await w('(s)=>s.syncPhotos()');
  await w('(s)=>{s.photoStore.delete("pB"); return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert((await w('(s)=>s.photoStore.getMeta("pB")')) !== null, 'фото pB скачано из облака');
  const origB = await w('(s)=>s.photoStore.getOrig("pB")');
  assert(origB && origB.type === 'image/png', 'оригинал pB сохранил свой тип после кругосветки');

  // 5. Бэкфилл: старое фото без оригинала — уходят только показ-версия и миниатюра
  await w('(s)=>s.photoStore.put("pOld", new Blob(["FULL-OLD"]), new Blob(["THUMB-OLD"]), {type:"image/jpeg"}, null)');
  w('(s)=>{s.db.photos.unshift({id:"pOld",title:"Старое",labels:[],pinned:false,ts:3,order:2});return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert(!!mockBucket['/photos/full/pOld'], 'легаси-фото: показ-версия ушла в облако');
  assert(!!mockBucket['/photos/thumb/pOld'], 'легаси-фото: миниатюра ушла в облако');
  assert(!mockBucket['/photos/orig/pOld'], 'легаси-фото: оригинала нет — ничего не выгружаем');

  // 6. Удаление фото → исчезает из облака и из локального стора
  w('(s)=>{s.db.photos = s.db.photos.filter(p => p.id !== "pA"); return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert(!mockBucket['/photos/orig/pA'] && !mockBucket['/photos/full/pA'] && !mockBucket['/photos/thumb/pA'], 'удалённое фото убрано из облака');
  assert((await w('(s)=>s.photoStore.getMeta("pA")')) === null, 'удалённое фото убрано из локального стора');

  // 7. stopSync отключает и фото-синхронизацию
  w('(s)=>{s.stopSync(); return 1;}');
  assert(w('(s)=>s.syncStorage') === null, 'stopSync отключает syncStorage');
  await w('(s)=>s.initSync()'); // снова включаем для оставшихся сценариев

  // 8. Критично: в облаке лежат фото, зашифрованные ДРУГИМ ключом (свежий браузер
  // создал свой сейф, а в облаке — фото старого). Локальный «want» пуст. syncPhotos
  // НЕ должен удалить эти фото как «облачный мусор».
  const foreignBody = JSON.stringify({
    e: { d: 'c2FsdA==', i: 'aW52', s: 'cw==' }, // «шифртекст» чужого ключа — не расшифруется
    m: { t: 'image/jpeg', ft: 'image/jpeg', st: 'image/webp', s: 10 }
  });
  mockBucket['/photos/full/pZ'] = foreignBody;
  mockBucket['/photos/thumb/pZ'] = foreignBody;
  await w('(s)=>{s.db.photos = []; return 1;}'); // локально пусто (новое устройство)
  await w('(s)=>s.syncPhotos()');
  assert(!!mockBucket['/photos/full/pZ'] && !!mockBucket['/photos/thumb/pZ'], 'фото чужого ключа не удаляются из облака (это не мусор)');
  assert(!!mockBucket['/photos/full/pB'] && !!mockBucket['/photos/full/pOld'], 'смесь «наших» и «чужих»: чужие не удаляются, наши не затираются (want пуст — синхронизировать нечего)');
  assert((await w('(s)=>s.photoStore.getMeta("pZ")')) === null, 'фото чужого ключа не скачиваются в локальный стор');
  assert(w('(s)=>s.photoSyncing') === false, 'syncPhotos завершился штатно (флаг сброшен)');

  // 9. Чисто чужое облако (свежий браузер, сейф создан заново): в облаке ТОЛЬКО
  // фото старого ключа, локальный «want» пуст — главный сценарий защиты от «мусора».
  delete mockBucket['/photos/full/pB'];
  delete mockBucket['/photos/thumb/pB'];
  delete mockBucket['/photos/orig/pB'];
  delete mockBucket['/photos/full/pOld'];
  delete mockBucket['/photos/thumb/pOld'];
  await w('(s)=>s.syncPhotos()');
  assert(!!mockBucket['/photos/full/pZ'] && !!mockBucket['/photos/thumb/pZ'], 'свежий браузер: чужое облако не стирается как «мусор»');
  assert((await w('(s)=>s.photoStore.getMeta("pZ")')) === null, 'свежий браузер: чужое облако не скачивается');
  assert(w('(s)=>s.photoSyncing') === false, 'свежий браузер: syncPhotos завершился штатно');

  // 10. ГЛАВНЫЙ СЦЕНАРИЙ: локальные свои фото + чужое фото в облаке.
  // probeCloudKeys() помечает чужое, но свои фото синхронизируются: выгружаются
  // в облако, чужое не трогается (раньше единый сбой расшифровки прерывал всю сверку).
  await w('(s)=>s.photoStore.put("pN", new Blob(["FULL-N"]), new Blob(["THUMB-N"]), {type:"image/jpeg",thumbType:"image/webp",title:"N"}, new Blob(["ORIG-N"]))');
  w('(s)=>{s.db.photos = [{id:"pN",title:"N",labels:[],pinned:false,ts:5,order:1}]; return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert(!!mockBucket['/photos/orig/pN'] && !!mockBucket['/photos/full/pN'] && !!mockBucket['/photos/thumb/pN'], 'своё фото выгружается, даже когда в облаке есть чужое');
  assert(!!mockBucket['/photos/full/pZ'] && !!mockBucket['/photos/thumb/pZ'], 'чужое фото остаётся нетронутым при выгрузке своих');
  assert((await w('(s)=>s.photoStore.getMeta("pN")')) !== null, 'своё фото осталось в локальном сторе');
  assert(w('(s)=>s.photoSyncing') === false, 'syncPhotos завершился штатно');

  // 11. Пагинация листинга: ListObjectsV2 у настоящего Yandex Object Storage
  // отдаёт максимум 1000 ключей за раз (IsTruncated + NextContinuationToken).
  // Без пагинации на клиенте список молча обрывался бы. Мок режет страницы
  // по 2 ключа и проверяет, что клиент сам идёт по continuation-token, пока
  // не соберёт всё.
  paginateLimit = 2;
  for (const n of ['q1', 'q2', 'q3', 'q4', 'q5']) mockBucket['/photos/thumb/' + n] = '{"e":{"i":"x","d":"y"}}';
  const paged = await w('(s)=>s.listCloudPhotos()');
  paginateLimit = null;
  for (const n of ['q1', 'q2', 'q3', 'q4', 'q5']) delete mockBucket['/photos/thumb/' + n];
  assert(
    ['q1', 'q2', 'q3', 'q4', 'q5'].every(n => paged[n] && paged[n].thumb),
    'постраничный список (лимит 2 на страницу) всё равно собирает все 5 ключей через continuation-token'
  );

  console.log('OK: ' + results.length + ' photo-sync checks passed');
})().catch(e => {
  process.stdout.write('FAIL: photo-sync: ' + ((e && (e.stack || e.message)) || e) + '\n');
  process.exit(1);
});
