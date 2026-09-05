/**
 * `@rickylabs/contracts` — the types the coordinator and its cockpits agree on.
 *
 * Both user interfaces live outside this repository: a phone-sized cockpit for glancing and
 * approving, and a full web workhorse. This package is the only thing they share, and it is
 * published to public npm for exactly that reason.
 *
 * ## Scope: if a type only makes sense for one surface, it does not belong here
 *
 * The test is not "could both use it" but "do both mean the same thing by it". A column width, a
 * navigation stack, a keyboard shortcut table — those are one surface's business. What is here is
 * what the *coordinator* says: what work exists and where it stands, what is running, what may be
 * spent, and what is waiting on a person.
 *
 * The consequence worth stating: agent chat is deliberately absent. It is real, it is wanted, and a
 * conversation is the one thing on this system that carries operator prose. Prose is the payload
 * this package is most careful about, and its shape is a live question for the surface that hosts
 * it. It gets its own contract when someone has answered that question, not a placeholder here.
 *
 * ## Published, therefore no paths and no prompts leave
 *
 * This package is public. Anything that becomes a field here becomes a field a client will log, a
 * crash reporter will capture, and a cache will keep.
 *
 * So: no field in this contract carries a filesystem path or an agent prompt outward. That is not a
 * general privacy sentiment, it is a specific one with a history — the telemetry record dropped its
 * `title` and `cwd` for exactly this, and its `origin` path is present internally and absent from
 * its published projection. This contract inherits that discipline rather than re-deciding it.
 *
 * The contract is therefore **asymmetric on purpose**. A prompt travels inward on
 * `DispatchCommand.prompt` and never travels back: no snapshot, no event and no outcome carries it.
 * A cockpit that wants to show what it just sent remembers what it sent.
 *
 * ## What lives elsewhere
 *
 * The phase list is not here — it travels on the snapshot as data, so that the two lists which must
 * agree stay two, and stay checkable. The routing table is not here either: a dispatch names a lane
 * and the coordinator resolves it, so no client can route around the rule that an evaluator may not
 * be the author.
 */

export const PACKAGE_NAME = "@rickylabs/contracts" as const;
export type PackageName = typeof PACKAGE_NAME;

export {
  ITEM_KINDS,
  TASK_STATES,
  PROGRESS_BUCKETS,
  progressOf,
  type ItemKind,
  type TaskState,
  type Phase,
  type Lifecycle,
  type ProgressBucket,
  type Progress,
  type TaskView,
  type BoardAnomaly,
} from "./tasks.js";

export {
  RUN_SOURCES,
  RUN_OUTCOMES,
  ISSUE_EVIDENCE,
  LIVENESS_STATES,
  LIVENESS_EVIDENCE,
  RUN_VIEW_FIELDS,
  type RunSource,
  type RunOutcome,
  type LaunchIdentity,
  type RunUsage,
  type QuotaReading,
  type IssueEvidence,
  type IssueLink,
  type LivenessState,
  type LivenessEvidence,
  type Liveness,
  type RunView,
  type RunViewField,
} from "./runs.js";

export {
  REGIMES,
  REGIME_STATES,
  KNOWN_APPROVAL_KINDS,
  APPROVAL_VERDICTS,
  type Regime,
  type RegimeState,
  type SubscriptionWindow,
  type SubscriptionAccount,
  type MeteredSpend,
  type CapacityReading,
  type RegimeStatus,
  type KnownApprovalKind,
  type PendingApproval,
  type ApprovalVerdict,
  type ApprovalResolution,
  type GovernanceState,
} from "./governance.js";

export { type RepoRef, type RemoteSnapshot } from "./snapshot.js";

export {
  API_PREFIX,
  COMMAND_METHOD,
  COMMANDS,
  COMMAND_PATHS,
  COMMAND_ERROR_CODES,
  commandPath,
  type CommandName,
  type SnapshotReason,
  type SnapshotCommand,
  type DispatchCommand,
  type DispatchOutcome,
  type ApprovalCommand,
  type ApprovalOutcome,
  type CommandErrorCode,
  type CommandError,
  type CommandTypes,
  type CommandRequest,
  type CommandResponse,
} from "./routes.js";

export {
  MUX_PATH,
  PROTOCOL_VERSION,
  EVENT_KINDS,
  readServerEvent,
  type Frame,
  type HelloEvent,
  type SnapshotEvent,
  type TaskUpsertedEvent,
  type TaskRemovedEvent,
  type RunUpsertedEvent,
  type GovernanceChangedEvent,
  type ApprovalRequestedEvent,
  type ApprovalResolvedEvent,
  type AnomaliesChangedEvent,
  type ServerEvent,
  type EventKind,
  type ResyncFrame,
  type ClientFrame,
  type FrameReading,
} from "./events.js";
