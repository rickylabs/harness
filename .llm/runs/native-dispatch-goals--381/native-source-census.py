import subprocess,json,select,time
p=subprocess.Popen(['codex','app-server'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1);seq=0
def rpc(method,params):
 global seq
 seq+=1;n=seq;p.stdin.write(json.dumps({'id':n,'method':method,'params':params})+'\n');p.stdin.flush()
 deadline=time.monotonic()+20
 while time.monotonic()<deadline:
  if not select.select([p.stdout],[],[],max(0,deadline-time.monotonic()))[0]:raise RuntimeError('read_timeout')
  line=p.stdout.readline()
  if not line:raise RuntimeError('source_closed')
  m=json.loads(line)
  if m.get('id')==n:
   if 'error' in m:raise RuntimeError('daemon_refused')
   return m['result']
 raise RuntimeError('read_timeout')
try:
 rpc('initialize',{'clientInfo':{'name':'harness_native_source_census','version':'1'},'capabilities':{'experimentalApi':True}})
 p.stdin.write('{"method":"initialized"}\n');p.stdin.flush()
 counts={'threads':0,'parentFieldPresent':0,'nativeThreadSpawnSource':0,'sourceParentPresent':0,'sourceDepthPresent':0};sources={};threads=[]
 kinds=['cli','vscode','exec','appServer','subAgent','subAgentReview','subAgentCompact','subAgentThreadSpawn','subAgentOther','unknown']
 for archived in [False,True]:
  cursor=None
  while True:
   page=rpc('thread/list',{'limit':50,'cursor':cursor,'archived':archived,'sourceKinds':kinds,'modelProviders':[],'useStateDbOnly':True})
   for t in page['data']:
    threads.append(t);counts['threads']+=1;counts['parentFieldPresent']+=isinstance(t.get('parentThreadId'),str)
    s=t.get('source');label=s if isinstance(s,str) and s in kinds else 'object' if isinstance(s,dict) else 'other';sources[label]=sources.get(label,0)+1
    sub=s.get('subAgent') if isinstance(s,dict) else None
    spawn=sub.get('thread_spawn') if isinstance(sub,dict) else None
    if isinstance(spawn,dict):
     counts['nativeThreadSpawnSource']+=1;counts['sourceParentPresent']+=isinstance(spawn.get('parent_thread_id'),str);counts['sourceDepthPresent']+=isinstance(spawn.get('depth'),int)
   cursor=page['nextCursor']
   if cursor is None:break
 by_id={t['id']:t for t in threads};edges=[]
 for t in threads:
  source=t.get('source');sub=source.get('subAgent') if isinstance(source,dict) else None;edge=sub.get('thread_spawn') if isinstance(sub,dict) else None
  if isinstance(edge,dict):edges.append((t['id'],edge))
 counts['sourceParentsResolveInListing']=sum(e.get('parent_thread_id') in by_id for _,e in edges)
 counts['sourceParentsDangle']=len(edges)-counts['sourceParentsResolveInListing']
 counts['maximumNativeDepth']=max((e.get('depth',0) for _,e in edges),default=0)
 selected=rpc('thread/read',{'threadId':edges[0][0],'includeTurns':False})['thread'] if edges else {}
 counts['selectedChildReadHasParentField']=isinstance(selected.get('parentThreadId'),str)
 counts['selectedChildReadMatchesNativeSpawnParent']=bool(edges) and selected.get('parentThreadId')==edges[0][1].get('parent_thread_id')
 print(json.dumps({'command':'native thread/list source census, state database only','counts':counts,'sourceKinds':sources}))
finally:
 p.terminate()
 try:p.wait(timeout=5)
 except subprocess.TimeoutExpired:p.kill();p.wait()
