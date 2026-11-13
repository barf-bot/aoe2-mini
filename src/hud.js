'use strict';
/* hud -- the footer/header DOM: resource bar, info panel, command buttons, queue, result overlay. */

function renderHud(Game) {
  const d = Game.dom || {};
  const setText = (el, val) => { if (el && el.textContent !== val) el.textContent = val; };
  /* d.hud / d.result hold markup: write innerHTML when the element has one, otherwise
     fall back to textContent (keeps the node stub working). The test is against the
     string last written (d.hudLast / d.resultLast), NEVER against el.innerHTML: a browser
     serialises `<button disabled>` back as `disabled=""`, so the two never match while any
     button is disabled and the footer is rebuilt 60 times a second — the button under the
     pointer is replaced between mouse-down and mouse-up, so the click lands on the footer
     and buttonAt finds no button (docs/TODO.md P0-1). */
  const setHTML = (key, el, val) => {
    if (!el || d[key] === val) return;
    d[key] = val;
    if (typeof el.innerHTML === 'string') el.innerHTML = val; else el.textContent = val;
  };
  setText(d.set_food, String(Math.floor(Game.res[0].food)));
  setText(d.set_wood, String(Math.floor(Game.res[0].wood)));
  setText(d.set_gold, String(Math.floor(Game.res[0].gold)));
  setText(d.set_stone, String(Math.floor(Game.res[0].stone)));
  setText(d.set_pop, popUsed(Game, 0) + '/' + popCap(Game, 0));
  setText(d.set_age, AGES[Game.age[0]]);
  if (d.hud) {                                            /* one write for the whole frame */
    if (d.hud.setAttribute) d.hud.setAttribute('data-state', hudState(Game));
    setHTML('hudLast', d.hud, hudHtml(Game));
  }
  setHTML('resultLast', d.result, resultHtml(Game));   /* '' while the game is still running */
  if (d.result && d.result.classList) {         /* CSS hides it while the class is off */
    if (Game.result) d.result.classList.add('show'); else d.result.classList.remove('show');
  }
}

/** The one selection word this Game's footer is in, stamped on it as data-state.
 *  Game.placing deliberately never changes it: placing a building swaps the info
 *  panel's CONTENT (see infoHtml), not the frame around it. */
function hudState(Game) {
  const n = selectedUnits(Game).length;
  if (n > 1) return 'group';
  if (n === 1) return 'units';
  return Game.selectedBuilding ? 'building' : 'none';
}

/** The single owner of the footer's markup: the three fixed panels in the same
 *  order for every state, filled by the three pure builders. The frame never
 *  changes with the selection — only the content inside these boxes — which is
 *  what lets the CSS pin the footer to one height (see the footer/.info/
 *  .commands/.queue rules). */
function hudHtml(Game) {
  return '<div class="info" id="info">' + infoHtml(Game) + '</div>' +
    '<div class="commands" id="commands">' + commandsHtml(Game) + '</div>' +
    '<div class="queue" id="queue">' + queueHtml(Game) + '</div>';
}

/** The end-of-game overlay markup: empty while the game runs, otherwise the
 *  result title and the same data-act="restart" action the command bar's
 *  "New map" button uses (boot wires a click listener on this element too). */
function resultHtml(Game) {
  if (!Game.result) return '';
  const win = Game.result === 'victory';
  return '<h2 class="' + (win ? 'win' : 'lose') + '">' + (win ? 'Victory' : 'Defeat') + '</h2>' +
    '<p>' + (win ? 'The enemy Town Center is razed.' : 'Your Town Center is gone.') + '</p>' +
    '<button data-act="restart">New game</button>';
}

function infoHtml(Game) {
  /* every state fills the same three slots (title / body / hp bar) so the panel
     is the same box whatever is selected; .body clips whatever does not fit */
  const shell = (title, body, pct) => '<h4>' + title + '</h4><div class="body">' + body +
    '</div><div class="hp"><i style="width:' + pct + '%"></i></div>';
  const pctOf = (hp, maxHp) => Math.max(0, Math.min(100, 100 * hp / maxHp));
  const sel = selectedUnits(Game);
  if (Game.placing) {
    return shell('Placing ' + BLD[Game.placing].label, 'Click the map to place, Esc to cancel', 0);
  }
  if (sel.length === 1) {
    const u = sel[0];
    return shell(KINDS[u.kind].label, 'HP ' + Math.ceil(u.hp) + '/' + u.maxHp +
      '<br>Order: ' + u.order.kind + (u.carry ? ' (' + Math.floor(u.carry) + ' ' + u.carryRes + ')' : ''),
      pctOf(u.hp, u.maxHp));
  }
  if (sel.length) {
    /* a group gets ONE summary line instead of one line per unit: per-kind counts,
       at most 3 kinds named, the rest collapsed into "+K more" */
    const n = {};
    for (const u of sel) n[u.kind] = (n[u.kind] || 0) + 1;
    const kinds = Object.keys(n);
    const shown = kinds.slice(0, 3).map(k => n[k] + ' ' + KINDS[k].label);
    if (kinds.length > 3) shown.push('+' + (kinds.length - 3) + ' more');
    return shell(sel.length + ' units', '<span class="sum">' + shown.join(', ') + '</span>',
      pctOf(sel.reduce((s, u) => s + u.hp, 0), sel.reduce((s, u) => s + u.maxHp, 0)));
  }
  const b = Game.selectedBuilding;
  if (b) {
    const ups = Object.keys(TECHS).filter(id => TECHS[id].building === b.kind && Game.techs[b.team].has(id))
      .map(id => TECHS[id].label);
    return shell(BLD[b.kind].label, 'HP ' + Math.ceil(b.hp) + '/' + b.maxHp +
      (b.field ? '<br>Field: ' + Math.ceil(b.field) : '') +
      (ups.length ? '<br>Upgrades: ' + ups.join(', ') : ''), pctOf(b.hp, b.maxHp));
  }
  return shell('', 'Left click or drag to select<br>Right click to move / attack / gather<br>' +
    'WASD / arrows / two fingers or screen edges pan<br>Ctrl+1..9 group, 1..9 recall', 0);
}

function commandsHtml(Game) {
  const sel = selectedUnits(Game);
  const b = Game.selectedBuilding;
  const out = [];
  if (b && b.built >= 1) {
    for (const k of BLD[b.kind].trains || []) {
      const ok = canAfford(Game, b.team, KINDS[k].cost) && popCommitted(Game, b.team) < popCap(Game, b.team);
      out.push('<button data-act="train" data-arg="' + k + '"' + (ok ? '' : ' disabled') + '>' +
        KINDS[k].label + '<span class="c">' + fmtCost(KINDS[k].cost) + '</span></button>');
    }
    for (const id in TECHS) {                        // research buttons for this building
      const t = TECHS[id];
      if (t.building !== b.kind || Game.techs[b.team].has(id)) continue;
      out.push('<button data-act="research" data-arg="' + id + '"' +
        (!canAfford(Game, b.team, t.cost) || b.research ? ' disabled' : '') + '>' +
        t.label + '<span class="c">' + fmtCost(t.cost) + '</span></button>');
    }
    const rates = BLD[b.kind].trade;                  // the Market's sell/buy pair
    if (rates) for (const res of ['food', 'wood', 'stone']) {
      const label = res[0].toUpperCase() + res.slice(1);
      out.push('<button data-act="trade" data-arg="' + res + ':sell"' +
        (canAfford(Game, b.team, { [res]: 100 }) ? '' : ' disabled') + '>' +
        'Sell ' + label + '<span class="c">' + fmtCost({ gold: rates.sell }) + '</span></button>');
      out.push('<button data-act="trade" data-arg="' + res + ':buy"' +
        (canAfford(Game, b.team, { gold: rates.buy }) ? '' : ' disabled') + '>' +
        'Buy ' + label + '<span class="c">' + fmtCost({ gold: rates.buy }) + '</span></button>');
    }
    /* the tower chain: the row's own next tier, offered exactly when `upgradeBuilding`
       would accept it — an age-locked tier is not offered at all (the rule the villager
       build list below follows) and an unaffordable one is offered `disabled` (the rule
       the train and market buttons above follow). */
    const up = BLD[b.kind].upgradesTo;
    if (up && (BLD[up].age ?? 0) <= Game.age[b.team]) {
      out.push('<button data-act="upgrade" data-arg="' + up + '"' +
        (canAfford(Game, b.team, BLD[up].cost) ? '' : ' disabled') + '>Upgrade to ' +
        BLD[up].label + '<span class="c">' + fmtCost(BLD[up].cost) + '</span></button>');
    }
  }
  if (b && b.built < 1) {
    out.push('<button data-act="cancel">Cancel<span class="c">80% back</span></button>');
  }
  if (b && b.built >= 1 && b.kind !== 'town_center') {
    out.push('<button data-act="demolish">Demolish</button>');
  }
  const villagers = sel.filter(u => u.kind === 'villager');
  if (villagers.length && !b) {
    for (const k in BLD) {
      if (k === 'town_center') continue;
      const def = BLD[k];
      if ((def.age ?? 0) > Game.age[0]) continue;   // age-locked kinds are not offered at all
      out.push('<button data-act="build" data-arg="' + k + '"' +
        (Game.placing === k ? ' class="armed"' : '') +
        (canAfford(Game, 0, def.cost) ? '' : ' disabled') + '>' +
        def.label + '<span class="c">' + fmtCost(def.cost) + '</span></button>');
    }
  }
  if (!sel.length && !b && Game.age[0] < AGES.length - 1) {
    const cost = Game.age[0] === 0 ? CFG.AGE_FOOD : CFG.AGE_FOOD * 2;
    out.push('<button data-act="age"' + (canAfford(Game, 0, { food: cost }) ? '' : ' disabled') + '>' +
      AGES[Game.age[0] + 1] + '<span class="c">' + cost + ' food</span></button>');
    out.push('<button data-act="restart">New map</button>');
  }
  return out.join('') || '<div class="hint">No commands</div>';
}

function queueHtml(Game) {
  const b = Game.selectedBuilding;
  if (!b) return '<div class="hint">Select a building to see its queue</div>';
  if (b.built < 1) {
    return '<div class="hint">Building ' + BLD[b.kind].label + '</div><div class="bar"><i style="width:' +
      Math.round(100 * b.built) + '%"></i></div>';
  }
  if (b.research) {                                  // the research slot shows its own bar
    const r = b.research;
    return '<div class="hint">Researching ' + TECHS[r.id].label + '</div><div class="bar"><i style="width:' +
      Math.max(0, Math.min(100, 100 * (1 - r.t / TECHS[r.id].time))) + '%"></i></div>';
  }

  if (!b.queue.length) return '<div class="hint">' + BLD[b.kind].label + ': idle</div>';
  const q = b.queue[0];
  const pct = Math.max(0, Math.min(100, 100 * (1 - q.t / KINDS[q.kind].time)));
  return '<div class="hint">Training ' + KINDS[q.kind].label + '</div><div class="bar"><i style="width:' +
    pct + '%"></i></div><div class="hint">' + (b.queue.length - 1) + ' more queued</div>';
}

function fmtCost(cost) {
  return Object.keys(cost).map(k => cost[k] + ' ' + k[0].toUpperCase()).join(' ');
}
