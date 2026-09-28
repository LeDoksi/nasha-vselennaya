// Дебаунс: несколько вызовов renderPhotos() в одном кадре схлопываются в один
// рендер (requestAnimationFrame). Без rAF (песочница тестов) — рендер синхронный.
let photosRenderQueued = false;
function renderPhotos() {
  if (photosRenderQueued) return 'coalesced';
  photosRenderQueued = true;
  if (typeof requestAnimationFrame === 'function') {
    let done = false;
    const flush = () => {
      if (done) return;
      done = true;
      photosRenderQueued = false;
      renderPhotosNow();
    };
    requestAnimationFrame(flush);
    if (typeof setTimeout === 'function') setTimeout(flush, 120); // вкладка в фоне: rAF спит
  } else {
    photosRenderQueued = false;
    renderPhotosNow();
  }
  // Догрузку страницы НЕ вешаем сюда: renderPhotos() вызывается практически
  // на любое действие в галерее (лейбл, закрепление, переименование,
  // удаление, реордер, просто открытие вкладки) — если досылать следующую
  // страницу из конца рендера, любое непричастное действие вычерпывало бы
  // всю коллекцию по странице за раз, рекурсивно, пока не кончится курсор.
  // Дозагрузка привязана к видимости метки-сентинела в конце сетки — см.
  // photosObserver и #photosSentinel в renderPhotosNow() ниже.
}
function renderPhotosNow() {
  const grid = $('#photosGrid');
  if (!grid) return;
  renderLabels();
  // витрина «📅 События»: фильтр кнопками «год → месяц → событие»
  renderEventBar();
  const list = filteredPhotos();
  const hint = $('#dragHint');
  if (hint) {
    if (photoReorderMode) {
      hint.textContent = 'Перетаскивай фото за ⠿, чтобы поменять порядок.';
      hint.style.display = list.length > 1 ? 'block' : 'none';
    } else if (photoSelectMode) {
      hint.textContent = 'Нажимай на фото, чтобы выбрать несколько. Долгое нажатие включает выбор из любого места.';
      hint.style.display = list.length ? 'block' : 'none';
    } else hint.style.display = 'none';
  }
  const selectBtn = $('#photoSelectModeBtn');
  if (selectBtn) {
    selectBtn.textContent = photoSelectMode ? '✓ Готово' : 'Выбрать';
    selectBtn.classList.toggle('active', photoSelectMode);
  }
  const reorderBtn = $('#photoReorderModeBtn');
  if (reorderBtn) {
    reorderBtn.textContent = photoReorderMode ? '✓ Готово' : 'Порядок';
    reorderBtn.classList.toggle('active', photoReorderMode);
  }
  const selBar = $('#photoSelBar');
  if (selBar) {
    selBar.style.display = selectedPhotos.size ? 'flex' : 'none';
    if (selectedPhotos.size) {
      const c = $('#selCount');
      if (c) c.textContent = selectedPhotos.size;
      // Подпись отражает, что реально произойдёт: если уже закреплены ВСЕ
      // выбранные — кнопка снимет закрепление со всех, иначе закрепит все.
      const pinBtn = $('#selPinBtn');
      if (pinBtn) {
        const targets = db.photos.filter(p => selectedPhotos.has(p.id));
        const allPinned = targets.length > 0 && targets.every(p => p.pinned);
        pinBtn.textContent = allPinned ? 'Открепить' : 'Закрепить';
      }
    }
  }
  // Двойная плитка (спека 2.4): закреплённые и «в этот день». В режиме порядка —
  // все одинаковые: dense-сетка переставляет плитки визуально, а SortableJS
  // двигает DOM — при разных размерах палец и плитка разъезжались бы.
  const bigIds = photoReorderMode
    ? new Set()
    : new Set(
        onThisDayItems()
          .filter(it => it.kind === 'photo')
          .map(it => it.p.id)
      );
  const cards = list.length
    ? list.map(p => {
        // Кэш миниатюр может быть ещё не прогрет — рисуем каркас и заполняем src
        // асинхронно (как в «Памяти» и на «Главной»), чтобы миниатюры появлялись сами.
        const url = photoSrc(p);
        return html`
    <div class="photo${p.pinned ? ' pinned' : ''}${!photoReorderMode && (p.pinned || bigIds.has(p.id)) ? ' photo--big' : ''}${selectedPhotos.has(p.id) ? ' selected' : ''}${freshPhotoIds.has(p.id) ? ' photo--fresh' : ''}" data-id="${p.id}">
      <img${url ? html` src="${url}"` : html` data-photo-src="${p.id}"`} alt="${p.title}" data-photo="${p.id}" loading="lazy" tabindex="0" role="button"${p.title ? '' : raw(' aria-label="Фото"')}>
      ${
        photoSelectMode
          ? html`<button class="sel-photo${selectedPhotos.has(p.id) ? ' active' : ''}" data-sel-photo="${p.id}" title="${selectedPhotos.has(p.id) ? 'Снять выбор' : 'Выбрать'}">${selectedPhotos.has(p.id) ? '✓' : '○'}</button>`
          : ''
      }
      ${photoReorderMode ? html`<button class="drag-handle photo-drag" data-photo-drag="${p.id}" title="Перетащить">⠿</button>` : ''}
      ${
        (p.labels || []).length
          ? html`<div class="photo-labels">${p.labels.map(id => {
              const sys = id === EVENT_LABEL || id === DATE_LABEL;
              const tag = sys ? null : labelById(id);
              if (!sys && !tag) return ''; // ссылка на удалённый лейбл — не рисуем
              const name = sys ? id : tag.name;
              return html`<span class="photo-label">${sys ? '' : html`<span class="label-dot" style="background:${tag.color}"></span>`}${name}</span>`;
            })}</div>`
          : ''
      }
      ${currentLabel === EVENT_LABEL && p.title ? html`<span class="photo-caption">${eventFilter.title || p.title}</span>` : ''}
    </div>`;
      })
    : currentLabel
      ? emptyState('photos', photosFilterEmptyText()) // пусто под фильтром — загрузка тут не поможет (M1)
      : emptyState('photos', 'Здесь будут ваши фото. Они хранятся зашифрованными и видны вам обоим.', ['Загрузить фото', 'photo']);
  // Невидимая метка в конце сетки — на неё наводится photosObserver ниже,
  // чтобы знать, когда догружать следующую страницу. grid-column:1/-1 и
  // высота 1px — иначе в CSS grid (photos-grid) это была бы лишняя пустая
  // плитка на всю ширину колонки.
  // Пока есть следующая страница — в конце сетки скелетон-плитки (класс
  // photo-sk, не photo: обработчики галереи ищут .photo[data-id]).
  const skeleton = photosCursor && list.length ? html`${[0, 1, 2].map(() => html`<div class="photo-sk sk" aria-hidden="true"></div>`)}` : '';
  render(grid, html`${cards}${skeleton}<div id="photosSentinel" aria-hidden="true" style="grid-column:1/-1;height:1px"></div>`);
  hydratePhotoImgs(grid); // миниатюры из photoStore — заполняем src после рендера каркаса
  freshPhotoIds.clear();
  // render() каждый раз пересоздаёт разметку целиком — старая метка
  // уничтожена вместе с ней, новую нужно заново отдать тому же наблюдателю.
  if (photosObserver) {
    photosObserver.disconnect();
    const sentinel = $('#photosSentinel');
    if (sentinel) photosObserver.observe(sentinel);
  }
}
// Дозагрузка страниц галереи по видимости метки #photosSentinel (конец сетки),
// а не по событию scroll: если первая страница (60 фото) и так умещается в
// экран — широкий монитор, планшет лёжа, редкая сетка миниатюр — скроллбар
// не появляется, scroll не всплывает ни разу, и загрузка следующих страниц
// намертво зависает. IntersectionObserver же срабатывает и в этом случае
// (метка сразу видна), и при прокрутке, и при ресайзе — не нужно гадать,
// из-за чего метка попала в поле зрения. Держим один наблюдатель на всё
// время жизни скрипта (не пересоздаём на каждый рендер) — только переводим
// его на новую метку после renderPhotosNow(), см. выше. photosLoadingMore
// защищает от повторного запроса, если срабатываний несколько подряд.
// IntersectionObserver есть не везде (песочница тестов, старые окружения) —
// тогда наблюдатель просто не создаётся, а пагинация (loadMorePhotos)
// тестируется напрямую.
function photosFilterEmptyText() {
  if (currentLabel === EVENT_LABEL) return 'Для этого события фото пока нет.';
  if (currentLabel === DATE_LABEL) return 'Со свиданий фото пока нет.';
  const l = labelById(currentLabel);
  return l ? 'С лейблом «' + l.name + '» фото пока нет.' : 'С этим лейблом фото пока нет.';
}
// Именованная, а не инлайн — тест дёргает её напрямую (в песочнице нет IO).
function onPhotosSentinel(entries) {
  if (!entries.some(e => e.isIntersecting)) return;
  // Без проверки db.photos.length: пустой горячий набор из офлайн-кэша оставляет
  // курсор «с начала» (K6b), и метка должна дочитать галерею с сетью.
  if (activeView !== 'photos' || !photosCursor) return;
  loadMorePhotos()
    .then(added => {
      // Пустая последняя страница тоже перерисовывает: курсор стал null —
      // скелетон-плитки в конце сетки должны уйти (K1).
      if (added || !photosCursor) renderPhotos();
    })
    .catch(() => notify('Не удалось догрузить фото. Проверь интернет — продолжу, когда прокрутишь ещё раз.', true));
}
let photosObserver = null;
if (typeof IntersectionObserver === 'function') photosObserver = new IntersectionObserver(onPhotosSentinel);
// Витрина «📅 События»: кнопки «год → месяц → событие» появляются по мере выбора
function eventPhotosCount(year, month, title) {
  let n = 0;
  for (const p of db.photos) {
    if (!(p.labels || []).includes(EVENT_LABEL)) continue;
    if (eventsForPhoto(p).some(e => (!year || e.year === year) && (!month || e.month === month) && (!title || e.title === title))) n++;
  }
  return n;
}
function renderEventBar() {
  const evBar = $('#eventBar');
  if (!evBar) return;
  const show = currentLabel === EVENT_LABEL;
  evBar.style.display = show ? 'flex' : 'none';
  if (!show) return;
  const f = eventFilter;
  // события, у которых есть фото в галерее (ev.photos хранит id фото)
  const photoIds = new Set(db.photos.map(p => p.id));
  const evs = db.events.filter(ev => Array.isArray(ev.photos) && ev.photos.some(d => photoIds.has(d)));
  const years = [...new Set(evs.map(e => (e.date || '').slice(0, 4)).filter(Boolean))].sort((a, b) => b - a);
  const monthsOf = year =>
    [
      ...new Set(
        evs
          .filter(e => (e.date || '').slice(0, 4) === year)
          .map(e => (e.date || '').slice(5, 7))
          .filter(Boolean)
      )
    ].sort();
  const titlesOf = (year, month) => {
    const set = new Set();
    for (const e of evs) {
      const [y, m] = (e.date || '').split('-');
      if ((!year || y === year) && (!month || m === month)) set.add(e.title);
    }
    return [...set].sort();
  };
  const yearsEl = $('#eventYears');
  if (yearsEl) {
    yearsEl.style.display = years.length ? 'flex' : 'none';
    render(yearsEl, html`${years.map(y => html`<button class="ev-btn${f.year === y ? ' active' : ''}" data-ev-year="${y}">${y} <span class="cnt">${eventPhotosCount(y, '', '')}</span></button>`)}`);
  }
  const monthsEl = $('#eventMonths');
  if (monthsEl) {
    const months = f.year ? monthsOf(f.year) : [];
    monthsEl.style.display = months.length ? 'flex' : 'none';
    render(
      monthsEl,
      html`${months.map(m => html`<button class="ev-btn${f.month === m ? ' active' : ''}" data-ev-month="${m}">${MONTHS[Number(m) - 1]} <span class="cnt">${eventPhotosCount(f.year, m, '')}</span></button>`)}`
    );
  }
  const titlesEl = $('#eventTitles');
  if (titlesEl) {
    const titles = f.month ? titlesOf(f.year, f.month) : [];
    titlesEl.style.display = titles.length ? 'flex' : 'none';
    render(
      titlesEl,
      html`${titles.map(t => html`<button class="ev-btn${f.title === t ? ' active' : ''}" data-ev-title="${t}">${t} <span class="cnt">${eventPhotosCount(f.year, f.month, t)}</span></button>`)}`
    );
  }
  const reset = $('#eventReset');
  if (reset) reset.style.display = f.year || f.month || f.title ? 'inline-block' : 'none';
}
// Долгое нажатие (Task 9): таймер на pointerdown по фото, сдвиг пальца > 10 px
// или отпускание — отмена. Слушатели — один раз на сетке (плитки пересоздаются).
const photosGridEl = $('#photosGrid');
if (photosGridEl && photosGridEl.addEventListener) {
  let pressTimer = null,
    pressX = 0,
    pressY = 0;
  const cancelPress = () => {
    clearTimeout(pressTimer);
    pressTimer = null;
  };
  photosGridEl.addEventListener('pointerdown', e => {
    // photoLongPressed гасится глобально (см. document pointerdown, capture,
    // в 62-global-clicks.js) — раньше, чем сработает этот обработчик.
    const img = e.target.closest && e.target.closest('[data-photo]');
    if (!img || photoReorderMode || e.button > 0) return;
    pressX = e.clientX;
    pressY = e.clientY;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      photoLongPress(img.dataset.photo);
      if (navigator.vibrate) navigator.vibrate(10);
    }, LONG_PRESS_MS);
  });
  photosGridEl.addEventListener('pointermove', e => {
    if (pressTimer && Math.hypot(e.clientX - pressX, e.clientY - pressY) > 10) cancelPress();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => photosGridEl.addEventListener(t, cancelPress));
  // Клавиатура (ревью раунд 1, дополняет NV-119): Enter/Space на плитке — как
  // клик по ней. Делегат на сетке, а не на каждой картинке — плитки
  // пересоздаются при каждом рендере. Повторяет логику document-делегата
  // клика (62-global-clicks.js) для [data-photo], без ветки photoLongPressed
  // (клавиатура долгих нажатий не знает): в режиме выбора — тоггл выбора, в
  // режиме перетаскивания — ничего (там место действия — ручка ⠿, не сама
  // плитка), иначе — лайтбокс.
  photosGridEl.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const img = e.target.closest && e.target.closest('[data-photo]');
    if (!img) return;
    e.preventDefault();
    if (photoReorderMode) return;
    if (photoSelectMode) {
      const id = img.dataset.photo;
      if (selectedPhotos.has(id)) selectedPhotos.delete(id);
      else selectedPhotos.add(id);
      renderPhotos();
      return;
    }
    openLightboxFrom(img);
  });
  photosGridEl.addEventListener('contextmenu', e => {
    // Android 12+ Chrome: системный таймаут долгого нажатия (400мс) короче
    // LONG_PRESS_MS (450) — contextmenu приходит раньше, чем наш таймер
    // сработает и выставит photoLongPressed. Если таймер ещё висит — это
    // тоже долгое нажатие, просто наш засёк его позже системы; включаем
    // режим выбора прямо тут и глушим системное меню картинки.
    const img = pressTimer && e.target.closest && e.target.closest('[data-photo]');
    if (img) {
      cancelPress();
      photoLongPress(img.dataset.photo);
    }
    if (photoLongPressed) e.preventDefault(); // системное меню картинки после долгого нажатия
  });
}
