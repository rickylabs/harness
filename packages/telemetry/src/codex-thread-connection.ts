/** Read-only app-server JSONL transport. Raw protocol values never become diagnostics. */
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { CodexReadReason } from "@rickylabs/harness-contracts";
import { object, text } from "./codex-thread-project.js";
export interface CodexStdioPort { input: Writable; output: Readable; close(): void }
export class CodexReadError extends Error {
  constructor(readonly reason: CodexReadReason) { super(reason); this.name = "CodexReadError"; }
}
export function spawnCodexReadPort(executable = "codex"): CodexStdioPort {
  const child = spawn(executable, ["app-server"], { stdio: ["pipe", "pipe", "ignore"], shell: false });
  child.on("error", () => child.stdout.destroy(new CodexReadError("source_unavailable")));
  child.on("close", () => child.stdout.destroy());
  return { input: child.stdin, output: child.stdout, close() { child.stdin.end(); child.kill("SIGTERM"); } };
}
export class CodexReadConnection {
  private buffer = Buffer.alloc(0);
  private serial = 0;
  private ended = false;
  private ready = false;
  private readonly pending = new Map<number, { resolve(v: unknown): void; reject(e: CodexReadError): void; goalThreadId: unknown; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly port: CodexStdioPort, private readonly timeoutMs: number,
    private readonly notify: (method: string, params: unknown) => void, private readonly endedWith: (reason: CodexReadReason) => void) {
    port.output.on("data", (chunk: Buffer) => this.receive(Buffer.from(chunk)));
    port.output.on("end", () => this.fail("source_closed"));
    port.output.on("close", () => this.fail("source_closed"));
    port.output.on("error", () => this.fail("source_unavailable"));
    port.input.on("error", () => this.fail("source_unavailable"));
  }
  async initialize(): Promise<void> {
    const reply = await this.request("initialize", { clientInfo: { name: "harness_telemetry", version: "0.1.0" }, capabilities: { experimentalApi: true } });
    if (!text(object(reply)?.userAgent)) { this.fail("invalid_response"); throw new CodexReadError("invalid_response"); }
    this.port.input.write(JSON.stringify({ method: "initialized" }) + "\n");
    this.ready = true;
  }
  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!["initialize", "thread/list", "thread/goal/get"].includes(method)) return Promise.reject(new CodexReadError("read_only_violation"));
    if (this.ended) return Promise.reject(new CodexReadError("source_closed"));
    if ((method !== "initialize" && !this.ready) || (method === "initialize" && this.serial !== 0)) return Promise.reject(new CodexReadError("read_only_violation"));
    if (this.pending.size >= 8) return Promise.reject(new CodexReadError("scan_limit"));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail("request_timeout"), this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, goalThreadId: method === "thread/goal/get" ? params.threadId : undefined });
      try { this.port.input.write(JSON.stringify({ id, method, params }) + "\n"); }
      catch { this.fail("source_unavailable"); }
    });
  }
  fail(reason: CodexReadReason): void {
    if (this.ended) return;
    this.ended = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new CodexReadError(reason)); }
    this.pending.clear(); this.buffer = Buffer.alloc(0);
    this.endedWith(reason); this.port.close();
  }
  private receive(chunk: Buffer): void {
    if (this.ended) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let newline: number;
    while ((newline = this.buffer.indexOf(10)) >= 0) {
      if (newline > 1048576) { this.fail("oversized_frame"); return; }
      const line = this.buffer.subarray(0, newline).toString("utf8");
      this.buffer = this.buffer.subarray(newline + 1);
      let raw: unknown;
      try { raw = JSON.parse(line); } catch { this.fail("invalid_response"); return; }
      const m = object(raw);
      if (!m) { this.fail("invalid_response"); return; }
      if ("id" in m) {
        if ("method" in m) { this.fail("read_only_violation"); return; }
        const p = this.pending.get(m.id as number);
        if (!p) { this.fail("response_mismatch"); return; }
        if (("result" in m) === ("error" in m)) { this.fail("invalid_response"); return; }
        this.pending.delete(m.id as number); clearTimeout(p.timer);
        if ("error" in m) {
          const error = object(m.error);
          // Exact daemon refusal, bound to this goal request. Never export the echoed native identity.
          const reason = typeof p.goalThreadId === "string" && error?.code === -32600 &&
            error.message === `thread not found: ${p.goalThreadId}` ? "thread_not_found" : "rpc_error";
          p.reject(new CodexReadError(reason));
        } else p.resolve(m.result);
      } else if (typeof m.method === "string") {
        if (m.method === "thread/goal/updated" || m.method === "thread/goal/cleared") this.notify(m.method, m.params);
      } else { this.fail("invalid_response"); return; }
    }
    if (this.buffer.length > 1048576) this.fail("oversized_frame");
  }
}
