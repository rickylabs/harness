/** Explicit document loading, immutable routing queries, admission and observation. */
export const PACKAGE_NAME = "@rickylabs/routing" as const;
export type PackageName = typeof PACKAGE_NAME;

export * from "./schema.js";
export * from "./load.js";
export * from "./configuration.js";

export { SEAMS, checkEvaluator, familyOfRun } from "./family.js";
export type { AssignmentSide, EvaluatorAssignment, EvaluatorVerdict, RunIdentity, Seam } from "./family.js";

export {
  checkPolicy,
  laneChain,
  resolveEffort,
  resolveFallback,
  resolveRoute,
  selfCertifies,
  tierPlan,
  toDispatch,
  unreviewedSteps,
} from "./resolve.js";
export type {
  EffortResolution,
  FallbackOutcome,
  FallbackRefusal,
  FallbackRequest,
  PolicyProblem,
  RouteResolution,
  RoutedDispatch,
  TierPlan,
} from "./resolve.js";

export {
  ADMISSION_REFUSALS,
  admitDispatch,
  describeAdmission,
  laneModels,
  relayProfiles,
  routableModels,
  routedModels,
  transportsFor,
} from "./admit.js";
export type { Admission, AdmissionContext, AdmissionProblem, AdmissionRefusal } from "./admit.js";

export {
  AVAILABILITIES,
  DEFAULT_FRESHNESS,
  FALLBACK_METADATA_MARKER,
  PROBE_REFUSALS,
  SOURCES,
  availabilityOf,
  checkObservation,
  describeAvailability,
  describeProbeProblem,
  describeProbeRefusal,
  describeVerdict,
  fallbackMetadataModels,
  isFresh,
  mayDispatch,
  readsFallbackMetadata,
} from "./probe.js";
export type {
  Availability,
  AvailabilityRequest,
  Observation,
  ProbeProblem,
  ProbeRefusal,
  Source,
  Verdict,
} from "./probe.js";
