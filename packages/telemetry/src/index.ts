/**
 * @rickylabs/telemetry — the "status ?" killer.
 *
 * Owned by E9 · #39. Telemetry is a **sink**, written as work happens and readable with no agent in
 * the loop, plus a **backfill** that recovers the same picture from the transcript stores the
 * vendors already write. The sink is what makes status cheap; the backfill is what makes it
 * survive a coordinator crash.
 *
 * The package deliberately depends on nothing in this workspace. GitHub is board truth and
 * `@rickylabs/board` projects the live view of it; telemetry says what *ran*, and joins to the
 * board on an issue number through the structural `BoardItemRef` shape.
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
  SESSION_QUERY,
  type BackfillResult,
  type BackfillRoots,
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
  linkedIssuesOf,
  sumUsage,
  type AttributedRun,
  type BoardItemRef,
  type DiagnosticPointer,
  type EpicActivity,
  type LaunchIdentity,
  type QuotaReading,
  type RunOutcome,
  type RunRecord,
  type RunSource,
  type RunUsage,
  type TelemetrySnapshot,
} from "./model.js";

export {
  humanAge,
  humanTokens,
  renderQuota,
  renderSnapshot,
} from "./render.js";

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
  type FileSinkOptions,
  type SessionTelemetrySink,
  type TelemetryEvent,
} from "./sink.js";

export {
  buildSnapshot,
  countRuns,
  flatten,
  latestQuota,
  type SnapshotInput,
} from "./snapshot.js";
