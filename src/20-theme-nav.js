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
// Вкладки нижней навигации — раньше было «5 + Ещё» (шторка с оставшимися 4),
// пользователь попросил убрать шторку: «Песня» снесена отдельно, «Настройки»
// переехали в шапку отдельной иконкой (.settings-btn) — остаётся 7 вкладок,
// все помещаются в один ряд на типичных 360-430px (иконки без текста, ~20px
// каждая). BOTTOM_PRIMARY объявлен ДО showView: он на него смотрит при
// открытии по прямой ссылке (#/wishlist) — если бы const стоял ниже, в этот
// момент была бы TDZ-ошибка.
const BOTTOM_PRIMARY = ['home', 'calendar', 'notes', 'lists', 'wishlist', 'photos', 'memory'];
// Иконки для нижней панели (мобильные): текстовые подписи физически не
// помещаются в ряд на узком экране без обрезки («Календ…» — было). Значки
// повторяют эмодзи, уже используемые в самих разделах (📅 у событий,
// 📸 у фото, 📋 у списков, 🕰 у «Памяти», 💌 у заметок, 🎁 у хотелок), а
// полный текст остаётся для скринридеров через aria-label.
const BOTTOM_ICON = { home: '🏠', calendar: '📅', notes: '💌', lists: '📋', wishlist: '🎁', photos: '📸', memory: '🕰' };
function showView(view) {
  if (!$('#view-' + view)) return; // неизвестная вкладка — не трогаем экран
  activeView = view;
  const apply = () => {
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

/* ===== Нижняя навигация на мобильных: все вкладки в одном ряду =====
   Раньше было «5 + Ещё» (шторка с оставшимися 4 вкладками) — пользователь
   попросил убрать шторку. «Песня» снесена отдельно, «Настройки» переехали в
   шапку отдельной иконкой (.settings-btn, вне BOTTOM_PRIMARY), поэтому
   оставшиеся 7 вкладок помещаются в один ряд без «Ещё». Кнопки клонируются
   из шапки, поэтому active-подсветка и клики работают как у оригинала. */

function buildBottomNav() {
  const bar = $('#bottomNav');
  if (!bar || !bar.querySelectorAll) return;
  const navBtn = view => [...document.querySelectorAll('.nav-btn')].find(b => b.dataset && b.dataset.view === view);
  bar.innerHTML = '';
  BOTTOM_PRIMARY.forEach(view => {
    const src = navBtn(view);
    const clone = src ? src.cloneNode(true) : document.createElement('button');
    clone.type = 'button';
    clone.className = 'nav-btn bottom-nav-btn' + (view === activeView ? ' active' : '');
    if (!src) clone.dataset.view = view;
    // Иконка вместо текста (см. BOTTOM_ICON) — полный текст остаётся в
    // aria-label для скринридеров и как title для десктопных мышиных наведений.
    const label = clone.textContent.trim();
    clone.setAttribute('aria-label', label);
    clone.title = label;
    clone.textContent = BOTTOM_ICON[view] || label;
    bar.appendChild(clone);
  });
}

// Клики по нижней панели (кнопки созданы клонированием — делегируем на document).
function onNavDocClick(e) {
  const nb = e.target && e.target.closest && e.target.closest('#bottomNav .nav-btn');
  if (nb && nb.dataset && nb.dataset.view) go(nb.dataset.view);
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', onNavDocClick);
}
buildBottomNav();

