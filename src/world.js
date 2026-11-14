'use strict';
/* world -- seeded map generation (terrain + resources) and tile queries. No DOM. */

/* The one mulberry32 step, as a pure function of its state: the value returned
   and the state to call it with next (G6 — a resumable rng). mulberry32 below
   wraps it in the classic closure for map generation, nextRand advances the
   number saved on Game, and both draw the identical stream from one seed. */
function randFrom(state) {
  const a = (state + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [a >>> 0, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    const [next, value] = randFrom(a);
    a = next;
    return value;
  };
}

/** Draw the next [0, 1) from Game.rngState and advance the stored state — the
 *  simulation's only rng (the old Game.rnd() closure, src/save.js now saves it). */
function nextRand(Game) {
  const [next, value] = randFrom(Game.rngState);
  Game.rngState = next;
  return value;
}

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Seeded map: grass base, water lakes, forest clumps, gold/stone fields and one
 *  berry cluster per keep. Both castle sites are carved out first, and (like a
 *  real lobby) each site gets its gold field and berry cluster around the Town
 *  Center instead of scatter far away from home. */
function makeWorld(seed) {
  const w = CFG.MAP_W, h = CFG.MAP_H, n = w * h;
  const world = { w, h, seed, type: new Uint8Array(n), amount: new Int32Array(n), shade: new Uint8Array(n) };
  const rnd = mulberry32(seed);
  const idx = (x, y) => y * w + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  for (let i = 0; i < n; i++) world.shade[i] = hash2(i % w, (i / w) | 0, seed) % 3;

  const put = (x, y, t, amt) => {
    if (!inside(x, y) || world.type[idx(x, y)] !== T.GRASS) return false;
    world.type[idx(x, y)] = t;
    world.amount[idx(x, y)] = amt | 0;
    return true;
  };
  const blob = (cx, cy, r, t, amt) => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.sqrt(dx * dx + dy * dy) > r + 0.6 - rnd() * 1.3) continue;  // ragged edge
        put(cx + dx, cy + dy, t, amt);
      }
    }
  };
  const patch = (cx, cy, t, amt) => {                     // small ore/berry patch
    const cells = 2 + ((rnd() * 3) | 0);
    for (let k = 0; k < cells; k++) put(cx + ((rnd() * 3) | 0) - 1, cy + ((rnd() * 3) | 0) - 1, t, amt);
  };

  const siteA = findSite(world, Math.round(w * 0.30), Math.round(h * 0.52), 3);
  const siteB = findSite(world, Math.round(w * 0.72), Math.round(h * 0.46), 3);
  const onSite = (x, y) => nearSite(siteA, x, y) || nearSite(siteB, x, y);

  for (let k = 0; k < 3; k++) {                                     // lakes
    const cx = 3 + ((rnd() * (w - 6)) | 0), cy = 3 + ((rnd() * (h - 6)) | 0);
    if (onSite(cx, cy)) continue;
    blob(cx, cy, 2 + ((rnd() * 3) | 0), T.WATER, 0);
  }
  for (let k = 0; k < 11; k++) {                                    // forests
    const cx = 2 + ((rnd() * (w - 4)) | 0), cy = 2 + ((rnd() * (h - 4)) | 0);
    if (onSite(cx, cy)) continue;
    blob(cx, cy, 2 + ((rnd() * 3) | 0), T.FOREST, CFG.RES.tree);
  }
  for (let k = 0; k < 3; k++) {                                     // extra stone / gold
    const cx = 3 + ((rnd() * (w - 6)) | 0), cy = 3 + ((rnd() * (h - 6)) | 0);
    if (onSite(cx, cy)) continue;
    patch(cx, cy, k < 2 ? T.STONE : T.GOLD, k < 2 ? CFG.RES.stone : CFG.RES.gold);
  }
  /* the guaranteed start: gold 3 tiles off the keep (berries now come from the
     clusters below, not from this ring) */
  let gold = 0;
  const ring = [];
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 3) continue;
      ring.push([siteA.tx + dx, siteA.ty + dy]);
    }
  }
  ring.sort((a, b) => (Math.abs(a[0] - siteA.tx) + Math.abs(a[1] - siteA.ty)) -
                      (Math.abs(b[0] - siteA.tx) + Math.abs(b[1] - siteA.ty)));
  for (const [x, y] of ring) {
    if (put(x, y, T.GOLD, CFG.RES.gold) && ++gold >= 2) break;
  }
  for (let dx = -3; dx <= 3; dx += 2) put(siteB.tx + dx, siteB.ty - 2, T.GOLD, CFG.RES.gold);

  /* one berry cluster per Town Center (replaces the 7 scattered berry patches
     and the 2 ring berries) */
  berryCluster(world, rnd, siteA);
  berryCluster(world, rnd, siteB);
  return world;
}

/** One berry cluster per Town Center: exactly 6 grass tiles at Chebyshev
 *  distance 5..8 from the keep, grown from a seeded anchor into one connected
 *  blob so they read as a bushy patch, not 6 confetti. Only grass neighbours
 *  inside the band are accepted (same rule as makeWorld's put); if a town's
 *  neighbourhood cannot yield 6 tiles the band widens outward, never starves. */
function berryCluster(world, rnd, site) {
  const w = world.w, h = world.h, want = 6;
  const grassAt = (x, y) => x >= 0 && y >= 0 && x < w && y < h && world.type[y * w + x] === T.GRASS;
  const cheb = (x, y) => Math.max(Math.abs(x - site.tx), Math.abs(y - site.ty));
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let best = null;
  for (let hi = 8; hi <= 12 && (!best || best.length < want); hi++) {
    const pool = [];                                   // grass tiles, Chebyshev 5..hi
    for (let y = site.ty - hi; y <= site.ty + hi; y++) {
      for (let x = site.tx - hi; x <= site.tx + hi; x++) {
        if (cheb(x, y) >= 5 && grassAt(x, y)) pool.push(y * w + x);
      }
    }
    if (pool.length < want) continue;                  // too little grass: widen
    for (let a = 0; a < 6 && (!best || best.length < want); a++) {
      const blob = [pool[(rnd() * pool.length) | 0]];  // seeded anchor
      const taken = new Set(blob);
      while (blob.length < want) {                     // grow: grass neighbours in the band
        const opts = [];
        for (const cell of blob) {
          const cx = cell % w, cy = (cell / w) | 0;
          for (const [dx, dy] of NB) {
            const k = (cy + dy) * w + cx + dx;
            if (!taken.has(k) && grassAt(cx + dx, cy + dy) && cheb(cx + dx, cy + dy) <= hi) {
              if (cheb(cx + dx, cy + dy) >= 5) opts.push(k);
            }
          }
        }
        if (!opts.length) break;
        const k = opts[(rnd() * opts.length) | 0];
        taken.add(k);
        blob.push(k);
      }
      if (!best || blob.length > best.length) best = blob;
    }
  }
  if (!best) return [];
  for (const k of best) {
    world.type[k] = T.BERRY;
    world.amount[k] = CFG.RES.berry;
  }
  return best;
}

/** Spiral search for a flat grassy size x size pad closest to (px,py). */
function findSite(world, px, py, size) {
  const w = world.w, h = world.h;
  const fits = (x, y) => {
    if (x < 0 || y < 0 || x + size > w || y + size > h) return false;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (world.type[(y + dy) * w + (x + dx)] !== T.GRASS) return false;
      }
    }
    return true;
  };
  for (let r = 0; r < Math.max(w, h); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (fits(px + dx, py + dy)) return { tx: px + dx, ty: py + dy };
      }
    }
  }
  return { tx: 1, ty: 1 };
}

function nearSite(site, x, y) {
  return Math.abs(x - site.tx) <= 6 && Math.abs(y - site.ty) <= 6;
}

/** Read a harvestable tile: null if out of bounds / not a resource / empty. */
function tileRes(world, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return null;
  const t = world.type[ty * world.w + tx];
  const res = RES_OF_TILE[t];
  if (!res || world.amount[ty * world.w + tx] <= 0) return null;
  return { tx, ty, res };
}

/** First harvestable tile of `res` (or any, if res is null) in ring r. */
function ringRes(world, ux, uy, r, res) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const t = tileRes(world, ux + dx, uy + dy);
      if (t && (!res || t.res === res)) return t;
    }
  }
  return null;
}

/** Search outward for a source of the same resource a villager can switch to. */
function findAlternative(world, unit, res, maxR) {
  const ux = Math.floor(unit.x / CFG.TILE), uy = Math.floor(unit.y / CFG.TILE);
  for (let r = 1; r <= maxR; r++) {
    const t = ringRes(world, ux, uy, r, res);
    if (t) return t;
  }
  return null;
}
