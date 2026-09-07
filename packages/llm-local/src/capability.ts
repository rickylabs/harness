/** Placement mechanism validation and queries over explicit document data. */
import { deepFreeze, type PlacementConfiguration } from "@rickylabs/routing";
import { BACKENDS, isBackend, type Backend } from "./backends.js";

/**
 * Why a model must not be sent to a backend.
 *
 * Each member is a distinct remedy, which is the test for whether it deserves to exist:
 * `absent-from-build` is fixed by rebuilding, `crashes-on-backend` by using the other accelerator,
 * `unusably-slow` by not routing there at all, and `not-served-here` never — it is a fact about
 * what the destination is, not about how it is configured.
 */
export const REFUSALS = [
  "absent-from-build",
  "crashes-on-backend",
  "unusably-slow",
  "not-served-here",
] as const;
export type Refusal = (typeof REFUSALS)[number];

/** Extra conditions a model needs before it will load on a backend. */
export interface Requirements {
  /** Environment the server process needs. Values are settings, never credentials. */
  readonly env?: Readonly<Record<string, string>>;
  /** Arguments the server must be started with. */
  readonly args?: readonly string[];
}

interface PlacementBase {
  readonly model: string;
  readonly backend: Backend;
  /** Always present. An entry that cannot say why it says what it says is not evidence. */
  readonly why: string;
}

/** One (model, backend) cell of the matrix. */
export type Placement =
  | (PlacementBase & { readonly verdict: "runs"; readonly requires?: Requirements })
  | (PlacementBase & { readonly verdict: "refused"; readonly reason: Refusal })
  | (PlacementBase & { readonly verdict: "unverified" });


export function placementOf(placements: readonly Placement[], model: string, backend: string): Placement | null {
  return placements.find(p => p.model === model && p.backend === backend) ?? null;
}
export function canRun(placements: readonly Placement[], model: string, backend: string): boolean {
  return placementOf(placements, model, backend)?.verdict === "runs";
}
export function refusalOf(placements: readonly Placement[], model: string, backend: string): Refusal | null {
  const placement = placementOf(placements, model, backend);
  return placement?.verdict === "refused" ? placement.reason : null;
}
/** Preserve the mechanism's on-box-first ordering. */
export function backendsFor(placements: readonly Placement[], model: string): readonly Backend[] {
  return BACKENDS.filter(backend => canRun(placements, model, backend));
}
export function placedModels(placements: readonly Placement[]): readonly string[] {
  return [...new Set(placements.map(p => p.model))];
}
export type CapabilityCode = "placement-backend-unsupported" | "placement-verdict-unsupported" |
  "placement-reason-invalid" | "placement-requires-invalid" | "placement-runs-nowhere";
export interface CapabilityProblem { readonly code: CapabilityCode; readonly path: string }
/** Routing has already validated shape, references and explicit membership totality. */
export function checkCapability(placements: PlacementConfiguration): readonly CapabilityProblem[] {
  const problems: CapabilityProblem[] = [];
  placements.backends.forEach((backend, i) => {
    if (!isBackend(backend)) problems.push({ code: "placement-backend-unsupported", path: `placements.backends[${i}]` });
  });
  placements.entries.forEach((p, i) => {
    const path = `placements.entries[${i}]`;
    if (!isBackend(p.backend)) problems.push({ code: "placement-backend-unsupported", path: `${path}.backend` });
    if (!["runs", "refused", "unverified"].includes(p.verdict)) problems.push({ code: "placement-verdict-unsupported", path: `${path}.verdict` });
    if (p.verdict === "refused" ? !(REFUSALS as readonly unknown[]).includes(p.reason) : p.reason !== undefined) {
      problems.push({ code: "placement-reason-invalid", path: `${path}.reason` });
    }
    if (p.requires !== undefined && (p.verdict !== "runs" ||
        (!Object.keys(p.requires.env ?? {}).length && !(p.requires.args ?? []).length))) {
      problems.push({ code: "placement-requires-invalid", path: `${path}.requires` });
    }
  });
  for (const model of new Set(placements.entries.map(p => p.model))) {
    if (!placements.entries.some(p => p.model === model && p.verdict === "runs")) {
      problems.push({ code: "placement-runs-nowhere", path: `placements.entries[${placements.entries.findIndex(p => p.model === model)}]` });
    }
  }
  return problems;
}
/** Composition refuses before exposing any adapter or placement; clone away caller mutations. */
export function requirePlacements(placements: PlacementConfiguration): readonly Placement[] {
  const problems = checkCapability(placements);
  if (problems.length) throw new RangeError(problems.map(p => `${p.code} at ${p.path}`).join("; "));
  return deepFreeze(structuredClone(placements.entries)) as readonly Placement[];
}
