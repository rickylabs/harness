#!/usr/bin/env node
/**
 * The mutation campaign for the two decided changes on #286, as a runnable artifact rather than a claim.
 *
 * Each entry damages exactly one behaviour by an exact string replacement in one source file, runs the
 * `@rickylabs/subagents` suite, records how many tests died and which, then restores the file byte for
 * byte. A mutation that kills zero tests is a **finding**: it means the behaviour is uncovered, or the
 * test that looks like it covers it passes for another reason. When a control does not fire, suspect the
 * setup before the assertion — the usual cause is a fixture that gives the input a second path to the
 * same outcome.
 *
 * Run from the repository root:
 *
 *     node .llm/runs/provider-uhp-relax--e37/mutations.mjs
 *
 * It writes `mutations.json` beside itself and prints a table. It refuses to start with a suite that is
 * not already green, because a pre-existing failure would be attributed to the first mutation.
 *
 * The harness is the one written for `.llm/runs/provider-uhp--e37/mutations.mjs`, reused rather than
 * rewritten; only the mutation list is this run's.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const src = join(root, "packages/subagents/src");

/** Every mutation: one file, one exact replacement, and what it is meant to break. */
const mutations = [
  {
    id: "R1",
    file: "uhp-gate.ts",
    breaks: "the gate accepts when the model itself is unreported — the ruling applied one bullet too far",
    from: `  if (uhpRouteAttestation(negatives) === "none") return "unknown";`,
    to: `  if (false as boolean) return "unknown";`,
  },
  {
    id: "R2",
    file: "uhp-gate.ts",
    breaks: "the gate returns unknown when the model agreed — the pre-ruling gate, which refuses every UHP route",
    from: `  if (uhpRouteAttestation(negatives) === "none") return "unknown";`,
    to: `  if (negatives.unverified || negatives.unreported.length > 0) return "unknown";`,
  },
  {
    id: "R3",
    file: "uhp-gate.ts",
    breaks: "the ratified order: absence is checked before contradiction, which is the codex ladder reintroduced",
    from: `  if (negatives.contradicted.length > 0) return "refused";
  if (uhpRouteAttestation(negatives) === "none") return "unknown";`,
    to: `  if (uhpRouteAttestation(negatives) === "none") return "unknown";
  if (negatives.contradicted.length > 0) return "refused";`,
  },
  {
    id: "R4",
    file: "uhp-gate.ts",
    breaks: "a contradiction stops refusing at all, so the separately ratified ruling is regressed under the relaxation",
    from: `  if (negatives.contradicted.length > 0) return "refused";
  if (uhpRouteAttestation(negatives) === "none") return "unknown";`,
    to: `  if (false as boolean) return "refused";
  if (uhpRouteAttestation(negatives) === "none") return "unknown";`,
  },
  {
    id: "R5",
    file: "uhp-gate.ts",
    breaks: "attestation ignores the requested side, so a model nobody asked for counts as agreed",
    from: `  return asked !== null && seen !== null && asked === seen;`,
    to: `  return seen !== null && (asked === null || asked === seen);`,
  },
  {
    id: "R6",
    file: "uhp-gate.ts",
    breaks: "the grade stops distinguishing a partly attested route from a complete one",
    from: `  return negatives.unattested.length === 0 ? "complete" : "partial";`,
    to: `  return "complete";`,
  },
  {
    id: "R7",
    file: "uhp-gate.ts",
    breaks: "a contradiction is graded as a partly attested route, so a substitution reads as attested evidence",
    from: `  if (negatives.unattested.includes("model")) return "none";`,
    to: `  if (negatives.unattested.includes("model") && negatives.unattested.length === 4) return "none";`,
  },
  {
    id: "R8",
    file: "uhp-gate.ts",
    breaks: "the acceptance stops reporting the owner risk decision it rests on",
    from: `an unattested route is accepted by the owner risk ruling of 2026-09-12 — UHP and DeepSeek both guarantee the model and effort they are given — and not because the risk was shown to be absent; `,
    to: ``,
  },
  {
    id: "R9",
    file: "uhp-harnesses.ts",
    breaks: "the drift narrowing swallows a drift on the harness being dispatched to",
    from: `  const blocking = drift.filter((item) => item.harness === null || item.harness === harness);`,
    to: `  const blocking = drift.filter((item) => item.harness === null);`,
  },
  {
    id: "R10",
    file: "uhp-harnesses.ts",
    breaks: "the narrowing swallows listing-unreadable, so an unreachable console dispatches as an agreeing one",
    from: `  const blocking = drift.filter((item) => item.harness === null || item.harness === harness);`,
    to: `  const blocking = drift.filter((item) => item.harness === harness);`,
  },
  {
    id: "R11",
    file: "uhp-harnesses.ts",
    breaks: "unrelated drift is reported as nothing at all, which is the narrowing turned into silence",
    from: `  if (unrelated.length === 0) return null;`,
    to: `  if (unrelated.length >= 0) return null;`,
  },
  {
    id: "R12",
    file: "uhp-harnesses.ts",
    breaks: "the unrelated-drift signal stops naming which rows disagree",
    from: `  const rows = unrelated.map((item) => \`\${item.harness ?? "(the listing)"} (\${item.kind})\`).join(", ");`,
    to: `  const rows = "some";`,
  },
  {
    id: "R13",
    file: "uhp-provider.ts",
    breaks: "the unrelated-drift signal is dropped entirely: neither the sink nor the result carries it",
    from: `    if (unrelatedDrift !== null) {
      diagnose("dispatch", runId, UHP_UNRELATED_DRIFT, unrelatedDrift);
      unrelatedByRun.set(runId, unrelatedDrift);
    }`,
    to: `    if (unrelatedDrift !== null) {
      void unrelatedDrift;
    }`,
  },
  {
    id: "R14",
    file: "uhp-provider.ts",
    breaks: "the signal reaches the diagnostic sink but not the dispatch result, so a caller with no sink sees nothing",
    from: `      unrelatedByRun.set(runId, unrelatedDrift);`,
    to: `      void unrelatedDrift;`,
  },
  {
    id: "R15",
    file: "uhp-provider.ts",
    breaks: "the signal reaches the dispatch result but never the sink, so no operator surface can select on it",
    from: `      diagnose("dispatch", runId, UHP_UNRELATED_DRIFT, unrelatedDrift);`,
    to: `      void UHP_UNRELATED_DRIFT;`,
  },
  {
    id: "R16",
    file: "uhp-provider.ts",
    breaks: "drift on the selected harness is detected and then dispatched to anyway",
    from: `    if (selected.blocking.length > 0) {`,
    to: `    if (false as boolean) {`,
  },
  {
    id: "R17",
    file: "uhp-provider.ts",
    breaks: "the whole-manifest refusal is restored, so one edited console row halts every lane again",
    from: `    if (selected.blocking.length > 0) {`,
    to: `    if (drift.length > 0) {`,
  },
  {
    id: "R18",
    file: "uhp-provider.ts",
    breaks: "the F10 gate reads only the route comparison, so a declared fallback with an agreeing model is accepted",
    from: "const contradicted = [...new Set<RouteField>([...negatives.contradicted, ...stated.fields])];",
    to: "const contradicted = [...new Set<RouteField>([...negatives.contradicted])];",
  },
  {
    id: "R19",
    file: "uhp-provider.ts",
    breaks: "the dispatch reports its own prose instead of the gate's, losing the grounds for the acceptance",
    from: "      : `${decision.detail}; ${lifecycle}`;",
    to: "      : `the route was checked; ${lifecycle}`;",
  },
  {
    id: "R20",
    file: "uhp-gate.ts",
    breaks: "route evidence reports itself verified, which is the branch F2's certification bar hangs on",
    from: `  return { contradicted, unreported, unattested, unverified: !isRouteEvidenceVerified(evidence) };`,
    to: `  return { contradicted, unreported, unattested, unverified: !isRouteEvidenceVerified(evidence) && false };`,
  },
];

function suite() {
  try {
    const out = execFileSync("pnpm", ["--filter", "@rickylabs/subagents", "run", "test"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    return read(out);
  } catch (error) {
    return read(`${error.stdout ?? ""}${error.stderr ?? ""}`);
  }
}

function read(output) {
  const plain = output.replace(/\[[0-9;]*m/g, "");
  const failed = /^ℹ fail (\d+)$/m.exec(plain);
  const compileError = /error TS\d+/.test(plain);
  // node:test counts a failing suite as a failure alongside the test inside it, so `killed` — its own
  // `fail` total — is larger than the number of assertions that died. `leaves` is the indented half: the
  // individual tests. Both are recorded rather than one being presented as the other.
  const names = [...plain.matchAll(/^\s*✖ (.+?) \(/gm)].map((match) => match[1]);
  const leaves = [...plain.matchAll(/^ +✖ (.+?) \(/gm)].map((match) => match[1]);
  return {
    killed: failed === null ? (compileError ? "compile-error" : "unknown") : Number(failed[1]),
    compiled: !compileError,
    leaves: [...new Set(leaves)],
    tests: [...new Set(names)],
  };
}

const files = new Map();
for (const mutation of mutations) {
  const path = join(src, mutation.file);
  if (!files.has(path)) files.set(path, readFileSync(path, "utf8"));
}

const baseline = suite();
if (baseline.killed !== 0) {
  process.stderr.write(`the suite is not green before mutating (${JSON.stringify(baseline)}); refusing to attribute anything to a mutation\n`);
  process.exit(2);
}

const results = [];
for (const mutation of mutations) {
  const applied = [mutation, ...(mutation.with ?? []).map((id) => mutations.find((entry) => entry.id === id))];
  const touched = new Set();
  let ok = true;
  for (const entry of applied) {
    const path = join(src, entry.file);
    const before = readFileSync(path, "utf8");
    if (!before.includes(entry.from)) {
      ok = false;
      break;
    }
    writeFileSync(path, before.replace(entry.from, entry.to));
    touched.add(path);
  }
  const outcome = ok ? suite() : { killed: "not-applied", compiled: null, leaves: [], tests: [] };
  for (const path of touched) writeFileSync(path, files.get(path));
  results.push({
    id: mutation.id,
    file: mutation.file,
    with: mutation.with ?? [],
    breaks: mutation.breaks,
    ...outcome,
  });
  process.stdout.write(`${mutation.id} ${mutation.file}: killed ${outcome.killed}\n`);
}

// Restore everything unconditionally, then prove the tree is green again.
for (const [path, text] of files) writeFileSync(path, text);
const after = suite();

writeFileSync(
  join(here, "mutations.json"),
  `${JSON.stringify({ baseline, results, after, at: new Date().toISOString() }, null, 2)}\n`,
);
process.stdout.write(`\nbaseline fail ${baseline.killed}; after restore fail ${after.killed}\n`);
const zero = results.filter((entry) => entry.killed === 0 || typeof entry.killed === "string");
process.stdout.write(zero.length === 0 ? "every mutation killed at least one test\n" : `MUTATIONS THAT KILLED NOTHING: ${zero.map((entry) => `${entry.id} (${entry.killed})`).join(", ")}\n`);
