/**
 * The fold, driven through the sequences a real session produces.
 *
 * Two of these tests are the package's argument. `queued` survives the prompt being accepted and only
 * becomes `running` when the bus says work started — the distinction `provider-claude` cannot draw.
 * And a run whose prompt reply was lost climbs out of `unknown` on its own, because the session id
 * existed before the agent did.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applySignal,
  busSpoke,
  describe as describeRun,
  isOver,
  markFinished,
  markQueued,
  markSessionCreated,
  markStopped,
  markStopping,
  markUnknown,
  newRun,
  reservedRun,
  unverified,
  type RunRecord,
} from "./run.js";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:01:00.000Z";
const T2 = "2026-01-01T00:02:00.000Z";

function record(): RunRecord {
  return newRun({
    runId: "55-opencode",
    external: "ses_1",
    askedModel: "z-ai/glm-5.2",
    router: "openrouter",
    at: T0,
    artifacts: ["/var/log/opencode/55.log"],
  });
}

/** The same run, at the moment its id was claimed and before `POST /session` had answered. */
function reserved(): RunRecord {
  return reservedRun({
    runId: "55-opencode",
    askedModel: "z-ai/glm-5.2",
    router: "openrouter",
    at: T0,
    artifacts: ["/var/log/opencode/55.log"],
  });
}

describe("newRun", () => {
  it("starts queued, with the session but not the agent", () => {
    const run = record();
    assert.equal(run.liveness, "queued");
    assert.equal(run.external, "ses_1");
    assert.equal(run.events, 0);
    assert.equal(run.lastEventAt, null);
    assert.equal(run.stopping, false);
    assert.equal(run.stopReason, null);
    assert.equal(run.startedAt, T0);
    assert.equal(run.updatedAt, T0);
    assert.match(run.detail, /the prompt has not been accepted yet/);
  });
});

describe("isOver", () => {
  it("is true for the two terminal states and false for unknown", () => {
    assert.equal(isOver(record()), false);
    assert.equal(isOver(markFinished(record(), "done", T1)), true);
    assert.equal(isOver(applySignal(record(), { kind: "error", detail: "x" }, T1)), true);
    // The whole point of `unknown` here: the session id is ours, so the next event resolves it.
    assert.equal(isOver(markUnknown(record(), "lost reply", T1)), false);
  });
});

describe("markQueued", () => {
  it("keeps the run queued, because accepted is not started", () => {
    const run = markQueued(record(), T1);
    assert.equal(run.liveness, "queued");
    assert.equal(run.updatedAt, T1);
    assert.match(run.detail, /accepted the prompt; waiting for the session to begin work/);
  });
});

describe("applySignal", () => {
  it("promotes a queued run to running on the first event, and counts from there", () => {
    let run = markQueued(record(), T1);
    run = applySignal(run, { kind: "activity", detail: "message.part.updated" }, T2);
    assert.equal(run.liveness, "running");
    assert.equal(run.events, 1);
    assert.equal(run.lastEventAt, T2);
    assert.equal(run.detail, "working (1 events)");

    run = applySignal(run, { kind: "activity", detail: "message.updated" }, T2);
    assert.equal(run.events, 2);
  });

  it("carries no agent output into the record", () => {
    // `classify` already dropped it; this asserts the fold does not put it back.
    const run = applySignal(record(), { kind: "activity", detail: "message.part.updated" }, T1);
    assert.equal(run.detail.includes("message.part.updated"), false);
  });

  it("upgrades an unknown run to running, which is why unknown is not terminal", () => {
    // The prompt's reply was lost, so nobody knows whether the agent started. The bus then says it
    // did. No other provider in this repository can recover from `unknown` without a human.
    const lost = markUnknown(record(), "the prompt's reply was lost", T1);
    const found = applySignal(lost, { kind: "activity", detail: "message.updated" }, T2);
    assert.equal(found.liveness, "running");
    assert.equal(found.detail, "working (1 events)");
  });

  it("ends the run when the session goes idle", () => {
    const run = applySignal(record(), { kind: "idle" }, T1);
    assert.equal(run.liveness, "finished");
    assert.match(run.detail, /went idle, so the run is over/);
  });

  it("fails the run when the session reports an error, keeping the reason", () => {
    const run = applySignal(record(), { kind: "error", detail: "ProviderAuthError: no key" }, T1);
    assert.equal(run.liveness, "failed");
    assert.match(run.detail, /ProviderAuthError: no key/);
  });

  it("fails a run whose session disappears under it", () => {
    const run = applySignal(record(), { kind: "gone" }, T1);
    assert.equal(run.liveness, "failed");
    assert.match(run.detail, /deleted while the run was live/);
  });

  it("reads the same disappearance as success when a stop is in flight", () => {
    // Identical event, opposite meaning. Without `stopping` every successful stop lands in telemetry
    // as a failure, and a board that cries wolf on deliberate cancellations gets ignored.
    const stopping = markStopping(record(), "superseded by #56", T1);
    const gone = applySignal(stopping, { kind: "gone" }, T2);
    assert.equal(gone.liveness, "finished");
    assert.equal(gone.detail, "stopped: superseded by #56");

    const idle = applySignal(stopping, { kind: "idle" }, T2);
    assert.equal(idle.liveness, "finished");
    assert.equal(idle.detail, "stopped: superseded by #56");
  });

  it("ignores connection and unrecognised events", () => {
    const run = record();
    assert.equal(applySignal(run, { kind: "connected" }, T1), run);
    assert.equal(applySignal(run, { kind: "ignored" }, T1), run);
  });

  it("does not reopen a run that is already over", () => {
    // A `message.updated` arriving behind `session.idle` describes work already accounted for.
    const done = applySignal(record(), { kind: "idle" }, T1);
    const late = applySignal(done, { kind: "activity", detail: "message.updated" }, T2);
    assert.equal(late, done);
    assert.equal(applySignal(done, { kind: "error", detail: "boom" }, T2), done);
  });
});

describe("markStopping and markStopped", () => {
  it("records the intent without ending the run", () => {
    const run = markStopping(record(), "budget", T1);
    assert.equal(run.stopping, true);
    assert.equal(run.stopReason, "budget");
    assert.equal(isOver(run), false);
  });

  it("ends the run with the reason once the server confirms", () => {
    const run = markStopped(markStopping(record(), "budget", T1), "budget", T2);
    assert.equal(run.liveness, "finished");
    assert.equal(run.detail, "stopped: budget");
  });

  it("has a separate verb for an ending that was not a stop", () => {
    const run = markFinished(record(), "the server reported there was nothing to abort", T1);
    assert.equal(run.liveness, "finished");
    assert.equal(run.detail.startsWith("stopped:"), false);
  });
});

describe("describe", () => {
  it("is the record's own line", () => {
    assert.equal(describeRun(record()), record().detail);
  });
});

describe("unverified", () => {
  it("downgrades a live run to unknown and stamps when the photograph was taken", () => {
    const run = applySignal(markQueued(record(), T1), { kind: "activity", detail: "m" }, T2);
    const said = unverified(run, "the event stream is not connected (ECONNREFUSED)");
    assert.equal(said.liveness, "unknown");
    assert.match(said.detail, /the event stream is not connected \(ECONNREFUSED\)/);
    assert.match(said.detail, /cannot be confirmed/);
    assert.match(said.detail, new RegExp(`as of ${T2} it was running: working \\(1 events\\)`));
  });

  it("lets the caller say which way it is blind, because there is more than one way", () => {
    // A down bus and a *replaced* one are equally disqualifying and read nothing alike. `GET /event`
    // replays nothing, so a reconnect hands back a socket and not the events missed while there was
    // none — which is why `reason` is the whole head clause and not a parenthetical.
    const run = applySignal(markQueued(record(), T1), { kind: "activity", detail: "m" }, T2);

    const said = unverified(run, "the event stream was reconnected and replays nothing");

    assert.equal(said.liveness, "unknown");
    assert.match(said.detail, /^the event stream was reconnected and replays nothing, so /);
    assert.match(said.detail, new RegExp(`as of ${T2} it was running`));
  });

  it("falls back to the start time when no event has ever arrived", () => {
    const said = unverified(record(), "the event stream is not connected (stream closed)");
    assert.match(said.detail, new RegExp(`as of ${T0}`));
  });

  it("leaves a finished run alone, because a fact about the past does not expire", () => {
    const done = applySignal(record(), { kind: "idle" }, T1);
    assert.deepEqual(unverified(done, "the event stream is not connected (ECONNREFUSED)"), {
      liveness: "finished",
      detail: done.detail,
    });
    const failed = applySignal(record(), { kind: "error", detail: "boom" }, T1);
    assert.equal(
      unverified(failed, "the event stream is not connected (ECONNREFUSED)").liveness,
      "failed",
    );
  });
});

describe("reservedRun, busSpoke and markSessionCreated", () => {
  it("claims an id before there is a session to attach to it", () => {
    // The store gains its entry before the first `await`, so a second dispatch for the same id
    // collides with the reservation instead of sailing past a check nothing had answered yet.
    const held = reserved();

    assert.equal(held.external, null);
    assert.equal(held.liveness, "queued");
    assert.match(held.detail, /run id is claimed/);
    assert.equal(busSpoke(held), false);
  });

  it("fills in the handle without pretending the agent has started", () => {
    const created = markSessionCreated(reserved(), "ses_1", T1);

    assert.equal(created.external, "ses_1");
    assert.equal(created.liveness, "queued");
    assert.equal(created.updatedAt, T1);
    // Indistinguishable from a run that was born with its session, which is the point: the
    // reservation is a step in getting here, not a state anything downstream has to know about.
    assert.equal(created.detail, record().detail);
  });

  it("says whether the bus has spoken, which is what outranks a stale reply", () => {
    assert.equal(busSpoke(record()), false);
    assert.equal(busSpoke(markQueued(record(), T1)), false);
    assert.equal(busSpoke(applySignal(record(), { kind: "activity", detail: "m" }, T1)), true);
  });
});
