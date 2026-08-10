/* ===== Облачная синхронизация (фаза B, Firebase Realtime Database) =====
   Принцип: localStorage — «правда» локально, Firebase — канал синхронизации.
   Синхронизируем САМ зашифрованный сейф `universe_vault` (zero-knowledge):
   на сервере лежит только шифртекст (AES-GCM мастер-ключом + обёртки обоих
   паролей внутри), поэтому и Гоша, и Даша открывают облачные данные своим
   паролем, а Firebase ничего прочитать не может.

   Путь в RTDB: vaults/shared = { syncTs, vault }. Правила: read/write auth != null
   (см. README). Конфликты: «последняя правка выигрывает» по syncTs.

   Фаза B1: вставь config из Firebase Console в FIREBASE_CONFIG ниже.
   Без config (или без интернета) приложение работает как раньше — локально.
   Работает на http(s); на file:// SDK может не загрузиться — тоже локально. */

let FIREBASE_CONFIG = null; // ← сюда config из Firebase (см. README, фаза B1). let — чтобы тесты могли подставить мок.

const SYNC_KEY = 'universe_syncTs';  // последний известный syncTs (метаданные, не секрет)
const SYNC_PATH = 'vaults/shared';   // общий зашифрованный сейф пары

let syncFirebase = null;   // firebaseApp (compat)
let syncDb = null;         // firebase.database()
let syncReady = false;     // SDK есть, config есть, анонимный вход сделан
let syncTs = 0;            // последний применённый syncTs
let syncPushTimer = null;  // debounce push после save()
let syncApplying = false;  // защита от рекурсии pull→save→push

/* ===== Инициализация: вызывается из unlockApp() после входа ===== */
async function initSync() {
  syncTs = parseInt(store.get(SYNC_KEY) || '0', 10) || 0;
  if (!FIREBASE_CONFIG) { renderSyncStatus('off'); return; }
  if (typeof firebase === 'undefined' || typeof firebase.initializeApp !== 'function' ||
      typeof firebase.database !== 'function' || typeof firebase.auth !== 'function') {
    renderSyncStatus('off');
    return;
  }
  try {
    syncFirebase = firebase.initializeApp(FIREBASE_CONFIG, 'nasha_sync');
    syncDb = firebase.database(syncFirebase);
    // Anonymous Auth: оба устройства — «гости», доступ к общему vaults/shared.
    // UID нигде не храним: правила разрешают любому анониму, данные зашифрованы.
    const cred = await firebase.auth(syncFirebase).signInAnonymously();
    if (!cred || !cred.user) throw new Error('no anonymous user');
    syncReady = true;
    renderSyncStatus('idle');
    listenRemote();      // живые обновления с другого устройства
    pullVault(true);     // при входе пробуем забрать свежие данные
    scheduleSyncPush();  // и отдать свои, если они свежее
  } catch (e) {
    console.warn('[sync] init failed', e);
    syncReady = false;
    renderSyncStatus('error');
  }
}

/* ===== Push: после каждого save() (debounce 1.5с) ===== */
function scheduleSyncPush() {
  if (!syncReady || syncApplying) return;
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(pushVault, 1500);
}

async function pushVault() {
  if (!syncReady || syncApplying) return;
  try {
    const vault = loadVault();
    if (!vault || !vault.db || typeof vault.db.d !== 'string') return;
    renderSyncStatus('syncing');
    const ts = Date.now();
    await syncDb.ref(SYNC_PATH).set({ syncTs: ts, vault });
    syncTs = ts;
    store.set(SYNC_KEY, String(ts));
    renderSyncStatus('ok', ts);
  } catch (e) {
    console.warn('[sync] push failed', e);
    renderSyncStatus('error');
  }
}

/* ===== Pull: читаем облако, применяем, если оно свежее ===== */
async function pullVault(silent) {
  if (!syncReady) return;
  try {
    const snap = await syncDb.ref(SYNC_PATH).once('value');
    const remote = snap && snap.val ? snap.val() : null;
    if (!remote || !remote.vault || !remote.vault.db || typeof remote.vault.db.d !== 'string') return;
    const rts = remote.syncTs || 0;
    if (rts <= syncTs) return; // облако не свежее — не трогаем локальные данные
    const applied = await applyRemoteVault(remote.vault);
    if (!applied) { renderSyncStatus('error'); return; }
    syncTs = rts;
    store.set(SYNC_KEY, String(rts));
    renderSyncStatus('ok', rts);
    if (!silent) notify('Данные обновлены с другого устройства 💜');
  } catch (e) {
    console.warn('[sync] pull failed', e);
    renderSyncStatus('error');
  }
}

/* ===== Живой слушатель: изменения с другого устройства приходят сами ===== */
let syncLiveOn = false;
function listenRemote() {
  if (syncLiveOn || !syncReady || !syncDb) return;
  syncLiveOn = true;
  syncDb.ref(SYNC_PATH).on('value', snap => {
    if (syncApplying) return;
    const remote = snap && snap.val ? snap.val() : null;
    if (!remote || !remote.vault || !remote.vault.db || typeof remote.vault.db.d !== 'string') return;
    const rts = remote.syncTs || 0;
    if (rts <= syncTs) return; // свой же push
    renderSyncStatus('syncing');
    applyRemoteVault(remote.vault).then(ok => {
      if (!ok) { renderSyncStatus('error'); return; }
      syncTs = rts;
      store.set(SYNC_KEY, String(rts));
      renderSyncStatus('ok', rts);
      notify('Данные обновлены с другого устройства 💜');
    }).catch(e => { console.warn('[sync] live apply failed', e); renderSyncStatus('error'); });
  });
}

/* ===== Применить облачный сейф: расшифровать → db → перерисовать =====
   AES-GCM — аутентифицированное шифрование: чужой/повреждённый блоб не
   расшифруется (упадёт), локальные данные не пострадают. */
async function applyRemoteVault(remoteVault) {
  if (!masterKey) return false;
  let raw;
  try {
    raw = await aesDec(masterKey, remoteVault.db);
  } catch (e) {
    console.warn('[sync] облачный сейф не расшифровать (не тот ключ/повреждён?)', e);
    return false;
  }
  let nd;
  try {
    nd = migrateDB({ ...defaultDB(), ...JSON.parse(dec.decode(raw)) });
  } catch (e) {
    console.warn('[sync] облачные данные повреждены', e);
    return false;
  }
  syncApplying = true;
  try {
    db = nd;
    store.set(VAULT_KEY, JSON.stringify(remoteVault));
    if (photoStore) {
      await photoStore.migratePhotos(db);
      await photoStore.refreshSizes();
      warmThumbCache();
    }
    await save(); // закрепить миграции локально (push не запустится: syncApplying)
    renderUserChip(); renderHome(); renderCalendar(); renderNotes();
    renderLists(); renderWishlist(); renderPhotos(); renderMemory(); renderSettings();
    return true;
  } catch (e) {
    console.warn('[sync] применить облачные данные не удалось', e);
    return false;
  } finally {
    syncApplying = false;
  }
}

/* ===== Остановка: при lock() ===== */
function stopSync() {
  clearTimeout(syncPushTimer);
  if (syncLiveOn && syncDb) {
    try { syncDb.ref(SYNC_PATH).off('value'); } catch (e) {}
    syncLiveOn = false;
  }
  if (syncFirebase && typeof syncFirebase.auth === 'function') {
    try { syncFirebase.auth().signOut(); } catch (e) {}
  }
  syncReady = false;
  syncFirebase = null;
  syncDb = null;
  renderSyncStatus('off');
}


/* ===== UI в настройках: статус + кнопка ===== */
const SYNC_STATUS_TEXT = {
  off:     'Синхронизация не настроена — данные живут только на этом устройстве. Чтобы открывать их с телефона, вставь Firebase config (README, фаза B1).',
  idle:    'Облако подключено — ждём изменений…',
  syncing: 'Синхронизируем…',
  ok:      'Синхронизировано ✅',
  error:   'Ошибка синхронизации — проверь интернет и попробуй ещё раз 💜'
};
let syncUiState = 'off';
let syncUiTs = 0;
function renderSyncStatus(state, ts) {
  syncUiState = state;
  syncUiTs = ts || 0;
  const el = $('#syncStatus');
  if (!el) return;
  const text = SYNC_STATUS_TEXT[state] || SYNC_STATUS_TEXT.off;
  el.textContent = text;
  el.style.color = state === 'ok' ? '#059669' : (state === 'error' ? '#dc2626' : 'var(--muted)');
  const btn = $('#syncNowBtn');
  if (btn) btn.disabled = (state === 'syncing');
}
function syncNow() {
  if (!FIREBASE_CONFIG) { renderSyncStatus('off'); return; }
  if (!syncReady) { initSync(); return; }
  pullVault(false);
  pushVault();
}
const syncNowBtnEl = $('#syncNowBtn');
if (syncNowBtnEl) syncNowBtnEl.addEventListener('click', syncNow);

