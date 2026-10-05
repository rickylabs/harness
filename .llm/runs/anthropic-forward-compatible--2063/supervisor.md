# Anthropic forward compatibility — issue 2063

Implement NetScript’s explicit Anthropic model support and model-specific wire validation; deliver upstream code plus Harness evidence.

- Generator: Codex, OpenAI `gpt-6.1-sol`, requested effort `xhigh`; assigned session on `orch/divybot-600`.
- Harness baseline: `5acda61b509d280d1baa22e493bdc8e4b91bed32`.
- Upstream baseline: `6f6cbdf030d7595d1730272d0a74aedd66225069`, isolated branch `fix/anthropic-forward-compatible-2063`.
- Defect: the static catalog rejects explicitly requested future Anthropic IDs before transport, while the generic mapper can disable mandatory adaptive thinking.
- Tier: straightforward; role: implementation. Fresh NetScript main queries the pinned Harness matrix at `bd02f966a42dd1029b4349a038c52d0928fac41f`; Sol/xhigh matches the assigned route. Implementation evaluator: GLM 5.3 Flash/provider_default, then DeepSeek V4 Pro/provider_default.
- Mutation surface in Harness: `.llm/runs/anthropic-forward-compatible--2063/**`; excluded final-report handoff only. `.divybot-goal.md` must not be committed.
- Mutation surface in isolated NetScript worktree: `packages/ai/src/adapters/anthropic.adapter.ts`, necessary Anthropic option validation in `packages/ai/src/adapters/tanstack-chat-client.ts`, `packages/ai/tests/anthropic_forward_compatible_test.ts`, `packages/ai/README.md`, `docs/site/ai/engine.md`, generated documentation carriers required by repository gates, `.llm/runs/anthropic-forward-compatible--2063/**`. Additions outside this surface require a drift entry.
- Upstream issue: https://github.com/rickylabs/netscript/issues/2063 ; inbox: https://github.com/rickylabs/harness/issues/600 .
- Fresh upstream worktree is authorized by the assignment’s dependency/upstream-PR instruction. Existing sibling worktrees remain read-only.
