/** Admission receipts remain independently readable; current execution requires native run sources. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOrchidDispatches } from "@rickylabs/host-orchid";
import { collectIssueAgentTree, issueAgentFeedCommand } from "./issue-agent-feed-cli.js";

it("rejects malformed scoped issue selectors before collecting", async () => {
  for (const issue of ["387", "example/project#0", "example/project#99999999999999999999", "example/../project#387"]) {
    assert.equal(await issueAgentFeedCommand(["--json", "--issue", issue], { collect: async () => { throw Error("must not collect"); } }), 2);
  }
});
it("keeps native admission refusals and blocks independent of execution observations", async () => {
  const root = await mkdtemp(join(tmpdir(), "admission-"));
  const path = join(root, "launch-" + "d".repeat(64) + ".json");
  const common = { issue: { repo: "example/inbox", number: 42 }, dispatchId: "assignment_" + "e".repeat(64), observedAt: "2026-01-01T00:00:00.000Z" };
  try {
    for (const state of [{ schemaVersion: 1, state: "refused", reasonCode: "routing-invalid" },
      { schemaVersion: 2, state: "blocked", reasonCode: "goal-prompt-unconfirmed" }]) {
      await writeFile(path, JSON.stringify({ ...common, ...state }), { mode: 0o600 });
      const read = await readOrchidDispatches(root);
      assert.equal(read.degraded, false);
      assert.equal(read.launchStates[0]?.state, state.state);
      assert.deepEqual(read.dispatches, []);
      const current = await collectIssueAgentTree({ home: root, env: { HARNESS_TELEMETRY_DISPATCH_ROOT: root },
        limit: 20, now: common.observedAt, issueKey: "example/inbox#42" });
      assert.equal(current.complete, state.state === "refused");
      assert.deepEqual(current.issues[0]?.dispatches, [], "admission never invents execution");
      assert.equal(current.issues[0]?.[state.state === "refused" ? "launchRefusal" : "launchBlock"]?.reason, state.reasonCode);
      const admissionOnly = await readOrchidDispatches(root, { keys: [], launchStates: true });
      assert.deepEqual(admissionOnly.launchStates, read.launchStates);
      assert.deepEqual(admissionOnly.dispatches, []);
    }
    await writeFile(path, JSON.stringify({ ...common, schemaVersion: 2, state: "blocked", reasonCode: "PRIVATE-ERROR-CANARY" }));
    const invalid = await readOrchidDispatches(root);
    assert.equal(invalid.degraded, true);
    assert.ok(!JSON.stringify(invalid).includes("PRIVATE-"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
