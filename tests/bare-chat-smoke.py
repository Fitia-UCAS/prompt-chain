from pathlib import Path
from tempfile import TemporaryDirectory
import json,time,sys
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
HTML='''<!doctype html><meta charset="utf-8"><style>#prompt-textarea{min-height:60px;border:1px solid}button{min-width:30px;min-height:25px}</style>
<main><div id="timeline" class="prose"></div></main><form onsubmit="return false"><input type="file"><div id="prompt-textarea" contenteditable="true" role="textbox"></div><button type="button" data-testid="send-button">发送</button></form>
<script>
window.sendCount=0;window.filesSeen=[];window.sentTexts=[];
const timeline=document.querySelector('#timeline'),form=document.querySelector('form'),editor=document.querySelector('#prompt-textarea');
function appendUser(text,index){const turn=document.createElement('div');turn.setAttribute('data-message-id','user-'+index);const bubble=document.createElement('div');bubble.setAttribute('data-user-message-bubble','');bubble.textContent=text;turn.append(bubble);timeline.append(turn);return turn;}
function appendAnswer(index){const turn=document.createElement('div');turn.setAttribute('data-message-id','answer-'+index);turn.innerHTML='<div class="markdown prose"><p>回答 '+index+'：已收到并阅读。</p></div><button>复制</button>';timeline.append(turn);}
for(let index=1;index<=3;index++){appendUser('重复开场',index);appendAnswer(index);}
document.querySelector('input').onchange=event=>{for(const file of event.target.files){filesSeen.push(file.name);const chip=document.createElement('div');chip.className='attached';chip.textContent=file.name;chip.setAttribute('aria-label',file.name);form.append(chip);}};
document.querySelector('[data-testid="send-button"]').onclick=()=>{sendCount++;sentTexts.push(editor.innerText);const index=sendCount+3,turn=appendUser(editor.innerText,index);for(const chip of form.querySelectorAll('.attached'))turn.append(chip);editor.textContent='';appendAnswer(index);};
</script>'''
blind='--blind' in sys.argv
api={'conversation_id':'bare-fixture','current_node':'root','mapping':{'root':{'parent':None}}}
def record_turn(text,index,names):
 parent=api['current_node'];user='user-'+str(index);answer='answer-'+str(index)
 api['mapping'][user]={'parent':parent,'message':{'id':user,'author':{'role':'user'},'content':{'parts':[text] if text else []},'metadata':{'attachments':[{'name':name} for name in names]},'status':'finished_successfully'}}
 api['mapping'][answer]={'parent':user,'message':{'id':answer,'author':{'role':'assistant'},'channel':'final','content':{'parts':[f'回答 {index}：已收到并阅读。']},'status':'finished_successfully'}}
 api['current_node']=answer
if blind:
 for index in range(1,4):record_turn('重复开场',index,[])
 HTML=HTML.replace('data-user-message-bubble','data-fixture-user').replace('data-message-id','data-fixture-id').replace('class="markdown prose"','class="reply-text"').replace('class="prose"','class="conversation"')
 HTML=HTML.replace("document.querySelector('[data-testid=\"send-button\"]').onclick=()=>{sendCount++;", "document.querySelector('[data-testid=\"send-button\"]').onclick=async()=>{sendCount++;await window.recordTurn(editor.innerText,sendCount+3,[...form.querySelectorAll('.attached')].map(el=>el.textContent));")
results=[]
with TemporaryDirectory(prefix='pc-bare-chat-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
  worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker',timeout=15000)
  base='/'.join(worker.url.split('/')[:3])+'/'
  page=context.new_page();page.goto(base+'workflow.html')
  target=context.new_page();errors=[];target.on('pageerror',lambda error:errors.append(str(error)))
  def respond(route):
   url=route.request.url
   if url.endswith('/api/auth/session'):route.fulfill(status=200,content_type='application/json',body=json.dumps({'accessToken':'fixture-token'}))
   elif '/backend-api/conversation/' in url:route.fulfill(status=200,content_type='application/json',body=json.dumps(api,ensure_ascii=False))
   else:route.fulfill(status=200,content_type='text/html',body=HTML)
  target.route('https://chatgpt.com/**',respond)
  if blind:target.expose_function('recordTurn',record_turn)
  target.goto('https://chatgpt.com/c/bare-fixture')
  tab_id=page.evaluate('async()=> (await chrome.tabs.query({url:"https://chatgpt.com/c/bare-fixture"}))[0].id')
  deadline=time.monotonic()+15
  while time.monotonic()<deadline:
   ready=page.evaluate('''async({id,blind})=>{try{const reader=(await chrome.tabs.sendMessage(id,{type:'PF_STATUS'}))?.snapshot?.reader;return blind?reader?.version===10:reader?.assistants===3}catch{return false}}''',{'id':tab_id,'blind':blind})
   if ready:break
   page.wait_for_timeout(100)
  assert ready,'bare DOM did not expose three assistant replies'
  seeded=page.evaluate(r'''async tabId=>{
   const M=PromptFlowModel,S=PromptFlowStore,fingerprint=M.fingerprint('user\n重复开场'),key=n=>`dom:user:${fingerprint}:${n}`;
   const steps=[{text:'重复开场'}];for(let index=1;index<20;index++)steps.push(index<=14?{text:'',attachment:await S.saveFile(new File(['abc'],`素材${index}.md`,{type:'text/markdown'}))}:{text:`后续任务 ${index}`});
   const flow=M.flow({title:'三条用户、零条回答的旧任务恢复',delaySeconds:0,steps}),now=Date.now();
   const delivery={text:'重复开场',baselineUserKey:key(2),baselineAssistantKey:'',baselineMessages:[1,2].map(n=>({key:key(n),role:'user',fingerprint})),attemptedAt:now-45000,url:'https://chatgpt.com/c/bare-fixture'};
   const run={id:'legacy-bare-run',flow,tabId,tabTitle:'bare fixture',targetUrl:delivery.url,allowNewChat:false,status:'running',phase:'waiting',index:0,repeated:0,pending:null,delivery,sentUserKey:key(3),beforeAssistantKey:'',quietSignature:'',quietSince:0,sentAt:now-45000,logs:[],lastReply:'',startedAt:now-45000};
   await chrome.storage.local.set({pfRun:run});return flow.steps.length;
  }''',tab_id)
  assert seeded==20
  deadline=time.monotonic()+210;last_index=-1
  while time.monotonic()<deadline:
   run=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
   assert run['status']!='paused',run
   if run['index']!=last_index:
    print(f"bare DOM workflow: {run['index']} / 20",flush=True);last_index=run['index']
   if run['status']=='completed':break
   page.wait_for_timeout(200)
  assert run['status']=='completed',run
  assert run['index']==20
  assert target.evaluate('sendCount')==19
  assert target.evaluate('filesSeen')==[f'素材{index}.md' for index in range(1,15)]
  assert '重复开场' not in target.evaluate('sentTexts')
  diagnostic=page.evaluate('async()=>chrome.runtime.sendMessage({type:"PF_DIAGNOSTIC"})')
  assert diagnostic['ok'] and diagnostic['diagnostic']['reader']['assistants']==22,diagnostic
  if blind:assert diagnostic['diagnostic']['reader']['source']=='conversation-history',diagnostic
  assert not errors,errors
  results.append('real extension: '+('unmounted DOM recovers through current-branch history' if blind else 'legacy users-only receipt recovers through DOM bodies')+'; all 20 steps complete with 14 ordered files and no repeat of the already-sent first step')
  context.close()
(OUT/('history-flow-report.json' if blind else 'bare-chat-report.json')).write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False,indent=2))
