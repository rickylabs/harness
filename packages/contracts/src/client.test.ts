import assert from "node:assert/strict";
import { test } from "node:test";

import { BEARER_SUBPROTOCOL_PREFIX, MUX_SUBPROTOCOL, type Endpoint } from "./auth.js";
import { PROTOCOL_VERSION } from "./events.js";
import type { ServerEvent } from "./events.js";
import type { GovernanceState, PendingApproval } from "./governance.js";
import type { BoardAnomaly, Lifecycle, Phase, ProgressBucket, TaskView } from "./tasks.js";
import type { RemoteSnapshot } from "./snapshot.js";
import type { RunOutcome, RunView } from "./runs.js";
import { openHub, publish, subscribe, type Hub, type HubStep } from "./server.js";
import {
  board,
  boardStatus,
  type BoardStatus,
  cockpitStatus,
  openCockpit,
  stepCockpit,
  waitingOn,
  type Cockpit,
  type CockpitInput,
  type CockpitStep,
  type Effect,
} from "./client.js";

import * as root from "./index.js";
import { emptyFold, foldFromSnapshot, foldValue, resyncFrame, type EventFold } from "./fold.js";
import { resync as receiveHub } from "./server.js";
import { createServer } from "node:http";

const REPO = { owner: "rickylabs", name: "harness" } as const;

const TRIAGE: Phase = { label: "status:triage", name: "triage", terminal: false, queued: true };
const SHIPPED: Phase = { label: "status:shipped", name: "shipped", terminal: true, queued: false };
const LIFECYCLE: Lifecycle = { prefix: "status:", phases: [TRIAGE, SHIPPED] };

const T0 = "2026-09-01T00:00:00.000Z";
const NOW = "2026-09-05T12:00:00.000Z";
const LATER = "2026-09-05T12:00:30.000Z";

/** On the LAN: the browser holds the cookie, and this package holds only its name. */
const LAN: Endpoint = {
  origin: "http://localhost:4400",
  relayed: false,
  credential: { mode: "session", cookieName: "dsh_session" },
};

/** Off-LAN, through the relay. Two pins, because one pin is a scheduled lockout. */
const RELAYED: Endpoint = {
  origin: "https://dsh.example",
  relayed: true,
  credential: {
    mode: "bearer",
    token: () => "tokentokentoken",
    pin: { spkiSha256: [`${"A".repeat(43)}=`, `${"B".repeat(43)}=`], expiresAt: null },
  },
};

function task(number: number, bucket: ProgressBucket = "queued", phase: Phase = TRIAGE): TaskView {
  return {
    number,
    title: `task ${number}`,
    url: `https://github.com/rickylabs/harness/issues/${number}`,
    kind: "issue",
    state: "open",
    phase,
    bucket,
    milestone: "M1",
    epic: "e8",
    lane: "architecture",
    priority: null,
    type: "task",
    assignees: [],
    createdAt: T0,
    updatedAt: T0,
    isEpic: false,
  };
}

function run(id: string, outcome: RunOutcome = "running"): RunView {
  return {
    id,
    source: "claude",
    parentId: null,
    startedAt: T0,
    updatedAt: T0,
    branch: "feat/82-bindings",
    identity: { harness: "claude", model: "opus-5", effort: "medium", provider: null, profile: null },
    usage: {},
    outcome,
    item: 82,
    linkedIssues: [{ number: 82, from: "path" }],
    liveness: { state: "live", evidence: "turn", at: T0, ageMs: 0 },
    quota: null,
  };
}

function approval(id: string): PendingApproval {
  return {
    id,
    kind: "dispatch-admission",
    summary: `admit ${id}`,
    item: 82,
    runId: null,
    regime: "subscription",
    requestedAt: T0,
    expiresAt: null,
  };
}

function governance(pending: readonly PendingApproval[] = [], generatedAt = T0): GovernanceState {
  return {
    generatedAt,
    regimes: [
      { regime: "subscription", state: "allow", accounts: [], note: null },
      { regime: "metered", state: "allow", providers: [], note: null },
      { regime: "capacity", state: "allow", hosts: [], note: null },
    ],
    pending,
    notes: [],
  };
}

interface SnapshotParts {
  readonly tasks?: readonly TaskView[];
  readonly runs?: readonly RunView[];
  readonly governance?: GovernanceState;
  readonly complete?: boolean;
  readonly anomalies?: readonly BoardAnomaly[];
  readonly notes?: readonly string[];
  readonly generatedAt?: string;
}

function projection(parts: SnapshotParts = {}): RemoteSnapshot {
  return {
    protocol: PROTOCOL_VERSION,
    // A projection has no connection behind it. The hub stamps a real generation on the way out;
    // a board fetched over HTTP keeps this one, which is the whole reason it may not be folded
    // into a live cockpit.
    generation: 0,
    generatedAt: parts.generatedAt ?? T0,
    complete: parts.complete ?? true,
    repo: REPO,
    lifecycle: LIFECYCLE,
    tasks: parts.tasks ?? [],
    runs: parts.runs ?? [],
    anomalies: parts.anomalies ?? [],
    governance: parts.governance ?? governance(),
    notes: parts.notes ?? [],
  };
}

/** Everything a board says, except the two fields that are about the connection, not the board. */
function shape(snapshot: RemoteSnapshot): string {
  return JSON.stringify({
    protocol: snapshot.protocol,
    complete: snapshot.complete,
    repo: snapshot.repo,
    lifecycle: snapshot.lifecycle,
    tasks: [...snapshot.tasks].sort((a, b) => a.number - b.number),
    runs: [...snapshot.runs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    anomalies: snapshot.anomalies,
    governance: snapshot.governance,
    notes: snapshot.notes,
  });
}

function framesFor(step: HubStep, id: string): readonly ServerEvent[] {
  return step.deliveries.filter((delivery) => delivery.to === id).map((delivery) => delivery.frame);
}

function messages(frames: readonly ServerEvent[], link: number): readonly CockpitInput[] {
  return frames.map((frame): CockpitInput => ({ kind: "message", link, value: frame }));
}

function feed(cockpit: Cockpit, inputs: readonly CockpitInput[], now = 0): CockpitStep {
  let current = cockpit;
  const effects: Effect[] = [];
  const notes: string[] = [];
  for (const input of inputs) {
    const step = stepCockpit(current, input, now);
    current = step.cockpit;
    effects.push(...step.effects);
    notes.push(...step.notes);
  }
  return { cockpit: current, effects, notes };
}

function only<K extends Effect["kind"]>(step: CockpitStep, kind: K): Extract<Effect, { kind: K }> {
  const found = step.effects.filter((effect) => effect.kind === kind);
  const first = found[0];
  if (first === undefined) {
    const had = step.effects.map((effect) => effect.kind).join(", ");
    throw new Error(`no ${kind} effect; got ${had === "" ? "none" : had}`);
  }
  if (found.length > 1) throw new Error(`${found.length} ${kind} effects, expected one`);
  return first as Extract<Effect, { kind: K }>;
}

function said(step: CockpitStep, fragment: string): boolean {
  return step.notes.some((note) => note.includes(fragment));
}

/** A cockpit connected to a hub holding `state`, bound and reading link 1. */
function connected(state: RemoteSnapshot): { hub: Hub; cockpit: Cockpit } {
  const greeted = subscribe(openHub(state), "phone", NOW);
  const started = feed(openCockpit(LAN), [{ kind: "start" }, { kind: "opened", link: 1 }]);
  const read = feed(started.cockpit, messages(framesFor(greeted, "phone"), 1));
  return { hub: greeted.hub, cockpit: read.cockpit };
}

test("a misconfigured endpoint stops instead of retrying a mistake forever", () => {
  const wrong: Endpoint = { ...LAN, origin: "http://localhost:4400/dsh" };
  const step = stepCockpit(openCockpit(wrong), { kind: "start" }, 0);

  assert.equal(step.effects.length, 0);
  assert.equal(step.cockpit.loop.state, "stopped");
  assert.ok(said(step, "origin carries a path"));
});

test("connecting is subscribing, and the socket says which protocol it speaks", () => {
  const step = stepCockpit(openCockpit(LAN), { kind: "start" }, 0);
  const open = only(step, "open");

  assert.equal(open.url, "ws://localhost:4400/api/remote.mux");
  assert.deepEqual(open.protocols, [MUX_SUBPROTOCOL]);
  assert.equal(open.link, 1);
});

test("a bearer token travels in the subprotocol and never in the url", () => {
  const step = stepCockpit(openCockpit(RELAYED), { kind: "start" }, 0);
  const open = only(step, "open");

  assert.equal(open.url, "wss://dsh.example/api/remote.mux");
  assert.ok(!open.url.includes("tokentokentoken"));
  assert.deepEqual(open.protocols, [MUX_SUBPROTOCOL, `${BEARER_SUBPROTOCOL_PREFIX}tokentokentoken`]);
});

test("an open socket is not a bound one; hello is what makes the cockpit live", () => {
  const greeted = subscribe(openHub(projection({ tasks: [task(82)] })), "phone", NOW);
  const opened = feed(openCockpit(LAN), [{ kind: "start" }, { kind: "opened", link: 1 }]);

  assert.equal(opened.cockpit.loop.state, "connecting");
  assert.equal(opened.cockpit.loop.generation, null);

  const [hello] = framesFor(greeted, "phone");
  if (hello === undefined) throw new Error("the hub greeted nobody");
  const bound = stepCockpit(opened.cockpit, { kind: "message", link: 1, value: hello }, 0);

  assert.equal(bound.cockpit.loop.state, "live");
  assert.equal(bound.cockpit.loop.generation, 1);
});

test("a cockpit fed the hub's own frames holds the hub's board", () => {
  const first = projection({ tasks: [task(82), task(84)], runs: [run("r1")] });
  const { hub, cockpit } = connected(first);

  const held = board(cockpit);
  if (held === null) throw new Error("the cockpit has no board");
  assert.equal(shape(held), shape(hub.state));

  const second = projection({
    tasks: [task(82, "shipped", SHIPPED), task(90)],
    runs: [run("r1", "complete"), run("r2")],
    generatedAt: LATER,
  });
  const pushed = publish(hub, second, LATER);
  const after = feed(cockpit, messages(framesFor(pushed, "phone"), 1));

  const moved = board(after.cockpit);
  if (moved === null) throw new Error("the cockpit lost its board");
  assert.equal(shape(moved), shape(second));
});

test("a gap is repaired in band, on the link that noticed it", () => {
  const greeted = subscribe(openHub(projection({ tasks: [task(82)] })), "phone", NOW);
  const started = feed(openCockpit(LAN), [{ kind: "start" }, { kind: "opened", link: 1 }]);
  const read = feed(started.cockpit, messages(framesFor(greeted, "phone"), 1));

  const skipped = publish(greeted.hub, projection({ tasks: [task(82), task(84)] }), LATER);
  const arrived = publish(
    skipped.hub,
    projection({ tasks: [task(82), task(84), task(90)] }),
    LATER,
  );

  // The frames from the first publish never arrive.
  const step = feed(read.cockpit, messages(framesFor(arrived, "phone"), 1));
  const send = only(step, "send");

  assert.equal(send.link, 1);
  assert.equal(send.frame.kind, "resync");
  assert.equal(send.frame.generation, 1);
  assert.ok(said(step, "asking for a fresh board on link 1"));
});

test("a dropped link waits, says when to come back, and comes back on a new link", () => {
  const started = feed(openCockpit(LAN), [{ kind: "start" }, { kind: "opened", link: 1 }]);
  const dropped = stepCockpit(
    started.cockpit,
    { kind: "dropped", link: 1, detail: "socket closed" },
    1_000,
    { jitter: 1 },
  );
  const wait = only(dropped, "wait");
  assert.equal(wait.untilMs, 1_500);
  assert.equal(dropped.cockpit.loop.state, "waiting");

  const early = stepCockpit(dropped.cockpit, { kind: "tick" }, 1_200);
  assert.equal(early.effects.length, 0);

  const due = stepCockpit(dropped.cockpit, { kind: "tick" }, 1_500);
  assert.equal(only(due, "open").link, 2);
});

test("a frame from an abandoned socket is never handed to the fold", () => {
  const greeted = subscribe(openHub(projection({ tasks: [task(82)] })), "phone", NOW);
  const started = feed(openCockpit(LAN), [{ kind: "start" }, { kind: "opened", link: 1 }]);
  const read = feed(started.cockpit, messages(framesFor(greeted, "phone"), 1));

  const dropped = feed(read.cockpit, [{ kind: "dropped", link: 1, detail: "socket closed" }], 0);
  const reconnecting = feed(dropped.cockpit, [{ kind: "tick" }], 60_000);
  assert.equal(reconnecting.cockpit.loop.link, 2);

  const late = publish(greeted.hub, projection({ tasks: [task(82), task(84)] }), LATER);
  const step = feed(reconnecting.cockpit, messages(framesFor(late, "phone"), 1));

  assert.equal(step.effects.length, 0);
  assert.equal(step.cockpit.fold.tasks.size, 1);
  assert.ok(said(step, "ignored a frame from link 1"));
});

test("a retry that reuses its key does not dispatch twice", () => {
  const command = { item: 82, lane: "impl", prompt: "go", idempotencyKey: "k1" } as const;
  const first = stepCockpit(openCockpit(LAN), { kind: "dispatch", command }, 0);
  assert.equal(only(first, "post").url, "http://localhost:4400/api/dispatch");

  const again = stepCockpit(first.cockpit, { kind: "dispatch", command }, 0);
  assert.equal(again.effects.length, 0);
  assert.ok(said(again, "already in flight"));
});

test("a command with an empty idempotency key is refused before it is sent", () => {
  const command = { item: 82, lane: "impl", prompt: "go", idempotencyKey: "" } as const;
  const step = stepCockpit(openCockpit(LAN), { kind: "dispatch", command }, 0);

  assert.equal(step.effects.length, 0);
  assert.equal(step.cockpit.inFlight.size, 0);
  assert.ok(said(step, "every command would share it"));
});

test("two different intents are both sent", () => {
  const step = feed(openCockpit(LAN), [
    { kind: "dispatch", command: { item: 82, lane: "impl", prompt: "a", idempotencyKey: "k1" } },
    { kind: "dispatch", command: { item: 84, lane: "impl", prompt: "b", idempotencyKey: "k2" } },
  ]);

  assert.equal(step.effects.length, 2);
  assert.equal(step.cockpit.inFlight.size, 2);
});

test("a board is not asked for twice while the first ask is outstanding", () => {
  const first = stepCockpit(openCockpit(LAN), { kind: "ask", key: "s1", reason: "cold-start" }, 0);
  assert.equal(only(first, "post").command, "snapshot");

  const again = stepCockpit(first.cockpit, { kind: "ask", key: "s2", reason: "manual" }, 0);
  assert.equal(again.effects.length, 0);
  assert.ok(said(again, "not asking twice"));
});

test("a fetched board is taken while there is no stream to contradict it", () => {
  const asked = stepCockpit(openCockpit(LAN), { kind: "ask", key: "s1", reason: "cold-start" }, 0);
  const fetched = projection({ tasks: [task(82), task(84)] });
  const step = stepCockpit(
    asked.cockpit,
    { kind: "answered", key: "s1", command: "snapshot", result: { ok: true, value: fetched } },
    0,
  );

  const held = board(step.cockpit);
  if (held === null) throw new Error("the fetched board was not taken");
  assert.equal(shape(held), shape(fetched));
  assert.equal(step.cockpit.inFlight.size, 0);
});

test("a fetched board never unbinds a live cockpit from the stream it is reading", () => {
  const { hub, cockpit } = connected(projection({ tasks: [task(82)] }));

  const stale = projection({ tasks: [task(1), task(2), task(3)] });
  const answered = feed(cockpit, [
    { kind: "ask", key: "s1", reason: "manual" },
    { kind: "answered", key: "s1", command: "snapshot", result: { ok: true, value: stale } },
  ]);

  assert.equal(answered.cockpit.fold.tasks.size, 1);
  assert.ok(said(answered, "discarded a fetched board"));

  // The point of refusing it: the next delta still applies. Had the fetched board been folded, the
  // cockpit would be bound to generation 0 and every frame after this would be discarded in silence.
  const pushed = publish(hub, projection({ tasks: [task(82), task(84)] }), LATER);
  const after = feed(answered.cockpit, messages(framesFor(pushed, "phone"), 1));
  assert.equal(after.cockpit.fold.tasks.size, 2);
});

test("a door that is shut stops the loop instead of leaving it knocking", () => {
  const { cockpit } = connected(projection());
  const step = feed(cockpit, [
    { kind: "dispatch", command: { item: 82, lane: "impl", prompt: "go", idempotencyKey: "k1" } },
    {
      kind: "answered",
      key: "k1",
      command: "dispatch",
      result: {
        ok: false,
        error: { error: "unauthorized", detail: "session expired", retryable: false },
      },
    },
  ]);

  assert.equal(step.cockpit.loop.state, "stopped");
  assert.ok(said(step, "unauthorized: session expired"));
});

test("an error the server calls retryable leaves the link alone", () => {
  const { cockpit } = connected(projection());
  const step = feed(cockpit, [
    { kind: "dispatch", command: { item: 82, lane: "impl", prompt: "go", idempotencyKey: "k1" } },
    {
      kind: "answered",
      key: "k1",
      command: "dispatch",
      result: {
        ok: false,
        error: { error: "unavailable", detail: "coordinator restarting", retryable: true },
      },
    },
  ]);

  assert.equal(step.cockpit.loop.state, "live");
  assert.equal(step.cockpit.inFlight.size, 0);
  assert.ok(said(step, "(retryable)"));
});

test("a dispatch that was admitted is not a dispatch that is running", () => {
  const { cockpit } = connected(projection());
  const step = feed(cockpit, [
    { kind: "dispatch", command: { item: 82, lane: "impl", prompt: "go", idempotencyKey: "k1" } },
    {
      kind: "answered",
      key: "k1",
      command: "dispatch",
      result: {
        ok: true,
        value: {
          accepted: true,
          runId: null,
          item: 82,
          identity: {
            harness: "claude",
            model: "opus-5",
            effort: "medium",
            provider: null,
            profile: null,
          },
          at: NOW,
        },
      },
    },
  ]);

  assert.equal(step.cockpit.fold.runs.size, 0);
  assert.ok(said(step, "claude/opus-5 at medium"));
  assert.ok(said(step, "the launch arrives as run.upserted"));
});

test("an approval settled over http is applied by the stream, not by the answer", () => {
  const pending = approval("a1");
  const { hub, cockpit } = connected(projection({ governance: governance([pending]) }));
  assert.equal(waitingOn(cockpit).length, 1);

  const step = feed(cockpit, [
    { kind: "approve", command: { id: "a1", verdict: "approve", idempotencyKey: "k1" } },
    {
      kind: "answered",
      key: "k1",
      command: "approve",
      result: {
        ok: true,
        value: { id: "a1", verdict: "approve", at: NOW, by: "eric", alreadySettled: false },
      },
    },
  ]);

  assert.equal(waitingOn(step.cockpit).length, 1);
  assert.ok(said(step, "approval.resolved will arrive on the stream"));

  const pushed = publish(hub, projection({ governance: governance([], LATER) }), LATER);
  const after = feed(step.cockpit, messages(framesFor(pushed, "phone"), 1));
  assert.equal(waitingOn(after.cockpit).length, 0);
});

test("an answer nobody was waiting for is reported rather than swallowed", () => {
  const fetched = projection({ tasks: [task(82)] });
  const step = stepCockpit(
    openCockpit(LAN),
    { kind: "answered", key: "ghost", command: "snapshot", result: { ok: true, value: fetched } },
    0,
  );

  assert.ok(said(step, "which this cockpit was not waiting for"));
});

test("a post that never came back frees its key for a retry that reuses it", () => {
  const command = { item: 82, lane: "impl", prompt: "go", idempotencyKey: "k1" } as const;
  const lost = feed(openCockpit(LAN), [
    { kind: "dispatch", command },
    { kind: "failed", key: "k1", detail: "network went away" },
  ]);
  assert.equal(lost.cockpit.inFlight.size, 0);

  const retried = stepCockpit(lost.cockpit, { kind: "dispatch", command }, 0);
  const post = only(retried, "post");
  if (post.command !== "dispatch") throw new Error(`retried a ${post.command}`);
  assert.equal(post.body.idempotencyKey, "k1");
});

test("stop closes the socket the cockpit was reading", () => {
  const { cockpit } = connected(projection());
  const step = stepCockpit(cockpit, { kind: "stop" }, 0);

  assert.equal(only(step, "close").link, 1);
  assert.equal(step.cockpit.loop.state, "stopped");
});

test("the status line tells a bound cockpit from an unbound one without reading frames", () => {
  const cold = cockpitStatus(openCockpit(LAN));
  assert.ok(cold.includes("session cookie dsh_session"));
  assert.ok(cold.includes("idle, unbound"));

  const { cockpit } = connected(projection({ tasks: [task(82), task(84)], runs: [run("r1")] }));
  const live = cockpitStatus(cockpit);
  assert.ok(live.includes("live, generation 1"));
  assert.ok(live.includes("2 tasks, 1 runs"));
});

test("nothing in a bearer status line is the bearer token", () => {
  const step = stepCockpit(openCockpit(RELAYED), { kind: "start" }, 0);
  const line = cockpitStatus(step.cockpit);

  assert.ok(!line.includes("tokentokentoken"));
  assert.ok(line.includes("2 pins"));
});

// Recovery gates use deliberately unrelated HTTP/socket generations, and source clocks older
// than receipt clocks. None of these fixtures is a backend authorization implementation.
function wire(kind: string, generation: number, seq: number, payload: unknown): unknown {
  return { kind, generation, seq, at: NOW, payload };
}
function greet(generation: number): unknown {
  return wire("hello", generation, 0, { protocol: PROTOCOL_VERSION, repo: REPO });
}
function message(c: Cockpit, value: unknown, link = c.loop.link): CockpitStep {
  return stepCockpit(c, { kind: "message", link, value }, 20_000);
}
function liveAt(generation = 90_000, state = projection({ tasks: [task(265)], runs: [run("unknown", "unknown")] })): Cockpit {
  let c = stepCockpit(openCockpit(LAN), { kind: "start" }, 0).cockpit;
  c = message(c, greet(generation)).cockpit;
  return message(c, wire("snapshot", generation, 1, { ...state, generation })).cockpit;
}
function answerSnapshot(c: Cockpit, key = "cold", generation = 900_000): CockpitStep {
  return stepCockpit(c, { kind: "answered", key, command: "snapshot", result: {
    ok: true, value: { ...projection({ tasks: [task(7)], runs: [run("unknown", "unknown")] }), generation },
  } }, 25_000);
}
function retained(before: Cockpit, after: Cockpit): void {
  assert.equal(boardStatus(after), "retained");
  assert.equal(after.fold.bound, false);
  assert.equal(after.fold.lastSeq, null);
  assert.equal(after.fold.needsResync, true);
  assert.deepEqual(board(after), board(before));
  assert.equal(after.fold.tasks, before.fold.tasks);
  assert.equal(after.fold.runs, before.fold.runs);
  assert.equal(after.fold.counts, before.fold.counts);
  assert.equal(after.fold.snapshotAt, before.fold.snapshotAt);
  assert.equal(after.fold.appliedAt, before.fold.appliedAt);
  assert.equal(after.inFlight, before.inFlight);
}

for (const signal of [
  { kind: "dropped", link: 1, detail: "synthetic loss" },
  { kind: "rejected", detail: "synthetic refusal" },
  { kind: "stop" },
] as const) {
  test(`recovery: ${signal.kind} immediately retains board, clocks, unknown run and counters`, () => {
    const c = liveAt();
    const asked = stepCockpit(c, { kind: "dispatch", command: {
      item: 265, lane: "impl", prompt: "synthetic", idempotencyKey: "unknown-effect",
    } }, 0).cockpit;
    const lost = stepCockpit(asked, signal, 1000, { jitter: 1 });
    retained(asked, lost.cockpit);
    assert.equal(board(lost.cockpit)?.runs[0]?.outcome, "unknown");
    assert.equal(lost.effects.some(e => e.kind === "post" || e.kind === "send"), false);
    // Late frames on the lost current link must be fenced even before retry increments link.
    for (const value of [greet(900_001), wire("snapshot", 90_000, 2, projection()), "unreadable"]) {
      const late = message(lost.cockpit, value);
      assert.equal(late.cockpit, lost.cockpit);
      assert.deepEqual(late.effects, []);
    }
    const tick = stepCockpit(lost.cockpit, { kind: "tick" }, 1200);
    assert.equal(tick.cockpit.fold, lost.cockpit.fold);
    assert.equal(boardStatus(tick.cockpit), "retained");
    assert.deepEqual(tick.effects, []);
  });
}

test("recovery: new lower-generation host requires both hello and snapshot; glance has three phases", () => {
  const c = liveAt();
  assert.equal(boardStatus(c), "synchronized");
  assert.ok(!cockpitStatus(c).includes("(stale)"));
  const lost = stepCockpit(c, { kind: "dropped", link: 1, detail: "restart" }, 0).cockpit;
  assert.ok(cockpitStatus(lost).includes("(stale)"));
  assert.equal(board(lost)?.tasks[0]?.number, 265);
  const retry = stepCockpit(lost, { kind: "tick" }, 60_000);
  retained(c, retry.cockpit);
  assert.equal(only(retry, "open").link, 2);
  const hello = message(retry.cockpit, greet(1));
  assert.equal(hello.cockpit.fold.bound, true);
  assert.equal(hello.cockpit.loop.generation, 1);
  assert.equal(boardStatus(hello.cockpit), "retained");
  assert.ok(cockpitStatus(hello.cockpit).includes("(stale)"));
  assert.equal(hello.cockpit.fold.snapshotAt, T0);
  const next = { ...projection({ tasks: [task(7)], generatedAt: LATER }), generation: 1 };
  const ready = message(hello.cockpit, wire("snapshot", 1, 1, next));
  assert.equal(boardStatus(ready.cockpit), "synchronized");
  assert.ok(!cockpitStatus(ready.cockpit).includes("(stale)"));
  assert.deepEqual(board(ready.cockpit), next);
  assert.equal(ready.effects.length, 0);
  for (const generation of [1, 0]) {
    const repeat = message(ready.cockpit, greet(generation));
    assert.deepEqual(board(repeat.cockpit), next);
    assert.equal(repeat.cockpit.fold.bound, true);
    assert.equal(repeat.cockpit.fold.lastSeq, 1);
    assert.equal(repeat.cockpit.fold.counts.discarded, ready.cockpit.fold.counts.discarded + 1);
    assert.equal(boardStatus(repeat.cockpit), "synchronized");
  }
});

test("recovery: pre-hello snapshot, delta, unknown and malformed-payload frames only increment discards", () => {
  const c = liveAt();
  const stopped = stepCockpit(c, { kind: "stop" }, 0).cockpit;
  const retry = stepCockpit(stopped, { kind: "start" }, 1).cockpit;
  for (const value of [
    wire("snapshot", 90_000, 99, { ...projection(), generation: 90_000 }),
    wire("task.removed", 90_000, 99, { number: 265 }),
    wire("future.kind", 90_000, 99, {}),
    wire("task.upserted", 90_000, 99, {}),
  ]) {
    const result = message(retry, value);
    assert.deepEqual(board(result.cockpit), board(c));
    assert.deepEqual(result.cockpit.fold, { ...retry.fold, counts: {
      ...retry.fold.counts, discarded: retry.fold.counts.discarded + 1,
    } });
    assert.deepEqual(result.effects, []);
    assert.equal(boardStatus(result.cockpit), "retained");
  }
  const invalidHello = message(retry, wire("hello", 1, 0, { protocol: 99, repo: REPO }));
  assert.equal(invalidHello.cockpit.fold.bound, false);
  assert.equal(invalidHello.cockpit.loop.state, "connecting");
  assert.equal(boardStatus(invalidHello.cockpit), "retained");
});

test("recovery: all old-link frame kinds, opened and dropped leave a healthy fold and counters untouched", () => {
  const c = liveAt();
  const lost = stepCockpit(c, { kind: "dropped", link: 1, detail: "restart" }, 0).cockpit;
  const retry = stepCockpit(lost, { kind: "tick" }, 60_000).cockpit;
  const bound = message(retry, greet(1)).cockpit;
  const ready = message(bound, wire("snapshot", 1, 1, { ...projection(), generation: 1 })).cockpit;
  for (const current of [retry, ready]) {
    for (const value of [greet(999_999), wire("snapshot", 1, 2, projection()),
      wire("task.removed", 1, 2, { number: 265 }), wire("future.kind", 1, 2, {}), null]) {
      const late = message(current, value, 1);
      assert.equal(late.cockpit, current);
      assert.deepEqual(late.effects, []);
    }
    for (const input of [{ kind: "dropped", link: 1, detail: "late" }, { kind: "opened", link: 1 }] as const) {
      const late = stepCockpit(current, input, 60_001);
      assert.equal(late.cockpit.fold, current.fold);
      assert.equal(late.cockpit.loop, current.loop);
      assert.deepEqual(late.effects, []);
    }
  }
});

for (const phase of ["idle", "connecting", "waiting", "stopped"] as const) {
  test(`recovery: cold HTTP during ${phase} stays unbound with far-apart generations and original clocks`, () => {
    let c = openCockpit(LAN);
    if (phase !== "idle") c = stepCockpit(c, { kind: "start" }, 0).cockpit;
    if (phase === "waiting") c = stepCockpit(c, { kind: "dropped", link: 1, detail: "loss" }, 1).cockpit;
    if (phase === "stopped") c = stepCockpit(c, { kind: "stop" }, 1).cockpit;
    c = stepCockpit(c, { kind: "ask", key: "cold", reason: "cold-start" }, 2).cockpit;
    const fetched = answerSnapshot(c).cockpit;
    assert.equal(boardStatus(fetched), "retained");
    assert.equal(fetched.fold.generation, 900_000);
    assert.equal(fetched.fold.bound, false);
    assert.equal(fetched.fold.lastSeq, null);
    assert.equal(fetched.fold.needsResync, true);
    assert.equal(fetched.fold.snapshotAt, T0);
    assert.equal(fetched.fold.appliedAt, T0);
    assert.equal(board(fetched)?.governance.generatedAt, T0);
    assert.equal(board(fetched)?.tasks[0]?.updatedAt, T0);
    assert.equal(board(fetched)?.runs[0]?.outcome, "unknown");
    const connecting = phase === "connecting" ? fetched : stepCockpit(fetched, { kind: "start" }, 3).cockpit;
    const hello = message(connecting, greet(1)).cockpit;
    assert.equal(hello.fold.generation, 1);
    assert.equal(boardStatus(hello), "retained");
    const done = message(hello, wire("snapshot", 1, 1, { ...projection(), generation: 1 })).cockpit;
    assert.equal(boardStatus(done), "synchronized");
  });
}

for (const order of ["request-before-loss", "request-during-loss"] as const) {
  for (const answer of ["before-hello", "after-hello", "after-snapshot"] as const) {
    test(`recovery: HTTP race ${order}, answer ${answer}`, () => {
      let c = liveAt();
      const ask = (current: Cockpit) => stepCockpit(current, { kind: "ask", key: "race", reason: "manual" }, 0).cockpit;
      if (order === "request-before-loss") c = ask(c);
      c = stepCockpit(c, { kind: "dropped", link: 1, detail: "loss" }, 1).cockpit;
      if (order === "request-during-loss") c = ask(c);
      c = stepCockpit(c, { kind: "tick" }, 60_000).cockpit;
      if (answer === "before-hello") c = answerSnapshot(c, "race").cockpit;
      c = message(c, greet(1)).cockpit;
      if (answer === "after-hello") {
        const result = answerSnapshot(c, "race");
        assert.equal(result.cockpit.fold, c.fold);
        assert.equal(boardStatus(result.cockpit), "retained");
        c = result.cockpit;
      }
      c = message(c, wire("snapshot", 1, 1, { ...projection({ tasks: [task(1)] }), generation: 1 })).cockpit;
      if (answer === "after-snapshot") {
        const result = answerSnapshot(c, "race");
        assert.equal(result.cockpit.fold, c.fold);
        c = result.cockpit;
      }
      assert.equal(c.inFlight.size, 0);
      assert.equal(boardStatus(c), "synchronized");
      assert.equal(board(c)?.tasks[0]?.number, 1);
    });
  }
}

test("recovery: actual HTTP unauthorized command refusal unbinds; late HTTP board grants no permission", async () => {
  const server = createServer((req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/api/dispatch");
    req.resume();
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized", detail: "synthetic revocation", retryable: false }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const c = { ...liveAt(), endpoint: { ...LAN, origin: `http://127.0.0.1:${address.port}` } };
    const asking = stepCockpit(c, { kind: "ask", key: "late", reason: "manual" }, 0).cockpit;
    const sent = stepCockpit(asking, { kind: "dispatch", command: {
      item: 265, lane: "impl", prompt: "synthetic", idempotencyKey: "refused",
    } }, 1);
    const post = only(sent, "post");
    const response = await fetch(post.url, { method: post.method, body: JSON.stringify(post.body) });
    assert.equal(response.status, 401);
    const error = await response.json() as import("./routes.js").CommandError;
    const refused = stepCockpit(sent.cockpit, { kind: "answered", key: post.key,
      command: "dispatch", result: { ok: false, error } }, 2);
    assert.equal(refused.cockpit.loop.state, "stopped");
    assert.equal(boardStatus(refused.cockpit), "retained");
    assert.equal(refused.cockpit.fold.bound, false);
    assert.equal(refused.cockpit.fold.lastSeq, null);
    assert.equal(refused.cockpit.fold.counts, c.fold.counts);
    assert.deepEqual(board(refused.cockpit), board(c));
    assert.equal(only(refused, "close").link, 1);
    const late = answerSnapshot(refused.cockpit, "late");
    assert.equal(late.cockpit.loop.state, "stopped");
    assert.equal(boardStatus(late.cockpit), "retained");
    assert.equal(late.cockpit.fold.bound, false);
    assert.deepEqual(late.effects, []);
    // Only transport state is represented. Backend display/persistence/command grants are absent.
    assert.deepEqual(Object.keys(late.cockpit).sort(), ["endpoint", "fold", "inFlight", "loop"]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }
});

for (const failure of ["http", "network"] as const) {
  test(`recovery: ordinary ${failure} command failure does not demote healthy synchronization or resend`, () => {
    const c = liveAt();
    const sent = stepCockpit(c, { kind: "dispatch", command: {
      item: 265, lane: "impl", prompt: "synthetic", idempotencyKey: "unknown",
    } }, 0).cockpit;
    const input: CockpitInput = failure === "network"
      ? { kind: "failed", key: "unknown", detail: "synthetic timeout" }
      : { kind: "answered", key: "unknown", command: "dispatch", result: {
        ok: false, error: { error: "unavailable", detail: "synthetic", retryable: true },
      } };
    const result = stepCockpit(sent, input, 1);
    assert.equal(result.cockpit.fold, c.fold);
    assert.equal(result.cockpit.loop, c.loop);
    assert.equal(boardStatus(result.cockpit), "synchronized");
    assert.equal(board(result.cockpit)?.runs[0]?.outcome, "unknown");
    assert.deepEqual(result.effects, []);
  });
}

test("recovery: absent, hello-only, empty, partial, mismatch, gap and resync have explicit derived statuses", () => {
  const absent = openCockpit(LAN);
  assert.equal(boardStatus(absent), "absent");
  const started = stepCockpit(absent, { kind: "start" }, 0).cockpit;
  const hello = message(started, greet(1)).cockpit;
  assert.equal(boardStatus(hello), "absent");
  for (const complete of [true, false]) {
    const state = projection({ complete, anomalies: complete ? [] : [{ kind: "missing-phase", item: 265, detail: "synthetic" }] });
    const c = liveAt(1, state);
    assert.equal(boardStatus(c), "synchronized");
    assert.equal(board(c)?.complete, complete);
    assert.deepEqual(board(c)?.tasks, []);
    assert.equal(boardStatus({ ...c, loop: { ...c.loop, generation: null } }), "retained");
    assert.equal(boardStatus({ ...c, loop: { ...c.loop, generation: 2 } }), "retained");
    assert.equal(boardStatus({ ...c, fold: { ...c.fold, bound: false } }), "retained");
    const bad = message(c, wire("snapshot", 1, 2, { ...state, generation: 2 })).cockpit;
    assert.deepEqual(board(bad), board(c));
    const gap = message(c, wire("task.removed", 1, 3, { number: 265 }));
    assert.equal(boardStatus(gap.cockpit), "retained");
    assert.deepEqual(only(gap, "send").frame, { kind: "resync", generation: 1, lastSeq: 3 });
    const fixed = message(gap.cockpit, wire("snapshot", 1, 4, { ...state, generation: 1 })).cockpit;
    assert.equal(boardStatus(fixed), "synchronized");
    assert.equal(board(fixed)?.complete, complete);
    assert.equal(board(fixed)?.generatedAt, state.generatedAt);
  }
});

test("recovery: legacy old-shaped folds compile and preserve hello/event/count/helper behavior", () => {
  const { bound: omitted, ...oldShape } = liveAt(8).fold;
  void omitted;
  const legacy: EventFold = oldShape;
  assert.equal(Object.hasOwn(legacy, "bound"), false);
  assert.deepEqual(resyncFrame(legacy), { kind: "resync", generation: 8, lastSeq: 1 });
  assert.equal(boardStatus({ ...liveAt(8), fold: legacy }), "synchronized");
  for (const generation of [7, 8]) assert.equal(foldValue(legacy, greet(generation)).outcome, "discarded");
  assert.equal(foldValue(legacy, greet(9)).outcome, "applied");
  assert.equal(foldValue(legacy, wire("task.removed", 8, 2, { number: 265 })).outcome, "applied");
  assert.equal(foldValue(legacy, wire("future.kind", 8, 2, {})).outcome, "counted");
  assert.equal(foldValue(legacy, wire("future.kind", 9, 2, {})).outcome, "discarded");
  const nullLegacy: EventFold = { ...oldShape, generation: null };
  assert.equal(foldValue(nullLegacy, wire("future.kind", 8, 2, {})).outcome, "discarded");
  assert.equal(foldValue(nullLegacy, wire("task.removed", 8, 2, { number: 265 })).outcome, "discarded");
  assert.equal(foldValue(nullLegacy, greet(1)).outcome, "applied");
  assert.deepEqual(resyncFrame({ ...legacy, lastSeq: null }), { kind: "resync", generation: 8 });
});

test("recovery: unbound resync uses zero sentinel and hub closes it without treating it as recovery", () => {
  assert.deepEqual(resyncFrame(emptyFold()), { kind: "resync", generation: 0 });
  const fetched = foldFromSnapshot({ ...projection(), generation: 900_000 });
  assert.deepEqual(resyncFrame(fetched), { kind: "resync", generation: 0 });
  const c = liveAt();
  const lost = stepCockpit(c, { kind: "stop" }, 0).cockpit;
  assert.deepEqual(resyncFrame(lost.fold), { kind: "resync", generation: 0 });
  assert.deepEqual(resyncFrame(c.fold), { kind: "resync", generation: 90_000, lastSeq: 1 });
  const hub = subscribe(openHub(projection()), "synthetic", NOW).hub;
  assert.ok((hub.subscribers.get("synthetic")?.generation ?? 0) > 0);
  const closed = receiveHub(hub, "synthetic", resyncFrame(lost.fold), NOW);
  assert.deepEqual(closed.closed, ["synthetic"]);
  assert.deepEqual(closed.deliveries, []);
  assert.equal(closed.hub.subscribers.has("synthetic"), false);
});

test("recovery: root exports only the public status query, with a closed status type", () => {
  assert.equal(root.boardStatus, boardStatus);
  for (const name of ["isBound", "bound", "boundTo", "rebind", "openHub"]) assert.equal(name in root, false);
  const statuses: BoardStatus[] = ["absent", "retained", "synchronized"];
  assert.equal(statuses.length, 3);
  // @ts-expect-error authorization is not a synchronization state
  const unauthorized: BoardStatus = "authorized";
  void unauthorized;
});

test("recovery: invalid and replayed snapshots after restart cannot clear pending synchronization", () => {
  const c = liveAt();
  const stopped = stepCockpit(c, { kind: "stop" }, 0).cockpit;
  const retry = stepCockpit(stopped, { kind: "start" }, 1).cockpit;
  const hello = message(retry, greet(1)).cockpit;
  for (const value of [
    wire("snapshot", 90_000, 1, { ...projection(), generation: 90_000 }),
    wire("snapshot", 1, 1, { ...projection(), generation: 90_000 }),
    wire("snapshot", 1, 0, { ...projection(), generation: 1 }),
    wire("snapshot", 1, 1, {}),
  ]) {
    const invalid = message(hello, value);
    assert.equal(boardStatus(invalid.cockpit), "retained");
    assert.equal(invalid.cockpit.fold.needsResync, true);
    assert.deepEqual(board(invalid.cockpit), board(hello));
  }
});

test("recovery: same-generation new link binds, with unknown in-flight effects retained and never resent", () => {
  const c = stepCockpit(liveAt(1), { kind: "dispatch", command: {
    item: 265, lane: "impl", prompt: "synthetic", idempotencyKey: "unknown-effect",
  } }, 0).cockpit;
  const stopped = stepCockpit(c, { kind: "stop" }, 1).cockpit;
  const retry = stepCockpit(stopped, { kind: "start" }, 2).cockpit;
  const hello = message(retry, greet(1));
  assert.equal(boardStatus(hello.cockpit), "retained");
  const ready = message(hello.cockpit, wire("snapshot", 1, 1, {
    ...projection({ runs: [run("unknown", "unknown")] }), generation: 1,
  }));
  assert.equal(boardStatus(ready.cockpit), "synchronized");
  assert.equal(ready.cockpit.inFlight, c.inFlight);
  assert.equal(board(ready.cockpit)?.runs[0]?.outcome, "unknown");
  assert.deepEqual(hello.effects, []);
  assert.deepEqual(ready.effects, []);
});

test("recovery: each connect clears an inherited legacy binding; a held live start does not", () => {
  const healthy = liveAt(8);
  const { bound: omitted, ...legacy } = healthy.fold;
  void omitted;
  for (const state of ["idle", "stopped", "waiting"] as const) {
    // A consumer upgrading an old-shaped retained value has not passed through the new loss path.
    const inherited: Cockpit = { ...healthy, fold: legacy,
      loop: { ...healthy.loop, state, retryAt: state === "waiting" ? 1000 : null } };
    const result = stepCockpit(inherited, { kind: state === "waiting" ? "tick" : "start" }, 1000);
    assert.equal(only(result, "open").link, 2);
    retained(inherited, result.cockpit);
  }
  const held = stepCockpit(healthy, { kind: "start" }, 1000);
  assert.equal(held.cockpit.fold, healthy.fold);
  assert.equal(boardStatus(held.cockpit), "synchronized");
  assert.deepEqual(held.effects, []);
});
