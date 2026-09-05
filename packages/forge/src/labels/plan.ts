/**
 * The planner. Pure: it takes what is desired and what exists and returns what to do, so the
 * decision can be tested and printed without touching GitHub.
 *
 * Two rules it will not break. **It never deletes.** Deleting a label strips it off every issue
 * that carried it, which is silent data loss dressed up as tidying; a label that should go away is
 * retired instead — see `retire` below — and removed, if ever, by a human who has looked at what
 * still uses it. And it never silently overwrites a description a human wrote — that becomes a
 * `conflict` the operator has to settle, not an `update` that happens while they are not looking.
 */

import type { ExistingLabel } from "./github.js";
import { type LabelSpec, normalizeColor } from "./taxonomy.js";

export type ActionKind =
  | "create"
  | "update"
  | "keep"
  | "conflict"
  /**
   * Rewrite a retired label's description in place, so the label list itself names the successor.
   *
   * This is the whole of what retiring does on GitHub, and it is deliberately not a delete. The
   * label stays, every item that carried it keeps carrying it, and the one thing that changes is
   * that anyone who opens the label picker is told what to reach for instead.
   */
  | "retire";

export interface LabelAction {
  readonly kind: ActionKind;
  readonly spec: LabelSpec;
  readonly current?: ExistingLabel;
  /** Why this action, in one clause, for the printed plan. */
  readonly reason: string;
}

export interface LabelPlan {
  readonly actions: readonly LabelAction[];
  /** Labels already on the repo that this taxonomy does not describe. Reported, never touched. */
  readonly unmanaged: readonly ExistingLabel[];
  readonly counts: Readonly<Record<ActionKind, number>>;
}

/**
 * Descriptions GitHub itself seeds on a new repository. Overwriting one of these is housekeeping,
 * not clobbering someone's intent, so they do not raise a conflict.
 */
const GITHUB_DEFAULTS = new Set([
  "Something isn't working",
  "New feature or request",
  "Improvements or additions to documentation",
  "This issue or pull request already exists",
  "Extra attention is needed",
  "This doesn't seem right",
  "Further information is requested",
  "Good for newcomers",
  "This will not be worked on",
]);

const sameColor = (a: string, b: string) => normalizeColor(a) === normalizeColor(b);

export interface PlanOptions {
  /** Settle conflicts in favour of the taxonomy. Off by default; the operator has to mean it. */
  readonly force?: boolean;
  /** Bring colors into line. On by default — color is presentation, not authored meaning. */
  readonly reconcileColor?: boolean;
  /**
   * Labels the taxonomy has retired. Never created, never deleted; corrected in place where the
   * repository still has one, and ignored entirely where it does not.
   */
  readonly retired?: readonly LabelSpec[];
}

export function planLabels(
  desired: readonly LabelSpec[],
  existing: readonly ExistingLabel[],
  options: PlanOptions = {},
): LabelPlan {
  const force = options.force ?? false;
  const reconcileColor = options.reconcileColor ?? true;

  const byName = new Map(existing.map((l) => [l.name.toLowerCase(), l]));
  const claimed = new Set<string>();
  const actions: LabelAction[] = [];
  const seen = new Set<string>();

  // Retirements are settled first so a name can never be both. A taxonomy that still lists a label
  // it has also retired is a bug in the taxonomy, and the safe reading of it is the conservative
  // one: retired wins, so the mistake stops the label being stamped on new work rather than
  // quietly resurrecting it.
  for (const spec of options.retired ?? []) {
    const key = spec.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // Absent is the desired end state, not a gap to fill. Creating a label purely to mark it
    // retired would put this repository's history into one that never had it.
    const current = byName.get(key);
    if (!current) continue;
    claimed.add(key);

    if (current.description.trim() === spec.description.trim()) {
      actions.push({ kind: "keep", spec, current, reason: "already retired" });
      continue;
    }
    // Unlike `update`, this does not defer to an authored description, and `--force` is not
    // required to replace one. Retiring is itself the authored decision — the label's meaning is
    // what changed — so the old text is printed in the reason rather than defended.
    actions.push({
      kind: "retire",
      spec: reconcileColor ? spec : { ...spec, color: current.color },
      current,
      reason:
        `superseded by ${spec.supersededBy ?? "nothing"}; kept, never deleted — ` +
        `description was ${JSON.stringify(current.description.trim())}`,
    });
  }

  for (const spec of desired) {
    const key = spec.name.toLowerCase();
    if (seen.has(key)) continue; // a detected label may restate a core one; first wins
    seen.add(key);

    const current = byName.get(key);
    if (!current) {
      actions.push({ kind: "create", spec, reason: "absent from the repository" });
      continue;
    }
    claimed.add(key);

    const colorDiffers = !sameColor(current.color, spec.color);
    const descDiffers = current.description.trim() !== spec.description.trim();
    const authored =
      current.description.trim().length > 0 && !GITHUB_DEFAULTS.has(current.description.trim());

    if (!colorDiffers && !descDiffers) {
      actions.push({ kind: "keep", spec, current, reason: "already matches" });
      continue;
    }

    if (descDiffers && authored && !force) {
      actions.push({
        kind: "conflict",
        spec,
        current,
        reason: `existing description looks authored ("${current.description.trim()}") — rerun with --force to replace it`,
      });
      continue;
    }

    const parts: string[] = [];
    if (colorDiffers && reconcileColor) parts.push(`color ${normalizeColor(current.color)} -> ${normalizeColor(spec.color)}`);
    if (descDiffers) parts.push("description differs");
    if (parts.length === 0) {
      actions.push({ kind: "keep", spec, current, reason: "only color differs and color reconciliation is off" });
      continue;
    }
    actions.push({
      kind: "update",
      spec: reconcileColor ? spec : { ...spec, color: current.color },
      current,
      reason: parts.join(", "),
    });
  }

  const unmanaged = existing.filter((l) => !claimed.has(l.name.toLowerCase()));
  const counts: Record<ActionKind, number> = { create: 0, update: 0, keep: 0, conflict: 0, retire: 0 };
  for (const a of actions) counts[a.kind] += 1;

  return { actions, unmanaged, counts };
}

/** A plan is clean when the repository already carries the taxonomy. Used by `labels check`. */
export const isClean = (plan: LabelPlan): boolean =>
  plan.counts.create === 0 &&
  plan.counts.update === 0 &&
  plan.counts.conflict === 0 &&
  // A repository still advertising a retired label as live is drift like any other: the label
  // picker is where people learn the taxonomy, and one that still recommends a retired label
  // keeps producing items the board has to explain.
  plan.counts.retire === 0;

/** Render a plan for a terminal. Grouped by action so the interesting rows are not buried. */
export function formatPlan(plan: LabelPlan): string {
  const lines: string[] = [];
  const group = (kind: ActionKind, heading: string) => {
    const rows = plan.actions.filter((a) => a.kind === kind);
    if (rows.length === 0) return;
    lines.push(`${heading} (${rows.length})`);
    for (const a of rows) lines.push(`  ${a.spec.name.padEnd(28)} ${a.reason}`);
    lines.push("");
  };

  group("create", "create");
  group("update", "update");
  group("retire", "retire — kept on the repository, description rewritten to name the successor");
  group("conflict", "conflict — not applied");
  if (plan.counts.keep > 0) lines.push(`keep (${plan.counts.keep}) — already correct`, "");
  if (plan.unmanaged.length > 0) {
    lines.push(`unmanaged (${plan.unmanaged.length}) — present on the repo, not in this taxonomy, left alone`);
    lines.push(`  ${plan.unmanaged.map((l) => l.name).join(", ")}`, "");
  }
  return lines.join("\n").trimEnd();
}
