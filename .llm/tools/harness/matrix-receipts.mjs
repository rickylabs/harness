import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load, JSON_SCHEMA } from "js-yaml";

export const SCOPE = "receipt structure and requested/observed agreement only";
export const ROUTE_FIELDS = ["model", "effort", "transport", "role", "tier"];
export const REASON_CODES = [
  "not-observed", "prose-only", "not-externally-observable", "observer-unavailable",
];
const EXIT = { pass: 0, fail: 1, unproven: 2 };
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0 &&
  !/[\p{Cc}\u2028\u2029]/u.test(value);
const same = (left, right) => text(left) && text(right) && left.trim() === right.trim();

/** Validate shape and agreement; evidence references and mapping assertions are not verified. */
export function validateReceipt(receipt) {
  const findings = [];
  const fail = (field, code) => findings.push({ field, code, verdict: "fail" });
  const object = (value, keys, field) => {
    if (!record(value)) { fail(field, "expected-object"); return false; }
    if (Object.keys(value).some((key) => !keys.includes(key))) fail(field, "unexpected-field");
    for (const key of keys) {
      if (!Object.hasOwn(value, key)) fail(`${field}.${key}`, "missing-field");
    }
    return true;
  };
  const string = (value, field) => {
    if (!text(value)) fail(field, "expected-nonblank-text-without-controls");
  };
  if (object(receipt, ["schemaVersion", "resolution", "requested", "observed"], "$")) {
    if (receipt.schemaVersion !== 1) fail("$.schemaVersion", "unsupported-schema");
    const resolution = receipt.resolution;
    if (object(resolution, ["sourceRevision", "digest", "resolvedAt", "selected"], "$.resolution")) {
      if (typeof resolution.sourceRevision !== "string" || !/^[a-f\d]{40}$/i.test(resolution.sourceRevision)) {
        fail("$.resolution.sourceRevision", "expected-source-revision");
      }
      if (typeof resolution.digest !== "string" || !/^[a-f\d]{64}$/i.test(resolution.digest)) {
        fail("$.resolution.digest", "expected-sha256");
      }
      const stamp = resolution.resolvedAt;
      const date = typeof stamp === "string" ? new Date(stamp) : new Date(NaN);
      const canonical = typeof stamp === "string" && !stamp.includes(".")
        ? stamp.replace(/Z$/, ".000Z") : stamp;
      if (typeof stamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(stamp) ||
          !Number.isFinite(date.valueOf()) || date.toISOString() !== canonical) {
        fail("$.resolution.resolvedAt", "expected-utc-timestamp");
      }
      if (object(resolution.selected, ["logicalModel", "physicalModel"], "$.resolution.selected")) {
        string(resolution.selected.logicalModel, "$.resolution.selected.logicalModel");
        string(resolution.selected.physicalModel, "$.resolution.selected.physicalModel");
      }
    }
    if (object(receipt.requested, ROUTE_FIELDS, "$.requested")) {
      for (const field of ROUTE_FIELDS) string(receipt.requested[field], `$.requested.${field}`);
      if (text(resolution?.selected?.physicalModel) && text(receipt.requested.model) &&
          !same(receipt.requested.model, resolution.selected.physicalModel)) {
        fail("$.requested.model", "selected-model-mismatch");
      }
    }
    if (object(receipt.observed, ROUTE_FIELDS, "$.observed")) {
      for (const field of ROUTE_FIELDS) {
        const path = `$.observed.${field}`;
        const observation = receipt.observed[field];
        if (!record(observation)) { fail(path, "expected-object"); continue; }
        if (observation.status === "known") {
          object(observation, ["status", "value", "source", "evidenceRef"], path);
          string(observation.value, `${path}.value`);
          string(observation.evidenceRef, `${path}.evidenceRef`);
          const sources = field === "role" || field === "tier" ? ["control-plane"] : ["launcher", "control-plane"];
          if (!sources.includes(observation.source)) fail(`${path}.source`, "unsupported-observer");
          if (text(observation.value) && text(receipt.requested?.[field]) &&
              !same(observation.value, receipt.requested[field])) fail(path, "routing-mismatch");
        } else if (observation.status === "unknown") {
          object(observation, ["status", "reasonCode", "reason"], path);
          string(observation.reason, `${path}.reason`);
          if (!REASON_CODES.includes(observation.reasonCode)) fail(`${path}.reasonCode`, "unsupported-reason");
          findings.push({ field: path, code: "observation-unknown", verdict: "unproven" });
        } else fail(`${path}.status`, "unsupported-observation-status");
      }
    }
  }
  return { verdict: verdictOf(findings), findings };
}

function verdictOf(results) {
  return results.some((result) => result.verdict === "fail") ? "fail"
    : results.some((result) => result.verdict === "unproven") ? "unproven" : "pass";
}

const problem = (verdict, code) => ({ verdict, findings: [{ field: "$", code, verdict }] });

/** JSON syntax first; the existing YAML reader supplies semantic duplicate-key detection only. */
export function validateReceiptText(input) {
  let receipt;
  try { receipt = JSON.parse(input); }
  catch { return problem("fail", "invalid-json"); }
  try { load(input, { schema: JSON_SCHEMA, json: false }); }
  catch (error) {
    return problem("fail", error?.reason === "duplicated mapping key" ? "duplicate-key" : "unsupported-json");
  }
  return validateReceipt(receipt);
}

/** Explicit files only; diagnostics expose an input index, never paths, values or parser errors. */
export function checkFiles(files) {
  const results = files.map((file, index) => {
    let result;
    try { result = validateReceiptText(readFileSync(file, "utf8")); }
    catch { result = problem("unproven", "unreadable"); }
    return { index, ...result };
  });
  const verdict = results.length === 0 ? "unproven" : verdictOf(results);
  return { scope: SCOPE, verdict, results, ...(files.length ? {} : { reason: "no-inputs" }) };
}

// Resolve entry-point symlinks; an alias must not silently skip the CLI and exit zero.
function isMain() {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; } // Imported modules can have no file entry point (for example node -e).
}

if (isMain()) {
  const result = checkFiles(process.argv.slice(2));
  console.log(JSON.stringify(result));
  process.exitCode = EXIT[result.verdict];
}
