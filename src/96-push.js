/* ===== Push-уведомления о свиданиях (Фаза 3) =====
   Архитектура: подписка PushManager каждого пользователя лежит ВНУТРИ
   зашифрованного сейфа (db.pushSubs.gosha/dasha, см. 00-core.js) — оба
   партнёра и так расшифровывают его одним мастер-ключом, поэтому это не
   новая утечка, и подписка синхронизируется тем же каналом, что и всё
   остальное. Отправка — БЕЗ серверных триггеров на запись в базу (RTDB тут
   только канал синхронизации сейфа, не полноценный бэкенд): клиент, который
   только что создал приглашение или ответил на него, уже знает подписку
   получателя локально (расшифрована) и сам дёргает Cloud Function
   `send-push` (functions/send-push/) — та же схема авторизации
   (X-Firebase-Token), что и у photo-sign в 95-sync.js.

   iOS: push работает только если сайт добавлен на экран «Домой» — обычная
   вкладка Safari такое не разрешает (ограничение Apple, не этого кода).

   PUSH_CONFIG.vapidPublicKey/sendFnUrl — не секреты (как и signFnUrl в
   95-sync.js), настоящий секрет (приватный VAPID-ключ) живёт только в
   переменных окружения функции. См. README, раздел B4. */
let PUSH_CONFIG = {
  vapidPublicKey: '', // ← публичный VAPID-ключ, см. README раздел B4
  sendFnUrl: '' // ← адрес Cloud Function send-push после деплоя, см. README раздел B4
};

let swRegistration = null;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    swRegistration = await navigator.serviceWorker.register('sw.js');
    return swRegistration;
  } catch (e) {
    console.warn('[push] service worker не зарегистрировался', e);
    return null;
  }
}

function pushSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window && !!PUSH_CONFIG.vapidPublicKey;
}

// standalone (сайт добавлен на экран «Домой») — на iOS push иначе не работает вообще.
function isStandalone() {
  try {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  } catch (e) {
    return false;
  }
}

async function currentPushSubscription() {
  if (!swRegistration) return null;
  try {
    return await swRegistration.pushManager.getSubscription();
  } catch (e) {
    return null;
  }
}

async function enablePushNotifications() {
  if (!pushSupported()) {
    alert('Уведомления не поддерживаются в этом браузере.');
    return false;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    alert('Без разрешения на уведомления включить их нельзя — проверь настройки браузера.');
    return false;
  }
  if (!swRegistration) await registerServiceWorker();
  if (!swRegistration) {
    alert('Не получилось подготовить фоновую службу для уведомлений.');
    return false;
  }
  let sub;
  try {
    sub = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUSH_CONFIG.vapidPublicKey)
    });
  } catch (e) {
    console.warn('[push] подписка не удалась', e);
    alert('Не получилось подписаться на уведомления.');
    return false;
  }
  db.pushSubs[getUser()] = sub.toJSON();
  await save();
  renderPushSettings();
  return true;
}

async function disablePushNotifications() {
  const sub = await currentPushSubscription();
  if (sub) {
    try {
      await sub.unsubscribe();
    } catch (e) {}
  }
  if (db.pushSubs) delete db.pushSubs[getUser()];
  await save();
  renderPushSettings();
}

async function renderPushSettings() {
  const t = $('#pushToggle');
  const hint = $('#pushHint');
  if (!t) return;
  if (!pushSupported()) {
    t.disabled = true;
    t.checked = false;
    if (hint) hint.textContent = 'Уведомления не поддерживаются в этом браузере.';
    return;
  }
  t.disabled = false;
  const sub = await currentPushSubscription();
  t.checked = !!sub;
  if (hint) {
    hint.textContent = isStandalone() ? '' : '💡 На телефоне уведомления надёжно работают только после установки сайта на экран «Домой» (в Safari на iOS — иначе они не приходят вообще).';
  }
}
const pushToggleEl = $('#pushToggle');
if (pushToggleEl)
  pushToggleEl.addEventListener('change', e => {
    e.target.checked ? enablePushNotifications() : disablePushNotifications();
  });

// Отправка партнёру — тихо проглатывает любые ошибки: пуш это украшение поверх
// уже сохранённого свидания, а не критичная часть флоу (свидание в календаре
// в любом случае уже создано/отвечено на момент вызова).
async function notifyPartner(title, body) {
  try {
    if (!PUSH_CONFIG.sendFnUrl) return;
    const partner = getUser() === 'gosha' ? 'dasha' : 'gosha';
    const sub = db.pushSubs && db.pushSubs[partner];
    if (!sub) return;
    let authHeaders = {};
    try {
      const user = syncFirebase && firebase.auth(syncFirebase).currentUser;
      if (user) authHeaders = { 'X-Firebase-Token': await user.getIdToken() };
    } catch (e) {}
    // Без токена нечем авторизоваться перед send-push — тихо не отправляем
    // (не критичная функция, ничего в приложении из-за этого не ломается).
    if (!authHeaders['X-Firebase-Token']) return;
    await fetch(PUSH_CONFIG.sendFnUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ subscription: sub, title, body })
    });
  } catch (e) {
    console.warn('[push] не удалось отправить партнёру', e);
  }
}

// typeof-проверка, а не просто вызов: часть мини-DOM тестовых песочниц
// (tests/uni-*.js) не определяют navigator вообще — без проверки любой такой
// тест падал бы ReferenceError на самой загрузке app.js, а не на реальной
// проверке чего-либо в push-модуле.
if (typeof navigator !== 'undefined') registerServiceWorker();
