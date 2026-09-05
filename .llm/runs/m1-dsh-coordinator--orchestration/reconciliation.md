# Reconciliation: the N5 supervisor thread's parked harness work

The programme was briefly run as two coordinating threads. That premise was wrong — the second
thread was already committed to unrelated work (netscript Wave 7) and was never running this
programme. It parked everything harness-related and filed nothing.

This run absorbs that work and becomes the single coordinator for the whole milestone. Nothing is
discarded: the parked thread reproduced Stage B independently and extracted the dsh contracts from
primary sources, and two of its findings **correct** this run rather than merely confirming it.

| Field | Value |
| --- | --- |
| Parked | 2026-09-04, by the N5 supervisor thread |
| Board impact | none — nothing filed, edited, commented, labelled, committed or pushed |
| Receipts | `receipts/n5-parked-handoff.md`, `receipts/agy-external-research.md`, `receipts/agy-research-brief.md`, `receipts/dsh-agent-team-contract.md` |

The receipts are preserved here because the originals lived on an `/ephemeral` mount and would not
survive a clean-up. `agy-external-research.md` is external model output, **unverified**, and is kept
as raw evidence rather than as a source of truth.

## 1. Corrections to this run's Stage B

Two, and both matter.

### 1.1 The local endpoints refuse, they do not time out — so the diagnosis is proof, not inference

This run recorded `000ERR` on all three local endpoints and inferred "services not listening" from
the fact that DNS resolved and the containers logged nothing. The parked thread measured the
distinction directly: **connection refused**, `time_connect=0.000000s`.

A refusal is an RST — the SYN reached the host and was actively rejected. A firewall DROP or a
routing fault produces a timeout instead. So L3 and DNS are proven good end to end, and
"nothing is listening" stops being the best available inference and becomes established.

The conclusion is unchanged. Its **standing** is not, and that is worth the correction: the earlier
version would have justified a network investigation that the sharper reading rules out entirely.

### 1.2 It is very probably not a fault at all — which rescopes `#65`

`#34` already records that the `llama-rocm` container's entrypoint is `sleep infinity`: starting the
container does not start a server, and the provider must health-check the endpoint rather than infer
readiness from container state.

That single fact predicts every observation — container up so DNS resolves, **logs empty** because
`sleep infinity` emits nothing, nothing listening because no server was ever started. LM Studio on
`:1234` is the ordinary separate case of the server toggle being off.

**Consequence:** `#65` should not be scoped as "repair a broken service". The durable fix is the
health-probe contract `#34` already calls for, plus an explicit start step in the local-model lane.
Scoping it as a repair would spend a cycle fixing something that is behaving as designed, and would
leave the actual defect — a provider that trusts container state — in place.

`#65` is in W3. This is recorded now so the rescope happens before it is dispatched, not after.

### 1.3 A new constraint: the local containers are not reachable from `ai-agents` at all

`ai-agents` has `DOCKER_HOST=tcp://netscript-dind:2375`, a dind daemon holding only `rd-relay`,
`pg-relay` and `postgres-cb583538`. `docker inspect lm-studio` returns `No such object`. The
lm-studio and llama containers live on the **NAS host daemon**, and no host socket is mounted into
`ai-agents`.

This is direct evidence for the open owner decision on `#62`. Any coordinator that has to start,
inspect or health-check a local model container **cannot do it from inside `ai-agents`** — which
removes the comfortable middle option and reduces `#62` to the two choices already on the table: an
ssh executor with host authority, or a privileged sidecar. It also means `#59` and `#60` cannot be
verified against a live backend from the container this run can reach.

## 2. `ctx.agentTeams` — the largest architectural finding, and it is a trap as well as a gift

The parked thread flagged the `agent-team` subsystem as an unretrieved gap that might overlap the
coordinator design in `#36`, and recommended retrieving it before finalising coordinator semantics.
Retrieved: the published site 404s the page because `reference.md` classes Agent Teams as an
**experimental, private opt-in coordination seam**; the source is public at
`deepseek-ai/deepseek-harness` → `docs/subsystems/agent-team.md`, preserved as
`receipts/dsh-agent-team-contract.md`.

It overlaps `#36` almost exactly:

| What we were going to design | What `ctx.agentTeams` already has |
| --- | --- |
| lanes with orchestrator identities | `TeamMemberSnapshot` — roster with `provider`, `context: fresh\|fork`, terminal phase `active\|failed` |
| the kanban board | `TeamTaskSnapshot` — `status`, `ownerId`, **`blockedBy` DAG edges**, tombstones |
| optimistic-concurrency on the control plane | `revision` as an explicit compare-and-set value, +1 per mutation |
| file-collision avoidance between leaves | **`writeScopes`** — normalised advisory path prefixes, surfaced as overlap *warnings* in views |
| `status ?` spam | **`waitForChange(caller, timeoutMs, signal)`** — bounded event-driven wait, not polling |
| a bespoke mobile read surface | `@Remote('view'\|'createTask'\|'updateTask')` — already exposed through the generated Remote API |
| steering a running leaf | durable mailbox: running ⇒ nearest step boundary, idle ⇒ start a turn, inactive ⇒ cold-resume |

**The gift:** three of these are better than what this run designed, and one solves a problem we hit
today. `writeScopes` is the direct answer to why `#40`, `#41`, `#43`, `#44` and `#45` cannot run
concurrently — the collision is expressible as data and warned about, instead of being held in a
coordinator's head. `waitForChange` is the literal mechanism for "answerable with no agent awake".

**The trap:** it is `packages/experimental/`, private opt-in, and deliberately unpublished. Building
`#36` on it would put the coordinator's control plane on a seam whose contract carries no stability
promise, and the failure mode is a silent break during a long-horizon run — exactly when the
coordinator is least able to recover.

**Recorded position, for owner ratification:** adopt the *shapes* and not the dependency. Build the
coordinator on the documented `workflow` and `subagent` seams, and model the control plane on
`TeamTaskSnapshot` — `revision` CAS, `blockedBy`, `writeScopes`, tombstones. If Agent Teams
stabilises, a control plane already shaped like it is a migration; a differently-shaped one is a
rewrite. This costs nothing now and buys the option.

`#36` and `#83`–`#88` are affected. All are in W3–W5, so none is dispatched and none needs re-filing
yet.

## 3. dsh contract extraction — confirmations

From primary docs, fetched 2026-09-04. Full detail in `receipts/n5-parked-handoff.md` §2.

- **`workflow` is the deterministic coordinator primitive.** Not a DAG engine — a script-execution
  container running JS with top-level await, with engine hooks `agent()` / `phase()` / `log()` and
  `parallel()` / `pipeline()` combinators, returning JSON. Critically, `WorkflowStartRequest` carries
  **`subagentProvider?: string`** — the execution backend is selected *by name*. That is the
  code-first deterministic orchestrator this programme is chasing, and it is already in the box.
- **`subagent` independently corroborates the two-seam split.** Named provider registry;
  capability flags validated *before* `start()` with a loud `UNSUPPORTED_CAPABILITY` rather than
  silent degradation; continuable support discovered by method presence; **remote providers return
  `localAgent: undefined`**. Feeds `#33`. It also corroborates the "no PTY needed" finding from a
  second direction — and the parked thread mapped each mechanic onto an existing netscript tool
  (`launch-codex-slice.ts` ≈ `start()`, `codex-resume.ts` ≈ `sendMessage()`, `codex-watch.ts
  --mode turn` ≈ settlement, `classify-codex-failure.ts` ≈ the stop-reason taxonomy). **Port, do not
  invent.**
- **`session-telemetry` delivery is explicitly best-effort** — records may be lost *and* duplicated;
  receivers dedupe ledger records on `(session.id, event.seq)`. This is why `#86`'s disk backfill is
  not optional. It also ships **no built-in redaction rules**: exports are exactly as clean as the
  rules a deployment mounts, which is a `#88` requirement, not a nicety.
- **`web-server` owns no TLS and no authentication**, and a non-loopback bind exposes the server
  unless the composition supplies those controls. This constrains `#79`–`#82`: reachability from a
  phone is the composition's problem, and it must be designed rather than inherited.
- **`persistence` is a swappable seam** with a documented abstract surface, so a Postgres-backed
  store is viable without forking core. Crash recovery **does not truncate** — it closes the orphaned
  turn with a synthetic `turn/end { reason: interrupted }`, and `interrupted` is the one
  `TurnEndReason` the loop never naturally emits, making it a reliable marker.
- **Cordis dispatch mode is part of an event's public contract** (`emit` / `waterfall` / `parallel` /
  `serial` / `bail`), and every registration is a `ctx.effect`, so reversibility and HMR come free.

## 4. External research — preserved, unverified, partly out of scope

`receipts/agy-external-research.md` (Gemini 3.8 Flash high, cited throughout) covers the docker fork
packaging (feeds `#47`), t3.codes multi-CLI dispatch and its agent-swarm work plus subscription-vs-API
auth (feeds `#76`), and a transport comparison across all four targets (feeds `#47` and `#76`).

Its sections 2 and 3 — the two mobile clients — are **out of scope for this repository** under
decision 4, which puts both cockpits in netscript. They were commissioned before that steer landed
and were allowed to complete rather than be re-run. They are kept, and they belong to the netscript
side; they are not evidence for any M1 leaf.

## 5. What changes, and what does not

**Unchanged:** the frozen board. 49 leaves, six waves, 29 cross-wave edges, the gate. Nothing in the
handoff contradicts a wave assignment or a dependency edge, which was the specific thing
reconciliation had to rule out before dispatch.

**Changed:**

| Change | Where | When it bites |
| --- | --- | --- |
| Stage B upgraded from inference to proof | `worklog.md` § Stage B | now |
| `#65` rescoped: health-probe contract, not service repair | this file § 1.2 | before W3 |
| `#62` has hard evidence — no host socket in `ai-agents` | this file § 1.3 | the owner decision, now |
| `#36` control plane modelled on `TeamTaskSnapshot`, without depending on it | this file § 2 | before W3 |
| `#33` ports the netscript agentic tools rather than reimplementing them | § 3 | W2 |
| `#79`–`#82` must specify auth and TLS explicitly | § 3 | W4 |

**Retracted:** the two-thread lane split published in `#30`. See `drift.md`.
