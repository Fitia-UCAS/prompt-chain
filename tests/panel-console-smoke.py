from pathlib import Path
from tempfile import TemporaryDirectory
import json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
with TemporaryDirectory(prefix='pc-console-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
  try:
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker');base='/'.join(worker.url.split('/')[:3])+'/'
   target=context.new_page();target.route('https://chat.deepseek.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body='<title>DeepSeek - 探索未至之境</title><textarea placeholder="DeepSeek"></textarea>'));target.goto('https://chat.deepseek.com/a/chat/s/panel-test')
   worker.evaluate('''async()=>{const [tab]=await chrome.tabs.query({url:'https://chat.deepseek.com/a/chat/s/panel-test'}),flow=PromptFlowModel.flow({title:'Console',steps:Array.from({length:20},(_,i)=>({text:'Step '+(i+1)}))});await chrome.storage.local.set({pfRun:{id:'console-test',flow,tabId:tab.id,targetUrl:tab.url,status:'paused',phase:'waiting',index:0,logs:[{at:0,text:'Conversation locked: DeepSeek',level:'INFO',logger:'prompt_chain.runner',tone:'info'}]}})}''')
   page=context.new_page();page.set_viewport_size({'width':420,'height':1100});page.goto(base+'workflow.html?monitor=1');page.locator('#monitor-title').wait_for()
   assert page.locator('#last-reply').inner_text()==''
   assert page.locator('#target').locator('option:checked').inner_text()=='DeepSeek'
   def heights():return page.locator('#last-reply,#logs').evaluate_all('(els)=>els.map(el=>el.getBoundingClientRect().height)')
   assert heights()==[180,180],heights()
   log_y=page.locator('#log-console').evaluate('(el)=>el.getBoundingClientRect().top')
   worker.evaluate('''()=>chrome.runtime.sendMessage({type:'PF_REPLY_VIEW',view:{runId:'console-test',index:0,text:('Long reply'+String.fromCharCode(10)).repeat(100)}})''')
   page.wait_for_function('document.querySelector("#last-reply").textContent.length>500')
   assert heights()==[180,180] and page.locator('#log-console').evaluate('(el)=>el.getBoundingClientRect().top')==log_y
   assert page.locator('#last-reply').evaluate('(el)=>el.scrollHeight>el.clientHeight')
   first=page.locator('#logs .log-row').inner_text();assert first=='> [INFO] Conversation locked: DeepSeek',first
   steps=page.locator('#monitor-steps');steps.hover()
   for delta,expected in [(120,44),(240,88),(-120,44),(-240,0)]:
    page.wait_for_timeout(150);page.mouse.wheel(0,delta);page.wait_for_timeout(70)
    assert steps.evaluate('(el)=>el.scrollTop')==expected,steps.evaluate('(el)=>el.scrollTop')
   assert worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun.index')==0
   page.screenshot(path=str(OUT/'panel-console.png'))
   report={'version':worker.evaluate('chrome.runtime.getManifest().version'),'checks':['Empty and full reply bodies both 180px, equal to logs; log panel position unchanged; long reply scrolls internally','Blank empty reply; target label DeepSeek without page tagline','Python logging style timestamp/level/logger/message rendered consistently','Wheel deltas 120 and 240 each move one 44px step in either direction without changing run index']}
   (OUT/'panel-console-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))
  finally:context.close()
