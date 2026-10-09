// Doctrine rule 8: this package's src/domain imports nothing outward — no vendor SDK, no
// node:child_process, no node:net, no other package, no global fetch. The rule and its own failing
// cases live in scripts/domain-imports.mjs; this test applies it to this package.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { domainProblems } from "../../../../../scripts/domain-imports.mjs";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

test("src/domain imports no vendor SDK, node:child_process, node:net, package or fetch", () => {
  const { files, problems } = domainProblems(packageRoot);
  assert.ok(files.length > 0, "src/domain holds no source, so this check proves nothing");
  assert.deepEqual(problems, []);
});
