/**
 * `provider-uhp`: what crosses the boundary — no path in anything published, the three readers that
 * return `null`, and the credential the transport owns and the provider never sees. How these suites
 * are built is described in `uhp-provider.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createUhpProvider, type UhpDiagnostic } from "./uhp-provider.js";
import { createUhpTransport } from "./uhp-transport.js";
import { pathShapedStrings, isRedactedRouteEvidence } from "./uhp-redact.js";
import { compareRouteIdentity } from "./route.js";
import {
  observeUhpRoute,
  readUhpCwd,
  readUhpEffort,
  readUhpModel,
  readUhpProvider,
  uhpRouteNegatives,
} from "./uhp-gate.js";
import { isSafeToRetry, type DispatchResult, type RunRef } from "./provider.js";
import { UHP_FIXTURES } from "./uhp-mock.js";
import {
  agreeingListing,
  harnessed,
  manifest,
  request,
  response,
  CWD,
  MODEL,
  MODEL_PROVIDER,
  PROFILE,
  SESSION,
  SUBSTITUTE,
  TOKEN,
} from "./uhp-provider.fixtures.js";

describe("nothing published carries a path, and the diagnostic keeps one", () => {
  it("publishes no path from any verb, on a run whose cwd is an absolute path", async () => {
    const { provider, diagnostics } = await harnessed({
      task: () => ({ httpStatus: 200, response: response({ status: "completed" }) }),
      read: () => ({ httpStatus: 200, body: response({ status: "completed" }) }),
      cancel: () => ({ httpStatus: 200, body: response({ status: "completed" }) }),
    });
    const dispatched = await provider.dispatch(request, "run-boundary");
    const run = dispatched.run as RunRef;
    const observed = await provider.observe(run);
    const steered = await provider.steer(run, `look at ${CWD}/notes.md`);
    const stopped = await provider.stop(run, `the operator asked, from ${CWD}`);

    // The fence, over everything published, at any depth, under any key.
    for (const [name, published] of [
      ["dispatch", dispatched],
      ["observe", observed],
      ["steer", steered],
      ["stop", stopped],
    ] as const) {
      assert.deepEqual(pathShapedStrings(published), [], `${name} published a path`);
      // And through serialisation, which is how it reaches anything durable.
      assert.deepEqual(pathShapedStrings(JSON.parse(JSON.stringify(published))), [], `${name} serialised a path`);
    }
    assert.equal(isRedactedRouteEvidence(dispatched.route), true);

    // The paired control, and the reason redaction is not a loss: the same run's unredacted diagnostics do
    // carry the working directory, on this host, for an operator. If this assertion fails, the fixture
    // never had a path in it and every assertion above was vacuous.
    const dirty = diagnostics.filter((entry) => pathShapedStrings(entry.detail).length > 0);
    assert.ok(dirty.length > 0, "no diagnostic carried the path, so the boundary test proved nothing");
    assert.ok(diagnostics.some((entry) => entry.detail.includes(CWD)));
  });

  it("redacts a path that arrives from the transport rather than from the route", async () => {
    // The reachable leak, and the reason the boundary test above is not sufficient on its own. Over UHP the
    // route diagnostic of an `unknown` names sources and no values, so no path passes through it while
    // S10's reading holds — the leak `describeRouteEvidence` documents is on the `known` and `mismatch`
    // branches, which this transport cannot reach and which `uhp-redact.test.ts` exercises directly.
    //
    // A transport cause can carry one today: a socket error message names the socket. So the control uses
    // that, on a path this provider really does put in a published detail.
    const cause = `connect ECONNREFUSED ${CWD}/router.sock`;
    const diagnostics: UhpDiagnostic[] = [];
    const provider = createUhpProvider({
      transport: createUhpTransport({
        baseUrl: "https://router.invalid/v1",
        credentialProfile: PROFILE,
        env: { [PROFILE]: TOKEN },
        fetch: async (url) =>
          String(url).endsWith("/harnesses")
            ? new Response(JSON.stringify(agreeingListing().body), { status: 200, headers: { "content-type": "application/json" } })
            : Promise.reject(new Error(cause)),
      }),
      manifest: manifest(),
      modelProvider: MODEL_PROVIDER,
      cwd: CWD,
      onDiagnostic: (entry) => diagnostics.push(entry),
    });
    const result = await provider.dispatch(request, "run-socket-path");

    assert.equal(result.verdict, "unknown");
    // Redacted, at the boundary, through serialisation.
    assert.deepEqual(pathShapedStrings(result), []);
    assert.deepEqual(pathShapedStrings(JSON.parse(JSON.stringify(result))), []);
    // And still a diagnostic: the cause survives, only the path does not. This half is what goes red if the
    // fence has to withhold the detail because redaction stopped working.
    assert.ok(result.detail.includes("ECONNREFUSED"));
    assert.equal(result.detail.includes("was withheld because"), false);
    // The paired control that proves the input was dirty: the unredacted diagnostic has the path.
    assert.ok(diagnostics.some((entry) => entry.detail.includes(`${CWD}/router.sock`)));
  });

  it("still explains a contradiction after redaction, rather than degrading to a notice", async () => {
    // What a broken redactor costs. The provider's fence withholds a detail that still carries a path, so
    // a redactor that stopped working would replace this sentence with the withheld notice — which is what
    // makes this assertion the one that goes red for that mutation.
    const substituted = response({ model: SUBSTITUTE, metadata: { session_id: SESSION, requested_model: MODEL, model_fallback: true } });
    const { provider } = await harnessed({ task: () => ({ httpStatus: 200, response: substituted }) });
    const result = await provider.dispatch(request, "run-boundary-detail");
    assert.equal(result.verdict, "refused");
    assert.ok(result.detail.includes("contradicted the requested route on model"));
    assert.equal(result.detail.includes("was withheld because"), false);
    assert.deepEqual(pathShapedStrings(result.detail), []);
  });
});

/* -------------------------------------------------------------------------------------------------
 * observe
 * ---------------------------------------------------------------------------------------------- */

describe("the three readers that return null are still readers", () => {
  it("refuses undefined-by-UHP extension keys rather than returning them", () => {
    // The fixture volunteers `provider`, `effort` and `cwd` in metadata, which `additionalProperties: true`
    // permits and no clause of UHP defines. The readers must still answer null: agreement on a field the
    // protocol does not define is not evidence, because any server can write anything there.
    const extended = UHP_FIXTURES.allThreeAgreeingExtended;
    assert.equal(readUhpProvider(extended), null);
    assert.equal(readUhpEffort(extended), null);
    assert.equal(readUhpCwd(extended), null);
    // And the one field the protocol does define is read.
    assert.equal(readUhpModel(extended), MODEL);
    assert.equal(readUhpModel({ ...extended, model: "  " }), null);
  });

  it("produces the same evidence as the undefined-returning version it replaced", () => {
    // The move from `uhp-mock.ts` changed `undefined` to `null` for the three unreportable fields. This is
    // the assertion that the change was behaviour-preserving, rather than a comment claiming it was.
    const served = UHP_FIXTURES.conformant;
    const requested = { provider: MODEL_PROVIDER, model: MODEL, effort: "xhigh", cwd: CWD };
    const withNulls = compareRouteIdentity(requested, observeUhpRoute(served));
    const withUndefined = compareRouteIdentity(requested, {
      provider: undefined,
      model: served.model,
      effort: undefined,
      cwd: undefined,
    });
    assert.deepEqual(withNulls, withUndefined);
    assert.deepEqual(uhpRouteNegatives(withNulls).unreported, ["provider", "effort", "cwd"]);
  });
});

/* -------------------------------------------------------------------------------------------------
 * The transport, and the credential it owns
 * ---------------------------------------------------------------------------------------------- */

describe("the transport owns the credential and the provider never sees it", () => {
  it("refuses to be built with a token where a profile name belongs", () => {
    assert.throws(
      () => createUhpTransport({ baseUrl: "http://router.example.invalid/api/harness/v1", credentialProfile: "hr_live_abc123-not-a-name" }),
      /NAME of an environment entry/,
    );
    // Paired control: the name itself is accepted.
    assert.doesNotThrow(() => createUhpTransport({ baseUrl: "http://router.example.invalid/api/harness/v1", credentialProfile: PROFILE, env: {} }));
  });

  it("refuses a base url that is not one", () => {
    assert.throws(() => createUhpTransport({ baseUrl: "router.example.invalid/api/harness/v1", env: {} }), /not a URL/);
    assert.throws(() => createUhpTransport({ baseUrl: "file:///work/harness", env: {} }), /must be http or https/);
  });

  it("sends the credential as a header, the version as a header, and neither in the body", async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const transport = createUhpTransport({
      baseUrl: "https://router.invalid/api/harness/v1",
      credentialProfile: PROFILE,
      env: { [PROFILE]: TOKEN },
      fetch: async (url, init) => {
        seen.push({ url: String(url), init });
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", "uhp-version": "2026-08-11" } });
      },
    });
    const answer = await transport.call({ method: "POST", path: "responses", body: { input: "x" }, idempotencyKey: "run-1" });
    assert.equal(answer.sent, true);
    assert.equal(answer.httpStatus, 200);
    assert.equal(answer.version, "2026-08-11");

    const call = seen[0];
    assert.equal(call?.url, "https://router.invalid/api/harness/v1/responses");
    const headers = call?.init?.headers as Record<string, string>;
    assert.equal(headers["authorization"], `Bearer ${TOKEN}`);
    assert.equal(headers["uhp-version"], "2026-08-11");
    assert.equal(headers["idempotency-key"], "run-1");
    // The body carries the work and nothing else.
    assert.equal(String(call?.init?.body), JSON.stringify({ input: "x" }));
    assert.equal(String(call?.init?.body).includes(TOKEN), false);
  });

  it("reports a call that was never sent as not sent, and a failed one as sent", async () => {
    const unset = createUhpTransport({ baseUrl: "https://router.invalid/v1", credentialProfile: PROFILE, env: {} });
    const missing = await unset.call({ method: "GET", path: "harnesses" });
    assert.equal(missing.sent, false);
    assert.ok(missing.cause?.includes(PROFILE));

    const failing = createUhpTransport({
      baseUrl: "https://router.invalid/v1",
      credentialProfile: PROFILE,
      env: { [PROFILE]: TOKEN },
      fetch: () => Promise.reject(new Error("connection reset")),
    });
    const broken = await failing.call({ method: "GET", path: "harnesses" });
    // Sent and unanswered is the conservative reading, and it is the one that keeps a retry from launching
    // a second agent. The two are different facts and the field says which happened.
    assert.equal(broken.sent, true);
    assert.equal(broken.httpStatus, 0);
    assert.notEqual(broken.sent, missing.sent);
  });

  it("turns a sent-and-unanswered task into an unknown dispatch, not a refusal", async () => {
    const provider = createUhpProvider({
      transport: createUhpTransport({
        baseUrl: "https://router.invalid/v1",
        credentialProfile: PROFILE,
        env: { [PROFILE]: TOKEN },
        fetch: async (url) =>
          String(url).endsWith("/harnesses")
            ? new Response(JSON.stringify((agreeingListing().body)), { status: 200, headers: { "content-type": "application/json" } })
            : Promise.reject(new Error("socket hang up")),
      }),
      manifest: manifest(),
      modelProvider: MODEL_PROVIDER,
      cwd: CWD,
    });
    const result: DispatchResult = await provider.dispatch(request, "run-hangup");
    assert.equal(result.verdict, "unknown");
    assert.equal(isSafeToRetry(result), false);
    assert.ok(result.detail.includes("observe before dispatching again"));
  });
});

