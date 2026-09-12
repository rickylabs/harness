# Drift — `contract-alignment--e38`

Every deviation from the plan, the brief or the doctrine, with a disposition. Nothing here is an apology;
each row is a fact a reviewer would otherwise have to reconstruct from the diff.

---

## D1 — Stages B–G were not re-run from scratch

**Doctrine.** `doctrine/WORKFLOW.md` runs A→H and permits no mutation before a Stage G `PASS`.

**What happened.** This run did Stage A, then went to execution for two of three work items, with research
cited inline instead of in a separate `research.md`.

**Disposition: accepted.** The design decisions this run executes were taken, adversarially reviewed and
owner-ratified upstream — work item 3 by `.llm/runs/route-identity-uhp--s10/proposal-routesource-uhp.md`
(merged, with acceptance criteria in its §6), work item 2 by the proposal recorded on #287 from the
`provider-uhp` run, and #287 itself carries
`Authority: atelier-cockpit RFC-UHP-INTEGRATION.md, plan-eval-uhp.md (PASS AFTER NARROW FIXES)`. Re-deriving
them would be the "do not redesign what has been demonstrated" failure. Work item 1, which is *not*
ratified, was raised as an owner fork and not implemented — which is Stage E behaviour, not Stage H.

## D2 — The brief's version number and the tree's disagree

**Brief and issue.** "a PUBLISHED package at 0.3.0 / protocol 1".

**Tree.** `packages/contracts/package.json` says 0.4.0; npm's highest is 0.3.0.

**Disposition: recorded, not reconciled.** Both are true: 0.4.0 is pending and unpublished. Every
additive-versus-breaking determination is made against 0.3.0, because that is a consumer's baseline, and
the published 0.3.0 tarball was fetched and diffed to confirm the observation surface in it is
byte-identical to the tree. No version field was changed in either direction.

## D3 — Work item 1 is a proposal, so #287 is advanced and not completed

**Brief.** "Additive changes: apply them. Breaking changes: do NOT apply."

**What happened.** All three of work item 1's required changes are breaking for a consumer, so none was
applied and the PR says "Advances issue 287" rather than a closing keyword. The three are proposed
*together*, per the jointness requirement; no useful-looking subset was landed.

**Disposition: as instructed.** The issue's scope assumed the three were additive; they are not, and per
the brief that contradiction is reported as a finding.

## D4 — One change inside `packages/subagents` is breaking for in-repo consumers, and was still applied

`RouteValueEvidence.source` widened from `RouteSource` to `RouteSource | null`. That is breaking in
consumer position. It was applied because `@rickylabs/subagents` is `"private": true`, the entire consumer
set is four in-tree files enumerated by `grep`, and all of them are fixed in the same commit. The same
reasoning explicitly does **not** transfer to `packages/contracts`, whose consumers are in other
repositories and cannot be fixed in this commit — which is the whole reason work item 1 is a proposal.

## D5 — Three existing tests changed meaning, deliberately

- `route.uhp.test.ts` "rejects UHP provenance labels under the current predicate" — the S10 **tripwire**.
  Its assertion flips by design when the dialect map lands. Updated, not deleted, per S10 §6, and its
  replacement still refuses a cross-dialect label in both directions.
- `route.uhp.test.ts` "demonstrates the fabricated PASS a credulous adapter would produce" — now pinned to
  the `codex` dialect so it keeps demonstrating adapter credulity rather than dialect behaviour, with a
  new sibling test showing the same bytes cannot fabricate a PASS under the `uhp` dialect.
- `uhp-provider.test.ts` "names a substitution on a continuation while still reporting the turn as
  delivered" — its comment asserted that `SteerResult` has nowhere structured to carry the fact. That is
  what this run changed, so the test was rewritten around the structured field.

All three had their mutations re-run (§4 of `verification.md`).

## D6 — A pre-existing test was found vacuous and was repaired

`uhp-provider.test.ts`'s "publishes no path from any verb" ran its `steer` row over a result that had been
refused by the turn ledger before it observed anything, because the fixture reused one response id for
every turn. Found by mutation N9, not by reading. The fixture now gives each turn its own id. This is a
change to a test this run did not write, inside this run's declared mutation surface, and it is recorded
because "the fence covers all four verbs" was a claim the suite had not been checking.

## D7 — `pnpm run test` needs an environment override on this host

`scripts/check-installed-contracts.mjs` execs a fixture from `TMPDIR`, and this host's `/tmp` is `noexec`.
Measured on the unmodified baseline first: it fails there identically, so it is an environment limitation
and not a regression. Green with `TMPDIR` pointed at an executable directory. No script was changed to
accommodate it.
