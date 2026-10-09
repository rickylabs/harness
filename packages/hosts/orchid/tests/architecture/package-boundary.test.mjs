// Doctrine rules 2 and 8: this host adapter names no workspace package but the contracts, and only through
// their published entry points. Telemetry composes this package, so an import of telemetry here is a
// cycle. The rule lives in scripts/package-boundary.mjs; this test applies it and proves it refuses.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { entrySpecifiers, importProblems, manifestProblems, packageProblems } from "../../../../../scripts/package-boundary.mjs";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const contracts = JSON.parse(readFileSync(join(packageRoot, "../../contracts/package.json"), "utf8"));
const entries = entrySpecifiers(contracts);

test("the package imports only node builtins, its own files and the contracts' published entry points", async () => {
  const { files, problems } = await packageProblems(packageRoot, entries);
  assert.ok(files.some(file => file.endsWith("mod.ts")) && files.length > 5, "no source was read, so this check proves nothing");
  assert.deepEqual(problems, []);
});

test("the published contracts entry points are admitted and nothing deeper", () => {
  assert.ok(entries.includes("@rickylabs/harness-contracts"));
  assert.ok(entries.includes("@rickylabs/harness-contracts/route"));
  assert.ok(!entries.some(entry => entry.includes("/src/") || entry.includes("/dist/")));
});

test("every import form that reaches telemetry or a deep contracts path is refused", async () => {
  const file = join(packageRoot, "src", "adapters", "synthetic.ts");
  for (const text of [
    'import { orchid } from "@rickylabs/telemetry";',
    'import type { RunRecord } from "@rickylabs/telemetry";',
    'export * from "@rickylabs/telemetry";',
    'export { cli } from "@rickylabs/telemetry/cli";',
    'import "@rickylabs/telemetry";',
    'const t = await import("@rickylabs/telemetry");',
    'const t = require("@rickylabs/telemetry");',
    'import t = require("@rickylabs/telemetry");',
    'type T = typeof import("@rickylabs/telemetry");',
    'import { x } from "../../../../telemetry/src/cli.js";',
    'import { y } from "@rickylabs/harness-contracts/dist/route.js";',
    'import { z } from "@rickylabs/subagents";',
    'const name = "@rickylabs/telemetry"; await import(name);',
  ]) {
    assert.notDeepEqual(await importProblems(file, text, packageRoot, entries), [], text);
  }
  for (const text of ['import { open } from "node:fs/promises";', 'import { object } from "../domain/receipt-shape.js";',
    'import type { DispatchEvidence } from "@rickylabs/harness-contracts";', 'import { projectRouteIdentity } from "@rickylabs/harness-contracts/route";']) {
    assert.deepEqual(await importProblems(file, text, packageRoot, entries), [], text);
  }
});

test("a manifest naming telemetry or any other workspace package is refused", () => {
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    assert.notDeepEqual(manifestProblems({ [field]: { "@rickylabs/telemetry": "workspace:*" } }), [], field);
  }
  assert.notDeepEqual(manifestProblems({ dependencies: { "@rickylabs/subagents": "^1.0.0" } }), []);
  assert.deepEqual(manifestProblems({ dependencies: { "@rickylabs/harness-contracts": "workspace:*" } }), []);
});
