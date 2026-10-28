from pathlib import Path
from tempfile import TemporaryDirectory
import ast,base64,json,time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
tree=ast.parse((ROOT/'tests/provider-new-chat-smoke.py').read_text(encoding='utf-8'))
HTML=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='HTML' for t in n.targets))
HTML=HTML.replace('window.sent=[];', 'window.uploadsReady=false;window.sent=[];')
HTML=HTML.replace('form.append(node);', '''node.innerHTML='<div class="file-preview-container"><gem-attachment><span class="gem-attachment-text">'+file.name.slice(0,8)+'…</span></gem-attachment></div>';node.setAttribute('aria-busy','true');const timer=setInterval(()=>{if(uploadsReady){node.removeAttribute('aria-busy');clearInterval(timer)}},100);node.title=file.name;form.append(node);event.target.value='';''')
with TemporaryDirectory(prefix='pc-gemini-upload-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
  try:
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
   base='/'.join(worker.url.split('/')[:3])+'/'
   page=context.new_page();page.route('https://gemini.google.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML));page.goto('https://gemini.google.com/app?dest=create');page.wait_for_timeout(800)
   png=list(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='))
   flow=worker.evaluate('''async bytes=>{const md=await PromptFlowStore.saveFile(new File(['# Upload fixture'],'code-file.md',{type:'text/markdown'})),image=await PromptFlowStore.saveFile(new File([new Uint8Array(bytes)],'picture.png',{type:'image/png'}));const flow=PromptFlowModel.flow({title:'附件发送检查',steps:[{text:'第一条测试'},{attachment:md},{attachment:image},{text:'最后一条测试'}]});await PromptFlowStore.saveFlow(flow);return flow;}''',png)
   panel=context.new_page();panel.goto(base+'workflow.html?flow='+flow['id']);panel.locator('#target option').nth(1).wait_for(state='attached');panel.locator('#target').select_option(index=1);panel.locator('#run').click()
   page.wait_for_function('filesSeen.length===1')
   page.wait_for_timeout(1500)
   assert page.evaluate('sent.length')==1
   assert panel.locator('#last-reply').inner_text()=='本轮回答完成 1'
   assert panel.locator('#logs .log-row').first.inner_text().find('Conversation locked:')>=0
   before=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
   panel.get_by_role('button',name='清空执行日志',exact=True).click()
   panel.wait_for_function('document.querySelector("#logs").children.length===0')
   after=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
   assert (before['id'],before['index'],before['phase'],before['pending'])==(after['id'],after['index'],after['phase'],after['pending'])
   assert after['status']=='running' and panel.locator('#log-console').get_attribute('open') is not None
   sizes=panel.locator('#copy-logs,#clear-logs').evaluate_all('(els)=>els.map(el=>{const r=el.getBoundingClientRect();return[r.width,r.height]})')
   assert sizes[0]==sizes[1]
   page.evaluate('uploadsReady=true')
   deadline=time.monotonic()+35
   while time.monotonic()<deadline:
    run=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
    if run['status']=='completed':break
    if run['status']=='paused':raise AssertionError(run)
    panel.wait_for_timeout(100)
   assert run['status']=='completed',run
   assert page.evaluate('sent.length')==4
   assert page.evaluate('filesSeen.map(file=>file.name)')==['code-file.md','picture.png']
   assert 'lastReply' not in run
   page.goto('https://gemini.google.com/app?dest=create');page.wait_for_timeout(800)
   panel.goto(base+'workflow.html?flow='+flow['id']);panel.locator('#target option').nth(1).wait_for(state='attached');panel.locator('#target').select_option(index=1);panel.locator('#run').click()
   page.wait_for_function('filesSeen.length===1')
   page.evaluate('''()=>{const input=document.querySelector('input[type=file]'),transfer=new DataTransfer();transfer.items.add(new File(['different bytes'],'other.md',{type:'text/markdown'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));uploadsReady=true;}''')
   page.wait_for_timeout(2200);assert page.evaluate('sent.length')==1
   panel.locator('#pause').click();panel.locator('#stop').click();page.wait_for_timeout(700);assert page.evaluate('sent.length')==1
   report={'version':worker.evaluate('chrome.runtime.getManifest().version'),'environment':'loaded extension in isolated Edge, synthetic Gemini DOM, no live account','checks':['Truncated code/file cards without extension label or aria filename; file input reset after assignment; Markdown and PNG uploaded and sent once','Enabled send button does not bypass upload busy signal','Previous reply remains visible while next attachment uploads; no reply text persisted','Logs chronological; clear icon equals copy icon size; clearing logs preserves running step, pending operation and open console']}
   (OUT/'gemini-upload-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))
  finally:context.close()
