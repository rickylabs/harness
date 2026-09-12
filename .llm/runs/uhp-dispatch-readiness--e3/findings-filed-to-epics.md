# Two cross-seat findings, filed where they are owned

Both arrived from the Cockpit and Mobile seats on 2026-09-12 as operational observations. Both are
primary evidence for issues already open on this board, so they were filed there rather than
summarised in a report that nobody reads twice. Each was verified here before filing.

## The admission gate is at an entry point, not at a boundary — filed to #66

E5.5 asks for the gate to be wired at the sandbox boundary. This is a measured instance of the cost
of its absence.

The guard exists and works where it is invoked. In `rickylabs/netscript`,
`.llm/tools/agentic/opencode/opencode-run.ts` calls `assertWorkloadEffortAllowed` and
`preflightOpenCodeExpense` and throws on a not-allowed decision;
`.llm/tools/agentic/runtime/subscription-expense.ts` evaluates rolling, weekly and monthly windows,
prices the pending request into the projection, and fails closed with a named reason.

The `opencode` binary sits on PATH at `~/.opencode/bin/opencode`, beside that wrapper and reachable
without it. The Mobile seat ran `opencode run --model ollama-cloud/glm-5.3-flash` and got a result
with exit 0 in seconds, while the guard refuses the Ollama provider with `usage_unproven`. No flag
and no override was involved: the call never reached the code that would have refused.

**The refinement worth keeping.** The peer report framed this as "`opencode run` does not consult
the expense guard". The mechanism is one step back from that and it matters for the fix: the guard
is not missing and is not weak, it is optional, because it lives at a launcher rather than at a
boundary. A gate in one launcher is satisfied by every path through that launcher and by no other.

**And the two regimes are not symmetric**, which is what makes it urgent rather than tidy. On
`opencode_go`, exhaustion is enforced upstream by the provider, so an ungated call cannot overspend;
it hangs silently instead. On Ollama the account carries its own separately metered budget, so an
ungated call spends real money against a ceiling nothing is tracking. The gap is unenforced exactly
where enforcement would protect a budget.

Consequence for acceptance, stated on the issue: the test that proves #66 is not "the wrapper
refuses", which already passes. It is "the vendor binary invoked directly is also refused".

## Every privileged tier depends on one model's budget — filed to #181

The Cockpit seat enumerated `DELEGATION_MATRIX` against the model catalogue per cell, asking
whether the model in that cell is reachable on a non-exhausted non-Anthropic provider.

| Tier | plan_evaluation | implementation_evaluation |
|---|---|---|
| simple | — | reachable |
| straightforward | blocked | reachable |
| feature | reachable | blocked |
| complex | blocked | blocked |
| architecture | blocked | blocked |

Every blocked privileged cell is blocked for one reason: **Muse Spark 1.3 is the first choice in
every privileged-tier cell, and Muse is carried only by `opencode_go` and OpenRouter.** When
`opencode_go` is out of budget and OpenRouter cannot prove usage, all privileged-tier evaluation
stops simultaneously with nothing to fall to.

`validateDelegationMatrix()` returns clean and is right to. Every cell names a real model and
honours family distinctness. The failure is a budget property rather than a routing property, and
nothing in the matrix asserts that the models it names are affordable.

**The framing added here, and the reason it belongs in a routing issue rather than a quota one:** a
resolver that always returns a correct but unaffordable answer is indistinguishable in code from
one that works. The failure appears only at dispatch, as a refusal or as a silent hang. So passing
matrix validation is not evidence about this at all.

## Why these two are the same finding as the others from today

Both are instances of the pattern recorded in `dispatch-primitive-failure.md`: the fleet reports
absence the same way it reports success or slowness. An ungated call returns exit 0. An unaffordable
cell validates clean. A dead poller returns no error. A substituted model renders as an
unobservable field.

The counter-example is already in the codebase, in the named fail-closed refusals of
`subscription-expense.ts`. `usage_unproven` and `subscription_tier_unresolved` say what is wrong and
stop. That is the shape every one of these four wants.

[observed — guard call sites, binary location, matrix cells and ollama-cloud registry all read
 directly in rickylabs/netscript 2026-09-12, not taken on report]
[source — per-cell reachability enumeration by the Cockpit seat; ungated Ollama run measured and
 disclosed unprompted by the Mobile seat; both 2026-09-12]
