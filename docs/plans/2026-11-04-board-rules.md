# Board rules: solid terrain, berry clusters, depletion, tuning, multi-build

Status: in progress

## Design

**What you'll see:** nothing walks through trees, ore or buildings any more — villagers
path around and work from the tile next to the thing. Each Town Center gets exactly one
6-bush berry cluster 5–8 tiles out; eat it and the bushes vanish. Numbers feel half as
fast, and placing a second building while several villagers are selected actually builds
two buildings.

**How it works:**

- `walkable()` (`index.html:706`) today only rejects water. It becomes: in bounds, not
  water, not a resource tile with `amount > 0`, not in `Game.occupied` (buildings,
  foundations included — same rule AoE2 uses). `workSpot`/`workPos` (445/511) already
  stand workers on the neighbour tile; `workSpot` stops offering occupied tiles, and a
  unit caught under a new footprint is moved to `workPos(b)`.
- Berries: `CFG.RES.berry` 110 → 150; map gen (§2) drops the 7 scattered patches + the 2
  ring berries and grows one seeded 6-tile cluster per Town Center, every tile 5–8 tiles
  from the TC.
- Depletion: `amount == 0` reverts the tile to grass (`depleteTile`). `nextSource`
  same-resource radius 14 → 5, and the "any other resource within 20" fallback is deleted
  — nothing within 5 means idle.
- Tuning (§1): start 200/200/100/100 → 100/100/50/50, `CARRY_MAX` 10 → 15,
  `GATHER_RATE` 3.0 → 1.5, villager train 5s → 2.5s, militia 6s → 3s.
- The multi-build bug: `build()` (861) always takes `sel.find(villager)` — the *same*
  first villager — and reassigns him to the new site, so building #1 stalls at partial
  forever. Fix: nearest **idle** villager builds, a builder already on a site is never
  yanked off.
- Known limit, said out loud: movement is still straight-line (no A*, roadmap P0.2), so
  detours around large blobs can stall. This pass buys solidity, not pathfinding.

**Not in this round:** wooden barricades + Feudal gating, cancel-construction (80%
refund), demolish, and the uniform UI/overlay frame — those are phase 2, recorded in
`docs/ROADMAP.md` by this commit.

**How we check it:** new sections in `tools/headless-check.js` — solidity (a villager
ordered across a forest tile never enters it), berry layout (exactly 6 tiles per TC, all
150 food, all 5–8 tiles out), depletion (harvest to 0 → grass, retarget within 5, then
idle), the five CFG numbers, and two buildings from one 4-villager selection both
completing. Plus a regenerated `preview.png` to eyeball the cluster.

## Tasks

- [x] T1: Halve the economy numbers (pure tuning pass)
  - files: `index.html` §1 `CFG` (101-118) + `KINDS` (120-125); `tools/headless-check.js`
    §5 (196); `docs/GAME_RULES.md` (Map + Units tables), `docs/CHANGELOG.md`
  - change: `START` 200/200/100/100 → 100/100/50/50; `CARRY_MAX` 10 → 15; `GATHER_RATE`
    3.0 → 1.5; `KINDS.villager.time` 5 → 2.5; `KINDS.militia.time` 6 → 3;
    `RES.berry` 110 → 150. Numbers only, no logic.
  - done when: those six values read as listed in `index.html`; the existing
    `roster: starting stock 200 food / 200 wood` check is amended in place to 100/100
    (not deleted); the 900-step sim still reports `economy: food accrues`.
  - test: new `tuning: CFG and KINDS match the agreed numbers` check asserting all six
    values, so a future revert cannot pass silently. Section 6 checks otherwise untouched.

- [x] T2: Solid tiles — walkable consults resources and buildings
  - files: `index.html` §4 `walkable` (706), `workSpot` (445), `makeBuilding` (478),
    export block (1752-1764); `tools/headless-check.js` §6 (371-406)
  - change: `walkable(Game, px, py)` = in bounds AND not WATER AND not a resource tile
    with `amount > 0` AND not in `Game.occupied`. `workSpot` offers only walkable
    neighbour tiles (today it skips water alone) and returns `null` when none exists,
    which `sourceFromTile` and `orderForUnit` already tolerate. `makeBuilding` moves any
    unit standing inside the new footprint to `workPos(b)`. Export `walkable` and
    `workPos` so the harness can assert on them.
  - done when: a villager ordered onto the far side of a forest/ore tile never lands on a
    solid tile (the existing X/Y slide in `moveUnit` does the walking), a unit caught
    under a new footprint ends up at `workPos(b)`, and the four starting villagers plus
    both starting militia all start on walkable tiles.
  - test: §6's per-frame scan widens from `sim: no unit ever enters water` to
    `sim: no unit ever stands on a solid tile` (water OR a resource tile with amount>0 OR
    an occupied building tile) over the same 900 steps, plus
    `build: a unit caught under a new footprint is relocated to workPos`.

- [x] T3: One berry cluster per Town Center
  - files: `index.html` §2 `makeWorld` (280-350, the 7 berry `patch()` loop at 326-330
    and the ring berries at 343-347); `docs/GAME_RULES.md` (Map), `docs/CHANGELOG.md`;
    `tools/headless-check.js` §4 (158-183)
  - change: delete the scattered berry patches and the 2 ring berries; add
    `berryCluster(world, rnd, site)` that picks exactly 6 grass tiles at Chebyshev
    distance 5..8 from a Town Center (seeded pick, ring widened if fewer than 6 grass
    tiles exist) and call it for `siteA` (blue) and `siteB` (red). The gold ring and the
    siteB gold row stay; export `berryCluster`.
  - done when: the seeded map holds exactly 12 berry tiles — 6 within 5..8 tiles of each
    Town Center, all 150 food — no berry tile within 5 tiles of either TC, and
    `assignStarter` still puts all 4 blue villagers on food (it searches rings outward and
    now finds the cluster at r = 5).
  - test: new §4 checks `map: exactly 6 berry tiles per Town Center`,
    `map: every berry tile is 5-8 tiles from its own Town Center`,
    `map: each berry tile holds 150 food`; the existing
    `world: seeded generation is deterministic` and `world: gold field beside the player
    Town Center` checks stay green. Visual: `node tools/render-preview.js`, look for one
    cluster beside the keep instead of scattered bushes, commit the new `preview.png`.

- [ ] T4: Depleted tiles disappear; workers re-queue within 5 tiles, then idle
  - files: `index.html` §4 harvest branch (662-684), `nextSource` (784), `resumeGather`
    (795), new `depleteTile` + export; `tools/headless-check.js` §5a (198-227)
  - change: add `depleteTile(Game, tx, ty)` — a tile whose `amount` reaches 0 becomes
    `T.GRASS`, so bushes/ore/stumps vanish and stop blocking movement (per T2) — called
    from the harvest tick the moment the pool empties. `nextSource` and `resumeGather`
    both drop from same-resource radius 14 to 5 and delete the
    `findAlternative(world, u, null, 20)` any-resource fallback.
  - done when: one villager emptying a 150-food berry tile (10 trips at carry 15) turns
    that tile to grass the tick it hits 0; he then takes a same-resource tile 4 tiles
    away, and goes idle when the nearest other tile is 6 tiles away.
  - test: new `depletion:` checks (emptied tile's type is GRASS and walkable again;
    retarget at 4 tiles succeeds; retarget at 6 tiles yields `idle`). The existing
    `gather: villager whose tile died in flight retargets instead of idling` check is
    re-authored to stand the villager 2 tiles off the dead tile with a live same-resource
    tile 3 tiles the other way, so it still proves the retarget under the 5-tile cap.

- [ ] T5: One builder per building (the multi-build bug)
  - files: `index.html` §4 `build` (861-881); `tools/headless-check.js` §7 (432-464)
  - change: `build()` stops using `sel.find(u => u.kind === 'villager')` — the same first
    villager on every placement, yanked off his first site and leaving it stalled at
    partial forever. It picks the nearest **idle** villager in the selection (falling back
    to the nearest idle team-0 villager, as today), refuses with
    `All villagers are building` when none is free, and never reassigns a villager whose
    order is `build` on a building with `built < 1`.
  - done when: with 4 villagers selected, placing a house and then a farm yields two
    standing buildings with two different builders, and the sim drives both to
    `built === 1`.
  - test: new §7 check `build: two placements from a 4-villager selection get two distinct
    builders and both complete`; the existing §7 construction checks (single placement)
    keep passing.

- [ ] T6: Docs sync and deploy check
  - files: `docs/GAME_RULES.md`, `docs/CHANGELOG.md`, `docs/ROADMAP.md`, `preview.png`
  - change: GAME_RULES rewritten to the post-change ruleset (map, berries, depletion,
    tuning, movement) with fresh line refs; CHANGELOG entry for the pass; ROADMAP marks
    the P0.2 pathfinding note as the known limit this pass leaves in place.
  - test: `node tools/audit-line-refs.js` passes (every `index.html:NNN` ref in the docs
    still names the code it claims), `node tools/headless-check.js` and
    `node tools/render-preview.js` green, then push and confirm
    `gh api repos/barf-bot/aoe2-mini/pages --jq .status` is `built` and the served bytes
    match `index.html`.
