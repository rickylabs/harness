import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { ROUTE_FIELDS, SCOPE, validateReceipt, validateReceiptText } from "./matrix-receipts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const cli = join(here, "matrix-receipts.mjs");

// Invented data only. Model mappings and observer references are assertions, not fleet fixtures.
function receipt() {
  const requested = { model: "vendor/example-model", effort: "medium", transport: "example-cli", role: "plan_evaluation", tier: "example-tier" };
  return {
    schemaVersion: 1,
    resolution: {
      sourceRevision: "a".repeat(40), digest: "b".repeat(64), resolvedAt: "2026-01-02T03:04:05.000Z",
      selected: { logicalModel: "example_model", physicalModel: requested.model },
    },
    requested,
    observed: Object.fromEntries(ROUTE_FIELDS.map((field) => [field, {
      status: "known", value: requested[field], source: "control-plane", evidenceRef: "synthetic-observation",
    }])),
  };
}
const unknown = (reasonCode = "not-observed") => ({ status: "unknown", reasonCode, reason: "Synthetic observer cannot establish this field." });
function run(files) {
  return spawnSync(process.execPath, [cli, ...files], { encoding: "utf8", cwd: root });
}
function fixtureFiles(t, values) {
  const dir = mkdtempSync(join(tmpdir(), "receipt-fixture-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return values.map((value, index) => {
    const path = join(dir, `fixture-${index}.json`);
    writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
    return path;
  });
}

test("known synthetic receipt preserves logical/physical distinction and passes the actual CLI", (t) => {
  const r = receipt();
  assert.notEqual(r.resolution.selected.logicalModel, r.requested.model);
  assert.equal(validateReceipt(r).verdict, "pass");
  const output = run(fixtureFiles(t, [r]));
  assert.equal(output.status, 0);
  assert.equal(output.stderr, "");
  const result = JSON.parse(output.stdout);
  assert.equal(result.scope, SCOPE);
  assert.equal(result.verdict, "pass");
  assert.equal(result.results.length, 1);
});

for (const field of ROUTE_FIELDS) {
  test(`required routing field ${field} cannot be omitted, blank, mistyped, mismatched or assumed`, () => {
    for (const value of [undefined, null, "", " \t ", 1, [], {}, "value\n", "value\u0000", "value\u2028"]) {
      const requested = receipt();
      if (value === undefined) delete requested.requested[field];
      else requested.requested[field] = value;
      assert.equal(validateReceipt(requested).verdict, "fail");
      const observed = receipt();
      if (value === undefined) delete observed.observed[field];
      else observed.observed[field].value = value;
      assert.equal(validateReceipt(observed).verdict, "fail");
    }
    const mismatch = receipt();
    mismatch.observed[field].value += "-different";
    assert.equal(validateReceipt(mismatch).verdict, "fail");
    const absent = receipt();
    absent.observed[field] = unknown();
    assert.equal(validateReceipt(absent).verdict, "unproven");
  });
}

test("string agreement trims whitespace without case folding or Unicode normalization", () => {
  const r = receipt();
  r.observed.effort.value = " medium ";
  assert.equal(validateReceipt(r).verdict, "pass");
  r.observed.effort.value = "Medium";
  assert.equal(validateReceipt(r).verdict, "fail");
  r.requested.effort = "é";
  r.observed.effort.value = "e\u0301";
  assert.equal(validateReceipt(r).verdict, "fail");
});

test("resolution metadata, closed shapes and observation evidence cannot be omitted", () => {
  const mutations = [
    (r) => { r.schemaVersion = 2; }, (r) => { delete r.resolution; },
    (r) => { r.resolution = []; }, (r) => { delete r.resolution.selected; },
    (r) => { r.resolution.selected.logicalModel = ""; },
    (r) => { r.resolution.selected.physicalModel = "another-model"; },
    (r) => { r.resolution.digest = ""; }, (r) => { r.resolution.sourceRevision = "not-a-revision"; },
    (r) => { r.extra = "unexpected"; }, (r) => { r.requested.extra = "unexpected"; },
    (r) => { r.observed.extra = {}; }, (r) => { r.observed.model.extra = "unexpected"; },
    (r) => { delete r.observed.model.evidenceRef; }, (r) => { r.observed.model.evidenceRef = "\n"; },
    (r) => { r.observed.model.source = "brief"; }, (r) => { r.observed.model.status = "assumed"; },
    (r) => { r.observed.role.source = "launcher"; }, (r) => { r.observed.tier.source = "launcher"; },
    (r) => { r.observed.model = unknown("made-up"); },
    (r) => { r.observed.model = { ...unknown(), reason: "" }; },
    (r) => { r.observed.model = { ...unknown(), value: r.requested.model }; },
  ];
  for (const mutate of mutations) {
    const r = receipt(); mutate(r);
    assert.equal(validateReceipt(r).verdict, "fail");
  }
  for (const value of [null, [], true, 1, "text", {}]) assert.equal(validateReceipt(value).verdict, "fail");
});

test("timestamps require real UTC calendar dates at second or millisecond precision", () => {
  for (const value of ["2026-01-02T03:04:05Z", "2026-01-02T03:04:05.123Z", "2024-02-29T00:00:00Z"]) {
    const r = receipt(); r.resolution.resolvedAt = value;
    assert.equal(validateReceipt(r).verdict, "pass");
  }
  for (const value of ["2026-02-30T00:00:00Z", "2026-01-02", "2026-01-02T03:04:05+00:00", "2026-01-02T03:04:05.1Z", "2026-01-02T24:00:00Z", "bad", null]) {
    const r = receipt(); r.resolution.resolvedAt = value;
    assert.equal(validateReceipt(r).verdict, "fail");
  }
});

test("JSON duplicates are semantic, scoped, and never inferred from text inside a value", () => {
  const r = receipt();
  r.observed.model.evidenceRef = '{"status":1,"status":2}';
  assert.equal(validateReceiptText(JSON.stringify(r)).verdict, "pass");
  const input = JSON.stringify(receipt());
  for (const bad of [
    input.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    input.replace('"status":"known"', '"status":"unknown","status":"known"'),
    input.replace('"status":"known"', '"sta\\u0074us":"unknown","status":"known"'),
  ]) {
    assert.equal(validateReceiptText(bad).verdict, "fail");
    assert.equal(validateReceiptText(bad).findings[0].code, "duplicate-key");
  }
  // JSON.parse rejects YAML conveniences before the duplicate detector sees them.
  for (const bad of ["", "{", "schemaVersion: 1", "{\"schemaVersion\": 1,}", "[]", "null", "{}"])
    assert.equal(validateReceiptText(bad).verdict, "fail");
});

test("applied effort, prose-only effort and role/tier unknowns retain distinct verdicts", (t) => {
  // The dispatcher currently applies effort on Agy; this fixture is not validator policy.
  const applied = receipt(); applied.requested.transport = "agy"; applied.observed.transport.value = "agy";
  const proseOnly = receipt(); proseOnly.observed.effort = unknown("prose-only");
  const unobservedRole = receipt(); unobservedRole.observed.role = unknown("not-externally-observable");
  const unobservedTier = receipt(); unobservedTier.observed.tier = unknown("not-externally-observable");
  const mismatch = receipt(); mismatch.observed.effort.value = "high";
  const files = fixtureFiles(t, [applied, proseOnly, unobservedRole, unobservedTier, mismatch]);
  assert.equal(run([files[0]]).status, 0);
  for (const file of files.slice(1, 4)) assert.equal(run([file]).status, 2);
  const output = run(files);
  assert.equal(output.status, 1);
  assert.deepEqual(JSON.parse(output.stdout).results.map((r) => r.verdict), ["pass", "unproven", "unproven", "unproven", "fail"]);
});

test("missing and unreadable input cannot pass or disclose its path", (t) => {
  const empty = run([]);
  assert.equal(empty.status, 2);
  assert.equal(JSON.parse(empty.stdout).reason, "no-inputs");
  const [valid] = fixtureFiles(t, [receipt()]);
  const missing = join(dirname(valid), "PRIVATE_INPUT_SENTINEL_NOT_FOR_LOGS.json");
  const output = run([valid, missing]);
  assert.equal(output.status, 2);
  assert.equal((output.stdout + output.stderr).includes("PRIVATE_INPUT_SENTINEL"), false);
  const result = JSON.parse(output.stdout);
  assert.equal(result.results[1].index, 1);
  assert.equal(result.results[1].findings[0].code, "unreadable");
});

test("a symlink entry point executes the checker instead of silently exiting zero", (t) => {
  const [valid, malformed] = fixtureFiles(t, [receipt(), "{"]);
  const alias = join(dirname(valid), "receipt-alias.mjs");
  symlinkSync(cli, alias);
  const empty = spawnSync(process.execPath, [alias], { encoding: "utf8" });
  assert.equal(empty.status, 2);
  assert.equal(JSON.parse(empty.stdout).reason, "no-inputs");
  const checked = spawnSync(process.execPath, [alias, valid], { encoding: "utf8" });
  assert.equal(checked.status, 0);
  assert.equal(JSON.parse(checked.stdout).results.length, 1);
  const invalid = spawnSync(process.execPath, [alias, malformed], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stdout).results[0].findings[0].code, "invalid-json");
});

test("the real CLI rejects escaped duplicate keys, while allowing key-looking string contents", (t) => {
  const duplicate = JSON.stringify(receipt()).replace('"status":"known"', '"sta\\u0074us":"known","status":"known"');
  const valid = receipt();
  valid.observed.model.evidenceRef = '{"status":1,"status":2}';
  const [badFile, goodFile] = fixtureFiles(t, [duplicate, valid]);
  const bad = run([badFile]);
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).results[0].findings[0].code, "duplicate-key");
  assert.equal(run([goodFile]).status, 0);
});

test("hostile values, keys and malformed input are never echoed by the CLI", (t) => {
  const sentinel = "PRIVATE_VALUE_SENTINEL_NOT_FOR_LOGS";
  const r = receipt();
  r.observed.model.value = sentinel;
  r.observed.model.evidenceRef = sentinel;
  r[sentinel] = sentinel;
  for (const file of fixtureFiles(t, [r, '{"' + sentinel, '{"schemaVersion":1,"schemaVersion":"' + sentinel + '"}'])) {
    const output = run([file]);
    assert.equal(output.status, 1);
    assert.equal((output.stdout + output.stderr).includes(sentinel), false);
    assert.equal(output.stderr, "");
  }
});

test("the root CI aggregate reaches this suite as an explicit named stage", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.match(manifest.scripts.test, /check:test-scripts check:receipts test:packages/);
  assert.equal(manifest.scripts["check:receipts"], "node --test .llm/tools/harness/matrix-receipts.test.mjs");
});
