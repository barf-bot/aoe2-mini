'use strict';
/* checks/10-reset-save.js -- new game, save / load.
   Runs on its own (`node tools/checks/10-reset-save.js`) against a freshly booted game. */

const {
  AoE2, DIRS8H, DT, Game, bad, bootFixture, builtAt, check, dataUnits, doc, fundedGame, ok,
  siteAt, stepRender, stubEl, tc, uiCheck, withStorage, report,
} = require('../lib/harness');

/* ---- 12. reset ------------------------------------------------------ */
const unitsBeforeReset = Game.units.length;
AoE2.resetGame(Game);
check(Game.units.length === 10 && Game.res[0].wood === 100, 'reset: fresh state without re-booting',
  unitsBeforeReset + ' -> ' + Game.units.length + ' units');
stepRender(60);
check(true, 'reset: simulation runs on the reset state', '60 steps clean');

/* ---- 13. save/load (this plan, T1) -------------------------------- */
/* The save contract. SAVE_FIELDS IS the schema: encodeState returns exactly these
   keys in this order, and every check below reads the JSON string saveGame hands
   back (plus what the fake storage in §2 ended up holding). */
const SAVE_FIELDS = ['world', 'units', 'buildings', 'projectiles', 'blocks', 'occupied', 'res',
  'selection', 'selectedBuilding', 'groups', 'keys', 'cam', 'cursor', 'mouse', 'drag', 'placing',
  'time', 'wave', 'age', 'ageBonus', 'techs', 'nextId', 'started', 'result'];
const saveOf = (g, at) => {
  const raw = AoE2.saveGame(AoE2.SAVE_PATH, g, at);
  return [raw, JSON.parse(raw)];
};
const stateOf = (g, at) => saveOf(g, at)[1].state;
const saveCheck = (name, fn) => {
  let out;
  try { out = fn(); } catch (e) { bad(name, 'threw ' + e.message); return; }
  check(out[0], name, out[1]);
};

saveCheck('save: saveGame returns the v2 envelope', () => {
  const g = AoE2.createState();
  const [raw, env] = saveOf(g, 1000);
  return [AoE2.CFG.VERSION === dataUnits.cfg.VERSION && env.version === AoE2.CFG.VERSION &&
    env.seed === AoE2.CFG.SEED && env.writtenAt === 1000 &&
    Object.keys(env.state).join(',') === SAVE_FIELDS.join(','),
    'version=' + env.version + ' seed=' + env.seed + ' writtenAt=' + env.writtenAt +
    ' stateKeys=' + Object.keys(env.state).length + ' bytes=' + raw.length];
});

saveCheck('save: Game.techs and Game.blocks encode as array and object', () => {
  const g = AoE2.createState();
  g.age[0] = 1;
  g.techs[0].add('forge');
  const site = AoE2.findSite(g.world, 40, 40, 2);
  const b = AoE2.makeBuilding(g, 'barracks', 0, site.tx, site.ty);
  const st = stateOf(g, 1000);
  return [JSON.stringify(st.techs) === '[["forge"],[]]' &&
    JSON.stringify(st.blocks[String(b.id)]) === JSON.stringify(g.blocks.get(b.id)) &&
    st.occupied.length === g.occupied.size,
    'techs=' + JSON.stringify(st.techs) + ' blocks[' + b.id + ']=' +
    JSON.stringify(st.blocks[String(b.id)]) + ' live=' + JSON.stringify(g.blocks.get(b.id)) +
    ' occupied=' + st.occupied.length + '/' + g.occupied.size];
});

saveCheck('save: the DOM-only fields never enter the payload', () => {
  const g = AoE2.createState();
  const atlas = { stub: 'atlas' };
  AoE2.setAtlas(g, atlas);
  g.frame = 7; g.pingAt = 3.5; g.toastMsg = 'hi'; g.toastAt = 2;
  g.mapEpoch = 12; g.pathQueries = 9;
  const st = stateOf(g, 1000);
  const leaked = ['dom', 'view', 'mm', 'mmBase', 'toastMsg', 'toastAt', 'pingAt', 'frame',
    'pathQueries', 'sprites', 'rnd', 'mapEpoch', 'sound'].filter((k) => Object.prototype.hasOwnProperty.call(st, k));
  return [leaked.length === 0 && g.sprites.atlas === atlas,
    'leaked=' + JSON.stringify(leaked) + ' atlasStillLive=' + (g.sprites.atlas === atlas)];
});

saveCheck('save: world arrays mirror live tile amounts', () => {
  const g = AoE2.createState();
  const v = g.units.find((u) => u.team === 0 && u.kind === 'villager' &&
    u.order.src && u.order.src.kind === 'tile');
  const k = v.order.src.ty * g.world.w + v.order.src.tx;
  const was = g.world.amount[k];
  g.world.amount[k] = was - 7;
  const st = stateOf(g, 1000);
  return [st.world.amount[k] === was - 7 &&
    st.world.type.length === AoE2.CFG.MAP_W * AoE2.CFG.MAP_H &&
    st.world.shade.length === AoE2.CFG.MAP_W * AoE2.CFG.MAP_H &&
    st.world.w === AoE2.CFG.MAP_W && st.world.h === AoE2.CFG.MAP_H &&
    st.world.seed === AoE2.CFG.SEED,
    'amount[' + k + ']=' + st.world.amount[k] + ' (was ' + was + ') type.length=' +
    st.world.type.length + ' expected=' + (AoE2.CFG.MAP_W * AoE2.CFG.MAP_H)];
});

saveCheck("save: an order's harvest source is stored by tile, not as a frozen copy", () => {
  const g = AoE2.createState();
  const v = g.units.find((u) => u.team === 0 && u.kind === 'villager' &&
    u.order.src && u.order.src.kind === 'tile');
  const live = v.order.src;
  const foe = g.units.find((u) => u.team === 1 && u.kind === 'militia') ||
    g.units.find((u) => u.team === 1);
  v.order = AoE2.orderForUnit(g, v, live.tx * AoE2.CFG.TILE + AoE2.CFG.TILE / 2,
    live.ty * AoE2.CFG.TILE + AoE2.CFG.TILE / 2);
  const arrow = AoE2.spawnArrow(g, v, foe);
  const st = stateOf(g, 1000);
  const saved = st.units.find((u) => u.id === v.id);
  const p = (st.projectiles || [])[0];
  return [saved.order.kind === 'harvest' && saved.order.src.tx === live.tx &&
    saved.order.src.ty === live.ty && saved.order.src.res === live.res &&
    !!p && p.tk === 'unit' && p.tid === foe.id && p.x === v.x && p.y === v.y &&
    p.dmg === arrow.dmg && p.accuracy === v.accuracy && p.team === v.team,
    'order=' + JSON.stringify(saved.order) + ' arrow=' + JSON.stringify(p)];
});

saveCheck('save: the slot holds exactly the string saveGame returned', () => {
  const g = AoE2.createState();
  const [raw] = saveOf(g, 1000);
  const stored = AoE2.storageGet(AoE2.SAVE_PATH);
  AoE2.storageSet(AoE2.SAVE_PATH, null);
  return [stored === raw && AoE2.storageGet(AoE2.SAVE_PATH) === null,
    'storedIsRaw=' + (stored === raw) + ' afterClear=' + String(AoE2.storageGet(AoE2.SAVE_PATH))];
});

saveCheck('save: saveGame still returns the payload with no storage', () => {
  const g = AoE2.createState();
  const keep = global.localStorage;
  let raw = null, err = null;
  global.localStorage = undefined;
  try { raw = AoE2.saveGame(AoE2.SAVE_PATH + ':temp', g, 1000); } catch (e) { err = e; }
  global.localStorage = keep;
  return [err === null && typeof raw === 'string' && JSON.parse(raw).version === AoE2.CFG.VERSION &&
    global.localStorage === keep,
    err ? 'threw ' + err.message : 'bytes=' + String(raw && raw.length) +
      ' storageRestored=' + (global.localStorage === keep)];
});

saveCheck('save: re-saving an untouched game is byte-identical', () => {
  const g = AoE2.createState();
  const p = AoE2.SAVE_PATH + ':twice';
  const a = AoE2.saveGame(p, g, 1000);
  const b = AoE2.saveGame(p, g, 1000);
  return [a === b && a.length > 100, 'bytes ' + a.length + ' vs ' + b.length +
    ' identical=' + (a === b)];
});

const loadCheck = (name, fn) => {
  let out;
  try { out = fn(); } catch (e) { bad(name, 'threw ' + e.message); return; }
  check(out[0], name, out[1]);
};

/* The fixture the load checks share: one game 60 DTs into a real session — a tech
   researched, a player villager wounded and still on his berry, an arrow parked
   4px short of its mark, the militia 3 tiles into a straight move order, the
   barracks raised and selected, a squad bound to ctrl-1, the camera panned. Saved
   at a pinned writtenAt so the string it produces is reproducible. */
const LOAD_AT = 1000;
const playFixture = () => {
  const g = AoE2.createState();
  for (let i = 0; i < 60; i++) AoE2.stepSim(g, DT);
  const TS = AoE2.CFG.TILE;
  const site = AoE2.findSite(g.world, 40, 40, 2);
  const bar = AoE2.makeBuilding(g, 'barracks', 0, site.tx, site.ty);
  bar.built = 1;
  g.age[0] = 1;
  g.ageBonus[0] = 1;                               // the pair upgradeAge writes together
  g.techs[0].add('forge');
  const v = g.units.find((u) => u.team === 0 && u.kind === 'villager' &&
    u.order.src && u.order.src.kind === 'tile');
  AoE2.hitUnit(g, v, 5);                                   // one unit wounded
  const foe = g.units.find((u) => u.team === 1 && u.kind === 'villager');
  const shot = AoE2.spawnArrow(g, v, foe);                 // one arrow in flight
  shot.x = foe.x - 4; shot.y = foe.y;                      // 4px short: the next step resolves it
  const mil = g.units.find((u) => u.team === 0 && u.kind === 'militia');
  const mt = { tx: Math.floor(mil.x / TS), ty: Math.floor(mil.y / TS) };
  const run = (dx, dy) => {                                // the longest walkable ray from his tile
    let k = 0;
    while (k < 6 && AoE2.walkable(g, (mt.tx + dx * (k + 1)) * TS + TS / 2, (mt.ty + dy * (k + 1)) * TS + TS / 2)) k++;
    return k;
  };
  const best = DIRS8H.map(([dx, dy]) => ({ dx, dy, k: run(dx, dy) })).sort((a, b) => b.k - a.k)[0];
  const half = Math.max(1, Math.ceil(best.k / 2));
  if (best.k > 0) {                                        // the mover 3 tiles into a 6-tile route
    mil.x = (mt.tx + best.dx * half) * TS + TS / 2;
    mil.y = (mt.ty + best.dy * half) * TS + TS / 2;
    mil.order = { kind: 'move', x: (mt.tx + best.dx * best.k) * TS + TS / 2,
                  y: (mt.ty + best.dy * best.k) * TS + TS / 2 };
    mil.path = null; mil.pathFor = null; mil.pathAt = 0; mil.pathEpoch = -1;
  }
  g.groups = { 1: g.units.filter((u) => u.team === 0).map((u) => u.id) };
  g.selection = [];
  g.selectedBuilding = bar;                                // so hudState is `building`
  g.cam = { x: 120, y: 60 };
  return g;
};
const fixtureSave = () => {
  const g = playFixture();
  return { g, raw: AoE2.saveGame(AoE2.SAVE_PATH, g, LOAD_AT) };
};
const unitTuples = (g) => g.units.map((u) => [u.id, u.x, u.y, u.hp, u.order.kind].join(':')).join('|');
const bldTuples = (g) => g.buildings.map((b) => [b.id, b.kind, b.team, b.tx, b.ty, b.hp, b.built].join(':')).join('|');
const standardSettlement = (g) => {
  const std = AoE2.createState();
  return g.units.length === std.units.length && g.time === std.time &&
    JSON.stringify(g.age) === JSON.stringify(std.age) &&
    JSON.stringify(g.ageBonus) === JSON.stringify(std.ageBonus) &&
    g.nextId === std.nextId && g.wave === std.wave &&
    g.result === std.result && JSON.stringify(g.res) === JSON.stringify(std.res) &&
    JSON.stringify(g.buildings.map((b) => b.id)) === JSON.stringify(std.buildings.map((b) => b.id));
};

loadCheck('load: save -> load -> save is byte-identical', () => {
  const { raw } = fixtureSave();
  const g2 = AoE2.createState();
  const okLoad = AoE2.loadGame(AoE2.SAVE_PATH, g2, raw);
  const again = AoE2.saveGame(AoE2.SAVE_PATH + ':rt', g2, LOAD_AT);
  return [okLoad === true && again === raw,
    'loaded=' + okLoad + ' reSavedIsByteIdentical=' + (again === raw) +
    ' bytes=' + raw.length + '/' + again.length];
});

loadCheck('load: every observable field equals its pre-save value', () => {
  const { g, raw } = fixtureSave();
  const g2 = AoE2.createState();
  const okLoad = AoE2.loadGame(AoE2.SAVE_PATH, g2, raw);
  return [okLoad === true && unitTuples(g2) === unitTuples(g) && bldTuples(g2) === bldTuples(g) &&
    JSON.stringify(g2.res) === JSON.stringify(g.res) &&
    JSON.stringify(g2.age) === JSON.stringify(g.age) &&
    JSON.stringify(g2.ageBonus) === JSON.stringify(g.ageBonus) && g2.result === g.result &&
    JSON.stringify(g2.cam) === JSON.stringify(g.cam) &&
    g2.nextId === g.nextId && g2.time === g.time,
    'units=' + (unitTuples(g2) === unitTuples(g)) + ' buildings=' + (bldTuples(g2) === bldTuples(g)) +
    ' res=' + (JSON.stringify(g2.res) === JSON.stringify(g.res)) + ' age=' + JSON.stringify(g2.age) + '/' + JSON.stringify(g.age) +
    ' time=' + g2.time + '/' + g.time + ' nextId=' + g2.nextId + '/' + g.nextId];
});

loadCheck('load: a drag that names no owning pointer is dropped, an owned one is kept', () => {
  /* The pointer listeners only ever finish the drag whose `id` matches the pointer
     they came from, so `id` is a required field of a live drag — but a save written
     before that shape carries `{ x0, y0, x1, y1 }` and used to come back as a drag no
     release could ever clear, which wedged selection, the cursor and edge-scroll for
     the rest of the session. A press that died with the previous session is no press
     to resume, so the decode drops it and keeps an owned drag whole. */
  const { raw } = fixtureSave();
  const withDrag = (drag) => {
    const e = JSON.parse(raw);
    e.state.drag = drag;
    return JSON.stringify(e);
  };
  const owned = { x0: 10, y0: 20, x1: 30, y1: 40, t0: 500, id: 1 };
  const gLegacy = AoE2.createState();
  const gOwned = AoE2.createState();
  const okLegacy = AoE2.loadGame(AoE2.SAVE_PATH, gLegacy,
    withDrag({ x0: 10, y0: 20, x1: 30, y1: 40 }));          // the pre-pointer shape
  const okOwned = AoE2.loadGame(AoE2.SAVE_PATH, gOwned, withDrag(owned));
  return [okLegacy === true && gLegacy.drag === null && okOwned === true &&
      JSON.stringify(gOwned.drag) === JSON.stringify(owned),
    'legacyLoad=' + okLegacy + ' legacyDrag=' + JSON.stringify(gLegacy.drag) +
    ' ownedLoad=' + okOwned + ' ownedDrag=' + JSON.stringify(gOwned.drag)];
});

loadCheck('load: a wrong version resets the game instead of throwing', () => {
  const { raw } = fixtureSave();
  const body = JSON.parse(raw).state;
  const foreign = JSON.stringify({ version: 999, seed: AoE2.CFG.SEED, writtenAt: LOAD_AT, state: body });
  const g = playFixture();
  const okLoad = AoE2.loadGame(AoE2.SAVE_PATH, g, foreign);
  return [okLoad === false && standardSettlement(g),
    'loaded=' + okLoad + ' backToStandard=' + standardSettlement(g)];
});

loadCheck('load: a v1 save migrates to the per-team shape instead of being refused', () => {
  /* VERSION 1 (docs/TODO.md P1-11) stored one global age / ageBonus / techs set for
     the whole game; version 2 keeps them per team. The old bytes must still load: the
     player's half filled, the enemy's empty, and the re-save byte-identical to what a
     v2 game writes for the same fixture. */
  const g = playFixture();
  const v2 = AoE2.saveGame(AoE2.SAVE_PATH, g, LOAD_AT);
  const st = JSON.parse(v2).state;
  const v1 = JSON.stringify({ version: 1, seed: g.world.seed, writtenAt: LOAD_AT,
    state: Object.assign({}, st, { age: st.age[0], ageBonus: st.ageBonus[0], techs: st.techs[0] }) });
  const g2 = AoE2.createState();
  const okLoad = AoE2.loadGame(AoE2.SAVE_PATH, g2, v1);
  return [okLoad === true && JSON.stringify(g2.age) === '[1,0]' &&
      JSON.stringify(g2.ageBonus) === '[1,0]' && [...g2.techs[0]].join(',') === 'forge' &&
      g2.techs[1] instanceof Set && g2.techs[1].size === 0 &&
      AoE2.saveGame(AoE2.SAVE_PATH + ':v1', g2, LOAD_AT) === v2,
    'loaded=' + okLoad + ' age=' + JSON.stringify(g2.age) + ' ageBonus=' +
    JSON.stringify(g2.ageBonus) + ' techs0=[' + [...g2.techs[0]].join(',') + '] techs1=' +
    (g2.techs[1] instanceof Set ? '[' + [...g2.techs[1]].join(',') + ']' : String(g2.techs[1])) +
    ' resaveMatchesV2=' + (g2 && AoE2.saveGame(AoE2.SAVE_PATH + ':v1', g2, LOAD_AT) === v2)];
});

loadCheck('load: a missing slot resets instead of throwing', () => {
  const g = playFixture();
  const okLoad = AoE2.loadGame('aoe2mini:no-such-slot', g);
  return [okLoad === false && standardSettlement(g),
    'loaded=' + okLoad + ' backToStandard=' + standardSettlement(g)];
});

loadCheck('load: a corrupt string resets instead of throwing', () => {
  const a = playFixture();
  const ra = AoE2.loadGame(AoE2.SAVE_PATH, a, 'not json');
  const b = playFixture();
  const rb = AoE2.loadGame(AoE2.SAVE_PATH, b, '{"version":1');
  return [ra === false && standardSettlement(a) && rb === false && standardSettlement(b),
    "'not json'=" + ra + '/' + standardSettlement(a) + " truncated=" + rb + '/' + standardSettlement(b)];
});

loadCheck('load: a state of the wrong shape is refused', () => {
  const { g, raw } = fixtureSave();
  const state = JSON.parse(raw).state;
  const notArray = JSON.stringify({ version: AoE2.CFG.VERSION, seed: AoE2.CFG.SEED, writtenAt: LOAD_AT,
    state: Object.assign({}, state, { units: 'many' }) });
  const r1 = AoE2.loadGame(AoE2.SAVE_PATH, playFixture(), notArray);
  const partial = Object.assign({}, state);
  delete partial.buildings;
  const r2 = AoE2.loadGame(AoE2.SAVE_PATH, playFixture(),
    JSON.stringify({ version: AoE2.CFG.VERSION, seed: g.world.seed, writtenAt: LOAD_AT, state: partial }));
  return [r1 === false && r2 === false, 'units:"many"=' + r1 + ' missingBuildings=' + r2];
});

loadCheck('load: techs and blocks come back as per-team Sets and a Map', () => {
  const { raw } = fixtureSave();
  const state = JSON.parse(raw).state;
  const g2 = AoE2.createState();
  const okLoad = AoE2.loadGame(AoE2.SAVE_PATH, g2, raw);
  return [okLoad === true && Array.isArray(g2.techs) && g2.techs.every((t) => t instanceof Set) &&
    JSON.stringify(g2.techs.map((t) => Array.from(t))) === JSON.stringify(state.techs) &&
    g2.blocks instanceof Map && JSON.stringify(Object.fromEntries(g2.blocks)) === JSON.stringify(state.blocks),
    'techs=' + Object.prototype.toString.call(g2.techs) + '[' +
    g2.techs.map((t) => Array.from(t).join(',')).join('|') + ']' +
    ' blocks=' + Object.prototype.toString.call(g2.blocks) + ' keys=' + [...g2.blocks.keys()].join(',')];
});

loadCheck('load: decode rebuilds the blocks and bumps mapEpoch', () => {
  const { raw } = fixtureSave();
  const state = JSON.parse(raw).state;
  const g2 = AoE2.createState();
  g2.mapEpoch = 42;
  const okLoad = AoE2.loadGame(AoE2.SAVE_PATH, g2, raw);
  return [okLoad === true && g2.mapEpoch === 43 &&
    JSON.stringify(Object.fromEntries(g2.blocks)) === JSON.stringify(state.blocks),
    'mapEpoch=' + g2.mapEpoch + ' (was 42) blocksMatch=' +
    (JSON.stringify(Object.fromEntries(g2.blocks)) === JSON.stringify(state.blocks))];
});

loadCheck('load: a harvest order still reads the loaded world', () => {
  const { g, raw } = fixtureSave();
  const v = g.units.find((u) => u.team === 0 && u.kind === 'villager' &&
    u.order.src && u.order.src.kind === 'tile');
  const k = v.order.src.ty * g.world.w + v.order.src.tx;
  const saved = g.world.amount[k];
  const g2 = AoE2.createState();
  const okLoad = AoE2.loadGame(AoE2.SAVE_PATH, g2, raw);
  const v2 = g2.units.find((u) => u.id === v.id);
  const readBack = v2 && v2.order.kind === 'harvest' ? v2.order.src.amount : null;
  for (let i = 0; i < 25; i++) AoE2.stepSim(g2, DT);       // he keeps working off the rebuilt getter
  return [okLoad === true && readBack === saved && g2.world.amount[k] < saved,
    'src.amount=' + String(readBack) + ' saved=' + saved +
    ' afterStepping=' + g2.world.amount[k] + ' order=' + (v2 && v2.order.kind)];
});

loadCheck('load: a farm source is relinked, not left as a stored id', () => {
  const g = AoE2.createState();
  const site = AoE2.findSite(g.world, 30, 30, AoE2.BLD.farm.w) || { tx: 30, ty: 30 };
  const farm = AoE2.makeBuilding(g, 'farm', 0, site.tx, site.ty);
  farm.built = 1;
  const v = g.units.find((u) => u.team === 0 && u.kind === 'villager');
  const tc = g.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
  v.order = { kind: 'go_deposit', b: tc.id, src: AoE2.sourceFromFarm(farm) };
  const raw = AoE2.saveGame(AoE2.SAVE_PATH, g, LOAD_AT);
  const saved = JSON.parse(raw).state.units.find((u) => u.id === v.id).order;
  const g2 = AoE2.createState();
  const okLoad = AoE2.loadGame(AoE2.SAVE_PATH, g2, raw);
  const v2 = g2.units.find((u) => u.id === v.id);
  const farm2 = g2.buildings.find((b) => b.id === farm.id);
  const readBack = v2 && v2.order.src ? v2.order.src.amount : null;
  if (farm2) farm2.field -= 5;                        // the rebuilt getter must read the LOADED farm
  return [okLoad === true && saved.kind === 'go_deposit' && saved.b === tc.id &&
    saved.src.kind === 'farm' && saved.src.b === farm.id && saved.src.res === 'food' &&
    !!v2 && v2.order.kind === 'go_deposit' && v2.order.b === tc.id &&
    readBack === AoE2.BLD.farm.field && !!v2.order.src && v2.order.src.amount === farm2.field,
    'loaded=' + okLoad + ' order=' + JSON.stringify(saved) + ' src.amount ' +
    String(readBack) + ' -> ' + (v2 && v2.order.src ? v2.order.src.amount : 'none') +
    ' farm.field=' + (farm2 ? farm2.field : 'gone')];
});

loadCheck('load: an arrow in flight still hits the loaded unit', () => {
  const { g, raw } = fixtureSave();
  const foe = g.units.find((u) => u.team === 1 && u.kind === 'villager');
  const g2 = AoE2.createState();
  const okLoad = AoE2.loadGame(AoE2.SAVE_PATH, g2, raw);
  const mark = g2.units.find((u) => u.id === foe.id);
  const arrow = g2.projectiles[0];
  const linked = !!arrow && arrow.t === mark;
  const hp0 = mark.hp;
  AoE2.stepSim(g2, DT);
  return [okLoad === true && linked && g2.units.find((u) => u.id === foe.id).hp < hp0,
    'arrowRelinked=' + linked + ' hp=' + hp0 + ' -> ' + g2.units.find((u) => u.id === foe.id).hp +
    ' airborne=' + g2.projectiles.length];
});

loadCheck('load: a loaded unit mid-order finishes his route', () => {
  const { g, raw } = fixtureSave();
  const mover = g.units.find((u) => u.team === 0 && u.kind === 'militia');
  const aim = { x: mover.order.x, y: mover.order.y };
  const g2 = AoE2.createState();
  const okLoad = AoE2.loadGame(AoE2.SAVE_PATH, g2, raw);
  const u2 = g2.units.find((u) => u.id === mover.id);
  const start = Math.hypot(u2.x - aim.x, u2.y - aim.y);
  let best = start;
  for (let i = 0; i < 300 && u2.order.kind === 'move'; i++) {
    AoE2.stepSim(g2, DT);
    best = Math.min(best, Math.hypot(u2.x - aim.x, u2.y - aim.y));
  }
  return [okLoad === true && u2.order.kind === 'idle' && best <= 1,
    'start=' + start.toFixed(1) + 'px closest=' + best.toFixed(2) + 'px order=' + u2.order.kind];
});

loadCheck('load: the loaded HUD renders the same data-state', () => {
  const { g, raw } = fixtureSave();
  const before = [AoE2.hudState(g), AoE2.hudHtml(g)];
  const g2 = AoE2.createState();
  const okLoad = AoE2.loadGame(AoE2.SAVE_PATH, g2, raw);
  return [okLoad === true && before[0] === 'building' && AoE2.hudState(g2) === before[0] &&
    AoE2.hudHtml(g2) === before[1] && g2.buildings.indexOf(g2.selectedBuilding) >= 0 &&
    g2.selectedBuilding === g2.buildings.find((b) => b.id === g.selectedBuilding.id),
    'state=' + before[0] + '/' + AoE2.hudState(g2) + ' htmlEqual=' + (AoE2.hudHtml(g2) === before[1]) +
    ' selectedIsOwnBuilding=' + (g2.buildings.indexOf(g2.selectedBuilding) >= 0)];
});

/* The autosave schedule. Each check swaps a counting fakeStorage in for
   global.localStorage so it can see exactly how many writes a frame made. */
const autoCheck = (name, fn) => {
  let out;
  try { out = fn(); } catch (e) { bad(name, 'threw ' + e.message); return; }
  check(out[0], name, out[1]);
};
autoCheck('autosave: a fresh settlement is saved by the first frame', () => {
  const g = AoE2.createState();
  const startAt = g.autosaveAt;
  return withStorage((s) => {
    AoE2.stepGame(g, DT);
    const raw = AoE2.storageGet(AoE2.SAVE_PATH);
    const env = raw === null ? {} : JSON.parse(raw);
    return [startAt === 0 && s.sets === 1 && env.version === AoE2.CFG.VERSION &&
      env.state.time === DT && env.state.units.length === g.units.length,
      'autosaveAt=' + startAt + ' writes=' + s.sets + ' version=' + env.version +
      ' state.time=' + env.state.time + ' (DT=' + DT + ')'];
  });
});

autoCheck('autosave: a burst of changes inside the window writes once', () => {
  const g = fundedGame();
  const tc = g.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
  const site = AoE2.findSite(g.world, 40, 44, 1) || { tx: 40, ty: 44 };
  const market = builtAt(g, 'market', 46);
  const v = g.units.find((u) => u.team === 0 && u.kind === 'villager');
  return withStorage((s) => {
    AoE2.stepGame(g, DT);                                  // the frame the burst happens in
    const written = s.sets;
    const burstTime = g.time;
    g.selection = [v.id];
    AoE2.issueOrder(g, v.x, v.y);
    const house = AoE2.build(g, 'house', site.tx * AoE2.CFG.TILE, site.ty * AoE2.CFG.TILE);
    AoE2.train(g, tc, 'villager');
    if (house) AoE2.cancelConstruction(g, house);
    AoE2.trade(g, market, 'food', 'sell');
    const scheduled = g.autosaveAt;                            // the burst's schedule, before another frame runs
    const quiet = Math.ceil(AoE2.CFG.AUTOSAVE_DEBOUNCE / DT) - 1;
    for (let i = 0; i < quiet; i++) AoE2.stepGame(g, DT);
    const held = s.sets;                                       // the debounced window holds: nothing written
    AoE2.stepGame(g, DT);                                      // the window closes: the second write
    return [written === 1 && scheduled === burstTime + AoE2.CFG.AUTOSAVE_DEBOUNCE && held === 1 && s.sets === 2,
      'burst=' + written + ' scheduled=' + scheduled.toFixed(3) + ' after' + quiet + 'frames=' + held +
      ' next=' + s.sets];
  });
});

autoCheck('autosave: a quiet game writes only on the interval', () => {
  const g = AoE2.createState();
  return withStorage((s) => {
    AoE2.stepGame(g, DT);                                  // the write at t
    const first = s.sets;
    const t = g.time;
    const schedule = g.autosaveAt;
    for (let i = 0; i < 899; i++) AoE2.stepGame(g, DT);
    const quiet = s.sets;                                  // 899 frames later: still nothing written
    AoE2.stepGame(g, DT);                                  // the 900th: t + CFG.AUTOSAVE_EVERY
    return [first === 1 && schedule === t + AoE2.CFG.AUTOSAVE_EVERY && quiet === 1 && s.sets === 2 &&
      g.autosaveAt === g.time + AoE2.CFG.AUTOSAVE_EVERY &&
      Math.abs(g.time - t - AoE2.CFG.AUTOSAVE_EVERY) < DT,
      'writes ' + first + '->' + quiet + '->' + s.sets + ' t=' + t.toFixed(3) +
      ' schedule=' + schedule.toFixed(3) + ' now=' + g.time.toFixed(3)];
  });
});

autoCheck('autosave: every mutator moves the schedule', () => {
  const sites = [
    ['issueOrder', (g) => {
      const v = g.units.find((u) => u.team === 0 && u.kind === 'villager');
      g.selection = [v.id];
      AoE2.issueOrder(g, v.x, v.y);
    }],
    ['build', (g) => {
      const s = AoE2.findSite(g.world, 40, 40, 1) || { tx: 40, ty: 40 };
      AoE2.build(g, 'house', s.tx * AoE2.CFG.TILE, s.ty * AoE2.CFG.TILE);
    }],
    ['train', (g) => AoE2.train(g, g.buildings.find((b) => b.team === 0 && b.kind === 'town_center'), 'villager')],
    ['cancelConstruction', (g) => AoE2.cancelConstruction(g, siteAt(g, 'house', 44))],
    ['demolish', (g) => AoE2.demolish(g, builtAt(g, 'house', 45))],
    ['removeBuilding', (g) => AoE2.removeBuilding(g, siteAt(g, 'house', 46))],
    ['researchTech', (g) => AoE2.researchTech(g, builtAt(g, 'blacksmith', 47), 'forge')],
    ['trade', (g) => AoE2.trade(g, builtAt(g, 'market', 48), 'food', 'sell')],
    ['upgradeAge', (g) => AoE2.upgradeAge(g)],
  ];
  const tally = sites.map(([name, run]) => {
    const g = fundedGame();
    g.autosaveAt = Infinity;
    run(g);
    return name + '=' + (g.autosaveAt === g.time + AoE2.CFG.AUTOSAVE_DEBOUNCE ? 'ok' : String(g.autosaveAt));
  });
  const g = fundedGame();
  g.autosaveAt = 5;
  AoE2.resetGame(g);
  const reset = g.autosaveAt === g.time;
  return [tally.every((t) => t.endsWith('=ok')) && reset, tally.join(' ') + ' resetGame=' + reset];
});

autoCheck('autosave: a training that completes marks the game again', () => {
  const g = fundedGame();
  const tc = g.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
  return withStorage((s) => {
    AoE2.stepGame(g, DT);                                  // the frame that writes the settlement
    AoE2.train(g, tc, 'villager');
    const afterTrain = g.autosaveAt;
    const frames = Math.ceil(AoE2.KINDS.villager.time / DT) + 2;
    let bornAt = null, bornSchedule = null;
    for (let i = 0; i < frames; i++) {
      const n = g.units.length;
      AoE2.stepGame(g, DT);
      if (bornAt === null && g.units.length > n) { bornAt = g.time; bornSchedule = g.autosaveAt; }
    }
    return [bornAt !== null && bornSchedule === bornAt + AoE2.CFG.AUTOSAVE_DEBOUNCE &&
      bornSchedule > afterTrain,
      'trained at t=' + (bornAt === null ? 'never' : bornAt.toFixed(3)) + ' schedule ' +
      afterTrain.toFixed(3) + ' -> ' + (bornSchedule === null ? 'n/a' : bornSchedule.toFixed(3)) +
      ' writes=' + s.sets];
  });
});

/* The page surface: every check boots its own doc with the slot set up first, so
   the boot path and the button paths are proven on the real markup. */
const savedFixture = (at = 1000) => {
  const g = AoE2.createState();
  g.started = true;                                     // a save always comes from a booted game
  g.age[0] = 1;
  g.res[0] = { food: 100, wood: 100, gold: 999, stone: 50 };
  const p = AoE2.workPos(g, g.buildings.find((b) => b.team === 0 && b.kind === 'town_center'), null);
  AoE2.makeUnit(g, 'archer', 0, p.x, p.y);
  return [g, AoE2.saveGame(AoE2.SAVE_PATH, g, at)];
};

uiCheck('ui: the header Save button writes the slot and toasts', () => {
  const [, raw] = savedFixture();
  return bootFixture(raw, (doc, Game) => {
    Game.dom.save.fire('click');
    const slot = AoE2.storageGet(AoE2.SAVE_PATH);
    const env = slot === null ? {} : JSON.parse(slot);
    return [slot !== null && env.version === AoE2.CFG.VERSION &&
      JSON.stringify(env.state) === JSON.stringify(JSON.parse(raw).state) &&
      env.state.nextId === Game.nextId && Game.toastMsg === 'Saved',
      'slotHoldsLoadedGame=' + (slot !== null &&
        JSON.stringify(env.state) === JSON.stringify(JSON.parse(raw).state)) +
      ' version=' + env.version + ' state.nextId=' + env.state.nextId + '/' + Game.nextId +
      ' toast=' + JSON.stringify(Game.toastMsg)];
  });
});

uiCheck('ui: N starts a new game, clears the slot and writes the new game back', () => {
  const [src, raw] = savedFixture();
  return bootFixture(raw, (doc, Game) => {
    const loaded = Game.units.length === src.units.length && Game.age[0] === 1 && Game.res[0].gold === 999;
    doc.fire('keydown', { key: 'n' });
    const cleared = AoE2.storageGet(AoE2.SAVE_PATH) === null;
    const after = [Game.units.length, Game.time, Game.age[0]].join('/');
    AoE2.stepGame(Game, DT);
    const slot = AoE2.storageGet(AoE2.SAVE_PATH);
    const env = slot === null ? {} : JSON.parse(slot);
    return [loaded && cleared && after === '10/0/0' && slot !== null && env.state.units.length === 10,
      'loaded=' + loaded + ' clearedSlot=' + cleared + ' units/time/age=' + after +
      ' rewrittenUnits=' + (slot === null ? 'none' : env.state.units.length)];
  });
});

uiCheck('ui: the footer’s New map button clears the slot too', () => {
  const [src, raw] = savedFixture();
  return bootFixture(raw, (doc, Game) => {
    const btn = stubEl('button', 'btnRestart', 80, 24);
    btn.setAttribute('data-act', 'restart');
    Game.dom.commands.listeners.click.forEach((fn) => fn({ target: btn }));
    return [Game.units.length === 10 && Game.age[0] === 0 && Game.res[0].gold === AoE2.CFG.START.gold &&
      AoE2.storageGet(AoE2.SAVE_PATH) === null,
      'was=' + src.units.length + ' units, now=' + Game.units.length + ' age=' + Game.age[0] +
      ' gold=' + Game.res[0].gold + ' slot=' + (AoE2.storageGet(AoE2.SAVE_PATH) === null ? 'cleared' : 'filled')];
  });
});

uiCheck('ui: the result overlay’s New game button clears the slot too', () => {
  const [src, raw] = savedFixture();
  return bootFixture(raw, (doc, Game) => {
    const btn = stubEl('button', 'btnNew', 80, 24);
    btn.setAttribute('data-act', 'restart');
    Game.dom.result.listeners.click.forEach((fn) => fn({ target: btn }));
    return [Game.units.length === 10 && Game.result === null &&
      AoE2.storageGet(AoE2.SAVE_PATH) === null,
      'was=' + src.units.length + ' units, now=' + Game.units.length +
      ' result=' + String(Game.result) +
      ' slot=' + (AoE2.storageGet(AoE2.SAVE_PATH) === null ? 'cleared' : 'filled')];
  });
});

uiCheck('boot: opening the page with a slot restores that game', () => {
  const [src, raw] = savedFixture();
  return bootFixture(raw, (doc, Game) => [
    AoE2.saveGame(AoE2.SAVE_PATH, Game, 1000) === raw &&
    Game.units.length === src.units.length && Game.age[0] === 1 && Game.res[0].gold === 999 &&
    Game.units.some((u) => u.kind === 'archer' && u.team === 0),
    'units=' + Game.units.length + '/' + src.units.length + ' age=' + Game.age[0] +
    ' gold=' + Game.res[0].gold +
    ' resavedIdentical=' + (AoE2.saveGame(AoE2.SAVE_PATH, Game, 1000) === raw),
  ]);
});

uiCheck('boot: opening the page with an empty slot gives the standard settlement', () => {
  const std = AoE2.createState();
  return bootFixture(null, (doc, Game) => [
    Game.units.length === std.units.length && Game.units.length === 10 &&
    JSON.stringify(Game.age) === JSON.stringify(std.age) &&
    Game.time === std.time && JSON.stringify(Game.res[0]) === JSON.stringify(AoE2.CFG.START),
    'units=' + Game.units.length + '/' + std.units.length + ' age=' + Game.age[0] +
    ' res0=' + JSON.stringify(Game.res[0]),
  ]);
});

report();
