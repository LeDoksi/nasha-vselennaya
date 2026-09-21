// tools/browser-check.js — проверка drag&drop (SortableJS, forceFallback)
// на визуальном стенде (tools/demo.html). Раньше заходил через экран
// создания сейфа (#setupScreen/#setupPass/#setupGo) — этих элементов нет с
// момента перехода на Google-вход, скрипт был мёртв. Теперь вместо входа —
// стенд с фикстурами, сеть не нужна вообще.
//
// Запуск:
//   node tools/serve.js   (в отдельном окне)
//   node tools/browser-check.js
// Результат — в tools/browser-check-results.txt; ненулевой код выхода, если
// упал хоть один SCRIPT ERROR или хоть одна проверка drag&drop.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = 'http://localhost:8090/tools/demo.html';
const RESULTS_FILE = path.join(__dirname, 'browser-check-results.txt');

// Перетаскивает узел fromSel на место toSel — теми же событиями мыши, что
// использует настоящий пользователь. SortableJS создан с forceFallback:true
// (src/50-notes.js, src/60-lists-wishes.js, src/70-photos.js) именно потому,
// что нативный HTML5 DnD не работает на тач-устройствах — эмулируется он
// обычными mousedown/mousemove/mouseup, поэтому page.mouse тут и работает.
async function dragTo(page, fromSel, toSel) {
  const from = await page.$(fromSel);
  const to = await page.$(toSel);
  if (!from || !to) throw new Error('не нашёл узел для драга: ' + fromSel + ' → ' + toSel);
  const fBox = await from.boundingBox();
  const tBox = await to.boundingBox();
  const startX = fBox.x + fBox.width / 2,
    startY = fBox.y + fBox.height / 2;
  const endX = tBox.x + tBox.width / 2,
    endY = tBox.y + tBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(80); // дать SortableJS зафиксировать точку начала (drag threshold)
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const x = startX + ((endX - startX) * i) / steps;
    const y = startY + ((endY - startY) * i) / steps;
    await page.mouse.move(x, y, { steps: 3 });
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(120); // onEnd → repoBatch/renderX
}

async function checkNotesReorder(page, log) {
  await page.click('.nav-btn[data-view="notes"]');
  await page.waitForTimeout(150);
  // renderNotes() всегда ставит закреплённые (pinned) заметки первыми — драг
  // закреплённой карточки визуально не двигает её с места (демо-фикстуры
  // держат note-1 закреплённой специально, как и в реальных данных). Берём
  // две НЕзакреплённые карточки, иначе проверка ничего не проверяет.
  const before = await page.$$eval('#notesGrid .note:not(.pinned)', els => els.map(el => el.dataset.id));
  if (before.length < 2) {
    log.push('SKIP заметки: меньше двух незакреплённых карточек — нечего тащить');
    return true;
  }
  await dragTo(page, '#notesGrid .note[data-id="' + before[0] + '"] .note-drag', '#notesGrid .note[data-id="' + before[1] + '"] .note-drag');
  const after = await page.$$eval('#notesGrid .note', els => els.map(el => el.dataset.id));
  const sameSet = before.every(id => after.includes(id));
  const reordered = after.indexOf(before[0]) > after.indexOf(before[1]);
  const ok = sameSet && reordered;
  log.push((ok ? 'OK' : 'FAIL') + ' заметки: ' + before.join(',') + ' → ' + after.join(','));
  return ok;
}

async function checkListsReorder(page, log) {
  await page.click('.nav-btn[data-view="lists"]');
  await page.waitForTimeout(150);
  const before = await page.$$eval('#listsWrap .list-card', els => els.map(el => el.dataset.id));
  if (before.length < 2) {
    log.push('SKIP списки: меньше двух карточек — нечего тащить');
    return true;
  }
  await dragTo(page, '#listsWrap .list-card[data-id="' + before[0] + '"] .list-drag', '#listsWrap .list-card[data-id="' + before[1] + '"] .list-drag');
  const after = await page.$$eval('#listsWrap .list-card', els => els.map(el => el.dataset.id));
  const sameSet = before.length === after.length && before.every(id => after.includes(id));
  const reordered = after[0] !== before[0];
  const ok = sameSet && reordered;
  log.push((ok ? 'OK' : 'FAIL') + ' списки: ' + before.join(',') + ' → ' + after.join(','));
  return ok;
}

async function checkPhotosReorder(page, log) {
  await page.evaluate(() => go('photos'));
  await page.waitForTimeout(150);
  // Ручки .photo-drag рисуются только в режиме «↕ Порядок» (src/70-photos.js, photoReorderMode).
  await page.click('#photoReorderModeBtn');
  await page.waitForTimeout(150);
  const before = await page.$$eval('#photosGrid .photo', els => els.map(el => el.dataset.id));
  if (before.length < 2) {
    log.push('SKIP фото: меньше двух карточек — нечего тащить');
    return true;
  }
  await dragTo(page, '#photosGrid .photo[data-id="' + before[0] + '"] .photo-drag', '#photosGrid .photo[data-id="' + before[1] + '"] .photo-drag');
  const after = await page.$$eval('#photosGrid .photo', els => els.map(el => el.dataset.id));
  const sameSet = before.length === after.length && before.every(id => after.includes(id));
  const reordered = after[0] !== before[0];
  const ok = sameSet && reordered;
  log.push((ok ? 'OK' : 'FAIL') + ' фото: ' + before.join(',') + ' → ' + after.join(','));
  return ok;
}

(async () => {
  const log = [];
  const scriptErrors = [];
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') scriptErrors.push('SCRIPT ERROR (console): ' + msg.text());
  });
  page.on('pageerror', err => {
    scriptErrors.push('SCRIPT ERROR (pageerror): ' + (err && err.message ? err.message : String(err)));
  });

  let allOk = true;
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 15000 });
    log.push('OK стенд открылся, __demoReady = true');

    // Приглашение на свидание всплывает само (dt-invite в demo-fixtures.js) —
    // закрываем, иначе оно перекрывает клики по нижним вкладкам. Отключаем
    // View Transitions (data-motion=reduced, см. src/80-settings.js) —
    // проверке не нужен crossfade между вкладками, только стабильный DOM
    // сразу после переключения.
    await page.evaluate(() => {
      document.documentElement.dataset.motion = 'reduced';
      const ov = document.getElementById('dateInviteOverlay');
      if (ov) ov.hidden = true;
    });

    allOk = (await checkNotesReorder(page, log)) && allOk;
    allOk = (await checkListsReorder(page, log)) && allOk;
    allOk = (await checkPhotosReorder(page, log)) && allOk;
  } catch (e) {
    allOk = false;
    log.push('FAIL исключение: ' + (e && e.message ? e.message : String(e)));
  } finally {
    await browser.close();
  }

  const lines = [];
  lines.push('=== browser-check: ' + new Date().toISOString() + ' ===');
  lines.push('Стенд: ' + BASE);
  lines.push('');
  lines.push(...log);
  lines.push('');
  if (scriptErrors.length) {
    lines.push(...scriptErrors);
    allOk = false;
  } else {
    lines.push('SCRIPT ERROR: нет');
  }
  lines.push('');
  lines.push(allOk ? 'ИТОГ: OK' : 'ИТОГ: FAIL');
  const text = lines.join('\n') + '\n';
  fs.writeFileSync(RESULTS_FILE, text, 'utf8');
  console.log(text);
  process.exit(allOk ? 0 : 1);
})();
