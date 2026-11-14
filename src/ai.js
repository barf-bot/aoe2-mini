'use strict';
/* ai -- the enemy village: trains, gathers and attacks through the same commands. No DOM.

   Roadmap A2 (docs/plans/2026-11-14-strix-local-roadmap.md §5, closes docs/TODO.md P1-21)
   made `aiStep` a dispatcher over two clocks: Game.ai[1] is the red brain's own state — a
   tick clock, saved by src/save.js — and Game.wave is the attack-wave clock docs/GAME_RULES.md
   describes. The brain decides once per CFG.AI_TICK, and the village is trained through
   `train`, the player's own command, whose `trains` check the old `queueTrain` skipped: a
   Town Center makes villagers and nothing else, so the militia red used to forge at its Town
   Center wait for a Barracks (A6).
   A3 adds the third decision, `aiJobs`: every idle red villager is hired through
   `findJob` (`src/economy.js`) onto the resource furthest below its `CFG.AI_SPLIT` share of
   the village, and `CFG.AI_VILLAGERS` — not the bare population cap — sets the size the
   Town Center staffs.
   A4 adds the fourth decision, `aiHouse`: the village raises a house while it still has two
   population slots left rather than the second after its last one filled, and the `building`
   tally A4 adds to `aiWorking` is what keeps `aiJobs` from drafting the man already on the
   site. The helpers below stay small; src/ai-eco.js appears when this file passes ~250 lines. */

function aiStep(Game, dt) {
  if (!Game.started) return;                   // the village sleeps until the game begins
  const tick = aiTickDue(Game);                // the brain's own clock, Game.ai[1] (A2)
  const wave = aiWaveClock(Game, dt);          // the CFG.WAVE_EVERY attack clock, kept apart from it
  if (!tick && !wave) return;                  // so a step is a tick, a wave, or nothing at all
  const tc = aiTownCenter(Game);
  if (!tc) return;                             // no finished keep to order from (docs/TODO.md P1-9)
  if (tick && aiJobs(Game)) markDirty(Game);   // A3: work first — an idle village gathers nothing
  if (tick && aiHouse(Game, tc)) markDirty(Game);   // A4: then the room — a house before the village runs out of it
  if (aiWantsVillager(Game)) aiTrain(Game, tc);   // A3: then grow to CFG.AI_VILLAGERS, through `train`
  else aiAttackWave(Game);                     // with nothing to make, the village fights instead
}

/** The attack-wave clock (docs/GAME_RULES.md): Game.wave counts every second of a started
 *  game and resets on CFG.WAVE_EVERY. A2 keeps it deliberately apart from the brain tick —
 *  a wave is not a decision and a decision is not a wave — and it stays the authoritative
 *  copy the rules and the checks read. Returns true on the step that fires a wave. */
function aiWaveClock(Game, dt) {
  Game.wave += dt;
  if (Game.wave < CFG.WAVE_EVERY) return false;
  Game.wave = 0;
  return true;
}

/** The brain's own clock, the field A2 adds to Game.ai[1] and save.js stores: at most one
 *  decision per CFG.AI_TICK, recording the boundary it acted on rather than Game.time, so
 *  the rhythm cannot drift with the frame rate and a loaded game resumes where it stopped.
 *  lastTick -1 means "never", so the first decision lands on the first CFG.AI_TICK
 *  boundary. The tolerance is the fixed step's own binary rounding — 30 × CFG.SIM_DT sums
 *  to 0.9999999999999999 — and a whole second of game time in which the enemy did nothing
 *  would be the worse bug. */
function aiTickDue(Game) {
  const brain = Game.ai[1];                    // team 1's slot; team 0 has no brain until A10
  const next = brain.lastTick < 0 ? CFG.AI_TICK : brain.lastTick + CFG.AI_TICK;
  if (Game.time + 1e-9 < next) return false;
  brain.lastTick = next;
  return true;
}

/** The building the brain orders from: a finished red Town Center. The old code asked for
 *  any finished red building, which the seeded roster always resolved to the Town Center;
 *  naming the kind is what lets `train` be the law here, and card A6 is the single place
 *  this search widens. */
function aiTownCenter(Game) {
  return Game.buildings.find((b) => b.team === 1 && b.kind === 'town_center' && b.built >= 1) || null;
}

/** The work decision (roadmap A3): every idle red villager is given a job, the resource
 *  furthest below its `CFG.AI_SPLIT` share of the village first and the other resources
 *  after it, through `findJob` — the same search `assignStarter` uses, so the AI cannot
 *  invent a second definition of a job. The villagers are hired one at a time against the
 *  running `working` count, which is what turns one tick's five idle villagers into the
 *  split rather than five berry pickers. Returns how many were hired; `aiStep` marks the
 *  game dirty once per tick that changed anything, and an assignment that only moves a
 *  villager from `idle` to `harvest` never touches the stockpile, so nothing else can mark. */
function aiJobs(Game) {
  const villagers = Game.units.filter((u) => u.team === 1 && u.kind === 'villager' && !u.dead);
  const idle = villagers.filter((u) => u.order.kind === 'idle');   // a builder or a fighter is not looking
  if (!idle.length) return 0;
  const working = aiWorking(Game, 1);
  const village = villagers.length - working.building;   // A4: the split is over the villagers who can gather
  let hired = 0;
  for (const v of idle) if (aiJobFor(Game, v, village, working)) hired++;
  return hired;
}

/** What the village is already doing: the resource each of its villagers works, read off the
 *  `harvest` / `go_deposit` orders the same way `workersOnTile` (`src/economy.js`) reads a
 *  tile — a villager carrying a basket still counts for the source that filled it, so the
 *  count never dips mid-trip and hires a duplicate — plus `building`, the A4 tally of the
 *  villagers standing on a site. A builder works a foundation, not a resource: counting him
 *  apart from the resource columns is what stops `aiJobs` sizing the village by villagers it
 *  can no longer put on any resource, and it is the A3 accounting hole A4 closes — a builder
 *  read as free would be re-hired off the house and the house would never be finished. */
function aiWorking(Game, team) {
  const working = { building: 0 };
  for (const res in CFG.AI_SPLIT) working[res] = 0;
  for (const u of Game.units) {
    if (u.dead || u.team !== team || u.kind !== 'villager') continue;
    const src = (u.order.kind === 'harvest' || u.order.kind === 'go_deposit') ? u.order.src : null;
    if (src && working[src.res] !== undefined) working[src.res]++;
    else if (u.order.kind === 'build') working.building++;
  }
  return working;
}

/** The resources ordered by how far below their share of `village` they are — the biggest
 *  deficit first, ties going to the table's own order (food, wood, gold). */
function aiRanked(village, working) {
  return Object.keys(CFG.AI_SPLIT)
    .map((res, i) => ({ res, i, short: CFG.AI_SPLIT[res] * village - (working[res] || 0) }))
    .sort((a, b) => (b.short - a.short) || a.i - b.i)
    .map((x) => x.res);
}

/** Hire one villager: the ranked resources in turn, then any tile at all (`findJob` with no
 *  resource) as the last resort; its `full: true` answer is still a job — the rule
 *  `assignStarter` has always had, an overcrowded berry beats an idle villager — so the
 *  search only moves on when a resource offers nothing to work. */
function aiJobFor(Game, v, village, working) {
  for (const res of aiRanked(village, working).concat([null])) {
    const job = findJob(Game, v, res);
    if (!job) continue;
    v.order = { kind: 'harvest', src: job.src };
    if (working[job.src.res] !== undefined) working[job.src.res]++;
    return true;
  }
  return false;
}

/** The house decision (roadmap A4, the half of `aiWantsVillager`'s story A3 left open): the
 *  village only grows past its Town Center if somebody raises the walls first, so the brain
 *  asks whether it is within two slots of the population the *built* buildings allow —
 *  `popCommitted(Game, 1) + 2 >= popCap(Game, 1)` — and with no red house already going up,
 *  spends the tick on one attempt. The two are the room that house will hand out: an
 *  unfinished site adds nothing to `popCap` while `popCommitted` already counts the villagers
 *  walking and queued, so asking at cap-2 buys the room before the village runs out of it
 *  instead of one second after, which is what the Town Center queue would otherwise spend its
 *  last second on. `BLD.house` (data/buildings.json) supplies the cost, the 25 s of work, the
 *  footprint and the +5 pop — the card adds no number of its own. The site is `aiPad`, the
 *  crew `aiCrew`, and every answer `build` gives — `House started`, `Can't build there`, `No
 *  villager in the crew` — is a `toast(…, 1)`, so it lands in Game.aiLog (A1's rule) and never
 *  over the player's line. Only a site actually put up is a change for `aiStep` to mark. */
function aiHouse(Game, tc) {
  if (popCommitted(Game, 1) + 2 < popCap(Game, 1)) return false;        // room left: nothing to raise yet
  if (Game.buildings.some((b) => b.team === 1 && b.kind === 'house' && b.built < 1)) return false;
  if (!canAfford(Game, 1, BLD.house.cost)) return false;                // the same pre-check `aiTrain` makes
  const pad = aiPad(Game, tc);                                           // null: nowhere left to stand one
  const crew = aiCrew(Game, pad || tc);
  return !!build(Game, 'house', pad ? pad.tx * CFG.TILE : undefined,
    pad ? pad.ty * CFG.TILE : undefined, 1, crew ? [crew.id] : []);
}

/** The ground A4 builds on: the nearest tile to the keep `canPlaceAt` — the rule `build`
 *  applies to a click — accepts for a house. `findSite` (`src/world.js`) cannot answer this
 *  one: it searches grass only, and the nearest grass to a Town Center is the tile the keep
 *  stands on, so every site it offers a built settlement is refused for the footprint already
 *  there (`build` answers `Can't build there`). The search is the same square spiral, bounded
 *  by the map, and the row's own footprint comes from `canPlaceAt`, not from a number here. */
function aiPad(Game, tc) {
  const w = Game.world.w, h = Game.world.h;
  for (let r = 0; r < Math.max(w, h); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (canPlaceAt(Game, 'house', tc.tx + dx, tc.ty + dy, 1)) return { tx: tc.tx + dx, ty: tc.ty + dy };
      }
    }
  }
  return null;
}

/** The villager A4 sends: the nearest red villager to the pad who works wood — the same
 *  `harvest` / `go_deposit` reading `aiWorking` uses — or, while nobody in the village is on
 *  wood yet (its first tick, or a settlement whose wood is all claimed), the nearest one
 *  `findJob` can actually give a wood job, the card's alternative and the man the forest wants.
 *  Nobody at all answers `null`, which `aiHouse` hands `build` as an empty crew so the village
 *  pays one `No villager in the crew` line in Game.aiLog rather than a silent plan. Ties go to
 *  the lower id, so the same seed sends the same villager. */
function aiCrew(Game, at) {
  const near = (u) => (Math.floor(u.x / CFG.TILE) - at.tx) ** 2 + (Math.floor(u.y / CFG.TILE) - at.ty) ** 2;
  const pool = Game.units.filter((u) => !u.dead && u.team === 1 && u.kind === 'villager')
    .sort((a, b) => (near(a) - near(b)) || a.id - b.id);
  const works = (u) => (u.order.kind === 'harvest' || u.order.kind === 'go_deposit') &&
    u.order.src && u.order.src.res === 'wood';
  return pool.find(works) || pool.find((v) => !!findJob(Game, v, 'wood')) || null;
}

/** How big the village should be: `CFG.AI_VILLAGERS` (22), held down by the population the
 *  buildings actually allow — `min(CFG.AI_VILLAGERS, popCap(Game, 1))` — so the Town Center
 *  keeps one villager queued without ever asking for a sixth while red still lives in one
 *  keep (A4's houses raise the cap; asking `train` past it is a `Need more houses` refusal in
 *  Game.aiLog every second, which is noise, not a plan). A2 asked `popUsed < popCap`, the
 *  same wall without the target. `train` still decides whether the building may make the
 *  unit; this only decides whether the village wants one. */
function aiWantsVillager(Game) {
  return popCommitted(Game, 1) < Math.min(CFG.AI_VILLAGERS, popCap(Game, 1));
}

/** The decision a wave carries: every militia holding no live order is sent at the closest
 *  blue unit and the village announces it — through `toast` with team 1, so the message
 *  lands in Game.aiLog instead of over the player's toast line (A1's rule, which is what
 *  made this line's default wrong). A unit with a live order is left alone, and nothing is
 *  announced when nobody moved. */
function aiAttackWave(Game) {
  const prey = nearestEnemy(Game, 1);
  let sent = 0;
  for (const u of Game.units) {
    if (u.team !== 1 || u.kind !== 'militia' || u.dead) continue;
    const o = u.order;
    const live = o.kind === 'attack' && (o.b !== undefined
      ? Game.buildings.some((z) => z.id === o.b && attackableAsEnemy(z, 1))
      : Game.units.some((z) => z.id === o.target && !z.dead));
    if (live) continue;
    if (!prey) continue;
    u.order = { kind: 'attack', target: prey.id };
    sent++;
  }
  if (sent) toast(Game, 'Red attack wave!', 1);
}

/** The training decision, asked through `train` — the door A2 deletes `queueTrain` for
 *  (docs/TODO.md P1-21: that helper spent red gold and food and pushed onto the queue
 *  itself, so red fielded militia no row ever promised the player). Asking the command
 *  means asking what the building's row allows: a Town Center makes villagers, and until
 *  card A6 puts a Barracks up there is no fighter here to ask for. The queue is never
 *  double-filled, and an ask the stockpile cannot pay is refused by `train` — into
 *  Game.aiLog, where an enemy complaint belongs — instead of being half-paid here. */
function aiTrain(Game, tc) {
  if (tc.queue.length) return;
  if ((BLD[tc.kind].trains || []).indexOf('villager') < 0) return;
  if (!canAfford(Game, 1, KINDS.villager.cost)) return;
  train(Game, tc, 'villager');
}

function nearestEnemy(Game, team) {
  let best = null, bd = Infinity;
  for (const u of Game.units) {
    if (!targetableAsEnemy(u, team)) continue;
    const home = Game.buildings.find(b => b.team === team && b.built >= 1);
    if (!home) return u;
    const d = (u.x - home.x) ** 2 + (u.y - home.y) ** 2;
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}
