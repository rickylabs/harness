# Verification — `provider-uhp--e37`

Issue [#286](https://github.com/rickylabs/harness/issues/286).

**The split this document exists for.** §2 is what the mock proved. §3 is what only a live
HarnessRouter can prove and therefore remains **unproven**. Nothing in §2 may be read as evidence for
anything in §3, and issue [#294](https://github.com/rickylabs/harness/issues/294) — the live
round-trip — is not advanced by a single line of this run.

Verdict on the buildable half: **PASS**, on the evidence in §2, subject to §3 and §5.

---

## 0. Gates

| Gate | Result |
|---|---|
| `pnpm run build` | green |
| `pnpm run test` | green — 3,118 tests across 12 packages, 0 fail |
| `packages/subagents` suite | 436 tests, 0 fail (344 before this run, 92 added) |
| `check:compiled-policy` | green; no new allowlist entry was needed |
| `check:publish` | green; `packages/contracts` unchanged, no proposal required |
| `check:installed` | `PASS` for both of its checks, with `TMPDIR` pointed at an executable directory |
| Container runtime | none started, none installed, none required |
| Credentials | none. `HARNESSROUTER_API_KEY` is unset on this host; no fixture contains a token |

`pnpm run test` ends in `check:installed`, which packs `@rickylabs/harness-contracts` and runs a
sleeping probe from a temporary directory. With the default `TMPDIR` on this host it fails at
`sleeping probe startup (requires executable TMPDIR)`; with `TMPDIR` pointed at an executable
directory both of its checks report `"status":"PASS"`. That is the same host property S11 recorded, it
is unrelated to anything in this run — the check touches only `packages/contracts` and
`packages/telemetry` — and the full green run was `TMPDIR=<executable dir> pnpm run test`.

---

## 1. The mutation campaign

`mutations.mjs` in this directory is runnable and its receipt is `mutations.json`. Each entry damages
one behaviour by an exact string replacement, runs the `@rickylabs/subagents` suite, records what died,
and restores the file. The suite is green before the first mutation and green after the last, both
asserted by the script rather than by this document.

Counts are node:test's own `fail` total, which here equals the number of individual tests that failed.

| # | File | What it breaks | Killed |
|---|---|---|---|
| M1 | `uhp-gate.ts` | absence checked before contradiction — the codex ladder, reintroduced | **13** |
| M2 | `uhp-provider.ts` | the F10 gate reads only the route comparison, missing a declared fallback | **3** |
| M3 | `uhp-provider.ts` | a server that ignored the pinned harness selection is no longer refused | **1** |
| M4 | `uhp-redact.ts` | `redactPaths` stops redacting | **5** |
| M5 | `uhp-provider.ts` (+M4) | the boundary fence over a published result is removed as well | **5** |
| M6 | `uhp-redact.ts` | published evidence reports every status as `unknown` | **5** |
| M7 | `uhp-redact.ts` | `cwd` values are published verbatim | **5** |
| M8 | `uhp-provider.ts` | console drift is detected and then ignored | **5** |
| M9 | `uhp-harnesses.ts` | an unreadable console listing is treated as agreement | **2** |
| M10 | `uhp-provider.ts` | a 404 from cancel becomes `already-over` instead of `unknown` | **1** |
| M11 | `uhp-provider.ts` | a task that was never sent is reported `unknown`, forbidding a safe retry | **1** |
| M12 | `uhp-transport.ts` | a credential may be passed where a profile name belongs | **1** |
| M13 | `uhp-gate.ts` | the route readers trust undefined-by-UHP extension keys | **4** |
| M14 | `uhp-lifecycle.ts` | a cancelled run is reported as failed | **5** |
| M15 | `uhp-provider.ts` | the pinned `harness_id` is left out of the payload | **1** |
| M16 | `uhp-provider.ts` | a steer is sent while the prior turn is open | **3** |
| M17 | `uhp-gate.ts` | the model observation is read from `metadata.requested_model` | **15** |
| M18 | `uhp-redact.ts` | overlapping path spans are skipped instead of merged, so a recognised shape is redacted in part | **1** |
| M19 | `uhp-redact.ts` | published evidence reports no route as verified — the transport-shaped branch #286 warns about | **1** |

Nineteen mutations, nineteen non-zero kills. The named tests are in `mutations.json`.

### 1.1 The control that initially killed nothing, and what was wrong with it

Both prior delegates on this program shipped a control that killed nothing on its first run. So did
this one, and the finding is more useful than the fix.

**The first version of M5** — disable the provider's boundary fence, with `redactPaths` already
disabled by M4 — killed only the three `uhp-redact.ts` unit tests. The test it was aimed at,
"publishes no path from any verb, on a run whose cwd is an absolute path", stayed green with redaction
off **and** the fence off.

The cause was in the setup, not in the assertion, exactly as #286 predicts. Over UHP a dispatch always
ends at `unknown`, and `describeRouteEvidence`'s `unknown` branch renders *field sources* and no field
*values* — `invalid observed provider (thread/start.result.modelProvider)` — so no `cwd` value ever
entered that diagnostic. The leak the requirement describes is on the `known` and `mismatch` branches,
and those are the two branches this transport cannot reach while S10's reading holds. The fixture
supplied a cwd, the provider held it, and it simply never appeared in the string being checked: a
second path to the same green, introduced by the fixture.

Two things came out of that:

- A new control, "redacts a path that arrives from the transport rather than from the route", using a
  path that genuinely does reach a published detail today: a socket error message in
  `UhpAnswer.cause`. M4 alone now kills it (the fence withholds the detail, so the assertion that the
  cause is still explained fails) and M4+M5 kills it on the path assertion itself.
- The `known` and `mismatch` branch leaks are covered where they are reachable — in
  `uhp-redact.test.ts`, against evidence built directly, with the unredacted form asserted dirty first
  so the redacted assertion cannot be vacuous.

The generalisation, for the next run: **a boundary control is only as good as the fixture's ability to
put the forbidden thing in the string being checked.** Asserting the absence of something the code
path never produces is indistinguishable from coverage until a mutation says otherwise.

### 1.2 The second one, found by reading the redactor rather than by a test

`redactPaths` collects a span per pattern match and the patterns overlap by design — `/a/b:/c/d` is a
POSIX match that stops at the colon *and* a drive-letter match that begins before it. The first version
skipped a span that started inside an earlier one, which can leave that span's tail in the output. The
fence catches most such tails, so the failure mode was a withheld diagnostic rather than a leak, but a
diagnostic lost to an off-by-one is still lost.

Spans are merged now. **M18 is the mutation that reverts the merge, and its first version killed
nothing** — because on the inputs the new test used, the POSIX pattern independently matched the tail, so
both implementations produced a path-free string. The fence-based assertion could not see the difference.

What separates them is a stronger property: **a recognised shape is redacted whole.** On `/a/b:/c` the
skipping version emits `<path redacted>:/c`, and `:/c` is a single segment — which the fence deliberately
ignores, because a fence that fires on every `/v1` is a fence somebody switches off. Asserting the exact
output rather than the absence of a finding is what makes M18 kill a test.

Same lesson as §1.1 from the other end: when a control does not fire, the assertion was usually asking a
weaker question than the behaviour answers.

---

## 2. What the mock proved

Every item is proven by a test in `packages/subagents/src/uhp-*.test.ts` against `uhp-mock.ts`, whose
shapes were written from the published specification. Several run over a real loopback socket on
`127.0.0.1:0`, which proves the code survives a socket; it does not make the peer a router.

### 2.1 The four verbs

- `dispatch` sends `POST /responses` with `background: true`, `stream: false`, `metadata.harness_id`
  from the pinned manifest, and `Idempotency-Key: <runId>`; the body carries protocol fields and
  nothing else.
- `observe` re-reads `GET /responses/{id}` and maps all five lifecycle statuses per #287:
  `in_progress`→`running`, `completed`→`finished`, `failed`→`failed`, `cancelled`→`finished`,
  `incomplete`→`failed`. `artifacts` is always empty — a UHP response's output is the agent's prose, and
  a fabricated branch or pull request url on a run record is worse than no list.
- `steer` continues the chain on `previous_response_id` and refuses locally while the prior turn is
  open, rather than trading a local refusal for a remote `409 session_busy`.
- `stop` cancels the recorded task and keeps `stopped`, `already-over` and `unknown` apart, including
  the case a downstream consumer asked for by name: a `404` or `session_expired` is `unknown` and never
  a synthesized terminal state.

### 2.2 Identity and the ledger

- Runs are keyed on `runId`; the UHP `session_id` is in `RunRef.external`, `null` until the server
  reports one.
- A second dispatch under one `runId` is refused.
- A response with no `metadata.session_id` is `unknown`, with the response id named in the detail as the
  only handle an operator has.
- A read-back that reports a different `session_id` is `unknown` rather than attributed.

### 2.3 F1 — console drift refuses, before anything is sent

Refused, with **zero** task requests observed by the mock, for: an absent pinned id, a changed `base`, a
changed or volunteered `defaultModel`, a listing that is not a harness listing, a listing that answers
`401`, and the checked-in unreconciled manifest against a populated console. A rename is not drift. The
`tasks.length === 0` assertion is what makes these fail-closed tests rather than wording tests.

### 2.4 F10 and the ratified strongest-negative rule

- A substituted model is `refused`. The codex ladder, transcribed and run on the same evidence, returns
  `unknown`; the status-keyed detector returns `false`. Both are asserted, so the distinction is the
  assertion rather than something adjacent to it.
- A declared `model_fallback` whose `model` field agrees with the request is `refused`, where a gate
  reading only `evidence.mismatches` — also transcribed and run on the same input — answers `unknown`.
- A `requested_model` naming a model this dispatch did not ask for is `refused`.
- `model` in `metadata.ignored_fields` is `refused`; the harness selector in `ignored_fields` is refused
  as a harness failure in its own right.
- `uhpRouteVerdict`'s signature is unchanged: no `status` parameter was added, and this provider never
  branches on `evidence.status`.

### 2.5 Three statuses, not two

`mismatch` does not serialise, render or compare equal to `unknown`: asserted on `status` after a JSON
round trip, on the diagnostic prose (`route mismatch` versus `route unknown`), and on `mismatches`,
which is the channel that carries a substitution over a transport where the status cannot.

### 2.6 The publication boundary

- Nothing returned by any verb carries a path, before or after serialisation, at any depth, under any
  key — checked by an independent finder rather than by the redactor.
- The same run's unredacted diagnostics **do** carry the working directory, so redaction costs no
  diagnostic. That pairing is asserted; without it the clean assertion would be vacuous.
- `redactRouteEvidence` preserves `status`, `mismatches` and `invalid` exactly, reduces `cwd` to
  presence, and regenerates the detail from the reduced values.
- `isRedactedRouteEvidence` refuses evidence that carries the marker without the work.
- `verifiedBeforeRedaction` carries the verification fact measured **before** `cwd` was reduced, because
  the predicate cannot be re-derived from a presence token. Asserted both ways on one verified route: the
  field says `true`, a consumer's re-derivation says `false`, and the two are asserted to differ. That is
  what keeps redaction from becoming the "provider is uhp, therefore unverified" branch #286 warns would
  silently never accept a `known` after S10 widens `RouteSource`.

### 2.7 Credentials

- `createUhpTransport` throws on a profile that is not an environment-variable name.
- The wire body contains neither the token nor the profile name; the bearer header is present on the
  same call, so the negative is not passing because nothing was sent.
- An unset profile means the call is never sent, which is `refused` and safe to retry; a sent and
  unanswered call is `unknown` and is not.

### 2.8 The readers S10 found empty

`readUhpProvider`, `readUhpEffort` and `readUhpCwd` are kept and return `null`, including on the
fixture that volunteers all three in `metadata` — agreement on a field the protocol does not define is
not evidence. `readUhpModel` reads `response.model` and never `metadata.requested_model`. The move of
`observeUhpRoute` out of `uhp-mock.ts` is proven behaviour-preserving by comparing its evidence with
the `undefined`-returning version it replaced.

---

## 3. What only a live HarnessRouter can prove — unproven

None of the following is claimed anywhere in this run.

1. **That a HarnessRouter answers any of these shapes.** Every byte came from `uhp-mock.ts`.
2. **That the pinned `chrn_` ids exist.** `config/harnesses.v1.json` has `reconciledAt: null`; its ids
   are placeholders and will refuse every dispatch until a console is read into it (#294).
3. **That `background: true` is honoured.** A server may ignore it and must then name it in
   `metadata.ignored_fields`; both shapes are handled, neither is observed.
4. **That `Idempotency-Key` prevents a double execution.** Tasks §6 requires it of a server advertising
   `idempotency`. Nothing here verifies a server does.
5. **That the cancel endpoint behaves as Sessions §4 specifies** — including the "responds within one
   second" SHOULD.
6. **That the three unobservable route fields are permanently unobservable.** That is S10's reading of
   the specification, owner-certified and not independently re-derived (PR #292, `status:impl-eval`).
   Everything here is correct whether the reading holds or not: the gates harden, and no reader was
   deleted.
7. **Any rate-limit, quota or usage behaviour.** That is S12 (#290).
8. **Anything about `GET /v1/uhp` capability discovery or version negotiation in practice.** The
   `UHP-Version` header is sent and the served version is reported when a server states one; no server
   has.

---

## 4. Scope discipline

| Surface | Disposition |
|---|---|
| `packages/contracts` | untouched. No breaking change was needed; one non-breaking proposal is recorded in `worklog.md` §4 and not implemented |
| `packages/routing` | read only (`config/routing.v1.json`, for the pinned-document convention) |
| `packages/provider-codex` | read only, as the ladder not to copy |
| Container runtime | not started, not installed |
| Live router | not contacted |
| Board | one PR, labelled per `.claude/skills/board-process/SKILL.md` |

---

## 5. Limitations of this document

It reports a suite and a mutation campaign run on one host at one commit. `mutations.mjs` is committed
so the numbers can be reproduced rather than believed; it rewrites source files in place and restores
them, so it must not be run on a dirty tree. The campaign covers the behaviours this issue names as
load-bearing; it is not a complete mutation analysis of the package, and a green campaign is evidence
about the mutations that were written, not about the ones that were not.
