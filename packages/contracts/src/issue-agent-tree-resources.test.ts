import assert from "node:assert/strict";
import { it } from "node:test";
import { AGENT_TOKEN_SOURCES } from "./issue-agent-tree.js";
import { at, dispatchId, node, observation, read, snapshot } from "./fixtures/issue-agent-tree.js";

it("accepts a sourced current budget only as a positive receipt value on the root", () => {
  const s = snapshot();
  const withBudget = (budget: unknown) => ({ ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId,
    agents: [{ ...node, budget }] }] }] });
  assert.equal(read(withBudget({ tokenLimit: 1_500, source: "action-receipt", reason: null })).ok, true);
  assert.equal(read(withBudget({ tokenLimit: 0, source: "action-receipt", reason: null })).ok, false);
  assert.equal(read(withBudget({ tokenLimit: "PRIVATE-BUDGET", source: "action-receipt", reason: null })).ok, false);
});
it("decodes bounded source-backed resource history and rejects invented child budgets", () => {
  const s = snapshot();
  const budget = { tokenLimit: 1_000, source: "route-default", reason: null } as const;
  const usage = { usedTokens: 7, budgetTokens: 1_000, observedAt: at,
    source: "codex-token-count", reason: null } as const;
  const resourceHistory = { tokens: { points: [{ at, usedTokens: 7 }], truncated: false,
    source: "codex-token-count", reason: null },
    budgets: { points: [{ at, tokenLimit: 1_000, source: "route-default" }],
      truncated: false, reason: null } } as const;
  const root = { ...node, parentAgentId: null, budget, tokenUsage: usage, resourceHistory };
  const tree = (agents: unknown[]) => ({ ...s, issues: [{ ...s.issues[0],
    dispatches: [{ dispatchId, agents }] }] });
  assert.equal(read(tree([root])).ok, true);
  assert.equal(read(tree([{ ...root, resourceHistory: { ...resourceHistory,
    tokens: { ...resourceHistory.tokens, points: [{ at, usedTokens: 8 }] } } }])).ok, false);
  assert.equal(read(tree([{ ...root, resourceHistory: { ...resourceHistory,
    tokens: { ...resourceHistory.tokens, points: [{ at, usedTokens: Number.MAX_SAFE_INTEGER + 1 }] } } }])).ok, false);
  assert.equal(read(tree([{ ...root, resourceHistory: { ...resourceHistory,
    tokens: { ...resourceHistory.tokens, points: [{ at: "2026-02-30T00:00:00.000Z", usedTokens: 7 }] } } }])).ok, false);
  assert.equal(read(tree([{ ...root, resourceHistory: { ...resourceHistory,
    budgets: { ...resourceHistory.budgets, points: [{ at, tokenLimit: 900, source: "route-default" }] } } }])).ok, false);
  assert.equal(read(tree([{ ...root, resourceHistory: { ...resourceHistory,
    budgets: { ...resourceHistory.budgets, points: [{ at, tokenLimit: 0, source: "route-default" }] } } }])).ok, false);
  assert.equal(read(tree([{ ...root, resourceHistory: { ...resourceHistory,
    budgets: { ...resourceHistory.budgets, points: [{ at, tokenLimit: 1_000, source: "action-receipt" }] } } }])).ok, false);
  assert.equal(read(tree([{ ...root, resourceHistory: { ...resourceHistory,
    tokens: { ...resourceHistory.tokens, truncated: true } } }])).ok, false);
  const childObservation = { ...observation, agentId: "agent_" + "d".repeat(64),
    parentAgentId: { state: "known-parent", value: observation.agentId, reason: null } };
  const child = { ...root, observation: childObservation, parentAgentId: observation.agentId,
    harness: { value: "codex", source: "native", reason: null },
    budget: node.budget, tokenUsage: { ...usage, budgetTokens: null },
    resourceHistory: { tokens: resourceHistory.tokens,
      budgets: { points: [], truncated: false, reason: "source_not_bound" } } };
  assert.equal(read(tree([root, child])).ok, true);
  assert.equal(read(tree([root, { ...child, budget, tokenUsage: usage, resourceHistory }])).ok, false);
  assert.equal(read(tree([{ ...node, resourceHistory: { tokens: { points: [], truncated: false,
    source: "unavailable", reason: "source_not_bound" }, budgets: { points: [], truncated: false,
    reason: "source_not_bound" } } }])).ok, true);
});
it("0.40.0: decodes OpenCode token usage and history per vendor, and refuses an unknown token source", () => {
  assert.deepEqual([...AGENT_TOKEN_SOURCES], ["codex-token-count", "claude-usage", "opencode-usage"]);
  assert.ok(Object.isFrozen(AGENT_TOKEN_SOURCES));
  const s = snapshot();
  const opencode = { ...node, harness: { value: "opencode", source: "dispatch", reason: null } };
  const tree = (agent: unknown) => ({ ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId, agents: [agent] }] }] });
  const usage = (source: string) => ({ usedTokens: 555, budgetTokens: null, observedAt: at, source, reason: null });
  const history = (source: string) => ({ tokens: { points: [{ at, usedTokens: 555 }], truncated: false, source, reason: null },
    budgets: { points: [], truncated: false, reason: "source_not_bound" } });
  const decoded = read(tree({ ...opencode, tokenUsage: usage("opencode-usage") }));
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.equal(decoded.snapshot.issues[0]?.dispatches[0]?.agents[0]?.tokenUsage?.source, "opencode-usage");
  assert.equal(read(tree({ ...opencode, tokenUsage: usage("opencode-usage"), resourceHistory: history("opencode-usage") })).ok, true);
  // History and current usage must name the same counter.
  assert.equal(read(tree({ ...opencode, tokenUsage: usage("opencode-usage"), resourceHistory: history("claude-usage") })).ok, false);
  for (const source of ["agy-usage", "opencode", "OPENCODE-USAGE", null, 1]) {
    assert.equal(read(tree({ ...opencode, tokenUsage: usage(source as string) })).ok, false, String(source));
  }
  assert.equal(read(tree({ ...opencode, tokenUsage: { usedTokens: null, budgetTokens: null, observedAt: null,
    source: "unavailable", reason: "measurement_missing" } })).ok, true);
});
