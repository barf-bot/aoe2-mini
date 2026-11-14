# Architecture

A static page, fifteen plain scripts, one state object. `index.html` holds the markup and
the ordered `<script src>` list; the code lives in `src/`. There is no build step and no
module system: the scripts are classic scripts that share one global scope, so a function
declared in one file is callable from every other. Load order only matters for top-level
statements — the constants in `src/config.js` (first) and the export + boot call in
`src/main.js` (last); everything in between is function declarations.

`data/` (the vendored AoE2 stat tables and sprite frames — `data/README.md` names the
sources) is what the generated tables in `src/config.js` and `assets/sprites.png` are built
from.

## File map

In load order. The **DOM** column is a rule, not a description: the files marked `no` must
never name `document`, `window`, `localStorage`, `Image` or `AudioContext`
(`tools/audit-line-refs.js` fails if they do) — that is what lets node drive the whole
simulation.

| File | DOM | Contents |
|---|---|---|
| `index.html` | — | the markup (the `<head>` with its inline SVG favicon, header, `#view` + `#minimap` canvases, `#hud` footer) and the script list |
| `src/style.css` | — | all styles; the `max-width:720px` phone block is last so it wins the cascade |
| `src/config.js` | no | `CFG`, `KINDS`, `SPRITE_SHEET`/`SPRITES`/`WORK_ANIM`/`spriteFor`, `BLD_SPRITES`/`bldSpriteFor`, `BLD`, `TECHS`, `AGES`, `SAVE_PATH`, `MUTE_PATH`, `LONG_PRESS_MS`/`LONG_PRESS_SLOP`, `T`, `PAL`, `TEAM`, `RES_OF_TILE`, `CARRY_COLOR`, `SFX` — every tunable number; `CFG`/`KINDS`/`BLD`/`TECHS` and the sprite tables are generated from `data/` |
| `src/world.js` | no | seeded generation (`mulberry32`, `hash2`, `makeWorld`), site search (`findSite`), `berryCluster`, resource tiles (`tileRes`) |
| `src/entities.js` | no | `setAtlas`, `sourceFromTile`/`sourceFromFarm`, `workSpot`, `makeUnit` (the unit shape: `KINDS` stats, `order`, the route cache and `garrisonedIn`), `makeBuilding`, `rebuildBlocks`, `removeBuilding`/`setResult`, `workPos`, `standingSpots` |
| `src/sim.js` | no | `stepSim`/`updateUnit` (the order state machine — its `build` branch ends a site by calling `promoteBuilding` when the site is an upgrade in progress, and its first guard parks a unit whose `garrisonedIn` is set instead of moving him), combat math (`unitAttack`/`unitArmor`/`hitUnit`/`hitBuilding`/`autoAcquire`/`attackableAsEnemy`/`targetableAsEnemy`), projectiles (`spawnArrow`/`updateProjectiles`/`stepBuildingAttacks`) |
| `src/movement.js` | no | `tileOf`, A\* (`findPath`), `stepToward`/`moveUnit`/`standTarget`, `formationSlots`, `walkable`, `reachOf`, `separate` |
| `src/economy.js` | no | gathering (`workersOnTile`, `findDropoff`, `deposit`, `depleteTile`, `nextSource`, `resumeGather`), `popCap`/`popUsed`, `selectedUnits`, `canAfford`/`spend`/`refund` |
| `src/commands.js` | no | everything a player or the AI can order: `orderForUnit`/`issueOrder`, `build`, `canPlaceAt`, `cancelConstruction`, `demolish`, `siteFree`, `train`, `researchTech`, `trade`, `upgradeAge`, `upgradeBuilding`/`promoteBuilding`, `garrisonUnits`/`leaveBuilding`, plus `toast` |
| `src/ai.js` | no | `aiStep` — the enemy village, acting through the same commands |
| `src/save.js` | guarded | `storageGet`/`storageSet` (the one door to `localStorage`, node-safe), `encodeState`/`decodeState`, `markDirty`, `saveGame`/`loadGame`, `migrate`/`validState` |
| `src/sound.js` | guarded | `playSfx` (WebAudio synth of the `SFX` rows), `isMuted`/`setMuted`/`applyMuteButton` |
| `src/render.js` | yes | `beginCanvas`, world/building/unit drawing (`drawBuildings`, `unitAnim`, `drawUnits`, `drawProjectiles`), ghost, drag box, minimap, `renderFrame` |
| `src/hud.js` | yes | the uniform HUD frame (`renderHud`/`hudState`/`hudHtml` with `infoHtml`/`commandsHtml`/`queueHtml`) and `resultHtml` |
| `src/input.js` | yes | picking (`pickUnit`/`pickBuilding`/`unitsInBox`), the pure `pointerDown`/`pointerUp` both pointer listeners delegate to, `attachInput`'s pointer/keyboard/mute/command-bar/minimap listeners, `buttonAt`, `leaveSelected`, `centerCamOnFraction`, `clamp` |
| `src/boot.js` | yes | canvas sizing, `createState`, `resetGame`, `loadAtlas`, `boot` (mute-button sync first), the rAF loop (`startLoop`/`stepGame`) |
| `src/main.js` | yes | the public surface — the `AoE2` object every tool reads (the config tables, `createState`/`boot`, the command, combat, economy, save and HUD builders, the `pickUnit`/`unitsInBox` pickers and the two targetability predicates) — and the `window.Game = boot(document)` call |

"Guarded" means the file reaches for a browser API only behind a `typeof` check, so it
loads and runs in node. Adding a file: create it in `src/`, add its `<script src>` tag to
`index.html` in the right place, add a row here. Nothing else needs to know.

Older documents in `docs/plans/` and older `docs/CHANGELOG.md` entries predate the split and
cite `index.html:NNN` and "section N" — those are history, not current references.

## The `Game` object

Everything mutable lives on one object, created by `createState()` and passed into every
function — no hidden globals, which is what makes the logic testable from node:

```
Game = { world, units[](a unit: id, kind, team, x, y, hp/maxHp, stats from KINDS, order, slot, path/pathAt/pathFor/pathEpoch, garrisonedIn), buildings[], projectiles[], blocks(Map buildingId -> tiles), sprites{atlas},
         res[2], age[2], ageBonus[2], techs[2](per-team Sets of researched tech ids), rnd(mulberry32(CFG.SEED)), cam{x,y}, keys, mouse, drag, selection[],
         selectedBuilding, groups{}, placing, started, wave, time, frame, autosaveAt(next autosave write),
         mapEpoch(route cache epoch), pathQueries(findPath calls),
         result('victory' | 'defeat' | null), dom{...}, view, minimapCache, sound }
```

`Game.sprites.atlas` is the one place the atlas is attached (`setAtlas`,
`src/entities.js:8`): `loadAtlas` fills it in the browser and the harnesses inject an image
there, so the renderer never has to wonder where the sheet came from.

Persistence: the plain half of that object is the save payload — `encodeState`
(`src/save.js:77`) picks exactly the fields `saveGame` writes, the per-runtime caches (`dom`,
`view`, `mm`, `mmBase`, `toastMsg`, `toastAt`, `pingAt`, `frame`, `pathQueries`, `sprites`, `rnd`,
`mapEpoch`, `autosaveAt`, `sound`) stay out of it and are rebuilt on load — so one object shape can be
written to `localStorage` and read back into a fresh `createState` (`src/boot.js:38`). The
ruleset itself is `docs/GAME_RULES.md` §Save / load; the parts are below in
`### Save / load` (`saveGame`, `src/save.js:123`).

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

### Unit order state machine (`updateUnit`, src/sim.js:190)

`idle` → `move` → `harvest` → `go_deposit` → (re-acquire source via `nextSource`) …
plus `build` (works on a site until `built >= 1`, and promotes it through `promoteBuilding`
(`src/commands.js:318`) when the site is an upgrade in progress) and `attack` (chase to
`u.r + target.r + 4`, then swing on `atkTime` cooldown). Carry capacity is
`CFG.CARRY_MAX`; the carried resource is recorded in `u.carryRes` so `deposit()` credits
the right stockpile — that field being unset was a real bug (deposits silently vanished). A
`move` order can also carry `garrison: <building id>` (`garrisonUnits`, `src/commands.js:363`):
the garrison walk, and the only order `updateUnit` runs for a unit with `garrisonedIn` set —
retiring it on arrival at the ring tile is the single place that order ends
(docs/plans/2026-11-13-garrison.md).

Every unit also carries its rendering state: `u.face` (`+1`/`-1`) and `u.anim`, the
activity clock behind every animation (walk, work, swing), plus the `atSite` mark a
`build` order gets from `updateUnit` (`src/sim.js:190`) the moment its builder stands on
the site's ring tile — before it he walks, after it he hammers (docs/TODO.md P1-8).
`unitAnim(u)` (`src/render.js:140`) maps it to the sprite cell to show; `moveUnit`
(`src/movement.js:212`) is the only writer of `u.face`, so units never flip for no reason.

### Pathfinding (`findPath`, `src/movement.js:63`)

A\* over the tiles `walkable` answers for: 8-connected, every step costing the ground it
walks (`stepCost`, `src/movement.js:19` — 1 straight, √2 diagonal) under the matching
octile heuristic, and a diagonal never
cuts between two solid tiles — so routes bend around water, forest and footprints instead
of sliding into them. `moveUnit` (`src/movement.js:212`) picks the waypoint to walk to
with `routeAhead` (`src/movement.js:171`) — the furthest one a `lineClear`
(`src/movement.js:137`) straight line reaches, so a route is walked as lines and not as
its staircase — and steps at `u.speed` px/s (`stepToward`, `src/movement.js:116`), the
exact ordered point being the route's last waypoint. The
answer is cached on the unit (`u.path` / `u.pathFor` / `u.pathAt`): a route is valid for one goal
tile and one version of the world, so a changed goal or a bumped `Game.mapEpoch` (a
building went up, a tile ran dry) drops it and the next step re-paths.
`CFG.ASTAR_MAX_NODES` caps a single query, and an unreachable goal costs one capped query
answer instead of one per tile. `standTarget` (`src/movement.js:259`) turns a solid order target into
a standable tile — the ordered point itself when it is walkable or already within the
order's arrival radius, else `workPos` for a building (asked with the unit, so it answers
with the ring tile nearest to him) / `workSpot` for a tile — so every
order kind runs one pipeline, order → standTarget → findPath → step, and
`formationSlots` (`src/movement.js:280`) hands a group's move orders one distinct tile each,
the ranks that replaced the golden-angle `spread`.

### Combat

Damage math lives in one place — the `combat math` sub-block (`unitAttack`,
`src/sim.js:55`; `unitArmor`, `src/sim.js:69`): a unit's attack is the row's
`KINDS[kind].atk` times the age multiplier `1 + 0.25 * ageBonus[team]` — the age and its
bonus belong to the attacker's own team (docs/TODO.md P1-11: team 1's half is 0 until the
AI can research, so the player's Castle Age and Forge never arm the units shooting at
them) — 1× at Dark Age, so 7 militia swings (7×4) fell a 25 hp villager, plus that
team's researched techs' attack for the damage class (melee for a swing, pierce for an
arrow or a ranged unit); a built shooter uses `BLD[kind].attack` and gets no unit tech.
The defender's armour is the row's `meleeArmor`/`pierceArmor` plus its own team's techs'
flat armour of that class, and `hitUnit` (`src/sim.js:81`) lands `max(1, attack − armour)` —
armour softens a hit but never absorbs it below 1. Attackers only damage the target
they're ordered to attack — a unit (`hitUnit`) or a building (`hitBuilding`,
`src/sim.js:156`, which razes it at 0 hp via `removeBuilding`, `src/entities.js:124` — the one
exit that also runs `setResult` (`src/entities.js:141`), the win/lose rule) — and the unit half
of that same rule, `targetableAsEnemy` (`src/sim.js:326`: alive, another team, not inside a
building), is what `autoAcquire`, `orderForUnit`, `issueOrder` and the AI's `nearestEnemy` read
instead of re-typing the test (docs/plans/2026-11-13-garrison.md). Idle fighters
acquire on their own: `autoAcquire` (`src/sim.js:169`) gives them the nearest enemy unit
within their own `KINDS[kind].range` tiles (a melee unit falls back to `CFG.ACQUIRE`),
else the nearest built enemy building within `CFG.BUILDING_ACQUIRE`, and a kill
immediately retargets the next one. How a hit is delivered depends on
`KINDS[kind].atkType`: `'melee'` swings at contact every `atkTime`; `'ranged'` halts at
`range * CFG.TILE` and, every `reload` seconds, `spawnArrow` (`src/sim.js:97`) puts an
arrow in `Game.projectiles` that flies at `CFG.PROJ_SPEED` px/s and resolves through
`updateProjectiles` (`src/sim.js:111`) — one arrow, one mark, `accuracy` % chance to
land, deleted either way. Built buildings with `attack > 0` (Town Center 5, LOS 8) shoot
the same way from `stepBuildingAttacks` (`src/sim.js:136`).

### Save / load (`saveGame`, `src/save.js:123`)

`src/save.js` owns the whole contract. `encodeState` (`src/save.js:77`) is the single owner of the
schema — the field list the harness pins as `SAVE_FIELDS` (`tools/checks/10-reset-save.js:53`) —
`saveGame(path, Game, at = now())` (`src/save.js:123`) serialises `{ version, seed, writtenAt,
state }` and hands the string to `storageSet` (`src/save.js:18`), and
`loadGame(path, Game, raw = storageGet(path))` (`src/save.js:252`) reads the slot back. The
shipped signature is that three-argument one rather than the design's `loadGame(path, raw)`: the
target `Game` sits in the middle so a test — or `boot` (`src/boot.js:138`) opening the page — can
load a slot into a game that already exists. `migrate` (`src/save.js:137`) — it takes v2 and
converts a v1 payload's global `age` / `ageBonus` / `techs` into the per-team pair — and
`validState` (`src/save.js:152`) gate the payload (the version, then the shape); every refusal
ends in `resetGame(Game); return false`; `decodeState` (`src/save.js:203`) then restores in dependency
order — world → buildings → `blocks` + `rebuildBlocks` (`src/entities.js:102`) → `mapEpoch++` → units
(with `order.src` rebuilt through `sourceFromTile` (`src/entities.js:16`) / `sourceFromFarm`,
`src/entities.js:29`) → projectiles (`t` relinked by `decodeProjectile`, `src/save.js:190`) → the
id-only fields → `techs` (the per-team pair of Sets) and `rnd` (rebuilt from the envelope's seed). The schedule is
`markDirty(Game)` (`src/save.js:113`) — pull `Game.autosaveAt` earlier, never later — and
`stepGame` after `stepSim` (`src/boot.js:233-235`) is the only writer, so the write carries the
frame it just ran and `stepSim` itself never touches storage. The ruleset is in
`docs/GAME_RULES.md` §Save / load.

## Render model

Terrain tiles come from `PAL` (three variants per terrain, chosen by a per-tile hash),
trees/ore/berries are drawn as vector paths (`drawTree`, `drawOre`, `drawBerry`), and
built buildings blit their team cell from the atlas (`drawBuildings`,
`src/render.js:64`); the `noSprite` kinds (Blacksmith, Market, Watch Tower and Barricade)
have no atlas cell and draw the flat team-coloured footprint instead, so a new building
never grows `assets/sprites.png`; a site (`built < 1`) is the same drawing faded in --
`globalAlpha = .2 + .8 * built`, so what you watch appear is the building you paid for
instead of a generic footprint (docs/TODO.md P1-8) -- and a dry farm (empty `field`)
keeps its procedural stubble.

Units come from `assets/sprites.png`: `SPRITES` (`src/config.js:77`) maps every kind to
its animation cells and `spriteFor(kind, team, anim)` (`src/config.js:130`) resolves one;
`BLD_SPRITES` (`src/config.js:144`) holds the built-building cells of the same sheet and
`bldSpriteFor(kind, team)` (`src/config.js:164`) resolves those, each cell drawn at the
building's exact footprint. `unitAnim(u)` (`src/render.js:140`) decides which animation a
unit plays from its order — villagers farm/chop/mine (a/b frames per harvested resource)
plus idle/walk, militia and archer idle/walk plus attack_a/attack_b. `drawUnits`
(`src/render.js:156`) blits the cell at integer pixels with `drawImage`, placing the
cell's feet anchor (`ax`/`ay`, measured from the frame's opaque box by
`tools/gen-atlas.js`) on the unit and mirroring it with `scale(-1, 1)` when `u.face`
is `-1`.
The 1px walk bob applies only to walk cells; work/swing animations animate through their
own a/b frames. The old team-coloured disc/square drawing stays as the
fallback whenever no atlas is loaded. On top of the sprite: selection ring, health bar and
the carry dot tinted by `CARRY_COLOR`.

Canvases go through `beginCanvas(canvas, w, h)`; sizes come from `sizeW/sizeH(dom)` with
node-safe fallbacks (`view_W/view_H`, `src/boot.js:27-28`). The footer is one fixed-height
element owned by `hudHtml` (`src/hud.js:50`): `renderHud` (`src/hud.js:4`) stamps it
with the `data-state` answered by `hudState` (`group` / `units` / `building` / `none`) and
writes the same three panels — `infoHtml`, `commandsHtml`, `queueHtml` — in the same order
for every selection, caching the string in `Game.dom.hudLast` so a frame that changed
nothing writes no `innerHTML` at all (comparing against `el.innerHTML` instead never
matches: the browser serialises `disabled` as `disabled=""`), so the frame never resizes
the map and the CSS can pin it to
`height:var(--footer-h)`, 94 px, with every panel a fixed `overflow:hidden` box (the
row-based button grid). The game-over overlay is `resultHtml` (`src/hud.js:59`) written
into `#result`, cached the same way as `Game.dom.resultLast`, and hidden again by its
`show` class the moment `Game.result` goes back to null.

## Input model

`attachInput(Game, doc)` registers `mousemove`, `mousedown`, `mouseup`, `contextmenu`,
`keydown`, `keyup`. `mousemove` updates `Game.mouse` (the edge-scroll state) only while
the pointer is over the canvas or mid-drag — coords measured on the header/footer set it
to `null` instead, so hovering HUD chrome no longer reads as "cursor on a screen edge"
and pans the camera. Click-vs-drag is decided by a 4px threshold; mixed drag selections
collapse to villagers (AoE2 behaviour). Commands: left select, right click issue order,
WASD/arrows or two fingers pan (`fingerMove`, `src/input.js:108`), `Ctrl+1..9` set group, `1..9` recall, and `H`/`F`/`B`/`L`/`G`/`M`/`R`/`K`/`E`/`C`/`Q`
arm every placeable building, `T` upgrade age, `Esc` clears placement then selection. The command bar is
rebuilt every frame, so its clicks are **delegated to its parent** — `Game.dom.commands ||
Game.dom.hud`, the footer in a browser — and `buttonAt` (`src/input.js:121`) is the single
button lookup that delegate and the `#result` overlay's listener (wired in `boot`,
`src/boot.js:179`).

## Test harness design

Every tool loads the game through `tools/lib/load-game.js`, which reads the `<script src>`
list out of `index.html` and runs each file with `vm` under its real filename — so node
executes exactly what the browser does, in the same order, and stack traces point at
`src/*.js`. `loadGame()` runs the scripts in the process's own global scope (they see the
`document`/`window`/`Image` stubs a tool installed and boot against them);
`loadGame({ isolated: true })` runs them in a fresh empty context, which is how the two
generators read the tables without a DOM.

- `tools/headless-check.js` — the runner for `tools/checks/`: it starts every check file
  in its own node process, in parallel, and adds up the results (a file that crashes
  before reporting counts as a failure, never as zero checks). Each check file requires
  `tools/lib/harness.js`, which installs a stub `document`/`window` (elements with
  `textContent` accessor and an `innerHTML` accessor that stores `domHtml(value)` — what a
  browser hands back, with upper-cased tag names and `disabled=""` — and counts the writes
  in `_htmlSets`, so a check can tell one write from a per-frame rebuild; cached per id,
  2D context that counts every draw call and records the arguments too — `ops` holds
  `[method, args, styles]` up to a cap and `clearOps()` empties it, so a check can read
  back the exact rectangle a frame painted instead of only that something was drawn),
  boots the game and exports the booted `Game`,
  the `AoE2` surface, `check`/`report` and the fixtures more than one file needs. So every
  file gets a fresh game, the files are **independent** — order does not matter and
  `node tools/checks/07-combat.js` runs one alone — and together they assert 294
  invariants. It never opens a browser. Node has no `Image`, so the harness defines one
  (§2b) whose `src` setter
  decodes the real sheet — caveat measured on `@napi-rs/canvas` 1.1.0: an `Image` built
  that way reports the right size but paints nothing, so this stub proves the loading
  *wiring* while `render-preview.js` renders from a properly decoded image.
- `tools/render-preview.js` — same stub, except the view canvas comes from
  `@napi-rs/canvas`, so `renderFrame` paints real pixels; writes `preview.png`. The atlas
  is decoded with `loadImage()` and injected via `setAtlas`, exactly what a browser's
  `img.onload` does. Falls back to the stub-only path (just proving the draw calls run)
  when the package is absent (`npm install --prefix tools` provides it).
- `tools/gen-atlas.js` — composes `assets/sprites.png` from the vendored frames in
  `data/sprites/` plus the `data/sprites.json` manifest and rewrites `SPRITE_SHEET` /
  `SPRITES` / `WORK_ANIM` / `BLD_SPRITES` in `src/config.js` under their GENERATED FROM
  banners (same input → same bytes, so the committed PNG can be diffed in review instead of
  trusted).
- `tools/check-stats.mjs` — loads the game and diffs every field of
  `CFG`/`KINDS`/`BLD`/`TECHS` against `data/units.json` + `data/buildings.json` +
  `data/techs.json`, exiting 1 with one line per drifted field; `--write` regenerates the
  four blocks in `src/config.js` from `data/`. The numbers are vendored rather than
  hand-typed, and this check is what keeps them that way.
- `tools/audit-line-refs.js` — keeps this document honest: every `path:NNN` reference in
  the docs must still point at the symbol it names, the file map above must list exactly
  the scripts `index.html` loads, and the files marked DOM `no` must not name a browser
  global.
- Contract to keep: the game must remain loadable in node. Every DOM access needs a guard,
  and every DOM element the code reaches for must exist in both stubs.
