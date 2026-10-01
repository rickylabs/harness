/** Bounded syntax facts from an exec wrapper. Parsing never executes the supplied JavaScript. */
import { parse } from "acorn";

type Node = Record<string, unknown> & { type: string; start: number };
export interface CodeModeToolCall {
  readonly name: "exec_command" | "apply_patch";
  readonly input: Record<string, unknown> | string | null;
}
const MAX_INPUT = 65_536, MAX_TOKENS = 8192, MAX_DEPTH = 64, MAX_NODES = 8192, MAX_CALLS = 20;
const node = (value: unknown): Node | null => value !== null && typeof value === "object" &&
  !Array.isArray(value) && typeof (value as Record<string, unknown>)["type"] === "string" ? value as Node : null;
const named = (value: unknown, name: string): boolean => node(value)?.type === "Identifier" && node(value)?.["name"] === name;
function children(value: Node): Node[] {
  return Object.values(value).flatMap(part => Array.isArray(part)
    ? part.flatMap(value => { const child = node(value); return child === null ? [] : [child]; })
    : node(part) === null ? [] : [node(part)!]);
}
function bindsTools(value: unknown): boolean {
  const stack = [node(value)];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (named(current, "tools")) return true;
    stack.push(...children(current));
  }
  return false;
}
function staticString(value: unknown): string | null {
  const current = node(value);
  if (current?.type === "Literal" && typeof current["value"] === "string") return current["value"];
  if (current?.type === "TemplateLiteral" && Array.isArray(current["expressions"]) && current["expressions"].length === 0 &&
      Array.isArray(current["quasis"]) && current["quasis"].length === 1) {
    const cooked = node(current["quasis"][0])?.["value"] as { cooked?: unknown } | undefined;
    return typeof cooked?.cooked === "string" ? cooked.cooked : null;
  }
  return null;
}
function staticCommand(value: unknown): string | readonly string[] | null {
  const text = staticString(value);
  if (text !== null) return text.length <= 4096 ? text : null;
  const current = node(value);
  if (current?.type !== "ArrayExpression" || !Array.isArray(current["elements"]) || current["elements"].length !== 3) return null;
  const parts = current["elements"].map(staticString);
  return parts.every((part): part is string => part !== null && part.length <= 4096) ? parts : null;
}
function commandArgs(value: unknown): Record<string, unknown> | null {
  const current = node(value);
  if (current?.type !== "ObjectExpression" || !Array.isArray(current["properties"]) || current["properties"].length > 32) return null;
  const result: Record<string, unknown> = {};
  const keys = new Set<string>();
  for (const raw of current["properties"]) {
    const property = node(raw), key = node(property?.["key"]);
    if (property?.type !== "Property" || property["kind"] !== "init" || property["computed"] ||
        property["method"] || property["shorthand"]) return null;
    const name = key?.type === "Identifier" ? key["name"] : staticString(key);
    if (typeof name !== "string" || keys.has(name)) return null;
    keys.add(name);
    if (name === "cmd" || name === "command") result[name] = staticCommand(property["value"]);
  }
  return result;
}
const deferredOrConditional = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression",
  "ClassDeclaration", "ClassExpression", "IfStatement", "SwitchStatement", "ForStatement", "ForInStatement",
  "ForOfStatement", "WhileStatement", "DoWhileStatement", "ConditionalExpression", "LogicalExpression",
  "ChainExpression", "TryStatement"]);

/** Exact tools calls with literal input only; unsupported, ambiguous or oversized code stays generic. */
export function codeModeToolCalls(input: unknown): readonly CodeModeToolCall[] {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_INPUT || Buffer.byteLength(input) > MAX_INPUT) return [];
  try {
    let tokens = 0, nesting = 0;
    const parsed = node(parse(input, { ecmaVersion: "latest", sourceType: "module", onToken(token) {
      if (++tokens > MAX_TOKENS) throw Error();
      const label = token.type.label;
      if (["(", "[", "{", "${"].includes(label) && ++nesting > MAX_DEPTH) throw Error();
      if ([")", "]", "}"].includes(label)) nesting--;
    } }));
    if (parsed === null) return [];
    // Refuse any lexical rebinding or assignment of the host tools namespace, even in deferred code.
    const scan: { value: Node; parent: Node | null }[] = [{ value: parsed, parent: null }]; let visited = 0;
    while (scan.length > 0) {
      const { value: current, parent } = scan.pop()!;
      if (++visited > MAX_NODES) return [];
      // tools may be a direct member receiver only; aliases/reflection/container escapes are ambiguous.
      if (named(current, "tools") && !(parent?.type === "MemberExpression" && parent["object"] === current)) return [];
      if (((current.type === "AssignmentExpression" || current.type === "UpdateExpression") &&
            bindsTools(current["left"] ?? current["argument"])) ||
          (current.type === "UnaryExpression" && current["operator"] === "delete" && bindsTools(current["argument"]))) return [];
      scan.push(...children(current).map(value => ({ value, parent: current })));
    }
    const calls: { start: number; call: CodeModeToolCall }[] = [], stack = [parsed];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (deferredOrConditional.has(current.type)) continue;
      const callee = node(current["callee"]), property = node(callee?.["property"]);
      if (current.type === "CallExpression" && !current["optional"] && callee?.type === "MemberExpression" &&
          !callee["computed"] && !callee["optional"] && named(callee["object"], "tools") && property?.type === "Identifier" &&
          (property["name"] === "exec_command" || property["name"] === "apply_patch")) {
        const args = current["arguments"];
        const argument = Array.isArray(args) && args.length === 1 ? args[0] : null;
        calls.push({ start: current.start, call: { name: property["name"], input: property["name"] === "exec_command"
          ? commandArgs(argument) : staticString(argument) } });
        if (calls.length > MAX_CALLS) return [];
      }
      stack.push(...children(current));
    }
    return calls.sort((a, b) => a.start - b.start).map(row => row.call);
  } catch { return []; } // Syntax/limit diagnostics contain private input; never forward them.
}

/** Patch headers are syntax facts. The caller still screens every repository-relative path. */
export function codeModePatchPaths(input: unknown): readonly string[] {
  if (typeof input !== "string" || input.length > MAX_INPUT || Buffer.byteLength(input) > MAX_INPUT || !input.startsWith("*** Begin Patch\n") ||
      !/\n\*\*\* End Patch\n?$/.test(input)) return [];
  const paths: string[] = [];
  for (const line of input.split("\n")) {
    const match = /^\*\*\* (?:(?:Add|Update|Delete) File: |Move to: )(.+)$/.exec(line);
    if (match) paths.push(match[1]!);
    if (paths.length > MAX_CALLS) return [];
  }
  return [...new Set(paths)];
}
