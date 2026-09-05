/**
 * The half of #46's third acceptance criterion that `--dump-config` cannot show.
 *
 * `dsh --profile rickylabs --dump-config` composes the layers and prints them; it does not boot,
 * so it proves the rows *will* load and nothing about whether they claim anything. This file boots
 * a real cordis `Context`, loads each plugin through `ctx.plugin`, and asserts the service is
 * readable at its key — and gone again after the fiber unloads, which is the property that makes a
 * patch reload safe. Two plugins that both survived disposal would collide on the next load with
 * `service "x" has been registered`, at boot, with no way to rename either side.
 *
 * Loading all four onto one context is the collision test, and it is worth having as a test rather
 * than as a reading of four `CONTEXT_KEY` constants: the constants are what we chose, the context
 * is what cordis actually does with them once dsh's own services are also present.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Context } from "@deepseek-ai/cordis";

import board, { CONTEXT_KEY as BOARD_KEY, createService as createBoard } from "./plugins/board.js";
import coordinator, {
  CONTEXT_KEY as COORDINATOR_KEY,
  DEFAULT_POLICY,
  createService as createCoordinator,
  resolvePolicy,
} from "./plugins/coordinator.js";
import subagents, { CONTEXT_KEY as SUBAGENTS_KEY } from "./plugins/subagents.js";
import telemetry, {
  CONTEXT_KEY as TELEMETRY_KEY,
  createService as createTelemetry,
  resolveHome,
} from "./plugins/telemetry.js";

describe("each plugin claims its service and gives it back", () => {
  it("harness-subagents", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(subagents);
    const registry = ctx.get(SUBAGENTS_KEY);
    if (registry === undefined) throw new Error("ctx.subagents was not claimed");
    assert.deepEqual(registry.providers, []);
    await fiber.dispose();
    assert.equal(ctx.get(SUBAGENTS_KEY), undefined);
  });

  it("harness-board", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(board);
    const service = ctx.get(BOARD_KEY);
    if (service === undefined) throw new Error("ctx.harnessBoard was not claimed");
    assert.equal(service.lanePrefix, "lane");
    assert.equal(service.lifecycle.prefix, "status");
    await fiber.dispose();
    assert.equal(ctx.get(BOARD_KEY), undefined);
  });

  it("harness-coordinator", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(coordinator);
    const service = ctx.get(COORDINATOR_KEY);
    if (service === undefined) throw new Error("ctx.harnessCoordinator was not claimed");
    assert.equal(service.policy.name, DEFAULT_POLICY.name);
    await fiber.dispose();
    assert.equal(ctx.get(COORDINATOR_KEY), undefined);
  });

  it("harness-telemetry", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(telemetry);
    const service = ctx.get(TELEMETRY_KEY);
    if (service === undefined) throw new Error("ctx.harnessTelemetry was not claimed");
    assert.notEqual(service.observability, undefined);
    await fiber.dispose();
    assert.equal(ctx.get(TELEMETRY_KEY), undefined);
  });
});

describe("the bundle as a whole", () => {
  it("loads all four onto one context without a name collision", async () => {
    const ctx = new Context();
    const fibers = [
      await ctx.plugin(subagents),
      await ctx.plugin(board),
      await ctx.plugin(coordinator),
      await ctx.plugin(telemetry),
    ];
    for (const key of [SUBAGENTS_KEY, BOARD_KEY, COORDINATOR_KEY, TELEMETRY_KEY] as const) {
      assert.notEqual(ctx.get(key), undefined, `${key} is not on the context`);
    }
    for (const fiber of fibers) await fiber.dispose();
    for (const key of [SUBAGENTS_KEY, BOARD_KEY, COORDINATOR_KEY, TELEMETRY_KEY] as const) {
      assert.equal(ctx.get(key), undefined, `${key} outlived its fiber`);
    }
  });

  it("names each plugin, so a fiber diagnostic says which one", () => {
    assert.deepEqual(
      [subagents.name, board.name, coordinator.name, telemetry.name],
      ["harness-subagents", "harness-board", "harness-coordinator", "harness-telemetry"],
    );
  });
});

describe("the configured half, without a context", () => {
  it("board takes the lane prefix a repository actually uses", () => {
    assert.equal(createBoard({ lanePrefix: "topic" }).lanePrefix, "topic");
  });

  it("board falls back to `lane` for a row that says nothing", () => {
    assert.equal(createBoard(undefined).lanePrefix, "lane");
  });

  it("coordinator selects the weaker policy only when it is named", () => {
    assert.equal(createCoordinator({ policy: "seam-or-family" }).policy.name, "seam-or-family");
    assert.equal(createCoordinator(undefined).policy.name, DEFAULT_POLICY.name);
  });

  it("coordinator refuses an unknown policy rather than defaulting", () => {
    assert.throws(() => resolvePolicy("opposite_family"), RangeError);
  });

  it("coordinator finds a workflow by name and says null for one it has not got", () => {
    const service = createCoordinator(undefined);
    const first = service.workflows[0];
    if (first === undefined) throw new Error("no workflows are registered");
    assert.equal(service.workflow(first.name), first);
    assert.equal(service.workflow("no-such-workflow"), null);
  });

  it("telemetry treats an empty home and an absent one the same way", () => {
    assert.equal(resolveHome({ home: "" }), resolveHome(undefined));
  });

  it("telemetry records the home it resolved against", () => {
    assert.equal(createTelemetry({ home: "/srv/harness" }, {}).home, "/srv/harness");
  });

  it("telemetry honours the environment override, and does so at construction", () => {
    const env = { DSH_TELEMETRY_DIR: "/var/log/harness" };
    const service = createTelemetry({ home: "/srv/harness" }, env);
    assert.equal(service.observability.directory, "/var/log/harness");
    // The point of resolving once: moving the variable afterwards cannot move the service.
    env.DSH_TELEMETRY_DIR = "/somewhere/else";
    assert.equal(service.observability.directory, "/var/log/harness");
  });
});
