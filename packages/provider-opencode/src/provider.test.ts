/**
 * The four verbs against a fake server and a fake bus.
 *
 * The transport and the stream are injected precisely so this file can produce what a real server
 * does and a happy-path fake never would: a prompt whose reply is lost, an abort answered with
 * `false`, an event stream that drops in the middle of a run. Those three are where the verdicts are
 * decided, and a verdict decided wrong here puts a second agent on a branch that already has one.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { conformanceProblems, type DispatchRequest, type RunRef } from "@rickylabs/subagents";

import { CAPABILITIES, DEFAULT_ID, OpencodeProvider, createProvider } from "./provider.js";
import type { HttpOutcome, HttpRequest, StreamOutcome, StreamRequest } from "./http.js";

const AUTH_PATH = "/home/agent/.local/share/opencode/auth.json";

function ok(status: number, body: unknown = null): HttpOutcome {
  return { kind: "ok", status, body };
}

function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`nothing recorded at ${index}`);
  return value;
}

/** A stream whose chunks the test pushes, and can end or fail on demand. */
function channel(): {
  readonly chunks: AsyncIterable<string>;
  push(text: string): void;
  close(): void;
  fail(error: Error): void;
} {
  const queue: string[] = [];
  let waiting: (() => void) | null = null;
  let done = false;
  let failure: Error | null = null;
  const wake = (): void => {
    const woken = waiting;
    waiting = null;
    if (woken !== null) woken();
  };
  return {
    push: (text: string): void => {
      queue.push(text);
      wake();
    },
    close: (): void => {
      done = true;
      wake();
    },
    fail: (error: Error): void => {
      failure = error;
      done = true;
      wake();
    },
    chunks: {
      async *[Symbol.asyncIterator](): AsyncIterator<string> {
        for (;;) {
          while (queue.length > 0) {
            const next = queue.shift();
            if (next !== undefined) yield next;
          }
          if (failure !== null) throw failure;
          if (done) return;
          await new Promise<void>((resolve) => {
            waiting = resolve;
          });
        }
      },
    },
  };
}

/** Let the background consume loop catch up with what the test just pushed. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

async function until(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

interface Server {
  readonly provider: OpencodeProvider;
  readonly calls: HttpRequest[];
  readonly streamCalls: StreamRequest[];
  /** `null` mints an incrementing session id; an outcome overrides every `POST /session`. */
  session: HttpOutcome | null;
  prompt: HttpOutcome;
  abort: HttpOutcome;
  remove: HttpOutcome;
  /** `null` opens the channel; an outcome makes `GET /event` fail instead. */
  stream: StreamOutcome | null;
  /** Deliver one bus event and wait for the fold. */
  emit(event: unknown): Promise<void>;
  /** End the connection, as a server restart or a proxy timeout would. */
  drop(): Promise<void>;
  paths(): string[];
}

function server(options: { readonly logDir?: string; readonly agent?: string } = {}): Server {
  const calls: HttpRequest[] = [];
  const streamCalls: StreamRequest[] = [];
  // A fresh one per connection, as a reconnect really gets. Reusing a closed channel would make the
  // second connection end the instant it opened, which is a fake artefact and not a server.
  let bus = channel();
  let minted = 0;

  const state = {
    calls,
    streamCalls,
    session: null as HttpOutcome | null,
    prompt: ok(204, null),
    abort: ok(200, true),
    remove: ok(200, true),
    stream: null as StreamOutcome | null,
    provider: undefined as unknown as OpencodeProvider,
    emit: async (event: unknown): Promise<void> => {
      bus.push(`data: ${JSON.stringify(event)}\n\n`);
      await settle();
    },
    drop: async (): Promise<void> => {
      bus.close();
      await settle();
    },
    paths: (): string[] => calls.map((call) => `${call.method} ${call.path}`),
  };

  const http = async (request: HttpRequest): Promise<HttpOutcome> => {
    calls.push(request);
    if (request.method === "DELETE") return state.remove;
    if (request.path.endsWith("/abort")) return state.abort;
    if (request.path.endsWith("/prompt_async")) return state.prompt;
    if (state.session !== null) return state.session;
    minted += 1;
    return ok(200, { id: `ses_${minted}` });
  };

  const stream = async (request: StreamRequest): Promise<StreamOutcome> => {
    streamCalls.push(request);
    if (state.stream !== null) return state.stream;
    bus = channel();
    return { kind: "open", chunks: bus.chunks };
  };

  const provider = createProvider({
    http,
    stream,
    now: (): Date => new Date("2026-01-01T00:00:00.000Z"),
    ...(options.logDir === undefined ? {} : { logDir: options.logDir }),
    ...(options.agent === undefined ? {} : { agent: options.agent }),
  });
  state.provider = provider;
  return state;
}

function request(overrides: Partial<DispatchRequest> = {}): DispatchRequest {
  return {
    harness: "opencode",
    model: "z-ai/glm-5.2",
    effort: "medium",
    router: "openrouter",
    prompt: "implement the thing",
    ...overrides,
  };
}

function ref(runId: string, external: string | null = "ses_1"): RunRef {
  return { runId, provider: DEFAULT_ID, external };
}

describe("declaration", () => {
  it("declares both opencode harnesses and all three optional calls", () => {
    assert.deepEqual(CAPABILITIES, {
      harnesses: ["opencode", "opencode-run"],
      observe: true,
      steer: true,
      stop: true,
    });
  });

  it("conforms, so a registry will accept it", () => {
    assert.deepEqual(conformanceProblems(server().provider), []);
  });
});

describe("dispatch", () => {
  it("opens the stream first, then creates the session, then prompts", async () => {
    const fake = server();

    const result = await fake.provider.dispatch(request(), "r1");

    assert.equal(result.verdict, "accepted");
    assert.equal(fake.streamCalls.length, 1);
    assert.deepEqual(fake.paths(), ["POST /session", "POST /session/ses_1/prompt_async"]);
    assert.deepEqual(result.run, { runId: "r1", provider: DEFAULT_ID, external: "ses_1" });
    assert.match(result.detail, /session ses_1 on openrouter\/z-ai\/glm-5\.2/);
    assert.match(result.detail, /queued; the first bus event will promote it to running/);
    assert.equal(at(fake.provider.records(), 0).liveness, "queued");
  });

  it("puts the run id in the session title and the prompt nowhere near it", async () => {
    // Session titles are listed by anything looking at the server. A prompt in one is a prompt in a
    // place nothing in this repository governs.
    const fake = server();

    await fake.provider.dispatch(request({ prompt: "the plan, which is not for the title" }), "r1");

    const body = at(fake.calls, 0).body as { readonly title?: unknown };
    assert.equal(body.title, "dsh r1");
    const sent = JSON.stringify(at(fake.calls, 0));
    assert.equal(sent.includes("not for the title"), false);
  });

  it("sends the prompt with the translated model, and no agent unless configured", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    assert.deepEqual(at(fake.calls, 1).body, {
      model: { providerID: "openrouter", modelID: "z-ai/glm-5.2" },
      parts: [{ type: "text", text: "implement the thing" }],
    });

    const named = server({ agent: "build" });
    await named.provider.dispatch(request(), "r1");
    const body = at(named.calls, 1).body as { readonly agent?: unknown };
    assert.equal(body.agent, "build");
  });

  it("refuses, and sends nothing at all, when the run cannot be watched", async () => {
    // The failure this provider exists to prevent: a run launched into silence. Refusing to start is
    // a cost; starting something nobody can see is the thing that made the owner ask "status ?".
    const fake = server();
    fake.stream = { kind: "unreachable", detail: "ECONNREFUSED" };

    const result = await fake.provider.dispatch(request(), "r1");

    assert.equal(result.verdict, "refused");
    assert.match(result.detail, /could not be opened.*ECONNREFUSED/);
    assert.match(result.detail, /nothing was launched/);
    assert.deepEqual(fake.calls, []);
    assert.deepEqual(fake.provider.records(), []);
  });

  it("opens one connection for two dispatches that arrive together", async () => {
    // Two streams would fold every event into the same records twice, which shows up as a run
    // reporting double the activity it had and finishing on the first of two idles.
    const fake = server();

    const results = await Promise.all([
      fake.provider.dispatch(request(), "r1"),
      fake.provider.dispatch(request(), "r2"),
    ]);

    assert.deepEqual(
      results.map((result) => result.verdict),
      ["accepted", "accepted"],
    );
    assert.equal(fake.streamCalls.length, 1);
  });

  it("refuses a duplicate run id", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");

    const again = await fake.provider.dispatch(request(), "r1");

    assert.equal(again.verdict, "refused");
    assert.match(again.detail, /already dispatched here/);
  });

  it("refuses an empty run id and a harness it does not launch", async () => {
    const fake = server();
    assert.match((await fake.provider.dispatch(request(), "")).detail, /run id is empty/);

    const wrong = await fake.provider.dispatch(request({ harness: "claude" }), "r1");
    assert.equal(wrong.verdict, "refused");
    assert.match(wrong.detail, /launches opencode and opencode-run only/);
  });

  it("refuses a request the contract says is not launchable", async () => {
    const fake = server();
    const { effort: _drop, ...rest } = request();

    const result = await fake.provider.dispatch(rest, "r1");

    assert.equal(result.verdict, "refused");
    assert.match(result.detail, /not launchable/);
    assert.deepEqual(fake.streamCalls, []);
  });

  it("refuses to dispatch at all when evidence collection points at the credential file", async () => {
    // Artifact paths are published. A `logDir` naming `auth.json` is a leak with a delay on it, so it
    // stops dispatch rather than being quietly dropped from the artifact list.
    const fake = server({ logDir: AUTH_PATH });

    const result = await fake.provider.dispatch(request(), "r1");

    assert.equal(result.verdict, "refused");
    assert.match(result.detail, /names a credential file/);
    assert.equal(result.detail.includes("auth.json"), false);
  });

  it("refuses when the session could not be created, and says whether litter was left", async () => {
    const answeredNo = server();
    answeredNo.session = { kind: "http", status: 429, detail: "too many sessions" };
    const refusal = await answeredNo.provider.dispatch(request(), "r1");
    assert.equal(refusal.verdict, "refused");
    assert.match(refusal.detail, /so nothing was launched/);

    // Still `refused`, not `unknown`: an unprompted session is inert, so the worst case is litter and
    // a retry cannot put a second agent anywhere.
    const silent = server();
    silent.session = { kind: "unreachable", detail: "socket hang up" };
    const lost = await silent.provider.dispatch(request(), "r1");
    assert.equal(lost.verdict, "refused");
    assert.match(lost.detail, /an unused session may now exist/);
  });

  it("refuses when the reply carries no session id", async () => {
    const fake = server();
    fake.session = ok(200, { created: true });

    const result = await fake.provider.dispatch(request(), "r1");

    assert.equal(result.verdict, "refused");
    assert.match(result.detail, /carried no id/);
    assert.deepEqual(fake.paths(), ["POST /session"]);
  });

  it("refuses a rejected prompt, releases the run id and drops the session", async () => {
    // The server read the prompt and said no, so nothing is executing. `isSafeToRetry` licenses a
    // retry — which must not then be refused here as a duplicate.
    const fake = server();
    fake.prompt = { kind: "http", status: 400, detail: "unknown model" };

    const result = await fake.provider.dispatch(request(), "r1");

    assert.equal(result.verdict, "refused");
    assert.match(result.detail, /rejected the prompt.*HTTP 400/);
    assert.deepEqual(fake.paths(), [
      "POST /session",
      "POST /session/ses_1/prompt_async",
      "DELETE /session/ses_1",
    ]);
    assert.deepEqual(fake.provider.records(), []);

    fake.prompt = ok(204, null);
    assert.equal((await fake.provider.dispatch(request(), "r1")).verdict, "accepted");
  });

  it("reports a lost prompt reply as unknown, with a session to go and look at", async () => {
    // The whole argument for this provider. `provider-claude`'s `unknown` has nothing to name; this
    // one hands back a session id that observe, steer and stop all work on.
    const fake = server();
    fake.prompt = { kind: "unreachable", detail: "socket hang up" };

    const result = await fake.provider.dispatch(request(), "r1");

    assert.equal(result.verdict, "unknown");
    assert.deepEqual(result.run, { runId: "r1", provider: DEFAULT_ID, external: "ses_1" });
    assert.match(result.detail, /may or may not have started/);
    assert.match(result.detail, /watchable as session ses_1/);
    assert.equal(at(fake.provider.records(), 0).liveness, "unknown");
  });

  it("names the fields the prompt body could not carry", async () => {
    const fake = server();

    const result = await fake.provider.dispatch(request({ effort: "high", profile: "build" }), "r1");

    assert.match(result.detail, /not translated: effort=high/);
    assert.match(result.detail, /profile=build/);
  });

  it("scrubs a credential path out of whatever the server said", async () => {
    const fake = server();
    fake.session = { kind: "http", status: 500, detail: `cannot read ${AUTH_PATH}` };

    const result = await fake.provider.dispatch(request(), "r1");

    assert.equal(result.detail.includes("auth.json"), false);
    assert.match(result.detail, /<credential file>/);
  });
});

describe("the bus", () => {
  it("promotes a queued run to running, then finishes it when the session goes idle", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");

    await fake.emit({ type: "message.part.updated", properties: { part: { sessionID: "ses_1" } } });
    assert.equal((await fake.provider.observe(ref("r1"))).liveness, "running");

    await fake.emit({ type: "session.idle", properties: { sessionID: "ses_1" } });
    const done = await fake.provider.observe(ref("r1"));
    assert.equal(done.liveness, "finished");
    assert.match(done.detail, /went idle/);
  });

  it("fails a run whose session reports an error", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");

    await fake.emit({
      type: "session.error",
      properties: { sessionID: "ses_1", error: { name: "ProviderAuthError" } },
    });

    const observation = await fake.provider.observe(ref("r1"));
    assert.equal(observation.liveness, "failed");
    assert.match(observation.detail, /ProviderAuthError/);
  });

  it("ignores events for sessions it is not holding", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");

    await fake.emit({ type: "session.idle", properties: { sessionID: "somebody-elses" } });

    assert.equal(at(fake.provider.records(), 0).liveness, "queued");
  });

  it("resolves an unknown run by itself once an event arrives", async () => {
    const fake = server();
    fake.prompt = { kind: "unreachable", detail: "socket hang up" };
    await fake.provider.dispatch(request(), "r1");

    await fake.emit({ type: "message.updated", properties: { sessionID: "ses_1" } });

    assert.equal((await fake.provider.observe(ref("r1"))).liveness, "running");
  });
});

describe("observe", () => {
  it("says it has no record rather than guessing, for an unknown run or another provider's", async () => {
    const fake = server();

    const mine = await fake.provider.observe(ref("nope"));
    assert.equal(mine.liveness, "unknown");
    assert.match(mine.detail, /has no record of this run/);
    assert.match(mine.detail, /list the server's sessions before assuming otherwise/);

    const theirs = await fake.provider.observe({ runId: "r1", provider: "other", external: null });
    assert.equal(theirs.liveness, "unknown");
  });

  it("carries the artifact directory, and the run's own reference", async () => {
    const fake = server({ logDir: "/var/log/opencode" });
    await fake.provider.dispatch(request(), "r1");

    const observation = await fake.provider.observe(ref("r1"));

    assert.deepEqual(observation.artifacts, ["/var/log/opencode"]);
    assert.deepEqual(observation.run, { runId: "r1", provider: DEFAULT_ID, external: "ses_1" });
    assert.equal(observation.observedAt, "2026-01-01T00:00:00.000Z");
  });

  it("downgrades a live run to unknown when the stream is down, and says when it last knew", async () => {
    // The stale-snapshot failure, refused structurally: with the bus down the record is a photograph,
    // and rendering a photograph as current state is how a board starts lying.
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    await fake.emit({ type: "message.updated", properties: { sessionID: "ses_1" } });
    fake.stream = { kind: "unreachable", detail: "ECONNREFUSED" };
    await fake.drop();

    const observation = await fake.provider.observe(ref("r1"));

    assert.equal(observation.liveness, "unknown");
    assert.match(observation.detail, /cannot be confirmed/);
    assert.match(observation.detail, /it was running: working \(1 events\)/);
    assert.equal(fake.provider.busState().connected, false);
  });

  it("reconnects on demand, and reports plainly once it has", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    await fake.drop();
    assert.equal(fake.provider.busState().connected, false);

    const observation = await fake.provider.observe(ref("r1"));

    assert.equal(observation.liveness, "queued");
    assert.equal(fake.streamCalls.length, 2);
    assert.equal(fake.provider.busState().connected, true);
  });

  it("does not downgrade a finished run, because a fact about the past does not expire", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    await fake.emit({ type: "session.idle", properties: { sessionID: "ses_1" } });
    fake.stream = { kind: "unreachable", detail: "ECONNREFUSED" };
    await fake.drop();

    const observation = await fake.provider.observe(ref("r1"));

    assert.equal(observation.liveness, "finished");
    // And it did not spend a reconnect asking about a run that is over.
    assert.equal(fake.streamCalls.length, 1);
  });
});

describe("steer", () => {
  it("delivers a second prompt into the same session, on the run's own model", async () => {
    // Re-reading configuration here would let an interjection silently switch the model mid-run.
    const fake = server();
    await fake.provider.dispatch(request(), "r1");

    const result = await fake.provider.steer(ref("r1"), "also update the changelog");

    assert.equal(result.verdict, "delivered");
    assert.match(result.detail, /queued into session ses_1/);
    assert.deepEqual(at(fake.calls, 2).body, {
      model: { providerID: "openrouter", modelID: "z-ai/glm-5.2" },
      parts: [{ type: "text", text: "also update the changelog" }],
    });
  });

  it("refuses an empty message and a run that is over", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");

    const blank = await fake.provider.steer(ref("r1"), "   ");
    assert.equal(blank.verdict, "refused");
    assert.match(blank.detail, /blank turn/);

    await fake.emit({ type: "session.idle", properties: { sessionID: "ses_1" } });
    const late = await fake.provider.steer(ref("r1"), "one more thing");
    assert.equal(late.verdict, "refused");
    assert.match(late.detail, /the run is finished/);
  });

  it("is unknown for a run it does not hold, and for a reply that never came", async () => {
    const fake = server();
    assert.equal((await fake.provider.steer(ref("nope"), "x")).verdict, "unknown");

    await fake.provider.dispatch(request(), "r1");
    fake.prompt = { kind: "unreachable", detail: "socket hang up" };
    const lost = await fake.provider.steer(ref("r1"), "x");
    assert.equal(lost.verdict, "unknown");
    assert.match(lost.detail, /may or may not have been queued/);
  });

  it("is refused when the server read the message and said no", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    fake.prompt = { kind: "http", status: 409, detail: "session is busy" };

    const result = await fake.provider.steer(ref("r1"), "x");

    assert.equal(result.verdict, "refused");
    assert.match(result.detail, /HTTP 409/);
  });
});

describe("stop", () => {
  it("aborts the session and records the reason", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");

    const result = await fake.provider.stop(ref("r1"), "superseded by #56");

    assert.equal(result.verdict, "stopped");
    assert.match(result.detail, /aborted session ses_1: superseded by #56/);
    assert.equal(at(fake.paths(), 2), "POST /session/ses_1/abort");
    assert.equal(at(fake.provider.records(), 0).detail, "stopped: superseded by #56");
  });

  it("reports already-over when the server says there was nothing to abort", async () => {
    // The run is over either way, but it was not this call that ended it — and telemetry that says
    // otherwise is a sentence claiming we did something we did not.
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    fake.abort = ok(200, false);

    const result = await fake.provider.stop(ref("r1"), "budget");

    assert.equal(result.verdict, "already-over");
    assert.match(result.detail, /had nothing to abort/);
    const record = at(fake.provider.records(), 0);
    assert.equal(record.liveness, "finished");
    assert.equal(record.detail.startsWith("stopped:"), false);
  });

  it("is unknown when the reply is not a boolean, rather than guessing at it", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    fake.abort = ok(200, { aborted: true });

    const result = await fake.provider.stop(ref("r1"), "budget");

    assert.equal(result.verdict, "unknown");
    assert.match(result.detail, /other than a boolean/);
  });

  it("splits refused from unknown the way the transport does", async () => {
    const refusing = server();
    await refusing.provider.dispatch(request(), "r1");
    refusing.abort = { kind: "http", status: 403, detail: "not yours" };
    const refused = await refusing.provider.stop(ref("r1"), "budget");
    assert.equal(refused.verdict, "refused");
    assert.match(refused.detail, /the run may still be alive/);

    const silent = server();
    await silent.provider.dispatch(request(), "r1");
    silent.abort = { kind: "unreachable", detail: "socket hang up" };
    assert.equal((await silent.provider.stop(ref("r1"), "budget")).verdict, "unknown");
  });

  it("is already-over for a run that has finished, and unknown for one it never had", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    await fake.emit({ type: "session.idle", properties: { sessionID: "ses_1" } });

    const result = await fake.provider.stop(ref("r1"), "too late");
    assert.equal(result.verdict, "already-over");
    assert.equal(fake.paths().includes("POST /session/ses_1/abort"), false);

    assert.equal((await fake.provider.stop(ref("nope"), "x")).verdict, "unknown");
  });

  it("makes a stop in flight read the session disappearing as success", async () => {
    // Identical event, opposite meaning, and the difference is whether somebody asked. Without it,
    // every successful cancellation lands on the board as a failed run.
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    fake.abort = { kind: "unreachable", detail: "socket hang up" };
    assert.equal((await fake.provider.stop(ref("r1"), "budget")).verdict, "unknown");

    await fake.emit({ type: "session.deleted", properties: { id: "ses_1" } });

    const record = at(fake.provider.records(), 0);
    assert.equal(record.liveness, "finished");
    assert.equal(record.detail, "stopped: budget");
  });
});

describe("timeouts", () => {
  it("stops a run that outlives the deadline it was dispatched with", async () => {
    const fake = server();

    await fake.provider.dispatch(request({ timeout: "1ms" }), "r1");
    await until(() => fake.paths().includes("POST /session/ses_1/abort"), "the abort");

    assert.equal(at(fake.provider.records(), 0).detail, "stopped: timeout after 1ms");
  });

  it("does not arm one for a dispatch that named no deadline", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    assert.equal(fake.paths().includes("POST /session/ses_1/abort"), false);
  });
});

describe("shutdown", () => {
  it("closes the stream and leaves the runs alone", async () => {
    // Runs here belong to a server that outlives this process. Reaping them on the way out would turn
    // every coordinator restart into an outage.
    const fake = server();
    await fake.provider.dispatch(request(), "r1");

    await fake.provider.shutdown();

    assert.equal(fake.provider.busState().connected, false);
    assert.match(fake.provider.busState().detail, /shut down/);
    assert.equal(fake.paths().includes("POST /session/ses_1/abort"), false);
    assert.equal(at(fake.provider.records(), 0).liveness, "queued");
  });
});

describe("createProvider", () => {
  it("takes the configured id, and defaults to one a RunRef can carry", () => {
    assert.equal(server().provider.id, DEFAULT_ID);
    const named = new OpencodeProvider({
      http: async () => ok(200, null),
      stream: async () => ({ kind: "unreachable", detail: "unused" }),
      id: "opencode-n5air",
    });
    assert.equal(named.id, "opencode-n5air");
    assert.deepEqual(conformanceProblems(named), []);
  });
});
