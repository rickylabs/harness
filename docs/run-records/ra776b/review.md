# Final reconciliation review

Evaluator: Muse, cross-family implementation-evaluation route for issue #776.
Exact committed source: b6dda35e52c3474f5200f0a4e81bdd02985a5ded.
Worktree was clean at that hash before any doc edit. Verdict: PASS.

## What was verified against the committed head

- No unconditional bounded flag. `bounded` is `input.overflow || metadata.bounded`
  in the native projector and additionally ORs a narrowed dispatch set in the
  legacy collector. Default callers get empty `scan_limit` rows; only explicit
  `--partial-trees` retains the closed observed forest.
- Native execution overrides root execution only. Execution dispatches are
  stripped of transcript status and paired stops before projection, and the pure
  node projector's native-root branch touches liveness, ended-by, terminal
  outcome and end time alone. Capacity, budgets, activity, token usage, resource
  history and timelines are computed identically from measured metadata.
- Missing socket takes the previous path. The CLI delegates to the restored
  legacy collector, which shares the metadata reader and projector and keeps
  prior history bounds. A configured native source that fails reports
  unavailable with no execution fallback; the failure catch re-projects with
  empty dispatches so independent admission refusals and blocks survive.
- Record overflow is `scan_limit`, including admission-read notes. Launch blocks
  coexist with running assignments in the same issue row.
- Missing native signals stay tracked upstream: Herdr #5725, Orchid #135 and
  Orchid #136. Native-reads documents source ownership, bounds, the deploy
  order Orchid #133 then #134, Harness socket opt-in, and cockpit #951
  superseding closed #954 with unchanged public decoder contracts.
- Privacy and caps hold: opaque identities and digests throughout, leak gate
  clean on staged and committed diffs, largest new source file 323 lines, the
  duplicate test-only collector deleted with zero remaining references.

## Evidence relied on

- Root gates in runs/2026-10-31-ra776b/gates.json: install, typecheck, build,
  test and leaks all exit 0, with matching logs. Telemetry reports 808 pass,
  0 fail. Broad suites were not re-run by this review; no new finding required it.
- Revert control: the previous source selection compiles, fails both runtime
  controls, is restored byte-identical by hash, then passes both.
- Compatibility: the tagged 0.36 decoder build reads real producer frames for
  the complete, default-overflow and faceted controls; the explicitly opted-in
  bounded frame passes the current decoder and is rejected by the older one.
  The import seam is test-only and inert under normal gates.
- The earlier operator-naming failures were concurrent intentional behavior
  corrections for the restored fallback, confirmed by the corrected assertions
  in the committed head. No flakiness is claimed.

## Limitations

- Upstream Orchid #134 and cockpit #951 were reviewed only at their documented
  interfaces from this worktree, not re-verified in their own repositories.
- The 0.36 compatibility driver lives outside the repository in the run
  directory; only its receipts and the in-repo seam were inspected.
- PR body deploy notes and any board updates remain the author's action.

Signed off as supervisor for the committed head above. No source was mutated
by this review; only run-record docs were added.
