#!/usr/bin/env node
/** OpenCode 2.x metadata fixture: `--version`, an authenticated loopback `serve` with only `GET /api/model` and
 * `GET /api/integration`, and `api model.list --standalone`. Data comes only from the test cwd; no turns. */
import { readFileSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
const data = JSON.parse(readFileSync('data.json', 'utf8'));
const args = process.argv.slice(2), behavior = data.behavior;
const note = value => appendFileSync('commands.jsonl', JSON.stringify(value) + '\n');
note({ args, pid: process.pid, database: process.env.OPENCODE_DB ?? null,
  legacyAuth: process.env.OPENCODE_SERVER_USERNAME !== undefined || process.env.OPENCODE_SERVER_PASSWORD !== undefined });
if (args[0] === '--version') {
  // 2.x prints `opencode v<version>`.
  console.log('opencode v' + (behavior === 'unverified' ? data.unverifiedVersion : data.version));
  process.exit(0);
}
function modelBody() {
  const models = data.models.map(original => {
    const m = structuredClone(original);
    if (behavior === 'missing') delete m.variants;
    if (behavior === 'opaque') m.variants = data.opaqueVariants;
    if (behavior === 'disabled') m.variants = data.disabledVariants;
    if (behavior === 'null') m.variants = null;
    if (behavior === 'object-variants') m.variants = {};
    if (behavior === 'enabled-missing') delete m.enabled;
    return m;
  });
  if (behavior === 'empty') models.length = 0;
  if (behavior === 'model-duplicate') models.push(structuredClone(models[0]));
  if (behavior === 'provider-type') models[0].providerID = 1;
  if (behavior === 'model-disabled') models[0].enabled = false;
  if (behavior === 'model-limit') for (let i = 0; i < 4100; i++) models.push({ ...structuredClone(data.models[0]), id: 'fixture-' + i });
  if (behavior === 'data-missing') return JSON.stringify({ location: { directory: 'fixture' } });
  const body = JSON.stringify({ location: { directory: 'fixture' }, data: models,
    private: behavior === 'default-bound' ? 'x'.repeat(1024 * 1024) : 'PRIVATE_CANARY' });
  return behavior === 'duplicate' ? body.replace('"variants":[]', '"variants":[],"variants":[]') : body;
}
if (args[0] === 'api') {
  if (args.join(' ') !== 'api model.list --standalone') process.exit(2);
  process.stdout.write(modelBody() + '\n');
  process.exit(0);
}
if (args[0] !== 'serve') process.exit(2);
const expected = 'Basic ' + Buffer.from('opencode:' + process.env.OPENCODE_PASSWORD).toString('base64');
const server = createServer((req, res) => {
  const authorized = Boolean(process.env.OPENCODE_PASSWORD) && req.headers.authorization === expected;
  note({ endpoint: req.url, authorized });
  if (!authorized || !['/api/model', '/api/integration'].includes(req.url) ||
      (req.url === '/api/integration' && behavior === 'auth-failed')) { res.writeHead(403); res.end(); return; }
  if (req.url === '/api/integration') {
    const connected = id => ({ id, name: id, methods: [], connections: [{ type: 'env', name: 'FIXTURE_KEY' }] });
    const needsAuth = id => ({ id, name: id, methods: [], connections: [{ type: 'credential', id: 'crd_fixture', label: 'PRIVATE_CANARY',
      method: 'key', status: { status: 'needs_auth', message: 'PRIVATE_CANARY' } }] });
    res.end(JSON.stringify({ location: { directory: 'fixture' }, data: [...data.connections.map(connected),
      ...(data.needsAuth ?? []).map(needsAuth), { id: 'fixture-unconnected', name: 'Unconnected', methods: [], connections: [] }] }));
    return;
  }
  if (behavior === 'refused') { res.writeHead(503); res.end(); return; }
  if (behavior === 'redirect') { res.writeHead(302, { Location: '/api/integration' }); res.end(); return; }
  if (behavior === 'timeout') return;
  const body = modelBody();
  if (behavior === 'http-truncated') { res.end(body.slice(0, -7)); return; }
  if (behavior === 'invalid-utf8') { res.end(Buffer.concat([Buffer.from(body.slice(0, -2)), Buffer.from([0xff]), Buffer.from('"}')])); return; }
  res.end(body);
});
server.listen(0, '127.0.0.1', () => console.log('server listening on http://127.0.0.1:' + server.address().port));
