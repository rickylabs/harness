# Worklog — `provider-uhp--e37`

Append-only. Issue [#286](https://github.com/rickylabs/harness/issues/286).

## Summary

`provider-uhp` is implemented in `@rickylabs/subagents` as four new modules plus a checked-in pinned
manifest, composing the five UHP modules S10 and S11 shipped rather than restating any of them. Build
and test are green (3,118 tests, 0 fail). Nineteen mutations were run against the suite and each killed
at least one test — but **two of them killed nothing on their first run**, and both are written up in
`verification.md` §1.1 and §1.2 because in each case the assertion was asking a weaker question than the
behaviour answers, and that is the reusable part.

Two owner questions stayed open and neither was resolved by a branch in the code. One contract
improvement was found and is recorded below as a proposal, not an edit.

---

## 1. What was built

    packages/subagents/config/harnesses.v1.json   the pinned chrn_ ids, provenance included
    packages/subagents/src/uhp-harnesses.ts       manifest parsing, console drift (F1)
    packages/subagents/src/uhp-transport.ts       the HTTP port; owns the credential
    packages/subagents/src/uhp-redact.ts          the publication boundary and its fence
    packages/subagents/src/uhp-provider.ts        the SubagentProvider
    + three test files, 92 tests

Extended, not duplicated:

- `uhp-gate.ts` gained `observeUhpRoute` and its four named readers, **moved** out of `uhp-mock.ts`.
  A production module may not import a mock: `scripts/check-compiled-policy.mjs` permits the literal
  `model` and `effort` assignments in `uhp-mock.ts` on the recorded grounds that no production entry
  point imports it, and that sentence has to keep being true. `uhp-mock.ts` re-exports them, so every
  S10 and S11 importer is unchanged. This is the precedent S11 set when the wire types moved out of the
  same file.
- `uhp-wire.ts` gained the harness object (Harnesses §2), the error envelope and code list (Errors §1,
  §3), the version constant and header (Lifecycle §1). Types and one reader; no behaviour.
- `uhp-mock.ts` gained three optional endpoints — the harness listing, cancel, and response read-back —
  on the existing server. A second mock would drift, and the one that drifts is always the one no test
  is looking at.

Nothing else in the package changed behaviour. The stream reader, the lifecycle table, the gate's
verdict function and the session ledger are used as they are.

## 2. The ratified rule, and how it is composed rather than reimplemented

The owner ruling of 2026-09-12 — report `refused` on model mismatch or contradiction, never `unknown` —
is satisfied by `uhpRouteVerdict`, which checks the contradicted set before the absence branch. This run
did not change that function and did not add a `status` parameter to it. Where a second source of
contradiction exists, the provider widens the **negatives** it passes in:

    contradicted = evidence.mismatches ∪ { model | metadata.model_fallback,
                                                   metadata.requested_model disagrees,
                                                   "model" ∈ metadata.ignored_fields }

and `uhpRouteVerdict` still decides. That keeps requirement C structural: the interface that cannot see a
status still cannot see one, and M1 (order swapped) kills 13 tests, M2 (drop the widening) kills 3.

The harness-selector case is refused separately rather than being forced into a route field, because
"the work ran on a harness nobody pinned" is not a statement about the route's four fields and a verdict
derived from route negatives cannot carry it.

## 3. Owner forks — raised, not taken

### F1 (inherited from #286, S11's fork restated) — may a lane with no route evidence proceed?

A conformant UHP response yields `unknown` because three of the four route fields are unreportable, so
`provider-uhp` never returns `accepted`. Whether a lane that requires no route evidence may proceed on
such a route is the owner's call. **Left at the fail-closed default.** The code contains no flag, option
or lane check that would let one side of this be switched on; adding one is the change this run
deliberately did not make.

Cost if the answer is eventually "yes": one gate call site and one option, plus tests. Cost if this run
had implemented it and the answer were "no": a provider that accepted unevidenced routes, shipped, with
the question no longer visible.

### F2 — should the verdict vocabulary separate "cannot name the run" from "cannot attest three fields"?

`unknown` currently carries both. Over UHP the run **is** nameable — `session_id` comes back and the
ledger keys on `runId` — and only the attestation is missing. This run makes the difference visible in
the *detail* of every `unknown` it returns (the unreported fields are named, and a response with no
session id says `session-unreported` and prints the response id), but it does not add a fourth verdict
word. **Left at the fail-closed default**, because widening `DispatchVerdict` changes the seam for four
other providers and is an owner decision about vocabulary, not an implementation detail.

### The fork this run declined to take by accident of being asked

The brief asks for `capabilities.steer: true`. Over UHP there is no way to inject a message into a
running turn — Lifecycle §5 refuses a second concurrent task in one session — so `steer` here is
turn-boundary continuation. The capability is advertised `true` because the call is implemented and does
deliver a message to the session; an in-flight turn is `refused` locally, never queued and never reported
`delivered`. That is documented on the method and in the README rather than resolved by advertising
`false`, which would make the provider unsteerable for a capability it does have.

## 4. Proposal, not an edit — `SteerResult` cannot carry route evidence

`DispatchResult` has a `route` field; `SteerResult` has `verdict` and `detail`. A continuation can carry
a model substitution exactly as a first turn can, and when it does, this provider reports `delivered`
(the message did land) and names the contradiction in the detail. The safety signal is therefore prose
on the steer path and structured data on the dispatch path.

The fix is a non-breaking optional `route?: RouteIdentityEvidence` on `SteerResult`, mirroring
`DispatchResult`. It is not in this run because `provider.ts` is the seam every provider implements and
the change belongs in a slice that updates the four of them together — and because #286 does not ask for
it. `packages/contracts` needs nothing either way; Decision 9 of #287 puts the stop verdict and budget
detail on the versioned observation resource rather than on `RunView`.

## 5. Timeline

- **14:40Z** Read #286 in full with its three comments, `AGENTS.md`, `doctrine/WORKFLOW.md`,
  `doctrine/PRINCIPLES.md`, and the `board-process` skill.
- **14:41Z** Found the brief's premise that both dependencies were merged to be false *at that moment*:
  PR #295 was `OPEN` with `mergedAt: null` and `origin/main` at `e6c5ddc` carried only `uhp-mock.ts`. Did
  not start work on the stale baseline.
- **14:44Z** Re-checked: #295 merged at `14:38:10Z` as `73ed1a0`, `origin/main` now `e8ff35f`. Branched
  from the post-merge `origin/main`, so no stacking was needed. Recorded in `supervisor.md` because a run
  started four minutes earlier would have had a materially different shape.
- **14:45Z–14:50Z** Read the five UHP modules, `provider.ts`, `route.ts`, `dispatch.ts`,
  `provider-codex/src/protocol.ts` (as the ladder not to copy), `dsh-app/src/dry-run-internal.ts` (as the
  pattern to follow), `routing/src/admit.ts` (credential-in-payload rule),
  `scripts/check-compiled-policy.mjs` (the literal-assignment fence).
- **14:50Z** Retrieved the UHP `2026-08-11` chapters and OpenAPI document directly, rather than relying on
  the prior runs' transcriptions: `harnesses`, `tasks`, `lifecycle`, `sessions`, `streaming`, `errors`,
  `security`, and `uhp-2026-08-11.openapi.yaml`. The harness object, the `chrn_` prefix, the cancel
  endpoints, the error envelope, `background`, and Streaming §5's "the stored response is the source of
  truth" all come from that reading.
- **15:00Z–15:40Z** Implementation, then the three test files.
- **15:40Z–16:10Z** The mutation campaign. Two mutations reported nothing on the first pass: one was a
  malformed mutation (a compile error, fixed), and one was a real gap — `verification.md` §1.1. Two tests
  were added as a result.
- **16:15Z** `pnpm run build` and `pnpm run test` green; `check:installed` green with an executable
  `TMPDIR`, which is the host property S11 already recorded. Committed, pushed, PR #297 opened, labels
  applied, and the issue's phase moved to `status:impl-eval` with its evidence comment.
- **16:35Z** Self-review of `redactPaths` found that overlapping path spans were skipped rather than
  merged, which can leave the tail of the second span in the output. Fixed, and M18 was added to the
  campaign to hold the fix. **M18's first version killed nothing** — see `verification.md` §1.2, which is
  the same lesson as §1.1 approached from the other end.
- **16:50Z** Second self-review finding, and the more consequential one: reducing `cwd` to presence makes
  `isRouteEvidenceVerified` unrecomputable from published evidence, so a consumer re-deriving it would get
  `false` forever — which is precisely the "provider is uhp, therefore unverified" branch #286 warns
  silently never accepts a `known` after S10 widens `RouteSource`. `PublishedRouteEvidence` now carries
  `verifiedBeforeRedaction`, measured before the reduction, with both halves asserted on one verified route
  and M19 holding it. Re-ran everything: 19 mutations, 19 non-zero kills; build and test green at 3,118
  tests.

## 6. Decisions taken inside the run, with the alternative rejected

1. **`dispatch` sends `background: true`, not `stream: true`.** Streaming holds the POST open for the
   whole agent run, so `dispatch` would not return until the work finished and `observe` would have
   nothing to observe. Tasks §1.1 defines `background` as "Return as soon as the task is accepted" and
   Streaming §5 says the stored response is the source of truth. The SSE path is still supported on the
   answer, through S11's reader, because a server may stream anyway.
2. **The manifest is data, parsed at the edge.** `createUhpProvider` takes a parsed `HarnessManifest`, so
   a composition root validates it at boot instead of discovering a bad pin at the first dispatch.
3. **The credential lives in the transport, not the provider.** The provider builds bodies; if it also
   held a token, every future edit to a body would be one line from putting a credential in a payload. It
   holds the profile *name* only, and a name is not a secret.
4. **A pre-flight failure is `refused`, not `unknown`.** `UhpAnswer.sent` is the discriminator: nothing
   left the process, so nothing launched, so a retry is safe — which is exactly what `isSafeToRetry`
   reads. Anything sent and unanswered is `unknown`, per Errors §5.
5. **Drift is checked over the whole manifest, not only the harness being dispatched.** #286 asks for a
   refusal on "any detected console drift", and the manifest is one artifact: a stale pin anywhere means
   the file is stale. The accepted cost is a real false positive — a `base` change on a harness a given
   dispatch does not use will refuse that dispatch. The alternative, checking only the pinned entry in
   use, is defensible and narrower; it was rejected because the failure it permits is a run executing
   under a configuration nobody declared, and because a per-harness check makes "the manifest is current"
   a property nothing ever asserts.
6. **The checked-in manifest ships unreconciled rather than not shipping.** #286 asks for a checked-in
   `harnesses.v1.json`; this host cannot read a console. So it ships with `reconciledAt: null`, obvious
   placeholder ids, and the ordinary drift mechanism refusing every dispatch through it. The alternative —
   inventing plausible-looking ids and a reconciliation date — would have been a fabricated claim about a
   server, which is the one thing this program's doctrine refuses outright.
