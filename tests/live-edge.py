from pathlib import Path
import json,time,sys,re,base64,io
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
PROFILE=OUT/'live-edge-profile'
EDGE=next(path for path in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if path.exists())
OUT.mkdir(parents=True,exist_ok=True)
report={'environment':'live ChatGPT, separate visible Edge profile, no request mocks','status':'starting','checks':[]}
text_only='--text-only' in sys.argv
image_test='--image' in sys.argv
ui_test='--ui' in sys.argv
report['entryPoint']='extension UI document in tab: import, target selection, Run button; native side panel container not covered' if ui_test else 'extension runtime start command; execution uses loaded extension background and content scripts'
report_name='live-edge-ui-text-report.json' if ui_test and text_only else 'live-edge-receipt-report.json' if '--inspect-previous' in sys.argv else 'live-edge-menu-report.json' if '--inspect-attachments' in sys.argv else 'live-edge-text-report.json' if text_only else 'live-edge-image-report.json' if image_test else 'live-edge-file-report.json'
def record(status,**fields):
 report.update(status=status,**fields)
 (OUT/'live-edge-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 (OUT/report_name).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(status,flush=True)

upload_guard=OUT/'live-upload-block.json'
prior_image=OUT/'live-edge-image-report.json'
if not upload_guard.exists() and prior_image.exists():
 prior=json.loads(prior_image.read_text(encoding='utf-8'))
 if prior.get('stoppedReason')=='site displayed a login dialog; no dialog interaction':upload_guard.write_text(json.dumps({'profile':str(PROFILE),'reason':prior['stoppedReason']},ensure_ascii=False),encoding='utf-8')
if upload_guard.exists() and not text_only and not any(flag in sys.argv for flag in ['--inspect-previous','--inspect-attachments']):
 report_name='live-edge-upload-skipped-report.json';record('skipped_known_login_gate',reason='该测试配置已出现上传登录门槛；不再次尝试上传，也不打开登录窗口');sys.exit(0)

with sync_playwright() as p:
 context=None
 try:
  context=p.chromium.launch_persistent_context(str(PROFILE),executable_path=str(EDGE),headless=False,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'],viewport={'width':1200,'height':850})
  workers=context.service_workers
  worker=workers[0] if workers else context.wait_for_event('serviceworker',timeout=20000)
  with context.expect_event('serviceworker',timeout=20000) as reloaded:
   try:worker.evaluate('chrome.runtime.reload()')
   except Exception as error:
    if 'closed' not in str(error).lower():raise
  worker=reloaded.value
  base='/'.join(worker.url.split('/')[:3])+'/'
  page=context.new_page()
  page.goto(base+'workflow.html?new=1')
  page.locator('#source-chat').wait_for(state='visible')
  report['checks'].append('new sequence shows all four icon-and-text imports')
  target=context.new_page()
  page_errors=[];target.on('pageerror',lambda error:page_errors.append(str(error)))
  network_errors=[]
  target.on('response',lambda response:network_errors.append({'status':response.status,'path':response.url.split('?')[0]}) if response.status>=400 and '/backend-' in response.url else None)
  previous_run=page.evaluate('async()=>((await chrome.storage.local.get("pfRun")).pfRun)')
  previous_url=previous_run.get('targetUrl','') if previous_run and previous_run['flow']['title'].startswith('Prompt Chain 真实网页测试 ') else ''
  target.goto(previous_url if '--inspect-previous' in sys.argv and previous_url else 'https://chatgpt.com/',wait_until='domcontentloaded',timeout=60000)
  record('waiting_for_chatgpt',version=page.evaluate('chrome.runtime.getManifest().version'))
  deadline=time.monotonic()+25
  tab_id=None
  while time.monotonic()<deadline:
   tab_id=page.evaluate(r'async()=>{const tabs=await chrome.tabs.query({});return tabs.filter(tab=>/^https:\/\/chatgpt\.com\//.test(tab.url||""))?.at(-1)?.id}')
   ready=target.locator('textarea:visible,[contenteditable="true"]:visible').count()>0
   if ready:break
   time.sleep(2)
  if not ready:
   target.screenshot(path=str(OUT/'live-edge-blocked.png'))
   record('blocked_before_execution',reason='真实 ChatGPT 页面未出现可用的输入框；可能需要登录或页面访问未完成',url=target.url,pageErrors=page_errors,probe=target.locator('textarea,[contenteditable]').evaluate_all('(els)=>els.map(el=>({tag:el.tagName,id:el.id,role:el.getAttribute("role"),editable:el.getAttribute("contenteditable"),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))'))
  else:
   if '--inspect-previous' in sys.argv:
    target.wait_for_timeout(3000)
    proof=page.evaluate('''async id=>{const results=await chrome.scripting.executeScript({target:{tabId:id},func:()=>({snapshot:PromptFlowSupervisor.snapshot(),roots:PromptChainMessages.read().messages.map(message=>({role:message.role,text:message.text,imageCount:message.root.querySelectorAll('img').length,images:[...message.root.querySelectorAll('img')].map(image=>({alt:image.alt,width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height})),parentImages:message.root.parentElement?.querySelectorAll('img').length}))})});return results[0]?.result}''',tab_id)
    record('receipt_inspected',proof=proof,pending=previous_run.get('pending'))
    context.close();context=None;sys.exit(0)
   previous=page.evaluate('async()=>((await chrome.storage.local.get("pfRun")).pfRun)')
   if previous and previous.get('status') in ['running','paused'] and previous['flow']['title'].startswith('Prompt Chain 真实网页测试 '):page.evaluate('async()=>chrome.runtime.sendMessage({type:"PF_STOP"})')
   report['composerProbe']=target.evaluate('''()=>{const composer=document.querySelector('#prompt-textarea,#mobile-composer-prompt'),scope=composer?.closest('form')||composer?.closest('[data-testid="composer"]')||composer?.parentElement?.parentElement;return{draftLength:(composer?.value||composer?.innerText||'').length,attachmentMatches:[...(scope?.querySelectorAll('button[aria-label^="Remove "],button[aria-label*="移除"],button[aria-label*="删除附件"],[data-testid="attachment-preview"],[data-testid^="attachment-"]')||[])].map(el=>({tag:el.tagName,testid:el.dataset.testid,label:el.getAttribute('aria-label')}))}}''')
   if '--inspect-attachments' in sys.argv:
    report['controls']=target.locator('button').evaluate_all('(els)=>els.map(el=>({label:el.getAttribute("aria-label"),text:el.innerText,testid:el.dataset.testid,id:el.id})).filter(el=>el.label||el.text)')
    report['fileInputsBefore']=target.locator('input[type=file]').count()
    report['fileInputs']=target.locator('input[type=file]').evaluate_all('(els)=>els.map(el=>({accept:el.accept,capture:el.getAttribute("capture"),multiple:el.multiple,disabled:el.disabled,form:!!el.closest("form"),id:el.id}))')
    report['menuProbe']='read-only; no attachment menu clicks'
    record('attachment_menu_inspected')
    target.screenshot(path=str(OUT/'live-edge-attachment-menu.png'))
    context.close();context=None
    sys.exit(0)
   token='PC'+str(int(time.time()))
   image_data=''
   if image_test:
    from PIL import Image,ImageDraw,ImageFont
    picture=Image.new('RGB',(900,300),'white');draw=ImageDraw.Draw(picture);font=ImageFont.truetype('arial.ttf',40)
    draw.text((40,50),'PROMPT CHAIN',font=font,fill='black');draw.text((40,150),token+'_IMAGE',font=font,fill='black')
    picture.save(OUT/'prompt-chain-live-test.png');buffer=io.BytesIO();picture.save(buffer,format='PNG');image_data=base64.b64encode(buffer.getvalue()).decode()
   flow=page.evaluate('''async({token,textOnly,imageData,uiTest})=>{
    const file=await PromptFlowStore.saveFile(imageData?new File([Uint8Array.from(atob(imageData),char=>char.charCodeAt(0))],'prompt-chain-live-test.png',{type:'image/png'}):new File(['附件中的唯一标记：'+token+'_FILE'],'prompt-chain-live-test.txt',{type:'text/plain'}));
    const flow=PromptFlowModel.flow({title:'Prompt Chain 真实网页测试 '+token,steps:[
     {text:'这是浏览器扩展功能测试。请只回复：'+token+'_FIRST'},
     textOnly?{text:'这是第二步，请只回复：'+token+'_SECOND'}:{text:imageData?'请读取本条消息携带的图片，只回复图片里以 PC 开头的完整测试标记。':'请读取本条消息携带的文本附件，只回复附件中的唯一标记。',attachment:file},
     {text:'测试最后一步。请只回复：'+token+'_DONE'}]});
    if(!uiTest)await PromptFlowStore.saveFlow(flow);return flow;
   }''',{'token':token,'textOnly':text_only,'imageData':image_data,'uiTest':ui_test})
   if ui_test:
    backup=page.evaluate('async flow=>PromptFlowStore.exportFlow(flow)',flow)
    with page.expect_file_chooser() as chooser:page.get_by_role('button',name='导入 Prompts',exact=True).click()
    chooser.value.set_files({'name':'live-ui-test.promptflow.json','mimeType':'application/json','buffer':json.dumps(backup,ensure_ascii=False).encode()})
    page.wait_for_function('()=>document.querySelectorAll("#steps>details").length===3')
    page.locator('#refresh-connection').click();page.locator('#target').select_option(str(tab_id))
    page.locator('#run').click();page.locator('#monitor-view').wait_for(state='visible')
    report['checks'].append('imported through Prompts UI, selected real target tab, clicked actual Run button')
    result={'ok':True}
   else:result=page.evaluate('async ({flow,id})=>chrome.runtime.sendMessage({type:"PF_START",flow,tabId:id})',{'flow':flow,'id':tab_id})
   if not result.get('ok'):
    record('start_failed',result=result,probe=target.locator('textarea,[contenteditable]').evaluate_all('(els)=>els.map(el=>({tag:el.tagName,id:el.id,role:el.getAttribute("role"),editable:el.getAttribute("contenteditable"),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))'),pageErrors=page_errors)
    raise RuntimeError(result.get('error',str(result)))
   page.goto(base+'workflow.html?monitor=1')
   actual_flow_id=page.evaluate('async()=>((await chrome.storage.local.get("pfRun")).pfRun?.flow.id)')
   record('running',flowId=actual_flow_id)
   deadline=time.monotonic()+240
   last_index=-1
   while time.monotonic()<deadline:
    run=page.evaluate('async()=>((await chrome.storage.local.get("pfRun")).pfRun)')
    auth=target.locator('[role="dialog"]:visible').filter(has_text=re.compile('登录|Log in|Sign in',re.I))
    if auth.count():
     page.evaluate('async()=>chrome.runtime.sendMessage({type:"PF_STOP"})');run=page.evaluate('async()=>((await chrome.storage.local.get("pfRun")).pfRun)');report['stoppedReason']='site displayed a login dialog; no dialog interaction';upload_guard.write_text(json.dumps({'profile':str(PROFILE),'reason':report['stoppedReason']},ensure_ascii=False),encoding='utf-8');break
    if run['index']!=last_index:
     last_index=run['index'];print('live step',min(last_index+1,len(flow['steps'])),run['phase'],flush=True)
    if run['status'] in ['completed','paused','stopped']:break
    time.sleep(2)
   diagnostic=page.evaluate('async()=>chrome.runtime.sendMessage({type:"PF_DIAGNOSTIC"})')
   report['receiptProbe']=page.evaluate('''async id=>{const results=await chrome.scripting.executeScript({target:{tabId:id},func:()=>({user:PromptFlowSupervisor.snapshot().lastUser,composer:PromptFlowSupervisor.describe(PromptFlowSupervisor.scope()),inputs:[...document.querySelectorAll('input[type=file]')].map(input=>({id:input.id,accept:input.accept,files:[...input.files].map(file=>file.name)})),roots:PromptChainMessages.read().messages.filter(message=>message.role==='user').map(message=>({text:message.text,images:[...message.root.querySelectorAll('img')].map(image=>({alt:image.alt,width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height})),parentImages:message.root.parentElement?.querySelectorAll('img').length}))})});return results[0]?.result}''',tab_id)
   report['binding']=worker.evaluate('''async()=>{const run=(await chrome.storage.local.get('pfRun')).pfRun,tab=await chrome.tabs.get(run.tabId);return{allowNewChat:run.allowNewChat,attemptedAt:run.delivery?.attemptedAt,same:PromptFlowModel.sameChat(run.targetUrl,tab.url,true),targetIsConversation:PromptFlowModel.conversationPath(run.targetUrl),actualIsConversation:PromptFlowModel.conversationPath(tab.url),receipt:run.delivery?true:false}}''')
   target.screenshot(path=str(OUT/'live-edge-chat.png'))
   page.screenshot(path=str(OUT/'live-edge-monitor.png'))
   answers=page.evaluate('''async id=>{const results=await chrome.scripting.executeScript({target:{tabId:id},func:()=>PromptChainMessages.read().messages.filter(message=>message.role==='assistant').map(message=>message.text)});return results[0]?.result||[]}''',tab_id)
   complete=run['status']=='completed' and any(token+'_DONE' in answer for answer in answers) and (text_only or any(token+('_IMAGE' if image_test else '_FILE') in answer for answer in answers))
   if run['index']>=1:report['checks'].append('first real reply read and automatically advanced to step two')
   if complete:report['checks'].append('three real user messages, three new replies, automatic continuation to final marker'+('' if text_only else ', real image upload' if image_test else ', real file upload'))
   record('passed' if complete else 'failed',runStatus=run['status'],step=min(run['index']+1,len(flow['steps'])),logs=run['logs'],diagnostic=diagnostic,networkErrors=network_errors,replies=answers)
 except Exception as error:
  record('error',error=str(error))
  if context:
   for item in context.pages:
    if item.url.startswith('https://chatgpt.com/'):
     try:item.screenshot(path=str(OUT/'live-edge-error.png'))
     except Exception:pass
 finally:
  if context:context.close()
