'use strict';
/* load-game.js -- run the game in node exactly the way the browser does.

   index.html lists the game as classic <script src> tags that share one global scope.
   This reads that list (so the load order has one source of truth) and runs each file
   through `vm` under its real filename, which keeps stack traces pointing at src/*.js.

     const { loadGame } = require('./lib/load-game');
     const AoE2 = loadGame();                    // into THIS global scope: the game sees
                                                 // global.document / window / Image stubs,
                                                 // boots if they exist. Once per process.
     const AoE2 = loadGame({ isolated: true });  // into a fresh empty context: no DOM, no
                                                 // boot, repeatable -- for reading tables.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_HTML = path.join(ROOT, 'index.html');

/** Absolute paths of the game's scripts, in the order index.html loads them. */
function scriptFiles(htmlPath = DEFAULT_HTML) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const files = [...html.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)]
    .map((m) => path.resolve(path.dirname(htmlPath), m[1]));
  if (!files.length) throw new Error('no <script src> tags found in ' + htmlPath);
  return files;
}

/** The stylesheets index.html links, concatenated (the layout checks read the rules). */
function styleSource(htmlPath = DEFAULT_HTML) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  return [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>/g)]
    .map((m) => fs.readFileSync(path.resolve(path.dirname(htmlPath), m[1]), 'utf8')).join('\n');
}

/** All game scripts as one string (for checks that scan the source text). */
function scriptSource(htmlPath = DEFAULT_HTML) {
  return scriptFiles(htmlPath).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

let loadedHere = false;
function loadGame({ html = DEFAULT_HTML, isolated = false } = {}) {
  const files = scriptFiles(html);
  const read = (f) => fs.readFileSync(f, 'utf8');
  if (isolated) {
    const ctx = vm.createContext({ console });
    for (const f of files) vm.runInContext(read(f), ctx, { filename: f });
    return vm.runInContext('AoE2', ctx);
  }
  if (loadedHere) throw new Error('loadGame() already ran in this process; use { isolated: true } to load again');
  loadedHere = true;
  for (const f of files) vm.runInThisContext(read(f), { filename: f });
  return vm.runInThisContext('AoE2');
}

module.exports = { ROOT, loadGame, scriptFiles, scriptSource, styleSource };
