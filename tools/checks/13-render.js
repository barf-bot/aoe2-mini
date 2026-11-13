'use strict';
/* checks/13-render.js -- canvas draw calls: where the placement ghost is painted.
   Runs on its own (`node tools/checks/13-render.js`) against a freshly booted game. */

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

report();
