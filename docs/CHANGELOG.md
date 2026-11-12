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
  age-scaling expressions in §4 — attack is the row's number × the age multiplier,
  plus the flat attack of every researched tech of the attacker's damage class (a
  tech's +1 stays +1 in every age); armour is the row's plus the
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

### Market and Watch Tower (T1–T6) — plan `docs/plans/2026-11-12-market-watch-tower.md`

Two Feudal buildings (8ae891b → 9fa8321); the harness went 175 → 194 checks across the
plan.

- **T1 — the two rows, `e` and `c` (8ae891b):** `data/buildings.json` gains `market`
  (1800 hp, 2×2, 175 wood, 60 s, **age 1**) and `watch_tower` (850 hp, 1×1, 35 wood +
  125 stone, 80 s, **age 1**) on their vendored rows, plus the authored
  `trade: { sell: 33, buy: 67 }` the upstream table has no column for;
  `check-stats.mjs` learns a `tradeValue` helper and the optional-field pattern so the
  generated `BLD` carries `trade`, `assets/sprites.png` stays byte-identical (both rows
  are `noSprite`), and the `e`/`c` hotkeys join the keydown block (175 → 181 checks).
- **T2 — `trade` (d494576):** one DOM-free §4 command sells or buys exactly 100 units of
  food, wood or stone at the row's own rate; every refusal goes through `toast` before a
  unit moves (`Cannot trade <>` for a resource the row excludes or an unknown direction,
  `Not enough <res>`, `Still building`, the age gate, and a building with no trade rates
  — `Barracks cannot trade`), and the `AoE2` export gains `trade` (181 → 188 checks).
- **T3 — the trade surface (41ed51e):** `commandsHtml` grows six `data-act="trade"`
  buttons on a finished Market — Sell/Buy per resource, args `food|sell`, `wood|buy`, … —
  each button carrying `disabled` exactly when its own half would be refused, the
  footer's delegated click handler dispatches `trade`, and the panel rebuilds in the same
  tick so the stockpile numbers move on click (188 → 191 checks).
- **T4 — the tower's shot (302d8a1):** checks only, because the Watch Tower adds no
  combat code — they pin the row driving the existing arrow path (attack 5 scaled by the
  age multiplier, accuracy 100, reload 2, reach `lineOfSight × CFG.TILE`), that it holds
  fire while the enemy stands beyond that line, and that the Market (attack 0) never
  fires (191 → 194 checks).
- **T5 — the committed frame (9fa8321):** `tools/render-preview.js` places the pair in
  the `simulateAndRender` fixture beside the blacksmith — Market east, Watch Tower west —
  and `preview.png` regenerates showing all three procedural footprints.
- **T6 — docs sync:** this entry plus `docs/GAME_RULES.md` (the two table rows, the
  three-row age-gate bullet, the Market trade and Watch Tower rules, the `E`/`C` hotkeys),
  `docs/ARCHITECTURE.md` (the §4 contents cell gains `trade`, the render paragraph names
  the `noSprite` pair), `docs/ROADMAP.md` (P1.5 shipped, the leftovers recorded) and
  `AGENTS.md` (the file-length claim, the export line) re-pointed at the final file —
  every `index.html:NNN` reference and section range re-measured through
  `tools/audit-line-refs.js`.

### Uniform HUD frame (T1–T2) — plan `docs/plans/2026-11-12-uniform-hud-frame.md`

One fixed-height footer for every selection state (c2a2472); the harness went 194 → 198
checks across the plan.

- **T1 — one owner, one frame (c2a2472):** `hudState(Game)` answers the one selection word
  the footer is in — `group`, `units`, `building`, `none` — and `hudHtml(Game)` becomes the
  single writer of its markup: the same three panels (`info` | `commands` | `queue`) in the
  same order for every state, stamped on the footer with that word as `data-state`.
  `renderHud` replaces its three `setHTML` calls with one write to `#hud`; the CSS replaces
  `footer{min-height:74px}` with `footer{flex:0 0 74px;height:74px}` plus fixed-height
  `overflow:hidden` `.info` (a title/body/bar grid), `.commands` (a row-based button grid)
  and `.queue` panels, so selecting something no longer resizes the map; `infoHtml` collapses
  a group to a `N units` title plus one per-kind `.sum` line (3 kinds max, `+K more` beyond)
  and gives every state the same title/body/hp shell; §6 delegates command clicks off
  `Game.dom.commands || Game.dom.hud` so the handler survives the footer rebuild in a browser,
  and `infoHtml`/`hudState`/`hudHtml` join the `AoE2` export (the 4 new §11b checks pin the
  per-state frame shape, the `renderHud` write into `#hud` and the fixed footer height);
  `preview.png` regenerates byte-identical.
- **T2 — docs sync:** this entry plus `docs/GAME_RULES.md` (a `## Interface` section),
  `docs/ARCHITECTURE.md` (the §5 render cell and the HUD paragraph), `docs/ROADMAP.md` (the
  Phase-2 item marked shipped) and `AGENTS.md` (the file-length claim, the export line, the
  `Map of this file` span) re-pointed at the final file — every `index.html:NNN` reference
  and section range re-measured through `tools/audit-line-refs.js`.

### Wooden barricade and gated choke points (T1–T6) — plan `docs/plans/2026-11-12-wooden-barricade.md`

A Feudal-gated wall segment (d88ecae → 03ccb2e, review fixes 7a4d7cd and 9d8849b); the
harness went 198 → 217 checks across the plan — 216 from T1–T6 and the controls check
the first fix adds.

- **T1 — the `barricade` row, the `w` hotkey (d88ecae):** `data/buildings.json` gains
  `barricade` — the vendored `WALL` row (150 hp, 3 wood, 7 s, melee armour 2, pierce
  armour 5) with the authored `Barricade` label, 1×1 footprint and **age 1** gate
  recorded in its `source.rule` — `check-stats.mjs --write` renders the `BLD` row (12
  buildings), `w` joins the §6 keydown (pan-up and placement arming share the key), and
  the §7 gated-row and §10 hotkey checks cover it (198 → 201 checks).
- **T2 — the build contract (ac6af15):** six §7d checks pin what the row alone gives the
  game — `siteFree`/`near`/`findSite` placement including the shared-corner case, the
  exact 3-wood spend and 7 s site detail, the `floor(3 × CFG.CANCEL_REFUND)` = 2 cancel
  refund, and a free demolish of a finished segment (201 → 207 checks).
- **T3 — routing around, through and after (baaace0, 9d8849b):** five §6d checks walk
  the gate story on the §6c boards — a built segment's own tile stops being walkable, a
  segment dropped on a cached route reroutes the walker on the next step, demolishing it
  restores the pre-build route, a villager ringed with segments is left idle without a
  route, and popping one ring segment gives him one back — with every expected length
  graded by the harness's own Dijkstra rather than by `findPath` (207 → 212 checks).
- **T4 — the raze path (50a59fb):** four §9g checks put the row inside the existing
  combat fixture — an idle enemy militia acquires the adjacent barricade, the swing
  costs it the table's damage (`atk` − the row's melee armour), the toast names the
  row's own label and the raze never decides a game without a Town Center; the
  expected-toast wording was corrected to the row-derived string (212 → 216 checks).
- **T5 — the committed frame (03ccb2e):** `tools/render-preview.js` places the
  barricade in the `simulateAndRender` fixture — two tiles east and one north of the
  squad, clear of the blacksmith's and Market's pads — and `preview.png` regenerates
  with the fourth flat team-coloured footprint.
- **T6 — docs sync:** this entry plus `docs/GAME_RULES.md` (the table row, the four-row
  age-gate bullet, the new barricade rule, the rewritten controls line naming `W` and
  `ArrowUp` — the wording the `index.html` banner and the footer help line have carried
  since 7a4d7cd), `docs/ARCHITECTURE.md` (the File map spans, the render/input prose) and
  `docs/ROADMAP.md` (P1.6 shipped, the wall leftovers folded into P2.8) and `AGENTS.md`
  (the file-length claim, the export line) re-pointed at the final file — every
  `index.html:NNN` reference and section range re-measured through
  `tools/audit-line-refs.js`.

### Save/load via localStorage (T1–T5) — plan `docs/plans/2026-11-12-save-load.md`

The game remembers the session (a2c29c1 → b411139, review fixes 19ea58e and 5cdf080); the
harness went 217 → 249 checks across the plan — 248 from T1–T5 plus the load check 19ea58e
adds — `check-stats.mjs` 322 → 325 fields, and `assets/sprites.png` / `preview.png` stayed
byte-identical (no render path changed).

- **T1 — the save side (a2c29c1):** `CFG.VERSION: 1` joins `data/units.json` (with its
  `cfgNotes` line and `authored[]` entry) so the schema stamp is vendored like every other
  number, `SAVE_PATH = 'aoe2mini:save'` is declared beside `const AGES`, and the §4
  `save / load` block gets the two-function door to `localStorage` — `storageGet` answers
  `null`, `storageSet` answers `false` (and removes the key on `null`) whenever the platform has
  no storage or refuses the write, which is how node and private mode keep running — plus
  `encodeState` and `saveGame(path, Game, at = now())` writing the `{ version, seed, writtenAt,
  state }` envelope. Pinning `writtenAt` is what turns `save -> load -> save` into a byte
  comparison; the encoded field list becomes the harness's `SAVE_FIELDS` contract, `Game.techs`
  and `Game.blocks` leave as an array and an object, a projectile's target leaves as `tk` +
  `tid`, and an order's `src` leaves as the tile or farm it names (217 → 225 checks, 323 stat
  fields).
- **T2 — the load side (83116d3, 19ea58e):** `loadGame(path, Game, raw = storageGet(path))` answers a
  boolean and never throws — the whole refusal ladder (no slot, empty slot, unparseable text, a
  `version` `migrate` cannot read, a shape `validState` cannot walk) ends in
  `resetGame(Game); return false`. `decodeState` restores in dependency order, bumps `mapEpoch`
  so every cached route re-paths around the loaded buildings, relinks each `order.src` and each
  projectile `t` to the decoded objects instead of frozen copies, and rebuilds `Game.rnd` from the
  envelope's seed. The shipped signature is this three-argument one rather than the design's
  `loadGame(path, raw)`: the target `Game` is the middle argument so a test — or `boot` — can load
  a slot into a game that already exists (225 → 237 checks).
  The farm half of that relink landed in `19ea58e`: `decodeOrder` called the `byId` Map as a
  function (`buildingById is not a function`), so every save carrying a farm `harvest` /
  `go_deposit` order threw inside the decode and was refused as corrupt — it now reads
  `byId.get(e.src.b)`, proven by the `load: a farm source is relinked, not left as a stored
  id` check that commit adds.
- **T3 — the autosave schedule (6ce19b9):** `CFG.AUTOSAVE_DEBOUNCE: 2` and `CFG.AUTOSAVE_EVERY:
  30` join `data/units.json`, `Game.autosaveAt` joins `createState`/`resetGame`, and
  `markDirty(Game)` — called by every §4 mutator and by `stepSim`'s three completion events —
  pulls the schedule earlier and never later, so a burst of commands inside the window costs ONE
  write while a quiet game keeps its 30 s rhythm. The write itself sits in `stepGame` AFTER
  `stepSim(Game, dt)` — the plan said before, and after is what makes the saved payload carry the
  frame that just ran (`state.time === DT`), which is what the new check asserts — so `stepSim`
  itself never writes and harness loops touch no storage (237 → 242 checks, 325 stat fields).
- **T4 — the page surface (b411139):** the header ends with
  `<button id="save" class="save" type="button">Save</button>` — `margin-left:auto` keeps the
  resource row from reflowing, so the header height and `preview.png` cannot move — and clicking
  it writes the slot and toasts `Saved`; `boot` reads the slot straight after `createState()`,
  ahead of the `!d` guard so a doc-less boot restores like a browser one; and the three new-game
  paths (`N`, the footer's `New map`, the victory overlay's `New game`) clear the slot before
  `resetGame`, which schedules the rewrite (242 → 248 checks).
- **T5 — docs sync:** this entry plus `docs/GAME_RULES.md` (the `## Save / load` section and the
  `N` hotkey), `docs/ARCHITECTURE.md` (the §1–§7 and public-surface spans, the §4 block
  citations including `save / load`, `autosaveAt` plus the persistence note in the `Game` block,
  the `### Save / load` subsection and the harness count), `docs/ROADMAP.md` (P2.9 shipped, its
  leftovers folded into P2.12) and `AGENTS.md` (the file-length claim, the export line, the
  `Map of this file` span — the `index.html` banner line for §4 and `stepGame`'s docstring
  carry that wording since 5cdf080) re-pointed at the final file — every `index.html:NNN`
  reference and section range re-measured through `tools/audit-line-refs.js`.

### Sound (T1–T6) — plan `docs/plans/2026-11-12-sound.md`

The game makes noise (d5de1de → 1e5e342); the harness went 249 → 266 checks across the plan,
and `assets/sprites.png` / `preview.png` stayed byte-identical (no render path changed).

- **T1 — the SFX table and `MUTE_PATH` (d5de1de):** `SFX` joins section 1 beside `AGES`, one
  row per sound (`hit`, `arrow`, `build`, `age`, `victory`, `defeat`) with its waveform,
  frequency ramp, duration, gain and the name of the function that fires it, and `MUTE_PATH`
  joins the two storage keys beside `SAVE_PATH`; the new §14 section reads the table instead of
  re-typing specs, so the first check fails on `SFX is undefined` before the table exists and
  then proves every row carries all five fields with a `fire` name the script really defines
  (249 → 250 checks).
- **T2 — `playSfx` (362b9c1):** the synthesiser lands in section 5 — one oscillator ramped
  through the row's `freq` list into a gain envelope, no audio file in the repo — behind
  `Game.sound = { ctx, at, fired }`: `ctx` is one reused `AudioContext` (a platform without one
  answers `false` rather than throwing, which is how node and `render-preview.js` stay quiet),
  `at`/`fired` are the per-frame gate that turns ten hits in one frame into one thud, and
  `isMuted` becomes the single mute read. The five new checks install a counting
  `AudioContext` stub and assert one node per row, the gate, and each silence (250 → 255).
- **T3 — the header speaker toggle (f2d03b6):** the header gains
  `<button id="mute" class="mute" type="button">Sound on</button>` with a dimmed
  `[aria-pressed="true"]` variant, and mute gets two writers with one setter —
  `applyMuteButton` stamps only the button (so `boot` can honour a saved preference without
  writing the key back) and `setMuted` stamps plus persists to `aoe2mini:muted`; the click
  listener joins `boot`'s wiring block. Sound stays out of `Game` and out of the save slot —
  presentation, not simulation (255 → 259 checks).
- **T4 — the combat rows wired (e3f25b0):** `hitUnit` opens with `playSfx(Game, 'hit')` before
  the hp maths and `spawnArrow` with `playSfx(Game, 'arrow')` before the projectile is pushed,
  and the harness gains `callSites()` — a scan that maps every `playSfx` call in the file to
  the function that owns it, so a row cannot be fired from the wrong place or a fourth place
  (259 → 262 checks).
- **T5 — the remaining rows wired (1e5e342):** the `b.built >= 1` branch of `updateUnit` plays
  `build`, `upgradeAge` plays `age` only when the age actually goes up, and `setResult` ends
  with `playSfx(Game, Game.result)` — one statement serving the `victory` and `defeat` rows and
  the `if (Game.result) return` guard keeping it to one chord per game; `updateUnit`,
  `upgradeAge` and `setResult` join the exports so the checks drive the real paths
  (262 → 266 checks, the call-site expectation now all five owners).
- **T6 — docs sync:** this entry plus `docs/GAME_RULES.md` (the `## Sound (SFX)` section and
  the `sound` field added to the save section's excluded list), `docs/ARCHITECTURE.md` (the §1
  row gaining `SFX`/`MUTE_PATH`, the §5 row naming the audio door, §6/§7 wording, the
  public-surface export list, the harness count and every restamped span), `docs/ROADMAP.md`
  (P2.10 shipped) and `AGENTS.md` (the file-length claim) re-pointed at the final file — every
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
