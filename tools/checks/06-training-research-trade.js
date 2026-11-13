'use strict';
/* checks/06-training-research-trade.js -- training queues, research, market trade.
   Runs on its own (`node tools/checks/06-training-research-trade.js`) against a freshly booted game. */

const {
  finishedHouse,
  AoE2, DT, Game, blueVill, check, dataBuildings, freeSpotAround, stepRender, tOf, tc, report,
} = require('../lib/harness');

/* ---- 8. training ---------------------------------------------------- */
const house = finishedHouse(Game);        // the cap of 10 the population checks below count on
const foodBt = Game.res[0].food;
const ownUnits = () => Game.units.filter(u => u.team === 0).length;   // the enemy AI trains on its own clock
const unitsBt = ownUnits();
const trained = AoE2.train(Game, tc, 'villager');
check(!!trained && tc.queue.length === 1, 'train: villager queued at the Town Center', 'queue=' + tc.queue.length);
check(Math.floor(Game.res[0].food) === Math.floor(foodBt - 50), 'train: exactly 50 food spent',
  Math.floor(foodBt) + ' -> ' + Math.floor(Game.res[0].food));
check(AoE2.train(Game, tc, 'militia') === undefined && Game.toastMsg === 'Militia needs a Town Center',
  'train: militia rejected from a Town Center', JSON.stringify(Game.toastMsg));
stepRender(Math.ceil(AoE2.KINDS.villager.time / DT) + 2);     // the table's train time, not 7s
check(ownUnits() === unitsBt + 1, 'train: unit spawns when the timer expires',
  unitsBt + ' -> ' + ownUnits());
check(blueVill().length === 5, 'train: the new unit is a villager', String(blueVill().length));
check(AoE2.popUsed(Game, 0) === 6 && AoE2.popCap(Game, 0) === 10,
  'pop: 6/10 after training (the starting militia counts)',
  AoE2.popUsed(Game, 0) + '/' + AoE2.popCap(Game, 0));
const houseTrain = AoE2.train(Game, house, 'villager');
check(houseTrain === undefined && Game.toastMsg === 'Villager needs a House',
  'train: houses cannot train', JSON.stringify(Game.toastMsg));

/* P1-10 (docs/TODO.md): the cap counts every LIVING unit - not just the villagers - and
 * every unit already queued in the team's buildings. `popCommitted` (`src/economy.js:114`)
 * is the single helper `train` (`src/commands.js:215`) and the footer's button state
 * (`src/hud.js:106`) both consult, so a command and its button cannot disagree (the UI half
 * is pinned in tools/checks/09-hud.js). */
const capSt = AoE2.createState();                     // 4 villagers + 1 militia at a cap-5 Town Center
capSt.res[0] = { food: 9000, wood: 9000, gold: 9000, stone: 9000 };
const capTc = capSt.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
const capFood = capSt.res[0].food;
const capRefused = AoE2.train(capSt, capTc, 'villager');
check(capRefused === undefined && capSt.toastMsg === 'Need more houses' &&
      capTc.queue.length === 0 && capSt.res[0].food === capFood,
  'train: the starting militia fills the cap, so an empty Town Center queue still refuses',
  capRefused === undefined
    ? capSt.toastMsg + ' queue=' + capTc.queue.length + ' food ' + capFood + ' -> ' + capSt.res[0].food
    : 'trained anyway');
finishedHouse(capSt);                                // cap 5 -> 10, so the queue below has room
const capFirst = AoE2.train(capSt, capTc, 'villager');
check(capFirst === capTc && capTc.queue.length === 1 && AoE2.popUsed(capSt, 0) === 5 &&
      AoE2.popCommitted(capSt, 0) === 6 && AoE2.popCap(capSt, 0) === 10,
  'pop: a queued villager counts against the cap before it exists',
  'used=' + AoE2.popUsed(capSt, 0) + ' committed=' + AoE2.popCommitted(capSt, 0) +
    ' cap=' + AoE2.popCap(capSt, 0) + ' queue=' + capTc.queue.length);
let capExtra = 0;
for (let i = 0; i < 4; i++) if (AoE2.train(capSt, capTc, 'villager') === capTc) capExtra++;
check(capExtra === 4 && capTc.queue.length === 5 && AoE2.popUsed(capSt, 0) === 5 &&
      AoE2.popCommitted(capSt, 0) === 10,
  'pop: the team cannot queue more units than its cap allows',
  'extra=' + capExtra + ' queue=' + capTc.queue.length +
    ' used=' + AoE2.popUsed(capSt, 0) + ' committed=' + AoE2.popCommitted(capSt, 0));
const capBar = (() => {
  const s = freeSpotAround(capSt.world, capSt, tOf(capTc.x), tOf(capTc.y), 2, 2, 8);
  if (!s) return null;
  const b = AoE2.makeBuilding(capSt, 'barracks', 0, s.tx, s.ty);
  b.built = 1;                                        // pop 0: it adds no cap of its own
  return b;
})();
const capBarGold = capSt.res[0].gold;
const capBarTry = capBar && AoE2.train(capSt, capBar, 'militia');
check(!!capBar && capBarTry === undefined && capBar.queue.length === 0 &&
      capSt.toastMsg === 'Need more houses' && capSt.res[0].gold === capBarGold,
  'train: a Barracks with an empty queue still respects the cap its Town Center filled',
  !capBar ? 'no 2x2 site for the barracks'
    : String(capBarTry) + ' queue=' + capBar.queue.length + ' ' + capSt.toastMsg +
      ' gold=' + capSt.res[0].gold);

/* T4 of the 2026-11-11 content port: the archer line. A throwaway state (the
 * §7c pattern) funded with exactly the two table prices - 175 wood to raise the
 * range, 25 wood + 45 gold to train the archer - so no cost can pass by
 * accident, and the trained unit is checked against KINDS.archer, not literals. */
const ar = AoE2.createState();
ar.age[0] = 1;                         // data/buildings.json ages the range at 1: Feudal only
finishedHouse(ar);                     // room to train: 5 living at a cap of 5 would refuse (P1-10)
const arVill = ar.units.find((u) => u.team === 0 && u.kind === 'villager');
ar.selection = [arVill.id];
ar.res[0].wood = dataBuildings.buildings.archery_range.cost.wood + AoE2.KINDS.archer.cost.wood;
const arSpot = freeSpotAround(ar.world, ar, tOf(arVill.x), tOf(arVill.y), 2, 2, 8);
const arRng = arSpot && AoE2.build(ar, 'archery_range', arSpot.tx * AoE2.CFG.TILE + 4,
                                   arSpot.ty * AoE2.CFG.TILE + 4);
check(!!arRng && arRng.w === 2 && arRng.h === 2 &&
      ar.res[0].wood === AoE2.KINDS.archer.cost.wood,
  'build: an Archery Range raises its table 2x2 footprint for exactly 175 wood',
  arRng ? arRng.w + 'x' + arRng.h + ' wood=' + ar.res[0].wood : 'placement failed');
if (arRng) arRng.built = 1;
const arGoldBt = ar.res[0].gold;
const arQueued = arRng && AoE2.train(ar, arRng, 'archer');
check(arQueued === arRng && arRng.queue.length === 1 && arRng.queue[0].kind === 'archer' &&
      arRng.queue[0].t === AoE2.KINDS.archer.time && ar.res[0].wood === 0 &&
      ar.res[0].gold === arGoldBt - AoE2.KINDS.archer.cost.gold,
  'train: the Archery Range queues the Archer its trains column names',
  arRng ? JSON.stringify(arRng.queue) + ' wood=' + ar.res[0].wood : 'no range');
for (let i = 0; i < Math.ceil(AoE2.KINDS.archer.time / DT) + 2; i++) AoE2.stepSim(ar, DT);
const arUnit = ar.units.find((u) => u.team === 0 && u.kind === 'archer');
check(!!arUnit && arUnit.hp === 30 && arUnit.maxHp === 30 && arUnit.atk === 4 &&
      arUnit.atkTime === 0.35 && arUnit.speed === 21,
  'train: a finished Archery Range trains an Archer with the table\'s stats',
  arUnit ? 'hp=' + arUnit.hp + ' atk=' + arUnit.atk + ' atkTime=' + arUnit.atkTime : 'no archer');

/* ---- 8b. research (2026-11-12 blacksmith tech tree, T4) -------------- */
/* The blacksmith's one-slot research on its own fresh state: the Dark Age
 * refusal, a Feudal Forge that spends exactly its cost, lands in team 0's tech
 * set and raises the militia, the duplicate and busy-slot refusals through to a
 * finished Fletching cycle on the archer line, and the wrong building. */
const rbSt = AoE2.createState();
rbSt.res[0] = { food: 500, wood: 400, gold: 200, stone: 50 }; // START holds 118 food; Forge costs 150
const rbV = rbSt.units.find((u) => u.team === 0 && u.kind === 'villager');
const rbB = (() => { const s = freeSpotAround(rbSt.world, rbSt, tOf(rbV.x), tOf(rbV.y), 1, 1, 8);
  if (!s) return null; const b = AoE2.makeBuilding(rbSt, 'blacksmith', 0, s.tx, s.ty);
  b.built = 1; return b; })(); // force-set site like the §7b camp fixtures
const rbMil = rbB && AoE2.makeUnit(rbSt, 'militia', 0, rbB.x + 20, rbB.y);
const rbArc = rbB && AoE2.makeUnit(rbSt, 'archer', 0, rbB.x + 40, rbB.y);
const rbTry = (b, id) => { const before = JSON.stringify(rbSt.res[b ? b.team : 0]);
  let err = ''; try { AoE2.researchTech(rbSt, b, id); } catch (e) { err = String((e && e.message) || e); }
  return { err, msg: rbSt.toastMsg, before, after: JSON.stringify(rbSt.res[b ? b.team : 0]) }; };
const rbAge = rbTry(rbB, 'forge');
check(!rbAge.err && rbAge.after === rbAge.before && rbAge.msg === 'Forge requires Feudal Age',
  'research: research before the tech\'s age is refused',
  rbAge.err ? 'researchTech threw ' + rbAge.err
    : rbAge.msg + ' / res ' + (rbAge.after === rbAge.before ? 'untouched' : 'touched'));
rbSt.age[0] = 1; // the tech's age; ageBonus[0] stays 0 so unitAttack reads table + tech exactly
const rbGo = rbTry(rbB, 'forge');
const rbGoExp = JSON.stringify(Object.assign(JSON.parse(rbGo.before),
  { food: JSON.parse(rbGo.before).food - AoE2.TECHS.forge.cost.food }));
check(!rbGo.err && rbGo.after === rbGoExp && !!rbB && !!rbB.research &&
  rbB.research.id === 'forge' && rbB.research.t === AoE2.TECHS.forge.time,
  'research: researching Forge spends exactly its cost and starts the timer',
  rbGo.err ? 'researchTech threw ' + rbGo.err
    : 'res ' + rbGo.after + ' want ' + rbGoExp + ', slot ' + JSON.stringify(rbB && rbB.research));
for (let i = 0; i < Math.ceil(AoE2.TECHS.forge.time / DT) + 2; i++) AoE2.stepSim(rbSt, DT);
check(rbSt.techs[0].has('forge') && rbB.research === null && rbSt.toastMsg === 'Forge researched' &&
  AoE2.unitAttack(rbSt, rbMil) === AoE2.KINDS.militia.atk + AoE2.TECHS.forge.atk.melee,
  'research: finishing Forge lands it in Game.techs and clears the slot',
  'techs [' + [...rbSt.techs[0]].join(',') + '] slot ' + JSON.stringify(rbB.research) +
  ' toast ' + rbSt.toastMsg);
const rbDup = rbTry(rbB, 'forge');
check(!rbDup.err && rbDup.msg === 'Forge already researched' && rbDup.after === rbDup.before,
  'research: a duplicate tech is refused',
  rbDup.err ? 'researchTech threw ' + rbDup.err
    : rbDup.msg + ' / res ' + (rbDup.after === rbDup.before ? 'untouched' : 'touched'));
const rbFly = rbTry(rbB, 'fletching');
const rbFlyExp = JSON.stringify(Object.assign(JSON.parse(rbFly.before),
  { food: JSON.parse(rbFly.before).food - AoE2.TECHS.fletching.cost.food,
    gold: JSON.parse(rbFly.before).gold - AoE2.TECHS.fletching.cost.gold }));
const rbFlySlot = rbB && rbB.research && rbB.research.id;   // the slot the busy refusal sees
const rbBusy = rbTry(rbB, 'bracer');
for (let i = 0; i < Math.ceil(AoE2.TECHS.fletching.time / DT) + 2; i++) AoE2.stepSim(rbSt, DT);
check(!rbFly.err && rbFly.after === rbFlyExp && rbFlySlot === 'fletching' &&
  !rbBusy.err && rbBusy.msg === 'Blacksmith is busy' && rbBusy.after === rbBusy.before &&
  rbSt.techs[0].has('fletching') && rbB.research === null &&
  AoE2.unitAttack(rbSt, rbArc) === AoE2.KINDS.archer.atk + AoE2.TECHS.fletching.atk.pierce,
  'research: one research at a time',
  'fletching slot ' + rbFlySlot + ', busy: ' + rbBusy.msg + ' -> landed, archer atk '
    + (rbArc ? AoE2.unitAttack(rbSt, rbArc) : 'none'));
const rbBar = (() => { const s = freeSpotAround(rbSt.world, rbSt, tOf(rbB.x + 2 * AoE2.CFG.TILE), tOf(rbB.y), 2, 2, 8);
  if (!s) return null; const b = AoE2.makeBuilding(rbSt, 'barracks', 0, s.tx, s.ty);
  b.built = 1; return b; })();
const rbWrong = rbTry(rbBar, 'forge');
check(!rbWrong.err && rbWrong.msg === 'Barracks cannot research Forge' && rbWrong.after === rbWrong.before,
  'research: a barracks cannot research a blacksmith tech',
  rbWrong.err ? 'researchTech threw ' + rbWrong.err : rbWrong.msg);

/* ---- 8c. market trade (2026-11-12 market plan, T2) ------------------ */
/* One pure command, the design's refusal ladder: everything the market cannot
   do is toasted before anything moves, and both directions move exactly the
   authored pair (100 food/wood/stone for 33 gold, 100 back for 67). Every
   refusal fixture compares the whole res[team] so a half-done trade cannot
   slip through, and the command itself is asserted to return the building. */
const marketAt = (age, built) => {
  const st = AoE2.createState();
  st.age[0] = age;
  st.res[0] = { food: 300, wood: 300, gold: 100, stone: 300 };
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  const s = v && freeSpotAround(st.world, st, tOf(v.x), tOf(v.y),
    AoE2.BLD.market.w, AoE2.BLD.market.h, 8);
  if (!s) return null;
  const b = AoE2.makeBuilding(st, 'market', 0, s.tx, s.ty);
  b.built = built;
  return { st, b };
};
/** One trade call on `st`/`b`, optionally presetting stockpile fields (the
 *  §8b `rbTry` shape): the res snapshot is taken after the preset. */
const tradeTry = (st, b, res, dir, set) => {
  const team = b ? b.team : 0;
  if (set) for (const k in set) st.res[team][k] = set[k];
  const before = JSON.stringify(st.res[team]);
  let err = '', ret;
  try { ret = AoE2.trade(st, b, res, dir); } catch (e) { err = String((e && e.message) || e); }
  return { err, msg: st.toastMsg, before, after: JSON.stringify(st.res[team]), ret };
};
const expectRes = (from, delta) => JSON.stringify(Object.assign(JSON.parse(from), delta));
const refusal = (name, r, want) =>
  check(!r.err && r.msg === want && r.after === r.before, name,
    r.err ? 'trade threw ' + r.err : r.msg + ' / res ' + (r.after === r.before ? 'untouched' : 'touched'));
const trF = marketAt(1, 1);
const trSell = trF && tradeTry(trF.st, trF.b, 'food', 'sell');
check(!!trSell && !trSell.err && trSell.ret === trF.b &&
      trSell.after === expectRes(trSell.before, { food: JSON.parse(trSell.before).food - 100,
        gold: JSON.parse(trSell.before).gold + AoE2.BLD.market.trade.sell }),
  "trade: selling 100 food pays the row's 33 gold",
  !trSell ? 'no 2x2 site for the market'
    : trSell.err ? 'trade threw ' + trSell.err
      : 'res ' + trSell.after + ' (was ' + trSell.before + '), returned ' +
        (trSell.ret === trF.b ? 'the market' : String(trSell.ret)));
const trBuy = trF && tradeTry(trF.st, trF.b, 'wood', 'buy');
check(!!trBuy && !trBuy.err && trBuy.ret === trF.b &&
      trBuy.after === expectRes(trBuy.before, { gold: JSON.parse(trBuy.before).gold - AoE2.BLD.market.trade.buy,
        wood: JSON.parse(trBuy.before).wood + 100 }),
  "trade: buying 100 wood costs the row's 67 gold",
  !trBuy ? 'no 2x2 site for the market'
    : trBuy.err ? 'trade threw ' + trBuy.err
      : 'res ' + trBuy.after + ' (was ' + trBuy.before + '), returned ' +
        (trBuy.ret === trF.b ? 'the market' : String(trBuy.ret)));
/* Selling must never drive a stockpile negative, and buying must never take
   gold it does not have: both are refused with the res object field-for-field
   identical, so no partial spend can hide in either direction. */
refusal('trade: selling 100 wood with 40 in the stockpile is refused',
  trF && tradeTry(trF.st, trF.b, 'wood', 'sell', { wood: 40 }), 'Not enough wood');
refusal('trade: buying 100 stone with 20 gold is refused',
  trF && tradeTry(trF.st, trF.b, 'stone', 'buy', { gold: 20 }), 'Not enough gold');
refusal('trade: a Dark Age market cannot trade',
  (() => { const f = marketAt(0, 1); return f && tradeTry(f.st, f.b, 'food', 'sell'); })(),
  'Market requires Feudal Age');
refusal('trade: a market still under construction cannot trade',
  (() => { const f = marketAt(1, 0.4); return f && tradeTry(f.st, f.b, 'food', 'sell'); })(),
  'Still building');
const trBar = (() => {
  if (!trF) return null;
  const s = freeSpotAround(trF.st.world, trF.st, tOf(trF.b.x + 2 * AoE2.CFG.TILE), tOf(trF.b.y), 2, 2, 8);
  if (!s) return null;
  const b = AoE2.makeBuilding(trF.st, 'barracks', 0, s.tx, s.ty);
  b.built = 1;
  return b;
})();
refusal('trade: a barracks cannot trade',
  trBar && tradeTry(trF.st, trBar, 'food', 'sell'), 'Barracks cannot trade');

report();
