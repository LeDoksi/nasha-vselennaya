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
    <div class="note${n.pinned ? ' pinned' : ''}" data-id="${n.id}" draggable="true">
      <div class="note-top">
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
    : '<p class="cal-tip">Пока пусто. Напиши первую записку! 💌</p>';
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
  if (!card) return;
  startEditNote(card.dataset.id);
});

// drag&drop перестановка: переносим id, на drop пересчитываем order всем заметкам.
// Чистая функция — её легко проверить тестами.
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
// Куда ляжет заметка: над/под карточкой, а если курсор на фоне списка —
// по краю (выше первой / ниже последней).
function noteDropPosition(e) {
  const card = e.target.closest('.note');
  if (card) {
    const r = card.getBoundingClientRect();
    return { id: card.dataset.id, after: e.clientY > r.top + r.height / 2 };
  }
  const cards = $$('.note');
  if (!cards.length) return null;
  const first = cards[0].getBoundingClientRect();
  const last = cards[cards.length - 1].getBoundingClientRect();
  if (e.clientY < first.top + first.height / 2) return { id: cards[0].dataset.id, after: false };
  return { id: cards[cards.length - 1].dataset.id, after: true };
}
$('#notesGrid').addEventListener('dragstart', e => {
  const card = e.target.closest('.note');
  if (!card || e.target.closest('button, textarea, input, a')) { e.preventDefault(); return; }
  dragNoteId = card.dataset.id;
  card.classList.add('dragging');
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragNoteId); }
});
$('#notesGrid').addEventListener('dragenter', e => e.preventDefault());
$('#notesGrid').addEventListener('dragover', e => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; // без этого Chrome отменяет drop
  const pos = noteDropPosition(e);
  $$('.note').forEach(c => c.classList.remove('drop-before', 'drop-after'));
  if (!pos || pos.id === dragNoteId) return;
  const card = $$('.note').find(c => c.dataset.id === pos.id);
  if (card) card.classList.add(pos.after ? 'drop-after' : 'drop-before');
});
$('#notesGrid').addEventListener('drop', e => {
  e.preventDefault();
  if (!dragNoteId) return;
  const pos = noteDropPosition(e);
  if (!pos || pos.id === dragNoteId) { renderNotes(); return; }
  const ids = reorderNoteIds($$('.note').map(c => c.dataset.id), dragNoteId, pos.id, pos.after);
  ids.forEach((id, i) => { const n = db.notes.find(x => x.id === id); if (n) n.order = i; });
  save(); renderNotes();
});
$('#notesGrid').addEventListener('dragend', () => {
  $$('.note').forEach(c => c.classList.remove('dragging', 'drop-before', 'drop-after'));
  dragNoteId = null;
});

