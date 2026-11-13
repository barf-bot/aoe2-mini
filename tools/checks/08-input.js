'use strict';
/* checks/08-input.js -- mouse, keyboard, edge-scroll and touch input.
   Runs on its own (`node tools/checks/08-input.js`) against a freshly booted game. */

const {
  AoE2, DT, Game, blueVill, check, doc, flatState, freeSpotAround, html, pad, path, tOf, tileCentre, report,
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
      footerCtl === 'WASD / arrows or screen edges pan',
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

report();
