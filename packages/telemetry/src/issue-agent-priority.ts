/** Native file clocks schedule reads only. They never supply identity, ancestry, or liveness. */
import { lstat, opendir } from "node:fs/promises";
import { join } from "node:path";
import type { DispatchEvidence, IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import type { OrchidReads } from "./host-reads.js";

const MAX_HINT_ENTRIES = 16_384;
const MAX_HINT_DIRECTORIES = 1_024;
const rollout = /^rollout-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-([0-9a-f-]{36})\.jsonl$/;

/** One bounded metadata walk per frame, shared by every receipt group. Missing hints are neutral. */
export async function readCodexActivityHints(root: string): Promise<ReadonlyMap<string, number>> {
  const hints = new Map<string, number>();
  let entries = 0, directories = 0;
  const walk = async (path: string, depth: number): Promise<void> => {
    if (++directories > MAX_HINT_DIRECTORIES || entries >= MAX_HINT_ENTRIES) return;
    try {
      if (!(await lstat(path)).isDirectory()) return;
      const dir = await opendir(path);
      for await (const entry of dir) {
        if (++entries > MAX_HINT_ENTRIES) break;
        if (entry.isDirectory() && depth < 3 && (depth === 0 ? /^\d{4}$/ : /^\d\d$/).test(entry.name)) {
          await walk(join(path, entry.name), depth + 1);
        } else if (depth === 3 && entry.isFile()) {
          const id = rollout.exec(entry.name)?.[1];
          if (id === undefined) continue;
          const stat = await lstat(join(path, entry.name)).catch(() => null);
          if (stat?.isFile()) hints.set(id, Math.max(hints.get(id) ?? -Infinity, stat.mtimeMs));
        }
        if (entries >= MAX_HINT_ENTRIES || directories > MAX_HINT_DIRECTORIES) break;
      }
    } catch { /* A hint is optional: the actual reader still validates its own native evidence. */ }
  };
  await walk(root, 0);
  return hints;
}

/** Only the host's already-verified durable native key may choose a scheduling hint. */
export function nativeActivityPriority(dispatches: readonly DispatchEvidence[], hints: ReadonlyMap<string, number>,
  host: OrchidReads): number {
  let newest = -Infinity;
  for (const [id, at] of hints) {
    if (dispatches.some(dispatch => host.matchesNativeRootIdentity(dispatch, id, "codex"))) newest = Math.max(newest, at);
  }
  return newest;
}

/** Preserve observed running forests before history at the contract's issue/agent/byte output caps. */
export function hasRunningTree(snapshot: IssueAgentTreeSnapshot): boolean {
  return snapshot.issues.some(issue => issue.dispatches.some(dispatch =>
    dispatch.agents.some(agent => agent.liveness.state === "running")));
}
