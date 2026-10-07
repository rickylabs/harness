import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { discoverCliCapabilities, validateCliDiscoverySnapshot, type CliDiscoveryOptions, type DiscoveryLauncher } from "./discovery.js";

/** All model-bearing case data lives in JSON; fake binaries only, never native turns. */
/** Labels the publication screen must refuse (review of #608: embedded, punctuated and home-relative forms). */
const UNSAFE_LABELS = ["Fixture (sk-canary123456789012)","Fixture github_pat_canary123456789012","Fixture ~/private","Fixture(ghp_canary1234567890)",
 "Fixture,gho_canary1234567890","Fixture/secret/path","Fixture /secret","Fixture C:\\Users\\fixture","Fixture \\\\share\\x","Fixture Bearer abc",
 "Fixture 10.1.2.3","Fixture host.fixture.ts.net","Fixture xoxb-canary1234","Fixture /home/PRIVATE/label","L".repeat(129),"Fixture\u0007Label"," Fixture"];
/** Vendor label shapes measured from AGY 1.2.17 /model reports: they must stay publishable. */
const VENDOR_LABELS = ["Gemini 3.8 Flash (High)","Gemini 3.1 Pro (Low)","Claude Opus 5.5 (Medium)","Claude Sonnet 5.5 (High)","GPT-OSS 120B (Medium)"];
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
const note=value=>appendFileSync(log,JSON.stringify(value)+'\\n'); note({args,pid:process.pid,cwd:process.cwd()});
if(args[0]==='--version'&&behavior==='future-version'){console.log((kind==='codex'?'codex-cli ':'')+data.newVersions[kind]);process.exit(0);}
if(args[0]==='--version'&&kind==='agy'&&behavior.startsWith('agy-')){console.log(behavior==='agy-v17'?'1.2.17':behavior==='agy-v18'?'1.2.18':'1.2.16');process.exit(0);}
if(args[0]==='--version'&&kind==='claude'&&behavior==='known-serializer'){console.log('2.1.288');process.exit(0);}
if(kind==='agy'&&args.includes('--print')){
 const name=args[args.indexOf('--print')+1].slice(1), id=args[args.indexOf('--model')+1];
 const entry=data.agyModels.find(m=>m.id===id)??(behavior==='agy-pool'?{nativeEffort:'medium',reportLabel:'Fixture Pool'}:undefined);
 const unverified=['agy-custom','agy-gcp','agy-unknown-provider','agy-provider-type','agy-config-failed'].includes(behavior)||!!process.env.GOOGLE_GEMINI_BASE_URL;
 const label=unverified?entry?.label:behavior.startsWith('agy-label-')?${JSON.stringify(UNSAFE_LABELS)}[Number(behavior.slice(10))]:behavior==='agy-unsafe-label'?'Fixture /home/PRIVATE/label':behavior==='agy-long-label'?'L'.repeat(129):behavior==='agy-control-label'?'Fixture\\u0007Label':entry?.reportLabel;
 let payload=name==='config'?{config:{modelProvider:'',customModelsConfig:null,gcp:null,private:data.privateProviderPayload}}:{id,label,effort:entry?.nativeEffort,is_default:false};
 if(behavior==='agy-custom'&&name==='config')payload.config.customModelsConfig={private:data.privateProviderPayload};
 if(behavior==='agy-provider-type'&&name==='config')payload.config.modelProvider=1;
 if(behavior==='agy-gcp'&&name==='config')payload.config.gcp={private:data.privateProviderPayload};
 if(behavior==='agy-explicit'&&name==='config')payload.config.modelProvider='gemini';
 if(behavior==='agy-unknown-provider'&&name==='config')payload.config.modelProvider='fixture-provider';
 if(behavior==='agy-wrong-model'&&name==='model')payload.id=data.codexModels[0].model;
 if(behavior==='agy-private-effort'&&name==='model')payload.effort='/PRIVATE/CONFIG';
 if(behavior==='agy-config-failed'&&name==='config')process.exit(2);
 if(behavior==='agy-model-failed'&&name==='model')process.exit(2);
 if(behavior==='agy-delay')await new Promise(resolve=>setTimeout(resolve,name==='config'?450:250));
 if((behavior==='agy-error-once'&&name==='model'&&id===data.agyModels[0].id)||(behavior==='agy-config-error-once'&&name==='config')){const fs=await import('node:fs');const marker=${JSON.stringify(join(cwd,'errored'))};if(!fs.existsSync(marker)){fs.writeFileSync(marker,'');console.log(JSON.stringify({conversation_id:'',status:'ERROR',response:'',error:'PRIVATE-ERROR-CANARY',duration_seconds:0,num_turns:0,usage:{input_tokens:0,output_tokens:0,thinking_tokens:0,cache_read_tokens:0,total_tokens:0}}));process.exit(1);}}
 if(behavior==='agy-config-stall-once'&&name==='config'){const fs=await import('node:fs');const marker=${JSON.stringify(join(cwd,'config-stalled'))};if(!fs.existsSync(marker)){fs.writeFileSync(marker,'');await new Promise(resolve=>setTimeout(resolve,5000));}}
 if(behavior==='agy-stall-once'&&name==='model'&&id===data.agyModels[0].id){const fs=await import('node:fs');const marker=${JSON.stringify(join(cwd,'stalled'))};if(!fs.existsSync(marker)){fs.writeFileSync(marker,'');note({stalled:id});await new Promise(resolve=>setTimeout(resolve,5000));}}
 if(behavior==='agy-pool'&&name==='model'){const fs=await import('node:fs');const dir=${JSON.stringify(join(cwd,'inflight'))};fs.mkdirSync(dir,{recursive:true});const mine=dir+'/'+process.pid;fs.writeFileSync(mine,'');note({inflight:fs.readdirSync(dir).length});await new Promise(resolve=>setTimeout(resolve,150));fs.rmSync(mine);}
 const result={conversation_id:'',status:'SUCCESS',num_turns:0,usage:{input_tokens:0,output_tokens:0,thinking_tokens:0,cache_read_tokens:0,total_tokens:0},command:{name,data:payload},private:data.privateProviderPayload};
 if(behavior==='agy-turn')result.num_turns=1;
 if(behavior==='agy-session')result.conversation_id='PRIVATE-SESSION-CANARY';
 if(behavior==='agy-token')result.usage.input_tokens=1;
 if(behavior==='agy-output-token')result.usage.output_tokens=1;
 if(behavior==='agy-thinking-token')result.usage.thinking_tokens=1;
 if(behavior==='agy-cache-token')result.usage.cache_read_tokens=1;
 if(behavior==='agy-total-token')result.usage.total_tokens=1;
 if(behavior==='agy-extra-usage')result.usage.opaque=0;
 if(behavior==='agy-missing-usage')delete result.usage.thinking_tokens;
 if(behavior==='agy-shape'&&name==='config')result.command.data.config=null;
 if(behavior==='agy-shape'&&name==='model')result.command.data=null;
 if(behavior==='agy-status')result.status='ERROR';
 if(behavior==='agy-command')result.command.name='other';
 console.log(JSON.stringify(result));process.exit(behavior==='agy-exit'?1:0);
}
if(args[0]==='--version'&&kind==='codex'&&behavior.startsWith('ver-')){process.stdout.write(data.codexVersionLines[Number(behavior.slice(4))]);process.exit(0);}
if(args[0]==='--version'){console.log(kind==='codex'&&behavior!=='other-version'?'codex-cli '+(['new-version','project-provider','scoped-read-failed'].includes(behavior)?'0.160.0':behavior==='patch-version'?'0.160.1':behavior==='unverified-patch'?'0.160.2':'0.159.3'):'1.2.3');process.exit(0);}
if(args[0]==='auth'){if(behavior==='auth-failed'){console.log('PRIVATE-CREDENTIAL-CANARY');process.exit(2);}const auth={...data.claudeAuth};if(behavior==='auth-type')auth.loggedIn='yes';if(behavior==='auth-provider')auth.apiProvider='unknown';console.log(JSON.stringify(auth));process.exit(behavior==='auth-exit'?1:0);}
if(args[0]==='models'){
 if(kind==='agy'){const entries=behavior==='agy-bound'?Array.from({length:65},(_,i)=>({id:data.agyBoundModelPrefix+i,label:'Bound'})):behavior==='agy-pool'?Array.from({length:6},(_,i)=>({id:data.agyBoundModelPrefix+i,label:'Pool'})):data.agyModels;for(const m of entries)console.log(m.id+'\\t'+m.label);}
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
 if(behavior==='scoped-read-failed'&&item.method==='config/read'&&item.params?.cwd===process.cwd()){console.log(JSON.stringify({id:item.id,error:{message:'PRIVATE-CONFIG-CANARY'}}));continue;}
 if(behavior==='config-failed'&&item.method==='config/read'){console.log(JSON.stringify({id:item.id,error:{message:'PRIVATE-CREDENTIAL-CANARY'}}));continue;}
 if(behavior==='config-server-request'&&item.method==='config/read')console.log(JSON.stringify({id:999,method:'turn/start',params:{}}));
 let result={};
 if(item.method==='account/read')result={account:{type:'chatgpt',email:'PRIVATE-ACCOUNT-CANARY'}};
 if(item.method==='model/list')result={data:behavior==='codex-unsafe-label'?data.codexModels.map(m=>({...m,displayName:'Fixture (sk-canary123456789012)'})):data.codexModels,nextCursor:null};
 if(item.method==='config/read')result={config:{model_provider:behavior==='configured-provider'?'fixture-gateway':null,model_providers:{},private:'/PRIVATE/CONFIG'}};
 if(item.method==='config/read'&&behavior==='project-provider'&&item.params?.cwd===process.cwd())result.config.model_provider='fixture-gateway';
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
  assert.deepEqual(o.models[0].efforts,["low","high"]);assert.deepEqual(o.models[1].efforts,[]);
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
test("native facts: Codex 0.160.1 keeps the verified built-in provider",async()=>fixture(async(cwd,binary)=>{
 const s=await discoverCliCapabilities(options(cwd,"codex",await binary("codex","patch-version"))),o=wire(s).launchers.codex;
 assert.equal(o.version,"0.160.1");assert.deepEqual(o.provider,{id:"openai",source:"codex.builtin-provider",scope:"cli"});
 assert.ok(o.sources.includes("codex.builtin-provider"));assert.ok(validateCliDiscoverySnapshot(s));
}));
test("native facts: every Codex version uses the current built-in binding",async()=>fixture(async(cwd,binary,data)=>{
 for(const [index,line] of data.codexVersionLines.entries()){
  const s=await discoverCliCapabilities(options(cwd,"codex",await binary("codex","ver-"+index))),o=wire(s).launchers.codex;
  assert.equal(o.catalog,"observed",line);assert.ok(o.models.length>0,line);assert.ok(validateCliDiscoverySnapshot(s),line);
  assert.deepEqual(o.provider,{id:"openai",source:"codex.builtin-provider",scope:"cli"},line);
  assert.ok(!o.sources.includes("codex.builtin-provider.unverified"),line);
 }
 // A configured provider is the runtime value the launch applies: it binds whatever the version, and is never marked.
 const configured=wire(await discoverCliCapabilities(options(cwd,"codex",await binary("codex","configured-provider")))).launchers.codex;
 assert.equal(configured.provider.source,"codex.config/read");assert.ok(!configured.sources.includes("codex.builtin-provider.unverified"));
 // Custom provider definitions are not the unconfigured state: unknown, and not marked as an unverified default.
 const custom=wire(await discoverCliCapabilities(options(cwd,"codex",await binary("codex","custom-provider")))).launchers.codex;
 assert.equal(custom.provider.id,null);assert.ok(!custom.sources.includes("codex.builtin-provider.unverified"));
 // The strict reader never accepts the marker beside a provider binding.
 const verified=await discoverCliCapabilities(options(cwd,"codex",await binary("codex","patch-version")));
 const a=structuredClone(verified) as any;a.launchers.codex.sources.push("codex.builtin-provider.unverified");assert.equal(validateCliDiscoverySnapshot(a),false);
 const b=structuredClone(verified) as any;b.launchers.codex.sources=b.launchers.codex.sources.map((x:string)=>x==="codex.builtin-provider"?"codex.builtin-provider.unverified":x);
 assert.equal(validateCliDiscoverySnapshot(b),false);
}));

test("native facts: AGY all versions attempt native auth/provider/effort metadata",async()=>fixture(async(cwd,binary)=>{
 const s=await discoverCliCapabilities(options(cwd,"agy",await binary("agy"))),o=wire(s).launchers.agy;
 assert.equal(o.catalog,"observed");assert.equal(o.authenticated,"yes");assert.equal(o.provider.id,"google");
 assert.ok(o.models.every((m:any)=>m.efforts!==null));assert.ok(validateCliDiscoverySnapshot(s));
 assert.ok((await readFile(join(cwd,"commands.jsonl"),"utf8")).includes('--print'));
}));
test("native facts: Codex configuration binding covers CLI-only models with exact source scope", async()=>fixture(async(cwd,binary)=>{
  for(const behavior of ["normal","configured-provider","config-failed","provider-constraint","custom-provider","invalid-provider","credential-provider","missing-requirements","other-version","new-version"]){
    const s=await discoverCliCapabilities(options(cwd,"codex",await binary("codex",behavior))),o=wire(s).launchers.codex;
    assert.equal(o.catalog,"observed");const expected=['normal','new-version','other-version'].includes(behavior)?'openai':behavior==='configured-provider'?'fixture-gateway':null;
    assert.equal(o.provider.id,expected,"successful scoped configuration proof required");assert.equal(o.models[0].provider.id,expected);
    assert.equal(o.models[0].provider.scope,expected===null?'unknown':'cli');assert.ok(validateCliDiscoverySnapshot(s));
    if (behavior === "config-failed") assert.ok(o.problems.includes("unsupported"));
    assert.ok(!JSON.stringify(s).includes("PRIVATE"));
  }
}));
async function scopedCodexRequest(cwd: string) {
  const commands = (await readFile(join(cwd, "commands.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const requests = commands.filter(command => command.method === "config/read");
  assert.equal(requests.length, 1, "failed scoped reads must never retry unscoped");
  assert.deepEqual(requests[0].params, { includeLayers: false, cwd });
  assert.ok(isAbsolute(requests[0].params.cwd), "Codex config/read requires the absolute observation cwd");
  assert.equal(commands.find(command => command.args?.[0] === "app-server").cwd, cwd);
}
test("native facts: Codex observation cwd includes the project provider override", async () => fixture(async (cwd, binary) => {
  const snapshot = await discoverCliCapabilities(options(cwd, "codex", await binary("codex", "project-provider")));
  const observation = wire(snapshot).launchers.codex;
  assert.equal(observation.catalog, "observed");
  assert.deepEqual(observation.provider, { id: "fixture-gateway", source: "codex.config/read", scope: "cli" });
  for (const model of observation.models) assert.deepEqual(model.provider, observation.provider);
  assert.ok(validateCliDiscoverySnapshot(snapshot));
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE"));
  await scopedCodexRequest(cwd);
}));
test("native facts: Codex observation cwd retains the verified global default", async () => fixture(async (cwd, binary) => {
  const snapshot = await discoverCliCapabilities(options(cwd, "codex", await binary("codex", "new-version")));
  const observation = wire(snapshot).launchers.codex;
  assert.equal(observation.catalog, "observed");
  assert.deepEqual(observation.provider, { id: "openai", source: "codex.builtin-provider", scope: "cli" });
  for (const model of observation.models) assert.deepEqual(model.provider, observation.provider);
  assert.ok(validateCliDiscoverySnapshot(snapshot));
  await scopedCodexRequest(cwd);
}));
test("native facts: Codex observation cwd failed scoped read keeps all provider bindings unknown", async () => fixture(async (cwd, binary) => {
  const snapshot = await discoverCliCapabilities(options(cwd, "codex", await binary("codex", "scoped-read-failed")));
  const observation = wire(snapshot).launchers.codex;
  assert.equal(observation.catalog, "observed");
  assert.deepEqual(observation.provider, { id: null, source: null, scope: "unknown" });
  for (const model of observation.models) assert.deepEqual(model.provider, observation.provider);
  assert.ok(validateCliDiscoverySnapshot(snapshot));
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE"));
  await scopedCodexRequest(cwd);
}));
test("native facts: Codex observation cwd resolves a relative directory to the same native scope", async () => fixture(async (cwd, binary) => {
  const relativeCwd = relative(process.cwd(), cwd);
  assert.ok(!isAbsolute(relativeCwd));
  const snapshot = await discoverCliCapabilities(options(relativeCwd, "codex", await binary("codex", "project-provider")));
  const observation = wire(snapshot).launchers.codex;
  assert.equal(observation.catalog, "observed");
  assert.deepEqual(observation.provider, { id: "fixture-gateway", source: "codex.config/read", scope: "cli" });
  for (const model of observation.models) assert.deepEqual(model.provider, observation.provider);
  assert.ok(validateCliDiscoverySnapshot(snapshot));
  await scopedCodexRequest(cwd);
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
  const requests=lines.filter(v=>v.endpoint);assert.deepEqual(requests.map(r=>r.endpoint),["/config/providers","/provider"]);
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
    if(behavior==='provider-redirect')assert.equal(log.split('\"endpoint\":').length-1,2,'catalog attempt and provider read never follow redirects');
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
  assert.equal(o.catalog,"observed");assert.equal(o.providerConnections,undefined);assert.ok(o.problems.includes("timeout"));
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
    ['AGY global auth assertion',s=>s.launchers.agy.authenticated='no'],
  ];
  for(const [label,change] of cases){const s:any=structuredClone(good);change(s);assert.equal(validateCliDiscoverySnapshot(s),false,label);}
  const reordered:any=structuredClone(good), p=reordered.launchers.codex.models[0].provider;
  reordered.launchers.codex.models[0].provider={scope:p.scope,source:p.source,id:p.id};assert.ok(validateCliDiscoverySnapshot(reordered));
}));


test("native facts: AGY native authentication gate, effective config and exact model effort are projected",async()=>fixture(async(cwd,binary,data)=>{
 const s=await discoverCliCapabilities(options(cwd,"agy",await binary("agy","agy-normal"))),o=wire(s).launchers.agy;
 assert.equal(o.authenticated,"yes");assert.equal(o.authenticationSource,"agy.auth-gate");
 assert.deepEqual(o.provider,{id:"google",source:"agy.command.config",scope:"cli"});
 assert.deepEqual(o.models.map((m:any)=>m.efforts),data.agyModels.map((m:any)=>m.nativeEffort?[m.nativeEffort]:[]));
 for(const m of o.models){assert.deepEqual(m.provider,o.provider);assert.equal(m.effortSource,"agy.command.model");}
 assert.equal(o.entitlement,"unknown");assert.equal(o.quota,"unknown");
 assert.ok(validateCliDiscoverySnapshot(s));assert.ok(!JSON.stringify(s).includes("PRIVATE"));
 const commands=(await readFile(join(cwd,"commands.jsonl"),"utf8")).trim().split("\n").map(line=>JSON.parse(line));
 const reads=commands.filter(c=>c.args?.includes('--print'));
 assert.equal(reads.length,data.agyModels.length+1);
 for(const c of reads){assert.ok(['/config','/model'].includes(c.args[c.args.indexOf('--print')+1]));assert.equal(c.args[c.args.indexOf('--output-format')+1],'json');assert.equal(c.cwd,cwd);}
}));
test("native facts: AGY newer versions receive the current metadata reports",async()=>fixture(async(cwd,binary,data)=>{
 const s=await discoverCliCapabilities(options(cwd,"agy",await binary("agy","agy-v17"))),o=wire(s).launchers.agy;
 assert.equal(o.version,"1.2.17");assert.equal(o.authenticated,"yes");assert.equal(o.authenticationSource,"agy.auth-gate");
 assert.deepEqual(o.provider,{id:"google",source:"agy.command.config",scope:"cli"});
 assert.deepEqual(o.models.map((m:any)=>m.efforts),data.agyModels.map((m:any)=>m.nativeEffort?[m.nativeEffort]:[]));
 assert.ok(validateCliDiscoverySnapshot(s));assert.ok(!JSON.stringify(s).includes("PRIVATE"));
 const before=(await readFile(join(cwd,"commands.jsonl"),"utf8")).trim().split("\n").length;
 const u=await discoverCliCapabilities(options(cwd,"agy",await binary("agy","agy-v18"))),ou=wire(u).launchers.agy;
 assert.equal(ou.version,"1.2.18");assert.equal(ou.authenticated,"yes");assert.equal(ou.provider.id,"google");assert.ok(validateCliDiscoverySnapshot(u));
 assert.deepEqual(ou.models.map((m:any)=>m.efforts),data.agyModels.map((m:any)=>m.nativeEffort?[m.nativeEffort]:[]));
 const after=(await readFile(join(cwd,"commands.jsonl"),"utf8")).trim().split("\n").slice(before).map(line=>JSON.parse(line));
 assert.ok(after.some((c:any)=>c.args?.includes('--print')), "newer versions receive metadata requests");
}));
test("native facts: AGY vendor labels come back verbatim from /model under the verified first-party binding",async()=>fixture(async(cwd,binary,data)=>{
 const s=await discoverCliCapabilities(options(cwd,"agy",await binary("agy","agy-normal"))),o=wire(s).launchers.agy;
 assert.deepEqual(o.provider,{id:"google",source:"agy.command.config",scope:"cli"});
 assert.deepEqual(o.models.map((m:any)=>m.label),data.agyModels.map((m:any)=>m.reportLabel));
 assert.ok(validateCliDiscoverySnapshot(s));assert.ok(!JSON.stringify(s).includes("PRIVATE"));
 // The strict reader refuses a label without the verified binding, on another launcher, or failing the screen.
 for(const edit of [(x:any)=>{x.launchers.agy.models[0].provider={id:null,source:null,scope:"unknown"};x.launchers.agy.provider={id:null,source:null,scope:"unknown"};x.launchers.agy.models.forEach((m:any)=>{m.provider=x.launchers.agy.provider;});},
   (x:any)=>{x.launchers.agy.models[0].label="Fixture /home/PRIVATE/label";},(x:any)=>{x.launchers.agy.models[0].label="L".repeat(129);},
   (x:any)=>{x.launchers.agy.models[0].effortSource=null;x.launchers.agy.models[0].efforts=null;}]){
  const copy=structuredClone(s);edit(copy);assert.equal(validateCliDiscoverySnapshot(copy),false);
 }
}));
test("native facts: an AGY label the screen refuses is dropped for that model alone, with a named reason; the reader refuses it outright",async()=>fixture(async(cwd,binary,data)=>{
 for(const [index,label] of UNSAFE_LABELS.entries()){
  const s=await discoverCliCapabilities(options(cwd,"agy",await binary("agy","agy-label-"+index))),o=wire(s).launchers.agy;
  assert.deepEqual(o.provider,{id:"google",source:"agy.command.config",scope:"cli"},label);assert.deepEqual(o.problems,[],label);
  assert.equal(o.models.length,data.agyModels.length,label);
  for(const m of o.models){assert.ok(!Object.hasOwn(m,"label"),label);assert.equal(m.labelWithheld,"screened",label);assert.ok(m.efforts!==null,label);}
  assert.ok(validateCliDiscoverySnapshot(s),label);assert.ok(!JSON.stringify(s).includes("canary"),label);assert.ok(!JSON.stringify(s).includes("PRIVATE"),label);
 }
 const good=await discoverCliCapabilities(options(cwd,"agy",await binary("agy","agy-normal")));
 for(const label of UNSAFE_LABELS){const x=structuredClone(good) as any;x.launchers.agy.models[0].label=label;assert.equal(validateCliDiscoverySnapshot(x),false,label);}
 for(const label of VENDOR_LABELS){const x=structuredClone(good) as any;x.launchers.agy.models[0].label=label;assert.ok(validateCliDiscoverySnapshot(x),label);}
 const edits=[(x:any)=>{x.launchers.agy.models[0].label=null;},(x:any)=>{x.launchers.agy.models[0].labelWithheld="screened";},
  (x:any)=>{delete x.launchers.agy.models[0].label;x.launchers.agy.models[0].labelWithheld="other";}];
 for(const edit of edits){const x=structuredClone(good) as any;edit(x);assert.equal(validateCliDiscoverySnapshot(x),false);}
 // A configured (not built-in) Codex provider may list user-named models: no label and no withholding on its rows.
 const codex=await discoverCliCapabilities(options(cwd,"codex",await binary("codex","configured-provider")));
 const y=structuredClone(codex) as any;y.launchers.codex.models[0].labelWithheld="screened";assert.equal(validateCliDiscoverySnapshot(y),false);
}));
test("native facts: AGY labels stay withheld under custom, GCP, unproven, failed or custom-endpoint configs and the screen",async()=>fixture(async(cwd,binary)=>{
 const runs:[string,string][]=[["agy-custom",""],["agy-gcp",""],["agy-unknown-provider",""],["agy-provider-type",""],["agy-config-failed",""],["agy-normal","endpoint"],
   ["agy-unsafe-label",""],["agy-long-label",""],["agy-control-label",""]];
 for(const [behavior,mode] of runs){
  const previous=process.env.GOOGLE_GEMINI_BASE_URL;
  try{if(mode==="endpoint")process.env.GOOGLE_GEMINI_BASE_URL="http://127.0.0.1:1";
   const s=await discoverCliCapabilities(options(cwd,"agy",await binary("agy",behavior))),o=wire(s).launchers.agy;
   assert.ok(o.models.length>0,behavior);assert.ok(o.models.every((m:any)=>!Object.hasOwn(m,"label")),behavior+mode);
   assert.ok(validateCliDiscoverySnapshot(s),behavior);assert.ok(!JSON.stringify(s).includes("PRIVATE"),behavior+mode);
  }finally{if(previous===undefined)delete process.env.GOOGLE_GEMINI_BASE_URL;else process.env.GOOGLE_GEMINI_BASE_URL=previous;}
 }
}));
test("native facts: AGY metadata runs as a rolling pool of two and may spend a launcher budget above one child's ceiling",async()=>fixture(async(cwd,binary)=>{
 const s=await discoverCliCapabilities({...options(cwd,"agy",await binary("agy","agy-pool")),timeoutMs:120_000});
 assert.equal(s.launchers.agy.problems.length,0);assert.ok(s.launchers.agy.models.every(m=>m.efforts!==null));
 const inflight=(await readFile(join(cwd,"commands.jsonl"),"utf8")).trim().split("\n").map(line=>JSON.parse(line)).filter((c:any)=>c.inflight!==undefined).map((c:any)=>c.inflight);
 assert.equal(Math.max(...inflight),2,"two reports in flight, never more");
 const over=await discoverCliCapabilities({...options(cwd,"agy",await binary("agy","agy-normal")),timeoutMs:180_001});
 assert.deepEqual(over.launchers.agy.problems,["malformed"]);
 const log=(await readFile(join(cwd,"commands.jsonl"),"utf8")).trim().split("\n").map(line=>JSON.parse(line));
 assert.ok(log.filter((c:any)=>c.args?.includes('--model')).length>0);
}));
/** Counts launched children at the parent's spawn boundary: a killed child may never reach its own log line. */
async function countingSpawns<T>(run: () => Promise<T>): Promise<{ result: T; launched: string[][] }> {
 const childProcess = createRequire(import.meta.url)("node:child_process"), original = childProcess.spawn, launched: string[][] = [];
 childProcess.spawn = (command: string, args: string[], ...rest: unknown[]) => { launched.push([...args]); return original(command, args, ...rest); };
 syncBuiltinESMExports();
 try { return { result: await run(), launched }; } finally { childProcess.spawn = original; syncBuiltinESMExports(); }
}
test("native facts: an AGY report that stalls is retried in a fresh process; three stalls stay a timeout",async()=>fixture(async(cwd,binary,data)=>{
 const once=await binary("agy","agy-stall-once"),delayed=await binary("agy","agy-delay");
 const {result:s,launched}=await countingSpawns(()=>discoverCliCapabilities({...options(cwd,"agy",once),timeoutMs:20_000,agyReportTimeoutMs:600}));
 const o=wire(s).launchers.agy;
 assert.deepEqual(o.problems,[]);assert.deepEqual(o.models.map((m:any)=>m.efforts),data.agyModels.map((m:any)=>m.nativeEffort?[m.nativeEffort]:[]));
 const reports=(runs:string[][],id:string)=>runs.filter(args=>args.includes('/model')&&args.includes(id)).length;
 assert.equal(reports(launched,data.agyModels[0].id),2,"exactly one retry, in a fresh process");
 assert.equal(reports(launched,data.agyModels[1].id),1,"an answered report is not repeated");
 const {result:twice,launched:capped}=await countingSpawns(()=>discoverCliCapabilities({...options(cwd,"agy",delayed),timeoutMs:20_000,agyReportTimeoutMs:100}));
 assert.ok(twice.launchers.agy.problems.includes("timeout"));assert.ok(twice.launchers.agy.models.every(m=>m.efforts===null));
 for(const m of data.agyModels)assert.equal(reports(capped,m.id),3,"at most three attempts per report");
 assert.ok(validateCliDiscoverySnapshot(s));assert.ok(validateCliDiscoverySnapshot(twice));
}));

test("native facts: a native AGY error report or a stalled /config is retried in a fresh process, never published",async()=>fixture(async(cwd,binary,data)=>{
 const reports=(runs:string[][],name:string,id?:string)=>runs.filter(args=>args.includes('/'+name)&&(id===undefined||args.includes(id))).length;
 for(const behavior of ["agy-error-once","agy-config-error-once","agy-config-stall-once"]){
  await rm(join(cwd,'errored'),{force:true});await rm(join(cwd,'config-stalled'),{force:true});
  const path=await binary("agy",behavior);
  const {result:s,launched}=await countingSpawns(()=>discoverCliCapabilities({...options(cwd,"agy",path),timeoutMs:20_000,agyReportTimeoutMs:1500}));
  const o=wire(s).launchers.agy;
  assert.deepEqual(o.problems,[],behavior);assert.deepEqual(o.provider,{id:"google",source:"agy.command.config",scope:"cli"},behavior);
  assert.deepEqual(o.models.map((m:any)=>m.efforts),data.agyModels.map((m:any)=>m.nativeEffort?[m.nativeEffort]:[]),behavior);
  assert.equal(reports(launched,"config"),behavior==="agy-error-once"?1:2,behavior);
  if(behavior==="agy-error-once")assert.equal(reports(launched,"model",data.agyModels[0].id),2,behavior);
  assert.ok(validateCliDiscoverySnapshot(s),behavior);assert.ok(!JSON.stringify(s).includes("PRIVATE"),behavior);
 }
}));
test("native facts: Codex's own displayName is published under the verified built-in binding only, screened",async()=>fixture(async(cwd,binary,data)=>{
 const s=await discoverCliCapabilities(options(cwd,"codex",await binary("codex","normal"))),o=wire(s).launchers.codex;
 assert.equal(o.provider.source,"codex.builtin-provider");
 assert.deepEqual(o.models.map((m:any)=>m.label),data.codexModels.map((m:any)=>m.displayName));assert.ok(validateCliDiscoverySnapshot(s));
 // A configured provider or custom provider definitions: names stay withheld (no label at all).
 for(const behavior of ["configured-provider","custom-provider"]){
  const x=wire(await discoverCliCapabilities(options(cwd,"codex",await binary("codex",behavior)))).launchers.codex;
  assert.ok(x.models.every((m:any)=>!Object.hasOwn(m,"label")&&!Object.hasOwn(m,"labelWithheld")),behavior);
 }
 // A name the screen refuses is dropped for that model with its reason; nothing private is published.
 const u=await discoverCliCapabilities(options(cwd,"codex",await binary("codex","codex-unsafe-label"))),ou=wire(u).launchers.codex;
 assert.ok(ou.models.every((m:any)=>!Object.hasOwn(m,"label")&&m.labelWithheld==="screened"));assert.ok(!JSON.stringify(u).includes("canary"));
 assert.ok(validateCliDiscoverySnapshot(u));
 // The reader refuses a Codex label without the built-in binding, or one failing the screen.
 const configured=await discoverCliCapabilities(options(cwd,"codex",await binary("codex","configured-provider")));
 const a=structuredClone(configured) as any;a.launchers.codex.models[0].label="Fixture Codex Model";assert.equal(validateCliDiscoverySnapshot(a),false);
 const b=structuredClone(s) as any;b.launchers.codex.models[0].label="Fixture ~/private";assert.equal(validateCliDiscoverySnapshot(b),false);
}));
test("native facts: AGY custom, GCP and unproven provider configurations stay unknown",async()=>fixture(async(cwd,binary)=>{
 for(const behavior of ['agy-custom','agy-gcp','agy-unknown-provider','agy-provider-type','agy-config-failed']){
  const s=await discoverCliCapabilities(options(cwd,"agy",await binary("agy",behavior))),o=wire(s).launchers.agy;
  assert.equal(o.authenticated,"yes");assert.equal(o.provider.id,null);assert.equal(o.models[0].provider.id,null);
  assert.ok(validateCliDiscoverySnapshot(s));assert.ok(!JSON.stringify(s).includes("PRIVATE"));
 }
}));
test("native facts: AGY exact explicit native provider is read from effective config",async()=>fixture(async(cwd,binary)=>{
 const s=await discoverCliCapabilities(options(cwd,"agy",await binary("agy","agy-explicit")));
 assert.equal(s.launchers.agy.provider?.id,"google");assert.ok(validateCliDiscoverySnapshot(s));
}));
test("native facts: AGY report envelope must prove no turn, no session, no usage and the requested command",async()=>fixture(async(cwd,binary)=>{
 for(const behavior of ['agy-turn','agy-session','agy-token','agy-output-token','agy-thinking-token','agy-cache-token','agy-total-token','agy-status','agy-command','agy-exit','agy-extra-usage','agy-missing-usage','agy-shape']){
  const s=await discoverCliCapabilities(options(cwd,"agy",await binary("agy",behavior))),o=wire(s).launchers.agy;
  assert.equal(o.catalog,"observed");assert.equal(o.authenticated,"unknown");assert.equal(o.provider.id,null);
  for(const m of o.models){assert.equal(m.efforts,null);assert.equal(m.effortSource,null);}
  assert.ok(validateCliDiscoverySnapshot(s));assert.ok(!JSON.stringify(s).includes("PRIVATE"));
 }
}));
test("native facts: AGY selected model mismatch and invalid effort never bind capabilities",async()=>fixture(async(cwd,binary)=>{
 for(const behavior of ['agy-wrong-model','agy-private-effort','agy-model-failed']){
  const s=await discoverCliCapabilities(options(cwd,"agy",await binary("agy",behavior))),o=wire(s).launchers.agy;
  assert.equal(o.authenticated,"yes");
  for(const m of o.models){assert.equal(m.efforts,null);assert.equal(m.effortSource,null);}
  assert.ok(validateCliDiscoverySnapshot(s));assert.ok(!JSON.stringify(s).includes("PRIVATE"));
 }
}));
test("native facts: Claude newer serializers use current effort omission semantics",async()=>fixture(async(cwd,binary)=>{
 const s=await discoverCliCapabilities(options(cwd,"claude",await binary("claude","known-serializer"))),m=wire(s).launchers.claude.models[1];
 assert.deepEqual(m.efforts,[]);assert.equal(m.effortSource,"claude.sdk.initialize");assert.ok(validateCliDiscoverySnapshot(s));
 const other=await discoverCliCapabilities(options(cwd,"claude",await binary("claude")));
 assert.deepEqual(other.launchers.claude.models[1]?.efforts,[]);assert.ok(validateCliDiscoverySnapshot(other));
}));
test("native facts: fleet legacy Opus alias uses the served native wire id in JSON",async()=>fixture(async(_cwd,_binary,data)=>{
 const fleet=JSON.parse(await readFile(new URL('../config/routing.fleet.v2.json',import.meta.url),'utf8'));
 assert.equal(fleet.models[data.fleetLegacyAlias].launches[0].id,data.servedOpus);
 assert.equal(fleet.models[data.fleetCanonicalAlias].launches[0].id,data.servedOpus);
}));


test("native facts: AGY report scope resolves a relative observation directory",async()=>fixture(async(cwd,binary)=>{
 const s=await discoverCliCapabilities(options(relative(process.cwd(),cwd),"agy",await binary("agy","agy-normal")));
 assert.equal(s.launchers.agy.authenticated,"yes");assert.ok(validateCliDiscoverySnapshot(s));
 const log=(await readFile(join(cwd,"commands.jsonl"),"utf8")).trim().split("\n").map(line=>JSON.parse(line));
 for(const command of log.filter(c=>c.args.includes('--print')))assert.equal(command.cwd,cwd);
}));
test("native facts: AGY custom endpoint is not published as the verified Google binding",async()=>fixture(async(cwd,binary)=>{
 const previous=process.env.GOOGLE_GEMINI_BASE_URL;
 try{process.env.GOOGLE_GEMINI_BASE_URL='http://127.0.0.1:1';
  const s=await discoverCliCapabilities(options(cwd,"agy",await binary("agy","agy-normal")));
  assert.equal(s.launchers.agy.provider?.id,null);assert.equal(s.launchers.agy.authenticated,"yes");assert.ok(validateCliDiscoverySnapshot(s));
 }finally{if(previous===undefined)delete process.env.GOOGLE_GEMINI_BASE_URL;else process.env.GOOGLE_GEMINI_BASE_URL=previous;}
}));
test("native facts: AGY catalog bounds metadata reads independently of model count",async()=>fixture(async(cwd,binary)=>{
 const s=await discoverCliCapabilities({...options(cwd,"agy",await binary("agy","agy-bound")),timeoutMs:20000});
 const o=s.launchers.agy;assert.equal(o.models.length,65);assert.ok(o.problems.includes('oversized'));assert.equal(o.models[64]?.efforts,null);
 const log=(await readFile(join(cwd,"commands.jsonl"),"utf8")).trim().split("\n").map(line=>JSON.parse(line));
 assert.equal(log.filter(c=>c.args.includes('--model')).length,64);assert.ok(validateCliDiscoverySnapshot(s));
}));
test("native facts: AGY metadata calls share one deadline",async()=>fixture(async(cwd,binary)=>{
 const s=await discoverCliCapabilities({...options(cwd,"agy",await binary("agy","agy-delay")),timeoutMs:650}),o=s.launchers.agy;
 assert.equal(o.catalog,'observed');for(const m of o.models)assert.equal(m.efforts,null);
 assert.ok(o.problems.includes('timeout'));assert.ok(validateCliDiscoverySnapshot(s));
}));
test("native facts: strict AGY snapshot rejects unbound auth/provider/effort provenance",async()=>fixture(async(cwd,binary)=>{
 const original=await discoverCliCapabilities(options(cwd,"agy",await binary("agy","agy-normal")));
 const edits=[
  (o:any)=>{o.installed='unknown';},(o:any)=>{o.catalog='declared';},
  (o:any)=>{o.authenticated='no';},(o:any)=>{o.authenticationSource=null;},(o:any)=>{delete o.authenticationSource;},
  (o:any)=>{o.sources=o.sources.filter((s:string)=>s!=='agy.auth-gate');},
  (o:any)=>{o.sources=['version','agy.models','agy.auth-gate'];o.models.forEach((m:any)=>{m.efforts=null;m.effortSource=null;m.provider={id:null,source:null,scope:'unknown'};});o.provider={id:null,source:null,scope:'unknown'};},
  (o:any)=>{o.provider.source='agy.command.model';o.models.forEach((m:any)=>{m.provider.source='agy.command.model';});},(o:any)=>{o.provider.id='fixture-provider';o.models.forEach((m:any)=>{m.provider.id='fixture-provider';});},
  (o:any)=>{o.models[0].provider.scope='model';},(o:any)=>{o.models[0].effortSource=null;},
  (o:any)=>{delete o.models[0].effortSource;},(o:any)=>{o.models[0].effortSource='agy.command.config';},
  (o:any)=>{o.models[0].efforts=['low','high'];},(o:any)=>{o.models[0].efforts=null;},(o:any)=>{o.entitlement='yes';},(o:any)=>{o.quota='yes';},
 ];
 for(const edit of edits){const s=structuredClone(original),o=wire(s).launchers.agy;edit(o);assert.equal(validateCliDiscoverySnapshot(s),false,'exact AGY provenance required');}
 const foreign=structuredClone(original);wire(foreign).launchers.claude.authenticationSource='agy.auth-gate';assert.equal(validateCliDiscoverySnapshot(foreign),false);
}));

for (const launcher of ["codex", "agy", "claude"] as const) {
 test("future CLI version retains current discovery: " + launcher, async () => fixture(async (cwd, binary, data) => {
  const snapshot = await discoverCliCapabilities(options(cwd, launcher, await binary(launcher, "future-version")));
  const observation = snapshot.launchers[launcher];
  assert.equal(observation.version, data.newVersions[launcher]);
  assert.equal(observation.catalog, "observed");
  assert.ok(observation.models.length > 0);
  assert.ok(observation.models.every(model => model.provider?.id));
  assert.ok(observation.models.every(model => model.efforts !== null));
  assert.deepEqual(observation.problems, []);
  assert.ok(validateCliDiscoverySnapshot(snapshot));
 }));
}
