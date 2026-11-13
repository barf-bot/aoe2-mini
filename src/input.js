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
 *  (t = timeStamp, id = pointerId, type = pointerType) that tells a tap from a hold
 *  and a finger from a cursor. `attachInput` derives it from the event; the pure
 *  helpers never touch the DOM, so the harness can drive mouse and touch through the
 *  same code. A second finger turns the press into a camera pan (`fingerDown`) and
 *  marks the drag it lands in, so the selection box stops where it already was. */
function pointerDown(Game, p) {
  if (Game.placing) { build(Game, Game.placing, p.x, p.y); return; }
  const pan = fingerDown(Game, p);
  if (Game.drag && p.id !== Game.drag.id) { Game.drag.pan = pan; return; }  // not its finger: keep the anchor
  Game.drag = { x0: p.sx, y0: p.sy, x1: p.sx, y1: p.sy, t0: p.t, id: p.id, pan };
}

/** Where a pointer came up, decided by what the press did. A LONG_PRESS_MS press
 *  that never moved is the touch right-click — the exact `issueOrder` call the
 *  contextmenu listener makes, so the two triggers cannot diverge, and, like a
 *  right-click, it leaves the selection alone. Any shorter press selects: the unit
 *  under the point, or the box it swept (villagers win a mixed drag, as in AoE2) —
 *  unless the pan consumed it (`drag.pan`), which is the `pointercancel` case. */
function pointerUp(Game, p) {
  if (!Game.drag || p.id !== Game.drag.id) return;
  const drag = Game.drag;
  Game.drag = null;
  if (drag.pan) return;                        // the press only ever moved the camera
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

/* ---- the live fingers and the camera they move (docs/TODO.md P2-16b) ----------
   `Game.touches` (`src/boot.js:44`, transient like `Game.mmPointer`) maps every
   finger down to the canvas point it last reported, and `Game.pan` is the point the
   pair pivots around while two of them are down. A mouse pointer joins neither —
   `p.type` is the only thing that separates a finger from a cursor — so one finger,
   with or without a cursor on the same screen, still selects and commands exactly as
   the two functions above always did. */

/** Record a finger going down; true once a second one joins the first, which is the
 *  moment the pair takes the camera (`Game.pan` becomes their pivot). */
function fingerDown(Game, p) {
  if (p.type !== 'touch' || p.id in Game.touches) return false;
  Game.touches[p.id] = { sx: p.sx, sy: p.sy };
  if (Object.keys(Game.touches).length < 2) return false;
  Game.pan = fingerMid(Game);
  return true;
}

/** A lifted or cancelled finger leaves the set; the pan it belonged to ends with it,
 *  so the finger left behind is an ordinary one-finger press again. */
function fingerUp(Game, p) {
  if (p.type !== 'touch' || !(p.id in Game.touches)) return;
  delete Game.touches[p.id];
  Game.pan = null;
}

/** The pivot of the live fingers: their midpoint as a pair, the centroid when more
 *  than two are down — a third finger joins the pan, it never starts a second one.
 *  Null only for the empty set, which no caller asks about. */
function fingerMid(Game) {
  let x = 0, y = 0, n = 0;
  for (const id in Game.touches) { x += Game.touches[id].sx; y += Game.touches[id].sy; n++; }
  return n ? { x: x / n, y: y / n } : null;
}

/** A move by one of the fingers that are panning: the world follows them, so the
 *  camera takes the negative of the pivot delta through `setCam`, the selection box
 *  stops growing and `Game.mouse` goes null — a finger that is steering must not also
 *  pin the cursor to a screen edge and start the edge-scroll. False for every other
 *  move, which `attachInput` then handles the way it always did. */
function fingerMove(Game, p) {
  if (!Game.pan || p.type !== 'touch' || !(p.id in Game.touches)) return false;
  Game.touches[p.id] = { sx: p.sx, sy: p.sy };
  const mid = fingerMid(Game);
  panCamera(Game, mid.x - Game.pan.x, mid.y - Game.pan.y);
  Game.pan = mid;
  Game.mouse = null;
  return true;
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
  /* Game.view.w/h, never the canvas element's width: that is the device-pixel backing store,
     which doubles on a HiDPI screen (P2-19) and would put the cursor and the drag box at
     twice the pointer while the renderer draws in the logical space. */
  const toWorld = (e) => {
    const r = rect();
    const cw = (Game.view && Game.view.w) || r.width || 1, ch = (Game.view && Game.view.h) || r.height || 1;
    const sx = (e.clientX - r.left) * (cw / (r.width || cw));
    const sy = (e.clientY - r.top) * (ch / (r.height || ch));
    return { x: sx + Game.cam.x, y: sy + Game.cam.y, sx, sy, t: e.timeStamp, id: e.pointerId, type: e.pointerType };
  };

  /* PointerEvent covers mouse and touch, so the three mouse listeners became two
     pointer ones plus `touch-action:none` on #view: one path decides both, and a
     touch drag cannot scroll the page. A move is offered to `fingerMove` first — a
     finger that is part of a live pan moves the camera and nothing else — and only
     then to the owner guard, which keeps a pointer that is not the live drag's owner
     (a second mouse button, or a second finger before the pan begins) from moving the
     cursor or the box. */
  d.addEventListener('pointermove', (e) => {
    const r = rect();
    const w = toWorld(e);
    if (fingerMove(Game, w)) return;
    if (Game.drag && w.id !== Game.drag.id) return;
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
    const w = toWorld(e);
    fingerUp(Game, w);                              // ends its part in any pan before the press is judged
    pointerUp(Game, w);
    if (e.pointerType !== 'mouse') Game.mouse = null;
  });

  d.addEventListener('pointercancel', (e) => {
    const w = toWorld(e);
    const owned = Game.drag && w.id === Game.drag.id;
    fingerUp(Game, w);
    if (Game.drag && !owned) return;               // the other finger went away: keep the drag and its hover
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

  /* Minimap camera drag (docs/TODO.md P2-13): mousedown alone only jumped, so
     the drag the README advertises never followed the held button. The canvas
     listeners above show the pattern — pointerdown arms Game.mmPointer (left
     button only, so a right-click never starts a minimap drag), pointermove
     recentres only while that very pointer is still down, pointerup /
     pointercancel disarm. The capture keeps moves and the release arriving at
     #minimap even when the pointer strays off it (the stub DOM has none, so
     it is guarded). */
  if (Game.dom.minimap && Game.dom.minimap.addEventListener) {
    const mm = Game.dom.minimap;
    const mmPoint = (e) => {
      const r = mm.getBoundingClientRect();
      centerCamOnFraction(Game, (e.clientX - r.left) / (r.width || 1),
                          (e.clientY - r.top) / (r.height || 1));
    };
    mm.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (mm.setPointerCapture) mm.setPointerCapture(e.pointerId);
      Game.mmPointer = e.pointerId;
      mmPoint(e);
      e.stopPropagation();
    });
    mm.addEventListener('pointermove', (e) => {
      if (e.pointerId !== Game.mmPointer) return;
      mmPoint(e);
    });
    const mmUp = (e) => { if (e.pointerId === Game.mmPointer) Game.mmPointer = null; };
    mm.addEventListener('pointerup', mmUp);
    mm.addEventListener('pointercancel', mmUp);
  }

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('resize', () => {
      Game.view = beginCanvas(Game.dom.view, sizeW(Game.dom), sizeH(Game.dom));
      Game.mmBase = null;
    });
  }
}

/** The one camera clamp: a wanted top-left corner, kept inside the world — 0 to the
 *  map minus the viewport, floored at zero so a map smaller than the window cannot be
 *  panned at all. `centerCamOnFraction` (the minimap) and `panCamera` (two fingers)
 *  are the only writers of `Game.cam` outside `resetGame`, and both go through here,
 *  so the two paths cannot disagree about where the map ends. */
function setCam(Game, x, y) {
  Game.cam.x = clamp(x, 0, Math.max(0, Game.world.w * CFG.TILE - view_W(Game)));
  Game.cam.y = clamp(y, 0, Math.max(0, Game.world.h * CFG.TILE - view_H(Game)));
}

/** The one fraction-to-camera rule: a point on the minimap, as a fraction of its
 *  width/height, becomes the world point the camera centres on, clamped to the
 *  map. The press and the drag both call it so they cannot drift. */
function centerCamOnFraction(Game, fx, fy) {
  setCam(Game, fx * Game.world.w * CFG.TILE - view_W(Game) / 2,
              fy * Game.world.h * CFG.TILE - view_H(Game) / 2);
}

/** Pan by a screen delta (dx, dy): the camera travels the other way by the same
 *  amount, so the world under the fingers stays under the fingers. */
function panCamera(Game, dx, dy) { setCam(Game, Game.cam.x - dx, Game.cam.y - dy); }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
