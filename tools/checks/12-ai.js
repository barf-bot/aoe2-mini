'use strict';
/* checks/12-ai.js -- the enemy village: it waits for the game to start, attacks when its population is full, trains when it is not.
   Runs on its own (`node tools/checks/12-ai.js`) against a freshly booted game. */

const {
  AoE2, DT, check, report,
} = require('../lib/harness');

/* ---- 15. enemy AI ----------------------------------------------------- */
/* aiStep acts once per CFG.WAVE_EVERY seconds of a started game. Every fixture is
   its own createState() stepped through stepSim, so the AI is driven by the same
   clock the browser drives it with and nothing else is in play. */
const red = (g) => g.units.filter((u) => u.team === 1 && !u.dead);
const redTc = (g) => g.buildings.find((b) => b.team === 1 && b.kind === 'town_center');
const oneWave = (g) => { for (let i = 0; i < Math.ceil(AoE2.CFG.WAVE_EVERY / DT) + 1; i++) AoE2.stepSim(g, DT); };
/** A state whose red villagers stand idle, so the only thing that can move red's stockpile is the AI. */
const village = (started) => {
  const g = AoE2.createState();
  g.started = started;
  for (const u of red(g)) u.order = { kind: 'idle' };
  return g;
};
const orders = (g) => red(g).filter((u) => u.kind === 'militia').map((u) => u.order.kind + ':' + u.order.target).join(',');

// 1. before the player has done anything the AI must not act at all
const idle = village(false);
const idleRes = JSON.stringify(idle.res[1]);
oneWave(idle);
check(idle.started === false && idle.wave === 0 && redTc(idle).queue.length === 0 &&
      JSON.stringify(idle.res[1]) === idleRes && !red(idle).some((u) => u.order.kind === 'attack'),
  'ai: an unstarted game leaves the enemy village asleep',
  'started=' + idle.started + ' wave=' + idle.wave + ' queue=' + redTc(idle).queue.length + ' militia=' + orders(idle));

// 2. population full (the seeded village sits at its cap): the wave sends every
//    idle militia at the blue unit closest to the red Town Center
const full = village(true);
const fullTc = redTc(full);
// popUsed counts villagers only, so the cap is reached by villagers
for (let n = AoE2.popCap(full, 1) - AoE2.popUsed(full, 1); n > 0; n--) AoE2.makeUnit(full, 'villager', 1, fullTc.x, fullTc.y + 60);
const cap = AoE2.popCap(full, 1), used = AoE2.popUsed(full, 1);
const home = redTc(full);
const prey = full.units.filter((u) => u.team === 0)
  .sort((a, b) => ((a.x - home.x) ** 2 + (a.y - home.y) ** 2) - ((b.x - home.x) ** 2 + (b.y - home.y) ** 2))[0];
oneWave(full);
const sentAt = red(full).filter((u) => u.kind === 'militia');
check(used >= cap && sentAt.length > 0 && sentAt.every((u) => u.order.kind === 'attack' && u.order.target === prey.id) &&
      redTc(full).queue.length === 0 && full.toastMsg === 'Red attack wave!',
  'ai: at the population cap the wave sends its militia at the nearest blue unit',
  'pop ' + used + '/' + cap + ' prey=' + prey.id + ' militia=' + orders(full) + ' toast=' + JSON.stringify(full.toastMsg));

// 3. below the cap with a small village: it queues a villager and pays for it
const grow = village(true);
const before = AoE2.popUsed(grow, 1), food0 = grow.res[1].food;
oneWave(grow);
const q = redTc(grow).queue;
check(before < AoE2.popCap(grow, 1) && q.length === 1 && q[0].kind === 'villager' &&
      grow.res[1].food === food0 - AoE2.KINDS.villager.cost.food,
  'ai: below the cap it queues a villager and pays the table cost',
  'pop ' + before + '/' + AoE2.popCap(grow, 1) + ' queue=' + q.map((x) => x.kind).join(',') + ' food ' + food0 + ' -> ' + grow.res[1].food);

// 4. ...and the queued villager walks out of the Town Center when its timer ends
const redBefore = red(grow).length;
for (let i = 0; i < Math.ceil(AoE2.KINDS.villager.time / DT) + 2; i++) AoE2.stepSim(grow, DT);
check(red(grow).length === redBefore + 1,
  'ai: the queued villager spawns after the table train time',
  redBefore + ' -> ' + red(grow).length + ' red units');

report();
