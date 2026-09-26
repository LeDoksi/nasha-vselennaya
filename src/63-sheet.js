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
