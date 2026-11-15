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
   site.
   A5 adds the fifth and sixth decisions, `aiCamps` and `aiFarms`: a `lumber_camp` /
   `mining_camp` on the ground where `CFG.AI_DROP_MIN_WORKERS` of its villagers walk further
   than `CFG.AI_DROP_RADIUS` to a drop-off, and a `mill` plus `farm`s once no berry is left
   inside `CFG.AI_BERRY_RADIUS` of the keep — the three thresholds authored in data/units.json
   like A3's two, every cost and footprint still BLD's.
   A6 adds the seventh, eighth and ninth decisions, `aiBarracks` / `aiRange`, `aiTrainArmy` /
   `aiArmyRanked` and `aiRally`: a `barracks` once 12 villagers are alive and an `archery_range`
   once it is finished and red is Feudal (one of each, ever), the `CFG.AI_ARMY` mix in place of
   the single kind A2 hardcoded in `aiTrain`, and the `Game.ai[1].rally` tile a leaderless
   fighter is marched to. The split into src/ai-eco.js this comment used to announce ("when this
   file passes ~250 lines") is its own later card. */

function aiStep(Game, dt) {
  if (!Game.started) return;                   // the village sleeps until the game begins
  const tick = aiTickDue(Game);                // the brain's own clock, Game.ai[1] (A2)
  const wave = aiWaveClock(Game, dt);          // the CFG.WAVE_EVERY attack clock, kept apart from it
  if (!tick && !wave) return;                  // so a step is a tick, a wave, or nothing at all
  const tc = aiTownCenter(Game);
  if (!tc) return;                             // no finished keep to order from (docs/TODO.md P1-9)
  if (tick && aiJobs(Game)) markDirty(Game);   // A3: work first — an idle village gathers nothing
  if (tick && aiHouse(Game, tc)) markDirty(Game);   // A4: then the room — a house before the village runs out of it
  if (tick && aiCamps(Game, tc)) markDirty(Game);   // A5 1+2: then the ground — a camp where the walk is too long
  if (tick && aiFarms(Game, tc)) markDirty(Game);   // A5 3: then the food — a mill and fields once the berries are gone
  if (tick && aiBarracks(Game, tc)) markDirty(Game);   // A6 1: then the arms — a barracks once the village is 12 strong
  if (tick && aiRange(Game, tc)) markDirty(Game);   // A6 2: and an archery range once that one is finished and red is Feudal
  if (tick && aiRally(Game, tc)) markDirty(Game);   // A6 4: the army walks to its rally tile before the wave takes it
  if (aiWantsVillager(Game)) aiTrain(Game, tc);   // A3: then grow to CFG.AI_VILLAGERS, through `train`
  else aiAttackWave(Game);                     // with nothing to make, the village fights instead
  if (tick && aiTrainArmy(Game)) markDirty(Game);   // A6 3: then the military queues, from CFG.AI_ARMY
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
  const pad = aiPad(Game, 'house', tc);              // null: nowhere left to stand one
  const crew = aiCrew(Game, pad || tc);
  return !!build(Game, 'house', pad ? pad.tx * CFG.TILE : undefined,
    pad ? pad.ty * CFG.TILE : undefined, 1, crew ? [crew.id] : []);
}

/** The ground the village builds on, for every row it owns: the nearest tile to `at` that
 *  `canPlaceAt` — the rule `build` applies to a click — accepts for `kind`. `findSite`
 *  (`src/world.js`) cannot answer this for a built settlement: it searches grass only, and the
 *  nearest grass to a Town Center is the tile the keep stands on, so every site it offers is
 *  refused for the footprint already there (`build` answers `Can't build there`). The search is
 *  the same square spiral, bounded by the map, and the row's own footprint comes from
 *  `canPlaceAt`, not from a number here — which is how one helper now answers for the house A4
 *  asked beside the keep, the camp A5 puts on a resource edge (the tile itself is a resource,
 *  so the answer is the grass next to it), and the mill and the farms that ring the keep once
 *  its berries are gone. A4 called it with the keep; A5 calls it with the ground each row
 *  replaces, which is the card's "the nearest forest edge". */
function aiPad(Game, kind, at) {
  const w = Game.world.w, h = Game.world.h;
  for (let r = 0; r < Math.max(w, h); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (canPlaceAt(Game, kind, at.tx + dx, at.ty + dy, 1)) return { tx: at.tx + dx, ty: at.ty + dy };
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

/** A5's crew, the same pool A4's `aiCrew` reads — red villagers who are not standing on a
 *  site, nearest `at` first, ties to the lower id — asked for the resource `res` the new
 *  building replaces: the villager who works it, else the nearest one `findJob` can give it,
 *  else, when that resource has nothing left to give (the berry field `aiFarms` paves over, the
 *  gold `aiCamp` moves off a mountain the village has not reached yet), the nearest villager
 *  `findJob` can employ at all — the card's "the villager who lost the berry tile". A4's
 *  `aiCrew` stops one answer earlier and stays A4's: whether a house on a map with no wood in
 *  reach takes a gold worker is that card's open half, not this one's. A builder is never in
 *  this pool at all, so a camp can never draft the man a house is already paying — the same
 *  `building` tally that keeps `aiJobs` off him. */
function aiCrewFor(Game, at, res) {
  const near = (u) => (Math.floor(u.x / CFG.TILE) - at.tx) ** 2 + (Math.floor(u.y / CFG.TILE) - at.ty) ** 2;
  const pool = Game.units.filter((u) => !u.dead && u.team === 1 && u.kind === 'villager' &&
    u.order.kind !== 'build').sort((a, b) => (near(a) - near(b)) || a.id - b.id);
  const works = (u) => (u.order.kind === 'harvest' || u.order.kind === 'go_deposit') &&
    u.order.src && u.order.src.res === res;
  return pool.find(works) || pool.find((v) => !!findJob(Game, v, res)) ||
    pool.find((v) => !!findJob(Game, v, null)) || null;
}

/** A5's measure for both camps: the tiles red villagers work for `res` when the drop-off
 *  `findDropoff` would send them to — `dropTargetScore`'s answer, the resource's own camp first
 *  and the Town Center after it — sits more than `CFG.AI_DROP_RADIUS` tiles away. The distance is
 *  the card's, tile to drop-off (`src.tx/ty` plus half a tile, the same anchor `canPlaceAt` and
 *  `aiPad` work in), not the villager's own step: the rule is about the ground he works, and
 *  reading the work spot instead would let a man standing on the far side of the tile be closer
 *  than the tile is. The orders are read the way `aiWorking` reads them, so a villager carrying
 *  a basket still works the source that filled him and a builder works a foundation, not a
 *  resource. A source with no drop-off at all is not a long walk either, so it answers nothing,
 *  and an unfinished camp is not yet a drop-off, so its workers keep measuring the old walk
 *  until somebody finishes the site that was built to save it. Only tile sources count — a camp
 *  serves a forest or a gold field, never another building. */
function aiFarWorkers(Game, res) {
  const out = [];
  const mid = (n) => n * CFG.TILE + CFG.TILE / 2;
  for (const v of Game.units) {
    if (v.dead || v.team !== 1 || v.kind !== 'villager' || v.order.kind === 'build') continue;
    const src = (v.order.kind === 'harvest' || v.order.kind === 'go_deposit') ? v.order.src : null;
    if (!src || src.kind !== 'tile' || src.res !== res) continue;
    const drop = findDropoff(Game, v, src);
    if (!drop) continue;                                             // nowhere to carry is nowhere to camp
    if (Math.hypot(drop.x - mid(src.tx), drop.y - mid(src.ty)) / CFG.TILE > CFG.AI_DROP_RADIUS) out.push(src);
  }
  return out;
}

/** The camp rule, written once and asked twice by `aiCamps` for the two pairs
 *  `dropTargetScore` already tabulates — `wood` / `lumber_camp`, `gold` / `mining_camp`, in that
 *  order so the same seed always builds the same camp first. Once `CFG.AI_DROP_MIN_WORKERS`
 *  villagers work a source further than `CFG.AI_DROP_RADIUS` from their drop-off the village buys
 *  the row: the ground is the nearest tile `canPlaceAt` accepts around the worked tile closest to
 *  the keep — the card's "the nearest forest edge", the tile itself being a resource, so the
 *  answer is the grass beside it — the crew is `aiCrewFor`'s worker of that resource, and every
 *  answer `build` gives (`Lumber Camp started`, `Can't build there`, `No villager in the crew`)
 *  is a team-1 toast, so it lands in Game.aiLog and never over the player's line (A1's rule).
 *  One camp per resource, ever, finished or not: the guard is asked before the cost, so a second
 *  camp the village cannot pay for never spends a tick on a complaint. */
function aiCamp(Game, tc, res, kind) {
  if (Game.buildings.some((b) => b.team === 1 && b.kind === kind)) return false;
  const far = aiFarWorkers(Game, res);
  if (far.length < CFG.AI_DROP_MIN_WORKERS) return false;             // not enough walking to buy a camp
  if (!canAfford(Game, 1, BLD[kind].cost)) return false;              // `build`'s own answer, asked first
  const d = (t) => (t.tx - tc.tx) ** 2 + (t.ty - tc.ty) ** 2;         // the edge the workers came from
  const at = far.slice().sort((a, b) => (d(a) - d(b)) || (a.tx - b.tx) || (a.ty - b.ty))[0];
  const pad = aiPad(Game, kind, at);
  if (!pad) return false;                                             // nowhere to stand the row's footprint
  const crew = aiCrewFor(Game, pad, res);
  return !!build(Game, kind, pad.tx * CFG.TILE, pad.ty * CFG.TILE, 1, crew ? [crew.id] : []);
}

/** The two camp decisions (roadmap A5 rules 1 and 2); true when either put up a site, which is
 *  what `aiStep` marks the game dirty for. */
function aiCamps(Game, tc) {
  return [aiCamp(Game, tc, 'wood', 'lumber_camp'), aiCamp(Game, tc, 'gold', 'mining_camp')].some(Boolean);
}

/** The mill half of A5's rule 3, asked once: `BLD.mill`, and one of them forever. Its row is a
 *  Feudal building, and the age is read the way `canPlaceAt` reads it instead of asking `build`
 *  — a Dark Age village would hear `Mill requires Feudal Age` in Game.aiLog once a second until
 *  card A7 ages it up, the noise A4 spent its `canAfford` pre-check to avoid, and the village
 *  would be right to say nothing. Then the ground beside the keep, then `aiCrewFor`'s food
 *  worker, then `build`. */
function aiMill(Game, tc) {
  if (Game.buildings.some((b) => b.team === 1 && b.kind === 'mill')) return false;
  if ((BLD.mill.age ?? 0) > Game.age[1]) return false;                // the row's own age gate, asked quietly
  if (!canAfford(Game, 1, BLD.mill.cost)) return false;
  const pad = aiPad(Game, 'mill', tc);
  if (!pad) return false;
  const crew = aiCrewFor(Game, pad, 'food');
  return !!build(Game, 'mill', pad.tx * CFG.TILE, pad.ty * CFG.TILE, 1, crew ? [crew.id] : []);
}

/** A5's rule 3, in the order the card writes it — the mill first, then the fields.
 *  The gate is the berry band: `findAlternative` (`src/world.js`), the outward search
 *  `resumeGather` uses to re-house a villager whose tile just emptied, answers whether a
 *  harvestable food tile exists within `CFG.AI_BERRY_RADIUS` of the keep — asked from the keep's
 *  own tile (`tc.tx/ty`, the anchor `canPlaceAt` and `aiPad` work from), the way `findJob`
 *  searches from the tile of the villager who lives on it, so it means "no berry the village can
 *  reach from home". While one stands the village eats it and ploughs nothing.
 *  The count is the card's `food villagers − tile-gatherers`: the village's food share
 *  (`CFG.AI_SPLIT.food × village`, `village` being the number `aiJobs` takes its split over — the
 *  villagers a resource can staff, the ones standing on a site removed) minus the ones a food
 *  source still employs (`working.food`, farms included, exactly as `aiWorking` reads them).
 *  `Math.floor` keeps that share an integer without rounding the village past it, so the village
 *  never owns more fields than it has food villagers, and one field per tick is the most any
 *  decision here spends. The crew is `aiCrewFor`'s food worker — the very villager whose berry
 *  the row replaces — whose `build` order keeps him off the resource columns until the field is
 *  finished, which is what makes "one farm per villager who lost a berry" and "no more farms
 *  than food villagers" the same statement twice. */
function aiFarms(Game, tc) {
  const home = { x: tc.tx * CFG.TILE, y: tc.ty * CFG.TILE };         // the keep's tile, not its centre
  if (findAlternative(Game.world, home, 'food', CFG.AI_BERRY_RADIUS)) return false;  // still feeds them
  const villagers = Game.units.filter((u) => !u.dead && u.team === 1 && u.kind === 'villager');
  const working = aiWorking(Game, 1);
  const village = villagers.length - working.building;
  if (!village) return false;                               // everyone is on a site already: nothing to feed
  let built = aiMill(Game, tc);
  const want = Math.max(0, Math.floor(CFG.AI_SPLIT.food * village) - working.food);
  const farms = Game.buildings.filter((b) => b.team === 1 && b.kind === 'farm').length;
  if (farms < want && canAfford(Game, 1, BLD.farm.cost)) {
    const pad = aiPad(Game, 'farm', tc);
    const crew = pad && aiCrewFor(Game, pad, 'food');           // the field belongs to the villager it replaces
    if (crew) built = !!build(Game, 'farm', pad.tx * CFG.TILE, pad.ty * CFG.TILE, 1, [crew.id]) || built;
  }
  return built;
}

/** A6 rule 1, the barracks: one, ever, finished or not (the A5 camp guard), and the gate is the
 *  number the card names — 12 living villagers, the only figure A6 authors besides
 *  `CFG.AI_ARMY`, every cost, footprint and train time still `BLD.barracks`'s. Below that the
 *  village is still a village and spends its wood on rooms and fields; at it, the card has the
 *  village start an army. The ground and crew are `aiArmySite`'s. */
function aiBarracks(Game, tc) {
  if (Game.buildings.some((b) => b.team === 1 && b.kind === 'barracks')) return false;
  if (Game.units.filter((u) => !u.dead && u.team === 1 && u.kind === 'villager').length < 12) return false;
  return aiArmySite(Game, tc, 'barracks');
}

/** A6 rule 2, the archery range: one, ever, and it waits for the barracks to be *finished* — an
 *  unfinished site trains nobody, so raising a second row on a foundation would spend red wood
 *  on a building that cannot answer the queue — and for the Feudal Age the row itself asks for
 *  (A7 is the card that ages red up; A6 honours the gate, exactly the way A5 honours
 *  `BLD.mill`'s). */
function aiRange(Game, tc) {
  if (Game.buildings.some((b) => b.team === 1 && b.kind === 'archery_range')) return false;
  if (!Game.buildings.some((b) => b.team === 1 && b.kind === 'barracks' && b.built >= 1)) return false;
  return aiArmySite(Game, tc, 'archery_range');
}

/** The half A6's two rows share, and the reason they cannot each invent one: the row's age gate
 *  read off the row (`BLD[kind].age` against `Game.age[1]`, the same reading `canPlaceAt` applies
 *  and the reason `aiMill` exists — asking `build` instead would answer `Barracks requires
 *  Feudal Age` into Game.aiLog once a second until A7 ages the village up), the cost, the nearest
 *  ground `canPlaceAt` accepts around the keep (`aiPad`, A5's), then the crew from `aiCrewFor`'s
 *  pool asked with no resource to prefer — a barracks belongs to the nearest hand free for work,
 *  which is that helper's own last-resort answer — and then `build`, whose every answer is a
 *  team-1 toast (A1's rule). */
function aiArmySite(Game, tc, kind) {
  if ((BLD[kind].age ?? 0) > Game.age[1]) return false;              // the row's own age gate, asked quietly
  if (!canAfford(Game, 1, BLD[kind].cost)) return false;             // `build`'s own answer, asked first
  const pad = aiPad(Game, kind, tc);
  if (!pad) return false;                                             // nowhere to stand the row's footprint
  const crew = aiCrewFor(Game, pad, null);
  return !!build(Game, kind, pad.tx * CFG.TILE, pad.ty * CFG.TILE, 1, crew ? [crew.id] : []);
}

/** The mix A6 rule 3 trains, ranked: `CFG.AI_ARMY`'s kinds ordered by how far below their share
 *  of red's *living and queued* fighters each is, biggest deficit first and ties in the table's
 *  own order — the shape `aiRanked` gives the village's resources. Queued counts because a
 *  paid-for slot is already spent (docs/TODO.md P1-10's lesson): reading only the living would
 *  let a barracks with a militia on the forge order a second one and bury the village's gold in
 *  a queue nobody can field. */
function aiArmyRanked(Game) {
  const have = {};
  let total = 0;
  for (const u of Game.units) if (!u.dead && u.team === 1 && CFG.AI_ARMY[u.kind] !== undefined) {
    have[u.kind] = (have[u.kind] || 0) + 1; total++;
  }
  for (const b of Game.buildings) if (b.team === 1) for (const j of b.queue) {
    if (CFG.AI_ARMY[j.kind] === undefined) continue;
    have[j.kind] = (have[j.kind] || 0) + 1; total++;
  }
  return Object.keys(CFG.AI_ARMY)
    .map((kind, i) => ({ kind, i, short: CFG.AI_ARMY[kind] * total - (have[kind] || 0) }))
    .sort((a, b) => (b.short - a.short) || a.i - b.i)
    .map((x) => x.kind);
}

/** A6 rule 3, once per tick: every finished red building trains the ranked kind its own `trains`
 *  row allows — a barracks the militia, an archery range the archer, a house or a mill nothing —
 *  and only while red still has a population slot to spend, because `train` would otherwise
 *  answer `Need more houses` into Game.aiLog every second, the noise A4 and A5 spent their
 *  pre-checks to avoid. A building with a unit in its queue trains nothing more: A2's rule, kept
 *  through `aiTrain` so the builder keeps its queue short instead of hoarding five. */
function aiTrainArmy(Game) {
  if (popCommitted(Game, 1) >= popCap(Game, 1)) return false;         // `train`'s own wall, asked first
  const ranked = aiArmyRanked(Game);
  let queued = false;
  for (const b of Game.buildings) {
    if (b.team !== 1 || b.built < 1) continue;
    const kind = ranked.find((k) => (BLD[b.kind].trains || []).indexOf(k) >= 0);
    if (kind !== undefined && aiTrain(Game, b, kind)) queued = true;
  }
  return queued;
}

/** The army's gathering ground (A6 rule 4), computed once and kept in `Game.ai[1]`: the tile
 *  halfway between the red Town Center and the map centre. Stored rather than recomputed because
 *  the brain slot is what `encodeState` / `decodeState` already save (A2), and a rally that moved
 *  every tick would have the army walk in circles; `aiTickDue` owns that slot's clock and this
 *  field now lives beside it. */
function aiRallyTile(Game, tc) {
  const brain = Game.ai[1];
  if (!brain.rally) {
    brain.rally = { tx: Math.floor((tc.tx + Math.floor(Game.world.w / 2)) / 2),
      ty: Math.floor((tc.ty + Math.floor(Game.world.h / 2)) / 2) };
  }
  return brain.rally;
}

/** A6 rule 4, asked every tick: a red fighter with no order is given the `move` order
 *  `issueOrder` (`src/commands.js`) gives a fighter it selects — `{ kind, x, y }`, here the
 *  rally tile's centre, the same anchor `canPlaceAt`, `aiPad` and `aiFarWorkers` work from — so
 *  the army gathers instead of standing on its own barracks. `aiAttackWave` still replaces it on
 *  a wave (A2's rule, A8's to change), which is why the rally runs before the wave in `aiStep`,
 *  and a garrisoned unit owns no order to fill. */
function aiRally(Game, tc) {
  const at = aiRallyTile(Game, tc);
  const x = at.tx * CFG.TILE + CFG.TILE / 2, y = at.ty * CFG.TILE + CFG.TILE / 2;
  let sent = 0;
  for (const u of Game.units) {
    if (u.dead || u.team !== 1 || u.garrisonedIn || u.kind === 'villager' || u.order.kind !== 'idle') continue;
    u.order = { kind: 'move', x, y };
    sent++;
  }
  return sent;
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
 *  means asking what the building's row allows: a Town Center makes villagers — the kind A2
 *  hardcoded and still the only one `aiWantsVillager` asks for, so A6 makes it the default
 *  rather than the only answer — while `aiTrainArmy` asks the same door for the military rows
 *  through `CFG.AI_ARMY`. The queue is never double-filled, and an ask the stockpile cannot pay
 *  is refused by `train` — into Game.aiLog, where an enemy complaint belongs — instead of being
 *  half-paid here. */
function aiTrain(Game, b, kind = 'villager') {
  if (b.queue.length) return false;
  if ((BLD[b.kind].trains || []).indexOf(kind) < 0) return false;
  if (!canAfford(Game, 1, KINDS[kind].cost)) return false;
  train(Game, b, kind);
  return true;
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
