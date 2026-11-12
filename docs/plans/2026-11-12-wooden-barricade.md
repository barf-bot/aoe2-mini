# Wooden barricade and gated choke points

Status: in progress

## Design

**What you'll see:** once you reach Feudal, a `Barricade` button (hotkey `w`) joins the
villager command panel. Click a tile and a villager walks over and raises a 1x1 wooden
segment; enemy fighters raze it, and the moment one falls, units route through the gap.
Spend a handful to close a valley and the map's lanes start to matter.

**How it works:** a new `BLD.barricade` row whose numbers are copied from the vendored table
— the `data/buildings.json` row for upstream id 72 / internal_name `WALL`: hp 150, cost
3 wood, time 7, meleeArmor 2, pierceArmor 5, lineOfSight 2, attack 0, range 0, reload 0,
accuracy 0, garrisonCapacity 0. The label `Barricade`, the 1x1 footprint and the Feudal
`age: 1` gate are authored in `data/buildings.json` and recorded in its `source.rule` line,
the same precedent the blacksmith row uses; `tools/check-stats.mjs --write` regenerates the
`BLD` block in `index.html`. `noSprite: true` until its ripped atlas frame lands, which
belongs to roadmap P2 item 8.

Everything else reuses the existing build pipeline: grass-only + no-overlap + within 7 tiles
of a villager (`build` / `siteFree` / `near` / `findSite`), one builder, the 80% cancel
refund, demolish for nothing, and a `w` hotkey line beside the existing build hotkeys in the
keydown handler (`w` is free; `b` is the barracks). Pathing needs no new code: `rebuildBlocks`
marks the tile solid on completion, so cached routes invalidate and `findPath` reroutes, and
a unit sealed in a pocket gets the existing unreachable-route behaviour (`findPath` null /
`standTarget` fallback). Razing reuses `findTarget`'s enemy-building branch and
`hitBuilding` — no new combat code.

**Not in this round:** the Stone Wall / Ruins / Fortified Wall chain and gates,
drag-to-build-a-run-of-walls, garrison, the ripped barricade atlas frame, enemy AI that
prefers walls over units.

**How we check it:** a harness section that pins the row drives build/placement, the
placement refusals, occupied-tile routing before and after building and demolishing, and the
raze path; `check-stats` and `audit-line-refs` green; `preview.png` regenerated with a
barricade in the frame; docs sync closes roadmap item 6.

**Hard constraints that survive from `AGENTS.md`:** the game stays one `index.html`; no
framework, no build step, no new image files beyond the one `assets/sprites.png` atlas;
`index.html` is patched, never rewritten; section 4 stays DOM-free; every task names a
proving check and the `Map of this file` banner stays truthful.

Two places where the design's prose and the code disagree; both are settled here so the
executor does not have to guess:

- **`w` is not free.** It is the pan-up key (`index.html:2368`
  `if (k === 'w' || k === 'arrowup') keys.up = v;`), and every build hotkey branch in the
  keydown handler returns before `setKey(k, true)` (`index.html:2390`). Taking `w` for the
  barricade therefore moves keyboard pan-up onto `ArrowUp` alone — the same early return the
  other nine hotkeys already do, and no check asserts `w` panning (§10b only covers
  mouse edge-scroll). Accepted as designed; T6 rewrites the header banner
  (`index.html:94` `Controls: left click / drag to select, right click to command, WASD to
  pan.`) so panning reads `WASD / arrows`, the same line the rules document quotes.
- **The tile turns solid at placement, not at completion.** `makeBuilding`
  (`index.html:678-680`) calls `rebuildBlocks` + bumps `Game.mapEpoch` the moment the site
  exists, and `walkable` (`index.html:1317`) documents "an unbuilt foundation counts". So a
  barricade under construction already blocks routing; T3 pins the real rule instead of the
  wording.

## Tasks

Every line number below is the current `index.html` (2679 lines, HEAD `237103c`) and the
current `tools/headless-check.js` (2292 lines, 198 checks passing). T1 shifts `index.html` by
6 lines; T6 re-points every doc reference, which is the house precedent
(`docs/plans/2026-11-12-market-watch-tower.md` T6).

- [x] T1: the `barricade` row — data, the generated `BLD`, the `w` hotkey
  - files: `data/buildings.json` (`buildings.barricade` appended after `watch_tower`, which
    is the file's arrival order and puts the row at `index.html:343`; `source.rule` at
    `data/buildings.json:9` gains the row's provenance sentence), `index.html` §1 `BLD`
    (`index.html:274-343`, regenerated — nothing else in the file changes but every line
    number after 343 shifts by 6) and the §6 keydown hotkey block
    (`index.html:2379-2388`), `data/README.md:10`, `tools/headless-check.js` §7 (the gated-row
    block at `tools/headless-check.js:1274-1345`) and §10 (the hotkey loop at
    `tools/headless-check.js:2006-2013`). `tools/check-stats.mjs` untouched: `bldValue`
    already carries the optional `age`/`noSprite` fields
    (`tools/check-stats.mjs:109-111`) and `renderBLD` prints them
    (`tools/check-stats.mjs:165-166`), so the row needs no new field — unlike the Market's
    `trade`, which needed `tradeValue`.
  - change: the row copied from the vendored table — `id: 72`, `internalName: "WALL"`,
    `hp: 150`, `cost: { "wood": 3 }`, `time: 7`, `attack: 0`, `meleeArmor: 2`,
    `pierceArmor: 5`, `lineOfSight: 2`, `range: 0`, `reload: 0`, `accuracy: 0`,
    `garrisonCapacity: 0` — plus the authored half the design fixes: `label: "Barricade"`,
    `w: 1`, `h: 1`, `pop: 0`, `trains: []`, `age: 1`, `noSprite: true`. `authored[]` needs no
    edit (the `buildings.*.label/.w/.h/.pop/.age/.noSprite` wildcards already cover it), so
    `source.rule` gains only the blacksmith-style provenance clause: the id 72 /
    `WALL` row is published as `barricade` — `Barricade` is the authored label for the
    wooden wall segment, and its 1×1 footprint and `age: 1` gate are authored, not table
    columns. `index.html` §6 gains `if (k === 'w') { Game.placing = Game.placing ===
    'barricade' ? null : 'barricade'; return; }` beside the `k`/`e`/`c` lines; `build()`
    itself needs no change — the `(def.age ?? 0) > Game.age` gate at `index.html:1555`
    covers any gated row — and `bldSpriteFor` answers `null` for the kind
    (`index.html:267-272`), which is what routes the renderer to the procedural draw.
  - done when: `node tools/check-stats.mjs` run against the data-only change prints
    `DRIFT BLD.barricade index.html:absent data:buildings.json.barricade` and exit 1, and
    after `node tools/check-stats.mjs --write` prints exactly
    `ok    index.html matches data/ -- 322 fields checked (CFG, 3 kinds, 12 buildings, 4 techs)`
    (measured: 304 → 322, and the regenerated file is 2685 lines — hand-breaking
    `BLD.barricade.hp` to 151 afterwards prints `DRIFT BLD.barricade.hp index.html:151 data:150`,
    exit 1, reverted); `node tools/headless-check.js` prints `201/201 checks passed`
    (3 new, 198 existing untouched); `node tools/gen-atlas.js` leaves `assets/sprites.png`
    byte-identical (a `noSprite` row adds no cell); `wc -l index.html` 2679 → 2685, the
    AGENTS.md length claim restamped in T6; `preview.png` unchanged — the row enters the
    frame in T5.
  - test: the checks are written before the row. `tools/check-stats.mjs` red → green is the
    row's own proof. 3 harness checks, reusing the §7 helpers the market plan left behind —
    `const barGate = darkAgeRefusal('barricade')` (helper at `tools/headless-check.js:1279`)
    asserting `build: a Dark Age settlement cannot raise a Barricade (Feudal only)`
    (`build` returns `undefined`, toast `Barricade requires Feudal Age`, `Game.res`
    unchanged, the villager's order untouched), `const barF = feudalSite('barricade')` +
    `exactSpend`/`siteDetail` (helpers at `tools/headless-check.js:1306-1336`) asserting
    `build: a Feudal Barricade costs the table's 3 wood and completes in 7s` (funds the row's
    cost exactly, places on a 1×1 pad within 8 tiles, steps to `built >= 1` inside
    `time + 8`), and `input: w arms Barricade placement` added to the
    `[['e','market','Market'], ['c','watch_tower','Watch Tower']]` loop at
    `tools/headless-check.js:2006-2013` (its `Escape` half is that loop's existing assertion).
    §5b3's `noSprite` rule covers the new kind without being edited; §7, §7b, §7c, §10, §11
    re-run unmodified.

- [x] T2: the barricade's build contract — `§7d` (placement refusals, cancel, demolish)
  - files: `tools/headless-check.js` only (a new `/* ---- 7d. wooden barricade (this plan, T2) ---- */`
    between §7c, which ends at `tools/headless-check.js:1441`, and §8 at
    `tools/headless-check.js:1443`); `index.html` untouched — every behaviour asserted here
    already exists for any `BLD` row (`build`/`siteFree`/`near`/`findSite`
    `index.html:1549-1623`, `cancelConstruction` `index.html:1575`, `demolish`
    `index.html:1594`), so a red check means the new row exposed a real bug to fix there.
  - change: one fixture block in the §7c shape (`createState()`, `st.age = 1`,
    `st.selection = [v.id]` to pin the builder, `freeSpotAround` for the pad) that walks the
    row's whole life: place → half-build → cancel → rebuild → finish → demolish, reading the
    numbers off `AoE2.BLD.barricade` instead of literals. The two placement refusals are the
    existing pipeline's behaviour, not toasts: a click on an occupied tile and a click beyond
    the `near(Game, v, …, 7)` radius both fall back to `findSite`
    (`index.html:1561-1562`), which is exactly what §7's `build: placed at the requested tile
    (not the fallback)` pins for a house.
  - done when: `207/207` (6 new; §7, §7b, §7c re-run unmodified) and the fixture's numbers
    read off the row: 3 wood spent, `blocks.get(b.id).length === 1`, `popCap(st, 0)`
    unchanged at 5 (the row's `pop: 0`), cancel refunds `floor(3 × CFG.CANCEL_REFUND)` = 2
    wood (`index.html:118`, `index.html:1580`), demolish changes no stockpile field.
  - test: 6 new checks written first — `build: a barricade registers exactly one tile and
    never changes the population cap`, `build: a barricade is never placed on an occupied
    tile - the click falls back to findSite` (click the Town Center's tile: the site is
    elsewhere, and `siteFree(st, tc.tx, tc.ty, 1, 1) === false`), `build: a click 12 tiles off
    the selected villagers still builds at findSite's pad`, `build: 2 wood in the stockpile
    refuses a Barricade with 'Not enough wood'` (`missing` returns the raw key, so the toast
    string is lowercase; `build` returns `undefined`, `res[0].wood` untouched, no new
    building), `cancel: a half-built barricade refunds exactly 2 wood and frees its builder`
    (the `cHouse.built = 0.5` pattern at `tools/headless-check.js:1404-1410`), and
    `demolish: a finished barricade is removed with zero change to the stockpile` (the
    `dOk` pattern at `tools/headless-check.js:1427-1431`).

- [x] T3: routing around, through and after a barricade — `§6d`
  - files: `tools/headless-check.js` only (a new `/* ---- 6d. barricade routing (this plan, T3) ---- */`
    between §6c, whose last check ends at `tools/headless-check.js:1164`, and the §7 banner at
    `tools/headless-check.js:1167`); `index.html` untouched. Reuses §6c's own fixtures and
    graders, which is the section's rule — the harness carries its own search so `findPath`
    cannot grade itself: `pathState` (`tools/headless-check.js:680`), `refSteps` (its Dijkstra,
    `tools/headless-check.js:696`), `flatWithOrder` / `orderTo` / `walkOrder` / `routeOf` /
    `distTo` (`tools/headless-check.js:819-849`), `flatState` / `tIdx` / `tOf` / `setTile` /
    `tileCentre` (`tools/headless-check.js:286-288`).
  - change: three fixtures, all built with `makeBoard`-style boards so every expected length
    comes from `refSteps`, not from the code under test — (1) a `flatWithOrder(4)` fixture
    whose cached route gets a `makeBuilding(st, 'barricade', 0, …)` dropped on a route tile
    that is neither the walker's own tile nor the goal tile (the §6c 8-check exclusion rule,
    `tools/headless-check.js:896-901`), stepped once, then demolished; (2) the §6c
    unreachable-order fixture (`tools/headless-check.js:931-949`, one solid tile between the
    villager and his order) rebuilt with a wooden segment instead of water; (3) the pocket —
    a villager moved to a grass tile whose 8 neighbours are all free
    (`DIRS8H` + the `free()` scan at `tools/headless-check.js:823-828`), ringed with eight
    1×1 barricades, ordered, then one ring segment demolished.
  - done when: `212/212` (5 new; §6, §6a, §6b, §6c re-run unmodified) and every route length
    equals `refSteps(board, from, to) + 1` for the board of that stage — before the build,
    after it, and after the demolish.
  - test: 5 new checks written first — `path: a built barricade makes its own tile unwalkable`
    (`walkable(st, tileCentre) === false`, `Game.blocks.get(b.id).length === 1`),
    `path: a barricade dropped on a cached route reroutes the walker on the next step`
    (`routeOf(v)` changes and matches the Dijkstra length with the segment present — the
    `repathF` shape), `path: demolishing that segment restores a route of the pre-build
    length` (graded on the cleared board), `path: a barricade between a villager and his
    order leaves him idle without a route` (the `stuckF` shape: order retires to `idle`,
    position byte-identical to the pre-order position, exactly the `findPath`-null behaviour
    the design reuses), `path: a villager ringed by eight barricades has no route, and
    demolishing one ring segment gives him one back` (before: `findPath` null and the order
    retired; after: a route whose length is `refSteps(...) + 1`).

- [x] T4: the raze path — `§9g` (the row inside the existing combat math)
  - files: `tools/headless-check.js` only (a new `/* ---- 9g. barricade razed (this plan, T4) ---- */`
    between §9f, which ends at `tools/headless-check.js:1924`, and §10 at
    `tools/headless-check.js:1926`); `index.html` untouched — acquisition is
    `autoAcquire`'s building branch (`index.html:950-957`), the swing is
    `updateUnit`'s `attack` order (`index.html:979-1010`), and the death is `hitBuilding`
    → `removeBuilding` (`index.html:926-934`). No new combat code, so a red check is a bug in
    how the row's numbers reach that path.
  - change: the §9c fixture shape — a fresh `AoE2.createState()` with `rs.units = []` (so
    `Game.ageBonus === 0` and no other unit's swing or arrow can move the numbers, and the
    team-0 Town Center can't be the thing that dies), then `makeBuilding(rs, 'barricade', 0,
    tx, ty)` with `built = 1` and `hp = 150` and `makeUnit(rs, 'militia', 1, b.x - 8, b.y)`
    parked inside `reachOf(b)` (`index.html:1330` = 13 px for a 1×1) so the very first step
    swings; a second segment two tiles east takes the pierce case, and the first one is
    selected, so the raze must also clear `Game.selectedBuilding` (the §9b precedent).
  - done when: `216/216` (4 new; §9, §9b, §9c, §9d, §9e, §9f re-run unmodified) and the
    numbers are the rows' own: 4 − 2 = 2 hp per militia swing, 4 − 5 → the `max(1, …)` floor
    for pierce, and `RS.militia.hp` 40 / `RS.archer.hp` 30 never in the assertion.
  - test: 4 new checks written first — `ai: an idle enemy militia acquires the adjacent
    barricade` (`order = { kind: 'attack', b: <id> }` after one step, the
    `BUILDING_ACQUIRE` branch), `combat: a militia's swing costs the barricade 2 hp`
    (`unitAttack(RS, m)` = the table's 4 at `ageBonus` 0, minus `BLD.barricade.meleeArmor` 2,
    asserted through the rows the way §9d does), `combat: an archer's 4 pierce damage floors
    at 1 hp against pierce armour 5`
    (`hitBuilding(rs, b2, RS.archer.atk, 'pierce')` → `b2.hp === 149`; the arrow's flight is
    §9c's, this check pins the armour math the row bought), `combat: razing the barricade
    removes it, frees its tile and never decides the game` (`hitBuilding(rs, b, 99999) ===
    true`, gone from `rs.buildings`, `rs.selectedBuilding === null`, toast
    `Razed enemy barricade` from `index.html:931-932`, `walkable(rs, b.x, b.y)` true again —
    the design's "units route through the gap" — and `rs.result === null`, since `setResult`
    reads Town Centers only).

- [ ] T5: the committed frame — a barricade in `preview.png`
  - files: `tools/render-preview.js` (the `simulateAndRender` fixture, beside the blacksmith /
    market / watch tower lines at `tools/render-preview.js:124-136`), `preview.png`
  - change: one more `makeBuilding(...)` line —
    `const site = G.findSite(Game.world, Math.floor(villagers[0].x / G.CFG.TILE) + 2, Math.floor(villagers[0].y / G.CFG.TILE) + 1, 1);`
    `const ba = G.makeBuilding(Game, 'barricade', 0, site.tx, site.ty); ba.built = 1;` — two
    tiles east and one north of the squad's tile, clear of the blacksmith's pad (+1, same
    row) and the Market's (+4,−1). Nothing else in the tool changes; the committed squad
    positions shift the way every previous building placement task shifted them, and the
    commit carries the regenerated PNG.
  - done when: `node tools/render-preview.js` succeeds and the regenerated `preview.png`,
    inspected before committing per `AGENTS.md`, shows the ranks plus four flat team-coloured
    footprints: the 1×1 blacksmith, the 2×2 Market, the 1×1 Watch Tower and the new 1×1
    Barricade; all four draw through the shared `barracks and future kinds` procedural branch
    (`index.html:1851-1858`) because `bldSpriteFor` answers `null` for each, so the
    expectation is flat blocks, not art, until P2 item 8 rips their frames.
  - test: visual — `node tools/render-preview.js` plus looking at `preview.png`; the code path
    it proves (the `noSprite` procedural draw) is already asserted by §5b3/§5c and no new
    assertion belongs here; `node tools/headless-check.js` still prints `216/216` and
    `assets/sprites.png` stays byte-identical.

- [ ] T6: Docs sync and the full verification pass
  - files: `docs/GAME_RULES.md` (the `## Buildings (BLD)` table gains
    `| Barricade | 150 | 1×1 | 3 wood | 7 s | — | — |`; the age-gate bullet at
    `docs/GAME_RULES.md:127-130` names four rows and the hotkeys `k`, `e`, `c`, `w`; a
    barricade rule naming `build`/`siteFree`/`near`/`findSite`, the 80 % cancel refund of 3
    wood = 2, demolish for nothing, and that a built or half-built segment is solid ground so
    routes reroute and a raze reopens the gap; the controls line
    (`index.html:94`, quoted in the rules) rewritten so `w` is the barricade and panning reads
    `WASD / arrows`, with `ArrowUp` named as the pan-up key), `docs/ARCHITECTURE.md` (the
    File map spans for §1/§4/§5/§6 and the public-surface row, the §1 `BLD` span
    `index.html:274-343` → `:274-349`, and prose for the row), `docs/CHANGELOG.md` (a dated
    section listing T1–T5 with the 198 → 216 check counts), `docs/ROADMAP.md` (P1 item 6
    marked shipped with this plan's link; the round's leftovers recorded there — the Stone
    Wall / Ruins / Fortified Wall chain and gates, drag-to-build a run of walls, and the
    barricade's ripped atlas frame folded into P2 item 8's `noSprite` list alongside the
    Blacksmith, Market and Watch Tower), `AGENTS.md` (the `index.html is 2679 lines` claim
    restamped to the real length), this plan's `Status: done`.
  - change: docs only, one commit, no code edits — it also closes the line-ref drift T1–T5
    leave behind.
  - test: `node tools/audit-line-refs.js` green (section spans, cited symbols, tools
    inventory, the file-length claim), then the full `AGENTS.md` set:
    `node tools/headless-check.js` (`216/216 checks passed`, exit 0),
    `node tools/render-preview.js` + look at `preview.png`, `node tools/gen-atlas.js`
    (`assets/sprites.png` byte-identical), `node tools/check-stats.mjs` (exit 0,
    `322 fields checked (CFG, 3 kinds, 12 buildings, 4 techs)`).
