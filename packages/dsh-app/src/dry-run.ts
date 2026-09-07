/** Offline composition only. There is deliberately no executor callback or provider registry. */
import { FileStateStore, type AdmissionFailure, type StepState } from "@rickylabs/coordinator";
import type { EffectStatus, IntentKey, SessionPending, StateStore, StateStoreHandle, StoreRefusal, StoreScope } from "@rickylabs/harness-contracts";
import type { LoadRefusal, AdmissionProblem } from "@rickylabs/routing";
import type { DispatchRequest, RouteField, RouteStatus } from "@rickylabs/subagents";
import { driveSnapshot, snapshotData } from "./dry-run-internal.js";

export interface GithubSourceRef {
  readonly kind: "issue";
  readonly state: "open";
  readonly repository: string;
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly body: string;
  readonly updatedAt: string;
  readonly labels: readonly string[];
}
export interface FakeExecutor {
  readonly name: string;
  readonly provider: string;
  /** Synthetic observation, never attestation of a running provider. */
  readonly observation: { readonly provider: string; readonly model: string; readonly effort: string; readonly cwd: string };
  readonly result: { readonly kind: "accepted" | "refused" | "unknown" | "throws"; readonly reason?: string };
}
export interface DryRunPlan {
  /** Exact document text plus caller-owned provenance; no caller-supplied digest is trusted. */
  readonly routing: { readonly source: string; readonly text: string };
  /** The caller must use the scope of its store. Handles do not expose milestone scope. */
  readonly scope: StoreScope;
  readonly source: GithubSourceRef;
  readonly workflow: "milestone";
  readonly states: readonly StepState[];
  readonly lane: string;
  readonly dispatch: DispatchRequest;
  readonly cwd: string;
  readonly attempt: number;
  readonly fake: FakeExecutor;
}
export type DriveRefusal =
  | { readonly kind: "routing-unusable"; readonly refusal: LoadRefusal }
  | { readonly kind: "unresolved-prior-effect"; readonly status: "pending" | "unknown" }
  | { readonly kind: "store-refused"; readonly operation: "read"; readonly refusal: StoreRefusal }
  | { readonly kind: "source-unusable"; readonly detail: string }
  | { readonly kind: "admission-failed"; readonly failure: AdmissionFailure }
  | { readonly kind: "dispatch-inadmissible"; readonly problems: readonly AdmissionProblem[]; readonly detail: string }
  | { readonly kind: "route-unverified"; readonly status: RouteStatus; readonly fields: readonly RouteField[] }
  | { readonly kind: "executor-not-data"; readonly detail: string };
export type DriveOutcome =
  | { readonly drove: false; readonly appended: 0; readonly refusal: DriveRefusal }
  | { readonly drove: false; readonly appended: "unknown"; readonly refusal: { readonly kind: "store-refused"; readonly operation: "intent" | "receipt"; readonly refusal: StoreRefusal } }
  | { readonly drove: true; readonly key: IntentKey; readonly status: EffectStatus }
  | { readonly drove: true; readonly key: IntentKey; readonly undetermined: SessionPending; readonly why: "unknown" | "malformed" | "throws" };

/** Snapshot synchronously before entering any asynchronous phase. Never retry or recover here. */
export async function driveDryRun(handle: StateStoreHandle, plan: DryRunPlan): Promise<DriveOutcome> {
  const snapshot = snapshotData(plan);
  if (!snapshot.ok) return { drove: false, appended: 0, refusal: { kind: "executor-not-data", detail: "plan must contain only finite, acyclic plain data without accessors or callbacks" } };
  return driveSnapshot(handle, snapshot.value);
}

export interface DryRunSetup {
  readonly directory: string;
  readonly scope: StoreScope;
  /** Fixed synthetic boundary time; excluded by the store from semantic digests. */
  readonly at: string;
}
/** Explicit local reference-store setup, with one captured scope for store and every plan. */
export function setupDryRun(options: DryRunSetup):
  | { readonly ok: true; readonly store: StateStore; readonly drive: (handle: StateStoreHandle, plan: Omit<DryRunPlan, "scope">) => Promise<DriveOutcome> }
  | { readonly ok: false; readonly refusal: DriveRefusal } {
  const snapshot = snapshotData(options);
  if (!snapshot.ok) return { ok: false, refusal: { kind: "source-unusable", detail: "invalid dry-run setup" } };
  const raw = snapshot.value;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, refusal: { kind: "source-unusable", detail: "invalid dry-run setup" } };
  const value = raw as Record<string, unknown>;
  const candidateScope = value.scope;
  if (typeof candidateScope !== "object" || candidateScope === null || Array.isArray(candidateScope)) return { ok: false, refusal: { kind: "source-unusable", detail: "invalid dry-run setup" } };
  const scopeFields = candidateScope as Record<string, unknown>;
  if (typeof value.directory !== "string" || !value.directory.trim() ||
      typeof scopeFields.repository !== "string" || !scopeFields.repository.trim() ||
      typeof scopeFields.milestone !== "string" || !scopeFields.milestone.trim() ||
      typeof value.at !== "string" || !value.at.trim()) return { ok: false, refusal: { kind: "source-unusable", detail: "invalid dry-run setup" } };
  const scope = { repository: scopeFields.repository, milestone: scopeFields.milestone };
  const at = value.at;
  const store = new FileStateStore({ directory: value.directory, scope, clock: () => at });
  const handles = new WeakSet<StateStoreHandle>();
  const owned: StateStore = {
    async open() {
      const result = await store.open();
      if (result.ok) handles.add(result.value);
      return result;
    },
    async recover(holder) {
      const result = await store.recover(holder);
      if (result.ok) handles.add(result.value);
      return result;
    },
  };
  return { ok: true, store: owned, drive: (handle, plan) => {
    if (!handles.has(handle)) return Promise.resolve({ drove: false, appended: 0,
      refusal: { kind: "source-unusable", detail: "handle was not acquired through this setup" } });
    const captured = snapshotData(plan);
    if (!captured.ok || typeof captured.value !== "object" || captured.value === null || Array.isArray(captured.value)) {
      return Promise.resolve({ drove: false, appended: 0, refusal: { kind: "executor-not-data", detail: "plan must be plain data" } });
    }
    return driveDryRun(handle, { ...captured.value, scope } as DryRunPlan);
  } };
}
