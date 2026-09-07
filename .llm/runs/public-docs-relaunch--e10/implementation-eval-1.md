Post-review isolation audit: one attempted label creation in this review was rejected with HTTP 404 and zero labels applied. Its intended transport isolation was ineffective. See [offline-forge-receipt.md](offline-forge-receipt.md) for this and the writer’s separate failed attempt, plus the safe replacement proof. The final review is restricted to source and receipts with shell/file mutations disabled.

Evaluator: Muse Spark 1.3, xhigh, opencode transport; independent of the Qwen/GLM authors. Conditional verdict: every blocking finding must be corrected before merge.

**Independent implementation evaluation — #209 public README/docs relaunch**

Head: `dd1df39aa95831fd1ce85814337cdf995b1d81f1`
Diff base: `c0f443482eb050c5318dc3275a92632b8907489a`
Branch: `docs/209-public-relaunch`
Verdict: **PASS AFTER NARROW FIXES** — 2 high, 2 medium, 3 low. No broad rework.

No tracked-file/GitHub mutations. Only `/tmp/eval-*`, `/tmp/empty-gh-config`. All `DSH_TELEMETRY_*` cleared for fixture runs. No credentials/`.env`/real-home/sibling/host/model/subagent/external writes. `harness` label never applied.

## What passes

Cold-reader order, human/agent split before install, diagram with explicit `E→A[Human or dispatcher chooses]→G` + read-only board + separate forge boundary, two seams distinct, provider split (claude/opencode implemented-not-composed, codex/acp stubs, llm-local 3 routes host-dependent), contracts publishable-not-released, no cockpit/Netscript-build-dep, no #148 site work, #213 5-row install/dump-config preserved, #217 `--cwd ../scratch` + clone prerequisite + review/commit there + `no automatic guard` stated, anchors/links clean.

Independent checks run (vs author receipts in `claim-inventory.md`/`worklog.md`):

* `pnpm run check:links` exit 0 — 57 files, 305 relative, 0 broken. `pnpm run check:docs` exit 0 — 6 pages match. `pnpm run build` exit 0.
* 5× `--help` exit 0. `coordinator policies` exit 0 — both policies + default + blocker guarantee.
* `dsh-app install --home /tmp/eval-install` exit 0, `check` exit 0 `installed and matching`, `--dump-config` tail 5 rows — matches tutorial structure.
* `telemetry where/record/runs/why --home /tmp/eval-tel2` exit 0. `recorded 2 event(s)` matches. `why` 9 lines match.
* `board columns` without transport exit 3. `forge labels check` without transport exit 3.

## Blocking narrow fixes

**H1 — README + tutorial false generic `exit 3`, `init` exit 0 as proof.** `README.md:228-232` says GitHub tools exit 3 without transport. `docs/tutorials/01-from-clone-to-board.md:109-114` says `init` creates labels on GitHub, `116-119` says exit 3 = no transport. Code: `packages/forge/src/cli.ts:583-604` — `init` maps unavailable apply to `EXIT.ok` with `skipped apply`; `356-392` — `doctor` returns `ok` without transport; `1606-1608` — only plan/apply/check raise `TransportError→3`. Observed: `GH_CONFIG_DIR=/tmp/empty-gh-config` no-token `init --dry-run` exit 0 `skipped apply`, `init` exit 0 writes files + skips apply. Offline newcomer gets exit 0 with zero labels on GitHub. Fix: README exception sentence; tutorial `labels check` + live readback after `init`, correct `If it fails` to scope 3 to plan/apply/check.

**H2 — #220 projection vs terminal warnings not distinguished.** `README.md:147` projection row claims smoke-not-daemon-boot only. Schema `packages/dsh-app/src/plugins/board-projection.ts:269-280,181-196,523-537` carries `phase` + `complete` but no `anomalies`/`completeness`. Terminal does: `packages/board/src/render.ts:96-105,60-67`, `cli.ts:217-239`, `digest.ts:158-173`. Phrases `README.md:76-77,101,114,265` saying `every view flags` imply projection complete. Fix: add to projection row/commitments that terminal banner/marks exist, projection limitation remains.

**M1 — Snapshot pin stale.** `README.md:130-132` pins `3c866d2 (2026-09-07)` but text describes #219 banner behavior merged at `e78935a` in `c0f4434`. `claim-inventory.md:11-17` has no `c0f4434` re-pin row despite `worklog.md` claiming update. Fix: pin to `c0f4434`, add inventory row.

**M2 — Tutorial `# fail 0` glyph wrong.** `docs/tutorials/01-from-clone-to-board.md:50-53` says `# fail 0`. Observed `pnpm --filter dsh-app test`: `ℹ pass 258`, `ℹ fail 0` — `ℹ`, not `#`. Inventory already notes reporter is `ℹ` spec lines. Fix: drop `#`.

**L1 — README prose 80-col.** `README.md:104` 84 chars. W2 requires prose ≤80 (tables/badges/mermaid exempt). Fix: wrap.

**L2 — Tutorial duplicate.** Lines `62-63` and `76` both `The tools reach GitHub through gh`. Fix: dedupe.

**L3 — Tutorial trailing-spaces note unobserved.** Lines `289-290` claim trailing spaces included. Observed `runs --home /tmp/eval-tel2 | od -c` at this head: `...opus-5 \n`, no pad. Fix: drop or re-verify with wider fixture.
