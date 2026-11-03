# Conventions

Style rules extracted from `index.html` so new code matches the file it lives in. For the
repo-level workflow rules (verification, deploy, the >300-line editing rule) see
`../AGENTS.md`.

## File shape

- One file: markup → `<style>` → `<script>`. Nothing else.
- The script opens with a `/* ==== */` banner naming the seven sections and their line
  ranges; each section is delimited by `/* ---- N. name ---- */`. **Keep the banner's line
  ranges honest** when code moves — they're the navigation aid for both humans and agents.
- Section 4 (`commands`) is pure logic: signature style `function foo(Game, ...)` returning
  a value or `null`, never touching `document`/`window`. Everything DOM lives in 5-7.

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
  logic, it belongs in §1 instead.

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
  `typeof`-checked, so `require()` in node never throws.
- HUD updates go through the `setText`/`setHTML` helpers, not direct `innerHTML` scattered
  in the render path.

## Adding a feature (the recipe)

1. Add the data to §1 (costs/stats, plus the `SPRITES` cell table for any new unit art) —
   pure data, no logic.
2. Implement the logic in §4 as pure functions; export them in the `AoE2` object.
3. Add the visible layer: draw function in §5, command wiring in §6.
4. Add the assertion to `tools/headless-check.js` **before** declaring it works, then run
   the harness, the preview renderer and `tools/audit-line-refs.js`.
5. Update `docs/GAME_RULES.md` (numbers) and `docs/CHANGELOG.md` in the same commit.
6. Commit with an imperative subject; commit the regenerated `preview.png` if visuals moved.

## Anti-rules

- No frameworks, no bundlers, no `package.json`; the only image allowed is the generated
  `assets/sprites.png` (regenerate with `tools/gen-atlas.js`, never hand-edit it).
- No splitting `index.html` into modules — the single file is the product's shape.
- No whole-file rewrites of `index.html` (use `patch`; see `AGENTS.md`).
- No drive-by reformatting in a feature commit — it destroys reviewability of the patch.
- No `Math.random()` in simulation logic: use `mulberry32`/`hash2` so seeded runs stay
  reproducible (the tests depend on that).
