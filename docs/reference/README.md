# Reference

*What exactly does this flag do? What does exit 3 mean?*

**This directory is written by a generator, not by a person.** That is the whole reason it exists as
a separate kind of page: a flag list maintained by hand is a flag list that is wrong within a month,
and wrong quietly — nothing turns red when a document falls behind the code it describes.

## What is here

- **[CLI reference](cli/README.md)** — one page per binary, rendered from the binary.
  [`scripts/cli-reference.mjs`](../../scripts/cli-reference.mjs) runs each built command with
  `--help` and captures what it actually prints, and imports `EXIT` and `EXIT_MEANINGS` from the
  same module for the exit table. `pnpm run check:docs` re-renders and byte-compares; it runs at the
  end of `pnpm run build`, which is what CI runs. Editing a page by hand fails the build instead of
  reaching a reader.

Two more generated surfaces live next to the things they configure rather than here, because that is
where the tools that read them look:

- [`.github/labels.yml`](../../.github/labels.yml) — the label taxonomy, ejected by
  `dsh-forge labels eject`, and the reviewable source of truth for what `dsh-forge labels apply`
  will do.
- [`.claude/skills/board-process/SKILL.md`](../../.claude/skills/board-process/SKILL.md) — the same
  taxonomy in the form an agent reads, written by `dsh-forge skill install`.

## Reading an exit code

The exit maps are a contract callers branch on, and they are the part of a CLI most likely to be
guessed at. `2` means a usage error in all five binaries. Beyond that each binary's codes are its
own: `3` is a missing GitHub transport for `dsh-board` and `dsh-forge`, an unreadable input for
`dsh-coordinator`, an unwritable destination for `dsh-profile`, and an incomplete picture for
`dsh-telemetry` — four related meanings that are not one meaning, which is exactly why these pages
are generated rather than remembered.

## What does not belong here

Anything a generator cannot produce. Reasoning goes to [`concepts/`](../concepts/); a path through
several commands goes to [`how-to/`](../how-to/); the argument for a package's design stays in that
package's README, which is written by hand and owns it.

If you find yourself wanting to add a paragraph of explanation to a generated page, that paragraph
belongs in the source the page is generated from — usually the CLI's own usage text, where it also
reaches the person who typed `--help`.

---

Back to [docs](../README.md)
