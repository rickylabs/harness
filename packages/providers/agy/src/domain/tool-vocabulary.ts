/**
 * The agy built-in tool vocabulary (measured on agy 1.3.2 transcripts and its release notes). It maps
 * a native name to a neutral kind and the one argument a publication screen may look at; any other
 * name, MCP tools included, stays unnamed.
 */
import type { NativeToolCallDescriptor } from "@rickylabs/harness-contracts";

const COMMAND_TOOLS = new Set(["run_command"]);
const FILE_TOOLS = new Set(["view_file", "write_to_file", "replace_file_content"]);
const OTHER_TOOLS = new Set(["invoke_subagent", "send_message", "manage_subagents", "define_subagent",
  "search_web", "read_url_content", "manage_task", "schedule", "generate_image"]);

/** One call as the vendor log names it; argument values stay private to the caller. */
export interface TranscriptCall {
  readonly name: string;
  readonly commandLine: string | null;
  readonly path: string | null;
}

export function describeCall(stepIndex: number, callIndex: number, call: TranscriptCall): NativeToolCallDescriptor {
  if (COMMAND_TOOLS.has(call.name)) {
    return { stepIndex, callIndex, kind: "command", toolName: call.name, commandLine: call.commandLine, path: null };
  }
  if (FILE_TOOLS.has(call.name)) {
    return { stepIndex, callIndex, kind: "file", toolName: call.name, commandLine: null, path: call.path };
  }
  return { stepIndex, callIndex, kind: "tool", toolName: OTHER_TOOLS.has(call.name) ? call.name : null,
    commandLine: null, path: null };
}
