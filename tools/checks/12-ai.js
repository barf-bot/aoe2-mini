'use strict';
/* checks/12-ai.js -- the enemy village: it waits for the game to start, attacks when its population is full, trains when it is not.
   Runs on its own (`node tools/checks/12-ai.js`) against a freshly booted game. */

const {
  AoE2, DT, check, report, freeSpotAround, setTile, solidTile, tOf, tileCentre,
} = require('../lib/harness');

/* ---- 15. enemy AI ----------------------------------------------------- */
/* aiStep makes at most one decision per CFG.AI_TICK second of a started game (roadmap A2),
   and the CFG.WAVE_EVERY attack clock lives in Game.wave, apart from the brain's own tick.
   Every fixture is its own createState() stepped through stepSim, so the AI is driven by
   the same clock the browser drives it with and nothing else is in play. */
const red = (g) => g.units.filter((u) => u.team === 1 && !u.dead);
const redTc = (g) => g.buildings.find((b) => b.team === 1 && b.kind === 'town_center');
const oneWave = (g) => { for (let i = 0; i < Math.ceil(AoE2.CFG.WAVE_EVERY / DT) + 1; i++) AoE2.stepSim(g, DT); };
const oneSecond = (g) => { for (let i = 0; i < 30; i++) AoE2.stepSim(g, DT); };   // exactly 1 s: one CFG.AI_TICK
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
//    idle militia at the blue unit closest to the red Town Center. A4 shares that second —
//    its own `House started` line is in the log as well — so the wave's entry is found by
//    content and time, which is the rule, not by the log's length.
const full = village(true);
const fullTc = redTc(full);
// P1-10: popUsed counts every living unit, so the seeded roster (four villagers and a
// militia) already fills the cap of 5; the loop closes whatever gap that leaves.
for (let n = AoE2.popCap(full, 1) - AoE2.popUsed(full, 1); n > 0; n--) AoE2.makeUnit(full, 'villager', 1, fullTc.x, fullTc.y + 60);
const cap = AoE2.popCap(full, 1), used = AoE2.popUsed(full, 1);
const home = redTc(full);
const prey = full.units.filter((u) => u.team === 0)
  .sort((a, b) => ((a.x - home.x) ** 2 + (a.y - home.y) ** 2) - ((b.x - home.x) ** 2 + (b.y - home.y) ** 2))[0];
oneSecond(full);                                     // the tick that acts, not the whole wave
const sentAt = red(full).filter((u) => u.kind === 'militia');
check(used >= cap && sentAt.length > 0 && sentAt.every((u) => u.order.kind === 'attack' && u.order.target === prey.id) &&
      redTc(full).queue.length === 0 && full.toastMsg === '' &&
      (full.aiLog || []).some((e) => e.msg === 'Red attack wave!' && e.t === full.time),
  'ai: at the population cap the wave sends its militia at the nearest blue unit',
  'pop ' + used + '/' + cap + ' prey=' + prey.id + ' militia=' + orders(full) +
  ' toast=' + JSON.stringify(full.toastMsg) + ' log=' + full.aiLog.map((e) => e.t + ':' + e.msg).join(','));

// 3. below the cap with a small village - two villagers and a militia, three of five - so
//    the militia counting toward the cap (P1-10) does not stop it wanting a villager
const grow = village(true, 2);
const before = AoE2.popUsed(grow, 1), food0 = grow.res[1].food;
oneSecond(grow);       // A2: the decision is the AI's own tick, so the window is one second
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

/* ---- 17. roadmap A2: the AI state and its tick ------------------------- */
/* A2 (docs/plans/2026-11-14-strix-local-roadmap.md §5, fixes docs/TODO.md P1-21): the red
   brain's state is Game.ai[1] — {lastTick}, saved — and aiStep acts at most once per
   CFG.AI_TICK of Game.time, sends every training order through `train` (queueTrain, which
   pushed militia onto the Town Center queue behind train's back, is gone), answers through
   Game.aiLog, and judges a red build by red's own age. These checks step by CFG.SIM_DT —
   the fixed step itself, the number harness DT carries — so a tick boundary lands on an
   exact second of Game.time and is compared as a value, not a tolerance. */
const SIM_DT = AoE2.CFG.SIM_DT;
const steps = (g, n) => { for (let i = 0; i < n; i++) AoE2.stepSim(g, SIM_DT); };
const brainOf = (g) => (g.ai || [])[1];
const tickOf = (g) => (brainOf(g) === undefined ? 'no Game.ai[1]' : String(brainOf(g).lastTick));
/* write the tick the way its owner does; safe on a build that has no slot yet, so the check
   fails on the missing field instead of taking the rest of the file down with a TypeError */
const setTick = (g, t) => { if (brainOf(g)) brainOf(g).lastTick = t; return g; };
const rich = (g) => { g.res[1] = { food: 9000, wood: 9000, gold: 9000, stone: 9000 }; return g; };
const peek = (g) => (g.aiLog || []).map((e) => e.t + ':' + e.msg).join(',');

// 12. the cadence constant the card authors, and the slot it drives
check(AoE2.CFG.AI_TICK === 1, 'a2: CFG.AI_TICK is authored as one second per decision',
  'AI_TICK=' + AoE2.CFG.AI_TICK);
const a2slot = village(true);
check(Array.isArray(a2slot.ai) && a2slot.ai.length === 2 && a2slot.ai[0] === null &&
      a2slot.ai[1].lastTick === -1,
  'a2: Game.ai is [null, {lastTick: -1}] — no brain for the player (A10), a sleeping one for red',
  'ai=' + JSON.stringify(a2slot.ai));

// 13. the cadence itself: 29 steps (0.9666 s) do nothing, the 30th (exactly 1 s) ticks and
//     pushes exactly one queue entry, the next 29 do nothing again, and the 60th ticks again
//     without pushing a second one — the Town Center never double-queues (docs/GAME_RULES.md)
const a2cad = rich(village(true, 2));                   // pop 3 of 5: a tick can only train
const a2q = (g) => redTc(g).queue.length;
steps(a2cad, 29);
check(tickOf(a2cad) === '-1' && a2q(a2cad) === 0,
  'a2: 29 steps (0.9666 s) — no tick and no queue entry',
  'tick=' + tickOf(a2cad) + ' queue=' + a2q(a2cad));
steps(a2cad, 1);
check(tickOf(a2cad) === String(AoE2.CFG.AI_TICK) && a2q(a2cad) === 1,
  'a2: the 30th step (1 s) moves lastTick to the boundary and pushes exactly one entry',
  'tick=' + tickOf(a2cad) + ' queue=' + a2q(a2cad) + ' ' + redTc(a2cad).queue.map((x) => x.kind).join(','));
steps(a2cad, 29);
check(tickOf(a2cad) === String(AoE2.CFG.AI_TICK) && a2q(a2cad) === 1,
  'a2: 29 more steps (1.9666 s) — still that one tick, still that one entry',
  'tick=' + tickOf(a2cad) + ' queue=' + a2q(a2cad));
steps(a2cad, 1);
check(tickOf(a2cad) === '2' && a2q(a2cad) === 1,
  'a2: the 2 s tick moves the clock and pushes nothing while that villager is still training',
  'tick=' + tickOf(a2cad) + ' queue=' + a2q(a2cad) + ' ' + redTc(a2cad).queue.map((x) => x.kind).join(','));

// 14. the wave clock stays separate from the tick: Game.wave counts every second of a
//     started game and resets on CFG.WAVE_EVERY — 44 brain ticks never reset it
const a2wave = village(true);
steps(a2wave, 1320);                                    // 44 s of fixed steps
check(a2wave.wave === a2wave.time && a2wave.wave > 43 && a2wave.wave < 45 && tickOf(a2wave) === '44',
  'a2: at 44 s Game.wave still counts the wave (equal to Game.time, 44 ticks in)',
  'wave=' + a2wave.wave + ' time=' + a2wave.time + ' tick=' + tickOf(a2wave));
steps(a2wave, 30);                                      // 45 s: the wave fires, here and only here
check(a2wave.wave === 0 && tickOf(a2wave) === '45',
  'a2: Game.wave resets at CFG.WAVE_EVERY, not on a brain tick',
  'wave=' + a2wave.wave + ' time=' + a2wave.time + ' tick=' + tickOf(a2wave));

// 15. docs/TODO.md P1-21, the cheat itself. The fixture is the village with a finished red
//     house — pop cap 5 -> 10, the range where queueTrain put a militia on the Town Center —
//     with stockpiles rich enough to buy militia, run 9000 steps (5 simulated minutes) and
//     every red queue read after every tick.
const a2five = (() => {
  const g = rich(village(true, 2));
  const pad = freeSpotAround(g.world, g, redTc(g).tx, redTc(g).ty, 2, 2, 8);
  const house = AoE2.makeBuilding(g, 'house', 1, pad.tx, pad.ty);
  house.built = 1; house.hp = house.maxHp;
  /* the cap this fixture builds for itself: the keep's 5 plus its own house. A4 lifts it as
     the village grows, so the number the check judges is the fixture's, not the run's end. */
  const capAtStart = AoE2.popCap(g, 1);
  const kinds = new Set();
  for (let i = 0; i < 9000; i++) {
    AoE2.stepSim(g, SIM_DT);
    if ((i + 1) % 30 !== 0) continue;                     // read the queues on the tick grid
    for (const b of g.buildings) if (b.team === 1) for (const j of b.queue) kinds.add(j.kind);
  }
  return { kinds: [...kinds].sort().join(','), cap: AoE2.popCap(g, 1), capAtStart, used: AoE2.popUsed(g, 1), tick: tickOf(g) };
})();
check(a2five.capAtStart === 10 && a2five.kinds === 'villager',
  'a2: a red village with no Barracks never queues militia over 5 simulated minutes',
  'cap ' + a2five.capAtStart + ' -> ' + a2five.cap + ' used=' + a2five.used + ' tick=' + a2five.tick + ' queue kinds=' + a2five.kinds);

// 16. A1's toast rule, extended to the command A1 left out: a red `train` refusal is logged
//     and the player's toast line does not move
const a2msg = village(true);
const a2Toast0 = a2msg.toastMsg, a2Queue0 = redTc(a2msg).queue.length;
const a2Refused = AoE2.train(a2msg, redTc(a2msg), 'militia');
check(a2Refused === undefined && a2msg.toastMsg === a2Toast0 && a2Queue0 === 0 &&
      a2msg.aiLog.length === 1 &&
      a2msg.aiLog[0].msg === AoE2.KINDS.militia.label + ' needs a ' + AoE2.BLD[redTc(a2msg).kind].label,
  'a2: a red train refusal appends to Game.aiLog and leaves Game.toastMsg alone',
  'out=' + String(a2Refused) + ' toast=' + JSON.stringify(a2msg.toastMsg) + ' log=' + peek(a2msg));

// 17. A1's second gap: canPlaceAt judged every tile by the player's age, so a red Feudal
//     site was refused by the tile rule. It takes the team now; the player's ghost — the
//     other caller, in render.js — keeps the default and still refuses the same tile
const a2age = rich(village(true));
a2age.age[0] = 0; a2age.age[1] = 1;                      // player: Dark Age, red: Feudal
const a2Spot = a1Spot(a2age, 1);                          // a legal 2x2 pad beside a red villager
const a2Built = a2age.buildings.length;
const a2Barracks = AoE2.build(a2age, 'barracks', a2Spot.x, a2Spot.y, 1, [a2Spot.v.id]);
check(!!a2Barracks && a2Barracks.team === 1 && a2age.buildings.length === a2Built + 1 &&
      a2age.toastMsg === '' && a2age.aiLog.length === 1 &&
      a2age.aiLog[0].msg === AoE2.BLD.barracks.label + ' started' &&
      AoE2.canPlaceAt(a2age, 'barracks', tOf(a2Spot.x), tOf(a2Spot.y)) === false,
  'a2: canPlaceAt takes the team — red builds a Feudal barracks the player\'s ghost still refuses',
  'built=' + a2Built + '->' + a2age.buildings.length +
  (a2Barracks ? ' team=' + a2Barracks.team : ' no site') +
  ' toast=' + JSON.stringify(a2age.toastMsg) + ' log=' + peek(a2age));

// 18. the brain is saved: a v3 payload (no ai field) migrates into [null, {lastTick: -1}]
//     and a v4 payload round-trips the tick clock byte for byte
const a2saved = setTick(AoE2.createState(), 12.5);
const a2v4 = AoE2.saveGame(AoE2.SAVE_PATH + ':a2', a2saved, 1);
const a2v3body = Object.assign({}, JSON.parse(a2v4).state);
delete a2v3body.ai;                                       // the v3 shape: no brain slot at all
const a2v3 = JSON.stringify({ version: 3, seed: a2saved.world.seed, writtenAt: 1, state: a2v3body });
const a2loaded = AoE2.createState();
const a2LoadV3 = AoE2.loadGame(AoE2.SAVE_PATH + ':a2', a2loaded, a2v3);
check(a2LoadV3 === true && JSON.stringify(a2loaded.ai) === '[null,{"lastTick":-1}]',
  'a2: a v3 payload without ai migrates to [null, {lastTick: -1}] instead of being refused',
  'loaded=' + a2LoadV3 + ' ai=' + JSON.stringify(a2loaded.ai));
const a2back = AoE2.createState();
const a2LoadV4 = AoE2.loadGame(AoE2.SAVE_PATH + ':a2', a2back, a2v4);
check(a2LoadV4 === true && String(a2back.ai && a2back.ai[1] && a2back.ai[1].lastTick) === '12.5' &&
      AoE2.saveGame(AoE2.SAVE_PATH + ':a2b', a2back, 1) === a2v4,
  'a2: a v4 round-trip preserves ai[1].lastTick and re-saves identically',
  'loaded=' + a2LoadV4 + ' ai=' + JSON.stringify(a2back && a2back.ai) +
  ' resave=' + (a2LoadV4 === true && AoE2.saveGame(AoE2.SAVE_PATH + ':a2b', a2back, 1) === a2v4));

/* ---- 18. roadmap A3: every red villager has a job ---------------------- */
/* A3 (docs/plans/2026-11-14-strix-local-roadmap.md §5, needs A2): the ring search
   `assignStarter` (`src/boot.js`) ran inline is now `findJob` (`src/economy.js`) — the one
   answer to "where does this villager work", shared by the starting squad and the AI — and
   `aiJobs` (`src/ai.js`) hires every idle red villager onto the resource furthest below
   `CFG.AI_SPLIT`, with `CFG.AI_VILLAGERS` as the village size the Town Center staffs (until
   A4 raises the cap with houses, `train` must not be asked past `popCap`: a `Need more
   houses` refusal per second is noise, not a plan).
   The 10 simulated minutes below are the card's proof. The lifetime gathered counter is
   card S5, so — as G7 documented for tools/ai-arena.js — the stockpiles are what shows the
   work actually happened. */
const a3vill = (g) => g.units.filter((u) => u.team === 1 && u.kind === 'villager' && !u.dead);
const a3idle = (g) => a3vill(g).filter((u) => u.order.kind === 'idle');
const attempt = (fn) => { try { return fn(); } catch (e) { return { err: String((e && e.message) || e) }; } };

// 19. the two numbers the card authors, the way SIM_DT and AI_TICK are authored
check(AoE2.CFG.AI_VILLAGERS === 22 && JSON.stringify(AoE2.CFG.AI_SPLIT) ===
      JSON.stringify({ food: 0.5, wood: 0.35, gold: 0.15 }),
  'a3: CFG.AI_VILLAGERS is 22 and CFG.AI_SPLIT is .5 food / .35 wood / .15 gold',
  'AI_VILLAGERS=' + AoE2.CFG.AI_VILLAGERS + ' AI_SPLIT=' + JSON.stringify(AoE2.CFG.AI_SPLIT));

/* 20-21. an authored map, so the split is judged on the rule and not on whatever seed 1337
   happens to scatter next to the red Town Center: the seeded tiles wiped to grass, one tile
   per resource stamped on the free ground ringing the keep — rings 1..3, minus the keep's own
   footprint and the tiles the seeded roster stands on — and the roster topped up to
   `villagers` living villagers, since the seeded side has four plus a militia and the card
   counts five. */
const a3Tile = {                          // the tile each resource lives on, and the stock it holds
  food: { t: AoE2.T.BERRY, n: AoE2.CFG.RES.berry },      // CFG.RES is keyed by tile, not by resource
  wood: { t: AoE2.T.FOREST, n: AoE2.CFG.RES.tree },
  gold: { t: AoE2.T.GOLD, n: AoE2.CFG.RES.gold },
};
function onMap(resList, villagers) {
  const g = village(true);
  const w = g.world, tc = redTc(g);
  for (let i = 0; i < w.type.length; i++) { w.type[i] = AoE2.T.GRASS; w.amount[i] = 0; }
  const onTiles = new Set(g.units.filter((u) => !u.dead)
    .map((u) => Math.floor(u.y / AoE2.CFG.TILE) * w.w + Math.floor(u.x / AoE2.CFG.TILE)));
  const free = [];
  for (let r = 1; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tc.tx + dx, y = tc.ty + dy;
        if (!solidTile(g, x, y) && !onTiles.has(y * w.w + x)) free.push({ x, y });
      }
    }
  }
  resList.forEach((res, i) => setTile(g, free[i].x, free[i].y, a3Tile[res].t, a3Tile[res].n));
  const seeded = a3vill(g).length;
  for (let i = seeded; i < villagers; i++) {
    const p = tileCentre(g, free[resList.length + i - seeded].x, free[resList.length + i - seeded].y);
    AoE2.makeUnit(g, 'villager', 1, p.x, p.y);
  }
  return g;
}

// 20. the extraction itself, asked the way resetGame asks it: the same source the starter
//     already holds, and the same answers for the other two resources (`01-world-roster.js`
//     holds the starter-squad rules and is untouched by this card)
const a3job = attempt(() => {
  const g = AoE2.createState();
  const v = a3vill(g)[0];
  const ask = (res) => {
    const j = AoE2.findJob(g, v, res);
    return j ? j.src.res + '@' + j.src.tx + ',' + j.src.ty + ':' + j.full : 'none';
  };
  return { starter: v.order.src.res + '@' + v.order.src.tx + ',' + v.order.src.ty,
    food: ask('food'), wood: ask('wood'), gold: ask('gold'), any: ask(null), order: v.order.kind };
});
check(!a3job.err && a3job.order === 'harvest' && a3job.food === a3job.starter + ':false' &&
      a3job.any === a3job.starter + ':false' && /^wood@\d+,\d+:false$/.test(a3job.wood) &&
      /^gold@\d+,\d+:false$/.test(a3job.gold),
  'a3: findJob returns the very source assignStarter gave that villager, and the nearest wood and gold tiles besides',
  'order=' + (a3job.order || '-') + ' starter=' + (a3job.starter || '-') +
  ' food=' + (a3job.food || '-') + ' wood=' + (a3job.wood || '-') +
  ' gold=' + (a3job.gold || '-') + ' any=' + (a3job.any || '-') + (a3job.err ? ' err=' + a3job.err : ''));

/* 21. the split, on one berry (2 slots), one tree (2) and one gold (2) with five idle
   villagers: CFG.AI_SPLIT over five villagers wants 2.5 food, 1.75 wood, 0.75 gold, so the
   rule's answer is food, wood, food, wood, gold — the card's "the first three go
   food/wood/food by deficit order", with the fourth taking the last wood slot and the fifth
   the gold the moment food and wood have nothing free left. A4 decides on the same tick,
   after the hires, and takes one of the two wood workers off the tree to raise the village's
   first house: that villager reads as `build` here (the order A4 owns), while the resource he
   was given is still the one A3's rule gave him — see section 19 for the house itself. */
const a3map = attempt(() => {
  const g = onMap(['food', 'wood', 'gold'], 5);
  steps(g, 30);                                        // one CFG.AI_TICK: the whole village is hired at once
  const seq = a3vill(g).map((u) => (u.order.kind === 'build' ? 'build' : u.order.src ? u.order.src.res : 'idle')).join(',');
  const v = a3vill(g)[4];                              // the fifth is the one with nothing free left
  const full = (res) => { const j = AoE2.findJob(g, v, res); return j === null ? 'none' : String(j.full); };
  return { seq, crew: a3vill(g).findIndex((u) => u.order.kind === 'build'),
    food: full('food'), wood: full('wood'), gold: full('gold') };
});
check(!a3map.err && a3map.seq === 'food,wood,food,build,gold',
  'a3: five idle villagers are hired in CFG.AI_SPLIT order, the A4 crew marked build',
  'assigned=' + (a3map.seq || '-') + ' crew=' + (a3map.crew === undefined ? '-' : a3map.crew) +
  (a3map.err ? ' err=' + a3map.err : ''));
check(!a3map.err && a3map.food === 'true' && a3map.wood === 'false' && a3map.gold === 'false',
  'a3: the fifth villager counts food full and works gold, the wood slot A4 left open again',
  'food=' + (a3map.food || '-') + ' wood=' + (a3map.wood || '-') + ' gold=' + (a3map.gold || '-') +
  (a3map.err ? ' err=' + a3map.err : ''));

/* 22-23. the card's 10 simulated minutes on the seeded village (18 000 fixed steps), read
   once per simulated minute: nobody left standing idle in 9 of the 10 samples, and the wood
   the village now chops actually reaching the stockpile. */
const a3run = attempt(() => {
  const g = village(true);
  const wood0 = g.res[1].wood;
  const idle = [];
  for (let m = 0; m < 10; m++) { steps(g, 1800); idle.push(a3idle(g).length); }
  return { idle, zero: idle.filter((n) => n === 0).length, wood0, wood1: g.res[1].wood, vills: a3vill(g).length };
});
check(!a3run.err && a3run.zero >= 9,
  'a3: 10 simulated minutes leave 0 idle red villagers in at least 9 of the 10 samples',
  'villagers=' + (a3run.vills === undefined ? '-' : a3run.vills) + ' idle per minute=' +
  (a3run.idle ? a3run.idle.join(',') : '-') + ' zeros=' + (a3run.zero === undefined ? '-' : a3run.zero) +
  '/10' + (a3run.err ? ' err=' + a3run.err : ''));
check(!a3run.err && a3run.wood1 > a3run.wood0,
  'a3: the wood column moves — red\'s stockpile ends above the 100 it started with (the lifetime counter is S5)',
  'wood ' + (a3run.wood0 === undefined ? '-' : a3run.wood0) + ' -> ' +
  (a3run.wood1 === undefined ? '-' : Math.floor(a3run.wood1)) + (a3run.err ? ' err=' + a3run.err : ''));

/* ---- 19. roadmap A4: red raises houses ---------------------------------- */
/* A4 (docs/plans/2026-11-14-strix-local-roadmap.md §5, needs A3; with it the first half of
   docs/TODO.md 20 closes): on its tick the brain asks for a house once the village is two
   slots from the population its built buildings allow — `popCommitted(Game, 1) + 2 >=
   popCap(Game, 1)` — and only while no red house is already going up. `popCommitted` counts
   living *and* queued villagers while an unfinished site adds no `pop` (`popCap` reads built
   buildings only), so the two are the room that house will hand out: the village gets the room
   before it runs out of it, not one second after. The crew is the nearest red villager working
   wood, the site the nearest pad `canPlaceAt` accepts beside the keep, and every number —
   25 wood, 25 s of work, +5 pop, 2x2 — is `BLD.house`'s (`src/config.js`, vendored): the card
   authors no constant, so these checks read the table instead of retyping one. */
const a4houses = (g) => g.buildings.filter((b) => b.team === 1 && b.kind === 'house');

/* 24-25. the card's proof: the seeded game with an idle player, the shape
   tools/ai-arena.js plays (`createState()` + `resetGame(g, seed)` + `started = true`), run 20
   simulated minutes one CFG.SIM_DT step at a time. The population is read once per simulated
   minute; the village's first house is followed at every step — what it cost, who built it,
   when it stopped being a foundation — because "the builder is not stolen by aiJobs" is a
   statement about the seconds in between, not about the minute marks. */
function a4watch(seed) {
  const g = AoE2.createState();
  AoE2.resetGame(g, seed);
  g.started = true;
  const out = { seed: g.world.seed, cap: [], used: [], idle: [], steps: 0, maxUnbuilt: 0, first: null };
  for (let i = 1; i <= 20 * 1800; i++) {
    const wood = g.res[1].wood;
    AoE2.stepSim(g, SIM_DT);
    out.steps = i;
    if (g.result) break;                             // an ended game stops the clock (red fields no fighter until A6)
    if (i % 1800 === 0) {
      out.cap.push(AoE2.popCap(g, 1)); out.used.push(AoE2.popUsed(g, 1)); out.idle.push(a3idle(g).length);
    }
    const houses = a4houses(g);
    if (!out.first && houses.length) {               // the tick the village raised its first site
      const b = houses[0];
      const v = g.units.find((u) => !u.dead && u.team === 1 && u.order.kind === 'build' && u.order.b === b.id);
      out.first = { id: b.id, start: g.time, spent: wood - g.res[1].wood, toast: g.toastMsg,
        walk: v ? Math.max(0, Math.hypot(v.x - b.x, v.y - b.y) - AoE2.CFG.TILE) / AoE2.KINDS.villager.speed : 0,
        work: 0, done: 0, builders: v ? 1 : 0 };
    }
    let unbuilt = 0;
    for (const b of houses) {
      if (b.built < 1) unbuilt++;
      if (b.id !== out.first.id) continue;           // only the first house is followed; the rest is one rule
      const h = out.first;
      if (b.built >= 1) { if (!h.done) h.done = g.time; continue; }
      if (!h.work && b.built > 0) h.work = g.time;   // the first frame the site grew: the builder got there
      const n = g.units.filter((u) => !u.dead && u.team === 1 && u.order.kind === 'build' && u.order.b === b.id).length;
      if (n < h.builders) h.builders = n;            // the smallest crew the unfinished site ever had
    }
    if (unbuilt > out.maxUnbuilt) out.maxUnbuilt = unbuilt;
  }
  return out;
}
const a4r = attempt(() => a4watch(AoE2.CFG.SEED));
const a4h = !a4r.err ? a4r.first : null;
const a4past = !a4r.err ? a4r.cap.findIndex((c, i) => c > 5 && a4r.used[i] > 5) : -1;

check(!a4r.err && a4past >= 0 && a4past <= 5,
  'a4: the idle-player village is past the Town Center cap - popCap and popUsed above 5 by minute 6',
  'seed=' + (a4r.seed === undefined ? '-' : a4r.seed) + ' first minute past 5=' +
  (a4past < 0 ? 'never' : a4past + 1) + ' cap=' + (a4r.cap || []).join(',') + ' used=' +
  (a4r.used || []).join(',') + ' idle=' + (a4r.idle || []).join(',') + (a4r.err ? ' err=' + a4r.err : ''));
check(!a4r.err && !!a4h && a4r.maxUnbuilt === 1 && a4h.done > 0 && a4h.builders === 1 &&
      a4h.done - a4h.work <= AoE2.BLD.house.time + SIM_DT && a4h.work - a4h.start <= a4h.walk + 1,
  'a4: one red house at a time, built by the one villager it was given',
  'unbuilt_max=' + (a4r.maxUnbuilt === undefined ? '-' : a4r.maxUnbuilt) + ' steps=' +
  (a4r.steps === undefined ? '-' : a4r.steps) + (a4h ? ' start=' + a4h.start.toFixed(2) + ' work=' +
  (a4h.work ? a4h.work.toFixed(2) : '-') + ' done=' + (a4h.done ? a4h.done.toFixed(2) : '-') +
  ' walk=' + a4h.walk.toFixed(2) + ' builders=' + a4h.builders : ' no house') +
  ' time=' + AoE2.BLD.house.time + (a4r.err ? ' err=' + a4r.err : ''));

/* 26. the guard on both sides of the card's `popCommitted + 2 >= popCap`. Two of the five
   slots the keep allows is room enough: the tick that hires the village's last free villager
   and queues the next one raises no site and writes no line in Game.aiLog, because an attempt
   the village does not want is not made. Three of five — the exact boundary the +2 draws, the
   room the next house hands out — raises the site on the next tick and spends exactly
   BLD.house.cost.wood: that fixture is rich and its two villagers were standing idle, so the
   house is the only thing in that second that can touch the wood column, and the pad is the
   row's own 2x2 with the row's own 25 s of work. */
const a4poor = attempt(() => {
  const g = rich(village(true, 1));                    // one villager and one militia: two of five
  steps(g, 30);                                        // exactly one CFG.AI_TICK
  return { houses: a4houses(g).length, logs: (g.aiLog || []).length, toast: g.toastMsg, queue: redTc(g).queue.length };
});
const a4edge = attempt(() => {
  const g = rich(village(true, 2));
  const wood = g.res[1].wood;
  steps(g, 30);                                      // exactly one CFG.AI_TICK
  const h = a4houses(g)[0];
  return { wood, now: g.res[1].wood, toast: g.toastMsg, log: peek(g), team: h ? h.team : -1,
    w: h ? h.w : 0, h: h ? h.h : 0, time: h ? h.time : -1,
    crew: h ? g.units.filter((u) => !u.dead && u.team === 1 && u.order.kind === 'build' && u.order.b === h.id).length : -1 };
});
check(!a4poor.err && a4poor.houses === 0 && a4poor.logs === 0 && a4poor.toast === '' &&
      a4poor.queue === 1,
  'a4: two of five is room enough - the tick trains, but raises no house and logs nothing',
  'houses=' + (a4poor.houses === undefined ? '-' : a4poor.houses) + ' logs=' +
  (a4poor.logs === undefined ? '-' : a4poor.logs) + ' queue=' +
  (a4poor.queue === undefined ? '-' : a4poor.queue) + ' toast=' +
  JSON.stringify(a4poor.toast === undefined ? null : a4poor.toast) + (a4poor.err ? ' err=' + a4poor.err : ''));
check(!a4edge.err && a4edge.team === 1 && a4edge.now === a4edge.wood - AoE2.BLD.house.cost.wood &&
      a4edge.w === AoE2.BLD.house.w && a4edge.h === AoE2.BLD.house.h && a4edge.time === AoE2.BLD.house.time &&
      a4edge.crew === 1 && a4edge.toast === '',
  'a4: three of five raises a red 2x2 house on the next tick for exactly BLD.house.cost.wood',
  'wood ' + (a4edge.wood === undefined ? '-' : a4edge.wood) + '->' + (a4edge.now === undefined ? '-' : a4edge.now) +
  ' cost=' + (a4edge.err ? '-' : AoE2.BLD.house.cost.wood) + ' crew=' + (a4edge.crew === undefined ? '-' : a4edge.crew) +
  ' pad=' + (a4edge.w === undefined ? '-' : a4edge.w + 'x' + a4edge.h) + ' time=' +
  (a4edge.time === undefined ? '-' : a4edge.time) + ' toast=' +
  JSON.stringify(a4edge.toast === undefined ? null : a4edge.toast) + ' log=' + (a4edge.log || '-') +
  (a4edge.err ? ' err=' + a4edge.err : ''));

/* ---- 20. roadmap A5: drop sites and farms --------------------------------- */
/* A5 (docs/plans/2026-11-14-strix-local-roadmap.md §5, needs A4) — the village stops walking
   wood and gold across the map once `CFG.AI_DROP_MIN_WORKERS` of its villagers work a source
   more than `CFG.AI_DROP_RADIUS` tiles from the drop-off `findDropoff` would send them to: it
   puts a `lumber_camp` (wood) or a `mining_camp` (gold) on that ground instead, one of each.
   And when no berry is left inside `CFG.AI_BERRY_RADIUS` of the keep — the radius `findJob`
   searches, so "no berry the village can reach from home" — the food the cluster used to feed
   becomes fields: one `mill`, then one `farm` per villager the food share has left without a
   berry, each crewed by that villager so A4's `building` tally keeps him on the site.
   `BLD.mill` is a Feudal row, so until card A7 ages red up `canPlaceAt` refuses the ground and
   the mill waits; the checks say so in both the Dark Age run and a Feudal fixture.
   The card's proof is an idle-player run to simulated minute 12, and the seeded map at 1337
   cannot make it: its forest sits inside the 8-tile radius (so the wood workers have no reason
   to put a camp there) and its berry cluster outlives minute 12 (so the farm rule has nothing
   to replace). a5seed therefore authors the map the rules judge — two FOREST tiles at ring 10
   from the red Town Center carrying 6000 wood each (the row's own 60 would leave eight
   villagers jobless inside a minute and the run would end with nothing to count), two BERRY
   tiles at `CFG.RES.berry` two tiles from the keep (the seeded 900-food cluster feeds a
   22-village for five minutes; these two end the band inside two) and one GOLD tile at ring 3
   — with red's stockpile set to the `rich` fixture's, so a cost is never the answer a check
   reads. */
const A5_FIELD = [['wood', 10, 0, 6000], ['wood', 10, 1, 6000], ['food', 2, 0], ['food', 2, 1],
  ['gold', 3, 0]];
const a5kind = (g, kind) => g.buildings.filter((b) => b.team === 1 && b.kind === kind);
const a5wipe = (g) => {
  const w = g.world;
  for (let i = 0; i < w.type.length; i++) { w.type[i] = AoE2.T.GRASS; w.amount[i] = 0; }
  return g;
};
const a5put = (g, res, dx, dy, amount) => {
  const tc = redTc(g), t = a3Tile[res];
  setTile(g, tc.tx + dx, tc.ty + dy, t.t, amount === undefined ? t.n : amount);
  return { tx: tc.tx + dx, ty: tc.ty + dy };
};
const a5cheb = (a, b) => Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty));
/** The A5 fixture: the seeded village (`createState()` + `resetGame(g, seed)` + `started =
 *  true` — the shape tools/ai-arena.js plays, so a check names the seed it ran), `opts.keep`
 *  living red villagers with the rest marked dead the way `village()` does, the world wiped and
 *  `puts` (`[res, dx, dy, amount?]` offsets from the red keep — the a3 `onMap` pattern at the
 *  radii A5 judges; `onMap` stacks its tiles in rings 1..3, inside the walk a camp saves), red
 *  rich, and `opts.work` (a resource) putting every one of those villagers on a `harvest` order
 *  at that resource's first stamped tile instead of waiting for `aiJobs` to spread them by
 *  `CFG.AI_SPLIT`. `opts.house` drops a finished red house beside the keep — the `a2five`
 *  trick: with `popCap` 10 and a smaller village the A4 rule stays quiet, so a one-tick fixture
 *  changes exactly what the rule under test ordered and nothing else. */
function a5seed(seed, puts, opts = {}) {
  const g = AoE2.createState();
  AoE2.resetGame(g, seed);
  g.started = true;
  if (opts.age !== undefined) g.age[1] = opts.age;   // the age the rows are judged by (A5's mill is Feudal)
  const vill = a3vill(g);
  for (const u of (opts.keep === undefined ? [] : vill.slice(opts.keep))) u.dead = true;
  a5wipe(g);
  const tiles = {};
  for (const p of puts) {
    (tiles[p[0]] = tiles[p[0]] || []).push(a5put(g, p[0], p[1], p[2], p[3]));
  }
  if (opts.house) {
    const pad = freeSpotAround(g.world, g, redTc(g).tx, redTc(g).ty,
      AoE2.BLD.house.w, AoE2.BLD.house.h, 8);
    const b = AoE2.makeBuilding(g, 'house', 1, pad.tx, pad.ty);
    b.built = 1; b.hp = b.maxHp;
  }
  for (const v of a3vill(g)) {
    const src = opts.work ? AoE2.sourceFromTile(g, v, tiles[opts.work][0].tx, tiles[opts.work][0].ty) : null;
    v.order = src ? { kind: 'harvest', src } : { kind: 'idle' };
  }
  return { g, tiles };
}
/** One `CFG.AI_TICK` of the brain on that fixture: 30 `CFG.SIM_DT` steps, the new buildings and
 *  the crew each of them got. `rich` runs first so the tick's spend is the only thing that can
 *  move a stockpile, which is what lets a check name the exact cost a rule paid. */
function a5tick(seed, puts, opts) {
  const f = a5seed(seed, puts, opts);
  const g = rich(f.g);
  const before = g.buildings.map((b) => b.id);
  const wood = g.res[1].wood;
  steps(g, 30);
  const made = g.buildings.filter((b) => before.indexOf(b.id) < 0);
  return { tiles: f.tiles, made: made.map((b) => ({ kind: b.kind, tx: b.tx, ty: b.ty, w: b.w, h: b.h,
    time: b.time, crew: a3vill(g).filter((u) => u.order.kind === 'build' && u.order.b === b.id).length })),
    built: g.buildings.length, spent: wood - g.res[1].wood, log: peek(g) };
}
/** a minute mark of the field run: the counts every A5 invariant is judged on, plus the ground
 *  the camps were put on. */
function a5sample(g) {
  const vill = a3vill(g);
  const site = { house: [], farm: [], lumber_camp: [], mining_camp: [], mill: [] };
  for (const b of g.buildings) if (b.team === 1 && site[b.kind] !== undefined) site[b.kind].push(b);
  let sites = 0, crewed = 0, strays = '';
  for (const kind in site) {
    for (const b of site[kind]) {
      if (b.built >= 1) continue;
      const n = vill.filter((u) => u.order.kind === 'build' && u.order.b === b.id).length;
      sites++;
      if (n === 1) crewed++;
      else strays = (strays ? strays + ' ' : '') + kind + '#' + b.id + ':' + n;
    }
  }
  return { t: Math.round(g.time), vills: vill.length, builders: vill.filter((u) => u.order.kind === 'build').length,
    houses: site.house.length, farms: site.farm.length, camps: site.lumber_camp.length,
    mines: site.mining_camp.length, mills: site.mill.length, sites, crewed, strays,
    campTiles: site.lumber_camp.map((b) => ({ tx: b.tx, ty: b.ty })),
    millTiles: site.mill.map((b) => ({ tx: b.tx, ty: b.ty })),
    cap: AoE2.popCap(g, 1), used: AoE2.popUsed(g, 1) };
}
function a5watch(seed, minutes) {
  const f = a5seed(seed, A5_FIELD);
  const g = rich(f.g);
  const out = { seed: g.world.seed, wood: f.tiles.wood, gold: f.tiles.gold, berry: f.tiles.food, samples: [] };
  for (let i = 1; i <= minutes * 1800; i++) {
    AoE2.stepSim(g, SIM_DT);
    if (g.result) break;                             // an ended game stops the clock (red fields no fighter until A6)
    if (i % 1800 === 0) out.samples.push(a5sample(g));
  }
  return out;
}
const a5list = (xs) => xs.map((x) => x.join(':')).join(' ');
const a5field = attempt(() => a5watch(AoE2.CFG.SEED, 12));
const a5m12 = !a5field.err ? a5field.samples[11] : null;

// 27. the three numbers the card authors, the way SIM_DT / AI_TICK / AI_SPLIT are authored
check(AoE2.CFG.AI_DROP_MIN_WORKERS === 4 && AoE2.CFG.AI_DROP_RADIUS === 8 &&
      AoE2.CFG.AI_BERRY_RADIUS === 12,
  'a5: CFG.AI_DROP_MIN_WORKERS, AI_DROP_RADIUS and AI_BERRY_RADIUS are authored 4 / 8 / 12',
  'min_workers=' + AoE2.CFG.AI_DROP_MIN_WORKERS + ' drop_radius=' + AoE2.CFG.AI_DROP_RADIUS +
  ' berry_radius=' + AoE2.CFG.AI_BERRY_RADIUS);

// 28. the card's proof, read at simulated minute 12 on the field above: a lumber camp on the
//     forest edge the four wood workers were walking out of (not beside the keep), and the farms
//     the berry band left behind.
check(!a5field.err && !!a5m12 && a5m12.camps === 1 &&
      a5m12.campTiles.some((c) => a5field.wood.some((w) => a5cheb(c, w) === 1)) && a5m12.farms >= 2,
  'a5: at simulated minute 12 the idle-player village owns one lumber camp on the forest edge and 2+ farms',
  'seed=' + (a5field.seed === undefined ? '-' : a5field.seed) +
  ' map wood=' + a5list((a5field.wood || []).map((t) => [t.tx, t.ty])) +
  ' berry=' + a5list((a5field.berry || []).map((t) => [t.tx, t.ty])) +
  ' gold=' + a5list((a5field.gold || []).map((t) => [t.tx, t.ty])) +
  (a5m12 ? ' t=' + a5m12.t + ' vills=' + a5m12.vills + ' camps=' + a5m12.camps +
    ' camp@=' + a5list(a5m12.campTiles.map((t) => [t.tx, t.ty])) + ' farms=' + a5m12.farms +
    ' mills=' + a5m12.mills : ' samples=' + (a5field.samples ? a5field.samples.length : '-')) +
  (a5field.err ? ' err=' + a5field.err : ''));

// 29. one camp of each kind, ever — a second lumber camp is never started while one stands
//     (finished or not), and neither is a second mill. The field run is judged on those two
//     counts only: the farm total at a minute mark belongs to the village that ploughed it, not
//     to the village standing there now (a field outlives the farmer drafted off it to a house),
//     so the card's "never more farms than food villagers" is proved where the number is
//     computed — check 32's `no farm yet` — and not by comparing buildings to a moving crowd.
check(!a5field.err && a5field.samples.length === 12 &&
      a5field.samples.every((s) => s.camps <= 1 && s.mines <= 1 && s.mills <= 1),
  'a5: never a second lumber camp while one exists, and never a second mill',
  'samples=' + a5field.samples.length + ' camps=' + a5field.samples.map((s) => s.camps).join(',') +
  ' mines=' + a5field.samples.map((s) => s.mines).join(',') +
  ' mills=' + a5field.samples.map((s) => s.mills).join(',') + (a5field.err ? ' err=' + a5field.err : ''));

// 30. every site the village starts — house, farm or camp — has exactly one red villager on it,
//     which is A4's `building` tally doing the same job for A5's crews: a builder works one
//     foundation, so the rules below never draft the man a site already has.
check(!a5field.err && a5field.samples.length === 12 &&
      a5field.samples.every((s) => s.sites === s.crewed),
  'a5: every unfinished red site has exactly the one villager it was crewed with',
  a5field.samples.map((s) => s.t + 's:' + s.sites + '/' + s.crewed + (s.strays ? ' ' + s.strays : '')).join(' ') +
  (a5field.err ? ' err=' + a5field.err : ''));

// 31. the card's rule 2, on a village the split could only grow into: `CFG.AI_SPLIT`'s .15 of
//     22 villagers is three gold workers, so the fixture hands the four the rule asks for to the
//     gold tile at ring 10 itself (`opts.work`) and the camp is judged by its ground, its cost
//     and its crew. The finished house keeps A4 quiet and the berry two tiles out keeps A5's
//     farm rule quiet, so the camp is the only building this tick makes.
const a5mine = attempt(() => a5tick(AoE2.CFG.SEED,
  [['gold', 10, 0, 6000], ['gold', 10, 1, 6000], ['food', 2, 0]],
  { keep: 4, work: 'gold', house: 1 }));
check(!a5mine.err && a5mine.made.length === 1 && a5mine.made[0].kind === 'mining_camp' &&
      a5mine.made[0].w === AoE2.BLD.mining_camp.w && a5mine.made[0].h === AoE2.BLD.mining_camp.h &&
      a5mine.made[0].time === AoE2.BLD.mining_camp.time && a5mine.made[0].crew === 1 &&
      a5mine.made.some((b) => a5cheb(b, a5mine.tiles.gold[0]) === 1) &&
      a5mine.spent === AoE2.BLD.mining_camp.cost.wood,
  'a5: four gold carriers 10 tiles out raise one mining camp on the gold edge, crewed by one of them',
  'made=' + a5list(a5mine.made.map((b) => [b.kind, b.tx, b.ty, String(b.crew)])) +
  ' gold=' + a5list((a5mine.tiles ? a5mine.tiles.gold : []).map((t) => [t.tx, t.ty])) +
  ' built=' + a5mine.built + ' spent=' + a5mine.spent + '/' +
  (a5mine.err ? '-' : AoE2.BLD.mining_camp.cost.wood) + ' log=' + a5mine.log +
  (a5mine.err ? ' err=' + a5mine.err : ''));

// 32. the mill's half of rule 3, both sides of its age gate: BLD.mill is a Feudal row, so a
//     Dark Age village whose berries are gone builds the farm and never the mill (calling
//     `build` there would answer `Mill requires Feudal Age` into Game.aiLog every second — the
//     noise A4 spent its `canAfford` pre-check to avoid), and the same village aged to Feudal
//     builds exactly one mill for the row's cost and stops.
const a5darkMill = attempt(() => a5tick(AoE2.CFG.SEED, [['wood', 10, 0, 6000], ['gold', 3, 0]], { keep: 4 }));
check(!a5darkMill.err && a5darkMill.made.length > 0 &&
      a5darkMill.made.every((b) => b.kind !== 'mill') && !a5darkMill.log.includes(':Mill'),
  'a5: a Dark Age village with no berries left raises farms and never a mill - the row\'s age gate answers first',
  'made=' + a5list(a5darkMill.made.map((b) => [b.kind, String(b.crew)])) + ' log=' + a5darkMill.log +
  (a5darkMill.err ? ' err=' + a5darkMill.err : ''));
const a5feudal = attempt(() => a5tick(AoE2.CFG.SEED, [['food', 13, 0]], { keep: 1, work: 'food', house: 1, age: 1 }));
check(!a5feudal.err && a5feudal.made.length === 1 && a5feudal.made[0].kind === 'mill' &&
      a5feudal.made[0].w === AoE2.BLD.mill.w && a5feudal.made[0].time === AoE2.BLD.mill.time &&
      a5feudal.made[0].crew === 1 && a5feudal.spent === AoE2.BLD.mill.cost.wood,
  'a5: the same village, aged to Feudal, raises one mill for BLD.mill\'s cost and no farm yet',
  'made=' + a5list(a5feudal.made.map((b) => [b.kind, b.tx, b.ty, String(b.crew)])) + ' built=' +
  a5feudal.built + ' spent=' + a5feudal.spent + '/' + (a5feudal.err ? '-' : AoE2.BLD.mill.cost.wood) +
  ' log=' + a5feudal.log + (a5feudal.err ? ' err=' + a5feudal.err : ''));

// 33. and the second tick of that mill: the guard holds — one mill exists, so the rule says
//     nothing and the village raises nothing else while its mill is still going up.
const a5millTwice = attempt(() => {
  const f = a5seed(AoE2.CFG.SEED, [['food', 13, 0]], { keep: 1, work: 'food', house: 1, age: 1 });
  const g = rich(f.g);
  steps(g, 30);
  const once = g.buildings.length;
  steps(g, 30);
  return { once, twice: g.buildings.length,
    mills: a5kind(g, 'mill').length, log: peek(g) };
});
check(!a5millTwice.err && a5millTwice.once === a5millTwice.twice && a5millTwice.mills === 1,
  'a5: the tick after the mill is put up starts nothing - one mill, ever',
  'buildings ' + a5millTwice.once + ' -> ' + a5millTwice.twice + ' mills=' + a5millTwice.mills +
  ' log=' + a5millTwice.log + (a5millTwice.err ? ' err=' + a5millTwice.err : ''));

report();
