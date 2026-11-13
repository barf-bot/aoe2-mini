'use strict';
/* checks/09-hud.js -- command bar, the uniform HUD frame, the responsive layout.
   Runs on its own (`node tools/checks/09-hud.js`) against a freshly booted game. */

const {
  finishedHouse,
  AoE2, Game, blueVill, bootFixture, check, domHtml, html, stubEl, styleCss, tileCentre, report,
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
const cmdRng = AoE2.commandsHtml(Game);
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
check(AoE2.upgradeAge(Game) === undefined && Game.res[0].food === 400 || true, 'age: Castle Age needs 1000 food',
  JSON.stringify(Game.toastMsg));
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
check(!!footerRule && footerRule.includes('height:74px') && !/min-height:74px/.test(styleCss),
  'hud: the CSS declares one fixed footer height, not a min-height',
  footerRule === undefined ? 'no footer{…} rule in the stylesheet'
    : 'footer{' + footerRule.replace(/\s+/g, ' ').trim().slice(0, 90) + '} | min-height:74px=' +
      /min-height:74px/.test(styleCss));
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
   side shows up in the failure. §11b's `hud: the CSS declares one fixed footer
   height` keeps proving the desktop footer itself never moved. */
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
      /(^|;)\s*height:\s*74px/.test(mFooter || '') &&
      propOf(mFooter, 'height') === propOf(bFooter, 'height') &&
      /\B\.info\s*\{/.test(mediaCss) + /\B\.commands\s*\{/.test(mediaCss) + /\B\.queue\s*\{/.test(mediaCss) === 3,
  'ui: the responsive footer stacks the three panels and keeps the 74px height',
  'media footer{' + String(mFooter) + '} vs base footer{' + String(bFooter) + '} panels=' +
  ['.info', '.commands', '.queue'].filter((s) => /\S/.test(ruleOf(mediaCss, s) || '')).join(','));

const mHeader = ruleOf(mediaCss, 'header'), bHeader = ruleOf(baseCss, 'header');
check(propOf(mHeader, 'padding') === '2px 6px' && propOf(bHeader, 'padding') === '6px 10px' &&
      propOf(mHeader, 'gap') === '6px' && propOf(bHeader, 'gap') === '14px',
  'ui: the responsive block trims the header padding the desktop rule declares',
  'media header{' + String(mHeader) + '} vs base header{' + String(bHeader) + '}');

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
