/**
 * The decision, written down.
 *
 * #72's second acceptance item is that the selection is *recorded on the run*, and that word is
 * doing real work. A gate whose verdict lives only in the process that made it is a gate nobody can
 * audit afterwards: the run finishes, the reviewer is named nowhere, and six weeks later the only
 * evidence that the rule was applied is that somebody says it was. Principle 2 — a conclusion that
 * exists only in a conversation does not exist.
 *
 * The record carries the rejections as well as the choice. That is the expensive half and the half
 * worth keeping: "codex reviewed it" is an outcome, while "codex reviewed it because the two
 * anthropic candidates were the author's own family and the relay candidate was not open-weights"
 * is a decision that can be checked, and re-derived, and disagreed with.
 *
 * The transport is a telemetry event rather than a call into `@rickylabs/telemetry`. Coordinator
 * imports only the published contracts types; this telemetry boundary remains the boundary is one
 * line of JSON on a pipe, which the telemetry writer already accepts from the Go dispatcher and the
 * shell hooks. A structural shape, not an import.
 */

import type { EvaluatorDecision, Rejection } from "./independence.js";
import type { Admission, Plan } from "./plan.js";

/** An actor as it is kept: exactly the launch identity, no more, so the record stays comparable. */
export interface RecordedActor {
  readonly id: string;
  readonly seam: string;
  readonly family: string;
  readonly model: string;
  readonly effort: string | null;
}

export interface EvaluatorRecord {
  readonly at: string;
  readonly runId: string;
  /** Which rule was in force. A record that does not name its policy cannot be replayed. */
  readonly policy: string;
  readonly outcome: "selected" | "blocked";
  readonly author: RecordedActor;
  readonly evaluator: RecordedActor | null;
  readonly because: string;
  /** Only meaningful when blocked; `null` on a selection rather than a misleading `false`. */
  readonly transient: boolean | null;
  readonly rejected: readonly Rejection[];
}

/** The `kind` a telemetry event carries, so a reader can filter the stream for gate decisions. */
export const EVENT_KIND = "evaluator" as const;

function recorded(actor: {
  readonly id: string;
  readonly seam: string;
  readonly family: string;
  readonly model: string;
  readonly effort: string | null;
}): RecordedActor {
  return {
    id: actor.id,
    seam: actor.seam,
    family: actor.family,
    model: actor.model,
    effort: actor.effort,
  };
}

/**
 * Freeze a decision against a run and a timestamp.
 *
 * `at` is passed in rather than read from the clock so the record is a pure function of its inputs —
 * which is what lets the replay test in #71 compare two records for equality instead of comparing
 * them field by field with the timestamp carved out.
 */
export function recordOf(runId: string, at: string, decision: EvaluatorDecision): EvaluatorRecord {
  return {
    at,
    runId,
    policy: decision.policy,
    outcome: decision.kind,
    author: recorded(decision.author),
    evaluator: decision.kind === "selected" ? recorded(decision.evaluator) : null,
    because: decision.because,
    transient: decision.kind === "blocked" ? decision.transient : null,
    rejected: decision.rejected,
  };
}

/**
 * One JSONL line in the shape `dsh-telemetry record` reads.
 *
 * `{ runId, kind, at, detail }`. Everything else moves into `detail`, so the envelope stays the
 * one telemetry already knows and this package can add fields to the payload without a coordinated
 * change on the other side.
 */
export function telemetryLine(record: EvaluatorRecord): string {
  const { at, runId, ...detail } = record;
  return JSON.stringify({ runId, kind: EVENT_KIND, at, detail });
}

export const PLAN_EVENT_KIND = "plan" as const;
export const ADMIT_EVENT_KIND = "admit" as const;

/** The envelope, for a kind that is not the evaluator's. `kind` is an open field on the reader. */
function eventLine(kind: string, runId: string, at: string, detail: Record<string, unknown>): string {
  return JSON.stringify({ runId, kind, at, detail });
}

/**
 * What a plan decided, in one word.
 *
 * Exported and used for both the exit code and the event, so the two cannot disagree. Computing the
 * outcome separately from the exit status is how a recorded event comes to contradict the status the
 * caller branched on, and a telemetry line that disagrees with the process it came from is worse
 * than no line at all.
 */
export function planOutcome(plan: Plan): "complete" | "halted" | "runnable" | "stalled" {
  if (plan.complete) return "complete";
  if (plan.forks.length > 0 || plan.blocked.length > 0) return "halted";
  return plan.runnable.length > 0 ? "runnable" : "stalled";
}

/** One JSONL line for what `plan` decided. */
export function planTelemetryLine(runId: string, at: string, plan: Plan): string {
  return eventLine(PLAN_EVENT_KIND, runId, at, {
    workflow: plan.workflow,
    outcome: planOutcome(plan),
    complete: plan.complete,
    runnable: plan.runnable,
    done: plan.done,
    forks: plan.forks,
    blocked: plan.blocked,
    waiting: plan.waiting,
  });
}

/** One JSONL line for what `admit` decided about one step. */
export function admitTelemetryLine(runId: string, at: string, admission: Admission): string {
  return eventLine(ADMIT_EVENT_KIND, runId, at, admission.admitted
    ? { outcome: "admitted", step: admission.step, because: admission.because }
    : { outcome: "refused", step: admission.step, rule: admission.rule, detail: admission.detail });
}
