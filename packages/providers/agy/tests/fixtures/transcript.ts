/** Synthetic agy 1.3.2-shaped transcript lines. Every argument value is a private canary. */
export const CANARY = "PRIVATE-ARGUMENT-CANARY";

export interface CallSpec { readonly name: string; readonly args?: unknown }
export const planner = (stepIndex: number, calls: readonly CallSpec[] = [], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ step_index: stepIndex, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE",
    created_at: "2026-10-09T10:00:00Z", tool_calls: calls.map(call => ({ name: call.name, args: call.args ?? {} })), ...extra });
export const result = (stepIndex: number, status = "DONE") => JSON.stringify({ step_index: stepIndex, source: "MODEL",
  type: "GENERIC", status, created_at: "2026-10-09T10:00:01Z", content: CANARY });
export const user = (stepIndex: number) => JSON.stringify({ step_index: stepIndex, source: "USER_EXPLICIT",
  type: "USER_INPUT", status: "DONE", created_at: "2026-10-09T09:59:59Z", content: CANARY });
export const runCommand = (line = `git status ${CANARY}`): CallSpec => ({ name: "run_command", args: { CommandLine: line, Cwd: CANARY } });
export const viewFile = (path: string): CallSpec => ({ name: "view_file", args: { AbsolutePath: path } });
export const mcpTool: CallSpec = { name: "github_create_issue", args: { title: CANARY } };
export const jsonl = (...lines: string[]) => lines.map(line => line + "\n").join("");
