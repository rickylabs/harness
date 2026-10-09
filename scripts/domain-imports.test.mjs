// The domain-import guard must fail on every form it claims to catch, and stay quiet on the forms a
// pure domain file legitimately uses. Fixture text only: no filesystem, no package is touched.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { domainProblems, importProblems } from "./domain-imports.mjs";

const ROOT = "/fixture/pkg/src/domain";
const FILE = `${ROOT}/rule.ts`;
const reasons = (text) => importProblems(FILE, text, ROOT).map((problem) => problem.reason);

for (const [label, text, reason] of [
  ["a vendor SDK value import", 'import { query } from "@anthropic-ai/claude-agent-sdk";', /vendor SDK @anthropic-ai\/claude-agent-sdk/],
  ["a vendor SDK type-only import", 'import type { Event } from "@opencode-ai/sdk/v2/client";', /vendor SDK @opencode-ai\/sdk/],
  ["node:child_process", 'import { spawn } from "node:child_process";', /Node builtin node:child_process/],
  ["node:net", 'import { connect } from "node:net";', /Node builtin node:net/],
  ["a bare builtin", 'import { readFileSync } from "fs";', /Node builtin fs/],
  ["a re-export from a builtin", 'export { spawn } from "node:child_process";', /Node builtin/],
  ["a dynamic import", 'export const load = () => import("node:net");', /Node builtin node:net/],
  ["a require", 'const net = require("node:net");', /Node builtin node:net/],
  ["a computed dynamic import", "export const load = (name: string) => import(name);", /computed/],
  ["a type-only import of the subagents package", 'import type { RunRef } from "@rickylabs/subagents";', /package @rickylabs\/subagents/],
  ["a value import of the subagents package", 'import { timeoutMs } from "@rickylabs/subagents";', /package @rickylabs\/subagents/],
  ["a value import of contracts", 'import { compareRouteIdentity } from "@rickylabs/harness-contracts";', /only types are allowed/],
  ["an import type node from a vendor", 'export type E = import("@opencode-ai/sdk").Event;', /vendor SDK/],
  ["an adapter import", 'import { createSdkServer } from "../adapters/sdk-server.js";', /outside src\/domain/],
  ["an application import", 'import type { RunRecord } from "../application/run.js";', /outside src\/domain/],
  ["a fetch call", 'export const probe = () => fetch("https://example.invalid/");', /global fetch/],
  ["an aliased fetch", "export const transport = fetch;", /global fetch/],
  ["globalThis.fetch", 'export const probe = () => globalThis.fetch("https://example.invalid/");', /global fetch/],
]) {
  test(`domain guard reports ${label}`, () => {
    const found = reasons(text);
    assert.equal(found.length, 1, `expected one finding, got ${JSON.stringify(found)}`);
    assert.match(found[0], reason);
  });
}

test("domain guard allows what a pure domain file uses", () => {
  const text = [
    'import { bagOf } from "./api.js";',
    'import type { Shape } from "./nested/shape.js";',
    'import type { RouteIdentityEvidence } from "@rickylabs/harness-contracts";',
    'export type { Shape } from "./nested/shape.js";',
    "// fetch is not called here; a comment naming fetch( is not a reference",
    'const text = "fetch(x) inside a string";',
    "interface Options { readonly fetch: (url: string) => Promise<unknown> }",
    "export const call = (options: Options) => options.fetch(text);",
    "export const reader = { fetch: bagOf };",
  ].join("\n");
  assert.deepEqual(reasons(text), []);
});

test("findings carry the line, so a failure points at the import", () => {
  const problems = importProblems(FILE, '\n\nimport { connect } from "node:net";\n', ROOT);
  assert.deepEqual(problems, [{ line: 3, reason: "imports the Node builtin node:net" }]);
});

test("domainProblems walks src/domain recursively and names each file", (t) => {
  const root = mkdtempSync(join(tmpdir(), "domain-guard-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "src/domain/nested"), { recursive: true });
  writeFileSync(join(root, "src/domain/clean.ts"), "export const one = 1;\n");
  writeFileSync(join(root, "src/domain/nested/dirty.ts"), 'import { spawn } from "node:child_process";\n');
  const { files, problems } = domainProblems(root);
  assert.equal(files.length, 2);
  assert.deepEqual(problems, ["src/domain/nested/dirty.ts:1 imports the Node builtin node:child_process"]);
});
