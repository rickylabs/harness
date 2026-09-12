# Drift — `provider-uhp--e37`

Every deviation from the brief, the plan or doctrine, with a disposition. Empty sections are stated as
empty rather than omitted.

## D1 — The brief's premise about its dependencies was false when the run opened

**Stated:** "Both dependencies are merged: Spike S10 (route identity) and the S11 stream adapter are on
main, so packages/subagents already has uhp-wire.ts, uhp-stream.ts, uhp-lifecycle.ts, uhp-gate.ts,
uhp-session.ts and uhp-mock.ts."

**Observed at 14:41Z:** `gh pr view 295` reported `state: OPEN`, `mergedAt: null`; `git ls-tree
origin/main packages/subagents/src/` listed only `uhp-mock.ts` of the six. S10 was merged (`509cac3`);
S11 was not.

**Observed at 14:44Z:** #295 merged at `2026-09-12T14:38:10Z` as `73ed1a0`; `origin/main` advanced from
`e6c5ddc` to `e8ff35f` and carries all six.

**Disposition:** no drift in the end — the branch is taken from the post-merge `origin/main` and nothing
was stacked. Recorded because the two readings are four minutes apart and the run would otherwise look
as though the premise had simply been true. Had it not merged, the choice would have been between
stacking this PR on an unmerged branch (S11's own supervisor.md documents doing exactly that for S10) and
waiting; neither is what the brief asked for, and it would have been an owner question rather than a
silent pick.

## D2 — `observeUhpRoute` moved out of `uhp-mock.ts`

**Doctrine touched:** the mock is test support and no production entry point may import it — the standing
condition under which `scripts/check-compiled-policy.mjs` allows its literal `model` and `effort`
assignments.

**Deviation:** `provider-uhp` needs the conformant observation adapter, which lived in the mock.

**Disposition:** moved to `uhp-gate.ts` with its citations intact, re-exported from `uhp-mock.ts` so every
S10 and S11 importer is unchanged. This is the precedent S11 set when the wire types moved out of the same
file for the same reason. The alternative — a second observation adapter in production code — would have
been the duplication #286 forbids for the stream reader, the gate, the ledger and the mock, and the
argument against it is identical. `check:compiled-policy` stays green with no new allowlist entry.

Behaviour change, stated precisely: the three unreportable fields are now observed as `null` rather than
`undefined`. `compareRouteIdentity` renders both as `{ value: null }`, and a test compares the two inputs'
evidence directly rather than asserting the equivalence in a comment.

## D3 — `uhp-mock.ts` was extended with three endpoints

**Deviation:** the mock served `POST /v1/responses` only. The drift check reads `GET /v1/harnesses`,
`observe` reads `GET /v1/responses/{id}` and `stop` posts to `/v1/responses/{id}/cancel`.

**Disposition:** the endpoints were added to the existing server as optional handlers, keeping every
existing call site and test unchanged. Writing a second mock would have satisfied the letter of "do not
write a second mock" only by being a different file, and the failure mode it warns about — two mocks
drifting, with the drift in the one nobody is watching — would have been introduced anyway. An absent
endpoint still falls through to `404`, which is how a test says "this deployment does not answer that
call" without a second server.

## D4 — A test control that killed nothing on its first run

Recorded in full in `verification.md` §1.1, including the cause (a fixture-introduced second path to the
same green) and the two tests added as a result. Kept here as a pointer because a control that fires on
nothing is a finding about the suite, not a step in it.

## D5 — Surfaces this run did not touch, as declared

`packages/contracts` (one proposal in `worklog.md` §4, no edit), `packages/routing` (read only),
`packages/provider-codex` (read only), any container runtime (none exists here), any live HarnessRouter
(#294). No deviation.

## D6 — Stages not performed in sequence

This run was dispatched as an implementation brief against an issue that already carries its own
research, adversarial review and owner ruling — #286's body and three comments are the Stage B through
Stage H record, and PR #292 and #295 are the spikes it depends on. So there is no `research.md`,
`plan.md`, `adversarial-review.md` or `plan-eval.md` in this directory: producing a second copy of
decisions the issue already ratifies would put the same fact in two places, which doctrine names as a
future contradiction. `supervisor.md`, `worklog.md`, `verification.md`, this file and `context-pack.md`
are the artifacts this run owns.
