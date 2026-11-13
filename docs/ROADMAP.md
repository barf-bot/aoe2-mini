# Roadmap

Ordered by what would make the biggest difference to the game existing as a *game*. Each
item says how we'd know it's done, because "polish" without an exit condition is how
prototypes stall.

**Bugs come first:** `docs/TODO.md` lists the known defects in fix order. Work through
that before starting anything below.

## P0 — make it actually playable by someone else

1. **Real-browser smoke test.** Shipped 2026-11-13 by `tools/browser-smoke.js`: Playwright
   (pinned to `1.58.0`, whose bundled Chromium build is the Chrome for Testing the image
   ships, resolved through `/etc/hermes/chromium-executable-path`) opens
   `file://<repo>/index.html` *and* https://barf-bot.github.io/aoe2-mini/ and asserts the app
   booted — `window.AoE2` present, `#hud` and `#view` in the DOM, `Game.started`, and a `#view`
   canvas whose painted pixels are non-blank (counted from the screenshot, not by eye) — then
   collects console and page errors. The tool is the proof: `node tools/browser-smoke.js`
   writes `tools/out/local.png` and `tools/out/live.png`, prints one JSON line per target and
   exits non-zero when a target fails to boot or throws, which is what the deploy-gating
   Process item below needs. Both screenshots render the seeded village `preview.png` shows —
   same seed 1337, same two Town Centers and their villagers — so the live page matches the
   simulated state instead of merely opening.
2. **A\* pathfinding around water.** Shipped 2026-11-11 by the pathfinding plan
   (`docs/plans/2026-11-11-astar-pathfinding.md`): `findPath` routes over the tile grid
   (uniform cost, 8-connected, no diagonal cut between two solid tiles), the route is
   cached per order and re-pathed when the world changes, `standTarget` resolves a solid
   target into a tile to stand on and `formationSlots` gives every unit in a group its own
   tile. The exit condition is proven by the pathfinding checks (`tools/checks/04-pathfinding.js`), which grade every route
   against the harness's own Dijkstra (within ~15% of optimal).
3. **Ranged combat + a second unit line (archer).** Shipped 2026-11-11 by the
   OG-content port (`docs/plans/2026-11-11-og-content-port.md`, T4 + T5): `KINDS.archer`
   (hp 30, atk 4, range 4, reload 2, accuracy 80) trains from the Archery Range and
   fights through `Game.projectiles`; the Town Center shoots through the same path, so
   matchups resolve on the vendored stat table instead of the old `CFG.ACQUIRE` guess.

## P1 — content depth

4. **Tech tree / blacksmith upgrades.** Shipped 2026-11-12 by the blacksmith tech-tree
   plan (`docs/plans/2026-11-12-blacksmith-tech-tree.md`): a buildable Blacksmith (`k`,
   Feudal-gated) researches Forge, Scale Mail, Fletching and Bracer from `data/techs.json`
   and the effects apply through `unitAttack`/`unitArmor` to that team's unit damage paths
   (since 2026-11-13 the age and tech bonuses are stored per team — the player's Forge no
   longer arms an enemy, docs/TODO.md P1-11).
   Age gating closed 2026-11-13: every row in `data/buildings.json` now carries its real
   AoE2 age (five Dark, eight Feudal, one Castle) and `build` gates on it, so the blacksmith's `age` is
   no longer the only gated row — `tools/checks/05-construction.js` §7e proves both halves
   per row. Left over: Fletching's and Bracer's +1 range is not modelled (the engine has one
   attack number per unit, `data/techs.json` `design{}`).
5. **More buildings**: lumber camp, mining camp and mill shipped 2026-11-04 (`BLD`,
   hotkeys `L`/`G`/`M`, resource-based drop-off routing); market (`e`) and watch tower
   (`c`) shipped 2026-11-12 by the market + watch tower plan
   (`docs/plans/2026-11-12-market-watch-tower.md`) — the market sells and buys 100-unit
   lots of food/wood/stone at its vendored rates through `trade`, and the tower shoots
   enemy units through the `stepBuildingAttacks` path the Town Center already used.
   Left over: trade carts and land trade. Garrison mechanics — housing units in the buildings
   whose rows carry a `garrisonCapacity` — shipped 2026-11-13 by the garrison plan
   (`docs/plans/2026-11-13-garrison.md`: `garrisonUnits`/`leaveBuilding`, the panel's
   `Garrisoned n/cap` line and its `Leave` buttons). The Guard Tower and Keep
   upgrade chain shipped 2026-11-13 by the tower upgrade chain plan
   (`docs/plans/2026-11-13-tower-upgrade-chain.md`): the two vendored rows joined
   `data/buildings.json` with authored `upgradesTo` links and `upgradeBuilding` turns a
   built tower into them.
6. **Wooden barricade (Feudal Age wall segment) + gated choke points.** Shipped
   2026-11-12 by the wooden barricade plan (`docs/plans/2026-11-12-wooden-barricade.md`):
   a Feudal-gated 1×1 `BLD.barricade` row — `w`, 150 hp, 3 wood, 7 s — run through the
   existing build pipeline, so enemy fighters raze segments and every raze reopens the
   gap. Left over: the Stone Wall / Ruins / Fortified Wall chain and gates,
   drag-to-build a run of walls, and the barricade's ripped atlas frame (folded into
   P2 item 8).
7. **Win/lose conditions.** Shipped 2026-11-11 by the OG-content port
   (`docs/plans/2026-11-11-og-content-port.md`, T6): `setResult` ends the game the moment a
   side has no Town Center left, `stepSim` freezes on the result and the `#result` overlay
   renders Victory/Defeat with a `New game` button.

## P2 — presentation and reach

8. **Sprites instead of discs** — units shipped 2026-11-03 (`assets/sprites.png`,
   regenerated by `tools/gen-atlas.js`); the 2026-11-11 OG-content port
   (`docs/plans/2026-11-11-og-content-port.md`) replaces the drawn cells with ripped
   AoE2 frames for units *and* building footprints. The Blacksmith, Market, Watch
   Tower, Guard Tower, Keep and Barricade are `noSprite` rows that draw flat
   team-coloured footprints, so their
   frames belong to this item too. Resource objects and ground tiles drawn from `PAL`
   remain. *Done when:* the same atlas approach covers the resource objects and the
   `noSprite` rows without growing the repo past one small PNG.
9. **Save/load** via `localStorage`. Shipped 2026-11-12 by the save/load plan
   (`docs/plans/2026-11-12-save-load.md`): `saveGame` writes the version-stamped
   `{ version, seed, writtenAt, state }` envelope into the one `SAVE_PATH` slot,
   `loadGame(path, Game, raw)` validates it and puts the game back on the board (the page now
   reopens on the saved game), and the debounced autosave writes without a `Save` press.
   Left over: multiple save slots, cloud sync and share codes — folded into P2 item 12.
10. **Sound.** Shipped 2026-11-12 by the sound plan (`docs/plans/2026-11-12-sound.md`):
    `SFX` (`src/config.js:324-331`) authors six rows — hit, arrow, build, age, victory, defeat —
    and `playSfx(Game, name)` (`src/sound.js:33`) renders each one as an oscillator plus gain
    envelope through the Web Audio API, so no audio file enters the repo; the header
    `Sound on/off` button mutes it and the preference survives a reload through
    `aoe2mini:muted`. Nothing cut — the plan's six rows are the shipped set.
11. **Touch controls** for phones (tap-select, long-press command), plus a responsive
    layout. Shipped 2026-11-12 by the touch-controls plan
    (`docs/plans/2026-11-12-touch-controls-layout.md`): `pointerDown`/`pointerUp`
    (`src/input.js:32`, `src/input.js:45`) answer mouse and touch from one path —
    `touch-action:none` on the canvas, one pointer per drag, and a 600 ms press-and-hold
    that issues the order a right-click would — while a `@media (max-width:720px)` block
    (`src/style.css:67`) stacks the footer panels and trims the header on narrow widths. Cut
    from this round: pinch-zoom, virtual joystick, on-screen keyboard, gamepad, tablet
    split-view and minimap drag on touch — two-finger pan shipped later, as item 13.
12. **Replay / seeded challenge** — the `mulberry32` seed is already a shareable handle on a
    map, and the save payload is the raw material for a replay; carries save/load's leftovers
    too: multiple save slots, cloud sync and share codes.
13. **Verify two-finger panning on a real phone.** The mechanic for `docs/TODO.md` P2-16b shipped
    (`fingerDown`, `src/input.js:78`) with `tools/checks/08-input.js` as its only proof — this box
    has no browser and no device. *Done when:* a finger-on-glass try confirms the pan tracks the
    fingers, stops at the map edge and leaves one-finger select alone.
14. **Fog of war.** The game has none — every tile is visible from the first frame — and the
    docs used to claim otherwise (`docs/TODO.md` P2-17, removed 2026-11-13). *Done when:* `Game`
    carries per-tile explored and visible masks, the renderer dims everything outside vision and
    stops drawing the units and buildings on hidden tiles, the masks survive a save and a load
    (`src/save.js`), and the pair is asserted by checks in `tools/checks/13-render.js` and
    `tools/checks/10-reset-save.js`.

## Phase 2 of the 2026-11-04 rules pass (designed, not yet planned)

Split out of the board-rules request because one plan caps at 8 tasks; phase 1
(`docs/plans/2026-11-04-board-rules.md`) ships the board rules, these ship next.

- **Cancel construction + demolish.** Shipped 2026-11-04 via
  `docs/plans/2026-11-04-cancel-demolish.md`: cancelling refunds 80% of the cost and frees
  the builder; demolishing a finished building refunds nothing (Town Centers exempt).
- **Uniform HUD frame.** Shipped 2026-11-12 via
  `docs/plans/2026-11-12-uniform-hud-frame.md`: `hudState` names the selection (`group` /
  `units` / `building` / `none`) and `hudHtml` renders the same three fixed-height panels
  (`#info`, `#commands`, `#queue`) for every state, so selecting something never resizes the
  map; a group collapses to `N units` plus one per-kind summary line and the command area is a fixed button grid.

## Deferred from the 2026-11-11 OG-content port plan

`docs/plans/2026-11-11-og-content-port.md` ships the part that fits in 8 tasks (vendored
stat tables + `tools/check-stats.mjs`, the config generation, the atlas built from ripped
frames, the archer line, ranged combat, win/lose, docs). Left over on purpose:

- **Asset-source swap workflow.** `data/sprites/` + `data/sprites.json` are the single
  documented asset path; refreshing the vendored tables from upstream, or dropping in
  someone's own HD/DE files, still needs a written procedure (fetch, convert, vendor,
  regenerate, with the vendored checksums recorded). *Done when:* `data/README.md`
  documents the steps and re-running them on unchanged input leaves `assets/sprites.png`
  byte-identical.
- **More frames than the ones the plan vendors.** The rip ships 8-direction walk sets,
  `Rot` and `Die` frames per unit; the plan vendors the front-facing idle/walk/work/attack
  a-b cells. *Done when:* a unit's death plays its real `Die` frames and walking picks the
  frame for the movement direction, still inside the one atlas.
- **Farm building art.** The building rip has no farm bitmap, so that cell keeps its
  procedurally drawn frame until real art lands. *Done when:* `data/sprites/buildings/`
  carries a farm frame and the procedural fallback for it is deleted.

## Process items (not features)

- **Gate the deploy on CI**: `.github/workflows/check.yml` runs the suite on every push, but
  Pages still publishes `main` from the branch, so a red run does not stop a deploy. Either
  protect `main` with the `check` status or switch Pages to deploy from an Actions workflow
  that needs it.
- **Decide the repo's home**: currently `barf-bot/aoe2-mini`. Transfer to Barf's own account
  and set up a username Pages site (`dogx.dev`) if this stops being a throwaway.
