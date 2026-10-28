from pathlib import Path
import json,time,base64,io
from PIL import Image,ImageDraw,ImageFont
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
PROFILE=OUT/'live-edge-profile'
EDGE=next(path for path in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if path.exists())
if (OUT/'live-upload-block.json').exists():
 print('skipped_known_login_gate: 不再次尝试真实上传或打开登录窗口',flush=True);raise SystemExit(0)

token='PC'+str(int(time.time()))
picture=Image.new('RGB',(900,300),'white');draw=ImageDraw.Draw(picture);font=ImageFont.truetype('arial.ttf',40)
draw.text((40,50),'PROMPT CHAIN SIDEBAR',font=font,fill='black');draw.text((40,150),token+'_IMAGE',font=font,fill='black')
buffer=io.BytesIO();picture.save(buffer,format='PNG');picture.save(OUT/'prompt-chain-sidebar-test.png')
ref={'id':'sidebar-test-image','name':'prompt-chain-sidebar-test.png','size':len(buffer.getvalue()),'mimeType':'image/png'}
title='侧边栏真实测试 '+token
bundle={'format':'prompt-flow','version':1,'flows':[{'id':'sidebar-test-flow','title':title,'steps':[{'text':'这是扩展侧边栏测试，请只回复：'+token+'_FIRST'},{'text':'请读取本条消息携带的图片，只回复图片里以 PC 开头的完整测试标记。','attachment':ref},{'text':'这是最后一步，请只回复：'+token+'_DONE'}]}],'files':[{**ref,'dataBase64':base64.b64encode(buffer.getvalue()).decode()}]}
source=OUT/'Prompt-Chain-sidebar-test.promptflow.json';source.write_text(json.dumps(bundle,ensure_ascii=False),encoding='utf-8')
report={'entryPoint':'native Edge side panel UI; test script does not issue PF_START or PC_RUN_NATIVE','environment':'live ChatGPT, no request mocks','title':title,'sourcePath':str(source),'status':'starting'}
def record(status,**extra):
 report.update(status=status,**extra);(OUT/'live-sidebar-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(status,flush=True)

with sync_playwright() as p:
 context=p.chromium.launch_persistent_context(str(PROFILE),executable_path=str(EDGE),headless=False,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'],viewport={'width':1200,'height':850})
 try:
  worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker',timeout=20000)
  with context.expect_event('serviceworker',timeout=20000) as fresh:
   try:worker.evaluate('chrome.runtime.reload()')
   except Exception as error:
    if 'closed' not in str(error).lower():raise
  worker=fresh.value
  base='/'.join(worker.url.split('/')[:3])+'/'
  controller=context.new_page();controller.goto(base+'workflow.html?new=1');controller.locator('#source-chat').wait_for()
  previous=controller.evaluate('async()=>((await chrome.storage.local.get("pfRun")).pfRun)')
  if previous and previous.get('status') in ['running','paused'] and previous['flow']['title'].startswith('Prompt Chain 真实网页测试 '):controller.evaluate('async()=>chrome.runtime.sendMessage({type:"PF_STOP"})')
  target=context.new_page();target.goto('https://chatgpt.com/',wait_until='domcontentloaded',timeout=60000)
  record('ready_for_sidebar',version=worker.evaluate('chrome.runtime.getManifest().version'))
  run=None;last=-1;deadline=time.monotonic()+600
  while time.monotonic()<deadline:
   current=worker.evaluate('async()=>((await chrome.storage.local.get("pfRun")).pfRun)')
   if current and current['flow']['title']==title:
    run=current
    if run['index']!=last:last=run['index'];record('running_from_sidebar',step=min(last+1,3),logs=run['logs'])
    if run['status'] in ['completed','paused','cancelled']:break
   time.sleep(1)
  if not run:record('not_started_from_sidebar')
  else:
   tab=worker.evaluate('async id=>chrome.tabs.get(id)',run['tabId'])
   proof=worker.evaluate('''async id=>{const results=await chrome.scripting.executeScript({target:{tabId:id},func:()=>({snapshot:PromptFlowSupervisor.snapshot(),roots:PromptChainMessages.read().messages.map(message=>({role:message.role,text:message.text,imageCount:message.root.querySelectorAll('img').length,images:[...message.root.querySelectorAll('img')].map(image=>({alt:image.alt,width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height}))}))})});return results[0]?.result}''',run['tabId'])
   replies=[message['text'] for message in proof['roots'] if message['role']=='assistant']
   complete=run['status']=='completed' and any(token+'_IMAGE' in answer for answer in replies) and any(token+'_DONE' in answer for answer in replies)
   record('passed' if complete else 'failed',runStatus=run['status'],step=min(run['index']+1,3),logs=run['logs'],proof=proof,url=tab['url'])
  time.sleep(90)
 finally:context.close()
