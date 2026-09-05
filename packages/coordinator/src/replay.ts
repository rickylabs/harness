/**
 * Feed the persisted inputs back through the same code and see whether the same thing comes out.
 *
 * This is #71's second acceptance item, and it is the one that cannot be faked. A journal proves
 * what the coordinator *said*; only a replay proves the coordinator would say it again. The two come
 * apart the moment something reads a clock, a filesystem, an environment variable or a `Math.random`
 * — and every one of those arrives as an innocent-looking convenience inside a decider, never as a
 * line of code labelled "nondeterminism".
 *
 * A decider is registered per `kind`, so a journal from a system with more deciders than this build
 * has is **not** silently declared clean. Entries nobody can re-run come back named, and a replay
 * where nothing at all could be re-run is a broken check, which is not the same as a passing one —
 * the same distinction `scripts/check-lifecycle.mjs` already makes at the workspace level.
 */

import { differences } from "./canonical.js";
import {
  OPPOSITE_FAMILY,
  SEAM_OR_FAMILY,
  selectEvaluator,
  type EvaluatorDecision,
  type IndependencePolicy,
} from "./independence.js";
import { decisionOf, type PersistedDecision } from "./journal.js";
import { readRoster, type Roster } from "./roster.js";

/** What a decider hands back: the output it recomputed, or why it could not. */
export type Rerun = { readonly output: unknown } | { readonly unreadable: string };

export interface Decider {
  readonly kind: string;
  readonly rerun: (inputs: Readonly<Record<string, unknown>>) => Rerun;
}

const POLICIES: readonly IndependencePolicy[] = [OPPOSITE_FAMILY, SEAM_OR_FAMILY];

/**
 * The evaluator gate, replayed.
 *
 * The inputs are the roster and the policy name — the arguments `selectEvaluator` was called with,
 * and nothing else. The run id and the timestamp are not among them, deliberately: the same fleet on
 * Tuesday chooses the same evaluator it chose on Monday, and a journal that said otherwise would be
 * recording the calendar rather than the rule. They live in the entry's own `id` and `at`, outside
 * both digests, where they belong.
 *
 * The persisted output is the decision itself rather than the telemetry record wrapped around it,
 * for the same reason. A record carries a run id and a time; comparing two of those would require
 * carving out the two fields that are *supposed* to differ, and a comparison with an exception
 * carved into it is a comparison somebody will widen later.
 */
export const EVALUATOR_DECIDER: Decider = {
  kind: "evaluator",
  rerun: (inputs) => {
    const policyName = inputs["policy"];
    const policy = POLICIES.find((p) => p.name === policyName);
    if (policy === undefined) return { unreadable: `unknown policy ${JSON.stringify(policyName)}` };
    const parsed = readRoster(inputs["roster"]);
    if (parsed.roster === null) {
      return { unreadable: parsed.notes[0] ?? "the roster in this entry could not be read" };
    }
    return { output: selectEvaluator(parsed.roster.author, parsed.roster.candidates, policy) };
  },
};

export const DECIDERS: readonly Decider[] = [EVALUATOR_DECIDER];

/**
 * The writer for the entry `EVALUATOR_DECIDER` reads, kept next to it on purpose.
 *
 * A journal writer and its replayer that live in different files drift, and the drift is invisible:
 * both sides keep working, the replay keeps passing, and it stops being a check of anything. Here
 * the two are ten lines apart and a change to either is a change to a diff somebody reviews.
 *
 * The roster written down is the **parsed** one, not the file that produced it. A file may hold a
 * malformed candidate that was dropped or a duplicate id that was skipped, and persisting the file
 * would mean replaying a roster the decision never saw — the replay would then diverge for a reason
 * that has nothing to do with determinism.
 */
export function evaluatorEntry(
  id: string,
  at: string,
  roster: Roster,
  policy: IndependencePolicy,
  decision: EvaluatorDecision,
): PersistedDecision {
  return decisionOf(
    id,
    EVALUATOR_DECIDER.kind,
    at,
    { policy: policy.name, roster: { author: roster.author, candidates: roster.candidates } },
    decision,
  );
}

export interface Divergence {
  readonly id: string;
  readonly kind: string;
  /** Where the replayed output differs from the persisted one, by name. */
  readonly at: readonly string[];
}

export interface Unreplayable {
  readonly id: string;
  readonly kind: string;
  readonly why: string;
}

export type ReplayVerdict =
  /** Everything that could be re-run came back the same. */
  | "identical"
  /** Something came back different from the same inputs. The code is not deterministic. */
  | "divergent"
  /** Nothing could be re-run at all. A broken check, not a passing one. */
  | "unchecked";

export interface ReplayResult {
  readonly verdict: ReplayVerdict;
  readonly checked: number;
  readonly total: number;
  readonly divergent: readonly Divergence[];
  readonly unreplayable: readonly Unreplayable[];
}

/**
 * Re-run every decision in the journal that this build knows how to re-run.
 *
 * Note what `checked` counts and what it does not: an entry with no registered decider is not a
 * pass. It is reported, it is excluded from `checked`, and if it is the only kind of entry present
 * the verdict is `unchecked`. A determinism check that returns "clean" for a journal it could not
 * read is worse than no check, because somebody will cite it.
 */
export function replayJournal(
  decisions: readonly PersistedDecision[],
  deciders: readonly Decider[] = DECIDERS,
): ReplayResult {
  const byKind = new Map(deciders.map((d) => [d.kind, d]));
  const divergent: Divergence[] = [];
  const unreplayable: Unreplayable[] = [];
  let checked = 0;

  for (const decision of decisions) {
    const decider = byKind.get(decision.kind);
    if (decider === undefined) {
      unreplayable.push({ id: decision.id, kind: decision.kind, why: `no decider registered for "${decision.kind}"` });
      continue;
    }
    const rerun = decider.rerun(decision.inputs);
    if ("unreadable" in rerun) {
      unreplayable.push({ id: decision.id, kind: decision.kind, why: rerun.unreadable });
      continue;
    }
    checked += 1;
    const at = differences(decision.output, rerun.output);
    if (at.length > 0) divergent.push({ id: decision.id, kind: decision.kind, at });
  }

  const verdict: ReplayVerdict = divergent.length > 0 ? "divergent" : checked === 0 ? "unchecked" : "identical";
  return { verdict, checked, total: decisions.length, divergent, unreplayable };
}
