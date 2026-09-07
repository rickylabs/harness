# dry-run-driver--e6c — superseding plan draft

# plan.md — E6.C (#253): drive a dispatch through the durable store against fakes, no live effect

**Supersedes** the previous draft in full. **Date:** 2026-09-07. **Author:** independent plan author (native Claude Code opus-5 medium, owner matrix override). Planning only; nothing here was executed and no evidence below was gathered by running anything. Citations are to the supplied bundle, except where marked *review-supplied*, which are facts asserted by the coordinator source review of 2026-09-07 that this bundle does not contain.

---

## Summary

The effect driver lives at the **`dsh-app` composition root**; `@rickylabs/coordinator` gains only a pure, evidence-revalidating helper. Ordering is the substance of this slice: canonical workflow → reconstructed state through the real `settle` → routing admission → **route identity check** → only then assembly, intent, and a single discrete fake attempt. Anything that fails before the attempt produces a named refusal and **zero store entries**. A definite pre-send refusal by the fake settles negative. An attempt that throws, or returns unknown or malformed, writes **no receipt** and leaves the intent pending, so recovery yields terminal `unknown`.

No new owner forks. The live half of C is a separate issue that may only be filed once #62 lands.

---

## Parent DAG and inherited scope

    #191 step C  ──(this slice: dry-run/fakes half)──> #253
      needs A+B, landed in #247 (fa0456c): store port, fs adapter,
      intents/receipts beside PersistedDecision, pure recovery reducer
      [journal.ts:222-244, state-store.ts:114-156, contracts/state-store.ts:1-129 · store · 2026-09-07]
    #195  ──> checked route, fail closed                [subagents/route.ts:142-192 · route · 2026-09-07]
    #61/#34 ──> admitDispatch, the matrix               [routing/admit.ts:493-520 · admission · 2026-09-07]
    #203  ──> citation parser                           [citation.ts:74-97 · citations · 2026-09-07]
    #62   ──> execution channel — NOT this slice. Live C is filed only after #62 lands.
    step E (transport/hub), step F (restart proof/runbook), #191 F1 (production storage): excluded.

---

## Decisions

**D1 — The driver is composition, not coordinator.**
`#191` ownership, retrieved 2026-09-07 (*review-supplied*), places pure decision functions in `coordinator` and the **effect driver at the `dsh-app` composition root**. `dsh-app` already depends on `coordinator`, `routing`, `subagents` and `board` (*review-supplied*; the coordinator edge is visible at `dsh-app/src/plugins/coordinator.ts:31-43`), so the driver needs **no new package, no new dependency and no new CLI**. `driveDryRun` and the data-only fake ship as `dsh-app` root exports, documented by usage in the package README.
Rejected: placing the driver in `coordinator` and adding `routing`/`subagents` edges. That inverts the ratified layering, and the only argument for it was the convenience of reusing coordinator's child-process test harness — which is not a reason to move an architecture (see D6). Also rejected: a speculative leaf package with a fallback clause; the placement is decided, so a fallback would be an unused branch in a plan.
What coordinator does gain: one pure module, `dispatch-admission.ts`, holding the state reconstruction and revalidation of D2. It reads workflow shape and citations only — no clock, file, socket or store — preserving the property `plan.ts:6-8` is built around.

**D2 — Admission evidence is revalidated by replaying `settle`, not by copying its rules.**
The earlier draft re-implemented the citation checks. Instead, `admissibleDispatch(states)` in coordinator:

1. Pins the workflow. This slice accepts **only `MILESTONE_WORKFLOW`** (`workflow.ts:184-283`), and runs `checkWorkflow` on it first (`workflow.ts:120-173`). An arbitrary caller-supplied workflow is refused: a workflow is exactly where a caller could delete the gates or the evidence list, and #253 forbids a weaker re-derivation of the #195 rule.
2. Refuses malformed input state: duplicate ids, ids not in the workflow, and any outcome outside the four (`plan.ts:354`). `readStates` tolerates these by design (`plan.ts:390-437`); a driver must not.
3. **Reconstructs** the state deterministically: start from empty, walk `prerequisites(workflow, "dispatch-run")` in declaration order (`workflow.ts:93-107`, which already returns declaration order), and for each prerequisite apply the caller's recorded outcome through the real `settle` (`plan.ts:196-275`). `settle` is what enforces uncited/unreferenced/miscited and unexplained-refusal, and it refuses to record a step done out of order. If any application refuses, the driver stops with that step id, that `SettleRule` and that detail — named provenance, not a boolean.
4. Validates **every** `done` prerequisite this way, not only the gates. A `read` step recorded done with prose evidence is the same defect one layer earlier.
5. Finally calls `admit(workflow, reconstructed, "dispatch-run")` (`plan.ts:118-181`), which is where the transitive `ungated-effect` rule lives (`plan.ts:154-166`).

The reconstructed states must equal the caller's, step for step, or the input is refused. Nothing is assembled and no intent is written on an invalid state.
**Unknown stays unknown:** `parseCitation` decides that a string *refers* to something, never that the thing exists (`citation.ts:65-73`). This slice makes no claim that any cited artifact exists or was approved.

**D3 — Route is checked before any effect attempt; the fake is two discrete phases.**
Order, and every step is a hard gate:

    validate source → reconstruct+admit workflow state → admitDispatch(request, {lane})
      → fake.prepare (data only: the observation it will report)
      → compareRouteIdentity(requested, observed)      ← LAST FREE REFUSAL
      → assemble → handle.intent(key)                  ← first durable write
      → fake.attempt (one discrete step)
      → settle, or deliberately do not

`compareRouteIdentity` runs on requested values built from the admitted `DispatchRequest` plus the configured cwd, against the observation the fake declares (`subagents/route.ts:142-166`); `isRouteEvidenceVerified` is the final predicate, and it re-derives rather than trusting `status` (`route.ts:174-192`). A `mismatch` or `unknown` result is a **definite refusal with zero store entries** — no intent, no receipt, no attempt. A negative receipt is only ever written when an intent exists *and* no attempt has happened.
Attempt outcomes, exhaustively:

| Fake result | Meaning | Record |
|---|---|---|
| `refused` | reached, said no, no useful work sent | `delivered:false` receipt → terminal `unsent` |
| `accepted` | synthetic delivery | `delivered:true` receipt, branded reference → terminal `sent` |
| `unknown`, malformed, or throws | undetermined after attempt | **no receipt**; intent stays pending; recovery gives terminal `unknown` (`state-store.ts:151-153`), defended by `receipt-after-orphan` (`state-store.ts:143`) |

The driver contains no `catch` that settles, mirroring `isSafeToRetry`'s argument that only an answered refusal licenses a negative record (`subagents/provider.ts:264-271`).

**D4 — The source is strict, the task derives from it, and the key binds every semantic input.**
`GithubSourceRef` requires: `kind: "issue"`, `state: "open"`, `repository` (owner/name), `number`, `url`, `title`, `body` (non-empty), `updatedAt` (ISO-8601 shape), `labels`. Fields chosen to match `SourceIssue` (`board/model.ts:16-57`); the driver declares its own narrow type rather than depending on board's projection. `url` is **metadata asserted offline** — nothing here fetches it or attests that it resolves. `task` is derived as `issue-<number>`; an arbitrary caller-supplied task is refused, because an unbound task lets one source drive records under any name. The prompt is either taken from `body` or supplied separately **and** bound into the revision alongside the body, so a prompt can never diverge from the source it claims.

    inputRevision = digest({
      mode: "dry-run",
      source: { repository, number, state, updatedAt, title, body, url, labels },
      lane, workflow: "milestone", step: "dispatch-run",
      dispatch: <whole DispatchRequest>, cwd: <requested cwd>,
      provider: <fake provider identifier>,
      fake: <the one configured result>,
      admission: <prerequisite id -> outcome+citations, as reconstructed>,
    })

`cwd` and the provider identifier were missing from the previous draft and are added: both change what a live run would do, so both must change the key. The fake is **one configured result**, not a script of outcomes — an array implies a repeated dispatch loop this slice does not have. `mode: "dry-run"` is inside the digest so a simulation is identifiable and can never be replayed as a live delivery; the durable **shape** matches a live run, the key deliberately does not. Digest via the existing canonical helpers (`journal.ts:24,58`). Reference on success: `"dry-run:" + fake.name + "@" + <short key digest>`; the driver refuses any reference lacking that brand and never copies fake-supplied prose into it.

**D5 — Scope, snapshotting, retries.**
`StateStoreHandle` carries `holder` and no scope (`contracts/state-store.ts:111-123`); the adapter checks only `key.repository` against its own scope (`state-store-memory.ts:71`, `state-store.ts:134`). Milestone scope is therefore **not** enforced by the handle. The driver documents that the caller supplies the store scope, and `dsh-app` exports one explicit setup wrapper that constructs store and plan from one scope value so the two cannot disagree; the driver additionally refuses when `source.repository !== key.repository`. No blind claim of scope enforcement is made.
The driver **snapshots every input synchronously** (structured clone) before its first `await`, so a caller mutating its plan object mid-flight cannot make the effect differ from the key. A repeat intent for a live key is refused by the store (`state-store.ts:140`); the driver surfaces that refusal and **never auto-retries** — retry is the caller's decision with a new attempt number.

**D6 — Tests get their own harness; no cross-package test import.**
`withStoreDirectory` hardcodes `./state-store-child.js` (`state-store-test-helpers.ts:23`) and is coordinator-internal, so it cannot be reused unchanged for a `dsh-app` child. A new `dsh-app` test helper reuses the *idiom* — fork, IPC `wait("reached")`, assert `SIGKILL` exit, tmpdir per child cleaned in `finally` (`state-store-test-helpers.ts:19-60`) — with the child module URL as a parameter. Crash hooks are an internal, test-visible module in `dsh-app`, never a public callback and never reachable from the exported API. All fixture values are fixed synthetic strings; no operational commits, hostnames, home paths or telemetry.

---

## Interfaces

    // @rickylabs/coordinator — pure
    export type AdmissionFailure =
      | { kind: "workflow-invalid"; problems: readonly Problem[] }
      | { kind: "state-malformed"; detail: string }
      | { kind: "evidence-invalid"; step: string; rule: SettleRule; detail: string }
      | { kind: "inadmissible"; rule: AdmissionRule; detail: string };
    export function admissibleDispatch(states: readonly StepState[]):
      | { ok: true; states: readonly StepState[] } | { ok: false; failure: AdmissionFailure };

    // dsh-app root exports
    export interface FakeExecutor {
      readonly name: string;      // lowercase slug; appears in the reference
      readonly provider: string;  // identifier only, no process
      readonly observation: { provider: string; model: string; effort: string; cwd: string };
      readonly result: { kind: "accepted" | "refused" | "unknown" | "throws"; reason?: string };
    }
    export type DriveRefusal =
      | { kind: "source-unusable"; detail: string }
      | { kind: "admission-failed"; failure: AdmissionFailure }
      | { kind: "dispatch-inadmissible"; problems: readonly AdmissionProblem[] }
      | { kind: "route-unverified"; status: RouteStatus; fields: readonly RouteField[] }
      | { kind: "executor-not-data"; detail: string }
      | { kind: "store-refused"; refusal: StoreRefusal };
    export type DriveOutcome =
      | { drove: false; refusal: DriveRefusal }                                  // zero entries
      | { drove: true; key: IntentKey; status: EffectStatus }                    // sent | unsent
      | { drove: true; key: IntentKey; undetermined: SessionPending; why: string };
    export function driveDryRun(handle: StateStoreHandle, plan: DryRunPlan): Promise<DriveOutcome>;

Refusals are named values in the store port's idiom (`contracts/state-store.ts:101-108`). Routing text is rendered with `describeAdmission`, safe by construction (`routing/admit.ts:522-537`). `compareRouteIdentity`'s `detail` is **never persisted or logged** — it can carry absolute paths (`route.ts:52-55`) and this is a public repository; refusals name `status` and field names only. A runtime guard rejects any function-valued property on the fake (`executor-not-data`); no exported input type has a function field, so a live provider callback cannot arrive by accident.

---

## Test matrix

*Admission:* every `SettleRule` reachable through reconstruction (uncited, unreferenced, miscited, unexplained-refusal, already-settled, upstream-forked, upstream-blocked, needs-unmet, ungated-effect); duplicate ids, unknown ids, bad outcome strings; a non-canonical workflow refused; a done `read` step with prose evidence refused. Each asserts **zero store entries**.
*Source:* closed issue, pull-request kind, empty body, malformed `updatedAt`, mismatched repository, caller-supplied task — all refused.
*Key:* stable across calls; changes with each of prompt/body, model, effort, lane, `updatedAt`, cwd, provider identifier, attempt; `mode` makes a dry-run key differ from a live-shaped one.
*Ordering:* route mismatch and route unknown each refuse with zero entries and with the fake's attempt phase provably not invoked (attempt counter asserted zero); routing refusal likewise; fabricated `admitted:true` / `status:"known"` fields cast into the plan are ignored and the real checks still refuse.
*Outcomes:* accepted → `sent`, branded reference, reference contains no path separator; refused → `unsent`, reason from the fake's declared reason only; unknown / malformed / throws → one pending intent, zero receipt entries.
*Crash, real forked children, no provider process:* SIGKILL after assembly and before `intent` — recovery shows nothing pending or terminal, and re-driving the identical plan reproduces the same key; SIGKILL after the fake attempt and before `receipt` — recovery yields terminal `unknown` with `sent`/`unsent` controls intact, and a forged pending rebuilt from the orphan is refused `receipt-after-orphan` (shape proven at `state-store-crash.test.ts:38-49`).
*Recovery parity:* reopen after checkpoint and assert terminal state is unchanged.

---

## Risks and gates

| Risk | Likelihood | Impact | Gate |
|---|---|---|---|
| A dry-run `sent` read as live delivery | low | severe | mode in revision, branded reference, prefix test |
| Path or credential-shaped string persisted | medium | disclosure | route `detail` never written; `describeAdmission` only; reason-content assertions |
| Undetermined attempt settled as `unsent` | low | breaks the #247 invariant | crash test B plus zero-receipt unit tests |
| Caller mutation between key and effect | low | key/effect divergence | synchronous snapshot before first await |
| Scope believed enforced by the handle | medium | wrong-milestone records | documented explicitly; setup wrapper; repository equality check |
| Gates cannot run here (Principle 6) | medium | unproven verdict | record exact commands and output; anything not run reports `unknown`, never `passed` |

**Unverified, and stated as such:** live parity. That a live run would produce this record shape rests on reading the port contract (`contracts/state-store.ts:116-119`); nothing live has run. It becomes provable only in the live-half issue, after #62.