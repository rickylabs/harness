/** The Node source services behind `--observations-from`: bounded file reads, the usage probe subprocess and global fetch. */
import { open } from "node:fs/promises";
import { spawn } from "node:child_process";
import { SourceError } from "../domain/source.js";
import type { SourceServices, UsageCommand } from "../ports/source.js";
import { readTransportAvailabilityFile } from "./transport-availability.js";

/** Bounded regular-file reads; no symlink traversal restrictions are implied by operator config. */
export async function readSourceText(path: string, maxBytes: number): Promise<string> {
  const file = await open(path, "r");
  try {
    if (!(await file.stat()).isFile()) throw new SourceError("shape-mismatch");
    const chunks: Buffer[] = [];
    let size = 0;
    for (;;) {
      const buffer = Buffer.alloc(Math.min(65_536, maxBytes + 1 - size));
      const { bytesRead } = await file.read(buffer);
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > maxBytes) throw new SourceError("oversize");
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await file.close(); }
}
export async function runUsageProbe(command: UsageCommand): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command.bin, [...command.args], { env: { ...command.env }, stdio: ["ignore", "pipe", "ignore"], shell: false });
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: SourceError | null = null;
    const fail = (code: "timeout" | "oversize"): void => {
      failure ??= new SourceError(code);
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => fail("timeout"), command.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > command.maxBytes) fail("oversize");
      else if (failure === null) chunks.push(chunk);
    });
    child.on("error", () => { clearTimeout(timer); reject(new SourceError("spawn-failed")); });
    child.on("close", code => {
      clearTimeout(timer);
      if (failure !== null) { reject(failure); return; }
      if (code !== 0) { reject(new SourceError("spawn-failed")); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown); }
      catch { reject(new SourceError("non-json")); }
    });
  });
}
/** The Node implementation of every source service. */
export function defaultSourceServices(): SourceServices {
  return { env: process.env, clock: () => new Date().toISOString(), usage: runUsageProbe, fetch: globalThis.fetch, readText: readSourceText,
    readPrivateText: readTransportAvailabilityFile };
}
