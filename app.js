/* ===== Наша вселенная — app.js ===== */
'use strict';

const START_DATE = '2026-03-30';
const KEY = 'universe';

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const esc = s => String(s).replace(/[&<>"']/g, c => (
  {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const isHidden = () => !!(document.hidden || document.visibilityState === 'hidden');

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
const DB_VERSION = 3;
function defaultDB() {
  return {
    version: DB_VERSION,
    events: [{ id: uid(), title: 'Мы начали встречаться', date: START_DATE, emoji: '💜', repeat: true }],
    notes: [], shopping: [], todos: [], photos: [], dates: [],
    wishlist: [], labels: [], backupDate: null
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
  d.version = DB_VERSION;
  return d;
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
  const dbBlob = await aesEnc(masterKey, enc.encode(JSON.stringify(db)));
  const salt = randBytes(16);
  const pwdKey = await pbkdf2Key(pass, salt, PBKDF2_ITERS);
  const wrap = { who, s: b64(salt), ...(await aesEnc(pwdKey, kraw)) };
  localStorage.setItem(VAULT_KEY, JSON.stringify({ ver: 1, a: PBKDF2_ITERS, db: dbBlob, keys: [wrap] }));
  localStorage.removeItem(KEY); // старый открытый файл больше не нужен — всё уже зашифровано
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
  const saved = localStorage.getItem(THEME_KEY);
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
function go(view) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'home') renderHome();
  if (view === 'calendar') { calY = new Date().getFullYear(); calM = new Date().getMonth(); selectedDate = null; renderCalendar(); }
  if (view === 'notes') renderNotes();
  if (view === 'lists') renderLists();
  if (view === 'wishlist') renderWishlist();
  if (view === 'photos') renderPhotos();
  if (view === 'settings') renderSettings();
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

  const box = $('#reminders');
  if (!rem.length) {
    box.innerHTML = '<div class="rem-empty">🌙 Пока нет ближайших событий.<br>Добавь памятную дату во вкладке «Календарь».</div>';
  } else {
    box.innerHTML = '<h3>💌 Скоро важное событие</h3>' + rem.map(r => {
      const label = r.days === 0 ? 'сегодня!' : r.days === 1 ? 'завтра!' : `через ${r.days} дн.`;
      return `<div class="rem ${r.days === 0 ? 'rem-today' : ''}">${esc(r.ev.emoji)} <b>${esc(r.ev.title)}</b> <span>${label}</span></div>`;
    }).join('');
  }
  renderDates();
  renderFloatingPhotos();
  renderCompliment();
  renderCountdown();
  renderMobilePhotos();
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
  grid.innerHTML = [...db.photos].sort(photoSort).slice(0, 12).map(p =>
    `<img src="${p.data}" alt="${esc(p.title)}" data-photo="${p.data}" loading="lazy">`).join('');
}

/* ===== Свидания ===== */
function datesOn(dateStr) {
  return db.dates.filter(d => d.date === dateStr && !d.done);
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
    box.innerHTML = '<div class="rem-empty">💘 Свиданий пока нет.<br>Нажми «Назначить свидание» — и пусть оно обязательно случится!</div>';
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

/* ===== Парящие фото на главной ===== */
// 5 «гнёзд» вокруг блока приветствия — несимметрично, в стороне от текста.
// Из них случайно заполняются 3, остальные пустуют (это даёт живость).
const FLOAT_SLOTS = [
  { st: 'left:-16px; top:8%',     rot: -8, dur: 6.2, delay: 0    },
  { st: 'right:-16px; top:16%',   rot:  7, dur: 5.6, delay: 0.7  },
  { st: 'left:16%; top:-26px',    rot: -4, dur: 6.8, delay: 1.3  },
  { st: 'right:15%; bottom:-18px',rot:  9, dur: 5.9, delay: 0.4  },
  { st: 'left:3%; bottom:4%',     rot: -7, dur: 6.5, delay: 1.8  }
];
function renderFloatingPhotos() {
  const box = $('#floatPhotos');
  if (!db.photos.length) { box.innerHTML = ''; return; }
  // Слоты создаём только один раз — анимация парения не перезапускается
  if (!box.children.length) {
    box.innerHTML = FLOAT_SLOTS.map((s, i) =>
      `<img class="float-photo" data-slot="${i}" alt="" src="" style="${s.st};--r:${s.rot}deg;animation-duration:${s.dur}s;animation-delay:${s.delay}s">`).join('');
    // Первая заливка — сразу, без задержки и без гашения
    const first = pickFloating();
    [...box.querySelectorAll('.float-photo')].forEach((im, i) => {
      const p = first[i];
      if (!p) { im.style.display = 'none'; return; }
      im.src = p.data;
      im.dataset.src = p.data;
    });
    return;
  }
  const picks = pickFloating();
  [...box.querySelectorAll('.float-photo')].forEach((im, i) => {
    const p = picks[i];
    if (!p) { im.style.display = 'none'; return; }
    im.style.display = '';
    if (im.dataset.src !== p.data) {
      im.style.opacity = '0';                    // плавно гасим…
      setTimeout(() => {
        im.src = p.data;                          // …меняем фото…
        im.dataset.src = p.data;
        im.style.opacity = '1';                   // …и плавно проявляем
      }, 650);
    }
  });
}
function pickFloating() {
  const photos = [...db.photos];
  const picks = new Array(FLOAT_SLOTS.length).fill(null);
  const slots = [...FLOAT_SLOTS];
  for (let n = Math.min(3, photos.length); n > 0; n--) {
    const si = Math.floor(Math.random() * slots.length);
    const slot = slots.splice(si, 1)[0];
    picks[FLOAT_SLOTS.indexOf(slot)] = photos.splice(Math.floor(Math.random() * photos.length), 1)[0];
  }
  return picks;
}

/* ===== Календарь ===== */
let calY = new Date().getFullYear(), calM = new Date().getMonth(), selectedDate = null;
let editingEventId = null;
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function iso(y, m, d) { return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
function eventsOn(dateStr, m, d) {
  return db.events.filter(ev => {
    const [ey, em, ed] = ev.date.split('-').map(Number);
    return ev.repeat ? (em - 1 === m && ed === d) : ev.date === dateStr;
  });
}
function renderCalendar() {
  $('#calTitle').textContent = MONTHS[calM] + ' ' + calY;
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
    cells += `<div class="cal-cell${isToday ? ' today' : ''}${selectedDate === ds ? ' selected' : ''}${dts.length ? ' has-date' : ''}" data-day="${ds}" role="button" tabindex="0">` +
      `<span class="cal-num">${d}</span>` +
      evs.map(e => `<span class="cal-dot" title="${esc(e.title)}">${esc(e.emoji)}</span>`).join('') +
      (dts.length ? `<span class="cal-dot date-dot" title="Свидание">${esc(dts[0].emoji || '💘')}</span>` : '') +
      '</div>';
  }
  $('#calendar').innerHTML = html + `<div class="cal-row">${cells}</div>`;
  renderDayPanel();
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
      ? evs.map(e => `<div class="day-event">${esc(e.emoji)} <span>${esc(e.title)}</span> <button class="mini-x" data-edit-event="${e.id}" title="Изменить">✏️</button> <button class="mini-x" data-del-event="${e.id}" title="Удалить">✕</button></div>`).join('')
      : '<p class="cal-tip">В этот день событий пока нет.</p>') +
    (dts.length
      ? `<div class="day-sub">💘 Свидания</div>` + dts.map(dt =>
          `<div class="day-event date-evt">${esc(dt.emoji || '💘')} <span>${dt.time ? '🕐 ' + esc(dt.time) + ' · ' : ''}${esc(dt.place || dt.note || 'Свидание')}</span> <button class="mini-x" data-del-date="${dt.id}" title="Удалить">✕</button></div>`).join('')
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
$('#addEventBtn').addEventListener('click', openEventModal);

function openEventModal(id) {
  const t = new Date();
  $('#evDate').value = iso(t.getFullYear(), t.getMonth(), t.getDate());
  $('#evTitle').value = '';
  $('#evEmoji').value = '💜';
  $('#evRepeat').checked = true;
  editingEventId = id || null;
  $('#evModalTitle').textContent = id ? '✏️ Изменить дату' : '💜 Памятная дата';
  if (id) {
    const ev = db.events.find(x => x.id === id);
    if (ev) {
      $('#evTitle').value = ev.title;
      $('#evDate').value = ev.date;
      $('#evEmoji').value = ev.emoji || '💜';
      $('#evRepeat').checked = ev.repeat !== false;
    }
  }
  $('#eventOverlay').hidden = false;
  $('#evTitle').focus();
}
$('#evSave').addEventListener('click', () => {
  const title = $('#evTitle').value.trim();
  const date = $('#evDate').value;
  if (!title || !date) { alert('Напиши название и выбери дату 💜'); return; }
  const data = { title, date, emoji: $('#evEmoji').value.trim() || '💜', repeat: $('#evRepeat').checked };
  if (editingEventId) {
    const ev = db.events.find(x => x.id === editingEventId);
    if (ev) Object.assign(ev, data);
  } else {
    db.events.push({ id: uid(), ...data });
  }
  editingEventId = null;
  save(); $('#eventOverlay').hidden = true; renderCalendar(); renderHome();
});

/* ===== Заметки ===== */
function renderNotes() {
  const list = [...db.notes].sort((a, b) => (b.pinned - a.pinned) || (b.ts - a.ts));
  $('#notesGrid').innerHTML = list.length ? list.map(n => `
    <div class="note${n.pinned ? ' pinned' : ''}" data-id="${n.id}">
      <div class="note-top">
        <button class="mini-x" data-pin-note="${n.id}" title="${n.pinned ? 'Открепить' : 'Закрепить'}">${n.pinned ? '📌' : '📍'}</button>
        <span class="note-date">${new Date(n.ts).toLocaleDateString('ru-RU')}</span>
        <button class="mini-x" data-del-note="${n.id}" title="Удалить">✕</button>
      </div>
      <p>${esc(n.text)}</p>
    </div>`).join('')
    : '<p class="cal-tip">Пока пусто. Напиши первую записку! 💌</p>';
}
function addNote() {
  const t = $('#noteText').value.trim();
  if (!t) return;
  db.notes.unshift({ id: uid(), text: t, ts: Date.now(), pinned: false });
  save(); $('#noteText').value = ''; renderNotes();
}
$('#noteAddBtn').addEventListener('click', addNote);
$('#noteText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addNote(); });
$('#notesGrid').addEventListener('dblclick', e => {
  const card = e.target.closest('.note');
  if (!card) return;
  const n = db.notes.find(x => x.id === card.dataset.id);
  const t = prompt('Редактировать заметку:', n.text);
  if (t !== null && t.trim()) { n.text = t.trim(); save(); renderNotes(); }
});

/* ===== Списки ===== */
function itemHTML(list, it) {
  return `<li class="${it.done ? 'done' : ''}">
    <button class="check" data-toggle data-list="${list}" data-id="${it.id}" title="Готово">${it.done ? '✅' : '○'}</button>
    <span>${esc(it.text)}</span>
    <button class="mini-x" data-del data-list="${list}" data-id="${it.id}" title="Удалить">✕</button>
  </li>`;
}
function renderLists() {
  $('#shopList').innerHTML = db.shopping.length ? db.shopping.map(i => itemHTML('shopping', i)).join('') : '<li class="empty-li">Пока пусто 🫧</li>';
  $('#todoList').innerHTML = db.todos.length ? db.todos.map(i => itemHTML('todos', i)).join('') : '<li class="empty-li">Пока пусто 🫧</li>';
  $('#shopCount').textContent = `${db.shopping.filter(i => !i.done).length} в работе`;
  $('#todoCount').textContent = `${db.todos.filter(i => !i.done).length} в работе`;
}
function addItem(list, inputId) {
  const inp = $('#' + inputId);
  const t = inp.value.trim();
  if (!t) return;
  db[list].unshift({ id: uid(), text: t, done: false });
  save(); inp.value = ''; renderLists();
}
$('#shopAddBtn').addEventListener('click', () => addItem('shopping', 'shopInput'));
$('#todoAddBtn').addEventListener('click', () => addItem('todos', 'todoInput'));
$('#shopInput').addEventListener('keydown', e => { if (e.key === 'Enter') addItem('shopping', 'shopInput'); });
$('#todoInput').addEventListener('keydown', e => { if (e.key === 'Enter') addItem('todos', 'todoInput'); });

/* ===== Хотелки (общие, но разделены по людям: у каждого свой список) ===== */
let wishPhotoData = null;
function wishCard(w) {
  return `<div class="wish${w.done ? ' done' : ''}">
    ${w.data
      ? `<img class="wish-img" src="${w.data}" alt="${esc(w.text)}" data-photo="${w.data}" loading="lazy">`
      : `<div class="wish-img" style="display:grid;place-items:center;font-size:34px">💝</div>`}
    <div class="wish-body">
      <div class="wish-title">${esc(w.text)}</div>
      ${w.link ? `<a class="wish-link" href="${esc(w.link)}" target="_blank" rel="noopener">🔗 Открыть ссылку</a>` : ''}
      <div class="wish-btns">
        <button class="check" data-wish-done="${w.id}" title="${w.done ? 'Снова в список' : 'Исполнено!'}">${w.done ? '✅' : '○'}</button>
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
  if (doneDate) {
    const d = db.dates.find(x => x.id === doneDate.dataset.doneDate);
    if (d) { d.done = !d.done; save(); renderHome(); renderCalendar(); }
    return;
  }
  const delDate = e.target.closest('[data-del-date]');
  if (delDate) { db.dates = db.dates.filter(x => x.id !== delDate.dataset.delDate); save(); renderHome(); renderCalendar(); return; }

  const pinNote = e.target.closest('[data-pin-note]');
  if (pinNote) { const n = db.notes.find(x => x.id === pinNote.dataset.pinNote); if (n) n.pinned = !n.pinned; save(); renderNotes(); return; }
  const delNote = e.target.closest('[data-del-note]');
  if (delNote) { db.notes = db.notes.filter(x => x.id !== delNote.dataset.delNote); save(); renderNotes(); return; }

  const tog = e.target.closest('[data-toggle]');
  if (tog) { const it = db[tog.dataset.list].find(x => x.id === tog.dataset.id); if (it) it.done = !it.done; save(); renderLists(); return; }
  const delIt = e.target.closest('[data-del]');
  if (delIt) { db[delIt.dataset.list] = db[delIt.dataset.list].filter(x => x.id !== delIt.dataset.id); save(); renderLists(); return; }

  const delPhoto = e.target.closest('[data-del-photo]');
  if (delPhoto) {
    db.photos = db.photos.filter(x => x.id !== delPhoto.dataset.delPhoto);
    selectedPhotos.delete(delPhoto.dataset.delPhoto);
    save(); renderPhotos(); return;
  }
  const pinPhoto = e.target.closest('[data-pin-photo]');
  if (pinPhoto) { const p = db.photos.find(x => x.id === pinPhoto.dataset.pinPhoto); if (p) p.pinned = !p.pinned; save(); renderPhotos(); return; }
  const selPhoto = e.target.closest('[data-sel-photo]');
  if (selPhoto) {
    const id = selPhoto.dataset.selPhoto;
    if (selectedPhotos.has(id)) selectedPhotos.delete(id); else selectedPhotos.add(id);
    renderPhotos(); return;
  }
  const photo = e.target.closest('[data-photo]');
  if (photo) { $('#lightboxImg').src = photo.dataset.photo; $('#lightbox').hidden = false; return; }

  const wishDone = e.target.closest('[data-wish-done]');
  if (wishDone) { const w = db.wishlist.find(x => x.id === wishDone.dataset.wishDone); if (w) w.done = !w.done; save(); renderWishlist(); return; }
  const wishDel = e.target.closest('[data-wish-del]');
  if (wishDel) { db.wishlist = db.wishlist.filter(x => x.id !== wishDel.dataset.wishDel); save(); renderWishlist(); return; }

  const labelNew = e.target.closest('[data-label-new]');
  if (labelNew) { openLabelOverlay(); return; }
  const labelDel = e.target.closest('[data-label-del]');
  if (labelDel) {
    const name = labelDel.dataset.labelDel;
    if (confirm(`Удалить лейбл «${name}»? Фото не пострадают.`)) deleteLabel(name);
    return;
  }
  const labelChip = e.target.closest('[data-label]');
  if (labelChip) { currentLabel = labelChip.dataset.label; renderPhotos(); return; }

  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) { closeOverlay(closeBtn.dataset.close); return; }
  if (e.target.classList && e.target.classList.contains('overlay')) e.target.hidden = true;
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const open = document.querySelector('.overlay:not([hidden])');
    if (open) closeOverlay(open.id);
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
const selectedPhotos = new Set(); // id выбранных фото (для массовых операций)
const photoSort = (a, b) => (b.pinned - a.pinned) || ((a.order || 0) - (b.order || 0));
$('#photoInput').addEventListener('change', async e => {
  const files = [...e.target.files].slice(0, 10);
  for (const f of files) {
    try {
      const data = await readFile(f);
      db.photos.unshift({ id: uid(), data, title: f.name, labels: [], pinned: false, ts: Date.now(), order: 0 });
    } catch (err) { console.warn('Не удалось загрузить фото', err); }
  }
  e.target.value = '';
  save(); renderPhotos();
});
function renderLabels() {
  const bar = $('#labelBar');
  if (!bar) return;
  bar.innerHTML =
    `<button class="album-chip${currentLabel === '' ? ' active' : ''}" data-label="">🖼 Все фото (${db.photos.length})</button>` +
    db.labels.map(l => `<button class="album-chip${currentLabel === l ? ' active' : ''}" data-label="${esc(l)}"># ${esc(l)}<span class="label-del" data-label-del="${esc(l)}" title="Удалить лейбл">✕</span></button>`).join('') +
    `<button class="btn album-add-btn" data-label-new title="Создать лейбл">＋ Лейбл</button>`;
}
function renderPhotos() {
  const grid = $('#photosGrid');
  if (!grid) return;
  renderLabels();
  const list = [...db.photos].sort(photoSort).filter(p => !currentLabel || (p.labels || []).includes(currentLabel));
  const hint = $('#dragHint');
  if (hint) hint.style.display = list.length > 1 ? 'block' : 'none';
  const selBar = $('#photoSelBar');
  if (selBar) {
    selBar.style.display = selectedPhotos.size ? 'flex' : 'none';
    if (selectedPhotos.size) { const c = $('#selCount'); if (c) c.textContent = selectedPhotos.size; }
  }
  grid.innerHTML = list.length ? list.map(p => `
    <div class="photo${p.pinned ? ' pinned' : ''}${selectedPhotos.has(p.id) ? ' selected' : ''}" data-id="${p.id}" data-drag-photo draggable="true">
      <img src="${p.data}" alt="${esc(p.title)}" data-photo="${p.data}" loading="lazy">
      <button class="sel-photo${selectedPhotos.has(p.id) ? ' active' : ''}" data-sel-photo="${p.id}" title="${selectedPhotos.has(p.id) ? 'Снять выбор' : 'Выбрать'}">${selectedPhotos.has(p.id) ? '✓' : '○'}</button>
      <button class="pin-photo${p.pinned ? ' active' : ''}" data-pin-photo="${p.id}" title="${p.pinned ? 'Открепить' : 'Закрепить'}">${p.pinned ? '⭐' : '☆'}</button>
      <button class="del-photo" data-del-photo="${p.id}" title="Удалить">✕</button>
      ${(p.labels || []).length ? `<div class="photo-labels">${p.labels.map(l => `<span class="photo-label">${esc(l)}</span>`).join('')}</div>` : ''}
    </div>`).join('')
    : '<p class="cal-tip">📷 Загрузите ваши фото — они будут храниться локально, прямо в браузере.</p>';
}
// Лейблы: удаление (фото не трогаем), добавление выбранным, создание
function deleteLabel(name) {
  db.labels = db.labels.filter(l => l !== name);
  db.photos.forEach(p => { if (p.labels) p.labels = p.labels.filter(l => l !== name); });
  if (currentLabel === name) currentLabel = '';
  selectedPhotos.clear();
  save(); renderPhotos();
}
function applyLabelToSelected(name) {
  const ids = [...selectedPhotos];
  if (!ids.length) return;
  db.photos.forEach(p => {
    if (ids.includes(p.id)) {
      if (!Array.isArray(p.labels)) p.labels = [];
      if (!p.labels.includes(name)) p.labels.push(name);
    }
  });
}
function openLabelOverlay() {
  $('#labelNewName').value = '';
  const pick = $('#labelPick');
  pick.innerHTML = db.labels.length
    ? '<option value="">— выбери лейбл —</option>' + db.labels.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('')
    : '<option value="">Сначала создай новый лейбл выше</option>';
  const hint = $('#labelModalHint');
  if (hint) hint.textContent = selectedPhotos.size ? `Фото выбрано: ${selectedPhotos.size}` : 'Можно просто создать лейбл — он появится в фильтре.';
  $('#labelOverlay').hidden = false;
  $('#labelNewName').focus();
}
$('#selAddLabelBtn').addEventListener('click', openLabelOverlay);
$('#selClearBtn').addEventListener('click', () => { selectedPhotos.clear(); renderPhotos(); });
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
// Перетаскивание: меняем порядок внутри текущего фильтра
let dragPhotoId = null;
$('#photosGrid').addEventListener('dragstart', e => {
  const el = e.target.closest('[data-drag-photo]');
  if (!el) return;
  dragPhotoId = el.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
});
$('#photosGrid').addEventListener('dragover', e => e.preventDefault());
$('#photosGrid').addEventListener('drop', e => {
  e.preventDefault();
  if (!dragPhotoId) return;
  const target = e.target.closest('[data-drag-photo]');
  const list = [...db.photos].sort(photoSort).filter(p => !currentLabel || (p.labels || []).includes(currentLabel));
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
  if (addBtn) addBtn.style.display = (hasPass('gosha') && hasPass('dasha')) ? 'none' : '';
}
// Экспорт — зашифрованный сейф: без пароля файл не прочитать
async function exportData() {
  db.backupDate = Date.now();
  await save();
  const vault = loadVault();
  const blob = new Blob([JSON.stringify(vault, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nasha-vselennaya-backup-encrypted.json';
  a.click();
  URL.revokeObjectURL(a.href);
  renderSettings();
  return vault;
}
$('#exportBtn').addEventListener('click', () => { exportData(); });
function importData(text) {
  try {
    const d = JSON.parse(text);
    if (d && d.ver && d.db && Array.isArray(d.keys)) {
      // это зашифрованный сейф — просто восстанавливаем, войти можно своим паролем
      localStorage.setItem(VAULT_KEY, JSON.stringify(d));
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
  fr.onload = () => {
    if (!importData(fr.result)) { alert('Не получилось прочитать файл:('); return; }
    e.target.value = '';
    location.reload();
  };
  fr.readAsText(f);
});
$('#resetBtn').addEventListener('click', () => {
  if (confirm('Точно удалить ВСЕ данные? Это не отменить.')) {
    localStorage.removeItem(VAULT_KEY);
    localStorage.removeItem(KEY);
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

/* ===== Летающие сердечки ===== */
function spawnHeart() {
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
  renderUserChip();
  setTheme(getTheme());
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
setInterval(() => { if (!isHidden()) renderFloatingPhotos(); }, 7000);
spawnHeart();



