#!/usr/bin/env node
/**
 * What does the **published** 0.3.0 reader do with each widening #287 asks for?
 *
 * Evidence, not argument. The three changes in `proposal-observation-surface-uhp.md` are described on the
 * issue as "additive widenings". This script asks the artifact a consumer actually installs: it fetches
 * `@rickylabs/harness-contracts@0.3.0` from the registry, imports that tarball's compiled
 * `readRepositoryRunObservation`, and runs one record per candidate change through it.
 *
 * Run from anywhere, with network access:
 *
 *     node .llm/runs/contract-alignment--e38/probe-published-0.3.0.mjs
 *
 * It writes nothing and installs nothing into this repository: the tarball is unpacked into a temporary
 * directory and the import is by absolute path. Recorded output is in `verification.md` §3 and in
 * `proposal-observation-surface-uhp.md` §4.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VERSION = "0.3.0";
const scratch = mkdtempSync(join(tmpdir(), "e38-published-"));

execFileSync("npm", ["pack", `@rickylabs/harness-contracts@${VERSION}`], { cwd: scratch, stdio: ["ignore", "pipe", "pipe"] });
execFileSync("tar", ["-xzf", `rickylabs-harness-contracts-${VERSION}.tgz`], { cwd: scratch, stdio: "ignore" });

const { readRepositoryRunObservation } = await import(
  pathToFileURL(join(scratch, "package/dist/repository-run-observation.js")).href
);

/** Exactly what 0.3.0 defines, and what every case below varies by one field. */
const base = () => ({
  schema: 1,
  protocol: 1,
  binding: {
    namespace: "harness",
    id: "run-1",
    revision: "rev-1",
    sourceScopeId: "scope-1",
    repo: { owner: "rickylabs", name: "harness" },
  },
  capturedAt: "2026-09-12T10:00:00.000Z",
  coverage: { status: "read", reason: null },
  verification: { basis: "enrollment-and-local-worktree", verifiedAt: "2026-09-12T09:59:00.000Z" },
  run: {
    source: "codex",
    nativeId: "thread-1",
    firstObservedAt: "2026-09-12T09:00:00.000Z",
    lastObservedAt: "2026-09-12T09:30:00.000Z",
    identity: { provider: null, model: null, effort: null },
    usage: null,
    execution: { status: "source-reported-complete", observedAt: "2026-09-12T09:30:00.000Z" },
    relationships: {
      parent: "unavailable",
      agent: "unavailable",
      task: "unavailable",
      messages: "unavailable",
      certification: "unavailable",
    },
  },
});

const withRun = (over) => { const v = base(); Object.assign(v.run, over); return v; };

const cases = {
  "control: exactly what 0.3.0 defines": base(),
  "source: uhp": withRun({ source: "uhp" }),
  "basis: enrollment-and-router-session": (() => { const v = base(); v.verification.basis = "enrollment-and-router-session"; return v; })(),
  "execution.status: source-reported-running": withRun({ execution: { status: "source-reported-running", observedAt: "2026-09-12T09:30:00.000Z" } }),
  "all three together, as the issue requires": (() => {
    const v = withRun({ source: "uhp", execution: { status: "source-reported-running", observedAt: "2026-09-12T09:30:00.000Z" } });
    v.verification.basis = "enrollment-and-router-session";
    return v;
  })(),
  "the same record at schema 2 (option B)": (() => { const v = base(); v.schema = 2; return v; })(),
};

console.log(`@rickylabs/harness-contracts@${VERSION}, unpacked at ${scratch}\n`);
for (const [name, value] of Object.entries(cases)) {
  const reading = readRepositoryRunObservation(value);
  console.log(`${name.padEnd(44)} -> ${JSON.stringify(reading.ok ? { ok: true } : reading)}`);
}
