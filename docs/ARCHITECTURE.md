# Architecture

One file, seven sections, one state object. Line numbers refer to `index.html` as of the
current `main`; `data/` (the vendored AoE2 stat tables and sprite frames — `data/README.md`
names the sources) is what section 1's generated tables and `assets/sprites.png` are built from.

## File map

| § | Section | Lines | Contents |
|---|---|---|---|
| 1 | config | 107-350 | `CFG`, `KINDS`, `SPRITE_SHEET`/`SPRITES`/`WORK_ANIM`/`spriteFor`, `BLD_SPRITES`/`bldSpriteFor`, `BLD`, `AGES`, `T`, `PAL`, `TEAM`, `RES_OF_TILE`, `CARRY_COLOR` — every tunable number; `CFG`/`KINDS`/`BLD` are generated from `data/` |
| 2 | world / map | 351-549 | seeded generation (`mulberry32`, `hash2`, `makeWorld`), site search, `berryCluster`, resource tiles and sources |
| 3 | entities | 550-730 | `setAtlas`, `sourceFromTile`/`sourceFromFarm`, `workSpot`, `makeUnit`, `makeBuilding`, `rebuildBlocks`, `removeBuilding`/`setResult`, `workPos`, `standingSpots` |
| 4 | simulation | 731-1647 | `stepSim`/`updateUnit` (the order state machine), `findPath`/`stepToward`/`moveUnit`/`standTarget`/`formationSlots` (the pathfinding block), `hitUnit`/`hitBuilding`/`autoAcquire`, `spawnArrow`/`updateProjectiles`/`stepBuildingAttacks`, economy, orders, `build`, `cancelConstruction`, `demolish`, `train`, `upgradeAge`; sub-blocks `pathfinding` (981), `economy helpers` (1553), `enemy AI` (1586), `toast` (1636) — **pure logic, no DOM** |
| 5 | render | 1648-2072 | `beginCanvas`, world/building/unit drawing (`drawBuildings`, `unitAnim`, `drawUnits`, `drawProjectiles`), ghost, drag box, minimap, HUD + command bar + result-overlay HTML |
| 6 | input | 2073-2232 | picking, mouse, keyboard, delegated command-bar clicks |
| 7 | boot | 2233-2449 | canvas sizing, `createState`, `resetGame`, `loadAtlas`, `boot`, the rAF loop |
| — | public surface | 2450-2470 | the `AoE2` export banner + object, `module.exports` / `window.Game` wiring |

## The `Game` object

Everything mutable lives on one object, created by `createState()` and passed into every
function — no hidden globals, which is what makes the logic testable from node:

```
Game = { world, units[], buildings[], projectiles[], blocks(Map buildingId -> tiles), sprites{atlas},
         res[2], age, ageBonus, rnd(mulberry32(CFG.SEED)), cam{x,y}, keys, mouse, drag, selection[],
         selectedBuilding, groups{}, placing, started, wave, time, frame, mapEpoch(route cache epoch),
         result('victory' | 'defeat' | null), dom{...}, view, minimapCache }
```

`Game.sprites.atlas` is the one place the atlas is attached (`setAtlas`,
`index.html:556`): `loadAtlas` fills it in the browser and the harnesses inject an image
there, so the renderer never has to wonder where the sheet came from.

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

### Unit order state machine (`updateUnit`, index.html:870)

`idle` → `move` → `harvest` → `go_deposit` → (re-acquire source via `nextSource`) …
plus `build` (works on a site until `built >= 1`) and `attack` (chase to
`u.r + target.r + 4`, then swing on `atkTime` cooldown). Carry capacity is
`CFG.CARRY_MAX`; the carried resource is recorded in `u.carryRes` so `deposit()` credits
the right stockpile — that field being unset was a real bug (deposits silently vanished).

Every unit also carries its rendering state: `u.face` (`+1`/`-1`) and `u.anim`, the
activity clock behind every animation (walk, work, swing). `unitAnim(u)`
(`index.html:1779`, section 5) maps it to the sprite cell to show; `moveUnit`
(`index.html:1123`) is the only writer of `u.face`, so units never flip for no reason.

### Pathfinding (`findPath`, `index.html:1033`)

A\* over the tiles `walkable` answers for: uniform cost, 8-connected, and a diagonal never
cuts between two solid tiles — so routes bend around water, forest and footprints instead
of sliding into them. `moveUnit` (`index.html:1123`) walks the route's tile centres plus
the exact ordered point at `u.speed` px/s (`stepToward`, `index.html:1082`) and keeps the
answer on the unit (`u.path` / `u.pathFor` / `u.pathAt`): a route is valid for one goal
tile and one version of the world, so a changed goal or a bumped `Game.mapEpoch` (a
building went up, a tile ran dry) drops it and the next step re-paths.
`CFG.ASTAR_MAX_NODES` caps a single query, and an unreachable goal costs one capped query
instead of one per tile. `standTarget` (`index.html:1172`) turns a solid order target into
a standable tile — the ordered point itself when it is walkable or already within the
order's arrival radius, else `workPos` for a building / `workSpot` for a tile — so every
order kind runs one pipeline, order → standTarget → findPath → step, and
`formationSlots` (`index.html:1193`) hands a group's move orders one distinct tile each,
the ranks that replaced the golden-angle `spread`.

### Combat

Damage comes from `KINDS[kind].atk`; ages scale it through `Game.ageBonus` (set to the age
index on upgrade, `index.html:1543`) — 1× at Dark Age, so 7 militia swings (7×4) fell a
25 hp villager. Attackers only damage the target they're ordered to attack — a unit
(`hitUnit`, `index.html:763`) or a building (`hitBuilding`, `index.html:836`, which razes it
at 0 hp via `removeBuilding`, `index.html:672` — the one exit that also runs `setResult`
(`index.html:688`), the win/lose rule). Idle fighters acquire on their own: `autoAcquire`
(`index.html:849`) gives them the nearest enemy unit within their own `KINDS[kind].range`
tiles (a melee unit falls back to `CFG.ACQUIRE`), else the nearest built enemy building
within `CFG.BUILDING_ACQUIRE`, and a kill immediately retargets the next one.
How a hit is delivered depends on `KINDS[kind].atkType`: `'melee'` swings at contact
every `atkTime`; `'ranged'` halts at `range * CFG.TILE` and, every `reload` seconds,
`spawnArrow` (`index.html:778`) puts an arrow in `Game.projectiles` that flies at
`CFG.PROJ_SPEED` px/s and resolves through `updateProjectiles` (`index.html:793`) — one
arrow, one mark, `accuracy` % chance to land, deleted either way. Built buildings with
`attack > 0` (Town Center 5, LOS 8) shoot the same way from `stepBuildingAttacks`
(`index.html:818`).

## Render model

Terrain tiles come from `PAL` (three variants per terrain, chosen by a per-tile hash),
trees/ore/berries are drawn as vector paths (`drawTree`, `drawOre`, `drawBerry`), and
built buildings blit their team cell from the atlas (`drawBuildings`,
`index.html:1704`); unbuilt ones keep the ghost footprint with a progress overlay while
`built < 1`, and a dry farm (empty `field`) keeps its procedural stubble.

Units come from `assets/sprites.png`: `SPRITES` (`index.html:177`) maps every kind to
its animation cells and `spriteFor(kind, team, anim)` (`index.html:230`) resolves one;
`BLD_SPRITES` (`index.html:244`) holds the built-building cells of the same sheet and
`bldSpriteFor(kind, team)` (`index.html:264`) resolves those, each cell drawn at the
building's exact footprint. `unitAnim(u)` (`index.html:1779`) decides which animation a
unit plays from its order — villagers farm/chop/mine (a/b frames per harvested resource)
plus idle/walk, militia and archer idle/walk plus attack_a/attack_b — and `drawUnits`
(`index.html:1795`) blits the cell at integer pixels with `drawImage` and mirrors it with
`scale(-1, 1)` when `u.face` is `-1`.
The 1px walk bob applies only to walk cells; work/swing animations animate through their
own a/b frames. The old team-coloured disc/square drawing stays as the
fallback whenever no atlas is loaded. On top of the sprite: selection ring, health bar and
the carry dot tinted by `CARRY_COLOR`.

Canvases go through `beginCanvas(canvas, w, h)`; sizes come from `sizeW/sizeH(dom)` with
node-safe fallbacks (`view_W/view_H`, `index.html:2258`). The HUD (resource bar, info
panel, command bar, queue) is DOM, rebuilt every frame from `infoHtml/commandsHtml/queueHtml`
strings; the game-over overlay is `resultHtml` (`index.html:1972`) written into `#result`
and hidden again by its `show` class the moment `Game.result` goes back to null.

## Input model

`attachInput(Game, doc)` registers `mousemove`, `mousedown`, `mouseup`, `contextmenu`,
`keydown`, `keyup`. `mousemove` updates `Game.mouse` (the edge-scroll state) only while
the pointer is over the canvas or mid-drag — coords measured on the header/footer set it
to `null` instead, so hovering HUD chrome no longer reads as "cursor on a screen edge"
and pans the camera. Click-vs-drag is decided by a 4px threshold; mixed drag selections
collapse to villagers (AoE2 behaviour). Commands: left select, right click issue order,
WASD/arrows pan, `Ctrl+1..9` set group, `1..9` recall, `H`/`F`/`B` arm house/farm/barracks
placement, `T` upgrade age, `Esc` clears placement then selection. The command bar is
rebuilt every frame, so its clicks are **delegated to the parent container** rather than
re-bound each frame; `buttonAt` (`index.html:2100`) is the single button lookup that delegate
and the `#result` overlay's listener (wired in `boot`, `index.html:2368`) share.

## Test harness design

- `tools/headless-check.js` — reads `index.html`, extracts the `<script>` body into a temp
  `.js`, installs a stub `document`/`window` (elements with `textContent`/`innerHTML`
  accessors, cached per id, `fire()` to dispatch events, a Proxy 2D context that swallows
  every draw call), requires it, then asserts invariants. It never opens a browser. Node
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
  `CFG`/`KINDS`/`BLD` against `data/units.json` + `data/buildings.json`, exiting 1 with one
  line per drifted field; `--write` regenerates the three section-1 blocks from `data/`. The
  numbers are vendored rather than hand-typed, and this check is what keeps them that way.
- Contract to keep: the game must remain loadable in node. Every DOM access from section 7
  needs a guard, and every DOM element the code reaches for must exist in both stubs.
