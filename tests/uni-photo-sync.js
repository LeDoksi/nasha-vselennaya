/* Юнит-тест синхронизации фото: мок Firebase RTDB (вход/сейф) + мок fetch для
   Yandex Object Storage (публичный бакет, без ключей — см. src/95-sync.js).
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
  return { id: '', dataset: {}, children: [], hidden: false, innerHTML: '', textContent: '',
    style: {}, value: '', options: [], _handlers: {}, _attrs: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); }, querySelectorAll() { return []; },
    appendChild() {}, remove() {}, focus() {}, click() {},
    setAttribute(k, v) { this._attrs[k] = String(v); }, getAttribute(k) { return this._attrs[k] ?? null; }, removeAttribute(k) { delete this._attrs[k]; } };
}
// Мок Firebase: только RTDB (сейф). Фото больше не идут через Firebase.
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

// ===== Мок fetch для Yandex Object Storage (публичный бакет photos/*, без ключей) =====
// mockBucket: '/photos/{part}/{id}' → текст тела (шифртекст-обёртка JSON).
const mockBucket = {};
function xmlList(prefix) {
  const keys = Object.keys(mockBucket).filter(k => k.slice(1).startsWith(prefix));
  return '<ListBucketResult>' + keys.map(k => '<Contents><Key>' + k.slice(1) + '</Key></Contents>').join('') + '</ListBucketResult>';
}
async function fetchMock(url, opts) {
  const method = (opts && opts.method) || 'GET';
  const path = String(url).replace(/^https?:\/\/[^/]+/, '');
  if (path.indexOf('/?list-type=2') === 0) {
    const m = /prefix=([^&]+)/.exec(path);
    const prefix = m ? decodeURIComponent(m[1]) : '';
    return { ok: true, status: 200, text: () => Promise.resolve(xmlList(prefix)) };
  }
  if (method === 'PUT') {
    mockBucket[path] = opts.body;
    return { ok: true, status: 200, text: () => Promise.resolve(''), blob: () => Promise.resolve(new Blob([opts.body])) };
  }
  if (method === 'DELETE') {
    delete mockBucket[path];
    return { ok: true, status: 204, text: () => Promise.resolve('') };
  }
  // GET один объект
  const body = mockBucket[path];
  if (body === undefined) return { ok: false, status: 404, text: () => Promise.resolve('NoSuchKey') };
  return { ok: true, status: 200, text: () => Promise.resolve(body), blob: () => Promise.resolve(new Blob([body], { type: 'application/json' })) };
}

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
  FileReader: function () {},
  Blob: function (parts, opts) {
    this.type = (opts && opts.type) || '';
    const chunks = [];
    for (const p of (parts || [])) {
      if (p instanceof Uint8Array) chunks.push(String.fromCharCode(...p));
      else if (p != null) chunks.push(String(p));
    }
    this._text = chunks.join('');
    this.size = this._text.length;
    this.arrayBuffer = () => Promise.resolve(new TextEncoder().encode(this._text).buffer);
    this.text = () => Promise.resolve(this._text);
  },
  HTMLAudioElement: function () {}, Image: function () {},
  setTimeout() { return 0; }, setInterval() { return 1; }, addEventListener() {},
  isNaN, console, Date, Math, JSON, Object, Array, Number, String, RegExp,
  firebase, fetch: fetchMock,
  _store: {}, _ss: {}
};
function assert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); process.exit(1); }
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
  s.createVault = createVault; s.lock = lock; s.save = save; s.loadVault = loadVault;
  s.initSync = initSync; s.stopSync = stopSync;
  s.syncPhotos = syncPhotos; s.schedulePhotoSync = schedulePhotoSync; s.listCloudPhotos = listCloudPhotos;
  s.probeCloudKeys = probeCloudKeys;
}
`;

const wrapped = new Function('sandbox', 'document', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'URL',
  'FileReader', 'Blob', 'HTMLAudioElement', 'Image', 'setTimeout', 'setInterval', 'addEventListener', 'firebase', 'fetch',
  src + suffix);
wrapped(sandbox, sandbox.document, sandbox.localStorage, sandbox.sessionStorage, sandbox.alert, sandbox.confirm,
  sandbox.URL, sandbox.FileReader, sandbox.Blob, sandbox.HTMLAudioElement, sandbox.Image,
  sandbox.setTimeout, sandbox.setInterval, sandbox.addEventListener, firebase, fetchMock);

const w = (f) => new Function('sandbox', 'return (' + f + ')(sandbox)')(sandbox);

(async () => {
  // 1. config + сейф + инициализация (Yandex Object Storage подключился)
  w('(s)=>{s.FIREBASE_CONFIG = { projectId: "mock" }; return 1;}');
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
  assert(!String(mockBucket['/photos/orig/pA'] || '').includes('ORIG-A') && !String(mockBucket['/photos/full/pA'] || '').includes('FULL-A'),
    'в облаке лежит шифртекст, а не открытое фото (zero-knowledge)');

  // 3. «Второе устройство»: стор пуст, облако уже знает фото — скачиваем всё назад
  await w('(s)=>{s.photoStore.clear(); return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert(await w('(s)=>s.photoStore.getMeta("pA")') !== null, 'фото скачано из облака в store');
  const idsA = await w('(s)=>s.photoStore.listIds()');
  assert(idsA.some(i => i.id === 'pA' && i.hasOrig && i.hasFull && i.hasThumb), 'скачаны все три части фото');

  // 4. Фото, загруженное партнёром (в облаке есть pB, локально нет) — докачивается.
  await w('(s)=>s.photoStore.put("pB", new Blob(["FULL-B"]), new Blob(["THUMB-B"]), {type:"image/png",thumbType:"image/webp",title:"Фото Б"}, new Blob(["ORIG-B"]))');
  w('(s)=>{s.db.photos.unshift({id:"pB",title:"Фото Б",labels:[],pinned:false,ts:2,order:1});return 1;}');
  await w('(s)=>s.syncPhotos()');
  await w('(s)=>{s.photoStore.delete("pB"); return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert(await w('(s)=>s.photoStore.getMeta("pB")') !== null, 'фото pB скачано из облака');
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
  assert(!mockBucket['/photos/orig/pA'] && !mockBucket['/photos/full/pA'] && !mockBucket['/photos/thumb/pA'],
    'удалённое фото убрано из облака');
  assert(await w('(s)=>s.photoStore.getMeta("pA")') === null, 'удалённое фото убрано из локального стора');

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
  assert(!!mockBucket['/photos/full/pZ'] && !!mockBucket['/photos/thumb/pZ'],
    'фото чужого ключа не удаляются из облака (это не мусор)');
  assert(!!mockBucket['/photos/full/pB'] && !!mockBucket['/photos/full/pOld'],
    'смесь «наших» и «чужих»: чужие не удаляются, наши не затираются (want пуст — синхронизировать нечего)');
  assert(await w('(s)=>s.photoStore.getMeta("pZ")') === null,
    'фото чужого ключа не скачиваются в локальный стор');
  assert(w('(s)=>s.photoSyncing') === false, 'syncPhotos завершился штатно (флаг сброшен)');

  // 9. Чисто чужое облако (свежий браузер, сейф создан заново): в облаке ТОЛЬКО
  // фото старого ключа, локальный «want» пуст — главный сценарий защиты от «мусора».
  delete mockBucket['/photos/full/pB']; delete mockBucket['/photos/thumb/pB']; delete mockBucket['/photos/orig/pB'];
  delete mockBucket['/photos/full/pOld']; delete mockBucket['/photos/thumb/pOld'];
  await w('(s)=>s.syncPhotos()');
  assert(!!mockBucket['/photos/full/pZ'] && !!mockBucket['/photos/thumb/pZ'],
    'свежий браузер: чужое облако не стирается как «мусор»');
  assert(await w('(s)=>s.photoStore.getMeta("pZ")') === null,
    'свежий браузер: чужое облако не скачивается');
  assert(w('(s)=>s.photoSyncing') === false, 'свежий браузер: syncPhotos завершился штатно');

  // 10. ГЛАВНЫЙ СЦЕНАРИЙ: локальные свои фото + чужое фото в облаке.
  // probeCloudKeys() помечает чужое, но свои фото синхронизируются: выгружаются
  // в облако, чужое не трогается (раньше единый сбой расшифровки прерывал всю сверку).
  await w('(s)=>s.photoStore.put("pN", new Blob(["FULL-N"]), new Blob(["THUMB-N"]), {type:"image/jpeg",thumbType:"image/webp",title:"N"}, new Blob(["ORIG-N"]))');
  w('(s)=>{s.db.photos = [{id:"pN",title:"N",labels:[],pinned:false,ts:5,order:1}]; return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert(!!mockBucket['/photos/orig/pN'] && !!mockBucket['/photos/full/pN'] && !!mockBucket['/photos/thumb/pN'],
    'своё фото выгружается, даже когда в облаке есть чужое');
  assert(!!mockBucket['/photos/full/pZ'] && !!mockBucket['/photos/thumb/pZ'],
    'чужое фото остаётся нетронутым при выгрузке своих');
  assert(await w('(s)=>s.photoStore.getMeta("pN")') !== null,
    'своё фото осталось в локальном сторе');
  assert(w('(s)=>s.photoSyncing') === false, 'syncPhotos завершился штатно');

  console.log('OK: ' + results.length + ' photo-sync checks passed');
})().catch(e => { process.stdout.write('FAIL: photo-sync: ' + (e && (e.stack || e.message) || e) + '\n'); process.exit(1); });
