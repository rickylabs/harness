/** Route receipts: requested and observed routing must agree, and an unobserved field stays unproven. */
export const SCOPE = "receipt structure and requested/observed agreement only";
export const ROUTE_FIELDS = ["model", "effort", "transport", "role", "tier"] as const;
export const REASON_CODES = [
  "not-observed", "prose-only", "not-externally-observable", "observer-unavailable",
] as const;

export type ReceiptVerdict = "pass" | "fail" | "unproven";
export interface ReceiptFinding {
  readonly field: string;
  readonly code: string;
  readonly verdict: ReceiptVerdict;
}
export interface ReceiptResult {
  readonly verdict: ReceiptVerdict;
  readonly findings: readonly ReceiptFinding[];
}

type JsonObject = Record<string, unknown>;
const record = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 &&
  !/[\p{Cc}\u2028\u2029]/u.test(value);
const same = (left: unknown, right: unknown) => text(left) && text(right) && left.trim() === right.trim();
const member = (value: unknown, key: string): unknown => (record(value) ? value[key] : undefined);

/** Validate shape and agreement; evidence references and mapping assertions are not verified. */
export function validateReceipt(receipt: unknown): ReceiptResult {
  const findings: ReceiptFinding[] = [];
  const fail = (field: string, code: string) => findings.push({ field, code, verdict: "fail" });
  const object = (value: unknown, keys: readonly string[], field: string): value is JsonObject => {
    if (!record(value)) { fail(field, "expected-object"); return false; }
    if (Object.keys(value).some((key) => !keys.includes(key))) fail(field, "unexpected-field");
    for (const key of keys) {
      if (!Object.hasOwn(value, key)) fail(`${field}.${key}`, "missing-field");
    }
    return true;
  };
  const string = (value: unknown, field: string) => {
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
    const requested = receipt.requested;
    if (object(requested, ROUTE_FIELDS, "$.requested")) {
      for (const field of ROUTE_FIELDS) string(requested[field], `$.requested.${field}`);
      const physicalModel = member(member(resolution, "selected"), "physicalModel");
      if (text(physicalModel) && text(requested.model) && !same(requested.model, physicalModel)) {
        fail("$.requested.model", "selected-model-mismatch");
      }
    }
    const observed = receipt.observed;
    if (object(observed, ROUTE_FIELDS, "$.observed")) {
      for (const field of ROUTE_FIELDS) {
        const path = `$.observed.${field}`;
        const observation = observed[field];
        if (!record(observation)) { fail(path, "expected-object"); continue; }
        if (observation.status === "known") {
          object(observation, ["status", "value", "source", "evidenceRef"], path);
          string(observation.value, `${path}.value`);
          string(observation.evidenceRef, `${path}.evidenceRef`);
          const sources: readonly unknown[] = field === "role" || field === "tier" ? ["control-plane"] : ["launcher", "control-plane"];
          if (!sources.includes(observation.source)) fail(`${path}.source`, "unsupported-observer");
          const wanted = member(requested, field);
          if (text(observation.value) && text(wanted) && !same(observation.value, wanted)) fail(path, "routing-mismatch");
        } else if (observation.status === "unknown") {
          object(observation, ["status", "reasonCode", "reason"], path);
          string(observation.reason, `${path}.reason`);
          if (!(REASON_CODES as readonly unknown[]).includes(observation.reasonCode)) {
            fail(`${path}.reasonCode`, "unsupported-reason");
          }
          findings.push({ field: path, code: "observation-unknown", verdict: "unproven" });
        } else fail(`${path}.status`, "unsupported-observation-status");
      }
    }
  }
  return { verdict: verdictOf(findings), findings };
}

/** Any fail wins, then any unproven; only an all-pass set passes. */
export function verdictOf(results: readonly { readonly verdict: ReceiptVerdict }[]): ReceiptVerdict {
  return results.some((result) => result.verdict === "fail") ? "fail"
    : results.some((result) => result.verdict === "unproven") ? "unproven" : "pass";
}

/** A whole-input refusal at the root field, used for parse and read failures. */
export const problem = (verdict: ReceiptVerdict, code: string): ReceiptResult =>
  ({ verdict, findings: [{ field: "$", code, verdict }] });
