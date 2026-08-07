/* ===== Календарь ===== */
let calY = new Date().getFullYear(), calM = new Date().getMonth(), selectedDate = null;
let editingEventId = null;
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTHS_SHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
function fmtShort(s) { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return `${d} ${MONTHS_SHORT[m - 1]}`; }

function iso(y, m, d) { return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
// Парсим 'YYYY-MM-DD' как локальную дату: без 'T00:00:00' браузер трактует строку
// как UTC-полночь, и в часовых поясах западнее UTC дата «съезжает» на день назад.
function parseLocalIso(s) {
  const [y, m, d] = String(s || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return isNaN(dt) ? null : dt;
}
function eventsOn(dateStr, m, d) {
  return db.events.filter(ev => {
    if (ev.repeat) {
      const [ey, em, ed] = ev.date.split('-').map(Number);
      return (em - 1 === m && ed === d);
    }
    // длительное событие: endDate >= date — попадает на каждый день промежутка
    if (ev.endDate && ev.endDate >= ev.date) return dateStr >= ev.date && dateStr <= ev.endDate;
    return ev.date === dateStr;
  });
}
function renderCalendar() {
  fillCalJump();
  const firstDow = (new Date(calY, calM, 1).getDay() + 6) % 7; // понедельник = 0
  const dim = new Date(calY, calM + 1, 0).getDate();
  const today = new Date();

  let html = '<div class="cal-row cal-head-row">' +
    ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => `<div class="cal-cell cal-dow">${d}</div>`).join('') + '</div>';
  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += '<div class="cal-cell cal-empty"></div>';
  for (let d = 1; d <= dim; d++) {
    const ds = iso(calY, calM, d);
    const evs = eventsOn(ds, calM, d);
    const dts = datesOn(ds);
    const isToday = today.getFullYear() === calY && today.getMonth() === calM && today.getDate() === d;
    const inSpan = db.events.some(ev => !ev.repeat && ev.endDate && ev.endDate >= ev.date && ds >= ev.date && ds <= ev.endDate);
    cells += `<div class="cal-cell${isToday ? ' today' : ''}${selectedDate === ds ? ' selected' : ''}${inSpan ? ' in-span' : ''}${dts.length ? ' has-date' : ''}" data-day="${ds}" role="button" tabindex="0">` +
      `<span class="cal-num">${d}</span>` +
      evs.slice(0, 2).map(e => `<span class="cal-dot" title="${esc(e.title)}">${esc(e.emoji)} ${esc(e.title)}</span>`).join('') +
      (evs.length > 2 ? `<span class="cal-dot cal-dot-more" title="Ещё ${evs.length - 2} события">+${evs.length - 2}</span>` : '') +
      (dts.length ? `<span class="cal-dot date-dot" title="Свидание">${esc(dts[0].emoji || '💘')}</span>` : '') +
      '</div>';
  }
  $('#calendar').innerHTML = html + `<div class="cal-row">${cells}</div>`;
  renderDayPanel();
}
function renderDayPanel() {
  const panel = $('#dayPanel');
  if (!selectedDate) {
    panel.innerHTML = '<p class="cal-tip">👆 Нажми на день в календаре, чтобы посмотреть события или добавить новое.</p>';
    return;
  }
  const [y, m, d] = selectedDate.split('-').map(Number);
  const evs = eventsOn(selectedDate, m - 1, d);
  const dts = datesOn(selectedDate);
  const fmtDate = `${d} ${MONTHS[m - 1].toLowerCase()} ${y}`;
  panel.innerHTML =
    `<div class="day-head"><b>${fmtDate}</b></div>` +
    (evs.length
      ? evs.map(e => `<div class="day-event">${esc(e.emoji)} <span>${esc(e.title)}${e.endDate && e.endDate >= e.date ? ` <small class="ev-range">до ${fmtShort(e.endDate)}</small>` : ''}</span>${evThumbs(e)} <button class="mini-x" data-photo-event="${e.id}" title="Добавить фото">📷</button> <button class="mini-x" data-edit-event="${e.id}" title="Изменить">✏️</button> <button class="mini-x" data-del-event="${e.id}" title="Удалить">✕</button></div>`).join('')
      : '<p class="cal-tip">В этот день событий пока нет.</p>') +
    (dts.length
      ? `<div class="day-sub">💘 Свидания</div>` + dts.map(dt =>
          `<div class="day-event date-evt">${esc(dt.emoji || '💘')} <span>${dt.time ? '🕐 ' + esc(dt.time) + ' · ' : ''}${esc(dt.place || dt.note || 'Свидание')}</span> <button class="mini-x" data-del-date="${dt.id}" title="Удалить">✕</button></div>`).join('')
      : '') +
    `<div class="day-add">
       <input type="text" id="dayTitle" placeholder="Название события">
       <input type="text" id="dayEmoji" value="💜" maxlength="4">
       <button class="btn" id="dayAdd">＋ Добавить</button>
     </div>`;
  const addBtn = $('#dayAdd');
  if (addBtn) addBtn.addEventListener('click', addDayEvent);
  const inp = $('#dayTitle');
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') addDayEvent(); });
}
function addDayEvent() {
  const title = $('#dayTitle').value.trim();
  if (!title) return;
  db.events.push({ id: uid(), title, date: selectedDate, emoji: $('#dayEmoji').value.trim() || '💜', repeat: true });
  save(); renderCalendar(); renderHome();
}
function hideJumpInfo() { const info = $('#jumpInfo'); if (info) info.hidden = true; }
$('#calPrev').addEventListener('click', () => { calM--; if (calM < 0) { calM = 11; calY--; } selectedDate = null; hideJumpInfo(); renderCalendar(); });
$('#calNext').addEventListener('click', () => { calM++; if (calM > 11) { calM = 0; calY++; } selectedDate = null; hideJumpInfo(); renderCalendar(); });
$('#addEventBtn').addEventListener('click', () => openEventModal());

// «⏭ К ближайшему событию»: ближайшая дата события/свидания с учётом
// ежегодных повторов и идущих сейчас диапазонов (endDate).
function nextUpcoming() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStr = iso(today.getFullYear(), today.getMonth(), today.getDate());
  const cands = [];
  for (const ev of db.events) {
    const [y, m, d] = ev.date.split('-').map(Number);
    let occ;
    if (ev.repeat !== false) { // ежегодный повтор: следующий раз в этом/следующем году
      occ = new Date(today.getFullYear(), m - 1, d);
      if (occ < today) occ = new Date(today.getFullYear() + 1, m - 1, d);
      if (m === 2 && d === 29 && occ.getMonth() === 2 && occ.getDate() === 1) occ.setDate(0); // 29 фев → 28
    } else {
      occ = new Date(y, m - 1, d);
      if (ev.endDate && occ <= today) { // диапазон уже начался и ещё идёт — «сейчас»
        const end = parseLocalIso(ev.endDate);
        if (end && end >= today) occ = today;
      }
      if (occ < today) continue; // разовое в прошлом
    }
    cands.push({ date: iso(occ.getFullYear(), occ.getMonth(), occ.getDate()), title: ev.title, emoji: ev.emoji || '💜' });
  }
  for (const dt of db.dates) {
    if (dt.done) continue;
    const [y, m, d] = dt.date.split('-').map(Number);
    if (new Date(y, m - 1, d) < today) continue;
    cands.push({ date: dt.date, title: dt.place || dt.note || 'Свидание', emoji: dt.emoji || '💘' });
  }
  cands.sort((a, b) => a.date.localeCompare(b.date));
  return cands[0] || null;
}
// «⏭ К ближайшему событию»: плашка + прыжок, если событие не в текущем месяце.
// Вызывается при открытии вкладки календаря и по кнопке «⏭» — плашка видна
// всегда, даже когда ближайшее событие уже видно в текущем месяце.
function showNearestEvent() {
  const nx = nextUpcoming();
  const info = $('#jumpInfo');
  if (!nx) { hideJumpInfo(); return; }
  const [y, m, d] = nx.date.split('-').map(Number);
  if (y !== calY || m - 1 !== calM) { calY = y; calM = m - 1; }
  selectedDate = nx.date;
  renderCalendar();
  if (info) {
    info.textContent = `⏭ Ближайшее: ${nx.emoji} «${nx.title}» — ${d} ${MONTHS[m - 1].toLowerCase()} ${y} г.`;
    info.hidden = false;
  }
}
function jumpToNearestEvent() {
  const nx = nextUpcoming();
  const info = $('#jumpInfo');
  if (!nx) {
    if (info) { info.textContent = '💫 Ближайших событий пока нет — добавь первое!'; info.hidden = false; }
    return;
  }
  showNearestEvent();
}
$('#jumpNextBtn').addEventListener('click', jumpToNearestEvent);

// Быстрый выбор месяца/года (два селекта над календарём)
function fillCalJump() {
  const ms = $('#calMonthSelect'), ys = $('#calYearSelect');
  if (!ms || !ys) return;
  if (typeof ms.add === 'function' && ms.options.length === 0) {
    MONTHS.forEach((name, i) => {
      const o = document.createElement('option'); o.value = String(i); o.textContent = name; ms.add(o);
    });
    const now = new Date();
    const y0 = Math.min(2026, now.getFullYear() - 5);
    for (let y = y0; y <= now.getFullYear() + 5; y++) {
      const o = document.createElement('option'); o.value = String(y); o.textContent = String(y); ys.add(o);
    }
  }
  ms.value = String(calM);
  ys.value = String(calY);
}
function jumpCalendar(m, y) { calM = +m; calY = +y; selectedDate = null; hideJumpInfo(); renderCalendar(); }
$('#calMonthSelect').addEventListener('change', e => jumpCalendar(e.target.value, calY));
$('#calYearSelect').addEventListener('change', e => jumpCalendar(calM, e.target.value));

// Миниатюры фото события в панели дня
function evThumbs(e) {
  if (!(e.photos && e.photos.length)) return '';
  return `<span class="ev-thumbs">${e.photos.map(p => `<img class="ev-thumb" src="${esc(p)}" alt="${esc(e.title)}" data-photo="${esc(p)}" loading="lazy">`).join('')}</span>`;
}

// Фото события кладём в общую галерею под общим лейблом «📅 События»;
// название события остаётся подписью фото (title) и показывается в витрине событий.
// Отдельные лейблы-названия не создаём — иначе фильтр засоряется после 30+ событий.
function addEventPhotosToGallery(photos, title) {
  if (!photos.length) return;
  if (!db.labels.includes(EVENT_LABEL)) db.labels.push(EVENT_LABEL);
  for (const photoData of photos) {
    const ph = db.photos.find(p => p.data === photoData);
    if (ph) {
      if (!Array.isArray(ph.labels)) ph.labels = [];
      if (!ph.labels.includes(EVENT_LABEL)) ph.labels.push(EVENT_LABEL);
    } else {
      db.photos.unshift({ id: uid(), data: photoData, title, labels: [EVENT_LABEL], pinned: false, ts: Date.now(), order: 0 });
    }
  }
}

// Быстрое добавление фото к событию прямо из панели дня (кнопка 📷)
function addEventPhotoQuick(evId) {
  const ev = db.events.find(x => x.id === evId);
  if (!ev) return;
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.addEventListener('change', async () => {
    const ok = [];
    for (const f of [...inp.files].slice(0, 5)) {
      try { ok.push(await readFile(f)); } catch (err) { console.warn('Не удалось прочитать фото события', err); }
    }
    inp.remove();
    if (!ok.length) return;
    ev.photos = Array.isArray(ev.photos) ? ev.photos.concat(ok) : ok;
    addEventPhotosToGallery(ok, ev.title);
    save(); renderCalendar(); renderHome();
  }, { once: true });
  inp.click();
}

/* ===== Кастомный date-picker в стиле сайта =====
   Системный календарь у input[type=date] не стилизуется и «выбивается».
   Вместо него — свой попап в стилистике большого календаря: стрелки ‹ ›,
   селекты месяца/года, сетка дней, «Сегодня» / «Очистить».
   Выбранная дата пишется в поле как ISO (YYYY-MM-DD) с событиями input/change —
   весь остальной код работает без изменений. */
let dpInput = null;                   // поле, для которого открыт попап
let dpM = new Date().getMonth();      // показываемый месяц
let dpY = new Date().getFullYear();   // показываемый год
const dpPad = n => String(n).padStart(2, '0');
function dpIso(y, m, d) { return y + '-' + dpPad(m + 1) + '-' + dpPad(d); }

function renderDatePop() {
  const pop = $('#datePop');
  if (!pop) return;
  const ms = $('#dpMonth'), ys = $('#dpYear');
  if (ms) ms.innerHTML = MONTHS.map((n, i) => `<option value="${i}"${i === dpM ? ' selected' : ''}>${n}</option>`).join('');
  if (ys) {
    const now = new Date();
    const y0 = Math.min(2026, now.getFullYear() - 5);
    ys.innerHTML = '';
    for (let y = y0; y <= now.getFullYear() + 5; y++) {
      const o = document.createElement('option'); o.value = String(y); o.textContent = String(y); ys.appendChild(o);
    }
    ys.value = String(dpY);
  }
  const firstDow = (new Date(dpY, dpM, 1).getDay() + 6) % 7; // понедельник = 0
  const dim = new Date(dpY, dpM + 1, 0).getDate();
  const now = new Date();
  let cells = '<div class="dp-dow">Пн</div><div class="dp-dow">Вт</div><div class="dp-dow">Ср</div>' +
    '<div class="dp-dow">Чт</div><div class="dp-dow">Пт</div><div class="dp-dow">Сб</div><div class="dp-dow">Вс</div>';
  for (let i = 0; i < firstDow; i++) cells += '<button type="button" class="dp-day empty" tabindex="-1"></button>';
  for (let d = 1; d <= dim; d++) {
    const iso = dpIso(dpY, dpM, d);
    const isToday = now.getFullYear() === dpY && now.getMonth() === dpM && now.getDate() === d;
    const picked = dpInput && dpInput.value === iso;
    cells += `<button type="button" class="dp-day${isToday ? ' today' : ''}${picked ? ' picked' : ''}" data-dp-date="${iso}">${d}</button>`;
  }
  const grid = $('#dpDays');
  if (grid) grid.innerHTML = cells;
}
function pickDpDate(iso) {
  if (dpInput) {
    dpInput.value = iso;
    try {
      dpInput.dispatchEvent(new Event('input', { bubbles: true }));
      dpInput.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (err) { /* песочница тестов: Event не определён */ }
  }
  closeDatePop();
}
function closeDatePop() {
  const pop = $('#datePop');
  if (pop) pop.hidden = true;
  dpInput = null;
}
function openDatePop(el) {
  if (!el) return;
  dpInput = el;
  const d = el.value ? parseLocalIso(el.value) : null;
  const now = new Date();
  dpY = (d && !isNaN(d)) ? d.getFullYear() : now.getFullYear();
  dpM = (d && !isNaN(d)) ? d.getMonth() : now.getMonth();
  renderDatePop();
  const pop = $('#datePop');
  if (!pop) return;
  pop.hidden = false;
  // ставим попап под полем, не вылезая за край экрана
  const r = el.getBoundingClientRect && el.getBoundingClientRect();
  const vw = (window.innerWidth || document.documentElement.clientWidth || 320);
  const vh = (window.innerHeight || document.documentElement.clientHeight || 480);
  if (r) {
    const pw = 272, ph = 330;
    let left = r.left;
    if (left + pw > vw - 8) left = Math.max(8, vw - pw - 8);
    pop.style.left = left + 'px';
    let top = r.bottom + 6;
    if (top + ph > vh - 8) top = Math.max(8, r.top - ph - 6);
    pop.style.top = top + 'px';
  }
}
// Клик по попапу: стрелки, «Сегодня», «Очистить», выбор дня
$('#datePop').addEventListener('click', e => {
  const nav = e.target.closest('[data-dp-nav]');
  if (nav) {
    dpM += +nav.dataset.dpNav;
    if (dpM < 0) { dpM = 11; dpY--; }
    if (dpM > 11) { dpM = 0; dpY++; }
    renderDatePop(); return;
  }
  if (e.target.closest('[data-dp-today]')) {
    const n = new Date();
    pickDpDate(dpIso(n.getFullYear(), n.getMonth(), n.getDate())); return;
  }
  if (e.target.closest('[data-dp-clear]')) { pickDpDate(''); return; }
  const day = e.target.closest('[data-dp-date]');
  if (day) pickDpDate(day.dataset.dpDate);
});
$('#dpMonth').addEventListener('change', e => { dpM = +e.target.value; renderDatePop(); });
$('#dpYear').addEventListener('change', e => { dpY = +e.target.value; renderDatePop(); });
// Закрытие: клик мимо или Esc
document.addEventListener('pointerdown', e => {
  const pop = $('#datePop');
  if (pop && !pop.hidden && !pop.contains(e.target)) closeDatePop();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDatePop(); });
// Поля дат в модалках открывают свой календарь вместо системного
['#evDate', '#evEnd', '#dtDate'].forEach(sel => {
  const el = $(sel);
  if (el) el.addEventListener('focus', () => openDatePop(el));
});

// Фото, прикреплённые к событию (живут, пока открыта модалка)
let evPhotoData = [];
function setEvPhotoCount() {
  const c = $('#evPhotoCount');
  if (c) c.textContent = evPhotoData.length ? `✅ фото: ${evPhotoData.length}` : '';
}
function openEventModal(id) {
  const t = new Date();
  $('#evDate').value = iso(t.getFullYear(), t.getMonth(), t.getDate());
  $('#evEnd').value = '';
  $('#evTitle').value = '';
  $('#evEmoji').value = '💜';
  $('#evRepeat').checked = true;
  evPhotoData = [];
  setEvPhotoCount();
  // id может прийти только из data-edit-event; клик по «＋ Добавить дату» не должен
  // попадать сюда как объект события — принимаем только настоящую строку id.
  editingEventId = typeof id === 'string' ? id : null;
  $('#evModalTitle').textContent = editingEventId ? '✏️ Изменить дату' : '💜 Памятная дата';
  const sub = $('#evHeadSub');
  if (sub) sub.textContent = editingEventId ? 'Поправь детали — всё сохранится ✨' : 'Сохрани важный день для вас двоих 💞';
  if (editingEventId) {
    const ev = db.events.find(x => x.id === editingEventId);
    if (ev) {
      $('#evTitle').value = ev.title;
      $('#evDate').value = ev.date;
      $('#evEnd').value = ev.endDate || '';
      $('#evEmoji').value = ev.emoji || '💜';
      $('#evRepeat').checked = ev.repeat !== false;
      evPhotoData = Array.isArray(ev.photos) ? [...ev.photos] : [];
      setEvPhotoCount();
    }
  }
  $('#eventOverlay').hidden = false;
  $('#evTitle').focus();
}
$('#evPhoto').addEventListener('change', async e => {
  const files = [...e.target.files].slice(0, 5);
  for (const f of files) {
    try { evPhotoData.push(await readFile(f)); } catch (err) { console.warn('Не удалось прочитать фото события', err); }
  }
  e.target.value = '';
  setEvPhotoCount();
});
// Долгое событие не повторяется каждый год — снимаем галочку автоматически
$('#evEnd').addEventListener('input', () => { if ($('#evEnd').value) $('#evRepeat').checked = false; });
function saveEventFromModal() {
  const title = $('#evTitle').value.trim();
  const date = $('#evDate').value;
  if (!title || !date) { alert('Напиши название и выбери дату 💜'); return; }
  const endDate = $('#evEnd').value || null;
  if (endDate && endDate < date) { alert('Конец события не может быть раньше начала 💜'); return; }
  const data = { title, date, endDate, emoji: $('#evEmoji').value.trim() || '💜', repeat: $('#evRepeat').checked && !endDate };
  // Фото события: кладём в общую галерею и вешаем лейбл = названию события
  if (evPhotoData.length) {
    data.photos = evPhotoData;
    addEventPhotosToGallery(evPhotoData, title);
  }
  const ev = editingEventId ? db.events.find(x => x.id === editingEventId) : null;
  if (ev) {
    if (ev.photos && !evPhotoData.length) delete ev.photos;
    Object.assign(ev, data);
  } else {
    // Если редактируемое событие не найдено (например, удалено в другой вкладке) —
    // создаём новое, чтобы пользовательские данные не терялись молча.
    db.events.push({ id: uid(), ...data });
  }
  // Переходим на месяц события, чтобы оно сразу появилось в календаре
  const [evY, evM] = date.split('-').map(Number);
  calM = evM - 1; calY = evY; selectedDate = date;
  editingEventId = null;
  save(); $('#eventOverlay').hidden = true; renderCalendar(); renderHome();
}
$('#evSave').addEventListener('click', saveEventFromModal);

