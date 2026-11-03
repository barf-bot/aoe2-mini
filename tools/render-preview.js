#!/usr/bin/env node
'use strict';
/* Render one real frame of the game to a PNG using the exact draw code the browser
 * runs — the canvas comes from @napi-rs/canvas instead of a browser, so this proves
 * the renderer (not just the simulation) executes cleanly.
 *
 *   node tools/render-preview.js [--seconds N] [--select] [--out file.png]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const HTML_SRC = fs.readFileSync(HTML, 'utf8');

/* ---------- real canvas backend ---------- */
function loadCanvas() {
  const tries = [
    path.join(ROOT, 'tools', 'node_modules', '@napi-rs', 'canvas'),
    path.join(ROOT, 'node_modules', '@napi-rs', 'canvas'),
    '/opt/data/cache/scratch/canvaspkg/node_modules/@napi-rs/canvas',
    '@napi-rs/canvas',
  ];
  for (const t of tries) {
    try { return require(t); } catch (e) { /* next */ }
  }
  return null;
}
const napi = loadCanvas();

/* ---------- DOM stub (same contract as tools/headless-check.js) ---------- */
function stubCtx(canvas) {
  const store = { canvas };
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      t[k] = () => ({ width: 10 });
      return t[k];
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function makeElement(tag, id, w, h, realCanvas) {
  const e = { tagName: String(tag).toUpperCase(), id, _text: '', _html: '', attrs: {}, listeners: {} };
  e.clientWidth = w; e.clientHeight = h; e.width = w; e.height = h;
  Object.defineProperty(e, 'textContent', { get: () => e._text, set: (v) => { e._text = String(v); } });
  Object.defineProperty(e, 'innerHTML', { get: () => e._html, set: (v) => { e._html = String(v); } });
  e._q = {};
  e.querySelector = (s) => (e._q[s] || (e._q[s] = makeElement('b', id + '>' + s, 4, 4)));
  e.addEventListener = (t, fn) => { (e.listeners[t] = e.listeners[t] || []).push(fn); };
  e.setAttribute = (k, v) => { e.attrs[k] = String(v); };
  e.getAttribute = (k) => (k in e.attrs ? e.attrs[k] : null);
  e.classList = { add() {}, remove() {}, contains() { return false; } };
  e.getBoundingClientRect = () => ({ left: 0, top: 0, width: e.clientWidth, height: e.clientHeight });
  if (tag === 'canvas') {
    let cached = null;
    e.getContext = (kind) => {
      if (kind !== '2d') return null;
      if (realCanvas) return cached || (cached = realCanvas.getContext('2d'));
      return (cached = cached || stubCtx(e));
    };
  }
  e.fire = (t, ev) => (e.listeners[t] || []).forEach((fn) =>
    fn(Object.assign({ button: 0, clientX: 0, clientY: 0, key: '', ctrlKey: false, target: e,
      preventDefault() {}, stopPropagation() {} }, ev)));
  return e;
}
const DIMS = { view: [1200, 700], stage: [1200, 700], minimap: [168, 168] };
function buildDom(realView) {
  const cache = {};
  const doc = { listeners: {} };
  doc.getElementById = (id) => {
    if (cache[id]) return cache[id];
    const tag = (id === 'view' || id === 'minimap') ? 'canvas' : 'div';
    const d = DIMS[id] || [250, 74];
    const real = (id === 'view' && realView) ? realView : (id === 'minimap' && napi && !realView ? napi.createCanvas(d[0], d[1]) : null);
    return (cache[id] = makeElement(tag, id, d[0], d[1], real));
  };
  doc.createElement = (t) => makeElement(t, 'created', 96, 96);
  doc.addEventListener = (t, fn) => { (doc.listeners[t] = doc.listeners[t] || []).push(fn); };
  doc.body = doc.getElementById('body');
  doc.readyState = 'complete';
  return doc;
}

/* ---------- args ---------- */
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? dflt : argv[i + 1];
};
const SECONDS = Number(arg('seconds', 8));
const OUT = path.resolve(arg('out', path.join(ROOT, 'preview.png')));

/* ---------- mode 1: real pixels ---------- */
if (napi) {
  const realView = napi.createCanvas(DIMS.view[0], DIMS.view[1]);
  const doc = buildDom(realView);
  global.document = doc;
  global.window = { innerWidth: DIMS.view[0], innerHeight: DIMS.view[1],
    addEventListener() {}, requestAnimationFrame() { return 0; } };

  const jsPath = path.join(__dirname, '.extracted-preview.js');
  fs.writeFileSync(jsPath, HTML_SRC.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const G = require(jsPath);
  const Game = global.window.Game;
  fs.unlinkSync(jsPath);

  const villagers = Game.units.filter((u) => u.team === 0 && u.kind === 'villager');
  if (villagers.length) G.issueOrder(Game, villagers[0].order.src ? villagers[0].order.src.x : villagers[0].x,
    villagers[0].order.src ? villagers[0].order.src.y : villagers[0].y);
  const steps = Math.round(SECONDS * 30);
  for (let i = 0; i < steps; i++) G.stepGame(Game, 1 / 30);
  if (villagers[0]) Game.selection = [villagers[0].id];
  G.renderFrame(Game);

  const png = realView.toBuffer('image/png');
  fs.writeFileSync(OUT, png);
  console.log(`rendered ${DIMS.view[0]}x${DIMS.view[1]} frame (${png.length} bytes) after ${SECONDS}s of simulated play`);
  console.log(`resources after sim: ${JSON.stringify(Game.res[0])}`);
  console.log(`out: ${OUT}`);
  process.exit(0);
}

/* ---------- mode 2: no canvas backend, at least prove the draw calls run ---------- */
const doc = buildDom(null);
global.document = doc;
global.window = { innerWidth: 1200, innerHeight: 700, addEventListener() {}, requestAnimationFrame() { return 0; } };
const jsPath = path.join(__dirname, '.extracted-preview.js');
fs.writeFileSync(jsPath, HTML_SRC.match(/<script>([\s\S]*?)<\/script>/)[1]);
const G = require(jsPath);
const Game = global.window.Game;
fs.unlinkSync(jsPath);
for (let i = 0; i < Math.round(SECONDS * 30); i++) G.stepGame(Game, 1 / 30);
G.renderFrame(Game);
console.log('stub-canvas render OK (install @napi-rs/canvas in tools/node_modules for a PNG)');
