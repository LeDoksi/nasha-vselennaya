/* ===== Экспорт памятных дат в .ics (Фаза 6) =====
   Формат iCalendar (RFC 5545) — импортируется системным календарём телефона
   (Google/Apple/Outlook), там реально приходят напоминания, в отличие от
   db.events, которые живут только внутри этого сайта. Экспортируем db.events
   (памятные даты), НЕ db.dates (свидания) — те эфемернее и не то, что люди
   обычно хотят видеть в системном календаре год за годом.
   Без сворачивания длинных строк (line folding из RFC 5545, 75 октетов) —
   современные календарные приложения (Google/Apple/Outlook) читают
   несвёрнутые строки нормально, а заголовки событий здесь короткие; ловить
   гипотетический экзотический парсер ради этого не стоило усложнения. */
function icsPad2(n) {
  return String(n).padStart(2, '0');
}
function icsDateStamp(dateStr) {
  return dateStr.replace(/-/g, '');
}
// DTEND в VEVENT с VALUE=DATE — «до» (эксклюзивно), поэтому конец
// однодневного/многодневного события — следующий день после endDate/date.
function icsDateStampNextDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return dt.getFullYear() + icsPad2(dt.getMonth() + 1) + icsPad2(dt.getDate());
}
function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
function buildEventsIcs() {
  const now = new Date();
  const stamp =
    now.getUTCFullYear() + icsPad2(now.getUTCMonth() + 1) + icsPad2(now.getUTCDate()) + 'T' + icsPad2(now.getUTCHours()) + icsPad2(now.getUTCMinutes()) + icsPad2(now.getUTCSeconds()) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//nasha-vselennaya//ru', 'CALSCALE:GREGORIAN'];
  for (const ev of db.events || []) {
    if (!ev.date) continue;
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + ev.id + '@nasha-vselennaya');
    lines.push('DTSTAMP:' + stamp);
    lines.push('DTSTART;VALUE=DATE:' + icsDateStamp(ev.date));
    lines.push('DTEND;VALUE=DATE:' + icsDateStampNextDay(ev.endDate || ev.date));
    if (ev.repeat) lines.push('RRULE:FREQ=YEARLY');
    lines.push('SUMMARY:' + icsEscape((ev.emoji ? ev.emoji + ' ' : '') + ev.title));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
function exportEventsIcs() {
  if (!db.events || !db.events.length) {
    alert('Пока нет ни одной памятной даты — нечего экспортировать 💜');
    return;
  }
  const blob = new Blob([buildEventsIcs()], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nasha-vselennaya-daty.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const exportIcsBtnEl = $('#exportIcsBtn');
if (exportIcsBtnEl) exportIcsBtnEl.addEventListener('click', exportEventsIcs);
