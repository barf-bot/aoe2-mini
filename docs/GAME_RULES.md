# Game rules (as implemented)

Every number here is generated: `src/config.js` is rendered from the
vendored tables in `data/units.json` + `data/buildings.json` + `data/techs.json`, and `tools/check-stats.mjs`
proves the two agree. If the code and this file disagree, the code is right and this file is
a bug.

## Map

| | |
|---|---|
| Size | 96 × 96 tiles (`CFG.MAP_W/MAP_H`), 22 px per tile, single zoom level |
| Seed | `1337` — fixed map, so runs and tests are reproducible (`New map` reseeds) |
| Terrain | grass, water, forest, gold, stone, berry (`T` enum) |
| Tile yields | tree 60 wood · gold 800 · stone 450 · berry 150 (`CFG.RES`) |
| Berry clusters | one connected 6-tile cluster per Town Center, every bush 5–8 tiles from its own keep (`berryCluster`, `src/world.js:99`) — no scattered berries any more |
| Fog | not implemented yet — every tile is visible; fog of war is `docs/ROADMAP.md` item 14 |
| Teams | Blue (player, team 0) vs Red (AI, team 1) |
| Starting stockpile | 100 food, 100 wood, 50 gold, 50 stone (`CFG.START`) |

## Economy

- Villagers gather at **1.5 units/second** (`CFG.GATHER_RATE`) and carry **10** at a time
  (`findDropoff`, `src/economy.js:31`)
  and deposit into the matching stockpile (`u.carryRes`).
- At most **2 villagers per resource tile** (`CFG.WORKERS_PER_TILE`). The 4 starters are
  placed food-first (berries), then wood, then anything — putting all four on one berry
  bush is what used to stall the economy at 420 food (the food-stall regression, fixed).
- A tile that runs dry disappears (T4): `depleteTile` (`src/economy.js:61`) runs on the
  harvest tick the moment a tile's `amount` reaches 0 and reverts the tile to `T.GRASS`
  (the amount stays 0), so the bush, tree or ore node stops being drawn and — per the
  Movement rules below — stops blocking movement. Farms are not tiles: a field empties
  in place and nothing there turns to grass.
- The emptied villager re-queues on the nearest tile of the **same** resource within
  **5** tiles (`nextSource`, `src/economy.js:77`, and after a deposit `resumeGather`,
  `src/economy.js:88`). The old radius-14 same-resource search and the any-resource radius-20
  fallback are gone: with nothing of that kind that close he stands idle instead of
  walking across the map to chop wood.

## Movement

- Everything solid blocks (`walkable`, `src/movement.js:314`): water, resource tiles with
  stock (`amount > 0`) and building tiles — foundations included, via `Game.occupied`
  (`rebuildBlocks`, `src/entities.js:102`). Units work from the neighbour tile instead of
  standing on the thing: `workSpot` (`src/entities.js:42`) offers only free walkable
  neighbours, `workPos` (`src/entities.js:150`) is the walkable ring tile beside a building
  nearest to the unit asking for it — a builder east of a 3x3 site works from its east side
  instead of walking around to one fixed corner, and two villagers arriving from opposite
  sides take different tiles; a spawn, with no unit to be near yet, takes the ring's first
  tile. A unit caught under a new footprint is moved to the ring tile nearest to him
  (`makeBuilding`, `src/entities.js:76`).
- Orders route over the tile grid instead of sliding at the target (`findPath`,
  `src/movement.js:63`): A\*, 8-connected, every step priced by the octile rule
  (`stepCost`, `src/movement.js:19` — 1 for a straight step, √2 for a diagonal) with the
  matching octile heuristic, and a diagonal never cuts
  between two solid tiles — so a unit walks *around* a water inlet, a forest or a house
  instead of nose-pressing the shoreline. The route is cached on the unit (`u.path`,
  `u.pathFor`, `u.pathAt`) and dropped when the order's goal tile changes or the walkable
  set changes under it (`Game.mapEpoch`: a building went up, a tile ran dry); that is the
  re-path rule. `moveUnit` (`src/movement.js:212`) then walks the route's *lines* and not
  its staircase — `routeAhead` (`src/movement.js:171`) takes the furthest waypoint a
  `lineClear` (`src/movement.js:137`) straight line reaches — at `u.speed` px/s
  (`stepToward`, `src/movement.js:116`), the exact ordered point being the
  route's last waypoint — so arrival is the point itself, not a radius around it.
- A solid target is never walked into (`standTarget`, `src/movement.js:259`): harvest, build,
  deposit and attack orders first ask it for a tile to stand on — the ordered point itself
  when it is walkable or already within the order's arrival radius, else the spot the game
  assigns for what was ordered to (`workPos` for a building — asked WITH the unit, so it
  names the ring tile nearest to him — or `workSpot` for any other tile) — and route to
  that, so a builder works from the edge of the footprint instead of stalling on it. A
  target with no reachable spot leaves the order unroutable instead of queued.
- A group move gets ranks instead of a scatter (`formationSlots`, `src/movement.js:280`): a
  centred `cols = ceil(sqrt(n))` grid, one tile per unit (the `max(CFG.UNIT_SEP, CFG.TILE)`
  pitch expressed on the tile grid), solid or already-held cells skipped and the grid
  grown until every unit has a distinct walkable tile, the nearest free slot paired to the
  nearest unit so nobody crosses the formation. The slot is written into the order *and*
  `u.slot`, and a retiring move order releases it — so a finished formation holds no tiles
  and a slot taken by another order forces a re-ask instead of a stack. `attack` and
  `harvest` orders keep their targets: no slots for a fight.
- A `move` order can also name the building it walks into (`order.garrison`,
  `src/commands.js:363`): the garrison walk (docs/plans/2026-11-13-garrison.md) is the only
  order `updateUnit` (`src/sim.js:190`) executes for a unit with `garrisonedIn` set, and the
  arrival line retires it to `idle` — that single place is where a garrison order ends, so no
  second timer is involved and the parked unit stops moving, animating and being drawn.
- Units push apart to `CFG.UNIT_SEP` (11 px) every tick (`separate`, `src/movement.js:334`) —
  and because the slot pitch is that same number on the tile grid, a parked group needs
  zero pushes: the two mechanisms agree by construction.

## Units (`KINDS`)

| Unit | HP | Speed | ATK | Attack time | Cost | Train time | Trained by |
|---|---|---|---|---|---|---|---|
| Villager | 25 | 18 px/s (0.8 tiles/s) | 3 | 0.64 s | 50 food | 25 s | Town Center |
| Militia | 40 | 20 px/s (0.9 tiles/s) | 4 | 0.5 s | 50 food + 20 gold | 21 s | Barracks |
| Archer | 30 | 21 px/s (0.96 tiles/s) | 4 | 0.35 s (+ 2 s reload, 4-tile range) | 25 wood + 45 gold | 35 s | Archery Range |

- Melee range = `attacker.r + target.r + 4` px (the table's `r`: villager 5, militia 6,
  archer 5). Attacking a building stops at half its footprint + 2 px.
- Ranged combat (`spawnArrow`, `src/sim.js:97`) puts the arrow in flight: an archer (the
  table's row — atk 4, range 4 tiles, reload 2 s, accuracy 80 %) stops at its range and
  shoots; the arrow crosses the gap at 176 px/s (`CFG.PROJ_SPEED`), is bound to exactly
  one mark, lands 80 % of the time and is deleted either way, so a shot at a corpse never
  splashes onto the next body. Built buildings with attack > 0 (Town Center 5, LOS 8,
  reload 2 s, accuracy 100 %) shoot through the same path, on
  `stepBuildingAttacks` (`src/sim.js:136`).
- Auto-acquire (`autoAcquire`, `src/sim.js:169`): non-villager fighters spot the nearest
  enemy unit within their own reach — `range` tiles for a shooter, `CFG.ACQUIRE` (6) for a
  melee unit — else the nearest enemy building within `CFG.BUILDING_ACQUIRE` (5), at any
progress (`attackableAsEnemy`, `src/sim.js:317`). Snap to the next target the moment
  their current one dies. Villagers never start fights; they only attack when ordered.
- Damage is computed in one place (`unitAttack`/`unitArmor`, `src/sim.js:55`/`src/sim.js:69`):
  attack = the row's `atk` × `(1 + 0.25 × ageBonus[team])` — the age multiplier of the
  attacker's own team (`ageBonus[team]` is that team's age index, 1× at Dark Age) — plus
  the techs the same team researched, for the attacker's damage class; a hit then deals
  `max(1, attack − armour)`, armour being the defender row's `melee`/`pierce` value plus
  its own team's techs' flat armour of that class (blacksmith techs apply to units only,
  never to built buildings' attacks).
- Population used counts **villagers only**, per AoE2 convention.
- Art: all three kinds render from the unit atlas (`SPRITE_SHEET` 1522×684 at
  `src/config.js:73`), the frames ripped from the AoE2 art and recoloured per team.
  Each frame now draws at its own proportions, times the one scale
  `data/sprites.json` authors per kind (`draw.idleTiles`: a kind's idle frame draws
  1.4 tiles tall, so a 28×46 cell measures 19×31 instead of a squashed 20×20), and
  is placed with its feet anchor (`ax`/`ay`) on the unit — see `drawUnits`
  (`src/render.js:156`). The sprite is mirrored when the unit walks left,
  `tools/gen-atlas.js` regenerates the PNG from `data/sprites.json`, and `unitAnim`
  picks the cell from the unit's order — a `build` order plays the work pose only once
  its builder is standing at the site (`atSite`, docs/TODO.md P1-8), before that `walk`.

## Buildings (`BLD`)

| Building | Age | HP | Size | Cost | Build time | Pop | Trains |
|---|---|---|---|---|---|---|---|
| Town Center | Dark | 2400 | 3×3 | 275 wood + 100 stone | 100 s | +5 | Villager |
| House | Dark | 550 | 2×2 | 25 wood | 25 s | +5 | — |
| Farm | Dark | 480 | 2×2 | 60 wood | 15 s | — | (food field 170) |
| Barracks | Feudal | 1200 | 2×2 | 175 wood | 50 s | — | Militia |
| Lumber Camp | Dark | 1800 | 1×1 | 150 wood | 40 s | — | — |
| Mining Camp | Dark | 600 | 1×1 | 100 wood | 35 s | — | — |
| Mill | Feudal | 600 | 2×2 | 100 wood | 35 s | — | (food field 170) |
| Archery Range | Feudal | 1500 | 2×2 | 175 wood | 50 s | — | Archer |
| Blacksmith | Feudal | 1800 | 1×1 | 150 wood | 40 s | — | — |
| Market | Feudal | 1800 | 2×2 | 175 wood | 60 s | — | — |
| Watch Tower | Feudal | 850 | 1×1 | 35 wood + 125 stone | 80 s | — | — |
| Barricade | Feudal | 150 | 1×1 | 3 wood | 7 s | — | — |
| Guard Tower | Feudal | 1500 | 1×1 | 35 wood + 125 stone | 80 s | — | — |
| Keep | Castle | 2250 | 1×1 | 35 wood + 125 stone | 80 s | — | — |

- Every row carries an explicit `age` (`buildings.*.age` in `data/buildings.json`,
  generated into `BLD`): the five Dark Age rows — Town Center, House, Farm, Lumber Camp,
  Mining Camp — are `age: 0`, the eight Feudal rows — Barracks (the table's own
  `internal_name` is `Barracks Age1`), Mill, Archery Range, Blacksmith, Market, Watch
  Tower, Guard Tower, Barricade — are `age: 1`, and the one Castle row — Keep — is `age: 2`.
  `build` (`src/commands.js:117`) refuses a row whose
  age the village has not reached *before* picking a builder or spending
  (`Barracks requires Feudal Age`), `canPlaceAt` (`src/commands.js:159`) answers the same
  gate for the placement ghost, and `commandsHtml` (`src/hud.js:109`) never offers the
  locked buttons — hotkeys `b`, `m`, `r`, `k`, `e`, `c`, `q`. The Blacksmith's `age: 1` was
  the first gated row (P1-4); the other thirteen rows are now gated by the same number, and
  §7e of `tools/checks/05-construction.js` proves both halves per row: the Dark Age
  refusal spends nothing and raises nothing, and the same village at the row's own age
  builds it for exactly its cost.
- The tower upgrade chain (`docs/plans/2026-11-13-tower-upgrade-chain.md`): `BLD` carries an
  authored `upgradesTo` on `watch_tower` (→ `guard_tower`) and on `guard_tower` (→ `keep`),
  and `upgradeBuilding` (`src/commands.js:281`) is the command that reads it. It reuses the
  construction pipeline instead of a second timer — spend the next row's cost, write
  `b.upgrade = <next kind>`, restart `b.built` at 0 over the next row's `time`, draft the
  village's builder — so the half-upgraded tower shoots nobody (`stepBuildingAttacks`,
  `src/sim.js:136`) and `promoteBuilding` (`src/commands.js:318`) flips `b.kind` the frame
  the site finishes; hp, attack, armours, range and footprint are then the new row's and the
  `Guard Tower complete` toast names it. The refusal ladder is `build`'s, in order:
  `Not your building`, `Already under construction`, `<label> has no upgrade`,
  `<label> requires <Age>`, `Not enough <res>`, `All villagers are building` /
  `No villager available` — every one answered before anything is spent. Cancelling an
  upgrade in progress (`cancelConstruction`, `src/commands.js:169`) refunds
  `floor(CFG.CANCEL_REFUND × BLD[b.upgrade].cost)` — the tier being paid for, not the one
  standing — and leaves the old tier built (`Guard Tower upgrade cancelled`) instead of
  removing the building. Population never moves: all three tower rows carry `pop: 0`. The
  grid offers the button only when the next tier exists and the team's age allows it, and
  `disabled` when its cost is short (`commandsHtml`, `src/hud.js:109`); §7f of
  `tools/checks/05-construction.js` proves the ladder, both edges and the refund.
- Garrison (`garrisonUnits` / `leaveBuilding`, `src/commands.js:363` / `src/commands.js:397`,
  `docs/plans/2026-11-13-garrison.md`): the seven rows carrying a `garrisonCapacity` — Town
  Center 15, Barracks 10, Archery Range 10, Market 10, Watch Tower 5, Guard Tower 5, Keep 5 —
  can house units; the other seven (capacity 0: House, Farm, Lumber Camp, Mining Camp, Mill,
  Blacksmith, Barricade) never can, so a click on your House still just moves. The command
  answers before anything changes — `Not your building`, `<label> is not built yet`, `<label>
  has no garrison space` — then links the units that fit: `u.garrisonedIn = b.id` *is* the
  reserved slot (two orders in one frame cannot overbook a building), the refusal toast is
  `<label> is full` when the row ran short of room and `Already garrisoned there` when the
  units are already housed, and every accepted unit gets the `move` order onto the building's
  own standing-ring tile (`u.slot = null`). `leaveBuilding(Game, b, unitIds)` — default
  everyone inside, the panel's per-kind button passes that kind's ids — sets them back down on
  the ring and answers `<label> has nobody inside` with 0 when the building holds nobody;
  `removeBuilding` (`src/entities.js:124`) evicts them the same way before the building
  leaves the world. Garrisoned units do not shoot back: that needs the per-range attack work
  (docs/ROADMAP.md P1-4), and an enemy taking refuge in a burning building, hp regen inside
  and the AI garrisoning its own villagers are all still open. The proof is §10e of
  `tools/checks/08-input.js`, §9h of `07-combat.js`, §11e of `09-hud.js` and the two §13
  save cases in `10-reset-save.js`; no data, no `src/config.js` and no `assets/sprites.png`
  byte moved for it.
- The Barricade adds no placement or combat code of its own: `build` (`src/commands.js:117`)
  drafts its crew (`pickBuilders`, `src/commands.js:96`) through the same `canPlaceAt`
  (`src/commands.js:159`) rule, cancelling refunds
  `floor(3 × CFG.CANCEL_REFUND)` = **2** wood and demolishing costs nothing — and a
  built or half-built segment registers its one tile in `Game.occupied` like any other
  footprint, so routes reroute around it and a raze reopens the gap
  (`docs/plans/2026-11-12-wooden-barricade.md`).
- Market trade (`trade`, `src/commands.js:253`): the market row is the only one carrying
  `trade` rates — selling 100 of food, wood or stone pays `trade.sell` **33** gold, buying
  100 back costs `trade.buy` **67** gold — and the six buttons on a finished Market move
  exactly 100 units at that rate in one click. Every refusal routes through `toast`:
  `Cannot trade <>` for a resource the row excludes (`gold`) or an unknown
  `direction`, `Not enough <res>` when the side being spent (the resource for a sell, gold
  for a buy) is short, `Still building` for a market still going up, and a market under
  construction or a barracks never trades at all.
- The Watch Tower adds no combat code: `stepBuildingAttacks` (`src/sim.js:136`) already
  shoots from a building row, so its numbers (attack 5, melee armour 1, pierce armour 7,
  line of sight 10 tiles, reload 2 s, accuracy 100 %) drive the existing arrow path —
  reach is `lineOfSight × CFG.TILE`, which is why the Market (attack 0, LOS 6) never
  fires while the Town Center and the tower do.
- Drop-off routing (`findDropoff`, `src/economy.js:31`): wood goes to the Lumber Camp,
  Center (and food also to farms) when the dedicated building doesn't exist. A farm
  never receives its own harvest. Farms feed 170 food (`BLD.farm.field`) before going
  idle; the mill tracks `field` the same way.
- One rule judges a tile — `canPlaceAt` (`src/commands.js:159`): the row's `age` gate plus a
  free, walkable footprint (`siteFree`, `src/commands.js:203`). A click that fails it is
  refused (`Can't build there`) with nothing spent and `Game.placing` still armed; the old
  answer was to move the site to `findSite` (`src/world.js:144`) next to the villager, and a
  tile more than 7 tiles off the builder failed too (docs/TODO.md P0-3). Distance is no
  longer part of the rule — the builder walks — so `findSite` only answers the button call
  without a tile, and `drawGhost` (`src/render.js:246`) paints with the same `canPlaceAt`.
  Placement also needs enough resources. The crew (`pickBuilders` via
  `build`, `src/commands.js:117`) is every free villager in the current selection, else
  the nearest free team-0 villager: a villager on a harvest/move order, or one whose
  `build` order points at a finished or demolished building, is free (that order is
  abandoned), while one working a site with `built < 1` is never yanked off — so a
  placement gets the whole free crew, their work stacks in `updateUnit`, and four
  villagers raise a house in under half the time one does (measured in
  `tools/checks/05-construction.js`). A
  half-built site never depends on one villager surviving, and the next placement waits
  until the crew is released. With no free villager the placement is refused
  (`All villagers are building`). The building's HP scales with progress until complete.
- Sending a villager to a site (`orderForUnit`, `src/commands.js:7`): a villager whose
  right-click lands on a tile his own unfinished building covers gets
  `{ kind: 'build', b: id }` instead of a plain `move` (docs/TODO.md P0-4), so a site his
  builder died or walked away from can still be finished. An enemy building is still
  attacked and a finished own building is still just the ground a move order ends on — unless
  its row has garrison capacity, in which case the selection walks inside (Garrison, above).
- Cancelling and demolishing (phase 2, T3/T4): `cancelConstruction` (`src/commands.js:169`)
  ends an in-progress site, refunding `floor(cost × CFG.CANCEL_REFUND)` — **80%** of the
  defined cost whatever the progress — and frees its builders; `demolish`
  (`src/commands.js:189`) removes a finished own-team building with no refund, refuses Town
  Centers (`Cannot demolish a Town Center`), buildings with a training queue
  (`Still training`) and buildings with a tech in flight (`Still researching`). The
  footer offers `Cancel` for a foundation and, once the
  building is finished, its train buttons plus `Demolish` for a non-Town Center building (T5).
- Training: a building can only train what's in its `trains` list ("Militia needs a Town
  Center" when wrong), must be finished (`Still building`), max 5 in queue (`Queue full`),
  must be affordable, and must have population room (`Need more houses`). Room is measured by
  one helper, `popCommitted` (`src/economy.js:118`): every living unit of the team
  (`popUsed`, `src/economy.js:108` — villagers, militia and archers alike, docs/TODO.md
  P1-10) plus every unit still queued in its buildings. `train` (`src/commands.js:218`) and
  the footer's disabled buttons (`commandsHtml`, `src/hud.js:109`) both read it, so the
  opening village reads 5/5 and a button never offers a click the command would refuse.

- `built` is a **0..1 progress fraction**, not a built/not-built flag (docs/TODO.md P1-9):
  a building counts for its population cap, receives a carried load and can be worked only
  once it is complete — `popCap` (`src/economy.js:102`), `findDropoff` (`src/economy.js:31`),
  `resumeGather` (`src/economy.js:88`), the farm case of `orderForUnit`
  (`src/commands.js:7`) and the save's `decodeOrder` (`src/save.js:173`) all test
  `built >= 1`, as does the enemy's `aiStep` (`src/ai.js:4`). An *enemy* building follows the
  other half of the rule: attackable at any progress, a 0 % foundation included, the way
  AoE2 does it (`attackableAsEnemy`, `src/sim.js:317`).

## Technologies (`TECHS`)

| Tech | From | Cost | Time | Effect |
|---|---|---|---|---|
| Forge | Blacksmith | 150 food | 50 s | +1 melee attack |
| Scale Mail | Blacksmith | 100 food | 40 s | +1 melee and pierce armour |
| Fletching | Blacksmith | 100 food + 50 gold | 30 s | +1 pierce attack |
| Bracer | Blacksmith | 300 food + 200 gold | 40 s | +1 pierce armour |

- Only a finished Blacksmith researches (`researchTech`, `src/commands.js:234`): the tech's age
  must be reached (`Forge requires Feudal Age`), one tech at a time per building
  (`Blacksmith is busy`), never a duplicate (`Forge already researched`), cost checked
  (`Not enough food`), and other buildings refuse its techs (`Barracks cannot research
  Forge`). The queue panel and the on-map bar track the in-flight tech next to training.
- Finishing adds the id to `Game.techs[b.team]` — the researching team's own set (toast `Forge
  researched`); the effects apply through `unitAttack`/`unitArmor` to that team's unit damage
  only (docs/TODO.md P1-11: the player's Forge never arms an enemy), and the +1 range on
  Fletching/Bracer is not modelled.

## Ages (`AGES`)

Dark Age → Feudal Age → Castle Age (`src/config.js:286`): Castle Age is the last age, as the
README states, and `upgradeAge` (`src/commands.js:269`) answers `Castle Age reached` there.
Cost (`src/config.js:17`): Dark → Feudal **500 food** (`CFG.AGE_FOOD`); every later age
costs `AGE_FOOD * 2` = **1000 food** (Feudal → Castle). Hotkey `T`.
Each upgrade sets `Game.ageBonus[0] = Game.age[0]`, which scales the player's unit damage; the
enemy's half stays 0 and its tech set empty until the AI can research (docs/TODO.md P1-11).

## Enemy AI (Red)

Every **45 s** (`CFG.WAVE_EVERY`): if Red is at population cap, every free militia is
ordered to attack the nearest blue unit ("Red attack wave!"); otherwise a **finished** Town
Center (`src/ai.js:4`) queues a villager while the village holds fewer than 5 units — every
kind counts, since `popUsed` counts them all (docs/TODO.md P1-10) — else a militia, and never
double-queues: a Red keep still at 50 % caps nobody, trains nobody and sends no wave
(docs/TODO.md P1-9).

## Win / lose

The Town Center is the win condition, and the answer is computed, not remembered
(`setResult`, `src/entities.js:141`): the side with no Town Center left has lost, and the first
side to lose one decides the game — a raze in combat, a cancelled site and a demolish all
`removeBuilding` (`src/entities.js:124`), so all three count. With
`Game.result` set to `'victory'` (enemy keep gone) or `'defeat'` (yours gone), `stepSim`
(`src/sim.js:5`) stops after the clock tick: units, build sites, training queues, arrows
in flight and the enemy AI freeze while the camera and rendering keep working. The `#result`
overlay — markup from `resultHtml` (`src/hud.js:59`), styled in the head — names the result
and offers a `New game` button wired to `resetGame` (`src/boot.js:54`), which rebuilds the
same seeded start and clears `result` back to `null`. No auto-restart, no countdown.

## Save / load

The game remembers itself through one `localStorage` slot: `SAVE_PATH` (`src/config.js:287`) is the
key, `storageGet` / `storageSet` (`src/save.js:9` / `src/save.js:18`) the only door, and both
answer quietly (`null` / `false`) when the platform has none or refuses the write — which is how
node (`tools/headless-check.js`, `tools/render-preview.js`) and private mode keep running.

- **Envelope** — `saveGame(path, Game, at = now())` (`src/save.js:123`) writes
  `{ version, seed, writtenAt, state }`: `version` is `CFG.VERSION` (`src/config.js:27`),
  `2`; `seed` is `Game.world.seed` falling back to `CFG.SEED`, the only way the excluded `rnd`
  closure is rebuilt; `writtenAt` is the `at` argument, pinned so the same `Game` saved twice
  gives the same bytes; `state` is `encodeState(Game)` (`src/save.js:77`), the schema the
  harness pins as `SAVE_FIELDS` (`tools/checks/10-reset-save.js:22`).
- **Version rule** — `migrate(payload)` (`src/save.js:137`) takes `CFG.VERSION` (2) as written and
  converts a `version: 1` payload — one global `age`, `ageBonus` and `techs` set — into the
  per-team shape (the player's half filled, the enemy's empty) instead of throwing such a save
  away; any other version is refused. `validState(payload)` (`src/save.js:152`) then checks the
  shape before a single field is assigned — the world's `w`/`h`/`seed` against `CFG.MAP_W`/`MAP_H`,
  the array and object containers (the per-team `age` / `ageBonus` / `techs` pair among them),
  `time` and `nextId` as numbers. Every refusal
  (missing slot, empty slot, unparseable text, an unreadable version, an unwalkable shape) ends
  the same way: `loadGame(path, Game, raw = storageGet(path))` (`src/save.js:252`) calls
  `resetGame` and answers `false` — it never throws.
- **In and out of `state`** — `Game.techs` (one Set per team, `[player, enemy]`) leaves as the
  pair of id arrays and comes back two Sets; `Game.blocks` (a `Map` of building id → tiles)
  leaves as an object and comes back a `Map` keyed
  by `Number(k)`, then `rebuildBlocks` (`src/entities.js:102`) recomputes it and `decodeState`
  (`src/save.js:203`) bumps `mapEpoch` instead of restoring it, so every cached route rebuilds on
  its first step. Excluded as per-runtime caches: `dom`, `view`, `mm`, `mmBase`, `toastMsg`,
  `toastAt`, `pingAt`, `frame`, `pathQueries`, `sprites`, `rnd`, `mapEpoch`, `autosaveAt`, `sound`.
- **References become ids** — `Game.selectedBuilding` is stored as an id and relinked on load
  (`decodeState`, `src/save.js:203`); a projectile's target becomes `tk` (`'unit' | 'building'`)
  plus `tid` (`encodeProjectile`, `src/save.js:71`, and `decodeProjectile`, `src/save.js:190`
  relinks it and drops an arrow whose mark is gone); a `harvest` / `go_deposit` order's `src` is
  stored as the tile or farm it names (`encodeSource`, `src/save.js:38`) and rebuilt through
  `sourceFromTile` (`src/entities.js:16`) / `sourceFromFarm` (`src/entities.js:29`) — a parsed `src`
  would be a dead number where the live one is a getter onto `world.amount` / `b.field`, and a
  source that no longer exists retires the order to `idle` (`decodeOrder`, `src/save.js:173`).
- **Autosave** — `CFG.AUTOSAVE_DEBOUNCE: 2` and `CFG.AUTOSAVE_EVERY: 30` (`src/config.js:28-29`)
  set the rhythm through `Game.autosaveAt`: `markDirty(Game)` (`src/save.js:113`), called by
  every command mutator and by `stepSim`'s three completion events (a unit trains, a tech finishes, a
  unit dies), pulls the schedule earlier and never later, so a burst of commands inside the
  window costs ONE write. The write itself sits in `stepGame` after `stepSim(Game, dt)`
  (`src/boot.js:233-235`) so the saved frame is the one just run, and `stepSim` never writes —
  driving the simulation from a test touches no storage. `resetGame` sets `Game.autosaveAt =
  Game.time` (`src/boot.js:61`): a new settlement is written by the very next frame, which is
  what makes `N` (`storageSet` + `resetGame`, `src/input.js:241`) overwrite the slot instead of waiting out the debounce.
- **The page surface** — the header's `Save` button (`index.html:20`) writes the slot through
  `saveGame` (`src/boot.js:185`) and toasts `Saved`; `boot` (`src/boot.js:138`) calls
  `storageGet` / `loadGame` (`src/boot.js:143-144`) right after `createState` (`src/boot.js:38`),
  so reopening the page lands on the saved game; the three new-game paths — `N`
  (`storageSet`, `src/input.js:241`), the footer's `New map` (the `restart` action, `src/input.js:267`) and the victory overlay's
  `New game` (`src/boot.js:181`) — clear the slot before `resetGame`, which schedules the rewrite.

## Sound (SFX)

Six sounds, one table — `SFX` (`src/config.js:324-331`) — and one door that plays them.
`playSfx(Game, name)` (`src/sound.js:33`) synthesises the row through the Web Audio API (one
oscillator ramped through the row's `freq` list into a gain envelope) rather than shipping an
audio file, so the repo stays asset-free with no build step. The `fire` column names the
function that plays each row and the harness (`tools/checks/11-sound.js`) binds to it —
the table is the contract, the audio path and the checks are its two readers, the way
`hudState` is the contract for the footer.

| sound | wave | freq (Hz) | dur (s) | gain | fires from |
|---|---|---|---|---|---|
| `hit` | triangle | 170 → 60 | 0.14 | 0.35 | `hitUnit` (`src/sim.js:81`) |
| `arrow` | sawtooth | 880 → 320 | 0.10 | 0.18 | `spawnArrow` (`src/sim.js:97`) |
| `build` | square | 220 → 140 | 0.20 | 0.25 | `updateUnit`'s `b.built >= 1` branch (`src/sim.js:255`) |
| `age` | triangle | 392 → 523 → 659 | 0.60 | 0.30 | `upgradeAge` (`src/commands.js:269`) |
| `victory` | sawtooth | 523 → 659 → 784 | 0.90 | 0.30 | `setResult` (`src/entities.js:141`) |
| `defeat` | sawtooth | 392 → 311 → 262 | 1.10 | 0.28 | `setResult` (`src/entities.js:141`) |

- **One voice per name per frame** — `Game.sound` (`createState`, `src/boot.js:47`) holds the
  `AudioContext` plus the last frame that made a sound and the names it fired, so a twenty-unit
  brawl landing ten hits in one frame makes one `hit`, and the next frame's shots make their
  own; `setResult`'s single `playSfx(Game, Game.result)` covers both result rows.
- **Three silences, none of them thrown** — a name the table does not know, a platform with no
  `AudioContext` (node, `tools/render-preview.js`, a browser that blocked audio) and a muted
  game each answer `false` before a node is built; the caller never has to care (the logic files
  stay DOM-free: the `typeof AudioContext` read is guarded inside the function).
- **Mute is presentation, not state** — the header `Sound on/off` button (`index.html:21`)
  toggles through `setMuted` (`src/sound.js:28`), which stamps the button
  (`applyMuteButton`, `src/sound.js:22`) and writes `MUTE_PATH` = `aoe2mini:muted`
  (`src/config.js:288`) through the same `storageSet` the save slot uses; `isMuted`
  (`src/sound.js:12`) reads the button when there is one and the key when there isn't, so a
  muted game stays muted after a reload and a fresh tab starts unmuted. `boot` calls
  `applyMuteButton` once (`src/boot.js:162`) to honour the saved preference without writing
  the key back, and the sound handle never enters `encodeState`.

## Interface

`hudState` (`src/hud.js:38`) answers the one selection word the footer is in — `group`
(several units), `units` (exactly one), `building` (a building and nothing else), `none` —
and `hudHtml` (`src/hud.js:50`) is the single owner of the footer's markup: the same
three panels (`info` | `commands` | `queue`) in the same order for every state, stamped
`renderHud` (`src/hud.js:4`) writes it in one
`innerHTML` write, compared against `Game.dom.hudLast` — the string it last wrote, never
against `el.innerHTML`, which a browser hands back serialised with `disabled=""`, so the
read never matches while a button is disabled and re-writing it every frame replaces the
button under the pointer and the click is lost (docs/TODO.md P0-1) — so the frame the CSS
pins (`footer{flex:0 0 var(--footer-h);height:var(--footer-h)}`, 94 px, every
panel a fixed-height `overflow:hidden` box) never changes size when the selection does —
the info panel is a fixed title/body/bar grid, the command panel a row-based button grid.
Choosing a placement (`Game.placing`) changes the info panel's content, never the state. A
group collapses to a `N units` title plus one `.sum` line of per-kind counts, at most 3 kinds
named, the rest folded into `+K more` — instead of one line per unit, and its bar shows the
squad's aggregate HP fraction (`5 Villager, 4 Militia, 3 Archer` is what a
seven-unit selection renders; the exact markup is pinned by `tools/checks/09-hud.js`). A unit
inside a building (`garrisonedIn`, `src/entities.js:66`) is not picked by a click, not taken by
a drag box and not recalled from a control group — `selectedUnits` (`src/economy.js:124`)
filters him out, so the counts, the build buttons and `issueOrder` all see only the units on
the field — while the population header keeps counting him: he still holds the slot he always
used.

Below 720 px the frame reflows instead of shrinking: one `@media (max-width:720px)` block
(`src/style.css:67`, written last so it wins the cascade) trims the header padding to `2px 6px`
and turns the footer into a column, stacking the same three panels inside the same `--footer-h` —
info shows its title only, the command grid takes the room, the queue line stays one line —
while `#stage` keeps every other row for the map. Nothing is hidden on desktop; the desktop
rules above the block are what the responsive-layout checks (`tools/checks/09-hud.js`) compare the responsive ones against.

## Camera & controls

Left click / tap select (`pointerUp`, `src/input.js:45` — one pointer per drag, so a second
finger pans the camera instead of moving the anchored box) · drag to box-select (mixed selections collapse to
villagers) · right click, or a hold of `LONG_PRESS_MS` 600 ms that stays within 8 px of its
press (`src/config.js:278`), issues move / attack / gather / build (context decided by
what is under the cursor) · panning is
`WASD / arrows` at 620 px/s (`W` pans — the Barricade hotkey moved to `Q`), or the 1:1
two-finger pan (`panCamera`, `src/input.js:317`) · 14 px
edge-scroll band, active only while the pointer is over the
canvas (not over header/footer chrome) · `Ctrl+1..9` store group, `1..9` recall · `H`
house, `F` farm, `B` barracks, `L` lumber camp, `G` mining camp, `M` mill, `R` archery
range, `K` blacksmith, `E` market, `C` watch tower, `Q` barricade, `T` upgrade age,
`Esc` cancels placement then clears selection · `N` new game (`src/input.js:230`) · minimap
click/drag moves the camera ·
"New map" reseeds and resets.
