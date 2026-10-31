/** Read receipt pages before choosing native work; the wire observation cap is not a scan cap. */
import type { OrchidDispatchRead } from "@rickylabs/harness-contracts";
import type { OrchidReads } from "./host-reads.js";

/** At most four bounded host pages per frame; an exhausted traversal is explicitly partial. */
export const MAX_DISPATCH_PAGES_PER_FRAME = 4;

export async function readIssueAgentDispatches(host: OrchidReads, root: string): Promise<OrchidDispatchRead> {
  const first = await host.readDispatches(root, {});
  const dispatches = [...first.dispatches], launchStates = [...first.launchStates];
  const notes = new Set(first.notes);
  let reason = first.reason, after = first.nextCursor;
  for (let page = 1; after && page < MAX_DISPATCH_PAGES_PER_FRAME; page++) {
    const read = await host.readDispatches(root, { after });
    dispatches.push(...read.dispatches); launchStates.push(...read.launchStates);
    read.notes.forEach(note => notes.add(note));
    reason ??= read.reason;
    if (read.nextCursor !== null && read.nextCursor !== undefined && read.nextCursor <= after) {
      notes.add("orchid-dispatch: scan_limit"); break;
    }
    after = read.nextCursor;
  }
  if (after) notes.add("orchid-dispatch: scan_limit");
  return { root, reason, dispatches, launchStates, notes: [...notes], degraded: notes.size > 0 || reason !== null };
}
