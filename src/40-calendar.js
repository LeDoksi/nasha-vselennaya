/* ===== Календарь ===== */
let calY = new Date().getFullYear(),
  calM = new Date().getMonth(),
  selectedDate = null;
let editingEventId = null;
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
// Родительный падеж для дат: «9 августа 2026 года»
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function fmtShort(s) {
  if (!s) return '';
  const [, m, d] = s.split('-').map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

function iso(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// Парсим 'YYYY-MM-DD' как локальную дату: без 'T00:00:00' браузер трактует строку
// как UTC-полночь, и в часовых поясах западнее UTC дата «съезжает» на день назад.
function parseLocalIso(s) {
  const [y, m, d] = String(s || '')
    .split('-')
    .map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return isNaN(dt) ? null : dt;
}
function eventsOn(dateStr, m, d) {
  return db.events.filter(ev => {
    if (ev.repeat) {
      const [, em, ed] = ev.date.split('-').map(Number);
      // Повтор — только начиная с года создания события: иначе годовщина,
      // заведённая в 2026-м, подсвечивалась бы и в календаре 2020 года.
      return em - 1 === m && ed === d && dateStr >= ev.date;
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

  // Грид-семантика (role=grid/row/gridcell + aria-selected/aria-current/
  // aria-label) — раньше был только role=button на ячейке, без структуры
  // строк, хотя маленький date-picker внутри модалок это уже умел (полный
  // APG-паттерн «grid dialog»). Дни собираются в плоский список, потом
  // режутся на недели по 7 — не рискуем случайно оставить пустую строку.
  const headRow = html`<div class="cal-row cal-head-row" role="row">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => html`<div class="cal-cell cal-dow" role="columnheader">${d}</div>`)}</div>`;
  const dayCells = [];
  for (let i = 0; i < firstDow; i++) dayCells.push(html`<div class="cal-cell cal-empty" role="gridcell"></div>`);
  for (let d = 1; d <= dim; d++) {
    const ds = iso(calY, calM, d);
    const evs = eventsOn(ds, calM, d);
    const dts = datesOn(ds);
    const isToday = today.getFullYear() === calY && today.getMonth() === calM && today.getDate() === d;
    const isSelected = selectedDate === ds;
    const inSpan = db.events.some(ev => !ev.repeat && ev.endDate && ev.endDate >= ev.date && ds >= ev.date && ds <= ev.endDate);
    const cls = `cal-cell${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}${inSpan ? ' in-span' : ''}${dts.length ? ' has-date' : ''}`;
    // aria-current — целый атрибут, а не значение: raw() из фиксированного литерала по флагу, не пользовательские данные.
    const current = isToday ? raw(' aria-current="date"') : '';
    dayCells.push(
      html`<div class="${cls}" data-day="${ds}" role="gridcell" tabindex="0" aria-selected="${String(isSelected)}" aria-label="${d} ${MONTHS_GEN[calM]} ${calY} года"${current}>
        <span class="cal-num">${d}</span>
        ${evs
          .slice(0, 2)
          // .cal-dot-title скрыт на мобиле (см. styles.css, max-width:820px) —
          // квадратные ячейки календаря (aspect-ratio:1) там слишком узкие,
          // заголовок обрезался до «эмодзи…», нечитаемо. На мобиле остаётся
          // только эмодзи (как у date-dot ниже) — полный текст всё равно
          // виден в day-панели под календарём по тапу на день; title="" даёт
          // подсказку по долгому нажатию.
          .map(e => html`<span class="cal-dot" title="${e.title}">${e.emoji}<span class="cal-dot-title"> ${e.title}</span></span>`)}
        ${evs.length > 2 ? html`<span class="cal-dot cal-dot-more" title="Ещё ${evs.length - 2} события">+${evs.length - 2}</span>` : ''}
        ${dts.length ? html`<span class="cal-dot date-dot" title="Свидание">${dts[0].emoji || '💘'}</span>` : ''}
      </div>`
    );
  }
  while (dayCells.length % 7) dayCells.push(html`<div class="cal-cell cal-empty" role="gridcell"></div>`);
  const rows = [];
  for (let i = 0; i < dayCells.length; i += 7) rows.push(html`<div class="cal-row" role="row">${dayCells.slice(i, i + 7)}</div>`);
  $('#calendar').setAttribute('role', 'grid');
  $('#calendar').setAttribute('aria-label', 'Календарь');
  render($('#calendar'), html`${headRow}${rows}`);
  renderDayPanel();
  updateNearestJump();
}
function renderDayPanel() {
  const panel = $('#dayPanel');
  if (!selectedDate) {
    render(panel, html`<p class="cal-tip">👆 Нажми на день в календаре, чтобы посмотреть события или добавить новое.</p>`);
    return;
  }
  const [y, m, d] = selectedDate.split('-').map(Number);
  const evs = eventsOn(selectedDate, m - 1, d);
  const dts = datesOn(selectedDate);
  const fmtDate = `${d} ${MONTHS[m - 1].toLowerCase()} ${y}`;
  render(
    panel,
    html`<div class="day-head"><b>${fmtDate}</b></div>
      ${
        evs.length
          ? evs.map(
              e => html`<div class="day-event">
              ${e.emoji} <span>${e.title}${e.endDate && e.endDate >= e.date ? html` <small class="ev-range">до ${fmtShort(e.endDate)}</small>` : ''}</span>${evThumbs(e)}
              <button class="mini-x" data-photo-event="${e.id}" title="Добавить фото">${navIconHtml('photos')}</button>
              <button class="mini-x" data-edit-event="${e.id}" title="Изменить">${navIconHtml('pencil')}</button>
              <button class="mini-x" data-del-event="${e.id}" title="Удалить">✕</button>
            </div>`
            )
          : html`<p class="cal-tip">В этот день событий пока нет.</p>`
      }
      ${
        dts.length
          ? html`<div class="day-sub">💘 Свидания</div>
            ${dts.map(
              dt => html`<div class="day-event date-evt${dt.done ? ' date-done' : ''}">
                ${dt.emoji || '💘'} <span>${dt.time ? html`🕐 ${dt.time} · ` : ''}${dt.place || dt.note || 'Свидание'}${dt.done ? ' ✅' : ''}</span>${dtThumbs(dt)}
                <button class="mini-x" data-edit-date="${dt.id}" title="Изменить">${navIconHtml('pencil')}</button>
                <button class="mini-x" data-done-date="${dt.id}" title="${dt.done ? 'Снять отметку — свидание не прошло' : 'Свидание прошло — отметить'}">${navIconHtml(dt.done ? 'heart' : 'check')}</button>
                <button class="mini-x" data-photo-date="${dt.id}" title="Добавить фото">${navIconHtml('photos')}</button>
                <button class="mini-x" data-del-date="${dt.id}" title="Удалить">✕</button>
              </div>`
            )}`
          : ''
      }
      <div class="day-add">
        <input type="text" id="dayTitle" placeholder="Название события" />
        <input type="text" id="dayEmoji" value="💜" maxlength="4" />
        <button class="btn" id="dayAdd">＋ Добавить</button>
      </div>`
  );
  const addBtn = $('#dayAdd');
  if (addBtn) addBtn.addEventListener('click', addDayEvent);
  const inp = $('#dayTitle');
  if (inp)
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') addDayEvent();
    });
}
function addDayEvent() {
  const title = $('#dayTitle').value.trim();
  if (!title) return;
  const ev = { id: uid(), title, date: selectedDate, emoji: $('#dayEmoji').value.trim() || '💜', repeat: true };
  ev.md = mdOf(ev.date); // md ищут годовщины по 'MM-DD' независимо от года
  db.events.push(ev);
  repoSet('events', ev);
  renderCalendar();
  renderHome();
}
// Календарь держит в памяти не все события, а только загруженные окна
// месяцев — после любой смены calY/calM дотягиваем сам месяц и оба соседних
// (соседние — заранее, чтобы дальнейшее листание шло без пауз на сеть).
function loadCalMonthNeighbors() {
  loadMonth(calY, calM).then(() => renderCalendar());
  loadMonth(calM === 0 ? calY - 1 : calY, calM === 0 ? 11 : calM - 1);
  loadMonth(calM === 11 ? calY + 1 : calY, calM === 11 ? 0 : calM + 1);
}
$('#calPrev').addEventListener('click', () => {
  calM--;
  if (calM < 0) {
    calM = 11;
    calY--;
  }
  selectedDate = null;
  renderCalendar();
  loadCalMonthNeighbors();
});
$('#calNext').addEventListener('click', () => {
  calM++;
  if (calM > 11) {
    calM = 0;
    calY++;
  }
  selectedDate = null;
  renderCalendar();
  loadCalMonthNeighbors();
});
$('#addEventBtn').addEventListener('click', () => openEventModal());

// «⏭ К ближайшему событию»: ближайшая дата события/свидания с учётом
// ежегодных повторов и идущих сейчас диапазонов (endDate).
function nextUpcoming() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cands = [];
  for (const ev of db.events) {
    const [y, m, d] = ev.date.split('-').map(Number);
    let occ;
    if (ev.repeat !== false) {
      // ежегодный повтор: следующий раз в этом/следующем году
      occ = new Date(today.getFullYear(), m - 1, d);
      if (occ < today) occ = new Date(today.getFullYear() + 1, m - 1, d);
      if (m === 2 && d === 29 && occ.getMonth() === 2 && occ.getDate() === 1) occ.setDate(0); // 29 фев → 28
    } else {
      occ = new Date(y, m - 1, d);
      if (ev.endDate && occ <= today) {
        // диапазон уже начался и ещё идёт — «сейчас»
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
// «⏭ К ближайшему событию»: кнопка и плашка видны, только когда ближайшее
// событие/свидание НЕ в показываемом месяце. В месяце ближайшего события
// их нет. Вызывается из renderCalendar при каждой перерисовке и по кнопке «⏭».
function updateNearestJump() {
  const nx = nextUpcoming();
  const info = $('#jumpInfo');
  const btn = $('#jumpNextBtn');
  if (!nx) {
    // впереди событий нет — кнопка остаётся (по клику — подсказка), плашка скрыта
    if (info) info.hidden = true;
    if (btn) btn.hidden = false;
    return;
  }
  const [y, m, d] = nx.date.split('-').map(Number);
  const here = y === calY && m - 1 === calM;
  if (here) {
    // уже смотрим месяц ближайшего события — кнопка и плашка не нужны
    if (info) info.hidden = true;
    if (btn) btn.hidden = true;
    return;
  }
  if (info) {
    info.textContent = `⏭ Ближайшее: ${nx.emoji} «${nx.title}» — ${d} ${MONTHS[m - 1].toLowerCase()} ${y} г.`;
    info.hidden = false;
  }
  if (btn) btn.hidden = false;
}
function jumpToNearestEvent() {
  const nx = nextUpcoming();
  const info = $('#jumpInfo');
  if (!nx) {
    if (info) {
      info.textContent = '💫 Ближайших событий пока нет — добавь первое!';
      info.hidden = false;
    }
    return;
  }
  const [y, m] = nx.date.split('-').map(Number);
  calY = y;
  calM = m - 1;
  selectedDate = nx.date;
  renderCalendar(); // updateNearestJump() скроет кнопку/плашку: ближайшее уже на экране
  loadCalMonthNeighbors();
}
$('#jumpNextBtn').addEventListener('click', jumpToNearestEvent);

// Быстрый выбор месяца/года (два селекта над календарём)
function fillCalJump() {
  const ms = $('#calMonthSelect'),
    ys = $('#calYearSelect');
  if (!ms || !ys) return;
  if (typeof ms.add === 'function' && ms.options.length === 0) {
    MONTHS.forEach((name, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = name;
      ms.add(o);
    });
    const now = new Date();
    const y0 = Math.min(2026, now.getFullYear() - 5);
    for (let y = y0; y <= now.getFullYear() + 5; y++) {
      const o = document.createElement('option');
      o.value = String(y);
      o.textContent = String(y);
      ys.add(o);
    }
  }
  ms.value = String(calM);
  ys.value = String(calY);
}
function jumpCalendar(m, y) {
  calM = +m;
  calY = +y;
  selectedDate = null;
  renderCalendar();
  loadCalMonthNeighbors();
}
$('#calMonthSelect').addEventListener('change', e => jumpCalendar(e.target.value, calY));
$('#calYearSelect').addEventListener('change', e => jumpCalendar(calM, e.target.value));
