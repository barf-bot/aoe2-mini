#!/usr/bin/env node
/* browser-smoke.js -- open the page in a real Chrome and prove it boots.

   Every other tool proves the game without a browser: tools/headless-check.js
   runs the sim against the stub DOM, tools/render-preview.js paints a frame
   through @napi-rs/canvas. This one asks an actual engine: it opens the
   working copy (file://<repo>/index.html) and the live site, waits for the app
   to boot, screenshots each target into tools/out/ and prints one JSON line
   per target -- `{target, title, aoe2, consoleErrors, screenshotSha256}`, where `aoe2` is
   true only if `window.AoE2`, `#hud`, `#view`, `Game.started` and a painted canvas all
   check out from inside the page.

     node tools/browser-smoke.js [--verbose]

   No interactive part. Exit 0 only when every target booted cleanly and
   reported no page errors, so the deploy can be gated on it
   (docs/ROADMAP.md, "Process items"). Needs playwright (npm install --prefix
   tools) and network access for the live target; the game itself stays
   dependency-free -- playwright never enters index.html or src/.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const CHROME_PATH_FILE = '/etc/hermes/chromium-executable-path';
const ARGS = ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'];
const VIEWPORT = { width: 1280, height: 800 };
const TARGETS = [
  { name: 'local', url: 'file://' + path.join(ROOT, 'index.html') },
  { name: 'live', url: 'https://barf-bot.github.io/aoe2-mini/' },
];
const MIN_DISTINCT_COLORS = 24;  // a painted map is hundreds; blank paper is ~1
const VERBOSE = process.argv.includes('--verbose');

function die(msg) {
  console.error('browser-smoke: ' + msg);
  process.exit(1);
}

/* The image ships Chrome for Testing and records it in CHROME_PATH_FILE; that
 * file is the source of truth. Without it, look for a playwright-downloaded
 * chrome-linux64/chrome under $PLAYWRIGHT_BROWSERS_PATH (or the default cache). */
function chromiumExecutable() {
  const declared = fs.existsSync(CHROME_PATH_FILE)
    ? fs.readFileSync(CHROME_PATH_FILE, 'utf8').trim() : '';
  if (declared && fs.existsSync(declared)) return declared;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), '.cache', 'ms-playwright')]
    .filter((r) => r && fs.existsSync(r));
  for (const root of roots) {
    const found = fs.readdirSync(root).sort()
      .map((dir) => path.join(root, dir, 'chrome-linux64', 'chrome'))
      .find((p) => fs.existsSync(p));
    if (found) return found;
  }
  die(`no Chrome to launch: ${CHROME_PATH_FILE} is missing or names a nonexistent `
    + `file, and no chrome-linux64/chrome exists under ${roots.join(', ') || '$PLAYWRIGHT_BROWSERS_PATH unset'}`);
}

function requirePlaywright() {
  try {
    return require('playwright');
  } catch (e) {
    die(`cannot require('playwright') -- run \`npm install --prefix tools\` (${e.message})`);
  }
}

/* Count the distinct colours inside the canvas's own rectangle, so "non-blank"
 * is about the game's drawing surface and not about the header text next to it.
 * The screenshot is taken at deviceScaleFactor 1, so CSS px == image px. */
async function colorsInsideShot(buffer, box) {
  const napi = requireCanvas();
  const shot = await napi.loadImage(buffer);
  const w = Math.max(1, Math.min(Math.round(box.width), shot.width));
  const h = Math.max(1, Math.min(Math.round(box.height), shot.height));
  const canvas = napi.createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(shot, Math.round(box.x), Math.round(box.y), w, h, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const colors = new Set();
  for (let i = 0; i < px.length; i += 4 * 5) {
    colors.add((px[i] << 16 | px[i + 1] << 8 | px[i + 2]) >>> 0);
    if (colors.size >= 4096) break;
  }
  return colors.size;
}

function requireCanvas() {
  try {
    return require('@napi-rs/canvas');
  } catch (e) {
    die(`cannot require('@napi-rs/canvas') -- run \`npm install --prefix tools\` (${e.message})`);
  }
  return null;
}

/* Page state the smoke test asserts on, plus the canvas rect the pixel check
 * needs. `started` is src/boot.js's own flag: boot() raises it only after the
 * view canvas came up, so it catches a boot that died half way. */
async function smokeOne(browser, target) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e && e.stack || e)));
  try {
    await page.goto(target.url, { waitUntil: 'load' });
    const app = await page.evaluate(() => {
      const G = window.Game || null;
      const viewEl = document.getElementById('view');
      const r = viewEl && viewEl.getBoundingClientRect();
      return {
        title: document.title,
        aoe2: !!window.AoE2,
        hud: !!document.getElementById('hud'),
        view: !!viewEl,
        started: !!(G && G.started),
        seed: G && G.world ? G.world.seed : null,
        units: G ? G.units.length : null,
        buildings: G ? (G.buildings || []).length : null,
        box: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
      };
    });
    const file = path.join(OUT, target.name + '.png');
    const buffer = await page.screenshot({ path: file });
    const colors = app.box ? await colorsInsideShot(buffer, app.box) : 0;
    const bootOk = app.aoe2 && app.hud && app.view && app.started
      && colors >= MIN_DISTINCT_COLORS;
    return {
      ok: bootOk && pageErrors.length === 0,
      line: {
        target: target.name,
        title: app.title,
        aoe2: !!bootOk,
        consoleErrors: consoleErrors.length + pageErrors.length,
        screenshotSha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      },
      state: { seed: app.seed, units: app.units, buildings: app.buildings, canvasColors: colors },
      pageErrors,
      consoleErrors,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const executablePath = chromiumExecutable();
  const { chromium } = requirePlaywright();
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath, args: ARGS });
  const results = [];
  for (const target of TARGETS) {
    try {
      results.push(await smokeOne(browser, target));
    } catch (e) {
      results.push({
        ok: false,
        line: { target: target.name, title: null, aoe2: false, consoleErrors: null, screenshotSha256: null },
        error: String(e && e.stack || e),
      });
    }
  }
  await browser.close();
  for (const r of results) {
    console.log(JSON.stringify(r.error ? Object.assign(r.line, { error: r.error.split('\n')[0] }) : r.line));
    if (VERBOSE) console.log('  ' + JSON.stringify({ state: r.state || null, pageErrors: r.pageErrors || [], consoleErrors: (r.consoleErrors || []).slice(0, 5) }));
    else if (!r.ok && r.pageErrors && r.pageErrors.length) console.log('  pageerror: ' + r.pageErrors[0]);
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => die(String(e && e.stack || e)));
