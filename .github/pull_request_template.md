<!--
Conventions, in full: CONTRIBUTING.md. The three that get forgotten:

- Exactly ONE `status:` label, plus the `type:`, `area:`, `epic:` and `priority:` that apply.
  `dsh-board check` exits non-zero when an item carries two or none.
- Keep Verification honest. Paste real output and real exit codes — a checked box with nothing
  behind it is how a false green merges.
- Nothing auto-merges here. A human merges this after CI is green, so make it reviewable.

Delete any section that genuinely does not apply. Do not leave it empty.
-->

## Summary

<!-- One to three sentences: what changes, and why. -->

## Scope

- Closes #<!-- the issue this finishes. A bare `#N` does not close anything; a keyword does. -->
- Part of #<!-- epic, if any. Never put a closing keyword on an epic. -->

## Verification

<!-- Real results. Name the exit code. "Passes" is not a result. -->

- `pnpm run typecheck` —
- `pnpm run build` —
- `pnpm test` —

<!-- Add whatever else this change makes falsifiable: a CLI run and its output, a board check, a
     golden diff. A docs-only PR still runs the four, because `check:docs` lives in `build`. -->

## Generated files

<!-- The most common way a PR here breaks. If none changed, write "none". -->

- [ ] No generated file was hand-edited. Anything below was produced by its command:

| File | Command |
| --- | --- |
| <!-- e.g. .claude/skills/board-process/SKILL.md --> | <!-- pnpm run skill:install --> |

## Owner forks

<!-- Questions that depend on what the owner wants rather than on what is true. Raise them here;
     do not resolve one and move on. "none" is a valid and common answer. -->

none

## Drift and debt

<!-- What this leaves behind, deliberately, and what owns it. "none" if nothing. -->

none

## Definition of done

<!-- Every box true before `status:ready-merge`. -->

- [ ] Branch is `<type>/<issue>-<slug>`, and the labels match the taxonomy (exactly one `status:`).
- [ ] Every acceptance box on the linked issue is checked, against evidence in this PR.
- [ ] Documentation that this change makes untrue is updated — generated pages regenerated, hand-written pages edited.
- [ ] No unrelated churn: no lockfile change without a reason stated above, no drive-by formatting.
- [ ] Nothing in the diff prints, logs, or commits a credential.
