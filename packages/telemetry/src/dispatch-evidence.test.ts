import assert from "node:assert/strict";
import type { TelemetryEvent } from "./sink.js";
import { it } from "node:test";
import { readDispatchEvidence } from "./dispatch-evidence.js";
import { compareRouteIdentity } from "@rickylabs/subagents";
const at = "2026-01-01T00:00:00.000Z";
const input = { provider: "fixture-router", model: "fixture-model", effort: "high", cwd: null };
const route = compareRouteIdentity(input, input);
it("only dispatch receipts bind sessions; retries clear prior evidence and refusals remove rows", () => {
  const events: TelemetryEvent[] = [
    { at, runId: "fixture-run", kind: "subagent.dispatching", detail: { source: "codex" } },
    { at, runId: "fixture-run", kind: "subagent.dispatch", detail: { verdict: "accepted", external: "fixture-native", route } },
    { at, runId: "fixture-run", kind: "subagent.steer", detail: { external: "wrong-native", route: null } },
  ];
  const read = () => readDispatchEvidence([{ path: "synthetic", events }]);
  assert.equal(read()[0]?.external, "fixture-native");
  assert.equal(read()[0]?.source, "codex");
  assert.equal(read()[0]?.route.observed.provider.value, "fixture-router");
  events.push({ at, runId: "fixture-run", kind: "subagent.dispatching", detail: { source: "claude" } });
  assert.equal(read()[0]?.external, null);
  assert.equal(read()[0]?.route.observed.provider.value, null);
  events.push({ at, runId: "fixture-run", kind: "subagent.dispatch", detail: { verdict: "refused" } });
  assert.equal(read().length, 0);
});
it("wrong provenance and untrusted diagnostics cannot cross the route read", () => {
  const forged = { ...route, detail: "PRIVATE-DIAGNOSTIC", observed: { ...route.observed,
    provider: { value: "wrong-router", source: "request.modelProvider" } } };
  const rows = readDispatchEvidence([{ path: "synthetic", events: [{ at, runId: "fixture-run",
    kind: "subagent.dispatch", detail: { route: forged } }] }]);
  assert.equal(rows[0]?.route.observed.provider.value, null);
  assert.ok(!JSON.stringify(rows).includes("PRIVATE-DIAGNOSTIC"));
});
