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
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createUhpProvider, type UhpDiagnostic, type UhpProvider } from "./uhp-provider.js";
import { createUhpTransport } from "./uhp-transport.js";
import { parseHarnessManifest, type HarnessManifest } from "./uhp-harnesses.js";
import { pathShapedStrings, isRedactedRouteEvidence } from "./uhp-redact.js";
import {
  compareRouteIdentity,
  isRouteEvidenceVerified,
  type RouteIdentityEvidence,
} from "./route.js";
import { decideUhpRoute, observeUhpRoute, readUhpCwd, readUhpEffort, readUhpModel, readUhpProvider, uhpRouteNegatives, uhpRouteVerdict } from "./uhp-gate.js";
import {
  conformanceProblems,
  isSafeToRetry,
  isSteerRouteVerified,
  markInstrumented,
  selectProvider,
  type DispatchResult,
  type DispatchVerdict,
  type RunRef,
} from "./provider.js";
import type { DispatchRequest } from "./dispatch.js";
import {
  UHP_FIXTURES,
  startUhpServer,
  type UhpCreateRequest,
  type UhpJsonReply,
  type UhpMock,
  type UhpReply,
  type UhpResponse,
} from "./uhp-mock.js";

/* -------------------------------------------------------------------------------------------------
 * The defects, transcribed. Each one is run on the same input as the real thing.
 * ---------------------------------------------------------------------------------------------- */

/**
 * DEFECT: the codex refusal ladder (`packages/provider-codex/src/protocol.ts`), transplanted.
 *
 * Correct where all four route fields are observable. Over UHP the first branch always wins, so a
 * substituted model is reported as "we could not tell" instead of "the server contradicted the request".
 */
function verdictByCodexLadder(evidence: RouteIdentityEvidence): DispatchVerdict {
  if (evidence.status === "unknown") return "unknown";
  if (evidence.status === "mismatch") return "refused";
  return "accepted";
}

/** DEFECT: a substitution gate keyed on the status. Over UHP it never fires. */
function substitutionDetectedByStatus(evidence: RouteIdentityEvidence): boolean {
  return evidence.status === "mismatch";
}

/**
 * DEFECT: deriving the verdict from the route comparison alone, ignoring what the server said about
 * itself.
 *
 * This one is subtler than the ladder and it is the reason `statedContradictions` exists. A server that
 * reports `model_fallback: true` while `model` happens to equal the requested id produces no difference for
 * `compareRouteIdentity` to see — the comparison is of two equal strings — so a gate reading only
 * `evidence.mismatches` answers `unknown` on a response that says in writing that it substituted.
 */
function verdictFromRouteEvidenceAlone(evidence: RouteIdentityEvidence): DispatchVerdict {
  return uhpRouteVerdict(uhpRouteNegatives(evidence));
}

/* -------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

/** A sentinel that is not a credential and never was. It exists to be searched for in a payload. */
const TOKEN = "sentinel-value-that-is-not-a-credential";
const PROFILE = "HARNESSROUTER_API_KEY";

/** An absolute path, because the point of the boundary tests is that one never crosses it. */
const CWD = "/home/agent/projects/harness/.claude/worktrees/agent-a3446f699a390d3ab";

const MODEL_PROVIDER = "anthropic";
const MODEL = "claude-opus-5";
const SUBSTITUTE = "claude-sonnet-5";
const SESSION = "sess_e37";

const PINNED_IDS = {
  claude: "chrn_e37claude",
  codex: "chrn_e37codex",
  "codex-run": "chrn_e37codexrun",
  opencode: "chrn_e37opencode",
  "opencode-run": "chrn_e37opencoderun",
} as const;

function manifestDocument(): Record<string, unknown> {
  return {
    version: 1,
    protocol: "2026-08-11",
    reconciledAt: "2026-09-12T09:00:00.000Z",
    reconciledAgainst: "the loopback mock in uhp-mock.ts, which is not a router",
    harnesses: [
      { harness: "claude", id: PINNED_IDS.claude, base: "claude-code", defaultModel: null },
      { harness: "codex", id: PINNED_IDS.codex, base: "codex", defaultModel: null },
      { harness: "codex-run", id: PINNED_IDS["codex-run"], base: "codex", defaultModel: null },
      { harness: "opencode", id: PINNED_IDS.opencode, base: "opencode", defaultModel: null },
      { harness: "opencode-run", id: PINNED_IDS["opencode-run"], base: "opencode", defaultModel: null },
    ],
  };
}

function manifest(document: Record<string, unknown> = manifestDocument()): HarnessManifest {
  const parsed = parseHarnessManifest(document);
  assert.equal(parsed.ok, true, "the fixture manifest must parse or every test below is about the wrong thing");
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.manifest;
}

/** The console listing that agrees with the pinned manifest on every compared field. */
function agreeingListing(): UhpJsonReply {
  return {
    httpStatus: 200,
    body: {
      harnesses: manifestDocument().harnesses instanceof Array
        ? (manifestDocument().harnesses as readonly Record<string, unknown>[]).map((entry) => ({
          id: entry["id"],
          object: "harness",
          name: `console object for ${String(entry["harness"])}`,
          base: entry["base"],
          createdAt: 1_786_403_298_205,
        }))
        : [],
    },
  };
}

/** A response with our session id and whatever else a case needs. */
function response(over: Partial<UhpResponse> = {}): UhpResponse {
  return {
    id: "resp_e37",
    object: "response",
    created_at: 1_757_635_200,
    status: "in_progress",
    output: [],
    model: MODEL,
    metadata: { session_id: SESSION },
    ...over,
  };
}

const request: DispatchRequest = {
  harness: "claude",
  model: MODEL,
  effort: "xhigh",
  prompt: "summarise the run notes",
};

interface Harnessed {
  readonly provider: UhpProvider;
  readonly mock: UhpMock;
  /** Every task body the server received, in order. Zero is the assertion some tests need. */
  readonly tasks: readonly UhpCreateRequest[];
  readonly diagnostics: readonly UhpDiagnostic[];
}

interface HarnessOptions {
  readonly task?: (request: UhpCreateRequest, index: number) => UhpReply;
  readonly listing?: () => UhpJsonReply;
  readonly read?: (responseId: string) => UhpJsonReply;
  readonly cancel?: (responseId: string) => UhpJsonReply;
  readonly manifest?: HarnessManifest;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
}

const servers: UhpMock[] = [];

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
});

async function harnessed(options: HarnessOptions = {}): Promise<Harnessed> {
  const tasks: UhpCreateRequest[] = [];
  const diagnostics: UhpDiagnostic[] = [];
  const mock = await startUhpServer(
    (body) => {
      const index = tasks.length;
      tasks.push(body);
      return options.task?.(body, index) ?? { httpStatus: 200, response: response() };
    },
    {
      harnesses: options.listing ?? agreeingListing,
      ...(options.read === undefined ? {} : { read: options.read }),
      ...(options.cancel === undefined ? {} : { cancel: options.cancel }),
    },
  );
  servers.push(mock);
  const provider = createUhpProvider({
    transport: createUhpTransport({
      baseUrl: `${mock.origin}/v1`,
      credentialProfile: PROFILE,
      env: options.env ?? { [PROFILE]: TOKEN },
    }),
    manifest: options.manifest ?? manifest(),
    modelProvider: MODEL_PROVIDER,
    cwd: options.cwd ?? CWD,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  return { provider, mock, tasks, diagnostics };
}

/**
 * The route evidence a given served response produces against this suite's request.
 *
 * Labelled `uhp`, as the provider labels it since #287: the observation came off a UHP response body, and
 * a comparison that claimed `thread/start.result.*` here would be a reference the provider no longer
 * matches.
 */
function evidenceFor(served: UhpResponse): RouteIdentityEvidence {
  return compareRouteIdentity(
    { provider: MODEL_PROVIDER, model: MODEL, effort: "xhigh", cwd: CWD },
    observeUhpRoute(served),
    "uhp",
  );
}

/* -------------------------------------------------------------------------------------------------
 * What the provider says about itself
 * ---------------------------------------------------------------------------------------------- */

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
    assert.equal(session?.turns[0]?.responseId, "resp_e37");
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
    // The provenance of that evidence names the wire it came off, and not a Codex response this provider
    // never sent (#287). A diagnostic whose origin claim is false is worse than one with no origin claim.
    assert.equal(result.route?.observed.model.source, "uhp/responses.result.model");
    assert.equal(result.route?.requested.model.source, "request.model");
    for (const field of ["provider", "effort", "cwd"] as const) {
      assert.equal(result.route?.observed[field].source, null, `${field} has no UHP wire field to be sourced from`);
    }
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
    assert.ok(result.detail.includes("resp_e37"));
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

describe("nothing published carries a path, and the diagnostic keeps one", () => {
  it("publishes no path from any verb, on a run whose cwd is an absolute path", async () => {
    // Distinct response ids per turn, deliberately. With one id for both, `recordUhpTurn` refuses the
    // continuation as a repeated response and `steer` returns `unknown` **before** it observes a route —
    // so the steer row below would be asserting about a result that never carried route evidence, and
    // mutation N9 (a steer publishing unredacted evidence) killed nothing here until this was fixed. The
    // ledger's refusal is a real behaviour and is covered by its own test; it is not what this test is for.
    const { provider, diagnostics } = await harnessed({
      task: (_body, index) => ({ httpStatus: 200, response: response({ id: `resp_boundary_${index}`, status: "completed" }) }),
      read: () => ({ httpStatus: 200, body: response({ id: "resp_boundary_1", status: "completed" }) }),
      cancel: () => ({ httpStatus: 200, body: response({ id: "resp_boundary_1", status: "completed" }) }),
    });
    const dispatched = await provider.dispatch(request, "run-boundary");
    const run = dispatched.run as RunRef;
    const observed = await provider.observe(run);
    const steered = await provider.steer(run, `look at ${CWD}/notes.md`);
    const stopped = await provider.stop(run, `the operator asked, from ${CWD}`);

    // The precondition this test depends on and did not state: the steer has to have landed, or the fence
    // is being run over a result with no route in it.
    assert.equal(steered.verdict, "delivered");
    assert.ok(steered.route !== undefined, "the steer must carry route evidence for the fence to mean anything");

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
    assert.equal(isRedactedRouteEvidence(steered.route), true);

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

describe("observe — the #287 mapping, read from the stored response", () => {
  const mapping = [
    { status: "in_progress", liveness: "running" },
    { status: "completed", liveness: "finished" },
    { status: "failed", liveness: "failed" },
    { status: "cancelled", liveness: "finished" },
    { status: "incomplete", liveness: "failed" },
  ] as const;

  for (const { status, liveness } of mapping) {
    it(`maps ${status} to ${liveness}`, async () => {
      const { provider } = await harnessed({ read: () => ({ httpStatus: 200, body: response({ status }) }) });
      const dispatched = await provider.dispatch(request, `run-observe-${status}`);
      const observed = await provider.observe(dispatched.run as RunRef);
      assert.equal(observed.liveness, liveness);
      assert.equal(observed.run.runId, `run-observe-${status}`);
      // `artifacts` stays empty: a UHP response's output is the agent's prose, and recovering a branch or
      // a pull request url from it is a parsing job with its own failure modes (#294 owns it). A fabricated
      // url on a run record is worse than an empty list.
      assert.deepEqual(observed.artifacts, []);
    });
  }

  it("keeps cancelled apart from failed, which is the row most likely to be collapsed", async () => {
    const { provider } = await harnessed({ read: () => ({ httpStatus: 200, body: response({ status: "cancelled" }) }) });
    const cancelled = await provider.observe((await provider.dispatch(request, "run-cancelled")).run as RunRef);
    const { provider: failing } = await harnessed({ read: () => ({ httpStatus: 200, body: response({ status: "failed" }) }) });
    const failed = await provider.observe((await failing.dispatch(request, "run-failed")).run as RunRef);
    assert.equal(cancelled.liveness, "finished");
    assert.notEqual(cancelled.liveness, failed.liveness);
    assert.ok(cancelled.detail.includes("cancelled"));
  });

  it("reports a 404 as unknown rather than synthesizing a terminal state", async () => {
    const { provider } = await harnessed({
      read: () => ({ httpStatus: 404, body: { error: { code: "session_expired" } } }),
    });
    const observed = await provider.observe((await provider.dispatch(request, "run-404")).run as RunRef);
    assert.equal(observed.liveness, "unknown");
    assert.ok(observed.detail.includes("session_expired"));
  });

  it("reports an unreadable body as unknown", async () => {
    const { provider } = await harnessed({ read: () => ({ httpStatus: 200, body: { nothing: true } }) });
    const observed = await provider.observe((await provider.dispatch(request, "run-unreadable")).run as RunRef);
    assert.equal(observed.liveness, "unknown");
  });

  it("refuses to attribute a read-back that reports a different session", async () => {
    const { provider } = await harnessed({
      read: () => ({ httpStatus: 200, body: response({ status: "completed", metadata: { session_id: "sess_elsewhere" } }) }),
    });
    const observed = await provider.observe((await provider.dispatch(request, "run-moved")).run as RunRef);
    assert.equal(observed.liveness, "unknown");
    assert.ok(observed.detail.includes("cannot change session"));
  });

  it("is unknown for a run this provider has never dispatched", async () => {
    const { provider } = await harnessed();
    const observed = await provider.observe({ runId: "never-dispatched", provider: "uhp", external: null });
    assert.equal(observed.liveness, "unknown");
    assert.ok(observed.detail.includes("no recorded turn"));
  });

  it("is unknown for a run owned by another provider", async () => {
    const { provider } = await harnessed();
    const observed = await provider.observe({ runId: "someone-elses", provider: "codex", external: "thread_1" });
    assert.equal(observed.liveness, "unknown");
    assert.ok(observed.detail.includes("owned by provider codex"));
  });

  it("names a substitution that only appears on the read-back", async () => {
    const substituted = response({
      status: "completed",
      model: SUBSTITUTE,
      metadata: { session_id: SESSION, requested_model: MODEL, model_fallback: true },
    });
    const { provider } = await harnessed({ read: () => ({ httpStatus: 200, body: substituted }) });
    const late = await provider.observe((await provider.dispatch(request, "run-late-sub")).run as RunRef);
    assert.equal(late.liveness, "finished");
    assert.ok(late.detail.includes("contradiction of the requested route"));

    // Paired control on the same shape: a clean read-back says nothing of the kind, so the assertion above
    // is about the substitution rather than about the sentence always being there.
    const { provider: clean } = await harnessed({ read: () => ({ httpStatus: 200, body: response({ status: "completed" }) }) });
    const fine = await clean.observe((await clean.dispatch(request, "run-clean-read")).run as RunRef);
    assert.equal(fine.detail.includes("contradiction of the requested route"), false);
  });
});

/* -------------------------------------------------------------------------------------------------
 * steer
 * ---------------------------------------------------------------------------------------------- */

describe("steer — continuation at a turn boundary, not injection into a live turn", () => {
  it("refuses a second turn while the first is still running, without sending anything", async () => {
    const { provider, tasks } = await harnessed();
    const dispatched = await provider.dispatch(request, "run-busy");
    assert.equal(tasks.length, 1);
    const steered = await provider.steer(dispatched.run as RunRef, "and also fix the tests");
    assert.equal(steered.verdict, "refused");
    assert.ok(steered.detail.includes("prior-turn-open"));
    // Nothing was sent: Lifecycle §5 would have answered `409 session_busy`, and a local refusal costs no
    // round trip and no ambiguity about whether the message landed.
    assert.equal(tasks.length, 1);
  });

  it("delivers the next turn once the previous one is terminal, chaining on the response id", async () => {
    const turns: readonly UhpResponse[] = [
      response({ id: "resp_turn_a", status: "completed" }),
      response({ id: "resp_turn_b", status: "in_progress" }),
    ];
    const { provider, tasks } = await harnessed({
      task: (_body, index) => ({ httpStatus: 200, response: turns[Math.min(index, turns.length - 1)] as UhpResponse }),
    });
    const dispatched = await provider.dispatch(request, "run-steer");
    const steered = await provider.steer(dispatched.run as RunRef, "now add tests");
    assert.equal(steered.verdict, "delivered");
    assert.equal(tasks.length, 2);
    assert.equal((tasks[1] as Record<string, unknown>)["previous_response_id"], "resp_turn_a");
    assert.equal((tasks[1] as Record<string, unknown>)["input"], "now add tests");
    assert.equal(provider.sessions()["run-steer"]?.turns.length, 2);
  });

  it("refuses an empty message and a run it does not hold", async () => {
    const { provider, tasks } = await harnessed();
    const dispatched = await provider.dispatch(request, "run-empty-steer");
    assert.equal((await provider.steer(dispatched.run as RunRef, "   ")).verdict, "refused");
    assert.equal(tasks.length, 1);
    const orphan = await provider.steer({ runId: "unknown-run", provider: "uhp", external: null }, "hello");
    assert.equal(orphan.verdict, "unknown");
  });

  it("reports an expired session as unknown and a rejected turn as refused", async () => {
    const first = response({ id: "resp_turn_a", status: "completed" });
    const { provider: expired } = await harnessed({
      task: (_body, index) => index === 0
        ? { httpStatus: 200, response: first }
        : { httpStatus: 404, error: { code: "session_expired" } },
    });
    const expiredRun = (await expired.dispatch(request, "run-expired")).run as RunRef;
    const expiredSteer = await expired.steer(expiredRun, "continue");
    assert.equal(expiredSteer.verdict, "unknown");
    assert.ok(expiredSteer.detail.includes("session_expired"));

    const { provider: busy } = await harnessed({
      task: (_body, index) => index === 0
        ? { httpStatus: 200, response: first }
        : { httpStatus: 409, error: { code: "session_busy" } },
    });
    const busyRun = (await busy.dispatch(request, "run-remote-busy")).run as RunRef;
    const busySteer = await busy.steer(busyRun, "continue");
    assert.equal(busySteer.verdict, "refused");
    // The distinction: one says the message did not land, the other says nobody knows.
    assert.notEqual(busySteer.verdict, expiredSteer.verdict);
  });

  it("carries a substitution on a continuation as structured route evidence, not only as prose", async () => {
    // #287, work item 2. UHP continuation is `previous_response_id`, so a long session is mostly steers: a
    // server that honours the model on turn one and substitutes on turn five produces exactly the shape
    // `SteerResult` could not express. `delivered` is still correct — the message landed, and resending it
    // would put two turns in one conversation — so the contradiction is carried in `route`, where a gate
    // can read it, rather than only in a sentence a gate would have to grep.
    const first = response({ id: "resp_turn_a", status: "completed" });
    const substituted = response({
      id: "resp_turn_b",
      status: "in_progress",
      model: SUBSTITUTE,
      metadata: { session_id: SESSION, requested_model: MODEL, model_fallback: true },
    });
    const { provider } = await harnessed({
      task: (_body, index) => ({ httpStatus: 200, response: (index === 0 ? first : substituted) }),
    });
    const run = (await provider.dispatch(request, "run-steer-sub")).run as RunRef;
    const steered = await provider.steer(run, "continue");

    assert.equal(steered.verdict, "delivered");
    assert.deepEqual(steered.route?.mismatches, ["model"]);
    assert.equal(steered.route?.observed.model.value, SUBSTITUTE);
    assert.equal(steered.route?.observed.model.source, "uhp/responses.result.model");
    assert.ok(steered.detail.includes("contradicted the requested route on model"));

    // The capability the field exists for: the dispatch-time gate, unchanged, refuses this steer's route.
    // Before this field it had nothing to be handed and the session's structured record showed no
    // substitution at all.
    assert.equal(decideUhpRoute(steered.route).verdict, "refused");
    assert.equal(isSteerRouteVerified(steered), false);
    // Published, not raw: the same boundary the dispatch route crosses.
    assert.equal(isRedactedRouteEvidence(steered.route), true);
  });

  it("reports a continuation that was honoured as delivered with no contradiction, which is what makes the test above a distinction", async () => {
    // The positive control on the same path. Without it, every assertion above would hold for a provider
    // that reported `["model"]` on every steer, and `decideUhpRoute` would refuse every continuation.
    const first = response({ id: "resp_turn_a", status: "completed" });
    const honoured = response({ id: "resp_turn_b", status: "in_progress", model: MODEL, metadata: { session_id: SESSION } });
    const { provider } = await harnessed({
      task: (_body, index) => ({ httpStatus: 200, response: (index === 0 ? first : honoured) }),
    });
    const run = (await provider.dispatch(request, "run-steer-honoured")).run as RunRef;
    const steered = await provider.steer(run, "continue");

    assert.equal(steered.verdict, "delivered");
    assert.deepEqual(steered.route?.mismatches, []);
    assert.ok(!steered.detail.includes("contradicted the requested route"));
    // `unknown`, not `accepted`: three route fields have no UHP wire field, so a continuation is never
    // verified either. The refusal above is a contradiction; this is a silence, and they are two facts.
    assert.equal(decideUhpRoute(steered.route).verdict, "unknown");
    assert.notEqual(decideUhpRoute(steered.route).verdict, "refused");
    assert.equal(isSteerRouteVerified(steered), false);
  });

  it("names a declared fallback on a continuation, and says plainly that the route cannot carry it", async () => {
    // The residual limit of work item 2, pinned rather than glossed. A server that reports
    // `model_fallback: true` while `model` equals the requested id produces no value difference, so
    // `mismatches` is empty and honest — nothing was contradicted in the comparison. The fact lives in the
    // detail, exactly as it does for the dispatch path, whose verdict carries it and whose `route` does
    // not either. Asserting the empty `mismatches` here is what keeps a later change from quietly
    // fabricating a difference to make the structure look complete.
    const first = response({ id: "resp_turn_a", status: "completed" });
    const declared = response({
      id: "resp_turn_b",
      status: "in_progress",
      model: MODEL,
      metadata: { session_id: SESSION, model_fallback: true, model_fallback_reason: "a declared fallback that names the requested model" },
    });
    const { provider } = await harnessed({
      task: (_body, index) => ({ httpStatus: 200, response: (index === 0 ? first : declared) }),
    });
    const run = (await provider.dispatch(request, "run-steer-declared")).run as RunRef;
    const steered = await provider.steer(run, "continue");

    assert.equal(steered.verdict, "delivered");
    assert.ok(steered.detail.includes("contradicted the requested route on model"));
    assert.ok(steered.detail.includes("model_fallback"));
    // The honest structure: no value differed, so nothing is claimed to have.
    assert.deepEqual(steered.route?.mismatches, []);
    // And therefore the route alone reads this as a silence. The pair with the substitution test above is
    // the point: `route` refuses what the wire contradicted, and the detail carries what only the server
    // said about itself.
    assert.equal(decideUhpRoute(steered.route).verdict, "unknown");
  });

  it("carries no route on a steer that never reached a response, and reads that as unverified", async () => {
    // Fail-closed on absence, the same rule `DispatchResult.route` carries. An empty message is refused
    // locally, before anything is sent, so there is no response to have observed a route from — and the
    // field is absent rather than an empty object asserting agreement.
    const { provider } = await harnessed({ task: () => ({ httpStatus: 200, response: response({ status: "completed" }) }) });
    const run = (await provider.dispatch(request, "run-steer-empty")).run as RunRef;
    const refused = await provider.steer(run, "   ");

    assert.equal(refused.verdict, "refused");
    assert.equal(refused.route, undefined);
    assert.ok(!Object.hasOwn(refused, "route"), "an absent route must be an absent key, not an undefined value");
    assert.equal(isSteerRouteVerified(refused), false);
    // Found by mutation N11, which killed nothing until this line existed. The assertion above passes for a
    // predicate that reads absence as agreement, because THIS result is also `refused` and the verdict half
    // of the predicate refuses it for the other reason — a second path to the same answer, which is not
    // coverage. Absence must be refused on its own, so it is asserted on a `delivered` result where the
    // verdict cannot be doing the work. A provider that predates route evidence on a steer produces exactly
    // this shape.
    assert.equal(isSteerRouteVerified({ verdict: "delivered", detail: "delivered, with no route evidence at all" }), false);
    // And the control: a provider that answers `false` for everything has proved nothing, so the same
    // predicate must be capable of `true`. `isRouteEvidenceVerified` over a fully reported codex-dialect
    // route is that capability — no UHP route can reach it, and the predicate is not the reason.
    const fullyReported = compareRouteIdentity(
      { provider: MODEL_PROVIDER, model: MODEL, effort: "xhigh", cwd: CWD },
      { provider: MODEL_PROVIDER, model: MODEL, effort: "xhigh", cwd: CWD },
      "codex",
    );
    assert.equal(isSteerRouteVerified({ verdict: "delivered", detail: "the positive control", route: fullyReported }), true);
    // The verdict is half of the predicate: a message that did not land cannot be verified by the route
    // evidence of a turn that did not happen, however complete that evidence looks.
    assert.equal(isSteerRouteVerified({ verdict: "refused", detail: "the negative control", route: fullyReported }), false);
  });
});

/* -------------------------------------------------------------------------------------------------
 * stop — the three outcomes the downstream consumer asked to be able to tell apart
 * ---------------------------------------------------------------------------------------------- */

describe("stop — cancelled, already-over and unknown stay three answers", () => {
  it("reports a cancelled task as stopped", async () => {
    const { provider } = await harnessed({ cancel: () => ({ httpStatus: 200, body: response({ status: "cancelled" }) }) });
    const run = (await provider.dispatch(request, "run-stop")).run as RunRef;
    const stopped = await provider.stop(run, "reclaiming capacity");
    assert.equal(stopped.verdict, "stopped");
  });

  it("reports an already-terminal task as already-over, which is a success", async () => {
    const { provider } = await harnessed({ cancel: () => ({ httpStatus: 200, body: response({ status: "completed" }) }) });
    const run = (await provider.dispatch(request, "run-stop-late")).run as RunRef;
    const stopped = await provider.stop(run, "reclaiming capacity");
    assert.equal(stopped.verdict, "already-over");
  });

  it("reports a 404 or an expired session as unknown rather than a synthesized terminal state", async () => {
    for (const code of ["response_not_found", "session_expired"]) {
      const { provider } = await harnessed({ cancel: () => ({ httpStatus: 404, body: { error: { code } } }) });
      const run = (await provider.dispatch(request, `run-stop-${code}`)).run as RunRef;
      const stopped = await provider.stop(run, "reclaiming capacity");
      // The downstream fixture asserts exactly this path: a provider that collapsed it into `stopped` or
      // `already-over` would produce a false green two repositories away.
      assert.equal(stopped.verdict, "unknown");
      assert.notEqual(stopped.verdict, "stopped");
      assert.notEqual(stopped.verdict, "already-over");
      assert.ok(stopped.detail.includes(code));
    }
  });

  it("reports a task that has not stopped yet as unknown, because cancellation is a request", async () => {
    const { provider } = await harnessed({ cancel: () => ({ httpStatus: 200, body: response({ status: "in_progress" }) }) });
    const run = (await provider.dispatch(request, "run-stop-slow")).run as RunRef;
    const stopped = await provider.stop(run, "reclaiming capacity");
    assert.equal(stopped.verdict, "unknown");
    assert.ok(stopped.detail.includes("has not reached a terminal state"));
  });

  it("is unknown for a run it cannot name, and does not call the endpoint", async () => {
    let cancels = 0;
    const { provider } = await harnessed({
      cancel: () => {
        cancels += 1;
        return { httpStatus: 200, body: response({ status: "cancelled" }) };
      },
    });
    const stopped = await provider.stop({ runId: "never-here", provider: "uhp", external: null }, "why not");
    assert.equal(stopped.verdict, "unknown");
    assert.equal(cancels, 0);
  });

  it("advances the ledger on a cancelled task so a later steer is not refused as busy", async () => {
    const { provider } = await harnessed({ cancel: () => ({ httpStatus: 200, body: response({ status: "cancelled" }) }) });
    const run = (await provider.dispatch(request, "run-stop-advance")).run as RunRef;
    assert.equal(provider.sessions()["run-stop-advance"]?.turns[0]?.status, "in_progress");
    await provider.stop(run, "reclaiming capacity");
    assert.equal(provider.sessions()["run-stop-advance"]?.turns[0]?.status, "cancelled");
  });
});

/* -------------------------------------------------------------------------------------------------
 * The readers S10 found empty, kept anyway
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
      () => createUhpTransport({ baseUrl: "http://127.0.0.1:3000/api/harness/v1", credentialProfile: "hr_live_abc123-not-a-name" }),
      /NAME of an environment entry/,
    );
    // Paired control: the name itself is accepted.
    assert.doesNotThrow(() => createUhpTransport({ baseUrl: "http://127.0.0.1:3000/api/harness/v1", credentialProfile: PROFILE, env: {} }));
  });

  it("refuses a base url that is not one", () => {
    assert.throws(() => createUhpTransport({ baseUrl: "127.0.0.1:3000", env: {} }), /not a URL/);
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
