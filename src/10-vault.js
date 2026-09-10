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
// Читает старый зашифрованный сейф (universe_vault) — только на чтение.
// Раньше сюда же писал save() на каждое изменение (и его закреплял push
// блоб-синхронизации), но с переходом на Firestore как источник правды
// (каждый экран пишет точечно через репозиторий, см. src/04-repo.js) запись
// сюда убрана целиком — незачем. Само чтение остаётся: разовый перенос
// данных пары (src/06-migrate.js, вызывается из unlockWithKey в
// src/01-gate.js) читает отсюда старый сейф ровно один раз.
function loadVault() {
  try {
    return JSON.parse(localStorage.getItem(VAULT_KEY));
  } catch (e) {
    return null;
  }
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
  // Облако фото (Yandex Object Storage, см. src/95-photos-cloud.js): после
  // входа выгружаем свои фото / скачиваем недостающие. Данные (события,
  // заметки и т.п.) синхронизировать не нужно — они читаются/пишутся прямо
  // в Firestore каждым экраном, отдельного шага при входе не требуют.
  if (typeof initPhotoSync === 'function') initPhotoSync();
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
  // Облако фото: при блокировке отключаем таймер сверки (но НЕ Google-сессию —
  // см. stopPhotoSync в src/95-photos-cloud.js)
  if (typeof stopPhotoSync === 'function') stopPhotoSync();
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
