import assert from "node:assert/strict";
import { it } from "node:test";
import { orchidHost } from "@rickylabs/host-orchid";
import { MAX_DISPATCH_PAGES_PER_FRAME, readIssueAgentDispatches } from "./issue-agent-dispatches.js";

it("receipt traversal has a finite page budget and reports remaining coverage as scan_limit", async () => {
  let calls = 0;
  const result = await readIssueAgentDispatches({ ...orchidHost, readDispatches: async (root, page) => {
    assert.equal(page?.after, calls === 0 ? undefined : String(calls).padStart(64, "0"));
    return { root, reason: null, dispatches: [], launchStates: [], notes: [], degraded: false,
      nextCursor: String(++calls).padStart(64, "0") };
  } }, "/fixture");
  assert.equal(calls, MAX_DISPATCH_PAGES_PER_FRAME);
  assert.equal(result.degraded, true);
  assert.deepEqual(result.notes, ["orchid-dispatch: scan_limit"]);
});
