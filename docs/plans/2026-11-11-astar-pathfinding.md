# A\* pathfinding — walk around, not into (round: movement)

Status: planned

## Design

**What you'll see:** Units and groups walk *around* water inlets, forests and buildings
instead of nose-pressing the shoreline; a move group fans out into tidy formation slots
instead of landing on one tile.

**How it works:** Grid A\* over the existing tile walkability (`walkable`); a move order
becomes a path (a list of tiles) with re-path when a tile turns solid (a building placed
mid-walk) or the path's end is taken; per-unit separation radius so groups stop stacking;
harvest/build/move orders all route the same way. Numbers: uniform tile cost on the
existing grid, the roadmap's exit condition of a route within ~15% of optimal length.

**Not in this round:** market/watch tower, blacksmith upgrades, formation shapes beyond
the slot grid (they stay roadmap items).

**How we check it:** `tools/headless-check.js` gains pathing checks: a route around a
water inlet within ~15% of the straight-line-optimal on a walkable grid, a re-path when a
building appears on the route, distinct arrival slots for a 4-unit move group. Existing
checks must stay green.

**Hard constraints that survive from `AGENTS.md`:** the game stays one `index.html`; no
framework, no build step, no new image files beyond the one `assets/sprites.png` atlas;
`index.html` is patched, never rewritten; section 4 stays DOM-free; every task names a
proving check and the `Map of this file` banner stays truthful.

## Tasks

- [ ] T1: `findPath` — the A\* core, with its checks written first
  - files: `index.html` §4 (new `/* ---- pathfinding ---- */` sub-block directly above
    `moveUnit`, `index.html:959`: `tileOf(px, py)` + `findPath(Game, from, to)`;
    `walkable` (980) switches to `tileOf` instead of its own inline `Math.floor(p /
    CFG.TILE)`), §1 `CFG` via `node tools/check-stats.mjs --write`, `data/units.json`
    (`authored[]` + `cfg.ASTAR_MAX_NODES: 4000` + a `cfgNotes` line — the table carries no
    pathfinding budget, so it is authored like `cfg.PROJ_SPEED`), the export block
    (`index.html:2199-2210`), `tools/headless-check.js` (new §6c *pathfinding*, after §6b
    at 637-660)
  - change: 8-connected A\* over the tiles `walkable()` accepts, uniform cost (every open
    tile 1 — the design's "uniform tile cost"), admissible Chebyshev heuristic, a 20-line
    binary heap in the same block, no corner-cutting (a diagonal step needs both
    orthogonal neighbours open); the start tile is accepted even when solid (a unit can
    stand on a farm tile or a fresh foundation), every later tile must satisfy
    `walkable()`; returns `{tx,ty}[]` start→goal inclusive, `null` when the goal is
    unreachable within `CFG.ASTAR_MAX_NODES` expansions (a hopeless query must not stall
    the frame loop), and counts itself in `Game.pathQueries`. No caller uses the route
    yet; `tools/headless-check.js` requires it straight from the module export.
  - done when: `node tools/headless-check.js` prints `142/142 checks passed` (5 new §6c
    checks, 137 existing ones untouched) and `node tools/check-stats.mjs` exits 0 with
    `ASTAR_MAX_NODES: 4000` present in the generated `CFG` block; `assets/sprites.png`
    stays byte-identical (no art change).
  - test: 5 new §6c checks, written before `findPath` — `path: a route on open grass is
    the straight-line optimum` (length equals `max(|dx|,|dy|)`, 8-adjacent and contiguous,
    endpoints exact), `path: a route around a water inlet stays within 15% of optimal`
    (the roadmap P0.2 exit condition: the harness carries its own Dijkstra over the same
    walkable rule, the §6a "write the rule twice" pattern, and asserts the fixture's
    Dijkstra length is itself ≤ 1.15× the straight-line length so the fixture is
    meaningful, then `astar ≤ 1.15 × dijkstra`), `path: a diagonal never squeezes between
    two solid tiles`, `path: an unreachable goal returns null within the node cap`,
    `path: a route starts on the unit's own tile even when that tile is solid`; existing
    §6 `simulate 30s` re-run unchanged. `tools/audit-line-refs.js` is expected to report
    shifted refs after this task — every code task shifts lines and T5 re-points the docs,
    the 2026-11-11 content-port precedent.

- [ ] T2: `moveUnit` follows routes — a move order carries a path and re-paths
  - files: `index.html` §4 `moveUnit` (959-974, rewritten; the X/Y-slide rules at
    971-972 are deleted because the route's own neighbourhood replaces them), `updateUnit`
    (863, its `move` branch 873-876), `makeUnit` (605-617: `path: null, pathAt: 0,
    pathFor: null, pathEpoch: -1`), `createState`/`resetGame` (2018-2043: `mapEpoch: 0`,
    `pathQueries: 0`), the three writers of the walkable set — `makeBuilding` (619),
    `removeBuilding` (666), `depleteTile` (1079) — each bumps `Game.mapEpoch`;
    `tools/headless-check.js` §6c extended
  - change: `moveUnit(Game, u, x, y, dt, stop)` keeps its signature so all five order
    sites keep compiling and behaviour unchanged for them, and becomes route-driven: the
    cached route is valid while `u.pathFor === tileOf(x, y)`, `u.pathEpoch ===
    Game.mapEpoch` and `walkable()` still accepts `u.path[u.pathAt]` — otherwise it is
    rebuilt with `findPath`, which is the design's re-path rule for both "a tile turned
    solid (a building placed mid-walk)" and "the path's end is taken" (a goal whose tile
    changed owner/state forces the rebuild). The route's last tile is the tile containing
    `(x, y)`; while `u.pathAt` is short of it the unit walks that tile centre, and the
    final ≤ 15.6 px from that centre to the exact point is walked straight (that segment
    lies inside one walkable tile), so the `d <= stop` early-out at 963 and every caller's
    `stop` radius keep their exact current meaning. `u.face`/`u.anim` stay written exactly
    as today, so §6b still pins them.
  - done when: 147/147; on T1's inlet fixture a villager ordered to the far side walks the
    stored route (his sampled positions are the route's tile centres, every one
    `walkable`) and ends within `CFG.TILE / 2` of the ordered point; placing a house
    mid-route on the route changes `u.path` on the very next step and he still arrives; a
    clean 60-step walk runs at most 2 `findPath` calls (`Game.pathQueries` — the
    "re-paths every frame" bug class is pinned by a number); an unreachable order leaves
    him idle and unmoved. Existing §6, §6b, §5a, §5a2, §7, §7b, §9, §9b — all of which
    move units through `moveUnit` — stay green.
  - test: 5 new §6c checks, written before the rewrite — `path: a move order walks the
    stored route, not the straight line`, `path: the move order completes on the ordered
    tile`, `path: a building placed on the route re-paths on the next step`, `path: a
    clean walk uses at most two A* queries in 60 steps`, `path: an unreachable move order
    leaves the unit idle`; plus the existing §6 movement-invariant and §6b
    facing/walk-phase checks unchanged.

- [ ] T3: every order kind routes to a standing spot, not at a solid centre
  - files: `index.html` §4 — new `standTarget(Game, u, x, y, stop)` in the pathfinding
    block, `orderForUnit` (1117-1147, whose `workSpot` fallback 1141-1145 becomes a call
    to it) and the four remaining walking branches of `updateUnit`: `attack` (892,
    `moveUnit(..., t.x, t.y, dt, stopR)`), `build` (910, `workPos`), `go_deposit` (924,
    `reachOf(drop)`), `harvest` (934); `autoAcquire` (842) unchanged;
    `tools/headless-check.js` §6c extended
  - change: A\* cannot route to a solid tile, and today only the `move` branch resolves
    one (a right-click on water/building becomes the neighbouring walkable spot) while the
    other branches aim at the centre of a solid thing and stop at a radius. One helper
    resolves `(point, stop)` into the tile the route must end on: a building's ring tile
    (`standingSpots`, 709), the tile satisfying `u.r + t.r + 4` for a melee unit target,
    `range * CFG.TILE` for a ranged one (an archer stops at the table's range instead of
    closing onto the target's tile), `workPos`/`reachOf` for build and deposit, else the
    nearest walkable neighbour, else `null` — and `null` refuses the order instead of
    nose-pressing. Every order kind then runs one path: `order → standTarget → findPath →
    step`, which is the design's "harvest/build/move orders all route the same way".
  - done when: 151/151; a militia ordered to an enemy 3 tiles across a water inlet ends on
    a tile within `u.r + t.r + 4` of it and swings; a militia ordered to a 3×3 Town
    Center ends on its reach ring (`reachOf(b)`), never on its footprint; an archer
    ordered to the same target stops at `4 * CFG.TILE` and shoots; a villager ordered to
    build on the far side of water ends on the site's `workPos` and finishes it. No check
    in the suite can end with a unit standing on a solid tile.
  - test: 4 new §6c checks, written first — `path: a melee attack route ends at contact
    range of the target unit`, `path: a melee attack on a building stops on its reach ring,
    not its footprint`, `path: a ranged attack route stops at the table range and does not
    close to contact`, `path: a build order routes to workPos instead of the straight
    line`; the existing §7, §7b, §9, §9b, §9c checks re-run unmodified as the regression
    proof for the branches being converted.

- [ ] T4: formation slots replace the golden-angle scatter
  - files: `index.html` §4 — `spread(o, i)` (1172-1176) deleted, new
    `formationSlots(Game, sel, x, y)` in the pathfinding block, `issueOrder` (1150-1169)
    assigns one slot per selected unit instead of calling `spread`, `makeUnit` (605-617)
    gains `slot: null`, `updateUnit`'s `move` branch (873-876) reads `u.slot`;
    `tools/render-preview.js` (the fixture selects the 4 villagers and issues one move
    order, instead of ordering only the first villager's source), `preview.png`
  - change: a centred slot grid replaces the spiral: `cols = ceil(sqrt(n))`, pitch
    `max(CFG.UNIT_SEP, CFG.TILE)` px snapped to tile centres around the ordered point,
    solid cells skipped and the grid grown (bounded by `n²` cells) until every unit has a
    distinct walkable slot; the nearest free slot is paired to the nearest unit so nobody
    crosses the formation, and `u.slot` is what each unit's `move` order routes to — so a
    slot taken by another order forces a re-ask instead of a stack. The pitch is
    `CFG.UNIT_SEP` expressed on the tile grid, so a parked group satisfies `separate()`
    (1000) with zero pushes — the two mechanisms agree by construction. `attack` and
    `harvest` orders keep their targets (no slots for a fight).
  - done when: 155/155; ordering 4 villagers to one point yields 4 distinct walkable slots
    in a 2×2 grid at that pitch, and all 4 end within `CFG.TILE / 2` of their own slot with
    a following `separate()` call moving nobody. `preview.png` is regenerated and shows the
    squad standing fanned out on its slot grid on land.
  - test: 4 new §6c checks, written first — `formation: a 4-unit move order yields 4
    distinct walkable slots`, `formation: every unit of the group arrives on its own slot`,
    `formation: a group parked on its slots needs zero separation pushes`, `formation:
    slots skip water and still give every unit a distinct tile`; existing §10/§11
    input + command-bar checks green; visual = `node tools/render-preview.js`, look at
    `preview.png` (4 villagers on 4 tiles, none in water).

- [ ] T5: Docs sync and the full verification pass
  - files: `docs/GAME_RULES.md` (the `## Movement` block, 40-51: the
    "Movement itself is still straight-line axis-sliding … no A\* yet (roadmap P0.2)"
    bullets replaced by the A\* rule — uniform cost, route caching + re-path triggers,
    `standTarget`, formation slots; then every `index.html:NNN` in the file re-pointed),
    `docs/ARCHITECTURE.md` (section spans, the new `pathfinding` sub-block added to the
    section-4 Contents cell that the audit requires for every named banner, the
    `—`/public-surface row, `findPath`/`moveUnit`/`formationSlots` prose),
    `docs/CHANGELOG.md` (dated entry), `docs/ROADMAP.md` (P0.2 marked shipped with the
    plan link and its "Known limit the 2026-11-04 board-rules pass leaves in place" note
    removed), `AGENTS.md` (the `index.html is N lines` claim `tools/audit-line-refs.js`
    verifies), this plan's `Status: done`
  - change: docs only, one commit; no code edits — this task also closes the line-ref
    drift T1-T4 deliberately left behind.
  - test: `node tools/audit-line-refs.js` (green: it re-checks the new sub-block citation,
    the section spans, the §1 config range, the tools inventory and the file-length claim),
    then the full AGENTS set — `node tools/headless-check.js` (`155/155 checks passed`,
    exit 0), `node tools/render-preview.js` + look at `preview.png`,
    `node tools/gen-atlas.js` (no art change: `assets/sprites.png` byte-identical),
    `node tools/check-stats.mjs` (exit 0).
