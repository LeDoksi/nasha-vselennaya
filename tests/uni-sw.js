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

function makeSw(netImpl) {
  const store = new Map(); // url → ответ
  const handlers = {};
  const key = r => (typeof r === 'string' ? new URL(r, SCOPE).href : r.url);
  const cache = {
    async match(r) {
      return store.get(key(r));
    },
    async put(r, res) {
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
  const src = fs.readFileSync('sw.js', 'utf8').replace(/NET_TIMEOUT_MS = \d+/, 'NET_TIMEOUT_MS = 30');
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
  let sw = makeSw(async () => resp('новый'));
  sw.store.set(sw.key('app.min.js'), resp('старый'));
  let ev = sw.fetchEvent('app.min.js');
  assert((await ev.responded).body === 'новый', 'сеть жива — отдаём свежий файл, не кэш');
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

  if (failed) {
    console.log('FAIL: ' + failed);
    process.exit(1);
  }
  console.log('OK: uni-sw');
})();
