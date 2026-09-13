#!/usr/bin/env node
/**
 * What a consumer pinned at a PUBLISHED `@rickylabs/harness-contracts` answers when it is handed the
 * shape this run ships. Not the tree's reader — the registry tarballs'.
 *
 * The decision on issue 300 rests entirely on one measured difference: a widened record inside
 * `schema: 1` reads as `invalid`, so a pinned consumer calls well-formed data corrupt; the same
 * record at `schema: 2` reads as `unsupported-schema` carrying both numbers, so a pinned consumer
 * correctly says it is too old and by how much. If the second row ever came back `invalid`, the
 * premise of the decision would be wrong and nothing should ship.
 *
 * Both published readers are probed. 0.3.0 was the pin the proposal measured; 0.4.0 was published on
 * 2026-09-13 carrying the connection-recovery change from #265 and is the pin a consumer will hold
 * when this lands. Their `src/repository-run-observation.ts` files are byte-identical to each other
 * and to this run's baseline, which is why the two tables agree.
 *
 *   node probe-published-readers.mjs                      fetch 0.3.0 and 0.4.0 from the registry
 *   node probe-published-readers.mjs --offline <dir>...    use already-extracted package directories
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VERSIONS = ["0.3.0", "0.4.0"];
const offlineAt = process.argv.indexOf("--offline");
let scratch = null;
let dirs;
if (offlineAt !== -1) {
  dirs = process.argv.slice(offlineAt + 1);
  assert.ok(dirs.length > 0, "--offline needs at least one extracted package directory");
} else {
  scratch = mkdtempSync(join(tmpdir(), "published-readers-"));
  dirs = VERSIONS.map(version => {
    execFileSync("npm", ["pack", `@rickylabs/harness-contracts@${version}`, "--pack-destination", scratch], { stdio: ["ignore", "pipe", "pipe"] });
    const into = join(scratch, `v${version}`);
    mkdirSync(into);
    execFileSync("tar", ["xzf", join(scratch, `rickylabs-harness-contracts-${version}.tgz`), "-C", into]);
    return join(into, "package");
  });
}

/** Exactly what published 0.3.0 and 0.4.0 define, as a producer on protocol 1 sent it. */
const control = () => ({
  schema: 1, protocol: 1,
  binding: { namespace: "synthetic-issuer", id: "binding-1", revision: "r1", sourceScopeId: "store-a", repo: { owner: "synthetic", name: "repo" } },
  capturedAt: "2026-09-13T12:00:05.000Z",
  coverage: { status: "read", reason: null },
  verification: { basis: "enrollment-and-local-worktree", verifiedAt: "2026-09-13T12:00:04.000Z" },
  run: {
    source: "codex", nativeId: "native-1",
    firstObservedAt: "2026-09-13T12:00:00.000Z", lastObservedAt: "2026-09-13T12:00:03.000Z",
    identity: { provider: null, model: { value: "synthetic/model", observedAt: "2026-09-13T12:00:01.000Z" }, effort: null },
    usage: null,
    execution: { status: "source-reported-complete", observedAt: "2026-09-13T12:00:03.000Z" },
    relationships: { parent: "unavailable", agent: "unavailable", task: "unavailable", messages: "unavailable", certification: "unavailable" },
  },
});
const widenSource = v => { v.run.source = "uhp"; return v; };
const widenBasis = v => { v.verification.basis = "enrollment-and-router-session"; return v; };
const widenStatus = v => { v.run.execution = { status: "source-reported-running", observedAt: v.run.lastObservedAt }; return v; };
const widenAll = v => widenStatus(widenBasis(widenSource(v)));
const atSchema2 = v => { v.schema = 2; return v; };

const rows = [
  ["control: exactly what the published version defines", () => control(), { ok: true }],
  ["source \"uhp\" alone, inside schema 1", () => widenSource(control()), { ok: false, reason: "invalid" }],
  ["basis router-session alone, inside schema 1", () => widenBasis(control()), { ok: false, reason: "invalid" }],
  ["status source-reported-running alone, inside schema 1", () => widenStatus(control()), { ok: false, reason: "invalid" }],
  ["all three widenings together, inside schema 1", () => widenAll(control()), { ok: false, reason: "invalid" }],
  ["all three widenings at schema 2 — what a UHP producer writes", () => atSchema2(widenAll(control())), { ok: false, reason: "unsupported-schema", schema: 2, protocol: 1 }],
  ["a plain codex observation at schema 2 — what telemetry now writes", () => atSchema2(control()), { ok: false, reason: "unsupported-schema", schema: 2, protocol: 1 }],
  ["a schema-1 record already persisted before this change", () => control(), { ok: true }],
];

try {
  for (const dir of dirs) {
    assert.ok(existsSync(join(dir, "dist/index.js")), `not an extracted contracts package: ${dir}`);
    const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
    const published = await import(pathToFileURL(join(dir, "dist/index.js")).href);
    assert.equal(published.REPOSITORY_RUN_OBSERVATION_SCHEMA, 1, `published ${version} must write schema 1`);
    assert.equal(published.REPOSITORY_RUN_OBSERVATION_READ_SCHEMAS, undefined, `published ${version} has no read-schema list; it compares against one number`);
    console.log(`\n=== published @rickylabs/harness-contracts@${version} ===`);
    for (const [label, build, expected] of rows) {
      const answer = published.readRepositoryRunObservation(build());
      const rendered = answer.ok ? "ok: true"
        : `ok: false, reason: ${answer.reason}${answer.reason === "unsupported-schema" ? `, schema: ${answer.schema}, protocol: ${answer.protocol}` : ""}`;
      console.log(`  ${rendered.padEnd(56)}  <-  ${label}`);
      if (expected.ok) assert.equal(answer.ok, true, `${version}: ${label}`);
      else assert.deepEqual(answer, expected, `BLOCKING — ${version}: ${label}`);
    }
  }
  console.log(`\nPASS — the decision's premise holds against ${dirs.length} published artifact(s).`);
  console.log("A pinned consumer reports a widened schema-1 record as CORRUPT, and a schema-2 record as TOO OLD, with both numbers.");
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
