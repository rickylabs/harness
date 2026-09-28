## Summary

Add per-agent recent activity, measured tokens against that agent's budget, and a sourced timeline to the issue-agent tree for the USABLE-1 cockpit and mobile checkpoint. Activity is reduced from bound native transcripts before publication; accepted action receipts remain delivery events and do not prove termination.

## Scope

Implements the coordinator's 2026-09-28 USABLE-1 Harness contract request. Contracts minor version is 0.11.0. The additive fields are `activity`, `tokenUsage`, and `timeline`; consumers must upgrade to 0.11.0 before deploying the new producer because older strict decoders reject unknown agent keys.

## Validation

- `pnpm typecheck` — PASS.
- `pnpm build` — PASS.
- `pnpm test` — PASS with an executable TMPDIR; the inherited noexec TMPDIR made the first installed-package preflight inconclusive, then the full suite passed after moving TMPDIR to an executable scratch filesystem.
- Removed exact action-agent binding guard: the focused regression failed; restored guard and rebuilt.
- Public diff and PR body leak scan — PASS.

## Drift / Debt

- Goal notification events are reserved in the contract but not emitted: Orchid currently persists no validated goal notification event for the issue feed. No goal activity is inferred from transcript prose.
- The issue-scoped native reader currently binds Codex only; Claude transcript parsing is sanitized and measured, but Claude issue-tree publication needs a verified Orchid native binding and bounded scoped scan.
