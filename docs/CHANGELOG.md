# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/); versions are the git
commits on `main`.

## [Unreleased] — 2026-11-12

### Blacksmith tech tree (T1–T6) — plan `docs/plans/2026-11-12-blacksmith-tech-tree.md`

The first real upgrade path (a0be85c → d93d017); the harness went 156 → 175 checks
across the plan.

- **T1 — the Blacksmith row, the age gate, `k` (a0be85c):** `data/buildings.json` gains
  `blacksmith` (the `BLAC` row: 1800 hp, 150 wood, 40 s, 1×1, **age 1**) and `BLD`
  follows; `build` refuses an age-locked kind before drafting a builder
  (`Blacksmith requires Feudal Age`), the button and the `k` hotkey only appear once
  the age is reached, and `check-stats.mjs` learned the row's `age` field
  (156 → 160 checks).
- **T2 — vendored techs (25b331a):** `data/techs.json` vendors Forge, Scale Mail,
  Fletching and Bracer (costs, times and effects copied from the vendored sources,
  never retuned) and `check-stats.mjs --write` renders the `TECHS` table beside the
  other section-1 blocks; the check now proves 265 fields.
- **T3 — one combat math (9708a20):** `unitAttack`/`unitArmor` replace the duplicated
  age-scaling expressions in §4 — attack is the row's number × the age multiplier ×
  every researched tech of the attacker's damage class, armour is the row's plus the
  techs' flat armour, and `hitUnit` lands `max(1, attack − armour)` — while
  `Game.techs` (the researched-id set) joins `createState`/`resetGame`
  (166 checks, the new §9d pins the stack on the melee and pierce paths).
- **T4 — `researchTech` (56d6ade):** a finished blacksmith researches one tech at a
  time; every refusal goes through `toast` before a cost is spent (age, duplicate,
  busy slot, cost, building mismatch — `Barracks cannot research Forge`) and the
  finish adds the id to `Game.techs` (166 → 172 checks).
- **T5 — the research surface (d93d017):** `commandsHtml` offers a `data-act="research"`
  button per unresearched tech (disabled when unaffordable or in flight), `queueHtml`
  grows the `Researching Forge` bar beside the training branch, `drawBuildings` picks
  the on-map bar's total from the research slot or the queue, `infoHtml` lists
  `Upgrades:`, the click handler dispatches `research`, and `preview.png` regenerates
  with the blacksmith beside the squad (172 → 175 checks).
- **T6 — docs sync:** this entry plus `docs/GAME_RULES.md` (a `## Technologies
  (TECHS)` section, the Blacksmith row and the rewritten damage bullet),
  `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` (P1.4 shipped) and `AGENTS.md`
  (`data/techs.json` in the truth table) re-pointed at the final file — every
  `index.html:NNN` reference and section range re-measured through
  `tools/audit-line-refs.js`.

## [Unreleased] — 2026-11-11

### Board rules pass (T1–T5) — plan `docs/plans/2026-11-04-board-rules.md`

One pass over the board rules (d9b16b4 → 9d0b55f); the per-task entries are merged here
at T6, and the harness went 99 → 111 checks across the pass.

- **T1 — halved starting economy (d9b16b4):** `CFG.START` 200/200/100/100 →
  100/100/50/50, villager `CARRY_MAX` 10 → 15, `GATHER_RATE` 3.0 → 1.5/s, villager and
  militia train times 5 s / 6 s → 2.5 s / 3 s, berry tiles 110 → 150 food. Numbers only;
  a new `tuning: CFG and KINDS match the agreed numbers` check pins all six values so a
  silent revert can't pass (100 → 101 checks).
- **T2 — solid terrain (7a504f1):** `walkable` now rejects water, resource tiles with
  stock and occupied building tiles alike, so units walk around forests, ore and
  buildings and work from the neighbour tile; `workSpot` offers only walkable neighbours
  and `makeBuilding` relocates a unit caught under a new footprint to `workPos(b)`. The
  harness's per-frame water scan became a solid-tile scan plus the relocation check
  (101 → 104 checks).
- **T3 — one berry cluster per Town Center (ff38ca8):** `berryCluster` replaces the 7
  scattered patches and the 2 ring berries with exactly one connected 6-tile cluster per
  keep at 5–8 tiles' distance — each start reads as one grove beside the keep and the
  starters reliably open on their own berries (three `map:` checks pin the layout;
  104 → 107 checks).
- **T4 — depleted tiles vanish, re-queue within 5 tiles (c8799a5):** `depleteTile`
  reverts a tile the moment its `amount` reaches 0 to `T.GRASS` (farms still empty in
  place), and `nextSource`/`resumeGather` now search the same resource within 5 tiles
  only — the radius-14 band and the any-resource radius-20 fallback are gone, so a
  villager whose grove is spent takes the next bush beside him or goes idle (three
  `depletion:` checks; 107 → 110 checks).
- **T5 — one builder per building (9d0b55f):** `build()` no longer re-picks the same
  first villager from the selection on every placement — the multi-build bug that
  yanked each builder off his unfinished site — `pickBuilder` assigns the nearest
  **idle** villager, never takes one off a `built < 1` site, and refuses with `All
  villagers are building` when none is free; two placements from one 4-villager
  selection now raise two complete buildings (110 → 111 checks).

### Cancel construction + demolish (T1–T5) — plan `docs/plans/2026-11-04-cancel-demolish.md`

Phase 2 of the 2026-11-04 rules pass (ed29144 → bd73da6). `CFG.CANCEL_REFUND = 0.8` and
`refund()` joined as the single crediting writer of `Game.res` (T1); one `removeBuilding`
path is now shared by `hitBuilding`, cancel and demolish and also clears the
`selectedBuilding` a raze used to leave dangling (T2); `cancelConstruction` refunds the
floored 80% of a site's defined cost regardless of progress and frees its builders (T3);
`demolish` removes a finished own-team building for nothing, protecting Town Centers and
buildings with a training queue (T4); the footer renders and dispatches `Cancel`/
`Demolish` buttons (T5). Harness 111 → 119 checks (the `tuning:` pass plus refund, three
`cancel:`, three `demolish:` and the `ui:` dispatch checks; the §9b raze check now also
asserts the selection clears).

### OG content port (T1–T7) — plan `docs/plans/2026-11-11-og-content-port.md`

The invented numbers and the drawn art are gone: the stats come from the vendored AoE2 tables
and every sprite frame from the ripped graphics (f3ff6e6 → 08ca6a8), and the harness went
121 → 137 checks across the plan.

- **T1 — vendored tables + the stats check (f3ff6e6):** `data/units.json`,
  `data/buildings.json` and `data/README.md` vendor the community `.dat` / `aoe2techtree`
  rows the game is built from (id + `internal_name` per row, fetch date and swap rule
  documented); `tools/check-stats.mjs` extracts the `<script>`, requires it and exits 1 with
  one line per drifted field, `--write` renders the three §1 blocks. Written before the code
  it guards, and documented in `README.md` + `AGENTS.md` so `audit-line-refs` stays green.
- **T2 — section 1 becomes generated (ba010c6):** `CFG`/`KINDS`/`BLD` are now the rendered
  form of `data/` — villager 25 hp, atk 3, 0.64 s, 18 px/s (0.8 tiles/s), 50 food, 25 s;
  militia 40 hp, atk 4, 0.5 s, 20 px/s, 50 food + 20 gold, 21 s; `CFG.CARRY_MAX` 15 → 10;
  Town Center 2400 hp (275 wood + 100 stone), farm 480/60, barracks 1200/175, mill 600/100,
  lumber camp 1800/150, mining camp 600/100 — with `w`/`h`/`pop`/`field` untouched so the
  footprint rule keeps holding. The §5 `tuning:` check reads `data/` instead of six
  hand-typed literals, and a second one pins `KINDS.speed === round(tiles/s × CFG.TILE)` —
  the exact bug class the tiles/s → px conversion introduces (121 → 122 checks).
- **T3 — the atlas is composed, not drawn (629d0ec):** `data/sprites/` + `data/sprites.json`
  carry the ripped frames (the source's player-colour ramp mapped onto
  `TEAM[t].dark/main/light`) and `tools/gen-atlas.js` composes `assets/sprites.png` and
  regenerates `SPRITE_SHEET`/`SPRITES`/`WORK_ANIM`/`BLD_SPRITES` — no hand-authored cells
  left in `index.html`; `preview.png` is the real renderer's own frame.
- **T4 — the archer line, from the same table (fc21c75):** `data/units.json` gains `archer`
  (id 4 `ARCHR`: 30 hp, atk 4, range 4, min 0, reload 2 s, accuracy 80 %, 25 wood + 45 gold,
  0.96 tiles/s) and `data/buildings.json` gains `archery_range` (id 87 `ARRG`: 1500 hp,
  175 wood, 2×2, `trains: ['archer']`), with hotkey `R`, the footer button, the delegate case
  and the sprite cells; `preview.png` now places an archer. New §8 train check (the table's
  stats, not new ones) and the §11 placement check.
- **T5 — ranged combat off the table (d51a499):** `KINDS.atkType` splits melee from ranged.
  A shooter faces its mark, stops at `range × CFG.TILE` and fires on the `reload` cadence;
  `Game.projectiles` + `spawnArrow`/`updateProjectiles`/`stepBuildingAttacks` and
  `cfg.PROJ_SPEED` 176 px/s join §4, the hit is gated by `Game.rnd` against `accuracy`, one
  arrow never hits twice and a shot at a corpse doesn't splash. `autoAcquire` compares against
  the per-kind range instead of the single global radius, and the Town Center (attack 5,
  LOS 8) shoots through the same path — 133 checks, incl. the new §9c (125 → 133).
- **T6 — win/lose (08ca6a8):** `setResult` computes the result from the board inside
  `removeBuilding` (the one exit shared by raze, cancel and demolish): no Town Center left on
  one side ends the game — `victory` for the enemy's, `defeat` for yours. `stepSim` stops
  after the clock tick once a result is set, and the `#result` overlay (`resultHtml`, styled
  in the head) renders Victory/Defeat with a `New game` button that calls `resetGame`.
  New §9e (133 → 137).
- **T7 — docs sync:** this entry plus `docs/GAME_RULES.md`, `docs/ARCHITECTURE.md`,
  `README.md` and `docs/ROADMAP.md` re-pointed at the final file — every `index.html:NNN`
  reference and section range re-measured through `tools/audit-line-refs.js`.

### A\* pathfinding — walk around, not into (T1–T5) — plan `docs/plans/2026-11-11-astar-pathfinding.md`

Movement stops being straight-line: orders route over the tile grid and squads arrive in
ranks (a1bcebd → 452a269); the harness went 137 → 156 checks across the plan.

- **T1 — `findPath`, the A\* core (b24d020):** an 8-connected, uniform-cost A\* over the
  tiles `walkable` allows — no diagonal squeezed between two solid tiles, `CFG.ASTAR_MAX_NODES`
  capping one query — exported for the harness and graded against the harness's own Dijkstra:
  the new §6c pins an open-grass route at exactly its optimal length, a route around a water
  inlet within 15% of it, the corner rule and one capped query for an unreachable goal
  (137 → 142 checks).
- **T2 — `moveUnit` walks routes instead of sliding (ddf0a0c):** the move order carries a
  waypoint list (`u.path` / `u.pathFor` / `u.pathAt`), the walk follows the route's tile
  centres and then the exact ordered point, and one rule says when the cache dies — a changed
  goal tile or a bumped `Game.mapEpoch` (a building went up, a tile ran dry) — which is what
  re-paths mid-walk; `walkable` now asks the shared `tileOf` instead of repeating the floor
  maths inline (142 → 147 checks).
- **T3 — every order kind routes to a standing spot (1174571):** `standTarget` answers with
  a tile to stand on — the ordered point itself when it is walkable or already within the
  order's arrival radius, else `workPos` for a building / `workSpot` for any other tile — so
  harvest, build, deposit and attack orders stop walking at a solid centre and all run one
  pipeline, order → standTarget → findPath → step (147 → 151 checks).
- **T4 — formation slots replace the golden-angle scatter (452a269):** `formationSlots` gives
  a group's `move` orders one distinct walkable tile each on a centred `cols = ceil(sqrt(n))`
  grid (the `CFG.UNIT_SEP` pitch expressed on the tile grid, solid and already-held cells
  skipped, the grid grown until everybody is housed, the nearest free slot paired to the
  nearest unit); the slot is written into the order *and* `u.slot` and released when the order
  retires, so a squad arrives in ranks instead of stacked on one tile and a parked group needs
  zero `separate()` pushes (151 → 155 checks).
- **T5 — docs sync:** this entry plus `docs/GAME_RULES.md` (its `## Movement` section now
  documents the routing rule instead of the straight-line limit), `docs/ARCHITECTURE.md` (the
  `pathfinding` sub-block and a `### Pathfinding` section), `docs/ROADMAP.md` (P0.2 shipped)
  and `AGENTS.md` re-pointed at the final file — every `index.html:NNN` reference and section
  range re-measured through `tools/audit-line-refs.js`.
- **review:** `issueOrder` clobbered a selected unit with `u.order = null` — and threw on the
  way — whenever the click resolved to no order for him (a point off the map, or a solid tile
  with no standing spot); the pre-T4 `if (!o) continue;` is back, so such a unit keeps the
  order and the formation slot he had and the group does not ping for an order nobody
  received. §10 gains the check (155 → 156 checks), and the docs it shifted are re-pointed.

### Added
- **Building sprites (task 5):** every built building now blits a team-coloured atlas
  cell instead of the flat footprint rectangle — `BLD_SPRITES`/`bldSpriteFor` join the
  sprite tables (atlas grows 288×48 → 308×158: unit rows on top, building rows below;
  town_center 66×66, house/farm/barracks/mill 44×44, camps 22×22, each cell drawn at the
  exact footprint). `tools/gen-atlas.js` gains `BLD_ART` (one 11×11 art grid per kind —
  keep/roofs/fields/tents, authored once and recoloured via the team palette) and paints
  38 cells from the two tables; the mill now tracks `field` like a farm. Unbuilt
  buildings keep the ghost + progress-bar render, dry farms keep procedural stubble.
  New harness section 5b3 validates every BLD kind × team has a unique in-sheet cell at
  its exact footprint (99 → 100 checks).
- **Lumber Camp (100 wood, hotkey `L`), Mining Camp (100 wood, `G`) and Mill (175 wood,
  `M`)** join `BLD` — camps 1×1, mill 2×2, drawn procedurally for now (atlas art arrives
  with the building-sprites round). Carrying villagers now route by resource instead of
  always walking to the Town Center: wood → Lumber Camp → TC, gold/stone → Mining Camp →
  TC, food → Mill → farms → TC (`dropTargetScore`/`findDropoff`). Harness section 7b plus
  hotkey checks pin the costs, sizes and every routing rule (81 → 92 checks).
- **Militia auto-acquire + retarget-on-kill + razing (task 4):** non-villager fighters
  pick the nearest enemy unit within `CFG.ACQUIRE` (6 tiles) on their own, else the
  nearest built enemy building within `CFG.BUILDING_ACQUIRE` (5) — `autoAcquire` powers
  both the idle state and the snap to the next target when the current one dies.
  Attacks can now target buildings (`order.b`): `hitUnit`/`hitBuilding` centralize
  damage, and a building at 0 hp is razed, removed and re-blocks its tiles. Right-click
  an enemy building to raze it. Harness section 9b (92 → 99 checks); the old
  "attacker took no damage" check becomes "may be countered" — enemies fight back now.

### Changed
- **Sprite atlas v2** (villager redesign): villagers no longer wear the militia's helm —
  bare head with hair, plain tunic, and the tool of whatever they are working at in hand.
  `SPRITES` becomes `kind → animation → [Blue, Red]`: villagers get idle/walk plus
  per-resource work frames (farm/chop/mine, a/b alternating at 4 Hz), militia get
  idle/walk plus attack_a/attack_b. The sheet grew 96×24 → 288×48 (24 cells);
  `spriteFor(kind, team, anim)` resolves a cell and the new pure `unitAnim(u)` decides
  which animation a unit plays from its order. The 1px bob now applies only to walk
  cells — work/swing frames animate through their own art. Harness sections 5b/5b2 pin
  the table shape, cell uniqueness and the order→animation mapping (75 → 81 checks).

### Fixed
- **Villagers stopped collecting food once the berry tile ran dry** (the "food stalls at
  420" report). Two causes: `assignStarter` gave every starting villager the *same*
  nearest tile, and `resumeGather` re-validated that exact tile after depositing — when
  another villager drained it mid-carry the worker went idle forever. Starters now spread
  (max `CFG.WORKERS_PER_TILE = 2` per tile, food first, then wood, then anything) and a
  dead tile falls back through `findAlternative` exactly like `nextSource` does. Verified
  in the sim: gold now accrues (100 → 970 over 120 s) where it previously sat at 775.
  Harness section 5a pins the spread, the food-first order and the retarget (72 → 75
  checks).

- **Half-built buildings offered train buttons** (the "a half-built barracks or Town
  Center still shows its train buttons" report). `b.built` is a 0..1 progress fraction, so
  the truthy gate in `commandsHtml` rendered train buttons for any foundation even while
  `train()` refused with `Still building`; the gate is now `b.built >= 1`. New `ui:`
  check pins both halves — half-built Barracks: Cancel only, finished: Militia (120 → 121
  checks).

## [7fe4d9b] — 2026-11-03

### Added
- Unit art: `assets/sprites.png`, a 96×24 atlas with one 24×24 cell per unit kind × team,
  generated by `tools/gen-atlas.js` from the `SPRITES` table in `index.html` (the table is
  the source of truth; the PNG is deterministic, so regeneration is diffable). `drawUnits`
  blits a unit's cell, mirrors it when the unit walks left and bobs it 1px while walking,
  falling back to the old discs/squares when no atlas is loaded. `index.html` gained
  `SPRITE_SHEET`, `SPRITES`, `spriteFor`, `setAtlas` and `loadAtlas`.
  Harness: sprite-table coverage, atlas injection and facing/walk-clock checks (66 → 72
  checks).
- `tools/audit-line-refs.js`: verifies that every `index.html:NNN` reference in the docs
  still names the code it claims, that the documented section ranges match the banners in
  `index.html`, and that `AGENTS.md`/`README.md` list every file in `tools/`. It found
  seven stale ranges on its first run.
- `AGENTS.md`: repo working rules for agents and humans (single-file constraint,
  verification gate, the >300-line editing rule, deploy check).
- `docs/`: `ARCHITECTURE.md` (file map with line ranges, `Game` shape, sim/render/input
  models, harness design), `GAME_RULES.md` (the implemented ruleset with line refs),
  `CONVENTIONS.md` (naming, formatting, feature recipe, anti-rules), `ROADMAP.md`,
  `CHANGELOG.md`.
- README documents `barracks` and the full age ladder it already supported.

### Fixed
- `tools/render-preview.js` no longer fakes `Image` from a file buffer: an
  `@napi-rs/canvas` 1.1.0 image built that way reports `96x24` / `complete: true` but paints
  nothing, so the first sprite preview showed selection rings over invisible units. The
  harness now decodes the sheet with `loadImage()` and injects it through `setAtlas` — the
  same path a browser's `img.onload` uses — and the check asserts the loaded image matches
  `SPRITE_SHEET` instead of merely existing.
- Hovering a header resource icon or a footer command button panned the camera: the
  document `mousemove` fed canvas-relative coords into the edge-scroll even when the
  pointer was off the canvas (a pointer above the top edge read as "cursor pinned to
  the top edge"). `Game.mouse` is now set only while the pointer is over the canvas or
  during a drag; harness section 10b covers it (63 → 66 checks).
- Docs now match the code: corrected section line ranges and the age-cost rule (Imperial
  is reachable, not blocked).

## [8841d51] — 2026-11-03

### Added
- README with live-site link, feature list, known limits and tool docs.
- Repo published to GitHub Pages from the `main` branch root
  (https://barf-bot.github.io/aoe2-mini/).

## [8e670c3] — 2026-11-03 — "the bug-fix pass"

### Fixed
- **Deposits vanished**: harvesting tick set `u.carry` without `u.carryRes`, so
  `deposit()` credited nothing to any stockpile. Resource gain was 0 in a live sim.
- **Buildings never finished**: `makeBuilding` omitted `time`, so progress became `NaN`,
  the completion branch never ran and `hp` went `NaN`.
- **Fighters couldn't hit anything**: `KINDS` lost `r` (unit radius), so the attack stop
  distance was `NaN` and the unit could never get inside the separation radius.
- **Clicks landed on `NaN`**: `toWorld()` read `view.w`/`view.h` instead of the canvas's
  `width`/`height`, so every click and drag produced `NaN` world coordinates and the
  cursor was unusable.
- **Villagers idled at an empty tile**: added `nextSource()` to retarget the nearest tile
  of the same resource, then any resource.
- Harness: right-click tests asserted on the previously selected unit instead of the one
  `issueOrder()` actually commanded.

### Added
- `tools/render-preview.js`: renders a real frame through `@napi-rs/canvas` and writes
  `preview.png`, proving the renderer runs (not just the simulation).
- Extra harness checks (re-click selection, HUD label wiring).

### Verification
- `node tools/headless-check.js` → **63/63 checks passed** (was 60/62 before the fixes).
- `preview.png` regenerated from the patched renderer and inspected.

## Initial — 2026-11-03

### Added
- First working `index.html`: single-file RTS prototype — seeded 96×96 map with fog of war,
  Town Center and villagers, gathering economy, houses/farms, villager + militia training,
  melee combat, ages, drag-select, control groups, minimap, enemy AI.
- `tools/headless-check.js`: extracts the `<script>` block, stubs the DOM, boots the game in
  node and asserts simulation invariants.
