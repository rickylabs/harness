/** Associate only an existing explicit DispatchResult reference, never cwd, title or issue prose. */
import { projectRouteIdentity, type DispatchEvidence } from "@rickylabs/harness-contracts";
import { hasOrchidNativeBindingBoundary } from "./native-binding-registry.js";

export function bindOrchidDispatchEvidence(
  dispatches: readonly DispatchEvidence[], evidence: readonly DispatchEvidence[],
): { readonly dispatches: readonly DispatchEvidence[]; readonly degraded: boolean } {
  let degraded = false;
  const rows = dispatches.map(dispatch => {
    // Orchid owns this binding now; legacy log rows cannot replace or revive it.
    if (hasOrchidNativeBindingBoundary(dispatch)) return dispatch;
    const matches = evidence.filter(row => row.runId === dispatch.runId && row.external !== null);
    if (matches.length === 0) return dispatch;
    const match = matches[0];
    if (matches.length !== 1 || !match || match.source === null || match.source !== dispatch.source) {
      degraded = true;
      return dispatch;
    }
    return { ...dispatch, external: match.external,
      route: projectRouteIdentity({ requested: dispatch.route.requested, observed: match.route.observed }) };
  });
  return { dispatches: rows, degraded };
}
