# Worklog — `observation-schema-2--e38`

Append-only. Timestamps are UTC on 2026-09-13 unless stated.

---

## Sequence

1. **Read the authority before mutating anything.** `gh issue view 300`, then `AGENTS.md` and
   `doctrine/WORKFLOW.md`, then the accepted proposal.
2. **The proposal is not on `main`.** The brief said to read
   `.llm/runs/contract-alignment--e38/proposal-observation-surface-uhp.md` "on main"; it is not there.
   `git ls-tree origin/main` finds no `contract-alignment--e38` directory. It lives on PR **299**,
   which is **open and unmerged** (`gh pr view 299 --json state` → `OPEN`), at commit `5025279` on
   `feat/287-contract-alignment-uhp`. Read from there. No dependency was created: PR 299 leaves
   `packages/contracts` byte-unchanged by its own statement, which `git diff` confirms, so branching
   from `origin/main` as instructed loses nothing. Recorded because a reader of this run would
   otherwise look for the file where the brief said it was.
3. **Branched `feat/300-observation-schema-2` from `origin/main` at `08d0be5`.**
4. **Measured the premise before writing a line of contract code.** Fetched and extracted the
   published 0.3.0 tarball, confirmed `src/repository-run-observation.ts` is byte-identical to the
   baseline, and ran the candidate shape through the published reader. `invalid` inside schema 1;
   `unsupported-schema, schema: 2, protocol: 1` at schema 2. The decision's premise holds, so
   implementation proceeded. Had it not, this would have stopped here as a blocking finding.
5. Implemented the three widenings, the schema bump, read-both with the schema-1 vocabulary enforced,
   the producer change, the tests, the fixture, and the documentation. Ran the gates.
6. Ran the mutation campaign; repaired two findings it produced; re-ran it.

---

## Drift and findings

### D1 — `check:installed` cannot pass on this host, and that was measured, not assumed

`pnpm run test` is `pnpm -r run test && pnpm run check:installed`. The second half fails:

    check:installed failed at sleeping probe startup (requires executable TMPDIR)

**Measured on the unmodified baseline first.** Committed the work as a WIP commit, ran
`git checkout origin/main -- packages/contracts packages/telemetry`, rebuilt the whole workspace, and
ran the gate: **identical message, identical exit code 1**. Restored the branch state and rebuilt.
So it is a host limitation in the gate's *governance* half — the synthetic sleeping executable it
spawns through the usage reader does not start here — and not a regression from this change. The same
limitation is recorded on PR 299 (`drift.md` D7).

The gate fails before reaching its run-observation half, which is the half this change actually
affects. Rather than declare that coverage blocked, the run-observation half was extracted into
`probe-installed-decoder.mjs` and run standalone: pack the real tarball, install it offline, compile a
real consumer against the installed declarations, and drive all 108 synthetic fixtures from the actual
CLI through the **installed** decoder. Green. What remains unproven on this host is the governance
half's sleeping-probe termination and reaping assertions, which this change does not touch.

Two incidental notes from the same investigation, so they are not rediscovered:

- Setting `TMPDIR` to a directory *inside* the repository makes `packages/forge` fail 3 tests, because
  its CLI fixtures `git init` inside what is then an enclosing repository. Those 3 failures are an
  artifact of that `TMPDIR` choice and vanish with the default. `packages/forge` is green: 513/513.
- `/tmp` on this host *is* executable, verified directly with an extensionless `#!<node>` script under
  a `{"type":"module"}` package boundary. So the gate's diagnostic names a plausible cause that is not
  the actual one here; the probe is not starting for some other reason inside the usage reader. Not
  investigated further, because it is out of this run's surface.

### D2 — the version target moved mid-run, from 0.4.0 to 0.5.0

The brief named 0.4.0 on the belief that the manifest read 0.3.0. It read **0.4.0**, unpublished since
`3e70d37`, held by the owner ruling on #283 of 2026-09-12. Mid-run the coordinator corrected the
target: the owner authorized that publication, the `harness-contracts-v0.4.0` tag was pushed against
`main` without this change in it, and 0.5.0 is the target. Verified independently from this host:
`npm view @rickylabs/harness-contracts versions` now lists `0.4.0` and `dist-tags.latest` is `0.4.0`,
where an hour earlier it listed three versions with `latest` at `0.3.0`.

`supervisor.md` was amended in place to record the correction with its authority, rather than rewritten
to look as though 0.4.0 was never the target. No commit had been pushed under 0.4.0; the only artifact
that had said 0.4.0 was `supervisor.md`'s mutation surface, and it now says 0.5.0 with the reason.

**Turned into an advantage:** published 0.4.0 is the version a consumer is actually pinned to when this
lands, so it is a better measurement target than 0.3.0. The probe was generalised to both and reports
both. Their observation surfaces are byte-identical, so the two tables agree exactly — which is itself
worth having measured rather than assumed.

### D3 — `check:snapshots` required a deliberate inventory entry, which is the gate working

The new schema-2 fixture carries `observedAt`, which `scripts/check-snapshots.mjs` treats as a
time-sliding key in any tracked data file. The gate has an exact path-and-digest inventory of reviewed
synthetic contract fixtures precisely so that an exemption is a review rather than a directory pattern.
`read-uhp.json` was added to it with its SHA-256, and `scripts/check-snapshots.test.mjs` was updated:
it copies both run fixtures into its scratch repository, expects 9 verified fixtures rather than 8, and
gained two tests asserting that the schema-2 fixture is inventoried on the same terms as the schema-1
one — missing or changed bytes fail loudly. Without those two, the new entry would have been the one
fixture in the inventory whose enforcement nothing checked.

### D4 — one anchor rename cascaded into a cross-package link

Retitling the contracts README section to name schema 2 broke
`packages/telemetry/README.md:670`'s anchor, caught by `check:links`. Updated. Noted because it is the
only file outside the declared mutation surface that this change had to touch, and it is a one-token
link fix rather than scope creep.

### D5 — two mutation findings, both repaired, both written up rather than quietly fixed

`verification.md` §9.1. In short: one mutant was caught by `noUnusedLocals` rather than by the suite
and was rewritten into two forms a reviewer could plausibly have written; and mutation **C5** killed
zero tests, exposing a pre-existing uncovered behaviour — a degraded coverage carrying exactly one of
`run` or `verification` was never tested, because every fixture nulled both in the same statement, so
either operand of the `||` answered. A test with a positive control and two single-field negatives was
added; C5 now kills.

### D6 — the coordinator asked for one comment-only addition outside this change's subject

`packages/contracts/src/runs.ts`'s `RUN_SOURCES` doc comment now records that a known consumer mirrors
that list in a database enum with no type-level link, that widening it requires notifying that consumer
before publication, and that the drift is silent because no compile error is possible across two
languages in two repositories. Comment only; `RUN_SOURCES` itself is untouched and this change does not
widen it. Added at the declaration so the obligation outlives the conversation that agreed it.

### D7 — staleness noticed and deliberately not touched

`docs/concepts/06-the-three-layers.md` says the published package is at 0.3.0. That became stale when
the 0.4.0 tag was pushed during this run, not from this change, and correcting it needs the 0.4.0
release receipt, which belongs to whoever cut the tag. Left alone and recorded. `packages/contracts/README.md`'s
"0.4.0 candidate" heading *was* corrected, because that file is this change's own subject and saying
0.4.0 "prepares … no wire shape changes" beside a schema-2 widening would have been actively wrong.

---

## Scope limits honoured

- `packages/routing` — untouched.
- `packages/subagents/config/harnesses.v1.json` — untouched, still `reconciledAt: null`, no ids invented.
- No container runtime started, installed or required. Every UHP shape from the published spec and `uhp-mock.ts`.
- No claim about a live `HarnessRouter` (#294, blocked).
- `RunSource` unchanged: still `claude | codex | opencode`, still the billing seam.
- No `npm publish`, no `npm version`, no tag, no release-workflow trigger armed.
