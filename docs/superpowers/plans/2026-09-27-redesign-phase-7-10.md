# Редизайн «Ночь», фазы 7–10: остальные экраны, движение, финал — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести редизайн до конца: Календарь, «Наше» и Настройки переходят на язык «Ночи» (один акцент, тихие кнопки, без эмодзи в хроме), движение получает токены и пружину, небо и ось — scroll-driven анимацию, все разделы — честные пустые экраны, загрузку и ошибки, ось Главной дочитывает прошлое из Firestore, а финальная приёмка закрывает NV-13.

**Architecture:** Всё на существующем стеке: `src/*.js` склеиваются `build.js` в `app.js`, разметка в `index.html`, стили в `styles.css` (`@layer tokens, base, components`). Новых зависимостей нет. Общие «тихие» компоненты (`.btn-ghost`, иконочная `.mini-x`) появляются в Task 2 и переиспользуются дальше. Токены движения (`--ease-spring` через `linear()`, `--dur-*`) вводятся в Task 6 вместе со стражем в `tests/uni-tokens.js`, который запрещает литеральные длительности вне слоя токенов. Пустые экраны — один помощник `emptyState()` (Task 9). Дочитывание оси — `loadAxisPage()` в `src/04-repo.js` (Task 11).

**Tech Stack:** vanilla JS (конкатенация `src/*.js` → `app.js` через `build.js` + esbuild minify), CSS без препроцессора (`<dialog>`, `popover`, `@starting-style`, View Transitions, `linear()`, `animation-timeline` — без полифилов, спека §7), тесты — самописные node-скрипты с `vm`-песочницей, Playwright для стенда (`tools/shots.js`, `tools/browser-check.js`), Lighthouse через `npx lighthouse`.

**Spec:** `docs/superpowers/specs/2026-09-21-redesign-core-audit-design.md` — раздел 1 (дизайн-система), раздел 3 целиком (движение, включая 3.3 — решение владельца без отключения анимаций), строки фаз 7–10 в таблице раздела 5, раздел 6 (тестирование). План фаз 4–6 для образца: `docs/superpowers/plans/2026-09-26-redesign-phase-4-6.md`. Итоги «как было → как стало»: `docs/superpowers/baseline/README.md`, цифры «до»: `docs/superpowers/baseline/metrics.md`.

## Global Constraints

Перенесены из плана фаз 4–6, поправлены на состояние main `e79f86c`:

- **Ни одна задача не оставляет сайт сломанным.** После каждой — `npm run check` зелёный (сборка + все тестовые файлы + eslint). Это же гоняет pre-commit хук (`.husky/pre-commit`: lint-staged → `npm run check` → `git add app.js`).
- **`app.js` коммитится собранным.** CI падает, если `git diff app.js` непустой после `node build.js`. Правим только `src/*.js`, потом пересобираем и добавляем `app.js` в тот же коммит.
- **Порядок сборки — по имени файла** (`build.js`: `readdirSync().sort()`). Все top-level `let`/`const` в одной области видимости: переменная, которую код верхнего уровня читает на старте, объявляется в `src/00-core.js` (там уже живут `loadedMonths`, `photosCursor`, `openOverlayStack`, `wishlistTab`). Функции (`function f(){}`) поднимаются — для них порядок не важен.
- **HTML в DOM — только через `html\`…\`` / `render(el, content)` из `src/00-html.js`.** Страж `tests/uni-render.js`. Ловушка: `html\`${false}\``, `${null}`, `${undefined}` → пустая строка; булево в атрибут — `String(x)`.
- **CSP не расширяется.** `font-src 'self'`, `img-src 'self' data: blob:`, никаких внешних `<link>`. Иконки — Phosphor (стиль fill), вшиты `<symbol>` в спрайт `index.html`.
- **Токены цвета — только OKLCH в `@layer tokens`.** Страж `tests/uni-tokens.js`. Относительные цвета от токенов (`oklch(from var(--night) l c h / .5)`) разрешены. `border-radius:50%` разрешён стражем.
- **Один акцент на весь сайт:** `--star` (мелкий текст — `--star-ink`). Им красятся: активная вкладка, первичная кнопка, точка «сейчас», фокус, выбранный день. **Не** им: вторичные кнопки, пунктирные рамки-декор, подписи событий в календаре. Фиолетовый `--night` — фон и линии. Розовый — только праздник.
- **Шкала формы:** интерактивное `var(--radius-pill)`, карточка `var(--radius-card)`, поле `var(--radius-field)`, медиа `var(--radius-media)`, шторка `var(--radius-sheet)` сверху и `0` снизу.
- **Эмодзи уходят из хрома интерфейса** — заголовки экранов и шторок, подписи кнопок, подсказки. **Остаются:** эмодзи, которые выбрал человек (у события, свидания), комплименты дня, праздничные строки («Мы идём на свидание!»), логотип `💜 Наша вселенная`, летающие сердечки и конфетти.
- **Тёмная тема — основная.** Каждый снимок проверяется в обеих.
- **Никакого `prefers-reduced-motion` и тумблера анимаций** (решение владельца, спека 3.3). До Task 6 длительности пишутся литералами; начиная с Task 6 — только токенами `--dur-*`/`--ease-*`, литерал вне слоя токенов роняет `tests/uni-tokens.js`.
- **Ноль обработчиков `scroll` на JS** (спека 3.2). С Task 7 это проверяет страж в `tests/uni-render.js`.
- **Ничего в `tools/` не попадает в прод.** `deploy-pages.yml` копирует явный список файлов.
- **`CACHE_NAME` в `sw.js` руками не бампается** — версию проставляет `tools/stamp-version.js` на деплое.
- **Скриншоты в репозиторий не коммитятся** (`docs/superpowers/baseline/**/*.png` в `.gitignore`). В git — только выводы.
- **Язык интерфейса и комментариев — русский.**
- **Фаза = своя ветка, свой мёрж и деплой** (спека §5): `redesign-phase-7`, `redesign-phase-8`, `redesign-phase-9`, `redesign-phase-10`, каждая от `main`, в который уже влита предыдущая. Закрытие фазы — отдельная задача (Task 5, 8, 12, 14).
- **Снимки.** Перед первой задачей фазы: `node tools/serve.js` (отдельное окно) и `node tools/shots.js phase-N-start`. После каждой задачи: `node tools/shots.js task-K` и `node tools/shots-diff.js phase-N-start task-K`. Список `DIFF:` должен совпадать с тем, что задача собиралась поменять; лишняя строка — регрессия, её разбирают до коммита. Изменившиеся снимки **смотрятся глазами** в обеих темах и обеих ширинах, вывод — одна-две строки в отчёте задачи. Сравнение — в пределах одного календарного дня.
- **Тесты-песочницы видят `hidden`, а не `open`.** Диалоги открывать/закрывать только `openOverlay/closeOverlay(Now)`. Новый попап — только через `setPopover`.
- **`tools/browser-check.js` — приёмочный тест жестов и клавиатуры.** Запускается (при поднятом `tools/serve.js`) в конце каждой задачи, которая трогает «Наше», галерею, модалки, датапикер или движение. Итог — `ИТОГ: OK`.

### Уроки фаз 4–6 (обязательны, это то, на чём ловили ревью)

Каждая из трёх прошлых фаз прошла по-задачным ревью чистой, а финальное ревью всей ветки всё равно находило 6–9 настоящих дефектов (фиксы F1–F8, G1–G9, H1–H6 в истории main). Повторялись одни и те же классы:

1. **TDZ на старте** (`8fb3dd0`): top-level переменная в позднем файле, прочитанная при раннем старте по прямой ссылке `#/notes`. Правило про `00-core.js` выше. Новая top-level переменная → вопрос «кто её читает при загрузке» до коммита.
2. **Специфичность перебивает новое правило** (`f9669e5`: `.axis-day .tl-card` перебил стекло; NV-97: `.overlay:not(.lightbox) .modal` перебивает `.event-modal{padding:0}`). Перед правкой компонента — `grep` по его классу во всём `styles.css`, после правки — вычисленный стиль в браузере (`getComputedStyle` через `page.evaluate`), а не только исходник.
3. **Телефон первым** (`f4a5883`, `b616892`, `1f65293`): числа, подобранные на десктопе, не переносятся на 390 px; жесты Android отличаются от мыши стенда. Каждая визуальная задача сначала смотрит `phone-*` снимки. Всё, что стенд проверить не может, записывается в раздел «Проверить на живом телефоне» отчёта задачи — оттуда оно попадёт в Task 14.
4. **Тест, который не может упасть** (`59023ba`; `'до годовщины'` в регистрозависимом `includes` пропускал `'До годовщины'` в aria-label). Шаг «запустить и увидеть FAIL» в каждой задаче обязателен: тест проверяется на сломанном коде, а не только на починенном.
5. **Документация врёт о коде** (`34c8d70`, `e79f86c`). Каждое утверждение о поведении в README/PROJECT-MEMORY называет функцию или файл и проверяется `grep`-ом до коммита.
6. **Журнал исполнения теряется вместе с worktree.** Журнал SDD фаз 4–6 (`.superpowers/sdd/…`) удалился вместе с `.claude/worktrees/redesign-phase-4`, хвосты пришлось собирать заново. Перед удалением worktree фазы: скопировать `.superpowers/sdd/2026-09-27-redesign-phase-7-10/` в основной checkout (папка в `.gitignore`, в git не идёт, но переживает worktree).
7. **Финальное ревью ветки — до мёржа, а не после.** Закрывающая задача каждой фазы запускает ревью всей ветки (`superpowers:requesting-code-review` на диапазон `main..HEAD`), фиксы идут отдельными коммитами с метками `I1…` (фаза 7), `J1…` (8), `K1…` (9), `L1…` (10), и только потом мёрж.

---

## Файловая структура

| Файл | Ответственность | Статус |
|---|---|---|
| `tools/shots.js` | Снимки + два новых состояния: календарь с выбранным днём, шторка «Добавить дату»; без размытия фона диалога | правится |
| `tools/browser-check.js` | Громкий guard вместо молчаливого; новые проверки: лайтбокс за экраном, клавиатура (Esc, датапикер, тост, «Наше» стрелками) | правится |
| `index.html` | Календарь, «Наше», Настройки, шторки; иконки `icon-our`, `icon-offline`; скелетон загрузки | правится |
| `styles.css` | `.btn-ghost`, тихая `.mini-x`, экраны фазы 7; токены движения; scroll-driven; пустые экраны, скелетоны | правится |
| `src/40-calendar.js` | Ячейки, панель дня, «Ближайшее» одной кнопкой, загрузка/ошибка месяца | правится |
| `src/42-datepicker.js` | `returnDpFocus`, `onDatePopDocEscape` | правится |
| `src/43-event-modal.js` | Тексты шторки события | правится |
| `src/50-notes.js`, `src/60-lists.js`, `src/61-wishes.js` | «Наше» на новых компонентах | правятся |
| `src/80-settings.js`, `src/96-push.js` | Настройки без карточки темы, тексты | правятся |
| `src/20-theme-nav.js` | `go()` не пишет `#/undefined`; иконка «Наше»; `emptyState`; roving tabindex «Наше»; `onOffline` | правится |
| `src/00-core.js` | `freshPhotoIds`, состояние оси (`axisEventsLoaded`, `axisPhotosCursor`, `axisPhotosDone`, `axisLoading`); порядок в `notify` | правится |
| `src/01-gate.js` | `showBootSkeleton` | правится |
| `src/04-repo.js` | `loadAxisPage`, `axisHasMore` | правится |
| `src/35-memory.js`, `src/36-timeline.js` | Стабильные id групп фото, память раскрытых рядов, дочитывание оси, клавиатура у миниатюр | правятся |
| `src/62-global-clicks.js` | `onEmptyActionClick` | правится |
| `src/70-photos.js`, `src/71-photo-grid.js` | Свежие фото пружиной, скелетон-плитки, ошибки загрузки | правятся |
| `src/85-lightbox.js` | Не лететь за экран; порядок стрелок = визуальный порядок сетки | правится |
| `tests/uni-smoke.js`, `tests/uni-hash.js`, `tests/uni-repo.js`, `tests/uni-dnd.js`, `tests/uni-photo-sync.js`, `tests/uni-tokens.js`, `tests/uni-render.js`, `tests/fs-mock.js` | Новые проверки, тихий вывод, стражи движения и scroll | правятся |
| `README.md`, `PROJECT-MEMORY.md`, `docs/superpowers/baseline/README.md`, `docs/superpowers/baseline/metrics.md` | Снимки 0h/0i/0j/0k, итоги по baseline, цифры «после» | правятся |

---

# ФАЗА 7 — Остальные экраны

Ветка `redesign-phase-7` от `main`. Перед Task 1: `node tools/serve.js` в отдельном окне. Снимок `phase-7-start` делается **в конце** Task 1 (после того как стенд научится снимать новые состояния), а не до неё.

Экраны «как было» сняты 27.09.2026 (`docs/superpowers/baseline/before-phase-7/`). Что отстало — по снимкам:

- **Календарь.** Три янтарные кнопки подряд (на телефоне — три полосы на всю ширину), плюс янтарная плашка «Ближайшее». На десктопе квадратные ячейки по 148 px — сетка месяца занимает 800 px высоты. Месяц и год — янтарным текстом. Ячейка со свиданием обведена тем же янтарём, что и «сегодня». Шторка «Добавить дату» — сплошная янтарная шапка.
- **«Наше».** Заголовки «📋 Списки» и «🎁 Хотелки» дублируют переключатель. «＋ Создать список» на телефоне ломается в три строки. На каждой заметке и каждом пункте списка по четыре кнопки с рамками. Красная «✔ Выполнить список» на каждой карточке. Хотелка без фото — пустой блок 16:9 с эмодзи. На десктопе секции хотелок ужаты в колонки по 220 px: `#wishlistGrid` сам имеет класс `.wishlist-grid` и раскладывает секции как плитки.
- **Настройки.** Эмодзи в каждом заголовке, текст про «шифровать больше не нужно» (эпоха сейфа), карточка «Оформление» дублирует кнопку темы в шапке, красная «Выйти», голый чекбокс уведомлений. Кнопка темы в шапке — янтарная `.btn`, спорит с активной вкладкой.

### Task 1: Стенд под фазы 7–10

Прошлые фазы теряли время на три вещи стенда: снимок `*-home-invite.png` расходится на ±1 от размытия фона диалога и каждый раз засоряет список `DIFF:`; вывод `npm run check` засыпан ожидаемыми предупреждениями `[photo-sync]`, среди которых не видно настоящих; `browser-check` молча пропускал закрытие приглашения, если функции нет. Плюс фазе 7 нужны снимки состояний, которых стенд не снимает: календарь с выбранным днём и шторка «Добавить дату».

**Files:**
- Modify: `tools/shots.js`
- Modify: `tools/browser-check.js:228-231`
- Modify: `tests/uni-smoke.js:311-358`
- Modify: `tests/uni-photo-sync.js` (параметры `new Function(…)` и вызов `wrapped(…)`, строки ~296-330)

**Interfaces:**
- Produces: снимки `{phone,desk}-{dark,light}-calendar-day.png` и `…-sheet-event.png` — ими проверяются Task 2 и Task 4.

- [ ] **Step 1: Стабильный снимок приглашения**

В `tools/shots.js` дописать в строку `HIDE_FLAKY` правило, снимающее размытие фона у диалогов:

```js
const HIDE_FLAKY =
  '#appToast{display:none!important}*,*::before,*::after{animation:none!important;transition:none!important}' +
  // Размытие под ::backdrop растеризуется с шумом ±1 между прогонами —
  // *-home-invite.png расходился сам с собой (NV-97). Затемнение остаётся.
  '.overlay::backdrop{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}';
```

- [ ] **Step 2: Два новых состояния**

В `tools/shots.js` у функции `shot` появляется второй параметр — снимок на всю страницу или только экран (шторка `position:fixed`, на `fullPage` она оказалась бы посреди длинной страницы):

```js
      const shot = (name, fullPage = true) =>
        page.screenshot({
          path: path.join(dir, sizeName + '-' + theme + '-' + name + '.png'),
          fullPage,
          animations: 'disabled',
          mask: [page.locator('#countdownTick')]
        });
```

После цикла `for (const v of VIEWS) { … }` и до `await page.close();`:

```js
      // Фаза 7: панель выбранного дня и шторка «Добавить дату» — половина
      // перерисовки Календаря, без этих кадров её не видно. День — первый с
      // событием в текущем месяце, иначе сегодняшний.
      await page.evaluate(() => {
        go('calendar');
        const cell = [...document.querySelectorAll('#calendar .cal-cell[data-day]')].find(c => c.querySelector('.cal-dot')) || document.querySelector('#calendar .cal-cell.today');
        selectedDate = cell.dataset.day;
        renderCalendar();
      });
      await page.waitForTimeout(400);
      await shot('calendar-day');
      await page.evaluate(() => openEventModal());
      await page.waitForTimeout(400);
      await shot('sheet-event', false);
      await page.evaluate(() => closeOverlay('eventOverlay'));
```

- [ ] **Step 3: Проверить детерминизм**

Run: `node tools/shots.js t1-a` и сразу `node tools/shots.js t1-b`, затем `node tools/shots-diff.js t1-a t1-b`
Expected: `OK: 40 снимков совпали побайтно` (7 экранов + home-invite + calendar-day + sheet-event = 10 × 2 ширины × 2 темы). Открыть глазами `phone-dark-calendar-day.png` (под сеткой — панель дня с событием) и `phone-dark-sheet-event.png` (шторка снизу экрана).

- [ ] **Step 4: Тихий вывод тестов**

В `tests/uni-smoke.js` и `tests/uni-photo-sync.js` приложение получает свою консоль, которая глушит только ожидаемые предупреждения синхронизации фото (эти тесты нарочно работают без сети). В обоих файлах в список параметров `new Function(` после `'fetch',` добавить `'console',`, а в вызов `wrapped(` последним аргументом — `quietConsole`. Перед `const wrapped` в каждом файле:

```js
// Облака в этом тесте нет по построению — ожидаемые «[photo-sync] …» из
// src/95-photos-*.js только засыпали вывод npm run check, и в нём терялись
// настоящие предупреждения (NV-97). Глушим ровно этот префикс.
const quietConsole = Object.assign(Object.create(console), {
  warn: (...a) => {
    if (!String(a[0]).startsWith('[photo-sync]')) console.warn(...a);
  }
});
```

Run: `npm run check 2>&1 | grep -c "photo-sync"`
Expected: `0`

- [ ] **Step 5: Громкий guard в browser-check**

В `tools/browser-check.js` блок перед первыми проверками:

```js
    await page.evaluate(() => {
      document.startViewTransition = undefined;
      // Раньше: if (typeof closeOverlay === 'function') — после переименования
      // функции приглашение молча оставалось открытым, и все клики ниже
      // упирались в его ::backdrop с непонятной ошибкой (NV-97).
      if (typeof closeOverlay !== 'function') throw new Error('closeOverlay не найдена — приглашение нечем закрыть');
      closeOverlay('dateInviteOverlay');
    });
```

Run: `node tools/browser-check.js` → `ИТОГ: OK`

- [ ] **Step 6: Базовый снимок фазы и коммит**

Run: `node tools/shots.js phase-7-start`

```bash
git add tools/shots.js tools/browser-check.js tests/uni-smoke.js tests/uni-photo-sync.js
git commit -m "Tools: снимки дня календаря и шторки, стабильный home-invite, тихий вывод тестов (фаза 7, NV-97)"
```

### Task 2: Календарь на новых токенах (NV-57)

**Files:**
- Modify: `index.html:117-136` (секция календаря), `index.html:237-269` (шторка события)
- Modify: `styles.css` — разделы «Общее», «Календарь», «Оверлеи / модалки», «Адаптив»
- Modify: `src/40-calendar.js` — `renderCalendar`, `renderDayPanel`, `updateNearestJump`, `jumpToNearestEvent`
- Modify: `src/42-datepicker.js` — `pickDpDate`, `datePopKeydown`, document-level Esc
- Modify: `src/43-event-modal.js:19-21`
- Test: `tests/uni-smoke.js` (календарь, датапикер), `tests/uni-dnd.js:309` (PREIDS)

**Interfaces:**
- Produces (для Task 3, 4, 9): классы `.btn-ghost` (вторичная кнопка-пилюля: прозрачная, рамка `--line`, текст `--ink`) и `.btn-ghost.danger` (текст `--danger-ink`); `.mini-x` становится иконочной кнопкой 32×32 без рамки; удаление везде рисуется `navIconHtml('trash')` с `aria-label="Удалить"`.
- Produces: `returnDpFocus(el)`, `onDatePopDocEscape(e)` в `src/42-datepicker.js`.
- Удаляется: элемент `#jumpInfo`. Его роль берёт `#jumpNextBtn`: кнопка сама говорит, куда ведёт.

- [ ] **Step 1: Тесты на новое поведение (красные)**

В `tests/uni-smoke.js` блок «Календарь: «⏭ К ближайшему событию»» (строки ~768-790) заменить целиком:

```js
  // --- Календарь: «Ближайшее» — одна кнопка, сама говорит, куда ведёт (фаза 7) ---
  w('(s)=>{const d=new Date();s.db.events.push({id:"nx1",title:"Ближайшее событие",date:s.iso(d.getFullYear(),d.getMonth(),d.getDate()),emoji:"🎈",repeat:false});}');
  const nx = w('(s)=>{const r=s.nextUpcoming();if(!r)return null;const [yy,mm]=r.date.split("-").map(Number);s.jumpToNearestEvent();return {date:r.date,title:r.title,m:mm-1,y:yy};}');
  assert(nx && nx.date !== undefined, 'nextUpcoming: есть ближайшее событие/свидание');
  assert(registry['#calMonthSelect'].value === String(nx.m) && registry['#calYearSelect'].value === String(nx.y), 'кнопка переключила календарь на месяц ближайшего события');
  assert(w('(s)=>s.selectedDate') === nx.date, 'после прыжка выделен день ближайшего события');
  assert(registry['#jumpNextBtn'].hidden === true, 'в месяце ближайшего события кнопки нет');
  w('(s)=>{s.jumpCalendar(0,2026);}');
  assert(registry['#jumpNextBtn'].hidden === false, 'в другом месяце кнопка видна');
  assert(registry['#jumpNextBtn'].textContent.includes(nx.title) && registry['#jumpNextBtn'].textContent.startsWith('Ближайшее:'), 'кнопка называет ближайшее событие');
  w('(s)=>{s.db.events.push({id:"far27",title:"Событие 2027",date:"2027-01-15",emoji:"🚀",repeat:false});s.jumpCalendar(0,2027);}');
  assert(registry['#jumpNextBtn'].hidden === false, 'кнопка видна и в месяце со своими событиями, если ближайшее не здесь');
  w('(s)=>s.jumpToNearestEvent()');
  assert(w('(s)=>s.selectedDate') === nx.date, 'клик снова прыгает к ближайшему событию');
  assert(registry['#jumpNextBtn'].hidden === true, 'после возврата кнопка скрыта');
```

Там же, сразу после `assert(... 'после выделен день начала события')` (строка ~757) — проверки ячейки и панели дня:

```js
  // Фаза 7: свидание в ячейке не обводится акцентом (он у «сегодня»), удаление — иконкой корзины
  assert(!registry['#calendar'].innerHTML.includes('has-date'), 'ячейка со свиданием без акцентной рамки has-date');
  assert(registry['#dayPanel'].innerHTML.includes('#icon-trash') && registry['#dayPanel'].innerHTML.includes('aria-label="Удалить"'), 'удаление события — иконка корзины с подписью');
```

В блок датапикера, сразу после `assert(registry['#datePop'].hidden === true, 'Esc закрывает попап');` (строка ~655):

```js
  // Фаза 7 (NV-97): Esc возвращает фокус в поле под заслонкой dpSuppressReopen —
  // без неё focus-слушатель поля тут же открывал календарик заново.
  sandbox.__escField = { value: '', dispatchEvent() {}, focus() { sandbox.__escField.suppressed = sandbox.dpSuppressReopen; } };
  w('(s)=>{s.openDatePop(s.__escField); s.datePopKeydown({key:"Escape",preventDefault(){}}); return 1;}');
  assert(sandbox.__escField.suppressed === true, 'Esc в сетке дней: фокус вернулся в поле, попап не откроется заново');
  w('(s)=>{s.openDatePop(s.__escField); s.__escField.suppressed = undefined; s.onDatePopDocEscape({key:"Escape",preventDefault(){}}); return 1;}');
  assert(registry['#datePop'].hidden === true && sandbox.__escField.suppressed === true, 'Esc с фокуса вне сетки (месяц, год, стрелки): попап закрыт, фокус вернулся в поле');
  delete sandbox.__escField;
```

В суффикс экспортов (рядом с `s.datePopKeydown = datePopKeydown;`, строка ~253):

```js
  s.onDatePopDocEscape = onDatePopDocEscape;
  Object.defineProperty(s, 'dpSuppressReopen', { get: () => dpSuppressReopen, configurable: true });
```

В `tests/uni-dnd.js` из массива `PREIDS` удалить строку `'jumpInfo',`.

Run: `node build.js && node tests/uni-smoke.js app.js`
Expected: FAIL на первой новой проверке («кнопка называет ближайшее событие» или `onDatePopDocEscape is not defined`).

- [ ] **Step 2: Датапикер — возврат фокуса под заслонкой**

В `src/42-datepicker.js` сразу после объявления `let dpSuppressReopen = false;`:

```js
// Программный возврат фокуса в поле — всегда под заслонкой: иначе
// focus-слушатель поля (конец файла) открывает календарик заново.
function returnDpFocus(el) {
  if (!el || !el.focus) return;
  dpSuppressReopen = true;
  el.focus();
  dpSuppressReopen = false;
}
```

В `pickDpDate` блок `if (el && el.focus) { dpSuppressReopen = true; el.focus(); dpSuppressReopen = false; }` заменить на `returnDpFocus(el);`.

В `datePopKeydown` ветку Esc:

```js
  if (e.key === 'Escape') {
    const el = dpInput;
    closeDatePop();
    returnDpFocus(el);
    if (e.preventDefault) e.preventDefault();
    return;
  }
```

Анонимный document-level обработчик Esc заменить именованным (тест дёргает его напрямую — в песочнице `document.addEventListener` обработчики не хранит):

```js
// Esc с фокуса вне #dpDays (месяц, год, стрелки, «Сегодня», «Очистить») —
// datePopKeydown висит только на сетке дней, этот ловит остальное.
function onDatePopDocEscape(e) {
  if (e.key !== 'Escape') return;
  const pop = $('#datePop');
  if (!pop || pop.hidden) return;
  const el = dpInput;
  closeDatePop();
  returnDpFocus(el);
  // preventDefault гасит default action Escape у модального <dialog>-родителя
  // (fire cancel) — иначе модалка закрылась бы тем же нажатием.
  e.preventDefault();
}
document.addEventListener('keydown', onDatePopDocEscape);
```

- [ ] **Step 3: «Ближайшее» — одна кнопка**

`src/40-calendar.js`, `updateNearestJump` целиком:

```js
// «Ближайшее»: кнопка видна, только когда ближайшее событие/свидание НЕ в
// показываемом месяце, и сама говорит, куда ведёт (фаза 7: раньше были
// отдельные кнопка «⏭ К ближайшему событию» и плашка с описанием).
function updateNearestJump() {
  const btn = $('#jumpNextBtn');
  if (!btn) return;
  const nx = nextUpcoming();
  const [y, m, d] = nx ? nx.date.split('-').map(Number) : [];
  btn.hidden = !nx || (y === calY && m - 1 === calM);
  if (btn.hidden) return;
  const year = y !== new Date().getFullYear() ? ' ' + y : '';
  btn.textContent = `Ближайшее: ${nx.emoji} ${nx.title} · ${d} ${MONTHS_GEN[m - 1]}${year} →`;
}
```

`jumpToNearestEvent` — ветку `if (!nx) { … }` заменить на `if (!nx) return; // кнопка без ближайшего скрыта, сюда не попасть`. Строку `const info = $('#jumpInfo');` удалить.

- [ ] **Step 4: Разметка календаря**

`index.html`, секция `#view-calendar` целиком:

```html
    <section class="view" id="view-calendar">
      <div class="cal-head">
        <div class="cal-nav-row">
          <button class="cal-nav" id="calPrev" aria-label="Предыдущий месяц">‹</button>
          <div class="cal-jump-row">
            <select class="cal-jump" id="calMonthSelect" aria-label="Выбрать месяц"></select>
            <select class="cal-jump cal-jump-year" id="calYearSelect" aria-label="Выбрать год"></select>
          </div>
          <button class="cal-nav" id="calNext" aria-label="Следующий месяц">›</button>
        </div>
        <div class="cal-actions">
          <button class="btn" id="addEventBtn">＋ Добавить дату</button>
          <button class="btn btn-ghost" id="exportIcsBtn" title="Скачать памятные даты файлом .ics — импортируется в календарь телефона, там реально приходят напоминания" aria-label="Скачать даты файлом .ics"><svg class="nav-icon" aria-hidden="true"><use href="#icon-download"></use></svg>.ics</button>
        </div>
      </div>
      <button type="button" class="cal-jump-info" id="jumpNextBtn" hidden></button>
      <div class="calendar" id="calendar"></div>
      <div class="day-panel" id="dayPanel"></div>
    </section>
```

- [ ] **Step 5: Панель дня**

`src/40-calendar.js`, `renderDayPanel`:
- подсказка без выбранного дня: `html\`<p class="cal-tip">Нажми на день, чтобы посмотреть события или добавить новое.</p>\``;
- кнопка удаления события: `<button class="mini-x" data-del-event="${e.id}" title="Удалить" aria-label="Удалить">${navIconHtml('trash')}</button>`;
- у остальных `.mini-x` панели (`data-photo-event`, `data-edit-event`, `data-edit-date`, `data-done-date`, `data-photo-date`) добавить `aria-label`, равный их `title`;
- кнопка удаления свидания — так же, как у события (`data-del-date`, корзина, `aria-label="Удалить"`);
- `html\`<div class="day-sub">💘 Свидания</div>\`` → `html\`<div class="day-sub">Свидания</div>\``;
- `html\`<div class="day-head"><b>${fmtDate}</b></div>\`` → `html\`<h3 class="day-head">${fmtDate}</h3>\``.

В `renderCalendar` из вычисления `cls` убрать `${dts.length ? ' has-date' : ''}`.

- [ ] **Step 6: Шторка события — без янтарной шапки**

`src/43-event-modal.js:19-21`:

```js
  $('#evModalTitle').textContent = editingEventId ? 'Изменить дату' : 'Памятная дата';
  const sub = $('#evHeadSub');
  if (sub) sub.textContent = editingEventId ? 'Поправь детали — всё сохранится' : 'Важный день для вас двоих';
```

В `index.html` в `#eventOverlay`: `<h3 id="evModalTitle">Памятная дата</h3>`, `<p class="ev-head-sub" id="evHeadSub">Важный день для вас двоих</p>`, кнопка фото `<label class="btn btn-ghost file-btn">Добавить фото<input …></label>`, кнопка сохранения `<button class="btn ev-save" id="evSave">Сохранить</button>`, у крестика `aria-label="Закрыть"`.

- [ ] **Step 7: CSS**

`styles.css`, раздел «Общее» — после `.btn-danger{…}`:

```css
/* Вторичная кнопка (фаза 7): акцент один — у первичной .btn, всё остальное
   тихо. .danger — разрушительное действие, которое не должно кричать. */
.btn-ghost{background:transparent;color:var(--ink);border:1px solid var(--line);box-shadow:none}
.btn-ghost:hover{border-color:var(--star)}
.btn-ghost.danger{color:var(--danger-ink)}
.btn-ghost.danger:hover{border-color:var(--danger-ink)}
```

Раздел «Календарь» — заменить правила `.cal-jump`, `.cal-jump:hover`, `.cal-jump-info`, `.cal-cell.has-date`, `.cal-dot`, `.cal-dot-more`, `.cal-cell.in-span .cal-num`, `.day-sub`, `.date-evt`, `.day-head`, `.day-add input`, `.mini-x`, `.mini-x:hover`:

```css
/* Месяц и год — заголовок экрана, дисплейной гарнитурой; селект без рамки */
.cal-jump{
  appearance:none;-webkit-appearance:none;border:0;background:transparent;padding:0 4px;
  font-family:var(--font-display);font-size:var(--text-display);line-height:1.1;color:var(--ink);cursor:pointer;
}
.cal-jump-year{color:var(--ink-2)}
.cal-jump:hover{color:var(--star-ink)}
/* «Ближайшее: …» — кнопка-строка, тихая: ведёт к событию, не зовёт */
.cal-jump-info{
  display:block;width:100%;margin:-4px 0 14px;padding:10px 14px;text-align:left;cursor:pointer;
  background:var(--sky-1);border:1px solid var(--line);border-radius:var(--radius-card);
  font:inherit;font-size:var(--text-sm);font-weight:700;color:var(--ink-2);
}
.cal-jump-info:hover{border-color:var(--star);color:var(--ink)}
.cal-jump-info[hidden]{display:none}
.cal-cell.in-span{background:var(--sky-2)}
.cal-dot{
  font-size:var(--text-xs);line-height:1.15;max-width:100%;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;padding:0 4px;border-radius:var(--radius-pill);background:var(--sky-2);color:var(--ink);
}
.cal-dot-more{background:var(--line);color:var(--ink)}
.day-head{font-family:var(--font-display);font-size:var(--text-xl);font-weight:600;margin-bottom:12px}
.day-sub{font-size:var(--text-xs);font-weight:700;letter-spacing:.08em;color:var(--ink-2);text-transform:uppercase;margin:16px 0 8px}
.day-add input{flex:1;min-width:140px}
.day-add #dayEmoji{flex:none;min-width:0;width:56px;text-align:center}
/* Иконочная кнопка действия (фаза 7): без рамки — на карточке их по три-четыре,
   рамки превращали каждую в шум (как крестики на плитках галереи до фазы 6).
   32×32 — ближе к пальцу, чем было 26. */
.mini-x{
  display:inline-flex;align-items:center;justify-content:center;flex:none;
  width:32px;height:32px;border:0;border-radius:var(--radius-pill);background:transparent;
  cursor:pointer;font-size:var(--text-sm);color:var(--ink-2);transition:background .2s,color .2s;
}
.mini-x:hover{background:var(--sky-2);color:var(--ink)}
.mini-x[data-del-event]:hover,.mini-x[data-del-date]:hover,.mini-x[data-del-note]:hover,.mini-x[data-del-item]:hover,.mini-x[data-wish-del]:hover{background:oklch(from var(--danger) l c h / .16);color:var(--danger-ink)}
```

Удалить целиком: `.cal-cell.has-date{…}`, `.date-evt{…}` (строка `.date-evt{background:var(--sky-2);border:1px dashed var(--star)}`), `.cal-cell.in-span .cal-num{…}`.

Десктоп — ячейки не квадратные (в разделе «Адаптив», новым блоком):

```css
/* Десктоп (фаза 7): квадратная ячейка шириной 148 px растягивала месяц на
   800 px высоты. Ячейка-строка: число сверху слева, события под ним. */
@media(min-width:821px){
  .cal-cell:not(.cal-dow){aspect-ratio:auto;min-height:88px;padding:8px;align-items:flex-start;justify-content:flex-start;gap:4px}
}
```

Телефон — в блоке `@media(max-width:480px)` удалить `.cal-actions{flex-direction:column}` и `.cal-actions .btn{width:100%;justify-content:center}`, добавить:

```css
  .cal-actions{flex-wrap:nowrap}
  .cal-actions #addEventBtn{flex:1;justify-content:center}
```

Шторка события — раздел «Оверлеи / модалки», заменить `.ev-head`, `.ev-head h3`, `.ev-head-sub`, `.event-modal .modal-x`, `.event-modal .modal-x:hover`:

```css
.ev-head{flex:none;padding:22px 26px 16px;border-bottom:1px solid var(--line)}
.ev-head h3{font-family:var(--font-display);font-size:var(--text-xl);font-weight:600}
.ev-head-sub{color:var(--ink-2);font-size:var(--text-sm);margin-top:2px}
.event-modal .modal-x{top:16px;right:16px;z-index:2}
```

`.ev-note` — рамку `1px dashed var(--star)` заменить на `1px dashed var(--line)`.

Лишний нижний отступ шторки события (NV-97): `.overlay:not(.lightbox) .modal` в медиазапросе ≤820 px ставит `padding-bottom` всем модалкам и перебивает `.event-modal{padding:0}` (у неё прокручивается `.ev-body`, не сам `.modal`). Внутри того же `@media (max-width:820px)` после правила `.overlay:not(.lightbox) .modal{…}`:

```css
  .overlay:not(.lightbox) .event-modal{padding-bottom:0}
  .event-modal .ev-body{padding-bottom:calc(26px + env(safe-area-inset-bottom))}
```

Проверка специфичности (урок 2): `grep -n "event-modal\|\.modal{" styles.css` — других правил, задающих `padding` у `.event-modal`, нет.

- [ ] **Step 8: Прогон**

Run: `npm run check`
Expected: exit 0, все `OK`.

Run: `node tools/shots.js task-2 && node tools/shots-diff.js phase-7-start task-2`
Expected: `DIFF:` только `*-calendar.png`, `*-calendar-day.png`, `*-sheet-event.png` (12 строк). Глазами, сначала `phone-*`: на телефоне под «‹ Сентябрь 2026 ›» одна строка «＋ Добавить дату» + тихая «.ics»; на десктопе месяц ниже 600 px; в шторке нет янтарной шапки, нижний край без лишней полосы; в панели дня удаление — корзина.

Вычисленный стиль (урок 2): `node -e` не нужен — в DevTools стенда или через `page.evaluate`: `getComputedStyle(document.querySelector('#eventOverlay .modal')).paddingBottom` на ширине 390 → `0px`.

Run: `node tools/browser-check.js` → `ИТОГ: OK`

- [ ] **Step 9: Commit**

```bash
git add index.html styles.css src/40-calendar.js src/42-datepicker.js src/43-event-modal.js tests/uni-smoke.js tests/uni-dnd.js app.js
git commit -m "Feat: Календарь на новых токенах — одна первичная кнопка, «Ближайшее» кнопкой, тихая панель дня, шторка без янтарной шапки (NV-57)"
```

### Task 3: «Наше» — Заметки, Списки, Хотелки (NV-58)

**Files:**
- Modify: `index.html:31-50` (спрайт), `index.html:139-166` (три секции)
- Modify: `styles.css` — разделы «Заметки», «Списки», «Вишлист», «Дополнительно»
- Modify: `src/20-theme-nav.js` — `BOTTOM_ICON`
- Modify: `src/50-notes.js` — `noteAuthorName`, `renderNotes`
- Modify: `src/60-lists.js` — `listItemHTML`, `listCardHTML`, `renderListItems`
- Modify: `src/61-wishes.js` — `wishToggleHTML`, `wishCard`, `renderWishlist`
- Test: `tests/uni-smoke.js` (заметки ~803, хотелки ~830-860, списки ~866-875)

**Interfaces:**
- Consumes: `.btn-ghost`, `.mini-x`, `navIconHtml('trash')` из Task 2.
- Produces: `<symbol id="icon-our">` в спрайте (Task 13 не трогает).

- [ ] **Step 1: Тесты (красные)**

`tests/uni-smoke.js`, блок заметок: `assert(notesHtml.includes('👦 Гоша') && notesHtml.includes('👧 Даша'), …)` →

```js
  assert(notesHtml.includes('>Гоша<') && notesHtml.includes('>Даша<') && !notesHtml.includes('👦'), 'в заметке виден автор — именем, без эмодзи');
  assert(notesHtml.includes('#icon-trash'), 'удаление заметки — иконкой корзины');
```

Блок списков, после `assert(listsHtml.includes('data-list-complete="L1"'), …)`:

```js
  assert(!listsHtml.includes('btn-danger'), '«Выполнить список» — тихая кнопка, не красная');
```

и после добавления подзадачи «Купить цветы» (`assert(... 'текст подзадачи сохранён')`):

```js
  w('(s)=>{s.renderLists();return 1;}');
  assert(registry['#listsWrap'].innerHTML.includes('aria-pressed="false"'), 'галочка подзадачи — кнопка-переключатель с aria-pressed, а не эмодзи ○/✅');
```

Блок хотелок, после `assert(wishHtml.includes('wish-link'), …)`:

```js
  assert(!wishHtml.includes('💝'), 'хотелка без фото — без пустой картинки-заглушки');
  assert(!wishHtml.includes('👦') && !wishHtml.includes('👧'), 'переключатель и заголовки хотелок без эмодзи');
```

Run: `node build.js && node tests/uni-smoke.js app.js`
Expected: FAIL «в заметке виден автор — именем, без эмодзи».

- [ ] **Step 2: Иконка «Наше»**

В спрайт `index.html` после `<symbol id="icon-check" …>` (Phosphor `squares-four-fill`, MIT):

```html
<symbol id="icon-our" viewBox="0 0 256 256"><path d="M120,56v48a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V56A16,16,0,0,1,56,40h48A16,16,0,0,1,120,56Zm80-16H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm-96,96H56a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,104,136Zm96,0H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,200,136Z"/></symbol>
```

`src/20-theme-nav.js`, `BOTTOM_ICON`: `our: navIconHtml('notes')` → `our: navIconHtml('our')` (NV-97: «Наше» — это три экрана, иконка заметок врала про два из них).

- [ ] **Step 3: Заметки**

`src/50-notes.js`:

```js
function noteAuthorName(n) {
  return n.author === 'dasha' ? 'Даша' : n.author === 'gosha' ? 'Гоша' : 'Наши';
}
```

В `renderNotes` кнопка удаления: `<button class="mini-x" data-del-note="${n.id}" title="Удалить" aria-label="Удалить">${navIconHtml('trash')}</button>`; у pin и edit добавить `aria-label`, равный `title`. В режиме правки: `<button class="btn btn-sm" data-save-note="${n.id}">Сохранить</button>` и `<button class="mini-x" data-cancel-note title="Отмена" aria-label="Отмена">✕</button>`.

`index.html`, `#view-notes`: `<button class="btn" id="noteAddBtn">Добавить</button>`, плейсхолдер `Напиши что-нибудь нежное… (Ctrl+Enter — добавить)` остаётся.

- [ ] **Step 4: Списки**

`src/60-lists.js`, `listItemHTML` — галочка без эмодзи, состояние в `aria-pressed` (вид рисует CSS):

```js
    <button class="check" data-toggle-item="${listId}" data-id="${it.id}" title="${it.done ? 'Вернуть в работу' : 'Готово'}" aria-pressed="${String(!!it.done)}"></button>
```

Там же: сохранение правки `<button class="mini-x" data-save-item="${listId}" data-id="${it.id}" title="Сохранить" aria-label="Сохранить">${navIconHtml('check')}</button>`; удаление `<button class="mini-x" data-del-item="${listId}" data-id="${it.id}" title="Удалить" aria-label="Удалить">${navIconHtml('trash')}</button>`.

`listCardHTML`: сохранение имени — `navIconHtml('check')` вместо `💜` (+ `aria-label="Сохранить"`); пустой список `html\`<li class="empty-li">Пока пусто</li>\``; действие:

```js
      <div class="list-actions">
        <button class="btn btn-ghost btn-sm" data-list-complete="${list.id}" title="Выполнить все подзадачи и удалить список">Выполнить список</button>
      </div>
```

`renderListItems`: строки `if (check) check.textContent = it.done ? '✅' : '○';` заменить на

```js
        if (check && check.setAttribute) {
          check.setAttribute('aria-pressed', String(!!it.done));
          check.title = it.done ? 'Вернуть в работу' : 'Готово';
        }
```

и `empty.textContent = 'Пока пусто 🫧';` → `'Пока пусто'`.

`index.html`, `#view-lists` — без заголовка-дубля переключателя:

```html
    <section class="view" id="view-lists">
      <div class="list-create">
        <input type="text" id="listNameInput" placeholder="Новый список, например «Подарки на 8 марта»">
        <button class="btn" id="listCreateBtn">Создать</button>
      </div>
      <div class="lists-wrap" id="listsWrap"></div>
    </section>
```

- [ ] **Step 5: Хотелки**

`src/61-wishes.js`, `wishToggleHTML`:

```js
function wishToggleHTML(w) {
  const me = getUser();
  if (w.done) {
    return w.doneBy === me ? html`<button class="btn btn-ghost btn-sm" data-wish-done="${w.id}" title="Снять отметку">Вернуть</button>` : html``;
  }
  if (w.owner === me) return html`<span class="wish-hint">Исполнить может только ${me === 'gosha' ? 'Даша' : 'Гоша'}</span>`;
  return html`<button class="btn btn-sm" data-wish-done="${w.id}" title="Исполнить!">Исполнить</button>`;
}
```

`wishCard`: ветку без фото `html\`<div class="wish-img" style="…">💝</div>\`` заменить на `html\`\``; `💜 Исполнено` → `Исполнено`; `🔗 Открыть ссылку` → `Открыть ссылку ↗`; удаление — `<button class="mini-x" data-wish-del="${w.id}" title="Удалить" aria-label="Удалить">${navIconHtml('trash')}</button>`, у правки `aria-label="Изменить"`.

`renderWishlist`: сигнатура `sec` теряет `emoji`:

```js
  const sec = (who, label, empty) =>
    html`<div class="wish-section" data-wish-owner="${who}"><h4>Хотелки ${label}</h4>
      ${byOwner(who).length ? html`<div class="wishlist-grid">${byOwner(who).map(wishCard)}</div>` : html`<p class="cal-tip">${empty}</p>`}
    </div>`;
  const tabs = html`<div class="wish-tabs">
      <button type="button" class="wish-tab${wishlistTab === 'gosha' ? ' active' : ''}" data-wish-tab="gosha">Гоша</button>
      <button type="button" class="wish-tab${wishlistTab === 'dasha' ? ' active' : ''}" data-wish-tab="dasha">Даша</button>
    </div>`;
```

и вызовы `sec('gosha', 'Гоши', 'Пока пусто. Нажми «Добавить» — мечты должны сбываться')`, `sec('dasha', 'Даши', 'Пока пусто. Нажми «Добавить» — мечты должны сбываться')` (тексты пустых перепишет Task 9).

`openWishModal`: заголовки `'Изменить хотелку'` / `'Хотелка'`; `'✅ фото уже есть — выбери новое, чтобы заменить'` → `'Фото уже есть — выбери новое, чтобы заменить'`; в обработчике `#wishPhoto` `'✅ фото готово'` → `'Фото готово'`.

`index.html`, `#view-wishlist` — без заголовка и **без класса `.wishlist-grid` у контейнера** (он раскладывал секции Гоши и Даши плитками по 220 px на десктопе):

```html
    <section class="view" id="view-wishlist">
      <div class="wishlist-bar">
        <button class="btn" id="addWishBtn">＋ Добавить</button>
      </div>
      <div id="wishlistGrid"></div>
    </section>
```

Шторка `#wishOverlay`: `<h3 id="wishModalTitle">Хотелка</h3>`, `<label class="btn btn-ghost file-btn" style="flex:none">Выбрать<input …></label>`, подсказка `<p class="cal-tip" id="wishWhoNote" style="margin:10px 0 0">Хотелка попадёт в твой список.</p>`, `<button class="btn" id="wishSave">Сохранить</button>`, у крестика `aria-label="Закрыть"`.

- [ ] **Step 6: CSS «Наше»**

Раздел «Заметки»: `.note-add` — `align-items:flex-end`; `.note-author` — `color:var(--ink)` (автор — не акцент). Удалить `.note .drag-handle{…}` и `.items li .drag-handle{…}` — ручка приводится к размеру `.mini-x` одним правилом в разделе «Драг-ручки»:

```css
.drag-handle{
  display:inline-flex;align-items:center;justify-content:center;
  width:32px;height:32px;border:0;border-radius:var(--radius-pill);background:transparent;
  color:var(--ink-2);cursor:grab;font-size:var(--text-base);line-height:1;
  flex:none;touch-action:none;user-select:none;-webkit-user-select:none;
}
.drag-handle:hover{background:var(--sky-2);color:var(--ink)}
```

(`.photo .drag-handle` ниже остаётся со своим фоном — ручка поверх фото без подложки не видна.)

Раздел «Списки»:

```css
.list-create{display:flex;gap:8px;margin-bottom:18px;max-width:540px}
.list-create input{flex:1;min-width:0}
.list-create .btn{white-space:nowrap}
.list-add input{flex:1;min-width:0}
.list-add .btn{flex:none;width:44px;height:44px;padding:0;justify-content:center}
.list-card h3 small{color:var(--ink-2);font-weight:600;font-size:var(--text-sm);white-space:nowrap}
/* Галочка подзадачи (фаза 7): вид — от aria-pressed, не от эмодзи ○/✅ */
.check{
  display:inline-flex;align-items:center;justify-content:center;
  width:24px;height:24px;border-radius:var(--radius-pill);border:2px solid var(--line);background:transparent;
  cursor:pointer;flex:none;transition:background .2s,border-color .2s;color:var(--void);font-size:var(--text-sm);font-weight:900;
}
.check:hover{border-color:var(--star)}
.check[aria-pressed="true"]{background:var(--star);border-color:var(--star)}
.check[aria-pressed="true"]::after{content:'✓'}
```

Удалить: `.lists-bar{…}`, `.lists-bar h3{…}`, прежние `.list-create{…}`, `.list-create input{…}`, `.list-add input{flex:1}`, прежние `.check{…}` и `.check:hover{…}`. `.list-actions` — рамку `1px dashed var(--line)` оставить.

`.modal .check{…}` (строка-чекбокс «Повторять каждый год» в шторке события) перебивает размеры и рамку, но **наследует** от нового `.check` свойство `justify-content:center` — подпись съехала бы в середину (урок 2). В правило `.modal .check{…}` дописать `justify-content:flex-start;border-radius:0;`. Проверить `grep -n "\.check" styles.css` и снимок `*-sheet-event.png`: галочка и подпись прижаты влево.

Раздел «Вишлист»: `.wishlist-bar{display:flex;justify-content:flex-end;margin-bottom:18px}` (удалить `.wishlist-bar h3{…}`); `.wish-done-by` — `color:var(--ink-2)`; `.wish.done .wish-done-by{…}` удалить. Мобильные вкладки Гоша/Даша — тише, чем переключатель «Наше» над ними (активная — подложка, не акцент):

```css
  .wish-tab.active{background:var(--sky-2);color:var(--ink);border-color:var(--line)}
```

(заменяет прежнее `.wish-tab.active{background:var(--star);…}` внутри `@media(max-width:820px)`).

- [ ] **Step 7: Прогон**

Run: `npm run check` → exit 0.

Run: `node tools/shots.js task-3 && node tools/shots-diff.js phase-7-start task-3`
Expected: `DIFF:` — `*-notes.png`, `*-lists.png`, `*-wishlist.png` плюс все снимки с нижней панелью на телефоне (иконка «Наше» сменилась: `phone-*` всех экранов). Если в списке есть `desk-*-home.png` / `desk-*-photos.png` — регрессия. Глазами на `phone-*`: «Создать» в одну строку, у пункта списка — ручка, кружок, текст, две тихие иконки; хотелка без фото — просто карточка текста. На `desk-*-wishlist.png` — секции во всю ширину, карточки в несколько колонок.

Run: `node tools/browser-check.js` → `ИТОГ: OK` (перетаскивание заметок и списков выжило — NV-58).

- [ ] **Step 8: Commit**

```bash
git add index.html styles.css src/20-theme-nav.js src/50-notes.js src/60-lists.js src/61-wishes.js tests/uni-smoke.js app.js
git commit -m "Feat: «Наше» на новых токенах — без дублей заголовков, тихие действия, галочка через aria-pressed, своя иконка (NV-58, NV-97)"
```

### Task 4: Настройки, шапка и оставшиеся шторки (NV-59)

**Files:**
- Modify: `index.html` — шапка (строки 63-82), `#view-settings` (200-233), шторки `#dateOverlay`, `#dateInviteOverlay`, `#labelOverlay`, `#labelApplyOverlay`, фото-бар (170-195)
- Modify: `styles.css` — «Шапка», «Настройки», «Переключатель»
- Modify: `src/20-theme-nav.js` — `setTheme`, `go`
- Modify: `src/80-settings.js` — без правок логики (проверить, что `#settingsThemeBtn` нигде не читается)
- Modify: `src/96-push.js:133`
- Modify: `src/30-home.js:310`, `src/71-photo-grid.js` (подписи кнопок режима), `src/72-photo-labels.js:75`
- Test: `tests/uni-hash.js` (новый сценарий 4), `tests/uni-dnd.js` (PREIDS)

**Interfaces:**
- Consumes: `.btn-ghost`, `.btn-ghost.danger` из Task 2.
- Удаляется: `#settingsThemeBtn` и карточка «Оформление» — тема переключается кнопкой в шапке, которая видна на каждом экране; карточка дублировала её и начиналась с «Тёмная тема — нежнее для глаз вечером», хотя тёмная тема основная с фазы 1.

- [ ] **Step 1: Тест на `go()` без экрана (красный)**

Кнопка приглашений в шапке — `.nav-btn` без `data-view`, общий обработчик вызывает `go(undefined)`, и тот пишет в адрес `#/undefined` (кнопка «назад» потом ведёт в никуда). В `tests/uni-hash.js` в конец файла:

```js
// Сценарий 4 (фаза 7): go() с несуществующим экраном не трогает адрес.
// Кнопка приглашений (.nav-btn без data-view) звала go(undefined) и писала #/undefined.
try {
  const ctx4 = makeCtx('#/notes', false);
  const realQS = ctx4.document.querySelector;
  ctx4.document.querySelector = sel => (sel === '#view-undefined' ? null : realQS(sel));
  vm.createContext(ctx4);
  vm.runInContext(src, ctx4, { filename: file });
  vm.runInContext('go(undefined)', ctx4);
  if (ctx4.location.hash !== '#/notes') {
    console.log('FAIL: go(undefined) переписал адрес на ' + ctx4.location.hash);
    process.exit(1);
  }
  console.log('OK: go(undefined) не трогает адрес');
} catch (e) {
  console.log('FAIL: ' + e.message);
  process.exit(1);
}
```

Run: `node build.js && node tests/uni-hash.js app.js`
Expected: `FAIL: go(undefined) переписал адрес на #/undefined`

- [ ] **Step 2: `go()` и тема**

`src/20-theme-nav.js`, `go`:

```js
function go(view) {
  view = resolveView(view);
  if (!$('#view-' + view)) return; // кнопка без экрана (приглашения в шапке) — адрес не трогаем
  showView(view);
  …остальное без изменений
}
```

`setTheme`, внутри `apply`: удалить две строки про `sbtn` (`const sbtn = $('#settingsThemeBtn'); if (sbtn) sbtn.textContent = …`).

`tests/uni-dnd.js`: из `PREIDS` удалить `'settingsThemeBtn',`.

- [ ] **Step 3: Настройки — разметка**

`index.html`, `#view-settings` целиком:

```html
    <section class="view" id="view-settings">
      <div class="settings-card">
        <h3>Копия данных</h3>
        <p>Всё хранится в общем облаке и видно вам обоим. Скачай копию — на всякий случай.</p>
        <div class="settings-btns">
          <button class="btn" id="exportBtn"><svg class="nav-icon" aria-hidden="true"><use href="#icon-download"></use></svg>Скачать копию</button>
          <label class="btn btn-ghost file-btn">Восстановить из копии<input type="file" id="importInput" accept=".json" hidden></label>
        </div>
      </div>
      <div class="settings-card">
        <h3>Вход</h3>
        <p>Сейчас вход с аккаунта <b id="gateAccountInfo"></b>. Открыть сайт могут только два аккаунта Google — Гоши и Даши.</p>
        <div class="settings-btns">
          <button class="btn btn-ghost danger" id="gateSignOutBtn">Выйти на этом устройстве</button>
        </div>
      </div>
      <div class="settings-card">
        <h3>Уведомления</h3>
        <p>Партнёр узнает, когда ты назначишь или подтвердишь свидание, — даже если приложение закрыто.</p>
        <label class="switch-row">
          <span>Уведомления о свиданиях</span>
          <input type="checkbox" id="pushToggle" role="switch">
        </label>
        <p class="settings-hint" id="pushHint"></p>
      </div>
    </section>
```

`src/96-push.js:133`: `'💡 На телефоне уведомления…'` → `'На телефоне уведомления надёжно работают только после установки сайта на экран «Домой» (в Safari на iOS — иначе они не приходят вообще).'`.

Проверить: `grep -n "motion-toggle\|settingsThemeBtn" src/*.js index.html` → пусто.

- [ ] **Step 4: Шапка и шторки**

Шапка: у `#themeToggle` класс `btn theme-toggle` → `nav-btn theme-toggle` **нельзя** — `.nav-btn` получает обработчик `go(b.dataset.view)`; оставить `btn theme-toggle`, тишину дать CSS (шаг 5).

Шторки (`index.html`): `💘 Назначить свидание` → `Назначить свидание` (заголовок `#dtModalTitle`), `💌 Свидание будет от твоего имени — того, кто сейчас вошёл.` → `Свидание будет от твоего имени.`, `Сохранить свидание 💜` → `Сохранить`; `💘 Тебе назначили свидание!` → `Тебе назначили свидание`; `🏷 Лейблы` → `Лейблы`; `🏷 Применить лейблы` → `Применить лейблы`; в подсказке `#labelOverlay` `«🏷 Добавить лейбл»` → `«Добавить лейбл»`; кнопки `＋ Создать` / `＋ Создать и применить` остаются. У всех `.modal-x` в шторках — `aria-label="Закрыть"`.

`src/30-home.js:310`: `dt ? '✏️ Изменить свидание' : '💘 Назначить свидание'` → `dt ? 'Изменить свидание' : 'Назначить свидание'`. Кнопку `#addDateBtn` на Главной (`💘 Назначить свидание`) не трогать — Главная закрыта фазой 5, снимок `*-home.png` меняться не должен.

`src/72-photo-labels.js:75`: `💜` в кнопке сохранения → `${navIconHtml('check')}` + `aria-label="Сохранить"`.

Фото-бар (`index.html` и `src/71-photo-grid.js`, где подписи ставятся на каждом рендере): `📸 Наши моменты` → `Наши моменты`; `☑️ Выбрать` → `Выбрать`; `↕ Порядок` → `Порядок`; `✓ Готово` остаётся (галочка — знак, а не эмодзи); в `#photoSelBar` — `🏷 Добавить лейбл` → `Лейбл`, `☆ Закрепить` → `Закрепить`, `🗑 Удалить выбранные` → `Удалить` (класс `btn btn-ghost danger album-add-btn`), `✕ Снять выбор` → `Снять выбор`; в `#dragHint` текст остаётся (его ставит `renderPhotosNow`); в `renderPhotosNow` строка `'↕ Перетаскивай фото за ⠿ для порядка.'` → `'Перетаскивай фото за ⠿, чтобы поменять порядок.'`.

- [ ] **Step 5: CSS**

Раздел «Шапка»:

```css
/* Тема — служебная кнопка, как настройки рядом: тихая пилюля. Янтарём
   горела на каждом экране и спорила с активной вкладкой (фаза 7). */
.theme-toggle{padding:9px 12px;background:var(--sky-1);color:var(--ink-2);border:1px solid var(--line);box-shadow:none}
.theme-toggle:hover{border-color:var(--star);color:var(--star-ink)}
```

(заменяет прежнее `.theme-toggle{padding:9px 14px}`; в `@media(max-width:820px)` правило `.theme-toggle{padding:7px 10px;…}` остаётся).

Раздел «Настройки»:

```css
#view-settings{max-width:640px;margin:0 auto}
.settings-card{background:var(--sky-1);border:1px solid var(--line);border-radius:var(--radius-card);padding:24px;margin-bottom:16px}
.settings-card h3{font-size:var(--text-lg);margin-bottom:8px}
.settings-card p{color:var(--ink-2);font-size:var(--text-base);margin-bottom:16px}
.settings-btns{display:flex;gap:12px;flex-wrap:wrap}
.settings-hint{color:var(--ink-2);font-size:var(--text-sm);margin:12px 0 0}
.settings-hint:empty{display:none}
```

Раздел «Переключатель» — `.motion-toggle*` (имя осталось от удалённого тумблера анимаций) заменить:

```css
/* Переключатель-строка (уведомления): подпись слева, свитч справа */
.switch-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;border-top:1px solid var(--line);font-weight:700;color:var(--ink);cursor:pointer}
.switch-row input{appearance:none;-webkit-appearance:none;flex:none;position:relative;width:44px;height:26px;margin:0;border-radius:var(--radius-pill);background:var(--line);cursor:pointer;transition:background .2s}
.switch-row input::before{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:var(--paper);transition:transform .2s}
.switch-row input:checked{background:var(--star)}
.switch-row input:checked::before{transform:translateX(18px)}
```

- [ ] **Step 6: Прогон**

Run: `npm run check` → exit 0 (сценарий 4 в `uni-hash` теперь `OK`).

Run: `node tools/shots.js task-4 && node tools/shots-diff.js phase-7-start task-4`
Expected: `DIFF:` — все снимки (кнопка темы в шапке на каждом экране), по содержанию — `*-settings.png` и `*-photos.png`. Глазами: в шапке одна янтарная пилюля — активная вкладка; Настройки — три карточки колонкой 640 px, «Выйти» тихая красным текстом, свитч уведомлений справа.

Run: `node tools/browser-check.js` → `ИТОГ: OK`

- [ ] **Step 7: Commit**

```bash
git add index.html styles.css src/20-theme-nav.js src/30-home.js src/71-photo-grid.js src/72-photo-labels.js src/96-push.js tests/uni-hash.js tests/uni-dnd.js app.js
git commit -m "Feat: Настройки без дубля темы и текстов эпохи сейфа, тихая шапка, шторки без эмодзи; go() не пишет #/undefined (NV-59)"
```

### Task 5: Закрыть фазу 7 — ревью ветки, документация, мёрж, деплой

**Files:**
- Modify: `README.md`, `PROJECT-MEMORY.md`, `docs/superpowers/baseline/README.md`

- [ ] **Step 1: Ревью всей ветки (урок 7)**

Скилл `superpowers:requesting-code-review` на диапазон `main..redesign-phase-7`, в брифе ревьюеру — Global Constraints и уроки этого плана, снимки `phase-7-end` (снять: `node tools/shots.js phase-7-end`). Находки — отдельными коммитами `Fix: … (I1)`, `(I2)`…; после фиксов — повторный `npm run check`, `browser-check`, снимки.

- [ ] **Step 2: Итоги по baseline**

В `docs/superpowers/baseline/README.md` дописать раздел `## После фазы 7 (дата)`: по каждому пункту «что отстало» из шапки ФАЗЫ 7 этого плана — одна строка, что стало (со ссылкой на снимок).

- [ ] **Step 3: README.md и PROJECT-MEMORY.md**

README: раздел про экраны — Календарь («Ближайшее» одной кнопкой, `.ics` рядом с «Добавить дату»), «Наше», Настройки (карточки темы больше нет — тема в шапке). PROJECT-MEMORY: новый `## 0h. ⚡ Снимок состояния (дата) — САМЫЙ СВЕЖИЙ, читай сначала этот`, у `0g` снять пометку. Содержание: `.btn-ghost`/`.btn-ghost.danger`, иконочная `.mini-x`, удаление — `navIconHtml('trash')`, галочка списка — `aria-pressed` (не текст), `#jumpInfo` удалён, `returnDpFocus`, `go()` игнорирует несуществующий экран, `#settingsThemeBtn` удалён. Урок 5: каждое имя проверить `grep -n` по `src/`.

- [ ] **Step 4: Мёрж и деплой**

Run: `npm run check` → exit 0; `node tools/browser-check.js` → `ИТОГ: OK`.

```bash
git add README.md PROJECT-MEMORY.md docs/superpowers/baseline/README.md
git commit -m "Docs: фаза 7 — снимок 0h, README, итоги по baseline"
```

Скилл `superpowers:finishing-a-development-branch`: мёрж `redesign-phase-7` в `main`, push. `gh run list --limit 2` → оба `success`. `curl -s https://ledoksi.github.io/nasha-vselennaya/ | grep -o 'app.min.js?v=[0-9a-f]*'` — версия сменилась. Журнал `.superpowers/sdd/…` скопировать в основной checkout до удаления worktree (урок 6).

---

# ФАЗА 8 — Движение

Ветка `redesign-phase-8` от `main`. Перед Task 6: `node tools/shots.js phase-8-start`.

Правило спеки 3: анимация обязана что-то сообщать. Фаза не добавляет «красоту»; она заменяет литералы токенами, даёт нажатию и шторке пружину и **удаляет** то, что двигается без смысла: подъёмы по наведению (`translateY(-2px)` на кнопках, `rotate(-.5deg)` на заметках — на телефоне наведение «залипает» после тапа), вечный пульс кнопки «Назначить свидание», `fadeIn` вкладки поверх View Transition (двойная анимация) и `cardIn`, который заново проигрывался на каждой перерисовке списка после любой правки.

### Task 6: Токены движения, нажатие, пружина (NV-60)

**Files:**
- Modify: `styles.css` (слой tokens + все `transition`/`animation`)
- Modify: `src/00-core.js` (`freshPhotoIds`)
- Modify: `src/70-photos.js` (отметка свежих фото), `src/71-photo-grid.js` (класс `photo--fresh`)
- Modify: `src/85-lightbox.js` (`lbTileOnScreen`)
- Test: `tests/uni-tokens.js` (страж длительностей), `tests/uni-smoke.js` (свежие фото), `tools/browser-check.js` (лайтбокс за экраном)

**Interfaces:**
- Produces (для Task 7, 9, 10): токены `--ease-spring`, `--ease-out`, `--dur-press` (120ms), `--dur-state` (200ms), `--dur-enter` (320ms), `--dur-sheet` (420ms), `--dur-loop` (1.6s), `--dur-celebrate` (3s), `--t-ui` (стандартный переход интерактивного элемента); keyframes `shimmer` (переименован из `photoShimmer`).
- Produces: `freshPhotoIds: Set<string>` в `src/00-core.js`; `lbTileOnScreen(el): boolean` в `src/85-lightbox.js`.

- [ ] **Step 1: Страж длительностей (красный)**

`tests/uni-tokens.js`, перед блоком `if (fails.length)`:

```js
// Фаза 8 (NV-60): движение — только токенами --dur-*/--ease-* из слоя tokens.
// Литеральная длительность или cubic-bezier вне слоя — ровно то, чем был
// разнобой .2s/.22s/.25s/.28s/.3s до фазы 8.
for (const m of rest.matchAll(/(?:transition|animation)(?:-duration|-delay|-timing-function)?\s*:([^;}]+)/g)) {
  for (const t of m[1].matchAll(/(?<![\w.-])\d*\.?\d+m?s\b/g)) fails.push('длительность ' + t[0] + ' в «' + m[0].trim().slice(0, 60) + '»');
  if (/cubic-bezier\(|linear\(/.test(m[1])) fails.push('кривая в «' + m[0].trim().slice(0, 60) + '»');
}
```

и последнюю строку: `console.log('OK: цвета, радиусы и движение только в токенах');`.

Run: `node tests/uni-tokens.js`
Expected: `FAIL: хардкод вне токенов (N):` со строками `длительность .2s …`, `длительность 1.6s …` и т.п.

- [ ] **Step 2: Токены**

`styles.css`, в `:root` слоя tokens после `--font-display`:

```css
  /* ===== Фаза 8 (NV-60): движение, спека 3.1 =====
     Пружина — сэмплированный затухающий осциллятор (ζ=.78, перелёт ~2%),
     16 отрезков linear(): ease-in-out даёт ватное ощущение, настоящая пружина
     с лёгким перелётом читается как нативная. Скоростная физика нужна только
     перетаскиванию — там остаётся код на указателях (05-dnd.js, SortableJS). */
  --ease-spring:linear(0, 0.14, 0.401, 0.644, 0.822, 0.932, 0.99, 1.014, 1.02, 1.017, 1.012, 1.007, 1.004, 1.001, 1, 1, 1);
  --ease-out:cubic-bezier(.2,.8,.2,1);
  --dur-press:120ms;   /* нажатие */
  --dur-state:200ms;   /* смена состояния: цвет, рамка, фон */
  --dur-enter:320ms;   /* появление элемента, смена вкладки, перелёт фото */
  --dur-sheet:420ms;   /* шторка */
  --dur-loop:1.6s;     /* бесконечная подсказка: шиммер загрузки, пульс приглашения */
  --dur-celebrate:3s;  /* конфетти */
  /* Стандартный переход интерактивного элемента: цвета — плавно, нажатие — быстро */
  --t-ui:background-color var(--dur-state),border-color var(--dur-state),color var(--dur-state),transform var(--dur-press) var(--ease-out);
```

- [ ] **Step 3: Литералы → токены, лишнее — вон**

Пройти `grep -n "transition\|animation" styles.css` сверху вниз. Таблица замен (строки — по main после фазы 7, сверять по селектору):

| Селектор | Было | Стало |
|---|---|---|
| `.invite-btn` | `invitePulse 1.6s ease-in-out infinite` | `invitePulse var(--dur-loop) ease-in-out infinite` |
| `.nav-btn` | `transition:transform .2s,border-color .2s,color .2s` | `transition:var(--t-ui)` |
| `.nav-btn:hover` | `transform:translateY(-2px);…` | убрать `transform` |
| `.nav-btn.active` | `…;transform:scale(1.06);…` | убрать `transform:scale(1.06)` |
| `.view.active` | `display:block;animation:fadeIn .4s ease` | `display:block` (+ удалить `@keyframes fadeIn`) |
| `.btn` | `transition:transform .2s,box-shadow .25s` | `transition:var(--t-ui),box-shadow var(--dur-state)` |
| `.btn:hover` | `transform:translateY(-2px)` | удалить правило |
| поля ввода | `transition:border-color .2s` | `transition:border-color var(--dur-state)` |
| `.btn-date` | `animation:pulseBtn 2.4s …` | удалить свойство, удалить `@keyframes pulseBtn` и `.btn-date:hover{…}` |
| все `transition:.2s` (`.resp-btn`, `.cal-nav`, `.mini-x`, `.dp-nav`, `.dp-select`, `.dp-mini`, `.album-chip`, `.ev-btn`, `.ev-reset-btn`, `.sel-photo`, `.wish-tab`, `.check`, `.switch-row input`, `.theme-toggle`…) | `.2s` / `background .2s,color .2s` | `var(--t-ui)` |
| `.resp-btn:hover`, `.cal-nav:hover`, `.dp-nav:hover`, `.ev-btn:hover`, `.sel-photo:hover` | `transform:…` | убрать `transform` |
| `.cal-cell` | `transition:background .2s` | `transition:background-color var(--dur-state)` |
| `.note`, `.wish` | `transition:transform .25s,box-shadow .25s` | удалить свойство |
| `.note:hover`, `.wish:hover` | подъём/поворот | удалить правила |
| `.items li` | `transition:transform .28s ease,background .28s ease,color .28s ease` | `transition:transform var(--dur-enter) var(--ease-spring),background-color var(--dur-state),color var(--dur-state)` (FLIP переезда подзадачи) |
| `.items li.just-toggled .check` | `checkPop .32s ease` | `checkPop var(--dur-enter) var(--ease-out)` |
| `.photo img` | `…;transition:transform .3s;…` | убрать `transition`, удалить `.photo:hover img{…}` |
| `.photo:has(img[data-photo-src])` | `photoShimmer 1.6s ease-in-out infinite` | `shimmer var(--dur-loop) ease-in-out infinite`; `@keyframes photoShimmer` → `@keyframes shimmer` |
| `.modal` | `animation:pop .3s ease` | `animation:pop var(--dur-enter) var(--ease-spring)` |
| шторка `.overlay:not(.lightbox) .modal` | `transition:transform .42s cubic-bezier(.2,.8,.2,1)` | `transition:transform var(--dur-sheet) var(--ease-spring)` |
| `.date-pop` | `pop .18s ease` | `pop var(--dur-state) var(--ease-spring)` |
| `.dp-day` | `background .15s` | `background-color var(--dur-state)` |
| `.lb-stage img` | `transform .2s ease` | `transform var(--dur-state) var(--ease-out)` |
| `.lb-btn` | `background .2s,transform .2s` | `var(--t-ui)` |
| `.lb-btn:hover`, `.lb-arrow:hover`, `.lb-close:hover` | `transform:…scale(1.08)` | убрать `transform` (у `.lb-arrow:hover` — удалить правило целиком) |
| `.confetti` | `confettiFall 3s ease-out forwards` | `confettiFall var(--dur-celebrate) ease-out forwards` |
| `.auth-card` | `pop .4s ease` | `pop var(--dur-enter) var(--ease-spring)` |
| `.app-toast` | `pop .2s ease` | `pop var(--dur-state) var(--ease-spring)` |
| `.hs-bar i` | `width .4s ease` | `width var(--dur-enter) var(--ease-out)` |
| `.tl-photos img` | `transition:transform .2s` | убрать, удалить `.tl-photos img:hover{…}` |
| `.view.active .note,…` | `animation:cardIn .38s ease both` | удалить правило и `@keyframes cardIn` |
| `.note,.list-card,.wish` (Фаза D) | `transition:transform .22s …` | удалить правило |
| `.items li.done span` | `transition:color .25s` | `transition:color var(--dur-state)` |
| `::view-transition-old(root),…` | `animation-duration:.32s;animation-timing-function:ease` | `animation-duration:var(--dur-enter);animation-timing-function:var(--ease-out)` |
| `::view-transition-group(lb-photo)` | `.32s` + `cubic-bezier(.2,.8,.2,1)` | `var(--dur-enter)` + `var(--ease-spring)` |

Нажатие — правило `.btn:active,.nav-btn:active,.cal-nav:active,.dp-nav:active{transform:scale(.95)}` заменить (спека 3.2: `scale(.97)`, `--dur-press`):

```css
/* Нажатие (спека 3.2): всё интерактивное проседает на 3% — обратная связь,
   одинаковая везде. transform переходит за --dur-press (в --t-ui). */
.btn:active,.nav-btn:active,.cal-nav:active,.dp-nav:active,.our-tab:active,.mini-x:active,.check:active,
.resp-btn:active,.album-chip:active,.ev-btn:active,.wish-tab:active,.dp-mini:active,.cal-jump-info:active,
.lb-btn:not(.lb-arrow):active{transform:scale(.97)}
.lb-arrow:active{transform:translateY(-50%) scale(.97)}
```

У `.our-tab`, `.cal-jump-info` своих `transition` нет — добавить `transition:var(--t-ui)`.

Шторка — перелёт пружины (~2% высоты) не должен открывать щель под нижним краем: шторка уходит за край экрана на 24 px, отступ снизу компенсирует. В `@media (max-width:820px)` правило `.overlay:not(.lightbox) .modal{…}`: добавить `margin-bottom:-24px;`, `padding-bottom:calc(28px + env(safe-area-inset-bottom))` → `calc(52px + env(safe-area-inset-bottom))`; `.overlay:not(.lightbox) .event-modal{padding-bottom:0}` (из Task 2) → `padding-bottom:24px`.

Run: `node tests/uni-tokens.js`
Expected: `OK: цвета, радиусы и движение только в токенах`. Если остались строки — это селекторы, не попавшие в таблицу: заменить по тому же правилу (цвет/рамка/фон → `--dur-state`, появление → `--dur-enter`, нажатие → `--t-ui`).

- [ ] **Step 4: Свежие фото — пружиной в сетку (тест красный)**

`tests/uni-smoke.js`, в блок фаз 6 галереи (рядом с проверками `photo--big`) — и экспорт в суффикс `s.freshPhotoIds = freshPhotoIds;`:

```js
  // Фаза 8 (NV-60): только что загруженное фото «падает» в сетку пружиной —
  // один раз; следующая перерисовка его уже не анимирует.
  w('(s)=>{s.db.photos.unshift({id:"fresh1",title:"x",order:-1,labels:[]}); s.freshPhotoIds.add("fresh1"); s.renderPhotosNow(); return 1;}');
  assert(registry['#photosGrid'].innerHTML.includes('photo--fresh'), 'свежее фото помечено photo--fresh');
  w('(s)=>{s.renderPhotosNow(); return 1;}');
  assert(!registry['#photosGrid'].innerHTML.includes('photo--fresh'), 'вторая перерисовка свежесть не повторяет');
```

Run: `node build.js && node tests/uni-smoke.js app.js` → FAIL (`freshPhotoIds` не определён).

- [ ] **Step 5: Свежие фото — код**

`src/00-core.js`, рядом с `photosCursor`:

```js
// id фото, загруженных в этой сессии и ещё ни разу не нарисованных в сетке:
// renderPhotosNow даёт им класс photo--fresh (пружина появления) и очищает набор.
const freshPhotoIds = new Set();
```

`src/70-photos.js`, в обработчике `#photoInput` сразу после `db.photos.unshift(ph);`: `freshPhotoIds.add(ph.id);`.

`src/71-photo-grid.js`, в классе плитки после `${selectedPhotos.has(p.id) ? ' selected' : ''}`: `${freshPhotoIds.has(p.id) ? ' photo--fresh' : ''}`; в конце `renderPhotosNow` (после `hydratePhotoImgs(grid);`): `freshPhotoIds.clear();`.

`styles.css`, раздел «Фото»:

```css
.photo--fresh{animation:photoIn var(--dur-enter) var(--ease-spring) both}
@keyframes photoIn{from{opacity:0;transform:scale(.86)}}
```

Run: `node build.js && node tests/uni-smoke.js app.js` → OK.

- [ ] **Step 6: Лайтбокс не улетает за экран (NV-97)**

`src/85-lightbox.js`, перед `lbFlyBack`:

```js
// Плитка, куда возвращается фото, должна быть на экране хотя бы центром —
// иначе перелёт уходит за край и выглядит как сбой (NV-97). Без размеров
// (песочница тестов) считаем, что видна.
function lbTileOnScreen(el) {
  if (typeof el.getBoundingClientRect !== 'function' || typeof window === 'undefined' || !window.innerHeight) return true;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2,
    cy = r.top + r.height / 2;
  return cx >= 0 && cx <= window.innerWidth && cy >= 0 && cy <= window.innerHeight;
}
```

В `lbFlyBack`: `if (!to || !to.style) return false;` → `if (!to || !to.style || !lbTileOnScreen(to)) return false;`.

`tools/browser-check.js`, новая проверка перед `(async () => {`:

```js
// Фаза 8 (NV-97): плитка ушла за экран, пока открыт лайтбокс — закрытие без
// перелёта (иначе фото улетает за край).
async function checkLightboxOffscreen(page, log) {
  const r = await page.evaluate(async () => {
    go('photos');
    await new Promise(ok => setTimeout(ok, 200));
    const img = document.querySelector('#photosGrid .photo img');
    const real = Document.prototype.startViewTransition;
    document.startViewTransition = undefined;
    openLightboxFrom(img);
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(ok => setTimeout(ok, 100));
    let calls = 0;
    document.startViewTransition = cb => {
      calls++;
      return real.call(document, cb);
    };
    closeOverlay('lightbox');
    await new Promise(ok => setTimeout(ok, 400));
    document.startViewTransition = undefined;
    window.scrollTo(0, 0);
    return { calls, closed: document.getElementById('lightbox').hidden };
  });
  const ok = r.calls === 0 && r.closed;
  log.push((ok ? 'OK' : 'FAIL') + ' лайтбокс, плитка за экраном: перелётов=' + r.calls + ', закрыт=' + r.closed);
  return ok;
}
```

и в список проверок после `checkPhotoContextMenuRace`: `allOk = (await checkLightboxOffscreen(page, log)) && allOk;`.

Проверить, что проверка ловит: временно убрать `|| !lbTileOnScreen(to)` → `node build.js && node tools/browser-check.js` → строка `FAIL лайтбокс, плитка за экраном: перелётов=1`; вернуть.

- [ ] **Step 7: Прогон**

Run: `npm run check` → exit 0.

Run: `node tools/shots.js task-6 && node tools/shots-diff.js phase-8-start task-6`
Expected: снимки делаются с `animation:none;transition:none` — вид статичный; допустимые отличия только от удалённых `transform:scale(1.06)` у активной вкладки (все `desk-*` снимки) и `.nav-btn.active`. Любое другое отличие — разобрать.

Вживую на стенде (`http://localhost:8090/tools/demo.html`, ширина 390, DevTools → Rendering → Emulate touch): шторка «Назначить свидание» приезжает с едва заметным перелётом и без щели снизу; нажатие кнопки проседает; вкладки меняются одним crossfade без «подпрыгивания» контента; заметки не шевелятся при наведении. Проверить на живом телефоне (в отчёт): пружина шторки не дёргается на 120 Гц.

Run: `node tools/browser-check.js` → `ИТОГ: OK`

- [ ] **Step 8: Commit**

```bash
git add styles.css src/00-core.js src/70-photos.js src/71-photo-grid.js src/85-lightbox.js tests/uni-tokens.js tests/uni-smoke.js tools/browser-check.js app.js
git commit -m "Feat: токены движения и пружина linear(), нажатие scale(.97), без декоративных подъёмов и пульса; свежие фото пружиной; лайтбокс не летит за экран (NV-60, NV-97)"
```

### Task 7: Scroll-driven — небо и ось (NV-61)

**Files:**
- Modify: `styles.css` (раздел «слой неба», «Ось времени»)
- Test: `tests/uni-render.js` (страж обработчиков scroll)

- [ ] **Step 1: Страж (проверить, что ловит)**

`tests/uni-render.js`, в цикл по файлам `src` после проверки `outerHTML`:

```js
  assert(!/addEventListener\(\s*['"]scroll['"]|\.onscroll\s*=/.test(src), f + ': нет обработчиков scroll — спека 3.2, только animation-timeline и IntersectionObserver');
```

Проверить, что страж ловит: временно дописать в конец `src/36-timeline.js` строку `window.addEventListener('scroll', () => {});` → `node tests/uni-render.js` → `FAIL: 36-timeline.js: нет обработчиков scroll…`; строку удалить → `OK: uni-render`.

- [ ] **Step 2: Параллакс неба и проявление оси**

`styles.css`, в конец раздела «Ось времени» (перед блоком «Фаза D: Glass-карточки»):

```css
/* Фаза 8 (NV-61, спека 3.2): всё, что завязано на прокрутку, — через
   animation-timeline, ноль обработчиков scroll. Небо: две плоскости уходят
   вверх с разной скоростью — глубина, «уход в прошлое». Ось: день
   проявляется, въезжая в экран — порядок чтения. Где timeline нет — всё
   статично и видно сразу (@supports), без полифилов (спека §7). */
@supports (animation-timeline: scroll()) {
  .sky-far{animation:skyFar linear both;animation-timeline:scroll(root)}
  .sky-near{animation:skyNear linear both;animation-timeline:scroll(root)}
  .axis-day{animation:axisReveal linear both;animation-timeline:view();animation-range:entry 0% entry 70%}
}
@keyframes skyFar{to{transform:translateY(-4%)}}
@keyframes skyNear{to{transform:translateY(-12%)}}
@keyframes axisReveal{from{opacity:.15;transform:translateY(16px)}}
```

Запас по высоте: `.sky-far,.sky-near{inset:-20% 0}` — слой на 40% выше экрана; `-12%` от его высоты (~17% экрана) остаётся в запасе, низ неба не открывается. Комментарий «Параллакс по прокрутке — фаза 8, сейчас слой статичен» в разделе неба заменить на «Параллакс — ниже, @supports (animation-timeline)».

Длительности нет — для scroll/view timeline она не нужна (страж `uni-tokens` доволен).

- [ ] **Step 3: Прогон**

Run: `npm run check` → exit 0.

Run: `node tools/shots.js task-7 && node tools/shots-diff.js phase-8-start task-7` — снимки с отключёнными анимациями не должны отличаться от `task-6` (проверить `node tools/shots-diff.js task-6 task-7` → `OK`).

Вживую на стенде: прокрутка Главной вниз — звёзды ближнего слоя уходят заметно быстрее дальнего; дни оси проявляются снизу. В DevTools → Performance, запись прокрутки: нет длинных задач от scroll, `Layout` не растёт. Проверить на живом телефоне (в отчёт): параллакс не укачивает, прокрутка оси не дёргается.

- [ ] **Step 4: Commit**

```bash
git add styles.css tests/uni-render.js
git commit -m "Feat: небо параллаксит, дни оси проявляются — scroll-driven, страж против обработчиков scroll (NV-61)"
```

### Task 8: Закрыть фазу 8

- [ ] **Step 1: Ревью ветки** — `node tools/shots.js phase-8-end`; скилл `superpowers:requesting-code-review` на `main..redesign-phase-8` с Global Constraints и уроками этого плана в брифе; отдельно: «ищи анимацию, которая ничего не сообщает; ищи элементы из списка `:active`, у которых нет `transition:var(--t-ui)`». Фиксы — отдельными коммитами `Fix: … (J1)`, `(J2)`…, после них `npm run check` и `node tools/browser-check.js` → `ИТОГ: OK`.
- [ ] **Step 2: PROJECT-MEMORY 0i** — новый `## 0i. ⚡ Снимок состояния (дата) — САМЫЙ СВЕЖИЙ`, у `0h` снять пометку: токены движения с числами, `--t-ui`, список удалённого декоративного движения (чтобы не вернули «для красоты»), `freshPhotoIds`, `lbTileOnScreen`, scroll-driven в `@supports`, оба стража (`uni-tokens` — длительности, `uni-render` — scroll). README — абзац «Движение». Каждое имя — `grep -n` по `src/` (урок 5).
- [ ] **Step 3: Мёрж и деплой** — `git commit -m "Docs: фаза 8 — снимок 0i, движение в README"`; скилл `superpowers:finishing-a-development-branch`: мёрж `redesign-phase-8` в `main`, push; `gh run list --limit 2` → оба `success`; `curl -s https://ledoksi.github.io/nasha-vselennaya/ | grep -o 'app.min.js?v=[0-9a-f]*'` — версия сменилась. Журнал `.superpowers/sdd/…` — в основной checkout до удаления worktree (урок 6).

---

# ФАЗА 9 — Состояния

Ветка `redesign-phase-9` от `main`. Перед Task 9: `node tools/shots.js phase-9-start`.

Инвентаризация (27.09.2026): пустые экраны пишутся шестью разными способами (`.empty-state`, `.dates-empty`, `.rem-empty`, голый `.cal-tip`), у каждого — пунктирная янтарная рамка (акцент как декор); текст пустой галереи устарел («если настроена синхронизация в Настройках» — её там нет с переезда в облако). Загрузки: после входа — строка «Загружаем…» на карточке входа; следующая страница галереи и месяц календаря грузятся молча; **ошибки** догрузки месяца, страницы галереи и сохранения загруженного фото уходят в `console.warn` или в необработанный rejection — человек не узнаёт ничего. Офлайн — плашка «📡 Нет сети» без объяснения, что будет с изменениями.

### Task 9: Пустые экраны — приглашение действовать (NV-62)

**Files:**
- Modify: `src/20-theme-nav.js` (`emptyState`), `src/62-global-clicks.js` (`onEmptyActionClick`)
- Modify: `src/30-home.js:170,223`, `src/36-timeline.js:47`, `src/40-calendar.js` (`renderDayPanel`), `src/50-notes.js:35`, `src/60-lists.js:101`, `src/61-wishes.js` (`renderWishlist`), `src/71-photo-grid.js:110`, `src/72-photo-labels.js:61,160`
- Modify: `styles.css` («Фаза D: единый стиль пустых состояний»)
- Test: `tests/uni-smoke.js`

**Interfaces:**
- Consumes: `navIconHtml(id)`, иконки спрайта `notes`, `lists`, `wishlist`, `photos`, `calendar`, `heart`, `tag`.
- Produces: `emptyState(icon: string, text: string, action?: [label: string, key: 'event'|'photo']) → SafeHtml`; `onEmptyActionClick(e)`.

- [ ] **Step 1: Тесты (красные)**

`tests/uni-smoke.js`, суффикс: `s.emptyState = emptyState; s.onEmptyActionClick = onEmptyActionClick;`. Новый блок после проверок списков:

```js
  // --- Фаза 9 (NV-62): пустые экраны одного вида, с действием там, где его нет рядом ---
  const es = String(w('(s)=>s.emptyState("photos","Здесь будут ваши фото.",["Загрузить фото","photo"])'));
  assert(es.includes('class="empty-state"') && es.includes('#icon-photos') && es.includes('data-empty-action="photo"'), 'emptyState: иконка, текст и кнопка действия');
  assert(!String(w('(s)=>s.emptyState("notes","x")')).includes('data-empty-action'), 'emptyState без действия — без кнопки');
  w('(s)=>{s.db.photos.length=0;s.renderPhotosNow();return 1;}');
  assert(registry['#photosGrid'].innerHTML.includes('data-empty-action="photo"') && !registry['#photosGrid'].innerHTML.includes('синхронизация в Настройках'), 'пустая галерея: действие есть, устаревшего текста про синхронизацию нет');
  let pickerClicked = 0;
  registry['#photoInput'].click = () => pickerClicked++;
  w('(s)=>{s.onEmptyActionClick({target:{closest:()=>({dataset:{emptyAction:"photo"}})}});return 1;}');
  assert(pickerClicked === 1, 'кнопка пустой галереи открывает выбор файлов');
  w('(s)=>{s.onEmptyActionClick({target:{closest:()=>({dataset:{emptyAction:"event"}})}});return 1;}');
  assert(registry['#eventOverlay'].hidden === false, 'кнопка пустой оси открывает шторку памятной даты');
  w('(s)=>{s.closeOverlay("eventOverlay");return 1;}');
```

(`registry['#photoInput']` уже создан: `src/70-photos.js` вешает на него `change` при загрузке. Если в registry его нет — сначала `w('(s)=>s.document.querySelector("#photoInput")')`.)

Проверка пустого состояния списков (`'Пока нет ни одного списка'`) остаётся как есть — новый текст её сохраняет.

Run: `node build.js && node tests/uni-smoke.js app.js` → FAIL `emptyState is not defined`.

- [ ] **Step 2: Помощник и делегат**

`src/20-theme-nav.js`, сразу после `navIconHtml`:

```js
// Пустой экран (фаза 9, NV-62): иконка раздела, одна фраза о том, что здесь
// появится, и кнопка первого действия — только если этого действия нет рядом
// на экране (у заметок поле ввода прямо над пустотой, у оси — ничего).
// action — [подпись, ключ из onEmptyActionClick] или ничего.
function emptyState(icon, text, action) {
  return html`<div class="empty-state">${navIconHtml(icon)}<p>${text}</p>${action ? html`<button type="button" class="btn" data-empty-action="${action[1]}">${action[0]}</button>` : ''}</div>`;
}
```

`src/62-global-clicks.js`, в конец файла:

```js
// Кнопки пустых экранов (emptyState, 20-theme-nav.js). Именованная — тест
// дёргает напрямую (в песочнице document.addEventListener не хранит обработчики).
function onEmptyActionClick(e) {
  const btn = e.target && e.target.closest ? e.target.closest('[data-empty-action]') : null;
  if (!btn) return;
  const key = btn.dataset.emptyAction;
  if (key === 'event') openEventModal();
  if (key === 'photo') $('#photoInput').click();
}
document.addEventListener('click', onEmptyActionClick);
```

- [ ] **Step 3: Все пустые экраны**

| Файл | Было | Стало |
|---|---|---|
| `src/30-home.js` `renderDates` | `<div class="empty-state dates-empty">💘 Свиданий пока нет.<br />…</div>` | `emptyState('heart', 'Свиданий пока нет. Назначь первое — партнёр получит приглашение.')` |
| `src/30-home.js` (ближайшие, ~223) | `<p class="cal-tip">Ближайших свиданий пока нет. Самое время назначить новое! ✨</p>` | `emptyState('heart', 'Ближайших свиданий нет — самое время назначить новое.')` |
| `src/36-timeline.js` `renderTimeline` | `<div class="empty-state rem-empty">Пока пусто 💜<br />…</div>` | `emptyState('calendar', 'Здесь сложится ваша история: прошедшие события, свидания и фото с датой.', ['Добавить памятную дату', 'event'])` |
| `src/40-calendar.js` `renderDayPanel` | `<p class="cal-tip">В этот день событий пока нет.</p>` | без изменений (строка добавления прямо под ней) |
| `src/50-notes.js` `renderNotes` | `<div class="empty-state">Пока пусто. Напиши первую записку! 💌</div>` | `emptyState('notes', 'Заметок пока нет. Напиши первую — она появится у вас обоих.')` |
| `src/60-lists.js` `renderLists` | `<div class="empty-state rem-empty">Пока нет ни одного списка 🫧<br>…</div>` | `emptyState('lists', 'Пока нет ни одного списка. Впиши название выше — например, «Подарки на 8 марта».')` |
| `src/61-wishes.js` `renderWishlist` | `<p class="cal-tip">${empty}</p>` | `emptyState('wishlist', empty)`; тексты: свой — `'Твой список пуст. Нажми «Добавить» — партнёр увидит, о чём ты мечтаешь.'`, чужой — `'У ' + (who === 'gosha' ? 'Гоши' : 'Даши') + ' пока нет хотелок.'` (выбор по `who === getUser()`) |
| `src/71-photo-grid.js` `renderPhotosNow` | `<p class="cal-tip">📷 Загрузите ваши фото — …синхронизация в Настройках.</p>` | `emptyState('photos', 'Здесь будут ваши фото. Они хранятся зашифрованными и видны вам обоим.', ['Загрузить фото', 'photo'])` |
| `src/72-photo-labels.js` (61, 160) | `<p class="cal-tip">…лейбла…</p>` | без изменений (поле создания рядом) |

Пустая галерея рендерится внутри `#photosGrid` (CSS grid) — у `.empty-state` там `grid-column:1/-1` (шаг 4).

- [ ] **Step 4: CSS**

Блок «Фаза D: единый стиль пустых состояний» заменить:

```css
/* ===== Пустые экраны (фаза 9, NV-62) =====
   Тихо: без пунктирной янтарной рамки (акцент — не декор), иконка раздела
   приглушённая, действие — единственная кнопка. */
.empty-state{
  grid-column:1/-1;display:grid;justify-items:center;gap:12px;
  padding:40px 24px;text-align:center;color:var(--ink-2);font-size:var(--text-base);
  border:1px dashed var(--line);border-radius:var(--radius-card);
}
.empty-state .nav-icon{width:32px;height:32px;color:var(--line)}
.empty-state p{max-width:36ch}
```

Удалить: `.dates-empty{…}` (раздел «Свидания»), `.rem-empty{…}` («Таймлайн-дерево»), и `.dates-empty,.rem-empty` из перечислений стекла в «Фаза D: Glass-карточки». `grep -n "dates-empty\|rem-empty" src styles.css tests` → пусто (кроме удалённых).

- [ ] **Step 5: Прогон**

Run: `npm run check` → exit 0.

Снимки стенда пустых экранов не показывают (фикстуры полные). Проверка глазами: на стенде в консоли `db.notes.length=0; renderNotes()`, `db.lists=[]; renderLists()`, `db.photos.length=0; renderPhotosNow()` в обеих темах на 390 px — иконка, фраза, у галереи кнопка «Загрузить фото» открывает выбор файлов. `node tools/shots.js task-9 && node tools/shots-diff.js phase-9-start task-9` → `OK` (заполненные экраны не изменились).

- [ ] **Step 6: Commit**

```bash
git add src/20-theme-nav.js src/62-global-clicks.js src/30-home.js src/36-timeline.js src/50-notes.js src/60-lists.js src/61-wishes.js src/71-photo-grid.js styles.css tests/uni-smoke.js app.js
git commit -m "Feat: пустые экраны одного вида — иконка, фраза, действие; устаревший текст пустой галереи (NV-62)"
```

### Task 10: Загрузка, ошибки, офлайн (NV-62)

**Files:**
- Modify: `index.html` (скелетон в `#gateScreen`, `id="gateCard"`, иконка `icon-offline`, плашка офлайна)
- Modify: `src/01-gate.js` (`showBootSkeleton`), `src/40-calendar.js` (`loadCalMonthNeighbors`), `src/71-photo-grid.js` (скелетон-плитки, ошибка догрузки), `src/70-photos.js` (ошибка сохранения фото), `src/20-theme-nav.js` (`onOffline`), `src/00-core.js` (`notify`)
- Modify: `styles.css`
- Test: `tests/uni-smoke.js`

**Interfaces:**
- Consumes: токены `--dur-loop`, `--dur-state`, keyframes `shimmer` (Task 6).
- Produces: `showBootSkeleton(on: boolean)`, `onOffline()`; класс `.sk` (скелетон-блок с шиммером) — его использует Task 11.

- [ ] **Step 1: Тесты (красные)**

Суффикс `tests/uni-smoke.js`: `s.showBootSkeleton = showBootSkeleton; s.onOffline = onOffline; s.loadCalMonthNeighbors = loadCalMonthNeighbors;`. Новый блок:

```js
  // --- Фаза 9 (NV-62): загрузка, ошибки, офлайн ---
  w('(s)=>{s.showBootSkeleton(true);return 1;}');
  assert(registry['#bootSkeleton'].hidden === false && registry['#gateCard'].hidden === true, 'загрузка после входа: скелетон вместо карточки входа');
  w('(s)=>{s.showBootSkeleton(false);return 1;}');
  assert(registry['#bootSkeleton'].hidden === true && registry['#gateCard'].hidden === false, 'скелетон снят — карточка входа вернулась (на ней покажется ошибка, если она была)');
  w('(s)=>{s.onOffline();return 1;}');
  assert(registry['#appToast'].textContent.includes('Нет сети') && registry['#appToast'].textContent.includes('уйдёт'), 'офлайн: тост объясняет, что изменения не пропадут');
```

Проверка ошибки месяца календаря — в `tests/uni-repo.js`: там живой мок Firestore, и отказ чтения можно подстроить в самом моке (подменить `fsCol` из теста нельзя — код `w(...)` исполняется вне области видимости `app.js`). Суффикс `tests/uni-repo.js`: `s.jumpCalendar = jumpCalendar;` и `Object.defineProperty(s, 'toastText', { get: () => (document.querySelector('#appToast') || {}).textContent, configurable: true });`.

В `tests/fs-mock.js` в `colRef.get()`:

```js
      async get() {
        colGetCount++;
        if (forcedGetError && path.endsWith('/' + forcedGetError)) {
          forcedGetError = null;
          throw new Error('offline (мок)');
        }
        return { docs: run() };
      },
```

объявление `let forcedGetError = null;` рядом с `forcedWriteError`, и в возвращаемый объект мока:

```js
    _failNextGet(collection) {
      forcedGetError = collection;
    },
```

Тогда тест в `tests/uni-repo.js`:

```js
  // Фаза 9 (NV-62): месяц календаря не догрузился — человек узнаёт, а не смотрит в пустую сетку
  mock._failNextGet('events');
  w('(s)=>{ s.jumpCalendar(4, 2031); return 1; }'); // jumpCalendar → loadCalMonthNeighbors
  await new Promise(r => setTimeout(r, 20));
  assert(String(w('(s)=>s.toastText')).includes('Не удалось загрузить события'), 'ошибка догрузки месяца — тост с объяснением');
```

Run: `node build.js && node tests/uni-smoke.js app.js` → FAIL `showBootSkeleton is not defined`; `node tests/uni-repo.js app.js` → FAIL на тосте.

- [ ] **Step 2: Скелетон после входа**

`index.html`, внутри `#gateScreen`: у `.auth-card` добавить `id="gateCard"`; после неё:

```html
    <!-- Пока после входа грузятся данные (фаза 9): форма будущей Главной, а не строка «Загружаем…» -->
    <div class="boot-skeleton" id="bootSkeleton" hidden aria-busy="true" aria-label="Загружаем">
      <span class="sk sk-ring"></span>
      <span class="sk sk-line"></span>
      <span class="sk sk-line sk-short"></span>
      <span class="sk sk-card"></span>
      <span class="sk sk-card"></span>
    </div>
```

`src/01-gate.js`, рядом с `showAuth`:

```js
// Загрузка после входа (фаза 9): скелетон формы Главной вместо карточки входа.
// false — карточка возвращается (на ней ошибка, если вход не удался).
function showBootSkeleton(on) {
  const sk = $('#bootSkeleton');
  const card = $('#gateCard');
  if (sk) sk.hidden = !on;
  if (card) card.hidden = on;
}
```

`tryEnterWithUser`: `showGateErr('Загружаем…');` → `showBootSkeleton(true);`; в `catch` первой строкой `showBootSkeleton(false);`. `unlockApp`: первой строкой `showBootSkeleton(false);`.

`styles.css` (раздел «Личный кабинет»):

```css
.auth-card[hidden],.boot-skeleton[hidden]{display:none}
.boot-skeleton{width:min(420px,100%);display:grid;justify-items:center;gap:16px}
/* Скелетон повторяет форму будущего содержимого (NV-62): орбита, две строки, две карточки */
.sk{display:block;border-radius:var(--radius-card);background:linear-gradient(100deg,var(--sky-1) 30%,var(--sky-2) 50%,var(--sky-1) 70%);background-size:200% 100%;animation:shimmer var(--dur-loop) ease-in-out infinite}
.sk-ring{width:min(78vw,300px);aspect-ratio:1;border-radius:50%}
.sk-line{width:60%;height:14px;border-radius:var(--radius-pill)}
.sk-short{width:40%}
.sk-card{width:100%;height:88px}
```

- [ ] **Step 3: Календарь — загрузка и ошибка месяца**

`src/40-calendar.js`, `loadCalMonthNeighbors`:

```js
// Сколько догрузок текущего месяца в полёте: быстрые перелистывания
// накладываются, aria-busy снимается, когда закончилась последняя.
let calLoads = 0;
function loadCalMonthNeighbors() {
  const cal = $('#calendar');
  calLoads++;
  if (cal) cal.setAttribute('aria-busy', 'true');
  loadMonth(calY, calM)
    .then(() => renderCalendar())
    .catch(() => notify('Не удалось загрузить события этого месяца. Проверь интернет и открой месяц ещё раз.', true))
    .finally(() => {
      if (--calLoads === 0 && cal) cal.removeAttribute('aria-busy');
    });
  // соседние — заранее и молча: не догрузились сейчас — догрузятся при переходе
  loadMonth(calM === 0 ? calY - 1 : calY, calM === 0 ? 11 : calM - 1).catch(() => {});
  loadMonth(calM === 11 ? calY + 1 : calY, calM === 11 ? 0 : calM + 1).catch(() => {});
}
```

`let calLoads` читается только внутри функции, вызываемой после загрузки, — TDZ не грозит (урок 1: проверить `grep -n "loadCalMonthNeighbors" src/*.js` — вызовы только из обработчиков и `jumpCalendar`).

`styles.css`, раздел «Календарь»: ячейки притухают, только если загрузка дольше `--dur-state` (быстрый ответ из офлайн-кэша не мигает):

```css
.calendar[aria-busy="true"] .cal-cell:not(.cal-dow){opacity:.55;transition:opacity var(--dur-state) var(--dur-state)}
```

- [ ] **Step 4: Галерея — скелетон-плитки, ошибки**

`src/71-photo-grid.js`, `renderPhotosNow`: пока есть следующая страница — в конце сетки три плитки-скелетона (класс `photo-sk`, **не** `photo`: обработчики галереи ищут `.photo[data-id]`):

```js
  const skeleton = photosCursor && list.length ? html`${[0, 1, 2].map(() => html`<div class="photo-sk sk" aria-hidden="true"></div>`)}` : '';
  render(grid, html`${cards}${skeleton}<div id="photosSentinel" aria-hidden="true" style="grid-column:1/-1;height:1px"></div>`);
```

Наблюдатель `photosObserver`: `loadMorePhotos().then(added => { if (added) renderPhotos(); });` →

```js
    loadMorePhotos()
      .then(added => {
        if (added) renderPhotos();
      })
      .catch(() => notify('Не удалось догрузить фото. Проверь интернет — продолжу, когда прокрутишь ещё раз.', true));
```

`src/70-photos.js`, обработчик `#photoInput`: оба `console.warn('Не удалось сохранить фото в хранилище', err)` / `console.warn('Не удалось загрузить фото', err)` оставить и добавить после каждого `notify('Фото «' + f.name + '» не сохранилось — попробуй загрузить его ещё раз.', true);`.

`styles.css`, раздел «Фото»: `.photo-sk{aspect-ratio:1;border-radius:var(--radius-media)}`; правило `.photo:has(img[data-photo-src]){…}` оставить (миниатюра, которая ещё качается).

- [ ] **Step 5: Офлайн и тост**

Иконка (Phosphor `wifi-slash-fill`) — в спрайт `index.html`:

```html
<symbol id="icon-offline" viewBox="0 0 256 256"><path d="M213.92,210.62a8,8,0,1,1-11.84,10.76l-33.67-37-28.1,33.88A15.93,15.93,0,0,1,128,224h0a15.93,15.93,0,0,1-12.31-5.77L11.65,92.8A15.65,15.65,0,0,1,8.11,80.91,15.93,15.93,0,0,1,14.28,70.1,188.26,188.26,0,0,1,46.6,50.35l-4.29-4.72a8.22,8.22,0,0,1,.13-11.38,8,8,0,0,1,11.48.37Zm34-129.71a15.93,15.93,0,0,0-6.17-10.81A186.67,186.67,0,0,0,128,32a191,191,0,0,0-42.49,4.75,4,4,0,0,0-2,6.59L186,156.07a4,4,0,0,0,6-.14L244.35,92.8A15.65,15.65,0,0,0,247.89,80.91Z"/></symbol>
```

Плашка: `<span class="offline-badge" id="offlineBadge" hidden title="Изменения сохранятся и уйдут, когда связь вернётся"><svg class="nav-icon" aria-hidden="true"><use href="#icon-offline"></use></svg>Нет сети</span>`.

`src/20-theme-nav.js`, блок плашки:

```js
// Ушли в офлайн — один раз объясняем, что будет с изменениями: Firestore
// копит записи локально и отправит их сам (см. комментарий в src/04-repo.js).
function onOffline() {
  updateOfflineBadge();
  notify('Нет сети. Всё, что изменишь, сохранится и уйдёт, когда связь вернётся.');
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('online', updateOfflineBadge);
  window.addEventListener('offline', onOffline);
}
```

`src/00-core.js`, `notify` — текст ставится **после** переноса тоста в верхний диалог (NV-97: живой регион объявляет изменение содержимого, случившееся уже на месте; до переноса скринридер мог промолчать):

```js
function notify(msg, isError) {
  const t = $('#appToast');
  if (!t) return;
  t.classList.toggle('toast-error', !!isError);
  setPopover(t, false);
  setPopover(t, true); // скрыть и показать заново — встаёт поверх диалога, открытого позже него
  t.textContent = msg; // после переноса: aria-live объявляет изменение на новом месте (NV-97)
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    setPopover(t, false);
  }, 5000);
}
```

- [ ] **Step 6: Прогон**

Run: `npm run check` → exit 0.

Run: `node tools/shots.js task-10 && node tools/shots-diff.js phase-9-start task-10`
Expected: `DIFF:` — `*-photos.png` (скелетон-плитки в конце, если в фикстурах больше страницы — иначе без изменений). Глазами на стенде: DevTools → Network → Offline → плашка с иконкой и тост; в консоли `showBootSkeleton(true); document.body.classList.add('auth')` — скелетон формы Главной в обеих темах, `showBootSkeleton(false); document.body.classList.remove('auth')` — вернуть.

- [ ] **Step 7: Commit**

```bash
git add index.html styles.css src/00-core.js src/01-gate.js src/20-theme-nav.js src/40-calendar.js src/70-photos.js src/71-photo-grid.js tests/uni-smoke.js tests/uni-repo.js tests/fs-mock.js app.js
git commit -m "Feat: скелетон после входа, загрузка и ошибки месяца/галереи/фото, офлайн объясняет, тост объявляется на своём месте (NV-62, NV-97)"
```

### Task 11: Ось Главной дочитывает прошлое (NV-96)

`memoryByDay()` строит ось из `db`, а в `db` после входа — события текущего месяца, повторяющиеся и первые `PHOTO_PAGE = 60` фото по порядку галереи. Прошлые разовые события попадают на ось, только если кто-то открыл их месяц в Календаре; фото дальше первых 60 — никогда. Спека 2.2: ось «подгружается страницами, как в галерее».

**Files:**
- Modify: `src/00-core.js` (состояние оси), `src/04-repo.js` (`loadAxisPage`, `axisHasMore`), `src/36-timeline.js` (`renderTimeline`, наблюдатель), `src/35-memory.js` (стабильные id групп, `memoryExpanded`)
- Modify: `tests/fs-mock.js` (оператор `<`)
- Modify: `styles.css` («Ось времени»)
- Test: `tests/uni-repo.js`, `tests/uni-smoke.js`

**Interfaces:**
- Consumes: `.sk` (Task 10), `mergeById`, `docsToArray`, `monthRange` (`src/04-repo.js`).
- Produces: `loadAxisPage(): Promise<number>` (сколько записей добавилось), `axisHasMore(): boolean`; `memoryExpanded: Set<string>`.

- [ ] **Step 1: Мок умеет `<`**

`tests/fs-mock.js`, в `run()` среди операторов: `if (op === '<') return v < value;`.

- [ ] **Step 2: Тест слоя данных (красный)**

`tests/uni-repo.js`, суффикс: `s.loadAxisPage = loadAxisPage; s.axisHasMore = axisHasMore;`. Блок после теста гонки `loadMorePhotos`:

```js
  // NV-96: ось дочитывает прошлое, которого нет в горячем наборе — разовые
  // события раньше текущего месяца (один раз все) и фото по дате съёмки страницами.
  Object.keys(mock._store).forEach(k => delete mock._store[k]);
  mock._store['couples/main/events/old1'] = { title: 'Поездка', date: '2025-05-12', repeat: false };
  for (let i = 0; i < 70; i++) mock._store['couples/main/photos/ax' + i] = { order: i, ts: i, takenAt: Date.UTC(2024, 0, 1) + i * 864e5 };
  w('(s)=>{ s.db = s.defaultDB(); return 1; }');
  await w('(s)=>s.loadHotSet()');
  assert(!w('(s)=>s.db.events.some(e=>e.id==="old1")'), 'разовое прошлое событие не в горячем наборе');
  assert(w('(s)=>s.axisHasMore()') === true, 'у оси есть что дочитать');
  const added1 = await w('(s)=>s.loadAxisPage()');
  assert(w('(s)=>s.db.events.some(e=>e.id==="old1")'), 'первая страница оси принесла прошлые разовые события');
  assert(w('(s)=>s.db.photos.some(p=>p.id==="ax69")'), 'и самые свежие по дате съёмки фото — даже если они дальше первых 60 по порядку галереи');
  assert(added1 > 0, 'loadAxisPage вернула число добавленных записей');
  await w('(s)=>s.loadAxisPage()');
  assert(w('(s)=>s.db.photos.filter(p=>p.id.startsWith("ax")).length') === 70, 'вторая страница дочитала остаток, без дублей');
  assert(w('(s)=>s.axisHasMore()') === false, 'прошлое дочитано до конца');
  const getsEnd = mock._colGetCount;
  await w('(s)=>s.loadAxisPage()');
  assert(mock._colGetCount === getsEnd, 'дочитанная ось больше не ходит в Firestore');
```

Run: `node build.js && node tests/uni-repo.js app.js` → FAIL `axisHasMore is not a function`.

- [ ] **Step 3: Слой данных**

`src/00-core.js`, рядом с `photosCursor`/`photosLoadingMore`:

```js
// Ось Главной (NV-96): что из прошлого уже дочитано сверх горячего набора.
let axisEventsLoaded = false; // все разовые события раньше окна текущего месяца
let axisPhotosCursor = null; // курсор фото по дате съёмки (takenAt desc)
let axisPhotosDone = false;
let axisLoading = false; // защита от параллельных догрузок, как photosLoadingMore
```

`src/04-repo.js`, после `loadMorePhotos`:

```js
// Ось времени (NV-96): прошлое, которого нет в горячем наборе. События — один
// раз все разовые раньше окна текущего месяца (их единицы-десятки, документы
// маленькие); фото — страницами по дате съёмки, от новых к старым. Фото без
// takenAt Firestore в такой выборке не отдаёт — на ось они и так не попадают
// (memoryByDay). Дочитанные фото ложатся в тот же db.photos: галерея
// сортирует по order и покажет их на своём месте раньше, чем до них дойдёт её
// собственная страница, — это не дубль (mergeById), а ранний показ.
function axisHasMore() {
  return fsReady && (!axisEventsLoaded || !axisPhotosDone);
}
async function loadAxisPage() {
  if (!axisHasMore() || axisLoading) return 0;
  axisLoading = true;
  try {
    let added = 0;
    if (!axisEventsLoaded) {
      const now = new Date();
      const [fromIso] = monthRange(now.getFullYear(), now.getMonth());
      const snap = await fsCol('events').where('date', '<', fromIso).get();
      const before = db.events.length;
      db.events = mergeById(db.events, docsToArray(snap));
      added += db.events.length - before;
      axisEventsLoaded = true;
    }
    let q = fsCol('photos').orderBy('takenAt', 'desc');
    if (axisPhotosCursor) q = q.startAfter(axisPhotosCursor);
    const snap = await q.limit(PHOTO_PAGE).get();
    const before = db.photos.length;
    db.photos = mergeById(db.photos, docsToArray(snap));
    added += db.photos.length - before;
    if (snap.docs.length) axisPhotosCursor = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PHOTO_PAGE) axisPhotosDone = true;
    return added;
  } finally {
    axisLoading = false;
  }
}
```

Порядок `startAfter` → `limit` у мока не важен; у настоящего Firestore тоже.

Индекс: одиночный `orderBy('takenAt','desc')` без `where` обслуживается автоматическим однополевым индексом — `firestore.indexes.json` не трогаем. Проверить на живом сайте (в отчёт): первая догрузка оси не падает с `FAILED_PRECONDITION`.

Run: `node build.js && node tests/uni-repo.js app.js` → OK.

- [ ] **Step 4: Ось — догрузка у конца и скелетон**

`src/36-timeline.js`, `renderTimeline`, строку метки:

```js
      ${shown < days.length || axisHasMore() ? html`<div class="axis-more" data-axis-more aria-hidden="true"><span class="axis-dot"></span><div class="tl-card sk"></div></div>` : ''}
```

Наблюдатель:

```js
if (typeof IntersectionObserver === 'function') {
  timelineObserver = new IntersectionObserver(
    entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        timelineObserver.unobserve(e.target);
        const box = e.target.closest('[data-axis]');
        // Локально показано всё — дочитываем прошлое из Firestore (NV-96).
        // Ошибка: метка остаётся неотслеживаемой до следующей перерисовки
        // (живое обновление, возврат на Главную) — без бесконечных повторов.
        if ((timelineShown.get(box) || 0) < memoryByDay().length) renderTimeline(box, true);
        else
          loadAxisPage()
            .then(() => renderTimeline(box, true))
            .catch(() => notify('Не удалось догрузить прошлое — проверь интернет.', true));
      }
    },
    { rootMargin: '600px 0px' }
  );
}
```

Если `loadAxisPage` вернула 0, а `axisHasMore()` всё ещё `true` (страница фото целиком уже была в `db`), `renderTimeline` снова рисует метку, наблюдатель снова срабатывает, курсор идёт дальше — цикл конечен, потому что каждый вызов двигает курсор или ставит `axisPhotosDone`.

`styles.css`, «Ось времени»: `.axis-more{height:1px}` →

```css
/* Метка догрузки оси — она же скелетон следующего дня (виден, только если сеть медленная) */
.axis-more{position:relative;margin-bottom:24px}
.axis-more .tl-card{height:96px}
```

- [ ] **Step 5: Раскрытый ряд фото переживает перерисовку (NV-97)**

Фоновая перерисовка Главной (живое обновление из Firestore) сворачивала раскрытый «Показать ещё»: id групп были позиционными (`'day' + gid.n++`), а раскрытость жила только в DOM.

`src/35-memory.js`, `memoryByDay`: в `d.events.push({…})` добавить `id: ev.id`, в `d.dates.push({…})` — `id: dt.id`. Над `memoryPhotosHtml`:

```js
// Раскрытые ряды «Показать ещё» по стабильному id группы — перерисовка оси
// (живое обновление) их не сворачивает (NV-97).
const memoryExpanded = new Set();
```

`memoryPhotosHtml` — раскрытый ряд рисуется раскрытым:

```js
function memoryPhotosHtml(photos, groupId, rowCls) {
  const shown = photos.slice(0, MEMORY_PHOTOS_PREVIEW);
  const rest = photos.slice(MEMORY_PHOTOS_PREVIEW);
  const open = memoryExpanded.has(groupId);
  return html`<div class="${rowCls}" data-photo-group="${groupId}" data-more-count="${rest.length}" data-expanded="${open ? '1' : '0'}">
    ${shown.map(p => tlPhotoImg(p))}${
      rest.length
        ? html`<button class="tl-more-btn" data-tl-expand="${groupId}" title="Показать ещё фото">${open ? 'Свернуть' : 'Показать ещё ' + rest.length}</button>${rest.map(p => tlPhotoImg(p, open ? '' : 'tl-more-photo'))}`
        : ''
    }
  </div>`;
}
```

`tlPhotoImg(p, extraCls)`: с пустым `extraCls` фото рисуется видимым — уже так (`${extraCls ? … : ''}`), но тогда у раскрытых фото нет класса `tl-more-photo`, и `toggleMemoryPhotos` при сворачивании их не найдёт. Поэтому раскрытое рисовать с классом, но без `display:none`: в `tlPhotoImg` второй параметр — флаг видимости:

```js
function tlPhotoImg(p, more, open) {
  const url = photoSrc(p);
  return html`<img alt="" data-lightbox="${p.id}" ${more ? html`class="tl-more-photo" ${open ? '' : raw('style="display:none"')}` : ''} ${url ? html`src="${url}"` : html`data-photo-src="${p.id}"`} />`;
}
```

и в `memoryPhotosHtml` — `rest.map(p => tlPhotoImg(p, true, open))`, `shown.map(p => tlPhotoImg(p))`.

`toggleMemoryPhotos` — после вычисления `collapse`:

```js
  const gid = row.dataset && row.dataset.photoGroup;
  if (gid) collapse ? memoryExpanded.delete(gid) : memoryExpanded.add(gid);
```

`src/36-timeline.js`, `memoryDayHtml(day)` — без счётчика, id стабильные:

```js
function memoryDayHtml(day) {
  …
  if (day.photos.length) card.push(memoryPhotosHtml(day.photos, 'day-' + day.date, 'tl-photos'));
  for (const d of day.dates) {
    …
    if (d.photos && d.photos.length) card.push(memoryPhotosHtml(d.photos, 'dt-' + d.id, 'tl-item-photos'));
  }
  for (const ev of day.events) {
    …
    if (ev.photos.length) card.push(memoryPhotosHtml(ev.photos, 'ev-' + ev.id, 'tl-item-photos'));
  }
  …
}
```

и в `renderTimeline` убрать `const gid = { n: 0 };`, вызов — `y.days.map(d => memoryDayHtml(d))`.

Тест (`tests/uni-smoke.js`, рядом с проверками `memoryPhotosHtml`, строка ~1345):

```js
  // NV-97: раскрытый ряд переживает перерисовку
  const fourPh = '[{id:"a",title:"1"},{id:"b",title:"2"},{id:"c",title:"3"},{id:"d",title:"4"}]';
  w(`(s)=>{ s.memoryExpanded.add("day-2025-06-06"); return 1; }`);
  const openRow = String(w(`(s)=>s.memoryPhotosHtml(${fourPh},"day-2025-06-06","tl-photos")`));
  assert(openRow.includes('data-expanded="1"') && openRow.includes('Свернуть') && !openRow.includes('display:none'), 'раскрытый ряд рисуется раскрытым после перерисовки');
  w(`(s)=>{ s.memoryExpanded.clear(); return 1; }`);
```

и в суффикс `s.memoryExpanded = memoryExpanded;`. Существующий тест делегата (строки ~1361-1387) использует `"day0"` как произвольное имя группы — он не зависит от формата и остаётся.

Run: `node build.js && node tests/uni-smoke.js app.js` → OK. Проверить, что тест ловит: временно убрать `const open = memoryExpanded.has(groupId);` → `const open = false;` → FAIL «раскрытый ряд…»; вернуть.

- [ ] **Step 6: Глубина оси — замер, не угадывание (NV-97)**

`timelineShown` не уменьшается: после глубокой прокрутки каждое живое обновление перерисовывает все раскрытые дни. Чинить только по замеру. На стенде, Главная, в консоли:

```js
db.events.push(...Array.from({ length: 300 }, (_, i) => ({ id: 'm' + i, title: 'x', date: iso(2020, 0, 1 + i), emoji: '💜', repeat: false })));
const box = document.querySelector('#homeTimeline');
for (let i = 0; i < 10; i++) renderTimeline(box, true);
const t = [];
for (let i = 0; i < 5; i++) { const a = performance.now(); renderTimeline(box); t.push(performance.now() - a); }
t.sort((a, b) => a - b)[2];
```

Медиана < 16 мс — записать число в отчёт и в `docs/superpowers/baseline/metrics.md` (раздел «Ось времени: перерисовка на глубине 300 дней»), пункт NV-97 закрыт без правки кода. ≥ 16 мс — в `showView` при уходе с Главной `timelineShown.clear()` (прокрутка при смене вкладки всё равно не сохраняется), замер повторить, записать оба числа.

- [ ] **Step 7: Прогон и commit**

Run: `npm run check` → exit 0. `node tools/shots.js task-11 && node tools/shots-diff.js phase-9-start task-11` → на стенде нет Firestore (`fsReady=false`, `axisHasMore()` → `false`) — ось рисуется как раньше, `DIFF:` только то, что уже было в Task 10.

```bash
git add src/00-core.js src/04-repo.js src/35-memory.js src/36-timeline.js styles.css tests/fs-mock.js tests/uni-repo.js tests/uni-smoke.js docs/superpowers/baseline/metrics.md app.js
git commit -m "Feat: ось Главной дочитывает прошлое из Firestore страницами, раскрытые ряды фото переживают перерисовку (NV-96, NV-97)"
```

### Task 12: Закрыть фазу 9

- [ ] **Step 1: Ревью ветки** — `node tools/shots.js phase-9-end`; скилл `superpowers:requesting-code-review` на `main..redesign-phase-9` с Global Constraints и уроками в брифе; фиксы — отдельными коммитами `Fix: … (K1)`, `(K2)`…, после них `npm run check` и `browser-check` → `ИТОГ: OK`. В бриф отдельно: «ищи места, где ошибка сети по-прежнему уходит только в console.warn или в необработанный rejection: `grep -n "\.then(" src/*.js` без `.catch`».
- [ ] **Step 2: PROJECT-MEMORY 0j** — `emptyState`/`onEmptyActionClick` (ключи `event`, `photo`), `.sk`, `showBootSkeleton`, `calLoads`/`aria-busy`, `onOffline`, порядок в `notify`, `loadAxisPage`/`axisHasMore` и «ранний показ» дочитанных фото в галерее (не баг), `memoryExpanded`, стабильные id групп `day-/dt-/ev-`. Снять пункт «Известное ограничение (NV-96)» из `0g`. README — абзац «Состояния».
- [ ] **Step 3: Мёрж и деплой** — `git commit -m "Docs: фаза 9 — снимок 0j, состояния в README"`; `superpowers:finishing-a-development-branch`: мёрж `redesign-phase-9` в `main`, push, `gh run list --limit 2` → `success`, версия `app.min.js` на проде сменилась; журнал SDD — в основной checkout (урок 6). После деплоя на живом сайте: прокрутить ось Главной до конца — старые события и фото появляются, в консоли нет `FAILED_PRECONDITION` (в отчёт).

---

# ФАЗА 10 — Финал

Ветка `redesign-phase-10` от `main`. Перед Task 13: `node tools/shots.js phase-10-start`.

### Task 13: Клавиатура и фокус

**Files:**
- Modify: `src/20-theme-nav.js` (roving tabindex «Наше»), `src/36-timeline.js` + `src/35-memory.js` (миниатюры оси с клавиатуры), `src/35-memory.js:165` (aria-label орбиты), `src/85-lightbox.js` (`openLightboxFrom` — визуальный порядок)
- Modify: `tools/browser-check.js` (`checkKeyboard`)
- Test: `tests/uni-smoke.js`

**Interfaces:**
- Produces: `onOurSwitchKeydown(e)` в `src/20-theme-nav.js`.

- [ ] **Step 1: Тесты (красные)**

`tests/uni-smoke.js`, блок годовщины (строки ~1403-1404): `assert(!annivHtml.includes('до годовщины'), …)` →

```js
  assert(!/до годовщины/i.test(annivHtml), 'в день годовщины фразы «до годовщины» нет ни в тексте, ни в aria-label (NV-97: регистрозависимая проверка пропускала «До годовщины»)');
```

Сначала убедиться, что новая проверка **падает** на текущем коде (урок 4) — aria-label пока «До годовщины 0 дней».

Порядок лайтбокса в плотной сетке — после блока «Фаза 6: плитка → лайтбокс»:

```js
  // --- Фаза 10 (NV-97): стрелки лайтбокса идут в визуальном порядке сетки, а не DOM ---
  {
    const mk = (id, top, left) => ({ dataset: { photo: id }, style: {}, getBoundingClientRect: () => ({ top, left }) });
    const tiles = [mk('a', 0, 0), mk('b', 0, 200), mk('c', 200, 0), mk('d', 100, 400)]; // dense поднял «d» во вторую строку
    const grid = { querySelectorAll: () => tiles };
    tiles.forEach(t => (t.closest = sel => (sel === '#photosGrid' || sel === '.view' ? grid : null)));
    sandbox.__denseTile = tiles[0];
    w('(s)=>{ s.openLightboxFrom(s.__denseTile); return 1; }');
    assert(w('(s)=>s.lightboxList.join("")') === 'abdc', 'dense-сетка: порядок лайтбокса — сверху вниз, слева направо');
    delete sandbox.__denseTile;
    w('(s)=>{ s.closeOverlay("lightbox"); return 1; }');
  }
```

Тест обратного перелёта (NV-97: «не отличает перелёт от прямого закрытия») — в блоке «Фаза 6: плитка → лайтбокс общим элементом» заглушку заменить на считающую:

```js
  let svtFly = 0;
  sandbox.document.startViewTransition = cb => { svtFly++; cb(); return { finished: Promise.resolve() }; };
```

(вместо `s.document.startViewTransition = cb => { cb(); … }` внутри `w`), и после `closeOverlay("lightbox")`:

```js
  assert(svtFly === 2, 'лайтбокс: закрытие шло перелётом (второй переход), а не прямым close');
```

Run: `node build.js && node tests/uni-smoke.js app.js` → FAIL на годовщине.

- [ ] **Step 2: Код**

`src/35-memory.js:165`, aria-label орбиты:

```js
        <svg class="orbit-ring" viewBox="0 0 200 200" role="img" aria-label="${info.left === info.total ? 'Сегодня годовщина' : 'До годовщины ' + info.left + ' ' + pluralDays(info.left) + ', пройдено ' + info.pct + '%'}">
```

`src/85-lightbox.js`, `openLightboxFrom` — в сетке галереи порядок по экрану (плотная раскладка `grid-auto-flow:dense` переставляет большие плитки):

```js
function openLightboxFrom(el) {
  if (!el || !el.closest) return;
  const scope = el.closest('[data-photo-group]') || el.closest('.view') || document.body;
  let els = scope.querySelectorAll ? [...scope.querySelectorAll('[data-photo], [data-lightbox]')] : [];
  // Галерея: стрелки листают так, как фото видны — сверху вниз, слева направо
  // (NV-97). На оси порядок DOM и так визуальный, а скрытые «ещё» дали бы 0,0.
  if (el.closest('#photosGrid') && els.every(x => typeof x.getBoundingClientRect === 'function')) {
    const pos = new Map(els.map(x => [x, x.getBoundingClientRect()]));
    els = els.sort((a, b) => pos.get(a).top - pos.get(b).top || pos.get(a).left - pos.get(b).left);
  }
  const src = el.dataset.lightbox || el.dataset.photo;
  const list = els.map(x => x.dataset.lightbox || x.dataset.photo);
  let at = list.indexOf(src);
  if (at < 0) at = 0;
  openLightbox(list, at, el);
}
```

`src/20-theme-nav.js`, `showView` → в цикле по `.our-tab` добавить `b.tabIndex = b.dataset.our === view ? 0 : -1;`. После `$$('.our-tab').forEach(… go …)`:

```js
// «Наше» — tablist: Tab попадает только на активную вкладку, стрелки и
// Home/End переключают (APG, roving tabindex; NV-97).
function onOurSwitchKeydown(e) {
  const i = OUR_TABS.indexOf(activeView);
  if (i < 0) return;
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: OUR_TABS.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  const view = OUR_TABS[(next + OUR_TABS.length) % OUR_TABS.length];
  go(view);
  const tab = $$('.our-tab').find(b => b.dataset.our === view);
  if (tab) tab.focus();
}
const ourSwitchEl = $('#ourSwitch');
if (ourSwitchEl) ourSwitchEl.addEventListener('keydown', onOurSwitchKeydown);
```

Миниатюры оси с клавиатуры: `src/35-memory.js`, `tlPhotoImg` — у `<img>` добавить `tabindex="0" role="button" aria-label="Открыть фото"`. `src/36-timeline.js`, `renderTimeline`, строку привязки клика:

```js
  box.querySelectorAll('[data-lightbox]').forEach(img => {
    img.addEventListener('click', () => openLightboxFrom(img));
    img.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openLightboxFrom(img);
      }
    });
  });
```

`styles.css`: `.tl-photos img:focus-visible,.tl-item-photos img:focus-visible{outline:2px solid var(--star);outline-offset:2px}`.

- [ ] **Step 3: Клавиатурный проход в browser-check**

`tools/browser-check.js`, новая проверка (NV-97: Esc/cancel, Esc в календарике, возврат тоста, стрелки «Наше»):

```js
async function checkKeyboard(page, log) {
  const out = [];
  // Esc у шторки: cancel → closeOverlay, hidden в согласии с open
  await page.evaluate(() => openDateModal());
  await page.keyboard.press('Escape');
  out.push(['Esc закрывает шторку', await page.evaluate(() => document.getElementById('dateOverlay').hidden && !document.getElementById('dateOverlay').open)]);
  // Esc в календарике: закрыт только он, шторка открыта, фокус в поле даты
  await page.evaluate(() => {
    openEventModal();
    document.getElementById('evDate').focus();
  });
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  out.push(['Esc в календарике закрывает только его', await page.evaluate(() => document.getElementById('datePop').hidden && !document.getElementById('eventOverlay').hidden)]);
  out.push(['фокус вернулся в поле даты, календарик не открылся снова', await page.evaluate(() => document.activeElement.id === 'evDate' && document.getElementById('datePop').hidden)]);
  // Тост, показанный в шторке, возвращается в body, когда шторка закрывается
  await page.evaluate(() => {
    notify('проверка');
    closeOverlay('eventOverlay');
  });
  out.push(['тост пережил закрытие шторки', await page.evaluate(() => document.getElementById('appToast').parentNode === document.body && !document.getElementById('appToast').hidden)]);
  // «Наше»: стрелка вправо переключает вкладку и переносит фокус
  await page.evaluate(() => {
    go('notes');
    document.querySelector('.our-tab[data-our="notes"]').focus();
  });
  await page.keyboard.press('ArrowRight');
  out.push(['«Наше»: стрелка переключает на Списки', await page.evaluate(() => activeView === 'lists' && document.activeElement.dataset.our === 'lists')]);
  let ok = true;
  for (const [name, pass] of out) {
    log.push((pass ? 'OK' : 'FAIL') + ' клавиатура: ' + name);
    ok = ok && pass;
  }
  return ok;
}
```

В список проверок: `allOk = (await checkKeyboard(page, log)) && allOk;` (после `checkLightboxOffscreen`).

Run: `node build.js && node tools/browser-check.js` → `ИТОГ: OK`.

- [ ] **Step 4: Ручной клавиатурный проход**

На стенде (1280 px, обе темы), только клавиатура: Tab по шапке → вкладки → каждый экран. На каждом: фокус виден (янтарное кольцо), порядок совпадает с визуальным, до всего интерактивного можно дойти, из шторки Tab не выходит, Esc закрывает. Отдельно: день календаря (Enter выбирает, стрелки?), миниатюры оси (Enter открывает лайтбокс, стрелки листают, Esc закрывает, фокус возвращается). Каждую находку — чинить здесь, если это одна строка; иначе — карточка в backlog. Итог прохода — таблица «экран → OK / что найдено» в отчёт задачи (её прочтёт Task 14).

- [ ] **Step 5: Прогон и commit**

Run: `npm run check` → exit 0.

```bash
git add src/20-theme-nav.js src/35-memory.js src/36-timeline.js src/85-lightbox.js styles.css tests/uni-smoke.js tools/browser-check.js app.js
git commit -m "Feat: клавиатура — «Наше» стрелками, миниатюры оси, порядок лайтбокса как на экране, aria-label годовщины; клавиатурный browser-check (NV-97)"
```

### Task 14: Приёмка редизайна — закрыть NV-13 (NV-63)

**Files:**
- Modify: `docs/superpowers/baseline/metrics.md`, `docs/superpowers/baseline/README.md`, `README.md`, `PROJECT-MEMORY.md`

- [ ] **Step 1: Lighthouse после**

Тем же методом, что в фазе 0 (стенд, не прод — оговорка в `metrics.md`):

```bash
npx lighthouse http://localhost:8090/tools/demo.html --preset=desktop --output=json --output-path=./docs/superpowers/baseline/lh-desktop-after.json --chrome-flags="--headless"
npx lighthouse http://localhost:8090/tools/demo.html --form-factor=mobile --output=json --output-path=./docs/superpowers/baseline/lh-mobile-after.json --chrome-flags="--headless"
```

(`lh-*.json` в `.gitignore`.) Вес сборки: `node build.js`, `ls -l app.js app.min.js styles.css index.html fonts/*.woff2 vendor/sortable.min.js`. В `metrics.md` — раздел `## После редизайна (дата)`: две таблицы Lighthouse рядом с «до» (Performance, LCP, TBT, CLS, вес), таблица веса файлов до/после, одна строка вывода на каждую метрику. Mobile Performance ниже 73 или CLS выше 0.1 — не закрывать задачу: разобрать по отчёту (`audits` с наибольшим `numericValue`), чинить или карточка с числами в `waiting` владельцу.

- [ ] **Step 2: onThisDayItems — только по замеру (NV-97)**

На стенде, вкладка «Фото», в консоли: 5 прогонов `renderPhotosNow()` с `performance.now()` и то же с временно подменённым `onThisDayItems = () => []`. Разница медиан < 2 мс — мемоизацию не делать, число — в `metrics.md` одной строкой. Больше — отдельная карточка в backlog с числом.

- [ ] **Step 3: Снимки «после» и сверка**

Run: `node tools/shots.js after-redesign`. Сличить с `before-phase-7/` и с базлайном фазы 0 (`docs/superpowers/baseline/*.png`, если лежат локально). В `docs/superpowers/baseline/README.md` — раздел `## После редизайна (дата)`: по каждой из пяти проблем спеки (раздел «Проблема»: иерархия, навигация, модалки, галерея, шкалы) — одна-две строки, чем закрыта, со ссылкой на снимок.

- [ ] **Step 4: Живые телефоны — вопрос владельцу**

Стенд не видит живые телефоны и вход через Google. Собрать в один список всё, что задачи 1–13 вынесли в «Проверить на живом телефоне», плюс хвосты NV-97 для iPhone: `::backdrop` с `var()` (нужен Safari ≥ 17.4), `popover` (≥ 17); прокрутка глубоко по оси + партнёр отвечает на приглашение — нет ли прыжка; липкие метки годов; ручка шторки над ✕ в «Добавить дату»; после перелёта в лайтбокс миниатюра 256 px сменяется полным фото без заметного скачка; очень медленная прокрутка галереи (>450 мс до 10 px) не включает долгое нажатие.

Карточку этой задачи на доске — в `waiting`, в комментарий — список, в чат владельцу — коротко: что поменялось за фазы 7–10 и этот список «проверить на телефоне Гоши и телефоне Даши». **Работа останавливается** до ответа. По ответу: каждое «не так» — фикс здесь (одна строка) или карточка в backlog; «долгое нажатие при медленной прокрутке» воспроизвелось — фикс: порог движения `10px` в `src/70-photos.js` → `6px`, повторная проверка.

- [ ] **Step 5: README и PROJECT-MEMORY — финал**

README: раздел «Дизайн» — направление «Ночь» одним абзацем со ссылкой на спеку, токены (цвет, форма, пространство, движение), правило одного акцента, эмодзи-политика. PROJECT-MEMORY: `## 0k. ⚡ Снимок состояния (дата) — редизайн завершён` — что где искать (токены — `@layer tokens`, стражи — `uni-tokens`/`uni-render`, стенд и снимки — `tools/`), какие решения нельзя «чинить» обратно (нет `prefers-reduced-motion` — спека 3.3; нет карточки темы в Настройках; нет декоративных hover-подъёмов; плитки одинаковые в режиме порядка). Урок 5 — `grep` каждого имени.

- [ ] **Step 6: Мёрж, деплой, закрытие**

Ревью ветки `main..redesign-phase-10` (фиксы `(L1)…`), `npm run check`, `browser-check`.

```bash
git add README.md PROJECT-MEMORY.md docs/superpowers/baseline/README.md docs/superpowers/baseline/metrics.md
git commit -m "Docs: редизайн завершён — Lighthouse после, снимок 0k, итоги по baseline (NV-63, NV-13)"
```

Скилл `superpowers:finishing-a-development-branch`: мёрж `redesign-phase-10` в `main`, push, `gh run list --limit 2` → `success`, версия `app.min.js` на проде сменилась. На доске: комментарий с итогом и `done` у этой задачи, у NV-13 и у эпиков NV-E8 и NV-E3 (если все их карточки закрыты).
