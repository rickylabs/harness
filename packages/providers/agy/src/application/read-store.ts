/** One bound agy store read into neutral conversation snapshots (`AgyStoreRead`, owned by contracts). */
import type { AgyConversationSnapshot, AgyStoreRead } from "@rickylabs/harness-contracts";
import { decodeAgyConversation } from "../domain/trajectory.js";
import type { StoreSource } from "../ports/store-source.js";
import { agyWorkspaceRoot } from "./workspace-root.js";

export async function readAgyStore(source: StoreSource, root: string, matches: (id: string) => boolean, limit: number,
  maxBytes: number, nowMs: number): Promise<AgyStoreRead> {
  return source.scan<AgyConversationSnapshot>(root, matches, limit, maxBytes, (summary, rows, origin) =>
    decodeAgyConversation(summary, rows, origin, nowMs, agyWorkspaceRoot(summary["workspace_uris"])));
}
