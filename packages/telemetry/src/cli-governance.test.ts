/** Live governance sources and the published one-shot `governance` command, driven end to end. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareRouteIdentity } from "@rickylabs/subagents";
import { readGovernanceSnapshot } from "@rickylabs/harness-contracts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT } from "./cli.js";
import { parseFlags } from "./cli-flags.js";
import { collectGovernance, readSourceText, runUsageProbe, usageCommand, type SourceServices } from "./governance/collect.js";
import { parseSource, SPEND_URL, SourceError } from "./source.js";
import { livePath, resolveObservability } from "./observability.js";
import { admissionEvent, cliProcess, emptyLog, fakeServices, filesBelow, governanceFixture, home, LIVE_NOW, liveDescriptor,
  PRIVATE_CANARY, run, seedLive, SPEND_CANARY, USAGE_CANARY, usagePayload, useTemporaryHome } from "./cli-test-support.js";

useTemporaryHome();

describe("live governance CLI and services", () => {
  it("TA (0.28.0): the descriptor key is optional; a configured source names one absolute path", () => {
    assert.equal(parseSource(liveDescriptor()).transportAvailability, null);
    assert.equal(parseSource({ ...liveDescriptor(), transportAvailability: null }).transportAvailability, null);
    assert.deepEqual(parseSource({ ...liveDescriptor(), transportAvailability: { path: "/fixture/governance/transport-availability.json" } })
      .transportAvailability, { path: "/fixture/governance/transport-availability.json" });
    for (const bad of [{ path: "relative.json" }, { path: "/fixture/x.json", extra: 1 }, {}, "path", 1]) {
      assert.throws(() => parseSource({ ...liveDescriptor(), transportAvailability: bad }));
    }
  });
  it("pins the env-only permission vector and minimizes child environment; no credential argv", async () => {
    const config = parseSource(liveDescriptor()).usage!;
    const command = usageCommand(config, USAGE_CANARY);
    assert.deepEqual(command.args.slice(0, 6), ["run", "--no-config", "--no-lock", "--no-prompt", "--no-remote", "--no-code-cache"]);
    assert.deepEqual(command.args.filter(a => a.startsWith("--allow-")), ["--allow-env=USAGE_API_KEY", "--allow-net=opencode.ai"]);
    assert.deepEqual(Object.keys(command.env).sort(), ["DENO_DIR", "DENO_NO_UPDATE_CHECK", "USAGE_API_KEY"]);
    assert.equal(command.env.DENO_DIR, "/dev/null");
    assert.equal(command.env.USAGE_API_KEY, USAGE_CANARY);
    assert.doesNotMatch(JSON.stringify(command.args), /secret-canary|--now|--allow-read|--allow-write|--allow-run/);
    const probe = await readFile(fileURLToPath(new URL("../adapters/opencode-usage-probe.ts", import.meta.url)), "utf8");
    assert.match(probe, /from "harness:usage"/);
    assert.match(probe, /from "harness:usage-validity"/);
    assert.match(probe, /readTextFile: denied/);
    assert.match(probe, /stat: denied/);
    assert.match(probe, /validForMs: EXPENSE_SNAPSHOT_MAX_AGE_MS/);
    assert.doesNotMatch(probe, /Deno\.env\.toObject|reserveCopilotCredits|--now/);
  });
  it("isolates each service failure and exposes incomplete evidence without leaking credentials or exceptions", async () => {
    const source = parseSource(liveDescriptor());
    let calls = 0;
    const services = fakeServices({ usage: async command => {
      assert.equal(command.env.USAGE_API_KEY, USAGE_CANARY);
      assert.doesNotMatch(JSON.stringify(command.args), /secret-canary/);
      throw new Error(PRIVATE_CANARY + USAGE_CANARY);
    }, fetch: async (url, init) => {
      calls++;
      assert.equal(url, SPEND_URL);
      assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${SPEND_CANARY}`);
      return new Response(JSON.stringify({ data: { usage_monthly: 2, byok_usage_monthly: 20, label: PRIVATE_CANARY } }));
    } });
    const result = await collectGovernance(source, emptyLog, services);
    assert.equal(calls, 1);
    assert.equal(result.observed.ok, false);
    assert.equal(result.observed.governance.availability, "fresh");
    assert.match(JSON.stringify(result), /"spentUsd":2/);
    assert.match(JSON.stringify(result), /"ramUsedBytes":1024/);
    assert.doesNotMatch(JSON.stringify(result), /secret-canary|private-project/);
    const failedCapacity = await collectGovernance(source, emptyLog, fakeServices({ readText: async () => { throw new Error(PRIVATE_CANARY); } }));
    assert.equal(failedCapacity.observed.ok, false);
    assert.match(JSON.stringify(failedCapacity), /"usedPercent":42/);
    assert.match(failedCapacity.observed.notes.join(" "), /capacity: cgroup-unreadable/);
  });
  it("missing env bindings perform no service call and preserve the capacity leg", async () => {
    let called = false;
    const services = fakeServices({ env: {}, usage: async () => { called = true; throw new Error(); }, fetch: async () => { called = true; throw new Error(); } });
    const result = await collectGovernance(parseSource(liveDescriptor()), emptyLog, services);
    assert.equal(called, false);
    assert.equal(result.observed.ok, false);
    assert.match(result.observed.notes.join(" "), /usage: credential-unbound/);
    assert.match(result.observed.notes.join(" "), /spend: credential-unbound/);
    assert.match(JSON.stringify(result), /"ramUsedBytes":1024/);
  });
  it("spend refuses non-JSON, HTTP failure, oversized streaming bodies and timed-out responses", async () => {
    for (const [fetcher, reason] of [
      [async () => new Response("not-json"), "non-json"],
      [async () => new Response("private", { status: 401 }), "request-failed"],
      [async () => new Response("x".repeat(4097)), "oversize"],
      [async () => new Promise<Response>(() => {}), "timeout"],
      [async () => new Response(new ReadableStream({ start() {} })), "timeout"],
    ] as const) {
      const source = parseSource({ ...liveDescriptor(), spend: { ...liveDescriptor().spend, timeoutMs: 5 } });
      const result = await collectGovernance(source, emptyLog, fakeServices({ fetch: fetcher }));
      assert.equal(result.observed.ok, false);
      assert.match(result.observed.notes.join(" "), new RegExp(`spend: ${reason}`));
      assert.match(JSON.stringify(result), /"usedPercent":42/);
    }
  });
  it("takes completion after every successful read, rejects expired/future leaves, and never passes evaluation time to the probe", async () => {
    const stamps = ["2026-09-07T12:00:01Z", "2026-09-07T12:00:02Z", "2026-09-07T12:00:03Z"];
    const result = await collectGovernance(parseSource(liveDescriptor()), emptyLog, fakeServices({ clock: () => stamps.shift()!, usage: async command => {
      assert.doesNotMatch(JSON.stringify(command.args), /--now|13:00/);
      return usagePayload();
    } }), "2026-09-07T13:00:00Z");
    assert.equal(result.completion, "2026-09-07T12:00:03Z");
    assert.equal(result.observed.governance.availability, "stale");
    assert.match(JSON.stringify(result), /2026-09-07T12:00:00.000Z/);
    for (const capturedAt of ["2026-09-07T11:00:00Z", "2026-09-07T12:00:01Z"]) {
      const result = await collectGovernance(parseSource(liveDescriptor()), emptyLog, fakeServices({ usage: async () => usagePayload(capturedAt) }));
      assert.equal(result.observed.ok, false);
      assert.doesNotMatch(JSON.stringify(result), /"usedPercent"/);
      assert.match(JSON.stringify(result), /"spentUsd":2/);
    }
  });
  it("real CLI file: compatibility, refresh and all-unconfigured completeness are deterministic and read-only", async () => {
    const file = join(home, "observations.json");
    await writeFile(file, JSON.stringify(governanceFixture()));
    const args = ["status", "--home", home, "--now", "2026-09-07T12:00:00Z", "--json"];
    const before = await filesBelow(home);
    const old = await cliProcess([...args, "--observations", file]);
    const alias = await cliProcess([...args, "--observations-from", `file:${file}`]);
    assert.equal(alias.code, 0);
    assert.deepEqual(alias, old);
    assert.deepEqual(await filesBelow(home), before);
    await writeFile(file, JSON.stringify(governanceFixture(21)));
    const refreshed = await cliProcess([...args, "--observations-from", `file:${file}`]);
    assert.equal(refreshed.code, 0);
    assert.match(refreshed.out, /"usedPercent": 21/);
    const config = await seedLive({ accountLabel: "synthetic", usage: null, spend: null, capacity: null, admissions: null });
    const unconfigured = await cliProcess([...args, "--observations-from", config]);
    assert.equal(unconfigured.code, 3);
    assert.equal(JSON.parse(unconfigured.out).complete, false);
    assert.match(unconfigured.out, /unavailable/);
  });
  it("real writer-to-reader CLI path consumes synthetic admissions with injected services and no observation writes", async () => {
    const path = await seedLive();
    const recorded = await cliProcess(["record", "--home", home, "--json"], JSON.stringify(admissionEvent()) + "\n");
    assert.equal(recorded.code, 0);
    const before = await filesBelow(home);
    const cliUrl = new URL("./cli.js", import.meta.url).href;
    const collectUrl = new URL("./governance/collect.js", import.meta.url).href;
    const program = `import {main} from ${JSON.stringify(cliUrl)}; import {defaultSourceServices} from ${JSON.stringify(collectUrl)};
      const services = {...defaultSourceServices(), env: {USAGE_API_KEY: "${USAGE_CANARY}", SPEND_API_KEY: "${SPEND_CANARY}"},
        clock: () => "${LIVE_NOW}", usage: async () => (${JSON.stringify(usagePayload())}),
        fetch: async () => new Response(JSON.stringify({data: {usage_monthly: 2, label: "${PRIVATE_CANARY}"}}))};
      process.exitCode = await main(process.argv.slice(1), services);`;
    for (const command of ["status", "tree"]) {
      for (const json of [[], ["--json"]]) {
        const result = await cliProcess([command, "--home", home, "--observations-from", path, ...json], "", program);
        assert.equal(result.code, 0, result.err + result.out);
        assert.doesNotMatch(result.out + result.err, /secret-canary|private-project-session|fixture\/model/);
        assert.match(result.out, /quota-paced/);
        assert.match(result.out, /reader:recorded-admission/);
        if (json.length > 0) {
          assert.equal(JSON.parse(result.out).complete, true);
          assert.match(result.out, /"ramTotalBytes": null/);
          assert.match(result.out, /"ramUsedBytes": 1024/);
        } else assert.match(result.out, /total unknown · headroom unknown/);
      }
    }
    assert.deepEqual(await filesBelow(home), before);
    // The writer can supply envelope time, but it must never invent missing detail time.
    const malformedNewest = admissionEvent();
    const { observedAt: _omitted, ...invalidDetail } = malformedNewest.detail;
    const appended = await cliProcess(["record", "--home", home], JSON.stringify({ ...malformedNewest, detail: invalidDetail }) + "\n");
    assert.equal(appended.code, 0);
    const afterAppend = await filesBelow(home);
    const invalid = await cliProcess(["status", "--home", home, "--observations-from", path, "--json"], "", program);
    assert.equal(invalid.code, 3);
    assert.equal(JSON.parse(invalid.out).complete, false);
    assert.match(invalid.out, /shape-mismatch/);
    assert.doesNotMatch(invalid.out, /quota-paced|private-project-session/);
    assert.deepEqual(await filesBelow(home), afterAppend);
  });
  it("real CLI keeps successful capacity when credentials and admissions are unavailable; invalid source is usage error", async () => {
    const path = await seedLive();
    const before = await filesBelow(home);
    const result = await cliProcess(["status", "--home", home, "--observations-from", path, "--json"]);
    assert.equal(result.code, 3);
    assert.equal(JSON.parse(result.out).complete, false);
    assert.match(result.out, /"ramUsedBytes": 1024/);
    assert.match(result.out, /credential-unbound/);
    assert.deepEqual(await filesBelow(home), before);
    await writeFile(join(home, "cgroup", "memory.current"), "2048\n");
    const refreshedBefore = await filesBelow(home);
    const refreshed = await cliProcess(["status", "--home", home, "--observations-from", path, "--json"]);
    assert.equal(refreshed.code, 3);
    assert.match(refreshed.out, /"ramUsedBytes": 2048/);
    assert.ok(Date.parse(JSON.parse(refreshed.out).generatedAt) > Date.parse(JSON.parse(result.out).generatedAt));
    assert.deepEqual(await filesBelow(home), refreshedBefore);
    await writeFile(path, JSON.stringify({ ...liveDescriptor(), spend: { ...liveDescriptor().spend, url: "https://private-canary.invalid" } }));
    const invalid = await cliProcess(["status", "--home", home, "--observations-from", path]);
    assert.equal(invalid.code, 2);
    assert.equal(invalid.out, "governance source: invalid-descriptor\n");
    assert.throws(() => parseFlags(["status", "--observations", path, "--observations-from", path]), /mutually exclusive/);
    assert.throws(() => parseFlags(["runs", "--observations-from", path]), /requires governance, tree or status/);
  });
  it("bounds regular file reads and real subprocess output, timeout, stderr and malformed output without Deno", async () => {
    const path = join(home, "bounded.json");
    await writeFile(path, "12345");
    await assert.rejects(readSourceText(path, 4), (e: unknown) => e instanceof SourceError && e.code === "oversize");
    assert.equal(await readSourceText(path, 5), "12345");
    const command = { bin: process.execPath, args: ["-e", "process.stderr.write('private-canary');process.stdout.write('{}')"], env: { HOME: home }, timeoutMs: 2000, maxBytes: 1024 };
    assert.deepEqual(await runUsageProbe(command), {});
    for (const [script, code] of [["process.stdout.write('x'.repeat(1025))", "oversize"], ["process.stdout.write('x')", "non-json"], ["process.exitCode=3", "spawn-failed"]]) {
      await assert.rejects(runUsageProbe({ ...command, args: ["-e", script!] }), (e: unknown) => e instanceof SourceError && e.code === code);
    }
    await assert.rejects(runUsageProbe({ ...command, args: ["-e", "setInterval(()=>{}, 1000)"], timeoutMs: 30 }), (e: unknown) => e instanceof SourceError && e.code === "timeout");
    await assert.rejects(runUsageProbe({ ...command, bin: join(home, "absent") }), (e: unknown) => e instanceof SourceError && e.code === "spawn-failed");
  });
});

describe("published governance one-shot command", () => {
  async function invoke(descriptor: unknown, overrides: Partial<SourceServices> = {}, extra: string[] = []) {
    const path = join(home, "source.json");
    const services = fakeServices({ ...overrides, readText: async (file, cap) => file === path
      ? JSON.stringify(descriptor) : overrides.readText ? overrides.readText(file, cap) : file.endsWith("memory.current") ? "1024" : "4096" });
    return run(["governance", "--home", home, "--observations-from", path, ...extra], services);
  }
  async function admissions(events: unknown[]) {
    const file = livePath(resolveObservability(home, {}));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, events.map(e => JSON.stringify(e)).join("\n") + "\n");
  }
  it("T1/T2 emits one decodable mixed-timeout document with no private source bytes", async () => {
    const d = liveDescriptor();
    d.capacity.scopeLabel = "synthetic-cgroup";
    const e = admissionEvent(); e.detail.item.number = 7;
    await admissions([e]);
    const { code, out } = await invoke({ ...d, spend: null }, { usage: async () => { throw new SourceError("timeout"); } });
    assert.equal(code, EXIT.incomplete); assert.ok(out.endsWith("\n"));
    const read = readGovernanceSnapshot(JSON.parse(out)); assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.deepEqual(read.snapshot.sources.usage, { status: "failed", reason: "timeout" });
    assert.equal(read.snapshot.sources.capacity.status, "read");
    assert.equal(read.snapshot.admissions[0]?.item, 7);
    assert.equal(read.snapshot.admissions[0]?.accepted, false);
    for (const canary of [USAGE_CANARY, SPEND_CANARY, PRIVATE_CANARY, d.usage.denoBin, d.usage.model, d.usage.credentialEnv, d.capacity.cgroupRoot]) assert.ok(!out.includes(canary));
    assert.ok(!out.includes('"detail"'));
    assert.equal(out, await readFile(new URL("../../contracts/test-fixtures/governance-read/mixed-timeout.json", import.meta.url), "utf8"));
  });
  // The exact bytes divybot's transport_availability.go writes (Go json.Marshal, millisecond UTC).
  const DIVYBOT_SNAPSHOT = '{"schemaVersion":1,"observedAt":"2026-09-07T11:59:50.000Z","validUntil":"2026-09-07T12:00:50.000Z",' +
    '"transports":[{"transport":"claude","available":false,"reason":"weekly-ceiling"},{"transport":"codex","available":true,"reason":null},' +
    '{"transport":"agy","available":false,"reason":"no-capacity"}]}';
  it("TA (0.28.0): divybot's snapshot, configured in the descriptor, becomes the installed-format document", async () => {
    const d = liveDescriptor();
    d.capacity.scopeLabel = "synthetic-cgroup";
    const e = admissionEvent(); e.detail.item.number = 7;
    await admissions([e]);
    const snapshotPath = join(home, "governance", "transport-availability.json");
    const reads: string[] = [];
    const { code, out } = await invoke({ ...d, spend: null, transportAvailability: { path: snapshotPath } }, {
      usage: async () => { throw new SourceError("timeout"); },
      readPrivateText: async file => { reads.push(file); return DIVYBOT_SNAPSHOT; } });
    assert.equal(code, EXIT.incomplete);
    assert.deepEqual(reads, [snapshotPath]);
    assert.ok(!out.includes(snapshotPath));
    assert.equal(out, await readFile(new URL("../../contracts/test-fixtures/governance-read/transport-availability.json", import.meta.url), "utf8"));
  });
  it("TA (0.31.0): four-row dispatcher capacity survives the complete served reader path", async () => {
    const d = liveDescriptor();
    d.capacity.scopeLabel = "synthetic-cgroup";
    const e = admissionEvent(); e.detail.item.number = 7;
    await admissions([e]);
    const snapshot = JSON.parse(DIVYBOT_SNAPSHOT);
    snapshot.transports.push({ transport: "opencode", available: true, reason: null });
    const snapshotPath = join(home, "governance", "transport-availability.json");
    const { code, out } = await invoke({ ...d, spend: null, transportAvailability: { path: snapshotPath } }, {
      usage: async () => { throw new SourceError("timeout"); },
      readPrivateText: async () => JSON.stringify(snapshot) });
    assert.equal(code, EXIT.incomplete);
    const expected = JSON.parse(await readFile(new URL("../../contracts/test-fixtures/governance-read/transport-availability.json", import.meta.url), "utf8"));
    expected.transportAvailability.transports.push({ transport: "opencode", available: true, reason: null });
    assert.deepEqual(JSON.parse(out), expected);
    assert.ok(!out.includes(snapshotPath));
  });
  it("TA (0.28.0): an unreadable or malformed snapshot is failed coverage and an incomplete document; unconfigured adds no keys", async () => {
    // Complete on its own (T4/BI2), so only the transport availability source can make it incomplete.
    const d = { ...liveDescriptor(), admissions: null };
    const good = await invoke({ ...d, transportAvailability: { path: join(home, "ok.json") } },
      { readPrivateText: async () => DIVYBOT_SNAPSHOT.replace("12:00:50.000Z", "12:10:00.000Z") });
    assert.equal(good.code, EXIT.ok);
    assert.equal(JSON.parse(good.out).complete, true);
    assert.equal(JSON.parse(good.out).sources.transportAvailability.status, "read");
    for (const [read, reason] of [
      [async () => { throw new SourceError("file-unreadable"); }, "file-unreadable"],
      [async () => "{not json", "non-json"],
      [async () => DIVYBOT_SNAPSHOT.replace('"reason":null', '"reason":"no-capacity"'), "shape-mismatch"],
      [async () => { throw new Error("PRIVATE_CANARY"); }, "file-unreadable"],
    ] as const) {
      const { code, out } = await invoke({ ...d, transportAvailability: { path: join(home, "absent.json") } }, { readPrivateText: read });
      assert.equal(code, EXIT.incomplete);
      const document = JSON.parse(out);
      assert.deepEqual(document.sources.transportAvailability, { status: "failed", reason });
      assert.equal(document.transportAvailability, null);
      assert.equal(document.complete, false);
      assert.ok(document.notes.includes(`transportAvailability: ${reason}`));
      assert.equal(readGovernanceSnapshot(document).ok, true);
      assert.ok(!out.includes("PRIVATE_CANARY"));
    }
    // A snapshot past its validity is discarded, not shown.
    const stale = await invoke({ ...d, transportAvailability: { path: join(home, "stale.json") } },
      { readPrivateText: async () => DIVYBOT_SNAPSHOT.replace("12:00:50.000Z", "11:59:55.000Z") });
    assert.deepEqual(JSON.parse(stale.out).sources.transportAvailability, { status: "discarded", reason: "stale-source" });
    const unconfigured = JSON.parse((await invoke(d)).out);
    assert.ok(!Object.hasOwn(unconfigured, "transportAvailability") && !Object.hasOwn(unconfigured.sources, "transportAvailability"));
  });
  it("T3 rejects every unsupported flag and malformed time before source effects", async () => {
    let calls = 0;
    const effect = async (): Promise<never> => { calls++; throw new Error("must not run"); };
    const services = fakeServices({ readText: effect, usage: effect, fetch: effect });
    const base = ["governance", "--observations-from", join(home, "descriptor")];
    for (const args of [
      ["governance"], ["governance", "--observations-from", `file:${home}/file`],
      ...["--observations", "--items", "--run", "--kind", "--since"].map(flag => [...base, flag, LIVE_NOW]),
      [...base, "--limit", "500"], [...base, "--unknown"], [...base, "positional"],
      [...base, "--now", "2026-02-30T00:00:00Z"], [...base, "--now", "PRIVATE_CANARY"],
    ]) { const result = await run(args, services); assert.equal(result.code, EXIT.usage); assert.equal(result.out, ""); }
    assert.equal(calls, 0);
  });
  it("T4 and BI2 preserve all-unconfigured and complete without admissions", async () => {
    const none = { ...liveDescriptor(), usage: null, spend: null, capacity: null, admissions: null };
    const result = await invoke(none); assert.equal(result.code, EXIT.incomplete);
    assert.equal(JSON.parse(result.out).unavailableReason, "not-configured");
    const complete = await invoke({ ...liveDescriptor(), admissions: null });
    assert.equal(complete.code, EXIT.ok); assert.equal(JSON.parse(complete.out).complete, true);
    assert.equal(readGovernanceSnapshot(JSON.parse(complete.out)).ok, true);
    const fixture = await readFile(new URL("../../contracts/test-fixtures/governance-read/unavailable-not-configured.json", import.meta.url), "utf8");
    assert.equal(result.out, fixture);
  });
  it("T5–T8 expose unbound, degraded, conflicting, stale and invalid envelope outcomes", async () => {
    const d = liveDescriptor();
    const unbound = await invoke(d, { env: {} });
    assert.equal(JSON.parse(unbound.out).sources.usage.reason, "credential-unbound");
    const file = livePath(resolveObservability(home, {})); await mkdir(dirname(file), { recursive: true });
    await writeFile(file, "invalid-json\n");
    const degraded = await invoke(d); assert.equal(degraded.code, EXIT.incomplete);
    assert.deepEqual(JSON.parse(degraded.out).sources.admissions, { status: "failed", reason: "log-unreadable" });
    const e = admissionEvent(), other = admissionEvent(); other.detail.state = "pause";
    await admissions([e, other]);
    const conflict = await invoke(d); assert.equal(conflict.code, EXIT.incomplete);
    assert.deepEqual(JSON.parse(conflict.out).sources.admissions.dropped, ["admission-conflict"]);
    await admissions([e]);
    const stale = await invoke(d, {}, ["--now", "2026-09-07T13:00:00Z"]);
    assert.equal(JSON.parse(stale.out).availability, "stale");
    assert.equal(JSON.parse(stale.out).admissions[0].freshness, "stale");
    const future = await invoke(d, {}, ["--now", "2026-09-07T11:00:00Z"]);
    assert.equal(future.code, EXIT.incomplete); assert.equal(JSON.parse(future.out).unavailableReason, "envelope-invalid");
  });
  it("BI9 refuses over-cap evidence with exit 1 and no stdout", async () => {
    await admissions(Array.from({ length: 1001 }, (_, i) => { const e = admissionEvent(); e.detail.item.number = i + 1; return e; }));
    const result = await invoke(liveDescriptor()); assert.equal(result.code, EXIT.failed); assert.equal(result.out, "");
  });
  it("governance scans no transcripts: actual CLI succeeds with a regular file as home", async () => {
    const path = await seedLive({ ...liveDescriptor(), usage: null, spend: null, admissions: null });
    const fakeHome = join(home, "not-a-home"); await writeFile(fakeHome, "synthetic");
    const result = await cliProcess(["governance", "--home", fakeHome, "--observations-from", path]);
    assert.equal(result.code, EXIT.ok); assert.equal(result.err, "");
    assert.equal(readGovernanceSnapshot(JSON.parse(result.out)).ok, true);
  });
});

it("runs --json exposes the dispatch route and explicit native-session join", async () => {
  const at = "2026-09-04T22:00:00.000Z";
  const input = { provider: "fixture-router", model: "fixture-model", effort: "high", cwd: "/synthetic/work" };
  const file = livePath(resolveObservability(home, {}));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, [
    { at, runId: "fixture-dispatch", kind: "subagent.dispatching", detail: { source: "codex" } },
    { at, runId: "fixture-dispatch", kind: "subagent.dispatch", detail: { verdict: "accepted", external: "fixture-native", route: compareRouteIdentity(input, input) } },
  ].map(event => JSON.stringify(event)).join("\n") + "\n");
  const result = await run(["runs", "--json", "--home", home, "--now", at]);
  assert.equal(result.code, EXIT.ok);
  const read = JSON.parse(result.out);
  assert.equal(read.dispatches.length, 1);
  assert.equal(read.dispatches[0].runId, "fixture-dispatch");
  assert.equal(read.dispatches[0].external, "fixture-native");
  assert.equal(read.dispatches[0].route.observed.provider.value, "fixture-router");
  assert.equal(read.dispatches[0].route.invalid.length, 2);
  assert.ok(!result.out.includes("/synthetic/work"));
});

// Synthetic reservation written in Orchid's format, read through the actual CLI.
it("runs JSON includes Orchid issue and pane evidence without a native-session guess", async () => {
  const key = "a".repeat(64);
  const root = join(home, "private-dispatches");
  const record = join(root, key, "record");
  await mkdir(record, { recursive: true, mode: 0o700 });
  await writeFile(join(record, "dispatch.json"), JSON.stringify({ schemaVersion: 1,
    runId: "orchid-" + key, issue: { repo: "example/inbox", number: 42 }, parentRunId: null,
    source: "codex", profile: "leaf", provider: "fixture-router", model: "fixture-model", effort: "high", state: "dispatched",
    observedAt: "2026-01-01T00:00:00.000Z",
    location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" },
  }), { mode: 0o600 });
  process.env.DSH_TELEMETRY_DISPATCH_ROOT = root;
  const result = await run(["runs", "--json", "--home", home]);
  const document = JSON.parse(result.out);
  assert.equal(document.dispatches.length, 1);
  assert.deepEqual(document.dispatches[0].issue, { repo: "example/inbox", number: 42 });
  assert.equal(document.dispatches[0].route.requested.model.value, "fixture-model");
  assert.equal(document.dispatches[0].external, null);
  assert.equal(document.agentObservations.schema, 1);
  assert.equal(document.agentObservations.complete, false);
  assert.equal(document.agentObservations.reason, "ancestry_unavailable");
  assert.match(document.agentObservations.agents[0].agentId, /^agent_[a-f0-9]{64}$/);
  assert.equal(document.agentObservations.agents[0].cost.subscriptionHeadroom.availability, "unavailable");
  assert.ok(!JSON.stringify(document.agentObservations).includes(document.dispatches[0].runId));
  assert.ok(!result.out.includes(root));
});

