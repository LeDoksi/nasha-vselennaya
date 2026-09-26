# Редизайн «Ночь», фазы 4–6: оболочка, Главная, фото — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сайт получает новую структуру: пять вкладок вместо семи («Наше» собирает Заметки, Списки и Хотелки), модалки становятся нативными `<dialog>` и на телефоне — шторками со свайпом, Главная — блоком «Сейчас» с орбитой-счётчиком и осью времени, уходящей в прошлое, галерея — плитками разного размера, долгим нажатием и переходом плитка → лайтбокс общим элементом.

**Architecture:** Всё на существующем стеке: `src/*.js` склеиваются `build.js` в `app.js`, разметка в `index.html`, стили в `styles.css` (`@layer components`). Новых зависимостей нет. Навигация: псевдо-вкладка `our` раскрывается в последний открытый из трёх экранов, адрес остаётся `#/notes` и т.п. Модалки: единая пара `openOverlay(id)` / `closeOverlay(id)`, которая держит в согласии атрибут `hidden` (на него смотрят тесты и `90-effects-init.js`) и `showModal()/close()`. Ось времени — новый модуль `src/36-timeline.js`, рисует дни из существующего `memoryByDay()` страницами через `IntersectionObserver`; вкладка «Память» рисуется тем же кодом до Task 7, где она удаляется (решение владельца 26.09.2026, NV-52).

**Tech Stack:** vanilla JS (конкатенация `src/*.js` → `app.js` через `build.js` + esbuild minify), CSS без препроцессора (`<dialog>`, `popover`, `@starting-style`, View Transitions, `content-visibility` — без полифилов, спека §7), тесты — самописные node-скрипты с `vm`-песочницей, Playwright для стенда (`tools/shots.js`, `tools/browser-check.js`).

**Spec:** `docs/superpowers/specs/2026-09-21-redesign-core-audit-design.md` — раздел 2 целиком, строки фаз 4–6 в таблице раздела 5, раздел 3.2 (движение шторки и лайтбокса). План фаз 2–3 для образца: `docs/superpowers/plans/2026-09-25-redesign-phase-2-3.md`. Замечания к экранам «как было»: `docs/superpowers/baseline/README.md`.

## Global Constraints

Перенесены из плана фаз 2–3, поправлены на состояние после его слияния:

- **Ни одна задача не оставляет сайт сломанным.** После каждой — `npm run check` зелёный (сборка + все тестовые файлы + eslint). Это же гоняет pre-commit хук (`.husky/pre-commit`: lint-staged → `npm run check` → `git add app.js`).
- **`app.js` коммитится собранным.** CI падает, если `git diff app.js` непустой после `node build.js`. Правим только `src/*.js`, потом пересобираем и добавляем `app.js` в тот же коммит.
- **Порядок сборки — по имени файла** (`build.js`: `readdirSync().sort()`). Все top-level `let`/`const` в одной области видимости: константа, которую читает код верхнего уровня другого модуля, должна быть объявлена в файле, который сортируется раньше (иначе TDZ). Функции (`function f(){}`) поднимаются — для них порядок не важен.
- **HTML в DOM — только через `html\`…\`` / `render(el, content)` из `src/00-html.js`.** Страж `tests/uni-render.js` падает на `innerHTML =`, `insertAdjacentHTML`, `outerHTML` и прямом `esc(` вне `00-core.js`/`00-html.js`. Ловушка: `html\`${false}\``, `${null}`, `${undefined}` → пустая строка; булево в атрибут — `String(x)`.
- **CSP не расширяется.** `font-src 'self'`, никаких внешних `<link>`.
- **Токены цвета — только OKLCH в `@layer tokens`.** Страж `tests/uni-tokens.js` падает на хардкоженном цвете/радиусе вне слоя. Относительные цвета от токенов (`oklch(from var(--night) l c h / .5)`) разрешены — так уже написан весь `styles.css`.
- **Один акцент на весь сайт:** `--star` (для мелкого текста — `--star-ink`, он темнее в светлой теме). Фиолетовый `--night` — фон и линии, не кнопки. Розовый — только праздник.
- **Шкала формы:** интерактивное `var(--radius-pill)`, карточка `var(--radius-card)`, поле `12px`-токен поля, медиа `var(--radius-media)`, шторка `var(--radius-sheet)` сверху и `0` снизу.
- **Тёмная тема — основная.** Каждый снимок проверяется в обеих.
- **Никакого `prefers-reduced-motion` и тумблера анимаций** (решение владельца, спека 3.3). Длительности пишутся литералами (`.42s`, `cubic-bezier(.2,.8,.2,1)`) — токены `--dur-*`/`--ease-*` появятся в фазе 8 (NV-60) и заменят их там.
- **Ничего в `tools/` не попадает в прод.** `deploy-pages.yml` копирует явный список файлов; новые `src/*.js` попадают в прод через `app.min.js` сами.
- **`CACHE_NAME` в `sw.js` руками не бампается.** Версию проставляет `tools/stamp-version.js` на деплое (NV-80, 26.09.2026).
- **Скриншоты в репозиторий не коммитятся** (`docs/superpowers/baseline/**/*.png` в `.gitignore`). В git — только выводы.
- **Язык интерфейса и комментариев — русский.**

Новое для фаз 4–6:

- **Фаза = своя ветка, свой мёрж и деплой** (спека §5). Три ветки по очереди: `redesign-phase-4`, `redesign-phase-5`, `redesign-phase-6`. Следующая фаза начинается от `main`, в который уже влита предыдущая. Закрытие фазы — отдельная задача в этом плане (Task 4, Task 7, Task 11).
- **Вид сайта меняется — побайтовое «ни пикселя» больше не цель.** Перед первой задачей фазы: `node tools/serve.js` (отдельное окно) и `node tools/shots.js phase-N-start`. После каждой задачи: `node tools/shots.js task-K` и `node tools/shots-diff.js phase-N-start task-K`. Список `DIFF:` должен совпадать с тем, что задача собиралась поменять (например, Task 2 меняет только `*-home-invite.png`); лишняя строка в списке — регрессия, её разбирают до коммита. Изменившиеся снимки **смотрятся глазами** в обеих темах и обеих ширинах, вывод — одна-две строки в отчёте задачи.
- **Сравнение снимков — в пределах одного календарного дня** (на стенде «сегодня» — настоящая дата).
- **Тесты-песочницы видят `hidden`, а не `open`.** `registry['#…Overlay'].hidden` проверяется в `tests/uni-smoke.js` и `tests/repro-event-btn.js`; `90-effects-init.js` ищет `.overlay:not([hidden])`. Поэтому у `<dialog>` атрибут `hidden` остаётся и всегда совпадает с открытостью — через `openOverlay/closeOverlay`, никогда не напрямую.
- **`tools/browser-check.js` — приёмочный тест перетаскивания и новых жестов.** Запускается (при поднятом `tools/serve.js`) в конце каждой задачи, которая трогает галерею, «Наше» или модалки. Итог должен быть `ИТОГ: OK`.
- **Содержимое экранов «Наше», Календаря и Настроек не перерисовывается** — это фаза 7 (NV-57, NV-58, NV-59). Здесь только оболочка вокруг них.
- **Настройки уже в шапке** (иконка `.settings-btn`, проверено на стенде 26.09.2026) — пункт спеки 2.1 «Настройки уходят в шапку» работы не требует.
- **Решения владельца по NV-52 уже приняты (26.09.2026):** «Память» — на оси Главной, отдельной вкладки нет; коллаж «Наша история» убирается. Task 7 их применяет, повторно не спрашивает.

---

## Файловая структура

| Файл | Ответственность | Статус |
|---|---|---|
| `index.html` | 5 кнопок навигации, переключатель «Наше», 7 `<dialog>`, `popover` у календарика и тоста, новая разметка Главной | правится |
| `src/20-theme-nav.js` | Вкладка `our`, `resolveView`, переключатель, нижняя панель из 5 кнопок; `runViewTransition` возвращает объект перехода | правится |
| `src/00-core.js` | `setPopover(el, on)`; `notify` поднимает тост над шторкой | правится |
| `src/42-datepicker.js` | Календарик открывается как popover | правится |
| `src/62-global-clicks.js` | `openOverlay` / `closeOverlay` / `closeOverlayNow`; Esc отдан нативному `<dialog>`; тап по фото в режиме выбора | правится |
| `src/63-sheet.js` | Esc/`cancel` у диалогов, ручка шторки и свайп вниз, `sheetShouldClose` | создаётся |
| `src/30-home.js`, `src/35-memory.js` | Блок «Сейчас»: орбита, годовщина, таймер, комплимент; `anniversaryInfo`, `orbitGeometry`; без коллажа | правятся |
| `src/36-timeline.js` | Ось времени: `timelineYears`, `memoryDayHtml`, `renderTimeline`, `--header-h` | создаётся |
| `src/70-photos.js`, `src/71-photo-grid.js` | Плитки разного размера, долгое нажатие, тихая плитка | правятся |
| `src/85-lightbox.js` | Лайтбокс через `openOverlay`, общий элемент туда и обратно (`lbFlyBack`) | правится |
| `styles.css` | Переключатель, диалог/шторка, орбита, ось, плитки, переход лайтбокса; удаление мёртвых правил старой Главной | правится |
| `tests/uni-smoke.js`, `tests/uni-hash.js` | Новые проверки и поправки ожиданий | правятся |
| `tools/browser-check.js` | Навигация в «Наше» через `go()`, свайп шторки, долгое нажатие | правится |
| `README.md`, `PROJECT-MEMORY.md`, `docs/superpowers/baseline/metrics.md` | Модули, снимок 0g, замер галереи | правятся |

---

# ФАЗА 4 — Оболочка

Ветка `redesign-phase-4` от `main`. Перед Task 1: `node tools/serve.js` в отдельном окне, `node tools/shots.js phase-4-start`.

### Task 1: Пять вкладок и «Наше» с переключателем

Спека 2.1: «Главная · Календарь · Фото · Наше». Заметки, Списки, Хотелки уезжают под переключатель внутри «Наше». «Память» до фазы 5 остаётся пятой вкладкой — ей пока некуда переехать, а сайт не должен терять раздел между фазами. Своего `<section>` у «Наше» нет: вкладка `our` раскрывается в последний открытый из трёх экранов, адрес в строке всегда конкретный (`#/wishlist`), поэтому старые ссылки и тест `tests/uni-hash.js` продолжают работать.

**Files:**
- Modify: `index.html:67-75` (кнопки `.nav`), `index.html:88` (переключатель в начале `<main>`)
- Modify: `src/20-theme-nav.js:68-185`
- Modify: `styles.css` (`@layer components`, рядом с `.nav{…}` ~стр. 236)
- Modify: `tests/uni-smoke.js` (блок экспорта ~стр. 204–275, проверки навигации ~стр. 1343–1350 и ~1095)
- Modify: `tests/uni-hash.js:146-151`
- Modify: `tools/browser-check.js` (`checkNotesReorder`, `checkListsReorder`)

**Interfaces:**
- Produces: `BOTTOM_PRIMARY = ['home', 'calendar', 'photos', 'our', 'memory']`
- Produces: `OUR_TABS = ['notes', 'lists', 'wishlist']`, `OUR_KEY = 'universe_our_tab'` (ключ `localStorage`)
- Produces: `resolveView(view: string): string` — `'our'` → последний из `OUR_TABS` (по умолчанию `'notes'`), остальное без изменений
- Produces: `go('our')` и клик по «Наше» открывают экран из `OUR_TABS`; `activeView` — всегда настоящий экран, никогда `'our'`
- Сохраняется: `showView('wishlist')`, `go('notes')`, `#/lists` — работают как раньше

- [ ] **Step 1: Написать падающие проверки в tests/uni-smoke.js**

В блок экспорта (строки ~204–275, рядом с `s.BOTTOM_PRIMARY = BOTTOM_PRIMARY;`) добавить:

```js
  s.OUR_TABS = OUR_TABS; s.resolveView = resolveView;
```

Заменить блок проверок «Фаза C: нижняя навигация» (~стр. 1343–1350) на:

```js
  // --- Навигация фаз 4–6: пять вкладок, «Наше» собирает три экрана ---
  assert(
    JSON.stringify(w('(s)=>s.BOTTOM_PRIMARY')) === '["home","calendar","photos","our","memory"]',
    'навигация: Главная, Календарь, Фото, Наше, Память'
  );
  assert(w('(s)=>s.BOTTOM_PRIMARY').length === new Set(w('(s)=>s.BOTTOM_PRIMARY')).size, 'навигация: вкладки без повторов');
  w('(s)=>{s.localStorage.removeItem("universe_our_tab"); return 1;}');
  assert(w('(s)=>s.resolveView("our")') === 'notes', '«Наше» без истории открывает Заметки');
  w('(s)=>{s.go("lists"); return 1;}');
  assert(w('(s)=>s.activeView') === 'lists', 'go("lists") открывает Списки');
  w('(s)=>{s.go("home"); s.go("our"); return 1;}');
  assert(w('(s)=>s.activeView') === 'lists', '«Наше» помнит последний экран — Списки');
  assert(w('(s)=>s.resolveView("calendar")') === 'calendar', 'resolveView не трогает обычные вкладки');
```

`w(f)` вызывает `f` с самой песочницей (`tests/uni-smoke.js:330`), поэтому `s.localStorage`, `s.document` и всё экспортированное доступны напрямую.

В цикле «Все вкладки рендерятся» (~стр. 1095) добавить `'our'` в массив.

- [ ] **Step 2: Поправить tests/uni-hash.js**

Строки 146–151 заменить на:

```js
  const idx = vm.runInContext('BOTTOM_PRIMARY.indexOf("our")', ctx);
  if (av !== 'wishlist' || idx < 0) {
    console.log('FAIL: активная вкладка не «wishlist» или в BOTTOM_PRIMARY нет «Наше»');
    process.exit(1);
  }
  console.log('OK: старт по ссылке #/wishlist без TDZ-ошибки; activeView = ' + av + '; BOTTOM_PRIMARY.indexOf(our) = ' + idx);
```

- [ ] **Step 3: Запустить тесты и убедиться, что они падают**

Run: `node build.js && node tests/uni-smoke.js app.js 2>&1 | grep -E "FAIL|навигация|Наше"`
Expected: `FAIL` на «навигация: Главная, Календарь, Фото, Наше, Память» и `ReferenceError`/`FAIL` про `resolveView`.

- [ ] **Step 4: Переписать навигацию в src/20-theme-nav.js**

Строку 77 (`const BOTTOM_PRIMARY = [...]`) и комментарий над ней (строки 70–76) заменить на:

```js
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
```

`BOTTOM_ICON` (строки 87–95) заменить на:

```js
const BOTTOM_ICON = {
  home: navIconHtml('home'),
  calendar: navIconHtml('calendar'),
  photos: navIconHtml('photos'),
  our: navIconHtml('notes'),
  memory: navIconHtml('memory')
};
```

В `showView` (строки 96–121) — начало функции и строку подсветки кнопок:

```js
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
```

(дальше `if (view === 'home') renderHome();` и остальное — без изменений).

В `go` первой строкой — `view = resolveView(view);` (чтобы в адрес попадал настоящий экран, а `hashchange` не рисовал его второй раз).

После строки 147 (`$$('.nav-btn').forEach(...)`) добавить:

```js
$$('.our-tab').forEach(b => b.addEventListener('click', () => go(b.dataset.our)));
```

Комментарий над `buildBottomNav` (строки 149–154) поправить: «пять вкладок, «Наше» раскрывается в последний из трёх экранов».

- [ ] **Step 5: Разметка в index.html**

Строки 68–74 (кнопки внутри `<nav class="nav">`) заменить на:

```html
        <button class="nav-btn active" data-view="home">Главная</button>
        <button class="nav-btn" data-view="calendar">Календарь</button>
        <button class="nav-btn" data-view="photos">Фото</button>
        <button class="nav-btn" data-view="our">Наше</button>
        <button class="nav-btn" data-view="memory">Память</button>
```

Сразу после `<main>` (строка 88), перед `<!-- ===== ГЛАВНАЯ ===== -->`:

```html
    <!-- Переключатель внутри «Наше» (спека 2.1): виден только на трёх экранах
         раздела, см. showView в src/20-theme-nav.js -->
    <div class="our-switch" id="ourSwitch" role="tablist" aria-label="Наше" hidden>
      <button type="button" class="our-tab" role="tab" data-our="notes">Заметки</button>
      <button type="button" class="our-tab" role="tab" data-our="lists">Списки</button>
      <button type="button" class="our-tab" role="tab" data-our="wishlist">Хотелки</button>
    </div>
```

- [ ] **Step 6: Стили переключателя**

В `styles.css`, в `@layer components` после правил `.nav{…}`:

```css
/* Переключатель «Наше» (фаза 4): сегменты-пилюли, активный — акцент */
.our-switch{display:flex;gap:4px;width:max-content;max-width:100%;margin:0 auto 24px;padding:4px;background:var(--sky-1);border:1px solid var(--line);border-radius:var(--radius-pill)}
.our-switch[hidden]{display:none}
.our-tab{min-height:40px;padding:8px 16px;border:0;border-radius:var(--radius-pill);background:none;color:var(--ink-2);font:inherit;font-size:var(--text-sm);font-weight:700;cursor:pointer}
.our-tab.active{background:var(--star);color:var(--void)}
```

- [ ] **Step 7: tools/browser-check.js — вход в экраны через go()**

Кнопок `.nav-btn[data-view="notes"]` и `[data-view="lists"]` в шапке больше нет. В `checkNotesReorder` строку `await page.click('.nav-btn[data-view="notes"]');` заменить на `await page.evaluate(() => go('notes'));`, в `checkListsReorder` — `await page.click('.nav-btn[data-view="lists"]');` на `await page.evaluate(() => go('lists'));`.

- [ ] **Step 8: Прогнать всё**

Run: `npm run check`
Expected: exit 0, в выводе `OK: старт по ссылке #/wishlist … BOTTOM_PRIMARY.indexOf(our) = 3`.

Run (при поднятом `tools/serve.js`): `node tools/browser-check.js`
Expected: `ИТОГ: OK`.

- [ ] **Step 9: Посмотреть глазами**

Run: `node tools/shots.js task-1 && node tools/shots-diff.js phase-4-start task-1`
Expected: `DIFF` у всех снимков (шапка/нижняя панель на каждом экране). Открыть `phone-dark-notes.png`, `phone-light-lists.png`, `desk-dark-wishlist.png`, `phone-dark-home.png`: в нижней панели 5 иконок, над «Заметками»/«Списками»/«Хотелками» — переключатель с подсвеченным текущим экраном, на Главной переключателя нет. На десктопе в шапке 5 кнопок в одну строку.

- [ ] **Step 10: Commit**

```bash
git add index.html src/20-theme-nav.js styles.css tests/uni-smoke.js tests/uni-hash.js tools/browser-check.js app.js
git commit -m "Feat: пять вкладок, «Наше» с переключателем Заметки/Списки/Хотелки (NV-49)"
```

### Task 2: Модалки → нативный `<dialog>`

Семь `.overlay` (`eventOverlay`, `dateOverlay`, `dateInviteOverlay`, `labelOverlay`, `labelApplyOverlay`, `wishOverlay`, `lightbox`) становятся `<dialog>`: ловушка фокуса, `::backdrop`, верный порядок в стеке — бесплатно. Внешне на десктопе ничего не меняется (та же карточка по центру), шторка на телефоне — Task 3.

Ловушка: открытый модальный `<dialog>` лежит в top layer, и `z-index` его не перекрывает. Календарик `#datePop` (открывается из полей дат внутри модалок) и тост `#appToast` без правки окажутся **под** затемнением. Оба поднимаются в top layer как `popover="manual"`.

**Files:**
- Modify: `index.html:234-362` (7 оверлеев), `index.html:376` (`#datePop`), `index.html:396` (`#appToast`)
- Modify: `src/62-global-clicks.js:2-9` (`closeOverlay`), `:293-298`, `:309-314` (Esc)
- Create: `src/63-sheet.js`
- Modify: `src/00-core.js:63-73` (`notify`)
- Modify: `src/42-datepicker.js:166-200` (`closeDatePop`, `openDatePop`)
- Modify: `src/30-home.js:303-307, 360, 385`, `src/43-event-modal.js:34, 96`, `src/61-wishes.js:90, 147`, `src/72-photo-labels.js:63, 156`, `src/85-lightbox.js:98-126`
- Modify: `styles.css:536-547` (`.overlay`, `.modal`), `:580` (`.date-pop`), `:927` (`.app-toast`), `:614` (`#lightbox`)
- Test: `tests/uni-smoke.js`

**Interfaces:**
- Produces: `openOverlay(id: string): void` — `hidden = false` + `showModal()`, если элемент умеет и ещё не открыт
- Produces: `closeOverlay(id: string): void` — прежние побочные эффекты (`lbResetState`, `editingEventId = null`, `markInvitesDismissed`) + `hidden = true` + `close()`. Task 10 разделит её на `closeOverlay` / `closeOverlayNow`.
- Produces: `setPopover(el: Element, on: boolean): void` в `src/00-core.js`
- Сохраняется: `registry['#…'].hidden` в тестах отражает открытость; `.overlay:not([hidden])` в `90-effects-init.js` работает

- [ ] **Step 1: Падающие проверки в tests/uni-smoke.js**

В блок экспорта рядом с `s.closeOverlay = closeOverlay;`:

```js
  s.openOverlay = openOverlay; s.setPopover = setPopover; s.notify = notify;
```

После существующих проверок светбокса (~стр. 1397) добавить:

```js
  // --- Фаза 4: модалки — нативный <dialog>, hidden и open всегда в согласии ---
  const dlg = w('(s)=>s.document.querySelector("#wishOverlay")'); // registry заполняется лениво
  let modalCalls = 0, closeCalls = 0;
  dlg.open = false;
  dlg.showModal = () => { modalCalls++; dlg.open = true; };
  dlg.close = () => { closeCalls++; dlg.open = false; };
  w('(s)=>{s.openOverlay("wishOverlay"); return 1;}');
  assert(dlg.hidden === false && modalCalls === 1, 'openOverlay: hidden снят и showModal вызван');
  w('(s)=>{s.openOverlay("wishOverlay"); return 1;}');
  assert(modalCalls === 1, 'openOverlay: повторно не открывает уже открытый диалог');
  w('(s)=>{s.closeOverlay("wishOverlay"); return 1;}');
  assert(dlg.hidden === true && closeCalls === 1, 'closeOverlay: hidden вернулся и close вызван');
  const pop = w('(s)=>s.document.querySelector("#appToast")');
  let popShown = 0;
  pop.showPopover = () => popShown++;
  pop.hidePopover = () => {};
  w('(s)=>{s.notify("проверка"); return 1;}');
  assert(pop.hidden === false && popShown === 1, 'тост поднимается в top layer как popover');
```

Run: `node build.js && node tests/uni-smoke.js app.js 2>&1 | grep -E "FAIL|openOverlay|popover"`
Expected: падение — `openOverlay is not defined`.

- [ ] **Step 2: openOverlay / closeOverlay в src/62-global-clicks.js**

Строки 2–9 заменить на:

```js
// Модалки — нативные <dialog> (фаза 4). Атрибут hidden держим в согласии с
// открытостью: на него смотрят тесты-песочницы и 90-effects-init.js
// (.overlay:not([hidden])). Открывать и закрывать — только через эту пару.
function openOverlay(id) {
  const el = $('#' + id);
  if (!el) return;
  el.hidden = false;
  if (typeof el.showModal === 'function' && !el.open) el.showModal();
}
function closeOverlay(id) {
  const el = $('#' + id);
  if (!el) return;
  el.hidden = true;
  if (typeof el.close === 'function' && el.open) el.close();
  if (id === 'lightbox') lbResetState(); // светбокс закрыт — сбрасываем список и зум
  if (id === 'eventOverlay') editingEventId = null;
  // Закрыли не ответив — запоминаем на время сессии, чтобы не всплывало
  // повторно при каждом заходе на главную (см. src/30-home.js).
  if (id === 'dateInviteOverlay') markInvitesDismissed(pendingDateInvites().map(d => d.id));
}
```

Клик по затемнению (строка ~298, `if (e.target.classList && e.target.classList.contains('overlay')) closeOverlay(e.target.id);`) оставить как есть: у `<dialog>` на всю страницу клик мимо карточки `.modal` попадает в сам диалог.

В обработчике `keydown` (строки ~309–314) удалить ветку `if (e.key === 'Escape') { … }` целиком — Esc у модального `<dialog>` порождает событие `cancel`, его ловит `src/63-sheet.js` (шаг 4). Остальные ветки `keydown` не трогать.

- [ ] **Step 3: Все прямые `.hidden = false/true` у оверлеев — через пару**

| Место | Было | Стало |
|---|---|---|
| `src/30-home.js:306` | `if (ov) ov.hidden = false;` (и `const ov = …` строкой выше) | `openOverlay('dateInviteOverlay');` |
| `src/30-home.js:340` | `$('#dateOverlay').hidden = false;` | `openOverlay('dateOverlay');` |
| `src/30-home.js:360` и `:385` | `$('#dateOverlay').hidden = true;` | `closeOverlay('dateOverlay');` |
| `src/43-event-modal.js:34` | `$('#eventOverlay').hidden = false;` | `openOverlay('eventOverlay');` |
| `src/43-event-modal.js:96` | `$('#eventOverlay').hidden = true;` | `closeOverlay('eventOverlay');` (строкой выше уже `editingEventId = null` — повтор безвреден) |
| `src/61-wishes.js:90` / `:147` | `$('#wishOverlay').hidden = false/true;` | `openOverlay('wishOverlay');` / `closeOverlay('wishOverlay');` |
| `src/72-photo-labels.js:63` | `$('#labelOverlay').hidden = false;` | `openOverlay('labelOverlay');` |
| `src/72-photo-labels.js:156` | `$('#labelApplyOverlay').hidden = false;` | `openOverlay('labelApplyOverlay');` |
| `src/85-lightbox.js:103` | `if (lb) lb.hidden = false;` (и `const lb = …`) | `openOverlay('lightbox');` |
| `src/85-lightbox.js:122-126` (`lbClose`) | тело функции | `closeOverlay('lightbox');` (сброс состояния делает `closeOverlay`) |

Проверка, что ничего не пропущено:

Run: `grep -nE "(Overlay|lightbox)'\)\.hidden|\b(ov|lb)\.hidden" src/*.js`
Expected: пусто.

- [ ] **Step 4: src/63-sheet.js — Esc через `cancel`**

Создать файл (Task 3 допишет в него свайп):

```js
/* ===== Шторки: поведение нативных <dialog> (фаза 4) =====
   Esc у модального <dialog> браузер превращает в событие cancel и закрывает
   диалог сам — мимо closeOverlay, и тогда hidden и побочные эффекты
   (сброс лайтбокса, «приглашение закрыто») разъехались бы с открытостью.
   Поэтому cancel перехватываем и закрываем своим путём. Esc внутри
   календарика гасится там же (datePopKeydown → preventDefault) — до cancel
   дело не доходит, закрывается только календарик. */
$$('dialog.overlay').forEach(dlg => {
  dlg.addEventListener('cancel', e => {
    e.preventDefault();
    const pop = $('#datePop');
    if (pop && !pop.hidden) {
      closeDatePop();
      return;
    }
    closeOverlay(dlg.id);
  });
});
```

- [ ] **Step 5: Разметка диалогов в index.html**

Для каждого из 7 оверлеев заменить открывающий тег и соответствующий ему закрывающий `</div>` на `</dialog>`:

| Строка | Было | Стало |
|---|---|---|
| 234 | `<div class="overlay" id="eventOverlay" hidden role="dialog" aria-modal="true" aria-labelledby="evModalTitle">` | `<dialog class="overlay" id="eventOverlay" hidden aria-labelledby="evModalTitle">` |
| 269 | `<div class="overlay" id="dateOverlay" hidden role="dialog" aria-modal="true" aria-labelledby="dtModalTitle">` | `<dialog class="overlay" id="dateOverlay" hidden aria-labelledby="dtModalTitle">` |
| 290 | `<div class="overlay" id="dateInviteOverlay" … aria-labelledby="dateInviteTitle">` | `<dialog class="overlay" id="dateInviteOverlay" hidden aria-labelledby="dateInviteTitle">` |
| 299 | `<div class="overlay" id="labelOverlay" … aria-labelledby="labelModalTitle">` | `<dialog class="overlay" id="labelOverlay" hidden aria-labelledby="labelModalTitle">` |
| 313 | `<div class="overlay" id="labelApplyOverlay" … aria-labelledby="labelApplyTitle">` | `<dialog class="overlay" id="labelApplyOverlay" hidden aria-labelledby="labelApplyTitle">` |
| 328 | `<div class="overlay" id="wishOverlay" … aria-labelledby="wishModalTitle">` | `<dialog class="overlay" id="wishOverlay" hidden aria-labelledby="wishModalTitle">` |
| 347 | `<div class="overlay lightbox" id="lightbox" hidden role="dialog" aria-modal="true" aria-label="Просмотр фото">` | `<dialog class="overlay lightbox" id="lightbox" hidden aria-label="Просмотр фото">` |

Закрывающие теги: последний `</div>` каждого блока (строки 266, 287, 296, 310, 325, 344, 362) → `</dialog>`. После правки:

Run: `node -e "const h=require('fs').readFileSync('index.html','utf8');console.log((h.match(/<dialog/g)||[]).length,(h.match(/<\/dialog>/g)||[]).length)"`
Expected: `7 7`.

`#datePop` (строка 376): добавить атрибут `popover="manual"`. `#appToast` (строка 396): добавить `popover="manual"`.

- [ ] **Step 6: setPopover и тост в src/00-core.js**

Перед `function notify` добавить:

```js
// Поверх открытого <dialog> (top layer) z-index не пробивается — календарик
// и тост поднимаются туда же как popover="manual". hidden держим в согласии:
// на него смотрят тесты и CSS ([hidden]{display:none}).
function setPopover(el, on) {
  if (!el) return;
  el.hidden = !on;
  if (typeof el.showPopover !== 'function') return; // песочница тестов
  try {
    if (on) el.showPopover();
    else el.hidePopover();
  } catch (e) {} // уже открыт/закрыт — InvalidStateError, состояние и так нужное
}
```

В `notify` строку `t.hidden = false;` заменить на `setPopover(t, false); setPopover(t, true);` (скрыть и показать заново — тост встаёт поверх диалога, открытого позже него), а `t.hidden = true;` в таймере — на `setPopover(t, false);`.

- [ ] **Step 7: Календарик как popover в src/42-datepicker.js**

В `closeDatePop` строку `if (pop) pop.hidden = true;` заменить на `setPopover(pop, false);`. В `openDatePop` строку `pop.hidden = false;` заменить на `setPopover(pop, true);`. Остальное (координаты `left/top` в инлайн-стиле) не трогать.

- [ ] **Step 8: CSS диалога, календарика, тоста**

Правило `.overlay{…}` и `.overlay[hidden]{…}` (строки 536–541) заменить на:

```css
/* Модалки — нативный <dialog> на весь экран (фаза 4): прозрачный слой-контейнер,
   карточка .modal внутри. Клик мимо карточки попадает в сам диалог и закрывает
   его (62-global-clicks.js). Затемнение — ::backdrop. */
.overlay{
  position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;
  padding:20px;border:0;background:transparent;color:inherit;
  display:grid;place-items:center;overflow:hidden;
}
.overlay[hidden],.overlay:not([open]){display:none}
.overlay::backdrop{background:oklch(from var(--void) l c h / .5);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
/* Страница под открытой модалкой не прокручивается (на телефоне иначе едет фон) */
html:has(.overlay[open]){overflow:hidden}
```

`#lightbox{…}` (строка 614): фон переносится в `::backdrop`, сам диалог остаётся прозрачным:

```css
#lightbox{padding:0}
#lightbox::backdrop{background:oklch(from var(--void) l c h / .9)}
```

(`z-index:95` из старого правила удалить — в top layer он ничего не значит.)

В начало правил `.date-pop{` и `.app-toast{` дописать `inset:auto;margin:0;` — UA-стиль `[popover]` ставит `inset:0;margin:auto` и растянул бы их на весь экран; свои `left/top/bottom` в тех же правилах идут после и выигрывают. `z-index` у обоих удалить.

- [ ] **Step 9: Прогнать тесты**

Run: `npm run check`
Expected: exit 0; в выводе `OK: openOverlay: hidden снят и showModal вызван`, `OK: тост поднимается в top layer как popover`.

- [ ] **Step 10: Проверить в браузере**

Стенд `http://127.0.0.1:8090/tools/demo.html`, десктоп и 390×844. Для каждого из 7 диалогов (`openDateModal()`, `openEventModal()`, `openWishModal()`, `openLabelManageOverlay()`, `openLabelApplyOverlay([db.photos[0].id])`, `openDateInviteOverlay()`, `openLightbox([db.photos[0].id], 0)` — вызвать из консоли):
1. Открывается, фон затемнён и размыт, страница под ним не прокручивается.
2. Esc закрывает; `document.querySelector('#<id>').hidden === true` после закрытия.
3. Клик по затемнению закрывает (для лайтбокса — клик по пустому месту сцены, как раньше).
4. Tab не уходит из диалога.

Отдельно: в «Назначить свидание» нажать на поле даты — календарик **поверх** затемнения; Esc закрывает только календарик, второй Esc — модалку. В открытой модалке вызвать `notify('тест')` — тост виден поверх.

Run: `node tools/browser-check.js`
Expected: `ИТОГ: OK`.

- [ ] **Step 11: Снимки**

Run: `node tools/shots.js task-2 && node tools/shots-diff.js task-1 task-2`
Expected: `DIFF` только у `*-home-invite.png` (приглашение теперь `<dialog>` с `::backdrop`) — либо `OK`, если затемнение совпало пиксель в пиксель. Открыть `phone-dark-home-invite.png` и `desk-light-home-invite.png`: карточка по центру, фон затемнён, на «длинных» экранах больше нет двойного отпечатка модалки (baseline/README.md, «второй артефакт»).

- [ ] **Step 12: Commit**

```bash
git add index.html src/00-core.js src/42-datepicker.js src/62-global-clicks.js src/63-sheet.js src/30-home.js src/43-event-modal.js src/61-wishes.js src/72-photo-labels.js src/85-lightbox.js styles.css tests/uni-smoke.js app.js
git commit -m "Feat: семь модалок — нативный <dialog>, календарик и тост поверх как popover (NV-50)"
```

### Task 3: Шторка на телефоне — снизу, пружиной, свайпом вниз

Спека 2.3 и 3.2: на телефоне модалка — нижняя шторка, приезжает снизу пружиной (`@starting-style`), тянется пальцем, закрывается свайпом вниз. На десктопе — тот же `<dialog>` по центру. Лайтбокс — не шторка (полноэкранный просмотр), его правила не трогаются.

Тянуть можно только за ручку сверху (полоса на всю ширину, 28 px): иначе свайп вниз внутри длинной формы спорил бы с прокруткой её содержимого.

**Files:**
- Modify: `src/63-sheet.js`
- Modify: `styles.css` (после правил `.modal`, ~стр. 547)
- Modify: `tests/uni-smoke.js`
- Modify: `tools/browser-check.js`

**Interfaces:**
- Consumes: `closeOverlay(id)` (Task 2)
- Produces: `sheetShouldClose(dy: number, ms: number): boolean` — `true`, если протянули дальше `SHEET_CLOSE_PX` (96) или смахнули быстрее `SHEET_CLOSE_SPEED` (0.6 px/мс) при ходе больше 24 px
- Produces: `.sheet-grip` — первый ребёнок каждой `.modal` в `dialog.overlay:not(.lightbox)`, вставляется скриптом

- [ ] **Step 1: Падающие проверки**

В `tests/uni-smoke.js`, блок экспорта: `s.sheetShouldClose = sheetShouldClose;`. После проверок Task 2:

```js
  // --- Фаза 4: свайп шторки ---
  assert(w('(s)=>s.sheetShouldClose(120, 400)') === true, 'шторка: протянули дальше порога — закрыть');
  assert(w('(s)=>s.sheetShouldClose(40, 30)') === true, 'шторка: быстрый смах коротким ходом — закрыть');
  assert(w('(s)=>s.sheetShouldClose(40, 400)') === false, 'шторка: медленно и недалеко — вернуть на место');
  assert(w('(s)=>s.sheetShouldClose(10, 5)') === false, 'шторка: дрожь пальца не закрывает');
```

Run: `node build.js && node tests/uni-smoke.js app.js 2>&1 | grep -E "FAIL|шторка"`
Expected: падение — `sheetShouldClose is not defined`.

- [ ] **Step 2: Свайп в src/63-sheet.js**

Дописать в конец файла:

```js
/* Свайп вниз (только телефон): тянем за ручку .sheet-grip, шторка едет за
   пальцем через --sheet-dy; отпустили — закрываем или возвращаем пружиной. */
const SHEET_CLOSE_PX = 96;
const SHEET_CLOSE_SPEED = 0.6; // px/мс — быстрый смах закрывает и коротким ходом
function sheetShouldClose(dy, ms) {
  return dy > SHEET_CLOSE_PX || (dy > 24 && dy / Math.max(ms, 1) > SHEET_CLOSE_SPEED);
}
function sheetDragSetup(dlg) {
  const modal = dlg.querySelector('.modal');
  if (!modal) return;
  const grip = document.createElement('div');
  grip.className = 'sheet-grip';
  grip.setAttribute('aria-hidden', 'true');
  modal.prepend(grip);
  let y0 = 0,
    t0 = 0,
    dy = 0,
    dragging = false;
  grip.addEventListener('pointerdown', e => {
    if (!window.matchMedia('(max-width: 820px)').matches) return;
    dragging = true;
    y0 = e.clientY;
    t0 = e.timeStamp;
    dy = 0;
    grip.setPointerCapture(e.pointerId);
    modal.classList.add('sheet-dragging');
  });
  grip.addEventListener('pointermove', e => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - y0);
    modal.style.setProperty('--sheet-dy', dy + 'px');
  });
  const end = e => {
    if (!dragging) return;
    dragging = false;
    modal.classList.remove('sheet-dragging');
    modal.style.removeProperty('--sheet-dy');
    if (sheetShouldClose(dy, e.timeStamp - t0)) closeOverlay(dlg.id);
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}
$$('dialog.overlay:not(.lightbox)').forEach(sheetDragSetup);
```

- [ ] **Step 3: CSS шторки**

После правил `.modal`/`.modal-x` в `styles.css`:

```css
/* Шторка (фаза 4, спека 2.3): на телефоне модалка прижата к низу, приезжает
   пружиной, тянется за ручку. Длительности — литералы до токенов фазы 8 (NV-60). */
.sheet-grip{display:none}
@media (max-width:820px){
  .overlay:not(.lightbox){padding:0;place-items:end stretch}
  .overlay:not(.lightbox) .modal{
    width:100%;max-height:92dvh;animation:none;
    border-radius:var(--radius-sheet) var(--radius-sheet) 0 0;
    padding-bottom:calc(28px + env(safe-area-inset-bottom));
    transform:translateY(var(--sheet-dy,0px));
    transition:transform .42s cubic-bezier(.2,.8,.2,1);
  }
  .overlay:not(.lightbox) .modal.sheet-dragging{transition:none}
  @starting-style{.overlay[open]:not(.lightbox) .modal{transform:translateY(100%)}}
  .sheet-grip{display:block;flex:none;height:28px;margin:-28px -28px 0;touch-action:none;cursor:grab}
  .sheet-grip::before{content:'';display:block;width:40px;height:4px;margin:12px auto 0;border-radius:var(--radius-pill);background:var(--line)}
  .event-modal .sheet-grip{margin:0;position:absolute;inset:0 0 auto;z-index:1}
}
```

(`.event-modal` без внутреннего отступа, её цветная шапка начинается от края — ручка там лежит поверх шапки абсолютом.)

- [ ] **Step 4: Приёмка свайпа в tools/browser-check.js**

Перед `(async () => {` добавить:

```js
// Шторка (фаза 4): на ширине телефона короткий медленный рывок за ручку
// возвращает шторку, длинный — закрывает.
async function checkSheetSwipe(browser, log) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 15000 });
  await page.evaluate(() => {
    document.startViewTransition = undefined;
    closeOverlay('dateInviteOverlay');
    openDateModal();
  });
  await page.waitForTimeout(600); // пружина появления
  const drag = async (dy, stepMs) => {
    const g = await page.locator('#dateOverlay .sheet-grip').boundingBox();
    const x = g.x + g.width / 2,
      y = g.y + g.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x, y + (dy * i) / 10);
      await page.waitForTimeout(stepMs);
    }
    await page.mouse.up();
    await page.waitForTimeout(500);
  };
  await drag(40, 60);
  const stayed = !(await page.evaluate(() => document.getElementById('dateOverlay').hidden));
  await drag(220, 15);
  const closed = await page.evaluate(() => document.getElementById('dateOverlay').hidden);
  await page.close();
  const ok = stayed && closed;
  log.push((ok ? 'OK' : 'FAIL') + ' шторка: короткий рывок — осталась=' + stayed + ', длинный — закрылась=' + closed);
  return ok;
}
```

В основном блоке после `checkPhotosReorder` — `allOk = (await checkSheetSwipe(browser, log)) && allOk;`.

- [ ] **Step 5: Прогнать всё**

Run: `npm run check`
Expected: exit 0, четыре `OK: шторка: …`.

Run: `node tools/browser-check.js`
Expected: `OK шторка: короткий рывок — осталась=true, длинный — закрылась=true`, `ИТОГ: OK`.

- [ ] **Step 6: Посмотреть глазами**

Стенд на 390×844, обе темы: открыть «Назначить свидание», «Добавить дату» (`openEventModal()`), «Хотелку». Шторка прижата к низу, скругления только сверху, ручка видна; при открытии въезжает снизу, а не «выпрыгивает» из центра. Длинная форма (`eventOverlay`) прокручивается внутри шторки, а не тянется. На 1280×900 всё по центру, как в Task 2.

Run: `node tools/shots.js task-3 && node tools/shots-diff.js task-2 task-3`
Expected: `DIFF` только у `phone-*-home-invite.png`. Открыть оба: приглашение — шторка снизу.

- [ ] **Step 7: Commit**

```bash
git add src/63-sheet.js styles.css tests/uni-smoke.js tools/browser-check.js app.js
git commit -m "Feat: шторки на телефоне — снизу пружиной, закрытие свайпом за ручку (NV-50)"
```

### Task 4: Закрыть фазу 4 — документация, мёрж, деплой

**Files:**
- Modify: `README.md` (список модулей — `src/63-sheet.js`; раздел про навигацию, если описывает 7 вкладок)
- Modify: `PROJECT-MEMORY.md` (раздел 0f → новый короткий подраздел «Фаза 4 влита» в начале файла)

- [ ] **Step 1: README.md**

В списке модулей добавить строку `63-sheet.js — шторки: Esc/cancel у <dialog>, свайп за ручку` рядом с `62-global-clicks.js`. Найти описание навигации (`grep -n "вкладк" README.md`) и привести к «пять вкладок: Главная, Календарь, Фото, Наше (Заметки/Списки/Хотелки), Память».

- [ ] **Step 2: PROJECT-MEMORY.md**

Над разделом `## 0f.` вставить:

```markdown
## 0g-4. ⚡ Фаза 4 редизайна влита (дата мёржа)

- Навигация: `BOTTOM_PRIMARY = ['home','calendar','photos','our','memory']`. `our` — псевдо-вкладка, `resolveView()` раскрывает её в последний из `OUR_TABS` (ключ `universe_our_tab`). `activeView` всегда настоящий экран, адрес — `#/notes` и т.п.
- Модалки — нативные `<dialog class="overlay">`. Открывать/закрывать **только** `openOverlay(id)` / `closeOverlay(id)`: они держат `hidden` в согласии с `open` (на `hidden` смотрят тесты и `90-effects-init.js`). Esc → `cancel` → `closeOverlay` (`src/63-sheet.js`).
- Календарик `#datePop` и тост `#appToast` — `popover="manual"` через `setPopover(el, on)`: иначе они под затемнением top layer.
- Шторка на ≤820 px: ручка `.sheet-grip`, `sheetShouldClose(dy, ms)` (96 px или 0.6 px/мс).
```

- [ ] **Step 3: Финальная проверка ветки и мёрж**

Run: `npm run check` → exit 0; `node tools/browser-check.js` → `ИТОГ: OK`.

Скилл `superpowers:finishing-a-development-branch`: мёрж `redesign-phase-4` в `main`, push. Деплой запускается сам (`.github/workflows/deploy-pages.yml`).

- [ ] **Step 4: Проверить деплой**

Run: `gh run list --limit 2` → оба прогона (`Публикация на GitHub Pages`, `CI — сборка и тесты`) `completed success`.
Run: `curl -s https://ledoksi.github.io/nasha-vselennaya/ | grep -c "<dialog"` → `7`.

- [ ] **Step 5: Commit** (документация — до мёржа, в ветку фазы)

```bash
git add README.md PROJECT-MEMORY.md
git commit -m "Docs: фаза 4 — навигация из пяти вкладок, <dialog>, шторки"
```

---

# ФАЗА 5 — Главная как ось времени

Ветка `redesign-phase-5` от `main` (с влитой фазой 4). Перед Task 5: `node tools/shots.js phase-5-start`.

### Task 5: Блок «Сейчас» — орбита-счётчик, годовщина, таймер, комплимент

Спека 2.2 и baseline/README.md: сейчас на Главной пять карточек одной громкости, заголовок «Наша вселенная» дублирует логотип в шапке, счётчик дней — мелкая строка сбоку от кольца. Становится: крупное число дней дисплейной гарнитурой (`--text-hero`) в центре кольца-орбиты; дуга — прогресс до годовщины, на её конце светится янтарная звезда «сейчас»; под числом — сколько до годовщины, таймер до ближайшего события и комплимент дня тихими строками, без своих карточек. Чипы «в этот день» и статистика остаются под блоком. Коллаж фото пока остаётся — он уйдёт в Task 6, когда фото появятся на оси.

**Files:**
- Modify: `index.html:90-104` (`#view-home`)
- Modify: `src/35-memory.js:97-165` (`renderProgressRing`)
- Modify: `src/30-home.js:65-121` (`renderCompliment`, `renderCountdown`), `:180-199` (`renderDates` — заголовок)
- Modify: `styles.css` (новые правила «Сейчас»; удаление мёртвых правил старого hero)
- Modify: `tests/uni-smoke.js`

**Interfaces:**
- Produces: `anniversaryInfo(at?: Date): { pct: number, left: number, total: number }` — процент пройденного круга до годовщины, дней до неё, длина круга в днях
- Produces: `orbitGeometry(pct: number, r: number): { circ: number, off: number, x: number, y: number }` — для SVG `viewBox="0 0 200 200"` с центром (100, 100): длина окружности, `stroke-dashoffset` дуги, координаты звезды на конце дуги (угол от 12 часов по часовой)
- Сохраняется: `#progressRing`, `#countdown`, `#countdownTick` (маскируется в `tools/shots.js`), `#compliment`, `#dates`, `#addDateBtn` — те же id

- [ ] **Step 1: Падающие проверки**

В блок экспорта `tests/uni-smoke.js`: `s.anniversaryInfo = anniversaryInfo; s.orbitGeometry = orbitGeometry; s.START_DATE = START_DATE;`. Рядом с проверками кольца (~стр. 1291):

```js
  // --- Фаза 5: орбита «Сейчас» ---
  const [sy, sm, sd] = w('(s)=>s.START_DATE').split('-').map(Number);
  const an0 = w(`(s)=>s.anniversaryInfo(new Date(${sy + 1}, ${sm - 1}, ${sd}))`);
  assert(an0.pct === 0 && an0.left === an0.total, 'годовщина: в сам день начинается новый круг — 0%');
  const an1 = w(`(s)=>s.anniversaryInfo(new Date(${sy + 1}, ${sm - 1}, ${sd - 1}))`);
  assert(an1.left === 1 && an1.pct === 100, 'годовщина: накануне остался 1 день, круг пройден');
  const g0 = w('(s)=>s.orbitGeometry(0, 92)');
  assert(Math.abs(g0.x - 100) < 1e-9 && Math.abs(g0.y - 8) < 1e-9 && Math.abs(g0.off - g0.circ) < 1e-9, 'орбита: 0% — звезда на 12 часах, дуга пустая');
  const g25 = w('(s)=>s.orbitGeometry(25, 92)');
  assert(Math.abs(g25.x - 192) < 1e-9 && Math.abs(g25.y - 100) < 1e-9, 'орбита: 25% — звезда на 3 часах');
  assert(registry['#progressRing'].innerHTML.includes('orbit-ring'), 'орбита рендерится');
  assert(!registry['#progressRing'].innerHTML.includes('ring-svg'), 'старого кольца больше нет');
```

`an1.pct === 100`: накануне годовщины `left = 1`, `pct = round((total-1)/total·100)` = 100 при `total ≥ 200`. Если на практике выйдет 99.7 → 100 — верно; ассерт на `left === 1` главный.

Существующие проверки, которые изменятся по делу (поправить ожидание, не удалять смысл):
- `'кольцо прогресса рендерится'` (~стр. 1291, ищет `ring-svg`) — удалить, её заменяют две новые выше.
- `'счётчик дней виден в объединённом hero-блоке'` (~стр. 404, `includes(String(expDays) + ' ')`) → `includes('>' + expDays + '<')` и подпись `'счётчик дней — крупное число в центре орбиты'`.

Run: `node build.js && node tests/uni-smoke.js app.js 2>&1 | grep -E "FAIL|орбита|годовщина"`
Expected: падение — `anniversaryInfo is not defined`.

- [ ] **Step 2: anniversaryInfo и orbitGeometry в src/35-memory.js**

Над `function renderProgressRing` (после `plural`):

```js
// Круг до годовщины: сколько дней осталось, какая доля пройдена (at — для тестов).
function anniversaryInfo(at) {
  const [sy, sm, sd] = START_DATE.split('-').map(Number);
  const now = at || new Date();
  const cur = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const anniv = new Date(sy, sm - 1, sd);
  while (anniv.getTime() <= cur.getTime()) anniv.setFullYear(anniv.getFullYear() + 1);
  const prev = new Date(anniv);
  prev.setFullYear(prev.getFullYear() - 1);
  const total = Math.max(1, Math.round((anniv - prev) / 86400000));
  const left = Math.round((anniv - cur) / 86400000);
  const pct = Math.max(0, Math.min(100, Math.round(((total - left) / total) * 100)));
  return { pct, left, total };
}
// Орбита в SVG 200×200 с центром (100,100): дуга прогресса и звезда на её конце.
// Угол — от 12 часов по часовой (дуга повёрнута на -90° тем же способом).
function orbitGeometry(pct, r) {
  const circ = 2 * Math.PI * r;
  const a = (pct / 100) * 2 * Math.PI - Math.PI / 2;
  return { circ, off: circ - (circ * pct) / 100, x: 100 + r * Math.cos(a), y: 100 + r * Math.sin(a) };
}
```

- [ ] **Step 3: renderProgressRing — орбита вместо кольца**

В `renderProgressRing` удалить расчёт `start/cur/days/anniv/prev/total/elapsed/pct/R/CIRC/off/yearsTogether` (строки 100–115, от `const [sy, sm, sd] = …` до `const yearsTogether = …` включительно) и заменить на:

```js
  const days = daysTogether();
  const info = anniversaryInfo(at);
  const geo = orbitGeometry(info.pct, 92);
  const yearsTogether = Math.floor(days / 365.25);
```

Расчёт `stats` и `otdRow` не трогать. Вызов `render(box, html\`…\`)` заменить на:

```js
  render(
    box,
    html`<div class="orbit">
        <svg class="orbit-ring" viewBox="0 0 200 200" role="img" aria-label="До годовщины ${info.left} ${pluralDays(info.left)}, пройдено ${info.pct}%">
          <circle class="orbit-track" cx="100" cy="100" r="92"></circle>
          <circle class="orbit-arc" cx="100" cy="100" r="92" transform="rotate(-90 100 100)" stroke-dasharray="${geo.circ}" stroke-dashoffset="${geo.off}"></circle>
          <circle class="orbit-star" cx="${geo.x}" cy="${geo.y}" r="6"></circle>
        </svg>
        <div class="orbit-center"><b class="orbit-days">${days}</b><span>${pluralDays(days)} вместе</span></div>
      </div>
      <p class="orbit-sub">
        ${yearsTogether > 0 ? yearsTogether + ' ' + pluralYears(yearsTogether) + ' · ' : ''}до годовщины ${info.left} ${pluralDays(info.left)} · с ${fmtShort(START_DATE)}
      </p>
      ${otdRow}
      <div class="history-photos">${historyPhotosHtml(at)}</div>
      <div class="history-stats">${stats}</div>`
  );
```

- [ ] **Step 4: Таймер и комплимент — строки, не карточки (src/30-home.js)**

В `renderCompliment` вызов `render(box, html\`<div class="compliment-card">…</div>\`)` заменить на `box.textContent = COMPLIMENTS[h % COMPLIMENTS.length];`.

В `renderCountdown` разметку внутри `render(box, …)` заменить на:

```js
    html`<span class="now-label">${n.emoji} до «${n.title}»</span> <span class="now-tick" id="countdownTick">…</span>`
```

В `renderDates` убрать заголовок `<h3>💘 Наши свидания</h3>` из начала шаблона (его роль берёт «Ближайшее» в разметке). Перед правкой: `grep -n "Наши свидания" tests/*.js` — если тест ищет эту строку, поменять ожидание на наличие `date-card`.

- [ ] **Step 5: Разметка Главной в index.html**

Строки 90–104 (`<section class="view active" id="view-home">…</section>`) заменить на:

```html
    <section class="view active" id="view-home">
      <!-- «Сейчас» (спека 2.2): орбита-счётчик, годовщина, таймер, комплимент -->
      <div class="now">
        <p class="hero-names">Гоша <span>&amp;</span> Даша</p>
        <div class="orbit-block" id="progressRing"></div>
        <p class="now-line" id="countdown" hidden></p>
        <p class="now-compliment" id="compliment"></p>
      </div>
      <!-- «Ближайшее»: свидания, приглашения, кнопка назначить -->
      <div class="home-zone">
        <h2 class="zone-title">Ближайшее</h2>
        <div class="date-bar">
          <button class="btn btn-date" id="addDateBtn">💘 Назначить свидание</button>
        </div>
        <div class="dates" id="dates"></div>
      </div>
    </section>
```

- [ ] **Step 6: Стили «Сейчас»**

В `@layer components`, на месте удаляемых правил старого hero:

```css
/* «Сейчас» (фаза 5): вся смелость редизайна — здесь, остальное тихо */
.now{display:grid;justify-items:center;gap:12px;padding:24px 0 32px;text-align:center}
.orbit-block{display:grid;justify-items:center;gap:12px;width:100%}
.orbit{position:relative;width:min(78vw,300px);aspect-ratio:1}
.orbit-ring{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.orbit-track{fill:none;stroke:var(--line);stroke-width:2}
.orbit-arc{fill:none;stroke:var(--star);stroke-width:3;stroke-linecap:round}
.orbit-star{fill:var(--star);filter:drop-shadow(0 0 6px var(--star))}
.orbit-center{position:absolute;inset:0;display:grid;place-content:center;gap:4px}
.orbit-days{font-family:var(--font-display);font-size:var(--text-hero);font-weight:700;line-height:.85;font-variant-numeric:tabular-nums;color:var(--ink)}
.orbit-center span,.orbit-sub,.now-line{font-size:var(--text-sm);color:var(--ink-2)}
.orbit-sub{font-variant-numeric:tabular-nums}
.now-tick{font-family:var(--font-display);font-size:var(--text-xl);color:var(--ink);font-variant-numeric:tabular-nums}
.now-compliment{max-width:36ch;font-size:var(--text-base);font-style:italic;color:var(--ink)}
.home-zone{margin-top:32px}
.zone-title{margin-bottom:16px;font-size:var(--text-xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--star-ink)}
```

Удалить правила, у которых не осталось пользователей. Для каждого класса из списка `hero-zone hero-card history-main ring-wrap ring-svg ring-bg ring-fg ring-center ring-info compliment-card compliment-text countdown-time`:

Run: `grep -rn "<класс>" src index.html`
Expected: пусто → удалить все правила `styles.css` с этим классом. Если класс ещё где-то используется (например, `compliment-card` в другом экране) — правило оставить. `.hero-names` оставить (живёт в «Сейчас»).

- [ ] **Step 7: Прогнать тесты**

Run: `npm run check`
Expected: exit 0, `OK: орбита рендерится`, `OK: годовщина: накануне остался 1 день, круг пройден`.

- [ ] **Step 8: Посмотреть глазами**

Run: `node tools/shots.js task-5 && node tools/shots-diff.js phase-5-start task-5`
Expected: `DIFF` только у `*-home.png` и `*-home-invite.png`. Открыть все четыре `*-home.png`:
- число дней — самый крупный элемент экрана, влезает в орбиту на 390 px без переноса;
- звезда стоит на конце дуги, дуга начинается сверху;
- в светлой теме подпись «Ближайшее» и дуга читаются (`--star-ink` для текста);
- счётчик до годовщины из baseline/README.md («почти невидимый заголовок») больше не существует как класс проблемы — проверить, что ничего на Главной не рисуется с низкой непрозрачностью.

- [ ] **Step 9: Commit**

```bash
git add index.html src/30-home.js src/35-memory.js styles.css tests/uni-smoke.js app.js
git commit -m "Feat: блок «Сейчас» — орбита-счётчик, годовщина, таймер и комплимент строками (NV-53)"
```

### Task 6: Ось времени на Главной

Спека 2.2: ниже «Ближайшего» Главная продолжается в прошлое. Слева тонкая световая нить (сверху янтарная, книзу гаснет в фиолетовый), дни — точки на ней, у каждого года липкая метка. Данные — те же, что у «Памяти» (`memoryByDay()`: события, прошедшие свидания, фото с EXIF-датой), фото на оси — миниатюрами (`memoryPhotosHtml`). Лента подгружается страницами по 30 дней: метка в конце ленты попадает в экран (с запасом 600 px) — дорисовывается следующая страница.

«Память» в этой задаче не удаляется: её вкладка рисуется **тем же** `renderTimeline`, только в `#memoryFeed`, и уходит в Task 7 (решение владельца 26.09.2026, NV-52) без правок оси.

Коллаж «Наша история» (`historyPhotosHtml` и кнопка «🎲 Перемешать») уходит с Главной отдельным коммитом (шаг 9): фото теперь живут на оси — решение владельца 26.09.2026.

**Files:**
- Create: `src/36-timeline.js`
- Modify: `src/35-memory.js:186-240` (`renderMemory` → обёртка), `src/30-home.js:22-40` (`renderHome`)
- Modify: `index.html` (`#view-home` — контейнер оси; `#memoryFeed` — атрибут `data-axis`)
- Modify: `styles.css` (ось; удаление `.tl-left/.tl-right/.tl-stem/.tl-dot`)
- Modify: `tests/uni-smoke.js`

**Interfaces:**
- Consumes: `memoryByDay(): Array<{ date: 'YYYY-MM-DD', events, dates, photos }>` (уже есть, отсортирован от новых к старым), `memoryPhotosHtml(photos, groupId, rowCls)`, `hydratePhotoImgs(el)`, `openLightboxFrom(el)`, `parseLocalIso(s)`
- Produces: `TIMELINE_PAGE = 30`
- Produces: `timelineYears(days): Array<{ year: string, days: Array }>` — группы по году подряд, порядок сохраняется
- Produces: `memoryDayHtml(day, gid: { n: number }): SafeHtml` — карточка одного дня на оси
- Produces: `renderTimeline(box: Element, more?: boolean): void` — рисует ось в контейнер с атрибутом `data-axis`; повторный вызов без `more` сохраняет уже раскрытую глубину, с `more` — добавляет страницу
- Produces: CSS-переменная `--header-h` на `<html>` — текущая высота липкой шапки

- [ ] **Step 1: Падающие проверки**

В блок экспорта: `s.timelineYears = timelineYears; s.renderTimeline = renderTimeline; s.TIMELINE_PAGE = TIMELINE_PAGE;`. Рядом с проверками «Памяти» (~стр. 1270):

```js
  // --- Фаза 5: ось времени ---
  const ty = w(`(s)=>s.timelineYears([{date:'2026-05-01'},{date:'2026-01-02'},{date:'2025-12-31'},{date:'2024-03-01'}])`);
  assert(JSON.stringify(ty.map(y => [y.year, y.days.length])) === '[["2026",2],["2025",1],["2024",1]]', 'ось: дни группируются по годам подряд, порядок сохранён');
  w(`(s)=>{ s.db.events.push({ id: 'axis1', title: 'Ось', date: '2025-05-01', emoji: '💜', repeat: false }); s.renderTimeline(s.document.querySelector('#homeTimeline')); return 1; }`);
  const axisHtml = registry['#homeTimeline'].innerHTML;
  assert(axisHtml.includes('axis-year-label') && axisHtml.includes('axis-now'), 'ось: метки годов и точка «сейчас» на Главной');
  w('(s)=>{s.renderMemory(); return 1;}');
  assert(registry['#memoryFeed'].innerHTML.includes('axis-day'), '«Память» рисуется тем же кодом оси');
  w(`(s)=>{ s.db.events = s.db.events.filter(e => e.id !== 'axis1'); return 1; }`);
```

Существующая проверка `'дерево «Память» рендерит карточки'` ищет `tl-card` — класс сохраняется внутри `.axis-day`, проверка остаётся зелёной.

Run: `node build.js && node tests/uni-smoke.js app.js 2>&1 | grep -E "FAIL|ось"`
Expected: падение — `timelineYears is not defined`.

- [ ] **Step 2: src/36-timeline.js**

```js
/* ===== Ось времени: Главная продолжается в прошлое (фаза 5, спека 2.2) =====
   Те же дни, что у «Памяти» (memoryByDay), одной колонкой: световая нить
   слева, точки-дни, липкая метка года. Страницами по TIMELINE_PAGE дней:
   метка [data-axis-more] в конце попадает в экран — дорисовываем следующую
   (IntersectionObserver, как в галерее; ноль обработчиков scroll, спека 3.2).
   Рисуется в любой контейнер с атрибутом data-axis: #homeTimeline на Главной
   и #memoryFeed во вкладке «Память» (до Task 7 фаз 4–6, потом только Главная). */
const TIMELINE_PAGE = 30;
const timelineShown = new Map(); // контейнер → сколько дней уже раскрыто

function timelineYears(days) {
  const out = [];
  for (const d of days) {
    const y = String(d.date).slice(0, 4);
    if (!out.length || out[out.length - 1].year !== y) out.push({ year: y, days: [] });
    out[out.length - 1].days.push(d);
  }
  return out;
}

function memoryDayHtml(day, gid) {
  const dt = parseLocalIso(day.date);
  const label = dt ? dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : day.date;
  const card = [html`<div class="tl-date">${label}</div>`];
  if (day.photos.length) card.push(memoryPhotosHtml(day.photos, 'day' + gid.n++, 'tl-photos'));
  for (const d of day.dates) {
    const info = [d.place, d.time].filter(Boolean).join(' · ');
    card.push(html`<div class="tl-item"><span class="tl-item-emoji">${d.emoji}</span><b>Свидание${info ? html` · ${info}` : ''}</b></div>`);
    if (d.photos && d.photos.length) card.push(memoryPhotosHtml(d.photos, 'dt' + gid.n++, 'tl-item-photos'));
  }
  for (const ev of day.events) {
    card.push(html`<div class="tl-item"><span class="tl-item-emoji">${ev.emoji}</span><b>${ev.title}</b></div>`);
    if (ev.photos.length) card.push(memoryPhotosHtml(ev.photos, 'ev' + gid.n++, 'tl-item-photos'));
  }
  return html`<article class="axis-day"><span class="axis-dot"></span><div class="tl-card">${card}</div></article>`;
}

function renderTimeline(box, more) {
  if (!box) return;
  const days = memoryByDay();
  if (!days.length) {
    render(box, html`<div class="empty-state rem-empty">Пока пусто 💜<br />Добавляйте события и фото — здесь сложится история вашей вселенной.</div>`);
    return;
  }
  // Повторный рендер (живое обновление, возврат на вкладку) не схлопывает
  // уже раскрытую глубину — иначе прокрутка прыгала бы вверх.
  const prev = timelineShown.get(box) || 0;
  const shown = Math.min(days.length, more ? prev + TIMELINE_PAGE : Math.max(prev, TIMELINE_PAGE));
  timelineShown.set(box, shown);
  const gid = { n: 0 };
  render(
    box,
    html`<div class="axis">
      <div class="axis-now"><span class="axis-dot"></span>сейчас</div>
      ${timelineYears(days.slice(0, shown)).map(
        y => html`<section class="axis-year">
          <h3 class="axis-year-label">${y.year}</h3>
          ${y.days.map(d => memoryDayHtml(d, gid))}
        </section>`
      )}
      ${shown < days.length ? html`<div class="axis-more" data-axis-more></div>` : ''}
    </div>`
  );
  hydratePhotoImgs(box);
  box.querySelectorAll('[data-lightbox]').forEach(img => img.addEventListener('click', () => openLightboxFrom(img)));
  const sentinel = box.querySelectorAll('[data-axis-more]')[0];
  if (sentinel && timelineObserver) timelineObserver.observe(sentinel);
}

let timelineObserver = null;
if (typeof IntersectionObserver === 'function') {
  timelineObserver = new IntersectionObserver(
    entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        timelineObserver.unobserve(e.target);
        renderTimeline(e.target.closest('[data-axis]'), true);
      }
    },
    { rootMargin: '600px 0px' }
  );
}

// Высота липкой шапки → --header-h: под ней прилипают метки годов. Шапка
// меняет высоту (перенос кнопок на узком десктопе, плашка «нет сети»).
if (typeof ResizeObserver === 'function') {
  const hdr = $('.header');
  if (hdr) new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', hdr.offsetHeight + 'px')).observe(hdr);
}
```

- [ ] **Step 3: renderMemory — обёртка над осью (src/35-memory.js)**

Тело `renderMemory` (строки ~186–240, от `const feed = $('#memoryFeed');` до конца функции) заменить на:

```js
function renderMemory() {
  renderTimeline($('#memoryFeed'));
}
```

Комментарий над ней поправить: «Вкладка «Память» — та же ось, что на Главной (src/36-timeline.js)». `memoryByDay`, `memoryPhotosHtml`, `tlPhotoImg`, `toggleMemoryPhotos` и делегат `[data-tl-expand]` не трогать — ось пользуется ими.

- [ ] **Step 4: Ось на Главной**

`index.html`: внутри `#view-home`, после блока `.home-zone`:

```html
      <!-- Ось времени (спека 2.2): прошлое продолжением прокрутки, src/36-timeline.js -->
      <div class="home-timeline" id="homeTimeline" data-axis></div>
```

`#memoryFeed` (строка ~193): `<div class="memory-feed" id="memoryFeed" data-axis></div>`.

`src/30-home.js`, `renderHome`: после `renderProgressRing();` добавить `renderTimeline($('#homeTimeline'));`, а строку `hydratePhotoImgs($('#progressRing'));` оставить (коллаж ещё на месте до шага 8).

- [ ] **Step 5: Стили оси**

В `@layer components` вместо правил `.tl`, `.tl-stem`, `.tl-left`, `.tl-right`, `.tl-dot` (удалить их — `grep -rn "tl-stem\|tl-left\|tl-right\|tl-dot" src index.html` должен быть пуст):

```css
/* Ось времени (фаза 5): световая нить, точки-дни, липкие годы */
.home-timeline{margin-top:48px}
.axis{position:relative;padding-left:32px}
.axis::before{
  content:'';position:absolute;left:11px;top:6px;bottom:0;width:2px;border-radius:var(--radius-pill);
  background:linear-gradient(to bottom,var(--star),oklch(from var(--night) l c h / .6) 160px,oklch(from var(--night) l c h / .15));
}
.axis-dot{position:absolute;left:-26px;top:.4em;width:12px;height:12px;border-radius:var(--radius-pill);background:var(--sky-0);border:2px solid oklch(from var(--night) l c h / .8)}
.axis-now{position:relative;margin-bottom:24px;font-size:var(--text-xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--star-ink)}
.axis-now .axis-dot{background:var(--star);border-color:var(--star);box-shadow:0 0 12px var(--star)}
.axis-year-label{
  position:sticky;top:calc(var(--header-h,64px) + 8px);z-index:2;width:max-content;margin:0 0 16px -32px;padding:4px 12px;
  font-family:var(--font-display);font-size:var(--text-display);line-height:1;color:var(--ink);background:var(--sky-0);border-radius:var(--radius-pill);
}
.axis-day{position:relative;margin-bottom:24px}
.axis-day .tl-card{background:var(--sky-1);border:1px solid var(--line);border-radius:var(--radius-card);padding:16px}
.axis-more{height:1px}
```

- [ ] **Step 6: Прогнать тесты**

Run: `npm run check`
Expected: exit 0; `OK: ось: дни группируются по годам подряд, порядок сохранён`, `OK: «Память» рисуется тем же кодом оси`.

- [ ] **Step 7: Посмотреть глазами и проверить подгрузку**

Run: `node tools/shots.js task-6-axis && node tools/shots-diff.js task-5 task-6-axis`
Expected: `DIFF` у `*-home.png`, `*-home-invite.png`, `*-memory.png`. Открыть `phone-dark-home.png`, `desk-light-home.png`, `phone-dark-memory.png`: нить слева, сверху янтарная точка «сейчас», годы крупные, карточки дней с миниатюрами.

Липкие годы и подгрузка — на стенде в браузере, 390×844. В консоли размножить дни и проверить страницы:

```js
const base = db.events.slice();
for (let i = 0; i < 80; i++) db.events.push({ ...base[0], id: 'tl' + i, date: iso(2025 - Math.floor(i / 12), i % 12, 1 + (i % 27)), repeat: false });
renderHome();
document.querySelectorAll('#homeTimeline .axis-day').length; // ожидание: 30
```

Прокрутить Главную вниз до конца ленты → `document.querySelectorAll('#homeTimeline .axis-day').length` растёт до 60, потом до всех. Метка года при прокрутке прилипает под шапкой, не заезжает под неё; при смене года метка сменяется. Клик по миниатюре на оси открывает лайтбокс.

- [ ] **Step 8: Commit оси**

```bash
git add index.html src/36-timeline.js src/30-home.js src/35-memory.js styles.css tests/uni-smoke.js app.js
git commit -m "Feat: ось времени на Главной — световая нить, липкие годы, подгрузка страницами (NV-51)"
```

- [ ] **Step 9: Убрать коллаж с Главной отдельным коммитом**

В `renderProgressRing` удалить строку `<div class="history-photos">${historyPhotosHtml(at)}</div>` и из `stats` — последний чип `<span class="hs-chip hs-shuffle" id="shuffleHistoryBtn" …>🎲 Перемешать</span>`. В `renderHome` удалить `hydratePhotoImgs($('#progressRing'));`.

Затем для каждой из функций/переменных коллажа — `historyPhotosHtml`, `pickHistoryPhotos`, `shuffleHistoryPhotos`, `onThisDayPhotos`, `historyCollage`, обработчика клика `#shuffleHistoryBtn`:

Run: `grep -rn "<имя>" src`
Если единственное оставшееся использование — собственное объявление, удалить объявление. В `tests/uni-smoke.js` удалить проверки коллажа (~стр. 540–570: `'коллаж стабилен…'`, `'кнопка «🎲 Перемешать» подключена…'`, `'после перемеса коллаж стабилен…'`) и соответствующие строки экспорта (`s.onThisDayPhotos`, `s.pickHistoryPhotos`, `s.shuffleHistoryPhotos`, `s.historyPhotosHtml`, `historyCollage`). Проверки чипа хотелок (`'2/4'`, `'пока пусто'`) оставить — чип остаётся. Правила CSS `.history-photos`, `.hs-shuffle` и их потомков — удалить, если `grep` по `src index.html` пуст.

Run: `npm run check`
Expected: exit 0.

```bash
git add src/30-home.js src/35-memory.js styles.css tests/uni-smoke.js app.js
git commit -m "Refactor: коллаж «Наша история» уходит с Главной — фото живут на оси (NV-51)"
```


### Task 7: «Память» на Главной — убрать пятую вкладку, закрыть фазу 5

**Решение владельца 26.09.2026 (NV-52):** «Память» живёт на оси Главной, отдельной вкладки нет — четыре вкладки, как в спеке 2.1. Коллаж «Наша история» тоже не возвращается (снят в Task 6). Спрашивать повторно не нужно.

До этой задачи вкладка «Память» оставалась, чтобы сайт не терял раздел между фазами; теперь ось на Главной его заменяет. Ось и вкладка рисовались одним `renderTimeline`, поэтому вкладка удаляется без правок оси.

**Files:**
- Modify: `src/20-theme-nav.js` (`BOTTOM_PRIMARY`, `BOTTOM_ICON`, `showView`)
- Modify: `index.html` (кнопка `data-view="memory"`, `<section id="view-memory">`)
- Modify: `src/35-memory.js` (`renderMemory`)
- Modify: `styles.css` (`.memory-feed`)
- Modify: `tests/uni-smoke.js`, `tools/shots.js`, `tools/css-coverage.js`
- Modify: `README.md`, `PROJECT-MEMORY.md`

**Interfaces:**
- Produces: `BOTTOM_PRIMARY = ['home', 'calendar', 'photos', 'our']`
- Сохраняется: `renderTimeline`, `memoryByDay`, `memoryPhotosHtml`, `toggleMemoryPhotos` — ими живёт ось Главной
- Ссылка `#/memory` ведёт на Главную: `showView` выходит на `if (!$('#view-memory')) return;`, активной остаётся Главная — как у любой неизвестной вкладки

- [ ] **Step 1: Поправить ожидания в tests/uni-smoke.js**

- Ожидание `BOTTOM_PRIMARY` → `'["home","calendar","photos","our"]'`, подпись `'навигация: Главная, Календарь, Фото, Наше'`.
- Проверку `'«Память» рисуется тем же кодом оси'` (Task 6) и проверки `'дерево «Память» рендерит карточки'` и соседние по `#memoryFeed` (~стр. 1269–1280) перевести на `s.renderTimeline(s.document.querySelector('#homeTimeline'))` / `registry['#homeTimeline']`; экспорт `s.renderMemory` удалить.
- Из цикла «Все вкладки рендерятся» убрать `'memory'`.

Run: `node build.js && node tests/uni-smoke.js app.js 2>&1 | grep -E "FAIL|навигация"`
Expected: `FAIL: навигация: Главная, Календарь, Фото, Наше` (в коде ещё пять вкладок).

- [ ] **Step 2: Убрать вкладку**

- `src/20-theme-nav.js`: `const BOTTOM_PRIMARY = ['home', 'calendar', 'photos', 'our'];`; из `BOTTOM_ICON` удалить `memory`; комментарий над `BOTTOM_PRIMARY` — «Главная · Календарь · Фото · Наше (спека 2.1). «Память» живёт на оси Главной — решение владельца 26.09.2026, NV-52»; в `showView` удалить `if (view === 'memory') renderMemory();`.
- `index.html`: удалить кнопку `<button class="nav-btn" data-view="memory">Память</button>` и весь `<section class="view" id="view-memory">…</section>` вместе с комментарием `<!-- ===== ПАМЯТЬ ===== -->`.
- `src/35-memory.js`: удалить `renderMemory` и комментарий над ней — после правок выше `grep -rn "renderMemory" src` должен быть пуст.
- `styles.css`: удалить правила `.memory-feed`, если `grep -rn "memory-feed" src index.html` пуст.
- `tools/shots.js` и `tools/css-coverage.js`: убрать `'memory'` из `VIEWS`.

- [ ] **Step 3: Прогнать всё**

Run: `npm run check` → exit 0, `OK: навигация: Главная, Календарь, Фото, Наше`.
Run: `node tools/browser-check.js` → `ИТОГ: OK`.
Run: `node tools/shots.js task-7 && node tools/shots-diff.js task-6-axis task-7` → `DIFF` у всех снимков (нижняя панель/шапка), снимков `*-memory.png` в `task-7` нет. Глазами: `phone-dark-home.png` — в нижней панели 4 иконки; на стенде адрес `#/memory` открывает Главную.

- [ ] **Step 4: Commit**

```bash
git add src/20-theme-nav.js index.html src/35-memory.js styles.css tests/uni-smoke.js tools/shots.js tools/css-coverage.js app.js
git commit -m "Feat: «Память» живёт на оси Главной — четыре вкладки (NV-52)"
```

- [ ] **Step 5: Документация фазы 5**

`README.md`: в список модулей — `36-timeline.js — ось времени на Главной (бывшая вкладка «Память»)`; описание навигации — «четыре вкладки: Главная, Календарь, Фото, Наше». `PROJECT-MEMORY.md`: над `## 0g-4` вставить `## 0g-5. ⚡ Фаза 5 редизайна влита (дата)` с пунктами: блок «Сейчас» (`anniversaryInfo`, `orbitGeometry`, ids `#progressRing/#countdown/#compliment` сохранены); ось (`renderTimeline(box, more)`, `data-axis`, `TIMELINE_PAGE = 30`, `--header-h` от `ResizeObserver`); коллаж «Наша история» снят; вкладки «Память» нет — решение владельца 26.09.2026 (NV-52), `#/memory` ведёт на Главную. В `0g-4` поправить `BOTTOM_PRIMARY` на итоговый.

```bash
git add README.md PROJECT-MEMORY.md
git commit -m "Docs: фаза 5 — «Сейчас», ось времени, Память на Главной"
```

- [ ] **Step 6: Мёрж и деплой**

Скилл `superpowers:finishing-a-development-branch`: мёрж `redesign-phase-5` в `main`, push. `gh run list --limit 2` → оба прогона `success`. Карточку NV-52 — комментарий «Выполнено: вкладка убрана, ось на Главной, фаза 5 выкачена», `done`.

---

# ФАЗА 6 — Фото

Ветка `redesign-phase-6` от `main` (с влитой фазой 5). Перед Task 8: `node tools/shots.js phase-6-start`.

### Task 8: Плитки разного размера и content-visibility

Спека 2.4: закреплённые фото и фото «в этот день» занимают двойную ячейку (2×2), остальные — одинарную; сетка плотная (`grid-auto-flow: dense`), дыр не остаётся. В режиме «↕ Порядок» все плитки одинаковые: SortableJS двигает DOM-узлы, а `dense` переставляет их визуально — при разных размерах палец и плитка разъезжались бы. Сюда же из NV-48 — `content-visibility: auto` на плитках (решение владельца 25.09.2026: делается один раз под итоговую сетку).

**Files:**
- Modify: `src/71-photo-grid.js:29-110` (`renderPhotosNow`)
- Modify: `styles.css:499-501` (`.photos-grid`, `.photo`, `.photo img`)
- Modify: `tests/uni-smoke.js`
- Modify: `docs/superpowers/baseline/metrics.md`

**Interfaces:**
- Consumes: `onThisDayItems(at?)` (`src/35-memory.js`) — элементы `{ kind: 'photo', p }`
- Produces: класс `.photo--big` на `.photo`, если `!photoReorderMode && (p.pinned || фото «в этот день»)`

- [ ] **Step 1: Замер «до»**

Стенд, десктоп 1280×900, вкладка «Фото». В консоли (пять прогонов, медиана):

```js
db.photos = Array.from({ length: 300 }, (_, i) => ({ ...db.photos[i % db.photos.length], id: 'm' + i, pinned: i % 17 === 0, order: i }));
const runs = [];
for (let k = 0; k < 5; k++) { const t0 = performance.now(); renderPhotosNow(); document.body.offsetHeight; runs.push(performance.now() - t0); }
runs.sort((a, b) => a - b)[2].toFixed(1) + ' мс';
```

Записать число.

- [ ] **Step 2: Падающая проверка**

В `tests/uni-smoke.js`, рядом с проверками галереи:

```js
  // --- Фаза 6: плитки разного размера ---
  w(`(s)=>{ s.db.photos.push({ id: 'big1', title: 'b', pinned: true, labels: [], order: 0, ts: 1 }); s.renderPhotos(); return 1; }`);
  const gridHtml = registry['#photosGrid'].innerHTML;
  assert((gridHtml.match(/photo--big/g) || []).length >= 1, 'галерея: закреплённое фото — двойная плитка');
  w('(s)=>{ s.togglePhotoReorderMode(); s.renderPhotos(); return 1; }');
  assert(!registry['#photosGrid'].innerHTML.includes('photo--big'), 'галерея: в режиме порядка все плитки одинаковые');
  w(`(s)=>{ s.togglePhotoReorderMode(); s.db.photos = s.db.photos.filter(p => p.id !== 'big1'); return 1; }`);
```

`s.db`, `s.renderPhotos`, `s.togglePhotoReorderMode` уже экспортированы (`tests/uni-smoke.js:184, 197, 229`). Если `renderPhotos` падает на фото `big1` без какого-то поля — дописать поле в объект по образцу фото из ближайшего теста галереи, а не менять код приложения.

Run: `node build.js && node tests/uni-smoke.js app.js 2>&1 | grep -E "FAIL|плитк"`
Expected: `FAIL: галерея: закреплённое фото — двойная плитка`.

- [ ] **Step 3: Класс в renderPhotosNow**

Перед `const cards = list.length` добавить:

```js
  // Двойная плитка (спека 2.4): закреплённые и «в этот день». В режиме порядка —
  // все одинаковые: dense-сетка переставляет плитки визуально, а SortableJS
  // двигает DOM — при разных размерах палец и плитка разъезжались бы.
  const bigIds = photoReorderMode ? new Set() : new Set(onThisDayItems().filter(it => it.kind === 'photo').map(it => it.p.id));
```

В шаблоне плитки `<div class="photo${p.pinned ? ' pinned' : ''}…` добавить класс:

```js
    <div class="photo${p.pinned ? ' pinned' : ''}${!photoReorderMode && (p.pinned || bigIds.has(p.id)) ? ' photo--big' : ''}${selectedPhotos.has(p.id) ? ' selected' : ''}" data-id="${p.id}">
```

- [ ] **Step 4: CSS сетки**

```css
.photos-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));grid-auto-flow:dense;gap:14px}
/* content-visibility (NV-48 → NV-54): плитки за экраном не раскладываются и не
   рисуются; auto — браузер запоминает настоящий размер после первого показа. */
.photo{content-visibility:auto;contain-intrinsic-size:auto 180px}
.photo--big{grid-column:span 2;grid-row:span 2;contain-intrinsic-size:auto 374px}
.photo--big img{aspect-ratio:auto;height:100%}
```

Остальные свойства `.photo{…}` (строка 500) сохранить — `content-visibility` и `contain-intrinsic-size` дописываются в то же правило. Проверить медиазапросы галереи (`grep -n "photos-grid" styles.css`): если где-то сетка становится одноколоночной — там добавить `.photo--big{grid-column:auto;grid-row:auto}`, иначе `span 2` создаст лишнюю колонку.

- [ ] **Step 5: Тесты, замер «после», приёмка перетаскивания**

Run: `npm run check` → exit 0, `OK: галерея: закреплённое фото — двойная плитка`.

Повторить замер шага 1. В `docs/superpowers/baseline/metrics.md` добавить раздел:

```markdown
## Галерея: content-visibility (NV-54, дата)

300 плиток на стенде, десктоп 1280×900, медиана 5 прогонов `renderPhotosNow()` + принудительная раскладка:
до — <N> мс, после — <M> мс.
```

Run: `node tools/browser-check.js`
Expected: `OK фото: …` (порядок в режиме «↕ Порядок» меняется), `ИТОГ: OK`.

- [ ] **Step 6: Посмотреть глазами**

Run: `node tools/shots.js task-8 && node tools/shots-diff.js phase-6-start task-8`
Expected: `DIFF` у `*-photos.png` (и `*-home.png`, если там есть миниатюры — нет, Главная галерею не показывает; лишний DIFF — разбирать). Открыть четыре `*-photos.png`: закреплённые плитки (в фикстурах первые две) двойные, дыр в сетке нет, на телефоне 390 px ничего не выезжает за край. Включить «↕ Порядок» на стенде — все плитки одинаковые.

- [ ] **Step 7: Commit**

```bash
git add src/71-photo-grid.js styles.css tests/uni-smoke.js docs/superpowers/baseline/metrics.md app.js
git commit -m "Feat: галерея — двойные плитки для закреплённых и «в этот день», content-visibility (NV-54)"
```

### Task 9: Долгое нажатие и тихая плитка

Спека 2.4: «тап — открыть, долгое нажатие — режим выделения, порядок — отдельным режимом (как сейчас)». Состояние на 26.09.2026: кнопки выбора (○) и ручки порядка (⠿) на плитке уже появляются только в своих режимах; постоянным шумом остались крестики `✕` на чипах лейблов каждой плитки. Лейбл с фото по-прежнему снимается из лайтбокса (кнопка 🏷 → шторка «Применить лейблы») и из режима выбора («🏷 Добавить лейбл»). Новое: долгое нажатие (450 мс) на плитку включает режим выбора с этим фото; в режиме выбора тап по плитке выбирает её, а не открывает лайтбокс.

**Files:**
- Modify: `src/70-photos.js:44-60`
- Modify: `src/71-photo-grid.js` (шаблон плитки, подсказка `#dragHint`, обработчики на `#photosGrid`)
- Modify: `src/62-global-clicks.js:188-192` (клик по `[data-photo]`)
- Modify: `styles.css` (`.photo img`)
- Modify: `tests/uni-smoke.js`, `tools/browser-check.js`

**Interfaces:**
- Produces: `LONG_PRESS_MS = 450`
- Produces: `photoLongPress(id: string): void` — вне режима порядка: `photoSelectMode = true`, `selectedPhotos.add(id)`, взводит `photoLongPressed`, перерисовывает
- Produces: `let photoLongPressed: boolean` — следующий клик по фото гасится (браузер присылает его после отпускания)

- [ ] **Step 1: Падающие проверки**

В блок экспорта: `s.photoLongPress = photoLongPress;`. `s.selectedPhotos`, `s.togglePhotoSelectMode`, `s.togglePhotoReorderMode` и геттеры `photoSelectMode`/`photoReorderMode` (только чтение) уже есть (`tests/uni-smoke.js:227–231`) — режимы переключаются только через `toggle…`.

```js
  // --- Фаза 6: долгое нажатие, тихая плитка ---
  const pid = 'lp1'; // photoLongPress не требует, чтобы фото существовало
  w('(s)=>{ if (s.photoSelectMode) s.togglePhotoSelectMode(); if (s.photoReorderMode) s.togglePhotoReorderMode(); s.selectedPhotos.clear(); return 1; }');
  w(`(s)=>{ s.photoLongPress(${JSON.stringify(pid)}); return 1; }`);
  assert(w('(s)=>s.photoSelectMode') === true && w(`(s)=>s.selectedPhotos.has(${JSON.stringify(pid)})`), 'долгое нажатие: режим выбора с этим фото');
  w('(s)=>{ s.togglePhotoSelectMode(); s.togglePhotoReorderMode(); return 1; }');
  w(`(s)=>{ s.photoLongPress(${JSON.stringify(pid)}); return 1; }`);
  assert(w('(s)=>s.photoSelectMode') === false, 'долгое нажатие: в режиме порядка не срабатывает');
  w('(s)=>{ s.togglePhotoReorderMode(); s.renderPhotos(); return 1; }');
  assert(!registry['#photosGrid'].innerHTML.includes('photo-label-del'), 'плитка: без крестиков на чипах лейблов');
```

Run: `node build.js && node tests/uni-smoke.js app.js 2>&1 | grep -E "FAIL|долгое|плитка:"`
Expected: падение — `photoLongPress is not defined`.

- [ ] **Step 2: photoLongPress в src/70-photos.js**

После `togglePhotoReorderMode`:

```js
// Долгое нажатие на плитку — сразу режим выбора с этим фото (спека 2.4).
// Клик, который браузер пришлёт после отпускания, гасим (photoLongPressed),
// иначе поверх выбора открылся бы лайтбокс.
const LONG_PRESS_MS = 450;
let photoLongPressed = false;
function photoLongPress(id) {
  if (photoReorderMode) return;
  photoSelectMode = true;
  selectedPhotos.add(id);
  photoLongPressed = true;
  renderPhotos();
}
```

- [ ] **Step 3: Жест на #photosGrid (src/71-photo-grid.js)**

В конец файла:

```js
// Долгое нажатие (Task 9): таймер на pointerdown по фото, сдвиг пальца > 10 px
// или отпускание — отмена. Слушатели — один раз на сетке (плитки пересоздаются).
const photosGridEl = $('#photosGrid');
if (photosGridEl && photosGridEl.addEventListener) {
  let pressTimer = null,
    pressX = 0,
    pressY = 0;
  const cancelPress = () => {
    clearTimeout(pressTimer);
    pressTimer = null;
  };
  photosGridEl.addEventListener('pointerdown', e => {
    photoLongPressed = false; // хвост прошлого нажатия без клика (iOS шлёт contextmenu вместо click)
    const img = e.target.closest && e.target.closest('[data-photo]');
    if (!img || photoReorderMode || e.button > 0) return;
    pressX = e.clientX;
    pressY = e.clientY;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      photoLongPress(img.dataset.photo);
      if (navigator.vibrate) navigator.vibrate(10);
    }, LONG_PRESS_MS);
  });
  photosGridEl.addEventListener('pointermove', e => {
    if (pressTimer && Math.hypot(e.clientX - pressX, e.clientY - pressY) > 10) cancelPress();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => photosGridEl.addEventListener(t, cancelPress));
  photosGridEl.addEventListener('contextmenu', e => {
    if (photoLongPressed) e.preventDefault(); // системное меню картинки после долгого нажатия
  });
}
```

- [ ] **Step 4: Клик по фото (src/62-global-clicks.js:188-192)**

```js
  const photo = e.target.closest('[data-photo]');
  if (photo) {
    if (photoLongPressed) {
      photoLongPressed = false; // клик — хвост долгого нажатия, выбор уже сделан
      return;
    }
    // В режиме выбора тап по плитке галереи выбирает её, а не открывает лайтбокс
    if (photoSelectMode && photo.closest('#photosGrid')) {
      const id = photo.dataset.photo;
      if (selectedPhotos.has(id)) selectedPhotos.delete(id);
      else selectedPhotos.add(id);
      renderPhotos();
      return;
    }
    openLightboxFrom(photo);
    return;
  }
```

- [ ] **Step 5: Тихая плитка (src/71-photo-grid.js)**

В шаблоне чипа лейбла удалить кнопку крестика — фрагмент

```js
${
                sys ? '' : html`<button type="button" class="photo-label-del" data-label-off="${id}" data-photo-off="${p.id}" title="Убрать лейбл с фото">✕</button>`
              }
```

Подсказку режима выбора (`hint.textContent = 'Нажми ○ на фото, чтобы выбрать несколько.'`) заменить на `'Нажимай на фото, чтобы выбрать несколько. Долгое нажатие включает выбор из любого места.'`.

После этого: `grep -rn "data-label-off\|photo-label-del" src index.html` — если остался только обработчик в `62-global-clicks.js`, удалить и его, а CSS `.photo-label-del` — из `styles.css`. `removeLabelFromPhoto` не удалять, если `grep` находит другие вызовы (лайтбокс, шторка лейблов).

В `styles.css` к `.photo img{…}` дописать `-webkit-touch-callout:none;user-select:none;` (иначе iOS на долгом нажатии показывает меню «Сохранить картинку»).

- [ ] **Step 6: Приёмка в tools/browser-check.js**

Перед `(async () => {`:

```js
// Долгое нажатие (фаза 6): мышь зажата на плитке 700 мс — включается выбор
// с этим фото, лайтбокс не открывается.
async function checkPhotoLongPress(page, log) {
  await page.evaluate(() => {
    go('photos');
    if (photoReorderMode) togglePhotoReorderMode();
    if (photoSelectMode) togglePhotoSelectMode();
  });
  await page.waitForTimeout(200);
  const box = await page.locator('#photosGrid .photo img').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({ sel: selectedPhotos.size, mode: photoSelectMode, lb: !document.getElementById('lightbox').hidden }));
  const ok = r.sel === 1 && r.mode && !r.lb;
  log.push((ok ? 'OK' : 'FAIL') + ' долгое нажатие: выбрано=' + r.sel + ', режим=' + r.mode + ', лайтбокс=' + r.lb);
  await page.evaluate(() => togglePhotoSelectMode());
  return ok;
}
```

В основном блоке после `checkPhotosReorder`: `allOk = (await checkPhotoLongPress(page, log)) && allOk;`.

- [ ] **Step 7: Прогнать всё**

Run: `npm run check` → exit 0, три `OK` из шага 1.
Run: `node tools/browser-check.js` → `OK долгое нажатие: выбрано=1, режим=true, лайтбокс=false`, `ИТОГ: OK`.

- [ ] **Step 8: Посмотреть глазами**

Run: `node tools/shots.js task-9 && node tools/shots-diff.js task-8 task-9`
Expected: `DIFF` у `*-photos.png`. На плитках чипы лейблов без крестиков. На стенде вручную: короткий тап — лайтбокс; долгое — выбор и панель «Выбрано: 1»; тап по второй плитке — «Выбрано: 2»; «✓ Готово» — выход из режима.

- [ ] **Step 9: Commit**

```bash
git add src/70-photos.js src/71-photo-grid.js src/62-global-clicks.js styles.css tests/uni-smoke.js tools/browser-check.js app.js
git commit -m "Feat: галерея — долгое нажатие включает выбор, тап выбирает, без крестиков на плитке (NV-55)"
```

### Task 10: Плитка → лайтбокс общим элементом

Спека 2.4 и 3.2: «Фото → лайтбокс | общий элемент | связь объектов». Нажатая миниатюра и картинка лайтбокса получают одно имя `view-transition-name: lb-photo` — браузер сам анимирует перелёт. Обратно — так же, если миниатюра текущего фото есть на экране (после листания в лайтбоксе это может быть уже другая плитка); если её нет — обычное закрытие. Механизм переходов в проекте уже есть (`runViewTransition` в `src/20-theme-nav.js`), ему нужно одно изменение: возвращать объект перехода, чтобы снять имя после его окончания.

**Files:**
- Modify: `src/20-theme-nav.js:22-44` (`runViewTransition`)
- Modify: `src/85-lightbox.js:98-126` (`openLightbox`, `openLightboxFrom`)
- Modify: `src/62-global-clicks.js` (`closeOverlay` → `closeOverlay` + `closeOverlayNow`)
- Modify: `styles.css` (рядом с `::view-transition` ~стр. 1083)
- Modify: `tests/uni-smoke.js`

**Interfaces:**
- Consumes: `openOverlay`, `closeOverlay` (Task 2)
- Produces: `runViewTransition(apply): ViewTransition | true | false` — объект перехода (или `true`, если браузер его не вернул) при запуске, `false` — если переход не запущен. Все существующие вызовы вида `if (!runViewTransition(apply)) apply();` продолжают работать.
- Produces: `openLightbox(ids, idx, fromEl?)` — третий необязательный аргумент: элемент-миниатюра для перелёта
- Produces: `lbFlyBack(close: () => void): boolean` — `true`, если запущен обратный перелёт (закрытие выполнит он)
- Produces: `closeOverlayNow(id)` — прежнее тело `closeOverlay`; `closeOverlay('lightbox')` сначала пробует `lbFlyBack`

- [ ] **Step 1: Падающие проверки**

`s.document`, `s.openLightbox`, `s.closeOverlay` уже доступны. Рядом с проверками светбокса:

```js
  // --- Фаза 6: плитка → лайтбокс общим элементом ---
  w(`(s)=>{
    s.document.startViewTransition = cb => { cb(); return { finished: Promise.resolve() }; };
    const tile = { dataset: { photo: 'p1' }, style: {}, closest: () => null };
    s.openLightbox(['p1'], 0, tile);
    return 1;
  }`);
  assert(registry['#lightbox'].hidden === false, 'лайтбокс: открыт перелётом из плитки');
  const lbImg = w('(s)=>s.document.querySelector("#lightboxImg")');
  assert(lbImg.style.viewTransitionName === 'lb-photo', 'лайтбокс: имя перехода на картинке лайтбокса');
  w('(s)=>{ s.closeOverlay("lightbox"); return 1; }');
  assert(registry['#lightbox'].hidden === true, 'лайтбокс: закрыт обратным перелётом');
  assert(lbImg.style.viewTransitionName === '', 'лайтбокс: имя снято с картинки');
  w('(s)=>{ delete s.document.startViewTransition; return 1; }');
```

Run: `node build.js && node tests/uni-smoke.js app.js 2>&1 | grep -E "FAIL|лайтбокс:"`
Expected: `FAIL: лайтбокс: имя перехода на картинке лайтбокса`.

- [ ] **Step 2: runViewTransition возвращает объект перехода**

В `src/20-theme-nav.js`, в `runViewTransition` строку `return true;` (после блока `if (t) {…}`) заменить на `return t || true;`. Комментарий над функцией дополнить: «Возвращает объект перехода (для .finished) или false, если переход не запущен».

- [ ] **Step 3: Перелёт туда (src/85-lightbox.js)**

`openLightbox` заменить на:

```js
// fromEl — миниатюра, из которой открыли: она и картинка лайтбокса на время
// перехода носят одно имя lb-photo, браузер анимирует перелёт (спека 2.4).
function openLightbox(ids, idx, fromEl) {
  lightboxList = Array.isArray(ids) ? ids.slice() : [];
  lightboxIdx = Math.max(0, Math.min(idx || 0, lightboxList.length ? lightboxList.length - 1 : 0));
  lightboxZoom = 1;
  const img = $('#lightboxImg');
  const show = () => {
    openOverlay('lightbox');
    lbRender();
  };
  if (fromEl && fromEl.style && img && img.style) {
    fromEl.style.viewTransitionName = 'lb-photo';
    const t = runViewTransition(() => {
      fromEl.style.viewTransitionName = '';
      img.style.viewTransitionName = 'lb-photo';
      show();
    });
    if (t) return;
    fromEl.style.viewTransitionName = '';
  }
  show();
}
```

В `openLightboxFrom` последнюю строку `openLightbox(list, at);` → `openLightbox(list, at, el);`.

Добавить под `lbResetState`:

```js
// Обратный перелёт: если миниатюра текущего фото видна на активной вкладке —
// имя переезжает на неё, браузер анимирует возврат. true — переход запущен,
// закрытие (close) выполнит он сам.
function lbFlyBack(close) {
  const img = $('#lightboxImg');
  const id = lightboxList[lightboxIdx];
  if (!id || !img || !img.style) return false;
  const scope = '#view-' + activeView + ' ';
  const to = document.querySelector(scope + '[data-photo="' + id + '"], ' + scope + '[data-lightbox="' + id + '"]');
  if (!to || !to.style) return false;
  const t = runViewTransition(() => {
    img.style.viewTransitionName = '';
    to.style.viewTransitionName = 'lb-photo';
    close();
  });
  if (!t) return false;
  const clear = () => (to.style.viewTransitionName = '');
  if (t.finished && typeof t.finished.then === 'function') t.finished.then(clear, clear);
  else clear();
  return true;
}
```

- [ ] **Step 4: closeOverlay → closeOverlayNow (src/62-global-clicks.js)**

Переименовать функцию из Task 2 `closeOverlay` в `closeOverlayNow`, в её ветку лайтбокса добавить снятие имени:

```js
  if (id === 'lightbox') {
    lbResetState(); // светбокс закрыт — сбрасываем список и зум
    const lbImg = $('#lightboxImg');
    if (lbImg && lbImg.style) lbImg.style.viewTransitionName = '';
  }
```

(строку `if (id === 'lightbox') lbResetState();` заменить этим блоком). Над ней объявить:

```js
function closeOverlay(id) {
  if (id === 'lightbox' && lbFlyBack(() => closeOverlayNow(id))) return;
  closeOverlayNow(id);
}
```

`lbFlyBack` читает `lightboxList` до сброса — порядок верный: сброс идёт внутри `closeOverlayNow`, который зовётся из перехода.

- [ ] **Step 5: CSS перелёта**

Рядом с `::view-transition{pointer-events:none}` (~стр. 1083):

```css
/* Плитка ⇄ лайтбокс (фаза 6): перелёт общим элементом, длительность — литерал до NV-60 */
::view-transition-group(lb-photo){animation-duration:.32s;animation-timing-function:cubic-bezier(.2,.8,.2,1)}
::view-transition-old(lb-photo),::view-transition-new(lb-photo){height:100%;object-fit:cover}
```

- [ ] **Step 6: Прогнать тесты**

Run: `npm run check`
Expected: exit 0, четыре `OK: лайтбокс: …`.

- [ ] **Step 7: Посмотреть в браузере**

Стенд, обе ширины. Вкладка «Фото»: тап по плитке — картинка вылетает из плитки и разворачивается на весь экран, а не проявляется из ниоткуда; закрытие (✕, Esc, клик мимо) — возвращается в ту же плитку. Листнуть лайтбокс стрелкой на соседнее фото и закрыть — летит в соседнюю плитку. Открыть фото на оси Главной (или во «Памяти») — перелёт из миниатюры оси.

Ловушка top layer: лайтбокс — модальный `<dialog>`. Если в этом Chrome картинка внутри top layer не участвует в переходе (перелёта нет, только общий crossfade) — задачу не «докручивать» обходами: отметить `DONE_WITH_CONCERNS`, приложить наблюдение и версию Chrome, открыть карточку в бэклог.

Run: `node tools/browser-check.js` → `ИТОГ: OK` (долгое нажатие не должно открывать лайтбокс и после этой задачи).

- [ ] **Step 8: Commit**

```bash
git add src/20-theme-nav.js src/85-lightbox.js src/62-global-clicks.js styles.css tests/uni-smoke.js app.js
git commit -m "Feat: плитка ⇄ лайтбокс — перелёт общим элементом (NV-56)"
```

### Task 11: Закрыть фазы 4–6 — снимки, документация, мёрж, деплой

**Files:**
- Modify: `README.md`, `PROJECT-MEMORY.md`
- Modify: `docs/superpowers/baseline/README.md`

- [ ] **Step 1: Итоговые снимки и взгляд на все экраны**

Run: `node tools/shots.js phase-6-end`. Открыть все снимки (обе темы, обе ширины). В `docs/superpowers/baseline/README.md` дописать раздел «После фаз 4–6 (дата)»: что стало с каждым пунктом раздела «Что видно» («как было») — одна строка на пункт: модалка больше не висит поверх всех экранов (`<dialog>` + шторка), двойной отпечаток fixed-элементов, пустая область под контентом, «почти невидимый» счётчик, шум на плитках галереи. Что осталось — следующим фазам (7–10), с номером карточки.

- [ ] **Step 2: README.md**

Раздел про структуру приложения: навигация, шторки, Главная («Сейчас», «Ближайшее», ось), галерея (двойные плитки, долгое нажатие, перелёт в лайтбокс). Проверить, что список модулей содержит `36-timeline.js` и `63-sheet.js`.

- [ ] **Step 3: PROJECT-MEMORY.md — снимок 0g**

Заменить подразделы `0g-4` и `0g-5` одним `## 0g. ⚡ Снимок состояния (дата) — САМЫЙ СВЕЖИЙ, читай сначала этот`, у `## 0f.` убрать пометку «САМЫЙ СВЕЖИЙ». Содержание — что изменилось в фазах 4–6 с именами функций и файлов (навигация, `<dialog>`/`openOverlay`/`closeOverlay`/`closeOverlayNow`, `setPopover`, шторка, «Сейчас», ось, решение NV-52, галерея, `lbFlyBack`, `runViewTransition` возвращает объект), плюс ловушки: `hidden` у диалогов менять только через пару; `popover` у календарика и тоста; в режиме порядка плитки одинаковые — не «чинить».

- [ ] **Step 4: Мёрж и деплой**

Run: `npm run check` → exit 0; `node tools/browser-check.js` → `ИТОГ: OK`.

```bash
git add README.md PROJECT-MEMORY.md docs/superpowers/baseline/README.md
git commit -m "Docs: фазы 4–6 — снимок 0g, README, итоги по baseline"
```

Скилл `superpowers:finishing-a-development-branch`: мёрж `redesign-phase-6` в `main`, push. `gh run list --limit 2` → оба `success`. `curl -s https://ledoksi.github.io/nasha-vselennaya/ | grep -o 'app.min.js?v=[0-9a-f]*'` — версия сменилась по сравнению с прошлым деплоем.

- [ ] **Step 5: Сказать владельцу, что проверить на телефоне**

Автоматика не видит живые телефоны и вход через Google — это приёмка фазы 10 (NV-63), но первое впечатление нужно раньше. Написать в чат коротко: что поменялось, и три вещи проверить руками на своём телефоне — шторка тянется и закрывается свайпом; долгое нажатие на фото включает выбор (и не открывает системное меню картинки); перелёт фото в лайтбокс и обратно.
