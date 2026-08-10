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
  // Сбои сохранения показывают свой тост (store.set / save), поэтому здесь только
  // логируем. Раньше любой «безобидный» rejection (например, отменённый View
  // Transition при входе) пугал ложным «Не удалось сохранить — попробуй ещё раз».
  window.addEventListener('unhandledrejection', e => {
    console.warn('[unhandledrejection]', e && e.reason ? e.reason : e);
  });
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

