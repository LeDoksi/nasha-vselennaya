// tools/shots.js — обходит все экраны стенда и снимает их.
// Запуск: node tools/serve.js (в отдельном окне), затем
//         node tools/shots.js <папка>
// Снимки детерминированы: одинаковый код в один и тот же день даёт побайтно
// одинаковые PNG — на этом стоит tools/shots-diff.js.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const VIEWS = ['home', 'calendar', 'notes', 'lists', 'wishlist', 'photos', 'settings'];
const SIZES = { phone: { width: 390, height: 844 }, desk: { width: 1280, height: 900 } };
const dir = path.join(__dirname, '..', 'docs', 'superpowers', 'baseline', process.argv[2] || 'shot');

// Math.random с фиксированным зерном (mulberry32): сердечки и конфетти
// каждый прогон одни и те же.
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
// Сердечки и конфетти НЕ скрываем: интервал спавна сердечек заглушен
// (disableHeartInterval), Math.random засеян — если поломка вернёт случайные
// сердечки/конфетти на экран, shots-diff.js должен это увидеть, а не молчать
// под display:none. Бесконечные CSS-анимации (пульс кнопки «Назначить
// свидание», пульс бейджа приглашений, шиммер загрузки фото и т.п.) Playwright
// animations:'disabled' гасит не идеально детерминированно — обнулённая
// длительность иногда всё равно даёт разные доли пикселя на границах
// box-shadow/градиента между прогонами. Глушим их явно здесь же, а не только
// флагом screenshot().
const HIDE_FLAKY = '#appToast{display:none!important}*,*::before,*::after{animation:none!important;transition:none!important}';
// Сердечки (src/90-effects-init.js, setInterval(…, 3800)) спавнятся по
// реальному времени и на каждый спавн съедают 4 вызова Math.random() —
// сколько успеет спавниться между стартом стенда и снимком зависит от
// скорости машины, а не от зерна: сдвигает всю последовательность
// псевдослучайных чисел между прогонами. Глушим сам интервал спавна (не CSS:
// скрытый спавн всё равно ест Math.random), единичный вызов spawnHeart() при
// загрузке скрипта (детерминированный, одна и та же точка последовательности)
// не трогаем.
function disableHeartInterval() {
  const real = window.setInterval.bind(window);
  window.setInterval = (fn, delay, ...args) => (delay === 3800 ? 0 : real(fn, delay, ...args));
}

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  // Без этих флагов растеризация мягких теней (карточки, box-shadow) даёт
  // разные значения соседних пикселей на ±1 единицу между прогонами — GPU и
  // частичный раст недетерминированы по кадрам даже при отключённых
  // анимациях. Набор — стандартный рецепт для детерминированных PNG-снимков
  // в Chromium/Playwright (форс software-раста, синхронная композиция).
  const browser = await chromium.launch({
    args: [
      '--disable-gpu',
      '--force-color-profile=srgb',
      '--disable-partial-raster',
      '--disable-skia-runtime-opts',
      '--run-all-compositor-stages-before-draw',
      '--disable-new-content-rendering-timeout'
    ]
  });
  for (const [sizeName, viewport] of Object.entries(SIZES)) {
    for (const theme of ['dark', 'light']) {
      const page = await browser.newPage({ viewport });
      await page.addInitScript(seedRandom);
      await page.addInitScript(disableHeartInterval);
      await page.goto('http://localhost:8090/tools/demo.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 10000 });
      // @font-face (Onest, Sofia Sans Extra Condensed, styles.css) грузятся
      // асинхронно: без ожидания первый снимок в прогоне иногда попадает на
      // фолбэк-шрифт с другими метриками — весь текст перетекает, снимок не
      // совпадает байт в байт со вторым прогоном (где шрифт уже в кэше).
      await page.evaluate(() => document.fonts.ready);
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
