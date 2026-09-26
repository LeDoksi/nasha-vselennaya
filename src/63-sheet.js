/* ===== Шторки: поведение нативных <dialog> (фаза 4) =====
   Esc у модального <dialog> браузер превращает в событие cancel и закрывает
   диалог сам — мимо closeOverlay, и тогда hidden и побочные эффекты
   (сброс лайтбокса, «приглашение закрыто») разъехались бы с открытостью.
   Поэтому cancel перехватываем и закрываем своим путём. Esc внутри
   календарика гасится там же (datePopKeydown → preventDefault) — до cancel
   дело не доходит, закрывается только календарик. */
$$('dialog.overlay').forEach(dlg => {
  dlg.addEventListener('cancel', e => {
    e.preventDefault();
    const pop = $('#datePop');
    if (pop && !pop.hidden) {
      closeDatePop();
      return;
    }
    closeOverlay(dlg.id);
  });
});
