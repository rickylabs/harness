# Research — forge-cwd-guard--e10

## Summary

The defect is confirmed in the real CLI path. `--cwd` defaults to the process working directory,
an explicit `--repo` bypasses origin-based repository resolution, and `init` writes
`.github/labels.yml` before applying labels or installing the skill. No check currently establishes
that the explicit GitHub repository and target checkout are the same repository
([`packages/forge/src/cli.ts:1475-1478`](../../../packages/forge/src/cli.ts),
[`packages/forge/src/cli.ts:1571-1595`](../../../packages/forge/src/cli.ts),
[`packages/forge/src/cli.ts:583-603`](../../../packages/forge/src/cli.ts)).

The narrow compatible fix is a preflight for commands that can write local checkout files. When an
explicit `--repo` and a parseable GitHub `origin` are both present, compare normalized
`owner/name` identities case-insensitively and refuse a mismatch unless `--force` is present. Run
that preflight before context resolution, which is also before transport probing. An absent or
non-GitHub origin supplies no mismatch evidence and preserves Forge's documented portable/offline
local-writer use. Read-only commands and remote-only `labels apply` retain their current behavior.

## Corpus

### Repository and issue leg

- Issue [#217](https://github.com/rickylabs/harness/issues/217) reports that invoking `init` from the
  harness checkout for another `--repo`, without the intended `--cwd`, overwrites harness's tracked
  taxonomy and board skill. The owner explicitly delegates whether the signal should refuse, prompt,
  or accept an escape hatch.
- The tutorial currently describes the exact hazard and states that no guard exists, then routes all
  Forge calls through `--cwd ../scratch`
  ([`docs/tutorials/01-from-clone-to-board.md:60-81`](../../../docs/tutorials/01-from-clone-to-board.md)).
- CLI help defines `--repo` as the target repository, defaulting from origin, and `--cwd` as the
  repository root, defaulting from the working directory. It already defines `--force` as the
  explicit permission for conflict settlement and overwriting foreign generated files
  ([`packages/forge/src/cli.ts:135-160`](../../../packages/forge/src/cli.ts)).
- `resolveContext` chooses the explicit repo without consulting origin; only an omitted repo calls
  `detectRepoSlug`. It then probes GitHub and may list labels before it reads local taxonomy and
  repository evidence ([`packages/forge/src/cli.ts:247-290`](../../../packages/forge/src/cli.ts)).
- `cmdEject` creates the parent directory and writes `.github/labels.yml`; `cmdSkillInstall` invokes
  the local skill installer; and `cmdInit` calls eject, apply, and skill install in that order
  ([`packages/forge/src/cli.ts:497-531`](../../../packages/forge/src/cli.ts),
  [`packages/forge/src/cli.ts:534-580`](../../../packages/forge/src/cli.ts),
  [`packages/forge/src/cli.ts:583-603`](../../../packages/forge/src/cli.ts)). These establish the
  local-writer set as `labels eject`, `skill install`, and `init`.
- `labels apply` mutates GitHub through the selected transport but writes no local file; its dry-run
  path reports the plan and returns before `applyPlan`
  ([`packages/forge/src/cli.ts:442-458`](../../../packages/forge/src/cli.ts)). The issue's checkout
  clobber failure therefore does not justify changing this remote-only command.
- Origin detection currently runs `git remote get-url origin` but parses it with a loose
  `github.com` substring regex. It has no focused tests and can accept lookalike hosts or malformed
  paths ([`packages/forge/src/labels/github.ts:217-225`](../../../packages/forge/src/labels/github.ts)).
- The CLI suite already exercises the real `main` entrypoint with an in-memory transport through
  `CliOverrides.probeTransport`; fixtures are temporary directories, and mutation assertions prove
  both positive and negative controls
  ([`packages/forge/src/cli.test.ts:21-86`](../../../packages/forge/src/cli.test.ts),
  [`packages/forge/src/cli.test.ts:94-125`](../../../packages/forge/src/cli.test.ts)).
- The CLI reference is generated from the built binary's help and compares bytes during the build,
  so any revised `--force` help must be regenerated through the generator
  ([`scripts/cli-reference.mjs:85-117`](../../../scripts/cli-reference.mjs),
  [`scripts/cli-reference.mjs:127-163`](../../../scripts/cli-reference.mjs),
  [`package.json:22-24`](../../../package.json)).

### External leg

Git documents URL forms with distinct parsing rules: scheme URLs for SSH, Git, HTTP, and HTTPS, plus
an scp-like SSH form recognized only when no slash precedes the first colon
([Git clone — Git URLs](https://git-scm.com/docs/git-clone#_git_urls)). Git also documents that
`git remote get-url origin` retrieves the configured URL with `insteadOf` expansion and returns the
first URL by default ([Git remote — get-url](https://git-scm.com/docs/git-remote)). These sources
support a small exact parser rather than broad substring matching.

GitHub documents its canonical HTTPS form as `https://github.com/user/repo.git` and SSH form as
`git@github.com:user/repo.git`, and explains that the default remote is usually named `origin`
([GitHub Docs — About remote repositories](https://docs.github.com/en/get-started/git-basics/about-remote-repositories)).
The guard should therefore accept equivalent canonical GitHub URL forms, strip one terminal `.git`
and optional trailing slash, require the exact `github.com` host and exactly two non-empty path
segments, then compare only normalized slugs. Error output must never reproduce the raw remote URL,
because URLs can contain credential-bearing user information.

### Document leg and constraints

The workflow requires a separate session to attack the locked plan and forbids product mutation
until Stage G says `PASS` ([`doctrine/WORKFLOW.md:59-90`](../../../doctrine/WORKFLOW.md)). The standing
citation and executable-gate rules require every behavioral choice below to be sourced and every
claimed guard behavior to be exercised in this repository
([`doctrine/PRINCIPLES.md:18-39`](../../../doctrine/PRINCIPLES.md)).

## Behavioral matrix

| Command state | Proposed result | Evidence/rationale |
| --- | --- | --- |
| explicit `--repo`, matching GitHub origin | proceed | The two independently supplied target identities agree. |
| explicit `--repo`, mismatching GitHub origin | exit `2` before transport probe or write | This is an invocation-target error; `UsageError` already maps to `2` ([`packages/forge/src/cli.ts:1599-1605`](../../../packages/forge/src/cli.ts)). |
| mismatch plus `--force` | proceed | Reuses the existing explicit destructive override ([`packages/forge/src/cli.ts:155-160`](../../../packages/forge/src/cli.ts)). |
| repo omitted | proceed with existing origin-derived repo | `resolveContext` already derives the only target identity from that origin ([`packages/forge/src/cli.ts:251-262`](../../../packages/forge/src/cli.ts)). |
| no origin / non-GitHub origin plus explicit repo | proceed | There is no contradictory identity; offline eject/install are documented capabilities ([`packages/forge/README.md:72-83`](../../../packages/forge/README.md)). |
| local-writer command with `--dry-run` and mismatch | refuse unless `--force` | Dry-run should predict whether the corresponding write invocation is admissible; it still writes and sends nothing ([`packages/forge/src/cli.test.ts:94-125`](../../../packages/forge/src/cli.test.ts)). |
| `doctor`, `labels plan`, `labels check` | unchanged | They do not write checkout files; plan/check require only transport and report state ([`packages/forge/src/cli.ts:356-439`](../../../packages/forge/src/cli.ts)). |
| `labels apply`, including its dry run | unchanged | It has no checkout-file write path ([`packages/forge/src/cli.ts:442-495`](../../../packages/forge/src/cli.ts)). |

## Synthesis

A prompt is inappropriate because the CLI is used by CI and scripts and has no interactive contract.
Refusal with an explicit escape hatch makes automation deterministic and the exceptional operation
reviewable. Restricting the preflight to local writers fixes the cited clobber defect without changing
the semantics of remote label administration. Preserving absent/non-GitHub origins avoids turning an
evidence-based mismatch guard into a Git-checkout requirement that would contradict documented
offline portability.

The parser correction is part of the guard rather than an unrelated cleanup: a comparison is only as
trustworthy as the identity extracted from origin. Exact host/path parsing also lets diagnostics name
only normalized identities and avoid echoing a possibly credential-bearing raw URL.

