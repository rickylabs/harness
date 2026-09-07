/**
 * @rickylabs/coordinator — MASTER agent — milestone → epic → task workflows.
 *
 * Owned by E6 · #36. The first thing in it is not a workflow but a **gate**: evaluator
 * independence, from `doctrine/WORKFLOW.md`, turned from a sentence addressed to the author into a
 * function that returns a blocker. Everything else this package will grow — decompose, dispatch,
 * review, land — passes through gates, and a workflow engine whose gates are advisory is an
 * automation engine wearing a governance hat.
 *
 * The package imports only the published contracts types from this workspace. The board projects GitHub,
 * telemetry says what ran, and the coordinator decides; the two places those meet are a JSON roster
 * coming in and a telemetry event going out, both of them structural shapes rather than imports.
 * That is what lets the gate run in CI with no credentials and no network, which is exactly when
 * skipping it is most tempting.
 *
 * Around the gate sits the journal: every decision written down with the inputs it was made from, so
 * it can be fed back through the same code and the answers compared. That is the difference between
 * a system that logs what it did and one that can be asked whether it would do it again.
 *
 * Around both sits the workflow: the milestone run written down as inert data, and a planner that is
 * a pure function of that definition and the current state. It decides what may run next and refuses
 * what may not; performing the steps is the daemon's job, and keeping those two apart is what makes
 * the deciding replayable at all.
 *
 * And underneath all of it, the worktree census: a run that takes three days looks exactly like
 * abandoned scratch to a housekeeping job that deletes on a 48h timer. Deciding which directories
 * are live is the same kind of question as the rest of this package — an answer that must be right
 * for a stated reason, because something acts on it — with the difference that being wrong here
 * destroys work rather than delaying it.
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

export {
  renderComparison,
  renderDecision,
  renderPlan,
  renderReplay,
  renderWorkflow,
  renderWorktrees,
} from "./render.js";

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
  planEntry,
  replayJournal,
  DECIDERS,
  EVALUATOR_DECIDER,
  PLAN_DECIDER,
  type Decider,
  type Divergence,
  type ReplayResult,
  type ReplayVerdict,
  type Rerun,
  type Unreplayable,
} from "./replay.js";

export {
  CITATION_FORMS,
  CITATION_KINDS,
  parseCitation,
  type Citation,
  type CitationKind,
} from "./citation.js";

export {
  checkWorkflow,
  evidenceKind,
  evidenceName,
  prerequisites,
  MILESTONE_WORKFLOW,
  WORKFLOWS,
  type EvidenceSpec,
  type Problem,
  type ProblemRule,
  type Stage,
  type Step,
  type StepKind,
  type Workflow,
} from "./workflow.js";

export {
  admit,
  parseStates,
  planOf,
  readStates,
  runnable,
  settle,
  statesOf,
  STATE_NOTE_CAP,
  type Admission,
  type AdmissionRule,
  type Halt,
  type Outcome,
  type ParsedStates,
  type Plan,
  type Settlement,
  type SettleRule,
  type StepResult,
  type StepState,
  type Waiting,
} from "./plan.js";

export {
  hazards,
  isWithin,
  judge,
  keepFileBody,
  layoutOf,
  misePathFor,
  normalizePath,
  ownerOf,
  parseCensus,
  readCensus,
  sweptByArchiver,
  unprotectedWorktrees,
  unregisteredSessions,
  CENSUS_NOTE_CAP,
  IDLE_LIMIT_HOURS,
  KEEP_FILE,
  PROTECTED_SESSIONS,
  type Census,
  type Disposition,
  type Hazard,
  type HazardRule,
  type Judgement,
  type JudgementRule,
  type Layout,
  type LayoutKind,
  type ParsedCensus,
  type Run,
  type WorktreeFact,
} from "./worktree.js";

export { intentEntryOf, receiptEntryOf, proofFromReceipt } from "./journal.js";
export { foldStore, settlePending, orphanPending, checkpointOf, genesisOf, readStoreRecord } from "./state-store.js";
export { FileStateStore, type FileStateStoreOptions, type StoreIOPoint } from "./state-store-fs.js";
export { MemoryStateStore } from "./state-store-memory.js";
export { admissibleDispatch, type AdmissionFailure, type DispatchAdmission } from "./dispatch-admission.js";
