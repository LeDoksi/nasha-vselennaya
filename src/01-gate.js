/* ===== Гейт: вход только для двух Google-аккаунтов =====
   Раньше сайт был закрыт паролем (PBKDF2 + AES, свой пароль у каждого), а
   после — общим ключом пары, синхронизированным через Firebase Realtime
   Database (vaults/secret) с разовым переносом старых данных при первом
   входе. Оба механизма (src/06-migrate.js, старый сейф в localStorage,
   RTDB-канал ключа) выброшены целиком вместе со старыми данными — владелец
   решил начинать с чистой базы в Firestore. Единственный барьер теперь —
   Google-вход, ограниченный ALLOWED_EMAILS: без него никто не видит даже
   экран приложения, а Firestore и обе Cloud Function (photo-sign,
   send-push) точно так же проверяют auth.token.email — так что дыра «кто
   угодно анонимно» (см. PROJECT-MEMORY) закрыта не только на клиенте.

   Каждый — на своём устройстве под своим Google-аккаунтом, поэтому кто есть
   кто определяется ТОЛЬКО email из GATE_WHO_BY_EMAIL — без ручного выбора
   «Гоша/Даша», как было раньше на экране входа.

   Шифрование осталось только для фото в облаке (Yandex Object Storage,
   см. src/95-photos-cloud.js): общий ключ пары (AES-GCM) лежит в Firestore
   (meta/settings.photoKey) — читать его может только уже вошедший через
   Google. Локально ключ кэшируется в localStorage (universe_mk), поэтому
   офлайн всё работает мгновенно и повторный вход не спрашивает вообще
   ничего. */
const ALLOWED_EMAILS = ['shakov.georgy@gmail.com', 'dashach98@gmail.com'];
const GATE_WHO_BY_EMAIL = {
  'shakov.georgy@gmail.com': 'gosha',
  'dashach98@gmail.com': 'dasha'
};
const KEY_CACHE = 'universe_mk'; // локально закэшированный сырой AES-ключ (base64)

let fbApp = null; // единственное Firebase-приложение на весь сайт (гейт + синк + фото)
let gateUser = null; // Google-пользователь, прошедший проверку email

function ensureFbApp() {
  if (fbApp) return fbApp;
  if (typeof firebase === 'undefined' || typeof firebase.initializeApp !== 'function') return null;
  try {
    fbApp = firebase.initializeApp(FIREBASE_CONFIG);
  } catch (e) {
    console.warn('[gate] initializeApp failed', e);
    return null;
  }
  return fbApp;
}

function showGateErr(msg) {
  const el = $('#gateErr');
  if (el) el.textContent = msg || '';
}

/* ===== Ключ шифрования фото: локальный кэш → Firestore → (первый запуск) новый ===== */
async function importRawKey(rawB64) {
  return crypto.subtle.importKey('raw', unb64(rawB64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}
async function exportRawKey(key) {
  return b64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}
// Кэширует ключ локально и публикует его в Firestore — единственное место,
// где он теперь живёт в облаке. Вызывается только на самом первом запуске
// пары (ни локального кэша, ни meta/settings.photoKey ещё нет нигде) —
// партнёр на своём устройстве получит этот же ключ при следующем входе (см.
// ensureMasterKey ниже). Без этого второе устройство завело бы свой ключ и
// не увидело бы зашифрованные фото первого.
async function publishPhotoKey(key) {
  const rawB64 = await exportRawKey(key);
  store.set(KEY_CACHE, rawB64);
  if (fsReady) {
    try {
      await repoMeta({ photoKey: rawB64 });
    } catch (e) {
      console.warn('[gate] не удалось положить ключ фото в Firestore', e);
    }
  }
}

// Читает общий ключ пары из Firestore. null — если его там нет или база
// недоступна (офлайн, таймаут).
async function fetchPhotoKeyRaw() {
  if (!fsReady) return null;
  try {
    const snap = await withTimeout(fsDoc().collection('meta').doc('settings').get(), 10000);
    const raw = snap.exists ? snap.data().photoKey : null;
    return typeof raw === 'string' && raw ? raw : null;
  } catch (e) {
    console.warn('[gate] ключ фото из Firestore недоступен', e);
    return null;
  }
}

/* Источник истины по ключу — ВСЕГДА Firestore, а локальный кэш — только
   офлайн-подстраховка. Порядок важен: пока кэш стоял первым, устройства,
   у которых кэши однажды разошлись (например, одно завело свой ключ, пока
   база была недоступна), не сходились уже никогда — каждое верило своему
   localStorage и считало фото партнёра «чужими». Теперь расхождение
   лечится само при первом же входе с сетью. */
async function ensureMasterKey() {
  const cloudB64 = await fetchPhotoKeyRaw();
  if (cloudB64) {
    if (cloudB64 !== store.get(KEY_CACHE)) store.set(KEY_CACHE, cloudB64);
    try {
      return await importRawKey(cloudB64);
    } catch (e) {
      console.warn('[gate] ключ фото из Firestore не импортируется', e);
    }
  }
  const cachedB64 = store.get(KEY_CACHE);
  if (cachedB64) {
    try {
      return await importRawKey(cachedB64);
    } catch (e) {
      store.remove(KEY_CACHE);
    }
  }
  // Ни в Firestore, ни локально ключа нет — совсем первый запуск пары.
  // Заводим новый, но перед публикацией перечитаем базу ещё раз: если за
  // время генерации ключ успело опубликовать другое устройство, возьмём его.
  // Это не полная защита от гонки (для гарантии нужна транзакция), но
  // закрывает реальный сценарий: два человека заходят с разницей в секунды.
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const raceB64 = await fetchPhotoKeyRaw();
  if (raceB64) {
    store.set(KEY_CACHE, raceB64);
    return await importRawKey(raceB64);
  }
  await publishPhotoKey(key);
  return key;
}

/* ===== Вход: ключ шифрования фото получен — данные приходят из Firestore ===== */
async function unlockWithKey(key) {
  masterKey = key;
  applyMotion(getMotion()); // раньше стояло в удалённом initAuth() — сохранённый выбор анимаций
  await loadHotSet();
  startLiveUpdates();
  await initPhotoStore();
  await photoStore.migratePhotos(db);
  await photoStore.refreshSizes();
  warmThumbCache();
  unlockApp();
}

/* ===== Собственно Google-вход =====
   Обёрнуто в try/catch целиком: раньше при неожиданной ошибке внутри
   ensureMasterKey/unlockWithKey человек молча оставался на экране входа без
   единого пояснения — снаружи это выглядело как «нажал Войти, а он вернул
   меня туда же». Теперь любая осечка хотя бы показывает текст ошибки. */
async function tryEnterWithUser(user) {
  if (!user || !user.email || !ALLOWED_EMAILS.includes(user.email)) {
    if (user) {
      showGateErr('Этот Google-аккаунт не имеет доступа сюда. Выйди и попробуй другим аккаунтом 💜');
      try {
        await firebase.auth(fbApp).signOut();
      } catch (e) {}
    }
    return;
  }
  try {
    gateUser = user;
    setUser(GATE_WHO_BY_EMAIL[user.email]);
    showGateErr('Загружаем…');
    await initFirestore();
    const key = await ensureMasterKey();
    await unlockWithKey(key);
  } catch (e) {
    console.warn('[gate] вход не завершился', e);
    showGateErr('Что-то пошло не так при загрузке данных. Обнови страницу и попробуй ещё раз 💜');
  }
}

const GATE_REDIRECT_FLAG = 'universe_gate_redirecting';
async function gateSignIn() {
  const app = ensureFbApp();
  if (!app) {
    showGateErr('Firebase не загрузился — проверь интернет и обнови страницу.');
    return;
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  showGateErr('Открываем окно входа Google…');
  try {
    // Popup — основной способ везде, включая установленный на главный экран
    // PWA (там всплывающее окно почти всегда открывается нормально, а вот
    // полноценный редирект на accounts.google.com и обратно ненадёжен: iOS
    // может вернуть его уже НЕ в контекст установленного приложения — тогда
    // getRedirectResult() ничего не находит, и человека просто отбрасывает на
    // тот же экран входа без объяснений). Редирект — только как явный fallback,
    // когда сам Firebase говорит, что popup в этом окружении не работает.
    const cred = await firebase.auth(app).signInWithPopup(provider);
    await tryEnterWithUser(cred && cred.user);
  } catch (e) {
    if (e && e.code === 'auth/popup-closed-by-user') {
      showGateErr('');
      return;
    }
    if (e && (e.code === 'auth/operation-not-supported-in-this-environment' || e.code === 'auth/popup-blocked')) {
      try {
        store.set(GATE_REDIRECT_FLAG, '1');
        await firebase.auth(app).signInWithRedirect(provider);
        return; // страница уйдёт и вернётся сама — дальше подхватит boot()
      } catch (e2) {
        console.warn('[gate] redirect signIn failed', e2);
        showGateErr('Не удалось открыть окно входа Google в этом браузере. Попробуй обычный Safari/Chrome вместо установленного приложения.');
        return;
      }
    }
    console.warn('[gate] signIn failed', e);
    showGateErr('Не удалось войти через Google. Попробуй ещё раз.');
  }
}

async function gateSignOut() {
  if (!confirm('Выйти из Google-аккаунта на этом устройстве? Чтобы открыть сайт снова, понадобится войти через Google ещё раз.')) return;
  try {
    if (fbApp) await firebase.auth(fbApp).signOut();
  } catch (e) {}
  gateUser = null;
  store.remove(KEY_CACHE);
  // Отписываемся до перезагрузки: сейчас её хватило бы и так, но подписки,
  // пережившие выход из аккаунта, писали бы в db уже вышедшего человека.
  stopLiveUpdates();
  location.reload();
}

const gateSignInBtnEl = $('#gateSignInBtn');
if (gateSignInBtnEl) gateSignInBtnEl.addEventListener('click', gateSignIn);
const gateSignOutBtnEl = $('#gateSignOutBtn');
if (gateSignOutBtnEl) gateSignOutBtnEl.addEventListener('click', gateSignOut);

/* ===== Экраны входа и открытия приложения =====
   Жили в src/10-vault.js, пока тот был модулем сейфа с паролями. Сейфа
   больше нет (данные в Firestore, вход через Google), от файла остались
   только эти функции — переехали сюда, к гейту, которому они и служат. */
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

/* ===== Старт приложения =====
   Вызов boot() стоит в конце 95-photos-cloud.js (последний модуль сборки) —
   как и раньше initAuth(), он читает FIREBASE_CONFIG (let из
   95-photos-cloud.js), который ещё в «мёртвой зоне» во время выполнения
   этого файла. */
async function boot() {
  document.body.classList.add('auth');
  showAuth('gate');
  const app = ensureFbApp();
  if (!app) {
    showGateErr('Firebase не загрузился — без интернета сайт открыть нельзя.');
    return;
  }
  const auth = firebase.auth(app);
  // Ставился в gateSignIn() перед signInWithRedirect — если мы сюда вернулись,
  // это точно возврат из редиректа (не обычная загрузка страницы), и молчать
  // при неудаче нельзя: раньше человек просто видел тот же экран входа заново.
  const wasRedirecting = store.get(GATE_REDIRECT_FLAG) === '1';
  store.remove(GATE_REDIRECT_FLAG);
  let user = null;
  try {
    const redirectCred = await auth.getRedirectResult();
    if (redirectCred && redirectCred.user) user = redirectCred.user;
  } catch (e) {
    console.warn('[gate] redirect result failed', e);
    if (wasRedirecting) showGateErr('Вход через Google не завершился (браузер мог сбросить сессию при переходе). Попробуй ещё раз.');
  }
  if (!user) {
    user = await new Promise(resolve => {
      // let, не const: колбэк может сработать синхронно (в реальном SDK — нет,
      // но не полагаемся на это), а до присвоения unsub ещё не существует.
      let unsub;
      unsub = auth.onAuthStateChanged(u => {
        if (unsub) unsub();
        resolve(u);
      });
    });
  }
  if (user) {
    await tryEnterWithUser(user);
  } else if (wasRedirecting) {
    showGateErr('Вход через Google не завершился. Попробуй ещё раз — если не поможет, открой сайт в обычном браузере вместо установленного приложения.');
  }
  // иначе остаёмся на экране гейта — ждём клика «Войти через Google»
}
