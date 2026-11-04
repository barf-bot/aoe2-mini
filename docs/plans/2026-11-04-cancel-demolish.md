# Cancel construction + demolish

Status: planned

Phase 2 of the 2026-11-04 rules pass (`docs/ROADMAP.md`), first of its two bullets —
the uniform HUD frame ships separately after this.

## Design

**What you'll see:** clicking a half-built house puts a `Cancel · 80% back` button in the
footer; clicking it removes the site, returns 20 of its 25 spent wood to the stockpile and
frees the builder, who goes idle where he stood. A finished house instead gets a
`Demolish` button: it vanishes with zero refund and its tiles become buildable again.

**How it works:**

- `CFG.CANCEL_REFUND: 0.8` (§1 `CFG`, 101-118) — the only new tunable, per the
  "new tunables go in `CFG`" rule. The refund is 80% of the **defined cost** regardless of
  progress (the AoE2 rule): `Math.floor(cost[k] * CFG.CANCEL_REFUND)` per resource, so a
  house (25 wood) gives exactly 20 back.
- `refund(Game, team, cost)` — new §4 sibling of `spend` (1106, inside `economy helpers`):
  the single writer that credits `Game.res`, keeping the convention that the pools are only
  mutated through `spend`/`deposit`/`refund`. Exported.
- `removeBuilding(Game, b)` — new §3 helper beside `rebuildBlocks` (551): splice out of
  `Game.buildings`, `rebuildBlocks(Game)`, and clear `Game.selectedBuilding` when it points
  at `b` — today `hitBuilding` (643-653) splices without clearing, leaving a dangling
  footer selection on raze. `hitBuilding` is re-pointed at it; its toast and return value
  stay as-is (§9b's razing check keeps passing). Exported.
- `cancelConstruction(Game, b)` — §4, right after `build` (1013-1032), exported. Validates
  first: `b.team !== 0` → `Not your building`; `b.built >= 1` → `Already built — use
  demolish`. Then: refund the floored 80% cost via `refund`, set every live unit whose
  order is `build` on `b.id` back to `{ kind: 'idle' }`, `removeBuilding`, toast
  `<Label> cancelled`.
- `demolish(Game, b)` — same neighbourhood, exported. Refunds nothing. Validates: own team
  only; `b.built < 1` → `Not built yet — cancel instead`; `town_center` → `Cannot demolish
  a Town Center` (the AoE2 rule — and it keeps `popCap`/§8 tests sane); `b.queue.length` →
  `Still training` (queued costs were paid and unrecoverable, so the AoE2 busy-state
  refusal avoids silently eating them). Then `removeBuilding`, toast `<Label> demolished`.
- Footer wiring (§5 `commandsHtml`, 1491-1520 + §6/§7 delegate, 1670-1679): with a
  building selected, render `Cancel` (`data-act="cancel"`, cost hint `80% back`) when
  `built < 1` — today a selected foundation shows *no* commands — and `Demolish`
  (`data-act="demolish"`) when it is finished and not the Town Center. The delegated click
  handler dispatches both acts against `Game.selectedBuilding`; `removeBuilding`'s clearing
  collapses the footer back on the next frame. No hotkeys this round.
- **Not in this round:** the uniform HUD frame (second phase-2 bullet), demolishing
  enemy/allied buildings, refunding trained-but-queued unit costs, and the `preview.png`
  canvas (footer buttons are DOM, not canvas — no preview regen needed).

**How we check it:** new §7c section in `tools/headless-check.js` on a throwaway
`createState()` (like §9b does, so the shared `Game` that §8 trains from stays untouched):
cancel a half-built house at exactly 80% back in the stockpile, plus its builder idles and
its 4 tiles leave `Game.blocks`; demolish a finished house with all four resource numbers
byte-identical, plus the Town Center refuses. One §11 button-dispatch check joins the
existing build-button check. The full existing suite stays green (nothing weakened);
`tools/audit-line-refs.js` proves the docs followed the inevitable line shift.

## Tasks

- [x] T1: Refund constant + refund primitive (pure data/helpers)
  - files: `index.html` §1 `CFG` (101-118), §4 `economy helpers` (1076-1104, after `spend`
    1106), export block (1910-1921); `tools/headless-check.js` §5 (217-237)
  - change: add `CANCEL_REFUND: 0.8` to `CFG` (commented like its neighbours); add
    `function refund(Game, team, cost) { for (const k in cost) Game.res[team][k] +=
    cost[k]; }` as `spend`'s crediting twin; export it. No logic uses it yet.
  - done when: `CFG.CANCEL_REFUND === 0.8` and `AoE2.refund` exists in the export object.
  - test: new §5 check `economy: refund credits exactly the given cost` (snapshot a
    throwaway state's `res`, `refund(Game, 0, { wood: 20 })`, wood up exactly 20) —
    written with the code, both land in one commit; existing §5 checks untouched.

- [ ] T2: One shared removal path — `removeBuilding`
  - files: `index.html` §3 (after `rebuildBlocks` 551-567), §4 `hitBuilding` (643-653),
    export block; `tools/headless-check.js` §9b (811-813)
  - change: `removeBuilding(Game, b)` — `Game.buildings.splice` + `rebuildBlocks(Game)` +
    `if (Game.selectedBuilding === b) Game.selectedBuilding = null`; `hitBuilding` calls
    it instead of hand-splicing (fixes the raze-leaves-stale-selection dangling case);
    export it.
  - done when: razing a *selected* building clears `Game.selectedBuilding`; the existing
    `combat: a building at 0 hp is razed and removed from the world` check still passes.
  - test: that §9b check is amended in place (not duplicated) to also assert
    `ag.selectedBuilding === null` after the raze.

- [ ] T3: `cancelConstruction` — the 80% refund half of the feature's done-criteria
  - files: `index.html` §4 (after `build`, ~1032), export block; `tools/headless-check.js`
    new §7c (after §7b at 694-734)
  - change: `cancelConstruction(Game, b)` per the design: reject other teams and
    `built >= 1` (`Already built — use demolish`); `refund` `Math.floor(cost ×
    CANCEL_REFUND)` per resource; flip every live builder on `b.id` to idle;
    `removeBuilding`; toast.
  - done when: on a throwaway state, a house built for 25 wood with `built` set to 0.5
    cancels with exactly 20 wood back in the stockpile.
  - test: §7c `cancel: a half-built house refunds exactly 80% of its cost` (the roadmap's
    done-criteria check — build, snapshot res, set `built = 0.5`, cancel, wood +20) plus
    `cancel: the builder is freed to an idle order` and `cancel: a finished building
    refuses with 'Already built — use demolish'` (same throwaway state, sequential).

- [ ] T4: `demolish` — the zero-refund half of the feature's done-criteria
  - files: `index.html` §4 (after `cancelConstruction`), export block;
    `tools/headless-check.js` §7c
  - change: `demolish(Game, b)` per the design: own team; `built < 1` → `Not built yet —
    cancel instead`; `town_center` → `Cannot demolish a Town Center`; `queue.length` →
    `Still training`; else `removeBuilding` + toast, no refund.
  - done when: a finished house is deleted with zero change to food/wood/gold/stone, and
    the player Town Center refuses.
  - test: §7c `demolish: a finished house is removed with zero change to the stockpile`
    (the second done-criteria check — snapshot all four `res[0]` values around the call,
    assert byte-identical and the building gone) plus `demolish: a Town Center cannot be
    demolished` and `demolish: an unfinished building refuses with 'Not built yet — cancel
    instead'`.

- [ ] T5: Command-bar buttons + click dispatch
  - files: `index.html` §5 `commandsHtml` (1491-1520), §6/§7 click delegate (1670-1679);
    `tools/headless-check.js` §11 (900-913)
  - change: `commandsHtml` renders `Cancel` (`data-act="cancel"`, hint `80% back`) for a
    selected foundation and `Demolish` (`data-act="demolish"`) for a selected finished
    non-town_center building; the delegate adds the two acts calling
    `cancelConstruction` / `demolish` on `Game.selectedBuilding`. DOM only — `preview.png`
    and `tools/render-preview.js` output don't change.
  - done when: clicking the Demolish button on a selected finished house deletes it, and
    the footer rebuilds to the no-selection state (`selectedBuilding` cleared by T2's
    helper).
  - test: §11 check `ui: clicking the Demolish button demolishes the selected building`
    (stub `data-act="demolish"` button dispatched through the registered click listener,
    mirroring the existing build-button check).

- [ ] T6: Docs sync + full verification
  - files: `docs/GAME_RULES.md` (Construction section: refund rule, Town Center exception,
    busy-queue refusal), `docs/CHANGELOG.md` (dated entry), `docs/ROADMAP.md` (mark the
    phase-2 cancel/demolish bullet as shipped via this plan), `docs/ARCHITECTURE.md`
    (file-map rows + section-4 Contents for `refund`/`removeBuilding`/
    `cancelConstruction`/`demolish`, refreshed line spans), this plan's `Status: done`
  - change: docs-only text updates; every `index.html:NNN` ref re-pointed at the shifted
    file.
  - test: `node tools/audit-line-refs.js` passes; `node tools/headless-check.js` ends
    `NN/NN checks passed` exit 0; `node tools/render-preview.js` re-runs clean; then push
    and confirm `gh api repos/barf-bot/aoe2-mini/pages --jq .status` is `built` with
    served bytes matching `index.html` (no remote in this checkout — skip deploy check
    with a note if there is still none).
