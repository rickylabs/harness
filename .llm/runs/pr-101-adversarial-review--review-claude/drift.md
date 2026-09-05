# Drift — pr-101-adversarial-review--review-claude

## Summary

No scope drift occurred. Review execution used an isolated detached worktree for PR #101 and
temporary read-only clones of upstream behavior sources. Durable changes stayed within the declared
review-run surface.

The host exposed neither global pnpm nor Go. The exact committed pnpm 11.25.0 was installed into a
temporary prefix. Go 1.25.0, the version declared by Orchid, was installed through the host's mise.
The first Go test binary landed on `/ephemeral`, which is mounted `noexec`, and failed with
`permission denied`; the same unchanged test was rerun with `GOTMPDIR` and `GOCACHE` on executable
`/tmp` storage and passed. The failed attempt was not counted as evidence.

The `autocorner/website` doctrine source and PR #14 were not accessible to the authenticated GitHub
principal (`GraphQL: Could not resolve to a Repository`). The review did read the available NetScript
harness/CLI doctrine and runtime primitive packages plus the `rickylabs/eis-chat` runtime wiring.
This unavailable prior-art leg does not carry any finding in this implementation review.
