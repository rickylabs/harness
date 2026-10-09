// Doctrine rules 2 and 8: governance names no workspace package but the contracts, through their published
// entry points, and its src/domain imports nothing outward. Telemetry composes this package, so an import of
// `@rickylabs/telemetry` (or a relative path into packages/telemetry) here would be a cycle. The rules and
// their own failing cases live in scripts/package-boundary.mjs and scripts/domain-imports.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { domainProblems } from "../../../../scripts/domain-imports.mjs";
import { entrySpecifiers, packageProblems } from "../../../../scripts/package-boundary.mjs";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const contracts = JSON.parse(readFileSync(join(packageRoot, "../contracts/package.json"), "utf8"));

test("governance imports only node builtins, its own files and the contracts' published entry points", async () => {
  const { files, problems } = await packageProblems(packageRoot, entrySpecifiers(contracts));
  assert.ok(files.some(file => file.endsWith("mod.ts")) && files.length > 10, "no source was read, so this check proves nothing");
  assert.deepEqual(problems, []);
});

test("src/domain imports no adapter, Node builtin, vendor SDK, other package or contracts value", () => {
  const { files, problems } = domainProblems(packageRoot);
  assert.ok(files.length > 0, "src/domain holds no source, so this check proves nothing");
  assert.deepEqual(problems, []);
});
