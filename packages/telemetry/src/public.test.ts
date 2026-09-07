/**
 * The published projection, held to its allowlist.
 *
 * The point of these tests is that the allowlist cannot rot quietly. `RUN` below is typed as a whole
 * `RunRecord`, so a new field on the model breaks this file's compile; the key-difference assertion
 * then fails until someone states, here, whether the new field is publishable. That is the whole
 * mechanism: publishing becomes a decision instead of a default.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RunRecord, TelemetrySnapshot } from "./model.js";
import { parseGovernanceObservation, unavailableGovernance, type GovernanceView } from "./observations.js";
import { publicGovernance, publicRun, publicRuns, publicSnapshot, PUBLIC_RUN_KEYS } from "./public.js";

const RUN: RunRecord = {
  id: "ses-a",
  source: "claude",
  parentId: null,
  startedAt: "2026-09-04T21:00:00.000Z",
  updatedAt: "2026-09-04T21:30:00.000Z",
  branch: "orch/divybot-39",
  identity: { model: "claude-opus-5", effort: "medium", provider: "anthropic", profile: null },
  usage: { inputTokens: 1200, outputTokens: 40 },
  outcome: "complete",
  linkedIssues: [],
  origin: "/home/someone/.claude/projects/private-client-repo/ses-a.jsonl",
  quota: [],
};

describe("publicRun", () => {
  it("emits exactly the allowlisted keys", () => {
    assert.deepEqual(Object.keys(publicRun(RUN)).sort(), [...PUBLIC_RUN_KEYS]);
  });

  it("drops origin, and nothing else", () => {
    // Stated as a difference rather than as "origin is absent", so that adding a field to RunRecord
    // and forgetting to decide about it fails here instead of shipping (finding F-10 on #105).
    const published = new Set<string>(Object.keys(publicRun(RUN)));
    const withheld = Object.keys(RUN).filter((key) => !published.has(key));
    assert.deepEqual(withheld, ["origin"]);
  });

  it("does not put the path anywhere else on the way out", () => {
    // A projection that moved `origin` into a note or an id would satisfy the key check and still
    // publish the path, so this asserts on the serialized bytes.
    assert.equal(JSON.stringify(publicRun(RUN)).includes(".claude"), false);
  });
});

describe("the published envelopes", () => {
  it("say whether the scan behind them was complete", () => {
    // A bare array is shaped like complete evidence whether or not the scan was truncated, and a
    // machine consumer has no way to ask. This is the exit status, in the form a program reads.
    const truncated = publicRuns("2026-09-04T22:00:00.000Z", [RUN], ["claude: truncated"], false);
    assert.equal(truncated.complete, false);
    assert.deepEqual(truncated.notes, ["claude: truncated"]);
    assert.equal(truncated.runs.length, 1);
    assert.deepEqual(Object.keys(truncated).sort(), ["complete", "generatedAt", "notes", "runs"]);
  });

  it("carry the same allowlist through a snapshot's subagent trees", () => {
    // The recursion is the risk: a child run reached through `children` is projected by a different
    // code path than a top-level one, and only one of them used to exist.
    const snapshot: TelemetrySnapshot = {
      generatedAt: "2026-09-04T22:00:00.000Z",
      epics: [
        {
          epic: "E9",
          milestone: "W2",
          runs: [
            {
              run: RUN,
              item: null,
              children: [{ run: { ...RUN, id: "ses-b", parentId: "ses-a" }, item: null, children: [] }],
            },
          ],
        },
      ],
      unattributed: [{ run: { ...RUN, id: "ses-c" }, item: null, children: [] }],
      quota: [],
      governance: unavailableGovernance("no --observations supplied"),
      notes: [],
    };
    const published = publicSnapshot(snapshot, true);
    assert.equal(published.complete, true);
    assert.equal(JSON.stringify(published).includes("origin"), false);
    assert.equal(JSON.stringify(published).includes(".jsonl"), false);
  });
});

describe("publicGovernance", () => {
  it("projects the explicit allowlist and every pending approval field", () => {
    const parsed = parseGovernanceObservation({
      observedAt: "2026-09-04T21:55:00.000Z",
      validUntil: "2026-09-04T22:05:00.000Z",
      provenance: "synthetic:test",
      state: {
        generatedAt: "2026-09-04T21:55:00.000Z",
        regimes: [
          { regime: "subscription", state: "allow", accounts: [], note: null },
          { regime: "metered", state: "allow", providers: [], note: null },
          { regime: "capacity", state: "allow", hosts: [], note: null },
        ],
        pending: [{
          id: "approval-1",
          kind: "dispatch-admission",
          summary: "Synthetic approval",
          item: 205,
          runId: null,
          regime: "subscription",
          requestedAt: "2026-09-04T21:54:00.000Z",
          expiresAt: null,
        }],
        notes: ["synthetic note"],
      },
      admissions: [{
        item: { number: 205 },
        regime: "subscription",
        state: "pause",
        observedAt: "2026-09-04T21:54:00.000Z",
        validUntil: "2026-09-04T22:01:00.000Z",
        provenance: "synthetic:dispatcher",
        outcome: { accepted: false, reason: "quota-paused", detail: "binding window exhausted" },
      }],
    }, "2026-09-04T22:00:00.000Z");
    assert.notEqual(parsed.availability, "unavailable");
    const withPrivateCanary = { ...parsed, localPath: "/home/private/observations.json" } as unknown as GovernanceView;
    const published = publicGovernance(withPrivateCanary);
    assert.deepEqual(Object.keys(published).sort(), [
      "admissions", "availability", "observedAt", "provenance", "state", "unavailableReason", "validUntil",
    ]);
    assert.deepEqual(Object.keys(published.state?.pending[0] ?? {}).sort(), [
      "expiresAt", "id", "item", "kind", "regime", "requestedAt", "runId", "summary",
    ]);
    assert.deepEqual(Object.keys(published.admissions[0] ?? {}).sort(), [
      "availability", "item", "observedAt", "outcome", "provenance", "regime", "state", "validUntil",
    ]);
    assert.equal(JSON.stringify(published).includes("/home/private"), false);
  });
});
