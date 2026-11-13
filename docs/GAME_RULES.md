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
| Fog | explored/revealed per tile, drawn dimmed outside vision |
| Teams | Blue (player, team 0) vs Red (AI, team 1) |
| Starting stockpile | 100 food, 100 wood, 50 gold, 50 stone (`CFG.START`) |

## Economy

- Villagers gather at **1.5 units/second** (`CFG.GATHER_RATE`) and carry **10** at a time
  (`findDropoff`, `src/economy.js:31`)
  and deposit into the matching stockpile (`u.carryRes`).
- At most **2 villagers per resource tile** (`CFG.WORKERS_PER_TILE`). The 4 starters are
  placed food-first (berries), then wood, then anything — putting all four on one berry
  bush is what used to stall the economy at 420 food (the food-stall regression, fixed).
- A tile that runs dry disappears (T4): `depleteTile` (`src/economy.js:58`) runs on the
  harvest tick the moment a tile's `amount` reaches 0 and reverts the tile to `T.GRASS`
  (the amount stays 0), so the bush, tree or ore node stops being drawn and — per the
  Movement rules below — stops blocking movement. Farms are not tiles: a field empties
  in place and nothing there turns to grass.
- The emptied villager re-queues on the nearest tile of the **same** resource within
  **5** tiles (`nextSource`, `src/economy.js:73`, and after a deposit `resumeGather`,
  `src/economy.js:84`). The old radius-14 same-resource search and the any-resource radius-20
  fallback are gone: with nothing of that kind that close he stands idle instead of
  walking across the map to chop wood.

## Movement

- Everything solid blocks (`walkable`, `src/movement.js:314`): water, resource tiles with
  stock (`amount > 0`) and building tiles — foundations included, via `Game.occupied`
  (`rebuildBlocks`, `src/entities.js:102`). Units work from the neighbour tile instead of
  standing on the thing: `workSpot` (`src/entities.js:42`) offers only free walkable
  neighbours, `workPos` (`src/entities.js:150`) is the standing spot beside a building, and a
  unit caught under a new footprint is moved there (`makeBuilding`, `src/entities.js:76`).
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
  assigns for what was ordered to (`workPos` for a building, `workSpot` for a tile) — and
  route to that, so a builder works from the edge of the footprint instead of stalling on
  it. A target with no reachable spot leaves the order unroutable instead of queued.
- A group move gets ranks instead of a scatter (`formationSlots`, `src/movement.js:280`): a
  centred `cols = ceil(sqrt(n))` grid, one tile per unit (the `max(CFG.UNIT_SEP, CFG.TILE)`
  pitch expressed on the tile grid), solid or already-held cells skipped and the grid
  grown until every unit has a distinct walkable tile, the nearest free slot paired to the
  nearest unit so nobody crosses the formation. The slot is written into the order *and*
  `u.slot`, and a retiring move order releases it — so a finished formation holds no tiles
  and a slot taken by another order forces a re-ask instead of a stack. `attack` and
  `harvest` orders keep their targets: no slots for a fight.
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
  melee unit — else the nearest built enemy building within `CFG.BUILDING_ACQUIRE` (5), and
  snap to the next target the moment their current one dies. Villagers never start fights;
  they only attack when ordered.
- Damage is computed in one place (`unitAttack`/`unitArmor`, `src/sim.js:55`/`src/sim.js:69`):
  attack = the row's `atk` × `(1 + 0.25 × ageBonus)` — the age multiplier, `ageBonus` is
  the age index (1× at Dark Age) — plus every researched tech's attack for the attacker's
  damage class; a hit then deals `max(1, attack − armour)`, armour being the defender row's
  `melee`/`pierce` value plus the techs' flat armour of that class (blacksmith techs apply
  to units only, never to built buildings' attacks).
- Population used counts **villagers only**, per AoE2 convention.
- Art: all three kinds render from the unit atlas (`SPRITE_SHEET` 1522×684 at
  `src/config.js:73`), the frames ripped from the AoE2 art and recoloured per team, drawn at
  the size the manifest authors (villager 20×20, militia 22×22, archer 20×20) and mirrored
  when the unit walks left; `tools/gen-atlas.js` regenerates the PNG from
  `data/sprites.json`, and `unitAnim` (`src/render.js:134`) picks the cell from the unit's order.

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
  `age: 1` in `data/buildings.json`): `build` (`src/commands.js:114`) refuses them before
  picking a builder whenever `Game.age < 1` (`Blacksmith requires Feudal Age`,
  `Market requires Feudal Age`, `Watch Tower requires Feudal Age`,
  `Barricade requires Feudal Age`), and their buttons — hotkeys `k`, `e`, `c`, `w` —
  only appear once the player reaches Feudal Age.
- The Barricade adds no placement or combat code of its own: `build` (`src/commands.js:114`)
  drafts its crew (`pickBuilders`, `src/commands.js:93`) through the same `canPlaceAt`
  (`src/commands.js:156`) rule, cancelling refunds
  `floor(3 × CFG.CANCEL_REFUND)` = **2** wood and demolishing costs nothing — and a
  built or half-built segment registers its one tile in `Game.occupied` like any other
  footprint, so routes reroute around it and a raze reopens the gap
  (`docs/plans/2026-11-12-wooden-barricade.md`).
- Market trade (`trade`, `src/commands.js:250`): the market row is the only one carrying
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
- One rule judges a tile — `canPlaceAt` (`src/commands.js:156`): the row's `age` gate plus a
  free, walkable footprint (`siteFree`, `src/commands.js:200`). A click that fails it is
  refused (`Can't build there`) with nothing spent and `Game.placing` still armed; the old
  answer was to move the site to `findSite` (`src/world.js:144`) next to the villager, and a
  tile more than 7 tiles off the builder failed too (docs/TODO.md P0-3). Distance is no
  longer part of the rule — the builder walks — so `findSite` only answers the button call
  without a tile, and `drawGhost` (`src/render.js:240`) paints with the same `canPlaceAt`.
  Placement also needs enough resources. The crew (`pickBuilders` via
  `build`, `src/commands.js:114`) is every free villager in the current selection, else
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
  attacked and a finished own building is still just the ground a move order ends on.
- Cancelling and demolishing (phase 2, T3/T4): `cancelConstruction` (`src/commands.js:166`)
  ends an in-progress site, refunding `floor(cost × CFG.CANCEL_REFUND)` — **80%** of the
  defined cost whatever the progress — and frees its builders; `demolish`
  (`src/commands.js:186`) removes a finished own-team building with no refund, refuses Town
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

- Only a finished Blacksmith researches (`researchTech`, `src/commands.js:231`): the tech's age
  must be reached (`Forge requires Feudal Age`), one tech at a time per building
  (`Blacksmith is busy`), never a duplicate (`Forge already researched`), cost checked
  (`Not enough food`), and other buildings refuse its techs (`Barracks cannot research
  Forge`). The queue panel and the on-map bar track the in-flight tech next to training.
- Finishing adds the id to `Game.techs` (toast `Forge researched`); the effects apply
  through `unitAttack`/`unitArmor` to unit damage only, and the +1 range on
  Fletching/Bracer is not modelled.

## Ages (`AGES`)

Dark Age → Feudal Age → Castle Age → Imperial Age.
Cost (`src/config.js:17`): Dark → Feudal **500 food** (`CFG.AGE_FOOD`); every later age
costs `AGE_FOOD * 2` = **1000 food** (Feudal → Castle, Castle → Imperial). Hotkey `T`.
Each upgrade sets `Game.ageBonus = Game.age`, which scales unit damage.

## Enemy AI (Red)

Every **45 s** (`CFG.WAVE_EVERY`): if Red is at population cap, every free militia is
ordered to attack the nearest blue unit ("Red attack wave!"); otherwise the Town Center
queues a villager (up to 5 villagers) or a militia, and never double-queues.

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

The game remembers itself through one `localStorage` slot: `SAVE_PATH` (`src/config.js:273`) is the
key, `storageGet` / `storageSet` (`src/save.js:9` / `src/save.js:18`) the only door, and both
answer quietly (`null` / `false`) when the platform has none or refuses the write — which is how
node (`tools/headless-check.js`, `tools/render-preview.js`) and private mode keep running.

- **Envelope** — `saveGame(path, Game, at = now())` (`src/save.js:123`) writes
  `{ version, seed, writtenAt, state }`: `version` is `CFG.VERSION` (`src/config.js:27`),
  `1`; `seed` is `Game.world.seed` falling back to `CFG.SEED`, the only way the excluded `rnd`
  closure is rebuilt; `writtenAt` is the `at` argument, pinned so the same `Game` saved twice
  gives the same bytes; `state` is `encodeState(Game)` (`src/save.js:77`), the schema the
  harness pins as `SAVE_FIELDS` (`tools/checks/10-reset-save.js:22`).
- **Version rule** — `migrate(payload)` (`src/save.js:137`) accepts a payload only when its
  `version` equals `CFG.VERSION`; when the schema moves to 2 the conversion lives there instead
  of the save being thrown away. `validState(payload)` (`src/save.js:145`) then checks the shape
  before a single field is assigned — the world's `w`/`h`/`seed` against `CFG.MAP_W`/`MAP_H` and
  the envelope, the array and object containers, `time` and `nextId` as numbers. Every refusal
  (missing slot, empty slot, unparseable text, an unreadable version, an unwalkable shape) ends
  the same way: `loadGame(path, Game, raw = storageGet(path))` (`src/save.js:242`) calls
  `resetGame` and answers `false` — it never throws.
- **In and out of `state`** — `Game.techs` (a `Set`) leaves as an array and comes back a `Set`;
  `Game.blocks` (a `Map` of building id → tiles) leaves as an object and comes back a `Map` keyed
  by `Number(k)`, then `rebuildBlocks` (`src/entities.js:102`) recomputes it and `decodeState`
  (`src/save.js:193`) bumps `mapEpoch` instead of restoring it, so every cached route rebuilds on
  its first step. Excluded as per-runtime caches: `dom`, `view`, `mm`, `mmBase`, `toastMsg`,
  `toastAt`, `pingAt`, `frame`, `pathQueries`, `sprites`, `rnd`, `mapEpoch`, `autosaveAt`, `sound`.
- **References become ids** — `Game.selectedBuilding` is stored as an id and relinked on load
  (`decodeState`, `src/save.js:193`); a projectile's target becomes `tk` (`'unit' | 'building'`)
  plus `tid` (`encodeProjectile`, `src/save.js:71`, and `decodeProjectile`, `src/save.js:180`
  relinks it and drops an arrow whose mark is gone); a `harvest` / `go_deposit` order's `src` is
  stored as the tile or farm it names (`encodeSource`, `src/save.js:38`) and rebuilt through
  `sourceFromTile` (`src/entities.js:16`) / `sourceFromFarm` (`src/entities.js:29`) — a parsed `src`
  would be a dead number where the live one is a getter onto `world.amount` / `b.field`, and a
  source that no longer exists retires the order to `idle` (`decodeOrder`, `src/save.js:163`).
- **Autosave** — `CFG.AUTOSAVE_DEBOUNCE: 2` and `CFG.AUTOSAVE_EVERY: 30` (`src/config.js:28-29`)
  set the rhythm through `Game.autosaveAt`: `markDirty(Game)` (`src/save.js:113`), called by
  every command mutator and by `stepSim`'s three completion events (a unit trains, a tech finishes, a
  unit dies), pulls the schedule earlier and never later, so a burst of commands inside the
  window costs ONE write. The write itself sits in `stepGame` after `stepSim(Game, dt)`
  (`src/boot.js:233-235`) so the saved frame is the one just run, and `stepSim` never writes —
  driving the simulation from a test touches no storage. `resetGame` sets `Game.autosaveAt =
  Game.time` (`src/boot.js:61`): a new settlement is written by the very next frame, which is
  what makes `N` (`storageSet` + `resetGame`, `src/input.js:163`) overwrite the slot instead of waiting out the debounce.
- **The page surface** — the header's `Save` button (`index.html:19`) writes the slot through
  `saveGame` (`src/boot.js:185`) and toasts `Saved`; `boot` (`src/boot.js:138`) calls
  `storageGet` / `loadGame` (`src/boot.js:143-144`) right after `createState` (`src/boot.js:38`),
  so reopening the page lands on the saved game; the three new-game paths — `N`
  (`storageSet`, `src/input.js:163`), the footer's `New map` (the `restart` action, `src/input.js:187`) and the victory overlay's
  `New game` (`src/boot.js:181`) — clear the slot before `resetGame`, which schedules the rewrite.

## Sound (SFX)

Six sounds, one table — `SFX` (`src/config.js:310-317`) — and one door that plays them.
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
| `build` | square | 220 → 140 | 0.20 | 0.25 | `updateUnit`'s `b.built >= 1` branch (`src/sim.js:252`) |
| `age` | triangle | 392 → 523 → 659 | 0.60 | 0.30 | `upgradeAge` (`src/commands.js:266`) |
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
- **Mute is presentation, not state** — the header `Sound on/off` button (`index.html:20`)
  toggles through `setMuted` (`src/sound.js:28`), which stamps the button
  (`applyMuteButton`, `src/sound.js:22`) and writes `MUTE_PATH` = `aoe2mini:muted`
  (`src/config.js:274`) through the same `storageSet` the save slot uses; `isMuted`
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
pins (`footer{flex:0 0 74px;height:74px}`, every
panel a fixed-height `overflow:hidden` box) never changes size when the selection does —
the info panel is a fixed title/body/bar grid, the command panel a row-based button grid.
Choosing a placement (`Game.placing`) changes the info panel's content, never the state. A
group collapses to a `N units` title plus one `.sum` line of per-kind counts
(`5 Villager, 4 Militia, 3 Archer`) — at most 3 kinds named, the rest folded into
`+K more` — instead of one line per unit, and its bar shows the squad's aggregate HP
fraction.

Below 720 px the frame reflows instead of shrinking: one `@media (max-width:720px)` block
(`src/style.css:66`, written last so it wins the cascade) trims the header padding to `2px 6px`
and turns the footer into a column, stacking the same three panels inside the same `74px` —
info shows its title only, the command grid takes the room, the queue line stays one line —
while `#stage` keeps every other row for the map. Nothing is hidden on desktop; the desktop
rules above the block are what the responsive-layout checks (`tools/checks/09-hud.js`) compare the responsive ones against.

## Camera & controls

Left click / tap select (`pointerUp`, `src/input.js:41` — one pointer per drag, so a second
finger cannot move the anchored box) · drag to box-select (mixed selections collapse to
villagers) · right click, or a hold of `LONG_PRESS_MS` 600 ms that stays within 8 px of its
press (`src/config.js:278`), issues move / attack / gather / build (context decided by
what is under the cursor) · panning is
`WASD / arrows` at 620 px/s (`ArrowUp` is the pan-up key, `W` doubles as the Barricade
placement hotkey) · 14 px edge-scroll band, active only while the pointer is over the
canvas (not over header/footer chrome) · `Ctrl+1..9` store group, `1..9` recall · `H`
house, `F` farm, `B` barracks, `L` lumber camp, `G` mining camp, `M` mill, `R` archery
range, `K` blacksmith, `E` market, `C` watch tower, `W` barricade, `T` upgrade age,
`Esc` cancels placement then clears selection · `N` new game (`src/input.js:163`) · minimap
click/drag moves the camera ·
"New map" reseeds and resets.
