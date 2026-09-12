/**
 * Multi-turn continuation over UHP: three turns on one session, keyed on `runId`.
 *
 * Spike S11, issue #289. Run artifacts: `.llm/runs/uhp-stream-adapter--s11/`.
 *
 * These tests prove that this repository chains turns correctly against a mock that enforces the
 * server's side of Sessions §1. They prove nothing about a real HarnessRouter: no router is reachable
 * from this host, and the clone/branch/commit/push round-trip is issue #294.
 *
 * The refusals are asserted by name rather than by falsity. A ledger that collapsed every fault into
 * one "rejected" would pass a suite of `assert(!result.ok)` while making a server that moved us to a
 * different working directory indistinguishable from a duplicate delivery.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UHP_CHAIN_SESSION,
  UHP_LIFECYCLE_FIXTURES,
  UHP_TURNS,
  startUhpTurnMock,
} from "./uhp-mock.js";
import {
  EMPTY_UHP_LEDGER,
  lastUhpTurn,
  nextUhpRequest,
  openUhpSession,
  recordUhpTurn,
  recordUhpTurnInLedger,
  uhpRunRef,
  uhpRunsInSession,
  uhpSessionOf,
  withUhpSession,
  type UhpSession,
  type UhpSessionRefusal,
} from "./uhp-session.js";
import { consumeUhpStream } from "./uhp-stream.js";
import type { UhpCreateRequest, UhpResponse } from "./uhp-wire.js";

const RUN_ID = "run_s11_chain";
const PROVIDER = "uhp";

function request(over: Partial<UhpCreateRequest> = {}): UhpCreateRequest {
  return { input: "do the thing", ...over };
}

function refusalOf(result: { ok: true } | { ok: false; refusal: UhpSessionRefusal }): UhpSessionRefusal | "accepted" {
  return result.ok ? "accepted" : result.refusal;
}

/** Walk the three scripted turns through the ledger, exactly as a provider would. */
function threeTurns(): UhpSession {
  let session = openUhpSession(RUN_ID, PROVIDER);
  for (const response of UHP_TURNS) {
    const next = nextUhpRequest(session, "do the thing");
    assert.ok(next.ok);
    const recorded = recordUhpTurn(session, next.request, response);
    assert.ok(recorded.ok, `turn for ${response.id} must be recorded`);
    session = recorded.session;
  }
  return session;
}

describe("UHP continuation — three turns on one session", () => {
  it("chains each turn onto the previous response id", () => {
    const session = threeTurns();
    assert.equal(session.turns.length, 3);
    assert.deepEqual(session.turns.map((turn) => turn.responseId), [
      "resp_turn_1",
      "resp_turn_2",
      "resp_turn_3",
    ]);
    // The chain itself, which is the thing under test: turn one continues nothing, and each later turn
    // continues exactly its predecessor. A ledger that appended without checking would show `null` here
    // three times and still have three turns.
    assert.deepEqual(session.turns.map((turn) => turn.previousResponseId), [
      null,
      "resp_turn_1",
      "resp_turn_2",
    ]);
  });

  it("builds the continuation key from the ledger rather than from the caller", () => {
    let session = openUhpSession(RUN_ID, PROVIDER);
    const first = nextUhpRequest(session, "first");
    assert.ok(first.ok);
    // The first request omits the field entirely. `null` is not a value Tasks §1.1 defines for it.
    assert.equal("previous_response_id" in first.request, false);

    const recorded = recordUhpTurn(session, first.request, UHP_TURNS[0]);
    assert.ok(recorded.ok);
    session = recorded.session;

    const second = nextUhpRequest(session, "second");
    assert.ok(second.ok);
    assert.equal(second.request.previous_response_id, "resp_turn_1");
    assert.equal(second.request.input, "second");
  });

  it("records the session id in RunRef.external and keys the run on runId", () => {
    const opened = openUhpSession(RUN_ID, PROVIDER);
    // Before the first response there is no session id, so `external` is null rather than invented.
    assert.deepEqual(uhpRunRef(opened), { runId: RUN_ID, provider: PROVIDER, external: null });

    const session = threeTurns();
    assert.equal(session.sessionId, UHP_CHAIN_SESSION);
    assert.deepEqual(uhpRunRef(session), {
      runId: RUN_ID,
      provider: PROVIDER,
      external: UHP_CHAIN_SESSION,
    });

    const ledger = withUhpSession(EMPTY_UHP_LEDGER, session);
    // Keyed on our run id. Not on the session id, and not on the last response id.
    assert.deepEqual(Object.keys(ledger), [RUN_ID]);
    assert.equal(uhpSessionOf(ledger, RUN_ID)?.turns.length, 3);
    assert.equal(uhpSessionOf(ledger, UHP_CHAIN_SESSION), undefined);
    assert.equal(uhpSessionOf(ledger, "resp_turn_3"), undefined);
  });

  it("keeps two runs that share one session id apart", () => {
    // The specification "leaves room for a server to branch from an earlier response later", so one
    // session id can cover two runs. A ledger keyed on the session id would have the second overwrite
    // the first, and one run would silently become the other.
    const first = threeTurns();
    const second = { ...threeTurns(), runId: "run_s11_branch" };
    const ledger = withUhpSession(withUhpSession(EMPTY_UHP_LEDGER, first), second);

    assert.deepEqual(Object.keys(ledger).sort(), ["run_s11_branch", RUN_ID].sort());
    assert.equal(uhpRunsInSession(ledger, UHP_CHAIN_SESSION).length, 2);
    assert.deepEqual(uhpSessionOf(ledger, RUN_ID), first);

    // Recording into one leaves the other byte-for-byte unchanged.
    const beforeOther = uhpSessionOf(ledger, "run_s11_branch");
    const advanced = recordUhpTurnInLedger(
      ledger,
      RUN_ID,
      request({ previous_response_id: "resp_turn_3" }),
      { ...UHP_TURNS[0], id: "resp_turn_4" },
    );
    assert.ok(advanced.ok);
    assert.equal(uhpSessionOf(advanced.ledger, RUN_ID)?.turns.length, 4);
    assert.deepEqual(uhpSessionOf(advanced.ledger, "run_s11_branch"), beforeOther);
  });

  it("observes one turn twice while it runs without recording it twice", () => {
    // Polling a live run: the first read is `in_progress`, the second is terminal, and both name the same
    // response. That is one turn advancing, not two turns.
    let session = openUhpSession(RUN_ID, PROVIDER);
    const opening = nextUhpRequest(session, "first");
    assert.ok(opening.ok);

    const running: UhpResponse = { ...UHP_TURNS[0], status: "in_progress" };
    const observed = recordUhpTurn(session, opening.request, running);
    assert.ok(observed.ok);
    session = observed.session;
    assert.equal(session.turns.length, 1);
    assert.equal(lastUhpTurn(session)?.status, "in_progress");

    const settled = recordUhpTurn(session, opening.request, UHP_TURNS[0]);
    assert.ok(settled.ok);
    session = settled.session;
    assert.equal(session.turns.length, 1);
    assert.equal(lastUhpTurn(session)?.status, "completed");

    // And the chain continues from the settled turn.
    const second = nextUhpRequest(session, "second");
    assert.ok(second.ok);
    assert.equal(second.request.previous_response_id, "resp_turn_1");
  });
});

describe("UHP continuation fails closed", () => {
  it("refuses a continuation that names the wrong parent", () => {
    const session = threeTurns();
    // Turn four arrives claiming to continue turn one. Appending it would write a conversation that did
    // not happen: the transcript would read as though turns two and three were never sent.
    const result = recordUhpTurn(
      session,
      request({ previous_response_id: "resp_turn_1" }),
      { ...UHP_TURNS[0], id: "resp_turn_4" },
    );
    assert.equal(refusalOf(result), "chain-broken");
  });

  it("refuses a continuation that names no parent at all once a chain exists", () => {
    const session = threeTurns();
    const result = recordUhpTurn(session, request(), { ...UHP_TURNS[0], id: "resp_turn_4" });
    assert.equal(refusalOf(result), "chain-broken");
  });

  it("refuses a first turn that claims to continue something", () => {
    const session = openUhpSession(RUN_ID, PROVIDER);
    const result = recordUhpTurn(session, request({ previous_response_id: "resp_elsewhere" }), UHP_TURNS[0]);
    assert.equal(refusalOf(result), "chain-broken");
  });

  it("refuses a response that reports a different session than the chain is in", () => {
    // Sessions §1 requires a continued chain to "report the same `metadata.session_id`". A different one
    // is a different working directory, so the files the earlier turn wrote are not there.
    const session = threeTurns();
    const moved: UhpResponse = {
      ...UHP_TURNS[1],
      id: "resp_turn_4",
      metadata: { session_id: "sess_somewhere_else" },
    };
    const result = recordUhpTurn(session, request({ previous_response_id: "resp_turn_3" }), moved);
    assert.equal(refusalOf(result), "session-changed");
    assert.ok(!result.ok);
    assert.match(result.detail, /different working directory/);
  });

  it("refuses a response that reports no session at all", () => {
    const session = openUhpSession(RUN_ID, PROVIDER);
    const anonymous: UhpResponse = { ...UHP_TURNS[0], metadata: {} };
    assert.equal(refusalOf(recordUhpTurn(session, request(), anonymous)), "session-unreported");
    const { metadata: _metadata, ...withoutMetadata } = UHP_TURNS[0];
    assert.equal(
      refusalOf(recordUhpTurn(session, request(), withoutMetadata as UhpResponse)),
      "session-unreported",
    );
  });

  it("refuses a response with no usable id, which could not be continued from anyway", () => {
    const session = openUhpSession(RUN_ID, PROVIDER);
    for (const id of ["", "   "]) {
      const result = recordUhpTurn(session, request(), { ...UHP_TURNS[0], id });
      assert.equal(refusalOf(result), "unidentified-response");
    }
  });

  it("refuses a replay of a settled turn", () => {
    const session = threeTurns();
    // The same response, delivered again, continuing the same parent it did the first time.
    const result = recordUhpTurn(session, request({ previous_response_id: "resp_turn_2" }), UHP_TURNS[2]);
    assert.equal(refusalOf(result), "replayed-response");
  });

  it("refuses a response reusing the id of an earlier turn in the chain", () => {
    const session = threeTurns();
    const result = recordUhpTurn(
      session,
      request({ previous_response_id: "resp_turn_3" }),
      { ...UHP_TURNS[0], status: "completed" },
    );
    assert.equal(refusalOf(result), "replayed-response");
  });

  it("refuses to send a second task while a turn is still open", () => {
    // Security §5 has the server refuse it as `session_busy` — "two agents in one working directory is
    // not a defined state" — so sending it trades a local refusal for a remote one and a wasted dispatch.
    let session = openUhpSession(RUN_ID, PROVIDER);
    const opening = nextUhpRequest(session, "first");
    assert.ok(opening.ok);
    const observed = recordUhpTurn(session, opening.request, { ...UHP_TURNS[0], status: "in_progress" });
    assert.ok(observed.ok);
    session = observed.session;

    assert.equal(refusalOf(nextUhpRequest(session, "second")), "prior-turn-open");
    // And a response for a *different* id cannot be appended behind the open turn either.
    assert.equal(
      refusalOf(recordUhpTurn(session, request({ previous_response_id: "resp_turn_1" }), UHP_TURNS[1])),
      "prior-turn-open",
    );
  });

  it("refuses a turn offered for a run the ledger does not hold", () => {
    const ledger = withUhpSession(EMPTY_UHP_LEDGER, threeTurns());
    const result = recordUhpTurnInLedger(ledger, "run_that_does_not_exist", request(), UHP_TURNS[0]);
    assert.equal(refusalOf(result), "run-mismatch");
  });

  it("keeps every refusal distinct, so none of them can be silently merged", () => {
    const session = threeTurns();
    const open = (() => {
      const fresh = openUhpSession(RUN_ID, PROVIDER);
      const recorded = recordUhpTurn(fresh, request(), { ...UHP_TURNS[0], status: "in_progress" });
      assert.ok(recorded.ok);
      return recorded.session;
    })();
    const observed = new Set<string>([
      refusalOf(recordUhpTurn(session, request({ previous_response_id: "resp_turn_1" }), { ...UHP_TURNS[0], id: "resp_x" })),
      refusalOf(recordUhpTurn(session, request({ previous_response_id: "resp_turn_3" }), { ...UHP_TURNS[1], id: "resp_y", metadata: { session_id: "other" } })),
      refusalOf(recordUhpTurn(openUhpSession(RUN_ID, PROVIDER), request(), { ...UHP_TURNS[0], metadata: {} })),
      refusalOf(recordUhpTurn(openUhpSession(RUN_ID, PROVIDER), request(), { ...UHP_TURNS[0], id: "" })),
      refusalOf(recordUhpTurn(session, request({ previous_response_id: "resp_turn_2" }), UHP_TURNS[2])),
      refusalOf(nextUhpRequest(open, "second")),
      refusalOf(recordUhpTurnInLedger(EMPTY_UHP_LEDGER, "nobody", request(), UHP_TURNS[0])),
    ]);
    assert.deepEqual([...observed].sort(), [
      "chain-broken",
      "prior-turn-open",
      "replayed-response",
      "run-mismatch",
      "session-changed",
      "session-unreported",
      "unidentified-response",
    ]);
  });

  it("leaves the ledger untouched when a turn is refused", () => {
    const ledger = withUhpSession(EMPTY_UHP_LEDGER, threeTurns());
    const before = JSON.stringify(ledger);
    const refused = recordUhpTurnInLedger(
      ledger,
      RUN_ID,
      request({ previous_response_id: "resp_turn_1" }),
      { ...UHP_TURNS[0], id: "resp_turn_4" },
    );
    assert.equal(refusalOf(refused), "chain-broken");
    assert.equal(JSON.stringify(ledger), before);
    assert.equal(uhpSessionOf(ledger, RUN_ID)?.turns.length, 3);
  });
});

describe("UHP continuation over a real socket", () => {
  it("runs three streamed turns against the loopback server and records the chain", async () => {
    const mock = await startUhpTurnMock(UHP_TURNS, { deltas: ["ans", "wer"], item: true });
    try {
      let ledger = withUhpSession(EMPTY_UHP_LEDGER, openUhpSession(RUN_ID, PROVIDER));
      const texts: string[] = [];

      for (let turn = 1; turn <= 3; turn += 1) {
        const session = uhpSessionOf(ledger, RUN_ID);
        assert.ok(session !== undefined);
        const next = nextUhpRequest(session, `turn ${turn}`);
        assert.ok(next.ok);

        const exchange = await mock.send(next.request);
        assert.equal(exchange.httpStatus, 200);
        const state = consumeUhpStream(exchange.body);
        assert.ok(state.ok && state.done, `turn ${turn} must produce a terminal frame`);
        texts.push(state.text);

        const recorded = recordUhpTurnInLedger(ledger, RUN_ID, next.request, state.response);
        assert.ok(recorded.ok, `turn ${turn} must be recorded`);
        ledger = recorded.ledger;
      }

      const session = uhpSessionOf(ledger, RUN_ID);
      assert.ok(session !== undefined);
      assert.equal(session.turns.length, 3);
      assert.deepEqual(session.turns.map((turn) => turn.responseId), [
        "resp_turn_1",
        "resp_turn_2",
        "resp_turn_3",
      ]);
      assert.deepEqual(session.turns.map((turn) => turn.previousResponseId), [
        null,
        "resp_turn_1",
        "resp_turn_2",
      ]);
      assert.equal(uhpRunRef(session).external, UHP_CHAIN_SESSION);
      assert.deepEqual(texts, ["answer", "answer", "answer"]);
      assert.deepEqual(Object.keys(ledger), [RUN_ID]);
    } finally {
      await mock.close();
    }
  });

  it("gets a 404 from the server for a continuation it should never have sent", async () => {
    const mock = await startUhpTurnMock();
    try {
      const exchange = await mock.send(request({ previous_response_id: "resp_never_existed" }));
      assert.equal(exchange.httpStatus, 404);
      assert.match(exchange.body, /response_not_found/);
      // Nothing lands in the ledger from a 404: there is no response to record.
      assert.deepEqual(Object.keys(EMPTY_UHP_LEDGER), []);
    } finally {
      await mock.close();
    }
  });

  it("refuses a chain the server moved to another session, over the socket", async () => {
    // A non-conformant server: turn two reports a different `session_id`. The mock's default chain is
    // conformant, so the violation is built here, in the test that needs it.
    const moved: UhpResponse = {
      ...UHP_LIFECYCLE_FIXTURES.completed,
      id: "resp_turn_2",
      metadata: { session_id: "sess_moved" },
    };
    const mock = await startUhpTurnMock([UHP_TURNS[0], moved]);
    try {
      let session = openUhpSession(RUN_ID, PROVIDER);
      const first = nextUhpRequest(session, "turn 1");
      assert.ok(first.ok);
      const firstResponse = await mock.post(first.request);
      assert.ok(firstResponse !== undefined);
      const recorded = recordUhpTurn(session, first.request, firstResponse);
      assert.ok(recorded.ok);
      session = recorded.session;
      assert.equal(session.sessionId, UHP_CHAIN_SESSION);

      const second = nextUhpRequest(session, "turn 2");
      assert.ok(second.ok);
      const secondResponse = await mock.post(second.request);
      assert.ok(secondResponse !== undefined);
      assert.equal(secondResponse.metadata?.session_id, "sess_moved");

      const result = recordUhpTurn(session, second.request, secondResponse);
      assert.equal(refusalOf(result), "session-changed");
      // The session the run is in is unchanged: a refused turn does not move the record.
      assert.equal(session.sessionId, UHP_CHAIN_SESSION);
      assert.equal(session.turns.length, 1);
    } finally {
      await mock.close();
    }
  });
});
