/** Supplemental gate, not a PASS for the unmodified `pnpm run test` command.
 * Preserve the existing source-built producer and existing installed-gate source. Execute a
 * temp copy with its two immutable 0.3.0 expectations adapted to the 0.4.0 candidate. Relocate
 * only its root and fixture import so its complete synthetic matrix still runs outside Git.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const sourcePath = join(root, 'scripts/check-installed-contracts.mjs');
const source = readFileSync(sourcePath, 'utf8');
const scratch = mkdtempSync('/home/agent/recovery265-installed-');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const replacements = [
  ['assert.equal(metadata.version, "0.3.0");', 'assert.equal(metadata.version, "0.4.0");'],
  ['assert.equal(pkg.version, "0.3.0");', 'assert.equal(pkg.version, "0.4.0");'],
  ['const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");', `const root = ${JSON.stringify(root)};`],
  ['"../packages/telemetry/test-fixtures/run-observation/matrix.mjs"', JSON.stringify(pathToFileURL(join(root, 'packages/telemetry/test-fixtures/run-observation/matrix.mjs')).href)],
];
let candidate = source;
for (const [from, to] of replacements) {
  assert.equal(candidate.split(from).length, 2, 'expected exactly one replacement site');
  candidate = candidate.replace(from, to);
}
try {
  const script = join(scratch, 'installed.mjs');
  // createRequire in the copied script must resolve the existing workspace TypeScript.
  const tscSite = 'require.resolve("typescript/bin/tsc")';
  assert.equal(candidate.split(tscSite).length, 2);
  const { createRequire } = await import('node:module');
  candidate = candidate.replace(tscSite, JSON.stringify(createRequire(import.meta.url).resolve('typescript/bin/tsc')));
  writeFileSync(script, candidate);
  const stdout = execFileSync(process.execPath, [script], {
    cwd: root, env: { PATH: process.env.PATH, TMPDIR: scratch },
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 120_000,
  });
  const results = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(results.length, 2);
  for (const result of results) { assert.equal(result.status, 'PASS'); assert.equal(result.version, '0.4.0'); }
  const receipt = { check: 'supplemental-installed-candidate', status: 'PASS', node: process.version,
    originalGateSha256: sha256(source), executableSha256: sha256(candidate),
    wrapperSha256: sha256(readFileSync(new URL(import.meta.url))),
    changes: ['two version assertions 0.3.0 -> 0.4.0', 'root, fixture import and compiler resolution relocated only'],
    results, limitations: ['does not change the unmodified root test failure', 'synthetic only; no publication or adoption',
      'source-built producer unchanged; temporary gate copy only'] };
  assert.equal(readFileSync(sourcePath, 'utf8'), source);
  writeFileSync(join(root, '.llm/runs/connection-recovery--265/installed-candidate-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ check: receipt.check, status: receipt.status,
    results: results.map(r => ({ check: r.check, version: r.version, fixtureCount: r.fixtureCount ?? r.fixtures.length, sha256: r.sha256 })) }));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
