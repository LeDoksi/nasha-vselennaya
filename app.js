/* ===== Наша вселенная — приложение =====
   app.js собирается из src/*.js: node build.js
   Порядок модулей: 00-core → 10-vault → … → 90-effects-init. */
'use strict';

const START_DATE = '2026-03-30';
const KEY = 'universe';

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const esc = s => String(s).replace(/[&<>"']/g, c => (
  {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
));
// Только настоящие http/https-ссылки; javascript:, data:html и прочее — в заглушку.
const safeUrl = u => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '#');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const isHidden = () => !!(document.hidden || document.visibilityState === 'hidden');

/* ===== Защита хранилища и глобальные ошибки =====
   localStorage умеет бросать исключения (переполнение ~5МБ, приватный режим) —
   все обращения идут через store, а сбои показываются ненавязчивым тостом. */
const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  set(key, val) {
    try { localStorage.setItem(key, val); return true; }
    catch (e) { notify('Хранилище переполнено — удали лишние фото и попробуй ещё раз 💜', true); return false; }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* не критично */ }
  }
};
let toastTimer = null;
function notify(msg, isError) {
  const t = $('#appToast');
  if (!t) return;
  t.textContent = msg;
  t.classList.toggle('toast-error', !!isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('error', e => notify('Что-то пошло не так — данные не потеряны, перезагрузи страницу 💜', true));
  window.addEventListener('unhandledrejection', () => notify('Не удалось сохранить — попробуй ещё раз 💜', true));
}

/* ===== Крипто-ядро (WebCrypto) =====
   Все данные зашифрованы мастер-ключом K (AES-GCM-256).
   K живёт только в памяти браузера.
   Для каждого пароля K «обёрнут» ключом, полученным из пароля через
   PBKDF2-SHA256 (~150k итераций). В localStorage лежит только
   зашифрованный «сейф» — прочитать его без пароля нельзя. */
const enc = new TextEncoder();
const dec = new TextDecoder();
const VAULT_KEY = 'universe_vault';      // зашифрованный сейф
const PBKDF2_ITERS = 150000;             // стойкость обёртки паролем
const AUTO_LOCK_MS = 30 * 60 * 1000;     // автозамок после 30 минут без действий

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function randBytes(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; }

async function pbkdf2Key(pass, salt, iters) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iters }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function aesEnc(key, bytes) {
  const iv = randBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { i: b64(iv), d: b64(ct) };
}
async function aesDec(key, blob) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.i) }, key, unb64(blob.d)));
}

/* ===== Схема данных и миграции ===== */
const DB_VERSION = 8;
const EVENT_LABEL = '📅 События'; // общий лейбл фото, прикреплённых к событиям
const DATE_LABEL = '💞 Свидания'; // общий лейбл фото, прикреплённых к свиданиям
function defaultDB() {
  return {
    version: DB_VERSION,
    events: [{ id: uid(), title: 'Мы начали встречаться', date: START_DATE, emoji: '💜', repeat: true }],
    notes: [], shopping: [], todos: [], photos: [], dates: [], lists: [],
    wishlist: [], labels: [], backupDate: null, moods: []
  };
}
// Миграции: аккуратно добавляем поля, которых ещё не было в старых версиях
function migrateDB(d) {
  const cur = defaultDB();
  for (const k of Object.keys(cur)) {
    if (!(k in d)) d[k] = cur[k]; // событие «Мы начали встречаться» не дублируем, если есть
  }
  // v3: у фото вместо одного альбома — несколько лейблов
  if (!Array.isArray(d.labels)) d.labels = [];
  for (const p of (d.photos || [])) {
    if (!Array.isArray(p.labels)) p.labels = p.album ? [p.album] : [];
  }
  const set = new Set(d.labels);
  for (const p of (d.photos || [])) for (const l of (p.labels || [])) set.add(l);
  d.labels = [...set];
  // v4: фото событий — общий лейбл «📅 События» вместо отдельного лейбла-названия
  relabelEventPhotos(d);
  // v5: у заметок появляется порядок для drag&drop (старые — по закреплению и времени)
  if (!Array.isArray(d.notes)) d.notes = [];
  if (d.notes.some(n => n.order === undefined)) {
    [...d.notes].sort((a, b) => (b.pinned - a.pinned) || (b.ts - a.ts)).forEach((n, i) => {
      if (n.order === undefined) n.order = i;
    });
  }
  // v8: произвольные списки. Старые «Покупки» и «Дела» становятся обычными списками,
  // легаси-поля очищаются (данные перенесены в db.lists).
  if (!Array.isArray(d.lists)) d.lists = [];
  if ((Array.isArray(d.shopping) && d.shopping.length) || (Array.isArray(d.todos) && d.todos.length)) {
    const legacy = [];
    if (Array.isArray(d.shopping) && d.shopping.length) legacy.push({ id: uid(), name: '🛒 Покупки', items: d.shopping });
    if (Array.isArray(d.todos) && d.todos.length) legacy.push({ id: uid(), name: '✅ Дела', items: d.todos });
    d.lists = legacy.concat(d.lists);
    d.shopping = []; d.todos = [];
  }
  d.version = DB_VERSION;
  return d;
}
// Фото, прикреплённые к событиям (ev.photos), подписываем общим лейблом «📅 События».
// Старые авто-лейблы с названием события убираем — за название отвечает title фото.
// Поддерживает ev.photos как data-URL (старые версии) так и id фото (v6+).
function relabelEventPhotos(d) {
  if (!Array.isArray(d.photos) || !Array.isArray(d.events)) return;
  let found = false;
  for (const ev of d.events) {
    if (!Array.isArray(ev.photos)) continue;
    for (const data of ev.photos) {
      const isUrl = typeof data === 'string' && data.startsWith('data:');
      const p = d.photos.find(x => isUrl ? x.data === data : x.id === data);
      if (!p) continue;
      if (!Array.isArray(p.labels)) p.labels = [];
      if (!p.labels.includes(EVENT_LABEL)) p.labels.push(EVENT_LABEL);
      if (ev.title && p.labels.includes(ev.title)) p.labels = p.labels.filter(l => l !== ev.title);
      found = true;
    }
  }
  if (found && !d.labels.includes(EVENT_LABEL)) d.labels.push(EVENT_LABEL);
}

/* ===== Состояние сессии — только в памяти, в localStorage не пишется ===== */
let masterKey = null;      // мастер-ключ K — никуда не записывается
let currentUser = null;    // кто вошёл (gosha/dasha)
let db = defaultDB();
let authLocked = true;     // пока замок закрыт — приложение невидимо
let lastActivity = Date.now();

function getUser() { return currentUser || 'gosha'; }
function setUser(u) { currentUser = u; renderUserChip(); renderHome(); renderCalendar(); }
function renderUserChip() {
  const chip = $('#userChip');
  if (chip) chip.textContent = getUser() === 'dasha' ? '👧 Даша ▾' : '👦 Гоша ▾';
}

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
/* ===== Хранилище ===== */
function legacyDB() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultDB();
    const d = JSON.parse(raw);
    return { ...defaultDB(), ...migrateDB(d) };
  } catch (e) { return defaultDB(); }
}
function loadVault() {
  try { return JSON.parse(localStorage.getItem(VAULT_KEY)); } catch (e) { return null; }
}
// Сохранение всегда идёт через шифрование; очередь снимков не даёт
// гонке записать более старый снимок поверх свежего.
let saveChain = Promise.resolve();
function save() {
  if (!masterKey) return Promise.resolve();
  const snap = JSON.stringify(db);
  saveChain = saveChain.then(async () => {
    const vault = loadVault();
    if (!vault) return;
    vault.db = await aesEnc(masterKey, enc.encode(snap));
    try { localStorage.setItem(VAULT_KEY, JSON.stringify(vault)); }
    catch (e) { alert('Хранилище переполнено — удали лишние фото и попробуй ещё раз 💜'); }
  });
  return saveChain;
}

/* ===== Создание сейфа, вход, пароли ===== */
async function createVault(who, pass, legacyDb) {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const kraw = new Uint8Array(await crypto.subtle.exportKey('raw', masterKey));
  db = migrateDB({ ...defaultDB(), ...(legacyDb || legacyDB()) });
  await initPhotoStore(); // гарантируем бэкенд (в тестах — память)
  await photoStore.migratePhotos(db);
  await photoStore.refreshSizes();
  warmThumbCache(); // миниатюры в кэш — галерея рендерится без ожидания
  const dbBlob = await aesEnc(masterKey, enc.encode(JSON.stringify(db)));
  const salt = randBytes(16);
  const pwdKey = await pbkdf2Key(pass, salt, PBKDF2_ITERS);
  const wrap = { who, s: b64(salt), ...(await aesEnc(pwdKey, kraw)) };
  if (!store.set(VAULT_KEY, JSON.stringify({ ver: 1, a: PBKDF2_ITERS, db: dbBlob, keys: [wrap] }))) return false;
  store.remove(KEY); // старый открытый файл больше не нужен — всё уже зашифровано
  currentUser = who;
  return true;
}
async function unlockWith(who, pass) {
  const vault = loadVault();
  if (!vault) return false;
  const wrap = (vault.keys || []).find(k => k.who === who);
  if (!wrap) return false;
  try {
    const pwdKey = await pbkdf2Key(pass, unb64(wrap.s), vault.a || PBKDF2_ITERS);
    const kraw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(wrap.i) }, pwdKey, unb64(wrap.d)));
        masterKey = await crypto.subtle.importKey('raw', kraw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    currentUser = who;
    const raw = await aesDec(masterKey, vault.db);
    db = migrateDB({ ...defaultDB(), ...JSON.parse(dec.decode(raw)) });
    await initPhotoStore(); // гарантируем бэкенд (в тестах — память)
    await photoStore.migratePhotos(db);
    await photoStore.refreshSizes();
    warmThumbCache(); // миниатюры в кэш — галерея рендерится без ожидания
    try { await save(); } catch (e) { console.warn('Не удалось закрепить миграцию', e); } // p.data убран, ссылки событий на id
    unlockApp();
    return true;
  } catch (e) { return false; }
}
async function savePassFor(who, pass) {
  const vault = loadVault();
  if (!vault || !masterKey) return false;
  const kraw = new Uint8Array(await crypto.subtle.exportKey('raw', masterKey));
  const salt = randBytes(16);
  const pwdKey = await pbkdf2Key(pass, salt, vault.a || PBKDF2_ITERS);
  const wrap = { who, s: b64(salt), ...(await aesEnc(pwdKey, kraw)) };
  vault.keys = (vault.keys || []).filter(x => x.who !== who).concat(wrap);
  try { localStorage.setItem(VAULT_KEY, JSON.stringify(vault)); return true; } catch (e) { return false; }
}
async function changePass(cur, next) {
  const vault = loadVault();
  if (!vault || !masterKey || !currentUser) return false;
  const wrap = (vault.keys || []).find(k => k.who === currentUser);
  if (!wrap) return false;
  try {
    const pwdKey = await pbkdf2Key(cur, unb64(wrap.s), vault.a || PBKDF2_ITERS);
    const kraw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(wrap.i) }, pwdKey, unb64(wrap.d)));
    const newSalt = randBytes(16);
    const nk = await pbkdf2Key(next, newSalt, vault.a || PBKDF2_ITERS);
    vault.keys = await Promise.all(vault.keys.map(async x => x.who === currentUser ? { who: currentUser, s: b64(newSalt), ...(await aesEnc(nk, kraw)) } : x));
    try { localStorage.setItem(VAULT_KEY, JSON.stringify(vault)); return true; } catch (e) { return false; }
  } catch (e) { return false; }
}

/* ===== Замок: экраны входа и создания ===== */
function showAuth(which) {
  $('#lockScreen').hidden = which !== 'lock';
  $('#setupScreen').hidden = which !== 'setup';
}
function unlockApp() {
  authLocked = false;
  document.body.classList.remove('auth');
  $('#authPass').value = '';
  $('#authErr').textContent = '';
  renderUserChip();
  setTheme(getTheme());
  renderSettings();
  go('home');
  lastActivity = Date.now();
  startAutoLock();
}
function lock() {
  if (!masterKey) return; // уже закрыто
  masterKey = null;
  currentUser = null;
  db = defaultDB();
  clearPhotoStore();
  clearThumbCache();
  countdownTarget = null;
  authLocked = true;
  document.body.classList.add('auth');
  showAuth('lock');
  renderAuthWho();
  $('#authPass').value = '';
  $('#authErr').textContent = '';
}
function isLocked() { return authLocked; }

let pendingAuthWho = 'gosha';
function renderAuthWho() {
  $$('.auth-user').forEach(b => b.classList.toggle('auth-on', b.dataset.authWho === pendingAuthWho));
  const lbl = $('#authWhoLabel');
  if (lbl) lbl.textContent = pendingAuthWho === 'dasha' ? '👧 Даша' : '👦 Гоша';
}
async function tryUnlock() {
  const err = $('#authErr');
  const vault = loadVault();
  const hasPass = !!(vault && (vault.keys || []).some(k => k.who === pendingAuthWho));
  if (!hasPass) {
    if (err) err.textContent = 'Пароль для этого человека ещё не создан. Добавь его в настройках — или войди другим.';
    return;
  }
  const ok = await unlockWith(pendingAuthWho, $('#authPass').value);
  if (!ok && err) err.textContent = 'Неверный пароль. Попробуй ещё раз 💜';
}
async function doSetup() {
  const err = $('#setupErr');
  const who = $('#setupWho').value;
  const p1 = $('#setupPass').value;
  const p2 = $('#setupPass2').value;
  if (p1.length < 6) { if (err) err.textContent = 'Пароль должен быть не короче 6 символов.'; return; }
  if (p1 !== p2) { if (err) err.textContent = 'Пароли не совпадают — проверь ещё раз.'; return; }
  await createVault(who, p1);
  unlockApp();
}

/* ===== Автозамок ===== */
let autoLockTimer = null;
function startAutoLock() {
  if (autoLockTimer) return;
  ['click', 'keydown', 'pointerdown', 'scroll', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
  autoLockTimer = setInterval(() => {
    if (isHidden() || !masterKey) return;
    if (Date.now() - lastActivity > AUTO_LOCK_MS) lock();
  }, 60000);
}

/* ===== Кнопки экранов входа ===== */
$('#authGo').addEventListener('click', tryUnlock);
$('#authPass').addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
$('#setupGo').addEventListener('click', doSetup);
$('#setupPass2').addEventListener('keydown', e => { if (e.key === 'Enter') doSetup(); });
document.addEventListener('click', e => {
  const au = e.target.closest('[data-auth-who]');
  if (au) {
    pendingAuthWho = au.dataset.authWho;
    renderAuthWho();
    const p = $('#authPass');
    if (p && p.focus) p.focus();
    return;
  }
});
renderAuthWho();

/* ===== Тема ===== */
const THEME_KEY = 'universe_theme';
function getTheme() {
  const saved = store.get(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  // первый запуск — уважаем системную тему (переключается кнопкой в любой момент)
  try {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch (e) {}
  return 'light';
}
function setTheme(t) {
  try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  const root = document.documentElement;
  if (root) root.dataset.theme = t;
  const btn = $('#themeToggle');
  if (btn) { btn.textContent = t === 'dark' ? '☀️' : '🌙'; btn.setAttribute('aria-pressed', String(t === 'dark')); }
  const sbtn = $('#settingsThemeBtn');
  if (sbtn) sbtn.textContent = t === 'dark' ? '☀️ Включить светлую тему' : '🌙 Включить тёмную тему';
}
function toggleTheme() { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); }

/* ===== Навигация ===== */
let activeView = 'home'; // текущая вкладка — для hash-роутинга и кнопки «назад»
function showView(view) {
  if (!$('#view-' + view)) return; // неизвестная вкладка — не трогаем экран
  activeView = view;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'home') renderHome();
  if (view === 'calendar') { calY = new Date().getFullYear(); calM = new Date().getMonth(); selectedDate = null; renderCalendar(); }
  if (view === 'notes') renderNotes();
  if (view === 'lists') renderLists();
  if (view === 'wishlist') renderWishlist();
  if (view === 'photos') renderPhotos();
  if (view === 'memory') renderMemory();
  if (view === 'settings') renderSettings();
}
function go(view) {
  showView(view);
  // hash-роутинг: #/view — кнопка «назад» в браузере и прямые ссылки на вкладку.
  // location нет в песочнице тестов — там остаёмся на синхронном показе.
  if (typeof location !== 'undefined' && location.hash !== '#/' + view) {
    try { location.hash = '#/' + view; } catch (e) {}
  }
}
function hashView() {
  if (typeof location === 'undefined') return '';
  const m = /^#\/([a-z]+)/.exec(location.hash || '');
  return m ? m[1] : '';
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('hashchange', () => {
    const v = hashView();
    if (v && v !== activeView && $('#view-' + v)) showView(v);
  });
  // Открытие по ссылке вида index.html#/notes — сразу показываем нужную вкладку.
  // '#/home' не трогаем: главная активна по умолчанию в разметке.
  const initial = hashView();
  if (initial && initial !== 'home' && $('#view-' + initial)) showView(initial);
}
$$('.nav-btn').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));

/* ===== Главная: счётчик дней ===== */
function daysTogether() {
  const [y, m, d] = START_DATE.split('-').map(Number);
  const a = new Date(y, m - 1, d);
  const b = new Date();
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const now = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((now - start) / 86400000);
}
function nextOcc(ev) {
  const [y, m, d] = ev.date.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let c = new Date(y, m - 1, d);
  if (ev.repeat) {
    while (c < today) c.setFullYear(c.getFullYear() + 1);
    // 29 февраля в невисокосный год «переезжает» на 1 марта — возвращаем к 28 февраля
    if (m === 2 && d === 29 && c.getMonth() === 2 && c.getDate() === 1) c.setDate(0);
  }
  return c;
}
function renderHome() {
  $('#daysCount').textContent = daysTogether();
  const now0 = new Date();
  now0.setHours(0, 0, 0, 0);
  const rem = db.events
    .map(ev => ({ ev, days: Math.round((nextOcc(ev) - now0) / 86400000) }))
    .filter(o => o.days >= 0 && o.days <= 14)
    .sort((a, b) => a.days - b.days);

  // Напоминания убраны: ближайшее событие и так видно на таймере (#countdown).
  renderDates();
  renderCompliment();
  renderCountdown();
  renderMobilePhotos();
  // Фаза B: кольцо прогресса (в блоке — коллаж фото, события «в этот день», статистика)
  renderProgressRing();
  // Фото с data-photo-src (кэш миниатюр не прогрет) — заполняем src асинхронно
  hydratePhotoImgs($('#mobilePhotosGrid'));
  hydratePhotoImgs($('#progressRing'));
  maybeCelebrateAnniversary(rem);
}

/* ===== Комплимент дня ===== */
const COMPLIMENTS = [
  'Ты — самое тёплое, что случилось в моей жизни 💜',
  'Твоя улыбка делает мой день лучше. Всегда.',
  'Я люблю тебя больше, чем вчера. Но меньше, чем завтра.',
  'С тобой даже обычный день становится праздником ✨',
  'Ты красивее всех звёзд на небе, серьёзно.',
  'Мне нравится просыпаться и знать, что ты есть.',
  'Ты — мой самый любимый человек на свете.',
  'Спасибо, что ты рядом. Это бесценно 💜',
  'Твои глаза — мой любимый цвет.',
  'Я скучаю по тебе даже когда ты рядом.',
  'Ты делаешь меня лучше — просто тем, что ты есть.',
  'Каждый день с тобой — как маленькое чудо.',
  'Ты — моё любимое «доброе утро».',
  'С тобой уютно даже в самый шумный день.',
  'Твоя нежность — моё любимое место.',
  'Я выбрал(а) бы тебя снова. В любой жизни.',
  'Ты — причина моей самой глупой и счастливой улыбки.',
  'Мне хорошо просто потому, что ты существуешь.',
  'Ты — мой человек. Навсегда.',
  'Помни: ты невероятная(ый), а я рядом, чтобы напоминать 💜'
];
function renderCompliment() {
  const box = $('#compliment');
  if (!box) return;
  const key = new Date().toDateString(); // один и тот же комплимент весь день
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  box.innerHTML = `<div class="compliment-card">
    <h4>💌 Комплимент дня</h4>
    <div class="compliment-text">${esc(COMPLIMENTS[h % COMPLIMENTS.length])}</div>
  </div>`;
}

/* ===== Таймер до события ===== */
let countdownTarget = null;
function nextTarget() {
  const now = Date.now();
  let best = null, bestT = Infinity;
  const trySet = (t, obj) => { if (t > now && t < bestT) { bestT = t; best = { ...obj, t }; } };
  for (const ev of db.events) trySet(nextOcc(ev).getTime(), { title: ev.title, emoji: ev.emoji || '💜' });
  for (const dt of db.dates) {
    if (dt.done) continue;
    const [y, m, dd] = dt.date.split('-').map(Number);
    const [hh = 0, mm = 0] = dt.time ? dt.time.split(':').map(Number) : [0, 0];
    trySet(new Date(y, m - 1, dd, hh, mm).getTime(), { title: (dt.place || 'Свидание') + (dt.note ? ' — ' + dt.note : ''), emoji: dt.emoji || '💘' });
  }
  return best;
}
function renderCountdown() {
  const box = $('#countdown');
  if (!box) return;
  const n = nextTarget();
  if (!n) { box.hidden = true; box.innerHTML = ''; countdownTarget = null; return; }
  countdownTarget = n.t;
  box.hidden = false;
  box.innerHTML = `<div class="compliment-card">
    <h4>${esc(n.emoji)} До «${esc(n.title)}» осталось</h4>
    <div class="countdown-time" id="countdownTick">…</div>
  </div>`;
  tickCountdown();
}
function tickCountdown() {
  const el = $('#countdownTick');
  if (!el || countdownTarget == null) return;
  if (countdownTarget - Date.now() <= 0) { renderCountdown(); return; } // цель наступила — сразу берём следующую
  const left = countdownTarget - Date.now();
  const s = Math.floor(left / 1000);
  const dd = Math.floor(s / 86400), hh = Math.floor(s % 86400 / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
  const p = n => String(n).padStart(2, '0');
  el.textContent = dd > 0 ? `${dd} дн. ${p(hh)}:${p(mm)}:${p(ss)}` : `${p(hh)}:${p(mm)}:${p(ss)}`;
}
setInterval(() => { if (!isHidden()) tickCountdown(); }, 1000);

/* ===== Конфетти ===== */
function celebrate() {
  if (motionReduced()) return; // конфетти — декоративное движение, при reduced-motion пропускаем
  const emojis = ['💜', '💖', '✨', '🎉', '🌸', '💞'];
  for (let i = 0; i < 36; i++) {
    const c = document.createElement('span');
    c.className = 'confetti';
    c.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    c.style.left = Math.random() * 100 + 'vw';
    c.style.fontSize = (14 + Math.random() * 18) + 'px';
    c.style.top = '-20px';
    c.style.animationDuration = (2.2 + Math.random() * 2.4) + 's';
    c.style.animationDelay = (Math.random() * 0.7) + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 6000);
  }
}
function maybeCelebrateAnniversary(rem) {
  if (!rem.some(r => r.days === 0)) return;
  try {
    const day = new Date().toDateString();
    if (sessionStorage.getItem('uni_celebrated:' + day)) return;
    sessionStorage.setItem('uni_celebrated:' + day, '1');
    celebrate(); // сегодня важный день — салют!
  } catch (e) {}
}

/* ===== Фото на телефоне (горизонтальная лента) ===== */
function renderMobilePhotos() {
  const grid = $('#mobilePhotosGrid');
  if (!grid) return;
  grid.innerHTML = [...db.photos].sort(photoSort).slice(0, 12).map(p => {
    const url = photoSrc(p);
    return url
      ? `<img src="${esc(url)}" alt="${esc(p.title)}" data-photo="${esc(p.id)}" loading="lazy">`
      : `<img data-photo-src="${esc(p.id)}" alt="${esc(p.title)}" loading="lazy">`;
  }).join('');
}

/* ===== Свидания ===== */
// datesOn: показывает ВСЕ свидания (включая done) для календаря и памяти
function datesOn(dateStr) {
  return db.dates.filter(d => d.date === dateStr);
}
function fmtDateLong(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
}
function fmtResp(r) {
  return r === 'yes' ? '✅ да' : r === 'no' ? '❌ нет' : '⏳ ещё не решил';
}
function renderDates() {
  const box = $('#dates');
  if (!db.dates.length) {
    box.innerHTML = '<div class="dates-empty">💘 Свиданий пока нет.<br>Нажми «Назначить свидание» — и пусть оно обязательно случится!</div>';
    return;
  }
  const now0 = new Date();
  now0.setHours(0, 0, 0, 0);
  const list = db.dates
    .map(d => {
      const [y, m, dd] = d.date.split('-').map(Number);
      const when = new Date(y, m - 1, dd);
      return { d, when, days: Math.round((when - now0) / 86400000) };
    })
    .filter(o => o.days >= 0 && !o.d.done)
    .sort((a, b) => a.when - b.when || (a.d.time || '').localeCompare(b.d.time || ''))
    .slice(0, 8);
  box.innerHTML = '<h3>💘 Наши свидания</h3>' +
    (list.length ? list.map(o => {
      const d = o.d;
      const who = getUser();
      const resp = d.responses || {};
      const from = d.from;
      // Пригласивший уже согласился — ему кнопки «Да/Нет» не нужны
      const status = p => from === p
        ? (p === 'gosha' ? '💌 позвал' : '💌 позвала')
        : fmtResp(resp[p]);
      const canAnswer = !from || from === 'both' || from !== who;
      const bothYes = resp.gosha === 'yes' && resp.dasha === 'yes';
      const whenTag = o.days === 0
        ? '<span class="tag tag-today">сегодня</span>'
        : o.days === 1 ? '<span class="tag">завтра</span>' : '';
      return `<div class="date-card">
        <div class="date-emoji">${esc(d.emoji || '💘')}</div>
        <div class="date-info">
          <b>${fmtDateLong(d.date)}${whenTag}</b>
          ${from ? `<span class="date-from">${from === 'both' ? '💜 вместе' : from === 'gosha' ? '💌 приглашение от Гоши' : '💌 приглашение от Даши'}</span>` : ''}
          ${d.time ? `<span>🕐 ${esc(d.time)}</span>` : ''}
          ${d.place ? `<span>📍 ${esc(d.place)}</span>` : ''}
          ${d.note ? `<span>💬 ${esc(d.note)}</span>` : ''}
        </div>
        <div class="date-side">
          <div class="resp-row">
            <span class="${who === 'gosha' ? 'resp-me' : ''}">Гоша: ${status('gosha')}</span>
            <span class="${who === 'dasha' ? 'resp-me' : ''}">Даша: ${status('dasha')}</span>
          </div>
          ${bothYes ? '<div class="both-yes">💞 Мы идём на свидание!</div>' : ''}
          ${canAnswer ? `<div class="resp-btns">
            <button class="resp-btn ${resp[who] === 'yes' ? 'on' : ''}" data-answer-date="${d.id}" data-answer="yes">Да 👍</button>
            <button class="resp-btn no ${resp[who] === 'no' ? 'on' : ''}" data-answer-date="${d.id}" data-answer="no">Нет 👎</button>
          </div>` : ''}
          <div class="date-btns">
            <button class="mini-x" data-done-date="${d.id}" title="Свидание прошло">💗</button>
            <button class="mini-x" data-del-date="${d.id}" title="Удалить">✕</button>
          </div>
        </div>
      </div>`;
    }).join('') : '<p class="cal-tip">Ближайших свиданий пока нет. Самое время назначить новое! ✨</p>');
}
function openDateModal() {
  const t = new Date();
  $('#dtDate').value = iso(t.getFullYear(), t.getMonth(), t.getDate());
  $('#dtTime').value = '19:00';
  $('#dtPlace').value = '';
  $('#dtNote').value = '';
  $('#dtEmoji').value = '💘';
  $('#dateOverlay').hidden = false;
}
$('#addDateBtn').addEventListener('click', openDateModal);
// Свидание всегда от имени вошедшего — выбора «кто приглашает» нет.
function saveDateFromModal() {
  const date = $('#dtDate').value;
  if (!date) { alert('Выбери дату свидания 💘'); return; }
  db.dates.push({
    id: uid(), date, time: $('#dtTime').value,
    from: getUser(), responses: { gosha: null, dasha: null },
    place: $('#dtPlace').value.trim(), note: $('#dtNote').value.trim(),
    emoji: $('#dtEmoji').value.trim() || '💘', done: false
  });
  save(); $('#dateOverlay').hidden = true;
  renderHome(); renderCalendar();
}
$('#dtSave').addEventListener('click', saveDateFromModal);

/* ===== Коллаж «Наша история»: фото «в этот день» + случайные, с асимметрией ===== */
// Фото живут внутри блока «Наша история» (#progressRing): разный размер,
// поворот и вертикальный сдвиг — без ровных рядов. В приоритете — фото
// «в этот день» из прошлых лет (EXIF/дата события/свидания), остальные
// слоты заполняются случайными. Выбор стабилен в течение дня (seed по дате);
// кнопка «🎲 Перемешать» меняет коллаж вручную, но тоже фиксирует его до конца дня.
const HISTORY_PHOTO_SLOTS = [
  { st: 'left:1%; top:16%; width:84px; height:84px; rotate:-7deg',  dur: 6.4, delay: 0 },
  { st: 'left:29%; top:5%; width:100px; height:100px; rotate:5deg', dur: 5.8, delay: 0.6 },
  { st: 'left:58%; top:24%; width:72px; height:72px; rotate:-3deg', dur: 6.9, delay: 1.2 }
];
function daySeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Фото «в этот день» из прошлых лет (по EXIF или дате события/свидания)
function onThisDayPhotos(at) {
  return onThisDayItems(at).filter(it => it.kind === 'photo' && it.p).map(it => it.p);
}
// Зафиксированный на день выбор коллажа {day, sig, ids}; ручной перемес живёт до полуночи.
// sig — сигнатура состава галереи: при добавлении/удалении фото коллаж пересобирается.
let historyCollage = null;
function photoSignature() {
  return [...db.photos].map(p => p.id).sort().join(',');
}
function shufflePick(photos, rnd) {
  for (let i = photos.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [photos[i], photos[j]] = [photos[j], photos[i]];
  }
}
// «В этот день» встают первыми (до 3 слотов), остальные — случайные из перетасованного списка
function pinOnThisDay(photos, n, at) {
  const picks = [];
  const otd = onThisDayPhotos(at);
  for (const p of otd) { if (picks.length >= n) break; if (!picks.includes(p)) picks.push(p); }
  for (const p of photos) { if (picks.length >= n) break; if (!picks.includes(p)) picks.push(p); }
  return picks;
}
function pickHistoryPhotos(at) {
  const dayStr = (at || new Date()).toDateString();
  const sig = photoSignature();
  if (historyCollage && historyCollage.day === dayStr && historyCollage.sig === sig) {
    const byId = new Map(db.photos.map(p => [p.id, p]));
    return historyCollage.ids.map(id => byId.get(id)).filter(Boolean);
  }
  const photos = [...db.photos];
  const n = Math.min(HISTORY_PHOTO_SLOTS.length, photos.length);
  shufflePick(photos, mulberry32(daySeed(dayStr) + n * 7919));
  const picks = pinOnThisDay(photos, n, at);
  historyCollage = { day: dayStr, sig, ids: picks.map(p => p.id) };
  return picks;
}
// «🎲 Перемешать коллаж» — заново тасует случайную часть; фото «в этот день» остаются
function shuffleHistoryPhotos() {
  const photos = [...db.photos];
  const n = Math.min(HISTORY_PHOTO_SLOTS.length, photos.length);
  shufflePick(photos, mulberry32((Math.random() * 0xffffffff) >>> 0));
  const picks = pinOnThisDay(photos, n);
  historyCollage = { day: new Date().toDateString(), sig: photoSignature(), ids: picks.map(p => p.id) };
  renderProgressRing();
  hydratePhotoImgs($('#progressRing'));
}
function historyPhotosHtml(at) {
  const picks = pickHistoryPhotos(at);
  const otdIds = new Set(onThisDayPhotos(at).map(p => p.id));
  const badge = picks.some(p => otdIds.has(p.id)) ? '<span class="hp-badge">✨ В этот день</span>' : '';
  return badge + picks.map((p, i) => {
    const s = HISTORY_PHOTO_SLOTS[i];
    const url = photoSrc(p); // кэш миниатюр может быть не прогрет — ставим fallback
    return '<img class="history-photo" data-photo="' + esc(p.id) + '" alt="' + esc(p.title || '') + '"' +
      (url ? ' src="' + esc(url) + '"' : ' data-photo-src="' + esc(p.id) + '"') +
      ' style="' + s.st + 'animation-duration:' + s.dur + 's;animation-delay:' + s.delay + 's" loading="lazy">';
  }).join('');
}
// Делегирование: innerHTML #progressRing перерисовывается на каждом рендере
$('#progressRing').addEventListener('click', e => {
  if (e.target.closest && e.target.closest('#shuffleHistoryBtn')) shuffleHistoryPhotos();
});
$('#progressRing').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('#shuffleHistoryBtn')) {
    e.preventDefault(); shuffleHistoryPhotos();
  }
});

/* ===== Фаза B: «В этот день», кольцо отношений, трекер настроения, лента «Память» =====
   Решение 07.08.2026: дата фото для «В этот день» — ТОЛЬКО EXIF (p.takenAt)
   ИЛИ дата события/свидания, к которому фото привязано. Если есть только дата
   загрузки (p.ts) — фото НЕ показывается. В «Памяти» фото, привязанные к
   событию/свиданию, живут только в их карточках (без дублей в сетке дня). */

function isoFromMs(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : iso(d.getFullYear(), d.getMonth(), d.getDate());
}

function photoTitle(p) { return (p && p.title) || 'Фото'; }

// Дата фото для «В этот день»: EXIF-дата снимка, дата события или дата свидания (самое раннее).
// Дата загрузки здесь сознательно НЕ используется.
function photoDate(p) {
  if (!p) return null;
  if (p.takenAt) { const s = isoFromMs(p.takenAt); if (s) return s; }
  let best = null;
  if (Array.isArray(db.events)) {
    for (const ev of db.events) {
      if (!Array.isArray(ev.photos) || !ev.photos.includes(p.id) || !ev.date) continue;
      if (!best || ev.date < best) best = ev.date;
    }
  }
  if (Array.isArray(db.dates)) {
    for (const dt of db.dates) {
      if (!Array.isArray(dt.photos) || !dt.photos.includes(p.id) || !dt.date) continue;
      if (!best || dt.date < best) best = dt.date;
    }
  }
  return best || null;
}

/* ===== «В этот день» ===== */
function onThisDayItems(at) {
  const now = at || new Date();
  const yNow = now.getFullYear();
  const items = [];
  const isThisDay = dt => !!dt && dt.getFullYear() < yNow && dt.getMonth() === now.getMonth() && dt.getDate() === now.getDate();
  for (const ev of db.events) {
    const dt = parseLocalIso(ev.date);
    if (isThisDay(dt)) items.push({ kind: 'event', date: ev.date, emoji: ev.emoji || '💜', title: ev.title });
  }
  // Свидания тоже «в этот день»: чипы рядом с событиями прошлых лет
  for (const dt of db.dates) {
    if (!dt.date) continue;
    const dDate = parseLocalIso(dt.date);
    if (isThisDay(dDate)) items.push({ kind: 'date', date: dt.date, emoji: dt.emoji || '💘', title: dt.place || dt.note || 'Свидание' });
  }
  for (const n of db.notes) {
    if (!n.ts) continue;
    const dt = new Date(n.ts);
    if (isThisDay(dt)) items.push({ kind: 'note', date: isoFromMs(n.ts), text: n.text, author: n.author });
  }
  for (const p of db.photos) {
    const ds = photoDate(p); // только EXIF или событие
    if (ds && isThisDay(parseLocalIso(ds))) items.push({ kind: 'photo', date: ds, p });
  }
  return items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function otdYear(dateStr) {
  const y = String(dateStr || '').slice(0, 4);
  return y ? y + ' год' : '';
}

// Отдельный виджет «В этот день» удалён — он дублировал коллаж «Наша история»:
// фото «в этот день» встают в коллаж (см. 30-home.js), а события прошлых лет
// показываются чипами прямо в блоке «Наша история» (renderProgressRing → .history-otd).

/* ===== Кольцо прогресса до годовщины ===== */
function pluralYears(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'год';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'года';
  return 'лет';
}
function pluralDays(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
  return 'дней';
}
// Универсальные формы: plural(5, 'событие', 'события', 'событий') → «событий»
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
function renderProgressRing(at) {
  const box = $('#progressRing');
  if (!box) return;
  const [sy, sm, sd] = START_DATE.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const now = new Date();
  const cur = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((cur - start) / 86400000);
  let anniv = new Date(start);
  while (anniv.getTime() <= cur.getTime()) anniv.setFullYear(anniv.getFullYear() + 1);
  const prev = new Date(anniv); prev.setFullYear(prev.getFullYear() - 1);
  const total = Math.max(1, Math.round((anniv - prev) / 86400000));
  const elapsed = Math.max(0, Math.round((cur - prev) / 86400000));
  const pct = Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
  const R = 42, CIRC = 2 * Math.PI * R;
  const off = CIRC - (CIRC * pct) / 100;
  const yearsTogether = Math.floor(days / 365.25);
  // Статистика под кольцом — чем заполнена наша история (v7)
  // Хотелки — чип с прогрессом исполненных (полоска + счётчик), кнопка 🎲 — перемес коллажа
  const wishDone = db.wishlist.filter(w => w.done).length;
  const wishTotal = db.wishlist.length;
  const wishPct = wishTotal ? Math.round((wishDone / wishTotal) * 100) : 0;
  const wishLabel = wishTotal ? wishDone + '/' + wishTotal : 'пока пусто';
  const wishTitle = wishTotal ? 'Исполнено ' + wishDone + ' из ' + wishTotal + ' хотелок' : 'Хотелок пока нет — загадай желание 💜';
  const stats = [
    ['📸', db.photos.length, 'фото', 'фото', 'фото'],
    ['📅', db.events.length, 'событие', 'события', 'событий'],
    ['💘', db.dates.length, 'свидание', 'свидания', 'свиданий'],
    ['📝', db.notes.length, 'заметка', 'заметки', 'заметок']
  ].map(a => `<span class="hs-chip">${a[0]} ${a[1]} ${plural(a[1], a[2], a[3], a[4])}</span>`).join('') +
    `<span class="hs-chip hs-wish" title="${wishTitle}">🎁 ${wishLabel}<span class="hs-bar"><i style="width:${wishPct}%"></i></span></span>` +
    `<span class="hs-chip hs-shuffle" id="shuffleHistoryBtn" role="button" tabindex="0" title="Перемешать фото коллажа">🎲 Перемешать</span>`;
  // «В этот день» (только когда есть события/свидания прошлых лет): чипы под кольцом.
  // Фото «в этот день» уже встали в коллаж выше — здесь только события и свидания, без дублей.
  const otdEvents = onThisDayItems(at || new Date()).filter(it => it.kind === 'event' || it.kind === 'date');
  const otdRow = otdEvents.length
    ? '<div class="history-otd"><span class="history-otd-label">✨ В этот день</span>' +
      otdEvents.map(ev =>
        '<span class="hs-chip hs-otd-chip" title="' + esc(ev.title) + ' — ' + otdYear(ev.date) + '">' +
        esc(ev.emoji) + ' ' + esc(ev.title) + ' <small>· ' + esc(String(ev.date).slice(0, 4)) + '</small></span>'
      ).join('') +
      '</div>'
    : '';
  box.innerHTML = `
    <div class="history-main">
      <div class="ring-wrap">
        <svg class="ring-svg" viewBox="0 0 100 100" role="img" aria-label="Прогресс до годовщины: ${pct}%">
          <circle class="ring-bg" cx="50" cy="50" r="${R}"></circle>
          <circle class="ring-fg" cx="50" cy="50" r="${R}" stroke-dasharray="${CIRC}" stroke-dashoffset="${off}"></circle>
        </svg>
        <div class="ring-center"><b>${pct}%</b><small>до годовщины</small></div>
      </div>
      <div class="ring-info">
        <h4>${yearsTogether > 0 ? yearsTogether + ' ' + pluralYears(yearsTogether) + ' вместе' : 'Наша история'}</h4>
        <p>${days} ${pluralDays(days)} вместе</p>
        <small>с ${fmtShort(START_DATE)}</small>
      </div>
      <div class="history-photos">${historyPhotosHtml(at)}</div>
    </div>
    ${otdRow}
    <div class="history-stats">${stats}</div>`;
}

/* ===== Лента «Память»: таймлайн-дерево ===== */
// Группировка по дням: события, прошедшие свидания, фото (только EXIF).
// Заметки, настроения и фото без даты — НЕ попадают в память.
// ВАЖНО: события и свидания попадают в память только если их дата <= сегодня.
// Фото, привязанные к событию/свиданию, показываются только в их карточках —
// в сетку дня они НЕ дублируются.
function memoryByDay() {
  const map = new Map();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = iso(today.getFullYear(), today.getMonth(), today.getDate());
  function ensure(dateStr) {
    if (!map.has(dateStr)) map.set(dateStr, { date: dateStr, events: [], dates: [], photos: [] });
    return map.get(dateStr);
  }
  for (const ev of db.events) {
    if (!ev.date) continue;
    // Событие попадает в память только если его дата уже наступила
    if (ev.date > todayStr) continue;
    const d = ensure(ev.date);
    const evPhotos = (ev.photos || []).map(id => db.photos.find(p => p.id === id)).filter(Boolean);
    d.events.push({ emoji: ev.emoji || '💜', title: ev.title, photos: evPhotos });
  }
  for (const dt of db.dates) {
    // Свидание попадает в память только если оно завершено (done:true) И дата уже наступила
    if (!dt.date || !dt.done) continue;
    if (dt.date > todayStr) continue;
    const d = ensure(dt.date);
    const dtPhotos = (dt.photos || []).map(id => db.photos.find(p => p.id === id)).filter(Boolean);
    d.dates.push({ emoji: dt.emoji || '💘', place: dt.place, time: dt.time, photos: dtPhotos });
  }
  for (const p of db.photos) {
    if (!p.takenAt) continue; // в сетку дня — только фото с реальной датой снимка (EXIF)
    const ds = isoFromMs(p.takenAt);
    if (!ds || ds > todayStr) continue;
    // Фото, привязанные к событию/свиданию, показываются только в их карточках — не дублируем.
    // Учитываем только карточки, которые реально попадут в память: дата <= сегодня,
    // у свиданий — ещё и done:true.
    const attached = db.events.some(ev => !!ev.date && ev.date <= todayStr &&
                       Array.isArray(ev.photos) && ev.photos.includes(p.id)) ||
                     db.dates.some(dt => !!dt.date && dt.date <= todayStr && dt.done &&
                       Array.isArray(dt.photos) && dt.photos.includes(p.id));
    if (attached) continue;
    const d = ensure(ds);
    d.photos.push(p);
  }
  return [...map.values()]
    .filter(d => d.events.length || d.dates.length || d.photos.length)
    .sort((a, b) => b.date.localeCompare(a.date));
}
function renderMemory() {
  const feed = $('#memoryFeed');
  if (!feed) return;
  const days = memoryByDay();
  if (!days.length) {
    feed.innerHTML = '<div class="rem-empty">Пока пусто 💜<br>Добавляйте события и фото — здесь сложится история вашей вселенной.</div>';
    return;
  }
  let html = '<div class="tl"><div class="tl-stem"></div>';
  let side = 0;
  let gid = 0;
  for (const day of days) {
    const dt = parseLocalIso(day.date);
    const label = dt ? dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : day.date;
    const cls = side % 2 === 0 ? 'tl-left' : 'tl-right';
    let card = '<div class="tl-date">' + esc(label) + '</div>';
    if (day.photos.length) {
      card += memoryPhotosHtml(day.photos, 'day' + (gid++), 'tl-photos');
    }
    for (const d of day.dates) {
      const info = [d.place, d.time].filter(Boolean).join(' · ');
      card += '<div class="tl-item"><span class="tl-item-emoji">' + esc(d.emoji) + '</span><b>Свидание' + (info ? ' · ' + esc(info) : '') + '</b></div>';
      if (d.photos && d.photos.length) {
        card += memoryPhotosHtml(d.photos, 'dt' + (gid++), 'tl-item-photos');
      }
    }
    for (const ev of day.events) {
      card += '<div class="tl-item"><span class="tl-item-emoji">' + esc(ev.emoji) + '</span><b>' + esc(ev.title) + '</b></div>';
      if (ev.photos.length) {
        card += memoryPhotosHtml(ev.photos, 'ev' + (gid++), 'tl-item-photos');
      }
    }
    html += '<div class="' + cls + '"><div class="tl-dot"></div><div class="tl-card">' + card + '</div></div>';
    side++;
  }
  html += '</div>';
  feed.innerHTML = html;
  hydratePhotoImgs(feed);
  feed.querySelectorAll('[data-lightbox]').forEach(function (img) {
    img.addEventListener('click', async function () {
      var p = db.photos.find(function (x) { return x.id === img.dataset.lightbox; });
      if (!p) return;
      var url = await photoUrl(p, false);
      if (url) { $('#lightboxImg').src = url; $('#lightbox').hidden = false; }
    });
  });
}

/* ===== Превью фото в «Памяти» ===== */
// Сразу показываем не больше MEMORY_PHOTOS_PREVIEW фото в ряду; остальные —
// скрыты и раскрываются кнопкой «Показать ещё N» (клик ловит делегат ниже).
const MEMORY_PHOTOS_PREVIEW = 3;

function tlPhotoImg(p, extraCls) {
  const cls = extraCls ? ' class="' + extraCls + '"' : '';
  const stl = extraCls ? ' style="display:none"' : '';
  const url = photoSrc(p);
  return url
    ? '<img' + cls + stl + ' src="' + esc(url) + '" alt="" data-lightbox="' + esc(p.id) + '">'
    : '<img' + cls + stl + ' data-photo-src="' + esc(p.id) + '" alt="" data-lightbox="' + esc(p.id) + '">';
}
function memoryPhotosHtml(photos, groupId, rowCls) {
  const shown = photos.slice(0, MEMORY_PHOTOS_PREVIEW);
  const rest = photos.slice(MEMORY_PHOTOS_PREVIEW);
  return '<div class="' + rowCls + '" data-photo-group="' + groupId + '" data-more-count="' + rest.length + '">' +
    shown.map(p => tlPhotoImg(p)).join('') +
    (rest.length
      ? '<button class="tl-more-btn" data-tl-expand="' + groupId + '" title="Показать ещё фото">Показать ещё ' + rest.length + '</button>' +
        rest.map(p => tlPhotoImg(p, 'tl-more-photo')).join('')
      : '') +
    '</div>';
}
// Переключатель «Показать ещё N фото ⇄ Свернуть». Возвращает 'more' | 'less' | null.
function toggleMemoryPhotos(groupId) {
  const row = document.querySelector('[data-photo-group="' + groupId + '"]');
  if (!row) return null;
  const collapse = row.dataset.expanded === '1';
  const hidden = row.querySelectorAll ? row.querySelectorAll('.tl-more-photo') : [];
  const btn = row.querySelectorAll ? row.querySelectorAll('[data-tl-expand]')[0] : null;
  const total = +row.dataset.moreCount || hidden.length;
  if (collapse) {
    row.dataset.expanded = '0';
    for (const el of hidden) el.style.display = 'none';
    if (btn) btn.textContent = 'Показать ещё ' + total;
  } else {
    row.dataset.expanded = '1';
    for (const el of hidden) el.style.display = '';
    if (btn) btn.textContent = 'Свернуть';
  }
  return collapse ? 'less' : 'more';
}
document.addEventListener('click', e => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-tl-expand]') : null;
  if (btn) toggleMemoryPhotos(btn.dataset.tlExpand);
});

/* ===== Календарь ===== */
let calY = new Date().getFullYear(), calM = new Date().getMonth(), selectedDate = null;
let editingEventId = null;
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTHS_SHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
// Родительный падеж для дат: «9 августа 2026 года»
const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function fmtShort(s) { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return `${d} ${MONTHS_SHORT[m - 1]}`; }

function iso(y, m, d) { return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
// Парсим 'YYYY-MM-DD' как локальную дату: без 'T00:00:00' браузер трактует строку
// как UTC-полночь, и в часовых поясах западнее UTC дата «съезжает» на день назад.
function parseLocalIso(s) {
  const [y, m, d] = String(s || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return isNaN(dt) ? null : dt;
}
function eventsOn(dateStr, m, d) {
  return db.events.filter(ev => {
    if (ev.repeat) {
      const [ey, em, ed] = ev.date.split('-').map(Number);
      return (em - 1 === m && ed === d);
    }
    // длительное событие: endDate >= date — попадает на каждый день промежутка
    if (ev.endDate && ev.endDate >= ev.date) return dateStr >= ev.date && dateStr <= ev.endDate;
    return ev.date === dateStr;
  });
}
function renderCalendar() {
  fillCalJump();
  const firstDow = (new Date(calY, calM, 1).getDay() + 6) % 7; // понедельник = 0
  const dim = new Date(calY, calM + 1, 0).getDate();
  const today = new Date();

  let html = '<div class="cal-row cal-head-row">' +
    ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => `<div class="cal-cell cal-dow">${d}</div>`).join('') + '</div>';
  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += '<div class="cal-cell cal-empty"></div>';
  for (let d = 1; d <= dim; d++) {
    const ds = iso(calY, calM, d);
    const evs = eventsOn(ds, calM, d);
    const dts = datesOn(ds);
    const isToday = today.getFullYear() === calY && today.getMonth() === calM && today.getDate() === d;
    const inSpan = db.events.some(ev => !ev.repeat && ev.endDate && ev.endDate >= ev.date && ds >= ev.date && ds <= ev.endDate);
    cells += `<div class="cal-cell${isToday ? ' today' : ''}${selectedDate === ds ? ' selected' : ''}${inSpan ? ' in-span' : ''}${dts.length ? ' has-date' : ''}" data-day="${ds}" role="button" tabindex="0">` +
      `<span class="cal-num">${d}</span>` +
      evs.slice(0, 2).map(e => `<span class="cal-dot" title="${esc(e.title)}">${esc(e.emoji)} ${esc(e.title)}</span>`).join('') +
      (evs.length > 2 ? `<span class="cal-dot cal-dot-more" title="Ещё ${evs.length - 2} события">+${evs.length - 2}</span>` : '') +
      (dts.length ? `<span class="cal-dot date-dot" title="Свидание">${esc(dts[0].emoji || '💘')}</span>` : '') +
      '</div>';
  }
  $('#calendar').innerHTML = html + `<div class="cal-row">${cells}</div>`;
  renderDayPanel();
  updateNearestJump();
}
function renderDayPanel() {
  const panel = $('#dayPanel');
  if (!selectedDate) {
    panel.innerHTML = '<p class="cal-tip">👆 Нажми на день в календаре, чтобы посмотреть события или добавить новое.</p>';
    return;
  }
  const [y, m, d] = selectedDate.split('-').map(Number);
  const evs = eventsOn(selectedDate, m - 1, d);
  const dts = datesOn(selectedDate);
  const fmtDate = `${d} ${MONTHS[m - 1].toLowerCase()} ${y}`;
  panel.innerHTML =
    `<div class="day-head"><b>${fmtDate}</b></div>` +
    (evs.length
      ? evs.map(e => `<div class="day-event">${esc(e.emoji)} <span>${esc(e.title)}${e.endDate && e.endDate >= e.date ? ` <small class="ev-range">до ${fmtShort(e.endDate)}</small>` : ''}</span>${evThumbs(e)} <button class="mini-x" data-photo-event="${e.id}" title="Добавить фото">📷</button> <button class="mini-x" data-edit-event="${e.id}" title="Изменить">✏️</button> <button class="mini-x" data-del-event="${e.id}" title="Удалить">✕</button></div>`).join('')
      : '<p class="cal-tip">В этот день событий пока нет.</p>') +
    (dts.length
      ? `<div class="day-sub">💘 Свидания</div>` + dts.map(dt =>
          `<div class="day-event date-evt${dt.done ? ' date-done' : ''}">${esc(dt.emoji || '💘')} <span>${dt.time ? '🕐 ' + esc(dt.time) + ' · ' : ''}${esc(dt.place || dt.note || 'Свидание')}${dt.done ? ' ✅' : ''}</span>${dtThumbs(dt)} <button class="mini-x" data-done-date="${dt.id}" title="${dt.done ? 'Снять отметку — свидание не прошло' : 'Свидание прошло — отметить'}">${dt.done ? '💗' : '✅'}</button> <button class="mini-x" data-photo-date="${dt.id}" title="Добавить фото">📷</button> <button class="mini-x" data-del-date="${dt.id}" title="Удалить">✕</button></div>`).join('')
      : '') +
    `<div class="day-add">
       <input type="text" id="dayTitle" placeholder="Название события">
       <input type="text" id="dayEmoji" value="💜" maxlength="4">
       <button class="btn" id="dayAdd">＋ Добавить</button>
     </div>`;
  const addBtn = $('#dayAdd');
  if (addBtn) addBtn.addEventListener('click', addDayEvent);
  const inp = $('#dayTitle');
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') addDayEvent(); });
}
function addDayEvent() {
  const title = $('#dayTitle').value.trim();
  if (!title) return;
  db.events.push({ id: uid(), title, date: selectedDate, emoji: $('#dayEmoji').value.trim() || '💜', repeat: true });
  save(); renderCalendar(); renderHome();
}
$('#calPrev').addEventListener('click', () => { calM--; if (calM < 0) { calM = 11; calY--; } selectedDate = null; renderCalendar(); });
$('#calNext').addEventListener('click', () => { calM++; if (calM > 11) { calM = 0; calY++; } selectedDate = null; renderCalendar(); });
$('#addEventBtn').addEventListener('click', () => openEventModal());

// «⏭ К ближайшему событию»: ближайшая дата события/свидания с учётом
// ежегодных повторов и идущих сейчас диапазонов (endDate).
function nextUpcoming() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStr = iso(today.getFullYear(), today.getMonth(), today.getDate());
  const cands = [];
  for (const ev of db.events) {
    const [y, m, d] = ev.date.split('-').map(Number);
    let occ;
    if (ev.repeat !== false) { // ежегодный повтор: следующий раз в этом/следующем году
      occ = new Date(today.getFullYear(), m - 1, d);
      if (occ < today) occ = new Date(today.getFullYear() + 1, m - 1, d);
      if (m === 2 && d === 29 && occ.getMonth() === 2 && occ.getDate() === 1) occ.setDate(0); // 29 фев → 28
    } else {
      occ = new Date(y, m - 1, d);
      if (ev.endDate && occ <= today) { // диапазон уже начался и ещё идёт — «сейчас»
        const end = parseLocalIso(ev.endDate);
        if (end && end >= today) occ = today;
      }
      if (occ < today) continue; // разовое в прошлом
    }
    cands.push({ date: iso(occ.getFullYear(), occ.getMonth(), occ.getDate()), title: ev.title, emoji: ev.emoji || '💜' });
  }
  for (const dt of db.dates) {
    if (dt.done) continue;
    const [y, m, d] = dt.date.split('-').map(Number);
    if (new Date(y, m - 1, d) < today) continue;
    cands.push({ date: dt.date, title: dt.place || dt.note || 'Свидание', emoji: dt.emoji || '💘' });
  }
  cands.sort((a, b) => a.date.localeCompare(b.date));
  return cands[0] || null;
}
// «⏭ К ближайшему событию»: кнопка и плашка видны, только когда ближайшее
// событие/свидание НЕ в показываемом месяце. В месяце ближайшего события
// их нет. Вызывается из renderCalendar при каждой перерисовке и по кнопке «⏭».
function updateNearestJump() {
  const nx = nextUpcoming();
  const info = $('#jumpInfo');
  const btn = $('#jumpNextBtn');
  if (!nx) { // впереди событий нет — кнопка остаётся (по клику — подсказка), плашка скрыта
    if (info) info.hidden = true;
    if (btn) btn.hidden = false;
    return;
  }
  const [y, m, d] = nx.date.split('-').map(Number);
  const here = (y === calY && m - 1 === calM);
  if (here) { // уже смотрим месяц ближайшего события — кнопка и плашка не нужны
    if (info) info.hidden = true;
    if (btn) btn.hidden = true;
    return;
  }
  if (info) {
    info.textContent = `⏭ Ближайшее: ${nx.emoji} «${nx.title}» — ${d} ${MONTHS[m - 1].toLowerCase()} ${y} г.`;
    info.hidden = false;
  }
  if (btn) btn.hidden = false;
}
function jumpToNearestEvent() {
  const nx = nextUpcoming();
  const info = $('#jumpInfo');
  if (!nx) {
    if (info) { info.textContent = '💫 Ближайших событий пока нет — добавь первое!'; info.hidden = false; }
    return;
  }
  const [y, m] = nx.date.split('-').map(Number);
  calY = y; calM = m - 1;
  selectedDate = nx.date;
  renderCalendar(); // updateNearestJump() скроет кнопку/плашку: ближайшее уже на экране
}
$('#jumpNextBtn').addEventListener('click', jumpToNearestEvent);

// Быстрый выбор месяца/года (два селекта над календарём)
function fillCalJump() {
  const ms = $('#calMonthSelect'), ys = $('#calYearSelect');
  if (!ms || !ys) return;
  if (typeof ms.add === 'function' && ms.options.length === 0) {
    MONTHS.forEach((name, i) => {
      const o = document.createElement('option'); o.value = String(i); o.textContent = name; ms.add(o);
    });
    const now = new Date();
    const y0 = Math.min(2026, now.getFullYear() - 5);
    for (let y = y0; y <= now.getFullYear() + 5; y++) {
      const o = document.createElement('option'); o.value = String(y); o.textContent = String(y); ys.add(o);
    }
  }
  ms.value = String(calM);
  ys.value = String(calY);
}
function jumpCalendar(m, y) { calM = +m; calY = +y; selectedDate = null; renderCalendar(); }
$('#calMonthSelect').addEventListener('change', e => jumpCalendar(e.target.value, calY));
$('#calYearSelect').addEventListener('change', e => jumpCalendar(calM, e.target.value));

// Миниатюры фото события в панели дня (v6+: ev.photos хранит id фото)
function photoByRef(ref) {
  return db.photos.find(p => p.id === ref) || null;
}
// «Мёртвые» id (фото удалено из галереи) пропускаем — не рисуем битую рамку.
// Легаси data-URL показываем напрямую.
function thumbRefs(refs) {
  return refs.filter(ref => photoByRef(ref) || (typeof ref === 'string' && ref.startsWith('data:')));
}
function evThumbs(e) {
  if (!(e.photos && e.photos.length)) return '';
  const refs = thumbRefs(e.photos);
  if (!refs.length) return '';
  return `<span class="ev-thumbs">${refs.map(ref => {
    const p = photoByRef(ref);
    const src = p ? photoSrc(p) : ref; // сиротский data-URL из легаси-события показываем напрямую
    const attr = p ? p.id : ref;
    return `<img class="ev-thumb" src="${esc(src)}" alt="${esc(e.title)}" data-photo="${esc(attr)}" loading="lazy">`;
  }).join('')}</span>`;
}

// Фото события кладём в общую галерею под общим лейблом «📅 События»;
// название события остаётся подписью фото (title) и показывается в витрине событий.
// Отдельные лейблы-названия не создаём — иначе фильтр засоряется после 30+ событий.
// ev.photos хранит id фото (v6+). Новые фото события приходят как data-URL —
// на каждую создаётся фото галереи с id, а в событие пишутся эти id.
function addEventPhotosToGallery(photos, title) {
  if (!photos.length) return [];
  if (!db.labels.includes(EVENT_LABEL)) db.labels.push(EVENT_LABEL);
  const ids = [];
  for (const photoRef of photos) {
    const existing = db.photos.find(p => p.id === photoRef);
    if (existing) {
      if (!Array.isArray(existing.labels)) existing.labels = [];
      if (!existing.labels.includes(EVENT_LABEL)) existing.labels.push(EVENT_LABEL);
      ids.push(existing.id);
    } else {
      const ph = { id: uid(), data: photoRef, title, labels: [EVENT_LABEL], pinned: false, ts: Date.now(), order: 0 };
      db.photos.unshift(ph);
      ids.push(ph.id);
      setThumbUrl(ph.id, photoRef); // мгновенный показ из кэша миниатюр
      // Кладём копию в photoStore (в фоне), чтобы фото пережило перенос в IndexedDB.
      // Миниатюру (WebP) генерируем при загрузке; base64 из памяти убираем после записи.
      try {
        const blob = dataUrlToBlob(photoRef);
        if (blob && photoStore) {
          makeThumbBlob(photoRef, 256).then(async thumb => {
            const meta = { type: blob.type || 'image/jpeg', thumbType: (thumb && thumb.type) || 'image/webp', title, size: blob.size };
            await photoStore.put(ph.id, blob, thumb, meta);
            if (ph.data === photoRef) delete ph.data; // блоб в сторе — base64 из памяти убираем
          }).catch(e => console.warn('Не удалось сохранить фото события в хранилище', e));
        }
      } catch (e) { console.warn('Не удалось сохранить фото события в хранилище', e); }
    }
  }
  return ids;
}

// Быстрое добавление фото к событию прямо из панели дня (кнопка 📷)
function addEventPhotoQuick(evId) {
  const ev = db.events.find(x => x.id === evId);
  if (!ev) return;
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.addEventListener('change', async () => {
    const ok = [];
    for (const f of [...inp.files].slice(0, 5)) {
      try { ok.push(await readFile(f)); } catch (err) { console.warn('Не удалось прочитать фото события', err); }
    }
    inp.remove();
    if (!ok.length) return;
    const ids = addEventPhotosToGallery(ok, ev.title);
    ev.photos = Array.isArray(ev.photos) ? ev.photos.concat(ids.length ? ids : ok) : (ids.length ? ids : ok);
    save(); renderCalendar(); renderHome();
  }, { once: true });
  inp.click();
}

// Фото свидания кладём в общую галерею под лейблом «💞 Свидания»;
// dt.photos хранит id фото. Новые фото приходят как data-URL.
function addDatePhotosToGallery(photos, title) {
  if (!photos.length) return [];
  if (!db.labels.includes(DATE_LABEL)) db.labels.push(DATE_LABEL);
  const ids = [];
  for (const photoRef of photos) {
    const existing = db.photos.find(p => p.id === photoRef);
    if (existing) {
      if (!Array.isArray(existing.labels)) existing.labels = [];
      if (!existing.labels.includes(DATE_LABEL)) existing.labels.push(DATE_LABEL);
      ids.push(existing.id);
    } else {
      const ph = { id: uid(), data: photoRef, title, labels: [DATE_LABEL], pinned: false, ts: Date.now(), order: 0 };
      db.photos.unshift(ph);
      ids.push(ph.id);
      setThumbUrl(ph.id, photoRef);
      try {
        const blob = dataUrlToBlob(photoRef);
        if (blob && photoStore) {
          makeThumbBlob(photoRef, 256).then(async thumb => {
            const meta = { type: blob.type || 'image/jpeg', thumbType: (thumb && thumb.type) || 'image/webp', title, size: blob.size };
            await photoStore.put(ph.id, blob, thumb, meta);
            if (ph.data === photoRef) delete ph.data;
          }).catch(e => console.warn('Не удалось сохранить фото свидания в хранилище', e));
        }
      } catch (e) { console.warn('Не удалось сохранить фото свидания в хранилище', e); }
    }
  }
  return ids;
}

// Быстрое добавление фото к свиданию из панели дня (кнопка 📷)
function addDatePhotoQuick(dtId) {
  const dt = db.dates.find(x => x.id === dtId);
  if (!dt) return;
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.addEventListener('change', async () => {
    const ok = [];
    for (const f of [...inp.files].slice(0, 5)) {
      try { ok.push(await readFile(f)); } catch (err) { console.warn('Не удалось прочитать фото свидания', err); }
    }
    inp.remove();
    if (!ok.length) return;
    const title = dt.place || dt.note || 'Свидание';
    const ids = addDatePhotosToGallery(ok, title);
    dt.photos = Array.isArray(dt.photos) ? dt.photos.concat(ids.length ? ids : ok) : (ids.length ? ids : ok);
    save(); renderCalendar(); renderHome();
  }, { once: true });
  inp.click();
}

// Миниатюры фото свидания в панели дня
function dtThumbs(dt) {
  if (!(dt.photos && dt.photos.length)) return '';
  const refs = thumbRefs(dt.photos);
  if (!refs.length) return '';
  return '<span class="ev-thumbs">' + refs.map(ref => {
    const p = photoByRef(ref);
    const src = p ? photoSrc(p) : ref;
    const attr = p ? p.id : ref;
    return '<img class="ev-thumb" src="' + esc(src) + '" alt="" data-photo="' + esc(attr) + '" loading="lazy">';
  }).join('') + '</span>';
}

/* ===== Кастомный date-picker в стиле сайта =====
   Системный календарь у input[type=date] не стилизуется и «выбивается».
   Вместо него — свой попап в стилистике большого календаря: стрелки ‹ ›,
   селекты месяца/года, сетка дней, «Сегодня» / «Очистить».
   Выбранная дата пишется в поле как ISO (YYYY-MM-DD) с событиями input/change —
   весь остальной код работает без изменений. */
let dpInput = null;                   // поле, для которого открыт попап
let dpM = new Date().getMonth();      // показываемый месяц
let dpY = new Date().getFullYear();   // показываемый год
const dpPad = n => String(n).padStart(2, '0');
function dpIso(y, m, d) { return y + '-' + dpPad(m + 1) + '-' + dpPad(d); }
let dpFocus = null; // сфокусированный день (клавиатура, roving tabindex)

// Фокус и клавиатурная навигация: паттерн «date picker dialog + grid» из APG.
// setDpFocus озвучивает дату скринридеру через #dpLive (role=status, aria-live=polite).
function setDpFocus(iso) {
  dpFocus = iso;
  const live = $('#dpLive');
  const [yy, mm, dd] = String(iso || '').split('-').map(Number);
  if (live && yy && mm && dd) live.textContent = `${dd} ${MONTHS_GEN[mm - 1]} ${yy} года`;
}
// После смены месяца/года день не должен «пропадать»: зажимаем его в границы месяца
function clampDpFocus() {
  const [yy, mm, dd] = String(dpFocus || '').split('-').map(Number);
  const dim = new Date(dpY, dpM + 1, 0).getDate();
  setDpFocus(dpIso(dpY, dpM, yy ? Math.min(dd, dim) : Math.min(new Date().getDate(), dim)));
}
function focusDpDay(iso) {
  const btn = document.querySelector(`.dp-day[data-dp-date="${iso}"]`);
  if (btn && btn.focus) btn.focus();
}
function datePopKeydown(e) {
  if (!e || !e.key) return;
  const pop = $('#datePop');
  if (!pop || pop.hidden) return;
  if (e.key === 'Escape') {
    const el = dpInput;
    closeDatePop();
    if (el && el.focus) el.focus();
    if (e.preventDefault) e.preventDefault();
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    if (dpFocus) pickDpDate(dpFocus);
    if (e.preventDefault) e.preventDefault();
    return;
  }
  if (!dpFocus) return;
  const [yy, mm, dd] = dpFocus.split('-').map(Number);
  const dim = () => new Date(dpY, dpM + 1, 0).getDate();
  const stay = nd => { setDpFocus(dpIso(dpY, dpM, nd)); renderDatePop(); focusDpDay(dpFocus); };
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (e.preventDefault) e.preventDefault();
    const base = new Date(yy, mm - 1, dd + (e.key === 'ArrowLeft' ? -1 : 1));
    stay(base.getMonth() === mm - 1 ? base.getDate() : (e.key === 'ArrowLeft' ? 1 : dim()));
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    if (e.preventDefault) e.preventDefault();
    const base = new Date(yy, mm - 1, dd + (e.key === 'ArrowUp' ? -7 : 7));
    stay(base.getMonth() === mm - 1 ? base.getDate() : (e.key === 'ArrowUp' ? 1 : dim()));
  } else if (e.key === 'Home' || e.key === 'End') {
    if (e.preventDefault) e.preventDefault();
    stay(e.key === 'Home' ? 1 : dim());
  } else if (e.key === 'PageUp' || e.key === 'PageDown') {
    if (e.preventDefault) e.preventDefault();
    let y = dpY, m = dpM;
    if (e.shiftKey) {
      y += e.key === 'PageUp' ? -1 : 1;
    } else {
      m += e.key === 'PageUp' ? -1 : 1;
      if (m < 0) { m = 11; y--; }
      if (m > 11) { m = 0; y++; }
    }
    dpY = y; dpM = m;
    clampDpFocus();
    renderDatePop(); focusDpDay(dpFocus);
  }
}
// Обработчик висит на сетке дней: стрелки не перехватываются, когда фокус на селектах/кнопках
$('#dpDays').addEventListener('keydown', datePopKeydown);

function renderDatePop() {
  const pop = $('#datePop');
  if (!pop) return;
  const ms = $('#dpMonth'), ys = $('#dpYear');
  if (ms) ms.innerHTML = MONTHS.map((n, i) => `<option value="${i}"${i === dpM ? ' selected' : ''}>${n}</option>`).join('');
  if (ys) {
    const now = new Date();
    const y0 = Math.min(2026, now.getFullYear() - 5);
    ys.innerHTML = '';
    for (let y = y0; y <= now.getFullYear() + 5; y++) {
      const o = document.createElement('option'); o.value = String(y); o.textContent = String(y); ys.appendChild(o);
    }
    ys.value = String(dpY);
  }
  const firstDow = (new Date(dpY, dpM, 1).getDay() + 6) % 7; // понедельник = 0
  const dim = new Date(dpY, dpM + 1, 0).getDate();
  const now = new Date();
  let cells = '<div class="dp-dow" role="columnheader">Пн</div><div class="dp-dow" role="columnheader">Вт</div><div class="dp-dow" role="columnheader">Ср</div>' +
    '<div class="dp-dow" role="columnheader">Чт</div><div class="dp-dow" role="columnheader">Пт</div><div class="dp-dow" role="columnheader">Сб</div><div class="dp-dow" role="columnheader">Вс</div>';
  for (let i = 0; i < firstDow; i++) cells += '<button type="button" class="dp-day empty" tabindex="-1" aria-hidden="true"></button>';
  for (let d = 1; d <= dim; d++) {
    const iso = dpIso(dpY, dpM, d);
    const isToday = now.getFullYear() === dpY && now.getMonth() === dpM && now.getDate() === d;
    const picked = dpInput && dpInput.value === iso;
    cells += `<button type="button" class="dp-day${isToday ? ' today' : ''}${picked ? ' picked' : ''}" data-dp-date="${iso}" ` +
      `tabindex="${iso === dpFocus ? '0' : '-1'}" aria-label="${d} ${MONTHS_GEN[dpM]} ${dpY} года"${isToday ? ' aria-current="date"' : ''}>${d}</button>`;
  }
  const grid = $('#dpDays');
  if (grid) grid.innerHTML = cells;
}
function pickDpDate(iso) {
  const el = dpInput;
  if (el) {
    el.value = iso;
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (err) { /* песочница тестов: Event не определён */ }
  }
  closeDatePop();
  if (el && el.focus) el.focus();
}
function closeDatePop() {
  const pop = $('#datePop');
  if (pop) pop.hidden = true;
  dpInput = null;
}
function openDatePop(el) {
  if (!el) return;
  dpInput = el;
  const d = el.value ? parseLocalIso(el.value) : null;
  const now = new Date();
  dpY = (d && !isNaN(d)) ? d.getFullYear() : now.getFullYear();
  dpM = (d && !isNaN(d)) ? d.getMonth() : now.getMonth();
  // Клавиатура: roving tabindex — фокус на выбранной дате или на «сегодня»
  const picked = (dpInput && /^\d{4}-\d{2}-\d{2}$/.test(dpInput.value)) ? dpInput.value : null;
  setDpFocus(picked || dpIso(dpY, dpM, Math.min(now.getDate(), new Date(dpY, dpM + 1, 0).getDate())));
  renderDatePop();
  const pop = $('#datePop');
  if (!pop) return;
  // Не-модальный диалог выбора даты: роль и подпись для скринридера
  try {
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'false');
    pop.setAttribute('aria-label', 'Выбор даты');
  } catch (err) {}
  pop.hidden = false;
  focusDpDay(dpFocus);
  // ставим попап под полем, не вылезая за край экрана
  const r = el.getBoundingClientRect && el.getBoundingClientRect();
  const vw = (typeof window !== 'undefined' && window.innerWidth) || document.documentElement.clientWidth || 320;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || document.documentElement.clientHeight || 480;
  if (r) {
    const pw = 272, ph = 330;
    let left = r.left;
    if (left + pw > vw - 8) left = Math.max(8, vw - pw - 8);
    pop.style.left = left + 'px';
    let top = r.bottom + 6;
    if (top + ph > vh - 8) top = Math.max(8, r.top - ph - 6);
    pop.style.top = top + 'px';
  }
}
// Клик по попапу: стрелки, «Сегодня», «Очистить», выбор дня
$('#datePop').addEventListener('click', e => {
  const nav = e.target.closest('[data-dp-nav]');
  if (nav) {
    dpM += +nav.dataset.dpNav;
    if (dpM < 0) { dpM = 11; dpY--; }
    if (dpM > 11) { dpM = 0; dpY++; }
    clampDpFocus();
    renderDatePop();
    focusDpDay(dpFocus);
    return;
  }
  if (e.target.closest('[data-dp-today]')) {
    const n = new Date();
    pickDpDate(dpIso(n.getFullYear(), n.getMonth(), n.getDate())); return;
  }
  if (e.target.closest('[data-dp-clear]')) { pickDpDate(''); return; }
  const day = e.target.closest('[data-dp-date]');
  if (day) pickDpDate(day.dataset.dpDate);
});
$('#dpMonth').addEventListener('change', e => { dpM = +e.target.value; clampDpFocus(); renderDatePop(); });
$('#dpYear').addEventListener('change', e => { dpY = +e.target.value; clampDpFocus(); renderDatePop(); });
// Закрытие: клик мимо или Esc
document.addEventListener('pointerdown', e => {
  const pop = $('#datePop');
  if (pop && !pop.hidden && !pop.contains(e.target)) closeDatePop();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDatePop(); });
// Поля дат в модалках открывают свой календарь вместо системного
['#evDate', '#evEnd', '#dtDate'].forEach(sel => {
  const el = $(sel);
  if (el) el.addEventListener('focus', () => openDatePop(el));
});

// Фото, прикреплённые к событию (живут, пока открыта модалка)
let evPhotoData = [];
function setEvPhotoCount() {
  const c = $('#evPhotoCount');
  if (c) c.textContent = evPhotoData.length ? `✅ фото: ${evPhotoData.length}` : '';
}
function openEventModal(id) {
  const t = new Date();
  $('#evDate').value = iso(t.getFullYear(), t.getMonth(), t.getDate());
  $('#evEnd').value = '';
  $('#evTitle').value = '';
  $('#evEmoji').value = '💜';
  $('#evRepeat').checked = true;
  evPhotoData = [];
  setEvPhotoCount();
  // id может прийти только из data-edit-event; клик по «＋ Добавить дату» не должен
  // попадать сюда как объект события — принимаем только настоящую строку id.
  editingEventId = typeof id === 'string' ? id : null;
  $('#evModalTitle').textContent = editingEventId ? '✏️ Изменить дату' : '💜 Памятная дата';
  const sub = $('#evHeadSub');
  if (sub) sub.textContent = editingEventId ? 'Поправь детали — всё сохранится ✨' : 'Сохрани важный день для вас двоих 💞';
  if (editingEventId) {
    const ev = db.events.find(x => x.id === editingEventId);
    if (ev) {
      $('#evTitle').value = ev.title;
      $('#evDate').value = ev.date;
      $('#evEnd').value = ev.endDate || '';
      $('#evEmoji').value = ev.emoji || '💜';
      $('#evRepeat').checked = ev.repeat !== false;
      evPhotoData = Array.isArray(ev.photos) ? [...ev.photos] : [];
      setEvPhotoCount();
    }
  }
  $('#eventOverlay').hidden = false;
  $('#evTitle').focus();
}
$('#evPhoto').addEventListener('change', async e => {
  const files = [...e.target.files].slice(0, 5);
  for (const f of files) {
    try { evPhotoData.push(await readFile(f)); } catch (err) { console.warn('Не удалось прочитать фото события', err); }
  }
  e.target.value = '';
  setEvPhotoCount();
});
// Долгое событие не повторяется каждый год — снимаем галочку автоматически
$('#evEnd').addEventListener('input', () => { if ($('#evEnd').value) $('#evRepeat').checked = false; });
function saveEventFromModal() {
  const title = $('#evTitle').value.trim();
  const date = $('#evDate').value;
  if (!title || !date) { alert('Напиши название и выбери дату 💜'); return; }
  const endDate = $('#evEnd').value || null;
  if (endDate && endDate < date) { alert('Конец события не может быть раньше начала 💜'); return; }
  const data = { title, date, endDate, emoji: $('#evEmoji').value.trim() || '💜', repeat: $('#evRepeat').checked && !endDate };
  // Фото события: кладём в общую галерею и вешаем лейбл = названию события
  if (evPhotoData.length) {
    const ids = addEventPhotosToGallery(evPhotoData, title);
    data.photos = ids.length ? ids : evPhotoData;
  }
  const ev = editingEventId ? db.events.find(x => x.id === editingEventId) : null;
  if (ev) {
    if (ev.photos && !evPhotoData.length) delete ev.photos;
    Object.assign(ev, data);
  } else {
    // Если редактируемое событие не найдено (например, удалено в другой вкладке) —
    // создаём новое, чтобы пользовательские данные не терялись молча.
    db.events.push({ id: uid(), ...data });
  }
  // Переходим на месяц события, чтобы оно сразу появилось в календаре
  const [evY, evM] = date.split('-').map(Number);
  calM = evM - 1; calY = evY; selectedDate = date;
  editingEventId = null;
  save(); $('#eventOverlay').hidden = true; renderCalendar(); renderHome();
}
$('#evSave').addEventListener('click', saveEventFromModal);

/* ===== Заметки ===== */
let editingNoteId = null; // id заметки в режиме инлайн-правки (null — не редактируем)
let dragNoteId = null;    // id заметки, которую сейчас перетаскиваем
function noteAuthorName(n) {
  return n.author === 'dasha' ? '👧 Даша' : n.author === 'gosha' ? '👦 Гоша' : '💜 Наши';
}
function renderNotes() {
  const list = [...db.notes].sort((a, b) =>
    (b.pinned - a.pinned) || ((a.order ?? 1e9) - (b.order ?? 1e9)) || (b.ts - a.ts));
  $('#notesGrid').innerHTML = list.length ? list.map(n => `
    <div class="note${n.pinned ? ' pinned' : ''}" data-id="${n.id}" draggable="true">
      <div class="note-top">
        <button class="mini-x" data-pin-note="${n.id}" title="${n.pinned ? 'Открепить' : 'Закрепить'}">${n.pinned ? '📌' : '📍'}</button>
        <span class="note-author">${noteAuthorName(n)}</span>
        <span class="note-date">${new Date(n.ts).toLocaleDateString('ru-RU')}</span>
        <button class="mini-x" data-edit-note="${n.id}" title="Редактировать">✏️</button>
        <button class="mini-x" data-del-note="${n.id}" title="Удалить">✕</button>
      </div>
      ${editingNoteId === n.id
        ? `<div class="note-edit">
             <textarea id="noteEdit-${n.id}" class="note-editor">${esc(n.text)}</textarea>
             <div class="note-edit-btns">
               <button class="btn btn-sm" data-save-note="${n.id}">💜 Сохранить</button>
               <button class="mini-x" data-cancel-note title="Отмена">✕</button>
             </div>
           </div>`
        : `<p>${esc(n.text)}</p>`}
    </div>`).join('')
    : '<p class="cal-tip">Пока пусто. Напиши первую записку! 💌</p>';
}
function addNote() {
  const t = $('#noteText').value.trim();
  if (!t) return;
  db.notes.unshift({ id: uid(), text: t, ts: Date.now(), pinned: false, author: getUser(), order: 0 });
  save(); $('#noteText').value = ''; renderNotes();
}
$('#noteAddBtn').addEventListener('click', addNote);
$('#noteText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addNote(); });

// Закрепить/удалить может любой — отдельные функции, вызываются по клику ✕/📍
function togglePinNote(id) {
  const n = db.notes.find(x => x.id === id);
  if (!n) return;
  n.pinned = !n.pinned; save(); renderNotes();
}
function deleteNote(id) {
  db.notes = db.notes.filter(x => x.id !== id);
  if (editingNoteId === id) editingNoteId = null;
  save(); renderNotes();
}

// Редактирование: ✏️, двойной клик по карточке, Ctrl+Enter в редакторе
function startEditNote(id) { editingNoteId = id; renderNotes(); }
function cancelNoteEdit() { editingNoteId = null; renderNotes(); }
function saveNoteEdit(id, text) {
  const n = db.notes.find(x => x.id === id);
  if (!n) return;
  const ta = $('#noteEdit-' + id);
  const t = (text !== undefined ? text : (ta && ta.value) || '').trim();
  if (t) { n.text = t; n.ts = Date.now(); }
  editingNoteId = null; save(); renderNotes();
}
$('#notesGrid').addEventListener('dblclick', e => {
  const card = e.target.closest('.note');
  if (!card) return;
  startEditNote(card.dataset.id);
});

// drag&drop перестановка: переносим id, на drop пересчитываем order всем заметкам.
// Чистая функция — её легко проверить тестами.
function reorderNoteIds(ids, dragId, targetId, after) {
  const from = ids.indexOf(dragId);
  if (from < 0) return ids.slice();
  const out = ids.slice();
  out.splice(from, 1);
  const to = out.indexOf(targetId);
  if (to < 0) return out;
  out.splice(after ? to + 1 : to, 0, dragId);
  return out;
}
// Куда ляжет заметка: над/под карточкой, а если курсор на фоне списка —
// по краю (выше первой / ниже последней).
function noteDropPosition(e) {
  const card = e.target.closest('.note');
  if (card) {
    const r = card.getBoundingClientRect();
    return { id: card.dataset.id, after: e.clientY > r.top + r.height / 2 };
  }
  const cards = $$('.note');
  if (!cards.length) return null;
  const first = cards[0].getBoundingClientRect();
  const last = cards[cards.length - 1].getBoundingClientRect();
  if (e.clientY < first.top + first.height / 2) return { id: cards[0].dataset.id, after: false };
  return { id: cards[cards.length - 1].dataset.id, after: true };
}
$('#notesGrid').addEventListener('dragstart', e => {
  const card = e.target.closest('.note');
  if (!card || e.target.closest('button, textarea, input, a')) { e.preventDefault(); return; }
  dragNoteId = card.dataset.id;
  card.classList.add('dragging');
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragNoteId); }
});
$('#notesGrid').addEventListener('dragenter', e => e.preventDefault());
$('#notesGrid').addEventListener('dragover', e => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; // без этого Chrome отменяет drop
  const pos = noteDropPosition(e);
  $$('.note').forEach(c => c.classList.remove('drop-before', 'drop-after'));
  if (!pos || pos.id === dragNoteId) return;
  const card = $$('.note').find(c => c.dataset.id === pos.id);
  if (card) card.classList.add(pos.after ? 'drop-after' : 'drop-before');
});
$('#notesGrid').addEventListener('drop', e => {
  e.preventDefault();
  if (!dragNoteId) return;
  const pos = noteDropPosition(e);
  if (!pos || pos.id === dragNoteId) { renderNotes(); return; }
  const ids = reorderNoteIds($$('.note').map(c => c.dataset.id), dragNoteId, pos.id, pos.after);
  ids.forEach((id, i) => { const n = db.notes.find(x => x.id === id); if (n) n.order = i; });
  save(); renderNotes();
});
$('#notesGrid').addEventListener('dragend', () => {
  $$('.note').forEach(c => c.classList.remove('dragging', 'drop-before', 'drop-after'));
  dragNoteId = null;
});

/* ===== Списки ===== */
function listItemHTML(listId, it) {
  return `<li class="${it.done ? 'done' : ''}">
    <button class="check" data-toggle-item="${listId}" data-id="${it.id}" title="Готово">${it.done ? '✅' : '○'}</button>
    <span>${esc(it.text)}</span>
    <button class="mini-x" data-del-item="${listId}" data-id="${it.id}" title="Удалить">✕</button>
  </li>`;
}
function renderLists() {
  const wrap = $('#listsWrap');
  if (!wrap) return;
  if (!db.lists.length) {
    wrap.innerHTML = '<div class="rem-empty">Пока нет ни одного списка 🫧<br>Создайте первый — например, «Подарки на 8 марта».</div>';
    return;
  }
  wrap.innerHTML = db.lists.map(list => {
    const active = list.items.filter(i => !i.done).length;
    const items = list.items.length
      ? list.items.map(it => listItemHTML(list.id, it)).join('')
      : '<li class="empty-li">Пока пусто 🫧</li>';
    return `<div class="list-card">
      <h3>${esc(list.name)} <small>${active} в работе</small></h3>
      <div class="list-add">
        <input type="text" id="listInput-${list.id}" placeholder="Добавить подзадачу…">
        <button class="btn" data-list-add="${list.id}" title="Добавить">＋</button>
      </div>
      <ul class="items">${items}</ul>
      <div class="list-actions">
        <button class="btn btn-danger btn-small" data-list-complete="${list.id}" title="Выполнить все подзадачи и удалить список">✔ Выполнить список</button>
      </div>
    </div>`;
  }).join('');
}
// Создать список с произвольным названием; возвращает список или null.
function createList(rawName) {
  const name = String(rawName || '').trim();
  if (!name) return null;
  const list = { id: uid(), name, items: [] };
  db.lists.push(list);
  save(); renderLists();
  const inp = $('#listNameInput');
  if (inp) inp.value = '';
  return list;
}
function addListSubtask(listId, inputId) {
  const list = db.lists.find(x => x.id === listId);
  if (!list) return false;
  const inp = $('#' + inputId);
  const text = (inp && inp.value ? String(inp.value) : '').trim();
  if (!text) return false;
  list.items.unshift({ id: uid(), text, done: false });
  save(); if (inp) inp.value = ''; renderLists();
  return true;
}
function toggleSubtask(listId, itemId) {
  const list = db.lists.find(x => x.id === listId);
  if (!list) return false;
  const it = list.items.find(x => x.id === itemId);
  if (!it) return false;
  it.done = !it.done;
  save(); renderLists();
  return it.done;
}
function delSubtask(listId, itemId) {
  const list = db.lists.find(x => x.id === listId);
  if (!list) return false;
  list.items = list.items.filter(x => x.id !== itemId);
  save(); renderLists();
  return true;
}
// «Выполнить список»: после подтверждения удаляет весь блок вместе с подзадачами.
function completeList(listId) {
  const list = db.lists.find(x => x.id === listId);
  if (!list) return false;
  if (!confirm('Выполнить список «' + list.name + '»? Он будет удалён вместе с подзадачами.')) return false;
  db.lists = db.lists.filter(x => x.id !== listId);
  save(); renderLists();
  return true;
}
$('#listCreateBtn').addEventListener('click', () => createList($('#listNameInput').value));
$('#listNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') createList($('#listNameInput').value); });

/* ===== Хотелки (общие, но разделены по людям: у каждого свой список) ===== */
let wishPhotoData = null;
function fmtWishDate(ts) {
  try { return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch (e) { return ''; }
}
// «Исполнено другим»: свою хотелку исполнить нельзя — только партнёр.
// Снять отметку может только тот, кто её поставил.
function wishToggleHTML(w) {
  const me = getUser();
  if (w.done) {
    return w.doneBy === me
      ? `<button class="check" data-wish-done="${w.id}" title="Снять отметку">↩️</button>`
      : '';
  }
  if (w.owner === me) return `<span class="wish-hint">Только ${me === 'gosha' ? 'Даша' : 'Гоша'} исполнит 💜</span>`;
  return `<button class="check" data-wish-done="${w.id}" title="Исполнить!">○</button>`;
}
function wishCard(w) {
  const doneBy = w.doneBy ? (w.doneBy === 'gosha' ? 'Гошей' : 'Дашей') : '';
  return `<div class="wish${w.done ? ' done' : ''}">
    ${w.data
      ? `<img class="wish-img" src="${esc(w.data)}" alt="${esc(w.text)}" data-photo="${esc(w.data)}" loading="lazy">`
      : `<div class="wish-img" style="display:grid;place-items:center;font-size:34px">💝</div>`}
    <div class="wish-body">
      <div class="wish-title">${esc(w.text)}</div>
      ${w.done ? `<span class="wish-done-by">💜 Исполнено${doneBy ? ' ' + doneBy : ''}${w.doneAt ? ' · ' + fmtWishDate(w.doneAt) : ''}</span>` : ''}
      ${w.link ? `<a class="wish-link" href="${safeUrl(w.link)}" target="_blank" rel="noopener">🔗 Открыть ссылку</a>` : ''}
      <div class="wish-btns">
        ${wishToggleHTML(w)}
        <button class="mini-x" data-wish-del="${w.id}" title="Удалить">✕</button>
      </div>
    </div>
  </div>`;
}
function renderWishlist() {
  const grid = $('#wishlistGrid');
  if (!grid) return;
  const byOwner = who => [...db.wishlist].filter(w => w.owner === who).sort((a, b) => (a.done - b.done) || (b.ts - a.ts));
  const sec = (who, label, emoji, empty) =>
    `<div class="wish-section"><h4>${esc(emoji)} Хотелки ${label}</h4>
      ${byOwner(who).length ? `<div class="wishlist-grid">${byOwner(who).map(wishCard).join('')}</div>` : `<p class="cal-tip">${empty}</p>`}
    </div>`;
  grid.innerHTML =
    sec('gosha', 'Гоши', '👦', 'Пока пусто. Нажми «Добавить» — мечты должны сбываться ✨') +
    sec('dasha', 'Даши', '👧', 'Пока пусто. Нажми «Добавить» — мечты должны сбываться ✨');
}
function openWishModal() {
  wishPhotoData = null;
  $('#wishText').value = '';
  $('#wishLink').value = '';
  $('#wishPhotoName').textContent = '';
  $('#wishPhoto').value = '';
  $('#wishOverlay').hidden = false;
  $('#wishText').focus();
}
$('#addWishBtn').addEventListener('click', openWishModal);
$('#wishPhoto').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try { wishPhotoData = await readFile(f); $('#wishPhotoName').textContent = '✅ фото готово'; }
  catch (err) { $('#wishPhotoName').textContent = 'не вышло :('; }
});
// Хотелка всегда в список вошедшего — выбора «для кого» нет.
function saveWishFromModal() {
  const text = $('#wishText').value.trim();
  if (!text) { alert('Напиши, что хочешь 💜'); return; }
  db.wishlist.unshift({
    id: uid(), text,
    link: $('#wishLink').value.trim() || '',
    data: wishPhotoData, owner: getUser(), done: false, ts: Date.now()
  });
  save(); $('#wishOverlay').hidden = true; renderWishlist();
}
$('#wishSave').addEventListener('click', saveWishFromModal);

// Отметить свидание «прошло» / снять отметку (кнопка есть на главной и в календаре).
function toggleDateDone(id) {
  const d = db.dates.find(x => x.id === id);
  if (!d) return false;
  d.done = !d.done;
  save(); renderHome(); renderCalendar();
  return d.done;
}

/* ===== Глобальные клики ===== */
function closeOverlay(id) {
  $('#' + id).hidden = true;
  if (id === 'eventOverlay') editingEventId = null;
}
document.addEventListener('click', e => {
  const userBtn = e.target.closest('[data-user]');
  if (userBtn) { setUser(userBtn.dataset.user); return; }

  const day = e.target.closest('[data-day]');
  if (day) { selectedDate = day.dataset.day; renderCalendar(); return; }

  const delEv = e.target.closest('[data-del-event]');
  if (delEv) { db.events = db.events.filter(x => x.id !== delEv.dataset.delEvent); save(); renderCalendar(); renderHome(); return; }

  const editEv = e.target.closest('[data-edit-event]');
  if (editEv) { openEventModal(editEv.dataset.editEvent); return; }

  const photoEv = e.target.closest('[data-photo-event]');
  if (photoEv) { addEventPhotoQuick(photoEv.dataset.photoEvent); return; }

  const photoDate = e.target.closest('[data-photo-date]');
  if (photoDate) { addDatePhotoQuick(photoDate.dataset.photoDate); return; }

  const answerDate = e.target.closest('[data-answer-date]');
  if (answerDate) {
    const d = db.dates.find(x => x.id === answerDate.dataset.answerDate);
    if (d) {
      const who = getUser();
      const val = answerDate.dataset.answer;
      d.responses = d.responses || {};
      d.responses[who] = d.responses[who] === val ? null : val;
      if (d.responses.gosha === 'yes' && d.responses.dasha === 'yes') celebrate(); // оба согласились — салют!
      save(); renderHome(); renderCalendar();
    }
    return;
  }
  const doneDate = e.target.closest('[data-done-date]');
  if (doneDate) { toggleDateDone(doneDate.dataset.doneDate); return; }
  const delDate = e.target.closest('[data-del-date]');
  if (delDate) { db.dates = db.dates.filter(x => x.id !== delDate.dataset.delDate); save(); renderHome(); renderCalendar(); return; }

  const pinNote = e.target.closest('[data-pin-note]');
  if (pinNote) { togglePinNote(pinNote.dataset.pinNote); return; }
  const delNote = e.target.closest('[data-del-note]');
  if (delNote) { deleteNote(delNote.dataset.delNote); return; }
  const editNote = e.target.closest('[data-edit-note]');
  if (editNote) { startEditNote(editNote.dataset.editNote); return; }
  const saveNoteBtn = e.target.closest('[data-save-note]');
  if (saveNoteBtn) { saveNoteEdit(saveNoteBtn.dataset.saveNote); return; }
  const cancelNoteBtn = e.target.closest('[data-cancel-note]');
  if (cancelNoteBtn) { cancelNoteEdit(); return; }

  const togItem = e.target.closest('[data-toggle-item]');
  if (togItem) { toggleSubtask(togItem.dataset.toggleItem, togItem.dataset.id); return; }
  const delItem = e.target.closest('[data-del-item]');
  if (delItem) { delSubtask(delItem.dataset.delItem, delItem.dataset.id); return; }
  const listAdd = e.target.closest('[data-list-add]');
  if (listAdd) { addListSubtask(listAdd.dataset.listAdd, 'listInput-' + listAdd.dataset.listAdd); return; }
  const listDone = e.target.closest('[data-list-complete]');
  if (listDone) { completeList(listDone.dataset.listComplete); return; }

  const delPhoto = e.target.closest('[data-del-photo]');
  if (delPhoto) { deletePhoto(delPhoto.dataset.delPhoto); return; }
  const pinPhoto = e.target.closest('[data-pin-photo]');
  if (pinPhoto) { const p = db.photos.find(x => x.id === pinPhoto.dataset.pinPhoto); if (p) p.pinned = !p.pinned; save(); renderPhotos(); return; }
  const selPhoto = e.target.closest('[data-sel-photo]');
  if (selPhoto) {
    const id = selPhoto.dataset.selPhoto;
    if (selectedPhotos.has(id)) selectedPhotos.delete(id); else selectedPhotos.add(id);
    renderPhotos(); return;
  }
  const photo = e.target.closest('[data-photo]');
  if (photo) {
    const id = photo.dataset.photo;
    const p = db.photos.find(x => x.id === id);
    if (p) {
      $('#lightbox').hidden = false;
      photoUrl(p, false).then(url => { if (url) $('#lightboxImg').src = url; });
    }
    return;
  }

  const wishDone = e.target.closest('[data-wish-done]');
  if (wishDone) {
    const w = db.wishlist.find(x => x.id === wishDone.dataset.wishDone);
    if (w) {
      const me = getUser();
      // Исполнить может только партнёр; снять отметку — только исполнивший.
      if (w.owner !== me && (!w.done || w.doneBy === me)) {
        if (w.done) { w.done = false; w.doneBy = null; w.doneAt = null; }
        else { w.done = true; w.doneBy = me; w.doneAt = Date.now(); }
        save();
      }
      renderWishlist();
    }
    return;
  }
  const wishDel = e.target.closest('[data-wish-del]');
  if (wishDel) { db.wishlist = db.wishlist.filter(x => x.id !== wishDel.dataset.wishDel); save(); renderWishlist(); return; }

  const labelOff = e.target.closest('[data-label-off]');
  if (labelOff) { removeLabelFromPhoto(labelOff.dataset.photoOff, labelOff.dataset.labelOff); return; }

  const labelNew = e.target.closest('[data-label-new]');
  if (labelNew) { openLabelOverlay(); return; }
  const labelDel = e.target.closest('[data-label-del]');
  if (labelDel) {
    const name = labelDel.dataset.labelDel;
    if (confirm(`Удалить лейбл «${name}»? Фото не пострадают.`)) deleteLabel(name);
    return;
  }
  const labelChip = e.target.closest('[data-label]');
  if (labelChip) { currentLabel = labelChip.dataset.label; eventFilter = { year: '', month: '', title: '' }; renderPhotos(); return; }

  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) { closeOverlay(closeBtn.dataset.close); return; }
  if (e.target.classList && e.target.classList.contains('overlay')) closeOverlay(e.target.id);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const open = document.querySelector('.overlay:not([hidden])');
    if (open) closeOverlay(open.id);
    return;
  }
  // Списки: Enter в поле подзадачи добавляет её
  if (e.key === 'Enter' && e.target && e.target.id && e.target.id.indexOf('listInput-') === 0) {
    e.preventDefault();
    addListSubtask(e.target.id.slice('listInput-'.length), e.target.id);
    return;
  }
  // Календарь: Enter / пробел на дне — как клик по ячейке
  if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.closest) {
    const day = e.target.closest('[data-day]');
    if (day) { e.preventDefault(); selectedDate = day.dataset.day; renderCalendar(); }
  }
});

/* ===== Фото ===== */
function readFile(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        const max = 900;
        if (w > max || h > max) { const k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        res(cv.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = rej;
      img.src = fr.result;
    };
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}
/* ===== Фото: лейблы, выбор нескольких, перетаскивание ===== */
let currentLabel = ''; // фильтр: '' = все фото
let eventFilter = { year: '', month: '', title: '' }; // витрина «📅 События»: фильтр кнопками «год → месяц → событие»
const selectedPhotos = new Set(); // id выбранных фото (для массовых операций)
const photoSort = (a, b) => (b.pinned - a.pinned) || ((a.order || 0) - (b.order || 0));
$('#photoInput').addEventListener('change', async e => {
  const files = [...e.target.files].slice(0, 10);
  for (const f of files) {
    try {
      const data = await readFile(f);
      // Дата съёмки из EXIF (если камера её записала). Нужна для «В этот день»:
      // фото показывается только по EXIF-дате или по дате события, НЕ по дате загрузки.
      let takenAt = null;
      try { takenAt = await extractExifDate(f); } catch (e) {}
      const ph = { id: uid(), data, title: f.name, labels: [], pinned: false, ts: Date.now(), order: 0, takenAt };
      db.photos.unshift(ph);
      setThumbUrl(ph.id, data); // мгновенный показ из кэша миниатюр
      // Сразу кладём в photoStore — дальше фото живёт в IndexedDB (зашифровано).
      // Миниатюру (WebP) генерируем при загрузке; после записи убираем base64 из памяти.
      try {
        const blob = dataUrlToBlob(data);
        if (blob && photoStore) {
          let thumb = null, thumbType = null;
          try { thumb = await makeThumbBlob(data, 256); thumbType = (thumb && thumb.type) || 'image/webp'; } catch (e) {}
          const meta = { type: blob.type || 'image/jpeg', thumbType, title: f.name, size: blob.size, takenAt };
          await photoStore.put(ph.id, blob, thumb, meta);
          delete ph.data;            // блоб в сторе — из памяти убираем base64
        }
      } catch (err) { console.warn('Не удалось сохранить фото в хранилище', err); }
    } catch (err) { console.warn('Не удалось загрузить фото', err); }
  }
  e.target.value = '';
  save(); renderPhotos();
});
function renderLabels() {
  const bar = $('#labelBar');
  if (!bar) return;
  const evCount = db.photos.filter(p => (p.labels || []).includes(EVENT_LABEL)).length;
  const dtCount = db.photos.filter(p => (p.labels || []).includes(DATE_LABEL)).length;
  const sysLabels = [EVENT_LABEL, DATE_LABEL];
  bar.innerHTML =
    `<button class="album-chip${currentLabel === '' ? ' active' : ''}" data-label="">🖼 Все фото (${db.photos.length})</button>` +
    (evCount ? `<button class="album-chip${currentLabel === EVENT_LABEL ? ' active' : ''}" data-label="${esc(EVENT_LABEL)}">📅 События (${evCount})</button>` : '') +
    (dtCount ? `<button class="album-chip${currentLabel === DATE_LABEL ? ' active' : ''}" data-label="${esc(DATE_LABEL)}">💞 Свидания (${dtCount})</button>` : '') +
    db.labels.filter(l => !sysLabels.includes(l)).map(l => `<button class="album-chip${currentLabel === l ? ' active' : ''}" data-label="${esc(l)}" draggable="true" title="Перетащи на фото, чтобы навесить лейбл"># ${esc(l)}<span class="label-del" data-label-del="${esc(l)}" title="Удалить лейбл">✕</span></button>`).join('') +
    `<button class="btn album-add-btn" data-label-new title="Создать лейбл">＋ Лейбл</button>`;
}
function deletePhoto(id) {
  const ph = db.photos.find(x => x.id === id);
  if (ph) {
    // фото удаляется и из событий, и из свиданий, чтобы в календаре не оставалось «мёртвых» миниатюр
    db.events.forEach(ev => {
      if (!Array.isArray(ev.photos)) return;
      ev.photos = ev.photos.filter(d => d !== ph.id);
      if (!ev.photos.length) delete ev.photos;
    });
    db.dates.forEach(dt => {
      if (!Array.isArray(dt.photos)) return;
      dt.photos = dt.photos.filter(d => d !== ph.id);
      if (!dt.photos.length) delete dt.photos;
    });
    if (photoStore && ph.id) photoStore.delete(ph.id); // убираем блоб из IndexedDB
  }
  db.photos = db.photos.filter(x => x.id !== id);
  selectedPhotos.delete(id);
  // Удаляем из кэша только удалённое фото — остальные миниатюры остаются
  if (id) thumbCache.delete(id);
  save(); renderPhotos(); renderCalendar(); renderHome();
}
// К каким событиям привязано фото — для фильтра «год → месяц → событие».
// ev.photos хранит id фото (v6+).
function eventsForPhoto(p) {
  const res = [];
  for (const ev of db.events) {
    if (!Array.isArray(ev.photos)) continue;
    const hit = ev.photos.includes(p.id);
    if (!hit) continue;
    const [y, m] = (ev.date || '').split('-');
    if (!y || !m) continue;
    res.push({ title: ev.title, year: y, month: m });
  }
  return res;
}
function filteredPhotos() {
  let list = [...db.photos].sort(photoSort).filter(p => !currentLabel || (p.labels || []).includes(currentLabel));
  if (currentLabel === EVENT_LABEL) {
    const f = eventFilter;
    if (f.year || f.month || f.title) {
      list = list.filter(p => {
        const evs = eventsForPhoto(p);
        if (f.year && !evs.some(e => e.year === f.year)) return false;
        if (f.month && !evs.some(e => e.month === f.month)) return false;
        if (f.title && !evs.some(e => e.title === f.title)) return false;
        return true;
      });
    }
  }
  return list;
}
// Дебаунс: несколько вызовов renderPhotos() в одном кадре схлопываются в один
// рендер (requestAnimationFrame). Без rAF (песочница тестов) — рендер синхронный.
let photosRenderQueued = false;
function renderPhotos() {
  if (photosRenderQueued) return 'coalesced';
  photosRenderQueued = true;
  if (typeof requestAnimationFrame === 'function') {
    let done = false;
    const flush = () => {
      if (done) return;
      done = true;
      photosRenderQueued = false;
      renderPhotosNow();
    };
    requestAnimationFrame(flush);
    if (typeof setTimeout === 'function') setTimeout(flush, 120); // вкладка в фоне: rAF спит
  } else {
    photosRenderQueued = false;
    renderPhotosNow();
  }
}
function renderPhotosNow() {
  const grid = $('#photosGrid');
  if (!grid) return;
  renderLabels();
  // витрина «📅 События»: фильтр кнопками «год → месяц → событие»
  renderEventBar();
  const list = filteredPhotos();
  const hint = $('#dragHint');
  if (hint) hint.style.display = list.length > 1 ? 'block' : 'none';
  const selBar = $('#photoSelBar');
  if (selBar) {
    selBar.style.display = selectedPhotos.size ? 'flex' : 'none';
    if (selectedPhotos.size) { const c = $('#selCount'); if (c) c.textContent = selectedPhotos.size; }
  }
  grid.innerHTML = list.length ? list.map(p => `
    <div class="photo${p.pinned ? ' pinned' : ''}${selectedPhotos.has(p.id) ? ' selected' : ''}" data-id="${p.id}" data-drag-photo draggable="true">
      <img src="${esc(photoSrc(p))}" alt="${esc(p.title)}" data-photo="${esc(p.id)}" loading="lazy">
      <button class="sel-photo${selectedPhotos.has(p.id) ? ' active' : ''}" data-sel-photo="${p.id}" title="${selectedPhotos.has(p.id) ? 'Снять выбор' : 'Выбрать'}">${selectedPhotos.has(p.id) ? '✓' : '○'}</button>
      <button class="pin-photo${p.pinned ? ' active' : ''}" data-pin-photo="${p.id}" title="${p.pinned ? 'Открепить' : 'Закрепить'}">${p.pinned ? '⭐' : '☆'}</button>
      <button class="del-photo" data-del-photo="${p.id}" title="Удалить">✕</button>
      ${(p.labels || []).length ? `<div class="photo-labels">${p.labels.map(l =>
        `<span class="photo-label">${esc(l)}${l === EVENT_LABEL || l === DATE_LABEL ? '' : `<span class="photo-label-del" data-label-off="${esc(l)}" data-photo-off="${p.id}" title="Убрать лейбл с фото">✕</span>`}</span>`
      ).join('')}</div>` : ''}
      ${currentLabel === EVENT_LABEL && p.title ? `<span class="photo-caption">${esc(eventFilter.title || p.title)}</span>` : ''}
    </div>`).join('')
    : '<p class="cal-tip">📷 Загрузите ваши фото — они будут храниться локально, прямо в браузере.</p>';
}
// Витрина «📅 События»: кнопки «год → месяц → событие» появляются по мере выбора
function eventPhotosCount(year, month, title) {
  let n = 0;
  for (const p of db.photos) {
    if (!(p.labels || []).includes(EVENT_LABEL)) continue;
    if (eventsForPhoto(p).some(e =>
      (!year || e.year === year) && (!month || e.month === month) && (!title || e.title === title))) n++;
  }
  return n;
}
function renderEventBar() {
  const evBar = $('#eventBar');
  if (!evBar) return;
  const show = currentLabel === EVENT_LABEL;
  evBar.style.display = show ? 'flex' : 'none';
  if (!show) return;
  const f = eventFilter;
  // события, у которых есть фото в галерее (ev.photos хранит id фото)
  const photoIds = new Set(db.photos.map(p => p.id));
  const evs = db.events.filter(ev => Array.isArray(ev.photos) && ev.photos.some(d => photoIds.has(d)));
  const years = [...new Set(evs.map(e => (e.date || '').slice(0, 4)).filter(Boolean))].sort((a, b) => b - a);
  const monthsOf = year => [...new Set(evs.filter(e => (e.date || '').slice(0, 4) === year).map(e => (e.date || '').slice(5, 7)).filter(Boolean))].sort();
  const titlesOf = (year, month) => {
    const set = new Set();
    for (const e of evs) {
      const [y, m] = (e.date || '').split('-');
      if ((!year || y === year) && (!month || m === month)) set.add(e.title);
    }
    return [...set].sort();
  };
  const yearsEl = $('#eventYears');
  if (yearsEl) {
    yearsEl.style.display = years.length ? 'flex' : 'none';
    yearsEl.innerHTML = years.map(y =>
      `<button class="ev-btn${f.year === y ? ' active' : ''}" data-ev-year="${y}">${y} <span class="cnt">${eventPhotosCount(y, '', '')}</span></button>`).join('');
  }
  const monthsEl = $('#eventMonths');
  if (monthsEl) {
    const months = f.year ? monthsOf(f.year) : [];
    monthsEl.style.display = months.length ? 'flex' : 'none';
    monthsEl.innerHTML = months.map(m =>
      `<button class="ev-btn${f.month === m ? ' active' : ''}" data-ev-month="${m}">${MONTHS[Number(m) - 1]} <span class="cnt">${eventPhotosCount(f.year, m, '')}</span></button>`).join('');
  }
  const titlesEl = $('#eventTitles');
  if (titlesEl) {
    const titles = f.month ? titlesOf(f.year, f.month) : [];
    titlesEl.style.display = titles.length ? 'flex' : 'none';
    titlesEl.innerHTML = titles.map(t =>
      `<button class="ev-btn${f.title === t ? ' active' : ''}" data-ev-title="${esc(t)}">${esc(t)} <span class="cnt">${eventPhotosCount(f.year, f.month, t)}</span></button>`).join('');
  }
  const reset = $('#eventReset');
  if (reset) reset.style.display = (f.year || f.month || f.title) ? 'inline-block' : 'none';
}
// Лейблы: удаление (фото не трогаем), добавление выбранным, создание
function deleteLabel(name) {
  if (name === EVENT_LABEL || name === DATE_LABEL) return; // служебные лейблы защищены от удаления
  db.labels = db.labels.filter(l => l !== name);
  db.photos.forEach(p => { if (p.labels) p.labels = p.labels.filter(l => l !== name); });
  if (currentLabel === name) currentLabel = '';
  selectedPhotos.clear();
  save(); renderPhotos();
}
function applyLabelToPhotos(name, ids) {
  const set = new Set(ids);
  db.photos.forEach(p => {
    if (!set.has(p.id)) return;
    if (!Array.isArray(p.labels)) p.labels = [];
    if (!p.labels.includes(name)) p.labels.push(name);
  });
}
// Применение лейбла к выбранным фото; после действия выделение снимается.
function applyLabelToSelected(name) {
  applyLabelToPhotos(name, [...selectedPhotos]);
  selectedPhotos.clear();
}
// Убрать лейбл с конкретного фото (крестик ✕ на бейдже фото).
function removeLabelFromPhoto(photoId, name) {
  const p = db.photos.find(x => x.id === photoId);
  if (!p || !Array.isArray(p.labels) || !p.labels.includes(name)) return;
  p.labels = p.labels.filter(l => l !== name);
  save(); renderPhotos();
}
function openLabelOverlay() {
  $('#labelNewName').value = '';
  const pick = $('#labelPick');
  const manualLabels = db.labels.filter(l => l !== EVENT_LABEL && l !== DATE_LABEL);
  pick.innerHTML = manualLabels.length
    ? '<option value="">— выбери лейбл —</option>' + manualLabels.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('')
    : '<option value="">Сначала создай новый лейбл выше</option>';
  const hint = $('#labelModalHint');
  if (hint) hint.textContent = selectedPhotos.size ? `Фото выбрано: ${selectedPhotos.size}` : 'Можно просто создать лейбл — он появится в фильтре.';
  $('#labelOverlay').hidden = false;
  $('#labelNewName').focus();
}
$('#selAddLabelBtn').addEventListener('click', openLabelOverlay);
$('#selClearBtn').addEventListener('click', () => { selectedPhotos.clear(); renderPhotos(); });
// Фильтр витрины «📅 События»: клик по кнопкам «год → месяц → событие» (повторный клик сбрасывает уровень)
document.addEventListener('click', e => {
  const yearBtn = e.target.closest('[data-ev-year]');
  if (yearBtn) {
    const val = yearBtn.dataset.evYear;
    eventFilter.year = eventFilter.year === val ? '' : val;
    eventFilter.month = ''; eventFilter.title = '';
    renderPhotos(); return;
  }
  const monthBtn = e.target.closest('[data-ev-month]');
  if (monthBtn) {
    const val = monthBtn.dataset.evMonth;
    eventFilter.month = eventFilter.month === val ? '' : val;
    eventFilter.title = '';
    renderPhotos(); return;
  }
  const titleBtn = e.target.closest('[data-ev-title]');
  if (titleBtn) {
    const val = titleBtn.dataset.evTitle;
    eventFilter.title = eventFilter.title === val ? '' : val;
    renderPhotos(); return;
  }
  const resetBtn = e.target.closest('[data-ev-reset]');
  if (resetBtn) {
    eventFilter = { year: '', month: '', title: '' };
    renderPhotos(); return;
  }
});
$('#labelNewBtn').addEventListener('click', () => {
  const name = $('#labelNewName').value.trim();
  if (!name) return;
  if (!db.labels.includes(name)) db.labels.push(name);
  applyLabelToSelected(name);
  save(); $('#labelOverlay').hidden = true; renderPhotos();
});
$('#labelApplyBtn').addEventListener('click', () => {
  const name = $('#labelPick').value;
  if (!name) return;
  applyLabelToSelected(name);
  save(); $('#labelOverlay').hidden = true; renderPhotos();
});
$('#labelNewName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#labelNewBtn').click(); });
// Перетаскивание: меняем порядок внутри текущего фильтра,
// а чип лейбла, брошенный на фото, навешивает лейбл.
let dragPhotoId = null;
let dragLabel = null; // название лейбла, чип которого сейчас тащим
$('#photosGrid').addEventListener('dragstart', e => {
  const el = e.target.closest('[data-drag-photo]');
  if (!el) return;
  dragPhotoId = el.dataset.id;
  e.dataTransfer.effectAllowed = 'copyMove'; // move — перестановка, copy — лейбл
  e.dataTransfer.setData('text/plain', dragPhotoId);
});
$('#photosGrid').addEventListener('dragover', e => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; });
$('#photosGrid').addEventListener('drop', e => {
  e.preventDefault();
  if (dragLabel) { // тащили чип лейбла: навешиваем на фото (и все отмеченные)
    const target = e.target.closest('[data-drag-photo]');
    const name = dragLabel;
    dragLabel = null;
    const ids = new Set(selectedPhotos);
    if (target) ids.add(target.dataset.id);
    if (ids.size) { applyLabelToPhotos(name, ids); selectedPhotos.clear(); save(); renderPhotos(); }
    return;
  }
  if (!dragPhotoId) return;
  const target = e.target.closest('[data-drag-photo]');
  const list = filteredPhotos();
  const fromIdx = list.findIndex(p => p.id === dragPhotoId);
  const toIdx = target ? list.findIndex(p => p.id === target.dataset.id) : list.length - 1;
  dragPhotoId = null;
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
  const moved = list.splice(fromIdx, 1)[0];
  list.splice(toIdx, 0, moved);
  // пересчитываем порядок: закреплённые всегда сверху, остальные — в перетащенном порядке
  [...list.filter(p => p.pinned), ...list.filter(p => !p.pinned)].forEach((p, i) => {
    const ph = db.photos.find(x => x.id === p.id);
    if (ph) ph.order = i;
  });
  save(); renderPhotos();
});
$('#photosGrid').addEventListener('dragend', () => { dragPhotoId = null; });
// Перетаскивание фото на кнопку лейбла: лейбл получает и перетаскиваемое фото, и все отмеченные (если есть)
$('#labelBar').addEventListener('dragover', e => {
  const chip = e.target.closest('.album-chip[data-label]');
  if (!chip || e.target.closest('[data-label-del]') || !chip.dataset.label || chip.dataset.label === EVENT_LABEL || chip.dataset.label === DATE_LABEL) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
$('#labelBar').addEventListener('dragenter', e => {
  e.preventDefault();
  const chip = e.target.closest('.album-chip[data-label]');
  if (!chip || e.target.closest('[data-label-del]') || !chip.dataset.label || chip.dataset.label === EVENT_LABEL || chip.dataset.label === DATE_LABEL) return;
  chip.classList.add('drag-over');
});
// Обратное направление: чип лейбла можно перетащить прямо на фото
$('#labelBar').addEventListener('dragstart', e => {
  const chip = e.target.closest('.album-chip[data-label]');
  if (!chip || e.target.closest('[data-label-del]') || !chip.dataset.label || chip.dataset.label === EVENT_LABEL || chip.dataset.label === DATE_LABEL) { e.preventDefault(); return; }
  dragLabel = chip.dataset.label;
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData('text/plain', dragLabel);
});
$('#labelBar').addEventListener('dragend', () => { dragLabel = null; });
$('#labelBar').addEventListener('dragleave', e => {
  const chip = e.target.closest('.album-chip[data-label]');
  if (!chip) return;
  if (e.relatedTarget && chip.contains(e.relatedTarget)) return; // ещё внутри чипа
  chip.classList.remove('drag-over');
});
$('#labelBar').addEventListener('drop', e => {
  e.preventDefault();
  const chip = e.target.closest('.album-chip[data-label]');
  if (chip) chip.classList.remove('drag-over');
  if (!dragPhotoId) return;
  const name = chip && chip.dataset.label;
  if (!name || name === EVENT_LABEL || name === DATE_LABEL || e.target.closest('[data-label-del]')) return;
  const targets = new Set(selectedPhotos); // массовое назначение: всем отмеченным…
  targets.add(dragPhotoId);                // …и перетаскиваемому фото
  applyLabelToPhotos(name, targets);
  dragPhotoId = null;
  selectedPhotos.clear(); // действие выполнено — выделение снимаем
  save(); renderPhotos();
});

/* ===== Песня ===== */
$('#songAudio').addEventListener('error', () => {
  $('#songHint').textContent = 'Файл пока не найден. Положи mp3 в папку music/ с именем nasha-pesnya.mp3 — и нажми ▶';
});
$('#songAudio').addEventListener('canplay', () => {
  $('#songHint').textContent = '▶ Нажми play — и заиграет наша песня! 💜';
});

/* ===== Настройки ===== */
/* ===== Настройки: резервная копия и место в браузере ===== */
function renderSettings() {
  const bytes = new Blob([JSON.stringify(db)]).size || JSON.stringify(db).length;
  const kb = Math.max(1, Math.round(bytes / 1024));
  const si = $('#storageInfo');
  if (si) si.textContent = kb >= 1024 ? (kb / 1024).toFixed(1) + ' МБ' : kb + ' КБ';
  // Фото-хранилище (IndexedDB) считаем асинхронно и показываем отдельной строкой
  if (photoStore) {
    photoStore.refreshSizes().then(sz => {
      const fk = Math.max(1, Math.round((sz.bytes || 0) / 1024));
      const fs = $('#photoStorageInfo');
      if (fs) fs.textContent = `${sz.count} фото · ${fk >= 1024 ? (fk / 1024).toFixed(1) + ' МБ' : fk + ' КБ'}`;
    }).catch(() => {});
  }
  const hint = $('#backupHint');
  if (!hint) return;
  if (!db.backupDate) {
    hint.innerHTML = '<span style="color:#d97706;font-weight:700;font-size:14px">⚠️ Резервная копия ещё не делалась. Нажми «Скачать копию» — так ничего не потеряется.</span>';
  } else {
    const days = Math.floor((Date.now() - db.backupDate) / 86400000);
    hint.innerHTML = days >= 30
      ? `<span style="color:#d97706;font-weight:700;font-size:14px">⚠️ Последняя копия была ${days} дн. назад. Самое время обновить её.</span>`
      : `<span style="color:#059669;font-weight:700;font-size:14px">✅ Копия сделана ${days === 0 ? 'сегодня' : days + ' дн. назад'}. Всё под защитой.</span>`;
  }
  // Личный кабинет: кто вошёл, чьи пароли есть
  const lkUser = $('#lkUser');
  if (lkUser) lkUser.textContent = getUser() === 'dasha' ? '👧 Даша' : '👦 Гоша';
  const vault = loadVault();
  const hasPass = who => !!(vault && (vault.keys || []).some(k => k.who === who));
  const info = $('#lkPassInfo');
  if (info) info.innerHTML =
    `<span><b>Гоша:</b> ${hasPass('gosha') ? '<span style="color:#059669;font-weight:700">✅ пароль есть</span>' : '<span style="color:var(--muted)">пароля нет</span>'}</span>` +
    `<span><b>Даша:</b> ${hasPass('dasha') ? '<span style="color:#059669;font-weight:700">✅ пароль есть</span>' : '<span style="color:var(--muted)">пароля нет</span>'}</span>`;
  const addBtn = $('#addPassBtn');
  if (addBtn) {
    addBtn.style.display = '';
    addBtn.textContent = (hasPass('gosha') && hasPass('dasha')) ? '🔑 Сменить пароль партнёра' : '🔑 Добавить пароль для партнёра';
  }
}
// Экспорт — зашифрованный сейф: без пароля файл не прочитать.
// Фото-блобы лежат в IndexedDB (не в localStorage), поэтому их зашифрованные
// копии добавляем в архив отдельной секцией photos.
async function exportData() {
  db.backupDate = Date.now();
  await save();
  const vault = loadVault();
  let photoSection = null;
  if (photoStore) {
    try {
      const blobs = await photoStore.exportBlobs();
      if (blobs.length) photoSection = { ver: 1, blobs };
    } catch (e) { console.warn('Не удалось собрать фото для бэкапа', e); }
  }
  const out = photoSection ? { ...vault, photos: photoSection } : vault;
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nasha-vselennaya-backup-encrypted.json';
  a.click();
  URL.revokeObjectURL(a.href);
  renderSettings();
  return out;
}
$('#exportBtn').addEventListener('click', () => { exportData(); });
async function importData(text) {
  try {
    const d = JSON.parse(text);
    if (d && d.ver && d.db && Array.isArray(d.keys)) {
      // это зашифрованный сейф — просто восстанавливаем, войти можно своим паролем
      store.set(VAULT_KEY, JSON.stringify(d));
      // Фото-секция v6: зашифрованные блобы возвращаем в хранилище
      if (d.photos && d.photos.ver === 1 && Array.isArray(d.photos.blobs) && photoStore) {
        try { await photoStore.importBlobs(d.photos.blobs); } catch (e) { console.warn('Не удалось восстановить фото', e); }
      }
      return true;
    }
    // старый открытый бэкап — сразу шифруем текущим ключом
    db = migrateDB({ ...defaultDB(), ...d });
    save();
    return true;
  } catch (err) { return null; }
}
$('#importInput').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const fr = new FileReader();
  fr.onload = async () => {
    const ok = await importData(fr.result); // ждём и сейф, и фото-блобы
    if (!ok) { alert('Не получилось прочитать файл:('); return; }
    e.target.value = '';
    location.reload();
  };
  fr.readAsText(f);
});
$('#resetBtn').addEventListener('click', () => {
  if (confirm('Точно удалить ВСЕ данные? Это не отменить.')) {
    store.remove(VAULT_KEY);
    store.remove(KEY);
    location.reload();
  }
});

/* ===== Личный кабинет: смена пароля и пароль для партнёра ===== */
let passMode = 'set'; // 'set' — пароль для партнёра, 'change' — сменить свой
function openPassModal(mode) {
  passMode = mode;
  const whoSel = $('#passWho');
  if (whoSel) {
    whoSel.innerHTML = ['gosha', 'dasha']
      .filter(w => w !== getUser())
      .map(w => `<option value="${w}">${w === 'dasha' ? '👧 Даша' : '👦 Гоша'}</option>`)
      .join('');
  }
  $('#passWhoWrap').hidden = mode !== 'set';
  $('#passCurWrap').hidden = mode !== 'change';
  $('#passTitle').textContent = mode === 'change' ? '🔑 Сменить свой пароль' : '🔑 Пароль для партнёра';
  $('#passCur').value = '';
  $('#passNew').value = '';
  $('#passNew2').value = '';
  $('#passErr').textContent = '';
  $('#passOverlay').hidden = false;
  const first = mode === 'change' ? $('#passCur') : $('#passNew');
  if (first && first.focus) first.focus();
}
async function savePass() {
  const err = $('#passErr');
  const p1 = $('#passNew').value;
  const p2 = $('#passNew2').value;
  if (p1.length < 6) { if (err) err.textContent = 'Пароль должен быть не короче 6 символов.'; return; }
  if (p1 !== p2) { if (err) err.textContent = 'Пароли не совпадают — проверь ещё раз.'; return; }
  let ok;
  if (passMode === 'change') ok = await changePass($('#passCur').value, p1);
  else ok = await savePassFor($('#passWho').value, p1);
  if (!ok) { if (err) err.textContent = 'Не получилось. Проверь текущий пароль и попробуй ещё раз.'; return; }
  $('#passOverlay').hidden = true;
  renderSettings();
  if (passMode === 'change') alert('Пароль обновлён 💜');
  else {
    const who = $('#passWho').value === 'dasha' ? 'Даша' : 'Гоша';
    alert('Пароль сохранён — теперь «' + who + '» может войти 💜');
  }
}
$('#passSave').addEventListener('click', savePass);
$('#changePassBtn').addEventListener('click', () => openPassModal('change'));
$('#addPassBtn').addEventListener('click', () => openPassModal('set'));
$('#lockNowBtn').addEventListener('click', lock);

/* ===== Настройки: уменьшенное движение =====
   data-motion на <html>: 'reduced' — анимации всегда выключены, 'full' — всегда
   включены (перекрывает систему). Без атрибута — уважаем prefers-reduced-motion. */
const MOTION_KEY = 'universe_motion';
function getMotion() {
  const v = store.get(MOTION_KEY);
  return (v === 'reduced' || v === 'full') ? v : null;
}
function applyMotion(m) {
  const doc = document.documentElement;
  if (!doc || !doc.dataset) return;
  if (m === 'reduced' || m === 'full') doc.dataset.motion = m;
  else {
    try { doc.removeAttribute('data-motion'); } catch (e) {}
    try { delete doc.dataset.motion; } catch (e) {}
  }
  const t = $('#motionToggle');
  if (t) t.checked = (m === 'reduced');
}
function setMotion(m) {
  const v = m === 'reduced' ? 'reduced' : 'full';
  store.set(MOTION_KEY, v);
  applyMotion(v);
}
function motionReduced() {
  const doc = document.documentElement;
  if (doc && doc.dataset) {
    if (doc.dataset.motion === 'reduced') return true;
    if (doc.dataset.motion === 'full') return false;
  }
  try {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  } catch (e) {}
  return false;
}
const mt = $('#motionToggle');
if (mt) mt.addEventListener('change', e => setMotion(e.target.checked ? 'reduced' : 'full'));

/* ===== Летающие сердечки ===== */
function spawnHeart() {
  if (motionReduced()) return; // анимации отключены — сердечки не запускаем
  const h = document.createElement('span');
  h.className = 'heart';
  h.textContent = ['💜', '💖', '💕', '🌸', '✨'][Math.floor(Math.random() * 5)];
  h.style.left = Math.random() * 100 + 'vw';
  h.style.fontSize = (12 + Math.random() * 16) + 'px';
  h.style.animationDuration = (6 + Math.random() * 6) + 's';
  document.body.appendChild(h);
  setTimeout(() => h.remove(), 12000);
}

$('#themeToggle').addEventListener('click', toggleTheme);
$('#settingsThemeBtn').addEventListener('click', toggleTheme);

/* ===== Запуск: приложение закрыто, пока не вошли ===== */
function initAuth() {
  initPhotoStore(); // открываем IndexedDB (или fallback) до первого входа
  renderUserChip();
  setTheme(getTheme());
  applyMotion(getMotion());
  lastActivity = Date.now();
  startAutoLock();
  document.body.classList.add('auth');
  showAuth(loadVault() ? 'lock' : 'setup'); // сейф есть → вход; нет → первое создание пароля
  pendingAuthWho = 'gosha';
  renderAuthWho();
  // Если JS по какой-то причине не выполнится — контент так и останется скрытым
  // (body.auth прячет шапку и main), никто ничего не увидит.
}
initAuth();
// Клик по чипу «Гоша ▾ / Даша ▾» = заблокировать и дать войти другому
$('#userChip').addEventListener('click', lock);

setInterval(() => {
  // сердечки летают не слишком часто, не под замком и не во время открытых модалок
  if (isHidden() || authLocked) return;
  if (document.querySelector('.overlay:not([hidden])')) return;
  if (!$('#view-home') || !$('#view-home').classList.contains('active')) return;
  spawnHeart();
}, 3800);
// Коллаж «Наша история» стабилен в течение дня — обновлять его не нужно.
spawnHeart();




