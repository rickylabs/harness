/**
 * Dispatch, against a fake server behind the real SDK adapter: the order of the calls, every refusal
 * that costs nothing, and every `unknown` that costs a retry.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { conformanceProblems } from "@rickylabs/subagents";

import { CAPABILITIES, DEFAULT_ID } from "../../src/application/options.js";
import { at, ok, request, server, text, unreachable, AUTH_PATH } from "../fixtures/provider.js";

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
    assert.equal(body.title, "harness r1");
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
    fake.stream = unreachable("ECONNREFUSED");

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

  it("refuses the second of two dispatches racing on one run id", async () => {
    // What the reservation is for. The duplicate check asks whether the id is taken; if the answer is
    // only written after `POST /session` has returned, two callers that both asked during that gap
    // are both told the id is free — and two agents launch under one id, which is precisely what
    // refusing a duplicate exists to prevent. Sequentially the check already worked; the failure only
    // appears when the second caller arrives inside the first one's awaits.
    const fake = server();

    const results = await Promise.all([
      fake.provider.dispatch(request(), "r1"),
      fake.provider.dispatch(request(), "r1"),
    ]);

    assert.deepEqual(
      results.map((result) => result.verdict).sort(),
      ["accepted", "refused"],
    );
    const refusal = results.find((result) => result.verdict === "refused");
    assert.match(refusal?.detail ?? "", /already dispatched here/);
    assert.equal(fake.paths().filter((path) => path === "POST /session").length, 1);
    assert.equal(fake.provider.records().length, 1);
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
    answeredNo.session = text(429, "too many sessions");
    const refusal = await answeredNo.provider.dispatch(request(), "r1");
    assert.equal(refusal.verdict, "refused");
    assert.match(refusal.detail, /so nothing was launched/);

    // Still `refused`, not `unknown`: an unprompted session is inert, so the worst case is litter and
    // a retry cannot put a second agent anywhere.
    const silent = server();
    silent.session = unreachable("socket hang up");
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
    fake.prompt = text(400, "unknown model");

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

  it("does not read a 504 on the prompt as a refusal, because the agent may be running", async () => {
    // The counterpart to the test above, and the more expensive of the two to get wrong. A `504` is
    // an intermediary saying it stopped waiting — the exact shape of *the agent started and the
    // gateway gave up on it*. Calling that `refused` licenses `isSafeToRetry`, and the retry puts a
    // second agent on a branch the first one is still holding. So the verdict is `unknown`, the run
    // is kept, and the session is left alone rather than deleted out from under live work.
    const fake = server();
    fake.prompt = text(504, "gateway timeout");

    const result = await fake.provider.dispatch(request(), "r1");

    assert.equal(result.verdict, "unknown");
    assert.match(result.detail, /may or may not have started/);
    assert.match(result.detail, /watchable as session ses_1/);
    assert.deepEqual(fake.paths(), ["POST /session", "POST /session/ses_1/prompt_async"]);
    assert.equal(at(fake.provider.records(), 0).liveness, "unknown");
  });

  it("reports a lost prompt reply as unknown, with a session to go and look at", async () => {
    // The whole argument for this provider. `provider-claude`'s `unknown` has nothing to name; this
    // one hands back a session id that observe, steer and stop all work on.
    const fake = server();
    fake.prompt = unreachable("socket hang up");

    const result = await fake.provider.dispatch(request(), "r1");

    assert.equal(result.verdict, "unknown");
    assert.deepEqual(result.run, { runId: "r1", provider: DEFAULT_ID, external: "ses_1" });
    assert.match(result.detail, /may or may not have started/);
    assert.match(result.detail, /watchable as session ses_1/);
    assert.equal(at(fake.provider.records(), 0).liveness, "unknown");
  });

  it("does not let a late prompt reply reset a run the bus has already finished", async () => {
    // The two sources disagree and the bus wins. A real server starts the agent and *then* answers,
    // so a `204` can still be on the wire after the session has run and gone idle. Writing `queued`
    // on top of that reports an ended run as one that has not begun — a coordinator polling for a
    // free slot would never see it end.
    const fake = server();
    fake.onPrompt = async (): Promise<void> => {
      await fake.emit({ type: "session.idle", properties: { sessionID: "ses_1" } });
    };

    const result = await fake.provider.dispatch(request(), "r1");

    assert.equal(result.verdict, "accepted");
    assert.match(result.detail, /the bus already reports it finished/);
    assert.equal(at(fake.provider.records(), 0).liveness, "finished");
  });

  it("accepts a run whose prompt reply was lost but whose session has been seen working", async () => {
    // `unknown` is for a launch nobody watched. This one was watched: the reply died on the way back,
    // and in the meantime the bus reported the session doing the work. A launch that has been *seen*
    // is `accepted`, however badly the request that caused it ended.
    const fake = server();
    fake.prompt = unreachable("socket hang up");
    fake.onPrompt = async (): Promise<void> => {
      await fake.emit({ type: "message.updated", properties: { sessionID: "ses_1" } });
    };

    const result = await fake.provider.dispatch(request(), "r1");

    assert.equal(result.verdict, "accepted");
    assert.match(result.detail, /has since reported activity/);
    assert.equal(at(fake.provider.records(), 0).liveness, "running");
  });

  it("names the fields the prompt body could not carry", async () => {
    const fake = server();

    const result = await fake.provider.dispatch(request({ effort: "high", profile: "build" }), "r1");

    assert.match(result.detail, /not translated: effort=high/);
    assert.match(result.detail, /profile=build/);
  });

  it("scrubs a credential path out of whatever the server said", async () => {
    const fake = server();
    fake.session = text(500, `cannot read ${AUTH_PATH}`);

    const result = await fake.provider.dispatch(request(), "r1");

    assert.equal(result.detail.includes("auth.json"), false);
    assert.match(result.detail, /<credential file>/);
  });
});

