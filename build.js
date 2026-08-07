#!/usr/bin/env node
/* Сборка app.js из src/*.js.
   Модули — классические скрипты с общей областью видимости: при конкатенации
   top-level let/const и function-объявления ведут себя так же, как в монолите,
   поэтому index.html (просто <script src="app.js">) и тесты работают как раньше.
   Порядок файлов — по имени (00-core, 10-vault, ...). Запуск: node build.js */
'use strict';
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
if (!fs.existsSync(srcDir)) { console.error('Нет папки src/ — сначала выполни: node tools/split.js'); process.exit(1); }
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js')).sort();
if (!files.length) { console.error('src/ пуст'); process.exit(1); }

const out = files
  .map(f => fs.readFileSync(path.join(srcDir, f), 'utf8').replace(/\n$/, ''))
  .join('\n') + '\n';
fs.writeFileSync(path.join(__dirname, 'app.js'), out);
console.log('OK: app.js собран из ' + files.length + ' модулей → ' + files.join(', '));
