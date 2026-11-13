'use strict';
/* movement -- A* pathfinding, steering, formations, walkability, separation. No DOM. */

/** The tile containing a world-space point. The one px→tile conversion in the
 *  code: walkable() and findPath() both go through it, so a tile is only ever
 *  addressed one way. */
function tileOf(px, py) { return { tx: Math.floor(px / CFG.TILE), ty: Math.floor(py / CFG.TILE) }; }

/** The eight neighbour offsets, and the rule they carry: a diagonal step needs
 *  BOTH its orthogonal neighbours open, so nobody squeezes through the pinched
 *  corner between two walls — the AoE2 movement rule. */
const DIRS8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/** The binary min-heap findPath's open set needs (entries are [fScore, tile]);
 *  ~20 lines of percolate, because scanning an array open set per pop is O(n)
 *  on a board with 9216 tiles and the frame loop cannot afford it. */
function heapPush(hp, e) {
  hp.push(e);
  let i = hp.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (hp[p][0] <= e[0]) break;
    hp[i] = hp[p]; i = p;
  }
  hp[i] = e;
}
function heapPop(hp) {
  const top = hp[0], last = hp.pop();
  if (hp.length) {
    hp[0] = last;
    for (let i = 0;;) {
      const l = 2 * i + 1, r = l + 1;
      let s = i;
      if (l < hp.length && hp[l][0] < hp[i][0]) s = l;
      if (r < hp.length && hp[r][0] < hp[s][0]) s = r;
      if (s === i) break;
      const t = hp[i]; hp[i] = hp[s]; hp[s] = t;
      i = s;
    }
  }
  return top;
}

/** A* over the tile grid — the roadmap P0.2 route finder. `from`/`to` are tiles
 *  as tileOf() returns them. 8-connected with uniform cost (any open tile costs
 *  1, whatever the direction) and the admissible Chebyshev heuristic, so a route
 *  comes out within a hair of optimal. The start tile is accepted even when it
 *  is solid (a unit may stand on a farm tile or a fresh foundation) while every
 *  later tile must satisfy walkable(). Returns the route start→goal inclusive,
 *  or null when the goal is unreachable or the search burns
 *  CFG.ASTAR_MAX_NODES expansions — a hopeless query must not stall the frame
 *  loop. Every call counts itself in Game.pathQueries, so a caller that routes
 *  every frame shows up as a number the harness can pin. */
function findPath(Game, from, to) {
  Game.pathQueries = (Game.pathQueries || 0) + 1;
  const w = Game.world.w, h = Game.world.h;
  if (!from || !to) return null;
  const fx = from.tx, fy = from.ty, gx = to.tx, gy = to.ty;
  if (fx < 0 || fy < 0 || fx >= w || fy >= h || gx < 0 || gy < 0 || gx >= w || gy >= h) return null;
  const centre = (t) => t * CFG.TILE + CFG.TILE / 2;
  const openAt = (tx, ty) => (tx === fx && ty === fy) || walkable(Game, centre(tx), centre(ty));
  const hCost = (tx, ty) => Math.max(Math.abs(tx - gx), Math.abs(ty - gy));
  const idx = (tx, ty) => ty * w + tx;
  const goal = idx(gx, gy), start = idx(fx, fy);
  const gScore = new Map([[start, 0]]);
  const cameFrom = new Map();
  const closed = new Set();
  const open = [];
  heapPush(open, [hCost(fx, fy), start]);
  for (let expansions = 0; open.length;) {
    const cur = heapPop(open)[1];
    if (closed.has(cur)) continue;                          // stale heap entry
    if (cur === goal) {                                     // cheapest route: walk it back
      const rev = [];
      for (let c = cur; c !== undefined; c = cameFrom.get(c)) rev.push({ tx: c % w, ty: (c / w) | 0 });
      return rev.reverse();
    }
    closed.add(cur);
    if (expansions++ >= CFG.ASTAR_MAX_NODES) return null;   // budget spent, goal unreachable in time
    const cx = cur % w, cy = (cur / w) | 0, cg = gScore.get(cur);
    for (let k = 0; k < 8; k++) {
      const dx = DIRS8[k][0], dy = DIRS8[k][1], nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (dx && dy && !(openAt(cx, ny) && openAt(nx, cy))) continue;   // no corner-cutting
      const ni = idx(nx, ny);
      if (closed.has(ni) || !openAt(nx, ny)) continue;
      if (cg + 1 < (gScore.has(ni) ? gScore.get(ni) : Infinity)) {
        gScore.set(ni, cg + 1);
        cameFrom.set(ni, cur);
        heapPush(open, [cg + 1 + hCost(nx, ny), ni]);
      }
    }
  }
  return null;
}

/** The pre-route walk, now a named primitive: one frame's step of `u` toward
 *  (ax,ay) — the sprite mirror, the walking clock the step bob reads, the step
 *  and the X/Y slide that keeps a unit moving along a water edge instead of
 *  sticking to it. Returns true when the step lands within `s` of the aim.
 *  moveUnit is the only caller; the aim comes from the route, or from the
 *  ordered point itself when there is no route (see moveUnit). */
function stepToward(Game, u, ax, ay, s, dt) {
  const dx = ax - u.x, dy = ay - u.y;
  const d = Math.hypot(dx, dy);
  if (d <= s) return true;
  if (dx > 0) u.face = 1; else if (dx < 0) u.face = -1;
  u.anim += dt;
  const stepLen = Math.min(d - s * 0.5, u.speed * dt);
  const nx = u.x + (dx / d) * stepLen, ny = u.y + (dy / d) * stepLen;
  if (walkable(Game, nx, ny)) { u.x = nx; u.y = ny; return (d - stepLen) <= s; }
  if (walkable(Game, nx, u.y)) { u.x = nx; return false; }        // slide on X
  if (walkable(Game, u.x, ny)) { u.y = ny; return false; }        // slide on Y
  return false;
}

/** Move `u` toward (x,y) ALONG his A* route (findPath) instead of in a straight
 *  line: the route's own tiles are the walkability answer, so a unit walks
 *  *around* the inlet, the forest and the house instead of nose-pressing them,
 *  and the waypoint list (the route's tile centres, then the exact ordered
 *  point) is what T4's formation slots will be judged by.
 *
 *  One rule says when the cached route is thrown away, and it is the design's
 *  re-path rule: the order's goal tile changed (`u.pathFor`), the walkable set
 *  moved under it (`Game.mapEpoch` — a building went up, a tile was depleted),
 *  or the tile he is walking to stopped being walkable ("the path's end was
 *  taken"). The answer is cached even when it is `null`, so a doomed order costs
 *  one query and the `move` branch retires it instead of letting him press the
 *  shore forever.
 *
 *  The route's last tile IS the tile holding (x,y), so the last leg aims at the
 *  exact point: the ≤ 15.6 px between a tile centre and any point inside it are
 *  walked straight, which is what keeps the `d <= stop` rule — and every
 *  caller's radius (attack range, work-spot stop) — meaning exactly what it
 *  meant before routes existed. `u.face`/`u.anim` are still written by
 *  stepToward, so the facing checks (tools/checks/03-economy-movement.js) keep pinning them.
 *
 *  A goal A* cannot route at all (`u.path === null`) still gets the old straight
 *  step: `standTarget` below hands every order a walkable tile to end on, so what
 *  is left for the fallback are the two cases routing has nothing to say about —
 *  the ordered tile is the one he already stands on (a villager working from a farm
 *  cell or a fresh foundation), and a site whose whole ring is solid, where
 *  `workPos` answers with the building's own centre. */
function moveUnit(Game, u, x, y, dt, stop) {
  const s = stop || 1;
  if (Math.hypot(x - u.x, y - u.y) <= s) return true;             // the caller's own arrival rule
  const goal = tileOf(x, y), own = tileOf(u.x, u.y);
  // A route can only END on a walkable tile (T1: any tile but the start must
  // satisfy walkable), so an order that names a solid thing's centre — `harvest`
  // at a berry, `go_deposit` at a dropoff, `attack`/`build` before T3's
  // standTarget gives them a spot — has nothing to route to and keeps the old
  // straight step. Orders that do name a walkable tile get route semantics:
  // `u.path` is their route, and `null` (routed, nowhere to go) retires the
  // order in updateUnit instead of letting him press the shore — the one case
  // where refusing is right is a move order over water, and that is exactly
  // where findPath answers null.
  if (!((goal.tx === own.tx && goal.ty === own.ty) || walkable(Game, x, y))) {
    return stepToward(Game, u, x, y, s, dt);
  }
  const same = u.pathFor !== null && u.pathEpoch === Game.mapEpoch
    && u.pathFor.tx === goal.tx && u.pathFor.ty === goal.ty;      // built for THIS order, THIS map
  const next = u.path !== null && u.pathAt < u.path.length ? u.path[u.pathAt] : null;
  if (!same || !(next === null
    || walkable(Game, next.tx * CFG.TILE + CFG.TILE / 2, next.ty * CFG.TILE + CFG.TILE / 2))) {
    u.path = findPath(Game, own, goal);                            // counts itself in pathQueries
    u.pathFor = goal;                                              // a null route is cached too
    u.pathEpoch = Game.mapEpoch;
    u.pathAt = u.path && u.path.length > 1 ? 1 : 0;                // path[0] is the tile he stands on
  }
  if (u.path === null) return false;                // routed and found nothing: nothing to walk
  const endLeg = u.pathAt >= u.path.length - 1;     // the last tile IS the ordered tile
  const ax = endLeg ? x : u.path[u.pathAt].tx * CFG.TILE + CFG.TILE / 2;
  const ay = endLeg ? y : u.path[u.pathAt].ty * CFG.TILE + CFG.TILE / 2;
  const done = stepToward(Game, u, ax, ay, s, dt);
  if (endLeg || !done) return done;
  u.pathAt++;                                       // that leg is walked: aim at the next tile
  return false;
}

/** The tile a route to (x, y) must end on, or `null` — and `null` REFUSES the order
 *  instead of letting a unit walk at something he can never enter. A route can only
 *  end on a walkable tile, and four of the five order kinds aim at the middle of a
 *  solid thing (a berry tile, a farm cell, a dropoff, a barracks foundation) and
 *  stop at a radius — `stop`, the same number the caller hands `moveUnit` — instead
 *  of on top of it. So the answer is the tile that radius is satisfied from: the
 *  point itself when it is walkable or the unit already stands within `stop` of it
 *  (a villager on the keep he feeds, an archer's enemy already at arrow range),
 *  otherwise the spot the game assigns for the kind of thing ordered to — `workPos`
 *  for a building (the ring `standingSpots` draws squads along, stood at `reachOf`),
 *  `workSpot` for any other tile — and otherwise nothing. Every order kind then runs
 *  one path, order → standTarget → findPath → step, which is the design's "harvest /
 *  build / move orders all route the same way". */
function standTarget(Game, u, x, y, stop) {
  const s = stop || 1;                                   // the caller's arrival radius
  if (walkable(Game, x, y) || Math.hypot(x - u.x, y - u.y) <= s) return { x, y };
  const { tx, ty } = tileOf(x, y);
  const site = Game.buildings.find((b) => tx >= b.tx && tx < b.tx + b.w &&
                                          ty >= b.ty && ty < b.ty + b.h);
  return site ? workPos(Game, site)                      // its own ring tile
              : workSpot(Game, u, tx, ty);               // its nearest walkable neighbour
}

/** The tiles the `move` orders of `sel` take around the ordered point (x, y) — the
 *  formation that replaced the golden-angle scatter: one tile per unit on a grid of
 *  ceil(sqrt(n)) columns, the pitch max(CFG.UNIT_SEP, CFG.TILE) px, which is exactly
 *  one tile here (22 > 11), so a squad standing on these slots already satisfies
 *  separate() and nobody has to be shoved out of the ranks. Cells that are not
 *  walkable, or are held by another live move order (a squad already standing there),
 *  are skipped and the grid grows one row and column at a time — ceil(sqrt(n)) up to
 *  n, so at most n² cells — until it can house everybody; the i-th nearest unit is
 *  paired to the i-th nearest free tile so nobody crosses the formation to reach it.
 *  Returns [{ u, slot }] (the pair the `move` order walks to), or null when the point
 *  cannot house the group at all, which leaves that order without a slot. */
function formationSlots(Game, sel, x, y) {
  const n = sel.length;
  if (!n) return null;
  const goal = tileOf(x, y);
  const step = Math.max(1, Math.round(Math.max(CFG.UNIT_SEP, CFG.TILE) / CFG.TILE)); // pitch, in tiles
  const mine = new Set(sel);                                  // units being re-slotted now
  const held = new Set();                                     // tiles other live move orders own
  for (const v of Game.units) {
    if (!v.dead && !mine.has(v) && v.slot) held.add(`${v.slot.tx},${v.slot.ty}`);
  }
  let cells = null;
  for (let size = Math.max(1, Math.ceil(Math.sqrt(n))); size <= n; size++) {
    const rank = [];                                 // the size x size grid centred on the goal
    const back = ((size - 1) >> 1) * step;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const tx = goal.tx - back + c * step, ty = goal.ty - back + r * step;
        const px = tx * CFG.TILE + CFG.TILE / 2, py = ty * CFG.TILE + CFG.TILE / 2;
        if (walkable(Game, px, py) && !held.has(`${tx},${ty}`)) rank.push({ tx, ty, x: px, y: py });
      }
    }
    if (rank.length >= n) { cells = rank; break; }     // big enough to house the whole squad
  }
  if (!cells) return null;                             // nowhere to put them: no formation
  const byDist = (list, d) => list.slice().sort((a, b) => d(a) - d(b) || (a.id ?? a.tx) - (b.id ?? b.tx));
  const units = byDist(sel, (u) => Math.hypot(u.x - x, u.y - y));
  const free = byDist(cells, (s) => Math.hypot(s.x - x, s.y - y));
  return units.map((u, i) => ({ u, slot: free[i] }));   // nearest unit -> nearest tile: no crossing
}

/** The board rule (T2): a tile is walkable when it is in bounds, not water, not
 *  a resource tile with stock and not covered by a building — an unbuilt
 *  foundation counts, exactly like the AoE2 rule. Everything that walks, works
 *  or spawns asks this: stepToward's step and slide, workSpot, workPos, makeBuilding. */
function walkable(Game, px, py) {
  const { tx, ty } = tileOf(px, py);
  if (tx < 0 || ty < 0 || tx >= Game.world.w || ty >= Game.world.h) return false;
  const i = ty * Game.world.w + tx;
  if (Game.world.type[i] === T.WATER) return false;
  if (RES_OF_TILE[Game.world.type[i]] && Game.world.amount[i] > 0) return false;
  return !Game.occupied.has(i);
}

/** How far from a building's centre counts as "arrived": the building's own
 *  tiles are solid now (T2), so nobody can stand closer than its edge — a 3x3
 *  Town Center is 33px from its centre, not the 22px of a single tile. Used by
 *  attack, and by every villager walking to drop off or build. */
function reachOf(b) {
  return CFG.TILE * Math.max(b.w, b.h) / 2 + 2;
}

/** Cheap O(n^2) separation -- AoE2 uses a collision map; fine at this scale.
 *  The push obeys walkable() too: two villagers sharing one work spot must not
 *  be shoved off it into the bush or the house they are working. */
function separate(Game) {
  const us = Game.units;
  const moveTo = (u, x, y) => {
    if (!walkable(Game, x, y)) return false;
    u.x = x; u.y = y;
    return true;
  };
  for (let i = 0; i < us.length; i++) {
    const a = us[i];
    if (a.dead) continue;
    for (let j = i + 1; j < us.length; j++) {
      const b = us[j];
      if (b.dead) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 === 0) { moveTo(a, a.x + (i % 2 ? 0.5 : -0.5), a.y); continue; }
      if (d2 < CFG.UNIT_SEP * CFG.UNIT_SEP) {
        const d = Math.sqrt(d2), push = (CFG.UNIT_SEP - d) / 2;
        moveTo(a, a.x - (dx / d) * push, a.y - (dy / d) * push);
        moveTo(b, b.x + (dx / d) * push, b.y + (dy / d) * push);
      }
    }
  }
}
