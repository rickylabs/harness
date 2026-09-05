/**
 * @rickylabs/coordinator — MASTER agent — milestone → epic → task workflows.
 *
 * Owned by E6 · #36. The first thing in it is not a workflow but a **gate**: evaluator
 * independence, from `doctrine/WORKFLOW.md`, turned from a sentence addressed to the author into a
 * function that returns a blocker. Everything else this package will grow — decompose, dispatch,
 * review, land — passes through gates, and a workflow engine whose gates are advisory is an
 * automation engine wearing a governance hat.
 *
 * The package deliberately depends on nothing else in this workspace. The board projects GitHub,
 * telemetry says what ran, and the coordinator decides; the two places those meet are a JSON roster
 * coming in and a telemetry event going out, both of them structural shapes rather than imports.
 * That is what lets the gate run in CI with no credentials and no network, which is exactly when
 * skipping it is most tempting.
 */

/** Workspace package identifier. */
export const PACKAGE_NAME = "@rickylabs/coordinator" as const;

export type PackageName = typeof PACKAGE_NAME;

export {
  selectEvaluator,
  OPPOSITE_FAMILY,
  SEAM_OR_FAMILY,
  type Actor,
  type BlockedEvaluator,
  type Candidate,
  type EvaluatorDecision,
  type IndependencePolicy,
  type Rejection,
  type RuleId,
  type Seam,
  type SelectedEvaluator,
} from "./independence.js";

export {
  recordOf,
  telemetryLine,
  EVENT_KIND,
  type EvaluatorRecord,
  type RecordedActor,
} from "./record.js";

export { renderDecision } from "./render.js";

export { parseRoster, ROSTER_NOTE_CAP, type ParsedRoster, type Roster } from "./roster.js";
