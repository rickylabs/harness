import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PROGRESS_BUCKETS,
  progressOf,
  type ProgressBucket,
  type TaskView,
} from "./tasks.js";

function task(number: number, bucket: ProgressBucket): TaskView {
  return {
    number,
    title: `task ${number}`,
    url: `https://github.com/rickylabs/harness/issues/${number}`,
    kind: "issue",
    state: "open",
    phase: { label: "status:impl", name: "impl", terminal: false, queued: false },
    bucket,
    milestone: null,
    epic: null,
    lane: null,
    priority: null,
    type: null,
    assignees: [],
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    isEpic: false,
  };
}

test("progress buckets are unique", () => {
  assert.equal(new Set(PROGRESS_BUCKETS).size, PROGRESS_BUCKETS.length);
});

test("an empty board counts as zero, not as nothing", () => {
  const progress = progressOf([]);
  assert.equal(progress.total, 0);
  for (const bucket of PROGRESS_BUCKETS) {
    assert.equal(progress[bucket], 0, bucket);
  }
});

test("every bucket is counted where it says it belongs", () => {
  const tasks = PROGRESS_BUCKETS.map((bucket, index) => task(index + 1, bucket));
  const progress = progressOf(tasks);
  for (const bucket of PROGRESS_BUCKETS) {
    assert.equal(progress[bucket], 1, bucket);
  }
});

test("the buckets sum to the total", () => {
  const tasks = [
    task(1, "shipped"),
    task(2, "inFlight"),
    task(3, "inFlight"),
    task(4, "queued"),
    task(5, "blocked"),
    task(6, "invisible"),
    task(7, "abandoned"),
    task(8, "unknown"),
  ];
  const progress = progressOf(tasks);
  const sum = PROGRESS_BUCKETS.reduce((acc, bucket) => acc + progress[bucket], 0);
  assert.equal(sum, progress.total);
  assert.equal(progress.total, 8);
  assert.equal(progress.inFlight, 2);
});

test("in flight is counted, never inferred as the remainder", () => {
  // The projector once computed running work as everything it had no bucket for, and reported
  // `60 running` on a board with two agents running. Six unrecognised tasks must not become six
  // running ones.
  const tasks = [
    task(1, "inFlight"),
    task(2, "inFlight"),
    ...[3, 4, 5, 6, 7, 8].map((n) => task(n, "nonsense" as ProgressBucket)),
  ];
  const progress = progressOf(tasks);
  assert.equal(progress.inFlight, 2);
  assert.equal(progress.unknown, 6);
  assert.equal(progress.total, 8);
});

test("a bucket named after a prototype method is unknown, not a count on Object.prototype", () => {
  const progress = progressOf([task(1, "toString" as ProgressBucket)]);
  assert.equal(progress.unknown, 1);
  assert.equal(progress.total, 1);
  const sum = PROGRESS_BUCKETS.reduce((acc, bucket) => acc + progress[bucket], 0);
  assert.equal(sum, 1);
});

test("an unrecognised bucket is counted as unknown rather than dropped", () => {
  const progress = progressOf([task(1, "shipped"), task(2, "from-a-newer-server" as ProgressBucket)]);
  assert.equal(progress.total, 2);
  assert.equal(progress.shipped, 1);
  assert.equal(progress.unknown, 1);
});
