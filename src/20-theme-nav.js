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

