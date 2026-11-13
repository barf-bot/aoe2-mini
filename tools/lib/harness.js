'use strict';
/* harness.js -- what every file in tools/checks/ starts from.

   Requiring this module installs a stub DOM (document / window / localStorage /
   Image) on `global`, loads the game through load-game.js -- which boots it
   against those stubs -- and exports the booted `Game`, the `AoE2` surface, the
   check bookkeeping (check / ok / bad / report) and the fixtures more than one
   check file needs. Each check file runs in its own process, so each one gets
   its own freshly booted Game: nothing a file does can leak into another. */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const gameLoader = require('./load-game.js');

const TOOLS_DIR = path.join(__dirname, '..');

const HTML = path.join(TOOLS_DIR, '..', 'index.html');
const html = fs.readFileSync(HTML, 'utf8');   // the markup
const SCRIPT_FILES = gameLoader.scriptFiles(HTML);   // the <script src> list, in load order
const scriptSrc = gameLoader.scriptSource(HTML);     // every game script, concatenated
const styleCss = gameLoader.styleSource(HTML);       // the linked stylesheet(s)

// The stat tables src/config.js is generated from (tools/check-stats.mjs
// proves the two agree). The checks below read them instead of re-typing numbers,
// so the harness can never pass on a stale literal.
const dataUnits = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, '..', 'data', 'units.json'), 'utf8'));
const dataBuildings = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, '..', 'data', 'buildings.json'), 'utf8'));

const results = [];
const ok = (name, detail) => { results.push([true, name, String(detail)]); };
const bad = (name, detail) => { results.push([false, name, String(detail)]); };
const check = (cond, name, detail) => (cond ? ok(name, detail) : bad(name, detail));

function report() {
  const fails = results.filter(r => !r[0]);
  for (const [pass, name, detail] of results) console.log((pass ? 'PASS  ' : 'FAIL  ') + pad(name, 50) + ' ' + detail);
  console.log('\n' + (results.length - fails.length) + '/' + results.length + ' checks passed');
  process.exit(fails.length ? 1 : 0);
}
function pad(s, n) { return s.length >= n ? s : s + ' '.repeat(n - s.length); }

/* ---- 2. stub DOM ------------------------------------------------------ */
/* The 2D context a stub canvas hands back: every call is counted in `calls` *and*
   recorded in `ops` as [method, args, fillStyle, strokeStyle, globalAlpha], up to
   OPS_CAP (then it stops, so a long run cannot grow it without bound). `clearOps()`
   empties it, which is how a check inspects exactly one frame: counting alone could
   not tell a rectangle painted at the cursor from one painted at 0,0, which is how
   the placement ghost slipped past every render check (docs/TODO.md P0-2). */
const OPS_CAP = 8000;
function stubCtx(canvas) {
  const store = { canvas, calls: 0, ops: [], fillStyle: '', strokeStyle: '', globalAlpha: 1 };
  store.clearOps = () => { store.ops.length = 0; };
  const method = (k) => (...args) => {
    store.calls++;
    if (store.ops.length < OPS_CAP) store.ops.push([k, args, store.fillStyle, store.strokeStyle, store.globalAlpha]);
    return { width: 10 };
  };
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      t[k] = method(k);
      return t[k];
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

/* What an element hands back after you write markup into it. A real browser parses the
   string and serialises it on the way out, so the read value is never the string you
   wrote: tag names come back upper-cased and a boolean attribute expands to
   `disabled=""`. The stub used to round-trip exactly what it was given, which hid that
   from every innerHTML comparison here (docs/TODO.md P0-1: `renderHud` compared its
   generated footer against `el.innerHTML` — a match in node, never in a browser, so the
   bar was rebuilt 60 times a second). `stubEl` stores the serialised form and counts the
   writes in `_htmlSets`, the same trick as fakeStorage's `sets`, so a check can tell
   "wrote once" from "rewrote the frame". */
const domHtml = (markup) => String(markup)
  .replace(/<(\/?)([A-Za-z][A-Za-z0-9_-]*)/g, (_m, close, tag) => '<' + close + tag.toUpperCase())
  .replace(/(^|[^\S\n])disabled(?![\w-]*=)/g, '$1disabled=""');

function stubEl(tag, id, w, h) {
  const e = { tagName: tag.toUpperCase(), id, _text: '', _html: '', _htmlSets: 0, attrs: {}, listeners: {} };
  e.clientWidth = w; e.clientHeight = h; e.width = w; e.height = h;
  Object.defineProperty(e, 'textContent', { get() { return e._text; }, set(v) { e._text = String(v); } });
  Object.defineProperty(e, 'innerHTML', {
    get() { return e._html; },
    set(v) { e._html = domHtml(v); e._htmlSets++; },
  });
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
    button: 0, pointerId: 1, timeStamp: 0, pointerType: 'mouse', clientX: 0, clientY: 0, key: '', ctrlKey: false, target: e,
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
    button: 0, pointerId: 1, timeStamp: 0, pointerType: 'mouse', clientX: 0, clientY: 0, key: '', ctrlKey: false, target: null,
    preventDefault() {}, stopPropagation() {},
  }, ev)));
  doc.body = forId('body');
  doc.readyState = 'complete';
  return doc;
}

/* localStorage stand-in: storageGet/storageSet are the game's only storage door, and
   this is the one the harness hands it. `sets` counts setItem calls so the autosave
   schedule (T3) can prove it writes once per window instead of once per frame. */
function fakeStorage() {
  const store = new Map();
  const s = { sets: 0, removes: 0 };
  s.getItem = (k) => (store.has(k) ? store.get(k) : null);
  s.setItem = (k, v) => { store.set(k, String(v)); s.sets++; };
  s.removeItem = (k) => { store.delete(k); s.removes++; };
  s.key = (i) => { const k = Array.from(store.keys())[i]; return k === undefined ? null : k; };
  Object.defineProperty(s, 'length', { get: () => store.size });
  return s;
}

const doc = makeDoc();
const rafQueue = [];
global.document = doc;
global.localStorage = fakeStorage();
global.window = {
  innerWidth: 1200, innerHeight: 700,
  addEventListener() {},
  requestAnimationFrame(cb) { rafQueue.push(cb); return rafQueue.length; },
};

/* ---- 2b. Image stub (the atlas loader's browser API) ---------------- */
// loadAtlas() (src/boot.js) does `new Image(); img.src = 'assets/sprites.png'`.
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
  for (const t of [path.join(TOOLS_DIR, 'node_modules', '@napi-rs', 'canvas'), '@napi-rs/canvas']) {
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

/* ---- 2c. AudioContext stub (this plan, T2) -------------------- */
/* Browsers have AudioContext, node does not -- and that absence is itself a
   covered case (playSfx answers false instead of throwing, §14). A test that
   wants the audio path swaps this class in for global.AudioContext: it records
   every node playSfx builds (oscillator type, the frequency values it was
   scheduled through, its start/stop window, the gain it ramped from and what it
   connected to), so a check can read back *which* sound was synthesised. */
function stubVoices(ctx) {
  if (!ctx) return [];
  return ctx.nodes.filter((n) => n.kind === 'oscillator').map((n) => ({
    type: n.type,
    freq: n.freq.map((f) => f.v),
    dur: n.stop === null || n.start === null ? null : n.stop - n.start,
    gain: n.dest && n.dest.values.length
      ? Math.max.apply(null, n.dest.values.map((g) => g.v)) : null,
  }));
}
function makeAudioStub() {
  const param = (sink) => ({
    setValueAtTime: (v, t) => sink.push({ v: v, t: t }),
    linearRampToValueAtTime: (v, t) => sink.push({ v: v, t: t }),
    setTargetAtTime: (v, t) => sink.push({ v: v, t: t }),
  });
  class AudioContext {
    constructor() {
      this.currentTime = 0;
      this.nodes = [];
      this.destination = { kind: 'destination' };
      AudioContext.instances.push(this);
    }
    createOscillator() {
      const osc = { kind: 'oscillator', type: 'sine', freq: [], start: null, stop: null, dest: null };
      osc.frequency = param(osc.freq);
      osc.connect = (d) => { osc.dest = d; };
      osc.start = (t) => { osc.start = t; };
      osc.stop = (t) => { osc.stop = t; };
      this.nodes.push(osc);
      return osc;
    }
    createGain() {
      const g = { kind: 'gain', values: [], dest: null };
      g.gain = param(g.values);
      g.connect = (d) => { g.dest = d; };
      this.nodes.push(g);
      return g;
    }
    close() { this.closed = true; }
  }
  AudioContext.instances = [];
  return AudioContext;
}
const withAudio = (fn) => {
  const keep = global.AudioContext;
  const Ctor = makeAudioStub();
  global.AudioContext = Ctor;
  try { return fn(Ctor); } finally { global.AudioContext = keep; }
};
const voicesOf = (Ctor) => Ctor.instances.reduce((all, c) => all.concat(stubVoices(c)), []);

/* ---- 3. load + boot -------------------------------------------------- */
const AoE2 = gameLoader.loadGame({ html: HTML });
const Game = global.window.Game;          // undefined when the boot failed: 00-boot.js reports that

/* ---- 4. fixtures shared by more than one check file ------------------- */
const DT = 1 / 30;
const tc = Game && Game.buildings.find(b => b.team === 0 && b.kind === 'town_center');
const blueVill = () => Game.units.filter(u => u.team === 0 && u.kind === 'villager');
const stepRender = (n) => {
  for (let i = 0; i < n; i++) { AoE2.stepGame(Game, DT); if (i % 15 === 0) AoE2.renderFrame(Game); }
};
const DIRS8H = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/* A fresh state with every tile turned to plain grass and every unit idle: the
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

// The solidity rule, written here independently of the game so the harness cannot
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

function freeSpotAround(world, Game, tx, ty, w, h, maxR) {
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (AoE2.siteFree(Game, tx + dx, ty + dy, w, h)) return { tx: tx + dx, ty: ty + dy };
    }
  }
  return null;
}

/** A finished player house dropped beside the Town Center of `g` -- for the checks that
 *  need one standing (population cap, demolish) without replaying its construction. */
function finishedHouse(g) {
  const home = g.buildings.find(b => b.team === 0 && b.kind === 'town_center');
  const spot = freeSpotAround(g.world, g, home.tx, home.ty, 2, 2, 8);
  const b = AoE2.makeBuilding(g, 'house', 0, spot.tx, spot.ty);
  b.built = 1; b.hp = b.maxHp;
  return b;
}

/** Run fn against a throwaway localStorage, restoring the real stub after. */
const withStorage = (fn) => {
  const keep = global.localStorage;
  const s = fakeStorage();
  global.localStorage = s;
  try { return fn(s); } finally { global.localStorage = keep; }
};
/* A settlement with every cost payable and Feudal unlocked, so each command
   actually commits instead of refusing (a refusal never marks). */
const fundedGame = () => {
  const g = AoE2.createState();
  g.res[0] = { food: 9000, wood: 9000, gold: 9000, stone: 9000 };
  g.age = 1;
  return g;
};
const builtAt = (g, kind, ty) => {
  const s = AoE2.findSite(g.world, 40, ty, AoE2.BLD[kind].w) || { tx: 40, ty };
  const b = AoE2.makeBuilding(g, kind, 0, s.tx, s.ty);
  b.built = 1; b.hp = b.maxHp;
  return b;
};
const siteAt = (g, kind, ty) => {
  const s = AoE2.findSite(g.world, 40, ty, AoE2.BLD[kind].w) || { tx: 40, ty };
  return AoE2.makeBuilding(g, kind, 0, s.tx, s.ty);
};
/** A check whose body returns [passed, detail]; a throw is a failure, not a crash. */
const uiCheck = (name, fn) => {
  let out;
  try { out = fn(); } catch (e) { bad(name, 'threw ' + e.message); return; }
  check(out[0], name, out[1]);
};
/** Boot a second, private page: its own doc, its own storage (optionally pre-filled). */
const bootFixture = (raw, fn, extra) => {
  const keep = global.localStorage;
  global.localStorage = fakeStorage();
  if (raw !== undefined) AoE2.storageSet(AoE2.SAVE_PATH, raw);
  for (const k of Object.keys(extra || {})) AoE2.storageSet(k, extra[k]);   // e.g. MUTE_PATH
  const doc = makeDoc();
  const Game = AoE2.boot(doc);
  try { return fn(doc, Game); } finally { global.localStorage = keep; }
};

module.exports = {
  AoE2, DIMS, DIRS8H, DT, Game, HTML, HTML_DIR, SCRIPT_FILES,
  TOOLS_DIR, bad, blueVill, bootFixture, builtAt, check, cp, dataBuildings,
  dataUnits, doc, domHtml, fakeStorage, finishedHouse, flatState, freeSpotAround, fs, fundedGame, gameLoader,
  html, makeAudioStub, makeDoc, napiImage, ok, pad, path, rafQueue,
  report, results, scriptSrc, setTile, siteAt, solidTile, stepRender, stubCtx,
  stubEl, stubVoices, styleCss, tIdx, tOf, tc, tileCentre, uiCheck,
  voicesOf, withAudio, withStorage,
};
