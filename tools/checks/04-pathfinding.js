'use strict';
/* checks/04-pathfinding.js -- A* pathfinding and barricade routing.
   Runs on its own (`node tools/checks/04-pathfinding.js`) against a freshly booted game. */

const {
  AoE2, DIRS8H, DT, check, flatState, pad, path, setTile, solidTile, tIdx, tOf, tc, tileCentre,
  report,
} = require('../lib/harness');

/* ---- 6c. pathfinding (T1: findPath, the A* core) -------------------- */
// Written before findPath existed, and still graded the §6a way: the harness
// carries its own search over its own tile rule, so a wrong A* cannot grade
// itself. Each fixture proves its own optimum before A* is compared to it.
// Fixture maps are ASCII: '.' grass, 'W' water, '#' a building tile, 'B' a berry.
const pathState = (rows) => {
  const h = rows.length, w = rows[0].length;
  const type = new Array(w * h).fill(AoE2.T.GRASS), amount = new Array(w * h).fill(0);
  const occupied = new Set();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = rows[y][x];
    if (c === 'W') type[y * w + x] = AoE2.T.WATER;
    else if (c === '#') occupied.add(y * w + x);
    else if (c === 'B') { type[y * w + x] = AoE2.T.BERRY; amount[y * w + x] = 150; }
  }
  return { world: { w, h, type, amount }, occupied, units: [], buildings: [], pathQueries: 0 };
};
const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
/** The reference route: uniform-cost Dijkstra over the harness's own solidTile
 *  rule with the two rules findPath documents (the start tile may be solid, a
 *  diagonal needs both its orthogonal neighbours walkable). Step count, or null. */
const refSteps = (st, from, to) => {
  const W = st.world.w, N = W * st.world.h;
  const openAt = (x, y) => (x === from.tx && y === from.ty) || solidTile(st, x, y) === null;
  const dist = new Array(N).fill(Infinity), done = new Array(N).fill(false);
  dist[from.ty * W + from.tx] = 0;
  for (;;) {
    let cur = -1, best = Infinity;
    for (let i = 0; i < N; i++) if (!done[i] && dist[i] < best) { best = dist[i]; cur = i; }
    if (cur < 0) return null;
    if (cur === to.ty * W + to.tx) return best;
    done[cur] = true;
    const cx = cur % W, cy = (cur / W) | 0;
    for (const d of N8) {
      const x = cx + d[0], y = cy + d[1];
      if (x < 0 || y < 0 || x >= W || y >= st.world.h) continue;
      if (d[0] && d[1] && !(openAt(cx, y) && openAt(x, cy))) continue;   // no corner-cutting
      if (!openAt(x, y)) continue;
      if (best + 1 < dist[y * W + x]) dist[y * W + x] = best + 1;
    }
  }
};
/** What is wrong with a route, as a list: gaps, tiles that are not walkable
 *  (the route's own start tile excepted), diagonals cutting a corner, and
 *  anything off the board. Empty list means the route obeys the board rule. */
const routeProblems = (st, p) => {
  const out = [];
  for (let i = 1; i < p.length; i++) {
    const dx = p[i].tx - p[i - 1].tx, dy = p[i].ty - p[i - 1].ty;
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) {
      out.push(p[i - 1].tx + ',' + p[i - 1].ty + '->' + p[i].tx + ',' + p[i].ty + ' is not a step');
    } else if (dx && dy &&
        (solidTile(st, p[i - 1].tx, p[i].ty) !== null || solidTile(st, p[i].tx, p[i - 1].ty) !== null)) {
      out.push('the diagonal into ' + p[i].tx + ',' + p[i].ty + ' squeezes between two solid tiles');
    }
  }
  for (let i = 1; i < p.length; i++) {
    if (solidTile(st, p[i].tx, p[i].ty) !== null) out.push(p[i].tx + ',' + p[i].ty + ' is not walkable');
  }
  return out;
};
// Every check below reads the export the same guarded way §6a reads walkable(),
// so a missing findPath fails the check instead of killing the run.
const fp = (st, a, b) => (typeof AoE2.findPath === 'function' ? AoE2.findPath(st, a, b) : null);
const fpNote = (p) => (p === null ? (typeof AoE2.findPath === 'function' ? 'no route returned' : 'findPath is not exported') : undefined);

// 1. open grass: the route must be the straight-line optimum, tile for tile.
const OPEN = pathState(['.........', '.........', '.........', '.........', '.........']);
const openRoute = fp(OPEN, { tx: 0, ty: 0 }, { tx: 8, ty: 3 });
const idealSteps = Math.max(8, 3);
check(!!openRoute && openRoute.length === idealSteps + 1 &&
      openRoute[0].tx === 0 && openRoute[0].ty === 0 &&
      openRoute[openRoute.length - 1].tx === 8 && openRoute[openRoute.length - 1].ty === 3 &&
      routeProblems(OPEN, openRoute).length === 0,
  'path: a route on open grass is the straight-line optimum',
  fpNote(openRoute) || (openRoute.length + ' tiles where the straight line needs ' +
    (idealSteps + 1) + '; ' + (routeProblems(OPEN, openRoute).join(' ') || 'every step is 8-adjacent on open grass')));

// 2. the roadmap P0.2 exit condition, on a 5-tile inlet hanging off the north
// shore: Dijkstra says the optimum, A* may not be more than 15% longer, and the
// fixture itself is only trusted when its own optimum is close to the
// straight line (otherwise "within 15% of optimal" would be vacuous).
const INLET = pathState(['.....W.....', '.....W.....', '.....W.....', '.....W.....', '.....W.....',
  '...........', '...........', '...........', '...........', '...........', '...........']);
const inFrom = { tx: 0, ty: 4 }, inTo = { tx: 10, ty: 4 };
const inIdeal = Math.max(10, 0);
const inBest = refSteps(INLET, inFrom, inTo);
const inRoute = fp(INLET, inFrom, inTo);
check(inBest !== null && inBest <= 1.15 * inIdeal && !!inRoute &&
      (inRoute.length - 1) <= 1.15 * inBest && routeProblems(INLET, inRoute).length === 0,
  'path: a route around a water inlet stays within 15% of optimal',
  'straight line ' + inIdeal + ' steps, Dijkstra around the inlet ' + inBest +
    ' steps, A* ' + (fpNote(inRoute) || (inRoute.length - 1) + ' steps'));

// 3. the only shortcut here is the illegal one: (1,2)->(2,1) has water at
// (1,1) and a building at (2,2) as its two orthogonal neighbours, so a
// corner-cutting search returns the 3-tile route and this check names it.
const SQUEEZE = pathState(['WW....', 'WW....', '..#...', '......', '......', '......']);
const sqRoute = fp(SQUEEZE, { tx: 0, ty: 3 }, { tx: 3, ty: 0 });
check(!!sqRoute && routeProblems(SQUEEZE, sqRoute).length === 0,
  'path: a diagonal never squeezes between two solid tiles',
  fpNote(sqRoute) || (sqRoute.length + ' tiles (' + sqRoute.map((t) => t.tx + ',' + t.ty).join(' ') +
    ') — ' + (routeProblems(SQUEEZE, sqRoute).join(' ') || 'both orthogonal tiles open at every diagonal')));

// 4. a hopeless query must answer, not stall: an island with no route to a
// walkable goal, and a route that exists but blows the authored node budget.
const ISLES = pathState(['WWWWWWW', 'WWWWWWW', 'WW.W.WW', 'WWWWWWW', 'WWWWWWW']);
const lostRoute = fp(ISLES, { tx: 3, ty: 2 }, { tx: 5, ty: 2 });
const savedCap = AoE2.CFG.ASTAR_MAX_NODES;
AoE2.CFG.ASTAR_MAX_NODES = 3;                       // the open 9x5 route needs 8
const cappedRoute = fp(OPEN, { tx: 0, ty: 0 }, { tx: 8, ty: 3 });
AoE2.CFG.ASTAR_MAX_NODES = savedCap;
check(!!openRoute && lostRoute === null && cappedRoute === null,
  'path: an unreachable goal returns null within the node cap',
  fpNote(openRoute) || ('unreachable island -> ' + (lostRoute === null ? 'null' : lostRoute.length + ' tiles') +
    '; the same 8-step route with CFG.ASTAR_MAX_NODES=3 -> ' +
    (cappedRoute === null ? 'null' : cappedRoute.length + ' tiles') + ' (authored cap ' + savedCap + ')'));

// 5. a unit standing on a farm tile or a fresh foundation still has a route:
// the start tile is accepted even when solid, every later tile must be open.
const FOUNDATION = pathState(['#.....', '......', '......', '......']);
const foundFrom = { tx: 0, ty: 0 }, foundTo = { tx: 4, ty: 3 };
const foundRoute = fp(FOUNDATION, foundFrom, foundTo);
check(!!foundRoute && foundRoute[0].tx === 0 && foundRoute[0].ty === 0 &&
      foundRoute[foundRoute.length - 1].tx === foundTo.tx &&
      foundRoute[foundRoute.length - 1].ty === foundTo.ty &&
      refSteps(FOUNDATION, foundFrom, foundTo) === foundRoute.length - 1 &&
      routeProblems(FOUNDATION, foundRoute).length === 0,
  "path: a route starts on the unit's own tile even when that tile is solid",
  fpNote(foundRoute) || ('route ' + foundRoute.map((t) => t.tx + ',' + t.ty).join(' ') +
    ' starts on the occupied tile and matches the Dijkstra length ' +
    refSteps(FOUNDATION, foundFrom, foundTo) + '; ' +
    (routeProblems(FOUNDATION, foundRoute).join(' ') || 'all later tiles walkable')));

/* -- T2: the move order carries a route (moveUnit, mapEpoch) ------------ */
// Fixtures: a seeded state flattened to grass (so the only solids are the two
// Town Centers plus whatever water or pad a check adds), one ordered villager,
// and walkOrder(), which steps the sim while the order lives and reports every
// position he occupied plus how many findPath calls it cost (Game.pathQueries —
// the plan pins the "re-paths every frame" bug class with a number).
/** flatState plus a villager ordered `dist` tiles in `dir` (default: the first
 *  direction with `dist` free tiles in a row). `at` is the ordered point, always
 *  a tile centre, so arriving exactly and arriving on the tile are the same act. */
const flatWithOrder = (dist, dir) => {
  const st = flatState();
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  const V = { x: tOf(v.x), y: tOf(v.y) };
  const free = (x, y) => x >= 0 && y >= 0 && x < st.world.w && y < st.world.h &&
    !st.occupied.has(tIdx(st, x, y));
  const d = dir || DIRS8H.find((o) => {
    for (let k = 1; k <= dist; k++) if (!free(V.x + o[0] * k, V.y + o[1] * k)) return false;
    return true;
  });
  if (!d) return null;
  const goal = { tx: V.x + d[0] * dist, ty: V.y + d[1] * dist };
  return { st, v, V, goal, at: tileCentre(st, goal.tx, goal.ty) };
};
const orderTo = (f) => { f.v.order = { kind: 'move', x: f.at.x, y: f.at.y }; };
/** Step the sim while the order lives; report the positions, the step count and
 *  the findPath calls they cost. */
const walkOrder = (st, u, max) => {
  const seen = [], q0 = st.pathQueries || 0;
  const from = { x: u.x, y: u.y };
  let n = 0;
  while (n < max && u.order.kind !== 'idle' && !u.dead) {
    AoE2.stepGame(st, DT);
    n++;
    seen.push({ x: u.x, y: u.y });
  }
  return { seen, n, from, queries: (st.pathQueries || 0) - q0 };
};
const orderAndWalk = (f, max) => { orderTo(f); return walkOrder(f.st, f.v, max); };
const routeOf = (u) => (u.path || []).map((t) => t.tx + ',' + t.ty);
const distTo = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

// 6. one tile of water between the villager and his goal, so the straight line
// is NOT walkable: every position he stood on must be a tile of the route he
// cached, and the route must be longer than the straight line to count.
const detourF = (() => {
  for (const d of DIRS8H) {
    const f = flatWithOrder(2, d);
    if (!f) continue;
    setTile(f.st, tOf(f.v.x) + d[0], tOf(f.v.y) + d[1], AoE2.T.WATER, 0);   // the middle
    const w = orderAndWalk(f, 240);
    if (!w.seen.length) continue;
    return { f, w, route: routeOf(f.v) };
  }
  return null;
})();
check(!!detourF && detourF.route.length > 2 &&
      detourF.w.seen.every((p) => detourF.route.indexOf(tOf(p.x) + ',' + tOf(p.y)) >= 0),
  'path: a move order walks the stored route, not the straight line',
  !detourF ? 'no move order cached a route to walk'
    : `${detourF.w.n} steps over ${detourF.route.length} route tiles ` +
      `${detourF.route.join(' ')}; ` +
      `${detourF.w.seen.filter((p) => detourF.route.indexOf(tOf(p.x) + ',' + tOf(p.y)) < 0).length} ` +
      `positions off the route`);

// 7. the same walk, graded on its end: the order is retired and he stands on the
// tile he was ordered to (the plan's "ends within CFG.TILE / 2 of the point").
check(!!detourF && detourF.f.v.order.kind === 'idle' &&
      distTo(detourF.f.v, detourF.f.at) < AoE2.CFG.TILE / 2,
  'path: the move order completes on the ordered tile',
  !detourF ? 'no move order cached a route to walk'
    : `order ${detourF.f.v.order.kind} after ${detourF.w.n} steps, ${distTo(detourF.f.v, detourF.f.at).toFixed(1)}px ` +
      `from the ordered point (${detourF.f.at.x},${detourF.f.at.y}), tile ${tOf(detourF.f.v.x)},${tOf(detourF.f.v.y)}`);

// 8. a house lands on the road he is walking — the plan's "a building placed
// mid-walk": Game.mapEpoch moves, so the very next step re-paths. The pad is
// chosen so it never swallows his own tile or the goal tile, which are the two
// other reasons a route can stop being valid.
const repathF = (() => {
  for (const d of DIRS8H) {
    for (let dist = 2; dist <= 5; dist++) {
      const f = flatWithOrder(dist, d);
      if (!f) continue;
      orderTo(f);
      AoE2.stepGame(f.st, DT);                          // one step: the route is cached
      const before = routeOf(f.v);
      if (before.length < 3) continue;
      const own = tOf(f.v.x) + ',' + tOf(f.v.y), goal = f.goal.tx + ',' + f.goal.ty;
      const pad = f.v.path.slice(1, -1).find((t) => AoE2.siteFree(f.st, t.tx, t.ty, 2, 2) &&
        [[0, 0], [1, 0], [0, 1], [1, 1]].every((o) => {
          const k = (t.tx + o[0]) + ',' + (t.ty + o[1]);
          return k !== own && k !== goal;
        }));
      if (!pad) continue;
      AoE2.makeBuilding(f.st, 'house', 0, pad.tx, pad.ty);
      AoE2.stepGame(f.st, DT);                          // the very next step
      const after = routeOf(f.v);
      return { f, before, after, w: walkOrder(f.st, f.v, 400), pad };
    }
  }
  return null;
})();
check(!!repathF && repathF.after.length > 0 &&
      repathF.after.join(' ') !== repathF.before.join(' ') &&
      distTo(repathF.f.v, repathF.f.at) < AoE2.CFG.TILE / 2,
  'path: a building placed on the route re-paths on the next step',
  !repathF ? 'no move order cached a route a house could be placed on'
    : `house at ${repathF.pad.tx},${repathF.pad.ty}: ${repathF.before} -> ${repathF.after}, ` +
      `${repathF.w.n} further steps, ${distTo(repathF.f.v, repathF.f.at).toFixed(1)}px from the ordered point`);

// 9. the number that pins the bug class: a walk with nothing changing around it
// must not ask findPath again every frame (60 steps, at most 2 queries).
const cleanF = flatWithOrder(1);
const cleanW = cleanF ? orderAndWalk(cleanF, 60) : null;
check(!!cleanW && cleanW.queries >= 1 && cleanW.queries <= 2 && cleanW.n >= 20,
  'path: a clean walk uses at most two A* queries in 60 steps',
  !cleanF ? 'no free tile next to a villager to order him to'
    : `${cleanW.n} steps, ${cleanW.queries} findPath calls (the bound is 2), moved ` +
      `${distTo(cleanW.from, { x: cleanF.v.x, y: cleanF.v.y }).toFixed(1)}px`);

// 10. an order with no route at all: ringed with water, the villager neither
// nose-presses the shore nor twitches — the order is refused and retired.
const stuckF = (() => {
  const st = flatState();
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  const V = { x: tOf(v.x), y: tOf(v.y) };
  const d = DIRS8H.find((o) => !st.occupied.has(tIdx(st, V.x + o[0] * 2, V.y + o[1] * 2)));
  if (!d) return null;
  for (const o of DIRS8H) setTile(st, V.x + o[0], V.y + o[1], AoE2.T.WATER, 0);
  const at = tileCentre(st, V.x + d[0] * 2, V.y + d[1] * 2);
  v.order = { kind: 'move', x: at.x, y: at.y };
  const w = walkOrder(st, v, 5);
  return { v, at, w };
})();
check(!!stuckF && stuckF.v.order.kind === 'idle' && stuckF.v.x === stuckF.w.from.x &&
      stuckF.v.y === stuckF.w.from.y,
  'path: an unreachable move order leaves the unit idle',
  !stuckF ? 'no villager with a free tile two steps away'
    : `order ${stuckF.v.order.kind} after ${stuckF.w.n} steps, at ${stuckF.v.x.toFixed(1)},` +
      `${stuckF.v.y.toFixed(1)} (ordered ${stuckF.at.x},${stuckF.at.y}), ` +
      `${stuckF.w.queries} findPath calls`);

/* -- T3: the other four order kinds route to a standing spot -------------- *
 * `standTarget(Game, u, x, y, stop)` (the pathfinding block) names the tile an
 * order's route must end on: the ordered point when it is walkable, otherwise the
 * spot the game already assigns for that kind of thing (a building's `workPos`, a
 * resource tile's `workSpot`), otherwise nothing — and `null` REFUSES the order
 * instead of letting the unit walk at a solid thing forever. Every check below
 * orders one unit and then reads `u.path`: an order walked with the old straight
 * step has no route at all, so these are the checks that prove a branch converted.
 * `scene()` is the shared fixture — a flat board plus one unit of the kind under
 * test, parked on a named tile. */
const scene = (kind, team, tx, ty) => {
  const st = flatState();
  return { st, u: AoE2.makeUnit(st, kind, team, tileCentre(st, tx, ty).x, tileCentre(st, tx, ty).y) };
};
const tileKey = (p) => tOf(p.x) + ',' + tOf(p.y);

// 11. a militia ordered to an enemy 3 tiles east with a tile of water in front of
// him: the route ends on the enemy's own tile — what standTarget answers for a
// walkable point, which is also what this branch already aimed at — and the swing
// lands. The contract for the `attack`-on-a-unit site.
const atkUnitF = (() => {
  const f = scene('militia', 0, 60, 60);
  const foe = AoE2.makeUnit(f.st, 'villager', 1, tileCentre(f.st, 63, 60).x, tileCentre(f.st, 63, 60).y);
  setTile(f.st, 61, 60, AoE2.T.WATER, 0);
  setTile(f.st, 62, 60, AoE2.T.WATER, 0);
  f.u.order = { kind: 'attack', target: foe.id };
  const hp0 = foe.hp, w = walkOrder(f.st, f.u, 900);
  return { f, foe, hp0, w, route: routeOf(f.u) };
})();
check(!!atkUnitF && atkUnitF.route.length > 1 &&
      atkUnitF.route[atkUnitF.route.length - 1] === tileKey(atkUnitF.foe) &&
      distTo(atkUnitF.f.u, atkUnitF.foe) <= atkUnitF.f.u.r + atkUnitF.foe.r + 4 &&
      atkUnitF.foe.hp < atkUnitF.hp0,
  'path: a melee attack route ends at contact range of the target unit',
  !atkUnitF ? 'no state to order a unit in'
    : `${atkUnitF.w.n} steps, route ${atkUnitF.route.join(' ')}, ended ` +
      `${distTo(atkUnitF.f.u, atkUnitF.foe).toFixed(1)}px from the enemy (the table's contact is ` +
      `${atkUnitF.f.u.r + atkUnitF.foe.r + 4}px), its hp ${atkUnitF.hp0}->${atkUnitF.foe.hp}`);

// 12. a 3x3 Town Center is a block of solid tiles: the route cannot end on the tile
// the order names, it has to end on a ring tile — the plan's "ends on its reach
// ring, never on its footprint". Aimed at the building's own tile (the pre-T3
// branch) the order had no route at all and the fighter stopped wherever the
// straight step left him.
const atkBuildF = (() => {
  const f = scene('militia', 0, 65, 51);
  const tc = f.st.buildings.find((b) => b.team === 1 && b.kind === 'town_center');
  if (!tc) return null;
  const spot = AoE2.workPos(f.st, tc);
  f.u.order = { kind: 'attack', b: tc.id };
  const hp0 = tc.hp, w = walkOrder(f.st, f.u, 900);
  return { f, tc, spot, hp0, w, route: routeOf(f.u) };
})();
check(!!atkBuildF && atkBuildF.route.length > 1 &&
      atkBuildF.route[atkBuildF.route.length - 1] === tileKey(atkBuildF.spot) &&
      AoE2.siteFree(atkBuildF.f.st, tOf(atkBuildF.f.u.x), tOf(atkBuildF.f.u.y), 1, 1) &&
      atkBuildF.tc.hp < atkBuildF.hp0,
  'path: a melee attack on a building stops on its reach ring, not its footprint',
  !atkBuildF ? 'no enemy Town Center to order a unit against'
    : `TC ${atkBuildF.tc.tx},${atkBuildF.tc.ty}: route ${atkBuildF.route.join(' ') || 'none'} ends on ` +
      `${tileKey(atkBuildF.spot)} (its work spot), the fighter stands on ${tileKey(atkBuildF.f.u)} ` +
      `${distTo(atkBuildF.f.u, atkBuildF.tc).toFixed(1)}px from the tower, its hp ${atkBuildF.hp0}->${atkBuildF.tc.hp}`);

// 13. the same target with an archer: the table's range, not contact, decides where
// the route ends, so he stops 4 tiles out and looses an arrow instead of walking
// onto the tower.
const atkRangedF = (() => {
  const f = scene('archer', 0, 65, 50);
  const tc = f.st.buildings.find((b) => b.team === 1 && b.kind === 'town_center');
  if (!tc) return null;
  const spot = AoE2.workPos(f.st, tc);
  const hp0 = tc.hp;
  f.u.order = { kind: 'attack', b: tc.id };
  const w = walkOrder(f.st, f.u, 900);
  return { f, tc, spot, hp0, w, route: routeOf(f.u) };
})();
check(!!atkRangedF && atkRangedF.route.length > 1 &&
      atkRangedF.route[atkRangedF.route.length - 1] === tileKey(atkRangedF.spot) &&
      Math.abs(distTo(atkRangedF.f.u, atkRangedF.spot) - AoE2.CFG.TILE * 4) <= AoE2.CFG.TILE / 2 &&
      (atkRangedF.tc.hp < atkRangedF.hp0 || atkRangedF.f.st.projectiles.length > 0),
  'path: a ranged attack route stops at the table range and does not close to contact',
  !atkRangedF ? 'no enemy Town Center to order an archer against'
    : `route ${atkRangedF.route.join(' ') || 'none'} ends on ${tileKey(atkRangedF.spot)}, he stopped ` +
      `${distTo(atkRangedF.f.u, atkRangedF.spot).toFixed(1)}px from that spot (the table range is ` +
      `${AoE2.CFG.TILE * 4}px), tower hp ${atkRangedF.hp0}->${atkRangedF.tc.hp}, ` +
      `${atkRangedF.f.st.projectiles.length} arrows in the air`);

// 14. a villager ordered to build a house whose work spot sits on the far side of a
// strip of water: he finishes it standing on that spot, reached by a route. The
// branch already handed moveUnit the work spot; this pins the plan's "harvest /
// build / move orders all route the same way" for it.
const buildOrderF = (() => {
  const f = scene('villager', 0, 60, 60);
  setTile(f.st, 61, 59, AoE2.T.WATER, 0);
  setTile(f.st, 61, 60, AoE2.T.WATER, 0);
  setTile(f.st, 61, 61, AoE2.T.WATER, 0);
  if (!AoE2.siteFree(f.st, 62, 60, 1, 1)) return null;
  const house = AoE2.makeBuilding(f.st, 'house', 0, 62, 60);
  const spot = AoE2.workPos(f.st, house);
  f.u.order = { kind: 'build', b: house.id };
  const w = walkOrder(f.st, f.u, 2400);
  return { f, house, spot, w, route: routeOf(f.u) };
})();
check(!!buildOrderF && buildOrderF.house.built === 1 &&
      buildOrderF.f.u.order.kind === 'idle' && buildOrderF.route.length > 1 &&
      buildOrderF.route[buildOrderF.route.length - 1] === tileKey(buildOrderF.spot),
  'path: a build order routes to workPos instead of the straight line',
  !buildOrderF ? 'no free house pad across water to order a villager to'
    : `house 62,60 built ${buildOrderF.house.built.toFixed(2)}, order ${buildOrderF.f.u.order.kind} ` +
      `after ${buildOrderF.w.n} steps, route ${buildOrderF.route.join(' ') || 'none'} ends on the ` +
      `work spot ${tileKey(buildOrderF.spot)}`);

/* -- T4: formation slots replace the golden-angle scatter ----------------- *
 * `formationSlots(Game, sel, x, y)` (the pathfinding block) answers a group move
 * order with one tile per unit: a centred grid of ceil(sqrt(n)) columns at the tile
 * pitch, solid cells skipped and the grid grown until everybody owns a tile.
 * `issueOrder` writes the answer into `u.slot`, and the `move` branch walks to it —
 * replacing the golden-angle spiral that dropped a squad on top of itself. Before
 * T4 no unit carries a slot, so every check here fails for the missing field and
 * passes once the group marches into ranks. */
const fsq = (st, sel, x, y) => (typeof AoE2.formationSlots === 'function' ? AoE2.formationSlots(st, sel, x, y) : null);
const fsqNote = (p) => (p === null ? (typeof AoE2.formationSlots === 'function' ? 'no slots returned' : 'formationSlots is not exported') : undefined);
/** `n` team-0 villagers standing in ranks on the centred grid over their own tile
 *  (sx, sy) — `cols = ceil(sqrt(n))` tiles, the pitch the game itself uses — and
 *  ordered to the centre of tile (gx, gy) through `issueOrder`, exactly what a
 *  right-click does; `water` floods tiles first when a check wants it. A squad
 *  starts in a formation because that is what the game produces, and stacking them
 *  on one tile would test something else entirely: 4 units sharing a square crawl at
 *  a fraction of a pixel per frame while separate() and their own routes fight over
 *  it. Returns the state, the squad, the ordered point and the slots the order gave. */
const squadTo = (n, sx, sy, gx, gy, water) => {
  const st = flatState();
  const cols = Math.max(1, Math.ceil(Math.sqrt(n))), back = (cols - 1) >> 1;
  const squad = [];
  for (let i = 0; i < n; i++) squad.push(AoE2.makeUnit(st, 'villager', 0,
    tileCentre(st, sx + (i % cols) - back, sy + ((i / cols) | 0) - back).x,
    tileCentre(st, sx + (i % cols) - back, sy + ((i / cols) | 0) - back).y));
  st.units = squad;                                      // just the squad under test
  (water || []).forEach((t) => setTile(st, t[0], t[1], AoE2.T.WATER, 0));
  st.selection = squad.map((u) => u.id);
  const at = tileCentre(st, gx, gy);
  AoE2.issueOrder(st, at.x, at.y);
  return { st, sel: squad, at, slots: squad.map((u) => u.slot) };
};
const minPair = (us) => Math.min(...us.flatMap((a, i) => us.slice(i + 1).map((b) => distTo(a, b))));

// 15. the assignment itself: 4 villagers ordered to one tile take the 2x2 block of
// tiles there — one tile pitch, one unit per tile, every one of them walkable.
const s4 = squadTo(4, 60, 60, 63, 60);
const sq4 = fsq(s4.st, s4.sel, s4.at.x, s4.at.y);
const want4 = ['63,60', '64,60', '63,61', '64,61'];
check(!!sq4 && sq4.length === 4 &&
      new Set(sq4.map((p) => tileKey(p.slot))).size === 4 &&
      want4.every((k) => sq4.some((p) => tileKey(p.slot) === k)) &&
      sq4.every((p) => AoE2.siteFree(s4.st, p.slot.tx, p.slot.ty, 1, 1)),
  'formation: a 4-unit move order yields 4 distinct walkable slots',
  fsqNote(sq4) || `${sq4.length} slots: ${sq4.map((p) => p.u.id + '@' + tileKey(p.slot)).join(' ')} ` +
    `(the 2x2 at 63,60 is ${want4.join(' ')})`);

/** that squad, walked until the whole group is idle. `end[i]` records where unit i's
 *  order retired — the position this checks, because once a unit is done the rest of
 *  the walk can still shove him aside (that is separate(), not the route): the tile he
 *  retired on is what the order promised. 1500 steps against a ~110-step walk, so the
 *  cap is never the point. */
const walked = (f) => {
  if (!f.sel.every((u) => u.slot)) return { f, n: 0, snap: f.slots, end: f.sel.map(() => null) };
  const snap = f.sel.map((u) => u.slot);        // a retiring move order releases its tile
  const end = f.sel.map(() => null);
  let steps = 0;
  while (steps < 1500 && f.sel.some((u) => u.order.kind !== 'idle')) {
    AoE2.stepGame(f.st, DT); steps++;
    f.sel.forEach((u, i) => { if (!end[i] && (u.order.kind === 'idle' || u.dead)) end[i] = { x: u.x, y: u.y }; });
  }
  return { f, n: steps, snap, end };
};
const walkF = walked(squadTo(4, 60, 60, 63, 60));

// 16. the order's end: each of the 4 retires on the tile he was given — the plan's
// "all 4 end within CFG.TILE / 2 of their own slot", not one shared tile.
check(walkF.n > 0 && walkF.end.every((p, i) => p && walkF.f.sel[i].order.kind === 'idle' &&
      walkF.f.sel[i].slot === null && tOf(p.x) === walkF.snap[i].tx && tOf(p.y) === walkF.snap[i].ty &&
      distTo(p, walkF.snap[i]) <= AoE2.CFG.TILE / 2),
  'formation: every unit of the group arrives on its own slot',
  !walkF.n ? 'the move order assigned no slots to walk'
    : walkF.f.sel.map((u, i) => `${u.id}${walkF.end[i] ? `@${tOf(walkF.end[i].x)},${tOf(walkF.end[i].y)}` : ''}` +
      `(ordered ${walkF.snap[i] ? walkF.snap[i].tx + ',' + walkF.snap[i].ty : 'none'} ` +
      `${walkF.end[i] ? distTo(walkF.end[i], walkF.snap[i]).toFixed(1) : '-'}px, order ${u.order.kind})`).join(' ') +
      ` after ${walkF.n} steps`);

// 17. the two separation mechanisms agree by construction: the pitch is
// CFG.UNIT_SEP on the tile grid, so a group parked on its slots needs no pushes —
// calling separate() moves nobody. (The spiral left pairs 9-15px apart and did.)
const sepF = (() => {
  if (!walkF.n || typeof AoE2.separate !== 'function') return null;
  const before = walkF.f.sel.map((u) => ({ x: u.x, y: u.y }));
  AoE2.separate(walkF.f.st);
  return { before, after: walkF.f.sel.map((u) => ({ x: u.x, y: u.y })) };
})();
check(!!sepF && sepF.before.every((p, i) => p.x === sepF.after[i].x && p.y === sepF.after[i].y),
  'formation: a group parked on its slots needs zero separation pushes',
  !sepF ? (typeof AoE2.separate === 'function' ? 'the group never arrived, nothing to park' : 'separate is not exported')
    : `moved ${sepF.before.filter((p, i) => p.x !== sepF.after[i].x || p.y !== sepF.after[i].y).length} of ` +
      `${sepF.after.length} units; the nearest two are ${minPair(walkF.f.sel).toFixed(1)}px apart ` +
      `(CFG.UNIT_SEP is ${AoE2.CFG.UNIT_SEP}px)`);

// 18. the same order with two of the four tiles flooded: the grid grows past the
// water and every villager still gets a tile of his own — and none of them in it.
const s4w = squadTo(4, 67, 60, 70, 60, [[71, 60], [70, 61]]);
const sq4w = fsq(s4w.st, s4w.sel, s4w.at.x, s4w.at.y);
check(!!sq4w && sq4w.length === 4 &&
      new Set(sq4w.map((p) => tileKey(p.slot))).size === 4 &&
      sq4w.every((p) => AoE2.siteFree(s4w.st, p.slot.tx, p.slot.ty, 1, 1)),
  'formation: slots skip water and still give every unit a distinct tile',
  fsqNote(sq4w) || `${sq4w.length} slots: ${sq4w.map((p) => p.u.id + '@' + tileKey(p.slot)).join(' ')} ` +
    `(71,60 and 70,61 are water, so the 2x2 there cannot hold 4)`);

/* ---- 6d. barricade routing (this plan, T3) -------------------------- */
// Routing around, through and after a wooden segment. Every expected length
// comes from refSteps, the harness's own Dijkstra -- the §6c rule that findPath
// may not grade itself; fp is only asked for the route *tiles*, exactly as §6c's
// own repath fixture asks routeOf -- on the §6c fixtures rebuilt with barricades.

// 19. a flatWithOrder(4) walk whose cached route gets a 1x1 barricade dropped
// on it -- neither the walker's own tile nor the goal (the §6c 8-check
// exclusion rule) -- stepped once, then demolished; each stage's route is
// graded against refSteps for the board of that stage.
const barRoute = (() => {
  const f = flatWithOrder(4);
  if (!f) return null;
  const { st, v, V, goal, at } = f;
  orderTo(f);
  const preRoute = fp(st, { tx: V.x, ty: V.y }, goal);  // the route on the clean board
  const refPre = refSteps(st, { tx: V.x, ty: V.y }, goal);   // the clean board's optimum
  if (preRoute === null || preRoute.length < 3) return null;
  const pad = preRoute[1];                              // a route tile, never own tile or goal
  const b = AoE2.makeBuilding(st, 'barricade', 0, pad.tx, pad.ty);
  b.built = 1;
  const centre = tileCentre(st, pad.tx, pad.ty);
  const walkAt = AoE2.walkable(st, centre.x, centre.y);
  const blocksLen = (st.blocks.get(b.id) || []).length;
  const refWith = refSteps(st, { tx: V.x, ty: V.y }, goal);  // the same search, segment up
  AoE2.stepGame(st, DT);                                // the very next step
  const during = routeOf(v);
  const proDuring = v.path === null ? ['no cached route'] : routeProblems(st, v.path);
  const dOk = AoE2.demolish(st, b);
  AoE2.stepGame(st, DT);                                // the first step on the cleared board
  const refGone = refSteps(st, { tx: tOf(v.x), ty: tOf(v.y) }, goal);
  const after = routeOf(v);
  const w = walkOrder(st, v, 400);
  return { f, V, goal, at, preRoute, refPre, pad, b, walkAt, blocksLen, refWith, during, proDuring, dOk, refGone, after, w };
})();
const barTiles = (p) => p.map((t) => t.tx + ',' + t.ty).join(' ');
check(!!barRoute && barRoute.walkAt === false && barRoute.blocksLen === 1,
  'path: a built barricade makes its own tile unwalkable',
  !barRoute ? 'no flatWithOrder(4) fixture'
    : `barricade at ${barRoute.pad.tx},${barRoute.pad.ty}: walkable=${barRoute.walkAt} ` +
      `blocks=${barRoute.blocksLen} tile(s)`);
check(!!barRoute && barRoute.refPre !== null &&
      barRoute.preRoute.length === barRoute.refPre + 1 &&
      barRoute.during.join(' ') !== barTiles(barRoute.preRoute) &&
      barRoute.during.length === barRoute.refWith + 1 && barRoute.proDuring.length === 0,
  'path: a barricade dropped on a cached route reroutes the walker on the next step',
  !barRoute ? 'no flatWithOrder(4) fixture'
    : `before ${barTiles(barRoute.preRoute)} -> during ${barRoute.during.join(' ')} ` +
      `(before ${barRoute.refPre} + 1, with the segment ${barRoute.refWith} + 1)` +
      (barRoute.proDuring.length ? '; ' + barRoute.proDuring.join('; ') : ''));
check(!!barRoute && barRoute.dOk === true &&
      barRoute.after.join(' ') === barTiles(barRoute.preRoute) &&
      barRoute.refGone !== null && barRoute.after.length === barRoute.refGone + 1,
  'path: demolishing that segment restores a route of the pre-build length',
  !barRoute ? 'no flatWithOrder(4) fixture'
    : `demolish ${barRoute.dOk}; route ${barRoute.after.join(' ')} vs pre-build ` +
      `${barTiles(barRoute.preRoute)} (refSteps ${String(barRoute.refGone)} + 1), walk finished in ${barRoute.w.n} steps`);

// 20. §6c's check-10 unreachable-order fixture rebuilt with wood: the same
// flatState villager, his eight neighbour tiles ringed with 1x1 barricades
// instead of water, ordered two tiles off.
const barStuck = (() => {
  const st = flatState();
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  const V = { x: tOf(v.x), y: tOf(v.y) };
  const d = DIRS8H.find((o) => !st.occupied.has(tIdx(st, V.x + o[0] * 2, V.y + o[1] * 2)));
  if (!d) return null;
  const ring = DIRS8H.map((o) => {
    const b = AoE2.makeBuilding(st, 'barricade', 0, V.x + o[0], V.y + o[1]);
    b.built = 1;
    return b;
  });
  const at = tileCentre(st, V.x + d[0] * 2, V.y + d[1] * 2);
  const r = fp(st, { tx: V.x, ty: V.y }, { tx: V.x + d[0] * 2, ty: V.y + d[1] * 2 });
  v.order = { kind: 'move', x: at.x, y: at.y };
  const w = walkOrder(st, v, 5);
  return { v, V, ring, at, r, w };
})();
check(!!barStuck && barStuck.r === null && barStuck.v.order.kind === 'idle' &&
      barStuck.v.x === barStuck.w.from.x && barStuck.v.y === barStuck.w.from.y,
  'path: a barricade between a villager and his order leaves him idle without a route',
  !barStuck ? 'no villager with a free tile two steps away'
    : `route=${String(barStuck.r)} order ${barStuck.v.order.kind} after ${barStuck.w.n} steps, ` +
      `at ${barStuck.v.x.toFixed(1)},${barStuck.v.y.toFixed(1)} (ordered ${barStuck.at.x},${barStuck.at.y})`);

// 21. the pocket -- the §6c free() scan finds a grass tile whose 8 neighbours
// are all free, the villager is moved onto it, the ring of eight 1x1
// barricades closes, and one ring segment is demolished.
const barPocket = (() => {
  const st = flatState();
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  const free = (x, y) => x >= 0 && y >= 0 && x < st.world.w && y < st.world.h && !st.occupied.has(tIdx(st, x, y));
  let Vp = null;
  for (let y = 1; y < st.world.h - 1 && !Vp; y++) {
    for (let x = 1; x < st.world.w - 1 && !Vp; x++) {
      if (free(x, y) && DIRS8H.every((o) => free(x + o[0], y + o[1]))) Vp = { x, y };
    }
  }
  if (!Vp) return null;
  const d = DIRS8H.find((o) => free(Vp.x + o[0] * 2, Vp.y + o[1] * 2));
  if (!d) return null;
  const here = tileCentre(st, Vp.x, Vp.y);
  v.x = here.x; v.y = here.y;
  const goalP = { tx: Vp.x + d[0] * 2, ty: Vp.y + d[1] * 2 };
  const ring = DIRS8H.map((o) => {
    const b = AoE2.makeBuilding(st, 'barricade', 0, Vp.x + o[0], Vp.y + o[1]);
    b.built = 1;
    return b;
  });
  const atP = tileCentre(st, goalP.tx, goalP.ty);
  const r1 = fp(st, { tx: Vp.x, ty: Vp.y }, goalP);
  v.order = { kind: 'move', x: atP.x, y: atP.y };
  const w1 = walkOrder(st, v, 5);
  const pop = ring.find((b) => b.tx === Vp.x + d[0] && b.ty === Vp.y + d[1]);
  const pOk = pop && AoE2.demolish(st, pop);
  const r2 = fp(st, { tx: Vp.x, ty: Vp.y }, goalP);
  const ref = refSteps(st, { tx: Vp.x, ty: Vp.y }, goalP);
  return { Vp, v, atP, d, ring, r1, w1, pOk, r2, ref };
})();
check(!!barPocket && barPocket.r1 === null && barPocket.v.order.kind === 'idle' &&
      barPocket.pOk === true && barPocket.r2 !== null && barPocket.ref !== null &&
      barPocket.r2.length === barPocket.ref + 1,
  'path: a villager ringed by eight barricades has no route, and demolishing one ring segment gives him one back',
  !barPocket ? 'no grass tile with eight free neighbours'
    : `ringed: route ${String(barPocket.r1)}, order ${barPocket.v.order.kind} after ${barPocket.w1.n} steps; ` +
      `popped ${barPocket.Vp.x + barPocket.d[0]},${barPocket.Vp.y + barPocket.d[1]}: ` +
      `route ${String(barPocket.r2 && barPocket.r2.length)}, refSteps ${String(barPocket.ref)} + 1`);

report();
