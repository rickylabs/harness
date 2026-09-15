import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const root = new URL("../", import.meta.url);
const cases = [
  [
    "object shape",
    "codex-thread-project.js",
    "typeof v === \"object\" && v !== null && !Array.isArray(v)",
    "true"
  ],
  [
    "nonblank strings",
    "codex-thread-project.js",
    "v.trim().length > 0",
    "true"
  ],
  [
    "string bound",
    "codex-thread-project.js",
    "v.length <= 65536",
    "true"
  ],
  [
    "control characters",
    "codex-thread-project.js",
    "!/[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]/.test(v)",
    "true"
  ],
  [
    "sensitive opt-in",
    "codex-thread-project.js",
    "return include ? stringField(v) : unavailable(\"redacted\")",
    "return stringField(v)"
  ],
  [
    "missing numeric value",
    "codex-thread-project.js",
    "return v === null || v === undefined ? unavailable(absent)",
    "return false ? unavailable(absent)"
  ],
  [
    "safe integer counters",
    "codex-thread-project.js",
    "Number.isSafeInteger(v)",
    "true"
  ],
  [
    "nonnegative counters",
    "codex-thread-project.js",
    "v >= 0",
    "true"
  ],
  [
    "zero remains known",
    "codex-thread-project.js",
    "v >= 0",
    "v > 0"
  ],
  [
    "absent goal",
    "codex-thread-project.js",
    "if (raw === null)",
    "if (false)"
  ],
  [
    "goal object",
    "codex-thread-project.js",
    "if (!g)",
    "if (false)"
  ],
  [
    "goal identity match",
    "codex-thread-project.js",
    "if (g.threadId !== nativeId)",
    "if (false)"
  ],
  [
    "goal status vocabulary",
    "codex-thread-project.js",
    "statuses.includes(g.status)",
    "true"
  ],
  [
    "parent absence is not a root",
    "codex-thread-project.js",
    "unavailable(\"ancestry_unavailable\")",
    "available(\"invented-root\")"
  ],
  [
    "parent identity validation",
    "codex-thread-project.js",
    "text(t.parentThreadId) ?",
    "true ?"
  ],
  [
    "running is not inferred for unloaded threads",
    "codex-thread-project.js",
    "unavailable(\"runtime_unavailable\")",
    "available(false)"
  ],
  [
    "known native status vocabulary",
    "codex-thread-project.js",
    "status: known ?",
    "status: true ?"
  ],
  [
    "opaque thread identity",
    "codex-thread-project.js",
    "\"agent_\" + createHash(\"sha256\").update(\"agent\\0codex\\0\" + id).digest(\"hex\")",
    "id"
  ],
  [
    "evidence allowlist",
    "codex-thread-project.js",
    "return { schema: 1, complete: snapshot.complete",
    "return { leaked: snapshot.rows, schema: 1, complete: snapshot.complete"
  ],
  [
    "initialize acknowledgment",
    "codex-thread-connection.js",
    "if (!text(object(reply)?.userAgent))",
    "if (false)"
  ],
  [
    "outbound read allowlist",
    "codex-thread-connection.js",
    "if (![\"initialize\", \"thread/list\", \"thread/goal/get\"].includes(method))",
    "if (false)"
  ],
  [
    "closed request refusal",
    "codex-thread-connection.js",
    "if (this.ended)\n            return Promise.reject",
    "if (false)\n            return Promise.reject"
  ],
  [
    "initialization before reads",
    "codex-thread-connection.js",
    "method !== \"initialize\" && !this.ready",
    "false"
  ],
  [
    "no repeated initialization",
    "codex-thread-connection.js",
    "method === \"initialize\" && this.serial !== 0",
    "false"
  ],
  [
    "pending request cap",
    "codex-thread-connection.js",
    "if (this.pending.size >= 8)",
    "if (false)"
  ],
  [
    "request timeout",
    "codex-thread-connection.js",
    "setTimeout(() => this.fail(\"request_timeout\"), this.timeoutMs)",
    "setTimeout(() => this.fail(\"source_closed\"), this.timeoutMs)"
  ],
  [
    "close idempotency",
    "codex-thread-connection.js",
    "fail(reason) {\n        if (this.ended)",
    "fail(reason) {\n        if (false)"
  ],
  [
    "late frame refusal",
    "codex-thread-connection.js",
    "receive(chunk) {\n        if (this.ended)",
    "receive(chunk) {\n        if (false)"
  ],
  [
    "terminated frame byte bound",
    "codex-thread-connection.js",
    "if (newline > 1048576)",
    "if (false)"
  ],
  [
    "unterminated frame byte bound",
    "codex-thread-connection.js",
    "if (this.buffer.length > 1048576)",
    "if (false)"
  ],
  [
    "envelope object",
    "codex-thread-connection.js",
    "if (!m)",
    "if (false)"
  ],
  [
    "unsolicited server request",
    "codex-thread-connection.js",
    "if (\"method\" in m)",
    "if (false)"
  ],
  [
    "response identity correlation",
    "codex-thread-connection.js",
    "if (!p)",
    "if (false)"
  ],
  [
    "result error exclusivity",
    "codex-thread-connection.js",
    "if ((\"result\" in m) === (\"error\" in m))",
    "if (false)"
  ],
  [
    "RPC errors are unavailable",
    "codex-thread-connection.js",
    "p.reject(new CodexReadError(reason));\n                }\n                else\n                    p.resolve(m.result);",
    "p.resolve({ goal: null });\n                }\n                else\n                    p.resolve(m.result);"
  ],
  [
    "inbound notification allowlist",
    "codex-thread-connection.js",
    "if (m.method === \"thread/goal/updated\" || m.method === \"thread/goal/cleared\")",
    "if (true)"
  ],
  [
    "limit integer",
    "codex-threads.js",
    "!Number.isSafeInteger(limit)",
    "false"
  ],
  [
    "limit lower bound",
    "codex-threads.js",
    "limit < 1",
    "false"
  ],
  [
    "limit upper bound",
    "codex-threads.js",
    "limit > 5000",
    "false"
  ],
  [
    "timeout integer",
    "codex-threads.js",
    "!Number.isSafeInteger(timeoutMs)",
    "false"
  ],
  [
    "timeout lower bound",
    "codex-threads.js",
    "timeoutMs < 1",
    "false"
  ],
  [
    "timeout upper bound",
    "codex-threads.js",
    "timeoutMs > 60000",
    "false"
  ],
  [
    "sensitive option type",
    "codex-threads.js",
    "(options.includeSensitive !== undefined && typeof options.includeSensitive !== \"boolean\")",
    "false"
  ],
  [
    "one snapshot at a time",
    "codex-threads.js",
    "if (this.reading)",
    "if (false)"
  ],
  [
    "whole read deadline",
    "codex-threads.js",
    "setTimeout(() => this.connection.fail(\"request_timeout\"), this.options.timeoutMs)",
    "setTimeout(() => this.connection.fail(\"request_timeout\"), 10000)"
  ],
  [
    "page operation bound",
    "codex-threads.js",
    "if (++pages > 202)",
    "if (false)"
  ],
  [
    "row bound",
    "codex-threads.js",
    "if (remaining <= 0)",
    "if (false)"
  ],
  [
    "response page shape",
    "codex-threads.js",
    "if (!p || !Array.isArray(p.data) || p.data.length > pageSize || !(p.nextCursor === null || text(p.nextCursor)))",
    "if (false)"
  ],
  [
    "thread identity validity",
    "codex-threads.js",
    "if (!t || !text(t.id))",
    "if (false)"
  ],
  [
    "unique thread identity",
    "codex-threads.js",
    "if (ids.has(t.id))",
    "if (false)"
  ],
  [
    "goal response shape",
    "codex-threads.js",
    "g && \"goal\" in g ? projectGoal(g.goal, t.id, this.options.includeSensitive) : missingGoal(\"invalid_response\")",
    "projectGoal(g?.goal ?? null, t.id, this.options.includeSensitive)"
  ],
  [
    "goal RPC failure affects coverage",
    "codex-threads.js",
    "coverageReason ??= reasonOf(e);",
    "coverageReason ??= null;"
  ],
  [
    "cursor cycle fence",
    "codex-threads.js",
    "if (cursor !== null && cursors.has(cursor))",
    "if (false)"
  ],
  [
    "include archived records",
    "codex-threads.js",
    "for (const archived of [false, true])",
    "for (const archived of [false])"
  ],
  [
    "include native subagent sources",
    "codex-threads.js",
    "sourceKinds: SOURCE_KINDS",
    "sourceKinds: [\"cli\"]"
  ],
  [
    "disable read-side rollout repair",
    "codex-threads.js",
    "useStateDbOnly: true",
    "useStateDbOnly: false"
  ],
  [
    "one subscriber",
    "codex-threads.js",
    "if (this.subscribed)",
    "if (false)"
  ],
  [
    "notification thread identity",
    "codex-threads.js",
    "if (!p || !text(p.threadId))",
    "if (false)"
  ],
  [
    "notification nested identity match",
    "codex-threads.js",
    "if (method === \"thread/goal/updated\" && (!object(p.goal) || object(p.goal).threadId !== p.threadId))",
    "if (false)"
  ],
  [
    "notification queue bound",
    "codex-threads.js",
    "if (this.queue.length >= 128)",
    "if (false)"
  ],
  [
    "overflow invalidates buffered prefix",
    "codex-threads.js",
    "if (reason === \"notification_overflow\")",
    "if (false)"
  ],
  [
    "CLI duplicate options",
    "codex-threads-cli.js",
    "if (seen.has(flag))",
    "if (false)"
  ],
  [
    "CLI row ceiling",
    "codex-threads-cli.js",
    "if (limit > 5000)",
    "if (false)"
  ],
  [
    "CLI watch opt-in",
    "codex-threads-cli.js",
    "if (watch)",
    "if (false)"
  ],
  [
    "CLI terminal source failure",
    "codex-threads-cli.js",
    "if (event.type === \"unavailable\")",
    "if (false)"
  ],
  [
    "CLI coverage exit",
    "codex-threads-cli.js",
    "return !stopped && snapshot.complete ? 0 : 3",
    "return 0"
  ],
  [
    "CLI initialization cancellation",
    "codex-threads-cli.js",
    "if (stopped)",
    "if (false)"
  ],
  [
    "CLI output backpressure",
    "codex-threads-cli.js",
    "await write(snapshot);",
    "void write(snapshot);"
  ]
];
cases.push(
 ["invalid goal identity affects read coverage", "codex-threads.js", 'if (goal.tokenBudget.reason === "identity_mismatch" || goal.tokenBudget.reason === "invalid_response")', 'if (false)'],
 ["goal source closure preserves its reason", "codex-threads.js", 'if (this.ended)\n                            throw new CodexReadError(this.endReason);', 'if (false)\n                            throw new CodexReadError(this.endReason);'],
 ["subscription terminates at source EOF", "codex-threads.js", 'if (this.ended)\n                    return;', 'if (false)\n                    return;']
);
cases.push(["telemetry CLI dispatches native reads", "cli.js", 'if (argv[0] === "codex-threads")', 'if (false)']);
cases.push(
 ["CLI interrupt never reports success", "codex-threads-cli.js", 'return !stopped && snapshot.complete ? 0 : 3', 'return snapshot.complete ? 0 : 3'],
 ["CLI output errors are handled", "codex-threads-cli.js", 'output.on("error", stop);', ''],
 ["CLI write callback error is not success", "codex-threads-cli.js", 'if (error)', 'if (false)']
);
cases.push(
 ["CLI rejects an interrupted blocked write", "codex-threads-cli.js", 'rejectWrite?.(new CodexReadError("source_closed"));', ''],
 ["CLI interrupt closes its output", "codex-threads-cli.js", 'output.destroy();', '']
);
cases.push(
 ["daemon refusal method binding", "codex-thread-connection.js", 'method === "thread/goal/get" ? params.threadId : undefined', 'params.threadId'],
 ["daemon refusal identity type", "codex-thread-connection.js", 'typeof p.goalThreadId === "string"', 'true'],
 ["daemon refusal error code type", "codex-thread-connection.js", 'error?.code === -32600', 'error?.code == -32600'],
 ["daemon refusal error code", "codex-thread-connection.js", 'error?.code === -32600', 'true'],
 ["daemon refusal exact identity message", "codex-thread-connection.js", 'error.message === `thread not found: ${p.goalThreadId}`', 'true'],
 ["daemon refusal remains actionable", "codex-thread-connection.js", '? "thread_not_found" : "rpc_error"', '? "rpc_error" : "rpc_error"']
);
const args = ["--test", "--test-timeout=1500", "packages/telemetry/dist/codex-threads.test.js"];
const test = () => spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 8000 });
assert.equal(test().status, 0, "positive baseline must pass");
let failed = 0;
for (const [name, file, before, after] of cases) {
 const target = new URL("../packages/telemetry/dist/" + file, import.meta.url), original = readFileSync(target, "utf8");
 if (original.split(before).length !== 2) { console.log(JSON.stringify({ mutation: name, verdict: "INCONCLUSIVE", reason: "anchor_not_unique" })); failed++; continue; }
 let broken;
 try { writeFileSync(target, original.replace(before, after)); broken = test(); } finally { writeFileSync(target, original); }
 const restored = test(), output = broken.stdout + broken.stderr;
 const killed = broken.status === 1 && /(?:not ok|✖|fail [1-9])/u.test(output) && !/SyntaxError|ERR_MODULE_NOT_FOUND|test timed out/.test(output) && restored.status === 0;
 if (!killed) failed++;
 console.log(JSON.stringify({ mutation: name, command: "node " + args.join(" "), mutatedExit: broken.status,
  output: output.split("\n").filter(l => /^(?:not ok|✖|ℹ (?:tests|pass|fail)|# (?:tests|pass|fail))/.test(l)), restoredExit: restored.status, verdict: killed ? "KILLED" : "INCONCLUSIVE" }));
}
console.log(JSON.stringify({ verdict: failed ? "FAIL" : "PASS", mutations: cases.length, killed: cases.length - failed, restoredControls: cases.length - failed, inconclusive: failed }));
process.exitCode = failed ? 1 : 0;
