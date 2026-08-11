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
  $('#daysCount').textContent = daysTogether();
  const now0 = new Date();
  now0.setHours(0, 0, 0, 0);
  const rem = db.events
    .map(ev => ({ ev, days: Math.round((nextOcc(ev) - now0) / 86400000) }))
    .filter(o => o.days >= 0 && o.days <= 14)
    .sort((a, b) => a.days - b.days);

  // Напоминания убраны: ближайшее событие и так видно на таймере (#countdown).
  renderDates();
  renderCompliment();
  renderCountdown();
  // Фаза B: кольцо прогресса (в блоке — коллаж фото, события «в этот день», статистика)
  renderProgressRing();
  // Фото с data-photo-src (кэш миниатюр не прогрет) — заполняем src асинхронно
  hydratePhotoImgs($('#progressRing'));
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
  box.innerHTML = `<div class="compliment-card">
    <h4>💌 Комплимент дня</h4>
    <div class="compliment-text">${esc(COMPLIMENTS[h % COMPLIMENTS.length])}</div>
  </div>`;
}

/* ===== Таймер до события ===== */
let countdownTarget = null;
function nextTarget() {
  const now = Date.now();
  let best = null, bestT = Infinity;
  const trySet = (t, obj) => { if (t > now && t < bestT) { bestT = t; best = { ...obj, t }; } };
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
  if (!n) { box.hidden = true; box.innerHTML = ''; countdownTarget = null; return; }
  countdownTarget = n.t;
  box.hidden = false;
  box.innerHTML = `<div class="compliment-card">
    <h4>${esc(n.emoji)} До «${esc(n.title)}» осталось</h4>
    <div class="countdown-time" id="countdownTick">…</div>
  </div>`;
  tickCountdown();
}
function tickCountdown() {
  const el = $('#countdownTick');
  if (!el || countdownTarget == null) return;
  if (countdownTarget - Date.now() <= 0) { renderCountdown(); return; } // цель наступила — сразу берём следующую
  const left = countdownTarget - Date.now();
  const s = Math.floor(left / 1000);
  const dd = Math.floor(s / 86400), hh = Math.floor(s % 86400 / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
  const p = n => String(n).padStart(2, '0');
  el.textContent = dd > 0 ? `${dd} дн. ${p(hh)}:${p(mm)}:${p(ss)}` : `${p(hh)}:${p(mm)}:${p(ss)}`;
}
setInterval(() => { if (!isHidden()) tickCountdown(); }, 1000);

/* ===== Конфетти ===== */
function celebrate() {
  if (motionReduced()) return; // конфетти — декоративное движение, при reduced-motion пропускаем
  const emojis = ['💜', '💖', '✨', '🎉', '🌸', '💞'];
  for (let i = 0; i < 36; i++) {
    const c = document.createElement('span');
    c.className = 'confetti';
    c.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    c.style.left = Math.random() * 100 + 'vw';
    c.style.fontSize = (14 + Math.random() * 18) + 'px';
    c.style.top = '-20px';
    c.style.animationDuration = (2.2 + Math.random() * 2.4) + 's';
    c.style.animationDelay = (Math.random() * 0.7) + 's';
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
    box.innerHTML = '<div class="empty-state dates-empty">💘 Свиданий пока нет.<br>Нажми «Назначить свидание» — и пусть оно обязательно случится!</div>';
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
  box.innerHTML = '<h3>💘 Наши свидания</h3>' +
    (list.length ? list.map(o => {
      const d = o.d;
      const who = getUser();
      const resp = d.responses || {};
      const from = d.from;
      // Пригласивший уже согласился — ему кнопки «Да/Нет» не нужны
      const status = p => from === p
        ? (p === 'gosha' ? '💌 позвал' : '💌 позвала')
        : fmtResp(resp[p]);
      const canAnswer = !from || from === 'both' || from !== who;
      const bothYes = resp.gosha === 'yes' && resp.dasha === 'yes';
      const whenTag = o.days === 0
        ? '<span class="tag tag-today">сегодня</span>'
        : o.days === 1 ? '<span class="tag">завтра</span>' : '';
      return `<div class="date-card">
        <div class="date-emoji">${esc(d.emoji || '💘')}</div>
        <div class="date-info">
          <b>${fmtDateLong(d.date)}${whenTag}</b>
          ${from ? `<span class="date-from">${from === 'both' ? '💜 вместе' : from === 'gosha' ? '💌 приглашение от Гоши' : '💌 приглашение от Даши'}</span>` : ''}
          ${d.time ? `<span>🕐 ${esc(d.time)}</span>` : ''}
          ${d.place ? `<span>📍 ${esc(d.place)}</span>` : ''}
          ${d.note ? `<span>💬 ${esc(d.note)}</span>` : ''}
        </div>
        <div class="date-side">
          <div class="resp-row">
            <span class="${who === 'gosha' ? 'resp-me' : ''}">Гоша: ${status('gosha')}</span>
            <span class="${who === 'dasha' ? 'resp-me' : ''}">Даша: ${status('dasha')}</span>
          </div>
          ${bothYes ? '<div class="both-yes">💞 Мы идём на свидание!</div>' : ''}
          ${canAnswer ? `<div class="resp-btns">
            <button class="resp-btn ${resp[who] === 'yes' ? 'on' : ''}" data-answer-date="${d.id}" data-answer="yes">Да 👍</button>
            <button class="resp-btn no ${resp[who] === 'no' ? 'on' : ''}" data-answer-date="${d.id}" data-answer="no">Нет 👎</button>
          </div>` : ''}
          <div class="date-btns">
            <button class="mini-x" data-edit-date="${d.id}" title="Изменить">✏️</button>
            <button class="mini-x" data-done-date="${d.id}" title="Свидание прошло">💗</button>
            <button class="mini-x" data-del-date="${d.id}" title="Удалить">✕</button>
          </div>
        </div>
      </div>`;
    }).join('') : '<p class="cal-tip">Ближайших свиданий пока нет. Самое время назначить новое! ✨</p>');
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
  $('#dateOverlay').hidden = false;
}
$('#addDateBtn').addEventListener('click', () => openDateModal());
// Свидание всегда от имени вошедшего — выбора «кто приглашает» нет.
function saveDateFromModal() {
  const date = $('#dtDate').value;
  if (!date) { alert('Выбери дату свидания 💘'); return; }
  const existing = editingDateId ? db.dates.find(x => x.id === editingDateId) : null;
  if (existing) {
    // Правка не трогает from/responses — кто позвал и кто уже ответил, остаётся как было.
    existing.date = date;
    existing.time = $('#dtTime').value;
    existing.place = $('#dtPlace').value.trim();
    existing.note = $('#dtNote').value.trim();
    existing.emoji = $('#dtEmoji').value.trim() || '💘';
    editingDateId = null;
    save(); $('#dateOverlay').hidden = true; renderHome(); renderCalendar();
    return;
  }
  const from = getUser();
  // Пригласивший уже согласен по смыслу (UI показывает «💌 позвал/позвала» без
  // кнопок ответа — canAnswer это и запрещает), поэтому его responses[from]
  // должен быть 'yes' сразу. Раньше оба поля стартовали null и приглашающий
  // никогда не мог ответить сам — bothYes/celebrate() требовали 'yes' от
  // обоих буквально, из-за чего «Мы идём на свидание!» не срабатывало
  // НИКОГДА ни при каком сценарии использования.
  db.dates.push({
    id: uid(), date, time: $('#dtTime').value,
    from, responses: { gosha: from === 'gosha' ? 'yes' : null, dasha: from === 'dasha' ? 'yes' : null },
    place: $('#dtPlace').value.trim(), note: $('#dtNote').value.trim(),
    emoji: $('#dtEmoji').value.trim() || '💘', done: false
  });
  save(); $('#dateOverlay').hidden = true;
  renderHome(); renderCalendar();
}
$('#dtSave').addEventListener('click', saveDateFromModal);

/* ===== Коллаж «Наша история»: фото «в этот день» + случайные, с асимметрией ===== */
// Фото живут внутри блока «Наша история» (#progressRing): разный размер,
// поворот и вертикальный сдвиг — без ровных рядов. В приоритете — фото
// «в этот день» из прошлых лет (EXIF/дата события/свидания), остальные
// слоты заполняются случайными. Выбор стабилен в течение дня (seed по дате);
// кнопка «🎲 Перемешать» меняет коллаж вручную, но тоже фиксирует его до конца дня.
const HISTORY_PHOTO_SLOTS = [
  { st: 'left:1%; top:16%; width:84px; height:84px; rotate:-7deg',  dur: 6.4, delay: 0 },
  { st: 'left:29%; top:5%; width:100px; height:100px; rotate:5deg', dur: 5.8, delay: 0.6 },
  { st: 'left:58%; top:24%; width:72px; height:72px; rotate:-3deg', dur: 6.9, delay: 1.2 }
];
function daySeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Фото «в этот день» из прошлых лет (по EXIF или дате события/свидания)
function onThisDayPhotos(at) {
  return onThisDayItems(at).filter(it => it.kind === 'photo' && it.p).map(it => it.p);
}
// Зафиксированный на день выбор коллажа {day, sig, ids}; ручной перемес живёт до полуночи.
// sig — сигнатура состава галереи: при добавлении/удалении фото коллаж пересобирается.
let historyCollage = null;
function photoSignature() {
  return [...db.photos].map(p => p.id).sort().join(',');
}
function shufflePick(photos, rnd) {
  for (let i = photos.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [photos[i], photos[j]] = [photos[j], photos[i]];
  }
}
// «В этот день» встают первыми (до 3 слотов), остальные — случайные из перетасованного списка
function pinOnThisDay(photos, n, at) {
  const picks = [];
  const otd = onThisDayPhotos(at);
  for (const p of otd) { if (picks.length >= n) break; if (!picks.includes(p)) picks.push(p); }
  for (const p of photos) { if (picks.length >= n) break; if (!picks.includes(p)) picks.push(p); }
  return picks;
}
function pickHistoryPhotos(at) {
  const dayStr = (at || new Date()).toDateString();
  const sig = photoSignature();
  if (historyCollage && historyCollage.day === dayStr && historyCollage.sig === sig) {
    const byId = new Map(db.photos.map(p => [p.id, p]));
    return historyCollage.ids.map(id => byId.get(id)).filter(Boolean);
  }
  const photos = [...db.photos];
  const n = Math.min(HISTORY_PHOTO_SLOTS.length, photos.length);
  shufflePick(photos, mulberry32(daySeed(dayStr) + n * 7919));
  const picks = pinOnThisDay(photos, n, at);
  historyCollage = { day: dayStr, sig, ids: picks.map(p => p.id) };
  return picks;
}
// «🎲 Перемешать коллаж» — заново тасует случайную часть; фото «в этот день» остаются
function shuffleHistoryPhotos() {
  const photos = [...db.photos];
  const n = Math.min(HISTORY_PHOTO_SLOTS.length, photos.length);
  shufflePick(photos, mulberry32((Math.random() * 0xffffffff) >>> 0));
  const picks = pinOnThisDay(photos, n);
  historyCollage = { day: new Date().toDateString(), sig: photoSignature(), ids: picks.map(p => p.id) };
  renderProgressRing();
  hydratePhotoImgs($('#progressRing'));
}
function historyPhotosHtml(at) {
  const picks = pickHistoryPhotos(at);
  const otdIds = new Set(onThisDayPhotos(at).map(p => p.id));
  const badge = picks.some(p => otdIds.has(p.id)) ? '<span class="hp-badge">✨ В этот день</span>' : '';
  return badge + picks.map((p, i) => {
    const s = HISTORY_PHOTO_SLOTS[i];
    const url = photoSrc(p); // кэш миниатюр может быть не прогрет — ставим fallback
    return '<img class="history-photo" data-photo="' + esc(p.id) + '" alt="' + esc(p.title || '') + '"' +
      (url ? ' src="' + esc(url) + '"' : ' data-photo-src="' + esc(p.id) + '"') +
      ' style="' + s.st + 'animation-duration:' + s.dur + 's;animation-delay:' + s.delay + 's" loading="lazy">';
  }).join('');
}
// Делегирование: innerHTML #progressRing перерисовывается на каждом рендере
$('#progressRing').addEventListener('click', e => {
  if (e.target.closest && e.target.closest('#shuffleHistoryBtn')) shuffleHistoryPhotos();
});
$('#progressRing').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('#shuffleHistoryBtn')) {
    e.preventDefault(); shuffleHistoryPhotos();
  }
});

