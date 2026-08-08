/* ===== Фаза B: «В этот день», кольцо отношений, трекер настроения, лента «Память» =====
   Решение 07.08.2026: дата фото для «В этот день» — ТОЛЬКО EXIF (p.takenAt)
   ИЛИ дата события/свидания, к которому фото привязано. Если есть только дата
   загрузки (p.ts) — фото НЕ показывается. В «Памяти» фото, привязанные к
   событию/свиданию, живут только в их карточках (без дублей в сетке дня). */

function isoFromMs(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : iso(d.getFullYear(), d.getMonth(), d.getDate());
}

function photoTitle(p) { return (p && p.title) || 'Фото'; }

// Дата фото для «В этот день»: EXIF-дата снимка, дата события или дата свидания (самое раннее).
// Дата загрузки здесь сознательно НЕ используется.
function photoDate(p) {
  if (!p) return null;
  if (p.takenAt) { const s = isoFromMs(p.takenAt); if (s) return s; }
  let best = null;
  if (Array.isArray(db.events)) {
    for (const ev of db.events) {
      if (!Array.isArray(ev.photos) || !ev.photos.includes(p.id) || !ev.date) continue;
      if (!best || ev.date < best) best = ev.date;
    }
  }
  if (Array.isArray(db.dates)) {
    for (const dt of db.dates) {
      if (!Array.isArray(dt.photos) || !dt.photos.includes(p.id) || !dt.date) continue;
      if (!best || dt.date < best) best = dt.date;
    }
  }
  return best || null;
}

/* ===== «В этот день» ===== */
function onThisDayItems(at) {
  const now = at || new Date();
  const yNow = now.getFullYear();
  const items = [];
  const isThisDay = dt => !!dt && dt.getFullYear() < yNow && dt.getMonth() === now.getMonth() && dt.getDate() === now.getDate();
  for (const ev of db.events) {
    const dt = parseLocalIso(ev.date);
    if (isThisDay(dt)) items.push({ kind: 'event', date: ev.date, emoji: ev.emoji || '💜', title: ev.title });
  }
  // Свидания тоже «в этот день»: чипы рядом с событиями прошлых лет
  for (const dt of db.dates) {
    if (!dt.date) continue;
    const dDate = parseLocalIso(dt.date);
    if (isThisDay(dDate)) items.push({ kind: 'date', date: dt.date, emoji: dt.emoji || '💘', title: dt.place || dt.note || 'Свидание' });
  }
  for (const n of db.notes) {
    if (!n.ts) continue;
    const dt = new Date(n.ts);
    if (isThisDay(dt)) items.push({ kind: 'note', date: isoFromMs(n.ts), text: n.text, author: n.author });
  }
  for (const p of db.photos) {
    const ds = photoDate(p); // только EXIF или событие
    if (ds && isThisDay(parseLocalIso(ds))) items.push({ kind: 'photo', date: ds, p });
  }
  return items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function otdYear(dateStr) {
  const y = String(dateStr || '').slice(0, 4);
  return y ? y + ' год' : '';
}

// Отдельный виджет «В этот день» удалён — он дублировал коллаж «Наша история»:
// фото «в этот день» встают в коллаж (см. 30-home.js), а события прошлых лет
// показываются чипами прямо в блоке «Наша история» (renderProgressRing → .history-otd).

/* ===== Кольцо прогресса до годовщины ===== */
function pluralYears(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'год';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'года';
  return 'лет';
}
function pluralDays(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
  return 'дней';
}
// Универсальные формы: plural(5, 'событие', 'события', 'событий') → «событий»
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
function renderProgressRing(at) {
  const box = $('#progressRing');
  if (!box) return;
  const [sy, sm, sd] = START_DATE.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const now = new Date();
  const cur = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((cur - start) / 86400000);
  let anniv = new Date(start);
  while (anniv.getTime() <= cur.getTime()) anniv.setFullYear(anniv.getFullYear() + 1);
  const prev = new Date(anniv); prev.setFullYear(prev.getFullYear() - 1);
  const total = Math.max(1, Math.round((anniv - prev) / 86400000));
  const elapsed = Math.max(0, Math.round((cur - prev) / 86400000));
  const pct = Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
  const R = 42, CIRC = 2 * Math.PI * R;
  const off = CIRC - (CIRC * pct) / 100;
  const yearsTogether = Math.floor(days / 365.25);
  // Статистика под кольцом — чем заполнена наша история (v7)
  // Хотелки — чип с прогрессом исполненных (полоска + счётчик), кнопка 🎲 — перемес коллажа
  const wishDone = db.wishlist.filter(w => w.done).length;
  const wishTotal = db.wishlist.length;
  const wishPct = wishTotal ? Math.round((wishDone / wishTotal) * 100) : 0;
  const wishLabel = wishTotal ? wishDone + '/' + wishTotal : 'пока пусто';
  const wishTitle = wishTotal ? 'Исполнено ' + wishDone + ' из ' + wishTotal + ' хотелок' : 'Хотелок пока нет — загадай желание 💜';
  const stats = [
    ['📸', db.photos.length, 'фото', 'фото', 'фото'],
    ['📅', db.events.length, 'событие', 'события', 'событий'],
    ['💘', db.dates.length, 'свидание', 'свидания', 'свиданий'],
    ['📝', db.notes.length, 'заметка', 'заметки', 'заметок']
  ].map(a => `<span class="hs-chip">${a[0]} ${a[1]} ${plural(a[1], a[2], a[3], a[4])}</span>`).join('') +
    `<span class="hs-chip hs-wish" title="${wishTitle}">🎁 ${wishLabel}<span class="hs-bar"><i style="width:${wishPct}%"></i></span></span>` +
    `<span class="hs-chip hs-shuffle" id="shuffleHistoryBtn" role="button" tabindex="0" title="Перемешать фото коллажа">🎲 Перемешать</span>`;
  // «В этот день» (только когда есть события/свидания прошлых лет): чипы под кольцом.
  // Фото «в этот день» уже встали в коллаж выше — здесь только события и свидания, без дублей.
  const otdEvents = onThisDayItems(at || new Date()).filter(it => it.kind === 'event' || it.kind === 'date');
  const otdRow = otdEvents.length
    ? '<div class="history-otd"><span class="history-otd-label">✨ В этот день</span>' +
      otdEvents.map(ev =>
        '<span class="hs-chip hs-otd-chip" title="' + esc(ev.title) + ' — ' + otdYear(ev.date) + '">' +
        esc(ev.emoji) + ' ' + esc(ev.title) + ' <small>· ' + esc(String(ev.date).slice(0, 4)) + '</small></span>'
      ).join('') +
      '</div>'
    : '';
  box.innerHTML = `
    <div class="history-main">
      <div class="ring-wrap">
        <svg class="ring-svg" viewBox="0 0 100 100" role="img" aria-label="Прогресс до годовщины: ${pct}%">
          <circle class="ring-bg" cx="50" cy="50" r="${R}"></circle>
          <circle class="ring-fg" cx="50" cy="50" r="${R}" stroke-dasharray="${CIRC}" stroke-dashoffset="${off}"></circle>
        </svg>
        <div class="ring-center"><b>${pct}%</b><small>до годовщины</small></div>
      </div>
      <div class="ring-info">
        <h4>${yearsTogether > 0 ? yearsTogether + ' ' + pluralYears(yearsTogether) + ' вместе' : 'Наша история'}</h4>
        <p>${days} ${pluralDays(days)} вместе</p>
        <small>с ${fmtShort(START_DATE)}</small>
      </div>
      <div class="history-photos">${historyPhotosHtml(at)}</div>
    </div>
    ${otdRow}
    <div class="history-stats">${stats}</div>`;
}

/* ===== Лента «Память»: таймлайн-дерево ===== */
// Группировка по дням: события, прошедшие свидания, фото (только EXIF).
// Заметки, настроения и фото без даты — НЕ попадают в память.
// ВАЖНО: события и свидания попадают в память только если их дата <= сегодня.
// Фото, привязанные к событию/свиданию, показываются только в их карточках —
// в сетку дня они НЕ дублируются.
function memoryByDay() {
  const map = new Map();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = iso(today.getFullYear(), today.getMonth(), today.getDate());
  function ensure(dateStr) {
    if (!map.has(dateStr)) map.set(dateStr, { date: dateStr, events: [], dates: [], photos: [] });
    return map.get(dateStr);
  }
  for (const ev of db.events) {
    if (!ev.date) continue;
    // Событие попадает в память только если его дата уже наступила
    if (ev.date > todayStr) continue;
    const d = ensure(ev.date);
    const evPhotos = (ev.photos || []).map(id => db.photos.find(p => p.id === id)).filter(Boolean);
    d.events.push({ emoji: ev.emoji || '💜', title: ev.title, photos: evPhotos });
  }
  for (const dt of db.dates) {
    // Свидание попадает в память только если оно завершено (done:true) И дата уже наступила
    if (!dt.date || !dt.done) continue;
    if (dt.date > todayStr) continue;
    const d = ensure(dt.date);
    const dtPhotos = (dt.photos || []).map(id => db.photos.find(p => p.id === id)).filter(Boolean);
    d.dates.push({ emoji: dt.emoji || '💘', place: dt.place, time: dt.time, photos: dtPhotos });
  }
  for (const p of db.photos) {
    if (!p.takenAt) continue; // в сетку дня — только фото с реальной датой снимка (EXIF)
    const ds = isoFromMs(p.takenAt);
    if (!ds || ds > todayStr) continue;
    // Фото, привязанные к событию/свиданию, показываются только в их карточках — не дублируем.
    // Учитываем только карточки, которые реально попадут в память: дата <= сегодня,
    // у свиданий — ещё и done:true.
    const attached = db.events.some(ev => !!ev.date && ev.date <= todayStr &&
                       Array.isArray(ev.photos) && ev.photos.includes(p.id)) ||
                     db.dates.some(dt => !!dt.date && dt.date <= todayStr && dt.done &&
                       Array.isArray(dt.photos) && dt.photos.includes(p.id));
    if (attached) continue;
    const d = ensure(ds);
    d.photos.push(p);
  }
  return [...map.values()]
    .filter(d => d.events.length || d.dates.length || d.photos.length)
    .sort((a, b) => b.date.localeCompare(a.date));
}
function renderMemory() {
  const feed = $('#memoryFeed');
  if (!feed) return;
  const days = memoryByDay();
  if (!days.length) {
    feed.innerHTML = '<div class="rem-empty">Пока пусто 💜<br>Добавляйте события и фото — здесь сложится история вашей вселенной.</div>';
    return;
  }
  let html = '<div class="tl"><div class="tl-stem"></div>';
  let side = 0;
  let gid = 0;
  for (const day of days) {
    const dt = parseLocalIso(day.date);
    const label = dt ? dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : day.date;
    const cls = side % 2 === 0 ? 'tl-left' : 'tl-right';
    let card = '<div class="tl-date">' + esc(label) + '</div>';
    if (day.photos.length) {
      card += memoryPhotosHtml(day.photos, 'day' + (gid++), 'tl-photos');
    }
    for (const d of day.dates) {
      const info = [d.place, d.time].filter(Boolean).join(' · ');
      card += '<div class="tl-item"><span class="tl-item-emoji">' + esc(d.emoji) + '</span><b>Свидание' + (info ? ' · ' + esc(info) : '') + '</b></div>';
      if (d.photos && d.photos.length) {
        card += memoryPhotosHtml(d.photos, 'dt' + (gid++), 'tl-item-photos');
      }
    }
    for (const ev of day.events) {
      card += '<div class="tl-item"><span class="tl-item-emoji">' + esc(ev.emoji) + '</span><b>' + esc(ev.title) + '</b></div>';
      if (ev.photos.length) {
        card += memoryPhotosHtml(ev.photos, 'ev' + (gid++), 'tl-item-photos');
      }
    }
    html += '<div class="' + cls + '"><div class="tl-dot"></div><div class="tl-card">' + card + '</div></div>';
    side++;
  }
  html += '</div>';
  feed.innerHTML = html;
  hydratePhotoImgs(feed);
  feed.querySelectorAll('[data-lightbox]').forEach(function (img) {
    img.addEventListener('click', async function () {
      var p = db.photos.find(function (x) { return x.id === img.dataset.lightbox; });
      if (!p) return;
      var url = await photoUrl(p, false);
      if (url) { $('#lightboxImg').src = url; $('#lightbox').hidden = false; }
    });
  });
}

/* ===== Превью фото в «Памяти» ===== */
// Сразу показываем не больше MEMORY_PHOTOS_PREVIEW фото в ряду; остальные —
// скрыты и раскрываются кнопкой «Показать ещё N» (клик ловит делегат ниже).
const MEMORY_PHOTOS_PREVIEW = 3;

function tlPhotoImg(p, extraCls) {
  const cls = extraCls ? ' class="' + extraCls + '"' : '';
  const stl = extraCls ? ' style="display:none"' : '';
  const url = photoSrc(p);
  return url
    ? '<img' + cls + stl + ' src="' + esc(url) + '" alt="" data-lightbox="' + esc(p.id) + '">'
    : '<img' + cls + stl + ' data-photo-src="' + esc(p.id) + '" alt="" data-lightbox="' + esc(p.id) + '">';
}
function memoryPhotosHtml(photos, groupId, rowCls) {
  const shown = photos.slice(0, MEMORY_PHOTOS_PREVIEW);
  const rest = photos.slice(MEMORY_PHOTOS_PREVIEW);
  return '<div class="' + rowCls + '" data-photo-group="' + groupId + '" data-more-count="' + rest.length + '">' +
    shown.map(p => tlPhotoImg(p)).join('') +
    (rest.length
      ? '<button class="tl-more-btn" data-tl-expand="' + groupId + '" title="Показать ещё фото">Показать ещё ' + rest.length + '</button>' +
        rest.map(p => tlPhotoImg(p, 'tl-more-photo')).join('')
      : '') +
    '</div>';
}
// Переключатель «Показать ещё N фото ⇄ Свернуть». Возвращает 'more' | 'less' | null.
function toggleMemoryPhotos(groupId) {
  const row = document.querySelector('[data-photo-group="' + groupId + '"]');
  if (!row) return null;
  const collapse = row.dataset.expanded === '1';
  const hidden = row.querySelectorAll ? row.querySelectorAll('.tl-more-photo') : [];
  const btn = row.querySelectorAll ? row.querySelectorAll('[data-tl-expand]')[0] : null;
  const total = +row.dataset.moreCount || hidden.length;
  if (collapse) {
    row.dataset.expanded = '0';
    for (const el of hidden) el.style.display = 'none';
    if (btn) btn.textContent = 'Показать ещё ' + total;
  } else {
    row.dataset.expanded = '1';
    for (const el of hidden) el.style.display = '';
    if (btn) btn.textContent = 'Свернуть';
  }
  return collapse ? 'less' : 'more';
}
document.addEventListener('click', e => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-tl-expand]') : null;
  if (btn) toggleMemoryPhotos(btn.dataset.tlExpand);
});

