/* ===== Глобальные клики ===== */
// Модалки — нативные <dialog> (фаза 4). Атрибут hidden держим в согласии с
// открытостью: на него смотрят тесты-песочницы и 90-effects-init.js
// (.overlay:not([hidden])). Открывать и закрывать — только через эту пару.
// Стек открытых модалок (в порядке открытия): пока модальный <dialog> открыт,
// спека делает inert вообще всё, что не лежит внутри него, — в том числе
// datePop/appToast (popover="manual") живут отдельным узлом от диалогов.
// Inert-элемент нельзя ни кликнуть, ни сфокусировать, ни услышать
// скринридером (aria-live), хотя визуально он и так поверх затемнения через
// top layer. topOverlayEl() — куда setPopover() (00-core.js) должен на время
// показа переносить такой popover, чтобы он не терял интерактивность.
// openOverlayStack — в src/00-core.js (та же причина TDZ, что у toastTimer/
// wishlistTab там: setPopover читает topOverlayEl() из top-level кода
// 20-theme-nav.js раньше, чем выполнится этот файл).
function topOverlayEl() {
  const id = openOverlayStack[openOverlayStack.length - 1];
  return id ? $('#' + id) : null;
}
function openOverlay(id) {
  const el = $('#' + id);
  if (!el) return;
  el.hidden = false;
  if (typeof el.showModal === 'function' && !el.open) el.showModal();
  if (openOverlayStack.indexOf(id) === -1) openOverlayStack.push(id);
  // Новая модалка легла поверх — если тост сейчас показан, он мог остаться
  // в предыдущей верхней (уже не самой верхней) и оказаться inert под этой.
  // Поднимаем его заново — setPopover переносит в новую верхнюю сам.
  const toast = $('#appToast');
  if (toast && !toast.hidden) setPopover(toast, true);
}
function closeOverlay(id) {
  const el = $('#' + id);
  if (!el) return;
  el.hidden = true;
  if (typeof el.close === 'function' && el.open) el.close();
  openOverlayStack = openOverlayStack.filter(x => x !== id);
  // Тост/календарик на время показа переезжают в текущую верхнюю модалку
  // (setPopover, 00-core.js), иначе спека делает их inert под открытым
  // <dialog>. Если ИМЕННО ЭТА модалка их сейчас приютила, а теперь
  // закрылась — popover остаётся формально «открытым» (hidden/showPopover
  // не менялись), но физически внутри уже display:none диалога: невидим
  // (checkVisibility() лжёт про hidden), недоступен, озвучка скринридером
  // молчит. Тост — самостоятельное сообщение, поднимаем заново (переедет в
  // новую верхнюю модалку или в body). Календарик привязан к полю именно
  // этой модалки — поле закрылось вместе с ней, поэтому его просто закрываем.
  const toast = $('#appToast');
  if (toast && !toast.hidden && toast._popoverHost === el) setPopover(toast, true);
  const pop = $('#datePop');
  if (pop && !pop.hidden && pop._popoverHost === el) closeDatePop();
  if (id === 'lightbox') lbResetState(); // светбокс закрыт — сбрасываем список и зум
  if (id === 'eventOverlay') editingEventId = null;
  // Закрыли не ответив — запоминаем на время сессии, чтобы не всплывало
  // повторно при каждом заходе на главную (см. src/30-home.js).
  if (id === 'dateInviteOverlay') markInvitesDismissed(pendingDateInvites().map(d => d.id));
}
// Долгое нажатие (Task 9, фикс раунда 1): «хвост клика» гасится в обработчике
// клика ниже, но только пока флаг не завис — платформа может не прислать
// клик вообще (iOS превращает удержание в contextmenu и подавляет click, см.
// 71-photo-grid.js). Без глобального сброса флаг оставался бы true до
// следующего долгого нажатия на #photosGrid и глушил бы ПЕРВЫЙ обычный клик
// по любому другому [data-photo] — календарь (41-calendar-photos.js), хотелки
// (61-wishes.js). Сбрасываем на pointerdown в фазе перехвата (документ —
// первым на пути события, раньше, чем сработает таймер #photosGrid).
document.addEventListener(
  'pointerdown',
  () => {
    photoLongPressed = false;
  },
  true
);
document.addEventListener('click', e => {
  const day = e.target.closest('[data-day]');
  if (day) {
    selectedDate = day.dataset.day;
    renderCalendar();
    return;
  }

  const delEv = e.target.closest('[data-del-event]');
  if (delEv) {
    if (!confirmDelete('Удалить событие? Это не отменить.')) return;
    db.events = db.events.filter(x => x.id !== delEv.dataset.delEvent);
    repoDelete('events', delEv.dataset.delEvent); // это событие, не список/хотелка
    renderCalendar();
    renderHome();
    return;
  }

  const editEv = e.target.closest('[data-edit-event]');
  if (editEv) {
    openEventModal(editEv.dataset.editEvent);
    return;
  }

  const editDt = e.target.closest('[data-edit-date]');
  if (editDt) {
    openDateModal(editDt.dataset.editDate);
    return;
  }

  const openInvites = e.target.closest('[data-open-invites]');
  if (openInvites) {
    openDateInviteOverlay();
    return;
  }

  const photoEv = e.target.closest('[data-photo-event]');
  if (photoEv) {
    addEventPhotoQuick(photoEv.dataset.photoEvent);
    return;
  }

  const photoDate = e.target.closest('[data-photo-date]');
  if (photoDate) {
    addDatePhotoQuick(photoDate.dataset.photoDate);
    return;
  }

  const answerDate = e.target.closest('[data-answer-date]');
  if (answerDate) {
    const d = db.dates.find(x => x.id === answerDate.dataset.answerDate);
    if (d) {
      const who = getUser();
      const val = answerDate.dataset.answer;
      d.responses = d.responses || {};
      const justAnswered = d.responses[who] !== val; // true, если это не «снял ответ», а именно новый ответ
      d.responses[who] = d.responses[who] === val ? null : val;
      if (d.responses.gosha === 'yes' && d.responses.dasha === 'yes') celebrate(); // оба согласились — салют!
      repoSet('dates', d); // меняется свидание (responses), не список/хотелка
      renderHome();
      renderCalendar();
      // Пуш пригласившему — только на настоящий ответ, не на его снятие; без деталей, см. src/96-push.js
      if (justAnswered && d.from && d.from !== who) {
        notifyPartner(val === 'yes' ? '💜 Свидание подтверждено' : '💔 Ответ на приглашение', 'Открой приложение, чтобы посмотреть 💜');
      }
    }
    return;
  }
  const doneDate = e.target.closest('[data-done-date]');
  if (doneDate) {
    toggleDateDone(doneDate.dataset.doneDate);
    return;
  }
  const delDate = e.target.closest('[data-del-date]');
  if (delDate) {
    if (!confirmDelete('Удалить свидание? Это не отменить.')) return;
    db.dates = db.dates.filter(x => x.id !== delDate.dataset.delDate);
    repoDelete('dates', delDate.dataset.delDate); // это свидание, не список/хотелка
    renderHome();
    renderCalendar();
    return;
  }

  const pinNote = e.target.closest('[data-pin-note]');
  if (pinNote) {
    togglePinNote(pinNote.dataset.pinNote);
    return;
  }
  const delNote = e.target.closest('[data-del-note]');
  if (delNote) {
    deleteNote(delNote.dataset.delNote);
    return;
  }
  const editNote = e.target.closest('[data-edit-note]');
  if (editNote) {
    startEditNote(editNote.dataset.editNote);
    return;
  }
  const saveNoteBtn = e.target.closest('[data-save-note]');
  if (saveNoteBtn) {
    saveNoteEdit(saveNoteBtn.dataset.saveNote);
    return;
  }
  const cancelNoteBtn = e.target.closest('[data-cancel-note]');
  if (cancelNoteBtn) {
    cancelNoteEdit();
    return;
  }

  const togItem = e.target.closest('[data-toggle-item]');
  if (togItem) {
    toggleSubtask(togItem.dataset.toggleItem, togItem.dataset.id);
    return;
  }
  const delItem = e.target.closest('[data-del-item]');
  if (delItem) {
    delSubtask(delItem.dataset.delItem, delItem.dataset.id);
    return;
  }
  const editItem = e.target.closest('[data-edit-item]');
  if (editItem) {
    startEditSubtask(editItem.dataset.editItem, editItem.dataset.id);
    return;
  }
  const saveItemBtn = e.target.closest('[data-save-item]');
  if (saveItemBtn) {
    saveSubtaskEdit(saveItemBtn.dataset.saveItem, saveItemBtn.dataset.id);
    return;
  }
  const cancelItemBtn = e.target.closest('[data-cancel-item]');
  if (cancelItemBtn) {
    cancelSubtaskEdit();
    return;
  }
  const listAdd = e.target.closest('[data-list-add]');
  if (listAdd) {
    addListSubtask(listAdd.dataset.listAdd, 'listInput-' + listAdd.dataset.listAdd);
    return;
  }
  const listDone = e.target.closest('[data-list-complete]');
  if (listDone) {
    completeList(listDone.dataset.listComplete);
    return;
  }
  const editList = e.target.closest('[data-edit-list]');
  if (editList) {
    startEditListName(editList.dataset.editList);
    return;
  }
  const saveListBtn = e.target.closest('[data-save-list]');
  if (saveListBtn) {
    saveListNameEdit(saveListBtn.dataset.saveList);
    return;
  }
  const cancelListBtn = e.target.closest('[data-cancel-list]');
  if (cancelListBtn) {
    cancelListNameEdit();
    return;
  }

  const photoSelectToggle = e.target.closest('[data-photo-select-toggle]');
  if (photoSelectToggle) {
    togglePhotoSelectMode();
    return;
  }
  const photoReorderToggle = e.target.closest('[data-photo-reorder-toggle]');
  if (photoReorderToggle) {
    togglePhotoReorderMode();
    return;
  }
  const selPhoto = e.target.closest('[data-sel-photo]');
  if (selPhoto) {
    const id = selPhoto.dataset.selPhoto;
    if (selectedPhotos.has(id)) selectedPhotos.delete(id);
    else selectedPhotos.add(id);
    renderPhotos();
    return;
  }
  const photo = e.target.closest('[data-photo]');
  if (photo) {
    // Долгое нажатие возможно только на #photosGrid — клик по [data-photo] в
    // календаре (41-calendar-photos.js) или в хотелках (61-wishes.js) глушить
    // нельзя, даже если флаг завис (см. document pointerdown ниже).
    if (photoLongPressed && photo.closest('#photosGrid')) {
      photoLongPressed = false; // клик — хвост долгого нажатия, выбор уже сделан
      return;
    }
    // В режиме выбора тап по плитке галереи выбирает её, а не открывает лайтбокс
    if (photoSelectMode && photo.closest('#photosGrid')) {
      const id = photo.dataset.photo;
      if (selectedPhotos.has(id)) selectedPhotos.delete(id);
      else selectedPhotos.add(id);
      renderPhotos();
      return;
    }
    openLightboxFrom(photo);
    return;
  }

  const wishDone = e.target.closest('[data-wish-done]');
  if (wishDone) {
    const w = db.wishlist.find(x => x.id === wishDone.dataset.wishDone);
    if (w) {
      const me = getUser();
      // Исполнить может только партнёр; снять отметку — только исполнивший.
      if (w.owner !== me && (!w.done || w.doneBy === me)) {
        if (w.done) {
          w.done = false;
          w.doneBy = null;
          w.doneAt = null;
        } else {
          w.done = true;
          w.doneBy = me;
          w.doneAt = Date.now();
        }
        repoSet('wishes', w);
      }
      renderWishlist();
    }
    return;
  }
  const editWish = e.target.closest('[data-edit-wish]');
  if (editWish) {
    openWishModal(editWish.dataset.editWish);
    return;
  }
  const wishDel = e.target.closest('[data-wish-del]');
  if (wishDel) {
    if (!confirmDelete('Удалить хотелку? Это не отменить.')) return;
    db.wishlist = db.wishlist.filter(x => x.id !== wishDel.dataset.wishDel);
    repoDelete('wishes', wishDel.dataset.wishDel);
    renderWishlist();
    return;
  }
  const wishTab = e.target.closest('[data-wish-tab]');
  if (wishTab) {
    wishlistTab = wishTab.dataset.wishTab;
    renderWishlist();
    return;
  }

  const labelNew = e.target.closest('[data-label-new]');
  if (labelNew) {
    openLabelManageOverlay();
    return;
  }
  const labelChip = e.target.closest('[data-label]');
  if (labelChip) {
    currentLabel = labelChip.dataset.label;
    eventFilter = { year: '', month: '', title: '' };
    renderPhotos();
    return;
  }

  const labelColorToggle = e.target.closest('[data-label-color-toggle]');
  if (labelColorToggle) {
    toggleLabelColorPicker(labelColorToggle.dataset.labelColorToggle);
    return;
  }
  const labelSetColor = e.target.closest('[data-label-set-color]');
  if (labelSetColor) {
    setLabelColor(labelSetColor.dataset.labelSetColor, labelSetColor.dataset.color);
    return;
  }
  const editLabel = e.target.closest('[data-edit-label]');
  if (editLabel) {
    startEditLabelName(editLabel.dataset.editLabel);
    return;
  }
  const saveLabelBtn = e.target.closest('[data-save-label]');
  if (saveLabelBtn) {
    saveLabelNameEdit(saveLabelBtn.dataset.saveLabel);
    return;
  }
  const cancelLabelBtn = e.target.closest('[data-cancel-label]');
  if (cancelLabelBtn) {
    cancelLabelNameEdit();
    return;
  }
  const delLabelBtn = e.target.closest('[data-del-label]');
  if (delLabelBtn) {
    deleteLabel(delLabelBtn.dataset.delLabel);
    return;
  }
  const applyToggle = e.target.closest('[data-label-apply-toggle]');
  if (applyToggle) {
    toggleLabelOnPhotos(applyToggle.dataset.labelApplyToggle, applyTargetIds);
    renderLabelApplyList();
    renderPhotos();
    return;
  }

  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) {
    closeOverlay(closeBtn.dataset.close);
    return;
  }
  if (e.target.classList && e.target.classList.contains('overlay')) closeOverlay(e.target.id);
});
// Двойной клик по подзадаче — как ✏️ (пара с редактированием заметок)
const listsWrapEl = $('#listsWrap');
if (listsWrapEl)
  listsWrapEl.addEventListener('dblclick', e => {
    const li = e.target.closest('li[data-item]');
    if (!li || e.target.closest('.check, .drag-handle, button, input')) return;
    const card = li.closest('.list-card');
    if (card) startEditSubtask(card.dataset.id, li.dataset.item);
  });
document.addEventListener('keydown', e => {
  // Esc у модального <dialog> браузер сам превращает в событие cancel —
  // ловит src/63-sheet.js. Ветку Escape тут убрали, чтобы не закрывать дважды.
  // Списки: Enter в поле подзадачи добавляет её
  if (e.key === 'Enter' && e.target && e.target.id && e.target.id.indexOf('listInput-') === 0) {
    e.preventDefault();
    addListSubtask(e.target.id.slice('listInput-'.length), e.target.id);
    return;
  }
  // Списки: Enter в поле правки подзадачи — сохранить
  if (e.key === 'Enter' && e.target && e.target.id && e.target.id.indexOf('subtaskEdit-') === 0 && editingSubtask) {
    e.preventDefault();
    saveSubtaskEdit(editingSubtask.listId, editingSubtask.itemId);
    return;
  }
  // Списки: Enter в поле правки названия списка — сохранить
  if (e.key === 'Enter' && e.target && e.target.id && e.target.id.indexOf('listNameEdit-') === 0 && editingListId) {
    e.preventDefault();
    saveListNameEdit(editingListId);
    return;
  }
  // Лейблы: Enter в поле переименования — сохранить
  if (e.key === 'Enter' && e.target && e.target.id && e.target.id.indexOf('labelNameEdit-') === 0 && editingLabelId) {
    e.preventDefault();
    saveLabelNameEdit(editingLabelId);
    return;
  }
  // Календарь: Enter / пробел на дне — как клик по ячейке
  if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.closest) {
    const day = e.target.closest('[data-day]');
    if (day) {
      e.preventDefault();
      selectedDate = day.dataset.day;
      renderCalendar();
    }
  }
});
