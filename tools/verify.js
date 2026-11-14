#!/usr/bin/env node
/* verify.js -- one command, one verdict (docs/plans/2026-11-14-strix-local-roadmap.md G1).

   Runs every check the repo defines, in the order .github/workflows/check.yml runs them,
   stops at the first failure, and ends with exactly one line: `VERIFY OK` (exit 0) or
   `VERIFY FAIL: <step>` (exit 1). Each step's own output is streamed, so a failure leaves
   behind the log the next session needs to fix the work.

     node tools/verify.js          # or: npm run verify --prefix tools

   Plain node, no dependencies. Paths resolve from the repo root (this file's directory's
   parent), never from the caller's cwd, so npm can be invoked however it likes. The render
   step writes its PNG into os.tmpdir() on purpose: a verify run must not rewrite the
   tracked preview.png at the repo root. browser-smoke.js stays out of this — it needs a
   browser and the network, and the five checks here must stay plain node.
 */
'use strict';
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const TMP_PREVIEW = path.join(os.tmpdir(), 'preview.png');

/* `step` is the name printed in the verdict line; `cmd` is what gets echoed before the
 * run; `argv` is the real spawn (absolute paths, cwd forced to ROOT). The git diff belongs
 * to gen-atlas: together they prove the generated files match what the tools would write. */
const STEPS = [
  { step: 'headless-check', cmd: 'node tools/headless-check.js -q',
    argv: [NODE, path.join(ROOT, 'tools', 'headless-check.js'), '-q'] },
  { step: 'check-stats', cmd: 'node tools/check-stats.mjs',
    argv: [NODE, path.join(ROOT, 'tools', 'check-stats.mjs')] },
  { step: 'audit-line-refs', cmd: 'node tools/audit-line-refs.js',
    argv: [NODE, path.join(ROOT, 'tools', 'audit-line-refs.js')] },
  { step: 'gen-atlas', cmd: 'node tools/gen-atlas.js',
    argv: [NODE, path.join(ROOT, 'tools', 'gen-atlas.js')] },
  { step: 'gen-atlas', cmd: 'git diff --exit-code -- src/config.js assets/sprites.png',
    argv: ['git', 'diff', '--exit-code', '--', 'src/config.js', 'assets/sprites.png'] },
  { step: 'render-preview', cmd: `node tools/render-preview.js --out ${TMP_PREVIEW}`,
    argv: [NODE, path.join(ROOT, 'tools', 'render-preview.js'), '--out', TMP_PREVIEW] },
];

const run = (s) => {
  console.log('$ ' + s.cmd);
  const r = spawnSync(s.argv[0], s.argv.slice(1), { cwd: ROOT, stdio: 'inherit' });
  if (r.error) console.log(r.error.message || String(r.error));
  else if (r.status === null) console.log(`killed by signal ${r.signal}`);
  return r.status === 0;
};

for (const s of STEPS) {
  if (!run(s)) {
    console.log(`VERIFY FAIL: ${s.step}`);
    process.exit(1);
  }
}
console.log('VERIFY OK');
