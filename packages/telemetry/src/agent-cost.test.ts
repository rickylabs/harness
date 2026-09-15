/** Synthetic measurements only; no live amounts or native identifiers. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { projectRouteIdentity, readAgentObservations } from "@rickylabs/harness-contracts";
import { projectAgentCost } from "./agent-cost.js";
import { buildAgentObservations } from "./agent-observations.js";
import type { RunRecord, QuotaReading } from "./model.js";
import type { DispatchEvidence } from "./dispatch-evidence.js";
const at = "2026-01-01T12:00:00.000Z", now = "2026-01-01T12:01:00.000Z", reset = "2026-01-01T13:00:00.000Z";
const quota = (patch: Partial<QuotaReading> = {}): QuotaReading => ({ source: "codex", observedAt: at,
  usedPercent: 25, windowMinutes: 60, resetsAt: reset, limitId: "fixture-window", planType: null, creditBalance: null, ...patch });
const run = (patch: Partial<RunRecord> = {}): RunRecord => ({ id: "PRIVATE-ROOT", source: "codex", parentId: null,
  startedAt: at, updatedAt: at, branch: null, identity: { provider: "fixture-provider", model: "fixture-model", effort: null, profile: null },
  usage: { inputTokens: 12, outputTokens: 3, reasoningTokens: 2, cacheReadTokens: 4, costUsd: 0.125 },
  outcome: "complete", linkedIssues: [], origin: "PRIVATE-ORIGIN-CANARY", quota: [quota()], ...patch });
const dispatch: DispatchEvidence = { runId: "PRIVATE-DISPATCH", external: "PRIVATE-ROOT", source: "codex", linkageBasis: "dispatcher-confirmed",
  issue: { repo: "example/project", number: 42 }, parentRunId: null, location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" },
  dispatchState: "dispatched", observedAt: at, revision: "a".repeat(64), route: projectRouteIdentity(null) };
const observe = (runs: RunRecord[], dispatches: DispatchEvidence[] = [dispatch], nativeComplete = true) => buildAgentObservations({
  runs, dispatches, observedAt: now, sourceBound: true, dispatchComplete: true, nativeComplete });
const checkAvailable = () => {
  const cost = projectAgentCost(run(), now);
  assert.ok(Object.values(cost).every(row => row.availability === "available"));
  return cost;
};
const unavailable = (row: { availability: string; measurement: unknown; reason: string | null }, reason: string) => {
  assert.equal(row.availability, "unavailable"); assert.equal(row.measurement, null); assert.equal(row.reason, reason);
};
it("cost: roots and children receive only their own usage, with three distinct rows", () => {
  const root = run(), child = run({ id: "PRIVATE-CHILD", parentId: root.id, usage: { inputTokens: 1, costUsd: 0 } });
  const result = observe([root, child]);
  assert.ok(readAgentObservations(result).ok); assert.equal(result.complete, true); assert.equal(result.agents.length, 2);
  const r = result.agents.find(a => a.parentAgentId.state === "confirmed-root")!;
  const c = result.agents.find(a => a.parentAgentId.state === "known-parent")!;
  assert.deepEqual(r.cost, projectAgentCost(root, now)); assert.deepEqual(c.cost, projectAgentCost(child, now));
  assert.deepEqual(c.cost.runTokens.measurement, { inputTokens: 1 });
  assert.equal(c.cost.meteredSpend.measurement?.amount, 0);
  assert.deepEqual(Object.keys(r.cost), ["subscriptionHeadroom", "meteredSpend", "runTokens"]);
  assert.equal(r.cost.subscriptionHeadroom.scope, "subscription_account");
  assert.equal(r.cost.meteredSpend.scope, "run"); assert.equal(r.cost.runTokens.scope, "run");
  assert.equal(JSON.stringify(result).includes("PRIVATE-"), false);
});
it("cost: absent is unavailable while reported zero remains available", () => {
  const empty = projectAgentCost(run({ usage: {}, quota: [] }), now);
  for (const row of Object.values(empty)) unavailable(row, "measurement_missing");
  const zero = projectAgentCost(run({ usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, quota: [quota({ usedPercent: 100 })] }), now);
  assert.deepEqual(zero.runTokens.measurement, { inputTokens: 0, outputTokens: 0 });
  assert.equal(zero.meteredSpend.measurement?.amount, 0); assert.equal(zero.subscriptionHeadroom.measurement?.remainingPercent, 0);
  assert.ok(Object.values(zero).every(row => row.availability === "available"));
  unavailable(projectAgentCost(run({ usage: { costUsd: 0 } }), now).runTokens, "measurement_missing");
  unavailable(projectAgentCost(run({ usage: { inputTokens: 0 } }), now).meteredSpend, "measurement_missing");
});
for (const [label, value] of Object.entries({ negative: -1, nan: NaN, infinite: Infinity, fractional: 0.5, unsafe: Number.MAX_SAFE_INTEGER + 1 })) {
  it(`cost: invalid token ${label} refuses only tokens`, () => {
    const good = checkAvailable(), bad = projectAgentCost(run({ usage: { ...run().usage, reasoningTokens: value } }), now);
    unavailable(bad.runTokens, "binding_invalid"); assert.deepEqual(bad.meteredSpend, good.meteredSpend); assert.deepEqual(bad.subscriptionHeadroom, good.subscriptionHeadroom);
  });
}
for (const [label, value] of Object.entries({ negative: -0.01, nan: NaN, infinite: Infinity })) {
  it(`cost: invalid spend ${label} refuses only currency`, () => {
    const good = checkAvailable(), bad = projectAgentCost(run({ usage: { ...run().usage, costUsd: value } }), now);
    unavailable(bad.meteredSpend, "binding_invalid"); assert.deepEqual(bad.runTokens, good.runTokens); assert.deepEqual(bad.subscriptionHeadroom, good.subscriptionHeadroom);
  });
}
for (const [label, updatedAt] of Object.entries({ malformed: "bad-time", badMonth: "2026-99-01T12:00:00.000Z", impossible: "2025-02-30T12:00:00.000Z", future: reset })) {
  it(`cost: ${label} usage timestamp does not become current`, () => {
    checkAvailable(); const bad = projectAgentCost(run({ updatedAt }), now);
    unavailable(bad.runTokens, "binding_invalid"); unavailable(bad.meteredSpend, "binding_invalid");
    assert.equal(bad.subscriptionHeadroom.availability, "available");
  });
}
it("cost: invalid capture clock refuses every row", () => {
  checkAvailable(); for (const row of Object.values(projectAgentCost(run(), "bad-clock"))) unavailable(row, "binding_invalid");
});
for (const field of ["usedPercent", "windowMinutes", "resetsAt"] as const) {
  it(`cost: missing quota ${field} cannot fall back to older data`, () => {
    checkAvailable(); const old = quota({ observedAt: "2026-01-01T11:59:00.000Z" });
    unavailable(projectAgentCost(run({ quota: [old, quota({ [field]: null })] }), now).subscriptionHeadroom, "measurement_missing");
  });
}
const badQuota: Record<string, Partial<QuotaReading>> = {
  "source mismatch": { source: "claude" }, "future observation": { observedAt: "2026-01-01T12:02:00.000Z" }, "invalid observation": { observedAt: "bad-time" },
  "negative percent": { usedPercent: -1 }, "overfull percent": { usedPercent: 101 }, "nan percent": { usedPercent: NaN },
  "zero minutes": { windowMinutes: 0 }, "fractional minutes": { windowMinutes: 0.5 }, "unsafe minutes": { windowMinutes: Number.MAX_SAFE_INTEGER + 1 },
  "invalid reset": { resetsAt: "bad-time" }, "reset before observation": { resetsAt: "2026-01-01T11:59:00.000Z" }, "reset at observation": { resetsAt: at },
};
for (const [label, patch] of Object.entries(badQuota)) {
  it(`cost: quota ${label} is refused`, () => {
    const good = checkAvailable(), bad = projectAgentCost(run({ quota: [quota(patch)] }), now);
    unavailable(bad.subscriptionHeadroom, "binding_invalid"); assert.deepEqual(bad.runTokens, good.runTokens); assert.deepEqual(bad.meteredSpend, good.meteredSpend);
  });
}
it("cost: only latest observation batch, with all published windows constrained", () => {
  const old = quota({ observedAt: "2026-01-01T11:00:00.000Z", usedPercent: 99, windowMinutes: 10080 });
  const q = quota({ usedPercent: 10 }), stricter = quota({ limitId: "second", usedPercent: 90, windowMinutes: 300 });
  assert.equal(projectAgentCost(run({ quota: [q, old] }), now).subscriptionHeadroom.measurement?.remainingPercent, 90);
  const cost = projectAgentCost(run({ quota: [old, q, stricter] }), now);
  assert.equal(cost.subscriptionHeadroom.measurement?.remainingPercent, 10);
  assert.equal(cost.subscriptionHeadroom.measurement?.windowMinutes, 300);
  assert.deepEqual(cost, projectAgentCost(run({ quota: [stricter, q, old] }), now));
});
it("cost: contradictory same-window observations refuse; identical duplicates pass", () => {
  const q = quota(); checkAvailable();
  for (const patch of [{ usedPercent: 80 }, { resetsAt: "2026-01-01T14:00:00.000Z" }]) {
    unavailable(projectAgentCost(run({ quota: [q, quota(patch)] }), now).subscriptionHeadroom, "binding_invalid");
  }
  assert.deepEqual(projectAgentCost(run({ quota: [q, q] }), now), projectAgentCost(run({ quota: [q] }), now));
});
it("cost: reset expiry of any window invalidates the batch without claiming replenishment", () => {
  checkAvailable();
  for (const expiry of ["2026-01-01T12:00:30.000Z", now]) {
    const early = quota({ usedPercent: 1, resetsAt: expiry }), later = quota({ limitId: "later", usedPercent: 90 });
    const bad = projectAgentCost(run({ quota: [early, later] }), now);
    unavailable(bad.subscriptionHeadroom, "source_stale"); assert.equal(bad.runTokens.availability, "available");
  }
  const soon = "2026-01-01T12:02:00.000Z";
  const good = projectAgentCost(run({ quota: [quota({ usedPercent: 1, resetsAt: soon }), quota({ limitId: "later", usedPercent: 90 })] }), now);
  assert.equal(good.subscriptionHeadroom.availability, "available"); assert.equal(good.subscriptionHeadroom.validUntil, soon);
  assert.equal(good.subscriptionHeadroom.measurement?.resetsAt, reset);
  const changedExpiry = projectAgentCost(run({ quota: [quota({ usedPercent: 1, resetsAt: "2026-01-01T12:03:00.000Z" }), quota({ limitId: "later", usedPercent: 90 })] }), now);
  assert.notEqual(changedExpiry.subscriptionHeadroom.revision, good.subscriptionHeadroom.revision);
});
it("cost: revision changes on measurements with unchanged timestamps, but not source key order", () => {
  const root = run(), child = run({ id: "PRIVATE-CHILD", parentId: root.id });
  const before = observe([root, child]);
  for (const change of [{ usage: { inputTokens: 99, costUsd: 0 } }, { quota: [quota({ usedPercent: 90 })] }]) {
    const after = observe([{ ...root, ...change }, { ...child, ...change }]);
    assert.notEqual(after.revision, before.revision);
    for (const agent of after.agents) assert.notEqual(agent.revision, before.agents.find(a => a.agentId === agent.agentId)!.revision);
  }
  const reversed = { ...root, usage: Object.fromEntries(Object.entries(root.usage).reverse()) };
  assert.deepEqual(projectAgentCost(root, now), projectAgentCost(reversed, now));
  assert.deepEqual(observe([root]), observe([reversed]));
});
it("cost: native ambiguity and incomplete ancestry still refuse rather than distribute costs", () => {
  const r = run(); assert.equal(observe([r]).complete, true);
  for (const result of [observe([r, r]), observe([r], [dispatch, { ...dispatch, runId: "PRIVATE-SECOND" }]), observe([r], [dispatch], false),
    observe([r], [{ ...dispatch, external: "PRIVATE-NO-MATCH" }]), observe([{ ...r, source: "claude" }])]) {
    assert.equal(result.complete, false); assert.equal(result.reason, "ancestry_unavailable"); assert.equal(readAgentObservations(result).ok, false);
  }
  const unbound = observe([r], [{ ...dispatch, external: null }]);
  assert.ok(readAgentObservations(unbound).ok); assert.equal(unbound.complete, false);
  for (const row of Object.values(unbound.agents[0]!.cost)) unavailable(row, "source_not_bound");
});
it("cost: separate dispatches are separate agents, never summed by issue", () => {
  const second = run({ id: "PRIVATE-SECOND", usage: { inputTokens: 5 } });
  const result = observe([run(), second], [dispatch, { ...dispatch, runId: "PRIVATE-SECOND-DISPATCH", external: second.id }]);
  assert.ok(readAgentObservations(result).ok); assert.equal(result.agents.length, 2);
  assert.deepEqual(result.agents.map(a => a.cost.runTokens.measurement?.inputTokens).sort((a, b) => a! - b!), [5, 12]);
});
it("cost: child clock corruption still refuses the whole tree", () => {
  const child = run({ id: "PRIVATE-CHILD", parentId: "PRIVATE-ROOT" });
  assert.ok(readAgentObservations(observe([run(), child])).ok);
  assert.equal(readAgentObservations(observe([run(), { ...child, updatedAt: reset }])).ok, false);
});
it("cost: no private source properties or overlapping total are exported", () => {
  const r = run({ quota: [quota({ creditBalance: "PRIVATE-CREDIT", planType: "PRIVATE-PLAN", limitId: "PRIVATE-LIMIT" })] });
  const result = projectAgentCost(r, now); assert.equal(JSON.stringify(result).includes("PRIVATE-"), false);
  assert.deepEqual(Object.keys(result.runTokens.measurement!), ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens"]);
  assert.deepEqual(result.meteredSpend.measurement, { amount: 0.125, currency: "USD", accounting: "reported" });
  assert.equal(result.runTokens.validUntil, null); assert.equal(result.meteredSpend.validUntil, null);
});
