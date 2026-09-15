/** Mutate production guards, demand assertion failures, restore, and rerun the controls. */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const native = "packages/telemetry/src/orchid-native-binding.ts";
const reader = "packages/telemetry/src/orchid-dispatch.ts";
const builder = "packages/telemetry/src/agent-observations.ts";
const test = "packages/telemetry/dist/orchid-native-binding.test.js";
const originals = new Map([native, reader, builder].map(file => [file, readFileSync(file, "utf8")]));
const mutations = [
  ["launch-state", native, 'dispatch.dispatchState !== "dispatched"', 'false'],
  ["supported-source", native, 'dispatch.source !== "codex"', 'dispatch.source === null'],
  ["symlink", native, 'constants.O_NOFOLLOW | ', ''],
  ["regular-file", native, '!stat.isFile()', 'false'],
  ["private-mode", native, '(stat.mode & 0o7777) !== 0o600', 'false'],
  ["declared-bound", native, 'stat.size > MAX_BYTES', 'false'],
  ["actual-bound", native, 'if (bytesRead > MAX_BYTES) throw new Error();', ''],
  ["identity-length", native, 'Buffer.byteLength(id) === 0 || Buffer.byteLength(id) > 256', 'false'],
  ["identity-trim", native, '/^\\p{White_Space}|\\p{White_Space}$/u.test(id)', 'false'],
  ["identity-characters", native, '/[\\x00\\r\\n\\t /\\\\]/.test(id)', 'false'],
  ["reservation", native, 'digest(binding.IssueID + "\\0" + binding.Repo + "\\0" + binding.BriefDigest) !== reservation', 'reservation.length < 0'],
  ...["transport", "provider", "model"].map(field => ["route-" + field, native,
    field === "transport" ? 'route.transport !== dispatch.source' : `route.${field} !== dispatch.route.requested.${field}.value`, 'false']),
  ["route-effort", native, '(route.effort || null) !== dispatch.route.requested.effort.value', 'false'],
  ["snapshot", native, 'if (digest(await readPrivate(join(record, "dispatch.json"))) !== dispatch.revision) return;', ''],
  ["invalidation", native, 'bindings.set(dispatch, { key: null });', ''],
  ["unique-root", native, 'matches.length === 1', 'matches.length > 0'],
  ["native-root", native, 'matches[0]!.parentId === null', 'true'],
  ["source-namespace", native, 'digest(source + "\\0" + identity)', 'digest(source.slice(0, 0) + identity)'],
  ["private-storage", native, 'bindings.set(dispatch, { key: keyFor(dispatch.source, id) });',
    'Object.defineProperty(dispatch, "external", { value: id, enumerable: true }); bindings.set(dispatch, { key: keyFor(dispatch.source, id) });'],
  ["legacy-boundary", reader, 'if (hasOrchidNativeBindingBoundary(dispatch)) return dispatch;', 'if (false && hasOrchidNativeBindingBoundary(dispatch)) return dispatch;'],
  ["consume-binding", builder, 'resolveOrchidNativeRoot(d, input.runs)?.id ?? d.external', 'resolveOrchidNativeRoot(d, [])?.id ?? d.external'],
  ["binding-revision", builder, 'digest(JSON.stringify({ dispatch: d.revision, binding: external === null ? null : digest(external) }))', 'd.revision'],
  ["complete-native-tree", builder, 'roots.size > 0 && !input.nativeComplete', 'false'],
];
function compile() {
  const result = spawnSync("pnpm", ["exec", "tsc", "-b", "packages/telemetry"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("INCONCLUSIVE: compilation failed");
}
function check() {
  return spawnSync(process.execPath, ["--test", "--test-reporter=tap", test], { encoding: "utf8", timeout: 30_000 });
}
function receipt(label, result) {
  console.log(`${label}: node --test --test-reporter=tap ${test}`);
  console.log(`exit: ${result.status}`);
  // Literal TAP summary/failure lines only. Stack traces and source locations stay private.
  console.log((result.stdout ?? "").split("\n").filter(line => /^\s*not ok |^# (tests|pass|fail) /.test(line)).join("\n"));
}
let failed = false;
try {
  compile();
  const baseline = check(); receipt("baseline", baseline);
  if (baseline.status !== 0) throw new Error("baseline failed");
  for (const [name, file, before, after] of mutations) {
    const source = originals.get(file);
    if (source.split(before).length !== 2) throw new Error("mutation anchor must be unique: " + name);
    writeFileSync(file, source.replace(before, after));
    compile();
    const broken = check(); receipt(name, broken);
    if (broken.status !== 1 || !broken.stdout.includes("ERR_ASSERTION")) throw new Error("mutation did not produce an assertion failure: " + name);
    writeFileSync(file, source);
    compile();
    const restored = check(); receipt(name + " restored", restored);
    if (restored.status !== 0) throw new Error("restored control failed: " + name);
  }
  console.log(`PASS: ${mutations.length} mutations failed assertions and restored controls passed`);
} catch (error) {
  console.log(error.message); failed = true;
} finally {
  for (const [file, source] of originals) writeFileSync(file, source);
  compile();
}
if (failed) process.exitCode = 1;
