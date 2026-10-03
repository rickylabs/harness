import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverCliCapabilities, validateCliDiscoverySnapshot, type CliDiscoveryOptions, type DiscoveryLauncher } from "./discovery.js";

/** All model-bearing case data lives in JSON; fake binaries only, never native turns. */
async function fixture(run: (cwd: string, binary: (kind: string, behavior?: string) => Promise<string>, data: any) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), "discovery-facts-"));
  const data = JSON.parse(await readFile(new URL("../src/fixtures/discovery-facts.json", import.meta.url), "utf8"));
  const dataPath = join(cwd, "data.json"); await writeFile(dataPath, JSON.stringify(data), { mode: 0o600 });
  async function binary(kind: string, behavior = "normal") {
    const path = join(cwd, kind + "-" + behavior);
    await writeFile(path, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
const kind=${JSON.stringify(kind)}, behavior=${JSON.stringify(behavior)}, data=JSON.parse(readFileSync(${JSON.stringify(dataPath)},'utf8'));
const log=${JSON.stringify(join(cwd, "commands.jsonl"))}, args=process.argv.slice(2);
const note=value=>appendFileSync(log,JSON.stringify(value)+'\\n'); note({args,pid:process.pid});
if(args[0]==='--version'){console.log(kind==='codex'&&behavior!=='other-version'?(behavior==='new-version'?'0.160.0':'0.159.3'):'1.2.3');process.exit(0);}
if(args[0]==='auth'){if(behavior==='auth-failed'){console.log('PRIVATE-CREDENTIAL-CANARY');process.exit(2);}const auth={...data.claudeAuth};if(behavior==='auth-type')auth.loggedIn='yes';if(behavior==='auth-provider')auth.apiProvider='unknown';console.log(JSON.stringify(auth));process.exit(behavior==='auth-exit'?1:0);}
if(args[0]==='models'){
 if(kind==='agy'){for(const m of data.agyModels)console.log(m.id+'\\t'+m.label);}
 else for(const original of data.opencodeModels){
 let model=structuredClone(original);
 if(behavior==='model-conflict')model.providerID='conflicting-provider';
 if(behavior==='variant-contradiction')model.variants.low={effort:'low',reasoningEffort:'high'};
 if(behavior==='variant-type')model.variants.low={effort:1};
 if(behavior==='variant-disabled-type')model.variants.low={disabled:'yes'};
 if(behavior==='variant-disabled')model.variants.low={disabled:true,effort:'low'};
 if(behavior==='variant-budget')model.variants.low={thinking:{budgetTokens:1024}};
 if(behavior==='variant-bound')model.variants=Object.fromEntries(Array.from({length:65},(_,at)=>['option_'+at,{}]));
 if(behavior==='model-depth')model.private=Array.from({length:70}).reduce(v=>[v],0);
 if(behavior==='model-id-conflict')model.id=data.agyModels[0].id;
 console.log(original.providerID+'/'+original.id);console.log(JSON.stringify(model,null,2));
 }
 process.exit(0);
}
if(args[0]==='serve'){
 {
 const server=createServer((req,res)=>{
 const authorized=req.headers.authorization==='Basic '+Buffer.from(process.env.OPENCODE_SERVER_USERNAME+':'+process.env.OPENCODE_SERVER_PASSWORD).toString('base64');
 note({endpoint:req.url,authenticated:authorized,privatePasswordPresent:!!process.env.OPENCODE_SERVER_PASSWORD,freshPasswordFormat:/^[a-f0-9]{64}$/.test(process.env.OPENCODE_SERVER_PASSWORD)});
 if(!authorized||req.url!=='/provider'){res.writeHead(403);res.end();return;}
 if(behavior==='provider-redirect'){res.writeHead(302,{Location:'http://127.0.0.1:'+server.address().port+'/provider-redirected'});res.end();return;}
 if(behavior==='provider-failed'){res.writeHead(503);res.end(JSON.stringify({connected:data.connections}));return;}
 if(behavior==='provider-oversized'){res.end(JSON.stringify({connected:data.connections,private:'x'.repeat(8192)}));return;}
 if(behavior==='provider-timeout'){return;}
 if(behavior==='provider-invalid-utf8'){res.end(Buffer.concat([Buffer.from('{\"connected\":'+JSON.stringify(data.connections)+',\"private\":\"'),Buffer.from([0xff]),Buffer.from('\"}')]));return;}
 if(behavior==='provider-json-duplicate'){res.end('{"connected":[],"connected":'+JSON.stringify(data.connections)+'}');return;}
 if(behavior==='provider-depth'){res.end(JSON.stringify({connected:data.connections,private:Array.from({length:70}).reduce(v=>[v],0)}));return;}
 if(behavior==='provider-unsafe-id'){res.end(JSON.stringify({connected:['/PRIVATE/CONFIG']}));return;}
 const connections=behavior==='provider-duplicate'?[data.connections[0],data.connections[0]]:behavior==='provider-limit'?Array.from({length:513},(_,at)=>'fixture-'+at):behavior==='provider-union-limit'?Array.from({length:512},(_,at)=>'fixture-'+at):data.connections;
 res.setHeader('content-type','application/json');res.end(JSON.stringify({all:[data.privateProviderPayload],connected:connections,default:{}}));
 });const host=behavior==='spoofed-address'?'127.0.0.2':'127.0.0.1';server.listen(0,host,()=>console.log('opencode server listening on http://'+host+':'+server.address().port));
 }
}else{
 let text='';process.stdin.on('data',chunk=>{text+=chunk;while(text.includes('\\n')){
 const at=text.indexOf('\\n'), item=JSON.parse(text.slice(0,at));text=text.slice(at+1); note({method:item.method,params:item.params,type:item.type,request:item.request});
 if(kind==='claude'){
 console.log(JSON.stringify({type:'system',subtype:behavior==='unknown-system'?'unknown':'ui_invalidate',session_id:'PRIVATE-SESSION-CANARY',event:{path:'/PRIVATE/CONFIG'}}));
 let models=data.claudeModels;
 if(behavior==='alias-conflict')models=[models[0],{...models[0],resolvedModel:data.codexModels[0].model}];
 if(behavior==='effort-conflict')models=[models[0],{...models[1],supportedEffortLevels:['medium']}];
 if(behavior==='effort-duplicate')models=[{...models[0],supportedEffortLevels:['low','low']}];
 if(behavior==='effort-type')models=[{...models[0],supportedEffortLevels:[1]}];
 if(behavior==='effort-unsupported')models=[{...models[0],supportsEffort:false}];
 if(behavior==='support-type')models=[{...models[0],supportsEffort:'yes',supportedEffortLevels:undefined}];
 if(behavior==='effort-bound')models=[{...models[0],supportedEffortLevels:Array.from({length:65},(_,at)=>'effort_'+at)}];
 if(behavior==='effort-syntax')models=[{...models[0],supportedEffortLevels:['INVALID']}];
 if(behavior==='unsafe-alias')models=[{...models[0],value:'/PRIVATE/CONFIG'}];
 if(behavior==='empty-models')models=[];
 if(behavior==='alias-bound')models=Array.from({length:65},(_,at)=>({...models[0],value:'alias-'+at}));
 if(behavior==='unsolicited')console.log(JSON.stringify({type:'control_request',request_id:'private',request:{subtype:'can_use_tool'}}));
 if(behavior==='user-message')console.log(JSON.stringify({type:'user',message:{content:'PRIVATE-PROMPT-CANARY'}}));
 console.log(JSON.stringify({type:behavior==='user-with-response'?'user':'control_response',response:{subtype:behavior==='failed-response'?'error':'success',request_id:behavior==='wrong-request'?'other':item.request_id,response:{models,account:{email:'PRIVATE-ACCOUNT-CANARY'},output_style:'/PRIVATE/CONFIG'}}}));
 }else{
 if(!('id' in item))continue;
 if(behavior==='config-failed'&&item.method==='config/read'){console.log(JSON.stringify({id:item.id,error:{message:'PRIVATE-CREDENTIAL-CANARY'}}));continue;}
 if(behavior==='config-server-request'&&item.method==='config/read')console.log(JSON.stringify({id:999,method:'turn/start',params:{}}));
 let result={};
 if(item.method==='account/read')result={account:{type:'chatgpt',email:'PRIVATE-ACCOUNT-CANARY'}};
 if(item.method==='model/list')result={data:data.codexModels,nextCursor:null};
 if(item.method==='config/read')result={config:{model_provider:behavior==='configured-provider'?'fixture-gateway':null,model_providers:{},private:'/PRIVATE/CONFIG'}};
 if(item.method==='config/read'&&behavior==='custom-provider')result.config.model_providers={'fixture-custom':{}};
 if(item.method==='config/read'&&behavior==='invalid-provider')result.config.model_provider='invalid:provider';
 if(item.method==='config/read'&&behavior==='credential-provider')result.config.model_provider='sk-canary123';
 if(item.method==='configRequirements/read')result={requirements:behavior==='provider-constraint'?{opaque:'PRIVATE-CREDENTIAL-CANARY'}:behavior==='missing-requirements'?undefined:null};
 console.log(JSON.stringify({id:item.id,result}));
 }
 }});
}
`, { mode: 0o700 });
    return path;
  }
  try { await run(cwd, binary, data); } finally { await rm(cwd, { recursive: true, force: true }); }
}
function options(cwd: string, kind: DiscoveryLauncher, path: string): CliDiscoveryOptions {
  return { cwd, only: [kind], binaries: { [kind]: path }, timeoutMs: 1500 };
}
const wire = (snapshot: unknown): any => snapshot;

test("native facts: Claude resolves native aliases and per-model effort without private metadata", async () => fixture(async(cwd,binary,data)=>{
  const s=await discoverCliCapabilities(options(cwd,"claude",await binary("claude"))), o=wire(s).launchers.claude;
  assert.equal(o.catalog,"observed","metadata-only Claude initialize catalog must be observed");
  assert.equal(o.authenticated,"yes");assert.equal(o.models.length,2);
  assert.equal(o.models[0].id,data.claudeModels[0].resolvedModel);
  assert.deepEqual(o.models[0].aliases,data.claudeModels.slice(0,2).map((v:any)=>v.value));
  assert.deepEqual(o.models[0].efforts,["low","high"]);assert.equal(o.models[1].efforts,null);
  assert.equal(o.provider.id,"anthropic");assert.equal(o.models[0].provider.scope,"cli");
  assert.ok(validateCliDiscoverySnapshot(s));assert.ok(!JSON.stringify(s).includes("PRIVATE"));
  const log=await readFile(join(cwd,"commands.jsonl"),"utf8"); assert.ok(log.includes('"subtype":"initialize"'));
  const commands=log.trim().split("\n").map(line=>JSON.parse(line)), init=commands.find(c=>c.request);
  assert.deepEqual(init.request,{subtype:'initialize',hooks:{},sdkMcpServers:[]});
  const args=commands.find(c=>c.args?.[0]==='--print').args;
  for(const flag of ['--bare','--no-session-persistence','--setting-sources=','--strict-mcp-config','--input-format','--output-format'])assert.ok(args.includes(flag),flag);
  assert.equal(args[args.indexOf('--mcp-config')+1],'{"mcpServers":{}}');
  for(const forbidden of ['"type":"user"','turn/start','thread/start','refreshToken":true'])assert.ok(!log.includes(forbidden));
}));
test("native facts: AGY installation/catalog are observed while auth/provider/effort remain unknown", async()=>fixture(async(cwd,binary,data)=>{
  let s: Awaited<ReturnType<typeof discoverCliCapabilities>> | undefined;
  await assert.doesNotReject(async()=>{s=await discoverCliCapabilities(options(cwd,"agy",await binary("agy")));});
  const o=wire(s).launchers.agy;assert.equal(o.installed,"yes");assert.equal(o.version,"1.2.3");assert.equal(o.catalog,"observed");
  assert.deepEqual(o.models.map((m:any)=>m.id),data.agyModels.map((m:any)=>m.id));assert.equal(o.authenticated,"unknown");
  for(const m of o.models){assert.equal(m.efforts,null);assert.equal(m.provider.id,null);assert.equal(m.provider.scope,"unknown");}
  assert.ok(validateCliDiscoverySnapshot(s));assert.ok(!JSON.stringify(s).includes("PRIVATE"));
}));
test("native facts: Codex configuration binding covers CLI-only models with exact source scope", async()=>fixture(async(cwd,binary)=>{
  for(const behavior of ["normal","configured-provider","config-failed","provider-constraint","custom-provider","invalid-provider","credential-provider","missing-requirements","other-version","new-version"]){
    const s=await discoverCliCapabilities(options(cwd,"codex",await binary("codex",behavior))),o=wire(s).launchers.codex;
    assert.equal(o.catalog,"observed");const expected=behavior==='normal'||behavior==='new-version'?'openai':behavior==='configured-provider'?'fixture-gateway':null;
    assert.equal(o.provider.id,expected,"successful scoped configuration proof required");assert.equal(o.models[0].provider.id,expected);
    assert.equal(o.models[0].provider.scope,expected===null?'unknown':'cli');assert.ok(validateCliDiscoverySnapshot(s));
    assert.ok(!JSON.stringify(s).includes("PRIVATE"));
  }
}));
test("native facts: OpenCode exact connections and effort bodies never rely on labels or variant names", async()=>fixture(async(cwd,binary,data)=>{
  const s=await discoverCliCapabilities(options(cwd,"opencode",await binary("opencode"))),o=wire(s).launchers.opencode;
  assert.equal(o.catalog,"observed");assert.equal(o.authenticated,"unknown");
  assert.equal(o.models[0].provider.id,data.opencodeModels[0].providerID);assert.equal(o.models[0].provider.scope,"model");
  assert.deepEqual(o.models[0].efforts,["low","high"]);assert.deepEqual(o.models[0].variants,["low","high","opaque"]);
  assert.equal(o.models[1].efforts,null);assert.deepEqual(o.models[1].variants,Object.keys(data.opencodeModels[1].variants));assert.ok(Array.isArray(o.providerConnections),"successful native provider read must produce connection facts");assert.equal(o.providerConnections.find((p:any)=>p.id===data.connections[0]).connected,"yes");
  assert.equal(o.providerConnections.find((p:any)=>p.id===data.opencodeModels[1].providerID).connected,"no");
  assert.ok(validateCliDiscoverySnapshot(s));assert.ok(!JSON.stringify(s).includes("PRIVATE"));
  const lines=(await readFile(join(cwd,"commands.jsonl"),"utf8")).trim().split("\n").map(s=>JSON.parse(s));
  const requests=lines.filter(v=>v.endpoint);assert.equal(requests.length,1);assert.equal(requests[0].endpoint,"/provider");
  assert.equal(requests[0].authenticated,true);assert.equal(requests[0].privatePasswordPresent,true);assert.equal(requests[0].freshPasswordFormat,true);
  const server=lines.find(v=>v.args?.[0]==='serve');assert.deepEqual(server.args,['serve','--pure','--hostname','127.0.0.1','--port','0']);
  assert.throws(()=>process.kill(server.pid,0),{code:'ESRCH'},'owned metadata server must be reaped');
}));
for(const behavior of ["alias-conflict","effort-conflict","effort-duplicate","effort-type","effort-unsupported","support-type","effort-bound","effort-syntax","wrong-request","failed-response","user-with-response","unsafe-alias","empty-models","alias-bound","unknown-system","unsolicited","user-message"]){
  test("native facts: Claude refuses "+behavior,async()=>fixture(async(cwd,binary)=>{
    const s=await discoverCliCapabilities(options(cwd,"claude",await binary("claude",behavior)));
    assert.equal(s.launchers.claude.catalog,"unknown");assert.ok(!JSON.stringify(s).includes("PRIVATE"));
  }));
}
for(const behavior of ["provider-failed","provider-redirect","provider-duplicate","provider-oversized","provider-invalid-utf8","provider-json-duplicate","provider-depth","provider-unsafe-id","provider-limit","provider-union-limit","spoofed-address"]){
  test("native facts: OpenCode "+behavior+" cannot manufacture connection facts",async()=>fixture(async(cwd,binary)=>{
    const s=await discoverCliCapabilities({...options(cwd,"opencode",await binary("opencode",behavior)),...(["provider-limit","provider-union-limit"].includes(behavior)?{}:{maximumBytes:4096})}),o=wire(s).launchers.opencode;
    assert.equal(o.catalog,"observed");assert.equal(o.providerConnections,undefined);assert.ok(o.problems.length>0);
    assert.ok(validateCliDiscoverySnapshot(s));assert.ok(!JSON.stringify(s).includes("PRIVATE"));
    const log=await readFile(join(cwd,"commands.jsonl"),"utf8");assert.ok(!log.includes('"endpoint":"/session'));
    if(behavior==='provider-redirect')assert.equal(log.split('\"endpoint\":').length-1,1,'redirect must never issue a second request');
  }));
}
test("native facts: mismatched OpenCode header/provider metadata stays unavailable",async()=>fixture(async(cwd,binary)=>{
  const s=await discoverCliCapabilities(options(cwd,"opencode",await binary("opencode","model-conflict")));
  assert.equal(s.launchers.opencode.catalog,"unknown");
}));

for(const behavior of ["variant-contradiction","variant-type","variant-disabled-type","model-id-conflict","model-depth","variant-bound"]){
  test("native facts: OpenCode refuses "+behavior,async()=>fixture(async(cwd,binary)=>{
    const s=await discoverCliCapabilities(options(cwd,"opencode",await binary("opencode",behavior)));
    assert.equal(s.launchers.opencode.catalog,"unknown");assert.ok(!JSON.stringify(s).includes("PRIVATE"));
  }));
}
test("native facts: disabled variants and budget names do not assert effort support",async()=>fixture(async(cwd,binary)=>{
  for(const behavior of ["variant-disabled","variant-budget"]){
    const s=await discoverCliCapabilities(options(cwd,"opencode",await binary("opencode",behavior))),o=wire(s).launchers.opencode;
    assert.equal(o.catalog,"observed");assert.deepEqual(o.models[0].efforts,["high"]);
    assert.equal(o.models[0].variants.includes("low"),behavior!=="variant-disabled");assert.ok(validateCliDiscoverySnapshot(s));
  }
}));
test("native facts: failed or unproven Claude auth does not create provider/auth facts",async()=>fixture(async(cwd,binary)=>{
  for(const behavior of ["auth-failed","auth-type","auth-exit","auth-provider"]){
    const s=await discoverCliCapabilities(options(cwd,"claude",await binary("claude",behavior))),o=wire(s).launchers.claude;
    assert.equal(o.catalog,"observed");assert.equal(o.provider.id,null);
    assert.equal(o.authenticated,behavior==='auth-provider'?'yes':'unknown');assert.ok(validateCliDiscoverySnapshot(s));
  }
}));
test("native facts: configuration-phase server requests are refused and never answered",async()=>fixture(async(cwd,binary)=>{
  const s=await discoverCliCapabilities(options(cwd,"codex",await binary("codex","config-server-request")));
  assert.equal(s.launchers.codex.catalog,"unknown");assert.deepEqual(s.launchers.codex.problems,["malformed"]);
  const log=await readFile(join(cwd,"commands.jsonl"),"utf8");assert.ok(!log.includes('"method":"turn/start"'));
}));
test("native facts: provider response deadline is bounded and cannot create connections",async()=>fixture(async(cwd,binary)=>{
  const started=performance.now();
  const s=await discoverCliCapabilities({...options(cwd,"opencode",await binary("opencode","provider-timeout")),timeoutMs:300}),o=wire(s).launchers.opencode;
  assert.equal(o.catalog,"observed");assert.equal(o.providerConnections,undefined);assert.deepEqual(o.problems,["timeout"]);
  assert.ok(performance.now()-started<2000);assert.ok(validateCliDiscoverySnapshot(s));
}));
test("native facts: strict additive snapshot decoder rejects forged provenance and private fields",async()=>fixture(async(cwd,binary)=>{
  const binaries={claude:await binary("claude"),codex:await binary("codex"),opencode:await binary("opencode"),agy:await binary("agy")};
  const good=wire(await discoverCliCapabilities({cwd,binaries,timeoutMs:1500}));assert.ok(validateCliDiscoverySnapshot(good));
  const cases: [string,(s:any)=>void][]=[
    ['root private key',s=>s.private='/PRIVATE/CONFIG'],
    ['unknown provider key',s=>s.launchers.codex.provider.key='PRIVATE-CREDENTIAL-CANARY'],
    ['unknown model key',s=>s.launchers.claude.models[0].email='PRIVATE-ACCOUNT-CANARY'],
    ['unknown connection key',s=>s.launchers.opencode.providerConnections[0].options={}],
    ['provider scope',s=>s.launchers.claude.provider.scope='model'],
    ['unknown provider value',s=>s.launchers.agy.provider.id='fixture-provider'],
    ['unknown provider provenance',s=>s.launchers.agy.provider.source='agy.models'],
    ['forged Claude provider',s=>{s.launchers.claude.provider.id='fixture-provider';s.launchers.claude.models.forEach((m:any)=>m.provider.id='fixture-provider');}],
    ['builtin source revision',s=>s.launchers.codex.version='1.2.3'],
    ['model binding differs from CLI',s=>{s.launchers.codex.provider={id:'fixture-gateway',scope:'cli',source:'codex.config/read'};s.launchers.codex.sources.push('codex.config/read');s.launchers.codex.models[0].provider={id:'fixture-other',scope:'cli',source:'codex.config/read'};}],
    ['cross-vendor source',s=>s.launchers.claude.sources.push('opencode.models.variants')],
    ['missing source',s=>s.launchers.codex.sources=s.launchers.codex.sources.filter((v:string)=>v!=='codex.builtin-provider')],
    ['duplicate source',s=>s.launchers.codex.sources.push('version')],
    ['alias duplicate across models',s=>s.launchers.claude.models[1].aliases=[s.launchers.claude.models[0].aliases[0]]],
    ['alias bound',s=>s.launchers.claude.models[0].aliases=Array.from({length:65},(_,at)=>'alias_'+at)],
    ['alias on wrong CLI',s=>s.launchers.codex.models[0].aliases=['fixture-alias']],
    ['variant on wrong CLI',s=>s.launchers.claude.models[0].variants=['low']],
    ['unobserved effort',s=>s.launchers.opencode.models[0].efforts=['medium']],
    ['effort on AGY',s=>{s.launchers.agy.models[0].efforts=['low'];delete s.launchers.agy.models[0].effortSource;}],
    ['effort source missing',s=>s.launchers.claude.models[0].effortSource=null],
    ['effort source on unknown',s=>s.launchers.agy.models[0].effortSource='agy.models'],
    ['connection source',s=>s.launchers.opencode.providerConnections[0].source='models'],
    ['private provider ID',s=>{s.launchers.codex.provider={id:'sk-canary123',scope:'cli',source:'codex.config/read'};s.launchers.codex.sources.push('codex.config/read');s.launchers.codex.models[0].provider={...s.launchers.codex.provider};}],
    ['connection invalid ID',s=>s.launchers.opencode.providerConnections[0].id='/PRIVATE/CONFIG'],
    ['connection invalid fact',s=>s.launchers.opencode.providerConnections[0].connected=true],
    ['connection bound',s=>s.launchers.opencode.providerConnections=Array.from({length:513},(_,at)=>({id:'fixture-'+at,connected:'yes',source:'opencode.provider/list.connected'}))],
    ['connection duplicate ID',s=>s.launchers.opencode.providerConnections.push(s.launchers.opencode.providerConnections[0])],
    ['connection source missing',s=>s.launchers.opencode.sources=s.launchers.opencode.sources.filter((v:string)=>v!=='opencode.provider/list.connected')],
    ['connection facts missing',s=>delete s.launchers.opencode.providerConnections],
    ['connection on wrong CLI',s=>s.launchers.claude.providerConnections=[]],
    ['OpenCode global auth assertion',s=>s.launchers.opencode.authenticated='yes'],
    ['AGY global auth assertion',s=>s.launchers.agy.authenticated='yes'],
  ];
  for(const [label,change] of cases){const s:any=structuredClone(good);change(s);assert.equal(validateCliDiscoverySnapshot(s),false,label);}
  const reordered:any=structuredClone(good), p=reordered.launchers.codex.models[0].provider;
  reordered.launchers.codex.models[0].provider={scope:p.scope,source:p.source,id:p.id};assert.ok(validateCliDiscoverySnapshot(reordered));
}));
