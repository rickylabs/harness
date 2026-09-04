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

### Deliberate non-application of the `harness` label

No M1 issue carries the `harness` label. In this repository that label is the live Orchid/divybot
dispatch trigger — applying it starts a real agent on the N5. Labelling here is an action, not
metadata.

## Progress Log

| Time | Slice | Step | Notes |
| --- | --- | --- | --- |
| 2026-09-04 | board | file leaves | `#40`–`#88` created and sub-issue-linked under `#31`–`#39` |
| 2026-09-04 | board | de-milestone epics | M1 = 49 leaves, epics are containers |
| 2026-09-04 | tooling | vendor gate | 4 TS files + 10 templates + `deno.json` |
| 2026-09-04 | step-0 | freeze | intake / inventory / DAG / state generated from `gh` |
| 2026-09-04 | step-0 | render | `milestone-status.md` generated |
| 2026-09-04 | step-0 | gate | `{ ok: true, errors: [], findings: [] }` |

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

## Stage B — not entered

Stage B requires **recorded** provider-quota and paid-transport check output in this file before
any dispatch. Those checks are deliberately not run yet: nothing is being dispatched, and their
output is a snapshot that would be stale by the time a lane actually starts.

When the owner authorizes dispatch, record here, in this file, before binding any lane:

- Provider quota position per account for each vendor CLI that will carry a lane, from the
  governor's own reading — claude rate-limit headers and codex rollout `token_count` — not from a
  guess about what is probably left.
- Paid-transport reachability for the OpenRouter path, since the evaluator lane depends on it and
  a transport failure there presents as "the evaluator is slow", one layer above the cause.

Allowance snapshots are operational state. They belong in this worklog as a dated observation and
must never be committed as configuration.

## Handoff Notes

- Read `supervisor.md` first: it carries the operating identity, the privileged-tier
  authorization, the doctrine pins and the three deliberate deviations.
- `milestone-cluster-state.json` is the control plane; `milestone-status.md` is its generated
  view. Never edit the view.
- The two open owner decisions — dispatch W0, and the sandboxctl execution channel (`#62`) — are
  in `reporting.ownerDecisions` and are the only things standing between a green gate and work
  starting.
- The N5 supervisor thread owns epics `#33` `#34` `#37`. Point it at `#30` for the architecture
  record rather than letting it rediscover the two-seam split.
