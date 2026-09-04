# Drift — pr-98-adversarial-review--review-claude

## Summary

No scope drift occurred. Review execution used an isolated detached worktree, in-memory GitHub REST
fixtures, and temporary directories; it changed only the declared durable review-artifact and local
memory surfaces.

The requested `agent-code-reviewer` skill was absent from both the session catalog and repository.
Issue #99's explicit adversarial checklist was used directly, and the missing skill is recorded rather
than represented as a pass.

The host exposed neither pnpm nor Corepack. The exact committed `pnpm@11.25.0` was installed in an
ephemeral prefix. Its bin directory had to be placed on `PATH` because `pnpm run check:graph` performs
a nested `pnpm install`; invoking only the CLI's absolute path failed before the graph gate with
`spawnSync pnpm ENOENT`. The corrected invocation passed.

Issue #99 calls #31–#39 “six real epic issues,” while the live repository contained nine open,
epic-labelled issues in that range. The review widened the data check to all nine rather than silently
discarding three.

The first static scan attempted `rg`, which was unavailable in the review shell and exited 127. It was
rerun with `grep`; the credential-signature scan returned no matches and the delete-call scan found no
transport or call site.

The worktree had no Git author identity despite the operator preamble saying it was already set. The
authenticated account's login and noreply address were installed in repository-local Git config; no
global config or commit attribution footer was added. The installed `gh` also rejected `--json` on
`gh pr create`; the command was rerun without that output-only flag and the created PR was verified
through the REST API.

Validation from the orchestrator worktree under `/ephemeral` installed successfully but package
scripts exited 126 because that filesystem is mounted noexec. A first retry created a `/tmp`
worktree but accidentally retained the original shell working directory, so it reproduced the same
failure and was discarded as evidence. The corrected retry ran from `/tmp/harness-pr102-validate.*`
at committed artifact head `88f99c4`; frozen install, clean typecheck, clean build, graph checks, and
diff checks all exited 0.
