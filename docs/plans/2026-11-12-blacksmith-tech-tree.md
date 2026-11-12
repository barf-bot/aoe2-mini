# Blacksmith tech tree

Status: in progress

## Design

**What you'll see:** a buildable Blacksmith (hotkey `k`, needs Feudal Age). Selecting it
shows research buttons — Forge and Scale Mail for the melee line, Fletching and Bracer for
the archer line — each with its cost; researching shows a progress bar in the queue panel,
and once a tech lands the militia and archers hit harder and take less damage, and the
selected-building panel lists the active upgrades.

**How it works:** `data/techs.json` vendors the tech rows (cost, research time and effect
copied from the vendored sources `data/README.md` names, never retuned) and section 1 gains
a generated `TECHS` table beside `CFG`/`KINDS`/`BLD`, with `tools/check-stats.mjs` extended
to render and verify it the same way. `Game.techs` holds the researched tech ids; every
damage path goes through two pure helpers (`unitAttack(Game, u)`,
`unitArmor(Game, u, 'melee' | 'pierce')`) so the duplicated `atk * (1 + 0.25 * Game.ageBonus)`
expressions in section 4 (`spawnArrow`, `updateUnit`) collapse into one place that applies
age bonus and tech bonuses together. `blacksmith` joins `data/buildings.json` on the `BLAC`
row — the row `lumber_camp` currently borrows per the file's `rule` note, which the note
then stops needing — plus the new authored `age` field that gates a building behind an age,
the same gate the wooden-barricade item needs. Until a ripped frame lands, the blacksmith
draws with the procedural look the renderer already has for building kinds without an atlas
cell, so no new image files.

**Not in this round:** market, watch tower, wooden barricade, extra unit lines (spadownik,
knight), research queues longer than one item, save/load, sounds.

**How we check it:** `tools/headless-check.js` gains a techs section: researching deducts the
cost and starts the timer, finishing applies the effect through the shared helpers to both
the melee and the ranged damage path, the age gate rejects a pre-Feudal build and research,
a duplicate tech is rejected; `tools/check-stats.mjs` proves `TECHS` matches
`data/techs.json`; `tools/render-preview.js` regenerates `preview.png` with the blacksmith
on screen. Every existing check stays green.

**Hard constraints that survive from `AGENTS.md`:** the game stays one `index.html`; no
framework, no build step, no new image files beyond the one `assets/sprites.png` atlas;
`index.html` is patched, never rewritten; section 4 stays DOM-free; every task names a
proving check and the `Map of this file` banner stays truthful.

## Tasks

- [x] T1: The Blacksmith row, the age gate and the `k` hotkey
  - files: `data/buildings.json` (`buildings.blacksmith` + `source.rule` + `source.authored`),
    `tools/check-stats.mjs` (`bldValue`, the optional-field pattern at `tools/check-stats.mjs:101`),
    `index.html` §1 `BLD` (regenerated), §4 `build` (`index.html:1459-1468`), §5 `commandsHtml`
    (`index.html:2024-2031`), §6 keydown block (`index.html:2187-2193`), `tools/headless-check.js`
    (§5b3 `tools/headless-check.js:458-494`, §7, §10, §11), `data/sprites.json` untouched
  - change: `blacksmith` joins the data on the row the file already records — `id: 103`,
    `internalName: "BLAC"`, `hp: 1800`, `cost: { wood: 150 }`, `time: 40`, `attack: 0`,
    `meleeArmor: 0`, `pierceArmor: 7`, `lineOfSight: 6`, `garrisonCapacity: 0` — with the
    authored `label: 'Blacksmith'`, `w: 1`, `h: 1`, `pop: 0`, `trains: []` plus two new
    authored fields: `age: 1` (Feudal) and `noSprite: true`. `source.rule` loses its
    lumber_camp-borrowing sentence (the row now has the building it names; `lumber_camp`
    keeps the same numbers), `authored[]` gains `buildings.*.age` and `buildings.*.noSprite`.
    `bldValue` renders both new fields only when present (the `field` precedent), so every
    existing row prints byte-identically. `build()` gates on `if ((def.age ?? 0) > Game.age)
    return toast(Game, def.label + ' requires ' + AGES[def.age])` *before* `pickBuilder`, so a
    locked building never drafts a villager; existing rows have no `age` and stay
    Dark-Age-buildable. `commandsHtml` skips an age-locked kind instead of only disabling it;
    §6 gains `if (k === 'k') … 'blacksmith' …` beside the other placement hotkeys. §5b3's rule
    becomes "every BLD kind has a cell per team, except a kind marked `noSprite`, which must
    answer `bldSpriteFor(...) === null`" — that null is what routes the renderer to the
    procedural fallback it already has (`index.html:1760`), so no atlas change.
  - done when: `node tools/headless-check.js` prints `160/160 checks passed` (4 new checks,
    156 existing untouched); `node tools/check-stats.mjs` exits 0 with `blacksmith` present in
    the generated `BLD` (8 buildings); `node tools/gen-atlas.js` leaves `assets/sprites.png`
    byte-identical (no new cell); `preview.png` unchanged — the building enters the frame in T5.
  - test: 4 new checks, written before the code — `build: a Dark Age settlement cannot raise a
    Blacksmith (Feudal only)` (a `createState()` fixture returns `undefined`, toasts the gate,
    `Game.res` untouched), `build: a Feudal Blacksmith costs the table's 150 wood and completes
    in 40s` (set `age = 1`, place via `freeSpotAround`, spend exactly 150 wood, step
    `BLD.blacksmith.time`), `input: k arms Blacksmith placement` (and `Escape` clears it),
    `ui: the Blacksmith button appears with the Feudal Age` (the §11 paired-states pattern:
    absent from a Dark Age `commandsHtml`, present from Feudal); the amended §5b3 check; §7,
    §10, §11 re-run unmodified.

- [x] T2: `data/techs.json` and the generated `TECHS` table
  - files: `data/techs.json` (new), `tools/check-stats.mjs` (read the doc, `techValue()`,
    `renderTECHS()` beside `renderBLD` at `tools/check-stats.mjs:135`, the fourth block in
    `writeBlocks` (184-189), the `gameSurface()` guard (163-175), a `diffObject('TECHS', …)`
    plus its two presence loops), `index.html` §1 (a `// GENERATED FROM data/techs.json`
    `const TECHS = { … };` block between `BLD` and `const AGES`), `index.html` export block
    (`index.html:2456`), `data/README.md` (the `techs.json` row + the `data.Tech[<id>]` path)
  - change: vendor the four rows with their upstream ids, names, costs and times — `forge`
    (id 67 `Forging`, 150 food, 50s), `scale_mail` (id 74 `Scale Mail Armor`, 100 food, 40s),
    `fletching` (id 199, 100 food + 50 gold, 30s), `bracer` (id 201, 300 food + 200 gold,
    40s) — each authored with `label`, `age: 1`, `building: "blacksmith"`, and the numbers the
    engine reads: `atk: { melee, pierce }` and `armor: { melee, pierce }` (Forge +1 melee atk;
    Scale Mail +1 melee/+1 pierce armour; Fletching +1 pierce atk; Bracer +1 pierce armour).
    `design{}` records the two departures the design fixes instead of the current DE row
    (Bracer's armour half instead of its attack/range half; Fletching's +1 range not modelled
    because the engine has one attack number per unit) — the same block `data/units.json` uses
    for that. `renderTECHS` prints uniform rows (all four numbers on every row, no zero
    dropping) so `diffObject` can compare them, and the tool gains the cross-file rule "every
    tech names a building that exists in `buildings.json`", which T1's row now satisfies.
  - done when: `node tools/check-stats.mjs --write && node tools/check-stats.mjs` exits 0 and
    prints `ok index.html matches data/ -- N fields checked (CFG, 3 kinds, 8 buildings,
    4 techs)`; hand-breaking one number prints exactly `DRIFT TECHS.fletching.time
    index.html:31 data:30` and exits 1 (reverted afterwards); `node tools/headless-check.js`
    still prints `160/160` — nothing reads `TECHS` yet; `assets/sprites.png` byte-identical.
  - test: `tools/check-stats.mjs` is the check and is extended first — it goes red with
    ``no `const TECHS = { ... };` block found in index.html`` and then green; the existing
    §5 table checks plus a `160/160` headless run are the regression proof.

- [x] T3: `unitAttack` / `unitArmor` — one place for the damage math, `Game.techs` added
  - files: `index.html` §4 (a new `/* ---- combat math ---- */` sub-block directly above
    `hitUnit` at `index.html:763` holding `unitAttack(Game, u)` and `unitArmor(Game, u, type)`;
    `hitUnit` 762-769 and `hitBuilding` 835-844 take the armour type; `spawnArrow` 778-787 and
    `updateUnit`'s melee branch `index.html:914` lose their hand-written `atk * (1 + 0.25 *
    Game.ageBonus)`), `createState`/`resetGame` (`index.html:2272-2300`: `techs: new Set()`),
    the export block (`index.html:2456-2466`: `unitAttack, unitArmor`),
    `tools/headless-check.js` (new `§9d. attack & armour math` between §9c and §9e at 1500)
  - change: `unitAttack(Game, u)` resolves the attacker's table row the way `spawnArrow`
    already did (`u.atk === undefined ? BLD[u.kind].attack : u.atk`), maps the attacker's
    damage class (`atkType: 'ranged'` and a built building's arrow are `pierce`, everything
    else `melee`), adds `Σ Game.techs → TECHS[id].atk[class]` for unit attackers only (a
    Town Center's number is never raised by a unit tech) and scales only the table number by
    `(1 + 0.25 * Game.ageBonus)`, so a tech's +1 stays +1 in every age. `unitArmor(Game, u,
    type)` reads the same two tables (units carry no armour fields of their own — the table is
    the only source today) plus `Σ TECHS[id].armor[type]` for unit defenders. Both `hit`
    functions then apply `Math.max(1, dmg - unitArmor(...))` — armour softens a hit, never
    absorbs it — and take the armour type as a parameter defaulting to `'melee'`, which keeps
    the three existing harness calls (`hitUnit(ag, gt, 9999)`, `hitUnit(r5, vA, 999)`,
    `hitBuilding(ag, gb, 99999)`) valid and meaning a melee hit. `updateProjectiles` passes
    `'pierce'` for an arriving arrow; the melee swing passes `'melee'`; `spawnArrow` keeps
    `dmg = unitAttack(Game, from)` so §9c's `p.dmg === KINDS.archer.atk` and
    `tp.dmg === BLD.town_center.attack` still hold exactly.
  - done when: 166/166; §9's `ceil(hp / KINDS.militia.atk) * atkTime` kill-window check and
    §9c's two exact-damage checks pass **unmodified** — at Dark Age with no techs every number
    is the number it was before, which is the proof the collapse changed nothing.
  - test: 6 new §9d checks, written first — `math: a Dark Age militia swings the table's
    number`, `math: the age multiplier and a Forge bonus stack in one number` (`ageBonus = 1`
    + `forge` → `4 * 1.5 + 1`), `math: Forge raises the melee line and not the archer line`,
    `math: Fletching raises the archer line and not the melee line`, `math: Scale Mail raises
    the melee line's armour and Bracer the archer line's`, `math: armour softens a hit but
    never below 1` (a 4-damage pierce hit on a `pierceArmor: 7` building deals 1); §9, §9b,
    §9c re-run unmodified.

- [x] T4: `researchTech` — the blacksmith's one-slot research
  - files: `index.html` §4 (`researchTech(Game, b, id)` next to `train` at
    `index.html:1530-1544`; `makeBuilding` `index.html:626-631` gains `research: null`;
    `stepSim` `index.html:738-747` ticks it; `demolish` `index.html:1503` refuses a building
    with a research in flight, mirroring its existing "training" refusal; export block gains
    `researchTech`), `tools/headless-check.js` (new `§8b. research (blacksmith techs)` after
    §8, which ends at `tools/headless-check.js:1357`)
  - change: the design's one-item cap becomes a single `b.research = { id, t }` slot rather
    than a second queue list. `researchTech` refuses, through `toast`, anything it must not
    accept: an unknown tech, a tech whose `TECHS[id].building` isn't this building, a site that
    isn't finished, a tech whose `age` the game hasn't reached, a tech already in `Game.techs`,
    a slot already busy, a cost that can't be paid — and only then `spend`s and starts the
    timer. The `stepSim` tick mirrors the training loop: decrement, and at ≤ 0 add the id to
    `Game.techs`, toast `<label> researched` and clear the slot. Section 4 stays DOM-free.
  - done when: 172/172; the §8b fixture (fresh `createState`, a blacksmith placed through
    `makeBuilding`) shows a Dark Age research refused with `Game.res` untouched, an age-1
    Forge research deducting exactly `TECHS.forge.cost` and setting `b.research = { id:
    'forge', t: 50 }`, and 50 simulated seconds later `'forge' in Game.techs` with the slot
    cleared and `AoE2.unitAttack` on a militia reading `KINDS.militia.atk + 1`; a second
    Forge cycle refused; after a Fletching cycle `unitAttack` on an archer reads
    `KINDS.archer.atk + 1`.
  - test: 6 new §8b checks, written first — `research: research before the tech's age is
    refused`, `research: researching Forge spends exactly its cost and starts the timer`,
    `research: finishing Forge lands it in Game.techs and clears the slot` (and the melee-path
    effect through `unitAttack`), `research: a duplicate tech is refused`, `research: one
    research at a time` (a second tech while the first is in flight), `research: a barracks
    cannot research a blacksmith tech`; the existing §8 training checks re-run unmodified.

- [ ] T5: the research surface — buttons, bars, the upgrade list, the committed frame
  - files: `index.html` §5 `infoHtml` (1983-2003, the selected-building branch), `commandsHtml`
    (2005-2040), `queueHtml` (2042-2054), `drawBuildings` (1766-1770), §6's delegated click
    handler (2201-2211), `tools/render-preview.js` (the fixture, next to the `makeUnit`
    archer line at `tools/render-preview.js:123`), `preview.png`
  - change: `commandsHtml` offers `data-act="research" data-arg="<id>"` buttons with
    `fmtCost` for every TECHS row whose `building` is the selected built building and which
    isn't researched yet, disabled when unaffordable or when a research is already in flight;
    `queueHtml` renders `Researching <label>` + the bar from `TECHS[id].time` when `b.research`
    is set (and keeps the training branch otherwise); the on-map bar at 1766-1770 picks its
    total the same way instead of always `KINDS[b.queue[0].kind].time`; `infoHtml` lists the
    active upgrades for a selected building (`Upgrades: Forge, …`, nothing when none); §6
    dispatches `act === 'research'` to `researchTech`. `tools/render-preview.js` places a
    finished blacksmith on a `findSite` tile beside the squad so it is in the frame — with no
    atlas cell it draws through the procedural path T1 left it on.
  - done when: 175/175 and `preview.png`, regenerated and committed, shows the squad in ranks
    on land next to a standing Blacksmith (no atlas cell, so the procedural look) — the frame
    is inspected before committing, per `AGENTS.md`.
  - test: 3 new §11 checks written first — `ui: a built Blacksmith offers its unresearched techs
    with their costs`, `ui: the queue panel shows the research bar at the right percentage`,
    `ui: clicking a research button starts that research and spends the cost` — plus §11's
    existing button checks; visual = `node tools/render-preview.js` and look at `preview.png`.

- [ ] T6: Docs sync and the full verification pass
  - files: `docs/GAME_RULES.md` (a new `## Technologies (TECHS)` section; the `## Buildings
    (BLD)` block gains the blacksmith and the age gate; the `Age bonus multiplies damage`
    bullet at `docs/GAME_RULES.md:97` rewritten to name `unitAttack`/`unitArmor` and the
    `max(1, atk - armour)` rule; every `index.html:NNN` re-pointed), `docs/ARCHITECTURE.md`
    (the §4 Contents cell gains the `combat math` sub-block the audit requires for every named
    banner, the §1 line span, the public-surface row, `unitAttack`/`unitArmor`/`researchTech`
    prose), `docs/CHANGELOG.md` (dated entry), `docs/ROADMAP.md` (P1 item 4 marked shipped
    with the plan link, plus the two leftovers recorded: Fletching/Bracer's +1 range is not
    modelled, and the other buildings' real ages are still ungated), `AGENTS.md` (the
    `Where truth lives` table gains `data/techs.json`; the `index.html is N lines` claim the
    audit checks), this plan's `Status: done`
  - change: docs only, one commit, no code edits — it also closes the line-ref drift T1-T5
    leave behind.
  - test: `node tools/audit-line-refs.js` green (new sub-block citation, section spans, §1
    config range, tools inventory, file-length claim), then the full `AGENTS.md` set:
    `node tools/headless-check.js` (`175/175 checks passed`, exit 0),
    `node tools/render-preview.js` + look at `preview.png`, `node tools/gen-atlas.js`
    (`assets/sprites.png` byte-identical), `node tools/check-stats.mjs` (exit 0).
