#!/usr/bin/env node
/* audit-line-refs.js -- keep the docs honest about the code.

   1. every `path:NNN` / `path:NNN-NNN` reference in the docs (to index.html, src/* or
      tools/*) must be in range, and the cited span must contain a symbol from the citing
      sentence (the citation may wrap, so the line above is searched too):
      "setAtlas (src/entities.js:8)" fails once setAtlas moves more than a few lines away;
   2. the file map in docs/ARCHITECTURE.md must list exactly the scripts and stylesheets
      index.html loads -- a new src/ file without a row fails, so does a row without a file;
   3. the logic files (DOM column `no` in that map) must not name a browser global;
   4. everything in tools/ must be documented in AGENTS.md and README.md.

   usage: node tools/audit-line-refs.js [-v] [--fix]

   --fix repairs the refs it can place with certainty and writes the doc back: a failing ref
   whose citing sentence names a symbol the target file declares exactly once moves to that
   declaration (a range shifts by the same delta, so its length is kept). The run ends with
   `fixed N, left M` and exits 1 unless nothing needed fixing and nothing is broken -- refs
   it cannot place honestly are reported as left, never guessed at. Without --fix the tool
   only checks, exactly as before.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const DOCS = ['README.md', 'AGENTS.md', 'docs/ARCHITECTURE.md', 'docs/GAME_RULES.md',
  'docs/ROADMAP.md', 'docs/CONVENTIONS.md', 'data/README.md'];
const REF = /((?:index\.html|(?:src|tools)\/[\w./-]+\.(?:js|mjs|css))):(\d+)(?:-(\d+))?/g;
// English glue that would match almost any span; everything else in the citing sentence counts.
const STOP = new Set(['the', 'and', 'from', 'with', 'see', 'has', 'this', 'that', 'when', 'into',
  'only', 'may', 'one', 'same', 'also', 'than', 'but', 'not', 'for', 'its', 'which', 'while',
  'where', 'what', 'every', 'then', 'are', 'was', 'they', 'them', 'each', 'both', 'does', 'instead',
  'index', 'html', 'src', 'tools', 'checks', 'css', 'mjs', 'game', 'true', 'false', 'null', 'const',
  'function', 'return', 'line', 'lines', 'file', 'files', 'code', 'docs']);
const CONTEXT = 3;   // a citation may point inside a function: its name can sit a few lines up
const wordSet = (t) => (t.replace(REF, ' ')
  .match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || []).map((w) => w.toLowerCase()).filter((w) => !STOP.has(w));

let fail = 0, passed = 0, fixedCount = 0, leftCount = 0;
const bad = (f, m) => { console.log('FAIL ' + f + ': ' + m); fail++; };
const ok = (f, m) => { passed++; if (process.argv.includes('-v')) console.log('ok   ' + f + ': ' + m); };

/* ---- 1. line refs in every doc ---- */
const FIX = process.argv.includes('--fix');
const cache = {};
const linesOf = (rel) => {
  if (!(rel in cache)) {
    cache[rel] = fs.existsSync(path.join(ROOT, rel)) ? read(rel).replace(/\s+$/, '').split('\n') : null;
  }
  return cache[rel];
};
// Every line in `rel` that declares a name, in the three forms --fix reads: `function x`,
// `const x` and an object key `x:`. Lower-cased, the way wordSet returns them.
const declCache = {};
const declarations = (rel) => {
  if (!(rel in declCache)) {
    const m = new Map();
    const add = (name, n) => { const k = name.toLowerCase(); if (!m.has(k)) m.set(k, []); m.get(k).push(n); };
    (linesOf(rel) || []).forEach((l, i) => {
      for (const d of l.matchAll(/\b(?:function|const)\s+([A-Za-z_$][\w$]*)/g)) add(d[1], i + 1);
      const key = l.match(/^\s*(['"`]?)([A-Za-z_$][\w$]*)\1\s*:/);
      if (key) add(key[2], i + 1);
    });
    declCache[rel] = m;
  }
  return declCache[rel];
};
// Where a failing ref belongs. A word the target declares twice proves nothing, so it gives
// no candidate; when several names each give one line, the closest to the number written wins
// -- a stale ref drifts by a few lines, and each ref on a line points at its own symbol.
// null means there is no honest answer, so the ref is left for whoever reads the report.
const relocate = (rel, ids, from) => {
  const decl = declarations(rel);
  const found = [...new Set(ids.filter((w) => (decl.get(w) || []).length === 1).map((w) => decl.get(w)[0]))]
    .sort((a, b) => a - b);
  if (!found.length) return null;
  const best = found.reduce((b, n) => (Math.abs(n - from) < Math.abs(b - from) ? n : b), found[0]);
  return found.some((n) => n !== best && Math.abs(n - from) === Math.abs(best - from)) ? null : best;
};
// The same ref with new numbers, or null: a range keeps its length, and the rewrite has to
// still fit inside the target file.
const rewrite = (rel, m, ids) => {
  const from = +m[2], to = Math.max(from, +(m[3] || m[2]));
  const n = relocate(m[1], ids, from);
  if (n === null || n + to - from > (linesOf(m[1]) || []).length) return null;
  return m[1] + ':' + n + (to > from ? '-' + (n + to - from) : '');
};
// Splice a line's replacements back in without touching a single other byte of the doc.
const applyLine = (line, list) => {
  if (!list) return line;
  let out = '', at = 0;
  for (const e of list) { out += line.slice(at, e.start) + e.text; at = e.end; }
  return out + line.slice(at);
};
for (const rel of DOCS) {
  const doc = read(rel).split('\n');
  const fixes = new Map();   // doc line -> its replacements, in match order
  const report = (i, m, ids, msg) => {
    const nu = FIX ? rewrite(rel, m, ids) : null;
    if (!nu) { bad(rel, msg); leftCount++; return; }
    console.log('fix  ' + rel + ': ' + m[0] + ' -> ' + nu);
    fixedCount++;
    (fixes.get(i) || fixes.set(i, []).get(i)).push({ start: m.index, end: m.index + m[0].length, text: nu });
  };
  doc.forEach((line, i) => {
    for (const m of line.matchAll(REF)) {
      const lines = linesOf(m[1]);
      if (!lines) { report(i, m, [], `${m[0]} cites a file that does not exist`); continue; }
      const from = +m[2];
      const to = Math.max(from, +(m[3] || m[2]));
      const ids = wordSet(line).concat(i ? wordSet(doc[i - 1]) : []);
      if (to > lines.length) { report(i, m, ids, `${m[0]} is past the end of ${m[1]} (${lines.length} lines)`); continue; }
      const span = lines.slice(Math.max(0, from - 1 - CONTEXT), to + CONTEXT).join('\n').toLowerCase();
      const hit = ids.find((id) => span.includes(id));
      if (!hit) report(i, m, ids, m[0] + ' cites "' + (ids.slice(0, 3).join(',') || 'nothing') + '" but line ' + from + ' reads: "' + lines[from - 1].trim().slice(0, 56) + '"');
      else ok(rel, m[0] + ' -> ' + hit + ' (' + (to - from + 1) + ' line(s) checked)');
    }
  });
  if (fixes.size) fs.writeFileSync(path.join(ROOT, rel), doc.map((l, i) => applyLine(l, fixes.get(i))).join('\n'));
}

/* ---- 2. ARCHITECTURE file map vs what index.html loads ---- */
const html = read('index.html');
const loaded = [...html.matchAll(/<script\s+src="([^"]+)"/g), ...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)].map((m) => m[1]);
const onDisk = fs.readdirSync(path.join(ROOT, 'src')).map((f) => 'src/' + f);
const rows = [...read('docs/ARCHITECTURE.md').matchAll(/^\|\s*`(src\/[^`]+)`\s*\|\s*([^|]*?)\s*\|/gm)].map((m) => ({ file: m[1], dom: m[2] }));
if (!rows.length) bad('docs/ARCHITECTURE.md', 'file map: no rows parsed');
for (const f of onDisk) {
  if (!loaded.includes(f)) bad('index.html', `${f} exists but index.html does not load it`);
  else if (!rows.some((r) => r.file === f)) bad('docs/ARCHITECTURE.md', `file map has no row for ${f}`);
  else ok('docs/ARCHITECTURE.md', `file map lists ${f}`);
}
for (const f of loaded) if (!onDisk.includes(f)) bad('index.html', `loads ${f}, which does not exist`);
for (const r of rows) if (!onDisk.includes(r.file)) bad('docs/ARCHITECTURE.md', `file map row ${r.file} has no file`);
const order = (list) => list.filter((f) => f.endsWith('.js')).join(' ');
if (order(rows.map((r) => r.file)) !== order(loaded)) bad('docs/ARCHITECTURE.md', 'file map order differs from the load order in index.html');

/* ---- 3. the logic files stay DOM-free ---- */
const BROWSER = /\b(?:document|window|navigator|localStorage)\s*[.[]|typeof\s+(?:document|window)\b|\bnew\s+Image\b|\bAudioContext\b|\brequestAnimationFrame\b/;
for (const r of rows.filter((x) => x.dom === 'no')) {
  if (!onDisk.includes(r.file)) continue;
  const hits = read(r.file).split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => BROWSER.test(l.replace(/\/\/.*$/, '')));
  if (hits.length) bad(r.file, `marked DOM-free but line ${hits[0][0]} reads: "${hits[0][1].trim().slice(0, 60)}"`);
  else ok(r.file, 'names no browser global');
}

/* ---- 4. tools/ inventory vs the docs that describe it ---- */
const present = fs.readdirSync(path.join(ROOT, 'tools'), { withFileTypes: true })
  .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules' && !/^package(-lock)?\.json$/.test(e.name))
  .map((e) => (e.isDirectory() ? 'tools/' + e.name + '/' : e.name)).sort();
for (const rel of ['AGENTS.md', 'README.md']) {
  const doc = read(rel);
  const missing = present.filter((f) => !doc.includes(f));
  if (missing.length) bad(rel, `tools not documented: ${missing.join(', ')}`);
  else ok(rel, `all ${present.length} tool(s) documented: ${present.join(', ')}`);
}

if (FIX) console.log('fixed ' + fixedCount + ', left ' + leftCount);
console.log(fail ? fail + ' problem(s), ' + passed + ' ok' : passed + ' doc checks ok: line refs, file map, DOM-free rule and tool inventory agree with the code');
process.exit(fail || (FIX && fixedCount) ? 1 : 0);
