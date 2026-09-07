# Route identity -- E3.5 — supervisor

## Summary

This run planned and is now implementing the bounded route-identity prerequisite for issue #195.
Stage G passed through an independent Opus 5 medium evaluation plus the binding narrow amendments
in `plan-amendment.md` (`.llm/runs/route-identity--e35/plan-eval.md:1`). Stage H authorizes only the
product mutation manifest in `plan.md` plus run evidence. Board mutation, live provider access,
credentials, private telemetry, and sibling-repository mutation remain prohibited.

## Identity

| Item | Value |
|---|---|
| Run slug | `route-identity--e35` |
| Task | #195, route identity before a useful Codex turn |
| Baseline | `99a32a7ce366bbc8908dad3e31072b8da7ed902d` |
| Branch | `feat/route-identity--e35` |
| Worktree | `/home/agent/projects/harness/.git/seat3-route195` |
| Host class | shared Linux planning workspace; no host telemetry inspected |
| Coordinator | Astra, medium reasoning |
| Research/plan author | Sol, medium reasoning, Codex |
| Matrix pin | `8ba53bc50ca02aab29e99ba5362728839b8f1713` |
| Plan evaluator | Opus 5, medium, independent session |
| Stage-H implementer | Sol, medium, Codex, implementation turn |
| Intended implementation reviewer | GLM 5.3 Flash, provider default, independent session |
| Fallback | none taken |

The selected author/evaluator split follows the requirement that evaluation use a different
session from authorship (`doctrine/WORKFLOW.md:71`). The matrix chooses the model; the provider
packages do not choose it (`packages/subagents/src/dispatch.ts:34`).

## Declared mutation surface

- `.llm/runs/route-identity--e35/research.md`
- `.llm/runs/route-identity--e35/plan.md`
- `.llm/runs/route-identity--e35/supervisor.md`
- `.llm/runs/route-identity--e35/context-pack.md`
- `.llm/runs/route-identity--e35/worklog.md`
- `.llm/runs/route-identity--e35/drift.md`
- `.llm/runs/route-identity--e35/protocol-schema.md`

Every other path is read-only in this planning session. The exact mutation surface is required
at Stage A (`doctrine/WORKFLOW.md:31`).

## Stage-H authorization

Product mutation is authorized by the Stage-G `PASS` for the original plan plus
`plan-amendment.md`. The exact product manifest is the table in `plan.md`; all run artifacts in this
directory may be updated as evidence. Draft PR #238 exists for this branch. The implementer may run
local package/workspace checks and commit the reviewed scope with the required co-author trailer.
No implementation-review verdict exists yet; the coordinator owns the later independent GLM 5.3
Flash review, CI, PR, merge, issue status, and board verification.

## Explicit prohibitions

- No product mutation outside the Stage-H manifest; no doctrine, issue, label, board, PR, or push.
- No `harness` label: it is a live dispatch trigger (`AGENTS.md:37`).
- No provider process spawn, daemon attach, restart, repair, canary, turn, or other live connection.
- No auth files, environment secrets, credentials, private telemetry, or operational snapshots.
- No sibling-repository mutation and no new build-time dependency on the service repository; the
  repository's ratified Node/pnpm and service-adapter boundary forbids that (`AGENTS.md:89`).
