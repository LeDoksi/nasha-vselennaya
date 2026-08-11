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
  // Цепочка никогда не «падает»: один сбой шифрования отравил бы saveChain, и каждый
  // следующий save() без await давал бы unhandledrejection с ложным тостом при входе.
  saveChain = saveChain.then(async () => {
    try {
      const vault = loadVault();
      if (!vault) return;
      vault.db = await aesEnc(masterKey, enc.encode(snap));
      try { localStorage.setItem(VAULT_KEY, JSON.stringify(vault)); }
      catch (e) { notify('Хранилище переполнено — удали лишние фото и попробуй ещё раз 💜', true); }
      // Облачная синхронизация: после каждого успешного сохранения — push (debounce)
      if (typeof scheduleSyncPush === 'function') scheduleSyncPush();
    } catch (e) {
      console.warn('Не удалось сохранить сейф', e);
      notify('Не удалось сохранить — попробуй ещё раз 💜', true);
    }
  });
  return saveChain;
}

/* ===== Создание сейфа, вход, пароли ===== */
async function createVault(who, pass, legacyDb) {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const kraw = new Uint8Array(await crypto.subtle.exportKey('raw', masterKey));
  db = migrateDB({ ...defaultDB(), ...(legacyDb || legacyDB()) });
  await initPhotoStore(); // гарантируем бэкенд (в тестах — память)
  await photoStore.migratePhotos(db);
  await photoStore.refreshSizes();
  warmThumbCache(); // миниатюры в кэш — галерея рендерится без ожидания
  const dbBlob = await aesEnc(masterKey, enc.encode(JSON.stringify(db)));
  const salt = randBytes(16);
  const pwdKey = await pbkdf2Key(pass, salt, PBKDF2_ITERS);
  const wrap = { who, s: b64(salt), ...(await aesEnc(pwdKey, kraw)) };
  if (!store.set(VAULT_KEY, JSON.stringify({ ver: 1, a: PBKDF2_ITERS, db: dbBlob, keys: [wrap] }))) return false;
  store.remove(KEY); // старый открытый файл больше не нужен — всё уже зашифровано
  currentUser = who;
  return true;
}
// Пробует вытащить мастер-ключ сейфа паролем БЕЗ побочных эффектов: не трогает
// masterKey, db и VAULT_KEY. Возвращает CryptoKey или null (нет записи для who,
// неверный пароль, повреждённая обёртка).
async function tryUnwrapKey(who, pass, vault) {
  const wrap = (vault && (vault.keys || [])).find(k => k.who === who);
  if (!wrap) return null;
  try {
    const pwdKey = await pbkdf2Key(pass, unb64(wrap.s), vault.a || PBKDF2_ITERS);
    const kraw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(wrap.i) }, pwdKey, unb64(wrap.d)));
    return await crypto.subtle.importKey('raw', kraw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  } catch (e) { return null; }
}

async function unlockWith(who, pass, vaultOverride) {
  const vault = vaultOverride || loadVault();
  const key = await tryUnwrapKey(who, pass, vault);
  if (!key) return false;
  try {
    masterKey = key;
    currentUser = who;
    const raw = await aesDec(masterKey, vault.db);
    db = migrateDB({ ...defaultDB(), ...JSON.parse(dec.decode(raw)) });
    await initPhotoStore(); // гарантируем бэкенд (в тестах — память)
    await photoStore.migratePhotos(db);
    await photoStore.refreshSizes();
    warmThumbCache(); // миниатюры в кэш — галерея рендерится без ожидания
    if (vaultOverride) {
      // Вход по облачному сейфу (новый браузер / восстановление): забираем его
      // себе — дальше он живёт на устройстве, а фото докачаются из облака.
      // Если на устройстве оставался ДРУГОЙ сейф — кладём его в резервную
      // копию (universe_vault_prev), чтобы ничего не пропало безвозвратно.
      const prevLocal = loadVault();
      if (prevLocal && JSON.stringify(prevLocal) !== JSON.stringify(vaultOverride)) {
        try { localStorage.setItem(VAULT_KEY_PREV, JSON.stringify(prevLocal)); } catch (e) { console.warn('Не удалось сохранить бэкап сейфа', e); }
      }
      if (!store.set(VAULT_KEY, JSON.stringify(vaultOverride))) return false;
      pendingCloudVault = null;
      notify('Сейф восстановлен из облака 💜');
    }
    try { await save(); } catch (e) { console.warn('Не удалось закрепить миграцию', e); } // p.data убран, ссылки событий на id
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
  setTheme(getTheme());
  renderSettings();
  go('home');
  lastActivity = Date.now();
  startAutoLock();
  // Облачная синхронизация: после входа пробуем забрать/отдать данные
  if (typeof initSync === 'function') initSync();
}
function lock() {
  if (!masterKey) return; // уже закрыто
  masterKey = null;
  currentUser = null;
  db = defaultDB();
  clearPhotoStore();
  clearThumbCache();
  countdownTarget = null;
  authLocked = true;
  document.body.classList.add('auth');
  showAuth('lock');
  renderAuthWho();
  $('#authPass').value = '';
  $('#authErr').textContent = '';
  // Облачная синхронизация: при блокировке отключаем слушатели и вход
  if (typeof stopSync === 'function') stopSync();
}
function isLocked() { return authLocked; }

let pendingAuthWho = 'gosha';
// Сейф, найденный в облаке до входа. Может быть «вторым» сейфом (на устройстве
// остался локальный сейф с другим паролем). tryUnlock проверяет пароль и по
// локальному, и по облачному сейфу: если пароль открывает облачный — он
// «усыновляется» (см. unlockWith), и облачные данные приходят на устройство.
let pendingCloudVault = null;
function renderAuthWho() {
  $$('.auth-user').forEach(b => b.classList.toggle('auth-on', b.dataset.authWho === pendingAuthWho));
  const lbl = $('#authWhoLabel');
  if (lbl) lbl.textContent = pendingAuthWho === 'dasha' ? '👧 Даша' : '👦 Гоша';
}
async function tryUnlock() {
  const err = $('#authErr');
  let local = loadVault();
  let cloud = pendingCloudVault;
  if (!local && !cloud && typeof fetchCloudVault === 'function') {
    // Облако могли ещё не успеть проверить (медленная сеть на телефоне) —
    // пробуем ещё раз до того, как сказать «сейф не найден».
    if (err) err.textContent = 'Проверяем облако ещё раз…';
    const fresh = await fetchCloudVault();
    cloud = fresh ? fresh.vault : null;
    if (cloud) { pendingCloudVault = cloud; const hint = $('#cloudHint'); if (hint) hint.hidden = false; }
  }
  if (!local && !cloud) {
    if (err) err.textContent = 'Сейф не найден ни на устройстве, ни в облаке. Проверь интернет и нажми «Войти» ещё раз, либо создай новый пароль.';
    return;
  }
  const hasPass = !!((local && (local.keys || []).some(k => k.who === pendingAuthWho)) ||
                    (cloud && (cloud.keys || []).some(k => k.who === pendingAuthWho)));
  if (!hasPass) {
    if (err) err.textContent = 'Пароль для этого человека ещё не создан. Добавь его в настройках — или войди другим.';
    return;
  }
  const pass = $('#authPass').value;
  if (!pass) { if (err) err.textContent = 'Введи пароль 💜'; return; }
  // Проверяем пароль СРАЗУ против обоих сейфов (без побочных эффектов) и решаем,
  // каким входим:
  //  • локальный не открылся, а облачный открылся      → облачный (новый браузер)
  //  • открылись оба, но это РАЗНЫЕ сейфы (облачный не
  //    расшифровывается ключом локального)             → облачный: введён пароль
  //                                                     облачного сейфа — нужны
  //                                                     облачные данные
  //  • открылись оба, одна линия (тот же мастер-ключ)  → локальный: облачная
  //                                                     копия — та же линия,
  //                                                     не теряем свежие правки
  //  • открылся только локальный                       → локальный (обычный вход)
  const localKey = local ? await tryUnwrapKey(pendingAuthWho, pass, local) : null;
  const cloudKey = cloud ? await tryUnwrapKey(pendingAuthWho, pass, cloud) : null;
  let useCloud = false;
  if (!localKey && cloudKey) {
    useCloud = true;
  } else if (localKey && cloudKey) {
    let sameLineage = false;
    try { await aesDec(localKey, cloud.db); sameLineage = true; } catch (e) {}
    useCloud = !sameLineage;
  }
  const ok = await unlockWith(pendingAuthWho, pass, useCloud ? cloud : undefined);
  if (!ok && err) err.textContent = 'Неверный пароль. Попробуй ещё раз 💜';
}
async function doSetup() {
  const err = $('#setupErr');
  // Если в облаке уже есть сейф, а на устройстве его нет — не плодим второй:
  // ведём на экран входа, там сейф восстановится по паролю.
  if (pendingCloudVault && !loadVault()) {
    showAuth('lock');
    $('#cloudHint').hidden = false;
    return;
  }
  const who = $('#setupWho').value;
  const p1 = $('#setupPass').value;
  const p2 = $('#setupPass2').value;
  if (p1.length < 6) { if (err) err.textContent = 'Пароль должен быть не короче 6 символов.'; return; }
  if (p1 !== p2) { if (err) err.textContent = 'Пароли не совпадают — проверь ещё раз.'; return; }
  try {
    await createVault(who, p1);
    unlockApp();
  } catch (e) {
    // createVault может упасть (нет WebCrypto/IndexedDB) — понятная ошибка на экране,
    // а не «unhandledrejection» с тостом «Не удалось сохранить» при создании сейфа.
    console.warn('Не удалось создать сейф', e);
    if (err) err.textContent = 'Не удалось создать сейф. Обнови страницу и попробуй ещё раз 💜';
  }
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
// «У меня уже есть сейф» на экране первого запуска: переходим на вход и
// пробуем ещё раз найти сейф в облаке (сетевой запрос мог не успеть).
const setupToLockEl = $('#setupToLock');
if (setupToLockEl) setupToLockEl.addEventListener('click', async () => {
  showAuth('lock');
  $('#authErr').textContent = '';
  const cloud = typeof fetchCloudVault === 'function' ? await fetchCloudVault() : null;
  pendingCloudVault = cloud ? cloud.vault : null;
  const hint = $('#cloudHint');
  if (hint) hint.hidden = !cloud;
  if (cloud) $('#authPass').focus();
});
// «Повторить проверку облака» — когда первый запрос не нашёл сейф (сеть могла
// моргнуть, анонимный вход не успел).
const cloudRetryBtnEl = $('#cloudRetryBtn');
if (cloudRetryBtnEl) cloudRetryBtnEl.addEventListener('click', async () => {
  const btn = $('#cloudRetryBtn');
  if (btn) btn.disabled = true;
  $('#authErr').textContent = 'Проверяем облако…';
  const cloud = typeof fetchCloudVault === 'function' ? await fetchCloudVault() : null;
  if (btn) btn.disabled = false;
  if (cloud && cloud.vault) {
    pendingCloudVault = cloud.vault;
    $('#cloudHint').hidden = false;
    $('#cloudRetryBtn').hidden = true;
    $('#toSetupBtn').hidden = true;
    $('#authErr').textContent = '';
    $('#authPass').focus();
  } else {
    $('#authErr').textContent = 'Всё ещё не можем связаться с облаком. Проверь интернет и попробуй ещё раз, либо создай новый сейф.';
  }
});
// «Создать новый сейф» — осознанный выбор для настоящего первого запуска.
const toSetupBtnEl = $('#toSetupBtn');
if (toSetupBtnEl) toSetupBtnEl.addEventListener('click', () => showAuth('setup'));
// «Забыть сейф на этом устройстве» — восстановление после случайного второго
// сейфа (телефон «создал свой пароль» вместо входа): стираем локальный сейф и
// фото этого устройства, и при следующем открытии приложение снова найдёт общий
// сейф пары в облаке. Облачные данные при этом не трогаются.
const forgetVaultBtnEl = $('#forgetVaultBtn');
if (forgetVaultBtnEl) forgetVaultBtnEl.addEventListener('click', async () => {
  const msg = pendingCloudVault
    ? 'Забыть сейф и фото на ЭТОМ устройстве? Облачные данные пары не пострадают — при следующем входе они восстановятся.'
    : 'Сбросить это устройство к «первому запуску»? Локальный сейф и фото будут удалены с ЭТОГО устройства.';
  if (!confirm(msg)) return;
  try { localStorage.removeItem(VAULT_KEY); } catch (e) {}
  try { localStorage.removeItem(VAULT_KEY_PREV); } catch (e) {}
  try { localStorage.removeItem(SYNC_KEY); } catch (e) {}
  try { localStorage.removeItem(KEY); } catch (e) {}
  if (photoStore && typeof photoStore.clear === 'function') {
    try { await photoStore.clear(); } catch (e) {}
  }
  clearThumbCache();
  location.reload();
});
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

