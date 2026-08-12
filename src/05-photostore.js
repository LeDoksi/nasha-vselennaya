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

// ===== IDBPhotoStore =====
const IDBPhotoStore = {
  db: null,
  _index: null, // Map<id, {hasFull,hasThumb,hasOrig,size}> — см. indexEntry() выше
  async init() {
    this.db = await openPhotoDB();
    this._index = new Map();
    const rows = await idbGetAll(this);
    for (const r of rows) this._index.set(r.id, indexEntry(r));
  },
  async put(id, fullBlob, thumbBlob, meta, origBlob) {
    const fullU8 = fullBlob instanceof Uint8Array ? fullBlob : await blobToU8(fullBlob);
    const thumbU8 = thumbBlob instanceof Uint8Array ? thumbBlob : thumbBlob ? await blobToU8(thumbBlob) : null;
    const origU8 = origBlob instanceof Uint8Array ? origBlob : origBlob ? await blobToU8(origBlob) : null;
    const encFull = await encryptBlob(fullU8);
    const encThumb = thumbU8 ? await encryptBlob(thumbU8) : null;
    const encOrig = origU8 ? await encryptBlob(origU8) : null;
    const row = { id, full: encFull, thumb: encThumb, orig: encOrig, meta: meta || {} };
    await idbPut(this, row);
    this._index.set(id, indexEntry(row));
  },
  // Сохранение уже зашифрованных блобов (пришли из облака) — без повторного шифрования.
  async putEncrypted(id, encFull, encThumb, meta, encOrig) {
    const row = { id, full: encFull, thumb: encThumb, orig: encOrig, meta: meta || {} };
    await idbPut(this, row);
    this._index.set(id, indexEntry(row));
  },
  async getFull(id) {
    const row = await idbGet(this, id);
    if (!row || !row.full) return null;
    const u8 = await decryptBlob(row.full);
    return u8ToBlob(u8, row.meta?.type || 'image/webp');
  },
  async getThumb(id) {
    const row = await idbGet(this, id);
    if (!row || !row.thumb) return null;
    const u8 = await decryptBlob(row.thumb);
    return u8ToBlob(u8, row.meta?.thumbType || 'image/webp');
  },
  async getOrig(id) {
    const row = await idbGet(this, id);
    if (!row || !row.orig) return null;
    const u8 = await decryptBlob(row.orig);
    return u8ToBlob(u8, row.meta?.origType || row.meta?.type || 'image/jpeg');
  },
  async getEncryptedFull(id) {
    const row = await idbGet(this, id);
    return row?.full || null;
  },
  async getEncryptedThumb(id) {
    const row = await idbGet(this, id);
    return row?.thumb || null;
  },
  async getEncryptedOrig(id) {
    const row = await idbGet(this, id);
    return row?.orig || null;
  },
  async getMeta(id) {
    const row = await idbGet(this, id);
    return row?.meta || null;
  },
  // Лёгкий список того, что лежит в сторе (без чтения блобов) — для облачной
  // сверки. Из индекса, без похода в IndexedDB.
  async listIds() {
    return [...this._index.values()].map(({ id, hasFull, hasThumb, hasOrig }) => ({ id, hasFull, hasThumb, hasOrig }));
  },
  async delete(id) {
    await idbDelete(this, id);
    this._index.delete(id);
  },
  async all() {
    const rows = await idbGetAll(this);
    const result = [];
    for (const r of rows) {
      let full = null,
        thumb = null,
        orig = null;
      try {
        full = await decryptBlob(r.full);
      } catch (e) {}
      try {
        if (r.thumb) thumb = await decryptBlob(r.thumb);
      } catch (e) {}
      try {
        if (r.orig) orig = await decryptBlob(r.orig);
      } catch (e) {}
      result.push({ id: r.id, full, thumb, orig, meta: r.meta || {} });
    }
    return result;
  },
  async exportBlobs() {
    const rows = await idbGetAll(this);
    const out = [];
    for (const r of rows) {
      let fullB64 = null,
        thumbB64 = null,
        origB64 = null;
      try {
        if (r.full) fullB64 = b64(await decryptBlob(r.full));
      } catch (e) {}
      try {
        if (r.thumb) thumbB64 = b64(await decryptBlob(r.thumb));
      } catch (e) {}
      try {
        if (r.orig) origB64 = b64(await decryptBlob(r.orig));
      } catch (e) {}
      out.push({ id: r.id, full: fullB64, thumb: thumbB64, orig: origB64, meta: r.meta || {} });
    }
    return out;
  },
  async importBlobs(arr) {
    for (const item of arr) {
      if (!item.id || !item.full) continue;
      const fullU8 = unb64(item.full);
      const thumbU8 = item.thumb ? unb64(item.thumb) : null;
      const origU8 = item.orig ? unb64(item.orig) : null;
      const encFull = await encryptBlob(fullU8);
      const encThumb = thumbU8 ? await encryptBlob(thumbU8) : null;
      const encOrig = origU8 ? await encryptBlob(origU8) : null;
      const row = { id: item.id, full: encFull, thumb: encThumb, orig: encOrig, meta: item.meta || {} };
      await idbPut(this, row);
      this._index.set(item.id, indexEntry(row));
    }
  },
  async clear() {
    await idbClear(this);
    this._index.clear();
  },
  async migratePhotos(db) {
    return migratePhotosToStore(this, db);
  },
  // Счётчик места в настройках — из индекса (meta.size/оценка по длине
  // шифртекста), без расшифровки каждого блоба.
  async refreshSizes() {
    let total = 0;
    for (const e of this._index.values()) total += e.size;
    return { count: this._index.size, bytes: total };
  }
};

// ===== MemoryPhotoStore (для тестов и фолбэка) =====
const MemoryPhotoStore = {
  _map: new Map(),
  async init() {
    this._map.clear();
  },
  async put(id, fullBlob, thumbBlob, meta, origBlob) {
    const fullU8 = fullBlob instanceof Uint8Array ? fullBlob : await blobToU8(fullBlob);
    const thumbU8 = thumbBlob instanceof Uint8Array ? thumbBlob : thumbBlob ? await blobToU8(thumbBlob) : null;
    const origU8 = origBlob instanceof Uint8Array ? origBlob : origBlob ? await blobToU8(origBlob) : null;
    const encFull = await encryptBlob(fullU8);
    const encThumb = thumbU8 ? await encryptBlob(thumbU8) : null;
    const encOrig = origU8 ? await encryptBlob(origU8) : null;
    this._map.set(id, { id, full: encFull, thumb: encThumb, orig: encOrig, meta: meta || {} });
  },
  // Сохранение уже зашифрованных блобов (пришли из облака) — без повторного шифрования.
  async putEncrypted(id, encFull, encThumb, meta, encOrig) {
    this._map.set(id, { id, full: encFull, thumb: encThumb, orig: encOrig, meta: meta || {} });
  },
  async getFull(id) {
    const r = this._map.get(id);
    if (!r || !r.full) return null;
    const u8 = await decryptBlob(r.full);
    return u8ToBlob(u8, r.meta?.type || 'image/webp');
  },
  async getThumb(id) {
    const r = this._map.get(id);
    if (!r || !r.thumb) return null;
    const u8 = await decryptBlob(r.thumb);
    return u8ToBlob(u8, r.meta?.thumbType || 'image/webp');
  },
  async getOrig(id) {
    const r = this._map.get(id);
    if (!r || !r.orig) return null;
    const u8 = await decryptBlob(r.orig);
    return u8ToBlob(u8, r.meta?.origType || r.meta?.type || 'image/jpeg');
  },
  async getEncryptedFull(id) {
    const r = this._map.get(id);
    return r?.full || null;
  },
  async getEncryptedThumb(id) {
    const r = this._map.get(id);
    return r?.thumb || null;
  },
  async getEncryptedOrig(id) {
    const r = this._map.get(id);
    return r?.orig || null;
  },
  async getMeta(id) {
    const r = this._map.get(id);
    return r?.meta || null;
  },
  // Лёгкий список того, что лежит в сторе (без дешифровки) — для облачной сверки.
  async listIds() {
    return [...this._map.values()].map(r => ({ id: r.id, hasFull: !!r.full, hasThumb: !!r.thumb, hasOrig: !!r.orig }));
  },
  async delete(id) {
    this._map.delete(id);
  },
  async all() {
    const result = [];
    for (const r of this._map.values()) {
      let full = null,
        thumb = null,
        orig = null;
      try {
        full = await decryptBlob(r.full);
      } catch (e) {}
      try {
        if (r.thumb) thumb = await decryptBlob(r.thumb);
      } catch (e) {}
      try {
        if (r.orig) orig = await decryptBlob(r.orig);
      } catch (e) {}
      result.push({ id: r.id, full, thumb, orig, meta: r.meta || {} });
    }
    return result;
  },
  async exportBlobs() {
    const out = [];
    for (const r of this._map.values()) {
      let fullB64 = null,
        thumbB64 = null,
        origB64 = null;
      try {
        if (r.full) fullB64 = b64(await decryptBlob(r.full));
      } catch (e) {}
      try {
        if (r.thumb) thumbB64 = b64(await decryptBlob(r.thumb));
      } catch (e) {}
      try {
        if (r.orig) origB64 = b64(await decryptBlob(r.orig));
      } catch (e) {}
      out.push({ id: r.id, full: fullB64, thumb: thumbB64, orig: origB64, meta: r.meta || {} });
    }
    return out;
  },
  async importBlobs(arr) {
    for (const item of arr) {
      if (!item.id || !item.full) continue;
      const fullU8 = unb64(item.full);
      const thumbU8 = item.thumb ? unb64(item.thumb) : null;
      const encFull = await encryptBlob(fullU8);
      const encThumb = thumbU8 ? await encryptBlob(thumbU8) : null;
      const origU8 = item.orig ? unb64(item.orig) : null;
      const encOrig = origU8 ? await encryptBlob(origU8) : null;
      this._map.set(item.id, { id: item.id, full: encFull, thumb: encThumb, orig: encOrig, meta: item.meta || {} });
    }
  },
  async clear() {
    this._map.clear();
  },
  async migratePhotos(db) {
    return migratePhotosToStore(this, db);
  },
  async refreshSizes() {
    let total = 0;
    for (const r of this._map.values()) total += estimateSize(r);
    return { count: this._map.size, bytes: total };
  }
};

// Инициализация: выбираем бэкенд
async function initPhotoStore() {
  try {
    if (typeof indexedDB !== 'undefined') {
      await IDBPhotoStore.init();
      photoStore = IDBPhotoStore;
      return;
    }
  } catch (e) {
    console.warn('IndexedDB not available, using memory store', e);
  }
  await MemoryPhotoStore.init();
  photoStore = MemoryPhotoStore;
}

// Очистка при блокировке
function clearPhotoStore() {
  if (photoStore && photoStore._map) photoStore._map.clear();
  photoStore = null;
}

// ===== Вспомогательные функции для работы с фото =====

// Создание миниатюры (Canvas, ~256px по длинной стороне)
async function createThumbnail(img, maxDim = 256) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const scale = Math.min(maxDim / w, maxDim / h, 1);
  const tw = Math.round(w * scale);
  const th = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, tw, th);
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), 'image/webp', 0.82);
  });
}

// Доступен ли canvas для кодирования миниатюр (в песочнице тестов — нет).
function canDraw() {
  try {
    const cv = document.createElement('canvas');
    return !!(cv && cv.getContext && cv.getContext('2d'));
  } catch (e) {
    return false;
  }
}

// WebP-миниатюра из data-URL (Image + canvas). null, если браузер не умеет
// рисовать (canvas/Image недоступны) или картинка не загрузилась за 3 c.
async function makeThumbBlob(dataUrl, maxDim = 256) {
  if (!canDraw() || typeof Image === 'undefined') return null;
  return new Promise(resolve => {
    const img = new Image();
    let settled = false;
    const finish = b => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(b || null);
      }
    };
    const timer = setTimeout(() => finish(null), 3000);
    img.onload = () => {
      createThumbnail(img, maxDim)
        .then(finish)
        .catch(() => finish(null));
    };
    img.onerror = () => finish(null);
    img.src = dataUrl;
  });
}

// Простой EXIF-парсер (DateTimeOriginal / CreateDate)
async function extractExifDate(file) {
  const buf = await file.slice(0, 65536).arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0xff || u8[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < u8.length - 8) {
    if (u8[offset] !== 0xff) break;
    const marker = u8[offset + 1];
    if (marker === 0xe1) {
      const exifHeader = String.fromCharCode(...u8.slice(offset + 4, offset + 10));
      if (exifHeader === 'Exif\x00\x00') {
        const tiffStart = offset + 10;
        const isLE = u8[tiffStart] === 0x49;
        const read16 = off => (isLE ? u8[off] | (u8[off + 1] << 8) : (u8[off] << 8) | u8[off + 1]);
        const read32 = off => (isLE ? u8[off] | (u8[off + 1] << 8) | (u8[off + 2] << 16) | (u8[off + 3] << 24) : (u8[off] << 24) | (u8[off + 1] << 16) | (u8[off + 2] << 8) | u8[off + 3]);
        const ifd0Off = tiffStart + 4 + read32(tiffStart + 4);
        const numEntries = read16(ifd0Off);
        for (let i = 0; i < numEntries; i++) {
          const entryOff = ifd0Off + 2 + i * 12;
          const tag = read16(entryOff);
          if (tag === 0x9003 || tag === 0x9004) {
            const valOff = read32(entryOff + 8) + tiffStart + 4;
            const dateStr = String.fromCharCode(...u8.slice(valOff, valOff + 19));
            const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(dateStr);
            if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
          }
        }
      }
      break;
    }
    if (marker >= 0xe0 && marker <= 0xef) {
      const segLen = (u8[offset + 2] << 8) | u8[offset + 3];
      offset += 2 + segLen;
    } else break;
  }
  return null;
}

// Blob → data URL
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Кэш data-URL для миниатюр
const thumbCache = new Map();
function getThumbUrl(id) {
  return thumbCache.get(id) || null;
}
function setThumbUrl(id, url) {
  thumbCache.set(id, url);
}
function clearThumbCache() {
  thumbCache.clear();
}

// ===== Единый источник URL фото для рендеров =====
// Порядок: кэш → блоб в photoStore. Возвращает data-URL для <img>.
// useThumb=true (сетки/карточки) кэшируется в thumbCache (256px миниатюра);
// useThumb=false (светбокс) — в отдельном fullCache (показ-версия, ~900px).
// Раньше оба случая читали и писали ОДИН и тот же thumbCache независимо от
// useThumb — светбокс просил полный блоб (useThumb=false), но как только
// миниатюра уже была в кэше (а она почти всегда есть — грид её прогревает
// первым), photoUrl() тут же отдавал её и полный блоб не запрашивал вообще.
// Отсюда крошечная картинка в светбоксе и «размыливание» при зуме — на
// экран всегда шли те же 256px, что и в сетке, просто растянутые/увеличенные.
const fullCache = new Map();
async function photoUrl(p, useThumb = true) {
  if (!p) return '';
  const cache = useThumb ? thumbCache : fullCache;
  const cached = cache.get(p.id);
  if (cached) return cached;
  if (photoStore && p.id) {
    try {
      let blob = null;
      // Миниатюра могла не расшифроваться — не бросаем, падаем на полный блоб
      if (useThumb) {
        try {
          blob = await photoStore.getThumb(p.id);
        } catch (e) {}
      }
      if (!blob) blob = await photoStore.getFull(p.id);
      if (blob) {
        const url = await blobToDataUrl(blob);
        cache.set(p.id, url);
        return url;
      }
    } catch (e) {}
  }
  return '';
}
// Оригинал (максимальное качество) — только по требованию (зум в светбоксе,
// скачивание), не прогревается заранее: оригиналы могут весить мегабайты,
// незачем тянуть их для каждого открытого фото, если зум не понадобился.
const origCache = new Map();
async function photoOrigUrl(p) {
  if (!p) return '';
  const cached = origCache.get(p.id);
  if (cached) return cached;
  if (photoStore && p.id) {
    try {
      let blob = await photoStore.getOrig(p.id).catch(() => null);
      if (!blob) blob = await photoStore.getFull(p.id).catch(() => null);
      if (blob) {
        const url = await blobToDataUrl(blob);
        origCache.set(p.id, url);
        return url;
      }
    } catch (e) {}
  }
  return '';
}

// Синхронный превью-URL (для мгновенного каркаса): только кэш миниатюр.
// p.data в рендерах больше не используется — фото живёт в photoStore.
function photoSrc(p) {
  if (!p) return '';
  return getThumbUrl(p.id) || '';
}

// Прогрев кэша миниатюр после разблокировки — галерея рендерится мгновенно.
// Если миниатюры нет (старое фото при миграции), берём полный блоб.
// После завершения перерисовывает открытые вьюхи, чтобы подхватить URL из кэша.
async function warmThumbCache() {
  if (!photoStore || !db || !Array.isArray(db.photos)) return;
  for (const p of db.photos) {
    if (!p.id || getThumbUrl(p.id)) continue;
    try {
      let blob = null;
      try {
        blob = await photoStore.getThumb(p.id);
      } catch (e) {}
      if (!blob) blob = await photoStore.getFull(p.id);
      if (blob) {
        const url = await blobToDataUrl(blob);
        setThumbUrl(p.id, url);
      }
    } catch (e) {}
  }
  // Кэш прогрет — обновляем вьюхи, которые могли отрисоваться с пустым кэшем.
  // Раньше тут не было renderMemory()/renderWishlist() — если фото докачивалось,
  // пока пользователь уже на вкладке «Память» или «Хотелки», плейсхолдер
  // (<img data-photo-src>) так и оставался пустым до следующего захода на
  // вкладку: с виду «битая миниатюра», хотя реально просто не перерисовано.
  if (!authLocked) {
    renderHome();
    renderPhotos();
    renderCalendar();
    if (typeof renderMemory === 'function') renderMemory();
    if (typeof renderWishlist === 'function') renderWishlist();
  }
}

// Заполняет src у <img data-photo-src="id"> после рендера каркаса.
async function hydratePhotoImgs(scope) {
  if (!scope || !scope.querySelectorAll) return;
  const imgs = [...scope.querySelectorAll('img[data-photo-src]')];
  for (const im of imgs) {
    const id = im.dataset.photoSrc;
    // Фото хотелок не входят в db.photos (не показываются в общей галерее),
    // но живут в том же photoStore под своим id — ищем и там.
    const p = db.photos.find(x => x.id === id) || (Array.isArray(db.wishlist) && db.wishlist.find(w => w.photoId === id) ? { id } : null);
    const url = p ? await photoUrl(p, true) : '';
    if (url) {
      im.src = url;
      im.removeAttribute('data-photo-src'); // URL найден — больше не перечитываем
    }
    // URL не нашёлся (фото ещё качается из облака) — data-photo-src остаётся,
    // следующий hydratePhotoImgs после докачки подхватит его сам.
  }
}
