'use strict';
/* render -- canvas drawing: terrain, buildings, units, projectiles, minimap, the frame. */

function beginCanvas(canvas, w, h) {
  let ctx = null;
  try { if (canvas && canvas.getContext) ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
  if (!ctx) return { ok: false, ctx: null, w: w, h: h, canvas: canvas };
  canvas.width = w; canvas.height = h;
  return { ok: true, ctx, w, h, canvas };
}

function drawWorld(Game, view) {
  const c = view.ctx;
  if (!c) return;
  const cam = Game.cam, TS = CFG.TILE, w = Game.world;
  const x0 = Math.max(0, Math.floor(cam.x / TS)), y0 = Math.max(0, Math.floor(cam.y / TS));
  const x1 = Math.min(w.w - 1, Math.ceil((cam.x + view.w) / TS));
  const y1 = Math.min(w.h - 1, Math.ceil((cam.y + view.h) / TS));
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const i = ty * w.w + tx, t = w.type[i];
      const px = Math.floor(tx * TS - cam.x), py = Math.floor(ty * TS - cam.y);
      c.fillStyle = PAL[t][w.shade[i] % PAL[t].length];
      c.fillRect(px, py, TS + 1, TS + 1);
      if (t === T.FOREST) drawTree(c, px, py, w.shade[i]);
      else if (t === T.GOLD) drawOre(c, px, py, '#f0d264');
      else if (t === T.STONE) drawOre(c, px, py, '#b9bcc4');
      else if (t === T.BERRY) drawBerry(c, px, py);
    }
  }
}

function drawTree(c, x, y, s) {
  c.fillStyle = '#1f3519';
  c.beginPath(); c.arc(x + 4 + (s % 3) * 2, y + 5 + (s % 2) * 3, 4, 0, 6.283); c.fill();
  c.fillStyle = '#2c4a24';
  c.beginPath(); c.arc(x + 11 - (s % 3) * 2, y + 13 - (s % 2) * 2, 3.4, 0, 6.283); c.fill();
}

function drawOre(c, x, y, col) {
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(x + 4, y + 14); c.lineTo(x + 8, y + 5); c.lineTo(x + 14, y + 12); c.lineTo(x + 10, y + 17);
  c.closePath(); c.fill();
  c.fillStyle = 'rgba(255,255,255,.28)';
  c.fillRect(x + 8, y + 6, 2, 3);
}

function drawBerry(c, x, y) {
  c.fillStyle = '#5d7a46';
  c.beginPath(); c.arc(x + 11, y + 12, 5, 0, 6.283); c.fill();
  c.fillStyle = '#c0465a';
  for (const p of [[7, 9], [12, 8], [10, 13], [14, 12]]) {
    c.beginPath(); c.arc(x + p[0], y + p[1], 1.4, 0, 6.283); c.fill();
  }
}

function drawBuildings(Game, view) {
  const c = view.ctx;
  if (!c) return;
  const TS = CFG.TILE, cam = Game.cam;
  const atlas = Game.sprites && Game.sprites.atlas;   // assets/sprites.png (see loadAtlas in src/boot.js)
  for (const b of Game.buildings) {
    const x = b.tx * TS - cam.x, y = b.ty * TS - cam.y, w = b.w * TS, h = b.h * TS;
    if (x > view.w || y > view.h || x + w < 0 || y + h < 0) continue;
    const team = TEAM[b.team];
    if (b.built < 1) {
      c.fillStyle = 'rgba(200,165,88,.16)'; c.fillRect(x, y, w, h);
      c.strokeStyle = team.main; c.lineWidth = 1; c.strokeRect(x + .5, y + .5, w - 1, h - 1);
      c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(x, y + h - 4, w, 4);
      c.fillStyle = '#c8a558'; c.fillRect(x, y + h - 4, w * b.built, 4);
      continue;
    }
    // Built: the atlas cell whenever we have one (bldSpriteFor, src/config.js);
    // a harvested farm and unknown kinds keep the procedural look.
    const frame = bldSpriteFor(b.kind, b.team);
    const dryFarm = b.kind === 'farm' && b.field <= 0;
    if (atlas && frame && !dryFarm) {
      c.drawImage(atlas, frame.sx, frame.sy, frame.sw, frame.sh, x, y, w, h);
    } else if (dryFarm) {
      c.fillStyle = '#6b5c3a'; c.fillRect(x + 2, y + 2, w - 4, h - 4);
      c.fillStyle = 'rgba(0,0,0,.25)';
      for (let i = 0; i < 4; i++) c.fillRect(x + 4, y + 4 + i * (h / 4), w - 8, Math.max(1, h / 9));
    } else if (b.kind === 'town_center') {
      c.fillStyle = team.main;
      c.fillRect(x + 3, y + 3, w - 6, h - 6);
      c.fillStyle = team.light; c.fillRect(x + w / 2 - 4, y + 3, 8, h - 6);
    } else if (b.kind === 'house') {
      c.fillStyle = team.main;
      c.fillRect(x + 3, y + 3, w - 6, h - 6);
      c.fillStyle = team.light;
      c.beginPath(); c.moveTo(x + 2, y + h / 2); c.lineTo(x + w / 2, y + 2); c.lineTo(x + w - 2, y + h / 2);
      c.closePath(); c.fill();
    } else if (b.kind === 'farm') {
      const dry = b.field <= 0;
      c.fillStyle = dry ? '#6b5c3a' : '#7d7a3d'; c.fillRect(x + 2, y + 2, w - 4, h - 4);
      c.fillStyle = dry ? 'rgba(0,0,0,.25)' : '#93924a';
      for (let i = 0; i < 4; i++) c.fillRect(x + 4, y + 4 + i * (h / 4), w - 8, Math.max(1, h / 9));
    } else if (b.kind === 'lumber_camp') {
      c.fillStyle = '#6a4a2f'; c.fillRect(x + 2, y + 2, w - 4, h - 4);   // log-pile hut
      c.fillStyle = team.main; c.fillRect(x + 4, y + 4, w - 8, 3);
      c.fillStyle = team.light; c.fillRect(x + 4, y + h - 7, w - 8, 3);  // workbench
    } else if (b.kind === 'mining_camp') {
      c.fillStyle = team.main; c.fillRect(x + 2, y + 2, w - 4, h - 4);
      c.fillStyle = '#cfd6e2'; c.fillRect(x + 4, y + h - 6, w - 6, 3);   // ore pile
      c.fillStyle = team.light; c.fillRect(x + 4, y + 4, w - 8, 3);      // tent flap
    } else if (b.kind === 'mill') {
      c.fillStyle = team.main; c.fillRect(x + 2, y + 2, w - 4, h - 4);
      c.fillStyle = '#93924a'; c.fillRect(x + 4, y + 4, w - 8, h - 10);  // grain floor
      c.fillStyle = team.light; c.fillRect(x + 4, y + h - 6, w - 8, 4);  // millstone base
    } else {  // barracks and future kinds
      c.fillRect(x + 2, y + 2, w - 4, h - 4);
      c.fillStyle = team.light;
      c.fillRect(x + 4, y + 4, w - 8, 4);
      c.fillRect(x + 4, y + h - 8, w - 8, 4);
    }
    const job = b.research ? { t: b.research.t, total: TECHS[b.research.id].time }
      : b.queue.length ? { t: b.queue[0].t, total: KINDS[b.queue[0].kind].time } : null;
    if (job) {
      c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(x, y - 6, w, 4);
      c.fillStyle = '#5b8fd6'; c.fillRect(x, y - 6, w * (1 - job.t / job.total), 4);
    }
    if (b.hp < b.maxHp) {
      c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(x, y - 10, w, 3);
      c.fillStyle = b.hp / b.maxHp > .5 ? '#6fbf73' : '#d1584f';
      c.fillRect(x, y - 10, w * (b.hp / b.maxHp), 3);
    }
  }
}

/** The SPRITES animation a unit plays right now, from its order (pure, so
 *  tools/checks/02-sprites.js pins it). Work/swing frames alternate a<->b at 4 Hz off the
 *  activity clock u.anim; idle units hold their single idle cell. */
function unitAnim(u) {
  const o = u.order;
  const swing = () => (Math.floor(u.anim * 4) % 2 ? 'b' : 'a');
  if (u.kind === 'militia') {
    if (o.kind === 'attack') return 'attack_' + swing();
    return (o.kind === 'move' || u.anim > 0) ? 'walk' : 'idle';
  }
  switch (o.kind) {
    case 'harvest':   return (WORK_ANIM[o.src && o.src.res] || 'farm') + '_' + swing();
    case 'build':     return 'farm_' + swing();  // generic hammering pose
    case 'move':
    case 'go_deposit': return 'walk';
    default:          return 'idle';
  }
}

function drawUnits(Game, view) {
  const c = view.ctx;
  if (!c) return;
  const cam = Game.cam;
  const atlas = Game.sprites && Game.sprites.atlas; // assets/sprites.png, see loadAtlas
  for (const u of Game.units) {
    const x = u.x - cam.x, y = u.y - cam.y;
    if (x < -20 || y < -20 || x > view.w + 20 || y > view.h + 20) continue;
    const team = TEAM[u.team];
    const sel = Game.selection.indexOf(u.id) >= 0;
    const anim = unitAnim(u);                          // which cell this unit plays
    const frame = spriteFor(u.kind, u.team, anim);
    if (atlas && frame) {
      // The atlas cell, mirrored when the unit walks left and bobbing 1px on its
      // 8 Hz walk clock (8 steps/s) only while walking; standing and working
      // frames hold still -- the a/b work cells are their own animation. The cell
      // is placed at integer pixels by its feet anchor (ax/ay), not its centre.
      const bob = anim === 'walk' ? Math.floor(u.anim * 8) % 2 : 0;
      c.save();
      c.translate(Math.round(x), Math.round(y) + bob);
      if (u.face < 0) c.scale(-1, 1);
      c.drawImage(atlas, frame.sx, frame.sy, frame.sw, frame.sh,
        -frame.ax, -frame.ay, frame.dw, frame.dh);
      c.restore();
    } else if (u.kind === 'villager') {
      c.fillStyle = '#2b2b2b'; c.beginPath(); c.arc(x, y, 6.5, 0, 6.283); c.fill();
      c.fillStyle = team.main; c.beginPath(); c.arc(x, y, 5, 0, 6.283); c.fill();
      c.fillStyle = team.light; c.beginPath(); c.arc(x - 1.2, y - 1.2, 2.2, 0, 6.283); c.fill();
    } else {
      c.save(); c.translate(x, y); c.rotate(0.78);
      c.fillStyle = '#262626'; c.fillRect(-6.5, -6.5, 13, 13);
      c.fillStyle = team.main; c.fillRect(-5, -5, 10, 10);
      c.fillStyle = team.light; c.fillRect(-4, -4, 4, 4);
      c.restore();
    }
    if (u.carry > 0) {
      c.fillStyle = CARRY_COLOR[u.carryRes] || '#fff';
      c.fillRect(x + 4, y - 6, 4, 4);
    }
    if (u.hp < u.maxHp) {
      c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(x - 7, y - 11, 14, 3);
      c.fillStyle = u.hp / u.maxHp > .5 ? '#6fbf73' : '#d1584f';
      c.fillRect(x - 7, y - 11, 14 * (u.hp / u.maxHp), 3);
    }
    if (sel) {
      c.strokeStyle = '#8ff0ff'; c.lineWidth = 1;
      c.beginPath(); c.arc(x, y, 9, 0, 6.283); c.stroke();
      const p = orderTarget(Game, u);
      if (p) {
        c.strokeStyle = 'rgba(143,240,255,.55)';
        c.beginPath(); c.moveTo(x, y); c.lineTo(p.x - cam.x, p.y - cam.y); c.stroke();
      }
    }
  }
}

/** Screen point an order points at (for the cyan order line). */
function orderTarget(Game, u) {
  const o = u.order;
  if (o.kind === 'move') return { x: o.x, y: o.y };
  if (o.kind === 'harvest') return { x: o.src.x, y: o.src.y };
  if (o.kind === 'go_deposit' || o.kind === 'build') {
    const b = Game.buildings.find(z => z.id === o.b);
    return b ? { x: b.x, y: b.y } : null;
  }
  if (o.kind === 'attack') {
    const t = Game.units.find(z => z.id === o.target);
    return t ? { x: t.x, y: t.y } : null;
  }
  return null;
}

/** The arrows in flight: a 6px dash in the shooter's team colour, pointing where
 *  the arrow is going (updateProjectiles keeps dx/dy current). */
function drawProjectiles(Game, view) {
  const c = view.ctx;
  if (!c) return;
  const cam = Game.cam;
  c.lineWidth = 1;
  for (const p of Game.projectiles) {
    const x = p.x - cam.x, y = p.y - cam.y;
    if (x < -8 || y < -8 || x > view.w + 8 || y > view.h + 8) continue;
    c.strokeStyle = TEAM[p.team].main;
    c.beginPath();
    c.moveTo(x - p.dx * 3, y - p.dy * 3);
    c.lineTo(x + p.dx * 3, y + p.dy * 3);
    c.stroke();
  }
}

function drawGhost(Game, view) {
  const c = view.ctx;
  if (!c || !Game.placing || !Game.cursor) return;
  const def = BLD[Game.placing];
  const TS = CFG.TILE, cam = Game.cam;                 // view space, like drawBuildings
  const tx = Math.floor(Game.cursor.x / TS), ty = Math.floor(Game.cursor.y / TS);
  const ok = canPlaceAt(Game, Game.placing, tx, ty);  // the one rule build applies (TODO P0-3)
  const x = tx * TS - cam.x, y = ty * TS - cam.y;
  c.globalAlpha = .6;
  c.fillStyle = ok ? 'rgba(111,191,115,.6)' : 'rgba(209,88,79,.6)';
  c.fillRect(x, y, def.w * TS, def.h * TS);
  c.globalAlpha = 1;
  c.strokeStyle = ok ? '#6fbf73' : '#d1584f';
  c.strokeRect(x + .5, y + .5, def.w * TS - 1, def.h * TS - 1);
}

function drawDragBox(Game, view) {
  const c = view.ctx;
  if (!c || !Game.drag) return;
  const x = Math.min(Game.drag.x0, Game.drag.x1), y = Math.min(Game.drag.y0, Game.drag.y1);
  const w = Math.abs(Game.drag.x1 - Game.drag.x0), h = Math.abs(Game.drag.y1 - Game.drag.y0);
  c.fillStyle = 'rgba(143,240,255,.12)'; c.fillRect(x, y, w, h);
  c.strokeStyle = '#8ff0ff'; c.lineWidth = 1; c.strokeRect(x + .5, y + .5, w, h);
}

/** Minimap: cached terrain bitmap + unit dots + viewport rect. */
function drawMinimap(Game, mm) {
  if (!mm || !mm.ok) return;
  const c = mm.ctx, S = mm.w / Game.world.w;
  c.clearRect(0, 0, mm.w, mm.h);
  if (!Game.mmBase) Game.mmBase = minimapTerrain(Game);
  if (Game.mmBase) c.drawImage(Game.mmBase, 0, 0, mm.w, mm.h);
  for (const b of Game.buildings) {
    c.fillStyle = TEAM[b.team].main;
    c.fillRect(b.tx * S, b.ty * S, Math.max(1, b.w * S), Math.max(1, b.h * S));
  }
  for (const u of Game.units) {
    c.fillStyle = Game.selection.indexOf(u.id) >= 0 ? '#8ff0ff' : TEAM[u.team].light;
    c.fillRect(u.x / CFG.TILE * S - .5, u.y / CFG.TILE * S - .5, Math.max(1, S), Math.max(1, S));
  }
  const vw = mm.w * Math.min(1, view_W(Game) / (Game.world.w * CFG.TILE));
  const vh = mm.h * Math.min(1, view_H(Game) / (Game.world.h * CFG.TILE));
  c.strokeStyle = '#ffffff'; c.lineWidth = 1;
  c.strokeRect(Game.cam.x / (Game.world.w * CFG.TILE) * mm.w,
               Game.cam.y / (Game.world.h * CFG.TILE) * mm.h, vw, vh);
}

function minimapTerrain(Game) {
  const src = Game.world;
  const stub = beginCanvas(mkCanvas(src.w, src.h), src.w, src.h);
  if (!stub.ok) return null;
  const c = stub.ctx;
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      c.fillStyle = PAL[src.type[y * src.w + x]][src.shade[y * src.w + x] % 3];
      c.fillRect(x, y, 1, 1);
    }
  }
  return stub.canvas;
}

function renderFrame(Game) {
  if (!Game.view || !Game.view.ok) return;
  if (Game.dom && Game.dom.toast && Game.time - Game.toastAt > 2.2 && Game.dom.toast.classList &&
      Game.dom.toast.classList.remove) Game.dom.toast.classList.remove('show');
  const c = Game.view.ctx;
  c.clearRect(0, 0, Game.view.w, Game.view.h);
  drawWorld(Game, Game.view);
  drawBuildings(Game, Game.view);
  drawUnits(Game, Game.view);
  drawProjectiles(Game, Game.view);
  drawGhost(Game, Game.view);
  drawDragBox(Game, Game.view);
  drawMinimap(Game, Game.mm);
  renderHud(Game);
}
