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

---

## P2 — smaller defects

### 18. Minimap terrain may not update when a resource runs out

**Unverified.** `Game.mmBase` (the cached terrain bitmap in `drawMinimap`,
`src/render.js`) is cleared on window resize only, as far as I could see. Check whether a
depleted forest or a new game redraws it; if not, clear it in `depleteTile` and
`resetGame`.

### 19. Blurry canvas on high-DPI screens

**Unverified.** `beginCanvas` sizes the canvas in CSS pixels and never multiplies by
`devicePixelRatio`. Check on a HiDPI display; if blurry, scale the backing store and the
context.
