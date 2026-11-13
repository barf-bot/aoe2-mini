'use strict';
/* sound -- WebAudio synth for the SFX table, mute preference. */

/* Sound: one entry point, one SFX row per call (the SFX table in src/config.js is the
   contract). Three silences, all of them silent and none of them thrown: a
   name the table does not know, a platform with no AudioContext (node: the
   harness and render-preview.js, or a browser that blocked audio), and a muted
   game. Then the per-frame gate — a name may fire once per Game.frame, so a
   twenty-unit brawl makes one thud instead of twenty. Mute itself is the header
   button plus MUTE_PATH, never Game state: sound is presentation, not
   simulation, so it stays out of encodeState and out of the save slot. */
function isMuted(Game) {
  if (Game.dom && Game.dom.mute) return Game.dom.mute.getAttribute('aria-pressed') === 'true';
  return storageGet(MUTE_PATH) === '1';
}

/* Two mute writers, one setter: applyMuteButton stamps only the button, so boot
   can honour a saved preference without writing the key back; setMuted is the
   click path — stamp the button and persist it (sound state never enters Game,
   see isMuted). The button is addressed by id/attribute because that is what
   both the DOM and the harness stub really store. */
function applyMuteButton(Game, on) {
  if (!Game.dom || !Game.dom.mute) return;
  Game.dom.mute.setAttribute('aria-pressed', on ? 'true' : 'false');
  Game.dom.mute.textContent = on ? 'Sound off' : 'Sound on';
}

function setMuted(Game, on) {
  applyMuteButton(Game, on);
  storageSet(MUTE_PATH, on ? '1' : '0');
}

function playSfx(Game, name) {
  const spec = SFX[name];
  if (!spec) return false;
  try {
    if (!Game.sound) {
      const Ctor = typeof AudioContext !== 'undefined' ? AudioContext
        : (typeof window !== 'undefined' && window.webkitAudioContext) || null;
      if (!Ctor) return false;                            // node, or audio blocked
      Game.sound = { ctx: new Ctor(), at: -1, fired: [] };  // one context per game, reused
    }
    if (isMuted(Game)) return false;
    if (Game.sound.at !== Game.frame) {
      Game.sound.at = Game.frame;
      Game.sound.fired.length = 0;
    } else if (Game.sound.fired.indexOf(name) >= 0) {
      return false;
    }
    Game.sound.fired.push(name);
    const ctx = Game.sound.ctx, t0 = ctx.currentTime, dur = spec.dur;
    const osc = ctx.createOscillator(), env = ctx.createGain();
    osc.type = spec.wave;
    osc.frequency.setValueAtTime(spec.freq[0], t0);
    for (let i = 1; i < spec.freq.length; i++)
      osc.frequency.linearRampToValueAtTime(spec.freq[i], t0 + dur * (i / (spec.freq.length - 1)));
    env.gain.setValueAtTime(spec.gain, t0);
    env.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(env);
    env.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
    return true;
  } catch (e) { return false; }        // a broken context must never break the sim
}
