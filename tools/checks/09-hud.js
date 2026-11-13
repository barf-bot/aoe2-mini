'use strict';
/* checks/09-hud.js -- command bar, the uniform HUD frame, the responsive layout.
   Runs on its own (`node tools/checks/09-hud.js`) against a freshly booted game. */

const {
  AoE2, Game, blueVill, bootFixture, check, domHtml, finishedHouse, fundedGame, html, stubEl, styleCss, tileCentre, report,
} = require('../lib/harness');

/* ---- 11. command bar buttons ---------------------------------------- */
Game.selection = [];
Game.dom.commands.innerHTML = '';
const button = stubEl('button', 'btn', 60, 24);
button.setAttribute('data-act', 'build');
button.setAttribute('data-arg', 'farm');
Game.dom.commands.listeners.click.forEach(fn => fn({ target: button }));
check(Game.placing === 'farm', 'ui: clicking the Farm button arms placement', String(Game.placing));
// The archer line's building (T4): offered to a villager selection, and its
// button arms placement through the same delegated listener as every other.
Game.selection = blueVill().map(u => u.id);
// The range is a Feudal row (data/buildings.json `age: 1`), so its markup comes from
// the fixture that is unlocked, not from the still-Dark-Age Game the age section below
// takes from 0 to 2; the button click still dispatches through the shared Game's bar.
const rngSt = fundedGame();
rngSt.selection = rngSt.units
  .filter((u) => u.team === 0 && u.kind === 'villager').map((u) => u.id);
const cmdRng = AoE2.commandsHtml(rngSt);
const rngBtn = stubEl('button', 'btnRng', 60, 24);
rngBtn.setAttribute('data-act', 'build');
rngBtn.setAttribute('data-arg', 'archery_range');
Game.dom.commands.listeners.click.forEach(fn => fn({ target: rngBtn }));
check(cmdRng.includes('data-act="build" data-arg="archery_range"') &&
      Game.placing === 'archery_range',
  'ui: clicking the Archery Range button arms placement',
  'offered=' + cmdRng.includes('data-arg="archery_range"') + ' placing=' + Game.placing);
// and the Demolish button (phase-2 T5): dispatched through the same delegated
// listener, it demolishes the selected finished house for no refund.
const uiHouse = finishedHouse(Game);
const uiWood0 = Game.res[0].wood;
Game.selectedBuilding = uiHouse;
const dBtn = stubEl('button', 'btn2', 60, 24);
dBtn.setAttribute('data-act', 'demolish');
Game.dom.commands.listeners.click.forEach(fn => fn({ target: dBtn }));
check(!!uiHouse && !Game.buildings.includes(uiHouse) && Game.res[0].wood === uiWood0 &&
      Game.selectedBuilding === null,
  'ui: clicking the Demolish button demolishes the selected building',
  !uiHouse ? 'no finished house to demolish'
    : Game.buildings.includes(uiHouse) ? 'still there' : 'demolished, selection cleared');
// The footer offers Cancel for the WHOLE build (built is a 0..1 fraction, not a flag)
// and Demolish only once finished: a half-built site must not show Demolish.
Game.selection = [];
Game.selectedBuilding = { kind: 'house', team: 0, built: 0.5, hp: 1, maxHp: 1, queue: [] };
const cmdHalf = AoE2.commandsHtml(Game);
Game.selectedBuilding.built = 1;
const cmdDone = AoE2.commandsHtml(Game);
Game.selectedBuilding = null;
check(cmdHalf.includes('data-act="cancel"') && !cmdHalf.includes('data-act="demolish"') &&
      cmdDone.includes('data-act="demolish"') && !cmdDone.includes('data-act="cancel"'),
  'ui: a half-built site offers Cancel, a finished one Demolish',
  'half: ' + (cmdHalf.match(/data-act="\w+"/g) || []).join(' ') +
  ' | done: ' + (cmdDone.match(/data-act="\w+"/g) || []).join(' '));
// Train buttons are a finished-building affordance too: built is a 0..1 progress
// fraction, so a half-built Barracks used to offer Militia even though train()
// answers 'Still building'. Same rule as the Demolish check above.
Game.selection = [];
Game.selectedBuilding = { kind: 'barracks', team: 0, built: 0.5, hp: 1, maxHp: 1, queue: [] };
const cmdHalfBarracks = AoE2.commandsHtml(Game);
Game.selectedBuilding.built = 1;
const cmdDoneBarracks = AoE2.commandsHtml(Game);
Game.selectedBuilding = null;
check(!cmdHalfBarracks.includes('data-act="train"') && cmdHalfBarracks.includes('data-act="cancel"') &&
      cmdDoneBarracks.includes('data-act="train"') && cmdDoneBarracks.includes('data-arg="militia"'),
  'ui: a half-built Barracks offers no train buttons, a finished one trains Militia',
  'half: ' + (cmdHalfBarracks.match(/data-act="\w+"/g) || []).join(' ') +
  ' | done: ' + (cmdDoneBarracks.match(/data-act="\w+"/g) || []).join(' '));
/* The footer half of docs/TODO.md P1-10: `commandsHtml` (`src/hud.js:106`) decides the
 * disabled flag with the same number `train` consults (`popCommitted`,
 * `src/economy.js:114`), so a village whose queue already fills its cap greys the button
 * out instead of offering a click that only toasts. Four states of one throwaway
 * village: full, with room, one queued, queue full. */
const popSt = AoE2.createState();
popSt.res[0] = { food: 9000, wood: 9000, gold: 9000, stone: 9000 };
const popTc = popSt.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
popSt.selection = [];
popSt.selectedBuilding = popTc;
const VILL_BTN = '<button data-act="train" data-arg="villager"';
const off = (markup) => markup.includes(VILL_BTN + ' disabled>');
const popHtml = (mutate) => { if (mutate) mutate(); return AoE2.commandsHtml(popSt); };
const popAtCap = off(popHtml());                                        // 5 living, cap 5
const popRoom = off(popHtml(() => finishedHouse(popSt)));               // cap 10, nothing queued
const popOne = off(popHtml(() => AoE2.train(popSt, popTc, 'villager')));  // 6 committed of 10
const popMax = off(popHtml(() => { for (let i = 0; i < 4; i++) AoE2.train(popSt, popTc, 'villager'); }));
check(popAtCap && !popRoom && !popOne && popMax,
  'ui: the Villager button disables exactly when train would answer "Need more houses"',
  'atCap=' + popAtCap + ' room=' + popRoom + ' oneQueued=' + popOne + ' queueFull=' + popMax);

Game.res[0].food = 900;
AoE2.upgradeAge(Game);
check(Game.age[0] === 1 && Game.res[0].food === 400, 'age: Feudal Age costs 500 food', 'age=' + Game.age[0] + ' food=' + Game.res[0].food);
check(AoE2.AGES[Game.age[0]] === 'Feudal Age', 'age: label follows the age', AoE2.AGES[Game.age[0]]);
check(AoE2.upgradeAge(Game) === undefined && Game.age[0] === 1 && Game.res[0].food === 400 &&
  Game.toastMsg === 'Need 1000 food', 'age: Castle Age needs 1000 food',
  'age=' + Game.age[0] + ' food=' + Game.res[0].food + ' toast=' + JSON.stringify(Game.toastMsg));
Game.res[0].food = 1000;
AoE2.upgradeAge(Game);
check(Game.age[0] === 2 && Game.res[0].food === 0 && Game.toastMsg === 'Castle Age reached',
  'age: Castle Age is the last age the player can reach',
  'age=' + Game.age[0] + ' food=' + Game.res[0].food + ' toast=' + JSON.stringify(Game.toastMsg));
Game.res[0].food = 5000;
check(AoE2.upgradeAge(Game) === undefined && Game.age[0] === 2 && Game.res[0].food === 5000 &&
  Game.toastMsg === 'Castle Age reached', 'age: Castle Age is the ceiling: refused, nothing spent',
  'age=' + Game.age[0] + ' food=' + Game.res[0].food + ' toast=' + JSON.stringify(Game.toastMsg));
// T1: the gate in the command bar -- paired states like the half/done checks
// above: a Dark Age village (fresh fixture) offers no Blacksmith button, and
// the now-Feudal Game (the age check above) does.
const bsDark = (() => {
  const st = AoE2.createState();
  st.selection = st.units.filter((u) => u.team === 0 && u.kind === 'villager').map((u) => u.id);
  return AoE2.commandsHtml(st).includes('data-arg="blacksmith"');
})();
Game.selection = blueVill().map((u) => u.id);
const bsFeudal = AoE2.commandsHtml(Game).includes('data-act="build" data-arg="blacksmith"');
Game.selection = [];
check(!bsDark && bsFeudal, 'ui: the Blacksmith button appears with the Feudal Age',
  'darkAge=' + bsDark + ' feudal=' + bsFeudal);

// T5: the research surface. A built Blacksmith (fixture; the Game above is
// Feudal since the age check) offers its unresearched TECHS rows as
// data-act="research" buttons with costs, unaffordable ones disabled
// (Bracer's 200 gold > our 50), researched ones gone; the queue panel grows
// a Researching bar from b.research; and clicking a button dispatches
// through the delegated listener to researchTech.
Game.selection = [];
Game.selectedBuilding = { kind: 'blacksmith', team: 0, built: 1, hp: 1800, maxHp: 1800, queue: [], research: null };
const bsB = Game.selectedBuilding;
const bsCmd = (() => {
  const plain = AoE2.commandsHtml(Game);
  Game.techs[0].add('forge');
  const withForge = AoE2.commandsHtml(Game);
  Game.techs[0].delete('forge');
  return { plain, withForge };
})();
check(bsCmd.plain.includes('data-act="research" data-arg="forge"') &&
  bsCmd.plain.includes('data-act="research" data-arg="fletching"') &&
  bsCmd.plain.includes('100 F 50 G') &&
  bsCmd.plain.includes('data-act="research" data-arg="bracer" disabled') &&
  !bsCmd.withForge.includes('data-act="research" data-arg="forge"') &&
  bsCmd.withForge.includes('data-act="research" data-arg="fletching"'),
  'ui: a built Blacksmith offers its unresearched techs with their costs',
  (bsCmd.plain.match(/data-act="research" data-arg="\w+"/g) || []).join(' ') || 'no research buttons');
const qStart = (bsB.research = { id: 'forge', t: AoE2.TECHS.forge.time }, AoE2.queueHtml(Game));
const qHalf = (bsB.research.t = 25, AoE2.queueHtml(Game));
const qIdle = (bsB.research = null, AoE2.queueHtml(Game));
check(qStart.includes('Researching Forge') && qStart.includes('width:0%') &&
  qHalf.includes('Researching Forge') && qHalf.includes('width:50%') &&
  qIdle.includes('Blacksmith: idle'),
  'ui: the queue panel shows the research bar at the right percentage',
  qStart.slice(0, 70) + ' | ' + qHalf.slice(0, 70));
const rBtn = stubEl('button', 'btnRes', 60, 24);
rBtn.setAttribute('data-act', 'research');
rBtn.setAttribute('data-arg', 'scale_mail');
const uiFood0 = Game.res[0].food;
Game.dom.commands.listeners.click.forEach(fn => fn({ target: rBtn }));
check(!!bsB.research && bsB.research.id === 'scale_mail' &&
  bsB.research.t === AoE2.TECHS.scale_mail.time && Game.res[0].food === uiFood0 - 100,
  'ui: clicking a research button starts that research and spends the cost',
  'slot ' + JSON.stringify(bsB.research) + ' food ' + Game.res[0].food + ' was ' + uiFood0);
Game.selectedBuilding = null;

// T3: the Market's trade surface (this plan, T3). Six buttons on a built Market,
// each carrying `disabled` exactly when its own half would be refused (the
// affordance rule the train buttons follow), and the delegated click handler
// dispatching one of them through trade in the same tick the panel is rebuilt.
// The stockpile is funded to the row's needs first: §11's earlier checks spent
// the town down to 75 wood, and selling 100 of anything needs 100 of it.
Game.selection = [];
Game.selectedBuilding = { kind: 'market', team: 0, built: 1, hp: 1800, maxHp: 1800, queue: [], research: null };
Game.res[0] = { food: 300, wood: 300, gold: 300, stone: 300 };
const mkCmd = AoE2.commandsHtml(Game);
check(['food', 'wood', 'stone'].every((res) =>
  mkCmd.includes('data-act="trade" data-arg="' + res + ':sell"') &&
  mkCmd.includes('data-act="trade" data-arg="' + res + ':buy"')),
  'ui: a built Market offers sell and buy for each resource',
  (mkCmd.match(/data-act="trade" data-arg="[^"]+"/g) || []).join(' ') || 'no trade buttons');
const sellBtn = stubEl('button', 'btnSellWood', 60, 24);
sellBtn.setAttribute('data-act', 'trade');
sellBtn.setAttribute('data-arg', 'wood:sell');
const mkSell0 = Game.res[0].wood, mkGold0 = Game.res[0].gold;
Game.dom.commands.listeners.click.forEach((fn) => fn({ target: sellBtn }));
check(Game.res[0].wood === mkSell0 - 100 && Game.res[0].gold === mkGold0 + AoE2.BLD.market.trade.sell,
  'ui: clicking Sell Wood moves exactly 100 wood into gold',
  'wood ' + Game.res[0].wood + ' (was ' + mkSell0 + ') gold ' + Game.res[0].gold +
  ' (was ' + mkGold0 + ')');
Game.res[0].food = 40;                                  // below the 100 a sell half needs
Game.res[0].wood = 100;                                 // wood is still sellable, so its button stays live
const mkShort = AoE2.commandsHtml(Game);
check(mkShort.includes('data-act="trade" data-arg="food:sell" disabled') &&
  !mkShort.includes('data-act="trade" data-arg="wood:sell" disabled'),
  'ui: a sell button is disabled while that stockpile is short',
  (mkShort.match(/data-act="trade" data-arg="[^"]+"( disabled)?/g) || []).join(' ') || 'no trade buttons');
Game.selectedBuilding = null;

/* ---- 11b. uniform HUD frame (this plan, T1) -------------------------- */
/* The frame contract (plan 2026-11-12-uniform-hud-frame T1): hudState answers the
   one word the footer is stamped with, hudHtml owns its markup, and no selection
   state may change the footer's STRUCTURE. `topDivs` extracts the class#id of
   every top-level div in document order, so a state that renders a different shape
   (a missing panel, an extra wrapper) reads as a different string. */
const topDivs = (markup) => {
  const re = /<(\/?)div\b([^>]*)>/g;
  let m, depth = 0;
  const out = [];
  while ((m = re.exec(markup))) {
    if (m[1] === '/') { depth--; continue; }
    if (depth === 0) {
      out.push(((m[2].match(/class="([^"]*)"/) || [0, ''])[1]) + '#' + ((m[2].match(/id="([^"]*)"/) || [0, ''])[1]));
    }
    depth++;
  }
  return out.join(' ');
};
const hudFix = (want, build) => {
  try {
    const st = build(AoE2.createState());
    return { want, state: String(AoE2.hudState(st)), markup: AoE2.hudHtml(st), info: AoE2.infoHtml(st) };
  } catch (e) { return { want, err: e.message }; }
};
const atUnit = (st, kind, i) => AoE2.makeUnit(st, kind, 0,
  tileCentre(st, 40 + (i % 4), 40 + ((i / 4) | 0)).x, tileCentre(st, 40 + (i % 4), 40 + ((i / 4) | 0)).y).id;
const pickKind = (kinds) => (st) => { st.selection = kinds.map((k, i) => atUnit(st, k, i)); return st; };
const pickHouse = (st) => { st.selection = []; st.selectedBuilding = AoE2.makeBuilding(st, 'house', 0, 50, 50); return st; };
const SHELL = 'info#info commands#commands queue#queue';
const hudStates = [
  hudFix('units', (st) => { st.selection = [st.units.find((u) => u.team === 0).id]; return st; }),
  hudFix('group', pickKind(['villager', 'militia', 'archer'])),
  hudFix('building', pickHouse),
  hudFix('none', (st) => st),
];
check(hudStates.every((f) => !f.err && f.state === f.want && topDivs(f.markup) === SHELL),
  'hud: every selection state renders the same footer structure',
  hudStates.map((f) => f.want + '=' +
    (f.err ? 'ERR ' + f.err : f.state + ' ' + topDivs(f.markup))).join(' | '));

const squad12 = hudFix('group', pickKind(['villager', 'villager', 'villager', 'villager', 'villager',
  'militia', 'militia', 'militia', 'militia', 'archer', 'archer', 'archer']));
const sums = [hudStates[1], squad12].map((f) =>
  (f.info ? (f.info.match(/<span class="sum"[^>]*>[^<]*<\/span>/g) || []) : ['ERR ' + f.err]).join('|'));
check(sums[0] === '<span class="sum">1 Villager, 1 Militia, 1 Archer</span>' &&
      sums[1] === '<span class="sum">5 Villager, 4 Militia, 3 Archer</span>',
  'hud: a group selection renders one summary element for any squad size',
  sums.join('  ...  '));

const footerRule = (styleCss.match(/(?:^|[\s};])footer\s*\{([^}]*)\}/) || [])[1];
const rootRule = (styleCss.match(/:root\s*\{([^}]*)\}/) || [])[1];
const footerVar = ((rootRule || '').match(/--footer-h:\s*([^;]+);/) || [])[1];
check(!!footerRule && !!footerVar && footerRule.includes('height:var(--footer-h)') &&
      footerRule.includes('flex:0 0 var(--footer-h)') && !/min-height/.test(footerRule) &&
      !/min-height:74px/.test(styleCss),
  'hud: the CSS declares one footer height in --footer-h, not a min-height',
  footerRule === undefined ? 'no footer{…} rule in the stylesheet'
    : '--footer-h=' + footerVar + ' footer{' + footerRule.replace(/\s+/g, ' ').trim().slice(0, 90) +
      '} | footer min-height=' + /min-height/.test(footerRule));

/* docs/TODO.md P2-15: the footer measured 74 px, which left the .info body row 24 px
   (74 − 2·8 padding − 16 h4 − 6 hp − 2·4 row-gap) — one and a half lines at the 12 px
   font, so the third line of infoHtml ("Order: build") was cut. The declared height is
   now derived from what the panel needs: three body lines at the .body line-height plus
   the fixed rows, the gaps and the padding. Parsed, not eyeballed: no browser here. */
const infoRule = (styleCss.match(/(?:^|[\s};])\.info\s*\{([^}]*)\}/) || [])[1];
const bodyRule = (styleCss.match(/(?:^|[\s};])\.info \.body\s*\{([^}]*)\}/) || [])[1];
const pxOf = (rule, name) => +(((rule || '').match(new RegExp('(?:^|;)\\s*' + name + ':\\s*(-?[0-9.]+)px')) || [])[1]);
const infoRows = ((infoRule || '').match(/grid-template-rows:\s*([^;]+)/) || [])[1];
const fixedRows = (infoRows || '').match(/-?[0-9.]+px/g) || [];
const padY = pxOf(infoRule, 'padding'), gapY = pxOf(infoRule, 'row-gap'), lineH = pxOf(bodyRule, 'line-height');
const fixedH = fixedRows.reduce((s, v) => s + parseFloat(v), 0);
const needH = padY * 2 + fixedH + gapY * 2 + lineH * 3;
check(!!infoRule && !!bodyRule && /(^|;)\s*height:\s*100%/.test(infoRule || '') &&
      /minmax\(0,\s*1fr\)/.test(infoRows || '') && fixedRows.length === 2 &&
      [padY, gapY, lineH].every(Number.isFinite) && footerVar === needH + 'px',
  'hud: the footer is tall enough for the three info lines infoHtml can render',
  infoRule === undefined || bodyRule === undefined ? 'no .info{…} / .info .body{…} rule to measure'
    : '2·' + padY + ' padding + ' + fixedH + ' fixed rows (h4+hp) + 2·' + gapY + ' row-gap + 3·' + lineH +
      ' body lines = ' + needH + 'px, --footer-h=' + String(footerVar) + ' rows=' + String(infoRows));

const btnRule = (styleCss.match(/(?:^|[\s};])button\s*\{([^}]*)\}/) || [])[1];
check(/(^|;)\s*white-space:\s*nowrap/.test(btnRule || '') &&
      /(^|;)\s*overflow:\s*hidden/.test(btnRule || '') &&
      /(^|;)\s*text-overflow:\s*ellipsis/.test(btnRule || ''),
  'ui: buttons clip a long label with an ellipsis instead of wrapping over the row',
  btnRule === undefined ? 'no button{…} rule in the stylesheet'
    : 'button{' + btnRule.replace(/\s+/g, ' ').trim().slice(0, 120) + '}');

const viewRule = (styleCss.match(/(?:^|[\s};])#view\s*\{([^}]*)\}/) || [])[1];
check(!!viewRule && /touch-action:\s*none/.test(viewRule),
  'ui: the canvas declares touch-action:none so a touch drag cannot scroll the page',
  viewRule === undefined ? 'no #view{…} rule in <style>'
    : '#view{' + viewRule.replace(/\s+/g, ' ').trim().slice(0, 90) + '}');

/* renderHud's half of the contract: the checks above read the pure builders, so a
   footer that never gets written (or never gets stamped) still passes them. Render
   the live Game and read #hud back — the same read-back the §9 result overlay uses
   (overlayHtml) — for every selection state. */
const paintedHud = (sel, bld) => {
  const had = [Game.selection.slice(), Game.selectedBuilding];
  try {
    Game.selection = sel; Game.selectedBuilding = bld;
    AoE2.renderFrame(Game);
    const hud = Game.dom.hud || {};
    return (hud.attrs ? String(hud.attrs['data-state']) : '<no #hud>') + '|' +
      (typeof hud.innerHTML === 'string' && hud.innerHTML === domHtml(AoE2.hudHtml(Game))
        ? 'html=hudHtml' : 'html=MISMATCH');
  } catch (e) { return 'ERR ' + e.message; }
  finally { Game.selection = had[0]; Game.selectedBuilding = had[1]; }
};
const painted = [
  paintedHud([blueVill()[0].id], null),
  paintedHud(blueVill().slice(0, 2).map((u) => u.id), null),
  paintedHud([], Game.buildings.find((b) => b.team === 0)),
  paintedHud([], null),
];
check(painted.join(' ') === 'units|html=hudHtml group|html=hudHtml building|html=hudHtml none|html=hudHtml',
  'hud: renderHud stamps #hud and writes exactly hudHtml for every state', painted.join(' '));

/* ---- 11c. responsive layout (this plan, T3) ---- */
/* The phone layout is one media block written last so it wins the cascade, and the
   checks read it as text naming the desktop rules it overrides: drift on either
   side shows up in the failure. §11b's `hud: the CSS declares one footer height in
   --footer-h` keeps proving the desktop footer itself never moved. */
const mediaAt = styleCss.indexOf('@media (max-width:720px){');
check(styleCss.indexOf('footer{') >= 0 && mediaAt > styleCss.indexOf('footer{'),
  'ui: the CSS ships a max-width:720px block after the desktop rules',
  'footer{@' + styleCss.indexOf('footer{') + ' media@' + mediaAt + ' of ' + styleCss.length);

const mediaIn = styleCss.indexOf('@media (max-width:720px){');
const baseCss = mediaIn < 0 ? styleCss : styleCss.slice(0, mediaIn);
const mediaCss = mediaIn < 0 ? '' : ((styleCss.slice(mediaIn).match(/\{([\s\S]*)\}/) || [])[1] || '');
const ruleOf = (css, sel) => (css.match(new RegExp('(?:^|[\\s};])' + sel + '\\s*\\{([^}]*)\\}')) || [])[1];
const propOf = (rule, name) => ((rule || '').match(new RegExp('(?:^|;)\\s*' + name + ':\\s*([^;]+)')) || [])[1];

const mFooter = ruleOf(mediaCss, 'footer'), bFooter = ruleOf(baseCss, 'footer');
check(/(^|;)\s*flex-direction:\s*column/.test(mFooter || '') &&
      /(^|;)\s*height:\s*var\(--footer-h\)/.test(mFooter || '') &&
      propOf(mFooter, 'height') === propOf(bFooter, 'height') &&
      /\B\.info\s*\{/.test(mediaCss) + /\B\.commands\s*\{/.test(mediaCss) + /\B\.queue\s*\{/.test(mediaCss) === 3,
  'ui: the responsive footer stacks the three panels and keeps the shared --footer-h height',
  'media footer{' + String(mFooter) + '} vs base footer{' + String(bFooter) + '} panels=' +
  ['.info', '.commands', '.queue'].filter((s) => /\S/.test(ruleOf(mediaCss, s) || '')).join(','));

const mHeader = ruleOf(mediaCss, 'header'), bHeader = ruleOf(baseCss, 'header');
check(propOf(mHeader, 'padding') === '2px 6px' && propOf(bHeader, 'padding') === '6px 10px' &&
      propOf(mHeader, 'gap') === '6px' && propOf(bHeader, 'gap') === '14px',
  'ui: the responsive block trims the header padding the desktop rule declares',
  'media header{' + String(mHeader) + '} vs base header{' + String(bHeader) + '}');

/* docs/TODO.md P2-16 (header half): the header is one unbreakable flex row on the desktop
   (`src/style.css:10` has no flex-wrap), so at 390 px the report says stone, pop, age and
   both buttons fell off the right edge -- the footer half of that entry was item 15. The
   phone block now wraps it into two rows and the two checks below are the proof: no browser
   on this box, so the widths are computed from src/style.css + index.html the way the
   --footer-h check above is, not eyeballed.
   The width model: the ui-monospace stack (the `html,body` font, which `button{font:inherit}`
   and `.res b{font-variant-numeric:tabular-nums}` both reuse) advances 0.6em per character,
   so a text run measures length x (font-size x 0.6 + letter-spacing); a box adds its own
   padding and borders, and a flex row adds one `gap` between every pair of items. Row 1 with
   the desktop button paddings (4px 14px, 4px 10px) measures 392.7 px -- 2.7 px over the
   viewport, which is why the phone rules shrink them to 2px 8px. Row 2's values are the ones
   the header ships -- with the longest name in AGES for the age cell, the one value
   renderHud swaps in (`src/hud.js:24`) -- and a bigger runtime number cannot widen that row:
   `flex:1 1 0;min-width:0` fixes every cell to one sixth of the line and `.res b`
   ellipsizes what does not fit. */
const PHONE_W = 390;
const pxVal = (v) => +(((String(v).match(/(-?[0-9.]+)px/)) || [])[1]);
const padX = (rule) => {                              // horizontal padding of a 1-4 value box
  const p = (String(rule || '').match(/(?:^|;)\s*padding:\s*([^;]+)/) || [])[1];
  if (p === undefined) return NaN;
  const v = p.trim().split(/\s+/).map(parseFloat);
  return v.length >= 2 ? v[1] : v[0];
};
const textW = (s, px, ls) => String(s).length * (px * 0.6 + (ls || 0));

const headerMarkup = (html.match(/<header>([\s\S]*?)<\/header>/) || [])[1] || '';
const brandMarkup = (headerMarkup.match(/<div class="brand">([\s\S]*?)<\/div>/) || [])[1] || '';
const brandStrong = (brandMarkup.split('<small>')[0] || '').replace(/&nbsp;/g, ' ').replace(/\s+$/, '');
const brandSmall = (brandMarkup.match(/<small>([^<]*)<\/small>/) || [])[1] || '';
const btnLabel = (cls) => (headerMarkup.match(new RegExp('<button[^>]*class="' + cls + '"[^>]*>([^<]*)</button>')) || [])[1] || '';
const cells = [...headerMarkup.matchAll(/<div class="res" id="(r_\w+)"><span>([^<]*)<\/span><b>([^<]*)<\/b><\/div>/g)]
  .map((m) => ({ id: m[1], label: m[2], value: m[3] }));

const mRes = ruleOf(mediaCss, '.res'), mSpan = ruleOf(mediaCss, '.res span'), mBold = ruleOf(mediaCss, '.res b');
const bRes = ruleOf(baseCss, '.res');
const mSave = ruleOf(mediaCss, 'header .save'), mMute = ruleOf(mediaCss, 'header .mute');
check(cells.length === 6 && propOf(mHeader, 'flex-wrap') === 'wrap' &&
      propOf(mSave, 'order') === '1' && propOf(mMute, 'order') === '2' &&
      propOf(mRes, 'order') === '3' && propOf(mRes, 'flex') === '1 1 0' && propOf(mRes, 'min-width') === '0' &&
      propOf(mSpan, 'font-size') === '9px' && propOf(mSpan, 'letter-spacing') === '0' &&
      propOf(mBold, 'font-size') === '12px' && /(^|;)\s*text-overflow:\s*ellipsis/.test(mBold || ''),
  'ui: the phone header wraps into two rows, buttons on row 1 and six cells on row 2',
  'markup cells=' + cells.length + ' | header{flex-wrap:' + String(propOf(mHeader, 'flex-wrap')) + '}' +
  ' save{order:' + String(propOf(mSave, 'order')) + ' padding:' + String(propOf(mSave, 'padding')) + '}' +
  ' mute{order:' + String(propOf(mMute, 'order')) + ' padding:' + String(propOf(mMute, 'padding')) + '}' +
  ' res{order:' + String(propOf(mRes, 'order')) + ' flex:' + String(propOf(mRes, 'flex')) +
  ' min-width:' + String(propOf(mRes, 'min-width')) + ' gap:' + String(propOf(mRes, 'gap')) + '}' +
  ' res span{font-size:' + String(propOf(mSpan, 'font-size')) + ' letter-spacing:' +
  String(propOf(mSpan, 'letter-spacing')) + '} res b{font-size:' + String(propOf(mBold, 'font-size')) + '}');

const rootPx = pxVal(propOf(ruleOf(baseCss, 'html,body'), 'font'));
const btnPx = pxVal(propOf(ruleOf(baseCss, 'button'), 'font')) || rootPx;
const brandPx = pxVal(propOf(ruleOf(baseCss, 'header .brand'), 'font-size')) || rootPx;
const brandLS = pxVal(propOf(ruleOf(baseCss, 'header .brand'), 'letter-spacing')) || 0;
const smallLS = pxVal(propOf(ruleOf(baseCss, 'header .brand small'), 'letter-spacing')) || 0;
const brandGap = pxVal(propOf(ruleOf(baseCss, 'header .brand'), 'gap'));
const btnBorder = (pxVal(propOf(ruleOf(baseCss, 'button'), 'border')) || 0) * 2;
const headerPadX = padX(mHeader), headerGap = pxVal(propOf(mHeader, 'gap'));
const labelPx = pxVal(propOf(mSpan, 'font-size')), labelLS = pxVal(propOf(mSpan, 'letter-spacing')) || 0;
const valuePx = pxVal(propOf(mBold, 'font-size'));
const cellPadX = padX(mRes), cellBorder = pxVal(propOf(bRes, 'border-left')) || 0, cellGap = pxVal(propOf(mRes, 'gap'));
const widestAge = AoE2.AGES.reduce((a, b) => (b.length > a.length ? b : a), '');
const cellW = (c) => textW(c.label, labelPx, labelLS) + cellGap +
  textW(c.id === 'r_age' ? widestAge : c.value, valuePx) + cellPadX * 2 + cellBorder;

const row1 = textW(brandStrong, brandPx, brandLS) + brandGap + textW(brandSmall, brandPx, smallLS) +
  (textW(btnLabel('save'), btnPx) + padX(mSave) * 2 + btnBorder) +
  (textW(btnLabel('mute'), btnPx) + padX(mMute) * 2 + btnBorder) +
  headerPadX * 2 + headerGap * 2;
const row2 = cells.reduce((sum, c) => sum + cellW(c), 0) + headerPadX * 2 + headerGap * (cells.length - 1);
check(Number.isFinite(row1) && Number.isFinite(row2) && row1 <= PHONE_W && row2 <= PHONE_W,
  'ui: each phone header row fits inside the 390px viewport',
  'row1(brand+save+mute)=' + row1.toFixed(1) + 'px row2(' + cells.length + ' cells)=' + row2.toFixed(1) +
  'px, viewport ' + PHONE_W + 'px (inner ' + (PHONE_W - headerPadX * 2) + 'px after ' + headerPadX + 'px padding)');

/* ---- 11d. one write per change (docs/TODO.md P0-1) ------------------- */
/* renderHud compares the markup against the string it last wrote (Game.dom.hudLast /
   .resultLast) instead of against el.innerHTML. A browser hands innerHTML back serialised
   (`<button disabled>` comes back as `disabled=""`), so that comparison never matched while
   any button was disabled and the footer was rebuilt 60 times a second: the button under
   the pointer was replaced between mouse-down and mouse-up, so a real click landed on the
   footer and armed nothing (verified in Chromium: 0 of 10 clicks on `House` armed
   placement, while the 0 ms synthetic clicks the checks used to make all passed). The
   harness stub serialises the same way and counts its writes, so the old code fails here
   on both panels — §11b's read-back keeps proving the content itself. */
bootFixture(undefined, (doc, st) => {
  const sets = (k) => st.dom[k]._htmlSets;
  const hud0 = sets('hud'), res0 = sets('result');              // boot's own first frame
  st.selection = st.units.filter((u) => u.team === 0).map((u) => u.id);
  st.result = 'victory';                                        // both panels gain new content
  AoE2.renderFrame(st);
  const hud1 = sets('hud'), res1 = sets('result');
  AoE2.renderFrame(st);                                         // same state: nothing to write
  check(hud1 === hud0 + 1 && res1 === res0 + 1 && sets('hud') === hud1 && sets('result') === res1,
    'hud: a changed frame writes each panel once, an unchanged frame writes neither',
    '#hud ' + hud0 + '->' + hud1 + '->' + sets('hud') + ' #result ' + res0 + '->' + res1 +
    '->' + sets('result'));
});
report();
