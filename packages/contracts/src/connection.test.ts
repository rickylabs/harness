import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_BACKOFF,
  acceptsFrom,
  backoffDelay,
  idleLink,
  stepLink,
  type ConnectionLoop,
} from "./connection.js";

/** A loop that has failed `failures` times and is waiting to try again. Jitter fixed at 1. */
function waiting(failures: number): ConnectionLoop {
  let loop = idleLink(0);
  let now = 0;
  loop = stepLink(loop, { kind: "start" }, now).loop;
  for (let i = 0; i < failures; i += 1) {
    loop = stepLink(loop, { kind: "dropped", link: loop.link, detail: "closed" }, now).loop;
    now = loop.retryAt ?? now;
    if (i + 1 < failures) loop = stepLink(loop, { kind: "tick" }, now).loop;
  }
  return loop;
}

test("start asks for a connection and claims a new link id", () => {
  const step = stepLink(idleLink(0), { kind: "start" }, 100);
  assert.equal(step.command, "connect");
  assert.equal(step.loop.state, "connecting");
  assert.equal(step.loop.link, 1);
  assert.equal(step.loop.since, 100);
});

test("a second start while already connecting is a no-op", () => {
  const connecting = stepLink(idleLink(0), { kind: "start" }, 0).loop;
  const step = stepLink(connecting, { kind: "start" }, 10);
  assert.equal(step.command, "none");
  assert.equal(step.loop.link, 1);
});

test("opening the socket does not reset the backoff; only binding does", () => {
  // A server that accepts a connection and immediately drops it — starting up, out of descriptors,
  // refusing an expired token — would otherwise reset `attempt` on every try and turn a polite
  // retry into a hot loop against a machine that is already struggling.
  const retrying = waiting(3);
  const connecting = stepLink(retrying, { kind: "tick" }, retrying.retryAt ?? 0).loop;
  assert.equal(connecting.attempt, 3);

  const opened = stepLink(connecting, { kind: "opened", link: connecting.link }, 1_000).loop;
  assert.equal(opened.attempt, 3);
  assert.equal(opened.state, "connecting");

  const bound = stepLink(connecting, { kind: "bound", link: connecting.link, generation: 4 }, 1_000).loop;
  assert.equal(bound.attempt, 0);
  assert.equal(bound.state, "live");
  assert.equal(bound.generation, 4);
  assert.equal(bound.retryAt, null);
});

test("backoff grows, and stops growing at the cap", () => {
  assert.equal(backoffDelay(0), 500);
  assert.equal(backoffDelay(1), 1_000);
  assert.equal(backoffDelay(2), 2_000);
  assert.equal(backoffDelay(6), 30_000);
  assert.equal(backoffDelay(40), DEFAULT_BACKOFF.maxMs);
});

test("jitter only ever shortens the wait, and the caller supplies it", () => {
  // Every cockpit in the house is woken by the same restart. Reconnecting in lockstep is a
  // self-inflicted stampede against a process that has only just come up.
  assert.equal(backoffDelay(1, DEFAULT_BACKOFF, 0), 500);
  assert.equal(backoffDelay(1, DEFAULT_BACKOFF, 0.5), 750);
  assert.equal(backoffDelay(1, DEFAULT_BACKOFF, 1), 1_000);
  // Out of range is clamped rather than trusted: no jitter value may lengthen the wait past the cap.
  assert.equal(backoffDelay(1, DEFAULT_BACKOFF, 9), 1_000);
  assert.equal(backoffDelay(1, DEFAULT_BACKOFF, Number.NaN), 500);
});

test("a drop schedules a retry, and the tick before it holds", () => {
  const live = stepLink(
    stepLink(idleLink(0), { kind: "start" }, 0).loop,
    { kind: "bound", link: 1, generation: 1 },
    0,
  ).loop;

  const dropped = stepLink(live, { kind: "dropped", link: 1, detail: "socket closed" }, 1_000);
  assert.equal(dropped.loop.state, "waiting");
  assert.equal(dropped.loop.attempt, 1);
  assert.equal(dropped.loop.retryAt, 1_500);
  assert.equal(dropped.command, "none");
  assert.match(dropped.detail, /socket closed/);

  const early = stepLink(dropped.loop, { kind: "tick" }, 1_499);
  assert.equal(early.command, "none");
  assert.equal(early.loop.state, "waiting");

  const due = stepLink(dropped.loop, { kind: "tick" }, 1_500);
  assert.equal(due.command, "connect");
  assert.equal(due.loop.state, "connecting");
  assert.equal(due.loop.link, 2);
});

test("a signal from a link the loop has given up on changes nothing", () => {
  // The socket the client abandoned is not obliged to go quiet: its close handler fires late and its
  // queued messages arrive after the reconnect, and both look exactly like the new socket untagged.
  const second = stepLink(
    stepLink(waiting(1), { kind: "tick" }, 500).loop,
    { kind: "bound", link: 2, generation: 9 },
    600,
  ).loop;
  assert.equal(second.link, 2);

  const late = stepLink(second, { kind: "dropped", link: 1, detail: "the old socket" }, 700);
  assert.equal(late.loop, second);
  assert.equal(late.command, "none");
  assert.match(late.detail, /link 1/);
});

test("acceptsFrom gates frames on the link that is actually being read", () => {
  const connecting = stepLink(idleLink(0), { kind: "start" }, 0).loop;
  assert.equal(acceptsFrom(connecting, 1), true);
  assert.equal(acceptsFrom(connecting, 0), false);

  const live = stepLink(connecting, { kind: "bound", link: 1, generation: 1 }, 0).loop;
  assert.equal(acceptsFrom(live, 1), true);

  const dropped = stepLink(live, { kind: "dropped", link: 1, detail: "closed" }, 0).loop;
  assert.equal(acceptsFrom(dropped, 1), false, "a waiting loop is reading nothing");
  assert.equal(acceptsFrom(idleLink(0), 0), false);
});

test("a rejection stops the loop instead of retrying an answer that will not change", () => {
  const live = stepLink(
    stepLink(idleLink(0), { kind: "start" }, 0).loop,
    { kind: "bound", link: 1, generation: 1 },
    0,
  ).loop;

  const rejected = stepLink(live, { kind: "rejected", detail: "token expired" }, 10);
  assert.equal(rejected.loop.state, "stopped");
  assert.equal(rejected.loop.retryAt, null);
  assert.equal(rejected.command, "close");

  const tick = stepLink(rejected.loop, { kind: "tick" }, 60_000);
  assert.equal(tick.command, "none");
  assert.equal(tick.loop.state, "stopped");
});

test("stop closes an open link and a stopped loop stays stopped", () => {
  const live = stepLink(
    stepLink(idleLink(0), { kind: "start" }, 0).loop,
    { kind: "bound", link: 1, generation: 1 },
    0,
  ).loop;

  const stopped = stepLink(live, { kind: "stop" }, 5);
  assert.equal(stopped.command, "close");
  assert.equal(stopped.loop.state, "stopped");

  assert.equal(stepLink(stopped.loop, { kind: "stop" }, 6).command, "none");
  // Nothing but an explicit start leaves `stopped`.
  assert.equal(stepLink(stopped.loop, { kind: "start" }, 7).command, "connect");
});
