/**
 * The agy native-read port telemetry owns (dependency inversion, as `host-reads.ts` does for Orchid).
 * `@rickylabs/provider-agy` exports `agyNativeReads`, which satisfies it structurally, so the provider
 * never imports telemetry. The shapes crossing it are owned by `@rickylabs/harness-contracts`.
 */
import type { NativeToolCallRead } from "@rickylabs/harness-contracts";

export interface AgyNativeReads {
  /** Tool-call descriptors of one verified conversation, reading at most `maxBytes`. */
  readToolCalls(storeRoot: string, conversationId: string, maxBytes: number, stepCount: number): Promise<NativeToolCallRead>;
  /** The private log path for a watch hint; never evidence and never published. */
  transcriptPath(storeRoot: string, conversationId: string): string | null;
}
