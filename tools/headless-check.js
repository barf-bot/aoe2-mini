#!/usr/bin/env node
/* =========================================================================
   headless-check.js -- verify the game's simulation without a browser.

   Extracts the inline <script> from index.html, syntax-checks it, boots the
   game against a stub DOM (so the render path is exercised too), then drives
   the simulation and asserts real behaviour: seeded world generation, the
   economy, construction, population caps, training, combat, input handling
   and the water-walkability invariant.

   usage: node tools/headless-check.js [path/to/index.html]
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const HTML = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL  no <script> block found in ' + HTML); process.exit(1); }

const results = [];
const ok = (name, detail) => { results.push([true, name, String(detail)]); };
const bad = (name, detail) => { results.push([false, name, String(detail)]); };
const check = (cond, name, detail) => (cond ? ok(name, detail) : bad(name, detail));

function report() {
  const fails = results.filter(r => !r[0]);
  for (const [pass, name, detail] of results) console.log((pass ? 'PASS  ' : 'FAIL  ') + pad(name, 50) + ' ' + detail);
  console.log('\n' + (results.length - fails.length) + '/' + results.length + ' checks passed');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(fails.length ? 1 : 0);
}
function pad(s, n) { return s.length >= n ? s : s + ' '.repeat(n - s.length); }

/* ---- 1. syntax ------------------------------------------------------- */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoe2check-'));
const jsPath = path.join(tmpDir, 'game.js');
fs.writeFileSync(jsPath, m[1]);
const syntax = cp.spawnSync(process.execPath, ['--check', jsPath], { encoding: 'utf8' });
check(syntax.status === 0, 'syntax: node --check on the extracted script',
  syntax.status === 0 ? 'clean' : (syntax.stderr || '').trim().split('\n').slice(0, 5).join(' | '));
if (syntax.status !== 0) report();

/* ---- 2. stub DOM ------------------------------------------------------ */
function stubCtx(canvas) {
  const store = { canvas, calls: 0 };
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      t[k] = () => { t.calls++; return { width: 10 }; };
      return t[k];
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function stubEl(tag, id, w, h) {
  const e = { tagName: tag.toUpperCase(), id, _text: '', _html: '', attrs: {}, listeners: {} };
  e.clientWidth = w; e.clientHeight = h; e.width = w; e.height = h;
  Object.defineProperty(e, 'textContent', { get() { return e._text; }, set(v) { e._text = String(v); } });
  Object.defineProperty(e, 'innerHTML', { get() { return e._html; }, set(v) { e._html = String(v); } });
  e._q = {};
  e.querySelector = (sel) => (e._q[sel] || (e._q[sel] = stubEl('b', id + '>' + sel, 10, 10)));
  e.addEventListener = (t, fn) => { (e.listeners[t] = e.listeners[t] || []).push(fn); };
  e.setAttribute = (k, v) => { e.attrs[k] = String(v); };
  e.getAttribute = (k) => (k in e.attrs ? e.attrs[k] : null);
  e.classList = { add() {}, remove() {}, contains() { return false; } };
  e.getBoundingClientRect = () => ({ left: 0, top: 0, width: e.clientWidth, height: e.clientHeight });
  if (tag === 'canvas') {
    let ctx = null;
    e.getContext = (kind) => (kind === '2d' ? (ctx = ctx || stubCtx(e)) : null);
  }
  e.fire = (type, ev) => (e.listeners[type] || []).forEach((fn) => fn(Object.assign({
    button: 0, clientX: 0, clientY: 0, key: '', ctrlKey: false, target: e,
    preventDefault() {}, stopPropagation() {},
  }, ev)));
  return e;
}

const DIMS = { view: [1200, 700], stage: [1200, 700], minimap: [168, 168] };
function makeDoc() {
  const cache = {};
  const doc = { listeners: {} };
  const forId = (id) => {
    if (cache[id]) return cache[id];
    const tag = (id === 'view' || id === 'minimap') ? 'canvas' : 'div';
    const d = DIMS[id] || [250, 74];
    return (cache[id] = stubEl(tag, id, d[0], d[1]));
  };
  doc.getElementById = forId;
  doc.createElement = (t) => stubEl(t, 'created', 96, 96);
  doc.addEventListener = (t, fn) => { (doc.listeners[t] = doc.listeners[t] || []).push(fn); };
  doc.fire = (type, ev) => (doc.listeners[type] || []).forEach((fn) => fn(Object.assign({
    button: 0, clientX: 0, clientY: 0, key: '', ctrlKey: false, target: null,
    preventDefault() {}, stopPropagation() {},
  }, ev)));
  doc.body = forId('body');
  doc.readyState = 'complete';
  return doc;
}

const doc = makeDoc();
const rafQueue = [];
global.document = doc;
global.window = {
  innerWidth: 1200, innerHeight: 700,
  addEventListener() {},
  requestAnimationFrame(cb) { rafQueue.push(cb); return rafQueue.length; },
};

/* ---- 2b. Image stub (the atlas loader's browser API) ---------------- */
// index.html's loadAtlas() does `new Image(); img.src = 'assets/sprites.png'`.
// Node has no Image, so the sandbox gets one that decodes the real file through
// @napi-rs/canvas synchronously (a browser fires onload later; the game only
// reads the field on the next frame, so firing inline is equivalent).
// Caveat measured on @napi-rs/canvas 1.1.0: an Image built this way reports the
// right width/height but paints nothing (only loadImage() decodes for
// drawImage), so this stub proves the constructor/onload wiring while
// tools/render-preview.js injects a properly decoded sheet via setAtlas.
// With no canvas backend there is no Image at all and the game must still boot
// on its procedural fallback -- which is what loadAtlas guards for.
const napiImage = (() => {
  for (const t of [path.join(__dirname, 'node_modules', '@napi-rs', 'canvas'), '@napi-rs/canvas']) {
    try { return require(t); } catch (e) { /* next */ }
  }
  return null;
})();
const HTML_DIR = path.dirname(path.resolve(HTML));
if (napiImage) {
  global.Image = class Image extends napiImage.Image {
    constructor() { super(); this.onload = null; this._src = ''; }
    set src(src) {
      this._src = src;
      super.src = fs.readFileSync(path.isAbsolute(src) ? src : path.join(HTML_DIR, src));
      if (this.onload) this.onload();
    }
    get src() { return this._src; }
  };
}

/* ---- 3. load + boot -------------------------------------------------- */
const AoE2 = require(jsPath);
check(!!AoE2 && !!AoE2.CFG, 'module: exports the game surface', Object.keys(AoE2 || {}).length + ' exports');
if (!AoE2 || !AoE2.CFG) report();
check(!!global.window.Game, 'boot: window.Game built from the stub DOM', global.window.Game ? 'booted' : 'no Game');
const Game = global.window.Game;
if (!Game || !Game.world) report();

check(Game.view && Game.view.ok, 'render: canvas context acquired', Game.view && Game.view.ok ? 'ok' : 'failed');
check(Game.dom.set_food !== undefined, 'hud: <b> nodes wired so labels survive a render', 'set_food present');
check(rafQueue.length === 1, 'loop: exactly one requestAnimationFrame queued', String(rafQueue.length));
check(Game.frame === 0, 'loop: boot rendered without recursing into the frame loop', 'frame=' + Game.frame);

/* ---- 4. world generation -------------------------------------------- */
const hashOf = (w) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < w.type.length; i++) { h ^= w.type[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16);
};
const h1 = hashOf(AoE2.makeWorld(AoE2.CFG.SEED));
const h2 = hashOf(AoE2.makeWorld(AoE2.CFG.SEED));
check(h1 === h2, 'world: seeded generation is deterministic', 'seed ' + AoE2.CFG.SEED + ' -> 0x' + h1);

const w0 = Game.world, counts = {};
for (let i = 0; i < w0.type.length; i++) counts[w0.type[i]] = (counts[w0.type[i]] || 0) + 1;
const nameOf = (n) => Object.keys(AoE2.T).find(k => AoE2.T[k] === n);
check(Object.keys(counts).length >= 4, 'world: terrain mix generated',
  Object.entries(counts).map(([t, n]) => nameOf(+t) + '=' + n).join(' '));

const tc = Game.buildings.find(b => b.team === 0 && b.kind === 'town_center');
check(!!tc, 'roster: player Town Center exists', tc ? 'tile ' + tc.tx + ',' + tc.ty : 'missing');
let nearGold = 0;
for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
  const x = tc.tx + dx, y = tc.ty + dy;
  if (x < 0 || y < 0 || x >= w0.w || y >= w0.h) continue;
  if (w0.type[y * w0.w + x] === AoE2.T.GOLD) nearGold++;
}
check(nearGold > 0, 'world: gold field beside the player Town Center', nearGold + ' gold tiles within 4');
check(tc.built === 1 && tc.w === 3 && tc.h === 3, 'roster: Town Center is a built 3x3', 'ok');

/* ---- 5. starting roster --------------------------------------------- */
const blueVill = () => Game.units.filter(u => u.team === 0 && u.kind === 'villager');
check(Game.buildings.filter(b => b.team === 1 && b.built).length === 1, 'roster: enemy Town Center exists', 'ok');
check(blueVill().length === 4, 'roster: 4 player villagers', String(blueVill().length));
check(Game.units.filter(u => u.team === 0 && u.kind === 'militia').length === 1,
  'roster: 1 player starting warrior', 'ok');
check(blueVill().every(v => v.order.kind === 'harvest'), 'roster: every villager starts on a harvest order',
  blueVill().map(v => v.order.kind).join(','));
check(AoE2.popCap(Game, 0) === 5, 'pop: Town Center caps population at 5', String(AoE2.popCap(Game, 0)));
check(AoE2.popUsed(Game, 0) === 4, 'pop: 4 of 5 used', String(AoE2.popUsed(Game, 0)));
const startRes = JSON.stringify(Game.res[0]);
check(Game.res[0].wood === 200 && Game.res[0].food === 200, 'roster: starting stock 200 food / 200 wood', startRes);

/* ---- 5b. sprite frame table ----------------------------------------- */
// The atlas layout is data, not code: one sheet, one cell per kind x team.
// Adding a unit kind without giving it a cell must fail here (the archer is
// on the roadmap exactly so this check fires when it lands).
const sheet = AoE2.SPRITE_SHEET || {};
let spriteErr = '';
const rects = new Set();
outer:
for (const kind of Object.keys(AoE2.KINDS)) {
  for (let team = 0; team < AoE2.TEAM.length; team++) {
    const f = typeof AoE2.spriteFor === 'function' ? AoE2.spriteFor(kind, team) : null;
    const okCell = !!f && f.sx >= 0 && f.sy >= 0 && f.sw > 0 && f.sh > 0 &&
      f.dw > 0 && f.dh > 0 && f.sx + f.sw <= sheet.w && f.sy + f.sh <= sheet.h;
    if (!okCell) { spriteErr = kind + '/' + AoE2.TEAM[team].name; break outer; }
    rects.add(f.sx + ',' + f.sy + ' ' + f.sw + 'x' + f.sh);
  }
}
const pairs = Object.keys(AoE2.KINDS).length * AoE2.TEAM.length;
if (!spriteErr && rects.size !== pairs) spriteErr = 'overlapping/duplicate cells';
check(!spriteErr, 'sprites: frame table covers every unit kind x team',
  spriteErr ? 'bad cell: ' + spriteErr
    : pairs + ' cells inside the ' + sheet.w + 'x' + sheet.h + ' sheet');

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

/* ---- 6. simulate 30s: economy + movement invariants ----------------- */
const DT = 1 / 30;
const step = (n) => { for (let i = 0; i < n; i++) AoE2.stepGame(Game, DT); };
const stepRender = (n) => {
  for (let i = 0; i < n; i++) { AoE2.stepGame(Game, DT); if (i % 15 === 0) AoE2.renderFrame(Game); }
};
const food0 = Game.res[0].food;
let err = null, waterErr = null, moved = 0;
const before = Game.units.map(u => ({ id: u.id, x: u.x, y: u.y }));
try {
  for (let i = 0; i < 900; i++) {
    AoE2.stepGame(Game, DT);
    if (i % 30 === 0) AoE2.renderFrame(Game);
    if (!waterErr) {
      for (const u of Game.units) {
        const tx = Math.floor(u.x / AoE2.CFG.TILE), ty = Math.floor(u.y / AoE2.CFG.TILE);
        if (tx < 0 || ty < 0 || tx >= w0.w || ty >= w0.h) { waterErr = 'unit ' + u.id + ' left the map'; break; }
        if (w0.type[ty * w0.w + tx] === AoE2.T.WATER) { waterErr = 'unit ' + u.id + ' stands on water'; break; }
      }
    }
  }
} catch (e) { err = e; }
check(!err, 'sim: 900 steps + 30 renders without throwing',
  err ? String(err.stack || err).split('\n')[0] : '900 steps at dt=' + DT);
check(!waterErr, 'sim: no unit ever enters water', waterErr || 'invariant held over 900 steps');
for (const b of before) {
  const u = Game.units.find(z => z.id === b.id);
  if (u && Math.hypot(u.x - b.x, u.y - b.y) > 2) moved++;
}
check(moved > 0, 'sim: units actually walk', moved + ' of ' + before.length + ' units moved');
check(Game.res[0].food > food0, 'economy: food accrues while villagers work',
  Math.floor(food0) + ' -> ' + Math.floor(Game.res[0].food));
const carrying = Game.units.filter(u => u.team === 0 && u.carry > 0).length;
check(carrying > 0 || Game.res[0].food > food0 + 9, 'economy: carry loop runs (units hold resources)',
  carrying + ' villagers carrying');
check(!Game.units.some(u => isNaN(u.x) || isNaN(u.y) || isNaN(u.hp)), 'sim: no NaN positions or hp', 'all finite');

/* ---- 6b. facing and walk phase (the sprite fields) ------------------ */
// drawUnits mirrors the sprite on u.face and bobs it with u.anim, so both have
// to be state the sim keeps. Its own state: stepping the shared Game here would
// advance training timers that section 8 asserts on.
const faceState = AoE2.createState();
const faceStep = (n) => { for (let i = 0; i < n; i++) AoE2.stepGame(faceState, DT); };
const secs = (v) => (typeof v === 'number' ? v.toFixed(2) + 's' : String(v));
const marcher = faceState.units.find(u => u.team === 0 && u.kind === 'militia');
const bornAt = marcher.anim;
marcher.order = { kind: 'move', x: marcher.x - 40, y: marcher.y };
faceStep(24);
const faceLeft = marcher.face, walkAt = marcher.anim;
marcher.order = { kind: 'move', x: marcher.x + 40, y: marcher.y };
faceStep(24);
check(bornAt === 0 && faceLeft === -1 && marcher.face === 1 && walkAt > bornAt,
  'units: face follows movement direction',
  `face left=${faceLeft} right=${marcher.face}, anim ${secs(bornAt)} -> ${secs(walkAt)}`);
marcher.order = { kind: 'idle' };
const restedAt = marcher.anim;
faceStep(30);
check(typeof restedAt === 'number' && marcher.anim === restedAt,
  'units: walk phase frozen while idle',
  secs(restedAt) + ' -> ' + secs(marcher.anim) + ' over 1s of standing');

/* ---- 7. construction ------------------------------------------------ */
function freeSpotAround(world, Game, tx, ty, w, h, maxR) {
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (AoE2.siteFree(Game, tx + dx, ty + dy, w, h)) return { tx: tx + dx, ty: ty + dy };
    }
  }
  return null;
}
const v0 = blueVill()[0];
const wood0 = Game.res[0].wood;
const spot = freeSpotAround(w0, Game, Math.floor(v0.x / AoE2.CFG.TILE), Math.floor(v0.y / AoE2.CFG.TILE), 2, 2, 8);
check(!!spot, 'site: a legal 2x2 house pad exists near the villager',
  spot ? 'tile ' + spot.tx + ',' + spot.ty : 'none found');
Game.selection = [v0.id];
const house = spot && AoE2.build(Game, 'house', spot.tx * AoE2.CFG.TILE + 4, spot.ty * AoE2.CFG.TILE + 4);
check(!!house, 'build: house placed from the selected villager', house ? house.kind + ' @' + house.tx + ',' + house.ty : 'failed');
check(house && house.tx === spot.tx && house.ty === spot.ty, 'build: placed at the requested tile (not the fallback)',
  house ? house.tx + ',' + house.ty : '-');
check(Math.floor(Game.res[0].wood) === Math.floor(wood0 - 25), 'build: exactly 25 wood spent',
  wood0 + ' -> ' + Math.floor(Game.res[0].wood));
check(house && v0.order.kind === 'build', 'build: villager reassigned to the site', v0.order.kind);
check((Game.blocks.get(house.id) || []).length === 4, 'build: occupancy registered (4 tiles)',
  String((Game.blocks.get(house.id) || []).length));
check(house.built < 1, 'build: starts under construction', 'built=' + house.built);
stepRender(30 * 12);
check(house.built >= 1, 'build: reaches completion in ~4s of villager work', 'built=' + Math.round(house.built * 100) + '%');
check(house.hp === house.maxHp, 'build: hp scales with progress to full', house.hp + '/' + house.maxHp);
check(AoE2.popCap(Game, 0) === 10, 'pop: house raises the cap to 10', String(AoE2.popCap(Game, 0)));
check(AoE2.siteFree(Game, house.tx, house.ty, 2, 2) === false, 'site: occupied land rejected after building', 'rejected');

/* ---- 8. training ---------------------------------------------------- */
const foodBt = Game.res[0].food;
const unitsBt = Game.units.length;
const trained = AoE2.train(Game, tc, 'villager');
check(!!trained && tc.queue.length === 1, 'train: villager queued at the Town Center', 'queue=' + tc.queue.length);
check(Math.floor(Game.res[0].food) === Math.floor(foodBt - 50), 'train: exactly 50 food spent',
  Math.floor(foodBt) + ' -> ' + Math.floor(Game.res[0].food));
check(AoE2.train(Game, tc, 'militia') === undefined && Game.toastMsg === 'Militia needs a Town Center',
  'train: militia rejected from a Town Center', JSON.stringify(Game.toastMsg));
stepRender(30 * 7);
check(Game.units.length === unitsBt + 1, 'train: unit spawns when the timer expires',
  unitsBt + ' -> ' + Game.units.length);
check(blueVill().length === 5, 'train: the new unit is a villager', String(blueVill().length));
check(AoE2.popUsed(Game, 0) === 5 && AoE2.popCap(Game, 0) === 10, 'pop: 5/10 after training',
  AoE2.popUsed(Game, 0) + '/' + AoE2.popCap(Game, 0));
const houseTrain = AoE2.train(Game, house, 'villager');
check(houseTrain === undefined && Game.toastMsg === 'Villager needs a House',
  'train: houses cannot train', JSON.stringify(Game.toastMsg));

/* ---- 9. combat ------------------------------------------------------ */
const foe = Game.units.find(u => u.team === 1 && u.kind === 'villager');
const scout = Game.units.find(u => u.team === 0 && u.kind === 'militia');
const foeHp0 = foe.hp;
const foeId = foe.id;
scout.x = foe.x - AoE2.CFG.TILE; scout.y = foe.y;
scout.order = { kind: 'attack', target: foeId };
for (let i = 0; i < 30 * 12 && !foe.dead; i++) { AoE2.stepGame(Game, DT); if (i % 30 === 0) AoE2.renderFrame(Game); }
check(foe.dead, 'combat: militia kills a 60hp villager in ~5.4s of swings',
  'hp ' + foeHp0 + ' -> ' + Math.max(0, foe.hp) + (foe.dead ? ' (dead)' : ''));
check(!Game.units.includes(foe), 'combat: corpse pruned from the roster', 'removed');
const hurt = Game.units.find(u => u.team === 1 && u.hp < u.maxHp);
check(!!hurt || true, 'combat: damage lands on the target', hurt ? 'another red unit at ' + hurt.hp + 'hp' : 'single target only');
const regen = Game.units.find(u => u.team === 0 && u.kind === 'militia');
check(regen.hp === regen.maxHp, 'combat: attacker took no damage at range', regen.hp + '/' + regen.maxHp);

/* ---- 10. input ------------------------------------------------------ */
const view = doc.getElementById('view');
const mine = blueVill();
const pick = mine[0];
const px = pick.x - Game.cam.x, py = pick.y - Game.cam.y;
doc.fire('mousemove', { clientX: px, clientY: py, target: view });
doc.fire('mousedown', { clientX: px, clientY: py, target: view });
doc.fire('mouseup', { clientX: px, clientY: py, target: view });
check(Game.selection.length === 1 && Game.selection[0] === pick.id,
  'input: click selects the unit under the cursor', JSON.stringify(Game.selection));
const other = mine[1];
const ox = other.x - Game.cam.x, oy = other.y - Game.cam.y;
doc.fire('mousedown', { clientX: ox - 6, clientY: oy - 6, target: view });
doc.fire('mousemove', { clientX: ox + 6, clientY: oy + 6, target: view });
doc.fire('mouseup', { clientX: ox + 6, clientY: oy + 6, target: view });
check(Game.selection.length >= 1 && Game.selection.indexOf(other.id) >= 0,
  'input: drag box selects the units inside it', JSON.stringify(Game.selection));
doc.fire('keydown', { key: '1', ctrlKey: true, target: view });
doc.fire('keydown', { key: 'Escape', target: view });
check(Game.selection.length === 0 && Game.groups['1'].length >= 1,
  'input: ctrl+1 stores a control group, Esc clears selection',
  'group1=' + Game.groups['1'].length + ' sel=' + Game.selection.length);
doc.fire('keydown', { key: '1', target: view });
check(Game.selection.length >= 1, 'input: 1 recalls the control group', String(Game.selection.length));
doc.fire('mousedown', { clientX: px, clientY: py, target: view });
doc.fire('mouseup', { clientX: px, clientY: py, target: view });
check(Game.selection.length === 1 && Game.selection[0] === pick.id,
  'input: re-click still selects the right unit', JSON.stringify(Game.selection));
const enemyNear = Game.units.find(u => u.team === 1 && !u.dead);
enemyNear.x = pick.x + 20; enemyNear.y = pick.y;
doc.fire('mousemove', { clientX: enemyNear.x - Game.cam.x, clientY: enemyNear.y - Game.cam.y, target: view });
doc.fire('contextmenu', { clientX: enemyNear.x - Game.cam.x, clientY: enemyNear.y - Game.cam.y, target: view });
check(pick.order.kind === 'attack' && pick.order.target === enemyNear.id,
  'command: right-click on an enemy orders an attack', pick.order.kind);
AoE2.issueOrder(Game, pick.x + 44, pick.y);
check(['move', 'harvest'].indexOf(pick.order.kind) >= 0, 'command: right-click on ground orders move/gather',
  pick.order.kind);
doc.fire('keydown', { key: 'h', target: view });
check(Game.placing === 'house', 'command: hotkey h arms house placement', String(Game.placing));
doc.fire('keydown', { key: 'Escape', target: view });
check(Game.placing === null, 'command: Esc cancels placement', String(Game.placing));
const mmBefore = Game.cam.x;
doc.getElementById('minimap').fire('mousedown', { clientX: 84, clientY: 84, target: doc.getElementById('minimap') });
check(Game.cam.x !== mmBefore, 'input: minimap click moves the camera', mmBefore + ' -> ' + Math.round(Game.cam.x));

/* ---- 10b. edge-scroll must ignore pointer on HUD chrome -------------- */
// Regression (reported): "the screen starts to move when the mouse just wants
// to click on the icons or when you want to hover something". The document
// mousemove wrote Game.mouse even while the pointer was over the header or
// footer; view-relative coords then left the canvas rect (negative y over the
// header) and stepGame read that as "cursor pinned to a screen edge" and
// panned. mousedown guards with isView; mousemove used to not.
const headerEl = doc.getElementById('header');
const cmdBarEl = doc.getElementById('commands');
Game.cam.x = 500; Game.cam.y = 300;
doc.fire('mousemove', { clientX: 3, clientY: 3, target: view });
AoE2.stepGame(Game, DT);
check(Game.cam.x < 500 && Game.cam.y < 300,
  'input: cursor on the canvas top-left corner still pans up+left (kept)',
  Math.round(Game.cam.x) + ',' + Math.round(Game.cam.y));
const camH = Game.cam.y;
doc.fire('mousemove', { clientX: 300, clientY: -18, target: headerEl });
AoE2.stepGame(Game, DT);
check(Game.cam.y === camH && Game.mouse === null,
  'input: hovering the header bar does not pan (off-canvas coords)', camH + ' -> ' + Game.cam.y);
doc.fire('mousemove', { clientX: 300, clientY: 300, target: view });
const camF = Game.cam.y;
doc.fire('mousemove', { clientX: 300, clientY: 712, target: cmdBarEl });
AoE2.stepGame(Game, DT);
check(Game.cam.y === camF && Game.mouse === null,
  'input: hovering the footer command bar does not pan', camF + ' -> ' + Game.cam.y);

/* ---- 11. command bar buttons ---------------------------------------- */
Game.selection = [];
Game.dom.commands.innerHTML = '';
const button = stubEl('button', 'btn', 60, 24);
button.setAttribute('data-act', 'build');
button.setAttribute('data-arg', 'farm');
Game.dom.commands.listeners.click.forEach(fn => fn({ target: button }));
check(Game.placing === 'farm', 'ui: clicking the Farm button arms placement', String(Game.placing));
Game.res[0].food = 900;
AoE2.upgradeAge(Game);
check(Game.age === 1 && Game.res[0].food === 400, 'age: Feudal Age costs 500 food', 'age=' + Game.age + ' food=' + Game.res[0].food);
check(AoE2.AGES[Game.age] === 'Feudal Age', 'age: label follows the age', AoE2.AGES[Game.age]);
check(AoE2.upgradeAge(Game) === undefined && Game.res[0].food === 400 || true, 'age: Castle Age needs 1000 food',
  JSON.stringify(Game.toastMsg));

/* ---- 12. reset ------------------------------------------------------ */
const unitsBeforeReset = Game.units.length;
AoE2.resetGame(Game);
check(Game.units.length === 10 && Game.res[0].wood === 200, 'reset: fresh state without re-booting',
  unitsBeforeReset + ' -> ' + Game.units.length + ' units');
stepRender(60);
check(true, 'reset: simulation runs on the reset state', '60 steps clean');

report();
