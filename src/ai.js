'use strict';
/* ai -- the enemy village: trains, gathers and attacks through the same commands. No DOM.

   Roadmap A2 (docs/plans/2026-11-14-strix-local-roadmap.md §5, closes docs/TODO.md P1-21):
   `aiStep` is a dispatcher over two clocks and two small decisions. Game.ai[1] is the red
   brain's own state — a tick clock, saved by src/save.js — and Game.wave is the attack-wave
   clock docs/GAME_RULES.md describes. The brain decides once per CFG.AI_TICK, and the village
   is trained through `train`, the player's own command, whose `trains` check the old
   `queueTrain` skipped: a Town Center makes villagers and nothing else, so the militia red
   used to forge at its Town Center wait for a Barracks (A6). The helpers below stay small;
   A3+ grow them, and src/ai-eco.js appears when this file passes ~250 lines. */

function aiStep(Game, dt) {
  if (!Game.started) return;                   // the village sleeps until the game begins
  const tick = aiTickDue(Game);                // the brain's own clock, Game.ai[1] (A2)
  const wave = aiWaveClock(Game, dt);          // the CFG.WAVE_EVERY attack clock, kept apart from it
  if (!tick && !wave) return;                  // so a step is a tick, a wave, or nothing at all
  const tc = aiTownCenter(Game);
  if (!tc) return;                             // no finished keep to order from (docs/TODO.md P1-9)
  if (popUsed(Game, 1) >= popCap(Game, 1)) aiAttackWave(Game);
  else aiTrain(Game, tc);
}

/** The attack-wave clock (docs/GAME_RULES.md): Game.wave counts every second of a started
 *  game and resets on CFG.WAVE_EVERY. A2 keeps it deliberately apart from the brain tick —
 *  a wave is not a decision and a decision is not a wave — and it stays the authoritative
 *  copy the rules and the checks read. Returns true on the step that fires a wave. */
function aiWaveClock(Game, dt) {
  Game.wave += dt;
  if (Game.wave < CFG.WAVE_EVERY) return false;
  Game.wave = 0;
  return true;
}

/** The brain's own clock, the field A2 adds to Game.ai[1] and save.js stores: at most one
 *  decision per CFG.AI_TICK, recording the boundary it acted on rather than Game.time, so
 *  the rhythm cannot drift with the frame rate and a loaded game resumes where it stopped.
 *  lastTick -1 means "never", so the first decision lands on the first CFG.AI_TICK
 *  boundary. The tolerance is the fixed step's own binary rounding — 30 × CFG.SIM_DT sums
 *  to 0.9999999999999999 — and a whole second of game time in which the enemy did nothing
 *  would be the worse bug. */
function aiTickDue(Game) {
  const brain = Game.ai[1];                    // team 1's slot; team 0 has no brain until A10
  const next = brain.lastTick < 0 ? CFG.AI_TICK : brain.lastTick + CFG.AI_TICK;
  if (Game.time + 1e-9 < next) return false;
  brain.lastTick = next;
  return true;
}

/** The building the brain orders from: a finished red Town Center. The old code asked for
 *  any finished red building, which the seeded roster always resolved to the Town Center;
 *  naming the kind is what lets `train` be the law here, and card A6 is the single place
 *  this search widens. */
function aiTownCenter(Game) {
  return Game.buildings.find((b) => b.team === 1 && b.kind === 'town_center' && b.built >= 1) || null;
}

/** The decision a wave carries: every militia holding no live order is sent at the closest
 *  blue unit and the village announces it — through `toast` with team 1, so the message
 *  lands in Game.aiLog instead of over the player's toast line (A1's rule, which is what
 *  made this line's default wrong). A unit with a live order is left alone, and nothing is
 *  announced when nobody moved. */
function aiAttackWave(Game) {
  const prey = nearestEnemy(Game, 1);
  let sent = 0;
  for (const u of Game.units) {
    if (u.team !== 1 || u.kind !== 'militia' || u.dead) continue;
    const o = u.order;
    const live = o.kind === 'attack' && (o.b !== undefined
      ? Game.buildings.some((z) => z.id === o.b && attackableAsEnemy(z, 1))
      : Game.units.some((z) => z.id === o.target && !z.dead));
    if (live) continue;
    if (!prey) continue;
    u.order = { kind: 'attack', target: prey.id };
    sent++;
  }
  if (sent) toast(Game, 'Red attack wave!', 1);
}

/** The training decision, asked through `train` — the door A2 deletes `queueTrain` for
 *  (docs/TODO.md P1-21: that helper spent red gold and food and pushed onto the queue
 *  itself, so red fielded militia no row ever promised the player). Asking the command
 *  means asking what the building's row allows: a Town Center makes villagers, and until
 *  card A6 puts a Barracks up there is no fighter here to ask for. The queue is never
 *  double-filled, and an ask the stockpile cannot pay is refused by `train` — into
 *  Game.aiLog, where an enemy complaint belongs — instead of being half-paid here. */
function aiTrain(Game, tc) {
  if (tc.queue.length) return;
  if ((BLD[tc.kind].trains || []).indexOf('villager') < 0) return;
  if (!canAfford(Game, 1, KINDS.villager.cost)) return;
  train(Game, tc, 'villager');
}

function nearestEnemy(Game, team) {
  let best = null, bd = Infinity;
  for (const u of Game.units) {
    if (!targetableAsEnemy(u, team)) continue;
    const home = Game.buildings.find(b => b.team === team && b.built >= 1);
    if (!home) return u;
    const d = (u.x - home.x) ** 2 + (u.y - home.y) ** 2;
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}
