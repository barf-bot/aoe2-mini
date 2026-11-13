'use strict';
/* save -- localStorage door, state encode/decode, save/load/migrate. */

/* The one door to localStorage. storageGet answers null and storageSet answers
   false when the platform has none (node: the harness and render-preview.js) or
   refuses the write (private mode, quota) — a save is a convenience, so losing
   one must never break the game. storageSet(path, null) clears a slot, which is
   how a new game forgets the old one. */
function storageGet(path) {
  try {
    const s = typeof globalThis === 'undefined' ? undefined : globalThis.localStorage;
    if (s === undefined || s === null) return null;
    const v = s.getItem(path);
    return v === undefined ? null : v;
  } catch (e) { return null; }
}

function storageSet(path, raw) {
  try {
    const s = typeof globalThis === 'undefined' ? undefined : globalThis.localStorage;
    if (s === undefined || s === null) return false;
    if (raw === null) s.removeItem(path);
    else s.setItem(path, raw);
    return true;
  } catch (e) { return false; }
}

/* The save schema, owned by these lines: exactly what saveGame writes and loadGame
   reads back. Everything else on Game is a per-runtime cache and stays out of the
   payload — the nine DOM-only fields (dom, view, mm, mmBase, toastMsg, toastAt,
   pingAt, frame, sound), pathQueries (a run counter), sprites (the live atlas Image),
   rnd (a closure, rebuilt from the envelope's seed), mapEpoch (loadGame recomputes
   it) and autosaveAt (the save schedule). */

/* A source reference minus its live part: `amount` is a getter onto world.amount or
   a farm's field, so the payload keeps the tile / farm it names and loadGame hands
   back a fresh getter (the same one sourceFromTile / sourceFromFarm build). */
function encodeSource(src) {
  if (!src) return null;
  return src.kind === 'farm'
    ? { kind: 'farm', b: src.b, res: src.res }
    : { kind: 'tile', tx: src.tx, ty: src.ty, res: src.res };
}

/* An order as stored: every field is already a plain value (move x/y, target and
   building ids) except `src`, which becomes the source it names. */
function encodeOrder(o) {
  if (!o) return { kind: 'idle' };
  const e = {};
  for (const k of Object.keys(o)) e[k] = o[k];
  if ('src' in e) e.src = encodeSource(o.src);
  return e;
}

function encodeUnit(u) {
  const e = {};
  for (const k of Object.keys(u)) e[k] = u[k];
  e.order = encodeOrder(u.order);
  return e;
}

function encodeBuilding(b) {
  const e = {};
  for (const k of Object.keys(b)) e[k] = b[k];
  return e;
}

/* An arrow points at a unit OR a building, and both ids come out of the same
   Game.nextId, so the id alone cannot say which: tk carries the kind (the same
   `r` test updateProjectiles uses to tell them apart). */
function encodeProjectile(p) {
  const tk = p.t && p.t.r !== undefined ? 'unit' : 'building';
  return { x: p.x, y: p.y, team: p.team, dx: p.dx, dy: p.dy, dmg: p.dmg,
           accuracy: p.accuracy, tk: p.t ? tk : null, tid: p.t ? p.t.id : null };
}

function encodeState(Game) {
  const w = Game.world;
  return {
    world: w ? { w: w.w, h: w.h, seed: w.seed, type: Array.from(w.type),
                 shade: Array.from(w.shade), amount: Array.from(w.amount) } : null,
    units: Game.units.map(encodeUnit),
    buildings: Game.buildings.map(encodeBuilding),
    projectiles: Game.projectiles.map(encodeProjectile),
    blocks: Object.fromEntries(Game.blocks),
    occupied: Array.from(Game.occupied),
    res: Game.res,
    selection: Game.selection,
    selectedBuilding: Game.selectedBuilding ? Game.selectedBuilding.id : null,
    groups: Game.groups,
    keys: Game.keys,
    cam: Game.cam,
    cursor: Game.cursor,
    mouse: Game.mouse,
    drag: Game.drag,
    placing: Game.placing,
    time: Game.time,
    wave: Game.wave,
    age: Game.age,
    ageBonus: Game.ageBonus,
    techs: Array.from(Game.techs),
    nextId: Game.nextId,
    started: Game.started,
    result: Game.result,
  };
}

/* The autosave schedule. A command never writes the save itself, it only pulls
   Game.autosaveAt earlier (never later): a burst of changes inside the window
   costs ONE write and a quiet game keeps its AUTOSAVE_EVERY rhythm. stepGame is
   the only caller that writes, so neither stepSim nor the render path reaches
   localStorage on its own. */
function markDirty(Game) {
  const due = Game.time + CFG.AUTOSAVE_DEBOUNCE;
  if (due < Game.autosaveAt) Game.autosaveAt = due;
}

/* The envelope: { version, seed, writtenAt, state }. `at` pins writtenAt so the
   same Game written twice gives the same bytes (the round-trip check compares
   strings); it defaults to the frame clock. The seed is the world's own, which is
   how loadGame rebuilds the rng closure. Returns the JSON whether or not the
   platform accepted the write, so a caller can still hash or show it. */
function saveGame(path, Game, at = now()) {
  const raw = JSON.stringify({
    version: CFG.VERSION,
    seed: Game.world ? Game.world.seed : CFG.SEED,
    writtenAt: at,
    state: encodeState(Game),
  });
  storageSet(path, raw);
  return raw;
}

/* The version hook: a v1 reader takes v1 and nothing else. When CFG.VERSION moves
   to 2, the conversion of an old payload happens here instead of the save being
   thrown away. */
function migrate(payload) {
  return payload && payload.version === CFG.VERSION ? payload : null;
}

/* Everything decodeState needs, checked before a single field is assigned: the
   envelope's seed has to agree with the state's world, the containers have to be
   the containers the decode walks, and the numbers have to be numbers. A payload
   that fails here is a corrupt save, not a partial one. */
function validState(payload) {
  const s = payload && typeof payload === 'object' ? payload.state : null;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  const w = s.world;
  if (!w || typeof w !== 'object' || w.w !== CFG.MAP_W || w.h !== CFG.MAP_H ||
      w.seed !== payload.seed || !Array.isArray(w.type) || !Array.isArray(w.shade) ||
      !Array.isArray(w.amount)) return false;
  if (!Array.isArray(s.units) || !Array.isArray(s.buildings) ||
      !Array.isArray(s.projectiles) || !Array.isArray(s.techs)) return false;
  if (!Array.isArray(s.res) || s.res.length !== 2 ||
      s.res.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) return false;
  if (!s.blocks || typeof s.blocks !== 'object' || Array.isArray(s.blocks)) return false;
  return typeof s.time === 'number' && typeof s.nextId === 'number';
}

/* A stored order back into a live one: `src` becomes the source object the engine
   works from (the payload only names the tile or farm). A source that is no longer
   there retires the order, the same call resumeGather makes for an emptied tile. */
function decodeOrder(Game, u, o, byId) {
  if (!o || typeof o !== 'object') return { kind: 'idle' };
  const e = Object.assign({}, o);
  if (!e.src || typeof e.src !== 'object') return e;
  let src = null;
  if (e.src.kind === 'farm') {
    const b = byId.get(e.src.b);
    if (b && b.built >= 1) src = sourceFromFarm(b);
  } else {
    src = sourceFromTile(Game, u, e.src.tx, e.src.ty);
  }
  return src ? Object.assign(e, { src }) : { kind: 'idle' };
}

/* A stored arrow back into a live one: `t` is relinked through the id index (the
   one the units and buildings were decoded into). A mark that no longer exists is
   dropped here, exactly as updateProjectiles drops an arrow whose mark just died. */
function decodeProjectile(p, byId) {
  const t = p && typeof p === 'object' ? byId.get(p.tid) : undefined;
  if (!t) return null;
  return { x: p.x, y: p.y, team: p.team, dx: p.dx, dy: p.dy, dmg: p.dmg,
           accuracy: p.accuracy, t };
}

/* Write a validated state onto Game, in the order the pieces depend on each other:
   the world first (the source getters read it), then the buildings and the
   occupancy derived from them, then the units (whose orders read both) and only
   then anything that points at an id. mapEpoch is bumped because the walkable set
   moved under the loaded buildings, which is what makes every cached route — the
   ones just restored and the ones the old Game had — rebuild on its first step. */
function decodeState(Game, state, seed) {
  const w = state.world;
  Game.world = { w: w.w, h: w.h, seed: w.seed, type: new Uint8Array(w.type),
                 shade: new Uint8Array(w.shade), amount: new Int32Array(w.amount) };
  Game.buildings = state.buildings.map((b) => Object.assign({}, b));
  Game.blocks = new Map(Object.entries(state.blocks).map(([k, v]) => [Number(k), v]));
  rebuildBlocks(Game);
  Game.mapEpoch++;
  const byId = new Map(Game.buildings.map((b) => [b.id, b]));
  Game.units = [];
  for (const u of state.units) {
    const e = Object.assign({}, u);
    e.order = decodeOrder(Game, e, u.order, byId);
    Game.units.push(e);
    byId.set(e.id, e);
  }
  Game.projectiles = state.projectiles.map((p) => decodeProjectile(p, byId)).filter(Boolean);
  Game.selectedBuilding = typeof state.selectedBuilding === 'number'
    ? (byId.get(state.selectedBuilding) || null) : null;
  Game.res = state.res;
  Game.selection = state.selection;
  Game.groups = state.groups;
  Game.keys = state.keys;
  Game.cam = state.cam;
  Game.cursor = state.cursor;
  Game.mouse = state.mouse;
  /* A live drag names the pointer that owns it (`id`, since the pointer refactor),
     and the listeners only ever finish the drag they are named in — so a save from
     before that shape came back as a drag no release could ever clear, freezing
     selection, the cursor and edge-scroll for the rest of the session. A press that
     ended with the previous session is no press to resume: drag without owner, load none. */
  Game.drag = state.drag && state.drag.id !== undefined ? state.drag : null;
  Game.placing = state.placing;
  Game.time = state.time;
  Game.wave = state.wave;
  Game.age = state.age;
  Game.ageBonus = state.ageBonus;
  Game.nextId = state.nextId;
  Game.started = state.started;
  Game.result = state.result;
  Game.techs = new Set(state.techs);
  Game.rnd = mulberry32(seed);            // the envelope's seed is the only way back to the closure
}

/* read the slot and put that game on the board: true when the payload was taken,
   false (and the standard settlement in `Game`) for every way a payload can be
   unusable — no slot, empty slot, unparseable text, a version this build cannot
   read, a state whose shape the decode cannot walk. It never throws: a save is a
   convenience, and the game must start either way. */
function loadGame(path, Game, raw = storageGet(path)) {
  const refuse = () => { resetGame(Game); return false; };
  let payload;
  try {
    if (typeof raw !== 'string' || raw === '') return refuse();
    payload = migrate(JSON.parse(raw));
    if (!payload || !validState(payload)) return refuse();
    decodeState(Game, payload.state, payload.seed);
    return true;
  } catch (e) { return refuse(); }
}
