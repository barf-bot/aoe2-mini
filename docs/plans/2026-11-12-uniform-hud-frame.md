# Uniform HUD frame (round: UI)

Status: in progress

## Design

**What you'll see:** the bottom bar is one fixed height, always. Select a single unit, a
group, a building or nothing at all and the map never jumps or resizes — each of the three
panels (info | commands | queue) keeps its box and clips or scrolls its content inside it.
A group selection shows one summary line plus a `+N more` line instead of one line per
unit, and the command area becomes a fixed grid of buttons.

**How it works:** one owner for the HUD markup — a `hudHtml(Game)` in section 5 that composes
the footer from the existing pure `infoHtml` / `commandsHtml` / `queueHtml` and stamps the
footer with `data-state` (`units`, `group`, `building`, `none`), so no state renders a
different structure, only different content inside the same three boxes. The CSS replaces
`footer{min-height:74px}` with a fixed height and gives each panel a fixed height with
`overflow:hidden`, the info panel a fixed title/body/bar slot, the command panel a
row-based grid. `infoHtml`'s multi-unit branch collapses to `N units` plus a per-kind
summary on one line. No change to what the panels say, only to how they are laid out.

**Not in this round:** responsive/mobile layout and touch controls, theming, moving the HUD
above the map, new content in the panels, the result overlay's layout.

**How we check it:** `tools/headless-check.js` §11 gains per-state shape checks: the footer
markup for `units`, `group`, `building` and `none` contains exactly the same three panels in
the same order with the same classes, a group selection renders a single summary element
however many units are selected, the CSS declares one fixed footer height rather than a
`min-height`, and every existing §11 button check re-runs unmodified; `preview.png`
regenerates byte-identical for the state the fixture renders, proving the frame did not move.

**Hard constraints that survive from `AGENTS.md`:** the game stays one `index.html`; no
framework, no build step, no new image files beyond the one `assets/sprites.png` atlas;
`index.html` is patched, never rewritten; section 4 stays DOM-free; every task names a
proving check and the `Map of this file` banner stays truthful.

## Tasks

- [x] T1: one owner, one frame — `hudState`/`hudHtml`, fixed-height footer, single-write `renderHud`
  - files: `index.html` CSS footer block (`index.html:42-57`, replace), body footer markup
    (`index.html:80-84`, replace), §5 `renderHud` (`index.html:2073-2096`), new `hudState` +
    `hudHtml` inserted between `renderHud` and `resultHtml` (`index.html:2096/2101`), §5
    `infoHtml` (`index.html:2109-2132`, rewritten), §6 command-click attach (`index.html:2356`),
    §7 boot `Game.dom` block (`index.html:2540-2549`), the `AoE2` export row
    (`index.html:2626`); `tools/headless-check.js` — a new
    `/* ---- 11b. uniform HUD frame (this plan, T1) ---- */` between §11's end
    (`tools/headless-check.js:2199`) and the §12 banner (`tools/headless-check.js:2201`)
  - change: `hudState(Game)` answers the one selection word the footer is in — `group` when
    `selectedUnits(Game).length > 1`, `units` at exactly 1, `building` when only
    `Game.selectedBuilding` is set, else `none` (`Game.placing` never changes it — placement
    only swaps the info panel's content). `hudHtml(Game)` becomes the single owner of the
    footer's markup and returns, for every state, exactly
    `<div class="info" id="info">…</div><div class="commands" id="commands">…</div><div class="queue" id="queue">…</div>`
    with `infoHtml`/`commandsHtml`/`queueHtml` filling the same three boxes. `renderHud`
    replaces its three `setHTML` calls (`index.html:2089-2091`) with
    `if (d.hud) { if (d.hud.setAttribute) d.hud.setAttribute('data-state', hudState(Game)); setHTML(d.hud, hudHtml(Game)); }`.
    The body's footer becomes the empty shell `<footer id="hud" class="hud"></footer>` (the
    three static divs are deleted — `hudHtml` makes them), boot gains `hud: d.getElementById('hud')`
    and keeps wiring `commands` (the harness's click host, see next) while dropping `info` and
    `queue`; §6's attach line becomes `const cmdHost = Game.dom.commands || Game.dom.hud;`
    feeding the unchanged `if (cmdHost && cmdHost.addEventListener) …` handler — in node that
    resolves to the cached `#commands` stub the existing §11 checks fire
    (`Game.dom.commands.listeners.click`), in a browser — where the footer's children are
    rebuilt each frame — it resolves to the persistent footer, so delegation survives the
    rebuild and `buttonAt` still finds the button. Every state's `infoHtml` becomes
    `<h4>title</h4><div class="body">…</div><div class="hp"><i style="width:N%"></i></div>`
    — single unit: title `KINDS[u.kind].label`, body `HP x/y` + the order line, bar `u.hp`;
    group: title `N units`, body one `<span class="sum">` listing per-kind counts joined
    with `, ` (at most 3 kinds shown, remainder collapsed to `+K more`) — one summary element
    for any squad size; building: title `BLD[b.kind].label`, body `HP x/y` plus the existing
    `Field:`/`Upgrades:` lines, bar `b.hp`; placing: title `Placing <label>`, body `Click the
    map to place, Esc to cancel`, bar 0%; none: empty title, body keeps the existing hint
    text, bar 0%. The CSS block replaces `footer{…min-height:74px}` and the id rules with:
    `footer{flex:0 0 74px;height:74px;…}` (the one fixed height) and per-panel rules
    `.info{flex:0 0 250px;height:100%;overflow:hidden;display:grid;grid-template-rows:16px minmax(0,1fr) 6px}`
    (the fixed title/body/bar slots, `h4` 16px ellipsized, `.body` overflow-hidden, `.hp` the
    6px bar — same visuals as today's `#info` rules), `.commands{flex:1 1 auto;height:100%;
    overflow:hidden;display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));
    grid-auto-rows:26px;gap:4px;align-content:start;padding:8px}` (the fixed row-based grid),
    `.queue{flex:0 0 210px;height:100%;overflow:hidden;padding:8px;…}` keeping today's
    `#queue` visuals; `commandsHtml`, `queueHtml` and `resultHtml` are untouched. The export
    row gains `infoHtml, hudState, hudHtml` beside `commandsHtml, queueHtml, resultHtml`.
  - done when: `node tools/headless-check.js` prints `197/197 checks passed` exit 0 (194 +
    the 3 new); `node tools/render-preview.js --out /tmp/hud.png` writes a PNG whose sha256
    equals the committed `preview.png` (the tool paints only `#view`; a footer change that
    also moved pixels would differ); `assets/sprites.png` byte-identical (untouched);
    `wc -l index.html` grows by roughly 20 lines from 2637 — the exact count is restamped in
    T2, the market plan's precedent.
  - test: the 3 new §11b checks are written first and go red (`AoE2.hudHtml is not a
    function`), then green — `hud: every selection state renders the same footer structure`
    (four fixtures off `createState()` — one villager selected; three selected via
    `makeUnit`; a `makeBuilding` house selected with empty `selection`; a bare fresh state —
    each `hudHtml(st)` yields exactly `class="info"`, `class="commands"`, `class="queue"` in
    that order and its `data-state` equals `units`/`group`/`building`/`none` respectively);
    `hud: a group selection renders one summary element for any squad size` (a 3-unit and a
    12-unit `group` fixture each contain exactly one `class="sum"` element naming the counts);
    `hud: the CSS declares one fixed footer height, not a min-height` (the `footer{…}` rule in
    `<style>` contains `height:74px` and the file contains no `min-height:74px`). Every
    existing §11 check re-runs unmodified — that is the design's contract for the command
    buttons (the grid is CSS-only; the §11 string checks cover it) — as do §10/§10b/§12.
    Visual: `node tools/render-preview.js` + look at `preview.png` — expected unchanged
    (byte-identical is the proof); there is nothing new to see because the footer is DOM, not
    canvas.

- [x] T2: docs sync and the full verification pass
  - files: `docs/GAME_RULES.md` (a `## Interface` section documenting the fixed-height frame,
    the `data-state` values and the group `N units`/`+N more` summary rule, with the
    `hudHtml` line ref; the `index.html:2101` and `index.html:2449` refs at
    `docs/GAME_RULES.md:208-209` re-pointed), `docs/ARCHITECTURE.md` (file-map spans for
    §5/§6/§7 and the public surface, the `view_W/view_H index.html:2422`, `resultHtml
    index.html:2101`, `buttonAt index.html:2256`, `boot index.html:2532` refs, the §5
    render cell and the HUD prose at `docs/ARCHITECTURE.md:134-136` rewritten to name
    `hudHtml` as the single owner with the `data-state` stamp), `docs/CHANGELOG.md` (a dated
    2026-11-12 section for this plan, 194 → 197 checks), `docs/ROADMAP.md` (the Phase-2
    "Uniform HUD frame" entry marked shipped 2026-11-12 with this plan's link, like the
    cancel-demolish entry above it), `AGENTS.md` (the `` `index.html` is 2637 lines `` claim
    and the `// index.html:2630` export comment restamped to the real numbers), this plan's
    `Status: done`
  - change: docs only, one commit, no code edits — it closes the line-ref drift T1 leaves.
  - test: `node tools/audit-line-refs.js` green (section spans, cited symbols, tools
    inventory, the file-length claim), then the full `AGENTS.md` set: `node
    tools/headless-check.js` (`197/197 checks passed`, exit 0), `node tools/render-preview.js`
    + look at `preview.png`, `node tools/gen-atlas.js` (`assets/sprites.png` byte-identical),
    `node tools/check-stats.mjs` (exit 0 — the generated tables are untouched by this round).
