"""Project-page ChatGPT DOM: the panel must show the answer, not the speaker label.

The current project build wraps each message in a .group whose h4 carries
data-conversation-role, and the answer body is a MarkdownRoot. The label used to be
read as the message ("ChatGPT 说：", 10 characters) and shared its turn key with the
real answer, so the panel showed an empty shell. This runs the real extension
against that markup and checks the reply that reaches #last-reply.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import json,time
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
OUT.mkdir(parents=True,exist_ok=True)
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())

HTML='''<!doctype html><meta charset="utf-8"><style>#prompt-textarea{min-height:60px;border:1px solid}button{min-width:30px;min-height:25px}</style>
<main><div id="thread"><div data-turn-key="turn-0"><div class="group"><h4 data-conversation-role="user">你说：</h4><div data-user-message-bubble>开场问题</div></div><div class="group"><h4 data-conversation-role="assistant">ChatGPT 说：</h4><div class="MarkdownRoot-rZKhxa"><div class="DilRenderer-tB76Jj"><p class="TextBase-qM5iDq">开场回答</p></div></div></div></div></div></main>
<form data-chatgpt-composer onsubmit="return false"><div id="prompt-textarea" contenteditable="true" role="textbox"></div><button type="button" data-testid="send-button">发送</button></form>
<script>
window.sent=[];
const thread=document.querySelector('#thread'),editor=document.querySelector('#prompt-textarea');
function turn(index,text){
 const node=document.createElement('div');node.setAttribute('data-turn-key','turn-'+index);
 node.innerHTML='<div class="group"><h4 data-conversation-role="user">你说：</h4><div data-user-message-bubble></div></div>'
  +'<div class="group"><h4 data-conversation-role="assistant">ChatGPT 说：</h4><div class="MarkdownRoot-rZKhxa"><div class="DilRenderer-tB76Jj"><p class="TextBase-qM5iDq">回答 '+index+'：已收到第 '+index+' 步。</p></div></div></div>';
 node.querySelector('[data-user-message-bubble]').textContent=text;
 thread.append(node);
}
document.querySelector('[data-testid="send-button"]').onclick=()=>{
 const text=editor.innerText.trim();if(!text)return;
 sent.push(text);editor.textContent='';turn(sent.length,text);
};
</script>'''

results=[]
with TemporaryDirectory(prefix='pc-chatgpt-project-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
  try:
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker',timeout=15000)
   base='/'.join(worker.url.split('/')[:3])+'/'
   page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
   page.route('https://chatgpt.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML))
   page.goto('https://chatgpt.com/c/project-fixture')
   page.wait_for_timeout(800)
   flow=worker.evaluate('''async()=>{const flow=PromptFlowModel.flow({title:'项目页读取',steps:[{text:'第一条测试'},{text:'第二条测试'}]});await PromptFlowStore.saveFlow(flow);return flow;}''')
   panel=context.new_page();panel.goto(base+'workflow.html?flow='+flow['id'])
   panel.locator('#target option').nth(1).wait_for(state='attached')
   panel.locator('#target').select_option(index=1)
   panel.locator('#run').click()
   def wait_reply(marker,timeout=45):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
     value=panel.locator('#last-reply').inner_text()
     if marker in value:return value
     panel.wait_for_timeout(100)
    raise AssertionError('reply never showed '+marker)
   first=wait_reply('回答 1')
   assert first.strip()=='回答 1：已收到第 1 步。',repr(first)
   second=wait_reply('回答 2')
   assert second.strip()=='回答 2：已收到第 2 步。',repr(second)
   deadline=time.monotonic()+45
   while time.monotonic()<deadline:
    run=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
    if run['status']=='completed':break
    if run['status']!='running':raise AssertionError(run)
    panel.wait_for_timeout(100)
   assert run['status']=='completed',run
   assert page.evaluate('sent')==['第一条测试','第二条测试'],page.evaluate('sent')
   reader=panel.evaluate('''async()=>{const [tab]=await chrome.tabs.query({url:'https://chatgpt.com/c/project-fixture'});return (await chrome.tabs.sendMessage(tab.id,{type:'PF_STATUS'})).snapshot.reader}''')
   assert reader['users']==3 and reader['assistants']==3,reader
   assert reader['version']>=8,reader
   assert not errors,errors
   results.append('project DOM: speaker labels are not messages; #last-reply shows 回答 1 / 回答 2 and the flow completes')
   report={'version':worker.evaluate('chrome.runtime.getManifest().version'),'environment':'loaded extension in isolated Edge, synthetic project-page ChatGPT DOM','checks':['h4 data-conversation-role labels are ignored as message bodies','#last-reply shows the answer text instead of "ChatGPT 说："','turn keys keep user and assistant distinct (3 users / 3 assistants)','two text steps send once each and the run completes']}
   (OUT/'chatgpt-project-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))
  finally:context.close()
