'use strict';
/* checks/05-construction.js -- construction, camps + drop-offs, cancel / demolish, the
   barricade, every row's age gate, the tower upgrade chain. Runs on its own
   (`node tools/checks/05-construction.js`) against a freshly booted game. */

const {
  AoE2, DT, Game, blueVill, check, dataBuildings, flatState, freeSpotAround, pad, setTile, stepRender,
  tOf, tc, report,
} = require('../lib/harness');

/* ---- 7. construction ------------------------------------------------ */
const v0 = blueVill()[0];
const wood0 = Game.res[0].wood;
const spot = freeSpotAround(Game.world, Game, Math.floor(v0.x / AoE2.CFG.TILE), Math.floor(v0.y / AoE2.CFG.TILE), 2, 2, 8);
check(!!spot, 'site: a legal 2x2 house pad exists near the villager',
  spot ? 'tile ' + spot.tx + ',' + spot.ty : 'none found');
Game.selection = [v0.id];
const house = spot && AoE2.build(Game, 'house', spot.tx * AoE2.CFG.TILE + 4, spot.ty * AoE2.CFG.TILE + 4);
check(!!house, 'build: house placed from the selected villager', house ? house.kind + ' @' + house.tx + ',' + house.ty : 'failed');
check(house && house.tx === spot.tx && house.ty === spot.ty, 'build: placed at the requested tile (not the fallback)',
  house ? house.tx + ',' + house.ty : '-');
check(Math.floor(Game.res[0].wood) === Math.floor(wood0 - 25), 'build: exactly 25 wood spent',
  wood0 + ' -> ' + Math.floor(Game.res[0].wood));
check(house && v0.order.kind === 'build', 'build: villager reassigned to the site', v0.order.kind);
check((Game.blocks.get(house.id) || []).length === 4, 'build: occupancy registered (4 tiles)',
  String((Game.blocks.get(house.id) || []).length));
check(house.built < 1, 'build: starts under construction', 'built=' + house.built);
stepRender(Math.ceil(AoE2.BLD.house.time / DT) + 2);          // exactly the table's build time
check(house.built >= 1, 'build: reaches completion in ~' + AoE2.BLD.house.time + 's of villager work',
  'built=' + Math.round(house.built * 100) + '%');
check(house.hp === house.maxHp, 'build: hp scales with progress to full', house.hp + '/' + house.maxHp);
check(AoE2.popCap(Game, 0) === 10, 'pop: house raises the cap to 10', String(AoE2.popCap(Game, 0)));
check(AoE2.siteFree(Game, house.tx, house.ty, 2, 2) === false, 'site: occupied land rejected after building', 'rejected');

/* docs/TODO.md P1-9: `built` is a 0..1 progress fraction, not a built/not-built flag,
   and popCap read it as one — a 32 % house raised the cap from 5 to 10, so a village
   kept queueing men into a house that was not standing yet. Only a finished building
   counts. Its own state, so §7's house and its build timing stay untouched. */
const popFnd = (() => {
  const st = AoE2.createState();
  const home = st.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
  const padNear = freeSpotAround(st.world, st, home.tx, home.ty, 2, 2, 8);
  if (!padNear) return null;
  const b = AoE2.makeBuilding(st, 'house', 0, padNear.tx, padNear.ty);
  const capEmpty = AoE2.popCap(st, 0);
  b.built = 0.32;
  const capFnd = AoE2.popCap(st, 0);
  b.built = 1; b.hp = b.maxHp;
  return { capEmpty, capFnd, capDone: AoE2.popCap(st, 0) };
})();
check(!!popFnd && popFnd.capEmpty === 5 && popFnd.capFnd === 5 && popFnd.capDone === 10,
  'pop: a 32 % foundation raises no cap — only the finished house does',
  !popFnd ? 'no free 2x2 pad near the Town Center'
    : popFnd.capEmpty + ' -> ' + popFnd.capFnd + ' at 32% -> ' + popFnd.capDone + ' at 100%');

// T5 multi-build (docs/CHANGELOG.md: pickBuilder assigns the nearest idle
// villager so a second placement never yanks a builder off his first site) plus
// docs/TODO.md P0-4: a placement now drafts EVERY free villager in the selection
// — one already working a site with built < 1 is not free — and their work
// stacks in updateUnit's build branch. So the old fixture ("two sites up at
// once, one builder each") becomes "one house with the whole crew, then the
// farm the same crew releases", measured against the same house on the same
// seeded world raised by a single builder.
const villagersIn = (st) => st.units.filter((u) => u.team === 0 && u.kind === 'villager');
const crewOn = (st, bid) => st.units
  .filter((u) => u.order.kind === 'build' && u.order.b === bid).map((u) => u.id);
const stepsToBuilt = (st, b) => {                    // frames until the site is finished
  const cap = Math.ceil((AoE2.BLD[b.kind].time + 8) / DT);          // + the walk to the pad
  let steps = 0;
  while (b.built < 1 && steps < cap) { AoE2.stepGame(st, DT); steps++; }
  return steps;
};
const placeAt = (st, kind, spot) =>
  AoE2.build(st, kind, spot.tx * AoE2.CFG.TILE + 4, spot.ty * AoE2.CFG.TILE + 4);
const soloHouse = (() => {                           // the same house, one builder selected
  const st = AoE2.createState();
  const v = villagersIn(st)[0];
  if (!v) return null;
  const spot = freeSpotAround(st.world, st, tOf(v.x), tOf(v.y), 2, 2, 8);
  st.selection = [v.id];                              // pin the builder, as §7 does
  const b = spot && placeAt(st, 'house', spot);
  if (!b) return null;
  const crew = crewOn(st, b.id);
  const steps = stepsToBuilt(st, b);
  return { crew: crew.length, built: b.built, steps };
})();
const mb = (() => {                                  // ... and with the whole village selected
  const st = AoE2.createState();
  const mv = villagersIn(st);
  if (!mv.length) return null;
  const spot = freeSpotAround(st.world, st, tOf(mv[0].x), tOf(mv[0].y), 2, 2, 8);
  st.selection = mv.map((u) => u.id);                 // every villager in the village
  const house = spot && placeAt(st, 'house', spot);
  if (!house) return null;
  const crew = crewOn(st, house.id);
  const steps = stepsToBuilt(st, house);
  const farmSpot = mv.length > 1 && freeSpotAround(st.world, st, tOf(mv[1].x), tOf(mv[1].y), 2, 2, 8);
  const farm = farmSpot && placeAt(st, 'farm', farmSpot);
  return { n: mv.length, house, crew, steps, farm, toast: st.toastMsg,
           farmCrew: farm ? crewOn(st, farm.id) : [], farmSteps: farm ? stepsToBuilt(st, farm) : 0 };
})();
check(!!mb && mb.crew.length === mb.n && mb.house.built >= 1,
  'build: a placement drafts every free villager in the selection',
  !mb ? 'the house could not be placed'
    : 'crew ' + mb.crew.length + '/' + mb.n + ' builders, built ' +
      Math.round(mb.house.built * 100) + '%');
check(!!mb && !!soloHouse && soloHouse.crew === 1 && mb.house.built >= 1 &&
      soloHouse.built >= 1 && mb.steps < soloHouse.steps,
  'build: the whole crew finishes a house faster than one villager does',
  !mb || !soloHouse ? 'placement failed: ' + (!mb ? 'crew site' : 'single-builder site')
    : mb.crew.length + ' builders took ' + mb.steps + ' steps, ' + soloHouse.crew +
      ' builder took ' + soloHouse.steps);
check(!!mb && !!mb.farm && mb.farm.built >= 1 &&
      JSON.stringify(mb.farmCrew.slice().sort()) === JSON.stringify(mb.crew.slice().sort()),
  'build: the crew the finished site releases raises the next one',
  !mb ? 'the house could not be placed'
    : !mb.farm ? 'no second site (toast ' + JSON.stringify(mb.toast) + ')'
      : 'farm crew ' + mb.farmCrew.length + '/' + mb.crew.length + ', built ' +
        Math.round(mb.farm.built * 100) + '% in ' + mb.farmSteps + ' steps');

// T1 blacksmith: the BLAC row joins BLD behind an authored `age` gate -- a
// Dark Age village is refused with a toast before any villager is drafted
// (the gate runs ahead of pickBuilder), and from Feudal on the table's
// numbers are real: exactly the row's 150 wood and its 40s site.
const bsGate = (() => {
  const st = AoE2.createState();
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  const wood0 = st.res[0].wood;
  let built, threw = null;
  try { built = AoE2.build(st, 'blacksmith'); } catch (e) { threw = e; }
  return { built, threw, toast: st.toastMsg, wood: st.res[0].wood, wood0, order: v && v.order.kind };
})();
check(!bsGate.threw && bsGate.built === undefined &&
      bsGate.toast === 'Blacksmith requires Feudal Age' && bsGate.wood === bsGate.wood0,
  'build: a Dark Age settlement cannot raise a Blacksmith (Feudal only)',
  bsGate.threw ? 'threw: ' + bsGate.threw.message
    : 'built=' + String(bsGate.built) + ' toast=' + JSON.stringify(bsGate.toast) +
      ' wood=' + bsGate.wood + ' (was ' + bsGate.wood0 + ')');
const bsF = (() => {
  const st = AoE2.createState();
  st.age[0] = 1;                                // the row's own age (data/buildings.json age: 1)
  st.res[0].wood = 200;                               // START holds 100; the row costs 150
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  const spot = freeSpotAround(st.world, st, tOf(v.x), tOf(v.y), 1, 1, 8);
  st.selection = [v.id];                              // pin the builder so the walk is deterministic, as the §7 house check does
  const wood0 = st.res[0].wood;
  let b, threw = null;
  try { b = spot && AoE2.build(st, 'blacksmith', spot.tx * AoE2.CFG.TILE + 4, spot.ty * AoE2.CFG.TILE + 4); }
  catch (e) { threw = e; }
  const spent = b ? wood0 - st.res[0].wood : NaN;
  // Work only accrues once the builder reaches the site (updateUnit's build
  // branch works on arrival), so a 1x1 pad off the corner costs a short walk
  // the §7 house fixture never pays -- its 2x2 footprint reaches the builder's
  // own tile. Step to completion and compare the duration with the table's
  // time: never faster, and the walk capped at 8s (the pad is <= 8 tiles off).
  const time = AoE2.BLD.blacksmith && AoE2.BLD.blacksmith.time;
  let steps = 0;
  if (b) while (b.built < 1 && steps < Math.ceil((time + 8) / DT)) { AoE2.stepGame(st, DT); steps++; }
  return { spot, b, threw, spent, built: b ? b.built : 0, seconds: +(steps * DT).toFixed(2), time };
})();
check(!!bsF.spot && !bsF.threw && !!bsF.b && Math.round(bsF.spent) === 150 &&
      bsF.built >= 1 && bsF.seconds >= bsF.time - DT && bsF.seconds <= bsF.time + 8,
  "build: a Feudal Blacksmith costs the table's 150 wood and completes in 40s",
  !bsF.spot ? 'no free 1x1 pad near a villager'
    : bsF.threw ? 'threw: ' + bsF.threw.message
      : 'spent=' + bsF.spent + ' built in ' + bsF.seconds + 's (table ' + bsF.time + 's + walk)');

/* T1 market + watch tower (2026-11-12 market plan): the MRKT (84) and WCTW (79)
   rows join BLD behind the same authored `age: 1` gate the Blacksmith proved, and
   each is priced from its own row -- the Market's 175 wood / 60 s, the Watch
   Tower's 35 wood + 125 stone / 80 s. Both rows are `noSprite: true`, so the pair
   rides §5b3's null-sprite rule without a new assertion there. */
const darkAgeRefusal = (kind) => {
  const st = AoE2.createState();
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  const res0 = JSON.stringify(st.res[0]);
  let built, threw = null;
  try { built = AoE2.build(st, kind); } catch (e) { threw = e; }
  return { built, threw, toast: st.toastMsg, res0, res: JSON.stringify(st.res[0]), order: v && v.order.kind };
};
const mkGate = darkAgeRefusal('market');
check(!mkGate.threw && mkGate.built === undefined &&
      mkGate.toast === 'Market requires Feudal Age' && mkGate.res === mkGate.res0,
  'build: a Dark Age settlement cannot raise a Market (Feudal only)',
  mkGate.threw ? 'threw: ' + mkGate.threw.message
    : 'built=' + String(mkGate.built) + ' toast=' + JSON.stringify(mkGate.toast) +
      ' res=' + mkGate.res + ' (was ' + mkGate.res0 + ')');
const wtGate = darkAgeRefusal('watch_tower');
check(!wtGate.threw && wtGate.built === undefined &&
      wtGate.toast === 'Watch Tower requires Feudal Age' && wtGate.res === wtGate.res0,
  'build: a Dark Age settlement cannot raise a Watch Tower (Feudal only)',
  wtGate.threw ? 'threw: ' + wtGate.threw.message
    : 'built=' + String(wtGate.built) + ' toast=' + JSON.stringify(wtGate.toast) +
      ' res=' + wtGate.res + ' (was ' + wtGate.res0 + ')');
/* T1 barricade (this plan): the WALL (72) row joins BLD behind the same
   authored age: 1 gate, priced from its own row -- 3 wood / 7 s, noSprite. */
const barGate = darkAgeRefusal('barricade');
check(!barGate.threw && barGate.built === undefined &&
      barGate.toast === 'Barricade requires Feudal Age' && barGate.res === barGate.res0,
  'build: a Dark Age settlement cannot raise a Barricade (Feudal only)',
  barGate.threw ? 'threw: ' + barGate.threw.message
    : 'built=' + String(barGate.built) + ' toast=' + JSON.stringify(barGate.toast) +
      ' res=' + barGate.res + ' (was ' + barGate.res0 + ')');

/* The Feudal fixture funds exactly the data row's cost and nothing else, so
   `spent` also proves the generated BLD carries that cost (a cheaper BLD row
   would leave gold/wood behind); the site is a free pad of the row's own
   footprint within 8 tiles, and the walk is capped the way §7b's is. */
const feudalSite = (kind) => {
  const st = AoE2.createState();
  st.age[0] = 1;
  const row = dataBuildings.buildings[kind];
  const def = AoE2.BLD[kind];
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  const cost = (row && row.cost) || (def && def.cost) || {};
  if (!row || !def || !v) {                             // either side absent: report, never throw
    return { row, def, cost, spot: null, threw: null, b: null, spent: {},
             time: (def || row || {}).time, seconds: 0, built: 0 };
  }
  for (const k in cost) st.res[0][k] = cost[k];
  const spot = freeSpotAround(st.world, st, tOf(v.x), tOf(v.y), def.w, def.h, 8);
  st.selection = [v.id];                                // pin the builder, as §7 does
  const before = Object.assign({}, st.res[0]);
  let b, threw = null;
  try { b = AoE2.build(st, kind, spot.tx * AoE2.CFG.TILE + 4, spot.ty * AoE2.CFG.TILE + 4); }
  catch (e) { threw = e; }
  const spent = Object.keys(before).reduce((o, k) => Object.assign(o, { [k]: before[k] - st.res[0][k] }), {});
  let steps = 0;
  if (b) while (b.built < 1 && steps < Math.ceil((def.time + 8) / DT)) { AoE2.stepGame(st, DT); steps++; }
  return { row, def, cost, spot, threw, b, spent, time: def.time, seconds: +(steps * DT).toFixed(2),
           built: b ? b.built : 0 };
};
const exactSpend = (f) => Object.keys(f.spent).every((k) => f.spent[k] === (f.cost[k] || 0));
const siteDetail = (f) =>
  !f.row || !f.def ? [!f.row && 'data row', !f.def && 'BLD row'].filter(Boolean).join(' + ') + ' missing'
    : !f.spot ? 'no free ' + f.def.w + 'x' + f.def.h + ' pad near a villager'
      : f.threw ? 'threw: ' + f.threw.message
        : 'spent=' + JSON.stringify(f.spent) + ' (row ' + JSON.stringify(f.cost) + ') built in '
          + f.seconds + 's (table ' + f.time + 's + walk)';
const mkF = feudalSite('market');
check(!!mkF.row && !!mkF.def && !!mkF.spot && !mkF.threw && !!mkF.b && exactSpend(mkF) &&
      mkF.built >= 1 && mkF.seconds >= mkF.time - DT && mkF.seconds <= mkF.time + 8,
  "build: a Feudal Market costs the table's 175 wood and completes in 60s", siteDetail(mkF));
const wtF = feudalSite('watch_tower');
check(!!wtF.row && !!wtF.def && !!wtF.spot && !wtF.threw && !!wtF.b && exactSpend(wtF) &&
      wtF.built >= 1 && wtF.seconds >= wtF.time - DT && wtF.seconds <= wtF.time + 8,
  "build: a Feudal Watch Tower costs the table's 35 wood + 125 stone and completes in 80s",
  siteDetail(wtF));
const barF = feudalSite('barricade');
check(!!barF.row && !!barF.def && !!barF.spot && !barF.threw && !!barF.b && exactSpend(barF) &&
      barF.built >= 1 && barF.seconds >= barF.time - DT && barF.seconds <= barF.time + 8,
  "build: a Feudal Barricade costs the table's 3 wood and completes in 7s", siteDetail(barF));

/* ---- 7b. camps + drop-off routing (v2 task 3) ----------------------- */
// Lumber/Mining camps and the Mill join BLD at their AoE2 costs and sizes, and
// a carrying villager must walk to the DEDICATED building for what they carry
// instead of always trudging to the Town Center.
const cg = AoE2.createState();
cg.age[0] = 1;      // §7b raises a mill too, and the MILL (68) row is Feudal (data/buildings.json age: 1)
const cv = cg.units.find((u) => u.team === 0 && u.kind === 'villager');
const vt = cg.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
const dropId = (res, src) => {
  const d = AoE2.findDropoff(cg, cv, src || { kind: 'tile', res, amount: 10 });
  return d ? d.id : null;
};
check(['food', 'wood', 'gold', 'stone'].every((res) => dropId(res) === vt.id),
  'dropoff: with only a Town Center every resource walks there',
  ['food', 'wood', 'gold', 'stone'].map((res) => res + '->' + dropId(res)).join(' '));
cg.selection = [cv.id];
const woodCost = (k) => Object.values(dataBuildings.buildings[k].cost).reduce((s, v) => s + v, 0);
const secCost = ['lumber_camp', 'mining_camp', 'mill', 'farm'].reduce((s, k) => s + woodCost(k), 0);
cg.res[0].wood = secCost;   // fund exactly the four sites this section builds, priced from the table
const vTx = Math.floor(cv.x / AoE2.CFG.TILE), vTy = Math.floor(cv.y / AoE2.CFG.TILE);
const put = (kind, size) => {
  const spot = freeSpotAround(cg.world, cg, vTx, vTy, size, size, 6);
  return spot && AoE2.build(cg, kind, spot.tx * AoE2.CFG.TILE + 4, spot.ty * AoE2.CFG.TILE + 4);
};
const lc = put('lumber_camp', 1), mc = put('mining_camp', 1);
const ml = put('mill', 2), f2 = put('farm', 2);
const okShapes = lc && mc && f2 && lc.w === 1 && lc.h === 1 && mc.w === 1 && mc.h === 1 && ml && ml.w === 2 && ml.h === 2;
check(!!okShapes, 'build: camps are 1x1 and the mill is 2x2, all placeable',
  [lc && lc.w + 'x' + lc.h, mc && mc.w + 'x' + mc.h, ml && ml.w + 'x' + ml.h, f2 && f2.w + 'x' + f2.h].join(' '));
check(Math.floor(cg.res[0].wood) === 0,
  'build: every site costs exactly its table price (' +
  ['lumber_camp', 'mining_camp', 'mill', 'farm'].map((k) => k.replace('_camp', '') + ' ' + woodCost(k)).join(', ') + ' wood)',
  String(Math.floor(cg.res[0].wood)));

/* docs/TODO.md P1-9, the drop-off and farm half: before §7b declares the four sites
   finished, a 1 % Lumber Camp must not receive wood and a 5 % farm must not be worked
   (ordered or resumed) — both read the progress fraction as a flag. */
if (lc) lc.built = 0.01;
if (f2) f2.built = 0.05;
check(!!lc && dropId('wood') === vt.id,
  'dropoff: a 1 % Lumber Camp is no drop-off yet — the wood still walks to the Town Center',
  String(dropId('wood')) + ' (want ' + String(vt.id) + ')');
const farm5 = !!f2 && (() => {
  const at = { x: f2.tx * AoE2.CFG.TILE + AoE2.CFG.TILE / 2,
               y: f2.ty * AoE2.CFG.TILE + AoE2.CFG.TILE / 2 };
  return { order: JSON.stringify(AoE2.orderForUnit(cg, cv, at.x, at.y)),
           resume: JSON.stringify(AoE2.resumeGather(cg, cv, AoE2.sourceFromFarm(f2))) };
})();
check(!!farm5 && farm5.order === JSON.stringify({ kind: 'build', b: f2 && f2.id }) &&
      farm5.resume === JSON.stringify({ kind: 'idle' }),
  'farm: a 5 % farm is neither ordered nor re-worked as a harvest source',
  farm5 ? farm5.order + ' / ' + farm5.resume : 'no farm placed');
[lc, mc, ml, f2].forEach((b) => { if (b) b.built = 1; });
check(dropId('wood') === lc.id, 'dropoff: wood walks to the Lumber Camp, not the Town Center',
  String(dropId('wood')));
check(dropId('gold') === mc.id && dropId('stone') === mc.id,
  'dropoff: gold and stone walk to the Mining Camp',
  dropId('gold') + '/' + dropId('stone'));
check(dropId('food') === ml.id,
  'dropoff: food prefers the Mill over the farms and the Town Center', String(dropId('food')));
check(AoE2.findDropoff(cg, cv, AoE2.sourceFromFarm(f2)) === ml,
  'dropoff: a farm never receives its own harvest — the mill takes it',
  String((AoE2.findDropoff(cg, cv, AoE2.sourceFromFarm(f2)) || {}).kind));
check(AoE2.train(cg, mc, 'villager') === undefined && /needs a Mining Camp/.test(cg.toastMsg),
  'train: a Mining Camp trains nothing', String(cg.toastMsg));

/* ---- 7c. cancel construction + demolish (phase 2) ------------------- */
// The rule under test: cancelling an in-progress building refunds
// floor(cost × CANCEL_REFUND) and frees its builder (T3); the demolish half
// (T4) extends this section below. A throwaway state mirrors §9b's pattern so
// the shared Game keeps its §7 buildings untouched by §8.
const cs = AoE2.createState();
const cv2 = cs.units.find((u) => u.team === 0 && u.kind === 'villager');
cs.selection = [cv2.id];
const cSpot = freeSpotAround(cs.world, cs, tOf(cv2.x), tOf(cv2.y), 2, 2, 8);
const cHouse = cSpot && AoE2.build(cs, 'house', cSpot.tx * AoE2.CFG.TILE + 4, cSpot.ty * AoE2.CFG.TILE + 4);
const cWoodBt = cs.res[0].wood;                       // 25 already spent by build()
if (cHouse) cHouse.built = 0.5;                        // the half-built site of the done-criteria
const cOk = cHouse && AoE2.cancelConstruction(cs, cHouse);
check(cOk === true && !cs.buildings.includes(cHouse) && cs.res[0].wood === cWoodBt + 20 &&
      cs.blocks.get(cHouse.id) === undefined,
  'cancel: a half-built house refunds exactly 80% of its cost',
  cHouse ? cWoodBt + ' -> ' + cs.res[0].wood : 'placement failed');
check(cv2.order.kind === 'idle', 'cancel: the builder is freed to an idle order', cv2.order.kind);

// the refusal branch: a finished site answers 'Already built — use demolish'
const cSpot2 = cHouse && freeSpotAround(cs.world, cs, tOf(cv2.x), tOf(cv2.y), 2, 2, 8);
const cHouse2 = cSpot2 && AoE2.build(cs, 'house', cSpot2.tx * AoE2.CFG.TILE + 4, cSpot2.ty * AoE2.CFG.TILE + 4);
if (cHouse2) cHouse2.built = 1;
const cWoodMid = cs.res[0].wood;
const cRefuse = cHouse2 && AoE2.cancelConstruction(cs, cHouse2);
check(cRefuse === undefined && cs.toastMsg === 'Already built — use demolish' &&
      cs.buildings.includes(cHouse2) && cs.res[0].wood === cWoodMid,
  'cancel: a finished building refuses with \'Already built — use demolish\'', String(cs.toastMsg));

// the demolish half (T4): zero refund, Town Center protected, unfinished refused
const dFood0 = cs.res[0].food;
const dWood0 = cs.res[0].wood;
const dGold0 = cs.res[0].gold;
const dStone0 = cs.res[0].stone;
const dOk = cHouse2 && AoE2.demolish(cs, cHouse2);
check(dOk === true && !cs.buildings.includes(cHouse2) && cs.res[0].food === dFood0 &&
      cs.res[0].wood === dWood0 && cs.res[0].gold === dGold0 && cs.res[0].stone === dStone0,
  'demolish: a finished house is removed with zero change to the stockpile',
  JSON.stringify(cs.res[0]));
const dTc = cs.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
check(AoE2.demolish(cs, dTc) === undefined && cs.toastMsg === 'Cannot demolish a Town Center' &&
      cs.buildings.includes(dTc),
  'demolish: a Town Center cannot be demolished', String(cs.toastMsg));
const cSpot3 = cHouse && freeSpotAround(cs.world, cs, tOf(cv2.x), tOf(cv2.y), 2, 2, 8);
const cHouse3 = cSpot3 && AoE2.build(cs, 'house', cSpot3.tx * AoE2.CFG.TILE + 4, cSpot3.ty * AoE2.CFG.TILE + 4);
check(cHouse3 && AoE2.demolish(cs, cHouse3) === undefined &&
      cs.toastMsg === 'Not built yet — cancel instead' && cs.buildings.includes(cHouse3),
  'demolish: an unfinished building refuses with \'Not built yet — cancel instead\'',
  String(cs.toastMsg));

/* ---- 7d. wooden barricade (this plan, T2) --------------------------- */
// The row's whole life -- place, half-build + cancel, rebuild, finish,
// demolish -- plus its two placement refusals (occupied tile, far click),
// every number read off AoE2.BLD.barricade and CFG.CANCEL_REFUND rather
// than literals, so the fixture re-proves the T1 row on every run.
const bd = AoE2.createState();
bd.age[0] = 1;
const bdv = bd.units.find((u) => u.team === 0 && u.kind === 'villager');
const bdDef = AoE2.BLD.barricade;
const bdCost = bdDef.cost.wood;
const bdRefund = Math.floor(bdCost * AoE2.CFG.CANCEL_REFUND);
const popCapBd = AoE2.popCap(bd, 0);
bd.res[0].wood = bdCost + bdRefund;                 // fund the walk's two sites minus A's refund
bd.selection = [bdv.id];                            // pin the builder, as §7 does
const bdSpot = freeSpotAround(bd.world, bd, tOf(bdv.x), tOf(bdv.y), bdDef.w, bdDef.h, 8);
const bb = bdSpot && AoE2.build(bd, 'barricade', bdSpot.tx * AoE2.CFG.TILE + 4, bdSpot.ty * AoE2.CFG.TILE + 4);
check(!!bb && bb.w === bdDef.w && bb.h === bdDef.h &&
      (bd.blocks.get(bb.id) || []).length === bdDef.w * bdDef.h && AoE2.popCap(bd, 0) === popCapBd,
  'build: a barricade registers exactly one tile and never changes the population cap',
  bb ? bb.w + 'x' + bb.h + ' tiles=' + (bd.blocks.get(bb.id) || []).length +
     ' popCap=' + popCapBd + '->' + AoE2.popCap(bd, 0) : 'placement failed');

/* The invalid clicks (docs/TODO.md P0-3): the old code answered a click it could
   not honour -- a footprint that is not free, or a tile more than 7 tiles off the
   builder -- by moving the site to findSite's pad next to the villager while the
   toast still said "started". A click is now the site or a refusal ('Can't build
   there', nothing spent, no new building, Game.placing still armed); the 7-tile
   limit is gone, so a far click builds exactly on the tile clicked. The findSite
   fallback survives only for the button call without a tile, which the last case
   below still pins.
   Every case runs on flatState(): grass everywhere, so the only reason a pad can
   fail is the one the case is about -- the generator's ponds and forest would let
   a refusal pass for a reason nobody checked. */
const ZERO = JSON.stringify({ food: 0, wood: 0, gold: 0, stone: 0 });

/** Build `kind` at tile `where(st, v)` -- or with no tile at all, the button
 *  call -- in a flat settlement priced at exactly one site (so 'Not enough
 *  wood' can never be the reason for the answer) with the builder selected and
 *  the placement armed, and report everything the item's Done-when names. The
 *  builder's tile is read before the attempt because a new footprint moves
 *  whoever was standing on it to the work spot beside the building. */
const place = (kind, age, where) => {
  const st = flatState();
  st.age[0] = age;
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  st.selection = [v.id];                              // pin the builder, as §7 does
  const bank = { food: 0, wood: 0, gold: 0, stone: 0 };
  for (const k in AoE2.BLD[kind].cost) bank[k] = AoE2.BLD[kind].cost[k];
  st.res[0] = bank;
  const at = where(st, v);
  st.placing = at === null ? null : kind;             // arming is what a map click implies
  const banked = JSON.stringify(st.res[0]);
  const n0 = st.buildings.length;
  const vx = tOf(v.x), vy = tOf(v.y);
  let b, threw = null;
  try {
    b = at === null ? AoE2.build(st, kind)
      : AoE2.build(st, kind, at.tx * AoE2.CFG.TILE + 4, at.ty * AoE2.CFG.TILE + 4);
  } catch (e) { threw = e; }
  return { at, vx, vy, b, threw, toast: st.toastMsg, banked,
           res: JSON.stringify(st.res[0]), n0, n: st.buildings.length, placing: st.placing };
};
const refused = (r) => !r.threw && r.b === undefined && r.toast === "Can't build there" &&
  r.res === r.banked && r.n === r.n0 && r.placing !== null;
const detail = (r) => r.threw ? 'threw: ' + r.threw.message
  : 'b=' + (r.b ? r.b.kind + '@' + r.b.tx + ',' + r.b.ty : 'none') +
    ' clicked=' + (r.at ? r.at.tx + ',' + r.at.ty : 'none') + ' toast=' + JSON.stringify(r.toast) +
    ' res=' + r.banked + '->' + r.res + ' buildings=' + r.n0 + '->' + r.n +
    ' placing=' + String(r.placing);

// a footprint that is not free: water, and one of your own buildings' tiles
const water = place('barricade', 1, (st, v) => {
  const t = { tx: tOf(v.x) + 6, ty: tOf(v.y) + 6 };
  setTile(st, t.tx, t.ty, AoE2.T.WATER, 0);
  return t;
});
check(refused(water), "build: a click on water refuses with 'Can't build there' and spends nothing",
  detail(water));
const onOwn = place('barricade', 1, (st) => {
  const own = st.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
  return { tx: own.tx, ty: own.ty };
});
check(refused(onOwn),
  "build: a click on your own Town Center refuses with 'Can't build there' and spends nothing",
  detail(onOwn));
// off the map: refused, not thrown (siteFree bounds rule out the whole footprint)
const edge = place('barricade', 1, () => ({ tx: 200, ty: 200 }));
check(refused(edge), "build: a click off the map refuses with 'Can't build there' instead of throwing",
  detail(edge));
// the range limit is gone: 20 tiles away builds ON the clicked tile, not at findSite's pad
const far = place('barricade', 1, (st, v) => ({ tx: tOf(v.x) + 20, ty: tOf(v.y) }));
check(!far.threw && !!far.b && far.b.tx === far.at.tx && far.b.ty === far.at.ty &&
      far.res === ZERO && far.n === far.n0 + 1 && far.placing === null,
  'build: a click 20 tiles off the builder builds exactly on the tile clicked (no range limit)',
  detail(far));
// the one call that keeps the fallback: the button, with no tile to honour
const button = place('barricade', 1, (st, v) => null);
check(!button.threw && !!button.b && button.b.tx === button.vx && button.b.ty === button.vy &&
      button.res === ZERO && button.placing === null,
  "build: the button call (no tile) still takes findSite's pad next to the builder",
  detail(button));

// back to the walk: a stockpile of 2 wood cannot pay the row's 3.
const bdWoodA = bd.res[0].wood;
const bdBuilt0 = bd.buildings.length;
const bdRef = bdSpot && AoE2.build(bd, 'barricade', bdSpot.tx * AoE2.CFG.TILE + 4, bdSpot.ty * AoE2.CFG.TILE + 4);
check(bdRef === undefined && bd.toastMsg === 'Not enough wood' &&
      bd.res[0].wood === bdWoodA && bd.buildings.length === bdBuilt0,
  "build: 2 wood in the stockpile refuses a Barricade with 'Not enough wood'",
  String(bd.toastMsg) + ' wood=' + bd.res[0].wood + ' (was ' + bdWoodA + ')');
if (bb) bb.built = 0.5;                             // the half-built site, as §7c's cHouse
const bdCancel = bb && AoE2.cancelConstruction(bd, bb);
check(bdCancel === true && !bd.buildings.includes(bb) &&
      bd.res[0].wood === bdWoodA + bdRefund && bd.blocks.get(bb.id) === undefined &&
      bdv.order.kind === 'idle',
  'cancel: a half-built barricade refunds exactly 2 wood and frees its builder',
  bb ? bdWoodA + ' -> ' + bd.res[0].wood + ' (row refund ' + bdRefund + ') order=' + bdv.order.kind
     : 'placement failed');
const bdB = bdSpot && AoE2.build(bd, 'barricade', bdSpot.tx * AoE2.CFG.TILE + 4, bdSpot.ty * AoE2.CFG.TILE + 4);
if (bdB) bdB.built = 1;
const resBd0 = JSON.stringify(bd.res[0]);
const bdDemo = bdB && AoE2.demolish(bd, bdB);
check(bdDemo === true && !bd.buildings.includes(bdB) &&
      JSON.stringify(bd.res[0]) === resBd0 && bd.blocks.get(bdB.id) === undefined,
  'demolish: a finished barricade is removed with zero change to the stockpile',
  bdB ? JSON.stringify(bd.res[0]) + ' (was ' + resBd0 + ')' : 'rebuild failed');

/* ---- 7e. every row's age gate (docs/ROADMAP.md P1-4, age-gate half) --- */
/* The sections above gate the four rows that carried an `age` with a fixture of
   their own; data/buildings.json now names one on all twelve, so this
   table-driven pass proves `build`'s rule once per row instead of once per age
   class. Any age below a row's own refuses -- the AGES toast, the bank
   untouched, no building, the placement left armed -- and the row's own age
   raises it for exactly the cost banked before the call, so a BLD row cheaper
   than the data row leaves wood behind and fails the check. */
for (const kind of Object.keys(dataBuildings.buildings)) {
  const def = AoE2.BLD[kind];
  const where = (st, v) => freeSpotAround(st.world, st, tOf(v.x), tOf(v.y), def.w, def.h, 8);
  for (const age of def.age > 0 ? [0, def.age] : [0]) {
    const r = place(kind, age, where);
    const open = age >= def.age;
    const got = r.threw ? 'threw: ' + r.threw.message
      : r.b ? r.b.kind + '@' + r.b.tx + ',' + r.b.ty + ' res=' + r.banked + '->' + r.res
        : 'refused=' + JSON.stringify(r.toast) + ' res=' + r.banked + '->' + r.res;
    const good = open
      ? !!r.b && r.b.kind === kind && r.res === ZERO && r.n === r.n0 + 1 && r.placing === null
      : r.b === undefined && r.toast === def.label + ' requires ' + AoE2.AGES[def.age] &&
        r.res === r.banked && r.n === r.n0 && r.placing !== null;
    check(good, 'age: the ' + AoE2.AGES[age] + ' ' + (open ? 'raises' : 'refuses') + ' the ' +
      def.label + ' (row age ' + def.age + ')', got);
  }
}

/* ---- 7f. the tower upgrade chain (this plan, T2) --------------------------- */
/* One fixture per tier of the Watch Tower -> Guard Tower -> Keep chain (T1's two
   data rows, T2's command): a flat world, one villager selected and the team's
   stockpile funded with exactly the NEXT row's cost -- so a BLD row cheaper than
   the data row leaves a number behind -- plus the tier being upgraded standing at
   built 1, the `feudalSite` idiom from §7d. The site is then finished by stepping
   the sim the next row's own `time`, the same completion path every other site
   takes, so `promoteBuilding` is the only thing that can change the kind. */
const chainState = (tier, age, team = 0) => {
  const st = AoE2.createState();
  const v = st.units.filter((u) => u.team === 0 && u.kind === 'villager')[0];
  if (!v) return null;
  const at = { tx: tOf(v.x), ty: tOf(v.y) };
  st.buildings = []; st.projectiles = []; st.units = [v];
  const b = AoE2.makeBuilding(st, tier, team, at.tx, at.ty);
  b.built = 1; b.hp = b.maxHp;
  st.age[0] = age;
  st.selection = [v.id];                              // pin the builder, as §7 does
  const next = AoE2.BLD[tier].upgradesTo;
  const cost = next ? AoE2.BLD[next].cost : {};
  for (const k in st.res[team]) st.res[team][k] = 0;
  for (const k in cost) st.res[team][k] = cost[k];
  return { st, v, b, next, cost, bank: Object.assign({}, st.res[team]) };
};

/* one rung of the refusal ladder: `undefined` back, nothing spent, nothing written
   on the building, and the toast says why in the words `build` uses for the same
   class of refusal. */
const refuse = (tier, age, msg, team = 0) => {
  const f = chainState(tier, age, team);
  if (!f) return { ok: false, detail: 'no villager to stand the ' + tier + ' on' };
  let threw = null, r;
  try { r = AoE2.upgradeBuilding(f.st, f.b); } catch (e) { threw = e; }
  const res = JSON.stringify(Object.assign({}, f.st.res[team]));
  return {
    ok: !threw && r === undefined && !f.b.upgrade && f.b.kind === tier &&
        f.st.toastMsg === msg && res === JSON.stringify(f.bank),
    detail: threw ? 'threw: ' + threw.message
      : 'r=' + String(r) + ' toast=' + JSON.stringify(f.st.toastMsg) +
        ' want=' + JSON.stringify(msg) + ' res=' + res + ' bank=' + JSON.stringify(f.bank) +
        ' upgrade=' + String(f.b.upgrade) + ' kind=' + f.b.kind,
  };
};
const darkWatch = refuse('watch_tower', 0, 'Guard Tower requires Feudal Age');
check(darkWatch.ok,
  'age: a Dark Age team cannot upgrade a Watch Tower (Guard Tower requires Feudal Age)',
  darkWatch.detail);
const feudalGuard = refuse('guard_tower', 1, 'Keep requires Castle Age');
check(feudalGuard.ok, 'age: a Feudal team cannot upgrade a Guard Tower (Keep requires Castle Age)',
  feudalGuard.detail);

/* one edge walked end to time to finish, so the two ends of an edge the plan names
   separately are measured on the same tower. */
const chainEdge = (tier, age) => {
  const f = chainState(tier, age);
  if (!f) return null;
  const r = AoE2.upgradeBuilding(f.st, f.b);
  const s = { r, upgrade: f.b.upgrade, built: f.b.built, time: f.b.time,
              order: Object.assign({}, f.v.order), toast: f.st.toastMsg,
              res: Object.assign({}, f.st.res[0]) };
  const steps = Math.ceil(AoE2.BLD[f.next].time / DT) + 2;
  for (let i = 0; i < steps; i++) AoE2.stepSim(f.st, DT);
  const row = AoE2.BLD[f.next];
  return { f, s, steps, row, d: { kind: f.b.kind, maxHp: f.b.maxHp, hp: f.b.hp, w: f.b.w,
    h: f.b.h, blocks: (f.st.blocks.get(f.b.id) || []).length, atk: AoE2.unitAttack(f.st, f.b),
    pierce: AoE2.unitArmor(f.st, f.b, 'pierce'), melee: AoE2.unitArmor(f.st, f.b, 'melee'),
    upgrade: f.b.upgrade, time: f.b.time } };
};
const up1 = chainEdge('watch_tower', 1);
check(!!up1 && up1.s.r === up1.f.b && up1.s.upgrade === 'guard_tower' && up1.s.built < 1 &&
      up1.s.time === AoE2.BLD.guard_tower.time && up1.s.order.kind === 'build' &&
      up1.s.order.b === up1.f.b.id && up1.s.toast === 'Guard Tower started' &&
      JSON.stringify(up1.s.res) === ZERO,
  "upgrade: a Feudal Watch Tower spends exactly the Guard Tower row's cost and becomes " +
  'a half-built Watch Tower',
  !up1 ? 'no villager to stand the Watch Tower on'
    : 'r=' + String(up1.s.r) + ' upgrade=' + String(up1.s.upgrade) + ' built=' + up1.s.built +
      ' time=' + up1.s.time + ' order=' + JSON.stringify(up1.s.order) + ' toast=' +
      JSON.stringify(up1.s.toast) + ' res=' + JSON.stringify(up1.s.res) + ' (row ' +
      JSON.stringify(up1.f.cost) + ')');
check(!!up1 && up1.d.kind === 'guard_tower' && up1.d.maxHp === up1.row.hp &&
      up1.d.hp === up1.row.hp && up1.d.w === 1 && up1.d.h === 1 && up1.d.blocks === 1 &&
      up1.d.atk === up1.row.attack && up1.d.pierce === up1.row.pierceArmor &&
      up1.d.melee === up1.row.meleeArmor && up1.d.upgrade === null &&
      up1.d.time === up1.row.time,
  "upgrade: completing it is a Guard Tower with the row's hp, attack and armours",
  !up1 ? 'no villager to stand the Watch Tower on'
    : 'kind=' + up1.d.kind + ' hp=' + up1.d.hp + '/' + up1.d.maxHp + ' atk=' + up1.d.atk +
      ' pierce=' + up1.d.pierce + ' melee=' + up1.d.melee + ' w=' + up1.d.w + 'x' + up1.d.h +
      ' blocks=' + up1.d.blocks + ' upgrade=' + String(up1.d.upgrade) + ' time=' + up1.d.time +
      ' (row ' + JSON.stringify({ hp: up1.row.hp, attack: up1.row.attack,
        pierceArmor: up1.row.pierceArmor, meleeArmor: up1.row.meleeArmor }) + ')');
const up2 = chainEdge('guard_tower', 2);
check(!!up2 && up2.s.r === up2.f.b && up2.s.upgrade === 'keep' && up2.s.built < 1 &&
      up2.s.time === AoE2.BLD.keep.time && up2.s.order.kind === 'build' &&
      up2.s.order.b === up2.f.b.id && up2.s.toast === 'Keep started' &&
      JSON.stringify(up2.s.res) === ZERO && up2.d.kind === 'keep' &&
      up2.d.maxHp === up2.row.hp && up2.d.hp === up2.row.hp && up2.d.w === 1 &&
      up2.d.h === 1 && up2.d.blocks === 1 && up2.d.atk === up2.row.attack &&
      up2.d.pierce === up2.row.pierceArmor && up2.d.melee === up2.row.meleeArmor &&
      up2.d.upgrade === null && up2.d.time === up2.row.time,
  "upgrade: that Guard Tower upgrades to a Keep for the Keep row's cost",
  !up2 ? 'no villager to stand the Guard Tower on'
    : 'upgrade=' + String(up2.s.upgrade) + ' built=' + up2.s.built + ' time=' + up2.s.time +
      ' res=' + JSON.stringify(up2.s.res) + ' (row ' + JSON.stringify(up2.f.cost) + ') toast=' +
      JSON.stringify(up2.s.toast) + ' -> kind=' + up2.d.kind + ' hp=' + up2.d.hp + '/' +
      up2.d.maxHp + ' atk=' + up2.d.atk + ' pierce=' + up2.d.pierce);

/* The design's stepBuildingAttacks clause in words: `built < 1` never shoots, so
   a tower mid-upgrade holds fire (src/sim.js:138) -- and one frame of the
   builder's work later the same tower's arrow is the Guard Tower's own numbers.
   The fixture keeps a single builder and a single enemy, so any arrow in the air
   belongs to the tower being upgraded (the §9c/§9f way of isolating a shooter). */
const shot = (() => {
  const f = chainState('watch_tower', 1);
  if (!f) return null;
  AoE2.upgradeBuilding(f.st, f.b);
  const foe = AoE2.makeUnit(f.st, 'militia', 1, f.b.x + 3 * AoE2.CFG.TILE, f.b.y);
  f.b.cd = 0;
  AoE2.stepBuildingAttacks(f.st, DT);
  const half = { n: f.st.projectiles.length, cd: f.b.cd, built: f.b.built };
  f.b.built = 1 - DT / AoE2.BLD.guard_tower.time;      // exactly one frame of work left
  AoE2.stepSim(f.st, DT);
  f.st.projectiles = [];
  f.b.cd = 0;
  AoE2.stepBuildingAttacks(f.st, DT);
  const arrow = f.st.projectiles[0];
  return { f, foe, half, n: f.st.projectiles.length, arrow: !!arrow && arrow.t === foe,
           dmg: arrow && arrow.dmg, acc: arrow && arrow.accuracy,
           kind: f.b.kind, maxHp: f.b.maxHp };
})();
check(!!shot && shot.half.n === 0 && shot.half.built < 1 && shot.kind === 'guard_tower' &&
      shot.maxHp === AoE2.BLD.guard_tower.hp && shot.n === 1 && shot.arrow &&
      shot.dmg === AoE2.BLD.guard_tower.attack * (1 + 0.25 * shot.f.st.ageBonus[0]) &&
      shot.acc === AoE2.BLD.guard_tower.accuracy,
  'upgrade: a half-upgraded tower shoots nobody and the finished one does',
  !shot ? 'no villager to stand the Watch Tower on'
    : 'while upgrading: projectiles=' + shot.half.n + ' built=' + shot.half.built +
      ' cd=' + shot.half.cd + '; after: kind=' + shot.kind + ' n=' + shot.n +
      ' targetIsFoe=' + shot.arrow + ' dmg=' + String(shot.dmg) + ' accuracy=' + String(shot.acc) +
      ' (row ' + AoE2.BLD.guard_tower.attack + '/' + AoE2.BLD.guard_tower.accuracy + ')');

/* the two ends nobody can pass: a row with no `upgradesTo` (the Keep) and a tower
   that belongs to the other team -- the string `cancelConstruction` / `demolish`
   use for the same refusal, and the enemy's own stockpile untouched either. */
const noTier = refuse('keep', 2, 'Keep has no upgrade');
const foeSite = refuse('watch_tower', 1, 'Not your building', 1);
check(noTier.ok && foeSite.ok, 'upgrade: a Keep has no further tier and an enemy tower is ' +
  'not yours to upgrade',
  'keep: ' + noTier.detail + ' | enemy watch_tower: ' + foeSite.detail);

/* the cost is never spent when nobody can be drafted: the same pair of toasts
   `build` chooses (a team with villagers but none free says 'All villagers are
   building', an empty one 'No villager available'). */
const noVill = (() => {
  const f = chainState('watch_tower', 1);
  if (!f) return null;
  f.st.units = [];                                     // nobody left to draft
  const r = AoE2.upgradeBuilding(f.st, f.b);
  return { f, r, toast: f.st.toastMsg, res: Object.assign({}, f.st.res[0]) };
})();
check(!!noVill && noVill.r === undefined && noVill.toast === 'No villager available' &&
      JSON.stringify(noVill.res) === JSON.stringify(noVill.f.bank) &&
      !noVill.f.b.upgrade && noVill.f.b.kind === 'watch_tower',
  'upgrade: with no villager to spare the cost is never spent',
  !noVill ? 'no villager to stand the Watch Tower on'
    : 'r=' + String(noVill.r) + ' toast=' + JSON.stringify(noVill.toast) + ' res=' +
      JSON.stringify(noVill.res) + ' bank=' + JSON.stringify(noVill.f.bank) +
      ' upgrade=' + String(noVill.f.b.upgrade));

/* Cancel mid-upgrade -- the hole the design closes: the plain rule would refund the
   standing tier's 80 % and delete a finished tower, so the upgrade branch refunds
   the tier being paid for and puts the Watch Tower back at built 1 rather than
   calling removeBuilding. */
const canc = (() => {
  const f = chainState('watch_tower', 1);
  if (!f) return null;
  AoE2.upgradeBuilding(f.st, f.b);
  const mid = Object.assign({}, f.st.res[0]);
  const r = AoE2.cancelConstruction(f.st, f.b);
  return { f, r, mid, res: Object.assign({}, f.st.res[0]), toast: f.st.toastMsg,
           standing: f.st.buildings.indexOf(f.b) >= 0, order: Object.assign({}, f.v.order) };
})();
check(!!canc && canc.r === true && canc.f.b.upgrade === null && canc.f.b.built === 1 &&
      canc.f.b.kind === 'watch_tower' && canc.f.b.hp === canc.f.b.maxHp &&
      canc.f.b.maxHp === AoE2.BLD.watch_tower.hp && canc.standing &&
      canc.res.wood === Math.floor(AoE2.BLD.guard_tower.cost.wood * AoE2.CFG.CANCEL_REFUND) &&
      canc.res.stone === Math.floor(AoE2.BLD.guard_tower.cost.stone * AoE2.CFG.CANCEL_REFUND) &&
      canc.res.food === 0 && canc.res.gold === 0 && canc.order.kind === 'idle' &&
      canc.toast === 'Guard Tower upgrade cancelled',
  'cancel: cancelling an in-progress upgrade refunds 80% of the tier under ' +
  'construction and keeps the Watch Tower standing',
  !canc ? 'no villager to stand the Watch Tower on'
    : 'r=' + String(canc.r) + ' upgrade=' + String(canc.f.b.upgrade) + ' built=' +
      canc.f.b.built + ' hp=' + canc.f.b.hp + '/' + canc.f.b.maxHp + ' standing=' +
      canc.standing + ' res=' + JSON.stringify(canc.res) + ' (mid-upgrade ' +
      JSON.stringify(canc.mid) + ', row refund ' +
      Math.floor(AoE2.BLD.guard_tower.cost.wood * AoE2.CFG.CANCEL_REFUND) + ' W / ' +
      Math.floor(AoE2.BLD.guard_tower.cost.stone * AoE2.CFG.CANCEL_REFUND) + ' S) toast=' +
      JSON.stringify(canc.toast));

report();
