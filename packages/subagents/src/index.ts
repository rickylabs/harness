/**
 * @rickylabs/subagents — the `ctx.subagents` seam.
 *
 * Owned by E3 · #33, defined by #51. Two things live here and they are one thing: the payload that
 * describes a run to be launched (`DispatchRequest`, and its `/swarm` wire format), and the
 * interface anything capable of launching one implements (`SubagentProvider`).
 *
 * ## Why this is its own package
 *
 * The dispatch payload was written for the board's projection of divybot's grammar, and it lived
 * in `@rickylabs/board`. It cannot stay there. E7's forge is the other consumer — it writes the
 * `/swarm` block into an issue body — and a package that generates CLI scaffolding has no business
 * depending on the kanban projection to find out what a dispatch looks like. Inverting that
 * dependency would make board a leaf that half the tree reaches through.
 *
 * It is also not in `@rickylabs/harness-contracts`. That package is E8's, published to npm for the two UIs,
 * and its own stub says not to add behaviour before that epic defines its contract. #79's scope
 * discipline settles it from the other side: a type that only makes sense for one surface does not
 * belong there, and the UIs never implement a provider — they read a board.
 *
 * So: a package both seams can depend on, which depends on neither. `@rickylabs/board` keeps its
 * public surface unchanged by re-exporting from here.
 *
 * ## The two halves
 *
 * `dispatch.ts` is a faithful port of Orchid's `parseOverrides`, pinned at commit
 * `d344bd037bcf10150fd12daef8ffa277576cd94a`, together with `go-grammar.ts` — Go's line splitting,
 * `unicode.IsSpace`, and RE2's `\s`, none of which agree with JavaScript's. That disagreement is
 * not pedantry: it is how a prompt line once parsed as a key and replaced the matrix-selected model
 * at launch.
 *
 * `provider.ts` is the interface, and the word it is built around is `unknown` — see its own
 * header. A provider that cannot reach its executor does not know whether the run is alive, and
 * reporting that as a failure is a specific, wrong claim with a destructive action attached.
 *
 * `lease.ts` is the third: single-writer ownership of a session, keyed on our run id rather than the
 * vendor's session id, because the vendor's changes under `--resume`. It is what stands between the
 * board and two live processes on one transcript.
 *
 * ## The UHP half
 *
 * Five more modules arrived with spikes S10 (#288) and S11 (#289), for runs hosted over the Unified
 * Harness Protocol: `uhp-wire.ts` transcribes the protocol, `uhp-stream.ts` consumes its SSE and
 * computes freshness from timestamps, `uhp-lifecycle.ts` maps its statuses onto `RunLiveness` per
 * #287, `uhp-gate.ts` decides whether the route the server reported permits a useful turn, and
 * `uhp-session.ts` chains turns on `previous_response_id` while keying runs on our `runId`.
 *
 * Four more arrived with `provider-uhp` (#286), which composes them rather than restating any of them:
 * `uhp-provider.ts` is the `SubagentProvider` itself, `uhp-harnesses.ts` pins the console's `chrn_` ids
 * and refuses a dispatch on drift, `uhp-transport.ts` is the HTTP port and the only place a credential
 * exists, and `uhp-redact.ts` is the publication boundary — no `detail` crosses it carrying a path.
 *
 * `uhp-mock.ts` is not exported: it is the loopback server and fixture set those modules are tested
 * against, and every claim any of them supports today is a claim about a mock written from the
 * specification. The live router round-trip is #294. See the package README, and the `verification.md`
 * of `.llm/runs/uhp-stream-adapter--s11/` and `.llm/runs/provider-uhp--e37/` for the split between what
 * was proven and what was not.
 */

export {
  DEFAULT_HARNESS,
  DispatchEncodingError,
  HARNESSES,
  PROMPT_GUARD,
  ROUTERS,
  TIMER_CEILING_MS,
  parseGoDuration,
  parseSwarm,
  renderSwarm,
  timeoutMs,
  toDispatchRequest,
  validateDispatch,
} from "./dispatch.js";
export type {
  DispatchRequest,
  Harness,
  ParsedSwarm,
  Router,
  SwarmOverrides,
  SwarmWarning,
} from "./dispatch.js";

export {
  forbiddenCharactersIn,
  goIsFence,
  goKeyValue,
  goSplitLines,
  goTrimSpace,
} from "./go-grammar.js";
export type { GoKeyValue } from "./go-grammar.js";

export {
  CONTEXT_KEY,
  capabilityProblem,
  conformanceProblems,
  instrumentedBy,
  isInstrumented,
  isRouteVerified,
  isSafeToRetry,
  markInstrumented,
  registryProblems,
  retryGuidance,
  selectProvider,
} from "./provider.js";
export type {
  BlockRule,
  BlockedSelection,
  ConformanceProblem,
  ConformanceRule,
  DispatchResult,
  DispatchVerdict,
  Observation,
  OptionalCall,
  ProviderCapabilities,
  Rejection,
  RejectionRule,
  RunLiveness,
  RunRef,
  SelectedProvider,
  Selection,
  SelectionOptions,
  SteerResult,
  SteerVerdict,
  StopResult,
  StopVerdict,
  SubagentProvider,
  SubagentRegistry,
} from "./provider.js";

export {
  ROUTE_FIELDS,
  compareRouteIdentity,
  describeRouteEvidence,
  isRouteEvidenceVerified,
} from "./route.js";
export type {
  InvalidRouteField,
  RouteField,
  RouteIdentityEvidence,
  RouteIdentityInput,
  RouteIdentityValues,
  RouteSide,
  RouteSource,
  RouteStatus,
  RouteValueEvidence,
} from "./route.js";

export {
  UHP_DELTA_EVENTS,
  UHP_ERROR_CODES,
  UHP_ERROR_EVENT,
  UHP_EVENT_TYPES,
  UHP_INERT_EVENTS,
  UHP_ITEM_EVENTS,
  UHP_LIFECYCLE_EVENTS,
  UHP_LIFECYCLE_STATUSES,
  UHP_TERMINAL_EVENTS,
  UHP_TERMINAL_STATUSES,
  UHP_VERSION,
  UHP_VERSION_HEADER,
  isUhpLifecycleStatus,
  isUhpTerminalEvent,
  isUhpTerminalStatus,
  uhpErrorCode,
} from "./uhp-wire.js";
export type {
  UhpCreateRequest,
  UhpDeltaEvent,
  UhpError,
  UhpErrorCode,
  UhpErrorEnvelope,
  UhpEventType,
  UhpHarness,
  UhpItemEvent,
  UhpLifecycleEvent,
  UhpLifecycleStatus,
  UhpResponse,
  UhpResponseMetadata,
  UhpTerminalEvent,
  UhpTerminalStatus,
} from "./uhp-wire.js";

export {
  DEFAULT_UHP_WINDOWS,
  consumeUhpStream,
  createUhpStreamReader,
  readUhpStream,
  uhpFreshness,
} from "./uhp-stream.js";
export type {
  UhpFreshness,
  UhpFreshnessEvidence,
  UhpFreshnessKind,
  UhpFreshnessVerdict,
  UhpFreshnessWindows,
  UhpStreamDone,
  UhpStreamError,
  UhpStreamOpen,
  UhpStreamReader,
  UhpStreamRefusal,
  UhpStreamRefused,
  UhpStreamState,
} from "./uhp-stream.js";

export { mapUhpOutcome, uhpObservation } from "./uhp-lifecycle.js";
export type { UhpLifecycleVerdict, UhpOutcome } from "./uhp-lifecycle.js";

export {
  decideUhpRoute,
  observeUhpRoute,
  readUhpCwd,
  readUhpEffort,
  readUhpModel,
  readUhpProvider,
  uhpRouteNegatives,
  uhpRouteVerdict,
} from "./uhp-gate.js";
export type { UhpRouteDecision, UhpRouteNegatives } from "./uhp-gate.js";

export {
  PINNED_HARNESSES_PATH,
  describeHarnessDrift,
  describeUnrelatedHarnessDrift,
  detectHarnessDrift,
  isManifestReconciled,
  loadPinnedHarnesses,
  manifestHarnesses,
  parseHarnessManifest,
  pinnedHarness,
  readUhpHarness,
  readUhpHarnessList,
  selectHarnessDrift,
} from "./uhp-harnesses.js";
export type {
  HarnessDrift,
  HarnessDriftKind,
  HarnessDriftSelection,
  HarnessManifest,
  ManifestFault,
  ManifestProblem,
  ManifestResult,
  PinnedHarness,
} from "./uhp-harnesses.js";

export {
  CWD_PRESENT,
  CWD_REDUCED_TO_PRESENCE,
  PATH_SHAPES,
  REDACTED_PATH,
  isRedactedRouteEvidence,
  pathShapedStrings,
  redactPaths,
  redactRouteEvidence,
} from "./uhp-redact.js";
export type { PublishedRouteEvidence } from "./uhp-redact.js";

export { CREDENTIAL_PROFILE, HARNESSROUTER_PROFILE, createUhpTransport } from "./uhp-transport.js";
export type { UhpAnswer, UhpCall, UhpTransport, UhpTransportOptions } from "./uhp-transport.js";

export { UHP_UNRELATED_DRIFT, createUhpProvider } from "./uhp-provider.js";
export type { UhpDiagnostic, UhpProvider, UhpProviderOptions } from "./uhp-provider.js";

export {
  EMPTY_UHP_LEDGER,
  lastUhpTurn,
  nextUhpRequest,
  openUhpSession,
  recordUhpTurn,
  recordUhpTurnInLedger,
  uhpRunRef,
  uhpRunsInSession,
  uhpSessionOf,
  withUhpSession,
} from "./uhp-session.js";
export type {
  UhpRequestResult,
  UhpSession,
  UhpSessionLedger,
  UhpSessionRefusal,
  UhpTurn,
  UhpTurnResult,
} from "./uhp-session.js";

export {
  DEFAULT_STALE,
  DEFAULT_TTL,
  EMPTY_LEDGER,
  GRANT_OUTCOMES,
  LEASE_REFUSALS,
  LEASE_STATES,
  RESOLUTIONS,
  acquire,
  admitResume,
  checkLedger,
  describeGrant,
  describeLeaseProblem,
  describeLeaseState,
  describeResolution,
  holds,
  isAdvisory,
  leaseOf,
  leaseStatus,
  release,
  resolveSession,
} from "./lease.js";
export type {
  Grant,
  GrantOutcome,
  Lease,
  LeaseLedger,
  LeaseProblem,
  LeaseRefusal,
  LeaseRequest,
  LeaseState,
  LeaseStatus,
  Release,
  ResolveRequest,
  Resolution,
  ResumeAttempt,
  ResumeDecision,
  SessionResolution,
  TranscriptFile,
} from "./lease.js";

/** Workspace package identifier. */
export const PACKAGE_NAME = "@rickylabs/subagents" as const;

export type PackageName = typeof PACKAGE_NAME;
