#!/usr/bin/env node
/* =========================================================================
   check-stats.mjs -- prove the game's stats match the vendored tables.

   WHERE UNIT/BUILDING/WORLD NUMBERS LIVE, so index.html and data/ drift:
     - data/units.json and data/buildings.json are the only place those
       numbers are authored (data/README.md names the upstream sources);
     - the `CFG`, `KINDS` and `BLD` blocks in index.html section 1 are
       generated text: this tool renders them from the data and puts them
       back with --write, exactly like tools/gen-atlas.js does for the sprite
       tables. The game never reads the JSON at runtime -- the product is
       still one dependency-free index.html -- it carries the rendered result.
     - unit speeds are the table's tiles/s converted through CFG.TILE, so the
       px/s the engine moves in is derived, never typed.

   usage:
     node tools/check-stats.mjs            # verify; exit 1 + one line per drift
     node tools/check-stats.mjs --write    # regenerate the three blocks, then verify
   ========================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const HTML = path.join(ROOT, 'index.html');
const DATA = path.join(ROOT, 'data');
const WRITE = process.argv.includes('--write');

function fail(msg) {
  console.error('FAIL  ' + msg);
  process.exit(1);
}

const unitsDoc = JSON.parse(fs.readFileSync(path.join(DATA, 'units.json'), 'utf8'));
const bldsDoc = JSON.parse(fs.readFileSync(path.join(DATA, 'buildings.json'), 'utf8'));
const TILE = unitsDoc.cfg.TILE;
function mustNum(v, where) {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${where} is not a number: ${JSON.stringify(v)}`);
  return v;
}
const num = (v, where) => String(mustNum(v, where));

/** `{ food: 50 }` -- resources with a 0 cost are dropped, never printed. */
function inline(obj, where) {
  const keys = Object.keys(obj).filter((k) => obj[k] !== 0);
  if (!keys.length) return '{}';
  return '{ ' + keys.map((k) => `${k}: ${num(obj[k], `${where}.${k}`)}`).join(', ') + ' }';
}

const quoted = (a) => '[' + a.map((s) => `'${s}'`).join(', ') + ']';

/** The value `KINDS.<kind>` must hold: the row plus the tiles/s -> px step. */
function kindValue(u) {
  const where = `data/units.json units.${u.internalName}`;
  return {
    label: u.label,
    hp: mustNum(u.hp, `${where}.hp`),
    speed: Math.round(TILE * mustNum(u.speedTps, `${where}.speedTps`)),
    atk: mustNum(u.atk, `${where}.atk`),
    atkTime: mustNum(u.atkTime, `${where}.atkTime`),
    r: mustNum(u.r, `${where}.r`),
    time: mustNum(u.time, `${where}.time`),
    buildable: typeof u.buildable === 'boolean' ? u.buildable : fail(`${where}.buildable must be true/false`),
    cost: u.cost,
    meleeArmor: mustNum(u.meleeArmor, `${where}.meleeArmor`),
    pierceArmor: mustNum(u.pierceArmor, `${where}.pierceArmor`),
    lineOfSight: mustNum(u.lineOfSight, `${where}.lineOfSight`),
    range: mustNum(u.range, `${where}.range`),
    minRange: mustNum(u.minRange, `${where}.minRange`),
    reload: mustNum(u.reload, `${where}.reload`),
    accuracy: mustNum(u.accuracy, `${where}.accuracy`),
  };
}

/** The value `BLD.<kind>` must hold. */
function bldValue(b) {
  const where = `data/buildings.json buildings.${b.internalName || b.label}`;
  const v = {
    label: b.label,
    hp: mustNum(b.hp, `${where}.hp`),
    w: mustNum(b.w, `${where}.w`),
    h: mustNum(b.h, `${where}.h`),
    cost: b.cost,
    time: mustNum(b.time, `${where}.time`),
    pop: mustNum(b.pop, `${where}.pop`),
    trains: b.trains,
    attack: mustNum(b.attack, `${where}.attack`),
    meleeArmor: mustNum(b.meleeArmor, `${where}.meleeArmor`),
    pierceArmor: mustNum(b.pierceArmor, `${where}.pierceArmor`),
    lineOfSight: mustNum(b.lineOfSight, `${where}.lineOfSight`),
    range: mustNum(b.range, `${where}.range`),
    reload: mustNum(b.reload, `${where}.reload`),
    accuracy: mustNum(b.accuracy, `${where}.accuracy`),
    garrisonCapacity: mustNum(b.garrisonCapacity, `${where}.garrisonCapacity`),
  };
  if (b.field !== undefined) v.field = mustNum(b.field, `${where}.field`);
  return v;
}

/* ------------------------------ the renderer ----------------------------- */

const BANNER = (file) => `// GENERATED FROM ${file} -- edit the data or run \`node tools/check-stats.mjs --write\`.`;

function renderCFG() {
  const cfg = unitsDoc.cfg, notes = unitsDoc.cfgNotes || {};
  const body = Object.keys(cfg).map((k) => {
    const v = cfg[k];
    const line = `  ${k}: ${typeof v === 'object' ? inline(v, `cfg.${k}`) : num(v, `cfg.${k}`)},`;
    return notes[k] ? line.padEnd(34) + '// ' + notes[k] : line;
  }).join('\n');
  return `${BANNER('data/units.json')}\nconst CFG = {\n${body}\n};`;
}

function renderKINDS() {
  const body = Object.keys(unitsDoc.units).map((name) => {
    const v = kindValue(unitsDoc.units[name]);
    return [
      `  ${name}: {`,
      `    label: '${v.label}', hp: ${v.hp}, speed: ${v.speed}, atk: ${v.atk},`,
      `    atkTime: ${v.atkTime}, r: ${v.r}, time: ${v.time}, buildable: ${v.buildable},`,
      `    cost: ${inline(v.cost, `units.${name}.cost`)}, meleeArmor: ${v.meleeArmor},`,
      `    pierceArmor: ${v.pierceArmor}, lineOfSight: ${v.lineOfSight},`,
      `    range: ${v.range}, minRange: ${v.minRange}, reload: ${v.reload}, accuracy: ${v.accuracy},`,
      `  },`,
    ].join('\n');
  }).join('\n');
  return `${BANNER('data/units.json')}\nconst KINDS = {\n${body}\n};`;
}

function renderBLD() {
  const body = Object.keys(bldsDoc.buildings).map((name) => {
    const v = bldValue(bldsDoc.buildings[name]);
    const extras = ['attack', 'meleeArmor', 'pierceArmor', 'lineOfSight', 'range', 'reload',
                    'accuracy', 'garrisonCapacity', 'field'].filter((k) => v[k] !== undefined);
    return [
      `  ${name}: {`,
      `    label: '${v.label}', hp: ${v.hp}, w: ${v.w}, h: ${v.h},`,
      `    cost: ${inline(v.cost, `buildings.${name}.cost`)}, time: ${v.time}, pop: ${v.pop},`,
      `    trains: ${v.trains.length ? quoted(v.trains) : '[]'},`,
      `    ${extras.map((k) => `${k}: ${v[k]}`).join(', ')},`,
      `  },`,
    ].join('\n');
  }).join('\n');
  return `${BANNER('data/buildings.json')}\nconst BLD = {\n${body}\n};`;
}

/* ------------------------- index.html: read and write -------------------- */

const scriptSource = () => {
  const html = fs.readFileSync(HTML, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) fail('no <script> block found in ' + HTML);
  return m[1];
};

/** The same trick tools/gen-atlas.js uses: load the game's script and read
 *  the exported object, so the check compares live values, not text. */
function gameSurface() {
  const tmp = path.join(HERE, '.extracted-stats.js');
  fs.writeFileSync(tmp, scriptSource());
  try {
    const required = createRequire(import.meta.url)(tmp);
    if (!required || !required.CFG || !required.KINDS || !required.BLD) {
      fail('index.html does not export CFG / KINDS / BLD');
    }
    return required;
  } finally {
    fs.unlinkSync(tmp);
  }
}

function replaceBlock(html, name, rendered) {
  const re = new RegExp(`(?:^|\n)(?:(// GENERATED FROM [^\n]*\n)?const ${name} = \\{[\\s\\S]*?\n\\};)`);
  const m = re.exec(html);
  if (!m) fail(`no \`const ${name} = { ... };\` block found in index.html`);
  const start = m.index + (m[0] === '\n' ? 1 : 0);
  return html.slice(0, start) + rendered + html.slice(m.index + m[0].length);
}

function writeBlocks() {
  const before = fs.readFileSync(HTML, 'utf8');
  fs.writeFileSync(HTML, replaceBlock(replaceBlock(replaceBlock(before, 'CFG', renderCFG()),
    'KINDS', renderKINDS()), 'BLD', renderBLD()));
  console.log('write index.html section 1 regenerated from data/ (CFG, KINDS, BLD)');
}

/* -------------------------------- compare -------------------------------- */

const fmt = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

function diffObject(prefix, expected, actual, out) {
  let n = 0;
  for (const k of Object.keys(expected)) {
    const e = expected[k];
    if (typeof e === 'object' && e !== null && !Array.isArray(e)) {
      if (typeof actual?.[k] !== 'object' || actual?.[k] === null) {
        out.push(`${prefix}.${k} index.html:absent data:${fmt(e)}`);
        continue;
      }
      n += diffObject(`${prefix}.${k}`, e, actual[k], out);
      continue;
    }
    n++;
    const a = actual === undefined ? undefined : actual[k];
    if (a === undefined) out.push(`${prefix}.${k} index.html:absent data:${fmt(e)}`);
    else if (Array.isArray(e) ? JSON.stringify(a) !== JSON.stringify(e) : a !== e) {
      out.push(`${prefix}.${k} index.html:${fmt(a)} data:${fmt(e)}`);
    }
  }
  for (const k of Object.keys(actual || {})) {
    if (!(k in expected)) out.push(`${prefix}.${k} index.html:${fmt(actual[k])} data:absent`);
  }
  return n;
}

if (WRITE) writeBlocks();

const game = gameSurface();
const drift = [];
let fields = 0;

fields += diffObject('CFG', unitsDoc.cfg, game.CFG, drift);
for (const name of Object.keys(unitsDoc.units)) {
  if (!(name in game.KINDS)) drift.push(`KINDS.${name} index.html:absent data:present`);
  else fields += diffObject(`KINDS.${name}`, kindValue(unitsDoc.units[name]), game.KINDS[name], drift);
}
for (const name of Object.keys(game.KINDS)) {
  if (!(name in unitsDoc.units)) drift.push(`KINDS.${name} index.html:present data:absent`);
}
for (const name of Object.keys(bldsDoc.buildings)) {
  if (!(name in game.BLD)) drift.push(`BLD.${name} index.html:absent data:present`);
  else fields += diffObject(`BLD.${name}`, bldValue(bldsDoc.buildings[name]), game.BLD[name], drift);
}
for (const name of Object.keys(game.BLD)) {
  if (!(name in bldsDoc.buildings)) drift.push(`BLD.${name} index.html:present data:absent`);
}

if (drift.length) {
  for (const line of drift) console.log('DRIFT ' + line);
  console.error(`FAIL  ${drift.length} field(s) in index.html disagree with data/ (${fields} checked)`);
  process.exit(1);
}
console.log(`ok    index.html matches data/ -- ${fields} fields checked (CFG, ${Object.keys(unitsDoc.units).length} kinds, ${Object.keys(bldsDoc.buildings).length} buildings)`);
