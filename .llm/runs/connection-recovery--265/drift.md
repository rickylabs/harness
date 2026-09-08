# Drift — connection recovery 265

No recovery design or product mutation-surface expansion. One existing verification mismatch and
one local probe correction are recorded; neither alters the preserved Stage G decision.

1. **Existing installed gate pins 0.3.0.** The approved resume requires a 0.4.0 candidate, but
   `scripts/check-installed-contracts.mjs:74` and `:90` assert 0.3.0. The requested unmodified root
   test command was executed and failed after all package tests passed. Repository script and
   producer source remain untouched. Disposition: retain FAIL; run an explicitly supplemental
   temporary gate copy with only version assertions and relocation substitutions, documented in
   `installed-candidate-check.mjs:17`. It passes all 108+2 synthetic installed fixtures against
   0.4.0. Coordinator owns repository-gate disposition before exact-head CI; this worker does not
   claim the supplemental run repairs `pnpm run test`. Evidence: `final-gates.json:1`,
   `installed-candidate-receipt.json:1`.
2. **Local probe scan correction.** First custom pack probe incorrectly applied its Node-import
   regex to README's release-command `require(...)`. Limited that specific scan to JS/TS while
   preserving all-file operational-path scanning, then reran successfully. No product behavior
   changed for this correction. Exact final source and results: `packed-recovery.mjs:1`,
   `packed-recovery-receipt.json:1`.

3. **Coordinator gate maintenance arrived during worker verification.** The coordinator supplied
   `coordinator-gate-amendment.md:1` and changed the two version checks to compare source manifest,
   pack metadata and installed manifest. This worker did not author that edit. The original FAIL
   stays in `final-gates.json`; the full maintained `pnpm run test` was then rerun by this worker
   and passed, including all installed fixtures (`amended-gates.json:1`). No producer change or
   protocol/fixture reduction. The supplemental temporary copy remains historical evidence.
