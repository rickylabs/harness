/**
 * The provider's dispatch, driven against a fake `query()`: what it declares, what it refuses, how
 * it launches, and where it must say `unknown`.
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
  markInstrumented,
  selectProvider,
  type RunRef,
} from "@rickylabs/subagents";

import { CONFIG_DIR_VAR } from "../../src/domain/env.js";
import { DEFAULT_ID } from "../../src/application/provider.js";
import {
  awake,
  fakeSdk,
  first,
  makeProvider,
  running,
  settle,
  BARE,
  CONFIG_DIR,
  INIT,
  REQUEST,
} from "./support.js";

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

  it("is the provider a claude dispatch selects, once something has wrapped it", () => {
    // Both halves in one test, because the interesting one is the first. What this package produces
    // is a *raw* provider, and a raw provider is refused: instrumentation is the composition root's
    // job, and a seam that dispatched through an unwrapped provider would run an agent no log could
    // account for. Registration is what supplies the wrapper; there is none in this package's tests,
    // so `markInstrumented` stands in for one. See #208.
    const provider = makeProvider(fakeSdk().query);
    const unwrapped = selectProvider({ providers: [provider] }, REQUEST);
    assert.equal(unwrapped.selected, false);
    assert.equal(unwrapped.selected === false && unwrapped.rule, "uninstrumented");

    const selection = selectProvider({ providers: [markInstrumented(provider, "provider.test")] }, REQUEST);
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
    const provider = makeProvider(fakeSdk().query, { configDir: "/fixture/user" });
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
    assert.equal(run.external, "ses_test_0001");
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
    assert.match(result.detail, /session ses_test_0001/);
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
    assert.equal(env["HOME"], "/fixture/user");
    assert.equal(env["USERPROFILE"], "C:\\fixture\\user");
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
    const stranger: RunRef = { runId: "run-9", provider: DEFAULT_ID, external: "ses_test_0009" };
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

