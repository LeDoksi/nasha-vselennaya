// Регрессионный тест: app.js стартует по прямой ссылке #/wishlist.
// Раньше BOTTOM_MORE (сейчас упразднён — шторка «Ещё» убрана, все вкладки в
// BOTTOM_PRIMARY) был объявлен после showView → при старте по ссылке была
// TDZ-ошибка (ReferenceError: Cannot access 'BOTTOM_MORE' before initialization).
// Проверяем тот же сценарий на BOTTOM_PRIMARY, который занял его место.
//
// Второй сценарий (F1, ревью фазы 4): прямая ссылка на «нашу» вкладку
// (#/notes) плюс localStorage.setItem, который бросает исключение (переполнен/
// приватный режим). showView() на top-level 20-theme-nav.js вызывает
// store.set(OUR_KEY, …) → store.set ловит исключение → notify() → setPopover()
// → topOverlayEl() читает `openOverlayStack` из src/00-core.js — если бы она
// всё ещё жила в src/62-global-clicks.js (сортируется позже), это была бы TDZ
// (ReferenceError: Cannot access 'openOverlayStack' before initialization),
// которая рвёт исполнение всего app.js ещё до готовности интерфейса.
// Запуск: node tests/uni-hash.js app.js
const fs = require('fs');
const vm = require('vm');
const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
const el = () => ({
  id: '',
  dataset: {},
  children: [],
  hidden: false,
  innerHTML: '',
  textContent: '',
  style: {},
  value: '',
  options: [],
  _handlers: {},
  classList: {
    add() {},
    remove() {},
    toggle() {},
    contains() {
      return false;
    }
  },
  addEventListener(t, f) {
    (this._handlers[t] = this._handlers[t] || []).push(f);
  },
  querySelectorAll() {
    return [];
  },
  appendChild() {},
  remove() {},
  focus() {},
  click() {},
  setAttribute() {},
  removeAttribute() {}
});
// Песочница-фабрика: каждому сценарию — свой vm-контекст (top-level
// let/const в app.js нельзя выполнить в контексте дважды — «already declared»).
// throwingStorage=true — localStorage.setItem всегда бросает (переполнение/
// приватный режим), как в findings F1.
function makeCtx(hash, throwingStorage) {
  const store = {};
  return {
    console,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Number,
    String,
    RegExp,
    Promise,
    isNaN,
    TextEncoder,
    TextDecoder,
    performance,
    crypto: require('crypto').webcrypto,
    setTimeout() {
      return 0;
    },
    setInterval() {
      return 1;
    },
    clearTimeout() {},
    clearInterval() {},
    alert() {},
    confirm() {
      return true;
    },
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    URL: {
      createObjectURL() {
        return 'blob:x';
      },
      revokeObjectURL() {}
    },
    FileReader: function () {
      this.result = null;
      this.readAsDataURL = f => {
        this.result = 'data:image/jpeg;base64,AA==';
        if (this.onload) this.onload();
      };
    },
    Blob: function (p, o) {
      this._bytes = [];
      this.size = 0;
      this.type = (o && o.type) || '';
      this.arrayBuffer = () => Promise.resolve(new Uint8Array().buffer);
    },
    HTMLAudioElement: function () {},
    Image: function () {},
    localStorage: {
      getItem(k) {
        return store[k] ?? null;
      },
      setItem(k, v) {
        if (throwingStorage) throw new Error('QuotaExceededError');
        store[k] = String(v);
      },
      removeItem(k) {
        delete store[k];
      }
    },
    sessionStorage: {
      getItem(k) {
        return store[k] ?? null;
      },
      setItem(k, v) {
        store[k] = String(v);
      },
      removeItem(k) {
        delete store[k];
      }
    },
    location: { hash },
    window: {
      addEventListener() {},
      matchMedia() {
        return { matches: false };
      }
    },
    document: {
      body: el(),
      documentElement: { dataset: {} },
      createElement() {
        return el();
      },
      addEventListener() {},
      querySelector(sel) {
        return el();
      },
      querySelectorAll() {
        return [];
      }
    }
  };
}

// NV-119: initial-блок в 20-theme-nav.js откладывает первый showView() на
// микрозадачу (Promise.resolve().then), чтобы к моменту его выполнения весь
// app.js уже доисполнился (см. комментарий там же). vm.runInContext не
// сливает микрозадачи сама — tick() ждёт реальный оборот event loop, к концу
// которого микрозадачи из runInContext уже разобраны (проверено эмпирически).
function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

(async () => {
  // Сценарий 1: прямая ссылка #/wishlist, хранилище работает как обычно.
  try {
    const ctx = makeCtx('#/wishlist', false);
    vm.createContext(ctx);
    // filename — даёт npm run coverage (c8) сопоставить покрытие с app.js
    // вместо анонимного vm-скрипта.
    vm.runInContext(src, ctx, { filename: file });
    // как это делал window-блок на старте — открываем вкладку по прямой ссылке
    vm.runInContext('showView("wishlist")', ctx);
    const av = vm.runInContext('activeView', ctx);
    const idx = vm.runInContext('BOTTOM_PRIMARY.indexOf("our")', ctx);
    if (av !== 'wishlist' || idx < 0) {
      console.log('FAIL: активная вкладка не «wishlist» или в BOTTOM_PRIMARY нет «Наше»');
      process.exit(1);
    }
    console.log('OK: старт по ссылке #/wishlist без TDZ-ошибки; activeView = ' + av + '; BOTTOM_PRIMARY.indexOf(our) = ' + idx);
  } catch (e) {
    console.log('FAIL: ' + e.message);
    process.exit(1);
  }

  // Сценарий 2 (F1): прямая ссылка #/notes, localStorage.setItem бросает исключение.
  try {
    const ctx2 = makeCtx('#/notes', true);
    vm.createContext(ctx2);
    vm.runInContext(src, ctx2, { filename: file }); // не должно бросить — именно это была TDZ-находка F1
    await tick(); // initial showView() теперь идёт микрозадачей (NV-119) — ждём её
    const av2 = vm.runInContext('activeView', ctx2);
    if (av2 !== 'notes') {
      console.log('FAIL: активная вкладка не «notes» после старта по #/notes с падающим localStorage.setItem');
      process.exit(1);
    }
    console.log('OK: старт по ссылке #/notes с падающим localStorage.setItem без TDZ-ошибки; activeView = ' + av2);
  } catch (e) {
    console.log('FAIL: ' + e.message);
    process.exit(1);
  }

  // Сценарий 3 (G2/G8, ревью фазы 5): прямая ссылка #/memory — «Память» больше не
  // отдельная вкладка (NV-52, живёт на оси Главной), своего <section> у неё нет.
  // $('#view-memory') должен НЕ находиться — иначе initial-блок в 20-theme-nav.js
  // вызвал бы showView('memory') и увёл активный экран с Главной. querySelector
  // в makeCtx по умолчанию возвращает элемент на любой селектор — здесь его
  // точечно переопределяем для '#view-memory', имитируя реальную разметку.
  try {
    const ctx3 = makeCtx('#/memory', false);
    const realQuerySelector = ctx3.document.querySelector;
    ctx3.document.querySelector = sel => (sel === '#view-memory' ? null : realQuerySelector(sel));
    vm.createContext(ctx3);
    vm.runInContext(src, ctx3, { filename: file });
    await tick();
    const av3 = vm.runInContext('activeView', ctx3);
    if (av3 !== 'home') {
      console.log('FAIL: активная вкладка не «home» после старта по неизвестной ссылке #/memory');
      process.exit(1);
    }
    console.log('OK: старт по неизвестной ссылке #/memory без TDZ-ошибки; activeView = ' + av3 + ' (Главная осталась активной)');
  } catch (e) {
    console.log('FAIL: ' + e.message);
    process.exit(1);
  }

  // Сценарий 4 (фаза 7): go() с несуществующим экраном не трогает адрес.
  // Кнопка приглашений (.nav-btn без data-view) звала go(undefined) и писала #/undefined.
  try {
    const ctx4 = makeCtx('#/notes', false);
    const realQS = ctx4.document.querySelector;
    ctx4.document.querySelector = sel => (sel === '#view-undefined' ? null : realQS(sel));
    vm.createContext(ctx4);
    vm.runInContext(src, ctx4, { filename: file });
    vm.runInContext('go(undefined)', ctx4);
    if (ctx4.location.hash !== '#/notes') {
      console.log('FAIL: go(undefined) переписал адрес на ' + ctx4.location.hash);
      process.exit(1);
    }
    console.log('OK: go(undefined) не трогает адрес');
  } catch (e) {
    console.log('FAIL: ' + e.message);
    process.exit(1);
  }

  // ===== NV-119: прямая ссылка на вкладку крашится без View Transitions =====
  // Без document.startViewTransition (iOS Safari < 18, старый Firefox) showView()
  // из initial-блока выполняется тем же тиком, что и весь app.js. #/calendar и
  // #/photos читают top-level let, объявленный в файле, что идёт в сборке позже
  // 20-theme-nav.js (calY — 40-calendar.js, photosRenderQueued — 71-photo-grid.js) —
  // на момент вызова объявление физически ещё не выполнилось, ReferenceError
  // рвёт весь app.js. В песочнице makeCtx это уже не маскируется querySelector-
  // стабом (он возвращает элемент на любой селектор — #view-calendar в том
  // числе, поэтому showView() дальше проходит и доходит до чтения calY/
  // photosRenderQueued) — раньше сценариев для этих хэшей просто не было.
  async function checkDirectLink(hash, expectedView) {
    const ctx = makeCtx(hash, false);
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: file }); // TDZ здесь бросала бы синхронно
    await tick();
    const av = vm.runInContext('activeView', ctx);
    if (av !== expectedView) throw new Error('активная вкладка «' + av + '», ожидали «' + expectedView + '» (прямая ссылка ' + hash + ')');
  }
  try {
    await checkDirectLink('#/calendar', 'calendar');
    console.log('OK: старт по ссылке #/calendar без TDZ-ошибки (NV-119)');
    await checkDirectLink('#/photos', 'photos');
    console.log('OK: старт по ссылке #/photos без TDZ-ошибки (NV-119)');
    await checkDirectLink('#/lists', 'lists'); // контрольный сценарий: тут TDZ не было и не должно появиться
    console.log('OK: старт по ссылке #/lists без TDZ-ошибки — контрольный сценарий (NV-119)');
  } catch (e) {
    console.log('FAIL: ' + e.message);
    process.exit(1);
  }

  // Ревью раунда 1 (завершает NV-119): unlockApp() после входа звал go('home')
  // безусловно — прямая ссылка #/calendar возвращалась на Главную. Теперь
  // садимся на запрошенный экран; неизвестный (нет секции) — Главная.
  try {
    const ctx = makeCtx('#/calendar', false);
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: file });
    await tick();
    vm.runInContext('showView("home")', ctx); // как до входа: гейт закрывал приложение на Главной
    vm.runInContext('unlockApp()', ctx);
    const av = vm.runInContext('activeView', ctx);
    if (av !== 'calendar') throw new Error('после unlockApp() по ссылке #/calendar активна «' + av + '», ожидали «calendar»');
    console.log('OK: unlockApp() оставляет на запрошенном экране #/calendar');

    const ctx2 = makeCtx('#/memory', false);
    const qs = ctx2.document.querySelector;
    ctx2.document.querySelector = sel => (sel === '#view-memory' ? null : qs(sel));
    vm.createContext(ctx2);
    vm.runInContext(src, ctx2, { filename: file });
    await tick();
    vm.runInContext('unlockApp()', ctx2);
    const av2 = vm.runInContext('activeView', ctx2);
    if (av2 !== 'home') throw new Error('после unlockApp() по неизвестной ссылке активна «' + av2 + '», ожидали «home»');
    console.log('OK: unlockApp() по неизвестной ссылке — Главная');
  } catch (e) {
    console.log('FAIL: ' + e.message);
    process.exit(1);
  }

  // #/settings — тот же TDZ (PUSH_CONFIG, 96-push.js), но renderSettings()
  // зовёт renderPushSettings() — async function — без await. Синхронный
  // ReferenceError внутри async function не всплывает наверх и не рвёт
  // app.js (в отличие от #/calendar/#/photos выше), а тихо превращается в
  // rejected promise — переключатель push-уведомлений просто не настраивается.
  // makeCtx по умолчанию не даёт navigator/window.PushManager — pushSupported()
  // короткозамыкается на первой проверке и до PUSH_CONFIG не добирается,
  // маскируя падение; здесь добавляем оба, чтобы тест умел различить починенный
  // код (никакого unhandledRejection) от сломанного (rejection с TDZ-сообщением).
  try {
    const ctx = makeCtx('#/settings', false);
    ctx.navigator = { serviceWorker: {} };
    ctx.window.PushManager = function () {};
    let rejection = null;
    const onRejection = e => (rejection = e);
    process.on('unhandledRejection', onRejection);
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: file });
    await tick();
    await tick(); // rejection всплывает следующим тиком после самой микрозадачи showView()
    process.off('unhandledRejection', onRejection);
    const av = vm.runInContext('activeView', ctx);
    if (av !== 'settings') throw new Error('активная вкладка «' + av + '», ожидали «settings» (прямая ссылка #/settings)');
    if (rejection) throw new Error('#/settings: незамеченный rejected promise — ' + (rejection && rejection.message ? rejection.message : rejection));
    console.log('OK: старт по ссылке #/settings без TDZ-ошибки, без rejected promise (NV-119)');
  } catch (e) {
    console.log('FAIL: ' + e.message);
    process.exit(1);
  }
})();
