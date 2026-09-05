# Drift — pr-105-adversarial-review--review-claude

## Summary

No scope drift has occurred. Review execution uses an isolated detached worktree and changes only
the declared durable review-artifact surface.

The requested `agent-code-reviewer` skill and a session-memory facility were not exposed in this
environment. The run records those unavailable inputs and proceeds through the issue's exhaustive
checklist under the repository doctrine; this changes the transport, not the review scope.

The host also exposed neither `pnpm` nor `rg`. The exact pinned pnpm was installed without scripts
into an ephemeral prefix; source searches used GNU grep with the same patterns. Root scripts invoke
`pnpm` by name, so the prefix's `node_modules/.bin` was added to `PATH` before the successful root
typecheck/build. These are tool-transport changes only; the reviewed source and versions stayed
fixed.

The worktree also lacked the promised Git author configuration. Commit creation used the existing
repository maintainer identity from the baseline commit, configured locally; no attribution footer
was added.
