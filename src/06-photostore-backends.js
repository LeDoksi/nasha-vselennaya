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
