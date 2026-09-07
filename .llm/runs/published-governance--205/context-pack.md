# Published governance read — resume pack

**Implementation is committed at `e6c14d9`; local required gates passed. Independent implementation
review remains coordinator-owned and has not been dispatched by this session.** Contracts 0.2.0
remains an unpublished candidate, protocol 1. No live #205/#87 acceptance or #265 fix is claimed.
Implementation-session attribution: 2026-09-08, the supplied task/run date.

## Authority and identity

- Evaluated plan head: `01c523e894270700a8765d1bb0371cdaa7c0f1b8`.
- Receipt-only baseline: `89933b6`; [plan-eval.md](plan-eval.md) says PASS with BI-1–BI-10 binding.
- [coordinator-amendment.md](coordinator-amendment.md) governs the historical [plan.md](plan.md).
- [implementation-identity.json](implementation-identity.json): actual native `gpt-6-astra` /
  `openai` / `low`, matched before the initial turn; coordinator supplied after the initial stop.
- Original [matrix-implementation.json](matrix-implementation.json) and fresh resumed
  [matrix-implementation-resume.json](matrix-implementation-resume.json) retained. No agents/evaluators.

## What exists

`dsh-telemetry governance --observations-from <absolute-descriptor-path>` produces one versioned
JSON document on exits 0/3. Public installed `readGovernanceSnapshot` decodes strict coverage,
envelope/state and recorded refusals. No transcript backfill, board snapshot or transport service.
Existing status/tree public displays and protocol/RemoteSnapshot/fold/hub/client/dsh-app remain
unchanged. Mutation inventory was honored without type/dependency-file expansion.
[source: ../../../packages/telemetry/src/cli.ts:479;
../../../packages/contracts/src/governance-read.ts:413;
implementation.md (binding map)]

Read [implementation.md](implementation.md) for the binding map and [verification.md](verification.md)
for actual results: contracts 184, telemetry 431, root 2,878 tests all passing, plus actual offline
packed installation, root/server runtime imports and compiled declarations, CLI synthetic fixture,
probe kill/reap proof, publish/docs/typecheck/build/diff and targeted public-artifact scan.
Tarball `rickylabs-harness-contracts-0.2.0.tgz` SHA-256:
`cf3296949a8afbfabef7f6926d8ae732e831ec389453020c9fdd70bd07f27c1d`.

## Re-run and remaining limits

Use an executable `TMPDIR` on this host for `pnpm test` and `pnpm run check:installed`; the default
temp filesystem rejected probe execution. The fixture requires POSIX shebang support. This is an
explicit environment requirement, with no network install fallback. Raw logs/scratch are outside
the tracked tree; committed evidence contains no operational scratch paths or credential values.

The installed check proves the synthetic producer-to-installed-package boundary only. Independent
implementation evaluation, live governance acceptance and downstream consumer compatibility have no
PASS receipt here. The build tutorial checker reports three declared untested blocks. Portable Proxy
inspection limits and inherited log input-size behavior are documented; approval census, policy,
GPU/dispatch-host capacity, windows/ceilings and reconnect #265 remain outside the claim.

Coordinator performs independent review and subsequent gates/PR. Owner alone tags/publishes after
merge. This implementation session performed no push, PR, merge, tag, board or publication action.
