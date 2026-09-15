/** Synthetic credentials only. Assertions never print identities, raw receipts or filesystem locations. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, open, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, mock } from "node:test";
import { readAgentObservations } from "@rickylabs/harness-contracts";
import { readOrchidDispatches, bindOrchidDispatchEvidence } from "./orchid-dispatch.js";
import { readOrchidNativeBinding } from "./orchid-native-binding.js";
import { buildAgentObservations } from "./agent-observations.js";
import { publicRuns } from "./public.js";
import type { DispatchEvidence } from "./dispatch-evidence.js";
import type { RunRecord } from "./model.js";
const at = "2026-01-01T00:00:00.000Z";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const rootIdentity = "PRIVATE-ROOT-CANARY", childIdentity = "PRIVATE-CHILD-CANARY";
const baseBinding = { IssueID: "fixture-issue", Repo: "example/target", BriefDigest: "b".repeat(64),
  Route: { transport: "codex", provider: "fixture-router", model: "fixture-model", effort: "high" }, NativeSessionID: rootIdentity };
const key = sha(baseBinding.IssueID + "\0" + baseBinding.Repo + "\0" + baseBinding.BriefDigest);
const snapshot = { observedAt: at, schemaVersion: 1, runId: "orchid-" + key, issue: { repo: "example/inbox", number: 42 },
  parentRunId: null, source: "codex", provider: "fixture-router", model: "fixture-model", effort: "high", profile: "leaf",
  state: "dispatched", location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } };
const run = (id: string, parentId: string | null, source: RunRecord["source"] = "codex"): RunRecord => ({ id, parentId, source,
  startedAt: at, updatedAt: at, branch: null, identity: { provider: null, model: null, effort: null, profile: null },
  usage: {}, outcome: "unknown", linkedIssues: [], origin: "PRIVATE-ORIGIN-CANARY", quota: [] });
const pair = [run(rootIdentity, null), run(childIdentity, rootIdentity)];
const project = (dispatches: readonly DispatchEvidence[], runs = pair, nativeComplete = true) => buildAgentObservations({
  dispatches, runs, nativeComplete, observedAt: at, sourceBound: true, dispatchComplete: true });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "orchid-native-"));
  const record = join(root, key, "record");
  await mkdir(record, { recursive: true, mode: 0o700 });
  const binding = join(record, "binding.json"), dispatch = join(record, "dispatch.json");
  await writeFile(dispatch, JSON.stringify(snapshot), { mode: 0o600 });
  await writeFile(binding, JSON.stringify(baseBinding), { mode: 0o600 });
  return { root, record, binding, dispatch,
    read: async () => (await readOrchidDispatches(root)).dispatches,
    write: (value: unknown) => writeFile(binding, JSON.stringify(value), { mode: 0o600 }),
    close: () => rm(root, { recursive: true, force: true }) };
}
function unavailable(rows: readonly DispatchEvidence[], runs = pair) {
  const result = project(rows, runs);
  assert.equal(result.complete, false);
  assert.equal(result.reason, "ancestry_unavailable");
  assert.equal(result.agents.length, 1);
  assert.ok(readAgentObservations(result).ok);
  assert.equal(result.agents[0]!.parentAgentId.state, "unavailable");
  assert.equal(result.agents[0]!.parentAgentId.value, null);
  assert.equal(result.agents[0]!.running.reason, "observer-unavailable");
  assert.ok(!JSON.stringify(result).includes("PRIVATE-"));
}
it("private binding: resolves the existing parent tree without exporting native credentials", async () => {
  const f = await fixture();
  try {
    const rows = await f.read();
    const result = project(rows);
    assert.equal(result.complete, true);
    assert.equal(result.agents.length, 2);
    assert.ok(readAgentObservations(result).ok);
    const root = result.agents.find(a => a.parentAgentId.state === "confirmed-root")!;
    const child = result.agents.find(a => a.parentAgentId.state === "known-parent")!;
    assert.equal(child.parentAgentId.value, root.agentId);
    assert.equal(child.issueNumber, 42);
    assert.equal(root.pane.value, "fixture-pane");
    assert.equal(root.route.requested.effort.value, "high");
    for (const row of result.agents) {
      assert.equal(row.running.value, null);
      assert.ok(Object.values(row.route.observed).every(field => field.value === null));
      assert.equal(Object.keys(row.cost).length, 3);
      assert.ok(Object.values(row.cost).every(cost => cost.availability === "unavailable"));
    }
    assert.equal(rows[0]!.external, null);
    assert.equal(rows[0]!.parentRunId, null);
    // Serialization of the reader and legacy dispatch envelope must not publish the new binding.
    assert.ok(!JSON.stringify({ rows, envelope: publicRuns(at, [], [], true, rows), result }).includes("PRIVATE-"));
    // Private keys do not survive a public JSON round-trip.
    unavailable(JSON.parse(JSON.stringify(rows)) as DispatchEvidence[]);
  } finally { await f.close(); }
});
it("private binding: missing, malformed, moved and route-mismatched bindings stay dispatch-only", async t => {
  const invalid: [string, unknown][] = [
    ["null document", null], ["array document", []], ["scalar document", true],
    ["missing identity", { ...baseBinding, NativeSessionID: undefined }],
    ...[null, 7, "", " ", " padded", "padded ", "\u00a0padded", "\u0085padded", "line\nfeed", "tab\tid", "slash/id", "back\\slash", "null\0id", "x".repeat(257), "é".repeat(129)]
      .map((id, i): [string, unknown] => ["invalid identity " + i, { ...baseBinding, NativeSessionID: id }]),
    ["different native root", { ...baseBinding, NativeSessionID: "PRIVATE-OTHER-CANARY" }],
    ["missing issue", { ...baseBinding, IssueID: undefined }], ["missing repository", { ...baseBinding, Repo: undefined }],
    ["missing brief", { ...baseBinding, BriefDigest: undefined }], ["malformed brief", { ...baseBinding, BriefDigest: "invalid" }],
    ["wrong reservation", { ...baseBinding, IssueID: "different-fixture" }],
    ["missing route", { ...baseBinding, Route: undefined }],
    ...["transport", "provider", "model", "effort"].map((field): [string, unknown] => ["wrong " + field,
      { ...baseBinding, Route: { ...baseBinding.Route, [field]: "different-fixture" } }]),
  ];
  for (const [name, value] of invalid) await t.test(name, async () => {
    const f = await fixture();
    try {
      await f.write(value);
      const id = (value as typeof baseBinding | null)?.NativeSessionID;
      const matchingInvalid = name.startsWith("invalid identity") && typeof id === "string";
      unavailable(await f.read(), matchingInvalid ? [run(id, null), run(childIdentity, id)] : pair);
    }
    finally { await f.close(); }
  });
  await t.test("absent file", async () => {
    const f = await fixture();
    try { await rm(f.binding); unavailable(await f.read()); }
    finally { await f.close(); }
  });
});
it("private binding: cannot certify uncertain, launching or unsupported transport launches", async t => {
  for (const change of [{ state: "uncertain" }, { state: "launching" }, { source: "claude" }]) {
    await t.test(JSON.stringify(change), async () => {
      const f = await fixture();
      try {
        await writeFile(f.dispatch, JSON.stringify({ ...snapshot, ...change }));
        if (change.source) await f.write({ ...baseBinding, Route: { ...baseBinding.Route, transport: change.source } });
        unavailable(await f.read(), change.source ? pair.map(r => ({ ...r, source: "claude" as const })) : pair);
      } finally { await f.close(); }
    });
  }
});
it("private binding: refuses unsafe files and bounds both stat and actual bytes", async t => {
  for (const mode of [0o644, 0o400, 0o1600]) await t.test("mode " + mode.toString(8), async () => {
    const f = await fixture();
    try { await chmod(f.binding, mode); unavailable(await f.read()); }
    finally { await f.close(); }
  });
  for (const kind of ["symlink", "directory", "oversized", "growth"]) await t.test(kind, async () => {
    const f = await fixture();
    try {
      if (kind === "symlink") {
        const target = join(f.root, "fixture-target");
        await writeFile(target, JSON.stringify(baseBinding), { mode: 0o600 });
        await rm(f.binding); await symlink(target, f.binding);
      } else if (kind === "directory") {
        await rm(f.binding); await mkdir(f.binding, { mode: 0o600 });
      } else {
        await writeFile(f.binding, JSON.stringify(baseBinding) + " ".repeat(262_144));
        if (kind === "growth") {
          const handle = await open(f.binding, "r");
          const prototype = Object.getPrototypeOf(handle) as { stat: typeof handle.stat };
          const original = prototype.stat;
          mock.method(prototype, "stat", async function(this: typeof handle) {
            const stat = await original.call(this);
            if (stat.size > 262_144) stat.size = 1;
            return stat;
          });
          await handle.close();
        }
      }
      unavailable(await f.read());
    } finally { mock.restoreAll(); await f.close(); }
  });
});
it("private binding: changed dispatch snapshots cannot retain the private join", async () => {
  const f = await fixture();
  try {
    const rows = await f.read();
    assert.equal(project(rows).complete, true);
    await writeFile(f.dispatch, JSON.stringify({ ...snapshot, state: "uncertain" }));
    await readOrchidNativeBinding(f.record, key, rows[0]!);
    unavailable(rows);
  } finally { await f.close(); }
});
it("private binding: absent, duplicate, cross-source and child-as-root native matches are unavailable", async () => {
  const f = await fixture();
  try {
    const rows = await f.read();
    for (const runs of [[], [...pair, pair[0]!], pair.map(r => ({ ...r, source: "claude" as const })),
      [run(rootIdentity, "PRIVATE-PARENT-CANARY"), pair[1]!]]) unavailable(rows, runs);
    const result = project(rows, pair, false);
    assert.equal(result.complete, false);
    assert.equal(readAgentObservations(result).ok, false);
    assert.equal(result.agents.length, 0);
  } finally { await f.close(); }
});
it("private binding: legacy evidence cannot replace or revive an Orchid binding", async () => {
  const f = await fixture();
  try {
    for (const present of [true, false]) {
      if (!present) await rm(f.binding);
      const rows = await f.read();
      const foreign = { ...rows[0]!, external: rootIdentity };
      const bound = bindOrchidDispatchEvidence(rows, [foreign]);
      assert.equal(bound.dispatches[0]!.external, null);
      assert.ok(!JSON.stringify(bound).includes("PRIVATE-"));
      assert.equal(project(bound.dispatches).complete, present);
    }
  } finally { await f.close(); }
});
it("private binding: binding arrival changes revision without changing public root identity", async () => {
  const f = await fixture();
  try {
    await rm(f.binding);
    const before = project(await f.read());
    await f.write(baseBinding);
    const after = project(await f.read());
    const root = after.agents.find(a => a.parentAgentId.state === "confirmed-root")!;
    assert.equal(root.agentId, before.agents[0]!.agentId);
    assert.notEqual(root.revision, before.agents[0]!.revision);
    assert.notEqual(after.revision, before.revision);
  } finally { await f.close(); }
});

it("private binding: each file metadata guard refuses even readable bounded JSON", async t => {
  for (const kind of ["not-file", "declared-oversize"]) await t.test(kind, async () => {
    const f = await fixture();
    try {
      const handle = await open(f.binding, "r");
      const target = await handle.stat();
      const prototype = Object.getPrototypeOf(handle) as { stat: typeof handle.stat };
      const original = prototype.stat;
      mock.method(prototype, "stat", async function(this: typeof handle) {
        const stat = await original.call(this);
        if (stat.ino === target.ino) {
          if (kind === "not-file") stat.isFile = () => false;
          else stat.size = 262_145;
        }
        return stat;
      });
      await handle.close();
      unavailable(await f.read());
    } finally { mock.restoreAll(); await f.close(); }
  });
});
