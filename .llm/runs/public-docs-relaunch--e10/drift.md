# Drift — public-docs-relaunch--e10

Every deviation from plan or doctrine, with a disposition. Doctrine requires these be recorded,
not history-rewritten.

## D1 — Workspace test receipt narrowed per parent steer

Plan W4 names `pnpm run typecheck && pnpm run build && pnpm test` as the authoritative aggregate
receipt for the documentation head. The parent's brief for this lane narrowed that: docs-only
commits need the focused docs/link/help/local-proof gates; the full repo test suite is not
required unless an existing check demands it.

**Disposition:** accepted, and over-deliberately resolved: the full `pnpm test` **was** run anyway,
twice (once at `78d2490`-era state, once at `3c866d2` after rebuild) — all eleven packages
`fail 0`, exit 0 — so the plan's aggregate row exists with captured producer status
(`TEST_EXIT=${PIPESTATUS[0]}` = 0), not merely the narrowed gate. `pnpm run typecheck` was not
run separately; the plan's other rows and the root `build` cover the changed surfaces, and no
product code changed. Cost if wrong: none observed — no test regression surfaced at the final
head either way.

## D2 — Baseline moved under the lane (twice), status re-pinned each time

Plan says re-resolve status against the exact merge baseline; the baseline moved from `78d2490`
to `3c866d2` (BOARD.md publishes `8cf90c3`/`aaa5178` in between; #214 and #216 merged) during
drafting. Plan also says "if upstream changes land during the lane, update the inventory and
record the baseline change before revising status prose."

**Disposition:** accepted. Re-pin history and per-row deltas recorded in
[`claim-inventory.md`](claim-inventory.md#baseline-pin-and-re-pin-history). All receipts re-run
after rebuild; every preserved pasted block re-verified byte-wise at `3c866d2`. The README's
snapshot paragraph names `3c866d2` (2026-09-07) explicitly as its pin.

## D3 — Extra README section content beyond the plan's ten-item outline

The plan's outline does not enumerate an audience-route table, a repository map, or a details
toggle; the rewrite adds them as refinements of sections 6, 9 and 7 respectively.

**Disposition:** accepted as refinements within the approved section order (plan: "the
implementation may refine sentences, but it must preserve this order and evidence boundary").
The map and routes reuse facts owned elsewhere and link to owners; nothing new is claimed.

## D4 — Run-artifact relative links audited manually

`check:links` deliberately excludes `.llm/runs/` (a run's links describe what was true when the
run wrote them). The coordinator required an explicit audit of the new receipts' links.

**Disposition:** accepted. Manual audit executed and recorded in
[`worklog.md`](worklog.md): 61 unique relative links across `claim-inventory.md` and
`worklog.md`, all resolving (the seven same-directory links target run files that exist, and the
one heading anchor verified against its source heading). `check:links` remains the enforcement
for everything outside the run directory.

## D5 — Writer/transport fallback (not a plan deviation; recorded for honesty)

Canonical preference #1 (Qwen3.8Max via OpenCodeGo) became unavailable mid-lane; preference #2
via OpenCodeGo also stalled; the final pass ran on GLM5.3Flash via the opencode transport.
Evidence and authorship split are recorded in [`worklog.md`](worklog.md) §"Transport incident
record". No availability claims are made anywhere in the public docs on the strength of any
transport.

## D6 — Tutorial prerequisite count grew by one

The tutorial's "four things … not asked for a fifth" became five things (the cloned scratch
checkout) to absorb owner finding #217 honestly.

**Disposition:** accepted. It is a factual prerequisite change required by the #217 correction,
not scope growth: without the clone, `--cwd` has nothing safe to point at.

## D7 — Second re-pin at close-out: #219 implemented the #218 fix

The narrow pass had just rewritten the tutorial and README around owner issue
#218 (columns/status hide anomalies; `check`/`digest` show them — true at
`3c866d2`). The final pre-commit fetch found #219 merged on `origin/main`
(`c0f4434`): every view now banners anomalies and marks affected rows, so the
interim wording would have been false at merge time — the exact drift this
lane exists to prevent, caught by the re-pin rule instead of a reviewer.

**Disposition:** accepted. Branch fast-forwarded; wording updated to the
#219 behavior (with "run the check" retained as the action the banner itself
instructs); step-3 literals re-verified; receipts re-run at the new head;
inventory and worklog updated. The #218 sentence is history, not a claim:
the committed text states only the merged code's behavior.

## D8 — Re-pin file corrections at the final pass (M1 root cause)

The `c0f4434` re-pin was recorded in the worklog but the inventory's pin-table
edit was silently lost: the patch script asserted mid-way (on a later edit)
and aborted before its file write, so six in-memory replacements never hit
disk while the worklog claimed they had. The evaluator caught the residue
(stale `3c866d2` pin; missing row). Disposition: accepted as a process defect
of the author, not of the content — the corrections were re-applied and
verified written; the README snapshot pin was still pointing at `3c866d2`
while describing #219 behavior, now pinned to the last resolved baseline
`a4693bd`. Lesson recorded: every multi-edit patch must print its post-write
verification, which later scripts in this run do.

## D9 — Third re-pin: #222 merged during review

`origin/main` advanced to `a4693bd` (owner PR 222, #208 wrapper provenance:
dispatch now checks the instrumentation mark; a raw provider is unselectable)
while the lane was under review. Disposition: accepted — delta inspected only;
no status-row conclusion changed (the composed registry remains empty and the
`no-providers` refusal remains named); citations re-anchored; inventory and
README re-pinned to `a4693bd`.

## D10 — Transport constraint violation in an H1 validation attempt

The author's init-fixture check intended as an "offline" H1 receipt was not
offline: environment overrides did not disable the inherited GitHub
transport, the CLI attempted a real label POST against the placeholder
repository `owner/scratch` (HTTP 404, zero applied), and the exit status was
captured after a pipe. That violated the lane's no-GitHub-operations
constraint. Disposition: accepted as an author process defect — the run is
preserved as an incident record with its true characterization, never
counted as a receipt; H1 is proven instead by the coordinator's
injected-transport check (`CliOverrides.probeTransport → none`, four
asserted calls, zero GitHub contact). All forge/gh execution in this lane is
now permanently stopped; live verification remains documented-but-unexecuted
network instruction in the tutorial, with a stop-if-fails rule.

## D11 — Externally merged PR and correction follow-up

PR223 merged externally at 033da73 while the seven required content fixes were still local. A lease-protected push correctly refused to replace the changed/deleted branch. The coordinator preserved the owner’s #212 link correction and carried only the two correction commits onto c98fbeb as a follow-up branch. Owner PR224’s liveness rename and PR226’s title bounds were retained. Registry/profile/forge/projection source and four stub declarations were checked; maturity conclusions did not change, and the README/inventory pin now names c98fbeb. The prior source-only PASS at fd27035 is retained as evidence, with final integration/visual review still required.
