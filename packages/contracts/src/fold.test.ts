import assert from "node:assert/strict";
import { test } from "node:test";

import { PROTOCOL_VERSION } from "./events.js";
import {
  emptyFold,
  foldFromSnapshot,
  foldValue,
  snapshotOf,
  type EventFold,
} from "./fold.js";
import type { GovernanceState, PendingApproval } from "./governance.js";
import type { RemoteSnapshot } from "./snapshot.js";
import type { Lifecycle, Phase, ProgressBucket, TaskView } from "./tasks.js";
import type { RunOutcome, RunView } from "./runs.js";

const REPO = { owner: "rickylabs", name: "harness" } as const;

const TRIAGE: Phase = { label: "status:triage", name: "triage", terminal: false, queued: true };
const SHIPPED: Phase = { label: "status:shipped", name: "shipped", terminal: true, queued: false };
const LIFECYCLE: Lifecycle = { prefix: "status:", phases: [TRIAGE, SHIPPED] };

const T0 = "2026-09-01T00:00:00.000Z";

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
    branch: "feat/80-replay",
    identity: {
      harness: "claude",
      model: "opus-5",
      effort: "medium",
      provider: null,
      profile: null,
    },
    usage: {},
    outcome,
    item: 80,
    linkedIssues: [{ number: 80, from: "path" }],
    liveness: { state: "live", evidence: "turn", at: T0, ageMs: 0 },
    quota: null,
  };
}

function approval(id: string): PendingApproval {
  return {
    id,
    kind: "dispatch-admission",
    summary: `admit ${id}`,
    item: 80,
    runId: null,
    regime: "subscription",
    requestedAt: T0,
    expiresAt: null,
  };
}

function governance(pending: readonly PendingApproval[] = []): GovernanceState {
  return {
    generatedAt: T0,
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
  readonly generatedAt?: string;
  readonly complete?: boolean;
}

function board(generation: number, parts: SnapshotParts = {}): RemoteSnapshot {
  return {
    protocol: PROTOCOL_VERSION,
    generation,
    generatedAt: parts.generatedAt ?? T0,
    complete: parts.complete ?? true,
    repo: REPO,
    lifecycle: LIFECYCLE,
    tasks: parts.tasks ?? [],
    runs: parts.runs ?? [],
    anomalies: [],
    governance: parts.governance ?? governance(),
    notes: [],
  };
}

function frame(kind: string, generation: number, seq: number, payload: unknown): unknown {
  return { kind, generation, seq, at: `2026-09-01T00:00:00.${String(seq).padStart(3, "0")}Z`, payload };
}

function hello(generation: number, protocol: number = PROTOCOL_VERSION): unknown {
  return frame("hello", generation, 0, { protocol, repo: REPO });
}

function feed(fold: EventFold, values: readonly unknown[]): EventFold {
  let current = fold;
  for (const value of values) current = foldValue(current, value).fold;
  return current;
}

/** The part of the state that two converged clients must agree on, whatever route it arrived by. */
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

test("an empty fold has no board to show", () => {
  const fold = emptyFold();
  assert.equal(snapshotOf(fold), null);
  assert.equal(fold.generation, null);
  assert.equal(fold.needsResync, false);
});

test("hello binds a generation and asks for a snapshot without pretending to have one", () => {
  const step = foldValue(emptyFold(), hello(7));
  assert.equal(step.outcome, "applied");
  assert.equal(step.fold.generation, 7);
  assert.equal(step.fold.lastSeq, 0);
  assert.equal(step.fold.needsResync, true);
  assert.equal(snapshotOf(step.fold), null);
});

test("a hello from a dead generation cannot reset a live fold", () => {
  // The failure this prevents: an abandoned socket delivers its queued hello after a newer one has
  // been established. Accepting it rebinds the fold to a connection nobody is reading, so the
  // snapshot that would repair it is sent somewhere the client will never look.
  const live = feed(emptyFold(), [hello(8), frame("snapshot", 8, 1, board(8, { tasks: [task(1)] }))]);
  const step = foldValue(live, hello(7));
  assert.equal(step.outcome, "discarded");
  assert.equal(step.fold.generation, 8);
  assert.equal(step.fold.tasks.size, 1);
});

test("a repeated hello for the current generation is discarded", () => {
  const live = feed(emptyFold(), [hello(8), frame("snapshot", 8, 1, board(8, { tasks: [task(1)] }))]);
  const step = foldValue(live, hello(8));
  assert.equal(step.outcome, "discarded");
  assert.equal(step.fold.tasks.size, 1);
  assert.equal(step.fold.needsResync, false);
});

test("a reconnect keeps the last board on screen until its snapshot lands", () => {
  // Blanking on every bind would make the one event that means "we are back" look like a fault.
  const live = feed(emptyFold(), [hello(8), frame("snapshot", 8, 1, board(8, { tasks: [task(1)] }))]);
  const rebound = foldValue(live, hello(9)).fold;
  const shown = snapshotOf(rebound);
  if (shown === null) throw new Error("the fold blanked itself on reconnect");
  assert.equal(shown.tasks.length, 1);
  assert.equal(rebound.needsResync, true);
  assert.equal(rebound.generation, 9);
});

test("a protocol this client cannot speak is refused, and no generation is adopted", () => {
  const step = foldValue(emptyFold(), hello(7, PROTOCOL_VERSION + 1));
  assert.equal(step.outcome, "refused");
  assert.equal(step.fold.generation, null);
  assert.match(step.detail, /protocol/);
});

test("a delta from another generation is discarded and changes nothing", () => {
  const live = feed(emptyFold(), [hello(8), frame("snapshot", 8, 1, board(8, { tasks: [task(1)] }))]);
  const step = foldValue(live, frame("task.upserted", 7, 2, task(2)));
  assert.equal(step.outcome, "discarded");
  assert.equal(step.fold.tasks.size, 1);
  // The discarded frame's seq belongs to another sequence, so it must not move this one.
  assert.equal(step.fold.lastSeq, 1);
});

test("a snapshot whose payload names another generation is discarded", () => {
  const bound = foldValue(emptyFold(), hello(8)).fold;
  const step = foldValue(bound, frame("snapshot", 8, 1, board(7, { tasks: [task(1)] })));
  assert.equal(step.outcome, "discarded");
  assert.equal(snapshotOf(step.fold), null);
});

test("a delta arriving before any snapshot is discarded and asks for one", () => {
  const bound = foldValue(emptyFold(), hello(8)).fold;
  const step = foldValue(bound, frame("task.upserted", 8, 1, task(1)));
  assert.equal(step.outcome, "discarded");
  assert.equal(snapshotOf(step.fold), null);
  assert.notEqual(step.resync, null);
  assert.equal(step.fold.needsResync, true);
  // The seq was real, so it advances: the absence is one problem, not one per frame that follows.
  assert.equal(step.fold.lastSeq, 1);
});

test("a gap applies the frame it found and still asks for a resync", () => {
  const live = feed(emptyFold(), [hello(8), frame("snapshot", 8, 1, board(8, { tasks: [task(1)] }))]);
  const step = foldValue(live, frame("task.upserted", 8, 4, task(2)));
  assert.equal(step.outcome, "applied");
  assert.equal(step.fold.tasks.size, 2);
  assert.equal(step.fold.counts.gapped, 2);
  assert.equal(step.fold.needsResync, true);
  assert.deepEqual(step.resync, { kind: "resync", generation: 8, lastSeq: 4 });
});

test("a snapshot clears needsResync even when it arrives after a gap", () => {
  const gapped = feed(emptyFold(), [
    hello(8),
    frame("snapshot", 8, 1, board(8, { tasks: [task(1)] })),
    frame("task.upserted", 8, 4, task(2)),
  ]);
  assert.equal(gapped.needsResync, true);
  const repaired = foldValue(gapped, frame("snapshot", 8, 5, board(8, { tasks: [task(1), task(2)] })));
  assert.equal(repaired.fold.needsResync, false);
  assert.equal(repaired.resync, null);
});

test("a replayed older frame cannot overwrite a newer value", () => {
  // Whole-value deltas are idempotent but not commutative: applying version 1 after version 2
  // resurrects the older value, and nothing later corrects it.
  const live = feed(emptyFold(), [
    hello(8),
    frame("snapshot", 8, 1, board(8, { tasks: [task(1)] })),
    frame("task.upserted", 8, 2, task(1, "shipped", SHIPPED)),
  ]);
  assert.equal(live.tasks.get(1)?.bucket, "shipped");
  const step = foldValue(live, frame("task.upserted", 8, 2, task(1, "queued", TRIAGE)));
  assert.equal(step.outcome, "discarded");
  assert.equal(step.fold.tasks.get(1)?.bucket, "shipped");
});

test("an unknown kind advances the sequence and is counted, not mourned", () => {
  // A server that learned to report something new must not look like a lossy link.
  const live = feed(emptyFold(), [hello(8), frame("snapshot", 8, 1, board(8))]);
  const step = foldValue(live, frame("run.paused", 8, 2, { id: "r1" }));
  assert.equal(step.outcome, "counted");
  assert.equal(step.fold.lastSeq, 2);
  assert.equal(step.fold.counts.counted, 1);
  assert.equal(step.fold.counts.gapped, 0);
  assert.equal(step.resync, null);
  assert.equal(step.fold.needsResync, false);

  const after = foldValue(step.fold, frame("task.upserted", 8, 3, task(5)));
  assert.equal(after.outcome, "applied");
  assert.equal(after.fold.counts.gapped, 0);
});

test("an unreadable frame does not advance the sequence, so the next frame reports the loss", () => {
  const live = feed(emptyFold(), [hello(8), frame("snapshot", 8, 1, board(8))]);
  const refused = foldValue(live, { kind: "task.upserted", generation: 8, seq: "two", at: T0 });
  assert.equal(refused.outcome, "refused");
  assert.equal(refused.fold.lastSeq, 1);
  assert.equal(refused.fold.counts.refused, 1);

  const next = foldValue(refused.fold, frame("task.upserted", 8, 3, task(5)));
  assert.equal(next.fold.counts.gapped, 1);
  assert.notEqual(next.resync, null);
});

test("a task leaving the board is removed; reaching a terminal phase is an upsert", () => {
  const live = feed(emptyFold(), [
    hello(8),
    frame("snapshot", 8, 1, board(8, { tasks: [task(1), task(2)] })),
    frame("task.upserted", 8, 2, task(1, "shipped", SHIPPED)),
    frame("task.removed", 8, 3, { number: 2 }),
  ]);
  assert.equal(live.tasks.size, 1);
  assert.equal(live.tasks.get(1)?.phase?.name, "shipped");
  assert.equal(live.tasks.has(2), false);
});

test("runs replace by id, and the other collections replace wholesale", () => {
  const live = feed(emptyFold(), [
    hello(8),
    frame("snapshot", 8, 1, board(8, { runs: [run("r1"), run("r2")] })),
    frame("run.upserted", 8, 2, run("r1", "complete")),
    frame("anomalies.changed", 8, 3, {
      complete: false,
      anomalies: [{ kind: "incomplete-fetch", item: null, detail: "capped at 100" }],
    }),
  ]);
  assert.equal(live.runs.size, 2);
  assert.equal(live.runs.get("r1")?.outcome, "complete");
  assert.equal(live.complete, false);
  assert.equal(live.anomalies.length, 1);
});

test("an approval is requested once and resolved away", () => {
  const live = feed(emptyFold(), [
    hello(8),
    frame("snapshot", 8, 1, board(8)),
    frame("approval.requested", 8, 2, approval("a1")),
    frame("approval.requested", 8, 3, approval("a1")),
    frame("approval.requested", 8, 4, approval("a2")),
  ]);
  assert.equal(live.governance?.pending.length, 2);

  const settled = foldValue(live, frame("approval.resolved", 8, 5, { id: "a1", verdict: "approve", at: T0, by: null }));
  assert.deepEqual(settled.fold.governance?.pending.map((p) => p.id), ["a2"]);
});

test("the fold holds nothing a snapshot cannot restore", () => {
  // The whole of criterion 1. Anything the fold accumulated that a snapshot has nowhere to put
  // would be state two clients could disagree about forever, with no way to converge.
  const live = feed(emptyFold(), [
    hello(8),
    frame("snapshot", 8, 1, board(8, { tasks: [task(1), task(2)], runs: [run("r1")] })),
    frame("task.upserted", 8, 2, task(3)),
    frame("approval.requested", 8, 3, approval("a1")),
    frame("governance.changed", 8, 4, governance([approval("a1")])),
  ]);
  const materialised = snapshotOf(live);
  if (materialised === null) throw new Error("fold has no snapshot");
  const reseeded = foldFromSnapshot(materialised);
  assert.equal(stateOf(reseeded), stateOf(live));
});

test("a client that drops deltas converges on a resync", () => {
  // Criterion 4, and the reason deltas are allowed to be lossy at all.
  const heard: readonly unknown[] = [
    hello(8),
    frame("snapshot", 8, 1, board(8, { tasks: [task(1), task(2)] })),
    frame("task.upserted", 8, 2, task(3)),
    frame("task.removed", 8, 3, { number: 1 }),
    frame("task.upserted", 8, 4, task(4)),
  ];
  const complete = feed(emptyFold(), heard);
  assert.deepEqual([...complete.tasks.keys()].sort((a, b) => a - b), [2, 3, 4]);

  // The same connection, with the two middle frames lost on the way to a phone.
  const lossy = feed(emptyFold(), [heard[0], heard[1], heard[4]]);
  assert.equal(lossy.needsResync, true);
  assert.equal(lossy.counts.gapped, 2);
  assert.notEqual(stateOf(lossy), stateOf(complete));

  // The server answers the resync with the board as it stands now.
  const converged = foldValue(
    lossy,
    frame("snapshot", 8, 5, board(8, { tasks: [task(2), task(3), task(4)], generatedAt: "2026-09-01T00:05:00.000Z" })),
  ).fold;
  assert.equal(converged.needsResync, false);
  assert.equal(stateOf(converged), stateOf(complete));
});

test("a reconnect replays the whole board, and the old generation cannot touch it", () => {
  // Criteria 1 and 2 together: the snapshot alone is sufficient, and a frame that outlived its
  // connection is identified by data rather than by when it happened to arrive.
  const before = feed(emptyFold(), [
    hello(8),
    frame("snapshot", 8, 1, board(8, { tasks: [task(1), task(2)] })),
    frame("task.upserted", 8, 2, task(3)),
  ]);

  const after = feed(before, [
    hello(9),
    // Two stragglers from the socket that has just been replaced.
    frame("task.upserted", 8, 3, task(99)),
    frame("task.removed", 8, 4, { number: 2 }),
    frame("snapshot", 9, 1, board(9, { tasks: [task(1), task(2), task(3)] })),
  ]);

  assert.equal(after.generation, 9);
  assert.equal(after.needsResync, false);
  assert.equal(after.tasks.has(99), false);
  assert.equal(after.tasks.has(2), true);
  assert.equal(stateOf(after), stateOf(before));
});

test("two clients that heard the same events in a different order agree", () => {
  const one = feed(emptyFold(), [
    hello(8),
    frame("snapshot", 8, 1, board(8, { tasks: [task(3), task(1), task(2)], runs: [run("r2"), run("r1")] })),
  ]);
  const other = feed(emptyFold(), [
    hello(8),
    frame("snapshot", 8, 1, board(8, { tasks: [task(1), task(2), task(3)], runs: [run("r1"), run("r2")] })),
  ]);
  assert.equal(stateOf(one), stateOf(other));
});

test("the counts tell forward compatibility apart from loss", () => {
  const fold = feed(emptyFold(), [
    hello(8),
    frame("snapshot", 8, 1, board(8)),
    frame("run.paused", 8, 2, {}),
    frame("task.upserted", 8, 5, task(1)),
    frame("task.upserted", 7, 6, task(2)),
    "not a frame",
  ]);
  assert.equal(fold.counts.applied, 3);
  assert.equal(fold.counts.counted, 1);
  assert.equal(fold.counts.discarded, 1);
  assert.equal(fold.counts.refused, 1);
  assert.equal(fold.counts.gapped, 2);
  assert.equal(fold.counts.resyncs, 1);
});
