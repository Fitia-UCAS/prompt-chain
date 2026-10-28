from pathlib import Path
from tempfile import TemporaryDirectory
import ast,base64,json,time,sys
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
tree=ast.parse((ROOT/'tests/provider-new-chat-smoke.py').read_text(encoding='utf-8'))
HTML=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='HTML' for t in n.targets))
HTML=HTML.replace('<form onsubmit="return false">','<div id="composer">').replace('</form>','</div>').replace("document.querySelector('form')","document.querySelector('#composer')")
HTML=HTML.replace('window.sent=[];', 'window.uploadsReady=false;window.enterCount=0;window.otherClicks=0;window.sent=[];')
HTML=HTML.replace('form.append(node);', "node.setAttribute('aria-busy','true');const timer=setInterval(()=>{if(uploadsReady){node.removeAttribute('aria-busy');clearInterval(timer)}},100);form.append(node);")
HTML=HTML.replace("node.append(body);for(const file", "if(raw)node.append(body);for(const file")
HTML=HTML.replace("form.append(node);", "node.innerHTML='<span>'+file.name.replace(/\\.[^.]+$/,'')+'</span><span>'+file.name.split('.').at(-1).toUpperCase()+'2.96KB</span>';form.append(node);")
HTML=HTML.replace('</script>','''const send=document.querySelector('[aria-label="Send message"]');send.type='button';send.removeAttribute('aria-label');send.textContent='';send.innerHTML='<svg viewBox="0 0 24 24"><path d="M12 20V4m-6 6 6-6 6 6"/></svg>';
const other=document.createElement('button');other.type='button';other.textContent='深度思考';other.onclick=()=>otherClicks++;form.append(other);
input.onkeydown=event=>{if(event.key==='Enter'){enterCount++;if(input.value||form.querySelector('.attachment'))send.click()}};</script>''')
with TemporaryDirectory(prefix='pc-deepseek-files-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
  try:
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
   base='/'.join(worker.url.split('/')[:3])+'/'
   page=context.new_page();page.route('https://chat.deepseek.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML));page.goto('https://chat.deepseek.com/');page.wait_for_timeout(800)
   png=list(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='))
   flow=worker.evaluate('''async bytes=>{const md=await PromptFlowStore.saveFile(new File(['# DeepSeek upload'],'deepseek.md',{type:'text/markdown'})),image=await PromptFlowStore.saveFile(new File([new Uint8Array(bytes)],'deepseek.png',{type:'image/png'}));const flow=PromptFlowModel.flow({title:'DeepSeek 纯附件发送',steps:[{text:'测试开始'},{attachment:md},{attachment:image},{text:'测试结束'}]});await PromptFlowStore.saveFlow(flow);return flow;}''',png)
   if '--recover' in sys.argv:
    worker.evaluate("""async()=>{const [tab]=await chrome.tabs.query({url:'https://chat.deepseek.com/*'});await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{const reader=PromptChainMessages,read=reader.read;globalThis.restoreReader=()=>{reader.read=read};reader.read=()=>{const scan=read();return{...scan,messages:scan.messages.filter(message=>!message.files?.length)}}}})}""")
   panel=context.new_page();panel.goto(base+'workflow.html?flow='+flow['id']);panel.locator('#target option').nth(1).wait_for(state='attached');panel.locator('#target').select_option(index=1);panel.locator('#run').click()
   page.wait_for_function('filesSeen.length===1')
   if '--missing-preview' in sys.argv:
    page.locator('.attachment').evaluate("node=>node.textContent='Unknown attachment'")
    page.evaluate('uploadsReady=true');start=time.monotonic()
    while time.monotonic()-start<12:
     failed=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
     if failed['status']=='paused':break
     page.wait_for_timeout(100)
    assert failed['status']=='paused' and failed['reason'].startswith('UPLOAD_PREVIEW_NOT_RECOGNIZED:'),failed
    diagnostic=panel.evaluate('()=>chrome.runtime.sendMessage({type:"PF_DIAGNOSTIC"})')['diagnostic']
    assert diagnostic['upload']['nameMatched'] is False and diagnostic['upload']['busy'] is False
    assert any(log['text'].startswith('Upload pending:') for log in failed['logs'])
    assert failed['logs'][-1]['level']=='ERROR' and page.evaluate('enterCount')==1
    (OUT/'deepseek-upload-failure-report.json').write_text(json.dumps({'version':diagnostic['version'],'environment':'local loaded extension fixture','failureSeconds':round(time.monotonic()-start,2),'upload':diagnostic['upload'],'checks':['Unrecognized preview fails within 12s without clicking send; pending condition logged earlier; English ERROR code and upload diagnostics']},ensure_ascii=False,indent=2),encoding='utf-8')
    print('Unrecognized upload preview: early English error, progress and Diagnostics confirmed; no send',flush=True)
    raise SystemExit(0)
   page.wait_for_timeout(1600)
   assert page.evaluate('sent.length')==1 and page.evaluate('enterCount')==1
   assert page.locator('#input').input_value()==''
   page.evaluate('uploadsReady=true')
   if '--recover' in sys.argv:
    deadline=time.monotonic()+25
    while time.monotonic()<deadline:
     paused=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
     if paused['status']=='paused':break
     page.wait_for_timeout(100)
    assert paused['status']=='paused' and paused['phase']=='sending' and paused['index']==1,paused
    assert paused['reason'].startswith('SEND_RECEIPT_UNCONFIRMED:'),paused
    assert page.evaluate('sent')==['测试开始','']
    worker.evaluate("""async()=>{const [tab]=await chrome.tabs.query({url:'https://chat.deepseek.com/*'});await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>restoreReader()})}""")
    panel.locator('#resume').click()
   deadline=time.monotonic()+35
   while time.monotonic()<deadline:
    run=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
    if run['status']=='completed':break
    if run['status']=='paused':raise AssertionError(run)
    panel.wait_for_timeout(100)
   assert run['status']=='completed',run
   diagnostic=panel.evaluate('()=>chrome.runtime.sendMessage({type:"PF_DIAGNOSTIC"})')['diagnostic']
   assert diagnostic['reader']['users']==4 and diagnostic['reader']['assistants']==4,diagnostic
   assert diagnostic['reader']['probe']['attachmentOnlyUsers']==2,diagnostic
   assert worker.evaluate("""async()=>{const run=(await chrome.storage.local.get('pfRun')).pfRun;return(await chrome.scripting.executeScript({target:{tabId:run.tabId},func:()=>PromptChainSiteMessages.read().messages.filter(message=>message.files.length).every(message=>message.files.length===1)}))[0].result}""")
   assert page.locator('.ds-collapsible-text').count()==2
   assert page.locator('#composer .attachment').count()==0
   assert page.evaluate('sent')==['测试开始','','','测试结束']
   assert page.evaluate('enterCount')==4 and page.evaluate('otherClicks')==0
   assert page.evaluate('filesSeen.map(file=>file.name)')==['deepseek.md','deepseek.png']
   assert panel.locator('#logs .log-row').first.inner_text().endswith('Conversation locked: DeepSeek')
   assert any(item['text']=='Preparing step 1/4' for item in run['logs'])
   assert any(item['text']=='Sending step 2/4' for item in run['logs'])
   report={'recoveredWithoutResend':'--recover' in sys.argv,'version':worker.evaluate('chrome.runtime.getManifest().version'),'environment':'loaded extension, isolated Edge, synthetic DeepSeek DOM; not live account','checks':['Unlabelled icon send button without a form; initial text, Markdown only, PNG only, final text all delivered exactly once using Enter','Attachment-only steps keep empty body; busy upload prevents early send; unrelated buttons never clicked','Logs use concise lock, prepare, send and complete messages']}
   (OUT/('deepseek-receipt-recovery-report.json' if '--recover' in sys.argv else 'deepseek-attachment-report.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))
  finally:context.close()
