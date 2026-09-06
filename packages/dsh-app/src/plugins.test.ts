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
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { Context } from "@deepseek-ai/cordis";
import { createMemorySink } from "@rickylabs/telemetry";

import board, { CONTEXT_KEY as BOARD_KEY, createService as createBoard } from "./plugins/board.js";
import coordinator, {
  CONTEXT_KEY as COORDINATOR_KEY,
  DEFAULT_POLICY,
  createService as createCoordinator,
  resolvePolicy,
} from "./plugins/coordinator.js";
import llm, { createAdapter, resolveOverrides } from "./plugins/llm.js";
import subagents, {
  CONTEXT_KEY as SUBAGENTS_KEY,
  createRegistry,
  emptyRegistry,
} from "./plugins/subagents.js";
import telemetry, {
  CONTEXT_KEY as TELEMETRY_KEY,
  createService as createTelemetry,
  resolveHome,
} from "./plugins/telemetry.js";

/**
 * A stand-in for `@deepseek-ai/dsh-llm`'s runtime, recording what `harness-llm` does to it.
 *
 * The real `LlmRuntime` is a service with a lifecycle of its own, and booting one here would test
 * dsh rather than this row. What this row owes the seam is small and exact: one `registerAdapter`
 * call naming three providers, and the disposer it hands back called once on unload.
 *
 * `provide` is reached through a `string`-typed name on purpose. Its typed overload would demand a
 * real `LlmRuntime` for the `llm` key, and widening the name to `string` selects the untyped
 * overload instead of casting the stand-in into a shape it deliberately does not have.
 */
const LLM_KEY: string = "llm";

interface Registration {
  readonly providers: readonly string[];
  readonly adapter: unknown;
}

interface FakeSeam {
  readonly plugin: { name: string; apply: (ctx: Context) => void };
  readonly registered: Registration[];
  released: number;
}

function fakeSeam(): FakeSeam {
  const seam: FakeSeam = {
    registered: [],
    released: 0,
    plugin: {
      name: "fake-llm-runtime",
      apply: (ctx: Context): void => {
        ctx.provide(LLM_KEY, {
          registerAdapter: (providers: readonly string[], adapter: unknown): (() => void) => {
            seam.registered.push({ providers: [...providers], adapter });
            return (): void => {
              seam.released += 1;
            };
          },
        });
      },
    },
  };
  return seam;
}

describe("each plugin claims its service and gives it back", () => {
  it("harness-subagents, once its telemetry dependency is on the context", async () => {
    const ctx = new Context();
    const host = await ctx.plugin(telemetry);
    const fiber = await ctx.plugin(subagents);
    const registry = ctx.get(SUBAGENTS_KEY);
    if (registry === undefined) throw new Error("ctx.subagents was not claimed");
    assert.deepEqual(registry.providers, []);
    await fiber.dispose();
    assert.equal(ctx.get(SUBAGENTS_KEY), undefined);
    await host.dispose();
  });

  it("harness-subagents does not claim the seam without telemetry", async () => {
    // The point of `inject`. A seam that could load unwatched would load unwatched exactly once,
    // on the box where it mattered — and the evidence for that run would simply not exist.
    const ctx = new Context();
    const fiber = await ctx.plugin(subagents);
    assert.equal(ctx.get(SUBAGENTS_KEY), undefined, "the seam loaded with no sink behind it");

    // And it is not a permanent refusal: supplying the dependency activates the waiting fiber.
    const host = await ctx.plugin(telemetry);
    assert.notEqual(ctx.get(SUBAGENTS_KEY), undefined, "the seam did not activate");

    await fiber.dispose();
    await host.dispose();
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

  it("harness-llm binds its routes to the seam it does not own, and gives them back", async () => {
    // The one row that claims nothing. What it must do instead is register on somebody else's seam
    // and, crucially, release on unload: a registration that outlives its fiber makes the next load
    // fail with `DUPLICATE_ADAPTER` while leaving the new fiber with no routes at all.
    const seam = fakeSeam();
    const ctx = new Context();
    const host = await ctx.plugin(seam.plugin);
    const fiber = await ctx.plugin(llm);

    assert.equal(seam.registered.length, 1, "the three routes register in one call, or not at all");
    assert.deepEqual(seam.registered[0]?.providers, ["lm-studio", "llama-rocm", "openrouter"]);
    assert.equal(seam.released, 0);

    await fiber.dispose();
    assert.equal(seam.released, 1, "the registration outlived the fiber that made it");
    await host.dispose();
  });

  it("harness-llm waits for the seam instead of failing without it", async () => {
    // The point of `inject` here. `apply` reads `ctx.llm` unconditionally, so a row that activated
    // before dsh-llm was mounted would fail on a property access at boot. It is meant to be loadable
    // into a profile that has not mounted the runtime; there it simply does nothing yet.
    const seam = fakeSeam();
    const ctx = new Context();
    const fiber = await ctx.plugin(llm);
    assert.equal(seam.registered.length, 0, "something registered with no runtime to register on");

    const host = await ctx.plugin(seam.plugin);
    assert.equal(seam.registered.length, 1, "the waiting fiber never activated");

    await fiber.dispose();
    await host.dispose();
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
    // Telemetry first, because `harness-subagents` now injects it. Row order in the patch still
    // carries no load semantics — cordis activates on service availability — but a test that loads
    // by hand has to sequence what the runtime would have sequenced for it.
    const ctx = new Context();
    const fibers = [
      await ctx.plugin(telemetry),
      await ctx.plugin(subagents),
      await ctx.plugin(board),
      await ctx.plugin(coordinator),
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
      [subagents.name, board.name, coordinator.name, telemetry.name, llm.name],
      [
        "harness-subagents",
        "harness-board",
        "harness-coordinator",
        "harness-telemetry",
        "harness-llm",
      ],
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

  it("telemetry opens its sink without creating anything on disk", () => {
    // Building the service at boot is only safe because of this. Asking where telemetry would go
    // must never itself create a directory — a `--dump-config` on a fresh box would otherwise
    // leave one behind, and a receipt would then name a path that exists because it was asked for.
    const home = join(process.cwd(), "no-such-home-for-a-test");
    const service = createTelemetry({ home }, {});
    assert.equal(service.sink.notes.length, 0);
    assert.equal(existsSync(service.observability.directory), false);
  });

  it("the subagent seam wraps whatever it hands out, empty or not", () => {
    const sink = createMemorySink();
    assert.deepEqual(createRegistry(sink).providers, []);
    assert.deepEqual(emptyRegistry().providers, []);
    // Nothing is written by building the registry: the decorator writes on a verb, not on a boot.
    assert.deepEqual(sink.events, []);
  });

  it("llm treats a blank base URL as no override at all", () => {
    // A profile written by hand tends to carry every key with an empty value. Passing "" through as
    // an override would turn each of those into a `resolveEndpoint` refusal, so a deployment that
    // configured nothing would boot with three dead routes and no clue why.
    assert.deepEqual(resolveOverrides(undefined), {});
    assert.deepEqual(resolveOverrides({ lmStudioUrl: "", llamaRocmUrl: "", openrouterUrl: "" }), {});
  });

  it("llm maps its three config keys onto the backends they name", () => {
    assert.deepEqual(
      resolveOverrides({
        lmStudioUrl: "http://box:1234/v1",
        llamaRocmUrl: "",
        openrouterUrl: "http://relay/v1",
      }),
      { "lm-studio": "http://box:1234/v1", openrouter: "http://relay/v1" },
    );
  });

  it("llm builds an adapter that answers about the routes it was configured for", async () => {
    const adapter = createAdapter({ lmStudioUrl: "http://box:1234/v1" });
    assert.deepEqual(adapter.providerInfo("lm-studio"), { id: "lm-studio", name: "LM Studio" });
    assert.notEqual((await adapter.listModels("lm-studio")).length, 0);
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
