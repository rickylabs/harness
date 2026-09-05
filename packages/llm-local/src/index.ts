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
 *
 * ## What is deliberately absent
 *
 * No adapter, no client, no health probe: nothing here has contacted an endpoint, and every base
 * URL is a default rather than a fact about a deployment. Those are #57's, and they consume this
 * table rather than restate it.
 *
 * Quota, spend and load are absent for a stronger reason — all three change while you read them, so
 * a committed copy is wrong by the time it ships. This package answers *could this ever work here*.
 * Whether it works right now is a probe.
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
