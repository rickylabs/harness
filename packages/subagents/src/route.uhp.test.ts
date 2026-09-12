/**
 * Fail-closed route identity over the Unified Harness Protocol, version `2026-08-11`.
 *
 * Spike S10, issue #288. Run artifacts: `.llm/runs/route-identity-uhp--s10/`.
 *
 * WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT
 *
 * Every assertion below is evidence about **this repository's coordinator behaviour** when handed a
 * given wire shape. Not one of them is evidence about what a real HarnessRouter returns. There is no
 * HarnessRouter instance reachable from this host and no container runtime on it, so the wire shapes
 * here come from `uhp-mock.ts`, which was written from the published specification.
 *
 * The observability question — "can effort, cwd and provider be requested and observed over UHP?" —
 * is answered in `.llm/runs/route-identity-uhp--s10/research.md` from the specification, its OpenAPI
 * document and its conformance suite, all retrieved 2026-09-12. The answer these tests are built on:
 *
 *   model     observable   requestable (Tasks 1.1) and echoed as REQUIRED (openapi.yaml:823, 836)
 *   provider  unobservable no request field, no response field; only the `provider_error` code
 *   effort    unobservable no request field, no response field anywhere in the protocol
 *   cwd       unobservable server-owned, never named on the wire; only an opaque `session_id`
 *
 * So a UHP route can fill exactly one of the four slots `compareRouteIdentity` needs, and its status
 * is `unknown` on every UHP route, permanently, as the protocol stands. These tests pin that, pin
 * that no fixture can talk the coordinator out of it, and pin the one distinction that must survive:
 * `unknown` is a benign silence, `mismatch` is a server contradiction, and they are not the same
 * fact.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareRouteIdentity,
  describeRouteEvidence,
  isRouteEvidenceVerified,
  type RouteIdentityEvidence,
  type RouteIdentityInput,
} from "./route.js";
import {
  UHP_FIXTURES,
  UHP_REQUESTED,
  decodeUhpStream,
  encodeUhpStream,
  observeUhpRoute,
  observeUhpRouteCredulous,
  startUhpMock,
} from "./uhp-mock.js";

/** The three fields the specification cannot report. Named once so a regression cannot quietly drop one. */
const UNOBSERVABLE_OVER_UHP = ["provider", "effort", "cwd"] as const;

function compareAgainst(observed: RouteIdentityInput): RouteIdentityEvidence {
  return compareRouteIdentity(UHP_REQUESTED, observed);
}

describe("route identity over UHP — what the wire can and cannot report", () => {
  it("observes the model and nothing else from a conformant response", () => {
    const evidence = compareAgainst(observeUhpRoute(UHP_FIXTURES.conformant));

    // The one field UHP defines arrives, with its value intact.
    assert.equal(evidence.observed.model.value, "claude-opus-5");
    // The three it does not define arrive as null. Never as a value, never as an agreement.
    for (const field of UNOBSERVABLE_OVER_UHP) {
      assert.equal(evidence.observed[field].value, null, `${field} must be null, not inferred`);
    }
    assert.equal(evidence.status, "unknown");
    assert.deepEqual(evidence.mismatches, []);
    assert.equal(isRouteEvidenceVerified(evidence), false);
    assert.match(evidence.detail, /^route unknown: /);
  });

  for (const field of UNOBSERVABLE_OVER_UHP) {
    it(`records ${field} as invalid on the observed side, because UHP never reports it`, () => {
      const evidence = compareAgainst(observeUhpRoute(UHP_FIXTURES.conformant));
      assert.ok(
        evidence.invalid.some((entry) => entry.side === "observed" && entry.field === field),
        `${field} must appear in invalid[] on the observed side`,
      );
      // The requested side is intact: this repository asks for all four. UHP just cannot answer.
      assert.ok(!evidence.invalid.some((entry) => entry.side === "requested" && entry.field === field));
      assert.equal(evidence.requested[field].value, UHP_REQUESTED[field]);
    });
  }

  it("keeps model null rather than inferring one when the response omits it", () => {
    // A response without `model` violates `Response.required` (openapi.yaml:823) and fails
    // conformance check T-03. A client must survive a non-conformant server without guessing.
    const evidence = compareAgainst(observeUhpRoute(UHP_FIXTURES.modelAbsent));
    assert.equal(evidence.observed.model.value, null);
    assert.equal(evidence.status, "unknown");
    assert.deepEqual(evidence.mismatches, []);
    assert.equal(isRouteEvidenceVerified(evidence), false);
  });

  it("survives a response carrying no metadata at all", () => {
    const evidence = compareAgainst(observeUhpRoute(UHP_FIXTURES.bareMinimum));
    assert.equal(evidence.observed.model.value, "claude-opus-5");
    assert.equal(evidence.status, "unknown");
    assert.equal(isRouteEvidenceVerified(evidence), false);
  });
});

describe("route identity over UHP — extension fields cannot manufacture agreement", () => {
  it("refuses a route even when the server volunteers all three missing fields in agreement", () => {
    // Deliverable 3, shape 1: "all three fields present and agreeing". The fixture's
    // metadata.provider, metadata.effort and metadata.cwd match the request exactly.
    //
    // The correct outcome is still a refusal. `additionalProperties: true` permits a server to write
    // those keys; no clause of UHP defines, requires or conformance-tests them. Agreement on an
    // undefined field is not evidence, because any server can write anything there and a conformant
    // server writes nothing at all.
    const evidence = compareAgainst(observeUhpRoute(UHP_FIXTURES.allThreeAgreeingExtended));
    assert.equal(evidence.status, "unknown");
    assert.equal(isRouteEvidenceVerified(evidence), false);
    for (const field of UNOBSERVABLE_OVER_UHP) {
      assert.equal(evidence.observed[field].value, null);
    }
  });

  it("does not see a contradiction on an undefined extension field either", () => {
    // The same argument in the other direction. `metadata.effort` is "low" against a requested
    // "xhigh". An undefined key can no more contradict than it can agree, so this is `unknown` with
    // no mismatch — and, critically, not a fabricated `mismatch` that would look like a real
    // server-side substitution signal.
    const evidence = compareAgainst(observeUhpRoute(UHP_FIXTURES.effortContradictingExtended));
    assert.equal(evidence.status, "unknown");
    assert.deepEqual(evidence.mismatches, []);
    assert.equal(isRouteEvidenceVerified(evidence), false);
  });

  it("demonstrates the fabricated PASS a credulous adapter would produce from the same bytes", () => {
    // This test exists to make the failure mode an artefact instead of a mistake waiting to happen.
    //
    // `observeUhpRouteCredulous` trusts undefined-by-UHP extension keys. Handed the SAME fixture as
    // the first test in this block, it produces a fully verified route. Nothing about the wire
    // changed; only the adapter's willingness to believe it did. A spike that wrote this adapter and
    // then reported "effort is observable over UHP" would have proved only that its fixture author
    // typed "xhigh" twice.
    const fixture = UHP_FIXTURES.allThreeAgreeingExtended;

    const credulous = compareAgainst(observeUhpRouteCredulous(fixture));
    assert.equal(credulous.status, "known");
    assert.equal(isRouteEvidenceVerified(credulous), true);

    const honest = compareAgainst(observeUhpRoute(fixture));
    assert.equal(honest.status, "unknown");
    assert.equal(isRouteEvidenceVerified(honest), false);

    // The contrast is the evidence: identical bytes, opposite verdicts. `observeUhpRoute` must stay
    // the one this repository uses, and this assertion fails the day someone widens it.
    assert.notEqual(credulous.status, honest.status);
  });
});

describe("route identity over UHP — model substitution is the one contradiction the wire reports", () => {
  it("records a substituted model as a difference, never as agreement", () => {
    // Tasks 1.3: a server that cannot serve the requested model MUST either fail with
    // `model_unavailable` or substitute and report the substitution. This fixture is the second
    // branch, verbatim from the chapter's worked example.
    const evidence = compareAgainst(observeUhpRoute(UHP_FIXTURES.modelSubstituted));

    assert.equal(evidence.observed.model.value, "claude-sonnet-5");
    assert.equal(evidence.requested.model.value, "claude-opus-5");
    assert.deepEqual(evidence.mismatches, ["model"]);
    assert.equal(isRouteEvidenceVerified(evidence), false);
    // Both values survive into the diagnostic, so an operator can see what was swapped for what.
    assert.match(evidence.detail, /claude-opus-5/);
    assert.match(evidence.detail, /claude-sonnet-5/);
  });

  it("never reports metadata.requested_model as the observation, which would launder the swap", () => {
    // The adapter must report the model that RAN, not the model that was asked for. Reading
    // `requested_model` back in would make every substitution compare equal to the request, which is
    // the exact downstream measurement error Tasks 1.3 exists to prevent.
    const observed = observeUhpRoute(UHP_FIXTURES.modelSubstituted);
    assert.equal(observed.model, "claude-sonnet-5");
    assert.notEqual(observed.model, UHP_FIXTURES.modelSubstituted.metadata?.requested_model);
  });

  it("collapses the substitution's STATUS to unknown, so `mismatches` is what carries the signal", () => {
    // The finding this whole spike turns on.
    //
    // `compareRouteIdentity` gives `unknown` precedence over `mismatch` (route.ts:159-163), because
    // an incomplete comparison must not be reported as a completed one. Over UHP, provider, effort
    // and cwd are ALWAYS absent, so `invalid` is always non-empty, so `status` is pinned to
    // `unknown` — including when the server has explicitly told us it substituted the model.
    //
    // The signal is not lost, but it moves. A consumer that discriminates on `status` alone treats a
    // model substitution as a benign silence. `mismatches` is the field that still separates them,
    // and issue #286 must read it.
    const benign = compareAgainst(observeUhpRoute(UHP_FIXTURES.conformant));
    const contradicted = compareAgainst(observeUhpRoute(UHP_FIXTURES.modelSubstituted));

    assert.equal(benign.status, "unknown");
    assert.equal(contradicted.status, "unknown");
    assert.equal(benign.status, contradicted.status); // status alone cannot tell them apart …
    assert.deepEqual(benign.mismatches, []); // … and `mismatches` can.
    assert.deepEqual(contradicted.mismatches, ["model"]);
    assert.doesNotMatch(benign.detail, /claude-sonnet-5/);
    assert.match(contradicted.detail, /claude-sonnet-5/);
  });
});

describe("RouteStatus — `mismatch` must never be `unknown`", () => {
  // Deliverable 5. These three are distinct values and the distinction must survive serialisation,
  // rendering and comparison.
  //
  //   known     the wire reported every field and every field agreed
  //   unknown   the wire did not report the field. Benign.
  //   mismatch  the server contradicted the request. The model-substitution safety signal.
  //
  // A test asserting only "not verified" does NOT cover this, because `isRouteEvidenceVerified`
  // returns false for both `unknown` and `mismatch` — such a test passes under the bug and
  // manufactures confidence without coverage. The first `it` below demonstrates that gap on purpose
  // before the rest close it. Atelier Cockpit carries the mirrored assertion on the consuming side.

  const known = compareRouteIdentity(UHP_REQUESTED, UHP_REQUESTED);
  const mismatch = compareRouteIdentity(UHP_REQUESTED, { ...UHP_REQUESTED, model: "claude-sonnet-5" });
  const unknown = compareRouteIdentity(UHP_REQUESTED, { ...UHP_REQUESTED, model: undefined });

  it("shows why a not-verified assertion is insufficient coverage", () => {
    assert.equal(mismatch.status, "mismatch");
    assert.equal(unknown.status, "unknown");
    // The insufficient assertion. It holds for both, so it discriminates nothing.
    assert.equal(isRouteEvidenceVerified(mismatch), false);
    assert.equal(isRouteEvidenceVerified(unknown), false);
    // The assertion that actually carries the distinction.
    assert.notEqual(mismatch.status, unknown.status);
  });

  it("keeps all three statuses pairwise distinct", () => {
    assert.equal(new Set([known.status, mismatch.status, unknown.status]).size, 3);
  });

  it("survives JSON serialisation without collapsing", () => {
    const roundTrip = (evidence: RouteIdentityEvidence): RouteIdentityEvidence =>
      JSON.parse(JSON.stringify(evidence)) as RouteIdentityEvidence;

    assert.equal(roundTrip(mismatch).status, "mismatch");
    assert.equal(roundTrip(unknown).status, "unknown");
    assert.equal(roundTrip(known).status, "known");
    assert.notEqual(roundTrip(mismatch).status, roundTrip(unknown).status);
    assert.notDeepEqual(roundTrip(mismatch), roundTrip(unknown));
  });

  it("never compares equal, whole or by status", () => {
    assert.notDeepEqual(mismatch, unknown);
    assert.notDeepEqual(mismatch.status, unknown.status);
    assert.notDeepEqual(known, mismatch);
    assert.notDeepEqual(known, unknown);
  });

  it("renders three diagnostics that cannot be confused for one another", () => {
    assert.match(mismatch.detail, /^route mismatch: /);
    assert.doesNotMatch(mismatch.detail, /route unknown/);
    assert.match(unknown.detail, /^route unknown: /);
    assert.doesNotMatch(unknown.detail, /route mismatch/);
    assert.match(known.detail, /^route verified: /);

    // The two carry different operator instructions, and swapping them would be a real incident:
    // "retry with corrected settings" is wrong advice for a wire that simply said nothing.
    assert.match(mismatch.detail, /correct the requested route or server configuration before retry/);
    assert.doesNotMatch(mismatch.detail, /no useful turn is permitted/);
    assert.match(unknown.detail, /no useful turn is permitted/);
    assert.doesNotMatch(unknown.detail, /correct the requested route or server configuration/);
  });

  it("renders the same distinction through describeRouteEvidence directly", () => {
    // `detail` is produced by `describeRouteEvidence`; re-rendering must not converge the two either.
    const render = (evidence: RouteIdentityEvidence): string =>
      describeRouteEvidence({
        status: evidence.status,
        requested: evidence.requested,
        observed: evidence.observed,
        mismatches: evidence.mismatches,
        invalid: evidence.invalid,
      });

    assert.notEqual(render(mismatch), render(unknown));
    assert.match(render(mismatch), /^route mismatch: /);
    assert.match(render(unknown), /^route unknown: /);
  });
});

describe("RouteSource — the UHP provenance defect, pinned", () => {
  it("rejects UHP provenance labels under the current predicate", () => {
    // Confirming the defect the brief suspected, at packages/subagents/src/route.ts:180-181.
    //
    // `isRouteEvidenceVerified` requires each observed field's `source` to equal its entry in the
    // single module-level OBSERVED_SOURCES map, and every entry there is a `thread/start.result.*`
    // label belonging to the in-tree codex protocol. A UHP provider's label is not in that map, so a
    // UHP route cannot be verified under the current predicate whatever the server reports.
    //
    // The cast is deliberate: `RouteSource` is a closed union today, so the future label cannot be
    // constructed type-safely. That is the defect, expressed.
    const verified = compareRouteIdentity(UHP_REQUESTED, UHP_REQUESTED);
    assert.equal(isRouteEvidenceVerified(verified), true);

    const uhpLabelled = {
      ...verified,
      observed: {
        ...verified.observed,
        model: { value: "claude-opus-5", source: "uhp/responses.result.model" },
      },
    } as unknown as RouteIdentityEvidence;

    // Identical values. Only the provenance label differs. Still refused.
    assert.equal(uhpLabelled.observed.model.value, verified.observed.model.value);
    assert.equal(isRouteEvidenceVerified(uhpLabelled), false);

    // TRIPWIRE. When issue #286 makes OBSERVED_SOURCES dialect-aware per
    // `.llm/runs/route-identity-uhp--s10/proposal-routesource-uhp.md`, this assertion flips and this
    // test must be UPDATED deliberately, not deleted. Its replacement must still assert that a
    // codex-dialect label presented on a UHP route is refused, or the cross-dialect guard is lost.
  });

  it("still refuses a UHP-labelled route that a dialect fix would have to leave unverified anyway", () => {
    // The ordering that matters, and the reason the RouteSource fix is not the binding constraint.
    // Even with a perfect dialect map, a real UHP observation has null provider, effort and cwd, so
    // `isRouteEvidenceVerified` returns false at its status check (route.ts:176) long before it ever
    // reaches the source comparison. Two independent blockers; the protocol-level one is upstream.
    const real = compareAgainst(observeUhpRoute(UHP_FIXTURES.conformant));
    assert.equal(real.status, "unknown");
    assert.equal(isRouteEvidenceVerified(real), false);
  });
});

describe("mock UHP loopback server — the same verdicts over a real socket", () => {
  it("fails closed over an application/json response", async () => {
    const mock = await startUhpMock(UHP_FIXTURES.conformant);
    try {
      const received = await mock.post({
        input: "Summarise README.md in three bullets.",
        model: "claude-opus-5",
        metadata: { harness_id: "chrn_s10" },
      });
      assert.ok(received, "the loopback server must return a response");
      const evidence = compareAgainst(observeUhpRoute(received));
      assert.equal(evidence.observed.model.value, "claude-opus-5");
      assert.equal(evidence.status, "unknown");
      assert.equal(isRouteEvidenceVerified(evidence), false);
    } finally {
      await mock.close();
    }
  });

  it("fails closed identically over a text/event-stream response", async () => {
    // A stream is the shape #286 will actually use, and a decoder is a second place a fabricated
    // agreement could be introduced. The verdict must be byte-for-byte the same as the JSON path.
    const mock = await startUhpMock(UHP_FIXTURES.conformant);
    try {
      const received = await mock.post({
        input: "Summarise README.md in three bullets.",
        model: "claude-opus-5",
        stream: true,
        metadata: { harness_id: "chrn_s10" },
      });
      assert.ok(received, "the stream must yield a terminal response");
      const evidence = compareAgainst(observeUhpRoute(received));
      assert.equal(evidence.status, "unknown");
      assert.equal(isRouteEvidenceVerified(evidence), false);
    } finally {
      await mock.close();
    }
  });

  it("carries a streamed model substitution through to a recorded difference", async () => {
    const mock = await startUhpMock(UHP_FIXTURES.modelSubstituted);
    try {
      const received = await mock.post({ input: "x", model: "claude-opus-5", stream: true });
      assert.ok(received);
      const evidence = compareAgainst(observeUhpRoute(received));
      assert.deepEqual(evidence.mismatches, ["model"]);
      assert.equal(evidence.status, "unknown");
      assert.equal(isRouteEvidenceVerified(evidence), false);
    } finally {
      await mock.close();
    }
  });

  it("treats a truncated stream as no response rather than a partial one", () => {
    // Streaming section 1: the stream MUST end with exactly one terminal event, and
    // `sequence_number` MUST increase by exactly 1 so a client can detect a dropped event. A decoder
    // that returns the last-seen response on truncation reports a killed run as a finished one.
    const full = encodeUhpStream(UHP_FIXTURES.conformant);
    assert.ok(decodeUhpStream(full), "a complete stream decodes");

    const truncated = full.split("\n\n").slice(0, 2).join("\n\n");
    assert.equal(decodeUhpStream(truncated), undefined);
  });

  it("rejects a stream whose sequence numbers skip", () => {
    const skipped = [
      `data: ${JSON.stringify({ type: "response.created", sequence_number: 0, response: UHP_FIXTURES.conformant })}`,
      `data: ${JSON.stringify({ type: "response.completed", sequence_number: 7, response: UHP_FIXTURES.conformant })}`,
      "",
    ].join("\n\n");
    assert.equal(decodeUhpStream(skipped), undefined);
  });
});
