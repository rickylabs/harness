#!/usr/bin/env node
/**
 * The mutation campaign for #300, as a runnable artifact rather than a claim.
 *
 * Three groups:
 *
 * - **N-rows** are this run's new behaviour: schema 2 as the write number, read-both, the schema-1
 *   narrowing that keeps read-both honest, the three widened literal sets, and the `unsupported-schema`
 *   answer carrying both numbers.
 * - **T-rows** are the producer side in `packages/telemetry`: it must write the newest schema and must
 *   not mint vocabulary it cannot evidence.
 * - **C-rows** are **carried forward**: pre-existing behaviour of the same decoder, re-run because this
 *   run restructured the function that implements it. A mutation record describes the code as it was;
 *   change the meaning and the record silently stops describing it while still looking like coverage.
 *
 * Each entry damages exactly one behaviour by an exact string replacement in one source file, runs the
 * `@rickylabs/harness-contracts` and `@rickylabs/telemetry` suites, records how many tests died, then
 * restores the file byte for byte. Every mutant is written in a form that still **compiles**: a mutant
 * caught by an unused-variable check rather than by an assertion is not evidence that the behaviour is
 * covered, so `compiled: false` is reported as a finding rather than as a kill.
 *
 * A mutation that kills zero tests is a finding: the behaviour is uncovered, or the test that looks like
 * it covers it passes for another reason. A mutation that fails to apply is also a finding — the record
 * no longer describes this code.
 *
 * Run from the repository root:
 *
 *     node .llm/runs/observation-schema-2--e38/mutations.mjs
 *
 * It writes `mutations.json` beside itself and prints a table. It refuses to start unless both suites are
 * green, because a half-applied mutation left by an interrupted run would be reported as the next result.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const CONTRACTS = "packages/contracts/src/repository-run-observation.ts";
const TELEMETRY = "packages/telemetry/src/repository-run-observation.ts";

/** Every mutation: one file, one exact replacement, and what it is meant to break. */
const mutations = [
  /* -----------------------------------------------------------------------------------------------
   * N — this run's behaviour
   * -------------------------------------------------------------------------------------------- */
  {
    id: "N1", file: CONTRACTS,
    breaks: "the write number goes back to 1, so nothing this package produces carries the new schema",
    from: `export const REPOSITORY_RUN_OBSERVATION_SCHEMA = 2 as const;`,
    to: `export const REPOSITORY_RUN_OBSERVATION_SCHEMA = 1 as const;`,
  },
  {
    id: "N2", file: CONTRACTS,
    breaks: "read-both becomes read-newest, so every already-persisted schema-1 record becomes unreadable",
    from: `    if (!(REPOSITORY_RUN_OBSERVATION_READ_SCHEMAS as readonly unknown[]).includes(r.schema) || r.protocol !== 1) {`,
    to: `    if (r.schema !== REPOSITORY_RUN_OBSERVATION_SCHEMA || r.protocol !== 1) {`,
  },
  {
    id: "N3", file: CONTRACTS,
    breaks: "the source vocabulary is bound to the wrong schema: schema 1 admits UHP and schema 2 refuses it",
    from: `  const source = choice(r.source, schema === 1 ? SCHEMA_1_SOURCES : OBSERVED_RUN_SOURCES);`,
    to: `  const source = choice(r.source, schema === 2 ? SCHEMA_1_SOURCES : OBSERVED_RUN_SOURCES);`,
  },
  {
    id: "N4", file: CONTRACTS,
    breaks: "the basis vocabulary is bound to the wrong schema, so `read` loses its local-worktree entailment inside schema 1",
    from: `      const basis = choice(v.basis, schema === 1 ? SCHEMA_1_VERIFICATION_BASES : RUN_VERIFICATION_BASES);`,
    to: `      const basis = choice(v.basis, schema === 2 ? SCHEMA_1_VERIFICATION_BASES : RUN_VERIFICATION_BASES);`,
  },
  {
    id: "N5", file: CONTRACTS,
    breaks: "the status vocabulary is bound to the wrong schema, so an in-flight report is legal inside schema 1",
    from: `  } else execution = { status: choice(e.status, schema === 1 ? SCHEMA_1_REPORTED_STATUSES : RUN_EXECUTION_REPORTED_STATUSES), observedAt: within(e.observedAt) };`,
    to: `  } else execution = { status: choice(e.status, schema === 2 ? SCHEMA_1_REPORTED_STATUSES : RUN_EXECUTION_REPORTED_STATUSES), observedAt: within(e.observedAt) };`,
  },
  {
    id: "N6", file: CONTRACTS,
    breaks: "schema 1 is retroactively told it always admitted a UHP source, which is what read-both must not claim",
    from: `const SCHEMA_1_SOURCES = ["codex"] as const;`,
    to: `const SCHEMA_1_SOURCES = ["codex", "uhp"] as const;`,
  },
  {
    id: "N7", file: CONTRACTS,
    breaks: "schema 1 is retroactively told it always admitted the router-session basis",
    from: `const SCHEMA_1_VERIFICATION_BASES = ["enrollment-and-local-worktree"] as const;`,
    to: `const SCHEMA_1_VERIFICATION_BASES = ["enrollment-and-local-worktree", "enrollment-and-router-session"] as const;`,
  },
  {
    id: "N8", file: CONTRACTS,
    breaks: "schema 1 is retroactively told it always admitted an in-flight status",
    from: `const SCHEMA_1_REPORTED_STATUSES = ["source-reported-complete", "source-reported-error"] as const;`,
    to: `const SCHEMA_1_REPORTED_STATUSES = ["source-reported-complete", "source-reported-error", "source-reported-running"] as const;`,
  },
  {
    id: "N9", file: CONTRACTS,
    breaks: "the schema read is overwritten with the schema written, so stored evidence claims a vocabulary it never had",
    from: `    const base: ObservationBase = { schema, protocol: 1, binding: binding(r.binding), capturedAt: time(r.capturedAt) };`,
    to: `    const base: ObservationBase = { schema: REPOSITORY_RUN_OBSERVATION_SCHEMA, protocol: 1, binding: binding(r.binding), capturedAt: time(r.capturedAt) };`,
  },
  {
    id: "N10", file: CONTRACTS,
    breaks: "a record from an unread schema answers `invalid` instead of `unsupported-schema` — the whole reason this decision went the way it did",
    from: `      const version = (v: unknown): number | null => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
      return { ok: false, reason: "unsupported-schema", schema: version(r.schema), protocol: version(r.protocol) };`,
    to: `      return bad();`,
  },
  {
    id: "N11", file: CONTRACTS,
    breaks: "`unsupported-schema` reports a number it does not carry, so a pinned consumer cannot say by how much it is behind",
    from: `      const version = (v: unknown): number | null => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;`,
    to: `      const version = (v: unknown): number | null => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? 0 : null;`,
  },
  {
    id: "N17", file: CONTRACTS,
    breaks: "the two numbers on `unsupported-schema` are swapped, so a pinned consumer is told the wrong distance",
    from: `      return { ok: false, reason: "unsupported-schema", schema: version(r.schema), protocol: version(r.protocol) };`,
    to: `      return { ok: false, reason: "unsupported-schema", schema: version(r.protocol), protocol: version(r.schema) };`,
  },
  {
    id: "N12", file: CONTRACTS,
    breaks: "the in-flight arm is decided by the timestamp rather than the status, so a running report with no time is read as unknown",
    from: `  if (e.status === "unknown") {`,
    to: `  if (e.observedAt === null) {`,
  },
  {
    id: "N13", file: CONTRACTS,
    breaks: "the reported-status vocabulary grows a fourth member nothing produces",
    from: `export const RUN_EXECUTION_REPORTED_STATUSES = ["source-reported-running", "source-reported-complete", "source-reported-error"] as const;`,
    to: `export const RUN_EXECUTION_REPORTED_STATUSES = ["source-reported-running", "source-reported-complete", "source-reported-error", "source-reported-cancelled"] as const;`,
  },
  {
    id: "N14", file: CONTRACTS,
    breaks: "the observed-source vocabulary absorbs a `RunSource` member, overloading the billing seam this decision refused to touch",
    from: `export const OBSERVED_RUN_SOURCES = ["codex", "uhp"] as const;`,
    to: `export const OBSERVED_RUN_SOURCES = ["codex", "uhp", "claude"] as const;`,
  },
  {
    id: "N15", file: CONTRACTS,
    breaks: "the new basis is renamed to the alternative the proposal rejected, so the published name is the vaguer one",
    from: `export const RUN_VERIFICATION_BASES = ["enrollment-and-local-worktree", "enrollment-and-router-session"] as const;`,
    to: `export const RUN_VERIFICATION_BASES = ["enrollment-and-local-worktree", "enrollment-and-hosted-session"] as const;`,
  },
  {
    id: "N16", file: CONTRACTS,
    breaks: "the version fence lets a future schema through to field validation, so a newer record is judged by this reader's rules",
    from: `export const REPOSITORY_RUN_OBSERVATION_READ_SCHEMAS = [1, 2] as const;`,
    to: `export const REPOSITORY_RUN_OBSERVATION_READ_SCHEMAS = [1, 2, 3] as const;`,
  },
  /* -----------------------------------------------------------------------------------------------
   * T — the producer side
   * -------------------------------------------------------------------------------------------- */
  {
    id: "T1", file: TELEMETRY,
    breaks: "the producer keeps writing schema 1, so the bump exists in the type and in nothing published",
    from: `  const result = readRepositoryRunObservation({ schema: REPOSITORY_RUN_OBSERVATION_SCHEMA, protocol: 1, binding: d.binding, capturedAt: now(),`,
    to: `  const result = readRepositoryRunObservation({ schema: 1, protocol: 1, binding: d.binding, capturedAt: now(),`,
  },
  {
    id: "T2", file: TELEMETRY,
    breaks: "a local-worktree reader claims the router-session basis — the new vocabulary used to lie rather than to be honest",
    from: `  const verification = failure === null && run !== null ? { basis: "enrollment-and-local-worktree", verifiedAt: now() } : null;`,
    to: `  const verification = failure === null && run !== null ? { basis: "enrollment-and-router-session", verifiedAt: now() } : null;`,
  },
  {
    id: "T3", file: TELEMETRY,
    breaks: "a local Codex rollout is published as a UHP-hosted run, which the widened source now makes expressible",
    from: `  return { source: "codex", nativeId: d.source.nativeId, firstObservedAt: rows[0]!.timestamp as string,`,
    to: `  return { source: "uhp", nativeId: d.source.nativeId, firstObservedAt: rows[0]!.timestamp as string,`,
  },
  /* -----------------------------------------------------------------------------------------------
   * C — carried forward: pre-existing decoder behaviour, re-run because this run restructured it
   * -------------------------------------------------------------------------------------------- */
  {
    id: "C1", file: CONTRACTS,
    breaks: "the observation interval may run backwards",
    from: `  if (firstObservedAt > lastObservedAt) return bad();`,
    to: `  if (firstObservedAt < lastObservedAt) return bad();`,
  },
  {
    id: "C2", file: CONTRACTS,
    breaks: "evidence may be timestamped after the last observed envelope",
    from: `  const within = (v: unknown): string => { const t = time(v); if (t < firstObservedAt || t > lastObservedAt) return bad(); return t; };`,
    to: `  const within = (v: unknown): string => { const t = time(v); if (t < firstObservedAt) return bad(); return t; };`,
  },
  {
    id: "C3", file: CONTRACTS,
    breaks: "a verification may be stamped after the collection it belongs to",
    from: `      if (verifiedAt > base.capturedAt) return bad();`,
    to: `      if (verifiedAt < base.capturedAt) return bad();`,
  },
  {
    id: "C4", file: CONTRACTS,
    breaks: "the relationships fence accepts a record in which some relationship is claimed",
    from: `  if (Object.values(rel).some(v => v !== "unavailable")) return bad();`,
    to: `  if (Object.values(rel).every(v => v !== "unavailable")) return bad();`,
  },
  {
    id: "C5", file: CONTRACTS,
    breaks: "a non-read coverage may carry a run or a verification, so a degraded record can smuggle evidence",
    from: `    if (r.run !== null || r.verification !== null) return bad();`,
    to: `    if (r.run !== null && r.verification !== null) return bad();`,
  },
  {
    id: "C6", file: CONTRACTS,
    breaks: "a usage record with no count at all is accepted as usage",
    from: `    if (Object.keys(u).length < 2) return bad();`,
    to: `    if (Object.keys(u).length < 1) return bad();`,
  },
  {
    id: "C7", file: CONTRACTS,
    breaks: "the accessor fence: a getter-backed property is read instead of refused, so input can execute code and leak",
    from: `    if (!d || !("value" in d) || !d.enumerable) return bad();`,
    to: `    if (!d) return bad();`,
  },
  {
    id: "C8", file: CONTRACTS,
    breaks: "negative zero survives normalization, so two equal counts are not equal",
    from: `      counts[field] = n === 0 ? 0 : n;`,
    to: `      counts[field] = n;`,
  },
  {
    id: "C9", file: CONTRACTS,
    breaks: "an identity leaf may carry twice the bounded length",
    from: `    return { value: text(l.value, /^[A-Za-z0-9_./:-]+$/, 200), observedAt: within(l.observedAt) };`,
    to: `    return { value: text(l.value, /^[A-Za-z0-9_./:-]+$/, 400), observedAt: within(l.observedAt) };`,
  },
  {
    id: "C10", file: CONTRACTS,
    breaks: "the unknown arm may carry a timestamp, collapsing the distinction the in-flight status was added to make",
    from: `    if (e.observedAt !== null) return bad();`,
    to: `    if (e.observedAt === undefined) return bad();`,
  },
];

const SUITES = [
  ["contracts", "@rickylabs/harness-contracts"],
  ["telemetry", "@rickylabs/telemetry"],
];

function measure() {
  const per = {};
  let killed = 0, compiled = true;
  const tests = new Set();
  for (const [name, filter] of SUITES) {
    let output;
    try {
      output = execFileSync("pnpm", ["--filter", filter, "run", "test"], {
        cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "0" },
      });
    } catch (error) {
      output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    }
    const plain = output.replace(/\[[0-9;]*m/g, "");
    const fail = /^(?:.*\s)?ℹ fail (\d+)$/m.exec(plain);
    const compileError = /error TS\d+/.test(plain);
    for (const match of plain.matchAll(/✖ (.+?) \(/g)) tests.add(`${name}: ${match[1]}`);
    if (compileError) compiled = false;
    per[name] = fail === null ? (compileError ? "compile-error" : "unknown") : Number(fail[1]);
    if (typeof per[name] === "number") killed += per[name];
  }
  const unusable = Object.values(per).some(v => typeof v !== "number");
  return { killed: unusable ? Object.values(per).find(v => typeof v !== "number") : killed, per, compiled, tests: [...tests] };
}

const originals = new Map();
for (const mutation of mutations) {
  const path = join(root, mutation.file);
  if (!originals.has(path)) originals.set(path, readFileSync(path, "utf8"));
}

process.stdout.write("baseline...\n");
const baseline = measure();
if (baseline.killed !== 0) {
  process.stderr.write(`the suites are not green before mutating (${JSON.stringify(baseline.per)}); refusing to attribute anything to a mutation\n`);
  process.exit(2);
}

const results = [];
for (const mutation of mutations) {
  const path = join(root, mutation.file);
  const before = readFileSync(path, "utf8");
  const occurrences = before.split(mutation.from).length - 1;
  let outcome;
  if (occurrences !== 1) {
    outcome = { killed: occurrences === 0 ? "not-applied" : "ambiguous", per: {}, compiled: null, tests: [] };
  } else {
    writeFileSync(path, before.replace(mutation.from, mutation.to));
    outcome = measure();
    writeFileSync(path, before);
  }
  results.push({ id: mutation.id, file: mutation.file, breaks: mutation.breaks, ...outcome });
  process.stdout.write(`${mutation.id.padEnd(4)} killed ${String(outcome.killed).padEnd(12)} ${outcome.compiled === false ? "DID NOT COMPILE — not evidence  " : ""}${mutation.breaks}\n`);
}

// Restore everything unconditionally, then prove the tree is green again.
for (const [path, text] of originals) writeFileSync(path, text);
process.stdout.write("after restore...\n");
const after = measure();

writeFileSync(join(here, "mutations.json"), `${JSON.stringify({ baseline, results, after, at: new Date().toISOString() }, null, 2)}\n`);
process.stdout.write(`\nbaseline fail ${JSON.stringify(baseline.per)}; after restore fail ${JSON.stringify(after.per)}\n`);
const findings = results.filter(r => r.killed === 0 || typeof r.killed === "string" || r.compiled === false);
process.stdout.write(findings.length === 0
  ? `every one of the ${results.length} mutations compiled and killed at least one test\n`
  : `FINDINGS: ${findings.map(r => `${r.id} (${r.killed}${r.compiled === false ? ", did not compile" : ""})`).join(", ")}\n`);
