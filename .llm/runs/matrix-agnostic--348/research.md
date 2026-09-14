# Matrix agnostic — research

Two reported restrictions are confirmed; purposes are already open. A further router round-trip restriction and a reviewer-coverage gap must be fixed.

- eis-chat `apps/dashboard/lib/model-discovery.ts:1` combines saved custom records, runtime model lists and a cached public catalog. Lines 74–92 bound network reads; lines 344–397 preserve labels and saved provenance. Its `components/ui/model-selector.tsx:109` groups by provider and family; line 157 searches labels, IDs, provider and description. This task exports the catalog contract; provider probing and cockpit UI remain external.
- netscript `.llm/tools/agentic/runtime/delegation-matrix.ts:378` defines eight roles per tier; lines 400–506 define distinct plan and implementation evaluator bindings. This task permits that shape without copying its model policy.
- Baseline `packages/routing/src/schema.ts:15` closes triggers; line 122 fixes tier rows to implement/review; line 255 already reads purposes from the document. Model references and registered families are validated at lines 261–294.
- Baseline `packages/routing/src/resolve.test.ts:92` and `schema.test.ts:17` assert literal selections against the shipped config. `load.test.ts:16`, plus llm-local/dsh-app tests, also read that config for model-specific behavior.
- Baseline `packages/routing/src/resolve.ts:39` counts any certification without checking opposite family. Tier coverage only considers implement/review. `chore_code` has implementation purpose but is absent from all tier rows.
- Baseline `packages/subagents/src/dispatch.ts:83,425,515` closes router IDs and drops unfamiliar IDs on typed round-trip. Harnesses instead map to actual executor cases (`dispatch.ts:21,59`); accepting unknown ones misrepresents execution.
- The charter forbids cockpit UI here (`ARCHITECTURE.md:270`) and requires distinct evaluator family (`ARCHITECTURE.md:158`). No new external vendor-behavior claim is needed; live capability is explicitly unproven by an exported configuration catalog.
