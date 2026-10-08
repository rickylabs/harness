import {strict as assert} from 'node:assert';
const [sourceFile, checkout] = Deno.args;
const base = new URL(`file://${checkout}/`);
const module = (p:string)=>import(new URL(p,base).href);
const [{ProviderLimitSnapshotSchemaV1,SUBSCRIPTION_PROVIDERS},{createProviderLimitReader},{composeHomeUsage},{composeCostRows},{buildLaunchCatalog,routeStatus},{assertProviderRoute},{accountUsageFixture},{createCockpitApiService},{createStaticCredentialAuthenticator},{ORPCError}] = await Promise.all([
module('contracts/versions/v1/provider-limits.ts'),module('services/cockpit-api/src/provider-limit-reader.ts'),module('services/cockpit-api/src/routers/home-usage.ts'),module('services/cockpit-api/src/routers/cost-rows.ts'),module('services/cockpit-api/src/routers/launch-catalog.ts'),module('services/cockpit-api/src/routers/launch-admission.ts'),module('tests/fixtures/harness-account-usage-029.ts'),module('services/cockpit-api/src/service.ts'),import('@netscript/service/auth'),import('@orpc/server')]);
const produced=ProviderLimitSnapshotSchemaV1.parse(JSON.parse(await Deno.readTextFile(sourceFile)));
const now=new Date(produced.generatedAt);
const reader=createProviderLimitReader(sourceFile,()=>now);
const source=await reader();assert.deepEqual(source,produced);
const native=accountUsageFixture();
const home=composeHomeUsage(native,now,undefined,source);
const rows=home.providerLimits;
const costs=composeCostRows(native,now,rows);
assert(costs.providerLimits.some((r:any)=>r.provider==='codex'&&r.accountRef===null&&r.blocking));
assert(rows.some((r:any)=>r.provider==='codex'&&r.accountRef!==null));
assert(rows.filter((r:any)=>r.provider==='codex'&&r.accountRef!==null).every((r:any)=>!r.blocking));
for(const p of SUBSCRIPTION_PROVIDERS)assert(rows.some((r:any)=>r.provider===p));
assert(rows.some((r:any)=>r.provider==='codex'&&r.window==='5h'&&r.usedPercent===90&&r.warning));
assert(rows.some((r:any)=>r.provider==='codex'&&r.window==='weekly'&&r.usedPercent===100&&r.warning));
assert.equal(rows.find((r:any)=>r.keyName==='small-cap').warning,true);
assert.equal(rows.find((r:any)=>r.keyName==='large-cap').warning,false);
const inventory=[{transport:'codex',model:'fixture',label:'Fixture',family:'fixture',roleAllowed:true},...['vendor/model','vendor/other'].map(model=>({transport:'opencode',model:`openrouter/${model}`,label:model,family:'fixture',roleAllowed:true}))];
const facts={revision:'a'.repeat(40),profileRevision:'b'.repeat(40),tier:'feature',role:'implementation',status:routeStatus(null),ownerAuthority:{state:'available',revision:'c'.repeat(64),reason:null,message:null},inventory,discovery:null,option:null,dispatchCatalogRevision:null,recommendation:null,budget:{maxTokens:'1000',tokenLimit:1000},unavailableTransports:[],observedTransports:['codex','opencode'],openCodeProviderPools:[{provider:'openrouter',maxActive:1,active:0}],host:'fixture-host',modelProviders:inventory.map((i:any)=>({transport:i.transport,model:i.model,provider:i.transport==='codex'?'codex':'openrouter'})),providerLimits:rows};
const catalog=await buildLaunchCatalog({profile:'leaf',limit:50,admissionVersion:1,repositoryId:'1',issueNumber:1},facts,now);
assert.equal(catalog.launchOptions.find((r:any)=>r.harness==='codex').availability.state,'unavailable');
for(const r of catalog.launchOptions.filter((r:any)=>r.harness==='opencode'))assert.equal(r.availability.state,'available');
const context={providerLimitSource:reader};
await assert.rejects(()=>assertProviderRoute(context,{harness:'codex',model:'fixture'}),(e:any)=>e instanceof ORPCError&&e.code==='CONFLICT'&&/Usage limit reached/.test(e.message));
for(const model of ['vendor/model','vendor/other'])await assertProviderRoute(context,{harness:'opencode',router:'openrouter',model:`openrouter/${model}`});
const service=await createCockpitApiService({authenticator:createStaticCredentialAuthenticator({credentials:{'fixture-provider-limits-token':{subject:'fixture-owner'}}}),homeUsageReader:()=>Promise.resolve(native),providerLimitSource:reader}).serve({port:0,handleSignals:false});
try {
const url=`http://127.0.0.1:${service.addr.port}/api/ui/costs`;
const anonymous=await fetch(url);await anonymous.body?.cancel();assert.equal(anonymous.status,401);
const response=await fetch(url,{headers:{Authorization:'Bearer fixture-provider-limits-token'}});assert.equal(response.status,200);
const body=await response.json();assert(body.providerLimits.some((r:any)=>r.provider==='codex'&&r.accountRef===null&&r.blocking));assert.equal(JSON.stringify(body).includes('fixture-provider-limits-token'),false);
}finally{await service.stop();}
console.log(JSON.stringify({proof:'actual-produced-snapshot',closedSchema:true,privateReader:true,nativeAccountRows:true,globalCodexPickerBlocks:true,globalCodexAdmissionBlocks:true,subscription90And100Warn:true,namedKey100WarnsAndLaunches:true,authenticatedCosts200:true,anonymousCosts401:true,fixtureOnly:true,liveDeployment:'unproven'}));
