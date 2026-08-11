/* ===== Заметки ===== */
let editingNoteId = null; // id заметки в режиме инлайн-правки (null — не редактируем)
function noteAuthorName(n) {
  return n.author === 'dasha' ? '👧 Даша' : n.author === 'gosha' ? '👦 Гоша' : '💜 Наши';
}
function renderNotes() {
  const list = [...db.notes].sort((a, b) =>
    (b.pinned - a.pinned) || ((a.order ?? 1e9) - (b.order ?? 1e9)) || (b.ts - a.ts));
  $('#notesGrid').innerHTML = list.length ? list.map(n => `
    <div class="note${n.pinned ? ' pinned' : ''}" data-id="${n.id}">
      <div class="note-top">
        <button class="drag-handle note-drag" data-note-drag="${n.id}" title="Перетащить">⠿</button>
        <button class="mini-x" data-pin-note="${n.id}" title="${n.pinned ? 'Открепить' : 'Закрепить'}">${n.pinned ? '📌' : '📍'}</button>
        <span class="note-author">${noteAuthorName(n)}</span>
        <span class="note-date">${new Date(n.ts).toLocaleDateString('ru-RU')}</span>
        <button class="mini-x" data-edit-note="${n.id}" title="Редактировать">✏️</button>
        <button class="mini-x" data-del-note="${n.id}" title="Удалить">✕</button>
      </div>
      ${editingNoteId === n.id
        ? `<div class="note-edit">
             <textarea id="noteEdit-${n.id}" class="note-editor">${esc(n.text)}</textarea>
             <div class="note-edit-btns">
               <button class="btn btn-sm" data-save-note="${n.id}">💜 Сохранить</button>
               <button class="mini-x" data-cancel-note title="Отмена">✕</button>
             </div>
           </div>`
        : `<p>${esc(n.text)}</p>`}
    </div>`).join('')
    : '<div class="empty-state">Пока пусто. Напиши первую записку! 💌</div>';
}
function addNote() {
  const t = $('#noteText').value.trim();
  if (!t) return;
  db.notes.unshift({ id: uid(), text: t, ts: Date.now(), pinned: false, author: getUser(), order: 0 });
  save(); $('#noteText').value = ''; renderNotes();
}
$('#noteAddBtn').addEventListener('click', addNote);
$('#noteText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addNote(); });

// Закрепить/удалить может любой — отдельные функции, вызываются по клику ✕/📍
function togglePinNote(id) {
  const n = db.notes.find(x => x.id === id);
  if (!n) return;
  n.pinned = !n.pinned; save(); renderNotes();
}
function deleteNote(id) {
  if (!confirmDelete('Удалить заметку? Это не отменить.')) return;
  db.notes = db.notes.filter(x => x.id !== id);
  if (editingNoteId === id) editingNoteId = null;
  save(); renderNotes();
}

// Редактирование: ✏️, двойной клик по карточке, Ctrl+Enter в редакторе
function startEditNote(id) { editingNoteId = id; renderNotes(); }
function cancelNoteEdit() { editingNoteId = null; renderNotes(); }
function saveNoteEdit(id, text) {
  const n = db.notes.find(x => x.id === id);
  if (!n) return;
  const ta = $('#noteEdit-' + id);
  const t = (text !== undefined ? text : (ta && ta.value) || '').trim();
  if (t) { n.text = t; n.ts = Date.now(); }
  editingNoteId = null; save(); renderNotes();
}
$('#notesGrid').addEventListener('dblclick', e => {
  const card = e.target.closest('.note');
  if (!card || e.target.closest('.drag-handle')) return; // ручка — не повод редактировать
  startEditNote(card.dataset.id);
});

// Перетаскивание заметок — SortableJS (forceFallback: нативный HTML5 DnD не
// поддерживает тач, а телефон — основной сценарий этого сайта). На дропе
// пересчитываем order всем заметкам; renderNotes() всегда ставит закреплённые
// сверху — стабильно отсортируем итоговый DOM-порядок по pin, чтобы список не
// «перепрыгивал» сразу после перерисовки.
function notesSortEnd(evt) {
  const ids = [...evt.to.children]
    .filter(c => c.classList && c.classList.contains('note'))
    .map(c => c.dataset.id);
  const pinOf = id => { const n = db.notes.find(x => x.id === id); return n && n.pinned ? 0 : 1; };
  ids.sort((a, b) => pinOf(a) - pinOf(b))
    .forEach((id, i) => { const n = db.notes.find(x => x.id === id); if (n) n.order = i; });
  save(); renderNotes();
}
if (typeof Sortable !== 'undefined') {
  Sortable.create($('#notesGrid'), {
    handle: '.note-drag', forceFallback: true, fallbackOnBody: true, animation: 150,
    scroll: true, scrollSensitivity: 80, scrollSpeed: 20,
    onEnd: notesSortEnd
  });
}


