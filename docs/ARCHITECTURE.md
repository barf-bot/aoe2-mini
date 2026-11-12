# Architecture

One file, seven sections, one state object. Line numbers refer to `index.html` as of the
current `main`; `data/` (the vendored AoE2 stat tables and sprite frames — `data/README.md`
names the sources) is what section 1's generated tables and `assets/sprites.png` are built from.

## File map

| § | Section | Lines | Contents |
|---|---|---|---|
| 1 | config | 115-425 | `CFG`, `KINDS`, `SPRITE_SHEET`/`SPRITES`/`WORK_ANIM`/`spriteFor`, `BLD_SPRITES`/`bldSpriteFor`, `BLD`, `TECHS`, `AGES`, `MUTE_PATH`, `T`, `PAL`, `TEAM`, `RES_OF_TILE`, `CARRY_COLOR`, `SFX` — every tunable number; `CFG`/`KINDS`/`BLD`/`TECHS` are generated from `data/` |
| 2 | world / map | 426-624 | seeded generation (`mulberry32`, `hash2`, `makeWorld`), site search, `berryCluster`, resource tiles and sources |
| 3 | entities | 625-807 | `setAtlas`, `sourceFromTile`/`sourceFromFarm`, `workSpot`, `makeUnit`, `makeBuilding`, `rebuildBlocks`, `removeBuilding`/`setResult`, `workPos`, `standingSpots` |
| 4 | simulation | 808-2070 | `stepSim`/`updateUnit` (the order state machine), `findPath`/`stepToward`/`moveUnit`/`standTarget`/`formationSlots` (the pathfinding block), `unitAttack`/`unitArmor`/`hitUnit`/`hitBuilding`/`autoAcquire`, `spawnArrow`/`updateProjectiles`/`stepBuildingAttacks`, economy, orders, `build`, `cancelConstruction`, `demolish`, `train`, `researchTech`, `trade`, `upgradeAge`, `saveGame`/`loadGame`/`markDirty`/`encodeState` (the save payload); sub-blocks `combat math` (853), `pathfinding` (1108), `economy helpers` (1729), `enemy AI` (1762), `toast` (1812), `save / load` (1824) — **pure logic, no DOM** |
| 5 | render | 2071-2621 | `beginCanvas`, world/building/unit drawing (`drawBuildings`, `unitAnim`, `drawUnits`, `drawProjectiles`), ghost, drag box, minimap, the uniform HUD frame (`renderHud`/`hudState`/`hudHtml` with `infoHtml`/`commandsHtml`/`queueHtml`), the result-overlay HTML and the audio door (`playSfx`/`isMuted`/`setMuted`) |
| 6 | input | 2622-2794 | picking, mouse, keyboard, the mute listener and delegated command-bar clicks |
| 7 | boot | 2795-3031 | canvas sizing, `createState`, `resetGame`, `loadAtlas`, `boot` (mute-button sync first), the rAF loop |
| — | public surface | 3032-3054 | the `AoE2` export banner + object (this plan added `SFX`, `MUTE_PATH`, `applyMuteButton`; the save/load plan added `SAVE_PATH`, `saveGame`, `loadGame`, `markDirty`, `storageGet`, `storageSet`), `module.exports` / `window.Game` wiring |

## The `Game` object

Everything mutable lives on one object, created by `createState()` and passed into every
function — no hidden globals, which is what makes the logic testable from node:

```
Game = { world, units[], buildings[], projectiles[], blocks(Map buildingId -> tiles), sprites{atlas},
         res[2], age, ageBonus, techs(Set of researched tech ids), rnd(mulberry32(CFG.SEED)), cam{x,y}, keys, mouse, drag, selection[],
         selectedBuilding, groups{}, placing, started, wave, time, frame, autosaveAt(next autosave write),
         mapEpoch(route cache epoch), pathQueries(findPath calls),
         result('victory' | 'defeat' | null), dom{...}, view, minimapCache }
```

`Game.sprites.atlas` is the one place the atlas is attached (`setAtlas`,
`index.html:631`): `loadAtlas` fills it in the browser and the harnesses inject an image
there, so the renderer never has to wonder where the sheet came from.

Persistence: the plain half of that object is the save payload — `encodeState`
(`index.html:1899`) picks exactly the fields `saveGame` writes, the per-runtime caches (`dom`,
`view`, `mm`, `mmBase`, `toastMsg`, `toastAt`, `pingAt`, `frame`, `pathQueries`, `sprites`, `rnd`,
`mapEpoch`, `autosaveAt`) stay out of it and are rebuilt on load — so one object shape can be
written to `localStorage` and read back into a fresh `createState` (`index.html:2831`). The
ruleset itself is `docs/GAME_RULES.md` §Save / load; the parts are below in
`### Save / load` (`saveGame`, `index.html:1945`).

Coordinate systems: **tile** coords (`tx`,`ty`) for the world grid, **world pixels**
(`x = tx * CFG.TILE`), **screen pixels** (`sx`) via `toWorld(e)` / camera offset. Terrain
type lookup is a flat array index (`ty * world.w + tx`).

## Simulation model

- `startLoop` drives `requestAnimationFrame`, clamps `dt` to 0.1s (tab-switch guard),
  then `stepGame(Game, dt)` → camera pan/edge-scroll → `stepSim(Game, dt)`.
- `stepSim` ticks every unit, every building (construction progress, training queue, and the
  attack cooldown of built shooters), the enemy AI, then `separate()` resolves unit overlap
  (`CFG.UNIT_SEP`) and `updateProjectiles()` flies and resolves the arrows in flight. With
  `Game.result` set it stops after the clock tick: nothing moves, the camera and rendering
  still run.
- Time-based, not fixed-step: tests drive it directly with a fixed `1/30` step, so
  behaviour is deterministic given the same seed (`CFG.SEED = 1337`).
- Dead units are pruned out of `Game.units`; buildings persist.

### Unit order state machine (`updateUnit`, index.html:996)

`idle` → `move` → `harvest` → `go_deposit` → (re-acquire source via `nextSource`) …
plus `build` (works on a site until `built >= 1`) and `attack` (chase to
`u.r + target.r + 4`, then swing on `atkTime` cooldown). Carry capacity is
`CFG.CARRY_MAX`; the carried resource is recorded in `u.carryRes` so `deposit()` credits
the right stockpile — that field being unset was a real bug (deposits silently vanished).

Every unit also carries its rendering state: `u.face` (`+1`/`-1`) and `u.anim`, the
activity clock behind every animation (walk, work, swing). `unitAnim(u)`
(`index.html:2265`, section 5) maps it to the sprite cell to show; `moveUnit`
(`index.html:1250`) is the only writer of `u.face`, so units never flip for no reason.

### Pathfinding (`findPath`, `index.html:1160`)

A\* over the tiles `walkable` answers for: uniform cost, 8-connected, and a diagonal never
cuts between two solid tiles — so routes bend around water, forest and footprints instead
of sliding into them. `moveUnit` (`index.html:1250`) walks the route's tile centres plus
the exact ordered point at `u.speed` px/s (`stepToward`, `index.html:1209`) and keeps the
answer on the unit (`u.path` / `u.pathFor` / `u.pathAt`): a route is valid for one goal
tile and one version of the world, so a changed goal or a bumped `Game.mapEpoch` (a
building went up, a tile ran dry) drops it and the next step re-paths.
`CFG.ASTAR_MAX_NODES` caps a single query, and an unreachable goal costs one capped query
answer instead of one per tile. `standTarget` (`index.html:1299`) turns a solid order target into
a standable tile — the ordered point itself when it is walkable or already within the
order's arrival radius, else `workPos` for a building / `workSpot` for a tile — so every
order kind runs one pipeline, order → standTarget → findPath → step, and
`formationSlots` (`index.html:1320`) hands a group's move orders one distinct tile each,
the ranks that replaced the golden-angle `spread`.

### Combat

Damage math lives in one place — the `combat math` sub-block (`unitAttack`,
`index.html:861`; `unitArmor`, `index.html:875`): a unit's attack is the row's
`KINDS[kind].atk` times the age multiplier `1 + 0.25 * ageBonus` (`ageBonus` is the age
index, set on upgrade — 1× at Dark Age, so 7 militia swings (7×4) fell a 25 hp villager)
plus every researched tech's attack for the damage class (melee for a swing, pierce for
an arrow or a ranged unit); a built shooter uses `BLD[kind].attack` and gets no unit
tech. The defender's armour is the row's `meleeArmor`/`pierceArmor` plus the techs' flat
armour of that class, and `hitUnit` (`index.html:887`) lands `max(1, attack − armour)` —
armour softens a hit but never absorbs it below 1. Attackers only damage the target
they're ordered to attack — a unit (`hitUnit`) or a building (`hitBuilding`,
`index.html:962`, which razes it at 0 hp via `removeBuilding`, `index.html:747` — the one
exit that also runs `setResult` (`index.html:764`), the win/lose rule). Idle fighters
acquire on their own: `autoAcquire` (`index.html:975`) gives them the nearest enemy unit
within their own `KINDS[kind].range` tiles (a melee unit falls back to `CFG.ACQUIRE`),
else the nearest built enemy building within `CFG.BUILDING_ACQUIRE`, and a kill
immediately retargets the next one. How a hit is delivered depends on
`KINDS[kind].atkType`: `'melee'` swings at contact every `atkTime`; `'ranged'` halts at
`range * CFG.TILE` and, every `reload` seconds, `spawnArrow` (`index.html:903`) puts an
arrow in `Game.projectiles` that flies at `CFG.PROJ_SPEED` px/s and resolves through
`updateProjectiles` (`index.html:917`) — one arrow, one mark, `accuracy` % chance to
land, deleted either way. Built buildings with `attack > 0` (Town Center 5, LOS 8) shoot
the same way from `stepBuildingAttacks` (`index.html:942`).

### Save / load (`saveGame`, `index.html:1945`)

Section 4 owns the whole contract. `encodeState` (`index.html:1899`) is the single owner of the
schema — the field list the harness pins as `SAVE_FIELDS` (`tools/headless-check.js:2602`) —
`saveGame(path, Game, at = now())` (`index.html:1945`) serialises `{ version, seed, writtenAt,
state }` and hands the string to `storageSet` (`index.html:1840`), and
`loadGame(path, Game, raw = storageGet(path))` (`index.html:2059`) reads the slot back. The
shipped signature is that three-argument one rather than the design's `loadGame(path, raw)`: the
target `Game` sits in the middle so a test — or `boot` (`index.html:2931`) opening the page — can
load a slot into a game that already exists. `migrate` (`index.html:1959`) and `validState`
(`index.html:1967`) gate the payload (the version, then the shape) and every refusal ends in
`resetGame(Game); return false`; `decodeState` (`index.html:2015`) then restores in dependency
order — world → buildings → `blocks` + `rebuildBlocks` (`index.html:725`) → `mapEpoch++` → units
(with `order.src` rebuilt through `sourceFromTile` (`index.html:639`) / `sourceFromFarm`,
`index.html:652`) → projectiles (`t` relinked by `decodeProjectile`, `index.html:2002`) → the
id-only fields → `techs` (a `Set`) and `rnd` (rebuilt from the envelope's seed). The schedule is
`markDirty(Game)` (`index.html:1935`) — pull `Game.autosaveAt` earlier, never later — and
`stepGame` after `stepSim` (`index.html:3026-3028`) is the only writer, so the write carries the
frame it just ran and `stepSim` itself never touches storage. The ruleset is in
`docs/GAME_RULES.md` §Save / load; the `save / load` banner sits at `index.html:1824`.

## Render model

Terrain tiles come from `PAL` (three variants per terrain, chosen by a per-tile hash),
trees/ore/berries are drawn as vector paths (`drawTree`, `drawOre`, `drawBerry`), and
built buildings blit their team cell from the atlas (`drawBuildings`,
`index.html:2189`); the `noSprite` kinds (Blacksmith, Market, Watch Tower and Barricade)
have no atlas cell and draw the flat team-coloured footprint instead, so a new building
never grows `assets/sprites.png`; unbuilt ones keep the ghost footprint with a progress
overlay while `built < 1`, and a dry farm (empty `field`) keeps its procedural stubble.

Units come from `assets/sprites.png`: `SPRITES` (`index.html:188`) maps every kind to
its animation cells and `spriteFor(kind, team, anim)` (`index.html:241`) resolves one;
`BLD_SPRITES` (`index.html:255`) holds the built-building cells of the same sheet and
`bldSpriteFor(kind, team)` (`index.html:275`) resolves those, each cell drawn at the
building's exact footprint. `unitAnim(u)` (`index.html:2265`) decides which animation a
unit plays from its order — villagers farm/chop/mine (a/b frames per harvested resource)
plus idle/walk, militia and archer idle/walk plus attack_a/attack_b — and `drawUnits`
(`index.html:2281`) blits the cell at integer pixels with `drawImage` and mirrors it with
`scale(-1, 1)` when `u.face` is `-1`.
The 1px walk bob applies only to walk cells; work/swing animations animate through their
own a/b frames. The old team-coloured disc/square drawing stays as the
fallback whenever no atlas is loaded. On top of the sprite: selection ring, health bar and
the carry dot tinted by `CARRY_COLOR`.

Canvases go through `beginCanvas(canvas, w, h)`; sizes come from `sizeW/sizeH(dom)` with
node-safe fallbacks (`view_W/view_H`, `index.html:2820-2821`). The footer is one fixed-height
element owned by `hudHtml` (`index.html:2471`): `renderHud` (`index.html:2430`) stamps it
with the `data-state` answered by `hudState` (`group` / `units` / `building` / `none`) and
writes the same three panels — `infoHtml`, `commandsHtml`, `queueHtml` — in the same order
for every selection, so the frame never resizes the map and the CSS can pin it to
`height:74px` with every panel a fixed `overflow:hidden` box (the command panel is a
row-based button grid). The game-over overlay is `resultHtml` (`index.html:2480`) written
into `#result` and hidden again by its `show` class the moment `Game.result` goes back to
null.

## Input model

`attachInput(Game, doc)` registers `mousemove`, `mousedown`, `mouseup`, `contextmenu`,
`keydown`, `keyup`. `mousemove` updates `Game.mouse` (the edge-scroll state) only while
the pointer is over the canvas or mid-drag — coords measured on the header/footer set it
to `null` instead, so hovering HUD chrome no longer reads as "cursor on a screen edge"
and pans the camera. Click-vs-drag is decided by a 4px threshold; mixed drag selections
collapse to villagers (AoE2 behaviour). Commands: left select, right click issue order,
WASD/arrows pan, `Ctrl+1..9` set group, `1..9` recall, and `H`/`F`/`B`/`L`/`G`/`M`/`R`/`K`/`E`/`C`/`W`
arm every placeable building, `T` upgrade age, `Esc` clears placement then selection. The command bar is
rebuilt every frame, so its clicks are **delegated to its parent** — `Game.dom.commands ||
Game.dom.hud`, the footer in a browser — and `buttonAt` (`index.html:2649`) is the single
button lookup that delegate and the `#result` overlay's listener (wired in `boot`,
`index.html:2972`).

## Test harness design

- `tools/headless-check.js` — reads `index.html`, extracts the `<script>` body into a temp
  `.js`, installs a stub `document`/`window` (elements with `textContent`/`innerHTML`
  accessors, cached per id, `fire()` to dispatch events, a Proxy 2D context that swallows
  every draw call), requires it, then asserts 266 invariants. It never opens a browser. Node
  has no `Image`, so the sandbox defines one (section 2b) whose `src` setter decodes the
  real sheet — caveat measured on `@napi-rs/canvas` 1.1.0: an `Image` built that way
  reports the right size but paints nothing, so this stub proves the loading *wiring*
  while `render-preview.js` renders from a properly decoded image.
- `tools/render-preview.js` — same stub, except the view canvas comes from
  `@napi-rs/canvas`, so `renderFrame` paints real pixels; writes `preview.png`. The atlas
  is decoded with `loadImage()` and injected via `setAtlas`, exactly what a browser's
  `img.onload` does. Falls back to the stub-only path (just proving the draw calls run)
  when the package is absent.
- `tools/gen-atlas.js` — composes `assets/sprites.png` from the vendored frames in
  `data/sprites/` plus the `data/sprites.json` manifest and rewrites `SPRITE_SHEET` /
  `SPRITES` / `WORK_ANIM` / `BLD_SPRITES` under their GENERATED FROM banners (same input →
  same bytes, so the committed PNG can be diffed in review instead of trusted).
- `tools/check-stats.mjs` — extracts the same `<script>`, requires it and diffs every field of
  `CFG`/`KINDS`/`BLD`/`TECHS` against `data/units.json` + `data/buildings.json` +
  `data/techs.json`, exiting 1 with one line per drifted field; `--write` regenerates the
  four section-1 blocks from `data/`. The numbers are vendored rather than hand-typed, and this check is what keeps them that way.
- Contract to keep: the game must remain loadable in node. Every DOM access from section 7
  needs a guard, and every DOM element the code reaches for must exist in both stubs.
