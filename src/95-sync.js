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

/* Фото-облако (фаза B3): Yandex Object Storage (S3-совместимое) вместо Firebase Storage.
   Storage — только на платном Blaze-плане, из России оплатить нельзя.
   Yandex Object Storage: нативный S3-протокол, CORS настроен, бесплатный tier.
   Ключи подставляются из GitHub Secrets при деплое (window.YANDEX_S3_KEY, window.YANDEX_S3_SECRET). */
let YANDEX_CLOUD_CONFIG = {
  bucket:  'nasha-vselennaya',       // имя бакета (без https://)
  key:     window.YANDEX_S3_KEY || '',    // static access key (SA) — из GitHub Secrets
  secret:  window.YANDEX_S3_SECRET || '', // secret key — из GitHub Secrets
  region:  'ru-central1'             // регион Yandex Cloud
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
// Таймаут для сетевых вызовов: не держим пользователя на «проверяем облако…»
// бесконечно, если Firebase отвечает медленно (мобильный интернет).
function withTimeout(promise, ms) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })
  ]).finally(() => { if (timer) clearTimeout(timer); });
}
let probeApp = null;
let probeUser = null; // анонимный пользователь probe-приложения — переиспользуем между проверками
async function fetchCloudVault() {
  if (!FIREBASE_CONFIG || typeof firebase === 'undefined' || typeof firebase.initializeApp !== 'function' ||
      typeof firebase.auth !== 'function' || typeof firebase.database !== 'function') return null;
  try {
    // Несколько попыток: на мобильном интернете анонимный вход или чтение могут
    // не успеть с первого раза. «Пустое облако» — не ошибка, повторяться не нужно.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        probeApp = probeApp || firebase.initializeApp(FIREBASE_CONFIG, 'nasha_probe');
        if (!probeUser) {
          const cred = await withTimeout(firebase.auth(probeApp).signInAnonymously(), 10000);
          if (!cred || !cred.user) return null;
          probeUser = cred.user;
        }
        const snap = await withTimeout(firebase.database(probeApp).ref(SYNC_PATH).once('value'), 10000);
        const data = snap && snap.val ? snap.val() : null;
        if (!data || !data.vault || !data.vault.db || typeof data.vault.db.d !== 'string') return null;
        return { vault: data.vault, ts: data.syncTs || 0 };
      } catch (e) {
        console.warn('[sync] нет доступа к облаку при старте (попытка ' + (attempt + 1) + ')', e);
        if (attempt < 2) await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
    return null;
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
let syncStorage = null;      // Yandex Object Storage (S3)
let photoSyncTimer = null;   // debounce после операций с фото
let photoSyncing = false;    // защита от параллельных сверок


/* ===== S3-адаптер для Yandex Object Storage =====
   AWS Signature v4 из браузера (Web Crypto API). CORS должен быть настроен на бакете.
   Пути: /photos/{part}/{id}. makeCloudStorage() возвращает объект, совместимый с
   firebase.storage(): ref(path).put/getBlob/delete, ref(folder).listAll(). */

async function s3Sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function s3Hmac(key, message) {
  const k = (typeof key === 'string') ? new TextEncoder().encode(key) : key;
  const msg = new TextEncoder().encode(message);
  const cryptoKey = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg);
  return new Uint8Array(sig);
}

function makeCloudStorage() {
  const cfg = YANDEX_CLOUD_CONFIG;
  if (!cfg.bucket || !cfg.key || !cfg.secret) throw new Error('YANDEX_CLOUD_CONFIG: bucket/key/secret не заданы');
  const host = cfg.bucket + '.storage.yandexcloud.net';
  const endpoint = 'https://' + host;

  async function signRequest(method, path, body) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const dateStamp = amzDate.slice(0, 8);
    const payload = 'UNSIGNED-PAYLOAD';
    const canonicalHeaders = 'host:' + host + '\nx-amz-content-sha256:' + payload + '\nx-amz-date:' + amzDate + '\n';
    const signedHeaders = ['host', 'x-amz-content-sha256', 'x-amz-date'];
    const canonicalReq = method + '\n' + path + '\n\n' + canonicalHeaders + signedHeaders.join(';') + '\n' + await s3Sha256Hex(body !== undefined && body !== null ? body : '');
    const scope = dateStamp + '/' + cfg.region + '/s3/aws4_request';
    const stringToSign = 'AWS4-HMAC-SHA256\n' + amzDate + '\n' + scope + '\n' + await s3Sha256Hex(canonicalReq);
    const kDate = await s3Hmac('AWS4' + cfg.secret, dateStamp);
    const kRegion = await s3Hmac(kDate, cfg.region);
    const kService = await s3Hmac(kRegion, 's3');
    const kSigning = await s3Hmac(kService, 'aws4_request');
    const sig = await s3Hmac(kSigning, stringToSign);
    return {
      'host': host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payload,
      'Authorization': 'AWS4-HMAC-SHA256 Credential=' + cfg.key + '/' + scope + ', SignedHeaders=' + signedHeaders.join(';') + ', Signature=' + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
    };
  }

  async function s3Fetch(method, path, body) {
    const headers = await signRequest(method, path, body);
    const url = endpoint + path;
    const opts = { method, headers };
    if (body !== undefined && body !== null) {
      opts.body = body;
      if (typeof body === 'string') headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('S3 ' + res.status + ' ' + path + (txt ? ': ' + txt.slice(0, 200) : ''));
    }
    return res;
  }

  function objectPath(part, id) { return '/photos/' + part + '/' + encodeURIComponent(id); }

  return {
    ref(path) {
      const seg = String(path || '').split('/').filter(Boolean);
      if (seg.length >= 3) {
        const part = seg[1], id = seg.slice(2).join('/');
        const p = objectPath(part, id);
        return {
          name: id,
          fullPath: seg.join('/'),
          async put(blob) {
            const txt = (typeof blob === 'string') ? blob : await blob.text();
            await s3Fetch('PUT', p, txt);
          },
          async getBlob() {
            try {
              const res = await s3Fetch('GET', p, null);
              return await res.blob();
            } catch (e) {
              if (/404/.test(String(e))) return null;
              throw e;
            }
          },
          async delete() {
            try { await s3Fetch('DELETE', p, null); } catch (e) { if (!/404/.test(String(e))) throw e; }
          }
        };
      }
      const fp = '/?list-type=2&prefix=photos/' + encodeURIComponent(seg.join('/')) + '/';
      return {
        async listAll() {
          const items = [];
          try {
            const res = await s3Fetch('GET', fp, null);
            const txt = await res.text();
            const keys = [...txt.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
            for (const k of keys) {
              const tail = k.split('/').pop();
              if (tail) items.push({ name: tail });
            }
          } catch (e) {
            if (!/404/.test(String(e))) throw e;
          }
          return { items, prefixes: [] };
        }
      };
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
  try {
    const meta = (await photoStore.getMeta(id).catch(() => null)) || {};
    const jobs = [];
    for (const part of PHOTO_PARTS) {
      const has = cloud[id] && cloud[id][part];
      if (has || !local['has' + part[0].toUpperCase() + part.slice(1)]) continue;
      jobs.push((async () => {
        const getter = part === 'orig' ? 'getEncryptedOrig' : (part === 'full' ? 'getEncryptedFull' : 'getEncryptedThumb');
        const enc = await photoStore[getter](id);
        if (!enc) return;
        // Обёртка: сам шифртекст + несекретные MIME/размер (размер и так виден
        // в метаданных Storage), чтобы на другом устройстве восстановить тип файла.
        const payload = { e: enc, m: { t: meta.origType || meta.type || '', ft: meta.type || '', st: meta.thumbType || '', s: meta.size || 0 } };
        await photoRef(part, id).put(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
      })());
    }
    await Promise.all(jobs);
    return { ok: true };
  } catch (e) {
    console.warn('[sync] не удалось выгрузить фото ' + id, e);
    return { ok: false, err: e };
  }
}


// Скачивание недостающих частей фото из облака (без повторного шифрования).
async function downloadCloudPhoto(id, cloud, local) {
  try {
    const meta = (local && (await photoStore.getMeta(id).catch(() => null))) || {};
    const got = {};
    let gotMeta = null;
    for (const part of PHOTO_PARTS) {
      const hasCloud = cloud[id] && cloud[id][part];
      const hasLocal = local && local['has' + part[0].toUpperCase() + part.slice(1)];
      if (!hasCloud || hasLocal) continue;
      const data = await photoRef(part, id).getBlob();
      const txt = (typeof data === 'string') ? data : await data.text();
      const parsed = JSON.parse(txt);
      // Новый формат { e: шифртекст, m: {t,ft,st,s} } и старый { i, d } — оба понимаем
      const enc = (parsed && parsed.e && typeof parsed.e.d === 'string') ? parsed.e
                : (parsed && typeof parsed.d === 'string') ? parsed : null;
      if (!enc) continue;
      got[part] = enc;
      if (parsed && parsed.m && !gotMeta) gotMeta = parsed.m;
    }
    if (!got.orig && !got.full && !got.thumb) return { ok: false, err: new Error('в облаке нет частей для скачивания') };
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
    return { ok: true };
  } catch (e) {
    console.warn('[sync] не удалось скачать фото ' + id, e);
    return { ok: false, err: e };
  }
}

// Проверяет облачные фото по одному: расшифровываются ли они текущим ключом.
// Берём самую «лёгкую» часть (миниатюра < показ-версия < оригинал) и пробуем
// расшифровать. Возвращает { foreign, unknown }:
//  - foreign: Map<id, part> — фото реально зашифровано ДРУГИМ ключом. Его не
//    трогаем никогда: ни скачивать, ни удалять.
//  - unknown: Map<id, err> — временный сбой (сеть/JSON/незнакомый формат). Фото
//    не трогаем в этом проходе, синхронизация повторится позже.
// Важно: фото чужого ключа НЕ блокируют синхронизацию остальных — иначе один
// «чужой» файл навсегда заморозил бы и скачивание наших фото, и их выгрузку.
async function probeCloudKeys(cloud) {
  const foreign = new Map();
  const unknown = new Map();
  for (const id of Object.keys(cloud)) {
    const part = ['thumb', 'full', 'orig'].find(p => cloud[id] && cloud[id][p]);
    if (!part) continue;
    try {
      const data = await photoRef(part, id).getBlob();
      const txt = (typeof data === 'string') ? data : await data.text();
      const parsed = JSON.parse(txt);
      const enc = (parsed && parsed.e && typeof parsed.e.d === 'string') ? parsed.e
                : (parsed && typeof parsed.d === 'string') ? parsed : null;
      if (!enc) throw new Error('незнакомый формат облачного файла');
      await aesDec(masterKey, enc);
    } catch (e) {
      // Криптографический сбой (неверный ключ/IV/шифртекст) — фото «чужое».
      // Любая другая ошибка (сеть, JSON) — временная, помечаем unknown.
      const emsg = String(e && e.message || e);
      if (e && (e.name === 'OperationError' || /decrypt/i.test(emsg))) {
        console.warn('[sync] облачное фото не расшифровывается текущим ключом', id, part);
        foreign.set(id, part);
      } else {
        unknown.set(id, e);
      }
    }
  }
  return { foreign, unknown };
}

// Полная сверка фото: локальный store ↔ облако ↔ db.photos.
async function syncPhotos() {
  if (!syncStorage || !photoStore || !masterKey || photoSyncing) return;
  photoSyncing = true;
  const stats = { downloaded: 0, uploaded: 0, failed: 0, retry: false };
  try {
    const localList = await photoStore.listIds();
    const localMap = new Map(localList.map(l => [l.id, l]));
    const cloud = await listCloudPhotos();
    // Проверяем каждое облачное фото отдельно. Чужое (другой ключ) НЕ блокирует
    // синхронизацию остальных: свои фото скачиваем и выгружаем, а чужие просто
    // не трогаем. Раньше одно «чужое» фото прерывало всю сверку — и свои фото
    // навсегда оставались невыгруженными и нескачанными (deadlock на телефоне).
    const probe = Object.keys(cloud).length ? await probeCloudKeys(cloud) : { foreign: new Map(), unknown: new Map() };
    const isSkipped = id => probe.foreign.has(id) || probe.unknown.has(id);
    if (probe.foreign.size) {
      console.warn('[sync] в облаке фото с другим ключом (' + probe.foreign.size + ' шт) — их не трогаю, свои фото синхронизирую');
      notify('В облаке есть фото с другим паролем — я их не трогаю, но свои фото выгружаю 💜', true);
    }
    if (probe.unknown.size) stats.retry = true; // сеть/формат — повторим позже
    const want = new Set((db.photos || []).map(p => p && p.id).filter(Boolean));
    // 1. Локальный мусор: блоб без фото в db (фото удалено) — чистим store
    for (const id of localMap.keys()) {
      if (want.has(id)) continue;
      try { await photoStore.delete(id); thumbCache.delete(id); } catch (e) {}
    }
    // 2. Облачный мусор: удаляем ТОЛЬКО если облако целиком «наше». Если есть
    //    хоть одно чужое/непроверенное фото — удаление отменяется: «мусором»
    //    могут оказаться чужие данные, их не трогаем.
    if (!probe.foreign.size && !probe.unknown.size) {
      for (const id of Object.keys(cloud)) {
        if (want.has(id)) continue;
        for (const part of PHOTO_PARTS) {
          if (cloud[id][part]) { try { await photoRef(part, id).delete(); } catch (e) {} }
        }
      }
    }
    // 3. Скачиваем недостающее с облака (кроме чужих и временно недоступных)
    for (const id of want) {
      if (isSkipped(id)) continue;
      const l = localMap.get(id);
      const need = PHOTO_PARTS.some(part => cloud[id] && cloud[id][part] && (!l || !l['has' + part[0].toUpperCase() + part.slice(1)]));
      if (!need) continue;
      const res = await downloadCloudPhoto(id, cloud, l);
      if (res && res.ok) stats.downloaded++;
      else { stats.failed++; stats.retry = true; }
    }
    // 4. Выгружаем недостающее в облако (новые фото + бэкфилл старых)
    for (const id of want) {
      const l = localMap.get(id);
      if (!l || !l.hasFull) continue; // полного блоба нет — выгружать нечего
      const res = await uploadCloudPhoto(id, cloud, l);
      if (res && res.ok) stats.uploaded++;
      else { stats.failed++; stats.retry = true; }
    }
    if (stats.failed) {
      notify('Часть фото не синхронизировалась — проверь интернет, повторю через минуту 💜', true);
    }
  } catch (e) {
    console.warn('[sync] сверка фото не удалась', e);
  } finally {
    photoSyncing = false;
    // Докачали блобы из облака — прогреваем кэш миниатюр и перерисовываем вьюхи,
    // иначе миниатюры, приехавшие после первого рендера, не появятся в галерее.
    if (typeof warmThumbCache === 'function') warmThumbCache();
    // Были временные сбои — попробуем ещё раз через 20 секунд.
    if (stats.retry) {
      clearTimeout(photoSyncTimer);
      photoSyncTimer = setTimeout(() => { syncPhotos().catch(e => console.warn('[sync] сверка фото', e)); }, 20000);
    }
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
  schedulePhotoSync(); // фото-сверка тоже по требованию
}
const syncNowBtnEl = $('#syncNowBtn');
if (syncNowBtnEl) syncNowBtnEl.addEventListener('click', syncNow);

/* ===== Диагностика облака (кнопка в настройках) =====
   Показывает, что сейчас в локальном фото-сторе, что в облаке и расшифровываются
   ли облачные фото текущим ключом. Помогает найти, где именно рвётся синхронизация. */
async function getCloudSyncTs() {
  if (!syncDb) return '—';
  try {
    const snap = await syncDb.ref(SYNC_PATH).once('value');
    const v = snap && snap.val ? snap.val() : null;
    return v ? (v.syncTs || 0) : 0;
  } catch (e) { return 'ошибка: ' + String(e && e.message || e); }
}
async function runCloudDiagnostics() {
  const out = $('#cloudDiagOut');
  if (!out) return;
  out.hidden = false;
  const lines = [];
  const add = s => lines.push(s);
  try {
    add('syncReady: ' + syncReady);
    add('syncStorage: ' + (syncStorage ? 'яндекс.диск' : 'нет'));
    add('masterKey: ' + (masterKey ? 'есть' : 'НЕТ'));
    add('photos в db: ' + ((db.photos || []).length));
    add('syncTs: локально=' + syncTs + ', в облаке=' + (await getCloudSyncTs()));
    try {
      const localList = await photoStore.listIds();
      add('локальный store: ' + localList.length + ' фото');
      for (const l of localList) add('  ' + l.id + ' full=' + l.hasFull + ' thumb=' + l.hasThumb + ' orig=' + l.hasOrig);
    } catch (e) { add('ошибка listIds: ' + String(e && e.message || e)); }
    let cloud = {};
    try { cloud = await listCloudPhotos(); } catch (e) { add('ошибка listCloudPhotos: ' + String(e && e.message || e)); }
    add('облако: ' + Object.keys(cloud).length + ' фото');
    for (const id of Object.keys(cloud)) add('  ' + id + ': ' + (PHOTO_PARTS.filter(p => cloud[id][p]).join(',') || '?'));
    if (Object.keys(cloud).length) {
      add('— расшифровка облачных фото текущим ключом —');
      for (const id of Object.keys(cloud)) {
        const part = ['thumb', 'full', 'orig'].find(p => cloud[id] && cloud[id][p]);
        if (!part) { add('  ' + id + ': нет частей'); continue; }
        try {
          const data = await photoRef(part, id).getBlob();
          const txt = (typeof data === 'string') ? data : await data.text();
          const parsed = JSON.parse(txt);
          const enc = (parsed && parsed.e && typeof parsed.e.d === 'string') ? parsed.e
                    : (parsed && typeof parsed.d === 'string') ? parsed : null;
          if (!enc) { add('  ' + id + ' (' + part + '): НЕЗНАКОМЫЙ ФОРМАТ'); continue; }
          const u8 = await aesDec(masterKey, enc);
          const head = Array.from(u8.subarray(0, 4)).map(b => String.fromCharCode(b)).join('');
          add('  ' + id + ' (' + part + '): расшифровано ✅ ' + u8.length + ' б «' + head.replace(/[^ -~]/g, '?') + '»');
        } catch (e) {
          const msg = String(e && e.name || '') + ': ' + String(e && e.message || e);
          const isKey = /OperationError|decrypt/i.test(msg);
          add('  ' + id + ' (' + part + '): ' + (isKey ? 'ДРУГОЙ КЛЮЧ ❌' : 'ОШИБКА ⚠') + ' — ' + msg.slice(0, 140));
        }
      }
    }
  } catch (e) {
    add('неожиданная ошибка: ' + String(e && e.message || e));
  }
  out.textContent = lines.join(String.fromCharCode(10));
}
const cloudDiagBtnEl = $('#cloudDiagBtn');
if (cloudDiagBtnEl) cloudDiagBtnEl.addEventListener('click', runCloudDiagnostics);
/* ===== Старт приложения =====
   initAuth() из 90-effects-init.js вызывается здесь — последним в сборке:
   он читает FIREBASE_CONFIG (let из этого модуля), который ещё в «мёртвой зоне»
   во время выполнения 90-effects-init.js. Так же инициализируются экраны входа. */
initAuth();

