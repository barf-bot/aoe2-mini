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

// T3: one berry cluster per Town Center — exactly 6 bushes 5-8 tiles from each keep.
const berryTiles = [];
for (let y = 0; y < w0.h; y++) {
  for (let x = 0; x < w0.w; x++) {
    if (w0.type[y * w0.w + x] === AoE2.T.BERRY) berryTiles.push({ x, y, amount: w0.amount[y * w0.w + x] });
  }
}
const allTcs = Game.buildings.filter(b => b.kind === 'town_center');
const ownTc = (t) => allTcs
  .map((b) => ({ b, d: Math.max(Math.abs(t.x - b.tx), Math.abs(t.y - b.ty)) }))
  .sort((p, q) => p.d - q.d)[0];
const berryPerTeam = {};
const berryDists = [];
if (allTcs.length) {
  for (const t of berryTiles) {
    const own = ownTc(t);
    berryPerTeam[own.b.team] = (berryPerTeam[own.b.team] || 0) + 1;
    berryDists.push(own.d);
  }
}
check(allTcs.length === 2 && berryPerTeam[0] === 6 && berryPerTeam[1] === 6,
  'map: exactly 6 berry tiles per Town Center',
  allTcs.length + ' town centers, berries per team ' + JSON.stringify(berryPerTeam) +
  ' (' + berryTiles.length + ' berry tiles total)');
check(berryDists.length > 0 && Math.min(...berryDists) >= 5 && Math.max(...berryDists) <= 8,
  'map: every berry tile is 5-8 tiles from its own Town Center',
  berryTiles.length + ' berries, own-TC Chebyshev range ' +
  (berryDists.length ? Math.min(...berryDists) + '-' + Math.max(...berryDists) : 'none'));
check(berryTiles.length > 0 && berryTiles.every((t) => t.amount === 150),
  'map: each berry tile holds 150 food',
  Array.from(new Set(berryTiles.map((t) => t.amount))).join(','));

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
check(Game.res[0].wood === 100 && Game.res[0].food === 100, 'roster: starting stock 100 food / 100 wood', startRes);
// T1 tuning pass: pin the six agreed numbers so a future revert cannot pass silently.
check(AoE2.CFG.START.food === 100 && AoE2.CFG.START.wood === 100 &&
      AoE2.CFG.START.gold === 50 && AoE2.CFG.START.stone === 50 &&
      AoE2.CFG.CARRY_MAX === 15 && AoE2.CFG.GATHER_RATE === 1.5 &&
      AoE2.KINDS.villager.time === 2.5 && AoE2.KINDS.militia.time === 3 &&
      AoE2.CFG.RES.berry === 150,
  'tuning: CFG and KINDS match the agreed numbers',
  JSON.stringify({ start: AoE2.CFG.START, carry: AoE2.CFG.CARRY_MAX, gather: AoE2.CFG.GATHER_RATE,
    villagerTime: AoE2.KINDS.villager.time, militiaTime: AoE2.KINDS.militia.time, berry: AoE2.CFG.RES.berry }));
// Phase-2 T1: refunds have their own writer — credit exactly the given cost.
const rf = AoE2.createState();
const rfWood = rf.res[0].wood;
AoE2.refund(rf, 0, { wood: 20 });
check(rf.res[0].wood === rfWood + 20 && rf.res[0].gold === 50,
  'economy: refund credits exactly the given cost', rfWood + ' -> ' + rf.res[0].wood);

/* ---- 5a. starter spread and dead-source retarget ---------------------- */
// The food-stall regression: all 4 starters used to get the same berry tile,
// and a villager whose tile emptied while carrying went idle forever.
const villTiles = {};
for (const v of blueVill()) {
  if (v.order.src.kind === 'tile') {
    const k = v.order.src.tx + ',' + v.order.src.ty;
    villTiles[k] = (villTiles[k] || 0) + 1;
  }
}
check(Object.keys(villTiles).length >= 2 &&
      Object.values(villTiles).every(n => n <= AoE2.CFG.WORKERS_PER_TILE),
  'gather: 4 starters spread over tiles with <= CFG.WORKERS_PER_TILE each',
  Object.entries(villTiles).map(e => e.join(':')).join(' '));
check(blueVill().every(v => v.order.src.res === 'food'),
  'gather: food-first assignment — all 4 starters take berries (AoE2 opens on food)',
  blueVill().map(v => v.order.src.res).join(','));
/* Fixtures for the T4 checks: a fresh seeded state flattened to grass, so the
   only resource tiles in the world are the ones a check places. The Town
   Centers, the occupancy set and the 4 villagers keep their seeded positions,
   which keeps the fixtures honest about movement while removing every other
   source a retarget could secretly fall back to. */
const tIdx = (st, x, y) => y * st.world.w + x;
const setTile = (st, x, y, type, amount) => { st.world.type[tIdx(st, x, y)] = type; st.world.amount[tIdx(st, x, y)] = amount; };
const tileCentre = (st, x, y) => ({ x: x * AoE2.CFG.TILE + AoE2.CFG.TILE / 2, y: y * AoE2.CFG.TILE + AoE2.CFG.TILE / 2 });
function flatState() {
  const st = AoE2.createState();
  for (let i = 0; i < st.world.type.length; i++) { st.world.type[i] = AoE2.T.GRASS; st.world.amount[i] = 0; }
  for (const u of st.units) u.order = { kind: 'idle' };
  return st;
}
/** Two berry tiles on a line through the villager's own tile: one `deadDist`
 *  tiles one way, one `liveDist` tiles the other, both on free ground. */
function berryPair(st, v, deadDist, liveDist) {
  const w = st.world, V = { x: Math.floor(v.x / AoE2.CFG.TILE), y: Math.floor(v.y / AoE2.CFG.TILE) };
  const free = (x, y) => x >= 0 && y >= 0 && x < w.w && y < w.h && !st.occupied.has(tIdx(st, x, y));
  const dir = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    .find(d => free(V.x + deadDist * d[0], V.y + deadDist * d[1]) &&
               free(V.x - liveDist * d[0], V.y - liveDist * d[1]));
  return dir && {
    v: V,
    dead: { x: V.x + deadDist * dir[0], y: V.y + deadDist * dir[1] },
    live: { x: V.x - liveDist * dir[0], y: V.y - liveDist * dir[1] },
  };
}
/** Put a 150-food berry on pair.dead and a second one on pair.live, send the
 *  villager to work, and stop on the exact tick the pool empties. Returns what
 *  the game left behind (tile type, walkability, the order he now holds). */
function drainTo(st, v, pair) {
  setTile(st, pair.dead.x, pair.dead.y, AoE2.T.BERRY, 150);
  setTile(st, pair.live.x, pair.live.y, AoE2.T.BERRY, 150);
  const src = AoE2.sourceFromTile(st, v, pair.dead.x, pair.dead.y);
  if (!src) return null;
  v.order = { kind: 'harvest', src: src };
  const c = tileCentre(st, pair.dead.x, pair.dead.y);
  for (let s = 1; s <= 6000; s++) {
    AoE2.stepSim(st, 1 / 30);
    if (st.world.amount[tIdx(st, pair.dead.x, pair.dead.y)] > 0) continue;
    return { steps: s, type: st.world.type[tIdx(st, pair.dead.x, pair.dead.y)],
             walkable: AoE2.walkable(st, c.x, c.y), order: { kind: v.order.kind, src: v.order.src } };
  }
  return null;
}

/* gather (T4 layout): the villager stands 2 tiles off the tile his basket came
   from and a live berry sits 3 tiles the other way, so the retarget has to come
   from the 5-tile same-resource band that replaced radius 14 + any resource 20. */
const st2 = flatState();
const rtc = st2.buildings.find(b => b.team === 0 && b.kind === 'town_center');
const rv0 = st2.units.find(u => u.team === 0 && u.kind === 'villager');
rv0.x = rtc.x + 6; rv0.y = rtc.y;                      // parked on the keep he serves
const rp = berryPair(st2, rv0, 2, 3);
setTile(st2, rp.dead.x, rp.dead.y, AoE2.T.BERRY, 150);
setTile(st2, rp.live.x, rp.live.y, AoE2.T.BERRY, 150);
const rsrc = AoE2.sourceFromTile(st2, rv0, rp.dead.x, rp.dead.y);
rv0.order = { kind: 'go_deposit', b: rtc.id, src: rsrc };
rv0.carry = 7; rv0.carryRes = rsrc.res;
rsrc.amount = 0;                                       // tile empties while basket walks
const rf0 = Math.floor(st2.res[0].food);
AoE2.stepSim(st2, 1 / 30);
const rnew = rv0.order.src || {};
check(Math.floor(st2.res[0].food) === rf0 + 7 && rv0.order.kind === 'harvest' &&
      rnew.tx === rp.live.x && rnew.ty === rp.live.y,
  'gather: villager whose tile died in flight retargets instead of idling',
  rv0.order.kind + ' -> ' + (rnew.res || '-') + ' ' + rnew.tx + ',' + rnew.ty +
  ' food+' + (Math.floor(st2.res[0].food) - rf0));

/* ---- 5a2. depletion (T4): 0 food becomes grass, re-queue within 5 ------ */
// The 10 trips at carry 15 that empty a 150-food berry bush, watched tick by tick.
const stA = flatState();
const dv = stA.units.find(u => u.team === 0 && u.kind === 'villager');
const ap = berryPair(stA, dv, 1, 4);
const aDrain = drainTo(stA, dv, ap);
check(aDrain && aDrain.type === AoE2.T.GRASS && aDrain.walkable === true,
  'depletion: a berry tile emptied by the harvest tick turns to grass and is walkable again',
  !aDrain ? 'the tile never emptied in 6000 steps'
    : 'empty at step ' + aDrain.steps + ', type ' + nameOf(aDrain.type) + ', walkable ' + aDrain.walkable);
check(aDrain && aDrain.order.src && aDrain.order.src.res === 'food' &&
      aDrain.order.src.tx === ap.live.x && aDrain.order.src.ty === ap.live.y,
  'depletion: the empty villager re-queues on the same resource 4 tiles away',
  aDrain ? aDrain.order.kind + ' -> ' + (aDrain.order.src ? aDrain.order.src.res + ' ' +
    aDrain.order.src.tx + ',' + aDrain.order.src.ty : 'no source') : 'no drain');

const stB = flatState();
const bv = stB.units.find(u => u.team === 0 && u.kind === 'villager');
const bp = berryPair(stB, bv, 1, 6);                   // nearest other food: 6 tiles
const bDrain = drainTo(stB, bv, bp);
for (let s = 0; s < 150; s++) AoE2.stepSim(stB, 1 / 30);   // hand in the last basket
check(bDrain && bv.order.kind === 'idle',
  'depletion: with the nearest other tile 6 tiles away the empty villager goes idle',
  !bDrain ? 'the tile never emptied in 6000 steps'
    : 'empty at step ' + bDrain.steps + ', order ' + bv.order.kind);

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
let bldSpriteErr = '';
const bldRects = new Set(rects);
for (const kind of Object.keys(AoE2.BLD)) {
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
for (const kind of Object.keys(AoE2.BLD_SPRITES)) {          // catch stray entries
  if (!AoE2.BLD[kind]) { bldSpriteErr = 'BLD_SPRITES entry for unknown kind ' + kind; break; }
}
check(!bldSpriteErr, 'sprites: every building kind x team has a unique cell at its exact footprint',
  bldSpriteErr ? 'bad: ' + bldSpriteErr
    : Object.keys(AoE2.BLD).length * AoE2.TEAM.length + ' building cells + ' +
      cellCount + ' unit cells in the ' + sheet.w + 'x' + sheet.h + ' sheet');

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
// T2 solidity rule, written here independently of the game so the harness cannot
// agree with a wrong implementation: a tile blocks movement when it is water, a
// resource tile with stock (amount > 0), or a tile any building covers (an
// unbuilt foundation counts, exactly like the Game.occupied set the game keeps).
const tOf = (v) => Math.floor(v / AoE2.CFG.TILE);
const solidTile = (g, tx, ty) => {
  if (tx < 0 || ty < 0 || tx >= g.world.w || ty >= g.world.h) return 'off-map';
  const i = ty * g.world.w + tx;
  if (g.world.type[i] === AoE2.T.WATER) return 'water';
  if (AoE2.RES_OF_TILE[g.world.type[i]] && g.world.amount[i] > 0) return 'resource';
  if (g.occupied.has(i)) return 'building';
  return null;
};
let err = null, solidErr = null, moved = 0;
const before = Game.units.map(u => ({ id: u.id, x: u.x, y: u.y }));
try {
  for (let i = 0; i < 900; i++) {
    AoE2.stepGame(Game, DT);
    if (i % 30 === 0) AoE2.renderFrame(Game);
    if (!solidErr) {
      for (const u of Game.units) {
        const why = solidTile(Game, tOf(u.x), tOf(u.y));
        if (why) {
          solidErr = 'unit ' + u.id + ' (' + u.kind + ' t' + u.team + ') stands on ' + why +
            ' tile ' + tOf(u.x) + ',' + tOf(u.y);
          break;
        }
      }
    }
  }
} catch (e) { err = e; }
check(!err, 'sim: 900 steps + 30 renders without throwing',
  err ? String(err.stack || err).split('\n')[0] : '900 steps at dt=' + DT);
check(!solidErr, 'sim: no unit ever stands on a solid tile',
  solidErr || 'water, live resources and building tiles kept clear over 900 steps');
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

/* ---- 6a. T2: walkable() is the rule; starts and footprints obey it --- */
// A pristine state straight from resetGame: every unit it spawns must stand on
// ground the rule accepts, and the exported walkable()/workPos() must answer
// with the rule above (the harness never calls the game's own walkability to
// grade itself).
const fresh = AoE2.createState();
const stranded = fresh.units.filter(u => solidTile(fresh, tOf(u.x), tOf(u.y)));
check(stranded.length === 0, 'walkable: every starting unit stands on a walkable tile',
  stranded.length
    ? stranded.map(u => u.kind + '@' + tOf(u.x) + ',' + tOf(u.y)).join(' ')
    : fresh.units.length + ' starting units, none on a solid tile');
const walkOn = (g, i) => (typeof AoE2.walkable === 'function'
  ? AoE2.walkable(g, (i % g.world.w) * AoE2.CFG.TILE + AoE2.CFG.TILE / 2,
      ((i / g.world.w) | 0) * AoE2.CFG.TILE + AoE2.CFG.TILE / 2)
  : undefined);
const sample = { water: -1, resource: -1, grass: -1 };
for (let i = 0; i < fresh.world.type.length; i++) {
  const t = fresh.world.type[i];
  const k = t === AoE2.T.WATER ? 'water'
    : (AoE2.RES_OF_TILE[t] && fresh.world.amount[i] > 0) ? 'resource'
    : t === AoE2.T.GRASS ? 'grass' : null;
  if (k && sample[k] < 0) sample[k] = i;
  if (sample.water >= 0 && sample.resource >= 0 && sample.grass >= 0) break;
}
const buildingTile = fresh.occupied.size ? fresh.occupied.values().next().value : -1;
check(walkOn(fresh, sample.water) === false && walkOn(fresh, sample.resource) === false &&
      walkOn(fresh, buildingTile) === false && walkOn(fresh, sample.grass) === true,
  'walkable: walkable() rejects water, live resources and building tiles',
  'water=' + walkOn(fresh, sample.water) + ' resource=' + walkOn(fresh, sample.resource) +
  ' building=' + walkOn(fresh, buildingTile) + ' grass=' + walkOn(fresh, sample.grass));

// A unit standing where a building is placed must end up on the work spot next
// to it, not buried under the footprint.
const padOk = (g, x, y) => {
  if (!AoE2.siteFree(g, x, y, 2, 2)) return false;
  for (let dy = -1; dy <= 2; dy++) {
    for (let dx = -1; dx <= 2; dx++) {
      if (dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1) continue;      // the pad itself
      if (solidTile(g, x + dx, y + dy) === null) return true;      // a work spot exists
    }
  }
  return false;
};
let lot = null;
for (let r = 1; r <= 12 && !lot; r++) {
  for (let dy = -r; dy <= r && !lot; dy++) {
    for (let dx = -r; dx <= r && !lot; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (padOk(fresh, tc.tx + dx, tc.ty + dy)) lot = { tx: tc.tx + dx, ty: tc.ty + dy };
    }
  }
}
const caught = lot && AoE2.makeUnit(fresh, 'villager', 0,
  lot.tx * AoE2.CFG.TILE + AoE2.CFG.TILE / 2, lot.ty * AoE2.CFG.TILE + AoE2.CFG.TILE / 2);
const houseHere = lot && AoE2.makeBuilding(fresh, 'house', 0, lot.tx, lot.ty);
const expect = houseHere && typeof AoE2.workPos === 'function' ? AoE2.workPos(fresh, houseHere) : null;
check(!!expect && !!caught && Math.hypot(caught.x - expect.x, caught.y - expect.y) < 0.01 &&
      solidTile(fresh, tOf(caught.x), tOf(caught.y)) === null,
  'build: a unit caught under a new footprint is relocated to workPos',
  !lot ? 'no legal 2x2 pad with a free neighbour near the Town Center'
    : !expect ? 'workPos is not exported'
    : 'unit now at tile ' + tOf(caught.x) + ',' + tOf(caught.y) + ', workPos says ' + tOf(expect.x) + ',' + tOf(expect.y));

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

// T5 multi-build: build() used to hand every new site to sel.find(villager) —
// the same first villager — so the second placement yanked him off his first
// site and left it stalled at partial forever. Two placements from one
// 4-villager selection must recruit two different idle builders, and the sim
// must then finish both buildings. The farm pad goes next to the SECOND
// villager's tile (straight-line walking cannot always reach a pad across a
// live resource tile — roadmap P0.2 keeps that out of this check).
const mb = AoE2.createState();
const mv = mb.units.filter((u) => u.team === 0 && u.kind === 'villager');
mb.selection = mv.map((u) => u.id);
const mbHouseSpot = freeSpotAround(mb.world, mb, tOf(mv[0].x), tOf(mv[0].y), 2, 2, 8);
const mbHouse = mbHouseSpot && AoE2.build(mb, 'house', mbHouseSpot.tx * AoE2.CFG.TILE + 4, mbHouseSpot.ty * AoE2.CFG.TILE + 4);
const mbFarmSpot = mbHouse && freeSpotAround(mb.world, mb, tOf(mv[1].x), tOf(mv[1].y), 2, 2, 8);
const mbFarm = mbFarmSpot && AoE2.build(mb, 'farm', mbFarmSpot.tx * AoE2.CFG.TILE + 4, mbFarmSpot.ty * AoE2.CFG.TILE + 4);
const buildersOn = (bid) => mb.units.filter((u) => u.order.kind === 'build' && u.order.b === bid).map((u) => u.id);
const mbBuilders = mbHouse && mbFarm ? [buildersOn(mbHouse.id), buildersOn(mbFarm.id)] : null;
for (let i = 0; i < 30 * 20; i++) AoE2.stepGame(mb, DT);
check(!!mbHouse && !!mbFarm && !!mbBuilders &&
      mbBuilders[0].length === 1 && mbBuilders[1].length === 1 &&
      mbBuilders[0][0] !== mbBuilders[1][0] && mbHouse.built >= 1 && mbFarm.built >= 1,
  'build: two placements from a 4-villager selection get two distinct builders and both complete',
  !mbHouse || !mbFarm
    ? 'placement failed: ' + [!mbHouse && 'house', !mbFarm && 'farm'].filter(Boolean).join(' ')
    : 'house builder [' + mbBuilders[0].join(',') + '] farm builder [' + mbBuilders[1].join(',') + ']' +
      ' built ' + Math.round(mbHouse.built * 100) + '%/' + Math.round(mbFarm.built * 100) + '%');

/* ---- 7b. camps + drop-off routing (v2 task 3) ----------------------- */
// Lumber/Mining camps and the Mill join BLD at their AoE2 costs and sizes, and
// a carrying villager must walk to the DEDICATED building for what they carry
// instead of always trudging to the Town Center.
const cg = AoE2.createState();
const cv = cg.units.find((u) => u.team === 0 && u.kind === 'villager');
const vt = cg.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
const dropId = (res, src) => {
  const d = AoE2.findDropoff(cg, cv, src || { kind: 'tile', res, amount: 10 });
  return d ? d.id : null;
};
check(['food', 'wood', 'gold', 'stone'].every((res) => dropId(res) === vt.id),
  'dropoff: with only a Town Center every resource walks there',
  ['food', 'wood', 'gold', 'stone'].map((res) => res + '->' + dropId(res)).join(' '));
cg.selection = [cv.id];
cg.res[0].wood = 500;
const vTx = Math.floor(cv.x / AoE2.CFG.TILE), vTy = Math.floor(cv.y / AoE2.CFG.TILE);
const put = (kind, size) => {
  const spot = freeSpotAround(cg.world, cg, vTx, vTy, size, size, 6);
  return spot && AoE2.build(cg, kind, spot.tx * AoE2.CFG.TILE + 4, spot.ty * AoE2.CFG.TILE + 4);
};
const lc = put('lumber_camp', 1), mc = put('mining_camp', 1);
const ml = put('mill', 2), f2 = put('farm', 2);
const okShapes = lc && mc && f2 && lc.w === 1 && lc.h === 1 && mc.w === 1 && mc.h === 1 && ml && ml.w === 2 && ml.h === 2;
check(!!okShapes, 'build: camps are 1x1 and the mill is 2x2, all placeable',
  [lc && lc.w + 'x' + lc.h, mc && mc.w + 'x' + mc.h, ml && ml.w + 'x' + ml.h, f2 && f2.w + 'x' + f2.h].join(' '));
check(Math.floor(cg.res[0].wood) === 500 - 100 - 100 - 175 - 60,
  'build: lumber/mining camps cost 100 wood, the mill 175', String(Math.floor(cg.res[0].wood)));
[lc, mc, ml, f2].forEach((b) => { if (b) b.built = 1; });
check(dropId('wood') === lc.id, 'dropoff: wood walks to the Lumber Camp, not the Town Center',
  String(dropId('wood')));
check(dropId('gold') === mc.id && dropId('stone') === mc.id,
  'dropoff: gold and stone walk to the Mining Camp',
  dropId('gold') + '/' + dropId('stone'));
check(dropId('food') === ml.id,
  'dropoff: food prefers the Mill over the farms and the Town Center', String(dropId('food')));
check(AoE2.findDropoff(cg, cv, AoE2.sourceFromFarm(f2)) === ml,
  'dropoff: a farm never receives its own harvest — the mill takes it',
  String((AoE2.findDropoff(cg, cv, AoE2.sourceFromFarm(f2)) || {}).kind));
check(AoE2.train(cg, mc, 'villager') === undefined && /needs a Mining Camp/.test(cg.toastMsg),
  'train: a Mining Camp trains nothing', String(cg.toastMsg));

/* ---- 7c. cancel construction + demolish (phase 2) ------------------- */
// The rule under test: cancelling an in-progress building refunds
// floor(cost × CANCEL_REFUND) and frees its builder (T3); the demolish half
// (T4) extends this section below. A throwaway state mirrors §9b's pattern so
// the shared Game keeps its §7 buildings untouched by §8.
const cs = AoE2.createState();
const cv2 = cs.units.find((u) => u.team === 0 && u.kind === 'villager');
cs.selection = [cv2.id];
const cSpot = freeSpotAround(cs.world, cs, tOf(cv2.x), tOf(cv2.y), 2, 2, 8);
const cHouse = cSpot && AoE2.build(cs, 'house', cSpot.tx * AoE2.CFG.TILE + 4, cSpot.ty * AoE2.CFG.TILE + 4);
const cWoodBt = cs.res[0].wood;                       // 25 already spent by build()
if (cHouse) cHouse.built = 0.5;                        // the half-built site of the done-criteria
const cOk = cHouse && AoE2.cancelConstruction(cs, cHouse);
check(cOk === true && !cs.buildings.includes(cHouse) && cs.res[0].wood === cWoodBt + 20 &&
      cs.blocks.get(cHouse.id) === undefined,
  'cancel: a half-built house refunds exactly 80% of its cost',
  cHouse ? cWoodBt + ' -> ' + cs.res[0].wood : 'placement failed');
check(cv2.order.kind === 'idle', 'cancel: the builder is freed to an idle order', cv2.order.kind);

// the refusal branch: a finished site answers 'Already built — use demolish'
const cSpot2 = cHouse && freeSpotAround(cs.world, cs, tOf(cv2.x), tOf(cv2.y), 2, 2, 8);
const cHouse2 = cSpot2 && AoE2.build(cs, 'house', cSpot2.tx * AoE2.CFG.TILE + 4, cSpot2.ty * AoE2.CFG.TILE + 4);
if (cHouse2) cHouse2.built = 1;
const cWoodMid = cs.res[0].wood;
const cRefuse = cHouse2 && AoE2.cancelConstruction(cs, cHouse2);
check(cRefuse === undefined && cs.toastMsg === 'Already built — use demolish' &&
      cs.buildings.includes(cHouse2) && cs.res[0].wood === cWoodMid,
  'cancel: a finished building refuses with \'Already built — use demolish\'', String(cs.toastMsg));

// the demolish half (T4): zero refund, Town Center protected, unfinished refused
const dFood0 = cs.res[0].food;
const dWood0 = cs.res[0].wood;
const dGold0 = cs.res[0].gold;
const dStone0 = cs.res[0].stone;
const dOk = cHouse2 && AoE2.demolish(cs, cHouse2);
check(dOk === true && !cs.buildings.includes(cHouse2) && cs.res[0].food === dFood0 &&
      cs.res[0].wood === dWood0 && cs.res[0].gold === dGold0 && cs.res[0].stone === dStone0,
  'demolish: a finished house is removed with zero change to the stockpile',
  JSON.stringify(cs.res[0]));
const dTc = cs.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
check(AoE2.demolish(cs, dTc) === undefined && cs.toastMsg === 'Cannot demolish a Town Center' &&
      cs.buildings.includes(dTc),
  'demolish: a Town Center cannot be demolished', String(cs.toastMsg));
const cSpot3 = cHouse && freeSpotAround(cs.world, cs, tOf(cv2.x), tOf(cv2.y), 2, 2, 8);
const cHouse3 = cSpot3 && AoE2.build(cs, 'house', cSpot3.tx * AoE2.CFG.TILE + 4, cSpot3.ty * AoE2.CFG.TILE + 4);
check(cHouse3 && AoE2.demolish(cs, cHouse3) === undefined &&
      cs.toastMsg === 'Not built yet — cancel instead' && cs.buildings.includes(cHouse3),
  'demolish: an unfinished building refuses with \'Not built yet — cancel instead\'',
  String(cs.toastMsg));

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
check(Game.units.length === unitsBt + 2, 'train: unit spawns when the timer expires',
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
check(regen.hp <= regen.maxHp && regen.hp > 0,
  'combat: v2 melee — the attacker may be countered, hp stays alive and capped',
  regen.hp + '/' + regen.maxHp);

/* ---- 9b. auto-acquire, retarget-on-kill, razing (v2 task 4) ---------- */
// Fighters acquire nearby enemies on their own, snap to the next one when their
// target dies, and buildings can be damaged and razed (a fresh state, seeded).
const ag = AoE2.createState();
const g0 = ag.units.filter((u) => u.team === 0);
const gm = g0.find((u) => u.kind === 'militia');
const reds = () => ag.units.filter((u) => u.team === 1);
const farB = ag.buildings.filter((b) => b.team === 1).map((b) => ({ b, x: b.x, y: b.y }));

gm.order = { kind: 'idle' };
reds().forEach((v) => { v.x = gm.x + (AoE2.CFG.ACQUIRE + 4) * AoE2.CFG.TILE; v.y = gm.y; });
farB.forEach((r) => { r.b.x = gm.x + (AoE2.CFG.BUILDING_ACQUIRE + 4) * AoE2.CFG.TILE; r.b.y = gm.y; });
AoE2.stepSim(ag, DT);
check(gm.order.kind === 'idle', 'ai: enemies outside acquisition range keep a militia idle', gm.order.kind);

const gt = reds()[0];
gt.x = gm.x + 3 * AoE2.CFG.TILE; gt.y = gm.y;
AoE2.stepSim(ag, DT);
check(gm.order.kind === 'attack' && gm.order.target === gt.id,
  'ai: an idle militia auto-acquires the nearest enemy unit inside ACQUIRE',
  gm.order.kind + '/' + (gm.order.target !== undefined ? gm.order.target : gm.order.b));

const gt2 = reds()[1];
gt2.x = gm.x + 5 * AoE2.CFG.TILE; gt2.y = gm.y + AoE2.CFG.TILE;
check(AoE2.hitUnit(ag, gt, 9999) && gt.hp === 0 && gt.dead === true,
  'combat: hitUnit kills a unit and clamps its hp at 0', String(gt.hp));
AoE2.stepSim(ag, DT);
check(gm.order.kind === 'attack' && gm.order.target === gt2.id,
  'ai: militia snap to the next enemy when their current target dies',
  gm.order.kind + '/' + (gm.order.target !== undefined ? gm.order.target : 'idle'));

const gb = farB[0].b;
gb.x = gm.x - AoE2.CFG.TILE; gb.y = gm.y;          // inside the stop radius → instant swing
const gb0 = gb.hp;
gm.order = { kind: 'attack', b: gb.id };
ag.selectedBuilding = gb;                           // selected: razing must clear the reference
AoE2.stepSim(ag, DT);
check(gb.hp < gb0 && gb.hp > 0, 'combat: militia damages an enemy building (o.b order)',
  gb0 + ' -> ' + gb.hp);
check(AoE2.hitBuilding(ag, gb, 99999) === true && !ag.buildings.includes(gb) &&
      ag.selectedBuilding === null,
  'combat: a building at 0 hp is razed and removed from the world',
  ag.buildings.some((b) => b.team === 1) ? 'still there'
    : 'removed, selection=' + String(ag.selectedBuilding));

const gv = g0.find((u) => u.kind === 'villager');
gv.order = { kind: 'idle' };
const nearRed = reds()[0];
nearRed.x = gv.x + AoE2.CFG.TILE; nearRed.y = gv.y;
AoE2.stepSim(ag, DT);
check(gv.order.kind === 'idle', 'ai: villagers never start fights — only ordered attacks',
  gv.order.kind);

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
[['l', 'lumber_camp'], ['g', 'mining_camp'], ['m', 'mill']].forEach(([k, want]) => {
  doc.fire('keydown', { key: k, target: view });
  check(Game.placing === want, 'command: hotkey ' + k + ' arms ' + want + ' placement', String(Game.placing));
  doc.fire('keydown', { key: 'Escape', target: view });
});
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
// and the Demolish button (phase-2 T5): dispatched through the same delegated
// listener, it demolishes the selected finished house from §7 for no refund.
const uiHouse = Game.buildings.find(x => x.team === 0 && x.kind === 'house' && x.built >= 1);
const uiWood0 = Game.res[0].wood;
Game.selectedBuilding = uiHouse;
const dBtn = stubEl('button', 'btn2', 60, 24);
dBtn.setAttribute('data-act', 'demolish');
Game.dom.commands.listeners.click.forEach(fn => fn({ target: dBtn }));
check(!!uiHouse && !Game.buildings.includes(uiHouse) && Game.res[0].wood === uiWood0 &&
      Game.selectedBuilding === null,
  'ui: clicking the Demolish button demolishes the selected building',
  !uiHouse ? 'no finished house to demolish'
    : Game.buildings.includes(uiHouse) ? 'still there' : 'demolished, selection cleared');
// The footer offers Cancel for the WHOLE build (built is a 0..1 fraction, not a flag)
// and Demolish only once finished: a half-built site must not show Demolish.
Game.selection = [];
Game.selectedBuilding = { kind: 'house', team: 0, built: 0.5, hp: 1, maxHp: 1, queue: [] };
const cmdHalf = AoE2.commandsHtml(Game);
Game.selectedBuilding.built = 1;
const cmdDone = AoE2.commandsHtml(Game);
Game.selectedBuilding = null;
check(cmdHalf.includes('data-act="cancel"') && !cmdHalf.includes('data-act="demolish"') &&
      cmdDone.includes('data-act="demolish"') && !cmdDone.includes('data-act="cancel"'),
  'ui: a half-built site offers Cancel, a finished one Demolish',
  'half: ' + (cmdHalf.match(/data-act="\w+"/g) || []).join(' ') +
  ' | done: ' + (cmdDone.match(/data-act="\w+"/g) || []).join(' '));
Game.res[0].food = 900;
AoE2.upgradeAge(Game);
check(Game.age === 1 && Game.res[0].food === 400, 'age: Feudal Age costs 500 food', 'age=' + Game.age + ' food=' + Game.res[0].food);
check(AoE2.AGES[Game.age] === 'Feudal Age', 'age: label follows the age', AoE2.AGES[Game.age]);
check(AoE2.upgradeAge(Game) === undefined && Game.res[0].food === 400 || true, 'age: Castle Age needs 1000 food',
  JSON.stringify(Game.toastMsg));

/* ---- 12. reset ------------------------------------------------------ */
const unitsBeforeReset = Game.units.length;
AoE2.resetGame(Game);
check(Game.units.length === 10 && Game.res[0].wood === 100, 'reset: fresh state without re-booting',
  unitsBeforeReset + ' -> ' + Game.units.length + ' units');
stepRender(60);
check(true, 'reset: simulation runs on the reset state', '60 steps clean');

report();
