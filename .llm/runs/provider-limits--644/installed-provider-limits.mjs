import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const [root,proof]=process.argv.slice(2);
const temp=mkdtempSync(join(tmpdir(),'installed-provider-limits-'));
try {
const consumer=join(temp,'consumer'),pack=join(temp,'pack'),home=join(temp,'home');for(const d of[consumer,pack,home])mkdirSync(d);
const npmrc=join(temp,'empty-npmrc');writeFileSync(npmrc,'');
const env={PATH:process.env.PATH,HOME:home,npm_config_userconfig:npmrc,npm_config_globalconfig:join(temp,'empty-global'),npm_config_cache:join(temp,'cache'),npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false'};writeFileSync(env.npm_config_globalconfig,'');
const run=(bin,args,cwd=temp)=>{const r=spawnSync(bin,args,{cwd,env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,'owned command must exit0');return r.stdout;};
const metadata=JSON.parse(run('npm',['pack',join(root,'packages/contracts'),'--json','--pack-destination',pack,'--ignore-scripts']))[0];
writeFileSync(join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',join(pack,metadata.filename)],consumer);
const {readProviderLimitSnapshot}=await import(pathToFileURL(join(consumer,'node_modules/@rickylabs/harness-contracts/dist/index.js')).href);
const produced=JSON.parse(readFileSync(proof,'utf8'));
const actualCLI=JSON.parse(run(process.execPath,[join(root,'packages/telemetry/dist/cli.js'),'provider-limits','--source',proof]));
assert.deepEqual(actualCLI,produced);
const decoded=readProviderLimitSnapshot(actualCLI);assert.equal(decoded.ok,true);assert.deepEqual(decoded.snapshot,produced);
assert.equal(readProviderLimitSnapshot({...produced,credential:'fixture-canary'}).ok,false);
writeFileSync(join(consumer,'consumer.ts'),`import {readProviderLimitSnapshot,type ProviderLimitSnapshotV1} from '@rickylabs/harness-contracts';\nconst value=readProviderLimitSnapshot(null);\nif(value.ok){const snapshot:ProviderLimitSnapshotV1=value.snapshot;console.log(snapshot.schemaVersion);}\n`);
run(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','consumer.ts'],consumer);
console.log(JSON.stringify({proof:'offline-installed-provider-limits',version:metadata.version,actualCLI:true,installedRootDecoder:true,installedTypeDeclarations:true,closedPrivacyNegative:true,exit:0,publication:'unproven'}));
}finally{rmSync(temp,{recursive:true,force:true});}
