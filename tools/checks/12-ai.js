'use strict';
/* checks/12-ai.js -- the enemy village: it waits for the game to start, attacks when its population is full, trains when it is not.
   Runs on its own (`node tools/checks/12-ai.js`) against a freshly booted game. */

const {
  AoE2, DT, check, report, freeSpotAround, tOf,
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
oneSecond(full);                                     // the tick that acts, not the whole wave
const sentAt = red(full).filter((u) => u.kind === 'militia');
check(used >= cap && sentAt.length > 0 && sentAt.every((u) => u.order.kind === 'attack' && u.order.target === prey.id) &&
      redTc(full).queue.length === 0 && full.toastMsg === '' &&
      full.aiLog.length === 1 && full.aiLog[0].msg === 'Red attack wave!' && full.aiLog[0].t === full.time,
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
  const kinds = new Set();
  for (let i = 0; i < 9000; i++) {
    AoE2.stepSim(g, SIM_DT);
    if ((i + 1) % 30 !== 0) continue;                     // read the queues on the tick grid
    for (const b of g.buildings) if (b.team === 1) for (const j of b.queue) kinds.add(j.kind);
  }
  return { kinds: [...kinds].sort().join(','), cap: AoE2.popCap(g, 1), used: AoE2.popUsed(g, 1), tick: tickOf(g) };
})();
check(a2five.cap === 10 && a2five.kinds === 'villager',
  'a2: a red village with no Barracks never queues militia over 5 simulated minutes',
  'cap=' + a2five.cap + ' used=' + a2five.used + ' tick=' + a2five.tick + ' queue kinds=' + a2five.kinds);

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

report();
