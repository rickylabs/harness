# Resume amendment — published baseline and unchanged recovery design

The existing plan and independent PASS are retained. This amendment updates release identity
and sequencing only; it does not change the reviewed recovery algorithm or gates.

- Current main baseline d283af8 contains documentation PR281/cfb559e and published contracts0.3.0, protocol1. Existing owned branch fix/265-connection-recovery was rebased without conflict; prior plan/evaluation content is preserved.
- Executed source comparison from old reviewed-plan commit d41220b to current source: fold.ts, client.ts, connection.ts, server.ts and events.ts are byte-identical. index.ts only gains the already-published governance/run reader exports. No recovery implementation has landed meanwhile.
- Replace the prior proposed0.2.0 identity with proposed0.4.0. Published0.1/0.2/0.3 identities are immutable; no tag/release operation is included. Numeric protocol remains1 because the reviewed change adds no wire shape. Versioned API behavior and optional legacy-compatible bound encoding follow the existing0.x policy.
- Governance/read-observation publication under205 is complete; broader205/87 live admission, quota and finite-capacity acceptance remains unknown. This recovery implementation is the next buildable step in the previously accepted sequence. No E11 implementation starts alongside it.
- Native export of the existing plan-review session records GLM5.3/provider_default on its supported Go/OpenRouter transports, matching retained feature plan-evaluator route. This checks native launch metadata; it is not a cryptographic vendor attestation.

All six binding implementation criteria in plan-eval.md still apply. The boardStatus documentation
must preserve the non-inference and authorization statements; source/capture clocks remain separate.
The installed-tarball synthetic recovery gate remains required. No new fold downstream, provider
process, live dispatch, credential access, backend authorization or private consumer details.

[source: git source comparison d41220b..currentmain; topic: unchanged recovery sources and added standalone exports; executed2026-09-08]
[source: PR281, contracts manifest0.3.0 and issue39/comment5582710963; topic: current documentation and immutable published baseline; verified2026-09-08]
