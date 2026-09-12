/**
 * The route gate for UHP-hosted runs: does the server's answer permit a useful turn?
 *
 * Spike S11, issue #289, fail-closed requirements B and C. Run artifacts:
 * `.llm/runs/uhp-stream-adapter--s11/`.
 *
 * ## B — read `mismatches`, not `status`
 *
 * `compareRouteIdentity` gives `unknown` precedence over `mismatch` (`route.ts`, the `status` ternary
 * at the end of the function). That precedence is right: an incomplete comparison must not be
 * reported as a completed one.
 *
 * Over UHP it has a consequence that is easy to miss and expensive to miss. `provider`, `effort` and
 * `cwd` are not reportable by the protocol — S10's reading of the specification, its OpenAPI document
 * and its conformance suite, recorded in `.llm/runs/route-identity-uhp--s10/research.md` and still
 * **an unevaluated generator verdict awaiting a non-Claude evaluator, not settled fact**. If it holds,
 * `invalid[]` is never empty on a UHP route, so `status` is pinned to `unknown` — *including* when the
 * server has explicitly told us it substituted the model.
 *
 * So a gate written as `if (evidence.status === "mismatch") refuse()` never fires over UHP. It reads
 * correctly. It reviews correctly. It is dead code, and the day a router quietly serves a cheaper
 * model, it stays silent. The signal is in `evidence.mismatches`, which still holds `["model"]`, and
 * that is the field this module reads. The same defect was found today in two separate codebases,
 * which is why it is encoded in a type here rather than left to reviewer attention.
 *
 * ## C — do not copy the codex refusal ladder
 *
 * `packages/provider-codex/src/protocol.ts` checks `evidence.status === "unknown"` and returns
 * `unknown`, then checks `evidence.status === "mismatch"` and returns `refused`. In the codex dialect
 * all four fields are observable, so both branches are reachable and the ordering is correct there.
 *
 * Transplanted to UHP the first branch always wins and the second is unreachable, so a substituted
 * model is reported as "we could not tell" instead of "the server contradicted the request". Those are
 * different incidents with different responses: one is a retry, the other is a routing failure a human
 * has to look at.
 *
 * This module follows `packages/dsh-app/src/dry-run-internal.ts` instead, which decides on the
 * strongest available negative — `if (!isRouteEvidenceVerified(route)) refuse({ status, fields })` —
 * and carries `status` along only to explain. Same shape here:
 *
 * - **A contradiction outranks a silence.** A reported difference is a positive fact about the server;
 *   an absent field is the absence of a fact. Refusal beats unknown.
 * - **`status` never decides.** `uhpRouteVerdict` cannot see it: its parameter type has no such field.
 *   The verdict is derived from the negatives, and `status` appears only inside `detail`, where it
 *   explains why the comparison was incomplete.
 *
 * ## The owner risk ruling of 2026-09-12 — an unattested effort does not block a turn
 *
 * Until this ruling the gate returned `unknown` for every conformant UHP response, because three of the
 * four route fields are unreported and an unreported field was treated as blocking. The provider
 * therefore refused everything. The owner ruled on the premise rather than on the options:
 *
 *   > The effort check is nonsense. The tool (UHP) and DeepSeek are both written to guarantee the right
 *   > model and effort. The genuine places where it might be an issue are Codex silently rerouting
 *   > sometimes from Astra to Sol, and Fable 5.1 rerouting to Opus for security concerns. Both should be
 *   > considered a later concern, not blocking.
 *
 * So non-observability of `provider`, `effort` and `cwd` over this transport is an **observability gap
 * and not a safety problem**, and a route whose `model` was reported and agreed may be `accepted`.
 *
 * Three things about that, in the order they will be misread:
 *
 * 1. **It is accepted by owner risk decision, not because the risk was shown to be absent.** The basis is
 *    how the execution layer is written, which is a reasonable basis and is not evidence from a run. The
 *    two rerouting behaviours the ruling names — Codex substituting Astra for Sol, Fable 5.1 substituting
 *    Opus under security policy — are real, are deferred rather than dismissed, and are the thing to
 *    revisit if either ever appears on a UHP-hosted harness.
 * 2. **The contradiction branch is untouched.** It is a separately ratified ruling, it is checked first,
 *    and it is where the codex-ladder trap lives. What is lifted is the requirement to *attest* fields the
 *    protocol cannot report, never the requirement to *act* on the one it does.
 * 3. **An unattested route is still not a verified route.** `isRouteEvidenceVerified` is unchanged and
 *    still answers `false` here, so `isRouteVerified` on the dispatch result is `false` and F2 still bars
 *    certifying evaluator use. `accepted` says the turn may proceed; it does not say the route was proved.
 *
 * ## Two facts that were one verdict, and the fork that is still open
 *
 * `unknown` was carrying "I cannot name this run" and "I can name it but cannot attest three fields" at
 * once. Those are different incidents, and the second one is now `accepted`, so the gate has to be able
 * to tell them apart internally — otherwise the first would be swept in with it. `UhpRouteAttestation`
 * is that distinction, and it is deliberately **not** a new `DispatchVerdict`: whether the public verdict
 * vocabulary should gain an *identified but unattested* state is an open owner question on #286, and
 * answering it by widening a shipped enum is exactly how an open question stops being visible. The grade
 * explains, in the detail, and never crosses the seam.
 *
 * ## What a refusal means to a caller
 *
 * `refused` is a `DispatchVerdict` from `provider.ts`: the executor was reached and the route it
 * reported is not the route that was asked for. Nothing useful may be sent. `unknown` now means one
 * thing only — the wire reported nothing usable about the model, so this repository cannot say what ran.
 * The two agree on the action and disagree on the diagnosis, and the diagnosis is what a human needs.
 *
 * A test that asserts only `assert(!accepted)` or `assert(!verified)` covers neither B nor C: both
 * hold while both defects are live, because `refused` and `unknown` are both "not accepted". The suite
 * in `uhp-gate.test.ts` asserts the distinction itself and carries the defective ladder as a named
 * function so the difference is demonstrated on identical input.
 */

import {
  ROUTE_FIELDS,
  isRouteEvidenceVerified,
  type RouteField,
  type RouteIdentityEvidence,
  type RouteIdentityInput,
  type RouteStatus,
} from "./route.js";
import type { DispatchVerdict } from "./provider.js";
import type { UhpResponse } from "./uhp-wire.js";

/* -------------------------------------------------------------------------------------------------
 * Reading the route off the wire — four readers, three of which return null
 * ---------------------------------------------------------------------------------------------- */

/**
 * `Response.model` — "The model that actually ran", REQUIRED by `Response.required` (`openapi.yaml`).
 *
 * The one route field UHP reports. Read as-is: Tasks §1.3 makes a substituting server report the model
 * it ran here and the model that was asked for in `metadata.requested_model`, so reading
 * `requested_model` back and calling *that* the observation would launder a substitution into an
 * agreement — the exact measurement error the clause exists to prevent.
 */
export function readUhpModel(response: UhpResponse): string | null {
  return typeof response.model === "string" && response.model.trim().length > 0 ? response.model : null;
}

/**
 * The model provider of a completed task. Always `null`, and kept as a reader anyway.
 *
 * S10 read the specification as defining no `provider` field on `CreateResponseRequest` or `Response`;
 * the token's only non-prose occurrence is the failure code `provider_error` (Errors §3.3). Three
 * adjacent concepts exist — `Harness.base`, `Model.backend`, `ModelCatalog.backends` — and none of them
 * is the provider that served a given task: `base` is which CLI ran, and the catalogue is
 * discovery-time data the chapter says a server MUST compute live.
 *
 * That reading is **owner-certified and not independently re-derived** (#286; PR #292 sits at
 * `status:impl-eval` awaiting a non-Claude evaluator). So the reader stays. It returns `null` today, it
 * costs nothing, and re-adding one after a comment has declared the field dead costs another spike.
 */
export function readUhpProvider(_response: UhpResponse): null {
  return null;
}

/**
 * The reasoning effort a task ran at. Always `null`, and kept as a reader for the same reason.
 *
 * The Tasks §1.1 request table is complete at thirteen fields and carries no effort, reasoning-level or
 * thinking-budget field; neither does `Response` or `Response.metadata`. The protocol's only reasoning
 * surface is the reasoning *summary* stream (Streaming §2.4), which reports that the agent thought and
 * not the setting it thought at. A summary is not a setting.
 */
export function readUhpEffort(_response: UhpResponse): null {
  return null;
}

/**
 * The working directory a task ran in. Always `null`, and unrequestable as well as unreported.
 *
 * Sessions §1 and Lifecycle §4: a session owns "the working directory and its files" and the client
 * receives only an opaque `metadata.session_id`. There is no request field for it either, so this is the
 * one route field this repository cannot even ask for.
 */
export function readUhpCwd(_response: UhpResponse): null {
  return null;
}

/**
 * Map a UHP response onto the four route fields, reading only what the specification defines.
 *
 * Moved here from `uhp-mock.ts` by #286, unchanged in behaviour apart from the three readers returning
 * `null` where they previously returned `undefined` — `compareRouteIdentity` renders both as
 * `{ value: null }`, and a test pins that the two inputs produce identical evidence. It moved because a
 * production module must not import a mock: `scripts/check-compiled-policy.mjs` permits the literal
 * `model` and `effort` assignments in `uhp-mock.ts` on the recorded grounds that no production entry
 * point imports that file, and `uhp-provider.ts` needs this function. `uhp-mock.ts` re-exports it so
 * every S10 and S11 importer keeps working unchanged.
 *
 * Three of the four readers return `null`. That is not a stub and not laziness: there is nothing on the
 * wire to read, and inventing a read would be the fabricated agreement this whole contract exists to
 * refuse.
 */
export function observeUhpRoute(response: UhpResponse): RouteIdentityInput {
  return {
    provider: readUhpProvider(response),
    model: readUhpModel(response),
    effort: readUhpEffort(response),
    cwd: readUhpCwd(response),
  };
}

/**
 * The negatives, and nothing else.
 *
 * This is the parameter type that makes requirement C structural. There is no `status` field to read,
 * so a future edit that wanted to branch on `status` would have to widen this interface first, in a
 * diff that says what it is doing. `unattested` keeps that property: it is a set of *fields*, like the
 * other two, and carries no comparison outcome that a ladder could branch on.
 */
export interface UhpRouteNegatives {
  /** Fields the wire reported with a value that differs from the request. The substitution signal. */
  readonly contradicted: readonly RouteField[];
  /** Fields the wire did not report at all. Over UHP: provider, effort and cwd, always. */
  readonly unreported: readonly RouteField[];
  /**
   * Fields this repository cannot say agreed, for any reason: contradicted, unreported by the wire, or
   * never stated in the request at all.
   *
   * The superset of the other two, plus the requested-side gap they do not cover. That third case is why
   * this is not derived at the call site: a request that named no model produces no mismatch (there is
   * nothing to differ from) and no unreported observation, so a gate reading only the two lists above
   * would read "model agreed" off a comparison that never happened.
   */
  readonly unattested: readonly RouteField[];
  /** `isRouteEvidenceVerified` said no. Reported, and no longer sufficient on its own to block a turn. */
  readonly unverified: boolean;
}

/**
 * How much of the route this repository can actually attest, as three grades.
 *
 * Internal to the gate's reasoning. It exists because `accepted` and `unknown` now sit on either side of
 * a line that `DispatchVerdict` cannot name, and the grade is what the detail string says out loud so an
 * operator reading a refusal is not left to re-derive it. It is **not** exported from the package and it
 * is not a verdict: see the module comment on the fork it declines to answer.
 *
 * - `none` — nothing usable about the model. The response could not be correlated, or `model` was absent
 *   or contradicted. This is the state that remains a genuine failure.
 * - `partial` — `model` was reported and agreed; one or more of the other three could not be attested.
 *   Every conformant UHP response lands here, and the owner risk ruling accepts it.
 * - `complete` — all four fields were stated on both sides and agreed. No UHP response reaches this while
 *   S10's reading of the protocol holds; the grade exists so the day one does, nothing has to change.
 */
export type UhpRouteAttestation = "none" | "partial" | "complete";

/**
 * Grade the evidence. `model` is the hinge, because it is the only route field UHP reports.
 *
 * A contradiction grades `none` as well as refusing: a server that told us it ran a different model has
 * attested nothing about the route this dispatch asked for, and grading it `partial` would put the word
 * "attested" on a substitution.
 */
export function uhpRouteAttestation(negatives: UhpRouteNegatives): UhpRouteAttestation {
  if (negatives.unattested.includes("model")) return "none";
  return negatives.unattested.length === 0 ? "complete" : "partial";
}

/** The gate's answer: the verdict, the evidence it rests on, and the status that only explains. */
export interface UhpRouteDecision {
  readonly verdict: DispatchVerdict;
  readonly contradicted: readonly RouteField[];
  readonly unreported: readonly RouteField[];
  /** Fields that could not be attested, for any reason. The set the grade below is computed from. */
  readonly unattested: readonly RouteField[];
  /**
   * How much of the route was attested. The distinction `DispatchVerdict` cannot state: an `accepted`
   * graded `partial` is a turn permitted on an unattested route by owner risk decision, and it is a
   * different fact from a `complete` one. Carried so the detail and a local diagnostic can say which.
   */
  readonly attestation: UhpRouteAttestation;
  /**
   * The comparison status. Carried so an operator can see *why* the comparison was incomplete.
   * It did not decide anything above, and over UHP it is `unknown` for a refusal and for a silence
   * alike — which is the whole reason it cannot be allowed to decide.
   */
  readonly status: RouteStatus | "absent";
  readonly detail: string;
}

/**
 * Extract the negatives from route evidence.
 *
 * `mismatches` is read directly, because that is where a contradiction survives when `status` cannot
 * carry it. The observed side of `invalid` is read for the unreported list; the requested side is a
 * different fault — this repository failing to ask properly — and `unverified` already covers it.
 *
 * Absent evidence is the fail-closed default: everything unreported, unverified true. A provider that
 * predates route observation has not agreed to anything.
 */
export function uhpRouteNegatives(evidence: RouteIdentityEvidence | undefined): UhpRouteNegatives {
  if (evidence === undefined) {
    return { contradicted: [], unreported: [...ROUTE_FIELDS], unattested: [...ROUTE_FIELDS], unverified: true };
  }
  const contradicted = ROUTE_FIELDS.filter((field) => evidence.mismatches.includes(field));
  const unreported = ROUTE_FIELDS.filter((field) =>
    evidence.invalid.some((entry) => entry.side === "observed" && entry.field === field)
  );
  const unattested = ROUTE_FIELDS.filter((field) => !agrees(evidence, field));
  return { contradicted, unreported, unattested, unverified: !isRouteEvidenceVerified(evidence) };
}

/**
 * Whether both sides carried a value for this field and the two are the same string.
 *
 * Read off the compared values rather than off `status`, for the reason the whole module exists. Exact
 * comparison only: `compareRouteIdentity` has already nulled blanks, a relative `cwd` and anything that
 * was not a string, so a non-null value here is one that survived that reader. Optional chaining because
 * evidence can arrive from a caller that built it by hand, and a missing field is an absent value rather
 * than a crash.
 */
function agrees(evidence: RouteIdentityEvidence, field: RouteField): boolean {
  const asked = evidence.requested?.[field]?.value ?? null;
  const seen = evidence.observed?.[field]?.value ?? null;
  return asked !== null && seen !== null && asked === seen;
}

/**
 * Derive the verdict from the strongest available negative.
 *
 * Order, and the reason for it:
 *
 * 1. **A contradiction refuses.** The server reported a value and it is not the value that was asked
 *    for. That is a fact about the server, it is actionable, and it must not be diluted by the fields
 *    the protocol cannot report. This branch and its position are the ratified ruling of 2026-09-12;
 *    checking absence before it is the codex ladder, and it is what made that ladder's refusal
 *    unreachable over this transport.
 * 2. **An unattested `model` is unknown.** Nothing usable came back about the one route field this
 *    protocol reports — it was absent, or the request never named one — so this repository cannot say
 *    what ran. That is the case the owner ruling leaves as a genuine failure, and sweeping it into
 *    `accepted` would be the whole point of the gate given away.
 * 3. **Otherwise accepted.** `model` was reported and agreed. `provider`, `effort` and `cwd` may be
 *    unattested, and over UHP always are: per the owner risk ruling of 2026-09-12 that is an
 *    observability gap rather than a safety problem, because UHP and DeepSeek both guarantee the model
 *    and effort they are handed. Accepted by that decision, not because the risk was measured.
 *
 * `unverified` deliberately no longer appears. It is `true` for every conformant UHP response — the
 * predicate needs all four fields — so blocking on it is the same thing as refusing this transport, which
 * is what the ruling lifted. It stays in the record and in the detail, where it explains.
 *
 * No parameter here can carry a status. That is requirement C enforced by the signature rather than by
 * a comment asking nobody to reintroduce the ladder.
 */
export function uhpRouteVerdict(negatives: UhpRouteNegatives): DispatchVerdict {
  if (negatives.contradicted.length > 0) return "refused";
  if (uhpRouteAttestation(negatives) === "none") return "unknown";
  return "accepted";
}

function list(fields: readonly RouteField[]): string {
  return fields.join(", ");
}

/**
 * The gate. Decide, then explain.
 *
 * The detail is built to be readable by whoever is woken up: it names what was contradicted, then
 * names the status and the fields that pinned it, so nobody re-derives the defect from first
 * principles at three in the morning.
 *
 * On the accepted-but-unattested path the detail carries the *grounds* as well as the fields, because an
 * acceptance nobody can trace back to a risk decision is one a later reader assumes was measured.
 */
export function decideUhpRoute(evidence: RouteIdentityEvidence | undefined): UhpRouteDecision {
  const negatives = uhpRouteNegatives(evidence);
  const verdict = uhpRouteVerdict(negatives);
  const attestation = uhpRouteAttestation(negatives);
  const status: RouteStatus | "absent" = evidence?.status ?? "absent";
  const common = {
    contradicted: negatives.contradicted,
    unreported: negatives.unreported,
    unattested: negatives.unattested,
    attestation,
    status,
  };
  const because = negatives.unreported.length === 0
    ? ""
    : ` the comparison status is "${status}" because the wire did not report ${
      list(negatives.unreported)
    }, so the status cannot carry this;`;

  if (verdict === "refused") {
    return {
      verdict,
      ...common,
      detail:
        `the server contradicted the requested route on ${list(negatives.contradicted)};${because} nothing useful may be sent${
          evidence === undefined ? "" : `; ${evidence.detail}`
        }`,
    };
  }
  if (verdict === "unknown") {
    // Attestation `none` with nothing contradicted: the wire said nothing usable about `model`, which is
    // the one field this protocol does report, so there is no route to accept or refuse. Distinct from the
    // case below, where `model` agreed and only the unreportable fields are missing.
    return {
      verdict,
      ...common,
      detail: `the wire reported nothing about model that could be compared with the request, so nothing attests what ran${
        negatives.unreported.length === 0 ? "" : `; the wire did not report ${list(negatives.unreported)}`
      }; no useful turn is permitted${evidence === undefined ? " and no route evidence was supplied" : `; ${evidence.detail}`}`,
    };
  }
  if (attestation === "complete") {
    return {
      verdict,
      ...common,
      detail: `every route field was reported and agreed${evidence === undefined ? "" : `; ${evidence.detail}`}`,
    };
  }
  return {
    verdict,
    ...common,
    detail:
      `the wire reported model and it agreed with the request; ${
        list(negatives.unattested)
      } could not be attested;${because} an unattested route is accepted by the owner risk ruling of 2026-09-12 — UHP and DeepSeek both guarantee the model and effort they are given — and not because the risk was shown to be absent; ${
        negatives.unverified
          ? "the route is not verified, so certifying use remains barred"
          : "the route is verified evidence despite the grade, which should not be possible and is worth reading twice"
      }${evidence === undefined ? "" : `; ${evidence.detail}`}`,
  };
}
