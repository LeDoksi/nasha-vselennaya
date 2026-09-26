/* ===== Главная: счётчик дней ===== */
function daysTogether() {
  const [y, m, d] = START_DATE.split('-').map(Number);
  const a = new Date(y, m - 1, d);
  const b = new Date();
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const now = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((now - start) / 86400000);
}
function nextOcc(ev) {
  const [y, m, d] = ev.date.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let c = new Date(y, m - 1, d);
  if (ev.repeat) {
    while (c < today) c.setFullYear(c.getFullYear() + 1);
    // 29 февраля в невисокосный год «переезжает» на 1 марта — возвращаем к 28 февраля
    if (m === 2 && d === 29 && c.getMonth() === 2 && c.getDate() === 1) c.setDate(0);
  }
  return c;
}
function renderHome() {
  const now0 = new Date();
  now0.setHours(0, 0, 0, 0);
  const rem = db.events
    .map(ev => ({ ev, days: Math.round((nextOcc(ev) - now0) / 86400000) }))
    .filter(o => o.days >= 0 && o.days <= 14)
    .sort((a, b) => a.days - b.days);

  // Напоминания убраны: ближайшее событие и так видно на таймере (#countdown).
  renderDates();
  renderDateInvites(); // счётчик на колокольчике в шапке + список в открытой модалке
  renderCompliment();
  renderCountdown();
  // Фаза B: кольцо прогресса (в блоке — коллаж фото, события «в этот день», статистика)
  renderProgressRing();
  renderTimeline($('#homeTimeline'));
  maybeCelebrateAnniversary(rem);
}

/* ===== Комплимент дня ===== */
const COMPLIMENTS = [
  'Ты — самое тёплое, что случилось в моей жизни 💜',
  'Твоя улыбка делает мой день лучше. Всегда.',
  'Я люблю тебя больше, чем вчера. Но меньше, чем завтра.',
  'С тобой даже обычный день становится праздником ✨',
  'Ты красивее всех звёзд на небе, серьёзно.',
  'Мне нравится просыпаться и знать, что ты есть.',
  'Ты — мой самый любимый человек на свете.',
  'Спасибо, что ты рядом. Это бесценно 💜',
  'Твои глаза — мой любимый цвет.',
  'Я скучаю по тебе даже когда ты рядом.',
  'Ты делаешь меня лучше — просто тем, что ты есть.',
  'Каждый день с тобой — как маленькое чудо.',
  'Ты — моё любимое «доброе утро».',
  'С тобой уютно даже в самый шумный день.',
  'Твоя нежность — моё любимое место.',
  'Я выбрал(а) бы тебя снова. В любой жизни.',
  'Ты — причина моей самой глупой и счастливой улыбки.',
  'Мне хорошо просто потому, что ты существуешь.',
  'Ты — мой человек. Навсегда.',
  'Помни: ты невероятная(ый), а я рядом, чтобы напоминать 💜'
];
function renderCompliment() {
  const box = $('#compliment');
  if (!box) return;
  const key = new Date().toDateString(); // один и тот же комплимент весь день
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  box.textContent = COMPLIMENTS[h % COMPLIMENTS.length];
}

/* ===== Таймер до события ===== */
let countdownTarget = null;
function nextTarget() {
  const now = Date.now();
  let best = null,
    bestT = Infinity;
  const trySet = (t, obj) => {
    if (t > now && t < bestT) {
      bestT = t;
      best = { ...obj, t };
    }
  };
  for (const ev of db.events) trySet(nextOcc(ev).getTime(), { title: ev.title, emoji: ev.emoji || '💜' });
  for (const dt of db.dates) {
    if (dt.done) continue;
    const [y, m, dd] = dt.date.split('-').map(Number);
    const [hh = 0, mm = 0] = dt.time ? dt.time.split(':').map(Number) : [0, 0];
    trySet(new Date(y, m - 1, dd, hh, mm).getTime(), { title: (dt.place || 'Свидание') + (dt.note ? ' — ' + dt.note : ''), emoji: dt.emoji || '💘' });
  }
  return best;
}
function renderCountdown() {
  const box = $('#countdown');
  if (!box) return;
  const n = nextTarget();
  if (!n) {
    box.hidden = true;
    render(box, '');
    countdownTarget = null;
    return;
  }
  countdownTarget = n.t;
  box.hidden = false;
  render(box, html`<span class="now-label">${n.emoji} до «${n.title}»</span> <span class="now-tick" id="countdownTick">…</span>`);
  tickCountdown();
}
function tickCountdown() {
  const el = $('#countdownTick');
  if (!el || countdownTarget == null) return;
  if (countdownTarget - Date.now() <= 0) {
    renderCountdown();
    return;
  } // цель наступила — сразу берём следующую
  const left = countdownTarget - Date.now();
  const s = Math.floor(left / 1000);
  const dd = Math.floor(s / 86400),
    hh = Math.floor((s % 86400) / 3600),
    mm = Math.floor((s % 3600) / 60),
    ss = s % 60;
  const p = n => String(n).padStart(2, '0');
  el.textContent = dd > 0 ? `${dd} дн. ${p(hh)}:${p(mm)}:${p(ss)}` : `${p(hh)}:${p(mm)}:${p(ss)}`;
}
setInterval(() => {
  if (!isHidden()) tickCountdown();
}, 1000);

/* ===== Конфетти ===== */
function celebrate() {
  const emojis = ['💜', '💖', '✨', '🎉', '🌸', '💞'];
  for (let i = 0; i < 36; i++) {
    const c = document.createElement('span');
    c.className = 'confetti';
    c.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    c.style.left = Math.random() * 100 + 'vw';
    c.style.fontSize = 14 + Math.random() * 18 + 'px';
    c.style.top = '-20px';
    c.style.animationDuration = 2.2 + Math.random() * 2.4 + 's';
    c.style.animationDelay = Math.random() * 0.7 + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 6000);
  }
}
function maybeCelebrateAnniversary(rem) {
  if (!rem.some(r => r.days === 0)) return;
  try {
    const day = new Date().toDateString();
    if (sessionStorage.getItem('uni_celebrated:' + day)) return;
    sessionStorage.setItem('uni_celebrated:' + day, '1');
    celebrate(); // сегодня важный день — салют!
  } catch (e) {}
}

/* ===== Свидания ===== */
// datesOn: показывает ВСЕ свидания (включая done) для календаря и памяти
function datesOn(dateStr) {
  return db.dates.filter(d => d.date === dateStr);
}
function fmtDateLong(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
}
function fmtResp(r) {
  return r === 'yes' ? '✅ да' : r === 'no' ? '❌ нет' : '⏳ ещё не решил';
}
function renderDates() {
  const box = $('#dates');
  if (!db.dates.length) {
    render(box, html`<div class="empty-state dates-empty">💘 Свиданий пока нет.<br />Нажми «Назначить свидание» — и пусть оно обязательно случится!</div>`);
    return;
  }
  const now0 = new Date();
  now0.setHours(0, 0, 0, 0);
  const list = db.dates
    .map(d => {
      const [y, m, dd] = d.date.split('-').map(Number);
      const when = new Date(y, m - 1, dd);
      return { d, when, days: Math.round((when - now0) / 86400000) };
    })
    .filter(o => o.days >= 0 && !o.d.done)
    .sort((a, b) => a.when - b.when || (a.d.time || '').localeCompare(b.d.time || ''))
    .slice(0, 8);
  render(
    box,
    html`${
      list.length
        ? list.map(o => {
            const d = o.d;
            const who = getUser();
            const resp = d.responses || {};
            const from = d.from;
            // Пригласивший уже согласился — ему кнопки «Да/Нет» не нужны
            const status = p => (from === p ? (p === 'gosha' ? '💌 позвал' : '💌 позвала') : fmtResp(resp[p]));
            // canAnswer: не только «не я позвал», но и «ещё не ответил» — иначе
            // кнопки Да/Нет остаются после ответа и по ним можно кликать бесконечно (NV-11)
            const canAnswer = (!from || from === 'both' || from !== who) && !resp[who];
            const bothYes = resp.gosha === 'yes' && resp.dasha === 'yes';
            return html`<div class="date-card">
                <div class="date-emoji">${d.emoji || '💘'}</div>
                <div class="date-info">
                  <b>${fmtDateLong(d.date)}${o.days === 0 ? html`<span class="tag tag-today">сегодня</span>` : o.days === 1 ? html`<span class="tag">завтра</span>` : ''}</b>
                  ${from ? html`<span class="date-from">${from === 'both' ? '💜 вместе' : from === 'gosha' ? '💌 приглашение от Гоши' : '💌 приглашение от Даши'}</span>` : ''}
                  ${d.time ? html`<span>🕐 ${d.time}</span>` : ''} ${d.place ? html`<span>📍 ${d.place}</span>` : ''} ${d.note ? html`<span>💬 ${d.note}</span>` : ''}
                </div>
                <div class="date-side">
                  <div class="resp-row">
                    <span class="${who === 'gosha' ? 'resp-me' : ''}">Гоша: ${status('gosha')}</span>
                    <span class="${who === 'dasha' ? 'resp-me' : ''}">Даша: ${status('dasha')}</span>
                  </div>
                  ${bothYes ? html`<div class="both-yes">💞 Мы идём на свидание!</div>` : ''}
                  ${
                    canAnswer
                      ? html`<div class="resp-btns">
                          <button class="resp-btn ${resp[who] === 'yes' ? 'on' : ''}" data-answer-date="${d.id}" data-answer="yes">Да 👍</button>
                          <button class="resp-btn no ${resp[who] === 'no' ? 'on' : ''}" data-answer-date="${d.id}" data-answer="no">Нет 👎</button>
                        </div>`
                      : ''
                  }
                </div>
              </div>`;
          })
        : html`<p class="cal-tip">Ближайших свиданий пока нет. Самое время назначить новое! ✨</p>`
    }`
  );
}

/* ===== Неотвеченные приглашения на свидание =====
   Раньше их было видно, только долистав до блока свиданий в самом низу
   главной — на телефоне легко пропустить. Теперь: кнопка-колокольчик в
   шапке (видна всегда, есть счётчик) + окно само всплывает при входе. */
// Приглашение партнёра, на которое я ещё не ответил(а): не моё (from !== я),
// не «вместе» (там отвечать не обязательно), не done, ответа ещё нет.
function pendingDateInvites() {
  const who = getUser();
  return db.dates.filter(d => !d.done && d.from && d.from !== 'both' && d.from !== who && !(d.responses && d.responses[who]));
}
function dateInviteCardHTML(d) {
  const fromName = d.from === 'gosha' ? 'Гоши' : 'Даши';
  return html`<div class="date-card">
    <div class="date-emoji">${d.emoji || '💘'}</div>
    <div class="date-info">
      <b>${fmtDateLong(d.date)}</b>
      <span class="date-from">💌 приглашение от ${fromName}</span>
      ${d.time ? html`<span>🕐 ${d.time}</span>` : ''} ${d.place ? html`<span>📍 ${d.place}</span>` : ''} ${d.note ? html`<span>💬 ${d.note}</span>` : ''}
    </div>
    <div class="date-side">
      <div class="resp-btns">
        <button class="resp-btn" data-answer-date="${d.id}" data-answer="yes">Да 👍</button>
        <button class="resp-btn no" data-answer-date="${d.id}" data-answer="no">Нет 👎</button>
      </div>
    </div>
  </div>`;
}
// Обновляет счётчик на кнопке-колокольчике и список внутри модалки (если она
// открыта — например, ответили прямо в ней). Ответили на все — модалка сама
// закрывается. Вызывается из renderHome(), чтобы счётчик не «протухал».
function renderDateInvites() {
  const pending = pendingDateInvites();
  const btn = $('#dateInviteBtn');
  if (btn) {
    btn.hidden = !pending.length;
    const c = $('#dateInviteCount');
    if (c) c.textContent = pending.length;
  }
  const list = $('#dateInviteList');
  render(list, html`${pending.map(dateInviteCardHTML)}`);
  const ov = $('#dateInviteOverlay');
  if (ov && !ov.hidden && !pending.length) closeOverlay('dateInviteOverlay'); // ответили на всё — закрываем само
  return pending;
}
// «Закрыл не ответив» запоминаем на время сессии (sessionStorage — та же
// граница, что у «запомнить меня»: переживает reload, не переживает закрытие
// вкладки/браузера), чтобы окно не всплывало повторно при каждом заходе на
// главную. Новое, ещё не виденное приглашение всё равно покажется.
const DISMISSED_INVITES_KEY = 'universe_dismissed_invites';
function getDismissedInviteIds() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(DISMISSED_INVITES_KEY) || '[]'));
  } catch (e) {
    return new Set();
  }
}
function markInvitesDismissed(ids) {
  try {
    sessionStorage.setItem(DISMISSED_INVITES_KEY, JSON.stringify(ids));
  } catch (e) {}
}
function openDateInviteOverlay() {
  renderDateInvites();
  openOverlay('dateInviteOverlay');
}
// Вызывается один раз при входе (unlockApp): если есть приглашения, которые
// ещё не показывали и не закрывали в этой сессии — всплывает окно.
function maybeShowDateInvitePopup() {
  const pending = renderDateInvites();
  if (!pending.length) return;
  const dismissed = getDismissedInviteIds();
  if (pending.every(d => dismissed.has(d.id))) return; // всё уже видели и закрыли — не спамим
  openDateInviteOverlay();
}

let editingDateId = null;
// id — только настоящая строка (клик по «💘 Назначить свидание» передаёт
// MouseEvent, не id — как и было с openEventModal, см. фикс события ＋Добавить дату).
function openDateModal(id) {
  editingDateId = typeof id === 'string' ? id : null;
  const dt = editingDateId ? db.dates.find(x => x.id === editingDateId) : null;
  const title = $('#dtModalTitle');
  if (title) title.textContent = dt ? '✏️ Изменить свидание' : '💘 Назначить свидание';
  if (dt) {
    $('#dtDate').value = dt.date;
    $('#dtTime').value = dt.time || '19:00';
    $('#dtPlace').value = dt.place || '';
    $('#dtNote').value = dt.note || '';
    $('#dtEmoji').value = dt.emoji || '💘';
  } else {
    const t = new Date();
    $('#dtDate').value = iso(t.getFullYear(), t.getMonth(), t.getDate());
    $('#dtTime').value = '19:00';
    $('#dtPlace').value = '';
    $('#dtNote').value = '';
    $('#dtEmoji').value = '💘';
  }
  openOverlay('dateOverlay');
}
$('#addDateBtn').addEventListener('click', () => openDateModal());
// Свидание всегда от имени вошедшего — выбора «кто приглашает» нет.
function saveDateFromModal() {
  const date = $('#dtDate').value;
  if (!date) {
    alert('Выбери дату свидания 💘');
    return;
  }
  const existing = editingDateId ? db.dates.find(x => x.id === editingDateId) : null;
  if (existing) {
    // Правка не трогает from/responses — кто позвал и кто уже ответил, остаётся как было.
    existing.date = date;
    existing.time = $('#dtTime').value;
    existing.place = $('#dtPlace').value.trim();
    existing.note = $('#dtNote').value.trim();
    existing.emoji = $('#dtEmoji').value.trim() || '💘';
    editingDateId = null;
    repoSet('dates', existing);
    closeOverlay('dateOverlay');
    renderHome();
    renderCalendar();
    return;
  }
  const from = getUser();
  // Пригласивший уже согласен по смыслу (UI показывает «💌 позвал/позвала» без
  // кнопок ответа — canAnswer это и запрещает), поэтому его responses[from]
  // должен быть 'yes' сразу. Раньше оба поля стартовали null и приглашающий
  // никогда не мог ответить сам — bothYes/celebrate() требовали 'yes' от
  // обоих буквально, из-за чего «Мы идём на свидание!» не срабатывало
  // НИКОГДА ни при каком сценарии использования.
  const dt = {
    id: uid(),
    date,
    time: $('#dtTime').value,
    from,
    responses: { gosha: from === 'gosha' ? 'yes' : null, dasha: from === 'dasha' ? 'yes' : null },
    place: $('#dtPlace').value.trim(),
    note: $('#dtNote').value.trim(),
    emoji: $('#dtEmoji').value.trim() || '💘',
    done: false
  };
  db.dates.push(dt);
  repoSet('dates', dt);
  closeOverlay('dateOverlay');
  renderHome();
  renderCalendar();
  // Пуш — без деталей свидания (дата/место/заметка), см. src/96-push.js
  notifyPartner('💘 Тебе назначили свидание', 'Открой приложение, чтобы посмотреть детали 💜');
}
$('#dtSave').addEventListener('click', saveDateFromModal);
