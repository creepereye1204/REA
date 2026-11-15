'use strict';
// node tests/run.js [filter]  — runs every *.test.js in this folder and reports
const fs = require('fs'), path = require('path');
const filter = process.argv[2] || '';
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js') && f.includes(filter)).sort();
let pass = 0, fail = 0;
const t0 = Date.now();
(async () => {
  for (const f of files) {
    const tests = require(path.join(__dirname, f));
    for (const [name, fn] of Object.entries(tests)) {
      const s = Date.now();
      try { await fn(); pass++; console.log(`  ✔ ${f.replace('.test.js', '')} › ${name} (${Date.now() - s}ms)`); }
      catch (e) { fail++; console.log(`  ✘ ${f.replace('.test.js', '')} › ${name}\n      ${String(e.message || e).split('\n').join('\n      ')}`); }
    }
  }
  console.log(`\n${pass} passed, ${fail} failed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(fail ? 1 : 0);
})();
