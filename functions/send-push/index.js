/* Yandex Cloud Function: отправляет Web Push уведомление (RFC 8291) одному
   партнёру — например, «тебе назначили свидание». Шифрование пейлоада и
   VAPID-подпись делает библиотека `web-push` (не самописная крипто-логика,
   в отличие от остальных функций проекта: ошибка в ручной реализации
   ECDH+HKDF+AES128GCM провалилась бы ТИХО — уведомление просто никогда не
   пришло бы, без единой ошибки на клиенте, и это невозможно проверить без
   реального пуш-сервиса и живого устройства — см. README раздел B4).

   Как это используется (src/96-push.js, notifyPartner): подписка партнёра
   (PushManager.subscribe().toJSON()) хранится ВНУТРИ общего зашифрованного
   сейфа (db.pushSubs) — оба партнёра и так расшифровывают его одним
   мастер-ключом, поэтому это не новая утечка. Клиент, который только что
   создал приглашение или ответил на него, уже знает подписку получателя
   локально и сам дёргает эту функцию напрямую — отдельного триггера на
   запись в базу не нужно (RTDB тут — только канал синхронизации сейфа, не
   полноценный бэкенд).

   Проверка вызывающего — та же схема, что в functions/photo-sign/index.js:
   заголовок X-Firebase-Token (НЕ Authorization — Yandex Cloud перехватывает
   этот конкретный заголовок на уровне платформы ещё до кода функции, см.
   комментарий в photo-sign), проверяется вручную по публичным сертификатам
   Google (RS256), без firebase-admin.

   Переменные окружения (задать в консоли при создании функции):
     VAPID_PUBLIC_KEY    — публичный VAPID-ключ (не секрет, тот же, что и в
                           src/96-push.js PUSH_CONFIG.vapidPublicKey)
     VAPID_PRIVATE_KEY   — приватный VAPID-ключ (СЕКРЕТ, только тут)
     VAPID_SUBJECT        — контакт для push-сервисов при жалобах, формат
                           mailto:you@example.com (по умолчанию — заглушка)
     FIREBASE_PROJECT_ID — id проекта Firebase (по умолчанию nasha-vselennaya)
     ALLOWED_ORIGIN       — домен сайта для CORS (по умолчанию
                           https://ledoksi.github.io) */

const crypto = require('crypto');
const https = require('https');
const webpush = require('web-push');

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'nasha-vselennaya';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://ledoksi.github.io';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:nasha-vselennaya@example.com';

/* ===== Проверка Firebase ID-токена (RS256, без firebase-admin) =====
   Дословно та же логика, что в functions/photo-sign/index.js — см. подробные
   комментарии там. Копия, а не общий модуль: каждая Cloud Function в этом
   проекте деплоится вставкой содержимого index.js целиком в консоль Yandex
   Cloud (см. README), относительные require('../shared') там не сработают. */
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let certsCache = null; // { certs, expiresAt }
function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        let data = '';
        res.on('data', c => {
          data += c;
        });
        res.on('end', () => {
          try {
            resolve({ body: JSON.parse(data), headers: res.headers });
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}
async function getGoogleCerts() {
  if (certsCache && certsCache.expiresAt > Date.now()) return certsCache.certs;
  const { body, headers } = await httpGetJson(GOOGLE_CERTS_URL);
  const maxAgeMatch = /max-age=(\d+)/.exec(headers['cache-control'] || '');
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
  certsCache = { certs: body, expiresAt: Date.now() + maxAge * 1000 };
  return body;
}
function b64urlDecode(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
async function verifyFirebaseIdToken(token) {
  if (!token) throw new Error('нет токена');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('битый токен');
  const header = JSON.parse(b64urlDecode(parts[0]).toString('utf8'));
  const payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error('неверный алгоритм');
  const certs = await getGoogleCerts();
  const cert = certs[header.kid];
  if (!cert) throw new Error('неизвестный kid');
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(parts[0] + '.' + parts[1]);
  if (!verifier.verify(cert, b64urlDecode(parts[2]))) throw new Error('подпись не сходится');
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('токен просрочен');
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) throw new Error('токен из будущего');
  if (payload.aud !== FIREBASE_PROJECT_ID) throw new Error('чужой проект (aud)');
  if (payload.iss !== 'https://securetoken.google.com/' + FIREBASE_PROJECT_ID) throw new Error('чужой issuer');
  if (!payload.sub) throw new Error('нет subject');
  return payload;
}

function isValidSubscription(sub) {
  return !!(sub && typeof sub.endpoint === 'string' && sub.endpoint && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string');
}

module.exports.handler = async event => {
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // Не Authorization — та же платформенная особенность Yandex Cloud, что и
    // в photo-sign (см. комментарий в шапке файла).
    'Access-Control-Allow-Headers': 'X-Firebase-Token, Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'function is missing VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY env vars' }) };
  }
  const headers = event.headers || {};
  const token = String(headers['X-Firebase-Token'] || headers['x-firebase-token'] || '').trim();
  try {
    await verifyFirebaseIdToken(token);
  } catch (e) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'unauthorized: ' + e.message }) };
  }
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'bad json' }) };
  }
  const { subscription, title, body: pushBody } = payload;
  if (!isValidSubscription(subscription)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid subscription' }) };
  }
  if (typeof title !== 'string' || !title.trim() || title.length > 200) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid title' }) };
  }
  // Тело пуша — намеренно без деталей свидания (дата/место/заметка): пуш
  // проходит через чужой push-сервис (Google/Mozilla/Apple) открытым текстом
  // после расшифровки на клиенте, а зашифрованный сейф не даёт серверу
  // вообще ничего знать о содержимом — сохраняем то же свойство и здесь.
  const notificationBody = typeof pushBody === 'string' ? pushBody.slice(0, 300) : '';

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  try {
    await webpush.sendNotification(subscription, JSON.stringify({ title: title.trim(), body: notificationBody }));
  } catch (e) {
    // 404/410 — push-сервис сам сообщает, что подписка больше не действует
    // (например, пользователь снял разрешение на уведомления в браузере) —
    // это не сбой функции, клиенту стоит просто переподписаться.
    const expired = e && (e.statusCode === 404 || e.statusCode === 410);
    return { statusCode: expired ? 410 : 502, headers: cors, body: JSON.stringify({ error: 'push failed: ' + ((e && e.message) || e) }) };
  }
  return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
};

// Только для tests/send-push-auth.js — доступ к внутренностям верификации
// токена без сети (подмена кэша сертификатов), тем же приёмом, что в photo-sign.
module.exports._testing = {
  verifyFirebaseIdToken,
  setCertsForTest(certs) {
    certsCache = { certs, expiresAt: Date.now() + 3600000 };
  }
};
