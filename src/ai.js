'use strict';
/* ai -- the enemy village: trains, gathers and attacks through the same commands. No DOM. */

function aiStep(Game, dt) {
  if (!Game.started) return;
  Game.wave += dt;
  if (Game.wave < CFG.WAVE_EVERY) return;
  Game.wave = 0;
  const tc = Game.buildings.find(b => b.team === 1 && b.built);
  if (!tc) return;

  if (popUsed(Game, 1) >= popCap(Game, 1)) {
    /* pop is full: send every idle warrior at the closest blue unit */
    const prey = nearestEnemy(Game, 1);
    let sent = 0;
    for (const u of Game.units) {
      if (u.team !== 1 || u.kind !== 'militia' || u.dead) continue;
      const o = u.order;
      const live = o.kind === 'attack' && (o.b !== undefined
        ? Game.buildings.some(z => z.id === o.b)
        : Game.units.some(z => z.id === o.target && !z.dead));
      if (live) continue;
      if (!prey) continue;
      u.order = { kind: 'attack', target: prey.id };
      sent++;
    }
    if (sent) toast(Game, 'Red attack wave!');
    return;
  }
  if (tc.queue.length) return;
  if (popUsed(Game, 1) < 5 && canAfford(Game, 1, KINDS.villager.cost)) queueTrain(Game, tc, 'villager');
  else if (canAfford(Game, 1, KINDS.militia.cost)) queueTrain(Game, tc, 'militia');
}

function nearestEnemy(Game, team) {
  let best = null, bd = Infinity;
  for (const u of Game.units) {
    if (u.team === team || u.dead) continue;
    const home = Game.buildings.find(b => b.team === team && b.built);
    if (!home) return u;
    const d = (u.x - home.x) ** 2 + (u.y - home.y) ** 2;
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}

function queueTrain(Game, bld, kind) {
  spend(Game, bld.team, KINDS[kind].cost);
  bld.queue.push({ kind, t: KINDS[kind].time });
}
