# Independent plan review disposition — board-dsh-adapter--204

## Summary

The independent review returned `PASS AFTER NARROW FIXES`. All six findings and both smaller notes
are accepted and incorporated into the locked research and plan. No finding changes scope, creates
an owner fork, or requires a spike. Product mutation remains blocked until the coordinator verifies
these dispositions and records the Stage G gate.

## Findings

| Finding | Disposition | Locked correction |
| --- | --- | --- |
| F1 — missing todos detected after partial mutation | Accepted | Preflight `"todos" in snapshot(...).values` before either append; missing capability must preserve exact `session.seq`. |
| F2 — refresh sync contract unspecified | Accepted | `refresh` is synchronous, returns the snapshot directly, contains no Promise/await, and must not be invoked from a projection change listener. |
| F3 — strict `ZodType<PublicTree>` compatibility unproven | Accepted | Schema owns its output DTO; an explicit conditional-spread adapter converts `PublicTree`. Behavioral tests accept real output and reject unknown root/nested keys. No cast or `z.unknown()` fallback. |
| F4 — tool-todo `/types` does not exist; required config omitted | Accepted | Exact entrypoints are named per package; tool-todo imports come from its root and integration/smoke pass `{ allowParallelInProgress: true }`. |
| F5 — unconditional injection removes bare projector | Accepted | `ctx.harnessBoard` remains unconditional; rich registration uses optional `ctx.inject(["sessionProjections"], ...)`, with refresh failing before mutation when unavailable. |
| F6 — todo source shape under-specified | Accepted | Todos derive from `BoardSnapshot.items` before telemetry normalization, so `bucketOf` receives `BoardItem`. |

## Smaller notes

| Note | Disposition | Locked correction |
| --- | --- | --- |
| Smoke script needs a build | Accepted | `smoke:board-projection` is exactly `tsc -b && node dist/board-smoke.js`. |
| `normaliseItems` can return `ok: false` | Accepted | Treat it as an adapter invariant failure before append, include its notes in the error, and assert the Session sequence is unchanged. |

## Gate state

The plan is frozen after these narrow corrections. Independent gate verification is the next action;
implementation remains outside this artifact-only mutation.
