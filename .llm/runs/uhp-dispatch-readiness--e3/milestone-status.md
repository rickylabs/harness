# Owner report — Harness seat 3, 2026-09-12

Coordinator: Claude Opus 5 at high effort, taking over the seat paused on 2026-09-08. This is the
single document to act from. Everything in it is cited in the sibling files of this run directory.

## Act on these five

Ordered by how much they unblock, not by effort.

**1. Audit the labelled backlog, then restart divybot specifically — not the host.** The `harness`
dispatch label appears to have done nothing since roughly 2026-09-08. #288 held it for over an hour
against a documented 30-second poll, with no comment, branch, work directory or agent in
`herdr agent list`. Neither this seat nor Cockpit's can reach `orchid`.

  **Narrowed while writing this report: it is not a wholesale automation outage.** The board digest
  is alive and current — `origin/main` carries a `chore(board): publish` commit at
  2026-09-11T23:34Z, and the published `BOARD.md` reports activity through 23:32Z and already knows
  about #286 through #292. So something is reading this board and writing back on schedule while
  the dispatch poller does nothing. Look at the divybot process, not at the machine.

  **The restart is not a neutral recovery action.** Every issue labelled anywhere on the fleet since
  2026-09-08 is carrying an armed trigger that did nothing, and it will fire when the poller
  returns. Audit what is labelled *before* restarting, not after. This seat's board is clear: the
  label was removed from #288 when the work was claimed in-process, and Cockpit confirmed
  independently that no open issue here carries it.

**2. Authorize a reachable HarnessRouter CE, or accept that S11 cannot be proven.** Neither sandbox
has a container runtime — no `dockerd`, `containerd`, `runc`, `podman` or `nerdctl` binary exists in
either, and the `docker` on PATH is a client-only static binary. This is not a stopped daemon.

  S10 proceeded mock-first under your ruling and delivered. **S11 cannot**, because what it is asked
  to prove is a real round-trip. #289 was split accordingly: the session-continuation client surface
  is buildable now, the round-trip gate is not, and **a PASS derived from a mock must not close
  issue 53** (written without the `#` deliberately; see the hazard note below)
  — that would retire a working in-tree path on evidence that never contacted the thing it stands
  in for. #289 carries `flag:owner-decision`.

**3. Read the Ollama tier and month-to-date spend off the account.** One fact, and it is the only
non-Anthropic evaluator capacity available before 2026-10-04. The guard refuses Ollama solely for
`usage_unproven`: it needs a snapshot carrying `tier`, `monthlyUsedUsd` and `concurrentRequests`.

  Caveat so it is not over-sold: it reopens feature-tier and some lower cells. It does **not** reach
  the privileged tiers, because every privileged cell routes to Muse Spark first and Muse is carried
  only by `opencode_go` and OpenRouter.

**4. Fix two lines in your steering briefs.** `/home/agent/briefs/goal-shared.md:15` and
`/home/agent/briefs/supervisor-harness.md:41` both say `@rickylabs/routing` where the UHP adapter is
`@rickylabs/subagents`. Every occurrence inside the architecture documents is **correct** and must
not be touched — this is a compression error in the derived brief layer, not doctrine drift. Both
coordinator seats inherited it and neither will edit your steering documents, because silently
correcting the instructions we were given would remove your ability to see they were wrong.

**5. Optional: promote one rule into `doctrine/PRINCIPLES.md`.** *Derive the decision from the
strongest available negative, and let the specific status explain rather than decide.* Deliberately
not added by this seat; doctrine is portable and changed deliberately, and one good afternoon is not
grounds for a coordinator to write into it.

## Your four rulings, and what each produced

| Ruling | State |
|---|---|
| S10/S11 mock-first; Cockpit owns placement | S10 delivered, PR #292. S11 split; its gate still needs real infrastructure |
| One additional #272 plan evaluation authorized | Recorded as the policy override requires. **Not spent.** See capacity below |
| Hold contracts at 0.3.0 until S10 contracts ready | Held. `flag:owner-decision` cleared from #283 |
| Coordinator and default implementation are Opus 5 high | Applied, and it required a host change to be true rather than declared |

On the last one: `~/.claude/settings.json` set the model correctly and a top-level effort of `high`,
but the per-model entry for `claude-opus-5` pinned `medium` and the more specific setting wins. Every
Claude agent dispatched on this host would have launched a tier below its brief. Changed to `high`,
backed up first. **Host-global, so both peer seats inherit it.**

## S10 delivered a FAIL, and the FAIL is the deliverable

PR #292, CI green, `status:impl-eval`. Read from the specification's OpenAPI document and conformance
suite rather than the rendered chapters, on the delegate's reasoning that rendered pages return
through a summarising model and make a weak citation for a spike about not believing convenient
answers.

`model` is requestable and echoed. `provider`, `effort` and `cwd` are neither, and `cwd` is not even
requestable. So route status pins to unverified on every UHP route and all eight evaluation lanes in
`routing.v1.json` declare an effort step: **none may run over UHP.** Preventive on #286, since no
UHP transport exists yet.

**Do not merge #292 on green CI.** CI proves the suites pass and says nothing about whether the
specification was read correctly, which is the entire content of a FAIL. It needs a non-Claude
evaluator, which cannot run before 2026-10-04.

## The finding worth the day: absence outranks contradiction

`compareRouteIdentity` gives `unknown` precedence over `mismatch`. Over UHP three fields are always
absent, so **a genuinely substituted model is collapsed into "we could not tell".** A fail-closed
gate keyed on the status never fires, and looks correct while never firing.

It cost two real defects, one per repository, and neither seat could have found it alone — the
producing side sees the precedence rule and not the consumer's dependence on the status; the
consuming side sees the dependence and not the rule. Cockpit's was a **publication hole**: a run with
a contradicted model would have been published as a readable observation. Mine is worse placed —
`provider-codex/src/protocol.ts` is the file a UHP provider gets written by copying, and its
`mismatch` branch is unreachable over UHP, so the defect propagates by the most natural authoring
path available.

Both are fixed or filed as requirements. The general form is in #286.

## Capacity: the wall is 2026-10-04, not Monday

The weekly reset was never the constraint. Every `opencode_go` model sits at ~93% of a **monthly**
allowance that does not reset until **2026-10-04T10:07Z**, and the guard blocks when any window
reaches 100% with the pending request's cost folded in. Codex is 95% used with a zero credit
balance, returning 2026-09-15.

Remaining, shared across all three repositories for three weeks: Muse Spark $4.20, Grok $1.05, GLM
5.3 $1.05.

**#272 therefore has a two-branch plan rather than a date**, written onto the issue so nobody has to
ask: attempt Muse Spark at max, because the guard prices requests before spending and so cannot
half-run, and a refusal does not consume the authorized round. If it refuses, that is evidence
rather than an estimate, and the choice becomes yours between waiting for October and authorizing an
explicit one-tier-down deviation with a recorded rationale. **I will not take that deviation
silently**: deviating downward reduces the fidelity of the exact gate that exists to catch what the
first round missed.

Agreed cross-repo order for the first available window: Cockpit PR #98, then their OpenAPI client
pack, then #272. An upstream matrix amendment is filed as `rickylabs/netscript#2011` which may move
their items off the wall; it adds capacity at complex tier and does not reach #272's architecture
tier.

## One pattern, five instances, one fix shape

Everything above keeps arriving in the same form: **the fleet reports absence the way it reports
success or slowness.**

| Layer | Looks like | Is |
|---|---|---|
| Dispatch | label applied, no error | poller dead for four days |
| Route identity | `unknown` | a substituted model |
| Quota, `opencode_go` | a slow job | exhaustion, no error raised |
| Effort binding | a brief declaring `high` | a host pin running `medium` |
| Test sweep | green | three packages never looked at |

Cockpit added a second and worse tier: **absence wearing a misleading signal.** Their toolchain gate
had a binary pinned, installed, and absent from `PATH`, so it had never executed while reporting red
the whole time — and two delegates dutifully wrote "pre-existing environmental failure", accurate as
description and wrong as cause. A silence invites investigation; a confident wrong signal closes it.

The fix shape already exists in your own code, in the named fail-closed refusals of
`subscription-expense.ts`: `usage_unproven` and `subscription_tier_unresolved` say what is wrong and
stop.

## Corrections this seat made to its own claims

Recorded because a report that only lists findings is not auditable.

- Told Cockpit their wire reader had no reader for `model` and that substitution was going
  unobserved. It was covered by a different path. Severity overstated; corrected before it reached
  #286's scope.
- Asserted their sanitization fence was keyed on key names and that a leak would survive their
  mutation test. Both wrong, refuted by their runnable probe. The producer-side obligation stands on
  its own reasoning; the mechanics did not.
- Stated the three unobservable fields were absent "permanently" as settled fact. It is an
  unevaluated generator verdict. #286 now carries the provenance so an implementer inherits the
  uncertainty. Hardening a gate on an unchecked reading is reversible; deleting a reader is not.
- Reported three check scripts missing. That was a wrong guess at their filenames; all thirteen
  resolve.

## Board

`dsh-board check` reports no anomalies. Two label anomalies were cleared during the session and two
pull requests were given their milestone. Open: #291 (this receipt), #292 (S10), #284 (schema 272,
draft, awaiting the authorized round).
