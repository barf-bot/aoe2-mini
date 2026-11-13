'use strict';
/* checks/01-world-roster.js -- world generation, the starting roster, starter spread, depletion.
   Runs on its own (`node tools/checks/01-world-roster.js`) against a freshly booted game. */

const {
  AoE2, Game, blueVill, check, dataUnits, flatState, ok, setTile, tIdx, tc, tileCentre, report,
} = require('../lib/harness');

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
check(Game.buildings.filter(b => b.team === 1 && b.built).length === 1, 'roster: enemy Town Center exists', 'ok');
check(blueVill().length === 4, 'roster: 4 player villagers', String(blueVill().length));
check(Game.units.filter(u => u.team === 0 && u.kind === 'militia').length === 1,
  'roster: 1 player starting warrior', 'ok');
check(blueVill().every(v => v.order.kind === 'harvest'), 'roster: every villager starts on a harvest order',
  blueVill().map(v => v.order.kind).join(','));
check(AoE2.popCap(Game, 0) === 5, 'pop: Town Center caps population at 5', String(AoE2.popCap(Game, 0)));
check(AoE2.popUsed(Game, 0) === 5, 'pop: 5 of 5 used (the starting militia counts)', String(AoE2.popUsed(Game, 0)));
const startRes = JSON.stringify(Game.res[0]);
check(Game.res[0].wood === 100 && Game.res[0].food === 100, 'roster: starting stock 100 food / 100 wood', startRes);
// T1 pinned six numbers by hand; they now come from data/, so compare against the
// tables instead of literals (tools/check-stats.mjs is the equality proof, this is
// the in-game assertion that the generated src/config.js is what the sim uses).
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

report();
