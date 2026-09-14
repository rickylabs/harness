/** Reads dispatch receipts from the existing telemetry log; no collection or inferred joins. */
import { projectRouteIdentity, type RouteIdentityEvidence } from "@rickylabs/subagents";
import type { LiveFile } from "./live.js";
import type { RunSource } from "./model.js";

export interface DispatchEvidence {
  readonly runId: string;
  readonly external: string | null;
  readonly source: RunSource | null;
  readonly route: RouteIdentityEvidence;
  readonly observedAt?: string;
  readonly revision?: string;
  readonly linkageBasis?: "dispatcher-confirmed";
  readonly issue?: { readonly repo: string; readonly number: number } | null;
  readonly parentRunId?: string | null;
  readonly location?: { readonly paneId: string; readonly workspaceId: string } | null;
  /** Dispatch acknowledgement is not evidence of current liveness. */
  readonly dispatchState?: "launching" | "dispatched" | "uncertain";

}

export function readDispatchEvidence(files: readonly LiveFile[]): readonly DispatchEvidence[] {
  const ordered = files.flatMap((file, rank) => file.events.map(event => ({ event, rank })))
    .sort((a, b) => Date.parse(a.event.at) - Date.parse(b.event.at) || b.rank - a.rank);
  const rows = new Map<string, DispatchEvidence>();
  for (const { event } of ordered) {
    if (event.kind !== "subagent.dispatching" && event.kind !== "subagent.dispatch") continue;
    const previous = rows.get(event.runId);
    const detail = event.detail;
    if (event.kind === "subagent.dispatching") {
      const source = detail?.["source"];
      rows.set(event.runId, { runId: event.runId, external: null,
        source: source === "claude" || source === "codex" || source === "opencode" ? source : null,
        route: projectRouteIdentity(null) });
    } else {
      if (detail?.["verdict"] === "refused") { rows.delete(event.runId); continue; }
      rows.set(event.runId, { runId: event.runId,
        external: typeof detail?.["external"] === "string" && detail["external"].length > 0
          ? detail["external"] : null,
        source: previous?.source ?? null, route: projectRouteIdentity(detail?.["route"]) });
    }
  }
  return [...rows.values()].sort((a,b) => a.runId.localeCompare(b.runId));
}
