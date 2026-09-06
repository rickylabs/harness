/**
 * @rickylabs/forge — GitHub bridge — absorbs the Orchid pipeline.
 *
 * Owned by E7 · #37. The board taxonomy lands ahead of that epic because it is the mechanism the
 * epic will drive: labels are the surface a dispatcher reads, and until they exist the coordinator
 * has nothing to write its decisions onto. Everything here is a library first and a CLI second —
 * `cli.ts` is a thin shell over these functions so the coordinator can call them in-process.
 */

/** Workspace package identifier. */
export const PACKAGE_NAME = "@rickylabs/forge" as const;

export type PackageName = typeof PACKAGE_NAME;

export {
  CLOSE_GATE_OVERRIDE,
  CORE_TAXONOMY,
  EVAL_LABELS,
  FLAG_LABELS,
  PRIORITY_LABELS,
  RETIRED_CLOSE_GATE_STATUS,
  RETIRED_LABELS,
  STATUS_LABELS,
  STATUS_LIFECYCLE,
  STATUS_TERMINAL,
  TYPE_LABELS,
  areaLabel,
  ciLabel,
  classifyStatus,
  epicLabel,
  gateLabel,
  isRetired,
  isValidColor,
  laneLabel,
  normalizeColor,
  slugify,
  statusLabelsOf,
  waveLabel,
  type LabelFamily,
  type LabelOrigin,
  type LabelSpec,
  type StatusVerdict,
} from "./labels/taxonomy.js";

export {
  detectRepoSlug,
  detectTransport,
  isAvailable,
  type ExistingLabel,
  type GitHubTransport,
  type IssueRef,
  type Milestone,
  type TransportKind,
  type TransportProbe,
  type TransportUnavailable,
} from "./labels/github.js";

export {
  detectLanePrefix,
  detectRepoLabels,
  detectSkillDirs,
  type DetectOptions,
  type DetectionResult,
  type Evidence,
} from "./labels/detect.js";

export {
  formatPlan,
  isClean,
  planLabels,
  type ActionKind,
  type LabelAction,
  type LabelPlan,
  type PlanOptions,
} from "./labels/plan.js";

export { applyPlan, type ApplyResult } from "./labels/apply.js";

export {
  ENDINGS,
  isEnding,
  settleEvent,
  settleStatus,
  type Ending,
  type EventSettlement,
  type Settlement,
} from "./labels/settle.js";

export {
  LABELS_FILE,
  familyOf,
  loadLabelsFile,
  parseLabelsFile,
  renderLabelsFile,
  type ParseIssue,
  type ParsedLabelsFile,
} from "./labels/file.js";

export {
  DEFAULT_TARGET_AGENT,
  TARGET_REFUSALS,
  accountOf,
  agentsOf,
  checkTargets,
  describeProblem,
  dispatchBranch,
  issueOfBranch,
  resolveTarget,
  type MemoryStore,
  type Target,
  type TargetMatch,
  type TargetProblem,
  type TargetRefusal,
  type TargetTable,
} from "./targets/model.js";

export {
  CONFIG_FILE,
  describeIssue,
  loadTargetsConfig,
  parseTargetsConfig,
  type ConfigIssue,
  type ConfigReader,
  type LoadedConfig,
  type ParsedConfig,
} from "./targets/config.js";

export {
  BRIDGE_DISPOSITIONS,
  reconcileBridge,
  tallyBridge,
  type BridgeCoverage,
  type BridgeDisposition,
  type BridgeItem,
  type BridgeSnapshot,
  type BridgeSource,
  type BridgeTally,
  type Delivery,
} from "./targets/reconcile.js";

export {
  BACKENDS,
  BACKEND_REASONS,
  EMPTY_LEDGER,
  HANDOVER_FILE,
  HANDOVER_REFUSALS,
  PARITY_ACCOUNTS,
  checkHandover,
  chooseBackend,
  chooseBackends,
  describeBackendReason,
  describeHandoverProblem,
  tallyHandover,
  type Backend,
  type BackendChoice,
  type BackendPin,
  type BackendReason,
  type HandoverLedger,
  type HandoverProblem,
  type HandoverRefusal,
  type HandoverTally,
  type ParityRecord,
} from "./targets/handover.js";

export {
  describeLedgerIssue,
  loadHandoverLedger,
  parseHandoverLedger,
  type LedgerIssue,
  type LedgerReader,
  type LoadedLedger,
  type ParsedLedger,
} from "./targets/ledger.js";

export { renderBridge, renderHandover, renderProblems, renderTable } from "./targets/render.js";

export {
  SKIPPED_REFUSALS,
  SWARM_REFUSALS,
  admitSwarmComments,
  attributionTrailers,
  describeRefusal as describeSwarmRefusal,
  findSourceIssue,
  isSkippedRefusal,
  issueOfUrl,
  refOfInboxTitle,
  renderMirror,
  repoOfIssueUrl,
  tallySwarm,
  truncate,
  type SwarmAdmission,
  type SwarmComment,
  type SwarmFeed,
  type SwarmInput,
  type SwarmMirror,
  type SwarmRefusal,
  type SwarmTally,
  type SwarmVerdict,
} from "./swarm/trigger.js";

export { renderMirrorPreview, renderTriggers } from "./swarm/render.js";

export {
  DEFAULT_SETTLE,
  DEFAULT_STUCK,
  DEFAULT_TIMEOUT,
  TEARDOWN_EVIDENCE,
  TEARDOWN_REFUSALS,
  TEARDOWN_STATES,
  TEARDOWN_STEPS,
  checkTeardown,
  describeTeardownEvidence,
  describeTeardownProblem,
  describeTeardownState,
  inboxIssues,
  planTeardown,
  span,
  tallyTeardown,
  type Artefact,
  type InboxIssue,
  type RunObservation,
  type Teardown,
  type TeardownEvidence,
  type TeardownInput,
  type TeardownProblem,
  type TeardownRefusal,
  type TeardownState,
  type TeardownStep,
  type TeardownTally,
  type TeardownVerdict,
} from "./swarm/teardown.js";

export { renderTeardown } from "./swarm/teardown-render.js";

export {
  CONFLICT_STATES,
  EMPTY_SEEN,
  EMPTY_STATE,
  FAILING_CONCLUSIONS,
  PULL_SIGNALS,
  STEERING_REVIEW_STATES,
  SUPERVISION_REASONS,
  SUPERVISION_REFUSALS,
  advanceState,
  checkSupervision,
  describeSupervisionProblem,
  describeSupervisionReason,
  pullKey,
  supervisePulls,
  tallySupervision,
  type ConflictState,
  type PaneRead,
  type PullCheck,
  type PullReview,
  type PullSignal,
  type SeenPull,
  type SteeringNote,
  type Supervision,
  type SupervisedPull,
  type SupervisionInput,
  type SupervisionProblem,
  type SupervisionReason,
  type SupervisionRefusal,
  type SupervisionState,
  type SupervisionTally,
  type SupervisionVerdict,
} from "./supervise/steer.js";

export {
  NOTHING_REDACTED,
  REDACTION,
  SECRET_KINDS,
  countSecrets,
  describeSecretKind,
  leaked,
  redact,
  type Redacted,
  type SecretHit,
  type SecretKind,
} from "./supervise/redact.js";

export {
  SUPERVISION_FILE,
  describeStateIssue,
  loadSupervisionState,
  parseSupervisionState,
  serializeSupervisionState,
  supervisionStateDocument,
  type LoadedState,
  type ParsedState,
  type StateIssue,
  type StateReader,
} from "./supervise/state.js";

export { renderSupervision } from "./supervise/render.js";

export { renderSkill, type SkillContext } from "./skill/render.js";

export {
  DEFAULT_SKILL_ROOT,
  SKILL_NAME,
  installSkill,
  type InstallOptions,
  type InstallOutcome,
  type InstallReport,
} from "./skill/install.js";
