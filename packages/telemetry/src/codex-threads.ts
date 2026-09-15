import type { CodexGoalEvent, CodexReadReason, CodexThreadObservation, CodexThreadSnapshot } from "@rickylabs/harness-contracts";
import { CodexReadConnection, CodexReadError, spawnCodexReadPort, type CodexStdioPort } from "./codex-thread-connection.js";
import { missingGoal, object, projectGoal, projectThread, publicThreadId, text } from "./codex-thread-project.js";
export interface CodexThreadReadOptions { executable?: string; port?: CodexStdioPort; limit?: number; timeoutMs?: number; includeSensitive?: boolean }
const SOURCE_KINDS = ["cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown"];
const reasonOf = (e: unknown): CodexReadReason => e instanceof CodexReadError ? e.reason : "invalid_response";
export class CodexThreadReader {
  private readonly connection: CodexReadConnection;
  private queue: CodexGoalEvent[] = [];
  private wake: (() => void) | undefined;
  private ended = false;
  private endReason: CodexReadReason = "source_closed";
  private subscribed = false;
  private reading = false;
  private sequence = 0;
  private constructor(private readonly options: Required<Pick<CodexThreadReadOptions, "limit" | "timeoutMs" | "includeSensitive">>, port: CodexStdioPort) {
    this.connection = new CodexReadConnection(port, options.timeoutMs,
      (method, params) => this.notification(method, params), reason => {
        this.ended = true; this.endReason = reason;
        if (reason === "notification_overflow") this.queue = [];
        this.queue.push({ schema: 1, type: "unavailable", reason, sequence: ++this.sequence }); this.wake?.();
      });
  }
  static async open(options: CodexThreadReadOptions = {}): Promise<CodexThreadReader> {
    const limit = options.limit ?? 500, timeoutMs = options.timeoutMs ?? 30000;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 ||
      (options.includeSensitive !== undefined && typeof options.includeSensitive !== "boolean")) throw new CodexReadError("invalid_options");
    const reader = new CodexThreadReader({ limit, timeoutMs, includeSensitive: options.includeSensitive ?? false }, options.port ?? spawnCodexReadPort(options.executable));
    try { await reader.connection.initialize(); return reader; }
    catch (e) { reader.close(); throw e; }
  }
  close(): void { this.connection.fail("source_closed"); }
  async read(): Promise<CodexThreadSnapshot> {
    const rows: CodexThreadObservation[] = [], ids = new Set<string>();
    let pages = 0;
    let coverageReason: CodexReadReason | null = null;
    const result = (complete: boolean, reason: CodexReadReason | null): CodexThreadSnapshot => ({ schema: 1, source: "codex-app-server",
      scope: "stored-all-sources-including-archived", complete, reason, observedAt: new Date().toISOString(), rows });
    if (this.reading) return result(false, "read_in_progress");
    this.reading = true;
    const timer = setTimeout(() => this.connection.fail("request_timeout"), this.options.timeoutMs);
    try {
      for (const archived of [false, true]) {
        let cursor: string | null = null;
        const cursors = new Set<string>();
        do {
          if (++pages > 202) throw new CodexReadError("scan_limit");
          const remaining = this.options.limit - rows.length;
          if (remaining <= 0) return result(false, "scan_limit");
          const pageSize = Math.min(50, remaining);
          const p = object(await this.connection.request("thread/list", { cursor, limit: pageSize, archived, modelProviders: [],
            sourceKinds: SOURCE_KINDS, useStateDbOnly: true }));
          if (!p || !Array.isArray(p.data) || p.data.length > pageSize || !(p.nextCursor === null || text(p.nextCursor))) throw new CodexReadError("invalid_response");
          for (const raw of p.data) {
            const t = object(raw);
            if (!t || !text(t.id)) throw new CodexReadError("identity_mismatch");
            if (ids.has(t.id)) throw new CodexReadError("identity_mismatch");
            ids.add(t.id);
            let goal;
            try {
              const g = object(await this.connection.request("thread/goal/get", { threadId: t.id }));
              goal = g && "goal" in g ? projectGoal(g.goal, t.id, this.options.includeSensitive) : missingGoal("invalid_response");
            } catch (e) { coverageReason ??= reasonOf(e); goal = missingGoal(reasonOf(e)); }
            if (goal.tokenBudget.reason === "identity_mismatch" || goal.tokenBudget.reason === "invalid_response") coverageReason ??= goal.tokenBudget.reason;
            rows.push(projectThread(t, goal, this.options.includeSensitive));
            if (this.ended) throw new CodexReadError(this.endReason);
          }
          cursor = p.nextCursor as string | null;
          if (cursor !== null && cursors.has(cursor)) throw new CodexReadError("invalid_response");
          if (cursor !== null) cursors.add(cursor);
        } while (cursor !== null);
      }
      return result(coverageReason === null, coverageReason);
    } catch (e) { rows.length = 0; return result(false, reasonOf(e)); }
    finally { clearTimeout(timer); this.reading = false; }
  }
  /** One consumer per reader. Buffered from initialization; no polling or durable replay claim. */
  async *events(): AsyncGenerator<CodexGoalEvent> {
    if (this.subscribed) throw new CodexReadError("subscription_in_use");
    this.subscribed = true;
    try {
      while (true) {
        if (this.queue.length) { yield this.queue.shift()!; continue; }
        if (this.ended) return;
        await new Promise<void>(resolve => { this.wake = resolve; }); this.wake = undefined;
      }
    } finally { this.close(); }
  }
  private notification(method: string, raw: unknown): void {
    const p = object(raw);
    if (!p || !text(p.threadId)) { this.connection.fail("invalid_response"); return; }
    if (method === "thread/goal/updated" && (!object(p.goal) || object(p.goal)!.threadId !== p.threadId)) {
      this.connection.fail("identity_mismatch"); return;
    }
    if (this.queue.length >= 128) { this.connection.fail("notification_overflow"); return; }
    this.queue.push({ schema: 1, sequence: ++this.sequence, type: method === "thread/goal/updated" ? "goal_updated" : "goal_cleared",
      threadId: publicThreadId(p.threadId), goal: method === "thread/goal/updated" ? projectGoal(p.goal, p.threadId, this.options.includeSensitive) : missingGoal("goal_absent") });
    this.wake?.();
  }
}
export const openCodexThreadReader = CodexThreadReader.open;
export { codexThreadEvidence } from "./codex-thread-project.js";
export type { CodexThreadSnapshot, CodexThreadObservation, CodexGoalEvent } from "@rickylabs/harness-contracts";
