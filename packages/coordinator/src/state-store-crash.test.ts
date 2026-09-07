import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { SessionPending, StoreCheckpoint, StoreEntry, StoreHolder } from "@rickylabs/harness-contracts";
import { FileStateStore, claimName } from "./state-store-fs.js";
import { checkpointOf, foldStore, genesisOf, readStoreRecord } from "./state-store.js";
import { clock, key, refusal, SCOPE, value, withStoreDirectory } from "./state-store-test-helpers.js";
const storeAt = (directory: string) => new FileStateStore({ directory, scope: SCOPE, clock });
async function recover(directory: string) {
  const store = storeAt(directory); const opened = await store.open(); refusal(opened, "stale-lock");
  assert.equal(opened.ok, false);
  if (opened.ok || opened.refusal.kind !== "stale-lock") throw new Error("expected dead holder");
  return value(await store.recover(opened.refusal.holder));
}
for (const phase of ["mid-temp-write", "file-synced", "published"]) {
  test(`SIGKILL checkpoint at ${phase} preserves exactly old or new checkpoint and unresolved evidence`, () => withStoreDirectory(async (directory, spawn) => {
    const seed = value(await storeAt(directory).open()); const old = value(await seed.initialize()); value(await seed.close());
    const child = spawn("checkpoint", phase, "checkpoint"); await child.wait("reached"); await child.kill();
    const cp = value(readStoreRecord(await readFile(join(directory, "checkpoint"), "utf8"), "checkpoint", "checkpoint")) as StoreCheckpoint;
    const entries: StoreEntry[] = [];
    for (const name of (await readdir(directory)).filter(n => n.startsWith("entry.")).sort()) entries.push(value(readStoreRecord(await readFile(join(directory, name), "utf8"), "entry", name)) as StoreEntry);
    const expectedState = value(foldStore(genesisOf(SCOPE, 1, clock()), entries, 2));
    const next = checkpointOf(SCOPE, 2, entries, expectedState, clock());
    assert.ok(cp.digest === old.digest || cp.digest === next.digest);
    assert.equal(cp.digest, phase === "published" ? next.digest : old.digest);
    const handle = await recover(directory);
    const state = value(await handle.read());
    assert.deepEqual(state.terminal.map(e => [e.key.task, e.status]), [["cross-cut", "unknown"], ["sent", "sent"], ["unsent", "unsent"]]);
    assert.equal(state.pending.length, 0);
    const orphan = state.terminal.find(e => e.key.task === "cross-cut")!;
    const forged: SessionPending = { ...orphan, status: "pending" };
    refusal(await handle.receipt(forged, { delivered: false, reason: "guess after crash" }), "receipt-after-orphan");
    value(await handle.checkpoint()); value(await handle.close());
    const again = value(await storeAt(directory).open()); assert.deepEqual(value(await again.read()).terminal, state.terminal); value(await again.close());
  }));
}
test("SIGKILL after attempted effect and before receipt yields unknown with sent and unsent controls", () => withStoreDirectory(async (directory, spawn) => {
  const seed = value(await storeAt(directory).open()); value(await seed.initialize());
  const sent = value(await seed.intent(key("sent"))); value(await seed.receipt(sent, { delivered: true, reference: "known-delivery" }));
  const unsent = value(await seed.intent(key("unsent"))); value(await seed.receipt(unsent, { delivered: false, reason: "known-refusal" }));
  value(await seed.checkpoint()); value(await seed.close());
  const child = spawn("intent"); await child.wait("reached");
  assert.equal(await readFile(join(directory, "cand.effect-attempted"), "utf8"), "synthetic effect attempted\n");
  await child.kill(); const handle = await recover(directory);
  const state = value(await handle.read());
  assert.deepEqual(state.terminal.map(e => [e.key.task, e.status]), [["attempted", "unknown"], ["sent", "sent"], ["unsent", "unsent"]]);
  assert.equal(state.pending.length, 0); value(await handle.close());
}));
for (const phase of ["mid-temp-write", "file-synced", "published"]) {
  test(`SIGKILL acquisition at ${phase}: unpublished candidates never own and published claims never repeat`, () => withStoreDirectory(async (directory, spawn) => {
    const child = spawn("acquire", phase, claimName(1)); await child.wait("reached"); await child.kill();
    const store = storeAt(directory);
    const handle = phase === "published" ? await recover(directory) : value(await store.open());
    assert.equal(handle.holder.generation, phase === "published" ? 2 : 1);
    refusal(await handle.read(), "uninitialised"); value(await handle.initialize()); value(await handle.close());
    const next = value(await store.open()); assert.equal(next.holder.generation, handle.holder.generation + 1); value(await next.close());
  }));
}
test("SIGKILL after claim and before genesis is explicitly recoverable and initialize remains legal", () => withStoreDirectory(async (directory, spawn) => {
  const child = spawn("init-crash"); const reached = await child.wait("reached"); await child.kill();
  const handle = value(await storeAt(directory).recover(reached.holder as StoreHolder));
  refusal(await handle.read(), "uninitialised"); value(await handle.initialize());
  assert.deepEqual(value(await handle.read()), { terminal: [], pending: [], lastEntry: 0 }); value(await handle.close());
}));
