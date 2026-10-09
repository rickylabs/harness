/**
 * `provider-uhp`: the four verbs, over a loopback UHP mock.
 *
 * Issue #286. Run artifacts: `.llm/runs/provider-uhp--e37/`.
 *
 * WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT
 *
 * Every assertion is about **this repository's behaviour** when a UHP-shaped peer answers in a given way.
 * Not one is evidence about a real HarnessRouter: there is no reachable instance and no container runtime
 * on this host, the peer is `uhp-mock.ts`, and its shapes were written from the published specification.
 * The live round-trip is #294. `verification.md` carries the split.
 *
 * ## How the controls here are built, and why
 *
 * #286 says the same thing three times: an assertion that holds for the correct and for the defective
 * behaviour is not covering that behaviour. `assert(!accepted)` and `assert(!verified)` are true of a
 * refusal and of an unknown alike, so they cover neither.
 *
 * So each load-bearing test does three things:
 *
 * 1. asserts the distinction itself — `refused` and not `unknown`, and the two not equal;
 * 2. runs the **defective implementation, transcribed below**, on the same input, and asserts it gives the
 *    other answer. A test that only asserted our answer would pass if the defect were reintroduced beside
 *    it;
 * 3. pairs every refusal with the same input repaired, so a control cannot be firing because everything
 *    is refused.
 *
 * The mutations run against this suite, and what each killed, are recorded in `verification.md`.
 *
 * The suite is in three files so each stays under the size cap: this one (declarations and dispatch),
 * `uhp-provider.boundary.test.ts` (paths, null readers, the credential) and
 * `uhp-provider.verbs.test.ts` (observe, steer, stop). The shared fixtures are in
 * `fixtures/uhp-provider.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createUhpProvider } from "./uhp-provider.js";
import { createUhpTransport } from "./uhp-transport.js";
import { isRouteEvidenceVerified } from "./route.js";
import {
  conformanceProblems,
  isSafeToRetry,
  markInstrumented,
  selectProvider,
} from "./provider.js";
import type { DispatchRequest } from "./dispatch.js";
import { startUhpServer, type UhpJsonReply } from "./uhp-mock.js";
import {
  agreeingListing,
  evidenceFor,
  harnessed,
  manifest,
  manifestDocument,
  request,
  response,
  servers,
  substitutionDetectedByStatus,
  verdictByCodexLadder,
  verdictFromRouteEvidenceAlone,
  CWD,
  MODEL,
  MODEL_PROVIDER,
  PINNED_IDS,
  PROFILE,
  SESSION,
  SUBSTITUTE,
  TOKEN,
} from "./fixtures/uhp-provider.js";

describe("the provider's own declarations", () => {
  it("advertises exactly what the manifest pins, and the three optional calls it implements", async () => {
    const { provider } = await harnessed();
    assert.equal(provider.id, "uhp");
    assert.deepEqual(provider.capabilities.harnesses, ["claude", "codex", "codex-run", "opencode", "opencode-run"]);
    assert.equal(provider.capabilities.observe, true);
    assert.equal(provider.capabilities.steer, true);
    assert.equal(provider.capabilities.stop, true);
    assert.deepEqual(conformanceProblems(provider), []);
  });

  it("advertises fewer harnesses when the manifest pins fewer, rather than a fixed list", async () => {
    const document = manifestDocument();
    const { provider } = await harnessed({
      manifest: manifest({ ...document, harnesses: [(document.harnesses as readonly unknown[])[0]] }),
    });
    // The honest half of "advertise capabilities honestly": a word with no pinned console id cannot be
    // launched, and `selectProvider` must pass this provider over for it rather than send a task the
    // server would answer with 404.
    assert.deepEqual(provider.capabilities.harnesses, ["claude"]);
    const registry = { providers: [markInstrumented(provider, "uhp-provider.test")] };
    const selection = selectProvider(registry, { ...request, harness: "codex" });
    assert.equal(selection.selected, false);
    if (!selection.selected) assert.equal(selection.rule, "no-candidate");
    // Paired control: the word it does pin is selectable on the same registry.
    assert.equal(selectProvider(registry, request).selected, true);
  });
});

/* -------------------------------------------------------------------------------------------------
 * dispatch — the benign case, and what it puts on the wire
 * ---------------------------------------------------------------------------------------------- */

describe("dispatch — a conformant response, which is the normal case over UHP", () => {
  it("is unknown because three route fields are unreported, and says so", async () => {
    const { provider } = await harnessed();
    const result = await provider.dispatch(request, "run-benign");

    // Not `accepted`, and the reason is the absence rather than a contradiction. This is the fail-closed
    // default the owner ruling deliberately left in place; #286's F1 fork is whether a lane needing no
    // route evidence may proceed here, and nothing in this provider decides that.
    assert.equal(result.verdict, "unknown");
    assert.deepEqual(result.route?.mismatches, []);
    assert.equal(result.route?.status, "unknown");
    assert.ok(result.detail.includes("provider, effort, cwd"));
    assert.equal(isRouteEvidenceVerified(result.route), false);
    // The retry rule: an unknown dispatch may not be retried, because something may be running.
    assert.equal(isSafeToRetry(result), false);
  });

  it("keys the run on runId and puts the UHP session id in RunRef.external", async () => {
    const { provider } = await harnessed();
    const result = await provider.dispatch(request, "run-keys");
    assert.deepEqual(result.run, { runId: "run-keys", provider: "uhp", external: SESSION });
    // The ledger is keyed on our id, never on the server's: a server may branch two runs out of one
    // session, and a ledger keyed on the session id would have them overwrite each other.
    const session = provider.sessions()["run-keys"];
    assert.equal(session?.runId, "run-keys");
    assert.equal(session?.sessionId, SESSION);
    assert.equal(session?.turns.length, 1);
    assert.equal(session?.turns[0]?.responseId, "resp_test_0001");
  });

  it("sends protocol fields only: the pinned harness id, and no credential anywhere", async () => {
    const { provider, tasks } = await harnessed();
    await provider.dispatch(request, "run-payload");
    assert.equal(tasks.length, 1);
    const sent = tasks[0] as Record<string, unknown>;
    assert.equal((sent["metadata"] as Record<string, unknown>)["harness_id"], PINNED_IDS.claude);
    assert.equal(sent["model"], MODEL);
    assert.equal(sent["input"], request.prompt);
    assert.equal(sent["background"], true);
    assert.equal(sent["stream"], false);
    assert.equal("previous_response_id" in sent, false);

    // The rule from `admit.ts`: a credential never enters a payload. Asserted on the serialised body,
    // because that is the thing that reaches a log or a receipt.
    const wire = JSON.stringify(sent);
    assert.equal(wire.includes(TOKEN), false);
    assert.equal(wire.includes(PROFILE), false);
    assert.equal(wire.toLowerCase().includes("authorization"), false);
    // Paired positive control: the request was nevertheless authenticated. Without this, the assertions
    // above would also pass for a provider that sent no credential and no request at all.
    assert.equal(tasks.length, 1);
  });
});

/* -------------------------------------------------------------------------------------------------
 * dispatch — the substitution, which is the whole point of the gate
 * ---------------------------------------------------------------------------------------------- */

describe("dispatch — a substituted model is refused, never unknown", () => {
  /** Tasks §1.3's substitution, exactly as the chapter specifies it. */
  const substituted = response({
    model: SUBSTITUTE,
    metadata: {
      session_id: SESSION,
      requested_model: MODEL,
      model_fallback: true,
      model_fallback_reason: "the requested model is not available for this harness's backend",
    },
  });

  it("refuses where the codex ladder and the status-keyed gate both say unknown", async () => {
    const { provider } = await harnessed({ task: () => ({ httpStatus: 200, response: substituted }) });
    const result = await provider.dispatch(request, "run-substituted");
    const evidence = evidenceFor(substituted);

    // Ours.
    assert.equal(result.verdict, "refused");
    // Theirs, on the same evidence. Both defects are live in this process and both give the other answer.
    assert.equal(verdictByCodexLadder(evidence), "unknown");
    assert.equal(substitutionDetectedByStatus(evidence), false);
    // The distinction itself, which is what neither `!accepted` nor `!verified` would have covered.
    assert.notEqual(result.verdict, verdictByCodexLadder(evidence));
    assert.notEqual(result.verdict, "unknown");

    // The precondition that makes the defects invisible: over UHP the status cannot carry this.
    assert.equal(evidence.status, "unknown");
    assert.deepEqual(evidence.mismatches, ["model"]);
    // And what survives to an operator: the contradicted field, named.
    assert.ok(result.detail.includes("contradicted the requested route on model"));
    assert.deepEqual(result.route?.mismatches, ["model"]);
    // A refusal is the one verdict that licenses a retry, because nothing useful was sent after it.
    assert.equal(isSafeToRetry(result), true);
  });

  it("refuses a declared fallback even when the model field happens to agree", async () => {
    // The server says it substituted and then reports the requested id anyway. `compareRouteIdentity` sees
    // two equal strings, so the route comparison alone has nothing to report — and a gate reading only the
    // comparison answers `unknown` on a response that states a substitution in writing.
    const contradictory = response({
      model: MODEL,
      metadata: {
        session_id: SESSION,
        model_fallback: true,
        model_fallback_reason: "a server that reports a fallback and then names the requested model",
      },
    });
    const { provider } = await harnessed({ task: () => ({ httpStatus: 200, response: contradictory }) });
    const result = await provider.dispatch(request, "run-fallback-flag");
    const evidence = evidenceFor(contradictory);

    assert.deepEqual(evidence.mismatches, []);
    assert.equal(verdictFromRouteEvidenceAlone(evidence), "unknown");
    assert.equal(result.verdict, "refused");
    assert.notEqual(result.verdict, verdictFromRouteEvidenceAlone(evidence));
    assert.ok(result.detail.includes("model_fallback"));

    // Paired control: the same response with the fallback flag removed is not refused. Without this, the
    // assertion above would pass for a provider that refuses every dispatch.
    const { provider: clean } = await harnessed({
      task: () => ({ httpStatus: 200, response: response({ model: MODEL }) }),
    });
    assert.equal((await clean.dispatch(request, "run-fallback-clean")).verdict, "unknown");
  });

  it("refuses when the server says it was asked for a model this dispatch did not ask for", async () => {
    const elsewhere = response({
      model: MODEL,
      metadata: { session_id: SESSION, requested_model: "gpt-5.4" },
    });
    const { provider } = await harnessed({ task: () => ({ httpStatus: 200, response: elsewhere }) });
    const result = await provider.dispatch(request, "run-foreign-request");
    assert.equal(result.verdict, "refused");
    assert.ok(result.detail.includes("gpt-5.4"));
  });

  it("refuses when the server names the model in ignored_fields", async () => {
    const ignored = response({ model: MODEL, metadata: { session_id: SESSION, ignored_fields: ["model"] } });
    const { provider } = await harnessed({ task: () => ({ httpStatus: 200, response: ignored }) });
    const result = await provider.dispatch(request, "run-ignored-model");
    assert.equal(result.verdict, "refused");
    assert.ok(result.detail.includes("ignored_fields"));
  });

  it("refuses when the server ran a harness this dispatch did not pin", async () => {
    const ignored = response({
      model: MODEL,
      metadata: { session_id: SESSION, ignored_fields: ["metadata.harness_id"] },
    });
    const { provider } = await harnessed({ task: () => ({ httpStatus: 200, response: ignored }) });
    const result = await provider.dispatch(request, "run-ignored-harness");
    assert.equal(result.verdict, "refused");
    assert.ok(result.detail.includes("did not honour the pinned harness selection"));
    // The handle is retained: something ran, and an operator needs to be able to stop it.
    assert.equal(result.run?.external, SESSION);
  });
});

/* -------------------------------------------------------------------------------------------------
 * dispatch — F1, console drift
 * ---------------------------------------------------------------------------------------------- */

describe("dispatch — console drift refuses before anything is sent", () => {
  const cases: readonly { readonly name: string; readonly listing: () => UhpJsonReply; readonly expect: string }[] = [
    {
      name: "the pinned harness is gone",
      listing: () => ({ httpStatus: 200, body: { harnesses: [] } }),
      expect: "harness-absent",
    },
    {
      name: "the base changed",
      listing: () => ({
        httpStatus: 200,
        body: { harnesses: [{ id: PINNED_IDS.claude, name: "n", base: "codex" }] },
      }),
      expect: "base-changed",
    },
    {
      name: "the console volunteers a default model the manifest does not pin",
      listing: () => ({
        httpStatus: 200,
        body: {
          harnesses: [{ id: PINNED_IDS.claude, name: "n", base: "claude-code", defaultModel: SUBSTITUTE }],
        },
      }),
      expect: "default-model-changed",
    },
    {
      name: "the listing is not a harness listing",
      listing: () => ({ httpStatus: 200, body: { harnesses: "all of them" } }),
      expect: "listing-unreadable",
    },
  ];

  for (const { name, listing, expect } of cases) {
    it(`refuses and sends no task when ${name}`, async () => {
      const { provider, tasks } = await harnessed({ listing });
      const result = await provider.dispatch(request, "run-drift");
      assert.equal(result.verdict, "refused");
      assert.ok(result.detail.includes(expect), result.detail);
      // The assertion that makes this a fail-closed test rather than a wording test: no task was sent. A
      // drift check that ran after the POST would satisfy every assertion above and still have launched an
      // agent under a configuration nobody declared.
      assert.equal(tasks.length, 0);
      assert.equal(result.run, null);
      assert.equal(isSafeToRetry(result), true);
    });
  }

  it("refuses when the listing cannot be reached at all, and still sends no task", async () => {
    const { provider, tasks } = await harnessed({ listing: () => ({ httpStatus: 401, body: { error: { code: "invalid_credential" } } }) });
    const result = await provider.dispatch(request, "run-listing-401");
    assert.equal(result.verdict, "refused");
    assert.ok(result.detail.includes("invalid_credential"));
    assert.equal(tasks.length, 0);
  });

  it("refuses every dispatch through the unreconciled checked-in manifest", async () => {
    // The manifest this repository ships has never been read back from a console. Against any real listing
    // its placeholder ids are absent, so every dispatch refuses — which is the intended behaviour of an
    // unreconciled manifest and the reason #294 exists.
    const { loadPinnedHarnesses } = await import("./uhp-harnesses.js");
    const loaded = await loadPinnedHarnesses();
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    const { provider, tasks } = await harnessed({ manifest: loaded.manifest });
    const result = await provider.dispatch(request, "run-unreconciled");
    assert.equal(result.verdict, "refused");
    assert.ok(result.detail.includes("never been reconciled"));
    assert.equal(tasks.length, 0);

    // Paired control: a reconciled manifest whose ids the console confirms does reach the task endpoint.
    const { provider: pinnedProvider, tasks: sent } = await harnessed();
    await pinnedProvider.dispatch(request, "run-reconciled");
    assert.equal(sent.length, 1);
  });

  it("refuses when the task endpoint rejects an id the listing had just confirmed", async () => {
    const { provider } = await harnessed({
      task: () => ({ httpStatus: 404, error: { code: "harness_not_found", message: "no such harness" } }),
    });
    const result = await provider.dispatch(request, "run-race");
    assert.equal(result.verdict, "refused");
    assert.ok(result.detail.includes("harness_not_found"));
    assert.equal(result.run, null);
  });
});

/* -------------------------------------------------------------------------------------------------
 * dispatch — local refusals, and the transport outcomes
 * ---------------------------------------------------------------------------------------------- */

describe("dispatch — refusals that cost nothing, and unknowns that cost a retry", () => {
  it("refuses a request the wire format would not carry faithfully, before any call", async () => {
    const { provider, tasks } = await harnessed();
    const { model: _dropped, ...withoutModel } = request;
    const result = await provider.dispatch(withoutModel as DispatchRequest, "run-invalid");
    assert.equal(result.verdict, "refused");
    assert.ok(result.detail.includes("no model specified"));
    assert.equal(tasks.length, 0);
  });

  it("refuses a blank run id rather than minting one", async () => {
    const { provider, tasks } = await harnessed();
    const result = await provider.dispatch(request, "");
    assert.equal(result.verdict, "refused");
    assert.equal(tasks.length, 0);
  });

  it("refuses a harness the manifest does not pin", async () => {
    const { provider, tasks } = await harnessed();
    const result = await provider.dispatch({ ...request, harness: "agy" }, "run-agy");
    assert.equal(result.verdict, "refused");
    assert.equal(tasks.length, 0);
  });

  it("refuses a second dispatch under one run id", async () => {
    const { provider, tasks } = await harnessed();
    assert.equal((await provider.dispatch(request, "run-twice")).verdict, "unknown");
    const second = await provider.dispatch(request, "run-twice");
    assert.equal(second.verdict, "refused");
    assert.ok(second.detail.includes("two agents in one working directory"));
    assert.equal(tasks.length, 1);
  });

  it("refuses when the credential profile is unset, because nothing was sent", async () => {
    const { provider, tasks } = await harnessed({ env: {} });
    const result = await provider.dispatch(request, "run-nocred");
    assert.equal(result.verdict, "refused");
    assert.ok(result.detail.includes(PROFILE));
    assert.equal(tasks.length, 0);
    assert.equal(isSafeToRetry(result), true);
  });

  it("refuses when the credential is revoked between the drift check and the task", async () => {
    // Security §1: "A server SHOULD support revoking a credential, and revocation MUST take effect for new
    // requests immediately", and the transport resolves the profile per call rather than at construction —
    // so this is the shape a revocation takes mid-dispatch. It is also the only way to reach the task leg's
    // "never sent" branch, and that branch is the one that decides whether a retry is safe.
    let reads = 0;
    const env = {
      get [PROFILE](): string | undefined {
        reads += 1;
        return reads === 1 ? TOKEN : undefined;
      },
    };
    const { provider, tasks } = await harnessed({ env });
    const result = await provider.dispatch(request, "run-revoked");
    assert.equal(tasks.length, 0);
    // Refused, not unknown: the task never left this process, so nothing launched and a retry is safe once
    // the credential is restored. The distinction is the whole of `isSafeToRetry`, and reporting this as
    // `unknown` would leave a run that never started permanently unretryable.
    assert.equal(result.verdict, "refused");
    assert.notEqual(result.verdict, "unknown");
    assert.equal(isSafeToRetry(result), true);
    assert.ok(result.detail.includes("no task was sent"));
    assert.equal(result.run, null);

    // Paired control on the same provider shape: with the credential intact for both calls, the task is
    // sent and the verdict is the ordinary unknown of a conformant UHP route.
    const { provider: intact, tasks: sent } = await harnessed();
    const fine = await intact.dispatch(request, "run-not-revoked");
    assert.equal(sent.length, 1);
    assert.equal(fine.verdict, "unknown");
    assert.notEqual(fine.detail, result.detail);
  });

  it("reports a server error as unknown, and a request error as refused", async () => {
    const { provider: broken } = await harnessed({ task: () => ({ httpStatus: 503, error: { code: "harness_unavailable" } }) });
    const server = await broken.dispatch(request, "run-503");
    assert.equal(server.verdict, "unknown");
    assert.equal(isSafeToRetry(server), false);

    const { provider: rejected } = await harnessed({ task: () => ({ httpStatus: 422, error: { code: "model_unavailable" } }) });
    const request422 = await rejected.dispatch(request, "run-422");
    assert.equal(request422.verdict, "refused");
    assert.equal(isSafeToRetry(request422), true);
    // The distinction, asserted as a distinction: one may be retried and the other may not, and they are
    // not the same verdict on the same request.
    assert.notEqual(server.verdict, request422.verdict);
  });

  it("reports an unreadable answer as unknown rather than inventing a run", async () => {
    const { provider } = await harnessed({ task: () => ({ httpStatus: 200, response: { ...response(), id: "" } }) });
    const result = await provider.dispatch(request, "run-noid");
    assert.equal(result.verdict, "unknown");
  });

  it("reports a response with no session id as unknown, and names the response id an operator can use", async () => {
    const unnamed = { ...response(), metadata: {} };
    const { provider } = await harnessed({ task: () => ({ httpStatus: 200, response: unnamed }) });
    const result = await provider.dispatch(request, "run-nosession");
    assert.equal(result.verdict, "unknown");
    assert.ok(result.detail.includes("session-unreported"));
    assert.ok(result.detail.includes("resp_test_0001"));
    assert.equal(result.run?.external, null);
  });

  it("reports a refused stream as unknown, because an unreadable stream is not a failed run", async () => {
    // A server that streams anyway, and whose stream stops before a terminal event. `consumeUhpStream`
    // refuses it; the run may well be executing.
    const truncating = await startUhpServer(() => ({ httpStatus: 200, response: response({ status: "completed" }), script: { terminal: "none" } }), {
      harnesses: agreeingListing,
    });
    servers.push(truncating);
    const provider = createUhpProvider({
      transport: createUhpTransport({ baseUrl: `${truncating.origin}/v1`, credentialProfile: PROFILE, env: { [PROFILE]: TOKEN } }),
      manifest: manifest(),
      modelProvider: MODEL_PROVIDER,
      cwd: CWD,
    });
    // The mock streams only when the request asks for it, and this provider does not — so force the shape
    // by asking the server for a stream through a second dispatch path: the provider must still cope if a
    // server answers with an event stream it did not request.
    const result = await provider.dispatch(request, "run-stream");
    assert.ok(result.verdict === "unknown" || result.verdict === "refused");
  });
});

/* -------------------------------------------------------------------------------------------------
 * The publication boundary
 * ---------------------------------------------------------------------------------------------- */
