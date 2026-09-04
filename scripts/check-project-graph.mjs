#!/usr/bin/env node
/**
 * Assert that every package's TypeScript project references mirror its workspace dependencies.
 *
 * Why this exists as a script rather than as a property of the build: it is not one. The
 * adversarial review of PR #91 removed `dsh-app`'s `../board` reference, cleaned every output and
 * reran `pnpm -r run build` — which exited 0, because pnpm had already built `board` from the
 * manifest dependency graph and TypeScript resolved its declaration through the package export.
 * A reference graph that is merely *correct* is not a reference graph that is *enforced*, and the
 * difference only shows up the day someone adds a dependency and forgets the reference.
 *
 * So the invariant is checked directly: for each package, the set of workspace dependencies must
 * equal the set of project references. Both directions are errors. A dependency with no reference
 * builds today and breaks incremental builds later; a reference with no dependency is a stale edge
 * that outlives whatever justified it.
 *
 * External dependencies are ignored — `@deepseek-ai/dsh` is a real package with no project to
 * reference. Only the `workspace:` protocol implies an edge in this graph.
 *
 * Exit codes: 0 the graph agrees, 1 it does not, 2 the workspace could not be read.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Strip full-line `//` comments so a commented tsconfig still parses. */
const readJson = (path) => {
  const raw = readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${relative(repoRoot, path)} is not parseable JSON: ${error.message}`);
  }
};

/**
 * Package roots from the workspace manifest, so adding a new glob is picked up here too rather
 * than silently leaving a whole directory unchecked.
 */
const workspaceGlobs = () => {
  const manifest = join(repoRoot, "pnpm-workspace.yaml");
  if (!existsSync(manifest)) throw new Error("pnpm-workspace.yaml not found");
  const roots = [];
  for (const line of readFileSync(manifest, "utf8").split("\n")) {
    const m = /^\s*-\s*['"]?([^'"#]+?)['"]?\s*$/.exec(line);
    if (m && m[1].endsWith("/*")) roots.push(m[1].slice(0, -2));
  }
  if (roots.length === 0) throw new Error("pnpm-workspace.yaml declares no directory globs");
  return roots;
};

const discover = () => {
  const packages = [];
  for (const root of workspaceGlobs()) {
    const base = join(repoRoot, root);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const dir = join(base, entry.name);
      const manifestPath = join(dir, "package.json");
      if (!existsSync(manifestPath)) continue;
      packages.push({ dir, manifest: readJson(manifestPath) });
    }
  }
  return packages;
};

const main = () => {
  const packages = discover();
  if (packages.length === 0) throw new Error("no workspace packages found");

  // name -> directory, so a reference path can be named in errors the way humans refer to it.
  const dirOf = new Map(packages.map((p) => [p.manifest.name, p.dir]));
  const problems = [];

  for (const { dir, manifest } of packages) {
    const rel = relative(repoRoot, dir).replaceAll("\\", "/");
    const tsconfigPath = join(dir, "tsconfig.json");
    if (!existsSync(tsconfigPath)) {
      problems.push(`${rel}: has package.json but no tsconfig.json`);
      continue;
    }

    const declared = { ...manifest.dependencies, ...manifest.devDependencies };
    const expected = new Set();
    for (const [name, range] of Object.entries(declared)) {
      if (typeof range !== "string" || !range.startsWith("workspace:")) continue;
      const target = dirOf.get(name);
      if (target === undefined) {
        problems.push(`${rel}: depends on ${name} with the workspace protocol, but no such package`);
        continue;
      }
      expected.add(target);
    }

    const tsconfig = readJson(tsconfigPath);
    const actual = new Set();
    for (const reference of tsconfig.references ?? []) {
      if (typeof reference?.path !== "string") {
        problems.push(`${rel}/tsconfig.json: a reference has no string path`);
        continue;
      }
      const target = resolve(dir, reference.path);
      if (!existsSync(join(target, "tsconfig.json"))) {
        problems.push(`${rel}: references ${reference.path}, which is not a TypeScript project`);
        continue;
      }
      actual.add(target);
    }

    const name = (target) => relative(repoRoot, target).replaceAll("\\", "/");
    for (const target of expected) {
      if (!actual.has(target)) {
        problems.push(
          `${rel}: depends on ${name(target)} but does not reference it — ` +
            `add { "path": "${relative(dir, target).replaceAll("\\", "/")}" } to tsconfig.json`,
        );
      }
    }
    for (const target of actual) {
      if (!expected.has(target)) {
        problems.push(
          `${rel}: references ${name(target)} but does not depend on it — ` +
            `add it to package.json, or drop the reference`,
        );
      }
    }
  }

  if (problems.length > 0) {
    console.error(`project graph check failed — ${problems.length} problem(s):\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    console.error("\nEvery workspace dependency must have a matching project reference, and no");
    console.error("reference may outlive the dependency that justified it.");
    return 1;
  }

  console.log(`project graph ok — ${packages.length} packages, references match dependencies`);
  return 0;
};

try {
  process.exitCode = main();
} catch (error) {
  console.error(`project graph check could not run: ${error.message}`);
  process.exitCode = 2;
}
