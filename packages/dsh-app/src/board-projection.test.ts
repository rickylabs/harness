import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { Session, SessionId, SessionStore } from "@deepseek-ai/dsh-session";
import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import * as todoPlugin from "@deepseek-ai/dsh-tool-todo";
import { parseGovernanceObservation } from "@rickylabs/telemetry";
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

  it("preserves a fresh refused admission through the composed harnessBoard service", async () => {
    const ctx = registryContext(true);
    const fiber = await ctx.plugin(boardPlugin);
    const service = ctx.get(CONTEXT_KEY);
    if (service === undefined) throw new Error("board service missing");
    const session = ctx.sessions.create();
    const observations = parseGovernanceObservation({
      observedAt: "2026-09-06T23:55:00.000Z",
      validUntil: "2026-09-07T00:05:00.000Z",
      provenance: "synthetic:test",
      state: {
        generatedAt: "2026-09-06T23:55:00.000Z",
        regimes: [
          {
            regime: "subscription",
            state: "throttle",
            accounts: [{
              seam: "codex",
              account: "primary",
              state: "throttle",
              windows: [{
                label: "5h",
                windowMinutes: 300,
                usedPercent: 91,
                resetsAt: "2026-09-07T01:00:00.000Z",
                binding: true,
              }],
              observedAt: "2026-09-06T23:55:00.000Z",
            }],
            note: "synthetic binding window",
          },
          {
            regime: "metered",
            state: "allow",
            providers: [{
              provider: "openrouter",
              spentUsd: 12.5,
              ceilingUsd: 50,
              windowLabel: "monthly",
              observedAt: "2026-09-06T23:55:00.000Z",
            }],
            note: null,
          },
          {
            regime: "capacity",
            state: "allow",
            hosts: [{
              host: "n5-fixture",
              vramUsedBytes: 8 * 1024 ** 3,
              vramTotalBytes: 24 * 1024 ** 3,
              ramUsedBytes: 32 * 1024 ** 3,
              ramTotalBytes: 128 * 1024 ** 3,
              observedAt: "2026-09-06T23:55:00.000Z",
            }],
            note: null,
          },
        ],
        pending: [],
        notes: ["synthetic governance note"],
      },
      admissions: [{
        item: { number: 204 },
        regime: "subscription",
        state: "throttle",
        observedAt: "2026-09-06T23:54:00.000Z",
        validUntil: "2026-09-07T00:01:00.000Z",
        provenance: "synthetic:dispatcher",
        outcome: {
          accepted: false,
          reason: "quota-paced",
          detail: "waiting for the next synthetic subscription slot",
        },
      }],
    }, "2026-09-07T00:00:00.000Z");
    assert.equal(observations.availability, "fresh");

    const result = service.refresh(session, { ...smokeInput(), observations });
    const governance = result.values.harnessBoard?.governance;
    assert.equal(governance?.availability, "fresh");
    assert.equal(governance?.state?.regimes.length, 3);
    assert.equal(governance?.admissions[0]?.item.number, 204);
    assert.equal(governance?.admissions[0]?.outcome.accepted, false);
    assert.equal(governance?.admissions[0]?.outcome.reason, "quota-paced");
    assert.equal(governance?.admissions[0]?.outcome.detail, "waiting for the next synthetic subscription slot");
    await fiber.dispose();
  });
});

describe("board projection wire schema", () => {
  const valid = {
    generatedAt: "2026-09-07T00:00:00.000Z",
    now: "2026-09-07T00:00:00.000Z",
    complete: true,
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
      unavailableReason: "no --observations supplied",
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
});
