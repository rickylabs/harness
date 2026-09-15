/** Pure projection of one uniquely attributed native run. No collection, pricing or aggregation. */
import { createHash } from "node:crypto";
import { unavailableAgentCost, type AgentCost } from "@rickylabs/harness-contracts";
import type { RunRecord } from "./model.js";

const revision = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const TOKEN_FIELDS = ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens"] as const;
const time = (value: string): number => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? Date.parse(value) : NaN;
const nonnegative = (value: number): boolean => Number.isFinite(value) && value >= 0;

function runUsage(run: RunRecord, capturedAt: string): Pick<AgentCost, "meteredSpend" | "runTokens"> {
  const absent = unavailableAgentCost("measurement_missing");
  if (!Number.isFinite(time(run.updatedAt)) || time(run.updatedAt) > time(capturedAt)) {
    const invalid = unavailableAgentCost("binding_invalid");
    return { meteredSpend: invalid.meteredSpend, runTokens: invalid.runTokens };
  }
  const measurement: Partial<Record<typeof TOKEN_FIELDS[number], number>> = {};
  let invalidTokens = false;
  for (const key of TOKEN_FIELDS) {
    const value = run.usage[key];
    if (value === undefined) continue;
    if (!nonnegative(value) || !Number.isSafeInteger(value)) invalidTokens = true;
    else measurement[key] = value;
  }
  const runTokens: AgentCost["runTokens"] = invalidTokens
    ? unavailableAgentCost("binding_invalid").runTokens
    : Object.keys(measurement).length === 0 ? absent.runTokens
    : { ...absent.runTokens, availability: "available", measurement, reason: null,
      observedAt: run.updatedAt, revision: revision({ at: run.updatedAt, measurement }) };
  const amount = run.usage.costUsd;
  const meteredSpend: AgentCost["meteredSpend"] = amount === undefined ? absent.meteredSpend
    : !nonnegative(amount) ? unavailableAgentCost("binding_invalid").meteredSpend
    : { ...absent.meteredSpend, availability: "available", measurement: { amount, currency: "USD", accounting: "reported" },
      reason: null, observedAt: run.updatedAt, revision: revision({ at: run.updatedAt, amount }) };
  return { meteredSpend, runTokens };
}

function subscriptionHeadroom(run: RunRecord, capturedAt: string): AgentCost["subscriptionHeadroom"] {
  const absent = { ...unavailableAgentCost("measurement_missing").subscriptionHeadroom, availability: "unavailable", measurement: null, reason: "measurement_missing" } as const;
  if (run.quota.length === 0) return absent;
  // Never pick an older convenient value when the newest observation cannot be ordered.
  if (run.quota.some(q => !Number.isFinite(time(q.observedAt)) || time(q.observedAt) > time(capturedAt))) {
    return { ...absent, reason: "binding_invalid" };
  }
  const observedAt = run.quota.reduce((at, q) => q.observedAt > at ? q.observedAt : at, run.quota[0]!.observedAt);
  // One native observation batch only; do not merge historical windows across account changes.
  const latest = run.quota.filter(q => q.observedAt === observedAt);
  const windows = new Map<string, { remainingPercent: number; windowMinutes: number; resetsAt: string }>();
  for (const q of latest) {
    if (q.source !== run.source) return { ...absent, reason: "binding_invalid" };
    if (q.usedPercent === null || q.windowMinutes === null || q.resetsAt === null) return absent;
    if (!nonnegative(q.usedPercent) || q.usedPercent > 100 || !Number.isSafeInteger(q.windowMinutes) || q.windowMinutes <= 0 ||
      !Number.isFinite(time(q.resetsAt)) || time(q.resetsAt) <= time(observedAt)) return { ...absent, reason: "binding_invalid" };
    const value = { remainingPercent: 100 - q.usedPercent, windowMinutes: q.windowMinutes, resetsAt: q.resetsAt };
    const key = JSON.stringify([q.limitId, q.windowMinutes]);
    const prior = windows.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(value)) return { ...absent, reason: "binding_invalid" };
    windows.set(key, value);
  }
  // Most constrained *reported* window, not an average and not evidence about absent windows.
  const selected = [...windows.values()].sort((a, b) => a.remainingPercent - b.remainingPercent ||
    a.windowMinutes - b.windowMinutes || a.resetsAt.localeCompare(b.resetsAt))[0]!;
  const validUntil = [...windows.values()].map(w => w.resetsAt).sort()[0]!;
  const metadata = { observedAt, validUntil, revision: revision({ observedAt, validUntil, measurement: selected }) };
  // A reset invalidates the old batch. Do not silently drop the expired limiting window.
  if (latest.some(q => time(q.resetsAt!) <= time(capturedAt))) return { ...absent, reason: "source_stale", ...metadata };
  return { ...absent, availability: "available", measurement: selected, reason: null, ...metadata };
}

/** Caller proves unique run attribution; this function never joins by issue, prose or location. */
export function projectAgentCost(run: RunRecord, capturedAt: string): AgentCost {
  if (!Number.isFinite(time(capturedAt))) return unavailableAgentCost("binding_invalid");
  return { subscriptionHeadroom: subscriptionHeadroom(run, capturedAt), ...runUsage(run, capturedAt) };
}
