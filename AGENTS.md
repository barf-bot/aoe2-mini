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
build step, do not add image assets (terrain and units are drawn procedurally from
palettes in `index.html:139-161`). Tooling may live beside it in `tools/`; the game may not.

## How to verify a change (never report "done" without this)

```bash
node tools/headless-check.js     # must end with "NN/NN checks passed", exit 0
node tools/render-preview.js     # rewrites preview.png from the real renderer
```

`tools/headless-check.js` extracts the `<script>` from `index.html`, stubs the DOM, boots
the game and asserts economy/construction/training/combat/input/UI invariants.
`tools/render-preview.js` renders a real frame through `@napi-rs/canvas` so the *renderer*
is proven too — commit the regenerated `preview.png` when visuals change.

The game exports its internals for exactly this reason:

```js
if (typeof module !== 'undefined' && module.exports) module.exports = AoE2;  // index.html:1457
```

If you add a new mechanic, add the check that proves it. Fix the test *and* the code with
equal suspicion: two past "failures" were the harness asserting on the wrong object.

## Editing rules

- **Files over ~300 lines: write section-by-section (or via a terminal heredoc); use
  `patch` for edits.** A single 1400-line `write_file` has truncated mid-write before and
  cost a full debugging cycle. `index.html` is 1455 lines — patch it, don't rewrite it.
- Keep the `Map of this file` banner (`index.html:81-97`) truthful when functions move.
- Section 4 (`commands`) must stay DOM-free: pure functions taking `(Game, …)`. Anything
  that touches `document`/`window` belongs in sections 5-7, guarded with
  `typeof document !== 'undefined'` so node can still load the file.
- Single state object (`Game`) passed explicitly — no module-level mutable state outside it.
- Commit style: imperative, one logical change per commit (`Add README with live-site link
  and tool docs`, `Fix villager carry bookkeeping so deposits land in the stockpile`).

## Where truth lives

| File | Contains |
|---|---|
| `index.html` | the game and every tunable number |
| `docs/GAME_RULES.md` | the ruleset as implemented, with line refs — update with the code |
| `docs/ARCHITECTURE.md` | file map, data shapes, render/input model, test harness design |
| `docs/CONVENTIONS.md` | code style and the rules above in full |
| `docs/ROADMAP.md` | prioritized open work |
| `docs/CHANGELOG.md` | dated entries of what shipped |
| `tools/` | verification harnesses; `tools/node_modules` is gitignored |

## Deploy

Push to `main`. Pages serves the branch root within ~30s; check with
`gh api repos/barf-bot/aoe2-mini/pages --jq .status` (`built`) and a `curl` of the URL —
verify the served bytes match `index.html` rather than trusting the deploy.
