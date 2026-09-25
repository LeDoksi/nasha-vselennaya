// tools/shots-diff.js — побайтовое сравнение двух прогонов tools/shots.js.
// Запуск: node tools/shots-diff.js <папка-до> <папка-после>
// Папки — внутри docs/superpowers/baseline/. Выход 1, если хоть один снимок
// отличается или есть только в одной из папок.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const base = path.join(__dirname, '..', 'docs', 'superpowers', 'baseline');
const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.log('Запуск: node tools/shots-diff.js <папка-до> <папка-после>');
  process.exit(2);
}
const pngs = d => fs.readdirSync(path.join(base, d)).filter(n => n.endsWith('.png'));
const hash = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const names = [...new Set([...pngs(a), ...pngs(b)])].sort();
const bad = names.filter(n => {
  const fa = path.join(base, a, n);
  const fb = path.join(base, b, n);
  return !fs.existsSync(fa) || !fs.existsSync(fb) || hash(fa) !== hash(fb);
});
bad.forEach(n => console.log('DIFF: ' + n));
console.log(bad.length ? 'FAIL: ' + bad.length + ' из ' + names.length : 'OK: ' + names.length + ' снимков совпали побайтно');
process.exit(bad.length ? 1 : 0);
