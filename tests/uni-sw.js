// sw.js: сеть первой, кэш — запасной путь. Запуск: node tests/uni-sw.js
'use strict';
const fs = require('fs');
const vm = require('vm');

let failed = 0;
const assert = (cond, msg) => {
  console.log((cond ? 'OK: ' : 'FAIL: ') + msg);
  if (!cond) failed++;
};

const SCOPE = 'https://ledoksi.test/app/';
const resp = body => ({
  ok: true,
  body,
  clone() {
    return this;
  }
});

function makeSw(netImpl, putDelay = 0, swSrc = fs.readFileSync('sw.js', 'utf8')) {
  const store = new Map(); // url → ответ
  const handlers = {};
  const key = r => (typeof r === 'string' ? new URL(r, SCOPE).href : r.url);
  const cache = {
    async match(r) {
      return store.get(key(r));
    },
    async put(r, res) {
      if (putDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, putDelay));
      }
      store.set(key(r), res);
    },
    async addAll() {}
  };
  const self = {
    location: new URL('sw.js', SCOPE),
    addEventListener: (t, f) => (handlers[t] = f),
    skipWaiting() {},
    clients: { claim() {} },
    registration: {}
  };
  // Таймаут в тесте — 30 мс вместо 3 с, иначе сценарий «сеть висит» ждал бы 3 секунды.
  const src = swSrc.replace(/NET_TIMEOUT_MS = \d+/, 'NET_TIMEOUT_MS = 30');
  vm.runInContext(
    src,
    vm.createContext({ self, caches: { open: async () => cache, match: r => cache.match(r), keys: async () => [], delete: async () => true }, fetch: netImpl, URL, setTimeout, Promise })
  );
  const fetchEvent = (url, mode = 'no-cors') => {
    const ev = { request: { url: new URL(url, SCOPE).href, method: 'GET', mode }, responded: null, waited: null };
    ev.respondWith = p => (ev.responded = p);
    ev.waitUntil = p => (ev.waited = p);
    handlers.fetch(ev);
    return ev;
  };
  return { store, fetchEvent, key };
}

(async () => {
  // 1. Сеть жива — свежий ответ, кэш обновлён
  let lastInit = null;
  let sw = makeSw(async (req, init) => {
    lastInit = init;
    return resp('новый');
  });
  sw.store.set(sw.key('app.min.js'), resp('старый'));
  let ev = sw.fetchEvent('app.min.js');
  assert((await ev.responded).body === 'новый', 'сеть жива — отдаём свежий файл, не кэш');
  assert(lastInit && lastInit.cache === 'no-cache', 'fetch идёт с cache: no-cache — обходит HTTP-кэш браузера');
  await new Promise(r => setTimeout(r, 5));
  assert(sw.store.get(sw.key('app.min.js')).body === 'новый', 'свежий файл положен в кэш');

  // 2. Сеть упала — кэш
  sw = makeSw(async () => {
    throw new Error('offline');
  });
  sw.store.set(sw.key('styles.css'), resp('из кэша'));
  assert((await sw.fetchEvent('styles.css').responded).body === 'из кэша', 'офлайн — отдаём кэш');

  // 3. Сеть висит дольше таймаута — кэш, но потом обновляется в фоне
  sw = makeSw(() => new Promise(r => setTimeout(() => r(resp('поздно')), 200)));
  sw.store.set(sw.key('app.min.js'), resp('из кэша'));
  ev = sw.fetchEvent('app.min.js');
  assert((await ev.responded).body === 'из кэша', 'сеть не ответила за таймаут — кэш');
  await ev.waited; // ждём пока фоновое обновление завершится
  assert(sw.store.get(sw.key('app.min.js')).body === 'поздно', 'после таймаута кэш обновлен в фоне');

  // 4. Сеть висит, кэша нет — ждём сеть
  sw = makeSw(() => new Promise(r => setTimeout(() => r(resp('поздно')), 60)));
  assert((await sw.fetchEvent('fonts/onest.woff2').responded).body === 'поздно', 'кэша нет — дожидаемся сети');

  // 5. Навигация офлайн по адресу без записи — index.html
  sw = makeSw(async () => {
    throw new Error('offline');
  });
  sw.store.set(sw.key('./index.html'), resp('оболочка'));
  assert((await sw.fetchEvent('?from=push', 'navigate').responded).body === 'оболочка', 'офлайн-навигация — index.html из кэша');

  // 6. Чужой origin — не перехватываем
  sw = makeSw(async () => resp('x'));
  ev = sw.fetchEvent('https://firestore.googleapis.com/v1/x');
  assert(ev.responded === null, 'чужой origin не перехватывается');

  // 7. Сеть быстра, cache.put медленный — ответ не блокируется на запись
  sw = makeSw(async () => resp('новый'), 100);
  sw.store.set(sw.key('app.min.js'), resp('старый'));
  ev = sw.fetchEvent('app.min.js');
  assert((await ev.responded).body === 'новый', 'быстрая сеть не блокируется на cache.put');
  await ev.waited; // дожидаемся завершения записи
  assert(sw.store.get(sw.key('app.min.js')).body === 'новый', 'кэш обновлен после записи');

  // 8. Штамп деплоя (NV-80): index.html и sw.js получают одну версию
  const { stamp } = require('../tools/stamp-version.js');
  const files = {};
  for (const f of ['index.html', 'app.min.js', 'styles.css', 'sw.js']) files[f] = fs.readFileSync(f, 'utf8');
  const st = stamp(files);
  assert(st.html.includes(`src="app.min.js?v=${st.v}"`) && st.html.includes(`href="styles.css?v=${st.v}"`), 'штамп: index.html ссылается на ?v=<хэш>');
  assert(st.sw.includes(`'./app.min.js?v=${st.v}'`) && st.sw.includes(`'./styles.css?v=${st.v}'`), 'штамп: SHELL_FILES кэширует те же адреса');
  assert(st.sw.includes(`-shell-v3-${st.v}'`), 'штамп: CACHE_NAME несёт хэш');
  assert(stamp({ ...files, 'app.min.js': files['app.min.js'] + ' ' }).v !== st.v, 'штамп: новый app.min.js — новая версия');
  // Свежий index.html просит новый адрес; в кэше только старый — ждём сеть, не старый скрипт
  sw = makeSw(() => new Promise(r => setTimeout(() => r(resp('новый')), 60)), 0, st.sw);
  sw.store.set(sw.key('app.min.js?v=old'), resp('старый'));
  assert((await sw.fetchEvent(`app.min.js?v=${st.v}`).responded).body === 'новый', 'новая версия скрипта не подменяется старой из кэша');

  if (failed) {
    console.log('FAIL: ' + failed);
    process.exit(1);
  }
  console.log('OK: uni-sw');
})();
