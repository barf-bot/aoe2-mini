'use strict';
/* structures -- building upgrade/promotion/garrison helpers. No DOM. */

/** The chain's front half: order the next tier onto a building that already stands. */
function upgradeBuilding(Game, b) {
  if (!b || b.team !== 0) return toast(Game, 'Not your building');
  if (b.built < 1) return toast(Game, 'Already under construction');
  const nextKind = BLD[b.kind].upgradesTo;
  if (!nextKind) return toast(Game, BLD[b.kind].label + ' has no upgrade');
  const next = BLD[nextKind];
  /* the tier being entered has to be reached, not the one standing: same age gate
     and the same wording `build` uses two functions up. */
  if ((next.age ?? 0) > Game.age[b.team]) return toast(Game, next.label + ' requires ' + AGES[next.age]);
  if (!canAfford(Game, b.team, next.cost)) return toast(Game, 'Not enough ' + missing(Game, b.team, next.cost));
  const crew = pickBuilders(Game, { tx: b.tx, ty: b.ty });
  if (!crew.length) return toast(Game, Game.units.some(u => u.team === 0 && u.kind === 'villager')
    ? 'All villagers are building' : 'No villager available');
  spend(Game, b.team, next.cost);
  /* The site restarts on the new row's clock instead of growing a second timer:
     `b.upgrade` names the tier coming, `built` / `time` say how far along it is, and
     sim's existing `b.built >= 1` branch promotes it (src/sim.js:253). A tower mid-
     upgrade shoots nobody, exactly like any other half-built site (src/sim.js:138). */
  b.upgrade = nextKind;
  b.built = 0;
  b.time = next.time;
  for (const u of crew) {
    u.order = { kind: 'build', b: b.id };
    u.slot = null;                             // a site owns no tile, as `build` rules
  }
  markDirty(Game);                         // the spend and the new site are a change
  toast(Game, next.label + ' started');
  return b;
}

/** The chain's back half, called by sim the moment the site finishes: the building
 *  becomes the row it was building toward, so every number the game reads off BLD —
 *  hp, attack, armours, footprint, drop-off field — is the new tier's, and the
 *  `Watch Tower complete` toast two lines later names it. The three tower rows share
 *  a 1x1 footprint, so no route can change; rebuildBlocks and the epoch bump are
 *  still called because a chain that ever changes size must tell the pathfinder the
 *  walkable set moved. */
function promoteBuilding(Game, b) {
  b.kind = b.upgrade;
  b.upgrade = null;
  const def = BLD[b.kind];
  b.w = def.w; b.h = def.h;
  b.x = (b.tx + def.w / 2) * CFG.TILE;
  b.y = (b.ty + def.h / 2) * CFG.TILE;
  b.maxHp = def.hp;
  b.hp = b.maxHp;                            // the tier stands finished, not at 80 %
  b.field = def.field ? def.field : 0;
  rebuildBlocks(Game);
  Game.mapEpoch++;
}

/** The tile garrison number `i` of `n` gets beside b: its standing ring, the last tile
 *  there is, or b's own centre — a ring shorter than the group (all outer rings solid)
 *  never lands a unit on nothing. */
function ringSpot(Game, b, i, n) {
  const ring = standingSpots(Game, b, n);
  return ring[i] || ring[ring.length - 1] || { x: b.x, y: b.y };
}

/** The field half of `leaveBuilding`, shared with `removeBuilding`'s eviction: unlink
 *  `units` from b, set each one down on b's ring and drop the order — plus the route
 *  cached under it, because a teleported unit must not keep walking the path of the
 *  order he no longer has (the rule `makeBuilding` applies to a new footprint). */
function placeOnRing(Game, b, units) {
  for (let i = 0; i < units.length; i++) {
    const u = units[i], p = ringSpot(Game, b, i, units.length);
    u.garrisonedIn = null;
    u.order = { kind: 'idle' };
    u.slot = null;
    u.path = null; u.pathAt = 0; u.pathFor = null; u.pathEpoch = -1;
    u.x = p.x; u.y = p.y;
  }
  return units.length;
}

/** Send `unitIds` into finished building b (docs/plans/2026-11-13-garrison.md). The
 *  link is written at command time — it IS the reserved slot, so two orders in one
 *  frame cannot overbook b — while the unit still walks there: an accepted unit keeps a
 *  `move` order carrying `garrison`, `sim.updateUnit` moves nobody but that walk and the
 *  existing arrival line retires it, so a garrison order ends in exactly one place and
 *  needs no second timer. Returns the units that went in; a refusal toasts and marks
 *  nothing, and the unit keeps the order he had. */
function garrisonUnits(Game, unitIds, b) {
  const label = b ? BLD[b.kind].label : '';
  if (!b || b.team !== 0) { toast(Game, 'Not your building'); return []; }
  if (b.built < 1) { toast(Game, label + ' is not built yet'); return []; }
  const cap = BLD[b.kind].garrisonCapacity;
  if (!cap) { toast(Game, label + ' has no garrison space'); return []; }
  const inside = Game.units.filter((u) => u.garrisonedIn === b.id);
  const take = [], noRoom = [], already = [];
  for (const id of unitIds) {
    const u = Game.units.find((x) => x.id === id && !x.dead && x.team === b.team);
    if (!u) continue;                                    // not one of their live units: nothing to refuse
    if (u.garrisonedIn) already.push(u);                 // sheltering in another building already
    else if (inside.length + take.length >= cap) noRoom.push(u);
    else take.push(u);
  }
  const refused = noRoom.length ? label + ' is full'
    : already.length ? 'Already garrisoned there' : '';  // room beats a repeat: the design's rule
  if (refused) toast(Game, refused);
  if (!take.length) return [];                           // a refusal marks nothing: no ping, no save owed
  take.forEach((u, i) => {
    const p = ringSpot(Game, b, i, take.length);
    u.garrisonedIn = b.id;                               // the slot is his from this frame on
    u.order = { kind: 'move', x: p.x, y: p.y, garrison: b.id };   // the walk that ends inside
    u.slot = null;                                       // a garrison walk owns no formation tile
  });
  Game.pingAt = Game.time;
  markDirty(Game);                                       // the acknowledgement issueOrder:79 gives an order
  return take;
}

/** Bring units out of b: `unitIds` — default everyone inside, the panel's per-kind
 *  `Leave` passes its own kind's ids — re-placed on b's standing ring. The list is
 *  intersected with the units actually inside b, so one button can never release another
 *  kind. Returns the number released; 0 inside toasts and marks nothing. */
function leaveBuilding(Game, b, unitIds) {
  if (!b || b.team !== 0) { toast(Game, 'Not your building'); return 0; }
  const inside = Game.units.filter((u) => u.garrisonedIn === b.id);
  const out = unitIds === undefined ? inside : inside.filter((u) => unitIds.indexOf(u.id) >= 0);
  if (!out.length) { toast(Game, BLD[b.kind].label + ' has nobody inside'); return 0; }
  const n = placeOnRing(Game, b, out);
  markDirty(Game);
  toast(Game, n + ' left ' + BLD[b.kind].label);
  return n;
}
