# OG content port — real sprites and the real stat table (round 1)

Status: in progress

## Design

**What you'll see:** the real art and the real numbers — actual ripped AoE2 frames for
villager/militia/archer and the buildings instead of the current procedurally drawn blobs
and houses, and combat/stats straight off the real stat table (HP, attack, armour, attack
delay — villager 0.64, militia 0.5), LOS and speeds in tiles/s, so a Dark Age skirmish
looks and times like the game.

**How it works:** `data/` gains two vendored sources — the unit/building stat table from
the community `.dat` extraction (`units.csv`/JSON) and the ripped sprite PNGs.
`tools/gen-atlas.js` builds `assets/sprites.png` from the real frames, §1's
`KINDS`/`BLD`/`CFG` become generated from `data/`, and a new `tools/check-stats.mjs` fails
the build if `index.html` drifts from the table. Speeds convert tiles/s → px through
`TILE`. Ranged combat + the archer line + win/lose ride on those same tables right after.

**Not in this round:** pathfinding, tech tree, market/tower, save/load, sound.

**How we check it:** headless-check + the new stats check + `render-preview` — the
committed `preview.png` is what the requester actually looks at.

**One heads-up:** real sprites are Microsoft's assets; the default source is the public
rip, and this needs one `AGENTS.md` line (one atlas, now built from real frames). If the
requester later supplies their own HD/DE asset files, the atlas builds from those instead
— the plan keeps the asset source behind one documented path so swapping it is a single
change.

**Hard constraints that survive from `AGENTS.md`:** the game stays one `index.html`; no
framework, no build step, no new image files beyond the one `assets/sprites.png` atlas;
`index.html` is patched, never rewritten; section 4 stays DOM-free; every task names a
proving check and the `Map of this file` banner stays truthful.

**Sources, verified reachable today (they replace the invented numbers and the drawn art):**

- Stats — `HSZemi/aoe2dat` `data/units_buildings_techs.json` and
  `SiegeEngineers/aoe2techtree` `data/data.json` (`data.json` → `data.Unit[id]` /
  `data.Building[id]`, ~1 MB of community-extracted DE values: `HP`, `Attack`,
  `MeleeArmor`/`PierceArmor`, `AttackDelaySeconds`, `ReloadTime`, `Speed` in tiles/s,
  `LineOfSight`, `Range`/`MinRange`, `AccuracyPercent`, `Cost`, `TrainTime`,
  `internal_name`). Rows are *copied*, not retuned; where the agreed design fixed a value
  the design wins and the row records it (villager `atkTime` 0.64, militia 0.5).
- Art — the public rip `archive.org/details/aoe2_spritesheet_buildings_and_units`
  (`All Bitmaps of All Units.zip`: `Villager/Male/{Standard,Farm,Woodcutter,Mine,Build &
  Repair}`, `Militia/{Stand Ground,Walk,Attack}`, `Archer/{Stand Ground,Walk,Attack}`;
  `All Bitmaps of All Buildings.zip`: `Towncenerleft*.bmp`, `House*.bmp`,
  `Barracks*.bmp`, `Mill*.bmp`, `Lumbercamp*.bmp`, `Miningcamp*.bmp`, `Archeryrange*.bmp`).
  The unit bitmaps are 24-bit with `#ff00ff` as the transparent key and the player colour
  baked as a 3-stop ramp (`#000052`/`#1331a1`/`#305db6`), which is exactly `TEAM[t]`'s
  `dark`/`main`/`light` shape — so one frame recolours into both team cells.

`data/` is the only new home for content; `data/sprites/` (+ `data/sprites.json`) is the
one documented asset path the atlas is built from, so swapping in the requester's own
HD/DE files later is a directory replacement and nothing else.

## Tasks

- [x] T1: Vendor the stat table and write the stats check (before touching `index.html`)
  - files: `data/units.json`, `data/buildings.json`, `data/README.md`,
    `tools/check-stats.mjs`, `README.md` (tool table + command list), `AGENTS.md`
    (`tools/` row wording)
  - change: `data/units.json` = the two shipped rows, values copied from the sources
    (villager ← id 83 `VMBAS`: hp 25, atk 3, armour 0/0, `attackDelaySeconds` 0.64 (the
    agreed value), speed 0.8 tiles/s, cost 50 food, train 25 s; militia ← id 74 `SPRMN`:
    hp 40, atk 4, armour 0/1, delay 0.5 (agreed), speed 0.9 tiles/s, cost 50 food +
    20 gold, train 35 s), each row keeping `id` + `internal_name` for traceability;
    `data/buildings.json` = the seven shipped kinds (town_center ← 109 `RTWC` 2400 hp
    275 wood + 100 stone, house ← 70 `HOUS` 550/25, farm ← 50 `FARM` 480/60, barracks ←
    12 1200/175, mill ← 68 `MILL` 600/100, lumber_camp + mining_camp ← 584 `MINE` 600/100
    and its matching camp row) plus the fields the table does not carry (`w`/`h`/`pop`/
    `field`, carried over from today's `BLD`) and a `source:` header; `data/README.md`
    names both URLs, the fetch date and the swap rule. `tools/check-stats.mjs` extracts the
    `<script>` exactly the way `tools/gen-atlas.js:50-57` does, requires it, diffs every
    field of `CFG`/`KINDS`/`BLD` against `data/` and exits 1 with one line per mismatch;
    `--write` rewrites the three §1 blocks from `data/` (used by T2, no `index.html` change
    in this task).
  - done when: `node tools/check-stats.mjs` exits 1 and reports the drift (e.g.
    `KINDS.villager.hp index.html:60 data:25`, `BLD.town_center.cost.wood index.html:275
    data:275` is absent, `CFG.CARRY_MAX index.html:15 data:10` present) and
    `node tools/headless-check.js` still prints `121/121 checks passed`.
  - test: new `node tools/check-stats.mjs` (the check is written before the code it
    guards); existing §5 `tuning:` check untouched this task; `node tools/audit-line-refs.js`
    stays green because `README.md` now lists `tools/check-stats.mjs`.

- [x] T2: Generate §1 `CFG`/`KINDS`/`BLD` from `data/` — the numbers become real
  - files: `index.html` §1 (`CFG` 101-119, `KINDS` 121-126, `BLD` 215-230, export block
    1964-1975), `tools/headless-check.js` §5 (229-237), §7b (700-740), §9 (811-828)
  - change: run `node tools/check-stats.mjs --write` so the three tables come from `data/`:
    villager hp 25 / atk 3 / atkTime 0.64 / cost 50 food / time 25 s, militia hp 40 /
    atk 4 / atkTime 0.5 / cost 50 food + 20 gold / time 21 s (the table's TrainTime),
    speeds converted through the table (`speed = round(tiles_per_s * CFG.TILE)` →
    villager 18 px/s, militia 20 px/s —
    the design's tiles/s → px rule), `CFG.CARRY_MAX` 15 → 10, `BLD` hp/cost from the table
    (Town Center 2400 hp, 275 wood + 100 stone; farm 480/60; barracks 1200/175; mill
    600/100; mining camp 600/100; lumber camp 1800/150 — the camp row the sources share)
    with `w`/`h`/`pop`/`field` unchanged so the footprint rule in
    §5b3 keeps holding; each block gets a `// generated from data/units.json` banner.
    Section 4 stays DOM-free; the `Map of this file` banner (85-97) is untouched.
  - done when: `node tools/check-stats.mjs` exits 0 (`KINDS/BLD/CFG match data/ — N
    fields`) and `node tools/headless-check.js` prints `122/122 checks passed`.
  - test: the §5 `tuning: CFG and KINDS match the agreed numbers` check is amended in
    place to read `data/units.json` + `data/buildings.json` instead of six hand-typed
    literals (not duplicated); one new §5 check
    `tuning: KINDS.speed is always the table's tiles/s x CFG.TILE` (catches a tiles/s value
    written into a px field — the exact bug class this port introduces); §9's
    `combat: militia kills a 60hp villager in ~5.4s of swings` is re-derived from the new
    table (25 hp ÷ 4 dmg per 0.5 s → dead in ~3.5 s) rather than retuned by eye; §7b's camp
    fixtures are funded from `BLD` so the lumber/mining builds still afford.

- [ ] T3: Build `assets/sprites.png` from the ripped frames instead of drawing it
  - files: `data/sprites/` (new: the vendored PNG frames), `data/sprites.json` (the cell
    manifest), `tools/gen-atlas.js` (replace the `ART`/`BLD_ART` grids, 66-323, with
    `ASSET_DIR = data/sprites` + manifest compositing), `index.html` §1 (`SPRITE_SHEET`
    141, `SPRITES` 142-171 + its comment 128-140, `BLD_SPRITES` 190-205, `WORK_ANIM` 175),
    `AGENTS.md` (the one line: the atlas is generated from `data/sprites/`, the game still
    ships exactly one image), `README.md` (gen-atlas row), `preview.png`
  - change: convert the ripped BMPs to PNG frames and vendor them — villager
    `Standard` (idle + walk) and the three work animations `WORK_ANIM` already names
    (`Farm`, `Woodcutter`, `Mine`, a/b pair each) from `Villager/Male/…`, militia
    `Stand Ground`/`Walk`/`Attack` a/b — recoloured per team by mapping the source's
    player-colour ramp onto `TEAM[t].dark/main/light` (keeps gen-atlas's "team colours come
    from `TEAM`, a recolour is one edit" property); `data/sprites.json` maps
    kind → anim → `[blue, red]` files and is the only place the atlas layout is authored;
    gen-atlas composes the sheet, keeps `--out`/the sha256 print/the decode+empty-cell
    guard, and rewrites `SPRITE_SHEET`/`SPRITES`/`WORK_ANIM` between their banners with
    `sw/sh` = frame size and `dw/dh` = the current on-screen size; `preview.png` is
    regenerated through the real renderer.
  - done when: `node tools/gen-atlas.js` exits 0 with no empty cell and the written PNG
    decodes at the generated `SPRITE_SHEET` size; `SPRITES` is a generated table (no
    hand-authored cells left); `preview.png` shows the ripped villager/militia silhouettes
    instead of the drawn discs — and the requester's screenshot can be compared to it.
  - test: existing `sprites: every registered anim x team has a unique in-sheet cell`
    (§5b), the animation-selection checks (§5b2, the a/b frames must still alternate),
    the building-cell checks (§5b3, `dw/dh` must equal `w*TILE x h*TILE`) and the atlas
    wiring checks (§5c) pass unmodified; visual check = `node tools/render-preview.js` +
    look at `preview.png`.

- [ ] T4: The archer line, straight from the same table
  - files: `data/units.json` (+ `archer` ← id 4 `ARCHR`: hp 30, atk 4, armour 0/0,
    `AttackDelaySeconds` 0.35, reload 2 s, range 4, min 0, accuracy 80 %, speed 0.96
    tiles/s, cost 25 wood + 45 gold, train 35 s), `data/buildings.json` (+ `archery_range`
    ← id 87 `ARRG`: hp 1500, 175 wood, 2x2, `trains:['archer']`), `index.html` §1 (`KINDS`
    121-126, `BLD` 215-230), §5 hotkey table + `commandsHtml` (1537-1573), §6 build
    delegate, `data/sprites.json` + `SPRITES.archer` + `BLD_SPRITES.archery_range`
    (regen via `tools/gen-atlas.js`), `assets/sprites.png`, `preview.png`,
    `tools/headless-check.js` §8 (792-810), §11 (959-1013)
  - change: add the two rows, regenerate §1 with `check-stats --write` and the atlas, wire
    the new building the same way the camps are wired (hotkey `R`, `data-act="build"`
    button, delegate → `build(Game,'archery_range',…)`); `BLD.barracks.trains` stays
    `['militia']` — the archer trains from the archery range, as in the game.
  - done when: `node tools/check-stats.mjs` exits 0 with `units.archer` and
    `buildings.archery_range` present; §5b/§5b3 find cells for both new keys; training an
    archer from a finished archery range yields a unit with hp 30 / atk 4 (the table's
    numbers, not new ones); `preview.png` shows the archer cell.
  - test: new §8 check `train: a finished Archery Range trains an Archer with the table's
    stats` plus the §11 pattern extended —
    `ui: clicking the Archery Range button arms placement` — plus check-stats exit 0 and
    the unmodified sprite checks.

- [ ] T5: Ranged combat driven by `KINDS.range`/`accuracy`/`reload`
  - files: `index.html` §4 (`Game` shape + `createState`, `stepSim` 621-646, `hitUnit`
    647-655, `updateUnit` 689-798, `autoAcquire` 669-688, `orderForUnit` 936-968; new
    `spawnArrow`/`updateProjectiles` beside `hitUnit`), §5 `drawProjectiles` + `renderFrame`
    wiring, export block 1964-1975, `tools/headless-check.js` new §9c (the harness's §12 is
    `reset`; the check list itself is the one `docs/plans/2026-11-03-unit-sprites.md` drew
    for this feature)
  - change: §4 gains `Game.projectiles` and `spawnArrow(Game, u, target)` /
    `updateProjectiles(Game, dt)`; `KINDS.atkType` ('melee' | 'ranged'), `range`,
    `minRange` and `reload` are read only from the table — melee keeps today's instant
    `hitUnit`, ranged units face the target, stop at `range * CFG.TILE`, fire on the reload
    cadence and resolve the hit when the arrow arrives, gated by
    `Game.rnd` (`mulberry32`) against `accuracy`; buildings with `attack > 0` (Town Center
    5, LOS 8 — already in `data/buildings.json`) shoot through the same path; arrows are
    deleted on arrival and never double-hit; `autoAcquire`/`orderForUnit` compare against
    the per-kind range instead of the single `CFG.ACQUIRE` radius.
  - done when: on a throwaway state an archer kills a villager **4 tiles away** (the
    table's range) without moving, `Game.projectiles.length` returns to 0 after the burst,
    and the 121 existing checks still pass.
  - test: new §9c checks — `ranged: ranged order creates an arrow projectile`,
    `ranged: the arrow position lerps toward the target`, `ranged: arrow is removed when it
    lands`, `ranged: a target never takes two hits from one arrow`, `ranged: a shot at a
    dead target does not phantom-hit the next one`, `ranged: archer kills a villager at the
    table's range` (replaces the old §12 list; written first, then the code).

- [ ] T6: Win/lose on top of the same buildings
  - files: `index.html` §4 (`hitBuilding` 656-668 / `removeBuilding` 574-582 set the
    result, `stepSim` 621-646 freezes, `createState` gains `result: null`), §5 HUD/overlay
    markup + `renderHud` (1494-1536) + the `#result` styles (31-34 neighbourhood), §7 boot
    wiring for the "New game" button, `tools/headless-check.js` new §9e
  - change: `Game.result` becomes `'victory'` when the enemy Town Center leaves
    `Game.buildings` and `'defeat'` when the player's does (both razings and demolitions
    already funnel through `removeBuilding`); with a result set, `stepSim` skips unit
    updates (camera and rendering keep working); an overlay renders `Victory`/`Defeat` plus
    a `New game` button wired to the existing `resetGame`; no auto-restart, no timer.
  - done when: razing red's Town Center in §9e sets `Game.result === 'victory'`, the
    overlay text is in the stub DOM, and the next 60 steps move no unit; razing blue's sets
    `'defeat'`; `resetGame` clears it back to `null`.
  - test: new §9e checks — `game over: razing the enemy Town Center wins`, `game over:
    razing your own Town Center loses`, `game over: the simulation freezes once a result is
    set`, `ui: the result overlay renders and its button resets the game` — plus the
    existing §12 reset checks and `preview.png` unchanged (the overlay is DOM, not canvas).

- [ ] T7: Docs sync and the full verification pass
  - files: `docs/GAME_RULES.md` (stats come from `data/`; speeds in tiles/s × `TILE`; ranged
    rules — range/min range/reload/accuracy; Town Center attack; win/lose),
    `docs/ARCHITECTURE.md` (`data/` + `tools/check-stats.mjs` rows, the new §4
    `spawnArrow`/`updateProjectiles`, refreshed `index.html:NNN` spans), `docs/CHANGELOG.md`
    (dated entry), `docs/ROADMAP.md` (mark P0#3 ranged+archer, P1#7 win/lose and P2#8
    sprites as shipped by this plan), this plan's `Status: done`
  - change: docs-only text updates in one commit; every `index.html:NNN` reference
    re-pointed at the final file.
  - test: `node tools/audit-line-refs.js`, `node tools/headless-check.js` (must end
    `NN/NN checks passed`, exit 0), `node tools/check-stats.mjs` (exit 0),
    `node tools/render-preview.js`; then push and confirm
    `gh api repos/barf-bot/aoe2-mini/pages --jq .status` is `built` with served bytes
    matching `index.html` (skip with a note if this checkout still has no remote).
