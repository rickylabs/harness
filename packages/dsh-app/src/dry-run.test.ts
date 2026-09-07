import { parseRoutingDocument } from "@rickylabs/routing";
import assert from "node:assert/strict";
import { test } from "node:test";
import { digest, MemoryStateStore } from "@rickylabs/coordinator";
import type { IntentKey, StateStoreHandle } from "@rickylabs/harness-contracts";
import { driveDryRun, type DryRunPlan } from "./dry-run.js";
import { driveSnapshot, snapshotData } from "./dry-run-internal.js";
import { clock, fixture, SCOPE, value } from "./dry-run-test-fixtures.js";
async function memory() { const store = new MemoryStateStore(SCOPE, clock); const handle = value(await store.open()); value(await handle.initialize()); return { store, handle }; }
async function keyOf(plan: DryRunPlan): Promise<IntentKey> {
  const { handle } = await memory();
  const result = await driveDryRun(handle, plan);
  assert.ok(result.drove, JSON.stringify(result));
  return result.key;
}
const base = fixture();
const fakeResult = (result: unknown): DryRunPlan => ({ ...fixture(), fake: { ...base.fake, result: result as DryRunPlan["fake"]["result"] } });
for (const [kind, status] of [["accepted", "sent"], ["refused", "unsent"]] as const) test(`definitive fake ${kind} produces ${status} and survives checkpoint/reopen`, async () => {
  const { store, handle } = await memory();
  const outcome = await driveDryRun(handle, fakeResult({ kind, reason: "synthetic-refusal" }));
  assert.ok(outcome.drove && "status" in outcome);
  assert.equal(outcome.status.status, status);
  if (outcome.status.status === "sent") assert.match(outcome.status.reference, /^dry-run:fixture@[a-f0-9]{16}$/);
  if (outcome.status.status === "unsent") assert.equal(outcome.status.proof.reason, "synthetic-refusal");
  const before = value(await handle.read()); assert.equal(before.lastEntry, 2);
  value(await handle.checkpoint()); value(await handle.close());
  const reopened = value(await store.open()); assert.deepEqual(value(await reopened.read()), before); value(await reopened.close());
});
for (const result of [{ kind: "unknown" }, { kind: "throws" }, null, { kind: "invented" }, { kind: "refused" }, { kind: "refused", reason: "/private/raw prose" }]) test("undetermined attempt never records negative evidence", async () => {
  const { store, handle } = await memory();
  const outcome = await driveDryRun(handle, fakeResult(result)); assert.ok(outcome.drove && "undetermined" in outcome);
  const before = value(await handle.read()); assert.equal(before.lastEntry, 1); assert.equal(before.pending.length, 1); assert.equal(before.terminal.length, 0);
  store.simulateCrash(); const recovered = value(await store.recover(handle.holder));
  assert.equal(value(await recovered.read()).terminal[0]?.status, "unknown");
  const forged = await recovered.receipt(outcome.undetermined, { delivered: false, reason: "guess" });
  assert.ok(!forged.ok && forged.refusal.kind === "receipt-after-orphan");
});
const badPlans: readonly [string, unknown, string][] = [
  ["closed", { ...base, source: { ...base.source, state: "closed" } }, "source-unusable"],
  ["pull request", { ...base, source: { ...base.source, kind: "pull-request" } }, "source-unusable"],
  ["body", { ...base, source: { ...base.source, body: " " } }, "source-unusable"],
  ["revision", { ...base, source: { ...base.source, updatedAt: "yesterday" } }, "source-unusable"],
  ["invalid calendar date", { ...base, source: { ...base.source, updatedAt: "2000-02-30T00:00:00.000Z" } }, "source-unusable"],
  ["scope", { ...base, scope: { ...SCOPE, repository: "other/project" } }, "source-unusable"],
  ["URL number", { ...base, source: { ...base.source, url: "https://github.com/example/project/issues/8" } }, "source-unusable"],
  ["URL repository", { ...base, source: { ...base.source, url: "https://github.com/other/project/issues/7" } }, "source-unusable"],
  ["URL malformed", { ...base, source: { ...base.source, url: "https://" } }, "source-unusable"],
  ["task", { ...base, task: "unbound" }, "source-unusable"],
  ["workflow", { ...base, workflow: { name: "milestone", steps: [] } }, "source-unusable"],
  ["shape", null, "source-unusable"],
  ["dispatch type", { ...base, dispatch: { ...base.dispatch, model: 7 } }, "dispatch-inadmissible"],
  ["lane", { ...base, lane: "normal_implementation", admitted: true }, "dispatch-inadmissible"],
  ["route mismatch", { ...base, status: "known", fake: { ...base.fake, observation: { ...base.fake.observation, model: "different" } } }, "route-unverified"],
  ["route unknown", { ...base, fake: { ...base.fake, observation: null } }, "route-unverified"],
  ["uncited", { ...base, states: base.states.map(s => s.id === "read-milestone" ? { ...s, citations: {} } : s) }, "admission-failed"],
  ["callback", { ...base, fake: { ...base.fake, attempt: () => { throw new Error("must not run"); } } }, "executor-not-data"],
];
for (const [name, plan, kind] of badPlans) test(`${name} refuses before assembly or attempt and appends nothing`, async () => {
  const { handle } = await memory();
  // Include old history: appended:0 describes this drive, not an empty store.
  const prior = await driveDryRun(handle, base); assert.ok(prior.drove);
  const before = value(await handle.read());
  let assembled = 0; let attempted = 0;
  const snap = snapshotData(plan);
  const outcome = snap.ok ? await driveSnapshot(handle, snap.value, { assembled: () => { assembled++; }, attempted: () => { attempted++; } }) : await driveDryRun(handle, plan as DryRunPlan);
  assert.ok(!outcome.drove); assert.equal(outcome.appended, 0); assert.equal(outcome.refusal.kind, kind);
  assert.equal(assembled, 0); assert.equal(attempted, 0); assert.deepEqual(value(await handle.read()), before);
});
test("data accessors and cycles are refused without invocation", async () => {
  const { handle } = await memory(); let calls = 0;
  const accessor = { ...base, get fake() { calls++; return base.fake; } };
  const cycle: Record<string, unknown> = { ...base }; cycle.self = cycle;
  for (const plan of [accessor, cycle]) { const outcome = await driveDryRun(handle, plan as DryRunPlan); assert.ok(!outcome.drove && outcome.refusal.kind === "executor-not-data"); }
  assert.equal(calls, 0); assert.equal(value(await handle.read()).lastEntry, 0);
});
test("semantic key binds every requested change and remains deterministic", async () => {
  const key = await keyOf(base); assert.deepEqual(await keyOf(fixture()), key);
  const variants: DryRunPlan[] = [
    { ...base, dispatch: { ...base.dispatch, prompt: "Changed prompt." } },
    { ...base, source: { ...base.source, body: "Changed body." } },
    { ...base, source: { ...base.source, updatedAt: "2000-01-02T00:00:00.000Z" } },
    { ...base, cwd: "/synthetic/other", fake: { ...base.fake, observation: { ...base.fake.observation, cwd: "/synthetic/other" } } },
    { ...base, fake: { ...base.fake, provider: "other", observation: { ...base.fake.observation, provider: "other" } } },
    { ...base, attempt: 2 },
    { ...base, dispatch: { ...base.dispatch, model: "gpt-5.6-sol", effort: "high" }, fake: { ...base.fake, observation: { ...base.fake.observation, model: "gpt-5.6-sol", effort: "high" } } },
    { ...base, states: base.states.map(s => s.id === "read-milestone" ? { ...s, citations: { milestone: "https://example.test/changed" } } : s) },
  ];
  for (const variant of variants) assert.notDeepEqual(await keyOf(variant), key);
  const sol = variants[6]!;
  assert.notDeepEqual(await keyOf({ ...sol, lane: "planning_decisions" }), await keyOf(sol));
  const medium = { ...sol, lane: "normal_implementation", dispatch: { ...sol.dispatch, effort: "medium" }, fake: { ...sol.fake, observation: { ...sol.fake.observation, effort: "medium" } } };
  assert.notDeepEqual(await keyOf(medium), await keyOf(sol));
  // This exact live-shaped revision lacks the dry-run brand and cannot alias the dry-run key.
  const admission = base.states.filter(s => s.outcome === "done");
  const inputs = { scope: base.scope, source: base.source, lane: base.lane, workflow: base.workflow, step: "dispatch-run", dispatch: base.dispatch, cwd: base.cwd, provider: base.fake.provider, fake: { name: base.fake.name, result: base.fake.result }, admission };
  const parsed = parseRoutingDocument(base.routing.text, base.routing.source); assert.ok(parsed.ok);
  assert.equal(key.inputRevision, digest({ mode: "dry-run", routing: parsed.loaded.source.digest, ...inputs }));
  assert.notEqual(key.inputRevision, digest(inputs));
});
test("inputs are detached before await and acknowledgement follows the durable receipt", async () => {
  const { handle } = await memory(); let release!: () => void; let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; });
  let acknowledged = false;
  let releaseIntent!: () => void; let enteredIntent!: () => void;
  const readyIntent = new Promise<void>(resolve => { enteredIntent = resolve; });
  const waitIntent = new Promise<void>(resolve => { releaseIntent = resolve; });
  const delayed: StateStoreHandle = { ...handle,
    intent: async key => { enteredIntent(); await waitIntent; return handle.intent(key); }, receipt: async (pending, receipt) => {
    entered(); await wait;
    assert.equal(acknowledged, false); assert.equal(value(await handle.read()).terminal.length, 0);
    return handle.receipt(pending, receipt);
  } };
  const plan = structuredClone(base);
  const driving = driveDryRun(delayed, plan).then(r => { acknowledged = true; return r; });
  await readyIntent;
  Object.assign(plan.fake.result, { kind: "refused", reason: "mutated" }); Object.assign(plan.dispatch, { model: "mutated" });
  releaseIntent(); await ready;
  assert.equal(acknowledged, false); release();
  const result = await driving; assert.ok(result.drove && "status" in result && result.status.status === "sent");
  assert.deepEqual(result.key, await keyOf(base)); assert.equal(value(await handle.read()).terminal.length, 1);
});
test("repeat intent is a named store refusal, never another attempt", async () => {
  const { handle } = await memory(); assert.ok((await driveDryRun(handle, base)).drove);
  let attempted = 0; const result = await driveSnapshot(handle, structuredClone(base), { attempted: () => { attempted++; } });
  assert.ok(!result.drove && result.refusal.kind === "store-refused" && result.refusal.operation === "intent");
  assert.equal(result.appended, "unknown"); assert.equal(attempted, 0); assert.equal(value(await handle.read()).lastEntry, 2);
});

test("thrown store failures are named at their stage and never authorize recovery", async () => {
  for (const operation of ["intent", "receipt"] as const) {
    const { handle } = await memory(); let attempts = 0;
    const throwing: StateStoreHandle = { ...handle, [operation]: async () => { throw new Error("synthetic store exception"); } };
    const result = await driveSnapshot(throwing, structuredClone(base), { attempted: () => { attempts++; } });
    assert.ok(!result.drove && result.refusal.kind === "store-refused");
    assert.equal(result.appended, "unknown"); assert.equal(result.refusal.operation, operation);
    assert.equal(result.refusal.refusal.kind, "io-failure");
    assert.equal(attempts, operation === "intent" ? 0 : 1);
    assert.equal(value(await handle.read()).lastEntry, operation === "intent" ? 0 : 1);
  }
});
for (const [id, fields] of [
  ["read-milestone", { citations: { milestone: "uncitable prose" } }],
  ["write-tasks", { citations: { "issue-urls": "abcdef0" } }],
  ["dispatch-run", { outcome: "done" }],
  ["gate-admission", { outcome: "forked", note: "owner-fork" }],
  ["gate-admission", { outcome: "blocked", note: "blocked" }],
  ["gate-admission", { outcome: "pending" }],
  ["read-milestone", { outcome: "pending" }],
  ["read-milestone", { outcome: "invented" }],
] as const) test(`invalid admission at ${id} cannot append an intent`, async () => {
  const { handle } = await memory();
  const states = base.states.map(s => s.id === id ? { ...s, ...fields } : s);
  const outcome = await driveDryRun(handle, { ...base, states } as DryRunPlan);
  assert.ok(!outcome.drove && outcome.appended === 0 && outcome.refusal.kind === "admission-failed");
  assert.equal(value(await handle.read()).lastEntry, 0);
});

test("document identity uses actual bytes, never an asserted digest or a source label", async () => {
  const original = await keyOf(base);
  assert.notDeepEqual(await keyOf({ ...base, routing: { ...base.routing, text: base.routing.text + " " } }), original);
  assert.deepEqual(await keyOf({ ...base, routing: { ...base.routing, source: "another-label" } }), original);
  const { handle } = await memory();
  const forged = { ...base, routing: { ...base.routing, text: base.routing.text + " ", digest: "old-digest" } };
  const result = await driveDryRun(handle, forged);
  assert.ok(!result.drove && result.appended === 0 && result.refusal.kind === "source-unusable");
  assert.equal(value(await handle.read()).lastEntry, 0);
});
for (const routing of [undefined, null, {}, { source: "fixture", text: "{" }, { source: "fixture", text: "[]" }]) test("unusable routing refuses before assembly and delivery", async () => {
  const { handle } = await memory(); let assembled = 0; let attempted = 0;
  const outcome = await driveSnapshot(handle, { ...base, routing }, { assembled: () => { assembled++; }, attempted: () => { attempted++; } });
  assert.ok(!outcome.drove && outcome.appended === 0);
  assert.ok(outcome.refusal.kind === "routing-unusable" || outcome.refusal.kind === "source-unusable");
  assert.equal(assembled, 0); assert.equal(attempted, 0); assert.equal(value(await handle.read()).lastEntry, 0);
});
for (const orphaned of [false, true]) test(`memory protects unresolved operation across revisions and attempts (orphaned=${orphaned})`, async () => {
  const setup = await memory(); let handle = setup.handle;
  const prior = value(await handle.intent({ repository: SCOPE.repository, task: "issue-7", workflowStep: "dispatch-run", attempt: 1, inputRevision: "old-pre-routing-revision" }));
  if (orphaned) { setup.store.simulateCrash(); handle = value(await setup.store.recover(handle.holder)); }
  const before = value(await handle.read()); let assembled = 0; let attempted = 0;
  const results = await Promise.all([1, 2, 99].map(attempt => driveSnapshot(handle,
    { ...base, attempt, routing: { ...base.routing, text: base.routing.text + " ".repeat(attempt) } },
    { assembled: () => { assembled++; }, attempted: () => { attempted++; } })));
  for (const result of results) {
    assert.deepEqual(result, { drove: false, appended: 0, refusal: { kind: "unresolved-prior-effect", status: orphaned ? "unknown" : "pending" } });
  }
  assert.equal(assembled, 0); assert.equal(attempted, 0); assert.deepEqual(value(await handle.read()), before);
  assert.deepEqual((orphaned ? before.terminal : before.pending)[0]?.key, prior.key);
});
test("simultaneous new-key drives serialize through an undetermined effect", async () => {
  const { handle } = await memory(); let attempted = 0;
  const results = await Promise.all([1, 2, 3].map(attempt => driveSnapshot(handle,
    { ...base, attempt, routing: { ...base.routing, text: base.routing.text + " ".repeat(attempt) }, fake: { ...base.fake, result: { kind: "unknown" } } },
    { attempted: () => { attempted++; } })));
  assert.equal(results.filter(r => r.drove).length, 1);
  for (const result of results.slice(1)) assert.deepEqual(result, { drove: false, appended: 0, refusal: { kind: "unresolved-prior-effect", status: "pending" } });
  assert.equal(attempted, 1); const state = value(await handle.read()); assert.equal(state.lastEntry, 1); assert.equal(state.pending.length, 1);
});
for (const throwing of [false, true]) test(`read refusal prevents every intent and delivery (throws=${throwing})`, async () => {
  const { handle } = await memory(); let intents = 0; let attempts = 0;
  const refusedHandle: StateStoreHandle = { ...handle,
    read: async () => { if (throwing) throw new Error("private OS failure"); return { ok: false, refusal: { kind: "poisoned" } }; },
    intent: async key => { intents++; return handle.intent(key); },
  };
  const result = await driveSnapshot(refusedHandle, base, { attempted: () => { attempts++; } });
  assert.ok(!result.drove && result.appended === 0 && result.refusal.kind === "store-refused" && result.refusal.operation === "read");
  assert.equal(intents, 0); assert.equal(attempts, 0); assert.equal(value(await handle.read()).lastEntry, 0);
});
test("unresolved records for a different task or workflow step do not leave cross-operation residue", async () => {
  const { handle } = await memory();
  for (const change of [{ task: "issue-8" }, { workflowStep: "other-step" }, { repository: "another/project" }]) {
    // The general store may scope-check repositories; the first two isolate the consumer predicate.
    if ("repository" in change) continue;
    value(await handle.intent({ repository: SCOPE.repository, task: "issue-7", workflowStep: "dispatch-run", attempt: 1, inputRevision: "previous", ...change }));
  }
  const result = await driveDryRun(handle, base); assert.ok(result.drove);
  assert.equal(value(await handle.read()).pending.length, 2);
});
