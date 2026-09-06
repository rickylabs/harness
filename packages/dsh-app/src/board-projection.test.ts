import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { Session, SessionId, SessionStore } from "@deepseek-ai/dsh-session";
import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import * as todoPlugin from "@deepseek-ai/dsh-tool-todo";
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
  });
});
