import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import type { ReceiptEntry, SessionPending } from "@rickylabs/harness-contracts";
import { intentEntryOf, proofFromReceipt, receiptEntryOf } from "./journal.js";
import { digest } from "./canonical.js";
import { checkpointOf, foldStore, genesisOf, intentIdentity, settlePending } from "./state-store.js";
import { MemoryStateStore } from "./state-store-memory.js";
import { AT, clock, key, refusal, SCOPE, value } from "./state-store-test-helpers.js";
const pending = (task = "task"): SessionPending => ({ status: "pending", key: key(task), generation: 1, sinceEntry: 1 });

test("fold is repeatable, evidence digests exclude time, and reducer reads no clock or I/O", async () => {
  const intent = intentEntryOf(key(), 1, 1, AT);
  assert.equal(intent.digest, intentEntryOf(key(), 1, 1, "another-time").digest);
  const receipt = receiptEntryOf(pending(), { delivered: true, reference: "ref" }, 2, AT);
  assert.equal(receipt.digest, receiptEntryOf(pending(), receipt.receipt, 2, "another-time").digest);
  const cp = genesisOf(SCOPE, 1, AT);
  const a = value(foldStore(cp, [intent, receipt], null));
  assert.equal(a.terminal[0]?.status, "sent");
  assert.equal(digest(a), digest(value(foldStore(cp, [intent, receipt], null))));
  const source = await readFile(new URL("../src/state-store.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:(?:fs|os)|Date\.|process\.|Math\.random/);
});
test("only intact negative receipts prove unsent", () => {
  const receipt = receiptEntryOf(pending(), { delivered: false, reason: "not delivered" }, 2, AT);
  const settled = value(settlePending(pending(), receipt));
  assert.equal(settled.status, "unsent");
  if (receipt.receipt.delivered === false) refusal(proofFromReceipt({ ...receipt, receipt: receipt.receipt, digest: "bad" }), "invalid-input");
  refusal(settlePending(pending(), { ...receipt, outputDigest: "bad" }), "entry-corrupt");
});
test("checkpoint cut is replayed through its receipt before orphaning", () => {
  const intent = intentEntryOf(key(), 1, 1, AT);
  const state = value(foldStore(genesisOf(SCOPE, 1, AT), [intent], 1));
  const cp = checkpointOf(SCOPE, 1, [intent], state, AT);
  const receipt = receiptEntryOf(pending(), { delivered: true, reference: "ref" }, 2, AT);
  const settled = value(foldStore(cp, [receipt], 2));
  assert.equal(settled.terminal[0]?.status, "sent");
  assert.equal(value(foldStore(cp, [], 2)).terminal[0]?.status, "unknown");
});
test("sealed unknown is re-emitted and never accepts a forged negative receipt", () => {
  const intent = intentEntryOf(key(), 1, 1, AT);
  const state = value(foldStore(genesisOf(SCOPE, 1, AT), [intent], 2));
  const cp = checkpointOf(SCOPE, 2, [intent], state, AT);
  assert.deepEqual(value(foldStore(cp, [], 3)).terminal, state.terminal);
  const forged = receiptEntryOf({ ...pending(), generation: 2 }, { delivered: false, reason: "guess" }, 2, AT);
  refusal(foldStore(cp, [forged], 3), "receipt-after-orphan");
});
test("chronology refuses gaps, duplicate intents, orphan receipts, generation regression and receipt before intent", () => {
  const cp = genesisOf(SCOPE, 1, AT);
  const first = intentEntryOf(key(), 1, 1, AT);
  refusal(foldStore(cp, [intentEntryOf(key(), 2, 1, AT)], 1), "journal-gap");
  refusal(foldStore(cp, [first, intentEntryOf(key(), 2, 1, AT)], 1), "chronology");
  refusal(foldStore(cp, [receiptEntryOf(pending(), { delivered: false, reason: "no" }, 1, AT)], 1), "chronology");
  refusal(foldStore(cp, [intentEntryOf(key(), 1, 2, AT), intentEntryOf(key("other"), 2, 1, AT)], 2), "generation-regression");
  refusal(settlePending(pending(), receiptEntryOf(pending(), { delivered: false, reason: "no" }, 1, AT)), "chronology");
});
test("identity retains every tuple field and delimiter-like text without hash equality", () => {
  const keys = [key(), { ...key(), repository: "another/repo" }, key("another"), { ...key(), workflowStep: "other" },
    { ...key(), attempt: 2 }, { ...key(), inputRevision: "other" }, key('a","b'), { ...key("a"), workflowStep: 'b","dispatch' }];
  assert.equal(new Set(keys.map(intentIdentity)).size, keys.length);
  const scoped = keys.filter(k => k.repository === SCOPE.repository);
  const state = value(foldStore(genesisOf(SCOPE, 1, AT), scoped.map((k, i) => intentEntryOf(k, i + 1, 1, AT)), 1));
  assert.equal(state.pending.length, scoped.length);
});
test("pure reader refuses bad digests even when caller supplies a typed entry", () => {
  const receipt = receiptEntryOf(pending(), { delivered: false, reason: "no" }, 2, AT);
  const forged: ReceiptEntry = { ...receipt, digest: "bad" };
  refusal(foldStore(genesisOf(SCOPE, 1, AT), [intentEntryOf(key(), 1, 1, AT), forged], 1), "entry-corrupt");
});
test("memory fake implements lifecycle, explicit recovery, detached inputs and terminal unknown", async () => {
  const store = new MemoryStateStore(SCOPE, clock);
  const first = value(await store.open());
  refusal(await first.read(), "uninitialised"); value(await first.initialize());
  refusal(await first.initialize(), "already-initialised"); refusal(await store.open(), "held");
  const mutable = { ...key() }; const started = first.intent(mutable); mutable.task = "changed";
  const intent = value(await started); assert.equal(intent.key.task, "task");
  store.simulateCrash(); refusal(await store.open(), "stale-lock");
  const second = value(await store.recover(first.holder));
  refusal(await first.intent(key("stale")), "revoked");
  assert.equal(value(await second.read()).terminal[0]?.status, "unknown");
  refusal(await second.receipt(intent, { delivered: false, reason: "guess" }), "receipt-after-orphan");
  value(await second.checkpoint()); value(await second.close());
  refusal(await second.intent(key("late")), "closed");
  const third = value(await store.open()); assert.equal(value(await third.read()).terminal[0]?.status, "unknown"); value(await third.close());
});

test("fake input and clock failures are named and do not break the operation queue", async () => {
  let throws = true;
  const store = new MemoryStateStore(SCOPE, () => { if (throws) throw new Error("test clock"); return AT; });
  const handle = value(await store.open()); refusal(await handle.initialize(), "invalid-input");
  throws = false; value(await handle.initialize());
  const uncloneable = { ...key(), extra: () => undefined };
  refusal(await handle.intent(uncloneable), "invalid-input");
  throws = true; refusal(await handle.intent(key()), "invalid-input");
  throws = false; value(await handle.intent(key())); value(await handle.close());
});
