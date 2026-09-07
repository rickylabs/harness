/** Owned test children and per-test temporary directories, following coordinator's crash harness. */
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
export interface TestChild {
  readonly process: ChildProcess;
  wait(event: string): Promise<Record<string, unknown>>;
  kill(): Promise<void>;
}
export async function withDriverDirectory<T>(fn: (directory: string, spawn: (module: URL, ...args: string[]) => TestChild) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "harness-driver-"));
  const children: TestChild[] = [];
  const spawn = (module: URL, ...args: string[]): TestChild => {
    const child = fork(module, [directory, ...args], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let stderr = "";
    child.stderr?.on("data", chunk => { stderr += String(chunk); });
    const messages: Record<string, unknown>[] = [];
    const listeners = new Set<() => void>();
    let ended = false;
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
      child.once("exit", (code, signal) => { ended = true; resolve({ code, signal }); for (const f of listeners) f(); });
    });
    child.on("message", message => { messages.push(message as Record<string, unknown>); for (const f of listeners) f(); });
    const handle: TestChild = {
      process: child,
      wait(event) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`child did not reach ${event}: ${stderr}`)); }, 15_000);
          function check() {
            const message = messages.find(m => m.event === event);
            if (message || ended) {
              clearTimeout(timer); listeners.delete(check);
              if (message) resolve(message); else reject(new Error(`child exited before ${event}: ${stderr}`));
            }
          }
          listeners.add(check); check();
        });
      },
      async kill() {
        if (!ended) assert.equal(child.kill("SIGKILL"), true);
        const result = await exited;
        assert.equal(result.signal, "SIGKILL", `unexpected child exit: ${result.code}: ${stderr}`);
      },
    };
    children.push(handle); return handle;
  };
  try { return await fn(directory, spawn); }
  finally {
    try { await Promise.all(children.map(child => child.kill())); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
}
