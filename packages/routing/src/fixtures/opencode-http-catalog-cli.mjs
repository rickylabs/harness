#!/usr/bin/env node
/** Native metadata-only fixture: piped CLI prefix versus complete authenticated HTTP catalog. */
import { readFileSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
const data = JSON.parse(readFileSync('data.json', 'utf8'));
const args = process.argv.slice(2), behavior = data.behavior;
const note = value => appendFileSync('commands.jsonl', JSON.stringify(value) + '\n');
note({ args, pid: process.pid });
if (args[0] === '--version') {
  console.log(behavior === 'unverified' ? data.unverifiedVersion : data.version);
  process.exit(0);
}
if (args[0] === 'models') {
  const first = data.models[0];
  if (behavior === 'truncated' || behavior === 'complete-prefix') {
    const full = first.providerID + '/' + first.id + '\n' + JSON.stringify(first) + '\n';
    process.stdout.write(behavior === 'truncated' ? full.slice(0, -7) : full);
    process.exit(0);
  }
  for (const model of data.models) console.log(model.providerID + '/' + model.id + '\n' + JSON.stringify(model));
  process.exit(0);
}
if (args[0] !== 'serve') process.exit(2);
const server = createServer((req, res) => {
  const authorized = req.headers.authorization === 'Basic ' + Buffer.from(process.env.OPENCODE_SERVER_USERNAME + ':' + process.env.OPENCODE_SERVER_PASSWORD).toString('base64');
  note({ endpoint: req.url, authorized });
  if (!authorized || !['/config/providers', '/provider'].includes(req.url)) { res.writeHead(403); res.end(); return; }
  if (req.url === '/provider') { res.end(JSON.stringify({ connected: data.connections })); return; }
  if (behavior === 'refused') { res.writeHead(503); res.end(); return; }
  if (behavior === 'redirect') { res.writeHead(302, { Location: '/provider' }); res.end(); return; }
  if (behavior === 'timeout') return;
  const providers = [...new Set(data.models.map(m => m.providerID))].map(id => ({ id, models: Object.fromEntries(data.models.filter(m => m.providerID === id).map(m => [m.id, structuredClone(m)])) }));
  const first = providers[0], model = Object.values(first.models)[0];
  if (behavior === 'empty') providers.length = 0;
  if (behavior === 'provider-duplicate') providers.push({ ...first, models: {} });
  if (behavior === 'provider-type') first.id = 1;
  if (behavior === 'models-array') first.models = [];
  if (behavior === 'model-id') model.id = data.models[3].id;
  if (behavior === 'model-provider') model.providerID = data.models[3].providerID;
  if (behavior === 'provider-limit') for (let i = providers.length; i < 513; i++) providers.push({ id: 'fixture-' + i, models: {} });
  if (behavior === 'providers-missing') { res.end(JSON.stringify({ default: {} })); return; }
  if (behavior === 'model-limit') for (const p of providers.slice(0, 2)) for (let i = 0; i < 2050; i++) p.models['fixture-' + i] = { id: 'fixture-' + i, providerID: p.id, variants: {} };
  const body = JSON.stringify({ providers, default: {}, private: behavior === 'default-bound' ? 'x'.repeat(1024 * 1024) : 'PRIVATE_CANARY' });
  if (behavior === 'duplicate-json') { res.end(body.replace('"variants":{}', '"variants":{},"variants":{}')); return; }
  if (behavior === 'http-truncated') { res.end(body.slice(0, -7)); return; }
  if (behavior === 'invalid-utf8') { res.end(Buffer.concat([Buffer.from(body.slice(0, -2)), Buffer.from([0xff]), Buffer.from('"}') ])); return; }
  res.end(body);
});
server.listen(0, '127.0.0.1', () => console.log('opencode server listening on http://127.0.0.1:' + server.address().port));
