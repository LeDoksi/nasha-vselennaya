/* Service Worker: офлайн-доступ к статической оболочке приложения (устанавливаемость
   PWA сверх одного манифеста) + push-уведомления о свиданиях (src/96-push.js).

   ВАЖНО: SHELL_FILES ниже должен совпадать со списком копирования в
   .github/workflows/deploy-pages.yml — добавляешь новый статический файл на
   сайт, добавляй его в оба места, иначе он либо не задеплоится (deploy-pages),
   либо не попадёт в офлайн-кэш (тут). Шрифты (fonts/) намеренно не кэшируются —
   их отсутствие офлайн просто откатывается на системный шрифт, не ломает
   функциональность, а перечисление каждого файла по отдельности хрупко
   (addAll — атомарный: одна опечатка валит установку кэша целиком).

   CACHE_NAME версионируется вручную — меняешь состав SHELL_FILES или логику
   fetch, бампни версию, иначе часть пользователей будет обслуживаться старым
   активным воркером до следующей полной перезагрузки. */
const CACHE_NAME = 'nasha-vselennaya-shell-v1';
const SHELL_FILES = ['./', './index.html', './app.js', './styles.css', './icon.svg', './manifest.webmanifest', './vendor/sortable.min.js'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
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

// Stale-while-revalidate только для собственного origin: отдаём кэш сразу
// (мгновенная загрузка, работает офлайн), в фоне подтягиваем свежую версию в
// кэш на следующий раз — не залипаем на старом app.js неделями, но и не ждём
// сеть при каждой загрузке. Firebase/Yandex/Google — чужой origin, не трогаем.
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
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res && res.ok) caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

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
