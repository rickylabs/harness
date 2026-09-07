/**
 * @rickylabs/telemetry — the "status ?" killer.
 *
 * Owned by E9 · #39. Telemetry is a **sink**, written as work happens and readable with no agent in
 * the loop, plus a **backfill** that recovers the same picture from the transcript stores the
 * vendors already write. The sink is what makes status cheap; the backfill is what makes it
 * survive a coordinator crash.
 *
 * `live.ts` is the join between the two, and it is what makes either of them answer a question. The
 * Claude and opencode stores write no completion marker, so a backfill alone can never say whether
 * a run finished; the sink's log can, because whatever launched the run watched it stop. The merge
 * is keyed by run id, so replaying the whole log over an already-merged view is a no-op and there
 * is no ingestion cursor to lose.
 *
 * The package deliberately depends on nothing in this workspace. GitHub is board truth and
 * `@rickylabs/board` projects the live view of it; telemetry says what *ran*, and joins to the
 * board on an issue number through the structural `BoardItemRef` shape. The join is structural but
 * it is not free: `items.ts` adapts what the projection actually emits into that shape, at the file
 * boundary where the data arrives as `unknown` and has to be checked anyway.
 */

export const PACKAGE_NAME = "@rickylabs/telemetry" as const;
export type PackageName = typeof PACKAGE_NAME;

export {
  backfillFromDisk,
  defaultRoots,
  isoFromUnixSeconds,
  openOpencodeDb,
  parseClaudeTranscript,
  parseCodexRollout,
  quotaFromRateLimits,
  readSessions,
  rowToRun,
  DEFAULT_SCAN_LIMIT,
  isoFromMillis,
  parseLine,
  parseLineWithReason,
  SESSION_COLUMNS,
  sessionQuery,
  type BackfillOptions,
  type BackfillResult,
  type BoundQuery,
  type ParsedTranscript,
  type ParseNote,
  type BackfillRoots,
  type SessionBounds,
  type SessionRow,
  type SqliteReader,
} from "./backfill/index.js";

export {
  diagnosticsFor,
  ALL_POINTERS,
  DISPATCHER_CAPACITY,
  HOST_PRESSURE,
  LM_STUDIO_LOGS,
  OPENCODE_LOG,
} from "./diagnostics.js";

export {
  normaliseItems,
  parseItems,
  toRef,
  type LoadedItems,
} from "./items.js";

export {
  foldLiveEvents,
  mergeLiveRuns,
  readLiveLog,
  type LiveDispatchVerdict,
  type LiveFile,
  type LiveLog,
  type LiveMerge,
  type LiveRun,
} from "./live.js";

export {
  classify,
  liveness,
  newest,
  DEFAULT_WINDOWS,
  type Evidence,
  type LivenessEvidence,
  type LivenessState,
  type LivenessVerdict,
  type LivenessWindows,
} from "./liveness.js";

export {
  linkedIssuesOf,
  sumUsage,
  type AttributedRun,
  type BoardItemRef,
  type DiagnosticPointer,
  type EpicActivity,
  type IssueEvidence,
  type IssueLink,
  type LaunchIdentity,
  type QuotaReading,
  type RefKind,
  type RunOutcome,
  type RunRecord,
  type RunSource,
  type RunUsage,
  type TelemetrySnapshot,
} from "./model.js";

export {
  humanAge,
  humanTokens,
  renderGovernance,
  renderItemState,
  renderLiveness,
  renderNotes,
  renderQuota,
  renderSnapshot,
  renderTree,
  RENDER_CAPS,
} from "./render.js";

export {
  parseGovernanceObservation,
  parseGovernanceText,
  unavailableGovernance,
  type AdmissionItemRef,
  type AdmissionObservation,
  type AdmissionView,
  type AvailableGovernanceView,
  type GovernanceObservation,
  type GovernanceView,
  type ObservationAvailability,
  type ParsedGovernance,
  type RefusedDispatch,
  type UnavailableGovernanceView,
} from "./observations.js";

export {
  generationName,
  planRotation,
  type Rename,
  type RotationPlan,
  type RotationPolicy,
} from "./rotation.js";

export {
  byteLength,
  createFileSink,
  createMemorySink,
  createTeeSink,
  defaultArchiveDir,
  defaultObservabilityDir,
  DEFAULT_POLICY,
  DEFAULT_TEE_TIMEOUT_MS,
  type FileSinkOptions,
  type SessionTelemetrySink,
  type TeeOptions,
  type TelemetryEvent,
} from "./sink.js";

export {
  humanBytes,
  livePath,
  logPaths,
  openObservabilitySink,
  parseBytes,
  parseEvents,
  resolveObservability,
  ENV,
  EVENT_NOTE_CAP,
  NO_ARCHIVE,
  type Observability,
  type ParsedEvents,
} from "./observability.js";

export { compareNullableStrings, compareStrings } from "./order.js";

export {
  publicRun,
  publicRuns,
  publicGovernance,
  publicSnapshot,
  publicTree,
  PUBLIC_RUN_KEYS,
  type PublicAttributedRun,
  type PublicAdmission,
  type PublicEpic,
  type PublicEpicNode,
  type PublicGovernance,
  type PublicItemNode,
  type PublicMilestoneNode,
  type PublicRun,
  type PublicRuns,
  type PublicSnapshot,
  type PublicTree,
} from "./public.js";

export {
  attributeTo,
  buildSnapshot,
  countRuns,
  flatten,
  latestQuota,
  type SnapshotInput,
} from "./snapshot.js";

export {
  buildTree,
  type ActivityTree,
  type EpicNode,
  type ItemNode,
  type LinkedRef,
  type LinkOrigin,
  type MilestoneNode,
  type TreeInput,
} from "./tree.js";

export { parseSource, type GovernanceSource, type SourceRefusal } from "./source.js";
