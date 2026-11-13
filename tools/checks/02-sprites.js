'use strict';
/* checks/02-sprites.js -- sprite frame tables, animation selection, building sprites, atlas wiring.
   Runs on its own (`node tools/checks/02-sprites.js`) against a freshly booted game. */

const {
  AoE2, Game, bad, check, dataSprites, napiImage, ok, report,
} = require('../lib/harness');

/* ---- 5b. sprite frame table ----------------------------------------- */
// The atlas layout is data, not code: one sheet, one cell per registered
// animation x team, each reachable through spriteFor. Adding a unit kind or
// animation without its cells must fail here (the archer is on the roadmap
// exactly so this check fires when it lands).
const sheet = AoE2.SPRITE_SHEET || {};
let spriteErr = '';
const rects = new Set();
let cellCount = 0;
outer:
for (const kind of Object.keys(AoE2.KINDS)) {
  const table = AoE2.SPRITES[kind];
  if (!table || Array.isArray(table) || typeof table !== 'object') {
    spriteErr = kind + ': SPRITES entry missing or not an {anim: [Blue, Red]} table';
    break outer;
  }
  for (const anim of Object.keys(table)) {
    const cells = table[anim];
    if (!Array.isArray(cells) || cells.length !== AoE2.TEAM.length) {
      spriteErr = kind + '.' + anim + ': expected one cell per team'; break outer;
    }
    for (let team = 0; team < cells.length; team++) {
      const f = cells[team];
      const ok = !!f && typeof f.sx === 'number' && typeof f.sy === 'number' &&
        typeof f.sw === 'number' && typeof f.sh === 'number' &&
        f.sw > 0 && f.sh > 0 && f.dw > 0 && f.dh > 0 &&
        f.sx >= 0 && f.sy >= 0 && f.sx + f.sw <= sheet.w && f.sy + f.sh <= sheet.h;
      if (!ok) { spriteErr = kind + '.' + anim + '/' + AoE2.TEAM[team].name; break outer; }
      if (AoE2.spriteFor(kind, team, anim) !== f) {
        spriteErr = `spriteFor('${kind}', ${team}, '${anim}') returns a different cell`; break outer;
      }
      rects.add(f.sx + ',' + f.sy + ' ' + f.sw + 'x' + f.sh);
      cellCount++;
    }
  }
}
for (const kind of Object.keys(AoE2.SPRITES)) {              // catch stray table entries
  if (!AoE2.KINDS[kind]) { spriteErr = 'SPRITES entry for unknown kind ' + kind; break; }
}
const vIdle = (AoE2.SPRITES.villager || {}).idle;
if (!spriteErr && vIdle && AoE2.spriteFor('villager', 0) !== vIdle[0]) {
  spriteErr = 'spriteFor(kind, team) no longer defaults to the idle frame';
}
if (!spriteErr && rects.size !== cellCount) spriteErr = 'overlapping/duplicate cells';
check(!spriteErr, 'sprites: every registered anim x team has a unique in-sheet cell',
  spriteErr ? 'bad: ' + spriteErr
    : cellCount + ' cells inside the ' + sheet.w + 'x' + sheet.h + ' sheet');

/* ---- 5b1b. drawn size and anchor (docs/TODO.md P1-7) ------------------ */
/* Every frame used to be drawn into one fixed box per kind (20x20, militia
   22x22) whatever the source frame was: the villager 146x86 farm frame became
   a blob and its 28x46 idle frame was stretched wide. Two rules now, both
   authored in data/sprites.json -- a cell keeps its frame aspect ratio (dw/dh
   == sw/sh within 2 %) and every cell of a kind uses the one scale that file
   declares for the kind (the height its idle frame draws at, in tiles) -- plus
   ax/ay per frame, the pixel inside the drawn box that is the unit's feet, so
   swapping animations never lifts the figure off the ground. drawUnits
   (src/render.js:150) draws from that anchor; 13-render checks the call. */
let aspectWorst = 0, aspectWorstAt = '';
for (const kind of Object.keys(AoE2.SPRITES)) {
  for (const anim of Object.keys(AoE2.SPRITES[kind] || {})) {
    (AoE2.SPRITES[kind][anim] || []).forEach((f) => {
      if (!f || !f.sw || !f.sh || !f.dw || !f.dh) return;      // 5b reports malformed cells
      const err = Math.abs(f.dw / f.dh - f.sw / f.sh) / (f.sw / f.sh);
      if (err > aspectWorst) {
        aspectWorst = err;
        aspectWorstAt = `${kind}.${anim} draws ${f.dw}x${f.dh} from a ${f.sw}x${f.sh} cell`;
      }
    });
  }
}
check(aspectWorst <= 0.02, 'sprites: every unit cell keeps its source frame aspect ratio (within 2 %)',
  aspectWorstAt ? (aspectWorst * 100).toFixed(1) + '% off: ' + aspectWorstAt
    : 'worst deviation ' + (aspectWorst * 100).toFixed(1) + '%');

let scaleErr = [];
for (const kind of Object.keys(AoE2.SPRITES)) {
  const spec = (dataSprites.units || {})[kind] || {};
  const tiles = (spec.draw || {}).idleTiles;
  const idle = (AoE2.SPRITES[kind] || {}).idle;
  if (typeof tiles !== 'number' || tiles <= 0) {
    scaleErr.push(`${kind}: data/sprites.json declares no draw.idleTiles to scale from`); continue;
  }
  if (!idle || !idle[0] || !idle[0].sh) { scaleErr.push(`${kind}: no idle cell to measure from`); continue; }
  const scale = tiles * AoE2.CFG.TILE / idle[0].sh;             // the kind's one scale, off its idle frame
  for (const anim of Object.keys(AoE2.SPRITES[kind])) {
    (AoE2.SPRITES[kind][anim] || []).forEach((f, team) => {
      if (!f || !f.sw || !f.sh || scaleErr.length > 2) return;
      const dw = Math.round(f.sw * scale), dh = Math.round(f.sh * scale);
      if (f.dw !== dw || f.dh !== dh) {
        scaleErr.push(`${kind}.${anim}/${AoE2.TEAM[team].name}: draws ${f.dw}x${f.dh}, the authored `
          + `${tiles}-tile scale (${scale.toFixed(4)}x) gives ${dw}x${dh}`);
      } else if (!Number.isInteger(f.ax) || !Number.isInteger(f.ay) || f.ax < 0 || f.ax > f.dw
          || f.ay <= 0 || f.ay > f.dh) {
        scaleErr.push(`${kind}.${anim}/${AoE2.TEAM[team].name}: anchor ${f.ax},${f.ay} is not a pixel `
          + `inside the ${f.dw}x${f.dh} drawn box`);
      } else if (f.ay * 2 < f.dh) {
        scaleErr.push(`${kind}.${anim}/${AoE2.TEAM[team].name}: anchor ${f.ay}/${f.dh} is above the `
          + 'middle of the box, so it is not the feet');
      }
    });
  }
}
check(scaleErr.length === 0,
  'sprites: one authored scale per kind plus a feet anchor on every unit cell',
  scaleErr.length ? scaleErr.join(' | ')
    : Object.keys(AoE2.SPRITES).length + ' kinds scaled from data/sprites.json, every cell anchored');

/* ---- 5b2. animation selection ---------------------------------------- */
// Which cell a unit actually plays (task 2): the pure unitAnim(u). Villagers
// must show the tool animation matching what they harvest, militia their
// swing, and the a/b frames must actually alternate.
const animGame = AoE2.createState();
const av = animGame.units.find(u => u.team === 0 && u.kind === 'villager');
const am = animGame.units.find(u => u.team === 0 && u.kind === 'militia');
const workErr = ['food', 'wood', 'gold', 'stone'].map((res) => {
  av.order = { kind: 'harvest', src: { kind: 'tile', res } };
  av.anim = 0;    const a = AoE2.unitAnim(av);
  av.anim = 0.3;  const b = AoE2.unitAnim(av);
  const exp = AoE2.WORK_ANIM[res];
  return a === exp + '_a' && b === exp + '_b' ? '' : `${res}:${a}/${b}`;
}).filter(Boolean).join(' ');
check(!workErr, 'anim: harvest orders play the resource tool animation, a/b alternating at 4 Hz',
  workErr || 'food->farm wood->chop gold/stone->mine');
av.anim = 0;
av.order = { kind: 'idle' };
check(AoE2.unitAnim(av) === 'idle', 'anim: idle villager holds its idle cell', AoE2.unitAnim(av));
av.order = { kind: 'go_deposit', b: 'x', src: { kind: 'tile', res: 'food' } };
check(AoE2.unitAnim(av) === 'walk', 'anim: a carrying villager shows the walk cell', AoE2.unitAnim(av));
av.order = { kind: 'build', b: 'x' };
check(AoE2.unitAnim(av).indexOf('farm') === 0, 'anim: a villager building hammers (farm pose)',
  AoE2.unitAnim(av));
const enemy = animGame.units.find(u => u.team === 1);
am.order = { kind: 'attack', target: enemy.id };
am.anim = 0;    const s0 = AoE2.unitAnim(am);
am.anim = 0.3;
check(s0 === 'attack_a' && AoE2.unitAnim(am) === 'attack_b',
  'anim: attacking militia swing attack_a/attack_b', s0 + '/' + AoE2.unitAnim(am));
am.anim = 0; am.order = { kind: 'move', x: 0, y: 0 };
check(AoE2.unitAnim(am) === 'walk', 'anim: ordered militia walk', AoE2.unitAnim(am));

/* ---- 5b3. building sprite table -------------------------------------- */
// Task 5: every building kind x team has a cell, drawn at its exact footprint
// (b.w*TILE x b.h*TILE), reachable through bldSpriteFor, and no building cell
// collides with a unit cell or another building cell (shared rect set from 5b).
// Rule amended by the blacksmith plan (T1): every BLD kind has a cell per team,
// EXCEPT a kind marked `noSprite` -- those must answer bldSpriteFor(...) ===
// null, which is what routes the renderer to its procedural look (drawBuildings in src/render.js).
let bldSpriteErr = '';
const bldRects = new Set(rects);
const cellKinds = Object.keys(AoE2.BLD).filter((k) => !AoE2.BLD[k].noSprite);
for (const kind of cellKinds) {
  const cells = AoE2.BLD_SPRITES[kind];
  if (!Array.isArray(cells) || cells.length !== AoE2.TEAM.length) {
    bldSpriteErr = `BLD_SPRITES.${kind}: expected one cell per team`; break;
  }
  cells.forEach((f, team) => {
    if (bldSpriteErr) return;
    const ok = !!f && typeof f.sx === 'number' && typeof f.sy === 'number' &&
      typeof f.sw === 'number' && typeof f.sh === 'number' &&
      f.sw > 0 && f.sh > 0 && f.dw > 0 && f.dh > 0 &&
      f.sx >= 0 && f.sy >= 0 && f.sx + f.sw <= sheet.w && f.sy + f.sh <= sheet.h;
    if (!ok) { bldSpriteErr = `BLD_SPRITES.${kind}/${AoE2.TEAM[team].name}: bad rect`; return; }
    if (AoE2.bldSpriteFor(kind, team) !== f) {
      bldSpriteErr = `bldSpriteFor('${kind}', ${team}) returns a different cell`; return;
    }
    if (f.dw !== AoE2.BLD[kind].w * AoE2.CFG.TILE || f.dh !== AoE2.BLD[kind].h * AoE2.CFG.TILE) {
      bldSpriteErr = `${kind}: cell draws ${f.dw}x${f.dh}, footprint is `
        + AoE2.BLD[kind].w * AoE2.CFG.TILE + 'x' + AoE2.BLD[kind].h * AoE2.CFG.TILE + 'px'; return;
    }
    const key = f.sx + ',' + f.sy + ' ' + f.sw + 'x' + f.sh;
    if (bldRects.has(key)) bldSpriteErr = `duplicate cell ${key}`;
    bldRects.add(key);
  });
}

for (const kind of Object.keys(AoE2.BLD)) {          // noSprite kinds answer null
  if (!AoE2.BLD[kind].noSprite) continue;
  for (let team = 0; team < AoE2.TEAM.length && !bldSpriteErr; team++) {
    if (AoE2.bldSpriteFor(kind, team) !== null)
      bldSpriteErr = `bldSpriteFor('${kind}', ${AoE2.TEAM[team].name}): a noSprite kind must answer null`;
  }
}
for (const kind of Object.keys(AoE2.BLD_SPRITES)) {          // catch stray entries
  if (!AoE2.BLD[kind]) { bldSpriteErr = 'BLD_SPRITES entry for unknown kind ' + kind; break; }
}
check(!bldSpriteErr, 'sprites: every BLD kind has a cell per team (noSprite answers null)',
  bldSpriteErr ? 'bad: ' + bldSpriteErr
    : cellKinds.length * AoE2.TEAM.length + ' building cells + ' + cellCount +
      ' unit cells in the ' + sheet.w + 'x' + sheet.h + ' sheet' +
      (cellKinds.length === Object.keys(AoE2.BLD).length ? ''
        : ' (+' + (Object.keys(AoE2.BLD).length - cellKinds.length) + ' noSprite kinds)'));

/* ---- 5c. atlas wiring ----------------------------------------------- */
// setAtlas is the single injection point for the sheet, so the renderer has one
// field to consult and both harnesses can hand it an image (task 3). Probed on a
// throwaway state so the booted Game below keeps whatever boot() loaded.
const atlasState = AoE2.createState();
const probeAtlas = { tag: 'probe-atlas' };
const describeAtlas = (s) => (s && s.sprites
  ? 'atlas=' + String(s.sprites.atlas).slice(0, 30) : 'Game.sprites missing');
const stored = typeof AoE2.setAtlas === 'function' ? AoE2.setAtlas(atlasState, probeAtlas) : undefined;
check(stored === probeAtlas && atlasState.sprites.atlas === probeAtlas,
  'sprites: setAtlas stores the atlas source', describeAtlas(atlasState));
const cleared = typeof AoE2.setAtlas === 'function' ? AoE2.setAtlas(atlasState, null) : undefined;
check(cleared === null && atlasState.sprites.atlas === null,
  'sprites: setAtlas clears the atlas source', describeAtlas(atlasState));
// and boot() must have used it for the committed sheet whenever a backend exists
const bootedAtlas = Game.sprites && Game.sprites.atlas;
check(!!bootedAtlas === !!napiImage && (!bootedAtlas ||
    (bootedAtlas.width === sheet.w && bootedAtlas.height === sheet.h)),
  'sprites: boot loadAtlas wired assets/sprites.png',
  bootedAtlas
    ? 'loaded ' + bootedAtlas.src + ' ' + bootedAtlas.width + 'x' + bootedAtlas.height +
      ', matches SPRITE_SHEET'
    : (napiImage ? 'nothing loaded' : 'no canvas backend in this sandbox'));

report();
