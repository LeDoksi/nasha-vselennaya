// Страж шкал: цвета и радиусы живут только в токенах.
// Запуск: node tests/uni-tokens.js
'use strict';
const fs = require('fs');
const css = fs.readFileSync('styles.css', 'utf8');
// Слой tokens — единственное место, где разрешены литеральные цвета.
// Начало слоя ищем регэкспом, заякоренным на открывашку блока, а не голым
// indexOf('@layer tokens') — тот находит первое вхождение этой ПОДСТРОКИ
// где угодно в файле, хоть в комментарии, не требуя, чтобы за ней шла '{'.
// Комментарий с текстом "@layer tokens" перед посторонним правилом увёл бы
// indexOf на себя, а следующий за ним indexOf('{', ...) — на скобку ЭТОГО
// постороннего правила, и счётчик скобок принял бы его за сам слой tokens,
// спрятав реальный хардкод от проверки. /@layer\s+tokens\s*\{/ требует,
// чтобы сразу после "tokens" (с пробелом или без) шла именно '{' —
// у @layer tokens, base, ...; после "tokens" запятая, а не скобка, так что
// этот случай регэксп не подхватит. Пробел перед '{' — тоже сознательно:
// в реальном файле написано "@layer tokens {" (с пробелом), а буквальный
// регэксп из брифа (tokens\{, без \s*) на этом тексте вообще не совпадает.
const openMatch = css.match(/@layer\s+tokens\s*\{/);
if (!openMatch) {
  console.log('FAIL: не нашёл @layer tokens — слои разъехались');
  process.exit(1);
}
const layerStart = openMatch.index;
const braceStart = layerStart + openMatch[0].length - 1;
let depth = 0,
  layerEnd = braceStart;
for (; layerEnd < css.length; layerEnd++) {
  if (css[layerEnd] === '{') depth++;
  else if (css[layerEnd] === '}') {
    depth--;
    if (depth === 0) {
      layerEnd++;
      break;
    }
  }
}
let rest = css.slice(0, layerStart) + css.slice(layerEnd);
// Комментарии — не код: без этого упоминание старого значения в прозе
// (например, "раньше был цвет #c4b5fd, теперь используем токен") ловится
// как хардкод, хотя реального CSS-правила там нет.
rest = rest.replace(/\/\*[\s\S]*?\*\//g, '');
const fails = [];
// hex-цвета вне токенов
for (const m of rest.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) fails.push('hex ' + m[0]);
// rgb()/hsl() вне токенов — кроме прозрачных служебных заливок в тенях
for (const m of rest.matchAll(/\b(rgba?|hsla?)\(/g)) fails.push(m[1] + '()');
// радиусы числом вне токенов (0 и 50% разрешены)
for (const m of rest.matchAll(/border-radius:\s*(?!0\b|50%|var\()([^;]+);/g)) fails.push('radius ' + m[1].trim());
// Финальное ревью (NV-13): миграция на OKLCH сделала предыдущие проверки
// слепыми — сам формат, в который всё переехало, не ловился вообще.
// oklch(from var(--x) …) — легальная деривация из токена (тот же приём,
// что и oklch(from var(--sky-1) l c h / .55) в токенах), её не трогаем.
// Литеральный oklch(ЧИСЛО …) вне слоя tokens — ровно то, чем раньше был
// #7c3aed «на минуточку». Пять исключений — сознательные одноразовые
// значения, для которых токен был бы избыточной абстракцией:
// звёздное небо (.sky-far/.sky-near, четыре едва заметных точки на фоне,
// не завязаны ни на одну смысловую роль токена) и чёрная тень под фото в
// лайтбоксе (.lb-stage img, обычная фотографическая тень, не тонированная
// в тему — как color-scheme:dark в токенах, единственная в своём роде).
const oklchExceptions = new Set(['oklch(90% .02 280 / .5)', 'oklch(90% .02 280 / .35)', 'oklch(92% .03 280 / .4)', 'oklch(95% .02 280 / .6)', 'oklch(0% 0 0 / .5)']);
for (const m of rest.matchAll(/oklch\((?!from\b)[^)]*\)/g)) {
  if (!oklchExceptions.has(m[0])) fails.push('oklch ' + m[0]);
}
// Фаза 8 (NV-60): движение — только токенами --dur-*/--ease-* из слоя tokens.
// Литеральная длительность или cubic-bezier вне слоя — ровно то, чем был
// разнобой .2s/.22s/.25s/.28s/.3s до фазы 8.
// Ревью раунд 1: свойство — регистронезависимо (CSS не различает регистр
// имён свойств, `TRANSITION:` должен ловиться не хуже `transition:`).
// Отрицательные длительности (animation-delay:-0.2s — обычный способ начать
// анимацию «с середины») раньше не ловились: дефис перед числом был в
// исключённых лукбихайндом символах, из-за чего `-0.2s` пролетал мимо.
// Теперь дефис — часть самого числа, а не символ, блокирующий совпадение;
// лукбихайнд без дефиса всё ещё не даёт откусить хвост от большего числа
// вроде «23s» (после цифры \w не пускает).
for (const m of rest.matchAll(/(?:transition|animation)(?:-duration|-delay|-timing-function)?\s*:([^;}]+)/gi)) {
  for (const t of m[1].matchAll(/(?<![\w.])-?\d*\.?\d+m?s\b/g)) fails.push('длительность ' + t[0] + ' в «' + m[0].trim().slice(0, 60) + '»');
  if (/cubic-bezier\(|linear\(/i.test(m[1])) fails.push('кривая в «' + m[0].trim().slice(0, 60) + '»');
}
if (fails.length) {
  console.log('FAIL: хардкод вне токенов (' + fails.length + '):');
  for (const f of [...new Set(fails)].slice(0, 30)) console.log('  ' + f);
  process.exit(1);
}
console.log('OK: цвета, радиусы и движение только в токенах');
