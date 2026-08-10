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
const VAULT_KEY_PREV = 'universe_vault_prev'; // резервная копия старого сейфа при усыновлении облачного
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

/* ===== Универсальный drag на Pointer Events (схема A+D) =====
   Один движок для всех перетаскиваний (заметки, списки, фото, чипы лейблов):
   - Pointer Events + setPointerCapture — работает и мышью, и тачем;
   - «драг-ручки» (.drag-handle) как точки захвата, где нужны;
   - живое превью порядка: перестановка DOM + FLIP-анимация соседей —
     карточки плавно «разъезжаются» вокруг перетаскиваемой (без прыжков);
   - призрак (ghost) клона следует за курсором;
   - drop-цели вне контейнера (фото → чип лейбла и обратно);
   - отмена: Esc / pointercancel / потеря фокуса окна.
   Работает и в браузере, и в мини-DOM тестов (без window/rAF/cloneNode). */
'use strict';

const UNI_DRAG_THRESHOLD = 6;    // px движения до начала перетаскивания
const UNI_DRAG_DUR = 240;        // ms FLIP-переезда соседей
const UNI_DRAG_EASE = 'cubic-bezier(.2,.7,.3,1)';
const UNI_DRAG_SCROLL_EDGE = 80; // px от края окна — автоскролл
const UNI_DRAG_SCROLL_STEP = 20; // px за шаг автоскролла

const uniDrag = {
  state: null,   // текущий драг или null
  setups: [],    // конфиги драг-зон
  _global: false // глобальные слушатели привязаны
};

function uniDragSetup(opts) {
  uniDrag.setups.push(opts);
  const root = opts.container;
  if (root && root.addEventListener) {
    root.addEventListener('pointerdown', uniDragPointerDown);
    root.addEventListener('keydown', uniDragKeyDown); // Esc (фолбэк для тестов)
  }
  if (uniDrag._global) return;
  uniDrag._global = true;
  if (typeof window !== 'undefined' && window.addEventListener) {
    // браузер: события всплывают до document, а при уходе курсора за окно —
    // setPointerCapture перенаправляет их на захваченный элемент
    document.addEventListener('pointermove', uniDragPointerMove);
    document.addEventListener('pointerup', uniDragPointerUp);
    document.addEventListener('pointercancel', uniDragPointerCancel);
    document.addEventListener('keydown', uniDragKeyDown);
    window.addEventListener('blur', uniDragCancelSafe);
  } else if (document.body && document.body.addEventListener) {
    // мини-DOM тестов: события всплывают до body
    document.body.addEventListener('pointermove', uniDragPointerMove);
    document.body.addEventListener('pointerup', uniDragPointerUp);
    document.body.addEventListener('pointercancel', uniDragPointerCancel);
  }
}

function uniDragIdOf(el, setup) {
  if (setup.idOf) return setup.idOf(el);
  return el && el.dataset ? (el.dataset.id || el.dataset.label || '') : '';
}

function uniDragItemOf(el, setup) {
  if (!el || !el.closest) return null;
  let item = null;
  if (setup.handleSel) {
    const h = el.closest(setup.handleSel);
    if (!h || !h.closest) return null;
    item = h.closest(setup.itemSel);
  } else {
    if (setup.ignoreSel && el.closest(setup.ignoreSel)) return null;
    item = el.closest(setup.itemSel);
  }
  if (!item) return null;
  if (setup.allow && !setup.allow(item)) return null;
  return item;
}

// Реальный элемент под курсором: при pointer capture e.target — это ручка,
// поэтому в браузере спрашиваем document.elementFromPoint (в тестах — e.target).
function uniDragEventTarget(e) {
  if (typeof document !== 'undefined' && typeof document.elementFromPoint === 'function' &&
      e && e.clientX !== undefined) {
    try {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el) return el;
    } catch (err) {}
  }
  return e && e.target;
}

function uniDragPointerDown(e) {
  if (uniDrag.state) return;
  if (e.button !== undefined && e.button !== 0) return; // только левая кнопка
  const setup = uniDrag.setups.find(s => !!uniDragItemOf(e.target, s));
  if (!setup) return;
  const el = uniDragItemOf(e.target, setup);
  if (!el) return;
  uniDrag.state = {
    setup, el,
    id: uniDragIdOf(el, setup),
    started: false,
    px: e.clientX || 0, py: e.clientY || 0,
    x: e.clientX || 0, y: e.clientY || 0,
    grabDX: 0, grabDY: 0,
    ghost: null, ids: [], origin: [], hoverT: null, reorderRAF: null,
    scrollRAF: null, scrollX: 0, scrollY: 0
  };
  if (setup.handleSel) {
    // ручка — драг-поверхность: гасим выделение/скролл и держим указатель
    if (e.preventDefault) e.preventDefault();
    if (e.pointerId !== undefined && el.setPointerCapture) {
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    }
  }
}



function uniDragPointerMove(e) {
  const st = uniDrag.state;
  if (!st) return;
  const x = e.clientX || 0, y = e.clientY || 0;
  st.x = x; st.y = y;
  if (!st.started) {
    if (Math.abs(x - st.px) < UNI_DRAG_THRESHOLD && Math.abs(y - st.py) < UNI_DRAG_THRESHOLD) return;
    uniDragBegin(st);
  }
  if (!st.started) return;
  if (st.ghost && st.ghost.style) {
    st.ghost.style.left = Math.round(x - st.grabDX) + 'px';
    st.ghost.style.top = Math.round(y - st.grabDY) + 'px';
  }
  uniDragScrollSchedule(st, x, y);
  // подсветка живых drop-целей под курсором
  const tgt = uniDragTargetAt(uniDragEventTarget(e), st.setup.targets, st);
  if (tgt !== st.hoverT) {
    if (st.hoverT) st.hoverT.target.highlight(st.hoverT.el, false);
    if (tgt) tgt.target.highlight(tgt.el, true);
    st.hoverT = tgt;
  }
  // живое превью порядка: не чаще раза в кадр — pointermove приходит чаще, чем
  // rAF, и каждый перезапуск 240ms-«разъезда» рвёт анимацию соседей (дёргано).
  // Троттлим: за кадр применяем последнюю позицию курсора, FLIP успевает играть.
  if (st.setup.reorder !== false && st.setup.container) uniDragScheduleReorder(st);
}

function uniDragPointerUp(e) { uniDragEnd(uniDrag.state, e, true); }
function uniDragPointerCancel(e) { uniDragEnd(uniDrag.state, e, false); }
function uniDragCancelSafe() { // потеря фокуса окна
  const st = uniDrag.state;
  if (!st) return;
  if (st.started) uniDragEnd(st, null, false);
  else uniDrag.state = null;
}
function uniDragKeyDown(e) {
  if (e.key === 'Escape' && uniDrag.state && uniDrag.state.started) uniDragEnd(uniDrag.state, null, false);
}

// Запланировать живую перестановку порядка: один раз в кадр, по последним координатам.
// В мини-DOM тестов rAF нет — применяем сразу (тесты ждут синхронный порядок).
function uniDragScheduleReorder(st) {
  if (st.reorderRAF) return;
  if (typeof requestAnimationFrame !== 'function') { uniDragDoReorder(st); return; }
  st.reorderRAF = requestAnimationFrame(() => {
    st.reorderRAF = null;
    if (uniDrag.state === st && st.started) uniDragDoReorder(st);
  });
}

function uniDragDoReorder(st) {
  const idx = uniDragInsertIndex(st.setup.container, st.setup.itemSel, st.x, st.y, st.el);
  const ids = st.ids.slice();
  const from = ids.indexOf(st.id);
  if (from < 0) return;
  ids.splice(from, 1);
  ids.splice(Math.max(0, Math.min(idx, ids.length)), 0, st.id);
  if (ids.join('|') !== st.ids.join('|')) {
    uniDragFlipReorder(st.setup.container, st.setup.itemSel, ids, st.setup);
    st.ids = ids;
  }
}


function uniDragBegin(st) {
  st.started = true;
  if (st.setup.reorder !== false && st.setup.container) {
    st.ids = uniDragCards(st.setup.container, st.setup.itemSel).map(c => uniDragIdOf(c, st.setup));
  } else {
    st.ids = [st.id];
  }
  st.origin = st.ids.slice();
  // сбрасываем незавершённые inline-трансформы (соседи могли «доезжать» с прошлого драга)
  uniDragCards(st.setup.container, st.setup.itemSel).forEach(c => {
    if (c.style) { c.style.transition = ''; c.style.transform = ''; }
  });
  const el = st.el;
  const r = el.getBoundingClientRect();
  st.grabDX = st.x - r.left;
  st.grabDY = st.y - r.top;
  // призрак — клон карточки (в мини-DOM cloneNode нет — пропускаем)
  if (el.cloneNode) {
    const ghost = el.cloneNode(true);
    ghost.classList.add('drag-ghost');
    if (ghost.style) {
      ghost.style.position = 'fixed';
      ghost.style.left = Math.round(r.left) + 'px';
      ghost.style.top = Math.round(r.top) + 'px';
      ghost.style.width = (r.width || 0) + 'px';
      ghost.style.height = (r.height || 0) + 'px';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = '9999';
      ghost.style.transition = 'none';
      ghost.style.transform = 'rotate(1.5deg)';
      ghost.style.margin = '0';
    }
    if (document.body && document.body.appendChild) document.body.appendChild(ghost);
    st.ghost = ghost;
  }
  if (el.classList) el.classList.add('dragging');
  if (document.body && document.body.classList) document.body.classList.add('uni-dragging');
  if (st.setup.onStart) st.setup.onStart(st);
}


function uniDragEnd(st, e, ok) {
  if (!st) return;
  if (uniDrag.state === st) uniDrag.state = null;
  const started = !!st.started;
  // дожимаем последнюю живую перестановку, если она не успела попасть в кадр
  if (st.reorderRAF) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(st.reorderRAF);
    st.reorderRAF = null;
    if (started && st.setup.reorder !== false && st.setup.container) uniDragDoReorder(st);
  }
  if (st.scrollRAF) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(st.scrollRAF);
    st.scrollRAF = null;
  }
  if (st.hoverT) { st.hoverT.target.highlight(st.hoverT.el, false); st.hoverT = null; }
  if (st.ghost && st.ghost.remove) st.ghost.remove();
  st.ghost = null;
  if (st.el && st.el.classList) st.el.classList.remove('dragging');
  if (document.body && document.body.classList) document.body.classList.remove('uni-dragging');
  if (!started) return; // это был обычный клик — ничего не делаем
  if (ok && e) {
    const target = uniDragTargetAt(uniDragEventTarget(e), st.setup.targets, st);
    if (target) {
      // дроп на drop-цель (например, чип лейбла): порядок в DOM возвращаем к исходному
      if (st.setup.reorder !== false && st.setup.container) {
        uniDragApplyOrder(st.setup.container, st.setup.itemSel, st.origin, st.setup);
      }
      target.target.drop(st, target.el);
    } else if (st.setup.onDrop) {
      st.setup.onDrop(st);
    }
  } else {
    if (st.setup.reorder !== false && st.setup.container) {
      uniDragApplyOrder(st.setup.container, st.setup.itemSel, st.origin, st.setup);
    }
    if (st.setup.onCancel) st.setup.onCancel(st);
  }
  uniDragSuppressClick();
}

// После реального драга браузер шлёт «клик» (например, по ручке фото) —
// гасим его, чтобы не сработали выбор/лайтбокс/фильтр.
function uniDragSuppressClick() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.addEventListener) return;
  const suppress = e => {
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    document.removeEventListener('click', suppress, true);
  };
  document.addEventListener('click', suppress, true);
  if (typeof setTimeout === 'function') {
    setTimeout(() => document.removeEventListener('click', suppress, true), 120);
  }
}

function uniDragCards(container, itemSel) {
  if (!container) return [];
  if (container.querySelectorAll) {
    try { return [...container.querySelectorAll(itemSel)]; } catch (e) {}
  }
  if (container.children) {
    const cls = (itemSel.match(/\.([a-zA-Z0-9_-]+)/) || [])[1];
    return [...container.children].filter(c => c.classList && (!cls || c.classList.contains(cls)));
  }
  return [];
}



// Индекс вставки перетаскиваемой карточки среди остальных (0..cards.length).
// НЕ «ближайшая граница»: для сетки границы между строками/колонками равноудалены,
// индекс осциллирует между далёкими слотами (курсор «прыгает» с 1 на 4).
// Правило — по ближайшей КАРТОЧКЕ; индекс меняется только при пересечении её
// центра/края (монотонно):
//   - курсор ВНУТРИ карточки → сразу ПОСЛЕ неё («навёл на фото» = оно уехало);
//   - ниже центра карточки → после неё; выше центра → до неё;
//   - на уровне центра → по горизонтали (в строке: левее/правее центра).
function uniDragInsertIndex(container, itemSel, x, y, excludeEl) {
  // Курсор над САМИМ перетаскиваемым (тот стоит в текущем слоте вставки) —
  // возвращаем его текущий индекс: иначе «ближайшая» карточка из соседнего
  // ряда сдвигает слот в противоположный конец сетки (осцилляция 1↔4).
  if (excludeEl && excludeEl.getBoundingClientRect) {
    const rr = excludeEl.getBoundingClientRect();
    if (x >= rr.left && x <= rr.right && y >= rr.top && y <= rr.bottom) {
      const cur = uniDragCards(container, itemSel).indexOf(excludeEl);
      return cur < 0 ? 0 : cur;
    }
  }
  const cards = uniDragCards(container, itemSel).filter(c => c !== excludeEl);
  if (!cards.length) return 0;
  // 1) карточка, в которой курсор — приоритет («навёл» важнее «ближе»)
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i + 1;
  }
  // 2) иначе — ближайшая по центру (при равенстве — раньше по потоку)
  let best = 0, bestD = Infinity;
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    const cx = r.left + (r.width || 0) / 2, cy = r.top + (r.height || 0) / 2;
    const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    if (d < bestD) { bestD = d; best = i; }
  }
  const r = cards[best].getBoundingClientRect();
  const cx = r.left + (r.width || 0) / 2, cy = r.top + (r.height || 0) / 2;
  if (y > cy) return best + 1;
  if (y < cy) return best;
  return x > cx ? best + 1 : best;
}

function uniDragReflow(items) {
  if (!items || !items.length) return;
  try { items[0].getBoundingClientRect(); } catch (e) {} // чтение layout применяет ожидающие стили
}

// FLIP «разъезд»: переставляем DOM, затем каждый сосед доезжает на новое место
// через transform+transition. before замеряется ДО перестановки (с учётом ещё
// идущих анимаций), после — «чисто», с принудительно снятыми трансформами
// (синхронно, до отрисовки — промежуточное состояние не видно). Без прыжков.
function uniDragFlipReorder(container, itemSel, wantIds, setup) {
  const items = uniDragCards(container, itemSel);
  if (!items.length) return;
  const idOf = c => uniDragIdOf(c, setup);
  const before = new Map(items.map(c => [c, c.getBoundingClientRect()]));
  const order = new Map(wantIds.map((id, i) => [id, i]));
  [...items]
    .sort((a, b) => (order.get(idOf(a)) ?? 1e9) - (order.get(idOf(b)) ?? 1e9))
    .forEach(c => { if (c.remove) c.remove(); container.appendChild(c); });
  items.forEach(c => { if (c.style) { c.style.transition = 'none'; c.style.transform = ''; } });
  uniDragReflow(items);
  const after = new Map(items.map(c => [c, c.getBoundingClientRect()]));
  const moving = [];
  items.forEach(c => {
    if (c.classList && c.classList.contains && c.classList.contains('dragging')) return; // перетаскиваемую не анимируем
    const r1 = before.get(c), r2 = after.get(c);
    const dx = r1.left - r2.left, dy = r1.top - r2.top;
    if ((dx || dy) && c.style) {
      c.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      moving.push(c);
    }
  });
  uniDragReflow(items);
  if (moving.length) {
    // Стартуем transition СРАЗУ, в этом же кадре: translate уже «закоммичен»
    // принудительным reflow выше — браузер анимирует из позиции «до» в «после».
    // Отдельный rAF нельзя: следующий reorder-кадр снял бы transition раньше,
    // чем отрисовался бы хоть один кадр анимации — соседи «застывали» бы,
    // а при дропе всё прыгало скачком (именно так и было в браузере).
    moving.forEach(c => {
      if (c.style) {
        c.style.transition = 'transform ' + UNI_DRAG_DUR + 'ms ' + UNI_DRAG_EASE;
        c.style.transform = '';
      }
    });
  }
}

// Мгновенная перестановка DOM (без анимации) — для отмены драга.
function uniDragApplyOrder(container, itemSel, ids, setup) {
  const items = uniDragCards(container, itemSel);
  if (!items.length) return;
  const idOf = c => uniDragIdOf(c, setup);
  const order = new Map(ids.map((id, i) => [id, i]));
  [...items]
    .sort((a, b) => (order.get(idOf(a)) ?? 1e9) - (order.get(idOf(b)) ?? 1e9))
    .forEach(c => { if (c.remove) c.remove(); container.appendChild(c); });
  items.forEach(c => { if (c.style) { c.style.transition = ''; c.style.transform = ''; } });
}

function uniDragTargetAt(el, targets, st) {
  if (!el || !el.closest || !targets || !targets.length) return null;
  for (const t of targets) {
    const hit = el.closest(t.sel);
    if (hit && (!t.canDrop || t.canDrop(st, hit, el))) return { target: t, el: hit };
  }
  return null;
}

// Автоскролл страницы, когда курсор у края окна (списки длиннее экрана).
// Троттлим до раза в кадр: scrollBy на каждый pointermove рвёт FLIP и layout.
function uniDragScrollSchedule(st, x, y) {
  st.scrollX = x; st.scrollY = y;
  if (st.scrollRAF) return;
  if (typeof requestAnimationFrame !== 'function') { uniDragAutoScroll(x, y); return; }
  st.scrollRAF = requestAnimationFrame(() => {
    st.scrollRAF = null;
    if (uniDrag.state === st && st.started) uniDragAutoScroll(st.scrollX, st.scrollY);
  });
}

function uniDragAutoScroll(x, y) {
  if (typeof window === 'undefined' || typeof window.scrollBy !== 'function') return;
  const h = window.innerHeight || 0, w = window.innerWidth || 0;
  if (y < UNI_DRAG_SCROLL_EDGE) window.scrollBy(0, -UNI_DRAG_SCROLL_STEP);
  else if (y > h - UNI_DRAG_SCROLL_EDGE) window.scrollBy(0, UNI_DRAG_SCROLL_STEP);
  else if (x < UNI_DRAG_SCROLL_EDGE) window.scrollBy(-UNI_DRAG_SCROLL_STEP, 0);
  else if (x > w - UNI_DRAG_SCROLL_EDGE) window.scrollBy(UNI_DRAG_SCROLL_STEP, 0);
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
  async put(id, fullBlob, thumbBlob, meta, origBlob) {
    const fullU8 = fullBlob instanceof Uint8Array ? fullBlob : await blobToU8(fullBlob);
    const thumbU8 = thumbBlob instanceof Uint8Array ? thumbBlob : (thumbBlob ? await blobToU8(thumbBlob) : null);
    const origU8 = origBlob instanceof Uint8Array ? origBlob : (origBlob ? await blobToU8(origBlob) : null);
    const encFull = await encryptBlob(fullU8);
    const encThumb = thumbU8 ? await encryptBlob(thumbU8) : null;
    const encOrig = origU8 ? await encryptBlob(origU8) : null;
    await idbPut(this, { id, full: encFull, thumb: encThumb, orig: encOrig, meta: meta || {} });
  },
  // Сохранение уже зашифрованных блобов (пришли из облака) — без повторного шифрования.
  async putEncrypted(id, encFull, encThumb, meta, encOrig) {
    await idbPut(this, { id, full: encFull, thumb: encThumb, orig: encOrig, meta: meta || {} });
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
  async getEncryptedFull(id) { const row = await idbGet(this, id); return row?.full || null; },
  async getEncryptedThumb(id) { const row = await idbGet(this, id); return row?.thumb || null; },
  async getEncryptedOrig(id) { const row = await idbGet(this, id); return row?.orig || null; },
  async getMeta(id) {
    const row = await idbGet(this, id);
    return row?.meta || null;
  },
  // Лёгкий список того, что лежит в сторе (без дешифровки) — для облачной сверки.
  async listIds() {
    const rows = await idbGetAll(this);
    return rows.map(r => ({ id: r.id, hasFull: !!r.full, hasThumb: !!r.thumb, hasOrig: !!r.orig }));
  },
  async delete(id) {
    await idbDelete(this, id);
  },
  async all() {
    const rows = await idbGetAll(this);
    const result = [];
    for (const r of rows) {
      let full = null, thumb = null, orig = null;
      try { full = await decryptBlob(r.full); } catch (e) {}
      try { if (r.thumb) thumb = await decryptBlob(r.thumb); } catch (e) {}
      try { if (r.orig) orig = await decryptBlob(r.orig); } catch (e) {}
      result.push({ id: r.id, full, thumb, orig, meta: r.meta || {} });
    }
    return result;
  },
  async exportBlobs() {
    const rows = await idbGetAll(this);
    const out = [];
    for (const r of rows) {
      let fullB64 = null, thumbB64 = null, origB64 = null;
      try { if (r.full) fullB64 = b64(await decryptBlob(r.full)); } catch (e) {}
      try { if (r.thumb) thumbB64 = b64(await decryptBlob(r.thumb)); } catch (e) {}
      try { if (r.orig) origB64 = b64(await decryptBlob(r.orig)); } catch (e) {}
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
      await idbPut(this, { id: item.id, full: encFull, thumb: encThumb, orig: encOrig, meta: item.meta || {} });
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
  async put(id, fullBlob, thumbBlob, meta, origBlob) {
    const fullU8 = fullBlob instanceof Uint8Array ? fullBlob : await blobToU8(fullBlob);
    const thumbU8 = thumbBlob instanceof Uint8Array ? thumbBlob : (thumbBlob ? await blobToU8(thumbBlob) : null);
    const origU8 = origBlob instanceof Uint8Array ? origBlob : (origBlob ? await blobToU8(origBlob) : null);
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
  async getEncryptedFull(id) { const r = this._map.get(id); return r?.full || null; },
  async getEncryptedThumb(id) { const r = this._map.get(id); return r?.thumb || null; },
  async getEncryptedOrig(id) { const r = this._map.get(id); return r?.orig || null; },
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
      let full = null, thumb = null, orig = null;
      try { full = await decryptBlob(r.full); } catch (e) {}
      try { if (r.thumb) thumb = await decryptBlob(r.thumb); } catch (e) {}
      try { if (r.orig) orig = await decryptBlob(r.orig); } catch (e) {}
      result.push({ id: r.id, full, thumb, orig, meta: r.meta || {} });
    }
    return result;
  },
  async exportBlobs() {
    const out = [];
    for (const r of this._map.values()) {
      let fullB64 = null, thumbB64 = null, origB64 = null;
      try { if (r.full) fullB64 = b64(await decryptBlob(r.full)); } catch (e) {}
      try { if (r.thumb) thumbB64 = b64(await decryptBlob(r.thumb)); } catch (e) {}
      try { if (r.orig) origB64 = b64(await decryptBlob(r.orig)); } catch (e) {}
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
      // Миниатюра могла не расшифроваться — не бросаем, падаем на полный блоб
      if (useThumb) { try { blob = await photoStore.getThumb(p.id); } catch (e) {} }
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
      let blob = null;
      try { blob = await photoStore.getThumb(p.id); } catch (e) {}
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
    const url = p ? await photoUrl(p, true) : '';
    if (url) {
      im.src = url;
      im.removeAttribute('data-photo-src'); // URL найден — больше не перечитываем
    }
    // URL не нашёлся (фото ещё качается из облака) — data-photo-src остаётся,
    // следующий hydratePhotoImgs после докачки подхватит его сам.
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
  // Цепочка никогда не «падает»: один сбой шифрования отравил бы saveChain, и каждый
  // следующий save() без await давал бы unhandledrejection с ложным тостом при входе.
  saveChain = saveChain.then(async () => {
    try {
      const vault = loadVault();
      if (!vault) return;
      vault.db = await aesEnc(masterKey, enc.encode(snap));
      try { localStorage.setItem(VAULT_KEY, JSON.stringify(vault)); }
      catch (e) { notify('Хранилище переполнено — удали лишние фото и попробуй ещё раз 💜', true); }
      // Облачная синхронизация: после каждого успешного сохранения — push (debounce)
      if (typeof scheduleSyncPush === 'function') scheduleSyncPush();
    } catch (e) {
      console.warn('Не удалось сохранить сейф', e);
      notify('Не удалось сохранить — попробуй ещё раз 💜', true);
    }
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
// Пробует вытащить мастер-ключ сейфа паролем БЕЗ побочных эффектов: не трогает
// masterKey, db и VAULT_KEY. Возвращает CryptoKey или null (нет записи для who,
// неверный пароль, повреждённая обёртка).
async function tryUnwrapKey(who, pass, vault) {
  const wrap = (vault && (vault.keys || [])).find(k => k.who === who);
  if (!wrap) return null;
  try {
    const pwdKey = await pbkdf2Key(pass, unb64(wrap.s), vault.a || PBKDF2_ITERS);
    const kraw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(wrap.i) }, pwdKey, unb64(wrap.d)));
    return await crypto.subtle.importKey('raw', kraw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  } catch (e) { return null; }
}

async function unlockWith(who, pass, vaultOverride) {
  const vault = vaultOverride || loadVault();
  const key = await tryUnwrapKey(who, pass, vault);
  if (!key) return false;
  try {
    masterKey = key;
    currentUser = who;
    const raw = await aesDec(masterKey, vault.db);
    db = migrateDB({ ...defaultDB(), ...JSON.parse(dec.decode(raw)) });
    await initPhotoStore(); // гарантируем бэкенд (в тестах — память)
    await photoStore.migratePhotos(db);
    await photoStore.refreshSizes();
    warmThumbCache(); // миниатюры в кэш — галерея рендерится без ожидания
    if (vaultOverride) {
      // Вход по облачному сейфу (новый браузер / восстановление): забираем его
      // себе — дальше он живёт на устройстве, а фото докачаются из облака.
      // Если на устройстве оставался ДРУГОЙ сейф — кладём его в резервную
      // копию (universe_vault_prev), чтобы ничего не пропало безвозвратно.
      const prevLocal = loadVault();
      if (prevLocal && JSON.stringify(prevLocal) !== JSON.stringify(vaultOverride)) {
        try { localStorage.setItem(VAULT_KEY_PREV, JSON.stringify(prevLocal)); } catch (e) { console.warn('Не удалось сохранить бэкап сейфа', e); }
      }
      if (!store.set(VAULT_KEY, JSON.stringify(vaultOverride))) return false;
      pendingCloudVault = null;
      notify('Сейф восстановлен из облака 💜');
    }
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
  // Облачная синхронизация: после входа пробуем забрать/отдать данные
  if (typeof initSync === 'function') initSync();
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
  // Облачная синхронизация: при блокировке отключаем слушатели и вход
  if (typeof stopSync === 'function') stopSync();
}
function isLocked() { return authLocked; }

let pendingAuthWho = 'gosha';
// Сейф, найденный в облаке до входа. Может быть «вторым» сейфом (на устройстве
// остался локальный сейф с другим паролем). tryUnlock проверяет пароль и по
// локальному, и по облачному сейфу: если пароль открывает облачный — он
// «усыновляется» (см. unlockWith), и облачные данные приходят на устройство.
let pendingCloudVault = null;
function renderAuthWho() {
  $$('.auth-user').forEach(b => b.classList.toggle('auth-on', b.dataset.authWho === pendingAuthWho));
  const lbl = $('#authWhoLabel');
  if (lbl) lbl.textContent = pendingAuthWho === 'dasha' ? '👧 Даша' : '👦 Гоша';
}
async function tryUnlock() {
  const err = $('#authErr');
  let local = loadVault();
  let cloud = pendingCloudVault;
  if (!local && !cloud && typeof fetchCloudVault === 'function') {
    // Облако могли ещё не успеть проверить (медленная сеть на телефоне) —
    // пробуем ещё раз до того, как сказать «сейф не найден».
    if (err) err.textContent = 'Проверяем облако ещё раз…';
    const fresh = await fetchCloudVault();
    cloud = fresh ? fresh.vault : null;
    if (cloud) { pendingCloudVault = cloud; const hint = $('#cloudHint'); if (hint) hint.hidden = false; }
  }
  if (!local && !cloud) {
    if (err) err.textContent = 'Сейф не найден ни на устройстве, ни в облаке. Проверь интернет и нажми «Войти» ещё раз, либо создай новый пароль.';
    return;
  }
  const hasPass = !!((local && (local.keys || []).some(k => k.who === pendingAuthWho)) ||
                    (cloud && (cloud.keys || []).some(k => k.who === pendingAuthWho)));
  if (!hasPass) {
    if (err) err.textContent = 'Пароль для этого человека ещё не создан. Добавь его в настройках — или войди другим.';
    return;
  }
  const pass = $('#authPass').value;
  if (!pass) { if (err) err.textContent = 'Введи пароль 💜'; return; }
  // Проверяем пароль СРАЗУ против обоих сейфов (без побочных эффектов) и решаем,
  // каким входим:
  //  • локальный не открылся, а облачный открылся      → облачный (новый браузер)
  //  • открылись оба, но это РАЗНЫЕ сейфы (облачный не
  //    расшифровывается ключом локального)             → облачный: введён пароль
  //                                                     облачного сейфа — нужны
  //                                                     облачные данные
  //  • открылись оба, одна линия (тот же мастер-ключ)  → локальный: облачная
  //                                                     копия — та же линия,
  //                                                     не теряем свежие правки
  //  • открылся только локальный                       → локальный (обычный вход)
  const localKey = local ? await tryUnwrapKey(pendingAuthWho, pass, local) : null;
  const cloudKey = cloud ? await tryUnwrapKey(pendingAuthWho, pass, cloud) : null;
  let useCloud = false;
  if (!localKey && cloudKey) {
    useCloud = true;
  } else if (localKey && cloudKey) {
    let sameLineage = false;
    try { await aesDec(localKey, cloud.db); sameLineage = true; } catch (e) {}
    useCloud = !sameLineage;
  }
  const ok = await unlockWith(pendingAuthWho, pass, useCloud ? cloud : undefined);
  if (!ok && err) err.textContent = 'Неверный пароль. Попробуй ещё раз 💜';
}
async function doSetup() {
  const err = $('#setupErr');
  // Если в облаке уже есть сейф, а на устройстве его нет — не плодим второй:
  // ведём на экран входа, там сейф восстановится по паролю.
  if (pendingCloudVault && !loadVault()) {
    showAuth('lock');
    $('#cloudHint').hidden = false;
    return;
  }
  const who = $('#setupWho').value;
  const p1 = $('#setupPass').value;
  const p2 = $('#setupPass2').value;
  if (p1.length < 6) { if (err) err.textContent = 'Пароль должен быть не короче 6 символов.'; return; }
  if (p1 !== p2) { if (err) err.textContent = 'Пароли не совпадают — проверь ещё раз.'; return; }
  try {
    await createVault(who, p1);
    unlockApp();
  } catch (e) {
    // createVault может упасть (нет WebCrypto/IndexedDB) — понятная ошибка на экране,
    // а не «unhandledrejection» с тостом «Не удалось сохранить» при создании сейфа.
    console.warn('Не удалось создать сейф', e);
    if (err) err.textContent = 'Не удалось создать сейф. Обнови страницу и попробуй ещё раз 💜';
  }
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
// «У меня уже есть сейф» на экране первого запуска: переходим на вход и
// пробуем ещё раз найти сейф в облаке (сетевой запрос мог не успеть).
const setupToLockEl = $('#setupToLock');
if (setupToLockEl) setupToLockEl.addEventListener('click', async () => {
  showAuth('lock');
  $('#authErr').textContent = '';
  const cloud = typeof fetchCloudVault === 'function' ? await fetchCloudVault() : null;
  pendingCloudVault = cloud ? cloud.vault : null;
  const hint = $('#cloudHint');
  if (hint) hint.hidden = !cloud;
  if (cloud) $('#authPass').focus();
});
// «Повторить проверку облака» — когда первый запрос не нашёл сейф (сеть могла
// моргнуть, анонимный вход не успел).
const cloudRetryBtnEl = $('#cloudRetryBtn');
if (cloudRetryBtnEl) cloudRetryBtnEl.addEventListener('click', async () => {
  const btn = $('#cloudRetryBtn');
  if (btn) btn.disabled = true;
  $('#authErr').textContent = 'Проверяем облако…';
  const cloud = typeof fetchCloudVault === 'function' ? await fetchCloudVault() : null;
  if (btn) btn.disabled = false;
  if (cloud && cloud.vault) {
    pendingCloudVault = cloud.vault;
    $('#cloudHint').hidden = false;
    $('#cloudRetryBtn').hidden = true;
    $('#toSetupBtn').hidden = true;
    $('#authErr').textContent = '';
    $('#authPass').focus();
  } else {
    $('#authErr').textContent = 'Всё ещё не можем связаться с облаком. Проверь интернет и попробуй ещё раз, либо создай новый сейф.';
  }
});
// «Создать новый сейф» — осознанный выбор для настоящего первого запуска.
const toSetupBtnEl = $('#toSetupBtn');
if (toSetupBtnEl) toSetupBtnEl.addEventListener('click', () => showAuth('setup'));
// «Забыть сейф на этом устройстве» — восстановление после случайного второго
// сейфа (телефон «создал свой пароль» вместо входа): стираем локальный сейф и
// фото этого устройства, и при следующем открытии приложение снова найдёт общий
// сейф пары в облаке. Облачные данные при этом не трогаются.
const forgetVaultBtnEl = $('#forgetVaultBtn');
if (forgetVaultBtnEl) forgetVaultBtnEl.addEventListener('click', async () => {
  const msg = pendingCloudVault
    ? 'Забыть сейф и фото на ЭТОМ устройстве? Облачные данные пары не пострадают — при следующем входе они восстановятся.'
    : 'Сбросить это устройство к «первому запуску»? Локальный сейф и фото будут удалены с ЭТОГО устройства.';
  if (!confirm(msg)) return;
  try { localStorage.removeItem(VAULT_KEY); } catch (e) {}
  try { localStorage.removeItem(VAULT_KEY_PREV); } catch (e) {}
  try { localStorage.removeItem(SYNC_KEY); } catch (e) {}
  try { localStorage.removeItem(KEY); } catch (e) {}
  if (photoStore && typeof photoStore.clear === 'function') {
    try { await photoStore.clear(); } catch (e) {}
  }
  clearThumbCache();
  location.reload();
});
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

// Общая обёртка View Transitions: если переход уже идёт или не поддержан (или включено
// «уменьшенное движение») — сразу применяем изменения. Ошибки рендера и отменённые
// переходы гасим здесь же, чтобы они не превращались в unhandledrejection с ложным
// тостом «Не удалось сохранить», а быстрый повторный клик переключал вкладку мгновенно.
function runViewTransition(apply) {
  if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function' || motionReduced()) return false;
  try {
    const t = document.startViewTransition(() => {
      try { apply(); } catch (e) { console.warn('Ошибка при переключении', e); }
    });
    if (t) {
      if (t.finished && typeof t.finished.catch === 'function') t.finished.catch(() => {});
      if (t.updateCallbackDone && typeof t.updateCallbackDone.catch === 'function') t.updateCallbackDone.catch(() => {});
    }
    return true;
  } catch (e) { return false; } // переход уже идёт — применяем мгновенно
}

function setTheme(t) {
  const apply = () => {
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    const root = document.documentElement;
    if (root) root.dataset.theme = t;
    const btn = $('#themeToggle');
    if (btn) { btn.textContent = t === 'dark' ? '☀️' : '🌙'; btn.setAttribute('aria-pressed', String(t === 'dark')); }
    const sbtn = $('#settingsThemeBtn');
    if (sbtn) sbtn.textContent = t === 'dark' ? '☀️ Включить светлую тему' : '🌙 Включить тёмную тему';
  };
  // Фаза D: смена темы — тоже плавным переходом (если браузер умеет и анимации не выключены)
  if (!runViewTransition(apply)) apply();
}
function toggleTheme() { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); }

/* ===== Навигация ===== */
let activeView = 'home'; // текущая вкладка — для hash-роутинга и кнопки «назад»
// Наборы вкладок нижней навигации «5 + Ещё». Объявлены ДО showView: он смотрит
// BOTTOM_MORE, когда вкладка открывается по прямой ссылке (#/wishlist) — если бы
// const стоял ниже, в этот момент была бы TDZ-ошибка.
// Состав «5 + Ещё»: главные вкладки — Главная, Календарь, Память, Списки, Фото;
// в «Ещё» — Заметки, Хотелки, Песня, Настройки.
const BOTTOM_PRIMARY = ['home', 'calendar', 'memory', 'lists', 'photos'];
const BOTTOM_MORE = ['notes', 'wishlist', 'song', 'settings'];
function showView(view) {
  if (!$('#view-' + view)) return; // неизвестная вкладка — не трогаем экран
  activeView = view;
  const apply = () => {
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    const moreBtn = $('#navMoreBtn');
    if (moreBtn) moreBtn.classList.toggle('active', BOTTOM_MORE.indexOf(view) >= 0); // вкладка из «Ещё» — подсвечиваем кнопку
    if (view === 'home') renderHome();
    if (view === 'calendar') { calY = new Date().getFullYear(); calM = new Date().getMonth(); selectedDate = null; renderCalendar(); }
    if (view === 'notes') renderNotes();
    if (view === 'lists') renderLists();
    if (view === 'wishlist') renderWishlist();
    if (view === 'photos') renderPhotos();
    if (view === 'memory') renderMemory();
    if (view === 'settings') renderSettings();
  };
  // Фаза D: View Transitions API — плавная смена вкладок (crossfade всего экрана).
  // Без поддержки или при «уменьшенном движении» — переключение мгновенное.
  // Повторный клик во время анимации: Chrome отменяет текущий переход, мы ловим
  // исключение и переключаемся сразу — кнопки не «залипают» (см. runViewTransition).
  if (!runViewTransition(apply)) apply();
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

/* ===== Нижняя навигация на мобильных: 5 главных + «Ещё» =====
   Решение (утв.): на узких экранах вместо пилюль в шапке — закреплённая нижняя
   панель «Главная, Календарь, Память, Списки, Фото» и кнопкой «Ещё» (шторка:
   Заметки, Хотелки, Песня, Настройки). Кнопки
   клонируются из шапки, поэтому active-подсветка и клики работают как у оригинала. */

function buildBottomNav() {
  const bar = $('#bottomNav');
  const grid = $('#navSheetGrid');
  if (!bar || !grid || !bar.querySelectorAll) return;
  const navBtn = view => [...document.querySelectorAll('.nav-btn')].find(b => b.dataset && b.dataset.view === view);
  bar.innerHTML = '';
  BOTTOM_PRIMARY.forEach(view => {
    const src = navBtn(view);
    const clone = src ? src.cloneNode(true) : document.createElement('button');
    clone.type = 'button';
    clone.className = 'nav-btn bottom-nav-btn' + (view === activeView ? ' active' : '');
    if (!src) clone.dataset.view = view;
    bar.appendChild(clone);
  });
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'nav-btn bottom-nav-btn bottom-nav-more' + (BOTTOM_MORE.indexOf(activeView) >= 0 ? ' active' : '');
  moreBtn.id = 'navMoreBtn';
  moreBtn.textContent = '⋯ Ещё';
  moreBtn.setAttribute('aria-haspopup', 'dialog');
  moreBtn.setAttribute('aria-expanded', 'false');
  moreBtn.addEventListener('click', () => openNavSheet()); // «Ещё» не имеет data-view — открываем шторку напрямую
  bar.appendChild(moreBtn);
  grid.innerHTML = '';
  BOTTOM_MORE.forEach(view => {
    const src = navBtn(view);
    const clone = src ? src.cloneNode(true) : document.createElement('button');
    clone.type = 'button';
    clone.className = 'nav-btn nav-sheet-btn' + (view === activeView ? ' active' : '');
    if (!src) clone.dataset.view = view;
    grid.appendChild(clone);
  });
}
function openNavSheet() { const s = $('#navSheet'); if (s) s.hidden = false; const o = $('#navSheetOverlay'); if (o) o.hidden = false; const b = $('#navMoreBtn'); if (b) b.setAttribute('aria-expanded', 'true'); }
function closeNavSheet() { const s = $('#navSheet'); if (s) s.hidden = true; const o = $('#navSheetOverlay'); if (o) o.hidden = true; const b = $('#navMoreBtn'); if (b) b.setAttribute('aria-expanded', 'false'); }

// Клики по нижней панели и шторке (кнопки созданы клонированием — делегируем на document).
// Вынесено в именованную функцию: «Ещё» без data-view открывает шторку своей веткой.
function onNavDocClick(e) {
  const nb = e.target && e.target.closest && e.target.closest('#bottomNav .nav-btn, #navSheet .nav-btn');
  if (nb && nb.dataset && nb.dataset.view) { closeNavSheet(); go(nb.dataset.view); return; }
  const moreBtn = e.target && e.target.closest && e.target.closest('#navMoreBtn');
  if (moreBtn) { openNavSheet(); return; }
  const sheetX = e.target && e.target.closest && e.target.closest('[data-close-sheet]');
  if (sheetX) { closeNavSheet(); return; }
  if (e.target && e.target.classList && e.target.classList.contains('sheet-overlay')) closeNavSheet();
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', onNavDocClick);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNavSheet(); });
}
buildBottomNav();

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
  // Фаза B: кольцо прогресса (в блоке — коллаж фото, события «в этот день», статистика)
  renderProgressRing();
  // Фото с data-photo-src (кэш миниатюр не прогрет) — заполняем src асинхронно
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
    box.innerHTML = '<div class="empty-state dates-empty">💘 Свиданий пока нет.<br>Нажми «Назначить свидание» — и пусть оно обязательно случится!</div>';
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
    feed.innerHTML = '<div class="empty-state rem-empty">Пока пусто 💜<br>Добавляйте события и фото — здесь сложится история вашей вселенной.</div>';
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
    img.addEventListener('click', function () { openLightboxFrom(img); });
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
  for (const item of photos) {
    // Элемент — либо data-URL (строка, как раньше), либо { data: dataURL, file: оригинал }
    const photoRef = (item && typeof item === 'object') ? item.data : item;
    const origFile = (item && typeof item === 'object') ? item.file : null;
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
            const meta = { type: blob.type || 'image/jpeg', thumbType: (thumb && thumb.type) || 'image/webp', title, size: blob.size, origType: origFile ? (origFile.type || '') : '' };
            await photoStore.put(ph.id, blob, thumb, meta, origFile); // origFile — сырой файл, если есть
            if (ph.data === photoRef) delete ph.data; // блоб в сторе — base64 из памяти убираем
            if (typeof schedulePhotoSync === 'function') schedulePhotoSync();
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
      try { ok.push({ data: await readFile(f), file: f }); } catch (err) { console.warn('Не удалось прочитать фото события', err); }
    }
    inp.remove();
    if (!ok.length) return;
    const ids = addEventPhotosToGallery(ok, ev.title);
    const refs = ids.length ? ids : ok.map(x => (x && typeof x === 'object') ? x.data : x);
    ev.photos = Array.isArray(ev.photos) ? ev.photos.concat(refs) : refs;
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
  for (const item of photos) {
    // Элемент — либо data-URL (строка, как раньше), либо { data: dataURL, file: оригинал }
    const photoRef = (item && typeof item === 'object') ? item.data : item;
    const origFile = (item && typeof item === 'object') ? item.file : null;
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
            const meta = { type: blob.type || 'image/jpeg', thumbType: (thumb && thumb.type) || 'image/webp', title, size: blob.size, origType: origFile ? (origFile.type || '') : '' };
            await photoStore.put(ph.id, blob, thumb, meta, origFile); // origFile — сырой файл, если есть
            if (ph.data === photoRef) delete ph.data;
            if (typeof schedulePhotoSync === 'function') schedulePhotoSync();
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
      try { ok.push({ data: await readFile(f), file: f }); } catch (err) { console.warn('Не удалось прочитать фото свидания', err); }
    }
    inp.remove();
    if (!ok.length) return;
    const title = dt.place || dt.note || 'Свидание';
    const ids = addDatePhotosToGallery(ok, title);
    const refs = ids.length ? ids : ok.map(x => (x && typeof x === 'object') ? x.data : x);
    dt.photos = Array.isArray(dt.photos) ? dt.photos.concat(refs) : refs;
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
    try { evPhotoData.push({ data: await readFile(f), file: f }); } catch (err) { console.warn('Не удалось прочитать фото события', err); }
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
    data.photos = ids.length ? ids : evPhotoData.map(x => (x && typeof x === 'object') ? x.data : x);
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
    <div class="note${n.pinned ? ' pinned' : ''}" data-id="${n.id}">
      <div class="note-top">
        <button class="drag-handle note-drag" data-note-drag="${n.id}" title="Перетащить">⠿</button>
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
    : '<div class="empty-state">Пока пусто. Напиши первую записку! 💌</div>';
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
  if (!card || e.target.closest('.drag-handle')) return; // ручка — не повод редактировать
  startEditNote(card.dataset.id);
});

// Перетаскивание заметок — универсальный Pointer Events-движок (05-dnd.js).
// Порядок меняется «вживую»: соседние заметки FLIP-анимацией разъезжаются,
// на дропе пересчитываем order всем заметкам.
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
uniDragSetup({
  container: $('#notesGrid'),
  itemSel: '.note',
  handleSel: '.note-drag',
  idOf: c => c.dataset.id,
  onStart(st) { dragNoteId = st.id; },
  onDrop(st) {
    // renderNotes() всегда ставит закреплённые сверху — стабильно отсортируем ids
    // по pin до записи order, чтобы DOM после дропа не «перепрыгивал».
    const pinOf = id => { const n = db.notes.find(x => x.id === id); return n && n.pinned ? 0 : 1; };
    const ids = st.ids.slice().sort((a, b) => pinOf(a) - pinOf(b));
    ids.forEach((id, i) => { const n = db.notes.find(x => x.id === id); if (n) n.order = i; });
    save(); renderNotes();
    dragNoteId = null;
  },
  onCancel() { dragNoteId = null; }
});


/* ===== Списки ===== */
function listItemHTML(listId, it) {
  return `<li class="${it.done ? 'done' : ''}" data-item="${esc(it.id)}">
    <button class="check" data-toggle-item="${listId}" data-id="${it.id}" title="Готово">${it.done ? '✅' : '○'}</button>
    <span>${esc(it.text)}</span>
    <button class="mini-x" data-del-item="${listId}" data-id="${it.id}" title="Удалить">✕</button>
  </li>`;
}
// Выполненные подзадачи всегда внизу списка: устойчивая сортировка —
// внутри групп (невыполненные/выполненные) относительный порядок сохраняется.
function sortListItems(items) {
  return [...items].sort((a, b) => Number(!!a.done) - Number(!!b.done));
}
function renderLists() {
  const wrap = $('#listsWrap');
  if (!wrap) return;
  if (!db.lists.length) {
    wrap.innerHTML = '<div class="empty-state rem-empty">Пока нет ни одного списка 🫧<br>Создайте первый — например, «Подарки на 8 марта».</div>';
    return;
  }
  wrap.innerHTML = db.lists.map(list => {
    const active = list.items.filter(i => !i.done).length;
    const items = list.items.length
      ? sortListItems(list.items).map(it => listItemHTML(list.id, it)).join('')
      : '<li class="empty-li">Пока пусто 🫧</li>';
    return `<div class="list-card" data-id="${list.id}">
      <div class="list-head">
        <h3>${esc(list.name)} <small class="list-count">${active} в работе</small></h3>
        <button class="drag-handle list-drag" data-list-drag="${list.id}" title="Перетащить">⠿</button>
      </div>
      <div class="list-add">
        <input type="text" id="listInput-${list.id}" placeholder="Добавить подзадачу…">
        <button class="btn" data-list-add="${list.id}" title="Добавить">＋</button>
      </div>
      <ul class="items" id="listItems-${list.id}">${items}</ul>
      <div class="list-actions">
        <button class="btn btn-danger btn-small" data-list-complete="${list.id}" title="Выполнить все подзадачи и удалить список">✔ Выполнить список</button>
      </div>
    </div>`;
  }).join('');
}
// Точечное обновление подзадач ОДНОГО списка (без перерисовки всех карточек): в DOM
// переезжают только существующие <li> — FLIP-анимация плавно показывает, как
// выполненная подзадача уезжает вниз. Полный renderLists остаётся для структурных
// изменений (создание/удаление списка).
function refreshListCard(listId) {
  const card = [...document.querySelectorAll('.list-card')].find(c => c.dataset.id === listId);
  if (card) {
    const list = db.lists.find(l => l.id === listId);
    if (list) {
      const small = card.querySelector && card.querySelector('h3 small');
      if (small) small.textContent = list.items.filter(i => !i.done).length + ' в работе';
    }
  }
  renderListItems(listId);
}
function renderListItems(listId) {
  const list = db.lists.find(x => x.id === listId);
  const ul = $('#listItems-' + listId);
  if (!list || !ul || !ul.querySelectorAll || typeof document.createElement !== 'function') { renderLists(); return; }
  const before = new Map();
  const oldItems = new Map();
  [...ul.querySelectorAll('li')].forEach(li => {
    if (li.dataset && li.dataset.item) {
      before.set(li, li.getBoundingClientRect());
      oldItems.set(li.dataset.item, li);
    }
  });
  const sorted = sortListItems(list.items);
  const keep = [];
  if (sorted.length) {
    for (const it of sorted) {
      let li = oldItems.get(it.id);
      if (li) {
        li.classList.toggle('done', !!it.done);
        const check = li.querySelector && li.querySelector('.check');
        if (check) check.textContent = it.done ? '✅' : '○';
      } else {
        li = document.createElement('li');
        li.innerHTML = listItemHTML(list.id, it);
        if (li.dataset) li.dataset.item = it.id; // для мини-DOM без парсинга innerHTML
      }
      keep.push(li);
    }
  }
  // убираем узлы, которых больше нет (удалённые подзадачи / пустое состояние)
  [...ul.querySelectorAll('li')].forEach(li => { if (keep.indexOf(li) < 0) li.remove(); });
  // выстраиваем в правильном порядке (appendChild перемещает существующий узел)
  keep.forEach(li => { if (li.remove) li.remove(); ul.appendChild(li); });
  if (!sorted.length) {
    const empty = document.createElement('li');
    empty.classList.add('empty-li');
    empty.textContent = 'Пока пусто 🫧';
    ul.appendChild(empty);
  }
  listFlipAnimate(ul, before);
}
// FLIP: элементы, чьи координаты изменились, «переезжают» через transform (CSS transition)
function listFlipAnimate(scope, before) {
  if (typeof requestAnimationFrame === 'undefined' || !scope || !before || !scope.children) return;
  const moving = [];
  [...scope.children].forEach(el => {
    if (!before.has(el)) return;
    const r1 = before.get(el);
    const r2 = el.getBoundingClientRect();
    const dx = r1.left - r2.left, dy = r1.top - r2.top;
    if (!dx && !dy) return;
    if (!el.style) el.style = {};
    el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    moving.push(el);
  });
  if (!moving.length) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    moving.forEach(el => { el.style.transform = ''; });
  }));
}

// Создать список с произвольным названием; возвращает список или null.
function createList(rawName) {
  const name = String(rawName || '').trim();
  if (!name) return null;
  const list = { id: uid(), name, items: [] };
  db.lists.unshift(list); // новый список — сверху
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
  save(); if (inp) inp.value = '';
  refreshListCard(listId);
  return true;
}
function toggleSubtask(listId, itemId) {
  const list = db.lists.find(x => x.id === listId);
  if (!list) return false;
  const it = list.items.find(x => x.id === itemId);
  if (!it) return false;
  it.done = !it.done;
  list.items = sortListItems(list.items); // выполненные — вниз
  save(); refreshListCard(listId);
  // мини-«поп» галочки у переключённой подзадачи (анимация в CSS)
  const ul = $('#listItems-' + listId);
  const li = ul && ul.querySelector ? ul.querySelector('[data-item="' + itemId + '"]') : null;
  if (li) {
    li.classList.add('just-toggled');
    setTimeout(() => { if (li.classList.remove) li.classList.remove('just-toggled'); }, 400);
  }
  return it.done;
}
function delSubtask(listId, itemId) {
  const list = db.lists.find(x => x.id === listId);
  if (!list) return false;
  list.items = list.items.filter(x => x.id !== itemId);
  save(); refreshListCard(listId);
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

// Перетаскивание списков — универсальный Pointer Events-движок (05-dnd.js).
// Порядок — сам массив db.lists. Во время перетаскивания карточки «разъезжаются»
// по-живому (FLIP): видно, куда встанет перетаскиваемая. Отмена (Esc/пропуск
// броска) возвращает исходный порядок.
let dragListId = null; // id карточки, которую сейчас перетаскиваем
uniDragSetup({
  container: $('#listsWrap'),
  itemSel: '.list-card',
  handleSel: '.list-drag',
  idOf: c => c.dataset.id,
  onStart(st) { dragListId = st.id; },
  onDrop(st) {
    db.lists = st.ids.map(id => db.lists.find(l => l.id === id)).filter(Boolean);
    save();
    dragListId = null;
  },
  onCancel() { dragListId = null; }
});

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
  if (id === 'lightbox') lbResetState(); // светбокс закрыт — сбрасываем список и зум
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
  if (photo) { openLightboxFrom(photo); return; }

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
          const meta = { type: blob.type || 'image/jpeg', thumbType, title: f.name, size: blob.size, takenAt, origType: f.type || '' };
          await photoStore.put(ph.id, blob, thumb, meta, f); // f — оригинал (сырой файл камеры)
          delete ph.data;            // блоб в сторе — из памяти убираем base64
          if (typeof schedulePhotoSync === 'function') schedulePhotoSync(); // выгрузим в облако
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
    db.labels.filter(l => !sysLabels.includes(l)).map(l => `<button class="album-chip${currentLabel === l ? ' active' : ''}" data-label="${esc(l)}" title="Перетащи на фото, чтобы навесить лейбл"># ${esc(l)}<span class="label-del" data-label-del="${esc(l)}" title="Удалить лейбл">✕</span></button>`).join('') +
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
  if (typeof schedulePhotoSync === 'function') schedulePhotoSync(); // уберём и из облака
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
  grid.innerHTML = list.length ? list.map(p => {
    // Кэш миниатюр может быть ещё не прогрет — рисуем каркас и заполняем src
    // асинхронно (как в «Памяти» и на «Главной»), чтобы миниатюры появлялись сами.
    const url = photoSrc(p);
    return `
    <div class="photo${p.pinned ? ' pinned' : ''}${selectedPhotos.has(p.id) ? ' selected' : ''}" data-id="${p.id}">
      <img${url ? ' src="' + esc(url) + '"' : ' data-photo-src="' + esc(p.id) + '"'} alt="${esc(p.title)}" data-photo="${esc(p.id)}" loading="lazy">
      <button class="sel-photo${selectedPhotos.has(p.id) ? ' active' : ''}" data-sel-photo="${p.id}" title="${selectedPhotos.has(p.id) ? 'Снять выбор' : 'Выбрать'}">${selectedPhotos.has(p.id) ? '✓' : '○'}</button>
      <button class="pin-photo${p.pinned ? ' active' : ''}" data-pin-photo="${p.id}" title="${p.pinned ? 'Открепить' : 'Закрепить'}">${p.pinned ? '⭐' : '☆'}</button>
      <button class="del-photo" data-del-photo="${p.id}" title="Удалить">✕</button>
      <button class="drag-handle photo-drag" data-photo-drag="${p.id}" title="Перетащить">⠿</button>
      ${(p.labels || []).length ? `<div class="photo-labels">${p.labels.map(l =>
        `<span class="photo-label">${esc(l)}${l === EVENT_LABEL || l === DATE_LABEL ? '' : `<span class="photo-label-del" data-label-off="${esc(l)}" data-photo-off="${p.id}" title="Убрать лейбл с фото">✕</span>`}</span>`
      ).join('')}</div>` : ''}
      ${currentLabel === EVENT_LABEL && p.title ? `<span class="photo-caption">${esc(eventFilter.title || p.title)}</span>` : ''}
    </div>`;
  }).join('')
    : '<p class="cal-tip">📷 Загрузите ваши фото — они будут храниться локально, прямо в браузере.</p>';
  hydratePhotoImgs(grid); // миниатюры из photoStore — заполняем src после рендера каркаса
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
// Перетаскивание — универсальный Pointer Events-движок (05-dnd.js):
// 1) внутри сетки меняем порядок фото текущего фильтра (живое превью с FLIP);
// 2) фото, брошенное на чип лейбла, навешивает лейбл (и всем отмеченным);
// 3) чип лейбла, брошенный на фото, навешивает лейбл.
let dragPhotoId = null;
let dragLabel = null; // название лейбла, чип которого сейчас тащим
uniDragSetup({
  container: $('#photosGrid'),
  itemSel: '.photo',
  handleSel: '.photo-drag',
  idOf: c => c.dataset.id,
  targets: [{
    sel: '.album-chip[data-label]',
    canDrop(st, chip, el) {
      return !!chip.dataset.label && chip.dataset.label !== EVENT_LABEL && chip.dataset.label !== DATE_LABEL
        && !(el && el.closest && el.closest('[data-label-del]'));
    },
    highlight(chip, on) { chip.classList.toggle('drag-over', on); },
    drop(st, chip) {
      const name = chip.dataset.label;
      const targets = new Set(selectedPhotos); // массовое назначение: всем отмеченным…
      targets.add(st.id);                      // …и перетаскиваемому фото
      applyLabelToPhotos(name, targets);
      selectedPhotos.clear(); // действие выполнено — выделение снимаем
      save(); renderPhotos();
      dragPhotoId = null;
    }
  }],
  onStart(st) { dragPhotoId = st.id; },
  onDrop(st) {
    // порядок из текущего DOM-порядка сетки: закреплённые всегда сверху
    const domIds = uniDragCards($('#photosGrid'), '.photo').map(c => c.dataset.id);
    const list = domIds.map(id => db.photos.find(p => p.id === id)).filter(Boolean);
    [...list.filter(p => p.pinned), ...list.filter(p => !p.pinned)].forEach((p, i) => {
      const ph = db.photos.find(x => x.id === p.id);
      if (ph) ph.order = i;
    });
    save(); renderPhotos();
    dragPhotoId = null;
  },
  onCancel() { dragPhotoId = null; }
});
// Чипы лейблов: тащим сам чип на фото (или на отмеченные) — навешиваем лейбл.
// Клик по чипу (без драга) по-прежнему переключает фильтр.
uniDragSetup({
  container: $('#labelBar'),
  itemSel: '.album-chip[data-label]',
  ignoreSel: '[data-label-del]',
  allow: chip => !!chip.dataset.label && chip.dataset.label !== EVENT_LABEL && chip.dataset.label !== DATE_LABEL,
  reorder: false,
  idOf: c => c.dataset.label,
  targets: [{
    sel: '.photo',
    highlight(photo, on) { photo.classList.toggle('drag-over', on); },
    drop(st, photo) {
      const name = st.id;
      const targets = new Set(selectedPhotos); // всем отмеченным…
      targets.add(photo.dataset.id);           // …и фото под курсором
      applyLabelToPhotos(name, targets);
      selectedPhotos.clear();
      save(); renderPhotos();
      dragLabel = null;
    }
  }],
  onStart(st) { dragLabel = st.id; },
  onDrop() { dragLabel = null; },
  onCancel() { dragLabel = null; }
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
  // Статус облачной синхронизации (модуль 95-sync.js)
  if (typeof renderSyncStatus === 'function') renderSyncStatus(syncUiState, syncUiTs);
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
  // Фаза D: имя бэкапа с датой — сразу видно, когда сделана копия
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  a.download = `nasha-vselennaya-backup-${y}-${mo}-${da}.json`;
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

/* ===== Светбокс 2.0: стрелки, свайп, зум, счётчик =====
   Единая точка открытия фото: по id из галереи/календаря/«Памяти» или по
   data-URL напрямую (хотелки). Стрелки ‹ ›, свайп и клавиши ←/→ листают;
   зум — кнопка 🔍, двойной клик, щипок, клавиши +/-/0; счётчик «N / M». */
let lightboxList = [];   // источники: id фото из db.photos ИЛИ data-URL
let lightboxIdx = 0;
let lightboxZoom = 1;

/* ===== Скачивание фото (кнопка «⬇️ Скачать оригинал») ===== */
function extFromMime(type) {
  const m = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif', 'image/svg+xml': 'svg' };
  return m[type || ''] || '';
}
function safeFileName(name) {
  const clean = String(name || '').replace(/[^\wа-яёА-ЯЁ\s\-()]+/gi, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
  return clean || 'photo';
}
function downloadBlob(blob, name) {
  if (!blob || typeof URL === 'undefined' || !URL.createObjectURL || typeof document === 'undefined') return;
  const ext = extFromMime(blob.type);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = safeFileName(name) + (ext ? '.' + ext : '');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function downloadDataUrl(dataUrl, name) {
  const blob = dataUrlToBlob(dataUrl);
  if (blob) downloadBlob(blob, name);
}
async function downloadCurrentPhoto() {
  const src = lightboxList[lightboxIdx];
  if (!src) return;
  if (lbIsDataUrl(src)) { downloadDataUrl(src, 'photo'); return; }
  const p = lbPhoto(src);
  if (!p || !photoStore || !p.id) return;
  const name = p.title || 'photo';
  let blob = null;
  try { blob = await photoStore.getOrig(p.id); } catch (e) {}
  if (!blob) { try { blob = await photoStore.getFull(p.id); } catch (e) {} }
  if (blob) downloadBlob(blob, name);
}

function lbIsDataUrl(src) { return typeof src === 'string' && src.indexOf('data:') === 0; }
function lbPhoto(src) { return Array.isArray(db.photos) ? db.photos.find(p => p.id === src) || null : null; }

function openLightbox(ids, idx) {
  lightboxList = Array.isArray(ids) ? ids.slice() : [];
  lightboxIdx = Math.max(0, Math.min(idx || 0, lightboxList.length ? lightboxList.length - 1 : 0));
  lightboxZoom = 1;
  const lb = $('#lightbox');
  if (lb) lb.hidden = false;
  lbRender();
}
// Открытие по клику: листаем среди всех кликабельных фото текущей группы/вкладки
function openLightboxFrom(el) {
  if (!el || !el.closest) return;
  const scope = el.closest('[data-photo-group]') || el.closest('.view') || document.body;
  const els = scope.querySelectorAll ? [...scope.querySelectorAll('[data-photo], [data-lightbox]')] : [];
  const src = el.dataset.lightbox || el.dataset.photo;
  const list = els.map(x => x.dataset.lightbox || x.dataset.photo);
  let at = list.indexOf(src);
  if (at < 0) at = 0;
  openLightbox(list, at);
}
function lbResetState() { lightboxList = []; lightboxIdx = 0; lightboxZoom = 1; }
function lbClose() {
  const lb = $('#lightbox');
  if (lb) lb.hidden = true;
  lbResetState();
}
function lbNav(dir) {
  if (!lightboxList.length) return;
  lightboxIdx = (lightboxIdx + dir + lightboxList.length) % lightboxList.length;
  lightboxZoom = 1; // новое фото — без зума
  lbRender();
}
function lbZoomTo(v) { lightboxZoom = Math.min(4, Math.max(1, v)); lbRender(); }
function lbZoomToggle() { lbZoomTo(lightboxZoom > 1 ? 1 : 2.5); }

function lbRender() {
  const img = $('#lightboxImg');
  const counter = $('#lbCounter');
  const prev = $('#lbPrev');
  const next = $('#lbNext');
  const src = lightboxList[lightboxIdx];
  const multi = lightboxList.length > 1;
  if (prev) prev.style.display = multi ? '' : 'none';
  if (next) next.style.display = multi ? '' : 'none';
  if (counter) counter.textContent = multi ? (lightboxIdx + 1) + ' / ' + lightboxList.length : '';
  if (!src) { if (img) img.src = ''; return; }
  if (img) {
    img.style.transform = 'scale(' + lightboxZoom + ')';
    img.style.cursor = lightboxZoom > 1 ? 'zoom-out' : 'zoom-in';
  }
  if (lbIsDataUrl(src)) { if (img) img.src = src; return; }
  const p = lbPhoto(src);
  if (!p) { if (img) img.src = ''; return; }
  const cached = photoSrc(p); // миниатюра из кэша — мгновенный показ
  if (cached && img) img.src = cached;
  photoUrl(p, false).then(url => {
    if (url && img && lightboxList[lightboxIdx] === src && img.src !== url) img.src = url;
  });
}

/* ===== События светбокса ===== */
const lbPrevBtn = $('#lbPrev');
if (lbPrevBtn) lbPrevBtn.addEventListener('click', () => lbNav(-1));
const lbNextBtn = $('#lbNext');
if (lbNextBtn) lbNextBtn.addEventListener('click', () => lbNav(1));
const lbZoomBtn = $('#lbZoomBtn');
if (lbZoomBtn) lbZoomBtn.addEventListener('click', () => lbZoomToggle());
const lbDlBtn = $('#lbDownload');
if (lbDlBtn) lbDlBtn.addEventListener('click', () => downloadCurrentPhoto());
const lbImg = $('#lightboxImg');
if (lbImg) lbImg.addEventListener('dblclick', () => lbZoomToggle());
if (typeof document !== 'undefined' && document.addEventListener) {
  // Клавиатура: ←/→ листают, +/−/0 зум, Esc закрывает (обработчик Esc — в 60-lists-wishes)
  document.addEventListener('keydown', e => {
    const lb = $('#lightbox');
    if (!lb || lb.hidden) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); lbNav(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); lbNav(1); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); lbZoomTo(lightboxZoom + 0.5); }
    else if (e.key === '-') { e.preventDefault(); lbZoomTo(lightboxZoom - 0.5); }
    else if (e.key === '0') { e.preventDefault(); lbZoomTo(1); }
  });
}
// Свайп (горизонтальный — листание) и щипок (пинч — зум)
let lbTouchX = null;
let lbTouchY = null;
let lbPinch = null;
function lbTouchDist(e) {
  const t = e.touches;
  const dx = t[0].clientX - t[1].clientX;
  const dy = t[0].clientY - t[1].clientY;
  return Math.sqrt(dx * dx + dy * dy) || 1;
}
const lbStage = $('#lbStage');
if (lbStage) {
  lbStage.addEventListener('touchstart', e => {
    if (!e.touches) return;
    if (e.touches.length === 1) { lbTouchX = e.touches[0].clientX; lbTouchY = e.touches[0].clientY; }
    else if (e.touches.length === 2) { lbPinch = { d: lbTouchDist(e), s: lightboxZoom }; lbTouchX = null; }
  }, { passive: true });
  lbStage.addEventListener('touchmove', e => {
    if (e.touches && e.touches.length === 2 && lbPinch) {
      e.preventDefault(); // без этого браузер листает страницу
      lbZoomTo(lbPinch.s * (lbTouchDist(e) / lbPinch.d));
    }
  }, { passive: false });
  lbStage.addEventListener('touchend', e => {
    if (lbTouchX != null && e.changedTouches && e.changedTouches[0]) {
      const dx = e.changedTouches[0].clientX - lbTouchX;
      const dy = e.changedTouches[0].clientY - lbTouchY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) lbNav(dx < 0 ? 1 : -1);
    }
    lbTouchX = null;
    lbPinch = null;
  });
}
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
async function initAuth() {
  initPhotoStore(); // открываем IndexedDB (или fallback) до первого входа
  renderUserChip();
  setTheme(getTheme());
  applyMotion(getMotion());
  lastActivity = Date.now();
  startAutoLock();
  document.body.classList.add('auth');
  pendingAuthWho = 'gosha';
  renderAuthWho();
  const hasLocal = !!loadVault();
  // Всегда открываем ЗАМОК (вход), а не экран «создать пароль». Экран создания —
  // только по явной кнопке или когда облако проверено и сейфа там точно нет.
  // Раньше «создать пароль» показывался сразу на свежем устройстве, и если облако
  // отвечало медленно (мобильный интернет), телефон предлагал завести ВТОРОЙ сейф
  // вместо входа в существующий — так появились «фото, зашифрованные другим паролем».
  showAuth('lock');
  $('#authErr').textContent = 'Ищем сейф пары в облаке…';
  let cloud = null;
  try { cloud = await fetchCloudVault(); } catch (e) { console.warn('initAuth: облако недоступно', e); }
  if (cloud && cloud.vault) {
    pendingCloudVault = cloud.vault;
    $('#authErr').textContent = '';
    if (hasLocal) {
      // Локальный сейф есть + облачный отдельный: вход паролем облачного сейфа
      // вернёт облачные данные (см. cloudHint2 в index.html).
      $('#cloudHint2').hidden = false;
    } else {
      $('#cloudHint').hidden = false;
    }
    $('#authPass').focus();
  } else if (!hasLocal) {
    // Свежее устройство и облако не ответило (или сейфа там нет): объясняем и
    // даём выбор — повторить проверку или действительно создать новый сейф.
    $('#authErr').textContent = 'Не удалось найти сейф в облаке. Проверь интернет и нажми «Повторить проверку», или создай новый сейф на этом устройстве.';
    $('#cloudRetryBtn').hidden = false;
    $('#toSetupBtn').hidden = false;
  } else {
    // Локальный сейф есть, а облако не ответило — обычный вход локальным паролем.
    $('#authErr').textContent = '';
  }
  // Если JS по какой-то причине не выполнится — контент так и останется скрытым
  // (body.auth прячет шапку и main), никто ничего не увидит.
}
// Вызов initAuth() стоит в конце 95-sync.js (самый последний модуль сборки):
// initAuth читает FIREBASE_CONFIG (let из 95-sync.js), а он ещё в «мёртвой зоне»
// во время выполнения 90-effects-init.js.
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




/* ===== Облачная синхронизация (фаза B, Firebase Realtime Database) =====
   Принцип: localStorage — «правда» локально, Firebase — канал синхронизации.
   Синхронизируем САМ зашифрованный сейф `universe_vault` (zero-knowledge):
   на сервере лежит только шифртекст (AES-GCM мастер-ключом + обёртки обоих
   паролей внутри), поэтому и Гоша, и Даша открывают облачные данные своим
   паролем, а Firebase ничего прочитать не может.

   Путь в RTDB: vaults/shared = { syncTs, vault }. Правила: read/write auth != null
   (см. README). Конфликты: «последняя правка выигрывает» по syncTs.

   Фаза B1: вставь config из Firebase Console в FIREBASE_CONFIG ниже.
   Фаза B3 (фото): оригиналы+миниатюры синхронизируются через Яндекс.Диск —
   вставь токен в YANDEX_DISK_CONFIG ниже (Firebase Storage — только на платном
   Blaze-плане, из России его не оплатить).
   Без config (или без интернета) приложение работает как раньше — локально.
   Работает на http(s); на file:// SDK может не загрузиться — тоже локально. */

let FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDuAkskIpj3bsFOX6aPecFWZGJOlOzGzUk",
  authDomain:        "nasha-vselennaya.firebaseapp.com",
  databaseURL:       "https://nasha-vselennaya-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "nasha-vselennaya",
  storageBucket:     "nasha-vselennaya.firebasestorage.app",
  messagingSenderId: "222445763153",
  appId:             "1:222445763153:web:df254e6b681c2e40289670",
  measurementId:     "G-JZY24EXCX3"
}; // ← config из Firebase Console (фаза B1). let — чтобы тесты могли подставить мок.

/* Фото-облако (фаза B3): Яндекс.Диск вместо Firebase Storage (Storage — только на
   платном Blaze-плане, из России оплатить нельзя). Как получить токен — README,
   шаг 6: oauth.yandex.ru → «Создать приложение» (Callback https://oauth.yandex.ru/verification_code)
   → доступ «Яндекс.Диск REST API. Доступ к папке приложения» (cloud_api:disk.app_folder)
   → «Выпустить токен». Токен видит только папку приложения /Приложения/<имя>/,
   пути ниже идут относительно неё. */
let YANDEX_DISK_CONFIG = {
  token: 'y0__wgBEIepmJ0CGJqORyD9n7LOGDDY3uKSCI0YP0CcYDMHfx8QFUB_zk_nyS9i', // OAuth-токен Яндекса (scope: cloud_api:disk.app_folder)
  basePath: '/photos' // внутри папки приложения: app:/photos/orig/{id}, app:/photos/full/{id}, app:/photos/thumb/{id}
};

const SYNC_KEY = 'universe_syncTs';  // последний известный syncTs (метаданные, не секрет)
const SYNC_PATH = 'vaults/shared';   // общий зашифрованный сейф пары

let syncFirebase = null;   // firebaseApp (compat)
let syncDb = null;         // firebase.database()
let syncReady = false;     // SDK есть, config есть, анонимный вход сделан
let syncTs = 0;            // последний применённый syncTs
let syncPushTimer = null;  // debounce push после save()
let syncApplying = false;  // защита от рекурсии pull→save→push

/* ===== Инициализация: вызывается из unlockApp() после входа ===== */
async function initSync() {
  syncTs = parseInt(store.get(SYNC_KEY) || '0', 10) || 0;
  if (!FIREBASE_CONFIG) { renderSyncStatus('off'); return; }
  if (typeof firebase === 'undefined' || typeof firebase.initializeApp !== 'function' ||
      typeof firebase.database !== 'function' || typeof firebase.auth !== 'function') {
    renderSyncStatus('off');
    return;
  }
  try {
    syncFirebase = firebase.initializeApp(FIREBASE_CONFIG, 'nasha_sync');
    syncDb = firebase.database(syncFirebase);
    // Хранилище фото (фаза B3): оригиналы + миниатюры в Яндекс.Диске (бесплатно,
    // из РФ работает). Firebase Storage — только на платном Blaze, оставлен как
    // запасной вариант. Без токена фото остаются локальными — как раньше.
    if (YANDEX_DISK_CONFIG && YANDEX_DISK_CONFIG.token) syncStorage = makeYdStorage();
    else if (typeof firebase.storage === 'function') syncStorage = firebase.storage(syncFirebase);
    // Anonymous Auth: оба устройства — «гости», доступ к общему vaults/shared.
    // UID нигде не храним: правила разрешают любому анониму, данные зашифрованы.
    const cred = await firebase.auth(syncFirebase).signInAnonymously();
    if (!cred || !cred.user) throw new Error('no anonymous user');
    syncReady = true;
    renderSyncStatus('idle');
    listenRemote();      // живые обновления с другого устройства
    pullVault(true);     // при входе пробуем забрать свежие данные
    scheduleSyncPush();  // и отдать свои, если они свежее
    schedulePhotoSync(); // фото: выгрузить свои / скачать недостающие
  } catch (e) {
    console.warn('[sync] init failed', e);
    syncReady = false;
    renderSyncStatus('error');
  }
}

/* ===== Push: после каждого save() (debounce 1.5с) ===== */
function scheduleSyncPush() {
  if (!syncReady || syncApplying) return;
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(pushVault, 1500);
}

// Защита от затирания чужого сейфа. Облачный сейф не расшифровался текущим
// ключом — значит, в облаке сейф другого устройства/пароля (например, созданный
// «вторым» сейфом в свежем браузере). Автоматически его не трогаем: показываем
// конфликт, дальше решает человек («Синхронизировать сейчас» = forcePushVault).
let syncPushBlocked = false;

// Быстрый опрос облака ДО первого входа (экран замка/создания): есть ли уже
// зашифрованный сейф пары? Ничего не пишет, слушатели не вешает. Возвращает
// { vault, ts } или null, если сейфа нет / нет сети / config пустой.
// Таймаут для сетевых вызовов: не держим пользователя на «проверяем облако…»
// бесконечно, если Firebase отвечает медленно (мобильный интернет).
function withTimeout(promise, ms) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })
  ]).finally(() => { if (timer) clearTimeout(timer); });
}
let probeApp = null;
let probeUser = null; // анонимный пользователь probe-приложения — переиспользуем между проверками
async function fetchCloudVault() {
  if (!FIREBASE_CONFIG || typeof firebase === 'undefined' || typeof firebase.initializeApp !== 'function' ||
      typeof firebase.auth !== 'function' || typeof firebase.database !== 'function') return null;
  try {
    // Несколько попыток: на мобильном интернете анонимный вход или чтение могут
    // не успеть с первого раза. «Пустое облако» — не ошибка, повторяться не нужно.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        probeApp = probeApp || firebase.initializeApp(FIREBASE_CONFIG, 'nasha_probe');
        if (!probeUser) {
          const cred = await withTimeout(firebase.auth(probeApp).signInAnonymously(), 10000);
          if (!cred || !cred.user) return null;
          probeUser = cred.user;
        }
        const snap = await withTimeout(firebase.database(probeApp).ref(SYNC_PATH).once('value'), 10000);
        const data = snap && snap.val ? snap.val() : null;
        if (!data || !data.vault || !data.vault.db || typeof data.vault.db.d !== 'string') return null;
        return { vault: data.vault, ts: data.syncTs || 0 };
      } catch (e) {
        console.warn('[sync] нет доступа к облаку при старте (попытка ' + (attempt + 1) + ')', e);
        if (attempt < 2) await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
    return null;
  } catch (e) {
    console.warn('[sync] нет доступа к облаку при старте', e);
    return null;
  }
}

// Запись сейфа в облако (общий путь для push и принудительного восстановления).
async function writeVault() {
  const vault = loadVault();
  if (!vault || !vault.db || typeof vault.db.d !== 'string') return;
  renderSyncStatus('syncing');
  const ts = Date.now();
  await syncDb.ref(SYNC_PATH).set({ syncTs: ts, vault });
  syncTs = ts;
  store.set(SYNC_KEY, String(ts));
  renderSyncStatus('ok', ts);
}

async function pushVault() {
  if (!syncReady || syncApplying) return;
  // Смотрим, что сейчас лежит в облаке. Если сейф другой и не расшифровывается
  // текущим ключом — это чужой сейф: НЕ затираем его автоматически.
  try {
    const snap = await syncDb.ref(SYNC_PATH).once('value');
    const remote = snap && snap.val ? snap.val() : null;
    if (remote && remote.vault && remote.vault.db && typeof remote.vault.db.d === 'string' && masterKey) {
      let ok = false;
      try { await aesDec(masterKey, remote.vault.db); ok = true; } catch (e) {}
      if (!ok) {
        syncPushBlocked = true;
        renderSyncStatus('conflict');
        notify('В облаке сейф с другим паролем — я его не трогаю. Чтобы открыть данные из облака: нажми чип «Гоша/Даша» (замок) и введи пароль облачного сейфа 💜', true);
        return;
      }
    }
  } catch (e) {
    console.warn('[sync] не удалось проверить облачный сейф', e);
    renderSyncStatus('error');
    return;
  }
  syncPushBlocked = false;
  try { await writeVault(); }
  catch (e) {
    console.warn('[sync] push failed', e);
    renderSyncStatus('error');
  }
}

// Явное восстановление: затирает облачный сейф сейфом этого устройства.
// Это осознанное действие человека (кнопка «Синхронизировать сейчас» в конфликте).
async function forcePushVault() {
  if (!syncReady) return;
  syncPushBlocked = false;
  try { await writeVault(); }
  catch (e) {
    console.warn('[sync] force push failed', e);
    renderSyncStatus('error');
  }
}

/* ===== Pull: читаем облако, применяем, если оно свежее ===== */
async function pullVault(silent) {
  if (!syncReady) return;
  try {
    const snap = await syncDb.ref(SYNC_PATH).once('value');
    const remote = snap && snap.val ? snap.val() : null;
    if (!remote || !remote.vault || !remote.vault.db || typeof remote.vault.db.d !== 'string') return;
    const rts = remote.syncTs || 0;
    if (rts <= syncTs) return; // облако не свежее — не трогаем локальные данные
    const applied = await applyRemoteVault(remote.vault);
    if (!applied) { renderSyncStatus('error'); return; }
    syncTs = rts;
    store.set(SYNC_KEY, String(rts));
    renderSyncStatus('ok', rts);
    if (!silent) notify('Данные обновлены с другого устройства 💜');
  } catch (e) {
    console.warn('[sync] pull failed', e);
    renderSyncStatus('error');
  }
}

/* ===== Живой слушатель: изменения с другого устройства приходят сами ===== */
let syncLiveOn = false;
function listenRemote() {
  if (syncLiveOn || !syncReady || !syncDb) return;
  syncLiveOn = true;
  syncDb.ref(SYNC_PATH).on('value', snap => {
    if (syncApplying) return;
    const remote = snap && snap.val ? snap.val() : null;
    if (!remote || !remote.vault || !remote.vault.db || typeof remote.vault.db.d !== 'string') return;
    const rts = remote.syncTs || 0;
    if (rts <= syncTs) return; // свой же push
    renderSyncStatus('syncing');
    applyRemoteVault(remote.vault).then(ok => {
      if (!ok) { renderSyncStatus('error'); return; }
      syncTs = rts;
      store.set(SYNC_KEY, String(rts));
      renderSyncStatus('ok', rts);
      notify('Данные обновлены с другого устройства 💜');
    }).catch(e => { console.warn('[sync] live apply failed', e); renderSyncStatus('error'); });
  });
}

/* ===== Применить облачный сейф: расшифровать → db → перерисовать =====
   AES-GCM — аутентифицированное шифрование: чужой/повреждённый блоб не
   расшифруется (упадёт), локальные данные не пострадают. */
async function applyRemoteVault(remoteVault) {
  if (!masterKey) return false;
  let raw;
  try {
    raw = await aesDec(masterKey, remoteVault.db);
  } catch (e) {
    console.warn('[sync] облачный сейф не расшифровать (не тот ключ/повреждён?)', e);
    return false;
  }
  let nd;
  try {
    nd = migrateDB({ ...defaultDB(), ...JSON.parse(dec.decode(raw)) });
  } catch (e) {
    console.warn('[sync] облачные данные повреждены', e);
    return false;
  }
  syncApplying = true;
  try {
    db = nd;
    store.set(VAULT_KEY, JSON.stringify(remoteVault));
    if (photoStore) {
      await photoStore.migratePhotos(db);
      await photoStore.refreshSizes();
      warmThumbCache();
    }
    await save(); // закрепить миграции локально (push не запустится: syncApplying)
    renderUserChip(); renderHome(); renderCalendar(); renderNotes();
    renderLists(); renderWishlist(); renderPhotos(); renderMemory(); renderSettings();
    schedulePhotoSync(); // пришли новые/удалённые фото — сверимся с облаком
    return true;
  } catch (e) {
    console.warn('[sync] применить облачные данные не удалось', e);
    return false;
  } finally {
    syncApplying = false;
  }
}

/* ===== Остановка: при lock() ===== */
function stopSync() {
  clearTimeout(syncPushTimer);
  clearTimeout(photoSyncTimer);
  if (syncLiveOn && syncDb) {
    try { syncDb.ref(SYNC_PATH).off('value'); } catch (e) {}
    syncLiveOn = false;
  }
  if (syncFirebase && typeof syncFirebase.auth === 'function') {
    try { syncFirebase.auth().signOut(); } catch (e) {}
  }
  syncReady = false;
  syncFirebase = null;
  syncDb = null;
  syncStorage = null;
  syncPushBlocked = false;
  photoSyncing = false;
  renderSyncStatus('off');
}


/* ===== Фото в облаке (фаза B3): оригиналы + миниатюры в Яндекс.Диске =====
   Пути: photos/orig/{id} (исходный файл), photos/full/{id} (показ-версия),
   photos/thumb/{id} (миниатюра). В облако уезжают САМИ шифртексты из photoStore
   (AES-GCM мастер-ключом) — сервер видит только шифртекст, прочитать фото без
   пароля нельзя (zero-knowledge), а на другом устройстве они расшифровываются тем
   же мастер-ключом. Реализация — адаптер makeYdStorage() ниже: тот же интерфейс
   { put, getBlob, delete, listAll }, что у Firebase Storage.

   Модель — полная сверка (reconciliation): после каждой операции с фото
   (добавление, удаление, применение облачного сейфа) с задержкой сравниваем три
   списка: локальный photoStore, облако Storage и db.photos. Недостающее выгружаем
   и скачиваем, лишнее (удалённые фото) чистим и в облаке, и в локальном сторе.
   Так работают и бэкфилл старых фото, и удаление с другого устройства. */
const PHOTO_PARTS = ['orig', 'full', 'thumb'];
let syncStorage = null;      // Яндекс.Диск (или firebase.storage() на платном Blaze)
let photoSyncTimer = null;   // debounce после операций с фото
let photoSyncing = false;    // защита от параллельных сверок

/* ===== Адаптер Яндекс.Диска к интерфейсу фото-логики =====
   REST API: cloud-api.yandex.net/v1/disk. Загрузка — GET /resources/upload
   (в ответе href) → PUT на href; скачивание — GET /resources/download (href) →
   GET на href; удаление — DELETE /resources; список папки — GET /resources
   (пагинация limit=1000 по offset). CORS поддержан: cloud-api.yandex.net
   отвечает Access-Control-Allow-Origin и разрешает Authorization. */
const YD_API = 'https://cloud-api.yandex.net/v1/disk';
const YD_LIMIT = 1000;
let ydFetch = (typeof fetch === 'function') ? fetch : null; // let — чтобы тесты могли подменить

async function ydRequest(url, opts, tries) {
  const attempt = tries || 0;
  try {
    if (!ydFetch) throw new Error('fetch недоступен');
    const res = await ydFetch(url, opts);
    if (res.status === 429 || res.status >= 500) {
      const e = new Error('YD ' + res.status);
      e.retryable = true;
      throw e;
    }
    if (!res.ok) throw new Error('YD ' + res.status);
    return res;
  } catch (e) {
    // Ретраим только временные сбои (429/5xx/сеть). Ошибки 4xx (403, 404, 409)
    // детерминированы — повторять бессмысленно, а в тестах setTimeout-заглушка
    // вообще не вызывает колбэк, так что ретрай «завис» бы навсегда.
    if (e && e.retryable && attempt < 2) {
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
      return ydRequest(url, opts, attempt + 1);
    }
    throw e;
  }
}
function ydHeaders() { return { Authorization: 'OAuth ' + YANDEX_DISK_CONFIG.token }; }
// Токен имеет scope cloud_api:disk.app_folder — видит ТОЛЬКО папку приложения,
// поэтому все пути обязаны начинаться с app:/ (иначе API отвечает 403 Forbidden).
function ydPath(part, id) { return 'app:' + YANDEX_DISK_CONFIG.basePath + '/' + part + '/' + id; }
function ydUploadUrl(part, id) { return YD_API + '/resources/upload?path=' + encodeURIComponent(ydPath(part, id)) + '&overwrite=true'; }
function ydDownloadUrl(part, id) { return YD_API + '/resources/download?path=' + encodeURIComponent(ydPath(part, id)); }
function ydDeleteUrl(part, id) { return YD_API + '/resources?path=' + encodeURIComponent(ydPath(part, id)) + '&permanently=true'; }
function ydListUrl(folder, offset) { return YD_API + '/resources?path=' + encodeURIComponent(folder) + '&limit=' + YD_LIMIT + '&offset=' + offset; }

// Яндекс не создаёт промежуточные папки сам (409 DiskPathDoesntExistsError), поэтому
// перед загрузкой гарантируем цепочку app:/photos → app:/photos/{part}.
async function ydEnsureDir(path) {
  try {
    await ydRequest(YD_API + '/resources?path=' + encodeURIComponent(path), { method: 'PUT', headers: ydHeaders() });
  } catch (e) { /* 409 — папка уже есть (или появится после создания родителя): не ошибка */ }
}
async function ydEnsureDirs(part) {
  await ydEnsureDir('app:' + YANDEX_DISK_CONFIG.basePath);
  await ydEnsureDir('app:' + YANDEX_DISK_CONFIG.basePath + '/' + part);
}

async function ydUpload(part, id, blob) {
  await ydEnsureDirs(part);
  const r = await ydRequest(ydUploadUrl(part, id), { method: 'GET', headers: ydHeaders() });
  const j = await r.json();
  const href = j && j.href;
  if (!href) throw new Error('YD: нет ссылки для загрузки');
  const up = await ydFetch(href, { method: j.method || 'PUT', body: blob, headers: { 'Content-Type': 'application/json' } });
  if (up.status !== 201 && up.status !== 202 && !up.ok) throw new Error('YD upload ' + up.status);
}

async function ydDownload(part, id) {
  const r = await ydRequest(ydDownloadUrl(part, id), { method: 'GET', headers: ydHeaders() });
  const j = await r.json();
  const href = j && j.href;
  if (!href) throw new Error('YD: нет ссылки для скачивания');
  const down = await ydFetch(href, { method: j.method || 'GET' });
  if (!down.ok) throw new Error('YD download ' + down.status);
  return down.blob();
}

async function ydDelete(part, id) {
  await ydRequest(ydDeleteUrl(part, id), { method: 'DELETE', headers: ydHeaders() });
}

async function ydList(folder) {
  const items = [];
  let offset = 0;
  for (;;) {
    let r;
    try { r = await ydRequest(ydListUrl(folder, offset), { method: 'GET', headers: ydHeaders() }); }
    catch (e) {
      // Папки ещё нет (первый запуск до выгрузки) — это пустой список, а не ошибка
      if (/404|Not Found/i.test(String((e && e.message) || ''))) return { items, prefixes: [] };
      throw e;
    }
    const j = await r.json();
    const chunk = (j._embedded && j._embedded.items) || [];
    for (const it of chunk) if (it && it.type === 'file') items.push({ name: it.name });
    if (chunk.length < YD_LIMIT || offset >= 20000) break;
    offset += chunk.length;
  }
  return { items, prefixes: [] };
}

// makeYdStorage() — объект в стиле firebase.storage(): ref('photos/thumb/abc') →
// { put, getBlob, delete }, ref('photos/thumb') → { listAll }. Фото-логика
// (photoRef, listCloudPhotos, syncPhotos) работает с ним без изменений.
function makeYdStorage() {
  return {
    ref(path) {
      const seg = String(path || '').split('/').filter(Boolean);
      if (seg.length >= 3) {
        const part = seg[1], id = seg.slice(2).join('/');
        return {
          name: id,
          fullPath: seg.join('/'),
          put(blob) { return ydUpload(part, id, blob); },
          getBlob() { return ydDownload(part, id); },
          delete() { return ydDelete(part, id); }
        };
      }
      const folder = 'app:/' + seg.join('/'); // 'app:/photos/thumb' — токен видит только папку приложения
      return { listAll() { return ydList(folder); } };
    }
  };
}

function photoRef(part, id) { return syncStorage.ref('photos/' + part + '/' + id); }

// Запуск сверки фото (debounce 2.5 с): после добавления/удаления фото и при
// применении облачного сейфа. Без Storage или до разблокировки — просто ждём.
function schedulePhotoSync() {
  if (!syncStorage || !photoStore || !masterKey || photoSyncing) return;
  clearTimeout(photoSyncTimer);
  photoSyncTimer = setTimeout(() => { syncPhotos().catch(e => console.warn('[sync] сверка фото', e)); }, 2500);
}

// Что сейчас лежит в облаке: { id: { orig: true, full: true, thumb: true } }
async function listCloudPhotos() {
  const out = {};
  for (const part of PHOTO_PARTS) {
    try {
      const res = await syncStorage.ref('photos/' + part).listAll();
      for (const it of (res.items || [])) (out[it.name] = out[it.name] || {})[part] = true;
    } catch (e) { console.warn('[sync] не удалось прочитать облако photos/' + part, e); }
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
      jobs.push((async () => {
        const getter = part === 'orig' ? 'getEncryptedOrig' : (part === 'full' ? 'getEncryptedFull' : 'getEncryptedThumb');
        const enc = await photoStore[getter](id);
        if (!enc) return;
        // Обёртка: сам шифртекст + несекретные MIME/размер (размер и так виден
        // в метаданных Storage), чтобы на другом устройстве восстановить тип файла.
        const payload = { e: enc, m: { t: meta.origType || meta.type || '', ft: meta.type || '', st: meta.thumbType || '', s: meta.size || 0 } };
        await photoRef(part, id).put(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
      })());
    }
    await Promise.all(jobs);
    return { ok: true };
  } catch (e) {
    console.warn('[sync] не удалось выгрузить фото ' + id, e);
    return { ok: false, err: e };
  }
}


// Скачивание недостающих частей фото из облака (без повторного шифрования).
async function downloadCloudPhoto(id, cloud, local) {
  try {
    const meta = (local && (await photoStore.getMeta(id).catch(() => null))) || {};
    const got = {};
    let gotMeta = null;
    for (const part of PHOTO_PARTS) {
      const hasCloud = cloud[id] && cloud[id][part];
      const hasLocal = local && local['has' + part[0].toUpperCase() + part.slice(1)];
      if (!hasCloud || hasLocal) continue;
      const data = await photoRef(part, id).getBlob();
      const txt = (typeof data === 'string') ? data : await data.text();
      const parsed = JSON.parse(txt);
      // Новый формат { e: шифртекст, m: {t,ft,st,s} } и старый { i, d } — оба понимаем
      const enc = (parsed && parsed.e && typeof parsed.e.d === 'string') ? parsed.e
                : (parsed && typeof parsed.d === 'string') ? parsed : null;
      if (!enc) continue;
      got[part] = enc;
      if (parsed && parsed.m && !gotMeta) gotMeta = parsed.m;
    }
    if (!got.orig && !got.full && !got.thumb) return { ok: false, err: new Error('в облаке нет частей для скачивания') };
    // Сохраняем всё разом, чтобы не потерять уже имеющиеся локальные части
    const exOrig = (local && local.hasOrig) ? await photoStore.getEncryptedOrig(id) : null;
    const exFull = (local && local.hasFull) ? await photoStore.getEncryptedFull(id) : null;
    const exThumb = (local && local.hasThumb) ? await photoStore.getEncryptedThumb(id) : null;
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
    console.warn('[sync] не удалось скачать фото ' + id, e);
    return { ok: false, err: e };
  }
}

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
      const txt = (typeof data === 'string') ? data : await data.text();
      const parsed = JSON.parse(txt);
      const enc = (parsed && parsed.e && typeof parsed.e.d === 'string') ? parsed.e
                : (parsed && typeof parsed.d === 'string') ? parsed : null;
      if (!enc) throw new Error('незнакомый формат облачного файла');
      await aesDec(masterKey, enc);
    } catch (e) {
      // Криптографический сбой (неверный ключ/IV/шифртекст) — фото «чужое».
      // Любая другая ошибка (сеть, JSON) — временная, помечаем unknown.
      const emsg = String(e && e.message || e);
      if (e && (e.name === 'OperationError' || /decrypt/i.test(emsg))) {
        console.warn('[sync] облачное фото не расшифровывается текущим ключом', id, part);
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
  const stats = { downloaded: 0, uploaded: 0, failed: 0, retry: false };
  try {
    const localList = await photoStore.listIds();
    const localMap = new Map(localList.map(l => [l.id, l]));
    const cloud = await listCloudPhotos();
    // Проверяем каждое облачное фото отдельно. Чужое (другой ключ) НЕ блокирует
    // синхронизацию остальных: свои фото скачиваем и выгружаем, а чужие просто
    // не трогаем. Раньше одно «чужое» фото прерывало всю сверку — и свои фото
    // навсегда оставались невыгруженными и нескачанными (deadlock на телефоне).
    const probe = Object.keys(cloud).length ? await probeCloudKeys(cloud) : { foreign: new Map(), unknown: new Map() };
    const isSkipped = id => probe.foreign.has(id) || probe.unknown.has(id);
    if (probe.foreign.size) {
      console.warn('[sync] в облаке фото с другим ключом (' + probe.foreign.size + ' шт) — их не трогаю, свои фото синхронизирую');
      notify('В облаке есть фото с другим паролем — я их не трогаю, но свои фото выгружаю 💜', true);
    }
    if (probe.unknown.size) stats.retry = true; // сеть/формат — повторим позже
    const want = new Set((db.photos || []).map(p => p && p.id).filter(Boolean));
    // 1. Локальный мусор: блоб без фото в db (фото удалено) — чистим store
    for (const id of localMap.keys()) {
      if (want.has(id)) continue;
      try { await photoStore.delete(id); thumbCache.delete(id); } catch (e) {}
    }
    // 2. Облачный мусор: удаляем ТОЛЬКО если облако целиком «наше». Если есть
    //    хоть одно чужое/непроверенное фото — удаление отменяется: «мусором»
    //    могут оказаться чужие данные, их не трогаем.
    if (!probe.foreign.size && !probe.unknown.size) {
      for (const id of Object.keys(cloud)) {
        if (want.has(id)) continue;
        for (const part of PHOTO_PARTS) {
          if (cloud[id][part]) { try { await photoRef(part, id).delete(); } catch (e) {} }
        }
      }
    }
    // 3. Скачиваем недостающее с облака (кроме чужих и временно недоступных)
    for (const id of want) {
      if (isSkipped(id)) continue;
      const l = localMap.get(id);
      const need = PHOTO_PARTS.some(part => cloud[id] && cloud[id][part] && (!l || !l['has' + part[0].toUpperCase() + part.slice(1)]));
      if (!need) continue;
      const res = await downloadCloudPhoto(id, cloud, l);
      if (res && res.ok) stats.downloaded++;
      else { stats.failed++; stats.retry = true; }
    }
    // 4. Выгружаем недостающее в облако (новые фото + бэкфилл старых)
    for (const id of want) {
      const l = localMap.get(id);
      if (!l || !l.hasFull) continue; // полного блоба нет — выгружать нечего
      const res = await uploadCloudPhoto(id, cloud, l);
      if (res && res.ok) stats.uploaded++;
      else { stats.failed++; stats.retry = true; }
    }
    if (stats.failed) {
      notify('Часть фото не синхронизировалась — проверь интернет, повторю через минуту 💜', true);
    }
  } catch (e) {
    console.warn('[sync] сверка фото не удалась', e);
  } finally {
    photoSyncing = false;
    // Докачали блобы из облака — прогреваем кэш миниатюр и перерисовываем вьюхи,
    // иначе миниатюры, приехавшие после первого рендера, не появятся в галерее.
    if (typeof warmThumbCache === 'function') warmThumbCache();
    // Были временные сбои — попробуем ещё раз через 20 секунд.
    if (stats.retry) {
      clearTimeout(photoSyncTimer);
      photoSyncTimer = setTimeout(() => { syncPhotos().catch(e => console.warn('[sync] сверка фото', e)); }, 20000);
    }
  }
}


/* ===== UI в настройках: статус + кнопка ===== */
const SYNC_STATUS_TEXT = {
  off:     'Синхронизация не настроена — данные живут только на этом устройстве. Чтобы открывать их с телефона, вставь Firebase config (README, фаза B1).',
  idle:    'Облако подключено — ждём изменений…',
  syncing: 'Синхронизируем…',
  ok:      'Синхронизировано ✅',
  conflict: '⚠️ В облаке сейф с другим паролем — он не затёрт. Если нужны облачные данные: нажми чип «Гоша/Даша» (замок) и введи пароль облачного сейфа — он усыновится, фото докачаются. «Синхронизировать сейчас» перезапишет облако этим устройством.',
  error:   'Ошибка синхронизации — проверь интернет и попробуй ещё раз 💜'
};
let syncUiState = 'off';
let syncUiTs = 0;
function renderSyncStatus(state, ts) {
  syncUiState = state;
  syncUiTs = ts || 0;
  const el = $('#syncStatus');
  if (!el) return;
  const text = SYNC_STATUS_TEXT[state] || SYNC_STATUS_TEXT.off;
  el.textContent = text;
  el.style.color = state === 'ok' ? '#059669' : (state === 'error' ? '#dc2626' : (state === 'conflict' ? '#b45309' : 'var(--muted)'));
  const btn = $('#syncNowBtn');
  if (btn) btn.disabled = (state === 'syncing');
}
async function syncNow() {
  if (!FIREBASE_CONFIG) { renderSyncStatus('off'); return; }
  if (!syncReady) { initSync(); return; }
  if (syncPushBlocked) { await forcePushVault(); return; }
  await pullVault(false);
  await pushVault();
  schedulePhotoSync(); // фото-сверка тоже по требованию
}
const syncNowBtnEl = $('#syncNowBtn');
if (syncNowBtnEl) syncNowBtnEl.addEventListener('click', syncNow);

/* ===== Диагностика облака (кнопка в настройках) =====
   Показывает, что сейчас в локальном фото-сторе, что в облаке и расшифровываются
   ли облачные фото текущим ключом. Помогает найти, где именно рвётся синхронизация. */
async function getCloudSyncTs() {
  if (!syncDb) return '—';
  try {
    const snap = await syncDb.ref(SYNC_PATH).once('value');
    const v = snap && snap.val ? snap.val() : null;
    return v ? (v.syncTs || 0) : 0;
  } catch (e) { return 'ошибка: ' + String(e && e.message || e); }
}
async function runCloudDiagnostics() {
  const out = $('#cloudDiagOut');
  if (!out) return;
  out.hidden = false;
  const lines = [];
  const add = s => lines.push(s);
  try {
    add('syncReady: ' + syncReady);
    add('syncStorage: ' + (syncStorage ? 'яндекс.диск' : 'нет'));
    add('masterKey: ' + (masterKey ? 'есть' : 'НЕТ'));
    add('photos в db: ' + ((db.photos || []).length));
    add('syncTs: локально=' + syncTs + ', в облаке=' + (await getCloudSyncTs()));
    try {
      const localList = await photoStore.listIds();
      add('локальный store: ' + localList.length + ' фото');
      for (const l of localList) add('  ' + l.id + ' full=' + l.hasFull + ' thumb=' + l.hasThumb + ' orig=' + l.hasOrig);
    } catch (e) { add('ошибка listIds: ' + String(e && e.message || e)); }
    let cloud = {};
    try { cloud = await listCloudPhotos(); } catch (e) { add('ошибка listCloudPhotos: ' + String(e && e.message || e)); }
    add('облако: ' + Object.keys(cloud).length + ' фото');
    for (const id of Object.keys(cloud)) add('  ' + id + ': ' + (PHOTO_PARTS.filter(p => cloud[id][p]).join(',') || '?'));
    if (Object.keys(cloud).length) {
      add('— расшифровка облачных фото текущим ключом —');
      for (const id of Object.keys(cloud)) {
        const part = ['thumb', 'full', 'orig'].find(p => cloud[id] && cloud[id][p]);
        if (!part) { add('  ' + id + ': нет частей'); continue; }
        try {
          const data = await photoRef(part, id).getBlob();
          const txt = (typeof data === 'string') ? data : await data.text();
          const parsed = JSON.parse(txt);
          const enc = (parsed && parsed.e && typeof parsed.e.d === 'string') ? parsed.e
                    : (parsed && typeof parsed.d === 'string') ? parsed : null;
          if (!enc) { add('  ' + id + ' (' + part + '): НЕЗНАКОМЫЙ ФОРМАТ'); continue; }
          const u8 = await aesDec(masterKey, enc);
          const head = Array.from(u8.subarray(0, 4)).map(b => String.fromCharCode(b)).join('');
          add('  ' + id + ' (' + part + '): расшифровано ✅ ' + u8.length + ' б «' + head.replace(/[^ -~]/g, '?') + '»');
        } catch (e) {
          const msg = String(e && e.name || '') + ': ' + String(e && e.message || e);
          const isKey = /OperationError|decrypt/i.test(msg);
          add('  ' + id + ' (' + part + '): ' + (isKey ? 'ДРУГОЙ КЛЮЧ ❌' : 'ОШИБКА ⚠') + ' — ' + msg.slice(0, 140));
        }
      }
    }
  } catch (e) {
    add('неожиданная ошибка: ' + String(e && e.message || e));
  }
  out.textContent = lines.join(String.fromCharCode(10));
}
const cloudDiagBtnEl = $('#cloudDiagBtn');
if (cloudDiagBtnEl) cloudDiagBtnEl.addEventListener('click', runCloudDiagnostics);
/* ===== Старт приложения =====
   initAuth() из 90-effects-init.js вызывается здесь — последним в сборке:
   он читает FIREBASE_CONFIG (let из этого модуля), который ещё в «мёртвой зоне»
   во время выполнения 90-effects-init.js. Так же инициализируются экраны входа. */
initAuth();

