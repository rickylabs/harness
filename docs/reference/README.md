# Reference

*What exactly does this flag do? What does exit 3 mean?*

**This directory is written by a generator, not by a person.** That is the whole reason it exists as
a separate kind of page: a flag list maintained by hand is a flag list that is wrong within a month,
and wrong quietly — nothing turns red when a document falls behind the code it describes.

**It is empty today.** [#143](https://github.com/rickylabs/harness/issues/143) fills it: the CLI
reference is rendered from the binaries' own usage text and byte-compared in CI, so a flag that
changes without the page changing is a failing build rather than a stale page.

Until then, each binary is its own reference. Run it with no arguments:

```bash
node packages/coordinator/dist/cli.js
```

Every one of them prints its subcommands, its options, and its exit codes.

## What belongs here, once it is generated

- Every subcommand and option of `dsh-board`, `dsh-coordinator`, `dsh-forge`, `dsh-profile` and
  `dsh-telemetry`.
- The exit-code map for each binary. These are a contract callers branch on. `2` means a usage error
  in all five; beyond that each binary's codes are its own. `3` is a missing GitHub transport for
  `dsh-board` and `dsh-forge`, an unreadable input for `dsh-coordinator`, an unwritable destination
  for `dsh-profile`, and an incomplete picture for `dsh-telemetry` — four related meanings that are
  not one meaning, which is exactly why this page is generated rather than remembered.
- The label taxonomy as installed, which already has a generated home in
  [`.github/labels.yml`](../../.github/labels.yml) and a generated agent-facing form in
  [`.claude/skills/board-process/SKILL.md`](../../.claude/skills/board-process/SKILL.md).

## What does not belong here

Anything a generator cannot produce. Reasoning goes to [`concepts/`](../concepts/); a path through
several commands goes to [`how-to/`](../how-to/); the argument for a package's design stays in that
package's README, which is written by hand and owns it.

If you find yourself wanting to add a paragraph of explanation to a generated page, that paragraph
belongs in the source the page is generated from — usually the CLI's own usage text, where it also
reaches the person who typed `--help`.

---

Back to [docs](../README.md)
