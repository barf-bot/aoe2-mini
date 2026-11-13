# Conventions

Style rules extracted from the code so new code matches the file it lives in. For the
repo-level workflow rules (verification, deploy) see `../AGENTS.md`.

## File shape

- `index.html` is markup plus the ordered `<script src>` list; styles are `src/style.css`;
  code is `src/*.js`. The file map in `ARCHITECTURE.md` says what lives where.
- The scripts are **classic scripts sharing one global scope** — no `import`/`export`, no
  bundler. Outside `src/config.js` and `src/main.js` a file holds only function
  declarations, so files can call each other regardless of load order. A new top-level
  `const`/`let` belongs in `src/config.js`; mutable state belongs on `Game`.
- Every file starts with `'use strict';` and a one-paragraph header saying what it owns.
  Keep files around 300 lines: when one outgrows that, split it by topic and add the
  `<script>` tag and the `ARCHITECTURE.md` row.
- The logic files (`world`, `entities`, `sim`, `movement`, `economy`, `commands`, `ai`) are
  pure: signature style `function foo(Game, ...)` returning a value or `null`, never naming
  `document`/`window`. `tools/audit-line-refs.js` enforces it. Everything DOM lives in
  `render`, `hud`, `input`, `boot`.

## Naming

| Kind | Convention | Examples |
|---|---|---|
| Constant tables | `SCREAMING_CASE`, one `const`, keys = identifiers | `CFG`, `KINDS`, `BLD`, `AGES`, `T`, `PAL`, `TEAM` |
| Factories | `make<Thing>` | `makeWorld`, `makeUnit`, `makeBuilding`, `createState` |
| Queries | `find*`/`pick*`/`can*`/`selected*` — always return, never mutate | `findSite`, `pickUnit`, `canAfford`, `selectedUnits` |
| Mutations | verb-first | `spend`, `deposit`, `issueOrder`, `upgradeAge`, `rebuildBlocks` |
| Per-frame | `step*` / `draw*` | `stepSim`, `stepGame`, `drawWorld`, `drawUnits` |
| Local vars | short but meaningful (`u`, `b`, `dt`, `w`, `r`) | inside hot loops |

- The single mutable state object is always named `Game` (capital G, deliberately distinct
  from the exported `AoE2` API and the `window.Game` instance).
- New tunables go in `CFG`/`KINDS`/`BLD` — never inline in logic. If a magic number is in
  logic, it belongs in `src/config.js` instead.

## Formatting

- 2-space indent, semicolons, single quotes (double quotes only inside HTML attribute
  strings and `innerHTML` templates).
- Object literals written multi-line with aligned values when a table reads better that way
  (`KINDS`, `BLD`); comment aligned to the right column explains the number.
- Line length ~100 chars; wrap function args rather than let them sprawl.
- Keep object shapes stable (same keys every time) so tests can `JSON.stringify` them — e.g.
  a unit always has `{id, kind, team, x, y, hp, maxHp, speed, atk, atkTime, r, order, carry,
  carryRes, work, cd, dead}` even when fields are irrelevant to that unit type. Dropping a
  key from a shape is exactly the class of bug that broke attack range.

## Behaviour rules

- Validate first, `return toast(Game, '<reason>')` early — every rejection path has a
  user-visible message (`Queue full`, `Need more houses`, `Militia needs a Town Center`).
- Never mutate a resource pool except through `spend()`/`deposit()`.
- Every DOM access is guarded (`if (el && el.addEventListener)`) and every global access is
  `typeof`-checked, so loading the scripts in node never throws.
- HUD updates go through the `setText`/`setHTML` helpers, not direct `innerHTML` scattered
  in the render path.

## Adding a feature (the recipe)

1. Add the data to `data/units.json` / `data/buildings.json` (stats, costs) and, for new unit
   art, the frames in `data/sprites/` plus their `data/sprites.json` entry — pure data, no
   logic. Then regenerate (`node tools/check-stats.mjs --write`, `node tools/gen-atlas.js`):
   the `CFG`/`KINDS`/`BLD`/`SPRITES` blocks in `src/config.js` are generated, never hand-edited.
2. Implement the logic as pure functions in the matching logic file; export them in the
   `AoE2` object (`src/main.js`) so the checks can reach them.
3. Add the visible layer: draw function in `src/render.js` or `src/hud.js`, command wiring
   in `src/input.js`.
4. Add the assertion to the matching file in `tools/checks/` **before** declaring it works, then run
   the harness, `tools/check-stats.mjs`, the preview renderer and `tools/audit-line-refs.js`.
5. Update `docs/GAME_RULES.md` (numbers) and `docs/CHANGELOG.md` in the same commit.
6. Commit with an imperative subject; commit the regenerated `preview.png` if visuals moved.

## Anti-rules

- No frameworks, no bundlers, no build step, no runtime dependencies: the repo root must
  stay servable as-is. (`tools/package.json` holds the tools' dev dependency only.) The only
  image allowed is the generated `assets/sprites.png` (regenerate with `tools/gen-atlas.js`,
  never hand-edit it).
- No ES modules in `src/` — `import` would break opening `index.html` from disk and the
  shared-scope loader the tools rely on. Revisit that as one deliberate change, not piecemeal.
- No module-level mutable state: everything that changes lives on `Game`.
- No drive-by reformatting in a feature commit — it destroys reviewability of the patch.
- No `Math.random()` in simulation logic: use `mulberry32`/`hash2` so seeded runs stay
  reproducible (the tests depend on that).
