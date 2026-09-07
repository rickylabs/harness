/** Internal phase instrumentation for owned crash tests; not exported by the package. */
import { admissibleDispatch, digest, type StepState } from "@rickylabs/coordinator";
import type { DeliveryReceipt, IntentKey, StateStoreHandle, StoreResult } from "@rickylabs/harness-contracts";
import { admitDispatch, describeAdmission, parseRoutingDocument } from "@rickylabs/routing";
import { compareRouteIdentity, HARNESSES, isRouteEvidenceVerified, ROUTERS, type DispatchRequest } from "@rickylabs/subagents";
import type { DriveOutcome, DriveRefusal } from "./dry-run.js";

const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
function issueUrl(url: unknown, repository: string, number: unknown): boolean {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://github.com" && parsed.username === "" && parsed.password === "" &&
      parsed.search === "" && parsed.hash === "" && parsed.pathname === `/${repository}/issues/${number}` &&
      url === parsed.href;
  } catch { return false; }
}
const code = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-z0-9-]{0,47}$/.test(v);

/** Inspect descriptors before cloning: structuredClone alone invokes getters. */
export function snapshotData(input: unknown): { ok: true; value: unknown } | { ok: false } {
  const seen = new Set<object>();
  function plain(v: unknown): boolean {
    if (v === null || v === undefined || typeof v === "string" || typeof v === "boolean") return true;
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v !== "object" || seen.has(v)) return false;
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return false;
    seen.add(v);
    const valid = Reflect.ownKeys(v).every(k => {
      const d = Object.getOwnPropertyDescriptor(v, k);
      return typeof k === "string" && d !== undefined && "value" in d && plain(d.value);
    });
    seen.delete(v);
    return valid;
  }
  try { return plain(input) ? { ok: true, value: structuredClone(input) } : { ok: false }; }
  catch { return { ok: false }; }
}
export interface DriveTestHooks {
  readonly assembled?: (key: IntentKey) => void | Promise<void>;
  readonly attempted?: (key: IntentKey) => void | Promise<void>;
}
const refuse = (refusal: DriveRefusal): DriveOutcome => ({ drove: false, appended: 0, refusal });
const malformed = (): DriveOutcome => refuse({ kind: "source-unusable", detail: "expected an open GitHub issue, canonical workflow, matching scope and positive attempt" });

async function write<T>(operation: "read" | "intent" | "receipt", action: () => Promise<StoreResult<T>>): Promise<StoreResult<T>> {
  try { return await action(); }
  catch { return { ok: false, refusal: { kind: "io-failure", operation } }; }
}

/** Only the public wrapper accepts caller data; hooks are not reachable through its exports. */
const operations = new WeakMap<StateStoreHandle, Promise<void>>();
/** Serialize the entire read/admit/effect sequence, not merely the store's individual writes. */
export function driveSnapshot(handle: StateStoreHandle, value: unknown, hooks: DriveTestHooks = {}): Promise<DriveOutcome> {
  const previous = operations.get(handle) ?? Promise.resolve();
  const result = previous.then(() => driveChecked(handle, value, hooks));
  const tail = result.then(() => {}, () => {});
  operations.set(handle, tail);
  void tail.then(() => { if (operations.get(handle) === tail) operations.delete(handle); });
  return result;
}
async function driveChecked(handle: StateStoreHandle, value: unknown, hooks: DriveTestHooks): Promise<DriveOutcome> {
  if (!object(value)) return malformed();
  const { source, scope, dispatch, fake, routing } = value;
  if (!object(routing) || !text(routing.source) || !text(routing.text) ||
      Object.keys(routing).some(k => k !== "source" && k !== "text")) return malformed();
  const loaded = parseRoutingDocument(routing.text, routing.source);
  if (!loaded.ok) return refuse({ kind: "routing-unusable", refusal: loaded.refusal });
  if (!object(source) || !object(scope) || !text(scope.repository) || !text(scope.milestone) ||
      source.repository !== scope.repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(scope.repository) ||
      source.kind !== "issue" || source.state !== "open" || !Number.isSafeInteger(source.number) || (source.number as number) <= 0 ||
      !text(source.title) || !text(source.body) || !issueUrl(source.url, scope.repository, source.number) ||
      typeof source.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(source.updatedAt) ||
      !Number.isFinite(Date.parse(source.updatedAt)) ||
      new Date(source.updatedAt).toISOString() !== (source.updatedAt.length === 20 ? source.updatedAt.replace("Z", ".000Z") : source.updatedAt) ||
      !Array.isArray(source.labels) || !source.labels.every(text) || "task" in value ||
      value.workflow !== "milestone" || !Number.isSafeInteger(value.attempt) || (value.attempt as number) <= 0 ||
      !text(value.lane) || !text(value.cwd)) return malformed();
  const admission = admissibleDispatch(value.states as readonly StepState[]);
  if (!admission.ok) return refuse({ kind: "admission-failed", failure: admission.failure });
  // Validate the runtime shape before invoking the typed routing API, which owns vocabulary checks.
  if (!object(dispatch) || typeof dispatch.harness !== "string" || !HARNESSES.includes(dispatch.harness as DispatchRequest["harness"]) ||
      typeof dispatch.prompt !== "string" ||
      !["model", "effort", "maxTokens", "profile", "timeout", "router"].every(k => dispatch[k] === undefined || typeof dispatch[k] === "string") ||
      (dispatch.router !== undefined && !ROUTERS.includes(dispatch.router as NonNullable<DispatchRequest["router"]>))) {
    return refuse({ kind: "dispatch-inadmissible", problems: [{ reason: "malformed", message: "dispatch fields have invalid types or transport" }], detail: "malformed: dispatch fields have invalid types or transport" });
  }
  const routed = admitDispatch(loaded.loaded.configuration, dispatch as unknown as DispatchRequest, { lane: value.lane });
  if (!routed.ok) return refuse({ kind: "dispatch-inadmissible", problems: routed.problems, detail: describeAdmission(routed) });
  if (!object(fake) || !code(fake.name) || !code(fake.provider)) return refuse({ kind: "executor-not-data", detail: "fake name and provider must be short lowercase identifiers" });
  const observed = object(fake.observation) ? fake.observation : {};
  const route = compareRouteIdentity(
    { provider: fake.provider, model: routed.dispatch.model, effort: routed.dispatch.effort, cwd: value.cwd },
    { provider: observed.provider, model: observed.model, effort: observed.effort, cwd: observed.cwd },
  );
  if (!isRouteEvidenceVerified(route)) return refuse({ kind: "route-unverified", status: route.status,
    fields: [...new Set([...route.mismatches, ...route.invalid.map(i => i.field)])] });
  const key: IntentKey = { repository: scope.repository, task: `issue-${source.number}`, workflowStep: "dispatch-run",
    attempt: value.attempt as number,
    inputRevision: digest({ mode: "dry-run", routing: loaded.loaded.source.digest, scope, source, lane: value.lane, workflow: "milestone", step: "dispatch-run",
      dispatch: routed.dispatch, cwd: value.cwd, provider: fake.provider, fake: { name: fake.name, result: fake.result }, admission: admission.states }),
  };
  const state = await write("read", () => handle.read());
  if (!state.ok) return refuse({ kind: "store-refused", operation: "read", refusal: state.refusal });
  const sameOperation = (effect: { readonly key: IntentKey }): boolean => effect.key.repository === key.repository &&
    effect.key.task === key.task && effect.key.workflowStep === key.workflowStep;
  if (state.value.pending.some(sameOperation)) return refuse({ kind: "unresolved-prior-effect", status: "pending" });
  if (state.value.terminal.some(effect => effect.status === "unknown" && sameOperation(effect))) {
    return refuse({ kind: "unresolved-prior-effect", status: "unknown" });
  }
  await hooks.assembled?.(structuredClone(key));
  const intent = await write("intent", () => handle.intent(key));
  if (!intent.ok) return { drove: false, appended: "unknown", refusal: { kind: "store-refused", operation: "intent", refusal: intent.refusal } };
  // One discrete in-process fake attempt. Only an answered, definitive refusal proves non-delivery.
  let receipt: DeliveryReceipt | undefined;
  let why: "unknown" | "malformed" | "throws" = "malformed";
  try {
    const result = fake.result;
    if (object(result) && Object.keys(result).every(k => k === "kind" || k === "reason") &&
        (result.reason === undefined || code(result.reason))) {
      if (result.kind === "throws") throw new Error("synthetic attempt threw");
      if (result.kind === "unknown") why = "unknown";
      if (result.kind === "accepted") receipt = { delivered: true, reference: `dry-run:${fake.name}@${digest(key).slice(7)}` };
      if (result.kind === "refused" && code(result.reason)) receipt = { delivered: false, reason: result.reason };
    }
  } catch { why = "throws"; }
  await hooks.attempted?.(structuredClone(key));
  if (!receipt) return { drove: true, key, undetermined: intent.value, why };
  const settled = await write("receipt", () => handle.receipt(intent.value, receipt));
  if (!settled.ok) return { drove: false, appended: "unknown", refusal: { kind: "store-refused", operation: "receipt", refusal: settled.refusal } };
  return { drove: true, key, status: settled.value };
}
