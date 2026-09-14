/**
 * One loader, two document versions, and a typed boundary between them.
 *
 * `validateRoutingConfiguration` runs the stages that do not care about shape — the plain-data
 * walk, the root-object check and the version gate — and then dispatches to the version's own
 * validator. There is no migration, no shape sniffing, no default and no partial acceptance: a
 * version is read from the `schemaVersion` integer, and a document whose shape does not match the
 * integer it declares is `invalid`, never quietly upgraded.
 *
 * ## Why the boundary is a type and not a version number
 *
 * Every routing function that existed before version 2 keeps its version-1 parameter type. A
 * version-2 document therefore cannot reach a lane resolver by construction, and the only way from
 * a loaded `RoutingDocument` to a typed configuration is `laneRouting` or `fleetRouting`, each of
 * which refuses the other version with a coded refusal. Without that, a version-1 reader handed a
 * version-2 document would find `implement` undefined and report a misleading diagnostic: it would
 * fail closed by accident rather than by decision.
 */
import { plainDataProblem, SCHEMA_VERSIONS, validateLaneConfiguration, type PlacementConfiguration, type RoutingConfiguration, type SchemaVersion, type ValidationOutcome } from "./schema.js";
import { validateFleetConfiguration, type FleetRoutingConfiguration } from "./fleet.js";

/** A loaded document, discriminated by the version integer it declares. */
export type RoutingDocument = RoutingConfiguration | FleetRoutingConfiguration;

/**
 * What a consumer that needs one version says when handed the other.
 *
 * `requires` names the semantics the consumer needs rather than the version it wants, because the
 * version number is a fact about the file and the missing semantics are the reason for the refusal.
 */
export interface ConsumerRefusal {
  readonly kind: "unsupported-by-consumer";
  readonly schemaVersion: SchemaVersion;
  readonly requires: "lane-chains" | "fleet-cells";
}
export type NarrowedRouting<T> =
  | { readonly ok: true; readonly configuration: T }
  | { readonly ok: false; readonly refusal: ConsumerRefusal };

/** Strict whole-document validation. The shared stages first, then the version's own validator. */
export function validateRoutingConfiguration(value: unknown): ValidationOutcome<RoutingDocument> {
  const unsafe = plainDataProblem(value);
  if (unsafe) return { ok: false, refusal: { kind: "invalid", problems: [unsafe] } };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, refusal: { kind: "malformed", code: "root-not-object" } };
  }
  const root = value as Record<string, unknown>;
  const declared = root.schemaVersion;
  if (declared !== 1 && declared !== 2) {
    return { ok: false, refusal: {
      kind: "unsupported-schema-version",
      seen: Number.isSafeInteger(declared) ? declared as number : null,
      supported: SCHEMA_VERSIONS,
    } };
  }
  return declared === 1 ? validateLaneConfiguration(value) : validateFleetConfiguration(value);
}

/** The version-1 configuration, or a refusal. Never converts, copies or defaults. */
export function laneRouting(document: RoutingDocument): NarrowedRouting<RoutingConfiguration> {
  return document.schemaVersion === 1
    ? { ok: true, configuration: document }
    : { ok: false, refusal: { kind: "unsupported-by-consumer", schemaVersion: document.schemaVersion, requires: "lane-chains" } };
}
/** The version-2 configuration, or a refusal. Never converts, copies or defaults. */
export function fleetRouting(document: RoutingDocument): NarrowedRouting<FleetRoutingConfiguration> {
  return document.schemaVersion === 2
    ? { ok: true, configuration: document }
    : { ok: false, refusal: { kind: "unsupported-by-consumer", schemaVersion: document.schemaVersion, requires: "fleet-cells" } };
}
/**
 * The placement section of either version.
 *
 * Placements are the one section whose shape and namespace are identical across versions — they are
 * matched by the generate-time model string on the llm seam — so the llm seam needs no narrowing
 * and no version-specific branch.
 */
export function placementsOf(document: RoutingDocument): PlacementConfiguration {
  return document.placements;
}
/** Codes only. A consumer refusal carries no document value to render. */
export function describeConsumerRefusal(refusal: ConsumerRefusal): string {
  return `${refusal.kind}: schemaVersion ${refusal.schemaVersion}; requires ${refusal.requires}`;
}
