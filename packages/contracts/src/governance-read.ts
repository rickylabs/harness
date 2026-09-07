/** Standalone governance read document. Pure JSON boundary; no board or transport semantics. */
import type { GovernanceState, Regime, RegimeState, RegimeStatus, SubscriptionWindow,
  SubscriptionAccount, MeteredSpend, CapacityReading, PendingApproval } from "./governance.js";

export const GOVERNANCE_READ_SCHEMA = 1 as const;
export const GOVERNANCE_SOURCE_NAMES = ["usage", "spend", "capacity", "admissions"] as const;
export type GovernanceSourceName = (typeof GOVERNANCE_SOURCE_NAMES)[number];

export const SOURCE_FAILURE_REASONS = ["credential-unbound", "spawn-failed", "timeout", "oversize",
  "non-json", "shape-mismatch", "request-failed", "cgroup-unreadable", "log-unreadable"] as const;
export const SOURCE_DISCARD_REASONS = ["stale-source", "future-source", "shape-mismatch"] as const;
export const ADMISSION_DROP_REASONS = ["admission-conflict", "stale-source", "shape-mismatch"] as const;
export const UNAVAILABLE_REASONS = ["not-configured", "no-successful-sources", "envelope-invalid"] as const;

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
      readonly unavailableReason: null; readonly notes: readonly string[] }
  | { readonly schema: 1; readonly protocol: 1; readonly producer: string;
      readonly evaluatedAt: string; readonly availability: "unavailable";
      readonly observedAt: null; readonly validUntil: null; readonly provenance: null;
      readonly complete: false; readonly sources: GovernanceSourceCoverage;
      readonly state: null; readonly admissions: readonly [];
      readonly unavailableReason: UnavailableReason; readonly notes: readonly string[] };
export type SourceFailureReason = (typeof SOURCE_FAILURE_REASONS)[number];
export type SourceDiscardReason = (typeof SOURCE_DISCARD_REASONS)[number];
export type AdmissionDropReason = (typeof ADMISSION_DROP_REASONS)[number];
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];
export type GovernanceReading =
  | { readonly ok: true; readonly snapshot: GovernanceReadSnapshot }
  | { readonly ok: false; readonly reason: "unreadable" | "invalid"; readonly detail: string }
  | { readonly ok: false; readonly reason: "unsupported-schema"; readonly schema: number | null; readonly protocol: number | null };

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const IDENTIFIER_CAP = 128;
const LABEL_CAP = 256;
const PROSE_CAP = 4096;

class InvalidObservation extends Error {}
const ownedErrors = new WeakSet<object>();
const compareStrings = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function invalid(field: string, why: string): never {
  const error = new InvalidObservation(`${field} ${why}`);
  ownedErrors.add(error);
  throw error;
}

function record(value: unknown, field: string, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid(field, "must be a plain object");
  const names = Reflect.ownKeys(value as object);
  if (names.length !== keys.length || names.some(key => typeof key !== "string" || !keys.includes(key))) invalid(field, "has invalid fields");
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid(field, "has invalid fields");
    result[key] = descriptor.value;
  }
  return result;
}
function array(value: unknown, field: string, cap = 256): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > cap) invalid(field, "must be a bounded array");
  const input = value as unknown[];
  if (Reflect.ownKeys(input).length !== input.length + 1) invalid(field, "must be a dense array");
  const result: unknown[] = [];
  for (let i = 0; i < input.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid(field, "must be a dense data array");
    result.push(descriptor.value);
  }
  return result;
}

function text(value: unknown, field: string, cap = LABEL_CAP): string {
  if (typeof value !== "string" || value.length === 0 || value.length > cap || /[\x00-\x1f\x7f]/.test(value)) {
    return invalid(field, `must be a non-empty string of at most ${cap} characters`);
  }
  return value;
}

function nullableText(value: unknown, field: string, cap = PROSE_CAP): string | null {
  return value === null ? null : text(value, field, cap);
}

function identifier(value: unknown, field: string): string {
  const result = text(value, field, IDENTIFIER_CAP);
  if (!IDENTIFIER.test(result)) return invalid(field, "must be a safe identifier");
  return result;
}

function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return invalid(field, "must be a finite non-negative number");
  }
  return value;
}

function nullableFinite(value: unknown, field: string): number | null {
  return value === null ? null : finite(value, field);
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return invalid(field, "must be a positive integer");
  }
  return value;
}

function timestamp(value: unknown, field: string): { readonly raw: string; readonly ms: number } {
  const raw = text(value, field, 128);
  if (!ISO_TIME.test(raw)) return invalid(field, "must be an ISO timestamp");
  const parts = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)/.exec(raw)!;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (days === undefined || day < 1 || day > days || Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59) invalid(field, "must be a real calendar instant");
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return invalid(field, "must be an ISO timestamp");
  return { raw, ms };
}

function nullableTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : timestamp(value, field).raw;
}

function state(value: unknown, field: string): RegimeState {
  if (value === "allow" || value === "throttle" || value === "pause") return value;
  return invalid(field, "must be allow, throttle, or pause");
}

function regime(value: unknown, field: string): Regime {
  if (value === "subscription" || value === "metered" || value === "capacity") return value;
  return invalid(field, "must be subscription, metered, or capacity");
}

function note(value: unknown, field: string): string | null {
  return nullableText(value, field, PROSE_CAP);
}

function leafTimestamp(value: unknown, field: string, envelopeMs: number): string | null {
  if (value === null) return null;
  const parsed = timestamp(value, field);
  if (parsed.ms > envelopeMs) return invalid(field, "must not be later than the envelope observation");
  return parsed.raw;
}

function parseWindow(value: unknown, field: string): SubscriptionWindow {
  const input = record(value, field, ["label", "windowMinutes", "usedPercent", "resetsAt", "binding"]);
  const usedPercent = finite(input.usedPercent, `${field}.usedPercent`);
  if (usedPercent > 100) return invalid(`${field}.usedPercent`, "must not exceed 100");
  if (typeof input.binding !== "boolean") return invalid(`${field}.binding`, "must be boolean");
  return {
    label: text(input.label, `${field}.label`),
    windowMinutes: finite(input.windowMinutes, `${field}.windowMinutes`),
    usedPercent,
    resetsAt: nullableTimestamp(input.resetsAt, `${field}.resetsAt`),
    binding: input.binding,
  };
}

function parseAccount(value: unknown, field: string, envelopeMs: number): SubscriptionAccount {
  const input = record(value, field, ["seam", "account", "state", "windows", "observedAt"]);
  const windows = array(input.windows, `${field}.windows`).map((entry, index) =>
    parseWindow(entry, `${field}.windows[${index}]`)
  );
  windows.sort(
    (a, b) => Number(b.binding) - Number(a.binding) || compareStrings(a.label, b.label),
  );
  return {
    seam: text(input.seam, `${field}.seam`),
    account: text(input.account, `${field}.account`),
    state: state(input.state, `${field}.state`),
    windows,
    observedAt: leafTimestamp(input.observedAt, `${field}.observedAt`, envelopeMs),
  };
}

function parseSpend(value: unknown, field: string, envelopeMs: number): MeteredSpend {
  const input = record(value, field, ["provider", "spentUsd", "ceilingUsd", "windowLabel", "observedAt"]);
  return {
    provider: text(input.provider, `${field}.provider`),
    spentUsd: finite(input.spentUsd, `${field}.spentUsd`),
    ceilingUsd: nullableFinite(input.ceilingUsd, `${field}.ceilingUsd`),
    windowLabel: text(input.windowLabel, `${field}.windowLabel`),
    observedAt: leafTimestamp(input.observedAt, `${field}.observedAt`, envelopeMs),
  };
}

function validPair(used: number | null, total: number | null, field: string): void {
  if (used !== null && total !== null && used > total) invalid(field, "used must not exceed total");
}

function parseCapacity(value: unknown, field: string, envelopeMs: number): CapacityReading {
  const input = record(value, field, ["host", "vramUsedBytes", "vramTotalBytes", "ramUsedBytes", "ramTotalBytes", "observedAt"]);
  const vramUsedBytes = nullableFinite(input.vramUsedBytes, `${field}.vramUsedBytes`);
  const vramTotalBytes = nullableFinite(input.vramTotalBytes, `${field}.vramTotalBytes`);
  const ramUsedBytes = nullableFinite(input.ramUsedBytes, `${field}.ramUsedBytes`);
  const ramTotalBytes = nullableFinite(input.ramTotalBytes, `${field}.ramTotalBytes`);
  validPair(vramUsedBytes, vramTotalBytes, `${field}.vram`);
  validPair(ramUsedBytes, ramTotalBytes, `${field}.ram`);
  return {
    host: text(input.host, `${field}.host`),
    vramUsedBytes,
    vramTotalBytes,
    ramUsedBytes,
    ramTotalBytes,
    observedAt: leafTimestamp(input.observedAt, `${field}.observedAt`, envelopeMs),
  };
}

function unique<T>(values: readonly T[], key: (value: T) => string, field: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const identity = key(value);
    // Values may be producer prose. Name the field, never echo input through a public loader note.
    if (seen.has(identity)) invalid(field, "contains a duplicate identity");
    seen.add(identity);
  }
}

function parsePending(value: unknown, field: string, upperMs: number): PendingApproval {
  const input = record(value, field, ["id", "kind", "summary", "item", "runId", "regime", "requestedAt", "expiresAt"]);
  const requestedAt = timestamp(input.requestedAt, `${field}.requestedAt`);
  if (requestedAt.ms > upperMs) invalid(`${field}.requestedAt`, "must not be later than its observation");
  let expiresAt: string | null = null;
  if (input.expiresAt !== null) {
    const expiry = timestamp(input.expiresAt, `${field}.expiresAt`);
    if (expiry.ms < requestedAt.ms) invalid(`${field}.expiresAt`, "must not precede requestedAt");
    expiresAt = expiry.raw;
  }
  const item = input.item === null ? null : positiveInteger(input.item, `${field}.item`);
  const runId = input.runId === null ? null : text(input.runId, `${field}.runId`);
  const budget = input.regime === null ? null : regime(input.regime, `${field}.regime`);
  return {
    id: identifier(input.id, `${field}.id`),
    kind: text(input.kind, `${field}.kind`),
    summary: text(input.summary, `${field}.summary`, PROSE_CAP),
    item,
    runId,
    regime: budget,
    requestedAt: requestedAt.raw,
    expiresAt,
  };
}

function parseRegime(value: unknown, field: string, envelopeMs: number): RegimeStatus {
  const head = objectTag(value, "regime", field);
  const leaves = head === "subscription" ? "accounts" : head === "metered" ? "providers" : "hosts";
  const input = record(value, field, ["regime", "state", "note", leaves]);
  const kind = regime(input.regime, `${field}.regime`);
  const status = state(input.state, `${field}.state`);
  const message = note(input.note, `${field}.note`);
  if (kind === "subscription") {
    const accounts = array(input.accounts, `${field}.accounts`).map((entry, index) =>
      parseAccount(entry, `${field}.accounts[${index}]`, envelopeMs)
    );
    unique(accounts, (entry) => `${entry.seam}:${entry.account}`, `${field}.accounts`);
    accounts.sort((a, b) => compareStrings(a.seam, b.seam) || compareStrings(a.account, b.account));
    return { regime: kind, state: status, accounts, note: message };
  }
  if (kind === "metered") {
    const providers = array(input.providers, `${field}.providers`).map((entry, index) =>
      parseSpend(entry, `${field}.providers[${index}]`, envelopeMs)
    );
    unique(providers, (entry) => entry.provider, `${field}.providers`);
    providers.sort((a, b) => compareStrings(a.provider, b.provider));
    return { regime: kind, state: status, providers, note: message };
  }
  const hosts = array(input.hosts, `${field}.hosts`).map((entry, index) =>
    parseCapacity(entry, `${field}.hosts[${index}]`, envelopeMs)
  );
  unique(hosts, (entry) => entry.host, `${field}.hosts`);
  hosts.sort((a, b) => compareStrings(a.host, b.host));
  return { regime: kind, state: status, hosts, note: message };
}

function parseState(value: unknown, envelopeMs: number): GovernanceState {
  const input = record(value, "state", ["generatedAt", "regimes", "pending", "notes"]);
  const generatedAt = timestamp(input.generatedAt, "state.generatedAt");
  if (generatedAt.ms > envelopeMs) invalid("state.generatedAt", "must not be later than observedAt");

  const regimes = array(input.regimes, "state.regimes").map((entry, index) =>
    parseRegime(entry, `state.regimes[${index}]`, envelopeMs)
  );
  unique(regimes, (entry) => entry.regime, "state.regimes");
  const kinds = new Set(regimes.map((entry) => entry.regime));
  for (const required of ["subscription", "metered", "capacity"] as const) {
    if (!kinds.has(required)) invalid("state.regimes", `must contain ${required}`);
  }
  if (regimes.length !== 3) invalid("state.regimes", "must contain exactly three regimes");
  const rank: Readonly<Record<Regime, number>> = { subscription: 0, metered: 1, capacity: 2 };
  regimes.sort((a, b) => rank[a.regime] - rank[b.regime]);

  const pending = array(input.pending, "state.pending").map((entry, index) =>
    parsePending(entry, `state.pending[${index}]`, envelopeMs)
  );
  unique(pending, (entry) => entry.id, "state.pending");
  pending.sort((a, b) => compareStrings(a.id, b.id));

  const notes = array(input.notes, "state.notes", 64).map((entry, index) =>
    text(entry, `state.notes[${index}]`, PROSE_CAP)
  );
  notes.sort(compareStrings);

  return { generatedAt: generatedAt.raw, regimes, pending, notes };
}


/** Inspect data properties only. Proxy traps may execute; all thrown traps are contained. */
function objectTag(value: unknown, key: string, field: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid(field, "must be a plain object");
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) invalid(field, "must contain data properties");
  return descriptor.value;
}
function choice<const T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) invalid(field, "has an invalid code");
  return value as T[number];
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field, "must be boolean");
  return value as boolean;
}
function fresh(until: number, evaluated: number): "fresh" | "stale" {
  return evaluated > until ? "stale" : "fresh";
}
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
    const input = record(value, "document", ["schema", "protocol", "producer", "evaluatedAt", "availability", "observedAt", "validUntil", "provenance", "complete", "sources", "state", "admissions", "unavailableReason", "notes"]);
    const evaluatedAt = timestamp(input.evaluatedAt, "evaluatedAt");
    const source = record(input.sources, "sources", ["usage", "spend", "capacity", "admissions", "approvals"]);
    const approvals = record(source.approvals, "sources.approvals", ["status"]);
    if (approvals.status !== "not-observed") invalid("sources.approvals", "must be not-observed");
    const sources: GovernanceSourceCoverage = {
      usage: meter(source.usage, "sources.usage", evaluatedAt.ms),
      spend: meter(source.spend, "sources.spend", evaluatedAt.ms),
      capacity: meter(source.capacity, "sources.capacity", evaluatedAt.ms),
      admissions: admissionCoverage(source.admissions), approvals: { status: "not-observed" },
    };
    const notes = array(input.notes, "notes", 64).map((value, i) => text(value, `notes[${i}]`, PROSE_CAP));
    const base = { schema: GOVERNANCE_READ_SCHEMA, protocol: 1 as const, producer: identifier(input.producer, "producer"), evaluatedAt: evaluatedAt.raw, sources, notes };
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
    if (complete && (meters.some(s => s.status === "failed" || s.status === "discarded") || ac.status === "failed" || (ac.status === "read" && ac.dropped.length > 0))) invalid("complete", "contradicts configured coverage");
    return { ok: true, snapshot: { ...base, availability: fresh(until.ms, evaluatedAt.ms), observedAt: observed.raw,
      validUntil: until.raw, provenance: identifier(input.provenance, "provenance"), complete, state: parsedState, admissions, unavailableReason: null } };
  } catch (error) {
    return { ok: false, reason: entered ? "invalid" : "unreadable", detail: typeof error === "object" && error !== null && ownedErrors.has(error) ? (error as InvalidObservation).message : "document could not be inspected" };
  }
}
