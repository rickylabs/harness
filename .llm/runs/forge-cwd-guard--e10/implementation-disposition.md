# Implementation disposition — forge-cwd-guard--e10

## Summary

The checkout guard is implemented within the approved surface. Local writers now compare explicit
repo identity with the enclosing checkout's exact GitHub origin before transport probing or file
access. Mismatches refuse with exit `2`; forced exceptions are visible and preserve JSON stdout.
Portable no-origin use and remote-only apply behavior remain intact.

## Review-finding proof

| Finding | Landed behavior |
| --- | --- |
| F1 | Explicit repo accepts strict two-segment ASCII `owner/name`, preserves display case, and compares case-insensitively; malformed input is not echoed. |
| F2 | Origin lookup walks to the nearest existing ancestor, so existing and nonexistent nested targets inside a mismatching checkout both refuse. |
| F3 | The pure parser preserves HTTPS, credentialed HTTPS, HTTP, SSH URL, Git URL, scp-like SSH, port, trailing slash/newline, and `.git` forms; exact-host/path negatives refuse. |
| F4 | Forced plain mismatch warns on stdout; JSON mode warns on stderr and leaves stdout parseable. Both show normalized identities only. |
| F5 | CLI tests scope `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` across fixture creation and the real lookup subprocess, restoring both after each test without changing `HOME` or auth. |
| F6 | This implementation performed no GitHub mutation; the parent owns closure actions. |
| F7 | Dedicated mismatch handling returns `2` without printing full usage. |
| F8 | Refusal points to read-only `doctor`. |
| F9 | Dry-run refusal recommends `--force --dry-run`; forced preview writes and sends nothing. |
| F10 | Only valid skill install forms are guarded; `skill garbage` reports the unknown command. |
| F11 | The parent repaired closure references and recorded execution ownership in `closure-decisions.md`. |

The strongest negative control begins with existing sentinel taxonomy and skill bytes, runs all three
writers against a mismatch, and proves the bytes remain exact while probe and mutation counts remain
zero. A separate positive control proves remote-only `labels apply` still reaches only the injected
fake transport.

## Documentation

The package README now states the third tool safety rule. Tutorial step 2 retains the hazard warning,
explains mismatch and nonexistent nested-path behavior, keeps explicit `--cwd`, and names the portable
unknown-origin boundary. `docs/reference/cli/dsh-forge.md` was regenerated from the built binary.

## Validation

- `pnpm --filter @rickylabs/forge test` — PASS, 505 tests, 0 failures.
- `pnpm --filter @rickylabs/forge typecheck` — PASS.
- `pnpm run docs:cli` — PASS; all packages built, one of six CLI pages regenerated.
- `pnpm run build` — PASS; graph, lifecycle, links, forms, snapshots, all package builds, publish
  check, six generated CLI references, and generated board skill all pass.
- `git diff --check` — PASS.
- Parent actual-checkout mismatch preview — PASS, exit `2`; both tracked target SHA-256 values remained
  exact. See [`parent-preview-receipt.md`](parent-preview-receipt.md).

No production Forge transport, real `init`, real label apply, credentials, home path, binary artifact,
or live GitHub mutation was used.
