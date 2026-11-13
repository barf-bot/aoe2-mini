'use strict';
/* checks/13-render.js -- canvas draw calls: where the placement ghost is painted and
   where unit sprites are blitted. Runs on its own (`node tools/checks/13-render.js`)
   against a freshly booted game. */

const {
  AoE2, bootFixture, check, freeSpotAround, report,
} = require('../lib/harness');

/* ---- 16. render: the placement ghost (docs/TODO.md P0-2) ------------- */
/* Game.cursor is a world coordinate (toWorld in src/input.js), and drawGhost multiplied
   the tile back out -- `tx * CFG.TILE` -- without subtracting Game.cam like every other
   draw function does. So the ghost sat on the cursor only while the camera was at 0,0;
   with the camera at (338, 900) it was painted 338 px to the right and 900 px above the
   pointer, mostly off-screen (verified). Counted draw calls could not see that, so the
   harness context now records the arguments (tools/lib/harness.js §2) and this check
   reads the rectangles back. A hover 200 px right and 140 px down from the view corner
   has to paint the house footprint -- BLD.house is 2x2 tiles -- on the same view-space
   rectangle at every camera, so one row per camera reports both halves of the ghost. */
const TS = AoE2.CFG.TILE;
const OFF = [200, 140];                            // the pointer, inside the view
const CAMS = [[338, 900], [0, 0], [912, 1412]];    // reported, the one case that worked, the far corner

/** Arm a house with the pointer at OFF for the given camera, paint one frame, and answer
 *  the fillRect / strokeRect the ghost left in the recorded draw calls ('none' if absent,
 *  '2x' if the frame painted that rectangle more than once). */
const ghostAt = (st, cam) => {
  const def = AoE2.BLD.house;
  st.cam = { x: cam[0], y: cam[1] };
  st.placing = 'house';
  st.cursor = { x: cam[0] + OFF[0], y: cam[1] + OFF[1] };
  const tx = Math.floor(st.cursor.x / TS), ty = Math.floor(st.cursor.y / TS);
  const x = tx * TS - cam[0], y = ty * TS - cam[1];            // that tile, in view space
  const want = {
    fill: [x, y, def.w * TS, def.h * TS].join(),
    stroke: [x + .5, y + .5, def.w * TS - 1, def.h * TS - 1].join(),
  };
  st.view.ctx.clearOps();
  AoE2.renderFrame(st);
  const painted = (m, args) => {
    const hits = st.view.ctx.ops.filter((o) => o[0] === m && o[1].join() === args);
    return hits.length === 1 ? hits[0][1].join() : hits.length + 'x';
  };
  return { want, fill: painted('fillRect', want.fill), stroke: painted('strokeRect', want.stroke) };
};

bootFixture(undefined, (doc, st) => {
  for (const cam of CAMS) {
    const g = ghostAt(st, cam);
    check(g.fill === g.want.fill && g.stroke === g.want.stroke,
      'render: the ghost covers the tile under the pointer at camera (' + cam[0] + ', ' + cam[1] + ')',
      'want fill=' + g.want.fill + ' stroke=' + g.want.stroke +
      ' -> fill=' + g.fill + ' stroke=' + g.stroke);
  }
});

/* ---- 16b. render: the ghost colour is build's rule (docs/TODO.md P0-3) - */
/* drawGhost graded the tile with siteFree alone while build refuses more than an
   unbuildable footprint (a kind whose `age` gate is shut answers 'requires
   Feudal Age'), so `e` in a Dark Age village showed a green ghost over land the
   click would never take. The colour now comes from the one rule build uses
   (canPlaceAt in src/commands.js), and the recorded fill style proves it: the
   ghost is green exactly where a click would build. */
const GREEN = 'rgba(111,191,115,.6)', RED = 'rgba(209,88,79,.6)';

/** The fillStyle the ghost paints the footprint of `kind` at tile (tx, ty) with the
 *  camera at the world origin ('none' / '2x' when the frame painted it zero / many times). */
const ghostFill = (st, kind, tx, ty) => {
  const def = AoE2.BLD[kind];
  st.cam = { x: 0, y: 0 };
  st.placing = kind;
  st.cursor = { x: tx * TS + 4, y: ty * TS + 4 };
  st.view.ctx.clearOps();
  AoE2.renderFrame(st);
  const rect = [tx * TS, ty * TS, def.w * TS, def.h * TS].join();
  const hits = st.view.ctx.ops.filter((o) => o[0] === 'fillRect' && o[1].join() === rect);
  return hits.length === 1 ? hits[0][2] : hits.length + 'x';
};
const ghostCase = (st, name, kind, tx, ty, want) => {
  const painted = ghostFill(st, kind, tx, ty);
  check(painted === want, name, 'painted ' + painted + ' want ' + want);
};

bootFixture(undefined, (doc, st) => {
  const own = st.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
  const free = freeSpotAround(st.world, st, own.tx, own.ty, 2, 2, 8);
  check(!!free, 'site: a free 2x2 pad beside the Town Center exists to hover',
    free ? 'tile ' + free.tx + ',' + free.ty : 'none');
  if (!free) return;
  ghostCase(st, 'render: a house ghost over free grass is green', 'house', free.tx, free.ty, GREEN);
  ghostCase(st, 'render: a house ghost over the Town Center footprint is red', 'house', own.tx, own.ty, RED);
  ghostCase(st, 'render: an age-gated kind is red while its age is locked', 'market', free.tx, free.ty, RED);
  st.age = 1;
  ghostCase(st, 'render: the same kind is green once its age is reached', 'market', free.tx, free.ty, GREEN);
});

/* ---- 16c. render: units are blitted from their anchor (docs/TODO.md P1-7) - */
/* A cell's ax/ay is the art pixel that is the figure's feet, and it is the only
   correct place to put the drawImage destination: centring the drawn box (the old
   behaviour, one fixed 20x20 box per kind) left the figure standing wherever its
   frame padding happened to be. Mirroring a leftward unit keeps the same
   relationship -- the destination rect is placed in the translated space either
   way, so dx = -ax for both facings -- so the feet stay on the unit. */
const paintedSprite = (st, u, face) => {
  u.face = face;
  u.anim = 0;                                       // no walk bob: the frame holds its cell
  u.order = { kind: 'idle' };
  st.cam = { x: u.x, y: u.y };                      // the unit at the view origin
  st.view.ctx.clearOps();
  AoE2.renderFrame(st);
  const f = AoE2.spriteFor(u.kind, u.team, 'idle');
  const hit = st.view.ctx.ops.find((o) => o[0] === 'drawImage' && o[1][1] === f.sx && o[1][2] === f.sy);
  return hit ? { src: [hit[1][1], hit[1][2], hit[1][3], hit[1][4]].join(),
    dest: [hit[1][5], hit[1][6]].join(), size: [hit[1][7], hit[1][8]].join() } : null;
};

bootFixture(undefined, (doc, st) => {
  AoE2.setAtlas(st, { tag: 'probe-atlas' });        // the sheet to blit, no canvas backend needed
  const bad = [];
  for (const kind of ['villager', 'militia']) {
    for (const face of [1, -1]) {
      const u = st.units.find((z) => z.kind === kind && z.team === 0);
      if (!u) { bad.push(`${kind}: no unit of this kind in the starting village`); continue; }
      const got = paintedSprite(st, u, face);
      const f = AoE2.spriteFor(kind, 0, 'idle');
      if (!got) bad.push(`${kind} facing ${face}: its idle cell was not blitted at all`);
      else if (got.dest !== [-f.ax, -f.ay].join() || got.size !== [f.dw, f.dh].join())
        bad.push(`${kind} facing ${face}: cell ${got.src} blitted at ${got.dest} size ${got.size}, `
          + `want ${[-f.ax, -f.ay].join()} size ${[f.dw, f.dh].join()}`);
    }
  }
  check(bad.length === 0, 'render: every unit is blitted with its cell feet anchor on its position (both facings)',
    bad.length ? bad.join(' | ') : 'villager and militia, facing right and left, drawn at their cell size');
});

/* ---- 16d. render: a construction site is the building fading in (docs/TODO.md P1-8) - */
/* A site was a flat tan rectangle with a 4 px bar: nothing said *which* building was
   going up, and the moment it finished the rectangle swapped for the art. drawBuildings
   now paints the same thing a finished building paints -- the atlas cell, or the
   procedural body for the kinds without one -- at `FADE(built)`, so the building
   solidifies as it rises and a 0 % site is still on screen (.2, where the old rectangle
   sat) instead of waiting for the bar to move. The two kinds are covered separately
   because they draw differently: house has a BLD_SPRITES cell (blitted with drawImage),
   blacksmith is a noSprite kind (the flat inset rectangle). The old ghost colour must be
   gone with them, which is the half a count of draw calls could never see. */
const FADE = (built) => .2 + .8 * built;             // the ramp drawBuildings documents
const OLD_GHOST = 'rgba(200,165,88,.16)';

/** The alpha the frame painted `b`'s own body with, from the ops of the last rendered
 *  frame ('none' / '2x' when that body was painted zero / several times). */
const bodyAlpha = (st, b) => {
  const x = b.tx * TS - st.cam.x, y = b.ty * TS - st.cam.y, w = b.w * TS, h = b.h * TS;
  const frame = AoE2.bldSpriteFor(b.kind, b.team);
  const body = (o) => (frame && o[0] === 'drawImage')
    ? o[1][1] === frame.sx && o[1][2] === frame.sy && o[1][5] === x && o[1][6] === y &&
      o[1][7] === w && o[1][8] === h
    : o[0] === 'fillRect' && [o[1][0], o[1][1], o[1][2], o[1][3]].join() === [x + 2, y + 2, w - 4, h - 4].join();
  const hits = st.view.ctx.ops.filter(body);
  return hits.length === 1 ? String(hits[0][4]) : hits.length + 'x';
};

bootFixture(undefined, (doc, st) => {
  AoE2.setAtlas(st, { tag: 'probe-atlas' });        // the sheet to blit, no canvas backend needed
  const own = st.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
  const houseSpot = freeSpotAround(st.world, st, own.tx, own.ty, 2, 2, 8);
  const house = houseSpot && AoE2.makeBuilding(st, 'house', 0, houseSpot.tx, houseSpot.ty);
  const smithSpot = house && freeSpotAround(st.world, st, house.tx, house.ty, 1, 1, 4);
  const smith = smithSpot && AoE2.makeBuilding(st, 'blacksmith', 0, smithSpot.tx, smithSpot.ty);
  check(!!house && !!smith, 'site: a 2x2 and a 1x1 pad next to the Town Center exist to build on',
    house && smith ? 'house ' + house.tx + ',' + house.ty + ' / blacksmith ' + smith.tx + ',' + smith.ty : 'none');
  if (!smith) return;

  house.built = .45; smith.built = .45;
  st.cam = { x: house.tx * TS, y: house.ty * TS };   // both sites inside the view
  st.view.ctx.clearOps();
  AoE2.renderFrame(st);
  const ops = st.view.ctx.ops;
  const want = String(FADE(.45));
  const bad = [['house', bodyAlpha(st, house)], ['blacksmith', bodyAlpha(st, smith)]]
    .filter((row) => row[1] !== want).map((row) => row[0] + ' painted at ' + row[1]);
  check(bad.length === 0 && !ops.some((o) => o[2] === OLD_GHOST),
    'render: a half-built site draws the building itself at the fade alpha, ghost rectangle gone',
    (bad.length ? bad.join(' | ') : 'house + blacksmith both at ' + want) +
    (ops.some((o) => o[2] === OLD_GHOST) ? ', ghost rect still painted' : ', no ghost rect'));
});

report();
