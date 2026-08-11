/* ===== Списки ===== */
function listItemHTML(listId, it) {
  return `<li class="${it.done ? 'done' : ''}" data-item="${esc(it.id)}">
    <button class="check" data-toggle-item="${listId}" data-id="${it.id}" title="Готово">${it.done ? '✅' : '○'}</button>
    <span>${esc(it.text)}</span>
    <button class="mini-x" data-del-item="${listId}" data-id="${it.id}" title="Удалить">✕</button>
  </li>`;
}
// Выполненные подзадачи всегда внизу списка: устойчивая сортировка —
// внутри групп (невыполненные/выполненные) относительный порядок сохраняется.
function sortListItems(items) {
  return [...items].sort((a, b) => Number(!!a.done) - Number(!!b.done));
}
function renderLists() {
  const wrap = $('#listsWrap');
  if (!wrap) return;
  if (!db.lists.length) {
    wrap.innerHTML = '<div class="empty-state rem-empty">Пока нет ни одного списка 🫧<br>Создайте первый — например, «Подарки на 8 марта».</div>';
    return;
  }
  wrap.innerHTML = db.lists.map(list => {
    const active = list.items.filter(i => !i.done).length;
    const items = list.items.length
      ? sortListItems(list.items).map(it => listItemHTML(list.id, it)).join('')
      : '<li class="empty-li">Пока пусто 🫧</li>';
    return `<div class="list-card" data-id="${list.id}">
      <div class="list-head">
        <h3>${esc(list.name)} <small class="list-count">${active} в работе</small></h3>
        <button class="drag-handle list-drag" data-list-drag="${list.id}" title="Перетащить">⠿</button>
      </div>
      <div class="list-add">
        <input type="text" id="listInput-${list.id}" placeholder="Добавить подзадачу…">
        <button class="btn" data-list-add="${list.id}" title="Добавить">＋</button>
      </div>
      <ul class="items" id="listItems-${list.id}">${items}</ul>
      <div class="list-actions">
        <button class="btn btn-danger btn-small" data-list-complete="${list.id}" title="Выполнить все подзадачи и удалить список">✔ Выполнить список</button>
      </div>
    </div>`;
  }).join('');
}
// Точечное обновление подзадач ОДНОГО списка (без перерисовки всех карточек): в DOM
// переезжают только существующие <li> — FLIP-анимация плавно показывает, как
// выполненная подзадача уезжает вниз. Полный renderLists остаётся для структурных
// изменений (создание/удаление списка).
function refreshListCard(listId) {
  const card = [...document.querySelectorAll('.list-card')].find(c => c.dataset.id === listId);
  if (card) {
    const list = db.lists.find(l => l.id === listId);
    if (list) {
      const small = card.querySelector && card.querySelector('h3 small');
      if (small) small.textContent = list.items.filter(i => !i.done).length + ' в работе';
    }
  }
  renderListItems(listId);
}
function renderListItems(listId) {
  const list = db.lists.find(x => x.id === listId);
  const ul = $('#listItems-' + listId);
  if (!list || !ul || !ul.querySelectorAll || typeof document.createElement !== 'function') { renderLists(); return; }
  const before = new Map();
  const oldItems = new Map();
  [...ul.querySelectorAll('li')].forEach(li => {
    if (li.dataset && li.dataset.item) {
      before.set(li, li.getBoundingClientRect());
      oldItems.set(li.dataset.item, li);
    }
  });
  const sorted = sortListItems(list.items);
  const keep = [];
  if (sorted.length) {
    for (const it of sorted) {
      let li = oldItems.get(it.id);
      if (li) {
        li.classList.toggle('done', !!it.done);
        const check = li.querySelector && li.querySelector('.check');
        if (check) check.textContent = it.done ? '✅' : '○';
      } else {
        li = document.createElement('li');
        li.innerHTML = listItemHTML(list.id, it);
        if (li.dataset) li.dataset.item = it.id; // для мини-DOM без парсинга innerHTML
      }
      keep.push(li);
    }
  }
  // убираем узлы, которых больше нет (удалённые подзадачи / пустое состояние)
  [...ul.querySelectorAll('li')].forEach(li => { if (keep.indexOf(li) < 0) li.remove(); });
  // выстраиваем в правильном порядке (appendChild перемещает существующий узел)
  keep.forEach(li => { if (li.remove) li.remove(); ul.appendChild(li); });
  if (!sorted.length) {
    const empty = document.createElement('li');
    empty.classList.add('empty-li');
    empty.textContent = 'Пока пусто 🫧';
    ul.appendChild(empty);
  }
  listFlipAnimate(ul, before);
}
// FLIP: элементы, чьи координаты изменились, «переезжают» через transform (CSS transition)
function listFlipAnimate(scope, before) {
  if (typeof requestAnimationFrame === 'undefined' || !scope || !before || !scope.children) return;
  const moving = [];
  [...scope.children].forEach(el => {
    if (!before.has(el)) return;
    const r1 = before.get(el);
    const r2 = el.getBoundingClientRect();
    const dx = r1.left - r2.left, dy = r1.top - r2.top;
    if (!dx && !dy) return;
    if (!el.style) el.style = {};
    el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    moving.push(el);
  });
  if (!moving.length) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    moving.forEach(el => { el.style.transform = ''; });
  }));
}

// Создать список с произвольным названием; возвращает список или null.
function createList(rawName) {
  const name = String(rawName || '').trim();
  if (!name) return null;
  const list = { id: uid(), name, items: [] };
  db.lists.unshift(list); // новый список — сверху
  save(); renderLists();
  const inp = $('#listNameInput');
  if (inp) inp.value = '';
  return list;
}
function addListSubtask(listId, inputId) {
  const list = db.lists.find(x => x.id === listId);
  if (!list) return false;
  const inp = $('#' + inputId);
  const text = (inp && inp.value ? String(inp.value) : '').trim();
  if (!text) return false;
  list.items.unshift({ id: uid(), text, done: false });
  save(); if (inp) inp.value = '';
  refreshListCard(listId);
  return true;
}
function toggleSubtask(listId, itemId) {
  const list = db.lists.find(x => x.id === listId);
  if (!list) return false;
  const it = list.items.find(x => x.id === itemId);
  if (!it) return false;
  it.done = !it.done;
  list.items = sortListItems(list.items); // выполненные — вниз
  save(); refreshListCard(listId);
  // мини-«поп» галочки у переключённой подзадачи (анимация в CSS)
  const ul = $('#listItems-' + listId);
  const li = ul && ul.querySelector ? ul.querySelector('[data-item="' + itemId + '"]') : null;
  if (li) {
    li.classList.add('just-toggled');
    setTimeout(() => { if (li.classList.remove) li.classList.remove('just-toggled'); }, 400);
  }
  return it.done;
}
function delSubtask(listId, itemId) {
  const list = db.lists.find(x => x.id === listId);
  if (!list) return false;
  list.items = list.items.filter(x => x.id !== itemId);
  save(); refreshListCard(listId);
  return true;
}
// «Выполнить список»: после подтверждения удаляет весь блок вместе с подзадачами.
function completeList(listId) {
  const list = db.lists.find(x => x.id === listId);
  if (!list) return false;
  if (!confirm('Выполнить список «' + list.name + '»? Он будет удалён вместе с подзадачами.')) return false;
  db.lists = db.lists.filter(x => x.id !== listId);
  save(); renderLists();
  return true;
}

// Перетаскивание списков — универсальный Pointer Events-движок (05-dnd.js).
// Порядок — сам массив db.lists. Во время перетаскивания карточки «разъезжаются»
// по-живому (FLIP): видно, куда встанет перетаскиваемая. Отмена (Esc/пропуск
// броска) возвращает исходный порядок.
let dragListId = null; // id карточки, которую сейчас перетаскиваем
uniDragSetup({
  container: $('#listsWrap'),
  itemSel: '.list-card',
  handleSel: '.list-drag',
  idOf: c => c.dataset.id,
  onStart(st) { dragListId = st.id; },
  onDrop(st) {
    db.lists = st.ids.map(id => db.lists.find(l => l.id === id)).filter(Boolean);
    save();
    dragListId = null;
  },
  onCancel() { dragListId = null; }
});

$('#listCreateBtn').addEventListener('click', () => createList($('#listNameInput').value));
$('#listNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') createList($('#listNameInput').value); });

/* ===== Хотелки (общие, но разделены по людям: у каждого свой список) ===== */
let wishPhotoData = null;
function fmtWishDate(ts) {
  try { return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch (e) { return ''; }
}
// «Исполнено другим»: свою хотелку исполнить нельзя — только партнёр.
// Снять отметку может только тот, кто её поставил.
function wishToggleHTML(w) {
  const me = getUser();
  if (w.done) {
    return w.doneBy === me
      ? `<button class="check" data-wish-done="${w.id}" title="Снять отметку">↩️</button>`
      : '';
  }
  if (w.owner === me) return `<span class="wish-hint">Только ${me === 'gosha' ? 'Даша' : 'Гоша'} исполнит 💜</span>`;
  return `<button class="check" data-wish-done="${w.id}" title="Исполнить!">○</button>`;
}
function wishCard(w) {
  const doneBy = w.doneBy ? (w.doneBy === 'gosha' ? 'Гошей' : 'Дашей') : '';
  // Фото хотелки — в photoStore под своим id (не в общей галерее, см. lbPhoto()
  // в 85-lightbox.js). Каркас + асинхронная дозаливка src — как у остальной
  // галереи, кэш миниатюр мог ещё не прогреться.
  const wPhotoSrc = w.photoId ? photoSrc({ id: w.photoId }) : '';
  return `<div class="wish${w.done ? ' done' : ''}">
    ${w.photoId
      ? `<img class="wish-img"${wPhotoSrc ? ' src="' + esc(wPhotoSrc) + '"' : ' data-photo-src="' + esc(w.photoId) + '"'} alt="${esc(w.text)}" data-photo="${esc(w.photoId)}" loading="lazy">`
      : `<div class="wish-img" style="display:grid;place-items:center;font-size:34px">💝</div>`}
    <div class="wish-body">
      <div class="wish-title">${esc(w.text)}</div>
      ${w.done ? `<span class="wish-done-by">💜 Исполнено${doneBy ? ' ' + doneBy : ''}${w.doneAt ? ' · ' + fmtWishDate(w.doneAt) : ''}</span>` : ''}
      ${w.link ? `<a class="wish-link" href="${safeUrl(w.link)}" target="_blank" rel="noopener">🔗 Открыть ссылку</a>` : ''}
      <div class="wish-btns">
        ${wishToggleHTML(w)}
        <button class="mini-x" data-wish-del="${w.id}" title="Удалить">✕</button>
      </div>
    </div>
  </div>`;
}
function renderWishlist() {
  const grid = $('#wishlistGrid');
  if (!grid) return;
  const byOwner = who => [...db.wishlist].filter(w => w.owner === who).sort((a, b) => (a.done - b.done) || (b.ts - a.ts));
  const sec = (who, label, emoji, empty) =>
    `<div class="wish-section"><h4>${esc(emoji)} Хотелки ${label}</h4>
      ${byOwner(who).length ? `<div class="wishlist-grid">${byOwner(who).map(wishCard).join('')}</div>` : `<p class="cal-tip">${empty}</p>`}
    </div>`;
  grid.innerHTML =
    sec('gosha', 'Гоши', '👦', 'Пока пусто. Нажми «Добавить» — мечты должны сбываться ✨') +
    sec('dasha', 'Даши', '👧', 'Пока пусто. Нажми «Добавить» — мечты должны сбываться ✨');
  if (typeof hydratePhotoImgs === 'function') hydratePhotoImgs(grid);
}
function openWishModal() {
  wishPhotoData = null;
  $('#wishText').value = '';
  $('#wishLink').value = '';
  $('#wishPhotoName').textContent = '';
  $('#wishPhoto').value = '';
  $('#wishOverlay').hidden = false;
  $('#wishText').focus();
}
$('#addWishBtn').addEventListener('click', openWishModal);
$('#wishPhoto').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try { wishPhotoData = await readFile(f); $('#wishPhotoName').textContent = '✅ фото готово'; }
  catch (err) { $('#wishPhotoName').textContent = 'не вышло :('; }
});
// Хотелка всегда в список вошедшего — выбора «для кого» нет.
// Фото хотелки — в photoStore (IndexedDB), как и остальные фото, а не сырым
// base64 в самом db (зашифрованный сейф в localStorage, лимит ~5 МБ — при
// нескольких хотелках с фото сохранение могло молча не пройти). В db.photos
// (общую галерею) НЕ попадает — хотелки показывают своё фото только у себя.
async function saveWishFromModal() {
  const text = $('#wishText').value.trim();
  if (!text) { alert('Напиши, что хочешь 💜'); return; }
  const wish = {
    id: uid(), text,
    link: $('#wishLink').value.trim() || '',
    owner: getUser(), done: false, ts: Date.now()
  };
  if (wishPhotoData && photoStore) {
    try {
      const blob = dataUrlToBlob(wishPhotoData);
      if (blob) {
        const photoId = uid();
        let thumb = null;
        try { thumb = await makeThumbBlob(wishPhotoData, 256); } catch (e) {}
        await photoStore.put(photoId, blob, thumb, { type: blob.type || 'image/webp', title: text, size: blob.size });
        wish.photoId = photoId;
      }
    } catch (e) { console.warn('Не удалось сохранить фото хотелки', e); }
  }
  db.wishlist.unshift(wish);
  save(); $('#wishOverlay').hidden = true; renderWishlist();
  if (typeof schedulePhotoSync === 'function') schedulePhotoSync();
}
$('#wishSave').addEventListener('click', saveWishFromModal);

// Отметить свидание «прошло» / снять отметку (кнопка есть на главной и в календаре).
function toggleDateDone(id) {
  const d = db.dates.find(x => x.id === id);
  if (!d) return false;
  d.done = !d.done;
  save(); renderHome(); renderCalendar();
  return d.done;
}

/* ===== Глобальные клики ===== */
function closeOverlay(id) {
  $('#' + id).hidden = true;
  if (id === 'lightbox') lbResetState(); // светбокс закрыт — сбрасываем список и зум
  if (id === 'eventOverlay') editingEventId = null;
}
document.addEventListener('click', e => {
  const userBtn = e.target.closest('[data-user]');
  if (userBtn) { setUser(userBtn.dataset.user); return; }

  const day = e.target.closest('[data-day]');
  if (day) { selectedDate = day.dataset.day; renderCalendar(); return; }

  const delEv = e.target.closest('[data-del-event]');
  if (delEv) {
    if (!confirmDelete('Удалить событие? Это не отменить.')) return;
    db.events = db.events.filter(x => x.id !== delEv.dataset.delEvent); save(); renderCalendar(); renderHome(); return;
  }

  const editEv = e.target.closest('[data-edit-event]');
  if (editEv) { openEventModal(editEv.dataset.editEvent); return; }

  const photoEv = e.target.closest('[data-photo-event]');
  if (photoEv) { addEventPhotoQuick(photoEv.dataset.photoEvent); return; }

  const photoDate = e.target.closest('[data-photo-date]');
  if (photoDate) { addDatePhotoQuick(photoDate.dataset.photoDate); return; }

  const answerDate = e.target.closest('[data-answer-date]');
  if (answerDate) {
    const d = db.dates.find(x => x.id === answerDate.dataset.answerDate);
    if (d) {
      const who = getUser();
      const val = answerDate.dataset.answer;
      d.responses = d.responses || {};
      d.responses[who] = d.responses[who] === val ? null : val;
      if (d.responses.gosha === 'yes' && d.responses.dasha === 'yes') celebrate(); // оба согласились — салют!
      save(); renderHome(); renderCalendar();
    }
    return;
  }
  const doneDate = e.target.closest('[data-done-date]');
  if (doneDate) { toggleDateDone(doneDate.dataset.doneDate); return; }
  const delDate = e.target.closest('[data-del-date]');
  if (delDate) {
    if (!confirmDelete('Удалить свидание? Это не отменить.')) return;
    db.dates = db.dates.filter(x => x.id !== delDate.dataset.delDate); save(); renderHome(); renderCalendar(); return;
  }

  const pinNote = e.target.closest('[data-pin-note]');
  if (pinNote) { togglePinNote(pinNote.dataset.pinNote); return; }
  const delNote = e.target.closest('[data-del-note]');
  if (delNote) { deleteNote(delNote.dataset.delNote); return; }
  const editNote = e.target.closest('[data-edit-note]');
  if (editNote) { startEditNote(editNote.dataset.editNote); return; }
  const saveNoteBtn = e.target.closest('[data-save-note]');
  if (saveNoteBtn) { saveNoteEdit(saveNoteBtn.dataset.saveNote); return; }
  const cancelNoteBtn = e.target.closest('[data-cancel-note]');
  if (cancelNoteBtn) { cancelNoteEdit(); return; }

  const togItem = e.target.closest('[data-toggle-item]');
  if (togItem) { toggleSubtask(togItem.dataset.toggleItem, togItem.dataset.id); return; }
  const delItem = e.target.closest('[data-del-item]');
  if (delItem) { delSubtask(delItem.dataset.delItem, delItem.dataset.id); return; }
  const listAdd = e.target.closest('[data-list-add]');
  if (listAdd) { addListSubtask(listAdd.dataset.listAdd, 'listInput-' + listAdd.dataset.listAdd); return; }
  const listDone = e.target.closest('[data-list-complete]');
  if (listDone) { completeList(listDone.dataset.listComplete); return; }

  const delPhoto = e.target.closest('[data-del-photo]');
  if (delPhoto) { deletePhoto(delPhoto.dataset.delPhoto); return; }
  const pinPhoto = e.target.closest('[data-pin-photo]');
  if (pinPhoto) { const p = db.photos.find(x => x.id === pinPhoto.dataset.pinPhoto); if (p) p.pinned = !p.pinned; save(); renderPhotos(); return; }
  const selPhoto = e.target.closest('[data-sel-photo]');
  if (selPhoto) {
    const id = selPhoto.dataset.selPhoto;
    if (selectedPhotos.has(id)) selectedPhotos.delete(id); else selectedPhotos.add(id);
    renderPhotos(); return;
  }
  const photo = e.target.closest('[data-photo]');
  if (photo) { openLightboxFrom(photo); return; }

  const wishDone = e.target.closest('[data-wish-done]');
  if (wishDone) {
    const w = db.wishlist.find(x => x.id === wishDone.dataset.wishDone);
    if (w) {
      const me = getUser();
      // Исполнить может только партнёр; снять отметку — только исполнивший.
      if (w.owner !== me && (!w.done || w.doneBy === me)) {
        if (w.done) { w.done = false; w.doneBy = null; w.doneAt = null; }
        else { w.done = true; w.doneBy = me; w.doneAt = Date.now(); }
        save();
      }
      renderWishlist();
    }
    return;
  }
  const wishDel = e.target.closest('[data-wish-del]');
  if (wishDel) {
    if (!confirmDelete('Удалить хотелку? Это не отменить.')) return;
    db.wishlist = db.wishlist.filter(x => x.id !== wishDel.dataset.wishDel); save(); renderWishlist(); return;
  }

  const labelOff = e.target.closest('[data-label-off]');
  if (labelOff) { removeLabelFromPhoto(labelOff.dataset.photoOff, labelOff.dataset.labelOff); return; }

  const labelNew = e.target.closest('[data-label-new]');
  if (labelNew) { openLabelOverlay(); return; }
  const labelDel = e.target.closest('[data-label-del]');
  if (labelDel) {
    const name = labelDel.dataset.labelDel;
    if (confirm(`Удалить лейбл «${name}»? Фото не пострадают.`)) deleteLabel(name);
    return;
  }
  const labelChip = e.target.closest('[data-label]');
  if (labelChip) { currentLabel = labelChip.dataset.label; eventFilter = { year: '', month: '', title: '' }; renderPhotos(); return; }

  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) { closeOverlay(closeBtn.dataset.close); return; }
  if (e.target.classList && e.target.classList.contains('overlay')) closeOverlay(e.target.id);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const open = document.querySelector('.overlay:not([hidden])');
    if (open) closeOverlay(open.id);
    return;
  }
  // Списки: Enter в поле подзадачи добавляет её
  if (e.key === 'Enter' && e.target && e.target.id && e.target.id.indexOf('listInput-') === 0) {
    e.preventDefault();
    addListSubtask(e.target.id.slice('listInput-'.length), e.target.id);
    return;
  }
  // Календарь: Enter / пробел на дне — как клик по ячейке
  if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.closest) {
    const day = e.target.closest('[data-day]');
    if (day) { e.preventDefault(); selectedDate = day.dataset.day; renderCalendar(); }
  }
});

