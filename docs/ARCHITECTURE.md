# Architecture

One file, seven sections, one state object. Line numbers refer to `index.html` as of the
current `main`.

## File map

| § | Section | Lines | Contents |
|---|---|---|---|
| 1 | config | 99-186 | `CFG`, `KINDS`, `SPRITE_SHEET`/`SPRITES`/`spriteFor`, `BLD`, `AGES`, `T`, `PAL`, `TEAM`, `RES_OF_TILE`, `CARRY_COLOR` — every tunable number |
| 2 | world / map | 187-337 | seeded generation (`mulberry32`, `hash2`, `makeWorld`), site search, resource tiles and sources |
| 3 | entities | 338-456 | `setAtlas`, `sourceFromTile`/`sourceFromFarm`, `workSpot`, `makeUnit`, `makeBuilding`, `rebuildBlocks`, `workPos` |
| 4 | simulation | 457-865 | `stepSim`/`updateUnit` (the order state machine), movement, economy, orders, `build`, `train`, `upgradeAge`; sub-blocks `economy helpers` (775), `enemy AI` (807), `toast` (854) — **pure logic, no DOM** |
| 5 | render | 866-1206 | `beginCanvas`, world/building/unit drawing, ghost, drag box, minimap, HUD + command bar HTML |
| 6 | input | 1207-1352 | picking, mouse, keyboard, delegated command-bar clicks |
| 7 | boot | 1353-1550 | canvas sizing, `createState`, `resetGame`, `loadAtlas`, `boot`, the rAF loop |
| — | public surface | 1551-1567 | the `AoE2` export banner + object, `module.exports` / `window.Game` wiring |

## The `Game` object

Everything mutable lives on one object, created by `createState()` and passed into every
function — no hidden globals, which is what makes the logic testable from node:

```
Game = { world, units[], buildings[], blocks(Map buildingId -> tiles), sprites{atlas},
         res[2], age, ageBonus, cam{x,y}, keys, mouse, drag, selection[],
         selectedBuilding, groups{}, placing, started, wave, time, frame, dom{...}, view,
         minimapCache }
```

`Game.sprites.atlas` is the one place the unit atlas is attached (`setAtlas`,
`index.html:343`): `loadAtlas` fills it in the browser and the harnesses inject an image
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

### Unit order state machine (`updateUnit`, index.html:485)

`idle` → `move` → `harvest` → `go_deposit` → (re-acquire source via `nextSource`) …
plus `build` (works on a site until `built >= 1`) and `attack` (chase to
`u.r + target.r + 4`, then swing on `atkTime` cooldown). Carry capacity is
`CFG.CARRY_MAX`; the carried resource is recorded in `u.carryRes` so `deposit()` credits
the right stockpile — that field being unset was a real bug (deposits silently vanished).

Every unit also carries its rendering state: `u.face` (`+1`/`-1`) and `u.anim` (seconds
spent walking). Both are set by `moveUnit` (`index.html:561`) and nothing else, so an
idle unit's pose stays frozen instead of animating on the spot.

### Combat

Damage comes from `KINDS[kind].atk`; ages scale it through `Game.ageBonus` (set to the age
index on upgrade, `index.html:765`) — 1× at Dark Age, so 6 militia swings (6×11) kill a
60 hp villager. Attackers only damage the target they're ordered to attack.

## Render model

Terrain tiles come from `PAL` (three variants per terrain, chosen by a per-tile hash),
trees/ore/berries are drawn as vector paths (`drawTree`, `drawOre`, `drawBerry`), and
buildings are footprints with team colour and a progress overlay while `built < 1`.

Units come from `assets/sprites.png`: `spriteFor(kind, team)` (`index.html:140`) names the
atlas cell, and `drawUnits` (`index.html:971`) blits it at integer pixels with
`drawImage`, mirrors it with `scale(-1, 1)` when `u.face` is `-1`, and offsets it 1px on an
8 Hz walk clock driven by `u.anim`. The old team-coloured disc/square drawing stays as the
fallback whenever no atlas is loaded. On top of the sprite: selection ring, health bar and
the carry dot tinted by `CARRY_COLOR`.

Canvases go through `beginCanvas(canvas, w, h)`; sizes come from `sizeW/sizeH(dom)` with
node-safe fallbacks (`view_W/view_H`, `index.html:1378`). The HUD (resource bar, info
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
