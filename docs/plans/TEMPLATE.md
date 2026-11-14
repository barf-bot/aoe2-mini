# Plan template

Copy this file to `docs/plans/YYYY-MM-DD-<topic>.md` and write the work as cards: one card
= one fresh session = one commit, so the file alone must start a cold session — this file's
length is the target. Full rules: `docs/plans/2026-11-14-strix-local-roadmap.md` §2;
`docs/plans/2026-11-13-tower-upgrade-chain.md` is a worked single-feature plan.

## Header

The `Status:` line sits under the title, fenced here so this template never reads as an
unfinished plan of its own:

```markdown
# <Topic>

Status: <planned|in progress|done>
```

## How to work

- Read `AGENTS.md`, then only this plan and the card in hand; never carry context over.
- `git status` clean and `npm run verify --prefix tools` green **before** any edit — a red
  tree means stop and report, never build on red.
- Open only what the card's **Read** names: `grep -n "function NAME" src/*.js`, then ~60
  lines around it; never `cat` a 400-line file.
- Write the check first and watch it fail for the right reason; patch, re-run that check
  file alone, then the full verify. A docs-only card's check *is* the verify run.
- Stale refs → `node tools/audit-line-refs.js --fix`; new prose cites `functionName`
  (`src/file.js`) with no line number (`docs/CONVENTIONS.md`).
- Update `docs/GAME_RULES.md` when a rule or number changed, drop the fixed
  `docs/TODO.md` item, add ≤ 12 lines to `docs/CHANGELOG.md`, tick the card, commit and
  push — `main` is the live site, so never push without `VERIFY OK`.

## Card

- [ ] **<id> — <one-line title>**
  - **Read:**
  - **Change:**
  - **Check:**
  - **Done when:**
  - **Size:** <S ≤ 1 h of model time | M | L — split L before starting>
  - **Needs:** <cards that must land first, or `—`>

Repeat per card; group cards under `## Phase N — <name>` headings once the plan outgrows a few.

## Hard stops — record it and stop, never work around it

- `data/*.json` numbers are vendored (`data/README.md`): copy the row, never invent or
  retune it, and list authored fields in `source.authored`. No row → stop.
- Never hand-edit the generated `src/config.js` blocks or `assets/sprites.png`; regenerate
  with `tools/check-stats.mjs --write` and `tools/gen-atlas.js`.
- Never delete or weaken an existing check to get green: a wrong-looking check is a note.
- No `Math.random()` / `Date.now()` in the logic files (use the seeded `mulberry32`/`hash2`);
  no `document` / `window` there; no top-level statement outside `src/config.js`/`src/main.js`.
- A new `src/` file needs the `<script src>` in `index.html`, a `docs/ARCHITECTURE.md` row and
  an `AGENTS.md` row; a new `tools/` file needs a mention in `AGENTS.md` **and** `README.md`;
  every function a check calls needs a slot in `src/main.js` `AoE2`.
- Three verify runs on the same error → note the card id and the error in
  `docs/plans/BLOCKED.md`, end the session.
