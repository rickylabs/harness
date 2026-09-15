# Supervisor — receipt-root-diagnostics--368

## Summary

Issue [#368](https://github.com/rickylabs/harness/issues/368) is one leaf implementation run: make the Orchid dispatch reader distinguish a healthy empty receipt root from each root refusal it already enforces. The run will not relax any safety check.

## Identity and baseline

- Run slug: `receipt-root-diagnostics--368`
- Workload tier and role: `straightforward`, `implementation`
- Implementer: Codex, GPT-5, medium effort
- Baseline: `ade559bef2c8a8d8f4356d6c580b69e455e4cd48`
- Branch: `orch/divybot-368`
- Routing authority: NetScript `f3324909e0896cedc9729005bac5f508e122d6c6`; implementation `sol`/`medium`, fallback `glm_5_3_flash`/`provider_default`; implementation evaluator `glm_5_3_flash`/`provider_default`, fallback `deepseek_v4_pro`/`provider_default`
- Opened: 2026-09-15 UTC

## Mutation surface

This run may write exactly:

- `packages/telemetry/src/orchid-dispatch.ts`
- `packages/telemetry/src/orchid-dispatch.test.ts`
- `packages/telemetry/src/cli.ts` only if the additive result fields require the existing disabled-source fallback to be widened
- `packages/telemetry/README.md`
- `.llm/runs/receipt-root-diagnostics--368/**`

It must not amend `ARCHITECTURE.md`, change acceptance rules, mutate sibling repositories, or commit `.divybot-goal.md`. Any other required path is drift and must be recorded before it is touched.

## Governing sources

- The charter requires empty results to expose whether checks could run ([`ARCHITECTURE.md:117-132`](../../../ARCHITECTURE.md)).
- The leaf profile requires the baseline, exact mutation surface, fresh route, design checkpoint, repository gates, mutation check, and independent implementation evaluation ([`profiles/leaf.md:17-73`](../../../profiles/leaf.md)).
- The issue requires six machine-readable refusal reasons and a healthy negative control ([issue #368](https://github.com/rickylabs/harness/issues/368)).
