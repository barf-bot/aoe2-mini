# Game rules (as implemented)

Every number here is read out of `index.html` §1 config (lines 99-315). If the code and
this file disagree, the code is right and this file is a bug.

## Map

| | |
|---|---|
| Size | 96 × 96 tiles (`CFG.MAP_W/MAP_H`), 22 px per tile, single zoom level |
| Seed | `1337` — fixed map, so runs and tests are reproducible (`New map` reseeds) |
| Terrain | grass, water, forest, gold, stone, berry (`T` enum) |
| Tile yields | tree 60 wood · gold 800 · stone 450 · berry 150 (`CFG.RES`) |
| Berry clusters | one connected 6-tile cluster per Town Center, every bush 5–8 tiles from its own keep (`berryCluster`, `index.html:413`) — no scattered berries any more |
| Fog | explored/revealed per tile, drawn dimmed outside vision |
| Teams | Blue (player, team 0) vs Red (AI, team 1) |
| Starting stockpile | 100 food, 100 wood, 50 gold, 50 stone (`CFG.START`) |

## Economy

- Villagers gather at **1.5 units/second** (`CFG.GATHER_RATE`) and carry **15** at a time
  (`CFG.CARRY_MAX`), then walk to the right drop-off (`findDropoff`, `index.html:927`)
  and deposit into the matching stockpile (`u.carryRes`).
- At most **2 villagers per resource tile** (`CFG.WORKERS_PER_TILE`). The 4 starters are
  placed food-first (berries), then wood, then anything — putting all four on one berry
  bush is what used to stall the economy at 420 food (the food-stall regression, fixed).
- A tile that runs dry disappears (T4): `depleteTile` (`index.html:954`) runs on the
  harvest tick the moment a tile's `amount` reaches 0 and reverts the tile to `T.GRASS`
  (the amount stays 0), so the bush, tree or ore node stops being drawn and — per the
  Movement rules below — stops blocking movement. Farms are not tiles: a field empties
  in place and nothing there turns to grass.
- The emptied villager re-queues on the nearest tile of the **same** resource within
  **5** tiles (`nextSource`, `index.html:968`, and after a deposit `resumeGather`,
  `index.html:979`). The old radius-14 same-resource search and the any-resource radius-20
  fallback are gone: with nothing of that kind that close he stands idle instead of
  walking across the map to chop wood.

## Movement

- Everything solid blocks (`walkable`, `index.html:855`): water, resource tiles with
  stock (`amount > 0`) and building tiles — foundations included, via `Game.occupied`
  (`rebuildBlocks`, `index.html:608`). Units work from the neighbour tile instead of
  standing on the thing: `workSpot` (`index.html:555`) offers only free walkable
  neighbours, `workPos` (`index.html:639`) is the standing spot beside a building, and a
  unit caught under a new footprint is moved there (`makeBuilding`, `index.html:583`).
- Movement itself is still straight-line axis-sliding (`moveUnit`, `index.html:834`) —
  no A\* yet (roadmap P0.2), so orders across a big blob can detour-stall. That is the
  known limit this pass leaves in place: it bought solidity, not pathfinding.
- Units push apart to `CFG.UNIT_SEP` (11 px) every tick (`separate`, `index.html:875`).

## Units (`KINDS`)

| Unit | HP | Speed | ATK | Attack time | Cost | Train time | Trained by |
|---|---|---|---|---|---|---|---|
| Villager | 60 | 46 | 3 | 1.0 s | 50 food | 2.5 s | Town Center |
| Militia | 110 | 58 | 11 | 0.9 s | 60 food + 20 gold | 3 s | Town Center, Barracks |

- Melee range = `attacker.r + target.r + 4` px (5 for villager, 6 for militia). Attacking
  a building stops at half its footprint + 2 px.
- Auto-acquire (`autoAcquire`, `index.html:725`): non-villager fighters spot the nearest
  enemy unit within `CFG.ACQUIRE` (6) tiles — else the nearest built enemy building within
  `CFG.BUILDING_ACQUIRE` (5) — and snap to the next target the moment their current one
  dies. Villagers never start fights; they only attack when ordered.
- Age bonus multiplies damage: `ageBonus` equals the current age index (0 at Dark Age).
- Population used counts **villagers only**, per AoE2 convention.
- Art: both kinds render from the unit atlas (`SPRITE_SHEET` 308×158 at `index.html:155`,
  one 24×24 cell per animation × team — villagers: idle/walk + a/b frames for farm, chop
  and mine; militia: idle/walk + attack_a/b), drawn at 20×20 for villagers and 22×22 for
  militia, mirrored when the unit walks left; `tools/gen-atlas.js` regenerates the PNG
  from `SPRITES`, and `unitAnim` (`index.html:1403`) picks the cell from the unit's order.

## Buildings (`BLD`)

| Building | HP | Size | Cost | Build time | Pop | Trains |
|---|---|---|---|---|---|---|
| Town Center | 1800 | 3×3 | 275 wood | 25 s | +5 | Villager |
| House | 560 | 2×2 | 25 wood | 4 s | +5 | — |
| Farm | 320 | 2×2 | 60 wood | 6 s | — | (food field 170) |
| Barracks | 1300 | 2×2 | 175 wood | 12 s | — | Militia |
| Lumber Camp | 950 | 1×1 | 100 wood | 8 s | — | — |
| Mining Camp | 950 | 1×1 | 100 wood | 8 s | — | — |
| Mill | 1100 | 2×2 | 175 wood | 10 s | — | — |

- Drop-off routing (`findDropoff`, `index.html:927`): wood goes to the Lumber Camp,
  gold/stone to the Mining Camp and food to the Mill — each falling back to the Town
  Center (and food also to farms) when the dedicated building doesn't exist. A farm
  never receives its own harvest. Farms feed 170 food (`BLD.farm.field`) before going
  idle; the mill tracks `field` the same way.
- Placement needs a free, walkable footprint (`siteFree`, `index.html:1140`) and enough
  resources. The builder (`pickBuilder` via `build`, `index.html:1060`) is the nearest
  idle villager in the current selection, else the nearest idle team-0 villager: a
  villager already building a finished-or-missing building or on a harvest/move order is
  free (the order is abandoned), while one assigned to a building with `built < 1` is
  never yanked off — so each placement gets its own builder and parallel construction
  works. With no idle villager the placement is refused (`All villagers are building`).
  The building's HP scales with progress until complete.
- Cancelling and demolishing (phase 2, T3/T4): `cancelConstruction` (`index.html:1105`)
  ends an in-progress site, refunding `floor(cost × CFG.CANCEL_REFUND)` — **80%** of the
  defined cost whatever the progress — and frees its builders; `demolish`
  (`index.html:1124`) removes a finished own-team building with no refund, refuses Town
  Centers (`Cannot demolish a Town Center`) and buildings with a training queue
  (`Still training`). The footer offers `Cancel` for a foundation and, once the
  building is finished, its train buttons plus `Demolish` for a non-Town Center building (T5).
- Training: a building can only train what's in its `trains` list ("Militia needs a Town
  Center" when wrong), must be finished (`Still building`), max 5 in queue (`Queue full`),
  must be affordable, and must have population room (`Need more houses`).

## Ages (`AGES`)

Dark Age → Feudal Age → Castle Age → Imperial Age.
Cost (`index.html:112`): Dark → Feudal **500 food** (`CFG.AGE_FOOD`); every later age
costs `AGE_FOOD * 2` = **1000 food** (Feudal → Castle, Castle → Imperial). Hotkey `T`.
Each upgrade sets `Game.ageBonus = Game.age`, which scales unit damage.

## Enemy AI (Red)

Every **45 s** (`CFG.WAVE_EVERY`): if Red is at population cap, every free militia is
ordered to attack the nearest blue unit ("Red attack wave!"); otherwise the Town Center
queues a villager (up to 5 villagers) or a militia, and never double-queues.

## Camera & controls

Left click select · drag to box-select (mixed selections collapse to villagers) · right
click move / attack / gather (context decided by what is under the cursor) · `WASD` or
arrow keys pan at 620 px/s · 14 px edge-scroll band, active only while the pointer is
over the canvas (not over header/footer chrome) · `Ctrl+1..9` store group, `1..9`
recall · `H` house, `F` farm, `B` barracks, `L` lumber camp, `G` mining camp, `M` mill,
`T` upgrade age, `Esc` cancels placement then clears selection · minimap click/drag
moves the camera · "New map" reseeds and resets.
