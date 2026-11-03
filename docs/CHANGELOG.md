# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/); versions are the git
commits on `main`.

## [Unreleased] — 2026-11-03

### Added
- `AGENTS.md`: repo working rules for agents and humans (single-file constraint,
  verification gate, the >300-line editing rule, deploy check).
- `docs/`: `ARCHITECTURE.md` (file map with line ranges, `Game` shape, sim/render/input
  models, harness design), `GAME_RULES.md` (the implemented ruleset with line refs),
  `CONVENTIONS.md` (naming, formatting, feature recipe, anti-rules), `ROADMAP.md`,
  `CHANGELOG.md`.
- README documents `barracks` and the full age ladder it already supported.

### Fixed
- Hovering a header resource icon or a footer command button panned the camera: the
  document `mousemove` fed canvas-relative coords into the edge-scroll even when the
  pointer was off the canvas (a pointer above the top edge read as "cursor pinned to
  the top edge"). `Game.mouse` is now set only while the pointer is over the canvas or
  during a drag; harness section 10b covers it (63 → 66 checks).
- Docs now match the code: corrected section line ranges (banners at 99/163/314/422/810/
  1138/1275) and the age-cost rule (Imperial is reachable, not blocked).

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
