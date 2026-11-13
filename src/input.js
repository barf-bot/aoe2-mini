'use strict';
/* input -- pointer (mouse + touch), keyboard, minimap drag, command-bar clicks. */

function pickUnit(Game, x, y) {
  let best = null, bd = Infinity;
  for (const u of Game.units) {
    if (u.dead || u.team !== 0) continue;
    const d = (u.x - x) ** 2 + (u.y - y) ** 2;
    if (d < 64 && d < bd) { bd = d; best = u; }
  }
  return best;
}

function pickBuilding(Game, x, y) {
  const tx = Math.floor(x / CFG.TILE), ty = Math.floor(y / CFG.TILE);
  for (const b of Game.buildings) {
    if (b.team === 0 && tx >= b.tx && tx < b.tx + b.w && ty >= b.ty && ty < b.ty + b.h) return b;
  }
  return null;
}

function unitsInBox(Game, ax, ay, bx, by) {
  return Game.units.filter(u => !u.dead && u.team === 0 && u.x >= ax && u.x <= bx && u.y >= ay && u.y <= by);
}
/** Where a pointer went down, in every frame the command needs: the canvas point
 *  (drag box), the world point (order / build target) and the press identity
 *  (t = timeStamp, id = pointerId) that tells a tap from a hold and one finger
 *  from two. `attachInput` derives it from the event; the pure helpers never
 *  touch the DOM, so the harness can drive mouse and touch through the same code. */
function pointerDown(Game, p) {
  if (Game.placing) { build(Game, Game.placing, p.x, p.y); return; }
  if (Game.drag && p.id !== Game.drag.id) return;   // one live drag: its own pointer
  Game.drag = { x0: p.sx, y0: p.sy, x1: p.sx, y1: p.sy, t0: p.t, id: p.id };
}

/** Where a pointer came up, decided by what the press did. A LONG_PRESS_MS press
 *  that never moved is the touch right-click — the exact `issueOrder` call the
 *  contextmenu listener makes, so the two triggers cannot diverge, and, like a
 *  right-click, it leaves the selection alone. Any shorter press selects: the unit
 *  under the point, or the box it swept (villagers win a mixed drag, as in AoE2). */
function pointerUp(Game, p) {
  if (!Game.drag || p.id !== Game.drag.id) return;
  const drag = Game.drag;
  Game.drag = null;
  const dx = Math.abs(p.sx - drag.x0), dy = Math.abs(p.sy - drag.y0);
  if (dx < LONG_PRESS_SLOP && dy < LONG_PRESS_SLOP && p.t - drag.t0 >= LONG_PRESS_MS) {
    issueOrder(Game, p.x, p.y); return;
  }
  Game.selectedBuilding = null;
  if (dx < 4 && dy < 4) {
    const hit = pickUnit(Game, p.x, p.y);
    Game.selection = hit ? [hit.id] : [];
    if (!hit) Game.selectedBuilding = pickBuilding(Game, p.x, p.y);
  } else {
    let box = unitsInBox(Game, Math.min(drag.x0, p.sx) + Game.cam.x, Math.min(drag.y0, p.sy) + Game.cam.y,
                                Math.max(drag.x0, p.sx) + Game.cam.x, Math.max(drag.y0, p.sy) + Game.cam.y);
    const v = box.filter(u => u.kind === 'villager');
    if (box.length && v.length) box = v;      // AoE2 prefers villagers on mixed drags
    Game.selection = box.map(u => u.id);
  }
}

/** The BUTTON a click landed on, walked up from the event target: the command bar
 *  and the result overlay are rebuilt every frame, so both delegate clicks from
 *  their parent element and the target may be the label inside a button. */
function buttonAt(e) {
  let t = e.target;
  while (t && t.tagName !== 'BUTTON' && t.parentNode) t = t.parentNode;
  return t && t.tagName === 'BUTTON' ? t : null;
}

function attachInput(Game, d) {
  const view = Game.dom.view;
  const rect = () => {
    try { return view.getBoundingClientRect(); } catch (e) { return { left: 0, top: 0, width: view_W(Game), height: view_H(Game) }; }
  };
  const isView = (t) => !t || t === view || t === Game.dom.stage;
  const toWorld = (e) => {
    const r = rect();
    const cw = view.width || r.width || 1, ch = view.height || r.height || 1;
    const sx = (e.clientX - r.left) * (cw / (r.width || cw));
    const sy = (e.clientY - r.top) * (ch / (r.height || ch));
    return { x: sx + Game.cam.x, y: sy + Game.cam.y, sx, sy, t: e.timeStamp, id: e.pointerId };
  };

  /* PointerEvent covers mouse and touch, so the three mouse listeners became two
     pointer ones plus `touch-action:none` on #view: one path decides both, and a
     touch drag cannot scroll the page. The guard keeps a pointer that does not own
     the live drag (a second finger) from moving the cursor or the box. */
  d.addEventListener('pointermove', (e) => {
    if (Game.drag && e.pointerId !== Game.drag.id) return;
    const r = rect();
    const w = toWorld(e);
    Game.cursor = { x: w.x, y: w.y };
    // Feed the edge-scroll only while the pointer is over the canvas: coords measured
    // against the view go out of range when the pointer sits on header/footer chrome,
    // and stepGame read that as "cursor pinned to a screen edge" (a hover on the
    // resource bar or a command icon used to pan the camera). During a drag we keep
    // tracking; stepGame already skips edge-scroll while dragging.
    if (isView(e.target) || Game.drag) {
      Game.mouse = { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width || view_W(Game), h: r.height || view_H(Game) };
    } else {
      Game.mouse = null;
    }
    if (Game.drag) { Game.drag.x1 = w.sx; Game.drag.y1 = w.sy; }
  });

  d.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !isView(e.target)) return;
    pointerDown(Game, toWorld(e));
  });

  /* `Game.mouse` (the point stepGame reads for the edge-scroll band) is written by
     `pointermove` and belongs to the pointer that is hovering: a mouse release keeps
     it, a finger that lifts takes it away — leaving the last touch coordinate behind
     panned the camera from an edge nobody was touching any more. `pointercancel` is
     the browser taking the pointer back (system gesture, device lost): drop the drag,
     select nobody, order nobody, and the same rule applies to the hover. */
  d.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    pointerUp(Game, toWorld(e));
    if (e.pointerType !== 'mouse') Game.mouse = null;
  });

  d.addEventListener('pointercancel', (e) => {
    if (Game.drag && e.pointerId !== Game.drag.id) return;
    Game.drag = null;
    if (e.pointerType !== 'mouse') Game.mouse = null;
  });

  d.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (Game.placing) { Game.placing = null; return; }
    const w = toWorld(e);
    issueOrder(Game, w.x, w.y);
  });

  const keys = Game.keys;
  const setKey = (k, v) => {
    if (k === 'w' || k === 'arrowup') keys.up = v;
    else if (k === 's' || k === 'arrowdown') keys.down = v;
    else if (k === 'a' || k === 'arrowleft') keys.left = v;
    else if (k === 'd' || k === 'arrowright') keys.right = v;
  };
  d.addEventListener('keydown', (e) => {
    const k = (e.key || '').toLowerCase();
    if (e.ctrlKey && /^[1-9]$/.test(k)) { Game.groups[k] = Game.selection.slice(); e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'escape') { Game.placing = null; Game.selection = []; Game.selectedBuilding = null; return; }
    if (/^[1-9]$/.test(k)) { Game.selection = (Game.groups[k] || []).slice(); return; }
    if (k === 'h') { Game.placing = Game.placing === 'house' ? null : 'house'; return; }
    if (k === 'f') { Game.placing = Game.placing === 'farm' ? null : 'farm'; return; }
    if (k === 'b') { Game.placing = Game.placing === 'barracks' ? null : 'barracks'; return; }
    if (k === 'l') { Game.placing = Game.placing === 'lumber_camp' ? null : 'lumber_camp'; return; }
    if (k === 'g') { Game.placing = Game.placing === 'mining_camp' ? null : 'mining_camp'; return; }
    if (k === 'm') { Game.placing = Game.placing === 'mill' ? null : 'mill'; return; }
    if (k === 'r') { Game.placing = Game.placing === 'archery_range' ? null : 'archery_range'; return; }
    if (k === 'k') { Game.placing = Game.placing === 'blacksmith' ? null : 'blacksmith'; return; }
    if (k === 'e') { Game.placing = Game.placing === 'market' ? null : 'market'; return; }
    if (k === 'c') { Game.placing = Game.placing === 'watch_tower' ? null : 'watch_tower'; return; }
    if (k === 'q') { Game.placing = Game.placing === 'barricade' ? null : 'barricade'; return; }
    if (k === 't') { upgradeAge(Game); return; }
    if (k === 'n') { storageSet(SAVE_PATH, null); resetGame(Game); return; }
    setKey(k, true);
  });
  d.addEventListener('keyup', (e) => setKey((e.key || '').toLowerCase(), false));

  /* the command bar is rebuilt every frame -> delegate clicks off its parent:
     in node that is the cached #commands stub the checks fire at, in a browser the
     footer, the one element that survives the rebuild (hudHtml replaces children) */
  const cmdHost = Game.dom.commands || Game.dom.hud;
  if (cmdHost && cmdHost.addEventListener) {
    cmdHost.addEventListener('click', (e) => {
      const b = buttonAt(e);
      if (!b) return;
      const act = b.getAttribute('data-act'), arg = b.getAttribute('data-arg');
      if (act === 'build') Game.placing = arg;
      else if (act === 'train' && Game.selectedBuilding) train(Game, Game.selectedBuilding, arg);
      else if (act === 'research' && Game.selectedBuilding) researchTech(Game, Game.selectedBuilding, arg);
      else if (act === 'trade' && Game.selectedBuilding) {
        const [res, dir] = arg.split(':');
        trade(Game, Game.selectedBuilding, res, dir);
      }
      else if (act === 'cancel' && Game.selectedBuilding) cancelConstruction(Game, Game.selectedBuilding);
      else if (act === 'demolish' && Game.selectedBuilding) demolish(Game, Game.selectedBuilding);
      else if (act === 'age') upgradeAge(Game);
      else if (act === 'restart') { storageSet(SAVE_PATH, null); resetGame(Game); }
    });
  }

  if (Game.dom.minimap && Game.dom.minimap.addEventListener) {
    Game.dom.minimap.addEventListener('mousedown', (e) => {
      const r = Game.dom.minimap.getBoundingClientRect();
      const fx = (e.clientX - r.left) / (r.width || 1), fy = (e.clientY - r.top) / (r.height || 1);
      Game.cam.x = clamp(fx * Game.world.w * CFG.TILE - view_W(Game) / 2,
                         0, Math.max(0, Game.world.w * CFG.TILE - view_W(Game)));
      Game.cam.y = clamp(fy * Game.world.h * CFG.TILE - view_H(Game) / 2,
                         0, Math.max(0, Game.world.h * CFG.TILE - view_H(Game)));
      e.stopPropagation();
    });
  }

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('resize', () => {
      Game.view = beginCanvas(Game.dom.view, sizeW(Game.dom), sizeH(Game.dom));
      Game.mmBase = null;
    });
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
