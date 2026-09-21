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
