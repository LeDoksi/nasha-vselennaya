#!/usr/bin/env node
/* Разовое разбиение app.js на модули src/*.js по заголовкам секций.
   Запуск: node tools/split.js  (требует, чтобы app.js был на месте) */
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const lines = src.split('\n');

// Границы модулей: каждый модуль начинается со своего заголовка секции.
const bounds = [
  { name: 'Хранилище',        file: '10-vault.js' },
  { name: 'Тема',             file: '20-theme-nav.js' },
  { name: 'Главная',          file: '30-home.js' },
  { name: 'Календарь',        file: '40-calendar.js' },
  { name: 'Заметки',          file: '50-notes.js' },
  { name: 'Списки',           file: '60-lists-wishes.js' },
  { name: 'Фото',             file: '70-photos.js' },
  { name: 'Песня',            file: '80-settings.js' },
  { name: 'Летающие сердечки', file: '90-effects-init.js' },
];

const headerIdx = [];
lines.forEach((l, i) => { if (/^\/\* =====/.test(l)) headerIdx.push(i); });

const marks = [];
let cursor = 0;
for (const b of bounds) {
  // ищем первый подходящий заголовок ПОСЛЕ предыдущей границы (а не первый в файле)
  const idx = headerIdx.find(i => i >= cursor && lines[i].includes(b.name));
  if (idx === undefined) { console.error('Не найден заголовок секции после строки ' + cursor + ': ' + b.name); process.exit(1); }
  marks.push({ idx, file: b.file });
  cursor = idx + 1;
}
marks.unshift({ idx: 0, file: '00-core.js' }); // от первой строки до «Хранилища»

const outDir = path.join(__dirname, '..', 'src');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
for (let i = 0; i < marks.length; i++) {
  const start = marks[i].idx;
  const end = i + 1 < marks.length ? marks[i + 1].idx : lines.length;
  const chunk = lines.slice(start, end).join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, marks[i].file), chunk);
  console.log(marks[i].file + ' ← строки ' + (start + 1) + '..' + end);
}
console.log('Готово. Теперь: node build.js');
