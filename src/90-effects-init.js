/* ===== Летающие сердечки ===== */
function spawnHeart() {
  if (motionReduced()) return; // анимации отключены — сердечки не запускаем
  const h = document.createElement('span');
  h.className = 'heart';
  h.textContent = ['💜', '💖', '💕', '🌸', '✨'][Math.floor(Math.random() * 5)];
  h.style.left = Math.random() * 100 + 'vw';
  h.style.fontSize = (12 + Math.random() * 16) + 'px';
  h.style.animationDuration = (6 + Math.random() * 6) + 's';
  document.body.appendChild(h);
  setTimeout(() => h.remove(), 12000);
}

$('#themeToggle').addEventListener('click', toggleTheme);
$('#settingsThemeBtn').addEventListener('click', toggleTheme);

/* ===== Запуск: приложение закрыто, пока не вошли ===== */
async function initAuth() {
  initPhotoStore(); // открываем IndexedDB (или fallback) до первого входа
  renderUserChip();
  setTheme(getTheme());
  applyMotion(getMotion());
  lastActivity = Date.now();
  startAutoLock();
  document.body.classList.add('auth');
  if (loadVault()) {
    showAuth('lock'); // сейф есть → вход
  } else {
    // Первый запуск: сначала проверяем, нет ли сейфа пары в облаке (например,
    // на этом же устройстве очистили localStorage, или новый браузер). Если есть —
    // показываем вход с подсказкой, а не экран «создать пароль»: иначе создание
    // второго сейфа затёрло бы облачный.
    showAuth('setup');
  }
  // Сейф пары в облаке ищем ВСЕГДА (и когда локальный уже есть): если в облаке
  // лежит ДРУГОЙ сейф, пароль облачного сейфа должен восстановить облачные
  // данные, а не открыть устаревший локальный. pendingCloudVault даёт входу
  // второй вариант, hint объясняет пользователю, что происходит.
  const cloud = await fetchCloudVault();
  if (cloud && cloud.vault) {
    pendingCloudVault = cloud.vault;
    showAuth('lock');
    if (loadVault()) {
      // Локальный сейф есть + облачный отдельный: вход паролем облачного сейфа
      // вернёт облачные данные (см. cloudHint2 в index.html).
      $('#cloudHint2').hidden = false;
    } else {
      $('#cloudHint').hidden = false;
    }
    $('#authPass').focus();
  }
  pendingAuthWho = 'gosha';
  renderAuthWho();
  // Если JS по какой-то причине не выполнится — контент так и останется скрытым
  // (body.auth прячет шапку и main), никто ничего не увидит.
}
// Вызов initAuth() стоит в конце 95-sync.js (самый последний модуль сборки):
// initAuth читает FIREBASE_CONFIG (let из 95-sync.js), а он ещё в «мёртвой зоне»
// во время выполнения 90-effects-init.js.
// Клик по чипу «Гоша ▾ / Даша ▾» = заблокировать и дать войти другому
$('#userChip').addEventListener('click', lock);

setInterval(() => {
  // сердечки летают не слишком часто, не под замком и не во время открытых модалок
  if (isHidden() || authLocked) return;
  if (document.querySelector('.overlay:not([hidden])')) return;
  if (!$('#view-home') || !$('#view-home').classList.contains('active')) return;
  spawnHeart();
}, 3800);
// Коллаж «Наша история» стабилен в течение дня — обновлять его не нужно.
spawnHeart();




