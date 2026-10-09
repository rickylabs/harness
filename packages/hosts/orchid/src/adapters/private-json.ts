/** One bounded, owner-only, no-symlink JSON object read from Orchid's private receipt root. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { object } from "../domain/receipt-shape.js";

export async function readPrivateJSON(path: string, limit = 16_384): Promise<Record<string, unknown> | null> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.size < 2 || stat.size > limit) return null;
    const bytes = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    return bytesRead === stat.size ? object(JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"))) : null;
  } finally { await file.close(); }
}
