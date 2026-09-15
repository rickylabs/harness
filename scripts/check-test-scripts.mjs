// A recursive test run skips a package that declares no test script and the aggregate still
// succeeds, so an uncovered package is indistinguishable from a covered and passing one in every
// report anyone reads, including CI. This gate makes the absence say its own name.
//
// Being uncovered is allowed. Being uncovered *by omission* is not: an exemption must be declared
// here with a reason and with the condition that retires it. A stale exemption is itself a failure,
// so the list cannot quietly outlive the situation that justified it.
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { INCONCLUSIVE_EXIT, Inconclusive, inconclusiveRecord } from "./inconclusive.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Packages declared as carrying no tests, each with the condition that removes the entry. */
export const DECLARED_UNCOVERED = [
  { name: "governance", reason: "Single source file, no behaviour to cover. ARCHITECTURE.md section 10 parks the dsh plugin layer rather than deleting it. Remove this entry when the package gains behaviour." },
  { name: "netscript-bridge", reason: "Single source file, no behaviour to cover. ARCHITECTURE.md section 10 parks the dsh plugin layer rather than deleting it. Remove this entry when the package gains behaviour." },
  { name: "provider-acp", reason: "Single source file, no behaviour to cover. ARCHITECTURE.md section 10 parks the dsh plugin layer rather than deleting it. Remove this entry when the package gains behaviour." },
];

/** Pure so the test can drive it without a filesystem. */
export function auditTestScripts(packages, declared) {
  const byName = new Map(packages.map(p => [p.name, p]));
  const declaredNames = new Set(declared.map(d => d.name));
  const undeclared = packages.filter(p => !p.hasTestScript && !declaredNames.has(p.name)).map(p => p.name);
  const stale = declared.filter(d => byName.get(d.name)?.hasTestScript === true).map(d => d.name);
  const absent = declared.filter(d => !byName.has(d.name)).map(d => d.name);
  const unreasoned = declared.filter(d => typeof d.reason !== "string" || d.reason.trim().length === 0).map(d => d.name);
  return { undeclared, stale, absent, unreasoned, covered: packages.filter(p => p.hasTestScript).map(p => p.name) };
}

export function readPackages(from = root) {
  const directory = join(from, "packages");
  let packages;
  try {
    packages = readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .flatMap(entry => {
        let content;
        try { content = readFileSync(join(directory, entry.name, "package.json"), "utf8"); } catch (error) {
          // A directory without a manifest is not a package. An inaccessible manifest is unknown.
          if (error.code === "ENOENT") return [];
          throw error;
        }
        const manifest = JSON.parse(content);
        return [{ name: entry.name, hasTestScript: typeof manifest.scripts?.test === "string" && manifest.scripts.test.trim().length > 0 }];
      });
  } catch (error) {
    if (typeof error.code !== "string" || typeof error.syscall !== "string") throw error;
    throw new Inconclusive("workspace-unreadable",
      "workspace test coverage could not be inspected; restore access to packages/*/package.json");
  }
  if (packages.length === 0) {
    throw new Inconclusive("workspace-empty",
      "no workspace packages were discovered; verify the checkout and packages/* inventory before reading coverage");
  }
  return packages;
}

function main() {
  const packages = readPackages();
  const result = auditTestScripts(packages, DECLARED_UNCOVERED);
  const problems = [
    ...result.undeclared.map(n => `${n}: declares no test script and is not declared uncovered. Add a test script, or add an entry with a reason to DECLARED_UNCOVERED in scripts/check-test-scripts.mjs.`),
    ...result.stale.map(n => `${n}: declared uncovered but now declares a test script. Remove its DECLARED_UNCOVERED entry.`),
    ...result.absent.map(n => `${n}: declared uncovered but no such package exists. Remove its DECLARED_UNCOVERED entry.`),
    ...result.unreasoned.map(n => `${n}: declared uncovered with no reason. An exemption without a reason is an omission with extra steps.`),
  ];

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(`check:test-scripts failed — ${problems.length} problem(s) across ${packages.length} package(s)`);
    process.exitCode = 1;
  } else {
    console.log(`check:test-scripts ok — ${result.covered.length} of ${packages.length} package(s) declare a test script; ${DECLARED_UNCOVERED.length} declared uncovered with a reason (${DECLARED_UNCOVERED.map(d => d.name).join(", ")})`);
  }
}

// Imports expose the audit without running the repository gate as a side effect.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    if (error instanceof Inconclusive) {
      console.log(JSON.stringify(inconclusiveRecord("check:test-scripts", "workspace inventory", error)));
      process.exitCode = INCONCLUSIVE_EXIT;
    } else {
      console.log(JSON.stringify({ check: "check:test-scripts", status: "FAIL", reason: "invalid-workspace-manifest" }));
      process.exitCode = 1;
    }
  }
}
