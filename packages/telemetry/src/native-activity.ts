/** Small public-safe native activity facts; raw tool input and prose never leave this reader. */
import { createHash } from "node:crypto";
import { publicActivityTarget, publicActivityText, type AgentActivityStep } from "@rickylabs/harness-contracts";

import { codeModeToolCalls, codeModePatchPaths, type CodeModeToolCall } from "./code-mode-tools.js";

type Source = AgentActivityStep["source"];
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" &&
  !Array.isArray(value) ? value as Record<string, unknown> : null;
const stamp = (value: unknown): string | null => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
};
const knownTools = new Set(["functions.exec", "exec_command", "apply_patch", "read_file", "write_file",
  "Bash", "Read", "Edit", "Write", "Glob", "Grep", "Task", "NotebookEdit", "update_plan",
  "functions.update_plan", "TodoWrite"]);
const fileTools = new Set(["read_file", "write_file", "Read", "Edit", "Write", "NotebookEdit"]);
const tool = (value: unknown): string | null => typeof value === "string" && knownTools.has(value) ? value : null;
const relativeFile = (value: unknown): string | null => typeof value === "string" && value.length <= 256 &&
  /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(value) &&
  value.split("/").every(part => part !== "." && part !== ".." &&
    publicActivityTarget("file", part) !== null) ? value : null;
const safeSubcommands: Readonly<Record<string, ReadonlySet<string>>> = {
  git: new Set(["status", "diff", "log", "show", "branch", "fetch", "commit", "push", "pull", "checkout", "merge", "worktree"]),
  pnpm: new Set(["build", "test", "lint", "typecheck"]),
  go: new Set(["test", "build", "vet"]),
  deno: new Set(["task", "test", "lint", "fmt"]),
};
const safeCommands = new Set(["git", "pnpm", "npm", "node", "go", "deno", "cargo", "python", "python3", "pytest", "ls", "cat", "grep", "rg", "sed", "find", "wc"]);
function commandHead(value: unknown): string | null {
  if (Array.isArray(value)) {
    if (value.length !== 3 || !["bash", "/bin/bash", "sh", "/bin/sh"].includes(value[0]) ||
        value[1] !== "-lc" || typeof value[2] !== "string") return null;
    value = value[2];
  }
  if (typeof value !== "string") return null;
  const words = value.trim().split(/\s+/);
  const first = words[0];
  if (!first || !safeCommands.has(first)) return null;
  const second = words[1];
  return second && safeSubcommands[first]?.has(second) ? `${first} ${second}` : first;
}
function firstSentence(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trimStart();
  const sentence = text.match(/^[^\r\n]*?[.!?](?=\s|$)/)?.[0] ?? text;
  return publicActivityText(sentence);
}
function args(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string" && value.length <= 4096) {
    try { return object(JSON.parse(value)); } catch { return null; }
  }
  return object(value);
}
const id = (source: Source, origin: string, line: number, part: number) =>
  `step_${createHash("sha256").update(`${source}\0${origin}\0${line}\0${part}`).digest("hex")}`;
function step(source: Source, origin: string, line: number, part: number, at: unknown,
  kind: AgentActivityStep["kind"], toolName: string | null, command: string | null,
  filePath: string | null, summary: string | null, target: AgentActivityStep["target"] = null): AgentActivityStep | null {
  const time = stamp(at);
  return time === null ? null : { id: id(source, origin, line, part), at: time, kind,
    toolName, commandHead: command, filePath, summary, target, source };
}
function fromTool(source: Source, origin: string, line: number, part: number, at: unknown,
  name: unknown, input: unknown): AgentActivityStep | null {
  const toolName = tool(name);
  const parsed = args(input);
  const plan = name === "update_plan" || name === "functions.update_plan" ? parsed?.["plan"]
    : name === "TodoWrite" ? parsed?.["todos"] : null;
  if (Array.isArray(plan) && plan.length <= 32) {
    const current = plan.filter(item => object(item)?.["status"] === "in_progress");
    const text = current.length === 1 ? publicActivityText(object(current[0])?.[name === "TodoWrite" ? "content" : "step"]) : null;
    if (text !== null) return step(source, origin, line, part, at, "message", toolName, null, null, text);
  }
  const command = commandHead(parsed?.["cmd"] ?? parsed?.["command"]);
  const filePath = relativeFile(parsed?.["filePath"] ?? parsed?.["file_path"] ?? parsed?.["path"]);
  const kind = command !== null ? "command" : filePath !== null ? "file" : "tool";
  const summary = command !== null ? `Ran ${command}` : filePath !== null ? "Opened a repository file"
    : toolName !== null ? `Used ${toolName}` : "Used a tool";
  const basename = toolName !== null && fileTools.has(toolName) ? filePath?.split("/").at(-1) ?? null : null;
  const search = toolName === "Grep" || toolName === "Glob"
    ? publicActivityTarget("search", parsed?.["pattern"] ?? parsed?.["query"]) : null;
  const target: AgentActivityStep["target"] = command !== null && publicActivityTarget("command", command) !== null
    ? { kind: "command", value: command }
    : search !== null ? { kind: "search", value: search }
      : basename !== null && publicActivityTarget("file", basename) !== null
        ? { kind: "file", value: basename } : null;
  return step(source, origin, line, part, at, kind, toolName, command, filePath, summary, target);
}

function fromCodeModeTool(origin: string, line: number, at: unknown, call: CodeModeToolCall): AgentActivityStep[] {
  if (call.name === "exec_command") {
    const found = fromTool("codex-rollout", origin, line, 0, at, call.name, call.input);
    return found === null ? [] : [found];
  }
  const paths = codeModePatchPaths(call.input);
  return (paths.length === 0 ? [null] : paths).flatMap(path => {
    const found = fromTool("codex-rollout", origin, line, 0, at, call.name, path === null ? null : { filePath: path });
    return found === null ? [] : [found.kind === "file" ? { ...found, summary: "Patched a repository file" } : found];
  });
}

/** Only assistant-originated Codex items become steps; never prompts, tool outputs or reasoning. */
export function codexActivity(raw: unknown, origin: string, line: number): readonly AgentActivityStep[] {
  const envelope = object(raw), payload = object(envelope?.["payload"]);
  if (envelope?.["type"] !== "response_item" || payload === null) return [];
  const at = envelope["timestamp"];
  if (payload["type"] === "custom_tool_call" && payload["name"] === "exec") {
    const calls = codeModeToolCalls(payload["input"]);
    const rows = calls.flatMap(call => fromCodeModeTool(origin, line, at, call));
    if (rows.length > 0 && rows.length <= 20) {
      return rows.map((row, part) => ({ ...row, id: id("codex-rollout", origin, line, part) }));
    }
    // Unknown syntax or an exceeded bound cannot borrow legacy JSON argument evidence.
    const generic = fromTool("codex-rollout", origin, line, 0, at, payload["name"], null);
    return generic === null ? [] : [generic];
  }
  if (payload["type"] === "function_call" || payload["type"] === "custom_tool_call") {
    const found = fromTool("codex-rollout", origin, line, 0, at, payload["name"], payload["arguments"] ?? payload["input"]);
    return found === null ? [] : [found];
  }
  if (payload["type"] !== "message" || payload["role"] !== "assistant" || !Array.isArray(payload["content"])) return [];
  return payload["content"].flatMap((part, i) => {
    const content = object(part);
    if (content?.["type"] !== "output_text") return [];
    const found = step("codex-rollout", origin, line, i, at, "message", null, null, null,
      firstSentence(content["text"]) ?? "Agent message");
    return found === null ? [] : [found];
  });
}

/** Claude assistant text and tool-use blocks only; user text and tool results are excluded. */
export function claudeActivity(raw: unknown, origin: string, line: number): readonly AgentActivityStep[] {
  const envelope = object(raw), message = object(envelope?.["message"]);
  if (envelope?.["type"] !== "assistant" || message === null || !Array.isArray(message["content"])) return [];
  return message["content"].flatMap((part, i) => {
    const content = object(part);
    if (content?.["type"] === "tool_use") {
      const found = fromTool("claude-transcript", origin, line, i, envelope["timestamp"], content["name"], content["input"]);
      return found === null ? [] : [found];
    }
    if (content?.["type"] !== "text") return [];
    const found = step("claude-transcript", origin, line, i, envelope["timestamp"], "message", null, null, null,
      firstSentence(content["text"]) ?? "Agent message");
    return found === null ? [] : [found];
  });
}

/** Keep only the latest bounded records, newest first, with stable IDs across rescans. */
export function recentActivity(rows: readonly AgentActivityStep[]): readonly AgentActivityStep[] {
  const unique = new Map(rows.map(row => [row.id, row]));
  return [...unique.values()].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).slice(0, 20);
}
