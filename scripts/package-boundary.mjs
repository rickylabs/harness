/**
 * The package-boundary guard: a package names only the workspace packages it is allowed to, through
 * their published entry points (doctrine rules 2 and 8). A host adapter (`packages/hosts/*`) may depend
 * on `@rickylabs/harness-contracts` and nothing else in the workspace, so it can never import telemetry,
 * which composes it.
 *
 * Two halves. `manifestProblems` reads a manifest and needs nothing; `scripts/check-project-graph.mjs`
 * applies it to every `packages/hosts/*` package, so a forbidden dependency fails even when its project
 * reference agrees. `sourceProblems` reads every TypeScript file of a package with TypeScript's own
 * `ts.preProcessFile` (static `import`, `import type`, `export … from`, `import x = require()`, dynamic
 * `import()`, `require()`, `import()` types and side-effect imports) and refuses a module name it cannot
 * read. Each host package runs it from its own `tests/architecture/` test.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join, relative, resolve, sep } from "node:path";

/** The only workspace package a host adapter may depend on. */
export const HOST_DEPENDENCIES = ["@rickylabs/harness-contracts"];

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/** Workspace or `@rickylabs/*` dependencies outside `allowed`, as `field: name` strings. */
export function manifestProblems(manifest, allowed = HOST_DEPENDENCIES) {
  const problems = [];
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, range] of Object.entries(manifest?.[field] ?? {})) {
      const workspace = typeof range === "string" && range.startsWith("workspace:");
      if ((workspace || name.startsWith("@rickylabs/")) && !allowed.includes(name)) {
        problems.push(`${field}: ${name} is not an allowed workspace dependency`);
      }
    }
  }
  return problems;
}

/** The import specifiers a package's published `exports` admit, e.g. `@scope/name` and `@scope/name/route`. */
export function entrySpecifiers(manifest) {
  const subpaths = Object.keys(manifest.exports ?? { ".": null });
  return subpaths.map((subpath) => subpath === "." ? manifest.name : `${manifest.name}/${subpath.slice(2)}`);
}

function reasonFor(specifier, file, packageRoot, entries) {
  if (specifier.startsWith(".")) {
    const inside = relative(packageRoot, resolve(file, "..", specifier));
    return inside.startsWith("..") || inside.startsWith(sep) ? `imports ${specifier}, outside the package` : null;
  }
  if (specifier.startsWith("node:") || isBuiltin(specifier)) return null;
  if (entries.includes(specifier)) return null;
  return `imports ${specifier}, which is not an allowed entry point`;
}

/**
 * Every finding in one source text. Pure apart from the TypeScript parser: the text is passed in, so the
 * guard's own test proves each forbidden form is caught without a filesystem.
 */
export async function importProblems(file, text, packageRoot, entries) {
  const { default: ts } = await import("typescript");
  const problems = ts.preProcessFile(text, true, true).importedFiles
    .map((row) => reasonFor(row.fileName, file, packageRoot, entries))
    .filter((reason) => reason !== null);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      !(node.arguments[0] !== undefined && ts.isStringLiteralLike(node.arguments[0]))) {
      problems.push("loads a module whose name is computed, so it cannot be checked");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return problems;
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "dist" || entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(c|m)?tsx?$/.test(entry) && !entry.endsWith(".d.ts")) files.push(path);
  }
  return files.sort();
}

/**
 * Check a whole package: its manifest and every TypeScript file under it. The caller asserts `files`
 * is not empty: an empty source certifies nothing.
 */
export async function packageProblems(packageRoot, entries, allowed = HOST_DEPENDENCIES) {
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const files = sourceFiles(packageRoot);
  const problems = manifestProblems(manifest, allowed).map((problem) => `package.json ${problem}`);
  for (const file of files) {
    const rel = relative(packageRoot, file).split(sep).join("/");
    for (const reason of await importProblems(file, readFileSync(file, "utf8"), packageRoot, entries)) {
      problems.push(`${rel}: ${reason}`);
    }
  }
  return { files, problems };
}
