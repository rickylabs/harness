/** Live governance collection: the injected services and the bounded readers behind `--observations-from`. */
import { open } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RegimeStatus } from "@rickylabs/harness-contracts";
import type { LiveLog } from "../live.js";
import { SourceError, type GovernanceSource, type UsageSource, type Leg } from "../source.js";
import { mapUsage } from "./usage.js";
import { mapSpend } from "./spend.js";
import { mapCapacity } from "./capacity.js";
import { composeGovernance, type ComposedGovernance } from "./compose.js";
import { mapTransportAvailability, readTransportAvailabilityFile } from "./transport-availability.js";

/** Service injection keeps offline tests independent of Deno, credentials and networking. */
export interface UsageCommand {
  readonly bin: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}
export interface SourceServices {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly clock: () => string;
  readonly usage: (command: UsageCommand) => Promise<unknown>;
  readonly fetch: typeof fetch;
  readonly readText: (path: string, maxBytes: number) => Promise<string>;
  /** The private transport availability snapshot; defaults to the owner-only file reader. */
  readonly readPrivateText?: (path: string) => Promise<string>;
}
export function usageCommand(source: UsageSource, credential: string): UsageCommand {
  const imports = {
    "harness:usage": pathToFileURL(join(source.checkout, ".llm/tools/agentic/runtime/provider-usage.ts")).href,
    "harness:usage-validity": pathToFileURL(join(source.checkout, ".llm/tools/agentic/config/subscriptions.ts")).href,
  };
  return { bin: source.denoBin, args: ["run", "--no-config", "--no-lock", "--no-prompt", "--no-remote", "--no-code-cache",
    `--import-map=data:application/json,${encodeURIComponent(JSON.stringify({ imports }))}`,
    `--allow-env=${source.credentialEnv}`, "--allow-net=opencode.ai", source.probe,
    source.model, source.credentialEnv, String(source.maxBytes), String(source.timeoutMs)],
    env: { [source.credentialEnv]: credential, DENO_NO_UPDATE_CHECK: "1", DENO_DIR: "/dev/null" },
    timeoutMs: source.timeoutMs, maxBytes: source.maxBytes };
}

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
export function defaultSourceServices(): SourceServices {
  return { env: process.env, clock: () => new Date().toISOString(), usage: runUsageProbe, fetch: globalThis.fetch, readText: readSourceText };
}
async function readResponse(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.ok || response.body === null) throw new SourceError("request-failed");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new SourceError("oversize");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new SourceError("non-json"); }
}
async function isolatedLeg<T = RegimeStatus>(read: () => Promise<Leg<T>>, fallback: "request-failed" | "cgroup-unreadable" | "file-unreadable"): Promise<Leg<T>> {
  try { return await read(); }
  catch (error) { return { ok: false, code: error instanceof SourceError ? error.code : fallback }; }
}
export async function collectGovernance(source: GovernanceSource, log: LiveLog, services: SourceServices, now?: string): Promise<{ observed: ComposedGovernance; completion: string }> {
  const missing: Leg<RegimeStatus> = { ok: false, code: "not-configured" };
  const [usage, spend, capacity] = await Promise.all([
    isolatedLeg(async () => {
      if (source.usage === null) return missing;
      const credential = services.env[source.usage.credentialEnv]?.trim();
      if (!credential) return { ok: false, code: "credential-unbound" };
      return mapUsage(await services.usage(usageCommand(source.usage, credential)), source.usage, source.accountLabel);
    }, "request-failed"),
    isolatedLeg(async () => {
      if (source.spend === null) return missing;
      const config = source.spend;
      const credential = services.env[config.credentialEnv]?.trim();
      if (!credential) return { ok: false, code: "credential-unbound" };
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new SourceError("timeout")); }, config.timeoutMs);
      });
      try {
        const read = async (): Promise<unknown> => readResponse(await services.fetch(config.url, {
          headers: { accept: "application/json", authorization: `Bearer ${credential}` }, redirect: "error", signal: controller.signal,
        }), config.maxBytes);
        const payload = await Promise.race([read(), timeout]);
        return mapSpend(payload, config, services.clock());
      } finally { clearTimeout(timer); controller.abort(); }
    }, "request-failed"),
    isolatedLeg(async () => {
      if (source.capacity === null) return missing;
      const config = source.capacity;
      const [current, max] = await Promise.all([
        services.readText(join(config.cgroupRoot, "memory.current"), 128),
        services.readText(join(config.cgroupRoot, "memory.max"), 128),
      ]);
      return mapCapacity(current, max, config, services.clock());
    }, "cgroup-unreadable"),
  ]);
  const transportAvailability = source.transportAvailability
    ? await isolatedLeg(async () => mapTransportAvailability(await (services.readPrivateText ?? readTransportAvailabilityFile)(source.transportAvailability!.path)), "file-unreadable")
    : undefined;
  const completion = services.clock();
  return { observed: composeGovernance(source, { usage, spend, capacity, events: log.files.flatMap(file => file.events), logDegraded: log.degraded,
    ...(transportAvailability === undefined ? {} : { transportAvailability }) }, completion, now ?? completion), completion };
}
