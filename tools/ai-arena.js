#!/usr/bin/env node
/* =========================================================================
   ai-arena.js -- headless match runner
   (docs/plans/2026-11-14-strix-local-roadmap.md card G7).

   Plays games on the CPU -- no browser, no npm dependencies -- and prints one
   fixed-format table. That table is the deliverable: every Phase-2 card (A1..A10)
   pastes this tool's before/after output into its commit message body, so the
   columns and the summary line never change shape.

     usage: node tools/ai-arena.js [--seeds 1-10|1,3,5] [--minutes 20] [--blue idle|ai] [--json]

   A game is `createState()` + `resetGame(g, seed)` + `g.started = true`, stepped
   `stepSim(g, CFG.SIM_DT)` for `minutes x 60 / SIM_DT` steps (60 s = 1800 steps),
   stopping the moment `g.result` is set and sampled once per simulated minute.
   Red's brain runs inside stepSim (`aiStep` in `src/ai.js`); blue's runs through
   `stepBlue` below, which is why `--blue ai` exists before card A1 does.

   Reproducibility is the tool's whole value: the same arguments print a
   byte-identical table on every run and every machine, because the step path
   reads no wall clock and no ambient rng -- card G6 (`6fcf0d5`) moved the clock to
   a fixed `CFG.SIM_DT` and put `rngState` in the state, and card G8 (`925d17f`,
   `tools/checks/14-determinism.js`) is the check that proves two games built from
   one seed stay byte-for-byte equal. Prove any change to this file the same way:
   `diff <(node tools/ai-arena.js) <(node tools/ai-arena.js)` must be empty.

   Columns, in this fixed order: seed, winner, end, red v/f/b, blue v/f/b,
   red f/w/g/s, blue f/w/g/s.
   - winner comes from `Game.result`, which is written from team 0's seat
     (`setResult` in `src/entities.js`): `victory` means blue's Town Center stands,
     `defeat` means red's, `open` means neither fell inside the time limit.
   - v/f/b is villagers / fighters / buildings for that team: every living unit
     (garrisoned ones still count, the way popUsed counts them) split by whether
     its kind is `villager`, plus every building the team owns, unfinished sites
     included -- a site is the evidence that a build order was issued at all.
   - f/w/g/s is the team's *current stockpile*, not its lifetime haul: the game
     does not track gathered-per-resource yet (card S5), so the column is labelled
     stockpile and is what S5 will replace. Spend shows up here as a smaller pile.

   `--json` prints the same header line, the same summary line and every seed's
   minute samples as one machine-readable object, so a card can diff two runs field
   by field instead of pasting a table; the table rows are a projection of exactly
   that data.

   --blue ai today: accepted, routed, and honest. `aiStep` drives team 1 only and
   `src/main.js` exports no team-0 brain yet, so the flag runs the same idle player
   and the header reads `blue=ai pending-A1 (idle)` -- see stepBlue.
   ========================================================================= */
'use strict';

const { loadGame } = require('./lib/load-game');

const USAGE = 'usage: node tools/ai-arena.js [--seeds 1-10|1,3,5] [--minutes 20] [--blue idle|ai] [--json]';
// [header, width]. Widths are constants, not per-run maxima: a value that changes
// length must not shift the columns, or two runs of the same args stop diffing clean.
// Each width is the header plus room for the widest value it can hold.
const COLS = [['seed', 6], ['winner', 7], ['end', 7], ['red v/f/b', 11], ['blue v/f/b', 11],
  ['red f/w/g/s', 21], ['blue f/w/g/s', 0]];
const WINNER = { victory: 'blue', defeat: 'red' };   // Game.result speaks for team 0
const SAMPLE_SECS = 60;        // one sample per simulated minute
const POP_MINUTE = 12;         // the summary's reference minute, fixed by the card
const BLUE = ['idle', 'ai'];
const PENDING = 'A1';          // the card that gives team 0 a brain

const AoE2 = loadGame({ isolated: true });
const CFG = AoE2.CFG;

/* ---- arguments ------------------------------------------------------------ */

function die(message) {
  console.error(message + '\n' + USAGE);
  process.exit(2);
}

/** `--seeds 1-10`, `--seeds 1,3,5`, `--seeds 7` -> [1..10] / [1,3,5] / [7]. */
function parseSeeds(text) {
  const seeds = new Set();
  for (const part of String(text).split(',')) {
    const m = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
    if (!m) die(`--seeds takes a range (1-10) or a list (1,3,5), got "${part}"`);
    const from = Number(m[1]), to = m[2] === undefined ? from : Number(m[2]);
    if (to < from) die(`--seeds range "${part}" runs backwards`);
    for (let s = from; s <= to; s++) seeds.add(s);
  }
  if (!seeds.size) die('--seeds is empty');
  return [...seeds].sort((a, b) => a - b);
}

function parseArgs(argv) {
  const args = { seeds: '1-10', minutes: 20, blue: 'idle', json: false, help: false };
  // value of a flag, written either `--seeds 1-10` or `--seeds=1-10`
  const take = (i) => (argv[i].includes('=')
    ? [argv[i].slice(argv[i].indexOf('=') + 1), i]
    : (i === argv.length - 1 ? die(argv[i] + ' needs a value') : [argv[i + 1], i + 1]));
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i].split('=')[0];
    if (flag === '-h' || flag === '--help') { args.help = true; return args; }
    if (flag === '--json') { args.json = true; continue; }
    if (flag === '--seeds') { const [v, n] = take(i); args.seeds = v; i = n; continue; }
    if (flag === '--minutes') {
      const [v, n] = take(i);
      if (!Number.isFinite(Number(v)) || Number(v) <= 0) die('--minutes must be a positive number');
      args.minutes = Number(v); i = n; continue;
    }
    if (flag === '--blue') {
      const [v, n] = take(i);
      if (!BLUE.includes(v)) die('--blue takes idle or ai');
      args.blue = v; i = n; continue;
    }
    die('unknown argument: ' + argv[i]);
  }
  parseSeeds(args.seeds);   // validate the whole list before any game is played
  return args;
}

/* ---- the two players ------------------------------------------------------ */

/** The team-0 brain, or null. `aiStep` (`src/ai.js`) takes (Game, dt) and drives red,
 *  and `src/main.js` exports no blue one; a three-argument aiStep is what card A1
 *  ships, so anything less still means "nobody plays blue" and the header says so. */
function team0Brain() {
  return typeof AoE2.aiStep === 'function' && AoE2.aiStep.length >= 3 ? AoE2.aiStep : null;
}

/** The one place blue's control lives, so `--blue ai` becomes real without this tool
 *  changing twice: while there is no team-0 brain the flag touches nothing and the
 *  header prints `blue=ai pending-A1 (idle)` instead of faking a player. */
function stepBlue(Game, mode, dt) {
  const brain = team0Brain();
  if (mode === 'ai' && brain) brain(Game, 0, dt);
}

const blueLabel = (mode) => (mode === 'ai' && !team0Brain() ? `ai pending-${PENDING} (idle)` : mode);
const headerLine = (args) => `ai-arena seeds=${args.seeds} minutes=${args.minutes} blue=${blueLabel(args.blue)}`;

/* ---- one match ------------------------------------------------------------ */

const side = (Game, team) => {
  const live = Game.units.filter((u) => u.team === team && !u.dead);
  const villagers = live.filter((u) => u.kind === 'villager').length;
  return {
    villagers,
    fighters: live.length - villagers,
    buildings: Game.buildings.filter((b) => b.team === team).length,
    stockpile: Object.assign({}, Game.res[team]),
  };
};
const sample = (Game) => ({ t: Math.round(Game.time), red: side(Game, 1), blue: side(Game, 0) });
const clock = (secs) => Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');

/** Play `seed` for `minutes` simulated minutes and hand back its samples. */
function play(seed, minutes, mode) {
  const Game = AoE2.createState();
  AoE2.resetGame(Game, seed);
  Game.started = true;
  const steps = Math.max(1, Math.round(minutes * 60 / CFG.SIM_DT));
  const every = Math.max(1, Math.round(SAMPLE_SECS / CFG.SIM_DT));
  const samples = [sample(Game)];                   // t = 0, straight off the seed
  let i = 0;
  for (; i < steps; i++) {
    stepBlue(Game, mode, CFG.SIM_DT);               // blue's turn, then one whole tick
    AoE2.stepSim(Game, CFG.SIM_DT);                 // red's aiStep runs inside this
    if (Game.result || (i + 1) % every === 0) samples.push(sample(Game));
    if (Game.result) break;                         // stepSim freezes on a result; so do we
  }
  const end = Math.round(Game.time);
  const last = samples[samples.length - 1];
  return {
    seed,
    winner: Game.result ? WINNER[Game.result] : 'open',
    end,
    endClock: clock(end),
    red: last.red,
    blue: last.blue,
    samples,
  };
}

/* ---- the report ----------------------------------------------------------- */

const pad = (s, w) => (w ? s.padEnd(w) : s);
const vfs = (s) => `${s.villagers}/${s.fighters}/${s.buildings}`;
const pile = (s) => `${s.stockpile.food}/${s.stockpile.wood}/${s.stockpile.gold}/${s.stockpile.stone}`;

const rowLine = (row) => [String(row.seed), row.winner, row.endClock,
  vfs(row.red), vfs(row.blue), pile(row.red), pile(row.blue)]
  .map((cell, i) => pad(cell, COLS[i][1])).join('');

/** red's pop (villagers + fighters) at `secs`; a match that ended sooner has no later
 *  sample, so its end position stands in -- the label stays `at 12 min` either way. */
const redPopAt = (row, secs) => {
  const near = row.samples.reduce((a, s) =>
    (Math.abs(s.t - secs) < Math.abs(a.t - secs) ? s : a), row.samples[0]);
  return near.red.villagers + near.red.fighters;
};

function summarize(rows) {
  const wins = { red: 0, blue: 0, open: 0 };
  for (const row of rows) wins[row.winner]++;
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  const end = Math.round(mean(rows.map((r) => r.end)));
  const pop = mean(rows.map((r) => redPopAt(r, POP_MINUTE * 60))).toFixed(1);
  return {
    seeds: rows.length, red: wins.red, blue: wins.blue, open: wins.open,
    meanEnd: end, meanEndClock: clock(end), meanRedPopAt12Min: Number(pop),
    line: `red ${wins.red} / blue ${wins.blue} / open ${wins.open}`
      + `  mean end ${clock(end)}  mean red pop at ${POP_MINUTE} min ${pop}`,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }
  const rows = parseSeeds(args.seeds).map((seed) => play(seed, args.minutes, args.blue));
  const header = headerLine(args);
  const summary = summarize(rows);
  if (!args.json) {
    console.log(header);
    console.log(COLS.map(([name, w]) => pad(name, w)).join(''));
    for (const row of rows) console.log(rowLine(row));
    console.log(summary.line);
    return;
  }
  console.log(JSON.stringify({
    tool: 'ai-arena', header,
    args: { seeds: args.seeds, minutes: args.minutes, blue: args.blue },
    columns: COLS.map(([name]) => name), rows, summary,
  }, null, 2));
}

main();
