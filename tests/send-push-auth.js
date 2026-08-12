// Тест Cloud Function send-push (functions/send-push/index.js): та же схема
// авторизации, что у photo-sign (tests/photo-sign-auth.js) — Firebase
// ID-токен через X-Firebase-Token, вручную по публичным сертификатам Google,
// без сети (сертификаты подменяются через _testing.setCertsForTest). Плюс
// валидация тела запроса (подписка/заголовок) и обработка ответа push-сервиса
// (200/410/502) — сама отправка идёт через библиотеку `web-push`, которую тут
// подменяем фейком ДО require() функции, чтобы тесты не делали реальных
// HTTP-запросов во внешний push-сервис (Google/Mozilla) на каждый прогон CI.
// Запуск: node tests/send-push-auth.js
'use strict';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.VAPID_PUBLIC_KEY = 'test-vapid-public';
process.env.VAPID_PRIVATE_KEY = 'test-vapid-private';

const crypto = require('crypto');
const path = require('path');

let lastCall = null;
let sendBehavior = () => Promise.resolve({ statusCode: 201 });
const fakeWebPush = {
  setVapidDetails() {},
  sendNotification(subscription, payload) {
    lastCall = { subscription, payload };
    return sendBehavior();
  }
};
const webPushResolved = require.resolve('web-push');
require.cache[webPushResolved] = { id: webPushResolved, filename: webPushResolved, loaded: true, exports: fakeWebPush };

const fn = require(path.join(__dirname, '..', 'functions', 'send-push', 'index.js'));

let failed = false;
function assert(cond, msg) {
  if (!cond) {
    console.log('FAIL: ' + msg);
    failed = true;
  }
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
const validSub = { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'p256dh-key', auth: 'auth-key' } };

(async () => {
  const good = makeToken({});

  // --- verifyFirebaseIdToken: та же матрица, что у photo-sign ---
  const payload = await fn._testing.verifyFirebaseIdToken(good);
  assert(payload && payload.sub === 'anon-uid-123', 'валидный токен проходит верификацию');
  await fn._testing.verifyFirebaseIdToken('').then(
    () => assert(false, 'пустой токен должен быть отклонён'),
    () => {}
  );
  const expired = makeToken({ exp: Math.floor(Date.now() / 1000) - 10 });
  await fn._testing.verifyFirebaseIdToken(expired).then(
    () => assert(false, 'просроченный токен должен быть отклонён'),
    () => {}
  );
  const wrongAud = makeToken({ aud: 'someone-elses-project' });
  await fn._testing.verifyFirebaseIdToken(wrongAud).then(
    () => assert(false, 'токен для другого проекта должен быть отклонён'),
    () => {}
  );

  // --- OPTIONS: preflight без авторизации ---
  const resOptions = await fn.handler({ httpMethod: 'OPTIONS', headers: {} });
  assert(resOptions.statusCode === 204, 'OPTIONS отвечает 204 без проверки токена');

  // --- Без X-Firebase-Token — 401, до тела запроса дело не доходит ---
  const resNoAuth = await fn.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ subscription: validSub, title: 'x', body: 'y' }) });
  assert(resNoAuth.statusCode === 401, 'handler без X-Firebase-Token отвечает 401');
  assert(lastCall === null, 'без авторизации sendNotification не вызывается');

  // --- Валидный токен, но невалидная подписка — 400 ---
  const resBadSub = await fn.handler({ httpMethod: 'POST', headers: { 'X-Firebase-Token': good }, body: JSON.stringify({ subscription: { endpoint: 'x' }, title: 'x' }) });
  assert(resBadSub.statusCode === 400, 'handler отклоняет подписку без keys.p256dh/auth');

  // --- Валидный токен, подписка ок, но пустой title — 400 ---
  const resBadTitle = await fn.handler({ httpMethod: 'POST', headers: { 'X-Firebase-Token': good }, body: JSON.stringify({ subscription: validSub, title: '' }) });
  assert(resBadTitle.statusCode === 400, 'handler отклоняет пустой title');

  // --- Всё валидно — отправляет и отвечает 200; в пейлоаде только title/body, ничего лишнего (приватность — см. комментарий в index.js) ---
  lastCall = null;
  sendBehavior = () => Promise.resolve({ statusCode: 201 });
  const resOk = await fn.handler({
    httpMethod: 'POST',
    headers: { 'X-Firebase-Token': good },
    body: JSON.stringify({ subscription: validSub, title: '💘 Новое свидание', body: 'Открой приложение' })
  });
  assert(resOk.statusCode === 200, 'handler с валидными данными отвечает 200');
  assert(lastCall && JSON.stringify(lastCall.subscription) === JSON.stringify(validSub), 'sendNotification вызван с подпиской получателя');
  const sentPayload = JSON.parse(lastCall.payload);
  assert(Object.keys(sentPayload).sort().join(',') === 'body,title', 'в пейлоаде пуша только title и body — никаких деталей свидания');
  assert(sentPayload.title === '💘 Новое свидание' && sentPayload.body === 'Открой приложение', 'title/body передаются как есть');

  // --- Push-сервис отвечает «подписка не найдена» (404/410) — handler отдаёт 410, не 500 ---
  sendBehavior = () => {
    const e = new Error('Gone');
    e.statusCode = 410;
    return Promise.reject(e);
  };
  const resGone = await fn.handler({ httpMethod: 'POST', headers: { 'X-Firebase-Token': good }, body: JSON.stringify({ subscription: validSub, title: 'x' }) });
  assert(resGone.statusCode === 410, 'истёкшая подписка (410 от push-сервиса) отдаётся клиенту как 410, не как 500');

  // --- Прочая ошибка отправки — 502, не падение функции ---
  sendBehavior = () => Promise.reject(new Error('network blip'));
  const resFail = await fn.handler({ httpMethod: 'POST', headers: { 'X-Firebase-Token': good }, body: JSON.stringify({ subscription: validSub, title: 'x' }) });
  assert(resFail.statusCode === 502, 'прочая ошибка push-сервиса отдаётся как 502');

  if (failed) process.exit(1);
  console.log('OK: send-push auth + валидация тела + обработка ответа push-сервиса (200/410/502)');
})().catch(e => {
  console.log('FAIL: ' + ((e && e.stack) || e));
  process.exit(1);
});
