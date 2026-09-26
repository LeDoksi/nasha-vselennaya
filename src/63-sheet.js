/* ===== Шторки: поведение нативных <dialog> (фаза 4) =====
   Esc у модального <dialog> браузер превращает в событие cancel и закрывает
   диалог сам — мимо closeOverlay, и тогда hidden и побочные эффекты
   (сброс лайтбокса, «приглашение закрыто») разъехались бы с открытостью.
   Поэтому cancel перехватываем и закрываем своим путём. Esc, пока открыт
   календарик, гасится раньше — document-level keydown в 42-datepicker.js
   закрывает его и вызывает preventDefault(), так что cancel у диалога вообще
   не срабатывает; сюда доходит только Esc без открытого календарика. */
$$('dialog.overlay').forEach(dlg => {
  dlg.addEventListener('cancel', e => {
    e.preventDefault();
    closeOverlay(dlg.id);
  });
});

/* Свайп вниз (только телефон): тянем за ручку .sheet-grip, шторка едет за
   пальцем через --sheet-dy; отпустили — закрываем или возвращаем пружиной. */
const SHEET_CLOSE_PX = 96;
const SHEET_CLOSE_SPEED = 0.6; // px/мс — быстрый смах закрывает и коротким ходом
function sheetShouldClose(dy, ms) {
  return dy > SHEET_CLOSE_PX || (dy > 24 && dy / Math.max(ms, 1) > SHEET_CLOSE_SPEED);
}
function sheetDragSetup(dlg) {
  const modal = dlg.querySelector('.modal');
  if (!modal) return;
  const grip = document.createElement('div');
  grip.className = 'sheet-grip';
  grip.setAttribute('aria-hidden', 'true');
  modal.prepend(grip);
  let y0 = 0,
    t0 = 0,
    dy = 0,
    dragging = false;
  grip.addEventListener('pointerdown', e => {
    if (!window.matchMedia('(max-width: 820px)').matches) return;
    dragging = true;
    y0 = e.clientY;
    t0 = e.timeStamp;
    dy = 0;
    grip.setPointerCapture(e.pointerId);
    modal.classList.add('sheet-dragging');
  });
  grip.addEventListener('pointermove', e => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - y0);
    modal.style.setProperty('--sheet-dy', dy + 'px');
  });
  const end = e => {
    if (!dragging) return;
    dragging = false;
    modal.classList.remove('sheet-dragging');
    modal.style.removeProperty('--sheet-dy');
    if (sheetShouldClose(dy, e.timeStamp - t0)) closeOverlay(dlg.id);
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}
$$('dialog.overlay:not(.lightbox)').forEach(sheetDragSetup);
