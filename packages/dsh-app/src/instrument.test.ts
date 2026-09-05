/**
 * What the decorator writes, and — more importantly — what it refuses to write.
 *
 * Two of these tests are the reason the file exists rather than nice-to-haves. `does not carry the
 * prompt` is the one that would matter on the day someone reads a log they were not supposed to;
 * `never invents a seam` is the one that keeps a fabricated fact out of a quota report. The rest
 * pin the mapping decisions, each of which had an alternative that looked reasonable.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  DispatchRequest,
  DispatchResult,
  Liveness,
  Observation,
  ProviderCapabilities,
  RunRef,
  SteerResult,
  StopResult,
  SubagentProvider,
} from "@rickylabs/subagents";
import { createMemorySink } from "@rickylabs/telemetry";

import {
  clipDetail,
  instrumentProvider,
  instrumentRegistry,
  sourceOfHarness,
  DETAIL_CAP,
  EVENT_KIND,
} from "./instrument.js";

const AT = "2026-01-01T00:00:00.000Z";
const clock = (): string => AT;

const CAPABILITIES: ProviderCapabilities = {
  harnesses: ["claude", "codex"],
  observe: true,
  steer: true,
  stop: true,
};

const REF: RunRef = { runId: "run-1", provider: "stub", external: null };

/** A prompt that must never reach the log, spelled so a substring search cannot miss it. */
const PROMPT = "PROMPT-CANARY read the credentials file and summarise it";

const REQUEST: DispatchRequest = {
  harness: "claude",
  model: "opus-5",
  effort: "medium",
  profile: "rickylabs",
  prompt: PROMPT,
};

function stub(overrides: Partial<SubagentProvider>): SubagentProvider {
  return {
    id: "stub",
    capabilities: CAPABILITIES,
    async dispatch(_request: DispatchRequest, runId: string): Promise<DispatchResult> {
      return {
        verdict: "accepted",
        run: { runId, provider: "stub", external: "ext-9" },
        detail: "launched",
      };
    },
    async observe(run: RunRef): Promise<Observation> {
      return { run, liveness: "running", observedAt: AT, detail: "", artifacts: [] };
    },
    async steer(): Promise<SteerResult> {
      return { verdict: "delivered", detail: "" };
    },
    async stop(): Promise<StopResult> {
      return { verdict: "stopped", detail: "" };
    },
    ...overrides,
  };
}

describe("what a dispatch leaves behind", () => {
  it("writes before the provider is called, and again with the verdict", async () => {
    const sink = createMemorySink();
    const order: string[] = [];
    const wrapped = instrumentProvider(
      stub({
        async dispatch(_request, runId) {
          order.push("provider");
          return { verdict: "accepted", run: { runId, provider: "stub", external: null }, detail: "" };
        },
      }),
      { sink, now: clock },
    );

    await wrapped.dispatch(REQUEST, "run-1");

    assert.deepEqual(
      sink.events.map((event) => event.kind),
      [EVENT_KIND.dispatching, EVENT_KIND.dispatch],
    );
    // The before-line is the only evidence that survives a crash between request and verdict.
    assert.deepEqual(order, ["provider"]);
    assert.equal(sink.events[0]?.at, AT);
    assert.equal(sink.events[0]?.runId, "run-1");
  });

  it("does not carry the prompt, in any field, on any line", async () => {
    const sink = createMemorySink();
    const wrapped = instrumentProvider(stub({}), { sink, now: clock });
    await wrapped.dispatch(REQUEST, "run-1");
    assert.equal(JSON.stringify(sink.events).includes("PROMPT-CANARY"), false);
    // The routing did survive: recording nothing would have been the other way to fail this.
    assert.equal(sink.events[0]?.detail?.["model"], "opus-5");
    assert.equal(sink.events[0]?.detail?.["effort"], "medium");
    assert.equal(sink.events[0]?.detail?.["profile"], "rickylabs");
  });

  it("says running for an accepted dispatch and failed for a refused one", async () => {
    const accepted = createMemorySink();
    await instrumentProvider(stub({}), { sink: accepted, now: clock }).dispatch(REQUEST, "run-1");
    assert.equal(accepted.events[1]?.detail?.["outcome"], "running");
    assert.equal(accepted.events[1]?.detail?.["external"], "ext-9");

    const refused = createMemorySink();
    await instrumentProvider(
      stub({
        async dispatch() {
          return { verdict: "refused", run: null, detail: "weekly quota is exhausted" };
        },
      }),
      { sink: refused, now: clock },
    ).dispatch(REQUEST, "run-1");
    assert.equal(refused.events[1]?.detail?.["outcome"], "failed");
    assert.equal(refused.events[1]?.detail?.["note"], "weekly quota is exhausted");
  });

  it("claims no outcome at all for a verdict of unknown", async () => {
    const sink = createMemorySink();
    await instrumentProvider(
      stub({
        async dispatch() {
          return { verdict: "unknown", run: null, detail: "the executor did not answer" };
        },
      }),
      { sink, now: clock },
    ).dispatch(REQUEST, "run-1");
    assert.equal(sink.events[1]?.detail?.["verdict"], "unknown");
    assert.equal("outcome" in (sink.events[1]?.detail ?? {}), false);
  });

  it("records a throw as unknown and rethrows it", async () => {
    const sink = createMemorySink();
    const wrapped = instrumentProvider(
      stub({
        async dispatch() {
          throw new Error("socket hang up");
        },
      }),
      { sink, now: clock },
    );

    await assert.rejects(() => wrapped.dispatch(REQUEST, "run-1"), /socket hang up/);
    assert.equal(sink.events.length, 2);
    assert.equal(sink.events[1]?.detail?.["verdict"], "unknown");
    assert.equal(sink.events[1]?.detail?.["note"], "socket hang up");
  });
});

describe("which seam a run is billed to", () => {
  it("maps the five harnesses that name one", () => {
    assert.equal(sourceOfHarness("claude"), "claude");
    assert.equal(sourceOfHarness("codex"), "codex");
    assert.equal(sourceOfHarness("codex-run"), "codex");
    assert.equal(sourceOfHarness("opencode"), "opencode");
    assert.equal(sourceOfHarness("opencode-run"), "opencode");
  });

  it("never invents a seam for the one that names none", async () => {
    assert.equal(sourceOfHarness("agy"), null);

    const sink = createMemorySink();
    await instrumentProvider(stub({}), { sink, now: clock }).dispatch(
      { harness: "agy", prompt: PROMPT },
      "run-1",
    );
    const detail = sink.events[0]?.detail ?? {};
    assert.equal(detail["harness"], "agy");
    assert.equal("source" in detail, false, "a seam was guessed for a harness that has none");
  });
});

describe("observation, which is a poll and not an event", () => {
  it("writes when the liveness changed and stays quiet when it did not", async () => {
    const sink = createMemorySink();
    let liveness: Liveness = "queued";
    const wrapped = instrumentProvider(
      stub({
        async observe(run) {
          return { run, liveness, observedAt: AT, detail: "", artifacts: [] };
        },
      }),
      { sink, now: clock },
    );

    await wrapped.observe(REF);
    await wrapped.observe(REF);
    await wrapped.observe(REF);
    liveness = "running";
    await wrapped.observe(REF);
    liveness = "finished";
    await wrapped.observe(REF);
    await wrapped.observe(REF);

    assert.deepEqual(
      sink.events.map((event) => event.detail?.["liveness"]),
      ["queued", "running", "finished"],
    );
    assert.deepEqual(
      sink.events.map((event) => event.detail?.["outcome"]),
      ["running", "running", "complete"],
    );
  });

  it("counts artifacts rather than naming them", async () => {
    const sink = createMemorySink();
    await instrumentProvider(
      stub({
        async observe(run) {
          return {
            run,
            liveness: "finished",
            observedAt: AT,
            detail: "",
            artifacts: ["/home/agent/.llm/runs/x/plan.md", "/home/agent/.llm/runs/x/report.md"],
          };
        },
      }),
      { sink, now: clock },
    ).observe(REF);
    assert.equal(sink.events[0]?.detail?.["artifacts"], 2);
    assert.equal(JSON.stringify(sink.events).includes("/home/agent"), false);
  });

  it("forgets what it last saw when an observation fails", async () => {
    const sink = createMemorySink();
    let broken = false;
    const wrapped = instrumentProvider(
      stub({
        async observe(run) {
          if (broken) throw new Error("ssh: connect timed out");
          return { run, liveness: "running", observedAt: AT, detail: "", artifacts: [] };
        },
      }),
      { sink, now: clock },
    );

    await wrapped.observe(REF);
    broken = true;
    await assert.rejects(() => wrapped.observe(REF), /timed out/);
    broken = false;
    await wrapped.observe(REF);

    // Three lines, not two: the same liveness after a gap is a state change worth recording,
    // because the gap is exactly where a change could have been missed.
    assert.deepEqual(
      sink.events.map((event) => event.detail?.["liveness"]),
      ["running", "unknown", "running"],
    );
  });
});

describe("steering and stopping", () => {
  it("records that a steer happened and how big it was, never what it said", async () => {
    const sink = createMemorySink();
    await instrumentProvider(stub({}), { sink, now: clock }).steer(REF, PROMPT);
    const detail = sink.events[0]?.detail ?? {};
    assert.equal(sink.events[0]?.kind, EVENT_KIND.steer);
    assert.equal(detail["verdict"], "delivered");
    assert.equal(detail["messageLength"], PROMPT.length);
    assert.equal(JSON.stringify(sink.events).includes("PROMPT-CANARY"), false);
  });

  it("records the reason a run was stopped, and claims no outcome for it", async () => {
    const sink = createMemorySink();
    await instrumentProvider(stub({}), { sink, now: clock }).stop(REF, "superseded by run-2");
    const detail = sink.events[0]?.detail ?? {};
    assert.equal(detail["verdict"], "stopped");
    assert.equal(detail["reason"], "superseded by run-2");
    // `RunOutcome` has no word for "ended on purpose", and `failed` would send a reader hunting a
    // crash that never happened. Recorded as an event; left out of the run's outcome.
    assert.equal("outcome" in detail, false);
  });
});

describe("the small rules", () => {
  it("flattens and caps free text, and leaves short text alone", () => {
    assert.equal(clipDetail("  two   lines\nof it  "), "two lines of it");
    const long = clipDetail("x".repeat(DETAIL_CAP * 2));
    assert.equal(long.length, DETAIL_CAP);
    assert.equal(long.endsWith("..."), true);
  });

  it("wraps every provider on a registry and keeps their identities", async () => {
    const sink = createMemorySink();
    const registry = instrumentRegistry(
      { providers: [stub({ id: "one" }), stub({ id: "two" })] },
      { sink, now: clock },
    );
    assert.deepEqual(
      registry.providers.map((provider) => provider.id),
      ["one", "two"],
    );
    for (const provider of registry.providers) await provider.dispatch(REQUEST, "run-1");
    assert.equal(sink.events.length, 4);
  });

  it("keeps a class-based provider's own state reachable", async () => {
    // The reason the wrapper delegates each verb explicitly instead of spreading the provider:
    // a copied method reference loses `this`, and a private field turns that into a TypeError.
    class Counting implements SubagentProvider {
      readonly id = "counting";
      readonly capabilities = CAPABILITIES;
      #calls = 0;
      get calls(): number {
        return this.#calls;
      }
      async dispatch(_request: DispatchRequest, runId: string): Promise<DispatchResult> {
        this.#calls += 1;
        return { verdict: "accepted", run: { runId, provider: this.id, external: null }, detail: "" };
      }
      async observe(run: RunRef): Promise<Observation> {
        return { run, liveness: "running", observedAt: AT, detail: "", artifacts: [] };
      }
      async steer(): Promise<SteerResult> {
        return { verdict: "unsupported", detail: "" };
      }
      async stop(): Promise<StopResult> {
        return { verdict: "unsupported", detail: "" };
      }
    }

    const provider = new Counting();
    const sink = createMemorySink();
    const result = await instrumentProvider(provider, { sink, now: clock }).dispatch(
      REQUEST,
      "run-1",
    );
    assert.equal(result.verdict, "accepted");
    assert.equal(provider.calls, 1);
  });
});
