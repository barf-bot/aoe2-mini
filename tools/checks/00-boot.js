'use strict';
/* checks/00-boot.js -- syntax of every game script, the export surface, and what boot leaves behind.
   Runs on its own (`node tools/checks/00-boot.js`) against a freshly booted game. */

const {
  AoE2, Game, SCRIPT_FILES, check, cp, ok, rafQueue, report,
} = require('../lib/harness');

/* ---- 1. syntax ------------------------------------------------------- */
const syntax = cp.spawnSync(process.execPath, SCRIPT_FILES.reduce((a, f) => a.concat('--check', f), []), { encoding: 'utf8' });
check(syntax.status === 0, 'syntax: node --check on every game script',
  syntax.status === 0 ? SCRIPT_FILES.length + ' files clean' : (syntax.stderr || '').trim().split('\n').slice(0, 5).join(' | '));
if (syntax.status !== 0) report();

/* ---- 3. load + boot -------------------------------------------------- */
check(!!AoE2 && !!AoE2.CFG, 'module: exports the game surface', Object.keys(AoE2 || {}).length + ' exports');
if (!AoE2 || !AoE2.CFG) report();
check(!!global.window.Game, 'boot: window.Game built from the stub DOM', global.window.Game ? 'booted' : 'no Game');
if (!Game || !Game.world) report();

check(Game.view && Game.view.ok, 'render: canvas context acquired', Game.view && Game.view.ok ? 'ok' : 'failed');
check(Game.dom.set_food !== undefined, 'hud: <b> nodes wired so labels survive a render', 'set_food present');
check(rafQueue.length === 1, 'loop: exactly one requestAnimationFrame queued', String(rafQueue.length));
check(Game.frame === 0, 'loop: boot rendered without recursing into the frame loop', 'frame=' + Game.frame);

report();
