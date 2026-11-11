# Game rules (as implemented)

Every number here is generated: `index.html` §1 config (lines 107-349) is rendered from the
vendored tables in `data/units.json` + `data/buildings.json`, and `tools/check-stats.mjs`
proves the two agree. If the code and this file disagree, the code is right and this file is
a bug.

## Map

| | |
|---|---|
| Size | 96 × 96 tiles (`CFG.MAP_W/MAP_H`), 22 px per tile, single zoom level |
| Seed | `1337` — fixed map, so runs and tests are reproducible (`New map` reseeds) |
| Terrain | grass, water, forest, gold, stone, berry (`T` enum) |
| Tile yields | tree 60 wood · gold 800 · stone 450 · berry 150 (`CFG.RES`) |
| Berry clusters | one connected 6-tile cluster per Town Center, every bush 5–8 tiles from its own keep (`berryCluster`, `index.html:447`) — no scattered berries any more |
| Fog | explored/revealed per tile, drawn dimmed outside vision |
| Teams | Blue (player, team 0) vs Red (AI, team 1) |
| Starting stockpile | 100 food, 100 wood, 50 gold, 50 stone (`CFG.START`) |

## Economy

- Villagers gather at **1.5 units/second** (`CFG.GATHER_RATE`) and carry **10** at a time
  (`CFG.CARRY_MAX`), then walk to the right drop-off (`findDropoff`, `index.html:1052`)
  and deposit into the matching stockpile (`u.carryRes`).
- At most **2 villagers per resource tile** (`CFG.WORKERS_PER_TILE`). The 4 starters are
  placed food-first (berries), then wood, then anything — putting all four on one berry
  bush is what used to stall the economy at 420 food (the food-stall regression, fixed).
- A tile that runs dry disappears (T4): `depleteTile` (`index.html:1079`) runs on the
  harvest tick the moment a tile's `amount` reaches 0 and reverts the tile to `T.GRASS`
  (the amount stays 0), so the bush, tree or ore node stops being drawn and — per the
  Movement rules below — stops blocking movement. Farms are not tiles: a field empties
  in place and nothing there turns to grass.
- The emptied villager re-queues on the nearest tile of the **same** resource within
  **5** tiles (`nextSource`, `index.html:1093`, and after a deposit `resumeGather`,
  `index.html:1104`). The old radius-14 same-resource search and the any-resource radius-20
  fallback are gone: with nothing of that kind that close he stands idle instead of
  walking across the map to chop wood.

## Movement

- Everything solid blocks (`walkable`, `index.html:980`): water, resource tiles with
  stock (`amount > 0`) and building tiles — foundations included, via `Game.occupied`
  (`rebuildBlocks`, `index.html:644`). Units work from the neighbour tile instead of
  standing on the thing: `workSpot` (`index.html:589`) offers only free walkable
  neighbours, `workPos` (`index.html:689`) is the standing spot beside a building, and a
  unit caught under a new footprint is moved there (`makeBuilding`, `index.html:619`).
- Movement itself is still straight-line axis-sliding (`moveUnit`, `index.html:959`) —
  no A\* yet (roadmap P0.2), so orders across a big blob can detour-stall. That is the
  known limit this pass leaves in place: it bought solidity, not pathfinding.
- Units push apart to `CFG.UNIT_SEP` (11 px) every tick (`separate`, `index.html:1000`).

## Units (`KINDS`)

| Unit | HP | Speed | ATK | Attack time | Cost | Train time | Trained by |
|---|---|---|---|---|---|---|---|
| Villager | 25 | 18 px/s (0.8 tiles/s) | 3 | 0.64 s | 50 food | 25 s | Town Center |
| Militia | 40 | 20 px/s (0.9 tiles/s) | 4 | 0.5 s | 50 food + 20 gold | 21 s | Town Center, Barracks |
| Archer | 30 | 21 px/s (0.96 tiles/s) | 4 | 0.35 s (+ 2 s reload, 4-tile range) | 25 wood + 45 gold | 35 s | Archery Range |

- Melee range = `attacker.r + target.r + 4` px (the table's `r`: villager 5, militia 6,
  archer 5). Attacking a building stops at half its footprint + 2 px.
- Ranged combat (`spawnArrow`, `index.html:771`) puts the arrow in flight: an archer (the
  table's row — atk 4, range 4 tiles, reload 2 s, accuracy 80 %) stops at its range and
  shoots; the arrow crosses the gap at 176 px/s (`CFG.PROJ_SPEED`), is bound to exactly
  one mark, lands 80 % of the time and is deleted either way, so a shot at a corpse never
  splashes onto the next body. Built buildings with attack > 0 (Town Center 5, LOS 8,
  reload 2 s, accuracy 100 %) shoot through the same path, on
  `stepBuildingAttacks` (`index.html:811`).
- Auto-acquire (`autoAcquire`, `index.html:842`): non-villager fighters spot the nearest
  enemy unit within their own reach — `range` tiles for a shooter, `CFG.ACQUIRE` (6) for a
  melee unit — else the nearest built enemy building within `CFG.BUILDING_ACQUIRE` (5), and
  snap to the next target the moment their current one dies. Villagers never start fights;
  they only attack when ordered.
- Age bonus multiplies damage: `ageBonus` equals the current age index (0 at Dark Age).
- Population used counts **villagers only**, per AoE2 convention.
- Art: all three kinds render from the unit atlas (`SPRITE_SHEET` 1522×684 at
  `index.html:172`), the frames ripped from the AoE2 art and recoloured per team, drawn at
  the size the manifest authors (villager 20×20, militia 22×22, archer 20×20) and mirrored
  when the unit walks left; `tools/gen-atlas.js` regenerates the PNG from
  `data/sprites.json`, and `unitAnim` (`index.html:1528`) picks the cell from the unit's order.

## Buildings (`BLD`)

| Building | HP | Size | Cost | Build time | Pop | Trains |
|---|---|---|---|---|---|---|
| Town Center | 2400 | 3×3 | 275 wood + 100 stone | 100 s | +5 | Villager |
| House | 550 | 2×2 | 25 wood | 25 s | +5 | — |
| Farm | 480 | 2×2 | 60 wood | 15 s | — | (food field 170) |
| Barracks | 1200 | 2×2 | 175 wood | 50 s | — | Militia |
| Lumber Camp | 1800 | 1×1 | 150 wood | 40 s | — | — |
| Mining Camp | 600 | 1×1 | 100 wood | 35 s | — | — |
| Mill | 600 | 2×2 | 100 wood | 35 s | — | (food field 170) |
| Archery Range | 1500 | 2×2 | 175 wood | 50 s | — | Archer |

- Drop-off routing (`findDropoff`, `index.html:1052`): wood goes to the Lumber Camp,
  gold/stone to the Mining Camp and food to the Mill — each falling back to the Town
  Center (and food also to farms) when the dedicated building doesn't exist. A farm
  never receives its own harvest. Farms feed 170 food (`BLD.farm.field`) before going
  idle; the mill tracks `field` the same way.
- Placement needs a free, walkable footprint (`siteFree`, `index.html:1265`) and enough
  resources. The builder (`pickBuilder` via `build`, `index.html:1205`) is the nearest
  idle villager in the current selection, else the nearest idle team-0 villager: a
  villager already building a finished-or-missing building or on a harvest/move order is
  free (the order is abandoned), while one assigned to a building with `built < 1` is
  never yanked off — so each placement gets its own builder and parallel construction
  works. With no idle villager the placement is refused (`All villagers are building`).
  The building's HP scales with progress until complete.
- Cancelling and demolishing (phase 2, T3/T4): `cancelConstruction` (`index.html:1230`)
  ends an in-progress site, refunding `floor(cost × CFG.CANCEL_REFUND)` — **80%** of the
  defined cost whatever the progress — and frees its builders; `demolish`
  (`index.html:1249`) removes a finished own-team building with no refund, refuses Town
  Centers (`Cannot demolish a Town Center`) and buildings with a training queue
  (`Still training`). The footer offers `Cancel` for a foundation and, once the
  building is finished, its train buttons plus `Demolish` for a non-Town Center building (T5).
- Training: a building can only train what's in its `trains` list ("Militia needs a Town
  Center" when wrong), must be finished (`Still building`), max 5 in queue (`Queue full`),
  must be affordable, and must have population room (`Need more houses`).

## Ages (`AGES`)

Dark Age → Feudal Age → Castle Age → Imperial Age.
Cost (`index.html:120`): Dark → Feudal **500 food** (`CFG.AGE_FOOD`); every later age
costs `AGE_FOOD * 2` = **1000 food** (Feudal → Castle, Castle → Imperial). Hotkey `T`.
Each upgrade sets `Game.ageBonus = Game.age`, which scales unit damage.

## Enemy AI (Red)

Every **45 s** (`CFG.WAVE_EVERY`): if Red is at population cap, every free militia is
ordered to attack the nearest blue unit ("Red attack wave!"); otherwise the Town Center
queues a villager (up to 5 villagers) or a militia, and never double-queues.

## Win / lose

The Town Center is the win condition, and the answer is computed, not remembered
(`setResult`, `index.html:681`): the side with no Town Center left has lost, and the first
side to lose one decides the game — a raze in combat, a cancelled site and a demolish all
leave the world through `removeBuilding` (`index.html:666`), so all three count. With
`Game.result` set to `'victory'` (enemy keep gone) or `'defeat'` (yours gone), `stepSim`
(`index.html:727`) stops after the clock tick: units, build sites, training queues, arrows
in flight and the enemy AI freeze while the camera and rendering keep working. The `#result`
overlay — markup from `resultHtml` (`index.html:1721`), styled in the head — names the result
and offers a `New game` button wired to `resetGame` (`index.html:2033`), which rebuilds the
same seeded start and clears `result` back to `null`. No auto-restart, no countdown.

## Camera & controls

Left click select · drag to box-select (mixed selections collapse to villagers) · right
click move / attack / gather (context decided by what is under the cursor) · `WASD` or
arrow keys pan at 620 px/s · 14 px edge-scroll band, active only while the pointer is
over the canvas (not over header/footer chrome) · `Ctrl+1..9` store group, `1..9`
recall · `H` house, `F` farm, `B` barracks, `L` lumber camp, `G` mining camp, `M` mill,
`R` archery range, `T` upgrade age, `Esc` cancels placement then clears selection · minimap click/drag
moves the camera · "New map" reseeds and resets.
