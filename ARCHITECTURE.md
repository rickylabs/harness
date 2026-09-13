# ARCHITECTURE

**Version 1 — locked 2026-09-13.**

This document is the charter of this repository and the contract every run in it builds on.
It supersedes the architecture recorded in [#30](https://github.com/rickylabs/harness/issues/30).

Amendments require an owner decision with a recorded rationale, filed as a numbered decision
in [`doctrine/decisions/`](doctrine/decisions/). The same bar the delegation matrix already
applies to its privileged tiers applies here: an agent may not amend this document, and may
not build against a shape this document does not describe.

---

## 1. What this repository is

**The portable agent runtime.** The routing matrix, the launchers that enforce it, the slice
loop, the profiles, and the doctrine — made to run against any repository, not one.

That charter replaces the previous one ("the `dsh` plugin layer"). The doctrine in
[`doctrine/`](doctrine/) already states the intent: *"project-neutral terms because it is
intended to ship as the portable core of the product."* This document extends that intent
from the doctrine to the runtime.

---

## 2. The thesis

Everything the product needs already exists in working form. It is split across two systems
that do not talk to each other, with matrix enforcement on exactly one transport, and no
durable record of a decision an agent needs from a human.

The work is not to build a runtime. It is to **join what runs today** and close four gaps.

---

## 3. What works today

Each of these is running, in production, and was verified by reading or executing it.

| Component | What it does | Where it lives |
| --- | --- | --- |
| **Delegation matrix** | 5 workload tiers × 8 roles, each cell `primary → fallback`. Privileged tiers fail closed without a named authorizer and a rationale. Prints JSON. | netscript `.llm/tools/agentic/runtime/` |
| **Enforcing launcher** | Asserts model, effort, privileged-tier authority and expense before spawning; writes a receipt. | netscript `opencode-run.ts` |
| **Slice loop** | `running / done / blocked / budget_exhausted / failed`, turn and wall budgets, quota backoff, teardown and leak-check. | netscript `run-codex-slice.ts` |
| **Wake primitive** | Watches a run directory; wakes on a worklog append, heartbeats on timeout. No polling. | netscript `watch-run.ts` |
| **Milestone profile** | 4 fixed lanes, exclusive issue sets, bounded WIP, read-only watchers, a renderer and a **validator that is a red gate**. Two milestones have completed through it. | netscript run dirs; templates already vendored to `.llm/harness/templates/` here |
| **Dispatcher** | Polls this repository every 30s. Spawns, steers, reads, tears down. Governs spend against live subscription headroom. Chains continuation runs. | the Orchid fork (`divybot`) |
| **Terminal control plane** | `herdr` — typed unix-socket API at protocol 22. Live steering, prompt-and-wait-for-state, blocking state wait, a self-report channel agents push to, subscriptions on status and output, a fleet snapshot, an `attention` sort field, a per-agent token map. | the agent host |
| **Durable primitives** | streams, workers, triggers, sagas, watchers — real packages, ~34k lines. | netscript `packages/` |
| **Doctrine** | Run lifecycle A–H, principles, the slice contract, the escalation protocol. Already project-neutral. | [`doctrine/`](doctrine/) |

**Live steering is not a gap.** It works today, over the terminal control plane, for every
vendor CLI — not only the one whose pane output could be scraped.

---

## 4. The layer map

```
  client (mobile / cockpit UI)
        │  reads projections · writes intents
        ▼
  cockpit  ── durable event log + effect ledger ONLY
        │      (streams · workers · triggers · sagas)
        ▼
  dispatcher  ── resolves the matrix · spawns · steers · tears down
        │
        ▼
  terminal control plane  ── panes · agent status · subscriptions
        │
        ▼
  agent in a worktree, writing a run directory
        └─ pushes its own lifecycle state back up
```

Data flows **up** by subscription, **down** by steer. Nothing in this chain polls.

---

## 5. The dispatch contract

**Every launch is an issue in this repository carrying the dispatch label.**

There is no second dispatch path. Not an RPC, not a queue, not a protocol endpoint. The
dispatcher already polls this board; an issue body is already a brief; the override grammar
is already parsed. A launch is therefore a write to GitHub and nothing else.

This is what makes the three launch modes one mechanism:

| Mode | The issue body carries | Status |
| --- | --- | --- |
| **(a) Profile** | `profile: <name>` — the profile derives model, effort, lanes and gates | works once `profiles/` exists (§6) |
| **(b) Issue → agent** | nothing; the matrix derives everything from tier and role | works today |
| **(c) Free** | explicit `model:` / `router:` / `harness:` / `timeout:` overrides | works today |

Two constraints on a dispatched body, both load-bearing:

- **No fenced code blocks.** The parser stops at a fence and runs the truncated brief without
  reporting that it did.
- **Privileged tiers are refused** without a named authorizer and a non-empty rationale, at
  the resolver, fail-closed. An override is not an authorization.

**Known gap, recorded not hidden:** `effort` is a real argument for one vendor CLI only.
Everywhere else it is injected as prose into the brief. Record requested-versus-observed in
the run's supervisor artifact; do not claim effort was applied where it was not.

---

## 6. Profiles

A profile is not new machinery. It names three things that already exist:

```
profiles/<name>.md
  run-mode   which doctrine file governs the run shape
  skill      which agent skill activates
  state      which control-plane artifact the run maintains (if any)
  gate       the command whose exit code is the verdict
  routing    which matrix row selects the model, and what may not be overridden
```

The dispatcher already reads `profiles/<name>.md` from the repository root. The knob has
been inert only because the directory did not exist. It exists now.

Three profiles ship in v1: `milestone-coordinator`, `rfc`, `leaf`. See
[`profiles/README.md`](profiles/README.md).

---

## 7. Invariants

These are not advice. Each one gets a check, and a check that cannot execute here is recorded
as **unproven** — never assumed green.

**An empty result is not a pass.** A repository with no continuous integration returns an empty
check array, and an empty array is indistinguishable from *every check ran and reported nothing*.
That shape burned this project twice in one day: a `docker ps` aimed at the wrong daemon reports
an empty list rather than an error — which is how a false sentence reached §10 and needed
[decision 0004](doctrine/decisions/0004-uhp-park-evidence.md) to remove it — and a pull request
with no workflows reports no failures.

**Before reading a verdict, establish that the check could have run at all.** Where it could not,
the invariant is `unproven` and the pull request says so. A gate recorded in a run directory by
the agent that also wrote the code satisfies the letter of I2 and not its purpose: it is the
generator's own account of its own work, which is the single thing I2 exists to refuse.

**I1 — Every spawn records a matrix resolution.**
Requested and observed model, effort, transport, role and tier land in the run receipt. A run
without that record is not a valid run. *Check: receipt schema validation in CI.*

**I2 — A generator never certifies itself.**
Generator and evaluator are separate sessions from different vendor families. No lane signs
off its own slice; the sign-off commit is the supervisor's. *Check: extend the existing
assertions from the one enforcing launcher to all of them.*

**I3 — Privileged tiers carry authority.**
`complex` and `architecture` require an explicit owner request or coordinator authorization
with a named authorizer and a non-empty rationale. *Check: already enforced, fail-closed, at
the resolver. Keep it.*

**I4 — A blocked lane carries an open decision.**
A lane in `blocked` state must reference an open decision record. An agent that stops without
filing one has lost the thing the owner was needed for. *Check: new rule in the cluster-state
validator.*

---

## 8. Escalation is a record, not a conversation

The doctrine says *stop and brief the owner*. That is correct and insufficient: a conversation
dies with the process that held it.

An escalation is a **decision record** with an identity, and it is durable:

```
{ runId, laneId, paneRef, agentSessionRef, question, options, recommendation,
  costOfBeingWrong, raisedAt, answeredAt, answer, receipt }
```

- It is **raised** by an agent reaching a blocked state, or writing a decision file in its run
  directory.
- It **lands** in the durable event log — so it survives the dispatcher restarting, the pane
  closing, and the laptop shutting.
- It is **answered** once. The answer is an effect with a receipt and a writer fence, so two
  clients cannot answer the same decision twice.
- The answer **routes back** to the exact session that raised it, by session reference.

The transport for all of this already exists. What did not exist is somewhere durable for it
to land. That is the single genuinely new component in this plan.

---

## 9. Cost

Three rows. Never one blended number.

1. **Subscription headroom** — percent remaining, live, per subscription provider.
2. **Metered spend** — real currency, for the providers that bill per call.
3. **Run tokens** — per agent, from the control plane's token map.

A blended figure would require imputing a price to a subscription turn. That number would be
invented, and an invented number in a cost dashboard is worse than three true ones.

---

## 10. What is parked

**UHP-hosted dispatch (epic E3) is parked.** Not deleted — parked, revisitable, and out of the
way.

The reason is evidence, not preference. A router instance exists and answers, and it **cannot
execute**: every backend reports every model unavailable for want of a provider credential, and
the harness list is empty, so no identifier can be pinned. The spike that would prove a live
round-trip ([#294](https://github.com/rickylabs/harness/issues/294)) has never been funded. The
client is well built. It has nothing it can connect to. Every contract shaped against it is
therefore work against an untested assumption, and the product does not need it: the dispatch
contract in §5 is proven and needs no protocol.

This paragraph once opened *"no router instance exists to talk to, on any host."* That was false
when it was written. It rested on a `docker ps` that reported an **empty daemon** because
`DOCKER_HOST` was unset — output indistinguishable from nothing running. Corrected by
[decision 0004](doctrine/decisions/0004-uhp-park-evidence.md), which the owner ratified on
2026-09-13: **the park holds**, because a router answering `401` with no executable backend does
not test the assumption the park exists to protect against. The borrowed instance was removed the
same day, so no future reader mistakes a running container for a stale park.

Parked issues carry the `parked` label. Their branches remain. If #294 is ever funded and
passes, UHP returns as **one more transport behind the same matrix** — a row in provider
precedence — never as a replacement for the steering path, because a turn-boundary protocol
cannot express mid-turn steering.

**Epic E11 is not parked. It is promoted.** "Consume the fleet matrix as data" is precisely
§7/I1 of this document, and it is now the critical path.

---

## 11. Build order

Ordered by value per unit of risk. Each step is independently useful.

1. **`profiles/`** — the knob is already wired; the directory makes mode (a) live. *Done in v1.*
2. **Matrix resolution before every spawn** — the matrix already prints JSON; the dispatcher
   shells out to it and fills the override struct it already has. No extraction needed.
3. **Control-plane subscription → durable event log.** The first genuinely new component, and
   it is small.
4. **Decision records and the inbox**, on the existing fenced-lease effect ledger.
5. **The evaluation leg** — gates are not new machinery. A gate is another delegated run with
   a different role column, a different vendor family, and a verdict in a file.
6. **One client screen against a real endpoint.** Prove the data path before building the UI.
7. **Slice budgets on the steering path**, generalized off the one vendor that has them.
8. **Cost, three rows.**

Extraction of the runtime out of netscript is **not on the critical path** and must not block
steps 1–2. The matrix already exposes a JSON CLI; callers use it where it is. Extract after
steps 1–2 are stable, and **move rather than fork** — one source of truth, or it drifts inside
a month.

---

## 12. What the client is

The client invents nothing. Every screen is a projection of something above:

| Screen | Source |
| --- | --- |
| Projects | GitHub + run directories |
| Launch (a/b/c) | one issue write, per §5 |
| Live session | control-plane read + output subscription |
| Steer | control-plane prompt |
| Lane map | milestone cluster state |
| Slice detail | run-directory artifacts |
| Decision inbox | the durable event log, per §8 |
| Cost | three rows, per §9 |

**The cockpit owns no domain truth.** It owns a durable event log and an effect ledger. Runs,
lanes, issues, agent status and cost are projections, authoritative elsewhere. A cockpit that
stores a second copy of the truth becomes a second source of it, and then neither is right.

---

## 13. How to disagree with this document

File a numbered decision in [`doctrine/decisions/`](doctrine/decisions/) with the evidence, the
recommendation, and the cost of being wrong. Do not open a pull request that quietly assumes a
different architecture: that is the failure mode this document exists to stop.
