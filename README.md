# AoE2 Mini — Dark Age prototype

A browser-playable Age of Empires II prototype in **one HTML file** — no build step,
no framework, one small PNG of unit art. Open `index.html` and play.

**Live:** https://barf-bot.github.io/aoe2-mini/

![preview](preview.png)

## What's in it

- Procedural map: grass, water, forest, berry bushes, gold and stone deposits, plus fog of war
- A Town Center with villagers that harvest → carry → deposit → retarget when a tile empties
- Buildings: house (population), farm (food field), all constructed over time with hp scaling
- Ages: Dark → Feudal → Castle, with the food costs and unlock rules
- Units: villager and militia drawn from a pixel-art sprite atlas (`assets/sprites.png`),
  a training queue at the Town Center, attack cooldowns, deaths
- Controls: click / drag-select, control groups (`Ctrl+1…9`, `1…9` to recall), right-click
  move / attack / gather, hotkeys (`H` house, `F` farm, `B` barracks, `L` lumber camp,
  `G` mining camp, `M` mill, `T` age, `Esc` to cancel), minimap camera drag
- An enemy village that reacts and fights back

## Known limits (it's a prototype)

- Sprite art covers units only: buildings, resource objects and ground tiles are still
  drawn procedurally
- Straight-line movement with a walkability check — no A\* pathfinding around water yet
- One simple AI opponent, no lobby/multiplayer

## Docs

| File | What's in it |
|---|---|
| [`AGENTS.md`](AGENTS.md) | rules for working on the repo (single-file constraint, verification gate, editing rule) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | file map with line ranges, the `Game` shape, sim/render/input models |
| [`docs/GAME_RULES.md`](docs/GAME_RULES.md) | the implemented ruleset — every stat, cost and rule, with line refs |
| [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) | naming, formatting, the feature recipe, anti-rules |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | prioritized next work, each with an exit condition |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | dated history of what shipped and what was fixed |

Start with `AGENTS.md` if you're an agent picking the repo up cold.

## Tools in this repo

| File | Purpose |
|---|---|
| `index.html` | the entire game (markup, styles, engine, renderer) |
| `assets/sprites.png` | the sprite atlas: 308×158 — unit rows 288×48 of 24×24 cells (villagers idle/walk/farm/chop/mine, militia idle/walk/attack) plus building cells (town_center 66×66, house/farm/barracks/mill 44×44, camps 22×22, blue/red pairs) |
| `tools/gen-atlas.js` | regenerates `assets/sprites.png` from the `SPRITES` table in `index.html` |
| `tools/headless-check.js` | extracts the `<script>` from the HTML, stubs the DOM, runs the simulation and asserts 100 invariants — currently **100/100 pass** |
| `tools/render-preview.js` | boots the same code against a real canvas (`@napi-rs/canvas`) and writes `preview.png`, so the renderer is verified, not just assumed |
| `tools/audit-line-refs.js` | checks that every `index.html:NNN` reference in the docs still points at the code it names, and that the documented section ranges match the real ones |
| `preview.png` | a real frame of the game rendered headlessly |

```bash
node tools/headless-check.js        # 100/100 checks passed
node tools/render-preview.js        # rewrites preview.png
node tools/gen-atlas.js             # rewrites assets/sprites.png from the sprite table
```

## How to run locally

Serve the folder (any static server) or just open the file:

```bash
python3 -m http.server 8080   # then visit http://localhost:8080
```

## Deployment

GitHub Pages publishes from the `main` branch root, so the repo root *is* the site.
Push a change to `index.html` and the live site updates a few seconds later.
