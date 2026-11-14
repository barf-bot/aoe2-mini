# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/); versions are the git
commits on `main`.

## [Unreleased] — 2026-11-14

### Added — `docs/plans/2026-11-14-strix-local-roadmap.md` G1: `npm run verify`

- `tools/verify.js` (`npm run verify --prefix tools`) runs the five verification commands in
  the order CI uses them, stops at the first failure, streams that step's output and ends with
  one verdict line: `VERIFY OK` (exit 0) or `VERIFY FAIL: <step>` (exit 1). Its render step
  writes the PNG to `os.tmpdir()`, so a verify run never rewrites the tracked `preview.png`.
  `npm run check --prefix tools` and `.github/workflows/check.yml` are unchanged.

### Added — `docs/plans/2026-11-14-strix-local-roadmap.md` G2: `audit-line-refs.js --fix`

- `node tools/audit-line-refs.js --fix` repairs the refs it can place with certainty instead of
  making whoever moved the code renumber them by hand: it reads the identifiers out of the citing
  sentence, searches the target file for `function <word>` / `const <word>` / `<word>:` and moves
  the ref to that line only when the target declares the name exactly once (a range shifts by the
  same delta; several candidates resolve to the one nearest the number written). It prints
  `fixed N, left M` and exits 1 unless nothing needed fixing and nothing is broken. Without
  `--fix` the checks and their output are byte-identical to before.

### Added — `docs/plans/2026-11-14-strix-local-roadmap.md` G3: a citation rule and a plan template

- New prose in `docs/CONVENTIONS.md` and `AGENTS.md` cites `functionName` (`src/file.js`) with
  no line number unless the thing cited is not a function (a table row, a CSS rule, a
  generated block) where the line is the meaning, and `docs/CHANGELOG.md` entries are ≤ 12
  lines with no numbers — forward-only, because a named citation cannot rot the way a moved
  number does, which is what `tools/audit-line-refs.js --fix` exists to repair.
- `docs/plans/TEMPLATE.md`: the copy-in skeleton for future plans — the fenced `Status:`
  header, the condensed working rules, one empty `Read`/`Change`/`Check`/`Done when`/`Size`/
  `Needs` card and the hard-stop list, 58 lines so a new plan starts short.

### Fixed — `docs/TODO.md` item 23: `N` asks before it wipes the save

- The `n` key, the footer's `New map` button and the victory overlay's `New game` button now
  all call one exported `requestReset(Game)` (`src/boot.js`): the first press arms a
  confirmation (`Game.confirmReset` — transient and kept out of the save, so `CFG.VERSION`
  is unchanged) and toasts `Press N again to start a new map`; a second press within
  `CONFIRM_RESET_SECS` (3 s) runs the old wipe and clears the arm, a later press re-arms.
- checks: `tools/checks/08-input.js` gains the arm / confirm / re-arm cases (suite 409 → 413);
  the three new-game checks in `tools/checks/10-reset-save.js` and the result-overlay check in
  `tools/checks/07-combat.js` now drive the confirming second press.

## [Unreleased] — 2026-11-13

### Added — `docs/ROADMAP.md` P1-5 (tower chain half): Watch Tower → Guard Tower → Keep

- `data/buildings.json` gained the two vendored rows the chain was missing — `guard_tower`
  (`data.Building[234]`, `WCTW2`: 1500 hp, 35 wood + 125 stone, 80 s, attack 7, armour 2/8) and
  `keep` (`[235]`, `WCTW3`: 2250 hp, the same cost and time, attack 8, armour 3/9) — numbers
  copied, not retuned, plus the authored halves the table has no column for: the labels, the 1×1
  footprints, `pop: 0`, `noSprite: true`, the `age: 1` / `age: 2` gates and the two `upgradesTo`
  links (`buildings.watch_tower.upgradesTo`, `buildings.guard_tower.upgradesTo`, both listed in
  `source.authored`). `tools/check-stats.mjs` validates and prints `upgradesTo`, so the field can
  reach `src/config.js` no other way than the data: 333 → 373 fields checked, `src/config.js`
  317 → 331 lines. No art entered the repo — `assets/sprites.png` is byte-identical before and
  after `tools/gen-atlas.js`, because both rows are `noSprite`.
- `upgradeBuilding` (`src/commands.js:278`) refuses through `toast` — `Not your building`,
  `Already under construction`, `<label> has no upgrade`, `<label> requires <Age>`,
  `Not enough <res>`, `All villagers are building` / `No villager available` — and otherwise spends
  the next row's cost, writes `b.upgrade` and restarts the site on that row's clock;
  `promoteBuilding` (`src/commands.js:315`), called by the sim's `b.built >= 1` branch
  (`src/sim.js:252`), flips `b.kind` so hp, attack, armours, range and footprint come from the new
  row. A tower mid-upgrade is therefore just a half-built building (it shoots nobody, which
  `stepBuildingAttacks` already enforced) and `src/save.js` needed no new field and no
  `CFG.VERSION` bump. Cancelling an upgrade refunds the tier being paid for —
  `floor(35 × 0.8) = 28` wood and `floor(125 × 0.8) = 100` stone — and leaves the Watch Tower
  standing instead of removing it (`cancelConstruction`, `src/commands.js:166`).
- The command grid (`commandsHtml`, `src/hud.js:106`) offers `Upgrade to Guard Tower` on a finished
  tower and nothing for a House or a finished Keep, and its click reaches
  `upgradeBuilding` (`src/input.js:251`).
- checks: 364 → 382 — 381 across the plan, 382 with its review round.
  `tools/checks/05-construction.js` went 67 → 81 — two of them §7e's table-driven age loop
  picking up the new rows for free, the other ten the plan's §7f (both age refusals with the
  bank untouched, the Feudal spend and the Guard Tower it completes into, the Keep edge, a
  half-upgraded tower holding fire while the finished one's arrow carries attack 7,
  `Keep has no upgrade`, `Not your building` and `Already under construction`, the
  no-villager refusal and the cancel refund) — and `tools/checks/09-hud.js` 31 → 35 (§11's
  button markup, the missing button on a House and a Keep, the click that spends the tier and
  the info panel naming the tier the tower became). The review round added the §7f check the
  design asked for but the plan's list had dropped (a tower already upgrading is refused
  `Already under construction` and cannot spend the cost twice — deleting that guard from
  `upgradeBuilding` had left every other check green) and restamped the plan's `done when`
  totals to the measured numbers.
- `preview.png` now carries the chain's middle tier: the render fixture places a finished
  `guard_tower` on the tile `findSite` answers next to the Watch Tower's pad, so the committed
  frame shows the blacksmith, Market, Watch Tower, Barricade and Guard Tower footprints.
- Not in this round (and still open): garrison mechanics, trade carts and land trade (P1-5's other
  leftovers), the Stone Wall / Fortified Wall chain and gates (P1-6), ripped art for the three
  towers (P2-8) and the enemy AI building or upgrading towers — `aiStep`'s build order is unchanged.

### Added — `docs/ROADMAP.md` P1-5 (garrison half): housing units in buildings

- `garrisonUnits` / `leaveBuilding` (`src/commands.js:363` / `src/commands.js:397`) and the
  right-click path that reaches them (`issueOrder`, `src/commands.js:59`): with own units
  selected, a right-click on a finished own building whose row carries a `garrisonCapacity`
  (Town Center 15; Barracks, Archery Range and Market 10; Watch Tower, Guard Tower and Keep 5)
  links the units to it — `u.garrisonedIn` (`src/entities.js:66`) *is* the reserved slot, so two
  orders in one frame cannot overbook a building — and hands each accepted one the `move` order
  onto the building's own standing-ring tile (`order.garrison`), which `updateUnit`'s new guard
  (`src/sim.js:195`) executes and then retires: parked, invisible, unhittable, and the arrival
  line is the single place a garrison order ends (no second timer). `src/save.js` needed no
  change and no `CFG.VERSION` bump — `encodeUnit` (`src/save.js:55`) copies every key, so the
  link and the in-flight walk both ride along.
- One targetability rule for units now exists: `targetableAsEnemy` (`src/sim.js:326`) — alive,
  another team, not inside a building — read by `autoAcquire` (`src/sim.js:175`),
  `stepBuildingAttacks` (`src/sim.js:143`), `orderForUnit` (`src/commands.js:12`),
  `issueOrder` (`src/commands.js:54`) and the AI's `nearestEnemy` (`src/ai.js:38`) instead of
  five hand-written copies of the predicate — the fifth, a tower's gun still arrowing a militia
  sheltered in his own barracks, is the review round's catch — and `pickUnit` / `unitsInBox`
  (`src/input.js:7`, `src/input.js:23`) refuse an inside unit too.
  Population still counts him: `selectedUnits` (`src/economy.js:127`) drops him so he cannot be
  ordered or recalled, while `popUsed` / `popCommitted` keep the slot he always held. A
  `removeBuilding` (`src/entities.js:124`) — raze, cancel or demolish — evicts the garrison onto
  the ring before the building leaves the world, so no link dangles.
- The panel: a finished building with occupants shows `Garrisoned n/cap` in the info panel
  (`src/hud.js:98`) and one `Leave` button per kind in the command grid plus `Leave all` when it
  holds more than one unit (`src/hud.js:146`), whose click reaches `leaveBuilding` through the
  delegated `data-act` ladder (`src/input.js:263`). No new CSS, no new `hudState` value, and the
  uniform-frame checks (`tools/checks/09-hud.js` §11b) still see the same three panels.
- No data, no `src/config.js` and no `assets/sprites.png` byte moved (`tools/check-stats.mjs`
  still prints `373 fields checked`, `tools/gen-atlas.js` leaves the sheet byte-identical) and the
  committed `preview.png` is unchanged, because the seeded scene garrisons nobody.
- checks: 382 → 409 — `tools/checks/08-input.js` 40 → 50 (§10e: the two commands, every refusal
  string, the ring placement, the per-kind and empty-building cases), `07-combat.js` 38 → 46
  (§9h: not picked, not box-selected, not targetable, an arrow on his building missing him, the
  walk that ends and parks him, hittable again after `Leave`, a tower that cannot shoot a unit
  inside, a raze that evicts the garrison), `09-hud.js` 35 → 41 (§11e: the count, the buttons,
  both clicks and the population line), `10-reset-save.js` 36 → 38 (§13: the garrisoned pair and
  a pending garrison walk through save → reset → load) and `tools/checks/13-render.js` 11 → 12
  (§16e: neither blitted on the field nor dotted on the minimap). The review round added the
  three checks the plan's task list had dropped (the tower's gun and the eviction in §9h, the
  minimap dot in §16e) and restamped the plan's `done when` totals to the measured numbers.
- Not in this round (and still open): garrisoned units shooting out of towers and keeps (needs
  the per-range attack work of P1-4), enemy units taking refuge in a dying building, hp regen
  inside, the AI garrisoning its own villagers, and P1-5's last leftover — trade carts and land
  trade.

### Added — `docs/ROADMAP.md` P0-1: real-browser smoke test (`tools/browser-smoke.js`)

- Playability used to be proven by a stub DOM (`tools/lib/harness.js`) plus a headless render
  (`tools/render-preview.js`); no browser had ever opened the page. `tools/browser-smoke.js`
  launches the Chrome for Testing build the box ships — resolved from
  `/etc/hermes/chromium-executable-path`, falling back to a `$PLAYWRIGHT_BROWSERS_PATH` glob —
  through Playwright with `--no-sandbox --disable-gpu --hide-scrollbars` at a fixed 1280×800
  viewport, and opens `file://<repo>/index.html` *and* https://barf-bot.github.io/aoe2-mini/.
- Boot is asserted from inside the page, not by eye: `window.AoE2` (`src/main.js:23`) exists,
  `Game.started` (`src/boot.js:191`) is set — that flag only goes up once the view canvas came
  up — and `#hud`/`#view` are in the DOM. The canvas rectangle in the screenshot holds 1530
  distinct colours for the working copy and 1581 for the live site, where a blank canvas holds
  one; the count comes from decoding the PNG with `@napi-rs/canvas`, so a page that paints
  nothing can no longer pass by having the right DOM.
- Output is one PNG per target under `tools/out/` plus one JSON line per target
  (`target`, `title`, `aoe2`, `consoleErrors`, `screenshotSha256`); `--verbose` adds the page
  state and the captured error text. Exit is 0 only when every target booted with no page
  errors, which is the artefact the "Gate the deploy on CI" process item was waiting for.
  `tools/out/` is scratch and gitignored; the repo keeps tracking one generated image,
  `preview.png`.
- `tools/package.json` gains its second dev dependency, pinned `playwright@1.58.0`: that
  release's Chromium build *is* the `chromium-1208` (Chrome 145.0.7632.6) this box ships, so
  installing it fetches nothing — `1.52.0`, the other pairing verified here, expects
  `chromium-1169` and would download one. The game still ships zero dependencies and still has
  no build step: no `src/` file or `index.html` changed — only the dev-only `tools/`.
- checks: 364, unchanged. `tools/headless-check.js` requires nothing new — the browser test is
  a separate tool with its own entry (`npm run browser-smoke --prefix tools`), so the suite
  stays runnable in plain node; the tool's check is running it.

### Added — `docs/ROADMAP.md` P1-4 (age-gate half): every building row now carries its real age

- `data/buildings.json` gated four rows — `blacksmith`, `market`, `watch_tower`, `barricade`, all
  `age: 1` — while the other eight carried no `age` at all, so the `def.age ?? 0` in `build`
  (`src/commands.js:114`) made the Barracks, the Mill and the Archery Range Dark Age buildings.
  Every row now names the age AoE2 does: `age: 0` for `town_center`, `house`, `farm`,
  `lumber_camp`, `mining_camp`, `age: 1` for `barracks` (the vendored row's own `internal_name`
  is `Barracks Age1`), `mill`, `archery_range` plus the four that already had it. The ages are
  recorded as authored in `source.rule` — `age` is no column of the upstream table — and
  `src/config.js` is regenerated from the data (`tools/check-stats.mjs --write`, not hand-edited).
  Fletching's and Bracer's +1 range stays out: the engine has one attack number per unit
  (`data/techs.json` `design{}`), which is the other half of P1-4.
- checks: 345 → 364. `tools/checks/05-construction.js` gains §7e, a table-driven pass over all
  twelve rows: any age below a row's own refuses with the `AGES` toast, spends nothing and raises
  nothing, and the village at the row's own age builds it for exactly its cost (the bank the
  fixture lays down drains to zero, so a cheaper `BLD` row fails). The rest is fixture fallout —
  the pre-P1-11 scalar `st.age = 1` assignments, which `Game.age[0]` reads as `undefined` and so
  never gated anything, become `st.age[0] = 1`; §7b's village ages up because it raises a Mill;
  `tools/checks/06-training-research-trade.js` ages its Archery Range state up; and the
  Archery Range button in `tools/checks/09-hud.js` is asked of `fundedGame()` (Feudal, every cost
  payable) instead of the still-Dark-Age shared `Game`, which the file's own age-up section later
  takes from 0 to 2. All of them failed before the fix, for the right reason: §7b crashed with an
  unbuilt mill and the range's button simply stopped being offered.
- `aiStep` (`src/ai.js:4`) needs no age-correct build order — the enemy never builds, it only
  trains from its own Town Center, and `Game.age[1]` stays 0 — so no AI behaviour got gated away.
- the `BLD` table in `docs/GAME_RULES.md` gained the Age column the data now carries.

### Fixed — `docs/TODO.md` P2-19: blurry canvas on high-DPI screens

- `beginCanvas` (`src/render.js:4`) set `canvas.width/height` to the CSS pixel size and never
  read `devicePixelRatio`, so on a 2x display the browser stretched a half-resolution bitmap and
  everything drew soft. The backing store is now `max(1, round(w * dpr))` ×
  `max(1, round(h * dpr))` device pixels, the CSS box stays `w + 'px'` / `h + 'px'`, and the
  scale is applied with `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` — not `ctx.scale(...)`, which
  compounds because `beginCanvas` runs again on every window resize (`src/input.js:291`). The
  returned record keeps `w`/`h` in logical pixels (the space every draw call works in, e.g.
  `clearRect(0, 0, Game.view.w, Game.view.h)` at `src/render.js:312`) and carries `dpr`.
- the projection had to follow: `toWorld` (`src/input.js:136`) derived its scale from the canvas
  *element*, i.e. from the backing store, so a doubled store would have moved the cursor and the
  drag box to twice the pointer while the renderer drew in logical pixels. It now reads
  `Game.view.w`/`Game.view.h` with the old element/`view_W`/`view_H` fallbacks kept for a
  `Game` with no `view`. `Game.mm` (`src/boot.js:172`) inherits the fix through the same
  `beginCanvas`; `drawMinimap` (`src/render.js:272`) already scaled from the record's logical
  `mm.w`/`mm.h` rather than `canvas.width`, so nothing else in the render path changed.
- `beginCanvas` joins the `AoE2` export (`src/main.js:12`) so the checks can call it directly, and
  the harness stub gained what that needed: a `style` object on every stub element (the stub had
  none, so the CSS box half of the fix was unobservable from node) and a `withDpr` helper beside
  `withStorage` for pinning `window.devicePixelRatio` and restoring it, including its absence.
- checks: 342 → 345. Two in `tools/checks/00-boot.js` — a 2x screen doubles the backing store,
  leaves the CSS box and the logical `w`/`h` alone and transforms via `setTransform` instead of
  `scale`; with no `devicePixelRatio` the canvas stays 1:1, which is the node path
  `tools/render-preview.js` renders through — and one in `tools/checks/08-input.js`: the same
  `clientX`/`clientY` project to the same `sx`/`sy` whether the store is `w` or `2 * w`. All three
  failed before the fix; `preview.png` regenerates byte-identical, as it must on the dpr-1 path.
- the TODO entry was **unverified** and still is on real glass: this box has no display and no
  browser, so the sharpness itself waits on `docs/ROADMAP.md` item 1 (the real-browser smoke test).
  Item 19 is deleted, which empties `docs/TODO.md`.
- doc line refs moved with the two files they cite: `src/render.js` 58 → 64, 134 → 140, 150 → 156,
  240 → 246 (`docs/ARCHITECTURE.md`, `docs/GAME_RULES.md`) and `src/input.js` 227 → 230,
  251 → 254, 314 → 317 (`docs/GAME_RULES.md`).

### Fixed — `docs/TODO.md` P2-18: a spent resource tile stayed on the minimap

- `depleteTile` (`src/economy.js:61`) reverted an emptied tile to `T.GRASS` and bumped
  `Game.mapEpoch` but left `Game.mmBase` — the terrain bitmap `drawMinimap` caches and blits
  (`src/render.js:270`) — standing, so the bush/tree/ore dot kept its colour on the minimap for
  the rest of the game. The conversion now nulls the cache on the line that changes the tile; the
  next frame rebuilds it. Invalidated rather than rebuilt in place, because rebuilding there costs
  a whole world pass per tile inside a harvest tick. The item's "new game" half needed no change:
  `resetGame` (`src/boot.js:65`) already cleared it, as the verified TODO note says.
- `mmBase` stays DOM-only and unsaved (`src/save.js:30`, `tools/checks/10-reset-save.js:68`) —
  clearing the field in an economy function is what that contract asks for, nothing new is persisted.
- checks: 338 → 342, all four in `tools/checks/03-economy-movement.js` §6c, on a booted fixture so
  the cached bitmap is a real one to read back: a tile that still holds stock and a non-resource
  tile both answer `false` and leave that exact bitmap (same object, same painted colour) alone —
  which also proves the fix invalidates instead of rebuilding — while emptying a resource tile
  answers `true` and clears it, and the frame after paints that tile with the grass palette instead
  of the forest one. The last two failed before the fix; `preview.png` regenerates byte-identical
  (the minimap is not part of the rendered view).
- `docs/GAME_RULES.md` line refs into `src/economy.js` moved with the file (58 → 61, 73 → 77,
  84 → 88, 98 → 102, 104 → 108, 114 → 118); `tools/audit-line-refs.js` is what checks them.

### Fixed — `docs/TODO.md` P2-17: the docs promised fog of war the game doesn't have

- `README.md:12` claimed a "procedural map … plus fog of war" and the map table
  (`docs/GAME_RULES.md:17`) described per-tile explored/revealed state "drawn dimmed outside
  vision" — there is no fog, visibility or explored-tile code in `src/`. The README bullet now
  says what the renderer does instead (terrain drawn from the palettes at
  `src/config.js:282-291`) and states that the whole map is visible from the first frame; the
  rules row reads `not implemented yet` and points at the roadmap entry.
- Fog of war becomes `docs/ROADMAP.md` item 14, so it is a planned feature with an exit
  condition (explored/visible masks, dimmed rendering outside vision, a save/load round-trip and
  the checks that prove them) instead of an unmet claim. The 2026-11-03 history entry
  (`docs/CHANGELOG.md:961`) keeps its wording — history is not edited.
- Docs only, so no code path and no check changed: `node tools/audit-line-refs.js` validates the
  references the two edited docs cite, and `node tools/headless-check.js` stays at 338/338.

### Added — `docs/TODO.md` P2-16b: the camera pans with two fingers

- `Game.touches` (id → the canvas point each finger last reported) and `Game.pan` (the point
  the pair pivot around) join `Game.drag` and `Game.mmPointer` in the state
  (`src/boot.js:44`); both are live input state and never saved (`src/save.js:234`).
  `toWorld` now carries `pointerType` through as `p.type` — the only thing that separates a
  finger from a cursor — and `fingerDown`/`fingerMove`/`fingerUp` (`src/input.js:78`) track the
  fingers with it. Two of them down make every move shift `Game.cam` by the negative of their
  midpoint delta; while a pan runs the selection box freezes, `Game.mouse` goes null (so the
  edge-scroll band stops reading a finger that is steering) and the owning finger's release
  neither selects nor commands, the rule `pointercancel` already applied. One finger — with or
  without a mouse on the same screen — behaves exactly as before and a mouse never enters pan
  mode, so the one-pointer contract needed no edit.
- The clamp the pan needs is shared instead of duplicated: `setCam` (`src/input.js:299`) is the
  one world clamp both `centerCamOnFraction` (`src/input.js:307`, the minimap) and `panCamera`
  (`src/input.js:314`, the fingers) write through, so the two cannot disagree about where the
  map ends.
- The footer help line (`src/hud.js:103`) now reads `WASD / arrows / two fingers or screen edges
  pan` — the string `tools/checks/08-input.js` pins — and the README controls line names it;
  the `index.html` banner keeps its mouse-and-keyboard wording.
- checks: 333 → 338, all five in `tools/checks/08-input.js`: the pair's pivot and the exact
  camera result of a move by either finger, the frozen box plus cleared hover plus untouched
  selection, the owner's silent release, the map-corner clamp, and a mouse pointer never
  entering pan mode while its own drag still tracks.
- No phone and no browser on this box, so the mechanic is proven by synthetic pointer events and
  the entry's "check on a real phone" half moves to `docs/ROADMAP.md` item 13. `preview.png`
  regenerates byte-identical (no render path changed).

### Fixed — `docs/TODO.md` P2-16 (header half): the phone header ran off the right edge

- The 720 px block (`src/style.css:68`) wraps the header into two rows — brand + Save + Mute
  on row 1, the six resource cells on row 2 — replacing the single flex row that pushed stone,
  pop, age and both buttons off a 390 px screen. `header` gains `flex-wrap:wrap`, the buttons
  take `order:1`/`order:2` (Save keeps `margin-left:auto`, so the pair still sits at the right
  edge) and `.res{order:3}` moves every cell to the second row. Cell type shrinks to
  `font-size:9px` labels with `letter-spacing:0` and `font-size:12px` values, and
  `flex:1 1 0;min-width:0` gives each cell exactly one sixth of the line with
  `overflow:hidden;text-overflow:ellipsis` on `.res b`, so a long number clips instead of
  widening the row; the phone button paddings drop to `2px 8px`, because row 1 measured
  392.7 px at the desktop `4px 14px`/`4px 10px` — 2.7 px wider than the viewport. The desktop
  `header` rule (`src/style.css:10`) and the `src/hud.js` markup are untouched, and the item's
  unverified touch-pan half is now `16b`.
- checks: 331 → 333. `tools/checks/09-hud.js` adds the two phone-header checks — the rule set
  and the width arithmetic for both rows (376.7 px on row 1, 360.6 px on row 2) — parsed from
  `src/style.css` + `index.html`, the same evidence shape as the `--footer-h` check, since this
  box has no browser to photograph the header with.
- `preview.png` regenerates byte-identical (CSS-only change, no render path touched).

### Fixed — `docs/TODO.md` P2-15: footer content was clipped

- The info panel's body row measured 24 px — one and a half lines at its 12 px font — so the
  third line (`Order: build`) was cut off. `:root` (`src/style.css:4`) gains
  `--footer-h:94px` — 2·8 padding + 16 h4 + 2·4 row-gap + 6 hp + 3·16 body lines — and both
  footer rules (`src/style.css:38` and the 720 px block) now read `flex:0 0 var(--footer-h);
  height:var(--footer-h)`, so the desktop and phone declarations cannot drift apart again.
  `.info .body` (`src/style.css:45`) declares the `line-height:16px` the sum assumes instead of
  leaving it to the browser default, so the row holds exactly the three lines `infoHtml` fills.
- `button` (`src/style.css:53`) gains `white-space:nowrap;overflow:hidden;text-overflow:ellipsis`
  so `Barracks 175 W` truncates inside its 26 px row instead of wrapping over it; no label
  string in `commandsHtml` changed.
- checks: 329 → 331. `tools/checks/09-hud.js` replaces the literal `height:74px` pins in both
  footer rules with `var(--footer-h)` and adds two checks: the footer height equals the `.info`
  padding + rows + gaps + 3 body lines (the symptom's maths, parsed from the stylesheet — no
  browser on this box), and the button clip rule.
- `preview.png` regenerates byte-identical (CSS-only change, no render path touched).

### Fixed — `docs/TODO.md` P2-14: age up went one age too far

- `AGES` (`src/config.js:272`) loses its fourth entry: the game ends at Castle Age, which is
  what the README already promised. `upgradeAge` (`src/commands.js:267`) hardcoded
  `Imperial Age reached` in its guard, so the refusal could name an age the table no longer
  has; it now reports `AGES[AGES.length - 1] + ' reached'` — the same expression the success
  path uses — so guard and toast cannot drift again.
- Nothing in `data/buildings.json` / `data/techs.json` asks for more than Feudal, so no
  `age:` row needed renumbering; the age up stays instant. The entry's optional Town Center
  research time is a new mechanic (queue, ticking, save state, HUD progress) and is deferred
  to its own item.
- checks: 327 → 329. `tools/checks/09-hud.js` replaces the tautological
  `age: Castle Age needs 1000 food` (its condition ended in `|| true`) with three real ones:
  the 1000-food refusal at Feudal, the paid upgrade to Castle Age, and the refused-and-unpaid
  `upgradeAge` there; `tools/checks/11-sound.js` pins the new refusal string.
- `preview.png` regenerates byte-identical (no render path changed).

### Fixed — `docs/TODO.md` P2-13: the minimap could be clicked but not dragged

- `attachInput` listened to `mousedown` on `#minimap` only, so a press jumped the
  camera and moving with the button held did nothing — the "minimap camera drag"
  the README advertises never followed the drag. The canvas path above it already
  used pointer events (`src/input.js:148`), so the minimap now does too
  (`src/input.js:255`): `pointerdown` — left button only, so a right-click on the
  minimap neither drags nor reaches the canvas `contextmenu` order path — records
  `Game.mmPointer` (`src/boot.js:44`, transient like `Game.mmBase`, not saved) and
  recentres, `pointermove` recentres only while that very pointer is down, and
  `pointerup` / `pointercancel` clear it. The press takes pointer capture where the
  element offers one (the stub DOM does not, so it is guarded), keeping moves and
  the release arriving at `#minimap` even when the pointer strays off it.
- The fraction-to-camera maths left the listener body for one named helper,
  `centerCamOnFraction` (`src/input.js:307`), called by the press and the drag
  alike so the two cannot drift.
- checks: 324 → 327. `tools/checks/08-input.js` replaces its `mousedown` assertion
  with four: the `pointerdown` press moves the camera and arms `Game.mmPointer`, a
  `pointermove` while held drags the camera again, a `pointermove` after the
  release (no button down) leaves it where it is, and a right press neither moves
  nor arms.
- `preview.png` regenerates byte-identical (no render path changed).

### Fixed — `docs/TODO.md` P2-12: `W` placed a barricade instead of panning

- The keydown handler (`src/input.js:209`) armed Barricade placement on `w` and returned
  before `setKey` (`src/input.js:203`) ran, so the `WASD / arrows to pan` the `index.html`
  banner and the footer help line (`src/hud.js:103`) advertise had no up key: `ArrowUp`
  panned, `W` did not. The hotkey moves to `q` — the only letter next to the WASD cluster
  no handler used — and `w` reaches `setKey` again, so `keys.up` is set on press and
  cleared on release.
- checks: 323 → 324. `tools/checks/08-input.js` pins `['q', 'barricade', 'Barricade']` in
  the hotkey table and adds the regression itself: `w` keydown sets `Game.keys.up`, keyup
  clears it. The pinned banner and footer strings needed no change — the wording is now
  true — and the Barricade's command-bar button carries no hotkey in its label.
- `preview.png` regenerates byte-identical (no render path changed).

### Fixed — `docs/TODO.md` P1-11: the player's age and Blacksmith upgrades also strengthen the enemy

- `Game.age`, `Game.ageBonus` and `Game.techs` were single global values that `unitAttack`
  (`src/sim.js:55`) and `unitArmor` (`src/sim.js:69`) applied to *any* unit, so a player at
  Castle Age with Forge raised an enemy militia's attack from the table's 4 to 7: the enemy
  fought with upgrades it had never researched and, having no research of its own, never could.
- All three are per team now — `age[2]`, `ageBonus[2]`, `techs[2]` indexed by team the way
  `res[2]` already was (`src/boot.js:45`, `src/boot.js:60`). The combat helpers read the
  attacker's or defender's own half; `upgradeAge` (`src/commands.js:266`), the header age
  (`src/hud.js:24`) and the build / age-up buttons (`src/hud.js:145`, `src/hud.js:152`) speak for
  team 0, while `researchTech` (`src/commands.js:231`) and `trade` (`src/commands.js:250`) use the
  building's team and `stepSim` (`src/sim.js:26`) files a finished tech under its own building's
  team. Team 1 keeps age 0 and an empty set until the AI can research, so an enemy unit's numbers
  are now exactly its table row's.
- The payload changed shape, so `CFG.VERSION` moves 1 → 2 (`data/units.json:44` →
  `src/config.js:27`): `migrate` (`src/save.js:137`) converts a v1 save — one global age, ageBonus
  and techs set — into the player's half with the enemy's left empty instead of refusing it, and
  `validState` (`src/save.js:152`) now requires the per-team containers.
- checks: 320 → 323. `tools/checks/07-combat.js` gains the reproduction itself — a player at
  Castle Age with Forge swings 7 while the enemy militia stays at 4, and Scale Mail armour stops
  at the player's own units; `tools/checks/10-reset-save.js` gains the v1 → v2 migration case (old
  bytes load and re-save to exactly the v2 bytes), not just the round-trip of the new shape. The
  checks that read the old globals (`06`, `07`, `09`, `10`, `11` and the `fundedGame` fixture in
  `tools/lib/harness.js`) were rewritten to the per-team fields rather than dropped.
- `preview.png` regenerates byte-identical (no render path changed).

### Fixed — `docs/TODO.md` P1-10: the population cap does not hold

- `popUsed` (`src/economy.js:104`) counted villagers only — the starting militia and every
  archer cost no population — and `train` (`src/commands.js:215`) compared that number with
  the cap while ignoring what was already queued, so five villagers could be bought at 4/5
  and the header ended at 9/5. `popUsed` now counts every living unit (the opening header
  reads 5/5), and the new `popCommitted` (`src/economy.js:114`) adds the units waiting in the
  team's building queues. That single number is what `train` refuses on (`Need more houses`)
  and what the footer's train buttons are disabled by (`commandsHtml`, `src/hud.js:106`), so
  a button can no longer offer a click the command would refuse.
- The enemy inherits both halves through the same helpers: `aiStep` (`src/ai.js:4`) now sees
  five units at its seeded keep, answers with the attack wave instead of buying a sixth
  villager, and keeps the villager line for a village of fewer than five units.
- checks: five new ones (315 → 320) — `tools/checks/06-training-research-trade.js` gains the
  refusal at a full cap with an empty queue, the queued-villager-counts assertion, the queue
  filled exactly to the cap and the finished Barracks that must respect the cap its Town
  Center filled; `tools/checks/09-hud.js` gains the four button states of that rule (full,
  with room, one queued, queue full). The checks that pinned the old rule were rewritten
  rather than dropped: `01-world-roster.js` now reads 5/5, `06` now reads 6/10 after
  training, the `12-ai.js` village fixture keeps its roster below the cap the way the game
  does (dead-flagging the extra villagers), and the `fundedGame` fixture gained a house — a
  5/5 village cannot train, and a refused command never marks the game dirty.
- `preview.png` regenerates byte-identical (no render path changed).

### Fixed — `docs/TODO.md` P1-9: a foundation counts as a finished building

- `b.built` is a 0..1 progress fraction and every own-building test read it as a boolean
  flag: a house at 32 % raised the population cap from 5 to 10 (`popCap`,
  `src/economy.js:98`), a lumber camp at 1 % was chosen as the wood drop-off
  (`findDropoff`, `src/economy.js:31`), a 5 % farm was harvested and re-linked from a save
  (`resumeGather`, `src/economy.js:84`, `decodeOrder`, `src/save.js:163`), the farm case of
  `orderForUnit` (`src/commands.js:7`) offered it as a harvest source, and the enemy's
  `aiStep` (`src/ai.js:4`) trained from a half-built keep of its own. All of them now test
  `built >= 1`.
- The enemy half is written down instead of left to truthiness: a hostile building is
  attackable at any progress — a 0 % foundation included, as in AoE2 — while a player's own
  building counts only once it is finished. `attackableAsEnemy(b, team)` (`src/sim.js:313`)
  is the single rule, and `orderForUnit`, `issueOrder`, `autoAcquire` and the live-order
  check in `aiStep` all read it instead of each reinventing the test.
- Save/load: the payload shape is unchanged — `built` was already stored as a fraction — so
  no `VERSION` bump; an old save simply stops counting its half-built houses, camps and
  farms, and a stored `harvest` order on a farm that never finished retires to `idle`.
- checks: five new ones (310 → 315) — `tools/checks/05-construction.js` gains the 32 %
  house cap, the 1 % lumber camp and the 5 % farm cases, `tools/checks/07-combat.js` the
  attackable 0 % enemy foundation (the helper plus what `autoAcquire` and a right-click
  answer), `tools/checks/12-ai.js` the half-built enemy Town Center. All five failed before
  the fix and pass after; none of the existing checks pinned the old truthiness, so no
  coverage was rewritten.
- `preview.png` regenerates byte-identical (no render path changed).

### Fixed — `docs/TODO.md` P1-8: construction looks like nothing is happening

- `drawBuildings` (`src/render.js:58`) gave every site the same anonymous look — a flat
  `rgba(200,165,88,.16)` rectangle with a 4 px bar — so a half-built house was hard to
  tell from empty grass and swapped for the art only once it finished. A site now draws
  the body the finished building draws (the atlas cell, or the procedural body for the
  `noSprite` kinds) at `globalAlpha = .2 + .8 * built`: the building solidifies as it is
  built, a 0 % site is still visible at exactly the alpha the old rectangle used, and the
  separate progress bar goes away because the fade itself is the readout. The finished
  building's job and health bars are untouched.
- `unitAnim(u)` (`src/render.js:134`) answered the farm pose for *any* `build` order, so
  a villager still three tiles off hammered while walking to the site. The pose is gated
  on arrival now: `updateUnit` (`src/sim.js:190`) marks the order `atSite` the moment
  `moveUnit` (`src/movement.js:212`) puts the builder on the site's ring tile, and while
  the order is walking it plays `walk`. The flag rides into the save (orders are copied
  field by field), so a reloaded game keeps the pose it was at.
- checks: `tools/checks/13-render.js` gains section 16d — it builds a 2x2 house and a 1x1
  blacksmith site at 45 %, reads the alpha each body was painted with out of the recorded
  draw calls and asserts the old ghost rectangle is gone (9 → 11), and
  `tools/checks/02-sprites.js` splits its single `build` assertion into the two phases,
  walk en route and `farm_a`/`farm_b` at the site (13 → 14). Both failed before the fix
  and pass after (307 → 310 in the suite).
- `preview.png` regenerates byte-identical (the stock frame's buildings are all finished,
  so no site is in it); the site look was judged on a scratch frame of a 45 %-built house
  with a builder on its ring.

### Fixed — `docs/TODO.md` P1-6: every unit uses the same corner of a building

- `workPos(Game, b, u)` (`src/entities.js:159`) answered one fixed tile — the first free
  tile around the footprint, its north-west corner — no matter who asked: four calls for
  the Town Center gave one spot, and a villager south-east of a site walked all the way
  around it to stand at the opposite corner. It now takes the unit and answers with the
  walkable ring tile nearest to him, taken from the ring `standingSpots` already
  enumerates, so a builder east of a 3x3 site works from its east side and two villagers
  arriving from opposite sides take different tiles. With no unit to be near yet — a
  trained unit (`src/sim.js:14`), boot's roster fallback (`src/boot.js:81`), a fixture
  placing one (`src/entities.js:95`) — the answer is the ring's first tile, the single
  spot spawning used before.
- `standTarget` (`src/movement.js:259`) passes its own unit through, so the `build`,
  `go_deposit` and `attack` branches all get the spot on the side the unit is on, and
  `makeBuilding` relocates each unit caught under a new footprint to the ring tile nearest
  to him instead of shipping everybody to one corner.
- checks: `tools/checks/04-pathfinding.js` gains section 6f, the two tiles the item
  promises (28 → 30 checks, 302 → 304 in the suite), and the checks that used to read the
  single corner — the footprint-relocation check in `tools/checks/03-economy-movement.js`,
  the three T3 fixtures in `tools/checks/04-pathfinding.js` and the spawn fixtures in
  `tools/checks/10-reset-save.js` / `tools/checks/11-sound.js` — now pass the unit they are
  placing instead of relying on the fixed answer (both failed before the fix, pass after).

### Fixed — `docs/TODO.md` P1-7: villagers are tiny and distorted

- `tools/gen-atlas.js` wrote one fixed draw box per kind into `SPRITES` (20×20,
  militia 22×22) whatever the source frame was, so the villager's 146×86 farm frame
  collapsed to a blob and its 28×46 idle frame was stretched wide (worst aspect
  error across the table: 64.3 %). Every cell now draws at the frame's own
  proportions: `data/sprites.json` authors one scale per kind — `draw.idleTiles`, the
  height that kind's idle frame gets, in tiles (1.4) — and the tool sets
  `dw = sw × scale`, `dh = sh × scale` for every frame of the kind, which puts the
  worst deviation at 1.6 %.
- Each cell also carries `ax`/`ay`: the pixel of the drawn box that is the figure's
  feet, measured from the cell's own opaque bounding box, so switching animations
  neither lifts the figure off the ground nor slides it. `drawUnits`
  (`src/render.js:150`) blits with that anchor on the unit instead of centring the
  box — the same offset is correct mirrored, since the destination rect is placed in
  the translated space either way. `assets/sprites.png` is byte-identical: the cells
  still sit at their native frame size, only the draw metadata changed.
- checks: `tools/checks/02-sprites.js` gains the aspect-ratio and the
  one-scale-per-kind-plus-anchor assertions (11 → 13), and `tools/checks/13-render.js`
  gains section 16c, which renders a frame and reads the `drawImage` destination back
  for the villager and the militia facing both ways (8 → 9); both failed before the
  fix and pass after (304 → 307 in the suite).

### Fixed — `docs/TODO.md` P1-5: units walk in zigzags

- `findPath` (`src/movement.js:63`) priced a diagonal step and a straight one both at 1
  under a Chebyshev heuristic, so every route of the same step count tied and the one
  returned wandered: on a flat map a 10-tile move east measured 289.5 px of walking for
  its 220 px order (43.6 px of sideways swing) and the same order south 309.1 px
  (65.6 px of swing). Steps now cost the ground they walk — `stepCost`
  (`src/movement.js:19`), 1 straight / √2 diagonal, with the matching
  `max(dx,dy) + (√2−1)·min(dx,dy)` octile heuristic — which leaves the straight line as
  the only optimum: the same four axis moves now walk 219.5 px each, 0.0 px of swing.
- `moveUnit` (`src/movement.js:212`) no longer walks the route's staircase. `routeAhead`
  (`src/movement.js:171`) picks the furthest waypoint a `lineClear`
  (`src/movement.js:137`) straight line reaches from where the unit stands — the route's
  next tile is always the floor, so a large `stop` (a work spot's `CFG.TILE`, a
  building's `reachOf`) cannot stall a leg short of its tile — and `u.path` stays exactly
  what A* returned, only the index moves. The off-axis order (60,60)→(70,63) walked
  245.7 px for a 229.7 px order before, 229.2 px now.
- `tools/checks/04-pathfinding.js`: the reference Dijkstra `refSteps` scored routes by
  step count, which is what the uniform-cost rule made meaningless, so it becomes
  `refCost` — the same √2 rule, written in the harness — and `routeCost` scores the route
  the game returned; the four checks that compared a route's tile count to the reference
  now compare its cost, and the new section 6e pins the walked line itself
  (23 → 28 checks, 297 → 302 in the suite).

### Fixed — `docs/TODO.md` P0-4: villagers cannot be sent to a construction site

- `orderForUnit` in `src/commands.js` had no case for an own building with `built < 1`, so
  right-clicking a foundation handed the villager a plain `move` and the site stayed at
  0 % the moment its builder was pulled away or killed (verified: 60 s of simulation on a
  foundation, no progress). A villager whose click lands on his own unfinished building now
  gets `{ kind: 'build', b: id }`; a finished one is still just the ground a move ends on,
  and an enemy building is still an attack target.
- `build` drafted `pickBuilder`'s single villager — with four villagers selected and one
  house going up, three of them stood around it. `pickBuilders`
  (`src/commands.js:93`) hands the order to every free villager in the selection (the
  selection holding none still falls back to the nearest free villager of the player's
  team, as the button call always did); their work stacks in `updateUnit`, so the same
  house rises in 360 simulated steps with the crew against 751 with one builder, and no
  site depends on a single villager surviving. A builder leaving a site for a new one also
  releases the formation tile he held (`issueOrder`'s rule for non-move orders).
- `tools/checks/05-construction.js` pinned the old rule (two placements from a
  4-villager selection take two distinct builders, one each); that assertion is replaced
  by three pinning the new one — the whole crew lands on one site, the crew's house beats
  the single-builder house on time, and the crew a finished site releases raises the next
  one (43 → 45 checks). `tools/checks/08-input.js` gains the
  right-click-on-your-own-foundation case (29 → 30 checks; 294 → 297 in the suite).

### Fixed — `docs/TODO.md` P0-3: a building placed on an invalid spot appeared elsewhere

- `build` in `src/commands.js` answered a click it could not build on — an occupied or
  off-map footprint, or any tile more than 7 tiles from the builder — by putting the
  building on `findSite`'s pad next to the villager and still toasting `started` (verified:
  50 of 176 placements landed on a different tile than the one clicked). A click is now the
  site or a refusal: `Can't build there`, nothing spent, no building, and `Game.placing`
  stays armed. The 7-tile limit is gone — the builder walks — so a click 20 tiles away
  builds exactly on that tile, and `findSite` only answers the button call that carries no
  tile. That rule is now one exported function, `canPlaceAt` (`src/commands.js:156`), which
  `drawGhost` (`src/render.js:240`) uses too: the ghost used to judge the tile with
  `siteFree` alone, so an age-gated kind hovered green where the click would only answer
  `requires Feudal Age`. `near` (`src/commands.js`) is gone with the range limit.
- `tools/checks/05-construction.js` pinned the old rule (a far click "still builds at
  findSite's pad", an occupied click "falls back to findSite"); both assertions are replaced
  by five that pin the new one — water, one of your own buildings, off the map, 20 tiles
  away, and the surviving no-tile button call (40 → 43 checks), and `tools/checks/13-render.js`
  now also compares the ghost's recorded fill style against that rule (3 → 8 checks;
  286 → 294 in the suite).

### Fixed — `docs/TODO.md` P0-2: the placement preview is invisible

- `drawGhost` in `src/render.js` painted the ghost at `tx * CFG.TILE` — world coordinates —
  while every other draw function subtracts `Game.cam`, so the preview only sat on the
  cursor while the camera was at 0,0 and disappeared as soon as it moved (verified: with
  `Game.placing = 'house'` and the camera at (338, 900) nothing was drawn near the
  pointer). It now converts the cursor's tile to view space the way `drawBuildings` does.
  The stub 2D context in `tools/lib/harness.js` records the arguments of every draw call
  (`ops` / `clearOps()`) instead of only counting them — a counted `fillRect` passed
  wherever it was painted — and `tools/checks/13-render.js` compares the recorded ghost
  rectangles against the cursor tile at three cameras (283 → 286 checks).

### Fixed — `docs/TODO.md` P0-1: footer buttons ignore real mouse clicks

- `renderHud` now compares the footer and result markup against the string it last wrote
  (`Game.dom.hudLast` / `Game.dom.resultLast`) instead of `el.innerHTML`, which a browser
  serialises back differently (`<button disabled>` comes back as `disabled=""`). The
  footer used to be rebuilt 60 times a second, so the button under the pointer was
  replaced between mouse-down and mouse-up and every footer click — build, train,
  research, trade, cancel, demolish, age up, new map — armed nothing (hotkeys worked).
  The harness stub element now serialises the way the DOM does and counts its writes in
  `_htmlSets`, and `tools/checks/09-hud.js` proves a changed frame writes each panel once
  while an unchanged frame writes neither again (282 → 283 checks).

### Split the single file into `src/` — no behaviour change

`index.html` was 3116 lines and `tools/headless-check.js` 3799; both had outgrown what a
person or a model can hold at once. The code is byte-for-byte the same functions in new
places: all 278 existing checks pass, `preview.png` and `assets/sprites.png` are unchanged.

- **The game:** `index.html` keeps the markup and an ordered `<script src>` list; the code
  is fifteen classic scripts in `src/` (`config`, `world`, `entities`, `sim`, `movement`,
  `economy`, `commands`, `ai`, `save`, `sound`, `render`, `hud`, `input`, `boot`, `main`)
  and the styles are `src/style.css`. Still no build step and no modules — the scripts share
  one global scope, so the page works from disk and from Pages unchanged. The "one file"
  constraint in `AGENTS.md` is replaced by "no build step".
- **The tools:** `tools/lib/load-game.js` is the one loader (it reads the script list from
  `index.html` and runs the files in order under their real names), replacing four copies
  of extract-the-`<script>`-to-a-temp-file. `check-stats.mjs` and `gen-atlas.js` now
  regenerate their blocks in `src/config.js`.
- **The checks:** split by topic into `tools/checks/00…12-*.js`, each an independent file:
  it requires `tools/lib/harness.js` (stub DOM, boot, shared fixtures), gets its own
  freshly booted `Game` and runs alone or through the `headless-check.js` runner, which
  runs them in parallel (~1 s). Two checks leaned on state an earlier section left behind
  and now build it themselves (a finished house); `train: unit spawns` used to pass on
  "+2 units" because the enemy AI happened to train in the same window — it now counts
  the player's units, and the AI gets the direct coverage it never had in `12-ai.js`
  (278 → 282 checks).
- **CI:** `.github/workflows/check.yml` runs the checks, the stats check, the docs audit,
  the atlas generator (must leave the tree unchanged) and the preview renderer on every
  push and pull request.
- **The docs audit:** `tools/audit-line-refs.js` follows `src/file.js:NNN` references,
  checks the `ARCHITECTURE.md` file map against what `index.html` loads, and enforces the
  DOM-free rule on the logic files. Its symbol check used to accept any shared word
  (the stop-word list was never applied); it now applies one.
- **Tooling:** `tools/package.json` pins `@napi-rs/canvas` and adds `npm run check`.

## 2026-11-12

### Blacksmith tech tree (T1–T6) — plan `docs/plans/2026-11-12-blacksmith-tech-tree.md`

The first real upgrade path (a0be85c → d93d017); the harness went 156 → 175 checks
across the plan.

- **T1 — the Blacksmith row, the age gate, `k` (a0be85c):** `data/buildings.json` gains
  `blacksmith` (the `BLAC` row: 1800 hp, 150 wood, 40 s, 1×1, **age 1**) and `BLD`
  follows; `build` refuses an age-locked kind before drafting a builder
  (`Blacksmith requires Feudal Age`), the button and the `k` hotkey only appear once
  the age is reached, and `check-stats.mjs` learned the row's `age` field
  (156 → 160 checks).
- **T2 — vendored techs (25b331a):** `data/techs.json` vendors Forge, Scale Mail,
  Fletching and Bracer (costs, times and effects copied from the vendored sources,
  never retuned) and `check-stats.mjs --write` renders the `TECHS` table beside the
  other section-1 blocks; the check now proves 265 fields.
- **T3 — one combat math (9708a20):** `unitAttack`/`unitArmor` replace the duplicated
  age-scaling expressions in §4 — attack is the row's number × the age multiplier,
  plus the flat attack of every researched tech of the attacker's damage class (a
  tech's +1 stays +1 in every age); armour is the row's plus the
  techs' flat armour, and `hitUnit` lands `max(1, attack − armour)` — while
  `Game.techs` (the researched-id set) joins `createState`/`resetGame`
  (166 checks, the new §9d pins the stack on the melee and pierce paths).
- **T4 — `researchTech` (56d6ade):** a finished blacksmith researches one tech at a
  time; every refusal goes through `toast` before a cost is spent (age, duplicate,
  busy slot, cost, building mismatch — `Barracks cannot research Forge`) and the
  finish adds the id to `Game.techs` (166 → 172 checks).
- **T5 — the research surface (d93d017):** `commandsHtml` offers a `data-act="research"`
  button per unresearched tech (disabled when unaffordable or in flight), `queueHtml`
  grows the `Researching Forge` bar beside the training branch, `drawBuildings` picks
  the on-map bar's total from the research slot or the queue, `infoHtml` lists
  `Upgrades:`, the click handler dispatches `research`, and `preview.png` regenerates
  with the blacksmith beside the squad (172 → 175 checks).
- **T6 — docs sync:** this entry plus `docs/GAME_RULES.md` (a `## Technologies
  (TECHS)` section, the Blacksmith row and the rewritten damage bullet),
  `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` (P1.4 shipped) and `AGENTS.md`
  (`data/techs.json` in the truth table) re-pointed at the final file — every
  `index.html:NNN` reference and section range re-measured through
  `tools/audit-line-refs.js`.

### Market and Watch Tower (T1–T6) — plan `docs/plans/2026-11-12-market-watch-tower.md`

Two Feudal buildings (8ae891b → 9fa8321); the harness went 175 → 194 checks across the
plan.

- **T1 — the two rows, `e` and `c` (8ae891b):** `data/buildings.json` gains `market`
  (1800 hp, 2×2, 175 wood, 60 s, **age 1**) and `watch_tower` (850 hp, 1×1, 35 wood +
  125 stone, 80 s, **age 1**) on their vendored rows, plus the authored
  `trade: { sell: 33, buy: 67 }` the upstream table has no column for;
  `check-stats.mjs` learns a `tradeValue` helper and the optional-field pattern so the
  generated `BLD` carries `trade`, `assets/sprites.png` stays byte-identical (both rows
  are `noSprite`), and the `e`/`c` hotkeys join the keydown block (175 → 181 checks).
- **T2 — `trade` (d494576):** one DOM-free §4 command sells or buys exactly 100 units of
  food, wood or stone at the row's own rate; every refusal goes through `toast` before a
  unit moves (`Cannot trade <>` for a resource the row excludes or an unknown direction,
  `Not enough <res>`, `Still building`, the age gate, and a building with no trade rates
  — `Barracks cannot trade`), and the `AoE2` export gains `trade` (181 → 188 checks).
- **T3 — the trade surface (41ed51e):** `commandsHtml` grows six `data-act="trade"`
  buttons on a finished Market — Sell/Buy per resource, args `food|sell`, `wood|buy`, … —
  each button carrying `disabled` exactly when its own half would be refused, the
  footer's delegated click handler dispatches `trade`, and the panel rebuilds in the same
  tick so the stockpile numbers move on click (188 → 191 checks).
- **T4 — the tower's shot (302d8a1):** checks only, because the Watch Tower adds no
  combat code — they pin the row driving the existing arrow path (attack 5 scaled by the
  age multiplier, accuracy 100, reload 2, reach `lineOfSight × CFG.TILE`), that it holds
  fire while the enemy stands beyond that line, and that the Market (attack 0) never
  fires (191 → 194 checks).
- **T5 — the committed frame (9fa8321):** `tools/render-preview.js` places the pair in
  the `simulateAndRender` fixture beside the blacksmith — Market east, Watch Tower west —
  and `preview.png` regenerates showing all three procedural footprints.
- **T6 — docs sync:** this entry plus `docs/GAME_RULES.md` (the two table rows, the
  three-row age-gate bullet, the Market trade and Watch Tower rules, the `E`/`C` hotkeys),
  `docs/ARCHITECTURE.md` (the §4 contents cell gains `trade`, the render paragraph names
  the `noSprite` pair), `docs/ROADMAP.md` (P1.5 shipped, the leftovers recorded) and
  `AGENTS.md` (the file-length claim, the export line) re-pointed at the final file —
  every `index.html:NNN` reference and section range re-measured through
  `tools/audit-line-refs.js`.

### Uniform HUD frame (T1–T2) — plan `docs/plans/2026-11-12-uniform-hud-frame.md`

One fixed-height footer for every selection state (c2a2472); the harness went 194 → 198
checks across the plan.

- **T1 — one owner, one frame (c2a2472):** `hudState(Game)` answers the one selection word
  the footer is in — `group`, `units`, `building`, `none` — and `hudHtml(Game)` becomes the
  single writer of its markup: the same three panels (`info` | `commands` | `queue`) in the
  same order for every state, stamped on the footer with that word as `data-state`.
  `renderHud` replaces its three `setHTML` calls with one write to `#hud`; the CSS replaces
  `footer{min-height:74px}` with `footer{flex:0 0 74px;height:74px}` plus fixed-height
  `overflow:hidden` `.info` (a title/body/bar grid), `.commands` (a row-based button grid)
  and `.queue` panels, so selecting something no longer resizes the map; `infoHtml` collapses
  a group to a `N units` title plus one per-kind `.sum` line (3 kinds max, `+K more` beyond)
  and gives every state the same title/body/hp shell; §6 delegates command clicks off
  `Game.dom.commands || Game.dom.hud` so the handler survives the footer rebuild in a browser,
  and `infoHtml`/`hudState`/`hudHtml` join the `AoE2` export (the 4 new §11b checks pin the
  per-state frame shape, the `renderHud` write into `#hud` and the fixed footer height);
  `preview.png` regenerates byte-identical.
- **T2 — docs sync:** this entry plus `docs/GAME_RULES.md` (a `## Interface` section),
  `docs/ARCHITECTURE.md` (the §5 render cell and the HUD paragraph), `docs/ROADMAP.md` (the
  Phase-2 item marked shipped) and `AGENTS.md` (the file-length claim, the export line, the
  `Map of this file` span) re-pointed at the final file — every `index.html:NNN` reference
  and section range re-measured through `tools/audit-line-refs.js`.

### Wooden barricade and gated choke points (T1–T6) — plan `docs/plans/2026-11-12-wooden-barricade.md`

A Feudal-gated wall segment (d88ecae → 03ccb2e, review fixes 7a4d7cd and 9d8849b); the
harness went 198 → 217 checks across the plan — 216 from T1–T6 and the controls check
the first fix adds.

- **T1 — the `barricade` row, the `w` hotkey (d88ecae):** `data/buildings.json` gains
  `barricade` — the vendored `WALL` row (150 hp, 3 wood, 7 s, melee armour 2, pierce
  armour 5) with the authored `Barricade` label, 1×1 footprint and **age 1** gate
  recorded in its `source.rule` — `check-stats.mjs --write` renders the `BLD` row (12
  buildings), `w` joins the §6 keydown (pan-up and placement arming share the key), and
  the §7 gated-row and §10 hotkey checks cover it (198 → 201 checks).
- **T2 — the build contract (ac6af15):** six §7d checks pin what the row alone gives the
  game — `siteFree`/`near`/`findSite` placement including the shared-corner case, the
  exact 3-wood spend and 7 s site detail, the `floor(3 × CFG.CANCEL_REFUND)` = 2 cancel
  refund, and a free demolish of a finished segment (201 → 207 checks).
- **T3 — routing around, through and after (baaace0, 9d8849b):** five §6d checks walk
  the gate story on the §6c boards — a built segment's own tile stops being walkable, a
  segment dropped on a cached route reroutes the walker on the next step, demolishing it
  restores the pre-build route, a villager ringed with segments is left idle without a
  route, and popping one ring segment gives him one back — with every expected length
  graded by the harness's own Dijkstra rather than by `findPath` (207 → 212 checks).
- **T4 — the raze path (50a59fb):** four §9g checks put the row inside the existing
  combat fixture — an idle enemy militia acquires the adjacent barricade, the swing
  costs it the table's damage (`atk` − the row's melee armour), the toast names the
  row's own label and the raze never decides a game without a Town Center; the
  expected-toast wording was corrected to the row-derived string (212 → 216 checks).
- **T5 — the committed frame (03ccb2e):** `tools/render-preview.js` places the
  barricade in the `simulateAndRender` fixture — two tiles east and one north of the
  squad, clear of the blacksmith's and Market's pads — and `preview.png` regenerates
  with the fourth flat team-coloured footprint.
- **T6 — docs sync:** this entry plus `docs/GAME_RULES.md` (the table row, the four-row
  age-gate bullet, the new barricade rule, the rewritten controls line naming `W` and
  `ArrowUp` — the wording the `index.html` banner and the footer help line have carried
  since 7a4d7cd), `docs/ARCHITECTURE.md` (the File map spans, the render/input prose) and
  `docs/ROADMAP.md` (P1.6 shipped, the wall leftovers folded into P2.8) and `AGENTS.md`
  (the file-length claim, the export line) re-pointed at the final file — every
  `index.html:NNN` reference and section range re-measured through
  `tools/audit-line-refs.js`.

### Save/load via localStorage (T1–T5) — plan `docs/plans/2026-11-12-save-load.md`

The game remembers the session (a2c29c1 → b411139, review fixes 19ea58e and 5cdf080); the
harness went 217 → 249 checks across the plan — 248 from T1–T5 plus the load check 19ea58e
adds — `check-stats.mjs` 322 → 325 fields, and `assets/sprites.png` / `preview.png` stayed
byte-identical (no render path changed).

- **T1 — the save side (a2c29c1):** `CFG.VERSION: 1` joins `data/units.json` (with its
  `cfgNotes` line and `authored[]` entry) so the schema stamp is vendored like every other
  number, `SAVE_PATH = 'aoe2mini:save'` is declared beside `const AGES`, and the §4
  `save / load` block gets the two-function door to `localStorage` — `storageGet` answers
  `null`, `storageSet` answers `false` (and removes the key on `null`) whenever the platform has
  no storage or refuses the write, which is how node and private mode keep running — plus
  `encodeState` and `saveGame(path, Game, at = now())` writing the `{ version, seed, writtenAt,
  state }` envelope. Pinning `writtenAt` is what turns `save -> load -> save` into a byte
  comparison; the encoded field list becomes the harness's `SAVE_FIELDS` contract, `Game.techs`
  and `Game.blocks` leave as an array and an object, a projectile's target leaves as `tk` +
  `tid`, and an order's `src` leaves as the tile or farm it names (217 → 225 checks, 323 stat
  fields).
- **T2 — the load side (83116d3, 19ea58e):** `loadGame(path, Game, raw = storageGet(path))` answers a
  boolean and never throws — the whole refusal ladder (no slot, empty slot, unparseable text, a
  `version` `migrate` cannot read, a shape `validState` cannot walk) ends in
  `resetGame(Game); return false`. `decodeState` restores in dependency order, bumps `mapEpoch`
  so every cached route re-paths around the loaded buildings, relinks each `order.src` and each
  projectile `t` to the decoded objects instead of frozen copies, and rebuilds `Game.rnd` from the
  envelope's seed. The shipped signature is this three-argument one rather than the design's
  `loadGame(path, raw)`: the target `Game` is the middle argument so a test — or `boot` — can load
  a slot into a game that already exists (225 → 237 checks).
  The farm half of that relink landed in `19ea58e`: `decodeOrder` called the `byId` Map as a
  function (`buildingById is not a function`), so every save carrying a farm `harvest` /
  `go_deposit` order threw inside the decode and was refused as corrupt — it now reads
  `byId.get(e.src.b)`, proven by the `load: a farm source is relinked, not left as a stored
  id` check that commit adds.
- **T3 — the autosave schedule (6ce19b9):** `CFG.AUTOSAVE_DEBOUNCE: 2` and `CFG.AUTOSAVE_EVERY:
  30` join `data/units.json`, `Game.autosaveAt` joins `createState`/`resetGame`, and
  `markDirty(Game)` — called by every §4 mutator and by `stepSim`'s three completion events —
  pulls the schedule earlier and never later, so a burst of commands inside the window costs ONE
  write while a quiet game keeps its 30 s rhythm. The write itself sits in `stepGame` AFTER
  `stepSim(Game, dt)` — the plan said before, and after is what makes the saved payload carry the
  frame that just ran (`state.time === DT`), which is what the new check asserts — so `stepSim`
  itself never writes and harness loops touch no storage (237 → 242 checks, 325 stat fields).
- **T4 — the page surface (b411139):** the header ends with
  `<button id="save" class="save" type="button">Save</button>` — `margin-left:auto` keeps the
  resource row from reflowing, so the header height and `preview.png` cannot move — and clicking
  it writes the slot and toasts `Saved`; `boot` reads the slot straight after `createState()`,
  ahead of the `!d` guard so a doc-less boot restores like a browser one; and the three new-game
  paths (`N`, the footer's `New map`, the victory overlay's `New game`) clear the slot before
  `resetGame`, which schedules the rewrite (242 → 248 checks).
- **T5 — docs sync:** this entry plus `docs/GAME_RULES.md` (the `## Save / load` section and the
  `N` hotkey), `docs/ARCHITECTURE.md` (the §1–§7 and public-surface spans, the §4 block
  citations including `save / load`, `autosaveAt` plus the persistence note in the `Game` block,
  the `### Save / load` subsection and the harness count), `docs/ROADMAP.md` (P2.9 shipped, its
  leftovers folded into P2.12) and `AGENTS.md` (the file-length claim, the export line, the
  `Map of this file` span — the `index.html` banner line for §4 and `stepGame`'s docstring
  carry that wording since 5cdf080) re-pointed at the final file — every `index.html:NNN`
  reference and section range re-measured through `tools/audit-line-refs.js`.

### Sound (T1–T6) — plan `docs/plans/2026-11-12-sound.md`

The game makes noise (d5de1de → 1e5e342); the harness went 249 → 266 checks across the plan,
and `assets/sprites.png` / `preview.png` stayed byte-identical (no render path changed).

- **T1 — the SFX table and `MUTE_PATH` (d5de1de):** `SFX` joins section 1 beside `AGES`, one
  row per sound (`hit`, `arrow`, `build`, `age`, `victory`, `defeat`) with its waveform,
  frequency ramp, duration, gain and the name of the function that fires it, and `MUTE_PATH`
  joins the two storage keys beside `SAVE_PATH`; the new §14 section reads the table instead of
  re-typing specs, so the first check fails on `SFX is undefined` before the table exists and
  then proves every row carries all five fields with a `fire` name the script really defines
  (249 → 250 checks).
- **T2 — `playSfx` (362b9c1):** the synthesiser lands in section 5 — one oscillator ramped
  through the row's `freq` list into a gain envelope, no audio file in the repo — behind
  `Game.sound = { ctx, at, fired }`: `ctx` is one reused `AudioContext` (a platform without one
  answers `false` rather than throwing, which is how node and `render-preview.js` stay quiet),
  `at`/`fired` are the per-frame gate that turns ten hits in one frame into one thud, and
  `isMuted` becomes the single mute read. The five new checks install a counting
  `AudioContext` stub and assert one node per row, the gate, and each silence (250 → 255).
- **T3 — the header speaker toggle (f2d03b6):** the header gains
  `<button id="mute" class="mute" type="button">Sound on</button>` with a dimmed
  `[aria-pressed="true"]` variant, and mute gets two writers with one setter —
  `applyMuteButton` stamps only the button (so `boot` can honour a saved preference without
  writing the key back) and `setMuted` stamps plus persists to `aoe2mini:muted`; the click
  listener joins `boot`'s wiring block. Sound stays out of `Game` and out of the save slot —
  presentation, not simulation (255 → 259 checks).
- **T4 — the combat rows wired (e3f25b0):** `hitUnit` opens with `playSfx(Game, 'hit')` before
  the hp maths and `spawnArrow` with `playSfx(Game, 'arrow')` before the projectile is pushed,
  and the harness gains `callSites()` — a scan that maps every `playSfx` call in the file to
  the function that owns it, so a row cannot be fired from the wrong place or a fourth place
  (259 → 262 checks).
- **T5 — the remaining rows wired (1e5e342):** the `b.built >= 1` branch of `updateUnit` plays
  `build`, `upgradeAge` plays `age` only when the age actually goes up, and `setResult` ends
  with `playSfx(Game, Game.result)` — one statement serving the `victory` and `defeat` rows and
  the `if (Game.result) return` guard keeping it to one chord per game; T5 adds no exports —
  the checks reach the three paths through the exported `stepSim`, `upgradeAge`, `demolish`
  and `removeBuilding` (262 → 266 checks, the call-site expectation now all five owners).
- **T6 — docs sync:** this entry plus `docs/GAME_RULES.md` (the `## Sound (SFX)` section and
  the `sound` field added to the save section's excluded list), `docs/ARCHITECTURE.md` (the §1
  row gaining `SFX`/`MUTE_PATH`, the §5 row naming the audio door, §6/§7 wording, the
  public-surface export list, the harness count and every restamped span), `docs/ROADMAP.md`
  (P2.10 shipped) and `AGENTS.md` (the file-length claim) re-pointed at the final file — every
  `index.html:NNN` reference and section range re-measured through
  `tools/audit-line-refs.js`.

### Touch controls and responsive layout (T1–T4) — plan `docs/plans/2026-11-12-touch-controls-layout.md`

The phone gets an input path and a layout (e6a1f27 → 1968834); the harness went 266 → 275
checks across the plan and 278 with its review round, and `assets/sprites.png` /
`preview.png` stayed byte-identical (no render path changed).

- **T1 — one input path (e6a1f27):** the `#view` canvas gains `touch-action:none` and the
  DOM block's `mousemove`/`mousedown`/`mouseup` listeners become
  `pointermove`/`pointerdown`/`pointerup` plus `pointercancel` — PointerEvent covers mouse
  *and* touch, so desktop behaviour is unchanged and §10/§10b's fires were retyped rather
  than duplicated (a `mousedown` fired at a block with no `mousedown` listener would pass
  vacuously). The click decisions move into two pure §6 helpers: `pointerDown` arms a
  placement or anchors `Game.drag = { x0, y0, x1, y1, t0, id }`, `pointerUp` keeps the old
  body — tap selects the unit or building under the point, a moved press selects the box,
  villagers win a mixed drag. One pointer per drag: a second finger cannot move the anchored
  box or end the drag it does not own, and `pointercancel` drops the drag with no selection
  and no order (266 → 269 checks).
- **T2 — press-and-hold commands (238ac88):** `LONG_PRESS_MS = 600` and `LONG_PRESS_SLOP = 8`
  join the hand-written section-1 block beside `MUTE_PATH` — not `CFG`, which
  `tools/check-stats.mjs` generates from `data/` — and `pointerUp` grows the hold branch
  ahead of the select branches: a press that long that stayed within 8 px of its start calls
  the same `issueOrder` the `contextmenu` listener calls and leaves the selection alone,
  exactly as a right-click does. The new §10c section proves all three releases — hold on
  ground, short tap, move-then-release (269 → 272 checks).
- **T3 — the 720 px layout (1968834):** one `@media (max-width:720px)` block written last so
  it wins the cascade — header padding `6px 10px` → `2px 6px` (gap `14px` → `6px`) and the
  footer keeps the HUD-frame round's exact `flex:0 0 74px;height:74px` while its
  `flex-direction` turns to `column`, stacking info (title only), the command grid and the
  queue line inside the same 74 px; `#stage` keeps the freed header rows for the map. No
  selector is renamed and nothing is hidden on desktop. New §11c asserts the block's position
  *and* the shared `74px` in both readers (272 → 275 checks).
- **T4 — docs sync:** this entry plus `docs/GAME_RULES.md` (the touch sentence in
  `## Camera & controls`, the 720 px paragraph in `## Interface`), `docs/ARCHITECTURE.md` (the
  §1 row gaining `LONG_PRESS_MS`/`LONG_PRESS_SLOP`, the §6 row naming the two pointer helpers
  and every restamped span), `docs/ROADMAP.md` (P2.11 shipped) and `AGENTS.md` (the
  file-length claim) re-pointed at the final file — every `index.html:NNN` reference and
  section range re-measured through `tools/audit-line-refs.js`.

- **Review fixes (b0f290a → b142da0):** `applyState` now drops a saved drag that names no
  owning pointer — every save from before `pointerDown`/`pointerUp` stored
  `{ x0, y0, x1, y1 }`, and the listeners only ever finish the drag whose `id` matches the
  pointer they came from, so such a drag could never be cleared and loading one froze
  selection, the cursor and edge-scroll for the session (276); a finger release clears the
  `Game.mouse` hover the edge-scroll band reads, a mouse release keeps its cursor (277);
  §10c pins `LONG_PRESS_SLOP` at its real boundary — 7 px of drift still commands, 8 px is
  already a drag — and §10 asserts the second finger's own `pointerdown`, the owner-guard
  branch that used to go unexercised (278); `AGENTS.md`'s §6 label in the
  `Map of this file` banner says `pointer (mouse + touch), keyboard`.

## [Unreleased] — 2026-11-11

### Board rules pass (T1–T5) — plan `docs/plans/2026-11-04-board-rules.md`

One pass over the board rules (d9b16b4 → 9d0b55f); the per-task entries are merged here
at T6, and the harness went 99 → 111 checks across the pass.

- **T1 — halved starting economy (d9b16b4):** `CFG.START` 200/200/100/100 →
  100/100/50/50, villager `CARRY_MAX` 10 → 15, `GATHER_RATE` 3.0 → 1.5/s, villager and
  militia train times 5 s / 6 s → 2.5 s / 3 s, berry tiles 110 → 150 food. Numbers only;
  a new `tuning: CFG and KINDS match the agreed numbers` check pins all six values so a
  silent revert can't pass (100 → 101 checks).
- **T2 — solid terrain (7a504f1):** `walkable` now rejects water, resource tiles with
  stock and occupied building tiles alike, so units walk around forests, ore and
  buildings and work from the neighbour tile; `workSpot` offers only walkable neighbours
  and `makeBuilding` relocates a unit caught under a new footprint to `workPos(b)`. The
  harness's per-frame water scan became a solid-tile scan plus the relocation check
  (101 → 104 checks).
- **T3 — one berry cluster per Town Center (ff38ca8):** `berryCluster` replaces the 7
  scattered patches and the 2 ring berries with exactly one connected 6-tile cluster per
  keep at 5–8 tiles' distance — each start reads as one grove beside the keep and the
  starters reliably open on their own berries (three `map:` checks pin the layout;
  104 → 107 checks).
- **T4 — depleted tiles vanish, re-queue within 5 tiles (c8799a5):** `depleteTile`
  reverts a tile the moment its `amount` reaches 0 to `T.GRASS` (farms still empty in
  place), and `nextSource`/`resumeGather` now search the same resource within 5 tiles
  only — the radius-14 band and the any-resource radius-20 fallback are gone, so a
  villager whose grove is spent takes the next bush beside him or goes idle (three
  `depletion:` checks; 107 → 110 checks).
- **T5 — one builder per building (9d0b55f):** `build()` no longer re-picks the same
  first villager from the selection on every placement — the multi-build bug that
  yanked each builder off his unfinished site — `pickBuilder` assigns the nearest
  **idle** villager, never takes one off a `built < 1` site, and refuses with `All
  villagers are building` when none is free; two placements from one 4-villager
  selection now raise two complete buildings (110 → 111 checks).

### Cancel construction + demolish (T1–T5) — plan `docs/plans/2026-11-04-cancel-demolish.md`

Phase 2 of the 2026-11-04 rules pass (ed29144 → bd73da6). `CFG.CANCEL_REFUND = 0.8` and
`refund()` joined as the single crediting writer of `Game.res` (T1); one `removeBuilding`
path is now shared by `hitBuilding`, cancel and demolish and also clears the
`selectedBuilding` a raze used to leave dangling (T2); `cancelConstruction` refunds the
floored 80% of a site's defined cost regardless of progress and frees its builders (T3);
`demolish` removes a finished own-team building for nothing, protecting Town Centers and
buildings with a training queue (T4); the footer renders and dispatches `Cancel`/
`Demolish` buttons (T5). Harness 111 → 119 checks (the `tuning:` pass plus refund, three
`cancel:`, three `demolish:` and the `ui:` dispatch checks; the §9b raze check now also
asserts the selection clears).

### OG content port (T1–T7) — plan `docs/plans/2026-11-11-og-content-port.md`

The invented numbers and the drawn art are gone: the stats come from the vendored AoE2 tables
and every sprite frame from the ripped graphics (f3ff6e6 → 08ca6a8), and the harness went
121 → 137 checks across the plan.

- **T1 — vendored tables + the stats check (f3ff6e6):** `data/units.json`,
  `data/buildings.json` and `data/README.md` vendor the community `.dat` / `aoe2techtree`
  rows the game is built from (id + `internal_name` per row, fetch date and swap rule
  documented); `tools/check-stats.mjs` extracts the `<script>`, requires it and exits 1 with
  one line per drifted field, `--write` renders the three §1 blocks. Written before the code
  it guards, and documented in `README.md` + `AGENTS.md` so `audit-line-refs` stays green.
- **T2 — section 1 becomes generated (ba010c6):** `CFG`/`KINDS`/`BLD` are now the rendered
  form of `data/` — villager 25 hp, atk 3, 0.64 s, 18 px/s (0.8 tiles/s), 50 food, 25 s;
  militia 40 hp, atk 4, 0.5 s, 20 px/s, 50 food + 20 gold, 21 s; `CFG.CARRY_MAX` 15 → 10;
  Town Center 2400 hp (275 wood + 100 stone), farm 480/60, barracks 1200/175, mill 600/100,
  lumber camp 1800/150, mining camp 600/100 — with `w`/`h`/`pop`/`field` untouched so the
  footprint rule keeps holding. The §5 `tuning:` check reads `data/` instead of six
  hand-typed literals, and a second one pins `KINDS.speed === round(tiles/s × CFG.TILE)` —
  the exact bug class the tiles/s → px conversion introduces (121 → 122 checks).
- **T3 — the atlas is composed, not drawn (629d0ec):** `data/sprites/` + `data/sprites.json`
  carry the ripped frames (the source's player-colour ramp mapped onto
  `TEAM[t].dark/main/light`) and `tools/gen-atlas.js` composes `assets/sprites.png` and
  regenerates `SPRITE_SHEET`/`SPRITES`/`WORK_ANIM`/`BLD_SPRITES` — no hand-authored cells
  left in `index.html`; `preview.png` is the real renderer's own frame.
- **T4 — the archer line, from the same table (fc21c75):** `data/units.json` gains `archer`
  (id 4 `ARCHR`: 30 hp, atk 4, range 4, min 0, reload 2 s, accuracy 80 %, 25 wood + 45 gold,
  0.96 tiles/s) and `data/buildings.json` gains `archery_range` (id 87 `ARRG`: 1500 hp,
  175 wood, 2×2, `trains: ['archer']`), with hotkey `R`, the footer button, the delegate case
  and the sprite cells; `preview.png` now places an archer. New §8 train check (the table's
  stats, not new ones) and the §11 placement check.
- **T5 — ranged combat off the table (d51a499):** `KINDS.atkType` splits melee from ranged.
  A shooter faces its mark, stops at `range × CFG.TILE` and fires on the `reload` cadence;
  `Game.projectiles` + `spawnArrow`/`updateProjectiles`/`stepBuildingAttacks` and
  `cfg.PROJ_SPEED` 176 px/s join §4, the hit is gated by `Game.rnd` against `accuracy`, one
  arrow never hits twice and a shot at a corpse doesn't splash. `autoAcquire` compares against
  the per-kind range instead of the single global radius, and the Town Center (attack 5,
  LOS 8) shoots through the same path — 133 checks, incl. the new §9c (125 → 133).
- **T6 — win/lose (08ca6a8):** `setResult` computes the result from the board inside
  `removeBuilding` (the one exit shared by raze, cancel and demolish): no Town Center left on
  one side ends the game — `victory` for the enemy's, `defeat` for yours. `stepSim` stops
  after the clock tick once a result is set, and the `#result` overlay (`resultHtml`, styled
  in the head) renders Victory/Defeat with a `New game` button that calls `resetGame`.
  New §9e (133 → 137).
- **T7 — docs sync:** this entry plus `docs/GAME_RULES.md`, `docs/ARCHITECTURE.md`,
  `README.md` and `docs/ROADMAP.md` re-pointed at the final file — every `index.html:NNN`
  reference and section range re-measured through `tools/audit-line-refs.js`.

### A\* pathfinding — walk around, not into (T1–T5) — plan `docs/plans/2026-11-11-astar-pathfinding.md`

Movement stops being straight-line: orders route over the tile grid and squads arrive in
ranks (a1bcebd → 452a269); the harness went 137 → 156 checks across the plan.

- **T1 — `findPath`, the A\* core (b24d020):** an 8-connected, uniform-cost A\* over the
  tiles `walkable` allows — no diagonal squeezed between two solid tiles, `CFG.ASTAR_MAX_NODES`
  capping one query — exported for the harness and graded against the harness's own Dijkstra:
  the new §6c pins an open-grass route at exactly its optimal length, a route around a water
  inlet within 15% of it, the corner rule and one capped query for an unreachable goal
  (137 → 142 checks).
- **T2 — `moveUnit` walks routes instead of sliding (ddf0a0c):** the move order carries a
  waypoint list (`u.path` / `u.pathFor` / `u.pathAt`), the walk follows the route's tile
  centres and then the exact ordered point, and one rule says when the cache dies — a changed
  goal tile or a bumped `Game.mapEpoch` (a building went up, a tile ran dry) — which is what
  re-paths mid-walk; `walkable` now asks the shared `tileOf` instead of repeating the floor
  maths inline (142 → 147 checks).
- **T3 — every order kind routes to a standing spot (1174571):** `standTarget` answers with
  a tile to stand on — the ordered point itself when it is walkable or already within the
  order's arrival radius, else `workPos` for a building / `workSpot` for any other tile — so
  harvest, build, deposit and attack orders stop walking at a solid centre and all run one
  pipeline, order → standTarget → findPath → step (147 → 151 checks).
- **T4 — formation slots replace the golden-angle scatter (452a269):** `formationSlots` gives
  a group's `move` orders one distinct walkable tile each on a centred `cols = ceil(sqrt(n))`
  grid (the `CFG.UNIT_SEP` pitch expressed on the tile grid, solid and already-held cells
  skipped, the grid grown until everybody is housed, the nearest free slot paired to the
  nearest unit); the slot is written into the order *and* `u.slot` and released when the order
  retires, so a squad arrives in ranks instead of stacked on one tile and a parked group needs
  zero `separate()` pushes (151 → 155 checks).
- **T5 — docs sync:** this entry plus `docs/GAME_RULES.md` (its `## Movement` section now
  documents the routing rule instead of the straight-line limit), `docs/ARCHITECTURE.md` (the
  `pathfinding` sub-block and a `### Pathfinding` section), `docs/ROADMAP.md` (P0.2 shipped)
  and `AGENTS.md` re-pointed at the final file — every `index.html:NNN` reference and section
  range re-measured through `tools/audit-line-refs.js`.
- **review:** `issueOrder` clobbered a selected unit with `u.order = null` — and threw on the
  way — whenever the click resolved to no order for him (a point off the map, or a solid tile
  with no standing spot); the pre-T4 `if (!o) continue;` is back, so such a unit keeps the
  order and the formation slot he had and the group does not ping for an order nobody
  received. §10 gains the check (155 → 156 checks), and the docs it shifted are re-pointed.

### Added
- **Building sprites (task 5):** every built building now blits a team-coloured atlas
  cell instead of the flat footprint rectangle — `BLD_SPRITES`/`bldSpriteFor` join the
  sprite tables (atlas grows 288×48 → 308×158: unit rows on top, building rows below;
  town_center 66×66, house/farm/barracks/mill 44×44, camps 22×22, each cell drawn at the
  exact footprint). `tools/gen-atlas.js` gains `BLD_ART` (one 11×11 art grid per kind —
  keep/roofs/fields/tents, authored once and recoloured via the team palette) and paints
  38 cells from the two tables; the mill now tracks `field` like a farm. Unbuilt
  buildings keep the ghost + progress-bar render, dry farms keep procedural stubble.
  New harness section 5b3 validates every BLD kind × team has a unique in-sheet cell at
  its exact footprint (99 → 100 checks).
- **Lumber Camp (100 wood, hotkey `L`), Mining Camp (100 wood, `G`) and Mill (175 wood,
  `M`)** join `BLD` — camps 1×1, mill 2×2, drawn procedurally for now (atlas art arrives
  with the building-sprites round). Carrying villagers now route by resource instead of
  always walking to the Town Center: wood → Lumber Camp → TC, gold/stone → Mining Camp →
  TC, food → Mill → farms → TC (`dropTargetScore`/`findDropoff`). Harness section 7b plus
  hotkey checks pin the costs, sizes and every routing rule (81 → 92 checks).
- **Militia auto-acquire + retarget-on-kill + razing (task 4):** non-villager fighters
  pick the nearest enemy unit within `CFG.ACQUIRE` (6 tiles) on their own, else the
  nearest built enemy building within `CFG.BUILDING_ACQUIRE` (5) — `autoAcquire` powers
  both the idle state and the snap to the next target when the current one dies.
  Attacks can now target buildings (`order.b`): `hitUnit`/`hitBuilding` centralize
  damage, and a building at 0 hp is razed, removed and re-blocks its tiles. Right-click
  an enemy building to raze it. Harness section 9b (92 → 99 checks); the old
  "attacker took no damage" check becomes "may be countered" — enemies fight back now.

### Changed
- **Sprite atlas v2** (villager redesign): villagers no longer wear the militia's helm —
  bare head with hair, plain tunic, and the tool of whatever they are working at in hand.
  `SPRITES` becomes `kind → animation → [Blue, Red]`: villagers get idle/walk plus
  per-resource work frames (farm/chop/mine, a/b alternating at 4 Hz), militia get
  idle/walk plus attack_a/attack_b. The sheet grew 96×24 → 288×48 (24 cells);
  `spriteFor(kind, team, anim)` resolves a cell and the new pure `unitAnim(u)` decides
  which animation a unit plays from its order. The 1px bob now applies only to walk
  cells — work/swing frames animate through their own art. Harness sections 5b/5b2 pin
  the table shape, cell uniqueness and the order→animation mapping (75 → 81 checks).

### Fixed
- **Villagers stopped collecting food once the berry tile ran dry** (the "food stalls at
  420" report). Two causes: `assignStarter` gave every starting villager the *same*
  nearest tile, and `resumeGather` re-validated that exact tile after depositing — when
  another villager drained it mid-carry the worker went idle forever. Starters now spread
  (max `CFG.WORKERS_PER_TILE = 2` per tile, food first, then wood, then anything) and a
  dead tile falls back through `findAlternative` exactly like `nextSource` does. Verified
  in the sim: gold now accrues (100 → 970 over 120 s) where it previously sat at 775.
  Harness section 5a pins the spread, the food-first order and the retarget (72 → 75
  checks).

- **Half-built buildings offered train buttons** (the "a half-built barracks or Town
  Center still shows its train buttons" report). `b.built` is a 0..1 progress fraction, so
  the truthy gate in `commandsHtml` rendered train buttons for any foundation even while
  `train()` refused with `Still building`; the gate is now `b.built >= 1`. New `ui:`
  check pins both halves — half-built Barracks: Cancel only, finished: Militia (120 → 121
  checks).

## [7fe4d9b] — 2026-11-03

### Added
- Unit art: `assets/sprites.png`, a 96×24 atlas with one 24×24 cell per unit kind × team,
  generated by `tools/gen-atlas.js` from the `SPRITES` table in `index.html` (the table is
  the source of truth; the PNG is deterministic, so regeneration is diffable). `drawUnits`
  blits a unit's cell, mirrors it when the unit walks left and bobs it 1px while walking,
  falling back to the old discs/squares when no atlas is loaded. `index.html` gained
  `SPRITE_SHEET`, `SPRITES`, `spriteFor`, `setAtlas` and `loadAtlas`.
  Harness: sprite-table coverage, atlas injection and facing/walk-clock checks (66 → 72
  checks).
- `tools/audit-line-refs.js`: verifies that every `index.html:NNN` reference in the docs
  still names the code it claims, that the documented section ranges match the banners in
  `index.html`, and that `AGENTS.md`/`README.md` list every file in `tools/`. It found
  seven stale ranges on its first run.
- `AGENTS.md`: repo working rules for agents and humans (single-file constraint,
  verification gate, the >300-line editing rule, deploy check).
- `docs/`: `ARCHITECTURE.md` (file map with line ranges, `Game` shape, sim/render/input
  models, harness design), `GAME_RULES.md` (the implemented ruleset with line refs),
  `CONVENTIONS.md` (naming, formatting, feature recipe, anti-rules), `ROADMAP.md`,
  `CHANGELOG.md`.
- README documents `barracks` and the full age ladder it already supported.

### Fixed
- `tools/render-preview.js` no longer fakes `Image` from a file buffer: an
  `@napi-rs/canvas` 1.1.0 image built that way reports `96x24` / `complete: true` but paints
  nothing, so the first sprite preview showed selection rings over invisible units. The
  harness now decodes the sheet with `loadImage()` and injects it through `setAtlas` — the
  same path a browser's `img.onload` uses — and the check asserts the loaded image matches
  `SPRITE_SHEET` instead of merely existing.
- Hovering a header resource icon or a footer command button panned the camera: the
  document `mousemove` fed canvas-relative coords into the edge-scroll even when the
  pointer was off the canvas (a pointer above the top edge read as "cursor pinned to
  the top edge"). `Game.mouse` is now set only while the pointer is over the canvas or
  during a drag; harness section 10b covers it (63 → 66 checks).
- Docs now match the code: corrected section line ranges and the age-cost rule (Imperial
  is reachable, not blocked).

## [8841d51] — 2026-11-03

### Added
- README with live-site link, feature list, known limits and tool docs.
- Repo published to GitHub Pages from the `main` branch root
  (https://barf-bot.github.io/aoe2-mini/).

## [8e670c3] — 2026-11-03 — "the bug-fix pass"

### Fixed
- **Deposits vanished**: harvesting tick set `u.carry` without `u.carryRes`, so
  `deposit()` credited nothing to any stockpile. Resource gain was 0 in a live sim.
- **Buildings never finished**: `makeBuilding` omitted `time`, so progress became `NaN`,
  the completion branch never ran and `hp` went `NaN`.
- **Fighters couldn't hit anything**: `KINDS` lost `r` (unit radius), so the attack stop
  distance was `NaN` and the unit could never get inside the separation radius.
- **Clicks landed on `NaN`**: `toWorld()` read `view.w`/`view.h` instead of the canvas's
  `width`/`height`, so every click and drag produced `NaN` world coordinates and the
  cursor was unusable.
- **Villagers idled at an empty tile**: added `nextSource()` to retarget the nearest tile
  of the same resource, then any resource.
- Harness: right-click tests asserted on the previously selected unit instead of the one
  `issueOrder()` actually commanded.

### Added
- `tools/render-preview.js`: renders a real frame through `@napi-rs/canvas` and writes
  `preview.png`, proving the renderer runs (not just the simulation).
- Extra harness checks (re-click selection, HUD label wiring).

### Verification
- `node tools/headless-check.js` → **63/63 checks passed** (was 60/62 before the fixes).
- `preview.png` regenerated from the patched renderer and inspected.

## Initial — 2026-11-03

### Added
- First working `index.html`: single-file RTS prototype — seeded 96×96 map with fog of war,
  Town Center and villagers, gathering economy, houses/farms, villager + militia training,
  melee combat, ages, drag-select, control groups, minimap, enemy AI.
- `tools/headless-check.js`: extracts the `<script>` block, stubs the DOM, boots the game in
  node and asserts simulation invariants.
