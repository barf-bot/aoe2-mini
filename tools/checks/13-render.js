'use strict';
/* checks/13-render.js -- canvas draw calls: where the placement ghost is painted.
   Runs on its own (`node tools/checks/13-render.js`) against a freshly booted game. */

const {
  AoE2, bootFixture, check, report,
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

report();
