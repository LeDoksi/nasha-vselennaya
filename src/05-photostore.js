/* ===== Фото-хранилище: IndexedDB с шифрованием ===== */
// Два бэкенда: IDBPhotoStore (браузер) и MemoryPhotoStore (тесты/нет IndexedDB).
// Блобы шифруются мастер-ключом AES-GCM — нигде нет открытого текста.
// API: putPhoto(id, fullBlob, thumbBlob, meta) / getFull(id) / getThumb(id) / delete(id) / all() / exportBlobs() / importBlobs(arr)

let photoStore = null; // инициализируется при разблокировке

// ===== IndexedDB-бэкенд (браузер) =====
function openPhotoDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB not available')); return; }
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

// ===== IDBPhotoStore =====
const IDBPhotoStore = {
  db: null,
  async init() {
    this.db = await openPhotoDB();
  },
  async put(id, fullBlob, thumbBlob, meta) {
    const fullU8 = fullBlob instanceof Uint8Array ? fullBlob : await blobToU8(fullBlob);
    const thumbU8 = thumbBlob instanceof Uint8Array ? thumbBlob : (thumbBlob ? await blobToU8(thumbBlob) : null);
    const encFull = await encryptBlob(fullU8);
    const encThumb = thumbU8 ? await encryptBlob(thumbU8) : null;
    await idbPut(this, { id, full: encFull, thumb: encThumb, meta: meta || {} });
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
  async getMeta(id) {
    const row = await idbGet(this, id);
    return row?.meta || null;
  },
  async delete(id) {
    await idbDelete(this, id);
  },
  async all() {
    const rows = await idbGetAll(this);
    const result = [];
    for (const r of rows) {
      let full = null, thumb = null;
      try { full = await decryptBlob(r.full); } catch (e) {}
      try { if (r.thumb) thumb = await decryptBlob(r.thumb); } catch (e) {}
      result.push({ id, full, thumb, meta: r.meta || {} });
    }
    return result;
  },
  async exportBlobs() {
    const rows = await idbGetAll(this);
    const out = [];
    for (const r of rows) {
      let fullB64 = null, thumbB64 = null;
      try { if (r.full) fullB64 = b64(await decryptBlob(r.full)); } catch (e) {}
      try { if (r.thumb) thumbB64 = b64(await decryptBlob(r.thumb)); } catch (e) {}
      out.push({ id: r.id, full: fullB64, thumb: thumbB64, meta: r.meta || {} });
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
      await idbPut(this, { id: item.id, full: encFull, thumb: encThumb, meta: item.meta || {} });
        }
  },
  async clear() {
    await idbClear(this);
  }
};

// ===== MemoryPhotoStore (для тестов и фолбэка) =====
const MemoryPhotoStore = {
  _map: new Map(),
  async init() { this._map.clear(); },
  async put(id, fullBlob, thumbBlob, meta) {
    const fullU8 = fullBlob instanceof Uint8Array ? fullBlob : await blobToU8(fullBlob);
    const thumbU8 = thumbBlob instanceof Uint8Array ? thumbBlob : (thumbBlob ? await blobToU8(thumbBlob) : null);
    const encFull = await encryptBlob(fullU8);
    const encThumb = thumbU8 ? await encryptBlob(thumbU8) : null;
    this._map.set(id, { id, full: encFull, thumb: encThumb, meta: meta || {} });
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
  async getMeta(id) {
    const r = this._map.get(id);
    return r?.meta || null;
  },
    async delete(id) {
    this._map.delete(id);
  },
  async all() {
    const result = [];
    for (const r of this._map.values()) {
      let full = null, thumb = null;
      try { full = await decryptBlob(r.full); } catch (e) {}
      try { if (r.thumb) thumb = await decryptBlob(r.thumb); } catch (e) {}
      result.push({ id: r.id, full, thumb, meta: r.meta || {} });
    }
    return result;
  },
  async exportBlobs() {
    const out = [];
    for (const r of this._map.values()) {
      let fullB64 = null, thumbB64 = null;
      try { if (r.full) fullB64 = b64(await decryptBlob(r.full)); } catch (e) {}
      try { if (r.thumb) thumbB64 = b64(await decryptBlob(r.thumb)); } catch (e) {}
      out.push({ id: r.id, full: fullB64, thumb: thumbB64, meta: r.meta || {} });
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
      this._map.set(item.id, { id: item.id, full: encFull, thumb: encThumb, meta: item.meta || {} });
    }
  },
  async clear() {
    this._map.clear();
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
  } catch (e) { console.warn('IndexedDB not available, using memory store', e); }
  await MemoryPhotoStore.init();
  photoStore = MemoryPhotoStore;
}

// Очистка при блокировке
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

// Загрузка файла → WebP + миниатюра + EXIF-дата
async function processPhotoFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = async () => {
        let blob = null, type = 'image/webp';
        try {
          blob = await new Promise(res => img.toBlob ? img.toBlob(b => res(b), 'image/webp', 0.8) : res(null));
          if (!blob || blob.type !== 'image/webp') {
            blob = await new Promise(res => img.toBlob ? img.toBlob(b => res(b), 'image/jpeg', 0.82) : res(null));
            type = 'image/jpeg';
          }
        } catch (e) {
          blob = await new Promise(res => img.toBlob ? img.toBlob(b => res(b), 'image/jpeg', 0.82) : res(null));
          type = 'image/jpeg';
        }
        if (!blob) { reject(new Error('Failed to encode image')); return; }
        let thumbBlob = null;
        try { thumbBlob = await createThumbnail(img, 256); } catch (e) {}
        let takenAt = null;
        try { takenAt = await extractExifDate(file); } catch (e) {}
        resolve({ blob, thumbBlob, type, thumbType: thumbBlob?.type || 'image/webp', takenAt, width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Простой EXIF-парсер (DateTimeOriginal / CreateDate)
async function extractExifDate(file) {
  const buf = await file.slice(0, 65536).arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0xFF || u8[1] !== 0xD8) return null;
  let offset = 2;
  while (offset < u8.length - 8) {
    if (u8[offset] !== 0xFF) break;
    const marker = u8[offset + 1];
    if (marker === 0xE1) {
      const segLen = (u8[offset + 2] << 8) | u8[offset + 3];
      const exifHeader = String.fromCharCode(...u8.slice(offset + 4, offset + 10));
      if (exifHeader === 'Exif\x00\x00') {
        const tiffStart = offset + 10;
        const isLE = u8[tiffStart] === 0x49;
        const read16 = off => isLE ? u8[off] | (u8[off + 1] << 8) : (u8[off] << 8) | u8[off + 1];
        const read32 = off => isLE ? u8[off] | (u8[off + 1] << 8) | (u8[off + 2] << 16) | (u8[off + 3] << 24) : (u8[off] << 24) | (u8[off + 1] << 16) | (u8[off + 2] << 8) | u8[off + 3];
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
    if (marker >= 0xE0 && marker <= 0xEF) {
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
function getThumbUrl(id) { return thumbCache.get(id) || null; }
function setThumbUrl(id, url) { thumbCache.set(id, url); }
function clearThumbCache() { thumbCache.clear(); }