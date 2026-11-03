# Game rules (as implemented)

Every number here is read out of `index.html` §1 config (lines 99-161). If the code and
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
- Drop-off rules: berries/gold/stone/forest go to the Town Center; a farm's own field is
  the drop-off for farm food. Farms feed 170 food (`BLD.farm.field`) before going idle.
- When a tile runs dry the villager retargets the nearest tile of the same resource
  (radius 14), then any resource (radius 20), else goes idle (`nextSource`).

## Units (`KINDS`)

| Unit | HP | Speed | ATK | Attack time | Cost | Train time | Trained by |
|---|---|---|---|---|---|---|---|
| Villager | 60 | 46 | 3 | 1.0 s | 50 food | 5 s | Town Center |
| Militia | 110 | 58 | 11 | 0.9 s | 60 food + 20 gold | 6 s | Town Center, Barracks |

- Melee range = `attacker.r + target.r + 4` px (5 for villager, 6 for militia).
- Age bonus multiplies damage: `ageBonus` equals the current age index (0 at Dark Age).
- Population used counts **villagers only**, per AoE2 convention.

## Buildings (`BLD`)

| Building | HP | Size | Cost | Build time | Pop | Trains |
|---|---|---|---|---|---|---|
| Town Center | 1800 | 3×3 | 275 wood | 25 s | +5 | Villager |
| House | 560 | 2×2 | 25 wood | 4 s | +5 | — |
| Farm | 320 | 2×2 | 60 wood | 6 s | — | (food field 170) |
| Barracks | 1300 | 2×2 | 175 wood | 12 s | — | Militia |

- Placement needs a free, walkable footprint (`siteFree`) and enough resources; a villager
  is then assigned to build it and the building's HP scales with progress until complete.
- Training: a building can only train what's in its `trains` list ("Militia needs a Town
  Center" when wrong), must be finished (`Still building`), max 5 in queue (`Queue full`),
  must be affordable, and must have population room (`Need more houses`).

## Ages (`AGES`)

Dark Age → Feudal Age → Castle Age → Imperial Age.
Cost (`index.html:711`): Dark → Feudal **500 food** (`CFG.AGE_FOOD`); every later age
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
