# Architecture

One file, seven sections, one state object. Line numbers refer to `index.html` as of the
current `main`.

## File map

| § | Section | Lines | Contents |
|---|---|---|---|
| 1 | config | 99-315 | `CFG`, `KINDS`, `SPRITE_SHEET`/`SPRITES`/`WORK_ANIM`/`spriteFor`, `BLD_SPRITES`/`bldSpriteFor`, `BLD`, `AGES`, `T`, `PAL`, `TEAM`, `RES_OF_TILE`, `CARRY_COLOR` — every tunable number |
| 2 | world / map | 316-514 | seeded generation (`mulberry32`, `hash2`, `makeWorld`), site search, `berryCluster`, resource tiles and sources |
| 3 | entities | 515-673 | `setAtlas`, `sourceFromTile`/`sourceFromFarm`, `workSpot`, `makeUnit`, `makeBuilding`, `rebuildBlocks`, `removeBuilding`, `workPos`, `standingSpots` |
| 4 | simulation | 674-1271 | `stepSim`/`updateUnit` (the order state machine), movement, `hitUnit`/`hitBuilding`/`autoAcquire`, economy, orders, `build`, `cancelConstruction`, `demolish`, `train`, `upgradeAge`; sub-blocks `economy helpers` (1177), `enemy AI` (1210), `toast` (1260) — **pure logic, no DOM** |
| 5 | render | 1272-1662 | `beginCanvas`, world/building/unit drawing (`drawBuildings`, `unitAnim`, `drawUnits`), ghost, drag box, minimap, HUD + command bar HTML |
| 6 | input | 1663-1813 | picking, mouse, keyboard, delegated command-bar clicks |
| 7 | boot | 1814-2017 | canvas sizing, `createState`, `resetGame`, `loadAtlas`, `boot`, the rAF loop |
| — | public surface | 2018-2037 | the `AoE2` export banner + object, `module.exports` / `window.Game` wiring |

## The `Game` object

Everything mutable lives on one object, created by `createState()` and passed into every
function — no hidden globals, which is what makes the logic testable from node:

```
Game = { world, units[], buildings[], blocks(Map buildingId -> tiles), sprites{atlas},
         res[2], age, ageBonus, cam{x,y}, keys, mouse, drag, selection[],
         selectedBuilding, groups{}, placing, started, wave, time, frame, dom{...}, view,
         minimapCache }
```

`Game.sprites.atlas` is the one place the atlas is attached (`setAtlas`,
`index.html:521`): `loadAtlas` fills it in the browser and the harnesses inject an image
there, so the renderer never has to wonder where the sheet came from.

Coordinate systems: **tile** coords (`tx`,`ty`) for the world grid, **world pixels**
(`x = tx * CFG.TILE`), **screen pixels** (`sx`) via `toWorld(e)` / camera offset. Terrain
type lookup is a flat array index (`ty * world.w + tx`).

## Simulation model

- `startLoop` drives `requestAnimationFrame`, clamps `dt` to 0.1s (tab-switch guard),
  then `stepGame(Game, dt)` → camera pan/edge-scroll → `stepSim(Game, dt)`.
- `stepSim` ticks every unit, every building (construction progress, training queue) and
  the enemy AI, then `separate()` resolves unit overlap (`CFG.UNIT_SEP`).
- Time-based, not fixed-step: tests drive it directly with a fixed `1/30` step, so
  behaviour is deterministic given the same seed (`CFG.SEED = 1337`).
- Dead units are pruned out of `Game.units`; buildings persist.

### Unit order state machine (`updateUnit`, index.html:745)

`idle` → `move` → `harvest` → `go_deposit` → (re-acquire source via `nextSource`) …
plus `build` (works on a site until `built >= 1`) and `attack` (chase to
`u.r + target.r + 4`, then swing on `atkTime` cooldown). Carry capacity is
`CFG.CARRY_MAX`; the carried resource is recorded in `u.carryRes` so `deposit()` credits
the right stockpile — that field being unset was a real bug (deposits silently vanished).

Every unit also carries its rendering state: `u.face` (`+1`/`-1`) and `u.anim`, the
activity clock behind every animation (walk, work, swing). `unitAnim(u)`
(`index.html:1403`, section 5) maps it to the sprite cell to show; `moveUnit`
(`index.html:834`) is the only writer of `u.face`, so units never flip for no reason.

### Combat

Damage comes from `KINDS[kind].atk`; ages scale it through `Game.ageBonus` (set to the age
index on upgrade, `index.html:1167`) — 1× at Dark Age, so 6 militia swings (6×11) kill a
60 hp villager. Attackers only damage the target they're ordered to attack — a unit
(`hitUnit`, `index.html:703`) or a building (`hitBuilding`, `index.html:712`, which razes it
at 0 hp via `removeBuilding`, `index.html:630`). Idle fighters acquire on their own:
`autoAcquire` (`index.html:725`) gives
them the nearest enemy unit within `CFG.ACQUIRE` tiles, else the nearest built enemy
building within `CFG.BUILDING_ACQUIRE`, and a kill immediately retargets the next one.

## Render model

Terrain tiles come from `PAL` (three variants per terrain, chosen by a per-tile hash),
trees/ore/berries are drawn as vector paths (`drawTree`, `drawOre`, `drawBerry`), and
built buildings blit their team cell from the atlas (`drawBuildings`,
`index.html:1328`); unbuilt ones keep the ghost footprint with a progress overlay while
`built < 1`, and a dry farm (empty `field`) keeps its procedural stubble.

Units come from `assets/sprites.png`: `SPRITES` (`index.html:160`) maps every kind to
its animation cells and `spriteFor(kind, team, anim)` (`index.html:203`) resolves one;
`BLD_SPRITES` (`index.html:217`) holds the built-building cells (rows y48+ of the same
sheet) and `bldSpriteFor(kind, team)` (`index.html:235`) resolves those, each cell drawn
at the building's exact footprint. `unitAnim(u)` (`index.html:1403`) decides which
animation a unit plays from its order —
villagers farm/chop/mine (a/b frames per harvested resource) plus idle/walk, militia
idle/walk plus attack_a/attack_b — and `drawUnits` (`index.html:1419`) blits the cell at
integer pixels with `drawImage` and mirrors it with `scale(-1, 1)` when `u.face` is `-1`.
The 1px walk bob applies only to walk cells; work/swing animations animate through their
own a/b frames. The old team-coloured disc/square drawing stays as the
fallback whenever no atlas is loaded. On top of the sprite: selection ring, health bar and
the carry dot tinted by `CARRY_COLOR`.

Canvases go through `beginCanvas(canvas, w, h)`; sizes come from `sizeW/sizeH(dom)` with
node-safe fallbacks (`view_W/view_H`, `index.html:1839`). The HUD (resource bar, info
panel, command bar, queue) is DOM, rebuilt every frame from `infoHtml/commandsHtml/queueHtml`
strings.

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
re-bound each frame.

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
- `tools/gen-atlas.js` — renders the `SPRITES` table into `assets/sprites.png`
  deterministically (same table → same bytes), so the committed PNG can be diffed in
  review instead of trusted.
- Contract to keep: the game must remain loadable in node. Every DOM access from section 7
  needs a guard, and every DOM element the code reaches for must exist in both stubs.
