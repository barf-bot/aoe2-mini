'use strict';
/* economy -- gathering, drop-offs, depletion, population and resource bookkeeping. No DOM. */

/** How many of u's villagers are already on a tile (harvesting it or carrying
 *  from it). Used to spread the starting squad — four villagers on one berry
 *  is how the economy used to stall at 420 food. */
function workersOnTile(Game, u, tx, ty) {
  let n = 0;
  for (const v of Game.units) {
    if (v.dead || v === u || v.team !== u.team || v.kind !== 'villager') continue;
    const s = (v.order.kind === 'harvest' || v.order.kind === 'go_deposit') ? v.order.src : null;
    if (s && s.kind === 'tile' && s.tx === tx && s.ty === ty) n++;
  }
  return n;
}

/** Score a drop-off candidate for a carried resource: the resource's dedicated
 *  building is best (0), a Town Center always works (+300), another farm takes
 *  food when no mill exists (+150); everything else is not a drop-off. */
function dropTargetScore(res, b) {
  const want = { food: 'mill', wood: 'lumber_camp', gold: 'mining_camp', stone: 'mining_camp' }[res];
  if (!want) return Infinity;
  if (b.kind === want) return 0;
  if (b.kind === 'town_center') return 300;
  if (res === 'food' && b.kind === 'farm') return 150;
  return Infinity;
}

/** Where a carrying villager walks: wood -> Lumber Camp -> TC,
 *  gold/stone -> Mining Camp -> TC, food -> Mill -> farms -> TC. */
function findDropoff(Game, unit, src) {
  const res = src ? src.res : unit.carryRes;
  if (!res) return null;
  let best = null, bestScore = Infinity;
  for (const b of Game.buildings) {
    if (b.team !== unit.team || b.built < 1) continue;
    if (src && src.kind === 'farm' && b.id === src.b) continue;   // never its own farm
    const score = dropTargetScore(res, b);
    if (score === Infinity) continue;
    const d = Math.hypot(b.x - unit.x, b.y - unit.y) + score;
    if (d < bestScore) { bestScore = d; best = b; }
  }
  return best;
}

function deposit(Game, unit, drop) {
  const amount = unit.carry;
  if (unit.carryRes) Game.res[unit.team][unit.carryRes] += amount;
  unit.carry = 0;
  unit.carryRes = null;
}

/** A resource tile whose stock reaches 0 disappears: the type reverts to GRASS
 *  (the amount stays 0), so the bush, tree or ore node stops being drawn and --
 *  per the T2 rule in walkable -- stops blocking movement. Only tile sources
 *  deplete: a farm's field empties in place (see sourceFromFarm). Returns true
 *  when a spent resource tile was actually converted. */
function depleteTile(Game, tx, ty) {
  const world = Game.world;
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return false;
  const i = ty * world.w + tx;
  if (!RES_OF_TILE[world.type[i]] || world.amount[i] > 0) return false;
  world.type[i] = T.GRASS;
  Game.mapEpoch++;                         // the tile walks now: routes across it are stale
  return true;
}

/** Keep a villager employed: the same tile while it holds stock, otherwise the
 *  nearest tile of the SAME resource within 5 tiles (the T4 re-queue radius --
 *  the old "or any other resource within 20" fallback is gone, so a spent grove
 *  with nothing of the same kind nearby leaves him idle instead of sending him
 *  across the map for wood). */
function nextSource(Game, u, src) {
  if (src.amount > 0) return src;
  if (src.kind !== 'tile') return null;
  const alt = findAlternative(Game.world, u, src.res, 5);
  return alt ? sourceFromTile(Game, u, alt.tx, alt.ty) : null;
}

/** After depositing, re-point at the source. A tile can empty while the
 *  basket walks (another villager drains it), so a dead tile falls back to
 *  the same alternatives the harvest path uses instead of idling the
 *  villager forever (the food-stall regression). */
function resumeGather(Game, u, src) {
  if (src.kind === 'tile') {
    const live = src.amount > 0 ? sourceFromTile(Game, u, src.tx, src.ty) : null;
    const alt = findAlternative(Game.world, u, src.res, 5);
    const next = live || (alt ? sourceFromTile(Game, u, alt.tx, alt.ty) : null);
    return next ? { kind: 'harvest', src: next } : { kind: 'idle' };
  }
  const b = Game.buildings.find(x => x.id === src.b);
  if (!b || b.built < 1 || b.field <= 0) return { kind: 'idle' };
  return { kind: 'harvest', src: sourceFromFarm(b) };
}

/* --------------------------- economy helpers --------------------------- */

function popCap(Game, team) {
  let cap = 0;
  for (const b of Game.buildings) if (b.team === team && b.built >= 1) cap += BLD[b.kind].pop || 0;
  return cap;
}

function popUsed(Game, team) {
  let n = 0;
  for (const u of Game.units) if (u.team === team && !u.dead && u.kind === 'villager') n++;
  return n;
}

function selectedUnits(Game) {
  const out = [];
  for (const id of Game.selection) {
    const u = Game.units.find(x => x.id === id && !x.dead);
    if (u) out.push(u);
  }
  return out;
}

function canAfford(Game, team, cost) { return !missing(Game, team, cost); }

function missing(Game, team, cost) {
  for (const k in cost) if ((Game.res[team][k] || 0) < cost[k]) return k;
  return '';
}

function spend(Game, team, cost) { for (const k in cost) Game.res[team][k] -= cost[k]; }
function refund(Game, team, cost) { for (const k in cost) Game.res[team][k] += cost[k]; }
