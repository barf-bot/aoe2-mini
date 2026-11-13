'use strict';
/* entities -- unit / building factories, resource sources, work spots. No DOM. */

/** Attach (or clear) the unit atlas on Game: the ONE injection point, so the
 *  renderer has a single field to consult and the harnesses can hand it an
 *  image without touching the browser. See SPRITE_SHEET in src/config.js and
 *  tools/gen-atlas.js, which renders that table into assets/sprites.png. */
function setAtlas(Game, source) {
  if (!Game.sprites) Game.sprites = { atlas: null };
  Game.sprites.atlas = source || null;
  return Game.sprites.atlas;
}

/** A harvest source: either a world tile or a farm's field. Both expose
 *  {res, x, y, amount getter/setter} so the harvest code has one shape. */
function sourceFromTile(Game, unit, tx, ty) {
  const world = Game.world;
  const t = tileRes(world, tx, ty);
  if (!t) return null;
  const spot = workSpot(Game, unit, tx, ty);      // null: no tile to stand on
  if (!spot) return null;
  return {
    kind: 'tile', tx, ty, res: t.res, x: spot.x, y: spot.y,
    get amount() { return world.amount[ty * world.w + tx]; },
    set amount(v) { world.amount[ty * world.w + tx] = Math.max(0, Math.round(v)); },
  };
}

function sourceFromFarm(b) {
  return {
    kind: 'farm', b: b.id, res: 'food', x: b.x, y: b.y,
    get amount() { return b.field; },
    set amount(v) { b.field = Math.max(0, v); },
  };
}

/** Work position: the walkable tile centre nearest the unit among the 8
 *  neighbours of the target tile (mirrors AoE2's "stand next to the thing").
 *  Only tiles walkable() accepts are offered, so a worker is never parked on a
 *  resource or under a building; null when the target has no walkable neighbour
 *  (sourceFromTile and orderForUnit both handle that). */
function workSpot(Game, unit, tx, ty) {
  const c = (x, y) => ({ x: x * CFG.TILE + CFG.TILE / 2, y: y * CFG.TILE + CFG.TILE / 2 });
  let best = null, bd = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = tx + dx, y = ty + dy;
      if (!walkable(Game, x * CFG.TILE + CFG.TILE / 2, y * CFG.TILE + CFG.TILE / 2)) continue;
      const p = c(x, y);
      const d = (p.x - unit.x) ** 2 + (p.y - unit.y) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
  }
  return best;
}

function makeUnit(Game, kind, team, x, y) {
  const k = KINDS[kind];
  const u = {
    id: Game.nextId++, kind, team, x, y,
    hp: k.hp, maxHp: k.hp, speed: k.speed, atk: k.atk, atkTime: k.atkTime, r: k.r,
    atkType: k.atkType, range: k.range, minRange: k.minRange, reload: k.reload,
    accuracy: k.accuracy,
    face: 1, anim: 0, // sprite mirror + walking clock, both set by moveUnit
    order: { kind: 'idle' }, carry: 0, carryRes: null, work: 0, cd: 0, dead: false,
    slot: null, // the formation tile his current `move` order owns (formationSlots)
    // the A* route behind `order` (findPath/moveUnit): the tile list, the tile
    // being walked to, and the goal tile + map version that route was built for.
    path: null, pathAt: 0, pathFor: null, pathEpoch: -1,
  };
  Game.units.push(u);
  return u;
}

function makeBuilding(Game, kind, team, tx, ty) {
  const def = BLD[kind];
  const b = {
    id: Game.nextId++, kind, team, tx, ty, w: def.w, h: def.h,
    x: (tx + def.w / 2) * CFG.TILE, y: (ty + def.h / 2) * CFG.TILE,
    hp: def.hp, maxHp: def.hp, built: 0, field: def.field ? def.field : 0,
    time: def.time, queue: [], born: Game.time, cd: 0, research: null,
  };
  Game.buildings.push(b);
  rebuildBlocks(Game);                       // occupancy first: workPos reads it
  Game.mapEpoch++;                           // the walkable set moved: every cached route is stale
  /* The footprint is solid ground now, so anyone who was standing on it moves to
     the work spot beside the building instead of living inside it (AoE2 does the
     same when a house goes up under a villager). */
  const tiles = Game.blocks.get(b.id) || [];
  for (const u of Game.units) {
    if (u.dead) continue;
    const i = Math.floor(u.y / CFG.TILE) * Game.world.w + Math.floor(u.x / CFG.TILE);
    if (tiles.indexOf(i) < 0) continue;
    const spot = workPos(Game, b, u);              // the ring tile nearest to him
    u.x = spot.x; u.y = spot.y;
  }
  return b;
}

/** Building id -> list of tile indices it occupies (units walk around them). */
function rebuildBlocks(Game) {
  const map = new Map();
  const occupied = new Set();
  for (const b of Game.buildings) {
    const tiles = [];
    for (let dy = 0; dy < b.h; dy++) {
      for (let dx = 0; dx < b.w; dx++) {
        const i = (b.ty + dy) * Game.world.w + (b.tx + dx);
        tiles.push(i);
        occupied.add(i);
      }
    }
    map.set(b.id, tiles);
  }
  Game.blocks = map;
  Game.occupied = occupied;
}

/** The one way a building leaves the world (combat raze, cancel, demolish):
 *  drop it from Game.buildings, rebuild occupancy, and clear a footer
 *  selection that points at it — hitBuilding used to splice by hand and left
 *  Game.selectedBuilding dangling on raze. */
function removeBuilding(Game, b) {
  const i = Game.buildings.indexOf(b);
  if (i < 0) return false;
  Game.buildings.splice(i, 1);
  rebuildBlocks(Game);
  Game.mapEpoch++;                         // the walkable set moved again (findPath)
  markDirty(Game);                         // the board changed, so a save is owed
  if (Game.selectedBuilding === b) Game.selectedBuilding = null;
  setResult(Game);
  return true;
}

/** The win condition, read off the board instead of remembered: the side with no
 *  Town Center left has lost, and the first side to lose one decides the game —
 *  hitBuilding (combat), cancelConstruction and demolish all remove through
 *  removeBuilding, so a raze and a demolish are the same event to the rules.
 *  stepSim freezes on a set result and renderHud paints the #result overlay. */
function setResult(Game) {
  if (Game.result) return;
  const alive = (team) => Game.buildings.some((b) => b.kind === 'town_center' && b.team === team);
  if (!alive(1)) Game.result = 'victory';
  else if (!alive(0)) Game.result = 'defeat';
  playSfx(Game, Game.result);          // one statement serves both result rows
}

/** workPos(Game, b, u): the walkable ring tile nearest to u — the tile a unit
 *  works or stands at beside building b, so a builder east of the site works from
 *  its east side instead of walking around to the far corner, and two villagers
 *  arriving from opposite sides take different tiles. The ring itself is
 *  standingSpots', the one the starting squad lines up on. With no unit to be
 *  near — the unit makeUnit has not placed yet (sim's training queue, boot's
 *  roster fallback) — the answer is the ring's first tile, the single spot every
 *  spawn used before; a building whose rings out to 8 are all solid has no spot
 *  at all and answers with its own centre, the point moveUnit accepts for such a
 *  site. */
function workPos(Game, b, u) {
  const ring = standingSpots(Game, b, 2 * (b.w + b.h) + 4);   // every tile touching b
  const first = ring[0] || { x: b.x, y: b.y };
  if (!u) return first;
  let best = first, d2 = Infinity;
  for (const p of ring) {
    const dx = p.x - u.x, dy = p.y - u.y, dd = dx * dx + dy * dy;
    if (dd < d2) { d2 = dd; best = p; }
  }
  return best;
}

/** n walkable tile centres to stand units around a building: the footprint is
 *  solid, so a starting squad lines up on the ground touching it — the south
 *  edge first, the way the starting squad always lined up, then the rest of the
 *  ring, then wider rings until n spots exist. */
function standingSpots(Game, b, n) {
  const out = [];
  const centre = (x, y) => ({ x: x * CFG.TILE + CFG.TILE / 2, y: y * CFG.TILE + CFG.TILE / 2 });
  for (let r = 1; r <= 8 && out.length < n; r++) {
    for (let dy = b.h - 1 + r; dy >= -r && out.length < n; dy--) {
      for (let dx = -r; dx <= b.w - 1 + r && out.length < n; dx++) {
        if (dx >= 0 && dx < b.w && dy >= 0 && dy < b.h) continue;   // the footprint itself
        const p = centre(b.tx + dx, b.ty + dy);
        if (walkable(Game, p.x, p.y)) out.push(p);
      }
    }
  }
  return out;
}
