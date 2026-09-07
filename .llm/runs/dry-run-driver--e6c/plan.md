# dry-run-driver--e6c — initial plan (REJECTED, not governing)

Coordinator review rejected package placement, duplicated citation rules, and ambiguity in route-check timing. A superseding plan is required.

# plan.md — E6.C (issue #253): drive a dispatch through the durable store against fakes

**Author:** independent plan author, native Claude Code opus-5 medium (owner matrix override).
**Date:** 2026-09-07. **Status:** proposed text for review by a different family. No file was written, no command was run, and no evidence below was gathered by execution — every citation is to the supplied source bundle.

---

## Summary

One new module in `@rickylabs/coordinator` (`dispatch-driver.ts`) plus a JSON-only CLI subcommand drives a GitHub-sourced dispatch through the store published in #247: derive a key, check workflow admission and its evidence, check routing admission, write the intent, attempt against a **data-only native fake**, check the observed route, settle. It reuses `admit`/`settle`'s rules, `admitDispatch`, and `compareRouteIdentity` rather than restating any of them. Nothing is injected as a function anywhere on the public surface, so a live provider cannot arrive by accident. An attempt whose outcome is undetermined writes **no receipt at all** and leaves the intent pending, so recovery produces terminal `unknown`.

No new owner forks. #62 still owns the live half and this slice does not touch it.

---

## Decisions

**D1 — The driver lives in `packages/coordinator/src/dispatch-driver.ts`; coordinator gains dependencies on `@rickylabs/routing` and `@rickylabs/subagents`.**
Rationale: the checks that must not be reinvented are `admitDispatch` (`packages/routing/src/admit.ts:493`) and `compareRouteIdentity` (`packages/subagents/src/route.ts:142`), and the rule that they must be *called on the actual request* rather than handed a verdict means the caller of them is the driver. Coordinator today depends only on contracts (`packages/coordinator/package.json:33-35`, `packages/coordinator/tsconfig.json:10-14`). Both new imports are pure — no clock, file or socket — so coordinator's stated purity property (`packages/coordinator/src/plan.ts:6-8`) survives; what changes is the layering, and the coordinator sitting above the two seams is the direction `dsh-app` already composes in. `[routing/admit.ts:17-20 · package graph · 2026-09-07]` records that a `subagents → routing` edge would be a cycle refused by `check:graph`; the edge added here runs the other way and adds no cycle among the packages in this bundle.
Rejected: (a) a new `packages/dispatch-driver` package — one module of a half-slice does not justify a package, a plugin row and a publication decision; (b) putting the driver in `dsh-app` — the crash tests need it importable by a forked child fixture in the coordinator suite, and `dsh-app` is composition, not logic.
**Fallback, pre-committed:** if `check:graph` refuses the new edge for a reason not visible in this bundle, promote the module unchanged into a leaf package `packages/dispatch-driver` depending on contracts + coordinator + routing + subagents. This is a move, not a redesign; record it in `drift.md`.

**D2 — `inputRevision` is a digest that binds every input that could change the work, including the execution mode.**
`IntentKey` is `{repository, task, workflowStep, attempt, inputRevision}` (`packages/contracts/src/state-store.ts:6-12`), and `intentIdentity` keys the whole store on the full tuple (`packages/coordinator/src/state-store.ts:99`). The driver computes

    inputRevision = digest({
      mode: "dry-run",
      source: { repository, number, state, updatedAt, labels, title },
      lane, workflow: workflowName, step: stepId,
      dispatch: <the whole DispatchRequest, canonically>,
      admission: <gate id -> citation string, for every gate upstream of the step>,
      fake: { name, outcomes },
    })

using the existing `digest`/`canonicalJson` already used for journal digests (`packages/coordinator/src/journal.ts:24,58`). Consequence, and the reason for the shape: two dispatches carrying different prompts, models, lanes, source revisions or gate evidence can never share a key, so one key can never send two different pieces of work.
`mode` is inside the digest deliberately. Rejected alternative: leaving mode out so a dry-run key equals the live key at the same attempt. That would make a dry-run terminal `sent` byte-indistinguishable from a live one, and a later reader — or step F — could not tell a real delivery from a rehearsal. The acceptance line "a dry-run produces the same durable record a live run would" is therefore satisfied as *same record shape, same derivation function, same entry sequence and same recovery behaviour*, and explicitly **not** as an identical key. `[#253 acceptance · dry-run parity · 2026-09-07]`

**D3 — The synthetic delivery is a positive receipt whose reference is branded and cannot name a live artifact.**
`DeliveryReceipt` is `{delivered:true, reference}` or `{delivered:false, reason}` (`contracts/state-store.ts:49-51`) and stays unchanged. A dry-run success settles as `delivered:true, reference: "dry-run:" + fake.name + "@" + <8-char digest of the key>`. The driver refuses to build any reference that does not carry the `dry-run:` prefix, and never copies a string out of the fake configuration into the reference.
Rejected: settling every dry run as `delivered:false` — it would produce `unsent` where a live run produces `sent`, so the record shape would differ exactly where step F needs it to match, and it would burn a `NonDeliveryProof` (`journal.ts:247-271`) on something that was never refused by anything.

**D4 — Verdicts are recomputed from the request, never accepted as flags.**
The public input type has no `Admission`, no `RouteIdentityEvidence` and no `admitted`/`status` field. The driver calls `admitDispatch(request, {lane})` itself, and builds *requested* route values from the admitted `DispatchRequest` plus the configured cwd, and *observed* values from the fake's declared observation, then calls `compareRouteIdentity`. `isRouteEvidenceVerified` already re-derives rather than trusting `status` (`subagents/route.ts:174-192`) and is used as the final predicate, but the evidence it is given is the one this module computed. A caller that casts a fabricated verdict into the input is refused by shape, and there is a test for it.

**D5 — Admission evidence is validated, not assumed, using the workflow's own rules.**
Two gates, in this order:
1. `admit(workflow, states, stepId)` (`plan.ts:118`) — this is what already encodes Principle 5 via transitive `ungated-effect` (`plan.ts:154-166`) and terminates on forked/blocked upstream. A refusal is returned verbatim as `{rule, detail}`.
2. For every prerequisite of the step that is a `gate` (`workflow.ts:93-107`, `workflow.ts:148-161`), each declared evidence name must have a citation that `parseCitation` accepts and whose kind matches `evidenceKind` where one is declared (`citation.ts:74`, `workflow.ts:42-46`). This second pass is required because `readStates` deliberately *keeps* unparseable citations rather than dropping them (`plan.ts:420-432`), so a state file can present a gate as `done` with `"see the PR"` against it. `settle`'s three checks are the model and their ordering is reused (`plan.ts:208-257`); the driver reports the same three names — `uncited`, `unreferenced`, `miscited` — inside one `admission-evidence-invalid` refusal rather than inventing a weaker word.

**D6 — The fake is data, and the entry point is JSON.**
No `SubagentProvider` is implemented or accepted (`subagents/provider.ts:162-175`). The fake configuration is:

    interface FakeOutcome {
      readonly kind: "accepted" | "refused" | "unknown" | "throws";
      readonly observed: { provider: string; model: string; effort: string; cwd: string };
      readonly reason?: string;   // "refused" only
    }
    interface FakeExecutor { readonly name: string; readonly outcomes: readonly FakeOutcome[]; }

`driveDryRun` runs a small internal interpreter over that. A runtime guard refuses any input whose fake carries a function-valued property (`executor-not-data`), which covers the cast-through-`any` path. The CLI subcommand `dsh-coordinator dry-run --plan <file.json>` reads JSON, and JSON cannot carry a callback at all — that structural fact, rather than a documented convention, is what makes the entry point unable to accept a live provider.
Rejected: a `SubagentProvider` parameter with a fake implementation. It is one line from a real provider at every call site, and #253 excludes provider processes outright.

**D7 — Refusals are named values in the store port's idiom, and never carry raw route detail.**

    type DriveRefusal =
      | { kind: "source-unusable"; detail: string }
      | { kind: "workflow-inadmissible"; rule: AdmissionRule; detail: string }
      | { kind: "admission-evidence-invalid"; rule: "uncited" | "unreferenced" | "miscited"; detail: string }
      | { kind: "dispatch-inadmissible"; problems: readonly AdmissionProblem[] }
      | { kind: "executor-not-data"; detail: string }
      | { kind: "store-refused"; refusal: StoreRefusal }

Consistent with `StoreRefusal` (`contracts/state-store.ts:101-108`). `describeAdmission` is reused for rendering routing refusals, and it is safe to log by construction (`routing/admit.ts:522-537`). `compareRouteIdentity`'s `detail` is **not** written anywhere durable: it may contain absolute paths (`subagents/route.ts:52-55`), and this is a public repository. A route failure's receipt reason is assembled from the status word plus the *names* of mismatched and invalid fields only.

**D8 — An undetermined attempt writes nothing.**
On `unknown` or `throws` from the fake, the driver returns without calling `handle.receipt`, leaving the intent pending. Recovery under a new generation converts it to terminal `unknown` (`state-store.ts:151-153`), which is the invariant #247 established and which `receipt-after-orphan` then defends (`state-store.ts:143`). The driver contains no `catch` that settles. This mirrors `isSafeToRetry`'s argument (`subagents/provider.ts:269-271`): only an answered refusal licenses a negative record.

---

## Public interface

    export interface DryRunPlan {
      readonly scope: StoreScope;
      readonly source: GithubSourceRef;   // repository, number, state, updatedAt, labels, title
      readonly workflow: Workflow;
      readonly states: readonly StepState[];
      readonly stepId: string;            // "dispatch-run" for MILESTONE_WORKFLOW
      readonly task: string;
      readonly attempt: number;
      readonly lane?: string;
      readonly dispatch: DispatchRequest;
      readonly cwd: string;               // requested cwd, absolute
      readonly fake: FakeExecutor;
    }

    export type DriveOutcome =
      | { readonly drove: false; readonly refusal: DriveRefusal }
      | { readonly drove: true; readonly key: IntentKey; readonly status: EffectStatus }
      | { readonly drove: true; readonly key: IntentKey; readonly undetermined: SessionPending; readonly why: string };

    export function intentKeyOf(plan: DryRunPlan): StoreResult<IntentKey>;
    export function driveDryRun(handle: StateStoreHandle, plan: DryRunPlan): Promise<DriveOutcome>;
    export function describeDrive(outcome: DriveOutcome): string;   // credential-safe, no cwd, no prompt

`GithubSourceRef` is a narrow structural subset of `SourceIssue` (`packages/board/src/model.ts:16-57`) declared in coordinator; the driver does **not** take a dependency on `@rickylabs/board` to get five fields.

Ownership: `@rickylabs/coordinator` (E6) owns `dispatch-driver.ts`, `dry-run-cli.ts` and their tests. `@rickylabs/routing` and `@rickylabs/subagents` are consumed unchanged — no edits to `admit.ts`, `route.ts`, `dispatch.ts`, `journal.ts`, `state-store.ts`, or `packages/contracts`. `dsh-app` is untouched: no plugin row, no service, no registration (`dsh-app/src/plugins/coordinator.ts:135-137` stays as it is), because registering a driver service would be framework for a runtime this slice excludes.

---

## Dependency DAG

    #247 (A: store port + fs adapter; B: intents/receipts/reducer)  ─┐
    #195 (checked-route rule, provider-codex)                        ─┤
    #61/#34 (admitDispatch, matrix)                                  ─┼──> D1 placement + graph check
    #203 (citation parser)                                           ─┘        │
                                                                               v
      D2 inputRevision  ──> D5 admission gates ──> D6 fake ──> D3 receipt ──> D8 undetermined
                                                        │
                                                        └──> T-crash A/B (child fixtures) ──> step F (out of scope)
    #62 (execution channel) ──> live half of C — NOT in this slice, no code path reserved for it.

---

## Risk register

| # | Risk | Likelihood | Impact | Gate |
|---|---|---|---|---|
| R1 | The coordinator → routing/subagents edge is refused by `check:graph` for a reason not visible in this bundle | medium | rework of file placement only | Run `check:graph` **first**, before any other work; D1 fallback applies |
| R2 | A caller treats a dry-run `sent` record as evidence of live delivery | low | severe — a false delivery claim | D2 mode-in-revision + D3 branded reference + a test asserting the reference prefix and that no live-looking reference can be produced |
| R3 | An absolute path or a credential-shaped string reaches a durable record or a log | medium | public-repo disclosure | D7: route `detail` never persisted; `describeAdmission` reused for routing text; test asserts receipt reasons contain no `/` and no fake-supplied prose |
| R4 | A crash between attempt and receipt is settled as `unsent` by some future error handler | low | corrupts the #247 invariant | T-crash-B with the real child fixture, plus a unit test asserting zero receipt entries after `throws` |
| R5 | Gate evidence is accepted from a hand-edited state file | medium | ungated effect | D5 second pass; test with a `done` gate citing prose |
| R6 | Duplicate drive under one key sends different work | low | silent divergence | D2; test that changing any bound field changes the key, and that re-driving unchanged inputs is refused by the store as a repeat intent (`state-store.ts:140`) |
| R7 | Gates cannot actually run here (Principle 6) | medium | unproven verdict | Record the exact commands run and their output; anything not run is reported `unknown`, never `passed` |

---

## Test matrix

Node's built-in runner, matching the existing script (`packages/coordinator/package.json:30`).

*Key derivation:* stable across two calls; changes with each of prompt, model, effort, lane, source `updatedAt`, source `state`, gate citation, fake name, attempt; `mode` difference produces a different key than an otherwise identical live-shaped plan.

*Workflow admission:* refused when the step is ungated (`ungated-effect`), upstream forked, upstream blocked, already settled, unknown step; admitted for `dispatch-run` on a fully-gated `MILESTONE_WORKFLOW` state (`workflow.ts:240-247`).

*Evidence:* gate `done` with a missing citation → `uncited`; with `"see the PR"` → `unreferenced`; with a URL where `{name:"merge-commit", kind:"sha"}` is declared → `miscited`.

*Routing admission:* `unknown-model`, `unrouted-model`, `lane-model-mismatch`, `unbound-credential`, and a synthetic non-secret credential-shaped literal (assembled at runtime from harmless parts, never a real key) hitting `credential-in-payload`; assert the refusal text never echoes the offending value.

*Fabrication:* a plan cast to include `admitted: true` and `route: {status: "known"}` is ignored and the real checks still run; a fake carrying a function property → `executor-not-data`.

*Route check:* observed model differs → terminal `unsent` whose reason names `model` and the status word and contains no path separator; observed cwd absent → `unknown` status → `unsent` reason naming `cwd` as invalid; all four fields agreeing → `sent`.

*Happy path (memory store, `state-store-memory.ts:7`):* intent then receipt; `read()` shows one terminal `sent` with the branded reference; `checkpoint()`; close; reopen; state identical.

*Undetermined, in process:* fake `throws` and fake `unknown` each leave exactly one pending intent, zero receipt entries, and a `drove: true / undetermined` outcome; a subsequent fold under a new generation yields terminal `unknown`.

*Crash A — between assembling and intent (real child process, permitted; no provider process):* fixture in the style of `state-store-child.ts:38-41` parks after admission and before `handle.intent`, parent SIGKILLs, recovery shows nothing pending and nothing terminal, and re-driving the identical plan produces the same key and settles normally.

*Crash B — between attempt and receipt:* fixture writes an attempt marker file then parks, parent SIGKILLs (the shape already proven at `state-store-crash.test.ts:38-49`); recovery yields terminal `unknown` for the driven key with `sent`/`unsent` controls unchanged, and a forged pending rebuilt from the orphan is refused `receipt-after-orphan`. Harness reused unchanged from `state-store-test-helpers.ts:19-60`.

*Entry point:* CLI accepts a JSON plan and prints a deterministic outcome; a plan file with an unknown field is refused rather than ignored; a source-level test asserts `dispatch-driver.ts` imports nothing from any `provider-*` package.

---

## Scope exclusions, restated as commitments

No live dispatch, no provider process, no network call, no hub or transport lifecycle, no step F runbook or restart proof, no production storage selection (#191 F1), no `dsh-app` plugin or service registration, no change to the intent/receipt schema in `packages/contracts`, no mutation of issues 62, 148, 181, 237 or 244, no owner-fork resolution. One rule, one PR.

## Unverified claims

**Live parity is unproven and will remain so in this slice.** The claim that a live run would produce the same record shape rests on reading the port's contract (`contracts/state-store.ts:116-119`) and on nothing having executed a live dispatch through it. Until #62 is answered and the live half ships, "a dry run rehearses the live record" is a design intention with a test for the dry side only. Likewise, whether `check:graph` accepts D1's new edge is not verifiable from this bundle and is R1's gate, run first.