/** Public-safe agent activity: the producer screens, the step shapes and their strict decoder. */
import type { AgentUnavailableReason } from "./agent-observations.js";
import { array, bad, reason, record, stamp } from "./issue-agent-tree-decode.js";

export const MAX_AGENT_ACTIVITY_STEPS = 20;
/** One canonical screen for producer prose and its public snapshot decoder. */
export function publicActivityText(value: unknown): string | null {
  if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value)) return null;
  const candidate = value.trim();
  const fixedDottedTool = candidate === "Used functions.exec" || candidate === "Used functions.update_plan";
  if (candidate.length < 3 || candidate.length > 120 ||
      !/^[A-Za-z0-9][A-Za-z0-9 .,;:!?()'_-]*$/.test(candidate) ||
      /(?:secret|password|credential|private|bearer|token|api.?key|github_pat_|gh[pousr]_|\bsk-[A-Za-z0-9]{12,})/i.test(candidate) ||
      /(?:\b\d{1,3}(?:\.\d{1,3}){3}\b|\b[a-f0-9]{24,}\b|[A-Za-z0-9_-]{32,})/i.test(candidate) ||
      (!fixedDottedTool && /\b[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+\b/i.test(candidate)) ||
      /\b(?:recovery|backup|verification|one[- ]time|otp|mfa|2fa|passcode|pin)\b/i.test(candidate) ||
      /\b(?:code|key)\s+[A-Za-z0-9-]*\d[A-Za-z0-9-]*\b/i.test(candidate) ||
      /\b\d{6,8}\b|\b\d{3}(?:[ -]\d{3})+\b|\b[A-Z0-9]{4}(?:-[A-Z0-9]{4})+\b/.test(candidate)) return null;
  return candidate;
}
export type AgentActivityTargetKind = "command" | "file" | "search";
/** Reject the whole target when it does not pass the same public prose screen. */
export function publicActivityTarget(kind: AgentActivityTargetKind, value: unknown): string | null {
  if (typeof value !== "string" || value.length > 120 || value !== value.trim()) return null;
  if (kind === "file") {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(value) || value.includes("..")) return null;
    return publicActivityText(value.replace(/[._-]+/g, " ")) === null ? null : value;
  }
  if (kind === "command" && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}(?: [A-Za-z0-9][A-Za-z0-9_.-]{0,31})?$/.test(value)) return null;
  return publicActivityText(value) === value ? value : null;
}

/** Public-safe, bounded descriptions of the bound native agent's recent work. */
export interface AgentActivityStep {
  readonly id: string;
  readonly at: string;
  readonly kind: "tool" | "command" | "file" | "message";
  readonly toolName: string | null;
  readonly commandHead: string | null;
  /** Repository-relative only; an absolute native path is never published. */
  readonly filePath: string | null;
  readonly summary: string | null;
  /** Additive in the next contracts minor; a screened, tool-specific display target. */
  readonly target?: { readonly kind: AgentActivityTargetKind; readonly value: string } | null;
  readonly source: "codex-rollout" | "claude-transcript" | "agy-transcript" | "opencode-transcript";
  /**
   * Additive in the next contracts minor, on tool, command and file steps only: the native step's
   * observed end, or `unknown` where the producer cannot prove one. A step without it makes no claim.
   */
  readonly state?: AgentActivityState;
}
/** A native end the producer observed; `unknown` never means running, failed or zero. */
export const AGENT_ACTIVITY_STATES = ["completed", "failed", "cancelled", "unknown"] as const;
export type AgentActivityState = typeof AGENT_ACTIVITY_STATES[number];
/** Closed, canonically ordered reasons the published activity is narrower than the native run. */
export const AGENT_ACTIVITY_GAPS = ["tool-names-source-missing", "tool-names-source-invalid",
  "tool-names-budget-exhausted", "tool-names-truncated", "tool-names-lines-missing", "tool-names-vendor-truncated",
  "call-lifecycle-unproven", "in-progress-unattributed"] as const;
export type AgentActivityGap = typeof AGENT_ACTIVITY_GAPS[number];
/** Additive in the next contracts minor; empty `gaps` states full coverage of the published window. */
export interface AgentActivityCoverage { readonly gaps: readonly AgentActivityGap[] }
export type AgentActivity =
  | { readonly availability: "available"; readonly reason: null; readonly observedAt: string;
      readonly steps: readonly AgentActivityStep[]; readonly coverage?: AgentActivityCoverage }
  | { readonly availability: "unavailable"; readonly reason: AgentUnavailableReason; readonly observedAt: null;
      readonly steps: readonly [] };

/** Decode one agent's activity; used by the issue-agent tree reader. */
export function readAgentActivity(value: unknown, capturedAt: string): AgentActivity {
  const hasCoverage = Object.hasOwn(value as object, "coverage");
  const row = record(value, ["availability", "reason", "observedAt", "steps", ...(hasCoverage ? ["coverage"] : [])]);
  const steps = array(row.steps, MAX_AGENT_ACTIVITY_STEPS);
  if (row.availability === "unavailable" && row.observedAt === null && steps.length === 0 && !hasCoverage) {
    return { availability: "unavailable", reason: reason(row.reason), observedAt: null, steps: [] };
  }
  if (row.availability !== "available" || row.reason !== null) return bad();
  const observedAt = stamp(row.observedAt);
  if (observedAt > capturedAt) return bad();
  const ids = new Set<string>();
  const decoded = steps.map(value => {
    const s = record(value, ["id", "at", "kind", "toolName", "commandHead", "filePath", "summary", "source",
      ...(Object.hasOwn(value as object, "target") ? ["target"] : []),
      ...(Object.hasOwn(value as object, "state") ? ["state"] : [])]);
    if (typeof s.id !== "string" || !/^step_[a-f0-9]{64}$/.test(s.id) || ids.has(s.id)) return bad();
    ids.add(s.id);
    const at = stamp(s.at);
    if (at > observedAt || !["tool", "command", "file", "message"].includes(s.kind as string) ||
        (s.source !== "codex-rollout" && s.source !== "claude-transcript" && s.source !== "agy-transcript" && s.source !== "opencode-transcript")) return bad();
    if (s.toolName !== null && (typeof s.toolName !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(s.toolName))) return bad();
    if (s.commandHead !== null && (typeof s.commandHead !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}(?: [A-Za-z0-9][A-Za-z0-9_.-]{0,31})?$/.test(s.commandHead))) return bad();
    if (s.filePath !== null && (typeof s.filePath !== "string" || s.filePath.length > 256 ||
        !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(s.filePath) ||
        s.filePath.split("/").some(part => part === "." || part === ".." ||
          publicActivityTarget("file", part) === null))) return bad();
    if (s.summary !== null && publicActivityText(s.summary) !== s.summary) return bad();
    if (Object.hasOwn(s, "state") && (s.kind === "message" ||
        !AGENT_ACTIVITY_STATES.includes(s.state as AgentActivityState))) return bad();
    let target: AgentActivityStep["target"];
    if (Object.hasOwn(s, "target")) {
      if (s.target === null) target = null;
      else {
        const t = record(s.target, ["kind", "value"]);
        if (t.kind !== "command" && t.kind !== "file" && t.kind !== "search") return bad();
        if (publicActivityTarget(t.kind, t.value) !== t.value) return bad();
        if (t.kind === "command" && (s.kind !== "command" || s.commandHead !== t.value)) return bad();
        if (t.kind === "file" && (s.kind !== "file" || typeof s.filePath !== "string" ||
          !["read_file", "write_file", "Read", "Edit", "Write", "NotebookEdit"].includes(s.toolName as string) ||
          s.filePath.split("/").at(-1) !== t.value)) return bad();
        if (t.kind === "search" && (s.toolName !== "Grep" && s.toolName !== "Glob")) return bad();
        target = { kind: t.kind, value: t.value as string };
      }
    }
    return { id: s.id, at, kind: s.kind as AgentActivityStep["kind"], toolName: s.toolName as string | null,
      commandHead: s.commandHead as string | null, filePath: s.filePath as string | null,
      summary: s.summary as string | null, source: s.source as AgentActivityStep["source"],
      ...(Object.hasOwn(s, "target") ? { target: target ?? null } : {}),
      ...(Object.hasOwn(s, "state") ? { state: s.state as AgentActivityState } : {}) };
  });
  for (let i = 1; i < decoded.length; i++) if (decoded[i - 1]!.at < decoded[i]!.at) return bad();
  if (!hasCoverage) return { availability: "available", reason: null, observedAt, steps: decoded };
  const coverage = record(row.coverage, ["gaps"]);
  const gaps = array(coverage.gaps, AGENT_ACTIVITY_GAPS.length).map(gap =>
    AGENT_ACTIVITY_GAPS.includes(gap as AgentActivityGap) ? gap as AgentActivityGap : bad());
  // Unique and canonical, so equal coverage always serializes (and revisions) identically.
  for (let i = 1; i < gaps.length; i++) {
    if (AGENT_ACTIVITY_GAPS.indexOf(gaps[i - 1]!) >= AGENT_ACTIVITY_GAPS.indexOf(gaps[i]!)) return bad();
  }
  return { availability: "available", reason: null, observedAt, steps: decoded, coverage: { gaps } };
}
