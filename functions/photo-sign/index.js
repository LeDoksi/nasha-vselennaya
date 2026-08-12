/* Yandex Cloud Function: выдаёт подписанную (presigned) ссылку на PUT/DELETE
   в Yandex Object Storage. Секретный ключ живёт ТОЛЬКО здесь, в переменных
   окружения функции — в браузер он никогда не попадает.

   Почему это вообще нужно: чтение (GET/ListBucket) в бакете анонимное —
   Yandex Object Storage это разрешает через bucket policy. А вот анонимную
   ЗАПИСЬ (PutObject/DeleteObject) Object Storage не даёт в принципе, даже
   если политика формально её разрешает — для записи нужен подписанный
   запрос. Эта функция и есть тот минимальный «сервер», который держит
   секрет и подписывает запрос вместо клиента.

   Как это используется (src/95-sync.js, makeCloudStorage): клиент делает
   GET на эту функцию с параметрами (method, part, id) и заголовком
   X-Firebase-Token: <Firebase ID-токен>, получает в ответ { url }, и сам
   делает fetch(url, {method, body}) НАПРЯМУЮ в бакет — тело файла через
   функцию не проходит (не упирается в лимит размера запроса функции),
   функция только подписывает.

   Проверка вызывающего: без токена (или с невалидным) функция раньше
   подписывала запрос вообще любому — значит любой, кто откроет devtools на
   сайте (URL функции не секрет, он в открытом app.js), мог удалить/затереть
   чужие фото в бакете. Firebase Admin SDK сюда не тащим (тяжёлая зависимость
   ради одной проверки JWT) — вместо этого руками проверяем подпись Firebase
   ID-токена по публичным сертификатам Google (RS256, тот же алгоритм, что и
   внутри Admin SDK). Анонимный вход не даёт «настоящей» личности (это и не
   нужно — оба партнёра всё равно равноправны), но требует пройти через
   Firebase Auth, а не просто знать URL функции.

   Почему не стандартный заголовок Authorization: проверено на живой
   функции (12.08.2026) — Yandex Cloud перехватывает Authorization на уровне
   своей собственной платформы (пытается понять его как СВОЙ IAM-токен) ещё
   ДО того, как запрос доходит до кода функции; любое значение там, не
   являющееся валидным Yandex IAM-токеном, отклоняется платформой с 403
   раньше, чем успевает сработать проверка ниже. Кастомный заголовок
   X-Firebase-Token этим механизмом не перехватывается.

   Переменные окружения (задать в консоли при создании функции):
     YC_S3_KEY        — статический ключ доступа сервисного аккаунта с ролью
                        storage.editor на бакете (НЕ коммитить, только в консоли)
     YC_S3_SECRET     — секретный ключ к нему
     YC_BUCKET        — имя бакета (по умолчанию nasha-vselennaya)
     YC_REGION        — регион (по умолчанию ru-central1)
     FIREBASE_PROJECT_ID — id проекта Firebase (по умолчанию nasha-vselennaya) —
                        токен должен быть выписан именно для этого проекта
     ALLOWED_ORIGIN    — домен сайта для CORS (по умолчанию https://ledoksi.github.io) */

const crypto = require('crypto');
const https = require('https');

const BUCKET = process.env.YC_BUCKET || 'nasha-vselennaya';
const REGION = process.env.YC_REGION || 'ru-central1';
const ACCESS_KEY = process.env.YC_S3_KEY;
const SECRET_KEY = process.env.YC_S3_SECRET;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'nasha-vselennaya';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://ledoksi.github.io';
const EXPIRES_SECONDS = 60; // ссылка живёт минуту — достаточно, чтобы сразу ей воспользоваться

/* ===== Проверка Firebase ID-токена (RS256, без firebase-admin) =====
   Google публикует свои текущие публичные сертификаты по фиксированному
   URL — кэшируем на время их собственного Cache-Control, чтобы не ходить в
   сеть на каждый запрос. */
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let certsCache = null; // { certs, expiresAt }
function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ body: JSON.parse(data), headers: res.headers }); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
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
// Бросает исключение на любой невалидности; возвращает payload токена (с uid в .sub) на успехе.
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

function hmac(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
}
function sha256hex(msg) {
  return crypto.createHash('sha256').update(msg, 'utf8').digest('hex');
}

// AWS SigV4, вариант с подписью в query-параметрах (presigned URL), а не в
// заголовке Authorization — так браузер может использовать ссылку напрямую.
function presign(method, objectPath) {
  const host = BUCKET + '.storage.yandexcloud.net';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const scope = dateStamp + '/' + REGION + '/s3/aws4_request';
  const credential = ACCESS_KEY + '/' + scope;

  const qp = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(EXPIRES_SECONDS),
    'X-Amz-SignedHeaders': 'host'
  };
  const canonicalQuery = Object.keys(qp).sort()
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(qp[k]))
    .join('&');
  const canonicalHeaders = 'host:' + host + '\n';
  const canonicalRequest = [method, objectPath, canonicalQuery, canonicalHeaders, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  const kDate = hmac('AWS4' + SECRET_KEY, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');

  return 'https://' + host + objectPath + '?' + canonicalQuery + '&X-Amz-Signature=' + signature;
}

module.exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    // Не Authorization: Yandex Cloud перехватывает этот заголовок на уровне
    // своей платформы как попытку IAM-авторизации ещё до кода функции (см.
    // комментарий в шапке файла) — X-Firebase-Token этим не перехватывается,
    // но должен быть явно разрешён здесь, иначе браузер срежет его на преполёте.
    'Access-Control-Allow-Headers': 'X-Firebase-Token, Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (!ACCESS_KEY || !SECRET_KEY) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'function is missing YC_S3_KEY/YC_S3_SECRET env vars' }) };
  }
  const headers = event.headers || {};
  const token = String(headers['X-Firebase-Token'] || headers['x-firebase-token'] || '').trim();
  try {
    await verifyFirebaseIdToken(token);
  } catch (e) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'unauthorized: ' + e.message }) };
  }
  const q = event.queryStringParameters || {};
  const method = String(q.method || '').toUpperCase();
  const part = String(q.part || '');
  const id = String(q.id || '');
  if (method !== 'PUT' && method !== 'DELETE') {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'method must be PUT or DELETE' }) };
  }
  if (part !== 'orig' && part !== 'full' && part !== 'thumb') {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid part' }) };
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid id' }) };
  }
  const objectPath = '/photos/' + part + '/' + encodeURIComponent(id);
  const url = presign(method, objectPath);
  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  };
};

// Только для tests/photo-sign-auth.js — доступ к внутренностям верификации
// токена без сети (подмена кэша сертификатов) и без реальных ключей S3.
module.exports._testing = {
  verifyFirebaseIdToken,
  setCertsForTest(certs) { certsCache = { certs, expiresAt: Date.now() + 3600000 }; }
};
