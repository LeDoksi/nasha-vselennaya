#!/usr/bin/env node
/* Сборка app.js из src/*.js.
   Модули — классические скрипты с общей областью видимости: при конкатенации
   top-level let/const и function-объявления ведут себя так же, как в монолите,
   поэтому index.html (просто <script src="app.js">) и тесты работают как раньше.
   Порядок файлов — по имени (00-core, 10-vault, ...). Запуск: node build.js */
'use strict';
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const srcDir = path.join(__dirname, 'src');
if (!fs.existsSync(srcDir)) {
  console.error('Нет папки src/ — сначала выполни: node tools/split.js');
  process.exit(1);
}
const files = fs
  .readdirSync(srcDir)
  .filter(f => f.endsWith('.js'))
  .sort();
if (!files.length) {
  console.error('src/ пуст');
  process.exit(1);
}

const out = files.map(f => fs.readFileSync(path.join(srcDir, f), 'utf8').replace(/\n$/, '')).join('\n') + '\n';
fs.writeFileSync(path.join(__dirname, 'app.js'), out);
console.log('OK: app.js собран из ' + files.length + ' модулей → ' + files.join(', '));

/* app.min.js — production-бандл (Фаза 5): не коммитится (.gitignore), только
   собирается локально и в CI/деплое. НЕ передаём esbuild bundle:true — весь
   код и так уже один плоский скрипт с общей глобальной областью видимости
   (см. комментарий выше), а bundle-режим esbuild оборачивает/переименовывает
   top-level имена, что сломало бы кросс-файловые ссылки по имени функции
   (renderHome(), notifyPartner() и т.п. вызываются из десятков других
   модулей напрямую). Голый minify (без bundle) в script-режиме проверен
   вручную: top-level function/const остаются нетронутыми по имени, минифицируются
   только локальные переменные внутри функций и синтаксис — безопасно для
   этой архитектуры.*/
const minified = esbuild.transformSync(out, { minify: true, target: 'es2020' });
fs.writeFileSync(path.join(__dirname, 'app.min.js'), minified.code);
const origKb = Math.round(Buffer.byteLength(out) / 1024);
const minKb = Math.round(Buffer.byteLength(minified.code) / 1024);
console.log('OK: app.min.js собран (' + origKb + ' КБ → ' + minKb + ' КБ)');
