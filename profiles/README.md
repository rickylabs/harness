# profiles/

A **profile** is the working process a dispatched agent adopts before it does anything else.

Each `profiles/<name>.md` begins with validated YAML frontmatter: `name`, `title`,
`role`, optional worker `defaultTier`, `description`, `skills`, `permissions`, and
`guardrails`. The `name` equals the filename stem. `role` names a matrix worker role
or `coordinator` and must agree with the existing `routing` table row below the
frontmatter. Keep that row:
Orchid's current resolver reads it. Frontmatter has no model, effort, transport,
fallback, or budget override; the pinned matrix and dispatch resolver supply those.
The optional `defaultTier` suggests a workload tier to the app composer when a
worker brief omits one; it must be a known matrix workload tier and does not
override the route.
The permissions and guardrails describe requested policy; they do not grant a seat
new capabilities. `pnpm run check:profiles` validates configured role coverage,
populated worker defaults and dedicated coordinator routes, with field-specific
errors. The vocabulary comes from routing data rather than a second model table.

The dispatcher injects this line into every brief that names one:

> FIRST read `profiles/<name>.md` in the repo root (if present) — it defines your working
> process for this task, including any evaluation models to use.

So a profile file is not documentation *about* a process. It is the process, addressed to the
agent that just woke up holding it.

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §5–§6 for how a profile reaches an agent.

---

## The contract

Every profile states five things, in this order, near the top:

| Field | Means |
| --- | --- |
| `run-mode` | which doctrine file governs the run shape |
| `skill` | which agent skill to activate first |
| `state` | the control-plane artifact this run maintains, if any |
| `gate` | the command whose exit code is the verdict |
| `routing` | which matrix row selects the model, and what may not be overridden |

Then the phases, in order, each one saying what it produces and what proves it.

---

## Rules that hold for every profile

1. **Query the matrix; never reconstruct it.** Run the matrix CLI with `--json`. Do not derive
   a routing decision by reading source with `grep`, `sed` or `awk`.
2. **Record requested versus observed.** Every launch records the model, effort, transport,
   role, tier, session reference and branch it *asked for* and the ones it *got*. A run without
   that record is not a valid run (ARCHITECTURE.md I1).
3. **Never self-certify.** The agent that produced work never evaluates it. Evaluator and
   generator are separate sessions from different vendor families (I2).
4. **Privileged tiers need authority.** `complex` and `architecture` require a named authorizer
   and a non-empty rationale. A brief asking for one without both is refused, not downgraded
   silently — refuse and say why (I3).
5. **Blocked means a decision exists.** Do not stop without filing a decision record carrying a
   question, the options, your recommendation, and the cost of being wrong (I4, §8).
6. **A gate that cannot run is unproven.** Record it as unproven. Never assume it green, and
   never substitute a narrower command and call it the gate.

---

## Matrix-role profiles

| Profile | Primary role | For |
| --- | --- | --- |
| [`planner`](planner.md) | `plan` | prepare a scoped, evaluated plan |
| [`plan-evaluator`](plan-evaluator.md) | `plan_evaluation` | independently review a plan |
| [`leaf`](leaf.md) | `implementation` | Single agent: one change, one PR |
| [`implementation-evaluator`](implementation-evaluator.md) | `implementation_evaluation` | independently review the changed head |
| [`researcher`](researcher.md) | `deep_research` | answer a research question and file a ratified RFC |
| [`docs`](docs.md) | `documentation` | deliver a scoped documentation change |
| [`ui-ux`](ui-ux.md) | `ui_ux` | deliver owner-selected interface work |
| [`vision-evaluator`](vision-evaluator.md) | `vision_evaluation` | report independent visual findings |

Every canonical worker profile defaults to `feature`, a populated nonprivileged
workload tier. An explicit tier still follows its configured authorization policy.
Evaluators never author the evaluated work and require a separate session and a
different vendor family; a profile cannot supply missing independence evidence.
Vision findings do not replace implementation certification.

[`rfc`](rfc.md) is the compatibility alias for researcher. Keeping its file and
routing row preserves existing briefs and persisted profile references while the
researcher profile owns the process.

[`milestone-coordinator`](milestone-coordinator.md) uses the dedicated
`coordinators.milestone` configuration route. The routing row supplies its default
scope; it has no worker `defaultTier`. `milestone` is not a workload tier and
`coordinator` is not a worker role. Missing scope routes are blockers.

---

## Adding one

A new profile needs a real second user. Two runs that differ only in prose are one profile with
a parameter, not two profiles. Add it in a PR that names the run it was extracted from.

## Receipt check

`pnpm run check:receipts` exercises the receipt validator and CLI in CI with synthetic fixtures.
For explicit receipt files, use the [matrix receipt checker](../docs/reference/matrix-receipts.md).
Unknown observations return `unproven`; a passing fixture suite does not prove that divybot
records every spawn or that evidence references are authentic.
