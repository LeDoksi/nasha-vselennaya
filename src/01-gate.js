/* ===== Гейт: вход только для двух Google-аккаунтов =====
   Раньше сайт был закрыт паролем (PBKDF2 + AES, свой пароль у каждого).
   Теперь первый (и единственный) барьер — Google-вход, ограниченный
   ALLOWED_EMAILS: без него никто не видит даже экран приложения, а Firebase
   RTDB и обе Cloud Function (photo-sign, send-push) точно так же проверяют
   auth.token.email — так что дыра «кто угодно анонимно» (см. PROJECT-MEMORY)
   закрыта не только на клиенте.

   Каждый — на своём устройстве под своим Google-аккаунтом, поэтому кто есть
   кто определяется ТОЛЬКО email из GATE_WHO_BY_EMAIL — без ручного выбора
   «Гоша/Даша», как было раньше на экране входа.

   Шифрование данных осталось (AES-GCM), но ключ больше не оборачивается
   паролем персонально: единый мастер-ключ пары лежит в RTDB по пути
   vaults/secret — читать его может только уже вошедший через Google (те же
   правила, что и на vaults/shared). Локально ключ кэшируется в localStorage
   (universe_mk), поэтому офлайн всё работает мгновенно и повторный вход не
   спрашивает вообще ничего. */
const ALLOWED_EMAILS = ['shakov.georgy@gmail.com', 'dashach98@gmail.com'];
const GATE_WHO_BY_EMAIL = {
  'shakov.georgy@gmail.com': 'gosha',
  'dashach98@gmail.com': 'dasha'
};
const KEY_CACHE = 'universe_mk'; // локально закэшированный сырой AES-ключ (base64)
const RTDB_SECRET_PATH = 'vaults/secret';

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

/* ===== Ключ шифрования: локальный кэш → облако → (первый запуск) новый ===== */
async function importRawKey(rawB64) {
  return crypto.subtle.importKey('raw', unb64(rawB64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}
async function exportRawKey(key) {
  return b64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}
async function publishMigratedKey(key) {
  const rawB64 = await exportRawKey(key);
  store.set(KEY_CACHE, rawB64);
  const app = ensureFbApp();
  if (app) {
    try {
      await firebase.database(app).ref(RTDB_SECRET_PATH).set(rawB64);
    } catch (e) {
      console.warn('[gate] не удалось опубликовать ключ в облако', e);
    }
  }
}

// Старый сейф (до этого обновления) хранит мастер-ключ, обёрнутый паролем
// каждого — tryUnwrapKey/pbkdf2Key (10-vault.js) остались нетронутыми именно
// для этой разовой миграции. Если с прошлого раза жива сессия в
// sessionStorage (старый «запомнить меня» трюк) — ключ достаём без пароля;
// иначе один-единственный раз показываем поле для пароля.
async function migrateLegacyVault(who, legacy) {
  try {
    const raw = sessionStorage.getItem('universe_session');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.who === who && parsed.k) {
        const key = await crypto.subtle.importKey('raw', unb64(parsed.k), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
        await aesDec(key, legacy.db); // проверяем, что ключ и правда подходит
        await publishMigratedKey(key);
        return key;
      }
    }
  } catch (e) {
    /* сессия не подошла — показываем разовую миграцию ниже */
  }
  showAuth('gate');
  $('#gateMigrateWrap').hidden = false;
  showGateErr('');
  const p = $('#gateMigratePass');
  if (p && p.focus) p.focus();
  return null;
}

async function ensureMasterKey(who) {
  const cachedB64 = store.get(KEY_CACHE);
  if (cachedB64) {
    try {
      return await importRawKey(cachedB64);
    } catch (e) {
      store.remove(KEY_CACHE);
    }
  }
  const app = ensureFbApp();
  if (app) {
    try {
      const snap = await withTimeout(firebase.database(app).ref(RTDB_SECRET_PATH).once('value'), 10000);
      const raw = snap && snap.val ? snap.val() : null;
      if (typeof raw === 'string' && raw) {
        store.set(KEY_CACHE, raw);
        return await importRawKey(raw);
      }
    } catch (e) {
      console.warn('[gate] не удалось получить облачный ключ', e);
    }
  }
  const legacy = loadVault();
  if (legacy && Array.isArray(legacy.keys) && legacy.keys.length) {
    return await migrateLegacyVault(who, legacy);
  }
  // Совсем первый запуск (ни локально, ни в облаке ничего нет) — заводим ключ.
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  await publishMigratedKey(key);
  return key;
}

async function gateMigrateSubmit() {
  const who = GATE_WHO_BY_EMAIL[gateUser && gateUser.email];
  const pass = $('#gateMigratePass').value;
  const legacy = loadVault();
  const key = who && legacy ? await tryUnwrapKey(who, pass, legacy) : null;
  if (!key) {
    showGateErr('Неверный пароль. Попробуй ещё раз.');
    return;
  }
  await publishMigratedKey(key);
  $('#gateMigrateWrap').hidden = true;
  await unlockWithKey(key);
}

/* ===== Вход: собственно AES-ключ получен — расшифровываем локальный сейф
   (или начинаем с пустого, если его ещё нет — данные подтянутся из облака) ===== */
async function unlockWithKey(key) {
  masterKey = key;
  applyMotion(getMotion()); // раньше стояло в удалённом initAuth() — сохранённый выбор анимаций
  const vault = loadVault();
  try {
    if (vault && vault.db) {
      const raw = await aesDec(masterKey, vault.db);
      db = migrateDB({ ...defaultDB(), ...JSON.parse(dec.decode(raw)) });
    } else {
      // Совсем свежее устройство: если остались древние незашифрованные данные
      // (localStorage['universe'] — до появления сейфов вообще) — забираем их,
      // а не начинаем с пустого. store.remove(KEY) — как раньше в createVault().
      db = migrateDB({ ...defaultDB(), ...legacyDB() });
      store.remove(KEY);
    }
  } catch (e) {
    console.warn('Не удалось расшифровать локальный сейф — начинаем с пустого, ждём облако', e);
    db = defaultDB();
  }
  await initPhotoStore();
  await photoStore.migratePhotos(db);
  await photoStore.refreshSizes();
  warmThumbCache();
  try {
    await save();
  } catch (e) {
    console.warn('Не удалось закрепить миграцию', e);
  }
  unlockApp();
}

/* ===== Собственно Google-вход ===== */
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
  gateUser = user;
  setUser(GATE_WHO_BY_EMAIL[user.email]);
  showGateErr('Загружаем…');
  const key = await ensureMasterKey(GATE_WHO_BY_EMAIL[user.email]);
  if (!key) return; // ensureMasterKey уже показал разовый экран миграции
  await unlockWithKey(key);
}

async function gateSignIn() {
  const app = ensureFbApp();
  if (!app) {
    showGateErr('Firebase не загрузился — проверь интернет и обнови страницу.');
    return;
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  showGateErr('Открываем окно входа Google…');
  try {
    if (isStandalone()) {
      // В установленном PWA (iOS/Android «на главный экран») всплывающее окно
      // часто не открывается вообще — надёжно работает только редирект.
      await firebase.auth(app).signInWithRedirect(provider);
      return; // страница уйдёт и вернётся сама — дальше подхватит boot()
    }
    const cred = await firebase.auth(app).signInWithPopup(provider);
    await tryEnterWithUser(cred && cred.user);
  } catch (e) {
    if (e && e.code === 'auth/popup-closed-by-user') {
      showGateErr('');
      return;
    }
    console.warn('[gate] signIn failed', e);
    showGateErr('Не удалось войти через Google. Попробуй ещё раз.');
  }
}

// Возврат после lock() (приватный «замок» по бездействию — см. 10-vault.js):
// Google-сессия жива, повторно логиниться не нужно, достаточно одного тапа.
async function gateResume() {
  $('#gateResumeBtn').hidden = true;
  $('#gateSignInBtn').hidden = false;
  const who = gateUser && GATE_WHO_BY_EMAIL[gateUser.email];
  if (!who) return; // Google-сессия почему-то пропала — обычный вход через кнопку
  showGateErr('Загружаем…');
  const key = await ensureMasterKey(who);
  if (key) await unlockWithKey(key);
}

async function gateSignOut() {
  if (!confirm('Выйти из Google-аккаунта на этом устройстве? Чтобы открыть сайт снова, понадобится войти через Google ещё раз.')) return;
  try {
    if (fbApp) await firebase.auth(fbApp).signOut();
  } catch (e) {}
  gateUser = null;
  store.remove(KEY_CACHE);
  location.reload();
}

const gateSignInBtnEl = $('#gateSignInBtn');
if (gateSignInBtnEl) gateSignInBtnEl.addEventListener('click', gateSignIn);
const gateResumeBtnEl = $('#gateResumeBtn');
if (gateResumeBtnEl) gateResumeBtnEl.addEventListener('click', gateResume);
const gateMigrateGoEl = $('#gateMigrateGo');
if (gateMigrateGoEl) gateMigrateGoEl.addEventListener('click', gateMigrateSubmit);
const gateMigratePassEl = $('#gateMigratePass');
if (gateMigratePassEl)
  gateMigratePassEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') gateMigrateSubmit();
  });
const gateSignOutBtnEl = $('#gateSignOutBtn');
if (gateSignOutBtnEl) gateSignOutBtnEl.addEventListener('click', gateSignOut);

/* ===== Старт приложения =====
   Вызов boot() стоит в конце 95-sync.js (последний модуль сборки) — как и
   раньше initAuth(), он читает FIREBASE_CONFIG (let из 95-sync.js), который
   ещё в «мёртвой зоне» во время выполнения этого файла. */
async function boot() {
  document.body.classList.add('auth');
  showAuth('gate');
  const app = ensureFbApp();
  if (!app) {
    showGateErr('Firebase не загрузился — без интернета сайт открыть нельзя.');
    return;
  }
  const auth = firebase.auth(app);
  let user = null;
  try {
    const redirectCred = await auth.getRedirectResult();
    if (redirectCred && redirectCred.user) user = redirectCred.user;
  } catch (e) {
    console.warn('[gate] redirect result failed', e);
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
  if (user) await tryEnterWithUser(user);
  // иначе остаёмся на экране гейта — ждём клика «Войти через Google»
}
