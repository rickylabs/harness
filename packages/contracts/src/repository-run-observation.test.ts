import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readRepositoryRunObservation, REPOSITORY_RUN_OBSERVATION_SCHEMA, RUN_OBSERVATION_INCOMPLETE_REASONS, RUN_OBSERVATION_UNAVAILABLE_REASONS } from "./index.js";
const load = (name: string): any => JSON.parse(readFileSync(new URL(`../test-fixtures/repository-run-observation/${name}.json`, import.meta.url), "utf8"));
/** A schema-1 record, as a producer on published 0.3.0/0.4.0 wrote it and as durable storage holds it. */
const fixture = (): any => load("read");
/** A schema-2 record carrying all three widenings: UHP source, router-session basis, in-flight status. */
const uhp = (): any => load("read-uhp");
const invalid = (input: unknown): void => assert.deepEqual(readRepositoryRunObservation(input), { ok: false, reason: "invalid" });
const accepted = (input: unknown, note: string): any => {
  const read = readRepositoryRunObservation(input);
  assert.ok(read.ok, note);
  return read.observation;
};
const unsupported = (input: unknown, schema: number | null, protocol: number | null, note: string): void =>
  assert.deepEqual(readRepositoryRunObservation(input), { ok: false, reason: "unsupported-schema", schema, protocol }, note);

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
  // Schema 2 is now read, so the version fence moved: it is the schema *after* the newest one, and
  // any other protocol, that must come back unsupported rather than accepted or invalid.
  unsupported((v => (v.schema = 3, v))(fixture()), 3, 1, "the schema after the newest is unsupported");
  unsupported((v => (v.protocol = 2, v))(fixture()), 1, 2, "another protocol is unsupported at schema 1");
  unsupported((v => (v.protocol = 2, v))(uhp()), 2, 2, "another protocol is unsupported at schema 2");
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

test("a degraded coverage carries neither a run nor a verification", () => {
  // Found by mutation C5, not by reading: relaxing `r.run !== null || r.verification !== null` to `&&`
  // killed no test, because every fixture that exercised a degraded coverage set both to null at once,
  // so either operand answered. A record whose coverage says nothing was read, while still carrying a
  // run, would publish evidence its own coverage denies — and the decoder would silently drop it.
  for (const [status, reason] of [["incomplete", "malformed-record"], ["unavailable", "scope-unverified"]] as const) {
    const both = fixture(); Object.assign(both, { coverage: { status, reason }, run: null, verification: null });
    assert.ok(readRepositoryRunObservation(both).ok, "both null is the only degraded shape there is");
    const keepsRun = fixture(); Object.assign(keepsRun, { coverage: { status, reason }, verification: null });
    invalid(keepsRun);
    const keepsVerification = fixture(); Object.assign(keepsVerification, { coverage: { status, reason }, run: null });
    invalid(keepsVerification);
  }
});

test("writes schema 2, reads schema 1 and schema 2, and never rewrites the schema it read", () => {
  // The write number. A producer emits this; telemetry imports it rather than repeating the literal.
  assert.equal(REPOSITORY_RUN_OBSERVATION_SCHEMA, 2);
  // Read both. An already-persisted schema-1 record stays readable, and comes back as schema 1 —
  // not silently relabelled as 2, which would make stored evidence claim a vocabulary it never had.
  const one = accepted(fixture(), "a persisted schema-1 record must stay readable");
  assert.equal(one.schema, 1);
  assert.deepEqual(one, fixture());
  const two = accepted(uhp(), "a schema-2 UHP record must be readable");
  assert.equal(two.schema, 2);
  assert.deepEqual(two, uhp());
  // The three widenings, present together, are what makes the `read` arm reachable for UHP at all.
  assert.deepEqual(two.coverage, { status: "read", reason: null });
  assert.equal(two.run.source, "uhp");
  assert.equal(two.verification.basis, "enrollment-and-router-session");
  assert.deepEqual(two.run.execution, { status: "source-reported-running", observedAt: two.run.lastObservedAt });
});

test("each widening is refused inside schema 1 and accepted at schema 2, on the same record", () => {
  const widenings: [string, (v: any) => void][] = [
    ["source", v => { v.run.source = "uhp"; }],
    ["basis", v => { v.verification.basis = "enrollment-and-router-session"; }],
    ["status", v => { v.run.execution = { status: "source-reported-running", observedAt: v.run.lastObservedAt }; }],
  ];
  const all: [string, (v: any) => void] = ["all three", v => { for (const [, w] of widenings) w(v); }];
  for (const [name, widen] of [...widenings, all]) {
    // Negative control: schema 1 promised exactly one source, one basis and no in-flight status, so a
    // record claiming schema 1 while carrying schema-2 vocabulary is malformed, not merely newer.
    const narrow = fixture(); widen(narrow); invalid(narrow);
    // Positive control on the same input: only the schema number differs.
    const widened = fixture(); widen(widened); widened.schema = 2;
    assert.equal(accepted(widened, `${name} must be accepted at schema 2`).schema, 2);
  }
});

test("an unread schema answers unsupported-schema with the numbers, never invalid", () => {
  // This distinction is the entire reason the schema moved instead of widening in place: a pinned
  // consumer must be told "newer than me, by this much" rather than "your data is corrupt".
  for (const schema of [0, 3, 4, 99, Number.MAX_SAFE_INTEGER]) unsupported((v => (v.schema = schema, v))(uhp()), schema, 1, `schema ${schema}`);
  // A schema that is not a usable version number still reports unsupported, with a null number.
  for (const schema of ["2", null, 1.5, -1, NaN, Infinity, true, {}, []]) unsupported((v => (v.schema = schema, v))(uhp()), null, 1, `schema ${String(schema)}`);
  unsupported((v => (v.schema = "x", v.protocol = "y", v))(uhp()), null, null, "neither number is usable");
  // The version fence is reached before any field validation, so a future record is never downgraded
  // to `invalid` by a defect this reader has no standing to judge.
  const future = uhp(); future.schema = 3; future.run.source = "a-source-schema-3-invented"; future.binding.namespace = "bad/id";
  unsupported(future, 3, 1, "a future record is not judged by this reader's field rules");
});

test("schema 2 widens by exactly three values and does not overload the billing seam", () => {
  for (const source of ["claude", "opencode", "agy", "codex-uhp", "", "uhp "]) invalid((v => (v.run.source = source, v))(uhp()));
  for (const basis of ["enrollment-and-hosted-session", "enrollment-and-container-session", "router-session", "native-cwd"]) {
    invalid((v => (v.verification.basis = basis, v))(uhp()));
  }
  for (const status of ["running", "in_progress", "source-reported-in-progress", "source-reported-cancelled"]) {
    invalid((v => (v.run.execution = { status, observedAt: v.run.lastObservedAt }, v))(uhp()));
  }
  // Positive control on the same three fields, so the loops above are not passing on a broken fixture.
  assert.equal(accepted(uhp(), "the fixture the refusals are derived from must itself be accepted").run.source, "uhp");
});

test("an in-flight report is timestamped, and unknown stays the untimestamped arm", () => {
  // `source-reported-running` exists so a running session is not forced to share `unknown` with
  // genuinely unobservable ones; it is observed *at a time*, which is what separates the two arms.
  invalid((v => (v.run.execution = { status: "source-reported-running", observedAt: null }, v))(uhp()));
  invalid((v => (v.run.execution = { status: "unknown", observedAt: v.run.lastObservedAt }, v))(uhp()));
  invalid((v => (v.run.execution.observedAt = "2026-09-13T11:59:59.000Z", v))(uhp()));
  const unobservable = uhp(); unobservable.run.execution = { status: "unknown", observedAt: null };
  assert.deepEqual(accepted(unobservable, "a UHP run with no reported status is still readable").run.execution,
    { status: "unknown", observedAt: null });
});

test("source and verification basis stay independent fields, by decision", () => {
  // Widening is bounded to the three literals the owner decided. No cross-field entailment is added:
  // `source` says where the session ran, `basis` says what the verification rests on, and a reader
  // that refused one combination would enforce a policy no decision authorizes. A consumer that
  // wants "read means local worktree" must read `verification.basis` — that is the semantic break.
  const hosted = uhp(); hosted.run.source = "codex";
  assert.equal(accepted(hosted, "a codex source with a router-session basis is a shape, not a lie to refuse").verification.basis, "enrollment-and-router-session");
  const local = uhp(); local.verification.basis = "enrollment-and-local-worktree";
  assert.equal(accepted(local, "a uhp source with a local-worktree basis is likewise not refused here").run.source, "uhp");
});
