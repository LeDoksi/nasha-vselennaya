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
   initPhotoSync(), которую вызывает unlockApp() (src/01-gate.js) после входа —
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
   на платном Blaze-плане, из России не оплатить). И чтение, и запись идут
   через Cloud Function `photo-sign` (functions/photo-sign/): Yandex Object
   Storage не даёт анонимно ни читать, ни писать в бакет (см. README → раздел
   B2/B3), поэтому секретный ключ живёт только в переменных окружения
   функции, а клиент получает у неё короткоживущую подписанную ссылку и сам
   грузит/скачивает/удаляет файл по ней. `signFnUrl` — не секрет, просто
   публичный адрес функции. */
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
   { put, getBlob, delete, listAll }, и чтение, и запись идут через presigned
   ссылки от Cloud Function photo-sign (см. комментарий над makeCloudStorage).

   Модель — полная сверка (reconciliation): после каждой операции с фото
   (добавление, удаление) с задержкой сравниваем три списка: локальный
   photoStore, облако Storage и db.photos. Недостающее выгружаем и скачиваем,
   лишнее (удалённые фото) чистим и в облаке, и в локальном сторе. Так работают
   и бэкфилл старых фото, и удаление с другого устройства. Загрузка/скачивание
   нескольких фото идёт параллельно (см. mapLimit) — иначе первый вход на новом
   устройстве с большой галереей тянул бы фото одно за другим. */
const PHOTO_PARTS = ['orig', 'full', 'thumb'];
// Фоновая очередь (syncPhotos) качает эagerно ТОЛЬКО миниатюры — модель
// iCloud (NV-7): full/orig докачиваются по требованию через ensureCloudPart
// (см. Task 7), когда фото реально открывают. Выгрузка (uploadCloudPhoto)
// не сужается — свои новые фото уходят в облако всеми тремя частями сразу,
// они и так уже есть локально в момент добавления.
const EAGER_DOWNLOAD_PARTS = ['thumb'];

// Сериализует read-modify-write в photoStore.putEncrypted по одному и тому
// же id — без этого два конкурентных докачивания разных частей одного фото
// (ensureCloudPart из светбокса + фоновая downloadThumbsBatch, или два
// параллельных ensureCloudPart на orig/full при зуме) читают "до"-состояние
// синхронно, и последняя запись затирает часть, которую только что сохранил
// первый вызов. Хвост цепочки на id живёт в photoWriteLocks только пока есть
// что ждать — удаляется, как только его цепочка отработала и ничего нового
// не встало следом (иначе за долгую сессию накопился бы мусор на каждый id).
const photoWriteLocks = new Map(); // id -> хвост цепочки промисов для этого id
function withPhotoWriteLock(id, fn) {
  const prev = photoWriteLocks.get(id) || Promise.resolve();
  const tail = prev.then(fn, fn);
  const settled = tail.catch(() => {});
  photoWriteLocks.set(id, settled);
  settled.then(() => {
    if (photoWriteLocks.get(id) === settled) photoWriteLocks.delete(id);
  });
  return tail;
}

let syncStorage = null; // Yandex Object Storage (S3)
let photoSyncTimer = null; // debounce после операций с фото
let photoSyncing = false; // защита от параллельных сверок
let cloudDownNotified = false; // «хранилище недоступно» говорим один раз, а не каждый повтор

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
   Бакет закрыт от анонимного доступа целиком (см. README, раздел B2) —
   Yandex Object Storage не поддерживает анонимный GetObject/ListBucket ни
   PutObject/DeleteObject, даже если политика формально это разрешает — на
   практике сервер отвечает 403 (проверено). Поэтому и чтение, и запись идут
   в два шага:
   1) короткий запрос на Cloud Function `photo-sign` (см. functions/photo-sign/,
      раздел README B3) — она держит секретный ключ и отдаёт подписанную
      (presigned) ссылку на GET/LIST/PUT/DELETE с коротким временем жизни;
   2) сам GET/LIST/PUT/DELETE клиент делает напрямую в бакет по этой ссылке —
      тело файла через функцию не идёт. YANDEX_CLOUD_CONFIG.signFnUrl — не
      секрет, просто публичный адрес функции (сам секрет — только в её env). */

function makeCloudStorage() {
  const cfg = YANDEX_CLOUD_CONFIG;
  if (!cfg.bucket) return null;

  // Общий заголовок авторизации для любого вызова photo-sign (GET/PUT/DELETE/
  // LIST/batch) — вынесено, чтобы не дублировать в каждом из четырёх мест
  // (NV-7: раньше было одно место записи, теперь ещё три — чтение, листинг,
  // batch). Токен берём у уже выполненного Google-входа (src/01-gate.js) —
  // fbApp, единственное Firebase-приложение на весь сайт (гейт + фото).
  async function firebaseAuthHeader() {
    try {
      const user = fbApp && firebase.auth(fbApp).currentUser;
      if (user) return { 'X-Firebase-Token': await user.getIdToken() };
    } catch (e) {
      console.warn('[photo-sync] не удалось получить ID-токен для photo-sign', e);
    }
    return {};
  }

  // Один запрос подписи (GET/PUT/DELETE одного объекта, или LIST) — только
  // ссылка, без похода за байтами. query — объект строковых параметров
  // (method, part, id — для объекта; method=LIST, prefix, continuation-token
  // — для листинга).
  async function presignFn(query) {
    if (!cfg.signFnUrl) throw new Error('YANDEX_CLOUD_CONFIG.signFnUrl не задан — доступ к фото невозможен');
    const authHeaders = await firebaseAuthHeader();
    const qs = new URLSearchParams(query).toString();
    const signRes = await fetch(cfg.signFnUrl + '?' + qs, { headers: authHeaders });
    if (!signRes.ok) throw new Error('sign-fn ' + signRes.status);
    const { url } = await signRes.json();
    if (!url) throw new Error('sign-fn: пустая ссылка');
    return url;
  }

  async function presignedFetch(method, part, id, body) {
    const url = await presignFn({ method, part, id });
    const res = await fetch(url, { method, body: body ?? undefined });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('S3 ' + res.status + ' photos/' + part + '/' + id + (txt ? ': ' + txt.slice(0, 200) : ''));
    }
    return res;
  }

  return {
    ref(path) {
      const seg = String(path || '')
        .split('/')
        .filter(Boolean);
      if (seg.length >= 3) {
        const part = seg[1],
          id = seg.slice(2).join('/');
        return {
          name: id,
          fullPath: seg.join('/'),
          async put(blob) {
            const txt = typeof blob === 'string' ? blob : await blob.text();
            await presignedFetch('PUT', part, id, txt);
          },
          async getBlob() {
            try {
              const res = await presignedFetch('GET', part, id, null);
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
      const prefix = seg.join('/') + '/';
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
              const url = await presignFn({ method: 'LIST', prefix, ...(token ? { 'continuation-token': token } : {}) });
              const res = await fetch(url, { method: 'GET' });
              if (!res.ok) throw new Error('S3 ' + res.status + ' LIST ' + prefix);
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
    },
    // Пачка presigned GET-ссылок одним HTTP-запросом — используется фоновой
    // очередью миниатюр (NV-7), чтобы не делать по одному запросу подписи на
    // каждое фото. items: [{part, id}]. Возвращает [{id,part,url}|{id,part,error}].
    async batchPresignGet(items) {
      if (!cfg.signFnUrl || !items.length) return [];
      const authHeaders = await firebaseAuthHeader();
      const res = await fetch(cfg.signFnUrl, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      if (!res.ok) throw new Error('sign-fn batch ' + res.status);
      const { results } = await res.json();
      return results || [];
    }
  };
}

function photoRef(part, id) {
  return syncStorage.ref('photos/' + part + '/' + id);
}

// Разбирает тело части фото из облака: новый формат {e: шифртекст, m: meta}
// и легаси {i, d} (само тело — шифртекст без обёртки meta) — оба формата
// нужно различать и в фоновой докачке миниатюр (downloadThumbsBatch), и в
// ensureCloudPart (NV-7), поэтому вынесено в общий хелпер.
function decodeCloudPartBody(txt) {
  const parsed = JSON.parse(txt);
  const enc = parsed && parsed.e && typeof parsed.e.d === 'string' ? parsed.e : parsed && typeof parsed.d === 'string' ? parsed : null;
  return enc ? { enc, meta: parsed.m || null } : null;
}

// Накладывает несекретные MIME/размер из облачной обёртки поверх локального
// meta (см. payload в uploadCloudPhoto) — тоже общее место для
// downloadThumbsBatch и ensureCloudPart.
function mergeCloudMeta(meta, cloudMeta) {
  const out = { ...meta };
  if (cloudMeta) {
    if (cloudMeta.t) out.origType = cloudMeta.t;
    if (cloudMeta.ft) out.type = cloudMeta.ft;
    if (cloudMeta.st) out.thumbType = cloudMeta.st;
    if (cloudMeta.s) out.size = cloudMeta.s;
  }
  return out;
}

// Скачивает и разбирает ОДНУ часть фото из облака (без сохранения в store —
// это забота вызывающего). null — части нет или формат не распознан.
async function fetchCloudPart(id, part) {
  const data = await photoRef(part, id).getBlob();
  if (!data) return null;
  const txt = typeof data === 'string' ? data : await data.text();
  return decodeCloudPartBody(txt);
}

// Докачивает ОДНУ часть фото по требованию — не из фоновой очереди
// (syncPhotos качает эagerно только thumb, см. Task 8), а в момент, когда
// она реально понадобилась: photoUrl()/photoOrigUrl() (src/05-photostore.js)
// зовут это, когда локального блоба нет. Возвращает true, если часть теперь
// доступна локально (уже была или только что докачана).
async function ensureCloudPart(id, part) {
  if (!photoStore || !id) return false;
  const getter = 'getEncrypted' + part[0].toUpperCase() + part.slice(1);
  const already = await photoStore[getter](id).catch(() => null);
  if (already) return true;
  if (!syncStorage || !masterKey) return false;
  try {
    const r = await fetchCloudPart(id, part);
    if (!r) return false;
    // await, не bare return: если fn внутри лока бросит, ошибка должна
    // всплыть здесь и попасть в catch ниже (bare "return promise" в async-
    // функции не проходит через окружающий try/catch — исполнение к этому
    // моменту уже покинуло тело функции).
    return await withPhotoWriteLock(id, async () => {
      const meta = (await photoStore.getMeta(id).catch(() => null)) || {};
      const meta2 = mergeCloudMeta(meta, r.meta);
      const exFull = part === 'full' ? r.enc : await photoStore.getEncryptedFull(id).catch(() => null);
      const exThumb = part === 'thumb' ? r.enc : await photoStore.getEncryptedThumb(id).catch(() => null);
      const exOrig = part === 'orig' ? r.enc : await photoStore.getEncryptedOrig(id).catch(() => null);
      await photoStore.putEncrypted(id, exFull, exThumb, meta2, exOrig);
      return true;
    });
  } catch (e) {
    console.warn('[photo-sync] не удалось докачать часть фото по требованию', id, part, e);
    return false;
  }
}
