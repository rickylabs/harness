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

## Final token-extension review (separate)

Extension source: 4745909489faf1535a76d4e8ce773a9ea7922ec5, diffed against the
signed da8116c and reviewed file by file with the existing native proof.
Verdict: PASS.

- The native client extends its closed token list with exactly the two
  officially recorded tokens. Query validation still requires the exact
  `token-key` label; no response or public schema changes.
- The collector regex accepts exactly the six recorded forms. Only the two
  documented tokens map to their canonical vendor for seat, receipt and native
  identity matching; the query label itself stays exact throughout. The mapping
  is total over the accepted grammar, so the canonical cast cannot misfire, and
  every downstream identity check still runs against canonical Herdr and receipt
  data. Unknown labels remain refused; keys, bounds, duplicate and conflict
  handling are untouched.
- Interaction with the signed proof: the mapping feeds only the source
  derivation that the prior review already approved. Strictness, refusal paths,
  fallback behavior and decoder compatibility are preserved. The new real-socket
  controls show roots restored with canonical integration, running state,
  native final end and stable opaque assignment, with no native identity
  crossing the public boundary.
- Evidence: all five root gates exit 0 with telemetry at 810 pass and 0 fail.
  The token controls fail on the prior signed source and pass after the fix.
  The selection revert control re-ran on the new head with exact-byte restore,
  and the tagged 0.36 decoder controls re-passed with the opted-bounded
  negative intact. Leak and link checks on these docs are clean.

Limitations carry forward from above, plus: Orchid #134 stays separately
authored and reviewed with its own Go gates outside this review; the 808-count
receipts are historical evidence for b6dda35 only, superseded here by the 810
gate run for this head.
