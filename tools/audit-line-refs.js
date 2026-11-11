#!/usr/bin/env node
/* audit-line-refs.js -- verify the docs' line references against index.html.

   1. every `index.html:NNN` / `index.html:NNN-NNN` in the docs must be in range, and the
      cited span must contain a symbol from the citing sentence (the citation may wrap, so
      the line above is searched too): "setAtlas (index.html:343)" fails the moment
      setAtlas moves away from that line;
   2. the file-map ranges in docs/ARCHITECTURE.md, the named sub-blocks of section 4, and
      the config range in docs/GAME_RULES.md must equal the real spans measured from the
      banners in index.html;
   3. everything in tools/ must be documented in AGENTS.md and README.md;
   4. the `index.html is N lines` claim AGENTS.md quotes for the patch-not-rewrite rule must
      equal the real file length.

   usage: node tools/audit-line-refs.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const lines = src.replace(/\s+$/, '').split('\n'); // == `wc -l index.html`, no phantom last line
const LAST_JS_LINE = lines.reduce((acc, l, i) => (/^\s*<\/?(script|body|html)>\s*$/.test(l) ? acc : i + 1), 0);
const DOCS = ['README.md', 'AGENTS.md', 'docs/ARCHITECTURE.md', 'docs/GAME_RULES.md',
  'docs/CHANGELOG.md', 'docs/ROADMAP.md', 'docs/CONVENTIONS.md'];
const STOP = new Set(['index', 'html', 'the', 'and', 'from', 'with', 'lines', 'see', 'has',
  'section', 'this', 'that', 'file', 'files', 'code', 'docs', 'when', 'into', 'uses', 'used',
  'only', 'image', 'images', 'game', 'games', 'may', 'keep', 'true', 'false', 'null', 'one',
  'same', 'also', 'than', 'but', 'not', 'for', 'its', 'his', 'her', 'their', 'which', 'while',
  'where', 'what', 'size', 'sizes', 'node', 'browser', 'browsers', 'cost', 'dark', 'feudal',
  'food', 'every', 'later', 'age', 'ages', 'banner', 'banners', 'truthful', 'functions',
  'move', 'moved', 'filled', 'fills', 'inject', 'injects', 'injected', 'harnesses', 'harness',
  'place', 'unit', 'units', 'terrain', 'drawn', 'procedurally', 'contains', 'contained',
  'content', 'contents', 'table', 'rows', 'row', 'doc', 'says', 'say', 'cited', 'cite',
  'verifies', 'verify', 'tooling', 'tools', 'tool', 'live', 'site', 'readme']);
const wordSet = (t) => (t.replace(/index\.html:\d+(?:-\d+)?/g, ' ')
  .match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || []).map((w) => w.toLowerCase());

let fail = 0;
const bad = (f, m) => { console.log('FAIL ' + f + ': ' + m); fail++; };
const ok = (f, m) => console.log('ok   ' + f + ': ' + m);

/* ---- index.html structure: numbered sections + named sub-blocks ---- */
// banner shapes in index.html: numbered sections ('4. simulation') and named sub-blocks
// ('economy helpers', plus the trailing 'public surface' banner).
const numbered = [];
const unnumbered = [];
lines.forEach((l, i) => {
  let m = l.match(/^\/\*\s-{4,}\s*(\d+)\.\s+(.+?)\s-{4,}\s\*\/$/);
  if (m) { numbered.push({ num: +m[1], name: m[2].trim(), from: i + 1 }); return; }
  m = l.match(/^\/\*\s-{4,}\s*([A-Za-z][A-Za-z /]*?)\s-{4,}\s\*\/$/);
  if (m) unnumbered.push({ name: m[1].trim(), from: i + 1 });
});
numbered.forEach((s, i) => {
  if (i + 1 < numbered.length) s.to = numbered[i + 1].from - 1;
  else {
    const tail = unnumbered.find((b) => b.from > s.from);
    s.to = tail ? tail.from - 1 : LAST_JS_LINE;
  }
});
unnumbered.forEach((b, i) => {
  const next = unnumbered[i + 1];
  b.to = next ? next.from - 1 : LAST_JS_LINE;
});
const section = (n) => numbered.find((s) => s.num === n);

/* ---- 1. content refs in every doc ---- */
for (const rel of DOCS) {
  const doc = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
  doc.forEach((line, i) => {
    for (const m of line.matchAll(/index\.html:(\d+)(?:-(\d+))?/g)) {
      const from = +m[1];
      const to = Math.max(from, +(m[2] || m[1]));
      if (to > lines.length) { bad(rel, `${m[0]} is past the end of index.html (${lines.length} lines)`); continue; }
      const span = lines.slice(from - 1, to).join('\n').toLowerCase();
      const ids = [...wordSet(line), ...(i ? wordSet(doc[i - 1]) : [])];
      const hit = ids.find((id) => span.includes(id));
      if (!hit) bad(rel, m[0] + ' cites "' + (ids.slice(0, 3).join(',') || 'nothing') + '" but line ' + from + ' reads: "' + lines[from - 1].trim().slice(0, 56) + '"');
      else ok(rel, m[0] + ' -> ' + hit + ' (' + (to - from + 1) + ' line(s) checked)');
    }
  });
}

/* ---- 2. ARCHITECTURE file map + GAME_RULES config range ---- */
const arch = fs.readFileSync(path.join(ROOT, 'docs/ARCHITECTURE.md'), 'utf8');
const rows = [...arch.matchAll(/^\|\s*(\d|—)\s*\|\s*([^|]+?)\s*\|\s*(\d+)-(\d+)\s*\|\s*([^|]*)\|/gm)];
if (!rows.length) bad('docs/ARCHITECTURE.md', 'file map: no rows parsed');
for (const [, num, name, from, to] of rows) {
  const label = name.trim();
  const claimed = from + '-' + to;
  if (num === '—') {
    const last = numbered[numbered.length - 1];
    const truth = unnumbered.find((b) => b.from > last.from);
    if (!truth) { bad('docs/ARCHITECTURE.md', 'no export banner found after the last section'); continue; }
    if (claimed !== truth.from + '-' + truth.to) bad('docs/ARCHITECTURE.md', `public surface says ${claimed}, index.html says ${truth.from}-${truth.to}`);
    else ok('docs/ARCHITECTURE.md', `public surface ${claimed} ("${truth.name}")`);
    continue;
  }
  const s = section(+num);
  if (!s) { bad('docs/ARCHITECTURE.md', `row ${num} "${label}" has no banner in index.html`); continue; }
  if (s.name !== label) { bad('docs/ARCHITECTURE.md', `row ${num} "${label}" != banner "${s.name}"`); continue; }
  if (claimed !== s.from + '-' + s.to) bad('docs/ARCHITECTURE.md', `section ${num} ${label}: doc says ${claimed}, index.html says ${s.from}-${s.to}`);
  else ok('docs/ARCHITECTURE.md', `section ${num} ${label} ${s.from}-${s.to}`);
}

/* named sub-blocks quoted inside a section's Contents cell must match real banners */
for (const row of rows) {
  if (row[1] === '—') continue;
  const s = section(+row[1]);
  if (!s) continue;
  const quoted = [...new Set([...(row[5] || '').matchAll(/`([A-Za-z][A-Za-z \/]*)`\s*\((\d+)\)/g)])];
  for (const [, name, n] of quoted) {
    const b = unnumbered.find((x) => x.name === name.trim());
    if (!b) bad('docs/ARCHITECTURE.md', `section ${row[1]} cites block \`${name}\` (${n}) — no such banner`);
    else if (b.from !== +n) bad('docs/ARCHITECTURE.md', `block \`${name}\` cited as ${n}, banner is at ${b.from}`);
    else if (b.from < s.from || b.from > s.to) bad('docs/ARCHITECTURE.md', `block \`${name}\` (${n}) is not inside section ${row[1]} (${s.from}-${s.to})`);
    else ok('docs/ARCHITECTURE.md', `section ${row[1]} block \`${name}\` at ${n}`);
  }
  const real = unnumbered.filter((b) => b.from > s.from && b.from <= s.to);
  if (real.length !== quoted.length && real.length) {
    bad('docs/ARCHITECTURE.md', `section ${row[1]} has ${real.length} named block(s) [${real.map((b) => b.name).join(', ')}], doc cites ${quoted.length}`);
  }
}

const rules = fs.readFileSync(path.join(ROOT, 'docs/GAME_RULES.md'), 'utf8');
for (const m of rules.matchAll(/§1 config \(lines (\d+)-(\d+)\)/g)) {
  const s = section(1);
  if (!s || s.from + '-' + s.to !== m[1] + '-' + m[2]) bad('docs/GAME_RULES.md', `config range ${m[1]}-${m[2]} != ${s ? s.from + '-' + s.to : 'missing'}`);
  else ok('docs/GAME_RULES.md', `config range ${s.from}-${s.to}`);
}

/* ---- 3. tools/ inventory vs the docs that describe it ---- */
const present = fs.readdirSync(path.join(ROOT, 'tools')).filter((f) => !f.startsWith('.') && f !== 'node_modules').sort();
for (const rel of ['AGENTS.md', 'README.md']) {
  const doc = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const missing = present.filter((f) => !doc.includes(f));
  if (missing.length) bad(rel, `tools not documented: ${missing.join(', ')}`);
  else ok(rel, `all ${present.length} tool(s) documented: ${present.join(', ')}`);
}

/* ---- 4. the file length AGENTS.md quotes ---- */
const agentsDoc = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
for (const m of agentsDoc.matchAll(/`index\.html` is (\d+) lines/g)) {
  if (+m[1] !== lines.length) bad('AGENTS.md', `says index.html is ${m[1]} lines, the file has ${lines.length}`);
  else ok('AGENTS.md', `index.html length ${lines.length}`);
}

console.log('\n' + (fail ? fail + ' ref problem(s)' : 'all doc line refs agree with index.html'));
process.exit(fail ? 1 : 0);
