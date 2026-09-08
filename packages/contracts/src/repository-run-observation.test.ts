import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readRepositoryRunObservation, RUN_OBSERVATION_INCOMPLETE_REASONS, RUN_OBSERVATION_UNAVAILABLE_REASONS } from "./index.js";
const fixture = (): any => JSON.parse(readFileSync(new URL("../test-fixtures/repository-run-observation/read.json", import.meta.url), "utf8"));
const invalid = (input: unknown): void => assert.deepEqual(readRepositoryRunObservation(input), { ok: false, reason: "invalid" });

test("standalone strict decoder owns normalized nested data and supports every coverage reason", () => {
  const value = fixture(), read = readRepositoryRunObservation(value);
  assert.ok(read.ok);
  assert.deepEqual(read.observation, value);
  value.binding.repo.name = "changed";
  value.run.identity.provider.value = "changed";
  assert.equal(read.observation.binding.repo.name, "repo");
  assert.equal(read.observation.run?.identity.provider?.value, "synthetic-provider");
  for (const [status, reasons] of [["incomplete", RUN_OBSERVATION_INCOMPLETE_REASONS], ["unavailable", RUN_OBSERVATION_UNAVAILABLE_REASONS]] as const) {
    for (const reason of reasons) {
      const v = fixture(); Object.assign(v, { coverage: { status, reason }, run: null, verification: null });
      assert.ok(readRepositoryRunObservation(v).ok, reason);
      v.coverage.status = status === "incomplete" ? "unavailable" : "incomplete";
      invalid(v);
    }
  }
});

test("strict schema versions, malformed unions, bounded identifiers, dates and counters", () => {
  for (const key of ["schema", "protocol"]) {
    const v = fixture(); v[key] = 2;
    assert.equal(readRepositoryRunObservation(v).ok, false);
    assert.equal((readRepositoryRunObservation(v) as {reason:string}).reason, "unsupported-schema");
  }
  const mutations: ((v: any) => void)[] = [
    v => { v.coverage.reason = "future-reason"; }, v => { v.coverage.status = "future"; },
    v => { v.run = null; }, v => { v.verification = null; },
    v => { v.verification.basis = "native-cwd"; },
    v => { v.verification.verifiedAt = "2026-09-08T12:00:06.000Z"; },
    v => { v.run.source = "other-provider"; }, v => { v.run.execution.status = "running"; },
    v => { v.run.relationships.parent = "native-2"; },
    v => { v.run.usage = { observedAt: v.run.lastObservedAt }; },
    v => { v.run.usage.cost = 1; }, v => { v.run.identity.model.value = "private model prose"; },
    v => { v.run.identity.model.value = "x".repeat(201); },
    v => { v.run.identity.effort = { value: "medium", observedAt: v.capturedAt }; },
    v => { v.run.execution = { status: "unknown", observedAt: v.run.lastObservedAt }; },
    v => { v.run.firstObservedAt = v.capturedAt; },
    v => { v.binding.repo.owner = "owner/name"; }, v => { v.binding.repo.name = ".."; },
  ];
  for (const key of ["namespace", "id", "revision", "sourceScopeId"]) for (const value of ["", "a/b", "_start", "a".repeat(129), "line\n", null]) mutations.push(v => { v.binding[key] = value; });
  for (const value of ["", "a/b", "a".repeat(129), null]) mutations.push(v => { v.run.nativeId = value; });
  for (const value of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, "17", null]) mutations.push(v => { v.run.usage.inputTokens = value; });
  for (const value of ["2026-02-30T12:00:00.000Z", "2026-09-08T12:00:00Z", "2026-09-08T12:00:00.000+00:00", "2026-09-08T24:00:00.000Z", "no-date"]) mutations.push(v => { v.capturedAt = value; });
  for (const mutate of mutations) { const v = fixture(); mutate(v); invalid(v); }
  const zero = fixture(); zero.run.usage.inputTokens = -0;
  const r = readRepositoryRunObservation(zero); assert.ok(r.ok); assert.ok(!Object.is(r.observation.run?.usage?.inputTokens, -0));
});

test("unknown keys, missing keys, exotic objects and getters fail without reflecting input", () => {
  const paths = [[], ["binding"], ["binding", "repo"], ["coverage"], ["verification"], ["run"], ["run", "identity"], ["run", "identity", "model"], ["run", "usage"], ["run", "execution"], ["run", "relationships"]];
  for (const path of paths) {
    const at = (v: any): any => path.reduce((o, k) => o[k], v);
    let v = fixture(); at(v).unexpected = "synthetic-private-canary"; invalid(v);
    v = fixture(); delete at(v)[Object.keys(at(v))[0]!]; invalid(v);
    v = fixture(); at(v)[Symbol("private")] = true; invalid(v);
    v = fixture(); Object.setPrototypeOf(at(v), null); invalid(v);
    v = fixture(); Object.defineProperty(at(v), Object.keys(at(v))[0]!, { get() { throw new Error("getter must not execute"); } }); invalid(v);
  }
  for (const v of [null, [], 42, "private", new Proxy({}, { getPrototypeOf() { throw new Error("private"); } })]) invalid(v);
  let invoked = false;
  const v = fixture(); Object.defineProperty(v.run.identity.model, "value", { get() { invoked = true; return "secret"; } });
  invalid(v); assert.equal(invoked, false);
});
