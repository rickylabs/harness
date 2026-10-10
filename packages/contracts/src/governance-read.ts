/** Standalone governance read document. Pure JSON boundary; no board or transport semantics. */
import type { GovernanceState, Regime } from "./governance.js";
import { array, boolean, choice, compareStrings, finite, fresh, identifier, invalid, objectTag, ownedDetail, parseState,
  positiveInteger, PROSE_CAP, record, regime, text, timestamp, unique } from "./governance-read-fields.js";
import { readProviderBudgetDecisions, type ProviderBudgetDecision } from "./paid-account-usage.js";

export const GOVERNANCE_READ_SCHEMA = 1 as const;
export const GOVERNANCE_SOURCE_NAMES = ["usage", "spend", "capacity", "admissions"] as const;
export type GovernanceSourceName = (typeof GOVERNANCE_SOURCE_NAMES)[number];

export const SOURCE_FAILURE_REASONS = ["credential-unbound", "spawn-failed", "timeout", "oversize",
  "non-json", "shape-mismatch", "request-failed", "cgroup-unreadable", "log-unreadable", "file-unreadable"] as const;
export const SOURCE_DISCARD_REASONS = ["stale-source", "future-source", "shape-mismatch"] as const;
export const ADMISSION_DROP_REASONS = ["admission-conflict", "stale-source", "shape-mismatch"] as const;
export const UNAVAILABLE_REASONS = ["not-configured", "no-successful-sources", "envelope-invalid"] as const;

/**
 * Transport availability (0.28.0): which matrix transports the dispatcher's admission would offer
 * now, and why each other one is out. It is a sibling of the governance state, not part of it: its
 * own validity, never the envelope's, and absent from "not-configured".
 */
export const SUBSCRIPTION_MATRIX_TRANSPORTS = ["claude", "codex", "agy"] as const;
export const MATRIX_TRANSPORTS = [...SUBSCRIPTION_MATRIX_TRANSPORTS, "opencode"] as const;
export type MatrixTransport = (typeof MATRIX_TRANSPORTS)[number];
export const TRANSPORT_UNAVAILABLE_REASONS = ["no-capacity", "meter-unread", "meter-stale", "window-expired",
  "5h-ceiling", "weekly-ceiling", "ceiling-misconfigured"] as const;
export type TransportUnavailableReason = (typeof TRANSPORT_UNAVAILABLE_REASONS)[number];
export type TransportAvailabilityRow =
  | { readonly transport: MatrixTransport; readonly available: true; readonly reason: null }
  | { readonly transport: (typeof SUBSCRIPTION_MATRIX_TRANSPORTS)[number]; readonly available: false; readonly reason: TransportUnavailableReason }
  | { readonly transport: "opencode"; readonly available: false; readonly reason: "no-capacity" };
export interface OpenCodeProviderPool {
  readonly provider: string;
  readonly maxActive: number;
  readonly active: number;
}
export const TRANSPORT_CAPACITY_STATES = ["free", "full", "disabled", "unknown"] as const;
export const TRANSPORT_CAPACITY_REASONS = ["seats-not-configured", "seat-budget-missing", "seats-config-invalid"] as const;
export const TRANSPORT_PACING_STATES = ["clear", "limited", "unknown", "unmetered"] as const;
export const TRANSPORT_PACING_LIMITED_REASONS = ["governor-pacing", "5h-ceiling", "weekly-ceiling"] as const;
export const TRANSPORT_PACING_UNKNOWN_REASONS = ["meter-unread", "meter-stale", "window-expired", "ceiling-misconfigured"] as const;
/** Orchid's physical seats and independent pacing, from the same admission tick (0.41.0). */
export interface TransportCapacityRow {
  readonly transport: MatrixTransport;
  readonly capacity: (typeof TRANSPORT_CAPACITY_STATES)[number];
  readonly capacityReason: (typeof TRANSPORT_CAPACITY_REASONS)[number] | null;
  readonly maxActive: number | null;
  readonly active: number | null;
  readonly admissionCap: number | null;
  readonly pacing: (typeof TRANSPORT_PACING_STATES)[number];
  readonly pacingReason: (typeof TRANSPORT_PACING_LIMITED_REASONS)[number] | (typeof TRANSPORT_PACING_UNKNOWN_REASONS)[number] | null;
}
export interface TransportAvailability {
  readonly observedAt: string; readonly validUntil: string;
  /** Exact subscription prefix (legacy), or every MATRIX_TRANSPORTS member in order.
   * OpenCode reports aggregate configured provider capacity, never subscription quota. */
  readonly transports: readonly TransportAvailabilityRow[];
  /** Optional source-owned seat counts. Absent means no per-provider observation. */
  readonly openCodeProviderPools?: readonly OpenCodeProviderPool[];
  /** Optional model budget decisions (0.33); independent of provider seat capacity. */
  readonly providerBudgets?: readonly ProviderBudgetDecision[];
  /** Optional physical seats and pacing. Missing means unknown; null counts never mean zero. */
  readonly transportCapacity?: readonly TransportCapacityRow[];
}

/** One strict capacity boundary for the private mapper and the published governance decoder. */
export function readTransportCapacity(value: unknown, transports: readonly TransportAvailabilityRow[]): readonly TransportCapacityRow[] | null {
  try {
    const rows = array(value, "transportCapacity", MATRIX_TRANSPORTS.length);
    if (rows.length !== MATRIX_TRANSPORTS.length || transports.length !== rows.length) invalid("transportCapacity", "requires every matrix transport");
    return rows.map((value, i): TransportCapacityRow => {
      const field = `transportCapacity[${i}]`;
      const row = record(value, field, ["transport", "capacity", "capacityReason", "maxActive", "active", "admissionCap", "pacing", "pacingReason"]);
      const transport = MATRIX_TRANSPORTS[i]!;
      if (row.transport !== transport || transports[i]!.transport !== transport) invalid(field, "requires matrix order");
      const capacity = choice(row.capacity, TRANSPORT_CAPACITY_STATES, `${field}.capacity`);
      if (capacity !== "free" && transports[i]!.available !== false) invalid(field, "non-free seats cannot be available");
      const expectedReason = capacity === "disabled" ? "seats-not-configured"
        : capacity === "unknown" ? (transport === "opencode" ? "seats-config-invalid" : "seat-budget-missing") : null;
      if (row.capacityReason !== expectedReason) invalid(field, "has inconsistent capacity reason");
      const count = (value: unknown): number | null => {
        if (value === null) return null;
        if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(field, "requires nonnegative whole seat counts");
        return value as number;
      };
      const maxActive = count(row.maxActive), active = count(row.active), admissionCap = count(row.admissionCap);
      if (transport === "opencode") {
        if (maxActive !== null || active !== null || admissionCap !== null) invalid(field, "OpenCode counts belong to provider pools");
      } else {
        if (active === null) invalid(field, "requires the dispatcher's occupied count");
        if (capacity === "unknown") {
          if (maxActive !== null || admissionCap !== null) invalid(field, "unknown budget cannot invent counts");
        } else if (capacity === "disabled") {
          if (maxActive !== 0) invalid(field, "disabled seats require zero configured seats");
        } else {
          if (maxActive === null || maxActive === 0 || admissionCap === null) invalid(field, "known seats require their computed budget");
          if ((capacity === "full") !== (active >= maxActive)) invalid(field, "capacity contradicts occupied seats");
        }
      }
      const pacing = choice(row.pacing, TRANSPORT_PACING_STATES, `${field}.pacing`);
      if ((pacing === "unmetered") !== (transport === "agy" || transport === "opencode")) invalid(field, "pacing must follow the transport's meter regime");
      const pacingReason = pacing === "limited" ? choice(row.pacingReason, TRANSPORT_PACING_LIMITED_REASONS, `${field}.pacingReason`)
        : pacing === "unknown" ? choice(row.pacingReason, TRANSPORT_PACING_UNKNOWN_REASONS, `${field}.pacingReason`) : null;
      if (pacingReason === null && row.pacingReason !== null) invalid(field, "clear and unmetered pacing require a null reason");
      return { transport, capacity, capacityReason: expectedReason, maxActive, active, admissionCap, pacing, pacingReason };
    });
  } catch { return null; }
}

/** Shared strict boundary for the private mapper and the published decoder. */
export function readOpenCodeProviderPools(value: unknown): readonly OpenCodeProviderPool[] | null {
  try {
    const seen = new Set<string>();
    return array(value, "openCodeProviderPools", 128).map((value, i) => {
      const field = `openCodeProviderPools[${i}]`;
      const row = record(value, field, ["provider", "maxActive", "active"]);
      const provider = text(row.provider, `${field}.provider`, 64);
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(provider) || seen.has(provider)) invalid(field, "requires a unique provider identifier");
      seen.add(provider);
      if (!Number.isSafeInteger(row.maxActive) || (row.maxActive as number) < 0 || (row.maxActive as number) > 256 ||
          !Number.isSafeInteger(row.active) || (row.active as number) < 0) invalid(field, "requires bounded whole seat counts");
      return { provider, maxActive: row.maxActive as number, active: row.active as number };
    });
  } catch {
    return null; // Hostile reflection failures never escape this public boundary.
  }
}

export type MeterCoverage =
  | { readonly status: "not-configured" }
  | { readonly status: "failed"; readonly reason: SourceFailureReason }
  | { readonly status: "discarded"; readonly reason: SourceDiscardReason }
  | { readonly status: "read"; readonly observedAt: string; readonly validUntil: string;
      readonly freshness: "fresh" | "stale"; readonly provenance: string };

export type AdmissionCoverage =
  | { readonly status: "not-configured" }
  | { readonly status: "failed"; readonly reason: "log-unreadable" | "shape-mismatch" }
  | { readonly status: "read"; readonly records: number; readonly empty: boolean;
      readonly dropped: readonly AdmissionDropReason[]; readonly provenance: string; readonly collectedAt: string };

export interface GovernanceSourceCoverage {
  readonly usage: MeterCoverage; readonly spend: MeterCoverage; readonly capacity: MeterCoverage;
  readonly admissions: AdmissionCoverage;
  /**
   * 0.28.0. Present exactly when the producer configures the source; a document without it (every
   * document before 0.28.0) decodes unchanged, so readers can upgrade before producers.
   */
  readonly transportAvailability?: MeterCoverage;
  /** Pending approvals have no producer today. The only value is "not-observed". */
  readonly approvals: { readonly status: "not-observed" };
}

export interface RecordedAdmission {
  readonly item: number; readonly regime: Regime; readonly state: "throttle" | "pause";
  readonly observedAt: string; readonly validUntil: string; readonly freshness: "fresh" | "stale";
  readonly provenance: string;              // safe identifier, e.g. reader:recorded-admission
  readonly reason: string;                  // producer machine code, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
  readonly accepted: false;
}

export type GovernanceReadSnapshot =
  | { readonly schema: 1; readonly protocol: 1; readonly producer: string;
      readonly evaluatedAt: string; readonly availability: "fresh" | "stale";
      readonly observedAt: string; readonly validUntil: string; readonly provenance: string;
      readonly complete: boolean; readonly sources: GovernanceSourceCoverage;
      readonly state: GovernanceState; readonly admissions: readonly RecordedAdmission[];
      readonly unavailableReason: null; readonly notes: readonly string[];
      /** Present with sources.transportAvailability; non-null exactly when that coverage is "read". */
      readonly transportAvailability?: TransportAvailability | null }
  | { readonly schema: 1; readonly protocol: 1; readonly producer: string;
      readonly evaluatedAt: string; readonly availability: "unavailable";
      readonly observedAt: null; readonly validUntil: null; readonly provenance: null;
      readonly complete: false; readonly sources: GovernanceSourceCoverage;
      readonly state: null; readonly admissions: readonly [];
      readonly unavailableReason: UnavailableReason; readonly notes: readonly string[];
      readonly transportAvailability?: TransportAvailability | null };
export type SourceFailureReason = (typeof SOURCE_FAILURE_REASONS)[number];
export type SourceDiscardReason = (typeof SOURCE_DISCARD_REASONS)[number];
export type AdmissionDropReason = (typeof ADMISSION_DROP_REASONS)[number];
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];
export type GovernanceReading =
  | { readonly ok: true; readonly snapshot: GovernanceReadSnapshot }
  | { readonly ok: false; readonly reason: "unreadable" | "invalid"; readonly detail: string }
  | { readonly ok: false; readonly reason: "unsupported-schema"; readonly schema: number | null; readonly protocol: number | null };

function interval(input: Readonly<Record<string, unknown>>, field: string, evaluated: number) {
  const observed = timestamp(input.observedAt, `${field}.observedAt`);
  const until = timestamp(input.validUntil, `${field}.validUntil`);
  if (until.ms < observed.ms) invalid(field, "has a reversed interval");
  if (input.freshness !== fresh(until.ms, evaluated)) invalid(field, "has inconsistent freshness");
  return { observedAt: observed.raw, validUntil: until.raw, freshness: fresh(until.ms, evaluated) };
}
function meter(value: unknown, field: string, evaluated: number): MeterCoverage {
  const status = objectTag(value, "status", field);
  if (status === "not-configured") { record(value, field, ["status"]); return { status }; }
  if (status === "failed" || status === "discarded") {
    const input = record(value, field, ["status", "reason"]);
    return status === "failed"
      ? { status, reason: choice(input.reason, SOURCE_FAILURE_REASONS, `${field}.reason`) }
      : { status, reason: choice(input.reason, SOURCE_DISCARD_REASONS, `${field}.reason`) };
  }
  if (status !== "read") invalid(field, "has an invalid status");
  const input = record(value, field, ["status", "observedAt", "validUntil", "freshness", "provenance"]);
  return { status: "read", ...interval(input, field, evaluated), provenance: identifier(input.provenance, `${field}.provenance`) };
}
function transportAvailability(value: unknown, coverage: MeterCoverage, evaluated: number): TransportAvailability | null {
  const field = "transportAvailability";
  if (coverage.status !== "read") {
    if (value !== null) invalid(field, "requires read coverage");
    return null;
  }
  const hasPools = typeof value === "object" && value !== null && Object.hasOwn(value, "openCodeProviderPools");
  const hasBudgets = typeof value === "object" && value !== null && Object.hasOwn(value, "providerBudgets");
  const hasCapacity = typeof value === "object" && value !== null && Object.hasOwn(value, "transportCapacity");
  const input = record(value, field, ["observedAt", "validUntil", "transports", ...(hasPools ? ["openCodeProviderPools"] : []), ...(hasBudgets ? ["providerBudgets"] : []), ...(hasCapacity ? ["transportCapacity"] : [])]);
  const observed = timestamp(input.observedAt, `${field}.observedAt`), until = timestamp(input.validUntil, `${field}.validUntil`);
  if (observed.raw !== coverage.observedAt || until.raw !== coverage.validUntil || observed.ms > evaluated)
    invalid(field, "contradicts its coverage");
  const rows = array(input.transports, `${field}.transports`, MATRIX_TRANSPORTS.length);
  if (rows.length !== SUBSCRIPTION_MATRIX_TRANSPORTS.length && rows.length !== MATRIX_TRANSPORTS.length)
    invalid(`${field}.transports`, "must list the subscription prefix or every matrix transport");
  const transports = rows.map((value, i): TransportAvailabilityRow => {
    const row = record(value, `${field}.transports[${i}]`, ["transport", "available", "reason"]);
    if (row.transport !== MATRIX_TRANSPORTS[i]) invalid(`${field}.transports[${i}].transport`, "must follow MATRIX_TRANSPORTS order");
    const transport = MATRIX_TRANSPORTS[i]!;
    if (boolean(row.available, `${field}.transports[${i}].available`)) {
      if (row.reason !== null) invalid(`${field}.transports[${i}].reason`, "must be null when available");
      return { transport, available: true, reason: null };
    }
    if (transport === "opencode") {
      if (row.reason !== "no-capacity") invalid(`${field}.transports[${i}].reason`, "must describe provider capacity");
      return { transport, available: false, reason: "no-capacity" };
    }
    return { transport, available: false, reason: choice(row.reason, TRANSPORT_UNAVAILABLE_REASONS, `${field}.transports[${i}].reason`) };
  });
  const pools = hasPools ? readOpenCodeProviderPools(input.openCodeProviderPools) : undefined;
  if (pools === null) invalid(field, "has invalid provider pools");
  if (pools !== undefined && (transports.length !== MATRIX_TRANSPORTS.length ||
      transports.at(-1)!.available !== pools.some(pool => pool.maxActive > pool.active))) invalid(field, "provider pools contradict aggregate capacity");
  const budgets = hasBudgets ? readProviderBudgetDecisions(input.providerBudgets) : undefined;
  if (budgets === null || budgets?.some(r => r.observedAt !== observed.raw || r.validUntil !== until.raw)) invalid(field, "has invalid provider budget decisions");
  const capacity = hasCapacity ? readTransportCapacity(input.transportCapacity, transports) : undefined;
  if (capacity === null) invalid(field, "has invalid transport capacity");
  return { observedAt: observed.raw, validUntil: until.raw, transports, ...(pools === undefined ? {} : { openCodeProviderPools: pools }),
    ...(budgets === undefined ? {} : { providerBudgets: budgets }), ...(capacity === undefined ? {} : { transportCapacity: capacity }) };
}
function admissionCoverage(value: unknown): AdmissionCoverage {
  const field = "sources.admissions";
  const status = objectTag(value, "status", field);
  if (status === "not-configured") { record(value, field, ["status"]); return { status }; }
  if (status === "failed") {
    const input = record(value, field, ["status", "reason"]);
    return { status, reason: choice(input.reason, ["log-unreadable", "shape-mismatch"] as const, `${field}.reason`) };
  }
  if (status !== "read") invalid(field, "has an invalid status");
  const input = record(value, field, ["status", "records", "empty", "dropped", "provenance", "collectedAt"]);
  const records = finite(input.records, `${field}.records`);
  if (!Number.isSafeInteger(records) || records > 1000) invalid(field, "has invalid record count");
  const empty = boolean(input.empty, `${field}.empty`);
  if (empty !== (records === 0)) invalid(field, "has inconsistent empty coverage");
  const dropped = array(input.dropped, `${field}.dropped`, ADMISSION_DROP_REASONS.length)
    .map(value => choice(value, ADMISSION_DROP_REASONS, `${field}.dropped`));
  unique(dropped, value => value, `${field}.dropped`);
  return { status: "read", records, empty, dropped, provenance: identifier(input.provenance, `${field}.provenance`),
    collectedAt: timestamp(input.collectedAt, `${field}.collectedAt`).raw };
}
function admission(value: unknown, field: string, evaluated: number): RecordedAdmission {
  const input = record(value, field, ["item", "regime", "state", "observedAt", "validUntil", "freshness", "provenance", "reason", "accepted"]);
  const times = interval(input, field, evaluated);
  if (Date.parse(times.observedAt) > evaluated) invalid(field, "has a future observation");
  if (input.accepted !== false) invalid(field, "must record a refusal");
  return { item: positiveInteger(input.item, `${field}.item`), regime: regime(input.regime, `${field}.regime`),
    state: choice(input.state, ["throttle", "pause"] as const, `${field}.state`), ...times,
    provenance: identifier(input.provenance, `${field}.provenance`), reason: identifier(input.reason, `${field}.reason`), accepted: false };
}

/** One recorded refusal, decoded by the same rules as `admissions[i]` of the document, evaluated at
 * `evaluatedAt` (0.38.0). For a producer that checks a refusal before it has an envelope. Null on any failure. */
export function readRecordedAdmission(value: unknown, evaluatedAt: string): RecordedAdmission | null {
  try {
    return admission(value, "admission", timestamp(evaluatedAt, "evaluatedAt").ms);
  } catch {
    return null; // Hostile reflection failures never escape this public boundary.
  }
}

/** Decode JSON-derived values into independently owned data. Never reads a clock or performs I/O.
 * Schema depth and collections are bounded. Portable JavaScript cannot inspect a Proxy trap-free.
 */
export function readGovernanceSnapshot(value: unknown): GovernanceReading {
  let entered = false;
  try {
    const schemaValue = objectTag(value, "schema", "document");
    const protocolValue = objectTag(value, "protocol", "document");
    entered = true;
    const number = (v: unknown): number | null => typeof v === "number" && Number.isSafeInteger(v) ? v : null;
    const schema = number(schemaValue), protocol = number(protocolValue);
    if (schema !== GOVERNANCE_READ_SCHEMA || protocol !== 1) return { ok: false, reason: "unsupported-schema", schema, protocol };
    // A document without the source (every document before 0.28.0) has neither transportAvailability
    // key, and decodes unchanged: readers can upgrade before producers.
    const current = typeof value === "object" && value !== null && Object.hasOwn(value, "transportAvailability");
    const input = record(value, "document", ["schema", "protocol", "producer", "evaluatedAt", "availability", "observedAt", "validUntil", "provenance", "complete", "sources", "state", "admissions", "unavailableReason", "notes",
      ...(current ? ["transportAvailability"] : [])]);
    const evaluatedAt = timestamp(input.evaluatedAt, "evaluatedAt");
    const source = record(input.sources, "sources", ["usage", "spend", "capacity", "admissions", "approvals",
      ...(current ? ["transportAvailability"] : [])]);
    const approvals = record(source.approvals, "sources.approvals", ["status"]);
    if (approvals.status !== "not-observed") invalid("sources.approvals", "must be not-observed");
    const sources: GovernanceSourceCoverage = {
      usage: meter(source.usage, "sources.usage", evaluatedAt.ms),
      spend: meter(source.spend, "sources.spend", evaluatedAt.ms),
      capacity: meter(source.capacity, "sources.capacity", evaluatedAt.ms),
      admissions: admissionCoverage(source.admissions), approvals: { status: "not-observed" },
      ...(current ? { transportAvailability: meter(source.transportAvailability, "sources.transportAvailability", evaluatedAt.ms) } : {}),
    };
    const coverage = sources.transportAvailability;
    const availability = coverage === undefined ? undefined : transportAvailability(input.transportAvailability, coverage, evaluatedAt.ms);
    const availabilityIncomplete = coverage?.status === "failed" || coverage?.status === "discarded";
    const notes = array(input.notes, "notes", 64).map((value, i) => text(value, `notes[${i}]`, PROSE_CAP));
    const base = { schema: GOVERNANCE_READ_SCHEMA, protocol: 1 as const, producer: identifier(input.producer, "producer"), evaluatedAt: evaluatedAt.raw, sources, notes,
      ...(availability === undefined ? {} : { transportAvailability: availability }) };
    const admissions = array(input.admissions, "admissions", 1000).map((v, i) => admission(v, `admissions[${i}]`, evaluatedAt.ms));
    unique(admissions, a => `${a.item}:${a.regime}`, "admissions");
    admissions.sort((a, b) => a.item - b.item || compareStrings(a.regime, b.regime));
    if (sources.admissions.status !== "read" && admissions.length !== 0) invalid("admissions", "requires read coverage");
    if (input.availability === "unavailable") {
      if (input.state !== null || input.observedAt !== null || input.validUntil !== null || input.provenance !== null || input.complete !== false || admissions.length !== 0) invalid("document", "has inconsistent unavailable fields");
      const unavailableReason = choice(input.unavailableReason, UNAVAILABLE_REASONS, "unavailableReason");
      const allAbsent = GOVERNANCE_SOURCE_NAMES.every(name => sources[name].status === "not-configured");
      if ((unavailableReason === "not-configured") !== allAbsent && unavailableReason !== "envelope-invalid") invalid("unavailableReason", "contradicts coverage");
      if (unavailableReason === "no-successful-sources" && ([sources.usage, sources.spend, sources.capacity].some(s => s.status === "read") || (sources.admissions.status === "read" && sources.admissions.records > 0))) invalid("sources", "contains usable evidence without an envelope");
      return { ok: true, snapshot: { ...base, availability: "unavailable", observedAt: null, validUntil: null, provenance: null, complete: false, state: null, admissions: [], unavailableReason } };
    }
    const observed = timestamp(input.observedAt, "observedAt"), until = timestamp(input.validUntil, "validUntil");
    if (observed.ms > evaluatedAt.ms || until.ms < observed.ms) invalid("document", "has inconsistent clocks");
    if (input.availability !== fresh(until.ms, evaluatedAt.ms) || input.unavailableReason !== null) invalid("availability", "contradicts envelope");
    const parsedState = parseState(input.state, observed.ms);
    // This source does not observe approval requests. Empty pending is not an approval census.
    if (parsedState.pending.length !== 0) invalid("state.pending", "has no observed source");
    const meters = [sources.usage, sources.spend, sources.capacity];
    const expiries: number[] = [];
    for (const [i, coverage] of meters.entries()) {
      const row = parsedState.regimes[i]!;
      const leaves = row.regime === "subscription" ? row.accounts : row.regime === "metered" ? row.providers : row.hosts;
      if (coverage.status !== "read") {
        if (leaves.length !== 0 || row.note === null) invalid("state.regimes", "unread source must have an empty noted regime");
      } else {
        if (leaves.length === 0 || Date.parse(coverage.observedAt) > observed.ms || Date.parse(coverage.validUntil) < observed.ms) invalid("sources", "has inconsistent retained evidence");
        if (leaves.some(leaf => leaf.observedAt === null || Date.parse(leaf.observedAt) !== Date.parse(coverage.observedAt))) invalid("state.regimes", "contradicts source observation");
        expiries.push(Date.parse(coverage.validUntil));
      }
    }
    const ac = sources.admissions;
    if (ac.status === "read") {
      if (ac.records !== admissions.length || Date.parse(ac.collectedAt) !== observed.ms) invalid("sources.admissions", "contradicts retained envelope");
    }
    for (const a of admissions) {
      if (Date.parse(a.observedAt) > observed.ms || Date.parse(a.validUntil) < observed.ms) invalid("admissions", "contradicts retained envelope");
      expiries.push(Date.parse(a.validUntil));
    }
    if (expiries.length === 0 || Math.min(...expiries) !== until.ms) invalid("validUntil", "must be earliest retained expiry");
    const complete = boolean(input.complete, "complete");
    if (complete && (meters.some(s => s.status === "failed" || s.status === "discarded") || ac.status === "failed" || (ac.status === "read" && ac.dropped.length > 0) || availabilityIncomplete)) invalid("complete", "contradicts configured coverage");
    return { ok: true, snapshot: { ...base, availability: fresh(until.ms, evaluatedAt.ms), observedAt: observed.raw,
      validUntil: until.raw, provenance: identifier(input.provenance, "provenance"), complete, state: parsedState, admissions, unavailableReason: null } };
  } catch (error) {
    return { ok: false, reason: entered ? "invalid" : "unreadable", detail: ownedDetail(error) ?? "document could not be inspected" };
  }
}
