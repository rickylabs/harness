/**
 * UHP lifecycle to `RunLiveness`, exactly as issue #287 specifies it.
 *
 * Spike S11, issue #289. Run artifacts: `.llm/runs/uhp-stream-adapter--s11/`.
 *
 * ## The table, and it is a contract, not a preference
 *
 * From #287, which owns the contract alignment for UHP-hosted runs:
 *
 *   UHP `in_progress`   -> `running`
 *   UHP `completed`     -> `finished`
 *   UHP `failed`        -> `failed`
 *   UHP `cancelled`     -> `finished`, with `StopResult.verdict = "stopped"`
 *   UHP `incomplete`    -> `failed`, with detail `budget`
 *   unreachable or 404  -> `unknown`
 *
 * Three of those six rows are the interesting ones.
 *
 * **`cancelled` is `finished`, not `failed`.** The client asked for the stop, so nothing went wrong.
 * Lifecycle §4 states the rule from the server's side — "A `cancelled` task MUST report `cancelled`,
 * not `failed`" — and #287 carries it through to our vocabulary. A coordinator that files a cancelled
 * run as a failure accuses an operator of breaking something they deliberately stopped, and then a
 * retry policy keyed on failure relaunches it.
 *
 * **`incomplete` is `failed` with `budget`.** The harness hit a step or time limit and stopped with
 * partial output. It failed to finish the work, which is a failure, and the reason is not a defect —
 * it is a ceiling someone set. `limit: "budget"` is a field rather than prose so that a governance
 * rule can read it without matching a string.
 *
 * **Unreachable and 404 are `unknown`, and so is an unreadable stream.** This is the word the whole
 * `SubagentProvider` seam is built around (see `provider.ts`). A transport failure is evidence about
 * the network, not about the agent. Streaming §1 is explicit that "A dropped connection MUST NOT
 * abort the task. The work continues server-side", so reporting `failed` on a dropped connection is a
 * specific, wrong claim — and it is the claim with a destructive action attached, because a
 * reclamation policy will free a lease that a live agent is still holding.
 *
 * `queued` is never produced. UHP has no queued status: Lifecycle §4 calls `in_progress` "Accepted and
 * running", which merges the two, and inventing a split the wire cannot report would be a guess.
 *
 * ## Citations
 *
 * https://unifiedharnessprotocol.org/spec/2026-08-11/lifecycle and
 * https://unifiedharnessprotocol.org/spec/2026-08-11/streaming, both retrieved 2026-09-12 against
 * UHP `2026-08-11`; issue #287 for the mapping table; `provider.ts` for `RunLiveness` and `StopVerdict`.
 *
 * Nothing here has met a live HarnessRouter. See `verification.md`.
 */

import type { Observation, RunLiveness, RunRef, StopVerdict } from "./provider.js";
import type { UhpStreamRefusal } from "./uhp-stream.js";
import { type UhpLifecycleStatus } from "./uhp-wire.js";

/**
 * What was actually observed about a run — which is not always a status.
 *
 * A union rather than `status | null`, because "the server said `failed`" and "we never reached the
 * server" are different observations and the second one must not be spellable as the first. Every
 * non-lifecycle member exists because it happened to somebody: a refused connection, a 404 from an
 * expired session, a 500 from a proxy, a stream we could not read.
 */
export type UhpOutcome =
  /** The server answered and reported a lifecycle status. */
  | { readonly kind: "lifecycle"; readonly status: UhpLifecycleStatus }
  /** No answer at all: connection refused, DNS failure, timeout. */
  | { readonly kind: "unreachable"; readonly cause?: string }
  /**
   * HTTP 404. Sessions §1 names two: `response_not_found` for an unknown `previous_response_id`, and
   * `session_expired` for a chain the server has forgotten. Neither says what the run did.
   */
  | { readonly kind: "not-found"; readonly code?: string }
  /** Any other unsuccessful HTTP status. A proxy's 502 is not a verdict on an agent. */
  | { readonly kind: "transport"; readonly httpStatus: number }
  /** The bytes arrived and `readUhpStream` refused them. We could not read, so we do not know. */
  | { readonly kind: "unreadable"; readonly refusal: UhpStreamRefusal };

/**
 * The mapped verdict.
 *
 * `stop` and `limit` are the two places #287 asks for something beyond the liveness word, and both are
 * data rather than sentences. Decision 9 of #287 puts them on the versioned observation resource, not
 * on `RunView`, which is why nothing in `packages/contracts` changes for this.
 */
export interface UhpLifecycleVerdict {
  readonly liveness: RunLiveness;
  /** `stopped` for a cancelled run, and `null` for every other outcome. Never invented. */
  readonly stop: StopVerdict | null;
  /** `budget` when the harness stopped at a step or time ceiling. */
  readonly limit: "budget" | null;
  readonly detail: string;
}

/**
 * Map one observed outcome onto the seam's vocabulary.
 *
 * Written as an exhaustive switch on a closed union so that adding a UHP status to `uhp-wire.ts`
 * without deciding what it means here is a compile error rather than a silent `unknown`.
 */
export function mapUhpOutcome(outcome: UhpOutcome): UhpLifecycleVerdict {
  switch (outcome.kind) {
    case "lifecycle":
      switch (outcome.status) {
        case "in_progress":
          return {
            liveness: "running",
            stop: null,
            limit: null,
            detail: "the server reports the task accepted and running",
          };
        case "completed":
          return {
            liveness: "finished",
            stop: null,
            limit: null,
            detail: "the harness finished the work and produced a result",
          };
        case "failed":
          return {
            liveness: "failed",
            stop: null,
            limit: null,
            detail: "the task could not be completed",
          };
        case "cancelled":
          return {
            liveness: "finished",
            stop: "stopped",
            limit: null,
            detail: "the client cancelled the task; it is finished, not failed, and partial output may exist",
          };
        case "incomplete":
          return {
            liveness: "failed",
            stop: null,
            limit: "budget",
            detail: "budget: the harness stopped at a step or time limit with partial output",
          };
      }
      // Unreachable while the union is exhaustive, and fail-closed if it ever is not.
      return unknownOutcome("the server reported a lifecycle status this adapter does not recognise");
    case "unreachable":
      return unknownOutcome(
        `the server could not be reached${outcome.cause === undefined ? "" : ` (${outcome.cause})`}; a dropped connection does not abort the task, so the run's state is unknown`,
      );
    case "not-found":
      return unknownOutcome(
        `the server answered 404${outcome.code === undefined ? "" : ` (${outcome.code})`}; the response or session could not be found, which says nothing about what the run did`,
      );
    case "transport":
      return unknownOutcome(
        `the server answered HTTP ${outcome.httpStatus}, which is a transport failure and not a verdict on the run`,
      );
    case "unreadable":
      return unknownOutcome(
        `the stream was refused as ${outcome.refusal}, so nothing was read; an unreadable stream is not a failed run`,
      );
  }
}

function unknownOutcome(detail: string): UhpLifecycleVerdict {
  return { liveness: "unknown", stop: null, limit: null, detail };
}

/**
 * Build the seam's `Observation` from a mapped outcome.
 *
 * Here so the mapping lands in the published shape rather than in a parallel one. `observedAt` is the
 * caller's clock and means "when this was true", per `Observation`'s own contract.
 *
 * `artifacts` is passed in rather than derived, because a UHP response's `output` items are the
 * agent's text and tool calls — branch names and pull request urls live inside that prose, and
 * recovering them is a parsing job with its own failure modes. Guessing one here would put a
 * fabricated pull request url on a run record. #294 owns that question, with a real router to check
 * against.
 */
export function uhpObservation(
  run: RunRef,
  outcome: UhpOutcome,
  observedAt: string,
  artifacts: readonly string[] = [],
): Observation {
  const verdict = mapUhpOutcome(outcome);
  return { run, liveness: verdict.liveness, observedAt, detail: verdict.detail, artifacts };
}
