# PR 317 implementation evaluation — attempted, not launched

Coordinator receipt. 2026-09-14. Head `d414422b24f7fc3076bb204c04157a307f993b6b`. Filed as issue
321. Posted on pull request 317. Label unchanged at `status:impl-eval`. No verdict exists.

## The premise I was given, and what survived checking it

A coordinating peer reported that codex returning to service unblocks this gate, and named astra on
codex as the evaluator seat, on the grounds that codex transport gives independence on transport as
well as on identity.

**Codex is live.** Verified directly rather than taken on report: `codex exec` returned in roughly
three seconds. The transport failure that hard-blocked this lane earlier in the week is over. That
part held.

**Astra is not an implementation-evaluation candidate at any tier.** It is the *implementation*
candidate at feature, complex and architecture. Seating astra as the evaluator puts the generator's
own model in the evaluator chair, which inverts I2 rather than satisfying it. The transport-level
independence would have been bought by giving up the identity-level independence that I2 actually
requires. Instruction not followed; the matrix is the routing authority and it was told so.

## What the matrix selects

From `deno task agentic:routing-state`, live tool, not a retained file:

    architecture/implementation_evaluation[0]: family=xai   logical=grok_4_6        effort=xhigh
    architecture/implementation_evaluation[1]: family=meta  logical=muse_spark_1_3  effort=max

Tier is measured, not chosen: this run's retained `matrix-plan-eval.json` on the PR head records
tier `architecture` for the sibling evaluation role. Family opposition holds against the generator
in both cells (xai and meta against the implementation family).

## Why neither can run

`CurrentOpenRouterModelId` is the complete set of ids the gateway launcher accepts. Four members:
`qwen/qwen3.8-flash`, `z-ai/glm-5.3-flash`, `z-ai/glm-5.2`, `x-ai/grok-4.5`.

The matrix needs `openrouter/x-ai/grok-4.6` and `openrouter/meta/muse-spark-1.3`. Grok 4.5 is
configured; 4.6 is not. No Muse Spark id is configured.

Attempted rather than inferred:

    --model x-ai/grok-4.6 --effort xhigh      →  "--model must name a configured OpenRouter model"
    --model meta/muse-spark-1.3 --effort max  →  "--model must name a configured OpenRouter model"

## The finding

`resolveWorkloadRoute` returns a well-formed route with every field it owns populated. The route
cannot be executed. The only component that knows is a string comparison inside a launcher in
another repository, reached later. A caller that trusts resolution concludes the evaluation is
dispatchable.

So the failure is not that no evaluator is available. It is that the system cannot report that no
evaluator is available. Resolution and executability are different questions and only one is asked.
New row for the absent-signal catalogue: a resolved route that cannot be launched, reported as
resolved.

Second finding from the same probe: `agentic:provider-canary` runs in mode `static` and validates
preset shape, not reachability. Both codex rows report `liveEligible: false`, one with
`agenticTurn: "unsupported"` and `incompatibility: "codex-native-namespace-tool"`. So codex would
not have carried an agentic turn even if a cell had named it — an independent reason the reported
unblock does not reach this gate.

## What was launchable and was not used

`z-ai/glm-5.3-flash` is configured, live-eligible, attested at max effort. It is also
`glm_5_3_flash`, the **straightforward**-tier implementation evaluator. Against an architecture-tier
artifact that is a two-tier downgrade of a p0 merge gate, which is a deliberate weakening of an
invariant and an owner decision. Recorded in 321 as a fork with a recommendation rather than taken
in order to produce a verdict.

Recommendation in 321: configure the two ids so the matrix's own first and second choices execute,
rather than editing the routing authority to match a launcher allowlist. Cost of being wrong is two
ids that a canary would catch, against silently evaluating architecture work on a
straightforward-tier evaluator on every future p0.

## Authorization

The peer supplied a privileged-tier authorization scoped to evaluation only. It was not consumed,
because no evaluation ran. It was also not needed: `PrivilegedTierAuthorization.authorizer` admits
`owner` or `milestone_coordinator`, and this seat holds the latter. A peer message is not owner
approval and was not treated as any.

The three documentation merges of the same night ran on the owner's standing instruction under
coordinator merge authority, not under this authorization.
