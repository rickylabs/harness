# Review disposition — forge-cwd-guard--e10

## Summary

All eleven Opus 5 findings are settled. Findings F1–F10 are binding implementation details below;
F11 is assigned to the parent coordinator, which owns `closure-decisions.md` and all later GitHub
actions. The effective implementation plan is the locked `plan.md` plus the deltas recorded in
`drift.md`.

| Finding | Disposition | Executable gate |
| --- | --- | --- |
| F1 | Accept explicit repo only as the documented strict `owner/name` form using the existing ASCII slug character boundary (`[A-Za-z0-9_.-]` per segment); reject URLs, trailing slash, empty/extra segments as usage. Preserve case for display, compare ASCII case-insensitively. A terminal `.git` is not stripped from explicit input because it can be a legitimate repository-name suffix; only clone URLs strip their final transport suffix. | CLI tests for valid mixed-case and `.git`-suffixed slugs plus every rejected spelling. |
| F2 | Resolve origin from the nearest existing directory at or above target cwd. A nonexistent nested target therefore inherits the enclosing checkout origin; a target whose nearest existing ancestor is outside every Git worktree remains unknown and proceeds. | Mismatching nested existing and nonexistent paths refuse; nonexistent path outside Git proceeds and is created by an authorized fake-transport writer. |
| F3 | Pure origin parser trims surrounding whitespace; accepts `http`, `https`, `ssh`, and `git` URLs with exact case-insensitive `github.com` hostname (ports allowed), plus exact-host scp-like SSH; permits credentials without emitting them, terminal `.git`, and trailing slash; requires exactly two decoded-safe path segments and no query/fragment. | Preservation table plus lookalike/malformed negative table and repo-inference CLI tests. |
| F4 | Plain mode writes a one-line forced-mismatch warning to stdout. JSON mode writes the warning to stderr so every existing stdout document remains parseable. Both name normalized slugs only. | Capture stdout/stderr for matching, forced plain, and forced JSON paths; parse JSON stdout. |
| F5 | Each fixture Git subprocess receives test-scoped `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` pointing at nonexistent fixture paths and uses `git init -q`. No `HOME` or auth variable is read or changed by fixture setup. | Test helper is inspectable; focused suite passes with isolated fixtures. |
| F6 | The implementation session performs no GitHub mutations. After the guard is complete, the parent coordinator separately owns issue #209/#212 comments and closure. | Git diff and worklog contain local changes/commands only. |
| F7 | Introduce a dedicated mismatch error mapped directly to exit `2`, without printing full usage. Strict malformed `--repo` remains an ordinary usage error. | Captured mismatch output is concise and excludes the usage header. |
| F8 | Diagnostic recommends `doctor` with the same target arguments as a read-only inspection step. | Output assertion. |
| F9 | Dry-run refusal recommends `--force --dry-run`; real refusal recommends `--force`. | Paired output assertions. |
| F10 | The writer predicate recognizes only no-subcommand/`install` skill forms; unknown skill subcommands retain their existing usage error. | `skill garbage` mismatch fixture asserts unknown-command text. |
| F11 | Parent coordinator repairs `closure-decisions.md` formatting before any external reuse. Implementation agent neither edits board state nor pastes it. | Parent-owned artifact review. |

## Why strict `--repo` is compatible

CLI help promises `--repo <owner/name>`, not a clone URL
([`packages/forge/src/cli.ts:155-160`](../../../packages/forge/src/cli.ts)). The repository already
uses `^[\w.-]+\/[\w.-]+$` as its repo-slug grammar
([`packages/forge/src/targets/model.ts:217-217`](../../../packages/forge/src/targets/model.ts)). Applying
that same segment vocabulary at the CLI boundary removes comparison ambiguity without rejecting a
documented input form. The origin parser remains broader because it consumes Git remote URLs rather
than CLI slugs.
