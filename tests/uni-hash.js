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
