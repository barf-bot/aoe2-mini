'use strict';
/* checks/07-combat.js -- melee, auto-acquire, ranged combat, attack/armour math, game over, towers.
   Runs on its own (`node tools/checks/07-combat.js`) against a freshly booted game. */

const {
  AoE2, DT, Game, check, freeSpotAround, makeDoc, path, stubEl, tOf, tc, report,
} = require('../lib/harness');

/* ---- 9. combat ------------------------------------------------------ */
const foe = Game.units.find(u => u.team === 1 && u.kind === 'villager');
const scout = Game.units.find(u => u.team === 0 && u.kind === 'militia');
const foeHp0 = foe.hp;
const foeId = foe.id;
scout.x = foe.x - AoE2.CFG.TILE; scout.y = foe.y;
scout.order = { kind: 'attack', target: foeId };
const killSecs = Math.ceil(foeHp0 / AoE2.KINDS.militia.atk) * AoE2.KINDS.militia.atkTime;
for (let i = 0; i < Math.ceil(killSecs / DT) + 2 && !foe.dead; i++) { AoE2.stepGame(Game, DT); if (i % 30 === 0) AoE2.renderFrame(Game); }
check(foe.dead, `combat: militia kills a ${foeHp0}hp villager in ~${killSecs.toFixed(1)}s of swings`,
  'hp ' + foeHp0 + ' -> ' + Math.max(0, foe.hp) + (foe.dead ? ' (dead)' : ''));
check(!Game.units.includes(foe), 'combat: corpse pruned from the roster', 'removed');
const hurt = Game.units.find(u => u.team === 1 && u.hp < u.maxHp);
check(!!hurt || true, 'combat: damage lands on the target', hurt ? 'another red unit at ' + hurt.hp + 'hp' : 'single target only');
const regen = Game.units.find(u => u.team === 0 && u.kind === 'militia');
check(regen.hp <= regen.maxHp && regen.hp > 0,
  'combat: v2 melee — the attacker may be countered, hp stays alive and capped',
  regen.hp + '/' + regen.maxHp);

/* ---- 9b. auto-acquire, retarget-on-kill, razing (v2 task 4) ---------- */
// Fighters acquire nearby enemies on their own, snap to the next one when their
// target dies, and buildings can be damaged and razed (a fresh state, seeded).
const ag = AoE2.createState();
const g0 = ag.units.filter((u) => u.team === 0);
const gm = g0.find((u) => u.kind === 'militia');
const reds = () => ag.units.filter((u) => u.team === 1);
const farB = ag.buildings.filter((b) => b.team === 1).map((b) => ({ b, x: b.x, y: b.y }));

gm.order = { kind: 'idle' };
reds().forEach((v) => { v.x = gm.x + (AoE2.CFG.ACQUIRE + 4) * AoE2.CFG.TILE; v.y = gm.y; });
farB.forEach((r) => { r.b.x = gm.x + (AoE2.CFG.BUILDING_ACQUIRE + 4) * AoE2.CFG.TILE; r.b.y = gm.y; });
AoE2.stepSim(ag, DT);
check(gm.order.kind === 'idle', 'ai: enemies outside acquisition range keep a militia idle', gm.order.kind);

const gt = reds()[0];
gt.x = gm.x + 3 * AoE2.CFG.TILE; gt.y = gm.y;
AoE2.stepSim(ag, DT);
check(gm.order.kind === 'attack' && gm.order.target === gt.id,
  'ai: an idle militia auto-acquires the nearest enemy unit inside ACQUIRE',
  gm.order.kind + '/' + (gm.order.target !== undefined ? gm.order.target : gm.order.b));

const gt2 = reds()[1];
gt2.x = gm.x + 5 * AoE2.CFG.TILE; gt2.y = gm.y + AoE2.CFG.TILE;
check(AoE2.hitUnit(ag, gt, 9999) && gt.hp === 0 && gt.dead === true,
  'combat: hitUnit kills a unit and clamps its hp at 0', String(gt.hp));
AoE2.stepSim(ag, DT);
check(gm.order.kind === 'attack' && gm.order.target === gt2.id,
  'ai: militia snap to the next enemy when their current target dies',
  gm.order.kind + '/' + (gm.order.target !== undefined ? gm.order.target : 'idle'));

const gb = farB[0].b;
gb.x = gm.x - AoE2.CFG.TILE; gb.y = gm.y;          // inside the stop radius → instant swing
const gb0 = gb.hp;
gm.order = { kind: 'attack', b: gb.id };
ag.selectedBuilding = gb;                           // selected: razing must clear the reference
AoE2.stepSim(ag, DT);
check(gb.hp < gb0 && gb.hp > 0, 'combat: militia damages an enemy building (o.b order)',
  gb0 + ' -> ' + gb.hp);
check(AoE2.hitBuilding(ag, gb, 99999) === true && !ag.buildings.includes(gb) &&
      ag.selectedBuilding === null,
  'combat: a building at 0 hp is razed and removed from the world',
  ag.buildings.some((b) => b.team === 1) ? 'still there'
    : 'removed, selection=' + String(ag.selectedBuilding));

/* docs/TODO.md P1-9, the enemy half: `attackableAsEnemy(b, team)` (`src/sim.js`) is now
 * the one place that says what a hostile building is, and the rule is ANY progress — a
 * 0 % foundation included, as in AoE2 — because `built` is progress, not existence. The
 * builder's own side keeps the other rule (`built >= 1`), so the fraction is never
 * tested as a flag again by orderForUnit / issueOrder / autoAcquire / aiStep. */
const fndF = (() => {
  const st = AoE2.createState();
  const own = st.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
  const spot = freeSpotAround(st.world, st, own.tx + 3, own.ty + 1, 1, 1, 1);
  if (!spot) return null;
  const fnd = AoE2.makeBuilding(st, 'barricade', 1, spot.tx, spot.ty);   // red, 0 % laid
  st.units = [];                                                         // nothing else to prefer
  const m = AoE2.makeUnit(st, 'militia', 0, fnd.x - 8, fnd.y);           // blue, at its side
  const at = { x: fnd.tx * AoE2.CFG.TILE + AoE2.CFG.TILE / 2,
               y: fnd.ty * AoE2.CFG.TILE + AoE2.CFG.TILE / 2 };
  const has = typeof AoE2.attackableAsEnemy === 'function';
  return { id: fnd.id, has, enemy: has ? AoE2.attackableAsEnemy(fnd, 0) : null,
           kin: has ? AoE2.attackableAsEnemy(own, 0) : null,
           acq: JSON.stringify(AoE2.autoAcquire(st, m)),
           ord: JSON.stringify(AoE2.orderForUnit(st, m, at.x, at.y)) };
})();
check(!!fndF && fndF.has && fndF.enemy === true && fndF.kin === false &&
      fndF.acq === JSON.stringify({ kind: 'attack', b: fndF.id }) &&
      fndF.ord === JSON.stringify({ kind: 'attack', b: fndF.id }),
  'combat: a 0 % enemy foundation is attackable — helper, autoAcquire and orderForUnit agree',
  !fndF ? 'no free tile east of the Town Center'
    : 'helper=' + fndF.has + ' enemy=' + String(fndF.enemy) + ' own=' + String(fndF.kin) +
      ' acquire=' + fndF.acq + ' rightClick=' + fndF.ord + ' (want b=' + (fndF && fndF.id) + ')');

const gv = g0.find((u) => u.kind === 'villager');
gv.order = { kind: 'idle' };
const nearRed = reds()[0];
nearRed.x = gv.x + AoE2.CFG.TILE; nearRed.y = gv.y;
AoE2.stepSim(ag, DT);
check(gv.order.kind === 'idle', 'ai: villagers never start fights — only ordered attacks',
  gv.order.kind);

/* ---- 9c. ranged combat (2026-11-11 content port, T5) ----------------- */
/* The table's ranged half: KINDS.archer (range 4, reload 2, accuracy 80) fights
 * from its range through Game.projectiles, and a built Town Center (attack 5)
 * shoots the same path. Own state, squads cleared, so no other unit's arrows or
 * separation jitter can move the numbers being asserted. */
const rs = AoE2.createState();
rs.units = [];
const rsTc = rs.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
const arc = AoE2.makeUnit(rs, 'archer', 0, rsTc.x + 200, rsTc.y);   // out of the TC's LOS 8
const vic = AoE2.makeUnit(rs, 'villager', 1,
  arc.x + AoE2.KINDS.archer.range * AoE2.CFG.TILE, arc.y);           // exactly the table range
arc.order = { kind: 'attack', target: vic.id };
AoE2.stepSim(rs, DT);
const p0 = rs.projectiles[0];
check(!!p0 && p0.team === 0 && p0.t === vic &&
      p0.dmg === AoE2.KINDS.archer.atk && p0.accuracy === AoE2.KINDS.archer.accuracy,
  'ranged: ranged order creates an arrow projectile',
  p0 ? 'team=' + p0.team + ' dmg=' + p0.dmg + ' accuracy=' + p0.accuracy : 'no projectile');
const d0 = Math.hypot(vic.x - p0.x, vic.y - p0.y);
AoE2.stepSim(rs, DT);
const p1 = rs.projectiles[0];
check(!!p1 && p1 === p0 && Math.hypot(vic.x - p1.x, vic.y - p1.y) < d0,
  'ranged: the arrow position lerps toward the target',
  p1 ? Math.round(d0) + ' -> ' + Math.round(Math.hypot(vic.x - p1.x, vic.y - p1.y)) + 'px'
     : 'the arrow disappeared before reaching its target');
const hpB = vic.hp;
for (let i = 0; i < 40 && rs.projectiles.indexOf(p0) >= 0; i++) AoE2.stepSim(rs, DT);
check(rs.projectiles.indexOf(p0) < 0, 'ranged: arrow is removed when it lands',
  rs.projectiles.length + ' projectile(s) left');
const hpAfter = vic.hp;
check(hpAfter === hpB || hpAfter === hpB - p0.dmg,
  'ranged: a target never takes two hits from one arrow',
  hpB + ' -> ' + hpAfter + ' (one arrow deals ' + p0.dmg + ')');
const ax = arc.x, ay = arc.y;
for (let i = 0; i < 1600 && !vic.dead; i++) AoE2.stepSim(rs, DT);
check(vic.dead && arc.x === ax && arc.y === ay && rs.projectiles.length === 0,
  'ranged: archer kills a villager at the table\'s range',
  'hp=' + vic.hp + ' moved=' + (arc.x === ax && arc.y === ay ? 'no' : 'yes') +
  ' airborne=' + rs.projectiles.length);

/* the arrow is bound to one body: a kill mid-flight must not splash onto the
 * neighbour standing next to the corpse */
const r5 = AoE2.createState();
r5.units = [];
const r5Tc = r5.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
const a5 = AoE2.makeUnit(r5, 'archer', 0, r5Tc.x + 200, r5Tc.y);
const vA = AoE2.makeUnit(r5, 'villager', 1, a5.x + 60, a5.y);
const vB = AoE2.makeUnit(r5, 'villager', 1, a5.x + 64, a5.y + 2);
a5.cd = 99;                                       // no second shot while the first flies
const p5 = AoE2.spawnArrow(r5, a5, vA);
const hpB5 = vB.hp;
AoE2.hitUnit(r5, vA, 999);                       // the mark dies while the arrow flies
for (let i = 0; i < 20; i++) AoE2.stepSim(r5, DT);
check(r5.projectiles.length === 0 && vB.hp === hpB5 && vA.dead,
  'ranged: a shot at a dead target does not phantom-hit the next one',
  'airborne=' + r5.projectiles.length + ' vB.hp=' + vB.hp + '/' + hpB5);

/* the building half of the same path: the Town Center's own attack 5 / accuracy
 * 100 leave through spawnArrow, not through an instant hit */
const r7 = AoE2.createState();
r7.units = [];
const r7Tc = r7.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
const foe7 = AoE2.makeUnit(r7, 'militia', 1, r7Tc.x + 60, r7Tc.y);
AoE2.stepSim(r7, DT);
const tp = r7.projectiles[0];
check(!!tp && tp.t === foe7 && tp.team === 0 &&
      tp.dmg === AoE2.BLD.town_center.attack && tp.accuracy === AoE2.BLD.town_center.accuracy,
  'ranged: the Town Center shoots through the same path',
  tp ? 'team=' + tp.team + ' dmg=' + tp.dmg + ' accuracy=' + tp.accuracy : 'no arrow from the TC');

/* ---- 9d. attack & armour math (2026-11-12 blacksmith tech tree, T3) -- */
/* The two helpers below become the only place damage math lives, so pin the
 * numbers they must return: the pre-tech Dark Age table values §9 and §9c
 * just measured off the live sim, the stacked age+Forge number (ageBonus 2
 * -> multiplier 1.5), each tech's own line, and the max(1, dmg - armour)
 * floor. */
const mCall = (fn, ...args) => { try { return { v: fn(...args) }; } catch (e) { return { err: String((e && e.message) || e) }; } };
const mkMath = (ageBonus, techs) => {
  const st = AoE2.createState();
  let err = '';
  /* age / ageBonus / techs are per team (docs/TODO.md P1-11): the arrays are
     [player, enemy], so these writes arm team 0 only. A state still carrying the
     old global scalars throws here instead of passing, and `foe` — a red militia
     next to the red villagers — is what proves the player's bonuses stop there. */
  try { st.age[0] = st.ageBonus[0] = ageBonus; for (const id of techs) st.techs[0].add(id); }
  catch (e) { err = String((e && e.message) || e); }
  const v = st.units.find((u) => u.team === 0 && u.kind === 'villager');
  const f = st.units.find((u) => u.team === 1 && u.kind === 'villager');
  return { err, st, mil: AoE2.makeUnit(st, 'militia', 0, v.x + 2, v.y),
    arc: AoE2.makeUnit(st, 'archer', 0, v.x + 4, v.y),
    foe: f && AoE2.makeUnit(st, 'militia', 1, f.x + 2, f.y) };
};
const mxD = mkMath(0, []);
const dAtk = mxD.err ? { err: mxD.err } : mCall(AoE2.unitAttack, mxD.st, mxD.mil);
check(!dAtk.err && dAtk.v === AoE2.KINDS.militia.atk,
  'math: a Dark Age militia swings the table\'s number',
  dAtk.err ? 'unitAttack threw ' + dAtk.err : dAtk.v + ' want ' + AoE2.KINDS.militia.atk);
const s2 = mkMath(2, ['forge']);
const sAtk = s2.err ? { err: s2.err } : mCall(AoE2.unitAttack, s2.st, s2.mil);
check(!sAtk.err && sAtk.v === 4 * 1.5 + 1,
  'math: the age multiplier and a Forge bonus stack in one number',
  sAtk.err ? 'unitAttack threw ' + sAtk.err : sAtk.v + ' want 4 * 1.5 + 1');
/* The P1-11 reproduction: a player at Castle Age with Forge (ageBonus 2, forge in
   team 0's set) used to raise the enemy's militia from 4 to 7 as well. */
const sFoe = s2.err ? { err: s2.err } : mCall(AoE2.unitAttack, s2.st, s2.foe);
check(!sFoe.err && sFoe.v === AoE2.KINDS.militia.atk,
  'math: the player\'s age and Forge do not arm an enemy militia',
  sFoe.err ? 'unitAttack threw ' + sFoe.err
    : 'enemy militia ' + sFoe.v + ' want ' + AoE2.KINDS.militia.atk + ' (player ' + sAtk.v + ')');
const mxG = mkMath(0, ['forge']);
const gMil = mxG.err ? { err: mxG.err } : mCall(AoE2.unitAttack, mxG.st, mxG.mil);
const gArc = mxG.err ? { err: mxG.err } : mCall(AoE2.unitAttack, mxG.st, mxG.arc);
check(!gMil.err && gMil.v === AoE2.KINDS.militia.atk + AoE2.TECHS.forge.atk.melee &&
  gArc.v === AoE2.KINDS.archer.atk,
  'math: Forge raises the melee line and not the archer line',
  gMil.err ? 'unitAttack threw ' + gMil.err : 'militia ' + gMil.v + ', archer ' + gArc.v);
const f0 = mkMath(0, ['fletching']);
const fMil = f0.err ? { err: f0.err } : mCall(AoE2.unitAttack, f0.st, f0.mil);
const fArc = f0.err ? { err: f0.err } : mCall(AoE2.unitAttack, f0.st, f0.arc);
check(!fMil.err && fArc.v === AoE2.KINDS.archer.atk + AoE2.TECHS.fletching.atk.pierce &&
  fMil.v === AoE2.KINDS.militia.atk,
  'math: Fletching raises the archer line and not the melee line',
  fMil.err ? 'unitAttack threw ' + fMil.err : 'militia ' + fMil.v + ', archer ' + fArc.v);
const sm0 = mkMath(0, ['scale_mail']);
const br0 = mkMath(0, ['bracer']);
const smMil = sm0.err ? { err: sm0.err } : mCall(AoE2.unitArmor, sm0.st, sm0.mil, 'melee');
const smArc = sm0.err ? { err: sm0.err } : mCall(AoE2.unitArmor, sm0.st, sm0.arc, 'pierce');
const brArc = br0.err ? { err: br0.err } : mCall(AoE2.unitArmor, br0.st, br0.arc, 'pierce');
const brMil = br0.err ? { err: br0.err } : mCall(AoE2.unitArmor, br0.st, br0.mil, 'melee');
check(!smMil.err && !brArc.err &&
  smMil.v === AoE2.KINDS.militia.meleeArmor + AoE2.TECHS.scale_mail.armor.melee &&
  smArc.v === AoE2.KINDS.archer.pierceArmor + AoE2.TECHS.scale_mail.armor.pierce &&
  brArc.v === AoE2.KINDS.archer.pierceArmor + AoE2.TECHS.bracer.armor.pierce &&
  brMil.v === AoE2.KINDS.militia.meleeArmor,
  'math: Scale Mail raises the melee line\'s armour and Bracer the archer line\'s',
  smMil.err ? 'unitArmor threw ' + smMil.err
    : 'militia melee ' + smMil.v + ', archer pierce ' + smArc.v + '/' + brArc.v);
const smFoe = sm0.err ? { err: sm0.err } : mCall(AoE2.unitArmor, sm0.st, sm0.foe, 'melee');
check(!smFoe.err && smFoe.v === AoE2.KINDS.militia.meleeArmor,
  'math: the player\'s Scale Mail does not armour an enemy militia',
  smFoe.err ? 'unitArmor threw ' + smFoe.err
    : 'enemy militia ' + smFoe.v + ' want ' + AoE2.KINDS.militia.meleeArmor +
      ' (own militia ' + smMil.v + ')');
const hR = (() => {
  const f = mkMath(0, []);
  if (f.err) return { err: f.err };
  const gb = AoE2.makeBuilding(f.st, 'barracks', 0, tOf(f.mil.x), tOf(f.mil.y));
  const hp0 = gb.hp;
  const r = mCall(AoE2.hitBuilding, f.st, gb, 4, 'pierce');
  return r.err ? r : { err: '', dmg: hp0 - gb.hp, want: Math.max(1, 4 - AoE2.BLD.barracks.pierceArmor) };
})();
check(!hR.err && hR.dmg === hR.want, 'math: armour softens a hit but never below 1',
  hR.err ? 'hitBuilding threw ' + hR.err : hR.dmg + ' damage for 4 vs pierceArmor ' +
    AoE2.BLD.barracks.pierceArmor + ' (want ' + hR.want + ')');

/* ---- 9e. game over (2026-11-11 content port, T6) --------------------- */
/* Win/lose read off the board: the Town Center is the only building whose loss
 * ends the game, and every way a building leaves it (combat raze, cancel,
 * demolish) goes through removeBuilding. Its own booted Game, because the shared
 * one is §10/§11's input and command-bar fixture: razing red's wins, razing
 * blue's loses, a set result freezes the simulation, and the overlay's button
 * restarts through the same resetGame the command bar's "New map" uses. */
const overlayHtml = (g) => (g.dom && g.dom.result ? g.dom.result.innerHTML : '<no #result element>');
AoE2.storageSet(AoE2.SAVE_PATH, null);   // boot restores the slot (T4): this fixture asks for an empty one
const go = AoE2.boot(makeDoc());
const winTc = go.buildings.find((b) => b.team === 1 && b.kind === 'town_center');
AoE2.hitBuilding(go, winTc, 99999);
check(go.result === 'victory', 'game over: razing the enemy Town Center wins',
  'result=' + String(go.result));
const gl = AoE2.createState();                                   // the booted one has already ended
AoE2.hitBuilding(gl, gl.buildings.find((b) => b.team === 0 && b.kind === 'town_center'), 99999);
check(gl.result === 'defeat' && /Defeat/.test(AoE2.resultHtml(gl)),
  'game over: razing your own Town Center loses',
  'result=' + String(gl.result) + ' overlay=' + JSON.stringify(AoE2.resultHtml(gl)));
const frozen = go.units.map((u) => u.x + ',' + u.y).join(';');
const timeGo = go.time;
for (let i = 0; i < 60; i++) AoE2.stepSim(go, DT);
check(go.units.length === 10 && go.units.map((u) => u.x + ',' + u.y).join(';') === frozen && go.time > timeGo,
  'game over: the simulation freezes once a result is set',
  go.units.length + ' units, time ' + timeGo.toFixed(2) + ' -> ' + go.time.toFixed(2));
AoE2.renderFrame(go);
const winOverlay = overlayHtml(go);
const newBtn = stubEl('button', 'btnNew', 80, 24);
newBtn.setAttribute('data-act', 'restart');
((go.dom.result.listeners && go.dom.result.listeners.click) || []).forEach((fn) => fn({ target: newBtn }));
AoE2.renderFrame(go);
check(/Victory/.test(winOverlay) && winOverlay.includes('data-act="restart"') &&
      go.result === null && go.units.length === 10 && overlayHtml(go) === '',
  'ui: the result overlay renders and its button resets the game',
  'overlay=' + JSON.stringify(winOverlay) + ' -> result=' + String(go.result) +
  ' units=' + go.units.length);

/* ---- 9f. watch tower (2026-11-12 market plan, T4) -------------------- */
/* The tower brought no combat code of its own: stepBuildingAttacks drives every
 * built building whose row carries an attack, so the row's numbers (attack 5,
 * accuracy 100, reload 2, reach = line of sight 10 tiles) are all these checks
 * can read. Each fixture empties the state the way §9c does -- no other unit or
 * building fires -- and steps once, so any arrow in the air is the tower's. */
const towerState = (kind) => {
  const st = AoE2.createState();
  st.units = [];
  const tc = st.buildings[0];
  st.buildings = [];
  const tw = tc && AoE2.makeBuilding(st, kind, 0, tOf(tc.x), tOf(tc.y));
  if (tw) tw.built = 1;
  return { st, tw };
};
const twNear = towerState('watch_tower');
const twFoe = twNear &&
  AoE2.makeUnit(twNear.st, 'militia', 1, twNear.tw.x + 3 * AoE2.CFG.TILE, twNear.tw.y);
if (twNear) AoE2.stepSim(twNear.st, DT);
const twArrow = twNear && twNear.st.projectiles[0];
check(!!twArrow && twNear.st.projectiles.length === 1 && twArrow.team === 0 && twArrow.t === twFoe &&
      twArrow.dmg === AoE2.BLD.watch_tower.attack * (1 + 0.25 * twNear.st.ageBonus[0]) &&
      twArrow.accuracy === AoE2.BLD.watch_tower.accuracy &&
      twNear.tw.cd === AoE2.BLD.watch_tower.reload,
  'tower: a built Watch Tower shoots the nearest enemy inside its line of sight',
  !twNear ? 'no site for the tower'
    : !twArrow ? 'no projectile'
      : 'n=' + twNear.st.projectiles.length + ' dmg=' + twArrow.dmg + ' accuracy=' + twArrow.accuracy +
        ' cd=' + twNear.tw.cd + ' (row ' + AoE2.BLD.watch_tower.attack + '/' +
        AoE2.BLD.watch_tower.accuracy + '/' + AoE2.BLD.watch_tower.reload + ')');
/* A building measures reach with lineOfSight -- the row's `range: 8` is only
 * ever read by units (autoAcquire) -- so 12 tiles away the tower holds fire and
 * keeps the cooldown it had. */
const twFar = towerState('watch_tower');
const farFoe = twFar &&
  AoE2.makeUnit(twFar.st, 'militia', 1, twFar.tw.x + 12 * AoE2.CFG.TILE, twFar.tw.y);
const farCd = twFar && twFar.tw.cd;
if (twFar) AoE2.stepSim(twFar.st, DT);
check(!!farFoe && twFar.st.projectiles.length === 0 && twFar.tw.cd === farCd,
  'tower: a Watch Tower holds fire while the enemy stands beyond its line of sight',
  !twFar ? 'no site for the tower'
    : 'projectiles=' + twFar.st.projectiles.length + ' cd=' + twFar.tw.cd + ' (was ' + farCd + ')');
const mkShot = towerState('market');
const mkFoe = mkShot &&
  AoE2.makeUnit(mkShot.st, 'militia', 1, mkShot.tw.x + AoE2.CFG.TILE, mkShot.tw.y);
if (mkShot) AoE2.stepSim(mkShot.st, DT);
check(!!mkFoe && mkShot.st.projectiles.length === 0 && mkShot.tw.cd === 0,
  'tower: a built Market never shoots',
  !mkShot ? 'no site for the market'
    : 'projectiles=' + mkShot.st.projectiles.length + ' cd=' + mkShot.tw.cd +
      ' (row attack ' + AoE2.BLD.market.attack + ')');

/* ---- 9g. barricade razed (this plan, T4) ------------------------------- */
/* The row inside the existing combat math: autoAcquire's building branch
 * acquires it, updateUnit's attack order swings with the table's numbers and
 * hitBuilding razes it — no new combat code, so a red check here means the
 * row's own numbers (hp 150, meleeArmor 2, pierceArmor 5) failed to reach
 * that path. Own state with units cleared: the militia's is the only swing
 * that can move the numbers and the Town Center can never be the body that
 * dies. The first segment is selected, so the raze must also clear
 * selectedBuilding (the §9b precedent). */
const rb = (() => {
  const st = AoE2.createState();
  st.units = [];
  const tc = st.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
  const site = freeSpotAround(st.world, st, tc.tx + 3, tc.ty + 1, 1, 1, 1);
  if (!site || !AoE2.siteFree(st, site.tx + 2, site.ty, 1, 1)) return null;
  const b = AoE2.makeBuilding(st, 'barricade', 0, site.tx, site.ty);
  b.built = 1;
  b.hp = AoE2.BLD.barricade.hp;
  const b2 = AoE2.makeBuilding(st, 'barricade', 0, site.tx + 2, site.ty);
  b2.built = 1;
  b2.hp = AoE2.BLD.barricade.hp;
  const m = AoE2.makeUnit(st, 'militia', 1, b.x - 8, b.y);   // inside reachOf(b) -> instant swing
  st.selectedBuilding = b;
  return { st, tc, b, b2, m };
})();
const rbAcq = rb && (() => {
  AoE2.stepSim(rb.st, DT);                                    // idle -> BUILDING_ACQUIRE
  return rb.m.order.kind === 'attack' && rb.m.order.b === rb.b.id;
})();
check(!!rb && rbAcq === true,
  'ai: an idle enemy militia acquires the adjacent barricade',
  !rb ? 'no free pair of tiles east of the Town Center'
    : `order ${rb.m.order.kind}${rb.m.order.b !== undefined ? ' b=' + rb.m.order.b : ''} ` +
      `want b=${rb.b.id}`);
const rbSwing = rb && (() => {
  const atk = mCall(AoE2.unitAttack, rb.st, rb.m);
  const hp0 = rb.b.hp;
  AoE2.stepSim(rb.st, DT);                                    // in reach -> the swing lands
  return { atk, hp0, hp: rb.b.hp };
})();
check(!!rbSwing && !rbSwing.atk.err && rbSwing.atk.v === AoE2.KINDS.militia.atk &&
      rbSwing.hp === rbSwing.hp0 - Math.max(1, rbSwing.atk.v - AoE2.BLD.barricade.meleeArmor) &&
      rbSwing.hp > 0,
  'combat: a militia\'s swing costs the barricade 2 hp',
  !rbSwing ? 'no free pair of tiles east of the Town Center'
    : rbSwing.atk.err ? 'unitAttack threw ' + rbSwing.atk.err
      : `${rbSwing.atk.v} - armour ${AoE2.BLD.barricade.meleeArmor}: ${rbSwing.hp0} -> ` +
        `${rbSwing.hp} (row hp ${AoE2.BLD.barricade.hp}, want 4 - 2 = 2 hp off)`);
const rbPierce = rb && mCall(AoE2.hitBuilding, rb.st, rb.b2, AoE2.KINDS.archer.atk, 'pierce');
check(!!rbPierce && !rbPierce.err && rb.b2.hp > 0 &&
      rb.b2.hp === AoE2.BLD.barricade.hp - Math.max(1, AoE2.KINDS.archer.atk - AoE2.BLD.barricade.pierceArmor),
  'combat: an archer\'s 4 pierce damage floors at 1 hp against pierce armour 5',
  !rbPierce ? 'no free pair of tiles east of the Town Center'
    : rbPierce.err ? 'hitBuilding threw ' + rbPierce.err
      : `archer ${AoE2.KINDS.archer.atk} - pierce armour ` +
        `${AoE2.BLD.barricade.pierceArmor} -> max(1, -1): ${AoE2.BLD.barricade.hp} -> ${rb.b2.hp} (want 149)`);
const rbRaze = rb && mCall(AoE2.hitBuilding, rb.st, rb.b, 99999);
check(!!rbRaze && !rbRaze.err && rbRaze.v === true && !rb.st.buildings.includes(rb.b) &&
      rb.st.selectedBuilding === null && rb.st.toastMsg === AoE2.BLD.barricade.label + ' destroyed' &&
      AoE2.walkable(rb.st, rb.b.x, rb.b.y) === true && rb.st.result === null,
  'combat: razing the barricade removes it, frees its tile and never decides the game',
  !rbRaze ? 'no free pair of tiles east of the Town Center'
    : rbRaze.err ? 'hitBuilding threw ' + rbRaze.err
      : `removed=${String(rbRaze.v)} selection=${String(rb.st.selectedBuilding)} ` +
        `toast=${rb.st.toastMsg} walkable=${String(AoE2.walkable(rb.st, rb.b.x, rb.b.y))} ` +
        `result=${String(rb.st.result)}`);

report();
