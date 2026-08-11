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
   GET на эту функцию с параметрами (method, part, id), получает в ответ
   { url }, и сам делает fetch(url, {method, body}) НАПРЯМУЮ в бакет — тело
   файла через функцию не проходит (не упирается в лимит размера запроса
   функции), функция только подписывает.

   Переменные окружения (задать в консоли при создании функции):
     YC_S3_KEY     — статический ключ доступа сервисного аккаунта с ролью
                     storage.editor на бакете (НЕ коммитить, только в консоли)
     YC_S3_SECRET  — секретный ключ к нему
     YC_BUCKET     — имя бакета (по умолчанию nasha-vselennaya)
     YC_REGION     — регион (по умолчанию ru-central1)
     ALLOWED_ORIGIN — домен сайта для CORS (по умолчанию * — можно сузить
                     до https://ledoksi.github.io) */

const crypto = require('crypto');

const BUCKET = process.env.YC_BUCKET || 'nasha-vselennaya';
const REGION = process.env.YC_REGION || 'ru-central1';
const ACCESS_KEY = process.env.YC_S3_KEY;
const SECRET_KEY = process.env.YC_S3_SECRET;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const EXPIRES_SECONDS = 60; // ссылка живёт минуту — достаточно, чтобы сразу ей воспользоваться

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
    'Access-Control-Allow-Headers': '*'
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (!ACCESS_KEY || !SECRET_KEY) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'function is missing YC_S3_KEY/YC_S3_SECRET env vars' }) };
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
