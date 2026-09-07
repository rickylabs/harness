# Research — docs-public-boundaries--e10

## Summary

The remaining defects are documentation-boundary defects, not product-runtime defects. The package
declares Node 24, while the tutorial turns that declaration into a guaranteed pnpm failure below 24.
The tutorial is written entirely as a POSIX-shell walkthrough but states no platform boundary. Its
output-like fences mix locally reproducible transcripts with GitHub-dependent illustrations, and
fixed paths make machine-specific output look literal. Five currently tracked public files also
contain private consumer identity or feature details. All corrections fit in prose plus durable run
evidence; no new checker, engine policy, runtime behavior, or generated reference is required.

## Findings

### F1 — Node 24 is declared, but pnpm failure is not enforced

The root manifest declares pnpm 11.25.0 and `node >=24`
([`package.json:8-10`](../../../package.json)). The tutorial accurately lists Node 24 as a
prerequisite, then overstates the mechanism by saying a pnpm-install failure about Node necessarily
means the reader is below 24 ([`docs/tutorials/01-from-clone-to-board.md:14-14`](../../../docs/tutorials/01-from-clone-to-board.md),
[`docs/tutorials/01-from-clone-to-board.md:55-58`](../../../docs/tutorials/01-from-clone-to-board.md)).
Issue [#212](https://github.com/rickylabs/harness/issues/212) records the owner's historical
observation at commit `4ff50fe`: pnpm 11 on Node 22.20.0 warned about the engine and continued through
install, build, and test. That version-specific observation supports narrowing the prose; it is not a
general statement about pnpm, a new tested baseline, or a support promise. CI uses Node 24 on Ubuntu
([`.github/workflows/ci.yml:31-49`](../../../.github/workflows/ci.yml)).

### F2 — The tutorial has a POSIX shell boundary

The walkthrough uses `/tmp`, inline environment assignment, backslash continuations, and `printf`
pipes ([`docs/tutorials/01-from-clone-to-board.md:242-270`](../../../docs/tutorials/01-from-clone-to-board.md),
[`docs/tutorials/01-from-clone-to-board.md:303-350`](../../../docs/tutorials/01-from-clone-to-board.md)).
The tutorial index currently lists runtime/tool prerequisites but no shell or platform
([`docs/tutorials/README.md:9-14`](../../../docs/tutorials/README.md)). Issue
[#212](https://github.com/rickylabs/harness/issues/212) also records owner-run Windows verification
at commit `4ff50fe` for build/tests, the offline profile/telemetry path, and read-only forge doctor.
The write half of step 2 and step 3 were not run. This is versioned historical evidence, not evidence
that this POSIX tutorial works unchanged on every Windows shell or that every future release is
supported.

### F3 — Hand-written output has no automatic truth gate

The build invokes `check:docs` and `check:links`, but `check:docs` owns generated CLI reference pages
and `check:links` resolves links; neither compares tutorial output
([`package.json:16-23`](../../../package.json),
[`docs/concepts/05-determinism.md:87-102`](../../../docs/concepts/05-determinism.md)). The tutorial
contains source-derived GitHub examples at lines 216-231 and local output excerpts at lines 248-296
and 327-364, without a consistent visible label distinguishing illustration from execution
([`docs/tutorials/01-from-clone-to-board.md:216-231`](../../../docs/tutorials/01-from-clone-to-board.md),
[`docs/tutorials/01-from-clone-to-board.md:248-296`](../../../docs/tutorials/01-from-clone-to-board.md),
[`docs/tutorials/01-from-clone-to-board.md:327-364`](../../../docs/tutorials/01-from-clone-to-board.md)).
The tutorial already admits that its live GitHub readbacks were not executed by the author
([`docs/tutorials/01-from-clone-to-board.md:137-152`](../../../docs/tutorials/01-from-clone-to-board.md));
the same boundary should govern every output block.

The local profile and telemetry commands are suitable for execution receipts because both accept an
explicit home. Telemetry's own documentation demonstrates clearing all four telemetry override
variables before an isolated fixture command
([`packages/telemetry/README.md:169-179`](../../../packages/telemetry/README.md)); this is required
because those variables can redirect stores away from `--home`
([`packages/telemetry/src/cli.ts:123-128`](../../../packages/telemetry/src/cli.ts)). The seven
current-baseline local executions are recorded, with only paths normalized, in
[`local-example-receipts.md`](local-example-receipts.md).

### F4 — Private consumer details remain in five tracked public files

The current exact-name audit found private consumer identity or role details in the ratified-decision
entry point ([`AGENTS.md:101-107`](../../../AGENTS.md)), the public front door
([`README.md:253-259`](../../../README.md), [`README.md:312-322`](../../../README.md),
[`README.md:346-350`](../../../README.md)), the first concept page
([`docs/concepts/01-what-this-is.md:27-37`](../../../docs/concepts/01-what-this-is.md)), the bridge
package boundary ([`packages/netscript-bridge/README.md:24-30`](../../../packages/netscript-bridge/README.md),
[`packages/netscript-bridge/README.md:41-44`](../../../packages/netscript-bridge/README.md)), and one
historical implementation review
([`.llm/runs/m1-dsh-coordinator--orchestration/reviews/pr-190-glm.md:20-24`](../../m1-dsh-coordinator--orchestration/reviews/pr-190-glm.md)).
The public invariant that must survive redaction is narrower: this repository contains no consumer
UI, external consumers use the published contracts package, and the bridge remains a runtime adapter
rather than a build-time dependency.

### F5 — Three recent corrections are protected anchors

Tutorial step 2 now describes the checkout-identity guard and explicit `--cwd` behavior
([`docs/tutorials/01-from-clone-to-board.md:60-81`](../../../docs/tutorials/01-from-clone-to-board.md));
its `init` explanation distinguishes skipped transport from a refused label and the corresponding
exit codes ([`docs/tutorials/01-from-clone-to-board.md:116-167`](../../../docs/tutorials/01-from-clone-to-board.md)).
The root status and architecture text carries the board's anomaly/detail/fetch-coverage projection
([`README.md:142-153`](../../../README.md), [`README.md:270-279`](../../../README.md)). These are
outside the correction's semantics and must remain intact.

## Synthesis

The honest-boundary option is the smallest complete repair. It states what the repository declares,
what an owner observed historically, which shell the tutorial teaches, and which output was executed
at the current baseline. It avoids turning one historical Node or Windows run into a compatibility
contract. Unique temporary homes plus explicit normalization make receipts repeatable without
touching operator state. Generic provenance preserves the contracts boundary while removing facts a
public repository is not authorized to publish.
