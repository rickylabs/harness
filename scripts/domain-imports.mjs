/**
 * The domain-layer import guard: `src/domain/` imports nothing outward (doctrine rule 8).
 *
 * A package's domain is pure types and rules. It may import other files inside `src/domain/` and
 * types from `@rickylabs/harness-contracts`, and nothing else: no vendor SDK, no `node:` builtin
 * (so no `node:child_process` and no `node:net`), no other workspace package — not even type-only,
 * because erasure removes the runtime edge but not the dependency — and no reference to the global
 * `fetch`. Everything that needs one of those belongs in `ports/`, `application/` or `adapters/`.
 *
 * The analysis uses the TypeScript parser rather than a regex, so a comment that mentions `fetch` or
 * an import inside a string is not a finding, and every way a module can be reached is seen: static
 * `import` / `export … from`, `import x = require()`, dynamic `import()`, `require()` and `import()`
 * types. Each provider package runs this from its own `tests/architecture/` test.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";

import ts from "typescript";

/** The only package a domain file may name, and only for types (doctrine rule 8). */
export const CONTRACTS = "@rickylabs/harness-contracts";

/** Vendor SDK scopes. Named so a finding says which rule it broke. */
export const VENDOR_SCOPES = ["@anthropic-ai/", "@openai/", "@opencode-ai/"];

/** The globals through which `fetch` can be reached by property access. */
const GLOBAL_OBJECTS = new Set(["globalThis", "self", "window", "global"]);

function reasonFor(specifier, typeOnly, file, domainRoot) {
  if (specifier.startsWith(".")) {
    const target = resolve(dirname(file), specifier);
    const inside = relative(domainRoot, target);
    return inside.startsWith("..") || inside.startsWith(sep) ? "imports outside src/domain" : null;
  }
  if (specifier.startsWith("node:") || isBuiltin(specifier)) return `imports the Node builtin ${specifier}`;
  if (VENDOR_SCOPES.some((scope) => specifier.startsWith(scope))) return `imports the vendor SDK ${specifier}`;
  if (specifier === CONTRACTS || specifier.startsWith(`${CONTRACTS}/`)) {
    return typeOnly ? null : `imports a value from ${specifier}; only types are allowed`;
  }
  return `imports the package ${specifier}`;
}

function importIsTypeOnly(node) {
  const clause = node.importClause;
  if (clause === undefined) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name !== undefined) return false;
  const bindings = clause.namedBindings;
  return bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly);
}

function exportIsTypeOnly(node) {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  return clause !== undefined && ts.isNamedExports(clause) && clause.elements.length > 0 &&
    clause.elements.every((element) => element.isTypeOnly);
}

/** A reference to the global `fetch`, as opposed to a property or a declaration that happens to be named so. */
function isFetchReference(node) {
  const parent = node.parent;
  if (parent === undefined) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    return ts.isIdentifier(parent.expression) && GLOBAL_OBJECTS.has(parent.expression.text);
  }
  if ((ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent) ||
    ts.isMethodSignature(parent) || ts.isMethodDeclaration(parent) || ts.isParameter(parent) ||
    ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isBindingElement(parent) ||
    ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) && parent.name === node) {
    return false;
  }
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  return true;
}

/**
 * Every finding in one domain source file. Pure: the text is passed in, so the guard's own test can
 * prove each forbidden form is caught without a filesystem.
 *
 * @param {string} file absolute path of the file (used to resolve relative specifiers)
 * @param {string} text the file's source
 * @param {string} domainRoot absolute path of the package's `src/domain`
 * @returns {{ line: number, reason: string }[]}
 */
export function importProblems(file, text, domainRoot) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const problems = [];
  const report = (node, reason) => {
    if (reason === null) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    problems.push({ line: line + 1, reason });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      report(node, reasonFor(node.moduleSpecifier.text, importIsTypeOnly(node), file, domainRoot));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)) {
      report(node, reasonFor(node.moduleSpecifier.text, exportIsTypeOnly(node), file, domainRoot));
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)) {
      report(node, reasonFor(node.moduleReference.expression.text, node.isTypeOnly, file, domainRoot));
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)) {
      report(node, reasonFor(node.argument.literal.text, true, file, domainRoot));
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = node.expression;
      const dynamic = callee.kind === ts.SyntaxKind.ImportKeyword;
      const required = ts.isIdentifier(callee) && callee.text === "require";
      const first = node.arguments[0];
      if ((dynamic || required) && first !== undefined && ts.isStringLiteralLike(first)) {
        report(node, reasonFor(first.text, false, file, domainRoot));
      } else if (dynamic || required) {
        report(node, "loads a module whose name is computed, so it cannot be checked");
      }
    } else if (ts.isIdentifier(node) && node.text === "fetch" && isFetchReference(node)) {
      report(node, "references the global fetch");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return problems;
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(c|m)?tsx?$/.test(entry) && !entry.endsWith(".d.ts")) files.push(path);
  }
  return files.sort();
}

/**
 * Check a package's whole `src/domain`. The caller asserts `files` is not empty: an empty source
 * certifies nothing.
 *
 * @param {string} packageRoot absolute path of the package
 * @returns {{ files: string[], problems: string[] }} findings as `src/domain/x.ts:line reason`
 */
export function domainProblems(packageRoot) {
  const domainRoot = join(packageRoot, "src", "domain");
  const files = sourceFiles(domainRoot);
  const problems = files.flatMap((file) =>
    importProblems(file, readFileSync(file, "utf8"), domainRoot).map(({ line, reason }) =>
      `${relative(packageRoot, file).split(sep).join("/")}:${line} ${reason}`));
  return { files, problems };
}
