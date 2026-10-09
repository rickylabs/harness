/** Shared harness for the `harness-telemetry` CLI tests: a temporary home, captured runs, synthetic sources. */
import { mkdir, mkdtemp, readFile, readdir, stat, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "node:test";
import { spawn as spawnChild } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main } from "./cli.js";
import { defaultSourceServices, type SourceServices } from "./governance/collect.js";
import { SPEND_URL } from "./source.js";
import { governanceDocument } from "./governance/test-fixture.js";

export let home: string;
let heldEnvironment: Record<string, string | undefined>;

/** Give every test in the calling file a fresh home and no ambient telemetry configuration. */
export function useTemporaryHome(): void {
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "harness-cli-"));
  heldEnvironment = { HOME: process.env.HOME };
  for (const key of Object.keys(process.env)) {
    if (/^(?:HARNESS|DSH)_TELEMETRY_/.test(key)) { heldEnvironment[key] = process.env[key]; delete process.env[key]; }
  }
  process.env.HOME = home;
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (/^(?:HARNESS|DSH)_TELEMETRY_/.test(key)) delete process.env[key];
  for (const [key, value] of Object.entries(heldEnvironment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
}

/** Run the CLI with stdout captured, so a test reads exactly what an operator would see. */
export async function run(argv: readonly string[], services?: SourceServices): Promise<{ code: number; out: string }> {
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await main(argv, services);
    return { code, out: written.join("") };
  } finally {
    process.stdout.write = original;
  }
}

/** Keep synthetic governance checks independent of ambient telemetry configuration. */
export async function runIsolated(argv: readonly string[]): Promise<{ code: number; out: string }> {
  const held = new Map<string, string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(?:HARNESS|DSH)_TELEMETRY_/.test(key) || value === undefined) continue;
    held.set(key, value);
    delete process.env[key];
  }
  try {
    return await run(argv);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (/^(?:HARNESS|DSH)_TELEMETRY_/.test(key)) delete process.env[key];
    }
    for (const [key, value] of held) process.env[key] = value;
  }
}

export async function seedClaude(sessionId: string, branch: string): Promise<void> {
  const dir = join(home, ".claude", "projects", "slug");
  await mkdir(dir, { recursive: true });
  const line = JSON.stringify({
    type: "assistant",
    sessionId,
    timestamp: "2026-09-04T21:00:00.000Z",
    cwd: "/repo",
    gitBranch: branch,
    effort: "medium",
    message: { role: "assistant", model: "claude-opus-5", usage: { input_tokens: 1200, output_tokens: 40 } },
  });
  await writeFile(join(dir, `${sessionId}.jsonl`), `${line}\n`);
}

/** The governance read document `--observations` reads, evaluated at the CLI tests' clock. */
export const governanceFixture = (usedPercent = 63): unknown => governanceDocument("2026-09-07T12:00:00.000Z", usedPercent);

export async function seedGovernance(name: string, value: unknown = governanceFixture()): Promise<string> {
  const path = join(home, name);
  await writeFile(path, `${JSON.stringify(value)}\n`);
  return path;
}

/** The documented flat `--items` array: one task, #39 "telemetry sink" in epic E9. */
export async function seedFlatItems(): Promise<string> {
  const items = join(home, "items.json");
  await writeFile(items, JSON.stringify([{ number: 39, title: "telemetry sink", epic: "E9", milestone: "W2", phase: null }]));
  return items;
}

export const LIVE_NOW = "2026-09-07T12:00:00.000Z";
export const USAGE_CANARY = "synthetic-usage-secret-canary";
export const SPEND_CANARY = "synthetic-spend-secret-canary";
export const PRIVATE_CANARY = "synthetic-private-project-session-path-host-canary";
export function liveDescriptor() {
  return {
    accountLabel: "synthetic", usage: { denoBin: "/fixture/deno", probe: "/fixture/probe.ts", checkout: join(home, "upstream"), model: "fixture/model",
      credentialEnv: "USAGE_API_KEY", timeoutMs: 100, maxBytes: 4096,
      windows: { rolling_five_hours: { label: "short", windowMinutes: 3 }, weekly: { label: "week", windowMinutes: 5 }, monthly: { label: "month", windowMinutes: 7 } } },
    spend: { url: SPEND_URL, credentialEnv: "SPEND_API_KEY", window: "monthly", validForMs: 60000, timeoutMs: 100, maxBytes: 4096 },
    capacity: { cgroupRoot: join(home, "cgroup"), scopeLabel: "configured-cgroup", validForMs: 60000 },
    admissions: { fromObservabilityLog: true },
  };
}
export function usagePayload(capturedAt = LIVE_NOW) {
  return { provider: "opencode_go", capturedAt, validForMs: 900000,
    percentageWindows: Object.fromEntries(["rolling_five_hours", "weekly", "monthly"].map(id => [id, { percent: 42, status: "allowed", resetsAt: "2026-09-07T13:00:00Z" }])),
    private: PRIVATE_CANARY,
  };
}
export const admissionEvent = () => ({ at: LIVE_NOW, runId: PRIVATE_CANARY, kind: "governance.admission", detail: {
  item: { number: 205 }, regime: "subscription", state: "throttle", observedAt: LIVE_NOW, validUntil: "2026-09-07T12:05:00Z",
  provenance: PRIVATE_CANARY, outcome: { accepted: false, reason: "quota-paced", detail: PRIVATE_CANARY },
} });
export function fakeServices(over: Partial<SourceServices> = {}): SourceServices {
  return { ...defaultSourceServices(), env: { USAGE_API_KEY: USAGE_CANARY, SPEND_API_KEY: SPEND_CANARY }, clock: () => LIVE_NOW,
    usage: async () => usagePayload(), fetch: async () => new Response(JSON.stringify({ data: { usage_monthly: 2, label: PRIVATE_CANARY } })),
    readText: async path => path.endsWith("memory.current") ? "1024\n" : "max\n", ...over };
}
export const emptyLog = { files: [], notes: [], degraded: false };
export async function seedLive(descriptor: unknown = liveDescriptor()): Promise<string> {
  await mkdir(join(home, "cgroup"), { recursive: true });
  await mkdir(join(home, "upstream"), { recursive: true });
  await writeFile(join(home, "upstream", "unchanged.txt"), "synthetic source dependency\n");
  await writeFile(join(home, "cgroup", "memory.current"), "1024\n");
  await writeFile(join(home, "cgroup", "memory.max"), "max\n");
  const path = join(home, "source.json");
  await writeFile(path, JSON.stringify(descriptor));
  return path;
}
export async function filesBelow(root: string): Promise<unknown> {
  const result: Record<string, unknown> = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result[entry.name] = await filesBelow(path);
    else { const info = await stat(path); result[entry.name] = [info.mtimeMs, info.size, await readFile(path, "utf8")]; }
  }
  return result;
}
/** A real process, with no inherited credentials or ambient telemetry overrides. */
export async function cliProcess(args: string[], stdin = "", program?: string): Promise<{ code: number; out: string; err: string }> {
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  return await new Promise((resolve, reject) => {
    const child = spawnChild(process.execPath, program === undefined ? [cli, ...args] : ["--input-type=module", "-e", program, ...args], {
      env: { HOME: home, PATH: process.env.PATH ?? "" }, stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", chunk => { out += String(chunk); });
    child.stderr.on("data", chunk => { err += String(chunk); });
    child.on("error", reject);
    child.on("close", code => resolve({ code: code ?? 1, out, err }));
    child.stdin.end(stdin);
  });
}
