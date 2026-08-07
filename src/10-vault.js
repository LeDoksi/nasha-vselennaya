/* ===== Хранилище ===== */
function legacyDB() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultDB();
    const d = JSON.parse(raw);
    return { ...defaultDB(), ...migrateDB(d) };
  } catch (e) { return defaultDB(); }
}
function loadVault() {
  try { return JSON.parse(localStorage.getItem(VAULT_KEY)); } catch (e) { return null; }
}
// Сохранение всегда идёт через шифрование; очередь снимков не даёт
// гонке записать более старый снимок поверх свежего.
let saveChain = Promise.resolve();
function save() {
  if (!masterKey) return Promise.resolve();
  const snap = JSON.stringify(db);
  saveChain = saveChain.then(async () => {
    const vault = loadVault();
    if (!vault) return;
    vault.db = await aesEnc(masterKey, enc.encode(snap));
    try { localStorage.setItem(VAULT_KEY, JSON.stringify(vault)); }
    catch (e) { alert('Хранилище переполнено — удали лишние фото и попробуй ещё раз 💜'); }
  });
  return saveChain;
}

/* ===== Создание сейфа, вход, пароли ===== */
async function createVault(who, pass, legacyDb) {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const kraw = new Uint8Array(await crypto.subtle.exportKey('raw', masterKey));
  db = migrateDB({ ...defaultDB(), ...(legacyDb || legacyDB()) });
  const dbBlob = await aesEnc(masterKey, enc.encode(JSON.stringify(db)));
  const salt = randBytes(16);
  const pwdKey = await pbkdf2Key(pass, salt, PBKDF2_ITERS);
  const wrap = { who, s: b64(salt), ...(await aesEnc(pwdKey, kraw)) };
  if (!store.set(VAULT_KEY, JSON.stringify({ ver: 1, a: PBKDF2_ITERS, db: dbBlob, keys: [wrap] }))) return false;
  store.remove(KEY); // старый открытый файл больше не нужен — всё уже зашифровано
  currentUser = who;
  return true;
}
async function unlockWith(who, pass) {
  const vault = loadVault();
  if (!vault) return false;
  const wrap = (vault.keys || []).find(k => k.who === who);
  if (!wrap) return false;
  try {
    const pwdKey = await pbkdf2Key(pass, unb64(wrap.s), vault.a || PBKDF2_ITERS);
    const kraw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(wrap.i) }, pwdKey, unb64(wrap.d)));
        masterKey = await crypto.subtle.importKey('raw', kraw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    currentUser = who;
    const raw = await aesDec(masterKey, vault.db);
    db = migrateDB({ ...defaultDB(), ...JSON.parse(dec.decode(raw)) });
    unlockApp();
    return true;
  } catch (e) { return false; }
}
async function savePassFor(who, pass) {
  const vault = loadVault();
  if (!vault || !masterKey) return false;
  const kraw = new Uint8Array(await crypto.subtle.exportKey('raw', masterKey));
  const salt = randBytes(16);
  const pwdKey = await pbkdf2Key(pass, salt, vault.a || PBKDF2_ITERS);
  const wrap = { who, s: b64(salt), ...(await aesEnc(pwdKey, kraw)) };
  vault.keys = (vault.keys || []).filter(x => x.who !== who).concat(wrap);
  try { localStorage.setItem(VAULT_KEY, JSON.stringify(vault)); return true; } catch (e) { return false; }
}
async function changePass(cur, next) {
  const vault = loadVault();
  if (!vault || !masterKey || !currentUser) return false;
  const wrap = (vault.keys || []).find(k => k.who === currentUser);
  if (!wrap) return false;
  try {
    const pwdKey = await pbkdf2Key(cur, unb64(wrap.s), vault.a || PBKDF2_ITERS);
    const kraw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(wrap.i) }, pwdKey, unb64(wrap.d)));
    const newSalt = randBytes(16);
    const nk = await pbkdf2Key(next, newSalt, vault.a || PBKDF2_ITERS);
    vault.keys = await Promise.all(vault.keys.map(async x => x.who === currentUser ? { who: currentUser, s: b64(newSalt), ...(await aesEnc(nk, kraw)) } : x));
    try { localStorage.setItem(VAULT_KEY, JSON.stringify(vault)); return true; } catch (e) { return false; }
  } catch (e) { return false; }
}

/* ===== Замок: экраны входа и создания ===== */
function showAuth(which) {
  $('#lockScreen').hidden = which !== 'lock';
  $('#setupScreen').hidden = which !== 'setup';
}
function unlockApp() {
  authLocked = false;
  document.body.classList.remove('auth');
  $('#authPass').value = '';
  $('#authErr').textContent = '';
  renderUserChip();
  setTheme(getTheme());
  renderSettings();
  go('home');
  lastActivity = Date.now();
  startAutoLock();
}
function lock() {
  if (!masterKey) return; // уже закрыто
  masterKey = null;
  currentUser = null;
  db = defaultDB();
  countdownTarget = null;
  authLocked = true;
  document.body.classList.add('auth');
  showAuth('lock');
  renderAuthWho();
  $('#authPass').value = '';
  $('#authErr').textContent = '';
}
function isLocked() { return authLocked; }

let pendingAuthWho = 'gosha';
function renderAuthWho() {
  $$('.auth-user').forEach(b => b.classList.toggle('auth-on', b.dataset.authWho === pendingAuthWho));
  const lbl = $('#authWhoLabel');
  if (lbl) lbl.textContent = pendingAuthWho === 'dasha' ? '👧 Даша' : '👦 Гоша';
}
async function tryUnlock() {
  const err = $('#authErr');
  const vault = loadVault();
  const hasPass = !!(vault && (vault.keys || []).some(k => k.who === pendingAuthWho));
  if (!hasPass) {
    if (err) err.textContent = 'Пароль для этого человека ещё не создан. Добавь его в настройках — или войди другим.';
    return;
  }
  const ok = await unlockWith(pendingAuthWho, $('#authPass').value);
  if (!ok && err) err.textContent = 'Неверный пароль. Попробуй ещё раз 💜';
}
async function doSetup() {
  const err = $('#setupErr');
  const who = $('#setupWho').value;
  const p1 = $('#setupPass').value;
  const p2 = $('#setupPass2').value;
  if (p1.length < 6) { if (err) err.textContent = 'Пароль должен быть не короче 6 символов.'; return; }
  if (p1 !== p2) { if (err) err.textContent = 'Пароли не совпадают — проверь ещё раз.'; return; }
  await createVault(who, p1);
  unlockApp();
}

/* ===== Автозамок ===== */
let autoLockTimer = null;
function startAutoLock() {
  if (autoLockTimer) return;
  ['click', 'keydown', 'pointerdown', 'scroll', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
  autoLockTimer = setInterval(() => {
    if (isHidden() || !masterKey) return;
    if (Date.now() - lastActivity > AUTO_LOCK_MS) lock();
  }, 60000);
}

/* ===== Кнопки экранов входа ===== */
$('#authGo').addEventListener('click', tryUnlock);
$('#authPass').addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
$('#setupGo').addEventListener('click', doSetup);
$('#setupPass2').addEventListener('keydown', e => { if (e.key === 'Enter') doSetup(); });
document.addEventListener('click', e => {
  const au = e.target.closest('[data-auth-who]');
  if (au) {
    pendingAuthWho = au.dataset.authWho;
    renderAuthWho();
    const p = $('#authPass');
    if (p && p.focus) p.focus();
    return;
  }
});
renderAuthWho();

