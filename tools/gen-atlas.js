#!/usr/bin/env node
/* =========================================================================
   gen-atlas.js -- render assets/sprites.png from the sprite table in the game.

   WHERE THINGS LIVE, so art and code cannot drift:
     - the atlas layout (SPRITE_SHEET, SPRITES, spriteFor) is in index.html:
       that is the single source of truth for which cell holds which frame, and
       tools/headless-check.js asserts it covers every unit kind x team, so a
       new unit kind forces new art.
     - the pixels (ART below) live here and nowhere else: one 12x12 grid per
       unit kind, one colour per art pixel, blown up 2x into the 24x24 cell.
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
if (!G || !G.SPRITE_SHEET || !G.SPRITES || typeof G.spriteFor !== 'function') {
  console.error('FAIL  index.html does not export SPRITE_SHEET / SPRITES / spriteFor');
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
const ART = {
  villager: [
    // hooded head: outline, hood, sheen, a slice of face showing
    [3, 0, 6, 6, 'K'], [4, 1, 4, 4, 'M'], [4, 1, 4, 1, 'L'], [5, 3, 2, 1, 'S'],
    // body: outline, tunic, shaded right column
    [2, 6, 8, 4, 'K'], [3, 7, 6, 2, 'M'], [7, 7, 1, 2, 'D'],
    // legs
    [3, 10, 2, 2, 'D'], [7, 10, 2, 2, 'D'],
    // hoe shaft in the far hand
    [10, 2, 1, 6, 'W'],
  ],
  militia: [
    // helm: outline, steel dome, sheen, face slit with an eye
    [3, 0, 6, 5, 'K'], [4, 1, 4, 2, 'G'], [4, 1, 4, 1, 'L'], [4, 3, 4, 1, 'S'], [6, 3, 1, 1, 'K'],
    // body: outline, tunic, shaded right column, belt
    [2, 5, 8, 5, 'K'], [3, 6, 6, 3, 'M'], [7, 6, 1, 3, 'D'], [3, 8, 6, 1, 'D'],
    // legs
    [3, 10, 2, 2, 'K'], [7, 10, 2, 2, 'K'],
    // sword: blade in the right hand, crossguard
    [10, 2, 1, 7, 'G'], [9, 8, 2, 1, 'K'],
  ],
};
const SKIN = '#e8c39a';
const STEEL = '#cfd6e2';
const WOOD = '#8a6a3f';

/** Colour slot -> hex for one frame: team colours come from index.html. */
function paletteFor(kind, team) {
  const t = G.TEAM[team];
  return {
    K: kind === 'militia' ? '#262626' : '#1f1f1f',
    M: t.main, D: t.dark, L: t.light,
    S: SKIN, G: STEEL, W: WOOD,
  };
}

const fail = (msg) => { console.error('FAIL  ' + msg); process.exit(1); };

/** Paint one frame's rects into its cell; throws on geometry that cannot tile. */
function paintCell(g, frame, rects, pal, label) {
  if (frame.sw !== frame.sh || frame.sw % GRID !== 0) {
    fail(`${label}: cell ${frame.sw}x${frame.sh} is not a whole multiple of the `
      + `${GRID}x${GRID} art grid`);
  }
  const u = frame.sw / GRID;
  for (const [x, y, w, h, slot] of rects) {
    const colour = pal[slot];
    if (colour === undefined) fail(`${label}: rect ${x},${y} ${w}x${h} uses unknown slot '${slot}'`);
    if (x < 0 || y < 0 || x + w > GRID || y + h > GRID) {
      fail(`${label}: rect ${x},${y} ${w}x${h} falls outside the ${GRID}x${GRID} grid`);
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
  if (!ART[kind]) fail(`KINDS.${kind} has no ART entry in tools/gen-atlas.js`);
  for (let team = 0; team < G.TEAM.length; team++) {
    const frame = G.spriteFor(kind, team);
    if (!frame) fail(`spriteFor('${kind}', ${team}) returned nothing`);
    const label = `${kind}/${G.TEAM[team].name}`;
    paintCell(g, frame, ART[kind], paletteFor(kind, team), label);
    drawn.push({ label, frame });
  }
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
