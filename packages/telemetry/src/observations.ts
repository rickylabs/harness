/**
 * Typed governance observations at telemetry's file boundary.
 *
 * The values come from the published contracts. This module adds only display metadata: provenance,
 * a validity interval, and the item a refused dispatch concerned. It reads no clock or file; callers
 * pass both parsed JSON and the reference time explicitly.
 */

import type {
  CapacityReading,
  DispatchOutcome,
  GovernanceState,
  MeteredSpend,
  PendingApproval,
  Regime,
  RegimeState,
  RegimeStatus,
  SubscriptionAccount,
  SubscriptionWindow,
} from "@rickylabs/harness-contracts";

import { compareStrings } from "./order.js";

export type RefusedDispatch = Extract<DispatchOutcome, { readonly accepted: false }>;
export type ObservationAvailability = "fresh" | "stale" | "unavailable";

export interface AdmissionItemRef {
  readonly number: number;
}

export interface AdmissionObservation {
  readonly item: AdmissionItemRef;
  readonly regime: Regime;
  readonly state: "throttle" | "pause";
  readonly observedAt: string;
  readonly validUntil: string;
  readonly provenance: string;
  readonly outcome: RefusedDispatch;
}

export interface GovernanceObservation {
  readonly observedAt: string;
  readonly validUntil: string;
  readonly provenance: string;
  readonly state: GovernanceState;
  readonly admissions: readonly AdmissionObservation[];
}

export interface AdmissionView extends AdmissionObservation {
  readonly availability: Exclude<ObservationAvailability, "unavailable">;
}

export interface AvailableGovernanceView {
  readonly availability: "fresh" | "stale";
  readonly observedAt: string;
  readonly validUntil: string;
  readonly provenance: string;
  readonly state: GovernanceState;
  readonly admissions: readonly AdmissionView[];
  readonly unavailableReason: null;
}

export interface UnavailableGovernanceView {
  readonly availability: "unavailable";
  readonly observedAt: null;
  readonly validUntil: null;
  readonly provenance: null;
  readonly state: null;
  readonly admissions: readonly [];
  readonly unavailableReason: string;
}

export type GovernanceView = AvailableGovernanceView | UnavailableGovernanceView;

export interface ParsedGovernance {
  readonly governance: GovernanceView;
  readonly notes: readonly string[];
  /** False only when a requested input was malformed. An absent optional input is complete. */
  readonly ok: boolean;
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const IDENTIFIER_CAP = 128;
const LABEL_CAP = 256;
const PROSE_CAP = 4096;

class InvalidObservation extends Error {}

function invalid(field: string, why: string): never {
  throw new InvalidObservation(`${field} ${why}`);
}

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(field, "must be an object");
  }
  return value as Readonly<Record<string, unknown>>;
}

function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) return invalid(field, "must be an array");
  return value;
}

function text(value: unknown, field: string, cap = LABEL_CAP): string {
  if (typeof value !== "string" || value.length === 0 || value.length > cap) {
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
  const input = record(value, field);
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
  const input = record(value, field);
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
  const input = record(value, field);
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
  const input = record(value, field);
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
  const input = record(value, field);
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
  const input = record(value, field);
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
  const input = record(value, "state");
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

  const notes = array(input.notes, "state.notes").map((entry, index) =>
    text(entry, `state.notes[${index}]`, PROSE_CAP)
  );
  notes.sort(compareStrings);

  return { generatedAt: generatedAt.raw, regimes, pending, notes };
}

function availability(validUntilMs: number, nowMs: number): "fresh" | "stale" {
  return nowMs > validUntilMs ? "stale" : "fresh";
}

function parseAdmission(value: unknown, field: string, nowMs: number): AdmissionView {
  const input = record(value, field);
  const item = record(input.item, `${field}.item`);
  const observedAt = timestamp(input.observedAt, `${field}.observedAt`);
  const validUntil = timestamp(input.validUntil, `${field}.validUntil`);
  if (observedAt.ms > nowMs) invalid(`${field}.observedAt`, "must not be in the future");
  if (validUntil.ms < observedAt.ms) invalid(`${field}.validUntil`, "must not precede observedAt");
  const admissionState = input.state;
  if (admissionState !== "throttle" && admissionState !== "pause") {
    invalid(`${field}.state`, "must be throttle or pause");
  }
  const outcome = record(input.outcome, `${field}.outcome`);
  if (outcome.accepted !== false) invalid(`${field}.outcome.accepted`, "must be false");
  const approval = outcome.approval === undefined
    ? undefined
    : parsePending(outcome.approval, `${field}.outcome.approval`, observedAt.ms);
  return {
    item: { number: positiveInteger(item.number, `${field}.item.number`) },
    regime: regime(input.regime, `${field}.regime`),
    state: admissionState,
    observedAt: observedAt.raw,
    validUntil: validUntil.raw,
    provenance: identifier(input.provenance, `${field}.provenance`),
    outcome: {
      accepted: false,
      reason: text(outcome.reason, `${field}.outcome.reason`, PROSE_CAP),
      detail: text(outcome.detail, `${field}.outcome.detail`, PROSE_CAP),
      ...(approval === undefined ? {} : { approval }),
    },
    availability: availability(validUntil.ms, nowMs),
  };
}

/** A visible unknown. Used when the optional flag is absent and when requested input is invalid. */
export function unavailableGovernance(reason: string): UnavailableGovernanceView {
  return {
    availability: "unavailable",
    observedAt: null,
    validUntil: null,
    provenance: null,
    state: null,
    admissions: [],
    unavailableReason: reason,
  };
}

/** Parse already-decoded JSON into the telemetry-owned observation envelope. */
export function parseGovernanceObservation(value: unknown, now: string): GovernanceView {
  try {
    const nowTime = timestamp(now, "now");
    const input = record(value, "governance observation");
    const observedAt = timestamp(input.observedAt, "observedAt");
    const validUntil = timestamp(input.validUntil, "validUntil");
    if (observedAt.ms > nowTime.ms) invalid("observedAt", "must not be in the future");
    if (validUntil.ms < observedAt.ms) invalid("validUntil", "must not precede observedAt");

    const admissions = array(input.admissions, "admissions").map((entry, index) =>
      parseAdmission(entry, `admissions[${index}]`, nowTime.ms)
    );
    unique(admissions, (entry) => `${entry.item.number}:${entry.regime}`, "admissions");
    admissions.sort(
      (a, b) => a.item.number - b.item.number || compareStrings(a.regime, b.regime) ||
        compareStrings(a.state, b.state) || compareStrings(a.provenance, b.provenance),
    );

    return {
      availability: availability(validUntil.ms, nowTime.ms),
      observedAt: observedAt.raw,
      validUntil: validUntil.raw,
      provenance: identifier(input.provenance, "provenance"),
      state: parseState(input.state, observedAt.ms),
      admissions,
      unavailableReason: null,
    };
  } catch (error) {
    const detail = error instanceof InvalidObservation ? error.message : "could not be parsed";
    return unavailableGovernance(`invalid governance observations: ${detail}`);
  }
}

/** Parse a JSON fixture without ever returning its bytes or source path in an error. */
export function parseGovernanceText(value: string, now: string): ParsedGovernance {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value) as unknown;
  } catch {
    const reason = "invalid governance observations: input is not JSON";
    return { governance: unavailableGovernance(reason), notes: [reason], ok: false };
  }
  const governance = parseGovernanceObservation(decoded, now);
  if (governance.availability !== "unavailable") return { governance, notes: [], ok: true };
  return { governance, notes: [governance.unavailableReason], ok: false };
}
