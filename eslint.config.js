// Флат-конфиг ESLint (v9). Основная цель — линтить СОБРАННЫЙ app.js, а не
// src/*.js по отдельности: проект собирается конкатенацией модулей в общую
// глобальную область видимости (см. build.js) — функция/переменная,
// объявленная в одном src-файле, легитимно используется в другом. Линтить
// src/*.js по отдельности означало бы либо гасить no-undef целиком (теряя
// главную ценность правила — ловить опечатки в именах), либо вручную вести
// список из сотен «глобалей». В одном собранном app.js все внутренние ссылки
// физически лежат в одном файле — no-undef ловит реальные опечатки, а не
// шум от межмодульных ссылок.
'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    // Собранный бандл — браузерное окружение + глобали, которых нет в
    // стандартном наборе browser (подключены отдельными <script> в index.html).
    files: ['app.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        firebase: 'readonly',
        Sortable: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    // Node-окружение: тесты, сборка, Cloud Function.
    files: ['tests/**/*.js', 'build.js', 'functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    ignores: ['src/**', 'node_modules/**', 'vendor/**']
  }
];
