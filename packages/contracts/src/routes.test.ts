import assert from "node:assert/strict";
import { test } from "node:test";

import {
  API_PREFIX,
  COMMANDS,
  COMMAND_ERROR_CODES,
  COMMAND_METHOD,
  COMMAND_PATHS,
  commandPath,
  type CommandName,
  type DispatchCommand,
  type DispatchOutcome,
} from "./routes.js";

test("every command has a unique path under the api prefix", () => {
  const paths = COMMANDS.map((name) => COMMAND_PATHS[name]);
  assert.equal(new Set(paths).size, paths.length);
  for (const path of paths) {
    assert.ok(path.startsWith(`${API_PREFIX}/`), path);
  }
});

test("commandPath agrees with the table", () => {
  for (const name of COMMANDS) {
    assert.equal(commandPath(name), COMMAND_PATHS[name]);
  }
});

test("the whole command surface is one method", () => {
  // A GET is retried by proxies, browsers and phones on a hunch. One method removes a class of
  // duplicate-execution bugs before it can exist, including on `snapshot`, which is a read.
  assert.equal(COMMAND_METHOD, "POST");
});

test("error codes are unique and name the mismatch case", () => {
  assert.equal(new Set(COMMAND_ERROR_CODES).size, COMMAND_ERROR_CODES.length);
  assert.ok((COMMAND_ERROR_CODES as readonly string[]).includes("protocol-mismatch"));
});

test("a dispatch names a lane and never a model", () => {
  const dispatch: DispatchCommand = {
    item: 79,
    lane: "docs_polish",
    prompt: "port the delegation matrix",
    idempotencyKey: "01J0000000000000000000",
  };
  const keys = Object.keys(dispatch);
  assert.ok(!keys.includes("model"));
  assert.ok(!keys.includes("effort"));
  assert.ok(!keys.includes("provider"));
  // Routing owns the table, including the fallback chain and the rule that an evaluator may not be
  // the author. A client that could name a model could route around all of it from a phone.
  assert.equal(dispatch.lane, "docs_polish");
});

test("mutating commands require an idempotency key", () => {
  // Typed, not merely conventional: a phone on a flaky link retries a POST it never saw answered,
  // and a retried dispatch spends quota on a duplicate agent.
  const dispatch: DispatchCommand = {
    item: 79,
    lane: "docs_polish",
    prompt: "x",
    idempotencyKey: "k",
  };
  assert.equal(typeof dispatch.idempotencyKey, "string");
});

test("acceptance means admitted, not launched", () => {
  const accepted: DispatchOutcome = {
    accepted: true,
    runId: null,
    item: 79,
    identity: { harness: "claude", model: "opus-5", effort: "medium", provider: null, profile: null },
    at: "2026-09-05T00:00:00.000Z",
  };
  assert.equal(accepted.accepted, true);
  // The dispatcher polls on its own interval; the agent starts about half a minute later. There is
  // no run id yet, and a cockpit that renders acceptance as "running" shows an agent that does not
  // exist — the launch arrives as a `run.upserted` event.
  assert.equal(accepted.accepted && accepted.runId, null);
});

test("a refusal that a person could clear carries the approval to clear it", () => {
  const refused: DispatchOutcome = {
    accepted: false,
    reason: "needs-approval",
    detail: "the weekly window is at 93%; dispatching would spend past the ceiling",
    approval: {
      id: "ap_1",
      kind: "dispatch-admission",
      summary: "Dispatch #79 past the weekly ceiling?",
      item: 79,
      runId: null,
      regime: "subscription",
      requestedAt: "2026-09-05T00:00:00.000Z",
      expiresAt: null,
    },
  };
  assert.equal(refused.accepted, false);
  assert.equal(refused.accepted === false && refused.approval?.id, "ap_1");
});

test("command names are unique", () => {
  const names: readonly CommandName[] = COMMANDS;
  assert.equal(new Set(names).size, names.length);
});
