# Roadmap

Ordered by what would make the biggest difference to the game existing as a *game*. Each
item says how we'd know it's done, because "polish" without an exit condition is how
prototypes stall.

## P0 — make it actually playable by someone else

1. **Real-browser smoke test.** No browser here means "playable" is currently proven by a
   stub DOM + a headless render, not by a human clicking. Run the page in
   `browser_navigate`/Playwright, screenshot the live site and compare against
   `preview.png`. *Done when:* a live-site screenshot is attached and matches the sim state.
2. **A\* pathfinding around water.** Movement is straight-line + walkability today, so
   units stall on coastlines and stack against each other. *Done when:* a test paths a
   villager around a water inlet and the route length is within ~15% of optimal.
3. **Ranged combat + a second unit line (archer).** Melee-only combat makes fights static
   and there is no ranged counter-play. *Done when:* arrows register at range with a
   projectile, and militia-vs-archer matchups resolve per the stat table.

## P1 — content depth

4. **Tech tree / blacksmith upgrades.** Attack/defence/speed upgrades per age; the
   `ageBonus` hook already exists as a multiplier.
5. **More buildings**: lumber camp, mining camp, market, watch tower — the camp pattern
   (work-radius + drop-off) is already modelled by farms.
6. **Wall building + gated choke points.** 1×1 segment placement, decay, pathing through gaps.
7. **Win/lose conditions.** Currently there is no game-over; add "destroy the enemy Town
   Center" and a victory overlay.

## P2 — presentation and reach

8. **Sprites instead of discs** — one sprite atlas, keep the single-file rule by embedding
   it as a data URL or shipping one small PNG beside `index.html`.
9. **Save/load** via `localStorage` — `Game` is already a plain object, so `JSON`
   serialisation is nearly free; needs version-stamping.
10. **Sound** — tiny embedded blips for attack/build/age-up.
11. **Touch controls** for phones (tap-select, long-press command), plus a responsive layout.
12. **Replay / seeded challenge** — the `mulberry32` seed is already a shareable handle on a map.

## Process items (not features)

- **Split the harness checks by domain.** Today it's 63 checks in one file; group them into
  `economy / build / combat / input / ui` sections so a failure names its area instantly.
- **Pin the toolchain**: a `package.json` with `devDependencies` (`@napi-rs/canvas`) and an
  `npm test` script would make CI possible without touching the game's dependency-free rule.
- **Automate verification on push**: a Pages deploy action that runs
  `node tools/headless-check.js` before publishing, so a red suite can't ship.
- **Decide the repo's home**: currently `barf-bot/aoe2-mini`. Transfer to Barf's own account
  and set up a username Pages site (`dogx.dev`) if this stops being a throwaway.
