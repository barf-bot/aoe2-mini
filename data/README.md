# data/ — the vendored AoE2 content

The numbers and the art the game is built from. `index.html` never reads these files at
runtime (the product is still one dependency-free file); it carries what the tools in
`tools/` render *from* them, and the tools are what prove the game and the data agree.

| File | Contains | Consumed by |
|---|---|---|
| `units.json` | the unit stat rows the game ships (`villager`, `militia`, `archer`) plus the `CFG` block — hp, attack, attack type (melee/ranged), armours, attack delay, speed in **tiles/s**, costs, train times | `tools/check-stats.mjs` (renders section 1's `CFG`/`KINDS`) |
| `buildings.json` | the eleven building rows — hp, costs, build times, footprints, armours, the Town Center's and Watch Tower's attack/range, the three Feudal rows' authored `age` gate + `noSprite` mark, and the Market's authored `trade` rates (sell 100 food/wood/stone for 33 gold, buy 100 back for 67) | `tools/check-stats.mjs` (renders section 1's `BLD`) |
| `techs.json` | the four Blacksmith tech rows (`forge` 67, `scale_mail` 74, `fletching` 199, `bracer` 201) — upstream costs, research times and the `atk`/`armor` effect halves the engine reads (`data.Tech[<id>]`) | `tools/check-stats.mjs` (renders section 1's `TECHS`) |
| `sprites/` + `sprites.json` | the ripped PNG frames the atlas is composed from (the farm frame is the old procedural cell vendored as a PNG — the building rip ships no farm bitmap) and the manifest mapping kind → anim → file | `tools/gen-atlas.js` |

## Where the numbers come from

| Source | Used for | Notes |
|---|---|---|
| [`SiegeEngineers/aoe2techtree` → `data/data.json`](https://raw.githubusercontent.com/SiegeEngineers/aoe2techtree/master/data/data.json) | primary: unit/building/tech rows (`data.Unit[<id>]`, `data.Building[<id>]`, `data.Tech[<id>]`), ids, internal names | fetched 2026-11-11; raw upstream JSON is ~7 MB, so only the shipped rows are vendored |
| [`HSZemi/aoe2dat` → `data/units_buildings_techs.json`](https://raw.githubusercontent.com/HSZemi/aoe2dat/master/data/units_buildings_techs.json) | cross-check: same ids, same values | fetched 2026-11-11 |

Rules written into the files themselves:

- **Table numbers are copied, never retuned.** A row that exists upstream is stored with the
  upstream `id` and `internalName` so every value is traceable.
- **What the table cannot carry is marked.** `authored[]` lists the fields the game needs but
  the table has no column for (`label`, hit radius `r`, `w`/`h` footprints, `pop`, `field`,
  `trains`, the map/render `CFG` keys). `design{}` records the numbers the agreed design
  fixed instead of the table's (`CARRY_MAX` 10, `villager.atkTime` 0.64, `militia.atkTime` 0.5).
- **Speeds are converted, not typed.** `KINDS.<kind>.speed` px/s = `round(CFG.TILE × speedTps)`;
  the table speaks tiles/s, the engine moves in px.
- **Adding a unit means adding the row first.** `check-stats.mjs` fails when `index.html`
  declares a kind the data does not have, so content arrives as data, then as art, then as code.

## Refreshing from upstream

Fetch the current upstream JSON, copy the shipped rows back in (keeping the `source`,
`authored` and `design` blocks), then prove the game still matches:

```bash
node tools/check-stats.mjs          # prints every field that now disagrees
node tools/check-stats.mjs --write  # puts the new numbers into index.html section 1
node tools/headless-check.js        # the sim has to still pass on the new numbers
```

## Swapping the art source

One path, `data/sprites/`, is the asset source: `gen-atlas.js` composes `assets/sprites.png`
from that directory and nothing else — a frame `sprites.json` names but the folder lacks is a
hard error, there is no built-in drawing left to fall back to — so replacing the ripped frames
with someone's own HD/DE asset export is a one-path change. The game still ships exactly one
image.
