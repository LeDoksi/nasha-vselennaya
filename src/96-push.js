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
  vapidPublicKey: 'BHAuFiHPe13m3MBOygG_hRrrdecn6c0GJIvWGT1QKTUkm2kB9d9EMI8j-2I8Q3s-GbES6o8DK586wFAZFC22Z0U',
  sendFnUrl: 'https://functions.yandexcloud.net/d4eadokbi6den6g3sggu'
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

/* ===== Диагностика уведомлений (по образцу runCloudDiagnostics в 95-sync.js) =====
   notifyPartner() выше нарочно тихо проглатывает ошибки (это не критичный
   путь) — но это же делает его непригодным для отладки живой проблемы «пуш
   не пришёл». Эта функция шлёт РЕАЛЬНЫЙ тестовый пуш самому себе (не
   партнёру) и показывает настоящий ответ send-push прямо на экране —
   изолирует, где именно рвётся цепочка: нет своей подписки/токена, сама
   функция ответила ошибкой, или всё дошло до неё, но не показалось (тогда
   дело уже не в коде сайта, а в доставке на конкретное устройство/ОС). */
async function runPushDiagnostics() {
  const out = $('#pushDiagOut');
  if (!out) return;
  out.hidden = false;
  const lines = [];
  const add = s => lines.push(s);
  try {
    add('Notification.permission: ' + (typeof Notification !== 'undefined' ? Notification.permission : 'нет API'));
    add('pushSupported(): ' + pushSupported());
    add('isStandalone() (добавлено на экран «Домой»): ' + isStandalone());
    add('service worker зарегистрирован: ' + !!swRegistration);
    const sub = await currentPushSubscription();
    add('своя подписка активна прямо сейчас: ' + !!sub);
    if (sub) {
      try {
        add('  endpoint-хост: ' + new URL(sub.toJSON().endpoint).host);
      } catch (e) {}
    }
    const me = getUser();
    const partner = me === 'gosha' ? 'dasha' : 'gosha';
    add('своя подписка в сейфе (db.pushSubs.' + me + '): ' + !!(db.pushSubs && db.pushSubs[me]));
    add('подписка партнёра в сейфе (db.pushSubs.' + partner + '): ' + !!(db.pushSubs && db.pushSubs[partner]));
    add('PUSH_CONFIG.sendFnUrl: ' + (PUSH_CONFIG.sendFnUrl || 'НЕ ЗАДАН'));
    add('syncReady: ' + (typeof syncReady !== 'undefined' ? syncReady : '?'));
    let token = null;
    try {
      const user = syncFirebase && firebase.auth(syncFirebase).currentUser;
      token = user ? await user.getIdToken() : null;
    } catch (e) {
      add('ошибка getIdToken: ' + String((e && e.message) || e));
    }
    add('Firebase ID-токен получен: ' + !!token);
    if (!sub) {
      add('— тест не отправлен: нет собственной активной подписки —');
      out.textContent = lines.join(String.fromCharCode(10));
      return;
    }
    if (!token || !PUSH_CONFIG.sendFnUrl) {
      add('— тест не отправлен: нет токена авторизации или не задан sendFnUrl —');
      out.textContent = lines.join(String.fromCharCode(10));
      return;
    }
    add('— отправляю тестовый пуш самому себе —');
    try {
      const res = await fetch(PUSH_CONFIG.sendFnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Firebase-Token': token },
        body: JSON.stringify({ subscription: sub.toJSON(), title: '🔔 Тестовое уведомление', body: 'Если видишь это — доставка работает' })
      });
      const text = await res.text();
      add('ответ send-push: ' + res.status + ' ' + text.slice(0, 300));
      add(res.ok ? '— если уведомление не появилось при статусе 200, дело не в коде сайта, а в доставке на этом устройстве/ОС —' : '— функция ответила ошибкой, см. текст выше —');
    } catch (e) {
      add('ошибка запроса к send-push (сеть/CORS): ' + String((e && e.message) || e));
    }
  } catch (e) {
    add('неожиданная ошибка: ' + String((e && e.message) || e));
  }
  out.textContent = lines.join(String.fromCharCode(10));
}
const pushDiagBtnEl = $('#pushDiagBtn');
if (pushDiagBtnEl) pushDiagBtnEl.addEventListener('click', runPushDiagnostics);

// typeof-проверка, а не просто вызов: часть мини-DOM тестовых песочниц
// (tests/uni-*.js) не определяют navigator вообще — без проверки любой такой
// тест падал бы ReferenceError на самой загрузке app.js, а не на реальной
// проверке чего-либо в push-модуле.
if (typeof navigator !== 'undefined') registerServiceWorker();
