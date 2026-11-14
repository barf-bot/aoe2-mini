# Strix roadmap — review + work plan for the local model

Status: open (written 2026-11-14 at HEAD `fa21543`, branch `ccr-521786a6-e0qp5x`)

This plan is written to be executed by a **local model on the Strix box**, one task card
per session. It differs from the earlier plans in `docs/plans/` on purpose: those are 300–400
lines of prose per feature and cite line numbers; this one is a backlog of small cards that
name functions instead of lines, each with the check that proves it and a hard "done when".
Read §2 (how to work) once, then pick the next unchecked card in §9 (the order).

---

## 1. Review — where the project stands

Baseline measured at `fa21543`: `node tools/headless-check.js -q` → **409/409**,
`node tools/check-stats.mjs` → 373 fields OK, `node tools/audit-line-refs.js` → 227 doc
checks OK. The full suite runs in ~1.1 s.

**What is good and must not be undone**

- The verification loop is excellent for an agent: independent check files, a stub DOM, a
  loader that runs exactly the browser's script list, generated stat tables proven against
  vendored AoE2 data, a real-renderer preview, an audit that keeps docs honest.
- The architecture is clean: one `Game` object, DOM-free logic files, seeded RNG, every
  refusal through `toast`. Keep all of it.

**Findings (all verified on 2026-11-14 unless marked)**

| # | Finding | Severity | Where it is tracked |
|---|---|---|---|
| R1 | `main` is **50 commits behind** this branch: the live site still serves the pre-`src/`-split single file. Garrison, tower chain, age gating, smoke test — none of it is deployed. | high | §3 G0 (human) |
| R2 | The enemy AI is inert after ~4 min: never builds a house, never re-tasks villagers, never gathers wood/gold, never ages, sends waves of 0 militia. With an idle player nothing happens for 30 minutes — **the game cannot be lost**. | high | TODO 20, §5 |
| R3 | The AI cheats: `queueTrain` puts militia on its Town Center queue, bypassing `train`. | med | TODO 21, §5 A2 |
| R4 | `build` and `upgradeAge` are hard-wired to team 0, and `toast` is global — the AI cannot use the player's commands without spamming the player's toast line. | med (blocks R2) | §5 A1 |
| R5 | `New map` / `New game` / `N` always rebuild seed 1337; the docs claim it reseeds. | med | TODO 22 |
| R6 | `N` erases the save and restarts with no confirmation; it sits next to build hotkeys. | med | TODO 23 |
| R7 | Blacksmith techs buff villagers (Forge, Scale Mail) and never reach buildings (Fletching skips the TC and towers). | low | TODO 24 |
| R8 | 150-unit order: average step 1 ms, **worst 46 ms** (A\* burst on the first frames). | low | TODO 25 |
| R9 | Variable timestep: `startLoop` feeds real frame time to `stepSim`, and `Game.rnd` (a closure) is not saved. Same inputs ≠ same game, so replays, pause/speed and a determinism check are all blocked. | design | §3 G6 |
| R10 | File-size rule is already broken: `commands.js` 418, `movement.js` 357, `input.js` 332, `sim.js` 328, `render.js` 321; check files `04` 756, `05` 750, `10` 691. Every new feature lands in exactly these files. | process | §3 G4/G5 |
| R11 | ~180 audited `src/x.js:NNN` refs in the docs (GAME_RULES 117, ARCHITECTURE 54). Every edit above a cited line breaks the audit and the agent must hand-renumber. `docs/CHANGELOG.md` has 88 more refs the audit does not check, so those silently rot. | process — the single biggest tax on a local model | §3 G2/G3 |
| R12 | ROADMAP says the barricade key is `w`; it is `q`. | trivial | TODO 26 |

Not bugs, but worth a decision (§8): the attack formula's `+25 % per age` scaling is an
invention (AoE2 has no such rule); Bracer is ported as armour instead of its range/attack
half; Fletching's +1 range is not modelled.

---

## 2. How the local model works this plan

The Strix box runs the model in unified memory: generation is fine, **prompt processing
(prefill) is the slow part**, so every file read costs wall-clock. The rules below keep a
session to a few thousand lines of reading and make failure cheap.

**One card = one fresh session = one commit.** Do not carry context from the previous card.

1. Read `AGENTS.md`, then **only** this plan's §2 and the one card you are on.
2. `git status` must be clean and `npm run verify --prefix tools` (card G1; until it exists,
   the five commands in `AGENTS.md`) must be green **before** you change anything. Red tree →
   stop and report; never build on red.
3. Read only what the card's **Read** line names. Locate functions with
   `grep -n "function NAME" src/*.js` and read ~60 lines around them with
   `sed -n 'A,Bp'`; do not `cat` a 400-line file.
4. Write the check first, in the file the card names, and run that file alone:
   `node tools/checks/NN-topic.js | grep -v '^PASS'` — it must FAIL for the right reason.
5. Change the code with small patches (never rewrite a whole file). Run the single check file
   until it passes, then the full verify.
6. If the audit fails only on moved line refs: `node tools/audit-line-refs.js --fix`
   (card G2). Otherwise fix the doc sentence by hand.
7. Update `docs/GAME_RULES.md` if a rule/number changed, delete the TODO item if the card
   fixes one, add **at most 12 lines** to `docs/CHANGELOG.md`, tick the card's box here.
8. Commit: imperative subject, one logical change (`Add the idle-villager counter and the
   period hotkey`). Then `git push origin main`. **`main` is the live site** — never push
   unless verify printed `VERIFY OK` in this session after your last edit.

**Hard stops** — do not work around these, write them down and stop:

- Three verify runs fail on the same error → `git checkout -- . && git clean -fd src tools docs`,
  append the card id, the error and your best guess to `docs/plans/BLOCKED.md`, end the session.
- **Table numbers are vendored, never invented or retuned** (`data/README.md`). The box has
  internet: a card marked *needs vendoring* starts by fetching the row from the URLs in the
  `source` block of the matching `data/*.json`, copying the numbers unchanged, and listing
  any field you had to author in `source.authored`. If the row is not in the source → stop.
- Never delete or weaken an existing check to get green. If you believe a check is wrong,
  that is a BLOCKED note, not an edit.
- Never hand-edit the generated blocks of `src/config.js` or `assets/sprites.png`.
- Never use `Math.random()` / `Date.now()` in the logic files; never name `document` or
  `window` in them; never add a top-level statement outside `src/config.js` / `src/main.js`.
- A new `src/` file needs: `<script src>` in `index.html` (before `src/main.js`), a row in the
  `docs/ARCHITECTURE.md` file map, a row in the `AGENTS.md` "where code goes" table. A new
  `tools/` file needs a mention in `AGENTS.md` **and** `README.md`. The audit fails otherwise.
- Any function a check calls must be added to the `AoE2` object in `src/main.js`.

Card format used below: **Read** (what to open), **Change**, **Check** (file + assertion),
**Done when**, **Size** (S ≤ 1 h of model time, M, L = split it further before starting),
**Needs** (cards that must be done first). Owner is the agent unless it says *human*.

A prompt you can paste per session is in §10.

---

## 3. Phase 0 — groundwork (do these first; they make every later card cheaper)

- [x] **G0 — Deploy what exists, move to `main`**
  - `git fetch origin && git checkout main && git merge --ff-only origin/ccr-521786a6-e0qp5x`
    (a fast-forward: `main` is an ancestor), verify green, `git push origin main`. Wait ~60 s,
    then byte checks: `curl -s <site>/index.html | diff - index.html` and the same for two `src/` files. Run
    `npm run browser-smoke --prefix tools` (if Playwright has no browser:
    `npx --prefix tools playwright install chromium`). Write in `AGENTS.md` §Deploy: all work
    happens on `main`, one push per green card.
  - **Done when:** the live page has the garrison `Leave` button and the smoke test passes for
    both targets.

- [x] **G1 — `npm run verify`: one command, one verdict**
  - **Read:** `tools/package.json`, the verify block in `AGENTS.md`, `.github/workflows/check.yml`.
  - **Change:** new `tools/verify.js` that runs, in order, `headless-check.js -q`,
    `check-stats.mjs`, `audit-line-refs.js`, `gen-atlas.js` followed by
    `git diff --exit-code -- src/config.js assets/sprites.png`, and
    `render-preview.js --out <os.tmpdir()>/preview.png`; stops at the first failure and
    prints exactly one last line: `VERIFY OK` or `VERIFY FAIL: <step>` (exit 0/1). Add
    `"verify": "node verify.js"` to `tools/package.json`. Mention it in `AGENTS.md` and
    `README.md` (the audit's tool-inventory rule). CI may keep its separate steps.
  - **Check:** run it on the clean tree (OK) and after `echo x >> src/config.js` (FAIL at
    `check-stats`), then restore.
  - **Done when:** `npm run verify --prefix tools` prints `VERIFY OK`. **Size:** S.

- [x] **G2 — `audit-line-refs.js --fix`**
  - **Read:** `tools/audit-line-refs.js` (whole file, it is the subject).
  - **Change:** with `--fix`, for each failing `path:NNN[-MMM]` ref, find the identifiers the
    audit already extracts from the citing sentence (`wordSet`); search the target file for
    `function <word>` / `const <word>` / `<word>:` and, if exactly one candidate line exists,
    rewrite the ref to that line (shift a range by the same delta). Rewrite the doc in place,
    print `fixed N, left M`, and still exit 1 if anything is left.
  - **Check:** a self-test inside the tool's own `--selftest` flag, or by hand: copy the repo to
    a scratch dir, insert 5 blank lines at the top of `src/sim.js`, run the audit (fails),
    `--fix` (passes), and `git diff` shows only number changes in the docs.
  - **Done when:** the scratch experiment above is green and the real tree is unchanged.
    **Size:** M.

- [x] **G3 — Stop the line-ref tax from growing**
  - **Change:** in `docs/CONVENTIONS.md` and `AGENTS.md`, add the rule: new prose cites
    `functionName` (`src/file.js`) — no line number — unless the line is not a function
    (a table row, a CSS rule). CHANGELOG entries: ≤ 12 lines, no line numbers. Add
    `docs/plans/TEMPLATE.md` holding the card format of §2 so later plans stay short.
  - **Done when:** verify green; `TEMPLATE.md` exists. **Size:** S.

- [ ] **G4 — Split `src/commands.js` (418 lines)**
  - **Read:** `src/commands.js` function list (`grep -n "^function"`), `index.html` script
    list, the file-map table in `docs/ARCHITECTURE.md`.
  - **Change:** move `upgradeBuilding`, `promoteBuilding`, `ringSpot`, `placeOnRing`,
    `garrisonUnits`, `leaveBuilding` verbatim into a new `src/structures.js` (header comment,
    `'use strict';`, DOM-free) loaded right after `src/commands.js`. No behaviour change.
  - **Check:** none new — the 409 existing checks are the proof.
  - **Done when:** verify green, `commands.js` < 300 lines, file map + AGENTS table updated,
    `audit-line-refs --fix` applied. **Size:** S. **Needs:** G2.

- [ ] **G5 — Hotkeys become a table**
  - **Read:** the keydown listener in `attachInput` (`src/input.js`).
  - **Change:** in the hand-written part of `src/config.js`, add
    `const HOTKEYS = { build: { h: 'house', f: 'farm', ... q: 'barricade' }, pan: {...},
    cmd: { t: 'age', n: 'newMap' } }`; the listener becomes a lookup. Export `HOTKEYS` in
    `AoE2`. Every later card that adds a key adds a table row, nothing else in the ladder.
  - **Check:** `08-input.js`: every `HOTKEYS.build` key toggles `Game.placing` to its kind
    (drive the listener through the harness's stub `document` the way the existing §10
    keyboard checks do), and no key appears twice across the table.
  - **Done when:** verify green; the if-ladder is gone. **Size:** S.

- [ ] **G6 — Fixed simulation timestep**
  - **Read:** `startLoop`, `stepGame` (`src/boot.js`), `stepSim` head (`src/sim.js`),
    `decodeState` + `mulberry32` (`src/save.js`, `src/world.js`).
  - **Change:** `CFG.SIM_DT` (1/30, hand-written part of config, with a comment). `stepGame`
    keeps panning per frame but accumulates `Game.simAcc += dt` and calls
    `stepSim(Game, CFG.SIM_DT)` while `simAcc >= SIM_DT`, at most 5 times per frame.
    `Game.simAcc` is transient (add it to the "never saved" list in `src/save.js`). Make the
    RNG resumable: `Game.rngState` (a number) + `nextRand(Game)` replacing `Game.rnd()`
    calls, and save `rngState`; bump `CFG.VERSION` and add the `migrate` step (old saves:
    `rngState = world.seed`).
  - **Check:** `00-boot.js`: `stepGame(g, 0.1)` advances `g.time` by exactly `3 * SIM_DT`;
    `stepGame(g, 0.01)` three times advances by exactly one step. `10-reset-save.js`: save,
    load, step 300 → identical `encodeState` to the run that never saved.
  - **Done when:** verify green. **Size:** M. This unblocks G8, Q2, S2.

- [ ] **G7 — `tools/ai-arena.js`: a headless match runner**
  - **Read:** `tools/lib/load-game.js`, `tools/checks/12-ai.js` (the `village` fixture).
  - **Change:** `node tools/ai-arena.js --seeds 1-10 --minutes 20 [--blue idle|ai] [--json]`
    boots a state per seed (needs TODO 22's `resetGame(Game, seed)`), sets `started`, steps
    `stepSim` at `SIM_DT`, samples every 60 s and prints one line per seed: winner, end time,
    red/blue villagers, fighters, buildings, total gathered per resource. `--blue ai` runs
    `aiStep` for team 0 too (after A1). Plain node, no npm deps. Document in AGENTS + README.
  - **Done when:** it runs on today's code and shows R2 (red flat at 5 pop). **Size:** S.
    This is the **measuring stick for every §5 card** — paste its before/after output into the
    commit message body.

- [ ] **G8 — Determinism check**
  - **Change:** new `tools/checks/14-determinism.js`: two `createState()` with the same seed,
    the same scripted orders at the same steps (move, build a house, train), 3000 steps each,
    then `JSON.stringify(encodeState(...))` must match; a third with a different seed must not.
  - **Done when:** verify green (count goes up). **Size:** S. **Needs:** G6.

---

## 4. Phase 1 — the open bugs

Each is a full card already: see `docs/TODO.md` items 22–26 for cause, fix direction and the
check. Order: **23** (N confirm, S) → **22** (reseed, S) → **26** (doc, S) → **24** (tech
`affects`, M — the `affects` lists are authored, so they are allowed in `data/techs.json`
under `source.authored`) → **25** (path budget, M). Items 20 and 21 are §5.

---

## 5. Phase 2 — an opponent worth playing

Today's AI is ~30 lines of logic. The goal of this phase: **with an idle player, red wins
inside 20 minutes on every seed; against `--blue ai`, red wins 40–60 % of seeds.** Every card
reports `tools/ai-arena.js` before/after.

- [ ] **A1 — Commands take a team**
  - **Read:** `build`, `pickBuilders`, `upgradeAge`, `toast` (`src/commands.js`).
  - **Change:** `build(Game, kind, atX, atY, team = 0, crew = null)` — `crew` is an explicit
    list of villager ids (the AI passes it; the player path keeps using the selection).
    `upgradeAge(Game, team = 0)`. `toast(Game, msg, team = 0)`: for team ≠ 0 push
    `{t: Game.time, msg}` onto `Game.aiLog` (keep the last 50, not saved) and return without
    touching `toastMsg`. Every existing call site keeps its behaviour by default arguments.
  - **Check:** `12-ai.js`: red `build('house', x, y, 1, [id])` places a red site and spends
    red wood; red `upgradeAge` without food leaves `Game.toastMsg` unchanged and logs to
    `aiLog`; blue's 409 checks still green.
  - **Done when:** verify green. **Size:** M.

- [ ] **A2 — AI state and tick, no cheating** (fixes TODO 21)
  - **Change:** `Game.ai = [null, {…}]` per-team brain state (saved; version bump if G6 did
    not already). `aiStep` runs a decision every `CFG.AI_TICK` (1 s) and keeps the wave clock
    separately. Delete `queueTrain`; all training through `train`. Split `src/ai.js` into
    `aiStep` (dispatcher) + small `ai*` helpers; if it passes ~250 lines, add `src/ai-eco.js`.
  - **Check:** `12-ai.js`: a red village with no Barracks never has `militia` in any queue
    over 5 simulated minutes; `aiStep` acts on a 1 s cadence.
  - **Size:** M. **Needs:** A1.

- [ ] **A3 — Every red villager has a job**
  - **Read:** `assignStarter` (`src/boot.js`), `findAlternative` (`src/world.js`),
    `sourceFromTile` (`src/entities.js`).
  - **Change:** move `assignStarter`'s search into a pure `findJob(Game, v, res)` in
    `src/economy.js` (boot keeps calling it). Each AI tick, every idle red villager gets the
    resource furthest below a target split (`CFG.AI_SPLIT = {food: .5, wood: .35, gold: .15}`),
    and the TC keeps one villager queued until `CFG.AI_VILLAGERS` (e.g. 22).
  - **Check:** after 10 simulated minutes, red has 0 idle villagers ≥ 90 % of samples and
    wood > 0 gathered. **Size:** M. **Needs:** A2.

- [ ] **A4 — Red builds houses** (with A3 this closes TODO 20's first half)
  - **Change:** if `popCommitted + 2 >= popCap` and no red house is unfinished, `findSite`
    near the TC and `build('house', …, 1, [nearest wood villager])`.
  - **Check:** idle-player run: red pop > 5 by minute 6. **Size:** S. **Needs:** A3.

- [ ] **A5 — Drop sites and farms**
  - **Change:** lumber camp at the nearest forest edge once ≥ 4 villagers chop farther than
    8 tiles from a drop-off; mining camp likewise for gold; mill + farms when no berry tile is
    left within 12 tiles of the TC (farm count = food villagers − tile-gatherers).
  - **Check:** idle-player run, minute 12: red owns a lumber camp and ≥ 2 farms. **Size:** M.

- [ ] **A6 — Military production**
  - **Change:** a Barracks once red has 12 villagers; Archery Range after Feudal; train a
    mix from `CFG.AI_ARMY = {militia: .6, archer: .4}`; new units gather at a rally tile
    between the TC and the map centre.
  - **Check:** minute 15: ≥ 5 red fighters, both kinds after Feudal. **Size:** M.

- [ ] **A7 — Age up and research**
  - **Change:** Feudal when food ≥ 500 and ≥ 15 villagers; Blacksmith after Feudal and
    research in a fixed order (Forge → Fletching → Scale Mail → Bracer) when affordable and
    not starving villager production.
  - **Check:** idle-player run reaches Feudal before minute 12 on 8/10 seeds. **Size:** S.

- [ ] **A8 — Attacks that make sense**
  - **Change:** a wave launches when the army ≥ `waveSize` (starts 5, +2 each wave); targets in
    order: blue fighters near the path → villagers → the nearest blue building → the TC. The
    wave retreats to the rally tile when it falls below 30 % of its starting size. This is
    when an idle player starts losing (closes TODO 20).
  - **Check:** idle-player arena: red wins every seed before minute 20. The TODO 20 check in
    `12-ai.js` (15-minute idle run: ≥ 1 house, wood > 0, ≥ 5 fighters) goes in here.
  - **Size:** M. **Needs:** A3–A6.

- [ ] **A9 — Defending home**
  - **Change:** blue fighters within 10 tiles of a red building → pull the army home; if red
    fighters < blue attackers, ring the town bell (garrison villagers into the TC with
    `garrisonUnits`) and release them when clear.
  - **Check:** fixture: 6 blue militia at the red TC → red villagers inside within 5 s, out
    again after the militia die. **Size:** M.

- [ ] **A10 — Difficulty**
  - **Change:** `CFG.AI_LEVELS = { easy: {...}, normal: {...}, hard: {...} }` scaling
    `AI_TICK`, villager target and first wave size — **never** gather rates or free
    resources. A header `<select>`; `Game.aiLevel` saved; `?ai=hard` URL parameter read in
    `boot`. **Size:** S.

---

## 6. Phase 3 — quality of life (new features)

- [ ] **Q1 — Idle villagers** — header cell `idle n` (`#r_idle` in `index.html`, filled in
  `renderHud`), `.` key (a `HOTKEYS` row) selects the next idle blue villager and centres the
  camera on him (`setCam`). Check in `09-hud.js` + `08-input.js`. **Size:** S.
- [ ] **Q2 — Pause and game speed** — `P` toggles `Game.paused` (stepGame skips `stepSim`,
  rendering continues, an overlay says `Paused`); `+`/`-` cycle `Game.speed` ∈ {0.5, 1, 1.5, 2}
  by scaling the accumulated dt. Both saved. **Size:** S. **Needs:** G6.
- [ ] **Q3 — Under-attack alert** — when a blue unit or building takes damage and the last
  alert is > 10 s old: toast `You are under attack`, a new `alarm` row in `SFX`, a minimap
  ping (`Game.pingAt` already exists), and `Space` jumps the camera to the last alert.
  **Size:** S.
- [ ] **Q4 — Rally points** — right-click with a finished training building selected sets
  `b.rally = {x, y}` (a flag drawn in `drawBuildings`); trained units walk there, or gather if
  the rally is a resource tile. `encodeBuilding` copies keys — verify it, no version bump if
  so. **Size:** M.
- [ ] **Q5 — Shift-queued orders** — `u.queue` of orders; shift+right-click appends instead
  of replacing; `updateUnit` pops the next one when an order goes idle; shown as faint lines
  from `orderTarget`. **Size:** M.
- [ ] **Q6 — Hotkey sheet** — `?` / `F1` toggles an overlay generated from `HOTKEYS`; build
  buttons show their key (`House (H)`). **Size:** S. **Needs:** G5.
- [ ] **Q7 — Double-click selects all of a kind on screen** (Ctrl+click in AoE2 terms).
  **Size:** S.
- [ ] **Q8 — Unit stances** — aggressive / defensive / stand ground on `u.stance`, read by
  `autoAcquire` and the chase logic; three command-grid buttons. **Size:** M.
- [ ] **Q9 — Attack-move** — an `Attack move` command button then a click: the group moves
  and `autoAcquire`s on the way (WASD stays camera, so no `A` hotkey). **Size:** M.

---

## 7. Phase 4–6 — content, systems, presentation (new features)

**Content** (*needs vendoring* = the rows must come from `data.json` first; see §2 hard stops)

- [ ] **C1 — Economy techs** *(needs vendoring)*: Loom, Wheelbarrow, Double-Bit Axe, Horse
  Collar, Gold Mining. Generalise `TECHS` from `atk/armor` to a list of
  `{ stat, op: 'add'|'mul', value, affects }` effects read by one `statOf(Game, u, stat)`
  helper (carry, gather rate, speed, hp, armour, field food). Split: C1a the effect engine
  with the existing four techs ported (no behaviour change, checks prove it), C1b each tech.
- [ ] **C2 — Town Bell** — a TC button garrisons every blue villager in the nearest building
  with room (`garrisonUnits`), remembering `u.prevOrder`; `All clear` restores it. **Size:** S.
- [ ] **C3 — Garrison fire** — a finished TC/tower fires one extra arrow per garrisoned
  villager/archer (cap = capacity) through `stepBuildingAttacks`. **Size:** S.
- [ ] **C4 — Unit upgrade lines** *(needs vendoring)*: Militia → Man-at-Arms (Feudal),
  Archer → Crossbowman (Castle), same shape as the tower `upgradesTo` chain but per team and
  applied to every living unit of the line. **Size:** M.
- [ ] **C5 — Range techs** — `unitRange(Game, u)` replaces raw `KINDS[k].range`; Fletching
  (and Bracer, if §8 decides to port its real effect) add +1. **Size:** S. **Needs:** TODO 24.
- [ ] **C6 — Spearman, Scout Cavalry, Stable, attack bonuses** *(needs vendoring)*: armour
  classes and bonus damage in the stat tables (`attacks`/`armours` class lists, as in the
  source data), `hitUnit` applies the bonus. Units without art need a `noSprite` unit fallback
  in `drawUnits` (team disc + letter) — check the renderer first. **Size:** L → split.
- [ ] **C7 — Hunting** — sheep near each TC (convert on sight, 100 food carcass), a boar
  that fights back. New `Game.animals` or units of team `-1`; every `team` loop must tolerate
  it. **Size:** L → design card first.
- [ ] **C8 — Stone wall, gate, drag-to-build** — drag paints a line of segments
  (Bresenham over tiles, one site each); a gate is walkable for its own team only, which
  needs `walkable(Game, px, py, team)` and the A\* cache keyed by team. **Size:** L → split
  (C8a wall row + drag, C8b gate + team walkability).

**Systems**

- [ ] **S1 — Fog of war** (ROADMAP 14), split: S1a `world.explored`/`visible` Uint8Arrays
  recomputed every 0.25 s from `lineOfSight`; S1b `drawWorld`/`drawUnits`/`drawBuildings` dim
  explored and hide unseen; S1c minimap; S1d save (explored only, visible is recomputed);
  S1e the AI may only target what it has seen (optional "fair" flag).
- [ ] **S2 — Replays** — every player command records `{step, fn, args}` into `Game.log`;
  `replay(seed, log)` re-runs it headless and in the page (read-only, speed controls). Export
  as a file and as a `#replay=` URL fragment (compressed JSON → base64).
  **Needs:** G6, G8.
- [ ] **S3 — Seeds you can share** — `?seed=` in the URL, a `Copy map link` button, the seed
  shown in the footer. **Needs:** TODO 22. **Size:** S.
- [ ] **S4 — Save slots** — three named slots + autosave, a small load menu; `migrate` moves
  the old single `SAVE_PATH` into slot 1. **Size:** M.
- [ ] **S5 — End-of-game report** — per-team counters (gathered per resource, trained,
  lost, killed, buildings) sampled every 10 s; the result overlay shows a table and a small
  line chart drawn on a canvas. **Size:** M.
- [ ] **S6 — Map types** — `MAP_TYPES` table (open / forest lanes / lakes) of `makeWorld`
  parameters; chosen on `New map`, stored with the seed. **Size:** M.
- [ ] **S7 — Survival mode** — endless escalating AI waves (A8's wave logic, no red economy),
  score = waves survived; best score in `localStorage`. **Size:** S. **Needs:** A8.
- [ ] **S8 — Zoom** — mouse wheel / pinch between 0.75×, 1×, 1.5× by scaling the context in
  `renderFrame` and the inverse in `toWorld`; every pixel constant that assumes `CFG.TILE`
  must be found first. **Size:** L.

**Presentation** (*needs vendoring* — all of these add frames to `data/sprites/` and go
through `tools/gen-atlas.js`; check `preview.png` by eye before committing)

- [ ] **P1** death animation from the rip's `Die` frames · **P2** 8-direction walk frames ·
  **P3** resource objects (tree, ore, bush) in the atlas · **P4** art for the six `noSprite`
  buildings · **P5** a colour-blind team palette option (header toggle, saved preference).

**Process** *(human)*

- [ ] Gate the deploy on CI: switch Pages to deploy from an Actions workflow that `needs:`
  the `check` job (ROADMAP process item), and add `browser-smoke` to CI against the
  working copy.
- [ ] Once G1 exists, make CI call `npm run verify` so local and CI cannot drift.

---

## 8. Decisions for the human (do not let the model guess these)

1. ~~Branch~~ — decided 2026-11-14: everything on `main`, push after each green card.
2. Keep the invented `+25 % attack per age` scaling, or drop it for AoE2's rules (ages only
   unlock things)? Dropping it changes combat balance and several checks.
3. Bracer: keep the armour version or port the real effect (+1 range, +1 pierce attack for
   archers, TC, towers)? (C5)
4. AI fairness: may the AI see through fog once S1 exists?
5. How far past Castle Age, if ever? (C4/C6 assume Castle stays the cap.)
6. ~~Network~~ — decided 2026-11-14: the box has internet; it vendors rows itself.

---

## 9. Order of work

```
G0 → G1 → G2 → G3 → G4 → G5
→ TODO 23 → TODO 22 → TODO 26
→ G6 → G8 → G7
→ A1 → A2 → A3 → A4 → A5 → A6 → A7 → A8   (red can now win)
→ Q1 → Q3 → Q2 → Q6
→ A9 → A10
→ TODO 24 → C5 → TODO 25
→ Q4 → C2 → C3 → S3 → S5
→ S1a–e → S2 → S4 → S7 → Q5 → Q7 → Q8 → Q9
→ vendoring cards (C1, C4, C6, P1–P4) as data arrives
→ C7, C8, S6, S8 (each needs its own short design card first)
```

Why this order: G1–G5 make every later session cheaper and safer; the two bug fixes are
tiny and user-visible; G6/G8 must precede anything that touches the sim clock; the AI is the
largest gap between "prototype" and "game", and G7 gives it a number to optimise; QoL comes
before content because a player who cannot find idle villagers will not notice a new unit.

---

## 10. Session prompt (paste this, replace the card id)

```
You are working in the aoe2-mini repo. Read AGENTS.md, then §2 and card <ID> of
docs/plans/2026-11-14-strix-local-roadmap.md. Do only that card.
1. Confirm `git status` is clean and `npm run verify --prefix tools` ends in VERIFY OK.
2. Read only the functions the card names (grep -n, then sed -n ranges).
3. Write the check first; run that check file alone; it must fail for the right reason.
4. Make the smallest patch that passes it. Never rewrite whole files.
5. Run `npm run verify --prefix tools` until VERIFY OK (audit ref drift:
   `node tools/audit-line-refs.js --fix`).
6. Update GAME_RULES/TODO/CHANGELOG (≤12 lines) and tick the card's box in the plan.
7. Commit with an imperative one-line subject, then `git push origin main`.
If the same verify error repeats three times, revert, write docs/plans/BLOCKED.md, stop.
Never invent stat numbers, never weaken a check, never edit generated blocks.
```
