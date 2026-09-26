#!/usr/bin/env node
/* Штамп версии на деплое (NV-80): index.html ссылается на app.min.js?v=H и
   styles.css?v=H, sw.js кэширует ровно эти адреса под CACHE_NAME с тем же H.
   H — хэш содержимого оболочки. Зачем: свежий index.html просит новый URL,
   которого нет в кэше SW, — воркер ждёт сеть, а не подсовывает старый скрипт
   к новой разметке. Каждый деплой меняет sw.js → новый воркер → старый кэш
   удаляется на activate, ручной бамп CACHE_NAME больше не нужен.
   Запуск: node tools/stamp-version.js _site  (правит файлы в папке на месте) */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILES = ['index.html', 'app.min.js', 'styles.css', 'sw.js'];

// Замена обязана сработать: переименовали файл или CACHE_NAME — деплой падает,
// а не выкатывается молча без версии.
function sub(text, from, to, file) {
  if (!text.includes(from)) throw new Error(`stamp-version: в ${file} нет «${from}»`);
  return text.split(from).join(to);
}

function stamp(files) {
  const h = crypto.createHash('sha256');
  for (const f of FILES) h.update(files[f]);
  const v = h.digest('hex').slice(0, 10);
  let html = files['index.html'];
  html = sub(html, 'href="styles.css"', `href="styles.css?v=${v}"`, 'index.html');
  html = sub(html, 'src="app.min.js"', `src="app.min.js?v=${v}"`, 'index.html');
  let sw = files['sw.js'];
  sw = sub(sw, "'./app.min.js'", `'./app.min.js?v=${v}'`, 'sw.js');
  sw = sub(sw, "'./styles.css'", `'./styles.css?v=${v}'`, 'sw.js');
  sw = sub(sw, "-shell-v3'", `-shell-v3-${v}'`, 'sw.js');
  return { v, html, sw };
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: node tools/stamp-version.js <dir>');
  const files = {};
  for (const f of FILES) files[f] = fs.readFileSync(path.join(dir, f), 'utf8');
  const { v, html, sw } = stamp(files);
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  fs.writeFileSync(path.join(dir, 'sw.js'), sw);
  console.log('stamp-version: v=' + v);
}

module.exports = { stamp };
