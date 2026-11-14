'use strict';
/* boot -- state creation, new game, atlas loading, DOM wiring and the frame loop. */

/** Canvas factory that also works in node (the harness needs an offscreen
 *  bitmap for the minimap). */
function mkCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const el = document.createElement('canvas');
    el.width = w; el.height = h;
    return el;
  }
  return stubCanvas(w, h);
}

function stubCanvas(w, h) {
  const canvas = { width: w, height: h, clientWidth: w, clientHeight: h };
  const store = { canvas };
  canvas.getContext = () => new Proxy({}, {
    get(t, k) { return k in t ? t[k] : () => ({ width: 10 }); },
    set(t, k, v) { t[k] = v; return true; },
  });
  canvas.addEventListener = () => {};
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: h });
  return canvas;
}

function view_W(Game) { return Game.view && Game.view.w ? Game.view.w : 1280; }
function view_H(Game) { return Game.view && Game.view.h ? Game.view.h : 720; }
function sizeW(dom) {
  const el = dom.stage || dom.view;
  return (el && el.clientWidth) || (typeof window !== 'undefined' && window.innerWidth) || 1280;
}
function sizeH(dom) {
  const el = dom.stage || dom.view;
  return (el && el.clientHeight) || (typeof window !== 'undefined' && window.innerHeight) || 720;
}

function createState() {
  const Game = {
    world: null, units: [], buildings: [], projectiles: [], blocks: new Map(), occupied: new Set(),
    sprites: { atlas: null },
    res: [{ food: 0, wood: 0, gold: 0, stone: 0 }, { food: 0, wood: 0, gold: 0, stone: 0 }],
    selection: [], selectedBuilding: null, groups: {}, keys: {},
    cam: { x: 0, y: 0 }, cursor: null, mouse: null, drag: null, mmPointer: null, placing: null,
    touches: {}, pan: null,   // live touch fingers + their pivot: input state, never saved (src/save.js:234)
    time: 0, wave: 0, age: [0, 0], ageBonus: [0, 0], techs: [new Set(), new Set()], nextId: 1, started: false, result: null, rnd: mulberry32(CFG.SEED),
    mapEpoch: 0, pathQueries: 0, // walkable-set epoch + findPath budget, both section-4 path state
    dom: null, view: null, mm: null, mmBase: null, toastMsg: '', toastAt: -99, pingAt: -99, frame: 0, autosaveAt: 0, sound: null,
  };
  Game.toast = (m) => toast(Game, m);
  resetGame(Game);
  return Game;
}

function resetGame(Game, seed = CFG.SEED) {
  Game.world = makeWorld(seed);
  Game.units = [];
  Game.projectiles = [];
  Game.buildings = [];
  Game.nextId = 1;
  Game.time = 0; Game.wave = 0; Game.age = [0, 0]; Game.ageBonus = [0, 0]; Game.techs = [new Set(), new Set()]; Game.rnd = mulberry32(seed);
  Game.autosaveAt = Game.time;             // due now: the next frame writes this settlement
  Game.mapEpoch = 0; Game.pathQueries = 0; // section-4 path state: fresh map, no cached routes
  Game.selection = []; Game.selectedBuilding = null; Game.placing = null; Game.result = null;
  Game.mmBase = null;
  Game.res[0] = Object.assign({}, CFG.START);
  Game.res[1] = Object.assign({}, CFG.START);

  const a = findSite(Game.world, Math.round(CFG.MAP_W * 0.30), Math.round(CFG.MAP_H * 0.52), 3);
  const b = findSite(Game.world, Math.round(CFG.MAP_W * 0.72), Math.round(CFG.MAP_H * 0.46), 3);
  const tcA = makeBuilding(Game, 'town_center', 0, a.tx, a.ty);
  const tcB = makeBuilding(Game, 'town_center', 1, b.tx, b.ty);
  tcA.built = 1; tcA.hp = tcA.maxHp;
  tcB.built = 1; tcB.hp = tcB.maxHp;

  /* starting squad per side: 4 villagers on the resources + 1 warrior. The Town
     Center's own tiles are solid ground now, so the squad stands on the walkable
     ring around it instead of on the building. */
  for (const team of [0, 1]) {
    const tc = team === 0 ? tcA : tcB;
    const spots = standingSpots(Game, tc, 5);
    const at = (i) => spots[i] || workPos(Game, tc, null);
    for (let i = 0; i < 4; i++) {
      const v = makeUnit(Game, 'villager', team, at(i).x, at(i).y);
      assignStarter(Game, v);
    }
    makeUnit(Game, 'militia', team, at(4).x, at(4).y);
  }

  Game.cam.x = clamp(a.tx * CFG.TILE - 300, 0, Math.max(0, Game.world.w * CFG.TILE - view_W(Game)));
  Game.cam.y = clamp(a.ty * CFG.TILE - 200, 0, Math.max(0, Game.world.h * CFG.TILE - view_H(Game)));
}

/** Put a starting villager on the nearest harvestable tile that is not already
 *  swarmed: food first (AoE2 opens on berries), then wood, then anything, and
 *  never more than CFG.WORKERS_PER_TILE per tile — the old "nearest tile for
 *  everyone" answer parked all four villagers on one berry bush. */
function assignStarter(Game, v) {
  const ux = Math.floor(v.x / CFG.TILE), uy = Math.floor(v.y / CFG.TILE);
  const ring = (r) => {
    const out = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const t = tileRes(Game.world, ux + dx, uy + dy);
        if (t) out.push(t);
      }
    }
    return out;
  };
  let fallback = null;
  for (const res of ['food', 'wood', null]) {
    for (let r = 1; r <= 12; r++) {
      for (const t of ring(r)) {
        if (res && t.res !== res) continue;
        const s = sourceFromTile(Game, v, t.tx, t.ty);   // null: no walkable tile to work from
        if (!s) continue;
        if (workersOnTile(Game, v, t.tx, t.ty) < CFG.WORKERS_PER_TILE) {
          v.order = { kind: 'harvest', src: s };
          return;
        }
        if (!fallback) fallback = t;                       // every tile full: still better than idling
      }
    }
  }
  const fb = fallback && sourceFromTile(Game, v, fallback.tx, fallback.ty);
  if (fb) v.order = { kind: 'harvest', src: fb };
}

/** Fetch the unit atlas once, at boot (node has no Image, so this is a no-op
 *  there and the renderer keeps drawing units procedurally). */
function loadAtlas(Game) {
  if (typeof Image === 'undefined') return;
  const img = new Image();
  img.onload = () => setAtlas(Game, img);
  img.src = 'assets/sprites.png';
}

function boot(doc) {
  const Game = createState();
  /* the session continues from the slot: a tab reopened lands on the saved game,
     and an empty or unreadable slot is the fresh settlement createState just built.
     Ahead of the `!d` guard so a doc-less boot restores like a browser one. */
  const raw = storageGet(SAVE_PATH);
  if (raw !== null) loadGame(SAVE_PATH, Game, raw);
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d) return Game;
  const viewEl = d.getElementById('view');
  if (!viewEl) return Game;
  loadAtlas(Game);

  Game.dom = {
    view: viewEl,
    minimap: d.getElementById('minimap'),
    stage: d.getElementById('stage'),
    hud: d.getElementById('hud'),
    commands: d.getElementById('commands'),
    toast: d.getElementById('toast'),
    result: d.getElementById('result'),
    save: d.getElementById('save'),
    mute: d.getElementById('mute'),
  };
  applyMuteButton(Game, storageGet(MUTE_PATH) === '1');   // honour the saved preference once
  for (const k of ['food', 'wood', 'gold', 'stone', 'pop', 'age']) {
    const box = d.getElementById('r_' + k);
    if (box && box.querySelector) {
      const b = box.querySelector('b');
      if (b) Game.dom['set_' + k] = b;
    }
  }
  Game.view = beginCanvas(viewEl, sizeW(Game.dom), sizeH(Game.dom));
  Game.mm = beginCanvas(Game.dom.minimap, 168, 168);
  if (!Game.view.ok) return Game;

  attachInput(Game, d);

  /* the game-over overlay sits outside the command bar, so its button is wired
     here with the same data-act="restart" the bar's "New map" button uses. */
  if (Game.dom.result && Game.dom.result.addEventListener) {
    Game.dom.result.addEventListener('click', (e) => {
      const b = buttonAt(e);
      if (b && b.getAttribute('data-act') === 'restart') requestReset(Game, Date.now() >>> 0);
    });
  }
  if (Game.dom.save && Game.dom.save.addEventListener) {
    Game.dom.save.addEventListener('click', () => { saveGame(SAVE_PATH, Game); toast(Game, 'Saved'); });
  }
  if (Game.dom.mute && Game.dom.mute.addEventListener) {
    Game.dom.mute.addEventListener('click', () => setMuted(Game, !isMuted(Game)));
  }
  Game.started = true;
  renderFrame(Game);
  startLoop(Game);
  return Game;
}

function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function startLoop(Game) {
  if (typeof window === 'undefined' || !window.requestAnimationFrame) return;
  let last = now();
  const frame = () => {
    const t = now();
    let dt = (t - last) / 1000;
    last = t;
    if (dt > 0.1) dt = 0.1;                     // tab-switch guard
    Game.frame++;
    stepGame(Game, dt);
    renderFrame(Game);
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}

/** Per-frame work: camera panning, the simulation, then the autosave tick. */
function stepGame(Game, dt) {
  const s = CFG.PAN_SPEED * dt, k = Game.keys;
  if (k.up) Game.cam.y -= s;
  if (k.down) Game.cam.y += s;
  if (k.left) Game.cam.x -= s;
  if (k.right) Game.cam.x += s;
  if (Game.mouse && Game.mouse.w && !Game.drag) {
    const m = Game.mouse;
    if (m.y < CFG.EDGE) Game.cam.y -= s; else if (m.y > m.h - CFG.EDGE) Game.cam.y += s;
    if (m.x < CFG.EDGE) Game.cam.x -= s; else if (m.x > m.w - CFG.EDGE) Game.cam.x += s;
  }
  Game.cam.x = clamp(Game.cam.x, 0, Math.max(0, Game.world.w * CFG.TILE - view_W(Game)));
  Game.cam.y = clamp(Game.cam.y, 0, Math.max(0, Game.world.h * CFG.TILE - view_H(Game)));
  stepSim(Game, dt);
  /* The autosave tick, last so the write carries the frame it just ran; the only
     place in the game that ever writes the save. */
  if (Game.time >= Game.autosaveAt) {
    saveGame(SAVE_PATH, Game);
    Game.autosaveAt = Game.time + CFG.AUTOSAVE_EVERY;
  }
}

/* N / New map / New game used to wipe the save on the first press (docs/TODO.md item 23,
   finding R6). requestReset now asks: the first call arms Game.confirmReset and toasts, a
   second within CONFIRM_RESET_SECS runs the old wipe (forget the save, rebuild the start on
   the seed it was given — item 22: the DOM call sites pass a fresh Date.now() seed, the
   default keeps CFG.SEED) and clears the arm, and a call after the window simply re-arms.
   One exported function so the n key and both New buttons cannot disagree; confirmReset is
   transient and never enters the save payload (src/save.js:30). */
function requestReset(Game, seed = CFG.SEED) {
  const armed = typeof Game.confirmReset === 'number' &&
                Game.time - Game.confirmReset <= CONFIRM_RESET_SECS;
  if (!armed) { Game.confirmReset = Game.time; toast(Game, 'Press N again to start a new map'); return; }
  storageSet(SAVE_PATH, null);
  resetGame(Game, seed);
  Game.confirmReset = null;
}
