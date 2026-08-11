/* ===== Перетаскивание чипа лейбла на фото (навесить лейбл броском) =====
   Единственный кросс-контейнерный жест, оставшийся вне SortableJS. Чипы лежат
   в #labelBar — контейнере, на котором Sortable нигде не создаётся, так что
   с реордером заметок/списков/подзадач/фото (SortableJS, forceFallback) этот
   обработчик конфликтовать не может: общих ручек/контейнеров нет.
   Обратное направление (фото → чип) живёт в самом SortableJS-инстансе
   #photosGrid — хит-тест по координатам отпускания прямо в его onEnd
   (см. src/70-photos.js), отдельного движка для него не нужно. */
'use strict';

const CHIP_DRAG_THRESHOLD = 6; // px движения до начала перетаскивания

const chipDrag = { state: null };

function chipDragSetup(container) {
  if (!container || !container.addEventListener) return;
  container.addEventListener('pointerdown', chipDragPointerDown);
  container.addEventListener('keydown', chipDragKeyDown); // Esc — фолбэк для тестов (мини-DOM без document/window)
  if (typeof window !== 'undefined' && window.addEventListener) {
    document.addEventListener('pointermove', chipDragPointerMove);
    document.addEventListener('pointerup', chipDragPointerUp);
    document.addEventListener('pointercancel', chipDragPointerCancel);
    document.addEventListener('keydown', chipDragKeyDown);
    window.addEventListener('blur', chipDragCancelSafe);
  } else if (document.body && document.body.addEventListener) {
    // мини-DOM тестов: события всплывают до body, window/blur нет
    document.body.addEventListener('pointermove', chipDragPointerMove);
    document.body.addEventListener('pointerup', chipDragPointerUp);
    document.body.addEventListener('pointercancel', chipDragPointerCancel);
  }
}

// Только пользовательские лейблы можно тащить — не системные (📅/💞).
function chipDragTarget(el) {
  if (!el || !el.closest) return null;
  const chip = el.closest('.album-chip[data-label]');
  if (!chip || !chip.dataset.label) return null;
  if (chip.dataset.label === EVENT_LABEL || chip.dataset.label === DATE_LABEL) return null;
  return chip;
}

function chipDragPointerDown(e) {
  if (chipDrag.state) return;
  if (e.button !== undefined && e.button !== 0) return; // только левая кнопка
  const chip = chipDragTarget(e.target);
  if (!chip) return;
  chipDrag.state = {
    chip, label: chip.dataset.label, started: false,
    px: e.clientX || 0, py: e.clientY || 0, x: e.clientX || 0, y: e.clientY || 0,
    grabDX: 0, grabDY: 0, ghost: null, hoverPhoto: null
  };
}

function chipDragPointerMove(e) {
  const st = chipDrag.state;
  if (!st) return;
  const x = e.clientX || 0, y = e.clientY || 0;
  st.x = x; st.y = y;
  if (!st.started) {
    if (Math.abs(x - st.px) < CHIP_DRAG_THRESHOLD && Math.abs(y - st.py) < CHIP_DRAG_THRESHOLD) return;
    chipDragBegin(st, e);
  }
  if (!st.started) return;
  if (st.ghost && st.ghost.style) {
    st.ghost.style.left = Math.round(x - st.grabDX) + 'px';
    st.ghost.style.top = Math.round(y - st.grabDY) + 'px';
  }
  const photo = chipDragPhotoAt(x, y, e.target);
  if (photo !== st.hoverPhoto) {
    if (st.hoverPhoto && st.hoverPhoto.classList) st.hoverPhoto.classList.remove('drag-over');
    if (photo && photo.classList) photo.classList.add('drag-over');
    st.hoverPhoto = photo;
  }
}

// elementFromPoint — точнее под реальным курсором; e.target (fallbackEl) —
// запасной вариант, когда elementFromPoint недоступен (напр. в тестах: события
// там диспатчатся прямо на нужный элемент, e.target и есть искомая цель).
function chipDragPhotoAt(x, y, fallbackEl) {
  let el = null;
  if (typeof document !== 'undefined' && typeof document.elementFromPoint === 'function') {
    try { el = document.elementFromPoint(x, y); } catch (err) {}
  }
  if (!el) el = fallbackEl;
  return el && el.closest ? el.closest('.photo') : null;
}

function chipDragBegin(st, e) {
  st.started = true;
  if (e && e.pointerId !== undefined && st.chip.setPointerCapture) {
    try { st.chip.setPointerCapture(e.pointerId); } catch (err) {}
  }
  const r = st.chip.getBoundingClientRect ? st.chip.getBoundingClientRect() : { left: st.x, top: st.y, width: 0 };
  st.grabDX = st.x - r.left; st.grabDY = st.y - r.top;
  if (st.chip.cloneNode) {
    const ghost = st.chip.cloneNode(true);
    ghost.classList.add('drag-ghost');
    if (ghost.style) {
      ghost.style.position = 'fixed';
      ghost.style.left = Math.round(r.left) + 'px';
      ghost.style.top = Math.round(r.top) + 'px';
      ghost.style.width = (r.width || 0) + 'px';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = '9999';
      ghost.style.transition = 'none';
      ghost.style.transform = 'rotate(1.5deg)';
      ghost.style.margin = '0';
    }
    if (document.body && document.body.appendChild) document.body.appendChild(ghost);
    st.ghost = ghost;
  }
  if (document.body && document.body.classList) document.body.classList.add('uni-dragging');
}

function chipDragPointerUp(e) { chipDragEnd(chipDrag.state, e, true); }
function chipDragPointerCancel() { chipDragEnd(chipDrag.state, null, false); }
function chipDragCancelSafe() { // потеря фокуса окна
  const st = chipDrag.state;
  if (!st) return;
  if (st.started) chipDragEnd(st, null, false);
  else chipDrag.state = null;
}
function chipDragKeyDown(e) {
  if (e.key === 'Escape' && chipDrag.state && chipDrag.state.started) chipDragEnd(chipDrag.state, null, false);
}

function chipDragEnd(st, e, ok) {
  if (!st) return;
  chipDrag.state = null;
  const started = st.started;
  if (st.hoverPhoto && st.hoverPhoto.classList) st.hoverPhoto.classList.remove('drag-over');
  if (st.ghost && st.ghost.remove) st.ghost.remove();
  if (document.body && document.body.classList) document.body.classList.remove('uni-dragging');
  if (!started) return; // обычный клик по чипу — фильтр переключит обычный делегат клика
  if (!ok) { chipDragSuppressClick(); return; } // Esc/cancel/blur — без применения лейбла
  const photo = e && (e.clientX !== undefined || e.clientY !== undefined)
    ? chipDragPhotoAt(e.clientX || st.x, e.clientY || st.y, e.target)
    : st.hoverPhoto;
  if (photo && photo.dataset && photo.dataset.id) {
    const targets = new Set(selectedPhotos); // всем отмеченным…
    targets.add(photo.dataset.id);           // …и фото под курсором
    applyLabelToPhotos(st.label, targets);
    selectedPhotos.clear();
    save(); renderPhotos();
  }
  chipDragSuppressClick();
}

// После реального драга браузер шлёт «клик» по чипу — гасим его, чтобы не
// переключился фильтр вместо применения лейбла.
function chipDragSuppressClick() {
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
