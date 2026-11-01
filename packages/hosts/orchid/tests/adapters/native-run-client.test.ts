/** The native RPC parser accounts for every requested coordinate and refuses ambiguous identity. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { decodeNativeRunLookup } from "../../src/adapters/native-run-client.js";
const query = [{ key: "701", label: "codex-701" }];
const record = { key: "701", issue: { repo: "example/project", number: 7 }, dispatchKey: "a".repeat(64),
  nativeSessionId: "fixture-native-id", agent: "codex", label: "codex-701", phase: "active", observedAt: "2026-10-05T13:01:00.000Z" };
const result = { type: "run_lookup", schemaVersion: 1, complete: true, generation: "fixture", revision: 1, records: [record], missing: [] };
it("accepts a native record or a closed missing reason for exactly the requested key", () => {
  assert.equal(decodeNativeRunLookup(result, query).records.length, 1);
  assert.equal(decodeNativeRunLookup({ ...result, records: [], missing: [{ key: "701", reason: "native_identity_unavailable" }] }, query).missing.length, 1);
});
it("rejects missing, duplicated, foreign and contradictory native lookup results", () => {
  for (const invalid of [
    { ...result, records: [] }, { ...result, complete: false },
    { ...result, records: [record, record] },
    { ...result, records: [{ ...record, label: "claude-701" }] },
    { ...result, records: [{ ...record, nativeSessionId: "" }] },
    { ...result, records: [{ ...record, key: "702" }] },
    { ...result, records: [], missing: [{ key: "701", reason: "PRIVATE-ERROR-CANARY" }] },
  ]) assert.throws(() => decodeNativeRunLookup(invalid, query), /native run source unavailable/);
});
