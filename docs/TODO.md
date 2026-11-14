# TODO — known bugs, in the order to fix them

Written 2026-11-13 from a review of the code plus reproductions in Chromium and in node.
Every item marked **verified** was reproduced; the evidence line says how. Items marked
**unverified** are read from the code only — reproduce before fixing.

How to work through this list:

- One item per commit. Read `AGENTS.md` first.
- Write the failing check first, in the matching `tools/checks/NN-topic.js`, then fix the
  code until `node tools/headless-check.js -q` is green again. The "Done when" line of each
  item says what the check must prove.
- The whole suite is green today, which means **none of these bugs has a check yet** — a
  green run does not mean an item is fixed.
- Delete an item from this file in the commit that fixes it, and add a line to
  `docs/CHANGELOG.md`.

Functions are named instead of line numbers so this file does not go stale as code moves.

---

## P0 — the game cannot be played with the mouse

---

## P1 — wrong behaviour you notice within a minute

### 20. The enemy AI goes inert after about four minutes

**Verified** (2026-11-14) by a 30-minute headless run with an idle player: red trains one
villager to reach 5/5 population, never builds a house, never re-tasks a villager once the
berries run out (food parks at 950, wood/gold/stone never move), never ages up, and every
45 s fires an "attack wave" of zero militia. Its starting militia walks alone into the blue
Town Center's arrows within the first two minutes. The game cannot be lost.

- **Cause:** `aiStep` (`src/ai.js`) only knows "train villager / train militia / send idle
  militia when pop is full"; it has no build, gather, house or age logic, and `build` /
  `upgradeAge` (`src/commands.js`) are hard-wired to team 0, so it could not call them.
- **Fix:** `docs/plans/2026-11-14-strix-local-roadmap.md` phase 2 (team-parametric commands
  first, then the AI in small steps, each measured by `tools/ai-arena.js`).
- **Done when:** a check in `tools/checks/12-ai.js` runs 15 simulated minutes with an idle
  player and asserts red built at least one house, gathered wood and fielded ≥ 5 fighters.

### 21. The AI trains militia at its Town Center

**Verified** by reading: `queueTrain` (`src/ai.js`) spends and pushes onto the Town Center
queue directly, skipping `train`, whose `BLD[...].trains` check would refuse it — the Town
Center row trains only `villager`. Red therefore gets militia without a Barracks.

- **Fix:** delete `queueTrain`; the AI calls `train(Game, bld, kind)` like the player (after
  `toast` is made team-aware, see item 23). Red must own a finished Barracks to get militia.
- **Done when:** `12-ai.js` asserts a red village with no Barracks never queues `militia`.

---

## P2 — smaller defects

### 24. Blacksmith techs reach the wrong units

**Verified** in node: after `forge` + `scale_mail` a villager's `unitAttack` goes 3 → 4 and
its melee `unitArmor` 0 → 1, while the Town Center's arrow stays at 5 after `fletching`.
In AoE2, Forge is infantry/cavalry, Scale Mail infantry, Fletching archers + TC + towers;
villagers get none of them.

- **Cause:** `unitAttack` / `unitArmor` (`src/sim.js`) add every researched tech to every
  unit and none to buildings.
- **Fix:** an authored `affects` list per tech in `data/techs.json` (unit kinds and/or
  building kinds, listed in `source.authored`), generated into `TECHS` by
  `tools/check-stats.mjs --write`; both functions filter on it.
- **Done when:** `06-training-research-trade.js` asserts a villager is unchanged by Forge,
  a militia gains +1, and a Town Center arrow gains Fletching's +1.

### 25. A big order stalls one frame for ~45 ms

**Verified** in node: 150 blue units ordered onto the red Town Center next to 100 red
militia — average step 1 ms, worst step 46.5 ms (389 `findPath` calls, most in the first
frames). At 60 fps that is a visible hitch.

- **Fix:** a per-step path budget (`CFG.PATHS_PER_STEP`, e.g. 12) in `src/movement.js`:
  units over budget keep walking straight toward the goal and get a route on a later step.
- **Done when:** `04-pathfinding.js` asserts no single `stepSim` issues more than the budget
  and that every unit of a 150-unit order still arrives.

### 26. ROADMAP says the barricade hotkey is `w`

**Verified:** the code uses `q` (`w` pans the camera); `docs/GAME_RULES.md` already says `Q`.
Fix the sentence in `docs/ROADMAP.md` item 6.

