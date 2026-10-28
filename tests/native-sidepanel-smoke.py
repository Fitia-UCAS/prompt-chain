from pathlib import Path
from tempfile import TemporaryDirectory
import ast,json,time,socket
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
tree=ast.parse((ROOT/'tests/browser-smoke.py').read_text(encoding='utf-8'))
HTML=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='HTML' for t in n.targets))
HTML=HTML.replace("document.querySelector('main').append(answer);","window.releaseAnswer=()=>document.querySelector('main').append(answer);")
ref={'id':'panel-file','name':'侧栏附件.md','size':3,'mimeType':'text/markdown'}
bundle={'format':'prompt-flow','version':1,'flows':[{'id':'panel-flow','title':'原生侧栏验收','steps':[{'text':'第一步','attachment':ref},{'text':'第二步'}]}],'files':[{**ref,'dataBase64':'YWJj'}]}
sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
checks=[]
with TemporaryDirectory(prefix='pc-native-panel-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=False,args=[f'--remote-debugging-port={port}','--remote-debugging-address=127.0.0.1',f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
  try:
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
   base='/'.join(worker.url.split('/')[:3])+'/'
   target=context.new_page();target.route('https://chatgpt.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML));target.goto('https://chatgpt.com/c/native-panel-fixture')
   controller=context.new_page();controller.goto(base+'sidepanel.html')
   win=controller.evaluate('async()=> (await chrome.windows.getCurrent()).id')
   controller.evaluate('id=>{const b=document.createElement("button");b.id="open-test-panel";b.textContent="Open panel";b.onclick=()=>chrome.sidePanel.open({windowId:id});b.style="position:fixed;top:0;left:0;z-index:999999";document.body.append(b)}',win)
   controller.locator('#open-test-panel').click();controller.wait_for_timeout(700)
   client=p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
   panel=next(page for page in client.contexts[0].pages if page.url==base+'sidepanel.html' and page.evaluate('innerWidth')<600)
   assert panel.evaluate('async()=> (await chrome.tabs.getCurrent())===undefined')
   proof=context.new_cdp_session(controller).send('Target.getTargets')
   panel_id=client.contexts[0].new_cdp_session(panel).send('Target.getTargetInfo')['targetInfo']['targetId']
   assert any(t['targetId']==panel_id for t in proof['targetInfos'])
   errors=[];panel.on('pageerror',lambda error:errors.append(str(error)))
   panel.get_by_role('button',name='新建流程',exact=True).click()
   with panel.expect_file_chooser() as chooser:panel.get_by_role('button',name='导入 Prompts',exact=True).click()
   chooser.value.set_files({'name':'panel.json','mimeType':'application/json','buffer':json.dumps(bundle,ensure_ascii=False).encode()})
   panel.get_by_text('第 1 步 · 第一步',exact=True).wait_for()
   assert panel.locator('[data-field="text"]').first.input_value()=='第一步'
   assert panel.get_by_text('自动续作',exact=True).count()==0
   panel.get_by_role('button',name='‹ 流程库',exact=True).click()
   checks.append('Native Edge side panel, not a tab: create, import actual attachment bytes, unified editor and library')
   def run_state():return worker.evaluate('async()=>(await chrome.storage.local.get("pfRun")).pfRun')
   def wait_state(status):
    deadline=time.monotonic()+20
    while time.monotonic()<deadline:
     run=run_state()
     if run and run['status']==status:return run
     panel.wait_for_timeout(100)
    raise AssertionError(run)
   panel.get_by_role('button',name='运行流程 原生侧栏验收',exact=True).click()
   target.wait_for_function('sendCount===1')
   panel.get_by_role('button',name='暂停',exact=True).click();wait_state('paused')
   panel.get_by_role('button',name='‹ 流程库',exact=True).click()
   assert panel.locator('#pc-run').count()==0
   panel.get_by_role('button',name='恢复流程 原生侧栏验收',exact=True).click();wait_state('running')
   target.evaluate('releaseAnswer()');target.wait_for_function('sendCount===2',timeout=25000)
   target.evaluate('releaseAnswer()');wait_state('completed')
   assert target.evaluate('filesSeen')==[{'name':ref['name'],'size':3}]
   checks.append('Native panel Run and Pause, return to library and Resume from row, finish next step without repeating the first file')
   completed=run_state()
   assert panel.locator('#resume').is_visible() and panel.locator('#stop').is_visible() and panel.locator('#stop').is_disabled()
   panel.locator('#resume').click();target.wait_for_function('sendCount===3')
   assert run_state()['id']!=completed['id'] and run_state()['index']==0
   checks.append('Completed monitor retains Run and disabled Stop; Run starts a new execution from step one')
   panel.get_by_role('button',name='暂停',exact=True).click();wait_state('paused')
   panel.get_by_role('button',name='‹ 流程库',exact=True).click()
   panel.get_by_role('button',name='停止流程 原生侧栏验收',exact=True).click();wait_state('cancelled')
   panel.wait_for_timeout(2000);assert target.evaluate('sendCount')==3
   checks.append('Paused row Stop cancels execution and does not send another step')
   stop_path=panel.get_by_role('button',name='停止流程 原生侧栏验收',exact=True).locator('svg path').get_attribute('d')
   assert stop_path==panel.evaluate('PromptChainIcons.stop')
   panel.goto(base+'workflow.html?monitor=1')
   assert panel.locator('#resume').is_visible() and panel.locator('#stop').is_visible() and panel.locator('#stop').is_disabled()
   panel.locator('#resume').click();target.wait_for_function('sendCount===4')
   checks.append('Stopped monitor retains Run and disabled Stop; library Stop always uses the square icon')
   panel.get_by_role('button',name='暂停',exact=True).click();wait_state('paused')
   panel.get_by_role('button',name='‹ 流程库',exact=True).click()
   panel.get_by_role('button',name='删除流程 原生侧栏验收',exact=True).click();panel.get_by_role('alertdialog').get_by_role('button',name='删除',exact=True).click()
   wait_state('cancelled');panel.get_by_text('还没有流程',exact=True).wait_for()
   sizes=panel.locator('.popup-header .platform-status,#pc-refresh,.popup-header button[aria-label="设置"]').evaluate_all('(els)=>els.map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return[r.width,r.height,s.borderWidth,s.borderRadius]})')
   assert len(sizes)==3 and len(set(map(tuple,sizes)))==1,sizes
   assert sizes[0][:2]==[32,32],sizes
   assert panel.evaluate('document.documentElement.scrollWidth<=innerWidth')
   panel.screenshot(path=str(OUT/'native-sidepanel-verified.png'))
   checks.append('Delete paused flow stops it; connection light, refresh and settings have equal boxes; native panel has no horizontal overflow')
   assert not errors,errors
   report={'version':worker.evaluate('chrome.runtime.getManifest().version'),'environment':'visible isolated Edge native side panel, local ChatGPT fixture, no login and no live-site claim','panelTargetId':panel_id,'panelWidth':panel.evaluate('innerWidth'),'checks':checks}
   (OUT/'native-sidepanel-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))
  finally:context.close()
