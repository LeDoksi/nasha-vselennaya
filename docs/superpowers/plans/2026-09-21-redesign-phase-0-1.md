# Редизайн «Ночь», фазы 0–1: замеры и фундамент — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поставить измеримую базу «как было» и заменить визуальный фундамент сайта (цвет, шрифт, форма, слои CSS) на систему направления «Ночь», не меняя ни одного экрана по структуре.

**Architecture:** `styles.css` разделяется на `@layer tokens, base, components, utilities`; все цвета переезжают в OKLCH-токены с двумя темами; Nunito и Yeseva One заменяются на Onest и Sofia Sans Extra Condensed (обе self-hosted, обе с кириллицей); тумблер анимаций и `prefers-reduced-motion` удаляются по решению владельца; аврора-блобы заменяются слоем неба. Появляется визуальный стенд `tools/demo.html` — без него редизайн нечем проверять, потому что настоящее приложение закрыто входом через Google.

**Tech Stack:** vanilla JS (конкатенация `src/*.js` → `app.js` через `build.js` + esbuild minify), CSS без препроцессора, тесты — самописные node-скрипты с `vm`-песочницей, Playwright для браузерных проверок.

**Spec:** `docs/superpowers/specs/2026-09-21-redesign-core-audit-design.md`

## Global Constraints

- **Ни одна задача не оставляет сайт сломанным.** После каждой — `npm run check` зелёный (сборка + 8 тестовых файлов + eslint). Это же гоняет pre-commit хук.
- **`app.js` коммитится собранным.** CI падает, если `git diff app.js` непустой после `node build.js`. Правим только `src/*.js`, потом пересобираем и добавляем `app.js` в тот же коммит.
- **CSP не расширяется.** `font-src 'self'` — шрифты только локальные файлы в `fonts/`. Никаких `<link>` на Google Fonts.
- **Токены цвета — только OKLCH**, объявлены в `:root` (ночь) и `[data-theme="light"]` (рассвет). Точные значения — таблица в спеке, раздел 1.1.
- **Один акцент на весь сайт:** `--star`. Фиолетовый `--night` — фон и линии, не кнопки. Розовый — только праздничные моменты (конфетти, сердечки).
- **Шкала формы:** интерактивное `999px`, карточка `16px`, поле `12px`, медиа `12px`, шторка `24px` сверху.
- **Тёмная тема — основная.** `--sky-0: oklch(16% .035 275)`, светлая — `[data-theme="light"]`.
- **Никакого `prefers-reduced-motion` и никакого тумблера анимаций** (решение владельца, спека 3.3).
- **Ничего в `tools/` не попадает в прод** — `deploy-pages.yml` копирует явный список файлов, `tools/` в него не входит. Проверено 21.09.2026.
- **Язык интерфейса и комментариев — русский**, как во всём проекте.

---

## Файловая структура

| Файл | Ответственность | Статус |
|---|---|---|
| `tools/demo.html` | Визуальный стенд: поднимает приложение с фикстурами вместо Firestore | создаётся |
| `tools/demo-fixtures.js` | Данные для стенда: события, фото-заглушки, заметки, списки, хотелки | создаётся |
| `tools/shots.js` | Playwright: обходит все экраны стенда, снимает в обеих темах | создаётся |
| `tools/fetch-fonts.js` | Качает woff2-сабсеты Onest и Sofia Sans из Google Fonts в `fonts/` | создаётся |
| `tools/browser-check.js` | Проверка drag&drop. **Мёртв**: ссылается на `#setupScreen` из удалённого сейфа | чинится |
| `styles.css` | Весь CSS. Разделяется на `@layer`, токены переезжают в OKLCH | правится |
| `index.html` | Разметка. Убирается контрол анимаций, меняется слой фона | правится |
| `src/80-settings.js` | Настройки. Удаляется блок «уменьшенное движение» (~45 строк) | правится |
| `src/20-theme-nav.js` | Тема и навигация. `runViewTransition` теряет проверку `motionReduced()` | правится |
| `src/30-home.js` | Главная. Конфетти теряет проверку `motionReduced()` | правится |
| `src/90-effects-init.js` | Сердечки. Теряет проверку `motionReduced()` | правится |
| `tests/uni-smoke.js` | Общий тест. Удаляются 4 проверки тумблера анимаций | правится |
| `tests/uni-tokens.js` | Новый тест-страж: хардкоженных цветов и радиусов вне токенов нет | создаётся |
| `fonts/` | woff2. Nunito и Yeseva One удаляются, Onest и Sofia Sans приходят | правится |
| `docs/superpowers/baseline/` | Скриншоты и цифры «как было» | создаётся |

---

# ФАЗА 0 — Замеры и страховка

## Task 1: Визуальный стенд

Настоящее приложение закрыто входом через Google: ни скриншот снять, ни редизайн проверить. Существующий `tools/browser-check.js` когда-то заходил через экран создания сейфа (`#setupScreen`, `#setupPass`, `#setupGo`) — этих элементов в `index.html` больше нет, скрипт мёртв и падает на первом же шаге. Стенд решает обе проблемы сразу.

**Files:**
- Create: `tools/demo.html`
- Create: `tools/demo-fixtures.js`
- Modify: `tools/browser-check.js` (переводится на стенд)

**Interfaces:**
- Produces: `tools/demo.html` — страница, открывающая приложение с фикстурами; `window.__demoReady` становится `true`, когда все экраны отрисованы.
- Produces: `demoFixtures` — объект с полями `events`, `dates`, `notes`, `lists`, `wishes`, `photos`, `labels`.

- [ ] **Шаг 1: Прочитать, как приложение решает, что пользователь вошёл**

Читать `src/01-gate.js` целиком и `src/04-repo.js` (функции `repoSet`, `repoDelete`, `repoBatch`, `repoMeta`). Найти: какое условие снимает класс `auth` с `<body>`, и через какую единственную точку экраны читают данные. Выписать имена в комментарий будущего стенда.

- [ ] **Шаг 2: Написать фикстуры**

Создать `tools/demo-fixtures.js`. Данные должны быть достаточными, чтобы каждый экран показал непустое состояние: минимум 6 событий в трёх разных годах (включая одно многодневное), 2 свидания (одно с неотвеченным приглашением), 5 заметок, 2 списка с подзадачами, 4 хотелки (одна исполненная), 12 фото-заглушек с лейблами.

Фото-заглушки — сгенерированные на лету цветные PNG в data-URL, без реальных снимков:

```js
// tools/demo-fixtures.js
'use strict';
// Данные для визуального стенда. Никаких настоящих фото и текстов — стенд
// нужен, чтобы смотреть на вёрстку, а не на нашу переписку.
function demoPhotoDataUrl(i) {
  const hues = [265, 275, 285, 30, 45, 200];
  const h = hues[i % hues.length];
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="' + (i % 3 === 0 ? 800 : 450) + '">' +
    '<rect width="100%" height="100%" fill="hsl(' + h + ' 40% ' + (28 + (i % 4) * 9) + '%)"/></svg>';
  return 'data:image/svg+xml;base64,' + btoa(svg);
}
const demoFixtures = { /* events, dates, notes, lists, wishes, photos, labels */ };
```

- [ ] **Шаг 3: Написать стенд**

Создать `tools/demo.html`. Он копирует `<head>` и `<body>` из `index.html`, но вместо трёх тегов Firebase подключает заглушку, которая выставляет вошедшего пользователя и отдаёт фикстуры из памяти. Порядок скриптов критичен: заглушка идёт **до** `app.js`.

```html
<!-- tools/demo.html — визуальный стенд. В прод не попадает:
     deploy-pages.yml копирует явный список файлов, tools/ в него не входит. -->
<script src="demo-fixtures.js"></script>
<script>
  // Заглушка входа и базы: приложение думает, что Гоша вошёл, а данные лежат
  // в памяти. Ни одного сетевого запроса — стенд работает офлайн.
  window.__DEMO__ = true;
</script>
<script src="../app.js"></script>
```

- [ ] **Шаг 4: Проверить стенд руками**

```bash
node tools/serve.js
```
Открыть `http://localhost:8090/tools/demo.html`. Ожидается: класс `auth` с `<body>` снят, видны все семь вкладок, на каждой непустые данные, в консоли ноль ошибок и ноль сетевых запросов к `firestore.googleapis.com`.

- [ ] **Шаг 5: Перевести browser-check на стенд**

В `tools/browser-check.js` заменить `BASE` на адрес стенда и удалить весь блок создания сейфа (строки с `#setupScreen`, `#setupPass`, `#setupPass2`, `#setupGo`, `PASS`) — этих элементов не существует с момента перехода на Google-вход.

- [ ] **Шаг 6: Прогнать browser-check**

```bash
node tools/serve.js &
node tools/browser-check.js
```
Ожидается: `tools/browser-check-results.txt` без `SCRIPT ERROR`, все проверки drag&drop зелёные.

- [ ] **Шаг 7: Коммит**

```bash
git add tools/demo.html tools/demo-fixtures.js tools/browser-check.js tools/browser-check-results.txt
git commit -m "Tools: визуальный стенд с фикстурами; browser-check воскрешён (NV-13, фаза 0)"
```

---

## Task 2: Базлайн-скриншоты «как было»

**Files:**
- Create: `tools/shots.js`
- Create: `docs/superpowers/baseline/` (каталог со снимками)

**Interfaces:**
- Consumes: `tools/demo.html` из Task 1.
- Produces: `node tools/shots.js <подпапка>` — снимает все экраны в обе темы в `docs/superpowers/baseline/<подпапка>/`.

- [ ] **Шаг 1: Написать съёмщик**

```js
// tools/shots.js — обходит все экраны стенда и снимает их.
// Запуск: node tools/serve.js (в отдельном окне), затем
//         node tools/shots.js before
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const VIEWS = ['home', 'calendar', 'notes', 'lists', 'wishlist', 'photos', 'memory', 'settings'];
const SIZES = { phone: { width: 390, height: 844 }, desk: { width: 1280, height: 900 } };
const dir = path.join(__dirname, '..', 'docs', 'superpowers', 'baseline', process.argv[2] || 'shot');
(async () => {
  const browser = await chromium.launch();
  for (const [sizeName, viewport] of Object.entries(SIZES)) {
    for (const theme of ['dark', 'light']) {
      const page = await browser.newPage({ viewport });
      await page.goto('http://localhost:8090/tools/demo.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 10000 });
      await page.evaluate(t => setTheme(t), theme);
      for (const v of VIEWS) {
        await page.evaluate(view => go(view), v);
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(dir, sizeName + '-' + theme + '-' + v + '.png'), fullPage: true });
      }
      await page.close();
    }
  }
  await browser.close();
  console.log('OK: снимки в ' + dir);
})();
```

- [ ] **Шаг 2: Снять базлайн**

```bash
node tools/serve.js &
node tools/shots.js before
```
Ожидается: 32 файла (8 экранов × 2 темы × 2 ширины) в `docs/superpowers/baseline/before/`.

- [ ] **Шаг 3: Посмотреть на них**

Открыть все 32 и выписать в `docs/superpowers/baseline/README.md` то, что видно только глазами: где ломается вёрстка, где текст упирается в край, где на светлой теме не хватает контраста. Это входные данные для фаз 4–7, а не украшение.

- [ ] **Шаг 4: Коммит**

```bash
git add tools/shots.js docs/superpowers/baseline
git commit -m "Docs: базлайн-скриншоты всех экранов до редизайна (NV-13, фаза 0)"
```

---

## Task 3: Цифры «как было»

**Files:**
- Create: `docs/superpowers/baseline/metrics.md`

- [ ] **Шаг 1: Собрать прод-сборку**

```bash
node build.js
```
Записать вывод: размер `app.js` и `app.min.js` в КБ.

- [ ] **Шаг 2: Посчитать вес всего, что уходит на устройство**

```bash
ls -l app.min.js styles.css index.html vendor/sortable.min.js fonts/*.woff2 | awk '{s+=$5; print $9, $5} END {print "ИТОГО", s}'
```
Отдельной строкой записать: Firebase compat-SDK тянется тремя тегами с `gstatic.com` и в эту сумму не входит — его вес замерить в Lighthouse (шаг 4).

- [ ] **Шаг 3: Отчёт покрытия**

```bash
npm run coverage
```
Записать в `metrics.md` итоговый процент и пять файлов с худшим покрытием.

- [ ] **Шаг 4: Lighthouse на мобильном профиле**

```bash
node tools/serve.js &
npx lighthouse http://localhost:8090/tools/demo.html --preset=desktop --output=json --output-path=./docs/superpowers/baseline/lh-desktop.json --chrome-flags="--headless"
npx lighthouse http://localhost:8090/tools/demo.html --form-factor=mobile --output=json --output-path=./docs/superpowers/baseline/lh-mobile.json --chrome-flags="--headless"
```
Выписать в `metrics.md`: Performance, LCP, INP (или TBT, если INP не измерился без взаимодействия), CLS, вес передачи.

- [ ] **Шаг 5: Коммит**

```bash
git add docs/superpowers/baseline
git commit -m "Docs: цифры до редизайна — вес, покрытие, Lighthouse (NV-13, фаза 0)"
```

---

## Task 4: Честный проход по мёртвому коду

Разведка регуляркой соврала в обе стороны: 55 «мёртвых» CSS-классов, из которых живых 45, и 143 «мёртвые» функции, из которых почти все живые. Здесь нужен инструмент и глаза, а не `grep`.

**Files:**
- Modify: `styles.css` (удаление мёртвых правил)
- Create: `docs/superpowers/baseline/dead-code.md`

- [ ] **Шаг 1: Прогнать покрытие CSS браузером**

Playwright умеет `page.coverage.startCSSCoverage()`. Написать одноразовый скрипт в `tools/`, который обходит все экраны стенда (как `shots.js`) и собирает неиспользованные диапазоны `styles.css`. Важно: правило, не сработавшее ни на одном экране стенда, — **кандидат**, а не приговор. Состояния (`:hover`, `.dragging`, пустые экраны) стенд не покрывает.

- [ ] **Шаг 2: Свести кандидатов со списком из спеки**

Спека, раздел 4.1, называет одиннадцать классов эпохи сейфа: `auth-who`, `auth-user`, `auth-on`, `auth-label`, `auth-hint`, `user-btn`, `user-sub`, `user-btns`, `modal-center`, `btn-plain`, `es-emoji`. Каждый проверить руками:

```bash
grep -n 'auth-who\|auth-user\|auth-on\|auth-label\|auth-hint\|user-btn\|user-sub\|user-btns\|modal-center\|btn-plain\|es-emoji' index.html app.js src/*.js
```
Ожидается: ноль совпадений. Если совпадение есть — класс живой, из списка вычёркивается.

- [ ] **Шаг 3: Удалить подтверждённые правила из styles.css**

- [ ] **Шаг 4: Проверить, что ничего не отвалилось**

```bash
node tools/shots.js after-deadcss
```
Сравнить с `before/` глазами. Ожидается: ни одного визуального отличия.

- [ ] **Шаг 5: Записать остальных кандидатов**

В `dead-code.md` — то, что покрытие назвало неиспользуемым, но удалять страшно, с причиной («срабатывает только при drag», «только на пустом экране»). Это список для фазы 10, а не для сейчас.

- [ ] **Шаг 6: Проверка и коммит**

```bash
npm run check
git add styles.css docs/superpowers/baseline/dead-code.md
git commit -m "Clean: мёртвый CSS эпохи сейфа удалён, остальное описано (NV-13, фаза 0)"
```

---

# ФАЗА 1 — Фундамент

## Task 5: Слои CSS

`styles.css` — 1083 строки одним куском: специфичность держится на порядке строк. При редизайне это ломается первым, поэтому слои идут до любых правок вида.

**Files:**
- Modify: `styles.css`

**Interfaces:**
- Produces: порядок слоёв `@layer tokens, base, components, utilities;` первой строкой после `@font-face`.

- [ ] **Шаг 1: Объявить порядок слоёв**

Сразу после блоков `@font-face` (они остаются вне слоёв — `@font-face` в слои не кладут):

```css
/* Порядок слоёв задан здесь один раз. Всё, что ниже, попадает в свой слой, и
   специфичность больше не зависит от того, в какой строке файла оказалось
   правило: слой tokens всегда слабее base, base слабее components. */
@layer tokens, base, components, utilities;
```

- [ ] **Шаг 2: Разложить существующий CSS по слоям**

- `tokens` — `:root`, `[data-theme="dark"]`, `*{margin:0…}`
- `base` — `html`, `body`, `.container`, типографика по умолчанию
- `components` — всё остальное (карточки, кнопки, календарь, галерея, шторки)
- `utilities` — хелперы вроде `[hidden]`, `.sr-only`

Правила не менять — только обернуть. Медиазапросы остаются внутри своих слоёв.

- [ ] **Шаг 3: Проверить, что вид не изменился**

```bash
node tools/shots.js after-layers
```
Ожидается: попиксельно то же самое, что в `before/`. Любое отличие означает, что правило переехало не в тот слой.

- [ ] **Шаг 4: Коммит**

```bash
npm run check
git add styles.css
git commit -m "Refactor: styles.css разложен по @layer без изменения вида (NV-13, фаза 1)"
```

---

## Task 6: Шрифты

**Files:**
- Create: `tools/fetch-fonts.js`
- Modify: `styles.css` (блоки `@font-face`, `body{font-family}`)
- Delete: `fonts/nunito-cyrillic.woff2`, `fonts/nunito-latin.woff2`, `fonts/yeseva-one-cyrillic.woff2`, `fonts/yeseva-one-latin.woff2`

**Interfaces:**
- Produces: `fonts/onest-{cyrillic,latin}.woff2`, `fonts/sofia-sans-xc-{cyrillic,latin}.woff2`; токены `--font-ui` и `--font-display`.

- [ ] **Шаг 1: Написать качалку шрифтов**

Google Fonts отдаёт вариативные woff2 с сабсетами по `unicode-range` — ровно то, что уже сделано для Nunito. Скрипт нужен, чтобы через год было понятно, откуда взялись файлы.

```js
// tools/fetch-fonts.js — качает woff2-сабсеты в fonts/.
// Запуск: node tools/fetch-fonts.js
// Почему скриптом, а не руками: через год никто не вспомнит, какие именно
// сабсеты и какой версии лежат в репозитории. CSP запрещает грузить шрифты
// с чужого хоста, поэтому файлы живут у нас.
'use strict';
const fs = require('fs');
const path = require('path');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const WANT = { cyrillic: 'U+0301, U+0400-045F', latin: 'U+0000-00FF' };
const FAMILIES = [
  { css: 'Onest:wght@100..900', out: 'onest' },
  { css: 'Sofia+Sans+Extra+Condensed:wght@1..1000', out: 'sofia-sans-xc' }
];
(async () => {
  for (const fam of FAMILIES) {
    const css = await (await fetch('https://fonts.googleapis.com/css2?family=' + fam.css + '&display=swap', { headers: { 'User-Agent': UA } })).text();
    for (const [name, marker] of Object.entries(WANT)) {
      const block = css.split('@font-face').find(b => b.includes('unicode-range: ' + marker));
      if (!block) throw new Error('не нашёл сабсет ' + name + ' для ' + fam.out);
      const url = block.match(/url\((https:[^)]+\.woff2)\)/)[1];
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      const file = path.join(__dirname, '..', 'fonts', fam.out + '-' + name + '.woff2');
      fs.writeFileSync(file, buf);
      console.log('OK: ' + path.basename(file) + ' — ' + Math.round(buf.length / 1024) + ' КБ');
      console.log('   unicode-range:' + block.match(/unicode-range:([^;]+);/)[1]);
    }
  }
})();
```

- [ ] **Шаг 2: Скачать**

```bash
node tools/fetch-fonts.js
```
Ожидается: четыре файла в `fonts/`. Вывод содержит точные `unicode-range` — они понадобятся на следующем шаге.

- [ ] **Шаг 3: Заменить блоки @font-face**

В `styles.css` удалить четыре блока Nunito и Yeseva One, на их место положить четыре новых. `unicode-range` копируется из вывода шага 2 дословно.

```css
@font-face{
  font-family:'Onest';
  font-style:normal;
  font-weight:100 900;
  font-display:swap;
  src:url(fonts/onest-cyrillic.woff2) format('woff2');
  unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116;
}
/* …латиница Onest, кириллица и латиница Sofia Sans Extra Condensed — так же */
```

- [ ] **Шаг 4: Завести токены гарнитур**

В слое `tokens`:

```css
--font-ui:'Onest',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
--font-display:'Sofia Sans Extra Condensed','Onest',sans-serif;
```

`body{font-family:var(--font-ui)}`. Все места, где стоял `--font-display` со старым Yeseva One, теперь получают Sofia Sans автоматически.

- [ ] **Шаг 5: Удалить старые файлы**

```bash
git rm fonts/nunito-cyrillic.woff2 fonts/nunito-latin.woff2 fonts/yeseva-one-cyrillic.woff2 fonts/yeseva-one-latin.woff2
```

- [ ] **Шаг 6: Посмотреть на результат**

```bash
node tools/shots.js after-fonts
```
Ожидается: текст везде читается, кириллица не съехала на системный шрифт (признак съезда — другая ширина букв и отсутствие характерной `ж`), крупные числа стали заметно уже.

- [ ] **Шаг 7: Коммит**

```bash
npm run check
git add -A fonts styles.css tools/fetch-fonts.js
git commit -m "Feat: Onest + Sofia Sans Extra Condensed вместо Nunito и Yeseva One (NV-13, фаза 1)"
```

---

## Task 7: Цветовые токены OKLCH

**Files:**
- Modify: `styles.css` (слой `tokens` и все правила с хардкоженным цветом)

**Interfaces:**
- Produces: `--sky-0`, `--sky-1`, `--sky-2`, `--line`, `--ink`, `--ink-2`, `--star`, `--night` в обеих темах.

- [ ] **Шаг 1: Переписать :root на ночь**

Тёмная тема становится основной, то есть значением по умолчанию в `:root`. Значения — из спеки, таблица 1.1, дословно.

```css
@layer tokens{
  :root{
    color-scheme:dark;
    --sky-0:oklch(16% .035 275);
    --sky-1:oklch(21% .04 275);
    --sky-2:oklch(26% .045 275);
    --line:oklch(30% .03 275);
    --ink:oklch(95% .012 280);
    --ink-2:oklch(72% .03 280);
    --star:oklch(80% .13 75);
    --night:oklch(62% .16 285);
  }
  [data-theme="light"]{
    color-scheme:light;
    --sky-0:oklch(97% .012 280);
    --sky-1:oklch(99% .006 280);
    --sky-2:oklch(96% .01 280);
    --line:oklch(90% .012 280);
    --ink:oklch(22% .03 280);
    --ink-2:oklch(48% .02 280);
    --star:oklch(62% .14 62);
    --night:oklch(55% .15 285);
  }
}
```

- [ ] **Шаг 2: Оставить мост из старых имён**

Старые токены (`--bg1`, `--card`, `--violet`, `--pink`, `--grad`, `--glass-bg`…) используются в сотнях правил. Разом переписать всё — значит получить нечитаемый диффом коммит. Поэтому на один коммит остаётся мост:

```css
/* Мост на время фазы 1: старые имена смотрят на новые токены. Удаляется в
   шаге 4 этой же задачи, после того как все правила переведены. */
--bg1:var(--sky-0);
--bg2:var(--sky-0);
--card:var(--sky-1);
--ink-old:var(--ink);
--border:var(--line);
--violet:var(--night);
--violet2:var(--night);
--pink:var(--star);
```

- [ ] **Шаг 3: Проверить, что сайт стал ночным и не развалился**

```bash
node tools/shots.js after-tokens-bridge
```
Ожидается: сайт тёмный и синий, ничего не «потерялось» (белый текст на белом, чёрный на чёрном). Дефекты записать — их чинит следующий шаг.

- [ ] **Шаг 4: Перевести правила на новые имена и снять мост**

Пройти `styles.css` сверху вниз. Каждое вхождение старого токена и каждый хардкоженный hex заменить на новый токен. Градиент `--grad` удаляется: один акцент, градиентных кнопок больше нет. `--shadow` тонируется в фон, а не в чёрный:

```css
--shadow:0 16px 48px oklch(10% .04 275 / .5);
```

Светлая тема получает свою тень:

```css
[data-theme="light"]{ --shadow:0 14px 40px oklch(55% .08 285 / .14); }
```

- [ ] **Шаг 5: Проверить контраст**

На каждом снимке из шага 3 проверить пары «текст на фоне» через devtools или онлайн-проверялку: `--ink` на `--sky-0` и на `--sky-1`, `--ink-2` на `--sky-1`, текст кнопки на `--star`. Требование: AA (4.5:1) для обычного текста, 3:1 для крупного. Не проходит — двигать светлоту токена, а не отдельное правило.

- [ ] **Шаг 6: Коммит**

```bash
npm run check
node tools/shots.js after-tokens
git add styles.css
git commit -m "Feat: палитра «Ночь» в OKLCH, один акцент, градиенты сняты (NV-13, фаза 1)"
```

---

## Task 8: Шкала типографики

**Files:**
- Modify: `styles.css`

- [ ] **Шаг 1: Заменить шкалу размеров**

Старые токены `--text-xs…--text-2xl` остаются по именам (их использует полсотни правил), но получают новые значения из спеки 1.2 и дополняются двумя:

```css
--text-xs:11px;
--text-sm:13px;
--text-base:15px;   /* было 14px: Onest мельче Nunito в том же кегле */
--text-lg:19px;
--text-xl:24px;
--text-display:clamp(28px,7vw,44px);
--text-hero:clamp(72px,22vw,132px);
```

- [ ] **Шаг 2: Отдать крупное дисплейной гарнитуре**

Счётчик дней, заголовки разделов и крупные числа таймера получают `font-family:var(--font-display)` и `--text-hero` / `--text-display`. Найти их можно по текущему `--font-display` и по `clamp(` в `styles.css`.

- [ ] **Шаг 3: Цифры не должны дёргаться**

Таймер тикает раз в секунду, календарь — сетка чисел. Обоим:

```css
font-variant-numeric:tabular-nums;
```

- [ ] **Шаг 4: Проверить**

```bash
node tools/shots.js after-type
```
Ожидается: заголовки стали характернее, «132» узкое и крупное, таймер не прыгает по ширине при смене секунды (проверить глазами на живой странице, не на снимке).

- [ ] **Шаг 5: Коммит**

```bash
npm run check
git add styles.css
git commit -m "Feat: шкала типографики, дисплейная гарнитура на числах, tabular-nums (NV-13, фаза 1)"
```

---

## Task 9: Шкала формы и пространства

**Files:**
- Modify: `styles.css`

- [ ] **Шаг 1: Свести радиусы к пяти значениям**

Спека 1.3. Существующие токены переопределяются, лишние удаляются:

```css
--radius-pill:999px;  /* всё интерактивное: кнопки, чипы, пилюли */
--radius-card:16px;   /* карточки */
--radius-field:12px;  /* поля ввода */
--radius-media:12px;  /* фото, миниатюры */
--radius-sheet:24px;  /* шторки — верхние углы */
```

- [ ] **Шаг 2: Найти и добить хардкод**

```bash
grep -n 'border-radius:[0-9]' styles.css
```
Ожидается после правки: ноль строк. Каждое значение в px заменяется токеном по роли элемента, а не по близости числа.

- [ ] **Шаг 3: Завести шкалу пространства**

```css
--sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px;
--sp-6:24px; --sp-8:32px; --sp-12:48px; --sp-16:64px;
```

Ритм по спеке 1.4: 24 внутри блока, 32 между блоками, 48 между зонами. Массово переписывать все отступы в этой задаче не надо — шкала заводится сейчас, а применяется по экранам в фазах 4–7.

- [ ] **Шаг 4: Проверить и закоммитить**

```bash
npm run check
node tools/shots.js after-shape
git add styles.css
git commit -m "Feat: единая шкала радиусов и пространства (NV-13, фаза 1)"
```

---

## Task 10: Удаление тумблера анимаций

Решение владельца (спека 3.3): единая версия, без отключения. Удаляется всё, а не прячется.

**Files:**
- Modify: `src/80-settings.js:112-152`
- Modify: `src/20-theme-nav.js:18`
- Modify: `src/30-home.js:138`
- Modify: `src/90-effects-init.js:3`
- Modify: `index.html` (блок с `#motionToggle`)
- Modify: `styles.css` (два `@media (prefers-reduced-motion: reduce)` и комментарии к ним)
- Modify: `tests/uni-smoke.js:226,1048-1059`

**Interfaces:**
- Produces: функции `getMotion`, `applyMotion`, `setMotion`, `motionReduced` перестают существовать. Ни один файл на них не ссылается.

- [ ] **Шаг 1: Сначала тест — убрать проверки тумблера**

В `tests/uni-smoke.js` удалить строку 226 (экспорт четырёх функций в песочницу) и блок строк 1048–1059 (шесть проверок `motionReduced` и состояния чекбокса).

- [ ] **Шаг 2: Убедиться, что тест теперь падает по другой причине**

```bash
node tests/uni-smoke.js app.js
```
Ожидается: PASS. Тест не должен падать — мы удалили проверки, а код пока на месте. Это подтверждает, что проверки были единственным, что держало эти функции в тесте.

- [ ] **Шаг 3: Снять проверки в трёх местах вызова**

`src/20-theme-nav.js:18` — условие теряет последний член:

```js
if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function') return false;
```

`src/30-home.js:138` — строка `if (motionReduced()) return;` с комментарием удаляется целиком, конфетти летит всегда.

`src/90-effects-init.js:3` — так же, сердечки запускаются всегда.

- [ ] **Шаг 4: Удалить блок настроек**

В `src/80-settings.js` удалить строки 112–152: комментарий «Настройки: уменьшенное движение», `MOTION_KEY`, `getMotion`, `applyMotion`, `setMotion`, `motionReduced`, подписку на `#motionToggle`. Проверить, что `applyMotion` не вызывается при старте где-то ещё:

```bash
grep -rn 'applyMotion\|motionReduced\|MOTION_KEY\|universe_motion' src/ tests/ index.html
```
Ожидается: ноль совпадений.

- [ ] **Шаг 5: Убрать контрол из разметки**

В `index.html` в карточке «🌙 Оформление» удалить `<p class="cal-tip">` про летающие сердечки и `<label class="motion-toggle">` с чекбоксом `#motionToggle`.

- [ ] **Шаг 6: Убрать медиазапросы из CSS**

В `styles.css` удалить оба блока `@media (prefers-reduced-motion: reduce)` (около строк 923 и 1079) и правила с селектором `[data-motion="reduced"]`. Комментарии, которые их объясняли (строки около 169, 449, 916), тоже удалить — они станут враньём.

Оставить в файле одну строку на память о размене:

```css
/* Анимации не отключаются ни тумблером, ни prefers-reduced-motion: решение
   владельца 21.09.2026, пользователей ровно двое и оба этого хотят. Если
   когда-нибудь начнёт укачивать — вернуть сюда блок
   @media (prefers-reduced-motion: reduce){ *{animation:none!important} }.
   Подробности: docs/superpowers/specs/2026-09-21-redesign-core-audit-design.md, 3.3 */
```

- [ ] **Шаг 7: Проверить**

```bash
npm run check
```
Ожидается: все 8 тестовых файлов зелёные, eslint без замечаний (он поймает, если удалённая функция где-то осталась вызванной).

- [ ] **Шаг 8: Коммит**

```bash
node build.js
git add src/80-settings.js src/20-theme-nav.js src/30-home.js src/90-effects-init.js index.html styles.css tests/uni-smoke.js app.js
git commit -m "Clean: тумблер анимаций и prefers-reduced-motion удалены (NV-13, фаза 1)"
```

---

## Task 11: Аврора → слой неба

**Files:**
- Modify: `index.html` (блок `.aurora`)
- Modify: `styles.css` (правила `.aurora`, `.aurora-blob`, `.ab-1..3`, keyframes `aurora1..3`)

**Interfaces:**
- Produces: `.sky` — фиксированный слой неба с двумя звёздными плоскостями `.sky-far`, `.sky-near`.

- [ ] **Шаг 1: Заменить разметку**

```html
<!-- Слой неба: две звёздные плоскости, двигаются с разной скоростью при
     прокрутке. Заменил три blur-блоба авроры: те стоили дорого по GPU на
     телефоне (filter: blur(90px) на 56vw элементе перерисовывается каждый
     кадр) и были ровно тем розово-фиолетовым дефолтом, от которого ушли. -->
<div class="sky" aria-hidden="true">
  <span class="sky-far"></span>
  <span class="sky-near"></span>
</div>
```

- [ ] **Шаг 2: Заменить CSS**

Звёзды — повторяющийся `radial-gradient`, а не тысяча элементов:

```css
.sky{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none}
.sky-far,.sky-near{position:absolute;inset:-20% 0;display:block;background-repeat:repeat}
.sky-far{
  background-image:
    radial-gradient(1px 1px at 20% 30%, oklch(90% .02 280 / .5), transparent),
    radial-gradient(1px 1px at 70% 60%, oklch(90% .02 280 / .35), transparent),
    radial-gradient(1.5px 1.5px at 45% 80%, oklch(92% .03 280 / .4), transparent);
  background-size:280px 280px;
}
.sky-near{
  background-image:
    radial-gradient(1.5px 1.5px at 60% 20%, var(--star), transparent),
    radial-gradient(1px 1px at 15% 70%, oklch(95% .02 280 / .6), transparent);
  background-size:420px 420px;
  opacity:.7;
}
[data-theme="light"] .sky{opacity:.25}
```

Параллакс по прокрутке появится в фазе 8 (scroll-driven). Сейчас слой статичен — это нормально, задача в том, чтобы убрать аврору и поставить на её место правильную основу.

- [ ] **Шаг 3: Удалить старое**

Из `styles.css` удалить `.aurora`, `.aurora-blob`, `.ab-1`, `.ab-2`, `.ab-3` и три блока `@keyframes aurora1/2/3`.

- [ ] **Шаг 4: Проверить, что стало легче**

```bash
node tools/serve.js &
npx lighthouse http://localhost:8090/tools/demo.html --form-factor=mobile --output=json --output-path=/tmp/lh-sky.json --chrome-flags="--headless"
```
Сравнить Performance и TBT с `docs/superpowers/baseline/lh-mobile.json`. Ожидается: не хуже. Если хуже — звёздные градиенты слишком мелкие, увеличить `background-size`.

- [ ] **Шаг 5: Коммит**

```bash
npm run check
node tools/shots.js after-sky
git add index.html styles.css
git commit -m "Feat: слой неба вместо аврора-блобов (NV-13, фаза 1)"
```

---

## Task 12: Тест-страж токенов

Без него шкалы разъедутся через три экрана: кто-нибудь впишет `#7c3aed` «на минуточку», и минуточка останется навсегда. Именно так появились те пять шкал радиусов, которые мы сейчас сводим.

**Files:**
- Create: `tests/uni-tokens.js`
- Modify: `package.json` (скрипты `test` и `check`)

**Interfaces:**
- Consumes: `styles.css`.
- Produces: `node tests/uni-tokens.js` — падает, если вне блока `tokens` появился хардкоженный цвет или радиус.

- [ ] **Шаг 1: Написать тест**

```js
// Страж шкал: цвета и радиусы живут только в токенах.
// Запуск: node tests/uni-tokens.js
'use strict';
const fs = require('fs');
const css = fs.readFileSync('styles.css', 'utf8');
// Слой tokens — единственное место, где разрешены литеральные цвета.
const tokensLayer = css.match(/@layer tokens\{[\s\S]*?\n\}/);
if (!tokensLayer) { console.log('FAIL: не нашёл @layer tokens — слои разъехались'); process.exit(1); }
const rest = css.replace(tokensLayer[0], '');
const fails = [];
// hex-цвета вне токенов
for (const m of rest.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) fails.push('hex ' + m[0]);
// rgb()/hsl() вне токенов — кроме прозрачных служебных заливок в тенях
for (const m of rest.matchAll(/\b(rgba?|hsla?)\(/g)) fails.push(m[1] + '()');
// радиусы числом вне токенов (0 и 50% разрешены)
for (const m of rest.matchAll(/border-radius:\s*(?!0\b|50%|var\()([^;]+);/g)) fails.push('radius ' + m[1].trim());
if (fails.length) {
  console.log('FAIL: хардкод вне токенов (' + fails.length + '):');
  for (const f of [...new Set(fails)].slice(0, 30)) console.log('  ' + f);
  process.exit(1);
}
console.log('OK: цвета и радиусы только в токенах');
```

- [ ] **Шаг 2: Запустить и увидеть падение**

```bash
node tests/uni-tokens.js
```
Ожидается: FAIL со списком. Это правда — в `styles.css` после задач 7 и 9 ещё останутся `rgba()` в тенях и точечные hex. Список — это работа шага 3, а не повод ослабить тест.

- [ ] **Шаг 3: Дочистить**

Каждое вхождение из списка либо переезжает в токен, либо переписывается через `oklch(… / alpha)`. Если какое-то правило действительно не может обойтись без литерала (например, `color-scheme`), тест дополняется явным исключением с комментарием, почему.

- [ ] **Шаг 4: Запустить и увидеть, что прошло**

```bash
node tests/uni-tokens.js
```
Ожидается: `OK: цвета и радиусы только в токенах`.

- [ ] **Шаг 5: Вписать в прогон**

В `package.json` добавить `node tests/uni-tokens.js` в конец скриптов `test` и `check` (перед `npm run lint`).

- [ ] **Шаг 6: Коммит**

```bash
npm run check
git add tests/uni-tokens.js package.json styles.css
git commit -m "Test: страж токенов — цвета и радиусы только в :root (NV-13, фаза 1)"
```

---

## Приёмка фазы 1

- [ ] `npm run check` зелёный, включая нового стража токенов.
- [ ] `node tools/shots.js phase-1-done` снят, все 32 снимка просмотрены глазами.
- [ ] Ни одного `#hex`, `rgba()` и числового `border-radius` вне слоя `tokens`.
- [ ] В репозитории нет файлов Nunito и Yeseva One, нет слов `motionReduced`, `data-motion`, `aurora`.
- [ ] Lighthouse на мобильном не хуже базлайна из `docs/superpowers/baseline/metrics.md`.
- [ ] Ветка влита в `main`, деплой прошёл, сайт открыт на обоих телефонах — тёмная тема, шрифты подхватились, ничего не разъехалось.

---

## Self-Review (выполнен автором плана)

**Покрытие спеки.** Фаза 0 спеки (замеры, страховка) — задачи 1–4. Фаза 1 (токены, `@layer`, шрифты, шкала форм, удаление тумблера, Yeseva One) — задачи 5–12. Слой неба из спеки 1.5 попал в задачу 11. Раздел 4.1 спеки (мёртвый CSS) — задача 4. Пункты спеки про фазы 2–10 в этом плане отсутствуют намеренно: каждая получит свой план перед стартом, потому что план на фазу 5, написанный сегодня, будет описывать код, который фазы 2–4 перепишут.

**Заглушки.** Нет. Каждый шаг содержит либо команду, либо код, либо конкретный список того, что искать и чем заменить. Единственное место, где плану приходится сказать «читать и выписать» — шаг 1 задачи 1: стенд нельзя написать, не зная, как `01-gate.js` снимает класс `auth`, а угадывать этот код в плане было бы хуже, чем честно отправить исполнителя его прочитать.

**Согласованность имён.** Токены `--sky-0/1/2`, `--line`, `--ink`, `--ink-2`, `--star`, `--night` объявляются в задаче 7 и используются под теми же именами в задачах 8, 9, 11, 12. Гарнитурные токены `--font-ui`, `--font-display` заводятся в задаче 6, используются в 8. `tools/demo.html` создаётся в задаче 1, используется в 2, 3, 4, 11. `tools/shots.js` создаётся в задаче 2, вызывается в 4, 5, 6, 7, 8, 9, 11. Строка 226 и блок 1048–1059 в `tests/uni-smoke.js` — проверены по файлу 21.09.2026.

**Порядок.** Слои (5) идут до токенов (7), потому что переносить правила по слоям проще, пока значения не поменялись. Шрифты (6) — до типографики (8). Токены (7) — до стража (12), иначе страж будет падать с первой минуты по причинам, которые никто ещё не чинил.
