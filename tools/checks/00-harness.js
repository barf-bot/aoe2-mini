'use strict';
/* checks/00-harness.js -- the harness: result bookkeeping, the stub DOM / storage / Image / AudioContext, then load + boot.
   One fragment of a single sequential script: tools/headless-check.js runs every file in
   tools/checks/ in name order in one shared scope, so later files see the consts (and the
   mutated Game) of earlier ones. */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const gameLoader = require(path.join(TOOLS_DIR, 'lib', 'load-game.js'));

const HTML = process.argv[2] || path.join(TOOLS_DIR, '..', 'index.html');
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

/* ---- 1. syntax ------------------------------------------------------- */
const syntax = cp.spawnSync(process.execPath, SCRIPT_FILES.reduce((a, f) => a.concat('--check', f), []), { encoding: 'utf8' });
check(syntax.status === 0, 'syntax: node --check on every game script',
  syntax.status === 0 ? SCRIPT_FILES.length + ' files clean' : (syntax.stderr || '').trim().split('\n').slice(0, 5).join(' | '));
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
check(!!AoE2 && !!AoE2.CFG, 'module: exports the game surface', Object.keys(AoE2 || {}).length + ' exports');
if (!AoE2 || !AoE2.CFG) report();
check(!!global.window.Game, 'boot: window.Game built from the stub DOM', global.window.Game ? 'booted' : 'no Game');
const Game = global.window.Game;
if (!Game || !Game.world) report();

check(Game.view && Game.view.ok, 'render: canvas context acquired', Game.view && Game.view.ok ? 'ok' : 'failed');
check(Game.dom.set_food !== undefined, 'hud: <b> nodes wired so labels survive a render', 'set_food present');
check(rafQueue.length === 1, 'loop: exactly one requestAnimationFrame queued', String(rafQueue.length));
check(Game.frame === 0, 'loop: boot rendered without recursing into the frame loop', 'frame=' + Game.frame);
