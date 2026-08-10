/* ===== Облачная синхронизация (фаза B, Firebase Realtime Database) =====
   Принцип: localStorage — «правда» локально, Firebase — канал синхронизации.
   Синхронизируем САМ зашифрованный сейф `universe_vault` (zero-knowledge):
   на сервере лежит только шифртекст (AES-GCM мастер-ключом + обёртки обоих
   паролей внутри), поэтому и Гоша, и Даша открывают облачные данные своим
   паролем, а Firebase ничего прочитать не может.

   Путь в RTDB: vaults/shared = { syncTs, vault }. Правила: read/write auth != null
   (см. README). Конфликты: «последняя правка выигрывает» по syncTs.

   Фаза B1: вставь config из Firebase Console в FIREBASE_CONFIG ниже.
   Фаза B3 (фото): оригиналы+миниатюры синхронизируются через Яндекс.Диск —
   вставь токен в YANDEX_DISK_CONFIG ниже (Firebase Storage — только на платном
   Blaze-плане, из России его не оплатить).
   Без config (или без интернета) приложение работает как раньше — локально.
   Работает на http(s); на file:// SDK может не загрузиться — тоже локально. */

let FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDuAkskIpj3bsFOX6aPecFWZGJOlOzGzUk",
  authDomain:        "nasha-vselennaya.firebaseapp.com",
  databaseURL:       "https://nasha-vselennaya-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "nasha-vselennaya",
  storageBucket:     "nasha-vselennaya.firebasestorage.app",
  messagingSenderId: "222445763153",
  appId:             "1:222445763153:web:df254e6b681c2e40289670",
  measurementId:     "G-JZY24EXCX3"
}; // ← config из Firebase Console (фаза B1). let — чтобы тесты могли подставить мок.

/* Фото-облако (фаза B3): Яндекс.Диск вместо Firebase Storage (Storage — только на
   платном Blaze-плане, из России оплатить нельзя). Как получить токен — README,
   шаг 6: oauth.yandex.ru → «Создать приложение» (Callback https://oauth.yandex.ru/verification_code)
   → доступ «Яндекс.Диск REST API. Доступ к папке приложения» (cloud_api:disk.app_folder)
   → «Выпустить токен». Токен видит только папку приложения /Приложения/<имя>/,
   пути ниже идут относительно неё. */
let YANDEX_DISK_CONFIG = {
  token: 'y0__wgBEIepmJ0CGJqORyD9n7LOGDDY3uKSCI0YP0CcYDMHfx8QFUB_zk_nyS9i', // OAuth-токен Яндекса (scope: cloud_api:disk.app_folder)
  basePath: '/photos' // внутри папки приложения: app:/photos/orig/{id}, app:/photos/full/{id}, app:/photos/thumb/{id}
};

const SYNC_KEY = 'universe_syncTs';  // последний известный syncTs (метаданные, не секрет)
const SYNC_PATH = 'vaults/shared';   // общий зашифрованный сейф пары

let syncFirebase = null;   // firebaseApp (compat)
let syncDb = null;         // firebase.database()
let syncReady = false;     // SDK есть, config есть, анонимный вход сделан
let syncTs = 0;            // последний применённый syncTs
let syncPushTimer = null;  // debounce push после save()
let syncApplying = false;  // защита от рекурсии pull→save→push

/* ===== Инициализация: вызывается из unlockApp() после входа ===== */
async function initSync() {
  syncTs = parseInt(store.get(SYNC_KEY) || '0', 10) || 0;
  if (!FIREBASE_CONFIG) { renderSyncStatus('off'); return; }
  if (typeof firebase === 'undefined' || typeof firebase.initializeApp !== 'function' ||
      typeof firebase.database !== 'function' || typeof firebase.auth !== 'function') {
    renderSyncStatus('off');
    return;
  }
  try {
    syncFirebase = firebase.initializeApp(FIREBASE_CONFIG, 'nasha_sync');
    syncDb = firebase.database(syncFirebase);
    // Хранилище фото (фаза B3): оригиналы + миниатюры в Яндекс.Диске (бесплатно,
    // из РФ работает). Firebase Storage — только на платном Blaze, оставлен как
    // запасной вариант. Без токена фото остаются локальными — как раньше.
    if (YANDEX_DISK_CONFIG && YANDEX_DISK_CONFIG.token) syncStorage = makeYdStorage();
    else if (typeof firebase.storage === 'function') syncStorage = firebase.storage(syncFirebase);
    // Anonymous Auth: оба устройства — «гости», доступ к общему vaults/shared.
    // UID нигде не храним: правила разрешают любому анониму, данные зашифрованы.
    const cred = await firebase.auth(syncFirebase).signInAnonymously();
    if (!cred || !cred.user) throw new Error('no anonymous user');
    syncReady = true;
    renderSyncStatus('idle');
    listenRemote();      // живые обновления с другого устройства
    pullVault(true);     // при входе пробуем забрать свежие данные
    scheduleSyncPush();  // и отдать свои, если они свежее
    schedulePhotoSync(); // фото: выгрузить свои / скачать недостающие
  } catch (e) {
    console.warn('[sync] init failed', e);
    syncReady = false;
    renderSyncStatus('error');
  }
}

/* ===== Push: после каждого save() (debounce 1.5с) ===== */
function scheduleSyncPush() {
  if (!syncReady || syncApplying) return;
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(pushVault, 1500);
}

// Защита от затирания чужого сейфа. Облачный сейф не расшифровался текущим
// ключом — значит, в облаке сейф другого устройства/пароля (например, созданный
// «вторым» сейфом в свежем браузере). Автоматически его не трогаем: показываем
// конфликт, дальше решает человек («Синхронизировать сейчас» = forcePushVault).
let syncPushBlocked = false;

// Быстрый опрос облака ДО первого входа (экран замка/создания): есть ли уже
// зашифрованный сейф пары? Ничего не пишет, слушатели не вешает. Возвращает
// { vault, ts } или null, если сейфа нет / нет сети / config пустой.
let probeApp = null;
async function fetchCloudVault() {
  if (!FIREBASE_CONFIG || typeof firebase === 'undefined' || typeof firebase.initializeApp !== 'function' ||
      typeof firebase.auth !== 'function' || typeof firebase.database !== 'function') return null;
  try {
    probeApp = probeApp || firebase.initializeApp(FIREBASE_CONFIG, 'nasha_probe');
    const cred = await firebase.auth(probeApp).signInAnonymously();
    if (!cred || !cred.user) return null;
    const snap = await firebase.database(probeApp).ref(SYNC_PATH).once('value');
    const data = snap && snap.val ? snap.val() : null;
    if (!data || !data.vault || !data.vault.db || typeof data.vault.db.d !== 'string') return null;
    return { vault: data.vault, ts: data.syncTs || 0 };
  } catch (e) {
    console.warn('[sync] нет доступа к облаку при старте', e);
    return null;
  }
}

// Запись сейфа в облако (общий путь для push и принудительного восстановления).
async function writeVault() {
  const vault = loadVault();
  if (!vault || !vault.db || typeof vault.db.d !== 'string') return;
  renderSyncStatus('syncing');
  const ts = Date.now();
  await syncDb.ref(SYNC_PATH).set({ syncTs: ts, vault });
  syncTs = ts;
  store.set(SYNC_KEY, String(ts));
  renderSyncStatus('ok', ts);
}

async function pushVault() {
  if (!syncReady || syncApplying) return;
  // Смотрим, что сейчас лежит в облаке. Если сейф другой и не расшифровывается
  // текущим ключом — это чужой сейф: НЕ затираем его автоматически.
  try {
    const snap = await syncDb.ref(SYNC_PATH).once('value');
    const remote = snap && snap.val ? snap.val() : null;
    if (remote && remote.vault && remote.vault.db && typeof remote.vault.db.d === 'string' && masterKey) {
      let ok = false;
      try { await aesDec(masterKey, remote.vault.db); ok = true; } catch (e) {}
      if (!ok) {
        syncPushBlocked = true;
        renderSyncStatus('conflict');
        notify('В облаке сейф с другим паролем — я его не трогаю. Чтобы открыть данные из облака: нажми чип «Гоша/Даша» (замок) и введи пароль облачного сейфа 💜', true);
        return;
      }
    }
  } catch (e) {
    console.warn('[sync] не удалось проверить облачный сейф', e);
    renderSyncStatus('error');
    return;
  }
  syncPushBlocked = false;
  try { await writeVault(); }
  catch (e) {
    console.warn('[sync] push failed', e);
    renderSyncStatus('error');
  }
}

// Явное восстановление: затирает облачный сейф сейфом этого устройства.
// Это осознанное действие человека (кнопка «Синхронизировать сейчас» в конфликте).
async function forcePushVault() {
  if (!syncReady) return;
  syncPushBlocked = false;
  try { await writeVault(); }
  catch (e) {
    console.warn('[sync] force push failed', e);
    renderSyncStatus('error');
  }
}

/* ===== Pull: читаем облако, применяем, если оно свежее ===== */
async function pullVault(silent) {
  if (!syncReady) return;
  try {
    const snap = await syncDb.ref(SYNC_PATH).once('value');
    const remote = snap && snap.val ? snap.val() : null;
    if (!remote || !remote.vault || !remote.vault.db || typeof remote.vault.db.d !== 'string') return;
    const rts = remote.syncTs || 0;
    if (rts <= syncTs) return; // облако не свежее — не трогаем локальные данные
    const applied = await applyRemoteVault(remote.vault);
    if (!applied) { renderSyncStatus('error'); return; }
    syncTs = rts;
    store.set(SYNC_KEY, String(rts));
    renderSyncStatus('ok', rts);
    if (!silent) notify('Данные обновлены с другого устройства 💜');
  } catch (e) {
    console.warn('[sync] pull failed', e);
    renderSyncStatus('error');
  }
}

/* ===== Живой слушатель: изменения с другого устройства приходят сами ===== */
let syncLiveOn = false;
function listenRemote() {
  if (syncLiveOn || !syncReady || !syncDb) return;
  syncLiveOn = true;
  syncDb.ref(SYNC_PATH).on('value', snap => {
    if (syncApplying) return;
    const remote = snap && snap.val ? snap.val() : null;
    if (!remote || !remote.vault || !remote.vault.db || typeof remote.vault.db.d !== 'string') return;
    const rts = remote.syncTs || 0;
    if (rts <= syncTs) return; // свой же push
    renderSyncStatus('syncing');
    applyRemoteVault(remote.vault).then(ok => {
      if (!ok) { renderSyncStatus('error'); return; }
      syncTs = rts;
      store.set(SYNC_KEY, String(rts));
      renderSyncStatus('ok', rts);
      notify('Данные обновлены с другого устройства 💜');
    }).catch(e => { console.warn('[sync] live apply failed', e); renderSyncStatus('error'); });
  });
}

/* ===== Применить облачный сейф: расшифровать → db → перерисовать =====
   AES-GCM — аутентифицированное шифрование: чужой/повреждённый блоб не
   расшифруется (упадёт), локальные данные не пострадают. */
async function applyRemoteVault(remoteVault) {
  if (!masterKey) return false;
  let raw;
  try {
    raw = await aesDec(masterKey, remoteVault.db);
  } catch (e) {
    console.warn('[sync] облачный сейф не расшифровать (не тот ключ/повреждён?)', e);
    return false;
  }
  let nd;
  try {
    nd = migrateDB({ ...defaultDB(), ...JSON.parse(dec.decode(raw)) });
  } catch (e) {
    console.warn('[sync] облачные данные повреждены', e);
    return false;
  }
  syncApplying = true;
  try {
    db = nd;
    store.set(VAULT_KEY, JSON.stringify(remoteVault));
    if (photoStore) {
      await photoStore.migratePhotos(db);
      await photoStore.refreshSizes();
      warmThumbCache();
    }
    await save(); // закрепить миграции локально (push не запустится: syncApplying)
    renderUserChip(); renderHome(); renderCalendar(); renderNotes();
    renderLists(); renderWishlist(); renderPhotos(); renderMemory(); renderSettings();
    schedulePhotoSync(); // пришли новые/удалённые фото — сверимся с облаком
    return true;
  } catch (e) {
    console.warn('[sync] применить облачные данные не удалось', e);
    return false;
  } finally {
    syncApplying = false;
  }
}

/* ===== Остановка: при lock() ===== */
function stopSync() {
  clearTimeout(syncPushTimer);
  clearTimeout(photoSyncTimer);
  if (syncLiveOn && syncDb) {
    try { syncDb.ref(SYNC_PATH).off('value'); } catch (e) {}
    syncLiveOn = false;
  }
  if (syncFirebase && typeof syncFirebase.auth === 'function') {
    try { syncFirebase.auth().signOut(); } catch (e) {}
  }
  syncReady = false;
  syncFirebase = null;
  syncDb = null;
  syncStorage = null;
  syncPushBlocked = false;
  photoSyncing = false;
  renderSyncStatus('off');
}


/* ===== Фото в облаке (фаза B3): оригиналы + миниатюры в Яндекс.Диске =====
   Пути: photos/orig/{id} (исходный файл), photos/full/{id} (показ-версия),
   photos/thumb/{id} (миниатюра). В облако уезжают САМИ шифртексты из photoStore
   (AES-GCM мастер-ключом) — сервер видит только шифртекст, прочитать фото без
   пароля нельзя (zero-knowledge), а на другом устройстве они расшифровываются тем
   же мастер-ключом. Реализация — адаптер makeYdStorage() ниже: тот же интерфейс
   { put, getBlob, delete, listAll }, что у Firebase Storage.

   Модель — полная сверка (reconciliation): после каждой операции с фото
   (добавление, удаление, применение облачного сейфа) с задержкой сравниваем три
   списка: локальный photoStore, облако Storage и db.photos. Недостающее выгружаем
   и скачиваем, лишнее (удалённые фото) чистим и в облаке, и в локальном сторе.
   Так работают и бэкфилл старых фото, и удаление с другого устройства. */
const PHOTO_PARTS = ['orig', 'full', 'thumb'];
let syncStorage = null;      // Яндекс.Диск (или firebase.storage() на платном Blaze)
let photoSyncTimer = null;   // debounce после операций с фото
let photoSyncing = false;    // защита от параллельных сверок

/* ===== Адаптер Яндекс.Диска к интерфейсу фото-логики =====
   REST API: cloud-api.yandex.net/v1/disk. Загрузка — GET /resources/upload
   (в ответе href) → PUT на href; скачивание — GET /resources/download (href) →
   GET на href; удаление — DELETE /resources; список папки — GET /resources
   (пагинация limit=1000 по offset). CORS поддержан: cloud-api.yandex.net
   отвечает Access-Control-Allow-Origin и разрешает Authorization. */
const YD_API = 'https://cloud-api.yandex.net/v1/disk';
const YD_LIMIT = 1000;
let ydFetch = (typeof fetch === 'function') ? fetch : null; // let — чтобы тесты могли подменить

async function ydRequest(url, opts, tries) {
  const attempt = tries || 0;
  try {
    if (!ydFetch) throw new Error('fetch недоступен');
    const res = await ydFetch(url, opts);
    if (res.status === 429 || res.status >= 500) {
      const e = new Error('YD ' + res.status);
      e.retryable = true;
      throw e;
    }
    if (!res.ok) throw new Error('YD ' + res.status);
    return res;
  } catch (e) {
    // Ретраим только временные сбои (429/5xx/сеть). Ошибки 4xx (403, 404, 409)
    // детерминированы — повторять бессмысленно, а в тестах setTimeout-заглушка
    // вообще не вызывает колбэк, так что ретрай «завис» бы навсегда.
    if (e && e.retryable && attempt < 2) {
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
      return ydRequest(url, opts, attempt + 1);
    }
    throw e;
  }
}
function ydHeaders() { return { Authorization: 'OAuth ' + YANDEX_DISK_CONFIG.token }; }
// Токен имеет scope cloud_api:disk.app_folder — видит ТОЛЬКО папку приложения,
// поэтому все пути обязаны начинаться с app:/ (иначе API отвечает 403 Forbidden).
function ydPath(part, id) { return 'app:' + YANDEX_DISK_CONFIG.basePath + '/' + part + '/' + id; }
function ydUploadUrl(part, id) { return YD_API + '/resources/upload?path=' + encodeURIComponent(ydPath(part, id)) + '&overwrite=true'; }
function ydDownloadUrl(part, id) { return YD_API + '/resources/download?path=' + encodeURIComponent(ydPath(part, id)); }
function ydDeleteUrl(part, id) { return YD_API + '/resources?path=' + encodeURIComponent(ydPath(part, id)) + '&permanently=true'; }
function ydListUrl(folder, offset) { return YD_API + '/resources?path=' + encodeURIComponent(folder) + '&limit=' + YD_LIMIT + '&offset=' + offset; }

// Яндекс не создаёт промежуточные папки сам (409 DiskPathDoesntExistsError), поэтому
// перед загрузкой гарантируем цепочку app:/photos → app:/photos/{part}.
async function ydEnsureDir(path) {
  try {
    await ydRequest(YD_API + '/resources?path=' + encodeURIComponent(path), { method: 'PUT', headers: ydHeaders() });
  } catch (e) { /* 409 — папка уже есть (или появится после создания родителя): не ошибка */ }
}
async function ydEnsureDirs(part) {
  await ydEnsureDir('app:' + YANDEX_DISK_CONFIG.basePath);
  await ydEnsureDir('app:' + YANDEX_DISK_CONFIG.basePath + '/' + part);
}

async function ydUpload(part, id, blob) {
  await ydEnsureDirs(part);
  const r = await ydRequest(ydUploadUrl(part, id), { method: 'GET', headers: ydHeaders() });
  const j = await r.json();
  const href = j && j.href;
  if (!href) throw new Error('YD: нет ссылки для загрузки');
  const up = await ydFetch(href, { method: j.method || 'PUT', body: blob, headers: { 'Content-Type': 'application/json' } });
  if (up.status !== 201 && up.status !== 202 && !up.ok) throw new Error('YD upload ' + up.status);
}

async function ydDownload(part, id) {
  const r = await ydRequest(ydDownloadUrl(part, id), { method: 'GET', headers: ydHeaders() });
  const j = await r.json();
  const href = j && j.href;
  if (!href) throw new Error('YD: нет ссылки для скачивания');
  const down = await ydFetch(href, { method: j.method || 'GET' });
  if (!down.ok) throw new Error('YD download ' + down.status);
  return down.blob();
}

async function ydDelete(part, id) {
  await ydRequest(ydDeleteUrl(part, id), { method: 'DELETE', headers: ydHeaders() });
}

async function ydList(folder) {
  const items = [];
  let offset = 0;
  for (;;) {
    let r;
    try { r = await ydRequest(ydListUrl(folder, offset), { method: 'GET', headers: ydHeaders() }); }
    catch (e) {
      // Папки ещё нет (первый запуск до выгрузки) — это пустой список, а не ошибка
      if (/404|Not Found/i.test(String((e && e.message) || ''))) return { items, prefixes: [] };
      throw e;
    }
    const j = await r.json();
    const chunk = (j._embedded && j._embedded.items) || [];
    for (const it of chunk) if (it && it.type === 'file') items.push({ name: it.name });
    if (chunk.length < YD_LIMIT || offset >= 20000) break;
    offset += chunk.length;
  }
  return { items, prefixes: [] };
}

// makeYdStorage() — объект в стиле firebase.storage(): ref('photos/thumb/abc') →
// { put, getBlob, delete }, ref('photos/thumb') → { listAll }. Фото-логика
// (photoRef, listCloudPhotos, syncPhotos) работает с ним без изменений.
function makeYdStorage() {
  return {
    ref(path) {
      const seg = String(path || '').split('/').filter(Boolean);
      if (seg.length >= 3) {
        const part = seg[1], id = seg.slice(2).join('/');
        return {
          name: id,
          fullPath: seg.join('/'),
          put(blob) { return ydUpload(part, id, blob); },
          getBlob() { return ydDownload(part, id); },
          delete() { return ydDelete(part, id); }
        };
      }
      const folder = 'app:/' + seg.join('/'); // 'app:/photos/thumb' — токен видит только папку приложения
      return { listAll() { return ydList(folder); } };
    }
  };
}

function photoRef(part, id) { return syncStorage.ref('photos/' + part + '/' + id); }

// Запуск сверки фото (debounce 2.5 с): после добавления/удаления фото и при
// применении облачного сейфа. Без Storage или до разблокировки — просто ждём.
function schedulePhotoSync() {
  if (!syncStorage || !photoStore || !masterKey || photoSyncing) return;
  clearTimeout(photoSyncTimer);
  photoSyncTimer = setTimeout(() => { syncPhotos().catch(e => console.warn('[sync] сверка фото', e)); }, 2500);
}

// Что сейчас лежит в облаке: { id: { orig: true, full: true, thumb: true } }
async function listCloudPhotos() {
  const out = {};
  for (const part of PHOTO_PARTS) {
    try {
      const res = await syncStorage.ref('photos/' + part).listAll();
      for (const it of (res.items || [])) (out[it.name] = out[it.name] || {})[part] = true;
    } catch (e) { console.warn('[sync] не удалось прочитать облако photos/' + part, e); }
  }
  return out;
}

// Выгрузка недостающих частей фото в облако (шифртекст как есть).
async function uploadCloudPhoto(id, cloud, local) {
  const meta = (await photoStore.getMeta(id).catch(() => null)) || {};
  const jobs = [];
  for (const part of PHOTO_PARTS) {
    const has = cloud[id] && cloud[id][part];
    if (has || !local['has' + part[0].toUpperCase() + part.slice(1)]) continue;
    jobs.push((async () => {
      try {
        const getter = part === 'orig' ? 'getEncryptedOrig' : (part === 'full' ? 'getEncryptedFull' : 'getEncryptedThumb');
        const enc = await photoStore[getter](id);
        if (!enc) return;
        // Обёртка: сам шифртекст + несекретные MIME/размер (размер и так виден
        // в метаданных Storage), чтобы на другом устройстве восстановить тип файла.
        const payload = { e: enc, m: { t: meta.origType || meta.type || '', ft: meta.type || '', st: meta.thumbType || '', s: meta.size || 0 } };
        await photoRef(part, id).put(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
      } catch (e) { console.warn('[sync] не удалось выгрузить фото ' + id + '/' + part, e); }
    })());
  }
  await Promise.all(jobs);
}


// Скачивание недостающих частей фото из облака (без повторного шифрования).
async function downloadCloudPhoto(id, cloud, local) {
  const meta = (local && (await photoStore.getMeta(id).catch(() => null))) || {};
  const got = {};
  let gotMeta = null;
  for (const part of PHOTO_PARTS) {
    const hasCloud = cloud[id] && cloud[id][part];
    const hasLocal = local && local['has' + part[0].toUpperCase() + part.slice(1)];
    if (!hasCloud || hasLocal) continue;
    try {
      const data = await photoRef(part, id).getBlob();
      const txt = (typeof data === 'string') ? data : await data.text();
      const parsed = JSON.parse(txt);
      // Новый формат { e: шифртекст, m: {t,ft,st,s} } и старый { i, d } — оба понимаем
      const enc = (parsed && parsed.e && typeof parsed.e.d === 'string') ? parsed.e
                : (parsed && typeof parsed.d === 'string') ? parsed : null;
      if (!enc) continue;
      got[part] = enc;
      if (parsed && parsed.m && !gotMeta) gotMeta = parsed.m;
    } catch (e) { console.warn('[sync] не удалось скачать фото ' + id + '/' + part, e); }
  }
  if (!got.orig && !got.full && !got.thumb) return;
  // Сохраняем всё разом, чтобы не потерять уже имеющиеся локальные части
  const exOrig = (local && local.hasOrig) ? await photoStore.getEncryptedOrig(id) : null;
  const exFull = (local && local.hasFull) ? await photoStore.getEncryptedFull(id) : null;
  const exThumb = (local && local.hasThumb) ? await photoStore.getEncryptedThumb(id) : null;
  const meta2 = { ...meta };
  if (gotMeta) {
    if (gotMeta.t) meta2.origType = gotMeta.t;
    if (gotMeta.ft) meta2.type = gotMeta.ft;
    if (gotMeta.st) meta2.thumbType = gotMeta.st;
    if (gotMeta.s) meta2.size = gotMeta.s;
  }
  await photoStore.putEncrypted(id, got.full || exFull, got.thumb || exThumb, meta2, got.orig || exOrig);
  // Приехала миниатюра — прогреваем кэш, фото сразу показывается в галерее
  try {
    const t = await photoStore.getThumb(id);
    if (t) setThumbUrl(id, await blobToDataUrl(t));
  } catch (e) {}
}

// Проверка, что облачные фото зашифрованы ТЕКУЩИМ ключом. Скачиваем по одной
// самой «лёгкой» части каждого фото (миниатюра < показ-версия < оригинал) и
// пробуем расшифровать. Если хоть одно фото не расшифровывается — в облаке есть
// фото ДРУГОГО сейфа (например, свежий браузер создал свой ключ): удалять их
// нельзя, это не «мусор», а чужие данные. Возвращает true, если облако пусто
// или целиком «наше». Проверяем все фото, а не одно: смесь «наших» и «чужих»
// (свой сейф + фото старого) тоже обязана прервать сверку.
async function cloudPhotosDecryptable(cloud) {
  for (const id of Object.keys(cloud)) {
    // Берём самую маленькую присутствующую часть — хватает для проверки ключа
    const part = ['thumb', 'full', 'orig'].find(p => cloud[id] && cloud[id][p]);
    if (!part) continue;
    try {
      const data = await photoRef(part, id).getBlob();
      const txt = (typeof data === 'string') ? data : await data.text();
      const parsed = JSON.parse(txt);
      const enc = (parsed && parsed.e && typeof parsed.e.d === 'string') ? parsed.e
                : (parsed && typeof parsed.d === 'string') ? parsed : null;
      if (!enc) return false;
      await aesDec(masterKey, enc);
    } catch (e) {
      console.warn('[sync] облачное фото не расшифровывается текущим ключом', id, part);
      return false;
    }
  }
  return true; // облако пусто или целиком расшифровывается — можно сверять
}

// Полная сверка фото: локальный store ↔ облако ↔ db.photos.
async function syncPhotos() {
  if (!syncStorage || !photoStore || !masterKey || photoSyncing) return;
  photoSyncing = true;
  try {
    const localList = await photoStore.listIds();
    const localMap = new Map(localList.map(l => [l.id, l]));
    const cloud = await listCloudPhotos();
    // Защита от потери данных: если облачные фото зашифрованы ДРУГИМ ключом
    // (свежий браузер создал второй сейф, а в облаке лежат фото первого), шаги
    // 2–4 делать нельзя — «облачный мусор» оказался бы чужими фото. Прерываем.
    if (Object.keys(cloud).length && !(await cloudPhotosDecryptable(cloud))) {
      console.warn('[sync] облачные фото зашифрованы другим ключом — сверка фото пропущена, ничего не удалено');
      notify('Облачные фото зашифрованы другим паролем — я их не трогаю 💜', true);
      return;
    }
    const want = new Set((db.photos || []).map(p => p && p.id).filter(Boolean));
    // 1. Локальный мусор: блоб без фото в db (фото удалено) — чистим store
    for (const id of localMap.keys()) {
      if (want.has(id)) continue;
      try { await photoStore.delete(id); thumbCache.delete(id); } catch (e) {}
    }
    // 2. Облачный мусор: файлы без фото в db — удаляем (удаление разъезжается)
    for (const id of Object.keys(cloud)) {
      if (want.has(id)) continue;
      for (const part of PHOTO_PARTS) {
        if (cloud[id][part]) { try { await photoRef(part, id).delete(); } catch (e) {} }
      }
    }
    // 3. Скачиваем недостающее с облака
    for (const id of want) {
      const l = localMap.get(id);
      const need = PHOTO_PARTS.some(part => cloud[id] && cloud[id][part] && (!l || !l['has' + part[0].toUpperCase() + part.slice(1)]));
      if (need) await downloadCloudPhoto(id, cloud, l);
    }
    // 4. Выгружаем недостающее в облако (новые фото + бэкфилл старых)
    for (const id of want) {
      const l = localMap.get(id);
      if (!l || !l.hasFull) continue; // полного блоба нет — выгружать нечего
      await uploadCloudPhoto(id, cloud, l);
    }
  } catch (e) {
    console.warn('[sync] сверка фото не удалась', e);
  } finally {
    photoSyncing = false;
    // Докачали блобы из облака — прогреваем кэш миниатюр и перерисовываем вьюхи,
    // иначе миниатюры, приехавшие после первого рендера, не появятся в галерее.
    if (typeof warmThumbCache === 'function') warmThumbCache();
  }
}


/* ===== UI в настройках: статус + кнопка ===== */
const SYNC_STATUS_TEXT = {
  off:     'Синхронизация не настроена — данные живут только на этом устройстве. Чтобы открывать их с телефона, вставь Firebase config (README, фаза B1).',
  idle:    'Облако подключено — ждём изменений…',
  syncing: 'Синхронизируем…',
  ok:      'Синхронизировано ✅',
  conflict: '⚠️ В облаке сейф с другим паролем — он не затёрт. Если нужны облачные данные: нажми чип «Гоша/Даша» (замок) и введи пароль облачного сейфа — он усыновится, фото докачаются. «Синхронизировать сейчас» перезапишет облако этим устройством.',
  error:   'Ошибка синхронизации — проверь интернет и попробуй ещё раз 💜'
};
let syncUiState = 'off';
let syncUiTs = 0;
function renderSyncStatus(state, ts) {
  syncUiState = state;
  syncUiTs = ts || 0;
  const el = $('#syncStatus');
  if (!el) return;
  const text = SYNC_STATUS_TEXT[state] || SYNC_STATUS_TEXT.off;
  el.textContent = text;
  el.style.color = state === 'ok' ? '#059669' : (state === 'error' ? '#dc2626' : (state === 'conflict' ? '#b45309' : 'var(--muted)'));
  const btn = $('#syncNowBtn');
  if (btn) btn.disabled = (state === 'syncing');
}
async function syncNow() {
  if (!FIREBASE_CONFIG) { renderSyncStatus('off'); return; }
  if (!syncReady) { initSync(); return; }
  if (syncPushBlocked) { await forcePushVault(); return; }
  await pullVault(false);
  await pushVault();
}
const syncNowBtnEl = $('#syncNowBtn');
if (syncNowBtnEl) syncNowBtnEl.addEventListener('click', syncNow);

/* ===== Старт приложения =====
   initAuth() из 90-effects-init.js вызывается здесь — последним в сборке:
   он читает FIREBASE_CONFIG (let из этого модуля), который ещё в «мёртвой зоне»
   во время выполнения 90-effects-init.js. Так же инициализируются экраны входа. */
initAuth();

