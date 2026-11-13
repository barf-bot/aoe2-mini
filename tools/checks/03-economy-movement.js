'use strict';
/* checks/03-economy-movement.js -- 30 s of simulated play: economy + movement invariants, walkability, facing.
   Runs on its own (`node tools/checks/03-economy-movement.js`) against a freshly booted game. */

const {
  AoE2, DT, Game, check, pad, solidTile, tOf, tc, report,
} = require('../lib/harness');

/* ---- 6. simulate 30s: economy + movement invariants ----------------- */
const step = (n) => { for (let i = 0; i < n; i++) AoE2.stepGame(Game, DT); };
const food0 = Game.res[0].food;
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
const expect = houseHere && typeof AoE2.workPos === 'function' ? AoE2.workPos(fresh, houseHere, caught) : null;
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

report();
