import assert from "node:assert/strict";
import { it } from "node:test";
import { readIssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { ISSUE_TOKEN_SOURCES } from "./issue-token-usage.js";
import type { RunRecord } from "./model.js";
import { later, dispatch, run, build } from "./fixtures/issue-agent-feed.js";

it("labels used tokens per vendor: OpenCode reads opencode-usage, AGY stays unavailable, never claude-usage", () => {
  assert.deepEqual({ ...ISSUE_TOKEN_SOURCES }, { codex: "codex-token-count", claude: "claude-usage", opencode: "opencode-usage" });
  assert.ok(Object.isFrozen(ISSUE_TOKEN_SOURCES));
  // OpenCode's input excludes both cache kinds and its output excludes reasoning, so all five are added.
  const usage = { inputTokens: 100, outputTokens: 20, reasoningTokens: 30, cacheReadTokens: 400, cacheWriteTokens: 5 };
  const rootFor = (source: RunRecord["source"], u: RunRecord["usage"]) =>
    [{ ...run("PRIVATE-NATIVE-ROOT", null, "running"), source, usage: u } as RunRecord];
  const agentFor = (source: RunRecord["source"], u: RunRecord["usage"]) => {
    const snapshot = build({ ...dispatch, source, harness: source }, rootFor(source, u));
    assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true, source);
    return snapshot.issues[0]!.dispatches[0]!.agents[0]!;
  };
  const opencode = agentFor("opencode", usage);
  assert.deepEqual(opencode.tokenUsage, { usedTokens: 555, budgetTokens: 1000, observedAt: later, source: "opencode-usage", reason: null });
  assert.deepEqual(opencode.resourceHistory?.tokens, { points: [], truncated: false, source: "unavailable", reason: "measurement_missing" });
  for (const [source, u] of [["opencode", {}], ["opencode", { ...usage, reasoningTokens: -1 }],
    ["agy", usage], ["agy", {}]] as const) {
    const a = agentFor(source, u);
    assert.deepEqual(a.tokenUsage, { usedTokens: null, budgetTokens: 1000, observedAt: null, source: "unavailable",
      reason: "measurement_missing" }, source + " " + JSON.stringify(u));
  }
  // The same numbers on a Claude run keep Claude's own counting: reasoning is inside its output.
  assert.deepEqual([agentFor("claude", usage).tokenUsage?.usedTokens, agentFor("claude", usage).tokenUsage?.source], [525, "claude-usage"]);
});
