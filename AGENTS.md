# AGENTS.md — working rules for this repo

Read this before editing. It exists so any agent session (or human) can pick the
project up cold and not undo the conventions below.

## What this project is

`index.html` **is** the product: a single-file, dependency-free browser RTS
prototype (Age of Empires II, Dark Age slice).

- Live site: https://barf-bot.github.io/aoe2-mini/ (GitHub Pages, published from `main`)
- The Pages root *is* the repo root, so `index.html` at the top level is the deployed page.
- No framework, no bundler, no npm dependencies for the game itself. `package.json` is
  intentionally absent.

## The one hard constraint

**Keep the game in one file.** Do not split `index.html` into `src/` modules, do not add a
build step, do not add image assets (terrain is drawn procedurally from palettes in
`index.html:324-336`): the only image the game may carry is `assets/sprites.png`, the sprite
atlas composed by `tools/gen-atlas.js` from the vendored frames in `data/sprites/`. Tooling
may live beside it in `tools/`; the game may not.

## How to verify a change (never report "done" without this)

```bash
node tools/headless-check.js     # must end with "NN/NN checks passed", exit 0
node tools/render-preview.js     # rewrites preview.png from the real renderer
node tools/gen-atlas.js          # composes assets/sprites.png from data/sprites/ and regenerates the tables
node tools/check-stats.mjs       # verifies section 1 against data/ (exit 1 prints every drifted field)
```

`tools/headless-check.js` extracts the `<script>` from `index.html`, stubs the DOM, boots
the game and asserts economy/construction/training/combat/input/UI/sprite invariants.
`tools/render-preview.js` renders a real frame through `@napi-rs/canvas` so the *renderer*
is proven too — commit the regenerated `preview.png` when visuals change, and look at it
before committing (a blank sprite sheet once passed every assertion).

`tools/check-stats.mjs` renders the `CFG` / `KINDS` / `BLD` tables of section 1 from
`data/units.json` + `data/buildings.json` — the vendored AoE2 stat tables those numbers come
from (see `data/README.md`) — so the game cannot drift from them: run it to verify, run it
with `--write` to regenerate the blocks. The art follows the same rule one layer down:
`tools/gen-atlas.js` composes the sheet from `data/sprites.json` + `data/sprites/` and
regenerates `SPRITE_SHEET` / `SPRITES` / `WORK_ANIM` / `BLD_SPRITES`, so swapping the asset
source is a change in `data/` and nothing else. Section 4 stays DOM-free; the game still never
reads the JSON at runtime, it carries the rendered result.

The game exports its internals for exactly this reason:

```js
if (typeof module !== 'undefined' && module.exports) module.exports = AoE2;  // index.html:2469
```

If you add a new mechanic, add the check that proves it. Fix the test *and* the code with
equal suspicion: two past "failures" were the harness asserting on the wrong object, and a
stubbed `Image` that reports the right dimensions can still paint nothing (see
`tools/headless-check.js` §2b).

## Editing rules

- **Files over ~300 lines: write section-by-section (or via a terminal heredoc); use
  `patch` for edits.** A single 1400-line `write_file` has truncated mid-write before and
  cost a full debugging cycle. `index.html` is 2476 lines — patch it, don't rewrite it.
- Keep the `Map of this file` banner (`index.html:89-105`) truthful when functions move.
- Section 4 (`commands`) must stay DOM-free: pure functions taking `(Game, …)`. Anything
  that touches `document`/`window` belongs in sections 5-7, guarded with
  `typeof document !== 'undefined'` so node can still load the file.
- Single state object (`Game`) passed explicitly — no module-level mutable state outside it.
- Commit style: imperative, one logical change per commit (`Add README with live-site link
  and tool docs`, `Fix villager carry bookkeeping so deposits land in the stockpile`).

## Where truth lives

| File | Contains |
|---|---|
| `index.html` | the game — its `CFG`/`KINDS`/`BLD` numbers come from `data/`, the rest of them live here |
| `assets/sprites.png` | the sprite atlas, composed by `tools/gen-atlas.js` from `data/sprites/` — never hand-edited |
| `data/units.json`, `data/buildings.json` | the vendored AoE2 stat tables section 1 is generated from; `data/README.md` names the sources and the swap path |
| `docs/GAME_RULES.md` | the ruleset as implemented, with line refs — update with the code |
| `docs/ARCHITECTURE.md` | file map, data shapes, render/input model, test harness design |
| `docs/CONVENTIONS.md` | code style and the rules above in full |
| `docs/ROADMAP.md` | prioritized open work |
| `docs/CHANGELOG.md` | dated entries of what shipped |
| `tools/` | verification harnesses (`headless-check.js`, `check-stats.mjs`, `render-preview.js`, `audit-line-refs.js`) and the atlas generator; `tools/node_modules` is gitignored |

The tool set itself is not trusted by eye: `tools/audit-line-refs.js` is what proves the
line references above and in `docs/` still match `index.html`, and AGENTS/README must list
every file in `tools/` for it to pass.

## Deploy

Push to `main`. Pages serves the branch root within ~30s; check with
`gh api repos/barf-bot/aoe2-mini/pages --jq .status` (`built`) and a `curl` of the URL —
verify the served bytes match `index.html` rather than trusting the deploy.
