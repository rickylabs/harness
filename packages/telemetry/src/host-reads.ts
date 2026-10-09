/**
 * The dispatch-host port telemetry owns (dependency inversion). The read models need only
 * `NativeRootResolver`; the composition roots (`cli.ts`, `issue-agent-feed-cli.ts`) also read dispatches and
 * private native hints. `@rickylabs/host-orchid` exports `orchidHost`, which satisfies `OrchidReads`
 * structurally, so the host never imports telemetry.
 */
import type { DispatchEvidence, OrchidDispatchRead } from "@rickylabs/harness-contracts";

export interface NativeRunRef {
  readonly id: string;
  readonly source: string;
  readonly parentId: string | null;
}
/** Resolve a dispatch to its one private same-source native root, or null. */
export interface NativeRootResolver {
  resolveNativeRoot<R extends NativeRunRef>(dispatch: DispatchEvidence, runs: readonly R[]): R | null;
}
export interface OrchidReads extends NativeRootResolver {
  readDispatches(root: string | undefined): Promise<OrchidDispatchRead>;
  bindDispatchEvidence(dispatches: readonly DispatchEvidence[], evidence: readonly DispatchEvidence[]):
    { readonly dispatches: readonly DispatchEvidence[]; readonly degraded: boolean };
  matchesNativeRootIdentity(dispatch: DispatchEvidence, id: string, source: "codex" | "claude" | "agy" | "opencode"): boolean;
  agyStoreDirectory(dispatch: DispatchEvidence): string | null;
  openCodeSessionID(dispatch: DispatchEvidence): string | null;
  verifyOpenCodeBinding(dispatch: DispatchEvidence): Promise<boolean>;
}
