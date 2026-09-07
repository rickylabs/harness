import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir } from "node:fs/promises";
import { FileStateStore } from "@rickylabs/coordinator";
import type { SessionPending, StoreHolder } from "@rickylabs/harness-contracts";
import { driveDryRun, setupDryRun } from "./dry-run.js";
import { driveSnapshot } from "./dry-run-internal.js";
import { withDriverDirectory } from "./dry-run-child-helpers.js";
import { AT, clock, fixture, SCOPE, value } from "./dry-run-test-fixtures.js";
const storeAt = (directory: string) => new FileStateStore({ directory, scope: SCOPE, clock });
const childModule = new URL("./dry-run-child.js", import.meta.url);
for (const phase of ["assembled", "attempted"] as const) test(`SIGKILL after ${phase} preserves the driver boundary and recovery parity`, () => withDriverDirectory(async (directory, spawn) => {
  const store = storeAt(directory); const seed = value(await store.open()); value(await seed.initialize());
  if (phase === "attempted") {
    for (const kind of ["accepted", "refused"] as const) {
      const plan = fixture();
      const outcome = await driveDryRun(seed, { ...plan, attempt: kind === "accepted" ? 2 : 3,
        fake: { ...plan.fake, result: { kind, reason: "synthetic-refusal" } } });
      assert.ok(outcome.drove && "status" in outcome);
    }
  }
  value(await seed.checkpoint()); value(await seed.close());
  const child = spawn(childModule, phase); const reached = await child.wait("reached"); await child.kill();
  const opened = await store.open(); assert.ok(!opened.ok && opened.refusal.kind === "stale-lock");
  const recovered = value(await store.recover(reached.holder as StoreHolder));
  const state = value(await recovered.read()); assert.equal(state.pending.length, 0);
  if (phase === "assembled") {
    assert.equal(state.lastEntry, 0); assert.deepEqual(state.terminal, []);
    const redrive = await driveDryRun(recovered, fixture()); assert.ok(redrive.drove);
    assert.deepEqual(redrive.key, reached.key);
  } else {
    assert.equal(state.lastEntry, 5);
    assert.deepEqual(state.terminal.map(s => s.status).sort(), ["sent", "unknown", "unsent"]);
    const orphan = state.terminal.find(s => s.status === "unknown")!;
    assert.deepEqual(orphan.key, reached.key);
    const forged: SessionPending = { ...orphan, status: "pending" };
    const denied = await recovered.receipt(forged, { delivered: false, reason: "synthetic-guess" });
    assert.ok(!denied.ok && denied.refusal.kind === "receipt-after-orphan");
  }
  const final = value(await recovered.read()); value(await recovered.checkpoint()); value(await recovered.close());
  const again = value(await store.open()); assert.deepEqual(value(await again.read()).terminal, final.terminal); value(await again.close());
}));
test("intent publication uncertainty poisons the owner, skips attempt and refuses live recovery", () => withDriverDirectory(async directory => {
  let fault = false;
  const store = new FileStateStore({ directory, scope: SCOPE, clock, onPoint: p => {
    if (fault && p.record.startsWith("entry.") && p.phase === "published") throw new Error("synthetic publication uncertainty");
  } });
  const handle = value(await store.open()); value(await handle.initialize()); fault = true;
  let attempted = 0;
  const outcome = await driveSnapshot(handle, structuredClone(fixture()), { attempted: () => { attempted++; } });
  assert.ok(!outcome.drove && outcome.refusal.kind === "store-refused");
  assert.equal(outcome.appended, "unknown"); assert.equal(outcome.refusal.operation, "intent"); assert.equal(outcome.refusal.refusal.kind, "publication-uncertain");
  assert.equal(attempted, 0);
  assert.equal((await readdir(directory)).filter(n => n.startsWith("entry.")).length, 1);
  const read = await handle.read(); assert.ok(!read.ok && read.refusal.kind === "poisoned");
  const close = await handle.close(); assert.ok(!close.ok && close.refusal.kind === "poisoned");
  const recovered = await store.recover(handle.holder); assert.ok(!recovered.ok && recovered.refusal.kind === "held");
  const opened = await store.open(); assert.ok(!opened.ok && opened.refusal.kind === "held");
}));
test("receipt publication failure remains pending without acknowledgement, retry or recovery", () => withDriverDirectory(async directory => {
  let publications = 0;
  const store = new FileStateStore({ directory, scope: SCOPE, clock, onPoint: p => {
    if (p.record === "entry.0000000000000002" && p.phase === "file-synced") { publications++; throw new Error("synthetic receipt fault"); }
  } });
  const handle = value(await store.open()); value(await handle.initialize());
  const outcome = await driveDryRun(handle, fixture());
  assert.ok(!outcome.drove && outcome.refusal.kind === "store-refused");
  assert.equal(outcome.appended, "unknown"); assert.equal(outcome.refusal.operation, "receipt"); assert.equal(outcome.refusal.refusal.kind, "io-failure");
  assert.equal(publications, 1);
  const state = value(await handle.read()); assert.equal(state.lastEntry, 1); assert.equal(state.pending.length, 1); assert.equal(state.terminal.length, 0);
  value(await handle.close());
}));
test("setup binds plans to its one scope and refuses handles acquired elsewhere", () => withDriverDirectory(async directory => {
  const setup = setupDryRun({ directory, scope: SCOPE, at: AT }); assert.ok(setup.ok);
  const foreign = value(await storeAt(directory).open()); value(await foreign.initialize());
  const denied = await setup.drive(foreign, fixture()); assert.ok(!denied.drove && denied.appended === 0);
  assert.equal(value(await foreign.read()).lastEntry, 0); value(await foreign.close());
  const owned = value(await setup.store.open());
  const outcome = await setup.drive(owned, { ...fixture(), scope: { repository: "other/project", milestone: "wrong" } } as ReturnType<typeof fixture>);
  assert.ok(outcome.drove); assert.equal(outcome.key.repository, SCOPE.repository); value(await owned.close());
}));
test("malformed setup data never constructs an acknowledged setup", () => {
  for (const options of [null, [], { directory: 7, scope: SCOPE, at: AT }, { directory: "/synthetic", scope: [], at: AT }]) {
    const result = setupDryRun(options as unknown as Parameters<typeof setupDryRun>[0]);
    assert.ok(!result.ok && result.refusal.kind === "source-unusable");
  }
});
