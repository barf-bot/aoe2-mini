'use strict';
/* checks/08-input.js -- mouse, keyboard, edge-scroll, touch input and garrison orders.
   Runs on its own (`node tools/checks/08-input.js`) against a freshly booted game. */

const {
  AoE2, DT, Game, blueVill, bootFixture, builtAt, check, doc, flatState, freeSpotAround, html, pad,
  path, siteAt, tOf, tileCentre, report, withDpr,
} = require('../lib/harness');

/* ---- 10. input ------------------------------------------------------ */
const view = doc.getElementById('view');
const mine = blueVill();
const pick = mine[0];
const px = pick.x - Game.cam.x, py = pick.y - Game.cam.y;
doc.fire('pointermove', { clientX: px, clientY: py, target: view });
doc.fire('pointerdown', { clientX: px, clientY: py, target: view });
doc.fire('pointerup', { clientX: px, clientY: py, target: view });
check(Game.selection.length === 1 && Game.selection[0] === pick.id,
  'input: click selects the unit under the cursor', JSON.stringify(Game.selection));
const other = mine[1];
const ox = other.x - Game.cam.x, oy = other.y - Game.cam.y;
doc.fire('pointerdown', { clientX: ox - 6, clientY: oy - 6, target: view });
doc.fire('pointermove', { clientX: ox + 6, clientY: oy + 6, target: view });
doc.fire('pointerup', { clientX: ox + 6, clientY: oy + 6, target: view });
check(Game.selection.length >= 1 && Game.selection.indexOf(other.id) >= 0,
  'input: drag box selects the units inside it', JSON.stringify(Game.selection));
doc.fire('keydown', { key: '1', ctrlKey: true, target: view });
doc.fire('keydown', { key: 'Escape', target: view });
check(Game.selection.length === 0 && Game.groups['1'].length >= 1,
  'input: ctrl+1 stores a control group, Esc clears selection',
  'group1=' + Game.groups['1'].length + ' sel=' + Game.selection.length);
doc.fire('keydown', { key: '1', target: view });
check(Game.selection.length >= 1, 'input: 1 recalls the control group', String(Game.selection.length));
doc.fire('pointerdown', { clientX: px, clientY: py, target: view });
doc.fire('pointerup', { clientX: px, clientY: py, target: view });
check(Game.selection.length === 1 && Game.selection[0] === pick.id,
  'input: re-click still selects the right unit', JSON.stringify(Game.selection));
const enemyNear = Game.units.find(u => u.team === 1 && !u.dead);
enemyNear.x = pick.x + 20; enemyNear.y = pick.y;
doc.fire('pointermove', { clientX: enemyNear.x - Game.cam.x, clientY: enemyNear.y - Game.cam.y, target: view });
doc.fire('contextmenu', { clientX: enemyNear.x - Game.cam.x, clientY: enemyNear.y - Game.cam.y, target: view });
check(pick.order.kind === 'attack' && pick.order.target === enemyNear.id,
  'command: right-click on an enemy orders an attack', pick.order.kind);
AoE2.issueOrder(Game, pick.x + 44, pick.y);
check(['move', 'harvest'].indexOf(pick.order.kind) >= 0, 'command: right-click on ground orders move/gather',
  pick.order.kind);
/* T4 regression: the rewritten issueOrder read `want[i]` for every member of the
   selection, so a click that resolves to NO order at all — off the map, or a solid
   tile with no standing spot — threw inside the contextmenu handler and would have
   replaced that member's live order (and his formation slot) with `null`. The rule
   before T4 was `if (!o) continue;`: refuse him, keep what he had, and do not ping
   for an order nobody received. Two villagers are ordered properly first so the
   order and the slots being kept are real ones. */
const refusalF = (() => {
  const st = flatState();
  const vs = st.units.filter((u) => u.team === 0 && u.kind === 'villager').slice(0, 2);
  const V = { x: tOf(vs[0].x), y: tOf(vs[0].y) };
  const pad = [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([dx, dy]) => ({ tx: V.x + dx, ty: V.y + dy }))
    .find((t) => AoE2.siteFree(st, t.tx, t.ty, 1, 1));
  if (!pad) return null;
  const at = tileCentre(st, pad.tx, pad.ty);
  st.selection = vs.map((u) => u.id);
  AoE2.issueOrder(st, at.x, at.y);                     // a legal group order: slots assigned
  const snap = (u) => `${JSON.stringify(u.order)}|${u.slot ? u.slot.tx + ',' + u.slot.ty : 'none'}`;
  const had = vs.map(snap), ping = st.pingAt;
  let threw = null;
  try { AoE2.issueOrder(st, -1, at.y); } catch (e) { threw = e; }   // then a click off the map
  return { had, ping, threw, now: vs.map(snap), nowPing: st.pingAt };
})();
check(!!refusalF && !refusalF.threw && refusalF.now.join(' ') === refusalF.had.join(' ') &&
      refusalF.nowPing === refusalF.ping,
  'command: a click that orders nobody is refused, not written',
  !refusalF ? 'no two villagers with a free tile two steps away'
    : refusalF.threw ? `issueOrder off the map threw ${refusalF.threw.message}`
      : `${refusalF.now.join(' ')} (was ${refusalF.had.join(' ')}), pingAt ${refusalF.nowPing} (was ${refusalF.ping})`);
/* docs/TODO.md P0-4: the same click on your OWN foundation is a work order, not a
   walk — a villager who is sent there builds, so a site nobody is building (its
   builder died or was pulled off it) can still be finished. issueOrder is exactly
   what the contextmenu handler above calls, and it runs on a throwaway state so the
   shared Game the checks below are mid-flight on stays untouched. */
const siteWork = (() => {
  const st = flatState();
  const vs = st.units.filter((u) => u.team === 0 && u.kind === 'villager');
  const spot = vs.length > 1 && freeSpotAround(st.world, st, tOf(vs[1].x), tOf(vs[1].y), 2, 2, 8);
  if (!spot) return null;
  const b = AoE2.makeBuilding(st, 'house', 0, spot.tx, spot.ty);   // a site, nobody on it
  b.built = 0.3;
  st.selection = [vs[1].id];
  const at = tileCentre(st, spot.tx, spot.ty);
  let threw = null;
  try { AoE2.issueOrder(st, at.x, at.y); } catch (e) { threw = e; }
  const order = JSON.stringify(vs[1].order);
  let steps = 0;
  const cap = Math.ceil((AoE2.BLD.house.time + 8) / DT);            // the rest of the site + a walk
  while (!threw && b.built < 1 && steps < cap) { AoE2.stepGame(st, DT); steps++; }
  return { threw, order, want: JSON.stringify({ kind: 'build', b: b.id }), built: b.built,
           seconds: +(steps * DT).toFixed(2) };
})();
check(!!siteWork && !siteWork.threw && siteWork.order === siteWork.want && siteWork.built >= 1,
  'command: right-click on your own foundation makes the villager build it',
  !siteWork ? 'no free 2x2 house pad near a second villager'
    : siteWork.threw ? 'issueOrder threw: ' + siteWork.threw.message
      : 'order=' + siteWork.order + ' (want ' + siteWork.want + '), built ' +
        Math.round(siteWork.built * 100) + '% after ' + siteWork.seconds + 's');
doc.fire('keydown', { key: 'h', target: view });
check(Game.placing === 'house', 'command: hotkey h arms house placement', String(Game.placing));
doc.fire('keydown', { key: 'Escape', target: view });
check(Game.placing === null, 'command: Esc cancels placement', String(Game.placing));
[['l', 'lumber_camp'], ['g', 'mining_camp'], ['m', 'mill']].forEach(([k, want]) => {
  doc.fire('keydown', { key: k, target: view });
  check(Game.placing === want, 'command: hotkey ' + k + ' arms ' + want + ' placement', String(Game.placing));
  doc.fire('keydown', { key: 'Escape', target: view });
});
doc.fire('keydown', { key: 'k', target: view });
const kPlacing = Game.placing;
doc.fire('keydown', { key: 'Escape', target: view });
check(kPlacing === 'blacksmith' && Game.placing === null,
  'input: k arms Blacksmith placement', 'k=' + String(kPlacing) + ' esc=' + String(Game.placing));
[['e', 'market', 'Market'], ['c', 'watch_tower', 'Watch Tower'], ['q', 'barricade', 'Barricade']].forEach(([k, kind, label]) => {
  doc.fire('keydown', { key: k, target: view });
  const armed = Game.placing;
  doc.fire('keydown', { key: 'Escape', target: view });
  check(armed === kind && Game.placing === null,
    'input: ' + k + ' arms ' + label + ' placement',
    k + '=' + String(armed) + ' esc=' + String(Game.placing));
});

doc.fire('keydown', { key: 'w', target: view });
const wDown = Game.keys.up;
doc.fire('keyup', { key: 'w', target: view });
check(wDown === true && Game.keys.up === false,
  'input: w pans up while held and releases on keyup',
  'keydown=' + String(wDown) + ' keyup=' + String(Game.keys.up));

/* The keys the handler implements and the controls the game advertises are one
   contract: setKey pans on `w`/`a`/`s`/`d` and the arrows, and every build hotkey
   returns before setKey runs — the reason the Barricade moved from `w` to `q`
   (TODO P2-12): while `w` armed placement, the WASD pan both strings below promise
   was impossible. The index.html banner and the footer's help line are the two
   surfaces that state it, so both have to keep naming WASD. */
const bannerCtl = (html.match(/^ +Controls: (.+)$/m) || [])[1] || '';
const footerCtl = (AoE2.infoHtml(AoE2.createState()).match(/>([^<]*screen edges pan)/) || [])[1] || '';
check(bannerCtl === 'left click / tap / drag to select, right click / press-and-hold to command, WASD / arrows to pan.' &&
      footerCtl === 'WASD / arrows / two fingers or screen edges pan',
  'input: the advertised controls name the keys the handler implements',
  'banner=' + JSON.stringify(bannerCtl) + ' footer=' + JSON.stringify(footerCtl));
/* One-pointer rule (T1): a drag belongs to the pointer that started it — a second
   press cannot take the drag over, a second move cannot drag the anchored box around
   and a second release cannot end it. The owning pointer's pointerup then answers
   exactly what the mouse click at the same canvas point answers, so both routes agree. */
const twoFinger = (() => {
  const s = {};
  doc.fire('pointerdown', { clientX: px, clientY: py, target: view, pointerId: 1 });
  s.anchor = Game.drag ? { x0: Game.drag.x0, x1: Game.drag.x1, id: Game.drag.id } : null;
  doc.fire('pointerdown', { clientX: px + 6, clientY: py + 6, target: view, pointerId: 2 });
  s.afterOtherDown = Game.drag ? { x0: Game.drag.x0, x1: Game.drag.x1, id: Game.drag.id } : null;
  doc.fire('pointermove', { clientX: px + 12, clientY: py + 12, target: view, pointerId: 2 });
  s.x1AfterOtherMove = Game.drag ? Game.drag.x1 : null;
  doc.fire('pointerup', { clientX: px + 12, clientY: py + 12, target: view, pointerId: 2 });
  s.idAfterOtherUp = Game.drag ? Game.drag.id : null;
  doc.fire('pointerup', { clientX: px, clientY: py, target: view, pointerId: 1 });
  s.dragAfterOwnUp = Game.drag;
  s.selAfterOwnUp = Game.selection.slice();
  return s;
})();
check(twoFinger.anchor !== null && twoFinger.anchor.id === 1 &&
      twoFinger.anchor.x1 === twoFinger.anchor.x0 &&
      JSON.stringify(twoFinger.afterOtherDown) === JSON.stringify(twoFinger.anchor) &&
      twoFinger.x1AfterOtherMove === twoFinger.anchor.x0 &&
      twoFinger.idAfterOtherUp === 1 && twoFinger.dragAfterOwnUp === null &&
      JSON.stringify(twoFinger.selAfterOwnUp) === JSON.stringify([pick.id]),
  'input: a second finger cannot move the anchored box', JSON.stringify(twoFinger));

/* pointercancel is how a browser hands the pointer back (a system gesture, a
   disconnected device): drop the drag, select nobody, order nobody. */
const cancelled = (() => {
  const s = { sel: Game.selection.slice(), bld: Game.selectedBuilding, ord: JSON.stringify(pick.order) };
  doc.fire('pointerdown', { clientX: px, clientY: py, target: view, pointerId: 1 });
  s.live = !!Game.drag;
  doc.fire('pointercancel', { target: view, pointerId: 1 });
  s.drag = Game.drag;
  s.nowSel = Game.selection.slice();
  s.nowBld = Game.selectedBuilding;
  s.nowOrd = JSON.stringify(pick.order);
  return s;
})();
check(cancelled.live && cancelled.drag === null &&
      JSON.stringify(cancelled.nowSel) === JSON.stringify(cancelled.sel) &&
      cancelled.nowBld === cancelled.bld && cancelled.nowOrd === cancelled.ord,
  'input: pointercancel drops the drag without selecting or commanding',
  JSON.stringify(cancelled));

/* P2-13: the minimap drags, not just jumps. A left press recentres the camera and
   arms Game.mmPointer; while that pointer is down every pointermove recentres
   again; the release disarms and a later hover (no button down) leaves the camera
   alone. A right press neither moves nor arms — right-click is the canvas's
   contextmenu order, never a minimap drag. */
const mmEl = doc.getElementById('minimap');
const mmBefore = Game.cam.x;
mmEl.fire('pointerdown', { clientX: 84, clientY: 84, button: 0, pointerId: 7 });
const mmDown = Game.cam.x;
check(mmDown !== mmBefore && Game.mmPointer === 7,
  'input: minimap press moves the camera and arms its pointer',
  mmBefore + ' -> ' + Math.round(mmDown) + ', pointer ' + Game.mmPointer);
mmEl.fire('pointermove', { clientX: 120, clientY: 40, pointerId: 7 });
const mmDrag = Game.cam.x;
check(mmDrag !== mmDown && Game.mmPointer === 7,
  'input: pointermove while the press is held drags the camera',
  mmDown + ' -> ' + Math.round(mmDrag));
mmEl.fire('pointerup', { clientX: 120, clientY: 40, button: 0, pointerId: 7 });
const mmUp = Game.cam.x;
mmEl.fire('pointermove', { clientX: 20, clientY: 150, pointerId: 7 });
check(Game.mmPointer === null && Game.cam.x === mmUp,
  'input: release disarms and a hover with no button leaves the camera',
  mmUp + ' -> ' + Math.round(Game.cam.x) + ', pointer ' + Game.mmPointer);
mmEl.fire('pointerdown', { clientX: 40, clientY: 40, button: 2, pointerId: 8 });
check(Game.mmPointer === null && Game.cam.x === mmUp,
  'input: right-click on the minimap does not start a drag',
  Game.mmPointer + ', ' + Math.round(Game.cam.x));

/* ---- 10b. edge-scroll must ignore pointer on HUD chrome -------------- */
// Regression (reported): "the screen starts to move when the mouse just wants
// to click on the icons or when you want to hover something". The document
// mousemove wrote Game.mouse even while the pointer was over the header or
// footer; view-relative coords then left the canvas rect (negative y over the
// header) and stepGame read that as "cursor pinned to a screen edge" and
// panned. mousedown guards with isView; mousemove used to not.
const headerEl = doc.getElementById('header');
const cmdBarEl = doc.getElementById('commands');
Game.cam.x = 500; Game.cam.y = 300;
doc.fire('pointermove', { clientX: 3, clientY: 3, target: view });
AoE2.stepGame(Game, DT);
check(Game.cam.x < 500 && Game.cam.y < 300,
  'input: cursor on the canvas top-left corner still pans up+left (kept)',
  Math.round(Game.cam.x) + ',' + Math.round(Game.cam.y));
const camH = Game.cam.y;
doc.fire('pointermove', { clientX: 300, clientY: -18, target: headerEl });
AoE2.stepGame(Game, DT);
check(Game.cam.y === camH && Game.mouse === null,
  'input: hovering the header bar does not pan (off-canvas coords)', camH + ' -> ' + Game.cam.y);
doc.fire('pointermove', { clientX: 300, clientY: 300, target: view });
const camF = Game.cam.y;
doc.fire('pointermove', { clientX: 300, clientY: 712, target: cmdBarEl });
AoE2.stepGame(Game, DT);
check(Game.cam.y === camF && Game.mouse === null,
  'input: hovering the footer command bar does not pan', camF + ' -> ' + Game.cam.y);
/* ---- 10c. touch: press-and-hold command (this plan, T2) ---- */
/* A LONG_PRESS_MS press that never moved fires the same dispatch the right-click
   path uses, which is how a phone issues orders. The three releases below are the
   whole decision table: hold → order, short tap → select, move → box select. */
const hv = blueVill()[0];
const pt = (dx, dy, ts) => ({ clientX: hv.x - Game.cam.x + dx, clientY: hv.y - Game.cam.y + dy,
                              target: view, timeStamp: ts });
const orderOf = (u) => JSON.stringify(u.order);

const holdGround = (() => {
  const s = {};
  doc.fire('pointerdown', pt(0, 0, 0));
  doc.fire('pointerup', pt(0, 0, 10));                 // the T1 tap: select him
  s.sel = Game.selection.slice(); s.bld = Game.selectedBuilding; s.ord0 = orderOf(hv);
  doc.fire('pointerdown', pt(44, 0, 0));               // then hold 700 ms on ground
  doc.fire('pointerup', pt(44, 0, 700));
  s.kind = hv.order && hv.order.kind; s.ord = orderOf(hv);
  s.selNow = Game.selection.slice(); s.bldNow = Game.selectedBuilding; s.drag = Game.drag;
  return s;
})();
check(['move', 'harvest'].indexOf(holdGround.kind) >= 0 && holdGround.drag === null &&
      JSON.stringify(holdGround.selNow) === JSON.stringify(holdGround.sel) &&
      holdGround.bldNow === holdGround.bld,
  'input: a 600 ms hold on ground issues the order the right-click path uses',
  JSON.stringify(holdGround));

const shortTap = (() => {
  const s = { sel: Game.selection.slice(), ord: orderOf(hv) };
  doc.fire('pointerdown', pt(0, 0, 0));
  doc.fire('pointerup', pt(0, 0, 300));                // the desktop tap, unchanged
  s.selNow = Game.selection.slice(); s.ordNow = orderOf(hv); s.drag = Game.drag;
  return s;
})();
check(shortTap.drag === null && shortTap.selNow.length === 1 && shortTap.selNow[0] === hv.id &&
      shortTap.ordNow === shortTap.ord,
  'input: a hold shorter than 600 ms selects and commands nobody', JSON.stringify(shortTap));

const moveHold = (() => {
  const s = { ord: orderOf(hv) };
  doc.fire('pointerdown', pt(-12, -12, 0));
  doc.fire('pointermove', pt(0, 0, 400));
  doc.fire('pointerup', pt(0, 0, 700));                // moved 12 px: a drag, not a hold
  s.sel = Game.selection.slice(); s.ordNow = orderOf(hv); s.drag = Game.drag;
  return s;
})();
check(moveHold.drag === null && moveHold.ordNow === moveHold.ord && moveHold.sel.indexOf(hv.id) >= 0,
  'input: moving then releasing commands nobody, whatever the hold', JSON.stringify(moveHold));

/* The other half of a release, which no decision can hide: `Game.mouse` — the point
   `stepGame` reads for the 14 px edge-scroll band — belongs to the pointer. A mouse
   release keeps it, because the cursor really is still there; a finger that lifts
   points at nothing, and its last canvas coordinate used to keep the camera panning
   from an edge nobody touches until the next tap. */
const lift = (() => {
  const s = {};
  doc.fire('pointermove', pt(40, 0, 0));
  s.hover = Game.mouse && Game.mouse.x;
  doc.fire('pointerup', pt(40, 0, 0));                   // mouse, no drag live: nothing to select
  s.mouseUp = Game.mouse && Game.mouse.x;
  doc.fire('pointerup', Object.assign(pt(40, 0, 0), { pointerId: 6, pointerType: 'touch' }));
  s.touchUp = Game.mouse;
  return s;
})();
check(!!lift.hover && lift.mouseUp === lift.hover && lift.touchUp === null,
  'input: a released finger clears the hover the edge-scroll band reads, a released mouse keeps it',
  JSON.stringify(lift));

/* The two slops answer different questions, and the hold's is only real if both sides
   of its boundary are tested: 7 px of drift is still the same press (so it orders),
   8 px is already a drag (so it selects). Reusing the tap's own `4` keeps every other
   check green — this is the one that pins `LONG_PRESS_SLOP`. */
const slopEdge = (() => {
  const s = { before: orderOf(hv) };
  doc.fire('pointerdown', pt(0, 0, 0));
  doc.fire('pointerup', pt(7, 0, 700));                  // one pixel inside the slop
  s.afterHold = orderOf(hv);
  s.kind = hv.order && hv.order.kind;
  doc.fire('pointerdown', pt(0, 0, 0));
  doc.fire('pointerup', pt(8, 0, 700));                  // exactly the slop: a drag now
  s.afterBox = orderOf(hv);
  s.sel = Game.selection.slice();
  s.drag = Game.drag;
  return s;
})();
check(slopEdge.afterHold !== slopEdge.before &&        // only the hold branch can rewrite an order
      ['move', 'harvest', 'attack'].indexOf(slopEdge.kind) >= 0 &&
      slopEdge.afterBox === slopEdge.afterHold &&
      slopEdge.sel.indexOf(hv.id) >= 0 && slopEdge.drag === null,
  'input: 7 px of drift still commands and 8 px already selects (LONG_PRESS_SLOP)',
  JSON.stringify(slopEdge));

/* ---- 10d. two-finger pan (docs/TODO.md P2-16b) -------------------- */
/* Two fingers down own the camera: `Game.pan` is their midpoint, every move by either
   one scrolls the world by the negative of that delta, the drag box stops growing,
   `Game.mouse` (the edge-scroll input) goes null and the owning finger's release
   neither selects nor commands — the rule `pointercancel` already applies. A mouse
   never joins the finger set, so the one-pointer contract the T1 check pins above
   still describes a cursor exactly. */
const tp = (id, cx, cy, ts) => ({ clientX: cx, clientY: cy, target: view, pointerId: id,
                                  pointerType: 'touch', timeStamp: ts });
const panPair = (() => {
  const s = { sel: [pick.id], ord: JSON.stringify(pick.order) };
  Game.cam.x = 500; Game.cam.y = 300;
  Game.selection = [pick.id];
  Game.mouse = { x: 100, y: 100, w: 1200, h: 700 };
  doc.fire('pointerdown', tp(41, 600, 400, 0));                 // one finger: the ordinary press
  s.panAfterOne = Game.pan;
  s.touchesAfterOne = Object.keys(Game.touches).length;
  doc.fire('pointerdown', tp(42, 700, 500, 10));                // the second one turns it into a pan
  s.panAfterTwo = Game.pan && { x: Game.pan.x, y: Game.pan.y };
  s.touchesAfterTwo = Object.keys(Game.touches).length;
  s.dragAfterTwo = Game.drag && { x0: Game.drag.x0, y0: Game.drag.y0, x1: Game.drag.x1, id: Game.drag.id };
  doc.fire('pointermove', tp(42, 710, 510, 20));                // the other finger moves: mid 655,455
  s.camAfterOtherMove = { x: Game.cam.x, y: Game.cam.y };
  s.mouseAfter = Game.mouse;
  s.dragAfterMove = Game.drag && { x0: Game.drag.x0, x1: Game.drag.x1, y1: Game.drag.y1 };
  s.selAfterMove = Game.selection.slice();
  doc.fire('pointermove', tp(41, 590, 440, 30));                // the owner moves too: mid 650,475
  s.camAfterOwnerMove = { x: Game.cam.x, y: Game.cam.y };
  doc.fire('pointerup', tp(41, 590, 440, 300));                 // a 300 ms press: a tap would select
  s.dragAfterOwnerUp = Game.drag;
  s.selAfterOwnerUp = Game.selection.slice();
  s.ordAfterOwnerUp = JSON.stringify(pick.order);
  s.panAfterOwnerUp = Game.pan;
  s.touchesAfterOwnerUp = Object.keys(Game.touches).length;
  doc.fire('pointerup', tp(42, 700, 500, 310));
  s.panAfterBothUp = Game.pan;
  s.touchesAfterBothUp = Object.keys(Game.touches).length;
  Game.cam.x = 3; Game.cam.y = 3;                               // the map corner: nothing to pan into
  doc.fire('pointerdown', tp(51, 600, 400, 0));
  doc.fire('pointerdown', tp(52, 700, 500, 10));                // mid 650,450
  doc.fire('pointermove', tp(51, 660, 460, 20));                // mid 680,480: 3 - 30 = -27 → 0
  s.clamped = { x: Game.cam.x, y: Game.cam.y };
  doc.fire('pointerup', tp(51, 660, 460, 30));
  doc.fire('pointerup', tp(52, 700, 500, 40));
  return s;
})();
check(panPair.panAfterOne === null && panPair.touchesAfterOne === 1 &&
      panPair.panAfterTwo !== null && panPair.panAfterTwo.x === 650 &&
      panPair.panAfterTwo.y === 450 && panPair.touchesAfterTwo === 2 &&
      panPair.camAfterOtherMove.x === 495 && panPair.camAfterOtherMove.y === 295 &&
      panPair.camAfterOwnerMove.x === 500 && panPair.camAfterOwnerMove.y === 275,
  'input: two fingers down pan the camera by the negative midpoint delta',
  JSON.stringify(panPair));
check(panPair.dragAfterTwo !== null && panPair.dragAfterTwo.x0 === 600 &&
      panPair.dragAfterMove !== null && panPair.dragAfterMove.x0 === 600 &&
      panPair.dragAfterMove.x1 === 600 && panPair.dragAfterMove.y1 === 400 &&
      panPair.mouseAfter === null &&
      JSON.stringify(panPair.selAfterMove) === JSON.stringify(panPair.sel),
  'input: a pan freezes the drag box, clears the hover and leaves the selection alone',
  JSON.stringify(panPair));
check(panPair.dragAfterOwnerUp === null && panPair.panAfterOwnerUp === null &&
      panPair.touchesAfterOwnerUp === 1 && panPair.touchesAfterBothUp === 0 &&
      panPair.panAfterBothUp === null &&
      JSON.stringify(panPair.selAfterOwnerUp) === JSON.stringify(panPair.sel) &&
      panPair.ordAfterOwnerUp === panPair.ord,
  'input: the owning finger of a pan lifts without selecting or commanding',
  JSON.stringify(panPair));
check(panPair.clamped.x === 0 && panPair.clamped.y === 0,
  'input: panning past the map corner clamps to the same limit the minimap uses',
  JSON.stringify(panPair.clamped));

const mousePan = (() => {
  const s = { cam: { x: Game.cam.x, y: Game.cam.y } };
  const mp = (id, cx, cy, ts) => ({ clientX: cx, clientY: cy, target: view, pointerId: id,
                                    pointerType: 'mouse', timeStamp: ts });
  const mx = pick.x - Game.cam.x, my = pick.y - Game.cam.y;
  s.mx = mx; s.my = my;
  doc.fire('pointerdown', mp(61, mx, my, 0));
  s.panOne = Game.pan;
  s.touchesOne = Object.keys(Game.touches).length;
  doc.fire('pointermove', mp(61, mx + 5, my, 10));
  s.x1 = Game.drag && Game.drag.x1;
  doc.fire('pointerdown', mp(62, mx + 20, my, 20));             // a second mouse pointer, no finger
  s.panTwo = Game.pan;
  s.touchesTwo = Object.keys(Game.touches).length;
  doc.fire('pointerup', mp(62, mx + 20, my, 30));
  doc.fire('pointerup', mp(61, mx, my, 40));
  s.selAfter = Game.selection.slice();
  s.camAfter = { x: Game.cam.x, y: Game.cam.y };
  return s;
})();
check(mousePan.panOne === null && mousePan.panTwo === null &&
      mousePan.touchesOne === 0 && mousePan.touchesTwo === 0 &&
      mousePan.x1 === mousePan.mx + 5,
  'input: a mouse pointer never enters pan mode, and still drags its box',
  JSON.stringify(mousePan));

/* P2-19: the projection. `toWorld` scaled clientX/clientY by the canvas *element*'s size,
   which is the device-pixel backing store: once that doubles on a HiDPI screen every
   pointer coordinate inflates by the ratio while the renderer draws in logical pixels, so
   the cursor and the drag box land short of the pointer. One click, both page sizes. */
const projected = (dpr, cx, cy) => withDpr(dpr, () => bootFixture(undefined, (d, g) => {
  d.fire('pointermove', { clientX: cx, clientY: cy });
  return { sx: g.cursor.x - g.cam.x, sy: g.cursor.y - g.cam.y,
           store: g.dom.view.width, css: g.dom.view.style.width, dpr: g.view.dpr };
}));
const p1 = projected(1, 300, 200), p2 = projected(2, 300, 200);
check(p1.dpr === 1 && p1.store === 1200 && p2.dpr === 2 && p2.store === 2400 &&
      p2.css === '1200px' && p1.sx === p2.sx && p1.sy === p2.sy && p1.sx === 300 && p1.sy === 200,
  'input: the cursor projection follows the logical viewport, not the device-pixel store',
  'dpr1 ' + JSON.stringify(p1) + ' / dpr2 ' + JSON.stringify(p2));
/* ---- 10e. garrison (this plan, T1) ------------------------------------ */
/* garrisonUnits / leaveBuilding and the right-click path that reaches them
   (docs/plans/2026-11-13-garrison.md T1): a finished own building with capacity
   takes the selected units into it, and every other click answers the order it
   always gave. The first two cases drive the real page with doc.fire — exactly
   what a right-click calls — so the listener wiring is proven too; the rest run on
   throwaway flatState() fixtures, so the shared Game stays as the sections above
   left it. The state builder makes `kind` at (40, ty) — finished unless `asSite` —
   plus `n` own militia standing on the far side of its ring, so the tiles a garrison
   order hands out are never the ones the units were standing on. */
const garrisonState = (kind, ty, n, asSite) => {
  const st = flatState();
  const b = asSite ? siteAt(st, kind, ty) : builtAt(st, kind, ty);
  const ring = AoE2.standingSpots(st, b, n + 2);
  const us = [];
  for (let i = 0; ring.length >= n && i < n; i++) {
    const p = ring[ring.length - n + i];
    us.push(AoE2.makeUnit(st, 'militia', 0, p.x, p.y));
  }
  return { st, b, us, ring };
};
const gClicked = (() => {
  let threw = null, r = {};
  try {
    const out = bootFixture(undefined, (d, g) => {
      const b = builtAt(g, 'barracks', 30);
      const ring = AoE2.standingSpots(g, b, 4);
      if (ring.length < 4) return null;                       // nowhere to stand the pair
      const us = [AoE2.makeUnit(g, 'militia', 0, ring[2].x, ring[2].y),
                  AoE2.makeUnit(g, 'militia', 0, ring[3].x, ring[3].y)];
      g.selection = us.map((u) => u.id);
      g.pingAt = -5; g.autosaveAt = Infinity;                 // the markDirty signature §13 pins
      const at = tileCentre(g, b.tx, b.ty);
      d.fire('contextmenu', { clientX: at.x - g.cam.x, clientY: at.y - g.cam.y });
      return { bId: b.id, ids: us.map((u) => u.id), sel: g.selection.slice(),
               linked: us.map((u) => u.garrisonedIn), orders: us.map((u) => ({ ...u.order })),
               slots: us.map((u) => u.slot), want: ring.slice(0, 2),
               time: g.time, ping: g.pingAt, save: g.autosaveAt };
    });
    r = out || {};
    r.empty = !out;
  } catch (e) { threw = e; }
  return Object.assign({ threw: threw && threw.message }, r);
})();
check(gClicked.threw === null && !gClicked.empty && gClicked.linked.every((v) => v === gClicked.bId) &&
      gClicked.sel.join(',') === gClicked.ids.join(',') && gClicked.ping === gClicked.time &&
      gClicked.save === gClicked.time + AoE2.CFG.AUTOSAVE_DEBOUNCE,
  'input: right-clicking a finished own barracks garrisons the selected militia',
  JSON.stringify(gClicked));
check(gClicked.threw === null && !gClicked.empty && gClicked.orders.length === gClicked.want.length &&
      gClicked.orders.every((o, i) => o.kind === 'move' && o.garrison === gClicked.bId &&
        o.x === gClicked.want[i].x && o.y === gClicked.want[i].y) &&
      gClicked.slots.every((s) => s === null),
  "input: the garrison order walks each unit onto the building's own standing spot",
  JSON.stringify(gClicked));
const gHalfFull = (() => {                                     // cap 5: 4 inside, 2 more ordered
  const { st, b, us } = garrisonState('watch_tower', 31, 6);
  let threw = null, r = {};
  try {
    const first = AoE2.garrisonUnits(st, us.slice(0, 4).map((u) => u.id), b);
    const had = us.slice(4).map((u) => JSON.stringify(u.order));
    const second = AoE2.garrisonUnits(st, us.slice(4).map((u) => u.id), b);
    r = { cap: AoE2.BLD.watch_tower.garrisonCapacity, first: first.length, second: second.length,
          took: second.map((u) => u.id), wantId: us[4].id, kept: had[1] === JSON.stringify(us[5].order),
          changed: had[0] !== JSON.stringify(us[4].order), msg: st.toastMsg };
  } catch (e) { threw = e; }
  return Object.assign({ threw: threw && threw.message }, r);
})();
check(gHalfFull.threw === null && gHalfFull.cap === 5 && gHalfFull.first === 4 &&
      gHalfFull.second === 1 && gHalfFull.took.length === 1 && gHalfFull.took[0] === gHalfFull.wantId &&
      gHalfFull.kept && gHalfFull.changed && gHalfFull.msg === 'Watch Tower is full',
  'input: one slot left takes one unit and toasts the second', JSON.stringify(gHalfFull));
const gNoCap = (() => {                                        // a row with capacity 0
  const { st, b, us } = garrisonState('house', 32, 1);
  let threw = null, r = {};
  try {
    const took = AoE2.garrisonUnits(st, [us[0].id], b);
    r = { took: took.length, msg: st.toastMsg, linked: us[0].garrisonedIn,
          marked: st.pingAt !== -99 || st.autosaveAt !== 0 };
  } catch (e) { threw = e; }
  return Object.assign({ threw: threw && threw.message }, r);
})();
check(gNoCap.threw === null && gNoCap.took === 0 && gNoCap.msg === 'House has no garrison space' &&
      gNoCap.linked === null && !gNoCap.marked,
  'input: a building with no capacity refuses the order', JSON.stringify(gNoCap));
const gSite = (() => {                                         // built < 1: the click still moves
  const { st, b, us } = garrisonState('barracks', 33, 1, true);
  let threw = null, r = {};
  try {
    const took = AoE2.garrisonUnits(st, [us[0].id], b);
    const msg = st.toastMsg;
    st.selection = [us[0].id];                               // the selection a right-click orders
    AoE2.issueOrder(st, tileCentre(st, b.tx, b.ty).x, tileCentre(st, b.tx, b.ty).y);
    r = { took: took.length, msg, linked: us[0].garrisonedIn, order: JSON.stringify(us[0].order) };
  } catch (e) { threw = e; }
  return Object.assign({ threw: threw && threw.message }, r);
})();
check(gSite.threw === null && gSite.took === 0 && gSite.msg === 'Barracks is not built yet' &&
      gSite.linked === null && JSON.parse(gSite.order).kind === 'move',
  'input: an unfinished own building is not a garrison target', JSON.stringify(gSite));
const gEnemyB = (() => {                                       // team 1's barracks: attack, not shelter
  const st = flatState();
  const eB = AoE2.makeBuilding(st, 'barracks', 1, 60, 60);
  eB.built = 1; eB.hp = eB.maxHp;
  const p = AoE2.standingSpots(st, eB, 1)[0];
  let threw = null, r = {};
  try {
    const u = AoE2.makeUnit(st, 'militia', 0, p.x, p.y);
    const took = AoE2.garrisonUnits(st, [u.id], eB);
    const msg = st.toastMsg;
    st.selection = [u.id];
    AoE2.issueOrder(st, eB.x, eB.y);
    r = { bId: eB.id, took: took.length, msg, linked: u.garrisonedIn, order: { ...u.order } };
  } catch (e) { threw = e; }
  return Object.assign({ threw: threw && threw.message }, r);
})();
check(gEnemyB.threw === null && gEnemyB.took === 0 && gEnemyB.msg === 'Not your building' &&
      gEnemyB.linked === null && gEnemyB.order.kind === 'attack' && gEnemyB.order.b === gEnemyB.bId,
  'input: an enemy building is not yours to garrison', JSON.stringify(gEnemyB));
const gAgain = (() => {                                        // inside A: refused by A and by B
  const st = flatState();
  const a = builtAt(st, 'barracks', 34), b2 = builtAt(st, 'barracks', 40);
  let threw = null, r = {};
  try {
    const p = AoE2.standingSpots(st, a, 1)[0];
    const u = AoE2.makeUnit(st, 'militia', 0, p.x, p.y);
    const first = AoE2.garrisonUnits(st, [u.id], a);
    const walk = JSON.stringify(u.order);
    const ping = st.pingAt, save = st.autosaveAt;
    const again = AoE2.garrisonUnits(st, [u.id], a);
    const msgA = st.toastMsg;
    const cross = AoE2.garrisonUnits(st, [u.id], b2);
    r = { first: first.length, again: again.length, cross: cross.length, msg: msgA,
          msg2: st.toastMsg, linked: u.garrisonedIn, aId: a.id, orderKept: JSON.stringify(u.order) === walk,
          marked: st.pingAt !== ping || st.autosaveAt !== save };
  } catch (e) { threw = e; }
  return Object.assign({ threw: threw && threw.message }, r);
})();
check(gAgain.threw === null && gAgain.first === 1 && gAgain.again === 0 && gAgain.cross === 0 &&
      gAgain.msg === 'Already garrisoned there' && gAgain.msg2 === 'Already garrisoned there' &&
      gAgain.linked === gAgain.aId && gAgain.orderKept && !gAgain.marked,
  'input: a unit already inside is not garrisoned again', JSON.stringify(gAgain));
const gLeave = (() => {                                        // the way back out
  const { st, b, us } = garrisonState('barracks', 37, 2);
  let threw = null, r = {};
  try {
    AoE2.garrisonUnits(st, us.map((u) => u.id), b);
    const want = AoE2.standingSpots(st, b, 2).map((p) => p.x + ',' + p.y);
    const n = AoE2.leaveBuilding(st, b);
    r = { n, want, pos: us.map((u) => u.x + ',' + u.y), linked: us.map((u) => u.garrisonedIn),
          orders: us.map((u) => u.order.kind), paths: us.map((u) => u.path), msg: st.toastMsg };
  } catch (e) { threw = e; }
  return Object.assign({ threw: threw && threw.message }, r);
})();
check(gLeave.threw === null && gLeave.n === 2 && gLeave.pos.join(' ') === gLeave.want.join(' ') &&
      gLeave.pos[0] !== gLeave.pos[1] && gLeave.linked.every((v) => v === null) &&
      gLeave.orders.every((k) => k === 'idle') && gLeave.paths.every((p) => p === null) &&
      gLeave.msg === '2 left Barracks',
  'input: leaveBuilding empties the building onto its standing spots', JSON.stringify(gLeave));
const gLeaveKind = (() => {                                    // the per-kind Leave button's call
  const st = flatState();
  const b = builtAt(st, 'barracks', 38);
  const ring = AoE2.standingSpots(st, b, 4);
  let threw = null, r = {};
  try {
    const m = AoE2.makeUnit(st, 'militia', 0, ring[2].x, ring[2].y);
    const v = AoE2.makeUnit(st, 'villager', 0, ring[3].x, ring[3].y);
    const inA = AoE2.garrisonUnits(st, [m.id, v.id], b);
    const n = AoE2.leaveBuilding(st, b, [m.id]);                // the militia button's id list
    r = { bId: b.id, inA: inA.length, n, mLinked: m.garrisonedIn, vLinked: v.garrisonedIn,
          mOrder: m.order.kind, mPos: m.x + ',' + m.y, first: ring[0].x + ',' + ring[0].y,
          msg: st.toastMsg };
  } catch (e) { threw = e; }
  return Object.assign({ threw: threw && threw.message }, r);
})();
check(gLeaveKind.threw === null && gLeaveKind.inA === 2 && gLeaveKind.n === 1 &&
      gLeaveKind.mLinked === null && gLeaveKind.vLinked === gLeaveKind.bId &&
      gLeaveKind.mOrder === 'idle' && gLeaveKind.mPos === gLeaveKind.first &&
      gLeaveKind.msg === '1 left Barracks',
  'input: leaveBuilding with an explicit unit list releases only those units',
  JSON.stringify(gLeaveKind));
const gLeaveEmpty = (() => {                                     // nothing inside: toast, no mark
  const st = flatState();
  const b = builtAt(st, 'barracks', 39);
  let threw = null, r = {};
  try {
    r = { n: AoE2.leaveBuilding(st, b), msg: st.toastMsg, marked: st.pingAt !== -99 || st.autosaveAt !== 0 };
  } catch (e) { threw = e; }
  return Object.assign({ threw: threw && threw.message }, r);
})();
check(gLeaveEmpty.threw === null && gLeaveEmpty.n === 0 &&
      gLeaveEmpty.msg === 'Barracks has nobody inside' && !gLeaveEmpty.marked,
  'input: leaveBuilding on an empty building toasts and marks nothing',
  JSON.stringify(gLeaveEmpty));

report();
