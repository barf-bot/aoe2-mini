# Touch controls + responsive layout (round: P2 #11)

Status: planned

## Design

**What you'll see:** on a phone the game becomes playable with one thumb: tap a unit to select
it, drag on the map to rubber-band a group, press-and-hold ground to issue the command a
right-click gives on desktop. The header and footer stop eating the screen — on narrow widths
the three panels stack and the map keeps its height.

**How it works:** one input path, not two — the DOM block's mouse listeners become
`pointerdown` / `pointermove` / `pointerup` (PointerEvent covers mouse *and* touch, so desktop
behaviour and the existing §10 input checks stay untouched) with `touch-action: none` on the
canvas to kill scroll bounce. The right-click context command gains a touch trigger: a 600 ms
hold that does not move 8 px or more fires the same command dispatch the right-click path uses,
then cancels the drag-select. Layout is CSS-only: a `@media (max-width: 720px)` block that
stacks the footer panels and trims header padding while the fixed-height footer contract from
the HUD-frame round holds.

**Not in this round:** pinch-zoom, two-finger pan, virtual joystick, on-screen keyboard,
gamepad, tablet split-view, minimap drag on touch.

**How we check it:** the selection and command logic stays in pure functions the stub-DOM
harness drives (tap → selection, drag rect → selection, long-press fire → command dispatch,
move-then-release → no command); the CSS checks assert the media query exists and declares the
stacked layout plus the same fixed footer height, so desktop layout cannot drift; `preview.png`
stays byte-identical and `headless-check` / `check-stats` / `audit-line-refs` stay green.

**Hard constraints that survive from `AGENTS.md`:** the game stays one `index.html`; no
framework, no build step, no new image files beyond the one `assets/sprites.png` atlas;
`index.html` is patched, never rewritten; section 4 stays DOM-free; every task names a
proving check and the `Map of this file` banner stays truthful.

Decisions this plan makes where the design left room (fixed here so the executor does not have
to re-decide):

- **Two new pure §6 functions, not a new section:** `pointerDown(Game, p)` and `pointerUp(Game, p)`,
  with `p = { x, y, sx, sy, t, id }` (world point, canvas point, `e.timeStamp`, `e.pointerId`) —
  inserted between `unitsInBox` (`index.html:2642-2644`) and the `buttonAt` comment
  (`index.html:2646-2648`), beside the other pure §6 helpers. `attachInput` (`index.html:2655`)
  keeps the DOM projection (`rect`, `toWorld`, `isView`, the `Game.mouse` edge-scroll write) and
  delegates every decision to them. They are **not** added to the `AoE2` export object — that is
  the existing §6 precedent (`pickUnit`, `pickBuilding`, `unitsInBox`, `buttonAt`, `attachInput`
  are all unexported) and every new check drives them through the registered listeners, which is
  the stronger proof (a listener that never calls the pure function cannot pass).
- **The hold constants live in the hand-written §1 block**, beside `MUTE_PATH`
  (`index.html:385`): `const LONG_PRESS_MS = 600; const LONG_PRESS_SLOP = 8;`. Not in `CFG`:
  `tools/check-stats.mjs` renders `CFG` from `data/units.json`, so a hand-written key there
  breaks it — the same ruling that put `SFX`/`MUTE_PATH` outside the generated blocks
  (`docs/plans/2026-11-12-sound.md:127-131`).
- **No timer for the hold.** `pointerDown` stamps `Game.drag.t0 = p.t`, `pointerUp` compares
  `p.t - t0`; that keeps `Game.drag` the only press state, so `encodeState`
  (`index.html:1917`) / `applyState` (`index.html:2041`) and the §13 `SAVE_FIELDS` list
  (`tools/headless-check.js:2662`) need no edit (the drag object already rides along verbatim and
  `validState` (`index.html:1967`) never inspects its keys). The button rule and the 8 px rule are
  both checked at release, which is what makes the design's four cases one decision table.
- **The harness's `fire` defaults gain `pointerId: 1` and `timeStamp: 0`**
  (`tools/headless-check.js:83-86` and `:103-106`). With `timeStamp: 0` on both the down and the
  up, every existing §10 fire means "a 0 ms press" and therefore keeps its current meaning (the
  tap/box path), so no existing assertion has to be reworded for a reason unrelated to its name.
- **"§10 stays untouched" executed as a rename:** the event names in the existing fires
  (`tools/headless-check.js:2283-2285`, `:2290-2292`, `:2302-2303`, `:2308`, `:2393`, `:2399`,
  `:2403`, `:2405`) change from `mousemove`/`mousedown`/`mouseup` to
  `pointermove`/`pointerdown`/`pointerup`; every check title, body and expected value stays
  byte-identical. Firing `mousedown` at a block that registers no `mousedown` listener would pass
  vacuously, so the rename is what keeps the design's desktop-parity claim provable. The **minimap
  keeps `mousedown`** (`index.html:2774`, fired at `tools/headless-check.js:2380`) — touch on the
  minimap is explicitly out of this round — and the command bar keeps `click` (`index.html:2755`),
  which browsers synthesise from a tap.
- **One-pointer rule** (the minimum needed so "two-finger pan out" does not become "two fingers
  corrupt the selection"): `pointerDown` ignores any pointer while a drag is live unless
  `p.id === Game.drag.id`; `pointerUp` ends only its own pointer's drag; a new `pointercancel`
  listener drops the drag with no selection and no order. `e.button !== 0` stays on
  `pointerdown`/`pointerup` — 0 for touch and for the left mouse button, so a right-click release
  keeps reaching `contextmenu` (`index.html:2713`) and nothing else.
- **The advertised-controls string is pinned in two files**, so both move in one commit:
  `index.html:99` and `tools/headless-check.js:2375` become exactly
  `Controls: left click / tap / drag to select, right click / press-and-hold to command, WASD / arrows to pan.`
  The footer's pan hint (`WASD / arrows or screen edges pan`, asserted at
  `tools/headless-check.js:2376`) documents panning only and is not touched.
- **No new `/* ---- name ---- */` banner in §6** — `tools/audit-line-refs.js:107-124` requires
  every quoted sub-block to exist, and the sound plan's precedent
  (`docs/plans/2026-11-12-sound.md:128-130`) is to add functions under the existing section banner.
- **Check count:** 266 (measured on current `main`) → 269 (T1) → 272 (T2) → 275 (T3); T4 is
  docs-only. `index.html` grows from 3057 lines to ~3080; the exact number is restamped in T4,
  the precedent being `docs/plans/2026-11-12-uniform-hud-frame.md:87`.

## Tasks

- [ ] T1: one input path — `pointerDown`/`pointerUp` in §6, pointer listeners, `touch-action:none`
  - files: `index.html` — the `#view` rule (`index.html:31`, append `;touch-action:none`), the
    header comment's `Controls:` line (`index.html:99`), the new pure `pointerDown`/`pointerUp`
    (inserted at `index.html:2645`, between `unitsInBox` and the `buttonAt` comment), §6
    `attachInput` (`index.html:2655-2718`: `toWorld` gains `t: e.timeStamp, id: e.pointerId`; the
    `mousemove`/`mousedown`/`mouseup` listeners at `index.html:2669-2711` become `pointermove` +
    `pointerdown` + `pointerup` + `pointercancel`; `contextmenu` at `index.html:2713-2718` and the
    minimap `mousedown` at `index.html:2773-2783` untouched);
    `tools/headless-check.js` — `stubEl.fire` defaults (`:83-86`) and `doc.fire` defaults
    (`:103-106`) gain `pointerId: 1, timeStamp: 0`, the §10 (`:2278-2381`) and §10b
    (`:2383-2408`) fires are retyped to the pointer names, the pinned banner string (`:2373-2378`)
    is updated, and a `const styleCss` + `#view` check is added in §11b beside `footerRule`
    (`:2616-2621`).
  - change: `pointerDown(Game, p)` owns what `mousedown` did: `Game.placing` →
    `build(Game, Game.placing, p.x, p.y)` and return (the old code read `Game.cursor`, which this
    replaces with the same numbers derived from the event, and no longer dereferences a null
    cursor); otherwise start `Game.drag = { x0: p.sx, y0: p.sy, x1: p.sx, y1: p.sy, t0: p.t, id: p.id }`
    — but only when no drag is live or the event comes from the pointer that owns it. `pointerUp(Game, p)`
    is the old `mouseup` body moved verbatim (`Game.selectedBuilding = null`; `dx < 4 && dy < 4` →
    `pickUnit`/`pickBuilding`; else `unitsInBox` with the villager-preference filter) plus the
    `if (!Game.drag || p.id !== Game.drag.id) return;` guard and `Game.drag = null`. The
    `pointermove` listener keeps its current body (`Game.cursor`, the `isView`-gated `Game.mouse`
    write, `Game.drag.x1/y1`) and the `pointerup`/`pointercancel` listeners are one-line calls.
    No behaviour change on desktop; the hold rule arrives in T2, so this commit is provably a
    rename plus an extraction.
  - done when: `node tools/headless-check.js` prints `269/269 checks passed`, exit 0 (266 + 3 new);
    the §10 check titles it must still print are unchanged — `input: click selects the unit under
    the cursor`, `input: drag box selects the units inside it`, `input: re-click still selects the
    right unit`, `command: right-click on an enemy orders an attack`, `input: the advertised
    controls name the keys the handler implements` and §10b's three — now satisfied through the
    pointer listeners; `node tools/render-preview.js --out /tmp/touch-t1.png` writes a PNG whose
    sha256 equals the committed `preview.png` (the tool paints only `#view`; CSS and listener
    names move no pixel — precedent `docs/plans/2026-11-12-uniform-hud-frame.md:84-86`);
    `node tools/check-stats.mjs` exits 0; `assets/sprites.png` byte-identical.
  - test: written first in the same commit (retyping §10's fires to `pointer*` goes red the moment
    the listeners still answer to `mouse*` — `Game.selection` comes back empty — then green once
    `attachInput` registers the pointer handlers), plus three new checks:
    `ui: the canvas declares touch-action:none so a touch drag cannot scroll the page` (the
    `#view{…}` rule extracted from `<style>` contains `touch-action:none`; reuses the §11b
    `footerRule` extraction pattern at `tools/headless-check.js:2616`);
    `input: a second finger cannot move the anchored box` (`pointerdown` `pointerId:1` at a
    village, then `pointermove` `pointerId:2` 12 px away → `Game.drag.x1 === Game.drag.x0`;
    `pointerup` `pointerId:2` → `Game.drag` still live; `pointerup` `pointerId:1` → `Game.drag`
    `null` and `Game.selection` is the same single-unit answer the same coordinates produced
    before, so the two paths agree);
    `input: pointercancel drops the drag without selecting or commanding` (capture `selection`,
    `selectedBuilding` and the leader's `order`, fire `pointerdown` then `pointercancel` →
    `Game.drag === null` and all three captured values byte-equal).
    Visual: `node tools/render-preview.js` + look at `preview.png` — expected byte-identical, the
    proof that the desktop frame did not move.

- [ ] T2: press-and-hold issues the command a right-click gives
  - files: `index.html` — §1 hand-written block after `MUTE_PATH` (`index.html:385`, add
    `const LONG_PRESS_MS = 600; const LONG_PRESS_SLOP = 8;`), §6 `pointerUp` (the function T1 put
    at `index.html:2645`) gains the hold branch; `tools/headless-check.js` — a new
    `/* ---- 10c. touch: press-and-hold command (this plan, T2) ---- */` between §10b's last check
    (`:2408`) and the §11 banner (`:2410`).
  - change: `pointerUp` becomes the design's decision table, in this order — after the drag guard
    and `Game.drag = null`,
    `if (dx < LONG_PRESS_SLOP && dy < LONG_PRESS_SLOP && p.t - t0 >= LONG_PRESS_MS) { issueOrder(Game, p.x, p.y); return; }`
    (the identical call the `contextmenu` listener makes at `index.html:2717`, so the touch trigger
    and the right-click trigger cannot diverge; selection and `selectedBuilding` stay untouched, as
    a right-click leaves them); else the existing `dx < 4` tap-select branch, else the box-select
    branch. The `4` stays a literal — it is `index.html:2700`'s own rule moved in T1, and the two
    slops answer different questions. Nothing else in the file changes.
  - done when: `node tools/headless-check.js` prints `272/272 checks passed`, exit 0 (269 + 3);
    `node tools/render-preview.js --out /tmp/touch-t2.png` sha256 equals the committed
    `preview.png`; `node tools/check-stats.mjs` exits 0 (the §1 addition is in the hand-written
    block, not a generated table); `assets/sprites.png` byte-identical; the existing
    `command: right-click on an enemy orders an attack` and `command: right-click on ground orders
    move/gather` checks still pass, now beside a touch route to the same dispatch.
  - test: written first (red — a 700 ms release today selects, it does not order), then green —
    `input: a 600 ms hold on ground issues the order the right-click path uses` (select a
    villager the T1 way, capture his order, then `pointerdown` `timeStamp: 0` at a ground point
    44 px right and `pointerup` `timeStamp: 700` at the same point: `pick.order.kind` is
    `move`/`harvest` — the same assertion pair as `tools/headless-check.js:2313-2314` reached
    through the listener — `Game.drag === null`, and `Game.selection`/`Game.selectedBuilding` are
    exactly what the tap set);
    `input: a hold shorter than 600 ms selects and commands nobody` (`timeStamp: 0` → `300` at the
    same point: `Game.selection[0] === pick.id`, his `order` object byte-equal to before — the
    design's desktop tap, unchanged);
    `input: moving then releasing commands nobody, whatever the hold` (`pointerdown` `timeStamp: 0`
    12 px off a villager, `pointermove` to him, `pointerup` `timeStamp: 700` on him: the box
    selection contains him, his `order` is unchanged, `Game.drag === null` — the design's
    "move-then-release → no command").

- [ ] T3: the 720 px responsive layout — stacked footer, trimmed header, same fixed height
  - files: `index.html` — the `<style>` block (`index.html:7-69`, insert the media block after the
    `.hint` rule at `index.html:68`, immediately before `</style>` at `index.html:69`);
    `tools/headless-check.js` — a new `/* ---- 11c. responsive layout (this plan, T3) ---- */`
    between §11b's end (`:2648`) and the §12 banner (`:2649`).
  - change: CSS only, and it is the last rule before `</style>` so the checks can slice it with one
    regex:
    `@media (max-width:720px){`
    `  header{padding:2px 6px;gap:6px}`
    `  footer{flex:0 0 74px;height:74px;flex-direction:column}`
    `  .info{flex:0 0 22px;height:22px;padding:2px 8px;display:block}`
    `  .info .body,.info .hp{display:none}`
    `  .commands{flex:1 1 auto;height:auto;padding:2px 8px;grid-auto-rows:20px}`
    `  .queue{flex:0 0 18px;height:18px;padding:1px 8px}`
    `}`
    The footer keeps the HUD-frame round's exact `flex:0 0 74px;height:74px` and only changes
    direction, so the three panels stack inside the same 74 px (info title only, a scrollable-height
    command grid, the queue line) and `#stage{flex:1 1 auto}` (`index.html:30`) gives the freed
    header pixels to the map. No selector is renamed and nothing is hidden on desktop.
  - done when: `node tools/headless-check.js` prints `275/275 checks passed`, exit 0 (272 + 3);
    the pre-existing `hud: the CSS declares one fixed footer height, not a min-height`
    (`tools/headless-check.js:2618-2621`) still passes unchanged — the desktop rule is not edited;
    `node tools/render-preview.js --out /tmp/touch-t3.png` sha256 equals the committed
    `preview.png` (the tool renders a 1200×700 `#view`, wider than the breakpoint, so the block
    paints nothing new — the CSS assertions, not a screenshot, are this task's proof);
    `node tools/check-stats.mjs` exits 0; `assets/sprites.png` byte-identical.
  - test: written first (red — no `@media` in `<style>`), then green; all three parse the `<style>`
    text and assert the ordering as well as the contents, which is the design's "desktop layout
    cannot drift":
    `ui: the CSS ships a max-width:720px block after the desktop rules` (the `@media
    (max-width:720px){` index is greater than the base `footer{` index and less than `</style>`);
    `ui: the responsive footer stacks the three panels and keeps the 74px height` (the block's
    `footer{…}` contains `flex-direction:column` **and** `height:74px`, and that `74px` equals the
    height the base `footer{…}` rule declares — one value, two readers);
    `ui: the responsive block trims the header padding the desktop rule declares` (the block's
    `header{…}` padding is `2px 6px`, not the base rule's `6px 10px`, and `gap` shrinks from `14px`
    to `6px`).

- [ ] T4: docs sync and the full verification pass
  - files: `docs/GAME_RULES.md` (the `## Camera & controls` section at `:324` gains the touch
    sentence — tap / drag / press-and-hold 600 ms — and the `## Interface` section at `:308` gains
    the 720 px stacked-footer paragraph; every `index.html:NNNN` ref in both sections that T1-T3's
    added lines shifted is re-pointed), `docs/ARCHITECTURE.md` (the §1 row `:11` span, the §6 row
    `:16` span and its Contents cell — name `pointerDown`/`pointerUp` without parentheses so
    `tools/audit-line-refs.js:112` does not read them as a sub-block citation — the §7 row `:17`
    and the `—` public-surface row `:18` restamped), `docs/CHANGELOG.md` (a dated 2026-11-12
    section for this plan with the per-task commits and the 266 → 275 check trail, in the shape of
    the sound entry), `docs/ROADMAP.md` (P2 item 11 **Touch controls** marked shipped 2026-11-12
    with this plan's link, like item 10 at `docs/ROADMAP.md:70-75`), `AGENTS.md` (the
    `` `index.html` is 3057 lines `` claim at its Editing-rules paragraph restamped to the real
    count), and this plan's `Status: done`.
  - change: docs only, one commit, no code edits — it closes the line-ref drift T1-T3 leave.
  - test: `node tools/audit-line-refs.js` green (section spans, cited symbols, the `tools/`
    inventory, the file-length claim), then the full `AGENTS.md` set: `node
    tools/headless-check.js` (`275/275 checks passed`, exit 0), `node tools/render-preview.js` +
    look at `preview.png` (unchanged), `node tools/gen-atlas.js` (`assets/sprites.png`
    byte-identical), `node tools/check-stats.mjs` (exit 0 — the generated tables are untouched by
    this round).
