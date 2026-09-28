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
// (src/50-notes.js, src/60-lists.js, src/72-photo-labels.js) именно потому,
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
  await page.evaluate(() => go('notes'));
  // Смена вкладки идёт через View Transitions API (src/20-theme-nav.js,
  // runViewTransition), длительность — --dur-enter (styles.css) — раньше
  // клик по .nav-btn сам по себе съедал эту паузу, go() через evaluate() мгновенный,
  // и boundingBox() до конца анимации даёт координаты, которые к началу драга уже устарели.
  await page.waitForTimeout(450);
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
  await page.evaluate(() => go('lists'));
  await page.waitForTimeout(450); // см. комментарий в checkNotesReorder про View Transitions
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

// Гонка contextmenu на Android 12+ Chrome (H2, фаза 6): системный таймаут
// долгого нажатия (400мс) короче LONG_PRESS_MS (450) — contextmenu приходит
// раньше, чем наш таймер. pointerdown зажат, но contextmenu дёргается ДО
// 450мс — ожидание: режим выбора включается тем же обработчиком и системное
// меню гасится (preventDefault), не дожидаясь нашего таймера.
async function checkPhotoContextMenuRace(page, log) {
  await page.evaluate(() => {
    go('photos');
    if (photoReorderMode) togglePhotoReorderMode();
    if (photoSelectMode) togglePhotoSelectMode();
  });
  await page.waitForTimeout(200);
  const box = await page.locator('#photosGrid .photo img').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(200); // меньше LONG_PRESS_MS=450 — наш таймер ещё не сработал
  const r = await page.evaluate(() => {
    const img = document.querySelector('#photosGrid .photo img');
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    img.dispatchEvent(ev);
    return { prevented: ev.defaultPrevented, mode: photoSelectMode };
  });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const ok = r.mode === true && r.prevented === true;
  log.push((ok ? 'OK' : 'FAIL') + ' contextmenu-гонка: режим=' + r.mode + ', preventDefault=' + r.prevented);
  await page.evaluate(() => {
    if (photoSelectMode) togglePhotoSelectMode();
  });
  return ok;
}

// Фаза 8 (NV-97): плитка ушла за экран, пока открыт лайтбокс — закрытие без
// перелёта (иначе фото улетает за край).
// Отклонение от брифа: там сценарий — window.scrollTo() после открытия
// лайтбокса. В реальном коде это не воспроизводит баг иначе, чем задумано —
// `html{scroll-behavior:smooth}` (styles.css) делает scrollTo() плавным, а не
// мгновенным, так что синхронная проверка геометрии сразу после вызова ловит
// плитку в процессе плавной прокрутки, а не в конечном положении. Настоящий
// путь к NV-97 — не автообновление сетки (фото НЕ подписаны на живые
// изменения, синк идёт явным опросом, а не пушем), а листание лайтбокса
// (next/prev) до фото, чья плитка в сетке уже проехала мимо экрана. Проще и
// надёжнее воспроизвести это без реальной прокрутки/жестов — падаем 60 фото
// перед текущим и зовём renderPhotosNow(): та же лента, тот же scrollY, но
// нужная плитка уехала на N строк вниз, ровно как после листания к дальнему
// кадру.
async function checkLightboxOffscreen(page, log) {
  const r = await page.evaluate(async () => {
    go('photos');
    await new Promise(ok => setTimeout(ok, 200));
    const img = document.querySelector('#photosGrid .photo img[data-photo]');
    const real = Document.prototype.startViewTransition;
    document.startViewTransition = undefined;
    openLightboxFrom(img);
    for (let i = 0; i < 60; i++) db.photos.unshift({ id: 'nv97pad' + i, title: 'x', order: -100 - i, labels: [] });
    renderPhotosNow();
    await new Promise(ok => setTimeout(ok, 100));
    let calls = 0;
    document.startViewTransition = cb => {
      calls++;
      return real.call(document, cb);
    };
    closeOverlay('lightbox');
    await new Promise(ok => setTimeout(ok, 400));
    document.startViewTransition = undefined;
    const closed = document.getElementById('lightbox').hidden;
    db.photos = db.photos.filter(p => !p.id.startsWith('nv97pad'));
    renderPhotosNow();
    return { calls, closed };
  });
  const ok = r.calls === 0 && r.closed;
  log.push((ok ? 'OK' : 'FAIL') + ' лайтбокс, плитка за экраном: перелётов=' + r.calls + ', закрыт=' + r.closed);
  return ok;
}

// Клавиатурный проход (NV-97): Esc у шторки и у календарика внутри неё,
// тост, показанный поверх шторки, переживает её закрытие, стрелки «Наше»
// переключают вкладку и переносят фокус (roving tabindex).
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
  // L5: браузерные сочетания не перехватываем — Alt+стрелки это Назад/Вперёд, Ctrl+Home/End это прокрутка
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Control+End');
  out.push(['«Наше»: Alt+стрелка и Ctrl+End не переключают вкладку', await page.evaluate(() => activeView === 'lists' && document.activeElement.dataset.our === 'lists')]);
  // Roving tabindex: в Tab-порядке ровно одна вкладка «Наше» (m2 — убрать b.tabIndex в showView)
  out.push(['«Наше»: roving tabindex — в Tab-порядке одна вкладка', await page.evaluate(() => [...document.querySelectorAll('.our-tab')].map(t => t.tabIndex).join() === '-1,0,-1')]);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  out.push(['«Наше»: ArrowLeft с первой вкладки заворачивает на последнюю', await page.evaluate(() => activeView === 'wishlist' && document.activeElement.dataset.our === 'wishlist')]);
  // Орбита: aria-label не пропадает (m4 — убрать атрибут целиком)
  await page.evaluate(() => {
    go('home');
    renderHome();
  });
  out.push(['орбита: у кольца есть aria-label про годовщину', await page.evaluate(() => /годовщин/i.test(document.querySelector('#progressRing .orbit-ring').getAttribute('aria-label') || ''))]);
  // Ось: Enter на фото открывает лайтбокс, Esc возвращает фокус на него (m1 — убрать keydown оси)
  await page.evaluate(() => {
    db.photos.push({ id: 'kb1', title: 'kb', takenAt: Date.now() - 5 * 86400000, labels: [], order: 999 });
    setThumbUrl('kb1', 'data:image/gif;base64,R0lGODlhAQABAAAAACw=');
    renderHome();
    document.querySelector('[data-lightbox="kb1"]').focus();
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  out.push(['ось: Enter на фото открывает лайтбокс', await page.evaluate(() => !document.getElementById('lightbox').hidden)]);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  out.push(['ось: Esc закрывает лайтбокс, фокус возвращается на фото', await page.evaluate(() => document.getElementById('lightbox').hidden && document.activeElement.dataset.lightbox === 'kb1')]);
  // L5: Ctrl+Enter и автоповтор Enter (e.repeat) — не открытие
  const axisRep = await page.evaluate(() => {
    const el = document.querySelector('[data-lightbox="kb1"]');
    const fire = init => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
    fire({ repeat: true });
    fire({ ctrlKey: true });
    return document.getElementById('lightbox').hidden;
  });
  out.push(['ось: автоповтор Enter и Ctrl+Enter не открывают лайтбокс', axisRep]);
  await page.evaluate(() => {
    db.photos = db.photos.filter(p => p.id !== 'kb1');
    renderHome();
  });
  // Галерея (ревью раунд 1): Enter на плитке открывает лайтбокс, Esc закрывает
  // и возвращает фокус на неё же (lbFlyBack, NV-97).
  await page.evaluate(() => go('photos'));
  await page.waitForTimeout(200);
  // Кольцо фокуса на плитке видно: .photo режет содержимое (overflow:hidden),
  // кольцо с offset наружу невидимо — кадры сфокусированной и обычной плитки
  // были бы побайтно равны (ревью раунда 2).
  const tile = page.locator('#photosGrid .photo').first();
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.waitForTimeout(100);
  const shotBlur = await tile.screenshot();
  await page.evaluate(() => document.querySelector('#photosGrid .photo img[data-photo]').focus());
  await page.waitForTimeout(100);
  const shotFocus = await tile.screenshot();
  out.push(['галерея: кольцо фокуса на плитке нарисовано внутрь (offset < 0)', await page.evaluate(() => parseFloat(getComputedStyle(document.activeElement).outlineOffset) < 0)]);
  out.push(['галерея: кадры плитки в фокусе и без него различаются', !shotBlur.equals(shotFocus)]);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  out.push(['галерея: Enter на плитке открывает лайтбокс', await page.evaluate(() => !document.getElementById('lightbox').hidden)]);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  out.push([
    'галерея: Esc закрывает лайтбокс, фокус возвращается на плитку',
    await page.evaluate(() => document.getElementById('lightbox').hidden && document.activeElement.hasAttribute('data-photo'))
  ]);
  // L5: то же на плитке галереи
  const gridRep = await page.evaluate(() => {
    const el = document.querySelector('#photosGrid .photo img[data-photo]');
    const fire = init => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
    fire({ repeat: true });
    fire({ metaKey: true });
    return document.getElementById('lightbox').hidden;
  });
  out.push(['галерея: автоповтор Enter и Meta+Enter не открывают лайтбокс', gridRep]);
  // L3: плитку перерисовали, пока открыт лайтбокс — Esc всё равно возвращает фокус на плитку по id
  await page.evaluate(() => document.querySelector('#photosGrid .photo img[data-photo]').focus());
  const lbId = await page.evaluate(() => document.activeElement.dataset.photo);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await page.evaluate(() => renderPhotosNow());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  out.push(['галерея: перерисовка под лайтбоксом, Esc — фокус на плитке с тем же id', await page.evaluate(id => document.getElementById('lightbox').hidden && document.activeElement.dataset.photo === id, lbId)]);
  // Режим выбора (L1, m3): Space переключает выбор, фокус остаётся на той же плитке
  // после перерисовки сетки, состояние объявлено через aria-pressed.
  await page.evaluate(() => {
    photoReorderMode = false;
    photoSelectMode = true;
    selectedPhotos.clear();
    renderPhotosNow();
    document.querySelector('#photosGrid .photo img[data-photo]').focus();
  });
  const firstId = await page.evaluate(() => document.activeElement.dataset.photo);
  const selState = () => page.evaluate(id => ({ sel: selectedPhotos.has(id), focus: document.activeElement.dataset.photo === id, pressed: document.activeElement.getAttribute('aria-pressed') }), firstId);
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  const s1 = await selState();
  out.push(['выбор: Space отмечает фото, фокус остаётся на плитке, aria-pressed=true', s1.sel && s1.focus && s1.pressed === 'true']);
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  const s2 = await selState();
  out.push(['выбор: второй Space снимает отметку, фокус на месте, aria-pressed=false', !s2.sel && s2.focus && s2.pressed === 'false']);
  // Режим порядка (L4): плитка не кнопка, Space на ней не глотается
  const ro = await page.evaluate(() => {
    photoSelectMode = false;
    selectedPhotos.clear();
    photoReorderMode = true;
    renderPhotosNow();
    const img = document.querySelector('#photosGrid .photo img[data-photo]');
    const notPrevented = img.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    const r = { tab: img.hasAttribute('tabindex'), role: img.hasAttribute('role'), notPrevented };
    photoReorderMode = false;
    renderPhotosNow();
    return r;
  });
  out.push(['порядок: у плитки нет tabindex и role=button, Space не подавляется', !ro.tab && !ro.role && ro.notPrevented]);
  let ok = true;
  for (const [name, pass] of out) {
    log.push((pass ? 'OK' : 'FAIL') + ' клавиатура: ' + name);
    ok = ok && pass;
  }
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
    // закрываем, иначе оно перекрывает клики по нижним вкладкам. Закрывать
    // нужно через closeOverlay() (фаза 4, нативный <dialog>): просто снять
    // hidden не закрывает диалог по-настоящему (dialog.open остаётся true),
    // и его ::backdrop продолжает перехватывать клики по всей странице, хотя
    // сам диалог уже display:none. Отключаем View Transitions API — проверке
    // не нужен crossfade между вкладками, только стабильный DOM сразу после
    // переключения (runViewTransition в src/20-theme-nav.js без
    // startViewTransition применяет изменения сразу). Именно присваивание, не
    // delete: метод живёт на Document.prototype, delete с экземпляра ничего
    // не снимал — переход шёл, и 320 мс ::view-transition глотали мышь драга
    // заметок и списков (NV-79).
    await page.evaluate(() => {
      document.startViewTransition = undefined;
      // Раньше: if (typeof closeOverlay === 'function') — после переименования
      // функции приглашение молча оставалось открытым, и все клики ниже
      // упирались в его ::backdrop с непонятной ошибкой (NV-97).
      if (typeof closeOverlay !== 'function') throw new Error('closeOverlay не найдена — приглашение нечем закрыть');
      closeOverlay('dateInviteOverlay');
    });

    allOk = (await checkNotesReorder(page, log)) && allOk;
    allOk = (await checkListsReorder(page, log)) && allOk;
    allOk = (await checkPhotosReorder(page, log)) && allOk;
    allOk = (await checkPhotoLongPress(page, log)) && allOk;
    allOk = (await checkPhotoContextMenuRace(page, log)) && allOk;
    allOk = (await checkLightboxOffscreen(page, log)) && allOk;
    allOk = (await checkKeyboard(page, log)) && allOk;
    allOk = (await checkSheetSwipe(browser, log)) && allOk;
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
