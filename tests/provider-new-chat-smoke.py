from pathlib import Path
from tempfile import TemporaryDirectory
import json,base64,time,argparse
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
HTML='''<!doctype html><meta charset="utf-8"><style>button,[role=button]{min-width:40px;min-height:30px;display:inline-block}textarea,[contenteditable=true]{width:400px;min-height:40px}uploader-file-preview,gem-attachment{display:block}</style><main></main><input-area-v2><form onsubmit="return false"><input type="file" multiple><div id="input" contenteditable="true" role="textbox"></div><button type="button" aria-label="Send message">发送</button></form></input-area-v2><script>
window.sent=[];window.filesSeen=[];window.holdAnswers=false;window.interrupt=false;
const gem=location.hostname==='gemini.google.com',form=document.querySelector('form');
if(!gem){const old=document.querySelector('#input'),input=document.createElement('textarea');input.id='input';input.placeholder='Message DeepSeek';old.replaceWith(input)}
const input=document.querySelector('#input'),text=()=>gem?input.innerText:input.value;
document.querySelector('input[type=file]').onchange=event=>{for(const file of event.target.files){
 filesSeen.push({name:file.name,size:file.size,type:file.type});const node=document.createElement(gem?'uploader-file-preview':'div');node.className='attachment';
 const label='file-'+filesSeen.length;node.innerHTML='<div class="file-preview-container" aria-describedby="'+label+'"></div><span id="'+label+'">'+file.name+'</span><gem-attachment><span class="gem-attachment-text">'+file.name+'</span><span class="gem-attachment-extension-label">md</span></gem-attachment><button aria-label="Remove file '+file.name+'">移除</button>';form.append(node);
}};
document.querySelector('[aria-label="Send message"]').onclick=()=>{
 const raw=text();sent.push(raw);if(gem)input.textContent='';else input.value='';
 const node=document.createElement(gem?'user-query':'div');if(!gem){node.className='ds-message';node.setAttribute('data-virtual-list-item-key','q'+sent.length)}else node.dataset.messageId='q'+sent.length;
 const body=document.createElement('div');body.className=gem?'query-text':'ds-collapsible-text';body.textContent=raw;node.append(body);for(const file of form.querySelectorAll('.attachment'))node.append(file);document.querySelector('main').append(node);
 if(!/\\/(?:app|chat\\/s)\\/[^/]+/.test(location.pathname))history.pushState({},'',gem?'/app/created-by-first-message':'/a/chat/s/created-by-first-message');
 const stop=document.createElement('button');stop.setAttribute('aria-label','Stop response');form.append(stop);
 window.completeAnswer=()=>{stop.remove();const answer=document.createElement(gem?'model-response':'div');if(!gem){answer.className='ds-message';answer.setAttribute('data-virtual-list-item-key','a'+sent.length)}else answer.dataset.messageId='a'+sent.length;
 answer.innerHTML=gem?'<div class="thoughts-container">尚未完成的思考，不是回答</div><message-content><div class="markdown">本轮回答完成 '+sent.length+'</div></message-content>':'<div class="ds-think-content">尚未完成的思考，不是回答</div><div class="ds-assistant-message-main-content"><div class="ds-markdown">本轮回答完成 '+sent.length+'</div></div>';document.querySelector('main').append(answer)};
 if(interrupt)setTimeout(()=>{history.pushState({},'',gem?'/app/unrelated':'/a/chat/s/unrelated');document.querySelector('main').append(document.createElement('hr'))},250);
 if(!holdAnswers)setTimeout(completeAnswer,1000);
};</script>'''
results=[]
parser=argparse.ArgumentParser();parser.add_argument('--provider');args=parser.parse_args()
with TemporaryDirectory(prefix='pc-providers-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
  worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
  base='/'.join(worker.url.split('/')[:3])+'/'
  panel=context.new_page();panel.goto(base+'sidepanel.html');panel.get_by_role('button',name='设置',exact=True).wait_for()
  png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=')
  flow_id=worker.evaluate('''async bytes=>{const file=await PromptFlowStore.saveFile(new File(['fixture markdown'],'fixture.md',{type:'text/markdown'})),image=await PromptFlowStore.saveFile(new File([new Uint8Array(bytes)],'fixture.png',{type:'image/png'}));const flow=PromptFlowModel.flow({title:'三站流程验收',steps:[{text:'第一条测试消息'},{attachment:file},{attachment:image},{text:'最后一条测试消息'}]});await PromptFlowStore.saveFlow(flow);await PromptChainNative.syncFlow(flow);return flow.id;}''',list(png))
  def wait_run(status,timeout=35000):
   deadline=time.monotonic()+timeout/1000
   while time.monotonic()<deadline:
    run=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
    if run and run['status']==status:return run
    if run and status=='completed' and run['status']=='paused':raise AssertionError(run)
    panel.wait_for_timeout(100)
   diagnostic=worker.evaluate('''async()=>{const run=(await chrome.storage.local.get('pfRun')).pfRun;return (await chrome.scripting.executeScript({target:{tabId:run.tabId},func:()=>{const a=globalThis.PromptChainSiteAdapter,c=a?.getInputElement(),r=c?.closest('form');return{adapter:a?.id,input:!!c,send:!!a?.getSendButton(c),generating:a?.isGenerating(),form:r?.outerHTML}}}))[0].result}''')
   raise AssertionError({'run':run,'page':diagnostic})
  def start_run(button):
   previous=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun?.id')
   button.click();deadline=time.monotonic()+10
   while time.monotonic()<deadline:
    run=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
    if run and run['id']!=previous:return run
    panel.wait_for_timeout(100)
   raise AssertionError('No new run created: '+panel.locator('body').inner_text())
  for provider,start in [('Gemini','https://gemini.google.com/app?dest=create'),('DeepSeek','https://chat.deepseek.com/')]:
   if args.provider and args.provider!=provider:continue
   page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
   page.route('https://**/*',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML))
   page.goto(start);page.wait_for_timeout(900)
   panel.goto(base+'sidepanel.html');panel.get_by_role('button',name='刷新连接',exact=True).click()
   try:panel.locator('.platform-status[data-pc-ready="true"]').wait_for(timeout=10000)
   except Exception:
    details=worker.evaluate('''async url=>{const [tab]=await chrome.tabs.query({url});const result={};for(const type of ['COMPAT_CHECK','PF_STATUS'])try{result[type]=await chrome.tabs.sendMessage(tab.id,{type})}catch(error){result[type]=error.message}return result}''',start)
    raise AssertionError({'provider':provider,'errors':errors,'panel':panel.locator('body').inner_text(),'diagnostic':details})
   assert page.evaluate('sent.length')==0
   panel.get_by_role('button',name='新建提示词',exact=True).last.click()
   dialog=panel.get_by_role('dialog');dialog.get_by_label('名称',exact=True).fill(provider+'独立提示词');dialog.get_by_label('提示词',exact=True).fill('独立提示词作为第一条消息');dialog.get_by_role('button',name='保存',exact=True).click()
   send=panel.get_by_role('button',name='发送 '+provider+'独立提示词',exact=True);send.click();page.wait_for_function('sent.length===1');page.wait_for_timeout(1600);send.click();page.wait_for_function('sent.length===2');page.wait_for_timeout(1600)
   page.goto(start);page.wait_for_timeout(900);page.evaluate('holdAnswers=true');panel.get_by_role('button',name='刷新连接',exact=True).click()
   start_run(panel.get_by_role('button',name='运行流程 三站流程验收',exact=True));page.wait_for_function('sent.length===1');panel.locator('#pause').click();wait_run('paused')
   page.evaluate('holdAnswers=false;completeAnswer()');panel.locator('#resume').click();wait_run('completed')
   assert page.evaluate('sent.length')==4,worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
   assert page.evaluate('filesSeen.map(file=>file.name)')==['fixture.md','fixture.png']
   run=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun');assert run['targetUrl']==page.url and run['index']==4
   assert 'lastReply' not in run
   panel.goto(base+'sidepanel.html');panel.get_by_role('button',name='编辑流程 三站流程验收',exact=True).click();panel.locator('#run').wait_for()
   assert panel.locator('#target').input_value()
   start_run(panel.locator('#run'));wait_run('completed');assert page.evaluate('sent.length')==8,page.evaluate('sent')
   assert page.evaluate('filesSeen.map(file=>file.name)')==['fixture.md','fixture.png']*2
   panel.goto(base+'sidepanel.html');panel.get_by_role('button',name='编辑流程 三站流程验收',exact=True).click();page.evaluate('interrupt=true');start_run(panel.locator('#run'));page.wait_for_function('sent.length===9');wait_run('paused');page.wait_for_timeout(1800);assert page.evaluate('sent.length')==9
   panel.locator('#stop').click();wait_run('cancelled')
   assert not errors,errors
   results.append(f'{provider}: loaded extension UI; manual prompt first/middle; list and editor run through shared persistent monitor; pause/resume without resend; Markdown and PNG uploads; reply completion and next step; unrelated navigation pauses. Local fixture.')
   print(results[-1],flush=True);page.close()
  excluded=context.new_page();excluded.route('https://claude.ai/**',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML));excluded.goto('https://claude.ai/new')
  panel.goto(base+'workflow.html?flow='+flow_id);panel.locator('#run').wait_for();assert panel.locator('#target option').count()==1
  panel.locator('#run').click();panel.get_by_text('先选择目标对话',exact=True).wait_for();assert excluded.evaluate('sent.length')==0
  results.append('Claude excluded from target picker and execution; no message sent')
  context.close()
(OUT/'provider-new-chat-report.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
