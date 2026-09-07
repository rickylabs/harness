# Implementation disposition — public-docs-relaunch--e10, final narrow pass

**Response to [`implementation-eval-1.md`](implementation-eval-1.md) (Muse Spark 1.3 xhigh,
`PASS AFTER NARROW FIXES`, 2 high / 2 medium / 3 low) and the visual
[`vision-eval-1.md`](vision-eval-1.md) (Gemini 3.8 Flash, PASS).** One row per finding, with the
source lines that justify the corrected text and the receipts actually executed. Review verdicts
are quoted there, not here; nothing in those files was edited except the coordinator's authorship
clarification header on the visual review.

Re-pin state for this pass: branch rebased onto `origin/main` `a4693bd` (delta inspected:
`0768ed9` = #222 subagents telemetry-guarantee-at-dispatch + BOARD.md publish; `a4693bd` =
BOARD.md publish). Docs commit re-based as `98e3ec8`; this pass commits on top.

| Finding | Disposition | Corrected text's authority (path:line) | Receipts executed |
| --- | --- | --- | --- |
| **H1** — false generic "exit 3"; `init` exits 0 without applying | Fixed in README (network bullet + matrix Host-dependent row) and tutorial (readbacks + corrected "If it fails"). README now says exit 3 belongs to the tools whose whole job is reading GitHub, and names `doctor`/`init` as the deliberate exceptions; tutorial adds the offline `git -C ../scratch status --short` readback and the live `labels check` readback, states that `init` exit 0 means only "files written", and scopes exit 3 to `labels check`/`plan`/`apply` | [`packages/forge/src/cli.ts:583-604`](../../../packages/forge/src/cli.ts) (`cmdInit`: unavailable apply → `EXIT.ok`, prints `skipped apply`); `:356-392` (`cmdDoctor` returns `EXIT.ok` without transport, `:391`); `:1606-1608` (`TransportError` → `EXIT.unavailable` = 3, only via plan/apply/check paths); `:426-440` (`cmdCheck` drift → non-zero, `:434-440`); `:416` (success line literal) | Source read at `98e3ec8` (post-rebase). H1 is proven by the coordinator's injected-transport receipt, which this disposition adopts verbatim: real CLI main with `CliOverrides.probeTransport → kind:"none"`, `--no-detect`, synthetic slug, fresh fixture — `init --dry-run` 0 (no file), `init` 0 (labels.yml + skill written in fixture only), `labels check` 3, `doctor` 0; four injected probes, Node exit 0, zero GitHub contact ([`offline-forge-receipt.md`](offline-forge-receipt.md)).

**Incident correction:** an earlier author attempt (`GH_CONFIG_DIR`/`HOME` overrides, piped `INIT_EXIT`) did **not** isolate the transport — it attempted a real label POST against `owner/scratch` (HTTP 404, zero applied) and its exit status was tail's, not the producer's. That run is preserved as an incident record, is not characterized as offline, and is not a validation receipt; it was outside the lane's no-GitHub constraint and was caught and reported by the coordinator. `git -C ../scratch status --short` → `?? .claude/`, `?? .github/` — local file review only. `gh label list` and `labels check` are documented as **unexecuted network instructions** with a stop-if-fails rule. |
| **H2** — #220 projection/terminal distinction missing; "every view" overclaims | Fixed: README walkthrough step 2, supply paragraph, who-decides cell now say *terminal* view; projection matrix row relabeled `Composed — partial` and states it carries task phase + run completeness but **not** board anomaly/completeness metadata (#220, open); commitments bullet 2 carries the same distinction. Terminal banner/marks (#219) remain the separate surface they are | Projection schema carries `phase` + `complete`, no anomalies/completeness: [`packages/dsh-app/src/plugins/board-projection.ts:269-280,181-196,523-537`](../../../packages/dsh-app/src/plugins/board-projection.ts). Terminal: [`packages/board/src/render.ts:92-115`](../../../packages/board/src/render.ts) (banner + `!` marks), [`cli.ts:217-239`](../../../packages/board/src/cli.ts), [`digest.ts:158-173`](../../../packages/board/src/digest.ts) | Source read at `98e3ec8`; no new execution needed (no behavior changed) |
| **M1** — snapshot pin stale (`3c866d2` text under #219 behavior; inventory pin row lost) | Fixed at the root cause: an earlier inventory patch script asserted mid-way and aborted before its file write, so the `c0f4434` pin row and two receipt-citation updates never landed — the worklog entry over-claimed. Pin table now carries re-pin rows for `c0f4434` **and** `a4693bd`, the closing line names `a4693bd` as the last resolved baseline, README snapshot paragraph pins `a4693bd`, and the lost citation updates were re-applied | Pin rows' authorities are the commit subjects themselves (`e78935a`, `5645a1c`, `0768ed9`); README pin is the resolved baseline statement | `git log`/`git diff` verification that `a4693bd..HEAD` touches only docs + run artifacts; all re-applied edits confirmed written (final script printed post-write) |
| **M2** — tutorial `# fail 0` glyph wrong | Fixed: prose now says the number that matters is `fail 0` (no `#`); the observed reporter prints spec-style `ℹ pass/fail` lines, so no glyph is quoted at all | `pnpm test` output receipt below; prior inventory receipts row (reporter shape) | `pnpm test` at `98e3ec8`: `packages/dsh-app test: ℹ pass 258` / `ℹ fail 0`, all packages `fail 0`, producer exit 0 |
| **L1** — README.md:104 prose 84 chars | Fixed: the over-long line re-wrapped at 80 (the two-seams sentence); full file re-audited — remaining >80 lines are badges, table rows, link tokens, and the evaluated Mermaid block, all exempt | W2 criterion (plan §W2) | `awk` line-length audit post-fix: prose ≤80 |
| **L2** — tutorial duplicate sentence | Fixed: the duplicated "The tools reach GitHub through `gh`" collapsed; step-2 opening now states the two-things fact once | — | grep: zero remaining occurrences |
| **L3** — trailing-space claim unobserved | Fixed: the claim dropped; the `runs` line description kept, without byte-level assertions | — | Evaluator's `od -c` receipt accepted (`…opus-5 \n` at this head); author's earlier two-space observation recorded as fixture-dependent, so prose no longer asserts it |

## Rolling receipts for this pass (producer status captured)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` (post-rebase) | exit 0 |
| `pnpm run build` (post-rebase, pre-fix) | exit 0 — 8 checks + compile |
| `pnpm run check:links` (final text) | exit 0 — 57 files, 0 broken (count re-verified below) |
| `pnpm run check:docs` (final text) | exit 0 — 6 pages match |
| `pnpm run typecheck` (final text) | see final table in worklog; parent's `dd1df39` run also passed |
| `pnpm test` (final text) | see final table in worklog |
| injected-transport forge check (H1, coordinator) | `init --dry-run` 0/no file · `init` 0/local files · `labels check` 3 · `doctor` 0 · 4 probes · Node 0 — [`offline-forge-receipt.md`](offline-forge-receipt.md) |
| `git -C … status --short` (H1) | `?? .claude/`, `?? .github/` — local file review, not a live readback |
| `gh label list` / `labels check` (H1) | **not executed** — classified network instructions with stop-if-fails guidance |

## Not done here, by instruction

No live `labels check`/`labels apply`/board commands against any real repository (network
class); no claim that they were run. W5 visual passed per [`vision-eval-1.md`](vision-eval-1.md);
the content re-review after this pass belongs to the parent. The Muse wrapper's post-emission
exit 143 does not invalidate the fully-emitted verdict above; the parent will require a fresh
final exact-head review regardless, and this disposition assumes it.
