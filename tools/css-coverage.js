// tools/css-coverage.js — одноразовый скрипт для Task 4 (мёртвый CSS).
// Обходит все экраны стенда (как shots.js), в обоих размерах и темах,
// и через Playwright CSS Coverage API собирает, какие правила styles.css
// реально сработали хоть раз. Остальное — КАНДИДАТЫ на мёртвый код, не приговор:
// стенд не наводит :hover, .dragging и пустые состояния списков.
//
// Запуск: node tools/serve.js (в отдельном окне), затем
//         node tools/css-coverage.js
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const VIEWS = ['home', 'calendar', 'notes', 'lists', 'wishlist', 'photos', 'memory', 'settings'];
const SIZES = { phone: { width: 390, height: 844 }, desk: { width: 1280, height: 900 } };
const CSS_PATH = path.join(__dirname, '..', 'styles.css');

// Разбирает styles.css на плоский список правил { selector, start, end }.
// Не парсер CSS целиком: просто считает вложенность фигурных скобок и на
// каждом закрытии фиксирует диапазон [start,end) — этого достаточно, чтобы
// сверить его с диапазонами покрытия, которые Playwright отдаёт как байтовые
// смещения в том же тексте файла.
function parseRules(css) {
  const rules = [];
  const stack = [];
  let marker = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      stack.push({ selector: css.slice(marker, i).trim(), start: marker });
      marker = i + 1;
    } else if (ch === '}') {
      const top = stack.pop();
      if (top) rules.push({ selector: top.selector, start: top.start, end: i + 1 });
      marker = i + 1;
    }
  }
  return rules;
}

// Контейнеры @media/@supports/@keyframes сами по себе не «правило с
// декларациями» — интересуют только листовые правила с настоящим селектором.
function isLeafRule(selector) {
  if (!selector) return false;
  if (/^@media|^@supports|^@keyframes/.test(selector)) return false;
  if (/^(\d+%|from|to)$/.test(selector)) return false; // шаги внутри @keyframes
  return true;
}

function lineOf(css, offset) {
  return css.slice(0, offset).split('\n').length;
}

(async () => {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  const rules = parseRules(css).filter(r => isLeafRule(r.selector));

  const browser = await chromium.launch();
  /** @type {{start:number,end:number}[]} */
  const covered = [];

  for (const [sizeName, viewport] of Object.entries(SIZES)) {
    for (const theme of ['dark', 'light']) {
      const page = await browser.newPage({ viewport });
      await page.coverage.startCSSCoverage();
      await page.goto('http://localhost:8090/tools/demo.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 10000 });
      await page.evaluate(t => setTheme(t), theme);
      for (const v of VIEWS) {
        await page.evaluate(view => go(view), v);
        await page.waitForTimeout(400);
      }
      const entries = await page.coverage.stopCSSCoverage();
      for (const entry of entries) {
        if (!entry.url.endsWith('/styles.css')) continue;
        for (const r of entry.ranges) covered.push(r);
      }
      await page.close();
      console.log('OK: покрытие снято (' + sizeName + '/' + theme + ')');
    }
  }
  await browser.close();

  function isCovered(start, end) {
    return covered.some(r => r.start < end && r.end > start);
  }

  const unused = rules.filter(r => !isCovered(r.start, r.end));
  console.log('\nВсего листовых правил: ' + rules.length + ', не сработало ни разу: ' + unused.length + '\n');
  for (const r of unused) {
    console.log('styles.css:' + lineOf(css, r.start) + '  ' + r.selector);
  }

  fs.writeFileSync(
    path.join(__dirname, '..', 'docs', 'superpowers', 'baseline', 'css-coverage-unused.json'),
    JSON.stringify(unused.map(r => ({ selector: r.selector, line: lineOf(css, r.start) })), null, 2)
  );
  console.log('\nOK: список сохранён в docs/superpowers/baseline/css-coverage-unused.json');
})();
