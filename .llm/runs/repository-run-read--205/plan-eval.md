# Plan evaluation round 3 — v2 plus governing consumer amendment v3 (plan-only)

Verdict: **PASS**

Summary: `plan.md` plus governing `scope-amendment.md` (which overrides v2
where specified) closes the round-2 residual set: source-scope collision identity
(tuple, issuer namespaces), revision/rebinding semantics, assertion-vs-verification
split with its own clock, and explicit descriptor/worktree race handling. Scope is
unchanged and minimal; ownership unchanged (harness: source/repository binding evidence
and reader semantics; backend: enrollment, authorization, revocation, API). Earlier
verdicts preserved: round 1 `FAIL_FIX` (`plan-eval.md`), round 2 `PASS`
(`plan-eval-round2.md`). One narrow in-flight binding repair (R1, identifier charset)
is locked below; it needs no re-review. All gates/fixtures remain proposed, NOT RUN —
this PASS authorizes implementation only and certifies no test, fixture, or real receipt.

## C1–C7 disposition

- C1 collision identity — LOCKED. Native identity is the tuple
  (namespace, sourceScopeId, source, nativeId), never bare nativeId; observation belongs
  to (namespace, binding.id, binding.revision). Namespace separates enrollment
  authorities; sourceScopeId separates native stores; neither derived from paths or
  prose. Binding root now exact
  {namespace,id,revision,sourceScopeId,repo:{owner,name}}. Stability rules explicit
  (binding id stable per association; sourceScopeId stable per store, never reused).
  Uniqueness honestly placed: issuer obligation + backend enrollment enforcement;
  producer cannot detect cross-instance duplicates; equality-only, case-sensitive, no
  ordering. Two stores with identical run IDs stay distinct. Resolved, subject to R1.
- C2 revisions — LOCKED. Issuer mints a never-reused revision on any RepoRef, selected
  run, sourceScopeId, source root/path, worktree, common-directory, or scope change.
  File append/growth does not rotate revision (but can force incomplete). Rebinding to a
  different store requires a new sourceScopeId. Same-path replacement is unusable
  in-read; later reads re-prove identity/scope and never claim inode continuity.
  Receiver atomically compares namespace/id/revision + sourceScopeId before persistence
  and protected delivery; delayed-A cannot be relabeled B; old observations retained
  only under original binding per explicit backend policy, never silently reassigned.
  Producer supplies snapshot identity only, never checks remote principal state.
  Consistent with v2 F3 (no producer monotonicity/revocation/stale-rejection); the
  strictness lives issuer-side and receiver-side where it belongs. Resolved.
- C3 assertion vs verification — LOCKED. Enrollment asserts the RepoRef→worktree
  association; Git identity and native cwd are locally checked facts, not durable
  history or cryptographic provenance. New root `verification`
  (null | {basis: enrollment-and-local-worktree, verifiedAt}) is nonnull exactly when
  coverage is `read` (run nonnull), else null — so the extended root key set is
  schema, protocol, binding, capturedAt, coverage, verification, run, and the strict
  unknown-key decoder accepts exactly that. `verifiedAt` (end-of-validation) ≤
  `capturedAt` (collection completion); both canonical dates; neither refreshes native
  evidence; no invented time on unread arms. Conservative outage rule (new observation
  gets verification:null; older verified reads are not invalidated by it) is the safe
  direction. Resolved.
- C4 races — LOCKED. Snapshot descriptor bytes + opened identity before verification;
  snapshot canonical root/worktree/common-directory identities and Git results; bounded
  read with before/after opened+path identity; pre-serialization descriptor re-read
  (bytes + identity), recanonicalization, repeated Git checks under a sanitized
  environment (path-redirecting `GIT_*` cleared — closes the round-2 `GIT_DIR` /
  `GIT_WORK_TREE` residual). Mid-read descriptor change → `incomplete/binding-changed`
  carrying the ORIGINAL validated snapshot binding, run null, verification null;
  root/worktree/common-directory/Git association change → same; file growth/replacement
  alone → `source-changed`. Final-check failure never yields payload.
  `binding-changed` is explicitly added to the incomplete union (unknown future reasons
  still decoder-rejected) and rides the incomplete arm → exit 3, consistent with the
  exit convention at `packages/telemetry/src/cli.ts:133`. ABA/reversion and hostile
  filesystem immunity explicitly disclaimed; trusted-enrolled-local-storage assumption
  stays explicit; backend fencing still required. Deterministic pause-at-checkpoint test
  seams (no sleeps) keep the race gates runnable (doctrine Principle 6). Resolved.
- C5 classification/retention — LOCKED. Typed reasons (never notes) separate
  missing/unreadable/too-large from scope/identity errors from `binding-changed`;
  invalid descriptor stays exit-1 fixed-diagnostic with no document; principal
  denial/expiry is never a producer output; backend owns denial and pre-delivery grant
  checks. A fresh unverified read cannot refresh evidence, extend authorization, or
  mint binding ownership; stale retention is under original times and backend policy;
  revocation overrides. No offline-instant-revocation or client-cache policy authored —
  correctly withheld. Resolved.
- C6 tail/evidence — LOCKED. Whole-run withhold on malformed tail reaffirmed (tail can
  hide identity/scope change); no partial payload; prior-verified retention during loss
  is backend-owned and distinct. first/lastObservedAt are envelope evidence times, not
  launch/end. Token fields are cumulative source-reported COUNTS, never summed, missing
  never zero; cost/quota absent. One selected run; explicitly not a census, decision
  basis, all-clear, or liveness certificate. Resolved.
- C7 gates — proposed, NOT RUN, correctly bounded. A/B same-native-ID decoding to
  distinct tuples; mixed-alias withhold; paused-read descriptor/root/worktree swaps →
  `binding-changed`; replacement → `source-changed`; missing-vs-scope
  distinguishability; A-start/B-enroll/A-complete carrier fixture explicitly scoped to
  carrier semantics with backend atomic-fence testing assigned to the backend;
  verification-clock separation; collision/replay negatives. Extends the actual-CLI →
  exact-packed-installed-decoder matrix; real read stays private and outside
  repositories; no draft adoption, invented endpoint, or released-schema naming.
  Nothing here certifies an unexecuted test. Resolved as a gate list, not as results.

## In-flight binding repair R1 (locked, no re-review)

R1 — identifier charset/cap, single rule for every identifier field (namespace,
binding id, binding revision, sourceScopeId, nativeId): must satisfy the existing
decoder identifier syntax at `packages/contracts/src/governance-read.ts:65`
(`^[A-Za-z0-9][A-Za-z0-9._:-]*$`) with the cap at
`packages/contracts/src/governance-read.ts:67` (128), validated as in
`packages/contracts/src/governance-read.ts:117-121`. Rationale: v2 F1 admits
slash-inclusive 1..200 strings while v3 C1 mandates "existing bounded identifier
syntax" for new IDs, and v2 F6 leaves nativeId's bound to "valid bounded
identifiers" — a decoder cannot implement two charsets. Slash is excluded everywhere;
an identifier failing the rule is `identity-mismatch` (never salvaged, never
truncated-to-fit). Safe direction: observed Codex session IDs are UUID-shaped and
satisfy the rule; anything exotic withholds rather than leaks. Implementer applies R1
as stated; backend issuer documentation inherits the same charset.

## Adversarial sweep (no further blocker)

- Cross-store collision: tuple identity + per-store sourceScopeId + single-identity
  gate (v2 F6 survives) + no-partial-payload + receiver atomic fence. A payload is
  never persisted/delivered under a binding it was not observed under.
- Replay/relabel: delayed-A-under-B barred at both layers (producer emits only its
  snapshot identity; receiver fences on current enrollment). Stale retention only
  under original binding.
- Race ABA: disclaimed, fenced by backend current-binding comparison; any detected
  change withholds. Residual post-final-check mutation is a later observation by
  construction.
- Clock games: `verifiedAt`/`capturedAt` are local, ordered, and refresh nothing;
  source times keep per-field observation semantics (v2 F2 survives); no freshness or
  liveness claim exists to game.
- Privacy: v2 F7 survives untouched; verification basis string is a fixed enum-like
  constant, contributing no source-derived text.
- Scope inflation: no mux, no auth service, no snapshot synthesis, no second fold, no
  governance grafting, no provider process/live command/network, no multi-vendor
  expansion, no backend OpenAPI/client claim, no release claim (candidate 0.3.0 /
  protocol 1 remains a later authorized step; release-`5766675` vs inspected-`e924b34`
  product equality still must be verified before implementation per v2 §29).

## Gates (proposed, NOT RUN, not certified)

C7 matrix plus the round-2 matrix (every coverage arm incl. `binding-changed`,
incompatible schemas, unknown keys/union mismatch, nonfinite counts, impossible
dates, distinct source/worktree roots, identity/cwd/tail/missing/oversize/replacement
cases, independent per-field timestamps, terminal-then-start reset, revision echo,
repeat-read source-time preservation), actual source-pinned CLI through the exact
packed offline installed root decoder/types with `/server` compatibility and privacy
assertions, then a privately authorized real selected run outside every repository.
No backend compatibility inferred at any step.
