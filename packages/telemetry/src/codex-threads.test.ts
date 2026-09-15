import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { openCodexThreadReader as openReader, codexThreadEvidence, type CodexThreadReadOptions } from "./codex-threads.js";
import { CodexReadConnection } from "./codex-thread-connection.js";
import { projectGoal, projectThread, missingGoal, publicThreadId } from "./codex-thread-project.js";
import { main } from "./cli.js";
import { codexThreadsCommand } from "./codex-threads-cli.js";
// All source data below is synthetic; no live identity, location, objective or amount.
const openCodexThreadReader = (options: CodexThreadReadOptions = {}) => openReader({ timeoutMs: 150, ...options });
const next = async (e: AsyncGenerator<any>) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([e.next(), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 100); })]);
  clearTimeout(timer); assert.ok(result && !result.done, "notification must deliver or fail explicitly"); return result;
};
const bounded = async <T>(promise: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("control_deadline")), 80); })]); }
  finally { clearTimeout(timer); }
};
const thread = (id = "synthetic-root") => ({ id, parentThreadId: null, cwd: "PRIVATE_CWD_CANARY", gitInfo: { branch: "fixture-branch", originUrl: "PRIVATE_ORIGIN_CANARY" },
  modelProvider: "fixture-provider", model: "fixture-model", reasoningEffort: "fixture-effort", status: { type: "notLoaded" },
  sessionId: "PRIVATE_SESSION_CANARY", path: "PRIVATE_FILE_CANARY", preview: "PRIVATE_PREVIEW_CANARY" });
const goal = (id = "synthetic-root") => ({ threadId: id, objective: "PRIVATE_OBJECTIVE_CANARY", status: "active", tokenBudget: 0, tokensUsed: 0, timeUsedSeconds: 0, updatedAt: 1 });
type Message = { id?: number; method: string; params: Record<string, unknown> };
function fake(handler: (m: Message) => unknown = m => m.method === "thread/list" ? { data: [], nextCursor: null } : { goal: null }, initialize: unknown = { userAgent: "fixture" }) {
  const output = new PassThrough(); const sent: Message[] = []; let closed = 0;
  const emit = (v: unknown) => { if (!closed) output.write(JSON.stringify(v) + "\n"); };
  const input = new Writable({ write(chunk, _encoding, callback) {
    const m = JSON.parse(String(chunk)) as Message; sent.push(m);
    if (m.id !== undefined) {
      const result = m.method === "initialize" ? initialize : handler(m);
      if (result !== undefined) emit({ id: m.id, result });
    }
    callback();
  } });
  return { sent, emit, output, get closed() { return closed; }, port: { input, output, close() { closed++; output.end(); } } };
}
const one = (g: unknown = goal()) => fake(m => m.method === "thread/list" ? { data: m.params.archived ? [] : [thread()], nextCursor: null } : { goal: g });

test("positive: all fields preserve native values and reported zeros; null ancestry is unavailable", async () => {
  const f = one(), r = await openCodexThreadReader({ port: f.port, includeSensitive: true });
  const s = await r.read(); r.close(); assert.equal(s.complete, true); assert.equal(s.rows.length, 1);
  const row = s.rows[0]!; assert.equal(row.threadId, publicThreadId("synthetic-root")); assert.equal(row.parentThreadId.reason, "ancestry_unavailable");
  for (const k of ["tokenBudget", "tokensUsed", "secondsUsed"] as const) { assert.equal(row[k].availability, "available"); assert.equal(row[k].value, 0); }
  assert.equal(row.cwd.value, "PRIVATE_CWD_CANARY"); assert.equal(row.gitOrigin.value, "PRIVATE_ORIGIN_CANARY"); assert.equal(row.goalObjective.value, "PRIVATE_OBJECTIVE_CANARY");
  assert.equal(row.model.value, "fixture-model"); assert.equal(row.provider.value, "fixture-provider"); assert.equal(row.effort.value, "fixture-effort");
  assert.equal(row.running.reason, "runtime_unavailable"); assert.equal(row.routeBasis, "configured-or-persisted");
  assert.deepEqual(f.sent.map(m => m.method), ["initialize", "initialized", "thread/list", "thread/goal/get", "thread/list"]);
  for (const m of f.sent.filter(m => m.method === "thread/list")) { assert.equal(m.params.useStateDbOnly, true); assert.deepEqual(m.params.modelProviders, []); assert.equal((m.params.sourceKinds as string[]).length, 10); assert.ok((m.params.sourceKinds as string[]).includes("subAgentThreadSpawn")); }
  assert.equal(f.closed, 1);
});
test("privacy: default fields and evidence cannot emit sensitive canaries or native identifiers", async () => {
  const f = one(), r = await openCodexThreadReader({ port: f.port }); const s = await r.read(); r.close();
  assert.equal(s.rows[0]!.cwd.reason, "redacted"); assert.equal(s.rows[0]!.gitOrigin.reason, "redacted"); assert.equal(s.rows[0]!.goalObjective.reason, "redacted");
  assert.doesNotMatch(JSON.stringify(s), /PRIVATE_|synthetic-root/);
  const full = { ...s, rows: [projectThread(thread(), projectGoal(goal(), "synthetic-root", true), true)] };
  assert.doesNotMatch(JSON.stringify(codexThreadEvidence(full)), /PRIVATE_|synthetic-root|fixture-|agent_/);
});
test("goal absence, malformed response and mismatched identity stay unavailable", () => {
  assert.equal(projectGoal(null, "a", true).tokensUsed.reason, "goal_absent");
  for (const x of [undefined, [], 1]) assert.equal(projectGoal(x, "a", true).tokensUsed.reason, "invalid_response");
  assert.equal(projectGoal(goal("b"), "a", true).tokensUsed.reason, "identity_mismatch");
  assert.equal(projectGoal({ ...goal(), tokenBudget: null }, "synthetic-root", true).tokenBudget.reason, "budget_unset");
});
test("counter guards reject every invalid number without discarding valid siblings", () => {
  for (const k of ["tokenBudget", "tokensUsed", "timeUsedSeconds", "updatedAt"]) for (const v of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "0", true]) {
    const p = projectGoal({ ...goal(), [k]: v }, "synthetic-root", true), field = k === "timeUsedSeconds" ? "secondsUsed" : k === "updatedAt" ? "goalUpdatedAt" : k;
    assert.equal(p[field as "tokenBudget"].reason, "invalid_field");
  }
  const p = projectGoal({ threadId: "synthetic-root" }, "synthetic-root", true);
  assert.equal(p.tokensUsed.reason, "field_absent"); assert.equal(p.goalStatus.reason, "field_absent");
});
test("status vocabularies and optional field validation never infer running from a goal", () => {
  for (const s of ["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"]) assert.equal(projectGoal({ ...goal(), status: s }, "synthetic-root", true).goalStatus.value, s);
  assert.equal(projectGoal({ ...goal(), status: "invented" }, "synthetic-root", true).goalStatus.reason, "invalid_field");
  for (const [s, expected] of [["active", true], ["idle", false], ["notLoaded", null], ["systemError", null], ["invented", null]] as const) {
    const p = projectThread({ ...thread(), status: { type: s } }, missingGoal("goal_absent"), true);
    assert.equal(p.running.value, expected); if (s === "invented") assert.equal(p.status.reason, "invalid_field");
  }
  for (const v of ["", "   ", 2, [], "bad\u0000value", "x".repeat(65537)]) assert.equal(projectThread({ ...thread(), model: v }, missingGoal("goal_absent"), true).model.reason, "invalid_field");
  assert.equal(projectThread({ id: "x" }, missingGoal("goal_absent"), true).model.reason, "field_absent");
  assert.equal(projectThread({ ...thread(), parentThreadId: "parent" }, missingGoal("goal_absent"), true).parentThreadId.value, publicThreadId("parent"));
  assert.equal(projectThread({ ...thread(), parentThreadId: [] }, missingGoal("goal_absent"), true).parentThreadId.reason, "invalid_field");
});
test("pagination includes archived rows and carries cursor exactly", async () => {
  const f = fake(m => m.method !== "thread/list" ? { goal: null } : { data: [thread(m.params.archived ? "archived" : m.params.cursor ? "second" : "first")], nextCursor: !m.params.archived && !m.params.cursor ? "page-two" : null });
  const r = await openCodexThreadReader({ port: f.port }); const s = await r.read(); r.close();
  assert.equal(s.complete, true); assert.equal(s.rows.length, 3); assert.equal(f.sent.filter(m => m.method === "thread/list")[1]!.params.cursor, "page-two");
  assert.ok(s.rows.every(row => row.tokensUsed.reason === "goal_absent"));
});
test("scan limit preserves a bounded partial snapshot without claiming completeness", async () => {
  const f = one(), r = await openCodexThreadReader({ port: f.port, limit: 1 }); const s = await r.read(); r.close();
  assert.equal(s.complete, false); assert.equal(s.reason, "scan_limit"); assert.equal(s.rows.length, 1);
});
test("duplicate identities, malformed pages and cursor cycles refuse the collection", async () => {
  const cases = [null, [], {}, { data: [], nextCursor: 5 }, { data: "bad", nextCursor: null }, { data: [thread(), thread()], nextCursor: null },
    { data: [{}], nextCursor: null }, { data: [null], nextCursor: null }, { data: [thread("")], nextCursor: null }, { data: Array.from({ length: 51 }, (_, i) => thread(String(i))), nextCursor: null }];
  for (const p of cases) { const f = fake(m => m.method === "thread/list" ? p : { goal: null }), r = await openCodexThreadReader({ port: f.port }); const s = await r.read(); r.close(); assert.equal(s.complete, false); assert.equal(s.rows.length, 0); }
  const f = fake(() => ({ data: [], nextCursor: "repeat" })), r = await openCodexThreadReader({ port: f.port });
  const s = await r.read(); r.close(); assert.equal(s.reason, "invalid_response");
});
test("empty pages with unique cursors are bounded by the page ceiling", async () => {
  let n = 0; const f = fake(() => ++n > 203 ? {} : ({ data: [], nextCursor: String(n) })), r = await openCodexThreadReader({ port: f.port, timeoutMs: 500 });
  const s = await r.read(); r.close(); assert.equal(s.reason, "scan_limit"); assert.equal(n, 202);
});
test("invalid options fail before opening a source", async () => {
  for (const key of ["limit", "timeoutMs"]) for (const value of [0, -1, 0.5, NaN, Infinity, 60001, "4"]) await assert.rejects(openCodexThreadReader({ [key]: value } as never), /invalid_options/);
  await assert.rejects(openCodexThreadReader({ limit: 5001 }), /invalid_options/);
  await assert.rejects(openCodexThreadReader({ includeSensitive: "yes" } as never), /invalid_options/);
});
test("goal response errors preserve the thread and a closed reason", async () => {
  for (const g of [{}, null, { goal: undefined }]) { const f = fake(m => m.method === "thread/list" ? { data: m.params.archived ? [] : [thread()], nextCursor: null } : g), r = await openCodexThreadReader({ port: f.port }); const s = await r.read(); r.close(); assert.equal(s.rows[0]!.tokensUsed.reason, "invalid_response"); }
  const f = fake(m => { if (m.method === "thread/list") return { data: m.params.archived ? [] : [thread()], nextCursor: null }; f.emit({ id: m.id, error: { message: "PRIVATE_ERROR_CANARY" } }); return undefined; });
  const r = await openCodexThreadReader({ port: f.port }); const s = await r.read(); r.close(); assert.equal(s.rows[0]!.tokensUsed.reason, "rpc_error"); assert.equal(s.complete, false); assert.equal(s.reason, "rpc_error"); assert.doesNotMatch(JSON.stringify(s), /PRIVATE_ERROR/);
});
test("subscriptions deliver update and clear, opaque references and distinct zero fields without polling", async () => {
  const f = fake(), r = await openCodexThreadReader({ port: f.port }); const e = r.events();
  f.emit({ method: "thread/goal/updated", params: { threadId: "synthetic-root", goal: goal() } });
  const a = (await next(e)).value!; assert.equal(a.type, "goal_updated"); assert.equal(a.sequence, 1);
  if (a.type !== "unavailable") { assert.equal(a.goal.tokenBudget.value, 0); assert.equal(a.goal.goalStatus.value, "active"); assert.equal(a.goal.goalObjective.reason, "redacted"); }
  f.emit({ method: "thread/goal/cleared", params: { threadId: "synthetic-root" } });
  const b = (await next(e)).value!; assert.equal(b.type, "goal_cleared"); assert.equal(b.sequence, 2); if (b.type !== "unavailable") assert.equal(b.goal.tokensUsed.reason, "goal_absent");
  assert.doesNotMatch(JSON.stringify([a, b]), /synthetic-root|PRIVATE_/); assert.equal(f.sent.length, 2); await e.return(undefined); assert.equal(f.closed, 1);
});
test("subscription supports a waiting consumer and rejects a second consumer", async () => {
  const f = fake(), r = await openCodexThreadReader({ port: f.port }); const e = r.events(); const pending = e.next();
  f.emit({ method: "irrelevant", params: { secret: "PRIVATE_CANARY" } });
  await assert.rejects(bounded(r.events().next()), /subscription_in_use/);
  f.emit({ method: "thread/goal/cleared", params: { threadId: "x" } }); assert.equal((await pending).value!.type, "goal_cleared"); await e.return(undefined);
});
test("malformed or mismatched goal notifications fail visibly", async () => {
  for (const params of [null, [], {}, { threadId: "" }, { threadId: "a", goal: null }, { threadId: "a", goal: goal("b") }]) {
    const f = fake(), r = await openCodexThreadReader({ port: f.port }); assert.doesNotThrow(() => f.emit({ method: "thread/goal/updated", params }));
    const e = r.events(), x = (await next(e)).value!; assert.equal(x.type, "unavailable"); assert.equal(f.closed, 1); await e.return(undefined);
  }
});
test("overflow is explicit and never silently drops a goal change", async () => {
  const f = fake(), r = await openCodexThreadReader({ port: f.port });
  for (let i = 0; i < 129; i++) f.emit({ method: "thread/goal/cleared", params: { threadId: "x" } });
  const e = r.events(), x = (await next(e)).value!; assert.equal(x.type, "unavailable"); if (x.type === "unavailable") assert.equal(x.reason, "notification_overflow");
  assert.equal((await bounded(e.next())).done, true); assert.equal(f.closed, 1);
});
test("disconnect resolves subscription with unavailable and closes only owned port once", async () => {
  const f = fake(), r = await openCodexThreadReader({ port: f.port }); f.output.end();
  const x = (await next(r.events())).value!; assert.equal(x.type, "unavailable"); r.close(); r.close(); assert.equal(f.closed, 1);
  assert.equal((await bounded(r.read())).complete, false);
});
test("timeouts and concurrent reads cannot produce a complete snapshot", async () => {
  const f = fake(() => undefined), r = await openCodexThreadReader({ port: f.port, timeoutMs: 15 });
  const pending = r.read(); assert.equal((await r.read()).reason, "read_in_progress"); assert.equal((await pending).reason, "request_timeout"); r.close();
});
test("initialization rejects absent or malformed acknowledgements", async () => {
  for (const reply of [null, {}, { userAgent: "" }]) { const f = fake(undefined, reply); await assert.rejects(openCodexThreadReader({ port: f.port }), /invalid_response/); assert.equal(f.closed, 1); }
});
test("connection refuses write methods, pre-handshake reads and repeated initialize", async () => {
  const f = fake(), c = new CodexReadConnection(f.port, 100, () => {}, () => {});
  await assert.rejects(c.request("thread/list", {}), /read_only_violation/);
  for (const m of ["thread/start", "thread/resume", "turn/start", "thread/goal/set", "thread/goal/clear"]) await assert.rejects(c.request(m, {}), /read_only_violation/);
  await c.initialize();
  for (const m of ["thread/goal/set", "thread/goal/clear", "turn/start"]) await assert.rejects(c.request(m, {}), /read_only_violation/);
  await assert.rejects(c.initialize(), /read_only_violation/); c.fail("source_closed");
});
test("connection rejects malformed frames, unsolicited requests and response correlation failures", async () => {
  for (const raw of ["not-json\n", "[]\n", "{}\n", JSON.stringify({ id: 777, result: {} }) + "\n", JSON.stringify({ id: 4, method: "approval/request" }) + "\n"]) {
    const f = fake(), r = await openCodexThreadReader({ port: f.port }); assert.doesNotThrow(() => f.output.write(raw)); const x = (await next(r.events())).value!; assert.equal(x.type, "unavailable"); r.close();
  }
  for (const reply of [{}, { result: {}, error: {} }]) {
    const f = fake(m => { f.emit({ id: m.id, ...reply }); return undefined; }), r = await openCodexThreadReader({ port: f.port }); const s = await r.read(); r.close(); assert.equal(s.reason, "invalid_response");
  }
});
test("frame bounds apply before parsing, with and without a newline", async () => {
  for (const suffix of ["", "\n"]) { const f = fake(), r = await openCodexThreadReader({ port: f.port }); f.output.write("x".repeat(1048577) + suffix); const x = (await next(r.events())).value!; assert.equal(x.type, "unavailable"); if (x.type === "unavailable") assert.equal(x.reason, "oversized_frame"); r.close(); }
});
test("pending request ceiling is enforced independently from source timeout", async () => {
  const f = fake(() => undefined), c = new CodexReadConnection(f.port, 100, () => {}, () => {}); await c.initialize();
  const pending = Array.from({ length: 8 }, () => c.request("thread/list", {}).catch(e => e));
  await assert.rejects(c.request("thread/list", {}), /scan_limit/); c.fail("source_closed"); await Promise.all(pending);
});
test("CLI forwards opt-in, limit and watch; malformed flags never open a source", async () => {
  const err = process.stderr.write; const out: string[] = []; let opens = 0, closes = 0, watched = 0;
  const output = new Writable({ write(chunk, _enc, callback) { out.push(String(chunk)); callback(); } });
  process.stderr.write = (() => true) as typeof err;
  try {
    const open = async (options: unknown) => { opens++; assert.deepEqual(options, { limit: 2, includeSensitive: true }); return {
      read: async () => ({ schema: 1 as const, source: "codex-app-server" as const, scope: "stored-all-sources-including-archived" as const, complete: true, reason: null, observedAt: "fixture", rows: [] }),
      async *events() { watched++; yield { schema: 1 as const, sequence: 1, type: "unavailable" as const, reason: "source_closed" as const }; }, close() { closes++; } }; };
    assert.equal(await codexThreadsCommand(["--private", "--limit", "2", "--watch", "--json"], open, output), 3); assert.equal(watched, 1); assert.equal(closes, 1); assert.equal(out.length, 2);
    for (const args of [["--bad"], ["--limit"], ["--limit", "0"], ["--limit", "2.5"], ["--limit", "5001"], ["--private", "--private"]]) assert.equal(await codexThreadsCommand(args, open, output), 2);
    assert.equal(opens, 1);
  } finally { process.stderr.write = err; }
});

test("whole read deadline bounds a series of individually timely replies", async () => {
  for (const timeoutMs of [35, 300]) {
    let page = 0;
    const f = fake(m => {
      const reply = m.method === "thread/list" ? { data: m.params.archived ? [] : [thread(String(++page))], nextCursor: !m.params.archived && page < 4 ? String(page) : null } : { goal: null };
      setTimeout(() => f.emit({ id: m.id, result: reply }), 8); return undefined;
    });
    const r = await openCodexThreadReader({ port: f.port, timeoutMs }); const s = await r.read(); r.close();
    assert.equal(s.complete, timeoutMs === 300); if (timeoutMs === 35) assert.equal(s.reason, "request_timeout");
  }
});
test("chunk boundaries preserve valid JSONL and source errors remain sanitized", async () => {
  const f = fake(), r = await openCodexThreadReader({ port: f.port });
  const line = JSON.stringify({ method: "thread/goal/cleared", params: { threadId: "x" } }) + "\n";
  f.output.write(line.slice(0, 8)); f.output.write(line.slice(8)); assert.equal((await next(r.events())).value!.type, "goal_cleared"); r.close();
  const bad = fake(), other = await openCodexThreadReader({ port: bad.port }); bad.output.destroy(new Error("PRIVATE_ERROR_CANARY"));
  const event = (await next(other.events())).value!; assert.equal(event.type, "unavailable"); assert.doesNotMatch(JSON.stringify(event), /PRIVATE_/); other.close();
});

test("invalid identity is distinguished from a malformed page; closed connections reject reads", async () => {
  for (const item of [null, {}, thread("")]) {
    const f = fake(() => ({ data: [item], nextCursor: null })), r = await openCodexThreadReader({ port: f.port });
    const s = await r.read(); r.close(); assert.equal(s.reason, "identity_mismatch");
  }
  const f = fake(), c = new CodexReadConnection(f.port, 20, () => {}, () => {}); await c.initialize(); c.fail("source_closed");
  await assert.rejects(bounded(c.request("thread/list", {})), /source_closed/);
});
test("closed reader ignores late frames rather than accepting stale notifications", async () => {
  const f = fake(), r = await openCodexThreadReader({ port: f.port }); r.close();
  f.output.emit("data", Buffer.from(JSON.stringify({ method: "thread/goal/cleared", params: { threadId: "x" } }) + "\n"));
  const e = r.events(); assert.equal((await next(e)).value!.type, "unavailable"); assert.equal((await bounded(e.next())).done, true);
});
test("CLI respects partial coverage, backpressure and cancellation during initialization", async () => {
  let release: ((error?: Error | null) => void) | undefined, read = 0, closed = 0;
  const output = new Writable({ write(_chunk, _enc, callback) { release = callback; } });
  const handle = { read: async () => { read++; return { schema: 1 as const, source: "codex-app-server" as const, scope: "stored-all-sources-including-archived" as const, complete: false, reason: "scan_limit" as const, observedAt: "fixture", rows: [] }; }, async *events() {}, close() { closed++; } };
  let completed = false;
  const pending = codexThreadsCommand([], async () => handle, output).then(code => { completed = true; return code; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(completed, false); assert.ok(release); release();
  assert.equal(await pending, 3);
  assert.equal(await codexThreadsCommand([], async () => { (process.listeners("SIGINT").at(-1) as () => void)(); return handle; }, new PassThrough()), 3);
  assert.equal(read, 1); assert.ok(closed >= 2);
});

test("request timeout is independent of the whole snapshot timeout", async () => {
  const f = fake(() => undefined), c = new CodexReadConnection(f.port, 15, () => {}, () => {}); await c.initialize();
  await assert.rejects(c.request("thread/list", {}), /request_timeout/);
  const good = fake(() => ({ data: [], nextCursor: null })), ok = new CodexReadConnection(good.port, 15, () => {}, () => {});
  await ok.initialize(); assert.deepEqual(await ok.request("thread/list", {}), { data: [], nextCursor: null }); ok.fail("source_closed");
});
test("unsolicited requests have a distinct refusal and oversized pages cannot pass via later guards", async () => {
  const f = fake(), r = await openCodexThreadReader({ port: f.port }); f.emit({ id: 999, method: "approval/request" });
  const e = (await next(r.events())).value!; assert.equal(e.reason, "read_only_violation"); r.close();
  const oversized = fake(m => m.method !== "thread/list" ? { goal: null } : { data: m.params.archived ? [] : Array.from({ length: 51 }, (_, i) => thread(String(i))), nextCursor: null });
  const reader = await openCodexThreadReader({ port: oversized.port }); const s = await reader.read(); reader.close(); assert.equal(s.reason, "invalid_response"); assert.equal(s.rows.length, 0);
});
test("goal counters retain independent nonzero native values without blending", () => {
  const g = projectGoal({ ...goal(), tokenBudget: 5, tokensUsed: 7, timeUsedSeconds: 11, updatedAt: 13 }, "synthetic-root", true);
  assert.equal(g.tokenBudget.value, 5); assert.equal(g.tokensUsed.value, 7); assert.equal(g.secondsUsed.value, 11); assert.equal(g.goalUpdatedAt.value, 13);
});

test("goal identity errors mark coverage incomplete and goal timeouts retain the original reason", async () => {
  const f = one(goal("different")), r = await openCodexThreadReader({ port: f.port }); const s = await r.read(); r.close();
  assert.equal(s.rows.length, 1); assert.equal(s.complete, false); assert.equal(s.reason, "identity_mismatch");
  const slow = fake(m => m.method === "thread/list" ? { data: [thread()], nextCursor: null } : undefined), q = await openCodexThreadReader({ port: slow.port, timeoutMs: 15 });
  assert.equal((await q.read()).reason, "request_timeout"); q.close();
});

test("telemetry CLI routes malformed native-read options to the fixed diagnostic without opening a source", async () => {
  const stdout = process.stdout.write, stderr = process.stderr.write; let output = "", error = "";
  process.stdout.write = ((s: string) => { output += s; return true; }) as typeof stdout;
  process.stderr.write = ((s: string) => { error += s; return true; }) as typeof stderr;
  try { assert.equal(await main(["codex-threads", "--limit", "invalid"]), 2); assert.equal(error, "codex-threads: invalid command line\n"); assert.equal(output, ""); }
  finally { process.stdout.write = stdout; process.stderr.write = stderr; }
});

test("CLI interrupts after a successful read and handles broken output without a stack trace", async () => {
  const stderr = process.stderr.write; let errors = "";
  process.stderr.write = ((s: string) => { errors += s; return true; }) as typeof stderr;
  const snapshot = { schema: 1 as const, source: "codex-app-server" as const, scope: "stored-all-sources-including-archived" as const, complete: true, reason: null, observedAt: "fixture", rows: [] };
  try {
    const interrupted = { read: async () => snapshot, async *events() { (process.listeners("SIGTERM").at(-1) as () => void)(); }, close() {} };
    assert.equal(await codexThreadsCommand(["--watch"], async () => interrupted, new PassThrough()), 3);
    const broken = new Writable({ write(_chunk, _enc, callback) { callback(new Error("PRIVATE_PIPE_ERROR_CANARY")); } });
    const handle = { read: async () => snapshot, async *events() {}, close() {} };
    assert.equal(await codexThreadsCommand([], async () => handle, broken), 3);
    assert.doesNotMatch(errors, /PRIVATE_|Error:| at /); assert.match(errors, /source_(closed|unavailable)/);
    let released: (() => void) | undefined;
    const blocked = new Writable({ write(_chunk, _enc, callback) { released = callback; } });
    const pending = codexThreadsCommand([], async () => handle, blocked);
    await new Promise(resolve => setImmediate(resolve)); (process.listeners("SIGINT").at(-1) as () => void)();
    assert.equal(await bounded(pending), 3); assert.equal(blocked.destroyed, true); released?.();
  } finally { process.stderr.write = stderr; }
});

test("CLI rejects a write callback error even before an output error event", async () => {
  const stderr = process.stderr.write; process.stderr.write = (() => true) as typeof stderr;
  const output = new PassThrough();
  output.write = ((_data: unknown, callback: (error?: Error) => void) => { callback(new Error("PRIVATE_CALLBACK_CANARY")); return true; }) as typeof output.write;
  const handle = { read: async () => ({ schema: 1 as const, source: "codex-app-server" as const, scope: "stored-all-sources-including-archived" as const, complete: true, reason: null, observedAt: "fixture", rows: [] }), async *events() {}, close() {} };
  try { assert.equal(await codexThreadsCommand([], async () => handle, output), 3); }
  finally { process.stderr.write = stderr; }
});
