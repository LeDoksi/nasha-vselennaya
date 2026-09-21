// tools/fetch-fonts.js — качает woff2-сабсеты в fonts/.
// Запуск: node tools/fetch-fonts.js
// Почему скриптом, а не руками: через год никто не вспомнит, какие именно
// сабсеты и какой версии лежат в репозитории. CSP запрещает грузить шрифты
// с чужого хоста, поэтому файлы живут у нас.
'use strict';
const fs = require('fs');
const path = require('path');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const WANT = { cyrillic: 'U+0301, U+0400-045F', latin: 'U+0000-00FF' };
const FAMILIES = [
  { css: 'Onest:wght@100..900', out: 'onest' },
  { css: 'Sofia+Sans+Extra+Condensed:wght@1..1000', out: 'sofia-sans-xc' }
];
(async () => {
  for (const fam of FAMILIES) {
    const css = await (await fetch('https://fonts.googleapis.com/css2?family=' + fam.css + '&display=swap', { headers: { 'User-Agent': UA } })).text();
    for (const [name, marker] of Object.entries(WANT)) {
      const block = css.split('@font-face').find(b => b.includes('unicode-range: ' + marker));
      if (!block) throw new Error('не нашёл сабсет ' + name + ' для ' + fam.out);
      const url = block.match(/url\((https:[^)]+\.woff2)\)/)[1];
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      const file = path.join(__dirname, '..', 'fonts', fam.out + '-' + name + '.woff2');
      fs.writeFileSync(file, buf);
      console.log('OK: ' + path.basename(file) + ' — ' + Math.round(buf.length / 1024) + ' КБ');
      console.log('   unicode-range:' + block.match(/unicode-range:([^;]+);/)[1]);
    }
  }
})();
