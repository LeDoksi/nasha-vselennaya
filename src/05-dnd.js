/* ===== Универсальный drag на Pointer Events (схема A+D) =====
   Один движок для всех перетаскиваний (заметки, списки, фото, чипы лейблов):
   - Pointer Events + setPointerCapture — работает и мышью, и тачем;
   - «драг-ручки» (.drag-handle) как точки захвата, где нужны;
   - живое превью порядка: перестановка DOM + FLIP-анимация соседей —
     карточки плавно «разъезжаются» вокруг перетаскиваемой (без прыжков);
   - призрак (ghost) клона следует за курсором;
   - drop-цели вне контейнера (фото → чип лейбла и обратно);
   - отмена: Esc / pointercancel / потеря фокуса окна.
   Работает и в браузере, и в мини-DOM тестов (без window/rAF/cloneNode). */
'use strict';

const UNI_DRAG_THRESHOLD = 6;    // px движения до начала перетаскивания
const UNI_DRAG_DUR = 240;        // ms FLIP-переезда соседей
const UNI_DRAG_EASE = 'cubic-bezier(.2,.7,.3,1)';
const UNI_DRAG_SCROLL_EDGE = 80; // px от края окна — автоскролл
const UNI_DRAG_SCROLL_STEP = 20; // px за шаг автоскролла

const uniDrag = {
  state: null,   // текущий драг или null
  setups: [],    // конфиги драг-зон
  _global: false // глобальные слушатели привязаны
};

function uniDragSetup(opts) {
  uniDrag.setups.push(opts);
  const root = opts.container;
  if (root && root.addEventListener) {
    root.addEventListener('pointerdown', uniDragPointerDown);
    root.addEventListener('keydown', uniDragKeyDown); // Esc (фолбэк для тестов)
  }
  if (uniDrag._global) return;
  uniDrag._global = true;
  if (typeof window !== 'undefined' && window.addEventListener) {
    // браузер: события всплывают до document, а при уходе курсора за окно —
    // setPointerCapture перенаправляет их на захваченный элемент
    document.addEventListener('pointermove', uniDragPointerMove);
    document.addEventListener('pointerup', uniDragPointerUp);
    document.addEventListener('pointercancel', uniDragPointerCancel);
    document.addEventListener('keydown', uniDragKeyDown);
    window.addEventListener('blur', uniDragCancelSafe);
  } else if (document.body && document.body.addEventListener) {
    // мини-DOM тестов: события всплывают до body
    document.body.addEventListener('pointermove', uniDragPointerMove);
    document.body.addEventListener('pointerup', uniDragPointerUp);
    document.body.addEventListener('pointercancel', uniDragPointerCancel);
  }
}

function uniDragIdOf(el, setup) {
  if (setup.idOf) return setup.idOf(el);
  return el && el.dataset ? (el.dataset.id || el.dataset.label || '') : '';
}

function uniDragItemOf(el, setup) {
  if (!el || !el.closest) return null;
  let item = null;
  if (setup.handleSel) {
    const h = el.closest(setup.handleSel);
    if (!h || !h.closest) return null;
    item = h.closest(setup.itemSel);
  } else {
    if (setup.ignoreSel && el.closest(setup.ignoreSel)) return null;
    item = el.closest(setup.itemSel);
  }
  if (!item) return null;
  if (setup.allow && !setup.allow(item)) return null;
  return item;
}

// Реальный элемент под курсором: при pointer capture e.target — это ручка,
// поэтому в браузере спрашиваем document.elementFromPoint (в тестах — e.target).
function uniDragEventTarget(e) {
  if (typeof document !== 'undefined' && typeof document.elementFromPoint === 'function' &&
      e && e.clientX !== undefined) {
    try {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el) return el;
    } catch (err) {}
  }
  return e && e.target;
}

function uniDragPointerDown(e) {
  if (uniDrag.state) return;
  if (e.button !== undefined && e.button !== 0) return; // только левая кнопка
  const setup = uniDrag.setups.find(s => !!uniDragItemOf(e.target, s));
  if (!setup) return;
  const el = uniDragItemOf(e.target, setup);
  if (!el) return;
  uniDrag.state = {
    setup, el,
    id: uniDragIdOf(el, setup),
    started: false,
    px: e.clientX || 0, py: e.clientY || 0,
    x: e.clientX || 0, y: e.clientY || 0,
    grabDX: 0, grabDY: 0,
    ghost: null, ids: [], origin: [], hoverT: null, reorderRAF: null,
    scrollRAF: null, scrollX: 0, scrollY: 0
  };
  if (setup.handleSel) {
    // ручка — драг-поверхность: гасим выделение/скролл и держим указатель
    if (e.preventDefault) e.preventDefault();
    if (e.pointerId !== undefined && el.setPointerCapture) {
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    }
  }
}



function uniDragPointerMove(e) {
  const st = uniDrag.state;
  if (!st) return;
  const x = e.clientX || 0, y = e.clientY || 0;
  st.x = x; st.y = y;
  if (!st.started) {
    if (Math.abs(x - st.px) < UNI_DRAG_THRESHOLD && Math.abs(y - st.py) < UNI_DRAG_THRESHOLD) return;
    uniDragBegin(st);
  }
  if (!st.started) return;
  if (st.ghost && st.ghost.style) {
    st.ghost.style.left = Math.round(x - st.grabDX) + 'px';
    st.ghost.style.top = Math.round(y - st.grabDY) + 'px';
  }
  uniDragScrollSchedule(st, x, y);
  // подсветка живых drop-целей под курсором
  const tgt = uniDragTargetAt(uniDragEventTarget(e), st.setup.targets, st);
  if (tgt !== st.hoverT) {
    if (st.hoverT) st.hoverT.target.highlight(st.hoverT.el, false);
    if (tgt) tgt.target.highlight(tgt.el, true);
    st.hoverT = tgt;
  }
  // живое превью порядка: не чаще раза в кадр — pointermove приходит чаще, чем
  // rAF, и каждый перезапуск 240ms-«разъезда» рвёт анимацию соседей (дёргано).
  // Троттлим: за кадр применяем последнюю позицию курсора, FLIP успевает играть.
  if (st.setup.reorder !== false && st.setup.container) uniDragScheduleReorder(st);
}

function uniDragPointerUp(e) { uniDragEnd(uniDrag.state, e, true); }
function uniDragPointerCancel(e) { uniDragEnd(uniDrag.state, e, false); }
function uniDragCancelSafe() { // потеря фокуса окна
  const st = uniDrag.state;
  if (!st) return;
  if (st.started) uniDragEnd(st, null, false);
  else uniDrag.state = null;
}
function uniDragKeyDown(e) {
  if (e.key === 'Escape' && uniDrag.state && uniDrag.state.started) uniDragEnd(uniDrag.state, null, false);
}

// Запланировать живую перестановку порядка: один раз в кадр, по последним координатам.
// В мини-DOM тестов rAF нет — применяем сразу (тесты ждут синхронный порядок).
function uniDragScheduleReorder(st) {
  if (st.reorderRAF) return;
  if (typeof requestAnimationFrame !== 'function') { uniDragDoReorder(st); return; }
  st.reorderRAF = requestAnimationFrame(() => {
    st.reorderRAF = null;
    if (uniDrag.state === st && st.started) uniDragDoReorder(st);
  });
}

function uniDragDoReorder(st) {
  const idx = uniDragInsertIndex(st.setup.container, st.setup.itemSel, st.x, st.y, st.el);
  const ids = st.ids.slice();
  const from = ids.indexOf(st.id);
  if (from < 0) return;
  ids.splice(from, 1);
  ids.splice(Math.max(0, Math.min(idx, ids.length)), 0, st.id);
  if (ids.join('|') !== st.ids.join('|')) {
    uniDragFlipReorder(st.setup.container, st.setup.itemSel, ids, st.setup);
    st.ids = ids;
  }
}


function uniDragBegin(st) {
  st.started = true;
  if (st.setup.reorder !== false && st.setup.container) {
    st.ids = uniDragCards(st.setup.container, st.setup.itemSel).map(c => uniDragIdOf(c, st.setup));
  } else {
    st.ids = [st.id];
  }
  st.origin = st.ids.slice();
  // сбрасываем незавершённые inline-трансформы (соседи могли «доезжать» с прошлого драга)
  uniDragCards(st.setup.container, st.setup.itemSel).forEach(c => {
    if (c.style) { c.style.transition = ''; c.style.transform = ''; }
  });
  const el = st.el;
  const r = el.getBoundingClientRect();
  st.grabDX = st.x - r.left;
  st.grabDY = st.y - r.top;
  // призрак — клон карточки (в мини-DOM cloneNode нет — пропускаем)
  if (el.cloneNode) {
    const ghost = el.cloneNode(true);
    ghost.classList.add('drag-ghost');
    if (ghost.style) {
      ghost.style.position = 'fixed';
      ghost.style.left = Math.round(r.left) + 'px';
      ghost.style.top = Math.round(r.top) + 'px';
      ghost.style.width = (r.width || 0) + 'px';
      ghost.style.height = (r.height || 0) + 'px';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = '9999';
      ghost.style.transition = 'none';
      ghost.style.transform = 'rotate(1.5deg)';
      ghost.style.margin = '0';
    }
    if (document.body && document.body.appendChild) document.body.appendChild(ghost);
    st.ghost = ghost;
  }
  if (el.classList) el.classList.add('dragging');
  if (document.body && document.body.classList) document.body.classList.add('uni-dragging');
  if (st.setup.onStart) st.setup.onStart(st);
}


function uniDragEnd(st, e, ok) {
  if (!st) return;
  if (uniDrag.state === st) uniDrag.state = null;
  const started = !!st.started;
  // дожимаем последнюю живую перестановку, если она не успела попасть в кадр
  if (st.reorderRAF) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(st.reorderRAF);
    st.reorderRAF = null;
    if (started && st.setup.reorder !== false && st.setup.container) uniDragDoReorder(st);
  }
  if (st.scrollRAF) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(st.scrollRAF);
    st.scrollRAF = null;
  }
  if (st.hoverT) { st.hoverT.target.highlight(st.hoverT.el, false); st.hoverT = null; }
  if (st.ghost && st.ghost.remove) st.ghost.remove();
  st.ghost = null;
  if (st.el && st.el.classList) st.el.classList.remove('dragging');
  if (document.body && document.body.classList) document.body.classList.remove('uni-dragging');
  if (!started) return; // это был обычный клик — ничего не делаем
  if (ok && e) {
    const target = uniDragTargetAt(uniDragEventTarget(e), st.setup.targets, st);
    if (target) {
      // дроп на drop-цель (например, чип лейбла): порядок в DOM возвращаем к исходному
      if (st.setup.reorder !== false && st.setup.container) {
        uniDragApplyOrder(st.setup.container, st.setup.itemSel, st.origin, st.setup);
      }
      target.target.drop(st, target.el);
    } else if (st.setup.onDrop) {
      st.setup.onDrop(st);
    }
  } else {
    if (st.setup.reorder !== false && st.setup.container) {
      uniDragApplyOrder(st.setup.container, st.setup.itemSel, st.origin, st.setup);
    }
    if (st.setup.onCancel) st.setup.onCancel(st);
  }
  uniDragSuppressClick();
}

// После реального драга браузер шлёт «клик» (например, по ручке фото) —
// гасим его, чтобы не сработали выбор/лайтбокс/фильтр.
function uniDragSuppressClick() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.addEventListener) return;
  const suppress = e => {
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    document.removeEventListener('click', suppress, true);
  };
  document.addEventListener('click', suppress, true);
  if (typeof setTimeout === 'function') {
    setTimeout(() => document.removeEventListener('click', suppress, true), 120);
  }
}

function uniDragCards(container, itemSel) {
  if (!container) return [];
  if (container.querySelectorAll) {
    try { return [...container.querySelectorAll(itemSel)]; } catch (e) {}
  }
  if (container.children) {
    const cls = (itemSel.match(/\.([a-zA-Z0-9_-]+)/) || [])[1];
    return [...container.children].filter(c => c.classList && (!cls || c.classList.contains(cls)));
  }
  return [];
}



// Индекс вставки перетаскиваемой карточки среди остальных (0..cards.length).
// НЕ «ближайшая граница»: для сетки границы между строками/колонками равноудалены,
// индекс осциллирует между далёкими слотами (курсор «прыгает» с 1 на 4).
// Правило — по ближайшей КАРТОЧКЕ; индекс меняется только при пересечении её
// центра/края (монотонно):
//   - курсор ВНУТРИ карточки → сразу ПОСЛЕ неё («навёл на фото» = оно уехало);
//   - ниже центра карточки → после неё; выше центра → до неё;
//   - на уровне центра → по горизонтали (в строке: левее/правее центра).
function uniDragInsertIndex(container, itemSel, x, y, excludeEl) {
  // Курсор над САМИМ перетаскиваемым (тот стоит в текущем слоте вставки) —
  // возвращаем его текущий индекс: иначе «ближайшая» карточка из соседнего
  // ряда сдвигает слот в противоположный конец сетки (осцилляция 1↔4).
  if (excludeEl && excludeEl.getBoundingClientRect) {
    const rr = excludeEl.getBoundingClientRect();
    if (x >= rr.left && x <= rr.right && y >= rr.top && y <= rr.bottom) {
      const cur = uniDragCards(container, itemSel).indexOf(excludeEl);
      return cur < 0 ? 0 : cur;
    }
  }
  const cards = uniDragCards(container, itemSel).filter(c => c !== excludeEl);
  if (!cards.length) return 0;
  // 1) карточка, в которой курсор — приоритет («навёл» важнее «ближе»)
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i + 1;
  }
  // 2) иначе — ближайшая по центру (при равенстве — раньше по потоку)
  let best = 0, bestD = Infinity;
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    const cx = r.left + (r.width || 0) / 2, cy = r.top + (r.height || 0) / 2;
    const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    if (d < bestD) { bestD = d; best = i; }
  }
  const r = cards[best].getBoundingClientRect();
  const cx = r.left + (r.width || 0) / 2, cy = r.top + (r.height || 0) / 2;
  if (y > cy) return best + 1;
  if (y < cy) return best;
  return x > cx ? best + 1 : best;
}

function uniDragReflow(items) {
  if (!items || !items.length) return;
  try { items[0].getBoundingClientRect(); } catch (e) {} // чтение layout применяет ожидающие стили
}

// FLIP «разъезд»: переставляем DOM, затем каждый сосед доезжает на новое место
// через transform+transition. before замеряется ДО перестановки (с учётом ещё
// идущих анимаций), после — «чисто», с принудительно снятыми трансформами
// (синхронно, до отрисовки — промежуточное состояние не видно). Без прыжков.
function uniDragFlipReorder(container, itemSel, wantIds, setup) {
  const items = uniDragCards(container, itemSel);
  if (!items.length) return;
  const idOf = c => uniDragIdOf(c, setup);
  const before = new Map(items.map(c => [c, c.getBoundingClientRect()]));
  const order = new Map(wantIds.map((id, i) => [id, i]));
  [...items]
    .sort((a, b) => (order.get(idOf(a)) ?? 1e9) - (order.get(idOf(b)) ?? 1e9))
    .forEach(c => { if (c.remove) c.remove(); container.appendChild(c); });
  items.forEach(c => { if (c.style) { c.style.transition = 'none'; c.style.transform = ''; } });
  uniDragReflow(items);
  const after = new Map(items.map(c => [c, c.getBoundingClientRect()]));
  const moving = [];
  items.forEach(c => {
    if (c.classList && c.classList.contains && c.classList.contains('dragging')) return; // перетаскиваемую не анимируем
    const r1 = before.get(c), r2 = after.get(c);
    const dx = r1.left - r2.left, dy = r1.top - r2.top;
    if ((dx || dy) && c.style) {
      c.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      moving.push(c);
    }
  });
  uniDragReflow(items);
  if (moving.length) {
    // Стартуем transition СРАЗУ, в этом же кадре: translate уже «закоммичен»
    // принудительным reflow выше — браузер анимирует из позиции «до» в «после».
    // Отдельный rAF нельзя: следующий reorder-кадр снял бы transition раньше,
    // чем отрисовался бы хоть один кадр анимации — соседи «застывали» бы,
    // а при дропе всё прыгало скачком (именно так и было в браузере).
    moving.forEach(c => {
      if (c.style) {
        c.style.transition = 'transform ' + UNI_DRAG_DUR + 'ms ' + UNI_DRAG_EASE;
        c.style.transform = '';
      }
    });
  }
}

// Мгновенная перестановка DOM (без анимации) — для отмены драга.
function uniDragApplyOrder(container, itemSel, ids, setup) {
  const items = uniDragCards(container, itemSel);
  if (!items.length) return;
  const idOf = c => uniDragIdOf(c, setup);
  const order = new Map(ids.map((id, i) => [id, i]));
  [...items]
    .sort((a, b) => (order.get(idOf(a)) ?? 1e9) - (order.get(idOf(b)) ?? 1e9))
    .forEach(c => { if (c.remove) c.remove(); container.appendChild(c); });
  items.forEach(c => { if (c.style) { c.style.transition = ''; c.style.transform = ''; } });
}

function uniDragTargetAt(el, targets, st) {
  if (!el || !el.closest || !targets || !targets.length) return null;
  for (const t of targets) {
    const hit = el.closest(t.sel);
    if (hit && (!t.canDrop || t.canDrop(st, hit, el))) return { target: t, el: hit };
  }
  return null;
}

// Автоскролл страницы, когда курсор у края окна (списки длиннее экрана).
// Троттлим до раза в кадр: scrollBy на каждый pointermove рвёт FLIP и layout.
function uniDragScrollSchedule(st, x, y) {
  st.scrollX = x; st.scrollY = y;
  if (st.scrollRAF) return;
  if (typeof requestAnimationFrame !== 'function') { uniDragAutoScroll(x, y); return; }
  st.scrollRAF = requestAnimationFrame(() => {
    st.scrollRAF = null;
    if (uniDrag.state === st && st.started) uniDragAutoScroll(st.scrollX, st.scrollY);
  });
}

function uniDragAutoScroll(x, y) {
  if (typeof window === 'undefined' || typeof window.scrollBy !== 'function') return;
  const h = window.innerHeight || 0, w = window.innerWidth || 0;
  if (y < UNI_DRAG_SCROLL_EDGE) window.scrollBy(0, -UNI_DRAG_SCROLL_STEP);
  else if (y > h - UNI_DRAG_SCROLL_EDGE) window.scrollBy(0, UNI_DRAG_SCROLL_STEP);
  else if (x < UNI_DRAG_SCROLL_EDGE) window.scrollBy(-UNI_DRAG_SCROLL_STEP, 0);
  else if (x > w - UNI_DRAG_SCROLL_EDGE) window.scrollBy(UNI_DRAG_SCROLL_STEP, 0);
}
