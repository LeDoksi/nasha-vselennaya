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
  setTheme(getTheme());
  applyMotion(getMotion());
  lastActivity = Date.now();
  startAutoLock();
  // «Запомнить меня» на время вкладки: ключ, переживший обновление страницы —
  // пробуем войти им сразу, без экрана логина. Не получилось (закрывали
  // вкладку/браузер, сейф сменился и т.п.) — обычный вход ниже.
  if (await resumeSession()) return;
  document.body.classList.add('auth');
  pendingAuthWho = 'gosha';
  renderAuthWho();
  const hasLocal = !!loadVault();
  // Всегда открываем ЗАМОК (вход), а не экран «создать пароль». Экран создания —
  // только по явной кнопке или когда облако проверено и сейфа там точно нет.
  // Раньше «создать пароль» показывался сразу на свежем устройстве, и если облако
  // отвечало медленно (мобильный интернет), телефон предлагал завести ВТОРОЙ сейф
  // вместо входа в существующий — так появились «фото, зашифрованные другим паролем».
  showAuth('lock');
  $('#authErr').textContent = 'Ищем сейф пары в облаке…';
  let cloud = null;
  try { cloud = await fetchCloudVault(); } catch (e) { console.warn('initAuth: облако недоступно', e); }
  if (cloud && cloud.vault) {
    pendingCloudVault = cloud.vault;
    $('#authErr').textContent = '';
    if (hasLocal) {
      // Локальный сейф есть + облачный отдельный: вход паролем облачного сейфа
      // вернёт облачные данные (см. cloudHint2 в index.html).
      $('#cloudHint2').hidden = false;
    } else {
      $('#cloudHint').hidden = false;
    }
    $('#authPass').focus();
  } else if (!hasLocal) {
    // Свежее устройство и облако не ответило (или сейфа там нет): объясняем и
    // даём выбор — повторить проверку или действительно создать новый сейф.
    $('#authErr').textContent = 'Не удалось найти сейф в облаке. Проверь интернет и нажми «Повторить проверку», или создай новый сейф на этом устройстве.';
    $('#cloudRetryBtn').hidden = false;
    $('#toSetupBtn').hidden = false;
  } else {
    // Локальный сейф есть, а облако не ответило — обычный вход локальным паролем.
    $('#authErr').textContent = '';
  }
  // Если JS по какой-то причине не выполнится — контент так и останется скрытым
  // (body.auth прячет шапку и main), никто ничего не увидит.
}
// Вызов initAuth() стоит в конце 95-sync.js (самый последний модуль сборки):
// initAuth читает FIREBASE_CONFIG (let из 95-sync.js), а он ещё в «мёртвой зоне»
// во время выполнения 90-effects-init.js.

setInterval(() => {
  // сердечки летают не слишком часто, не под замком и не во время открытых модалок
  if (isHidden() || authLocked) return;
  if (document.querySelector('.overlay:not([hidden])')) return;
  if (!$('#view-home') || !$('#view-home').classList.contains('active')) return;
  spawnHeart();
}, 3800);
// Коллаж «Наша история» стабилен в течение дня — обновлять его не нужно.
spawnHeart();




