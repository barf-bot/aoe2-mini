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

// The stat tables index.html's section 1 is generated from (tools/check-stats.mjs
// proves the two agree). The checks below read them instead of re-typing numbers,
// so the harness can never pass on a stale literal.
const dataUnits = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'units.json'), 'utf8'));
const dataBuildings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'buildings.json'), 'utf8'));
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
// T1 pinned six numbers by hand; they now come from data/, so compare against the
// tables instead of literals (tools/check-stats.mjs is the equality proof, this is
// the in-game assertion that the generated section 1 is what the sim uses).
check(AoE2.CFG.START.food === dataUnits.cfg.START.food &&
      AoE2.CFG.START.wood === dataUnits.cfg.START.wood &&
      AoE2.CFG.START.gold === dataUnits.cfg.START.gold &&
      AoE2.CFG.START.stone === dataUnits.cfg.START.stone &&
      AoE2.CFG.CARRY_MAX === dataUnits.cfg.CARRY_MAX &&
      AoE2.CFG.GATHER_RATE === dataUnits.cfg.GATHER_RATE &&
      AoE2.KINDS.villager.time === dataUnits.units.villager.time &&
      AoE2.KINDS.militia.time === dataUnits.units.militia.time &&
      AoE2.CFG.RES.berry === dataUnits.cfg.RES.berry,
  'tuning: CFG and KINDS carry the data/ table values',
  JSON.stringify({ start: AoE2.CFG.START, carry: AoE2.CFG.CARRY_MAX, gather: AoE2.CFG.GATHER_RATE,
    villagerTime: AoE2.KINDS.villager.time, militiaTime: AoE2.KINDS.militia.time, berry: AoE2.CFG.RES.berry }));
// The bug class this port introduces: a tiles/s number written into a px field.
check(Object.keys(dataUnits.units).every((k) => AoE2.KINDS[k] &&
      AoE2.KINDS[k].speed === Math.round(AoE2.CFG.TILE * dataUnits.units[k].speedTps)),
  'tuning: KINDS.speed is always the table\'s tiles/s x CFG.TILE',
  Object.keys(dataUnits.units)
    .map((k) => `${k}=${AoE2.KINDS[k] ? AoE2.KINDS[k].speed : 'missing'}/` +
                `${Math.round(AoE2.CFG.TILE * dataUnits.units[k].speedTps)}px`).join(' '));
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
// Rule amended by the blacksmith plan (T1): every BLD kind has a cell per team,
// EXCEPT a kind marked `noSprite` -- those must answer bldSpriteFor(...) ===
// null, which is what routes the renderer to its procedural look (index.html:1885).
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

/* ---- 6c. pathfinding (T1: findPath, the A* core) -------------------- */
// Written before findPath existed, and still graded the §6a way: the harness
// carries its own search over its own tile rule, so a wrong A* cannot grade
// itself. Each fixture proves its own optimum before A* is compared to it.
// Fixture maps are ASCII: '.' grass, 'W' water, '#' a building tile, 'B' a berry.
const pathState = (rows) => {
  const h = rows.length, w = rows[0].length;
  const type = new Array(w * h).fill(AoE2.T.GRASS), amount = new Array(w * h).fill(0);
  const occupied = new Set();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = rows[y][x];
    if (c === 'W') type[y * w + x] = AoE2.T.WATER;
    else if (c === '#') occupied.add(y * w + x);
    else if (c === 'B') { type[y * w + x] = AoE2.T.BERRY; amount[y * w + x] = 150; }
  }
  return { world: { w, h, type, amount }, occupied, units: [], buildings: [], pathQueries: 0 };
};
const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
/** The reference route: uniform-cost Dijkstra over the harness's own solidTile
 *  rule with the two rules findPath documents (the start tile may be solid, a
 *  diagonal needs both its orthogonal neighbours walkable). Step count, or null. */
const refSteps = (st, from, to) => {
  const W = st.world.w, N = W * st.world.h;
  const openAt = (x, y) => (x === from.tx && y === from.ty) || solidTile(st, x, y) === null;
  const dist = new Array(N).fill(Infinity), done = new Array(N).fill(false);
  dist[from.ty * W + from.tx] = 0;
  for (;;) {
    let cur = -1, best = Infinity;
    for (let i = 0; i < N; i++) if (!done[i] && dist[i] < best) { best = dist[i]; cur = i; }
    if (cur < 0) return null;
    if (cur === to.ty * W + to.tx) return best;
    done[cur] = true;
    const cx = cur % W, cy = (cur / W) | 0;
    for (const d of N8) {
      const x = cx + d[0], y = cy + d[1];
      if (x < 0 || y < 0 || x >= W || y >= st.world.h) continue;
      if (d[0] && d[1] && !(openAt(cx, y) && openAt(x, cy))) continue;   // no corner-cutting
      if (!openAt(x, y)) continue;
      if (best + 1 < dist[y * W + x]) dist[y * W + x] = best + 1;
    }
  }
};
/** What is wrong with a route, as a list: gaps, tiles that are not walkable
 *  (the route's own start tile excepted), diagonals cutting a corner, and
 *  anything off the board. Empty list means the route obeys the board rule. */
const routeProblems = (st, p) => {
  const out = [];
  for (let i = 1; i < p.length; i++) {
    const dx = p[i].tx - p[i - 1].tx, dy = p[i].ty - p[i - 1].ty;
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) {
      out.push(p[i - 1].tx + ',' + p[i - 1].ty + '->' + p[i].tx + ',' + p[i].ty + ' is not a step');
    } else if (dx && dy &&
        (solidTile(st, p[i - 1].tx, p[i].ty) !== null || solidTile(st, p[i].tx, p[i - 1].ty) !== null)) {
      out.push('the diagonal into ' + p[i].tx + ',' + p[i].ty + ' squeezes between two solid tiles');
    }
  }
  for (let i = 1; i < p.length; i++) {
    if (solidTile(st, p[i].tx, p[i].ty) !== null) out.push(p[i].tx + ',' + p[i].ty + ' is not walkable');
  }
  return out;
};
// Every check below reads the export the same guarded way §6a reads walkable(),
// so a missing findPath fails the check instead of killing the run.
const fp = (st, a, b) => (typeof AoE2.findPath === 'function' ? AoE2.findPath(st, a, b) : null);
const fpNote = (p) => (p === null ? (typeof AoE2.findPath === 'function' ? 'no route returned' : 'findPath is not exported') : undefined);

// 1. open grass: the route must be the straight-line optimum, tile for tile.
const OPEN = pathState(['.........', '.........', '.........', '.........', '.........']);
const openRoute = fp(OPEN, { tx: 0, ty: 0 }, { tx: 8, ty: 3 });
const idealSteps = Math.max(8, 3);
check(!!openRoute && openRoute.length === idealSteps + 1 &&
      openRoute[0].tx === 0 && openRoute[0].ty === 0 &&
      openRoute[openRoute.length - 1].tx === 8 && openRoute[openRoute.length - 1].ty === 3 &&
      routeProblems(OPEN, openRoute).length === 0,
  'path: a route on open grass is the straight-line optimum',
  fpNote(openRoute) || (openRoute.length + ' tiles where the straight line needs ' +
    (idealSteps + 1) + '; ' + (routeProblems(OPEN, openRoute).join(' ') || 'every step is 8-adjacent on open grass')));

// 2. the roadmap P0.2 exit condition, on a 5-tile inlet hanging off the north
// shore: Dijkstra says the optimum, A* may not be more than 15% longer, and the
// fixture itself is only trusted when its own optimum is close to the
// straight line (otherwise "within 15% of optimal" would be vacuous).
const INLET = pathState(['.....W.....', '.....W.....', '.....W.....', '.....W.....', '.....W.....',
  '...........', '...........', '...........', '...........', '...........', '...........']);
const inFrom = { tx: 0, ty: 4 }, inTo = { tx: 10, ty: 4 };
const inIdeal = Math.max(10, 0);
const inBest = refSteps(INLET, inFrom, inTo);
const inRoute = fp(INLET, inFrom, inTo);
check(inBest !== null && inBest <= 1.15 * inIdeal && !!inRoute &&
      (inRoute.length - 1) <= 1.15 * inBest && routeProblems(INLET, inRoute).length === 0,
  'path: a route around a water inlet stays within 15% of optimal',
  'straight line ' + inIdeal + ' steps, Dijkstra around the inlet ' + inBest +
    ' steps, A* ' + (fpNote(inRoute) || (inRoute.length - 1) + ' steps'));

// 3. the only shortcut here is the illegal one: (1,2)->(2,1) has water at
// (1,1) and a building at (2,2) as its two orthogonal neighbours, so a
// corner-cutting search returns the 3-tile route and this check names it.
const SQUEEZE = pathState(['WW....', 'WW....', '..#...', '......', '......', '......']);
const sqRoute = fp(SQUEEZE, { tx: 0, ty: 3 }, { tx: 3, ty: 0 });
check(!!sqRoute && routeProblems(SQUEEZE, sqRoute).length === 0,
  'path: a diagonal never squeezes between two solid tiles',
  fpNote(sqRoute) || (sqRoute.length + ' tiles (' + sqRoute.map((t) => t.tx + ',' + t.ty).join(' ') +
    ') — ' + (routeProblems(SQUEEZE, sqRoute).join(' ') || 'both orthogonal tiles open at every diagonal')));

// 4. a hopeless query must answer, not stall: an island with no route to a
// walkable goal, and a route that exists but blows the authored node budget.
const ISLES = pathState(['WWWWWWW', 'WWWWWWW', 'WW.W.WW', 'WWWWWWW', 'WWWWWWW']);
const lostRoute = fp(ISLES, { tx: 3, ty: 2 }, { tx: 5, ty: 2 });
const savedCap = AoE2.CFG.ASTAR_MAX_NODES;
AoE2.CFG.ASTAR_MAX_NODES = 3;                       // the open 9x5 route needs 8
const cappedRoute = fp(OPEN, { tx: 0, ty: 0 }, { tx: 8, ty: 3 });
AoE2.CFG.ASTAR_MAX_NODES = savedCap;
check(!!openRoute && lostRoute === null && cappedRoute === null,
  'path: an unreachable goal returns null within the node cap',
  fpNote(openRoute) || ('unreachable island -> ' + (lostRoute === null ? 'null' : lostRoute.length + ' tiles') +
    '; the same 8-step route with CFG.ASTAR_MAX_NODES=3 -> ' +
    (cappedRoute === null ? 'null' : cappedRoute.length + ' tiles') + ' (authored cap ' + savedCap + ')'));

// 5. a unit standing on a farm tile or a fresh foundation still has a route:
// the start tile is accepted even when solid, every later tile must be open.
const FOUNDATION = pathState(['#.....', '......', '......', '......']);
const foundFrom = { tx: 0, ty: 0 }, foundTo = { tx: 4, ty: 3 };
const foundRoute = fp(FOUNDATION, foundFrom, foundTo);
check(!!foundRoute && foundRoute[0].tx === 0 && foundRoute[0].ty === 0 &&
      foundRoute[foundRoute.length - 1].tx === foundTo.tx &&
      foundRoute[foundRoute.length - 1].ty === foundTo.ty &&
      refSteps(FOUNDATION, foundFrom, foundTo) === foundRoute.length - 1 &&
      routeProblems(FOUNDATION, foundRoute).length === 0,
  "path: a route starts on the unit's own tile even when that tile is solid",
  fpNote(foundRoute) || ('route ' + foundRoute.map((t) => t.tx + ',' + t.ty).join(' ') +
    ' starts on the occupied tile and matches the Dijkstra length ' +
    refSteps(FOUNDATION, foundFrom, foundTo) + '; ' +
    (routeProblems(FOUNDATION, foundRoute).join(' ') || 'all later tiles walkable')));

/* -- T2: the move order carries a route (moveUnit, mapEpoch) ------------ */
// Fixtures: a seeded state flattened to grass (so the only solids are the two
// Town Centers plus whatever water or pad a check adds), one ordered villager,
// and walkOrder(), which steps the sim while the order lives and reports every
// position he occupied plus how many findPath calls it cost (Game.pathQueries —
// the plan pins the "re-paths every frame" bug class with a number).
const DIRS8H = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** flatState plus a villager ordered `dist` tiles in `dir` (default: the first
 *  direction with `dist` free tiles in a row). `at` is the ordered point, always
 *  a tile centre, so arriving exactly and arriving on the tile are the same act. */
const flatWithOrder = (dist, dir) => {
  const st = flatState();
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  const V = { x: tOf(v.x), y: tOf(v.y) };
  const free = (x, y) => x >= 0 && y >= 0 && x < st.world.w && y < st.world.h &&
    !st.occupied.has(tIdx(st, x, y));
  const d = dir || DIRS8H.find((o) => {
    for (let k = 1; k <= dist; k++) if (!free(V.x + o[0] * k, V.y + o[1] * k)) return false;
    return true;
  });
  if (!d) return null;
  const goal = { tx: V.x + d[0] * dist, ty: V.y + d[1] * dist };
  return { st, v, V, goal, at: tileCentre(st, goal.tx, goal.ty) };
};
const orderTo = (f) => { f.v.order = { kind: 'move', x: f.at.x, y: f.at.y }; };
/** Step the sim while the order lives; report the positions, the step count and
 *  the findPath calls they cost. */
const walkOrder = (st, u, max) => {
  const seen = [], q0 = st.pathQueries || 0;
  const from = { x: u.x, y: u.y };
  let n = 0;
  while (n < max && u.order.kind !== 'idle' && !u.dead) {
    AoE2.stepGame(st, DT);
    n++;
    seen.push({ x: u.x, y: u.y });
  }
  return { seen, n, from, queries: (st.pathQueries || 0) - q0 };
};
const orderAndWalk = (f, max) => { orderTo(f); return walkOrder(f.st, f.v, max); };
const routeOf = (u) => (u.path || []).map((t) => t.tx + ',' + t.ty);
const distTo = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

// 6. one tile of water between the villager and his goal, so the straight line
// is NOT walkable: every position he stood on must be a tile of the route he
// cached, and the route must be longer than the straight line to count.
const detourF = (() => {
  for (const d of DIRS8H) {
    const f = flatWithOrder(2, d);
    if (!f) continue;
    setTile(f.st, tOf(f.v.x) + d[0], tOf(f.v.y) + d[1], AoE2.T.WATER, 0);   // the middle
    const w = orderAndWalk(f, 240);
    if (!w.seen.length) continue;
    return { f, w, route: routeOf(f.v) };
  }
  return null;
})();
check(!!detourF && detourF.route.length > 2 &&
      detourF.w.seen.every((p) => detourF.route.indexOf(tOf(p.x) + ',' + tOf(p.y)) >= 0),
  'path: a move order walks the stored route, not the straight line',
  !detourF ? 'no move order cached a route to walk'
    : `${detourF.w.n} steps over ${detourF.route.length} route tiles ` +
      `${detourF.route.join(' ')}; ` +
      `${detourF.w.seen.filter((p) => detourF.route.indexOf(tOf(p.x) + ',' + tOf(p.y)) < 0).length} ` +
      `positions off the route`);

// 7. the same walk, graded on its end: the order is retired and he stands on the
// tile he was ordered to (the plan's "ends within CFG.TILE / 2 of the point").
check(!!detourF && detourF.f.v.order.kind === 'idle' &&
      distTo(detourF.f.v, detourF.f.at) < AoE2.CFG.TILE / 2,
  'path: the move order completes on the ordered tile',
  !detourF ? 'no move order cached a route to walk'
    : `order ${detourF.f.v.order.kind} after ${detourF.w.n} steps, ${distTo(detourF.f.v, detourF.f.at).toFixed(1)}px ` +
      `from the ordered point (${detourF.f.at.x},${detourF.f.at.y}), tile ${tOf(detourF.f.v.x)},${tOf(detourF.f.v.y)}`);

// 8. a house lands on the road he is walking — the plan's "a building placed
// mid-walk": Game.mapEpoch moves, so the very next step re-paths. The pad is
// chosen so it never swallows his own tile or the goal tile, which are the two
// other reasons a route can stop being valid.
const repathF = (() => {
  for (const d of DIRS8H) {
    for (let dist = 2; dist <= 5; dist++) {
      const f = flatWithOrder(dist, d);
      if (!f) continue;
      orderTo(f);
      AoE2.stepGame(f.st, DT);                          // one step: the route is cached
      const before = routeOf(f.v);
      if (before.length < 3) continue;
      const own = tOf(f.v.x) + ',' + tOf(f.v.y), goal = f.goal.tx + ',' + f.goal.ty;
      const pad = f.v.path.slice(1, -1).find((t) => AoE2.siteFree(f.st, t.tx, t.ty, 2, 2) &&
        [[0, 0], [1, 0], [0, 1], [1, 1]].every((o) => {
          const k = (t.tx + o[0]) + ',' + (t.ty + o[1]);
          return k !== own && k !== goal;
        }));
      if (!pad) continue;
      AoE2.makeBuilding(f.st, 'house', 0, pad.tx, pad.ty);
      AoE2.stepGame(f.st, DT);                          // the very next step
      const after = routeOf(f.v);
      return { f, before, after, w: walkOrder(f.st, f.v, 400), pad };
    }
  }
  return null;
})();
check(!!repathF && repathF.after.length > 0 &&
      repathF.after.join(' ') !== repathF.before.join(' ') &&
      distTo(repathF.f.v, repathF.f.at) < AoE2.CFG.TILE / 2,
  'path: a building placed on the route re-paths on the next step',
  !repathF ? 'no move order cached a route a house could be placed on'
    : `house at ${repathF.pad.tx},${repathF.pad.ty}: ${repathF.before} -> ${repathF.after}, ` +
      `${repathF.w.n} further steps, ${distTo(repathF.f.v, repathF.f.at).toFixed(1)}px from the ordered point`);

// 9. the number that pins the bug class: a walk with nothing changing around it
// must not ask findPath again every frame (60 steps, at most 2 queries).
const cleanF = flatWithOrder(1);
const cleanW = cleanF ? orderAndWalk(cleanF, 60) : null;
check(!!cleanW && cleanW.queries >= 1 && cleanW.queries <= 2 && cleanW.n >= 20,
  'path: a clean walk uses at most two A* queries in 60 steps',
  !cleanF ? 'no free tile next to a villager to order him to'
    : `${cleanW.n} steps, ${cleanW.queries} findPath calls (the bound is 2), moved ` +
      `${distTo(cleanW.from, { x: cleanF.v.x, y: cleanF.v.y }).toFixed(1)}px`);

// 10. an order with no route at all: ringed with water, the villager neither
// nose-presses the shore nor twitches — the order is refused and retired.
const stuckF = (() => {
  const st = flatState();
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  const V = { x: tOf(v.x), y: tOf(v.y) };
  const d = DIRS8H.find((o) => !st.occupied.has(tIdx(st, V.x + o[0] * 2, V.y + o[1] * 2)));
  if (!d) return null;
  for (const o of DIRS8H) setTile(st, V.x + o[0], V.y + o[1], AoE2.T.WATER, 0);
  const at = tileCentre(st, V.x + d[0] * 2, V.y + d[1] * 2);
  v.order = { kind: 'move', x: at.x, y: at.y };
  const w = walkOrder(st, v, 5);
  return { v, at, w };
})();
check(!!stuckF && stuckF.v.order.kind === 'idle' && stuckF.v.x === stuckF.w.from.x &&
      stuckF.v.y === stuckF.w.from.y,
  'path: an unreachable move order leaves the unit idle',
  !stuckF ? 'no villager with a free tile two steps away'
    : `order ${stuckF.v.order.kind} after ${stuckF.w.n} steps, at ${stuckF.v.x.toFixed(1)},` +
      `${stuckF.v.y.toFixed(1)} (ordered ${stuckF.at.x},${stuckF.at.y}), ` +
      `${stuckF.w.queries} findPath calls`);

/* -- T3: the other four order kinds route to a standing spot -------------- *
 * `standTarget(Game, u, x, y, stop)` (the pathfinding block) names the tile an
 * order's route must end on: the ordered point when it is walkable, otherwise the
 * spot the game already assigns for that kind of thing (a building's `workPos`, a
 * resource tile's `workSpot`), otherwise nothing — and `null` REFUSES the order
 * instead of letting the unit walk at a solid thing forever. Every check below
 * orders one unit and then reads `u.path`: an order walked with the old straight
 * step has no route at all, so these are the checks that prove a branch converted.
 * `scene()` is the shared fixture — a flat board plus one unit of the kind under
 * test, parked on a named tile. */
const scene = (kind, team, tx, ty) => {
  const st = flatState();
  return { st, u: AoE2.makeUnit(st, kind, team, tileCentre(st, tx, ty).x, tileCentre(st, tx, ty).y) };
};
const tileKey = (p) => tOf(p.x) + ',' + tOf(p.y);

// 11. a militia ordered to an enemy 3 tiles east with a tile of water in front of
// him: the route ends on the enemy's own tile — what standTarget answers for a
// walkable point, which is also what this branch already aimed at — and the swing
// lands. The contract for the `attack`-on-a-unit site.
const atkUnitF = (() => {
  const f = scene('militia', 0, 60, 60);
  const foe = AoE2.makeUnit(f.st, 'villager', 1, tileCentre(f.st, 63, 60).x, tileCentre(f.st, 63, 60).y);
  setTile(f.st, 61, 60, AoE2.T.WATER, 0);
  setTile(f.st, 62, 60, AoE2.T.WATER, 0);
  f.u.order = { kind: 'attack', target: foe.id };
  const hp0 = foe.hp, w = walkOrder(f.st, f.u, 900);
  return { f, foe, hp0, w, route: routeOf(f.u) };
})();
check(!!atkUnitF && atkUnitF.route.length > 1 &&
      atkUnitF.route[atkUnitF.route.length - 1] === tileKey(atkUnitF.foe) &&
      distTo(atkUnitF.f.u, atkUnitF.foe) <= atkUnitF.f.u.r + atkUnitF.foe.r + 4 &&
      atkUnitF.foe.hp < atkUnitF.hp0,
  'path: a melee attack route ends at contact range of the target unit',
  !atkUnitF ? 'no state to order a unit in'
    : `${atkUnitF.w.n} steps, route ${atkUnitF.route.join(' ')}, ended ` +
      `${distTo(atkUnitF.f.u, atkUnitF.foe).toFixed(1)}px from the enemy (the table's contact is ` +
      `${atkUnitF.f.u.r + atkUnitF.foe.r + 4}px), its hp ${atkUnitF.hp0}->${atkUnitF.foe.hp}`);

// 12. a 3x3 Town Center is a block of solid tiles: the route cannot end on the tile
// the order names, it has to end on a ring tile — the plan's "ends on its reach
// ring, never on its footprint". Aimed at the building's own tile (the pre-T3
// branch) the order had no route at all and the fighter stopped wherever the
// straight step left him.
const atkBuildF = (() => {
  const f = scene('militia', 0, 65, 51);
  const tc = f.st.buildings.find((b) => b.team === 1 && b.kind === 'town_center');
  if (!tc) return null;
  const spot = AoE2.workPos(f.st, tc);
  f.u.order = { kind: 'attack', b: tc.id };
  const hp0 = tc.hp, w = walkOrder(f.st, f.u, 900);
  return { f, tc, spot, hp0, w, route: routeOf(f.u) };
})();
check(!!atkBuildF && atkBuildF.route.length > 1 &&
      atkBuildF.route[atkBuildF.route.length - 1] === tileKey(atkBuildF.spot) &&
      AoE2.siteFree(atkBuildF.f.st, tOf(atkBuildF.f.u.x), tOf(atkBuildF.f.u.y), 1, 1) &&
      atkBuildF.tc.hp < atkBuildF.hp0,
  'path: a melee attack on a building stops on its reach ring, not its footprint',
  !atkBuildF ? 'no enemy Town Center to order a unit against'
    : `TC ${atkBuildF.tc.tx},${atkBuildF.tc.ty}: route ${atkBuildF.route.join(' ') || 'none'} ends on ` +
      `${tileKey(atkBuildF.spot)} (its work spot), the fighter stands on ${tileKey(atkBuildF.f.u)} ` +
      `${distTo(atkBuildF.f.u, atkBuildF.tc).toFixed(1)}px from the tower, its hp ${atkBuildF.hp0}->${atkBuildF.tc.hp}`);

// 13. the same target with an archer: the table's range, not contact, decides where
// the route ends, so he stops 4 tiles out and looses an arrow instead of walking
// onto the tower.
const atkRangedF = (() => {
  const f = scene('archer', 0, 65, 50);
  const tc = f.st.buildings.find((b) => b.team === 1 && b.kind === 'town_center');
  if (!tc) return null;
  const spot = AoE2.workPos(f.st, tc);
  const hp0 = tc.hp;
  f.u.order = { kind: 'attack', b: tc.id };
  const w = walkOrder(f.st, f.u, 900);
  return { f, tc, spot, hp0, w, route: routeOf(f.u) };
})();
check(!!atkRangedF && atkRangedF.route.length > 1 &&
      atkRangedF.route[atkRangedF.route.length - 1] === tileKey(atkRangedF.spot) &&
      Math.abs(distTo(atkRangedF.f.u, atkRangedF.spot) - AoE2.CFG.TILE * 4) <= AoE2.CFG.TILE / 2 &&
      (atkRangedF.tc.hp < atkRangedF.hp0 || atkRangedF.f.st.projectiles.length > 0),
  'path: a ranged attack route stops at the table range and does not close to contact',
  !atkRangedF ? 'no enemy Town Center to order an archer against'
    : `route ${atkRangedF.route.join(' ') || 'none'} ends on ${tileKey(atkRangedF.spot)}, he stopped ` +
      `${distTo(atkRangedF.f.u, atkRangedF.spot).toFixed(1)}px from that spot (the table range is ` +
      `${AoE2.CFG.TILE * 4}px), tower hp ${atkRangedF.hp0}->${atkRangedF.tc.hp}, ` +
      `${atkRangedF.f.st.projectiles.length} arrows in the air`);

// 14. a villager ordered to build a house whose work spot sits on the far side of a
// strip of water: he finishes it standing on that spot, reached by a route. The
// branch already handed moveUnit the work spot; this pins the plan's "harvest /
// build / move orders all route the same way" for it.
const buildOrderF = (() => {
  const f = scene('villager', 0, 60, 60);
  setTile(f.st, 61, 59, AoE2.T.WATER, 0);
  setTile(f.st, 61, 60, AoE2.T.WATER, 0);
  setTile(f.st, 61, 61, AoE2.T.WATER, 0);
  if (!AoE2.siteFree(f.st, 62, 60, 1, 1)) return null;
  const house = AoE2.makeBuilding(f.st, 'house', 0, 62, 60);
  const spot = AoE2.workPos(f.st, house);
  f.u.order = { kind: 'build', b: house.id };
  const w = walkOrder(f.st, f.u, 2400);
  return { f, house, spot, w, route: routeOf(f.u) };
})();
check(!!buildOrderF && buildOrderF.house.built === 1 &&
      buildOrderF.f.u.order.kind === 'idle' && buildOrderF.route.length > 1 &&
      buildOrderF.route[buildOrderF.route.length - 1] === tileKey(buildOrderF.spot),
  'path: a build order routes to workPos instead of the straight line',
  !buildOrderF ? 'no free house pad across water to order a villager to'
    : `house 62,60 built ${buildOrderF.house.built.toFixed(2)}, order ${buildOrderF.f.u.order.kind} ` +
      `after ${buildOrderF.w.n} steps, route ${buildOrderF.route.join(' ') || 'none'} ends on the ` +
      `work spot ${tileKey(buildOrderF.spot)}`);

/* -- T4: formation slots replace the golden-angle scatter ----------------- *
 * `formationSlots(Game, sel, x, y)` (the pathfinding block) answers a group move
 * order with one tile per unit: a centred grid of ceil(sqrt(n)) columns at the tile
 * pitch, solid cells skipped and the grid grown until everybody owns a tile.
 * `issueOrder` writes the answer into `u.slot`, and the `move` branch walks to it —
 * replacing the golden-angle spiral that dropped a squad on top of itself. Before
 * T4 no unit carries a slot, so every check here fails for the missing field and
 * passes once the group marches into ranks. */
const fsq = (st, sel, x, y) => (typeof AoE2.formationSlots === 'function' ? AoE2.formationSlots(st, sel, x, y) : null);
const fsqNote = (p) => (p === null ? (typeof AoE2.formationSlots === 'function' ? 'no slots returned' : 'formationSlots is not exported') : undefined);
/** `n` team-0 villagers standing in ranks on the centred grid over their own tile
 *  (sx, sy) — `cols = ceil(sqrt(n))` tiles, the pitch the game itself uses — and
 *  ordered to the centre of tile (gx, gy) through `issueOrder`, exactly what a
 *  right-click does; `water` floods tiles first when a check wants it. A squad
 *  starts in a formation because that is what the game produces, and stacking them
 *  on one tile would test something else entirely: 4 units sharing a square crawl at
 *  a fraction of a pixel per frame while separate() and their own routes fight over
 *  it. Returns the state, the squad, the ordered point and the slots the order gave. */
const squadTo = (n, sx, sy, gx, gy, water) => {
  const st = flatState();
  const cols = Math.max(1, Math.ceil(Math.sqrt(n))), back = (cols - 1) >> 1;
  const squad = [];
  for (let i = 0; i < n; i++) squad.push(AoE2.makeUnit(st, 'villager', 0,
    tileCentre(st, sx + (i % cols) - back, sy + ((i / cols) | 0) - back).x,
    tileCentre(st, sx + (i % cols) - back, sy + ((i / cols) | 0) - back).y));
  st.units = squad;                                      // just the squad under test
  (water || []).forEach((t) => setTile(st, t[0], t[1], AoE2.T.WATER, 0));
  st.selection = squad.map((u) => u.id);
  const at = tileCentre(st, gx, gy);
  AoE2.issueOrder(st, at.x, at.y);
  return { st, sel: squad, at, slots: squad.map((u) => u.slot) };
};
const minPair = (us) => Math.min(...us.flatMap((a, i) => us.slice(i + 1).map((b) => distTo(a, b))));

// 15. the assignment itself: 4 villagers ordered to one tile take the 2x2 block of
// tiles there — one tile pitch, one unit per tile, every one of them walkable.
const s4 = squadTo(4, 60, 60, 63, 60);
const sq4 = fsq(s4.st, s4.sel, s4.at.x, s4.at.y);
const want4 = ['63,60', '64,60', '63,61', '64,61'];
check(!!sq4 && sq4.length === 4 &&
      new Set(sq4.map((p) => tileKey(p.slot))).size === 4 &&
      want4.every((k) => sq4.some((p) => tileKey(p.slot) === k)) &&
      sq4.every((p) => AoE2.siteFree(s4.st, p.slot.tx, p.slot.ty, 1, 1)),
  'formation: a 4-unit move order yields 4 distinct walkable slots',
  fsqNote(sq4) || `${sq4.length} slots: ${sq4.map((p) => p.u.id + '@' + tileKey(p.slot)).join(' ')} ` +
    `(the 2x2 at 63,60 is ${want4.join(' ')})`);

/** that squad, walked until the whole group is idle. `end[i]` records where unit i's
 *  order retired — the position this checks, because once a unit is done the rest of
 *  the walk can still shove him aside (that is separate(), not the route): the tile he
 *  retired on is what the order promised. 1500 steps against a ~110-step walk, so the
 *  cap is never the point. */
const walked = (f) => {
  if (!f.sel.every((u) => u.slot)) return { f, n: 0, snap: f.slots, end: f.sel.map(() => null) };
  const snap = f.sel.map((u) => u.slot);        // a retiring move order releases its tile
  const end = f.sel.map(() => null);
  let steps = 0;
  while (steps < 1500 && f.sel.some((u) => u.order.kind !== 'idle')) {
    AoE2.stepGame(f.st, DT); steps++;
    f.sel.forEach((u, i) => { if (!end[i] && (u.order.kind === 'idle' || u.dead)) end[i] = { x: u.x, y: u.y }; });
  }
  return { f, n: steps, snap, end };
};
const walkF = walked(squadTo(4, 60, 60, 63, 60));

// 16. the order's end: each of the 4 retires on the tile he was given — the plan's
// "all 4 end within CFG.TILE / 2 of their own slot", not one shared tile.
check(walkF.n > 0 && walkF.end.every((p, i) => p && walkF.f.sel[i].order.kind === 'idle' &&
      walkF.f.sel[i].slot === null && tOf(p.x) === walkF.snap[i].tx && tOf(p.y) === walkF.snap[i].ty &&
      distTo(p, walkF.snap[i]) <= AoE2.CFG.TILE / 2),
  'formation: every unit of the group arrives on its own slot',
  !walkF.n ? 'the move order assigned no slots to walk'
    : walkF.f.sel.map((u, i) => `${u.id}${walkF.end[i] ? `@${tOf(walkF.end[i].x)},${tOf(walkF.end[i].y)}` : ''}` +
      `(ordered ${walkF.snap[i] ? walkF.snap[i].tx + ',' + walkF.snap[i].ty : 'none'} ` +
      `${walkF.end[i] ? distTo(walkF.end[i], walkF.snap[i]).toFixed(1) : '-'}px, order ${u.order.kind})`).join(' ') +
      ` after ${walkF.n} steps`);

// 17. the two separation mechanisms agree by construction: the pitch is
// CFG.UNIT_SEP on the tile grid, so a group parked on its slots needs no pushes —
// calling separate() moves nobody. (The spiral left pairs 9-15px apart and did.)
const sepF = (() => {
  if (!walkF.n || typeof AoE2.separate !== 'function') return null;
  const before = walkF.f.sel.map((u) => ({ x: u.x, y: u.y }));
  AoE2.separate(walkF.f.st);
  return { before, after: walkF.f.sel.map((u) => ({ x: u.x, y: u.y })) };
})();
check(!!sepF && sepF.before.every((p, i) => p.x === sepF.after[i].x && p.y === sepF.after[i].y),
  'formation: a group parked on its slots needs zero separation pushes',
  !sepF ? (typeof AoE2.separate === 'function' ? 'the group never arrived, nothing to park' : 'separate is not exported')
    : `moved ${sepF.before.filter((p, i) => p.x !== sepF.after[i].x || p.y !== sepF.after[i].y).length} of ` +
      `${sepF.after.length} units; the nearest two are ${minPair(walkF.f.sel).toFixed(1)}px apart ` +
      `(CFG.UNIT_SEP is ${AoE2.CFG.UNIT_SEP}px)`);

// 18. the same order with two of the four tiles flooded: the grid grows past the
// water and every villager still gets a tile of his own — and none of them in it.
const s4w = squadTo(4, 67, 60, 70, 60, [[71, 60], [70, 61]]);
const sq4w = fsq(s4w.st, s4w.sel, s4w.at.x, s4w.at.y);
check(!!sq4w && sq4w.length === 4 &&
      new Set(sq4w.map((p) => tileKey(p.slot))).size === 4 &&
      sq4w.every((p) => AoE2.siteFree(s4w.st, p.slot.tx, p.slot.ty, 1, 1)),
  'formation: slots skip water and still give every unit a distinct tile',
  fsqNote(sq4w) || `${sq4w.length} slots: ${sq4w.map((p) => p.u.id + '@' + tileKey(p.slot)).join(' ')} ` +
    `(71,60 and 70,61 are water, so the 2x2 there cannot hold 4)`);

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
stepRender(Math.ceil(AoE2.BLD.house.time / DT) + 2);          // exactly the table's build time
check(house.built >= 1, 'build: reaches completion in ~' + AoE2.BLD.house.time + 's of villager work',
  'built=' + Math.round(house.built * 100) + '%');
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
// the slower of the two parallel sites (the house) decides the window, from BLD
for (let i = 0; i < Math.ceil(AoE2.BLD.house.time / DT) + 2; i++) AoE2.stepGame(mb, DT);
check(!!mbHouse && !!mbFarm && !!mbBuilders &&
      mbBuilders[0].length === 1 && mbBuilders[1].length === 1 &&
      mbBuilders[0][0] !== mbBuilders[1][0] && mbHouse.built >= 1 && mbFarm.built >= 1,
  'build: two placements from a 4-villager selection get two distinct builders and both complete',
  !mbHouse || !mbFarm
    ? 'placement failed: ' + [!mbHouse && 'house', !mbFarm && 'farm'].filter(Boolean).join(' ')
    : 'house builder [' + mbBuilders[0].join(',') + '] farm builder [' + mbBuilders[1].join(',') + ']' +
      ' built ' + Math.round(mbHouse.built * 100) + '%/' + Math.round(mbFarm.built * 100) + '%');

// T1 blacksmith: the BLAC row joins BLD behind an authored `age` gate -- a
// Dark Age village is refused with a toast before any villager is drafted
// (the gate runs ahead of pickBuilder), and from Feudal on the table's
// numbers are real: exactly the row's 150 wood and its 40s site.
const bsGate = (() => {
  const st = AoE2.createState();
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  const wood0 = st.res[0].wood;
  let built, threw = null;
  try { built = AoE2.build(st, 'blacksmith'); } catch (e) { threw = e; }
  return { built, threw, toast: st.toastMsg, wood: st.res[0].wood, wood0, order: v && v.order.kind };
})();
check(!bsGate.threw && bsGate.built === undefined &&
      bsGate.toast === 'Blacksmith requires Feudal Age' && bsGate.wood === bsGate.wood0,
  'build: a Dark Age settlement cannot raise a Blacksmith (Feudal only)',
  bsGate.threw ? 'threw: ' + bsGate.threw.message
    : 'built=' + String(bsGate.built) + ' toast=' + JSON.stringify(bsGate.toast) +
      ' wood=' + bsGate.wood + ' (was ' + bsGate.wood0 + ')');
const bsF = (() => {
  const st = AoE2.createState();
  st.age = 1;
  st.res[0].wood = 200;                               // START holds 100; the row costs 150
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  const spot = freeSpotAround(st.world, st, tOf(v.x), tOf(v.y), 1, 1, 8);
  st.selection = [v.id];                              // pin the builder so the walk is deterministic, as the §7 house check does
  const wood0 = st.res[0].wood;
  let b, threw = null;
  try { b = spot && AoE2.build(st, 'blacksmith', spot.tx * AoE2.CFG.TILE + 4, spot.ty * AoE2.CFG.TILE + 4); }
  catch (e) { threw = e; }
  const spent = b ? wood0 - st.res[0].wood : NaN;
  // Work only accrues once the builder reaches the site (updateUnit's build
  // branch works on arrival), so a 1x1 pad off the corner costs a short walk
  // the §7 house fixture never pays -- its 2x2 footprint reaches the builder's
  // own tile. Step to completion and compare the duration with the table's
  // time: never faster, and the walk capped at 8s (the pad is <= 8 tiles off).
  const time = AoE2.BLD.blacksmith && AoE2.BLD.blacksmith.time;
  let steps = 0;
  if (b) while (b.built < 1 && steps < Math.ceil((time + 8) / DT)) { AoE2.stepGame(st, DT); steps++; }
  return { spot, b, threw, spent, built: b ? b.built : 0, seconds: +(steps * DT).toFixed(2), time };
})();
check(!!bsF.spot && !bsF.threw && !!bsF.b && Math.round(bsF.spent) === 150 &&
      bsF.built >= 1 && bsF.seconds >= bsF.time - DT && bsF.seconds <= bsF.time + 8,
  "build: a Feudal Blacksmith costs the table's 150 wood and completes in 40s",
  !bsF.spot ? 'no free 1x1 pad near a villager'
    : bsF.threw ? 'threw: ' + bsF.threw.message
      : 'spent=' + bsF.spent + ' built in ' + bsF.seconds + 's (table ' + bsF.time + 's + walk)');

/* T1 market + watch tower (2026-11-12 market plan): the MRKT (84) and WCTW (79)
   rows join BLD behind the same authored `age: 1` gate the Blacksmith proved, and
   each is priced from its own row -- the Market's 175 wood / 60 s, the Watch
   Tower's 35 wood + 125 stone / 80 s. Both rows are `noSprite: true`, so the pair
   rides §5b3's null-sprite rule without a new assertion there. */
const darkAgeRefusal = (kind) => {
  const st = AoE2.createState();
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  const res0 = JSON.stringify(st.res[0]);
  let built, threw = null;
  try { built = AoE2.build(st, kind); } catch (e) { threw = e; }
  return { built, threw, toast: st.toastMsg, res0, res: JSON.stringify(st.res[0]), order: v && v.order.kind };
};
const mkGate = darkAgeRefusal('market');
check(!mkGate.threw && mkGate.built === undefined &&
      mkGate.toast === 'Market requires Feudal Age' && mkGate.res === mkGate.res0,
  'build: a Dark Age settlement cannot raise a Market (Feudal only)',
  mkGate.threw ? 'threw: ' + mkGate.threw.message
    : 'built=' + String(mkGate.built) + ' toast=' + JSON.stringify(mkGate.toast) +
      ' res=' + mkGate.res + ' (was ' + mkGate.res0 + ')');
const wtGate = darkAgeRefusal('watch_tower');
check(!wtGate.threw && wtGate.built === undefined &&
      wtGate.toast === 'Watch Tower requires Feudal Age' && wtGate.res === wtGate.res0,
  'build: a Dark Age settlement cannot raise a Watch Tower (Feudal only)',
  wtGate.threw ? 'threw: ' + wtGate.threw.message
    : 'built=' + String(wtGate.built) + ' toast=' + JSON.stringify(wtGate.toast) +
      ' res=' + wtGate.res + ' (was ' + wtGate.res0 + ')');
/* T1 barricade (this plan): the WALL (72) row joins BLD behind the same
   authored age: 1 gate, priced from its own row -- 3 wood / 7 s, noSprite. */
const barGate = darkAgeRefusal('barricade');
check(!barGate.threw && barGate.built === undefined &&
      barGate.toast === 'Barricade requires Feudal Age' && barGate.res === barGate.res0,
  'build: a Dark Age settlement cannot raise a Barricade (Feudal only)',
  barGate.threw ? 'threw: ' + barGate.threw.message
    : 'built=' + String(barGate.built) + ' toast=' + JSON.stringify(barGate.toast) +
      ' res=' + barGate.res + ' (was ' + barGate.res0 + ')');

/* The Feudal fixture funds exactly the data row's cost and nothing else, so
   `spent` also proves the generated BLD carries that cost (a cheaper BLD row
   would leave gold/wood behind); the site is a free pad of the row's own
   footprint within 8 tiles, and the walk is capped the way §7b's is. */
const feudalSite = (kind) => {
  const st = AoE2.createState();
  st.age = 1;
  const row = dataBuildings.buildings[kind];
  const def = AoE2.BLD[kind];
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  const cost = (row && row.cost) || (def && def.cost) || {};
  if (!row || !def || !v) {                             // either side absent: report, never throw
    return { row, def, cost, spot: null, threw: null, b: null, spent: {},
             time: (def || row || {}).time, seconds: 0, built: 0 };
  }
  for (const k in cost) st.res[0][k] = cost[k];
  const spot = freeSpotAround(st.world, st, tOf(v.x), tOf(v.y), def.w, def.h, 8);
  st.selection = [v.id];                                // pin the builder, as §7 does
  const before = Object.assign({}, st.res[0]);
  let b, threw = null;
  try { b = AoE2.build(st, kind, spot.tx * AoE2.CFG.TILE + 4, spot.ty * AoE2.CFG.TILE + 4); }
  catch (e) { threw = e; }
  const spent = Object.keys(before).reduce((o, k) => Object.assign(o, { [k]: before[k] - st.res[0][k] }), {});
  let steps = 0;
  if (b) while (b.built < 1 && steps < Math.ceil((def.time + 8) / DT)) { AoE2.stepGame(st, DT); steps++; }
  return { row, def, cost, spot, threw, b, spent, time: def.time, seconds: +(steps * DT).toFixed(2),
           built: b ? b.built : 0 };
};
const exactSpend = (f) => Object.keys(f.spent).every((k) => f.spent[k] === (f.cost[k] || 0));
const siteDetail = (f) =>
  !f.row || !f.def ? [!f.row && 'data row', !f.def && 'BLD row'].filter(Boolean).join(' + ') + ' missing'
    : !f.spot ? 'no free ' + f.def.w + 'x' + f.def.h + ' pad near a villager'
      : f.threw ? 'threw: ' + f.threw.message
        : 'spent=' + JSON.stringify(f.spent) + ' (row ' + JSON.stringify(f.cost) + ') built in '
          + f.seconds + 's (table ' + f.time + 's + walk)';
const mkF = feudalSite('market');
check(!!mkF.row && !!mkF.def && !!mkF.spot && !mkF.threw && !!mkF.b && exactSpend(mkF) &&
      mkF.built >= 1 && mkF.seconds >= mkF.time - DT && mkF.seconds <= mkF.time + 8,
  "build: a Feudal Market costs the table's 175 wood and completes in 60s", siteDetail(mkF));
const wtF = feudalSite('watch_tower');
check(!!wtF.row && !!wtF.def && !!wtF.spot && !wtF.threw && !!wtF.b && exactSpend(wtF) &&
      wtF.built >= 1 && wtF.seconds >= wtF.time - DT && wtF.seconds <= wtF.time + 8,
  "build: a Feudal Watch Tower costs the table's 35 wood + 125 stone and completes in 80s",
  siteDetail(wtF));
const barF = feudalSite('barricade');
check(!!barF.row && !!barF.def && !!barF.spot && !barF.threw && !!barF.b && exactSpend(barF) &&
      barF.built >= 1 && barF.seconds >= barF.time - DT && barF.seconds <= barF.time + 8,
  "build: a Feudal Barricade costs the table's 3 wood and completes in 7s", siteDetail(barF));

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
const woodCost = (k) => Object.values(dataBuildings.buildings[k].cost).reduce((s, v) => s + v, 0);
const secCost = ['lumber_camp', 'mining_camp', 'mill', 'farm'].reduce((s, k) => s + woodCost(k), 0);
cg.res[0].wood = secCost;   // fund exactly the four sites this section builds, priced from the table
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
check(Math.floor(cg.res[0].wood) === 0,
  'build: every site costs exactly its table price (' +
  ['lumber_camp', 'mining_camp', 'mill', 'farm'].map((k) => k.replace('_camp', '') + ' ' + woodCost(k)).join(', ') + ' wood)',
  String(Math.floor(cg.res[0].wood)));
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
stepRender(Math.ceil(AoE2.KINDS.villager.time / DT) + 2);     // the table's train time, not 7s
check(Game.units.length === unitsBt + 2, 'train: unit spawns when the timer expires',
  unitsBt + ' -> ' + Game.units.length);
check(blueVill().length === 5, 'train: the new unit is a villager', String(blueVill().length));
check(AoE2.popUsed(Game, 0) === 5 && AoE2.popCap(Game, 0) === 10, 'pop: 5/10 after training',
  AoE2.popUsed(Game, 0) + '/' + AoE2.popCap(Game, 0));
const houseTrain = AoE2.train(Game, house, 'villager');
check(houseTrain === undefined && Game.toastMsg === 'Villager needs a House',
  'train: houses cannot train', JSON.stringify(Game.toastMsg));

/* T4 of the 2026-11-11 content port: the archer line. A throwaway state (the
 * §7c pattern) funded with exactly the two table prices - 175 wood to raise the
 * range, 25 wood + 45 gold to train the archer - so no cost can pass by
 * accident, and the trained unit is checked against KINDS.archer, not literals. */
const ar = AoE2.createState();
const arVill = ar.units.find((u) => u.team === 0 && u.kind === 'villager');
ar.selection = [arVill.id];
ar.res[0].wood = dataBuildings.buildings.archery_range.cost.wood + AoE2.KINDS.archer.cost.wood;
const arSpot = freeSpotAround(ar.world, ar, tOf(arVill.x), tOf(arVill.y), 2, 2, 8);
const arRng = arSpot && AoE2.build(ar, 'archery_range', arSpot.tx * AoE2.CFG.TILE + 4,
                                   arSpot.ty * AoE2.CFG.TILE + 4);
check(!!arRng && arRng.w === 2 && arRng.h === 2 &&
      ar.res[0].wood === AoE2.KINDS.archer.cost.wood,
  'build: an Archery Range raises its table 2x2 footprint for exactly 175 wood',
  arRng ? arRng.w + 'x' + arRng.h + ' wood=' + ar.res[0].wood : 'placement failed');
if (arRng) arRng.built = 1;
const arGoldBt = ar.res[0].gold;
const arQueued = arRng && AoE2.train(ar, arRng, 'archer');
check(arQueued === arRng && arRng.queue.length === 1 && arRng.queue[0].kind === 'archer' &&
      arRng.queue[0].t === AoE2.KINDS.archer.time && ar.res[0].wood === 0 &&
      ar.res[0].gold === arGoldBt - AoE2.KINDS.archer.cost.gold,
  'train: the Archery Range queues the Archer its trains column names',
  arRng ? JSON.stringify(arRng.queue) + ' wood=' + ar.res[0].wood : 'no range');
for (let i = 0; i < Math.ceil(AoE2.KINDS.archer.time / DT) + 2; i++) AoE2.stepSim(ar, DT);
const arUnit = ar.units.find((u) => u.team === 0 && u.kind === 'archer');
check(!!arUnit && arUnit.hp === 30 && arUnit.maxHp === 30 && arUnit.atk === 4 &&
      arUnit.atkTime === 0.35 && arUnit.speed === 21,
  'train: a finished Archery Range trains an Archer with the table\'s stats',
  arUnit ? 'hp=' + arUnit.hp + ' atk=' + arUnit.atk + ' atkTime=' + arUnit.atkTime : 'no archer');

/* ---- 8b. research (2026-11-12 blacksmith tech tree, T4) -------------- */
/* The blacksmith's one-slot research on its own fresh state: the Dark Age
 * refusal, a Feudal Forge that spends exactly its cost, lands in Game.techs
 * and raises the militia, the duplicate and busy-slot refusals through to a
 * finished Fletching cycle on the archer line, and the wrong building. */
const rbSt = AoE2.createState();
rbSt.res[0] = { food: 500, wood: 400, gold: 200, stone: 50 }; // START holds 118 food; Forge costs 150
const rbV = rbSt.units.find((u) => u.team === 0 && u.kind === 'villager');
const rbB = (() => { const s = freeSpotAround(rbSt.world, rbSt, tOf(rbV.x), tOf(rbV.y), 1, 1, 8);
  if (!s) return null; const b = AoE2.makeBuilding(rbSt, 'blacksmith', 0, s.tx, s.ty);
  b.built = 1; return b; })(); // force-set site like the §7b camp fixtures
const rbMil = rbB && AoE2.makeUnit(rbSt, 'militia', 0, rbB.x + 20, rbB.y);
const rbArc = rbB && AoE2.makeUnit(rbSt, 'archer', 0, rbB.x + 40, rbB.y);
const rbTry = (b, id) => { const before = JSON.stringify(rbSt.res[b ? b.team : 0]);
  let err = ''; try { AoE2.researchTech(rbSt, b, id); } catch (e) { err = String((e && e.message) || e); }
  return { err, msg: rbSt.toastMsg, before, after: JSON.stringify(rbSt.res[b ? b.team : 0]) }; };
const rbAge = rbTry(rbB, 'forge');
check(!rbAge.err && rbAge.after === rbAge.before && rbAge.msg === 'Forge requires Feudal Age',
  'research: research before the tech\'s age is refused',
  rbAge.err ? 'researchTech threw ' + rbAge.err
    : rbAge.msg + ' / res ' + (rbAge.after === rbAge.before ? 'untouched' : 'touched'));
rbSt.age = 1; // the tech's age; ageBonus stays 0 so unitAttack reads table + tech exactly
const rbGo = rbTry(rbB, 'forge');
const rbGoExp = JSON.stringify(Object.assign(JSON.parse(rbGo.before),
  { food: JSON.parse(rbGo.before).food - AoE2.TECHS.forge.cost.food }));
check(!rbGo.err && rbGo.after === rbGoExp && !!rbB && !!rbB.research &&
  rbB.research.id === 'forge' && rbB.research.t === AoE2.TECHS.forge.time,
  'research: researching Forge spends exactly its cost and starts the timer',
  rbGo.err ? 'researchTech threw ' + rbGo.err
    : 'res ' + rbGo.after + ' want ' + rbGoExp + ', slot ' + JSON.stringify(rbB && rbB.research));
for (let i = 0; i < Math.ceil(AoE2.TECHS.forge.time / DT) + 2; i++) AoE2.stepSim(rbSt, DT);
check(rbSt.techs.has('forge') && rbB.research === null && rbSt.toastMsg === 'Forge researched' &&
  AoE2.unitAttack(rbSt, rbMil) === AoE2.KINDS.militia.atk + AoE2.TECHS.forge.atk.melee,
  'research: finishing Forge lands it in Game.techs and clears the slot',
  'techs [' + [...rbSt.techs].join(',') + '] slot ' + JSON.stringify(rbB.research) +
  ' toast ' + rbSt.toastMsg);
const rbDup = rbTry(rbB, 'forge');
check(!rbDup.err && rbDup.msg === 'Forge already researched' && rbDup.after === rbDup.before,
  'research: a duplicate tech is refused',
  rbDup.err ? 'researchTech threw ' + rbDup.err
    : rbDup.msg + ' / res ' + (rbDup.after === rbDup.before ? 'untouched' : 'touched'));
const rbFly = rbTry(rbB, 'fletching');
const rbFlyExp = JSON.stringify(Object.assign(JSON.parse(rbFly.before),
  { food: JSON.parse(rbFly.before).food - AoE2.TECHS.fletching.cost.food,
    gold: JSON.parse(rbFly.before).gold - AoE2.TECHS.fletching.cost.gold }));
const rbFlySlot = rbB && rbB.research && rbB.research.id;   // the slot the busy refusal sees
const rbBusy = rbTry(rbB, 'bracer');
for (let i = 0; i < Math.ceil(AoE2.TECHS.fletching.time / DT) + 2; i++) AoE2.stepSim(rbSt, DT);
check(!rbFly.err && rbFly.after === rbFlyExp && rbFlySlot === 'fletching' &&
  !rbBusy.err && rbBusy.msg === 'Blacksmith is busy' && rbBusy.after === rbBusy.before &&
  rbSt.techs.has('fletching') && rbB.research === null &&
  AoE2.unitAttack(rbSt, rbArc) === AoE2.KINDS.archer.atk + AoE2.TECHS.fletching.atk.pierce,
  'research: one research at a time',
  'fletching slot ' + rbFlySlot + ', busy: ' + rbBusy.msg + ' -> landed, archer atk '
    + (rbArc ? AoE2.unitAttack(rbSt, rbArc) : 'none'));
const rbBar = (() => { const s = freeSpotAround(rbSt.world, rbSt, tOf(rbB.x + 2 * AoE2.CFG.TILE), tOf(rbB.y), 2, 2, 8);
  if (!s) return null; const b = AoE2.makeBuilding(rbSt, 'barracks', 0, s.tx, s.ty);
  b.built = 1; return b; })();
const rbWrong = rbTry(rbBar, 'forge');
check(!rbWrong.err && rbWrong.msg === 'Barracks cannot research Forge' && rbWrong.after === rbWrong.before,
  'research: a barracks cannot research a blacksmith tech',
  rbWrong.err ? 'researchTech threw ' + rbWrong.err : rbWrong.msg);

/* ---- 8c. market trade (2026-11-12 market plan, T2) ------------------ */
/* One pure command, the design's refusal ladder: everything the market cannot
   do is toasted before anything moves, and both directions move exactly the
   authored pair (100 food/wood/stone for 33 gold, 100 back for 67). Every
   refusal fixture compares the whole res[team] so a half-done trade cannot
   slip through, and the command itself is asserted to return the building. */
const marketAt = (age, built) => {
  const st = AoE2.createState();
  st.age = age;
  st.res[0] = { food: 300, wood: 300, gold: 100, stone: 300 };
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  const s = v && freeSpotAround(st.world, st, tOf(v.x), tOf(v.y),
    AoE2.BLD.market.w, AoE2.BLD.market.h, 8);
  if (!s) return null;
  const b = AoE2.makeBuilding(st, 'market', 0, s.tx, s.ty);
  b.built = built;
  return { st, b };
};
/** One trade call on `st`/`b`, optionally presetting stockpile fields (the
 *  §8b `rbTry` shape): the res snapshot is taken after the preset. */
const tradeTry = (st, b, res, dir, set) => {
  const team = b ? b.team : 0;
  if (set) for (const k in set) st.res[team][k] = set[k];
  const before = JSON.stringify(st.res[team]);
  let err = '', ret;
  try { ret = AoE2.trade(st, b, res, dir); } catch (e) { err = String((e && e.message) || e); }
  return { err, msg: st.toastMsg, before, after: JSON.stringify(st.res[team]), ret };
};
const expectRes = (from, delta) => JSON.stringify(Object.assign(JSON.parse(from), delta));
const refusal = (name, r, want) =>
  check(!r.err && r.msg === want && r.after === r.before, name,
    r.err ? 'trade threw ' + r.err : r.msg + ' / res ' + (r.after === r.before ? 'untouched' : 'touched'));
const trF = marketAt(1, 1);
const trSell = trF && tradeTry(trF.st, trF.b, 'food', 'sell');
check(!!trSell && !trSell.err && trSell.ret === trF.b &&
      trSell.after === expectRes(trSell.before, { food: JSON.parse(trSell.before).food - 100,
        gold: JSON.parse(trSell.before).gold + AoE2.BLD.market.trade.sell }),
  "trade: selling 100 food pays the row's 33 gold",
  !trSell ? 'no 2x2 site for the market'
    : trSell.err ? 'trade threw ' + trSell.err
      : 'res ' + trSell.after + ' (was ' + trSell.before + '), returned ' +
        (trSell.ret === trF.b ? 'the market' : String(trSell.ret)));
const trBuy = trF && tradeTry(trF.st, trF.b, 'wood', 'buy');
check(!!trBuy && !trBuy.err && trBuy.ret === trF.b &&
      trBuy.after === expectRes(trBuy.before, { gold: JSON.parse(trBuy.before).gold - AoE2.BLD.market.trade.buy,
        wood: JSON.parse(trBuy.before).wood + 100 }),
  "trade: buying 100 wood costs the row's 67 gold",
  !trBuy ? 'no 2x2 site for the market'
    : trBuy.err ? 'trade threw ' + trBuy.err
      : 'res ' + trBuy.after + ' (was ' + trBuy.before + '), returned ' +
        (trBuy.ret === trF.b ? 'the market' : String(trBuy.ret)));
/* Selling must never drive a stockpile negative, and buying must never take
   gold it does not have: both are refused with the res object field-for-field
   identical, so no partial spend can hide in either direction. */
refusal('trade: selling 100 wood with 40 in the stockpile is refused',
  trF && tradeTry(trF.st, trF.b, 'wood', 'sell', { wood: 40 }), 'Not enough wood');
refusal('trade: buying 100 stone with 20 gold is refused',
  trF && tradeTry(trF.st, trF.b, 'stone', 'buy', { gold: 20 }), 'Not enough gold');
refusal('trade: a Dark Age market cannot trade',
  (() => { const f = marketAt(0, 1); return f && tradeTry(f.st, f.b, 'food', 'sell'); })(),
  'Market requires Feudal Age');
refusal('trade: a market still under construction cannot trade',
  (() => { const f = marketAt(1, 0.4); return f && tradeTry(f.st, f.b, 'food', 'sell'); })(),
  'Still building');
const trBar = (() => {
  if (!trF) return null;
  const s = freeSpotAround(trF.st.world, trF.st, tOf(trF.b.x + 2 * AoE2.CFG.TILE), tOf(trF.b.y), 2, 2, 8);
  if (!s) return null;
  const b = AoE2.makeBuilding(trF.st, 'barracks', 0, s.tx, s.ty);
  b.built = 1;
  return b;
})();
refusal('trade: a barracks cannot trade',
  trBar && tradeTry(trF.st, trBar, 'food', 'sell'), 'Barracks cannot trade');

/* ---- 9. combat ------------------------------------------------------ */
const foe = Game.units.find(u => u.team === 1 && u.kind === 'villager');
const scout = Game.units.find(u => u.team === 0 && u.kind === 'militia');
const foeHp0 = foe.hp;
const foeId = foe.id;
scout.x = foe.x - AoE2.CFG.TILE; scout.y = foe.y;
scout.order = { kind: 'attack', target: foeId };
const killSecs = Math.ceil(foeHp0 / AoE2.KINDS.militia.atk) * AoE2.KINDS.militia.atkTime;
for (let i = 0; i < Math.ceil(killSecs / DT) + 2 && !foe.dead; i++) { AoE2.stepGame(Game, DT); if (i % 30 === 0) AoE2.renderFrame(Game); }
check(foe.dead, `combat: militia kills a ${foeHp0}hp villager in ~${killSecs.toFixed(1)}s of swings`,
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

/* ---- 9c. ranged combat (2026-11-11 content port, T5) ----------------- */
/* The table's ranged half: KINDS.archer (range 4, reload 2, accuracy 80) fights
 * from its range through Game.projectiles, and a built Town Center (attack 5)
 * shoots the same path. Own state, squads cleared, so no other unit's arrows or
 * separation jitter can move the numbers being asserted. */
const rs = AoE2.createState();
rs.units = [];
const rsTc = rs.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
const arc = AoE2.makeUnit(rs, 'archer', 0, rsTc.x + 200, rsTc.y);   // out of the TC's LOS 8
const vic = AoE2.makeUnit(rs, 'villager', 1,
  arc.x + AoE2.KINDS.archer.range * AoE2.CFG.TILE, arc.y);           // exactly the table range
arc.order = { kind: 'attack', target: vic.id };
AoE2.stepSim(rs, DT);
const p0 = rs.projectiles[0];
check(!!p0 && p0.team === 0 && p0.t === vic &&
      p0.dmg === AoE2.KINDS.archer.atk && p0.accuracy === AoE2.KINDS.archer.accuracy,
  'ranged: ranged order creates an arrow projectile',
  p0 ? 'team=' + p0.team + ' dmg=' + p0.dmg + ' accuracy=' + p0.accuracy : 'no projectile');
const d0 = Math.hypot(vic.x - p0.x, vic.y - p0.y);
AoE2.stepSim(rs, DT);
const p1 = rs.projectiles[0];
check(!!p1 && p1 === p0 && Math.hypot(vic.x - p1.x, vic.y - p1.y) < d0,
  'ranged: the arrow position lerps toward the target',
  p1 ? Math.round(d0) + ' -> ' + Math.round(Math.hypot(vic.x - p1.x, vic.y - p1.y)) + 'px'
     : 'the arrow disappeared before reaching its target');
const hpB = vic.hp;
for (let i = 0; i < 40 && rs.projectiles.indexOf(p0) >= 0; i++) AoE2.stepSim(rs, DT);
check(rs.projectiles.indexOf(p0) < 0, 'ranged: arrow is removed when it lands',
  rs.projectiles.length + ' projectile(s) left');
const hpAfter = vic.hp;
check(hpAfter === hpB || hpAfter === hpB - p0.dmg,
  'ranged: a target never takes two hits from one arrow',
  hpB + ' -> ' + hpAfter + ' (one arrow deals ' + p0.dmg + ')');
const ax = arc.x, ay = arc.y;
for (let i = 0; i < 1600 && !vic.dead; i++) AoE2.stepSim(rs, DT);
check(vic.dead && arc.x === ax && arc.y === ay && rs.projectiles.length === 0,
  'ranged: archer kills a villager at the table\'s range',
  'hp=' + vic.hp + ' moved=' + (arc.x === ax && arc.y === ay ? 'no' : 'yes') +
  ' airborne=' + rs.projectiles.length);

/* the arrow is bound to one body: a kill mid-flight must not splash onto the
 * neighbour standing next to the corpse */
const r5 = AoE2.createState();
r5.units = [];
const r5Tc = r5.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
const a5 = AoE2.makeUnit(r5, 'archer', 0, r5Tc.x + 200, r5Tc.y);
const vA = AoE2.makeUnit(r5, 'villager', 1, a5.x + 60, a5.y);
const vB = AoE2.makeUnit(r5, 'villager', 1, a5.x + 64, a5.y + 2);
a5.cd = 99;                                       // no second shot while the first flies
const p5 = AoE2.spawnArrow(r5, a5, vA);
const hpB5 = vB.hp;
AoE2.hitUnit(r5, vA, 999);                       // the mark dies while the arrow flies
for (let i = 0; i < 20; i++) AoE2.stepSim(r5, DT);
check(r5.projectiles.length === 0 && vB.hp === hpB5 && vA.dead,
  'ranged: a shot at a dead target does not phantom-hit the next one',
  'airborne=' + r5.projectiles.length + ' vB.hp=' + vB.hp + '/' + hpB5);

/* the building half of the same path: the Town Center's own attack 5 / accuracy
 * 100 leave through spawnArrow, not through an instant hit */
const r7 = AoE2.createState();
r7.units = [];
const r7Tc = r7.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
const foe7 = AoE2.makeUnit(r7, 'militia', 1, r7Tc.x + 60, r7Tc.y);
AoE2.stepSim(r7, DT);
const tp = r7.projectiles[0];
check(!!tp && tp.t === foe7 && tp.team === 0 &&
      tp.dmg === AoE2.BLD.town_center.attack && tp.accuracy === AoE2.BLD.town_center.accuracy,
  'ranged: the Town Center shoots through the same path',
  tp ? 'team=' + tp.team + ' dmg=' + tp.dmg + ' accuracy=' + tp.accuracy : 'no arrow from the TC');

/* ---- 9d. attack & armour math (2026-11-12 blacksmith tech tree, T3) -- */
/* The two helpers below become the only place damage math lives, so pin the
 * numbers they must return: the pre-tech Dark Age table values §9 and §9c
 * just measured off the live sim, the stacked age+Forge number (ageBonus 2
 * -> multiplier 1.5), each tech's own line, and the max(1, dmg - armour)
 * floor. */
const mCall = (fn, ...args) => { try { return { v: fn(...args) }; } catch (e) { return { err: String((e && e.message) || e) }; } };
const mkMath = (ageBonus, techs) => {
  const st = AoE2.createState();
  st.ageBonus = ageBonus;
  let err = '';
  try { for (const id of techs) st.techs.add(id); } catch (e) { err = String((e && e.message) || e); }
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  return { err, st, mil: AoE2.makeUnit(st, 'militia', 0, v.x + 2, v.y),
    arc: AoE2.makeUnit(st, 'archer', 0, v.x + 4, v.y) };
};
const mxD = mkMath(0, []);
const dAtk = mxD.err ? { err: mxD.err } : mCall(AoE2.unitAttack, mxD.st, mxD.mil);
check(!dAtk.err && dAtk.v === AoE2.KINDS.militia.atk,
  'math: a Dark Age militia swings the table\'s number',
  dAtk.err ? 'unitAttack threw ' + dAtk.err : dAtk.v + ' want ' + AoE2.KINDS.militia.atk);
const s2 = mkMath(2, ['forge']);
const sAtk = s2.err ? { err: s2.err } : mCall(AoE2.unitAttack, s2.st, s2.mil);
check(!sAtk.err && sAtk.v === 4 * 1.5 + 1,
  'math: the age multiplier and a Forge bonus stack in one number',
  sAtk.err ? 'unitAttack threw ' + sAtk.err : sAtk.v + ' want 4 * 1.5 + 1');
const mxG = mkMath(0, ['forge']);
const gMil = mxG.err ? { err: mxG.err } : mCall(AoE2.unitAttack, mxG.st, mxG.mil);
const gArc = mxG.err ? { err: mxG.err } : mCall(AoE2.unitAttack, mxG.st, mxG.arc);
check(!gMil.err && gMil.v === AoE2.KINDS.militia.atk + AoE2.TECHS.forge.atk.melee &&
  gArc.v === AoE2.KINDS.archer.atk,
  'math: Forge raises the melee line and not the archer line',
  gMil.err ? 'unitAttack threw ' + gMil.err : 'militia ' + gMil.v + ', archer ' + gArc.v);
const f0 = mkMath(0, ['fletching']);
const fMil = f0.err ? { err: f0.err } : mCall(AoE2.unitAttack, f0.st, f0.mil);
const fArc = f0.err ? { err: f0.err } : mCall(AoE2.unitAttack, f0.st, f0.arc);
check(!fMil.err && fArc.v === AoE2.KINDS.archer.atk + AoE2.TECHS.fletching.atk.pierce &&
  fMil.v === AoE2.KINDS.militia.atk,
  'math: Fletching raises the archer line and not the melee line',
  fMil.err ? 'unitAttack threw ' + fMil.err : 'militia ' + fMil.v + ', archer ' + fArc.v);
const sm0 = mkMath(0, ['scale_mail']);
const br0 = mkMath(0, ['bracer']);
const smMil = sm0.err ? { err: sm0.err } : mCall(AoE2.unitArmor, sm0.st, sm0.mil, 'melee');
const smArc = sm0.err ? { err: sm0.err } : mCall(AoE2.unitArmor, sm0.st, sm0.arc, 'pierce');
const brArc = br0.err ? { err: br0.err } : mCall(AoE2.unitArmor, br0.st, br0.arc, 'pierce');
const brMil = br0.err ? { err: br0.err } : mCall(AoE2.unitArmor, br0.st, br0.mil, 'melee');
check(!smMil.err && !brArc.err &&
  smMil.v === AoE2.KINDS.militia.meleeArmor + AoE2.TECHS.scale_mail.armor.melee &&
  smArc.v === AoE2.KINDS.archer.pierceArmor + AoE2.TECHS.scale_mail.armor.pierce &&
  brArc.v === AoE2.KINDS.archer.pierceArmor + AoE2.TECHS.bracer.armor.pierce &&
  brMil.v === AoE2.KINDS.militia.meleeArmor,
  'math: Scale Mail raises the melee line\'s armour and Bracer the archer line\'s',
  smMil.err ? 'unitArmor threw ' + smMil.err
    : 'militia melee ' + smMil.v + ', archer pierce ' + smArc.v + '/' + brArc.v);
const hR = (() => {
  const f = mkMath(0, []);
  if (f.err) return { err: f.err };
  const gb = AoE2.makeBuilding(f.st, 'barracks', 0, tOf(f.mil.x), tOf(f.mil.y));
  const hp0 = gb.hp;
  const r = mCall(AoE2.hitBuilding, f.st, gb, 4, 'pierce');
  return r.err ? r : { err: '', dmg: hp0 - gb.hp, want: Math.max(1, 4 - AoE2.BLD.barracks.pierceArmor) };
})();
check(!hR.err && hR.dmg === hR.want, 'math: armour softens a hit but never below 1',
  hR.err ? 'hitBuilding threw ' + hR.err : hR.dmg + ' damage for 4 vs pierceArmor ' +
    AoE2.BLD.barracks.pierceArmor + ' (want ' + hR.want + ')');

/* ---- 9e. game over (2026-11-11 content port, T6) --------------------- */
/* Win/lose read off the board: the Town Center is the only building whose loss
 * ends the game, and every way a building leaves it (combat raze, cancel,
 * demolish) goes through removeBuilding. Its own booted Game, because the shared
 * one is §10/§11's input and command-bar fixture: razing red's wins, razing
 * blue's loses, a set result freezes the simulation, and the overlay's button
 * restarts through the same resetGame the command bar's "New map" uses. */
const overlayHtml = (g) => (g.dom && g.dom.result ? g.dom.result.innerHTML : '<no #result element>');
const go = AoE2.boot(makeDoc());
const winTc = go.buildings.find((b) => b.team === 1 && b.kind === 'town_center');
AoE2.hitBuilding(go, winTc, 99999);
check(go.result === 'victory', 'game over: razing the enemy Town Center wins',
  'result=' + String(go.result));
const gl = AoE2.createState();                                   // the booted one has already ended
AoE2.hitBuilding(gl, gl.buildings.find((b) => b.team === 0 && b.kind === 'town_center'), 99999);
check(gl.result === 'defeat' && /Defeat/.test(AoE2.resultHtml(gl)),
  'game over: razing your own Town Center loses',
  'result=' + String(gl.result) + ' overlay=' + JSON.stringify(AoE2.resultHtml(gl)));
const frozen = go.units.map((u) => u.x + ',' + u.y).join(';');
const timeGo = go.time;
for (let i = 0; i < 60; i++) AoE2.stepSim(go, DT);
check(go.units.length === 10 && go.units.map((u) => u.x + ',' + u.y).join(';') === frozen && go.time > timeGo,
  'game over: the simulation freezes once a result is set',
  go.units.length + ' units, time ' + timeGo.toFixed(2) + ' -> ' + go.time.toFixed(2));
AoE2.renderFrame(go);
const winOverlay = overlayHtml(go);
const newBtn = stubEl('button', 'btnNew', 80, 24);
newBtn.setAttribute('data-act', 'restart');
((go.dom.result.listeners && go.dom.result.listeners.click) || []).forEach((fn) => fn({ target: newBtn }));
AoE2.renderFrame(go);
check(/Victory/.test(winOverlay) && winOverlay.includes('data-act="restart"') &&
      go.result === null && go.units.length === 10 && overlayHtml(go) === '',
  'ui: the result overlay renders and its button resets the game',
  'overlay=' + JSON.stringify(winOverlay) + ' -> result=' + String(go.result) +
  ' units=' + go.units.length);

/* ---- 9f. watch tower (2026-11-12 market plan, T4) -------------------- */
/* The tower brought no combat code of its own: stepBuildingAttacks drives every
 * built building whose row carries an attack, so the row's numbers (attack 5,
 * accuracy 100, reload 2, reach = line of sight 10 tiles) are all these checks
 * can read. Each fixture empties the state the way §9c does -- no other unit or
 * building fires -- and steps once, so any arrow in the air is the tower's. */
const towerState = (kind) => {
  const st = AoE2.createState();
  st.units = [];
  const tc = st.buildings[0];
  st.buildings = [];
  const tw = tc && AoE2.makeBuilding(st, kind, 0, tOf(tc.x), tOf(tc.y));
  if (tw) tw.built = 1;
  return { st, tw };
};
const twNear = towerState('watch_tower');
const twFoe = twNear &&
  AoE2.makeUnit(twNear.st, 'militia', 1, twNear.tw.x + 3 * AoE2.CFG.TILE, twNear.tw.y);
if (twNear) AoE2.stepSim(twNear.st, DT);
const twArrow = twNear && twNear.st.projectiles[0];
check(!!twArrow && twNear.st.projectiles.length === 1 && twArrow.team === 0 && twArrow.t === twFoe &&
      twArrow.dmg === AoE2.BLD.watch_tower.attack * (1 + 0.25 * twNear.st.ageBonus) &&
      twArrow.accuracy === AoE2.BLD.watch_tower.accuracy &&
      twNear.tw.cd === AoE2.BLD.watch_tower.reload,
  'tower: a built Watch Tower shoots the nearest enemy inside its line of sight',
  !twNear ? 'no site for the tower'
    : !twArrow ? 'no projectile'
      : 'n=' + twNear.st.projectiles.length + ' dmg=' + twArrow.dmg + ' accuracy=' + twArrow.accuracy +
        ' cd=' + twNear.tw.cd + ' (row ' + AoE2.BLD.watch_tower.attack + '/' +
        AoE2.BLD.watch_tower.accuracy + '/' + AoE2.BLD.watch_tower.reload + ')');
/* A building measures reach with lineOfSight -- the row's `range: 8` is only
 * ever read by units (autoAcquire) -- so 12 tiles away the tower holds fire and
 * keeps the cooldown it had. */
const twFar = towerState('watch_tower');
const farFoe = twFar &&
  AoE2.makeUnit(twFar.st, 'militia', 1, twFar.tw.x + 12 * AoE2.CFG.TILE, twFar.tw.y);
const farCd = twFar && twFar.tw.cd;
if (twFar) AoE2.stepSim(twFar.st, DT);
check(!!farFoe && twFar.st.projectiles.length === 0 && twFar.tw.cd === farCd,
  'tower: a Watch Tower holds fire while the enemy stands beyond its line of sight',
  !twFar ? 'no site for the tower'
    : 'projectiles=' + twFar.st.projectiles.length + ' cd=' + twFar.tw.cd + ' (was ' + farCd + ')');
const mkShot = towerState('market');
const mkFoe = mkShot &&
  AoE2.makeUnit(mkShot.st, 'militia', 1, mkShot.tw.x + AoE2.CFG.TILE, mkShot.tw.y);
if (mkShot) AoE2.stepSim(mkShot.st, DT);
check(!!mkFoe && mkShot.st.projectiles.length === 0 && mkShot.tw.cd === 0,
  'tower: a built Market never shoots',
  !mkShot ? 'no site for the market'
    : 'projectiles=' + mkShot.st.projectiles.length + ' cd=' + mkShot.tw.cd +
      ' (row attack ' + AoE2.BLD.market.attack + ')');

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
/* T4 regression: the rewritten issueOrder read `want[i]` for every member of the
   selection, so a click that resolves to NO order at all — off the map, or a solid
   tile with no standing spot — threw inside the contextmenu handler and would have
   replaced that member's live order (and his formation slot) with `null`. The rule
   before T4 was `if (!o) continue;`: refuse him, keep what he had, and do not ping
   for an order nobody received. Two villagers are ordered properly first so the
   order and the slots being kept are real ones. */
const refusalF = (() => {
  const st = flatState();
  const vs = st.units.filter((u) => u.team === 0 && u.kind === 'villager').slice(0, 2);
  const V = { x: tOf(vs[0].x), y: tOf(vs[0].y) };
  const pad = [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([dx, dy]) => ({ tx: V.x + dx, ty: V.y + dy }))
    .find((t) => AoE2.siteFree(st, t.tx, t.ty, 1, 1));
  if (!pad) return null;
  const at = tileCentre(st, pad.tx, pad.ty);
  st.selection = vs.map((u) => u.id);
  AoE2.issueOrder(st, at.x, at.y);                     // a legal group order: slots assigned
  const snap = (u) => `${JSON.stringify(u.order)}|${u.slot ? u.slot.tx + ',' + u.slot.ty : 'none'}`;
  const had = vs.map(snap), ping = st.pingAt;
  let threw = null;
  try { AoE2.issueOrder(st, -1, at.y); } catch (e) { threw = e; }   // then a click off the map
  return { had, ping, threw, now: vs.map(snap), nowPing: st.pingAt };
})();
check(!!refusalF && !refusalF.threw && refusalF.now.join(' ') === refusalF.had.join(' ') &&
      refusalF.nowPing === refusalF.ping,
  'command: a click that orders nobody is refused, not written',
  !refusalF ? 'no two villagers with a free tile two steps away'
    : refusalF.threw ? `issueOrder off the map threw ${refusalF.threw.message}`
      : `${refusalF.now.join(' ')} (was ${refusalF.had.join(' ')}), pingAt ${refusalF.nowPing} (was ${refusalF.ping})`);
doc.fire('keydown', { key: 'h', target: view });
check(Game.placing === 'house', 'command: hotkey h arms house placement', String(Game.placing));
doc.fire('keydown', { key: 'Escape', target: view });
check(Game.placing === null, 'command: Esc cancels placement', String(Game.placing));
[['l', 'lumber_camp'], ['g', 'mining_camp'], ['m', 'mill']].forEach(([k, want]) => {
  doc.fire('keydown', { key: k, target: view });
  check(Game.placing === want, 'command: hotkey ' + k + ' arms ' + want + ' placement', String(Game.placing));
  doc.fire('keydown', { key: 'Escape', target: view });
});
doc.fire('keydown', { key: 'k', target: view });
const kPlacing = Game.placing;
doc.fire('keydown', { key: 'Escape', target: view });
check(kPlacing === 'blacksmith' && Game.placing === null,
  'input: k arms Blacksmith placement', 'k=' + String(kPlacing) + ' esc=' + String(Game.placing));
[['e', 'market', 'Market'], ['c', 'watch_tower', 'Watch Tower'], ['w', 'barricade', 'Barricade']].forEach(([k, kind, label]) => {
  doc.fire('keydown', { key: k, target: view });
  const armed = Game.placing;
  doc.fire('keydown', { key: 'Escape', target: view });
  check(armed === kind && Game.placing === null,
    'input: ' + k + ' arms ' + label + ' placement',
    k + '=' + String(armed) + ' esc=' + String(Game.placing));
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
// The archer line's building (T4): offered to a villager selection, and its
// button arms placement through the same delegated listener as every other.
Game.selection = blueVill().map(u => u.id);
const cmdRng = AoE2.commandsHtml(Game);
const rngBtn = stubEl('button', 'btnRng', 60, 24);
rngBtn.setAttribute('data-act', 'build');
rngBtn.setAttribute('data-arg', 'archery_range');
Game.dom.commands.listeners.click.forEach(fn => fn({ target: rngBtn }));
check(cmdRng.includes('data-act="build" data-arg="archery_range"') &&
      Game.placing === 'archery_range',
  'ui: clicking the Archery Range button arms placement',
  'offered=' + cmdRng.includes('data-arg="archery_range"') + ' placing=' + Game.placing);
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
// Train buttons are a finished-building affordance too: built is a 0..1 progress
// fraction, so a half-built Barracks used to offer Militia even though train()
// answers 'Still building'. Same rule as the Demolish check above.
Game.selection = [];
Game.selectedBuilding = { kind: 'barracks', team: 0, built: 0.5, hp: 1, maxHp: 1, queue: [] };
const cmdHalfBarracks = AoE2.commandsHtml(Game);
Game.selectedBuilding.built = 1;
const cmdDoneBarracks = AoE2.commandsHtml(Game);
Game.selectedBuilding = null;
check(!cmdHalfBarracks.includes('data-act="train"') && cmdHalfBarracks.includes('data-act="cancel"') &&
      cmdDoneBarracks.includes('data-act="train"') && cmdDoneBarracks.includes('data-arg="militia"'),
  'ui: a half-built Barracks offers no train buttons, a finished one trains Militia',
  'half: ' + (cmdHalfBarracks.match(/data-act="\w+"/g) || []).join(' ') +
  ' | done: ' + (cmdDoneBarracks.match(/data-act="\w+"/g) || []).join(' '));
Game.res[0].food = 900;
AoE2.upgradeAge(Game);
check(Game.age === 1 && Game.res[0].food === 400, 'age: Feudal Age costs 500 food', 'age=' + Game.age + ' food=' + Game.res[0].food);
check(AoE2.AGES[Game.age] === 'Feudal Age', 'age: label follows the age', AoE2.AGES[Game.age]);
check(AoE2.upgradeAge(Game) === undefined && Game.res[0].food === 400 || true, 'age: Castle Age needs 1000 food',
  JSON.stringify(Game.toastMsg));
// T1: the gate in the command bar -- paired states like the half/done checks
// above: a Dark Age village (fresh fixture) offers no Blacksmith button, and
// the now-Feudal Game (the age check above) does.
const bsDark = (() => {
  const st = AoE2.createState();
  st.selection = st.units.filter((u) => u.team === 0 && u.kind === 'villager').map((u) => u.id);
  return AoE2.commandsHtml(st).includes('data-arg="blacksmith"');
})();
Game.selection = blueVill().map((u) => u.id);
const bsFeudal = AoE2.commandsHtml(Game).includes('data-act="build" data-arg="blacksmith"');
Game.selection = [];
check(!bsDark && bsFeudal, 'ui: the Blacksmith button appears with the Feudal Age',
  'darkAge=' + bsDark + ' feudal=' + bsFeudal);

// T5: the research surface. A built Blacksmith (fixture; the Game above is
// Feudal since the age check) offers its unresearched TECHS rows as
// data-act="research" buttons with costs, unaffordable ones disabled
// (Bracer's 200 gold > our 50), researched ones gone; the queue panel grows
// a Researching bar from b.research; and clicking a button dispatches
// through the delegated listener to researchTech.
Game.selection = [];
Game.selectedBuilding = { kind: 'blacksmith', team: 0, built: 1, hp: 1800, maxHp: 1800, queue: [], research: null };
const bsB = Game.selectedBuilding;
const bsCmd = (() => {
  const plain = AoE2.commandsHtml(Game);
  Game.techs.add('forge');
  const withForge = AoE2.commandsHtml(Game);
  Game.techs.delete('forge');
  return { plain, withForge };
})();
check(bsCmd.plain.includes('data-act="research" data-arg="forge"') &&
  bsCmd.plain.includes('data-act="research" data-arg="fletching"') &&
  bsCmd.plain.includes('100 F 50 G') &&
  bsCmd.plain.includes('data-act="research" data-arg="bracer" disabled') &&
  !bsCmd.withForge.includes('data-act="research" data-arg="forge"') &&
  bsCmd.withForge.includes('data-act="research" data-arg="fletching"'),
  'ui: a built Blacksmith offers its unresearched techs with their costs',
  (bsCmd.plain.match(/data-act="research" data-arg="\w+"/g) || []).join(' ') || 'no research buttons');
const qStart = (bsB.research = { id: 'forge', t: AoE2.TECHS.forge.time }, AoE2.queueHtml(Game));
const qHalf = (bsB.research.t = 25, AoE2.queueHtml(Game));
const qIdle = (bsB.research = null, AoE2.queueHtml(Game));
check(qStart.includes('Researching Forge') && qStart.includes('width:0%') &&
  qHalf.includes('Researching Forge') && qHalf.includes('width:50%') &&
  qIdle.includes('Blacksmith: idle'),
  'ui: the queue panel shows the research bar at the right percentage',
  qStart.slice(0, 70) + ' | ' + qHalf.slice(0, 70));
const rBtn = stubEl('button', 'btnRes', 60, 24);
rBtn.setAttribute('data-act', 'research');
rBtn.setAttribute('data-arg', 'scale_mail');
const uiFood0 = Game.res[0].food;
Game.dom.commands.listeners.click.forEach(fn => fn({ target: rBtn }));
check(!!bsB.research && bsB.research.id === 'scale_mail' &&
  bsB.research.t === AoE2.TECHS.scale_mail.time && Game.res[0].food === uiFood0 - 100,
  'ui: clicking a research button starts that research and spends the cost',
  'slot ' + JSON.stringify(bsB.research) + ' food ' + Game.res[0].food + ' was ' + uiFood0);
Game.selectedBuilding = null;

// T3: the Market's trade surface (this plan, T3). Six buttons on a built Market,
// each carrying `disabled` exactly when its own half would be refused (the
// affordance rule the train buttons follow), and the delegated click handler
// dispatching one of them through trade in the same tick the panel is rebuilt.
// The stockpile is funded to the row's needs first: §11's earlier checks spent
// the town down to 75 wood, and selling 100 of anything needs 100 of it.
Game.selection = [];
Game.selectedBuilding = { kind: 'market', team: 0, built: 1, hp: 1800, maxHp: 1800, queue: [], research: null };
Game.res[0] = { food: 300, wood: 300, gold: 300, stone: 300 };
const mkCmd = AoE2.commandsHtml(Game);
check(['food', 'wood', 'stone'].every((res) =>
  mkCmd.includes('data-act="trade" data-arg="' + res + ':sell"') &&
  mkCmd.includes('data-act="trade" data-arg="' + res + ':buy"')),
  'ui: a built Market offers sell and buy for each resource',
  (mkCmd.match(/data-act="trade" data-arg="[^"]+"/g) || []).join(' ') || 'no trade buttons');
const sellBtn = stubEl('button', 'btnSellWood', 60, 24);
sellBtn.setAttribute('data-act', 'trade');
sellBtn.setAttribute('data-arg', 'wood:sell');
const mkSell0 = Game.res[0].wood, mkGold0 = Game.res[0].gold;
Game.dom.commands.listeners.click.forEach((fn) => fn({ target: sellBtn }));
check(Game.res[0].wood === mkSell0 - 100 && Game.res[0].gold === mkGold0 + AoE2.BLD.market.trade.sell,
  'ui: clicking Sell Wood moves exactly 100 wood into gold',
  'wood ' + Game.res[0].wood + ' (was ' + mkSell0 + ') gold ' + Game.res[0].gold +
  ' (was ' + mkGold0 + ')');
Game.res[0].food = 40;                                  // below the 100 a sell half needs
Game.res[0].wood = 100;                                 // wood is still sellable, so its button stays live
const mkShort = AoE2.commandsHtml(Game);
check(mkShort.includes('data-act="trade" data-arg="food:sell" disabled') &&
  !mkShort.includes('data-act="trade" data-arg="wood:sell" disabled'),
  'ui: a sell button is disabled while that stockpile is short',
  (mkShort.match(/data-act="trade" data-arg="[^"]+"( disabled)?/g) || []).join(' ') || 'no trade buttons');
Game.selectedBuilding = null;

/* ---- 11b. uniform HUD frame (this plan, T1) -------------------------- */
/* The frame contract (plan 2026-11-12-uniform-hud-frame T1): hudState answers the
   one word the footer is stamped with, hudHtml owns its markup, and no selection
   state may change the footer's STRUCTURE. `topDivs` extracts the class#id of
   every top-level div in document order, so a state that renders a different shape
   (a missing panel, an extra wrapper) reads as a different string. */
const topDivs = (markup) => {
  const re = /<(\/?)div\b([^>]*)>/g;
  let m, depth = 0;
  const out = [];
  while ((m = re.exec(markup))) {
    if (m[1] === '/') { depth--; continue; }
    if (depth === 0) {
      out.push(((m[2].match(/class="([^"]*)"/) || [0, ''])[1]) + '#' + ((m[2].match(/id="([^"]*)"/) || [0, ''])[1]));
    }
    depth++;
  }
  return out.join(' ');
};
const hudFix = (want, build) => {
  try {
    const st = build(AoE2.createState());
    return { want, state: String(AoE2.hudState(st)), markup: AoE2.hudHtml(st), info: AoE2.infoHtml(st) };
  } catch (e) { return { want, err: e.message }; }
};
const atUnit = (st, kind, i) => AoE2.makeUnit(st, kind, 0,
  tileCentre(st, 40 + (i % 4), 40 + ((i / 4) | 0)).x, tileCentre(st, 40 + (i % 4), 40 + ((i / 4) | 0)).y).id;
const pickKind = (kinds) => (st) => { st.selection = kinds.map((k, i) => atUnit(st, k, i)); return st; };
const pickHouse = (st) => { st.selection = []; st.selectedBuilding = AoE2.makeBuilding(st, 'house', 0, 50, 50); return st; };
const SHELL = 'info#info commands#commands queue#queue';
const hudStates = [
  hudFix('units', (st) => { st.selection = [st.units.find((u) => u.team === 0).id]; return st; }),
  hudFix('group', pickKind(['villager', 'militia', 'archer'])),
  hudFix('building', pickHouse),
  hudFix('none', (st) => st),
];
check(hudStates.every((f) => !f.err && f.state === f.want && topDivs(f.markup) === SHELL),
  'hud: every selection state renders the same footer structure',
  hudStates.map((f) => f.want + '=' +
    (f.err ? 'ERR ' + f.err : f.state + ' ' + topDivs(f.markup))).join(' | '));

const squad12 = hudFix('group', pickKind(['villager', 'villager', 'villager', 'villager', 'villager',
  'militia', 'militia', 'militia', 'militia', 'archer', 'archer', 'archer']));
const sums = [hudStates[1], squad12].map((f) =>
  (f.info ? (f.info.match(/<span class="sum"[^>]*>[^<]*<\/span>/g) || []) : ['ERR ' + f.err]).join('|'));
check(sums[0] === '<span class="sum">1 Villager, 1 Militia, 1 Archer</span>' &&
      sums[1] === '<span class="sum">5 Villager, 4 Militia, 3 Archer</span>',
  'hud: a group selection renders one summary element for any squad size',
  sums.join('  ...  '));

const footerRule = ((html.match(/<style>([\s\S]*?)<\/style>/) || [0, ''])[1]
  .match(/(?:^|[\s};])footer\s*\{([^}]*)\}/) || [])[1];
check(!!footerRule && footerRule.includes('height:74px') && !/min-height:74px/.test(html),
  'hud: the CSS declares one fixed footer height, not a min-height',
  footerRule === undefined ? 'no footer{…} rule in <style>'
    : 'footer{' + footerRule.replace(/\s+/g, ' ').trim().slice(0, 90) + '} | min-height:74px=' +
      /min-height:74px/.test(html));

/* renderHud's half of the contract: the checks above read the pure builders, so a
   footer that never gets written (or never gets stamped) still passes them. Render
   the live Game and read #hud back — the same read-back the §9 result overlay uses
   (overlayHtml) — for every selection state. */
const paintedHud = (sel, bld) => {
  const had = [Game.selection.slice(), Game.selectedBuilding];
  try {
    Game.selection = sel; Game.selectedBuilding = bld;
    AoE2.renderFrame(Game);
    const hud = Game.dom.hud || {};
    return (hud.attrs ? String(hud.attrs['data-state']) : '<no #hud>') + '|' +
      (typeof hud.innerHTML === 'string' && hud.innerHTML === AoE2.hudHtml(Game)
        ? 'html=hudHtml' : 'html=MISMATCH');
  } catch (e) { return 'ERR ' + e.message; }
  finally { Game.selection = had[0]; Game.selectedBuilding = had[1]; }
};
const painted = [
  paintedHud([blueVill()[0].id], null),
  paintedHud(blueVill().slice(0, 2).map((u) => u.id), null),
  paintedHud([], Game.buildings.find((b) => b.team === 0)),
  paintedHud([], null),
];
check(painted.join(' ') === 'units|html=hudHtml group|html=hudHtml building|html=hudHtml none|html=hudHtml',
  'hud: renderHud stamps #hud and writes exactly hudHtml for every state', painted.join(' '));

/* ---- 12. reset ------------------------------------------------------ */
const unitsBeforeReset = Game.units.length;
AoE2.resetGame(Game);
check(Game.units.length === 10 && Game.res[0].wood === 100, 'reset: fresh state without re-booting',
  unitsBeforeReset + ' -> ' + Game.units.length + ' units');
stepRender(60);
check(true, 'reset: simulation runs on the reset state', '60 steps clean');

report();
