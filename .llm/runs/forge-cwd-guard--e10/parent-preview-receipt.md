# Parent preview receipt — forge-cwd-guard--e10

## Result

**PASS.** After the build passed, the parent ran the built Forge binary from the actual harness
checkout with an intentionally different repository and no `--cwd`:

    node <guard-build>/packages/forge/dist/cli.js init \
      --repo rickylabs/harness-tutorial-scratch --dry-run

The command exited `2`, wrote nothing to stderr, and printed the concise refusal:

    refusing local repository writes: --repo rickylabs/harness-tutorial-scratch does not match checkout origin rickylabs/harness at /home/agent/projects/harness.
      run 'dsh-forge doctor' with the same --repo and --cwd to inspect the target.
      if this mismatch is intentional, rerun with --force --dry-run.

This was a read-only dry run. No live writer or label operation was executed. The source preflight
ordering and injected-probe tests prove refusal precedes transport probing; this parent preview did
not instrument the transport.

## Byte evidence

| Tracked target | SHA-256 before | SHA-256 after |
| --- | --- | --- |
| `.github/labels.yml` | `8ea6aa2b373ec317ada98e43be5e51084a7af6f1b87b1c6c2d9a5e199a892860` | `8ea6aa2b373ec317ada98e43be5e51084a7af6f1b87b1c6c2d9a5e199a892860` |
| `.claude/skills/board-process/SKILL.md` | `d69a02d1a4473bc4ed695b6b2f7ee38ad51b3ab77fe51dfeaaa7929c244d199b` | `d69a02d1a4473bc4ed695b6b2f7ee38ad51b3ab77fe51dfeaaa7929c244d199b` |

Both tracked files remained byte-identical. The parent retained the machine-readable source receipt
at `/home/agent/projects/harness/.git/seat3-forge217-parent-preview.json`; this Markdown artifact is
the durable public-safe summary.

