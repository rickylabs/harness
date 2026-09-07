# Route identity -- E3.5 — drift

## Summary

No unauthorized mutation or scope drift occurred. Two source contradictions were incorporated into
the locked plan rather than silently copied.

## Register

| ID | Observation | Disposition |
|---|---|---|
| D-001 | Original #195 acceptance permits an operator mismatch opt-out, while latest owner steering requires unconditional mismatch refusal. | Recorded as resolved OF-1 in `plan.md`; this run interprets the unconditional later directive as superseding the older checkbox and plans no bypass. Source: https://github.com/rickylabs/harness/issues/195 |
| D-002 | Pinned successor prior art compares only provider/model/effort, labels missing evidence `pending`, normalizes a provider alias, and its opt-out permits nonmatched states. | Treated as structural prior art only. The plan adds cwd, exact comparison, `unknown`, and no bypass. Source: https://github.com/rickylabs/netscript/blob/8ba53bc50ca02aab29e99ba5362728839b8f1713/.llm/tools/agentic/runtime/launch-route-identity.ts#L59-L92 |
| D-003 | The initial pre-evaluation manifest treated the provider-codex project reference as optional and omitted the dependency lockfile and status documentation. | Corrected before independent evaluation: package convention requires both dependency and project reference, pnpm records it in the lockfile, and docs must stop claiming the package exports only `PACKAGE_NAME`. Sources: `packages/README.md:52`, `packages/provider-codex/README.md:6` |

No plan-evaluation or implementation drift has occurred yet.

## Coordinator metadata correction

Preflight found merged PR #236 missing milestone M1; restored milestone 1. A phase-helper invocation initially supplied `plan-eval` instead of the full `status:plan-eval`, temporarily removing #195 from a status column and creating an inert unintended label. The helper assertion and board check failed. Immediately restored the canonical status, removed the unintended label from #195, and deleted that newly created label. Final board check returned zero anomalies. No harness trigger was applied.

## Independent plan evaluation amendments

Opus returned PASS AFTER NARROW FIXES. The binding `plan-amendment.md` records dispositions for all 13 findings; the reviewed plan remains intact. Stage G is PASS for the plan plus amendments. No live transport or owner-fork scope was added.
