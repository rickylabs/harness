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
 * ## What a refusal means to a caller
 *
 * `refused` is a `DispatchVerdict` from `provider.ts`: the executor was reached and the route it
 * reported is not the route that was asked for. Nothing useful may be sent. `unknown` means the
 * comparison could not be completed, which also permits no useful turn — the two agree on the action
 * and disagree on the diagnosis, and the diagnosis is what a human needs.
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
  type RouteStatus,
} from "./route.js";
import type { DispatchVerdict } from "./provider.js";

/**
 * The negatives, and nothing else.
 *
 * This is the parameter type that makes requirement C structural. There is no `status` field to read,
 * so a future edit that wanted to branch on `status` would have to widen this interface first, in a
 * diff that says what it is doing.
 */
export interface UhpRouteNegatives {
  /** Fields the wire reported with a value that differs from the request. The substitution signal. */
  readonly contradicted: readonly RouteField[];
  /** Fields the wire did not report at all. Over UHP: provider, effort and cwd, always. */
  readonly unreported: readonly RouteField[];
  /** `isRouteEvidenceVerified` said no. The strongest available negative about completeness. */
  readonly unverified: boolean;
}

/** The gate's answer: the verdict, the evidence it rests on, and the status that only explains. */
export interface UhpRouteDecision {
  readonly verdict: DispatchVerdict;
  readonly contradicted: readonly RouteField[];
  readonly unreported: readonly RouteField[];
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
    return { contradicted: [], unreported: [...ROUTE_FIELDS], unverified: true };
  }
  const contradicted = ROUTE_FIELDS.filter((field) => evidence.mismatches.includes(field));
  const unreported = ROUTE_FIELDS.filter((field) =>
    evidence.invalid.some((entry) => entry.side === "observed" && entry.field === field)
  );
  return { contradicted, unreported, unverified: !isRouteEvidenceVerified(evidence) };
}

/**
 * Derive the verdict from the strongest available negative.
 *
 * Order, and the reason for it:
 *
 * 1. **A contradiction refuses.** The server reported a value and it is not the value that was asked
 *    for. That is a fact about the server, it is actionable, and it must not be diluted by the fields
 *    the protocol cannot report.
 * 2. **Anything else incomplete is unknown.** No contradiction was reported and the comparison did not
 *    complete, so the honest answer is that nobody knows.
 * 3. **Otherwise accepted.** Every field was reported and every field agreed.
 *
 * No parameter here can carry a status. That is requirement C enforced by the signature rather than by
 * a comment asking nobody to reintroduce the ladder.
 */
export function uhpRouteVerdict(negatives: UhpRouteNegatives): DispatchVerdict {
  if (negatives.contradicted.length > 0) return "refused";
  if (negatives.unverified || negatives.unreported.length > 0) return "unknown";
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
 */
export function decideUhpRoute(evidence: RouteIdentityEvidence | undefined): UhpRouteDecision {
  const negatives = uhpRouteNegatives(evidence);
  const verdict = uhpRouteVerdict(negatives);
  const status: RouteStatus | "absent" = evidence?.status ?? "absent";
  const because = negatives.unreported.length === 0
    ? ""
    : ` the comparison status is "${status}" because the wire did not report ${
      list(negatives.unreported)
    }, so the status cannot carry this;`;

  if (verdict === "refused") {
    return {
      verdict,
      contradicted: negatives.contradicted,
      unreported: negatives.unreported,
      status,
      detail:
        `the server contradicted the requested route on ${list(negatives.contradicted)};${because} nothing useful may be sent${
          evidence === undefined ? "" : `; ${evidence.detail}`
        }`,
    };
  }
  if (verdict === "unknown") {
    return {
      verdict,
      contradicted: negatives.contradicted,
      unreported: negatives.unreported,
      status,
      detail: `the route could not be verified and the wire reported no disagreement${
        negatives.unreported.length === 0 ? "" : `; the wire did not report ${list(negatives.unreported)}`
      }; no useful turn is permitted${evidence === undefined ? " and no route evidence was supplied" : `; ${evidence.detail}`}`,
    };
  }
  return {
    verdict,
    contradicted: negatives.contradicted,
    unreported: negatives.unreported,
    status,
    detail: `every route field was reported and agreed${evidence === undefined ? "" : `; ${evidence.detail}`}`,
  };
}
