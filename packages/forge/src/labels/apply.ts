/**
 * Executing a plan.
 *
 * Apply is idempotent by construction: it only ever runs the `create` and `update` rows a planner
 * produced from live state, so a second run against an unchanged repository does nothing. It stops
 * at the first failure rather than pressing on, because a half-applied taxonomy that reports
 * success is worse than one that reports exactly where it stopped.
 */

import type { GitHubTransport } from "./github.js";
import type { LabelAction, LabelPlan } from "./plan.js";

export interface ApplyResult {
  readonly applied: readonly LabelAction[];
  readonly skipped: readonly LabelAction[];
  readonly failed: { readonly action: LabelAction; readonly error: string } | null;
}

export async function applyPlan(
  transport: GitHubTransport,
  repo: string,
  plan: LabelPlan,
): Promise<ApplyResult> {
  const applied: LabelAction[] = [];
  const skipped = plan.actions.filter((a) => a.kind === "keep" || a.kind === "conflict");

  for (const action of plan.actions) {
    if (action.kind !== "create" && action.kind !== "update") continue;
    const wire = {
      name: action.spec.name,
      color: action.spec.color,
      description: action.spec.description,
    };
    try {
      if (action.kind === "create") await transport.createLabel(repo, wire);
      else await transport.updateLabel(repo, action.current?.name ?? action.spec.name, wire);
      applied.push(action);
    } catch (error) {
      return {
        applied,
        skipped,
        failed: { action, error: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  return { applied, skipped, failed: null };
}
