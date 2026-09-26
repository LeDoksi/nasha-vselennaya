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
  openOverlay('eventOverlay');
  $('#evTitle').focus();
}
$('#evPhoto').addEventListener('change', async e => {
  const files = [...e.target.files].slice(0, 5);
  for (const f of files) {
    try {
      evPhotoData.push({ data: await readFile(f), file: f });
    } catch (err) {
      console.warn('Не удалось прочитать фото события', err);
    }
  }
  e.target.value = '';
  setEvPhotoCount();
});
// Долгое событие не повторяется каждый год — снимаем галочку автоматически
$('#evEnd').addEventListener('input', () => {
  if ($('#evEnd').value) $('#evRepeat').checked = false;
});
function saveEventFromModal() {
  const title = $('#evTitle').value.trim();
  const date = $('#evDate').value;
  if (!title || !date) {
    alert('Напиши название и выбери дату 💜');
    return;
  }
  const endDate = $('#evEnd').value || null;
  if (endDate && endDate < date) {
    alert('Конец события не может быть раньше начала 💜');
    return;
  }
  const data = { title, date, endDate, emoji: $('#evEmoji').value.trim() || '💜', repeat: $('#evRepeat').checked && !endDate };
  // Фото события: кладём в общую галерею и вешаем лейбл = названию события
  if (evPhotoData.length) {
    const ids = addEventPhotosToGallery(evPhotoData, title);
    data.photos = ids.length ? ids : evPhotoData.map(x => (x && typeof x === 'object' ? x.data : x));
  }
  const ev = editingEventId ? db.events.find(x => x.id === editingEventId) : null;
  let savedEv;
  if (ev) {
    if (ev.photos && !evPhotoData.length) delete ev.photos;
    Object.assign(ev, data);
    savedEv = ev;
  } else {
    // Если редактируемое событие не найдено (например, удалено в другой вкладке) —
    // создаём новое, чтобы пользовательские данные не терялись молча.
    savedEv = { id: uid(), ...data };
    db.events.push(savedEv);
  }
  // md ставим при каждом сохранении, а не только при создании: пользователь
  // мог поправить дату у уже существующей годовщины.
  savedEv.md = mdOf(savedEv.date);
  // Переходим на месяц события, чтобы оно сразу появилось в календаре
  const [evY, evM] = date.split('-').map(Number);
  calM = evM - 1;
  calY = evY;
  selectedDate = date;
  editingEventId = null;
  repoSet('events', savedEv);
  // repoSet выше пишет только сам документ события — метаданные свежих фото
  // (evPhotoData) addEventPhotosToGallery() уже сохранила сама через
  // repoSet('photos', ...) для каждого задетого фото.
  closeOverlay('eventOverlay');
  renderCalendar();
  renderHome();
  loadCalMonthNeighbors();
}
$('#evSave').addEventListener('click', saveEventFromModal);
