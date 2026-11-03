# Architecture

One file, seven sections, one state object. Line numbers refer to `index.html` as of the
current `main`.

## File map

| § | Section | Lines | Contents |
|---|---|---|---|
| 1 | config | 99-162 | `CFG`, `KINDS`, `BLD`, `AGES`, `T`, `PAL`, `TEAM`, `RES_OF_TILE`, `CARRY_COLOR` — every tunable number |
| 2 | world / map | 163-313 | seeded generation (`mulberry32`, `hash2`, `makeWorld`), site search, resource tiles and sources |
| 3 | entities | 314-421 | `makeUnit`, `makeBuilding`, `rebuildBlocks`, `workPos` |
| 4 | simulation | 422-809 | `stepSim`/`updateUnit` (the order state machine), movement, economy, orders, `build`, `train`, `upgradeAge`; sub-blocks `economy helpers` (719), `enemy AI` (751), `toast` (798) — **pure logic, no DOM** |
| 5 | render | 810-1137 | `beginCanvas`, world/building/unit drawing, ghost, drag box, minimap, HUD + command bar HTML |
| 6 | input | 1138-1283 | picking, mouse, keyboard, delegated command-bar clicks |
| 7 | boot | 1284-1446 | canvas sizing, `createState`, `resetGame`, `boot`, the rAF loop |
| — | public surface | 1447-1464 | the `AoE2` export object + `module.exports` / `window.Game` wiring |

## The `Game` object

Everything mutable lives on one object, created by `createState()` and passed into every
function — no hidden globals, which is what makes the logic testable from node:

```
Game = { world, units[], buildings[], blocks(Map buildingId -> tiles), res[2], age,
         ageBonus, cam{x,y}, keys, mouse, drag, selection[], selectedBuilding, groups{},
         placing, started, wave, time, frame, dom{...}, view, minimapCache }
```

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

### Unit order state machine (`updateUnit`, index.html:450)

`idle` → `move` → `harvest` → `go_deposit` → (re-acquire source via `nextSource`) …
plus `build` (works on a site until `built >= 1`) and `attack` (chase to
`u.r + target.r + 4`, then swing on `atkTime` cooldown). Carry capacity is
`CFG.CARRY_MAX`; the carried resource is recorded in `u.carryRes` so `deposit()` credits
the right stockpile — that field being unset was a real bug (deposits silently vanished).

### Combat

Damage comes from `KINDS[kind].atk`; ages scale it through `Game.ageBonus` (set to the age
index on upgrade, `index.html:715`) — 1× at Dark Age, so 6 militia swings (6×11) kill a
60 hp villager. Attackers only damage the target they're ordered to attack.

## Render model

No image assets. Terrain tiles come from `PAL` (three variants per terrain, chosen by a
per-tile hash), trees/ore/berries are drawn as vector paths (`drawTree`, `drawOre`,
`drawBerry`). Units are team-coloured discs/squares with a selection ring, a health bar
and a carry dot tinted by `CARRY_COLOR`. Buildings are footprints with team colour and a
progress overlay while `built < 1`. Canvases go through `beginCanvas(canvas, w, h)`; sizes
come from `sizeW/sizeH(dom)` with node-safe fallbacks (`view_W/view_H`, index.html:1300).
The HUD (resource bar, info panel, command bar, queue) is DOM, rebuilt every frame from
`infoHtml/commandsHtml/queueHtml` strings.

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
  every draw call), requires it, then asserts invariants. It never opens a browser.
- `tools/render-preview.js` — same stub, except the view canvas comes from
  `@napi-rs/canvas`, so `renderFrame` paints real pixels; writes `preview.png`. Falls back
  to the stub-only path (just proving the draw calls run) when the package is absent.
- Contract to keep: the game must remain loadable in node. Every DOM access from section 7
  needs a guard, and every DOM element the code reaches for must exist in both stubs.
