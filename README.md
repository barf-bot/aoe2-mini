# AoE2 Mini — Dark Age prototype

A browser-playable Age of Empires II prototype in **one HTML file** — no build step,
no framework, no assets to download. Open `index.html` and play.

**Live:** https://barf-bot.github.io/aoe2-mini/

![preview](preview.png)

## What's in it

- Procedural map: grass, water, forest, berry bushes, gold and stone deposits, plus fog of war
- A Town Center with villagers that harvest → carry → deposit → retarget when a tile empties
- Buildings: house (population), farm (food field), all constructed over time with hp scaling
- Ages: Dark → Feudal → Castle, with the food costs and unlock rules
- Units: villager and militia, a training queue at the Town Center, attack cooldowns, deaths
- Controls: click / drag-select, control groups (`Ctrl+1…9`, `1…9` to recall), right-click
  move / attack / gather, hotkeys (`H` for house, `Esc` to cancel), minimap camera drag
- An enemy village that reacts and fights back

## Known limits (it's a prototype)

- Prototype art: tinted tiles and unit discs, not AoE2 sprites
- Straight-line movement with a walkability check — no A\* pathfinding around water yet
- One simple AI opponent, no lobby/multiplayer

## Tools in this repo

| File | Purpose |
|---|---|
| `index.html` | the entire game (markup, styles, engine, renderer) |
| `tools/headless-check.js` | extracts the `<script>` from the HTML, stubs the DOM, runs the simulation and asserts 63 invariants — currently **63/63 pass** |
| `tools/render-preview.js` | boots the same code against a real canvas (`@napi-rs/canvas`) and writes `preview.png`, so the renderer is verified, not just assumed |
| `preview.png` | a real frame of the game rendered headlessly |

```bash
node tools/headless-check.js        # 63/63 checks passed
node tools/render-preview.js        # rewrites preview.png
```

## How to run locally

Serve the folder (any static server) or just open the file:

```bash
python3 -m http.server 8080   # then visit http://localhost:8080
```

## Deployment

GitHub Pages publishes from the `main` branch root, so the repo root *is* the site.
Push a change to `index.html` and the live site updates a few seconds later.
