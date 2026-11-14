'use strict';
/* checks/14-determinism.js -- the sim has no hidden input: two games built from the same
   seed and handed the same script end up byte-for-byte identical (G8), and a game built
   from another seed does not.
   Runs on its own (`node tools/checks/14-determinism.js`) against a freshly booted game. */

const { AoE2, check, freeSpotAround, report } = require('../lib/harness');

const CFG = AoE2.CFG;
const TILE = CFG.TILE;
const STEPS = 3000;                                   // 100 s of CFG.SIM_DT, the G6 clock
const SEED_AB = 20261114, SEED_C = 99991;

/* One game, played by a script that is the same program on every run: a move order for the
   first villager at step 0, a house that same villager raises from step 60, a villager
   trained at the Town Center at step 1500, two rng draws (steps 7 and 1501), then plain
   stepping to STEPS. The card cannot write `createState(seed)` -- createState takes no
   argument (src/boot.js) and resetGame is the seeded entry point (docs/TODO.md 22), so
   that is how every game here is built.
   The two draws are why the rng assertions below are worth anything: an idle pair of
   villages fights nothing, so the sim never reaches nextRand on its own and a game whose
   rng still lived outside the state would have looked identical too. The transcript is
   returned as well, so a command that quietly refused -- and so changed nothing -- cannot
   pass by leaving two equally empty games to match. */
function play(seed) {
  const g = AoE2.createState();
  AoE2.resetGame(g, seed);
  const home = g.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
  const vill = g.units.find((u) => u.team === 0 && u.kind === 'villager');
  const ring = AoE2.standingSpots(g, home, 5);
  const dest = ring[4] || ring[ring.length - 1];      // a walkable ring tile to march to
  const lot = freeSpotAround(g.world, g, home.tx + 4, home.ty + 4, AoE2.BLD.house.w, AoE2.BLD.house.h, 8);
  const draw = [];
  const script = {
    0: () => {                                        // the move order, then watch it taken
      g.selection = [vill.id];
      AoE2.issueOrder(g, dest.x, dest.y);
      return 'move:' + vill.order.kind;
    },
    7: () => { draw.push(AoE2.nextRand(g)); return ''; },
    60: () => 'build:' + (AoE2.build(g, 'house', lot.tx * TILE + TILE / 2, lot.ty * TILE + TILE / 2) || { kind: 'refused' }).kind,
    1500: () => 'train:' + (AoE2.train(g, home, 'villager') ? 'queued' : 'refused'),
    1501: () => { draw.push(AoE2.nextRand(g)); return ''; },
  };
  const t0 = Date.now();                              // wall clock for the budget below only
  const log = [];
  for (let i = 0; i < STEPS; i++) {
    if (script[i]) { const s = script[i](); if (s) log.push(s); }
    AoE2.stepSim(g, CFG.SIM_DT);
  }
  return { json: JSON.stringify(AoE2.encodeState(g)), rng: g.rngState, seed: g.world.seed,
           log: log.join(' '), draws: draw.join(','), units: g.units.length, ms: Date.now() - t0 };
}

const t0 = Date.now();
const A = play(SEED_AB);
const B = play(SEED_AB);
const C = play(SEED_C);
const ms = Date.now() - t0;

/* ---- A vs B: the same seed, played the same way, is the same game, byte for byte ---- */
const diffAt = (() => {                               // the first byte that disagrees, or -1
  const n = Math.min(A.json.length, B.json.length);
  for (let i = 0; i < n; i++) if (A.json[i] !== B.json[i]) return i;
  return A.json.length === B.json.length ? -1 : n;
})();
check(A.json === B.json, 'sim: two games from one seed stay identical for 3000 steps',
  A.json === B.json ? A.json.length + ' bytes equal'
    : 'first diff at byte ' + diffAt + ' of ' + A.json.length + ': ' +
      A.json.slice(Math.max(0, diffAt - 60), diffAt + 60) + ' <-> ' +
      B.json.slice(Math.max(0, diffAt - 60), diffAt + 60));
check(A.log === 'move:move build:house train:queued' && B.log === A.log,
  'script: every command in the script was accepted, in both games', A.log + ' | ' + B.log);

/* ---- the rng: G6 put the stream in the state (Game.rngState, read by nextRand) ---- */
check(A.rng === B.rng && A.draws === B.draws, 'rng: the two runs draw the same numbers and end alike',
  'draws ' + A.draws + ' -> ' + A.rng + ' | ' + B.draws + ' -> ' + B.rng);
check(A.rng !== A.seed, 'rng: the run consumes the stream instead of sitting on its seed',
  'seed ' + A.seed + ' rng ' + A.rng);

/* ---- C: the same script on another seed must NOT be the same game ---- */
check(C.json !== A.json, 'sim: the same script on another seed gives a different state',
  C.json.length + ' bytes vs ' + A.json.length);
check(C.seed !== A.seed && A.seed === B.seed, 'world: the seed the state carries is the seed asked for',
  'A=' + A.seed + ' B=' + B.seed + ' C=' + C.seed);
check(C.rng !== A.rng && C.draws !== A.draws, 'rng: the other seed draws and ends elsewhere',
  'draws ' + C.draws + ' -> ' + C.rng);

/* ---- and the card asks for a fast file: three villages, not three matches ---- */
check(ms < 5000, 'perf: the three 3000-step runs finish in under 5 s', ms + ' ms');

report();
