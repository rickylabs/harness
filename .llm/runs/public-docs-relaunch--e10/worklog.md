# Worklog — public-docs-relaunch--e10

Append-only. Times are UTC where it matters; session-relative otherwise.

## Stage H, session 1 — writer online (2026-09-07)

- Writer: Qwen3.8Max provider_default through OpenCodeGo (canonical
  preference #1 for this lane). Model route confirmed in
  [`plan-eval.md`](plan-eval.md) header.
- Ingested plan gate state: PASS recorded in [`plan-eval.md`](plan-eval.md);
  F1/F2/F3 + N1/N2 dispositions in [`disposition.md`](disposition.md).
- Ingested parent steer: baseline `78d2490` (includes #213 tutorial fix —
  five profile rows); lane is docs-only W1–W4; W5 handled by parent; no
  GitHub mutations; sibling worktrees (204/205) not to be touched or awaited;
  finding #212 (pasted-output drift) governs every preserved example.

## Stage H — W1 claim worksheet

- Re-pinned package status at `78d2490`; source reads for every diagram arrow
  and status row recorded in [`claim-inventory.md`](claim-inventory.md).
- Detected (fetch, no mutation): `origin/main` advanced `78d2490` → `8cf90c3`
  with a BOARD.md-only diff. Status rows invariant against that diff; no
  re-pin taken (parent had not supplied a newer merged head at that point).
- Finding #212 plan executed: every pasted block in the tutorial scheduled
  for verify-or-remove. First validation round at `78d2490`:
  - install/dump-config/check (`/tmp/dsh-home`, isolated) — byte-exact.
  - telemetry record/why + failure lines (`/tmp/tel-home`, isolated) —
    byte-exact.
  - `runs` one-liner — drift found: two trailing pad spaces in real output.
    Scheduled for removal (prose replacement).
  - tutorial step 1 count block — stale on its own baseline (`ℹ pass` spec
    lines, not TAP `# pass`; count grows by design). Scheduled for removal.
  - tutorial step 2 `doctor` block — values host/version-dependent,
    unverifiable offline. Scheduled for removal; six field labels verified
    from `packages/forge/src/cli.ts:378-383` and moved into prose.
  - tutorial step 3 blocks — no live GitHub run possible; verified against
    source literals (`render.ts:197,205,210-215`; `project.ts:179,181,297,299`)
    and the generated exit table. Receipt records the limit honestly.

## Stage H — interruption and re-baseline (coordinator pause)

- Coordinator paused the CLI at a clean boundary; worktree fast-forwarded to
  `3c866d2b9f8784ee55c08461dfc46d1987b6d57c` (merges #214 and #216). Board
  publishes `8cf90c3`/`aaa5178` in between; no other product changes.
- Narrow re-read of changed surfaces only (no broad re-research):
  - #214: `ctx.harnessBoard` service + strict `harnessBoard` session
    projection (`board-projection.ts:18-19`), public composition smoke
    (`dsh-app/package.json:48`). Claim row 6 added to inventory with the
    not-a-daemon-boot limit stated.
  - #216: `--observations` on `dsh-telemetry tree`/`status`
    (`cli.ts:95,104-108`), typed governance parse, strict projection
    preserves it. Claim row 7 added, live-adapter block on #62 stated.
- Re-ran every receipt whose surface changed, at `3c866d2`:
  - `pnpm install --frozen-lockfile && pnpm run build` — completed through
    `check:skill`, output consistent with exit 0 (producer status later
    re-captured properly; see receipt-correction entry below).
  - install/check/dump-config fixtures — byte-exact again.
  - telemetry record/why + failure lines (exit 3 case) — byte-exact again;
    `runs` trailing-space drift persists → removal stands.
  - `pnpm --filter @rickylabs/dsh-app run smoke:board-projection` —
    "board projection smoke passed", `SMOKE_EXIT=${PIPESTATUS[0]}` = 0.
  - `pnpm test` (full) — `TEST_EXIT=${PIPESTATUS[0]}` = 0; all packages
    `fail 0` (dsh-app 258, telemetry 361).
- W1 gate satisfied: no README prose landed before the worksheet; draft
  written after, referencing the inventory.

## Stage H — README drafts and coordinator narrow pass

- README v1 written from a blank buffer per plan §"Proposed README
  architecture"; wrapped again at ≤80 columns of prose (v2) after line-length
  audit; table rows, badges, long link tokens and the evaluated Mermaid block
  left unsplit (they cannot be wrapped without breaking rendering).
- Coordinator narrow-pass findings applied:
  1. #218 (new owner issue): `dsh-board columns`/`status` do not render
     anomalies — `check` (cli.ts:237-238) and `digest`
     (digest.ts:158-164,232) do; exit meaning literally "check only"
     (cli.ts:46). Tutorial sentence overpromising ("board says so out loud")
     rewritten; README walkthrough/table/commitment reworded so no view
     promises automatic anomaly surfacing; `check` named as the step that
     makes columns trustworthy. Code half stays open on #218; nothing
     claimed shipped.
  2. Inventory link row fixed (`../../../github/…` → `../../../.github/…`);
     run-artifact relative links audited manually (check:links excludes
     `.llm/runs/` by design — `scripts/check-links.mjs`).
  3. Gemini3.8Flash high baseline-preparation findings absorbed: internal
     disclaimers moved out of the hero viewport (scope → commitments intro,
     status → baseline section), no caveat ahead of the proposition;
     diagram precedes every command; navigation glyph `·` replaced with `|`.
- Coordinator README review applied: hero rewritten around the problem the
  human/agent split solves (no longer a copy of the old front door);
  editorial meta ("Installation comes after the mental model, deliberately")
  removed; "a document that disagrees with the code fails the build" narrowed
  explicitly to the checks that actually exist (generated CLI references,
  links, generated skill), because #212/#217/#218 are standing evidence that
  pasted prose is not so checked.
- Receipt-precision correction (coordinator finding): earlier `…| tail; echo
  EXIT=$?` receipts captured tail's status, not the producer's. Re-ran with
  captured producer status: `pnpm install --frozen-lockfile` (0),
  `pnpm run build` (0), `pnpm run check:links` (0), `pnpm run check:docs`
  (0). All other receipts either used no pipe or used PIPESTATUS.

## Transport incident record (parent-requested, evidenced)

- Canonical writer Qwen3.8Max provider_default through OpenCodeGo became
  unavailable mid-lane: two same-session requests produced no response parts
  for minutes, and a separate tiny READY-only no-tools availability probe
  timed out after 90 s (exit 124, zero event/error bytes). Coordinator
  terminated the stalled writer.
- GLM5.3Flash (provider_default, canonical preference #2) was then tried
  through OpenCodeGo and also timed out on the same 90 s READY probe (zero
  response bytes), and a follow-on resume produced no response parts.
- This final pass was written by GLM5.3Flash provider_default through the
  **opencode transport**, which answered READY successfully after the Go
  transport stalled. The final text is therefore **not** Qwen-authored
  alone: Qwen authored the W1 worksheet and the first README drafts under
  review; GLM (opencode transport) applied the coordinator's narrow-pass
  findings, completed W3, validation and commit. Recorded here so no one
  later attributes the whole lane to one model or one transport.

## Stage H — W3 completion and close-out

- docs map repaired (`docs/README.md`, `docs/tutorials/README.md`): anchors
  repointed from the dead `#quickstart` to `#local-proof-first`; tutorial
  row's prerequisites updated to include the cloned scratch repo.
- Tutorial (the one existing tutorial page) repaired in place:
  - step 1: brittle count block removed; prose states the format only.
  - step 2: #217 absorbed — prerequisite is a *cloned* scratch repo; `--cwd
    ../scratch` passed to `doctor`, `init --dry-run` and `init`; generated
    files explained as belonging to the scratch checkout for review/commit
    there; the absence of any automatic origin/target guard stated in plain
    language (code half open on #217, nothing claimed shipped); `doctor`
    output block removed, six verified field names moved into prose.
  - step 3: #218 absorbed — `columns` does not surface anomalies; `check`
    (and `digest`) do; the check is required before trusting a column.
  - step 5: `runs` one-line block removed (trailing-pad drift), prose
    describes the columns; all other blocks preserved (#213 install rows
    intact and re-verified byte-exact at `3c866d2`).
  - stale `#quickstart` self-link updated.
- Concept pages repaired at the minimum surface:
  - `02-the-two-seams.md`: "What is actually built" rewritten at the real
    split (two providers implemented and uncomposed, two stubs, llm-local
    implemented with all three routes registered, destinations
    host-dependent).
  - `01-what-this-is.md`: binary/profile conflation fixed; compose row
    wording fixed.
  - `03-the-board.md`: "ten phases listed in the root README" repointed to
    the generated skill that actually lists them.
  - `05-determinism.md`: "links are next (#147)" replaced with the landed
    truth (`check:links` inside `build`) plus the honest remaining gap
    (pasted prose output, #212).
- No generated CLI page touched by hand (`check:docs` byte-compares them).
- Gates re-run at final head with captured producer status; W3 status-term
  search executed and dispositioned in the inventory. See
  [`drift.md`](drift.md) for the two deliberate deviations from plan W4
  (workspace-test receipt per parent steer; run-dir link audit method).

## Stage H — final re-pin (#219/#221 merged to main during close-out)

- Final fetch before commit: `origin/main` at `c0f4434`, containing **#219**
  (implements the #218 fix: every board view now prints an anomaly banner and
  marks affected rows; `check` names detail and exits 1; `digest` keeps its
  dedicated section) and **#221** (subagents lease release gains a
  machine-readable reason; no claim row affected).
- Per plan W1 ("if upstream changes land during the lane, update the
  inventory and record the baseline change before revising status prose"):
  branch fast-forwarded to `c0f4434`; the interim #218 wording (true at
  `3c866d2`, false at merge time) rewritten in README (walkthrough step 2,
  who-decides cell, supply paragraph, commitments bullet) and tutorial step 3
  to the #219 behavior; step-3 board literals re-verified unchanged at the
  new line numbers (`render.ts:273,281,286-289`); inventory re-pin row and
  repair row updated; drift entry D7 added.
- Gates re-run at `c0f4434` with captured producer status: `pnpm run build`
  exit 0 (BUILD_EXIT), `check:links` exit 0, `check:docs` exit 0, five
  `--help` exit 0, `policies` exit 0. Steps 4/5 fixtures unaffected by the
  range (no telemetry/dsh-app changes) — earlier byte-exact receipts stand.
