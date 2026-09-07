/* ===== Летающие сердечки ===== */
function spawnHeart() {
  if (motionReduced()) return; // анимации отключены — сердечки не запускаем
  const h = document.createElement('span');
  h.className = 'heart';
  h.textContent = ['💜', '💖', '💕', '🌸', '✨'][Math.floor(Math.random() * 5)];
  h.style.left = Math.random() * 100 + 'vw';
  h.style.fontSize = 12 + Math.random() * 16 + 'px';
  h.style.animationDuration = 6 + Math.random() * 6 + 's';
  document.body.appendChild(h);
  setTimeout(() => h.remove(), 12000);
}

$('#themeToggle').addEventListener('click', toggleTheme);
$('#settingsThemeBtn').addEventListener('click', toggleTheme);

setInterval(() => {
  // сердечки летают не слишком часто, не под замком и не во время открытых модалок
  if (isHidden() || authLocked) return;
  if (document.querySelector('.overlay:not([hidden])')) return;
  if (!$('#view-home') || !$('#view-home').classList.contains('active')) return;
  spawnHeart();
}, 3800);
// Коллаж «Наша история» стабилен в течение дня — обновлять его не нужно.
spawnHeart();
