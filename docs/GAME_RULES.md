# Game rules (as implemented)

Every number here is read out of `index.html` §1 config (lines 99-258). If the code and
this file disagree, the code is right and this file is a bug.

## Map

| | |
|---|---|
| Size | 96 × 96 tiles (`CFG.MAP_W/MAP_H`), 22 px per tile, single zoom level |
| Seed | `1337` — fixed map, so runs and tests are reproducible (`New map` reseeds) |
| Terrain | grass, water, forest, gold, stone, berry (`T` enum) |
| Tile yields | tree 60 wood · gold 800 · stone 450 · berry 110 (`CFG.RES`) |
| Fog | explored/revealed per tile, drawn dimmed outside vision |
| Teams | Blue (player, team 0) vs Red (AI, team 1) |
| Starting stockpile | 200 food, 200 wood, 100 gold, 100 stone (`CFG.START`) |

## Economy

- Villagers gather at **3.0 units/second** (`CFG.GATHER_RATE`) and carry **10** at a time
  (`CFG.CARRY_MAX`), then walk to the nearest valid drop-off and deposit into the right
  stockpile (`u.carryRes`).
- At most **2 villagers per resource tile** (`CFG.WORKERS_PER_TILE`). The 4 starters are
  placed food-first (berries), then wood, then anything — putting all four on one berry
  bush is what used to stall the economy at 420 food (the food-stall regression, fixed).
- Drop-off rules: berries/gold/stone/forest go to the Town Center; a farm's own field is
  the drop-off for farm food. Farms feed 170 food (`BLD.farm.field`) before going idle.
- When a tile runs dry the villager retargets the nearest tile of the same resource
  (radius 14), then any resource (radius 20), else goes idle (`nextSource`).

## Units (`KINDS`)

| Unit | HP | Speed | ATK | Attack time | Cost | Train time | Trained by |
|---|---|---|---|---|---|---|---|
| Villager | 60 | 46 | 3 | 1.0 s | 50 food | 5 s | Town Center |
| Militia | 110 | 58 | 11 | 0.9 s | 60 food + 20 gold | 6 s | Town Center, Barracks |

- Melee range = `attacker.r + target.r + 4` px (5 for villager, 6 for militia). Attacking
  a building stops at half its footprint + 2 px.
- Auto-acquire (`autoAcquire`, `index.html:582`): non-villager fighters spot the nearest
  enemy unit within `CFG.ACQUIRE` (6) tiles — else the nearest built enemy building within
  `CFG.BUILDING_ACQUIRE` (5) — and snap to the next target the moment their current one
  dies. Villagers never start fights; they only attack when ordered.
- Age bonus multiplies damage: `ageBonus` equals the current age index (0 at Dark Age).
- Population used counts **villagers only**, per AoE2 convention.
- Art: both kinds render from the unit atlas (`SPRITE_SHEET` 308×158 at `index.html:140`,
  one 24×24 cell per animation × team — villagers: idle/walk + a/b frames for farm, chop
  and mine; militia: idle/walk + attack_a/b), drawn at 20×20 for villagers and 22×22 for
  militia, mirrored when the unit walks left; `tools/gen-atlas.js` regenerates the PNG
  from `SPRITES`, and `unitAnim` (`index.html:1150`) picks the cell from the unit's order.

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

- Drop-off routing (`findDropoff`, `index.html:760`): wood goes to the Lumber Camp,
  gold/stone to the Mining Camp and food to the Mill — each falling back to the Town
  Center (and food also to farms) when the dedicated building doesn't exist. A farm
  never receives its own harvest.

- Placement needs a free, walkable footprint (`siteFree`) and enough resources; a villager
  is then assigned to build it and the building's HP scales with progress until complete.
- Training: a building can only train what's in its `trains` list ("Militia needs a Town
  Center" when wrong), must be finished (`Still building`), max 5 in queue (`Queue full`),
  must be affordable, and must have population room (`Need more houses`).

## Ages (`AGES`)

Dark Age → Feudal Age → Castle Age → Imperial Age.
Cost (`index.html:915`): Dark → Feudal **500 food** (`CFG.AGE_FOOD`); every later age
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
recall · `H` house, `F` farm, `B` barracks, `T` upgrade age, `Esc` cancels placement then
clears selection · minimap click/drag moves the camera · "New map" reseeds and resets.
