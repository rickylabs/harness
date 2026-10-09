import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { Session, SessionId, SessionStore } from "@deepseek-ai/dsh-session";
import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import * as todoPlugin from "@deepseek-ai/dsh-tool-todo";
import { readGovernanceSnapshot } from "@rickylabs/harness-contracts";
import boardPlugin, { CONTEXT_KEY, createService } from "./plugins/board.js";
import { boardProjectionSchema } from "./plugins/board-projection.js";
import { runBoardProjectionSmoke, smokeInput } from "./board-smoke-fixture.js";

function registryContext(withTodos: boolean): Context {
  const ctx = new Context();
  new SessionStore(ctx);
  new SessionProjectionRegistry(ctx);
  if (withTodos) {
    const toolsKey: string = "tools";
    ctx.provide(toolsKey, { register: () => (): void => undefined });
    todoPlugin.apply(ctx, { allowParallelInProgress: true });
  }
  return ctx;
}

describe("board session projection composition", () => {
  it("passes the no-agent published-service smoke, including child runs and refresh authority", async () => {
    await runBoardProjectionSmoke();
  });

  it("fails a missing projection registry before changing the session", () => {
    const session = Session.create(SessionId("no-registry"));
    const service = createService(undefined);
    assert.throws(() => service.refresh(session, smokeInput()), /sessionProjections/);
    assert.equal(session.seq, 0);
  });

  it("fails a missing todos projection before either replacement event", async () => {
    const ctx = registryContext(false);
    const fiber = await ctx.plugin(boardPlugin);
    const service = ctx.get(CONTEXT_KEY);
    if (service === undefined) throw new Error("board service missing");
    const session = ctx.sessions.create();
    assert.throws(() => service.refresh(session, smokeInput()), /todos projection/);
    assert.equal(session.seq, 0);
    await fiber.dispose();
  });

  it("surfaces normalization notes and preserves the pre-refresh sequence", async () => {
    const ctx = registryContext(true);
    const fiber = await ctx.plugin(boardPlugin);
    const service = ctx.get(CONTEXT_KEY);
    if (service === undefined) throw new Error("board service missing");
    const session = ctx.sessions.create();
    const input = smokeInput();
    assert.throws(
      () => service.refresh(session, { ...input, issues: [{ ...input.issues[0]!, number: 0 }] }),
      /normalization failed: board projection:/,
    );
    assert.equal(session.seq, 0);
    await fiber.dispose();
  });

  it("carries board anomalies, item marks, and fetch coverage through the composition", async () => {
    const ctx = registryContext(true);
    const fiber = await ctx.plugin(boardPlugin);
    const service = ctx.get(CONTEXT_KEY);
    if (service === undefined) throw new Error("board service missing");
    const session = ctx.sessions.create();
    const input = smokeInput();
    const disputed = {
      ...input.issues[1]!,
      number: 304,
      title: "Two columns at once",
      labels: ["epic:board", "status:impl", "status:ci-fail"],
    };
    const board = service.refresh(session, {
      ...input,
      issues: [...input.issues, disputed],
    }).values.harnessBoard;

    // The fixture's #303 carries an epic and no status label; #304 above carries two.
    assert.deepEqual(
      board?.anomalies.filter((a) => a.item === 304).map((a) => a.kind),
      ["multiple-status"],
    );
    assert.equal(board?.anomalies.some((a) => a.item === 303 && a.kind === "no-status"), true);
    assert.deepEqual(board?.completeness, { limit: 100, capped: [] });

    // The phase and the fact that it is disputed have to arrive on the same object, or a pane
    // renders the column with the confidence of a settled fact.
    const tasks = board?.milestones.flatMap((m) => m.epics.flatMap((e) => e.tasks)) ?? [];
    const node = tasks.find((t) => t.item.number === 304);
    assert.notEqual(node?.item.phase, null);
    assert.deepEqual(node?.item.anomalies, ["multiple-status"]);
    assert.equal(tasks.find((t) => t.item.number === 301)?.item.anomalies, undefined);
    await fiber.dispose();
  });

  it("preserves a fresh refused admission through the composed harnessBoard service", async () => {
    const ctx = registryContext(true);
    const fiber = await ctx.plugin(boardPlugin);
    const service = ctx.get(CONTEXT_KEY);
    if (service === undefined) throw new Error("board service missing");
    const session = ctx.sessions.create();
    const observedAt = "2026-09-06T23:55:00.000Z";
    const read = (provenance: string) => ({ status: "read", observedAt, validUntil: "2026-09-07T00:05:00.000Z", freshness: "fresh", provenance });
    const decoded = readGovernanceSnapshot({
      schema: 1, protocol: 1, producer: "harness-telemetry", evaluatedAt: "2026-09-07T00:00:00.000Z",
      sources: { usage: read("synthetic:usage"), spend: read("synthetic:spend"), capacity: read("synthetic:capacity"),
        admissions: { status: "read", records: 1, empty: false, dropped: [], provenance: "synthetic:admissions", collectedAt: observedAt },
        approvals: { status: "not-observed" } },
      notes: [], availability: "fresh", observedAt, validUntil: "2026-09-07T00:01:00.000Z", provenance: "synthetic:test",
      complete: true, unavailableReason: null,
      state: {
        generatedAt: observedAt,
        regimes: [
          { regime: "subscription", state: "throttle", note: "synthetic binding window", accounts: [{ seam: "codex", account: "primary",
            state: "throttle", observedAt,
            windows: [{ label: "5h", windowMinutes: 300, usedPercent: 91, resetsAt: "2026-09-07T01:00:00.000Z", binding: true }] }] },
          { regime: "metered", state: "allow", note: null,
            providers: [{ provider: "openrouter", spentUsd: 12.5, ceilingUsd: 50, windowLabel: "monthly", observedAt }] },
          { regime: "capacity", state: "allow", note: null, hosts: [{ host: "n5-fixture", vramUsedBytes: 8 * 1024 ** 3,
            vramTotalBytes: 24 * 1024 ** 3, ramUsedBytes: 32 * 1024 ** 3, ramTotalBytes: 128 * 1024 ** 3, observedAt }] },
        ],
        pending: [],
        notes: ["synthetic governance note"],
      },
      admissions: [{ item: 204, regime: "subscription", state: "throttle", observedAt: "2026-09-06T23:54:00.000Z",
        validUntil: "2026-09-07T00:01:00.000Z", freshness: "fresh", provenance: "synthetic:dispatcher", reason: "quota-paced", accepted: false }],
    });
    if (!decoded.ok) throw new Error("synthetic governance document must decode");
    const observations = decoded.snapshot;
    assert.equal(observations.availability, "fresh");

    const result = service.refresh(session, { ...smokeInput(), observations });
    const governance = result.values.harnessBoard?.governance;
    assert.equal(governance?.availability, "fresh");
    assert.equal(governance?.state?.regimes.length, 3);
    assert.equal(governance?.admissions[0]?.item.number, 204);
    assert.equal(governance?.admissions[0]?.outcome.accepted, false);
    assert.equal(governance?.admissions[0]?.outcome.reason, "quota-paced");
    // The read document carries no operator detail; the published outcome withholds it explicitly.
    assert.match(governance?.admissions[0]?.outcome.detail ?? "", /private operator detail withheld/);
    await fiber.dispose();
  });
});

describe("board projection wire schema", () => {
  const valid = {
    generatedAt: "2026-09-07T00:00:00.000Z",
    now: "2026-09-07T00:00:00.000Z",
    complete: true,
    completeness: { limit: 100, capped: [] },
    anomalies: [],
    milestones: [{
      milestone: "E6",
      epics: [],
      liveness: { state: "quiet", evidence: "none", at: null, ageMs: null },
    }],
    unattributed: [],
    quota: [],
    governance: {
      availability: "unavailable",
      observedAt: null,
      validUntil: null,
      provenance: null,
      state: null,
      admissions: [],
      unavailableReason: "not-configured",
    },
    notes: [],
  } as const;

  it("accepts its declared output", () => {
    assert.equal(boardProjectionSchema.safeParse(valid).success, true);
  });

  it("rejects unknown root and nested fields", () => {
    assert.equal(boardProjectionSchema.safeParse({ ...valid, origin: "must not leak" }).success, false);
    assert.equal(
      boardProjectionSchema.safeParse({
        ...valid,
        milestones: [{ ...valid.milestones[0], liveness: { ...valid.milestones[0].liveness, surprise: true } }],
      }).success,
      false,
    );
    assert.equal(
      boardProjectionSchema.safeParse({
        ...valid,
        governance: { ...valid.governance, surprise: true },
      }).success,
      false,
    );
  });

  it("requires the anomaly channel rather than defaulting it to clean", () => {
    const { anomalies: _anomalies, ...withoutAnomalies } = valid;
    assert.equal(boardProjectionSchema.safeParse(withoutAnomalies).success, false);
    const { completeness: _completeness, ...withoutCompleteness } = valid;
    assert.equal(boardProjectionSchema.safeParse(withoutCompleteness).success, false);
  });

  it("accepts a null completeness but not an invented anomaly kind", () => {
    assert.equal(
      boardProjectionSchema.safeParse({ ...valid, completeness: null }).success,
      true,
    );
    assert.equal(
      boardProjectionSchema.safeParse({
        ...valid,
        anomalies: [{ kind: "multiple-status", item: 204, detail: "two status labels" }],
      }).success,
      true,
    );
    assert.equal(
      boardProjectionSchema.safeParse({
        ...valid,
        anomalies: [{ kind: "not-a-real-kind", item: 204, detail: "invented" }],
      }).success,
      false,
    );
  });
});
