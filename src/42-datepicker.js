/* ===== Кастомный date-picker в стиле сайта =====
   Системный календарь у input[type=date] не стилизуется и «выбивается».
   Вместо него — свой попап в стилистике большого календаря: стрелки ‹ ›,
   селекты месяца/года, сетка дней, «Сегодня» / «Очистить».
   Выбранная дата пишется в поле как ISO (YYYY-MM-DD) с событиями input/change —
   весь остальной код работает без изменений. */
let dpInput = null; // поле, для которого открыт попап
let dpM = new Date().getMonth(); // показываемый месяц
let dpY = new Date().getFullYear(); // показываемый год
const dpPad = n => String(n).padStart(2, '0');
function dpIso(y, m, d) {
  return y + '-' + dpPad(m + 1) + '-' + dpPad(d);
}
let dpFocus = null; // сфокусированный день (клавиатура, roving tabindex)

// Фокус и клавиатурная навигация: паттерн «date picker dialog + grid» из APG.
// setDpFocus озвучивает дату скринридеру через #dpLive (role=status, aria-live=polite).
function setDpFocus(iso) {
  dpFocus = iso;
  const live = $('#dpLive');
  const [yy, mm, dd] = String(iso || '')
    .split('-')
    .map(Number);
  if (live && yy && mm && dd) live.textContent = `${dd} ${MONTHS_GEN[mm - 1]} ${yy} года`;
}
// После смены месяца/года день не должен «пропадать»: зажимаем его в границы месяца
function clampDpFocus() {
  const [yy, , dd] = String(dpFocus || '')
    .split('-')
    .map(Number);
  const dim = new Date(dpY, dpM + 1, 0).getDate();
  setDpFocus(dpIso(dpY, dpM, yy ? Math.min(dd, dim) : Math.min(new Date().getDate(), dim)));
}
function focusDpDay(iso) {
  const btn = document.querySelector(`.dp-day[data-dp-date="${iso}"]`);
  if (btn && btn.focus) btn.focus();
}
function datePopKeydown(e) {
  if (!e || !e.key) return;
  const pop = $('#datePop');
  if (!pop || pop.hidden) return;
  if (e.key === 'Escape') {
    const el = dpInput;
    closeDatePop();
    returnDpFocus(el);
    if (e.preventDefault) e.preventDefault();
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    if (dpFocus) pickDpDate(dpFocus);
    if (e.preventDefault) e.preventDefault();
    return;
  }
  if (!dpFocus) return;
  const [yy, mm, dd] = dpFocus.split('-').map(Number);
  const dim = () => new Date(dpY, dpM + 1, 0).getDate();
  const stay = nd => {
    setDpFocus(dpIso(dpY, dpM, nd));
    renderDatePop();
    focusDpDay(dpFocus);
  };
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (e.preventDefault) e.preventDefault();
    const base = new Date(yy, mm - 1, dd + (e.key === 'ArrowLeft' ? -1 : 1));
    stay(base.getMonth() === mm - 1 ? base.getDate() : e.key === 'ArrowLeft' ? 1 : dim());
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    if (e.preventDefault) e.preventDefault();
    const base = new Date(yy, mm - 1, dd + (e.key === 'ArrowUp' ? -7 : 7));
    stay(base.getMonth() === mm - 1 ? base.getDate() : e.key === 'ArrowUp' ? 1 : dim());
  } else if (e.key === 'Home' || e.key === 'End') {
    if (e.preventDefault) e.preventDefault();
    stay(e.key === 'Home' ? 1 : dim());
  } else if (e.key === 'PageUp' || e.key === 'PageDown') {
    if (e.preventDefault) e.preventDefault();
    let y = dpY,
      m = dpM;
    if (e.shiftKey) {
      y += e.key === 'PageUp' ? -1 : 1;
    } else {
      m += e.key === 'PageUp' ? -1 : 1;
      if (m < 0) {
        m = 11;
        y--;
      }
      if (m > 11) {
        m = 0;
        y++;
      }
    }
    dpY = y;
    dpM = m;
    clampDpFocus();
    renderDatePop();
    focusDpDay(dpFocus);
  }
}
// Обработчик висит на сетке дней: стрелки не перехватываются, когда фокус на селектах/кнопках
$('#dpDays').addEventListener('keydown', datePopKeydown);

function renderDatePop() {
  const pop = $('#datePop');
  if (!pop) return;
  const ms = $('#dpMonth'),
    ys = $('#dpYear');
  // selected — целый атрибут, а не значение: raw() из фиксированного литерала по флагу, не пользовательские данные.
  if (ms) render(ms, html`${MONTHS.map((n, i) => html`<option value="${i}"${i === dpM ? raw(' selected') : ''}>${n}</option>`)}`);
  if (ys) {
    const now = new Date();
    const y0 = Math.min(2026, now.getFullYear() - 5);
    render(ys, '');
    for (let y = y0; y <= now.getFullYear() + 5; y++) {
      const o = document.createElement('option');
      o.value = String(y);
      o.textContent = String(y);
      ys.appendChild(o);
    }
    ys.value = String(dpY);
  }
  const firstDow = (new Date(dpY, dpM, 1).getDay() + 6) % 7; // понедельник = 0
  const dim = new Date(dpY, dpM + 1, 0).getDate();
  const now = new Date();
  const dow = html`${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => html`<div class="dp-dow" role="columnheader">${d}</div>`)}`;
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(html`<button type="button" class="dp-day empty" tabindex="-1" aria-hidden="true"></button>`);
  for (let d = 1; d <= dim; d++) {
    const iso = dpIso(dpY, dpM, d);
    const isToday = now.getFullYear() === dpY && now.getMonth() === dpM && now.getDate() === d;
    const picked = dpInput && dpInput.value === iso;
    // aria-current — целый атрибут, а не значение: raw() из фиксированного литерала по флагу, не пользовательские данные.
    const current = isToday ? raw(' aria-current="date"') : '';
    cells.push(
      html`<button type="button" class="dp-day${isToday ? ' today' : ''}${picked ? ' picked' : ''}" data-dp-date="${iso}" tabindex="${iso === dpFocus ? '0' : '-1'}" aria-label="${d} ${MONTHS_GEN[dpM]} ${dpY} года"${current}>${d}</button>`
    );
  }
  const grid = $('#dpDays');
  render(grid, html`${dow}${cells}`);
}
// Клик по дню в попапе двигает фокус на саму кнопку дня, а не остаётся на
// input — el.focus() ниже возвращает его обратно, но это НАСТОЯЩИЙ новый
// focus-event (фокус реально был на кнопке), который слушатель '#evDate'
// и др. (см. конец файла) ловит и тут же открывает попап заново — клик по
// дате визуально «не закрывал» календарь, закрыть можно было только кликом
// мимо. dpSuppressReopen — флаг-заслонка на время программного возврата
// фокуса: тот же приём, что и everywhere в проекте для «наш код вызвал
// событие, слушатель не должен реагировать как на настоящее действие
// пользователя».
let dpSuppressReopen = false;
// Программный возврат фокуса в поле — всегда под заслонкой: иначе
// focus-слушатель поля (конец файла) открывает календарик заново.
function returnDpFocus(el) {
  if (!el || !el.focus) return;
  dpSuppressReopen = true;
  el.focus();
  dpSuppressReopen = false;
}
function pickDpDate(iso) {
  const el = dpInput;
  if (el) {
    el.value = iso;
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (err) {
      /* песочница тестов: Event не определён */
    }
  }
  closeDatePop();
  returnDpFocus(el);
}
function closeDatePop() {
  const pop = $('#datePop');
  setPopover(pop, false);
  dpInput = null;
}
function openDatePop(el) {
  if (!el) return;
  dpInput = el;
  const d = el.value ? parseLocalIso(el.value) : null;
  const now = new Date();
  dpY = d && !isNaN(d) ? d.getFullYear() : now.getFullYear();
  dpM = d && !isNaN(d) ? d.getMonth() : now.getMonth();
  // Клавиатура: roving tabindex — фокус на выбранной дате или на «сегодня»
  const picked = dpInput && /^\d{4}-\d{2}-\d{2}$/.test(dpInput.value) ? dpInput.value : null;
  setDpFocus(picked || dpIso(dpY, dpM, Math.min(now.getDate(), new Date(dpY, dpM + 1, 0).getDate())));
  renderDatePop();
  const pop = $('#datePop');
  if (!pop) return;
  // Не-модальный диалог выбора даты: роль и подпись для скринридера
  try {
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'false');
    pop.setAttribute('aria-label', 'Выбор даты');
  } catch (err) {}
  setPopover(pop, true);
  focusDpDay(dpFocus);
  // ставим попап под полем, не вылезая за край экрана
  const r = el.getBoundingClientRect && el.getBoundingClientRect();
  const vw = (typeof window !== 'undefined' && window.innerWidth) || document.documentElement.clientWidth || 320;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || document.documentElement.clientHeight || 480;
  if (r) {
    const pw = 272,
      ph = 330;
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
    if (dpM < 0) {
      dpM = 11;
      dpY--;
    }
    if (dpM > 11) {
      dpM = 0;
      dpY++;
    }
    clampDpFocus();
    renderDatePop();
    focusDpDay(dpFocus);
    return;
  }
  if (e.target.closest('[data-dp-today]')) {
    const n = new Date();
    pickDpDate(dpIso(n.getFullYear(), n.getMonth(), n.getDate()));
    return;
  }
  if (e.target.closest('[data-dp-clear]')) {
    pickDpDate('');
    return;
  }
  const day = e.target.closest('[data-dp-date]');
  if (day) pickDpDate(day.dataset.dpDate);
});
$('#dpMonth').addEventListener('change', e => {
  dpM = +e.target.value;
  clampDpFocus();
  renderDatePop();
});
$('#dpYear').addEventListener('change', e => {
  dpY = +e.target.value;
  clampDpFocus();
  renderDatePop();
});
// Закрытие: клик мимо или Esc
document.addEventListener('pointerdown', e => {
  const pop = $('#datePop');
  if (pop && !pop.hidden && !pop.contains(e.target)) closeDatePop();
});
// Esc с фокуса вне #dpDays (месяц, год, стрелки, «Сегодня», «Очистить») —
// datePopKeydown висит только на сетке дней, этот ловит остальное.
function onDatePopDocEscape(e) {
  if (e.key !== 'Escape') return;
  const pop = $('#datePop');
  if (!pop || pop.hidden) return;
  const el = dpInput;
  closeDatePop();
  returnDpFocus(el);
  // preventDefault гасит default action Escape у модального <dialog>-родителя
  // (fire cancel) — иначе модалка закрылась бы тем же нажатием.
  e.preventDefault();
}
document.addEventListener('keydown', onDatePopDocEscape);
// Поля дат в модалках открывают свой календарь вместо системного
['#evDate', '#evEnd', '#dtDate'].forEach(sel => {
  const el = $(sel);
  if (el)
    el.addEventListener('focus', () => {
      if (!dpSuppressReopen) openDatePop(el);
    });
});
