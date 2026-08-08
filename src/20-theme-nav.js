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

