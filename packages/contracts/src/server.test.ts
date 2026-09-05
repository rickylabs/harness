import assert from "node:assert/strict";
import { test } from "node:test";

import { PROTOCOL_VERSION, type ServerEvent } from "./events.js";
import { emptyFold, foldValue, snapshotOf, type EventFold } from "./fold.js";
import type { GovernanceState, PendingApproval } from "./governance.js";
import type { BoardAnomaly, Lifecycle, Phase, ProgressBucket, TaskView } from "./tasks.js";
import type { RemoteSnapshot } from "./snapshot.js";
import type { RunOutcome, RunView } from "./runs.js";
import {
  announce,
  changes,
  hubReport,
  openHub,
  planUpdate,
  pollingSuspects,
  publish,
  resync,
  subscribe,
  unexpressible,
  unsubscribe,
  type Hub,
  type HubStep,
} from "./server.js";

const REPO = { owner: "rickylabs", name: "harness" } as const;

const TRIAGE: Phase = { label: "status:triage", name: "triage", terminal: false, queued: true };
const SHIPPED: Phase = { label: "status:shipped", name: "shipped", terminal: true, queued: false };
const LIFECYCLE: Lifecycle = { prefix: "status:", phases: [TRIAGE, SHIPPED] };

const T0 = "2026-09-01T00:00:00.000Z";
const NOW = "2026-09-05T12:00:00.000Z";

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
    branch: "feat/84-push",
    identity: { harness: "claude", model: "opus-5", effort: "medium", provider: null, profile: null },
    usage: {},
    outcome,
    item: 84,
    linkedIssues: [{ number: 84, from: "path" }],
    liveness: { state: "live", evidence: "turn", at: T0, ageMs: 0 },
    quota: null,
  };
}

function approval(id: string): PendingApproval {
  return {
    id,
    kind: "dispatch-admission",
    summary: `admit ${id}`,
    item: 84,
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
  readonly lifecycle?: Lifecycle;
  readonly protocol?: number;
}

function board(parts: SnapshotParts = {}): RemoteSnapshot {
  return {
    protocol: parts.protocol ?? PROTOCOL_VERSION,
    // The hub stamps the connection's own generation on the way out, so what a projection puts here
    // is never what a client sees.
    generation: 0,
    generatedAt: T0,
    complete: parts.complete ?? true,
    repo: REPO,
    lifecycle: parts.lifecycle ?? LIFECYCLE,
    tasks: parts.tasks ?? [],
    runs: parts.runs ?? [],
    anomalies: parts.anomalies ?? [],
    governance: parts.governance ?? governance(),
    notes: parts.notes ?? [],
  };
}

/** Everything two converged clients must agree on. Excludes connection bookkeeping and the clock. */
function stateOf(fold: EventFold): string {
  const snapshot = snapshotOf(fold);
  if (snapshot === null) throw new Error("fold has no snapshot");
  return JSON.stringify({
    complete: snapshot.complete,
    lifecycle: snapshot.lifecycle,
    tasks: snapshot.tasks,
    runs: snapshot.runs,
    anomalies: snapshot.anomalies,
    governance: snapshot.governance,
    notes: snapshot.notes,
  });
}

/** The same shape, read off the board the hub is serving. `snapshotOf` sorts, so this sorts too. */
function boardOf(snapshot: RemoteSnapshot): string {
  return JSON.stringify({
    complete: snapshot.complete,
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

function feed(fold: EventFold, frames: readonly ServerEvent[]): EventFold {
  let current = fold;
  for (const frame of frames) current = foldValue(current, frame).fold;
  return current;
}

function kinds(step: HubStep, id: string): readonly string[] {
  return framesFor(step, id).map((frame) => frame.kind);
}

function seen(hub: Hub, id: string) {
  const subscriber = hub.subscribers.get(id);
  if (subscriber === undefined) throw new Error(`no connection ${id}`);
  return subscriber;
}

test("a new connection is greeted, then handed the whole board", () => {
  const state = board({ tasks: [task(1)] });
  const step = subscribe(openHub(state), "c1", NOW);

  assert.deepEqual(kinds(step, "c1"), ["hello", "snapshot"]);
  const [hello, snapshot] = framesFor(step, "c1");
  assert.deepEqual(hello, {
    kind: "hello",
    generation: 1,
    seq: 0,
    at: NOW,
    payload: { protocol: PROTOCOL_VERSION, repo: REPO },
  });
  assert.equal(snapshot?.seq, 1);
  assert.equal(snapshot?.generation, 1);
  // The projection said generation 0; the connection is generation 1, and only the hub knows that.
  assert.equal((snapshot?.payload as RemoteSnapshot).generation, 1);
  assert.deepEqual(seen(step.hub, "c1"), {
    id: "c1",
    generation: 1,
    seq: 1,
    frames: 2,
    snapshots: 1,
    resyncs: 0,
    since: NOW,
  });
});

test("each connection is numbered on its own, so one cockpit opening does not disturb another", () => {
  // On a shared counter, the hello and snapshot sent to a new client would be numbers every other
  // client never receives — read as loss, answered with a resync. Opening a phone would make every
  // screen in the house refetch the board.
  const first = subscribe(openHub(board({ tasks: [task(1)] })), "c1", NOW);
  const moved = publish(first.hub, board({ tasks: [task(1, "inFlight")] }), NOW);
  const second = subscribe(moved.hub, "c2", NOW);

  assert.deepEqual(
    framesFor(moved, "c1").map((frame) => [frame.generation, frame.seq]),
    [[1, 2]],
  );
  assert.deepEqual(
    framesFor(second, "c2").map((frame) => [frame.generation, frame.seq]),
    [
      [2, 0],
      [2, 1],
    ],
  );
  assert.equal(framesFor(second, "c1").length, 0, "a greeting is addressed, not broadcast");
  assert.equal(seen(second.hub, "c1").seq, 2, "the older connection keeps its own count");
});

test("a fold fed the hub's own frames holds the hub's board", () => {
  // The round trip is the whole point of keeping both halves in one package: `changes` and the fold
  // are one argument split in two, and they are only correct together.
  const first = board({ tasks: [task(1), task(2)], runs: [run("r1")] });
  const opened = subscribe(openHub(first), "c1", NOW);
  let fold = feed(emptyFold(), framesFor(opened, "c1"));
  assert.equal(stateOf(fold), boardOf(first));

  const second = board({ tasks: [task(1), task(2, "inFlight")], runs: [run("r1"), run("r2")] });
  const moved = publish(opened.hub, second, NOW);
  assert.deepEqual(kinds(moved, "c1"), ["task.upserted", "run.upserted"]);
  fold = feed(fold, framesFor(moved, "c1"));
  assert.equal(stateOf(fold), boardOf(second));

  const third = board({
    tasks: [task(2, "shipped", SHIPPED)],
    runs: [run("r1"), run("r2", "complete")],
    complete: false,
    governance: governance([approval("a1")], "2026-09-05T11:00:00.000Z"),
  });
  const again = publish(moved.hub, third, NOW);
  fold = feed(fold, framesFor(again, "c1"));
  assert.equal(stateOf(fold), boardOf(third));
  assert.equal(fold.needsResync, false, "no gap, so nothing to repair");
});

test("a board that did not change sends nothing", () => {
  // This is the "stop asking" claim in one line. Silence means the board has not moved, and it costs
  // one comparison on the server and no bytes on the wire.
  const opened = subscribe(openHub(board({ tasks: [task(1)], runs: [run("r1")] })), "c1", NOW);
  // Rebuilt rather than reused, so it is equality doing the work and not object identity.
  const identical = board({ tasks: [task(1)], runs: [run("r1")] });
  const step = publish(opened.hub, identical, NOW);

  assert.deepEqual(step.deliveries, []);
  assert.deepEqual(step.notes, []);
  assert.equal(seen(step.hub, "c1").seq, 1, "silence does not consume a sequence number");
});

test("a task leaving the board is a removal; reaching a terminal phase is an upsert", () => {
  const before = board({ tasks: [task(1), task(2)] });
  const after = board({ tasks: [task(2, "shipped", SHIPPED)] });
  const bodies = changes(before, after);

  assert.deepEqual(
    bodies.map((body) => body.kind),
    ["task.upserted", "task.removed"],
  );
  assert.deepEqual(bodies[1]?.payload, { number: 1 });
});

test("a change no delta carries becomes the whole board, and says which change", () => {
  const before = board({ tasks: [task(1)], runs: [run("r1")] });

  const renoted = planUpdate(before, board({ tasks: [task(1)], runs: [run("r1")], notes: ["fetch truncated"] }));
  assert.equal(renoted.snapshot, true);
  assert.deepEqual(renoted.snapshot ? renoted.why : [], ["the notes changed, and no delta carries them"]);

  const relabelled = { prefix: "status:", phases: [TRIAGE] } satisfies Lifecycle;
  const shortened = planUpdate(before, board({ tasks: [task(1)], runs: [run("r1")], lifecycle: relabelled }));
  assert.deepEqual(shortened.snapshot ? shortened.why : [], [
    "the lifecycle changed, and no delta carries it",
  ]);

  // The gap worth naming: the union removes a task and has no counterpart for a run, so any
  // projection with a time window falls back to a whole board every time a run ages out of it.
  const aged = unexpressible(before, board({ tasks: [task(1)] }));
  assert.deepEqual(aged, ["run r1 left the board, and no delta removes a run"]);

  const elsewhere = unexpressible(before, { ...before, repo: { owner: "rickylabs", name: "orchid" } });
  assert.deepEqual(elsewhere, ["the board is about a different repository"]);
  assert.deepEqual(unexpressible(before, { ...before, protocol: 2 }), ["protocol 1 became 2"]);
});

test("a delta stream never carries more items than the snapshot it replaces", () => {
  const before = board({ tasks: [task(1), task(2), task(3)] });

  const emptied = planUpdate(before, board({}));
  assert.equal(emptied.snapshot, true);
  assert.deepEqual(emptied.snapshot ? emptied.why : [], [
    "3 item deltas is more than the 0 a snapshot carries",
  ]);

  // Every task changing is still deltas: three frames against a snapshot that would carry three
  // tasks plus the lifecycle and the whole budget picture.
  const churned = planUpdate(
    before,
    board({ tasks: [task(1, "inFlight"), task(2, "inFlight"), task(3, "inFlight")] }),
  );
  assert.equal(churned.snapshot, false);

  // A governance frame on an empty board is not an item, so it does not tip the balance.
  const quiet = planUpdate(board({}), board({ governance: governance([], "2026-09-05T11:00:00.000Z") }));
  assert.equal(quiet.snapshot, false);
});

test("an approval appearing is announced; one vanishing is not given an invented verdict", () => {
  const waiting = board({ governance: governance([approval("a1")]) });

  const arrived = changes(board({}), waiting);
  assert.deepEqual(
    arrived.map((body) => body.kind),
    ["approval.requested"],
    "the whole approval is in the snapshot, so it needs nothing invented",
  );

  const settled = changes(waiting, board({}));
  assert.deepEqual(
    settled.map((body) => body.kind),
    ["governance.changed"],
  );
  assert.deepEqual((settled[0]?.payload as GovernanceState).pending, []);
});

test("governance.changed comes before the approvals it already contains", () => {
  // Both orders converge, since a whole value is idempotent. This one converges *and* leaves the
  // arrival as the last thing said, instead of announcing an addition and replacing the list after.
  const before = board({ governance: governance([], "2026-09-05T10:00:00.000Z") });
  const after = board({ governance: governance([approval("a1")], "2026-09-05T11:00:00.000Z") });
  assert.deepEqual(
    changes(before, after).map((body) => body.kind),
    ["governance.changed", "approval.requested"],
  );
});

test("a resolution the diff cannot see is announced by the command that made it", () => {
  // Two snapshots say an approval is gone and nothing else. The verdict, the person and the moment
  // belong to the command that decided, and a guess printed as a fact is worse than a gap.
  const opened = subscribe(openHub(board({ governance: governance([approval("a1")]) })), "c1", NOW);
  let fold = feed(emptyFold(), framesFor(opened, "c1"));
  assert.equal(fold.governance?.pending.length, 1);

  const said = announce(
    opened.hub,
    { kind: "approval.resolved", payload: { id: "a1", verdict: "approve", at: NOW, by: "eric" } },
    NOW,
  );
  fold = feed(fold, framesFor(said, "c1"));

  assert.deepEqual(fold.governance?.pending, []);
  assert.equal(seen(said.hub, "c1").seq, 2);
  assert.equal(said.hub.state, opened.hub.state, "an announcement is not a second source of truth");
});

test("a resync is answered with the whole board, and the loss is named", () => {
  const opened = subscribe(openHub(board({ tasks: [task(1)] })), "c1", NOW);
  const moved = publish(opened.hub, board({ tasks: [task(1, "inFlight"), task(2)] }), NOW);
  assert.equal(seen(moved.hub, "c1").seq, 3);

  const step = resync(moved.hub, "c1", { kind: "resync", generation: 1, lastSeq: 1 }, NOW);
  assert.deepEqual(kinds(step, "c1"), ["snapshot"]);
  assert.deepEqual(step.notes, ["connection c1 resynced after losing 2 frames"]);
  assert.equal(seen(step.hub, "c1").resyncs, 1);

  // A client that lost frames and one that lost nothing end up holding the same board.
  const whole = feed(emptyFold(), [...framesFor(opened, "c1"), ...framesFor(moved, "c1")]);
  const lossy = feed(emptyFold(), [...framesFor(opened, "c1"), ...framesFor(step, "c1")]);
  assert.equal(stateOf(lossy), stateOf(whole));
});

test("a resync from a dead generation closes the connection instead of answering it", () => {
  // There is no answer that helps: a snapshot in the current generation is one the client's fold
  // discards, and a snapshot in the generation it named would be a lie. Closing puts it on the path
  // it already has — back off, reconnect, bind, receive a board.
  const opened = subscribe(openHub(board({ tasks: [task(1)] })), "c1", NOW);
  const step = resync(opened.hub, "c1", { kind: "resync", generation: 4 }, NOW);

  assert.deepEqual(step.deliveries, []);
  assert.deepEqual(step.closed, ["c1"]);
  assert.equal(step.hub.subscribers.size, 0);
  assert.match(step.notes[0] ?? "", /asked to resync generation 4 but is generation 1/);
});

test("a resync from a connection the hub does not know is not answered", () => {
  const hub = openHub(board({}));
  const step = resync(hub, "ghost", { kind: "resync", generation: 1 }, NOW);
  assert.deepEqual(step.deliveries, []);
  assert.deepEqual(step.closed, []);
  assert.deepEqual(step.notes, ["resync from unknown connection ghost"]);
  assert.equal(step.hub, hub);
});

test("a connection that keeps asking for the board is named", () => {
  // Criterion 3 has no enforcement point inside this repository — both cockpits are elsewhere. What
  // it can have is evidence, so that a fallback which quietly became the default is visible as a
  // number rather than as a hunch about why the coordinator is busy.
  let step = subscribe(openHub(board({ tasks: [task(1)] })), "c1", NOW);
  assert.deepEqual(pollingSuspects(step.hub), [], "a fresh connection is not a suspect");

  step = resync(step.hub, "c1", { kind: "resync", generation: 1 }, NOW);
  assert.deepEqual(pollingSuspects(step.hub), [], "one resync after a real gap is not a suspicion");

  step = resync(step.hub, "c1", { kind: "resync", generation: 1 }, NOW);
  step = resync(step.hub, "c1", { kind: "resync", generation: 1 }, NOW);
  assert.deepEqual(pollingSuspects(step.hub), ["c1"]);
});

test("a long, healthy connection is not a suspect for having recovered three times", () => {
  let hub = subscribe(openHub(board({ tasks: [task(1)] })), "c1", NOW).hub;
  for (let round = 0; round < 3; round += 1) {
    hub = resync(hub, "c1", { kind: "resync", generation: 1 }, NOW).hub;
  }
  for (let round = 0; round < 30; round += 1) {
    hub = publish(hub, board({ tasks: [task(1, round % 2 === 0 ? "inFlight" : "queued")] }), NOW).hub;
  }
  assert.deepEqual(pollingSuspects(hub), []);
});

test("the report says enough to tell a push from a poll without reading frames", () => {
  let hub = subscribe(openHub(board({ tasks: [task(1)], runs: [run("r1")] })), "c1", NOW).hub;
  for (let round = 0; round < 3; round += 1) {
    hub = resync(hub, "c1", { kind: "resync", generation: 1 }, NOW).hub;
  }
  const lines = hubReport(hub);
  assert.equal(lines[0], `1 connection · next generation 2 · board 1 tasks, 1 runs`);
  assert.match(lines[1] ?? "", /c1 · gen 1 · 5 frames · 4 snapshots · 3 resyncs/);
  assert.equal(lines[2], "  polling suspects: c1");
});

test("a connection the transport lost hears nothing more", () => {
  const opened = subscribe(openHub(board({ tasks: [task(1)] })), "c1", NOW);
  const both = subscribe(opened.hub, "c2", NOW);
  const step = publish(unsubscribe(both.hub, "c1"), board({ tasks: [task(1, "inFlight")] }), NOW);

  assert.deepEqual(
    step.deliveries.map((delivery) => delivery.to),
    ["c2"],
  );
  assert.equal(unsubscribe(step.hub, "c1"), step.hub, "forgetting twice is not a change");
});

test("reconnecting on the same id retires the generation that held it", () => {
  const opened = subscribe(openHub(board({ tasks: [task(1)] })), "c1", NOW);
  const again = subscribe(opened.hub, "c1", NOW);

  assert.equal(again.hub.subscribers.size, 1);
  assert.equal(seen(again.hub, "c1").generation, 2);
  assert.deepEqual(again.notes, ["connection c1 was replaced; generation 1 is now dead"]);

  // Safe because the client sorts it out on its own terms: the replacement's generation is higher,
  // so a straggler from the old socket is discarded by the fold rather than applied.
  const fold = feed(emptyFold(), [...framesFor(again, "c1"), ...framesFor(opened, "c1")]);
  assert.equal(fold.generation, 2);
  assert.equal(fold.counts.discarded, 2);
});

test("a field that differs from itself does not make the board change forever", () => {
  // A single division by zero in a percentage would otherwise put a delta on the wire on every
  // read, about a board that never moved — this module's own failure mode, by the back door.
  const spent = { ...run("r1"), usage: { costUsd: Number.NaN } };
  const opened = subscribe(openHub(board({ runs: [spent] })), "c1", NOW);
  const step = publish(opened.hub, board({ runs: [{ ...run("r1"), usage: { costUsd: Number.NaN } }] }), NOW);
  assert.deepEqual(step.deliveries, []);
});

test("two cockpits that joined at different times hold the same board", () => {
  const first = board({ tasks: [task(1)], runs: [run("r1")] });
  const opened = subscribe(openHub(first), "c1", NOW);

  const second = board({ tasks: [task(1, "inFlight"), task(2)], runs: [run("r1")] });
  const moved = publish(opened.hub, second, NOW);
  const joined = subscribe(moved.hub, "c2", NOW);

  const third = board({
    tasks: [task(1, "inFlight"), task(2, "shipped", SHIPPED)],
    runs: [run("r1", "complete")],
    complete: false,
  });
  const again = publish(joined.hub, third, NOW);
  assert.equal(again.notes.length, 0, "deltas, so the two folds are doing real work");

  const early = feed(
    emptyFold(),
    [opened, moved, again].flatMap((step) => [...framesFor(step, "c1")]),
  );
  const late = feed(emptyFold(), [joined, again].flatMap((step) => [...framesFor(step, "c2")]));

  assert.equal(stateOf(early), boardOf(third));
  assert.equal(stateOf(late), stateOf(early));
});
