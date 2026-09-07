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

## Stage-H implementation choices

| ID | Observation | Disposition |
|---|---|---|
| D-004 | A public injectable request-id factory would let callers weaken UUID uniqueness. | Kept request-id generation internal with a fresh Node `randomUUID()` for thread/start and turn/start; fakes respond to the actual request id. This binds amendment finding 1. Source: `.llm/runs/route-identity--e35/plan-amendment.md:5` |
| D-005 | A mismatched thread is identified even though no useful turn was sent. | The refused result retains the thread handle for later #53 reconciliation/cleanup; this slice performs no cleanup. Retry remains safe only after route/config correction. Source: `packages/subagents/src/provider.ts:258` |
| D-006 | Raw response property access can throw, and a matching route without a usable thread id is not attributable. | Parser/read boundaries convert thrown accessors to unknown; missing thread identity downgrades route evidence to unknown without the phrase “route verified.” Source: `.llm/runs/route-identity--e35/plan-amendment.md:6` |
| D-007 | Independent review found two stale root README claims after the original documentation sweep. | Coordinator authorized `README.md` as a narrow manifest addition. Both locations now distinguish the implemented protocol prerequisite from the unimplemented/uncomposed provider. No other README text or #237 fork content changed. Source: `README.md:151` |
| D-008 | Review note: package README and provider-codex index use wording equivalent to the required no-composition statement. | Accepted with no further edit; both state that no Codex provider is composed and #53 still owns the full provider. Sources: `packages/provider-codex/README.md:5`, `packages/provider-codex/src/index.ts:1` |
| D-009 | Review note: early unknown evidence cannot distinguish invalid observation from an observation never received. | Accepted diagnostic debt for #53. Both cases remain `unknown`, never send a useful turn, and are never retryable, so no safety or sentinel change is made in #195. Source: `packages/provider-codex/src/protocol.ts:192` |

## Coordinator metadata correction

Preflight found merged PR #236 missing milestone M1; restored milestone 1. A phase-helper invocation initially supplied `plan-eval` instead of the full `status:plan-eval`, temporarily removing #195 from a status column and creating an inert unintended label. The helper assertion and board check failed. Immediately restored the canonical status, removed the unintended label from #195, and deleted that newly created label. Final board check returned zero anomalies. No harness trigger was applied.

## Independent plan evaluation amendments

Opus returned PASS AFTER NARROW FIXES. The binding `plan-amendment.md` records dispositions for all 13 findings; the reviewed plan remains intact. Stage G is PASS for the plan plus amendments. No live transport or owner-fork scope was added.
