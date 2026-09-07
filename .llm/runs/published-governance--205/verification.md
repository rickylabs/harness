# Published governance read — verification

**Local required gates passed for implementation `e6c14d9`: 2,878 root tests, zero failures,
skips, cancellations or todos, plus the actual packed installed-consumer gate.** This is a local
verification receipt, not independent implementation evaluation, live acceptance or publication.
Implementation-session attribution: 2026-09-08 (task/run date; no exact wall-clock ordering claimed).

## Executed gates

`TMPDIR` was explicitly configured to an executable, owned scratch location for the final gates;
its operational value and raw logs are withheld from committed artifacts. The initial default-temp
failure is recorded below. Commands below otherwise give the executed repository command exactly.

| Command | Actual result |
| --- | --- |
| `pnpm --filter @rickylabs/harness-contracts test` | exit 0; 184 tests passed, 0 failed/skipped/cancelled/todo |
| `pnpm --filter @rickylabs/telemetry test` | exit 0; 431 tests passed, 0 failed/skipped/cancelled/todo |
| `pnpm run typecheck` | exit 0; root graph/lifecycle and all workspace typechecks |
| `pnpm run build` | exit 0; root checks and workspace builds; tutorial checker caveat below |
| `pnpm test` | exit 0; 2,878 tests passed, then installed-consumer hook passed |
| `pnpm run check:publish` | exit 0; contracts 0.2.0, protocol 1, 73 packed files, no tests |
| `pnpm run check:installed` | exit 0, independently of the root hook; receipt below |
| `pnpm run docs:cli` | exit 0; regenerated only dsh-telemetry reference (1 of 6 pages) |
| `pnpm run check:docs` | exit 0; 6 pages match built binaries |
| `git diff --check` and staged diff check | exit 0 before implementation commit |
| Independent temporary offline pack/archive scan | exit 0; 73 archive files, no excluded path/canary/token matches, no tests, no Node import in new decoder, no forbidden mutations |

Raw test/gate logs were held outside the tracked tree. Totals are extracted from each package's
Node test-runner summary, not inferred from exit 0. Empty stub packages supply no test totals.

| Package | Tests | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| `packages/board` | 272 | 272 | 0 | 0 |
| `packages/contracts` | 184 | 184 | 0 | 0 |
| `packages/coordinator` | 317 | 317 | 0 | 0 |
| `packages/dsh-app` | 332 | 332 | 0 | 0 |
| `packages/forge` | 513 | 513 | 0 | 0 |
| `packages/llm-local` | 95 | 95 | 0 | 0 |
| `packages/provider-claude` | 107 | 107 | 0 | 0 |
| `packages/provider-codex` | 44 | 44 | 0 | 0 |
| `packages/provider-opencode` | 151 | 151 | 0 | 0 |
| `packages/routing` | 205 | 205 | 0 | 0 |
| `packages/subagents` | 227 | 227 | 0 | 0 |
| `packages/telemetry` | 431 | 431 | 0 | 0 |

## Actual packed installed boundary

```json
{
  "check": "installed-governance",
  "status": "PASS",
  "version": "0.2.0",
  "protocol": 1,
  "tarball": "rickylabs-harness-contracts-0.2.0.tgz",
  "sha256": "cf3296949a8afbfabef7f6926d8ae732e831ec389453020c9fdd70bd07f27c1d",
  "exports": {
    "rootRuntime": true,
    "serverRuntime": true,
    "rootTypesCompiled": true,
    "serverTypesCompiled": true
  },
  "install": "npm install --offline --ignore-scripts --no-audit --no-fund <tarball>",
  "command": "node packages/telemetry/dist/cli.js governance --home <synthetic-home> --observations-from <synthetic-descriptor>",
  "fixtures": [
    "mixed-timeout",
    "all-unconfigured"
  ],
  "timeout": {
    "actualSleepingProbe": true,
    "terminatedAndReaped": true,
    "grandchildren": 0
  },
  "assertions": "version/protocol, root/server runtime and compiled declarations, source coverage, admission refusal and original stamps, memory readings, privacy, unavailable",
  "limitations": [
    "synthetic only; no live acceptance or downstream compatibility claim",
    "sleeping executable fixture requires POSIX shebang support and executable TMPDIR",
    "candidate only; no publication"
  ]
}
```

The tarball digest above matched both the root test-hook receipt and the separate final installed
check. A third offline pack was opened and scanned as an archive; its digest also matched:

```json
{
  "check": "public-artifact-and-scope-scan",
  "status": "PASS",
  "tarball": "rickylabs-harness-contracts-0.2.0.tgz",
  "sha256": "cf3296949a8afbfabef7f6926d8ae732e831ec389453020c9fdd70bd07f27c1d",
  "archiveFiles": 73,
  "excludedDataMatches": 0,
  "testArtifacts": 0,
  "forbiddenMutations": 0,
  "decoderNodeImports": 0,
  "limitations": "Targeted path/canary/token-pattern scan, not proof against all possible sensitive text."
}
```

The installed consumer compiled `consumer.ts` with NodeNext/strict checking, `skipLibCheck:false`,
`types:[]`, and ES2023/DOM libraries. It imported root `readGovernanceSnapshot`,
`GovernanceReadSnapshot`, `GovernanceReading`, `PROTOCOL_VERSION`, and server `openHub`, `Hub`,
`Delivery`. Negative `@ts-expect-error` assertions rejected non-snapshot/non-Hub arguments. Runtime
imports also used both actual installed export paths. Declarations were not merely checked for
existence; neither workspace source imports nor path aliases were used by this consumer.
[source: ../../../scripts/check-installed-contracts.mjs:88,91,100,118,154]

The actual commands were:

    node packages/telemetry/dist/cli.js record --home <synthetic-home>
    node packages/telemetry/dist/cli.js governance --home <synthetic-home> --observations-from <synthetic-descriptor>

The `record` command received synthetic JSONL on stdin. The descriptor and cgroup files were owned
temporary data: `memory.current=1024`, `memory.max=4096`, usage configured to a generated Node
executable sleeping for 60 seconds with a 500 ms probe timeout, spend unconfigured, admissions
configured to the synthetic log. The probe wrote its own PID to an owned temp file; after the CLI
returned, signal-0 inspection reported ESRCH, proving termination and reaping. The Node probe creates
no children or grandchildren. Credential canaries were generated at runtime and passed through env
only, never argv. The installed decoder verified the recorded refusal (item 7, subscription,
throttle, quota-paced, accepted false), original admission stamps, source-specific coverage and
provenance, memory values, and absence of path/credential/private-detail/model/env-name canaries.
The second invocation used an all-null descriptor and decoded not-configured/unavailable with exit 3.
[source: ../../../scripts/check-installed-contracts.mjs:120,141,144,150,158,175]

Seven committed fixtures cover mixed-timeout, all-unconfigured, stale, admissions-only, degraded-log,
conflicting-admissions and complete-without-admissions. Projection output is byte-locked for all
seven; actual fixed-clock CLI stdout is byte-locked for mixed-timeout and all-unconfigured. These
fixtures are synthetic and excluded from the tarball.
[source: ../../../packages/telemetry/src/governance/read.test.ts:34,44;
../../../packages/telemetry/src/cli.test.ts:982,1012;
../../../packages/contracts/src/governance-read.test.ts:13]

## Failures encountered and limits

- The first telemetry run was 424/425: the existing usage-diagnostic assertion expected only
  tree/status. The assertion was updated for the added governance command; final 431/431 includes
  the new CLI tests. This failure was not reported as a passing run.
- Initial installed checks reached real offline install and root/server declaration compilation,
  then failed at sleeping probe startup. Isolated reproduction showed EACCES on the default
  temporary filesystem. Final runs used an executable `TMPDIR`; there was no online install retry.
  The fixture requires POSIX shebang support and executable temporary storage, as documented in the
  telemetry README. The successful receipt is conditional on that supported environment.
- The build's tutorial checker actually re-ran 4 blocks and reported 3 declared untested blocks
  (live GitHub behavior, a synthetic contradiction and a second-machine store). Those three are
  unverified, not additional passing checks. No live GitHub exercise was attempted here.
- Public artifact scanning used exact operational-path, synthetic canary and common token patterns;
  zero matches is not proof against every possible sensitive string. No live allowances, private
  peer data, operator paths or credentials were deliberately copied into the committed files.
- JSON is the operational decoder boundary. Ordinary getters are refused without invocation;
  portable Proxy inspection may execute traps. Thrown traps are contained, but a trap that loops
  or allocates cannot be made bounded or side-effect-free by this portable decoder.
- Source capture time semantics and the existing admission reader's UTC normalization remain as
  shipped. The slice preserves their observations rather than inventing provider capture time.
  The existing log-reader input-size behavior is unchanged; output caps are enforced before JSON
  serialization, with no truncation of over-cap evidence.
- No independent implementation evaluation was dispatched. Live #205/#87 acceptance, downstream
  API/client compatibility, pending-approval census, binding windows, ceilings, GPU/dispatch-host
  capacity, policy state and reconnect #265 remain unverified or outside this slice.
- Contracts 0.2.0 is a candidate, **not published**. Owner-only tag/release and coordinator-owned
  independent review/PR/gates remain separate. No push, PR, merge, tag or board action occurred.

[source: executed commands and local sanitized receipts above; implementation e6c14d9;
../../../packages/contracts/README.md:291;
../../../packages/telemetry/README.md:565;
plan-eval.md:209,260]
