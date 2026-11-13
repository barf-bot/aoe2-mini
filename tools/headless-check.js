#!/usr/bin/env node
/* =========================================================================
   headless-check.js -- verify the game without a browser.

   Runs every file in tools/checks/, each in its own node process, and adds up
   their results. A check file requires tools/lib/harness.js, which stubs the
   DOM and boots the game, then asserts real behaviour for its topic -- seeded
   world generation, the economy, pathfinding, construction, training, combat,
   input, the HUD, save/load, sound. Every file gets a freshly booted Game, so
   the files are independent: order does not matter and one can run alone.

   usage: node tools/headless-check.js [filter] [-q]
     node tools/headless-check.js             every file
     node tools/headless-check.js combat      only files whose name contains "combat"
     node tools/headless-check.js -q          failures and totals only
     node tools/checks/07-combat.js           one file directly, full stack traces
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const CHECKS = path.join(__dirname, 'checks');
const args = process.argv.slice(2);
const quiet = args.includes('-q');
const filter = args.find((a) => !a.startsWith('-')) || '';
const files = fs.readdirSync(CHECKS).filter((f) => f.endsWith('.js') && f.includes(filter)).sort();
if (!files.length) { console.error('FAIL  no check file matches "' + filter + '"'); process.exit(1); }

const run = (name) => new Promise((resolve) => {
  cp.execFile(process.execPath, [path.join(CHECKS, name)], { maxBuffer: 64 << 20 }, (err, stdout, stderr) => {
    const m = /(\d+)\/(\d+) checks passed\s*$/.exec(stdout);
    // no totals line means the file crashed before report(): that is one failure, never a silent zero
    resolve({ name, stdout, stderr, passed: m ? +m[1] : 0, total: m ? +m[2] : 1, crashed: !m });
  });
});

Promise.all(files.map(run)).then((results) => {
  let passed = 0, total = 0;
  for (const r of results) {
    passed += r.passed; total += r.total;
    const lines = r.stdout.split('\n').filter((l) => /^(PASS|FAIL)  /.test(l));
    for (const l of lines) if (!quiet || l.startsWith('FAIL')) console.log(l);
    if (r.crashed) console.log('FAIL  ' + r.name + ' crashed before reporting:\n' + (r.stderr || r.stdout).trim());
    console.log((r.passed === r.total ? 'ok    ' : 'FAIL  ') + r.name + '  ' + r.passed + '/' + r.total + (quiet ? '' : '\n'));
  }
  console.log('\n' + passed + '/' + total + ' checks passed');
  process.exit(passed === total ? 0 : 1);
});
