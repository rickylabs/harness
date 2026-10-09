/** Private Orchid join state. Neither credentials nor join keys are enumerable/public fields. */
import { createHash } from "node:crypto";
import type { DispatchEvidence } from "@rickylabs/harness-contracts";

export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const keyFor = (source: string, identity: string) => digest(source + "\0" + identity);
export interface NativeBinding {
  readonly key: string | null; readonly agyDirectory?: string;
  readonly opencodeID?: string; readonly record?: string; readonly bindingRevision?: string;
}
const bindings = new WeakMap<DispatchEvidence, NativeBinding>();
/** Written only by the binding reader, after its full receipt and exact native ID guard. */
export function setNativeBinding(dispatch: DispatchEvidence, binding: NativeBinding): void {
  bindings.set(dispatch, binding);
}
export function nativeBinding(dispatch: DispatchEvidence): NativeBinding | undefined {
  return bindings.get(dispatch);
}
/** Resolve only one same-source native root. Existing telemetry owns parent-chain traversal. */
export function resolveOrchidNativeRoot<R extends { readonly id: string; readonly source: string; readonly parentId: string | null }>(
  dispatch: DispatchEvidence, runs: readonly R[]): R | null {
  const key = bindings.get(dispatch)?.key;
  const matches = runs.filter(run => keyFor(run.source, run.id) === key);
  return matches.length === 1 && matches[0]!.parentId === null ? matches[0]! : null;
}
/** Match a head identity to Orchid's private root without revealing either identity or key. */
export function matchesOrchidNativeRootIdentity(dispatch: DispatchEvidence, id: string,
  source: "codex" | "claude" | "agy" | "opencode"): boolean {
  const key = bindings.get(dispatch)?.key;
  return key !== null && key !== undefined && dispatch.source === source && keyFor(source, id) === key;
}
/** Private store hint only after the full receipt and exact native ID guard. Never serialize it. */
export function orchidAGYStoreDirectory(dispatch: DispatchEvidence): string | null {
  return dispatch.source === "agy" ? bindings.get(dispatch)?.agyDirectory ?? null : null;
}
/** Private reader rows cannot acquire credentials from the legacy exported DispatchResult surface. */
export function hasOrchidNativeBindingBoundary(dispatch: DispatchEvidence): boolean {
  return bindings.has(dispatch);
}
/** Exact query parameter remains private; never add it to a dispatch/public projection. */
export function orchidOpenCodeSessionID(dispatch: DispatchEvidence): string | null {
  return dispatch.source === "opencode" ? bindings.get(dispatch)?.opencodeID ?? null : null;
}
