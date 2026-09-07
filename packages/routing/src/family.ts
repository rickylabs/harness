/**
 * The rule that an evaluator may not be the author, checked against the two-seam topology.
 *
 * Generator is not evaluator, and no implementation lane self-certifies. Those are harness
 * invariants; this module is where they stop being prose. A verdict here is the difference
 * between a review that could have found something and a run agreeing with itself.
 *
 * ## Why the seam is in the identity but not in the rule
 *
 * A run reaches the fleet through one of two seams: `subagents`, the autonomous vendor CLIs
 * metered by quota window, and `llm`, the API-key and local models metered per token (#33, #34).
 * They differ in what they are, what they cost, and what running out of them means — which is
 * exactly why the rule must not be written in terms of them. Two runs on the same seam can be
 * opposite-family (Fable reviewing Codex), and two runs on *different* seams can be the same
 * family (a Claude-CLI relay run and a local llama run, both GLM). A rule that compared seams
 * would get both of those backwards.
 *
 * So the seam travels in `RunIdentity` because a run's identity is data, not prose, and callers
 * need it for metering and for reporting. The rule itself reads family off the model — see
 * the document's model bindings for why that is the load-bearing choice — and is therefore structural: it holds
 * across seams, across harnesses, and across transports without a special case for any of them.
 */

import type { Harness } from "@rickylabs/subagents";

import { familyOf, isApprovedOpenEvaluator } from "./configuration.js";
import type { RoutingConfiguration, ModelFamily, Transport } from "./schema.js";
import type { Certifies } from "./schema.js";

/** The two metering seams. See AGENTS.md for the full topology. */
export const SEAMS = ["subagents", "llm"] as const;
export type Seam = (typeof SEAMS)[number];

/**
 * Who ran what, and how.
 *
 * A union rather than an optional `harness`, because the two seams genuinely differ: a subagent
 * run is always launched by a named vendor CLI, and an `llm` run has no CLI at all. Making the
 * harness optional would let a subagent run omit the one field that decides how it is metered.
 */
export type RunIdentity =
  | {
      readonly runId: string;
      readonly seam: "subagents";
      readonly harness: Harness;
      readonly model: string;
      readonly transport: Transport;
    }
  | {
      readonly runId: string;
      readonly seam: "llm";
      readonly model: string;
      readonly transport: Transport;
    };

/** The family a run belongs to, or `null` when its model is not one this package pins. */
export function familyOfRun(configuration: RoutingConfiguration, run: RunIdentity): ModelFamily | null {
  return familyOf(configuration, run.model);
}

/** A proposed pairing: `evaluator` is being asked to certify `author`'s work. */
export interface EvaluatorAssignment {
  readonly author: RunIdentity;
  readonly evaluator: RunIdentity;
  /**
   * What the evaluator's step is allowed to certify, from the lane's chain. Omitted checks the
   * structural rule alone; `"none"` is refused outright, because a step that certifies nothing
   * cannot be the thing that certifies this.
   */
  readonly certifies?: Certifies;
}

/** Which side of a pairing a complaint is about. */
export type AssignmentSide = "author" | "evaluator";

/** The outcome of `checkEvaluator`. Refusals carry the evidence, so a caller can report it. */
export type EvaluatorVerdict =
  | { readonly ok: true; readonly authorFamily: ModelFamily; readonly evaluatorFamily: ModelFamily }
  /** One run cannot review itself, whatever it is running. */
  | { readonly ok: false; readonly reason: "same-run"; readonly runId: string }
  /** A model this package does not pin is a model it cannot place, and so cannot certify with. */
  | { readonly ok: false; readonly reason: "unpinned-model"; readonly side: AssignmentSide; readonly model: string }
  /** Supplementary evidence was handed a gate. It runs and is read; it does not certify. */
  | { readonly ok: false; readonly reason: "not-a-gate" }
  /** The invariant itself. */
  | { readonly ok: false; readonly reason: "same-family"; readonly family: ModelFamily }
  /** The seat exists but is bound to a different author family. */
  | {
      readonly ok: false;
      readonly reason: "wrong-author-family";
      readonly certifies: ModelFamily;
      readonly authorFamily: ModelFamily;
    }
  /** A relay seat running an open model that has not been approved to certify anything. */
  | { readonly ok: false; readonly reason: "unapproved-open-evaluator"; readonly model: string };

/**
 * Whether `evaluator` may certify `author`'s work.
 *
 * Returns a verdict rather than throwing. The fleet's resolver throws on every one of these, and
 * the difference matters at the coordinator: a refused pairing is a routing fact to record and
 * fall back from, not an exception to unwind a run around.
 */
export function checkEvaluator(configuration: RoutingConfiguration, assignment: EvaluatorAssignment): EvaluatorVerdict {
  const { author, evaluator, certifies } = assignment;

  if (author.runId === evaluator.runId) {
    return { ok: false, reason: "same-run", runId: author.runId };
  }

  const authorFamily = familyOf(configuration, author.model);
  if (authorFamily === null) {
    return { ok: false, reason: "unpinned-model", side: "author", model: author.model };
  }

  const evaluatorFamily = familyOf(configuration, evaluator.model);
  if (evaluatorFamily === null) {
    return { ok: false, reason: "unpinned-model", side: "evaluator", model: evaluator.model };
  }

  if (certifies === "none") {
    return { ok: false, reason: "not-a-gate" };
  }

  if (authorFamily === evaluatorFamily) {
    return { ok: false, reason: "same-family", family: authorFamily };
  }

  if (certifies !== undefined && certifies !== "any" && certifies !== authorFamily) {
    return { ok: false, reason: "wrong-author-family", certifies, authorFamily };
  }

  if (evaluator.transport === "openrouter" && !isApprovedOpenEvaluator(configuration, evaluator.model)) {
    return { ok: false, reason: "unapproved-open-evaluator", model: evaluator.model };
  }

  return { ok: true, authorFamily, evaluatorFamily };
}
