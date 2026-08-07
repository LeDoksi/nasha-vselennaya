/* ===== Песня ===== */
$('#songAudio').addEventListener('error', () => {
  $('#songHint').textContent = 'Файл пока не найден. Положи mp3 в папку music/ с именем nasha-pesnya.mp3 — и нажми ▶';
});
$('#songAudio').addEventListener('canplay', () => {
  $('#songHint').textContent = '▶ Нажми play — и заиграет наша песня! 💜';
});

/* ===== Настройки ===== */
/* ===== Настройки: резервная копия и место в браузере ===== */
function renderSettings() {
  const bytes = new Blob([JSON.stringify(db)]).size || JSON.stringify(db).length;
  const kb = Math.max(1, Math.round(bytes / 1024));
  const si = $('#storageInfo');
  if (si) si.textContent = kb >= 1024 ? (kb / 1024).toFixed(1) + ' МБ' : kb + ' КБ';
  const hint = $('#backupHint');
  if (!hint) return;
  if (!db.backupDate) {
    hint.innerHTML = '<span style="color:#d97706;font-weight:700;font-size:14px">⚠️ Резервная копия ещё не делалась. Нажми «Скачать копию» — так ничего не потеряется.</span>';
  } else {
    const days = Math.floor((Date.now() - db.backupDate) / 86400000);
    hint.innerHTML = days >= 30
      ? `<span style="color:#d97706;font-weight:700;font-size:14px">⚠️ Последняя копия была ${days} дн. назад. Самое время обновить её.</span>`
      : `<span style="color:#059669;font-weight:700;font-size:14px">✅ Копия сделана ${days === 0 ? 'сегодня' : days + ' дн. назад'}. Всё под защитой.</span>`;
  }
  // Личный кабинет: кто вошёл, чьи пароли есть
  const lkUser = $('#lkUser');
  if (lkUser) lkUser.textContent = getUser() === 'dasha' ? '👧 Даша' : '👦 Гоша';
  const vault = loadVault();
  const hasPass = who => !!(vault && (vault.keys || []).some(k => k.who === who));
  const info = $('#lkPassInfo');
  if (info) info.innerHTML =
    `<span><b>Гоша:</b> ${hasPass('gosha') ? '<span style="color:#059669;font-weight:700">✅ пароль есть</span>' : '<span style="color:var(--muted)">пароля нет</span>'}</span>` +
    `<span><b>Даша:</b> ${hasPass('dasha') ? '<span style="color:#059669;font-weight:700">✅ пароль есть</span>' : '<span style="color:var(--muted)">пароля нет</span>'}</span>`;
  const addBtn = $('#addPassBtn');
  if (addBtn) addBtn.style.display = (hasPass('gosha') && hasPass('dasha')) ? 'none' : '';
}
// Экспорт — зашифрованный сейф: без пароля файл не прочитать
async function exportData() {
  db.backupDate = Date.now();
  await save();
  const vault = loadVault();
  const blob = new Blob([JSON.stringify(vault, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nasha-vselennaya-backup-encrypted.json';
  a.click();
  URL.revokeObjectURL(a.href);
  renderSettings();
  return vault;
}
$('#exportBtn').addEventListener('click', () => { exportData(); });
function importData(text) {
  try {
    const d = JSON.parse(text);
    if (d && d.ver && d.db && Array.isArray(d.keys)) {
      // это зашифрованный сейф — просто восстанавливаем, войти можно своим паролем
      store.set(VAULT_KEY, JSON.stringify(d));
      return true;
    }
    // старый открытый бэкап — сразу шифруем текущим ключом
    db = migrateDB({ ...defaultDB(), ...d });
    save();
    return true;
  } catch (err) { return null; }
}
$('#importInput').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    if (!importData(fr.result)) { alert('Не получилось прочитать файл:('); return; }
    e.target.value = '';
    location.reload();
  };
  fr.readAsText(f);
});
$('#resetBtn').addEventListener('click', () => {
  if (confirm('Точно удалить ВСЕ данные? Это не отменить.')) {
    store.remove(VAULT_KEY);
    store.remove(KEY);
    location.reload();
  }
});

/* ===== Личный кабинет: смена пароля и пароль для партнёра ===== */
let passMode = 'set'; // 'set' — пароль для партнёра, 'change' — сменить свой
function openPassModal(mode) {
  passMode = mode;
  const whoSel = $('#passWho');
  if (whoSel) {
    whoSel.innerHTML = ['gosha', 'dasha']
      .filter(w => w !== getUser())
      .map(w => `<option value="${w}">${w === 'dasha' ? '👧 Даша' : '👦 Гоша'}</option>`)
      .join('');
  }
  $('#passWhoWrap').hidden = mode !== 'set';
  $('#passCurWrap').hidden = mode !== 'change';
  $('#passTitle').textContent = mode === 'change' ? '🔑 Сменить свой пароль' : '🔑 Пароль для партнёра';
  $('#passCur').value = '';
  $('#passNew').value = '';
  $('#passNew2').value = '';
  $('#passErr').textContent = '';
  $('#passOverlay').hidden = false;
  const first = mode === 'change' ? $('#passCur') : $('#passNew');
  if (first && first.focus) first.focus();
}
async function savePass() {
  const err = $('#passErr');
  const p1 = $('#passNew').value;
  const p2 = $('#passNew2').value;
  if (p1.length < 6) { if (err) err.textContent = 'Пароль должен быть не короче 6 символов.'; return; }
  if (p1 !== p2) { if (err) err.textContent = 'Пароли не совпадают — проверь ещё раз.'; return; }
  let ok;
  if (passMode === 'change') ok = await changePass($('#passCur').value, p1);
  else ok = await savePassFor($('#passWho').value, p1);
  if (!ok) { if (err) err.textContent = 'Не получилось. Проверь текущий пароль и попробуй ещё раз.'; return; }
  $('#passOverlay').hidden = true;
  renderSettings();
  if (passMode === 'change') alert('Пароль обновлён 💜');
  else {
    const who = $('#passWho').value === 'dasha' ? 'Даша' : 'Гоша';
    alert('Пароль сохранён — теперь «' + who + '» может войти 💜');
  }
}
$('#passSave').addEventListener('click', savePass);
$('#changePassBtn').addEventListener('click', () => openPassModal('change'));
$('#addPassBtn').addEventListener('click', () => openPassModal('set'));
$('#lockNowBtn').addEventListener('click', lock);

/* ===== Настройки: уменьшенное движение =====
   data-motion на <html>: 'reduced' — анимации всегда выключены, 'full' — всегда
   включены (перекрывает систему). Без атрибута — уважаем prefers-reduced-motion. */
const MOTION_KEY = 'universe_motion';
function getMotion() {
  const v = store.get(MOTION_KEY);
  return (v === 'reduced' || v === 'full') ? v : null;
}
function applyMotion(m) {
  const doc = document.documentElement;
  if (!doc || !doc.dataset) return;
  if (m === 'reduced' || m === 'full') doc.dataset.motion = m;
  else {
    try { doc.removeAttribute('data-motion'); } catch (e) {}
    try { delete doc.dataset.motion; } catch (e) {}
  }
  const t = $('#motionToggle');
  if (t) t.checked = (m === 'reduced');
}
function setMotion(m) {
  const v = m === 'reduced' ? 'reduced' : 'full';
  store.set(MOTION_KEY, v);
  applyMotion(v);
}
function motionReduced() {
  const doc = document.documentElement;
  if (doc && doc.dataset) {
    if (doc.dataset.motion === 'reduced') return true;
    if (doc.dataset.motion === 'full') return false;
  }
  try {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  } catch (e) {}
  return false;
}
const mt = $('#motionToggle');
if (mt) mt.addEventListener('change', e => setMotion(e.target.checked ? 'reduced' : 'full'));

