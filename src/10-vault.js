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
  maybeShowDateInvitePopup(); // неотвеченные приглашения на свидание — сразу видно, не только листая вниз
  // Облако фото (Yandex Object Storage, см. src/95-photos-cloud.js): после
  // входа выгружаем свои фото / скачиваем недостающие. Данные (события,
  // заметки и т.п.) синхронизировать не нужно — они читаются/пишутся прямо
  // в Firestore каждым экраном, отдельного шага при входе не требуют.
  if (typeof initPhotoSync === 'function') initPhotoSync();
}
// Публичный API: сам app.js её не вызывает (UI смотрит на authLocked
// напрямую), но тесты дёргают через s.isLocked — держим как явную точку
// входа для будущего кода/тестов.
// eslint-disable-next-line no-unused-vars
function isLocked() {
  return authLocked;
}
