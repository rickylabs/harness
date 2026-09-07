import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describeLoadRefusal, loadRoutingConfiguration, parseRoutingDocument, type LoadOutcome } from "./load.js";
import { MAX_DEPTH, MAX_DOCUMENT_BYTES, MAX_MEMBERS, validateRoutingConfiguration, type RoutingConfiguration } from "./schema.js";
import { familyOf, pinnedModels, lanePolicy, maxFallbackDepth, tiers, isDeclaredEffort } from "./configuration.js";
import { admitDispatch, describeAdmission, relayProfiles } from "./admit.js";
import { checkPolicy, resolveFallback, tierPlan, toDispatch } from "./resolve.js";
import { checkEvaluator, type RunIdentity } from "./family.js";

const pathA = fileURLToPath(import.meta.resolve("@rickylabs/routing/config/routing.v1.json"));
const textA = await readFile(pathA, "utf8");
function loaded(outcome: LoadOutcome) { assert.ok(outcome.ok, JSON.stringify(outcome)); return outcome.loaded; }
const A = loaded(parseRoutingDocument(textA, "fixture-a")).configuration;
/** Independent small matrix: no model, family, lane, effort, tier, profile or preset from A. */
function documentB() {
  return {
    schemaVersion: 1, name: "second-project", families: ["alpha", "beta"],
    efforts: { ordered: ["one", "two", "three"], unordered: ["automatic"] },
    purposes: ["implementation", "evaluation"],
    models: { "writer-a": { family: "alpha" }, "reader-b": { family: "beta" }, "relay-c": { family: "beta", approvedRelayEvaluator: true } },
    profiles: ["relay-b"], presets: ["preset-b"],
    lanes: [
      { lane: "assemble", purpose: "implementation", chain: [
        { route: { harness: "codex", transport: "native", model: "writer-a", effort: "one" }, when: [] },
        { route: { harness: "claude", transport: "native", model: "reader-b", effort: "two" }, when: ["model-unavailable"] },
      ] },
      { lane: "inspect", purpose: "evaluation", chain: [
        { route: { harness: "claude", transport: "native", model: "reader-b", effort: "two" }, when: [], certifies: "alpha" },
        { route: { harness: "codex", transport: "native", model: "writer-a", effort: "three" }, when: [], certifies: "beta" },
        { route: { harness: "claude", transport: "openrouter", model: "relay-c", effort: "two", profile: "relay-b", preset: "preset-b" }, when: ["third-opinion"], certifies: "any" },
      ] },
    ],
    tiers: [{ tier: "only", implement: "assemble", review: "inspect" }], constraints: {}, deepResearchLanes: [],
    policy: { maxFallbackDepth: 5 }, placements: { backends: ["lm-studio"], entries: [{ model: "writer-a", backend: "lm-studio", verdict: "runs", why: "synthetic evidence" }] },
  };
}
function config(value: unknown): RoutingConfiguration { const result = validateRoutingConfiguration(value); assert.ok(result.ok, JSON.stringify(result)); return result.configuration; }
const B = config(documentB());
function refused(outcome: LoadOutcome, kind: string, code?: string, path?: string) {
  assert.ok(!outcome.ok); assert.equal(outcome.refusal.kind, kind);
  if (code) {
    if ("code" in outcome.refusal) assert.equal(outcome.refusal.code, code);
    else if ("problems" in outcome.refusal) assert.ok(outcome.refusal.problems.some(p => p.code === code && (!path || ("path" in p ? p.path : p.lane) === path)), JSON.stringify(outcome));
    else assert.fail("refusal has no code");
  }
  return outcome.refusal;
}
function validate(value: unknown): LoadOutcome {
  const result = validateRoutingConfiguration(value);
  return result.ok ? parseRoutingDocument(JSON.stringify(value), "fixture") : result;
}
function frozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen);
}
async function scratch(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "routing-271-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
/** A blocked fs open cannot be cancelled by a Promise timeout. Kill and reap an isolated child. */
function refuseNonFileInChild(path: string, replacement?: string): void {
  const output = execFileSync(process.execPath, ["--input-type=module", "--eval", `
    import assert from "node:assert/strict";
    import fs from "node:fs/promises";
    import { syncBuiltinESMExports } from "node:module";
    const [moduleUrl, path, replacement] = process.argv.slice(1);
    if (replacement) {
      const open = fs.open;
      fs.open = async (...args) => {
        // Replace the ordinary file exactly at open, after any path-based pre-stat.
        if (args[0] === path) await fs.rename(replacement, path);
        return open(...args);
      };
      syncBuiltinESMExports();
    }
    const { loadRoutingConfiguration } = await import(moduleUrl);
    assert.deepEqual(await loadRoutingConfiguration({ path }), {
      ok: false, refusal: { kind: "unreadable", code: "not-a-file" },
    });
    process.stdout.write("non-file refused");
  `, new URL("./load.js", import.meta.url).href, path, ...(replacement ? [replacement] : [])], {
    encoding: "utf8", timeout: 2_000, killSignal: "SIGKILL", maxBuffer: 16_384,
  });
  assert.equal(output, "non-file refused");
}

describe("explicit document loader and identity", () => {
  it("loads the exported data asset with an independent raw-byte digest and freezes every depth", async () => {
    const result = loaded(await loadRoutingConfiguration({ path: pathA }));
    assert.equal(result.source.name, "harness-compiled-table-transcription");
    assert.equal(result.source.schemaVersion, 1);
    assert.equal(result.source.bytes, Buffer.byteLength(textA));
    assert.equal(result.source.digest, `sha256:${createHash("sha256").update(textA).digest("hex")}`);
    assert.deepEqual(checkPolicy(result.configuration), []); frozen(result);
  });
  it("ships and resolves the actual document from an extracted npm package", async () => scratch(async directory => {
    const packageDirectory = fileURLToPath(new URL(".", new URL(import.meta.resolve("@rickylabs/routing/package.json"))));
    const dry = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: packageDirectory, encoding: "utf8" }));
    assert.ok(dry[0].files.some((f: { path: string }) => f.path === "config/routing.v1.json"));
    assert.ok(!dry[0].files.some((f: { path: string }) => /^dist\/(models|policy)\./.test(f.path)), "deleted compiled tables must not survive in the packed asset");
    const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", directory], { cwd: packageDirectory, encoding: "utf8" }));
    const target = join(directory, "node_modules", "@rickylabs", "routing");
    await mkdir(target, { recursive: true });
    execFileSync("tar", ["-xzf", join(directory, packed[0].filename), "--strip-components=1", "-C", target]);
    // Resolve from an isolated consumer, not a workspace symlink; load the resolved packed bytes.
    const script = join(directory, "consumer.mjs");
    await writeFile(script, 'process.stdout.write(import.meta.resolve("@rickylabs/routing/config/routing.v1.json"));');
    const packedPath = fileURLToPath(execFileSync(process.execPath, [script], { cwd: directory, encoding: "utf8" }));
    assert.ok(packedPath.startsWith(target));
    assert.deepEqual(loaded(await loadRoutingConfiguration({ path: packedPath })).configuration, A);
  }));
  it("distinguishes source labels from bytes and delegates file parsing exactly", async () => scratch(async directory => {
    const raw = JSON.stringify(documentB());
    const spaced = raw + " ";
    const first = loaded(parseRoutingDocument(raw, "one"));
    assert.equal(first.source.digest, loaded(parseRoutingDocument(raw, "two")).source.digest);
    const second = loaded(parseRoutingDocument(spaced, "one"));
    assert.deepEqual(first.configuration, second.configuration); assert.notEqual(first.source.digest, second.source.digest);
    const path = join(directory, "document.json"); await writeFile(path, raw);
    assert.deepEqual(await loadRoutingConfiguration({ path }), parseRoutingDocument(raw, path));
  }));
  it("refuses non-string source identifiers without coercion or diagnostic values", () => {
    for (const source of [undefined, null, false, 0, 1n, Symbol("secret-source"), [], {}, new String("secret-source"), () => "secret-source"]) {
      const result = parseRoutingDocument(textA, source as unknown as string);
      assert.deepEqual(result, { ok: false, refusal: { kind: "invalid", problems: [{ code: "wrong-type", path: "source.id" }] } });
      assert.ok(!result.ok);
      assert.equal(describeLoadRefusal(result.refusal), "invalid: wrong-type at source.id");
    }
  });
  it("refuses accessor and proxy source identifiers with zero invocations", () => {
    let calls = 0;
    const accessor = { get secret() { calls++; return "secret-source"; } };
    const coercible = { toString() { calls++; return "secret-source"; }, [Symbol.toPrimitive]() { calls++; return "secret-source"; } };
    const trap = () => { calls++; throw new Error("secret-source"); };
    const proxy = new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap, preventExtensions: trap });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    for (const source of [accessor, coercible, proxy, revoked.proxy]) {
      const result = parseRoutingDocument(textA, source as unknown as string);
      assert.equal(calls, 0);
      assert.deepEqual(result, { ok: false, refusal: { kind: "invalid", problems: [{ code: "wrong-type", path: "source.id" }] } });
      assert.ok(!Object.isFrozen(accessor), "caller data must never reach the freeze operation");
    }
  });
  it("bounds source identifiers by UTF-8 bytes and rejects blanks with fixed diagnostics", () => {
    for (const [source, code] of [
      ["", "empty"], [" \t\n", "empty"], ["\u2003", "empty"],
      ["x".repeat(4097), "size-exceeded"], ["é".repeat(2049), "size-exceeded"],
      ["🔒".repeat(1024) + "a", "size-exceeded"], ["Bearer private-source-" + "x".repeat(4096), "size-exceeded"],
    ]) {
      const result = parseRoutingDocument(textA, source!);
      assert.deepEqual(result, { ok: false, refusal: { kind: "invalid", problems: [{ code, path: "source.id" }] } });
      assert.ok(!result.ok);
      assert.equal(describeLoadRefusal(result.refusal), `invalid: ${code} at source.id`);
    }
  });
  it("preserves valid source identifiers including the byte limit without changing the document digest", () => {
    for (const text of [textA, JSON.stringify(documentB())]) {
      const expected = loaded(parseRoutingDocument(text, "fixture"));
      for (const source of ["project/document.json", "  é/🔒  ", "a".repeat(4096), "é".repeat(2048), "🔒".repeat(1024)]) {
        const actual = loaded(parseRoutingDocument(text, source));
        assert.equal(actual.source.id, source);
        assert.equal(actual.source.digest, `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`);
        assert.equal(actual.source.bytes, Buffer.byteLength(text, "utf8"));
        assert.deepEqual(actual.configuration, expected.configuration);
        frozen(actual);
      }
    }
  });
  it("refuses missing, directory, oversized and non-UTF-8 files without exposing OS diagnostics", async () => scratch(async directory => {
    refused(await loadRoutingConfiguration({ path: join(directory, "absent") }), "unreadable", "absent");
    refused(await loadRoutingConfiguration({ path: directory }), "unreadable", "not-a-file");
    const path = join(directory, "document.json"); await writeFile(path, " ".repeat(MAX_DOCUMENT_BYTES + 1));
    refused(await loadRoutingConfiguration({ path }), "unreadable", "too-large");
    await writeFile(path, Buffer.from([0xc0, 0xaf]));
    refused(await loadRoutingConfiguration({ path }), "malformed", "not-utf8");
  }));
  it("refuses a non-regular FIFO without a writer, directly and through a symlink, before a child deadline", async () => scratch(async directory => {
    const fifo = join(directory, "document.fifo");
    execFileSync("mkfifo", [fifo], { timeout: 2_000, killSignal: "SIGKILL" });
    const link = join(directory, "document-link.json"); await symlink(fifo, link);
    refuseNonFileInChild(fifo);
    refuseNonFileInChild(link);
  }));
  it("refuses a non-regular replacement at open before a child deadline", async () => scratch(async directory => {
    const path = join(directory, "document.json"); await writeFile(path, textA);
    const fifo = join(directory, "replacement.fifo");
    execFileSync("mkfifo", [fifo], { timeout: 2_000, killSignal: "SIGKILL" });
    refuseNonFileInChild(path, fifo);
  }));
  for (const [text, code] of [["{", "not-json"], ["[]", "root-not-object"], ['"root"', "root-not-object"], ["null", "root-not-object"]]) {
    it(`refuses malformed document ${code}`, () => { refused(parseRoutingDocument(text!, "input"), "malformed", code); });
  }
  for (const schemaVersion of [undefined, "1", 2, 1.5]) it(`keeps unsupported version distinct (${String(schemaVersion)})`, () => {
    const result = refused(validate({ ...documentB(), schemaVersion }), schemaVersion === undefined ? "invalid" : "unsupported-schema-version");
    // Missing is JSON absence, not the non-JSON undefined value accepted by this helper's input type.
    if (schemaVersion === undefined) {
      const value: Record<string, unknown> = documentB(); delete value.schemaVersion;
      assert.deepEqual(refused(validate(value), "unsupported-schema-version"), { kind: "unsupported-schema-version", seen: null, supported: [1] });
    } else assert.deepEqual(result, { kind: "unsupported-schema-version", seen: Number.isInteger(schemaVersion) ? schemaVersion : null, supported: [1] });
  });
  it("rejects duplicate JSON model keys, including escaped equivalent names", () => {
    const raw = JSON.stringify(documentB()).replace('"writer-a":{"family":"alpha"}', '"writer-a":{"family":"alpha"},"writer-\\u0061":{"family":"beta"}');
    refused(parseRoutingDocument(raw, "input"), "invalid", "duplicate", "models[1]");
  });
});

describe("strict structural and invariant refusal", () => {
  // Mutations are independent defects of the document, not copies of validator branches.
  const cases: readonly [string, (v: any) => void, string, string][] = [
    ["unknown root", v => { v.extra = 1; }, "unknown-key", "$"],
    ["unknown nested step", v => { v.lanes[0].chain[0].extra = 1; }, "unknown-key", "lanes[0].chain[0]"],
    ["missing lanes", v => { delete v.lanes; }, "missing-key", "lanes"],
    ["empty families", v => { v.families = []; }, "empty", "families"],
    ["duplicate lane", v => { v.lanes.push(v.lanes[0]); }, "duplicate", "lanes[2].lane"],
    ["duplicate tier", v => { v.tiers.push(v.tiers[0]); }, "duplicate", "tiers[1].tier"],
    ["duplicate effort", v => { v.efforts.unordered.push("one"); }, "duplicate", "efforts.unordered[1]"],
    ["model family", v => { v.models["writer-a"].family = "absent"; }, "dangling-reference", "models[0].family"],
    ["unknown model", v => { v.lanes[0].chain[0].route.model = "absent"; }, "dangling-reference", "lanes[0].chain[0].route.model"],
    ["unknown effort", v => { v.lanes[0].chain[0].route.effort = "absent"; }, "dangling-reference", "lanes[0].chain[0].route.effort"],
    ["unknown trigger", v => { v.lanes[0].chain[1].when = ["invented"]; }, "dangling-reference", "lanes[0].chain[1].when[0]"],
    ["unknown certifies", v => { v.lanes[1].chain[0].certifies = "absent"; }, "dangling-reference", "lanes[1].chain[0].certifies"],
    ["unknown tier lane", v => { v.tiers[0].review = "absent"; }, "dangling-reference", "tiers[0].review"],
    ["unknown constraint", v => { v.constraints.absent = { why: "synthetic" }; }, "dangling-reference", "constraints[0]"],
    ["deep research needs native-only", v => { v.deepResearchLanes = ["assemble"]; }, "dangling-reference", "deepResearchLanes[0]"],
    ["negative depth", v => { v.policy.maxFallbackDepth = -1; }, "out-of-range", "policy.maxFallbackDepth"],
    ["fractional depth", v => { v.policy.maxFallbackDepth = 0.5; }, "out-of-range", "policy.maxFallbackDepth"],
    ["false approval", v => { v.models["relay-c"].approvedRelayEvaluator = false; }, "wrong-type", "models[2].approvedRelayEvaluator"],
    ["placement model", v => { v.placements.entries[0].model = "absent"; }, "dangling-reference", "placements.entries[0].model"],
    ["undeclared backend", v => { v.placements.entries[0].backend = "absent"; }, "dangling-reference", "placements.entries[0].backend"],
    ["duplicate placement", v => { v.placements.entries.push(v.placements.entries[0]); }, "duplicate", "placements.entries[1]"],
    ["placement totality", v => { v.placements.backends.push("new-backend"); }, "dangling-reference", "placements.entries"],
    ["reserved family", v => { v.families.push("any"); }, "reserved-name", "families[2]"],
    ["reserved none", v => { v.families.push("none"); }, "reserved-name", "families[2]"],
  ];
  for (const [name, change, code, path] of cases) it(name, () => { const v = documentB(); change(v); refused(validate(v), "invalid", code, path); });
  const invariants: readonly [string, (v: any) => void, string][] = [
    ["self certification", v => { v.lanes[1].chain[0].route.model = "writer-a"; }, "self-certifies"],
    ["missing certification", v => { delete v.lanes[1].chain[0].certifies; }, "evaluation-without-certifies"],
    ["implementation certification", v => { v.lanes[0].chain[0].certifies = "beta"; }, "certifies-outside-evaluation"],
    ["unreviewed fallback", v => { v.lanes[1].chain.splice(1); }, "unreviewed-step"],
    ["relay approval", v => { delete v.models["relay-c"].approvedRelayEvaluator; }, "relay-evaluator-unapproved"],
    ["escalation not raised", v => { v.lanes[0].chain[0].effortEscalations = [{ condition: "large", effort: "one" }]; }, "escalation-not-raising"],
    ["escalation unordered", v => { v.lanes[0].chain[0].effortEscalations = [{ condition: "large", effort: "automatic" }]; }, "escalation-not-comparable"],
    ["first step fallback", v => { v.lanes[0].chain[0].when = ["token-limit"]; }, "first-step-not-primary"],
    ["duplicate primary", v => { v.lanes[0].chain[1].when = []; }, "duplicate-primary"],
    ["router required", v => { v.lanes[0].chain[0].route.harness = "opencode"; }, "opencode-without-router"],
    ["router forbidden", v => { v.lanes[0].chain[0].route.router = "openrouter"; }, "router-outside-opencode"],
    ["relay profile required", v => { delete v.lanes[1].chain[2].route.profile; }, "relay-without-profile"],
    ["constraint violated", v => { v.constraints.assemble = { why: "synthetic", models: ["relay-c"] }; }, "constraint-violated"],
  ];
  for (const [name, change, code] of invariants) it(name, () => { const v = documentB(); change(v); refused(validate(v), "invariant", code); });
  it("collects independent structural defects", () => {
    const v: any = documentB(); v.extra = true; v.policy.maxFallbackDepth = -1; v.lanes[0].chain[0].extra = 1;
    const result = refused(validate(v), "invalid"); assert.ok("problems" in result); assert.equal(result.problems.length, 3);
  });
  it("allows no placements and backend names that are opaque at the routing boundary", () => {
    config({ ...documentB(), placements: { backends: [], entries: [] } });
    const v = documentB(); v.placements.backends = ["future-backend"]; v.placements.entries[0]!.backend = "future-backend"; config(v);
  });
});

describe("hostile input and diagnostics", () => {
  it("enforces bytes, depth and collections before structural checks", () => {
    refused(parseRoutingDocument(" ".repeat(MAX_DOCUMENT_BYTES + 1), "secret-source"), "invalid", "size-exceeded");
    refused(parseRoutingDocument("[".repeat(MAX_DEPTH + 2) + "0" + "]".repeat(MAX_DEPTH + 2), "source"), "invalid", "depth-exceeded");
    refused(validate({ unrelated: Array(MAX_MEMBERS + 1).fill(0) }), "invalid", "size-exceeded");
    refused(validate(Object.fromEntries(Array.from({ length: MAX_MEMBERS + 1 }, (_, i) => [i, 0]))), "invalid", "size-exceeded");
  });
  it("never invokes accessors or proxy traps, and refuses cycles, holes and prototype tricks", () => {
    let calls = 0;
    const getter = { get unknown() { calls++; return "value"; } };
    const cycle: any = {}; cycle.next = cycle;
    const proxy = new Proxy({}, { getPrototypeOf() { calls++; throw new Error("trap"); }, ownKeys() { calls++; return []; } });
    for (const v of [getter, cycle, proxy, new Map(), new (class Data {})(), Array(2), Object.assign([], { extra: true })]) refused(validate(v), "invalid", "not-plain-data");
    for (const key of ["__proto__", "constructor", "prototype"]) refused(parseRoutingDocument(`{"${key}":{}}`, "source"), "invalid", "reserved-name");
    assert.equal(calls, 0);
  });
  it("does not copy credential canaries, keys, paths, notes or parser exceptions into diagnostics", async () => scratch(async directory => {
    const canaries = ["sk-or-v1-" + "a".repeat(48), "Bearer " + "b".repeat(40), "-----BEGIN PRIVATE KEY-----"];
    const source = "private-source-canary";
    for (const secret of canaries) {
      const changes: ((v: any) => void)[] = [v => { v[secret] = 1; }, v => { v.lanes[0].lane = secret; },
        v => { v.lanes[0].chain[0].route.model = secret; }, v => { v.lanes[0].chain[0].note = secret; v.policy.maxFallbackDepth = -1; },
        v => { v.placements.entries[0].why = secret; v.lanes[1].chain[0].certifies = "beta"; }];
      const outcomes: LoadOutcome[] = [parseRoutingDocument('{"tail":' + secret, source), await loadRoutingConfiguration({ path: join(directory, encodeURIComponent(secret)) })];
      for (const change of changes) { const v = documentB(); change(v); outcomes.push(parseRoutingDocument(JSON.stringify(v), source)); }
      for (const outcome of outcomes) {
        assert.ok(!outcome.ok); const diagnostic = JSON.stringify(outcome.refusal) + describeLoadRefusal(outcome.refusal);
        for (const forbidden of [...canaries, source, "SyntaxError", "ENOENT", "EISDIR"]) assert.ok(!diagnostic.includes(forbidden), diagnostic);
      }
    }
  }));
});

describe("whole replacement, project isolation and mutation resistance", () => {
  for (const [from, to] of [[A, B], [B, A]] as const) it(`rejects every route and vocabulary from ${from.name} in ${to.name}`, () => {
    for (const model of pinnedModels(from)) assert.equal(familyOf(to, model), null);
    for (const lane of from.lanes) {
      assert.equal(lanePolicy(to, lane.lane), null);
      for (const step of lane.chain) {
        const result = admitDispatch(to, { ...toDispatch(from, step.route), prompt: "synthetic" }, { lane: lane.lane });
        assert.ok(!result.ok); assert.ok(result.problems.some(p => p.reason === "unknown-model"));
        for (const p of result.problems) for (const expected of p.expected ?? []) assert.ok(!pinnedModels(from).includes(expected) && !from.lanes.some(l => l.lane === expected));
      }
    }
    for (const tier of tiers(from)) assert.equal(tierPlan(to, tier), null);
    for (const effort of [...from.efforts.ordered, ...from.efforts.unordered ?? []]) assert.equal(isDeclaredEffort(to, effort), false);
    for (const profile of relayProfiles(from)) assert.ok(!relayProfiles(to).includes(profile));
  });
  it("uses the selected fallback depth and derives reviewer family from the implementation primary", () => {
    assert.equal(maxFallbackDepth(A), 2); assert.equal(maxFallbackDepth(B), 5);
    assert.ok(resolveFallback(B, { lane: "assemble", trigger: "model-unavailable", from: 0, depth: 4, atTurnBoundary: true }).ok);
    assert.deepEqual(resolveFallback(B, { lane: "assemble", trigger: "model-unavailable", from: 0, depth: 5, atTurnBoundary: true }), { ok: false, reason: "depth-exceeded" });
    assert.equal(tierPlan(B, "only")?.review.step.route.model, "reader-b");
    const v = documentB(); v.lanes[0]!.chain[0]!.route.model = "reader-b";
    assert.equal(tierPlan(config(v), "only")?.review.step.route.model, "writer-a");
  });
  it("keeps configuration and admission answers detached, recursively frozen and independent of load order", () => {
    const v = documentB(); const held = config(v);
    const dispatch = { ...toDispatch(held, held.lanes[0]!.chain[0]!.route), prompt: "synthetic" };
    const before = describeAdmission(admitDispatch(held, dispatch, { lane: "assemble" }));
    v.models["writer-a"].family = "beta"; v.policy.maxFallbackDepth = 0; v.lanes[0]!.chain[0]!.route.model = "changed";
    assert.equal(familyOf(held, "writer-a"), "alpha"); assert.equal(maxFallbackDepth(held), 5);
    assert.throws(() => { (held.lanes[0]!.chain[0]!.route as any).model = "changed"; }, TypeError);
    assert.throws(() => { (held.families as string[]).push("changed"); }, TypeError);
    assert.throws(() => { (held.placements.entries[0] as any).model = "changed"; }, TypeError);
    for (const text of [textA, JSON.stringify(documentB()), textA]) {
      loaded(parseRoutingDocument(text, "another"));
      assert.equal(describeAdmission(admitDispatch(held, dispatch, { lane: "assemble" })), before);
    }
    assert.deepEqual(A, loaded(parseRoutingDocument(textA, "again")).configuration);
  });
  it("enforces evaluator identity with arbitrary families and refuses same-family certifies:any", () => {
    const author: RunIdentity = { runId: "author", seam: "llm", model: "writer-a", transport: "native" };
    const reviewer: RunIdentity = { runId: "reviewer", seam: "subagents", harness: "claude", model: "reader-b", transport: "native" };
    assert.deepEqual(checkEvaluator(B, { author, evaluator: reviewer }), { ok: true, authorFamily: "alpha", evaluatorFamily: "beta" });
    assert.equal(checkEvaluator(B, { author, evaluator: { ...reviewer, model: "writer-a" }, certifies: "any" }).ok, false);
    for (const [assignment, reason] of [
      [{ author, evaluator: { ...reviewer, runId: "author" } }, "same-run"],
      [{ author, evaluator: { ...reviewer, model: "writer-a" }, certifies: "any" }, "same-family"],
      [{ author, evaluator: reviewer, certifies: "none" }, "not-a-gate"],
      [{ author, evaluator: reviewer, certifies: "beta" }, "wrong-author-family"],
      [{ author, evaluator: { ...reviewer, model: "absent" } }, "unpinned-model"],
      [{ author, evaluator: { ...reviewer, transport: "openrouter" } }, "unapproved-open-evaluator"],
    ] as const) { const result = checkEvaluator(B, assignment); assert.ok(!result.ok); assert.equal(result.reason, reason); }
  });
});

it("keeps configured credential-shaped names out of admission diagnostics too", () => {
  const secret = "sk-or-v1-" + "c".repeat(48);
  const raw = JSON.stringify(documentB()).replaceAll("writer-a", secret);
  const configured = loaded(parseRoutingDocument(raw, "private-source")).configuration;
  const admission = admitDispatch(configured, { harness: "codex", model: "unknown", effort: "one", prompt: "synthetic" }, { lane: "assemble" });
  assert.ok(!admission.ok);
  assert.ok(!JSON.stringify(admission).includes(secret)); assert.ok(!describeAdmission(admission).includes(secret));
});
it("allows the nesting boundary but rejects exactly one additional level before schema checks", () => {
  let nested: unknown = "leaf";
  for (let i = 0; i < MAX_DEPTH; i++) nested = { value: nested };
  refused(validate(nested), "unsupported-schema-version");
  refused(validate({ value: nested }), "invalid", "depth-exceeded");
});
