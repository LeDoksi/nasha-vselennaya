# Ленивая загрузка фото (модель iCloud) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть бакет Yandex Object Storage от анонимного чтения, переведя все GET/LIST-запросы на подписанные ссылки от Cloud Function `photo-sign` (batch-режим для пачек), и заменить полную эеgerную сверку фото на модель iCloud: фоновая очередь качает только миниатюры, `full`/`orig` докачиваются лениво при реальном открытии фото.

**Architecture:** `photo-sign` расширяется с `PUT|DELETE` до `PUT|DELETE|GET|LIST` + новый batch-режим (`POST` с JSON-телом). Клиентский адаптер (`makeCloudStorage`) переводит `getBlob()`/`listAll()` на presigned-запросы вместо анонимных. `syncPhotos()` эagerно докачивает только `thumb`; `photoUrl()`/`photoOrigUrl()` (единая точка чтения фото для рендеров) при отсутствии локального блоба лениво доносят недостающую часть через новую `ensureCloudPart(id, part)`.

**Tech Stack:** Vanilla JS (без фреймворков и новых зависимостей — тот же стиль, что у существующего кода), Node.js Cloud Function (Yandex Cloud, без npm-зависимостей — как сейчас), AWS SigV4 presigned URLs (уже реализовано в `presign()`), мини-DOM/mock-fetch тестовые харнессы этого репозитория (`tests/*.js`, `node <file> app.js`).

**Spec:** [docs/superpowers/specs/2026-09-17-lazy-photo-loading-design.md](../specs/2026-09-17-lazy-photo-loading-design.md)

## Global Constraints

- Никаких новых npm-зависимостей ни в `functions/photo-sign/`, ни в клиентском коде — тот же ноль зависимостей, что сейчас.
- Аутентификация Cloud Function остаётся заголовком `X-Firebase-Token` (не `Authorization` — Yandex Cloud перехватывает его на уровне платформы, см. комментарий в `functions/photo-sign/index.js:29-35`).
- `EXPIRES_SECONDS=60` для PUT/DELETE не меняется; для GET/LIST/batch — новая константа `GET_EXPIRES_SECONDS=300`.
- Batch-запрос — не более **100** элементов (`MAX_BATCH_ITEMS`), иначе весь запрос отклоняется 400-м.
- Каждая задача заканчивается: `node build.js` (для клиентских задач) → соответствующий тестовый файл зелёный → `npm run lint` чист → коммит с суффиксом `(NV-7)`.
- Флип политики бакета на приватную — **ручной шаг в консоли Yandex Cloud, не код** (Task 10) — выполняется владельцем после того, как новый `app.js` реально долетел до обоих устройств.

---

### Task 1: `photo-sign` — presign() принимает доп. query-параметры и срок жизни

**Files:**
- Modify: `functions/photo-sign/index.js:135-168` (функция `presign`)
- Test: `tests/photo-sign-auth.js`

**Interfaces:**
- Produces: `presign(method, objectPath, extraQuery = {}, expiresSeconds = EXPIRES_SECONDS)` — extraQuery попадает в подписываемый canonical query string вместе с `X-Amz-*`. Нужна задачам 2 и 3.

- [ ] **Step 1: Написать тест на новую сигнатуру `presign` (через handler, т.к. `presign` не экспортируется напрямую — проверяем по факту, что PUT продолжает работать с дефолтным сроком жизни)**

Добавить в `tests/photo-sign-auth.js` перед строкой `if (failed) process.exit(1);`:

```js
  // --- presign(): доп. query-параметры и срок жизни не ломают обычный PUT/DELETE ---
  const resPutStillWorks = await fn.handler({ httpMethod: 'GET', headers: { 'X-Firebase-Token': good }, queryStringParameters: { method: 'DELETE', part: 'thumb', id: 'photo9' } });
  assert(resPutStillWorks.statusCode === 200, 'presign: DELETE по-прежнему подписывается с дефолтным EXPIRES_SECONDS (регресс после рефакторинга presign)');
  const putBody = JSON.parse(resPutStillWorks.body);
  assert(putBody.url.includes('X-Amz-Expires=60'), 'presign: PUT/DELETE используют EXPIRES_SECONDS=60, а не GET_EXPIRES_SECONDS');
```

- [ ] **Step 2: Запустить тест, убедиться, что он проходит и на старом коде (это регрессионный тест, не новая фича)**

Run: `node tests/photo-sign-auth.js`
Expected: `OK: photo-sign auth — …` (проходит уже сейчас — фиксируем текущее поведение перед рефакторингом)

- [ ] **Step 3: Обобщить `presign()`**

В `functions/photo-sign/index.js` заменить (строки 135-168):

```js
function presign(method, objectPath) {
  const host = BUCKET + '.storage.yandexcloud.net';
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
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
```

на:

```js
function presign(method, objectPath, extraQuery, expiresSeconds) {
  const host = BUCKET + '.storage.yandexcloud.net';
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const scope = dateStamp + '/' + REGION + '/s3/aws4_request';
  const credential = ACCESS_KEY + '/' + scope;

  const qp = {
    ...extraQuery,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds || EXPIRES_SECONDS),
    'X-Amz-SignedHeaders': 'host'
  };
```

(остальное тело функции — canonicalQuery/canonicalHeaders/signature — не меняется: `Object.keys(qp).sort()` уже включит и extraQuery-ключи в подпись, раз они попали в `qp` до сортировки.)

Добавить константу рядом с `EXPIRES_SECONDS` (строка 56):

```js
const EXPIRES_SECONDS = 60; // ссылка живёт минуту — достаточно, чтобы сразу ей воспользоваться
const GET_EXPIRES_SECONDS = 300; // чтение (в т.ч. пачка миниатюр) может идти дольше на слабой сети
```

- [ ] **Step 4: Запустить тест — убедиться, что PUT/DELETE не сломались**

Run: `node tests/photo-sign-auth.js`
Expected: `OK: photo-sign auth — …`

- [ ] **Step 5: Commit**

```bash
git add functions/photo-sign/index.js tests/photo-sign-auth.js
git commit -m "Refactor: presign() принимает доп. query и срок жизни (NV-7, шаг 1/10)"
```

---

### Task 2: `photo-sign` — метод `GET` (чтение объекта)

**Files:**
- Modify: `functions/photo-sign/index.js:170-213` (`module.exports.handler`)
- Test: `tests/photo-sign-auth.js`

**Interfaces:**
- Consumes: `presign(method, objectPath, extraQuery, expiresSeconds)` из Task 1.
- Produces: `handler` теперь подписывает `method=GET` тем же контрактом `{url}`, что и PUT/DELETE.

- [ ] **Step 1: Написать тест на GET и на то, что старый тест "GET отклоняется" больше не актуален**

В `tests/photo-sign-auth.js` заменить блок (строки 132-135):

```js
  // --- handler(): невалидные method/part/id всё ещё отклоняются ПОСЛЕ авторизации ---
  const evBadMethod = { httpMethod: 'GET', headers: { 'X-Firebase-Token': good }, queryStringParameters: { method: 'GET', part: 'orig', id: 'photo1' } };
  const resBadMethod = await fn.handler(evBadMethod);
  assert(resBadMethod.statusCode === 400, 'handler всё ещё валидирует method после авторизации');
```

на:

```js
  // --- handler(): невалидные method/part/id всё ещё отклоняются ПОСЛЕ авторизации ---
  const evBadMethod = { httpMethod: 'GET', headers: { 'X-Firebase-Token': good }, queryStringParameters: { method: 'PATCH', part: 'orig', id: 'photo1' } };
  const resBadMethod = await fn.handler(evBadMethod);
  assert(resBadMethod.statusCode === 400, 'handler всё ещё валидирует method после авторизации');

  // --- handler(): method=GET теперь подписывается (было 400 — чтение уходит
  // с анонимного доступа на подписанные ссылки, см. NV-7) ---
  const evGet = { httpMethod: 'GET', headers: { 'X-Firebase-Token': good }, queryStringParameters: { method: 'GET', part: 'thumb', id: 'photo1' } };
  const resGet = await fn.handler(evGet);
  assert(resGet.statusCode === 200, 'handler подписывает GET (чтение объекта) как PUT/DELETE');
  const getBody = JSON.parse(resGet.body);
  assert(getBody.url.includes('/photos/thumb/photo1'), 'handler(GET) возвращает подписанную ссылку на нужный объект');
  assert(getBody.url.includes('X-Amz-Expires=300'), 'handler(GET) использует GET_EXPIRES_SECONDS, а не 60-секундный срок записи');
```

- [ ] **Step 2: Запустить тест, убедиться, что он падает**

Run: `node tests/photo-sign-auth.js`
Expected: `FAIL: handler подписывает GET …` (сейчас `method !== 'PUT' && method !== 'DELETE'` → 400)

- [ ] **Step 3: Разрешить GET в handler'е**

В `functions/photo-sign/index.js` заменить (строки 193-207):

```js
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
```

на:

```js
  const q = event.queryStringParameters || {};
  const method = String(q.method || '').toUpperCase();
  if (method === 'LIST') return handleList(q, cors); // Task 3
  const part = String(q.part || '');
  const id = String(q.id || '');
  if (method !== 'PUT' && method !== 'DELETE' && method !== 'GET') {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'method must be PUT, DELETE, GET or LIST' }) };
  }
  if (!ID_RE.test(part) || (part !== 'orig' && part !== 'full' && part !== 'thumb')) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid part' }) };
  }
  if (!ID_RE.test(id)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid id' }) };
  }
  const objectPath = '/photos/' + part + '/' + encodeURIComponent(id);
  const url = presign(method, objectPath, undefined, method === 'GET' ? GET_EXPIRES_SECONDS : EXPIRES_SECONDS);
```

Заметка: `ID_RE` и `handleList` появятся в Task 3 (LIST) — на этом шаге `handleList` ещё не существует, поэтому временно (только для прохождения ЭТОГО шага) заменить вызов `handleList(q, cors)` на инлайн-заглушку не нужно: вместо этого добавить прямо сейчас регэксп и убрать ветку LIST, чтобы Task 2 был самодостаточным:

```js
  const q = event.queryStringParameters || {};
  const method = String(q.method || '').toUpperCase();
  const part = String(q.part || '');
  const id = String(q.id || '');
  if (method !== 'PUT' && method !== 'DELETE' && method !== 'GET') {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'method must be PUT, DELETE or GET' }) };
  }
  if (part !== 'orig' && part !== 'full' && part !== 'thumb') {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid part' }) };
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid id' }) };
  }
  const objectPath = '/photos/' + part + '/' + encodeURIComponent(id);
  const url = presign(method, objectPath, undefined, method === 'GET' ? GET_EXPIRES_SECONDS : EXPIRES_SECONDS);
```

(Используй эту, вторую версию — она не ссылается на `handleList`/`ID_RE`, которых ещё нет. `ID_RE` и `handleList` вводятся в Task 3 самостоятельным рефакторингом.)

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `node tests/photo-sign-auth.js`
Expected: `OK: photo-sign auth — …`

- [ ] **Step 5: Commit**

```bash
git add functions/photo-sign/index.js tests/photo-sign-auth.js
git commit -m "Feat: photo-sign подписывает GET — чтение объекта (NV-7, шаг 2/10)"
```

---

### Task 3: `photo-sign` — метод `LIST` (листинг бакета)

**Files:**
- Modify: `functions/photo-sign/index.js`
- Test: `tests/photo-sign-auth.js`

**Interfaces:**
- Consumes: `presign(method, objectPath, extraQuery, expiresSeconds)` из Task 1.
- Produces: `handler` подписывает `method=LIST&prefix=...&continuation-token=...` → `{url}` на `ListObjectsV2` (объект `?list-type=2&prefix=...`).

- [ ] **Step 1: Написать тест на LIST**

В `tests/photo-sign-auth.js` добавить после блока `evGet`/`getBody` из Task 2:

```js
  // --- handler(): method=LIST подписывает листинг бакета (было анонимно) ---
  const evList = { httpMethod: 'GET', headers: { 'X-Firebase-Token': good }, queryStringParameters: { method: 'LIST', prefix: 'photos/thumb/' } };
  const resList = await fn.handler(evList);
  assert(resList.statusCode === 200, 'handler подписывает LIST (листинг бакета)');
  const listBody = JSON.parse(resList.body);
  assert(listBody.url.includes('list-type=2'), 'handler(LIST) возвращает ссылку на ListObjectsV2');
  assert(listBody.url.includes('prefix=photos%2Fthumb%2F'), 'handler(LIST) прокидывает prefix в подписанный запрос');
  assert(!listBody.url.includes('/photos/thumb/?'), 'handler(LIST) подписывает корень бакета, а не объект');

  // --- handler(): LIST с continuation-token (пагинация) ---
  const evListPage = { httpMethod: 'GET', headers: { 'X-Firebase-Token': good }, queryStringParameters: { method: 'LIST', prefix: 'photos/thumb/', 'continuation-token': 'tok123' } };
  const resListPage = await fn.handler(evListPage);
  assert(resListPage.statusCode === 200, 'handler(LIST) принимает continuation-token');
  assert(JSON.parse(resListPage.body).url.includes('continuation-token=tok123'), 'handler(LIST) подписывает continuation-token, иначе подпись S3 не сойдётся');
```

- [ ] **Step 2: Запустить тест, убедиться, что падает**

Run: `node tests/photo-sign-auth.js`
Expected: `FAIL: handler подписывает LIST …` (сейчас `method=LIST` попадает в общую ветку и получает 400 «invalid part», т.к. `part` пуст)

- [ ] **Step 3: Реализовать LIST**

В `functions/photo-sign/index.js` добавить перед `module.exports.handler` (после функции `presign`):

```js
function handleList(q, cors) {
  const prefix = String(q.prefix || '');
  if (!/^photos\/(orig|full|thumb)\/?$/.test(prefix)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid prefix' }) };
  }
  const extraQuery = { 'list-type': '2', prefix };
  const token = q['continuation-token'];
  if (token) extraQuery['continuation-token'] = String(token);
  const url = presign('GET', '/', extraQuery, GET_EXPIRES_SECONDS);
  return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) };
}
```

Заменить блок валидации метода (из Task 2, вторая версия) на финальную:

```js
  const q = event.queryStringParameters || {};
  const method = String(q.method || '').toUpperCase();
  if (method === 'LIST') return handleList(q, cors);
  const part = String(q.part || '');
  const id = String(q.id || '');
  if (method !== 'PUT' && method !== 'DELETE' && method !== 'GET') {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'method must be PUT, DELETE, GET or LIST' }) };
  }
  if (part !== 'orig' && part !== 'full' && part !== 'thumb') {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid part' }) };
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid id' }) };
  }
  const objectPath = '/photos/' + part + '/' + encodeURIComponent(id);
  const url = presign(method, objectPath, undefined, method === 'GET' ? GET_EXPIRES_SECONDS : EXPIRES_SECONDS);
```

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `node tests/photo-sign-auth.js`
Expected: `OK: photo-sign auth — …`

- [ ] **Step 5: Commit**

```bash
git add functions/photo-sign/index.js tests/photo-sign-auth.js
git commit -m "Feat: photo-sign подписывает LIST — листинг бакета (NV-7, шаг 3/10)"
```

---

### Task 4: `photo-sign` — batch-режим (`POST`)

**Files:**
- Modify: `functions/photo-sign/index.js`
- Test: `tests/photo-sign-auth.js`

**Interfaces:**
- Consumes: `presign()` из Task 1, `verifyFirebaseIdToken()` (существующая).
- Produces: `POST` с `{items:[{part,id}]}` → `{results:[{id,part,url}|{id,part,error}]}`. Ограничение 100 элементов.

- [ ] **Step 1: Написать тест на batch**

В `tests/photo-sign-auth.js` добавить после блока LIST:

```js
  // --- handler(): POST — batch-подпись пачки объектов одним запросом ---
  const evBatch = {
    httpMethod: 'POST',
    headers: { 'X-Firebase-Token': good },
    body: JSON.stringify({ items: [{ part: 'thumb', id: 'photo1' }, { part: 'thumb', id: 'photo2' }] })
  };
  const resBatch = await fn.handler(evBatch);
  assert(resBatch.statusCode === 200, 'handler(POST batch) отвечает 200');
  const batchBody = JSON.parse(resBatch.body);
  assert(Array.isArray(batchBody.results) && batchBody.results.length === 2, 'batch возвращает по одной записи на item');
  assert(batchBody.results[0].id === 'photo1' && batchBody.results[0].url.includes('/photos/thumb/photo1'), 'batch: первый item подписан верно');
  assert(batchBody.results[1].id === 'photo2' && batchBody.results[1].url.includes('/photos/thumb/photo2'), 'batch: второй item подписан верно');

  // --- handler(): batch без валидного токена — 401, до тела запроса дело не доходит ---
  const evBatchNoAuth = { httpMethod: 'POST', headers: {}, body: JSON.stringify({ items: [{ part: 'thumb', id: 'photo1' }] }) };
  const resBatchNoAuth = await fn.handler(evBatchNoAuth);
  assert(resBatchNoAuth.statusCode === 401, 'handler(POST batch) без токена — 401');

  // --- handler(): один невалидный item не роняет остальные ---
  const evBatchMixed = {
    httpMethod: 'POST',
    headers: { 'X-Firebase-Token': good },
    body: JSON.stringify({ items: [{ part: 'thumb', id: 'photo1' }, { part: 'bogus', id: 'photo2' }] })
  };
  const resBatchMixed = await fn.handler(evBatchMixed);
  assert(resBatchMixed.statusCode === 200, 'handler(POST batch) с одним плохим item всё равно отвечает 200');
  const mixedBody = JSON.parse(resBatchMixed.body);
  assert(mixedBody.results[0].url && !mixedBody.results[0].error, 'batch: валидный item получает url');
  assert(mixedBody.results[1].error && !mixedBody.results[1].url, 'batch: невалидный item получает error, а не url');

  // --- handler(): батч больше 100 элементов отклоняется целиком ---
  const tooMany = { items: Array.from({ length: 101 }, (_, i) => ({ part: 'thumb', id: 'p' + i })) };
  const resTooMany = await fn.handler({ httpMethod: 'POST', headers: { 'X-Firebase-Token': good }, body: JSON.stringify(tooMany) });
  assert(resTooMany.statusCode === 400, 'handler(POST batch) с 101 элементом отклоняется целиком (лимит 100)');
```

- [ ] **Step 2: Запустить тест, убедиться, что падает**

Run: `node tests/photo-sign-auth.js`
Expected: `FAIL: handler(POST batch) отвечает 200` (сейчас `event.httpMethod === 'OPTIONS'` — единственная развилка по методу, POST падает в общую GET-логику и ломается на `event.queryStringParameters`)

- [ ] **Step 3: Реализовать batch**

В `functions/photo-sign/index.js`:

1. Добавить константу рядом с `GET_EXPIRES_SECONDS`:

```js
const MAX_BATCH_ITEMS = 100;
```

2. Добавить функцию перед `module.exports.handler`:

```js
function presignBatchItem(item) {
  const part = String((item && item.part) || '');
  const id = String((item && item.id) || '');
  if (part !== 'orig' && part !== 'full' && part !== 'thumb') return { id, part, error: 'invalid part' };
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return { id, part, error: 'invalid id' };
  const objectPath = '/photos/' + part + '/' + encodeURIComponent(id);
  return { id, part, url: presign('GET', objectPath, undefined, GET_EXPIRES_SECONDS) };
}

function handleBatch(body) {
  let parsed;
  try {
    parsed = JSON.parse(body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'invalid JSON body' }) };
  }
  const items = Array.isArray(parsed.items) ? parsed.items : null;
  if (!items) return { statusCode: 400, body: JSON.stringify({ error: 'items must be an array' }) };
  if (items.length > MAX_BATCH_ITEMS) return { statusCode: 400, body: JSON.stringify({ error: 'too many items (max ' + MAX_BATCH_ITEMS + ')' }) };
  const results = items.map(presignBatchItem);
  return { statusCode: 200, body: JSON.stringify({ results }) };
}
```

(Заголовки CORS добавляются в вызывающем коде — `handleBatch` возвращает только `statusCode`/`body`, как и остальные ветки, чтобы не дублировать `cors`.)

3. В `module.exports.handler` заменить (после блока CORS/OPTIONS/ключей, перед проверкой токена):

```js
  const headers = event.headers || {};
  const token = String(headers['X-Firebase-Token'] || headers['x-firebase-token'] || '').trim();
  try {
    await verifyFirebaseIdToken(token);
  } catch (e) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'unauthorized: ' + e.message }) };
  }
  const q = event.queryStringParameters || {};
```

на:

```js
  const headers = event.headers || {};
  const token = String(headers['X-Firebase-Token'] || headers['x-firebase-token'] || '').trim();
  try {
    await verifyFirebaseIdToken(token);
  } catch (e) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'unauthorized: ' + e.message }) };
  }
  if (event.httpMethod === 'POST') {
    const r = handleBatch(event.body);
    return { statusCode: r.statusCode, headers: { ...cors, 'Content-Type': 'application/json' }, body: r.body };
  }
  const q = event.queryStringParameters || {};
```

4. Разрешить POST в CORS (строка 173):

```js
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
```

на:

```js
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
```

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `node tests/photo-sign-auth.js`
Expected: `OK: photo-sign auth — …`

- [ ] **Step 5: Обновить шапку-комментарий файла (строки 1-45)** — дописать про GET/LIST/batch в описание (это не код, но следующий читатель файла должен понимать актуальный контракт функции, а не только историю PUT/DELETE). Добавить после абзаца про `X-Firebase-Token` (перед «Переменные окружения»):

```js
   NV-7: функция теперь подписывает не только запись, но и чтение — GET
   (один объект), LIST (листинг бакета, для сверки) и batch (POST с телом
   {items:[{part,id}]}, до 100 штук за раз — фоновая очередь миниатюр не
   делает по одному HTTP-запросу на подпись на каждое фото). Бакет закрыт от
   анонимного чтения точно так же, как раньше была закрыта запись — см.
   README, раздел B2. */
```

- [ ] **Step 6: Commit**

```bash
git add functions/photo-sign/index.js tests/photo-sign-auth.js
git commit -m "Feat: photo-sign — batch-подпись пачки объектов (NV-7, шаг 4/10)"
```

---

### Task 5: Клиент — общий помощник авторизации + presign-запрос (`src/95-photos-cloud.js`)

**Files:**
- Modify: `src/95-photos-cloud.js:132-160` (`presignedFetch`, внутри `makeCloudStorage`)
- Test: `tests/uni-photo-sync.js`

**Interfaces:**
- Produces: `firebaseAuthHeader()` — общий хелпер для всех вызовов `photo-sign` (используется в Task 5, 6, 7). `presignFn(query)` — один presign-запрос, возвращает `url` (строку), без похода за байтами.

- [ ] **Step 1: Написать тест на то, что чтение объекта теперь идёт через подпись, а не анонимно**

В `tests/uni-photo-sync.js`, в сценарии «3. «Второе устройство»…» (после строки `await w('(s)=>s.syncPhotos()');` из блока 3) добавить проверку, что GET-запросы объекта тоже засветились в `signCalls`:

```js
  assert(
    signCalls.some(c => c.method === 'GET' && c.part === 'thumb' && c.id === 'pA'),
    'скачивание миниатюры теперь запрашивает подписанную ссылку у photo-sign, а не читает бакет анонимно (NV-7)'
  );
```

(Разместить сразу после существующего `assert(idsA.some(...` в блоке 3.)

- [ ] **Step 2: Запустить тест, убедиться, что падает**

Run: `node build.js && node tests/uni-photo-sync.js app.js`
Expected: `FAIL: скачивание миниатюры теперь запрашивает подписанную ссылку …` (сейчас `getBlob()` делает анонимный `s3Fetch`, в `signCalls` GET не попадает)

- [ ] **Step 3: Реализовать**

В `src/95-photos-cloud.js` заменить блок `presignedFetch` (строки 132-160):

```js
  async function presignedFetch(method, part, id, body) {
    if (!cfg.signFnUrl) throw new Error('YANDEX_CLOUD_CONFIG.signFnUrl не задан — запись фото невозможна');
    // photo-sign проверяет Firebase ID-токен перед выдачей подписи (иначе
    // подписать мог бы кто угодно, кто откроет devtools — URL функции не
    // секрет). Токен берём у уже выполненного Google-входа (src/01-gate.js) —
    // fbApp, единственное Firebase-приложение на весь сайт (гейт + фото).
    // Заголовок называется X-Firebase-Token, а не Authorization: Yandex
    // Cloud перехватывает Authorization на уровне своей платформы (пытается
    // прочитать его как СВОЙ IAM-токен) ещё до кода функции — с этим именем
    // валидный Firebase-токен долетал бы до кода, но платформа режет запрос
    // раньше 403-м, даже не заглянув внутрь (проверено 12.08.2026).
    let authHeaders = {};
    try {
      const user = fbApp && firebase.auth(fbApp).currentUser;
      if (user) authHeaders = { 'X-Firebase-Token': await user.getIdToken() };
    } catch (e) {
      console.warn('[photo-sync] не удалось получить ID-токен для photo-sign', e);
    }
    const signRes = await fetch(cfg.signFnUrl + '?method=' + method + '&part=' + encodeURIComponent(part) + '&id=' + encodeURIComponent(id), { headers: authHeaders });
    if (!signRes.ok) throw new Error('sign-fn ' + signRes.status);
    const { url } = await signRes.json();
    if (!url) throw new Error('sign-fn: пустая ссылка');
    const res = await fetch(url, { method, body: body ?? undefined });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('S3 ' + res.status + ' photos/' + part + '/' + id + (txt ? ': ' + txt.slice(0, 200) : ''));
    }
    return res;
  }
```

на:

```js
  // Общий заголовок авторизации для любого вызова photo-sign (GET/PUT/DELETE/
  // LIST/batch) — вынесено, чтобы не дублировать в каждом из четырёх мест
  // (NV-7: раньше было одно место записи, теперь ещё три — чтение, листинг,
  // batch). Токен берём у уже выполненного Google-входа (src/01-gate.js) —
  // fbApp, единственное Firebase-приложение на весь сайт (гейт + фото).
  async function firebaseAuthHeader() {
    try {
      const user = fbApp && firebase.auth(fbApp).currentUser;
      if (user) return { 'X-Firebase-Token': await user.getIdToken() };
    } catch (e) {
      console.warn('[photo-sync] не удалось получить ID-токен для photo-sign', e);
    }
    return {};
  }

  // Один запрос подписи (GET/PUT/DELETE одного объекта, или LIST) — только
  // ссылка, без похода за байтами. query — объект строковых параметров
  // (method, part, id — для объекта; method=LIST, prefix, continuation-token
  // — для листинга).
  async function presignFn(query) {
    if (!cfg.signFnUrl) throw new Error('YANDEX_CLOUD_CONFIG.signFnUrl не задан — доступ к фото невозможен');
    const authHeaders = await firebaseAuthHeader();
    const qs = new URLSearchParams(query).toString();
    const signRes = await fetch(cfg.signFnUrl + '?' + qs, { headers: authHeaders });
    if (!signRes.ok) throw new Error('sign-fn ' + signRes.status);
    const { url } = await signRes.json();
    if (!url) throw new Error('sign-fn: пустая ссылка');
    return url;
  }

  async function presignedFetch(method, part, id, body) {
    const url = await presignFn({ method, part, id });
    const res = await fetch(url, { method, body: body ?? undefined });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('S3 ' + res.status + ' photos/' + part + '/' + id + (txt ? ': ' + txt.slice(0, 200) : ''));
    }
    return res;
  }
```

Заменить `getBlob()` внутри `ref()` (строки 182-189):

```js
          async getBlob() {
            try {
              const res = await s3Fetch('GET', p, null);
              return await res.blob();
            } catch (e) {
              if (/404/.test(String(e))) return null;
              throw e;
            }
          },
```

на:

```js
          async getBlob() {
            try {
              const res = await presignedFetch('GET', part, id, null);
              return await res.blob();
            } catch (e) {
              if (/404/.test(String(e))) return null;
              throw e;
            }
          },
```

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `node build.js && node tests/uni-photo-sync.js app.js`
Expected: `OK: … photo-sync checks passed`

Также запустить полный набор — presignedFetch теперь всегда сначала запрашивает подпись даже для GET, мок `fetchMock` в `tests/uni-photo-sync.js` уже умеет отвечать на `SIGN_FN_URL` с любым `method` (строки 114-123 мока не проверяют конкретное значение method) — регрессий по остальным сценариям файла быть не должно, но нужно убедиться:

Run: `npm test`
Expected: все `OK:` строки, без `FAIL`

- [ ] **Step 5: Commit**

```bash
git add src/95-photos-cloud.js app.js tests/uni-photo-sync.js
git commit -m "Feat: чтение объекта фото идёт через подписанную ссылку (NV-7, шаг 5/10)"
```

---

### Task 6: Клиент — presigned LIST (`listAll`)

**Files:**
- Modify: `src/95-photos-cloud.js:200-228` (`ref()`, ветка листинга)
- Test: `tests/uni-photo-sync.js`

**Interfaces:**
- Consumes: `presignFn(query)` из Task 5.
- Produces: `listAll()` больше не читает бакет анонимно.

- [ ] **Step 1: Написать тест**

В `tests/uni-photo-sync.js`, рядом с проверкой из Task 5 (сценарий 3), добавить:

```js
  assert(
    signCalls.some(c => c.method === 'LIST'),
    'листинг бакета теперь запрашивает подписанную ссылку у photo-sign, а не читает бакет анонимно (NV-7)'
  );
```

Мок `fetchMock` (строка 114-123) сейчас читает `qs.get('method')`/`part`/`id` через `URLSearchParams` — для LIST понадобится, чтобы мок понимал `method=LIST` и возвращал ссылку на `/` (не на `/photos/{part}/{id}`), иначе следующий `GET` по этой ссылке не попадёт в ветку `pathname === '/' && list-type=2`. Обновить мок (строки 114-123):

```js
  if (String(url).indexOf(SIGN_FN_URL) === 0) {
    // Мок функции подписи: не проверяет секрет (его тут и нет), просто
    // возвращает «подписанную» ссылку на тот же мок-бакет — signature фиктивна,
    // мок PUT/DELETE её не проверяет (проверка подписи — забота реального S3,
    // а не нашего кода; здесь тестируем контракт «функция → presigned URL → PUT»).
    const qs = new URLSearchParams(full.slice(qIdx + 1));
    signCalls.push({ method: qs.get('method'), part: qs.get('part'), id: qs.get('id') });
    const target = 'https://nasha-vselennaya.storage.yandexcloud.net/photos/' + qs.get('part') + '/' + qs.get('id') + '?X-Amz-Signature=mock';
    return { ok: true, status: 200, json: () => Promise.resolve({ url: target }) };
  }
```

на:

```js
  if (String(url).indexOf(SIGN_FN_URL) === 0) {
    // Мок функции подписи: не проверяет секрет (его тут и нет), просто
    // возвращает «подписанную» ссылку на тот же мок-бакет — signature фиктивна,
    // мок PUT/DELETE её не проверяет (проверка подписи — забота реального S3,
    // а не нашего кода; здесь тестируем контракт «функция → presigned URL → операция»).
    const qs = new URLSearchParams(full.slice(qIdx + 1));
    const method = qs.get('method');
    signCalls.push({ method, part: qs.get('part'), id: qs.get('id') });
    if (method === 'LIST') {
      const listQs = new URLSearchParams();
      listQs.set('list-type', '2');
      listQs.set('prefix', qs.get('prefix') || '');
      const token = qs.get('continuation-token');
      if (token) listQs.set('continuation-token', token);
      const target = 'https://nasha-vselennaya.storage.yandexcloud.net/?' + listQs.toString() + '&X-Amz-Signature=mock';
      return { ok: true, status: 200, json: () => Promise.resolve({ url: target }) };
    }
    const target = 'https://nasha-vselennaya.storage.yandexcloud.net/photos/' + qs.get('part') + '/' + qs.get('id') + '?X-Amz-Signature=mock';
    return { ok: true, status: 200, json: () => Promise.resolve({ url: target }) };
  }
```

- [ ] **Step 2: Запустить тест, убедиться, что падает**

Run: `node build.js && node tests/uni-photo-sync.js app.js`
Expected: `FAIL: листинг бакета теперь запрашивает подписанную ссылку …`

- [ ] **Step 3: Реализовать**

В `src/95-photos-cloud.js` заменить ветку листинга внутри `ref()` (строки 200-228):

```js
      const fp = '/?list-type=2&prefix=' + encodeURIComponent(seg.join('/') + '/');
      return {
        // ListObjectsV2 отдаёт максимум 1000 ключей за раз (IsTruncated +
        // NextContinuationToken) — без пагинации при библиотеке за ~300 фото
        // (1000 / 3 части) список молча обрывался бы, и «скачать с другого
        // устройства» переставало бы находить недостающее.
        async listAll() {
          const items = [];
          let token = null;
          try {
            do {
              const q = fp + (token ? '&continuation-token=' + encodeURIComponent(token) : '');
              const res = await s3Fetch('GET', q, null);
              const txt = await res.text();
              const keys = [...txt.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
              for (const k of keys) {
                const tail = k.split('/').pop();
                if (tail) items.push({ name: tail });
              }
              const truncated = /<IsTruncated>true<\/IsTruncated>/.test(txt);
              const tokenMatch = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(txt);
              token = truncated && tokenMatch ? tokenMatch[1] : null;
            } while (token);
          } catch (e) {
            if (!/404/.test(String(e))) throw e;
          }
          return { items, prefixes: [] };
        }
      };
```

на:

```js
      const prefix = seg.join('/') + '/';
      return {
        // ListObjectsV2 отдаёт максимум 1000 ключей за раз (IsTruncated +
        // NextContinuationToken) — без пагинации при библиотеке за ~300 фото
        // (1000 / 3 части) список молча обрывался бы, и «скачать с другого
        // устройства» переставало бы находить недостающее.
        async listAll() {
          const items = [];
          let token = null;
          try {
            do {
              const url = await presignFn({ method: 'LIST', prefix, ...(token ? { 'continuation-token': token } : {}) });
              const res = await fetch(url, { method: 'GET' });
              if (!res.ok) throw new Error('S3 ' + res.status + ' LIST ' + prefix);
              const txt = await res.text();
              const keys = [...txt.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
              for (const k of keys) {
                const tail = k.split('/').pop();
                if (tail) items.push({ name: tail });
              }
              const truncated = /<IsTruncated>true<\/IsTruncated>/.test(txt);
              const tokenMatch = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(txt);
              token = truncated && tokenMatch ? tokenMatch[1] : null;
            } while (token);
          } catch (e) {
            if (!/404/.test(String(e))) throw e;
          }
          return { items, prefixes: [] };
        }
      };
```

Функция `s3Fetch` (строки 123-130) после этого шага используется только PUT/DELETE-ответвлениями внутри `presignedFetch`? Нет — `presignedFetch` уже не вызывает `s3Fetch` (Task 5 заменил его на прямой `fetch(url, …)`). Проверить: `s3Fetch` теперь **нигде не вызывается** — удалить её целиком (строки 123-130) как мёртвый код.

- [ ] **Step 4: Запустить тест — должен пройти, плюс полный набор**

Run: `node build.js && npm test`
Expected: все `OK:`, без `FAIL`

- [ ] **Step 5: Commit**

```bash
git add src/95-photos-cloud.js app.js tests/uni-photo-sync.js
git commit -m "Feat: листинг бакета идёт через подписанную ссылку, s3Fetch удалена как мёртвый код (NV-7, шаг 6/10)"
```

---

### Task 7: Клиент — общие хелперы декодирования части фото + `ensureCloudPart`

**Files:**
- Modify: `src/95-photos-cloud.js:265-344` (`uploadCloudPhoto` — не трогаем; `downloadCloudPhoto` — рефакторинг)
- Test: `tests/uni-photo-sync.js`

**Interfaces:**
- Produces: `decodeCloudPartBody(txt)` → `{enc, meta}|null`. `mergeCloudMeta(meta, cloudMeta)` → объект meta. `fetchCloudPart(id, part)` → `{enc, meta}|null` (использует `photoRef` + `getBlob`). `ensureCloudPart(id, part)` → `Promise<boolean>` — **это и есть точка входа, которую в Task 9 вызовут `photoUrl`/`photoOrigUrl`.**
- Consumes: `photoRef(part, id)` (существующая), `photoStore.getEncrypted{Full,Thumb,Orig}`, `photoStore.getMeta`, `photoStore.putEncrypted` (существующие).

- [ ] **Step 1: Написать тест на `ensureCloudPart`**

В `tests/uni-photo-sync.js` экспортировать `ensureCloudPart` через suffix (рядом со строкой `s.probeCloudKeys = probeCloudKeys;`):

```js
  s.ensureCloudPart = ensureCloudPart;
```

Добавить сценарий (после сценария 4 «Фото, загруженное партнёром», перед сценарием 5 «Бэкфилл»):

```js
  // 4b. ensureCloudPart: докачка ОДНОЙ части по требованию (NV-7) — не через
  // полную сверку syncPhotos(), а как это будет вызываться из photoUrl()
  // при открытии фото, локально которого ещё нет (фоновая очередь качает
  // только thumb, full/orig — по требованию).
  await w('(s)=>{s.photoStore.delete("pB"); return 1;}'); // pB сейчас есть в облаке (см. сценарий 4) — убираем локально
  const gotOrig = await w('(s)=>s.ensureCloudPart("pB", "orig")');
  assert(gotOrig === true, 'ensureCloudPart скачивает недостающую часть и возвращает true');
  const origAfter = await w('(s)=>s.photoStore.getOrig("pB")');
  assert(origAfter && origAfter.type === 'image/png', 'ensureCloudPart сохранил часть с верным типом');
  const alreadyHave = await w('(s)=>s.ensureCloudPart("pB", "orig")');
  assert(alreadyHave === true, 'ensureCloudPart на уже докачанную часть возвращает true без повторного похода в облако');
  getCalls.length = 0;
  await w('(s)=>s.ensureCloudPart("pB", "orig")');
  assert(!getCalls.some(p => p.indexOf('/pB') !== -1), 'ensureCloudPart не перезапрашивает часть, которая уже локально');
  const missingPart = await w('(s)=>s.ensureCloudPart("no-such-id", "orig")');
  assert(missingPart === false, 'ensureCloudPart на несуществующее в облаке фото возвращает false, не бросает исключение');
```

- [ ] **Step 2: Запустить тест, убедиться, что падает**

Run: `node build.js && node tests/uni-photo-sync.js app.js`
Expected: `FAIL` — `ensureCloudPart is not a function` (ещё не существует)

- [ ] **Step 3: Реализовать**

В `src/95-photos-cloud.js` добавить после `photoRef` (после строки 235, перед `schedulePhotoSync`):

```js
// Разбирает тело части фото из облака: новый формат {e: шифртекст, m: meta}
// и легаси {i, d} (само тело — шифртекст без обёртки meta) — оба формата уже
// умел различать downloadCloudPhoto, здесь это вынесено в общий хелпер, т.к.
// теперь тем же кодом пользуется и ensureCloudPart (NV-7).
function decodeCloudPartBody(txt) {
  const parsed = JSON.parse(txt);
  const enc = parsed && parsed.e && typeof parsed.e.d === 'string' ? parsed.e : parsed && typeof parsed.d === 'string' ? parsed : null;
  return enc ? { enc, meta: parsed.m || null } : null;
}

// Накладывает несекретные MIME/размер из облачной обёртки поверх локального
// meta (см. payload в uploadCloudPhoto) — тоже общее место для
// downloadCloudPhoto и ensureCloudPart.
function mergeCloudMeta(meta, cloudMeta) {
  const out = { ...meta };
  if (cloudMeta) {
    if (cloudMeta.t) out.origType = cloudMeta.t;
    if (cloudMeta.ft) out.type = cloudMeta.ft;
    if (cloudMeta.st) out.thumbType = cloudMeta.st;
    if (cloudMeta.s) out.size = cloudMeta.s;
  }
  return out;
}

// Скачивает и разбирает ОДНУ часть фото из облака (без сохранения в store —
// это забота вызывающего). null — части нет или формат не распознан.
async function fetchCloudPart(id, part) {
  const data = await photoRef(part, id).getBlob();
  if (!data) return null;
  const txt = typeof data === 'string' ? data : await data.text();
  return decodeCloudPartBody(txt);
}

// Докачивает ОДНУ часть фото по требованию — не из фоновой очереди
// (syncPhotos качает эagerно только thumb, см. Task 8), а в момент, когда
// она реально понадобилась: photoUrl()/photoOrigUrl() (src/05-photostore.js)
// зовут это, когда локального блоба нет. Возвращает true, если часть теперь
// доступна локально (уже была или только что докачана).
async function ensureCloudPart(id, part) {
  if (!photoStore || !id) return false;
  const getter = 'getEncrypted' + part[0].toUpperCase() + part.slice(1);
  const already = await photoStore[getter](id).catch(() => null);
  if (already) return true;
  if (!syncStorage || !masterKey) return false;
  try {
    const r = await fetchCloudPart(id, part);
    if (!r) return false;
    const meta = (await photoStore.getMeta(id).catch(() => null)) || {};
    const meta2 = mergeCloudMeta(meta, r.meta);
    const exFull = part === 'full' ? r.enc : await photoStore.getEncryptedFull(id).catch(() => null);
    const exThumb = part === 'thumb' ? r.enc : await photoStore.getEncryptedThumb(id).catch(() => null);
    const exOrig = part === 'orig' ? r.enc : await photoStore.getEncryptedOrig(id).catch(() => null);
    await photoStore.putEncrypted(id, exFull, exThumb, meta2, exOrig);
    return true;
  } catch (e) {
    console.warn('[photo-sync] не удалось докачать часть фото по требованию', id, part, e);
    return false;
  }
}
```

Отрефакторить `downloadCloudPhoto`, чтобы использовать `fetchCloudPart`/`mergeCloudMeta` вместо дублирующей инлайн-логики (строки 296-344 — заменить целиком):

```js
async function downloadCloudPhoto(id, cloud, local) {
  try {
    const meta = (local && (await photoStore.getMeta(id).catch(() => null))) || {};
    const need = PHOTO_PARTS.filter(part => {
      const hasCloud = cloud[id] && cloud[id][part];
      const hasLocal = local && local['has' + part[0].toUpperCase() + part.slice(1)];
      return hasCloud && !hasLocal;
    });
    const fetched = await Promise.all(
      need.map(async part => {
        const r = await fetchCloudPart(id, part).catch(() => null);
        return { part, r };
      })
    );
    const got = {};
    let gotMeta = null;
    for (const f of fetched) {
      if (!f.r) continue;
      got[f.part] = f.r.enc;
      if (f.r.meta && !gotMeta) gotMeta = f.r.meta;
    }
    if (!got.orig && !got.full && !got.thumb) return { ok: false, err: new Error('в облаке нет частей для скачивания') };
    // Сохраняем всё разом, чтобы не потерять уже имеющиеся локальные части
    const exOrig = local && local.hasOrig ? await photoStore.getEncryptedOrig(id) : null;
    const exFull = local && local.hasFull ? await photoStore.getEncryptedFull(id) : null;
    const exThumb = local && local.hasThumb ? await photoStore.getEncryptedThumb(id) : null;
    const meta2 = mergeCloudMeta(meta, gotMeta);
    await photoStore.putEncrypted(id, got.full || exFull, got.thumb || exThumb, meta2, got.orig || exOrig);
    // Приехала миниатюра — прогреваем кэш, фото сразу показывается в галерее
    try {
      const t = await photoStore.getThumb(id);
      if (t) setThumbUrl(id, await blobToDataUrl(t));
    } catch (e) {}
    return { ok: true };
  } catch (e) {
    console.warn('[photo-sync] не удалось скачать фото ' + id, e);
    return { ok: false, err: e };
  }
}
```

(Изменился только источник разбора тела — было инлайн `JSON.parse`+ручной выбор `enc`, стало `fetchCloudPart`; сигнатура и остальное поведение функции не меняются — этот шаг НЕ включает сужение `PHOTO_PARTS` до thumb-only, это Task 8.)

- [ ] **Step 4: Запустить тест — должен пройти, плюс полный набор**

Run: `node build.js && npm test`
Expected: все `OK:`, без `FAIL`

- [ ] **Step 5: Commit**

```bash
git add src/95-photos-cloud.js app.js tests/uni-photo-sync.js
git commit -m "Feat: ensureCloudPart — докачка одной части фото по требованию (NV-7, шаг 7/10)"
```

---

### Task 8: Клиент — фоновая очередь качает только миниатюры

**Files:**
- Modify: `src/95-photos-cloud.js` (`syncPhotos`, константа `PHOTO_PARTS`)
- Test: `tests/uni-photo-sync.js`

**Interfaces:**
- Consumes: `downloadCloudPhoto` из Task 7 (используется только для download-направления — нужно ограничить набор частей).
- Produces: `EAGER_DOWNLOAD_PARTS = ['thumb']`; `downloadCloudPhoto(id, cloud, local, parts)` — новый 4-й параметр (по умолчанию `PHOTO_PARTS`, чтобы выгрузка/легаси-вызовы не сломались).

- [ ] **Step 1: Обновить существующий тест сценария 3 (было: «скачаны все три части»)**

В `tests/uni-photo-sync.js` заменить (строки 354-362, сценарий 3):

```js
  // 3. «Второе устройство»: стор пуст, облако уже знает фото — скачиваем всё назад
  await w('(s)=>{s.photoStore.clear(); return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert((await w('(s)=>s.photoStore.getMeta("pA")')) !== null, 'фото скачано из облака в store');
  const idsA = await w('(s)=>s.photoStore.listIds()');
  assert(
    idsA.some(i => i.id === 'pA' && i.hasOrig && i.hasFull && i.hasThumb),
    'скачаны все три части фото'
  );
```

на:

```js
  // 3. «Второе устройство»: стор пуст, облако уже знает фото — эagerно
  // скачивается ТОЛЬКО миниатюра (модель iCloud, NV-7); full/orig качаются
  // лениво по требованию (см. Task 7, ensureCloudPart, и Task 9, photoUrl).
  await w('(s)=>{s.photoStore.clear(); return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert((await w('(s)=>s.photoStore.getMeta("pA")')) !== null, 'фото скачано из облака в store');
  const idsA = await w('(s)=>s.photoStore.listIds()');
  assert(
    idsA.some(i => i.id === 'pA' && i.hasThumb && !i.hasFull && !i.hasOrig),
    'фоновая сверка качает только миниатюру — full/orig НЕ докачиваются эagerно (NV-7)'
  );
  assert(
    signCalls.some(c => c.method === 'GET' && c.part === 'thumb' && c.id === 'pA'),
    'скачивание миниатюры теперь запрашивает подписанную ссылку у photo-sign, а не читает бакет анонимно (NV-7)'
  );
  assert(
    signCalls.some(c => c.method === 'LIST'),
    'листинг бакета теперь запрашивает подписанную ссылку у photo-sign, а не читает бакет анонимно (NV-7)'
  );
```

(Это заменяет собой ручные assert'ы, добавленные в Tasks 5 и 6 «рядом со сценарием 3» — если этот шаг выполняется ПОСЛЕ Tasks 5/6 по плану, эти две строки уже существуют в файле: тогда просто не дублировать, а убедиться, что они есть в этом месте и убрать старый `assert(idsA.some(... hasOrig && hasFull && hasThumb...))`.)

- [ ] **Step 2: Обновить сценарий 4 («Фото, загруженное партнёром») — тоже эagerно только thumb**

Заменить (строки 364-372):

```js
  // 4. Фото, загруженное партнёром (в облаке есть pB, локально нет) — докачивается.
  await w('(s)=>s.photoStore.put("pB", new Blob(["FULL-B"]), new Blob(["THUMB-B"]), {type:"image/png",thumbType:"image/webp",title:"Фото Б"}, new Blob(["ORIG-B"]))');
  w('(s)=>{s.db.photos.unshift({id:"pB",title:"Фото Б",labels:[],pinned:false,ts:2,order:1});return 1;}');
  await w('(s)=>s.syncPhotos()');
  await w('(s)=>{s.photoStore.delete("pB"); return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert((await w('(s)=>s.photoStore.getMeta("pB")')) !== null, 'фото pB скачано из облака');
  const origB = await w('(s)=>s.photoStore.getOrig("pB")');
  assert(origB && origB.type === 'image/png', 'оригинал pB сохранил свой тип после кругосветки');
```

на:

```js
  // 4. Фото, загруженное партнёром (в облаке есть pB, локально нет) —
  // эagerно докачивается только миниатюра (NV-7); полный тест ensureCloudPart
  // (докачка orig по требованию) — сценарий 4b ниже.
  await w('(s)=>s.photoStore.put("pB", new Blob(["FULL-B"]), new Blob(["THUMB-B"]), {type:"image/png",thumbType:"image/webp",title:"Фото Б"}, new Blob(["ORIG-B"]))');
  w('(s)=>{s.db.photos.unshift({id:"pB",title:"Фото Б",labels:[],pinned:false,ts:2,order:1});return 1;}');
  await w('(s)=>s.syncPhotos()');
  await w('(s)=>{s.photoStore.delete("pB"); return 1;}');
  await w('(s)=>s.syncPhotos()');
  assert((await w('(s)=>s.photoStore.getMeta("pB")')) !== null, 'фото pB: сведения о нём появились локально (thumb скачан)');
  const thumbB = await w('(s)=>s.photoStore.getThumb("pB")');
  assert(!!thumbB, 'миниатюра pB докачана эagerно');
  const origBMissing = await w('(s)=>s.photoStore.getOrig("pB")');
  assert(!origBMissing, 'оригинал pB НЕ докачан эagerно (докачивается по требованию, см. ensureCloudPart)');
```

(Сценарий 4b из Task 7, начинающийся с `await w('(s)=>{s.photoStore.delete("pB"); return 1;}');`, теперь опирается на то, что после этого блока `pB` локально нет вообще НИЧЕГО, а не «нет только orig» — проверить, что `ensureCloudPart("pB","orig")` в сценарии 4b по-прежнему находит `pB` в облаке (он туда попал в исходном `put`+`syncPhotos()` этого же блока 4, до `photoStore.delete`) — облако не трогается `delete`, значит сценарий 4b остаётся корректным без изменений.)

- [ ] **Step 3: Запустить тесты, убедиться, что падают именно там, где ожидается**

Run: `node build.js && node tests/uni-photo-sync.js app.js`
Expected: `FAIL: фоновая сверка качает только миниатюру …` (сейчас `downloadCloudPhoto` качает все части)

- [ ] **Step 4: Реализовать сужение эagerной загрузки**

В `src/95-photos-cloud.js` добавить константу рядом с `PHOTO_PARTS` (строка 77):

```js
const PHOTO_PARTS = ['orig', 'full', 'thumb'];
// Фоновая очередь (syncPhotos) качает эagerно ТОЛЬКО миниатюры — модель
// iCloud (NV-7): full/orig докачиваются по требованию через ensureCloudPart
// (см. Task 7), когда фото реально открывают. Выгрузка (uploadCloudPhoto)
// не сужается — свои новые фото уходят в облако всеми тремя частями сразу,
// они и так уже есть локально в момент добавления.
const EAGER_DOWNLOAD_PARTS = ['thumb'];
```

Дать `downloadCloudPhoto` четвёртый параметр `parts` (дефолт — весь список, чтобы прямые вызовы без указания частей не сломались):

```js
async function downloadCloudPhoto(id, cloud, local, parts = PHOTO_PARTS) {
  try {
    const meta = (local && (await photoStore.getMeta(id).catch(() => null))) || {};
    const need = parts.filter(part => {
```

(единственное изменение — сигнатура и `PHOTO_PARTS.filter` → `parts.filter`, остальное тело функции из Task 7 не меняется.)

В `syncPhotos()` заменить обе точки, где вычисляется `toDownload` и вызывается `downloadCloudPhoto` (строки 480-507):

```js
    const toDownload = [...want].filter(id => {
      if (isSkipped(id)) return false;
      return PHOTO_PARTS.some(part => cloud[id] && cloud[id][part] && !hasPart(id, part));
    });
```

на:

```js
    const toDownload = [...want].filter(id => {
      if (isSkipped(id)) return false;
      return EAGER_DOWNLOAD_PARTS.some(part => cloud[id] && cloud[id][part] && !hasPart(id, part));
    });
```

и:

```js
    await mapLimit(toDownload, SYNC_CONCURRENCY, async id => {
      const res = await downloadCloudPhoto(id, cloud, localMap.get(id));
```

на:

```js
    await mapLimit(toDownload, SYNC_CONCURRENCY, async id => {
      const res = await downloadCloudPhoto(id, cloud, localMap.get(id), EAGER_DOWNLOAD_PARTS);
```

(`pendingElsewhere`-логика чуть выше по файлу проверяет `hasAnyLocal`/`hasAnyCloud` по ВСЕМ `PHOTO_PARTS` — её трогать не нужно: она про «гонку с другим устройством», не про то, что именно скачивается.)

- [ ] **Step 5: Запустить тесты — должны пройти, плюс полный набор**

Run: `node build.js && npm test`
Expected: все `OK:`, без `FAIL`

- [ ] **Step 6: Commit**

```bash
git add src/95-photos-cloud.js app.js tests/uni-photo-sync.js
git commit -m "Feat: фоновая очередь качает только миниатюры, full/orig — по требованию (NV-7, шаг 8/10)"
```

---

### Task 9: Клиент — batch-подпись для фоновой очереди миниатюр

**Files:**
- Modify: `src/95-photos-cloud.js` (`syncPhotos`, новая `batchPresignGet` + `downloadThumbsBatch`)
- Test: `tests/uni-photo-sync.js`, `tests/photo-sign-auth.js` (уже покрыт batch на стороне функции — здесь тестируем клиента)

**Interfaces:**
- Consumes: `firebaseAuthHeader()` из Task 5, `decodeCloudPartBody`/`mergeCloudMeta` из Task 7.
- Produces: `batchPresignGet(items)` → `[{id,part,url}|{id,part,error}]`. `downloadThumbsBatch(ids)` заменяет `mapLimit(toDownload, …, downloadCloudPhoto)` для thumb-очереди в `syncPhotos()`.

- [ ] **Step 1: Написать тест — один batch-запрос на пачку миниатюр, а не N штучных**

В `tests/uni-photo-sync.js` добавить в мок `fetchMock` (после ветки `if (String(url).indexOf(SIGN_FN_URL) === 0) {...}` из Task 6, ДО неё — POST-проверка должна идти первой, т.к. `String(url).indexOf(SIGN_FN_URL) === 0` верно и для POST) поддержку `POST`-батча — заменить начало ветки на:

```js
  if (String(url).indexOf(SIGN_FN_URL) === 0) {
    if ((opts && opts.method) === 'POST') {
      batchCalls.push(JSON.parse(opts.body));
      const items = JSON.parse(opts.body).items;
      const results = items.map(it => ({ id: it.id, part: it.part, url: 'https://nasha-vselennaya.storage.yandexcloud.net/photos/' + it.part + '/' + it.id + '?X-Amz-Signature=mock' }));
      return { ok: true, status: 200, json: () => Promise.resolve({ results }) };
    }
    // Мок функции подписи: не проверяет секрет (его тут и нет), просто
    // возвращает «подписанную» ссылку на тот же мок-бакет — signature фиктивна,
    // мок PUT/DELETE её не проверяет (проверка подписи — забота реального S3,
    // а не нашего кода; здесь тестируем контракт «функция → presigned URL → операция»).
    const qs = new URLSearchParams(full.slice(qIdx + 1));
```

(остальное тело ветки из Task 6 — без изменений, просто теперь эта строка `const qs = …` идёт после нового `if`).

Добавить `const batchCalls = [];` рядом с `const signCalls = [];` (строка 83).

Добавить сценарий после «3. «Второе устройство»…» (или сразу заменить проверку `signCalls.some(c => c.method === 'GET' …)` из Task 5/8 на batch-версию — GET одиночных объектов для миниатюр в фоновой очереди больше не будет, они пойдут через batch):

```js
  assert(batchCalls.length >= 1, 'фоновая очередь миниатюр запрашивает пачку подписей одним POST-вызовом, а не по одному GET на фото (NV-7)');
  assert(batchCalls[0].items.some(it => it.id === 'pA' && it.part === 'thumb'), 'batch-запрос содержит нужную миниатюру');
```

(Убрать/заменить прежний `assert(signCalls.some(c => c.method === 'GET' && c.part === 'thumb' && c.id === 'pA'), …)` из Task 5/8 — миниатюры фоновой очереди больше НЕ идут одиночным GET, только batch'ем. Одиночный GET presign остаётся для `ensureCloudPart` — это по-прежнему проверяется сценарием 4b.)

- [ ] **Step 2: Запустить тест, убедиться, что падает**

Run: `node build.js && node tests/uni-photo-sync.js app.js`
Expected: `FAIL: фоновая очередь миниатюр запрашивает пачку подписей …` (сейчас `mapLimit` дёргает `downloadCloudPhoto` → `photoRef(part,id).getBlob()` поштучно)

- [ ] **Step 3: Реализовать**

В `src/95-photos-cloud.js` добавить после `presignFn` (внутри `makeCloudStorage`, значит доступна через замыкание — но `batchPresignGet` нужна и `syncPhotos()` снаружи `makeCloudStorage`; сделать её методом на возвращаемом объекте `syncStorage`, как `ref`):

Заменить возвращаемый объект `makeCloudStorage()` (было `return { ref(path) {...} };`) на:

```js
  return {
    ref(path) {
      /* …без изменений, как в Task 6… */
    },
    // Пачка presigned GET-ссылок одним HTTP-запросом — используется фоновой
    // очередью миниатюр (NV-7), чтобы не делать по одному запросу подписи на
    // каждое фото. items: [{part, id}]. Возвращает [{id,part,url}|{id,part,error}].
    async batchPresignGet(items) {
      if (!cfg.signFnUrl || !items.length) return [];
      const authHeaders = await firebaseAuthHeader();
      const res = await fetch(cfg.signFnUrl, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      if (!res.ok) throw new Error('sign-fn batch ' + res.status);
      const { results } = await res.json();
      return results || [];
    }
  };
```

Добавить `downloadThumbsBatch` после `downloadCloudPhoto`:

```js
// Эagerная докачка миниатюр пачками (NV-7): вместо downloadCloudPhoto по
// одному id (который сам по себе дёргает presign на каждую часть) — один
// batch-запрос подписи на BATCH_SIZE миниатюр сразу, потом сами байты
// параллельно (mapLimit, тот же SYNC_CONCURRENCY, что и раньше).
const THUMB_BATCH_SIZE = 100; // совпадает с MAX_BATCH_ITEMS на стороне функции
async function downloadThumbsBatch(ids) {
  const stats = { downloaded: 0, failed: 0 };
  for (let i = 0; i < ids.length; i += THUMB_BATCH_SIZE) {
    const chunk = ids.slice(i, i + THUMB_BATCH_SIZE);
    let results;
    try {
      results = await syncStorage.batchPresignGet(chunk.map(id => ({ part: 'thumb', id })));
    } catch (e) {
      console.warn('[photo-sync] batch-подпись миниатюр не удалась', e);
      stats.failed += chunk.length;
      continue;
    }
    await mapLimit(results, SYNC_CONCURRENCY, async r => {
      if (!r || r.error || !r.url) {
        stats.failed++;
        return;
      }
      try {
        const res = await fetch(r.url);
        if (!res.ok) throw new Error('S3 ' + res.status + ' thumb/' + r.id);
        const txt = await res.text();
        const decoded = decodeCloudPartBody(txt);
        if (!decoded) throw new Error('незнакомый формат облачного файла');
        const meta = (await photoStore.getMeta(r.id).catch(() => null)) || {};
        const meta2 = mergeCloudMeta(meta, decoded.meta);
        const exFull = await photoStore.getEncryptedFull(r.id).catch(() => null);
        const exOrig = await photoStore.getEncryptedOrig(r.id).catch(() => null);
        await photoStore.putEncrypted(r.id, exFull, decoded.enc, meta2, exOrig);
        try {
          const t = await photoStore.getThumb(r.id);
          if (t) setThumbUrl(r.id, await blobToDataUrl(t));
        } catch (e) {}
        stats.downloaded++;
      } catch (e) {
        console.warn('[photo-sync] не удалось докачать миниатюру ' + r.id, e);
        stats.failed++;
      }
    });
  }
  return stats;
}
```

В `syncPhotos()` заменить блок скачивания (из Task 8):

```js
    await mapLimit(toDownload, SYNC_CONCURRENCY, async id => {
      const res = await downloadCloudPhoto(id, cloud, localMap.get(id), EAGER_DOWNLOAD_PARTS);
      if (res && res.ok) stats.downloaded++;
      else {
        stats.failed++;
        stats.retry = true;
      }
    });
```

на:

```js
    const thumbStats = await downloadThumbsBatch(toDownload);
    stats.downloaded += thumbStats.downloaded;
    if (thumbStats.failed) {
      stats.failed += thumbStats.failed;
      stats.retry = true;
    }
```

(`downloadCloudPhoto` с параметром `parts` остаётся в файле — она по-прежнему нужна как есть? Проверить: после этого шага `downloadCloudPhoto` вызывается только с дефолтным `PHOTO_PARTS`? На самом деле нигде больше не вызывается вообще — `syncPhotos()` теперь всегда идёт через `downloadThumbsBatch`. Удалить `downloadCloudPhoto` как мёртвый код НЕЛЬЗЯ на этом шаге — `ensureCloudPart`(Task 7) её не использует (использует `fetchCloudPart` напрямую). Значит `downloadCloudPhoto` после этого шага единственный вызывающий — сама себя никто не зовёт. Проверить grep перед коммитом: `grep -n "downloadCloudPhoto(" src/95-photos-cloud.js` — если единственное упоминание это `function downloadCloudPhoto`, функция стала мёртвым кодом, удалить её целиком вместе с параметром `parts`, добавленным в Task 8, и константой `EAGER_DOWNLOAD_PARTS` тоже проверить на использование — она используется в `toDownload`-фильтре чуть выше, остаётся.)

- [ ] **Step 4: Проверить, не осталась ли `downloadCloudPhoto` мёртвым кодом, и удалить, если да**

Run: `grep -n "downloadCloudPhoto" src/95-photos-cloud.js`
Expected: только строка объявления функции → удалить функцию целиком (весь блок, введённый/отрефакторенный в Task 7 и с параметром `parts` из Task 8).

- [ ] **Step 5: Запустить тесты — должны пройти, плюс полный набор**

Run: `node build.js && npm test`
Expected: все `OK:`, без `FAIL`

- [ ] **Step 6: Commit**

```bash
git add src/95-photos-cloud.js app.js tests/uni-photo-sync.js
git commit -m "Feat: фоновая очередь миниатюр запрашивает подписи пачкой, не по одной (NV-7, шаг 9/10)"
```

---

### Task 10: Клиент — ленивая докачка full/orig в `photoUrl`/`photoOrigUrl`

**Files:**
- Modify: `src/05-photostore.js:597-641` (`photoUrl`, `photoOrigUrl`)
- Test: `tests/uni-photo-sync.js`

**Interfaces:**
- Consumes: `ensureCloudPart(id, part)` из Task 7.
- Produces: `photoUrl`/`photoOrigUrl` сохраняют прежнюю сигнатуру и поведение при наличии локальных блобов; при отсутствии — лениво докачивают перед тем, как вернуть `''`.

- [ ] **Step 1: Написать тест**

В `tests/uni-photo-sync.js` экспортировать `photoUrl`/`photoOrigUrl` через suffix (рядом с `s.ensureCloudPart = ensureCloudPart;` из Task 7):

```js
  s.photoUrl = photoUrl; s.photoOrigUrl = photoOrigUrl;
```

Добавить сценарий сразу после 4b (докачка через `ensureCloudPart` напрямую) — теперь через реальную точку входа рендеров:

```js
  // 4c. photoUrl()/photoOrigUrl() — реальная точка входа светбокса
  // (src/85-lightbox.js) — сами лениво докачивают недостающую часть, если её
  // нет локально (NV-7). pC: в облаке есть full+thumb, локально — ничего.
  await w('(s)=>s.photoStore.put("pC", new Blob(["FULL-C"]), new Blob(["THUMB-C"]), {type:"image/jpeg",thumbType:"image/webp",title:"C"}, null)');
  w('(s)=>{s.db.photos.unshift({id:"pC",title:"C",labels:[],pinned:false,ts:6,order:0});return 1;}');
  await w('(s)=>s.syncPhotos()'); // выгружаем full+thumb в облако как «чужое устройство»
  await w('(s)=>{s.photoStore.delete("pC"); return 1;}'); // а теперь у нас локально пусто — как будто это второе устройство
  const urlFull = await w('(s)=>s.photoUrl({id:"pC"}, false)'); // useThumb=false — как в светбоксе
  assert(typeof urlFull === 'string' && urlFull.length > 0, 'photoUrl(useThumb=false) на отсутствующий локально full лениво докачивает и возвращает data-URL');
  const origBlobAfter = await w('(s)=>s.photoStore.getFull("pC")');
  assert(!!origBlobAfter, 'photoUrl закэшировал докачанный full локально (повторный вызов не пойдёт в сеть)');
```

- [ ] **Step 2: Запустить тест, убедиться, что падает**

Run: `node build.js && node tests/uni-photo-sync.js app.js`
Expected: `FAIL: photoUrl(useThumb=false) на отсутствующий локально full лениво докачивает …` (сейчас `photoUrl` возвращает `''`, ничего не докачивая)

- [ ] **Step 3: Реализовать**

В `src/05-photostore.js` заменить `photoUrl`/`photoOrigUrl` (строки 597-641):

```js
async function photoUrl(p, useThumb = true) {
  if (!p) return '';
  const cache = useThumb ? thumbCache : fullCache;
  const cached = cache.get(p.id);
  if (cached) return cached;
  if (photoStore && p.id) {
    try {
      let blob = null;
      // Миниатюра могла не расшифроваться — не бросаем, падаем на полный блоб
      if (useThumb) {
        try {
          blob = await photoStore.getThumb(p.id);
        } catch (e) {}
      }
      if (!blob) blob = await photoStore.getFull(p.id);
      if (blob) {
        const url = await blobToDataUrl(blob);
        cache.set(p.id, url);
        return url;
      }
    } catch (e) {}
  }
  return '';
}
// Оригинал (максимальное качество) — только по требованию (зум в светбоксе,
// скачивание), не прогревается заранее: оригиналы могут весить мегабайты,
// незачем тянуть их для каждого открытого фото, если зум не понадобился.
const origCache = new Map();
async function photoOrigUrl(p) {
  if (!p) return '';
  const cached = origCache.get(p.id);
  if (cached) return cached;
  if (photoStore && p.id) {
    try {
      let blob = await photoStore.getOrig(p.id).catch(() => null);
      if (!blob) blob = await photoStore.getFull(p.id).catch(() => null);
      if (blob) {
        const url = await blobToDataUrl(blob);
        origCache.set(p.id, url);
        return url;
      }
    } catch (e) {}
  }
  return '';
}
```

на:

```js
async function photoUrl(p, useThumb = true) {
  if (!p) return '';
  const cache = useThumb ? thumbCache : fullCache;
  const cached = cache.get(p.id);
  if (cached) return cached;
  if (photoStore && p.id) {
    try {
      let blob = null;
      // Миниатюра могла не расшифроваться — не бросаем, падаем на полный блоб
      if (useThumb) {
        try {
          blob = await photoStore.getThumb(p.id);
        } catch (e) {}
        // NV-7: фоновая очередь качает миниатюры с задержкой — если эта
        // конкретная ещё не долетела, просим её по требованию.
        if (!blob && (await ensureCloudPart(p.id, 'thumb'))) {
          try {
            blob = await photoStore.getThumb(p.id);
          } catch (e) {}
        }
      }
      if (!blob) blob = await photoStore.getFull(p.id);
      // NV-7: full больше не докачивается фоновой очередью — докачиваем по
      // требованию прямо здесь. Светбокс тем временем уже показывает
      // миниатюру из кэша (см. src/85-lightbox.js, lbRender), пока этот
      // промис в полёте — пользователь не смотрит на пустоту.
      if (!blob && (await ensureCloudPart(p.id, 'full'))) {
        blob = await photoStore.getFull(p.id);
      }
      if (blob) {
        const url = await blobToDataUrl(blob);
        cache.set(p.id, url);
        return url;
      }
    } catch (e) {}
  }
  return '';
}
// Оригинал (максимальное качество) — только по требованию (зум в светбоксе,
// скачивание), не прогревается заранее: оригиналы могут весить мегабайты,
// незачем тянуть их для каждого открытого фото, если зум не понадобился.
const origCache = new Map();
async function photoOrigUrl(p) {
  if (!p) return '';
  const cached = origCache.get(p.id);
  if (cached) return cached;
  if (photoStore && p.id) {
    try {
      let blob = await photoStore.getOrig(p.id).catch(() => null);
      if (!blob && (await ensureCloudPart(p.id, 'orig'))) {
        blob = await photoStore.getOrig(p.id).catch(() => null);
      }
      if (!blob) blob = await photoStore.getFull(p.id).catch(() => null);
      if (!blob && (await ensureCloudPart(p.id, 'full'))) {
        blob = await photoStore.getFull(p.id).catch(() => null);
      }
      if (blob) {
        const url = await blobToDataUrl(blob);
        origCache.set(p.id, url);
        return url;
      }
    } catch (e) {}
  }
  return '';
}
```

(`ensureCloudPart` определена в `src/95-photos-cloud.js`, собранном ПОЗЖЕ `05-photostore.js` в `app.js` — это не проблема: это объявление функции (function declaration), которое хостится в общей области видимости всего собранного файла, `photoUrl`/`photoOrigUrl` вызывают её во время выполнения, а не во время начальной загрузки скрипта, когда всё уже загружено. В самом файле `05-photostore.js`, если его открыть отдельно, `ensureCloudPart` не видна — это нормально для этой кодовой базы, тот же паттерн уже используется для `notify`/`warmThumbCache` между другими файлами.)

- [ ] **Step 4: Запустить тест — должен пройти, плюс полный набор**

Run: `node build.js && npm test`
Expected: все `OK:`, без `FAIL`

- [ ] **Step 5: Commit**

```bash
git add src/05-photostore.js app.js tests/uni-photo-sync.js
git commit -m "Feat: photoUrl/photoOrigUrl лениво докачивают full/orig по требованию (NV-7, шаг 10/10 кода)"
```

---

### Task 11: README — обновить контракт бакета и Cloud Function

**Files:**
- Modify: `README.md` (разделы B2, B3)

Не код — документация должна отражать новую реальность (бакет закрыт от анонимного чтения, `photo-sign` подписывает GET/LIST/batch), иначе следующий, кто настраивает деплой с нуля по README, воспроизведёт старую (уязвимую) конфигурацию.

- [ ] **Step 1: Переписать раздел B2**

В `README.md`, раздел «### B2. Yandex Object Storage (фото, чтение)»:
- Убрать шаг 3 (переключатели «Чтение объектов»/«Чтение списка объектов» → «Для всех») и правила 1-2 из шага 4 (`GetObject`/`ListBucket` для «Всех пользователей») — бакет остаётся полностью приватным, читает только через presigned-ссылки.
- Переименовать раздел в «B2. Yandex Object Storage (фото) — один раз, ~10 минут» (чтение больше не настраивается отдельно от записи — обе идут через `photo-sign`).
- Оставить правило 3 («Добавить правило для доступа из консоли») — оно не про публичный доступ, а про то, чтобы сама консоль не заблокировала владельцу доступ к разделам бакета.

- [ ] **Step 2: Обновить раздел B3**

Дописать в шапку B3, что `photo-sign` теперь подписывает не только запись, но и GET/LIST/batch — с той же логикой (email из Firebase-токена), и что переменные окружения не меняются.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Docs: README отражает закрытый бакет и расширенный контракт photo-sign (NV-7)"
```

---

### Task 12: Ручной шаг — флип бакета на приватный (НЕ код, выполняет владелец)

**Это чеклист для владельца, не для агента.** Агент доходит до этого шага, пушит весь код (Tasks 1-11), деплоит через существующий CI (`deploy-pages.yml`), и на этом ЗАВЕРШАЕТ работу — дальше выполняет человек вручную, когда сочтёт нужным:

- [ ] **Сначала, ДО деплоя нового `app.js`:** передеплоить текущую версию `functions/photo-sign/index.js` в консоли Yandex Cloud (Cloud Functions → `photo-sign` → создать новую ревизию, вставить код файла) и проверить, что она реально работает — например, вручную дёрнуть `?method=LIST&prefix=photos/thumb/` и убедиться, что приходит 200 с подписанной ссылкой, а не `400 method must be PUT or DELETE`. `photo-sign` деплоится вручную через консоль — CI её не трогает, — а новый `app.js` уходит в прод автоматически при мерже; если функция всё ещё старая (только PUT/DELETE), новый клиент, который шлёт `method=GET/LIST/POST`, сломает ВСЕ чтения фото в момент выката, ещё до флипа приватности бакета ниже.
- [ ] Оба устройства (Гоша и Даша) открыли приложение хотя бы раз после деплоя нового `app.js` — убедиться, что `sw.js` (офлайн-кэш PWA) обновился, а не отдаёт старую версию с анонимным чтением.
- [ ] В консоли Yandex Cloud → Object Storage → бакет → **Настройки бакета → Основные → Доступ**: переключить «Чтение объектов» и «Чтение списка объектов» обратно на «С авторизацией» (было «Для всех»).
- [ ] **Безопасность → Политика доступа**: убрать правила 1 (`GetObject` для «Всех пользователей») и 2 (`ListBucket` для «Всех пользователей»), оставить только правило 3 (доступ консоли) — запись и так уже не анонимна.
- [ ] Открыть приложение на обоих устройствах ещё раз, убедиться, что галерея показывает миниатюры, а открытие фото без сети — не (ожидаемо, iCloud-модель), а с сетью — показывает full/orig без ошибок в консоли.
- [ ] Обновить `PROJECT-MEMORY.md`, раздел «Что осталось не сделано» — убрать пункт про NV-7 (готово).

---

## Self-Review (выполнен автором плана)

1. **Покрытие спеки:** presign()+extraQuery (спека §1) → Task 1. GET (§1) → Task 2. LIST (§1) → Task 3. batch+лимит 100+частичная невалидность (§1) → Task 4. Клиентский presigned GET/LIST (§2) → Tasks 5-6. Фоновая очередь только thumb (§3) → Task 8. batch на клиенте (§2, «Новая `batchPresign`») → Task 9. Ленивая докачка full/orig через photoUrl/photoOrigUrl (§4) → Task 10. Порядок выката (спека, отдельный раздел) → Task 12. README (не было явно в спеке, но необходимо для консистентности — добавлено как Task 11).
2. **Плейсхолдеры:** просмотрено — нет TBD/TODO, весь код настоящий, переиспользуемый из уже прочитанных файлов.
3. **Согласованность типов/имён:** `ensureCloudPart(id, part)` (Task 7) → используется как есть в Task 10, никаких переименований между тасками. `EAGER_DOWNLOAD_PARTS` (Task 8) используется в Task 9 без изменений. `decodeCloudPartBody`/`mergeCloudMeta` (Task 7) переиспользуются в Task 9 без переименований.
4. **Зависимости между тасками:** Task 2 зависит от Task 1 (`presign` сигнатура). Task 3 зависит от Task 1. Task 4 зависит от Task 1 (не от 2/3 — batch не проходит через `handleList`/GET-ветку). Task 5 не зависит от 2-4 (клиент и функция независимы до тех пор, пока контракт совпадает — но задачи упорядочены так, что функция обновляется раньше клиента, чтобы клиентские тесты сразу били по реальному контракту, а не по недостающему). Task 6 зависит от Task 5 (`presignFn`). Task 7 зависит от Task 5 (`photoRef`→`getBlob`→`presignedFetch`, уже готово). Task 8 зависит от Task 7 (`downloadCloudPhoto` рефакторинг). Task 9 зависит от Task 4 (серверный batch) и Task 7/8 (клиентские хелперы). Task 10 зависит от Task 7 (`ensureCloudPart`). Порядок в плане это соблюдает.
