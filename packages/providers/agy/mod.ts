/**
 * `@rickylabs/provider-agy`: the agy (Antigravity CLI) native transcript reader.
 *
 * agy publishes the path of its retained conversation log as `transcriptPath` in every hook payload.
 * This package reads that log, bounded and private, and returns only tool-call descriptors plus the
 * receipt a coverage decision needs (`NativeToolCallRead`, owned by `@rickylabs/harness-contracts`).
 * The native SQLite trajectory stays the authority for step existence, state and completion; it is
 * read by the telemetry producer. Per-call lifecycle is not derivable from the log and is never claimed.
 *
 * `agyNativeReads` structurally satisfies telemetry's `AgyNativeReads` port, so this package never
 * imports telemetry. This file is the package's only entry and re-exports its public API, nothing else.
 */
import { transcriptTailFile } from "./src/adapters/transcript-tail-file.js";
import { agyTranscriptPath, readAgyToolCalls } from "./src/application/read-tool-calls.js";

export { transcriptTailFile } from "./src/adapters/transcript-tail-file.js";
export { agyTranscriptPath, MAX_TRANSCRIPT_TAIL_BYTES, readAgyToolCalls } from "./src/application/read-tool-calls.js";
export type { TranscriptTail, TranscriptTailRead } from "./src/ports/transcript-tail.js";

/** The reads a telemetry composition root injects. */
export const agyNativeReads = Object.freeze({
  readToolCalls: (storeRoot: string, conversationId: string, maxBytes: number, stepCount: number) =>
    readAgyToolCalls(transcriptTailFile(), storeRoot, conversationId, maxBytes, stepCount),
  transcriptPath: agyTranscriptPath,
});
