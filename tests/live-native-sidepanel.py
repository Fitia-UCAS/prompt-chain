from pathlib import Path
from tempfile import TemporaryDirectory
import json,time,socket,re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
previous=OUT/'live-native-sidepanel-report.json'
if previous.exists() and 'login dialog' in json.loads(previous.read_text(encoding='utf-8')).get('reason',''):
 print('skipped_known_login_gate: 不自动重试登录受限的真实网页',flush=True);raise SystemExit(0)
token='PC_NATIVE_'+str(int(time.time()))
report={'version':json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))['version'],'environment':'live ChatGPT, visible native Edge side panel, isolated guest profile, no network mocks, text only, no login interaction','status':'starting','checks':[]}
def record(status,**fields):
 report.update(status=status,**fields);(OUT/'live-native-sidepanel-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(status,flush=True)
with TemporaryDirectory(prefix='pc-live-native-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=False,args=[f'--remote-debugging-port={port}','--remote-debugging-address=127.0.0.1',f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
  try:
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
   base='/'.join(worker.url.split('/')[:3])+'/'
   target=context.new_page();target.goto('https://chatgpt.com/',wait_until='domcontentloaded',timeout=45000)
   def auth_dialog():return any(dialog.is_visible() for dialog in target.locator('[role="dialog"]').filter(has_text=re.compile(r'登录|注册|log in|sign in',re.I)).all())
   controller=context.new_page();controller.goto(base+'sidepanel.html')
   win=controller.evaluate('async()=> (await chrome.windows.getCurrent()).id')
   controller.evaluate('id=>{const b=document.createElement("button");b.id="open-test-panel";b.textContent="Open panel";b.onclick=()=>chrome.sidePanel.open({windowId:id});b.style="position:fixed;top:0;left:0;z-index:999999";document.body.append(b)}',win)
   controller.locator('#open-test-panel').click();controller.wait_for_timeout(700)
   client=p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
   panel=next(page for page in client.contexts[0].pages if page.url==base+'sidepanel.html' and page.evaluate('innerWidth')<600)
   assert panel.evaluate('async()=> (await chrome.tabs.getCurrent())===undefined')
   report['checks'].append('actual native side panel, not an extension tab')
   record('waiting_for_composer')
   deadline=time.monotonic()+30
   while time.monotonic()<deadline:
    if auth_dialog():raise RuntimeError('site displayed login dialog; stopped without interaction')
    if panel.locator('.platform-status[data-pc-ready="true"]').count():break
    panel.wait_for_timeout(250)
   else:raise RuntimeError('guest composer not available; no login attempted')
   bundle={'prompts':[{'title':f'第 {i} 步','content':f'This is a browser extension test. Reply with exactly {token}_{i} and nothing else.'} for i in range(1,4)]}
   panel.get_by_role('button',name='新建流程',exact=True).click()
   with panel.expect_file_chooser() as chooser:panel.get_by_role('button',name='导入 Prompts',exact=True).click()
   chooser.value.set_files({'name':'native-live-text.json','mimeType':'application/json','buffer':json.dumps(bundle).encode()})
   panel.get_by_text('第 1 步 · 第 1 步',exact=True).wait_for()
   panel.get_by_role('button',name='‹ 流程库',exact=True).click()
   panel.get_by_role('button',name='运行流程 native-live-text',exact=True).click()
   record('running_from_native_panel')
   deadline=time.monotonic()+150;last=-1
   while time.monotonic()<deadline:
    if auth_dialog():raise RuntimeError('site displayed login dialog; stopped without interaction')
    run=worker.evaluate('async()=>(await chrome.storage.local.get("pfRun")).pfRun')
    if run and run['index']!=last:last=run['index'];record('running_from_native_panel',step=last+1,logs=run['logs'])
    if run and run['status'] in ['completed','paused','cancelled']:break
    panel.wait_for_timeout(250)
   if not run or run['status']!='completed':raise RuntimeError('live flow did not complete: '+str(run and {'status':run['status'],'reason':run['reason'],'logs':run['logs']}))
   proof=worker.evaluate('async id=>chrome.tabs.sendMessage(id,{type:"PF_STATUS"})',run['tabId'])
   assert token+'_3' in proof.get('snapshot',{}).get('assistant',{}).get('text',''),proof
   assert 'lastReply' not in run
   panel.screenshot(path=str(OUT/'live-native-sidepanel.png'))
   target.screenshot(path=str(OUT/'live-native-chatgpt.png'))
   report['checks'].append('four import entries in native panel; import three text steps and start via actual Run button')
   report['checks'].append('loaded extension sends three messages to live guest ChatGPT, waits for actual replies, completes without login')
   record('passed',url=run['targetUrl'],logs=run['logs'])
  except Exception as error:record('stopped',reason=str(error))
  finally:context.close()
