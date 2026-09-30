import assert from "node:assert/strict";
import { it } from "node:test";
import { projectRouteIdentity } from "./route.js";
import { ISSUE_AGENT_TREE_FRESH_MS, readIssueAgentTreeSnapshot, type IssueAgentTreeSnapshot } from "./issue-agent-tree.js";
import { unavailableAgentCost, type AgentObservation } from "./agent-observations.js";

const at = "2026-01-01T00:00:00.000Z", rev = "a".repeat(64), dispatchId = "assignment_" + "b".repeat(64);
const absent = () => ({ value: null, reason: "source_not_bound", observedAt: null, validUntil: null, revision: null } as const);
const observation: AgentObservation = { agentId: "agent_" + "c".repeat(64), repo: { owner: "example", name: "project" }, issueNumber: 42,
  assignment: { id: dispatchId, dispatcher: "divybot", basis: "dispatcher-confirmed" },
  parentAgentId: { state: "confirmed-root", value: null, reason: null }, workspace: absent(), pane: absent(), tab: absent(), terminal: absent(),
  running: absent(), route: projectRouteIdentity(null), cost: unavailableAgentCost(), observedAt: at, revision: rev };
const unknown = { value: null, source: "unavailable", reason: "source_not_bound" } as const;
const unplaced = { value: null, basis: "unavailable", observedAt: null, reason: "source_not_bound" } as const;
const node = { dispatchId, observation, harness: { value: "codex", source: "dispatch", reason: null }, provider: unknown,
  router: unknown, routePolicy: { value: null, digest: null, source: "unavailable", reason: "source_not_bound" },
  model: unknown, location: { host: unplaced, container: unplaced, seat: unplaced },
  nativeDepth: unknown,
  budget: { tokenLimit: null, source: "unavailable", reason: "source_not_bound" }, quotaRegime: { value: "subscription", reason: null },
  liveness: { state: "unknown", evidence: null, observedAt: null, reason: "measurement_missing" },
  actionState: { state: "unknown", observedAt: null, reason: "source_not_bound" }, endedBy: null,
  terminalOutcome: { value: null, source: "unavailable", observedAt: null, reason: "measurement_missing" },
  startedAt: null, startedAtReason: "run_not_found", endedAt: null, endedAtReason: "measurement_missing",
  transcript: { value: null, reason: "source_not_bound" },
  history: [{ dispatchId, kind: "dispatch-observed", at }], historyTruncated: false } as const;
const snapshot = (): IssueAgentTreeSnapshot => ({ schema: 1, protocol: 1, observedAt: at,
  validUntil: "2026-01-01T00:00:15.000Z", revision: rev, complete: true, reason: null,
  issues: [{ repo: observation.repo, issueNumber: 42, complete: true, reason: null,
    dispatches: [{ dispatchId, agents: [node] }] }] });
const read = (value: unknown) => readIssueAgentTreeSnapshot(value);

it("decodes a grouped opaque dispatch tree with explicit unknowns", () => {
  const result = read(snapshot());
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.snapshot.issues[0]?.dispatches[0]?.agents[0]?.budget.tokenLimit, null);
});
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
it("accepts a source-bound launch refusal with no agent and rejects unsourced or unsafe reasons", () => {
  const s = snapshot();
  const refusal = { state: "refused", reason: "routing-invalid", at, dispatchId, source: "orchid" };
  const issue = { ...s.issues[0]!, dispatches: [], launchRefusal: refusal };
  const withRefusal = (value: unknown) => ({ ...s, issues: [{ ...issue, launchRefusal: value }] });
  const result = read({ ...s, issues: [issue] });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.snapshot.issues[0]?.launchRefusal, refusal);
  assert.equal(read({ ...s, issues: [{ ...issue, launchRefusal: undefined }] }).ok, false);
  assert.equal(read(withRefusal({ ...refusal, reason: "PRIVATE-issue-content" })).ok, false);
  assert.equal(read(withRefusal({ ...refusal, reason: "goal-prompt-unconfirmed" })).ok, false);
  assert.equal(read(withRefusal({ ...refusal, at: "2026-01-01T00:00:01.000Z" })).ok, false);
  assert.equal(read(withRefusal({ ...refusal, dispatchId: "PRIVATE-NATIVE-ID" })).ok, false);
  assert.equal(read({ ...s, issues: [{ ...s.issues[0], dispatches: [] }] }).ok, false);
});
it("reads sourced effort and exact opaque parent links while preserving old frames", () => {
  const s = snapshot();
  const root = { ...node, effort: unknown, parentAgentId: null };
  const childObservation = { ...observation, agentId: "agent_" + "d".repeat(64),
    parentAgentId: { state: "known-parent", value: observation.agentId, reason: null } };
  const child = { ...node, observation: childObservation,
    harness: { value: "codex", source: "native", reason: null },
    effort: unknown, parentAgentId: observation.agentId };
  const tree = (agents: unknown[]) => ({ ...s, issues: [{ ...s.issues[0],
    dispatches: [{ dispatchId, agents }] }] });
  assert.equal(read(tree([root, child])).ok, true);
  assert.equal(read(tree([root, { ...child, parentAgentId: "agent_" + "e".repeat(64) }])).ok, false);
  assert.equal(read(tree([root, { ...child, parentAgentId: null }])).ok, false);
  assert.equal(read(tree([{ ...root, parentAgentId: childObservation.agentId }, child])).ok, false);
  assert.equal(read(tree([root, { ...child, effort: { value: "high", source: "dispatch", reason: null } }])).ok, false);
  const routedObservation = { ...observation, route: projectRouteIdentity({ requested: {
    provider: { value: "fixture-provider", source: "request.modelProvider" },
    model: { value: "fixture-model", source: "request.model" },
    effort: { value: "high", source: "request.effort" },
  } }) };
  const routed = { ...root, observation: routedObservation,
    effort: { value: "high", source: "dispatch", reason: null } };
  assert.equal(read(tree([routed])).ok, true);
  assert.equal(read(tree([{ ...routed, effort: unknown }])).ok, false);
  assert.equal(read(tree([{ ...routed, effort: { value: "low", source: "dispatch", reason: null } }])).ok, false);
  assert.equal(read(s).ok, true);
});
it("binds optional profile and matrix revisions to the root dispatch for every agent row", () => {
  const s = snapshot();
  const pin = { value: "a".repeat(40), scope: "root-dispatch", source: "dispatch", reason: null } as const;
  const second = { ...pin, value: "b".repeat(40) };
  const root = { ...node, profileRevision: pin, matrixRevision: second };
  const child = { ...node, observation: { ...observation, agentId: "agent_" + "d".repeat(64),
    parentAgentId: { state: "known-parent", value: observation.agentId, reason: null } },
    harness: { value: "codex", source: "native", reason: null },
    profileRevision: pin, matrixRevision: second };
  const tree = (agents: unknown[]) => ({ ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId, agents }] }] });
  assert.equal(read(tree([root, child])).ok, true);
  assert.equal(read(tree([node])).ok, true); // Older producer remains readable.
  assert.equal(read(tree([{ ...root, matrixRevision: undefined }])).ok, false);
  assert.equal(read(tree([{ ...root, profileRevision: { ...pin, value: "/private/path" } }])).ok, false);
  assert.equal(read(tree([{ ...root, profileRevision: { ...pin, source: "native" } }])).ok, false);
  assert.equal(read(tree([root, { ...child, matrixRevision: { ...pin, value: "c".repeat(40) } }])).ok, false);
  assert.equal(read(tree([root, { ...child, profileRevision: { value: null, scope: "root-dispatch",
    source: "unavailable", reason: "source_not_bound" } }])).ok, true);
});
it("accepts only screened activity targets tied to their typed tool evidence", () => {
  const s = snapshot();
  const step = { id: "step_" + "d".repeat(64), at, kind: "command", toolName: "exec_command",
    commandHead: "git status", filePath: null, summary: "Ran git status", source: "codex-rollout" };
  const tree = (entry: unknown) => ({ ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId, agents: [
    { ...node, activity: { availability: "available", reason: null, observedAt: at, steps: [entry] } } ] }] }] });
  assert.equal(read(tree({ ...step, target: { kind: "command", value: "git status" } })).ok, true);
  assert.equal(read(tree({ ...step, target: { kind: "command", value: "git log" } })).ok, false);
  assert.equal(read(tree({ ...step, target: { kind: "file", value: "main.ts" } })).ok, false);
  assert.equal(read(tree({ ...step, target: { kind: "search", value: "private secret" } })).ok, false);
  const file = { ...step, kind: "file", toolName: "Read", commandHead: null, filePath: "src/main.ts" };
  assert.equal(read(tree({ ...file, target: { kind: "file", value: "main.ts" } })).ok, true);
  assert.equal(read(tree({ ...file, target: { kind: "file", value: "secret-token.ts" } })).ok, false);
  assert.equal(read(tree({ ...file, filePath: "src/secret-token.ts", target: null })).ok, false);
  const search = { ...step, kind: "tool", toolName: "Grep", commandHead: null };
  assert.equal(read(tree({ ...search, target: { kind: "search", value: "route status" } })).ok, true);
  assert.equal(read(tree({ ...search, target: { kind: "search", value: "Use recovery code 482916" } })).ok, false);
  assert.equal(read(tree(step)).ok, true);
});
it("accepts bounded activity and rejects mismatched usage, raw paths, and unsourced timeline events", () => {
  const s = snapshot();
  const withNode = (agent: unknown) => ({ ...s, issues: [{ ...s.issues[0],
    dispatches: [{ dispatchId, agents: [agent] }] }] });
  const step = { id: "step_" + "d".repeat(64), at, kind: "command", toolName: "exec_command",
    commandHead: "git status", filePath: null, summary: "Ran git status", source: "codex-rollout" };
  const event = { id: "event_" + "e".repeat(64), at, kind: "dispatched", action: null,
    relatedAgentId: null, source: "dispatch", outcome: null };
  const populated = { ...node, activity: { availability: "available", reason: null, observedAt: at, steps: [step] },
    tokenUsage: { usedTokens: 7, budgetTokens: null, observedAt: at, source: "codex-token-count", reason: null },
    timeline: { events: [event], truncated: false } };
  assert.equal(read(withNode(populated)).ok, true);
  assert.equal(read(withNode({ ...populated, tokenUsage: { ...populated.tokenUsage, budgetTokens: 1000 } })).ok, false);
  assert.equal(read(withNode({ ...populated, activity: { ...populated.activity,
    steps: [{ ...step, filePath: "/private/host/path" }] } })).ok, false);
  for (const summary of ["Use recovery code 482916", "Check backup code ABCD-EFGH",
    "Enter OTP 482916", "Check recovery phrase", "Enter 482916", "Use ABCD-EFGH"]) {
    assert.equal(read(withNode({ ...populated, activity: { ...populated.activity,
      steps: [{ ...step, summary }] } })).ok, false);
  }
  assert.equal(read(withNode({ ...populated, activity: { ...populated.activity,
    steps: [{ ...step, summary: "Review code coverage" }] } })).ok, true);
  assert.equal(read(withNode({ ...populated, activity: { ...populated.activity,
    steps: [{ ...step, toolName: "functions.exec", commandHead: null, summary: "Used functions.exec" }] } })).ok, true);
  assert.equal(read(withNode({ ...populated, timeline: { ...populated.timeline,
    events: [{ ...event, kind: "goal-complete" }] } })).ok, false);
  assert.equal(read(withNode({ ...populated, timeline: { ...populated.timeline,
    events: [{ ...event, kind: "action-accepted", source: "action-receipt", action: "stop" }] } })).ok, true);
  const accepted = { ...event, kind: "action-accepted", source: "action-receipt", action: "steer",
    reason: "prompt_delivered" };
  assert.equal(read(withNode({ ...populated, timeline: { events: [accepted], truncated: false } })).ok, true);
  for (const [action, reason] of [["raise_budget", "goal_budget_updated"], ["retry", "retry_dispatched"]]) {
    assert.equal(read(withNode({ ...populated, timeline: { events: [{ ...accepted, action, reason }], truncated: false } })).ok, true);
    assert.equal(read(withNode({ ...populated, timeline: { events: [{ ...accepted, action, reason: "prompt_delivered" }], truncated: false } })).ok, false);
  }
  for (const reason of ["budget_ceiling_exceeded", "retry_pins_unavailable", "retry_terminal_unproven"]) {
    assert.equal(read(withNode({ ...populated, timeline: { events: [{ ...accepted, kind: "action-rejected", reason }], truncated: false } })).ok, true);
  }
  for (const reason of ["/private/raw/path", "native-complete", "workspace_close_delivered"]) {
    assert.equal(read(withNode({ ...populated, timeline: { events: [{ ...accepted, reason }], truncated: false } })).ok, false);
  }
});
it("decodes verified stop phases and rejects a stop receipt posing as terminal proof", () => {
  const base = snapshot();
  const withNode = (agent: unknown) => ({ ...base, issues: [{ ...base.issues[0],
    dispatches: [{ dispatchId, agents: [agent] }] }] });
  const stopping = { ...node, actionState: { state: "stopping", observedAt: at, reason: null } };
  assert.equal(read(withNode(stopping)).ok, true);
  assert.equal(read(withNode({ ...stopping, endedBy: "stop" })).ok, false);
  const independentlyEnded = { ...stopping,
    liveness: { state: "ended", evidence: "native-outcome", observedAt: at, reason: null },
    terminalOutcome: { value: "succeeded", source: "native-outcome", observedAt: at, reason: null } };
  assert.equal(read(withNode(independentlyEnded)).ok, true);
  const stopped = { ...node, actionState: { state: "stopped", observedAt: at, reason: null },
    liveness: { state: "ended", evidence: "stop-observation", observedAt: at, reason: null },
    endedBy: "stop", terminalOutcome: { value: "cancelled", source: "stop-observation", observedAt: at, reason: null },
    startedAt: at, startedAtReason: null, endedAt: at, endedAtReason: null };
  assert.equal(read(withNode(stopped)).ok, true);
  const ended = { id: "event_" + "e".repeat(64), at, kind: "ended", action: null,
    relatedAgentId: null, source: "terminal", outcome: "cancelled", reason: "stop" };
  assert.equal(read(withNode({ ...stopped, timeline: { events: [ended], truncated: false } })).ok, true);
  assert.equal(read(withNode({ ...stopped, timeline: { events: [{ ...ended, reason: "timeout" }], truncated: false } })).ok, false);
  assert.equal(read(withNode({ ...stopped, timeline: { events: [{ ...ended, reason: "/private/raw/path" }], truncated: false } })).ok, false);
  assert.equal(read(withNode({ ...stopped, actionState: stopping.actionState })).ok, false);
  assert.equal(read(withNode({ ...stopped, endedAt: null, endedAtReason: "measurement_missing" })).ok, false);
  assert.equal(read(withNode({ ...stopped, terminalOutcome: { ...stopped.terminalOutcome, value: "succeeded" } })).ok, false);
  assert.equal(read(withNode({ ...node, terminalOutcome: stopped.terminalOutcome })).ok, false);
  const { actionState: _a, endedBy: _e, ...legacy } = node;
  assert.equal(read(withNode(legacy)).ok, true);
});
it("accepts verified timeout teardown and rejects a missing terminal observation", () => {
  const base = snapshot();
  const withNode = (agent: unknown) => ({ ...base, issues: [{ ...base.issues[0],
    dispatches: [{ dispatchId, agents: [agent] }] }] });
  const ended = { ...node,
    liveness: { state: "ended", evidence: "teardown-observation", observedAt: at, reason: null },
    endedBy: "timeout", terminalOutcome: { value: "cancelled", source: "teardown-observation", observedAt: at, reason: null },
    startedAt: at, startedAtReason: null, endedAt: at, endedAtReason: null,
    history: [...node.history, { dispatchId, kind: "teardown-seat-observed", at }] };
  // Equal-time history entries need alphabetical kind order; this fixture is
  // only about the terminal contract.
  const { history: _history, ...core } = ended;
  assert.equal(read(withNode({ ...core, history: node.history })).ok, true);
  assert.equal(read(withNode({ ...core, history: node.history, endedBy: "teardown" })).ok, true);
  assert.equal(read(withNode({ ...core, history: node.history, endedAt: null, endedAtReason: "measurement_missing" })).ok, false);
  assert.equal(read(withNode({ ...core, history: node.history, terminalOutcome: node.terminalOutcome })).ok, false);
  assert.equal(read(withNode({ ...core, history: node.history, liveness: node.liveness })).ok, false);
});
it("requires a running measurement to cover its entire public frame", () => {
  const base = snapshot();
  const measured = { value: true, reason: null, observedAt: at, validUntil: base.validUntil, revision: rev } as const;
  const runningNode = { ...node, observation: { ...observation, running: measured },
    liveness: { state: "running", evidence: "runtime-observation", observedAt: at, reason: null } } as const;
  const withNode = (agent: unknown) => ({ ...base, issues: [{ ...base.issues[0], dispatches: [{ dispatchId, agents: [agent] }] }] });
  assert.equal(read(withNode(runningNode)).ok, true); // Equality at the frame deadline is valid.
  assert.equal(read(withNode({ ...runningNode, observation: { ...observation,
    running: { ...measured, validUntil: "2026-01-01T00:00:14.999Z" } } })).ok, false);
  assert.equal(read(withNode({ ...runningNode, observation: { ...observation,
    running: { ...measured, validUntil: null } } })).ok, false);
  assert.equal(read(withNode({ ...runningNode, observation: { ...observation,
    running: { ...measured, value: false } } })).ok, false);
  assert.equal(read(withNode({ ...runningNode, observation })).ok, false);
  assert.equal(read(withNode({ ...runningNode, liveness: { ...runningNode.liveness,
    observedAt: "2025-12-31T23:59:59.000Z" } })).ok, false);
  assert.equal(read(withNode({ ...runningNode, liveness: node.liveness })).ok, false);
  assert.equal(read(withNode({ ...runningNode, liveness: { state: "ended", evidence: "native-outcome",
    observedAt: at, reason: null }, terminalOutcome: { value: "succeeded", source: "native-outcome",
    observedAt: at, reason: null } })).ok, false);
  assert.equal(read(withNode(node)).ok, true); // Existing unknown rows remain valid.
  assert.equal(read(withNode({ ...node, liveness: { state: "ended", evidence: "native-outcome",
    observedAt: at, reason: null } })).ok, true);
});
it("retains sourced zero, rejects invalid budgets and unsupported router claims", () => {
  const s = snapshot();
  const mutate = (patch: Record<string, unknown>) => ({ ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId, agents: [{ ...node, ...patch }] }] }] });
  assert.equal(read(mutate({ nativeSessionId: "PRIVATE-CANARY" })).ok, false);
  assert.equal(read(mutate({ budget: { tokenLimit: 0, source: "route-default", reason: null } })).ok, true);
  assert.equal(read(mutate({ budget: { tokenLimit: -1, source: "route-default", reason: null } })).ok, false);
  assert.equal(read(mutate({ budget: { tokenLimit: null, source: "route-default", reason: null } })).ok, false);
  assert.equal(read(mutate({ router: { value: "PRIVATE-PATH-CANARY", source: "native", reason: null } })).ok, false);
  assert.equal(read(mutate({ router: { value: "router", source: "dispatch", reason: null } })).ok, false);
  assert.equal(read(mutate({ router: { value: "direct", source: "dispatch", reason: null } })).ok, true);
  assert.equal(read(mutate({ harness: { value: "opencode", source: "dispatch", reason: null },
    router: { value: "openai", source: "dispatch", reason: null } })).ok, false);
  assert.equal(read(mutate({ routePolicy: { value: "netscript-matrix", digest: rev, source: "dispatch", reason: null } })).ok, true);
  assert.equal(read(mutate({ routePolicy: { value: "harness-matrix", digest: rev, source: "dispatch", reason: null } })).ok, true);
  assert.equal(read(mutate({ routePolicy: { value: "unknown-matrix", digest: rev, source: "dispatch", reason: null } })).ok, false);
  assert.equal(read(mutate({ routePolicy: { value: "netscript-matrix", digest: "PRIVATE-CANARY", source: "dispatch", reason: null } })).ok, false);
  assert.equal(read(mutate({ model: { value: "home/agent/private", source: "native", reason: null } })).ok, false);
  assert.equal(read(mutate({ location: { ...node.location, host: { value: "home/agent/private", basis: "placement", observedAt: at, reason: null } } })).ok, false);
});
it("rejects child claims that cannot be attributed to child evidence", () => {
  const child = { ...node, observation: { ...observation, agentId: "agent_" + "d".repeat(64),
    parentAgentId: { state: "known-parent", value: observation.agentId, reason: null } },
    harness: { value: "codex", source: "native", reason: null } };
  const withChild = (patch: Record<string, unknown>) => {
    const s = snapshot();
    return { ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId, agents: [node, { ...child, ...patch }] }] }] };
  };
  assert.equal(read(withChild({})).ok, true);
  assert.equal(read(withChild({ budget: { tokenLimit: 1000, source: "route-default", reason: null } })).ok, false);
  assert.equal(read(withChild({ provider: { value: "openai", source: "dispatch", reason: null } })).ok, false);
  assert.equal(read(withChild({ model: { value: "model", source: "dispatch", reason: null } })).ok, false);
  assert.equal(read(withChild({ harness: { value: "codex", source: "dispatch", reason: null } })).ok, false);
  assert.equal(read(withChild({ router: { value: "direct", source: "dispatch", reason: null } })).ok, false);
  const routed = { ...node, router: { value: "direct", source: "dispatch", reason: null } };
  const s = snapshot();
  const inherited = { ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId,
    agents: [routed, { ...child, router: { value: "direct", source: "dispatch", reason: null } }] }] }] };
  assert.equal(read(inherited).ok, true);
  assert.equal(read(withChild({ routePolicy: { value: "netscript-matrix", digest: rev, source: "dispatch", reason: null } })).ok, false);
  assert.equal(read(withChild({ nativeDepth: { value: 1, source: "native", reason: null } })).ok, true);
  assert.equal(read(withChild({ nativeDepth: { value: 0, source: "native", reason: null } })).ok, false);
  assert.equal(read(withChild({ nativeDepth: { value: 1.5, source: "native", reason: null } })).ok, false);
  assert.equal(read(withChild({ nativeDepth: { value: 1, source: "dispatch", reason: null } })).ok, false);
  assert.equal(read(withChild({ nativeDepth: { value: null, source: "native", reason: null } })).ok, false);
  assert.equal(read(withChild({ nativeDepth: { value: 1, source: "native", reason: null },
    harness: { value: "codex", source: "dispatch", reason: null } })).ok, false);
});
it("accepts legacy frames without native depth but rejects measured depth on a root", () => {
  const s = snapshot();
  const withRoot = (nativeDepth: unknown) => ({ ...s, issues: [{ ...s.issues[0], dispatches: [{
    dispatchId, agents: [{ ...node, nativeDepth }],
  }] }] });
  assert.equal(read(withRoot({ value: 1, source: "native", reason: null })).ok, false);
  const { nativeDepth: _legacy, ...legacyNode } = node;
  const legacy = { ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId, agents: [legacyNode] }] }] };
  const result = read(legacy);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.snapshot.issues[0]?.dispatches[0]?.agents[0]?.nativeDepth,
    { value: null, source: "unavailable", reason: "source_not_bound" });
});
it("reads a 0.5.0 frame without routePolicy as typed unavailable", () => {
  const { routePolicy: _legacy, ...legacyNode } = node;
  const s = snapshot();
  const old = { ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId, agents: [legacyNode] }] }] };
  const result = read(old);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.snapshot.issues[0]?.dispatches[0]?.agents[0]?.routePolicy,
    { value: null, digest: null, source: "unavailable", reason: "source_not_bound" });
});
it("retains a complete issue beside a typed incomplete issue", () => {
  const s = snapshot();
  const partial = { ...s, complete: false, reason: "ancestry_unavailable" as const,
    issues: [...s.issues, { repo: { owner: "example", name: "project" }, issueNumber: 43,
      complete: false, reason: "ancestry_unavailable" as const, dispatches: [] }] };
  const result = read(partial);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.snapshot.issues.length, 2);
    assert.equal(result.snapshot.issues[0]?.complete, true);
    assert.equal(result.snapshot.issues[0]?.dispatches[0]?.agents.length, 1);
    assert.deepEqual(result.snapshot.issues[1], partial.issues[1]);
  }
  assert.equal(read({ ...partial, complete: true, reason: null }).ok, false);
  assert.equal(read({ ...partial, issues: [s.issues[0], { ...partial.issues[1], dispatches: s.issues[0]?.dispatches }] }).ok, false);
});
it("normalizes 0.5.1 issue rows without per-issue status as complete", () => {
  const s = snapshot();
  const { complete: _complete, reason: _reason, ...legacyIssue } = s.issues[0]!;
  const result = read({ ...s, issues: [legacyIssue] });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual([result.snapshot.issues[0]?.complete, result.snapshot.issues[0]?.reason], [true, null]);
});
it("accepts a 0.5.1 dispatch-only ancestry row and normalizes its incomplete issue", () => {
  const dispatchOnly = { ...observation,
    parentAgentId: { state: "unavailable", value: null, reason: "identity_unavailable" },
    running: { ...absent(), reason: "observer-unavailable" },
    route: projectRouteIdentity({ requested: observation.route.requested,
      observed: projectRouteIdentity(null).observed }) };
  const old = { ...snapshot(), complete: false, reason: "ancestry_unavailable",
    issues: [{ repo: observation.repo, issueNumber: 42, dispatches: [{ dispatchId,
      agents: [{ ...node, observation: dispatchOnly }] }] }] };
  const result = read(old);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.snapshot.issues[0], { repo: observation.repo, issueNumber: 42,
    complete: false, reason: "ancestry_unavailable", dispatches: [] });
  assert.equal(read({ ...old, issues: [{ ...old.issues[0], dispatches: [{ dispatchId,
    agents: [{ ...node, observation: { ...dispatchOnly, parentAgentId: observation.parentAgentId } }] }] }] }).ok, false);
});
it("bounds and orders history, and never treats a last-activity event as endedAt", () => {
  const s = snapshot();
  const mutate = (patch: Record<string, unknown>) => ({ ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId, agents: [{ ...node, ...patch }] }] }] });
  const tooLong = Array.from({ length: 17 }, (_, i) => ({ dispatchId, kind: "run-activity-observed",
    at: new Date(Date.parse(at) - (17 - i) * 1000).toISOString() }));
  assert.equal(read(mutate({ history: tooLong })).ok, false);
  assert.equal(read(mutate({ history: [{ dispatchId, kind: "run-activity-observed", at }, { dispatchId, kind: "dispatch-observed", at }] })).ok, false);
  assert.equal(read(mutate({ endedAt: at })).ok, false);
  assert.equal(read(mutate({ history: [{ dispatchId, kind: "raw-log-detail", at, detail: "PRIVATE-CANARY" }] })).ok, false);
});
it("rejects a getter before reading its value", () => {
  const s = snapshot(); let called = false;
  Object.defineProperty(s, "issues", { enumerable: true, get() { called = true; throw Error("PRIVATE-CANARY"); } });
  assert.equal(read(s).ok, false);
  assert.equal(called, false);
});
it("accepts the 30-second validity and the legacy 15-second one, and nothing in between or beyond", () => {
  const s = snapshot();
  assert.equal(ISSUE_AGENT_TREE_FRESH_MS, 30_000);
  assert.equal(read({ ...s, validUntil: "2026-01-01T00:00:30.000Z" }).ok, true);
  assert.equal(read({ ...s, validUntil: "2026-01-01T00:00:15.000Z" }).ok, true);
  for (const validUntil of ["2026-01-01T00:00:20.000Z", "2026-01-01T00:00:29.999Z",
    "2026-01-01T00:00:30.001Z", "2026-01-01T00:00:45.000Z", "2026-01-01T00:00:00.000Z"]) {
    assert.equal(read({ ...s, validUntil }).ok, false, validUntil);
  }
});
it("pins dispatch identity and freshness, and separates placement from runtime and terminal evidence", () => {
  const s = snapshot();
  const mutate = (patch: Record<string, unknown>) => ({ ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId, agents: [{ ...node, ...patch }] }] }] });
  assert.equal(read({ ...s, validUntil: "2026-01-01T00:00:16.000Z" }).ok, false);
  assert.equal(read(mutate({ dispatchId: "assignment_" + "d".repeat(64) })).ok, false);
  assert.equal(read(mutate({ history: [{ ...node.history[0], dispatchId: "assignment_" + "d".repeat(64) }] })).ok, false);
  assert.equal(read(mutate({ location: { ...node.location, host: { value: "/PRIVATE-PATH-CANARY", basis: "placement", observedAt: at, reason: null } } })).ok, false);
  assert.equal(read(mutate({ terminalOutcome: { value: "succeeded", source: "native-outcome", observedAt: at, reason: null } })).ok, false);
  assert.equal(read(mutate({ quotaRegime: { value: null, reason: null } })).ok, false);
});
