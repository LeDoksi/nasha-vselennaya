/* ===== Хранилище ===== */
function legacyDB() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultDB();
    const d = JSON.parse(raw);
    return { ...defaultDB(), ...migrateDB(d) };
  } catch (e) {
    return defaultDB();
  }
}
function loadVault() {
  try {
    return JSON.parse(localStorage.getItem(VAULT_KEY));
  } catch (e) {
    return null;
  }
}
// Сохранение всегда идёт через шифрование; очередь снимков не даёт
// гонке записать более старый снимок поверх свежего. Формат сейфа — просто
// { db: {i,d} }: один общий мастер-ключ на пару (см. src/01-gate.js), без
// пер-пользовательских обёрток паролем, как было раньше.
let saveChain = Promise.resolve();
function save() {
  if (!masterKey) return Promise.resolve();
  const snap = JSON.stringify(db);
  // Ключ берём СЕЙЧАС (не читаем masterKey заново внутри .then): очередь может
  // выполниться позже, когда lock() уже обнулит masterKey — раньше это роняло
  // aesEnc с «2nd argument is not of type CryptoKey» при частых lock/unlock.
  const keyAtCall = masterKey;
  // Цепочка никогда не «падает»: один сбой шифрования отравил бы saveChain, и каждый
  // следующий save() без await давал бы unhandledrejection с ложным тостом при входе.
  saveChain = saveChain.then(async () => {
    if (!keyAtCall) return;
    try {
      const blob = await aesEnc(keyAtCall, enc.encode(snap));
      try {
        localStorage.setItem(VAULT_KEY, JSON.stringify({ db: blob }));
      } catch (e) {
        notify('Хранилище переполнено — удали лишние фото и попробуй ещё раз 💜', true);
      }
      // Облачная синхронизация: после каждого успешного сохранения — push (debounce)
      if (typeof scheduleSyncPush === 'function') scheduleSyncPush();
    } catch (e) {
      console.warn('Не удалось сохранить сейф', e);
      notify('Не удалось сохранить — попробуй ещё раз 💜', true);
    }
  });
  return saveChain;
}

/* ===== Разовая миграция со старого (парольного) сейфа =====
   tryUnwrapKey понадобится ТОЛЬКО пока у кого-то ещё жив старый сейф с
   keys:[...] — см. migrateLegacyVault в src/01-gate.js. Новые сейфы такого
   поля не имеют вовсе. */
async function tryUnwrapKey(who, pass, vault) {
  const wrap = (vault && (vault.keys || [])).find(k => k.who === who);
  if (!wrap) return null;
  try {
    const pwdKey = await pbkdf2Key(pass, unb64(wrap.s), vault.a || PBKDF2_ITERS);
    const kraw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(wrap.i) }, pwdKey, unb64(wrap.d)));
    return await crypto.subtle.importKey('raw', kraw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  } catch (e) {
    return null;
  }
}

/* ===== Замок: экран гейта (см. src/01-gate.js) ===== */
function showAuth(which) {
  $('#gateScreen').hidden = which !== 'gate';
}
function unlockApp() {
  authLocked = false;
  document.body.classList.remove('auth');
  setTheme(getTheme());
  renderSettings();
  go('home');
  lastActivity = Date.now();
  startAutoLock();
  maybeShowDateInvitePopup(); // неотвеченные приглашения на свидание — сразу видно, не только листая вниз
  // Облачная синхронизация: после входа пробуем забрать/отдать данные
  if (typeof initSync === 'function') initSync();
}
// Приватный «замок» по бездействию (см. AUTO_LOCK_MS ниже): прячет данные на
// этом устройстве, но НЕ разлогинивает из Google — сессия жива, возврат
// (gateResume в src/01-gate.js) занимает один тап, без пароля.
function lock() {
  if (!masterKey) return; // уже закрыто
  masterKey = null;
  db = defaultDB();
  clearPhotoStore();
  clearThumbCache();
  countdownTarget = null;
  authLocked = true;
  document.body.classList.add('auth');
  showAuth('gate');
  const migrateWrap = $('#gateMigrateWrap');
  if (migrateWrap) migrateWrap.hidden = true;
  const signInBtn = $('#gateSignInBtn');
  if (signInBtn) signInBtn.hidden = true;
  const resumeBtn = $('#gateResumeBtn');
  if (resumeBtn) resumeBtn.hidden = false;
  const resumeHint = $('#gateResumeHint');
  if (resumeHint) resumeHint.hidden = false;
  showGateErr('');
  // Облачная синхронизация: при блокировке отключаем слушатели (но НЕ
  // Google-сессию — см. stopSync в src/95-sync.js)
  if (typeof stopSync === 'function') stopSync();
}
// Публичный API: сам app.js её не вызывает (UI смотрит на authLocked
// напрямую), но тесты дёргают через s.isLocked — держим как явную точку
// входа для будущего кода/тестов.
// eslint-disable-next-line no-unused-vars
function isLocked() {
  return authLocked;
}

/* ===== Автозамок ===== */
let autoLockTimer = null;
function startAutoLock() {
  if (autoLockTimer) return;
  ['click', 'keydown', 'pointerdown', 'scroll', 'touchstart'].forEach(ev =>
    document.addEventListener(
      ev,
      () => {
        lastActivity = Date.now();
      },
      { passive: true }
    )
  );
  autoLockTimer = setInterval(() => {
    if (isHidden() || !masterKey) return;
    if (Date.now() - lastActivity > AUTO_LOCK_MS) lock();
  }, 60000);
}

/* ===== Кнопка «скрыть приватность» в настройках ===== */
const lockNowBtnEl = $('#lockNowBtn');
if (lockNowBtnEl) lockNowBtnEl.addEventListener('click', lock);
