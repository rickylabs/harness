import {strict as assert} from 'node:assert';
const [prefix,checkout]=Deno.args;
const base=new URL(`file://${checkout}/`),module=(p:string)=>import(new URL(p,base).href);
const [{createProviderLimitReader},{composeHomeUsage},{composeCostRows},{buildLaunchCatalog,routeStatus},{assertProviderRoute},{accountUsageFixture},{ORPCError}]=await Promise.all([module('services/cockpit-api/src/provider-limit-reader.ts'),module('services/cockpit-api/src/routers/home-usage.ts'),module('services/cockpit-api/src/routers/cost-rows.ts'),module('services/cockpit-api/src/routers/launch-catalog.ts'),module('services/cockpit-api/src/routers/launch-admission.ts'),module('tests/fixtures/harness-account-usage-029.ts'),import('@orpc/server')]);
const before=JSON.parse(await Deno.readTextFile(prefix+'-before.json')),after=JSON.parse(await Deno.readTextFile(prefix+'-after.json'));
const now=new Date(after.generatedAt);
const temp=await Deno.makeTempDir(),path=temp+'/source.json';
try{
const reader=createProviderLimitReader(path,()=>now),context={providerLimitSource:reader};
const native=accountUsageFixture();
const facts=(rows:any)=>({revision:'a'.repeat(40),profileRevision:'b'.repeat(40),tier:'feature',role:'implementation',status:routeStatus(null),ownerAuthority:{state:'available',revision:'c'.repeat(64),reason:null,message:null},inventory:[{transport:'codex',model:'fixture',label:'Fixture',family:'fixture',roleAllowed:true}],discovery:null,option:null,dispatchCatalogRevision:null,recommendation:null,budget:{maxTokens:'1000',tokenLimit:1000},unavailableTransports:[],observedTransports:['codex'],openCodeProviderPools:[],host:'fixture-host',modelProviders:[{transport:'codex',model:'fixture',provider:'codex'}],providerLimits:rows});
const catalog=(rows:any)=>buildLaunchCatalog({profile:'leaf',limit:50,admissionVersion:1,repositoryId:'1',issueNumber:1},facts(rows),now);
await Deno.writeTextFile(path,JSON.stringify(before),{mode:0o600});
const old=await reader(),oldRows=composeHomeUsage(native,now,undefined,old).providerLimits;
assert.equal((await catalog(oldRows)).launchOptions[0].availability.state,'unavailable');
await assert.rejects(()=>assertProviderRoute(context,{harness:'codex',model:'fixture'}),(e:any)=>e instanceof ORPCError&&e.code==='CONFLICT');
await Deno.writeTextFile(path,JSON.stringify(after),{mode:0o600});
const current=await reader(),rows=composeHomeUsage(native,now,undefined,current).providerLimits;
assert.equal((await catalog(rows)).launchOptions[0].availability.state,'available');
await assertProviderRoute(context,{harness:'codex',model:'fixture'});
const costs=composeCostRows(native,now,rows);assert(costs.providerLimits.some((r:any)=>r.refusal?.accountRef===before.outcomes[0].accountRef&&r.blocking));
assert(current.outcomes.some((o:any)=>o.outcome==='refused'&&o.accountRef===before.outcomes[0].accountRef));
const restarted=await createProviderLimitReader(path,()=>now)();
assert.equal((await catalog(composeHomeUsage(native,now,undefined,restarted).providerLimits)).launchOptions[0].availability.state,'available');
console.log(JSON.stringify({proof:'actual-produced-binding-retirement',beforePickerAndAdmissionBlock:true,retainedReaderDropsOldBinding:true,afterPickerAndAdmissionAllow:true,oldRefusalRemainsInCosts:true,producerAndConsumerRestart:true,fixtureOnly:true,exit:0}));
}finally{await Deno.remove(temp,{recursive:true});}
