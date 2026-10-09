/**
 * Strict field decoders shared by the governance read document and the dispatch refusal reader.
 * Module-internal to this package: nothing here is exported from the package entry.
 */
import type { GovernanceState, Regime, RegimeState, RegimeStatus, SubscriptionWindow,
  SubscriptionAccount, MeteredSpend, CapacityReading, PendingApproval } from "./governance.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const IDENTIFIER_CAP = 128;
const LABEL_CAP = 256;
export const PROSE_CAP = 4096;

class InvalidObservation extends Error {}
const ownedErrors = new WeakSet<object>();
export const compareStrings = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

export function invalid(field: string, why: string): never {
  const error = new InvalidObservation(`${field} ${why}`);
  ownedErrors.add(error);
  throw error;
}

export function record(value: unknown, field: string, keys: readonly string[]): Readonly<Record<string, unknown>> {
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
export function array(value: unknown, field: string, cap = 256): readonly unknown[] {
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

export function text(value: unknown, field: string, cap = LABEL_CAP): string {
  if (typeof value !== "string" || value.length === 0 || value.length > cap || /[\x00-\x1f\x7f]/.test(value)) {
    return invalid(field, `must be a non-empty string of at most ${cap} characters`);
  }
  return value;
}

function nullableText(value: unknown, field: string, cap = PROSE_CAP): string | null {
  return value === null ? null : text(value, field, cap);
}

export function identifier(value: unknown, field: string): string {
  const result = text(value, field, IDENTIFIER_CAP);
  if (!IDENTIFIER.test(result)) return invalid(field, "must be a safe identifier");
  return result;
}

export function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return invalid(field, "must be a finite non-negative number");
  }
  return value;
}

function nullableFinite(value: unknown, field: string): number | null {
  return value === null ? null : finite(value, field);
}

export function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return invalid(field, "must be a positive integer");
  }
  return value;
}

export function timestamp(value: unknown, field: string): { readonly raw: string; readonly ms: number } {
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

export function regime(value: unknown, field: string): Regime {
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

export function unique<T>(values: readonly T[], key: (value: T) => string, field: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const identity = key(value);
    // Values may be producer prose. Name the field, never echo input through a public loader note.
    if (seen.has(identity)) invalid(field, "contains a duplicate identity");
    seen.add(identity);
  }
}

export function parsePending(value: unknown, field: string, upperMs: number): PendingApproval {
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

export function parseState(value: unknown, envelopeMs: number): GovernanceState {
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
export function objectTag(value: unknown, key: string, field: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid(field, "must be a plain object");
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) invalid(field, "must contain data properties");
  return descriptor.value;
}
export function choice<const T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) invalid(field, "has an invalid code");
  return value as T[number];
}
export function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field, "must be boolean");
  return value as boolean;
}
export function fresh(until: number, evaluated: number): "fresh" | "stale" {
  return evaluated > until ? "stale" : "fresh";
}

/** The decoder's own field-only diagnostic, or null for an error this module did not raise. */
export function ownedDetail(error: unknown): string | null {
  return typeof error === "object" && error !== null && ownedErrors.has(error) ? (error as InvalidObservation).message : null;
}
