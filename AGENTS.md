# AGENTS.md — working rules for this repo

Read this before editing. It exists so any agent session (or human) can pick the
project up cold and not undo the conventions below.

## What this project is

A dependency-free browser RTS prototype (Age of Empires II, Dark Age slice): a static page
made of `index.html` (markup + the script list), `src/style.css` and fifteen small scripts
in `src/`.

- Live site: https://barf-bot.github.io/aoe2-mini/ (GitHub Pages, published from `main`)
- The Pages root *is* the repo root, so `index.html` at the top level is the deployed page
  and `src/` + `assets/` are served as they are.
- No framework, no bundler, no npm dependencies for the game itself. `tools/package.json`
  exists only for the tools' two dev dependencies (`@napi-rs/canvas` for the canvas,
  `playwright` for the browser smoke test).

## The one hard constraint

**No build step.** What is committed is what is served: opening `index.html` from disk
must work. That means plain classic scripts sharing one global scope — no ES modules, no
transpiling, no bundling.

## Art pipeline

Terrain is drawn procedurally from the palettes in `src/config.js:296-305`, and the only
runtime image is `assets/sprites.png`, composed by `tools/gen-atlas.js` from
`data/sprites.json` plus the vendored frames in `data/sprites/` — never hand-edit that file.
One atlas means one loader (`loadAtlas` in `src/boot.js`) and one deterministic generator, so
`data/` stays the single source of art. A new runtime image goes through the atlas and the
generator as a deliberate change, never as a loose PNG. This rule does not follow from the
no-build-step rule above (a PNG needs no build), so it is stated separately and stays.

## Where code goes

`docs/ARCHITECTURE.md` has the full file map. The short version:

| You are changing… | File |
|---|---|
| a number, a cost, a stat | `data/*.json`, then regenerate `src/config.js` (never hand-edit the generated blocks) |
| map generation | `src/world.js` |
| unit/building creation, work spots | `src/entities.js` |
| the per-frame simulation, combat, arrows | `src/sim.js` |
| pathfinding, steering, formations | `src/movement.js` |
| gathering, drop-offs, population, resources | `src/economy.js` |
| player/AI commands (build, train, research, trade, orders) | `src/commands.js` |
| the enemy AI | `src/ai.js` |
| save / load | `src/save.js` |
| sound | `src/sound.js` |
| canvas drawing | `src/render.js` |
| the header/footer HUD | `src/hud.js` |
| mouse, touch, keyboard | `src/input.js` |
| state creation, new game, the frame loop | `src/boot.js` |
| what the tools can reach (`AoE2` export) | `src/main.js` |
| layout and colours | `src/style.css` |

## How to verify a change (never report "done" without this)

```bash
node tools/headless-check.js -q  # must end with "NN/NN checks passed", exit 0
node tools/check-stats.mjs       # verifies src/config.js against data/ (exit 1 prints every drifted field)
node tools/audit-line-refs.js    # doc line refs, the file map, the DOM-free rule, the tool inventory
node tools/render-preview.js     # rewrites preview.png from the real renderer
node tools/gen-atlas.js          # composes assets/sprites.png from data/sprites/ and regenerates the tables
```

The first three are `npm run check --prefix tools`, and `.github/workflows/check.yml` runs
all five on every push and pull request. The last two need
`npm install --prefix tools` once (`tools/node_modules` is gitignored); both are
deterministic, so on an unchanged tree they leave `git status` clean.

`tools/browser-smoke.js` (`npm run browser-smoke --prefix tools`) is a sixth tool, outside
those five and outside `npm run check`: it opens the page in a real Chrome (Playwright,
`1.58.0` — the version whose bundled Chromium build is the one this box ships), asserts the
app booted on both the working copy and the live site, writes `tools/out/local.png` and
`tools/out/live.png` and prints a JSON summary per target. It needs a browser and network,
so `tools/headless-check.js` must never require it: the 382-check suite stays plain node.
The generated `tools/out/` is scratch, not committed.

`tools/headless-check.js` runs every file in `tools/checks/`, each in its own process.
A check file starts by requiring `tools/lib/harness.js`, which stubs the DOM and boots the
game, and then asserts its topic's invariants
(economy/pathfinding/construction/training/combat/input/UI/save/sound/AI) against that
freshly booted `Game` — so the files are independent, and one runs alone with
`node tools/checks/07-combat.js` or `node tools/headless-check.js combat`. `-q` prints
failures and totals only. All tools load the game through `tools/lib/load-game.js`, which
reads the `<script src>` list from `index.html` and runs the same files in the same order
the browser does.

`tools/render-preview.js` renders a real frame through `@napi-rs/canvas` so the *renderer*
is proven too — commit the regenerated `preview.png` when visuals change, and look at it
before committing (a blank sprite sheet once passed every assertion).

`tools/check-stats.mjs` renders the `CFG` / `KINDS` / `BLD` / `TECHS` tables of
`src/config.js` from `data/units.json` + `data/buildings.json` + `data/techs.json` — the
vendored AoE2 stat tables those numbers come from (see `data/README.md`) — so the game
cannot drift from them: run it to verify, run it with `--write` to regenerate the blocks.
The art follows the same rule one layer down: `tools/gen-atlas.js` composes the sheet from
`data/sprites.json` + `data/sprites/` and regenerates `SPRITE_SHEET` / `SPRITES` /
`WORK_ANIM` / `BLD_SPRITES`, so swapping the asset source is a change in `data/` and
nothing else. The game never reads the JSON at runtime, it carries the rendered result.

The game exposes its internals for exactly this reason — the `AoE2` object in
`src/main.js:6`. A function the checks need must be listed there.

If you add a new mechanic, add the check that proves it (in the matching
`tools/checks/NN-topic.js`). Fix the test *and* the code with equal suspicion: two past
"failures" were the harness asserting on the wrong object, and a stubbed `Image` that
reports the right dimensions can still paint nothing (see `tools/lib/harness.js` §2b).

## Editing rules

- **Keep files small.** Around 300 lines per source file is the target; the two largest
  check files are ~640. When a file outgrows that, split it by topic rather than letting it
  grow — a new `src/` file needs its `<script src>` tag in `index.html` and a row in the
  `docs/ARCHITECTURE.md` file map (`tools/audit-line-refs.js` fails without both).
- Edit with patches, not whole-file rewrites: a single 1400-line write has truncated
  mid-write before and cost a full debugging cycle.
- The logic files (`world`, `entities`, `sim`, `movement`, `economy`, `commands`, `ai`)
  must stay DOM-free: pure functions taking `(Game, …)`. Anything that touches
  `document`/`window` belongs in `render`/`hud`/`input`/`boot`, guarded with
  `typeof document !== 'undefined'` so node can still load the file. The audit enforces it.
- Outside `src/config.js` and `src/main.js`, a source file contains only function
  declarations — no top-level statements — so load order never matters between them.
- Single state object (`Game`) passed explicitly — no module-level mutable state outside it.
- A check file must pass when run alone: it may only rely on `tools/lib/harness.js` and on
  what it set up itself. Fixtures needed by more than one file go in the harness; build a
  throwaway `AoE2.createState()` when a check needs a clean world.
- Commit style: imperative, one logical change per commit (`Add README with live-site link
  and tool docs`, `Fix villager carry bookkeeping so deposits land in the stockpile`).

## Where truth lives

| File | Contains |
|---|---|
| `index.html` | the markup and the ordered script list |
| `src/` | the game — `src/config.js` carries the generated `CFG`/`KINDS`/`BLD`/`TECHS` and sprite tables, the rest is hand-written |
| `assets/sprites.png` | the sprite atlas, composed by `tools/gen-atlas.js` from `data/sprites/` — never hand-edited |
| `data/units.json`, `data/buildings.json`, `data/techs.json` | the vendored AoE2 stat tables the config is generated from; `data/README.md` names the sources and the swap path |
| `docs/GAME_RULES.md` | the ruleset as implemented, with line refs — update with the code |
| `docs/ARCHITECTURE.md` | file map, data shapes, render/input model, test harness design |
| `docs/CONVENTIONS.md` | code style and the rules above in full |
| `docs/TODO.md` | known bugs, prioritized, each with its cause, fix direction and the check that proves it — fix these before new features |
| `docs/ROADMAP.md` | prioritized open work (features and process) |
| `docs/CHANGELOG.md` | dated entries of what shipped |
| `docs/plans/` | historical design plans; they predate the `src/` split and cite the old single-file line numbers |
| `tools/` | `headless-check.js` (runner for `tools/checks/`), `check-stats.mjs`, `render-preview.js`, `gen-atlas.js`, `audit-line-refs.js`, `browser-smoke.js` (the Playwright smoke test, with `tools/out/` for its screenshots), and `tools/lib/` (`load-game.js`, the loader every tool uses, and `harness.js`, the stub DOM + fixtures the checks start from) |

The docs are not trusted by eye: `tools/audit-line-refs.js` is what proves the line
references above and in `docs/` still match the code, and AGENTS/README must list every
file in `tools/` for it to pass.

## Deploy

Push to `main`. Pages serves the branch root within ~30s; check with
`gh api repos/barf-bot/aoe2-mini/pages --jq .status` (`built`) and a `curl` of the URL —
verify the served bytes match `index.html` and the `src/` files rather than trusting the
deploy.
