/* Service Worker: офлайн-доступ к статической оболочке приложения (устанавливаемость
   PWA сверх одного манифеста) + push-уведомления о свиданиях (src/96-push.js).

   ВАЖНО: SHELL_FILES ниже должен совпадать со списком копирования в
   .github/workflows/deploy-pages.yml — добавляешь новый статический файл на
   сайт, добавляй его в оба места, иначе он либо не задеплоится (deploy-pages),
   либо не попадёт в офлайн-кэш (тут). Шрифты (fonts/) в SHELL_FILES не перечислены —
   установка кэша не должна падать из-за одного файла; в кэш они попадают при первом
   показе через обработчик fetch.

   Версия проставляется на деплое (tools/stamp-version.js, NV-80): app.min.js и
   styles.css получают ?v=<хэш оболочки> и в index.html, и в SHELL_FILES ниже,
   CACHE_NAME — тот же хэш в хвосте. Руками CACHE_NAME не бампать; переименовал
   его или файлы — поправь замены в stamp-version.js (он упадёт, если не найдёт). */
const CACHE_NAME = 'nasha-vselennaya-shell-v3';
const SHELL_FILES = ['./', './index.html', './app.min.js', './styles.css', './icon.svg', './manifest.webmanifest', './vendor/sortable.min.js'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // reload: мимо HTTP-кэша браузера — иначе в новый кэш мог лечь index.html
      // прошлой версии рядом со свежим app.min.js?v=…
      .then(cache => cache.addAll(SHELL_FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Сеть первой, кэш — запасной путь. Раньше было stale-while-revalidate: после
// деплоя первый заход показывал прошлую версию, а index.html и app.min.js
// могли оказаться из разных версий. Кэш отвечает, только если сеть упала или
// не ответила за NET_TIMEOUT_MS (плохая мобильная связь не вешает запуск).
// Таймаут — на каждый файл отдельно, но смешения версий нет: свежий index.html
// ссылается на app.min.js?v=<новый>, такого адреса в кэше нет — ждём сеть
// (штамп на деплое, NV-80). Firebase/Yandex/Google — чужой origin, не трогаем.
const NET_TIMEOUT_MS = 3000;

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(event, req));
});

async function networkFirst(event, req) {
  const cache = await caches.open(CACHE_NAME);
  // no-cache: условный запрос (304 дёшев) вместо ответа из HTTP-кэша браузера —
  // GitHub Pages отдаёт Cache-Control: max-age=600, без этого «сеть первой»
  // 10 минут подряд возвращала бы старый файл, не спрашивая сеть.
  const fetched = fetch(req, { cache: 'no-cache' });
  const write = fetched.then(res => (res && res.ok ? cache.put(req, res.clone()).catch(() => {}) : undefined));
  event.waitUntil(write.catch(() => {}));
  fetched.catch(() => {}); // отказ сети обрабатывается ниже
  const timeout = new Promise(resolve => setTimeout(resolve, NET_TIMEOUT_MS, null));
  try {
    const res = await Promise.race([fetched, timeout]);
    if (res) return res;
  } catch (e) {}
  const cached = (await cache.match(req)) || (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
  return cached || fetched;
}

self.addEventListener('push', event => {
  let data = { title: '💜 Наша вселенная', body: 'Новое уведомление' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './icon.svg',
      badge: './icon.svg',
      tag: 'nasha-vselennaya-date',
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
