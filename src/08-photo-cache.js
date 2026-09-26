// Кэш data-URL для миниатюр
const thumbCache = new Map();
function getThumbUrl(id) {
  return thumbCache.get(id) || null;
}
function setThumbUrl(id, url) {
  thumbCache.set(id, url);
}

// ===== Единый источник URL фото для рендеров =====
// Порядок: кэш → блоб в photoStore. Возвращает data-URL для <img>.
// useThumb=true (сетки/карточки) кэшируется в thumbCache (256px миниатюра);
// useThumb=false (светбокс) — в отдельном fullCache (показ-версия, ~900px).
// Раньше оба случая читали и писали ОДИН и тот же thumbCache независимо от
// useThumb — светбокс просил полный блоб (useThumb=false), но как только
// миниатюра уже была в кэше (а она почти всегда есть — грид её прогревает
// первым), photoUrl() тут же отдавал её и полный блоб не запрашивал вообще.
// Отсюда крошечная картинка в светбоксе и «размыливание» при зуме — на
// экран всегда шли те же 256px, что и в сетке, просто растянутые/увеличенные.
const fullCache = new Map();
async function photoUrl(p, useThumb = true) {
  if (!p) return '';
  const cache = useThumb ? thumbCache : fullCache;
  const cached = cache.get(p.id);
  if (cached) return cached;
  if (photoStore && p.id) {
    try {
      let blob = null;
      // Миниатюра могла не расшифроваться — не бросаем, падаем на полный блоб
      if (useThumb) {
        try {
          blob = await photoStore.getThumb(p.id);
        } catch (e) {}
        // NV-7: фоновая очередь качает миниатюры с задержкой — если эта
        // конкретная ещё не долетела, просим её по требованию.
        if (!blob && (await ensureCloudPart(p.id, 'thumb'))) {
          try {
            blob = await photoStore.getThumb(p.id);
          } catch (e) {}
        }
      }
      if (!blob) blob = await photoStore.getFull(p.id);
      // NV-7: full больше не докачивается фоновой очередью — докачиваем по
      // требованию прямо здесь. Светбокс тем временем уже показывает
      // миниатюру из кэша (см. src/85-lightbox.js, lbRender), пока этот
      // промис в полёте — пользователь не смотрит на пустоту.
      // !useThumb: этот фоллбэк — только для светбокса. В режиме грида
      // (useThumb=true) миниатюра, которую ещё не докачала фоновая очередь,
      // НЕ должна тянуть за собой full-разрешение на маленькую плитку — это
      // именно тот эagerный трафик, ради устранения которого вся эта ветка.
      if (!useThumb && !blob && (await ensureCloudPart(p.id, 'full'))) {
        blob = await photoStore.getFull(p.id);
      }
      if (blob) {
        const url = await blobToDataUrl(blob);
        cache.set(p.id, url);
        return url;
      }
    } catch (e) {}
  }
  return '';
}
// Оригинал (максимальное качество) — только по требованию (зум в светбоксе,
// скачивание), не прогревается заранее: оригиналы могут весить мегабайты,
// незачем тянуть их для каждого открытого фото, если зум не понадобился.
const origCache = new Map();
async function photoOrigUrl(p) {
  if (!p) return '';
  const cached = origCache.get(p.id);
  if (cached) return cached;
  if (photoStore && p.id) {
    try {
      let blob = await photoStore.getOrig(p.id).catch(() => null);
      if (!blob && (await ensureCloudPart(p.id, 'orig'))) {
        blob = await photoStore.getOrig(p.id).catch(() => null);
      }
      if (!blob) blob = await photoStore.getFull(p.id).catch(() => null);
      if (!blob && (await ensureCloudPart(p.id, 'full'))) {
        blob = await photoStore.getFull(p.id).catch(() => null);
      }
      if (blob) {
        const url = await blobToDataUrl(blob);
        origCache.set(p.id, url);
        return url;
      }
    } catch (e) {}
  }
  return '';
}

// Синхронный превью-URL (для мгновенного каркаса): только кэш миниатюр.
// p.data в рендерах больше не используется — фото живёт в photoStore.
function photoSrc(p) {
  if (!p) return '';
  return getThumbUrl(p.id) || '';
}

// Прогрев кэша миниатюр после разблокировки — галерея рендерится мгновенно.
// Если миниатюры нет (старое фото при миграции), берём полный блоб.
// После завершения перерисовывает открытые вьюхи, чтобы подхватить URL из кэша.
async function warmThumbCache() {
  if (!photoStore || !db || !Array.isArray(db.photos)) return;
  for (const p of db.photos) {
    if (!p.id || getThumbUrl(p.id)) continue;
    try {
      let blob = null;
      try {
        blob = await photoStore.getThumb(p.id);
      } catch (e) {}
      if (!blob) blob = await photoStore.getFull(p.id);
      if (blob) {
        const url = await blobToDataUrl(blob);
        setThumbUrl(p.id, url);
      }
    } catch (e) {}
  }
  // Кэш прогрет — обновляем вьюхи, которые могли отрисоваться с пустым кэшем.
  // Раньше тут не было renderWishlist() — если фото докачивалось, пока
  // пользователь уже на вкладке «Хотелки», плейсхолдер (<img data-photo-src>)
  // так и оставался пустым до следующего захода на вкладку: с виду «битая
  // миниатюра», хотя реально просто не перерисовано. renderHome() тянет за
  // собой ось «Памяти» (renderTimeline) — отдельного вызова не нужно.
  if (!authLocked) {
    renderHome();
    renderPhotos();
    renderCalendar();
    if (typeof renderWishlist === 'function') renderWishlist();
  }
}

// Заполняет src у <img data-photo-src="id"> после рендера каркаса.
async function hydratePhotoImgs(scope) {
  if (!scope || !scope.querySelectorAll) return;
  const imgs = [...scope.querySelectorAll('img[data-photo-src]')];
  for (const im of imgs) {
    const id = im.dataset.photoSrc;
    // Фото хотелок не входят в db.photos (не показываются в общей галерее),
    // но живут в том же photoStore под своим id — ищем и там.
    const p = db.photos.find(x => x.id === id) || (Array.isArray(db.wishlist) && db.wishlist.find(w => w.photoId === id) ? { id } : null);
    const url = p ? await photoUrl(p, true) : '';
    if (url) {
      im.src = url;
      im.removeAttribute('data-photo-src'); // URL найден — больше не перечитываем
    }
    // URL не нашёлся (фото ещё качается из облака) — data-photo-src остаётся,
    // следующий hydratePhotoImgs после докачки подхватит его сам.
  }
}
