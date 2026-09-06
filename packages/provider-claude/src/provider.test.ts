/**
 * The provider, driven against a fake `query()`.
 *
 * The fake is the whole reason this package injects the SDK instead of depending on it. Every path
 * that matters here — a session that never announces itself, a stream that dies mid-run, an
 * interrupt that works, an interrupt that is not offered — is something the real CLI does rarely and
 * on somebody else's schedule. Made injectable, they are ordinary tests.
 *
 * What these tests are *for* is the contract's difficult word. `unknown` means "this run may be
 * alive and we cannot say", and `isSafeToRetry` licenses a retry only for `refused`. So each verb is
 * checked for saying `unknown` where it must — and, just as much, for saying `refused` where it can,
 * because an over-cautious `unknown` is a run nobody dares relaunch.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  conformanceProblems,
  isSafeToRetry,
  selectProvider,
  type DispatchRequest,
  type RunRef,
} from "@rickylabs/subagents";

import { CONFIG_DIR_VAR, type BaseEnv } from "./env.js";
import {
  createProvider,
  timeoutMs,
  untranslated,
  DEFAULT_ID,
  TIMER_CEILING_MS,
  type ClaudeProvider,
} from "./provider.js";
import type { AgentQuery, QueryFn, QueryOptions, SdkUserMessage } from "./sdk.js";

// --- the fake -----------------------------------------------------------------------------------

interface FakeSdk {
  readonly query: QueryFn;
  /** The options each `query()` call was made with. */
  readonly calls: QueryOptions[];
  /** Everything the provider pushed down a prompt stream: the brief, then every steer. */
  readonly received: SdkUserMessage[];
  interrupts: number;
  aborted: boolean;
  /** Yield a message to every open stream. */
  emit: (message: unknown) => void;
  /** End every open stream, the way a CLI exiting on its own would. */
  end: () => void;
}

/** One `query()` call's view of the emitted messages. Per call, so two runs do not share a cursor. */
interface Channel {
  at: number;
  wake: (() => void) | null;
  closed: boolean;
  failure: string | null;
}

/**
 * A `query()` that yields what a test tells it to, when a test tells it to.
 *
 * It consumes the prompt iterable the way the real SDK does, so `steer` is tested end to end rather
 * than by inspecting the inbox, and it listens to the abort signal, so "the child goes away when the
 * stream ends" is observable instead of assumed.
 */
function fakeSdk(options: { readonly interrupt?: boolean } = {}): FakeSdk {
  const out: unknown[] = [];
  const channels: Channel[] = [];

  const nudge = (channel: Channel): void => {
    const waiter = channel.wake;
    channel.wake = null;
    if (waiter !== null) waiter();
  };

  const fake: FakeSdk = {
    calls: [],
    received: [],
    interrupts: 0,
    aborted: false,
    emit: (message: unknown): void => {
      out.push(message);
      for (const channel of channels) nudge(channel);
    },
    end: (): void => {
      for (const channel of channels) {
        channel.closed = true;
        nudge(channel);
      }
    },
    query: (input): AgentQuery => {
      const channel: Channel = { at: 0, wake: null, closed: false, failure: null };
      channels.push(channel);
      fake.calls.push(input.options);
      void (async (): Promise<void> => {
        for await (const message of input.prompt) fake.received.push(message);
      })();
      input.options.abortController?.signal.addEventListener("abort", () => {
        fake.aborted = true;
        channel.failure = "aborted";
        nudge(channel);
      });
      const iterate = async function* (): AsyncGenerator<unknown> {
        for (;;) {
          while (channel.at < out.length) {
            const item = out[channel.at];
            channel.at += 1;
            yield item;
          }
          if (channel.failure !== null) throw new Error(channel.failure);
          if (channel.closed) return;
          await new Promise<void>((resolve) => {
            channel.wake = resolve;
          });
        }
      };
      return {
        [Symbol.asyncIterator]: iterate,
        ...(options.interrupt === false
          ? {}
          : {
              interrupt: async (): Promise<void> => {
                fake.interrupts += 1;
                channel.closed = true;
                nudge(channel);
              },
            }),
      };
    },
  };
  return fake;
}

/** Let the consumer loop and the prompt reader run to a standstill. */
async function settle(ticks = 6): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error("expected at least one item");
  return item;
}

/**
 * Hold the event loop open for the body.
 *
 * Every timer the provider arms is `unref`'d, deliberately: a provider holding a deadline must never
 * be the reason a daemon refuses to exit. The cost lands here — a test whose only pending work is one
 * of those timers has nothing keeping the loop alive, so Node drains it and the runner reports
 * "Promise resolution is still pending but the event loop has already resolved". A ref'd timer of the
 * test's own is the fix, and it is a fact about the suite rather than about the provider.
 */
async function awake<T>(body: () => Promise<T>): Promise<T> {
  const hold = setTimeout(() => {}, 30_000);
  try {
    return await body();
  } finally {
    clearTimeout(hold);
  }
}

// --- fixtures -----------------------------------------------------------------------------------

const NOW = "2026-09-06T10:00:00.000Z";
const CONFIG_DIR = "/srv/agents/pool/.claude";
const EVIDENCE = "/srv/agents/pool/.claude/projects";
const ENV: BaseEnv = { HOME: "/home/agent", USERPROFILE: "C:\\Users\\agent", PATH: "/usr/bin" };

const REQUEST: DispatchRequest = {
  harness: "claude",
  model: "opus-5",
  effort: "medium",
  prompt: "review the diff on #52",
};

/** The same request with nothing optional on it, for the checks about what is *not* carried. */
const BARE: DispatchRequest = { harness: "claude", model: "opus-5", prompt: "review the diff" };

const INIT = { type: "system", subtype: "init", session_id: "ses-1", model: "opus-5" };
const RESULT = { type: "result", subtype: "success", num_turns: 3, total_cost_usd: 0.12 };

interface Extra {
  readonly configDir?: string;
  readonly env?: BaseEnv;
  readonly readyTimeoutMs?: number;
  readonly cwd?: string;
  readonly maxTurns?: number;
}

function makeProvider(query: QueryFn, extra: Extra = {}): ClaudeProvider {
  return createProvider({
    query,
    configDir: extra.configDir ?? CONFIG_DIR,
    env: extra.env ?? ENV,
    readyTimeoutMs: extra.readyTimeoutMs ?? 50,
    now: () => new Date(NOW),
    ...(extra.cwd === undefined ? {} : { cwd: extra.cwd }),
    ...(extra.maxTurns === undefined ? {} : { maxTurns: extra.maxTurns }),
  });
}

/** A provider carrying one accepted, still-running run. */
async function running(
  fake: FakeSdk = fakeSdk(),
): Promise<{ provider: ClaudeProvider; fake: FakeSdk; run: RunRef }> {
  const provider = makeProvider(fake.query);
  fake.emit(INIT);
  const dispatched = await provider.dispatch(REQUEST, "run-1");
  assert.equal(dispatched.verdict, "accepted");
  const run = dispatched.run;
  if (run === null) throw new Error("an accepted dispatch must carry a run");
  return { provider, fake, run };
}

// --- what the provider says about itself --------------------------------------------------------

describe("declaring what it can do", () => {
  it("is a conformant provider", () => {
    // `conformanceProblems` is the check that a declaration is usable at all: a lowercase id, at
    // least one harness, and no capability claimed that the contract cannot address.
    assert.deepEqual(conformanceProblems(makeProvider(fakeSdk().query)), []);
  });

  it("launches claude, and claims the three optional calls together", () => {
    // Not three independent guesses. `Query.interrupt()` and a second inbound message both exist
    // only in streaming-input mode, so one decision licenses steer and stop at once.
    const provider = makeProvider(fakeSdk().query);
    assert.deepEqual(provider.capabilities.harnesses, ["claude"]);
    assert.equal(provider.capabilities.observe, true);
    assert.equal(provider.capabilities.steer, true);
    assert.equal(provider.capabilities.stop, true);
    assert.equal(provider.id, DEFAULT_ID);
  });

  it("is the provider a claude dispatch selects", () => {
    const provider = makeProvider(fakeSdk().query);
    const selection = selectProvider({ providers: [provider] }, REQUEST);
    assert.equal(selection.selected, true);
    if (selection.selected) assert.equal(selection.provider, provider);
  });
});

// --- what it will not launch --------------------------------------------------------------------

describe("refusing what is decidable", () => {
  it("refuses a run id it could not find the run by again", async () => {
    const provider = makeProvider(fakeSdk().query);
    const result = await provider.dispatch(REQUEST, "");
    assert.equal(result.verdict, "refused");
    assert.equal(result.run, null);
    assert.deepEqual(provider.records(), []);
  });

  it("refuses a run id it is already using", async () => {
    const { provider } = await running();
    const again = await provider.dispatch(REQUEST, "run-1");
    assert.equal(again.verdict, "refused");
    assert.match(again.detail, /already dispatched/);
    assert.equal(provider.records().length, 1);
  });

  it("refuses a harness it does not launch", async () => {
    const provider = makeProvider(fakeSdk().query);
    const result = await provider.dispatch({ ...REQUEST, harness: "codex" }, "run-1");
    assert.equal(result.verdict, "refused");
    assert.match(result.detail, /claude only/);
  });

  it("refuses a request the wire format would not carry faithfully", async () => {
    // Reusing `validateDispatch` rather than paraphrasing it: a laxer check here would let a
    // dispatch through this seam that the `/swarm` seam refuses, and they are one request.
    const provider = makeProvider(fakeSdk().query);
    const result = await provider.dispatch(BARE, "run-1");
    assert.equal(result.verdict, "refused");
    assert.match(result.detail, /not launchable/);
    assert.match(result.detail, /effort/);
  });

  it("refuses an environment that would write into the operator's home", async () => {
    const provider = makeProvider(fakeSdk().query, { configDir: "/home/agent" });
    const result = await provider.dispatch(REQUEST, "run-1");
    assert.equal(result.verdict, "refused");
    assert.match(result.detail, /environment is unusable/);
  });

  it("licenses a retry for a refusal, and only for a refusal", async () => {
    const provider = makeProvider(fakeSdk().query);
    assert.equal(isSafeToRetry(await provider.dispatch(REQUEST, "")), true);
  });
});

// --- launching ----------------------------------------------------------------------------------

describe("launching a run", () => {
  it("accepts once the session announces itself, and names it", async () => {
    const { run } = await running();
    assert.equal(run.external, "ses-1");
    assert.equal(run.provider, DEFAULT_ID);
    assert.equal(run.runId, "run-1");
  });

  it("says on the dispatch itself what it could not carry to the SDK", async () => {
    // The whole point of `untranslated`. `effort` is how the matrix says *opus 5 medium* rather
    // than *opus 5*; a run that quietly drops it succeeds while not being the run that was ordered.
    const fake = fakeSdk();
    const provider = makeProvider(fake.query);
    fake.emit(INIT);
    const result = await provider.dispatch(REQUEST, "run-1");
    assert.match(result.detail, /session ses-1/);
    assert.match(result.detail, /not translated: effort=medium/);
  });

  it("sends the brief down the prompt stream as the first message", async () => {
    const { fake } = await running();
    await settle();
    assert.equal(first(fake.received).message.content, "review the diff on #52");
  });

  it("passes the model id verbatim, with no translation table in between", async () => {
    // `@rickylabs/routing` owns every pin. A second spelling here would be a second, unverified
    // answer to a question that is supposed to have exactly one.
    const { fake } = await running();
    assert.equal(first(fake.calls).model, "opus-5");
  });

  it("isolates the config directory and leaves the home variables alone", async () => {
    const { fake } = await running();
    const env = first(fake.calls).env ?? {};
    assert.equal(env[CONFIG_DIR_VAR], CONFIG_DIR);
    assert.equal(env["HOME"], "/home/agent");
    assert.equal(env["USERPROFILE"], "C:\\Users\\agent");
  });

  it("passes cwd and a turn budget only when the deployment set them", async () => {
    const bare = fakeSdk();
    const bareProvider = makeProvider(bare.query);
    bare.emit(INIT);
    await bareProvider.dispatch(REQUEST, "run-1");
    assert.equal(Object.hasOwn(first(bare.calls), "cwd"), false);
    assert.equal(Object.hasOwn(first(bare.calls), "maxTurns"), false);

    const set = fakeSdk();
    const setProvider = makeProvider(set.query, { cwd: "/work/harness", maxTurns: 40 });
    set.emit(INIT);
    await setProvider.dispatch(REQUEST, "run-1");
    assert.equal(first(set.calls).cwd, "/work/harness");
    assert.equal(first(set.calls).maxTurns, 40);
  });
});

// --- where it says "unknown" --------------------------------------------------------------------

describe("saying unknown rather than guessing", () => {
  it("does not claim a failure when query() itself threw", async () => {
    // The SDK spawns lazily, so *most likely* nothing launched — and "most likely" is not a claim
    // to hang an automatic retry on.
    const provider = makeProvider(() => {
      throw new Error("no binary on PATH");
    });
    const result = await provider.dispatch(REQUEST, "run-1");
    assert.equal(result.verdict, "unknown");
    assert.equal(isSafeToRetry(result), false);
    assert.match(result.detail, /query\(\) refused to start: no binary on PATH/);
  });

  it("does not claim a failure when the session stays silent", async () => {
    const fake = fakeSdk();
    const provider = makeProvider(fake.query, { readyTimeoutMs: 20 });
    const result = await awake(() => provider.dispatch(REQUEST, "run-1"));
    assert.equal(result.verdict, "unknown");
    assert.match(result.detail, /no session id after 20ms/);
    assert.match(result.detail, /observe it/);
    fake.end();
    await settle();
  });

  it("reports a stream that ended before saying anything, without inventing an outcome", async () => {
    const fake = fakeSdk();
    const provider = makeProvider(fake.query);
    const dispatched = provider.dispatch(REQUEST, "run-1");
    fake.end();
    const result = await dispatched;
    assert.equal(result.verdict, "unknown");
    assert.equal(first(provider.records()).liveness, "failed");
    assert.match(first(provider.records()).detail, /without a result/);
  });

  it("says unknown for a run it has no record of, on every verb", async () => {
    // After a restart, the run this process forgot may still be holding a worktree. Reporting it as
    // gone is how a second agent gets put on the same branch.
    const provider = makeProvider(fakeSdk().query);
    const stranger: RunRef = { runId: "run-9", provider: DEFAULT_ID, external: "ses-9" };
    assert.equal((await provider.observe(stranger)).liveness, "unknown");
    assert.equal((await provider.steer(stranger, "hello")).verdict, "unknown");
    assert.equal((await provider.stop(stranger, "cleanup")).verdict, "unknown");
  });

  it("will not touch a run belonging to another provider", async () => {
    const { provider, run } = await running();
    const foreign: RunRef = { ...run, provider: "someone-else" };
    assert.equal((await provider.observe(foreign)).liveness, "unknown");
    assert.equal((await provider.stop(foreign, "cleanup")).verdict, "unknown");
  });
});

// --- observing ----------------------------------------------------------------------------------

describe("observing", () => {
  it("reports a running run without going to look", async () => {
    const { provider, run } = await running();
    const observation = await provider.observe(run);
    assert.equal(observation.liveness, "running");
    assert.equal(observation.observedAt, NOW);
    assert.equal(observation.detail, "session started");
  });

  it("points at the directory a run's transcripts land in", async () => {
    // The isolated config dir is not the one `dsh-telemetry` scans by default, so a run launched
    // here would otherwise leave evidence nothing goes looking for. The directory, not the file:
    // the CLI owns its project-slug scheme, and the backfill walks for `*.jsonl` anyway.
    const { provider, run } = await running();
    assert.deepEqual((await provider.observe(run)).artifacts, [EVIDENCE]);
  });

  it("reports the run as finished once the result arrives", async () => {
    const { provider, fake, run } = await running();
    fake.emit(RESULT);
    await settle();
    const observation = await provider.observe(run);
    assert.equal(observation.liveness, "finished");
    assert.match(observation.detail, /run completed \(success\) after 3 turns/);
    assert.equal(first(provider.records()).costUsd, 0.12);
  });

  it("carries the model note on every observation, not only on the dispatch", async () => {
    const fake = fakeSdk();
    const provider = makeProvider(fake.query);
    fake.emit({ ...INIT, model: "claude-opus-4-1" });
    const dispatched = await provider.dispatch(REQUEST, "run-1");
    const run = dispatched.run;
    if (run === null) throw new Error("expected a run");
    assert.match((await provider.observe(run)).detail, /asked opus-5, running claude-opus-4-1/);
  });
});

// --- steering -----------------------------------------------------------------------------------

describe("steering a run in flight", () => {
  it("delivers the message down the same stream the brief went down", async () => {
    const { provider, fake, run } = await running();
    const result = await provider.steer(run, "also update the README");
    assert.equal(result.verdict, "delivered");
    await settle();
    assert.equal(fake.received.length, 2);
    assert.equal(fake.received[1]?.message.content, "also update the README");
  });

  it("stamps the steer with the session the run is actually in", async () => {
    const { provider, fake, run } = await running();
    await provider.steer(run, "also update the README");
    await settle();
    assert.equal(fake.received[1]?.session_id, "ses-1");
  });

  it("refuses an empty message rather than sending a blank turn", async () => {
    const { provider, run } = await running();
    assert.equal((await provider.steer(run, "   ")).verdict, "refused");
  });

  it("refuses to steer a run that is over", async () => {
    const { provider, fake, run } = await running();
    fake.emit(RESULT);
    await settle();
    const result = await provider.steer(run, "one more thing");
    assert.equal(result.verdict, "refused");
    assert.match(result.detail, /finished/);
  });
});

// --- stopping -----------------------------------------------------------------------------------

describe("stopping a run", () => {
  it("interrupts first, so the agent can put down what it is holding", async () => {
    const { provider, fake, run } = await running();
    const result = await provider.stop(run, "superseded");
    assert.equal(result.verdict, "stopped");
    assert.equal(result.detail, "interrupted: superseded");
    assert.equal(fake.interrupts, 1);
    await settle();
    assert.equal(first(provider.records()).liveness, "finished");
  });

  it("aborts when the query offers no interrupt", async () => {
    const { provider, fake, run } = await running(fakeSdk({ interrupt: false }));
    const result = await provider.stop(run, "budget exhausted");
    assert.equal(result.verdict, "stopped");
    assert.equal(result.detail, "aborted: budget exhausted");
    assert.equal(fake.aborted, true);
    await settle();
    assert.equal(first(provider.records()).liveness, "finished");
  });

  it("reads a stopped run as finished, not failed — the stream dying is the stop working", async () => {
    const { provider, run } = await running();
    await provider.stop(run, "superseded");
    await settle();
    assert.match((await provider.observe(run)).detail, /stopped: superseded/);
  });

  it("treats a run that is already over as a success, because nothing is left to stop", async () => {
    const { provider, fake, run } = await running();
    fake.emit(RESULT);
    await settle();
    assert.equal((await provider.stop(run, "cleanup")).verdict, "already-over");
  });

  it("ends every live run on shutdown", async () => {
    const fake = fakeSdk();
    const provider = makeProvider(fake.query);
    fake.emit(INIT);
    await provider.dispatch(REQUEST, "run-1");
    await provider.dispatch({ ...REQUEST, prompt: "second job" }, "run-2");
    await provider.shutdown("daemon restarting");
    await settle();
    assert.equal(provider.records().length, 2);
    for (const record of provider.records()) {
      assert.equal(record.liveness, "finished", `${record.runId} was left ${record.liveness}`);
    }
  });
});

// --- the child not outliving the stream ---------------------------------------------------------

describe("not leaving a child behind", () => {
  it("aborts the controller when the run finishes cleanly", async () => {
    // #52's second acceptance criterion, structurally: the abort is in a `finally`, so a run that
    // ends by *any* path — result, throw, stop, shutdown — reaps its child. Proving the process
    // table is clean afterwards is a claim about a real box, and belongs to #49.
    const { provider, fake, run } = await running();
    assert.equal(fake.aborted, false);
    fake.emit(RESULT);
    await settle();
    assert.equal(fake.aborted, true);
    assert.equal((await provider.observe(run)).liveness, "finished");
  });

  it("gives every run its own controller", async () => {
    const fake = fakeSdk();
    const provider = makeProvider(fake.query);
    fake.emit(INIT);
    await provider.dispatch(REQUEST, "run-1");
    await provider.dispatch({ ...REQUEST, prompt: "second job" }, "run-2");
    const one = fake.calls[0]?.abortController;
    const two = fake.calls[1]?.abortController;
    assert.equal(one instanceof AbortController, true);
    assert.equal(two instanceof AbortController, true);
    assert.notEqual(one, two);
    await provider.shutdown();
    await settle();
  });
});

// --- the deadline -------------------------------------------------------------------------------

describe("honouring the request's deadline", () => {
  it("converts a Go duration from nanoseconds to milliseconds", () => {
    // `parseGoDuration` reproduces Go's `time.ParseDuration`, which is in **nanoseconds**. Feeding
    // its result to `setTimeout` reads as correct and fails in the most expensive direction there
    // is: `30m` becomes 1.8e12, overflows the 32-bit timer, fires on the next tick, and every
    // bounded run is stopped the instant it starts.
    assert.equal(timeoutMs({ ...REQUEST, timeout: "30m" }), 1_800_000);
    assert.equal(timeoutMs({ ...REQUEST, timeout: "1s" }), 1_000);
    assert.equal(timeoutMs({ ...REQUEST, timeout: "500ms" }), 500);
    assert.equal(timeoutMs({ ...REQUEST, timeout: "1h30m" }), 5_400_000);
  });

  it("arms nothing for a deadline the executor would have discarded anyway", () => {
    assert.equal(timeoutMs(REQUEST), null);
    assert.equal(timeoutMs({ ...REQUEST, timeout: "" }), null);
    assert.equal(timeoutMs({ ...REQUEST, timeout: "0" }), null);
    assert.equal(timeoutMs({ ...REQUEST, timeout: "soon" }), null);
    assert.equal(timeoutMs({ ...REQUEST, timeout: "-5m" }), null);
  });

  it("clamps a deadline past the timer ceiling, and says that it did", () => {
    assert.equal(timeoutMs({ ...REQUEST, timeout: "1000h" }), TIMER_CEILING_MS);
    assert.match(
      untranslated({ ...REQUEST, timeout: "1000h" }).join("; "),
      /clamped to 2147483647ms/,
    );
  });

  it("stops a run that outlives its deadline", async () => {
    const fake = fakeSdk();
    const provider = makeProvider(fake.query);
    fake.emit(INIT);
    const result = await provider.dispatch({ ...REQUEST, timeout: "40ms" }, "run-1");
    assert.equal(result.verdict, "accepted");
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    await settle();
    const record = first(provider.records());
    assert.equal(record.liveness, "finished");
    assert.equal(record.detail, "stopped: timeout after 40ms");
  });
});

// --- what does not reach the SDK ----------------------------------------------------------------

describe("naming what cannot be carried", () => {
  it("names effort, which is half of what the matrix pinned", () => {
    assert.deepEqual(untranslated(REQUEST), ["effort=medium (the SDK exposes no effort option)"]);
  });

  it("names every other field the SDK has no option for", () => {
    const lost = untranslated({
      ...REQUEST,
      maxTokens: "500k",
      profile: "reviewer",
      router: "openrouter",
    });
    assert.equal(lost.length, 4);
    assert.match(lost.join("; "), /max-tokens=500k/);
    assert.match(lost.join("; "), /profile=reviewer/);
    assert.match(lost.join("; "), /router=openrouter/);
  });

  it("says nothing about fields that were not set", () => {
    assert.deepEqual(untranslated(BARE), []);
  });
});
