from pathlib import Path
from tempfile import TemporaryDirectory
import json,time
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
URL='https://chatgpt.com/c/folded-fixture'
OPENING='你将依次收到四个文件。'
NAME='02-anadiplosis-information-linkage.md'
history={'conversation_id':'folded-fixture','current_node':'root','mapping':{'root':{'parent':None}}}
def turn(text,index,names):
 user='user-'+str(index);answer='answer-'+str(index)
 history['mapping'][user]={'parent':history['current_node'],'message':{'id':user,'author':{'role':'user'},'content':{'parts':[text]},'metadata':{'attachments':[{'name':name} for name in names]}}}
 history['mapping'][answer]={'parent':user,'message':{'id':answer,'author':{'role':'assistant'},'content':{'parts':['已经阅读附件。' if names else '收到。']},'status':'finished_successfully','channel':'final'}}
 history['current_node']=answer
for index in (1,2):turn(OPENING,index,[])
turn('',3,[NAME])
HTML='''<!doctype html><meta charset="utf-8"><main><section><div data-user-message-bubble>你将依次收到四个文件。</div><button>显示更多</button></section><section><div data-user-message-bubble>你将依次收到四个文件。</div><button>显示更多</button></section><section><button id="fold">折叠附件消息</button><div id="attachment">02-anadiplosis-information-linkage.md</div><p>附件已完整阅读。</p></section></main><form onsubmit="return false"><textarea id="mobile-composer-prompt"></textarea><button type="button" aria-label="发送消息">发送</button></form><script>window.sendCount=0;document.querySelector('#fold').onclick=()=>{const n=document.querySelector('#attachment');n.hidden=!n.hidden;};document.querySelector('form button').onclick=async()=>{sendCount++;await recordTurn(document.querySelector('textarea').value,4,[]);document.querySelector('textarea').value='';};</script>'''
with TemporaryDirectory(prefix='pc-folded-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
  worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
  base='/'.join(worker.url.split('/')[:3])+'/'
  page=context.new_page();page.goto(base+'workflow.html')
  target=context.new_page()
  def respond(route):
   url=route.request.url
   if url.endswith('/api/auth/session'):route.fulfill(status=200,content_type='application/json',body=json.dumps({'accessToken':'fixture-only'}))
   elif '/backend-api/conversation/' in url:route.fulfill(status=200,content_type='application/json',body=json.dumps(history,ensure_ascii=False))
   else:route.fulfill(status=200,content_type='text/html',body=HTML)
  target.route('https://chatgpt.com/**',respond);target.expose_function('recordTurn',turn);target.goto(URL)
  tab_id=page.evaluate('async url=>(await chrome.tabs.query({url}))[0].id',URL)
  deadline=time.monotonic()+15
  while time.monotonic()<deadline:
   ready=page.evaluate('async id=>{try{return(await chrome.tabs.sendMessage(id,{type:"PF_STATUS"}))?.ok&&(await chrome.tabs.sendMessage(id,{type:"COMPAT_CHECK",payload:{}}))?.result?.ready}catch{return false}}',tab_id)
   if ready:break
   page.wait_for_timeout(100)
  assert ready
  page.evaluate('''async({tabId,url,name,opening})=>{
   const M=PromptFlowModel,attachment=await PromptFlowStore.saveFile(new File(['abc'],name,{type:'text/markdown'})),now=Date.now();
   const baselineMessages=[1,2].flatMap(index=>[{key:'m:user-'+index,role:'user',fingerprint:M.fingerprint('user\\n'+opening)},{key:'m:answer-'+index,role:'assistant',fingerprint:M.fingerprint('assistant\\n收到。')}]);
   const pending={id:'pending-file',runId:'folded-run',url,text:'',attachment,attachmentUploaded:true,attemptedAt:now-45000,createdAt:now-45000,baselineUserKey:'m:user-2',baselineAssistantKey:'m:answer-2',baselineMessages,documentId:'old-document'};
   const run={id:'folded-run',tabId,tabTitle:'折叠夹具',targetUrl:url,status:'paused',phase:'sending',index:1,repeated:0,reason:'尚未匹配本步内容',flow:M.flow({title:'已发送附件恢复测试',steps:[{text:opening},{text:'',attachment},{text:'下一步'}]}),pending,sentUserKey:'m:user-2',beforeAssistantKey:'m:answer-2',logs:[],lastReply:'上一轮回答'};
   await chrome.storage.local.set({pfRun:run});
  }''',{'tabId':tab_id,'url':URL,'name':NAME,'opening':OPENING})
  page.goto(base+'workflow.html?monitor=1')
  assert page.get_by_text('自动续作',exact=True).count()==0
  for _ in range(4):target.locator('#fold').click()
  page.get_by_role('button',name='恢复执行',exact=True).click()
  deadline=time.monotonic()+25
  while time.monotonic()<deadline:
   run=worker.evaluate('async()=>(await chrome.storage.local.get("pfRun")).pfRun')
   if run['status']=='completed':break
   target.locator('#fold').click();page.wait_for_timeout(200)
  assert run['status']=='completed',{'run':run,'notice':page.locator('#notice').inner_text(),'diagnostic':page.evaluate('async()=>chrome.runtime.sendMessage({type:"PF_DIAGNOSTIC"})')}
  assert run['index']==3 and target.evaluate('sendCount')==1
  assert history['mapping']['user-4']['message']['content']['parts']==['下一步']
  assert 'lastReply' not in run
  report={'passed':'Loaded extension monitor Resume recovers an already-sent file from current-branch history while DOM remains on folded old users; repeated folding does not resend the file, and the following step completes. Local fixture, not live ChatGPT.','version':json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))['version']}
  context.close()
(OUT/'folded-attachment-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
