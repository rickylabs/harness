# Live governance — #205 plan-review disposition (round 1)

Reviewer verdict: **PASS_AFTER_NARROW_FIXES** (archived round-1 reviewer transcript, GLM 5.3
provider-default, independent read-only). Coordinator notes: the dispositions below (current binding verdict: `plan-eval.md`).
Coordinator **does not authorize S1**; a second plan round was ordered with a new primary source.

All seven findings are accepted. Four of them are superseded in effect by the structural change
recorded in `drift.md` — the affected material was removed rather than reworded — and that is noted
per row so nothing looks silently dropped. This is the **second and final** plan round.

## Reviewer findings

| # | Finding | Disposition | Where |
| --- | --- | --- | --- |
| 1 | "None deployed" overclaims a repo scan | **Accepted.** Reworded to "not identified in this repository; deployment unverified, owner answer pending" everywhere. The infeasibility argument still rests on the verb table, not on non-deployment — and the verb-table argument is now moot because the status SDK is withdrawn (drift D-2). | `research.md` §"The sidecar, precisely"; `plan.md` D9 withdrawn |
| 2 | "Genuinely live" overclaims historical evidence | **Accepted, and enforced by removal.** Codex `rate_limits` in a transcript is a vendor statement recorded at write time (`packages/telemetry/src/model.ts:62-66`); opencode `cost` is recorded per-call billing; `total_cost_usd` is SDK cost accounting. The phrase "recovered historical readings / recorded per-run spend" is now used throughout, and the transcript-derived producer that depended on it is **withdrawn** (drift D-1) rather than relabelled. | `research.md` §"Recovered historical evidence"; `drift.md` D-1 |
| 3 | Stale leaf rides a fresh badge | **Accepted.** New decision **D12** plus two test rows (L7a/L7b). A leaf older than the envelope's own declared validity span is marked stale inline and counted on its regime line; FRESH may not stand unqualified over an all-stale regime. The span is the source's own `validUntil - observedAt` — derived, not chosen. | `plan.md` D12, L7a/L7b |
| 4 | Account key collides; F2/F3 misclassified as forks | **Accepted, and strengthened.** The reviewer's suggested `source`+`limitId` key is **also insufficient**: two accounts on the same vendor plan produce the same `limitId`, and codex `session_meta` carries no account field (`main.go:135-139` of the orchid source shows the coordinator solving this by naming accounts in config, not by deriving them). F2/F3 are reclassified as **runtime configuration**, not owner forks — and both are now supplied by the authoritative source rather than by us (drift D-1/D-3). | `plan.md` §"Configuration, not forks"; forks reduced to F1, F5 |
| 5 | L15 canary mis-stated | **Accepted.** The credential must appear **exactly once, only in the `authorization` request header**; zero occurrences in the URL, body, messages, notes, projection, artifacts or process arguments. Restated as L15 and as an explicit failure-mode row. | `plan.md` D10, L15 |
| 6 | Gate coverage incomplete | **Accepted.** `check:lifecycle`, `check:links` and `check:metadata` added to S5's gate list alongside `check:graph`, `check:snapshots`, `check:docs` (root `package.json:25` runs all of them in `build`). | `plan.md` §"Verification gates" |
| 7 | Uncited cgroup assertion; provisional wire contract | **Accepted.** The cgroup claim is **removed outright**, not re-cited: it was unverified and unnecessary, since the refusal stands on "a container's number is not the target host's number". The wire contract is marked provisional and is now the *source adapter's*, pending the owner's endpoint answer. | `research.md`; `plan.md` D13 |

## Coordinator directions

| Direction | Disposition |
| --- | --- |
| Retain full #205 acceptance; no third partial display slice | **Accepted.** The plan now targets the envelope that carries all four acceptance facts at once, and states per criterion what the source must supply. |
| Remove the status-only sidecar SDK | **Accepted.** D9/D10/S3/S4 withdrawn; rationale preserved in `drift.md` D-2. |
| Do not build a historical-cost CLI as a proxy for live authority | **Accepted.** D5/D6 and the `governance` subcommand withdrawn; rationale and honest limits preserved in `drift.md` D-1. |
| No duplicate admission policy, no new outward protocol | **Accepted.** D7 hardened: telemetry consumes an envelope, it does not decide. The envelope is the already-shipped `--observations` format, not a new protocol. |
| Amend with drift/disposition, do not erase history | **Accepted.** `drift.md` records every withdrawal with its original rationale and its honest limit. |
| No new issues, no new forks unless authority genuinely depends on the owner | **Accepted.** Forks reduced from five to two (F1, F5). F2/F3 became configuration; F4 became moot. |

## Result

`research.md`, `plan.md` and `context-pack.md` are amended in place; `drift.md` records the
structural changes. No product code, contract, workflow, sibling repository, GitHub state or host was
touched by this round. Implementation remains unauthorized pending the coordinator's decision on this
second plan.
