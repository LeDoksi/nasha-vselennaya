// Тест авторизации Cloud Function photo-sign (functions/photo-sign/index.js):
// без валидного Firebase ID-токена подписывать запрос на PUT/DELETE в бакет
// теперь нельзя — раньше это мог сделать кто угодно, кто открыл devtools на
// сайте (URL функции не секрет). Проверяем verifyFirebaseIdToken() напрямую
// (без сети — сертификаты подменяем через _testing.setCertsForTest) и весь
// handler() целиком на 401/200.
// Запуск: node tests/photo-sign-auth.js
'use strict';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.YC_S3_KEY = 'test-key';
process.env.YC_S3_SECRET = 'test-secret';
process.env.YC_BUCKET = 'test-bucket';

const crypto = require('crypto');
const path = require('path');
const fn = require(path.join(__dirname, '..', 'functions', 'photo-sign', 'index.js'));

let failed = false;
function assert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); failed = true; }
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const certPem = publicKey.export({ type: 'spki', format: 'pem' });
fn._testing.setCertsForTest({ testkid: certPem });

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function makeToken(payloadOverrides, headerOverrides) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: 'testkid', ...headerOverrides };
  const payload = {
    iss: 'https://securetoken.google.com/test-project',
    aud: 'test-project',
    sub: 'anon-uid-123',
    iat: now,
    exp: now + 3600,
    ...payloadOverrides
  };
  const signingInput = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const sig = signer.sign(privateKey);
  return signingInput + '.' + b64url(sig);
}

(async () => {
  // --- Валидный токен принимается ---
  const good = makeToken({});
  const payload = await fn._testing.verifyFirebaseIdToken(good);
  assert(payload && payload.sub === 'anon-uid-123', 'валидный токен проходит верификацию');

  // --- Пустой/отсутствующий токен отклоняется ---
  await fn._testing.verifyFirebaseIdToken('').then(
    () => assert(false, 'пустой токен должен быть отклонён'),
    () => {}
  );

  // --- Просроченный токен отклоняется ---
  const expired = makeToken({ exp: Math.floor(Date.now() / 1000) - 10 });
  await fn._testing.verifyFirebaseIdToken(expired).then(
    () => assert(false, 'просроченный токен должен быть отклонён'),
    () => {}
  );

  // --- Чужой проект (aud) отклоняется ---
  const wrongAud = makeToken({ aud: 'someone-elses-project' });
  await fn._testing.verifyFirebaseIdToken(wrongAud).then(
    () => assert(false, 'токен для другого проекта должен быть отклонён'),
    () => {}
  );

  // --- Чужой issuer отклоняется ---
  const wrongIss = makeToken({ iss: 'https://securetoken.google.com/someone-elses-project' });
  await fn._testing.verifyFirebaseIdToken(wrongIss).then(
    () => assert(false, 'токен с чужим issuer должен быть отклонён'),
    () => {}
  );

  // --- Подделанная подпись (payload изменён после подписи) отклоняется ---
  const tamperedParts = good.split('.');
  const tamperedPayload = b64url(JSON.stringify({ ...JSON.parse(Buffer.from(tamperedParts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')), sub: 'attacker-uid' }));
  const tampered = tamperedParts[0] + '.' + tamperedPayload + '.' + tamperedParts[2];
  await fn._testing.verifyFirebaseIdToken(tampered).then(
    () => assert(false, 'токен с подделанным payload должен быть отклонён (подпись не сойдётся)'),
    () => {}
  );

  // --- Неизвестный алгоритм отклоняется ---
  const wrongAlg = makeToken({}, { alg: 'HS256' });
  await fn._testing.verifyFirebaseIdToken(wrongAlg).then(
    () => assert(false, 'токен не с RS256 должен быть отклонён'),
    () => {}
  );

  // --- handler(): без Authorization — 401, запрос до подписи не доходит ---
  const evNoAuth = { httpMethod: 'GET', headers: {}, queryStringParameters: { method: 'PUT', part: 'orig', id: 'photo1' } };
  const resNoAuth = await fn.handler(evNoAuth);
  assert(resNoAuth.statusCode === 401, 'handler без Authorization отвечает 401 (было: подписывал всем)');

  // --- handler(): с валидным токеном — подписывает как раньше ---
  const evAuth = { httpMethod: 'GET', headers: { Authorization: 'Bearer ' + good }, queryStringParameters: { method: 'PUT', part: 'orig', id: 'photo1' } };
  const resAuth = await fn.handler(evAuth);
  assert(resAuth.statusCode === 200, 'handler с валидным токеном отвечает 200');
  const body = JSON.parse(resAuth.body);
  assert(typeof body.url === 'string' && body.url.includes('/photos/orig/photo1'), 'handler возвращает подписанную ссылку на нужный объект');

  // --- handler(): невалидные method/part/id всё ещё отклоняются ПОСЛЕ авторизации ---
  const evBadMethod = { httpMethod: 'GET', headers: { Authorization: 'Bearer ' + good }, queryStringParameters: { method: 'GET', part: 'orig', id: 'photo1' } };
  const resBadMethod = await fn.handler(evBadMethod);
  assert(resBadMethod.statusCode === 400, 'handler всё ещё валидирует method после авторизации');

  if (failed) process.exit(1);
  console.log('OK: photo-sign auth — валидный/просроченный/чужой/поддельный/неавторизованный токены обработаны верно');
})().catch(e => { console.log('FAIL: ' + (e && e.stack || e)); process.exit(1); });
