# Drift — `provider-uhp-relax--e37`

Deviations from the declared plan or surface, each with a disposition. Nothing here is edited in place.

## D1 — `packages/subagents/src/uhp-mock.ts` was written, and it was not in the declared surface

**What.** `UhpReply` gained a `stream?: boolean` switch, and the mock honours it, so a test can make the
server answer with an event stream at a client that asked for `stream: false`.

**Why.** Finding §1.1 in `verification.md`: a pre-existing test named after the stream-refusal path had
never reached it, because the mock streamed only when the request asked and this provider never asks. The
alternative to extending the mock was to leave a false green in the suite, which is worse than a surface
deviation. The shape is conformant — Tasks §1.1 lets a server decline to act on a request field provided it
names the field in `metadata.ignored_fields`.

**Disposition.** Accepted. Test-only file in the same package, additive and optional; no production module
imports it (`scripts/check-compiled-policy.mjs` depends on that and still passes).

## D2 — one behaviour was removed rather than added

The provider's `unattested` list is **not** widened by `stated.fields`, though the first draft widened it
alongside `contradicted`. Every stated field is already in `contradicted` and a contradiction decides
first, so the widening could not change an outcome. Removed with a comment, because unreachable code that
reads like a safeguard gets maintained as one. See `worklog.md` §4.

**Disposition.** Accepted, and deliberately not mutation-tested: a mutation of provably dead code kills
nothing by construction, and reporting that as coverage would be the false green this run is written
against.

## D3 — an assertion and a fixture were changed, not just added

Several existing assertions asserted `unknown` for a conformant dispatch. They were correct before the
owner risk ruling and are wrong after it, so they now assert `accepted`. Named, so a reviewer can check each
one is a consequence of the ruling rather than a test bent to fit an implementation:

- `uhp-provider.test.ts` — "a conformant response …" (rewritten and split in two), the paired control in
  "refuses a declared fallback even when the model field happens to agree", the first dispatch in "refuses a
  second dispatch under one run id", the paired control in "refuses when the credential is revoked …", and
  the stream test (D1).
- `uhp-gate.test.ts` — "separates a contradicted route from a silent one", "shows why the weak assertions
  everyone writes are not coverage", "derives the verdict from negatives …", "carries the status as an
  explanation …", "accepts only a route where every field was reported and agreed" (now "grades a complete
  route apart from an unattested one"), and "refuses the extension-field fixtures …" (now "lets the
  extension-field fixtures move nothing at all", asserting the whole decision equals the conformant one,
  which is a stronger statement of the same property).

**Disposition.** Accepted. Every one of them now asserts a distinction rather than a superset, and each is
covered by a mutation in §2 of `verification.md`.

## D4 — `pnpm run test` needs a `TMPDIR` this host does not provide by default

Not caused by this change and not fixed by it: `check:installed` needs an exec-capable `TMPDIR` outside the
repository. Recorded in `verification.md` §0 with the command that makes it pass, because the next person to
run the gate here will otherwise read an environment limitation as a red build.
