# Drift — pr-91-adversarial-review--review-claude

## Summary

No scope drift occurred. Review execution used an isolated detached worktree and changed only the
declared durable review-artifact surface.

The host exposed neither `pnpm` nor Corepack. To exercise the exact committed package-manager pin,
the reviewer installed `pnpm@11.25.0` into an ephemeral `/tmp` prefix and invoked its CLI through
Node. This changes transport, not the tested version or repository state.
