# Worklog (ra776c)

## Slice a: restart-test root by ancestry

`a paired historical stop cannot end a resumed native working assignment` read `agents[0]` from
both the previous and the native producer; agents sort by opaque id, so the running child came
first in a share of runs. Both reads now select `parentAgentId === null`.

Control, serial, same machine, `--test-name-pattern` on the single test:
- before (head `b82bbb835`): 20 of 30 runs failed;
- after: 0 of 30 runs failed.

## Slice b: uncovered issues are incomplete, with a named reason

Orchid's keyed `run.lookup` cannot enumerate a run with no workspace label, so no native issue row
can certify its active set until Orchid #135. Every native issue row is now
`complete:false, reason:binding_unavailable`; an issue named only by a run skipped for a duplicated
receipt, a conflicting seat or a receipt identity mismatch is listed instead of dropped; an
issue-level refusal stays on the incomplete row. Contracts 0.42.0 lets an incomplete
`binding_unavailable` row carry its verified forest (`ISSUE_PARTIAL_FOREST_REASONS`); telemetry
emits it only under `--partial-trees`, so default frames stay decodable by 0.41 and older readers.

Red-then-green control: only the five source files (contracts decoder and manifest, feed builder,
native collector and projection) were reverted to `b82bbb835` with the new tests kept. Both
packages compiled; 6 of 24 restart tests and the 0.42 contract test failed at runtime. After
restoring, `sha256sum -c` matched all five files byte for byte and 24/24 and 31/31 passed.
Older-reader control: the decoders at tags `harness-contracts-v0.36.0` and `v0.40.0` were built
from `git archive` in a temporary directory and passed as `HARNESS_ISSUE_TREE_READER_CONTROL`.
Through 0.36: 24/24. Through 0.40: 23/24; both accept every default frame and both reject the
opted-in uncovered forest. The one failure is the existing overflow test, whose control branch
assumes a 0.36 reader rejects an opted `scan_limit` forest; 0.37+ accepts it by design.

Doctrine rule 4: the touched contract decoder (810 lines), its test (558) and the guide (503)
were split; no public export changed (`index.ts` re-exports the same module).

## Slice c: review follow-ups

See `review.md`: identity-mismatch regression (mutation-checked), contract-owned repo validation
for unattached rows, hidden-run test comment, final newline. Restart suite 25/25.

## Gates

The host has npm 12.1.0, whose `npm pack --json` is an object keyed by package name rather than an
array; with it `check:publish` is inconclusive (exit 2) and routing's pack test fails, independent
of this change. The session TMPDIR is mounted noexec, so routing's fake-CLI tests fail
there. Gates were therefore run with npm 11.21.1 first on PATH and an exec-capable TMPDIR; the
results are in the PR body.

Final head gates: frozen install 0; typecheck 0 (5 stages); build 0 (15 stages, contracts 0.42.0
publish check ok); test 0 (8 stages; contracts 421, telemetry 813, routing 635, all 0 fail);
`check:leaks` 0 after removing a host path from this worklog. Item 1 re-proved on the final head:
0 of 30 serial runs failed.
