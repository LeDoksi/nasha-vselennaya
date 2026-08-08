/* ===== Светбокс 2.0: стрелки, свайп, зум, счётчик =====
   Единая точка открытия фото: по id из галереи/календаря/«Памяти» или по
   data-URL напрямую (хотелки). Стрелки ‹ ›, свайп и клавиши ←/→ листают;
   зум — кнопка 🔍, двойной клик, щипок, клавиши +/-/0; счётчик «N / M». */
let lightboxList = [];   // источники: id фото из db.photos ИЛИ data-URL
let lightboxIdx = 0;
let lightboxZoom = 1;

function lbIsDataUrl(src) { return typeof src === 'string' && src.indexOf('data:') === 0; }
function lbPhoto(src) { return Array.isArray(db.photos) ? db.photos.find(p => p.id === src) || null : null; }

function openLightbox(ids, idx) {
  lightboxList = Array.isArray(ids) ? ids.slice() : [];
  lightboxIdx = Math.max(0, Math.min(idx || 0, lightboxList.length ? lightboxList.length - 1 : 0));
  lightboxZoom = 1;
  const lb = $('#lightbox');
  if (lb) lb.hidden = false;
  lbRender();
}
// Открытие по клику: листаем среди всех кликабельных фото текущей группы/вкладки
function openLightboxFrom(el) {
  if (!el || !el.closest) return;
  const scope = el.closest('[data-photo-group]') || el.closest('.view') || document.body;
  const els = scope.querySelectorAll ? [...scope.querySelectorAll('[data-photo], [data-lightbox]')] : [];
  const src = el.dataset.lightbox || el.dataset.photo;
  const list = els.map(x => x.dataset.lightbox || x.dataset.photo);
  let at = list.indexOf(src);
  if (at < 0) at = 0;
  openLightbox(list, at);
}
function lbResetState() { lightboxList = []; lightboxIdx = 0; lightboxZoom = 1; }
function lbClose() {
  const lb = $('#lightbox');
  if (lb) lb.hidden = true;
  lbResetState();
}
function lbNav(dir) {
  if (!lightboxList.length) return;
  lightboxIdx = (lightboxIdx + dir + lightboxList.length) % lightboxList.length;
  lightboxZoom = 1; // новое фото — без зума
  lbRender();
}
function lbZoomTo(v) { lightboxZoom = Math.min(4, Math.max(1, v)); lbRender(); }
function lbZoomToggle() { lbZoomTo(lightboxZoom > 1 ? 1 : 2.5); }

function lbRender() {
  const img = $('#lightboxImg');
  const counter = $('#lbCounter');
  const prev = $('#lbPrev');
  const next = $('#lbNext');
  const src = lightboxList[lightboxIdx];
  const multi = lightboxList.length > 1;
  if (prev) prev.style.display = multi ? '' : 'none';
  if (next) next.style.display = multi ? '' : 'none';
  if (counter) counter.textContent = multi ? (lightboxIdx + 1) + ' / ' + lightboxList.length : '';
  if (!src) { if (img) img.src = ''; return; }
  if (img) {
    img.style.transform = 'scale(' + lightboxZoom + ')';
    img.style.cursor = lightboxZoom > 1 ? 'zoom-out' : 'zoom-in';
  }
  if (lbIsDataUrl(src)) { if (img) img.src = src; return; }
  const p = lbPhoto(src);
  if (!p) { if (img) img.src = ''; return; }
  const cached = photoSrc(p); // миниатюра из кэша — мгновенный показ
  if (cached && img) img.src = cached;
  photoUrl(p, false).then(url => {
    if (url && img && lightboxList[lightboxIdx] === src && img.src !== url) img.src = url;
  });
}

/* ===== События светбокса ===== */
const lbPrevBtn = $('#lbPrev');
if (lbPrevBtn) lbPrevBtn.addEventListener('click', () => lbNav(-1));
const lbNextBtn = $('#lbNext');
if (lbNextBtn) lbNextBtn.addEventListener('click', () => lbNav(1));
const lbZoomBtn = $('#lbZoomBtn');
if (lbZoomBtn) lbZoomBtn.addEventListener('click', () => lbZoomToggle());
const lbImg = $('#lightboxImg');
if (lbImg) lbImg.addEventListener('dblclick', () => lbZoomToggle());
if (typeof document !== 'undefined' && document.addEventListener) {
  // Клавиатура: ←/→ листают, +/−/0 зум, Esc закрывает (обработчик Esc — в 60-lists-wishes)
  document.addEventListener('keydown', e => {
    const lb = $('#lightbox');
    if (!lb || lb.hidden) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); lbNav(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); lbNav(1); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); lbZoomTo(lightboxZoom + 0.5); }
    else if (e.key === '-') { e.preventDefault(); lbZoomTo(lightboxZoom - 0.5); }
    else if (e.key === '0') { e.preventDefault(); lbZoomTo(1); }
  });
}
// Свайп (горизонтальный — листание) и щипок (пинч — зум)
let lbTouchX = null;
let lbTouchY = null;
let lbPinch = null;
function lbTouchDist(e) {
  const t = e.touches;
  const dx = t[0].clientX - t[1].clientX;
  const dy = t[0].clientY - t[1].clientY;
  return Math.sqrt(dx * dx + dy * dy) || 1;
}
const lbStage = $('#lbStage');
if (lbStage) {
  lbStage.addEventListener('touchstart', e => {
    if (!e.touches) return;
    if (e.touches.length === 1) { lbTouchX = e.touches[0].clientX; lbTouchY = e.touches[0].clientY; }
    else if (e.touches.length === 2) { lbPinch = { d: lbTouchDist(e), s: lightboxZoom }; lbTouchX = null; }
  }, { passive: true });
  lbStage.addEventListener('touchmove', e => {
    if (e.touches && e.touches.length === 2 && lbPinch) {
      e.preventDefault(); // без этого браузер листает страницу
      lbZoomTo(lbPinch.s * (lbTouchDist(e) / lbPinch.d));
    }
  }, { passive: false });
  lbStage.addEventListener('touchend', e => {
    if (lbTouchX != null && e.changedTouches && e.changedTouches[0]) {
      const dx = e.changedTouches[0].clientX - lbTouchX;
      const dy = e.changedTouches[0].clientY - lbTouchY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) lbNav(dx < 0 ? 1 : -1);
    }
    lbTouchX = null;
    lbPinch = null;
  });
}
