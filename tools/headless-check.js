#!/usr/bin/env node
/* =========================================================================
   headless-check.js -- verify the game without a browser.

   Runs every file in tools/checks/ in name order as ONE sequential script:
   00-harness.js stubs the DOM and boots the game through tools/lib/load-game.js,
   the files after it drive the simulation and assert real behaviour -- seeded
   world generation, the economy, pathfinding, construction, training, combat,
   input, the HUD, save/load and sound. The checks are sequential on purpose:
   they share one booted Game, so they are split by topic, not isolated.

   The fragments are joined and compiled as one function, which keeps the
   harness's names out of the global scope the game's scripts live in (a check
   helper can never silently replace a game function). Stack traces are mapped
   back to tools/checks/NN-topic.js:line before they are printed.

   usage: node tools/headless-check.js [path/to/index.html]
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CHECKS = path.join(__dirname, 'checks');
const BUNDLE = path.join(CHECKS, '(all checks)');

const starts = [];           // [first bundle line, file] per fragment
let body = '', line = 1;
for (const name of fs.readdirSync(CHECKS).filter((f) => f.endsWith('.js')).sort()) {
  const src = fs.readFileSync(path.join(CHECKS, name), 'utf8').replace(/\n*$/, '\n');
  starts.push([line, path.join(CHECKS, name)]);
  body += src;
  line += src.split('\n').length - 1;
}
body += 'report();\n';       // prints every result and exits 0 / 1

/** `(all checks):1234:5` -> `04-pathfinding.js:321:5` */
function remap(stack) {
  return String(stack).split(BUNDLE + ':').map((chunk, i) => {
    if (!i) return chunk;
    const n = parseInt(chunk, 10);
    const at = starts.filter((s) => s[0] <= n).pop();
    return at ? at[1] + ':' + (n - at[0] + 1) + chunk.slice(String(n).length) : BUNDLE + ':' + chunk;
  }).join('');
}

try {
  vm.compileFunction(body, ['require', 'TOOLS_DIR'], { filename: BUNDLE })(require, __dirname);
} catch (e) {
  console.error('FAIL  the check script threw:\n' + remap(e && e.stack || e));
  process.exit(1);
}
