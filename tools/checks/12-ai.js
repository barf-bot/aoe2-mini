'use strict';
/* checks/12-ai.js -- the enemy village: it waits for the game to start, attacks when its population is full, trains when it is not.
   Runs on its own (`node tools/checks/12-ai.js`) against a freshly booted game. */

const {
  AoE2, DT, check, report, freeSpotAround, tOf,
} = require('../lib/harness');

/* ---- 15. enemy AI ----------------------------------------------------- */
/* aiStep acts once per CFG.WAVE_EVERY seconds of a started game. Every fixture is
   its own createState() stepped through stepSim, so the AI is driven by the same
   clock the browser drives it with and nothing else is in play. */
const red = (g) => g.units.filter((u) => u.team === 1 && !u.dead);
const redTc = (g) => g.buildings.find((b) => b.team === 1 && b.kind === 'town_center');
const oneWave = (g) => { for (let i = 0; i < Math.ceil(AoE2.CFG.WAVE_EVERY / DT) + 1; i++) AoE2.stepSim(g, DT); };
/** A state whose red villagers stand idle, so the only thing that can move red's stockpile
 *  is the AI. `keep` leaves that many villagers standing and marks the rest dead the way
 *  hitUnit does: popUsed counts every living unit (docs/TODO.md P1-10), so a red village
 *  below its cap is one with fewer than five units, not one with five villagers minus one. */
const village = (started, keep) => {
  const g = AoE2.createState();
  g.started = started;
  const vill = g.units.filter((u) => u.team === 1 && u.kind === 'villager');
  for (const u of (keep === undefined ? [] : vill.slice(keep))) u.dead = true;
  for (const u of g.units) if (!u.dead) u.order = { kind: 'idle' };
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
// P1-10: popUsed counts every living unit, so the seeded roster (four villagers and a
// militia) already fills the cap of 5; the loop closes whatever gap that leaves.
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

// 3. below the cap with a small village - two villagers and a militia, three of five - so
//    the militia counting toward the cap (P1-10) does not stop it wanting a villager
const grow = village(true, 2);
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

/* 5. docs/TODO.md P1-9, the red side of the same rule: a Town Center at 50 % is a
   foundation, not a keep — it caps nobody (popCap 0), so aiStep has no building to
   train from and the village neither queues nor pays. */
const site = (() => {
  const g = village(true);
  g.res[1] = { food: 9000, wood: 9000, gold: 9000, stone: 9000 };
  const tc = redTc(g);
  if (!tc) return null;
  tc.built = 0.5;                                     // the keep is still going up
  const cap = AoE2.popCap(g, 1), res = JSON.stringify(g.res[1]);
  oneWave(g);
  return { cap, res, now: JSON.stringify(g.res[1]), queue: redTc(g).queue.length };
})();
check(!!site && site.cap === 0 && site.queue === 0 && site.now === site.res,
  'ai: a half-built enemy Town Center counts for nothing and trains nobody',
  !site ? 'no red Town Center'
    : 'cap=' + site.cap + ' queue=' + site.queue + ' res ' + site.res + ' -> ' + site.now);

/* ---- 16. roadmap A1: the commands take a team -------------------------- */
/* A1 (docs/plans/2026-11-14-strix-local-roadmap.md §5, finding R4): `build`,
   `upgradeAge` and `toast` take a team. team 0 — the player — keeps today's behaviour
   exactly: the selection picks the crew, the placement ghost clears, `Game.toastMsg`
   carries the message and the `age` chime plays. Any other team answers through
   `Game.aiLog` (the last 50 `{t, msg}` entries, never saved), and an explicit `crew` of
   villager ids replaces the selection lookup so the AI can order its own villagers
   without writing on the player's screen. `village(true)` is the fixture used above: a
   started state whose red villagers all stand idle. */
const a1Spot = (g, team) => {                 // a legal 2x2 house pad beside one of them
  const v = g.units.find((u) => u.team === team && u.kind === 'villager' && !u.dead);
  const s = freeSpotAround(g.world, g, tOf(v.x), tOf(v.y), 2, 2, 8);
  return { v, x: s.tx * AoE2.CFG.TILE + 4, y: s.ty * AoE2.CFG.TILE + 4 };
};
const a1Peek = (g) => {                                    // "n [first .. last]" of aiLog
  const l = (g.aiLog || []).map((e) => e.t + ':' + e.msg);
  return l.length + ' [' + (l[0] || '-') + ' .. ' + (l[l.length - 1] || '-') + ']';
};

// 6. a red build handed an explicit crew puts up a RED site, spends red wood, logs the
//    message, and leaves the player's toast line and placement ghost exactly as they were
const r6 = village(true);
const r6v = a1Spot(r6, 1);
const r6Wood = r6.res[1].wood;
const r6Toast = r6.toastMsg;
r6.placing = 'farm';
const r6House = AoE2.build(r6, 'house', r6v.x, r6v.y, 1, [r6v.v.id]);
check(!!r6House && r6House.team === 1 && r6v.v.order.kind === 'build' && r6v.v.order.b === r6House.id &&
      Math.floor(r6.res[1].wood) === Math.floor(r6Wood - AoE2.BLD.house.cost.wood) &&
      r6.placing === 'farm' && r6.toastMsg === r6Toast &&
      (r6.aiLog || []).length === 1 && r6.aiLog[0].msg === AoE2.BLD.house.label + ' started' &&
      r6.aiLog[0].t === r6.time,
  'a1: red build with an explicit crew places a red site and spends red wood',
  (r6House ? 'team=' + r6House.team + ' order=' + r6v.v.order.kind : 'no site built') +
  ' wood ' + r6Wood + '->' + r6.res[1].wood + ' placing=' + JSON.stringify(r6.placing) +
  ' toast=' + JSON.stringify(r6.toastMsg) + ' log=' + a1Peek(r6));

// 7. the same call with a crew of blue ids is refused before anything is spent, and the
//    refusal is what lands in the AI log instead of the player's toast line
const r7 = village(true);
const r7Blue = r7.units.find((u) => u.team === 0 && u.kind === 'villager' && !u.dead);
const r7Built = r7.buildings.length;
const r7Wood = r7.res[1].wood;
const r7Toast = r7.toastMsg;
const r7Out = AoE2.build(r7, 'house', tOf(r7Blue.x) * AoE2.CFG.TILE + 4, tOf(r7Blue.y) * AoE2.CFG.TILE + 4,
  1, [r7Blue.id]);
check(r7Out === undefined && r7.buildings.length === r7Built && r7.res[1].wood === r7Wood &&
      r7.toastMsg === r7Toast && (r7.aiLog || []).length === 1 &&
      r7.aiLog[0].msg === 'No villager in the crew',
  'a1: a crew of blue ids cannot build for team 1 and the refusal is logged',
  'built=' + r7Built + '->' + r7.buildings.length + ' wood ' + r7Wood + '->' + r7.res[1].wood +
  ' toast=' + JSON.stringify(r7.toastMsg) + ' log=' + a1Peek(r7));

// 8. no team argument still means the player: the crew comes from Game.selection, the
//    ghost clears and the message is the player's toast line — the 05-construction
//    contract, asserted here too so a team refactor cannot quietly move it
const r8 = village(true);
const r8v = a1Spot(r8, 0);
const r8Wood = r8.res[0].wood;
r8.selection = [r8v.v.id];
r8.placing = 'house';
const r8House = AoE2.build(r8, 'house', r8v.x, r8v.y);
check(!!r8House && r8House.team === 0 && r8v.v.order.kind === 'build' && r8v.v.order.b === r8House.id &&
      Math.floor(r8.res[0].wood) === Math.floor(r8Wood - AoE2.BLD.house.cost.wood) &&
      r8.placing === null && r8.toastMsg === AoE2.BLD.house.label + ' started' &&
      (r8.aiLog || []).length === 0,
  'a1: build with no team argument still builds for team 0 from the selection',
  (r8House ? 'team=' + r8House.team + ' order=' + r8v.v.order.kind : 'no site built') +
  ' wood ' + r8Wood + '->' + r8.res[0].wood + ' placing=' + JSON.stringify(r8.placing) +
  ' toast=' + JSON.stringify(r8.toastMsg) + ' log=' + a1Peek(r8));

// 9. upgradeAge(team) runs its ladder and its spend against that team, and the player's
//    toast line does not move: red's feedback is the log
const r9 = village(true);
r9.res[1] = { food: 0, wood: 9000, gold: 9000, stone: 9000 };
const r9Toast = r9.toastMsg;
AoE2.upgradeAge(r9, 1);
check(r9.age[1] === 0 && r9.ageBonus[1] === 0 && r9.toastMsg === r9Toast &&
      (r9.aiLog || []).length === 1 && r9.aiLog[0].msg === 'Need ' + AoE2.CFG.AGE_FOOD + ' food',
  'a1: red upgradeAge without food logs "Need 500 food" and leaves age[1] at 0',
  'age=' + r9.age[1] + ' bonus=' + r9.ageBonus[1] + ' toast=' + JSON.stringify(r9.toastMsg) +
  ' log=' + a1Peek(r9));
const r9Food = AoE2.CFG.AGE_FOOD;
r9.res[1] = { food: r9Food, wood: 9000, gold: 9000, stone: 9000 };
AoE2.upgradeAge(r9, 1);
check(r9.age[1] === 1 && r9.ageBonus[1] === 1 && r9.res[1].food === 0 && r9.toastMsg === r9Toast &&
      (r9.aiLog || []).length === 2 && r9.aiLog[1].msg === AoE2.AGES[1] + ' reached',
  'a1: red upgradeAge with food spends red food and advances age[1] and ageBonus[1]',
  'age=' + r9.age[1] + ' bonus=' + r9.ageBonus[1] + ' food=' + r9.res[1].food +
  ' toast=' + JSON.stringify(r9.toastMsg) + ' log=' + a1Peek(r9));

// 10. toast(g, msg) is the player's line; toast(g, msg, 1) is the enemy log
const r10 = village(true);
AoE2.toast(r10, 'x');
check(r10.toastMsg === 'x' && r10.toastAt === r10.time && (r10.aiLog || []).length === 0,
  'a1: toast(g, "x") still sets Game.toastMsg',
  'toast=' + JSON.stringify(r10.toastMsg) + ' at=' + r10.toastAt + '/' + r10.time +
  ' log=' + a1Peek(r10));
const r10Player = r10.toastMsg;
AoE2.toast(r10, 'y', 1);
check(r10.toastMsg === r10Player && r10.aiLog.length === 1 && r10.aiLog[0].msg === 'y' &&
      r10.aiLog[0].t === r10.time,
  'a1: toast(g, "y", 1) leaves Game.toastMsg and appends to Game.aiLog',
  'toast=' + JSON.stringify(r10.toastMsg) + ' log=' + a1Peek(r10));

// 11. the log is a ring of 50: 60 messages leave 50 entries, the oldest ten gone
const r11 = village(true);
for (let i = 0; i < 60; i++) AoE2.toast(r11, 'm' + i, 1);
check((r11.aiLog || []).length === 50 && r11.aiLog[0].msg === 'm10' && r11.aiLog[49].msg === 'm59' &&
      r11.toastMsg === '',
  'a1: aiLog caps at 50 entries and drops the oldest',
  'log=' + a1Peek(r11) + ' toast=' + JSON.stringify(r11.toastMsg));

report();
