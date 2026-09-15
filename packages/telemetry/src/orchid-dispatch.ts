/** Read the dispatcher's existing private matrix reservations; no collection or native-session guesses. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { compareRouteIdentity, projectRouteIdentity } from "@rickylabs/subagents";
import type { DispatchEvidence } from "./dispatch-evidence.js";

export const ORCHID_DISPATCH_ROOT = "DSH_TELEMETRY_DISPATCH_ROOT";
export type OrchidDispatchUnavailableReason =
  | "missing"
  | "not_directory"
  | "wrong_mode"
  | "relative_path"
  | "symlink"
  | "git_ancestor";
const hash = /^[a-f0-9]{64}$/;
const label = (value: unknown): value is string => typeof value === "string" &&
  value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export interface OrchidDispatchRead {
  readonly root: string | undefined;
  readonly reason: OrchidDispatchUnavailableReason | null;
  readonly dispatches: readonly DispatchEvidence[];
  readonly notes: readonly string[];
  readonly degraded: boolean;
}

/** Root diagnostics echo only the configured root, never a descriptor path, native identity, or raw receipt. */
export async function readOrchidDispatches(root: string | undefined): Promise<OrchidDispatchRead> {
  if (root === undefined) return { root, reason: null, dispatches: [], notes: [], degraded: false };
  const dispatches: DispatchEvidence[] = [];
  const notes = new Set<string>();
  let reason: OrchidDispatchUnavailableReason | null = null;
  try {
    if (!isAbsolute(root)) reason = "relative_path";
    if (reason !== null) throw new Error();
    let rootStat;
    try { rootStat = await lstat(root); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") reason = "missing";
      throw error;
    }
    if (rootStat.isSymbolicLink()) reason = "symlink";
    else if (!rootStat.isDirectory()) reason = "not_directory";
    else if ((rootStat.mode & 0o7777) !== 0o700) reason = "wrong_mode";
    else if (await realpath(root) !== resolve(root)) reason = "symlink";
    if (reason !== null) throw new Error();
    // The writer also refuses roots within a Git checkout. Recheck at the read boundary.
    for (let dir = root;; dir = dirname(dir)) {
      try { await lstat(join(dir, ".git")); reason = "git_ancestor"; throw new Error("tracked"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (dirname(dir) === dir) break;
    }
    const entries = (await readdir(root)).filter(name => hash.test(name)).sort();
    if (entries.length > 1000) notes.add("orchid-dispatch: scan_limit");
    for (const key of entries.slice(0, 1000)) {
      try {
        const record = join(root, key, "record");
        for (const dir of [join(root, key), record]) {
          const stat = await lstat(dir);
          if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error();
        }
        let file;
        try { file = await open(join(record, "dispatch.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
        catch (error) {
          // A reservation predating this hook has no dispatch binding, not an inferred one.
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        let input: Record<string, unknown> | null;
        let revision: string;
        let sourceModifiedAt: string;
        try {
          const stat = await file.stat();
          sourceModifiedAt = stat.mtime.toISOString();
          if (!stat.isFile() || stat.size > 16_384 || (stat.mode & 0o077) !== 0) throw new Error();
          const bytes = Buffer.alloc(16_385);
          const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
          if (bytesRead > 16_384) throw new Error();
          const raw = bytes.subarray(0, bytesRead);
          revision = createHash("sha256").update(raw).digest("hex");
          input = object(JSON.parse(raw.toString("utf8")));
        } finally { await file.close(); }
        if (input === null || input.schemaVersion !== 1 || input.runId !== "orchid-" + key) throw new Error();
        const issue = object(input.issue);
        if (issue === null || typeof issue.repo !== "string" || issue.repo.length > 256 ||
            !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(issue.repo) ||
            !Number.isSafeInteger(issue.number) || (issue.number as number) < 1 || input.parentRunId !== null) throw new Error();
        // Top-level inbox dispatches have no spawning agent. Native children are linked by the existing readers.
        if (input.state === "reserved" && input.location === null) continue;
        if (!["launching", "dispatched", "uncertain"].includes(input.state as string)) throw new Error();
        const location = object(input.location);
        if (location === null || !label(location.paneId) || !label(location.workspaceId)) throw new Error();
        if (!label(input.provider) || typeof input.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(input.model) || input.model.includes("..") || !label(input.effort) || !["codex", "claude", "agy"].includes(input.source as string)) throw new Error();
        // Transport is not router. No native session or observed route can be established from a pane id.
        const route = projectRouteIdentity(compareRouteIdentity(
          { provider: input.provider, model: input.model, effort: input.effort, cwd: null },
          { provider: null, model: null, effort: null, cwd: null },
        ));
        const timestamp = input.observedAt ?? sourceModifiedAt;
        const at = typeof timestamp === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(timestamp) &&
          Number.isFinite(Date.parse(timestamp)) && new Date(timestamp).toISOString() === timestamp ? timestamp : undefined;
        if (at === undefined) throw new Error();
        dispatches.push({ observedAt: at, revision, linkageBasis: "dispatcher-confirmed", runId: input.runId as string, external: null,
          source: input.source === "codex" || input.source === "claude" ? input.source : null,
          route, issue: { repo: issue.repo, number: issue.number as number }, parentRunId: null,
          location: { paneId: location.paneId, workspaceId: location.workspaceId },
          dispatchState: input.state as "launching" | "dispatched" | "uncertain" });
      } catch { notes.add("orchid-dispatch: binding_unavailable"); }
    }
  } catch { notes.add("orchid-dispatch: source_unavailable"); }
  return { root, reason, dispatches, notes: [...notes], degraded: notes.size > 0 };
}

/** Associate only an existing explicit DispatchResult reference, never cwd, title or issue prose. */
export function bindOrchidDispatchEvidence(
  dispatches: readonly DispatchEvidence[], evidence: readonly DispatchEvidence[],
): { readonly dispatches: readonly DispatchEvidence[]; readonly degraded: boolean } {
  let degraded = false;
  const rows = dispatches.map(dispatch => {
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
