/* ===== Облако фото (Yandex Object Storage) =====
   Раньше этот файл (src/95-sync.js) синхронизировал ещё и весь зашифрованный
   сейф целиком через Firebase Realtime Database (vaults/shared): при входе
   более свежий блоб из облака тихо заменял данные, только что загруженные из
   Firestore, и закреплял замену через save(). Firestore теперь сам источник
   правды для событий/заметок/списков/etc. (каждый экран пишет туда точечно,
   см. src/04-repo.js), поэтому вся эта блоб-синхронизация убрана целиком —
   держать два параллельных механизма записи было небезопасно (см. историю
   коммитов и .superpowers/sdd/2026-09-09-firestore-data-layer/progress.md).

   Единственное, что осталось в этом файле, — облако ФОТО: оригиналы, показ-
   версии и миниатюры по-прежнему синхронизируются через Yandex Object Storage
   (см. YANDEX_CLOUD_CONFIG и makeCloudStorage ниже) — бакет публичный на
   чтение (без секретных ключей на клиенте), см. README. Запускается из
   initPhotoSync(), которую вызывает unlockApp() (src/10-vault.js) после входа —
   Firebase-приложение и Google-вход к этому моменту уже готовы (гейт,
   src/01-gate.js), здесь просто поднимается клиент облака и стартует первая
   сверка. */

let FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDuAkskIpj3bsFOX6aPecFWZGJOlOzGzUk',
  authDomain: 'nasha-vselennaya.firebaseapp.com',
  projectId: 'nasha-vselennaya',
  storageBucket: 'nasha-vselennaya.firebasestorage.app',
  messagingSenderId: '222445763153',
  appId: '1:222445763153:web:df254e6b681c2e40289670',
  measurementId: 'G-JZY24EXCX3'
}; // ← config из Firebase Console (фаза B1). let — чтобы тесты могли подставить мок.

/* Фото-облако: Yandex Object Storage вместо Firebase Storage (Storage — только
   на платном Blaze-плане, из России не оплатить). Чтение — анонимное и без
   ключей (бакет публичен для префикса photos/, README → «Настройка бакета
   Yandex Object Storage»). Запись — через Cloud Function `photo-sign`
   (functions/photo-sign/): Yandex Object Storage не даёт анонимно писать в
   бакет, даже если политика это разрешает, поэтому секретный ключ живёт
   только в переменных окружения функции, а клиент получает у неё короткоживущую
   подписанную ссылку и сам грузит/удаляет файл по ней. `signFnUrl` — не
   секрет, просто публичный адрес функции. */
let YANDEX_CLOUD_CONFIG = {
  bucket: 'nasha-vselennaya', // имя бакета (не секрет)
  region: 'ru-central1', // регион Yandex Cloud
  signFnUrl: 'https://functions.yandexcloud.net/d4empeq0dp76dkug5c9r' // Cloud Function photo-sign (не секрет)
};

// Таймаут для сетевых вызовов: не держим пользователя на «загружаем…»
// бесконечно, если Firebase отвечает медленно (мобильный интернет). Также
// используется гейтом (src/01-gate.js) при чтении ключа фото из Firestore.
function withTimeout(promise, ms) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/* ===== Фото в облаке: оригиналы + показ-версии + миниатюры в Yandex Object
   Storage =====
   Пути: photos/orig/{id} (исходный файл), photos/full/{id} (показ-версия),
   photos/thumb/{id} (миниатюра). В облако уезжают САМИ шифртексты из photoStore
   (AES-GCM мастер-ключом) — сервер видит только шифртекст, прочитать фото без
   пароля нельзя (zero-knowledge), а на другом устройстве они расшифровываются тем
   же мастер-ключом. Реализация — адаптер makeCloudStorage() ниже: интерфейс
   { put, getBlob, delete, listAll }, читает анонимно напрямую, пишет через
   Cloud Function photo-sign (см. комментарий над makeCloudStorage).

   Модель — полная сверка (reconciliation): после каждой операции с фото
   (добавление, удаление) с задержкой сравниваем три списка: локальный
   photoStore, облако Storage и db.photos. Недостающее выгружаем и скачиваем,
   лишнее (удалённые фото) чистим и в облаке, и в локальном сторе. Так работают
   и бэкфилл старых фото, и удаление с другого устройства. Загрузка/скачивание
   нескольких фото идёт параллельно (см. mapLimit) — иначе первый вход на новом
   устройстве с большой галереей тянул бы фото одно за другим. */
const PHOTO_PARTS = ['orig', 'full', 'thumb'];
let syncStorage = null; // Yandex Object Storage (S3)
let photoSyncTimer = null; // debounce после операций с фото
let photoSyncing = false; // защита от параллельных сверок

/* ===== Запуск: вызывается из unlockApp() после входа =====
   Google-вход и Firebase-приложение (fbApp, см. src/01-gate.js) уже готовы к
   этому моменту — здесь только поднимаем клиент Yandex Object Storage и
   запускаем первую сверку фото. */
function initPhotoSync() {
  if (!gateUser) return;
  syncStorage = makeCloudStorage();
  schedulePhotoSync();
}

/* ===== Остановка синхронизации фото =====
   Раньше вызывалась из lock() (приватный замок по бездействию) — его убрали
   целиком (у каждого своё устройство, прятать по таймеру незачем), поэтому
   сейчас сам app.js эту функцию не зовёт. Держим как явную точку входа для
   будущего кода/тестов — так же, как isLocked() ниже по сборке. */
// eslint-disable-next-line no-unused-vars
function stopPhotoSync() {
  clearTimeout(photoSyncTimer);
  syncStorage = null;
  photoSyncing = false;
}

/* ===== Адаптер для Yandex Object Storage =====
   Чтение (GetObject/ListBucket) — анонимно и напрямую в бакет: политика
   бакета разрешает это для префикса photos/ (см. README). Yandex Object
   Storage НЕ поддерживает анонимную запись (PutObject/DeleteObject), даже
   если политика формально её разрешает — на практике сервер всё равно
   отвечает 403 (проверено). Поэтому запись идёт в два шага:
   1) короткий GET на Cloud Function `photo-sign` (см. functions/photo-sign/) —
      она держит секретный ключ и отдаёт подписанную (presigned) ссылку на
      PUT/DELETE с временем жизни 60 секунд;
   2) сам PUT/DELETE клиент делает напрямую в бакет по этой ссылке — тело
      файла через функцию не идёт. YANDEX_CLOUD_CONFIG.signFnUrl — не секрет,
      просто публичный адрес функции (сам секрет — только в её env). */

function makeCloudStorage() {
  const cfg = YANDEX_CLOUD_CONFIG;
  if (!cfg.bucket) return null;
  const endpoint = 'https://' + cfg.bucket + '.storage.yandexcloud.net';

  async function s3Fetch(method, path, body) {
    const res = await fetch(endpoint + path, { method, body: body ?? undefined });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('S3 ' + res.status + ' ' + path + (txt ? ': ' + txt.slice(0, 200) : ''));
    }
    return res;
  }

  async function presignedFetch(method, part, id, body) {
    if (!cfg.signFnUrl) throw new Error('YANDEX_CLOUD_CONFIG.signFnUrl не задан — запись фото невозможна');
    // photo-sign проверяет Firebase ID-токен перед выдачей подписи (иначе
    // подписать мог бы кто угодно, кто откроет devtools — URL функции не
    // секрет). Токен берём у уже выполненного Google-входа (src/01-gate.js) —
    // fbApp, единственное Firebase-приложение на весь сайт (гейт + фото).
    // Заголовок называется X-Firebase-Token, а не Authorization: Yandex
    // Cloud перехватывает Authorization на уровне своей платформы (пытается
    // прочитать его как СВОЙ IAM-токен) ещё до кода функции — с этим именем
    // валидный Firebase-токен долетал бы до кода, но платформа режет запрос
    // раньше 403-м, даже не заглянув внутрь (проверено 12.08.2026).
    let authHeaders = {};
    try {
      const user = fbApp && firebase.auth(fbApp).currentUser;
      if (user) authHeaders = { 'X-Firebase-Token': await user.getIdToken() };
    } catch (e) {
      console.warn('[photo-sync] не удалось получить ID-токен для photo-sign', e);
    }
    const signRes = await fetch(cfg.signFnUrl + '?method=' + method + '&part=' + encodeURIComponent(part) + '&id=' + encodeURIComponent(id), { headers: authHeaders });
    if (!signRes.ok) throw new Error('sign-fn ' + signRes.status);
    const { url } = await signRes.json();
    if (!url) throw new Error('sign-fn: пустая ссылка');
    const res = await fetch(url, { method, body: body ?? undefined });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('S3 ' + res.status + ' photos/' + part + '/' + id + (txt ? ': ' + txt.slice(0, 200) : ''));
    }
    return res;
  }

  function objectPath(part, id) {
    return '/photos/' + part + '/' + encodeURIComponent(id);
  }

  return {
    ref(path) {
      const seg = String(path || '')
        .split('/')
        .filter(Boolean);
      if (seg.length >= 3) {
        const part = seg[1],
          id = seg.slice(2).join('/');
        const p = objectPath(part, id);
        return {
          name: id,
          fullPath: seg.join('/'),
          async put(blob) {
            const txt = typeof blob === 'string' ? blob : await blob.text();
            await presignedFetch('PUT', part, id, txt);
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
            try {
              await presignedFetch('DELETE', part, id, null);
            } catch (e) {
              if (!/404/.test(String(e))) throw e;
            }
          }
        };
      }
      const fp = '/?list-type=2&prefix=' + encodeURIComponent(seg.join('/') + '/');
      return {
        // ListObjectsV2 отдаёт максимум 1000 ключей за раз (IsTruncated +
        // NextContinuationToken) — без пагинации при библиотеке за ~300 фото
        // (1000 / 3 части) список молча обрывался бы, и «скачать с другого
        // устройства» переставало бы находить недостающее.
        async listAll() {
          const items = [];
          let token = null;
          try {
            do {
              const q = fp + (token ? '&continuation-token=' + encodeURIComponent(token) : '');
              const res = await s3Fetch('GET', q, null);
              const txt = await res.text();
              const keys = [...txt.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
              for (const k of keys) {
                const tail = k.split('/').pop();
                if (tail) items.push({ name: tail });
              }
              const truncated = /<IsTruncated>true<\/IsTruncated>/.test(txt);
              const tokenMatch = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(txt);
              token = truncated && tokenMatch ? tokenMatch[1] : null;
            } while (token);
          } catch (e) {
            if (!/404/.test(String(e))) throw e;
          }
          return { items, prefixes: [] };
        }
      };
    }
  };
}

function photoRef(part, id) {
  return syncStorage.ref('photos/' + part + '/' + id);
}

// Запуск сверки фото (debounce 1.2 с — было 2.5, снижено вместе с
// оптимизацией самой сверки: listIds() больше не читает блобы, а probe не
// перепроверяет уже свои фото, так что каждый прогон стал заметно дешевле):
// после добавления/удаления фото. Без Storage или до разблокировки — просто ждём.
function schedulePhotoSync() {
  if (!syncStorage || !photoStore || !masterKey || photoSyncing) return;
  clearTimeout(photoSyncTimer);
  photoSyncTimer = setTimeout(() => {
    syncPhotos().catch(e => console.warn('[photo-sync] сверка фото', e));
  }, 1200);
}

// Что сейчас лежит в облаке: { id: { orig: true, full: true, thumb: true } }
async function listCloudPhotos() {
  const out = {};
  for (const part of PHOTO_PARTS) {
    try {
      const res = await syncStorage.ref('photos/' + part).listAll();
      for (const it of res.items || []) (out[it.name] = out[it.name] || {})[part] = true;
    } catch (e) {
      console.warn('[photo-sync] не удалось прочитать облако photos/' + part, e);
    }
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
      jobs.push(
        (async () => {
          const getter = part === 'orig' ? 'getEncryptedOrig' : part === 'full' ? 'getEncryptedFull' : 'getEncryptedThumb';
          const enc = await photoStore[getter](id);
          if (!enc) return;
          // Обёртка: сам шифртекст + несекретные MIME/размер (размер и так виден
          // в метаданных Storage), чтобы на другом устройстве восстановить тип файла.
          const payload = { e: enc, m: { t: meta.origType || meta.type || '', ft: meta.type || '', st: meta.thumbType || '', s: meta.size || 0 } };
          await photoRef(part, id).put(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
        })()
      );
    }
    await Promise.all(jobs);
    return { ok: true };
  } catch (e) {
    console.warn('[photo-sync] не удалось выгрузить фото ' + id, e);
    return { ok: false, err: e };
  }
}

// Скачивание недостающих частей фото из облака (без повторного шифрования).
// Части (orig/full/thumb) качаются параллельно, а не по очереди — раньше
// одно фото ждало трёх последовательных запросов, теперь одного «раунда».
async function downloadCloudPhoto(id, cloud, local) {
  try {
    const meta = (local && (await photoStore.getMeta(id).catch(() => null))) || {};
    const need = PHOTO_PARTS.filter(part => {
      const hasCloud = cloud[id] && cloud[id][part];
      const hasLocal = local && local['has' + part[0].toUpperCase() + part.slice(1)];
      return hasCloud && !hasLocal;
    });
    const fetched = await Promise.all(
      need.map(async part => {
        const data = await photoRef(part, id).getBlob();
        const txt = typeof data === 'string' ? data : await data.text();
        const parsed = JSON.parse(txt);
        // Новый формат { e: шифртекст, m: {t,ft,st,s} } и старый { i, d } — оба понимаем
        const enc = parsed && parsed.e && typeof parsed.e.d === 'string' ? parsed.e : parsed && typeof parsed.d === 'string' ? parsed : null;
        return { part, enc, m: parsed && parsed.m };
      })
    );
    const got = {};
    let gotMeta = null;
    for (const f of fetched) {
      if (!f.enc) continue;
      got[f.part] = f.enc;
      if (f.m && !gotMeta) gotMeta = f.m;
    }
    if (!got.orig && !got.full && !got.thumb) return { ok: false, err: new Error('в облаке нет частей для скачивания') };
    // Сохраняем всё разом, чтобы не потерять уже имеющиеся локальные части
    const exOrig = local && local.hasOrig ? await photoStore.getEncryptedOrig(id) : null;
    const exFull = local && local.hasFull ? await photoStore.getEncryptedFull(id) : null;
    const exThumb = local && local.hasThumb ? await photoStore.getEncryptedThumb(id) : null;
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
    console.warn('[photo-sync] не удалось скачать фото ' + id, e);
    return { ok: false, err: e };
  }
}

// Параллельно выполняет fn по items, не более limit одновременно — чтобы
// сверка N фото не шла строго по одному (было так — первый вход на новом
// устройстве с большой галереей качал бы фото поштучно), но и не открывала
// сотни запросов разом (лимит бережёт Cloud Function и сеть телефона).
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
const SYNC_CONCURRENCY = 4;

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
      const txt = typeof data === 'string' ? data : await data.text();
      const parsed = JSON.parse(txt);
      const enc = parsed && parsed.e && typeof parsed.e.d === 'string' ? parsed.e : parsed && typeof parsed.d === 'string' ? parsed : null;
      if (!enc) throw new Error('незнакомый формат облачного файла');
      await aesDec(masterKey, enc);
    } catch (e) {
      // Криптографический сбой (неверный ключ/IV/шифртекст) — фото «чужое».
      // Любая другая ошибка (сеть, JSON) — временная, помечаем unknown.
      const emsg = String((e && e.message) || e);
      if (e && (e.name === 'OperationError' || /decrypt/i.test(emsg))) {
        console.warn('[photo-sync] облачное фото не расшифровывается текущим ключом', id, part);
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
  const stats = { downloaded: 0, uploaded: 0, failed: 0, retry: false, retrySoon: false };
  try {
    const localList = await photoStore.listIds();
    const localMap = new Map(localList.map(l => [l.id, l]));
    const cloud = await listCloudPhotos();
    // Фото хотелок в галерею (db.photos) не входят (осознанно, чтобы не
    // засорять «Наши моменты» скриншотами подарков), но синхронизировать их
    // между устройствами всё равно нужно — иначе партнёр не увидит фото
    // хотелки на своём телефоне. Добавляем их id в want отдельно.
    const want = new Set([...(db.photos || []).map(p => p && p.id).filter(Boolean), ...(db.wishlist || []).map(w => w && w.photoId).filter(Boolean)]);
    const hasPart = (id, part) => {
      const l = localMap.get(id);
      return !!(l && l['has' + part[0].toUpperCase() + part.slice(1)]);
    };
    // Проверяем расшифровку не для ВСЕХ облачных фото, а только для тех, что
    // ещё не доказаны своими: если id уже в db.photos (want) и все части,
    // которые есть в облаке, уже лежат у нас локально — мы их когда-то сами
    // расшифровали (создали или уже скачали), повторный запрос+расшифровка
    // ничего нового не скажут. Проверяем только новое/неполное — кандидатов
    // на скачивание и на возможную чистку «мусора».
    const toProbe = {};
    for (const id of Object.keys(cloud)) {
      const fullyLocalAndWanted = want.has(id) && PHOTO_PARTS.every(part => !cloud[id][part] || hasPart(id, part));
      if (!fullyLocalAndWanted) toProbe[id] = cloud[id];
    }
    // Чужое (другой ключ) НЕ блокирует синхронизацию остальных: свои фото
    // скачиваем и выгружаем, а чужие просто не трогаем. Раньше одно «чужое»
    // фото прерывало всю сверку — и свои фото навсегда оставались
    // невыгруженными и нескачанными (deadlock на телефоне).
    const probe = Object.keys(toProbe).length ? await probeCloudKeys(toProbe) : { foreign: new Map(), unknown: new Map() };
    const isSkipped = id => probe.foreign.has(id) || probe.unknown.has(id);
    if (probe.foreign.size) {
      console.warn('[photo-sync] в облаке фото с другим ключом (' + probe.foreign.size + ' шт) — их не трогаю, свои фото синхронизирую');
      notify('В облаке есть фото с другим паролем — я их не трогаю, но свои фото выгружаю 💜', true);
    }
    if (probe.unknown.size) stats.retry = true; // сеть/формат — повторим позже
    // 1. Локальный мусор: блоб без фото в db (фото удалено) — чистим store
    for (const id of localMap.keys()) {
      if (want.has(id)) continue;
      try {
        await photoStore.delete(id);
        thumbCache.delete(id);
      } catch (e) {}
    }
    // 2. Облачный мусор: удаляем ТОЛЬКО если облако целиком «наше». Если есть
    //    хоть одно чужое/непроверенное фото — удаление отменяется: «мусором»
    //    могут оказаться чужие данные, их не трогаем.
    if (!probe.foreign.size && !probe.unknown.size) {
      for (const id of Object.keys(cloud)) {
        if (want.has(id)) continue;
        for (const part of PHOTO_PARTS) {
          if (cloud[id][part]) {
            try {
              await photoRef(part, id).delete();
            } catch (e) {}
          }
        }
      }
    }
    // 3. Скачиваем недостающее с облака (кроме чужих и временно недоступных) —
    //    параллельно, не более SYNC_CONCURRENCY фото одновременно.
    const toDownload = [...want].filter(id => {
      if (isSkipped(id)) return false;
      return PHOTO_PARTS.some(part => cloud[id] && cloud[id][part] && !hasPart(id, part));
    });
    // Гонка с другим устройством: запись о фото (в базе) обычно долетает
    // быстрее, чем сам файл (сама запись — маленький документ Firestore, а
    // файл ещё грузится presign+PUT). Если id есть в db.photos, но НИ
    // локально, НИ в облаке пока ничего нет — это не «нечего скачивать», а
    // «другое устройство ещё грузит», и без специальной обработки sync тихо
    // завершался бы успешно, ничего не скачав, и не повторялся бы — фото так
    // и оставалось «битым», пока кто-то не нажмёт «Синхронизировать сейчас»
    // вручную. Планируем быстрый повтор (см. finally), а не 20-секундный, как
    // при настоящих сбоях.
    const pendingElsewhere = [...want].some(id => {
      const l = localMap.get(id);
      const hasAnyLocal = !!(l && (l.hasFull || l.hasThumb || l.hasOrig));
      const hasAnyCloud = !!(cloud[id] && PHOTO_PARTS.some(p => cloud[id][p]));
      return !hasAnyLocal && !hasAnyCloud;
    });
    if (pendingElsewhere) stats.retrySoon = true;
    await mapLimit(toDownload, SYNC_CONCURRENCY, async id => {
      const res = await downloadCloudPhoto(id, cloud, localMap.get(id));
      if (res && res.ok) stats.downloaded++;
      else {
        stats.failed++;
        stats.retry = true;
      }
    });
    // 4. Выгружаем недостающее в облако (новые фото + бэкфилл старых) —
    //    тоже параллельно.
    const toUpload = [...want].filter(id => {
      const l = localMap.get(id);
      return l && l.hasFull;
    });
    await mapLimit(toUpload, SYNC_CONCURRENCY, async id => {
      const res = await uploadCloudPhoto(id, cloud, localMap.get(id));
      if (res && res.ok) stats.uploaded++;
      else {
        stats.failed++;
        stats.retry = true;
      }
    });
    if (stats.failed) {
      notify('Часть фото не синхронизировалась — проверь интернет, повторю через минуту 💜', true);
    }
  } catch (e) {
    console.warn('[photo-sync] сверка фото не удалась', e);
  } finally {
    photoSyncing = false;
    // Докачали блобы из облака — прогреваем кэш миниатюр и перерисовываем вьюхи,
    // иначе миниатюры, приехавшие после первого рендера, не появятся в галерее.
    if (typeof warmThumbCache === 'function') warmThumbCache();
    // Ждём файл, который вот-вот появится (другое устройство ещё грузит) —
    // проверяем часто и недолго, а не 20 секунд, как при настоящих сбоях.
    if (stats.retrySoon) {
      clearTimeout(photoSyncTimer);
      photoSyncTimer = setTimeout(() => {
        syncPhotos().catch(e => console.warn('[photo-sync] сверка фото', e));
      }, 3000);
    } else if (stats.retry) {
      // Были временные сбои (сеть, чужой формат и т.п.) — попробуем ещё раз через 20 секунд.
      clearTimeout(photoSyncTimer);
      photoSyncTimer = setTimeout(() => {
        syncPhotos().catch(e => console.warn('[photo-sync] сверка фото', e));
      }, 20000);
    }
  }
}

/* ===== Старт приложения =====
   boot() из src/01-gate.js вызывается здесь — последним в сборке: он (через
   ensureFbApp) читает FIREBASE_CONFIG (let из этого модуля), который ещё в
   «мёртвой зоне» во время выполнения 01-gate.js. Boot запускает Google-гейт,
   а он уже сам ведёт к unlockApp(). */
boot();
