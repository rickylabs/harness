/** Strict decode primitives for the issue-agent tree reader; internal, not exported from the package. */
import { AGENT_UNAVAILABLE_REASONS, type AgentUnavailableReason } from "./agent-observations.js";
import type { IssueAgentTreeReading } from "./issue-agent-tree.js";

export class Invalid extends Error { constructor(readonly reason: Exclude<IssueAgentTreeReading, { ok: true }>["reason"] = "invalid") { super(reason); } }
export const bad = (reason?: Invalid["reason"]): never => { throw new Invalid(reason); };
export function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return bad();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || keys.some(key => !own.includes(key))) return bad();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !("value" in desc) || !desc.enumerable) return bad();
    out[key] = desc.value;
  }
  return out;
}
export function array(value: unknown, cap: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > cap) return bad(value instanceof Array && value.length > cap ? "oversized" : "invalid");
  if (Reflect.ownKeys(value).length !== value.length + 1) return bad();
  return Array.from({ length: value.length }, (_, i) => {
    const desc = Object.getOwnPropertyDescriptor(value, String(i));
    if (!desc || !("value" in desc) || !desc.enumerable) return bad();
    return desc.value;
  });
}
export function stamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return bad();
  return value;
}
export function label(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value.includes("..")) return bad();
  return value;
}
export function reason(value: unknown): AgentUnavailableReason {
  if (typeof value !== "string" || !AGENT_UNAVAILABLE_REASONS.includes(value as AgentUnavailableReason)) return bad();
  return value as AgentUnavailableReason;
}
