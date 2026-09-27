/* ===== Ось времени: Главная продолжается в прошлое (фаза 5, спека 2.2) =====
   Те же дни, что у «Памяти» (memoryByDay), одной колонкой: световая нить
   слева, точки-дни, липкая метка года. Страницами по TIMELINE_PAGE дней:
   метка [data-axis-more] в конце попадает в экран — дорисовываем следующую
   (IntersectionObserver, как в галерее; ноль обработчиков scroll, спека 3.2).
   Рисуется в контейнер с атрибутом data-axis — ось на Главной (#homeTimeline). */
const TIMELINE_PAGE = 30;
const timelineShown = new Map(); // контейнер → сколько дней уже раскрыто
const timelineSentinel = new Map(); // контейнер → текущий наблюдаемый [data-axis-more] (чтобы не копить наблюдателей)

function timelineYears(days) {
  const out = [];
  for (const d of days) {
    const y = String(d.date).slice(0, 4);
    if (!out.length || out[out.length - 1].year !== y) out.push({ year: y, days: [] });
    out[out.length - 1].days.push(d);
  }
  return out;
}

function memoryDayHtml(day, gid) {
  const dt = parseLocalIso(day.date);
  const label = dt ? dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : day.date;
  const card = [html`<div class="tl-date">${label}</div>`];
  if (day.photos.length) card.push(memoryPhotosHtml(day.photos, 'day' + gid.n++, 'tl-photos'));
  for (const d of day.dates) {
    const info = [d.place, d.time].filter(Boolean).join(' · ');
    card.push(html`<div class="tl-item"><span class="tl-item-emoji">${d.emoji}</span><b>Свидание${info ? html` · ${info}` : ''}</b></div>`);
    if (d.photos && d.photos.length) card.push(memoryPhotosHtml(d.photos, 'dt' + gid.n++, 'tl-item-photos'));
  }
  for (const ev of day.events) {
    card.push(html`<div class="tl-item"><span class="tl-item-emoji">${ev.emoji}</span><b>${ev.title}</b></div>`);
    if (ev.photos.length) card.push(memoryPhotosHtml(ev.photos, 'ev' + gid.n++, 'tl-item-photos'));
  }
  return html`<article class="axis-day"><span class="axis-dot"></span><div class="tl-card">${card}</div></article>`;
}

function renderTimeline(box, more) {
  if (!box) return;
  const days = memoryByDay();
  if (!days.length) {
    // Пустая ось: старая метка [data-axis-more] из прошлого рендера уже не в DOM —
    // отписываем её от observer'а, иначе он копит наблюдателей на удалённых узлах (утечка).
    const prevSentinel = timelineSentinel.get(box);
    if (prevSentinel && timelineObserver) timelineObserver.unobserve(prevSentinel);
    timelineSentinel.delete(box);
    render(box, emptyState('calendar', 'Здесь сложится ваша история: прошедшие события, свидания и фото с датой.', ['Добавить памятную дату', 'event']));
    return;
  }
  // Повторный рендер (живое обновление, возврат на вкладку) не схлопывает
  // уже раскрытую глубину — иначе прокрутка прыгала бы вверх.
  const prev = timelineShown.get(box) || 0;
  const shown = Math.min(days.length, more ? prev + TIMELINE_PAGE : Math.max(prev, TIMELINE_PAGE));
  timelineShown.set(box, shown);
  const gid = { n: 0 };
  render(
    box,
    html`<div class="axis">
      <div class="axis-now"><span class="axis-dot"></span>сейчас</div>
      ${timelineYears(days.slice(0, shown)).map(
        y => html`<section class="axis-year">
          <h3 class="axis-year-label">${y.year}</h3>
          ${y.days.map(d => memoryDayHtml(d, gid))}
        </section>`
      )}
      ${shown < days.length ? html`<div class="axis-more" data-axis-more></div>` : ''}
    </div>`
  );
  hydratePhotoImgs(box);
  box.querySelectorAll('[data-lightbox]').forEach(img => img.addEventListener('click', () => openLightboxFrom(img)));
  // Каждый рендер (в т.ч. живое обновление из Firestore) рисует новую метку
  // [data-axis-more] — старую надо отписать явно, иначе IntersectionObserver
  // копит наблюдателей на уже удалённых из DOM узлах (утечка).
  const prevSentinel = timelineSentinel.get(box);
  if (prevSentinel && timelineObserver) timelineObserver.unobserve(prevSentinel);
  const sentinel = box.querySelectorAll('[data-axis-more]')[0] || null;
  timelineSentinel.set(box, sentinel);
  if (sentinel && timelineObserver) timelineObserver.observe(sentinel);
}

let timelineObserver = null;
if (typeof IntersectionObserver === 'function') {
  timelineObserver = new IntersectionObserver(
    entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        timelineObserver.unobserve(e.target);
        renderTimeline(e.target.closest('[data-axis]'), true);
      }
    },
    { rootMargin: '600px 0px' }
  );
}

// Высота липкой шапки → --header-h: под ней прилипают метки годов. Шапка
// меняет высоту (перенос кнопок на узком десктопе, плашка «нет сети»).
if (typeof ResizeObserver === 'function') {
  const hdr = $('.header');
  if (hdr) new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', hdr.offsetHeight + 'px')).observe(hdr);
}
