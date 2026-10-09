/**
 * The normalized provider-limit snapshot file: one absolute, canonical, same-UID 0600 regular file, never a
 * link, read whole under the contract's byte bound and unchanged across the read. This adapter never opens
 * credentials or provider APIs; `application/provider-limits.ts` decodes the text. Every refusal is the same
 * fixed error, so no path or environment detail leaves it.
 */
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { MAX_PROVIDER_LIMIT_SOURCE_BYTES, type ProviderLimitSnapshotV1 } from "@rickylabs/harness-contracts";
import { decodeProviderLimits } from "../application/provider-limits.js";

export async function readProviderLimitsFile(path: string): Promise<ProviderLimitSnapshotV1> {
  const invalid = () => new Error("provider limits unavailable");
  try {
    if (!isAbsolute(path) || await realpath(path) !== path) throw invalid();
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat();
      if (!before.isFile() || before.uid !== process.getuid?.() || (before.mode & 0o7777) !== 0o600 || before.size > MAX_PROVIDER_LIMIT_SOURCE_BYTES) throw invalid();
      const bytes = Buffer.alloc(before.size + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      const after = await file.stat(), bound = await lstat(path);
      if (bytesRead !== before.size || before.dev !== bound.dev || before.ino !== bound.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs || before.mode !== after.mode || before.uid !== after.uid) throw invalid();
      const snapshot = decodeProviderLimits(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytesRead)), Date.now());
      if (snapshot === null) throw invalid();
      return snapshot;
    } finally { await file.close(); }
  } catch { throw invalid(); }
}
