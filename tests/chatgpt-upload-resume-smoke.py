from pathlib import Path
from tempfile import TemporaryDirectory
import ast,json,time,sys
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
tree=ast.parse((ROOT/'tests/browser-smoke.py').read_text(encoding='utf-8'))
HTML=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='HTML' for t in n.targets))
HTML=HTML.replace('window.sendCount=0;', 'window.uploadReady=false;window.sendCount=0;')
HTML=HTML.replace("setTimeout(()=>node.removeAttribute('aria-busy'),300)", "const timer=setInterval(()=>{if(uploadReady){node.removeAttribute('aria-busy');clearInterval(timer)}},100)")
HTML=HTML.replace("form.append(node);set", "form.append(node);set")
HTML=HTML.replace("const form=document.querySelector('form'),editor=", "const form=document.querySelector('form');let editor=")
HTML=HTML.replace("form.append(node);const timer", "form.append(node);const replacement=editor.cloneNode(true);editor.replaceWith(replacement);editor=replacement;const timer")
if '--truncated' in sys.argv:
 HTML=HTML.replace("node.querySelector('span').textContent=f.name;node.querySelector('span').setAttribute('aria-label',f.name);", "node.querySelector('span').textContent=f.name.slice(0,20)+'...';")
 HTML=HTML.replace("'Remove '+f.name", "'Remove file'")
 HTML=HTML.replace("form.append(node);const replacement", "form.append(node);event.target.value='';const replacement")
 HTML=HTML.replace("name.textContent=chip.querySelector('span').textContent", "name.textContent=filesSeen.at(-1).name")
 HTML=HTML.replace('<div id="prompt-textarea"', '<section data-testid="composer"><div id="prompt-textarea"').replace('</div><button type="button" data-testid="send-button"', '</div></section><button type="button" data-testid="send-button"')
with TemporaryDirectory(prefix='pc-chatgpt-upload-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
  try:
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
   base='/'.join(worker.url.split('/')[:3])+'/'
   target=context.new_page();target.route('https://chatgpt.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML));target.goto('https://chatgpt.com/c/upload-resume')
   flow=worker.evaluate("""async()=>{const attachment=await PromptFlowStore.saveFile(new File(['abc'],'02-anadiplosis-information-linkage.md',{type:'text/markdown'}));const flow=PromptFlowModel.flow({title:'ChatGPT upload recovery',steps:[{text:'First'},{attachment},{text:'Last'}]});await PromptFlowStore.saveFlow(flow);return flow}""")
   panel=context.new_page();panel.goto(base+'workflow.html?flow='+flow['id']);panel.locator('#target option').nth(1).wait_for(state='attached');panel.locator('#target').select_option(index=1);panel.locator('#run').click()
   target.wait_for_function('filesSeen.length===1')
   if '--unrelated-preview' in sys.argv:
    target.locator('.attached span').evaluate("node=>node.textContent='another-unrelated-file...'")
    target.evaluate('uploadReady=true');deadline=time.monotonic()+12
    while time.monotonic()<deadline:
     failed=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
     if failed['status']=='paused':break
     panel.wait_for_timeout(100)
    assert failed['status']=='paused' and any(failed['reason'].startswith(code) for code in ('UPLOAD_ATTACHMENT_UNIDENTIFIED:','UPLOAD_ATTACHMENT_MISMATCH:','UPLOAD_PREVIEW_NOT_RECOGNIZED:')),failed
    assert target.evaluate('sendCount')==1 and len(target.evaluate('filesSeen'))==1
    print('Unrelated truncated preview rejected; file selection alone does not authorize sending',flush=True)
    raise SystemExit(0)
   panel.locator('#pause').click()
   deadline=time.monotonic()+8
   while time.monotonic()<deadline:
    state=panel.evaluate('()=>chrome.runtime.sendMessage({type:"PF_DIAGNOSTIC"})')['diagnostic']
    operation=worker.evaluate('async()=>{const run=(await chrome.storage.local.get("pfRun")).pfRun;return(await chrome.tabs.sendMessage(run.tabId,{type:"PF_STATUS"})).snapshot.operation}')
    if state['status']=='paused' and not operation:break
    panel.wait_for_timeout(100)
   assert state['status']=='paused' and state['phase']=='uploading',state
   assert target.evaluate('sendCount')==1 and target.locator('.attached').count()==1
   target.evaluate('uploadReady=true');panel.locator('#resume').click()
   deadline=time.monotonic()+25;left_pause=False
   while time.monotonic()<deadline:
    run=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
    if run['status']=='completed':break
    if run['status']=='running':left_pause=True
    if run['status']=='paused' and left_pause:raise AssertionError({'run':run,'notice':panel.locator('#notice').inner_text()})
    panel.wait_for_timeout(100)
   assert run['status']=='completed',run
   assert target.evaluate('sendCount')==3 and target.evaluate('filesSeen')==[{'name':'02-anadiplosis-information-linkage.md','size':3}]
   diagnostic=panel.evaluate('()=>chrome.runtime.sendMessage({type:"PF_DIAGNOSTIC"})')['diagnostic']
   assert diagnostic['upload']['v']==3 and diagnostic['upload']['operation']['step']==2 and diagnostic['upload']['stage']=='observing',diagnostic['upload']
   if '--truncated' in sys.argv:
    assert diagnostic['upload']['identity']['state']=='match' and diagnostic['upload']['matchMode']=='matched-prefix',diagnostic['upload']
   report={'version':diagnostic['version'],'environment':'loaded extension, isolated Edge with local ChatGPT DOM; not a live account','checks':['Text, Markdown-only, text complete','Pause during upload then Run reuses the existing attachment; one file selection, three sends','Composer node replacement within the same form is accepted when draft is unchanged','ChatGPT upload diagnostics expose preview, processing, send readiness and reuse']}
   (OUT/('chatgpt-truncated-upload-report.json' if '--truncated' in sys.argv else 'chatgpt-upload-resume-report.json')).write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report,indent=2))
  finally:context.close()
