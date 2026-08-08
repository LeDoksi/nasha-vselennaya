// Регрессионный тест: app.js стартует по прямой ссылке #/wishlist (вкладка из «Ещё»).
// Раньше BOTTOM_MORE был объявлен после showView → при старте по ссылке была
// TDZ-ошибка (ReferenceError: Cannot access 'BOTTOM_MORE' before initialization).
// Запуск: node tests/uni-hash.js app.js
const fs = require('fs');
const vm = require('vm');
const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
const el = () => ({
  id: '', dataset: {}, children: [], hidden: false, innerHTML: '', textContent: '', style: {},
  value: '', options: [], _handlers: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  addEventListener(t, f) { (this._handlers[t] = this._handlers[t] || []).push(f); },
  querySelectorAll() { return []; }, appendChild() {}, remove() {}, focus() {}, click() {}, setAttribute() {}, removeAttribute() {}
});
const store = {};
const ctx = {
  console, Date, Math, JSON, Object, Array, Number, String, RegExp, Promise, isNaN,
  TextEncoder, TextDecoder, performance,
  crypto: require('crypto').webcrypto,
  setTimeout() { return 0; }, setInterval() { return 1; }, clearTimeout() {}, clearInterval() {},
  alert() {}, confirm() { return true; }, btoa: s => Buffer.from(s, 'binary').toString('base64'),
  URL: { createObjectURL() { return 'blob:x'; }, revokeObjectURL() {} },
  FileReader: function () { this.result = null; this.readAsDataURL = (f) => { this.result = 'data:image/jpeg;base64,AA=='; if (this.onload) this.onload(); }; },
  Blob: function (p, o) { this._bytes = []; this.size = 0; this.type = (o && o.type) || ''; this.arrayBuffer = () => Promise.resolve(new Uint8Array().buffer); },
  HTMLAudioElement: function () {}, Image: function () {},
  localStorage: { getItem(k) { return store[k] ?? null; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; } },
  sessionStorage: { getItem(k) { return store[k] ?? null; }, setItem(k, v) { store[k] = String(v); } },
  location: { hash: '#/wishlist' },
  window: { addEventListener() {}, matchMedia() { return { matches: false }; } },
  document: {
    body: el(), documentElement: { dataset: {} }, createElement() { return el(); }, addEventListener() {},
    querySelector(sel) { return el(); }, querySelectorAll() { return []; }
  }
};
vm.createContext(ctx);
try {
  vm.runInContext(src, ctx);
  // как это делал window-блок на старте — открываем вкладку из «Ещё»
  vm.runInContext('showView("wishlist")', ctx);
  const av = vm.runInContext('activeView', ctx);
  const more = vm.runInContext('BOTTOM_MORE.indexOf("wishlist")', ctx);
  if (av !== 'wishlist' || more !== 0) { console.log('FAIL: активная вкладка не «wishlist», BOTTOM_MORE не на месте'); process.exit(1); }
  console.log('OK: старт по ссылке #/wishlist без TDZ-ошибки; activeView = ' + av + '; BOTTOM_MORE.indexOf(wishlist) = ' + more);
} catch (e) {
  console.log('FAIL: ' + e.message);
  process.exit(1);
}
