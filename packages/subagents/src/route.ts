/** The complete route identity that must agree before a provider sends useful work. */
export const ROUTE_FIELDS = ["provider", "model", "effort", "cwd"] as const;

export type RouteField = (typeof ROUTE_FIELDS)[number];
export type RouteSide = "requested" | "observed";
export type RouteStatus = "known" | "mismatch" | "unknown";

/**
 * The wire protocols this repository can read a route off, named so the observed vocabulary can be
 * selected rather than assumed.
 *
 * `codex` is the in-tree Codex app-server protocol, where all four route fields are reported. `uhp` is
 * the Unified Harness Protocol, where exactly one of them is
 * (`.llm/runs/route-identity-uhp--s10/research.md` §2–§4). The list is **open-ended by design**: a
 * consumer may compare a `RouteSource` for equality and may not `switch` over it exhaustively, because
 * every future transport adds a member. See `proposal-routesource-uhp.md` §2.
 */
export const ROUTE_DIALECTS = ["codex", "uhp"] as const;

export type RouteDialect = (typeof ROUTE_DIALECTS)[number];

/**
 * Closed provenance vocabulary for route evidence.
 *
 * These labels are values, not caller-supplied prose: evidence is rendered into diagnostics, so an
 * open string here would be an accidental path for tokens, environment values or auth material.
 *
 * A label names **where a value came from**. There is deliberately no `uhp` label for `provider`,
 * `effort` or `cwd`: the protocol defines no field for any of them, and a label for a field the wire
 * cannot report is a name with no referent — an invitation to populate it from something
 * adjacent-looking. Their absence is expressed as `RouteValueEvidence.source: null`, which
 * `isRouteEvidenceVerified` refuses outright. See `proposal-routesource-uhp.md` §3.
 */
export type RouteSource =
  | "request.modelProvider"
  | "request.model"
  | "request.effort"
  | "provider.cwd"
  | "thread/start.result.modelProvider"
  | "thread/start.result.model"
  | "thread/start.result.reasoningEffort"
  | "thread/start.result.cwd"
  /** `Response.model`, "the model that actually ran", REQUIRED by `Response.required` in UHP's OpenAPI document. */
  | "uhp/responses.result.model";

export interface RouteIdentityInput {
  readonly provider: unknown;
  readonly model: unknown;
  readonly effort: unknown;
  readonly cwd: unknown;
}

export interface RouteValueEvidence {
  /** Invalid, absent and blank values are represented as null; their raw value is never retained. */
  readonly value: string | null;
  /**
   * Where the value came from, or `null` when the dialect defines no place for it to come from.
   *
   * `null` is not "we did not look". It is "this protocol has no field for this", which is a permanent
   * property of the dialect rather than of one response — and it is why `isRouteEvidenceVerified`
   * refuses a field whose source is `null` whatever value sits beside it.
   */
  readonly source: RouteSource | null;
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

/**
 * The requested side is this repository asking, not a protocol answering, so it is dialect-independent.
 *
 * `request.model` means "the model this coordinator asked for" over every transport. A per-dialect
 * requested vocabulary would name the same fact twice and give a future edit two places to disagree.
 */
const REQUESTED_SOURCES: Readonly<Record<RouteField, RouteSource>> = {
  provider: "request.modelProvider",
  model: "request.model",
  effort: "request.effort",
  cwd: "provider.cwd",
};

/**
 * The observed vocabulary, per dialect. `null` means the dialect has no field to read.
 *
 * This map was a single module-level record until #287, which is the defect that made the change
 * necessary rather than tidy: `provider-uhp` observes a route off a UHP response body and every observed
 * label it carried said `thread/start.result.*`, a Codex `thread/start` response this repository never
 * sent. A closed provenance vocabulary exists so a diagnostic can say where a value came from, and a
 * UHP route labelled `thread/start.result.model` is a false statement about origin.
 *
 * The three `null`s in the `uhp` row are the load-bearing half. They are not placeholders for labels
 * somebody will mint later: `provider`, `effort` and `cwd` have no UHP wire representation at all, which
 * `.llm/runs/route-identity-uhp--s10/research.md` §2–§4 establishes from the specification, its OpenAPI
 * document and its conformance suite.
 */
const OBSERVED_SOURCES: Readonly<Record<RouteDialect, Readonly<Record<RouteField, RouteSource | null>>>> = {
  codex: {
    provider: "thread/start.result.modelProvider",
    model: "thread/start.result.model",
    effort: "thread/start.result.reasoningEffort",
    cwd: "thread/start.result.cwd",
  },
  uhp: {
    provider: null,
    model: "uhp/responses.result.model",
    effort: null,
    cwd: null,
  },
};

/**
 * Which dialect an observed side was labelled in, or `null` when no single dialect explains it.
 *
 * Read from the labels rather than taken as a parameter, so `isRouteEvidenceVerified` keeps its
 * one-argument signature and so the cross-dialect guard survives: a Codex label presented among UHP
 * ones, or the reverse, matches no row and is refused. The forbidden loosening is
 * `ROUTE_SOURCES.includes(source)` — "any label in the union" — which would accept a `thread/start`
 * label on a UHP route and lose the guard the single map provided for free.
 */
function observedDialect(observed: RouteIdentityValues | undefined): RouteDialect | null {
  let found: RouteDialect | null = null;
  for (const dialect of ROUTE_DIALECTS) {
    const expected = OBSERVED_SOURCES[dialect];
    if (ROUTE_FIELDS.every((field) => observed?.[field]?.source === expected[field])) {
      // Two dialects cannot both explain one labelling while their rows differ, and if a future row
      // ever made them ambiguous the answer is "no dialect", not a coin toss.
      if (found !== null) return null;
      found = dialect;
    }
  }
  return found;
}

function isAbsoluteCwd(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function valueEvidence(
  field: RouteField,
  value: unknown,
  source: RouteSource | null,
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
  sources: Readonly<Record<RouteField, RouteSource | null>>,
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

/**
 * How a missing provenance label renders.
 *
 * A diagnostic that printed `null` here would read as a bug in the describer. This says the true thing:
 * there is no field on this wire for that value, so nothing could have sourced it.
 */
const UNSOURCED = "unreported by this protocol" as const;

function sourceLabel(source: RouteSource | null): string {
  return source ?? UNSOURCED;
}

/** Render all useful differences and invalid fields without retaining raw malformed values. */
export function describeRouteEvidence(evidence: Omit<RouteIdentityEvidence, "detail">): string {
  const differences = evidence.mismatches.map((field) => {
    const requested = evidence.requested[field];
    const observed = evidence.observed[field];
    return `${field} requested ${quote(requested.value ?? "")} (${sourceLabel(requested.source)}), observed ${
      quote(observed.value ?? "")
    } (${sourceLabel(observed.source)})`;
  });
  const invalid = evidence.invalid.map(({ side, field }) => {
    const item = evidence[side][field];
    return `invalid ${side} ${field} (${sourceLabel(item.source)})`;
  });

  if (evidence.status === "known") {
    const provenance = ROUTE_FIELDS.map((field) => {
      const requested = evidence.requested[field];
      const observed = evidence.observed[field];
      return `${field} ${quote(requested.value ?? "")} from ${sourceLabel(requested.source)}, verified by ${
        sourceLabel(observed.source)
      }`;
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
 *
 * `dialect` selects the observed provenance vocabulary and defaults to `codex`, so every call site that
 * predates #287 keeps compiling and keeps its exact previous behaviour. It changes labels only: which
 * values are compared, and therefore `status`, `mismatches` and `invalid`, do not depend on it.
 */
export function compareRouteIdentity(
  requestedInput: RouteIdentityInput,
  observedInput: RouteIdentityInput,
  dialect: RouteDialect = "codex",
): RouteIdentityEvidence {
  const requested = values(requestedInput, REQUESTED_SOURCES, "requested");
  const observed = values(observedInput, OBSERVED_SOURCES[dialect], "observed");
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
 *
 * ## What the UHP arm did and did not change here
 *
 * The observed labels are now checked against **one dialect's** row, chosen by reading the labels
 * themselves, so a UHP provider's honest provenance is no longer rejected for being honest. That is the
 * whole of the widening. It does not make a UHP route verifiable, and it must not be read as doing so:
 *
 * 1. A field whose observed source is `null` can never be verified. The protocol reports nothing for it,
 *    so there is nothing to have agreed — and any value sitting beside a `null` source arrived from
 *    somewhere this vocabulary cannot name, which is the fabricated agreement the contract refuses.
 *    Over UHP that is `provider`, `effort` and `cwd`, always, so this returns `false` on every UHP route.
 * 2. The `status !== "known"` check above already refused every real UHP route before the widening, for
 *    an upstream reason: those three fields have no value either, so `invalid` is never empty.
 *
 * Two independent refusals, deliberately. `.llm/runs/route-identity-uhp--s10/research.md` §6.3 is the
 * source of the ordering, and #294 owns the only thing that could ever change it.
 */
export function isRouteEvidenceVerified(evidence: RouteIdentityEvidence | undefined): boolean {
  try {
    if (evidence == null || evidence.status !== "known") return false;
    const dialect = observedDialect(evidence.observed);
    if (dialect === null) return false;
    const expected = OBSERVED_SOURCES[dialect];
    return ROUTE_FIELDS.every((field) => {
      const requestedItem = evidence.requested?.[field];
      const observedItem = evidence.observed?.[field];
      if (requestedItem?.source !== REQUESTED_SOURCES[field]) return false;
      // The observed labelling was checked as a whole by `observedDialect`, field by field against one
      // row, so there is no per-field label comparison here: it would be the same comparison twice, and a
      // duplicated guard is a guard nobody can tell has stopped working. `undefined` cannot reach this
      // line for the same reason, and is refused for the type-checker rather than as a second check.
      if (observedItem === undefined) return false;
      // The rule that keeps the UHP arm from unblocking certification: a field this dialect has no source
      // for can never be verified, whatever value sits beside it.
      if (expected[field] === null) return false;
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
