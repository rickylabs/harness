/**
 * @rickylabs/llm-local — where a `ctx.llm` request can be sent, and where it must not.
 *
 * Owned by E4 · #34. This package answers *where do I send a request for `x`*, and never *should
 * the request be for `x`*. Choosing a model is `@rickylabs/routing`'s question; two packages
 * answering it is the failure mode this boundary exists to prevent.
 *
 * ## The shape
 *
 * - `backends.ts` — the three destinations, as data: base URL, locality, accelerator, how readiness
 *   is established, and where a failure is actually diagnosed.
 * - `capability.ts` — the model x backend matrix (#60). Which of `routing`'s pinned models can run
 *   at each destination, which cannot and for which of four distinct reasons, and which nobody has
 *   tried. `checkCapability` makes the table's invariants executable.
 * - `budget.ts` — the token-budget floor as a branded type, so a ceiling too small for a model that
 *   reasons before it answers cannot be spelled at a call site.
 * - `endpoint.ts` — a backend name plus a deployment override, resolved into a request target. The
 *   one place text from outside the repository becomes something a request is aimed at, and the one
 *   place that refuses a URL carrying a credential.
 * - `health.ts` — readiness (#57). Five outcomes, each with a distinct remedy, each carrying the
 *   path where its evidence actually is.
 *
 * ## What is deliberately absent
 *
 * Nothing here opens a socket. `endpoint.ts` says where a request goes and `health.ts` says what
 * came back of it, and both take the exchange as data — the same split as `routing`'s `probe.ts`,
 * for the same reason: a rule that opens a socket cannot be tested.
 *
 * There is also no chat client. Registering a `ctx.llm` adapter is the app shell's (E2 · #32), and
 * the readiness half is what a registration needs first; a completion request built here with no
 * seam to attach to would be an API invented ahead of its caller.
 *
 * Quota, spend and load are absent for a stronger reason — all three change while you read them, so
 * a committed copy is wrong by the time it ships. This package answers *could this ever work here*,
 * and `health.ts` answers *is it working right now*. What a reading is still worth ten minutes later
 * is `@rickylabs/routing`'s `probe.ts` (#59).
 */

export const PACKAGE_NAME = "@rickylabs/llm-local" as const;
export type PackageName = typeof PACKAGE_NAME;

export {
  ACCELERATORS,
  BACKENDS,
  BACKEND_RECORDS,
  LOCALITIES,
  backendRecord,
  backendsWhere,
  isBackend,
} from "./backends.js";
export type {
  Accelerator,
  Backend,
  BackendApi,
  BackendRecord,
  Locality,
  ReadinessCheck,
} from "./backends.js";

export {
  PLACEMENTS,
  REFUSALS,
  backendsFor,
  canRun,
  checkCapability,
  placedModels,
  placementOf,
  refusalOf,
} from "./capability.js";
export type { CapabilityProblem, Placement, Refusal, Requirements } from "./capability.js";

export {
  BUDGET_REFUSALS,
  MIN_REASONING_BUDGET,
  clampToFloor,
  isReasoningBudget,
  reasoningBudget,
} from "./budget.js";
export type { BudgetRefusal, BudgetVerdict, ReasoningBudget } from "./budget.js";

export {
  ENDPOINT_REFUSALS,
  ENDPOINT_SOURCES,
  completionsUrl,
  describeEndpoint,
  describeEndpointRefusal,
  modelsUrl,
  readinessRequest,
  resolveEndpoint,
} from "./endpoint.js";
export type {
  Endpoint,
  EndpointRefusal,
  EndpointSource,
  EndpointVerdict,
  ReadinessRequest,
} from "./endpoint.js";

export {
  READINESS,
  checkHealth,
  describeHealth,
  describeReadiness,
  isReady,
  parseModelsList,
  toObservation,
} from "./health.js";
export type { Exchange, Health, HealthRequest, HealthVerdict, Readiness } from "./health.js";
