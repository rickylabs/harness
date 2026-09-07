# routing-configuration--271 — coordinator review

Independent implementation evaluation is pending. The coordinator reviewed source boundaries during implementation and reran the two reproductions at repaired source082dfb6b87f0ea638c4dd7480e3964e493b1d887. This is coordinator verification, not a substitute for different-family evaluation.

- A non-string accessor-bearing source identifier is refused with invalid/wrong-type at source.id; getter calls are zero.
- An isolated FIFO without a writer is refused with unreadable/not-a-file before the two-second child deadline. The earlier timeout was observed against in-flight output. Inspection of b15cad6 confirms nonblocking open was already present there; the followup added regressions, not a second production fix for an existing b15cad6 FIFO defect.
- A sampled validator mutation probe tried1400 field substitutions with zero thrown exceptions during implementation. This is sampled review, not exhaustive coverage.
- pnpm run check:metadata returned exit0 through coordinator GitHub access. The implementer’s credential-free exit3 remains separately recorded.
- Initial staged-addition publication scan found no operator paths, private consumer internals or credential-shaped values. Final source/artifact scan remains required before push.

The fresh matrix CLI selects Grok4.6 xhigh for architecture implementation evaluation, familyxai against the selected Astra/OpenAI generator. Its configured preferred available capability is Copilot; the inspect-only connector catalog reports the exact model and variant present. Catalog presence is not an inference, allowance or evaluation verdict. The launcher must enforce live allowance and the selected route before any reviewer result is accepted.

[source: packages/routing/src/load.ts at082dfb6; topic: repaired primitive-source and non-file boundaries; executed2026-09-07]
[source: packages/routing/src/load.ts atb15cad6; topic: correction of FIFO finding revision; inspected2026-09-07]
[source: scripts/check-metadata.mjs; topic: actual coordinator metadata comparison; executed2026-09-07]
[source: NetScript matrix CLI at8ba53bc50ca02aab29e99ba5362728839b8f1713, matrix-implementation-evaluation.json and matrix-evaluation-full.json; topic: exact evaluator, loop and transport ordering; queried2026-09-07]
[source: NetScript inspect-only Copilot catalog preflight; topic: model and effort presence, no inference; queried2026-09-07]
