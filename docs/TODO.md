# TODO — known bugs, in the order to fix them

Written 2026-11-13 from a review of the code plus reproductions in Chromium and in node.
Every item marked **verified** was reproduced; the evidence line says how. Items marked
**unverified** are read from the code only — reproduce before fixing.

How to work through this list:

- One item per commit. Read `AGENTS.md` first.
- Write the failing check first, in the matching `tools/checks/NN-topic.js`, then fix the
  code until `node tools/headless-check.js -q` is green again. The "Done when" line of each
  item says what the check must prove.
- The whole suite is green today, which means **none of these bugs has a check yet** — a
  green run does not mean an item is fixed.
- Delete an item from this file in the commit that fixes it, and add a line to
  `docs/CHANGELOG.md`.

Functions are named instead of line numbers so this file does not go stale as code moves.

---

## P0 — the game cannot be played with the mouse

---

## P1 — wrong behaviour you notice within a minute

### 7. Villagers are tiny and distorted

**Verified.** Every unit frame is drawn into a fixed box (20×20, militia 22×22)
regardless of the source frame size. The villager farm frame is 146×86 with a lot of empty
space, so the figure ends up a few pixels tall; the 28×46 idle frame is stretched wide.

- **Cause:** `tools/gen-atlas.js` writes one `dw`/`dh` per kind into `SPRITES`
  (`src/config.js`, generated). `drawUnits` in `src/render.js` centres the box on the unit.
- **Fix:** in `tools/gen-atlas.js`, use one scale per kind (for example: idle frame height
  → about 1.4 tiles) and set `dw = sw × scale`, `dh = sh × scale` for every frame of that
  kind. Add a per-frame anchor so the feet stay on the same pixel across animations, and
  draw from the anchor in `drawUnits`. Regenerate with `node tools/gen-atlas.js`; do not
  hand-edit `src/config.js`.
- **Done when:** for every frame `dw / dh` equals `sw / sh` within 2 %, and all frames of
  one kind share one scale. Look at `preview.png` before committing.

### 8. Construction looks like nothing is happening

**Verified** by screenshot: a site is a faint square with a 4 px bar, and the builder shows
his idle frame.

- **Cause:** `drawBuildings` in `src/render.js` draws only the ghost footprint while
  `built < 1`; `unitAnim` has no animation for a `build` order.
- **Fix:** draw the site clearly (scaffold outline plus a thicker bar, or the building
  sprite at alpha = `built`), and let `unitAnim` return a work animation (`chop_a/b` is
  close enough) while the builder is at the site.
- **Done when:** `unitAnim` returns a work cell for a villager with a `build` order who has
  arrived.

### 9. A foundation counts as a finished building

**Verified.** A house at 32 % raises the population cap from 5 to 10; a lumber camp at 1 %
is chosen as the wood drop-off; right-clicking a 5 %-built farm starts a harvest.

- **Cause:** `b.built` is a 0..1 fraction, but these places test it as a boolean:
  `popCap`, `findDropoff`, `resumeGather` (`src/economy.js`), the farm case in
  `orderForUnit` (`src/commands.js`), `decodeOrder` (`src/save.js`). `aiStep` and
  `nearestEnemy` (`src/ai.js`) do the same for the red Town Center.
- **Fix:** `b.built >= 1` in all of them. The two enemy-building tests in `orderForUnit` /
  `issueOrder` and the one in `autoAcquire` also use truthiness; decide deliberately
  whether an enemy foundation should be attackable (in AoE2 it is) and write it explicitly.
- **Done when:** a check for each of the three verified cases above.

### 10. The population cap does not hold

**Verified.** At 4/5, five villagers can be queued; all five spawn and the display reads
9/5. Militia and archers do not count at all (`popUsed` counts villagers only).

- **Cause:** `train` in `src/commands.js` compares `popUsed` with `popCap` and ignores the
  queue; `popUsed` in `src/economy.js` filters on `kind === 'villager'`; `aiStep` has the
  same gap for the enemy.
- **Fix:** count every living unit, and in `train` add the units already queued across the
  team's buildings. Mirror it in `commandsHtml` so the button disables correctly.
- **Done when:** queueing past the cap is refused with "Need more houses" and the starting
  militia counts (the opening display becomes 5/5).

### 11. The player's age and Blacksmith upgrades also strengthen the enemy

**Verified.** An enemy militia's attack goes from 4 to 7 when the *player* reaches Castle
Age and researches Forge.

- **Cause:** `Game.age`, `Game.ageBonus` and `Game.techs` are global; `unitAttack` and
  `unitArmor` in `src/sim.js` apply them to any unit.
- **Fix:** make them per team (`Game.age[team]`, `Game.techs[team]`) or apply them only
  when `u.team === 0` until the AI can research. This changes the save payload: bump
  `VERSION` in `data/units.json` and handle the old shape in `migrate` (`src/save.js`).
- **Done when:** the reproduction above leaves the enemy's attack at 4.

---

## P2 — smaller defects

### 12. `W` places a barricade instead of panning

**Verified.** Pressing `W` arms barricade placement and the camera does not move, while the
footer help and the comment in `index.html` say "WASD / arrows … pan".

- **Fix:** move the barricade to a free key and let `W` pan, or change both help texts.
  `tools/checks/08-input.js` pins the current wording — update it together.

### 13. The minimap cannot be dragged

**Verified.** A press on the minimap jumps the camera; dragging does nothing. The README
advertises "minimap camera drag".

- **Cause:** `attachInput` in `src/input.js` registers only `mousedown` on `#minimap`.
- **Fix:** use pointer events and keep following while the button is down.

### 14. Age up is instant, has no requirements, and goes one age too far

**Verified.** Three clicks with enough food reach Imperial Age immediately. Nothing in
`BLD` or `TECHS` needs more than Feudal, and the README says the game stops at Castle.

- **Fix:** decide the last age and make `AGES`, `upgradeAge` and the README agree.
  Optional: a research time at the Town Center, as in AoE2.

### 15. Footer content is clipped

**Verified** by screenshot at 1280×800: the third line of the info panel ("Order: build")
is cut off, and long button labels ("Barracks 175 W", "Archery Range 175 W") wrap outside
their buttons.

- **Fix:** in `src/style.css`, either raise the fixed 74 px footer or shorten the content
  (`infoHtml` in `src/hud.js`). `tools/checks/09-hud.js` pins `height:74px`.

### 16. Phone layout

**Verified** at 390×780: the header resources run off the right edge (stone, pop, age and
both buttons are unreachable) and the footer shows one clipped line.

**Unverified:** there seems to be no way to pan the camera by touch — panning is keyboard
or mouse edge-scroll, and `Game.mouse` is cleared when a finger lifts. Check on a real
phone, then add a two-finger or drag-on-empty-ground pan.

### 17. README says "fog of war", the game has none

**Verified** — there is no fog, visibility or explored-tile code in `src/`. Remove the
claim or put fog on `docs/ROADMAP.md`.

### 18. Minimap terrain may not update when a resource runs out

**Unverified.** `Game.mmBase` (the cached terrain bitmap in `drawMinimap`,
`src/render.js`) is cleared on window resize only, as far as I could see. Check whether a
depleted forest or a new game redraws it; if not, clear it in `depleteTile` and
`resetGame`.

### 19. Blurry canvas on high-DPI screens

**Unverified.** `beginCanvas` sizes the canvas in CSS pixels and never multiplies by
`devicePixelRatio`. Check on a HiDPI display; if blurry, scale the backing store and the
context.
