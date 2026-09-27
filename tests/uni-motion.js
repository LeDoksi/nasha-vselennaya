// Фаза 8, ревью всей ветки (J4, J7): точечные тесты двух функций движения,
// изолированных из src/*.js (как tests/uni-render.js тестирует html()/render()
// вне общей песочницы uni-smoke.js — там либо requestAnimationFrame не
// определён (60-lists.js рано выходит из listFlipAnimate), либо
// document.body.appendChild — пустышка (celebrate() ничего не сохранить,
// чтобы проверить style.animationDuration)).
// Запуск: node tests/uni-motion.js
'use strict';
const fs = require('fs');
const vm = require('vm');

let failed = 0;
const assert = (cond, msg) => {
  console.log((cond ? 'OK: ' : 'FAIL: ') + msg);
  if (!cond) failed++;
};

// Достаём функцию по имени из src-файла балансом скобок (как tests/uni-tokens.js
// достаёт слой tokens) — не regex до первой '}', тело функции с вложенными блоками.
function extractFn(file, name) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(new RegExp('function\\s+' + name + '\\s*\\('));
  if (!m) throw new Error(name + ' не найдена в ' + file);
  const start = m.index;
  const braceStart = src.indexOf('{', start);
  let depth = 0,
    end = braceStart;
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++;
    else if (src[end] === '}') {
      depth--;
      if (depth === 0) {
        end++;
        break;
      }
    }
  }
  return src.slice(start, end);
}

// ===== J4: listFlipAnimate — invert должен ставиться БЕЗ живого transition
// (иначе браузер сам анимирует постановку в старую позицию, съедая кадры
// самого FLIP), а снятие — через два кадра rAF, как и раньше. =====
{
  const fnSrc = extractFn('src/60-lists.js', 'listFlipAnimate');
  const rafQueue = [];
  const ctx = { requestAnimationFrame: fn => rafQueue.push(fn) };
  vm.createContext(ctx);
  vm.runInContext(fnSrc + '\nthis.listFlipAnimate = listFlipAnimate;', ctx);
  const listFlipAnimate = ctx.listFlipAnimate;

  // элемент реально переехал: было (0,0), стало (40,0) — dx=-40
  const moved = { style: {}, getBoundingClientRect: () => ({ left: 40, top: 0 }) };
  const before = new Map([[moved, { left: 0, top: 0 }]]);
  listFlipAnimate({ children: [moved] }, before);

  assert(moved.style.transition === 'none', 'invert ставится с transition:none — не даём живому CSS-transition анимировать саму постановку');
  assert(moved.style.transform === 'translate(-40px,0px)', 'invert-transform считается верно (r1-r2)');
  assert(rafQueue.length === 1, 'запланирован первый rAF');
  rafQueue.shift()(); // первый кадр — планирует второй
  assert(rafQueue.length === 1, 'из первого rAF запланирован второй');
  assert(moved.style.transition === 'none', 'transition ещё не снят между первым и вторым кадром');
  rafQueue.shift()(); // второй кадр — снимает transition/transform, доигрывает FLIP
  assert(moved.style.transition === '' && moved.style.transform === '', 'после двух rAF transition и transform сняты — CSS-transition доигрывает сам FLIP');

  // элемент без реального смещения — invert не ставится вовсе
  const still = { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const before2 = new Map([[still, { left: 0, top: 0 }]]);
  listFlipAnimate({ children: [still] }, before2);
  assert(still.style.transition === undefined && still.style.transform === undefined, 'без смещения (dx=dy=0) invert не трогает style вовсе');

  // guard: элемент без offsetWidth (песочница) не роняет функцию
  let threw = false;
  try {
    const noOffset = { style: {}, getBoundingClientRect: () => ({ left: 40, top: 0 }) };
    listFlipAnimate({ children: [noOffset] }, new Map([[noOffset, { left: 0, top: 0 }]]));
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'элемент без offsetWidth (typeof undefined) не роняет listFlipAnimate');
}

// ===== J7: celebrate() — длительность конфетти считается от токена
// --dur-celebrate, а не литералом секунд. =====
{
  const fnSrc = extractFn('src/30-home.js', 'celebrate');
  const created = [];
  const ctx = {
    Math,
    setTimeout: () => 0,
    document: {
      createElement: () => ({ style: {}, className: '', textContent: '' }),
      body: {
        appendChild: el => created.push(el)
      }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fnSrc + '\nthis.celebrate = celebrate;', ctx);
  ctx.celebrate();

  assert(created.length === 36, 'celebrate() создаёт 36 частиц конфетти, как и раньше');
  const allFromToken = created.every(el => /^calc\(var\(--dur-celebrate\)\s*\*\s*[\d.]+\)$/.test(el.style.animationDuration));
  assert(allFromToken, 'animationDuration каждой частицы — calc() от var(--dur-celebrate), не литерал секунд');
}

if (failed) {
  console.log('FAIL: ' + failed);
  process.exit(1);
}
console.log('OK: uni-motion');
