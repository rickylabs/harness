/**
 * What may run next, and — more to the point — what may not.
 *
 * `workflow.ts` says what the steps are. This says which of them the current state admits, and it is
 * a pure function of the two: the same workflow and the same state produce the same plan, on Tuesday
 * as on Monday, in CI as on the N5. That is what makes it journallable (`replay.ts`) and it is why
 * nothing here reads a clock, a file or the network.
 *
 * Three doctrine commitments are executable in this file, and each one is a named refusal rather
 * than a warning:
 *
 * - **Principle 5, nothing mutates before the gate.** `ungated-effect` walks an effect's *transitive*
 *   prerequisites and refuses while any gate among them is unpassed. Checking only direct needs would
 *   be satisfied by a hand-edited state file marking one step done, which is exactly the case the
 *   principle is about.
 * - **Principle 3, citations or it is not a claim.** `settle` will not record a step done without a
 *   citation for every piece of evidence its definition declares, and each citation must parse as a
 *   reference to something — a URL, an issue, a run, a file, or a sha (`citation.ts`). It names what
 *   was not cited, what does not refer to anything, and what refers to the wrong kind of thing. What
 *   it does not do is check that the thing referred to exists: that needs the network, and this file
 *   stays pure so the plan remains journallable.
 * - **Principle 4, owner forks are raised, not resolved.** A forked step is terminal for its branch.
 *   Nothing downstream becomes runnable, no default is chosen, and the fork is surfaced by name so it
 *   can be routed to the issue bridge in #37.
 */

import { CITATION_FORMS, parseCitation } from "./citation.js";
import { evidenceKind, evidenceName, prerequisites, type Step, type Workflow } from "./workflow.js";

export type Outcome =
  /** Not yet run. */
  | "pending"
  /** Ran, succeeded, cited. */
  | "done"
  /** A gate refused, or the work failed. Terminal for everything downstream. */
  | "blocked"
  /** An owner decision is required. Terminal for this branch until a human answers. */
  | "forked";

export interface StepState {
  readonly id: string;
  readonly outcome: Outcome;
  /**
   * Evidence name to citation. Keyed rather than a free list, so "cited" is checkable: a step that
   * declares `["roster", "decision"]` and hands back one URL is missing something specific, and this
   * says which.
   *
   * Values that `settle` admitted parse as references (`citation.ts`). Values that arrive through
   * `readStates` may not: a state file written before #203, or by hand, can hold anything, and that
   * reader keeps such a value and notes it rather than dropping it — dropping would rewrite history
   * into something better-looking than what happened.
   */
  readonly citations: Readonly<Record<string, string>>;
  /** Why it refused or forked. Required for both — a refusal with no reason cannot be acted on. */
  readonly note: string | null;
}

export type AdmissionRule =
  | "unknown-step"
  | "already-settled"
  | "upstream-forked"
  | "upstream-blocked"
  | "ungated-effect"
  | "needs-unmet";

export type Admission =
  | { readonly admitted: true; readonly step: string; readonly because: string }
  | { readonly admitted: false; readonly step: string; readonly rule: AdmissionRule; readonly detail: string };

export type SettleRule =
  | AdmissionRule
  /** Declared evidence with nothing cited for it at all. */
  | "uncited"
  /** Something was cited, but it does not refer to anything a later reader could follow. */
  | "unreferenced"
  /** A reference of the wrong kind: a URL where the step must cite the commit it landed. */
  | "miscited"
  | "unexplained-refusal";

export type StepResult =
  | { readonly outcome: "done"; readonly citations: Readonly<Record<string, string>> }
  | { readonly outcome: "blocked"; readonly note: string }
  | { readonly outcome: "forked"; readonly note: string };

export type Settlement =
  | { readonly settled: true; readonly states: readonly StepState[] }
  | { readonly settled: false; readonly rule: SettleRule; readonly detail: string };

function pending(id: string): StepState {
  return { id, outcome: "pending", citations: {}, note: null };
}

/**
 * Every workflow step in declaration order, with the state given for it or `pending`.
 *
 * States arrive from a file, so they are incomplete, out of order, and sometimes about steps that no
 * longer exist. Normalising here means every function below can index by id and read declaration
 * order off the workflow, which is what keeps the output stable across two runs that were handed the
 * same facts in a different sequence.
 */
export function statesOf(workflow: Workflow, given: readonly StepState[]): readonly StepState[] {
  const byId = new Map(given.map((state) => [state.id, state]));
  return workflow.steps.map((step) => byId.get(step.id) ?? pending(step.id));
}

function index(states: readonly StepState[]): Map<string, StepState> {
  return new Map(states.map((state) => [state.id, state]));
}

/**
 * May this step run?
 *
 * Rules are applied in a fixed order, and the order is a judgement: forks and blockers first because
 * they are terminal and a caller should stop rather than shop for another reason; then the gate rule,
 * because when both it and `needs-unmet` apply the gate is the more useful thing to be told; then
 * unmet prerequisites.
 */
export function admit(workflow: Workflow, states: readonly StepState[], id: string): Admission {
  const step = workflow.steps.find((s) => s.id === id);
  if (step === undefined) {
    return { admitted: false, step: id, rule: "unknown-step", detail: `${id} is not a step of ${workflow.name}` };
  }
  const byId = index(statesOf(workflow, states));
  const own = byId.get(id);
  if (own !== undefined && own.outcome !== "pending") {
    return {
      admitted: false,
      step: id,
      rule: "already-settled",
      detail: `already ${own.outcome}${own.note === null ? "" : `: ${own.note}`}`,
    };
  }

  const upstream = prerequisites(workflow, id);
  const forked = upstream.find((need) => byId.get(need)?.outcome === "forked");
  if (forked !== undefined) {
    return {
      admitted: false,
      step: id,
      rule: "upstream-forked",
      detail: `${forked} raised an owner fork: ${byId.get(forked)?.note ?? "no reason recorded"}`,
    };
  }
  const blocked = upstream.find((need) => byId.get(need)?.outcome === "blocked");
  if (blocked !== undefined) {
    return {
      admitted: false,
      step: id,
      rule: "upstream-blocked",
      detail: `${blocked} is blocked: ${byId.get(blocked)?.note ?? "no reason recorded"}`,
    };
  }

  if (step.kind === "effect") {
    const gate = upstream.find(
      (need) => workflow.steps.find((s) => s.id === need)?.kind === "gate" && byId.get(need)?.outcome !== "done",
    );
    if (gate !== undefined) {
      return {
        admitted: false,
        step: id,
        rule: "ungated-effect",
        detail: `${gate} has not passed — nothing mutates before the gate`,
      };
    }
  }

  const unmet = step.needs.find((need) => byId.get(need)?.outcome !== "done");
  if (unmet !== undefined) {
    return { admitted: false, step: id, rule: "needs-unmet", detail: `${unmet} is not done` };
  }

  return {
    admitted: true,
    step: id,
    because:
      step.kind === "effect"
        ? `every gate upstream of ${id} has passed`
        : `everything ${id} needs is done`,
  };
}

/** The steps that may run now, in declaration order. */
export function runnable(workflow: Workflow, states: readonly StepState[]): readonly string[] {
  return workflow.steps.filter((step) => admit(workflow, states, step.id).admitted).map((step) => step.id);
}

/**
 * Record an outcome, or refuse to.
 *
 * The refusals are the point. A step cannot be recorded done without a citation for every piece of
 * evidence it declares — one that refers to something, and to the right kind of something where the
 * step says which — and cannot be recorded blocked or forked without a reason, because an
 * unexplained refusal is indistinguishable from a crash and gets treated as one.
 */
export function settle(
  workflow: Workflow,
  states: readonly StepState[],
  id: string,
  result: StepResult,
): Settlement {
  const admission = admit(workflow, states, id);
  if (!admission.admitted) {
    return { settled: false, rule: admission.rule, detail: admission.detail };
  }
  const step = workflow.steps.find((s) => s.id === id) as Step;

  if (result.outcome === "done") {
    const uncited: string[] = [];
    const unreferenced: string[] = [];
    const miscited: string[] = [];

    for (const spec of step.evidence) {
      const name = evidenceName(spec);
      const cited = result.citations[name];
      if (typeof cited !== "string" || cited.trim().length === 0) {
        uncited.push(name);
        continue;
      }
      const citation = parseCitation(cited);
      if (citation === null) {
        unreferenced.push(`${name} (${JSON.stringify(cited.trim())})`);
        continue;
      }
      const wanted = evidenceKind(spec);
      if (wanted !== null && citation.kind !== wanted) {
        miscited.push(`${name} (wanted a ${wanted}, got a ${citation.kind})`);
      }
    }

    // One rule at a time, most fundamental first. All three can be true at once, and an agent handed
    // three complaints tends to fix the last one; an agent handed "you cited nothing for regime"
    // fixes that and comes back. The order is also the order the fixes have to happen in — there is
    // no point saying a citation is the wrong kind of thing to somebody who has not written one.
    if (uncited.length > 0) {
      return {
        settled: false,
        rule: "uncited",
        detail: `${id} claims to be done but cites no ${uncited.join(", ")} — citations or it is not a claim`,
      };
    }
    if (unreferenced.length > 0) {
      return {
        settled: false,
        rule: "unreferenced",
        detail:
          `${id} cites ${unreferenced.join(", ")}, which refers to nothing a reader could follow — ` +
          `a citation is ${CITATION_FORMS}`,
      };
    }
    if (miscited.length > 0) {
      return {
        settled: false,
        rule: "miscited",
        detail: `${id} cites ${miscited.join(", ")}`,
      };
    }
  } else if (result.note.trim().length === 0) {
    return {
      settled: false,
      rule: "unexplained-refusal",
      detail: `${id} is ${result.outcome} with no reason recorded — nobody can act on that`,
    };
  }

  const next: StepState =
    result.outcome === "done"
      ? { id, outcome: "done", citations: { ...result.citations }, note: null }
      : { id, outcome: result.outcome, citations: {}, note: result.note.trim() };

  return {
    settled: true,
    states: statesOf(workflow, states).map((state) => (state.id === id ? next : state)),
  };
}

export interface Waiting {
  readonly id: string;
  readonly rule: AdmissionRule;
  readonly detail: string;
}

export interface Halt {
  readonly id: string;
  readonly note: string;
}

export interface Plan {
  readonly workflow: string;
  readonly complete: boolean;
  readonly runnable: readonly string[];
  readonly done: readonly string[];
  /** Owner decisions. These are raised and routed, never resolved here. */
  readonly forks: readonly Halt[];
  readonly blocked: readonly Halt[];
  readonly waiting: readonly Waiting[];
}

/**
 * The whole state of a run, as one value.
 *
 * This is what goes in the journal: inputs are the workflow name and the states, output is this. Two
 * of them can then be diffed, and "the plan changed" gets attributed to the state that changed rather
 * than asserted. It is also the answer to "status ?" — which is the entire reason this milestone
 * exists.
 */
export function planOf(workflow: Workflow, given: readonly StepState[]): Plan {
  const states = statesOf(workflow, given);
  const byId = index(states);
  const done: string[] = [];
  const forks: Halt[] = [];
  const blocked: Halt[] = [];
  const ready: string[] = [];
  const waiting: Waiting[] = [];

  for (const step of workflow.steps) {
    const state = byId.get(step.id) ?? pending(step.id);
    if (state.outcome === "done") {
      done.push(step.id);
      continue;
    }
    if (state.outcome === "forked") {
      forks.push({ id: step.id, note: state.note ?? "no reason recorded" });
      continue;
    }
    if (state.outcome === "blocked") {
      blocked.push({ id: step.id, note: state.note ?? "no reason recorded" });
      continue;
    }
    const admission = admit(workflow, states, step.id);
    if (admission.admitted) ready.push(step.id);
    else waiting.push({ id: step.id, rule: admission.rule, detail: admission.detail });
  }

  return {
    workflow: workflow.name,
    complete: done.length === workflow.steps.length,
    runnable: ready,
    done,
    forks,
    blocked,
    waiting,
  };
}

export interface ParsedStates {
  readonly states: readonly StepState[];
  readonly notes: readonly string[];
}

/** How many unreadable entries are named individually before the rest are counted. */
export const STATE_NOTE_CAP = 5;

const OUTCOMES: readonly string[] = ["pending", "done", "blocked", "forked"];

/**
 * Read a state document: `{ "workflow": "milestone", "steps": [ ... ] }`.
 *
 * Entries are dropped by index rather than the file being refused, for the reason `roster.ts` gives:
 * a coordinator that turns one typo into an outage has made a worse trade than one that says which
 * line it ignored. Dropping a state is safe in the direction that matters — an unread step is
 * `pending`, so the effect of a bad line is that less runs, never that more does.
 */
export function parseStates(text: string): ParsedStates {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { states: [], notes: [`state is not JSON: ${(error as Error).message}`] };
  }
  return readStates(parsed);
}

/** The same reader over an already-parsed value, so replay does not round-trip through a string. */
export function readStates(parsed: unknown): ParsedStates {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { states: [], notes: ['state is not a JSON object — expected { "steps": [ ... ] }'] };
  }
  const raw = (parsed as Record<string, unknown>)["steps"];
  if (!Array.isArray(raw)) {
    return { states: [], notes: ['state has no "steps" array'] };
  }

  const states: StepState[] = [];
  const notes: string[] = [];
  const unreferenced: string[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  let named = 0;
  const drop = (at: number, why: string): void => {
    dropped += 1;
    if (named < STATE_NOTE_CAP) {
      named += 1;
      notes.push(`step ${at} dropped: ${why}`);
    }
  };

  for (const [at, entry] of raw.entries()) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      drop(at, "not a JSON object");
      continue;
    }
    const source = entry as Record<string, unknown>;
    const id = typeof source["id"] === "string" ? source["id"].trim() : "";
    if (id.length === 0) {
      drop(at, "no id");
      continue;
    }
    const outcome = typeof source["outcome"] === "string" ? source["outcome"].trim() : "";
    if (!OUTCOMES.includes(outcome)) {
      drop(at, `${id} has outcome ${JSON.stringify(source["outcome"])} — expected ${OUTCOMES.join(", ")}`);
      continue;
    }
    if (seen.has(id)) {
      drop(at, `duplicate id ${id} — the first entry is kept`);
      continue;
    }
    seen.add(id);

    const citations: Record<string, string> = {};
    const rawCitations = source["citations"];
    if (typeof rawCitations === "object" && rawCitations !== null && !Array.isArray(rawCitations)) {
      for (const [name, value] of Object.entries(rawCitations as Record<string, unknown>)) {
        if (typeof value !== "string" || value.trim().length === 0) continue;
        citations[name] = value.trim();
        // Kept, not dropped, and this is the asymmetry with everything else in this reader. A state
        // file predating #203 — or one a person edited — can hold `"see the PR"` against a step
        // already recorded done, and `settle` is not run again on the way in. Dropping it would
        // leave the step done and *silently* uncited, which reads as a clean run; keeping it leaves
        // the record intact and says out loud that the claim was never checkable.
        if (parseCitation(value) === null) unreferenced.push(`${id}.${name} cites ${JSON.stringify(value.trim())}`);
      }
    }
    const note = typeof source["note"] === "string" && source["note"].trim().length > 0 ? source["note"].trim() : null;
    states.push({ id, outcome: outcome as Outcome, citations, note });
  }

  if (dropped > named) notes.push(`${dropped} step(s) dropped in total`);
  // After the drop notes, so the existing contract — dropped entries first, then their tally — holds
  // whatever the citations look like.
  for (const line of unreferenced.slice(0, STATE_NOTE_CAP)) notes.push(`kept but unreferenced: ${line}`);
  if (unreferenced.length > STATE_NOTE_CAP) {
    notes.push(`${unreferenced.length} citation(s) refer to nothing in total`);
  }
  return { states, notes };
}
