#!/usr/bin/env node
/* =========================================================================
   gen-atlas.js -- compose assets/sprites.png from the art in data/sprites.

   WHERE THINGS LIVE, so art and code cannot drift:
     - ASSET_DIR (data/sprites) is the game's entire art library: one PNG per
       frame x team, vendored from the ripped AoE2 graphics documented in
       data/README.md. It is the single asset source -- replace the files there
       (or point ASSET_DIR at a different folder) and re-run; src/config.js holds
       no pixels, and the procedural pixel grids this file used to draw units
       with are gone.
    - data/sprites.json is the manifest: kind -> animation -> the blue/red
      files, the size each unit kind is drawn at (the height its idle frame
      draws at, in tiles -- one scale per kind, applied to every frame of that
      kind), and WORK_ANIM. It is the only place the atlas layout is authored.
     - src/config.js's SPRITE_SHEET, SPRITES, WORK_ANIM and BLD_SPRITES are
       generated from the manifest between their `// GENERATED FROM
       data/sprites.json` banners -- the same scheme tools/check-stats.mjs uses
       for CFG/KINDS/BLD -- so the table the game renders from can never
       disagree with the sheet on disk. tools/headless-check.js re-checks that
       the tables cover every KINDS/BLD kind x team.
   usage: node tools/gen-atlas.js [--out assets/sprites.png]
   exits non-zero when a manifest file is missing, a kind in the game has no
   art, a blue/red pair is mis-sized, a kind has no draw scale or no idle frame
   to scale from, the written PNG does not decode at the table's size or any
   cell is empty; the sha256 it prints is stable.
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'src', 'config.js');        // where the generated tables live
const ASSET_DIR = path.join(ROOT, 'data', 'sprites');      // the asset source
const MANIFEST = path.join(ROOT, 'data', 'sprites.json');  // the authored layout
const BANNER = '// GENERATED FROM data/sprites.json';

const fail = (msg) => { console.error('FAIL  ' + msg); process.exit(1); };

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

/* --------------------- the frame table, read from the game ------------- */
const { loadGame } = require('./lib/load-game');
const gameSurface = () => loadGame({ isolated: true });

/** Replace one generated block (`// GENERATED FROM ...` + `const NAME = {...};`)
 *  with its new text; the same contract tools/check-stats.mjs uses. */
function replaceBlock(html, name, rendered) {
  const re = new RegExp(`(^|\\n)(?:// GENERATED FROM [^\\n]*\\n)?const ${name} = \\{[\\s\\S]*?\\};`);
  const m = re.exec(html);
  if (!m) fail(`no \`const ${name} = { ... };\` block found in src/config.js`);
  // m[1] is the newline the match consumed; re-emitting it keeps the block on its own line.
  return html.slice(0, m.index) + m[1] + rendered + html.slice(m.index + m[0].length);
}

/* ------------------------------ the plan ------------------------------- */
const G = gameSurface();
if (!G || !G.KINDS || !G.BLD || !G.CFG || typeof G.spriteFor !== 'function' ||
    typeof G.bldSpriteFor !== 'function') {
  fail('the game does not export KINDS / BLD / CFG / spriteFor / bldSpriteFor');
}
const M = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

/** One frame: resolve the manifest path against ASSET_DIR and load it. */
async function frameFor(file) {
  const abs = path.join(ASSET_DIR, file);
  if (!fs.existsSync(abs)) fail(`data/sprites.json names ${file}, but ${abs} does not exist`);
  const img = await napi.loadImage(abs);
  return { file, img, w: img.width, h: img.height };
}

/** Measure both teams of one frame; a recolour must not change the size. */
async function pairFor(kind, what, files) {
  const [blue, red] = await Promise.all([frameFor(files.blue), frameFor(files.red)]);
  if (blue.w !== red.w || blue.h !== red.h) {
    fail(`${kind}.${what}: blue frame is ${blue.w}x${blue.h}, red is ${red.w}x${red.h}`);
  }
  return { blue, red, w: blue.w, h: blue.h };
}

/** The one scale a kind's frames draw at: `draw.idleTiles` (how tall the kind's
 *  idle frame is drawn, in CFG.TILE pixels each) divided by that idle frame's
 *  own pixel height. Every frame of the kind then gets dw = sw x scale and
 *  dh = sh x scale, so a frame keeps its proportions and the kind keeps one
 *  size across its animations -- the old single fixed box per kind (20x20,
 *  militia 22x22) squashed the villager's 146x86 farm frame to a blob and
 *  stretched its 28x46 idle frame wide. */
function scaleFor(kind, pairs) {
  const tiles = M.units[kind].draw && M.units[kind].draw.idleTiles;
  if (typeof tiles !== 'number' || tiles <= 0) {
    fail(`data/sprites.json: units.${kind}.draw.idleTiles must be a positive number of tiles`);
  }
  if (!pairs.idle) fail(`data/sprites.json: units.${kind} has no idle frame to scale from`);
  return tiles * G.CFG.TILE / pairs.idle.h;
}

/** The pixel of a cell's art that is the figure's feet: the bottom of the
 *  opaque bounding box, centred horizontally, carried into the drawn box (the
 *  art maps sw/sh -> dw/dh). Written next to sx/sy/sw/sh as ax/ay, it is the
 *  point drawUnits puts on the unit, so no animation lifts the figure off the
 *  ground or slides it sideways. Answers null for a fully transparent cell. */
function feetAnchor(d, w, h, dw, dh) {
  let x0 = w, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { ax: Math.round((x0 + x1) * dw / (2 * w)), ay: Math.min(dh, Math.round((y1 + 1) * dh / h)) };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name, dflt) => { const i = argv.indexOf('--' + name); return i === -1 ? dflt : argv[i + 1]; };
  const OUT = path.resolve(arg('out', path.join(ROOT, 'assets', 'sprites.png')));

  /* --- every unit kind in KINDS needs its anims, every BLD kind a frame
   *     (kinds marked noSprite carry no cell and are exempt) --- */
  for (const kind of Object.keys(G.KINDS)) {
    if (!M.units[kind]) fail(`KINDS.${kind} has no entry in data/sprites.json`);
  }
  for (const kind of Object.keys(M.units)) {
    if (!G.KINDS[kind]) fail(`data/sprites.json has a unit kind '${kind}' that KINDS lacks`);
  }
  for (const kind of Object.keys(G.BLD)) {
    if (G.BLD[kind].noSprite) continue;   // age-gated kinds with no cell yet (see check-stats BLD.*)
    if (!M.buildings[kind]) fail(`BLD.${kind} has no entry in data/sprites.json`);
  }
  for (const kind of Object.keys(M.buildings)) {
    if (!G.BLD[kind]) fail(`data/sprites.json has a building '${kind}' that BLD lacks`);
  }

  const SPRITES = {};
  const unitAnims = [];                                  // ordered anim pairs, one row
  for (const kind of Object.keys(M.units)) {
    const spec = M.units[kind];
    const anims = Object.keys(spec.anims);
    const pairs = {};                                    // anim -> the measured frame pair
    for (const anim of anims) pairs[anim] = await pairFor(kind, anim, spec.anims[anim]);
    const scale = scaleFor(kind, pairs);                 // one scale, from the idle frame
    SPRITES[kind] = {};
    for (const anim of anims) {
      const pair = pairs[anim];
      const dw = Math.max(1, Math.round(pair.w * scale));
      const dh = Math.max(1, Math.round(pair.h * scale));
      SPRITES[kind][anim] = [pair, pair];                // cells filled once laid out
      unitAnims.push({ kind, anim, pair, dw, dh });
    }
  }
  const bldEntries = Object.keys(M.buildings).map((kind) => ({
    kind,
    pair: null,                                          // filled below (await in loop)
    dw: G.BLD[kind].w * G.CFG.TILE,
    dh: G.BLD[kind].h * G.CFG.TILE,
  }));
  for (const e of bldEntries) e.pair = await pairFor(`BLD.${e.kind}`, 'built', M.buildings[e.kind].file);

  /* --- layout: two unit rows (blue, red) above two building rows (blue, red) --- */
  const rowH = (items) => items.reduce((m, i) => Math.max(m, i.pair.h), 0);
  const rowW = (items) => items.reduce((s, i) => s + i.pair.w, 0);
  const unitRowH = rowH(unitAnims), bldRowH = rowH(bldEntries);
  const sheetW = Math.max(rowW(unitAnims), rowW(bldEntries));
  const sheetH = 2 * unitRowH + 2 * bldRowH;
  const sheet = { w: sheetW, h: sheetH };

  const cells = [];                                      // every rect we will paint
  let x = 0;
  for (const u of unitAnims) {
    const blue = { sx: x, sy: 0, sw: u.pair.w, sh: u.pair.h, dw: u.dw, dh: u.dh };
    const red = { sx: x, sy: unitRowH, sw: u.pair.w, sh: u.pair.h, dw: u.dw, dh: u.dh };
    SPRITES[u.kind][u.anim] = [blue, red];
    cells.push({ label: `${u.kind}/${u.anim}/Blue`, frame: blue, img: u.pair.blue.img },
               { label: `${u.kind}/${u.anim}/Red`, frame: red, img: u.pair.red.img });
    x += u.pair.w;
  }
  const BLD_SPRITES = {};
  x = 0;
  for (const e of bldEntries) {
    const blue = { sx: x, sy: 2 * unitRowH, sw: e.pair.w, sh: e.pair.h, dw: e.dw, dh: e.dh };
    const red = { sx: x, sy: 2 * unitRowH + bldRowH, sw: e.pair.w, sh: e.pair.h, dw: e.dw, dh: e.dh };
    BLD_SPRITES[e.kind] = [blue, red];
    cells.push({ label: `BLD.${e.kind}/Blue`, frame: blue, img: e.pair.blue.img },
               { label: `BLD.${e.kind}/Red`, frame: red, img: e.pair.red.img });
    x += e.pair.w;
  }
  const WORK_ANIM = M.workAnim;

  /* --- compose the sheet --- */
  const canvas = napi.createCanvas(sheetW, sheetH);
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, sheetW, sheetH);
  if ('imageSmoothingEnabled' in g) g.imageSmoothingEnabled = false;
  for (const c of cells) g.drawImage(c.img, c.frame.sx, c.frame.sy);
  const png = canvas.toBuffer('image/png');

  /* --- verify what we wrote: size + per-cell alpha, read back from the file;
   *     the same pixels give every cell its feet anchor (ax/ay) ------------ */
  const decoded = await napi.loadImage(png);
  if (decoded.width !== sheetW || decoded.height !== sheetH) {
    fail(`decoded ${decoded.width}x${decoded.height}, table says ${sheetW}x${sheetH}`);
  }
  const probe = napi.createCanvas(decoded.width, decoded.height);
  const pc = probe.getContext('2d');
  pc.drawImage(decoded, 0, 0);
  const lines = [];
  let empty = 0;
  for (const c of cells) {
    const d = pc.getImageData(c.frame.sx, c.frame.sy, c.frame.sw, c.frame.sh).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
    if (opaque === 0) empty++;
    const feet = feetAnchor(d, c.frame.sw, c.frame.sh, c.frame.dw, c.frame.dh);
    if (feet) { c.frame.ax = feet.ax; c.frame.ay = feet.ay; }
    lines.push(`  ${c.label.padEnd(26)} cell ${c.frame.sx},${c.frame.sy} ${c.frame.sw}x${c.frame.sh}`
      + `  opaque ${opaque}/${c.frame.sw * c.frame.sh}px  draws at ${c.frame.dw}x${c.frame.dh}`
      + ` anchor ${c.frame.ax},${c.frame.ay}`);
  }
  if (empty) fail(`${empty} cell(s) decoded fully transparent\n` + lines.join('\n'));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, png);

  /* --- regenerate the sprite tables in src/config.js from the same data --- */
  const cellStr = (c) => `{ sx: ${c.sx}, sy: ${c.sy}, sw: ${c.sw}, sh: ${c.sh}, `
    + `dw: ${c.dw}, dh: ${c.dh}, ax: ${c.ax}, ay: ${c.ay} }`;
  const renderSPRITES = () => 'const SPRITES = {\n' + Object.keys(SPRITES).map((kind) =>
    `  ${kind}: {\n` + Object.keys(SPRITES[kind]).map((anim) =>
      `    ${anim}: [${cellStr(SPRITES[kind][anim][0])},\n`
      + `${' '.repeat(4 + anim.length + 2)}${cellStr(SPRITES[kind][anim][1])}],`).join('\n')
    + '\n  },').join('\n') + '\n};';
  const renderBLD = () => 'const BLD_SPRITES = {\n' + Object.keys(BLD_SPRITES).map((kind) =>
    `  ${kind}: [${cellStr(BLD_SPRITES[kind][0])},\n`
    + `${' '.repeat(2 + kind.length + 2)}${cellStr(BLD_SPRITES[kind][1])}],`).join('\n') + '\n};';
  const renderSheet = () => `const SPRITE_SHEET = {\n  w: ${sheetW}, h: ${sheetH},\n};`;
  const renderWork = () => 'const WORK_ANIM = {\n'
    + Object.keys(WORK_ANIM).map((r) => `  ${r}: '${WORK_ANIM[r]}',`).join('\n') + '\n};';

  const before = fs.readFileSync(CONFIG, 'utf8');
  let html = before;
  for (const [name, rendered] of [['SPRITE_SHEET', renderSheet()], ['SPRITES', renderSPRITES()],
    ['WORK_ANIM', renderWork()], ['BLD_SPRITES', renderBLD()]]) {
    html = replaceBlock(html, name, `${BANNER}\n${rendered}`);
  }
  fs.writeFileSync(CONFIG, html);

  /* the file we just wrote must re-export exactly the tables we laid out */
  const back = gameSurface();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(back.SPRITE_SHEET, sheet) || !same(back.SPRITES, SPRITES) ||
      !same(back.BLD_SPRITES, BLD_SPRITES) || !same(back.WORK_ANIM, WORK_ANIM)) {
    fail('src/config.js does not re-export the generated sprite tables');
  }

  console.log(`atlas  ${path.relative(ROOT, OUT)}  ${decoded.width}x${decoded.height}`
    + `  sha256=${crypto.createHash('sha256').update(png).digest('hex')}`);
  console.log(lines.join('\n'));
  console.log(`ok     ${cells.length} frames composed from data/sprites.json`
    + ' and src/config.js regenerated from it');
}

main().catch((e) => fail(e && e.stack || String(e)));
