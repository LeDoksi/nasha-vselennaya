/* Юнит-тест синхронизации фото (фаза B3): мок Firebase Storage + мок Яндекс.Диска.
   Проверяет: выгрузку оригинала/показ-версии/миниатюры в облако, скачивание
   на «другом устройстве», очистку удалённых фото из облака и локального стора,
   бэкфилл старых фото без оригинала, zero-knowledge (в облаке — шифртекст),
   и адаптер Яндекс.Диска (REST API, бесплатный тариф) с моком fetch.
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
// Мок Firebase: RTDB (как в uni-sync) + Storage (для фото)
const mockDb = { data: {}, _onCb: null };
const mockStorage = {}; // path → Blob|string
function makeStRef(path) {
  const full = String(path || '').replace(/^\/+|\/+$/g, '');
  return {
    fullPath: full,
    name: full.split('/').pop(),
    put(blob) { mockStorage[full] = blob; return Promise.resolve({}); },
    getBlob() { return Promise.resolve(mockStorage[full] || null); },
    delete() { delete mockStorage[full]; return Promise.resolve(); },
    listAll() {
      const prefix = full ? full + '/' : '';
      const items = Object.keys(mockStorage)
        .filter(k => k.startsWith(prefix) && k.slice(prefix.length).indexOf('/') === -1)
        .map(k => makeStRef(k));
      return Promise.resolve({ items, prefixes: [] });
    }
  };
}
const firebase = {
  initializeApp(config, name) { return { name: name || 'default', config }; },
  auth() { return { signInAnonymously: async () => ({ user: { uid: 'mock-uid' } }), signOut: async () => {} }; },
  storage() { return { ref: makeStRef }; },
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
  firebase,
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
  Object.defineProperty(s, 'YANDEX_DISK_CONFIG', { get: () => YANDEX_DISK_CONFIG, set: v => { YANDEX_DISK_CONFIG = v; }, configurable: true });
  Object.defineProperty(s, 'ydFetch', { get: () => ydFetch, set: v => { ydFetch = v; }, configurable: true });
  s.createVault = createVault; s.lock = lock; s.save = save; s.loadVault = loadVault;
  s.initSync = initSync; s.stopSync = stopSync;
  s.syncPhotos = syncPhotos; s.schedulePhotoSync = schedulePhotoSync; s.listCloudPhotos = listCloudPhotos;
  s.probeCloudKeys = probeCloudKeys;
  s.makeYdStorage = makeYdStorage;
  // Сброс токена: первая initSync() должна использовать Firebase Storage (mock),
  // Яндекс.Диск подключается позже с mock-токеном (раздел 8).
  YANDEX_DISK_CONFIG.token = '';
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
  // 1. config + сейф + инициализация (Storage подключился)
  w('(s)=>{s.FIREBASE_CONFIG = { projectId: "mock" }; return 1;}');
  await w('(s)=>s.createVault("gosha","123456")');
  await w('(s)=>s.initSync()');
  assert(w('(s)=>s.syncReady') === true, 'syncReady=true с mock-firebase');
  assert(w('(s)=>s.syncStorage') !== null, 'Storage инициализирован (firebase.storage есть в моке)');


  // 2. Фото на устройстве А → выгружается в облако (оригинал + показ + миниатюра)
  await w('(s)=>{s.db.photos.unshift({id:"pA",title:"Фото А",labels:[],pinned:false,ts:1,order:0});return 1;}');
  await w('(s)=>s.photoStore.put("pA", new Blob(["FULL-A"]), new Blob(["THUMB-A"]), {type:"image/jpeg",thumbType:"image/webp",title:"Фото А"}, new Blob(["ORIG-A"]))');
  await w('(s)=>s.syncPhotos()');
  assert(!!mockStorage['photos/orig/pA'], 'оригинал ушёл в облако');
  assert(!!mockStorage['photos/full/pA'], 'показ-версия ушла в облако');
  assert(!!mockStorage['photos/thumb/pA'], 'миниатюра ушла в облако');
  assert(!String(mockStorage['photos/orig/pA'] || '').includes('ORIG-A') && !String(mockStorage['photos/full/pA'] || '').includes('FULL-A'),
    'в облаке лежит шифртекст, а не открытое фото (zero-knowledge)');

  // 3. «Второе устройство»: стор пуст, облако уже знает фото — скачиваем всё назад
  await w('(s)=>{s.photoStore.clear(); return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert(await w('(s)=>s.photoStore.getMeta("pA")') !== null, 'фото скачано из облака в store');
  const idsA = await w('(s)=>s.photoStore.listIds()');
  assert(idsA.some(i => i.id === 'pA' && i.hasOrig && i.hasFull && i.hasThumb), 'скачаны все три части фото');

  // 4. Фото, загруженное партнёром (в облаке есть pB, локально нет) — докачивается.
  // Моделируем полный путь: pB уходит в облако → локальный стор стёрт («другое
  // устройство») → db подтянул id через сейф → фото скачивается с типом файла.
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
  assert(!!mockStorage['photos/full/pOld'], 'легаси-фото: показ-версия ушла в облако');
  assert(!!mockStorage['photos/thumb/pOld'], 'легаси-фото: миниатюра ушла в облако');
  assert(!mockStorage['photos/orig/pOld'], 'легаси-фото: оригинала нет — ничего не выгружаем');

  // 6. Удаление фото → исчезает из облака и из локального стора
  w('(s)=>{s.db.photos = s.db.photos.filter(p => p.id !== "pA"); return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert(!mockStorage['photos/orig/pA'] && !mockStorage['photos/full/pA'] && !mockStorage['photos/thumb/pA'],
    'удалённое фото убрано из облака');
  assert(await w('(s)=>s.photoStore.getMeta("pA")') === null, 'удалённое фото убрано из локального стора');

  // 7. stopSync отключает и фото-синхронизацию
  w('(s)=>{s.stopSync(); return 1;}');
  assert(w('(s)=>s.syncStorage') === null, 'stopSync отключает Storage');

  // 8. Яндекс.Диск (фаза B3): фото-хранилище через бесплатный REST API вместо
  //    Firebase Storage (Storage — только на платном Blaze-плане). Проверяем
  //    адаптер makeYdStorage() с моком fetch: пути, Authorization, PUT/GET/DELETE.
  const ydCalls = [];
  const ydStore = {}; // 'app:/photos/thumb/pY' → блоб (шифртекст)
  const ydDirs = new Set(); // папки, созданные mkdir (PUT /resources)
  const ydResp = (status, data) => Promise.resolve({
    status, ok: status >= 200 && status < 300,
    json: () => Promise.resolve(data),
    blob: () => Promise.resolve(new Blob([JSON.stringify(data)], { type: 'application/json' }))
  });
  const ydFail = (status) => Promise.resolve({ status, ok: false, json: () => Promise.resolve({ error: 'x' }) });
  sandbox.ydFetchMock = (url, opts) => {
    const u = String(url);
    ydCalls.push([u, opts]);
    const decodePath = () => {
      const m = u.match(/path=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : '';
    };
    // mkdir: PUT /resources?path=… — как в реальном API: 409 если уже есть,
    // 409 если нет родительской папки (Яндекс родителей не создаёт).
    if (u.indexOf('/resources?') !== -1 && u.indexOf('permanently=true') === -1 &&
        u.indexOf('limit=') === -1 && opts && opts.method === 'PUT') {
      const p = decodePath();
      if (ydDirs.has(p)) return ydFail(409);
      const parent = p.slice(0, p.lastIndexOf('/'));
      const parentOk = parent === 'app:' || parent === '' || ydDirs.has(parent); // app:/ — всегда есть
      if (parent && !parentOk) return ydFail(409);
      ydDirs.add(p);
      return ydResp(201, {});
    }
    if (u.indexOf('/resources/upload?') !== -1) return ydResp(200, { href: 'https://upload.mock/' + encodeURIComponent(decodePath()), method: 'PUT' });
    if (u.indexOf('/resources/download?') !== -1) return ydResp(200, { href: 'https://download.mock/' + encodeURIComponent(decodePath()), method: 'GET' });
    if (u.indexOf('/resources?') !== -1 && u.indexOf('permanently=true') !== -1) {
      delete ydStore[decodePath()];
      return ydResp(204, {});
    }
    if (u.indexOf('/resources?') !== -1 && u.indexOf('limit=') !== -1) {
      const folder = decodePath().replace(/\/$/, '');
      if (!ydDirs.has(folder)) return ydFail(404); // папки ещё нет — пустой список
      const items = Object.keys(ydStore).filter(k => k.startsWith(folder + '/')).map(k => ({ name: k.slice(folder.length + 1), type: 'file', path: k }));
      return ydResp(200, { _embedded: { items } });
    }
    if (u.indexOf('https://upload.mock/') === 0) {
      ydStore[decodeURIComponent(u.slice('https://upload.mock/'.length))] = (opts && opts.body) || null;
      return ydResp(201, {});
    }
    if (u.indexOf('https://download.mock/') === 0) {
      const b = ydStore[decodeURIComponent(u.slice('https://download.mock/'.length))];
      return Promise.resolve({ status: 200, ok: true, blob: () => Promise.resolve(b) });
    }
    return ydResp(200, {}); // неожиданный URL — не бросаем (иначе ydRequest начнёт ретраить)
  };
  w('(s)=>{s.ydFetch = s.ydFetchMock; s.YANDEX_DISK_CONFIG = { token: "mock-token", basePath: "/photos" }; s.initSync(); return 1;}');
  assert(w('(s)=>s.syncStorage') !== null && w('(s)=>s.syncStorage.ref') !== undefined, 'YD: с токеном фото-хранилище = адаптер Яндекс.Диска');
  assert(JSON.stringify(await w('(s)=>s.listCloudPhotos()')) === '{}', 'YD: пустая папка = пустой список');

  // Выгрузка: фото в сторе + id в db → все три части уходят через PUT на href
  await w('(s)=>s.photoStore.put("pY", new Blob(["FULL-Y"]), new Blob(["THUMB-Y"]), {type:"image/jpeg",thumbType:"image/webp",title:"Фото Y"}, new Blob(["ORIG-Y"]))');
  w('(s)=>{s.db.photos.unshift({id:"pY",title:"Фото Y",labels:[],pinned:false,ts:4,order:3});return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert(!!ydStore['app:/photos/orig/pY'] && !!ydStore['app:/photos/full/pY'] && !!ydStore['app:/photos/thumb/pY'], 'YD: оригинал/показ/миниатюра ушли через PUT');
  assert(ydDirs.has('app:/photos') && ['orig', 'full', 'thumb'].every(p => ydDirs.has('app:/photos/' + p)),
    'YD: перед загрузкой создаются папки app:/photos/{orig,full,thumb} (mkdir)');
  assert(ydCalls.some(c => c[0].indexOf('/resources?') !== -1 && c[0].indexOf('limit=') !== -1 &&
    c[0].indexOf('app%3A%2Fphotos%2Forig') !== -1), 'YD: список читается из папки приложения app:/photos/orig');
  assert(ydCalls.some(c => c[0].indexOf('/resources/upload?') !== -1 && c[1] && c[1].headers && /^OAuth mock-token$/.test(c[1].headers.Authorization)), 'YD: API-запросы идут с Authorization: OAuth <token>');
  assert(!String(ydStore['app:/photos/orig/pY'] || '').includes('ORIG-Y'), 'YD: в облаке лежит шифртекст (zero-knowledge)');

  // Скачивание: стор очищен («другое устройство») → всё докачивается через YD
  await w('(s)=>{s.photoStore.clear(); return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert(await w('(s)=>s.photoStore.getMeta("pY")') !== null, 'YD: фото скачано из облака');
  const yids = await w('(s)=>s.photoStore.listIds()');
  assert(yids.some(i => i.id === 'pY' && i.hasOrig && i.hasFull && i.hasThumb), 'YD: скачаны все три части');

  // Удаление: фото убрано из db → исчезает и из YD (DELETE /resources)
  w('(s)=>{s.db.photos = s.db.photos.filter(p => p.id !== "pY"); return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert(!ydStore['app:/photos/orig/pY'] && !ydStore['app:/photos/full/pY'] && !ydStore['app:/photos/thumb/pY'], 'YD: удалённое фото убрано из облака');

  // 9. Критично (фаза B5): в облаке лежат фото, зашифрованные ДРУГИМ ключом
  // (свежий браузер создал свой сейф, а в облаке — фото старого). Локальный
  // «want» пуст. syncPhotos НЕ должен удалить эти фото как «облачный мусор».
  const foreignBlob = new Blob([JSON.stringify({
    e: { d: 'c2FsdA==', i: 'aW52', s: 'cw==' }, // «шифртекст» чужого ключа — не расшифруется
    m: { t: 'image/jpeg', ft: 'image/jpeg', st: 'image/webp', s: 10 }
  })], { type: 'application/json' });
  ydStore['app:/photos/full/pZ'] = foreignBlob;
  ydStore['app:/photos/thumb/pZ'] = foreignBlob;
  ydDirs.add('app:/photos/full'); ydDirs.add('app:/photos/thumb');
  await w('(s)=>{s.db.photos = []; return 1;}'); // локально пусто (новое устройство)
  await w('(s)=>s.syncPhotos()');
  assert(!!ydStore['app:/photos/full/pZ'] && !!ydStore['app:/photos/thumb/pZ'],
    'фото чужого ключа не удаляются из облака (это не мусор)');
  assert(!!ydStore['app:/photos/full/pB'] && !!ydStore['app:/photos/full/pOld'],
    'смесь «наших» и «чужих»: чужие не удаляются, наши не затираются (want пуст — синхронизировать нечего)');
  assert(await w('(s)=>s.photoStore.getMeta("pZ")') === null,
    'фото чужого ключа не скачиваются в локальный стор');
  assert(w('(s)=>s.photoSyncing') === false, 'syncPhotos завершился штатно (флаг сброшен)');

  // 10. Чисто чужое облако (свежий браузер, сейф создан заново): в облаке ТОЛЬКО
  // фото старого ключа, локальный «want» пуст — это главный сценарий B5.
  delete ydStore['app:/photos/full/pB']; delete ydStore['app:/photos/thumb/pB'];
  delete ydStore['app:/photos/orig/pB'];
  delete ydStore['app:/photos/full/pOld']; delete ydStore['app:/photos/thumb/pOld'];
  await w('(s)=>s.syncPhotos()');
  assert(!!ydStore['app:/photos/full/pZ'] && !!ydStore['app:/photos/thumb/pZ'],
    'свежий браузер: чужое облако не стирается как «мусор»');
  assert(await w('(s)=>s.photoStore.getMeta("pZ")') === null,
    'свежий браузер: чужое облако не скачивается');
  assert(w('(s)=>s.photoSyncing') === false, 'свежий браузер: syncPhotos завершился штатно');

  // 11. ГЛАВНЫЙ СЦЕНАРИЙ ФИКСА (B5): локальные свои фото + чужое фото в облаке.
  // Раньше cloudPhotosDecryptable() прерывала всю сверку — своё фото так и не
  // выгружалось (deadlock: на телефоне свои фото не уходят в облако, а на ПК
  // вместо них приходил «битый файл»). Теперь probeCloudKeys() помечает чужое,
  // но свои фото синхронизируются: выгружаются в облако, чужое не трогается.
  await w('(s)=>s.photoStore.put("pN", new Blob(["FULL-N"]), new Blob(["THUMB-N"]), {type:"image/jpeg",thumbType:"image/webp",title:"N"}, new Blob(["ORIG-N"]))');
  w('(s)=>{s.db.photos = [{id:"pN",title:"N",labels:[],pinned:false,ts:5,order:1}]; return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert(!!ydStore['app:/photos/orig/pN'] && !!ydStore['app:/photos/full/pN'] && !!ydStore['app:/photos/thumb/pN'],
    'фикс: своё фото выгружается, даже когда в облаке есть чужое (раньше — deadlock)');
  assert(!!ydStore['app:/photos/full/pZ'] && !!ydStore['app:/photos/thumb/pZ'],
    'фикс: чужое фото остаётся нетронутым при выгрузке своих');
  assert(await w('(s)=>s.photoStore.getMeta("pN")') !== null,
    'фикс: своё фото осталось в локальном сторе');
  assert(w('(s)=>s.photoSyncing') === false, 'фикс: syncPhotos завершился штатно');

  console.log('OK: ' + results.length + ' photo-sync checks passed');
})().catch(e => { process.stdout.write('FAIL: photo-sync: ' + (e && (e.stack || e.message) || e) + '\n'); process.exit(1); });

