'use strict';
/* checks/11-sound.js -- the SFX table, the synth path, the mute toggle.
   Runs on its own (`node tools/checks/11-sound.js`) against a freshly booted game. */

const {
  AoE2, DT, Game, bad, bootFixture, builtAt, check, doc, fundedGame, html, ok, scriptSrc, siteAt,
  stubVoices, styleCss, tc, uiCheck, voicesOf, withAudio, withStorage, report,
} = require('../lib/harness');

/* ---- 14. sound (this plan, T1) ------------------------------- */
/* `SFX` is the sound contract: one row per sound, five fields per row, `fire`
   naming the function that plays it. The audio path and the call-site checks
   below both read this table instead of re-typing specs, the way §13 reads
   SAVE_FIELDS. */
const soundCheck = (name, fn) => {
  let out;
  try { out = fn(); } catch (e) { bad(name, 'threw ' + e.message); return; }
  check(out[0], name, out[1]);
};
const scriptFnNames = () => {
  const names = new Set();
  const re = /^function ([A-Za-z0-9_]+)/gm;
  let mm;
  while ((mm = re.exec(scriptSrc))) names.add(mm[1]);
  return names;
};
const SFX_WAVES = ['sine', 'square', 'sawtooth', 'triangle', 'custom'];
const SFX_FIELDS = ['wave', 'freq', 'dur', 'gain', 'fire'];
/* The call-site contract: every `playSfx(` in the script and the top-level
   function that owns it. The expectation is the table's own `fire` column
   written out, so a row cannot be played from a function it does not name and
   a stray call cannot hide in a third one (T5 widens this list, it does not
   restate it). */
const SFX_CALL_SITES = [
  "setResult:playSfx(Game, Game.result)",
  "hitUnit:playSfx(Game, 'hit')",
  "spawnArrow:playSfx(Game, 'arrow')",
  "updateUnit:playSfx(Game, 'build')",
  "upgradeAge:playSfx(Game, 'age')",
];
const callSites = () => {
  const sites = [];
  let owner = null;
  for (const line of scriptSrc.split('\n')) {
    const fn = /^function ([A-Za-z0-9_]+)/.exec(line);
    if (fn) owner = fn[1];
    if (!owner || owner === 'playSfx') continue;
    for (const call of line.match(/playSfx\([^)]*\)/g) || []) sites.push(owner + ':' + call);
  }
  return sites;
};

soundCheck('sound: the SFX table names every sound once and completely', () => {
  const sfx = AoE2.SFX;
  if (!sfx || typeof sfx !== 'object') return [false, 'AoE2.SFX is ' + String(sfx)];
  const names = scriptFnNames();
  const keys = Object.keys(sfx).sort();
  const problems = [];
  if (keys.join(',') !== ['age', 'arrow', 'build', 'defeat', 'hit', 'victory'].join(','))
    problems.push('names=' + JSON.stringify(keys));
  for (const name of Object.keys(sfx)) {
    const row = sfx[name];
    if (!row || typeof row !== 'object') { problems.push(name + ':row not an object'); continue; }
    const extra = Object.keys(row).filter((k) => SFX_FIELDS.indexOf(k) < 0);
    if (extra.length) problems.push(name + ':extra fields ' + extra.join(','));
    if (SFX_WAVES.indexOf(row.wave) < 0) problems.push(name + ':wave ' + JSON.stringify(row.wave));
    if (!Array.isArray(row.freq) || !row.freq.length ||
        !row.freq.every((f) => typeof f === 'number' && isFinite(f) && f > 0))
      problems.push(name + ':freq ' + JSON.stringify(row.freq));
    if (!(typeof row.dur === 'number' && isFinite(row.dur) && row.dur > 0))
      problems.push(name + ':dur ' + JSON.stringify(row.dur));
    if (!(typeof row.gain === 'number' && isFinite(row.gain) && row.gain > 0 && row.gain <= 1))
      problems.push(name + ':gain ' + JSON.stringify(row.gain));
    if (typeof row.fire !== 'string') problems.push(name + ':fire ' + JSON.stringify(row.fire));
    else if (!names.has(row.fire)) problems.push(name + ':fire ' + row.fire + ' is not a top-level function');
  }
  const shape = Object.keys(sfx).map((n) => n + '=' + sfx[n].wave +
    '[' + (Array.isArray(sfx[n].freq) ? sfx[n].freq.join(',') : JSON.stringify(sfx[n].freq)) + ']' +
    sfx[n].dur + '/' + sfx[n].gain + '@' + sfx[n].fire).join(' ');
  return [problems.length === 0, (problems.length ? 'problems: ' + problems.join(' ') : 'ok ') + shape];
});

soundCheck('sound: playSfx returns false with no AudioContext and builds nothing', () => {
  const g = AoE2.createState();
  const r = AoE2.playSfx(g, 'hit');
  return [r === false && g.sound === null,
    'return=' + String(r) + ' sound=' + String(g.sound) + ' (harness default: no AudioContext)'];
});

soundCheck('sound: playSfx returns false for a name the table does not know', () => {
  return withAudio((Ctor) => {
    const g = AoE2.createState();
    const r = AoE2.playSfx(g, 'nope');
    return [r === false && Ctor.instances.length === 0 &&
      (!g.sound || voicesOf(Ctor).length === 0),
      'SFX.nope=' + String(AoE2.SFX.nope) + ' return=' + String(r) +
      ' contexts=' + Ctor.instances.length];
  });
});

soundCheck('sound: a sound fires once per frame and again on the next', () => {
  return withAudio((Ctor) => {
    const g = AoE2.createState();
    g.frame = 1;
    const first = AoE2.playSfx(g, 'hit');
    const again = AoE2.playSfx(g, 'hit');
    const frame1 = voicesOf(Ctor).length;
    g.frame = 2;
    const nextFrame = AoE2.playSfx(g, 'hit');
    const frame2 = voicesOf(Ctor).length;
    g.frame = 3;
    const hit = AoE2.playSfx(g, 'hit');
    const arrow = AoE2.playSfx(g, 'arrow');
    return [first === true && again === false && frame1 === 1 && nextFrame === true &&
      frame2 === 2 && hit === true && arrow === true && voicesOf(Ctor).length === 4 &&
      Ctor.instances.length === 1,
      'frame1=' + first + '/' + again + ' voices=' + frame1 +
      ' frame2=' + nextFrame + ' voices=' + frame2 +
      ' frame3 hit=' + hit + ' arrow=' + arrow + ' totalVoices=' + voicesOf(Ctor).length +
      ' contexts=' + Ctor.instances.length + ' (one per game, reused)'];
  });
});

soundCheck("sound: each row's spec is what the oscillator gets", () => {
  return withAudio((Ctor) => {
    const problems = [];
    const names = Object.keys(AoE2.SFX);
    for (const name of names) {
      const row = AoE2.SFX[name];
      const g = AoE2.createState();
      const fired = AoE2.playSfx(g, name);
      const v = stubVoices(g.sound && g.sound.ctx);
      const got = v.length === 1 ? v[0] : null;
      const want = { type: row.wave, freq: row.freq, dur: row.dur, gain: row.gain };
      if (fired !== true || JSON.stringify(got) !== JSON.stringify(want))
        problems.push(name + '=' + JSON.stringify(got));
    }
    return [problems.length === 0,
      (problems.length ? 'problems: ' + problems.join(' ')
        : 'all ' + names.length + ' rows synthesised as authored') +
      ' contexts=' + Ctor.instances.length];
  });
});

soundCheck('sound: a muted game plays nothing', () => {
  return withStorage((s) => {
    AoE2.storageSet(AoE2.MUTE_PATH, '1');
    return withAudio((Ctor) => {
      const g = AoE2.createState();
      const muted = AoE2.isMuted(g);
      const returns = Object.keys(AoE2.SFX).map((n) => AoE2.playSfx(g, n));
      return [muted === true && returns.every((r) => r === false) && voicesOf(Ctor).length === 0,
        'isMuted=' + muted + ' returns=' + JSON.stringify(returns) +
        ' voices=' + voicesOf(Ctor).length + ' (storage ' + AoE2.MUTE_PATH + '=' +
        AoE2.storageGet(AoE2.MUTE_PATH) + ')'];
    });
  });
});

uiCheck('ui: the header carries a mute button beside Save', () => {
  const saveAt = html.indexOf('<button id="save" class="save" type="button">Save</button>');
  const muteAt = html.indexOf('<button id="mute" class="mute" type="button">Sound on</button>');
  const endAt = html.indexOf('</header>');
  return [saveAt >= 0 && muteAt > saveAt && muteAt < endAt && styleCss.indexOf('header .mute{') >= 0,
    'save@' + saveAt + ' mute@' + muteAt + ' </header>@' + endAt +
    ' cssRule=' + (styleCss.indexOf('header .mute{') >= 0)];
});

uiCheck('ui: the mute button toggles both stores and the label', () => {
  return bootFixture(null, (doc, Game) => {
    Game.dom.mute.fire('click');
    const on = Game.dom.mute.getAttribute('aria-pressed') + '/' + Game.dom.mute.textContent +
      '/' + AoE2.storageGet(AoE2.MUTE_PATH);
    Game.dom.mute.fire('click');
    const off = Game.dom.mute.getAttribute('aria-pressed') + '/' + Game.dom.mute.textContent +
      '/' + AoE2.storageGet(AoE2.MUTE_PATH);
    return [on === 'true/Sound off/1' && off === 'false/Sound on/0',
      'afterFirstClick=' + on + ' afterSecondClick=' + off];
  });
});

uiCheck('ui: booting on a muted slot opens muted and an empty slot opens unmuted', () => {
  const seeded = (extra) => bootFixture(null, (doc, Game) =>
    Game.dom.mute.getAttribute('aria-pressed') + '/' + Game.dom.mute.textContent + '/' +
    AoE2.storageGet(AoE2.MUTE_PATH), extra);
  const muted = seeded({ [AoE2.MUTE_PATH]: '1' });
  const open = seeded(null);
  return [muted === 'true/Sound off/1' && open === 'false/Sound on/null',
    'mutedSlot=' + muted + ' emptySlot=' + open];
});

soundCheck('sound: the booted muted game plays nothing for any row', () => {
  return withAudio((Ctor) => {
    const r = bootFixture(null, (doc, Game) => {
      const nodesMuted = voicesOf(Ctor).length;
      const muted = Object.keys(AoE2.SFX).map((n) => AoE2.playSfx(Game, n));
      Game.dom.mute.fire('click');                              // unmute through the header
      const unmuted = Object.keys(AoE2.SFX).map((n) => AoE2.playSfx(Game, n));
      return [JSON.stringify(muted), JSON.stringify(unmuted),
        nodesMuted + '/' + voicesOf(Ctor).length + '/' + Ctor.instances.length];
    }, { [AoE2.MUTE_PATH]: '1' });
    return [r[0] === '[false,false,false,false,false,false]' &&
      r[1] === '[true,true,true,true,true,true]' && r[2] === '0/6/1',
      'whileMuted=' + r[0] + ' afterUnmute=' + r[1] +
      ' nodes(muted/after/contexts)=' + r[2]];
  });
});

soundCheck('sound: the hit and arrow rows fire from exactly the functions they name', () => {
  const sites = callSites();
  return [sites.join(' ') === SFX_CALL_SITES.join(' '),
    'sites=' + (sites.join(' ') || 'none') + ' expected=' + SFX_CALL_SITES.join(' ')];
});

soundCheck("sound: a melee swing plays the hit row's note, once per frame", () => {
  return withAudio((Ctor) => {
    const g = AoE2.createState();                        // seeded squad: one militia per side
    const mine = g.units.find((u) => u.team === 0 && u.kind === 'militia');
    const foe = g.units.find((u) => u.team === 1 && u.kind === 'militia');
    const row = AoE2.SFX.hit;
    const want = { type: row.wave, freq: row.freq, dur: row.dur, gain: row.gain };
    g.frame = 4;
    const hitFoe = AoE2.hitUnit(g, foe, 1);              // my swing
    const hitMine = AoE2.hitUnit(g, mine, 1);            // his answer, same frame
    const v = voicesOf(Ctor);
    return [hitFoe === false && hitMine === false && v.length === 1 &&
      JSON.stringify(v[0]) === JSON.stringify(want),
      'swings=2 in frame=' + g.frame + ' bothSurvived=' + (hitFoe === false && hitMine === false) +
      ' voices=' + JSON.stringify(v)];
  });
});

soundCheck("sound: an arrow leaving plays the arrow row's note", () => {
  return withAudio((Ctor) => {
    const g = AoE2.createState();
    const tc = g.buildings.find((b) => b.team === 0 && b.kind === 'town_center');
    const archer = AoE2.makeUnit(g, 'archer', 0, tc.x + 200, tc.y);
    const foe = g.units.find((u) => u.team === 1 && u.kind === 'militia');
    const row = AoE2.SFX.arrow;
    const want = { type: row.wave, freq: row.freq, dur: row.dur, gain: row.gain };
    g.frame = 1;
    AoE2.spawnArrow(g, archer, foe);                      // a unit's shot
    AoE2.spawnArrow(g, tc, foe);                          // the town center's, same frame
    const oneFrame = voicesOf(Ctor);
    g.frame = 2;
    AoE2.spawnArrow(g, archer, foe);
    const twoFrames = voicesOf(Ctor);
    return [oneFrame.length === 1 && JSON.stringify(oneFrame[0]) === JSON.stringify(want) &&
      twoFrames.length === 2 && JSON.stringify(twoFrames[1]) === JSON.stringify(want) &&
      g.projectiles.length === 3,
      'sameFrame=' + JSON.stringify(oneFrame) + ' nextFrameVoices=' + twoFrames.length +
      ' arrows=' + g.projectiles.length];
  });
});

soundCheck("sound: every row's firing function holds its call and no others do", () => {
  const sites = callSites();
  const owners = Array.from(new Set(sites.map((s) => s.split(':')[0]))).sort().join(',');
  const named = Array.from(new Set(Object.keys(AoE2.SFX).map((n) => AoE2.SFX[n].fire))).sort().join(',');
  return [sites.join(' ') === SFX_CALL_SITES.join(' ') && owners === named,
    'sites=' + (sites.join(' ') || 'none') + ' owners=' + owners + ' namedByRows=' + named];
});

soundCheck("sound: a finished building plays the build row's note once", () => {
  return withAudio((Ctor) => {
    const row = AoE2.SFX.build;
    const want = { type: row.wave, freq: row.freq, dur: row.dur, gain: row.gain };
    const g = AoE2.createState();
    g.units = [];                                        // nobody on the board but the builders
    /* a house at `built` progress with its own builder standing on the site, so
       one stepSim call completes it (the branch updateUnit's build order takes) */
    const siteUp = (ty, built) => {
      const b = siteAt(g, 'house', ty);
      b.built = built;
      b.hp = Math.max(1, Math.round(b.maxHp * built));
      const spot = AoE2.workPos(g, b, null);
      AoE2.makeUnit(g, 'villager', 0, spot.x, spot.y).order = { kind: 'build', b: b.id };
      return b;
    };
    g.frame = 1;
    const bA = siteUp(40, 1 - 1e-6);                   // one step of work short of done
    const bB = siteUp(44, 1 - 1e-6);
    AoE2.stepSim(g, DT);                                 // one step: both houses complete
    const first = voicesOf(Ctor);
    const other = AoE2.createState();                    // cancel and demolish make no sound
    const cancelled = (other.frame = 1, AoE2.cancelConstruction(other, siteAt(other, 'house', 40)));
    const demolished = (other.frame = 2, AoE2.demolish(other, builtAt(other, 'house', 44)));
    const quiet = voicesOf(Ctor);
    return [bA.built === 1 && bB.built === 1 && first.length === 1 &&
      JSON.stringify(first[0]) === JSON.stringify(want) && cancelled === true &&
      demolished === true && quiet.length === 1,
      'built=' + bA.built + '/' + bB.built + ' voices=' + JSON.stringify(first) +
      ' cancelled=' + cancelled + ' demolished=' + demolished +
      ' voicesAfterCancelAndDemolish=' + quiet.length];
  });
});

soundCheck("sound: reaching the next age plays the age row's note, a refusal does not", () => {
  return withAudio((Ctor) => {
    const g = fundedGame();                          // every cost payable, Feudal reached
    const row = AoE2.SFX.age;
    const want = { type: row.wave, freq: row.freq, dur: row.dur, gain: row.gain };
    g.frame = 1;
    AoE2.upgradeAge(g);
    const paid = voicesOf(Ctor);
    const stuck = AoE2.createState();
    stuck.age[0] = AoE2.AGES.length - 1;           // Castle: nothing to research or pay
    stuck.frame = 1;
    AoE2.upgradeAge(stuck);
    const refused = voicesOf(Ctor);
    return [paid.length === 1 && JSON.stringify(paid[0]) === JSON.stringify(want) &&
      stuck.age[0] === AoE2.AGES.length - 1 && stuck.toastMsg === 'Castle Age reached' &&
      refused.length === 1,
      'upgrade=' + JSON.stringify(paid) + ' refusal toast=' + JSON.stringify(stuck.toastMsg) +
      ' voicesAfterRefusal=' + refused.length];
  });
});

soundCheck('sound: the result plays its own chord once', () => {
  return withAudio((Ctor) => {
    const g = AoE2.createState();
    const foe = g.buildings.find((b) => b.team === 1 && b.kind === 'town_center');
    const won = { type: AoE2.SFX.victory.wave, freq: AoE2.SFX.victory.freq,
      dur: AoE2.SFX.victory.dur, gain: AoE2.SFX.victory.gain };
    const lost = { type: AoE2.SFX.defeat.wave, freq: AoE2.SFX.defeat.freq,
      dur: AoE2.SFX.defeat.dur, gain: AoE2.SFX.defeat.gain };
    g.frame = 1;
    AoE2.removeBuilding(g, foe);                         // the shared raze door (§3)
    const first = voicesOf(Ctor);
    const again = (g.frame = 2, AoE2.demolish(g, builtAt(g, 'house', 46)));
    const afterSecond = voicesOf(Ctor);                  // setResult's guard: one chord per game
    const other = AoE2.createState();
    other.frame = 1;
    AoE2.removeBuilding(other, other.buildings.find((b) => b.team === 0 && b.kind === 'town_center'));
    const all = voicesOf(Ctor);
    return [g.result === 'victory' && first.length === 1 &&
      JSON.stringify(first[0]) === JSON.stringify(won) && afterSecond.length === 1 &&
      other.result === 'defeat' && all.length === 2 && JSON.stringify(all[1]) === JSON.stringify(lost),
      'result=' + g.result + ' voices=' + JSON.stringify(first) +
      ' secondSetResult=' + afterSecond.length + ' otherResult=' + other.result +
      ' allVoices=' + all.length];
  });
});

report();
