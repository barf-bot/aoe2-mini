# Market and Watch Tower

Status: in progress

## Design

**What you'll see:** two more buildings in the villager build list — a Market (`e`, needs
Feudal) and a Watch Tower (`c`, needs Feudal). Selecting the Market shows sell/buy buttons
per resource (sell 100 food/wood/stone for gold, buy 100 back), and the stockpile numbers
move the moment you click. The Watch Tower stands and shoots enemy units in range the way
the Town Center already does, and razes like any other building.

**How it works:** both join `data/buildings.json` on their vendored rows (upstream `id` and
`internalName` recorded, numbers copied not retuned; `authored[]` gains whatever the tables
do not carry — the market's sell/buy gold rates and any footprint the row lacks), and both
get `age: 1` plus `noSprite: true`, so they render through the procedural path the
blacksmith just proved instead of growing the atlas. Section 4 gains one pure DOM-free
command, `trade(Game, b, res, direction)`: it refuses through `toast` (not a built market, a
resource the market cannot sell, gold the player cannot pay to buy) and otherwise moves
exactly 100 units at the row's rate in the chosen direction. The tower needs no new combat
code — `stepBuildingAttacks` and `spawnArrow` already drive every building that has an
`attack` number, which is what its row supplies.

**Not in this round:** trade carts and land trade, Guard Tower and Keep, garrison mechanics,
ripped art for either building (still the deferred asset-source item), the uniform HUD frame.

**How we check it:** `tools/headless-check.js` gains a trade section: selling and buying
each move exactly the authored amount both ways, a Dark Age market and a non-market building
are both refused with `Game.res` untouched, the new rows appear in the generated `BLD`
(10 buildings) and in `tools/check-stats.mjs` output; a check proves a Watch Tower with a
hostile unit in range spawns an arrow at its row's numbers, and `tools/render-preview.js`
regenerates `preview.png` with both buildings in the frame. Every existing check stays green.

**Hard constraints that survive from `AGENTS.md`:** the game stays one `index.html`; no
framework, no build step, no new image files beyond the one `assets/sprites.png` atlas;
`index.html` is patched, never rewritten; section 4 stays DOM-free; every task names a
proving check and the `Map of this file` banner stays truthful.

## Tasks

- [x] T1: The Market and Watch Tower rows — data, generated `BLD`, the `e`/`c` hotkeys
  - files: `data/buildings.json` (`buildings.market`, `buildings.watch_tower`,
    `source.authored`), `tools/check-stats.mjs` (a `tradeValue` helper plus the optional-field
    pattern at `tools/check-stats.mjs:102-105` and the field list in `renderBLD`
    `tools/check-stats.mjs:155-170`), `index.html` §1 `BLD` (regenerated; every line number in
    this plan is the pre-plan `index.html:2589`, restamped by T6), §6 keydown hotkey block
    (`index.html:2298-2305`), `tools/headless-check.js` (the §7 row-check block at
    `tools/headless-check.js:1227-1272`, §10 at `tools/headless-check.js:1804`),
    `data/README.md` (the `buildings.json` table row: "the nine building rows" → eleven, plus
    the Market's authored trade rates), `data/sprites.json` untouched
  - change: two rows on their vendored rows, numbers copied —
    `market`: `id: 84`, `internalName: "MRKT"`, `hp: 1800`, `cost: { wood: 175 }`, `time: 60`,
    `attack: 0`, `meleeArmor: 1`, `pierceArmor: 8`, `lineOfSight: 6`, `range: 0`, `reload: 0`,
    `accuracy: 100`, `garrisonCapacity: 10`; `watch_tower`: `id: 79`, `internalName: "WCTW"`,
    `hp: 850`, `cost: { wood: 35, stone: 125 }`, `time: 80`, `attack: 5`, `meleeArmor: 1`,
    `pierceArmor: 7`, `lineOfSight: 10`, `range: 8`, `reload: 2`, `accuracy: 100`,
    `garrisonCapacity: 5`. The authored halves are `label`/`w`/`h`/`pop`/`trains` (Market 2×2,
    Watch Tower 1×1, both `pop: 0`, `trains: []` — appended after `blacksmith`, the file's
    arrival order) plus the two fields the design fixes: `age: 1` and `noSprite: true` on both.
    `authored[]` gains `buildings.market.trade` with the value `trade: { sell: 33, buy: 67 }`
    (the Market pair — 100 food/wood/stone for 33 gold, 100 back for 67; no table column
    carries it, so it is authored and marked, not retuned). `bldValue` gains
    `if (b.trade !== undefined) v.trade = tradeValue(b.trade, ...)` beside the existing
    `field`/`age`/`noSprite` lines and `renderBLD` prints `trade: { sell: 33, buy: 67 },` on
    its own line only for rows that have one, so every existing row prints byte-identically
    (`diffObject` already recurses into nested objects). `build()` needs no change — the
    `(def.age ?? 0) > Game.age` gate T1 of the blacksmith plan added covers any gated row — and
    `bldSpriteFor` answers `null` for both kinds, which is what routes the renderer to the
    procedural draw. §6 gains `if (k === 'e') … 'market'` and `if (k === 'c') … 'watch_tower'`
    beside the other placement hotkeys (both keys free). The Watch Tower row's `MinRange: 1` is
    deliberately not carried: `bldValue` has no `minRange` column for buildings and
    `stepBuildingAttacks` measures reach with `lineOfSight`, the way the Town Center row is read.
  - done when: `node tools/check-stats.mjs` exits 0 printing
    `ok    index.html matches data/ -- 304 fields checked (CFG, 3 kinds, 11 buildings, 4 techs)`
    — the design's "(10 buildings)" was written while the file had eight rows; it has nine now,
    so the pair makes eleven, and the tool's own line is the contract — and hand-breaking the
    generated `BLD.market.trade.sell` to 34 prints exactly
    `DRIFT BLD.market.trade.sell index.html:34 data:33` and exits 1 (reverted afterwards);
    `node tools/headless-check.js` prints `181/181 checks passed` (6 new, 175 existing
    untouched); `node tools/gen-atlas.js` leaves `assets/sprites.png` byte-identical (no new
    cell); `preview.png` unchanged — the pair enters the frame in T5; `wc -l index.html`
    2589 → 2602 (the AGENTS.md length claim is restamped in T6, the blacksmith plan's precedent).
  - test: `tools/check-stats.mjs` is extended first and goes red with
    `DRIFT BLD.market index.html:absent data:present`, then green; 6 new checks written before
    the code — `build: a Dark Age settlement cannot raise a Market (Feudal only)` and
    `build: a Dark Age settlement cannot raise a Watch Tower (Feudal only)` (a `createState()`
    fixture returns `undefined`, toasts `<label> requires Feudal Age`, `Game.res` untouched —
    the pattern at `tools/headless-check.js:1227-1241`), `build: a Feudal Market costs the
    table's 175 wood and completes in 60s` and `build: a Feudal Watch Tower costs the table's
    35 wood + 125 stone and completes in 80s` (set `age = 1`, place with `freeSpotAround` at
    the row's footprint, spend exactly the row's cost, step `BLD.<kind>.time`),
    `input: e arms Market placement`, `input: c arms Watch Tower placement` (the §10 pattern at
    `tools/headless-check.js:1804`; `Escape` clearing stays the existing check) — plus §5b3's
    `noSprite` rule, which now covers both kinds without being edited, and §7, §10, §11 re-run
    unmodified.

- [x] T2: `trade(Game, b, res, direction)` — the market's sell/buy command
  - files: `index.html` §4 (`trade(Game, b, res, direction)` directly after `researchTech` at
    `index.html:1625`, DOM-free; the `AoE2` export object at `index.html:2568-2579` gains
    `trade`), `tools/headless-check.js` (a new
    `/* ---- 8c. market trade (this plan, T2) ---- */` between §8b, which ends at
    `tools/headless-check.js:1481`, and §9 at 1482)
  - change: one pure command, the design's refusal ladder in order, every rung a `toast`
    before anything moves: unknown kind or a row without `trade` rates → `<label> cannot trade`
    (this is the non-market refusal); `b.built < 1` → `Still building` (the `researchTech`
    string); `(def.age ?? 0) > Game.age` → `<label> requires <AGE>` (the `build` string, so the
    Dark Age market refusal reads the same from both entry points); `direction` outside
    `sell`/`buy` → `Unknown trade direction <x>`; `res` outside food/wood/stone — gold included
    → `Cannot trade <res>`; selling without 100 of `res` → `Not enough <missing(...)>`; buying
    without `def.trade.buy` gold → `Not enough gold`. Then the move, through the existing
    helpers and nothing else: sell = `spend(Game, b.team, { [res]: 100 })` +
    `refund(Game, b.team, { gold: def.trade.sell })`; buy = `spend(Game, b.team, { gold:
    def.trade.buy })` + `refund(Game, b.team, { [res]: 100 })`. No toast on success (the
    `train`/`researchTech` precedent), returns `b`.
  - done when: `188/188`; the §8c fixture (a fresh `createState`, a `makeBuilding` market with
    `built = 1` and `age = 1`, the blacksmith §8b fixture shape) shows each direction moving
    exactly 100 units and exactly the row's gold, and every refusal leaving `Game.res`
    unchanged field for field.
  - test: 7 new §8c checks written first — `trade: selling 100 food pays the row's 33 gold`,
    `trade: buying 100 wood costs the row's 67 gold`, `trade: selling 100 wood with 40 in the
    stockpile is refused` (`Game.res` untouched — selling must not drive a stockpile negative),
    `trade: buying 100 stone with 20 gold is refused` (untouched), `trade: a Dark Age market
    cannot trade` (the `Market requires Feudal Age` toast), `trade: a market still under
    construction cannot trade` (`Still building`), `trade: a barracks cannot trade`
    (`Barracks cannot trade`) — plus §8 and §8b re-run unmodified.

- [x] T3: the Market's trade surface — six buttons and their dispatch
  - files: `index.html` §5 `commandsHtml` (`index.html:2102-2145`, the `b.built >= 1` branch,
    after the train and research loops), §6's delegated click handler (`index.html:2312-2322`),
    `tools/headless-check.js` §11 (append before the §12 banner at `tools/headless-check.js:1960`)
  - change: when the selected finished building's row carries `trade`, emit for each of
    food/wood/stone two buttons — `data-act="trade" data-arg="food:sell"`, labelled
    `Sell Food<span class="c">33 G</span>` via `fmtCost({ gold: def.trade.sell })`, and
    `data-arg="food:buy"`, `Buy Food<span class="c">67 G</span>` — each carrying `disabled`
    exactly when its own half would be refused (sell: fewer than 100 of that resource; buy:
    fewer than `trade.buy` gold), the affordance rule the train buttons already follow. §6 adds
    `else if (act === 'trade' && Game.selectedBuilding) { const [res, dir] = arg.split(':');
    trade(Game, Game.selectedBuilding, res, dir); }` beside the `train`/`research` branches.
    `infoHtml` and `queueHtml` are untouched: the rates live on the buttons, and the stockpile
    numbers move because `renderHud` re-reads `Game.res` (`index.html:2051-2054`).
  - done when: `191/191`; selecting the Market on a Feudal fixture lists all six sell/buy pairs
    and clicking one changes the stockpiles in the same tick the panel is rebuilt.
  - test: 3 new §11 checks written first, mirroring the blacksmith's §11 block
    (`tools/headless-check.js:1918-1930`) — `ui: a built Market offers sell and buy for each
    resource` (all six `data-act="trade" data-arg="…"` strings present in `commandsHtml` for a
    `{ kind: 'market', team: 0, built: 1, hp: 1800, maxHp: 1800, queue: [], research: null }`
    fixture), `ui: clicking Sell Wood moves exactly 100 wood into gold` (fired through
    `Game.dom.commands.listeners.click`, asserting `Game.res[0].wood` −100 and
    `Game.res[0].gold` +33), `ui: a sell button is disabled while that stockpile is short`
    (food 40 → `data-arg="food:sell"` carries `disabled` while `data-arg="wood:sell"` does
    not) — plus §11's existing button checks re-run unmodified.

- [x] T4: the Watch Tower's shot — the row driving the combat path that already exists
  - files: `tools/headless-check.js` only (a new
    `/* ---- 9f. watch tower (this plan, T4) ---- */` between §9e, which ends at
    `tools/headless-check.js:1725`, and §10 at 1726); `index.html` untouched
  - change: no game code — `stepBuildingAttacks` (`index.html:890`) already drives every
    building whose row carries an `attack`, and `spawnArrow` (`index.html:852`) already takes a
    building's `accuracy` and `unitAttack` from `BLD`. The task is the design's proof: a team-0
    Watch Tower built with `makeBuilding` (`built = 1`) on a fresh `createState()` — so
    `ageBonus === 0` and the expected damage is the row's own number — with a team-1 militia
    parked 3 tiles away, stepped once.
  - done when: `194/194`; §9 and §9c re-run unmodified, which is the proof that adding the
    tower changed nothing about the Town Center's arrow.
  - test: 3 new checks written first — `tower: a built Watch Tower shoots the nearest enemy
    inside its line of sight` (`st.projectiles.length === 1` with
    `p.dmg === BLD.watch_tower.attack * (1 + 0.25 * st.ageBonus)`,
    `p.accuracy === BLD.watch_tower.accuracy` and `b.cd === BLD.watch_tower.reload` — the
    row's 5 / 100 / 2, asserted through the table the way §9c does), `tower: a Watch Tower holds
    fire while the enemy stands beyond its line of sight` (the same fixture with the enemy 12
    tiles away: no projectile, `b.cd` untouched), `tower: a built Market never shoots` (a built
    Market beside the enemy spawns nothing — the `!BLD[b.kind].attack` guard, and the proof the
    Market row brought no numbers of its own). The engine's reach for a building is
    `lineOfSight × TILE` (`index.html:899`); `range: 8` is carried as data but only units read
    it (`autoAcquire`, `index.html:925`), so these checks measure line of sight.

- [ ] T5: the committed frame — both buildings in `preview.png`
  - files: `tools/render-preview.js` (the `simulateAndRender` fixture, beside the blacksmith
    line at `tools/render-preview.js:123-125`), `preview.png`
  - change: two more `makeBuilding(... built = 1)` lines in the fixture — a Market on
    `findSite(world, villagerTx + 4, villagerTy - 1, 2)` and a Watch Tower on
    `findSite(world, villagerTx - 3, villagerTy + 1, 1)`, both clear of the blacksmith pad the
    same fixture already places — so the committed frame carries all three procedural
    buildings; nothing else in the tool changes.
  - done when: `node tools/render-preview.js` succeeds and the regenerated `preview.png`,
    inspected before committing per `AGENTS.md`, shows the squad in ranks with the blacksmith, a
    2×2 Market to the east and a 1×1 Watch Tower to the west; both new buildings draw through
    the shared `barracks and future kinds` branch (`index.html:1853-1858`), which paints its
    base rect with whatever fillStyle the previous draw left (the reason the current committed
    blacksmith cell is salmon), so the expectation is flat team-coloured blocks, not art.
  - test: visual — `node tools/render-preview.js` plus looking at `preview.png`; the code path
    it proves (the `noSprite` procedural draw) is asserted by the existing §5b3/§5c checks and
    no new assertion belongs here; `node tools/headless-check.js` still prints `194/194` and
    `assets/sprites.png` stays byte-identical.

- [ ] T6: Docs sync and the full verification pass
  - files: `docs/GAME_RULES.md` (the `## Buildings (BLD)` table at `docs/GAME_RULES.md:110`
    gains Market (1800 hp, 2×2, 175 wood, 60 s) and Watch Tower (850 hp, 1×1, 35 wood +
    125 stone, 80 s); the age-gate bullet stops naming only the Blacksmith and names every row
    that carries `age`; a Market trade rule stating the ladder and the rates with the `trade`
    line ref; a Watch Tower rule naming `stepBuildingAttacks`; every `index.html:NNN` the code
    tasks shifted, re-pointed), `docs/ARCHITECTURE.md` (the File map spans for §1/§4/§5/§6, the
    §4 Contents cell gains `trade`, the public-surface row, prose for both buildings),
    `docs/CHANGELOG.md` (a dated 2026-11-12 section listing T1–T6 with the 175 → 194 check
    counts), `docs/ROADMAP.md` (P1 item 5 marked shipped with this plan's link, plus the
    round's leftovers recorded: trade carts and land trade, Guard Tower and Keep, garrison
    mechanics, the two buildings' ripped frames folded into the P2 atlas item), `AGENTS.md` (the
    `index.html is 2589 lines` claim restamped to the real length), this plan's `Status: done`
  - change: docs only, one commit, no code edits — it also closes the line-ref drift T1–T5
    leave behind.
  - test: `node tools/audit-line-refs.js` green (section spans, cited symbols, tools inventory,
    the file-length claim), then the full `AGENTS.md` set: `node tools/headless-check.js`
    (`194/194 checks passed`, exit 0), `node tools/render-preview.js` + look at `preview.png`,
    `node tools/gen-atlas.js` (`assets/sprites.png` byte-identical),
    `node tools/check-stats.mjs` (exit 0, `11 buildings`).
