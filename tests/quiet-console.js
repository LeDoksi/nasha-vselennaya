// Облака в этих тестах нет по построению — ожидаемые «[photo-sync] …» из
// src/95-photos-*.js только засыпали вывод npm run check, и в нём терялись
// настоящие предупреждения (NV-97). Глушим ровно этот префикс.
'use strict';
const quietConsole = Object.assign(Object.create(console), {
  warn: (...a) => {
    if (!String(a[0]).startsWith('[photo-sync]')) console.warn(...a);
  }
});
module.exports = { quietConsole };
