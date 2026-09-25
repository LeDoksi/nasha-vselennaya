# Редизайн «Ночь», фазы 2–3: ядро — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** До того как начнётся перерисовка экранов (фазы 4–8), сделать код, в котором её удобно делать: пять больших файлов разрезаны по ответственностям, разметка собирается одним способом с экранированием по умолчанию, а service worker после деплоя отдаёт свежую версию, а не прошлую.

**Architecture:** Распил делается чистым переносом: куски файла уезжают в новые файлы, имена которых при сортировке встают на то же место, поэтому собранный `app.js` не меняется ни на байт (кроме пустых строк) — это и есть проверка. Рендер: в `src/00-html.js` появляются тегированный шаблон `html\`…\`` (экранирует всё, что подставлено, кроме уже готового `SafeHtml`), `raw()` и `render(el, content)`. Все 32 присваивания `innerHTML` переводятся на них, тест-страж запрещает новые. Service worker переходит со stale-while-revalidate на «сеть первой, кэш запасной» с таймаутом.

**Tech Stack:** vanilla JS (конкатенация `src/*.js` → `app.js` через `build.js` + esbuild minify), CSS без препроцессора, тесты — самописные node-скрипты с `vm`-песочницей, Playwright для визуального стенда.

**Spec:** `docs/superpowers/specs/2026-09-21-redesign-core-audit-design.md` (раздел 4 и строки фаз 2–3 в таблице раздела 5). План фаз 0–1 для образца: `docs/superpowers/plans/2026-09-21-redesign-phase-0-1.md`.

## Global Constraints

Перенесены из плана фаз 0–1, поправлены на состояние после его слияния:

- **Ни одна задача не оставляет сайт сломанным.** После каждой — `npm run check` зелёный (сборка + все тестовые файлы + eslint). Это же гоняет pre-commit хук (`.husky/pre-commit`: lint-staged → `npm run check` → `git add app.js`).
- **`app.js` коммитится собранным.** CI падает, если `git diff app.js` непустой после `node build.js`. Правим только `src/*.js`, потом пересобираем и добавляем `app.js` в тот же коммит.
- **CSP не расширяется.** `font-src 'self'` — шрифты только локальные файлы в `fonts/`. Никаких `<link>` на Google Fonts.
- **Токены цвета — только OKLCH**, объявлены в `@layer tokens`. Страж `tests/uni-tokens.js` падает на хардкоженном цвете/радиусе вне слоя.
- **Один акцент на весь сайт:** `--star`. Фиолетовый `--night` — фон и линии, не кнопки. Розовый — только праздничные моменты (конфетти, сердечки).
- **Шкала формы:** интерактивное `999px`, карточка `16px`, поле `12px`, медиа `12px`, шторка `24px` сверху.
- **Тёмная тема — основная.**
- **Никакого `prefers-reduced-motion` и никакого тумблера анимаций** (решение владельца, спека 3.3).
- **Ничего в `tools/` не попадает в прод** — `deploy-pages.yml` копирует явный список файлов (`index.html app.min.js styles.css icon.svg manifest.webmanifest sw.js`, `fonts/*`, `vendor/*`).
- **`tools/` трекается выборочно:** в `.gitignore` остались только `tools/*.png`, `tools/patch-dnd.js`, `tools/browser-check-results.txt`. Новые файлы в `tools/` коммитятся без правки `.gitignore`.
- **Скриншоты в репозиторий не коммитятся** (`docs/superpowers/baseline/**/*.png` в `.gitignore`). В git уходят только выводы.
- **Язык интерфейса и комментариев — русский**, как во всём проекте.

Новое для фаз 2–3:

- **Фазы 2–3 не меняют вид сайта ни на пиксель.** Каждая задача после Task 1 заканчивается `node tools/shots-diff.js phase-2-start <папка>` → `OK`. Снимки сравниваются только в пределах одного календарного дня (на стенде «сегодня» — настоящая дата: подсветка дня в календаре, комплимент дня).
- **Распил — только чистый перенос.** Никаких правок кода внутри перенесённых кусков. Проверка: `git diff --ignore-blank-lines --exit-code app.js` после пересборки.
- **Порядок сборки — по имени файла** (`build.js`: `readdirSync().sort()`). Новый файл обязан при сортировке встать ровно туда, где лежал его кусок. Все top-level `let`/`const` живут в одной области видимости, так что перестановка кусков может дать TDZ-ошибку — поэтому не переставляем.
- **Firebase остаётся на compat-SDK.** Решение владельца 25.09.2026 после замера: compat 151 КБ gz, модульный бандл с нашим набором вызовов 124 КБ gz — выигрыш 27 КБ не окупает риск сломать вход. Карточка NV-46 ушла в бэклог с цифрами.
- **`content-visibility` в галерее — не здесь**, а в фазе 6 (NV-54): плитки станут разного размера и `contain-intrinsic-size` всё равно переписывать.

---

## Файловая структура

| Файл | Ответственность | Статус |
|---|---|---|
| `tools/demo.html` | Стенд: голова + заглушка Firebase. Своей копии разметки больше нет | правится |
| `tools/demo-boot.js` | Берёт `<body>` из настоящего `index.html`, вставляет в стенд, грузит приложение | создаётся |
| `tools/shots.js` | Снимки стенда. Становится детерминированным | правится |
| `tools/shots-diff.js` | Побайтовое сравнение двух папок снимков | создаётся |
| `tools/serve.js` | Слушает `127.0.0.1` вместо всех интерфейсов | правится |
| `src/05-photostore.js` → + `06-photostore-backends.js`, `07-photo-media.js`, `08-photo-cache.js` | Распил хранилища фото | режется |
| `src/40-calendar.js` → + `41-calendar-photos.js`, `42-datepicker.js`, `43-event-modal.js`, `44-ics.js` | Распил календаря | режется |
| `src/60-lists-wishes.js` → `60-lists.js`, `61-wishes.js`, `62-global-clicks.js` | Распил списков и хотелок | режется |
| `src/70-photos.js` → + `71-photo-grid.js`, `72-photo-labels.js` | Распил галереи | режется |
| `src/95-photos-cloud.js` → + `95-photos-sync.js` | Распил облака фото | режется |
| `src/00-html.js` | `html`, `raw`, `render`, `SafeHtml` | создаётся |
| `tests/uni-render.js` | Юнит-тесты помощника + страж: `innerHTML =` и `esc(` вне помощника запрещены | создаётся |
| `sw.js` | Сеть первой, кэш запасной, таймаут 3 с | правится |
| `tests/uni-sw.js` | Сценарии fetch-обработчика с фейковыми `caches`/`fetch` | создаётся |
| `package.json` | Два новых теста в `test` и `check` | правится |
| `README.md`, `PROJECT-MEMORY.md`, `docs/superpowers/baseline/metrics.md` | Список модулей, снимок состояния, цифра Firebase | правятся |

---

# ФАЗА 2 — Ядро: рендер

### Task 1: Стенд без копии разметки и детерминированные снимки

Фаза 2 обещает «ни пикселя не поменялось» — это надо уметь проверить автоматически. Сейчас не получается по трём причинам: `tools/demo.html` держит ручную копию ~380 строк разметки `index.html` (за фазу 0–1 разъехалась дважды); модалка «Тебе назначили свидание!» из фикстур висит поверх всех снимков; на экране есть случайность (летающие сердечки, конфетти, случайная выборка фото в коллаже Главной через `Math.random`), тикающий таймер `#countdownTick` и тост, который всплывает или нет в зависимости от тайминга.

**Files:**
- Modify: `tools/demo.html`
- Create: `tools/demo-boot.js`
- Modify: `tools/shots.js`
- Create: `tools/shots-diff.js`
- Modify: `tools/serve.js:46`

**Interfaces:**
- Produces: `node tools/shots.js <папка>` — 36 детерминированных снимков (8 экранов × 2 темы × 2 ширины = 32, плюс `home-invite` в каждой из 4 комбинаций) в `docs/superpowers/baseline/<папка>/`.
- Produces: `node tools/shots-diff.js <папка-до> <папка-после>` — код выхода 0 и `OK: N снимков совпали побайтно`, либо 1 и список `DIFF: <имя>`.
- Produces: папка `docs/superpowers/baseline/phase-2-start/` — эталон для всех следующих задач (локально, не в git).
- Сохраняется: `window.__demoReady === true`, когда приложение отрисовано (на это смотрят `shots.js` и `tools/browser-check.js`).

- [ ] **Шаг 1: Убедиться, что копия в demo.html не содержит намеренных отличий**

Сравнить тело стенда с телом `index.html`, отбросив скрипты и префиксы путей `../`:

```bash
node -e "
const fs=require('fs');
const body=f=>fs.readFileSync(f,'utf8').split('<body')[1].split('</body>')[0].replace(/<script[\s\S]*?<\/script>/g,'').replace(/\.\.\//g,'').replace(/\s+/g,' ');
const a=body('index.html'), b=body('tools/demo.html');
console.log(a===b?'одинаковы':'РАЗНЫЕ: '+a.length+' vs '+b.length);
"
```

Если «РАЗНЫЕ» — найти отличия (`diff` двух выводов построчно) и выписать. Отличия, которые стенд делает намеренно (не просто устаревшая копия), переносятся в `tools/demo-boot.js` как явная правка DOM после вставки, с комментарием «почему». Устаревшие отличия — просто теряются, в этом и цель.

- [ ] **Шаг 2: Вынести загрузку в tools/demo-boot.js**

```js
// tools/demo-boot.js — вставляет в стенд разметку настоящего index.html и
// запускает приложение. Раньше разметка была скопирована в demo.html руками
// и за фазы 0–1 дважды разъехалась с оригиналом; теперь копии нет вообще.
// Пути относительные к корню репозитория: в demo.html стоит <base href="../">.
(async function () {
  'use strict';
  const res = await fetch('index.html');
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  doc.querySelectorAll('script').forEach(s => s.remove()); // Firebase и app.min.js стенду не нужны
  document.body.className = doc.body.className;
  document.body.prepend(...[...doc.body.childNodes].map(n => document.importNode(n, true)));
  for (const src of ['vendor/sortable.min.js', 'app.js']) {
    await new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = ok;
      s.onerror = () => fail(new Error('demo: не загрузился ' + src));
      document.body.appendChild(s);
    });
  }
  // __demoReady — когда unlockApp() (src/01-gate.js) снял класс auth с <body>.
  (function waitUnlocked() {
    if (!document.body.classList.contains('auth')) {
      window.__demoReady = true;
      return;
    }
    setTimeout(waitUnlocked, 30);
  })();
})();
```

Приложение не слушает `DOMContentLoaded` (проверено `grep` по `src/` 25.09.2026), поэтому поздняя загрузка `app.js` ему не мешает.

- [ ] **Шаг 3: Переписать tools/demo.html**

В `<head>` первой строкой после `<meta charset>` добавить `<base href="../">` и убрать `../` из `href` манифеста, иконки и `styles.css`. Комментарий про CSP в голове оставить.

`<body>` заменить целиком на:

```html
<body class="auth">
  <script src="tools/demo-fixtures.js"></script>
  <script>
    /* сюда без изменений переносится весь существующий inline-скрипт
       заглушки — от 'use strict'; window.__DEMO__ = true; до строки
       window.firebase = firebase; включительно */
  </script>
  <script src="tools/demo-boot.js"></script>
</body>
```

Существующий inline-скрипт (сейчас строки 399–625) переносится **как есть**, меняться в нём ничего не должно. Старые теги `sortable.min.js`, `app.js` и скрипт `waitUnlocked` (строки 626–640) удаляются — их работу делает `demo-boot.js`.

- [ ] **Шаг 4: Сделать tools/shots.js детерминированным**

Заменить файл целиком:

```js
// tools/shots.js — обходит все экраны стенда и снимает их.
// Запуск: node tools/serve.js (в отдельном окне), затем
//         node tools/shots.js <папка>
// Снимки детерминированы: одинаковый код в один и тот же день даёт побайтно
// одинаковые PNG — на этом стоит tools/shots-diff.js.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const VIEWS = ['home', 'calendar', 'notes', 'lists', 'wishlist', 'photos', 'memory', 'settings'];
const SIZES = { phone: { width: 390, height: 844 }, desk: { width: 1280, height: 900 } };
const dir = path.join(__dirname, '..', 'docs', 'superpowers', 'baseline', process.argv[2] || 'shot');

// Math.random с фиксированным зерном (mulberry32): сердечки, конфетти и
// выборка фото в коллаже Главной каждый прогон одни и те же.
function seedRandom() {
  let a = 42;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Тост всплывает по таймингу асинхронной проверки хранилища — то есть, то нет.
const HIDE_FLAKY = '#appToast{display:none!important}';

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  for (const [sizeName, viewport] of Object.entries(SIZES)) {
    for (const theme of ['dark', 'light']) {
      const page = await browser.newPage({ viewport });
      await page.addInitScript(seedRandom);
      await page.goto('http://localhost:8090/tools/demo.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 10000 });
      await page.addStyleTag({ content: HIDE_FLAKY });
      await page.evaluate(t => setTheme(t), theme);
      const shot = name =>
        page.screenshot({
          path: path.join(dir, sizeName + '-' + theme + '-' + name + '.png'),
          fullPage: true,
          animations: 'disabled',
          mask: [page.locator('#countdownTick')]
        });
      // Приглашение на свидание из фикстур: снимаем один раз и закрываем,
      // иначе оно перекрывает все остальные экраны (так было всю фазу 0–1).
      await page.waitForTimeout(400);
      if (await page.isVisible('#dateInviteOverlay')) {
        await shot('home-invite');
        await page.evaluate(() => closeOverlay('dateInviteOverlay'));
      }
      for (const v of VIEWS) {
        await page.evaluate(view => go(view), v);
        await page.waitForTimeout(400);
        await shot(v);
      }
      await page.close();
    }
  }
  await browser.close();
  console.log('OK: снимки в ' + dir);
})();
```

- [ ] **Шаг 5: Создать tools/shots-diff.js**

```js
// tools/shots-diff.js — побайтовое сравнение двух прогонов tools/shots.js.
// Запуск: node tools/shots-diff.js <папка-до> <папка-после>
// Папки — внутри docs/superpowers/baseline/. Выход 1, если хоть один снимок
// отличается или есть только в одной из папок.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const base = path.join(__dirname, '..', 'docs', 'superpowers', 'baseline');
const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.log('Запуск: node tools/shots-diff.js <папка-до> <папка-после>');
  process.exit(2);
}
const pngs = d => fs.readdirSync(path.join(base, d)).filter(n => n.endsWith('.png'));
const hash = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const names = [...new Set([...pngs(a), ...pngs(b)])].sort();
const bad = names.filter(n => {
  const fa = path.join(base, a, n);
  const fb = path.join(base, b, n);
  return !fs.existsSync(fa) || !fs.existsSync(fb) || hash(fa) !== hash(fb);
});
bad.forEach(n => console.log('DIFF: ' + n));
console.log(bad.length ? 'FAIL: ' + bad.length + ' из ' + names.length : 'OK: ' + names.length + ' снимков совпали побайтно');
process.exit(bad.length ? 1 : 0);
```

- [ ] **Шаг 6: serve.js — только локальная машина**

В `tools/serve.js` строка `server.listen(PORT, () => {` → `server.listen(PORT, '127.0.0.1', () => {`. Хвост из финального ревью фаз 0–1: dev-сервер был виден всей локальной сети.

- [ ] **Шаг 7: Доказать детерминизм и снять эталон**

```bash
node tools/serve.js
```
(в отдельном окне, оставить работать)

```bash
node tools/shots.js phase-2-start
node tools/shots.js phase-2-start-again
node tools/shots-diff.js phase-2-start phase-2-start-again
```

Expected: `OK: 36 снимков совпали побайтно` (32 экрана + 4 `home-invite`). Если есть `DIFF` — найти источник недетерминизма (открыть оба PNG, посмотреть, что отличается) и убрать его в `shots.js` тем же способом (маска, скрытие, зерно). Не переходить дальше, пока прогон к прогону не совпадает.

Затем глазами просмотреть все 36 снимков `phase-2-start`: модалки поверх экранов нет, `home-invite` показывает приглашение, экраны не пустые. `node tools/browser-check.js` — зелёный (он тоже ходит на стенд).

- [ ] **Шаг 8: Коммит**

```bash
git add tools/demo.html tools/demo-boot.js tools/shots.js tools/shots-diff.js tools/serve.js
git commit -m "Tools: стенд берёт разметку из index.html, снимки детерминированы, shots-diff (NV-13, фаза 2)"
```

---

### Task 2: Распил пяти больших файлов (чистый перенос)

Цифры на 25.09.2026 (фаза 1 JS не трогала, совпадают со спекой): `40-calendar.js` 920, `60-lists-wishes.js` 852, `70-photos.js` 747, `05-photostore.js` 724, `95-photos-cloud.js` 655 строк.

Каждый кусок — непрерывный диапазон строк исходного файла, в исходном порядке. Имена подобраны так, чтобы при сортировке новые файлы вставали сразу за исходным (`05-photostore` < `06-…` < `07-…` < `08-…` < `20-theme-nav`; `95-photos-cloud` < `95-photos-sync` < `96-push`). Поэтому `app.js` после пересборки совпадает со старым — это и есть тест задачи. Номера строк ниже — на 25.09.2026; перед резкой найти каждую границу по её **якорю** (`grep -n`), а не доверять номеру.

**Files:**
- Modify/Create: см. таблицу «Файловая структура», строки распила
- Modify: комментарии со ссылками на старые пути (`grep -rn "src/40-calendar.js" src tests tools README.md`)

**Interfaces:**
- Produces: имена файлов из таблицы ниже; ни одна функция/переменная не переименована и не изменена.
- Consumes: ничего из Task 1, кроме `tools/shots-diff.js` для финальной проверки.

Карта резки (граница = первая строка нового файла):

| Исходный | Новый файл | Якорь первой строки | ≈строка |
|---|---|---|---|
| `05-photostore.js` | `05-photostore.js` (IndexedDB, шифрование, миграция data-URL) | начало файла | 1 |
| | `06-photostore-backends.js` (`IDBPhotoStore`, `MemoryPhotoStore`, `initPhotoStore`) | комментарий над `const IDBPhotoStore = {` | ~190 |
| | `07-photo-media.js` (миниатюры, EXIF, dataURL) | комментарий над `async function createThumbnail` | ~470 |
| | `08-photo-cache.js` (кэши и URL фото, `hydratePhotoImgs`) | комментарий над `const thumbCache = new Map();` | ~575 |
| `40-calendar.js` | `40-calendar.js` (сетка, панель дня, навигация по месяцам) | начало файла | 1 |
| | `41-calendar-photos.js` (миниатюры и фото событий/свиданий) | `// Миниатюры фото события в панели дня` | 286 |
| | `42-datepicker.js` | `/* ===== Кастомный date-picker в стиле сайта` | 497 |
| | `43-event-modal.js` | `// Фото, прикреплённые к событию` | 758 |
| | `44-ics.js` | `/* ===== Экспорт памятных дат в .ics` | 860 |
| `60-lists-wishes.js` | `60-lists.js` (`git mv`) | начало файла | 1 |
| | `61-wishes.js` | `/* ===== Хотелки` | 346 |
| | `62-global-clicks.js` (`closeOverlay` + общий обработчик кликов) | `/* ===== Глобальные клики ===== */` | 505 |
| `70-photos.js` | `70-photos.js` (загрузка, режимы выбора/порядка, удаление, фильтр) | начало файла | 1 |
| | `71-photo-grid.js` (сетка, витрина событий) | комментарий над `let photosRenderQueued = false;` | ~230 |
| | `72-photo-labels.js` (управление лейблами, перетаскивание на чипы) | комментарий над `function deleteLabelSilent` | ~430 |
| `95-photos-cloud.js` | `95-photos-cloud.js` (конфиги, блокировка, адаптер Yandex, части облака) | начало файла | 1 |
| | `95-photos-sync.js` (`schedulePhotoSync` … `syncPhotos`, и `boot()` в конце) | комментарий над `function schedulePhotoSync` | ~340 |

«Комментарий над» = граница проходит перед блоком `//`-комментариев, который описывает функцию, а не между комментарием и функцией. `FIREBASE_CONFIG` и `YANDEX_CLOUD_CONFIG` остаются в `95-photos-cloud.js` — README (строки 171, 191, 218, 259, 310) ссылается туда. `boot()` остаётся последней строкой своего куска: перенос его в отдельный файл изменил бы порядок исполнения, а это уже не чистый перенос.

- [ ] **Шаг 1: Резать по одному исходному файлу. Для каждого:**

1. `grep -n` по якорям — записать точные номера границ N1 < N2 < ….
2. Вырезать хвостовые куски снизу вверх, затем обрезать исходник. Пример для календаря (подставить реальные номера):

```bash
f=src/40-calendar.js
sed -n '860,$p'   $f > src/44-ics.js
sed -n '758,859p' $f > src/43-event-modal.js
sed -n '497,757p' $f > src/42-datepicker.js
sed -n '286,496p' $f > src/41-calendar-photos.js
sed -i '286,$d'   $f
```

Для `60-lists-wishes.js` сначала `git mv src/60-lists-wishes.js src/60-lists.js`, потом резать `60-lists.js`.

3. Проверить, что это чистый перенос:

```bash
npx prettier --write src/40-calendar.js src/41-calendar-photos.js src/42-datepicker.js src/43-event-modal.js src/44-ics.js
node build.js
git diff --ignore-blank-lines --exit-code app.js && echo ЧИСТЫЙ ПЕРЕНОС
```

Expected: `ЧИСТЫЙ ПЕРЕНОС`. Если дифф есть — кусок встал не туда (проверить сортировку имён: `ls src`) или prettier что-то переформатировал внутри; откатить и резать заново, не «чинить руками».

4. `npm run check` — зелёный.
5. Коммит на каждый исходный файл отдельно:

```bash
git add src/ app.js
git commit -m "Refactor: 40-calendar.js разрезан на 5 файлов чистым переносом (NV-13, фаза 2)"
```

- [ ] **Шаг 2: Поправить ссылки в комментариях**

```bash
grep -rn "40-calendar.js\|60-lists-wishes.js\|70-photos.js\|05-photostore.js\|95-photos-cloud.js" src tests tools README.md
```

Каждое упоминание, которое указывает на функцию, уехавшую в новый файл, — поправить на новый путь. Упоминания `60-lists-wishes.js` — все (файла больше нет). Правки комментариев в `src/` меняют `app.js` — это нормально, `npm run check` пересоберёт.

- [ ] **Шаг 3: Визуальная проверка и коммит**

```bash
node tools/shots.js phase-2-split
node tools/shots-diff.js phase-2-start phase-2-split
```

Expected: `OK: 36 снимков совпали побайтно`.

```bash
git add src/ tests/ tools/ README.md app.js
git commit -m "Docs: ссылки в комментариях на новые файлы после распила (NV-13, фаза 2)"
```

---

### Task 3: Помощник рендера и страж

Сейчас разметку собирают 32 присваивания `innerHTML` (спека насчитала 35 — считала строки со словом, а не присваивания; пересчитано регэкспом `/\.innerHTML\s*=(?!=)/` 25.09.2026). Экранирование — ручное, `esc()` из `src/00-core.js:11`, и в каждом месте решается заново, что экранировать. Помощник делает экранирование умолчанием: всё, что подставлено в `html\`…\``, экранируется, кроме значений, которые уже `SafeHtml` (результат другого `html\`\`` или `raw()`).

`SafeHtml` наследует `String` — поэтому `.includes()`, конкатенация `'…' + x` и `${x}` в обычном шаблоне работают как со строкой, и тесты, которые зовут `wishCard()`/`memoryPhotosHtml()` напрямую и делают `.includes()`, не ломаются.

**Files:**
- Create: `src/00-html.js`
- Create: `tests/uni-render.js`
- Modify: `package.json` (скрипты `test` и `check`)

**Interfaces:**
- Consumes: `esc(s)` из `src/00-core.js` (глобальная, `00-core.js` < `00-html.js` в сборке).
- Produces: `html` — тегированный шаблон → `SafeHtml`. Подстановки: `SafeHtml` — как есть; массив — каждый элемент по тем же правилам, склеить без разделителя; `null`, `undefined`, `false` — пустая строка; всё остальное — `esc(String(v))`.
- Produces: `raw(s)` → `SafeHtml` без экранирования. Только для разметки, собранной не из данных пользователя.
- Produces: `render(el, content)` — `el.innerHTML = String(content)`; `el` может быть `null` (тогда ничего). Единственное место в `src/`, где пишется `innerHTML`.
- Produces: `class SafeHtml extends String`.

- [ ] **Шаг 1: Написать тест tests/uni-render.js**

```js
// Помощник рендера (src/00-html.js) и страж: вне него innerHTML не пишется,
// esc() не зовётся (в html`` экранирование уже по умолчанию, esc внутри — двойное).
// Запуск: node tests/uni-render.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
const assert = (cond, msg) => {
  console.log((cond ? 'OK: ' : 'FAIL: ') + msg);
  if (!cond) failed++;
};

// --- юнит-тесты помощника ---
const core = fs.readFileSync('src/00-core.js', 'utf8');
const escLine = core.match(/^const esc = .*$/m)[0];
const ctx = vm.createContext({});
const h = vm.runInContext(escLine + '\n' + fs.readFileSync('src/00-html.js', 'utf8') + '\n;({ html, raw, render, SafeHtml });', ctx);

const evil = '<img src=x onerror="a()">&\'';
assert(String(h.html`<p>${evil}</p>`) === '<p>&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;</p>', 'подстановка экранируется');
assert(String(h.html`<b>${h.html`<i>${'<'}</i>`}</b>`) === '<b><i>&lt;</i></b>', 'вложенный html`` не экранируется второй раз');
assert(String(h.html`${h.raw('<br>')}`) === '<br>', 'raw() проходит как есть');
assert(String(h.html`<ul>${['<a>', h.html`<li>1</li>`]}</ul>`) === '<ul>&lt;a&gt;<li>1</li></ul>', 'массив: каждый элемент по своим правилам');
assert(String(h.html`${null}${undefined}${false}${0}`) === '0', 'null/undefined/false пустые, 0 — это 0');
assert(h.html`<p>x</p>`.includes('x') && '' + h.html`a` === 'a', 'SafeHtml ведёт себя как строка');
const el = { innerHTML: '' };
h.render(el, h.html`<p>${'a'}</p>`);
h.render(el, h.html`<p>${'a'}</p>`);
assert(el.innerHTML === '<p>a</p>', 'повторный render заменяет, а не дописывает');
h.render(null, h.html`x`);
assert(true, 'render(null) не падает');

// --- страж ---
// Файлы, ещё не переведённые на помощник: имя → сколько присваиваний innerHTML
// в нём сейчас. Каждая задача перевода удаляет свои строки; к концу фазы 2
// объект пустой. Число должно совпадать точно: и новое присваивание, и
// забытая правка списка — ошибка.
const PENDING = {
  '20-theme-nav.js': 3,
  '30-home.js': 6,
  '35-memory.js': 3,
  '40-calendar.js': 3,
  '41-calendar-photos.js': 0, // innerHTML нет, но есть esc() в evThumbHTML
  '42-datepicker.js': 3,
  '50-notes.js': 1,
  '60-lists.js': 3,
  '61-wishes.js': 1,
  '70-photos.js': 1,
  '71-photo-grid.js': 4,
  '72-photo-labels.js': 3,
  '85-lightbox.js': 1
};
const SELF = ['00-core.js', '00-html.js'];
for (const f of fs.readdirSync('src').filter(n => n.endsWith('.js') && !SELF.includes(n))) {
  const src = fs.readFileSync(path.join('src', f), 'utf8');
  const inner = (src.match(/\.innerHTML\s*=(?!=)/g) || []).length;
  const pending = f in PENDING;
  const want = pending ? PENDING[f] : 0;
  assert(inner === want, f + ': innerHTML-присваиваний ' + inner + (pending ? ' (ждёт перевода: ' + want + ')' : ', нужно 0 — только render()'));
  if (!pending) assert(!/\besc\(/.test(src), f + ': нет esc() — в html`` экранирование по умолчанию');
}

if (failed) {
  console.log('FAIL: ' + failed);
  process.exit(1);
}
console.log('OK: uni-render');
```

Перед записью `PENDING` прогнать и сверить числа с кодом:

```bash
node -e "const fs=require('fs');for(const f of fs.readdirSync('src')){const n=(fs.readFileSync('src/'+f,'utf8').match(/\.innerHTML\s*=(?!=)/g)||[]).length;if(n)console.log(f,n)}"
```

И отдельно — файлы, где есть `esc(`, но нет `innerHTML` (на 25.09.2026 после распила такой один: `41-calendar-photos.js`):

```bash
node -e "const fs=require('fs');for(const f of fs.readdirSync('src')){const s=fs.readFileSync('src/'+f,'utf8');if(/\besc\(/.test(s)&&!/\.innerHTML\s*=(?!=)/.test(s))console.log(f)}"
```

Каждый такой файл (кроме `00-core.js`) — в `PENDING` с числом `0`. Если числа или список отличаются от объекта выше — в тест идут данные из вывода, а расхождение пишется в отчёт задачи.

- [ ] **Шаг 2: Убедиться, что тест падает**

Run: `node tests/uni-render.js`
Expected: падение на чтении `src/00-html.js` (файла ещё нет).

- [ ] **Шаг 3: Написать src/00-html.js**

```js
/* ===== Рендер разметки =====
   Единственный способ писать HTML в DOM. html`…` экранирует всё подставленное,
   кроме SafeHtml (результат другого html`` или raw()), поэтому экранирование —
   умолчание, а не решение в каждом месте. esc() внутри html`` не нужен: это
   было бы двойное экранирование («&amp;lt;» на экране). Страж —
   tests/uni-render.js. SafeHtml — наследник String: .includes(), конкатенация
   и ${} в обычном шаблоне работают как со строкой. */
class SafeHtml extends String {}
const raw = s => new SafeHtml(s == null ? '' : s);
function htmlValue(v) {
  if (v instanceof SafeHtml) return String(v);
  if (Array.isArray(v)) return v.map(htmlValue).join('');
  if (v == null || v === false) return '';
  return esc(v);
}
const html = (strings, ...values) => raw(strings.reduce((out, s, i) => out + htmlValue(values[i - 1]) + s));
function render(el, content) {
  if (el) el.innerHTML = String(content);
}
```

- [ ] **Шаг 4: Тест проходит**

Run: `node build.js && node tests/uni-render.js`
Expected: `OK: uni-render`.

- [ ] **Шаг 5: Подключить в package.json**

В скрипты `test` и `check` дописать ` && node tests/uni-render.js` сразу после `node tests/uni-tokens.js` (в `check` — перед `&& npm run lint`).

- [ ] **Шаг 6: Проверка и коммит**

`npm run check` — зелёный. Помощник пока никем не вызывается, вид не меняется, `shots-diff` не нужен.

```bash
git add src/00-html.js tests/uni-render.js package.json app.js
git commit -m "Feat: html\`\`/raw/render — рендер с экранированием по умолчанию, страж innerHTML (NV-13, фаза 2)"
```

---

### Правила перевода на помощник (для задач 4–8)

Каждая из задач 4–8 применяет одни и те же правила к своим файлам. Правила повторены здесь один раз, потому что задачи 4–8 ссылаются именно на этот блок, а не друг на друга.

1. `x.innerHTML = <выражение>` → `render(x, <выражение>)`. Условные `if (x) x.innerHTML = …` → `render(x, …)` (render сам проверяет `null`). Очистка `x.innerHTML = ''` → `render(x, '')`.
2. Шаблонная строка `` `…` ``, которая уходит в DOM, → `` html`…` ``.
3. Конкатенация `'<a>' + y + '</a>'`, которая уходит в DOM, → `` html`<a>${y}</a>` ``.
4. `${esc(v)}` / `+ esc(v) +` → `${v}` (экранирует html``).
5. Подстановка, которая **сама является разметкой** (результат `navIconHtml()`, `listItemHTML()`, `wishCard()`, `evThumbHTML()`, `dateInviteCardHTML()`, `memoryPhotosHtml()`, ячейки календаря и т.п.) — функция-источник переводится на `html\`\`` и возвращает `SafeHtml`; тогда подстановка проходит как есть. Если источник ещё не переведён (живёт в файле другой задачи) — временно `raw(…)` с комментарием `// raw: переводится в задаче N`, и эта задача его снимает.
6. `.map(…).join('')` внутри html`` → просто `${list.map(…)}` (массив склеивается сам). Если результат `.join('')` сохраняется в переменную и потом подставляется — оставить `.join('')`, но обернуть в `raw()` **только** если каждый элемент — `SafeHtml`; иначе убрать `.join` и подставлять массив.
7. Данные, которые раньше подставлялись **без** `esc` (id, числа, заранее известные строки) — теперь экранируются. Для id вида `[a-z0-9]` и чисел результат тот же. Если где-то без `esc` подставлялась строка с настоящими тегами/сущностями — это случай правила 5, не raw по привычке.
8. `raw()` только для разметки, собранной не из пользовательских данных. Каждый `raw()` в коде — с комментарием, почему не `html```.

Проверка в конце каждой задачи одна и та же: `npm run check` (страж `uni-render` знает, что файл переведён, когда задача удалила его строку из `PENDING`) и `node tools/shots-diff.js phase-2-start <папка>` → `OK`. Если снимок разошёлся — почти наверняка двойное экранирование (видно `&amp;`, `&lt;` на экране) или разметка ушла как текст (видны теги на экране): открыть оба PNG, найти место.

---

### Task 4: Перевод: заметки, лайтбокс, навигация

Самые мелкие места — обкатать правила до больших файлов.

**Files:**
- Modify: `src/50-notes.js:8` (1 присваивание, 2 `esc`)
- Modify: `src/85-lightbox.js:176` (1)
- Modify: `src/20-theme-nav.js:55,84-86,160,172` (3 присваивания, 1 `esc`; `navIconHtml` становится источником `SafeHtml`)
- Modify: `tests/uni-render.js` — удалить строки `'20-theme-nav.js'`, `'50-notes.js'`, `'85-lightbox.js'` из `PENDING`

**Interfaces:**
- Consumes: `html`, `raw`, `render` (Task 3).
- Produces: `navIconHtml(id)` возвращает `SafeHtml` (раньше строку). Все её вызовы в других файлах (`40-calendar.js`, `50-notes.js`, `60-lists.js`, `61-wishes.js`, `70-photos.js`, `71-photo-grid.js`, `72-photo-labels.js`) продолжают работать без правок: `SafeHtml` конкатенируется и подставляется как строка.

- [ ] **Шаг 1: Удалить три файла из PENDING и убедиться, что страж падает**

Run: `node build.js && node tests/uni-render.js`
Expected: `FAIL` на `50-notes.js`, `85-lightbox.js`, `20-theme-nav.js` (innerHTML и `esc`).

- [ ] **Шаг 2: src/20-theme-nav.js**

```js
function navIconHtml(id) {
  return html`<svg class="nav-icon" aria-hidden="true"><use href="#icon-${id}"></use></svg>`;
}
```

Строка 55: `btn.innerHTML = '<svg …' + (t === 'dark' ? 'sun' : 'moon') + '…'` → `render(btn, navIconHtml(t === 'dark' ? 'sun' : 'moon'));` (та же разметка — проверить глазами, что строка идентична). Строка 160: `render(bar, '');`. Строка 172: `render(clone, BOTTOM_ICON[view] || html\`${label}\`);`.

- [ ] **Шаг 3: src/50-notes.js**

```js
function renderNotes() {
  const list = [...db.notes].sort((a, b) => b.pinned - a.pinned || (a.order ?? 1e9) - (b.order ?? 1e9) || b.ts - a.ts);
  render(
    $('#notesGrid'),
    list.length
      ? html`${list.map(
          n => html`
    <div class="note${n.pinned ? ' pinned' : ''}" data-id="${n.id}">
      <div class="note-top">
        <button class="drag-handle note-drag" data-note-drag="${n.id}" title="Перетащить">⠿</button>
        <button class="mini-x" data-pin-note="${n.id}" title="${n.pinned ? 'Открепить' : 'Закрепить'}">${navIconHtml(n.pinned ? 'pin-fill' : 'pin')}</button>
        <span class="note-author">${noteAuthorName(n)}</span>
        <span class="note-date">${new Date(n.ts).toLocaleDateString('ru-RU')}</span>
        <button class="mini-x" data-edit-note="${n.id}" title="Редактировать">${navIconHtml('pencil')}</button>
        <button class="mini-x" data-del-note="${n.id}" title="Удалить">✕</button>
      </div>
      ${
        editingNoteId === n.id
          ? html`<div class="note-edit">
             <textarea id="noteEdit-${n.id}" class="note-editor">${n.text}</textarea>
             <div class="note-edit-btns">
               <button class="btn btn-sm" data-save-note="${n.id}">💜 Сохранить</button>
               <button class="mini-x" data-cancel-note title="Отмена">✕</button>
             </div>
           </div>`
          : html`<p>${n.text}</p>`
      }
    </div>`
        )}`
      : html`<div class="empty-state">Пока пусто. Напиши первую записку! 💌</div>`
  );
}
```

`noteAuthorName()` возвращает эмодзи + имя без тегов — экранирование его не меняет.

- [ ] **Шаг 4: src/85-lightbox.js:176**

`pinBtn.innerHTML = '<svg …star-fill/star…'` → `render(pinBtn, navIconHtml(galleryPhoto.pinned ? 'star-fill' : 'star'));` — сверить, что разметка `navIconHtml` та же, что была в строке.

- [ ] **Шаг 5: Проверка**

```bash
npm run check
node tools/shots.js phase-2-t4
node tools/shots-diff.js phase-2-start phase-2-t4
```

Expected: check зелёный, `OK: 36 снимков совпали побайтно`.

- [ ] **Шаг 6: Коммит**

```bash
git add src/20-theme-nav.js src/50-notes.js src/85-lightbox.js tests/uni-render.js app.js
git commit -m "Refactor: заметки, лайтбокс, навигация на html\`\`/render (NV-13, фаза 2)"
```

---

### Task 5: Перевод: Главная и Память

**Files:**
- Modify: `src/30-home.js` — 6 присваиваний (строки ≈71, 104, 110, 177, 191, 278), 13 `esc`; источники разметки `dateInviteCardHTML` (≈247) и коллаж (≈480–495, конкатенация с `esc(p.id)`, `esc(url)`)
- Modify: `src/35-memory.js` — 3 присваивания (≈157, 229, 260), 9 `esc`; источник `memoryPhotosHtml` (≈275–280) и сборка карточек ленты конкатенацией (≈239–255)
- Modify: `tests/uni-render.js` — удалить `'30-home.js'`, `'35-memory.js'` из `PENDING`

**Interfaces:**
- Consumes: `html`, `raw`, `render` (Task 3); `navIconHtml` → `SafeHtml` (Task 4).
- Produces: `dateInviteCardHTML(d)` и `memoryPhotosHtml(…)` возвращают `SafeHtml`. `memoryPhotosHtml` вызывается тестом `tests/uni-smoke.js:1280-1283` с `.includes()` — работает, т.к. `SafeHtml` наследует `String`.

- [ ] **Шаг 1:** удалить два файла из `PENDING`; `node build.js && node tests/uni-render.js` → FAIL на обоих.
- [ ] **Шаг 2:** перевести `src/30-home.js` по правилам 1–8. Комментарий на строке ≈503 («innerHTML #progressRing перерисовывается») поправить на «render() перерисовывает #progressRing» — страж комментарии не считает, но слово должно не врать.
- [ ] **Шаг 3:** перевести `src/35-memory.js` по правилам 1–8. Конкатенация `card += '<div …>' + esc(x) + …` → `card.push(html\`…${x}…\`)` в массив, итог — `render(feed, html\`${cards}\`)`, либо эквивалент без массива, если так короче.
- [ ] **Шаг 4:** `npm run check`; `node tools/shots.js phase-2-t5`; `node tools/shots-diff.js phase-2-start phase-2-t5` → `OK`.
- [ ] **Шаг 5:** коммит.

```bash
git add src/30-home.js src/35-memory.js tests/uni-render.js app.js
git commit -m "Refactor: Главная и Память на html\`\`/render (NV-13, фаза 2)"
```

---

### Task 6: Перевод: календарь

**Files:**
- Modify: `src/40-calendar.js` — 3 присваивания (`#calendar`, два в `renderDayPanel`), `esc` сколько найдётся
- Modify: `src/41-calendar-photos.js` — источник `evThumbHTML` (0 присваиваний; `esc` — перевести)
- Modify: `src/42-datepicker.js` — 3 присваивания (`<option>` месяцев, очистка селекта годов, сетка дней)
- Modify: `tests/uni-render.js` — удалить `'40-calendar.js'`, `'41-calendar-photos.js'`, `'42-datepicker.js'` из `PENDING`

**Interfaces:**
- Consumes: `html`, `raw`, `render` (Task 3); `navIconHtml` → `SafeHtml` (Task 4).
- Produces: `evThumbHTML(ref, altText)`, `evThumbs(…)`, `dtThumbs(…)` возвращают `SafeHtml`.

- [ ] **Шаг 1:** удалить `'40-calendar.js'`, `'41-calendar-photos.js'`, `'42-datepicker.js'` из `PENDING`; `node build.js && node tests/uni-render.js` → FAIL на всех трёх.

- [ ] **Шаг 2:** перевести три файла по правилам 1–8. Сетка месяца (`html + cells`) — обе части в `html\`\``, склейка через массив или вложенный `html\`${head}${cells}\``.
- [ ] **Шаг 3:** `npm run check`; `node tools/shots.js phase-2-t6`; `node tools/shots-diff.js phase-2-start phase-2-t6` → `OK`. Дополнительно руками на стенде: открыть модалку события и date-picker (`node tools/serve.js`, `http://localhost:8090/tools/demo.html`) — снимки их не покрывают.
- [ ] **Шаг 4:** коммит.

```bash
git add src/40-calendar.js src/41-calendar-photos.js src/42-datepicker.js tests/uni-render.js app.js
git commit -m "Refactor: календарь и date-picker на html\`\`/render (NV-13, фаза 2)"
```

---

### Task 7: Перевод: списки и хотелки

**Files:**
- Modify: `src/60-lists.js` — 3 присваивания (пустой экран, список карточек, `li.innerHTML = listItemHTML(…)` в `renderListItems`); источник `listItemHTML`
- Modify: `src/61-wishes.js` — 1 присваивание (`grid`); источники `wishToggleHTML`, `wishCard`
- Modify: `tests/uni-render.js` — удалить `'60-lists.js'`, `'61-wishes.js'` из `PENDING`

**Interfaces:**
- Consumes: `html`, `raw`, `render` (Task 3); `navIconHtml` → `SafeHtml` (Task 4).
- Produces: `listItemHTML`, `wishToggleHTML`, `wishCard` возвращают `SafeHtml`. `wishCard` зовётся тестом `tests/uni-smoke.js:862-868` — проверить, что тест сравнивает через `.includes()`/регэксп, а не `===` со строкой; если `===` — обернуть вызов в тесте в `String(…)` внутри лямбды песочницы.

- [ ] **Шаг 1:** удалить два файла из `PENDING`; страж падает.
- [ ] **Шаг 2:** перевести по правилам 1–8. `tests/uni-dnd.js` парсит `innerHTML` мини-DOМом (`parseHTML(String(v), this)`, строка ≈189) — `render` пишет строку, парсер её получит как раньше.
- [ ] **Шаг 3:** `npm run check`; `node tools/shots.js phase-2-t7`; `node tools/shots-diff.js phase-2-start phase-2-t7` → `OK`; `node tools/browser-check.js` зелёный (drag&drop подзадач живёт в этих файлах).
- [ ] **Шаг 4:** коммит.

```bash
git add src/60-lists.js src/61-wishes.js tests/ app.js
git commit -m "Refactor: списки и хотелки на html\`\`/render (NV-13, фаза 2)"
```

---

### Task 8: Перевод: галерея

**Files:**
- Modify: `src/70-photos.js` — 1 присваивание (панель выбора, ≈114)
- Modify: `src/71-photo-grid.js` — 4 присваивания (сетка + `photosSentinel`, годы, месяцы, названия событий витрины)
- Modify: `src/72-photo-labels.js` — 3 присваивания (пустой список лейблов, список управления, список применения)
- Modify: `tests/uni-render.js` — удалить три последние строки; `PENDING` становится `{}`

**Interfaces:**
- Consumes: `html`, `raw`, `render` (Task 3); `navIconHtml` → `SafeHtml` (Task 4).
- Produces: `PENDING = {}` — с этого момента страж запрещает `innerHTML =` и `esc(` во всём `src/`, кроме `00-core.js` и `00-html.js`.

- [ ] **Шаг 1:** удалить строки; страж падает.
- [ ] **Шаг 2:** перевести по правилам 1–8. `photosSentinel` со `style="grid-column:1/-1;height:1px"` — остаётся как литерал в шаблоне (inline-style тут существующий, не новый; страж токенов смотрит только `styles.css`). Комментарий ≈340 «grid.innerHTML каждый раз пересоздаёт разметку» → «render() каждый раз…».
- [ ] **Шаг 3:** `npm run check`; `node tools/shots.js phase-2-t8`; `node tools/shots-diff.js phase-2-start phase-2-t8` → `OK`; `node tools/browser-check.js` зелёный. Руками на стенде: режим выбора, режим порядка, окно лейблов — снимки их не покрывают.
- [ ] **Шаг 4:** убедиться, что `innerHTML` в `src/` остался только в `00-html.js`:

```bash
grep -n "innerHTML\s*=" src/*.js
```

Expected: одна строка — `src/00-html.js`.

- [ ] **Шаг 5:** коммит.

```bash
git add src/70-photos.js src/71-photo-grid.js src/72-photo-labels.js tests/uni-render.js app.js
git commit -m "Refactor: галерея на html\`\`/render — innerHTML остался только в помощнике (NV-13, фаза 2)"
```

---

# ФАЗА 3 — Ядро: вес и доставка

### Task 9: Service worker — сеть первой

Что сейчас (`sw.js`, 89 строк, `CACHE_NAME = 'nasha-vselennaya-shell-v2'`): stale-while-revalidate для всех GET своего origin. Следствия, найденные при чтении 25.09.2026:

1. **После деплоя первый заход показывает прошлую версию** — кэш отвечает сразу, свежий файл кладётся «на следующий раз».
2. **Версии в одной вкладке могут смешаться:** каждый файл обновляется в кэше независимо; если фоновая докачка `index.html` успела, а `app.min.js` оборвалась — следующий заход получит новую разметку со старым скриптом.
3. **Комментарий врёт:** «шрифты (fonts/) намеренно не кэшируются» — обработчик fetch кладёт в кэш любой GET своего origin, шрифты тоже (они не в `SHELL_FILES`, но попадают туда при первом показе). Это хорошо для офлайна, плохо, что комментарий говорит обратное.

Решение: сеть первой для всех GET своего origin, кэш — запасной путь, если сеть упала или не ответила за 3 секунды (плохая мобильная связь не должна вешать запуск). Для навигации без записи в кэше — `index.html` из кэша (офлайн-запуск по любой ссылке `#/…`). Чужие origin (Firebase, Yandex, Google) — не трогаем, как сейчас. Push-обработчики — без изменений.

**Files:**
- Modify: `sw.js` (шапка-комментарий, `CACHE_NAME`, обработчик `fetch`)
- Create: `tests/uni-sw.js`
- Modify: `package.json` (скрипты `test` и `check`)

**Interfaces:**
- Produces: `CACHE_NAME = 'nasha-vselennaya-shell-v3'`, `NET_TIMEOUT_MS = 3000`, `async function networkFirst(req)` — топ-уровень `sw.js`.

- [ ] **Шаг 1: Написать tests/uni-sw.js**

```js
// sw.js: сеть первой, кэш — запасной путь. Запуск: node tests/uni-sw.js
'use strict';
const fs = require('fs');
const vm = require('vm');

let failed = 0;
const assert = (cond, msg) => {
  console.log((cond ? 'OK: ' : 'FAIL: ') + msg);
  if (!cond) failed++;
};

const SCOPE = 'https://ledoksi.test/app/';
const resp = body => ({ ok: true, body, clone() { return this; } });

function makeSw(netImpl) {
  const store = new Map(); // url → ответ
  const handlers = {};
  const key = r => (typeof r === 'string' ? new URL(r, SCOPE).href : r.url);
  const cache = {
    async match(r) { return store.get(key(r)); },
    async put(r, res) { store.set(key(r), res); },
    async addAll() {}
  };
  const self = {
    location: new URL('sw.js', SCOPE),
    addEventListener: (t, f) => (handlers[t] = f),
    skipWaiting() {},
    clients: { claim() {} },
    registration: {}
  };
  // Таймаут в тесте — 30 мс вместо 3 с, иначе сценарий «сеть висит» ждал бы 3 секунды.
  const src = fs.readFileSync('sw.js', 'utf8').replace(/NET_TIMEOUT_MS = \d+/, 'NET_TIMEOUT_MS = 30');
  vm.runInContext(src, vm.createContext({ self, caches: { open: async () => cache, match: r => cache.match(r), keys: async () => [], delete: async () => true }, fetch: netImpl, URL, setTimeout, Promise }));
  const fetchEvent = (url, mode = 'no-cors') => {
    const ev = { request: { url: new URL(url, SCOPE).href, method: 'GET', mode }, responded: null };
    ev.respondWith = p => (ev.responded = p);
    handlers.fetch(ev);
    return ev;
  };
  return { store, fetchEvent, key };
}

(async () => {
  // 1. Сеть жива — свежий ответ, кэш обновлён
  let sw = makeSw(async () => resp('новый'));
  sw.store.set(sw.key('app.min.js'), resp('старый'));
  let ev = sw.fetchEvent('app.min.js');
  assert((await ev.responded).body === 'новый', 'сеть жива — отдаём свежий файл, не кэш');
  await new Promise(r => setTimeout(r, 5));
  assert(sw.store.get(sw.key('app.min.js')).body === 'новый', 'свежий файл положен в кэш');

  // 2. Сеть упала — кэш
  sw = makeSw(async () => { throw new Error('offline'); });
  sw.store.set(sw.key('styles.css'), resp('из кэша'));
  assert((await sw.fetchEvent('styles.css').responded).body === 'из кэша', 'офлайн — отдаём кэш');

  // 3. Сеть висит дольше таймаута — кэш
  sw = makeSw(() => new Promise(r => setTimeout(() => r(resp('поздно')), 200)));
  sw.store.set(sw.key('app.min.js'), resp('из кэша'));
  assert((await sw.fetchEvent('app.min.js').responded).body === 'из кэша', 'сеть не ответила за таймаут — кэш');

  // 4. Сеть висит, кэша нет — ждём сеть
  sw = makeSw(() => new Promise(r => setTimeout(() => r(resp('поздно')), 60)));
  assert((await sw.fetchEvent('fonts/onest.woff2').responded).body === 'поздно', 'кэша нет — дожидаемся сети');

  // 5. Навигация офлайн по адресу без записи — index.html
  sw = makeSw(async () => { throw new Error('offline'); });
  sw.store.set(sw.key('./index.html'), resp('оболочка'));
  assert((await sw.fetchEvent('?from=push', 'navigate').responded).body === 'оболочка', 'офлайн-навигация — index.html из кэша');

  // 6. Чужой origin — не перехватываем
  sw = makeSw(async () => resp('x'));
  ev = sw.fetchEvent('https://firestore.googleapis.com/v1/x');
  assert(ev.responded === null, 'чужой origin не перехватывается');

  if (failed) {
    console.log('FAIL: ' + failed);
    process.exit(1);
  }
  console.log('OK: uni-sw');
})();
```

- [ ] **Шаг 2: Тест падает**

Run: `node tests/uni-sw.js`
Expected: `FAIL: сеть жива — отдаём свежий файл, не кэш` (сейчас кэш отвечает первым); дальше старый код может уронить тест исключением на сценарии 5 — это тоже «падает». Проверено на копии 25.09.2026.

- [ ] **Шаг 3: Переписать обработчик fetch в sw.js**

Заменить обработчик `self.addEventListener('fetch', …)` и комментарий над ним:

```js
// Сеть первой, кэш — запасной путь. Раньше было stale-while-revalidate: после
// деплоя первый заход показывал прошлую версию, а index.html и app.min.js
// могли оказаться из разных версий. Кэш отвечает, только если сеть упала или
// не ответила за NET_TIMEOUT_MS (плохая мобильная связь не вешает запуск).
// Firebase/Yandex/Google — чужой origin, не трогаем.
const NET_TIMEOUT_MS = 3000;

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const network = fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  });
  network.catch(() => {}); // отказ сети обработан ниже — не пускаем его в unhandledrejection
  const timeout = new Promise(resolve => setTimeout(resolve, NET_TIMEOUT_MS, null));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch (e) {}
  const cached = (await cache.match(req)) || (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
  return cached || network;
}
```

`CACHE_NAME` → `'nasha-vselennaya-shell-v3'` (смена логики fetch — по правилу из шапки файла). В шапке исправить фразу про шрифты: «Шрифты (fonts/) в SHELL_FILES не перечислены — установка кэша не должна падать из-за одного файла; в кэш они попадают при первом показе через обработчик fetch».

- [ ] **Шаг 4: Тест проходит, подключить в package.json**

Run: `node tests/uni-sw.js` → `OK: uni-sw`.

В `test` и `check` дописать ` && node tests/uni-sw.js` после `node tests/uni-render.js`.

- [ ] **Шаг 5: Проверка и коммит**

`npm run check` — зелёный (eslint уже линтит `sw.js`).

```bash
git add sw.js tests/uni-sw.js package.json
git commit -m "Fix: service worker — сеть первой с таймаутом 3 с, после деплоя сразу новая версия (NV-13, фаза 3)"
```

Проверка на живом сайте — в приёмке (стенд service worker отключает).

---

### Task 10: Документы и цифры

**Files:**
- Modify: `README.md:29` (список модулей)
- Modify: `docs/superpowers/baseline/metrics.md` (раздел «Firebase»)
- Modify: `PROJECT-MEMORY.md` (новый снимок `0f` сверху)

- [ ] **Шаг 1: README.md** — в строке ≈29 (дерево проекта) и везде, где перечислены модули `src/`, привести список к `ls src`. Упоминания `src/95-photos-cloud.js` про конфиги (строки ≈171, 191, 218, 259, 310) остаются верными — конфиги не переезжали; `presignedFetch` тоже в `95-photos-cloud.js` — проверить `grep -n presignedFetch src/*.js`.

- [ ] **Шаг 2: metrics.md** — в разделе «Firebase НЕ включён…» заменить неподтверждённое «~184 КБ» замером от 25.09.2026:

```markdown
Замер 25.09.2026 (`curl` с gstatic, `gzip -9`), firebase 10.14.0 compat:
app 31.8 КБ / 10.0 КБ gz, auth 139.3 КБ / 39.4 КБ gz, firestore 343.8 КБ /
101.3 КБ gz — **итого 515 КБ, 151 КБ gz**. Для сравнения: модульный SDK,
собранный esbuild ровно под наши вызовы (initializeAuth + popup/redirect,
Firestore с persistentLocalCache), — 124 КБ gz. Переход отложен (NV-46),
выигрыш 27 КБ не окупает риск для входа.
```

- [ ] **Шаг 3: PROJECT-MEMORY.md** — новый раздел `## 0f. ⚡ Снимок состояния (<дата>) — САМЫЙ СВЕЖИЙ`, у `0e` убрать «САМЫЙ СВЕЖИЙ». Содержание (коротко, фактами):
  - новые файлы после распила и правило «имя = место в сборке»;
  - `html`/`raw`/`render` — единственный способ писать разметку, страж `tests/uni-render.js`;
  - стенд берёт разметку из `index.html` (копии нет), `shots.js` детерминирован, `shots-diff.js` — проверка «вид не изменился»;
  - SW: сеть первой, `v3`;
  - Firebase остался на compat — почему, с цифрами;
  - из хвостов 0e закрыты: копия разметки в стенде, модалка на снимках, `serve.js` на `0.0.0.0`, цифра Firebase; остались: `.hero-names` AA в светлой теме, пустой `@layer utilities`, регистрозависимость стража токенов.

- [ ] **Шаг 4: Коммит**

```bash
git add README.md docs/superpowers/baseline/metrics.md PROJECT-MEMORY.md
git commit -m "Docs: фазы 2–3 — модули, замер Firebase, снимок PROJECT-MEMORY (NV-13)"
```

---

## Приёмка фаз 2–3

- [ ] `npm run check` зелёный, включая `uni-render` и `uni-sw`.
- [ ] `node tools/shots-diff.js phase-2-start <последний прогон>` → `OK` (в тот же день, что эталон; если день сменился — снять `phase-2-start` заново с коммита до Task 2 через `git stash`/`git worktree` и сравнить).
- [ ] `grep -n "innerHTML\s*=" src/*.js` — одна строка, `src/00-html.js`.
- [ ] `wc -l src/*.js` — ни одного файла больше 500 строк, кроме тех, что не резались (`30-home.js` 512 — не в объёме фазы).
- [ ] Ветка влита в `main`, деплой прошёл. На телефоне: открыть сайт, закрыть, задеплоить любую правку, открыть снова — новая версия видна с первого захода (раньше — со второго). Режим полёта → сайт открывается из кэша.

---

## Self-Review (выполнен автором плана)

**Покрытие спеки и карточек эпика.** Фаза 2 спеки: «один способ рендера вместо 35 innerHTML» — задачи 3–8 (пересчитано: 32 присваивания); «распил пяти больших файлов» — задача 2, все пять. Раздел 6 спеки «тесты на новый рендер: экранирование, идемпотентность, порядок» — `tests/uni-render.js` (экранирование, повторный render, порядок элементов массива). Фаза 3 спеки: ревизия service worker — задача 9; Firebase compat → модульный и `content-visibility` — сознательно вынесены решением владельца 25.09.2026 (NV-46 → бэклог с замером, NV-48 → чеклист NV-54 в фазе 6). Хвосты снимка 0e из PROJECT-MEMORY, мешающие проверке фазы 2 (копия разметки в стенде, модалка на всех снимках), — задача 1, первой, потому что без неё обещание «ни пикселя не изменилось» нечем проверить.

**Заглушки.** Код дан для всего нового (помощник, оба теста, стенд, снимки, дифф, SW). Для переводов 4–8 полный код дан на заметках (задача 4); остальные файлы — по общему блоку правил с точными местами. Переписывать в плане 30 шаблонов целиком — значит писать план длиннее кода и устаревшим к моменту исполнения; правила + побайтовый дифф снимков + страж ловят ошибки лучше.

**Согласованность имён.** `html`, `raw`, `render`, `SafeHtml` — задача 3, используются в 4–8 под теми же именами. `PENDING` — задача 3, сокращается в 4–8, пуст после 8. `phase-2-start` — задача 1, сравнение во всех следующих. Имена новых файлов распила одинаковы в «Файловой структуре», задаче 2, `PENDING` и задачах 6–8.

**Порядок.** Стенд (1) — до всего: без детерминированных снимков нечем доказать «вид не изменился». Распил (2) — до рендера: переводы идут уже в маленьких файлах, а чистый перенос проверяется идентичностью `app.js`, что невозможно, если переносить уже изменённый код. Помощник (3) — до переводов. SW (9) независим, стоит последним в коде, потому что его проверка — живой деплой.
