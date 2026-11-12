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

/* No Image stub here, unlike tools/headless-check.js: @napi-rs/canvas 1.1.0
 * decodes `new Image().src = buffer` into an image that reports 96x24 and
 * complete:true but paints nothing, so the atlas is loaded with loadImage()
 * below and handed to the game through setAtlas -- the same injection point a
 * browser's img.onload uses. (The check sandbox keeps the stub because its
 * canvas swallows draw arguments; there the constructor path is what matters.) */

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
/** 8s of simulated play, then paint the view into realView and write OUT. */
function simulateAndRender(G, Game, realView) {
  const villagers = Game.units.filter((u) => u.team === 0 && u.kind === 'villager');
  // T4 (pathfinding): the frame's order is one GROUP move — the whole starting squad
  // is selected and issued a single order, so the committed preview shows the ranks
  // the golden-angle scatter used to fold into one dot. The destination is the first
  // land tile three tiles off the squad (a move order needs a walkable tile, and the
  // grid the squad takes has to be land too); with nothing legal to walk to, the
  // squad keeps its seeded spot.
  const squad = villagers.map((u) => u.id);
  const goal = !squad.length ? null : [[3, 0], [2, 2], [0, 3], [-2, 2], [-3, 0], [-2, -2], [0, -3], [2, -2]]
    .map(([dx, dy]) => ({ x: (Math.floor(villagers[0].x / G.CFG.TILE) + dx) * G.CFG.TILE + G.CFG.TILE / 2,
                          y: (Math.floor(villagers[0].y / G.CFG.TILE) + dy) * G.CFG.TILE + G.CFG.TILE / 2 }))
    .find((p) => G.walkable(Game, p.x, p.y));
  if (goal) { Game.selection = squad; G.issueOrder(Game, goal.x, goal.y); }
  const steps = Math.round(SECONDS * 30);
  for (let i = 0; i < steps; i++) G.stepGame(Game, 1 / 30);
  if (squad.length) Game.selection = squad;          // the whole group keeps the selection ring
  // T4 of the content port: an archer joins the frame through the same factory
  // train() uses, so the committed preview shows the new atlas cell.
  if (villagers[0]) G.makeUnit(Game, 'archer', 0, villagers[0].x + 26, villagers[0].y + 14);
  // T5 of the blacksmith tech tree: a finished Blacksmith on the findSite
  // tile beside the squad, so the committed frame shows it - with no atlas
  // cell it draws through the procedural path T1 left it on.
  if (villagers[0]) { const site = G.findSite(Game.world, Math.floor(villagers[0].x / G.CFG.TILE) + 1, Math.floor(villagers[0].y / G.CFG.TILE), 1);
    const bs = G.makeBuilding(Game, 'blacksmith', 0, site.tx, site.ty); bs.built = 1; }
  // T5 of the market plan: the pair's own pads, east (+4, 2x2) and west (-3, 1x1)
  // of the squad's tile so neither overlaps the blacksmith's. Both rows are
  // noSprite, so the frame shows them as the flat team-coloured rect the
  // blacksmith cell already paints -- the shared barracks-and-future-kinds draw.
  if (villagers[0]) { const site = G.findSite(Game.world, Math.floor(villagers[0].x / G.CFG.TILE) + 4, Math.floor(villagers[0].y / G.CFG.TILE) - 1, 2);
    const mk = G.makeBuilding(Game, 'market', 0, site.tx, site.ty); mk.built = 1; }
  if (villagers[0]) { const site = G.findSite(Game.world, Math.floor(villagers[0].x / G.CFG.TILE) - 3, Math.floor(villagers[0].y / G.CFG.TILE) + 1, 1);
    const wt = G.makeBuilding(Game, 'watch_tower', 0, site.tx, site.ty); wt.built = 1; }
  G.renderFrame(Game);

  const png = realView.toBuffer('image/png');
  fs.writeFileSync(OUT, png);
  console.log(`rendered ${DIMS.view[0]}x${DIMS.view[1]} frame (${png.length} bytes) after ${SECONDS}s of simulated play`);
  console.log(`resources after sim: ${JSON.stringify(Game.res[0])}`);
  console.log(`out: ${OUT}`);
  process.exit(0);
}

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

  const sheet = path.join(ROOT, 'assets', 'sprites.png');
  Promise.resolve(fs.existsSync(sheet) ? napi.loadImage(sheet) : null)
    .then((atlas) => {
      if (atlas) G.setAtlas(Game, atlas);          // browser-equivalent: img.onload -> setAtlas
      return simulateAndRender(G, Game, realView);
    })
    .catch((e) => { console.error('FAIL preview: ' + (e && e.stack || e)); process.exit(1); });
} else {
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
}
