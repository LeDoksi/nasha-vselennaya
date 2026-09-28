/* ===== Хотелки (общие, но разделены по людям: у каждого свой список) ===== */
let wishPhotoData = null;
function fmtWishDate(ts) {
  try {
    return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) {
    return '';
  }
}
// «Исполнено другим»: свою хотелку исполнить нельзя — только партнёр.
// Снять отметку может только тот, кто её поставил.
function wishToggleHTML(w) {
  const me = getUser();
  if (w.done) {
    return w.doneBy === me ? html`<button class="btn btn-ghost btn-sm" data-wish-done="${w.id}" title="Снять отметку">Вернуть</button>` : html``;
  }
  if (w.owner === me) return html`<span class="wish-hint">Исполнить может только ${me === 'gosha' ? 'Даша' : 'Гоша'}</span>`;
  return html`<button class="btn btn-ghost btn-sm" data-wish-done="${w.id}" title="Исполнить!">Исполнить</button>`;
}
function wishCard(w) {
  const doneBy = w.doneBy ? (w.doneBy === 'gosha' ? 'Гошей' : 'Дашей') : '';
  // Фото хотелки — в photoStore под своим id (не в общей галерее, см. lbPhoto()
  // в 85-lightbox.js). Каркас + асинхронная дозаливка src — как у остальной
  // галереи, кэш миниатюр мог ещё не прогреться.
  const wPhotoSrc = w.photoId ? photoSrc({ id: w.photoId }) : '';
  return html`<div class="wish${w.done ? ' done' : ''}">
    ${
      w.photoId
        ? wPhotoSrc
          ? html`<img class="wish-img" src="${wPhotoSrc}" alt="${w.text}" data-photo="${w.photoId}" loading="lazy">`
          : html`<img class="wish-img" data-photo-src="${w.photoId}" alt="${w.text}" data-photo="${w.photoId}" loading="lazy">`
        : html``
    }
    <div class="wish-body">
      <div class="wish-title">${w.text}</div>
      ${w.done ? html`<span class="wish-done-by">Исполнено${doneBy ? ' ' + doneBy : ''}${w.doneAt ? ' · ' + fmtWishDate(w.doneAt) : ''}</span>` : html``}
      ${w.link ? html`<a class="wish-link" href="${safeUrl(w.link)}" target="_blank" rel="noopener">Открыть ссылку ↗</a>` : html``}
      <div class="wish-btns">
        ${wishToggleHTML(w)}
        <button class="mini-x" data-edit-wish="${w.id}" title="Изменить" aria-label="Изменить">${navIconHtml('pencil')}</button>
        <button class="mini-x" data-wish-del="${w.id}" title="Удалить" aria-label="Удалить">${navIconHtml('trash')}</button>
      </div>
    </div>
  </div>`;
}
// Фаза 6: на мобиле секция Гоши шла целиком НАД секцией Даши — чтобы увидеть
// хотелки партнёра, приходилось пролистать все свои (пункт 18 плана). На
// десктопе это не проблема (обе секции всегда видны, короткие в высоту),
// поэтому переключатель — чисто мобильный (см. .wish-tabs в styles.css,
// media query max-width:820px), на десктопе он скрыт и обе секции видны
// как раньше. wishlistTab влияет только на CSS-класс — сама разметка обеих
// секций рендерится всегда, десктопу нечего скрывать. Само состояние
// (`let wishlistTab`) объявлено в 00-core.js, не здесь — прямая ссылка
// #/wishlist триггерит showView('wishlist')→renderWishlist() ещё во время
// начального прохода hash-резолвинга в 20-theme-nav.js, который выполняется
// раньше этого файла в собранном app.js; если бы `let` стоял тут, это была
// бы TDZ-ошибка (тот же класс бага, что и с BOTTOM_PRIMARY/FIREBASE_CONFIG).
function renderWishlist() {
  const grid = $('#wishlistGrid');
  if (!grid) return;
  if (wishlistTab !== 'gosha' && wishlistTab !== 'dasha') wishlistTab = getUser();
  const byOwner = who => [...db.wishlist].filter(w => w.owner === who).sort((a, b) => a.done - b.done || b.ts - a.ts);
  // Пустой текст различает свой список от чужого (по who === getUser()): у
  // своего — приглашение действовать (кнопка «Добавить» рядом, действие в
  // emptyState не нужно), у чужого — нейтральная констатация.
  const sec = who => {
    const empty = who === getUser() ? 'Твой список пуст. Нажми «Добавить» — партнёр увидит, о чём ты мечтаешь.' : 'У ' + (who === 'gosha' ? 'Гоши' : 'Даши') + ' пока нет хотелок.';
    const label = who === 'gosha' ? 'Гоши' : 'Даши';
    return html`<div class="wish-section" data-wish-owner="${who}"><h4>Хотелки ${label}</h4>
      ${byOwner(who).length ? html`<div class="wishlist-grid">${byOwner(who).map(wishCard)}</div>` : emptyState('wishlist', empty)}
    </div>`;
  };
  const tabs = html`<div class="wish-tabs">
      <button type="button" class="wish-tab${wishlistTab === 'gosha' ? ' active' : ''}" data-wish-tab="gosha">Гоша</button>
      <button type="button" class="wish-tab${wishlistTab === 'dasha' ? ' active' : ''}" data-wish-tab="dasha">Даша</button>
    </div>`;
  grid.dataset.activeWish = wishlistTab;
  render(grid, html`${tabs}${sec('gosha')}${sec('dasha')}`);
  if (typeof hydratePhotoImgs === 'function') hydratePhotoImgs(grid);
}
let editingWishId = null;
// id — только настоящая строка (клик по «＋ Добавить» передаёт MouseEvent).
function openWishModal(id) {
  editingWishId = typeof id === 'string' ? id : null;
  const wish = editingWishId ? db.wishlist.find(x => x.id === editingWishId) : null;
  const title = $('#wishModalTitle');
  if (title) title.textContent = wish ? 'Изменить хотелку' : 'Хотелка';
  wishPhotoData = null; // новое фото выбирается заново; старое (wish.photoId) остаётся, если не тронуть выбор
  $('#wishText').value = wish ? wish.text : '';
  $('#wishLink').value = wish ? wish.link || '' : '';
  $('#wishPhotoName').textContent = wish && wish.photoId ? 'Фото уже есть — выбери новое, чтобы заменить' : '';
  $('#wishPhoto').value = '';
  openOverlay('wishOverlay');
  $('#wishText').focus();
}
$('#addWishBtn').addEventListener('click', () => openWishModal());
$('#wishPhoto').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    wishPhotoData = await readFile(f);
    $('#wishPhotoName').textContent = 'Фото готово';
  } catch (err) {
    $('#wishPhotoName').textContent = 'не вышло :(';
  }
});
// Хотелка всегда в список вошедшего — выбора «для кого» нет.
// Фото хотелки — в photoStore (IndexedDB), как и остальные фото, а не сырым
// base64 в самом db (зашифрованный сейф в localStorage, лимит ~5 МБ — при
// нескольких хотелках с фото сохранение могло молча не пройти). В db.photos
// (общую галерею) НЕ попадает — хотелки показывают своё фото только у себя.
async function saveWishFromModal() {
  const text = $('#wishText').value.trim();
  if (!text) {
    alert('Напиши, что хочешь');
    return;
  }
  let photoId = null;
  if (wishPhotoData && photoStore) {
    try {
      const blob = dataUrlToBlob(wishPhotoData);
      if (blob) {
        photoId = uid();
        let thumb = null;
        try {
          thumb = await makeThumbBlob(wishPhotoData, 256);
        } catch (e) {}
        await photoStore.put(photoId, blob, thumb, { type: blob.type || 'image/webp', title: text, size: blob.size });
      }
    } catch (e) {
      console.warn('Не удалось сохранить фото хотелки', e);
    }
  }
  const existing = editingWishId ? db.wishlist.find(x => x.id === editingWishId) : null;
  let wish;
  if (existing) {
    // Владелец/статус «исполнено» правка не трогает — только текст/ссылку/фото.
    existing.text = text;
    existing.link = $('#wishLink').value.trim() || '';
    if (photoId) existing.photoId = photoId; // новое фото выбрано — заменяем; иначе старое остаётся
    editingWishId = null;
    wish = existing;
  } else {
    wish = { id: uid(), text, link: $('#wishLink').value.trim() || '', owner: getUser(), done: false, ts: Date.now() };
    if (photoId) wish.photoId = photoId;
    db.wishlist.unshift(wish);
  }
  // коллекция в базе называется wishes, массив в памяти — db.wishlist (расхождение осознанное)
  repoSet('wishes', wish);
  closeOverlay('wishOverlay');
  renderWishlist();
  if (typeof schedulePhotoSync === 'function') schedulePhotoSync();
}
$('#wishSave').addEventListener('click', saveWishFromModal);

// Отметить свидание «прошло» / снять отметку (кнопка есть на главной и в календаре).
function toggleDateDone(id) {
  const d = db.dates.find(x => x.id === id);
  if (!d) return false;
  d.done = !d.done;
  repoSet('dates', d); // меняется само свидание, не список/хотелка — коллекция dates
  renderHome();
  renderCalendar();
  return d.done;
}
