'use strict';
/* commands -- everything a player (or the AI) can order: move/attack/gather, build,
   train, research, trade, garrison, age up, upgrade a building. Pure functions taking (Game, ...). No DOM. */

/** Right-click resolution for one unit: enemy > enemy building > own site (a
 *  villager works it, docs/TODO.md P0-4) > own farm > resource > move. */
function orderForUnit(Game, u, wx, wy) {
  const world = Game.world;
  if (wx < 0 || wy < 0 || wx >= world.w * CFG.TILE || wy >= world.h * CFG.TILE) return null;
  const tx = Math.floor(wx / CFG.TILE), ty = Math.floor(wy / CFG.TILE);

  const enemy = Game.units.find(v => targetableAsEnemy(v, u.team) &&
    Math.hypot(v.x - wx, v.y - wy) < CFG.TILE * 0.8);
  if (enemy) return { kind: 'attack', target: enemy.id };
  const eB = Game.buildings.find(b => attackableAsEnemy(b, u.team) &&
    tx >= b.tx && tx < b.tx + b.w && ty >= b.ty && ty < b.ty + b.h);
  if (eB) return { kind: 'attack', b: eB.id };

  if (u.kind === 'villager') {
    /* An own foundation is work, not a walking destination (docs/TODO.md P0-4):
       the old answer was a plain `move` and a site whose builder was pulled away
       or killed could never be finished. Asked before the farm and the resource
       cases, so a half-built farm — `built` 0.3 with its field already full — is
       repaired instead of worked. */
    const site = Game.buildings.find(b => b.team === u.team && b.built < 1 &&
      tx >= b.tx && tx < b.tx + b.w && ty >= b.ty && ty < b.ty + b.h);
    if (site) return { kind: 'build', b: site.id };
    const farm = Game.buildings.find(b => b.team === u.team && b.built >= 1 && b.kind === 'farm' &&
      b.field > 0 && tx >= b.tx && tx < b.tx + b.w && ty >= b.ty && ty < b.ty + b.h);
    if (farm) return { kind: 'harvest', src: sourceFromFarm(farm) };
    if (RES_OF_TILE[world.type[ty * world.w + tx]]) {
      const s = sourceFromTile(Game, u, tx, ty);
      if (s) return { kind: 'harvest', src: s };
    }
  }
  /* A route can only end on a walkable tile, so a plain right-click on a solid one
     (water, a resource the villager could not work, one of your own finished buildings)
     becomes the standing spot the order can actually reach — the same answer every
     other order kind gets from standTarget — instead of a destination the unit
     presses the shore at forever. */
  const at = standTarget(Game, u, wx, wy, CFG.TILE);
  if (!at) return null;
  return { kind: 'move', x: at.x, y: at.y };
}

/** Right-click: hand an order to everything selected — the fighters take the fight
 *  and the movers march on formation tiles, resolved once for the whole group
 *  instead of one scattered destination per unit (T4). A member the click cannot
 *  order at all (a point off the map, or a solid tile with no standing spot) is
 *  skipped: the order and the formation slot he already has stay as they were. */
function issueOrder(Game, wx, wy) {
  const sel = selectedUnits(Game);
  if (!sel.length) return;
  const enemy = Game.units.find(v => targetableAsEnemy(v, sel[0].team) &&
    Math.hypot(v.x - wx, v.y - wy) < CFG.TILE * 0.8);
  const tTx = Math.floor(wx / CFG.TILE), tTy = Math.floor(wy / CFG.TILE);
  const eB = Game.buildings.find(b => attackableAsEnemy(b, sel[0].team) &&
    tTx >= b.tx && tTx < b.tx + b.w && tTy >= b.ty && tTy < b.ty + b.h);
  const own = Game.buildings.find(b => b.team === sel[0].team && b.built >= 1 &&
    BLD[b.kind].garrisonCapacity > 0 && tTx >= b.tx && tTx < b.tx + b.w && tTy >= b.ty && tTy < b.ty + b.h);
  if (own) { garrisonUnits(Game, sel.map((u) => u.id), own); return; }
  const want = sel.map((u) => {                          // the order this unit asked for
    let o = enemy ? { kind: 'attack', target: enemy.id }
        : eB ? { kind: 'attack', b: eB.id }
        : orderForUnit(Game, u, wx, wy);
    if (!o) return null;
    if (u.kind !== 'villager' && o.kind === 'harvest') o = { kind: 'move', x: wx, y: wy };
    return o;
  });
  const slots = formationSlots(Game, sel.filter((u, i) => want[i] && want[i].kind === 'move'), wx, wy);
  const slotOf = {};
  if (slots) for (const p of slots) slotOf[p.u.id] = p.slot;
  let n = 0;
  sel.forEach((u, i) => {
    const o = want[i];
    if (!o) return;                                      // nothing to order him to: keep his order
    const slot = o.kind === 'move' ? slotOf[u.id] || null : null;  // a fight or a site owns no tile
    u.order = slot ? { ...o, x: slot.x, y: slot.y } : o;           // walk onto the tile he was given
    u.slot = slot;
    n++;
  });
  if (n) { Game.pingAt = Game.time; markDirty(Game); }
}

/** The villagers a placement drafts (T5 + docs/TODO.md P0-4): every free
 *  villager in the current selection, or — the selection holding none, the way
 *  the button call always worked — the nearest free villager of the player's
 *  own team. "Free" = not assigned to an unfinished building; a harvest or a
 *  go_deposit or move order is simply abandoned (as it always was), and a
 *  villager whose order is build on a building with built < 1 is never taken.
 *  The picker used to answer the single nearest of them, which yanked him off
 *  his first site on every new placement while the rest of a four-villager
 *  crew stood around watching one man build; the whole free crew is handed the
 *  order now — updateUnit stacks their work, so the site goes up faster and a
 *  half-built house never depends on one villager surviving. */
function pickBuilders(Game, site) {
  const free = (u) => {
    if (u.kind !== 'villager' || u.dead) return false;
    if (u.order.kind !== 'build') return true;
    const b = Game.buildings.find((z) => z.id === u.order.b);
    return !b || b.built >= 1;
  };
  const sel = selectedUnits(Game).filter(free);
  if (sel.length) return sel;
  const pool = Game.units.filter((u) => u.team === 0 && free(u));
  if (!pool.length) return [];
  if (!site) return [pool[0]];
  let best = pool[0], bd = Infinity;
  for (const u of pool) {
    const d = Math.hypot(Math.floor(u.x / CFG.TILE) - site.tx, Math.floor(u.y / CFG.TILE) - site.ty);
    if (d < bd) { bd = d; best = u; }
  }
  return [best];
}

/** Build button / click-to-place. */
function build(Game, kind, atX, atY) {
  const def = BLD[kind];
  if (Game.placing && atX === undefined) return;
  const clicked = atX !== undefined && atY !== undefined
    ? { tx: Math.floor(atX / CFG.TILE), ty: Math.floor(atY / CFG.TILE) }
    : null;
  if ((def.age ?? 0) > Game.age[0]) return toast(Game, def.label + ' requires ' + AGES[def.age]);
  const crew = pickBuilders(Game, clicked);
  if (!crew.length) return toast(Game, Game.units.some(u => u.team === 0 && u.kind === 'villager')
    ? 'All villagers are building' : 'No villager available');
  if (!canAfford(Game, 0, def.cost)) return toast(Game, 'Not enough ' + missing(Game, 0, def.cost));
  /* A click is the site or nothing (docs/TODO.md P0-3): the old answer for a
     tile it could not build on — an occupied footprint, or anything more than
     7 tiles off the builder — was to move the site to findSite's pad next to
     the villager while the toast still said 'started'. Distance stopped being
     part of the rule (the builder walks), so the clicked tile is used as given
     or the placement is refused; findSite still answers the button call, which
     has no tile to honour and has always meant "put it up near a villager". */
  const site = clicked
    ? (canPlaceAt(Game, kind, clicked.tx, clicked.ty) ? clicked : null)
    : findSite(Game.world, Math.floor(crew[0].x / CFG.TILE), Math.floor(crew[0].y / CFG.TILE), def.w);
  if (!site) return toast(Game, "Can't build there");
  spend(Game, 0, def.cost);
  const b = makeBuilding(Game, kind, 0, site.tx, site.ty);
  /* every free villager in the crew takes the order (docs/TODO.md P0-4), and none
     of them keeps a formation tile: a site owns no tile, as issueOrder rules. */
  for (const u of crew) {
    u.order = { kind: 'build', b: b.id };
    u.slot = null;
  }
  Game.placing = null;
  markDirty(Game);                         // the spend and the new site are a change
  toast(Game, def.label + ' started');
  return b;
}

/** The single rule that judges a tile a player wants to put `kind` on: the row's
 *  age gate plus a buildable footprint (`siteFree`). `build` and the placement
 *  ghost in render.js both ask it, so the ghost is never green over a tile the
 *  click would refuse (docs/TODO.md P0-3). Cost is not part of it — the ghost
 *  colours the land, not the wallet — and neither is distance: the builder
 *  walks to whatever tile was clicked. */
function canPlaceAt(Game, kind, tx, ty) {
  const def = BLD[kind];
  if (!def || (def.age ?? 0) > Game.age[0]) return false;
  return siteFree(Game, tx, ty, def.w, def.h);
}

/** Cancel an in-progress site: refund the floored CANCEL_REFUND share of the
 *  *defined* cost — the AoE2 rule refunds the whole cost, not the worked
 *  fraction — free every builder assigned to it and remove the building; an
 *  upgrade in progress refunds the tier being paid for and leaves the old one up. */
function cancelConstruction(Game, b) {
  if (!b || b.team !== 0) return toast(Game, 'Not your building');
  const upgrading = !!b.upgrade, def = BLD[upgrading ? b.upgrade : b.kind];
  if (b.built >= 1 && !upgrading) return toast(Game, 'Already built — use demolish');
  const back = {};
  for (const k in def.cost) back[k] = Math.floor(def.cost[k] * CFG.CANCEL_REFUND);
  refund(Game, b.team, back);
  for (const u of Game.units) {
    if (!u.dead && u.order.kind === 'build' && u.order.b === b.id) u.order = { kind: 'idle' };
  }
  markDirty(Game);                         // the refund is a change, the site or tier lost
  if (upgrading) { b.upgrade = null; b.built = 1; b.hp = b.maxHp; } else removeBuilding(Game, b);
  toast(Game, def.label + (upgrading ? ' upgrade cancelled' : ' cancelled'));
  return true;
}

/** Demolish a finished own-team building for no refund (the AoE2 rule): a
 *  Town Center cannot be demolished by its owner, unfinished sites are
 *  cancelConstruction's job, and a building that is training is refused
 *  rather than quietly eating its paid-for queue. */
function demolish(Game, b) {
  if (!b || b.team !== 0) return toast(Game, 'Not your building');
  const def = BLD[b.kind];
  if (b.built < 1) return toast(Game, 'Not built yet — cancel instead');
  if (b.kind === 'town_center') return toast(Game, 'Cannot demolish a Town Center');
  if (b.queue.length) return toast(Game, 'Still training');
  if (b.research) return toast(Game, 'Still researching');
  markDirty(Game);                         // the lost building is a change
  removeBuilding(Game, b);
  toast(Game, def.label + ' demolished');
  return true;
}

/** Is a wxh footprint buildable? grass only, no overlap, in bounds. */
function siteFree(Game, tx, ty, w, h) {
  const world = Game.world;
  if (tx < 0 || ty < 0 || tx + w > world.w || ty + h > world.h) return false;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (world.type[(ty + dy) * world.w + (tx + dx)] !== T.GRASS) return false;
    }
  }
  for (const b of Game.buildings) {
    if (tx < b.tx + b.w && tx + w > b.tx && ty < b.ty + b.h && ty + h > b.ty) return false;
  }
  return true;
}

/** Train button. */
function train(Game, bld, kind) {
  const def = BLD[bld.kind];
  if (!def.trains || def.trains.indexOf(kind) < 0) return toast(Game, KINDS[kind].label + ' needs a ' + def.label);
  if (bld.built < 1) return toast(Game, 'Still building');
  if (bld.queue.length >= 5) return toast(Game, 'Queue full');
  if (!canAfford(Game, bld.team, KINDS[kind].cost)) return toast(Game, 'Not enough ' + missing(Game, bld.team, KINDS[kind].cost));
  if (popCommitted(Game, bld.team) >= popCap(Game, bld.team)) return toast(Game, 'Need more houses');
  spend(Game, bld.team, KINDS[kind].cost);
  bld.queue.push({ kind, t: KINDS[kind].time });
  markDirty(Game);                         // the paid-for queue is a change
  return bld;
}

/** Research button. One tech at a time per building - train's queue pattern
 * collapsed to a single slot; every refusal goes through toast before
 * anything is spent. */
function researchTech(Game, b, id) {
  const tech = TECHS[id];
  if (!tech) return toast(Game, 'Unknown tech ' + id);
  if (tech.building !== b.kind) return toast(Game, BLD[b.kind].label + ' cannot research ' + tech.label);
  if (b.built < 1) return toast(Game, 'Still building');
  if (Game.age[b.team] < tech.age) return toast(Game, tech.label + ' requires ' + AGES[tech.age]);
  if (Game.techs[b.team].has(id)) return toast(Game, tech.label + ' already researched');
  if (b.research) return toast(Game, BLD[b.kind].label + ' is busy');
  if (!canAfford(Game, b.team, tech.cost)) return toast(Game, 'Not enough ' + missing(Game, b.team, tech.cost));
  spend(Game, b.team, tech.cost);
  b.research = { id, t: tech.time };
  markDirty(Game);                         // the paid-for research is a change
  return b;
}

/** Market trade. The whole refusal ladder runs before the first helper moves a
 *  unit (toast's pattern in `train` / `researchTech`), and both directions are
 *  the same two helpers: only a row carrying `trade` rates can trade, and a
 *  lot of 100 — the figure the design fixed — changes sides at the row's rate. */
function trade(Game, b, res, direction) {
  const def = b && BLD[b.kind];
  if (!def || !def.trade) return toast(Game, (def ? def.label : String(b && b.kind)) + ' cannot trade');
  if (b.built < 1) return toast(Game, 'Still building');
  if ((def.age ?? 0) > Game.age[b.team]) return toast(Game, def.label + ' requires ' + AGES[def.age]);
  if (direction !== 'sell' && direction !== 'buy') return toast(Game, 'Unknown trade direction ' + direction);
  if (['food', 'wood', 'stone'].indexOf(res) < 0) return toast(Game, 'Cannot trade ' + res);
  const lot = direction === 'sell' ? { [res]: 100 } : { gold: def.trade.buy };
  const gain = direction === 'sell' ? { gold: def.trade.sell } : { [res]: 100 };
  if (!canAfford(Game, b.team, lot)) return toast(Game, 'Not enough ' + missing(Game, b.team, lot));
  spend(Game, b.team, lot);
  refund(Game, b.team, gain);
  markDirty(Game);                         // the swapped resources are a change
  return b;
}

function upgradeAge(Game) {
  if (Game.age[0] >= AGES.length - 1) return toast(Game, AGES[AGES.length - 1] + ' reached');
  const cost = { food: Game.age[0] === 0 ? CFG.AGE_FOOD : CFG.AGE_FOOD * 2 };
  if (!canAfford(Game, 0, cost)) return toast(Game, 'Need ' + cost.food + ' food');
  spend(Game, 0, cost);
  Game.age[0]++;                             // the player's own age (docs/TODO.md P1-11)
  Game.ageBonus[0] = Game.age[0];            // and only the player's attack/armour scaling
  playSfx(Game, 'age');
  markDirty(Game);                         // the age up is a change
  toast(Game, AGES[Game.age[0]] + ' reached');
}

/* ------------------------------- toast --------------------------------- */

function toast(Game, msg) {
  Game.toastMsg = msg;
  Game.toastAt = Game.time;
  const el = Game.dom && Game.dom.toast;
  if (el) {
    if (el.textContent !== msg) el.textContent = msg;
    if (el.classList && el.classList.add) el.classList.add('show');
  }
}
