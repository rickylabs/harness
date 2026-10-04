/** #271/#270: model and route choices live in data, including the pinned matrix adapter. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const identifiers = new Set(['model', 'effort', 'tier', 'lane', 'family', 'profile', 'preset', 'harness']);
// Exact files and identifiers, with ownership. These are mechanism vocabularies or test support,
// never a compatibility route accessor. Unlisted new assignments fail, regardless of spelling.
const allow = [
  { file: 'packages/contracts/src/client.ts', identifiers: ['harness', 'model'], values: ['an unnamed harness', 'an unnamed model'], reason: 'Presentation of missing identity; E8 (#38). No contract change.' },
  { file: 'packages/coordinator/src/render.ts', identifiers: ['effort'], values: [''], reason: 'Empty display suffix; E6 (#36).' },
  { file: 'packages/forge/src/swarm/teardown-render.ts', identifiers: ['harness'], values: [''], reason: 'Empty display suffix; E7 (#37).' },
  { file: 'packages/telemetry/src/cli.ts', identifiers: ['model'], values: ['model unrecorded'], reason: 'Missing-observation display; E9 (#39).' },
  { file: 'packages/telemetry/src/diagnostics.ts', identifiers: ['model'], values: [''], reason: 'Absent observation for diagnostic classification; E9 (#39).' },
  { file: 'experiments/routers/dsh/src/board-smoke-fixture.ts', identifiers: ['model', 'effort'], reason: 'Synthetic board projection smoke data; E2 (#204), no dispatch consumer.' },
  { file: 'packages/forge/src/labels/taxonomy.ts', identifiers: ['lane'], reason: 'Label palette color, not a routing lane assignment; E7 (#37).' },
  { file: 'packages/forge/src/swarm/teardown.ts', identifiers: ['harness'], values: [''], reason: 'Empty missing-harness sentinel in orphan evidence; E7 (#37).' },
  { file: 'packages/contracts/src/route.ts', identifiers: ['model', 'effort'], values: ['request.model', 'request.effort', 'thread/start.result.model', 'thread/start.result.reasoningEffort', 'opencode.message.providerID+modelID', 'opencode.message.variant'], reason: 'Canonical structural route provenance paths moved to the published contract; no routing values.' },
  { file: 'packages/routing/src/schema.ts', identifiers: ['harness'], reason: 'Structural schema vocabulary (#271).' },
  { file: 'packages/subagents/src/dispatch.ts', identifiers: ['harness'], reason: 'Executor harness vocabulary/default; E3 (#33), outside E11 step 1.' },
  { file: 'experiments/routers/dsh/src/dry-run-test-fixtures.ts', identifiers: [...identifiers], reason: 'Test-only fake dispatch fixture, not imported by production entry points (#271).' },
  { file: 'packages/subagents/src/uhp-mock.ts', identifiers: ['model', 'effort'], reason: 'Test-only UHP wire fixtures for spike S10 (#288); mock server, not exported from index.ts and not imported by any production entry point; E3 (#33).' },
  { file: 'packages/telemetry/src/backfill/claude.ts', identifiers: ['harness'], reason: 'Observed provider inference, owned by E9 (#39), not routing policy.' },
];
/** Model identities are configuration data, including compatibility aliases; comments are never parsed as literals. */
function modelIdentities() {
  const ids = new Set();
  for (const name of readdirSync('packages/routing/config').filter(name => name.endsWith('.json'))) {
    const value = JSON.parse(readFileSync(join('packages/routing/config', name), 'utf8'));
    for (const [key, model] of Object.entries(value.models ?? {})) {
      ids.add(key);
      for (const launch of model.launches ?? []) if (typeof launch.id === 'string') ids.add(launch.id);
    }
    for (const alias of Object.values(value.aliases ?? {})) if (typeof alias === 'string') ids.add(alias);
  }
  return ids;
}
function modelShaped(value, ids) {
  value = value.replace(/^\/+/, ''); // Template tails can begin with the dynamic provider's slash.
  if (ids.has(value)) return true;
  if (!/^[a-zA-Z][a-zA-Z0-9._/-]{0,255}$/.test(value) || /\.(?:ts|js|mjs|json|md)$/.test(value)) return false;
  const leaf = value.split('/').at(-1);
  const stem = leaf.split(/[-_]/)[0];
  const stems = new Set([...ids].map(id => id.split('/').at(-1).split(/[-_]/)[0]));
  return /[-_]v?\d/.test(leaf) && (stems.has(stem) || value.includes('/'));
}
function fixture(file) {
  return /(?:^|\/)(?:test-fixtures|fixtures)\//.test(file) || file.endsWith('.test.ts') || file.endsWith('_test.ts') ||
    allow.some(a => a.file === file && /fixture|mock/.test(a.reason));
}
function strings(node) {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isConditionalExpression(node)) return [...strings(node.whenTrue), ...strings(node.whenFalse)];
  if (ts.isBinaryExpression(node)) return [...strings(node.left), ...strings(node.right)];
  return (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) ? strings(node.expression) : [];
}
function literal(node) {
  if (!node) return false;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
  if (ts.isConditionalExpression(node)) return literal(node.whenTrue) || literal(node.whenFalse);
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) return literal(node.left) || literal(node.right);
  return (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) && literal(node.expression);
}
export function scan(file, source, exceptions = allow, identities = modelIdentities()) {
  if (fixture(file) || /(?:^|\/)config\//.test(file)) return [];
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const problems = [];
  function visit(node) {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && modelShaped(node.text, identities)) {
      const { line } = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
      problems.push(`${file}:${line + 1}: compiled model-id literal; move it to replaceable configuration`);
    }
    if (ts.isPropertyAssignment(node) || ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node)) {
      const name = node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : undefined;
      if ((identifiers.has(name) || /^(?:modelId|modelID|model_id)$/.test(name ?? '')) && literal(node.initializer) && !exceptions.some(a => a.file === file && a.identifiers.includes(name) && (a.values === undefined || strings(node.initializer).every(value => a.values.includes(value))))) {
        const { line } = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
        problems.push(`${file}:${line + 1}: compiled ${name} assignment`);
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && literal(node.right)) {
      const name = ts.isPropertyAccessExpression(node.left) ? node.left.name.text : ts.isIdentifier(node.left) ? node.left.text : undefined;
      if (identifiers.has(name)) {
        const { line } = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
        problems.push(`${file}:${line + 1}: compiled ${name} assignment`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return problems;
}
function main() {
// Mutation test on actual temporary files, every invocation. No old-id grep can satisfy it.
const scratch = mkdtempSync(join(tmpdir(), 'compiled-policy-'));
try {
  const file = join(scratch, 'fresh.ts');
  writeFileSync(file, 'const route = { model: "never-seen", effort: "fresh-effort" }; const tier = input ?? "fresh-tier"; route.model = "late-model";');
  assert.equal(scan(file, readFileSync(file, 'utf8'), []).length, 4);
  const test = join(scratch, 'fresh.test.ts');
  writeFileSync(test, readFileSync(file, 'utf8')); assert.deepEqual(scan(test, readFileSync(test, 'utf8')), []);
  writeFileSync(file, '// const route = { model: "never-seen" };\nconst route = { model: configuration.model };');
  assert.deepEqual(scan(file, readFileSync(file, 'utf8')), []);
} finally { rmSync(scratch, { recursive: true, force: true }); }
const root = process.cwd();
const sources = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.ts'], { encoding: 'utf8' }).trim().split('\n').filter(file => file && !file.startsWith('.llm/runs/') && !file.startsWith('docs/'));
const problems = sources.flatMap(file => scan(relative(root, join(root, file)), readFileSync(file, 'utf8')));
// The test fixture exception must never become an executable fallback through a runtime import.
for (const file of sources.filter(f => !f.endsWith('.test.ts') && !/dry-run-(child|test-fixtures)\.ts$/.test(f))) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.includes('dry-run-test-fixtures')) {
    problems.push(`${file}: runtime import of test-only routing fixture`);
  }
}
if (problems.length) { process.stderr.write(problems.join('\n') + '\n'); process.exitCode = 1; }
else process.stdout.write(`compiled routing policy: ${sources.length} sources checked; mutation self-test passed\n`);

}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
