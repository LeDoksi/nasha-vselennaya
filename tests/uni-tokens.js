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
if (fails.length) {
  console.log('FAIL: хардкод вне токенов (' + fails.length + '):');
  for (const f of [...new Set(fails)].slice(0, 30)) console.log('  ' + f);
  process.exit(1);
}
console.log('OK: цвета и радиусы только в токенах');
