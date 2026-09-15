# Research — receipt-root-diagnostics--368

## Summary

The configured-root checks already refuse every requested defect, but one outer catch erases their identities. The change can classify the same checks without changing the accepted set.

## Findings

- `OrchidDispatchRead` currently exposes only dispatches, notes, and degraded; undefined configuration is intentionally healthy and unbound ([`packages/telemetry/src/orchid-dispatch.ts:15-23`](../../../packages/telemetry/src/orchid-dispatch.ts)).
- Absolute/canonical path, directory, private mode, and Git-ancestor checks are already enforced before scanning ([`packages/telemetry/src/orchid-dispatch.ts:27-36`](../../../packages/telemetry/src/orchid-dispatch.ts)).
- Every root refusal becomes the same `source_unavailable` note while entry failures separately become `binding_unavailable` ([`packages/telemetry/src/orchid-dispatch.ts:39-94`](../../../packages/telemetry/src/orchid-dispatch.ts)).
- The CLI consumes only dispatches, notes, and degraded; its disabled-source fallback may need the additive fields for type consistency ([`packages/telemetry/src/cli.ts:549-555`](../../../packages/telemetry/src/cli.ts)).
- The existing test has only one configured-root refusal control, wrong mode ([`packages/telemetry/src/orchid-dispatch.test.ts:48-66`](../../../packages/telemetry/src/orchid-dispatch.test.ts)).
- The public package documentation promises a fixed diagnostic for invalid sources but does not expose the root/reason distinction ([`packages/telemetry/README.md:699-707`](../../../packages/telemetry/README.md)).

## Routing evidence

At NetScript `f3324909e0896cedc9729005bac5f508e122d6c6`, fresh `deno task agentic:matrix --tier straightforward --role implementation --json` selected `sol`/`medium`, then `glm_5_3_flash`/`provider_default`. Fresh `--impl-evaluator --json` selected `glm_5_3_flash`, then `deepseek_v4_pro`, both provider default. Both commands exited 0 on 2026-09-15 UTC.

## External leg

No vendor behavior is load-bearing. Node filesystem semantics are exercised through repository tests rather than assumed from marketing or prose.
