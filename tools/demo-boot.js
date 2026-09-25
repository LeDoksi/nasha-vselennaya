// tools/demo-boot.js — вставляет в стенд разметку настоящего index.html и
// запускает приложение. Раньше разметка была скопирована в demo.html руками
// и за фазы 0–1 дважды разъехалась с оригиналом; теперь копии нет вообще.
// Пути относительные к корню репозитория: в demo.html стоит <base href="../">.
(async function () {
  'use strict';
  const res = await fetch('index.html');
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  doc.querySelectorAll('script').forEach(s => s.remove()); // Firebase и app.min.js стенду не нужны
  document.body.className = doc.body.className;
  document.body.prepend(...[...doc.body.childNodes].map(n => document.importNode(n, true)));
  for (const src of ['vendor/sortable.min.js', 'app.js']) {
    await new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = ok;
      s.onerror = () => fail(new Error('demo: не загрузился ' + src));
      document.body.appendChild(s);
    });
  }
  // __demoReady — когда unlockApp() (src/01-gate.js) снял класс auth с <body>.
  (function waitUnlocked() {
    if (!document.body.classList.contains('auth')) {
      window.__demoReady = true;
      return;
    }
    setTimeout(waitUnlocked, 30);
  })();
})();
