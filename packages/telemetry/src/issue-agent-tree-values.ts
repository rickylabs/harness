/** Shared public value screens and deterministic identities for tree projection. */
import { createHash } from "node:crypto";
import type { AgentTreeValue, AgentRoutePolicy, AgentTimelineEvent, AgentTimelineReason } from "@rickylabs/harness-contracts";
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const opaque = (kind: "agent" | "assignment", value: string) => `${kind}_${digest(kind + "\0" + value)}`;
export const unavailable: AgentTreeValue = { value: null, source: "unavailable", reason: "source_not_bound" };
export const unavailablePolicy: AgentRoutePolicy = { value: null, digest: null, source: "unavailable", reason: "source_not_bound" };
export const publicLabel = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && !value.includes("..");
export const safe = (value: string | null | undefined, source: "dispatch" | "native"): AgentTreeValue =>
  publicLabel(value)
    ? { value, source, reason: null } : unavailable;
export const time = (value: string | undefined, latest: string): string | null =>
  value && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value && value <= latest ? value : null;
/** Orchid receipts may have nanoseconds; the public timeline wire time has milliseconds. */
export const receiptTime = (value: string | undefined, latest: string): string | null => {
  if (!value || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)) return null;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  const at = new Date(millis).toISOString();
  return at.slice(0, 19) === value.slice(0, 19) && at <= latest ? at : null;
};
export const event = (agentId: string, kind: AgentTimelineEvent["kind"], at: string,
  source: AgentTimelineEvent["source"], relatedAgentId: string | null = null,
  outcome: AgentTimelineEvent["outcome"] = null, reason: AgentTimelineReason | null = null): AgentTimelineEvent => ({
    id: `event_${digest([agentId, kind, at, relatedAgentId ?? "", outcome ?? ""].join("\0"))}`,
    at, kind, action: null, relatedAgentId, source, outcome, reason });
export const orderedEvents = (events: readonly AgentTimelineEvent[]) => [...events]
  .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
