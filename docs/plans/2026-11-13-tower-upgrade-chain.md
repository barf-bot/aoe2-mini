# Tower upgrade chain (Watch Tower → Guard Tower → Keep)

Status: in progress

## Design

**What you'll see:** selecting a built Watch Tower offers a new `Upgrade to Guard Tower`
command in the command grid; after that tower's build time the same tile holds a Guard
Tower, which in turn offers `Upgrade to Keep`. The selected building's label, hp bar and
attack change to the new row's numbers, `preview.png` shows the taller tower, and the
village's population/defence lines follow.

**How it works:** the chain's two missing tiers join `data/buildings.json` as vendored rows
(`guard_tower`, `keep`) — upstream `id` and `internal_name` recorded like every other row,
numbers copied not retuned, `age` and the `noSprite: true` mark authored here as the file's
`authored[]` says, so no new art enters the repo and item 8's atlas work stays separate. The
upgrade link itself is authored (`buildings.watch_tower.upgradesTo: guard_tower`,
`guard_tower.upgradesTo: keep`) because the table carries no upgrade column. Section 4 gains
one pure DOM-free command, `upgradeBuilding(Game, b)`: it refuses through `toast` (a
building whose row has no next tier, a next tier the team's age does not allow, cost the
team cannot pay, a tower already upgrading) and otherwise spends the target row's cost,
restarts `b.built` at its current fraction over the target row's `time` and, on completion,
flips `b.kind` to the target row so hp/maxHp/attack/range/armours/footprint come from the new
definition — reusing the existing construction pipeline in `sim` rather than a second timer,
so a tower mid-upgrade behaves exactly like any half-built building (it shoots nobody, which
`stepBuildingAttacks` already enforces) and the save payload needs no new field beyond the
authored `upgradesTo` chain. `src/hud.js` renders the button in the fixed command grid the
uniform-HUD round established; the tower's footprint never changes (all three tiers are the
same size), so `rebuildBlocks` and `canPlaceAt` need no new rules.

**Not in this round:** garrison mechanics, trade carts and land trade (item 5's other two
leftovers), the Stone Wall / Fortified Wall chain and gates (item 6), ripped art for any of
the three towers (item 8), and the enemy AI building or upgrading towers — the AI's build
order is unchanged this round.

**How we check it:** `tools/checks/05-construction.js` gains an upgrade section that proves
both halves per edge — a Dark Age team is refused with the age toast and spends nothing, a
Feudal team upgrades watch_tower→guard_tower for exactly the row's cost, the tower reads
`built < 1` and shoots nobody while upgrading, and at completion `b.kind === 'guard_tower'`
with the new row's hp/attack/range/armours; the same pass for guard_tower→keep; a building
with no `upgradesTo` and a tower already upgrading are both refused with `Game.res`
untouched. `tools/checks/09-hud.js` proves the button appears only when the next tier exists
and is payable, and `tools/check-stats.mjs` proves `src/config.js` carries the two new rows
byte-for-byte from the data. `node tools/headless-check.js -q` and
`node tools/render-preview.js` stay green, `assets/sprites.png` stays byte-identical (no new
art), and the `Map of this file` banner plus the docs' line refs stay truthful
(`tools/audit-line-refs.js`).

**Hard constraints that survive from `AGENTS.md`:** the game stays one `index.html`; no
framework, no build step, no new image files beyond the one `assets/sprites.png` atlas;
`index.html` is patched, never rewritten; section 4 stays DOM-free; every task names a
proving check and the `Map of this file` banner stays truthful.

Three places where the design's prose and the current tree disagree or leave a hole; all are
settled here so the executor does not have to guess:

- **The two `age` values.** `age` is authored in `data/buildings.json` (the table carries no
  age column), and `src/config.js:272` is `const AGES = ['Dark Age', 'Feudal Age', 'Castle
  Age']` — the game's ladder ends at Castle Age, while upstream marks the Guard Tower Castle
  and the Keep Imperial. The design's own test pair ("a Dark Age team is refused … a Feudal
  team upgrades watch_tower→guard_tower") fixes `guard_tower` at `age: 1`: `upgradeBuilding`'s
  gate is `next.age > Game.age[b.team]`, so a Feudal team can only succeed on a row gated at
  1, and a Dark Age team can only be refused by a row gated above 0. The Keep takes
  `age: 2` — the highest age this game can reach, so the second edge still has a real refusal
  half (a Feudal team reads `Keep requires Castle Age`) instead of a row anybody can build;
  an Imperial Age (and `upgradeAge`'s cost for it) is separate roadmap work, not this round.
  Both values go into `authored[]` the way the Barricade's authored `age: 1` did.
- **Where the flip lives, and what `cancelConstruction` does mid-upgrade.** "On completion,
  flips `b.kind`" and "the save payload needs no new field" can't both be literally true
  without saying where the pending tier is remembered — a half-built Watch Tower whose
  `built < 1` cannot otherwise tell "being upgraded" from "being built the first time", and
  deriving the target from `BLD[b.kind].upgradesTo` would turn every new Watch Tower into a
  Guard Tower the moment it finished. Settled: `upgradeBuilding` writes `b.upgrade =
  'guard_tower'` plus `b.built = 0` and `b.time = next.time`; `sim`'s existing `b.built >= 1`
  branch calls `promoteBuilding(Game, b)`, which sets `kind`/`w`/`h`/`x`/`y`/`maxHp`/`field`
  from the new row and clears `b.upgrade`. That is the design's "no new field" in the sense
  that matters to `src/save.js`: `encodeBuilding` (`src/save.js:62`) copies every key of the
  building, so `b.upgrade` rides along with no `CFG.VERSION` bump and no `validState` change,
  and 10-reset-save needs no new case. The hole the design leaves is Cancel — a tower
  mid-upgrade has `built < 1`, so the footer offers `Cancel`, and the plain rule would refund
  the *old* tier's 80 % and delete a standing tower. Settled: `cancelConstruction` refunds
  `floor(CFG.CANCEL_REFUND × BLD[b.upgrade].cost)` (the tier being paid for), clears
  `b.upgrade`, restores `b.built = 1` / `b.hp = b.maxHp` on the tier that stands, frees its
  builders and toasts `<tier> upgrade cancelled` instead of removing the building.
  `demolish` needs nothing: it already refuses an unfinished site with
  `Not built yet — cancel instead` (`src/commands.js:189`). Population needs nothing either:
  all three tower rows carry `pop: 0`, so `popCap` and the header's population line are
  unchanged by a tier change — the design's "the village's population/defence lines follow"
  comes from `BLD` the way the Defence tab's does.
- **`preview.png` "the taller tower".** Watch Tower, Guard Tower and Keep are all `1×1`
  `noSprite` rows, so all three draw the same flat team-coloured rectangle through the shared
  `barracks and future kinds` branch (`src/render.js:116`); nothing in the renderer changes
  until item 8 rips their frames. The frame change is that the committed scene now contains a
  Guard Tower footprint; the "taller" read the design means is the label / hp / attack the new
  row gives, proven in `tools/checks/09-hud.js` and `tools/checks/05-construction.js`.

Every number below is the tree at HEAD `c4ebbfc` (`node tools/headless-check.js -q` →
`364/364 checks passed`; `src/config.js` 317 lines, `src/commands.js` 288, `src/sim.js` 315,
`src/hud.js` 183, `tools/checks/05-construction.js` 523 with 67 checks,
`tools/checks/09-hud.js` 453 with 31; `node tools/check-stats.mjs` →
`333 fields checked (CFG, 3 kinds, 12 buildings, 4 techs)`). The T1 counts were measured on a
scratch copy of the repo with exactly T1's data + `check-stats.mjs` change applied.

## Tasks

- [x] T1: the `guard_tower` and `keep` rows — data, the `upgradesTo` link, the generated `BLD`
  - files: `data/buildings.json` (two rows appended after `barricade` — the file's arrival
    order; `buildings.watch_tower.upgradesTo` and `buildings.guard_tower.upgradesTo`;
    `source.authored` gains `buildings.watch_tower.upgradesTo`,
    `buildings.guard_tower.upgradesTo`; `source.rule` gains the provenance sentence),
    `tools/check-stats.mjs` (`bldValue` `tools/check-stats.mjs:108-112` optional-field block,
    `renderBLD` `tools/check-stats.mjs:174` print line), `src/config.js` §1 `BLD`
    (`src/config.js:171-246` → `:171-260`, regenerated, nothing else in the file edited),
    `data/README.md:10` (the row count and the authored list).
  - change: the two rows copied from the vendored table — `guard_tower`
    `{ "id": 234, "internalName": "WCTW2", "hp": 1500, "cost": { "wood": 35, "stone": 125 },
    "time": 80, "attack": 7, "meleeArmor": 2, "pierceArmor": 8, "lineOfSight": 10,
    "range": 8, "reload": 2, "accuracy": 100, "garrisonCapacity": 5 }` and `keep`
    `{ "id": 235, "internalName": "WCTW3", "hp": 2250, "cost": { "wood": 35, "stone": 125 },
    "time": 80, "attack": 8, "meleeArmor": 3, "pierceArmor": 9, "lineOfSight": 10,
    "range": 8, "reload": 2, "accuracy": 100, "garrisonCapacity": 5 }` (both rows are the
    `data.Building[234]` / `[235]` entries of the primary source in `source.urls`, the same
    table the Watch Tower row at `data.Building[79]` was copied from) — plus the authored half
    for each (`label: "Guard Tower"` / `"Keep"`, `w: 1`, `h: 1`, `pop: 0`, `trains: []`,
    `age: 1` / `age: 2`, `noSprite: true`) and the two `upgradesTo` links. `bldValue` gains
    `if (b.upgradesTo !== undefined) { … }` beside the `age`/`noSprite`/`trade` block,
    rejecting a non-string and a target that is not a row in the same file (the
    `TECHS.<name>.building` cross-file rule at `tools/check-stats.mjs:273-276`), and
    `renderBLD` prints `    upgradesTo: '<kind>',` on its own line beside the `trade:` line —
    `extras` (`tools/check-stats.mjs:165-166`) prints values bare, so a string cannot join it.
    `source.rule` gains: the id 234 / `WCTW2` row is published as `guard_tower` and the
    id 235 / `WCTW3` row as `keep`; `Guard Tower` and `Keep` are the authored labels for the
    Watch Tower's two upper tiers, their `age` gates are authored (the table carries no age
    column) and `upgradesTo` is authored because the table carries no upgrade column.
  - done when: before `--write`, `node tools/check-stats.mjs` exits 1 with exactly
    `DRIFT BLD.watch_tower.upgradesTo game:absent data:guard_tower`,
    `DRIFT BLD.guard_tower game:absent data:present`,
    `DRIFT BLD.keep game:absent data:present` (measured); after
    `node tools/check-stats.mjs --write` it prints
    `ok    src/config.js matches data/ -- 373 fields checked (CFG, 3 kinds, 14 buildings, 4 techs)`
    (333 → 373, `src/config.js` 317 → 331 lines) and hand-breaking `BLD.keep.hp` to 2251
    afterwards prints `DRIFT BLD.keep.hp game:2251 data:2250`, exit 1, reverted;
    `node tools/headless-check.js -q` prints `368/368 checks passed` (05-construction.js
    67 → 71 — §7e's table-driven age loop gains two checks per new row — every other check
    file's count unchanged); `node tools/gen-atlas.js` leaves `assets/sprites.png`
    byte-identical (two `noSprite` rows add no cell); `index.html` untouched (no new file, so
    no `<script src>` tag and no file-map row); the audit's complaints are exactly the
    shifted `src/config.js` refs T5 re-points — measured on the scratch copy: 4 problems
    (AGENTS.md:27 `:282-291`, docs/GAME_RULES.md:280 `:273`, :334 `:310-317`, :362 `:274`).
  - test: the check is the generator itself — `tools/check-stats.mjs` red → green is the row's
    proof (written first: `upgradesTo` in `bldValue`/`renderBLD` lands in the same commit as
    the data, so the field can never be added to `src/config.js` by hand). The 4 new
    `05-construction.js` §7e checks (`age: the Dark Age refuses the Guard Tower (row age 1)`,
    `age: the Feudal Age raises the Guard Tower (row age 1)`, `age: the Dark Age refuses the
    Keep (row age 2)`, `age: the Castle Age raises the Keep (row age 2)`) come from the loop at
    `tools/checks/05-construction.js:505-521` and need no edit; §5b3's `noSprite` rule in
    `tools/checks/02-sprites.js` covers the new kinds without being edited (its count stays
    14), and `tools/checks/13-render.js` proves the flat procedural draw the rows inherit.

- [x] T2: `upgradeBuilding` / `promoteBuilding` — the command, the sim hook, `§7f`
  - files: `src/commands.js` (both functions inserted between `upgradeAge`
    (`src/commands.js:266-276`) and the `/* ------------------------------- toast --------`
    banner at `src/commands.js:278`, so `upgradeBuilding` starts at line 278 and every
    existing `src/commands.js:NNN` doc ref — 7, 93, 114, 156, 166, 186, 200, 215, 231, 250,
    266 — still points at the same function), `src/commands.js:166-180`
    (`cancelConstruction`'s `b.upgrade` branch), `src/sim.js:251-256` (one line after
    `b.built = 1;` at `src/sim.js:252`: `if (b.upgrade) promoteBuilding(Game, b);`),
    `src/main.js:14` (the commands export line gains `upgradeBuilding, promoteBuilding` —
    edited in place, no line shift), `tools/checks/05-construction.js` (a new
    `/* ---- 7f. the tower upgrade chain (this plan, T2) --------------------------- */`
    between §7e, which ends at line 521, and `report()` at 523, plus the file header at
    `tools/checks/05-construction.js:2-4` naming the new topic).
  - change: `upgradeBuilding(Game, b)` — the refusal ladder in the design's order, every
    answer a `toast` and `undefined` before anything is spent: `!b || b.team !== 0` →
    `Not your building` (the string `cancelConstruction`/`demolish` use); `b.built < 1` →
    `Already under construction` (the design's "a tower already upgrading" refusal — a tower
    mid-upgrade is by definition an unfinished site); no `BLD[b.kind].upgradesTo` →
    `<label> has no upgrade`; `(next.age ?? 0) > Game.age[b.team]` →
    `<next label> requires <AGES[next.age]>` (`build`'s wording, `src/commands.js:120`);
    `!canAfford(Game, b.team, next.cost)` → `Not enough <missing(Game, b.team, next.cost)>`;
    empty `pickBuilders(Game, { tx: b.tx, ty: b.ty })` → the `build` pair
    `All villagers are building` / `No villager available` (`src/commands.js:122-123`). Then
    `spend(Game, b.team, next.cost)`, `b.upgrade = nextKind`, `b.built = 0`,
    `b.time = next.time`, every drafted villager gets `u.order = { kind: 'build', b: b.id }`
    and `u.slot = null`, `markDirty(Game)`, `toast(Game, next.label + ' started')`, return `b`.
    `promoteBuilding(Game, b)` — the completion half `sim` calls: `b.kind = b.upgrade`,
    `b.upgrade = null`, then the row-derived fields from the new row (`w`, `h`, `x`, `y`,
    `maxHp`, `field`) with `b.hp = b.maxHp`, `rebuildBlocks(Game)` and `Game.mapEpoch++` (the
    footprint is identical across the chain, so routes never actually reroute); the existing
    `toast(Game, BLD[b.kind].label + ' complete')` on the next line then names the new tier.
    `cancelConstruction` — after its `Not your building` guard and before the
    `b.built >= 1` refusal, the upgrade branch: refund
    `floor(CFG.CANCEL_REFUND × BLD[b.upgrade].cost)` per key, free the builders of that site,
    `b.upgrade = null`, `b.built = 1`, `b.hp = b.maxHp`, `markDirty`,
    `toast(Game, BLD[<the refunded tier>].label + ' upgrade cancelled')`, return `true`, and
    never call `removeBuilding`.
  - done when: `node tools/headless-check.js -q` prints `376/376 checks passed`
    (05-construction.js 71 → 79) and every number the new checks read comes off the rows, not
    from literals — a Feudal upgrade spends `{ wood: 35, stone: 125 }` and finishes with
    `b.maxHp === 1500`, `unitAttack(st, b) === 7`, `unitArmor(st, b, 'pierce') === 8`,
    `unitArmor(st, b, 'melee') === 2`, `b.w === 1 && b.h === 1`,
    `(st.blocks.get(b.id) || []).length === 1`, `b.upgrade === null`; a Castle upgrade of that
    tier spends the same cost and finishes with `b.maxHp === 2250`, `unitAttack === 8`,
    `unitArmor(st, b, 'pierce') === 9`; `b.time === 80` throughout (both rows' `time`), the
    cancel refund is `floor(35 × 0.8) = 28` wood and `floor(125 × 0.8) = 100` stone; the
    `src/commands.js` header comment at `src/commands.js:2-3` still describes itself
    accurately (build/train/research/trade/orders + the chain) and §4 stays DOM-free
    (the audit's DOM-free rule passes for the file).
  - test: 8 checks in `tools/checks/05-construction.js` §7f, written before the code, on
    throwaway `flatState()` fixtures built with the §7d idiom (select the villager, bank the
    exact cost under test, `makeBuilding` + `built = 1` for the tier being upgraded, then step
    with `for (let i = 0; i < Math.ceil(AoE2.BLD[next].time / DT) + 2; i++) AoE2.stepSim(st, DT)`):
    `age: a Dark Age team cannot upgrade a Watch Tower (Guard Tower requires Feudal Age)`,
    `age: a Feudal team cannot upgrade a Guard Tower (Keep requires Castle Age)` — both with
    `Game.res` untouched, `b.upgrade === null`, `b.kind` unchanged;
    `upgrade: a Feudal Watch Tower spends exactly the Guard Tower row's cost and becomes a
    half-built Watch Tower` (res → `{food:0,wood:0,gold:0,stone:0}`, `b.upgrade ===
    'guard_tower'`, `b.built < 1`, `b.time === 80`, the selected villager's order is
    `{kind:'build', b: b.id}`, toast `Guard Tower started`);
    `upgrade: a half-upgraded tower shoots nobody and the finished one does` (an enemy militia
    inside the row's line of sight, `b.cd = 0`, `AoE2.stepBuildingAttacks(st, DT)` →
    `st.projectiles.length === 0` while `built < 1`, and `=== 1` after the completion — the
    design's `stepBuildingAttacks` clause);
    `upgrade: completing it is a Guard Tower with the row's hp, attack and armours`;
    `upgrade: that Guard Tower upgrades to a Keep for the Keep row's cost` (the second edge,
    Castle team, same shape: spend, step, `b.kind === 'keep'` with the numbers above);
    `upgrade: a Keep has no further tier and an enemy tower is not yours to upgrade` (both
    refusals, `Game.res` untouched in each);
    `upgrade: with no villager to spare the cost is never spent` (`st.units = []` →
    `No villager available`, res untouched);
    `cancel: cancelling an in-progress upgrade refunds 80% of the tier under construction and
    keeps the Watch Tower standing`.

- [ ] T3: the Upgrade button in the command grid and its click handler
  - files: `src/hud.js:106-159` (`commandsHtml`: the button lines added inside the existing
    `if (b && b.built >= 1)` block, after the Market trade block that ends at
    `src/hud.js:132` — `src/hud.js:161`/`:181` shift by the added lines and nothing cites
    them), `src/input.js:243-254` (the delegated `data-act` ladder gains
    `else if (act === 'upgrade' && Game.selectedBuilding) upgradeBuilding(Game, Game.selectedBuilding);`
    beside the `cancel`/`demolish` lines), `tools/checks/09-hud.js` (four checks added to
    §11, which ends at `tools/checks/09-hud.js:200`, plus the header comment at
    `tools/checks/09-hud.js:2`).
  - change: inside the finished-building block,
    `const up = BLD[b.kind].upgradesTo;` and, when `up` exists and
    `(BLD[up].age ?? 0) <= Game.age[b.team]`, push
    `'<button data-act="upgrade" data-arg="' + up + '"' + (canAfford(Game, b.team, BLD[up].cost) ? '' : ' disabled') + '>Upgrade to ' + BLD[up].label + '<span class="c">' + fmtCost(BLD[up].cost) + '</span></button>'`.
    The two existing affordance rules, applied together the way the design asks: an age-locked
    next tier is not offered at all (the villager build list, `src/hud.js:145`) and an
    unaffordable one is offered `disabled` (the train and market buttons,
    `src/hud.js:112`/`:127`). No new CSS (the fixed grid takes another button), no new
    `hudState` value (`src/hud.js:38` already answers `building`), no hotkey — an upgrade
    needs no tile to place.
  - done when: `node tools/headless-check.js -q` prints `380/380 checks passed`
    (09-hud.js 31 → 35) and the grid for a finished Watch Tower contains
    `data-act="upgrade" data-arg="guard_tower"` with the label `Upgrade to Guard Tower` and
    the cost `35 W 125 S`, for a finished House and a finished Keep contains no
    `data-act="upgrade"` at all, and a half-built upgrading tower offers `cancel` and no
    `upgrade` button (the `b.built >= 1` gate, unchanged).
  - test: 4 checks in `tools/checks/09-hud.js` §11, written first, following the §11 market
    fixture shape (`Game.selection = []` + a `Game.selectedBuilding` built with
    `AoE2.makeBuilding`/`built = 1` + `AoE2.commandsHtml(Game)` markup + a `stubEl` button
    dispatched through `Game.dom.commands.listeners.click`):
    `ui: a finished Watch Tower offers Upgrade to Guard Tower, enabled when the tier is
    payable and disabled when it is not` (mark the markup twice, funded then stone-short);
    `ui: a House and a finished Keep offer no upgrade button`;
    `ui: clicking the Upgrade button starts the upgrade and spends the tier's cost`
    (`b.upgrade === 'guard_tower'`, `b.built < 1`, res short by 35 wood + 125 stone);
    `ui: the info panel names the tier the tower became` (set `b.built = 1 - DT / 2`, one
    `AoE2.stepSim(Game, DT)` — needs `DT` added to the harness destructure at
    `tools/checks/09-hud.js:5-7` — then `AoE2.infoHtml(Game)` contains `Guard Tower` and
    `width:100%`, the design's "label, hp bar and attack change to the new row's numbers").

- [ ] T4: the committed frame — a Guard Tower in `preview.png`
  - files: `tools/render-preview.js` (the `simulateAndRender` fixture, after the Watch Tower /
    Barricade lines at `tools/render-preview.js:135-142`), `preview.png`.
  - change: one more building line —
    `if (villagers[0]) { const site = G.findSite(Game.world, Math.floor(villagers[0].x / G.CFG.TILE) - 1, Math.floor(villagers[0].y / G.CFG.TILE) + 2, 1); const gt = G.makeBuilding(Game, 'guard_tower', 0, site.tx, site.ty); gt.built = 1; }`
    — one tile north of the Watch Tower's pad (−3, +1) and clear of the blacksmith (+1, 0),
    the Market (+4, −1) and the barricade (+2, +1). If the rendered frame shows it overlapping
    another footprint or out of the camera, move it one tile further out and re-render: the
    committed PNG is the proof (`AGENTS.md`: look at it before committing). Nothing else in the
    tool changes.
  - done when: `node tools/render-preview.js` prints
    `rendered <W×H> frame (<n> bytes) after 8s of simulated play`, and the regenerated
    `preview.png`, inspected, shows the moving ranks plus the flat team-coloured footprints of
    the blacksmith, the Market, the Watch Tower, the Barricade and the new Guard Tower; the
    commit carries the PNG; `node tools/gen-atlas.js` still leaves `assets/sprites.png`
    byte-identical.
  - test: visual — `node tools/render-preview.js` plus looking at `preview.png`. The draw path
    it proves (the `noSprite` procedural rectangle, `src/render.js:116`) is already asserted by
    `tools/checks/02-sprites.js` §5b3 and `tools/checks/13-render.js`, so no new assertion
    belongs here; `node tools/headless-check.js -q` still prints `380/380`.

- [ ] T5: docs sync and the full verification pass
  - files: `docs/GAME_RULES.md`, `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`,
    `docs/ROADMAP.md`, `AGENTS.md`, `README.md`, this plan's `Status`.
  - change: docs only, one commit, no code edits. `docs/GAME_RULES.md` — the `## Buildings
    (`BLD`)` table gains `| Guard Tower | Feudal | 1500 | 1×1 | 35 wood + 125 stone | 80 s | —
    | — |` and `| Keep | Castle | 2250 | 1×1 | 35 wood + 125 stone | 80 s | — | — |`; the
    age-class rule at `docs/GAME_RULES.md:142-154` is restamped (five Dark rows, eight Feudal,
    one Castle, and the hotkey list unchanged); a new rule documents the chain — `upgradeBuilding`
    and `promoteBuilding` (`src/commands.js:278` plus the line T2 puts the second one on) spend
    the next row's cost and flip `b.kind` at completion so hp/attack/range/armours come from
    the new row, with the `Not your building` / `Already under construction` /
    `<label> has no upgrade` / `<label> requires <Age>` / `Not enough <res>` /
    `No villager available` refusal ladder and the `… upgrade cancelled` refund rule; and
    every ref T1–T3 shifted is re-pointed — `src/config.js:272→:286`, `:273→:287`,
    `:274→:288`, `:310-317→:324-331` (`docs/GAME_RULES.md:249`, `:280`, `:362`, `:334`) and
    `src/sim.js:313→:314` (`docs/GAME_RULES.md:104`, `:226`; the `src/sim.js:252` ref at `:346`
    is untouched, because T2's line goes after it) — measured against the files, not from this
    table, since the audit checks them. `AGENTS.md:27` and `README.md:13` — the
    `src/config.js:282-291` palette ref becomes `:296-305` and the `src/` file count sentence
    is unchanged (no new file). `docs/ARCHITECTURE.md` — the `src/commands.js` file-map row
    (`docs/ARCHITECTURE.md:31`) gains `upgradeBuilding`/`promoteBuilding`, the `src/sim.js` row
    (`:28`) names the promotion call, and the `build` sentence at `:93` gains "…and promotes it
    when the site is an upgrade in progress". `docs/CHANGELOG.md` — a dated section for
    T1–T4 with the `364 → 380` check counts and the `333 → 373` field count.
    `docs/ROADMAP.md` — P1 item 5's leftover line drops "the Guard Tower and Keep upgrade
    chain" (trade carts / land trade and garrison mechanics remain) and links this plan; P2
    item 8's `noSprite` list gains the Guard Tower and the Keep. This plan's `Status: planned`
    → `Status: done`.
  - test: `node tools/audit-line-refs.js` green (line refs, file map, DOM-free rule, tool
    inventory) — it is red from T1 onward, the house precedent, and this commit closes it.
    Then the full `AGENTS.md` set on the final tree: `node tools/headless-check.js -q`
    (`380/380 checks passed`, exit 0), `node tools/check-stats.mjs` (exit 0,
    `373 fields checked (CFG, 3 kinds, 14 buildings, 4 techs)`),
    `node tools/render-preview.js` + look at `preview.png`, `node tools/gen-atlas.js`
    (`assets/sprites.png` byte-identical), `node tools/audit-line-refs.js`.
