# Plan — forge-cwd-guard--e10

## Summary

Add a deterministic preflight to `dsh-forge`'s three local-writer commands: `init`, `labels eject`,
and `skill install`. If the caller supplies `--repo` and the target `--cwd` has a parseable GitHub
origin naming a different repository, exit `2` before context resolution, transport probing, or any
write. `--force` explicitly accepts that mismatch. Preserve current behavior when repo is inferred,
origin is absent/non-GitHub, or the command does not write checkout files. Keep the tutorial's
warning and rewrite it to explain the guard and why explicit `--cwd` still directs output correctly.

**State: locked for independent Opus 5 review; product mutation remains blocked.** Stage G must
record `PASS` before implementation ([`doctrine/WORKFLOW.md:71-90`](../../../doctrine/WORKFLOW.md)).

## Decisions

### D1 — Key the guard on contradictory normalized identities

For a local-writer command, when `values.repo` is explicit, detect the target checkout's GitHub
origin and compare normalized `owner/name` values case-insensitively. A mismatch throws
`UsageError`, which returns exit `2`; a match proceeds. Perform this preflight before
`resolveContext`, because that function probes transport and may query GitHub before any command is
selected ([`packages/forge/src/cli.ts:247-290`](../../../packages/forge/src/cli.ts),
[`packages/forge/src/cli.ts:1571-1605`](../../../packages/forge/src/cli.ts)).

Rejected alternative: key on whether `--cwd` was explicitly written. An explicit wrong path remains
wrong, while an omitted path is safe when the process is already in the intended checkout. Identity,
not flag presence, is the safety property.

### D2 — Refuse noninteractively and use `--force` as the escape hatch

There is no prompt. On mismatch, print only the normalized requested and checkout repositories, name
the resolved cwd, advise correcting `--repo`/`--cwd`, and say `--force` accepts the mismatch. Never
echo the raw remote URL. `--force` already means the operator accepts overwrite/conflict risk, so its
help and package README will also name this checkout mismatch behavior
([`packages/forge/src/cli.ts:155-160`](../../../packages/forge/src/cli.ts),
[`packages/forge/README.md:87-97`](../../../packages/forge/README.md)).

Rejected alternatives: prompting makes CI behavior depend on a terminal; adding a second override
flag creates two permissions for the same local-overwrite boundary; returning drift exit `1` would
misclassify a bad invocation as repository content drift.

### D3 — Guard exactly the commands that write checkout files

Define the local-writer predicate after command normalization and before context resolution. It covers
`init`, `labels:eject`, and `skill`/`skill install`, including their `--dry-run` forms. It does not
cover `doctor`, label plan/check/apply, status, targets, swarm, or supervise. The first three can reach
`writeFile` or `installSkill`; `labels apply` mutates only the explicitly named GitHub repository
([`packages/forge/src/cli.ts:497-580`](../../../packages/forge/src/cli.ts),
[`packages/forge/src/cli.ts:442-495`](../../../packages/forge/src/cli.ts)).

Dry-run mismatch refusal is deliberate: it predicts admission for the corresponding write command.
`--force --dry-run` previews the exceptional operation while preserving the existing guarantee that
no file or transport mutation occurs ([`packages/forge/src/cli.test.ts:94-125`](../../../packages/forge/src/cli.test.ts)).

Rejected alternative: guard `init` only. Standalone eject and skill install reach the same two local
write surfaces and can cause the same checkout damage. Rejected alternative: guard `labels apply`.
That expands beyond the local-clobber defect and breaks valid remote administration without protecting
a checkout file.

### D4 — Treat absent or non-GitHub origin as unknown, not mismatch

If origin cannot yield a GitHub identity, proceed with explicit `--repo`. If `--repo` is omitted,
preserve the current `resolveContext` error when it cannot infer a target. This keeps offline
`labels eject` and `skill install` usable in portable/non-Git checkouts, as currently documented
([`packages/forge/README.md:72-83`](../../../packages/forge/README.md)), while refusing the exact case
where Forge has positive contradictory evidence.

Rejected alternative: require a GitHub origin for every local writer. That changes an identity guard
into a repository-shape requirement and contradicts the current portable offline promise.

### D5 — Parse GitHub remotes by URL grammar and exact identity

Extract a pure parser in `labels/github.ts` and route `detectRepoSlug` through it. Accept Git's scheme
URL forms when hostname is exactly `github.com` and the scp-like SSH form documented by Git. Require
exactly `owner/repo`, allow one terminal `.git` and trailing slash, reject query/fragment and extra or
empty path segments, and normalize only for comparison. Keep returned display slugs credential-free.
Git defines both scheme and scp-like grammars
([Git clone — Git URLs](https://git-scm.com/docs/git-clone#_git_urls)); GitHub documents the canonical
HTTPS and SSH forms ([GitHub Docs — About remote repositories](https://docs.github.com/en/get-started/git-basics/about-remote-repositories)).

Rejected alternative: reuse the current loose `github.com[/:]` regex. It can match a lookalike host
or consume malformed paths, so it cannot safely authorize writes
([`packages/forge/src/labels/github.ts:217-225`](../../../packages/forge/src/labels/github.ts)).

### D6 — Keep the warning and generated reference in sync

Rewrite tutorial step 2 to say the guard refuses an explicit `--repo` that conflicts with the GitHub
origin at `--cwd`, before any write; explain that explicit `--cwd ../scratch` still makes the target
obvious and is required by the walkthrough. Retain the separate warning against using harness as the
scratch repository because its dispatch label remains hazardous
([`docs/tutorials/01-from-clone-to-board.md:17-28`](../../../docs/tutorials/01-from-clone-to-board.md)).
Regenerate the Forge CLI reference from the binary after changing `--force` help; the build's
byte-comparison is the authority ([`scripts/cli-reference.mjs:85-117`](../../../scripts/cli-reference.mjs),
[`package.json:22-24`](../../../package.json)).

Rejected alternative: delete the tutorial hazard passage. The guard changes the failure mode and the
escape, while users still need to understand which checkout receives generated files.

## Owner forks

None. Issue #217 delegates the refusal/prompt/escape design to this run, and the compatibility boundary
is determined by current executable behavior and documented offline use rather than an unstated owner
preference ([issue #217](https://github.com/rickylabs/harness/issues/217),
[`packages/forge/README.md:72-83`](../../../packages/forge/README.md)).

## Spikes

None. The source identifies every local writer and the existing fake transport seam; Git and GitHub
document the remote syntaxes. The implementation gates below test the remaining behavior directly.

## Implementation manifest

1. In `packages/forge/src/labels/github.ts`, add/export a pure GitHub remote parser with exact-host,
   exact-path behavior and make `detectRepoSlug` use it.
2. In `packages/forge/src/cli.ts`, classify local-writer commands, run the explicit repo/origin
   mismatch preflight before `resolveContext`, bypass only with `--force`, and revise help text.
3. Extend tests using disposable `git init` fixtures with local `origin` configuration and the existing
   `CliOverrides.probeTransport` recorder. Do not invoke the production transport. Prove:
   - HTTPS, SSH/scp, and SSH URL equivalents match case-insensitively;
   - lookalike hosts, extra paths, local paths, absent origin, and non-GitHub origin do not become a
     GitHub identity;
   - mismatched `init`, eject, and skill install exit `2` before transport probe, file creation, or
     transport mutation;
   - each matching writer proceeds, absent/non-GitHub origin preserves portable behavior, and
     mismatch plus `--force` proceeds;
   - mismatched writer dry runs refuse, while `--force --dry-run` writes/sends nothing;
   - doctor, label plan/check, and label apply remain outside the checkout guard, with a positive
     control proving apply still reaches only the fake transport.
4. Update `packages/forge/README.md` and the tutorial warning, then run `pnpm run docs:cli` so the
   generated reference reflects CLI help.
5. Run focused Forge tests and typecheck, then the repository build (which includes generated reference
   comparison). Run the full test suite only if focused/build results or shared code changes justify it.
6. Record exact commands and results in the run artifacts and request independent GLM 5.3 Flash
   implementation evaluation. Do not push, merge, or mutate GitHub from this session.

## Dependency DAG

```text
independent Opus 5 review + Stage G PASS
                  |
                  v
       exact GitHub identity parser
                  |
                  v
    local-writer preflight before probe
             /             \
            v               v
 disposable Git fixtures   help/tutorial/README
            \               /
             v             v
        focused tests + typecheck
                  |
                  v
       generated reference + build
                  |
                  v
 independent implementation evaluation
```

## Risk register

| Risk | Likelihood | Impact | Gate |
| --- | --- | --- | --- |
| Equivalent HTTPS/SSH origins compare differently | Medium | High | Pure parser table plus CLI matching fixtures. |
| Lookalike/malformed origin authorizes a write | Low | High | Exact-host/path negative parser tests. |
| Guard runs after transport probe or first write | Medium | High | Probe counter and zero-file/zero-mutation assertions on all three writers. |
| Offline/non-Git workflows regress | Medium | Medium | Absent and non-GitHub origin writer tests. |
| Dry run and real invocation disagree about admission | Medium | Medium | Paired mismatch and `--force --dry-run` entrypoint tests. |
| Guard accidentally blocks remote-only apply | Low | High | Fake-transport positive control with mismatched local origin. |
| Raw credential-bearing origin leaks in diagnostics | Low | High | Capture output and assert normalized slugs only; include a user-info URL fixture. |
| Help/reference/tutorial drift | Medium | Medium | Generator plus repository build. |
| Existing temp CLI tests fail after fixture change | Medium | Medium | Initialize only the tests that require origin identity and preserve bare-directory controls. |

## Evaluation gate

Stage G may return `PASS` only if an independent reviewer confirms that the preflight is ordered before
transport construction, writer coverage is complete, URL parsing cannot authorize lookalike origins,
portable no-origin behavior is preserved, the dry-run/force contract is explicit, tests use only the
injected fake transport and disposable Git fixtures, and the tutorial still explains the hazard.

