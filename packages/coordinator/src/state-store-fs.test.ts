import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OwnerClaim, StoreHolder } from "@rickylabs/harness-contracts";
import { FileStateStore, claimName, closedName, entryName } from "./state-store-fs.js";
import { envelope } from "./state-store.js";
import { intentEntryOf } from "./journal.js";
import { AT, clock, key, refusal, SCOPE, value, withStoreDirectory } from "./state-store-test-helpers.js";
const storeAt = (directory: string) => new FileStateStore({ directory, scope: SCOPE, clock });

test("second real opener names the live holder and never publishes a successor", () => withStoreDirectory(async directory => {
  const store = storeAt(directory); const first = value(await store.open());
  const blocked = await store.open(); refusal(blocked, "held");
  if (!blocked.ok && blocked.refusal.kind === "held") assert.deepEqual(blocked.refusal.holder, first.holder);
  assert.deepEqual((await readdir(directory)).filter(n => n.endsWith(".claim")), [claimName(1)]);
  assert.equal(first.holder.owner.pid, process.pid);
  const identity = first.holder; (identity.owner as { startToken: string }).startToken = "caller mutation";
  assert.notEqual(first.holder.owner.startToken, identity.owner.startToken);
  value(await first.close()); const second = value(await store.open());
  assert.equal(second.holder.generation, 2); assert.notEqual(first.holder.owner.startToken, second.holder.owner.startToken);
  value(await second.close());
}));
test("real child owns the store; dead open refuses and explicit recovery checks exact identity", () => withStoreDirectory(async (directory, spawn) => {
  const child = spawn("holder"); const reached = await child.wait("reached");
  const expected = reached.holder as StoreHolder;
  refusal(await storeAt(directory).open(), "held");
  await child.kill(); const store = storeAt(directory);
  const stale = await store.open(); refusal(stale, "stale-lock");
  if (!stale.ok && stale.refusal.kind === "stale-lock") assert.deepEqual(stale.refusal.holder, expected);
  refusal(await store.recover({ ...expected, generation: expected.generation + 1 }), "holder-changed");
  const next = value(await store.recover(expected)); assert.equal(next.holder.generation, expected.generation + 1);
  value(await next.initialize()); value(await next.close());
}));
test("same predecessor contenders in real processes target one successor and never retry", () => withStoreDirectory(async (directory, spawn) => {
  const first = value(await storeAt(directory).open()); value(await first.close());
  const children = [spawn("race"), spawn("race"), spawn("race")];
  await Promise.all(children.map(c => c.wait("reached")));
  for (const child of children) child.process.send("continue");
  const results = await Promise.all(children.map(c => c.wait("result")));
  const values = results.map(r => r.result as { ok: boolean; refusal?: { kind: string }; holder?: StoreHolder });
  assert.equal(values.filter(r => r.ok).length, 1);
  assert.deepEqual(values.filter(r => !r.ok).map(r => r.refusal?.kind), ["lost-race", "lost-race"]);
  assert.equal(values.find(r => r.ok)?.holder?.generation, 2);
  assert.deepEqual((await readdir(directory)).filter(n => n.endsWith(".claim")), [claimName(1), claimName(2)]);
}));
test("close drains existing calls, seals immediately, and publishes a marker after the last entry", () => withStoreDirectory(async directory => {
  const store = storeAt(directory); const handle = value(await store.open()); value(await handle.initialize());
  const a = handle.intent(key("a")); const b = handle.intent(key("b")); const closing = handle.close();
  refusal(await handle.intent(key("late")), "closed");
  value(await a); value(await b); value(await closing); value(await handle.close());
  const marker = JSON.parse(await readFile(join(directory, closedName(1)), "utf8")) as { lastEntry: number };
  assert.equal(marker.lastEntry, 2);
  const next = value(await store.open()); assert.deepEqual(value(await next.read()).terminal.map(e => e.status), ["unknown", "unknown"]); value(await next.close());
}));
test("inputs and returned values are detached; invalid inputs never publish", () => withStoreDirectory(async directory => {
  const handle = value(await storeAt(directory).open()); value(await handle.initialize());
  const input = { ...key() }; const operation = handle.intent(input); input.task = "mutated";
  const pending = value(await operation); assert.equal(pending.key.task, "task");
  (pending.key as { task: string }).task = "changed-again";
  assert.equal(value(await handle.read()).pending[0]?.key.task, "task");
  refusal(await handle.intent({ ...key(), attempt: 0 }), "invalid-input");
  refusal(await handle.intent({ ...key(), repository: "other" }), "invalid-input");
  assert.equal(value(await handle.read()).lastEntry, 1); value(await handle.close());
}));
test("checkpoint-cut receipt remains sent across a clean reopen", () => withStoreDirectory(async directory => {
  const store = storeAt(directory); const handle = value(await store.open()); value(await handle.initialize());
  const p = value(await handle.intent(key())); value(await handle.checkpoint());
  value(await handle.receipt(p, { delivered: true, reference: "receipt-after-cut" })); value(await handle.close());
  const next = value(await store.open()); assert.equal(value(await next.read()).terminal[0]?.status, "sent"); value(await next.close());
}));
for (const record of ["checkpoint", entryName(1), claimName(1), closedName(1)]) {
  for (const mode of ["version", "digest", "schema", "json"] as const) {
    test(`${record} ${mode} corruption refuses without replacing history`, () => withStoreDirectory(async directory => {
      const store = storeAt(directory); const handle = value(await store.open()); value(await handle.initialize());
      value(await handle.intent(key())); value(await handle.close());
      const path = join(directory, record); const original = await readFile(path, "utf8");
      const data = JSON.parse(original) as Record<string, unknown>;
      if (mode === "version") data.version = 2;
      if (mode === "digest") data.digest = "bad";
      if (mode === "schema") data.unexpected = true;
      const corrupt = mode === "json" ? original + "garbage" : JSON.stringify(data);
      await writeFile(path, corrupt);
      const result = await store.open();
      refusal(result, record === "checkpoint" ? "checkpoint-corrupt" : record.startsWith("entry") ? "entry-corrupt" : "ownership-record-corrupt");
      if (!result.ok && "reason" in result.refusal) assert.equal(result.refusal.reason, mode);
      assert.equal(await readFile(path, "utf8"), corrupt);
      assert.deepEqual((await readdir(directory)).filter(n => n.endsWith(".claim")), [claimName(1)]);
    }));
  }
}
test("history gaps and missing checkpoint refuse; genesis cannot overwrite existing data", () => withStoreDirectory(async directory => {
  const store = storeAt(directory); const handle = value(await store.open()); value(await handle.initialize());
  value(await handle.intent(key("one"))); value(await handle.intent(key("two"))); value(await handle.checkpoint());
  refusal(await handle.initialize(), "already-initialised"); value(await handle.close());
  const first = await readFile(join(directory, entryName(1)));
  await unlink(join(directory, entryName(1))); refusal(await store.open(), "journal-gap");
  await writeFile(join(directory, entryName(1)), first);
  await unlink(join(directory, "checkpoint")); refusal(await store.open(), "checkpoint-missing-with-history");
}));
for (const target of [entryName(1), "checkpoint"]) {
  test(`directory-sync uncertainty after ${target} poisons writes and close cannot release`, () => withStoreDirectory(async directory => {
    let armed = false;
    const store = new FileStateStore({ directory, scope: SCOPE, clock, onPoint: p => {
      if (armed && p.record === target && p.phase === "before-directory-sync") throw new Error("injected sync fault");
    } });
    const handle = value(await store.open()); value(await handle.initialize()); armed = true;
    refusal(await (target === "checkpoint" ? handle.checkpoint() : handle.intent(key())), "publication-uncertain");
    refusal(await handle.intent(key("next")), "poisoned"); refusal(await handle.close(), "poisoned");
    assert.equal((await readdir(directory)).includes(closedName(1)), false);
    refusal(await storeAt(directory).open(), "held");
  }));
}
test("failure before publication is definite and permits another operation", () => withStoreDirectory(async directory => {
  let armed = false;
  const store = new FileStateStore({ directory, scope: SCOPE, clock, onPoint: p => {
    if (armed && p.record === entryName(1) && p.phase === "file-synced") { armed = false; throw new Error("before link"); }
  } });
  const handle = value(await store.open()); value(await handle.initialize()); armed = true;
  refusal(await handle.intent(key()), "io-failure"); assert.equal((await readdir(directory)).includes(entryName(1)), false);
  value(await handle.intent(key())); value(await handle.close());
}));
test("unordered generation claims and entries refuse generation-fork", () => withStoreDirectory(async directory => {
  const store = storeAt(directory); const handle = value(await store.open()); value(await handle.initialize()); value(await handle.intent(key())); value(await handle.close());
  const prior = JSON.parse(await readFile(join(directory, claimName(1)), "utf8")) as OwnerClaim;
  const claim = envelope({ scope: SCOPE, generation: 2, owner: prior.owner, predecessor: null }, AT);
  await writeFile(join(directory, claimName(2)), JSON.stringify(claim));
  await writeFile(join(directory, entryName(2)), JSON.stringify(intentEntryOf(key("fork"), 2, 2, AT)));
  const result = await store.open(); refusal(result, "generation-fork");
  if (!result.ok && result.refusal.kind === "generation-fork") assert.deepEqual(result.refusal.generations, [1, 2]);
  assert.equal((await readdir(directory)).filter(n => n.startsWith("entry.")).length, 2);
}));
test("sequence publication collision revokes the losing handle", () => withStoreDirectory(async directory => {
  let armed = false;
  const store = new FileStateStore({ directory, scope: SCOPE, clock, onPoint: async p => {
    if (armed && p.record === entryName(1) && p.phase === "file-synced") {
      armed = false; await writeFile(join(directory, entryName(1)), JSON.stringify(intentEntryOf(key("competitor"), 1, 1, AT)));
    }
  } });
  const handle = value(await store.open()); value(await handle.initialize()); armed = true;
  refusal(await handle.intent(key()), "sequence-taken"); refusal(await handle.intent(key("next")), "revoked"); refusal(await handle.close(), "revoked");
}));

test("a later generation defensively fences an old handle before it publishes", () => withStoreDirectory(async directory => {
  const handle = value(await storeAt(directory).open()); value(await handle.initialize());
  const prior = JSON.parse(await readFile(join(directory, claimName(1)), "utf8")) as OwnerClaim;
  const successor = envelope({ scope: SCOPE, generation: 2, owner: prior.owner,
    predecessor: { generation: 1, disposition: "dead" as const, claimDigest: prior.digest } }, AT);
  await writeFile(join(directory, claimName(2)), JSON.stringify(successor));
  refusal(await handle.intent(key()), "revoked"); refusal(await handle.checkpoint(), "revoked");
  assert.equal((await readdir(directory)).some(n => n.startsWith("entry.")), false);
}));
test("checkpoint cannot invent terminal outcomes even with a freshly recomputed digest", () => withStoreDirectory(async directory => {
  const handle = value(await storeAt(directory).open()); value(await handle.initialize()); value(await handle.intent(key()));
  const cp = value(await handle.checkpoint()); value(await handle.close());
  const { at, digest: _digest, ...body } = cp;
  const forged = envelope({ ...body, pendingAtCheckpoint: [], terminal: [{ ...cp.pendingAtCheckpoint[0]!, status: "unknown" }] }, at);
  await writeFile(join(directory, "checkpoint"), JSON.stringify(forged));
  refusal(await storeAt(directory).open(), "checkpoint-corrupt");
}));
test("foreign scope refuses without claiming another generation", () => withStoreDirectory(async directory => {
  const handle = value(await storeAt(directory).open()); value(await handle.initialize()); value(await handle.close());
  refusal(await new FileStateStore({ directory, scope: { ...SCOPE, milestone: "other" }, clock }).open(), "scope-mismatch");
  assert.equal((await readdir(directory)).filter(n => n.endsWith(".claim")).length, 1);
}));
