# Three gates — context

Implementation of issue 316 is complete and independently evaluated PASS. One branch/PR:
`fix/three-gates--316` against main, closes 316, part of 270. No merge or publication performed.

- Installed fixture refusals report INCONCLUSIVE/2, owned location and bounded execution reason.
- Workspace inventory inability is INCONCLUSIVE/2; invalid manifests/missing test declarations
  still FAIL/1. Explicit exemptions remain uncovered. Inaccessible manifests cannot silently vanish.
- Stage reports separate attempted/executed work, preserve native compiler failures, handle pnpm's
  ENOENT translation, and cannot pass an incomplete result set.
- 55 focused tests pass; 40/40 isolated mutants killed by targeted assertions. Full executable
  checkout typecheck/build/test exit 0; 108 installed observation fixtures pass. Real noexec
  installed and original-checkout typecheck controls exit 2.

Read implementation-eval.md for the independent Meta-family evaluation, verification.md for
provenance/limits, validation.json and supplemental-status.json for exact commands/status, and
raw *.txt files for complete output. The PR body contains verbatim command/assertion excerpts.
`validated-source-sha256.json` ties all scripts to the executable verification copy.
