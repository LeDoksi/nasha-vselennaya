# План №1: слой данных на Firestore

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести данные пары (события, свидания, заметки, списки, хотелки, лейблы, метаданные фото, настройки) из единого зашифрованного блоба в Firestore — с запросами, пагинацией, офлайн-кэшем и живыми обновлениями, — не переписывая интерфейс.

**Architecture:** Появляется слой репозитория — единственное место, знающее про Firestore. Объект `db` остаётся в памяти, но меняет смысл: из «все наши данные» становится кэшем-проекцией того, что нужно экрану. Интерфейс продолжает читать `db.events`, `db.notes` синхронно (179 обращений не трогаем), а 52 вызова `save()` заменяются на явные операции репозитория. Данные перестают шифроваться; доступ разграничивают правила Firestore по email. Фото в этом плане не трогаются — продолжают работать как сейчас.

**Tech Stack:** Firebase compat SDK v10.14.0 (app / auth / database / **firestore**), ванильный JS без сборщика (конкатенация `src/*.js` через `node build.js`), тесты — самописные песочницы на `new Function()`.

**Spec:** [`docs/superpowers/specs/2026-09-09-firestore-refactor-design.md`](../specs/2026-09-09-firestore-refactor-design.md)

## Global Constraints

- **Тарифы:** только бесплатные. Firestore Spark: 1 ГБ, 50 000 чтений и 20 000 записей в день. Никаких Cloud Functions for Firebase (требуют Blaze).
- **Доступ:** читать и писать могут только `shakov.georgy@gmail.com` и `dashach98@gmail.com` — правило Firestore на `couples/main/{document=**}`.
- **Шифрование:** тексты — открытым текстом. Фото — остаются зашифрованными, ключ переезжает в `couples/main/meta/settings.photoKey`. `aesEnc`/`aesDec` в `00-core.js` **не удалять**.
- **Интерфейс не переписывается.** Экраны и взаимодействия остаются, меняется только то, что под ними.
- **TDZ-ловушка проекта:** `build.js` склеивает `src/*.js` по алфавиту в общую глобальную область. Любой новый top-level `let`/`const`, который читается функцией из файла с меньшим номером, обязан быть объявлен в `00-core.js` — иначе `ReferenceError: Cannot access before initialization` (уже ловили трижды). Объявления `function` безопасны всегда.
- **Перед каждым коммитом `npm run check` должен быть зелёным.** Pre-commit хук всё равно его запустит.
- **Язык:** комментарии в коде, сообщения интерфейса и коммиты — по-русски, как весь проект.
- **Порядок загрузки модулей:** новые файлы получают номера `03-firestore.js`, `04-repo.js`, `06-migrate.js` — до модулей интерфейса (`20-` и далее) и после `00-core.js`.

---

### Task 1: Подключение Firestore и правила доступа

**Files:**
- Modify: `index.html` (подключение SDK, CSP)
- Create: `src/03-firestore.js`
- Create: `tests/fs-mock.js`
- Modify: `src/00-core.js` (объявление `fsReady`)

**Interfaces:**
- Consumes: `fbApp`, `ensureFbApp()` из `src/01-gate.js`
- Produces: `fsDoc()` → `firebase.firestore.DocumentReference` на `couples/main`; `fsCol(name)` → `CollectionReference`; `initFirestore()` → `Promise<boolean>`; `fsReady` (boolean); `makeFsMock()` в тестах

- [ ] **Step 1: Владелец включает Firestore в консоли**

Это ручной шаг, выполняет владелец проекта. Firebase Console → **Build → Firestore Database → Создать базу данных** → регион `eur3 (europe-west)` → начать в **production mode**. Затем вкладка **Rules**, вставить и опубликовать:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function allowed() {
      return request.auth != null
        && request.auth.token.email in ['shakov.georgy@gmail.com', 'dashach98@gmail.com'];
    }
    match /couples/main/{document=**} {
      allow read, write: if allowed();
    }
  }
}
```

- [ ] **Step 2: Подключить SDK Firestore и открыть его в CSP**

В `index.html` после строки с `firebase-auth-compat.js` добавить:

```html
  <script src="https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore-compat.js"></script>
```

В том же файле в `<meta http-equiv="Content-Security-Policy">` в директиву `connect-src` дописать два адреса (Firestore ходит по обоим — обычный REST и long-polling канал):

```
https://firestore.googleapis.com https://www.googleapis.com
```

- [ ] **Step 3: Написать мок Firestore для тестов**

Создать `tests/fs-mock.js`. Он повторяет ту часть API, которой пользуется репозиторий: документы, запросы с `where`/`orderBy`/`limit`/`startAfter`, батчи, снапшоты и точечные обновления через точку в пути поля.

```js
/* Мок Firestore для тестов: хранит документы в обычном объекте
   { 'couples/main/events/abc': {...} } и повторяет ту часть API compat-SDK,
   которой пользуется src/04-repo.js. Специально НЕ повторяет всё подряд —
   только то, что реально вызывается, иначе мок становится вторым продуктом. */
'use strict';

function makeFsMock() {
  const store = {};       // путь → данные документа
  const listeners = [];   // активные onSnapshot
  let idCounter = 0;

  const clone = v => JSON.parse(JSON.stringify(v));
  const notify = () => listeners.forEach(l => l.fire());

  // Точечное обновление: { 'pushSubs.gosha': {...} } кладёт вглубь объекта
  function applyUpdate(target, patch) {
    for (const key of Object.keys(patch)) {
      const parts = key.split('.');
      let o = target;
      for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
      const last = parts[parts.length - 1];
      if (patch[key] === '__DELETE__') delete o[last];
      else o[last] = patch[key];
    }
  }

  function docRef(path) {
    return {
      path,
      id: path.split('/').pop(),
      async set(data, opts) {
        store[path] = opts && opts.merge ? { ...(store[path] || {}), ...clone(data) } : clone(data);
        notify();
      },
      async update(patch) {
        if (!store[path]) throw new Error('no document to update: ' + path);
        applyUpdate(store[path], clone(patch));
        notify();
      },
      async delete() {
        delete store[path];
        notify();
      },
      async get() {
        const data = store[path];
        return { exists: !!data, id: path.split('/').pop(), data: () => (data ? clone(data) : undefined) };
      },
      collection(name) {
        return colRef(path + '/' + name);
      }
    };
  }

  function colRef(path) {
    const query = { wheres: [], order: null, lim: 0, after: null };
    const api = {
      path,
      doc(id) {
        return docRef(path + '/' + (id || 'auto' + ++idCounter));
      },
      where(field, op, value) {
        query.wheres.push([field, op, value]);
        return api;
      },
      orderBy(field, dir) {
        query.order = [field, dir || 'asc'];
        return api;
      },
      limit(n) {
        query.lim = n;
        return api;
      },
      startAfter(cursor) {
        query.after = cursor;
        return api;
      },
      async get() {
        return { docs: run() };
      },
      onSnapshot(cb) {
        const l = { fire: () => cb({ docs: run() }) };
        listeners.push(l);
        l.fire();
        return () => {
          const i = listeners.indexOf(l);
          if (i >= 0) listeners.splice(i, 1);
        };
      }
    };

    function run() {
      let rows = Object.keys(store)
        .filter(p => p.startsWith(path + '/') && p.slice(path.length + 1).indexOf('/') === -1)
        .map(p => ({ id: p.split('/').pop(), data: () => clone(store[p]), _raw: store[p] }));
      for (const [field, op, value] of query.wheres) {
        rows = rows.filter(r => {
          const v = r._raw[field];
          if (op === '==') return v === value;
          if (op === '>=') return v >= value;
          if (op === '<=') return v <= value;
          if (op === 'in') return Array.isArray(value) && value.includes(v);
          throw new Error('мок не умеет оператор ' + op);
        });
      }
      if (query.order) {
        const [f, dir] = query.order;
        rows.sort((a, b) => (a._raw[f] > b._raw[f] ? 1 : a._raw[f] < b._raw[f] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      if (query.after) {
        const i = rows.findIndex(r => r.id === query.after.id);
        if (i >= 0) rows = rows.slice(i + 1);
      }
      if (query.lim) rows = rows.slice(0, query.lim);
      return rows;
    }

    return api;
  }

  const firestore = () => ({
    collection: name => colRef(name),
    doc: path => docRef(path),
    enablePersistence: async () => {},
    batch() {
      const ops = [];
      return {
        set: (ref, data) => ops.push(() => ref.set(data)),
        update: (ref, patch) => ops.push(() => ref.update(patch)),
        delete: ref => ops.push(() => ref.delete()),
        commit: async () => {
          for (const op of ops) await op();
        }
      };
    }
  });
  firestore.FieldValue = { delete: () => '__DELETE__' };

  return { firestore, _store: store, _listeners: listeners };
}

module.exports = { makeFsMock };
```

- [ ] **Step 4: Объявить `fsReady` в `00-core.js`**

Читается из `04-repo.js` и из интерфейса, а объявлен был бы в `03-firestore.js` — это ровно тот случай, ради которого существует правило про TDZ. В `src/00-core.js` рядом с `let authLocked = true;` добавить:

```js
let fsReady = false; // Firestore подключён и готов (см. src/03-firestore.js)
```

- [ ] **Step 5: Написать модуль подключения**

Создать `src/03-firestore.js`:

```js
/* ===== Firestore: подключение и ссылки =====
   Единственное место, которое знает адрес данных в облаке. Всё остальное
   ходит через репозиторий (src/04-repo.js).

   Приложение Firebase и Google-вход к этому моменту уже готовы — их поднимает
   гейт (src/01-gate.js) раньше всех. Здесь только берём готовое.

   Офлайн-кэш включается сразу: именно он даёт мгновенное открытие при втором
   и последующих заходах — данные отдаются с диска ещё до обращения к сети. */

const FS_ROOT = ['couples', 'main']; // всё живёт под одним поддеревом — одно правило доступа на всё

function fsDoc() {
  return firebase.firestore(fbApp).collection(FS_ROOT[0]).doc(FS_ROOT[1]);
}
function fsCol(name) {
  return fsDoc().collection(name);
}

async function initFirestore() {
  const app = typeof ensureFbApp === 'function' ? ensureFbApp() : null;
  if (!app || typeof firebase.firestore !== 'function') {
    fsReady = false;
    return false;
  }
  try {
    // synchronizeTabs — чтобы две открытые вкладки не дрались за один кэш.
    // Ошибки тут не смертельны: без офлайн-кэша приложение просто ходит в сеть
    // каждый раз, поэтому глушим и продолжаем.
    await firebase.firestore(app).enablePersistence({ synchronizeTabs: true });
  } catch (e) {
    console.warn('[fs] офлайн-кэш недоступен, работаем только по сети', e && e.code);
  }
  fsReady = true;
  return true;
}
```

- [ ] **Step 6: Написать тест подключения**

Создать `tests/uni-repo.js` (пока с одной проверкой; в следующих задачах он дополняется). Взять за образец песочницу из `tests/uni-sync.js` — тот же `makeEl`, `sandbox`, `wrapped`, но с добавлением `firebase.firestore` из мока.

```js
/* Юнит-тест слоя данных: мок Firestore (tests/fs-mock.js).
   Запуск: node tests\uni-repo.js app.js */
const fs = require('fs');
const { makeFsMock } = require('./fs-mock.js');
const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
const mock = makeFsMock();
// ...песочница как в tests/uni-sync.js, плюс:
//   firebase.firestore = mock.firestore;
//   firebase.auth().onAuthStateChanged отдаёт разрешённого пользователя
// В __TEST__ выставить: s.initFirestore, s.fsCol, s.fsDoc,
//   Object.defineProperty(s,'fsReady',{get:()=>fsReady})

(async () => {
  assert((await w('(s)=>s.initFirestore()')) === true, 'initFirestore поднимает Firestore');
  assert(w('(s)=>s.fsReady') === true, 'fsReady выставлен');
  assert(w('(s)=>s.fsCol("events").path') === 'couples/main/events', 'ссылка на коллекцию собрана верно');
  console.log('OK: ' + results.length + ' repo checks passed');
})().catch(e => { console.log('FAIL: repo: ' + (e && e.message)); process.exit(1); });
```

- [ ] **Step 7: Прогнать тест — должен падать**

Run: `node build.js && node tests/uni-repo.js app.js`
Expected: FAIL — `initFirestore is not defined`, потому что модуль ещё не собран в `app.js` (если Step 5 уже сделан, тест пройдёт сразу — это тоже допустимо, TDD здесь нужен ради проверки самого теста).

- [ ] **Step 8: Добавить тест в набор проверок**

В `package.json` в скрипты `test` и `check` дописать `&& node tests/uni-repo.js app.js` после `uni-sync.js`.

- [ ] **Step 9: Прогнать всё и закоммитить**

Run: `npm run check`
Expected: всё зелёное.

```bash
git add index.html src/00-core.js src/03-firestore.js tests/fs-mock.js tests/uni-repo.js package.json
git commit -m "Подключение Firestore: SDK, офлайн-кэш, правила доступа и мок для тестов"
```

---

### Task 2: Репозиторий — чтение

**Files:**
- Create: `src/04-repo.js`
- Modify: `src/00-core.js` (объявления `loadedMonths`, `photosCursor`)
- Modify: `tests/uni-repo.js`

**Interfaces:**
- Consumes: `fsCol()`, `fsDoc()` из Task 1; `db`, `defaultDB()`, `migrateDB()` из `00-core.js`
- Produces: `loadHotSet()` → `Promise<void>`; `loadMonth(year, month)` → `Promise<void>`; `loadMorePhotos()` → `Promise<number>` (сколько добавилось); `monthKey(year, month)` → `'YYYY-MM'`; `monthRange(year, month)` → `[fromIso, toIso]`

- [ ] **Step 1: Объявить состояние загрузки в `00-core.js`**

```js
// Какие месяцы календаря уже в кэше (см. src/04-repo.js). Читается из
// 40-calendar.js, поэтому объявлено здесь, а не в 04-repo.js — TDZ.
let loadedMonths = new Set();
let photosCursor = null; // курсор пагинации галереи
```

- [ ] **Step 2: Написать падающий тест на окно месяца**

В `tests/uni-repo.js` добавить:

```js
  // Окно месяца берётся с запасом назад: длительное событие, начавшееся
  // 28 июля и кончающееся 3 августа, обязано попасть в август.
  const range = w('(s)=>JSON.stringify(s.monthRange(2026, 7))'); // 7 = август
  assert(JSON.parse(range)[0] === '2026-07-01', 'окно августа начинается за 31 день до начала месяца');
  assert(JSON.parse(range)[1] === '2026-08-31', 'окно августа кончается последним днём месяца');
```

- [ ] **Step 3: Прогнать — должен падать**

Run: `node build.js && node tests/uni-repo.js app.js`
Expected: FAIL — `monthRange is not defined`

- [ ] **Step 4: Написать чтение**

Создать `src/04-repo.js`:

```js
/* ===== Репозиторий: единственный, кто ходит в Firestore =====
   db больше не «все наши данные», а кэш-проекция того, что нужно экрану:
   мелкие коллекции (заметки, списки, хотелки, лейблы) держим целиком, а
   события и фото — окнами и страницами. */

const PHOTO_PAGE = 60;

function monthKey(year, month) {
  return year + '-' + String(month + 1).padStart(2, '0');
}

// Запас назад на 31 день — максимальная длина события в интерфейсе. Без него
// событие с 28 июля по 3 августа выпало бы из запроса по августу, потому что
// его поле date лежит в июле.
function monthRange(year, month) {
  const from = new Date(year, month, 1);
  from.setDate(from.getDate() - 31);
  const to = new Date(year, month + 1, 0);
  // Внимание: iso() в этом проекте принимает (год, месяц, день), а не Date —
  // см. src/40-calendar.js.
  return [iso(from.getFullYear(), from.getMonth(), from.getDate()), iso(to.getFullYear(), to.getMonth(), to.getDate())];
}

function docsToArray(snap) {
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Горячий набор при входе: всё, что нужно первому экрану и ближайшей навигации.
// Десятки-сотни килобайт; при повторных заходах отдаётся из офлайн-кэша мгновенно.
async function loadHotSet() {
  if (!fsReady) return;
  const now = new Date();
  const [fromIso, toIso] = monthRange(now.getFullYear(), now.getMonth());
  const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

  const [labels, notes, lists, wishes, repeats, events, dates, settings, photos] = await Promise.all([
    fsCol('labels').get(),
    fsCol('notes').get(),
    fsCol('lists').get(),
    fsCol('wishes').get(),
    fsCol('events').where('repeat', '==', true).get(),
    fsCol('events').where('date', '>=', fromIso).where('date', '<=', toIso).get(),
    fsCol('dates').where('date', '>=', iso(monthAgo)).get(),
    fsDoc().collection('meta').doc('settings').get(),
    fsCol('photos').orderBy('order', 'asc').limit(PHOTO_PAGE).get()
  ]);

  db.labels = docsToArray(labels);
  db.notes = docsToArray(notes);
  db.lists = docsToArray(lists);
  db.wishlist = docsToArray(wishes);
  db.dates = docsToArray(dates);
  db.events = mergeById(docsToArray(repeats), docsToArray(events));
  db.photos = docsToArray(photos);
  const s = settings.exists ? settings.data() : {};
  db.pushSubs = s.pushSubs || {};

  photosCursor = photos.docs.length ? photos.docs[photos.docs.length - 1] : null;
  loadedMonths = new Set([monthKey(now.getFullYear(), now.getMonth())]);
}

// Одно и то же событие приходит и запросом повторяющихся, и запросом окна —
// склеиваем по id, чтобы в календаре не двоилось.
function mergeById(a, b) {
  const seen = new Set();
  const out = [];
  for (const item of a.concat(b)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

// Подгрузка месяца при переходе календаря. Уже загруженные не перезапрашиваем.
async function loadMonth(year, month) {
  if (!fsReady) return;
  const key = monthKey(year, month);
  if (loadedMonths.has(key)) return;
  const [fromIso, toIso] = monthRange(year, month);
  const snap = await fsCol('events').where('date', '>=', fromIso).where('date', '<=', toIso).get();
  db.events = mergeById(db.events, docsToArray(snap));
  loadedMonths.add(key);
}

// Следующая страница галереи. Возвращает, сколько фото добавилось (0 — конец).
async function loadMorePhotos() {
  if (!fsReady || !photosCursor) return 0;
  const snap = await fsCol('photos').orderBy('order', 'asc').startAfter(photosCursor).limit(PHOTO_PAGE).get();
  const rows = docsToArray(snap);
  db.photos = mergeById(db.photos, rows);
  photosCursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
  return rows.length;
}
```

- [ ] **Step 5: Дописать тесты чтения**

В `tests/uni-repo.js` добавить (после проверки `monthRange`):

```js
  // Наполняем мок напрямую и проверяем, что горячий набор разложился в db
  mock._store['couples/main/notes/n1'] = { text: 'Привет', author: 'gosha', pinned: false, order: 0, ts: 1 };
  mock._store['couples/main/labels/l1'] = { name: 'Семья', color: '#ec4899' };
  mock._store['couples/main/events/e1'] = { title: 'Годовщина', date: '2026-03-30', md: '03-30', repeat: true };
  mock._store['couples/main/meta/settings'] = { pushSubs: { gosha: { endpoint: 'x' } } };
  await w('(s)=>s.loadHotSet()');
  assert(w('(s)=>s.db.notes.length') === 1, 'заметки загружены целиком');
  assert(w('(s)=>s.db.notes[0].id') === 'n1', 'id документа попал в объект');
  assert(w('(s)=>s.db.labels[0].name') === 'Семья', 'лейблы загружены');
  assert(w('(s)=>s.db.events.some(e=>e.id==="e1")') === true, 'повторяющееся событие в наборе независимо от года');
  assert(w('(s)=>!!s.db.pushSubs.gosha') === true, 'подписки подтянулись из meta/settings');

  // Событие вне окна не грузится, пока не откроют его месяц
  mock._store['couples/main/events/e2'] = { title: 'Далёкое', date: '2027-12-01', md: '12-01', repeat: false };
  await w('(s)=>s.loadHotSet()');
  assert(w('(s)=>s.db.events.some(e=>e.id==="e2")') === false, 'далёкое событие не в горячем наборе');
  await w('(s)=>s.loadMonth(2027, 11)');
  assert(w('(s)=>s.db.events.some(e=>e.id==="e2")') === true, 'loadMonth дотянул нужный месяц');
  await w('(s)=>s.loadMonth(2027, 11)');
  assert(w('(s)=>s.db.events.filter(e=>e.id==="e2").length') === 1, 'повторный loadMonth не дублирует события');
```

- [ ] **Step 6: Прогнать тесты**

Run: `node build.js && node tests/uni-repo.js app.js`
Expected: PASS

- [ ] **Step 7: Коммит**

```bash
git add src/00-core.js src/04-repo.js tests/uni-repo.js
git commit -m "Репозиторий: чтение горячего набора, окон календаря и страниц галереи"
```

---

### Task 3: Репозиторий — запись

**Files:**
- Modify: `src/04-repo.js`
- Modify: `tests/uni-repo.js`

**Interfaces:**
- Consumes: `fsCol()`, `fsDoc()`, `fsReady`
- Produces: `repoSet(coll, obj)` → `Promise<string>` (id); `repoDelete(coll, id)` → `Promise<void>`; `repoBatch(coll, objs)` → `Promise<void>`; `repoMeta(patch)` → `Promise<void>`

Имена коллекций для `coll`: `'events' | 'dates' | 'notes' | 'lists' | 'wishes' | 'labels' | 'photos'`. Обрати внимание: в `db` хотелки лежат как `db.wishlist`, а коллекция называется `wishes` — это осознанное расхождение, менять `db.wishlist` нельзя, на него завязан интерфейс.

- [ ] **Step 1: Написать падающие тесты записи**

В `tests/uni-repo.js` добавить:

```js
  // repoSet кладёт документ и возвращает id, не сохраняя id внутрь документа
  const newId = await w('(s)=>s.repoSet("notes", {id:"n2", text:"Вторая", author:"dasha", pinned:false, order:1, ts:2})');
  assert(newId === 'n2', 'repoSet возвращает id');
  assert(mock._store['couples/main/notes/n2'].text === 'Вторая', 'документ записан');
  assert(mock._store['couples/main/notes/n2'].id === undefined, 'id не дублируется внутрь документа');

  // repoSet без id генерирует его сам
  const genId = await w('(s)=>s.repoSet("notes", {text:"Третья", author:"gosha", pinned:false, order:2, ts:3})');
  assert(typeof genId === 'string' && genId.length > 0, 'repoSet сам выдаёт id, если его нет');

  // repoDelete убирает документ
  await w('(s)=>s.repoDelete("notes","n2")');
  assert(mock._store['couples/main/notes/n2'] === undefined, 'repoDelete удаляет документ');

  // repoBatch пишет пачкой — так сохраняется новый порядок после перетаскивания
  await w('(s)=>s.repoBatch("notes", [{id:"n1", text:"Привет", order:5}, {id:"n3", text:"Ещё", order:6}])');
  assert(mock._store['couples/main/notes/n1'].order === 5, 'батч обновил первый документ');
  assert(mock._store['couples/main/notes/n3'].order === 6, 'батч создал второй документ');

  // repoMeta пишет ТОЧЕЧНО: подписка партнёра не должна пострадать
  mock._store['couples/main/meta/settings'] = { pushSubs: { gosha: { endpoint: 'g' }, dasha: { endpoint: 'd' } } };
  await w('(s)=>s.repoMeta({"pushSubs.gosha": {endpoint:"g2"}})');
  assert(mock._store['couples/main/meta/settings'].pushSubs.gosha.endpoint === 'g2', 'своя подписка обновилась');
  assert(mock._store['couples/main/meta/settings'].pushSubs.dasha.endpoint === 'd', 'подписка партнёра не затёрта');
```

- [ ] **Step 2: Прогнать — должен падать**

Run: `node build.js && node tests/uni-repo.js app.js`
Expected: FAIL — `repoSet is not defined`

- [ ] **Step 3: Написать запись**

Дописать в конец `src/04-repo.js`:

```js
/* ===== Запись =====
   Пришли на смену save(), который пересохранял весь блоб целиком. Вызывающий
   код по-прежнему сначала меняет db (интерфейс читает его синхронно), а затем
   говорит репозиторию, что именно изменилось.

   Ждать эти промисы не обязательно: Firestore применяет запись к локальному
   кэшу сразу, а отправку и повторы берёт на себя — в том числе когда сети нет. */

function stripId(obj) {
  const copy = { ...obj };
  delete copy.id;
  return copy;
}

async function repoSet(coll, obj) {
  const id = obj.id || uid();
  if (!fsReady) return id;
  await fsCol(coll).doc(id).set(stripId(obj));
  return id;
}

async function repoDelete(coll, id) {
  if (!fsReady) return;
  await fsCol(coll).doc(id).delete();
}

// Пачкой — для массовых изменений вроде нового порядка после перетаскивания.
// Firestore разрешает 500 операций на батч; у нас столько не бывает, но на
// всякий случай режем.
async function repoBatch(coll, objs) {
  if (!fsReady || !objs.length) return;
  for (let i = 0; i < objs.length; i += 400) {
    const batch = firebase.firestore(fbApp).batch();
    for (const obj of objs.slice(i, i + 400)) {
      batch.set(fsCol(coll).doc(obj.id || uid()), stripId(obj));
    }
    await batch.commit();
  }
}

// Настройки — ОДИН документ на двоих, и пишут в него оба устройства. Поэтому
// только точечное обновление по пути поля: set() целиком затёр бы подписку
// партнёра на push, и уведомления тихо перестали бы к нему приходить.
async function repoMeta(patch) {
  if (!fsReady) return;
  const ref = fsDoc().collection('meta').doc('settings');
  try {
    await ref.update(patch);
  } catch (e) {
    // Документа ещё нет — update по нему падает, создаём слиянием.
    await ref.set({}, { merge: true });
    await ref.update(patch);
  }
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `node build.js && node tests/uni-repo.js app.js`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add src/04-repo.js tests/uni-repo.js
git commit -m "Репозиторий: запись, удаление, батчи и точечное обновление настроек"
```

---

### Task 4: Живые обновления

**Files:**
- Modify: `src/04-repo.js`
- Modify: `src/00-core.js` (объявление `fsUnsubs`)
- Modify: `tests/uni-repo.js`

**Interfaces:**
- Consumes: `fsCol()`, `db`, функции перерисовки (`renderHome`, `renderNotes`, `renderLists`, `renderWishlist`, `renderCalendar`, `renderDates`)
- Produces: `startLiveUpdates()` → `void`; `stopLiveUpdates()` → `void`

- [ ] **Step 1: Объявить список отписок в `00-core.js`**

```js
let fsUnsubs = []; // активные подписки Firestore (см. src/04-repo.js)
```

- [ ] **Step 2: Написать падающий тест**

```js
  // Живое обновление: приходит правка «со второго устройства» — db меняется сам
  w('(s)=>{s.startLiveUpdates(); return 1;}');
  mock._store['couples/main/notes/live1'] = { text: 'От Даши', author: 'dasha', pinned: false, order: 9, ts: 9 };
  mock._listeners.forEach(l => l.fire());
  assert(w('(s)=>s.db.notes.some(n=>n.id==="live1")') === true, 'живое обновление внесло заметку в db');
  w('(s)=>{s.stopLiveUpdates(); return 1;}');
  assert(mock._listeners.length === 0, 'stopLiveUpdates снял все подписки');
```

- [ ] **Step 3: Прогнать — должен падать**

Run: `node build.js && node tests/uni-repo.js app.js`
Expected: FAIL — `startLiveUpdates is not defined`

- [ ] **Step 4: Реализовать подписки**

Дописать в `src/04-repo.js`:

```js
/* ===== Живые обновления =====
   Подписываемся только на мелкие коллекции целиком: их десятки документов,
   и правка партнёра должна появляться сама. События и фото сюда не берём —
   они грузятся окнами и страницами, подписка на них стоила бы чтений на
   каждый пролистанный месяц ради выгоды, которой почти нет. */

const LIVE_COLLECTIONS = [
  ['notes', 'notes', () => renderNotes()],
  ['lists', 'lists', () => renderLists()],
  ['wishes', 'wishlist', () => renderWishlist()],
  ['labels', 'labels', () => renderPhotos()],
  ['dates', 'dates', () => { renderHome(); renderCalendar(); }]
];

function startLiveUpdates() {
  if (!fsReady || fsUnsubs.length) return;
  for (const [coll, field, rerender] of LIVE_COLLECTIONS) {
    const unsub = fsCol(coll).onSnapshot(snap => {
      db[field] = docsToArray(snap);
      if (!authLocked) rerender();
    });
    fsUnsubs.push(unsub);
  }
  const unsubMeta = fsDoc().collection('meta').doc('settings').onSnapshot(doc => {
    const s = doc.exists ? doc.data() : {};
    db.pushSubs = s.pushSubs || {};
  });
  fsUnsubs.push(unsubMeta);
}

function stopLiveUpdates() {
  for (const unsub of fsUnsubs) {
    try {
      unsub();
    } catch (e) {}
  }
  fsUnsubs = [];
}
```

- [ ] **Step 5: Дописать мок под подписку на документ**

В `tests/fs-mock.js` в `docRef` добавить метод (мок Task 1 умеет `onSnapshot` только у коллекций):

```js
      onSnapshot(cb) {
        const l = { fire: () => cb({ exists: !!store[path], data: () => (store[path] ? clone(store[path]) : undefined) }) };
        listeners.push(l);
        l.fire();
        return () => {
          const i = listeners.indexOf(l);
          if (i >= 0) listeners.splice(i, 1);
        };
      },
```

- [ ] **Step 6: Прогнать тесты**

Run: `node build.js && node tests/uni-repo.js app.js`
Expected: PASS

- [ ] **Step 7: Коммит**

```bash
git add src/00-core.js src/04-repo.js tests/fs-mock.js tests/uni-repo.js
git commit -m "Репозиторий: живые обновления мелких коллекций и настроек"
```

---

### Task 5: Разовая миграция из старого сейфа

**Files:**
- Create: `src/06-migrate.js`
- Modify: `tests/uni-repo.js`

**Interfaces:**
- Consumes: `fsCol()`, `fsDoc()`, `repoBatch()`, `repoMeta()`, `db`, `masterKey`, старый `loadVault()` из `10-vault.js`
- Produces: `migrateFromVaultIfNeeded()` → `Promise<boolean>` (true — миграция выполнена сейчас)

- [ ] **Step 1: Написать падающий тест идемпотентности**

```js
  // Миграция: пустой Firestore + расшифрованный db → данные разложены по коллекциям
  Object.keys(mock._store).forEach(k => delete mock._store[k]);
  w('(s)=>{s.db = {...s.defaultDB(), notes:[{id:"m1",text:"Старая заметка",author:"gosha",pinned:false,order:0,ts:1}], events:[{id:"m2",title:"Дата",date:"2026-05-01",repeat:true}]}; return 1;}');
  assert((await w('(s)=>s.migrateFromVaultIfNeeded()')) === true, 'миграция выполнилась');
  assert(mock._store['couples/main/notes/m1'].text === 'Старая заметка', 'заметка переехала');
  assert(mock._store['couples/main/events/m2'].md === '05-01', 'у повторяющегося события проставлен md');

  // Повторный вызов ничего не делает: в базе уже есть данные
  assert((await w('(s)=>s.migrateFromVaultIfNeeded()')) === false, 'повторная миграция не запускается');
```

- [ ] **Step 2: Прогнать — должен падать**

Run: `node build.js && node tests/uni-repo.js app.js`
Expected: FAIL — `migrateFromVaultIfNeeded is not defined`

- [ ] **Step 3: Реализовать миграцию**

Создать `src/06-migrate.js`:

```js
/* ===== Разовый переезд из старого зашифрованного сейфа в Firestore =====
   Запускается сам при первом входе новой версии и безопасен при повторах:
   если в базе уже есть хоть один документ — не делает ничего.

   Старый блоб в Realtime Database НЕ удаляется: пока владелец своими глазами
   не подтвердит, что всё на месте, он остаётся нетронутой страховкой. */

function mdOf(dateIso) {
  return typeof dateIso === 'string' && dateIso.length >= 10 ? dateIso.slice(5, 10) : '';
}

async function migrateFromVaultIfNeeded() {
  if (!fsReady) return false;
  // Уже мигрировали? Достаточно одного документа в любой смысловой коллекции.
  const probe = await fsCol('notes').limit(1).get();
  const probeEvents = await fsCol('events').limit(1).get();
  if (probe.docs.length || probeEvents.docs.length) return false;
  if (!db || (!(db.events || []).length && !(db.notes || []).length && !(db.photos || []).length)) return false;

  // md нужен, чтобы годовщины находились независимо от года (см. спеку).
  const events = (db.events || []).map(e => ({ ...e, md: mdOf(e.date) }));

  await repoBatch('events', events);
  await repoBatch('dates', db.dates || []);
  await repoBatch('notes', db.notes || []);
  await repoBatch('lists', db.lists || []);
  await repoBatch('wishes', db.wishlist || []);
  await repoBatch('labels', db.labels || []);
  await repoBatch('photos', db.photos || []);
  if (db.pushSubs && Object.keys(db.pushSubs).length) {
    await repoMeta({ pushSubs: db.pushSubs });
  }
  console.warn('[migrate] данные перенесены в Firestore; старый сейф в RTDB оставлен как страховка');
  return true;
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `node build.js && node tests/uni-repo.js app.js`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add src/06-migrate.js tests/uni-repo.js
git commit -m "Разовый перенос данных из старого сейфа в Firestore"
```

---

### Task 6: Гейт переключается на Firestore

**Files:**
- Modify: `src/01-gate.js:95-125` (`ensureMasterKey`), `:143-172` (`unlockWithKey`)
- Modify: `tests/uni-repo.js`

**Interfaces:**
- Consumes: `initFirestore()`, `loadHotSet()`, `startLiveUpdates()`, `migrateFromVaultIfNeeded()`
- Produces: изменённый порядок входа — после получения ключа поднимается Firestore, грузится горячий набор, включаются живые обновления

Ключ фото после этой задачи берётся из `couples/main/meta/settings.photoKey`, а старый путь `vaults/secret` в RTDB остаётся только как источник для миграции.

- [ ] **Step 1: Читать ключ фото из Firestore**

В `src/01-gate.js` в `ensureMasterKey()` заменить блок чтения облачного ключа (тот, что ходит в `RTDB_SECRET_PATH`) на чтение из Firestore, оставив RTDB запасным вариантом для тех, кто ещё не мигрировал:

```js
  // Ключ фото: сначала Firestore (новое место), потом RTDB (старое, для
  // устройства, которое зашло первым и ещё не переносило данные).
  if (fsReady) {
    try {
      const snap = await withTimeout(fsDoc().collection('meta').doc('settings').get(), 10000);
      const raw = snap.exists ? snap.data().photoKey : null;
      if (typeof raw === 'string' && raw) {
        store.set(KEY_CACHE, raw);
        return await importRawKey(raw);
      }
    } catch (e) {
      console.warn('[gate] ключ фото из Firestore недоступен', e);
    }
  }
```

- [ ] **Step 2: Публиковать ключ в оба места**

В `publishMigratedKey()` после записи в RTDB добавить запись в Firestore:

```js
  if (fsReady) {
    try {
      await repoMeta({ photoKey: rawB64 });
    } catch (e) {
      console.warn('[gate] не удалось положить ключ фото в Firestore', e);
    }
  }
```

- [ ] **Step 3: Поднять Firestore до загрузки данных**

В `tryEnterWithUser()` сразу после `showGateErr('Загружаем…');` вставить:

```js
    await initFirestore();
```

- [ ] **Step 4: Заменить источник данных в `unlockWithKey()`**

Тело `unlockWithKey()` сейчас расшифровывает локальный сейф. Заменить эту часть (от `const vault = loadVault();` до закрывающей скобки `catch`) на загрузку из Firestore, оставив старый сейф только как вход для миграции:

```js
  // Данные приходят из Firestore. Старый сейф читаем ровно один раз — чтобы
  // было что переносить; после успешного переезда он больше не нужен.
  const legacyVault = loadVault();
  if (legacyVault && legacyVault.db) {
    try {
      const raw = await aesDec(masterKey, legacyVault.db);
      db = migrateDB({ ...defaultDB(), ...JSON.parse(dec.decode(raw)) });
      await migrateFromVaultIfNeeded();
    } catch (e) {
      console.warn('Старый сейф не расшифровался — работаем только с облаком', e);
    }
  }
  await loadHotSet();
  startLiveUpdates();
```

- [ ] **Step 5: Проверить полный вход в тесте**

В `tests/uni-repo.js` добавить:

```js
  // Полный вход: гейт → Firestore → горячий набор → живые обновления
  Object.keys(mock._store).forEach(k => delete mock._store[k]);
  mock._store['couples/main/notes/afterlogin'] = { text: 'Из облака', author: 'gosha', pinned: false, order: 0, ts: 1 };
  mockPopupUser = { email: 'shakov.georgy@gmail.com', uid: 'uid-gosha' };
  await w('(s)=>s.gateSignIn()');
  assert(w('(s)=>s.isLocked()') === false, 'вход прошёл');
  assert(w('(s)=>s.db.notes.some(n=>n.id==="afterlogin")') === true, 'данные пришли из Firestore, а не из сейфа');
```

- [ ] **Step 6: Прогнать всё**

Run: `npm run check`
Expected: `uni-repo` зелёный. `uni-smoke` и `uni-sync` могут упасть — они всё ещё про старую механику, их чинит Task 14. Если падают только они — это ожидаемо, идём дальше; в коммит попадает рабочий `uni-repo`.

- [ ] **Step 7: Коммит**

```bash
git add src/01-gate.js tests/uni-repo.js
git commit -m "Вход: данные и ключ фото берутся из Firestore, старый сейф — только источник миграции"
```

---

### Task 7: Календарь и свидания на репозиторий

**Files:**
- Modify: `src/40-calendar.js` (4 вызова `save()`)
- Modify: `src/30-home.js` (2 вызова `save()`)
- Modify: `tests/uni-repo.js`

**Interfaces:**
- Consumes: `repoSet()`, `repoDelete()`, `loadMonth()`, `mdOf()` из Task 5
- Produces: календарь, который дотягивает незагруженные месяцы при перелистывании

- [ ] **Step 1: Заменить сохранения событий**

В `src/40-calendar.js` найти все места, где после изменения `db.events` вызывается `save()`, и заменить. Шаблон для создания и правки события (`saveEventFromModal`):

```js
  // было: db.events.push(ev); save();
  ev.md = mdOf(ev.date);
  db.events.push(ev);
  repoSet('events', ev);
```

Для правки существующего:

```js
  // было: Object.assign(ev, {...}); save();
  Object.assign(ev, { title, date, endDate, emoji, repeat });
  ev.md = mdOf(ev.date);
  repoSet('events', ev);
```

Для удаления:

```js
  // было: db.events = db.events.filter(e => e.id !== id); save();
  db.events = db.events.filter(e => e.id !== id);
  repoDelete('events', id);
```

Для изменения свидания внутри панели дня (`toggleDateDone` и правка):

```js
  // было: dt.done = !dt.done; save();
  dt.done = !dt.done;
  repoSet('dates', dt);
```

- [ ] **Step 2: Дотягивать месяц при перелистывании**

В `src/40-calendar.js` в `jumpCalendar()` (и в любом другом месте, где меняются `calY`/`calM`) после смены месяца добавить:

```js
  // Месяц мог быть ещё не загружен — тянем его и соседние, чтобы листание
  // дальше шло без ожидания.
  loadMonth(calY, calM).then(() => renderCalendar());
  loadMonth(calM === 0 ? calY - 1 : calY, calM === 0 ? 11 : calM - 1);
  loadMonth(calM === 11 ? calY + 1 : calY, calM === 11 ? 0 : calM + 1);
```

- [ ] **Step 3: Заменить сохранения свиданий на главной**

В `src/30-home.js` — создание свидания и ответ на приглашение:

```js
  // было: db.dates.push(dt); save();
  db.dates.push(dt);
  repoSet('dates', dt);
```

Вызов `notifyPartner(...)` рядом **оставить на месте** — он не зависит от способа сохранения.

- [ ] **Step 4: Тест на сохранение события**

```js
  // Событие, созданное интерфейсом, попадает в Firestore вместе с md
  w('(s)=>{const ev={id:"ev-new",title:"Новое",date:"2026-06-15",repeat:true}; s.db.events.push(ev); s.repoSet("events", {...ev, md:"06-15"}); return 1;}');
  await new Promise(r => setTimeout(r, 10));
  assert(mock._store['couples/main/events/ev-new'].md === '06-15', 'событие сохранено с md');
```

- [ ] **Step 5: Прогнать**

Run: `node build.js && node tests/uni-repo.js app.js`
Expected: PASS

- [ ] **Step 6: Коммит**

```bash
git add src/40-calendar.js src/30-home.js tests/uni-repo.js
git commit -m "Календарь и свидания пишут через репозиторий, месяцы догружаются при листании"
```

---

### Task 8: Заметки на репозиторий

**Files:**
- Modify: `src/50-notes.js` (5 вызовов `save()`)
- Modify: `src/05-dnd.js` (1 вызов `save()` — порядок заметок)

**Interfaces:**
- Consumes: `repoSet()`, `repoDelete()`, `repoBatch()`

- [ ] **Step 1: Заменить пять сохранений в `50-notes.js`**

Создание:

```js
  // было: db.notes.unshift({...}); save();
  const note = { id: uid(), text: t, ts: Date.now(), pinned: false, author: getUser(), order: 0 };
  db.notes.unshift(note);
  repoSet('notes', note);
```

Правка текста (`saveNoteEdit`):

```js
  n.text = val;
  repoSet('notes', n);
```

Закрепление (`togglePinNote`):

```js
  n.pinned = !n.pinned;
  repoSet('notes', n);
```

Удаление (`deleteNote`):

```js
  db.notes = db.notes.filter(x => x.id !== id);
  repoDelete('notes', id);
```

Пятое сохранение — там, где после изменения проставляется порядок нескольких заметок сразу: заменить на `repoBatch('notes', db.notes)`.

- [ ] **Step 2: Заменить единственное сохранение в `05-dnd.js`**

В этом файле ровно один `save()` — на строке 144, в конце перетаскивания лейбла
на фото. Меняются метаданные сразу нескольких фото (лейбл вешается и на то, что
под курсором, и на все отмеченные), поэтому здесь батч:

```js
    const targets = new Set(selectedPhotos); // всем отмеченным…
    targets.add(photo.dataset.id);           // …и фото под курсором
    applyLabelToPhotos(st.label, targets);
    selectedPhotos.clear();
    // было: save();
    repoBatch('photos', db.photos.filter(p => targets.has(p.id)));
    renderPhotos();
```

Порядок элементов после перетаскивания сохраняется не здесь, а в самих модулях
(`50-notes.js`, `60-lists-wishes.js`, `70-photos.js`) — он покрыт их задачами.

- [ ] **Step 3: Прогнать проверки**

Run: `node build.js && node tests/uni-repo.js app.js`
Expected: PASS

- [ ] **Step 4: Коммит**

```bash
git add src/50-notes.js src/05-dnd.js
git commit -m "Заметки и перетаскивание пишут через репозиторий"
```

---

### Task 9: Списки и хотелки на репозиторий

**Files:**
- Modify: `src/60-lists-wishes.js` (16 вызовов `save()`)

**Interfaces:**
- Consumes: `repoSet()`, `repoDelete()`, `repoBatch()`

Подзадачи списка лежат внутри документа списка, поэтому любое изменение подзадачи — это `repoSet('lists', list)` целиком, а не отдельная операция.

- [ ] **Step 1: Заменить сохранения списков**

Создание списка, переименование, добавление подзадачи, отметка подзадачи, удаление подзадачи, «выполнить список» — везде один шаблон:

```js
  // было: <мутация списка>; save();
  <мутация списка>;
  repoSet('lists', list);
```

Удаление списка целиком:

```js
  db.lists = db.lists.filter(l => l.id !== id);
  repoDelete('lists', id);
```

- [ ] **Step 2: Заменить сохранения хотелок**

Коллекция называется `wishes`, а массив в памяти — `db.wishlist`:

```js
  // создание
  const wish = { id: uid(), text, link, owner: getUser(), done: false, ts: Date.now() };
  db.wishlist.push(wish);
  repoSet('wishes', wish);

  // отметка «исполнено» и правка
  wish.done = !wish.done;
  repoSet('wishes', wish);

  // удаление
  db.wishlist = db.wishlist.filter(w => w.id !== id);
  repoDelete('wishes', id);
```

- [ ] **Step 3: Убедиться, что вызовов `save()` в файле не осталось**

Run: `grep -c "save()" src/60-lists-wishes.js`
Expected: `0`

- [ ] **Step 4: Прогнать проверки**

Run: `node build.js && node tests/uni-repo.js app.js`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add src/60-lists-wishes.js
git commit -m "Списки и хотелки пишут через репозиторий"
```

---

### Task 10: Фото-метаданные и лейблы на репозиторий

**Files:**
- Modify: `src/70-photos.js` (13 вызовов `save()`)
- Modify: `src/85-lightbox.js` (1 вызов `save()`)

**Interfaces:**
- Consumes: `repoSet()`, `repoDelete()`, `repoBatch()`, `loadMorePhotos()`

Файлы фото в этом плане не трогаются — меняются только метаданные (название, лейблы, закрепление, порядок). Загрузка и удаление самих файлов в Yandex остаются как есть.

- [ ] **Step 1: Заменить сохранения метаданных фото**

Добавление фото (после успешной загрузки файла в бакет):

```js
  db.photos.unshift(photo);
  repoSet('photos', photo);
```

Переименование, закрепление, снятие лейбла, применение лейбла к одному фото:

```js
  <мутация photo>;
  repoSet('photos', photo);
```

Массовые операции (применить лейбл нескольким, закрепить выбранные, новый порядок):

```js
  repoBatch('photos', db.photos.filter(p => touchedIds.includes(p.id)));
```

Удаление фото — сначала метаданные, потом файл (порядок важен: если файл удалится, а метаданные останутся, в галерее будет битая карточка):

```js
  db.photos = db.photos.filter(p => p.id !== id);
  await repoDelete('photos', id);
  // существующий код удаления файла из бакета остаётся ниже без изменений
```

- [ ] **Step 2: Заменить сохранения лейблов**

```js
  // создание
  const label = { id: uid(), name, color };
  db.labels.push(label);
  repoSet('labels', label);

  // переименование и смена цвета
  label.name = val;
  repoSet('labels', label);

  // удаление лейбла: он ещё снимается со всех фото
  db.labels = db.labels.filter(l => l.id !== id);
  repoDelete('labels', id);
  const touched = db.photos.filter(p => (p.labels || []).includes(id));
  touched.forEach(p => { p.labels = p.labels.filter(x => x !== id); });
  repoBatch('photos', touched);
```

- [ ] **Step 3: Заменить сохранение в лайтбоксе**

Закрепление фото прямо из полноэкранного просмотра:

```js
  galleryPhoto.pinned = !galleryPhoto.pinned;
  repoSet('photos', galleryPhoto);
```

- [ ] **Step 4: Подгружать следующую страницу галереи**

В `src/70-photos.js` в конце `renderPhotos()` добавить дозагрузку, когда показано почти всё загруженное:

```js
  // Догружаем следующую страницу заранее, чтобы прокрутка не упиралась в конец.
  if (db.photos.length && photosCursor) {
    loadMorePhotos().then(added => {
      if (added) renderPhotos();
    });
  }
```

- [ ] **Step 5: Убедиться, что `save()` не осталось**

Run: `grep -c "save()" src/70-photos.js src/85-lightbox.js`
Expected: `0` в обоих

- [ ] **Step 6: Прогнать проверки**

Run: `node build.js && node tests/uni-repo.js app.js`
Expected: PASS

- [ ] **Step 7: Коммит**

```bash
git add src/70-photos.js src/85-lightbox.js
git commit -m "Метаданные фото и лейблы пишут через репозиторий, галерея грузится страницами"
```

---

### Task 11: Пуш-уведомления на новых рельсах

**Files:**
- Modify: `src/96-push.js:94-95, 107-108, 142, 146`
- Modify: `tests/uni-repo.js`

**Interfaces:**
- Consumes: `repoMeta()`, `fbApp`, `gateUser`
- Produces: подписки живут в `meta/settings.pushSubs`, токен берётся из приложения гейта

Это самая коварная задача плана: ошибки отправки пушей намеренно проглатываются, поэтому поломка не даст ни одного сообщения на экране.

- [ ] **Step 1: Заменить источник токена**

В `src/96-push.js` в `notifyPartner()` заменить строку с `syncFirebase`:

```js
      // было: const user = syncFirebase && firebase.auth(syncFirebase).currentUser;
      const user = fbApp && firebase.auth(fbApp).currentUser;
```

- [ ] **Step 2: Писать подписку точечно**

Подписка (там, где было `db.pushSubs[getUser()] = sub.toJSON(); await save();`):

```js
  const subJson = sub.toJSON();
  db.pushSubs = db.pushSubs || {};
  db.pushSubs[getUser()] = subJson;
  // Точечно: документ настроек общий на двоих, запись целиком затёрла бы
  // подписку партнёра, и уведомления перестали бы к нему приходить — молча.
  await repoMeta({ ['pushSubs.' + getUser()]: subJson });
```

Отписка (там, где было `delete db.pushSubs[getUser()]; await save();`):

```js
  if (db.pushSubs) delete db.pushSubs[getUser()];
  await repoMeta({ ['pushSubs.' + getUser()]: firebase.firestore.FieldValue.delete() });
```

- [ ] **Step 3: Тест на сохранность подписки партнёра**

В `tests/uni-repo.js`:

```js
  // Подписываемся своим устройством — подписка партнёра обязана уцелеть
  mock._store['couples/main/meta/settings'] = { pushSubs: { dasha: { endpoint: 'd-endpoint' } } };
  await w('(s)=>s.repoMeta({"pushSubs.gosha": {endpoint:"g-endpoint"}})');
  const subs = mock._store['couples/main/meta/settings'].pushSubs;
  assert(subs.gosha.endpoint === 'g-endpoint' && subs.dasha.endpoint === 'd-endpoint', 'подписки обоих на месте');
```

- [ ] **Step 4: Прогнать**

Run: `node build.js && node tests/uni-repo.js app.js && node tests/send-push-auth.js`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add src/96-push.js tests/uni-repo.js
git commit -m "Пуши: токен из гейта, подписки точечно в настройках Firestore"
```

---

### Task 12: Экспорт и импорт копии без сейфа

**Files:**
- Modify: `src/80-settings.js:40-80` (`exportData`, `importData`)
- Modify: `tests/uni-repo.js`

**Interfaces:**
- Consumes: `db`, `repoBatch()`, `repoMeta()`, `photoStore.exportBlobs()`, `photoStore.importBlobs()`
- Produces: `exportData()` → `Promise<object>` — обычный JSON со всеми данными и зашифрованными блобами фото; `importData(text)` → `Promise<boolean|null>`

Спека сохраняет обе кнопки, но их текущая реализация опирается на сейф:
`exportData()` выгружает `loadVault()`, а `importData()` кладёт результат
обратно в `VAULT_KEY`. После рефактора сейфа не существует, поэтому обе
функции надо переписать — иначе кнопки останутся в интерфейсе и будут
молча выгружать пустоту.

Формат копии меняется: вместо зашифрованного сейфа — открытый JSON с данными
плюс отдельная секция с зашифрованными блобами фото (они и так зашифрованы,
расшифровывать их для бэкапа незачем).

- [ ] **Step 1: Написать падающий тест на круговой рейс**

В `tests/uni-repo.js`:

```js
  // Копия: выгрузили — почистили базу — загрузили обратно, данные вернулись
  Object.keys(mock._store).forEach(k => delete mock._store[k]);
  w('(s)=>{s.db = {...s.defaultDB(), notes:[{id:"b1",text:"Для бэкапа",author:"gosha",pinned:false,order:0,ts:1}]}; return 1;}');
  const dump = await w('(s)=>s.exportData()');
  assert(dump.ver === 2 && Array.isArray(dump.notes), 'копия — обычный JSON версии 2');
  assert(dump.notes[0].text === 'Для бэкапа', 'данные в копии открытым текстом');
  assert(JSON.stringify(dump).indexOf('"keys"') === -1, 'в копии больше нет сейфа');

  w('(s)=>{s.db = s.defaultDB(); return 1;}');
  assert((await w('(s)=>s.importData(' + JSON.stringify(JSON.stringify(dump)) + ')')) === true, 'импорт распознал копию');
  assert(mock._store['couples/main/notes/b1'].text === 'Для бэкапа', 'импорт вернул данные в базу');
```

- [ ] **Step 2: Прогнать — должен падать**

Run: `node build.js && node tests/uni-repo.js app.js`
Expected: FAIL — экспорт всё ещё отдаёт сейф, поля `ver: 2` в нём нет.

- [ ] **Step 3: Переписать экспорт**

В `src/80-settings.js` заменить тело `exportData()`:

```js
/* Копия данных: обычный JSON. Раньше выгружался зашифрованный сейф, но сейфа
   больше нет — данные живут в Firestore под защитой правил доступа. Фото
   кладём как есть: они и так зашифрованы, расшифровывать их ради бэкапа
   бессмысленно. */
async function exportData() {
  let photoSection = null;
  if (photoStore) {
    try {
      const blobs = await photoStore.exportBlobs();
      if (blobs.length) photoSection = { ver: 1, blobs };
    } catch (e) {
      console.warn('Не удалось собрать фото для бэкапа', e);
    }
  }
  const out = {
    ver: 2,
    savedAt: Date.now(),
    events: db.events || [],
    dates: db.dates || [],
    notes: db.notes || [],
    lists: db.lists || [],
    wishlist: db.wishlist || [],
    labels: db.labels || [],
    photos: db.photos || [],
    pushSubs: db.pushSubs || {}
  };
  if (photoSection) out.photos_blobs = photoSection;
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  a.download = `nasha-vselennaya-backup-${d.getFullYear()}-${mo}-${da}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  return out;
}
```

- [ ] **Step 4: Переписать импорт**

Там же заменить тело `importData()`:

```js
/* Восстановление из копии: заливаем обратно в Firestore. Старый формат
   (зашифрованный сейф с полем keys) больше не поддерживается — он не
   расшифровывается без пароля, которого в новой версии нет вовсе. */
async function importData(text) {
  try {
    const d = JSON.parse(text);
    if (!d || d.ver !== 2) {
      alert('Это копия старого формата — восстановить её эта версия уже не умеет.');
      return null;
    }
    await repoBatch('events', d.events || []);
    await repoBatch('dates', d.dates || []);
    await repoBatch('notes', d.notes || []);
    await repoBatch('lists', d.lists || []);
    await repoBatch('wishes', d.wishlist || []);
    await repoBatch('labels', d.labels || []);
    await repoBatch('photos', d.photos || []);
    if (d.pushSubs && Object.keys(d.pushSubs).length) await repoMeta({ pushSubs: d.pushSubs });
    if (d.photos_blobs && d.photos_blobs.ver === 1 && Array.isArray(d.photos_blobs.blobs) && photoStore) {
      try {
        await photoStore.importBlobs(d.photos_blobs.blobs);
      } catch (e) {
        console.warn('Не удалось восстановить фото', e);
      }
    }
    await loadHotSet();
    return true;
  } catch (err) {
    return null;
  }
}
```

- [ ] **Step 5: Прогнать тесты**

Run: `node build.js && node tests/uni-repo.js app.js`
Expected: PASS

- [ ] **Step 6: Коммит**

```bash
git add src/80-settings.js tests/uni-repo.js
git commit -m "Экспорт и импорт копии работают с Firestore вместо сейфа"
```

---

### Task 13: Чистка интерфейса

**Files:**
- Modify: `index.html` (раздел настроек, разметка гейта)
- Modify: `src/80-settings.js`
- Modify: `src/95-sync.js` (тексты статусов)
- Modify: `src/01-gate.js` (экран миграции, кнопка «Открыть без входа»)
- Modify: `src/10-vault.js` (кнопка «Скрыть», автозамок)
- Modify: `styles.css` (стиль плашки «нет сети»)

**Interfaces:**
- Produces: `renderOfflineBadge()` → `void` — единственный оставшийся технический индикатор

- [ ] **Step 1: Убрать мёртвые элементы из разметки**

В `index.html` удалить целиком:
- кнопку `#lockNowBtn` («🔒 Скрыть»),
- кнопку `#resetBtn` («🗑 Сбросить всё»),
- кнопку `#syncNowBtn` и абзац `#syncStatus`,
- кнопки `#cloudDiagBtn`, `#pushDiagBtn` и блоки вывода `#cloudDiagOut`, `#pushDiagOut`,
- абзац `#backupHint`,
- строки со счётчиками `#storageInfo` и `#photoStorageInfo` вместе с подписями,
- блок `#gateMigrateWrap` вместе с `#gateMigratePass` и `#gateMigrateGo`,
- кнопку `#gateResumeBtn` и подсказку `#gateResumeHint`.

Добавить в шапку, сразу после открывающего `<header>`, плашку:

```html
    <p class="offline-badge" id="offlineBadge" hidden>Нет сети — показываю сохранённое</p>
```

- [ ] **Step 2: Добавить стиль плашки**

В `styles.css` рядом с прочими стилями шапки:

```css
/* Единственный технический индикатор, который остался в интерфейсе:
   без него непонятно, почему старое фото сейчас не открывается. */
.offline-badge{
  margin:0;padding:6px 12px;text-align:center;
  font-size:var(--text-sm);font-weight:700;
  color:#92400e;background:#fef3c7;border-radius:var(--radius);
}
[data-theme="dark"] .offline-badge{color:#fde68a;background:#78350f}
```

- [ ] **Step 3: Показывать плашку по состоянию сети**

В `src/80-settings.js` добавить:

```js
/* ===== Плашка «нет сети» =====
   Единственный оставшийся технический индикатор. В норме ничего не
   показываем — работающее приложение не должно отчитываться о том, что оно
   работает. */
function renderOfflineBadge() {
  const el = $('#offlineBadge');
  if (el) el.hidden = navigator.onLine !== false;
}
window.addEventListener('online', renderOfflineBadge);
window.addEventListener('offline', renderOfflineBadge);
```

Вызвать `renderOfflineBadge()` в конце `unlockApp()`.

- [ ] **Step 4: Вычистить связанный код**

- В `src/80-settings.js` удалить из `renderSettings()` расчёт `#storageInfo`, `#photoStorageInfo` и весь блок про `#backupHint`; удалить обработчик `#resetBtn`. (`exportData()` к этому моменту уже переписан в Task 12 и `backupDate` не трогает.)
- В `src/95-sync.js` удалить `SYNC_STATUS_TEXT`, `renderSyncStatus`, `syncNow`, `syncUiState`, `syncUiTs` и обработчик `#syncNowBtn`; удалить `runCloudDiagnostics` и обработчик `#cloudDiagBtn`.
- В `src/96-push.js` удалить `runPushDiagnostics` и обработчик `#pushDiagBtn`.
- В `src/01-gate.js` удалить `gateMigrateSubmit`, `gateResume`, обработчики трёх удалённых элементов и обращения к ним из `lock()`.
- В `src/10-vault.js` удалить `lock()`, `startAutoLock()`, `autoLockTimer`, обработчик `#lockNowBtn`; в `00-core.js` удалить `AUTO_LOCK_MS` и `lastActivity`, если они больше нигде не используются (проверить `grep`).

- [ ] **Step 5: Убрать мёртвые тосты**

В `src/95-sync.js` и `src/10-vault.js` удалить вызовы `notify()` с текстами: «Данные обновлены с другого устройства», «В облаке сейф с другим паролем», «В облаке есть фото с другим паролем», «Часть фото не синхронизировалась», «Не удалось сохранить». Проверить, что удалены вместе с функциями, которые их порождали.

- [ ] **Step 6: Проверить, что ничего не осталось**

Run:
```bash
grep -rnE "lockNowBtn|resetBtn|syncNowBtn|syncStatus|cloudDiagBtn|pushDiagBtn|backupHint|storageInfo|gateResumeBtn|gateMigrateWrap" src/ index.html
```
Expected: пусто.

- [ ] **Step 7: Прогнать и закоммитить**

Run: `npm run check` (тесты `uni-smoke`/`uni-sync` чинит Task 14; если падают только они — идём дальше)

```bash
git add index.html styles.css src/
git commit -m "Чистка интерфейса: убраны автозамок, ручная синхронизация, диагностики, счётчики и мёртвые тосты"
```

---

### Task 14: Удаление мёртвого кода и починка тестов

**Files:**
- Delete: `src/10-vault.js`
- Modify: `src/01-gate.js` (принимает `unlockApp`/`showAuth`)
- Modify: `src/95-sync.js` (остаётся только адаптер Yandex)
- Delete: `tests/uni-sync.js`
- Modify: `tests/uni-smoke.js`, `tests/uni-photo-sync.js`, `package.json`

**Interfaces:**
- Produces: `unlockApp()` и `showAuth()` переезжают в `src/01-gate.js` с теми же именами и сигнатурами

- [ ] **Step 1: Перенести две уцелевшие функции и удалить файл**

Перенести `unlockApp()` и `showAuth()` из `src/10-vault.js` в `src/01-gate.js` без изменений, кроме одного: в `unlockApp()` вместо `if (typeof initSync === 'function') initSync();` теперь ничего не нужно — данные уже загружены в `unlockWithKey()`. Добавить туда `renderOfflineBadge();`.

Удалить `src/10-vault.js`. Функции `loadVault()` (нужна миграции) перенести в `src/06-migrate.js`; `save()`, `tryUnwrapKey()`, `legacyDB()`, `isLocked()` удалить, если `grep` не покажет живых вызовов.

- [ ] **Step 2: Оставить от `95-sync.js` только хранилище фото**

Из `src/95-sync.js` удалить всё, что относится к синхронизации блоба: `initSync`, `stopSync`, `pushVault`, `pullVault`, `writeVault`, `applyRemoteVault`, `listenRemote`, `forcePushVault`, `scheduleSyncPush`, `syncPushBlocked`, `syncTs`, `SYNC_PATH`, `SYNC_KEY`, `lastRemoteSnapshot`, `syncDb`, `syncFirebase`, `listCloudPhotos`.

Оставить: `YANDEX_CLOUD_CONFIG`, `makeCloudStorage()`, `presignedFetch()`, `withTimeout()`, `syncPhotos`, `schedulePhotoSync`, `PHOTO_PARTS`, `syncStorage` — и заменить внутри них обращения к `syncFirebase` на `fbApp`.

Переименовать файл в `src/95-photos-cloud.js`, чтобы имя перестало врать.

- [ ] **Step 3: Убрать вызов `boot()` из переименованного файла**

`boot()` вызывается в самом конце сборки. Перенести этот вызов в конец нового `src/95-photos-cloud.js`, сохранив комментарий про TDZ и `FIREBASE_CONFIG`.

- [ ] **Step 4: Удалить `tests/uni-sync.js`**

Он целиком про блоб-синхронизацию, которой больше нет. Его роль занял `tests/uni-repo.js`. Убрать из `package.json` из скриптов `test` и `check`.

- [ ] **Step 5: Починить `uni-smoke.js`**

Заменить в нём вход через `ensureMasterKey`/`unlockWithKey` на прямую подготовку `db` плюс мок Firestore из `tests/fs-mock.js`; убрать проверки, завязанные на `save()`, `loadVault()`, структуру сейфа и `isLocked()` после `lock()` (замка больше нет). Остальные ~400 проверок интерфейса не трогать — они и есть страховка, что рефактор ничего не сломал.

- [ ] **Step 6: Починить `uni-photo-sync.js`**

Заменить `initSync()` на прямую установку `syncStorage = makeCloudStorage()` и `fsReady = true`; убрать проверки про `syncReady`.

- [ ] **Step 7: Прогнать всё**

Run: `npm run check`
Expected: полностью зелёное. Это первый момент в плане, когда обязано пройти всё без исключений.

- [ ] **Step 8: Коммит**

```bash
git add -A
git commit -m "Удалён сейф и синхронизация блоба; тесты переведены на слой данных"
```

---

### Task 15: Живая проверка и документация

**Files:**
- Modify: `PROJECT-MEMORY.md`
- Modify: `README.md`

- [ ] **Step 1: Проверить на живом сайте**

Задеплоить и пройти сценарии руками, в этом порядке:

1. Вход через Google на компьютере — данные на месте, календарь заполнен.
2. Перелистать календарь на полгода назад — события подгружаются.
3. Создать событие, заметку, список, хотелку — появляются и переживают перезагрузку страницы.
4. Открыть сайт на телефоне вторым аккаунтом — те же данные.
5. **Создать свидание с телефона — на компьютере приходит уведомление.** Это та самая молчаливая поломка из спеки, проверять обязательно.
6. Ответить на приглашение — уведомление приходит второму.
7. Выключить сеть на телефоне — приложение открывается, показывает сохранённое, появляется плашка «нет сети». Проверять **именно в установленном на главный экран приложении**, а не во вкладке Safari: офлайн-кэш Firestore хранится в IndexedDB, а у standalone-режима на iOS с ней свои особенности — это отдельный риск в спеке.
8. Добавить заметку офлайн, включить сеть — заметка уезжает сама.
9. Открыть сайт заново через сутки — календарь заполняется мгновенно, без ожидания сети (проверка того, ради чего всё затевалось).

- [ ] **Step 2: Убедиться, что старый сейф цел**

В Firebase Console → Realtime Database проверить, что `vaults/shared` и `vaults/secret` на месте. Они остаются страховкой; удалять их можно будет отдельным решением через неделю-другую спокойной жизни.

- [ ] **Step 3: Обновить `PROJECT-MEMORY.md`**

Добавить новый раздел `## 0d. ⚡ Снимок состояния (дата) — САМЫЙ СВЕЖИЙ` в начало файла, у предыдущего снять пометку «самый свежий». Описать: переход на Firestore, роль `db` как кэша-проекции, три примитива записи, окна календаря и страницы галереи, куда переехали ключ фото и подписки, что старый сейф оставлен намеренно. Отдельно зафиксировать ловушку про CSP и Google-вход (`apis.google.com` + `frame-src`), потому что она уже один раз стоила двух раундов отладки.

- [ ] **Step 4: Обновить `README.md`**

В разделе про синхронизацию заменить описание блоба на Firestore, добавить правила доступа из Task 1, убрать упоминания сейфа и паролей.

- [ ] **Step 5: Коммит**

```bash
git add PROJECT-MEMORY.md README.md
git commit -m "Документация: слой данных на Firestore"
```

---

## Что дальше

После того как этот план доехал до прода и пара дней прошли без сюрпризов — пишется **план №2: ленивая загрузка фото**: пакетные подписанные ссылки, `GET` в Cloud Function, фоновая очередь миниатюр, кэш показ-версий с вытеснением, прогрессивный показ и закрытие бакета от публичного доступа. До тех пор фото продолжают работать по-старому.
