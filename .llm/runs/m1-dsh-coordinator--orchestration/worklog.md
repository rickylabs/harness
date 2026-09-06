# Worklog: M1 — dsh coordinator foundation

## Run Metadata

| Field | Value |
| --- | --- |
| Run ID | `m1-dsh-coordinator--orchestration` |
| Branch | `harness/m1-dsh-coordinator--orchestration` |
| Route | milestone-cluster (`workflow/milestone-run.md` + `agent-milestone-orchestrator`) |
| Baseline | `b7d5e586e32f31ef44cab7b1327ab890f8e23794` |

## Stage A — cluster bootstrap

### What was done

1. **Board built.** 49 PR-sized leaf issues (`#40`–`#88`) filed under epics `#31`–`#39` in
   `rickylabs/harness`, each natively linked as a sub-issue, each carrying `dsh`, `task`,
   `lane:*` and `topic:*` labels, each placed in milestone `M1 — dsh coordinator foundation`.
2. **Epics removed from the milestone.** `#31`–`#39` were milestoned during creation and then
   removed, so M1 burns down on leaves only and the epics remain containers with sub-issue
   rollups. Milestone `#1` reads 49 open / 0 closed.
3. **Gate tooling vendored.** `.llm/tools/harness/{render-milestone-status,validate-milestone-cluster}.ts`
   and `.llm/tools/gates/{contract,evidence-set}.ts` copied from the netscript pin, plus the ten
   templates under `.llm/harness/templates/`. Total external dependency surface: `@std/path`.
   A `deno.json` exposes `harness:milestone:render` and `harness:milestone:validate`, so this
   repository can run its own dispatch gate with no netscript checkout on the box.
4. **Step 0 artifacts generated from the live board**, not transcribed: intake, inventory,
   dependency DAG, cluster state. The generator asserts wave membership equals milestone
   membership and that every recorded edge crosses a wave boundary, so a hand-editing mistake
   fails loudly rather than producing a plausible-looking DAG.
5. **Status rendered and the gate run green.**

### Application of the `harness` label is an action, not metadata

In this repository the `harness` label is the live Orchid/divybot dispatch trigger — applying it
starts a real agent on the N5 and binds subscription quota. It was therefore withheld from all 49
leaves through Stage A and Stage B, while the board was being frozen and gated.

It has still not been applied to any of them. All 49 leaves remain unlabelled, and the only issues
carrying it in this repository are the closed pre-programme smoke tests. Anyone adding the label to
an M1 issue is dispatching an agent, not annotating a board.

## Progress Log

| Time | Slice | Step | Notes |
| --- | --- | --- | --- |
| 2026-09-04 | board | file leaves | `#40`–`#88` created and sub-issue-linked under `#31`–`#39` |
| 2026-09-04 | board | de-milestone epics | M1 = 49 leaves, epics are containers |
| 2026-09-04 | tooling | vendor gate | 4 TS files + 10 templates + `deno.json` |
| 2026-09-04 | step-0 | freeze | intake / inventory / DAG / state generated from `gh` |
| 2026-09-04 | step-0 | render | `milestone-status.md` generated |
| 2026-09-04 | step-0 | gate | `{ ok: true, errors: [], findings: [] }` |
| 2026-09-04 | stage-b | quota + transport | hosted transport live; local inference down; codex version reading is a finding |
| 2026-09-04 | stage-c | arm W0 bodies | `/swarm` block prepended to `#40` and `#42`; label withheld, so inert |
| 2026-09-04 | stage-c | hold dispatch | lane split retracted; consolidating to a single coordinator |
| 2026-09-04 | reconcile | absorb N5 park | Stage B corrected to proof; `#65` rescoped; `#62` gains evidence; `agent-team` retrieved |
| 2026-09-04 | stage-c | bind lanes | all four lanes bound to one coordinator; `topic-orchestrators-unbound` resolved |
| 2026-09-04 | stage-c | gate | red on cadence, then `{ ok: true, errors: [], findings: [] }` |
| 2026-09-04 | stage-c | **dispatch W0** | `harness` label applied to `#40` (claude) and `#42` (codex); 47 leaves still inert |

## Decisions

| Decision | Reason | Source |
| --- | --- | --- |
| M1 contains leaves only | epics + leaves would double-count the burn-down | plan |
| Cross-wave edges only in the DAG | intra-wave ordering is the topic orchestrator's business | skill |
| `#51` and `#62` pulled forward into W1 | one contract before four implementations; one blocking decision before the wave it blocks | plan |
| Lane orchestrator ids suffixed `/unbound` | the schema wants a non-empty id; inventing a session id would satisfy it and lie | skill |
| Canary `not-planned` | this repository publishes nothing yet | `canary-cadence.md` |
| Vendor rather than import the gate tooling | the dispatch gate must run without a netscript checkout | plan |
| `environment` counts recorded as run-owned, and are zero | this run has dispatched nothing; the fleet's own containers are not this run's leaked resources | `milestone-reporting.md` |

## Gate Results

### Step 0 gates

| Gate | Command | Result | Notes |
| --- | --- | --- | --- |
| render | `deno task harness:milestone:render -- .llm/runs/m1-dsh-coordinator--orchestration` | PASS | `milestone-status.md` is generated output; hand edits fail the byte-identity check |
| dispatch gate | `deno task harness:milestone:validate -- .llm/runs/m1-dsh-coordinator--orchestration --github-prs .llm/runs/m1-dsh-coordinator--orchestration/github-prs.json` | PASS | `{ ok: true, errors: [], findings: [] }` |
| shared identity | validator `requireSharedIdentity` | PASS | all four artifacts carry the same milestone and `baselineMainSha` |
| lane ownership | validator | PASS | lane issue sets are exclusive and equal to the active frozen inventory |
| PR reconciliation | `--github-prs` export | PASS | export supplied; without it the validator always emits a `source-unavailable` finding and `ok` is false |

### Environment reading

Read from the N5 at Step 0 so the `environment` row is a measurement rather than a `null`:

```bash
ssh -p 2222 root@100.87.225.36 "nsenter -t 1 -m -u -i -n -p -- /usr/local/bin/nerdctl --namespace=rickylabs-main ps -q | wc -l"
```

The fleet namespace was carrying 14 containers and 14 networks at Step 0. None of them belong to
this run. `reporting.environment` counts **run-owned** resources — the field exists to catch
leaked Aspire apps and orphaned sandboxes — so it correctly reads zero. The fleet baseline is
recorded here so a future reader does not read that zero as "nothing is running on the box".

## Stage B — provider quota and transport checks

Recorded 2026-09-04, before any lane was bound. These are **dated observations**, not
configuration: the numbers move continuously and must never be committed as settings or read by a
later run as still-true. Credential files were checked for presence and size only; no file
contents were read, printed or stored.

### Vendor CLIs available on `ai-agents`

| CLI | Reading |
| --- | --- |
| `claude` | 2.1.260 |
| `opencode` | 1.18.27 |
| `agy` | 1.1.26 |
| `codex` | printed a stale-temp-dir permission warning instead of a version |

The `codex` reading is a **finding, not a version**. It reports a permission problem on a leftover
temp directory rather than answering `--version`. It is very likely cosmetic, but a lane bound to
codex should be watched on its first slice rather than assumed healthy, because this is exactly
the shape of failure that presents later as "the agent started and did nothing".

All four provider credential files are present with non-zero size.

### Paid transport reachability

| Endpoint | Result | Reading |
| --- | --- | --- |
| OpenRouter | `200` | reachable and authenticated — the evaluator path is live |
| `api.anthropic.com` | `401` | reachable; unauthenticated probe, so 401 is the expected answer |
| `chatgpt.com` | `403` | reachable; bot-gated, as expected from a container |

The distinction that matters: `401`/`403` are *answers*, which proves the transport works. A
transport failure on the evaluator path presents one layer above its cause — as "the evaluator is
slow" — which is why this is checked before dispatch rather than diagnosed during it.

### Local inference is down — dispatch consequence

From `ai-agents`, all three local endpoints fail to connect:

| Endpoint | Result |
| --- | --- |
| `lm-studio:1234` | `000ERR` |
| `llama-vulkan:8080` | `000ERR` |
| `llama-rocm:8081` | `000ERR` |

This is **not** a network fault. DNS from `ai-shared` resolves all three correctly
(`10.4.12.35` / `10.4.12.37` / `10.4.12.39`), and both llama containers log nothing at all.

**Corrected 2026-09-04 by independent reproduction** — see `reconciliation.md` § 1. The N5 thread
measured the failure mode rather than the failure: it is **connection refused** with
`time_connect=0.000000s`, not a timeout. A refusal is an RST, so the SYN reached the host and was
actively rejected; a firewall DROP or a routing fault would time out instead. L3 and DNS are
therefore proven good end to end, and "the services are not listening" is established rather than
inferred.

**And it is very probably not a fault at all.** `#34` already records that `llama-rocm`'s entrypoint
is `sleep infinity` — starting the container does not start a server. That predicts every
observation here: container up so DNS resolves, logs empty because `sleep infinity` emits nothing,
nothing listening because no server was ever started. LM Studio on `:1234` is the ordinary separate
case of the server toggle being off. `#65` is rescoped accordingly, from "repair a broken service"
to the health-probe contract `#34` already calls for.

**A further constraint, not visible from this session:** `ai-agents` runs with
`DOCKER_HOST=tcp://netscript-dind:2375`, and `docker inspect lm-studio` there returns
`No such object`. The local model containers live on the **NAS host daemon**, and no host socket is
mounted into `ai-agents`. Nothing that has to start or health-check them can be driven from the
container this run can reach — which is direct evidence for the `#62` owner decision.

**Consequence for this milestone:** route hosted, and do not schedule local evaluators. No W0 or W1
leaf depends on local inference, so this does not block dispatch. `#59` and `#60` (the capability
probes and the local capability matrix) cannot be verified against a live backend until a start step
exists and the daemon-boundary question in `#62` is answered.

Separately: `llama-vulkan` is **Up**, against a standing operational constraint that it stay
stopped. Recorded here as an observation for the owner; not acted on, because stopping containers on
the box is outside this run's authority — and, per the constraint above, not even possible from it.


## Stage C — Wave 0 dispatched

`#40` (claude, `internals`) and `#42` (codex, `docs`) carry the `harness` label as of
2026-09-04. Everything else in the milestone — 47 leaves — remains unlabelled and inert.

**Fired is not the same as picked up, and these artifacts keep the two apart.** Applying the label
is this coordinator's act, and it is done. Whether divybot has claimed the issue is a separate
observable, and at the time of writing it is **not yet confirmed**: no comment on either issue, no
branch, no PR.

This repository has **no GitHub Actions workflows at all** — `gh run list` returns nothing — so no
Actions run will ever appear for a dispatch. divybot is an out-of-band poller, which means the
absence of a workflow run is not evidence of anything and is the wrong place to look. The signals
that do indicate pickup are, in order: a comment on the issue, a pushed branch, then a PR. A
dispatch that produces none of them within a reasonable window has not started, and the correct
response is to check that divybot is polling — not to re-apply the label.

### What was dispatched, and what was deliberately not

Both bodies carry a `/swarm` block prepended before the label was applied: `harness:` selects the
provider, `timeout: 180m` bounds the run. In this repository the **label is the trigger and the body
is only configuration**, so the bodies sat armed and inert until the moment the label landed. That
ordering was chosen on purpose — it makes arming reviewable as a separate act from firing.

`#41`, `#43`, `#44` and `#45` are W0 leaves that were **not** dispatched. All four edit files that
`#40` creates, and `#43` owns the root `README` / `AGENTS.md` / `CLAUDE.md` — the highest-collision
surface in the repository. They are held until `#40`'s PR is up, at which point the collision is
against a known tree instead of an imagined one.

This is the concrete case for the `writeScopes` finding in `reconciliation.md` § 2: the reason those
four cannot run concurrently is a fact about paths, and it is currently held only in this paragraph
and in a coordinator's head rather than as data the control plane can check.

### Authorization

Dispatching W0 was an open owner decision (`start-wave-0`) and it has been removed from
`reporting.ownerDecisions`. The provenance, recorded explicitly because dropping an owner decision
is exactly the kind of edit that must never rest on an unsourced assertion:

- *"once the epic and sub issues are created enable orchestrator profile mode using the updated
  harness and AGENTIC toolchain we just merged"* — the instruction that defines this run.
- *"proceed"*, then *"proceed with any work pending"*.
- *"become the only coordinator of the milestone and 100% adhere to the harness profile"* — which
  also removed the second thread as a precondition.

The stated precondition for resuming — reconciling the parked thread's findings — is met in
`reconciliation.md`, whose § 5 records the specific thing that had to be ruled out: nothing in the
handoff contradicts a wave assignment or a dependency edge. The dispatch gate is green with no
errors and no findings.

### Two traps a later reader must not walk into

**A closed leaf is not a finished leaf.** `timeout: 180m` teardown closes the inbox issue, and here
the inbox issue *is* the milestone leaf. If `#40` or `#42` closes **without an open PR against
`main`**, that is a fired timeout, not completion — reopen it and re-dispatch. Treating it as done
would silently drop a committed leaf from the board while the status file still counted it.

**Re-running the generator now would reset the live control plane.** `build-cluster.ts` regenerates
`milestone-cluster-state.json` from the frozen inventory, which would discard lane bindings, the
resolved blocker, the dropped owner decision and the dispatch record — while agents are running
against the board it describes. From here the generator is only safe to re-run if its output is
reconciled against live state, not written over it. Renderer and validator remain safe at any time;
they read.

### Leaves stay empty until PRs exist

`state.leaves[]` records nothing for this dispatch. The schema requires a positive `prNumber` and a
non-empty `headSha` per entry, so a leaf becomes recordable when its agent opens a PR — not when its
agent starts. Dispatch is visible in the lane matrix (`internals` and `docs` are `active` with
`activeItems` `[40]` and `[42]`); completion will be visible in `leaves[]`. The two are deliberately
different surfaces and should not be conflated when reading the status file.

## Stage C — model binding corrected

W0 finished. Both leaves produced pull requests, and getting there exposed a defect in the dispatch
path that matters more than either leaf: **the milestone's routing matrix was not binding on
anything that actually launched.**

### What W0 produced

| Leaf | Lane | Agent | PR | Head |
| --- | --- | --- | --- | --- |
| `#42` | docs | codex (`gpt-5.6-sol`, `high`) | **#90** | `800b05cb3887f1edb3e4b13cea90b261b14b814f` |
| `#40` | internals | claude (`claude-fable-5-1`, then `claude-opus-5`) | **#91** | `6f348ba17cf761176633e9f7859c40670c6cfd18` |

`#42` finished first and cleanly. `#40` finished slowly, and the difference between them is the
whole finding.

### The evidence chain

Tracing why `#40` crawled while `#42` did not, on primary evidence at each step:

1. divybot logged `issue #40: goal inject failed: goal did not register after retries`, then
   `spawned` — in the same second. The inject succeeded on a later retry; the agent did get its
   goal.
2. The session transcript at `/home/agent/.claude/projects/-ephemeral-orch-work-issue-40/*.jsonl`
   shows 80 assistant turns, every one of them on `claude-fable-5-1`, interleaved with
   `rate_limit_error` and `rate limit. Please try again later.`.
3. Fable 5 is rate-limited until midnight. So the failed injects and the slow progress are one fact
   observed twice.
4. `#40`'s `/swarm` block declares `harness: claude` and `timeout: 180m` — **no `model:` key**.
5. `orchid:/data/divybot.json` binds `targets[]` as label → repo → **agent**, and carries no model
   or effort field anywhere in the file.
6. Therefore the model resolved to the host default in `/home/agent/.claude/settings.json`:
   `"model": "claude-fable-5-1"`.

`#42` was immune for exactly the symmetrical reason: `~/.codex/config.toml` pins
`model = "gpt-5.6-sol"` with `model_reasoning_effort = "high"`, which is on-matrix for
`complex_implementation`. The codex lane was bound by accident of configuration; the claude lane
was not bound at all.

### Why this is the finding and not a footnote

The matrix is a *routing* document, and routing that is expressed only as a default is not routing —
it is a coincidence that holds until someone changes a settings file or a model runs out of quota.
Both happened here, in the same run. Every `harness: claude` leaf in W1–W3 would have inherited the
same default. A coordinator that reported "dispatched per matrix" would have been stating a policy,
not a fact about the process it started.

This is the same class of error as `#33`/`#51`'s liveness problem: a signal that looks identical
whether or not the underlying thing is true. `RouteIdentity` (requested vs observed) exists in the
harness invariants precisely for this, and W0 is the argument for implementing it early rather than
treating it as bookkeeping — the observed model was recoverable here only by reading a transcript
off the host.

### Fallback applied

Per the owner's instruction and the matrix's own token-limit fallback column, with the substitutions
recorded in `supervisor.md` § Routes in force:

- Host default `claude-fable-5-1` → `claude-opus-5`, Opus effort `xhigh` → `medium`
  (snapshot: `~/.claude/backups/settings.json.backup.1788552925`).
- `#40`'s live session switched in place to `claude-opus-5` + `medium` — it was already `done`, so
  tearing it down would have discarded PR #91 to fix a binding with no remaining turns to affect.
- **Two** rows in this milestone resolve to a Fable primary, both on PR #90, and both were
  resolved by calling the ruleset rather than reading its table: its review
  (`review_codex_complex`, paired to the Sol·high implementation) falls back to Opus 5 · medium,
  and its IMPL-EVAL (`formal_impl_evaluation`, `evaluatesFamily: openai`) falls back to
  `z-ai/glm-5.3-flash` · max over OpenRouter. PR #91 is Codex family end to end and needs no
  substitution at all. Both lapse at midnight. Every other Fable row in the policy —
  `deep_analysis`, `docs_polish`, `formal_plan_evaluation`, `review_codex` — is a row this
  milestone never reaches, and listing them as "blocked" would be inventing exposure.
- Every `/swarm` block emitted from here carries explicit `model:` and `effort:` rows. The
  closing half of this bullet originally read "so this needs no dispatcher change"; dispatching
  the reviews disproved it. `#36`'s grammar accepts both keys and the dispatcher ignores both —
  it binds `harness:` and nothing else. The rows are a record of intent, and the model and effort
  a session actually launches with must be read back from the session, not from the brief. See
  Stage D and `drift.md`.

### Correction to the Stage C dispatch record

Two conclusions recorded during dispatch were wrong and are corrected in `drift.md`: `#40` was not
goalless and did not "produce nothing", and the agents are children of `herdr server` under the
`maint` tmux session rather than of bare `sshd: node@notty`. The second correction is the useful
one — `herdr agent list` reports per-agent `working`/`done`/`blocked` directly, which is the
liveness probe `#33`/`#51` should be built on, and is what settled the first correction.

### Gate state

`leaves[]` now carries both W0 entries, `github-prs.json` carries PRs #90, #91 (`leaf`) and #89
(`coordinator-artifact`). `evaluatorAgentId` is deliberately omitted on both leaves: the validator
only enforces generator ≠ evaluator when both ids are non-empty, and recording a placeholder
evaluator would assert a review that has not happened. It is filled when the review lanes are
dispatched.

## Stage D — W0 reviews dispatched, and what the dispatch proved

Both W0 pull requests now have an opposite-family reviewer running. The routes were resolved by
calling the ruleset, not by reading its table; the launched sessions were then read back to check
what actually bound.

| Issue | Reviews | Lane | Route the ruleset resolved | Session | Observed at launch |
| --- | --- | --- | --- | --- | --- |
| `#92` | PR #91 | `review_claude` | Codex · `gpt-5.6-sol` · `xhigh` | `n5-agents/codex-92` | `gpt-5.6-sol` · **`high`** |
| `#93` | PR #90 | `review_codex_complex` | Fable 5 · medium, quota-blocked → Opus 5 · medium | `n5-agents/claude-93` | `claude-opus-5` · `medium` |

`#93` is on route. `#92` is one effort tier under it, and the reason is not a mistake in the brief —
the brief declared `xhigh`. It is that `/swarm`'s `model:` and `effort:` keys are not bindings.
`drift.md` carries the evidence; the short form is that `divybot.json`'s `harness` target defaults to
`agent: claude` and `#92` spawned **codex**, which proves the block is parsed, while the declared
`xhigh` lost to `~/.codex/config.toml`'s `high`, which proves only `harness:` is honoured. `#93`'s
match is inheritance too — `claude-opus-5` · `medium` are the host defaults changed earlier today —
so it confirms nothing about binding and should not be read as confirmation.

The practical consequence for this milestone: the previous commit's remediation for `#40` documents
intent and does not route, and until the dispatcher binds these keys, **every launch must be read
back from the session rather than trusted from the brief**. That read-back is now part of dispatch
and is what produced the table above.

`#92` is not being torn down over the tier. The invariants that make a review load-bearing hold —
opposite family, generator ≠ evaluator, no self-certification — a relaunch would inherit the same
default, and raising the global Codex pin to `xhigh` to win one tier would silently re-route every
future Codex implementer on the host. It is recorded as a deviation in `supervisor.md` instead.

### Leaf state

Both leaves move `gating` → `evaluating` and carry their observed evaluator ids
(`divybot/n5-agents/codex-92`, `divybot/n5-agents/claude-93`). Each lane holds exactly one
evaluating leaf, inside the `activeEvaluatorsPerLane: 1` limit. The ids are the sessions that exist,
not the sessions that were requested — which is the same distinction the table above turns on.

### Not yet dispatched

The two `formal_impl_evaluation` gates are deliberately held until the ordinary reviews return.
PR #90's IMPL-EVAL is the relay row (`z-ai/glm-5.3-flash` · max over OpenRouter, reached with
`fallbackReason: 'native_quota_limit'`), and it carries two standing conditions worth restating
before it launches: its brief carries the diff under review and nothing else — no run artifacts, no
`.llm/` evidence, no credentials — and a GLM verdict over OpenRouter is citable as "tools +
streaming, no reasoning trace", never as reasoning evidence for a gate.

## Handoff Notes

- Read `supervisor.md` first: it carries the operating identity, the privileged-tier
  authorization, the doctrine pins and the three deliberate deviations.
- `milestone-cluster-state.json` is the control plane; `milestone-status.md` is its generated
  view. Never edit the view.
- **W0 is dispatched.** `#40` and `#42` are labelled and running; see Stage C for the two traps
  that come with that (a timeout teardown closes a leaf, and re-running `build-cluster.ts` would
  reset the live control plane).
- Two owner decisions remain open in `reporting.ownerDecisions`: the sandboxctl execution channel
  (`#62`, now carrying hard evidence — see `reconciliation.md` § 1.3) and the canary shape for a
  greenfield repo. Neither blocks W0; `#62` blocks `#62`–`#67`.
- **This run has one coordinator for the whole milestone.** The two-thread lane split published in
  `#30` is retracted — see the drift entry. No epic in M1 is owned by another thread, and no scope
  is being held open for one. `#30` still carries the superseded split in a comment; treat this
  file and the drift log as the current record until that comment is corrected on the board.

## 2026-09-06 — seat 3 continuation

Read both owner briefs in order, doctrine and board-process skill. Confirmed the live board
check exits 1 with 13 milestone conflicts. PR 190 remains at implementation evaluation,
head faebcda72b2418456e9365825020f459356b3b28, with successful CI. Retrieved issue 30 and
its amendments: four ratified decisions; Atelier products own separate repositories.
Draft bounded repair/continuation plan in seat-3-plan.md. Routing correction is recorded in
drift.md; no stale-route review will certify a gate. No board or product change yet.

Current routing authority pinned at netscript 8ba53bc50ca02aab29e99ba5362728839b8f1713;
rendered straightforward matrix with its official CLI. Plan evaluator: Opus 5 medium via native
claude-opus-5. Implementation evaluator: GLM 5.3 Flash provider-default via OpenCode Go.
Draft durable-loop-plan.md records source evidence, six slices, crash/reconnect gates and
production-only owner forks. Prior autocorner repository retrieval returned not found.

## 2026-09-06 — continuation gates and delivery

- Opus 5 medium plan review initially FAIL_FIX; all dispositions recorded, second evaluation PASS.
- Corrected exactly 13 child milestone memberships: 134 → 147 total live members, 12 closed and
  one open added; labels/states unchanged. Live board check returned 0 with no anomalies.
- GLM 5.3 Flash implementation evaluation of PR 190 returned FAIL_FIX for two private-repository
  claims inside scope. Corrected CONTRIBUTING.md and provider-claude README in 585ea00, then
  independent re-evaluation PASS and CI passed in 43 seconds. Squash merged PR 190; issue 189
  and PR 190 moved to shipped with readback. No workflow files changed.
- gh pr edit tried to read org/project fields outside repo token scope; used REST issue labels
  with exact-one-status readback instead. A commit initially refused for missing git identity;
  configured this checkout with the authenticated user's public GitHub noreply identity.
- Durable-loop draft posted on issues 36 and 39 and tracked as issue 191, status plan. It names
  six slices, crash and reconnect gates, and production-only owner forks. No runtime activated.
- Issue 192 owns sibling-block correctness, with Opus plan evaluation PASS after making empty
  siblings explicit. Sol medium implements the bounded slice; remaining 182 findings stay open.
