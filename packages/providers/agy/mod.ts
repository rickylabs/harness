/**
 * `@rickylabs/provider-agy`: every read of agy's (Antigravity CLI) retained native store.
 *
 * - The SQLite trajectory, the authority for step existence, time, status and completion, decoded into
 *   neutral `AgyStoreRead` snapshots. Native codes are interpreted here and nowhere else.
 * - The conversation log agy's hooks publish as `transcriptPath`, read for tool-call descriptors and
 *   the receipt a coverage decision needs (`NativeToolCallRead`). Per-call lifecycle is not derivable
 *   from the log and is never claimed.
 *
 * Both shapes are owned by `@rickylabs/harness-contracts`; telemetry applies the completion rules.
 *
 * `agyNativeReads` structurally satisfies telemetry's `AgyNativeReads` port, so this package never
 * imports telemetry. This file is the package's only entry and re-exports its public API, nothing else.
 */
import { transcriptTailFile } from "./src/adapters/transcript-tail-file.js";
import { agyTranscriptPath, readAgyToolCalls } from "./src/application/read-tool-calls.js";
import { sqliteStore } from "./src/adapters/sqlite-store.js";
import { readAgyStore } from "./src/application/read-store.js";

export { transcriptTailFile } from "./src/adapters/transcript-tail-file.js";
export { agyTranscriptPath, MAX_TRANSCRIPT_TAIL_BYTES, readAgyToolCalls } from "./src/application/read-tool-calls.js";
export type { TranscriptTail, TranscriptTailRead } from "./src/ports/transcript-tail.js";
export { MAX_WORKSPACE_URIS_BYTES, sqliteStore } from "./src/adapters/sqlite-store.js";
export { readAgyStore } from "./src/application/read-store.js";
export { agyWorkspaceRoot } from "./src/application/workspace-root.js";
export { decodeAgyConversation } from "./src/domain/trajectory.js";
export type { DecodeConversation, StoreScan, StoreSource } from "./src/ports/store-source.js";

/** The reads a telemetry composition root injects. */
export const agyNativeReads = Object.freeze({
  readStore: (root: string, matches: (id: string) => boolean, limit: number, maxBytes: number, nowMs: number) =>
    readAgyStore(sqliteStore(), root, matches, limit, maxBytes, nowMs),
  readToolCalls: (storeRoot: string, conversationId: string, maxBytes: number, stepCount: number) =>
    readAgyToolCalls(transcriptTailFile(), storeRoot, conversationId, maxBytes, stepCount),
  transcriptPath: agyTranscriptPath,
});
