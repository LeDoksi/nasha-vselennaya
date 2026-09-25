/* ===== Фото-хранилище: IndexedDB с шифрованием ===== */
// Два бэкенда: IDBPhotoStore (браузер) и MemoryPhotoStore (тесты/нет IndexedDB).
// Блобы шифруются мастер-ключом AES-GCM — нигде нет открытого текста.
// API: putPhoto(id, fullBlob, thumbBlob, meta) / getFull(id) / getThumb(id) / delete(id) / all() / exportBlobs() / importBlobs(arr)

let photoStore = null; // инициализируется при разблокировке

// ===== IndexedDB-бэкенд (браузер) =====
function openPhotoDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open('universe_photos', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
    };
  });
}

async function idbPut(store, data) {
  return new Promise((resolve, reject) => {
    const tx = store.db.transaction('photos', 'readwrite');
    const os = tx.objectStore('photos');
    const req = os.put(data);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(store, id) {
  return new Promise((resolve, reject) => {
    const tx = store.db.transaction('photos', 'readonly');
    const os = tx.objectStore('photos');
    const req = os.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(store, id) {
  return new Promise((resolve, reject) => {
    const tx = store.db.transaction('photos', 'readwrite');
    const os = tx.objectStore('photos');
    const req = os.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAll(store) {
  return new Promise((resolve, reject) => {
    const tx = store.db.transaction('photos', 'readonly');
    const os = tx.objectStore('photos');
    const req = os.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbClear(store) {
  return new Promise((resolve, reject) => {
    const tx = store.db.transaction('photos', 'readwrite');
    const os = tx.objectStore('photos');
    const req = os.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Шифрование блоба мастер-ключом
async function encryptBlob(u8) {
  if (!masterKey) throw new Error('No master key');
  return aesEnc(masterKey, u8);
}

async function decryptBlob(blob) {
  if (!masterKey) throw new Error('No master key');
  return aesDec(masterKey, blob);
}

// Конвертация Blob ↔ Uint8Array
async function blobToU8(blob) {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

function u8ToBlob(u8, type) {
  return new Blob([u8], { type });
}

// ===== Лёгкий индекс метаданных (id → флаги наличия частей + размер) =====
// Раньше listIds()/refreshSizes() каждый раз читали ВСЕ записи целиком через
// IndexedDB.getAll() (включая зашифрованные блобы оригиналов) — на каждую
// сверку с облаком (каждое добавление/удаление фото). При росте библиотеки
// это стало бы главным тормозом. Теперь индекс строится один раз при init()
// (единственное полное сканирование за разблокировку) и дальше обновляется
// точечно в put/putEncrypted/delete — без повторных полных сканов и без
// расшифровки блобов ради счётчика места.
function estimateSize(row) {
  if (row.meta && typeof row.meta.size === 'number') return row.meta.size;
  // Легаси-записи без meta.size — прикидываем по длине base64 шифртекста,
  // расшифровывать ради точного числа не нужно (это только для счётчика места).
  const d = row.full && row.full.d;
  return d ? Math.ceil((d.length * 3) / 4) : 0;
}
function indexEntry(row) {
  return { id: row.id, hasFull: !!row.full, hasThumb: !!row.thumb, hasOrig: !!row.orig, size: estimateSize(row) };
}

// Конвертация data-URL → Blob
function dataUrlToBlob(dataUrl) {
  const idx = dataUrl.indexOf(',');
  if (idx === -1) return null;
  const metaPart = dataUrl.slice(0, idx);
  const b64part = dataUrl.slice(idx + 1);
  const mime = /^data:([^;]+)/.exec(metaPart);
  const isBase64 = /;base64/i.test(metaPart);
  let bytes;
  if (isBase64) {
    bytes = unb64(b64part);
  } else {
    bytes = new Uint8Array([...b64part].map(ch => ch.charCodeAt(0)));
  }
  return new Blob([bytes], { type: (mime && mime[1]) || 'image/webp' });
}

// Перенос фото из db.photos[].data (data-URL) в хранилище блобов.
// Идемпотентно: фото с id, уже лежащие в сторе, не дублируем.
// После успешного переноса p.data удаляется из памяти — base64 больше не
// живёт в сейфе/localStorage, рендеры работают через кэш миниатюр
// (warmThumbCache после разблокировки) или photoUrl() из стора.
// Старые события, ссылавшиеся на фото по data-URL, переводятся на id.
async function migratePhotosToStore(store, db) {
  if (!db || !Array.isArray(db.photos)) return 0;
  let moved = 0;
  const dataToId = new Map();
  for (const p of db.photos) {
    if (!p.data) continue;
    if (!p.id) p.id = uid();
    const existing = await store.getMeta(p.id);
    if (!existing) {
      const blob = dataUrlToBlob(p.data);
      if (!blob) continue; // не разобрали data-URL — оставляем как легаси
      const meta = { type: blob.type || 'image/webp', width: p.width, height: p.height, takenAt: p.takenAt || null, title: p.title || '', size: blob.size };
      await store.put(p.id, blob, null, meta);
    }
    // фото перенесено в store — из памяти убираем base64
    dataToId.set(p.data, p.id);
    delete p.data;
    moved++;
  }
  // v6: события ссылаются на фото по id; старые data-URL переводим на id
  if (dataToId.size && Array.isArray(db.events)) {
    for (const ev of db.events) {
      if (!Array.isArray(ev.photos)) continue;
      ev.photos = ev.photos.map(ref => dataToId.get(ref) || ref);
    }
  }
  // Фото хотелок: раньше жили как data-URL прямо в db.wishlist (зашифрованный
  // сейф в localStorage, лимит ~5 МБ) — при нескольких хотелках с фото могли
  // молча не сохраниться при переполнении квоты. Переносим в photoStore, как
  // остальные фото, но НЕ добавляем в db.photos — хотелки не должны
  // засорять общую галерею «Фото» (осознанное решение). photoId — свой,
  // отдельный от id обычных фото; lbPhoto() в 85-lightbox.js умеет находить
  // фото хотелки по нему как фолбэк.
  if (Array.isArray(db.wishlist)) {
    for (const w of db.wishlist) {
      if (!w.data) continue;
      const id = w.photoId || uid();
      const existing = await store.getMeta(id);
      if (!existing) {
        const blob = dataUrlToBlob(w.data);
        if (!blob) continue;
        await store.put(id, blob, null, { type: blob.type || 'image/webp', title: w.text || '', size: blob.size });
      }
      w.photoId = id;
      delete w.data;
      moved++;
    }
  }
  return moved;
}
