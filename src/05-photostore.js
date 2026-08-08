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
  return moved;
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
      result.push({ id: r.id, full, thumb, meta: r.meta || {} });
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
  },
  async migratePhotos(db) { return migratePhotosToStore(this, db); },
  async refreshSizes() {
    const rows = await idbGetAll(this);
    let total = 0;
    for (const r of rows) {
      try { total += (await decryptBlob(r.full)).byteLength; } catch (e) {}
    }
    return { count: rows.length, bytes: total };
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
  },
  async migratePhotos(db) { return migratePhotosToStore(this, db); },
  async refreshSizes() {
    let total = 0;
    for (const r of this._map.values()) {
      try { total += (await decryptBlob(r.full)).byteLength; } catch (e) {}
    }
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
  } catch (e) { console.warn('IndexedDB not available, using memory store', e); }
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
  } catch (e) { return false; }
}

// WebP-миниатюра из data-URL (Image + canvas). null, если браузер не умеет
// рисовать (canvas/Image недоступны) или картинка не загрузилась за 3 c.
async function makeThumbBlob(dataUrl, maxDim = 256) {
  if (!canDraw() || typeof Image === 'undefined') return null;
  return new Promise(resolve => {
    const img = new Image();
    let settled = false;
    const finish = b => { if (!settled) { settled = true; resolve(b || null); } };
    const timer = setTimeout(() => finish(null), 3000);
    img.onload = () => { createThumbnail(img, maxDim).then(finish).catch(() => finish(null)); };
    img.onerror = () => finish(null);
    img.src = dataUrl;
  });
}

// Загрузка файла → WebP (фолбэк JPEG) + миниатюра + EXIF-дата.
// Canvas недоступен (тесты/старые браузеры) → null: вызывающий код
// остаётся на старом пути readFile → dataUrlToBlob.
async function processPhotoFile(file) {
  if (!canDraw()) return null;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const img = await new Promise(resolve => {
    const i = new Image();
    let settled = false;
    const finish = v => { if (!settled) { settled = true; resolve(v || null); } };
    const timer = setTimeout(() => finish(null), 3000);
    i.onload = () => { clearTimeout(timer); finish(i); };
    i.onerror = () => finish(null);
    i.src = dataUrl;
  });
  if (!img) return null;
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const MAX = 1400;
  const k = Math.min(1, MAX / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const toBlob = (type, q) => new Promise(res => {
    try { canvas.toBlob(b => res(b), type, q); } catch (e) { res(null); }
  });
  let blob = await toBlob('image/webp', 0.8);
  let type = 'image/webp';
  if (!blob || blob.type !== 'image/webp') {
    blob = await toBlob('image/jpeg', 0.82);
    type = 'image/jpeg';
  }
  if (!blob) return null;
  let thumbBlob = null;
  try { thumbBlob = await createThumbnail(img, 256); } catch (e) {}
  let takenAt = null;
  try { takenAt = await extractExifDate(file); } catch (e) {}
  return { blob, thumbBlob, type, thumbType: (thumbBlob && thumbBlob.type) || 'image/webp', takenAt, width: w, height: h };
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

// ===== Единый источник URL фото для рендеров =====
// Порядок: кэш миниатюры → блоб в photoStore. Возвращает data-URL для <img>.
// Вызовы с одним id кэшируются в thumbCache.
async function photoUrl(p, useThumb = true) {
  if (!p) return '';
  const cached = getThumbUrl(p.id);
  if (cached) return cached;
  if (photoStore && p.id) {
    try {
      let blob = null;
      if (useThumb) blob = await photoStore.getThumb(p.id);
      if (!blob) blob = await photoStore.getFull(p.id);
      if (blob) {
        const url = await blobToDataUrl(blob);
        setThumbUrl(p.id, url);
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
      let blob = await photoStore.getThumb(p.id);
      if (!blob) blob = await photoStore.getFull(p.id);
      if (blob) {
        const url = await blobToDataUrl(blob);
        setThumbUrl(p.id, url);
      }
    } catch (e) {}
  }
  // Кэш прогрет — обновляем вьюхи, которые могли отрисоваться с пустым кэшем
  if (!authLocked) {
    renderHome();
    renderPhotos();
    renderCalendar();
  }
}

// Заполняет src у <img data-photo-src="id"> после рендера каркаса.
async function hydratePhotoImgs(scope) {
  if (!scope || !scope.querySelectorAll) return;
  const imgs = [...scope.querySelectorAll('img[data-photo-src]')];
  for (const im of imgs) {
    const id = im.dataset.photoSrc;
    const p = db.photos.find(x => x.id === id);
    const url = p ? await photoUrl(p, false) : '';
    if (url) im.src = url;
    im.removeAttribute('data-photo-src');
  }
}