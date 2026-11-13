'use strict';
/* sim -- the fixed simulation step: per-unit update, combat, projectiles. No DOM. */

/** One fixed simulation step. Pure logic, no DOM. */
function stepSim(Game, dt) {
  Game.time += dt;
  if (Game.result) return;                 // game over: camera and rendering keep running, nothing moves

  for (const b of Game.buildings) {
    if (b.built < 1 || !b.queue.length) continue;
    b.queue[0].t -= dt;
    while (b.queue.length && b.queue[0].t <= 0) {
      const job = b.queue.shift();
      const p = workPos(Game, b, null);          // a unit with no position yet: the ring's first tile
      makeUnit(Game, job.kind, b.team, p.x, p.y);
      markDirty(Game);                     // a unit appearing is a change the sim made
      if (!b.queue.length) break;
    }
  }

  for (const b of Game.buildings) {              // one research slot per finished building
    if (b.built < 1 || !b.research) continue;
    b.research.t -= dt;
    if (b.research.t <= 0) {
      const done = b.research.id;
      Game.techs[b.team].add(done);
      markDirty(Game);                     // a finished tech is a change the sim made
      toast(Game, TECHS[done].label + ' researched');
      b.research = null;
    }
  }

  for (const u of Game.units.slice()) updateUnit(Game, u, dt);
  separate(Game);
  stepBuildingAttacks(Game, dt);              // built shooters (Town Center) fire
  updateProjectiles(Game, dt);               // arrows in flight resolve and vanish

  if (Game.units.some(u => u.dead)) {
    Game.units = Game.units.filter(u => !u.dead);
    markDirty(Game);                       // a death is a change the sim made
    Game.selection = Game.selection.filter(id => Game.units.some(u => u.id === id));
  }

  aiStep(Game, dt);
}

/* ---- combat math ---- */

/** The attack an attacker deals: the row's number scaled by its own team's age
 * bonus, plus that team's researched techs' attack for the damage class it uses —
 * per-team age / ageBonus / techs (docs/TODO.md P1-11) so the player's age-ups and
 * Forge never arm an enemy. A unit uses KINDS and gets techs; a built building uses
 * BLD.attack and never gets a unit tech. Class: 'ranged' units and building arrows
 * are pierce, else melee — the one place attack math lives (swing and arrow). */
function unitAttack(Game, u) {
  const isUnit = u.atk !== undefined;                     // units carry atk, buildings don't
  const table = isUnit ? u.atk : BLD[u.kind].attack;
  const cls = !isUnit || u.atkType === 'ranged' ? 'pierce' : 'melee';
  const atk = table * (1 + 0.25 * Game.ageBonus[u.team]); // the attacker's own age scaling
  if (!isUnit) return atk;
  let total = atk;
  for (const id of Game.techs[u.team]) total += TECHS[id].atk[cls];
  return total;
}

/** Armour a defender has against 'melee' or 'pierce' damage: the table row's own
 * armour, plus the armour of the techs its OWN team researched, for unit defenders
 * (building rows have armour, unit techs never apply to them, nor to another team). */
function unitArmor(Game, u, type = 'melee') {
  const isUnit = u.atk !== undefined;
  const row = isUnit ? KINDS[u.kind] : BLD[u.kind];
  let armor = type === 'pierce' ? row.pierceArmor : row.meleeArmor;
  if (!isUnit) return armor;
  for (const id of Game.techs[u.team]) armor += TECHS[id].armor[type];
  return armor;
}

/** Apply damage to a unit - unitArmor softens the hit but never absorbs it
 * below 1 - clamped at 0; returns true if it died. The damage type defaults
 * to the 'melee' a plain swing deals. */
function hitUnit(Game, u, dmg, type = 'melee') {
  playSfx(Game, 'hit');
  u.hp -= Math.max(1, dmg - unitArmor(Game, u, type));
  if (u.hp > 0) return false;
  u.hp = 0;
  u.dead = true;
  return true;
}

/* --------------------------- projectiles (ranged) --------------------------- */

/** One arrow in flight. `from` is the shooter - a unit, or a built building whose
 *  numbers then come from BLD the way hitBuilding reads them - and `target` is the
 *  exact unit or building the arrow is bound to: it never switches marks and can
 *  only ever hit once, so a kill mid-flight cannot splash onto the next body.
 *  Pure logic, no DOM. */
function spawnArrow(Game, from, target) {
  playSfx(Game, 'arrow');
  const accuracy = from.atk === undefined ? BLD[from.kind].accuracy : from.accuracy;
  const dx = target.x - from.x, dy = target.y - from.y, d = Math.hypot(dx, dy) || 1;
  const p = { x: from.x, y: from.y, team: from.team, t: target, dx: dx / d, dy: dy / d,
              dmg: unitAttack(Game, from), accuracy };
  Game.projectiles.push(p);
  return p;
}

/** Fly every arrow one step toward its mark (CFG.PROJ_SPEED px/s) and resolve the
 *  ones that arrive: the table accuracy rolled on Game.rnd decides whether the hit
 *  lands, hitUnit/hitBuilding applies it, and the arrow is gone either way - a dead
 *  mark swallows the shot. Runs before stepSim's dead-unit cleanup. */
function updateProjectiles(Game, dt) {
  const step = CFG.PROJ_SPEED * dt;
  for (let i = Game.projectiles.length - 1; i >= 0; i--) {
    const p = Game.projectiles[i];
    const t = p.t;
    if (!t || t.hp <= 0 || (t.dead !== undefined && t.dead)) {  // the mark is gone
      Game.projectiles.splice(i, 1);
      continue;
    }
    const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1;
    const isB = t.r === undefined;                              // unit (has r) vs building
    if (d <= (isB ? reachOf(t) : t.r) + step) {                  // arrived: resolve, vanish
      Game.projectiles.splice(i, 1);
      if (Game.rnd() * 100 < p.accuracy) {
        if (isB) hitBuilding(Game, t, p.dmg, 'pierce'); else hitUnit(Game, t, p.dmg, 'pierce');
      }
      continue;
    }
    p.dx = dx / d; p.dy = dy / d;                                // the lerp and the heading
    p.x += p.dx * step; p.y += p.dy * step;
  }
}

/** Built buildings whose row carries an attack shoot the nearest enemy unit inside
 *  their table line of sight, on their table reload - the same arrow path (T5). */
function stepBuildingAttacks(Game, dt) {
  for (const b of Game.buildings) {
    if (b.built < 1 || !BLD[b.kind].attack) continue;
    b.cd = Math.max(0, (b.cd || 0) - dt);
    if (b.cd > 0) continue;
    let best = null, bd = Infinity;
    for (const u of Game.units) {
      if (u.dead || u.team === b.team) continue;
      const d = Math.hypot(u.x - b.x, u.y - b.y);
      if (d <= BLD[b.kind].lineOfSight * CFG.TILE && d < bd) { bd = d; best = u; }
    }
    if (!best) continue;
    b.cd = BLD[b.kind].reload || 1;
    spawnArrow(Game, b, best);
  }
}

/** Apply damage to a building - unitArmor softens the hit but never absorbs
 * it below 1 - ; at 0 hp it is razed and removed from the world. The damage
 * type defaults to the 'melee' a plain swing deals. */
function hitBuilding(Game, b, dmg, type = 'melee') {
  b.hp -= Math.max(1, dmg - unitArmor(Game, b, type));
  if (b.hp > 0) return false;
  b.hp = 0;
  const removed = removeBuilding(Game, b);
  toast(Game, b.team === 0 ? BLD[b.kind].label + ' destroyed'
                           : 'Razed enemy ' + BLD[b.kind].label.toLowerCase());
  return removed;
}

/** What an idle fighter sees: the nearest enemy unit within ACQUIRE tiles, else
 *  the nearest enemy building within BUILDING_ACQUIRE — any progress counts, the
 *  rule being attackableAsEnemy. Villagers (atk 3) never start fights. */
function autoAcquire(Game, u) {
  if (u.kind === 'villager') return null;
  const RU = (KINDS[u.kind].range || 0) > 0 ? KINDS[u.kind].range * CFG.TILE   /* the table's own reach */
                                             : CFG.ACQUIRE * CFG.TILE;          /* melee: the authored radius */
  let bestUnit = null, du = Infinity;
  for (const v of Game.units) {
    if (v.team === u.team || v.dead) continue;
    const d = Math.hypot(v.x - u.x, v.y - u.y);
    if (d <= RU && d < du) { du = d; bestUnit = v; }
  }
  if (bestUnit) return { kind: 'attack', target: bestUnit.id };
  const RB = CFG.BUILDING_ACQUIRE * CFG.TILE;
  let bestB = null, db = Infinity;
  for (const b of Game.buildings) {
    if (!attackableAsEnemy(b, u.team)) continue;
    const d = Math.hypot(b.x - u.x, b.y - u.y);
    if (d <= RB && d < db) { db = d; bestB = b; }
  }
  return bestB ? { kind: 'attack', b: bestB.id } : null;
}

function updateUnit(Game, u, dt) {
  if (u.dead) return;
  const o = u.order;

  if (o.kind === 'idle') {
    const spot = autoAcquire(Game, u);          // standing still: take the nearest fight
    if (spot) u.order = spot;
    return;
  }

  if (o.kind === 'move') {
    // arrived, or the order has no route at all (u.path still null after the
    // routing attempt in moveUnit): either way the order is over, and the
    // formation tile it marched to goes back on the market for the next order —
    // holding it while idle is what would make a past formation block a new one.
    if (moveUnit(Game, u, o.x, o.y, dt) || u.path === null) { u.order = { kind: 'idle' }; u.slot = null; }
    return;
  }

  if (o.kind === 'attack') {
    const isB = o.b !== undefined;              // o.b: attack a building, o.target: a unit
    const t = isB ? Game.buildings.find(x => x.id === o.b)
                  : Game.units.find(x => x.id === o.target);
    if (!t || (!isB && t.dead)) {               // target gone: snap to the next one
      u.order = autoAcquire(Game, u) || { kind: 'idle' };
      return;
    }
    /* The table decides how far a fighter fights from and how often it hits: a
     * ranged unit halts at `range` tiles and every `reload` seconds looses an
     * arrow; a melee one walks to contact and swings every `atkTime`. The route ends
     * on the tile standTarget picks for the target — the enemy's own tile, or a tile
     * of a building's reach ring — and he stops at the table's radius from it, so an
     * archer shooting a Tower never walks onto its footprint. */
    const ranged = u.atkType === 'ranged';
    const contact = isB ? reachOf(t) : u.r + t.r + 4;
    const stopR = ranged ? Math.max(u.range * CFG.TILE, contact) : contact;
    const at = standTarget(Game, u, t.x, t.y, stopR);
    if (!at) { u.order = { kind: 'idle' }; return; }        // nowhere to stand: no fight
    if (moveUnit(Game, u, at.x, at.y, dt, stopR)) {
      u.cd -= dt;
      if (u.cd <= 0) {
        u.cd = ranged ? (u.reload || u.atkTime) : u.atkTime;     // the table's cadence
        if (ranged) spawnArrow(Game, u, t);                       // the hit lands on arrival
        else {
          const dmg = unitAttack(Game, u);
          if (isB) hitBuilding(Game, t, dmg, 'melee'); else hitUnit(Game, t, dmg, 'melee');
        }
      }
    }
    return;
  }

  if (o.kind === 'build') {
    const b = Game.buildings.find(x => x.id === o.b);
    if (!b || b.built >= 1) { u.order = { kind: 'idle' }; return; }
    const at = standTarget(Game, u, b.x, b.y, CFG.TILE);    // the site's ring tile (was workPos)
    if (!at) { u.order = { kind: 'idle' }; return; }        // no way to reach the site
    if (!moveUnit(Game, u, at.x, at.y, dt, CFG.TILE)) return;
    o.atSite = true;                               // at the site: render.js plays his work pose
    b.built = Math.min(1, b.built + dt / Math.max(0.5, b.time));
    b.hp = Math.max(1, Math.round(b.maxHp * b.built));
    if (b.built >= 1) {
      b.built = 1;
      playSfx(Game, 'build');
      if (u.team === 0) toast(Game, BLD[b.kind].label + ' complete');
      u.order = { kind: 'idle' };
    }
    return;
  }

  if (o.kind === 'go_deposit') {
    const drop = Game.buildings.find(x => x.id === o.b);
    if (!drop) { u.carry = 0; u.order = { kind: 'idle' }; return; }
    const at = standTarget(Game, u, drop.x, drop.y, reachOf(drop));
    if (!at) { u.carry = 0; u.order = { kind: 'idle' }; return; }
    if (!moveUnit(Game, u, at.x, at.y, dt, reachOf(drop))) return;
    deposit(Game, u, drop);
    u.order = o.src ? resumeGather(Game, u, o.src) : { kind: 'idle' };
    return;
  }

  if (o.kind === 'harvest') {
    const src = o.src;
    const reach = CFG.TILE * 0.9;
    // the tile he works from, not the resource's centre: standTarget answers with
    // the source's own tile (a farm cell) or its walkable neighbour (a berry).
    const at = standTarget(Game, u, src.x, src.y, reach);
    if (!at) { u.order = { kind: 'idle' }; return; }
    if (Math.hypot(at.x - u.x, at.y - u.y) > reach) {
      if (!moveUnit(Game, u, at.x, at.y, dt, reach)) return;
    }
    const tick = 1 / CFG.GATHER_RATE;
    u.work += dt;
    while (u.work >= tick) {
      u.work -= tick;
      const room = CFG.CARRY_MAX - u.carry;
      if (room <= 0 || src.amount <= 0) break;
      const got = Math.min(room, src.amount, tick * CFG.GATHER_RATE);
      src.amount -= got;
      u.carry += got;
      u.carryRes = src.res;               // the dropoff needs to know what this is
    }
    if (u.carry >= CFG.CARRY_MAX || src.amount <= 0) {
      // the pool is gone: retire the tile the same tick, before choosing the next one
      if (src.kind === 'tile' && src.amount <= 0) depleteTile(Game, src.tx, src.ty);
      const drop = findDropoff(Game, u, src);
      if (!drop) { u.carry = 0; u.order = { kind: 'idle' }; return; }
      u.order = { kind: 'go_deposit', b: drop.id, src: nextSource(Game, u, src) };
    }
    return;
  }
}

/** The rule for pointing a weapon at a hostile building, written once
 *  (docs/TODO.md P1-9): a building of another team is attackable at ANY progress —
 *  a 0 % foundation included, the way AoE2 does it — because `b.built` is a 0..1
 *  progress fraction, not a built/not-built flag. A player's OWN buildings follow
 *  the other half of the same rule and count for population, drop-off and work only
 *  at `built >= 1` (`popCap`/`findDropoff`/`resumeGather` in src/economy.js, the
 *  farm case and `decodeOrder`). The four call sites that used to test the fraction
 *  as a boolean — orderForUnit, issueOrder, autoAcquire and aiStep's live-order
 *  check — now all read this one, so an unfinished enemy building is never invisible
 *  to a sword again. */
function attackableAsEnemy(b, team) {
  return !!b && b.team !== team;
}
