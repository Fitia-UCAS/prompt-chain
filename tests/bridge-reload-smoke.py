from pathlib import Path
from tempfile import TemporaryDirectory
import ast,json
from playwright.sync_api import sync_playwright, Error

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
tree=ast.parse((ROOT/'tests/message-reader-smoke.py').read_text(encoding='utf-8'))
HTML=next(ast.literal_eval(node.value) for node in tree.body if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='HTML' for t in node.targets))
with TemporaryDirectory(prefix='pc-reload-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
  worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
  page=context.new_page();errors=[]
  session=context.new_cdp_session(page);session.send('Runtime.enable')
  session.on('Runtime.exceptionThrown',lambda event:errors.append(event['exceptionDetails'].get('exception',{}).get('description',event['exceptionDetails']['text'])))
  page.route('https://chatgpt.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML))
  page.goto('https://chatgpt.com/c/reload-fixture');page.wait_for_timeout(1000)
  status='async()=>{const [tab]=await chrome.tabs.query({url:"https://chatgpt.com/c/reload-fixture"});return chrome.tabs.sendMessage(tab.id,{type:"PF_STATUS"});}'
  before=worker.evaluate(status);assert before['ok'],before
  with context.expect_event('serviceworker',timeout=20000) as restarted:
   try:worker.evaluate('chrome.runtime.reload()')
   except Error as error:
    if 'closed' not in str(error) and 'destroyed' not in str(error):raise
  worker=restarted.value
  for i in range(12):
   page.evaluate('(i)=>{const node=document.createElement("div");node.textContent="reload mutation "+i;document.body.append(node)}',i)
   page.wait_for_timeout(300)
  page.wait_for_timeout(3000)
  assert not errors,errors
  page.reload();page.wait_for_timeout(1000)
  after=worker.evaluate(status)
  assert after['ok'] and before['snapshot']['documentId']!=after['snapshot']['documentId'],after
  assert not errors,errors
  context.close()
result={'extensionReloaded':True,'domMutationsAfterReload':12,'uncaughtErrors':errors,'freshPageReconnected':True,'site':'local fixture in isolated Edge profile'}
(OUT/'bridge-reload-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False))
