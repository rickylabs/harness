/** Revalidate the recorded prerequisites of the canonical milestone dispatch, without I/O. */
import { admit, settle, statesOf, type AdmissionRule, type SettleRule, type StepState } from "./plan.js";
import { checkWorkflow, MILESTONE_WORKFLOW, prerequisites, type Problem } from "./workflow.js";

export type AdmissionFailure =
  | { readonly kind: "workflow-invalid"; readonly problems: readonly Problem[] }
  | { readonly kind: "state-malformed"; readonly detail: string }
  | { readonly kind: "evidence-invalid"; readonly step: string; readonly rule: SettleRule; readonly detail: string }
  | { readonly kind: "inadmissible"; readonly rule: AdmissionRule; readonly detail: string };
export type DispatchAdmission =
  | { readonly ok: true; readonly states: readonly StepState[] }
  | { readonly ok: false; readonly failure: AdmissionFailure };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(d => "value" in d);
}

export function admissibleDispatch(input: readonly StepState[]): DispatchAdmission {
  const workflow = MILESTONE_WORKFLOW;
  const problems = checkWorkflow(workflow);
  if (problems.length) return { ok: false, failure: { kind: "workflow-invalid", problems } };
  const malformed = (): DispatchAdmission => ({ ok: false, failure: { kind: "state-malformed", detail: "expected unique canonical step ids, valid outcomes, string citations and nullable notes" } });
  try {
    if (!Array.isArray(input) || !Object.values(Object.getOwnPropertyDescriptors(input)).every(d => "value" in d)) return malformed();
    const seen = new Set<string>();
    for (const state of input) {
      if (!record(state) || typeof state.id !== "string" || seen.has(state.id) ||
          !workflow.steps.some(s => s.id === state.id) ||
          !["pending", "done", "blocked", "forked"].includes(state.outcome as string) ||
          !record(state.citations) || !Object.values(state.citations).every(c => typeof c === "string") ||
          !(state.note === null || typeof state.note === "string")) return malformed();
      seen.add(state.id);
    }
    const given = structuredClone(input);
    // Preserve the original terminal propagation and own-state refusal before replay.
    const first = admit(workflow, given, "dispatch-run");
    if (!first.admitted) return { ok: false, failure: { kind: "inadmissible", rule: first.rule, detail: first.detail } };
    const upstream = prerequisites(workflow, "dispatch-run");
    if (given.some(s => !upstream.includes(s.id) && s.outcome !== "pending")) return malformed();
    let rebuilt = statesOf(workflow, given.filter(s => s.outcome === "pending"));
    for (const id of upstream) {
      const state = given.find(s => s.id === id);
      if (state?.outcome !== "done") continue;
      const result = settle(workflow, rebuilt, id, { outcome: "done", citations: state.citations });
      if (!result.settled) return { ok: false, failure: { kind: "evidence-invalid", step: id, rule: result.rule, detail: result.detail } };
      rebuilt = result.states;
    }
    if (given.some(s => s.outcome === "done" && !rebuilt.some(r => r.id === s.id && r.outcome === "done"))) return malformed();
    const final = admit(workflow, rebuilt, "dispatch-run");
    if (!final.admitted) return { ok: false, failure: { kind: "inadmissible", rule: final.rule, detail: final.detail } };
    return { ok: true, states: rebuilt.filter(s => upstream.includes(s.id)) };
  } catch { return malformed(); }
}
