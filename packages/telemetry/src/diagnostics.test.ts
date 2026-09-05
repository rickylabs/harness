import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALL_POINTERS,
  diagnosticsFor,
  DISPATCHER_CAPACITY,
  LM_STUDIO_LOGS,
  OPENCODE_LOG,
} from "./diagnostics.js";
import type { RunRecord } from "./model.js";

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: "r",
  source: "claude",
  parentId: null,
  startedAt: "2026-09-04T20:00:00.000Z",
  updatedAt: "2026-09-04T21:00:00.000Z",
  title: null,
  cwd: null,
  branch: null,
  identity: { model: "claude-opus-5", effort: "medium", provider: "anthropic" },
  usage: { inputTokens: 10, outputTokens: 2 },
  outcome: "complete",
  linkedIssues: [],
  origin: "o",
  quota: [],
  ...over,
});

describe("diagnosticsFor", () => {
  it("puts the dispatcher first when a run spent nothing at all", () => {
    // A run with no usage never got a token back, so it is a dispatch or a load failure. Sending an
    // operator to the model's own log first spends the one click they were going to make.
    const pointers = diagnosticsFor(run({ usage: {}, outcome: "failed" }));
    assert.equal(pointers[0], DISPATCHER_CAPACITY);
  });

  it("does not blame the dispatcher for a run that produced tokens", () => {
    const pointers = diagnosticsFor(run({ outcome: "failed" }));
    assert.equal(pointers.includes(DISPATCHER_CAPACITY), false);
  });

  it("sends a relay run to the relay log before anything else", () => {
    const pointers = diagnosticsFor(run({ source: "opencode", outcome: "failed" }));
    assert.equal(pointers[0], OPENCODE_LOG);
    // And to LM Studio after it, because the relay reaches local models through that container.
    assert.ok(pointers.includes(LM_STUDIO_LOGS));
  });

  it("routes an OpenRouter run through the relay log even on another seam", () => {
    const pointers = diagnosticsFor(run({ identity: { model: "z-ai/glm-5.3-flash", effort: "max", provider: "openrouter" } }));
    assert.ok(pointers.includes(OPENCODE_LOG));
  });

  it("returns nothing to chase for a healthy subscription run", () => {
    // An empty list is the honest answer: there is no layer below a run that worked.
    assert.deepEqual(diagnosticsFor(run()), []);
  });

  it("points at LM Studio's own logs, not at the container's stdout", () => {
    // `nerdctl logs lm-studio` is the webtop GUI stream. A load failure never appears there, which
    // is exactly why this cost a debugging session once already.
    assert.match(LM_STUDIO_LOGS.where, /\.lmstudio\/server-logs/);
    assert.match(LM_STUDIO_LOGS.why, /nerdctl logs/);
  });

  it("keeps every pointer complete, because a half-written one costs the same click", () => {
    for (const pointer of ALL_POINTERS) {
      for (const [field, value] of Object.entries(pointer)) {
        assert.ok(value.length > 0, `${pointer.what} has an empty ${field}`);
      }
    }
  });
});
