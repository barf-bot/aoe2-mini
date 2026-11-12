# Game rules (as implemented)

Every number here is generated: `index.html` §1 config (lines 115-425) is rendered from the
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
| Berry clusters | one connected 6-tile cluster per Town Center, every bush 5–8 tiles from its own keep (`berryCluster`, `index.html:523`) — no scattered berries any more |
| Fog | explored/revealed per tile, drawn dimmed outside vision |
| Teams | Blue (player, team 0) vs Red (AI, team 1) |
| Starting stockpile | 100 food, 100 wood, 50 gold, 50 stone (`CFG.START`) |

## Economy

- Villagers gather at **1.5 units/second** (`CFG.GATHER_RATE`) and carry **10** at a time
  (`findDropoff`, `index.html:1426`)
  and deposit into the matching stockpile (`u.carryRes`).
- At most **2 villagers per resource tile** (`CFG.WORKERS_PER_TILE`). The 4 starters are
  placed food-first (berries), then wood, then anything — putting all four on one berry
  bush is what used to stall the economy at 420 food (the food-stall regression, fixed).
- A tile that runs dry disappears (T4): `depleteTile` (`index.html:1453`) runs on the
  harvest tick the moment a tile's `amount` reaches 0 and reverts the tile to `T.GRASS`
  (the amount stays 0), so the bush, tree or ore node stops being drawn and — per the
  Movement rules below — stops blocking movement. Farms are not tiles: a field empties
  in place and nothing there turns to grass.
- The emptied villager re-queues on the nearest tile of the **same** resource within
  **5** tiles (`nextSource`, `index.html:1468`, and after a deposit `resumeGather`,
  `index.html:1479`). The old radius-14 same-resource search and the any-resource radius-20
  fallback are gone: with nothing of that kind that close he stands idle instead of
  walking across the map to chop wood.

## Movement

- Everything solid blocks (`walkable`, `index.html:1354`): water, resource tiles with
  stock (`amount > 0`) and building tiles — foundations included, via `Game.occupied`
  (`rebuildBlocks`, `index.html:725`). Units work from the neighbour tile instead of
  standing on the thing: `workSpot` (`index.html:665`) offers only free walkable
  neighbours, `workPos` (`index.html:773`) is the standing spot beside a building, and a
  unit caught under a new footprint is moved there (`makeBuilding`, `index.html:699`).
- Orders route over the tile grid instead of sliding at the target (`findPath`,
  `index.html:1160`): A\*, 8-connected, uniform cost per tile, and a diagonal never cuts
  between two solid tiles — so a unit walks *around* a water inlet, a forest or a house
  instead of nose-pressing the shoreline. The route is cached on the unit (`u.path`,
  `u.pathFor`, `u.pathAt`) and dropped when the order's goal tile changes or the walkable
  set changes under it (`Game.mapEpoch`: a building went up, a tile ran dry); that is the
  re-path rule. `moveUnit` (`index.html:1250`) then walks the cached waypoints at
  `u.speed` px/s (`stepToward`, `index.html:1209`), the exact ordered point being the
  route's last waypoint — so arrival is the point itself, not a radius around it.
- A solid target is never walked into (`standTarget`, `index.html:1299`): harvest, build,
  deposit and attack orders first ask it for a tile to stand on — the ordered point itself
  when it is walkable or already within the order's arrival radius, else the spot the game
  assigns for what was ordered to (`workPos` for a building, `workSpot` for a tile) — and
  route to that, so a builder works from the edge of the footprint instead of stalling on
  it. A target with no reachable spot leaves the order unroutable instead of queued.
- A group move gets ranks instead of a scatter (`formationSlots`, `index.html:1320`): a
  centred `cols = ceil(sqrt(n))` grid, one tile per unit (the `max(CFG.UNIT_SEP, CFG.TILE)`
  pitch expressed on the tile grid), solid or already-held cells skipped and the grid
  grown until every unit has a distinct walkable tile, the nearest free slot paired to the
  nearest unit so nobody crosses the formation. The slot is written into the order *and*
  `u.slot`, and a retiring move order releases it — so a finished formation holds no tiles
  and a slot taken by another order forces a re-ask instead of a stack. `attack` and
  `harvest` orders keep their targets: no slots for a fight.
- Units push apart to `CFG.UNIT_SEP` (11 px) every tick (`separate`, `index.html:1374`) —
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
- Ranged combat (`spawnArrow`, `index.html:903`) puts the arrow in flight: an archer (the
  table's row — atk 4, range 4 tiles, reload 2 s, accuracy 80 %) stops at its range and
  shoots; the arrow crosses the gap at 176 px/s (`CFG.PROJ_SPEED`), is bound to exactly
  one mark, lands 80 % of the time and is deleted either way, so a shot at a corpse never
  splashes onto the next body. Built buildings with attack > 0 (Town Center 5, LOS 8,
  reload 2 s, accuracy 100 %) shoot through the same path, on
  `stepBuildingAttacks` (`index.html:942`).
- Auto-acquire (`autoAcquire`, `index.html:975`): non-villager fighters spot the nearest
  enemy unit within their own reach — `range` tiles for a shooter, `CFG.ACQUIRE` (6) for a
  melee unit — else the nearest built enemy building within `CFG.BUILDING_ACQUIRE` (5), and
  snap to the next target the moment their current one dies. Villagers never start fights;
  they only attack when ordered.
- Damage is computed in one place (`unitAttack`/`unitArmor`, `index.html:861`/`index.html:875`):
  attack = the row's `atk` × `(1 + 0.25 × ageBonus)` — the age multiplier, `ageBonus` is
  the age index (1× at Dark Age) — plus every researched tech's attack for the attacker's
  damage class; a hit then deals `max(1, attack − armour)`, armour being the defender row's
  `melee`/`pierce` value plus the techs' flat armour of that class (blacksmith techs apply
  to units only, never to built buildings' attacks).
- Population used counts **villagers only**, per AoE2 convention.
- Art: all three kinds render from the unit atlas (`SPRITE_SHEET` 1522×684 at
  `index.html:184`), the frames ripped from the AoE2 art and recoloured per team, drawn at
  the size the manifest authors (villager 20×20, militia 22×22, archer 20×20) and mirrored
  when the unit walks left; `tools/gen-atlas.js` regenerates the PNG from
  `data/sprites.json`, and `unitAnim` (`index.html:2265`) picks the cell from the unit's order.

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
| Blacksmith | 1800 | 1×1 | 150 wood | 40 s | — | — |
| Market | 1800 | 2×2 | 175 wood | 60 s | — | — |
| Watch Tower | 850 | 1×1 | 35 wood + 125 stone | 80 s | — | — |
| Barricade | 150 | 1×1 | 3 wood | 7 s | — | — |

- Four rows carry an `age` gate — Blacksmith, Market, Watch Tower and Barricade (each
  `age: 1` in `data/buildings.json`): `build` (`index.html:1586`) refuses them before
  picking a builder whenever `Game.age < 1` (`Blacksmith requires Feudal Age`,
  `Market requires Feudal Age`, `Watch Tower requires Feudal Age`,
  `Barricade requires Feudal Age`), and their buttons — hotkeys `k`, `e`, `c`, `w` —
  only appear once the player reaches Feudal Age.
- The Barricade adds no placement or combat code of its own: `build` (`index.html:1586`)
  drafts a builder through the same rules, `siteFree` (`index.html:1651`) and `near`
  (`index.html:1646`) pick its pad via `findSite` (`index.html:568`), cancelling refunds
  `floor(3 × CFG.CANCEL_REFUND)` = **2** wood and demolishing costs nothing — and a
  built or half-built segment registers its one tile in `Game.occupied` like any other
  footprint, so routes reroute around it and a raze reopens the gap
  (`docs/plans/2026-11-12-wooden-barricade.md`).
- Market trade (`trade`, `index.html:1701`): the market row is the only one carrying
  `trade` rates — selling 100 of food, wood or stone pays `trade.sell` **33** gold, buying
  100 back costs `trade.buy` **67** gold — and the six buttons on a finished Market move
  exactly 100 units at that rate in one click. Every refusal routes through `toast`:
  `Cannot trade <>` for a resource the row excludes (`gold`) or an unknown
  `direction`, `Not enough <res>` when the side being spent (the resource for a sell, gold
  for a buy) is short, `Still building` for a market still going up, and a market under
  construction or a barracks never trades at all.
- The Watch Tower adds no combat code: `stepBuildingAttacks` (`index.html:942`) already
  shoots from a building row, so its numbers (attack 5, melee armour 1, pierce armour 7,
  line of sight 10 tiles, reload 2 s, accuracy 100 %) drive the existing arrow path —
  reach is `lineOfSight × CFG.TILE`, which is why the Market (attack 0, LOS 6) never
  fires while the Town Center and the tower do.
- Drop-off routing (`findDropoff`, `index.html:1426`): wood goes to the Lumber Camp,
  Center (and food also to farms) when the dedicated building doesn't exist. A farm
  never receives its own harvest. Farms feed 170 food (`BLD.farm.field`) before going
  idle; the mill tracks `field` the same way.
- Placement needs a free, walkable footprint (`siteFree`, `index.html:1651`) and enough
  resources. The builder (`pickBuilder` via `build`, `index.html:1586`) is the nearest
  idle villager in the current selection, else the nearest idle team-0 villager: a
  villager already building a finished-or-missing building or on a harvest/move order is
  free (the order is abandoned), while one assigned to a building with `built < 1` is
  never yanked off — so each placement gets its own builder and parallel construction
  works. With no idle villager the placement is refused (`All villagers are building`).
  The building's HP scales with progress until complete.
- Cancelling and demolishing (phase 2, T3/T4): `cancelConstruction` (`index.html:1613`)
  ends an in-progress site, refunding `floor(cost × CFG.CANCEL_REFUND)` — **80%** of the
  defined cost whatever the progress — and frees its builders; `demolish`
  (`index.html:1633`) removes a finished own-team building with no refund, refuses Town
  Centers (`Cannot demolish a Town Center`), buildings with a training queue
  (`Still training`) and buildings with a tech in flight (`Still researching`). The
  footer offers `Cancel` for a foundation and, once the
  building is finished, its train buttons plus `Demolish` for a non-Town Center building (T5).
- Training: a building can only train what's in its `trains` list ("Militia needs a Town
  Center" when wrong), must be finished (`Still building`), max 5 in queue (`Queue full`),
  must be affordable, and must have population room (`Need more houses`).

## Technologies (`TECHS`)

| Tech | From | Cost | Time | Effect |
|---|---|---|---|---|
| Forge | Blacksmith | 150 food | 50 s | +1 melee attack |
| Scale Mail | Blacksmith | 100 food | 40 s | +1 melee and pierce armour |
| Fletching | Blacksmith | 100 food + 50 gold | 30 s | +1 pierce attack |
| Bracer | Blacksmith | 300 food + 200 gold | 40 s | +1 pierce armour |

- Only a finished Blacksmith researches (`researchTech`, `index.html:1682`): the tech's age
  must be reached (`Forge requires Feudal Age`), one tech at a time per building
  (`Blacksmith is busy`), never a duplicate (`Forge already researched`), cost checked
  (`Not enough food`), and other buildings refuse its techs (`Barracks cannot research
  Forge`). The queue panel and the on-map bar track the in-flight tech next to training.
- Finishing adds the id to `Game.techs` (toast `Forge researched`); the effects apply
  through `unitAttack`/`unitArmor` to unit damage only, and the +1 range on
  Fletching/Bracer is not modelled.

## Ages (`AGES`)

Dark Age → Feudal Age → Castle Age → Imperial Age.
Cost (`index.html:128`): Dark → Feudal **500 food** (`CFG.AGE_FOOD`); every later age
costs `AGE_FOOD * 2` = **1000 food** (Feudal → Castle, Castle → Imperial). Hotkey `T`.
Each upgrade sets `Game.ageBonus = Game.age`, which scales unit damage.

## Enemy AI (Red)

Every **45 s** (`CFG.WAVE_EVERY`): if Red is at population cap, every free militia is
ordered to attack the nearest blue unit ("Red attack wave!"); otherwise the Town Center
queues a villager (up to 5 villagers) or a militia, and never double-queues.

## Win / lose

The Town Center is the win condition, and the answer is computed, not remembered
(`setResult`, `index.html:764`): the side with no Town Center left has lost, and the first
side to lose one decides the game — a raze in combat, a cancelled site and a demolish all
`removeBuilding` (`index.html:747`), so all three count. With
`Game.result` set to `'victory'` (enemy keep gone) or `'defeat'` (yours gone), `stepSim`
(`index.html:811`) stops after the clock tick: units, build sites, training queues, arrows
in flight and the enemy AI freeze while the camera and rendering keep working. The `#result`
overlay — markup from `resultHtml` (`index.html:2480`), styled in the head — names the result
and offers a `New game` button wired to `resetGame` (`index.html:2847`), which rebuilds the
same seeded start and clears `result` back to `null`. No auto-restart, no countdown.

## Save / load

The game remembers itself through one `localStorage` slot: `SAVE_PATH` (`index.html:384`) is the
key, `storageGet` / `storageSet` (`index.html:1831` / `index.html:1840`) the only door, and both
answer quietly (`null` / `false`) when the platform has none or refuses the write — which is how
node (`tools/headless-check.js`, `tools/render-preview.js`) and private mode keep running.

- **Envelope** — `saveGame(path, Game, at = now())` (`index.html:1945`) writes
  `{ version, seed, writtenAt, state }`: `version` is `CFG.VERSION` (`index.html:138`),
  `1`; `seed` is `Game.world.seed` falling back to `CFG.SEED`, the only way the excluded `rnd`
  closure is rebuilt; `writtenAt` is the `at` argument, pinned so the same `Game` saved twice
  gives the same bytes; `state` is `encodeState(Game)` (`index.html:1899`), the schema the
  harness pins as `SAVE_FIELDS` (`tools/headless-check.js:2602`).
- **Version rule** — `migrate(payload)` (`index.html:1959`) accepts a payload only when its
  `version` equals `CFG.VERSION`; when the schema moves to 2 the conversion lives there instead
  of the save being thrown away. `validState(payload)` (`index.html:1967`) then checks the shape
  before a single field is assigned — the world's `w`/`h`/`seed` against `CFG.MAP_W`/`MAP_H` and
  the envelope, the array and object containers, `time` and `nextId` as numbers. Every refusal
  (missing slot, empty slot, unparseable text, an unreadable version, an unwalkable shape) ends
  the same way: `loadGame(path, Game, raw = storageGet(path))` (`index.html:2059`) calls
  `resetGame` and answers `false` — it never throws.
- **In and out of `state`** — `Game.techs` (a `Set`) leaves as an array and comes back a `Set`;
  `Game.blocks` (a `Map` of building id → tiles) leaves as an object and comes back a `Map` keyed
  by `Number(k)`, then `rebuildBlocks` (`index.html:725`) recomputes it and `decodeState`
  (`index.html:2015`) bumps `mapEpoch` instead of restoring it, so every cached route rebuilds on
  its first step. Excluded as per-runtime caches: `dom`, `view`, `mm`, `mmBase`, `toastMsg`,
  `toastAt`, `pingAt`, `frame`, `pathQueries`, `sprites`, `rnd`, `mapEpoch`, `autosaveAt`, `sound`.
- **References become ids** — `Game.selectedBuilding` is stored as an id and relinked on load
  (`decodeState`, `index.html:2015`); a projectile's target becomes `tk` (`'unit' | 'building'`)
  plus `tid` (`encodeProjectile`, `index.html:1893`, and `decodeProjectile`, `index.html:2002`
  relinks it and drops an arrow whose mark is gone); a `harvest` / `go_deposit` order's `src` is
  stored as the tile or farm it names (`encodeSource`, `index.html:1860`) and rebuilt through
  `sourceFromTile` (`index.html:639`) / `sourceFromFarm` (`index.html:652`) — a parsed `src`
  would be a dead number where the live one is a getter onto `world.amount` / `b.field`, and a
  source that no longer exists retires the order to `idle` (`decodeOrder`, `index.html:1985`).
- **Autosave** — `CFG.AUTOSAVE_DEBOUNCE: 2` and `CFG.AUTOSAVE_EVERY: 30` (`index.html:139-140`)
  set the rhythm through `Game.autosaveAt`: `markDirty(Game)` (`index.html:1935`), called by
  every §4 mutator and by `stepSim`'s three completion events (a unit trains, a tech finishes, a
  unit dies), pulls the schedule earlier and never later, so a burst of commands inside the
  window costs ONE write. The write itself sits in `stepGame` after `stepSim(Game, dt)`
  (`index.html:3026-3028`) so the saved frame is the one just run, and `stepSim` never writes —
  driving the simulation from a test touches no storage. `resetGame` sets `Game.autosaveAt =
  Game.time` (`index.html:2854`): a new settlement is written by the very next frame, which is
  what makes `N` (`index.html:2745`) overwrite the slot instead of waiting out the debounce.
- **The page surface** — the header's `Save` button (`index.html:81`) writes the slot through
  `saveGame` (`index.html:2978`) and toasts `Saved`; `boot` (`index.html:2931`) calls
  `storageGet` / `loadGame` (`index.html:2936-2937`) right after `createState` (`index.html:2831`),
  so reopening the page lands on the saved game; the three new-game paths — `N`
  (`index.html:2745`), the footer's `New map` (`index.html:2769`) and the victory overlay's
  `New game` (`index.html:2974`) — clear the slot before `resetGame`, which schedules the rewrite.

## Sound (SFX)

Six sounds, one table — `SFX` (`index.html:417-424`) — and one door that plays them.
`playSfx(Game, name)` (`index.html:2101`) synthesises the row through the Web Audio API (one
oscillator ramped through the row's `freq` list into a gain envelope) rather than shipping an
audio file, so the repo stays one `index.html` with no build step. The `fire` column names the
function that plays each row and the harness (`tools/headless-check.js` §14) binds to it —
the table is the contract, the audio path and the checks are its two readers, the way
`hudState` is the contract for the footer.

| sound | wave | freq (Hz) | dur (s) | gain | fires from |
|---|---|---|---|---|---|
| `hit` | triangle | 170 → 60 | 0.14 | 0.35 | `hitUnit` (`index.html:887`) |
| `arrow` | sawtooth | 880 → 320 | 0.10 | 0.18 | `spawnArrow` (`index.html:903`) |
| `build` | square | 220 → 140 | 0.20 | 0.25 | `updateUnit`'s `b.built >= 1` branch (`index.html:1058`) |
| `age` | triangle | 392 → 523 → 659 | 0.60 | 0.30 | `upgradeAge` (`index.html:1724`) |
| `victory` | sawtooth | 523 → 659 → 784 | 0.90 | 0.30 | `setResult` (`index.html:764`) |
| `defeat` | sawtooth | 392 → 311 → 262 | 1.10 | 0.28 | `setResult` (`index.html:764`) |

- **One voice per name per frame** — `Game.sound` (`createState`, `index.html:2840`) holds the
  `AudioContext` plus the last frame that made a sound and the names it fired, so a twenty-unit
  brawl landing ten hits in one frame makes one `hit`, and the next frame's shots make their
  own; `setResult`'s single `playSfx(Game, Game.result)` covers both result rows.
- **Three silences, none of them thrown** — a name the table does not know, a platform with no
  `AudioContext` (node, `tools/render-preview.js`, a browser that blocked audio) and a muted
  game each answer `false` before a node is built; the caller never has to care (section 4
  stays DOM-free: the `typeof AudioContext` read is guarded inside the function).
- **Mute is presentation, not state** — the header `Sound on/off` button (`index.html:82`)
  toggles through `setMuted` (`index.html:2096`), which stamps the button
  (`applyMuteButton`, `index.html:2090`) and writes `MUTE_PATH` = `aoe2mini:muted`
  (`index.html:385`) through the same `storageSet` the save slot uses; `isMuted`
  (`index.html:2080`) reads the button when there is one and the key when there isn't, so a
  muted game stays muted after a reload and a fresh tab starts unmuted. `boot` calls
  `applyMuteButton` once (`index.html:2955`) to honour the saved preference without writing
  the key back, and the sound handle never enters `encodeState`.

## Interface

`hudState` (`index.html:2459`) answers the one selection word the footer is in — `group`
(several units), `units` (exactly one), `building` (a building and nothing else), `none` —
and `hudHtml` (`index.html:2471`) is the single owner of the footer's markup: the same
three panels (`info` | `commands` | `queue`) in the same order for every state, stamped
`renderHud` (`index.html:2430`) writes it in one
`innerHTML` write, so the frame the CSS pins (`footer{flex:0 0 74px;height:74px}`, every
panel a fixed-height `overflow:hidden` box) never changes size when the selection does —
the info panel is a fixed title/body/bar grid, the command panel a row-based button grid.
Choosing a placement (`Game.placing`) changes the info panel's content, never the state. A
group collapses to a `N units` title plus one `.sum` line of per-kind counts
(`5 Villager, 4 Militia, 3 Archer`) — at most 3 kinds named, the rest folded into
`+K more` — instead of one line per unit, and its bar shows the squad's aggregate HP
fraction.

## Camera & controls

Left click select · drag to box-select (mixed selections collapse to villagers) · right
click move / attack / gather (context decided by what is under the cursor) · panning is
`WASD / arrows` at 620 px/s (`ArrowUp` is the pan-up key, `W` doubles as the Barricade
placement hotkey) · 14 px edge-scroll band, active only while the pointer is over the
canvas (not over header/footer chrome) · `Ctrl+1..9` store group, `1..9` recall · `H`
house, `F` farm, `B` barracks, `L` lumber camp, `G` mining camp, `M` mill, `R` archery
range, `K` blacksmith, `E` market, `C` watch tower, `W` barricade, `T` upgrade age,
`Esc` cancels placement then clears selection · `N` new game (`index.html:2745`) · minimap
click/drag moves the camera ·
"New map" reseeds and resets.
