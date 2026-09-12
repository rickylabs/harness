# Verification — inherited state, and the S10/S11/S12 dispatch gate

## 1. Predecessor checkpoint reconciles exactly

| Claim inherited | Verified | Evidence |
|---|---|---|
| Head `d151277fe201faf7f6a472bf68010833bdd22aa0` on `feat/274-capability-detection` | yes | `git log -1 feat/274-capability-detection` and `origin/feat/274-capability-detection` both resolve to `d151277`; object type `commit` |
| Checkpoint file present | yes | `git show feat/274-capability-detection:.llm/runs/capability-detection--274/reset-checkpoint.md` |
| Schema 272 draft PR #284 at `df85638`, CI passed | yes | `gh pr view 284`: `headRefOid df856383e6b8c34878effa8b642b7e0f79de50cf`, `isDraft true`, check `typecheck · build · test` = `SUCCESS` |
| Published contracts 0.3.0 / protocol 1; 0.4.0 unpublished | consistent with board | #283 remains open at `status:impl-eval` with `flag:owner-decision` |

No product mutation has landed on `main` since `fe278bc` ("chore(board): publish").

## 2. The two owner decisions are still unanswered

The checkpoint's resume instruction 2 is explicit: check #272 and #283 separately, and do not
infer approval from elapsed time. Four days have elapsed; neither has an owner reply.

- **#272** — last comment `2026-09-08T20:56:02Z`, authored by the coordinator, asking the owner to
  authorize one additional bounded plan evaluation or retain the one-round cap. Policy on record is
  `maxRounds 1`, `escalateToOwnerAt 2`. The first round was consumed by the FAIL_FIX on `324a3de`.
  Nothing after it. **#272 stays blocked; no second evaluation is dispatched.**
- **#283** — last comment `2026-09-08T18:36:18Z`, an ownership correction reparenting the issue to
  #39 / `epic:e9`. No publication decision. **0.4.0 stays unpublished; no tag is pushed.**

## 3. Board is clean apart from one anomaly

`node packages/board/dist/cli.js check --repo rickylabs/harness --lane-prefix topic` exits 0 with
one anomaly: `#285: open item has no status label, so it appears in no column`. The "13
epic-milestone conflicts" reported in `~/briefs/brief-harness.md` no longer reproduce; that claim
is stale. Resolved in `worklog.md`.

## 4. Nothing is mid-dispatch

`gh issue list --label harness --state all` returns 21 issues, **all `CLOSED`**. No open issue
carries the dispatch trigger. The board is quiescent and safe to reason about.

## 5. The dispatch gate — S10, S11 and S12 are blocked on absent infrastructure

All three spikes are experiments against a **running HarnessRouter Community Edition instance**,
not desk research. From the issue bodies as filed on 2026-09-11:

- **S10** (#288): "Inspect HarnessRouter request/response telemetry."
- **S11** (#289): "Dispatch multi-turn session via UHP" on HarnessRouter CE, verifying observed
  `cwd` and branch recovery.
- **S12** (#290): "Measure whether container-scoped logs or UHP usage events can provide rate limit
  data" for sessions running inside containerized OS users.

The authority document for how that instance comes to exist is `RFC-UHP-INTEGRATION.md`, already
cited by name in the public bodies of #286–#290. It lives in the **private** `atelier-cockpit`
repository, so it is referenced here and not quoted. What it fixes, in substance: CE is a
loopback-bound container deployment of the Apache-2.0 upstream
(https://github.com/HarnessRouter/harnessrouter, retrieved 2026-09-12), publishing only
`127.0.0.1:3000` on a persistent data volume, with authentication supplied as a credential profile
named `HARNESSROUTER_API_KEY` and never embedded in a dispatch payload. #286 states the same base
URL in public: loopback `http://127.0.0.1:3000/api/harness/v1`.

Observed on this host, 2026-09-12:

| Precondition | Observed |
|---|---|
| `http://127.0.0.1:3000/api/harness/v1` reachable | no — `curl` returns HTTP `000` |
| Docker daemon | no — `/var/run/docker.sock` absent; client at `~/.local/bin/docker` cannot connect |
| Service manager to start it | no — system not booted with systemd; `sudo` not installed |
| Listening TCP sockets | none |
| `HARNESSROUTER_BASE_URL` / `HARNESSROUTER_API_KEY` in environment | neither is set |

**Conclusion: dispatching S10, S11 or S12 today spends three real runs on agents that cannot
perform their experiment.** `AGENTS.md` is unambiguous that the `harness` label is a trigger with
no draft state and no confirmation, and that tidying the board is enough to spend a run. The
dispatch is therefore held, not deferred for convenience.

This gate is not removable by a better brief. It needs a container runtime on a host, and that is
a host and placement decision, not a repository one.

## 6. A circularity in the placement fork, for the owner

The same private RFC leaves CE fleet placement open as an owner fork, choosing between a per-project
sandbox under this repository's own ADR 0002 (`doctrine/decisions/0002-sandboxctl-execution-channel.md`,
issue #62) and a dedicated fleet service needing a new network and credential ADR. Its
recommendation is explicitly withheld pending empirical evidence from Spike S11 — the public body
of #289 shows the other half of the same link, requiring S11 to "reconcile with ADR 0002 placement
caps (6 CPU / 24 GB)".

S11 cannot produce that evidence without a deployed CE, and where to deploy it is the open fork.
The two block each other. The way out is to authorize a **provisional** loopback deployment that
explicitly does not prejudge the placement fork, run S11 against it, then settle placement on the
result. That authorization is the owner's, and it is the single unblock with the largest downstream
fan-out: S10, S11, S12, then #286 (which depends on S10 and S11), then #287, then #53's conditional
closure.

## 7. Limitations

No spike was run and no evidence about UHP behaviour is claimed here. The reachability and runtime
observations above describe **this host at this time**; a CE running elsewhere on the fleet would
not have been detected by a loopback probe. The preserved `#274` planner session
(`f8cf8218-6f61-4f67-aa82-84c536ebd295`) was **not** resumed and its liveness after four days is
unverified. No claim is made that #274's `research.md` or `plan.md` now exist; per the checkpoint
they do not.
