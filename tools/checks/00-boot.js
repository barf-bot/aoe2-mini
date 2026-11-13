'use strict';
/* checks/00-boot.js -- syntax of every game script, the export surface, and what boot leaves behind.
   Runs on its own (`node tools/checks/00-boot.js`) against a freshly booted game. */

const {
  AoE2, Game, SCRIPT_FILES, check, cp, ok, rafQueue, report, stubEl, withDpr,
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

/* P2-19: high-DPI backing store. The canvas must hold w*dpr device pixels while its CSS
   box (and the record's logical w/h every draw call uses) stay at w/h, so the renderer and
   the pointer projection keep sharing one coordinate space. `setTransform` rather than
   `scale`: beginCanvas runs again on every resize and scale() would compound. */
const hidpi = withDpr(2, () => AoE2.beginCanvas(stubEl('canvas', 'hidpi', 300, 200), 300, 200));
const hidpiOps = hidpi.ok ? hidpi.canvas.getContext('2d').ops.map((o) => o[0] + '(' + o[1].join(',') + ')') : [];
check(hidpi.ok && hidpi.dpr === 2 && hidpi.w === 300 && hidpi.h === 200 &&
      hidpi.canvas.width === 600 && hidpi.canvas.height === 400 &&
      hidpi.canvas.style.width === '300px' && hidpi.canvas.style.height === '200px' &&
      hidpiOps.includes('setTransform(2,0,0,2,0,0)') && !hidpiOps.includes('scale(2,2)'),
  'render: on a 2x screen the backing store doubles while the CSS box and logical size do not',
  JSON.stringify({ ok: hidpi.ok, dpr: hidpi.dpr, w: hidpi.w, h: hidpi.h, cw: hidpi.canvas.width,
    ch: hidpi.canvas.height, css: hidpi.canvas.style.width, tf: hidpiOps[0] }));
const plain = withDpr(undefined, () => AoE2.beginCanvas(stubEl('canvas', 'std', 400, 300), 400, 300));
check(plain.ok && plain.dpr === 1 && plain.w === 400 && plain.h === 300 &&
      plain.canvas.width === 400 && plain.canvas.height === 300 &&
      plain.canvas.style.width === '400px',
  'render: with no devicePixelRatio (node, tools/render-preview.js) the canvas stays 1:1',
  'dpr=' + plain.dpr + ' w=' + plain.w + ' cw=' + plain.canvas.width);

report();
