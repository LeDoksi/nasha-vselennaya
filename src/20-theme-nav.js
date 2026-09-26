/* ===== Тема ===== */
const THEME_KEY = 'universe_theme';
function getTheme() {
  const saved = store.get(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  // первый запуск — уважаем системную тему (переключается кнопкой в любой момент)
  try {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch (e) {}
  // Финальное ревью (NV-13): «Ночь» — основная тема сайта (см. @layer tokens
  // в styles.css, :root уже тёмный по умолчанию). Раньше здесь стоял 'light'
  // — последний фолбэк для сессий без сохранённого выбора и без сигнала ОС,
  // то есть именно новых пользователей. Уже сохранённый выбор (light ИЛИ
  // dark) эта ветка не трогает — return saved выше срабатывает раньше.
  return 'dark';
}

// Общая обёртка View Transitions: если переход уже идёт или не поддержан —
// сразу применяем изменения. Ошибки рендера и отменённые
// переходы гасим здесь же, чтобы они не превращались в unhandledrejection с ложным
// тостом «Не удалось сохранить», а быстрый повторный клик переключал вкладку мгновенно.
function runViewTransition(apply) {
  if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function') return false;
  try {
    const t = document.startViewTransition(() => {
      try {
        apply();
      } catch (e) {
        console.warn('Ошибка при переключении', e);
      }
    });
    if (t) {
      if (t.finished && typeof t.finished.catch === 'function') t.finished.catch(() => {});
      if (t.updateCallbackDone && typeof t.updateCallbackDone.catch === 'function') t.updateCallbackDone.catch(() => {});
      // ready реджектится с AbortError «Transition was skipped», когда переход
      // отменяется новым (например, быстрый повторный клик) — без catch здесь
      // это всплывало необработанным отклонением и шумело в консоли (NV-10).
      if (t.ready && typeof t.ready.catch === 'function') t.ready.catch(() => {});
    }
    return true;
  } catch (e) {
    return false;
  } // переход уже идёт — применяем мгновенно
}

function setTheme(t) {
  const apply = () => {
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch (e) {}
    const root = document.documentElement;
    if (root) root.dataset.theme = t;
    const btn = $('#themeToggle');
    if (btn) {
      render(btn, navIconHtml(t === 'dark' ? 'sun' : 'moon'));
      btn.setAttribute('aria-pressed', String(t === 'dark'));
    }
    const sbtn = $('#settingsThemeBtn');
    if (sbtn) sbtn.textContent = t === 'dark' ? '☀️ Включить светлую тему' : '🌙 Включить тёмную тему';
  };
  // Фаза D: смена темы — тоже плавным переходом (если браузер умеет и анимации не выключены)
  if (!runViewTransition(apply)) apply();
}
function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

/* ===== Навигация ===== */
let activeView = 'home'; // текущая вкладка — для hash-роутинга и кнопки «назад»
// Нижняя панель (спека 2.1): Главная · Календарь · Фото · Наше, плюс «Память»
// пятой — до фазы 5, где она уезжает в ось времени на Главной (решение
// владельца 26.09.2026, NV-52). Объявлено ДО showView: он читает эти
// константы при открытии по прямой ссылке (#/wishlist) — ниже была бы TDZ.
const BOTTOM_PRIMARY = ['home', 'calendar', 'photos', 'our', 'memory'];
// «Наше» — одна вкладка на три экрана. Своего <section> у неё нет: 'our'
// раскрывается в последний открытый из трёх, адрес остаётся #/notes и т.п.
const OUR_TABS = ['notes', 'lists', 'wishlist'];
const OUR_KEY = 'universe_our_tab';
function resolveView(view) {
  if (view !== 'our') return view;
  const last = store.get(OUR_KEY);
  return OUR_TABS.includes(last) ? last : 'notes';
}
// Иконки для нижней панели (мобильные): текстовые подписи физически не
// помещаются в ряд на узком экране без обрезки («Календ…» — было). Раньше
// тут были эмодзи — заменены на SVG из общего sprite в index.html (Фаза 4):
// одинаково выглядят на всех платформах и красятся через currentColor вместе
// с текстом кнопки (эмодзи так не умеют — оставались цветными в .active).
// Полный текст остаётся для скринридеров через aria-label.
function navIconHtml(id) {
  return html`<svg class="nav-icon" aria-hidden="true"><use href="#icon-${id}"></use></svg>`;
}
const BOTTOM_ICON = {
  home: navIconHtml('home'),
  calendar: navIconHtml('calendar'),
  photos: navIconHtml('photos'),
  our: navIconHtml('notes'),
  memory: navIconHtml('memory')
};
function showView(view) {
  view = resolveView(view);
  if (!$('#view-' + view)) return; // неизвестная вкладка — не трогаем экран
  activeView = view;
  const inOur = OUR_TABS.includes(view);
  if (inOur) store.set(OUR_KEY, view);
  const apply = () => {
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view || (inOur && b.dataset.view === 'our')));
    const sw = $('#ourSwitch');
    if (sw) sw.hidden = !inOur;
    $$('.our-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.our === view);
      b.setAttribute('aria-selected', String(b.dataset.our === view));
    });
    if (view === 'home') renderHome();
    if (view === 'calendar') {
      calY = new Date().getFullYear();
      calM = new Date().getMonth();
      selectedDate = null;
      renderCalendar();
    }
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
  view = resolveView(view);
  showView(view);
  // hash-роутинг: #/view — кнопка «назад» в браузере и прямые ссылки на вкладку.
  // location нет в песочнице тестов — там остаёмся на синхронном показе.
  if (typeof location !== 'undefined' && location.hash !== '#/' + view) {
    try {
      location.hash = '#/' + view;
    } catch (e) {}
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
$$('.our-tab').forEach(b => b.addEventListener('click', () => go(b.dataset.our)));

/* ===== Нижняя навигация на мобильных: все вкладки в одном ряду =====
   Пять вкладок (спека 2.1): Главная, Календарь, Фото, Наше, Память. «Наше»
   раскрывается в последний из трёх экранов (Заметки/Списки/Хотелки) — см.
   resolveView. Кнопки клонируются из шапки, поэтому active-подсветка и
   клики работают как у оригинала. */

function buildBottomNav() {
  const bar = $('#bottomNav');
  if (!bar || !bar.querySelectorAll) return;
  const navBtn = view => [...document.querySelectorAll('.nav-btn')].find(b => b.dataset && b.dataset.view === view);
  render(bar, '');
  BOTTOM_PRIMARY.forEach(view => {
    const src = navBtn(view);
    const clone = src ? src.cloneNode(true) : document.createElement('button');
    clone.type = 'button';
    const isActive = view === activeView || (view === 'our' && OUR_TABS.includes(activeView));
    clone.className = 'nav-btn bottom-nav-btn' + (isActive ? ' active' : '');
    if (!src) clone.dataset.view = view;
    // Иконка вместо текста (см. BOTTOM_ICON) — полный текст остаётся в
    // aria-label для скринридеров и как title для десктопных мышиных наведений.
    const label = clone.textContent.trim();
    clone.setAttribute('aria-label', label);
    clone.title = label;
    render(clone, BOTTOM_ICON[view] || html`${label}`);
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

/* ===== Плашка «нет сети» в шапке =====
   Без интернета старое (ещё не закэшированное локально) фото просто не
   открывается — без объяснения это выглядит как поломка. Показываем плашку
   ТОЛЬКО когда сети действительно нет (navigator.onLine — не идеальный
   индикатор, но лучше, чем сетевой пинг на каждый чих) и держим её в
   актуальном состоянии через online/offline. */
function updateOfflineBadge() {
  const el = $('#offlineBadge');
  if (!el) return;
  el.hidden = typeof navigator === 'undefined' || navigator.onLine !== false;
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('online', updateOfflineBadge);
  window.addEventListener('offline', updateOfflineBadge);
}
updateOfflineBadge();
