#!/usr/bin/env node
/* =========================================================================
   gen-atlas.js -- render assets/sprites.png from the sprite table in the game.

   WHERE THINGS LIVE, so art and code cannot drift:
     - the atlas layout (SPRITE_SHEET, SPRITES, spriteFor, BLD_SPRITES,
       bldSpriteFor) is in index.html: that is the single source of truth for
       which cell holds which frame -- unit rows y0-47, built-building rows
       below -- and tools/headless-check.js asserts it covers every unit kind
       x team and every BLD kind x team, so new content forces new art.
     - the pixels (ART / BLD_ART below) live here and nowhere else: one 12x12
       grid per unit kind x animation (villager idle/walk/farm/chop/mine frames,
       militia idle/walk/attack frames) blown up into the 24x24 cell, and one
       11x11 grid per building kind (cells 66/44/22 px, all multiples of 11)
       blown up 6x/4x/2x -- one colour per art pixel.
     - team colours come from TEAM in index.html, so a recolour is one edit.

   usage: node tools/gen-atlas.js [--out assets/sprites.png]
   exits non-zero if the written PNG does not decode at the table's size or any
   cell is empty; the sha256 it prints is stable for identical input.
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');

/* --------------------------- canvas backend ---------------------------- */
function loadCanvas() {
  const tries = [
    path.join(ROOT, 'tools', 'node_modules', '@napi-rs', 'canvas'),
    path.join(ROOT, 'node_modules', '@napi-rs', 'canvas'),
    '/opt/data/cache/scratch/canvaspkg/node_modules/@napi-rs/canvas',
    '@napi-rs/canvas',
  ];
  for (const t of tries) { try { return require(t); } catch (e) { /* next */ } }
  return null;
}
const napi = loadCanvas();
if (!napi) {
  console.error('FAIL  no @napi-rs/canvas backend (npm i @napi-rs/canvas in tools/, '
    + 'or pass --out to a machine that has it)');
  process.exit(1);
}

/* ------------------- the frame table, read from index.html ------------- */
function gameSurface() {
  const html = fs.readFileSync(HTML, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) { console.error('FAIL  no <script> block found in ' + HTML); process.exit(1); }
  const tmp = path.join(__dirname, '.extracted-atlas.js');
  fs.writeFileSync(tmp, m[1]);
  try { return require(tmp); } finally { fs.unlinkSync(tmp); }
}
const G = gameSurface();
if (!G || !G.SPRITE_SHEET || !G.SPRITES || typeof G.spriteFor !== 'function' ||
    !G.BLD_SPRITES || typeof G.bldSpriteFor !== 'function') {
  console.error('FAIL  index.html does not export SPRITE_SHEET / SPRITES / spriteFor'
    + ' / BLD_SPRITES / bldSpriteFor');
  process.exit(1);
}

/* ------------------------------ the art ------------------------------- */
/* Art is authored on a GRID x GRID grid (12) and blown up into the cell: one
 * art pixel = 2 px in a 24x24 cell. Shapes are rects drawn back to front --
 * outline ring first, colours laid inside it -- so a frame's silhouette is
 * always rectangular-clean (hand-typed per-row strings kept going ragged).
 * Colours are slots: K outline, M/L/D team colours, S skin, G steel, W wood.
 * Both figures face right; drawUnits mirrors them when a unit walks left.
 */
const GRID = 12;
/* Villager bodies are civilian from v2 on: bare head with hair (no helmet),
 * plain tunic, tool in the right hand per work frame. The walking frames
 * stride; work frames alternate a (tool raised) / b (tool landed) so the
 * animation lives in the art, not in code-side offsets. */
const ART = {
  villager: {
    idle: [
      [3, 0, 6, 6, 'K'], [4, 1, 4, 1, 'H'], [4, 2, 4, 3, 'S'], [6, 3, 1, 1, 'K'],
      [2, 6, 8, 4, 'K'], [3, 7, 6, 2, 'M'], [7, 7, 1, 2, 'D'],
      [3, 10, 2, 2, 'D'], [7, 10, 2, 2, 'D'],
    ],
    walk: [
      [3, 0, 6, 6, 'K'], [4, 1, 4, 1, 'H'], [4, 2, 4, 3, 'S'], [6, 3, 1, 1, 'K'],
      [2, 6, 8, 4, 'K'], [3, 7, 6, 2, 'M'], [7, 7, 1, 2, 'D'],
      [2, 10, 2, 2, 'D'], [8, 10, 2, 2, 'D'],                     // striding legs
    ],
    farm_a: [                                                       // sickle raised
      [3, 0, 6, 6, 'K'], [4, 1, 4, 1, 'H'], [4, 2, 4, 3, 'S'], [6, 3, 1, 1, 'K'],
      [2, 6, 8, 4, 'K'], [3, 7, 6, 2, 'M'], [7, 7, 1, 2, 'D'],
      [3, 10, 2, 2, 'D'], [7, 10, 2, 2, 'D'],
      [8, 5, 1, 2, 'S'], [9, 3, 2, 1, 'G'], [10, 4, 1, 1, 'G'],   // arm + sickle curve
    ],
    farm_b: [                                                       // sickle swung down
      [3, 0, 6, 6, 'K'], [4, 1, 4, 1, 'H'], [4, 2, 4, 3, 'S'], [6, 3, 1, 1, 'K'],
      [2, 6, 8, 4, 'K'], [3, 7, 6, 2, 'M'], [7, 7, 1, 2, 'D'],
      [3, 10, 2, 2, 'D'], [7, 10, 2, 2, 'D'],
      [8, 8, 1, 1, 'S'], [9, 8, 2, 1, 'G'],                        // arm down, blade at hip
    ],
    chop_a: [                                                       // axe raised
      [3, 0, 6, 6, 'K'], [4, 1, 4, 1, 'H'], [4, 2, 4, 3, 'S'], [6, 3, 1, 1, 'K'],
      [2, 6, 8, 4, 'K'], [3, 7, 6, 2, 'M'], [7, 7, 1, 2, 'D'],
      [3, 10, 2, 2, 'D'], [7, 10, 2, 2, 'D'],
      [8, 6, 1, 1, 'S'], [9, 2, 1, 6, 'W'], [8, 1, 2, 1, 'G'],    // shaft + axe head
    ],
    chop_b: [                                                       // axe at the stump
      [3, 0, 6, 6, 'K'], [4, 1, 4, 1, 'H'], [4, 2, 4, 3, 'S'], [6, 3, 1, 1, 'K'],
      [2, 6, 8, 4, 'K'], [3, 7, 6, 2, 'M'], [7, 7, 1, 2, 'D'],
      [3, 10, 2, 2, 'D'], [7, 10, 2, 2, 'D'],
      [8, 6, 1, 3, 'S'], [8, 9, 3, 1, 'G'], [9, 9, 1, 2, 'W'],    // blade low, shaft down
    ],
    mine_a: [                                                       // pickaxe raised
      [3, 0, 6, 6, 'K'], [4, 1, 4, 1, 'H'], [4, 2, 4, 3, 'S'], [6, 3, 1, 1, 'K'],
      [2, 6, 8, 4, 'K'], [3, 7, 6, 2, 'M'], [7, 7, 1, 2, 'D'],
      [3, 10, 2, 2, 'D'], [7, 10, 2, 2, 'D'],
      [8, 6, 1, 1, 'S'], [9, 3, 1, 5, 'W'], [7, 2, 4, 1, 'G'],    // wide pick head
    ],
    mine_b: [                                                       // pickaxe at the ore
      [3, 0, 6, 6, 'K'], [4, 1, 4, 1, 'H'], [4, 2, 4, 3, 'S'], [6, 3, 1, 1, 'K'],
      [2, 6, 8, 4, 'K'], [3, 7, 6, 2, 'M'], [7, 7, 1, 2, 'D'],
      [3, 10, 2, 2, 'D'], [7, 10, 2, 2, 'D'],
      [8, 7, 1, 2, 'S'], [9, 8, 1, 3, 'W'], [8, 8, 3, 1, 'G'],    // head striking low
    ],
  },
  militia: {
    idle: [
      // helm: outline, steel dome, sheen, face slit with an eye
      [3, 0, 6, 5, 'K'], [4, 1, 4, 2, 'G'], [4, 1, 4, 1, 'L'], [4, 3, 4, 1, 'S'], [6, 3, 1, 1, 'K'],
      // body: outline, tunic, shaded right column, belt
      [2, 5, 8, 5, 'K'], [3, 6, 6, 3, 'M'], [7, 6, 1, 3, 'D'], [3, 8, 6, 1, 'D'],
      // legs
      [3, 10, 2, 2, 'K'], [7, 10, 2, 2, 'K'],
      // sword: blade in the right hand, crossguard
      [10, 2, 1, 7, 'G'], [9, 8, 2, 1, 'K'],
    ],
    walk: [
      [3, 0, 6, 5, 'K'], [4, 1, 4, 2, 'G'], [4, 1, 4, 1, 'L'], [4, 3, 4, 1, 'S'], [6, 3, 1, 1, 'K'],
      [2, 5, 8, 5, 'K'], [3, 6, 6, 3, 'M'], [7, 6, 1, 3, 'D'], [3, 8, 6, 1, 'D'],
      [2, 10, 2, 2, 'K'], [7, 10, 3, 2, 'K'],                      // striding legs
      [10, 2, 1, 7, 'G'], [9, 8, 2, 1, 'K'],
    ],
    attack_a: [                                                     // sword raised
      [3, 0, 6, 5, 'K'], [4, 1, 4, 2, 'G'], [4, 1, 4, 1, 'L'], [4, 3, 4, 1, 'S'], [6, 3, 1, 1, 'K'],
      [2, 5, 8, 5, 'K'], [3, 6, 6, 3, 'M'], [7, 6, 1, 3, 'D'], [3, 8, 6, 1, 'D'],
      [3, 10, 2, 2, 'K'], [7, 10, 2, 2, 'K'],
      [9, 0, 1, 6, 'G'], [8, 5, 2, 1, 'K'],                        // blade up behind the guard
    ],
    attack_b: [                                                     // sword thrust forward
      [3, 0, 6, 5, 'K'], [4, 1, 4, 2, 'G'], [4, 1, 4, 1, 'L'], [4, 3, 4, 1, 'S'], [6, 3, 1, 1, 'K'],
      [2, 5, 8, 5, 'K'], [3, 6, 6, 3, 'M'], [7, 6, 1, 3, 'D'], [3, 8, 6, 1, 'D'],
      [3, 10, 2, 2, 'K'], [7, 10, 2, 2, 'K'],
      [9, 6, 3, 1, 'G'], [8, 5, 1, 3, 'K'],                        // blade flat out, guard
    ],
  },
};
const SKIN = '#e8c39a';
const STEEL = '#cfd6e2';
const WOOD = '#8a6a3f';
const HAIR = '#6a4a2f';
const FIELD = '#7d7a3d';   // farmland green, shared with the procedural farm in index.html

/** Colour slot -> hex for one frame: team colours come from index.html. */
function paletteFor(kind, team) {
  const t = G.TEAM[team];
  return {
    K: kind === 'militia' ? '#262626' : '#1f1f1f',
    M: t.main, D: t.dark, L: t.light,
    S: SKIN, G: STEEL, W: WOOD, H: HAIR, F: FIELD,
  };
}

/* Building art sits on an 11x11 grid (every footprint cell is a multiple of
 * 11 px: 66/44/22) and is authored once per kind, recoloured via paletteFor
 * like the unit art. */
const BLD_GRID = 11;
const BLD_ART = {
  town_center: [
    [0, 0, 11, 11, 'K'],
    [1, 1, 9, 9, 'M'],                                  // keep walls
    [1, 1, 9, 3, 'L'],                                  // upper storey
    [2, 1, 1, 1, 'K'], [4, 1, 1, 1, 'K'],               // crenellation notches
    [6, 1, 1, 1, 'K'], [8, 1, 1, 1, 'K'],
    [5, 4, 1, 4, 'W'],                                  // great door
    [2, 6, 1, 1, 'G'], [8, 6, 1, 1, 'G'],               // window slits
    [1, 9, 9, 1, 'D'],                                  // shaded base
  ],
  house: [
    [0, 0, 11, 11, 'K'],
    [1, 1, 9, 3, 'L'], [5, 1, 1, 3, 'D'],               // pitched roof + ridge
    [1, 4, 9, 1, 'D'],                                  // eave shadow
    [2, 5, 7, 3, 'M'], [3, 6, 2, 2, 'W'], [8, 5, 1, 1, 'G'],  // walls, door, window
    [1, 8, 9, 1, 'D'],                                  // ground shade
  ],
  farm: [
    [0, 0, 11, 11, 'K'],
    [1, 1, 9, 9, 'F'],                                  // field
    [1, 2, 9, 1, 'W'], [1, 4, 9, 1, 'W'],               // furrows
    [1, 6, 9, 1, 'W'], [1, 8, 9, 1, 'W'],
  ],
  barracks: [
    [0, 0, 11, 11, 'K'],
    [1, 1, 9, 2, 'L'],                                  // roof band
    [2, 3, 7, 6, 'M'],                                  // facade
    [4, 6, 3, 3, 'D'],                                  // dark entry hall
    [5, 4, 1, 2, 'G'],                                  // hung blade
    [1, 9, 9, 1, 'D'],                                  // base
  ],
  mill: [
    [0, 0, 11, 11, 'K'],
    [1, 1, 9, 2, 'D'], [5, 1, 1, 2, 'L'],               // dark roof + axle
    [2, 3, 7, 5, 'M'],                                  // tower body
    [3, 5, 5, 2, 'F'],                                  // grain floor
    [1, 8, 9, 1, 'L'],                                  // bright base ring
  ],
  lumber_camp: [
    [0, 0, 11, 11, 'K'],
    [1, 1, 9, 2, 'M'],                                  // team lean-to roof
    [2, 3, 7, 5, 'W'],                                  // stacked log walls
    [1, 8, 9, 2, 'D'],                                  // shaded base
  ],
  mining_camp: [
    [0, 0, 11, 11, 'K'],
    [1, 1, 9, 3, 'L'], [3, 1, 1, 3, 'D'],               // striped tent canvas
    [5, 1, 1, 3, 'D'], [7, 1, 1, 3, 'D'],
    [2, 4, 6, 4, 'M'],                                  // tent body
    [8, 6, 2, 3, 'G'],                                  // ore pile beside it
  ],
};

const fail = (msg) => { console.error('FAIL  ' + msg); process.exit(1); };

/** Paint one frame's rects into its cell; throws on geometry that cannot tile.
 *  grid defaults to the unit GRID (12); buildings pass their BLD_GRID (11). */
function paintCell(g, frame, rects, pal, label, grid) {
  const U = grid || GRID;
  if (frame.sw !== frame.sh || frame.sw % U !== 0) {
    fail(`${label}: cell ${frame.sw}x${frame.sh} is not a whole multiple of the `
      + `${U}x${U} art grid`);
  }
  const u = frame.sw / U;
  for (const [x, y, w, h, slot] of rects) {
    const colour = pal[slot];
    if (colour === undefined) fail(`${label}: rect ${x},${y} ${w}x${h} uses unknown slot '${slot}'`);
    if (x < 0 || y < 0 || x + w > U || y + h > U) {
      fail(`${label}: rect ${x},${y} ${w}x${h} falls outside the ${U}x${U} grid`);
    }
    g.fillStyle = colour;
    g.fillRect(frame.sx + x * u, frame.sy + y * u, w * u, h * u);
  }
}

/* ------------------------------- main --------------------------------- */
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf('--' + name); return i === -1 ? dflt : argv[i + 1]; };
const OUT = path.resolve(arg('out', path.join(ROOT, 'assets', 'sprites.png')));

const sheet = G.SPRITE_SHEET;
const canvas = napi.createCanvas(sheet.w, sheet.h);
const g = canvas.getContext('2d');
g.clearRect(0, 0, sheet.w, sheet.h);
if ('imageSmoothingEnabled' in g) g.imageSmoothingEnabled = false;

const drawn = [];
for (const kind of Object.keys(G.KINDS)) {
  const table = G.SPRITES[kind];
  if (!table) fail(`KINDS.${kind} has no SPRITES entry in index.html`);
  if (!ART[kind]) fail(`KINDS.${kind} has no ART entry in tools/gen-atlas.js`);
  for (const anim of Object.keys(table)) {
    if (!ART[kind][anim]) fail(`SPRITES.${kind}.${anim} has no ART entry in tools/gen-atlas.js`);
    table[anim].forEach((frame, team) => {
      const label = `${kind}/${G.TEAM[team].name}/${anim}`;
      paintCell(g, frame, ART[kind][anim], paletteFor(kind, team), label);
      drawn.push({ label, frame });
    });
  }
}

for (const kind of Object.keys(G.BLD)) {
  const cells = G.BLD_SPRITES[kind];
  if (!cells) fail(`BLD.${kind} has no BLD_SPRITES entry in index.html`);
  if (!BLD_ART[kind]) fail(`BLD.${kind} has no BLD_ART entry in tools/gen-atlas.js`);
  cells.forEach((frame, team) => {
    const label = `BLD.${kind}/${G.TEAM[team].name}`;
    if (G.bldSpriteFor(kind, team) !== frame) fail(`${label}: cell not returned by bldSpriteFor`);
    if (frame.dw !== G.BLD[kind].w * G.CFG.TILE || frame.dh !== G.BLD[kind].h * G.CFG.TILE) {
      fail(`${label}: draws at ${frame.dw}x${frame.dh} but the footprint is `
        + `${G.BLD[kind].w * G.CFG.TILE}x${G.BLD[kind].h * G.CFG.TILE}px`);
    }
    paintCell(g, frame, BLD_ART[kind], paletteFor(kind === 'militia' ? 'militia' : 'villager', team), label, BLD_GRID);
    drawn.push({ label, frame });
  });
}

const png = canvas.toBuffer('image/png');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);

/* -------- verify what we wrote: size + per-cell alpha, from the file ---- */
napi.loadImage(png).then((img) => {
  const probe = napi.createCanvas(img.width, img.height);
  const pc = probe.getContext('2d');
  pc.drawImage(img, 0, 0);
  const lines = [];
  let empty = 0;
  for (const { label, frame } of drawn) {
    const d = pc.getImageData(frame.sx, frame.sy, frame.sw, frame.sh).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
    if (opaque === 0) empty++;
    lines.push(`  ${label.padEnd(16)} cell ${frame.sx},${frame.sy} ${frame.sw}x${frame.sh}`
      + `  opaque ${opaque}/${frame.sw * frame.sh}px  draws at ${frame.dw}x${frame.dh}`);
  }
  const sizeOk = img.width === sheet.w && img.height === sheet.h;
  console.log(`atlas  ${path.relative(ROOT, OUT)}  ${img.width}x${img.height}`
    + `  sha256=${crypto.createHash('sha256').update(png).digest('hex')}`);
  console.log(lines.join('\n'));
  if (!sizeOk) fail(`decoded ${img.width}x${img.height}, table says ${sheet.w}x${sheet.h}`);
  if (empty) fail(`${empty} cell(s) decoded fully transparent`);
  console.log(`ok     ${drawn.length} frames painted from the index.html table`);
}).catch((e) => fail('decoding the written png failed: ' + (e && e.stack || e)));
