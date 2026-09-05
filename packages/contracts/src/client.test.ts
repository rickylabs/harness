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
  cockpitStatus,
  openCockpit,
  stepCockpit,
  waitingOn,
  type Cockpit,
  type CockpitInput,
  type CockpitStep,
  type Effect,
} from "./client.js";

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
