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
 *
 * Around the gate sits the journal: every decision written down with the inputs it was made from, so
 * it can be fed back through the same code and the answers compared. That is the difference between
 * a system that logs what it did and one that can be asked whether it would do it again.
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

export { renderComparison, renderDecision, renderReplay } from "./render.js";

export {
  parseRoster,
  readRoster,
  ROSTER_NOTE_CAP,
  type ParsedRoster,
  type Roster,
} from "./roster.js";

export {
  canonicalJson,
  differences,
  digest,
  CircularValueError,
  DIFF_PATH_CAP,
  DIGEST_LENGTH,
} from "./canonical.js";

export {
  compareJournals,
  decisionOf,
  journalLine,
  parseJournal,
  planDigest,
  JOURNAL_NOTE_CAP,
  type Change,
  type JournalComparison,
  type ParsedJournal,
  type PersistedDecision,
} from "./journal.js";

export {
  evaluatorEntry,
  replayJournal,
  DECIDERS,
  EVALUATOR_DECIDER,
  type Decider,
  type Divergence,
  type ReplayResult,
  type ReplayVerdict,
  type Rerun,
  type Unreplayable,
} from "./replay.js";
