/** The issue tree's used-tokens reading: one native counter per vendor, never another vendor's label. */
import type { AgentTokenSource, AgentTokenUsage } from "@rickylabs/harness-contracts";
import { processedInputTokens, processedOutputTokens, type RunRecord, type RunSource } from "./model.js";

/**
 * The issue-tree token source per vendor: which native counter a used-tokens figure is read from.
 * A vendor with no entry (AGY has no token reading) is always unavailable, never another vendor's label.
 */
export const ISSUE_TOKEN_SOURCES: Readonly<Partial<Record<RunSource, AgentTokenSource>>> = Object.freeze({
  codex: "codex-token-count", claude: "claude-usage", opencode: "opencode-usage" });

/**
 * A run's processed input + output under its vendor's own label. `observedAt` is the run's update
 * time once the caller has validated it as a clock, or null; without it the reading is unavailable.
 */
export function issueTokenUsage(run: RunRecord | undefined, budgetTokens: number | null,
  observedAt: string | null): AgentTokenUsage {
  const source = run === undefined ? undefined : ISSUE_TOKEN_SOURCES[run.source];
  const input = run === undefined ? undefined : processedInputTokens(run.source, run.usage);
  const output = run === undefined ? undefined : processedOutputTokens(run.source, run.usage);
  if (source !== undefined && observedAt !== null && input !== undefined && output !== undefined &&
      [input, output, input + output].every(count => Number.isSafeInteger(count) && count >= 0)) {
    return { usedTokens: input + output, budgetTokens, observedAt, source, reason: null };
  }
  return { usedTokens: null, budgetTokens, observedAt: null, source: "unavailable",
    reason: run === undefined ? "source_not_bound" : "measurement_missing" };
}
