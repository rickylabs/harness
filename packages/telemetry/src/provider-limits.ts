/** Read only a normalized same-UID snapshot; this reader never opens credentials or provider APIs. */
import { constants } from "node:fs";
import { open, lstat, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { MAX_PROVIDER_LIMIT_SOURCE_BYTES, readProviderLimitSnapshot, type ProviderLimitSnapshotV1 } from "@rickylabs/harness-contracts";
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
    if (bytesRead !== before.size || before.dev !== bound.dev || before.ino !== bound.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.mode !== after.mode || before.uid !== after.uid) throw invalid();
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytesRead));
    const decoded = readProviderLimitSnapshot(JSON.parse(raw) as unknown);
    if (!decoded.ok || Date.parse(decoded.snapshot.generatedAt) > Date.now()) throw invalid();
    return decoded.snapshot;
  } finally { await file.close(); }
  } catch { throw invalid(); }
}
