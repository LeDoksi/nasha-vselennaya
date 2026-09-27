// Помощник рендера (src/00-html.js) и страж: вне него innerHTML не пишется,
// esc() не зовётся (в html`` экранирование уже по умолчанию, esc внутри — двойное).
// Запуск: node tests/uni-render.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
const assert = (cond, msg) => {
  console.log((cond ? 'OK: ' : 'FAIL: ') + msg);
  if (!cond) failed++;
};

// --- юнит-тесты помощника ---
const core = fs.readFileSync('src/00-core.js', 'utf8');
const escLine = core.match(/^const esc = .*$/m)[0];
const ctx = vm.createContext({});
const h = vm.runInContext(escLine + '\n' + fs.readFileSync('src/00-html.js', 'utf8') + '\n;({ html, raw, render, SafeHtml });', ctx);

const evil = '<img src=x onerror="a()">&\'';
assert(String(h.html`<p>${evil}</p>`) === '<p>&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;</p>', 'подстановка экранируется');
assert(String(h.html`<b>${h.html`<i>${'<'}</i>`}</b>`) === '<b><i>&lt;</i></b>', 'вложенный html`` не экранируется второй раз');
assert(String(h.html`${h.raw('<br>')}`) === '<br>', 'raw() проходит как есть');
assert(String(h.html`<ul>${['<a>', h.html`<li>1</li>`]}</ul>`) === '<ul>&lt;a&gt;<li>1</li></ul>', 'массив: каждый элемент по своим правилам');
assert(String(h.html`${null}${undefined}${false}${0}`) === '0', 'null/undefined/false пустые, 0 — это 0');
assert(h.html`<p>x</p>`.includes('x') && '' + h.html`a` === 'a', 'SafeHtml ведёт себя как строка');
const el = { innerHTML: '' };
h.render(el, h.html`<p>${'a'}</p>`);
h.render(el, h.html`<p>${'a'}</p>`);
assert(el.innerHTML === '<p>a</p>', 'повторный render заменяет, а не дописывает');
h.render(null, h.html`x`);
assert(true, 'render(null) не падает');
h.render(el, '<b>');
assert(el.innerHTML === '&lt;b&gt;', 'render() голой строки экранирует, а не пропускает разметку');

// --- страж ---
// Файлы, ещё не переведённые на помощник: имя → сколько присваиваний innerHTML
// в нём сейчас. Каждая задача перевода удаляет свои строки; к концу фазы 2
// объект пустой. Число должно совпадать точно: и новое присваивание, и
// забытая правка списка — ошибка.
const PENDING = {};
const SELF = ['00-core.js', '00-html.js'];
for (const f of fs.readdirSync('src').filter(n => n.endsWith('.js') && !SELF.includes(n))) {
  const src = fs.readFileSync(path.join('src', f), 'utf8');
  const inner = (src.match(/\.innerHTML\s*\+?=(?!=)/g) || []).length;
  const pending = f in PENDING;
  const want = pending ? PENDING[f] : 0;
  assert(inner === want, f + ': innerHTML-присваиваний ' + inner + (pending ? ' (ждёт перевода: ' + want + ')' : ', нужно 0 — только render()'));
  if (!pending) assert(!/\besc\(/.test(src), f + ': нет esc() — в html`` экранирование по умолчанию');
  assert(!/\.insertAdjacentHTML\s*\(/.test(src), f + ': нет insertAdjacentHTML — в обход render() экранирование не сработает');
  assert(!/\.outerHTML\s*=(?!=)/.test(src), f + ': нет outerHTML — в обход render() экранирование не сработает');
  assert(!/addEventListener\(\s*['"]scroll['"]|\.onscroll\s*=/.test(src), f + ': нет обработчиков scroll — спека 3.2, только animation-timeline и IntersectionObserver');
}

if (failed) {
  console.log('FAIL: ' + failed);
  process.exit(1);
}
console.log('OK: uni-render');
