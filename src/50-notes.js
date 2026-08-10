/* ===== Заметки ===== */
let editingNoteId = null; // id заметки в режиме инлайн-правки (null — не редактируем)
let dragNoteId = null;    // id заметки, которую сейчас перетаскиваем
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

// Перетаскивание заметок — универсальный Pointer Events-движок (05-dnd.js).
// Порядок меняется «вживую»: соседние заметки FLIP-анимацией разъезжаются,
// на дропе пересчитываем order всем заметкам.
function reorderNoteIds(ids, dragId, targetId, after) {
  const from = ids.indexOf(dragId);
  if (from < 0) return ids.slice();
  const out = ids.slice();
  out.splice(from, 1);
  const to = out.indexOf(targetId);
  if (to < 0) return out;
  out.splice(after ? to + 1 : to, 0, dragId);
  return out;
}
uniDragSetup({
  container: $('#notesGrid'),
  itemSel: '.note',
  handleSel: '.note-drag',
  idOf: c => c.dataset.id,
  onStart(st) { dragNoteId = st.id; },
  onDrop(st) {
    // renderNotes() всегда ставит закреплённые сверху — стабильно отсортируем ids
    // по pin до записи order, чтобы DOM после дропа не «перепрыгивал».
    const pinOf = id => { const n = db.notes.find(x => x.id === id); return n && n.pinned ? 0 : 1; };
    const ids = st.ids.slice().sort((a, b) => pinOf(a) - pinOf(b));
    ids.forEach((id, i) => { const n = db.notes.find(x => x.id === id); if (n) n.order = i; });
    save(); renderNotes();
    dragNoteId = null;
  },
  onCancel() { dragNoteId = null; }
});


