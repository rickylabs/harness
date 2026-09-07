import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSwarm, renderSwarm, toDispatchRequest, type DispatchRequest, type Harness } from "./dispatch.js";
import {
  CONTEXT_KEY,
  capabilityProblem,
  conformanceProblems,
  instrumentedBy,
  isInstrumented,
  isRouteVerified,
  isSafeToRetry,
  markInstrumented,
  registryProblems,
  retryGuidance,
  selectProvider,
  type DispatchResult,
  type Observation,
  type ProviderCapabilities,
  type RunRef,
  type SteerResult,
  type StopResult,
  type SubagentProvider,
} from "./provider.js";

const REQUEST: DispatchRequest = {
  harness: "claude",
  model: "opus-5",
  effort: "medium",
  prompt: "Read packages/subagents/src/provider.ts and report what it does not cover.",
};

/**
 * A provider that records what it was asked and answers whatever the test wants.
 *
 * Deliberately not a mock framework: the point of these tests is that the contract can be
 * satisfied by a plain object, because two of the four real implementations have no SDK to wrap.
 *
 * This is the *raw* one — what a provider package produces before anything wraps it. Most tests
 * want `provider` below, which is this plus the instrumentation mark, because a raw provider cannot
 * be selected at all.
 */
function raw(
  id: string,
  capabilities: Partial<ProviderCapabilities> = {},
  answers: Partial<{
    dispatch: DispatchResult;
    observe: Observation;
    steer: SteerResult;
    stop: StopResult;
  }> = {},
): SubagentProvider {
  const declared: ProviderCapabilities = {
    harnesses: capabilities.harnesses ?? (["claude"] as readonly Harness[]),
    observe: capabilities.observe ?? true,
    steer: capabilities.steer ?? true,
    stop: capabilities.stop ?? true,
  };
  const ref: RunRef = { runId: "r1", provider: id, external: null };
  return {
    id,
    capabilities: declared,
    dispatch: async (_request, runId) =>
      answers.dispatch ?? { verdict: "accepted", run: { ...ref, runId }, detail: "launched" },
    observe: async (run) =>
      answers.observe ?? {
        run,
        liveness: "running",
        observedAt: "2026-09-05T00:00:00.000Z",
        detail: "alive",
        artifacts: [],
      },
    steer: async () => answers.steer ?? { verdict: "delivered", detail: "sent" },
    stop: async () => answers.stop ?? { verdict: "stopped", detail: "ended" },
  };
}

/** The same provider, wrapped — which in these tests means marked, since there is no sink here. */
const provider = (...supplied: Parameters<typeof raw>): SubagentProvider =>
  markInstrumented(raw(...supplied), "provider.test");

describe("isSafeToRetry", () => {
  it("permits a retry only after an explicit refusal", () => {
    assert.equal(isSafeToRetry({ verdict: "refused", run: null, detail: "quota exhausted" }), true);
  });

  it("refuses to retry an unknown dispatch, because the run may already exist", () => {
    // The reason this rule is load-bearing: divybot polls on a 30s cycle, so a dispatch whose
    // confirmation was lost in flight can be running before anybody asks again. Retrying it puts
    // two agents on one branch, which is not a degraded outcome — it is a corrupted one, and it
    // stays invisible until their commits interleave.
    assert.equal(isSafeToRetry({ verdict: "unknown", run: null, detail: "connection reset" }), false);
  });

  it("does not retry a success", () => {
    const run: RunRef = { runId: "r1", provider: "p", external: "42" };
    assert.equal(isSafeToRetry({ verdict: "accepted", run, detail: "launched" }), false);
  });

  it("gives every verdict guidance that names the risk", () => {
    assert.match(retryGuidance({ verdict: "accepted", run: null, detail: "" }), /nothing to retry/);
    assert.match(retryGuidance({ verdict: "refused", run: null, detail: "" }), /nothing launched/);
    const unknown = retryGuidance({ verdict: "unknown", run: null, detail: "" });
    assert.match(unknown, /do not retry/);
    assert.match(unknown, /observe first/);
  });
});

describe("isRouteVerified", () => {
  it("treats legacy accepted results without evidence as unverified", () => {
    assert.equal(
      isRouteVerified({ verdict: "accepted", run: null, detail: "legacy provider" }),
      false,
    );
  });

  it("requires accepted plus complete matching evidence", async () => {
    const { compareRouteIdentity } = await import("./route.js");
    const route = compareRouteIdentity(
      { provider: "openai", model: "gpt-test", effort: "medium", cwd: "/work" },
      { provider: "openai", model: "gpt-test", effort: "medium", cwd: "/work" },
    );
    assert.equal(isRouteVerified({ verdict: "accepted", run: null, detail: "ok", route }), true);
    assert.equal(isRouteVerified({ verdict: "unknown", run: null, detail: "lost", route }), false);

    const contradictory = {
      ...route,
      observed: {
        ...route.observed,
        effort: { ...route.observed.effort, value: "high" },
      },
    };
    assert.equal(
      isRouteVerified({ verdict: "accepted", run: null, detail: "fabricated", route: contradictory }),
      false,
    );
  });
});

describe("capabilityProblem", () => {
  it("says nothing when the provider declares the call", () => {
    const p = provider("claude-cli");
    assert.equal(capabilityProblem(p, "observe"), null);
    assert.equal(capabilityProblem(p, "steer"), null);
    assert.equal(capabilityProblem(p, "stop"), null);
  });

  it("names the provider and the consequence when it does not", () => {
    // divybot dispatches by writing an issue comment. There is no channel back into a running
    // agent, and a contract that made `steer` throw would leave the caller reading messages to
    // tell "cannot" from "is down".
    const divybot = provider("divybot", { steer: false, stop: false });
    assert.equal(capabilityProblem(divybot, "steer"), "divybot cannot steer a run in flight — the message would go nowhere");
    assert.match(String(capabilityProblem(divybot, "stop")), /^divybot cannot stop a run/);
    assert.equal(capabilityProblem(divybot, "observe"), null);
  });
});

describe("selectProvider", () => {
  it("picks the one provider that declares the harness", () => {
    const registry = {
      providers: [provider("codex-cli", { harnesses: ["codex"] }), provider("claude-cli", { harnesses: ["claude"] })],
    };
    const selection = selectProvider(registry, REQUEST);
    assert.equal(selection.selected, true);
    assert.equal(selection.selected && selection.provider.id, "claude-cli");
  });

  it("records why each passed-over provider was passed over", () => {
    const registry = {
      providers: [provider("codex-cli", { harnesses: ["codex"] }), provider("claude-cli", { harnesses: ["claude"] })],
    };
    const selection = selectProvider(registry, REQUEST);
    assert.deepEqual(
      selection.rejected.map((rejection) => [rejection.provider, rejection.rule]),
      [["codex-cli", "wrong-harness"]],
    );
    assert.match(String(selection.rejected[0]?.detail), /cannot launch claude \(declares codex\)/);
  });

  it("never selects a provider that cannot launch the harness", () => {
    // The failure this prevents is the one divybot already has on the other side: an unknown
    // harness silently becomes claude, so the run is not what the record says it is.
    const registry = { providers: [provider("codex-cli", { harnesses: ["codex"] })] };
    const selection = selectProvider(registry, REQUEST);
    assert.equal(selection.selected, false);
    assert.equal(selection.selected === false && selection.rule, "no-candidate");
    assert.match(selection.selected === false ? selection.detail : "", /no registered provider can launch claude/);
  });

  it("passes over a blind provider for a supervised dispatch", () => {
    const registry = { providers: [provider("fire-and-forget", { observe: false })] };
    const selection = selectProvider(registry, REQUEST);
    assert.equal(selection.selected, false);
    assert.deepEqual(
      selection.rejected.map((rejection) => rejection.rule),
      ["cannot-observe"],
    );
  });

  it("accepts a blind provider when the caller writes down that it is unsupervised", () => {
    const registry = { providers: [provider("fire-and-forget", { observe: false })] };
    const selection = selectProvider(registry, REQUEST, { supervised: false });
    assert.equal(selection.selected, true);
  });

  it("supervises by default", () => {
    const registry = { providers: [provider("fire-and-forget", { observe: false })] };
    // Stated as its own test because the default is the argument: this project exists because the
    // owner had to ask an orchestrator "status ?" to find out what was happening.
    assert.equal(selectProvider(registry, REQUEST, {}).selected, false);
    assert.equal(selectProvider(registry, REQUEST).selected, false);
  });

  it("refuses the whole selection when two providers share an id", () => {
    const registry = { providers: [provider("claude-cli"), provider("claude-cli")] };
    const selection = selectProvider(registry, REQUEST);
    assert.equal(selection.selected, false);
    assert.equal(selection.selected === false && selection.rule, "duplicate-id");
    // Not a tiebreak: RunRef.provider is how a later observe or stop finds its executor, so an
    // ambiguous id can route a stop to the wrong run.
    assert.match(selection.selected === false ? selection.detail : "", /would not identify one executor/);
  });

  it("distinguishes an empty registry from one that has no candidate", () => {
    // Two different operator problems: nothing was composed, versus nothing composed can do this.
    const selection = selectProvider({ providers: [] }, REQUEST);
    assert.equal(selection.selected, false);
    assert.equal(selection.selected === false && selection.rule, "no-providers");
  });

  it("refuses a request that would not dispatch faithfully, before choosing anything", () => {
    const registry = { providers: [provider("claude-cli")] };
    const selection = selectProvider(registry, { ...REQUEST, prompt: "" });
    assert.equal(selection.selected, false);
    assert.equal(selection.selected === false && selection.rule, "invalid-request");
    assert.match(selection.selected === false ? selection.detail : "", /empty prompt/);
  });

  it("reuses the wire validator rather than paraphrasing it", () => {
    // A fence in the prompt is the truncation hazard: divybot's parser stops at the first line
    // whose trimmed form starts with a fence, so everything after it is discarded in silence.
    // If this seam had its own laxer check, a brief refused on the /swarm path would be accepted
    // here — and the two are supposed to be two encodings of one request.
    const registry = { providers: [provider("claude-cli")] };
    const fenced = selectProvider(registry, { ...REQUEST, prompt: "do this:\n```\ncode\n```" });
    assert.equal(fenced.selected, false);
    assert.equal(fenced.selected === false && fenced.rule, "invalid-request");
  });

  it("breaks ties by registration order and says so", () => {
    const registry = { providers: [provider("first"), provider("second")] };
    const selection = selectProvider(registry, REQUEST);
    assert.equal(selection.selected && selection.provider.id, "first");
    assert.deepEqual(
      selection.rejected.map((rejection) => [rejection.provider, rejection.rule]),
      [["second", "not-preferred"]],
    );
  });
});

/**
 * The rule these pin: a run that nothing can account for afterwards does not get to start.
 *
 * `plugins/subagents.ts` claimed this already, from the fact that it wraps the registry it builds.
 * It does not follow. `SubagentRegistry.providers` is readonly, so a provider package registers by
 * handing over a *new* registry, and that path never passes through the wrapper — the guarantee was
 * true of the empty registry and of nothing that would ever run. See #208.
 */
describe("selectProvider, on a registry the wrapper never reached", () => {
  it("refuses a raw provider rather than dispatching through it", () => {
    const selection = selectProvider({ providers: [raw("claude-cli")] }, REQUEST);
    assert.equal(selection.selected, false);
    assert.equal(selection.selected === false && selection.rule, "uninstrumented");
    assert.match(
      selection.selected === false ? selection.detail : "",
      /claude-cli reached the registry without being wrapped/,
    );
  });

  it("refuses before the provider is invoked, not after", async () => {
    // The half of the guarantee that a post-hoc audit cannot give you. By the time an uninstrumented
    // dispatch could be noticed in a log, the agent is already running on a branch.
    const seat = raw("claude-cli");
    let launched = false;
    const watched: SubagentProvider = {
      ...seat,
      dispatch: async (request, runId) => {
        launched = true;
        return seat.dispatch(request, runId);
      },
    };
    // Dispatch through whatever came back *before* asserting anything, so the assertion below is
    // about what actually ran rather than about what the test decided to attempt.
    const selection = selectProvider({ providers: [watched] }, REQUEST);
    if (selection.selected) await selection.provider.dispatch(REQUEST, "run-1");
    assert.equal(selection.selected, false);
    assert.equal(launched, false);
  });

  it("refuses the whole selection when only one of several is raw", () => {
    // Not "pass over the raw one and dispatch through the wrapped one". A half-wired registry is a
    // wiring defect, and the raw provider stays reachable by anything iterating `providers` itself;
    // succeeding here would hide the defect until the run that landed on it.
    const registry = { providers: [provider("claude-cli"), raw("codex-cli", { harnesses: ["codex"] })] };
    const selection = selectProvider(registry, REQUEST);
    assert.equal(selection.selected, false);
    assert.equal(selection.selected === false && selection.rule, "uninstrumented");
    assert.deepEqual(
      selection.rejected.map((rejection) => [rejection.provider, rejection.rule]),
      [["codex-cli", "uninstrumented"]],
    );
  });

  it("names every raw provider, so a fix does not have to be found one boot at a time", () => {
    const registry = { providers: [raw("a"), raw("b"), raw("c")] };
    const selection = selectProvider(registry, REQUEST);
    assert.deepEqual(
      selection.rejected.map((rejection) => rejection.provider),
      ["a", "b", "c"],
    );
  });

  it("still reports an ambiguous id first, because the names in the refusal have to mean something", () => {
    // A duplicate id makes "provider a is uninstrumented" a sentence about two different objects.
    const registry = { providers: [raw("claude-cli"), raw("claude-cli")] };
    assert.equal(selectProvider(registry, REQUEST).selected === false, true);
    const selection = selectProvider(registry, REQUEST);
    assert.equal(selection.selected === false && selection.rule, "duplicate-id");
  });

  it("reports it at boot too, as a fatal registry problem", () => {
    const found = registryProblems({ providers: [raw("claude-cli")] });
    assert.deepEqual(
      found.map((problem) => [problem.rule, problem.fatal]),
      [["uninstrumented", true]],
    );
    // Fatal, not diminished: this registry refuses every dispatch, and "usable but worse" would be
    // a description of some other seam.
    assert.deepEqual(registryProblems({ providers: [provider("claude-cli")] }), []);
  });
});

describe("markInstrumented", () => {
  it("marks the object it was given, and says what marked it", () => {
    const seat = raw("claude-cli");
    assert.equal(isInstrumented(seat), false);
    assert.equal(instrumentedBy(seat), null);
    assert.equal(markInstrumented(seat, "wrapper-a"), seat);
    assert.equal(instrumentedBy(seat), "wrapper-a");
  });

  it("does not leak into what a provider serialises or a caller enumerates", () => {
    // A mark that showed up in `Object.keys` or `JSON.stringify` would eventually be copied by
    // something reconstructing a provider from a record, and a copy is exactly what is not wrapped.
    const seat = markInstrumented(raw("claude-cli"), "wrapper-a");
    assert.deepEqual(Object.keys(seat).sort(), ["capabilities", "dispatch", "id", "observe", "steer", "stop"]);
    const descriptor = Object.getOwnPropertyDescriptor(seat, Symbol.for("@rickylabs/subagents.instrumented"));
    assert.equal(descriptor?.enumerable, false);
    assert.equal(descriptor?.writable, false);
  });

  it("is idempotent for the same wrapper and refuses a second one", () => {
    // Two wrappers is not belt and braces. Each writes its own events, so the log reports every
    // dispatch twice and no reader can tell the duplicate from a genuine retry.
    const seat = markInstrumented(raw("claude-cli"), "wrapper-a");
    assert.equal(markInstrumented(seat, "wrapper-a"), seat);
    assert.throws(() => markInstrumented(seat, "wrapper-b"), /already marked as instrumented by wrapper-a/);
  });

  it("refuses to be marked by nothing in particular", () => {
    assert.throws(() => markInstrumented(raw("claude-cli"), ""), /not an empty string/);
  });

  it("does not carry across a copy of the provider", () => {
    // Fails closed, and correctly: a spread copies the wrapped verbs today, but nothing makes that
    // stay true, and a mark that survived arbitrary reconstruction would be a mark that proves
    // nothing. What this rules out is a raw provider inheriting a claim it has no basis for.
    const seat = markInstrumented(raw("claude-cli"), "wrapper-a");
    assert.equal(isInstrumented({ ...seat }), false);
  });
});

describe("conformanceProblems", () => {
  it("passes a well-formed provider", () => {
    assert.deepEqual(conformanceProblems(provider("claude-cli")), []);
  });

  it("fails a provider that launches nothing", () => {
    const found = conformanceProblems(provider("empty", { harnesses: [] }));
    assert.deepEqual(
      found.filter((problem) => problem.fatal).map((problem) => problem.rule),
      ["no-harnesses"],
    );
  });

  it("fails an id that cannot appear verbatim in a run reference", () => {
    for (const id of ["", "Claude CLI", "claude_cli", "1st"]) {
      const found = conformanceProblems(provider(id));
      assert.equal(
        found.some((problem) => problem.fatal),
        true,
        `${JSON.stringify(id)} should not pass`,
      );
    }
  });

  it("reports a blind or unstoppable provider without failing it", () => {
    // divybot is genuinely both. Saying so is the contract working, not the provider being wrong.
    const found = conformanceProblems(provider("divybot", { observe: false, stop: false }));
    assert.deepEqual(
      found.map((problem) => [problem.rule, problem.fatal]),
      [
        ["blind", false],
        ["unstoppable", false],
      ],
    );
  });

  it("reports a duplicated id as fatal at the registry level", () => {
    const found = registryProblems({ providers: [provider("claude-cli"), provider("claude-cli")] });
    assert.equal(
      found.some((problem) => problem.fatal && problem.rule === "unusable-id"),
      true,
    );
  });
});

describe("the seam and the wire agree", () => {
  it("round-trips a selected request through a /swarm block without loss", () => {
    // Acceptance item 3 on #51, stated where it matters: the same request that this seam selects
    // a provider for is the one #37's strangler-fig writes into an issue body.
    const registry = { providers: [provider("claude-cli")] };
    const selection = selectProvider(registry, REQUEST);
    assert.equal(selection.selected, true);

    const block = renderSwarm(REQUEST);
    const parsed = parseSwarm(block);
    assert.notEqual(parsed, null);
    assert.deepEqual(toDispatchRequest(parsed!), REQUEST);
    assert.equal(renderSwarm(toDispatchRequest(parsed!)), block);
  });

  it("names the context key once, so the four provider packages cannot drift", () => {
    assert.equal(CONTEXT_KEY, "subagents");
  });
});

describe("a provider is satisfiable by a plain object", () => {
  it("dispatches, observes, steers and stops", async () => {
    const p = provider("claude-cli");
    const dispatched = await p.dispatch(REQUEST, "run-51");
    assert.equal(dispatched.verdict, "accepted");
    assert.equal(dispatched.run?.runId, "run-51");
    assert.equal(dispatched.run?.provider, "claude-cli");

    const observed = await p.observe(dispatched.run!);
    assert.equal(observed.liveness, "running");
    assert.equal(observed.run.runId, "run-51");

    assert.equal((await p.steer(dispatched.run!, "narrow the scope")).verdict, "delivered");
    assert.equal((await p.stop(dispatched.run!, "superseded")).verdict, "stopped");
  });

  it("carries a run the caller can key on even when the executor has no id of its own", async () => {
    // divybot's case: the issue number does not exist at dispatch time, and inventing one would
    // produce an id that joins to nothing in telemetry.
    const p = provider("divybot", { steer: false, stop: false });
    const dispatched = await p.dispatch(REQUEST, "run-51");
    assert.equal(dispatched.run?.external, null);
    assert.equal(dispatched.run?.runId, "run-51");
  });
});
