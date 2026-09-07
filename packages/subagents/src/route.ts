/** The complete route identity that must agree before a provider sends useful work. */
export const ROUTE_FIELDS = ["provider", "model", "effort", "cwd"] as const;

export type RouteField = (typeof ROUTE_FIELDS)[number];
export type RouteSide = "requested" | "observed";
export type RouteStatus = "known" | "mismatch" | "unknown";

/**
 * Closed provenance vocabulary for route evidence.
 *
 * These labels are values, not caller-supplied prose: evidence is rendered into diagnostics, so an
 * open string here would be an accidental path for tokens, environment values or auth material.
 */
export type RouteSource =
  | "request.modelProvider"
  | "request.model"
  | "request.effort"
  | "provider.cwd"
  | "thread/start.result.modelProvider"
  | "thread/start.result.model"
  | "thread/start.result.reasoningEffort"
  | "thread/start.result.cwd";

export interface RouteIdentityInput {
  readonly provider: unknown;
  readonly model: unknown;
  readonly effort: unknown;
  readonly cwd: unknown;
}

export interface RouteValueEvidence {
  /** Invalid, absent and blank values are represented as null; their raw value is never retained. */
  readonly value: string | null;
  readonly source: RouteSource;
}

export type RouteIdentityValues = Readonly<Record<RouteField, RouteValueEvidence>>;

export interface InvalidRouteField {
  readonly side: RouteSide;
  readonly field: RouteField;
}

export interface RouteIdentityEvidence {
  readonly status: RouteStatus;
  readonly requested: RouteIdentityValues;
  readonly observed: RouteIdentityValues;
  /** Valid fields whose exact strings differ, even when another field makes the result unknown. */
  readonly mismatches: readonly RouteField[];
  readonly invalid: readonly InvalidRouteField[];
  /**
   * Deterministic diagnostic that excludes raw malformed payloads. It may contain caller-supplied
   * route strings, including absolute paths, so callers remain responsible for handling it.
   */
  readonly detail: string;
}

const REQUESTED_SOURCES: Readonly<Record<RouteField, RouteSource>> = {
  provider: "request.modelProvider",
  model: "request.model",
  effort: "request.effort",
  cwd: "provider.cwd",
};

const OBSERVED_SOURCES: Readonly<Record<RouteField, RouteSource>> = {
  provider: "thread/start.result.modelProvider",
  model: "thread/start.result.model",
  effort: "thread/start.result.reasoningEffort",
  cwd: "thread/start.result.cwd",
};

function isAbsoluteCwd(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function valueEvidence(
  field: RouteField,
  value: unknown,
  source: RouteSource,
  side: RouteSide,
): RouteValueEvidence {
  if (typeof value !== "string" || value.trim().length === 0) return { value: null, source };
  // The caller owns canonicalisation. This check only prevents a relative cwd from being certified.
  if (field === "cwd" && side === "requested" && !isAbsoluteCwd(value)) {
    return { value: null, source };
  }
  return { value, source };
}

function values(
  input: RouteIdentityInput,
  sources: Readonly<Record<RouteField, RouteSource>>,
  side: RouteSide,
): RouteIdentityValues {
  return {
    provider: valueEvidence("provider", input.provider, sources.provider, side),
    model: valueEvidence("model", input.model, sources.model, side),
    effort: valueEvidence("effort", input.effort, sources.effort, side),
    cwd: valueEvidence("cwd", input.cwd, sources.cwd, side),
  };
}

function quote(value: string): string {
  return JSON.stringify(value);
}

/** Render all useful differences and invalid fields without retaining raw malformed values. */
export function describeRouteEvidence(evidence: Omit<RouteIdentityEvidence, "detail">): string {
  const differences = evidence.mismatches.map((field) => {
    const requested = evidence.requested[field];
    const observed = evidence.observed[field];
    return `${field} requested ${quote(requested.value ?? "")} (${requested.source}), observed ${
      quote(observed.value ?? "")
    } (${observed.source})`;
  });
  const invalid = evidence.invalid.map(({ side, field }) => {
    const item = evidence[side][field];
    return `invalid ${side} ${field} (${item.source})`;
  });

  if (evidence.status === "known") {
    const provenance = ROUTE_FIELDS.map((field) => {
      const requested = evidence.requested[field];
      const observed = evidence.observed[field];
      return `${field} ${quote(requested.value ?? "")} from ${requested.source}, verified by ${observed.source}`;
    });
    return `route verified: ${provenance.join("; ")}`;
  }

  if (evidence.status === "mismatch") {
    return `route mismatch: ${differences.join("; ")}; correct the requested route or server configuration before retry; unchanged settings may produce the same refusal`;
  }

  const facts = [...invalid, ...differences];
  return `route unknown: ${facts.length === 0 ? "the response could not be correlated or read" : facts.join("; ")}; no useful turn is permitted`;
}

/**
 * Compare exact route strings without I/O, aliases, case folding, trimming or path normalisation.
 * Unknown takes precedence, while valid differences remain visible in an unknown diagnostic.
 */
export function compareRouteIdentity(
  requestedInput: RouteIdentityInput,
  observedInput: RouteIdentityInput,
): RouteIdentityEvidence {
  const requested = values(requestedInput, REQUESTED_SOURCES, "requested");
  const observed = values(observedInput, OBSERVED_SOURCES, "observed");
  const invalid: InvalidRouteField[] = [];
  const mismatches: RouteField[] = [];

  for (const field of ROUTE_FIELDS) {
    const asked = requested[field].value;
    const seen = observed[field].value;
    if (asked === null) invalid.push({ side: "requested", field });
    if (seen === null) invalid.push({ side: "observed", field });
    if (asked !== null && seen !== null && asked !== seen) mismatches.push(field);
  }

  const status: RouteStatus = invalid.length > 0
    ? "unknown"
    : mismatches.length > 0
    ? "mismatch"
    : "known";
  const partial = { status, requested, observed, mismatches, invalid };
  return { ...partial, detail: describeRouteEvidence(partial) };
}

/**
 * Callable fail-closed default for consumers of optional route evidence.
 *
 * Re-checking the values keeps a fabricated `status: "known"` from overriding contradictory or
 * incomplete evidence. Legacy results without route evidence are unverified.
 */
export function isRouteEvidenceVerified(evidence: RouteIdentityEvidence | undefined): boolean {
  try {
    if (evidence == null || evidence.status !== "known") return false;
    return ROUTE_FIELDS.every((field) => {
      const requestedItem = evidence.requested?.[field];
      const observedItem = evidence.observed?.[field];
      if (requestedItem?.source !== REQUESTED_SOURCES[field]) return false;
      if (observedItem?.source !== OBSERVED_SOURCES[field]) return false;
      const requested = requestedItem.value;
      const observed = observedItem.value;
      if (typeof requested !== "string" || requested.trim().length === 0) return false;
      if (typeof observed !== "string" || observed.trim().length === 0) return false;
      if (field === "cwd" && !isAbsoluteCwd(requested)) return false;
      return requested === observed;
    });
  } catch {
    return false;
  }
}
