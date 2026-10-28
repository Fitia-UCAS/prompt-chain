from pathlib import Path
from tempfile import TemporaryDirectory
import ast,json,time
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
OUT.mkdir(parents=True,exist_ok=True)
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
tree=ast.parse((ROOT/'tests'/'browser-smoke.py').read_text(encoding='utf-8'))
HTML=next(ast.literal_eval(node.value) for node in tree.body if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='HTML' for t in node.targets))
ref={'id':'fixture-file','name':'设定.md','size':3,'mimeType':'text/markdown'}
raw='**---**\n**name:&#x20;**_example_\n\n请阅读附件。下一句不应成为标题。'
bundle={'format':'prompt-flow','version':1,'flows':[{'id':'fixture-flow','title':'原版流程测试','delaySeconds':0,'steps':[{'text':raw,'attachment':ref},{'text':'','attachment':ref}]}],'files':[{**ref,'dataBase64':'YWJj'}]}
results=[]

def passed(message):
 results.append(message)
 print(message,flush=True)

with TemporaryDirectory(prefix='pc-extension-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'],viewport={'width':460,'height':850})
  workers=context.service_workers
  worker=workers[0] if workers else context.wait_for_event('serviceworker',timeout=15000)
  base='/'.join(worker.url.split('/')[:3])+'/'
  page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  def wait_value(script,arg=None,timeout=15000):
   deadline=time.monotonic()+timeout/1000
   while time.monotonic()<deadline:
    if page.evaluate(script,arg):return
    page.wait_for_timeout(80)
   raise AssertionError('state did not settle: '+script)
  def main():
   page.goto(base+'sidepanel.html')
   page.get_by_role('button',name='设置',exact=True).wait_for()
   page.wait_for_function('()=>!document.querySelector(".loading-orbit")')
  def settings():
   page.get_by_role('button',name='设置',exact=True).click()
   page.get_by_text('导出提示词库',exact=True).wait_for()
  def import_json(data,name='fixture.json'):
   main();page.get_by_role('button',name='新建流程',exact=True).click()
   page.get_by_role('button',name='导入 Prompts',exact=True).wait_for()
   with page.expect_file_chooser() as chooser:
    page.get_by_role('button',name='导入 Prompts',exact=True).click()
   chooser.value.set_files({'name':name,'mimeType':'application/json','buffer':json.dumps(data,ensure_ascii=False).encode()})
  worker.evaluate('async()=>chrome.storage.local.set({langqueue_settings:{multimodalEnabled:false,insertionMode:"overwrite",exportIncludeBinaries:false,tweaks:{preventAutoScrollOnSubmit:true},shortcuts:{custom:"test"}}})')
  main();settings()
  stored=page.evaluate('async()=>((await chrome.storage.local.get("langqueue_settings")).langqueue_settings)')
  assert stored=={'shortcuts':{'custom':'test'}},stored
  assert page.get_by_role('radio').count()==0
  assert page.get_by_role('switch').count()==0
  assert page.get_by_role('button',name='保存',exact=True).count()==0
  passed('settings simplified: legacy options removed, unrelated preferences preserved, no Save button')
  import_json(bundle)
  wait_value('async()=>((await chrome.storage.local.get("langqueue_chains")).langqueue_chains?.items[0]?.steps.length===2)',timeout=15000)
  backup=page.evaluate('async()=>{const store=await import(chrome.runtime.getURL("assets/storage.js"));return store.e({includeBinaries:false})}')
  assert len(backup['attachments'])==1 and backup['attachments'][0]['dataBase64']=='YWJj',backup
  passed('backup: original attachment bytes always included, including when a legacy false flag is supplied')
  main();page.get_by_text('原版流程测试',exact=True).wait_for()
  chain_id=page.locator('.chain-card').get_attribute('data-chain-id')
  page.wait_for_function('()=>document.querySelectorAll(".chain-card button svg").length===4')
  page.wait_for_function('()=>!document.querySelector("[title]")')
  assert page.locator('.chain-card').inner_text().splitlines()==['01','原版流程测试','2 步']
  passed('real extension: module worker, Chinese native UI, icon actions, own-format import without lock deadlock')
  page.get_by_role('button',name='编辑流程 原版流程测试',exact=True).click()
  page.get_by_text('第 1 步 · 请阅读附件。',exact=True).wait_for()
  page.get_by_text('第 2 步 · 设定.md',exact=True).wait_for()
  assert page.locator('[data-pc-advanced]').count()==0
  assert page.locator('.repeat-settings').count()==0
  assert page.get_by_text('自动续作',exact=True).count()==0
  page.get_by_role('button',name='保存流程',exact=True).click()
  assert page.evaluate('async()=>((await chrome.storage.local.get("langqueue_chains")).langqueue_chains.items[0].steps[0].content)')==raw
  passed('unified chain editor: readable titles, unchanged prompt text, attachment-only steps can save')
  page.evaluate('async()=>{const v=(await chrome.storage.local.get("langqueue_chains")).langqueue_chains;v.items[0].steps=[];await chrome.storage.local.set({langqueue_chains:v})}')
  main();wait_value('async()=>((await chrome.storage.local.get("langqueue_chains")).langqueue_chains.items[0]?.steps.length===2)')
  passed('migration: repairs an empty native copy from the saved two-step original')
  target=context.new_page();target.on('pageerror',lambda e:errors.append(str(e)))
  target.route('https://chatgpt.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML))
  target.goto('https://chatgpt.com/c/native-fixture')
  wait_value('async()=>{try{const [t]=await chrome.tabs.query({url:"https://chatgpt.com/c/native-fixture"});return(await chrome.tabs.sendMessage(t.id,{type:"COMPAT_CHECK",payload:{}}))?.result?.ready}catch{return false}}')
  tab_id=page.evaluate('async()=>{const [t]=await chrome.tabs.query({url:"https://chatgpt.com/c/native-fixture"});return t.id}')
  def tab_message(kind,payload={}):
   return page.evaluate('async({id,kind,payload})=>chrome.tabs.sendMessage(id,{type:kind,payload})',{'id':tab_id,'kind':kind,'payload':payload})
  refs=page.evaluate('async()=>((await chrome.storage.local.get("langqueue_chains")).langqueue_chains.items[0].steps[0].attachments)')
  target.locator('#prompt-textarea').fill('已有草稿')
  inserted=tab_message('INJECT_PROMPT',{'content':'追加提示词','attachments':refs,'expectedHref':target.url})
  assert inserted['result']['ok'],inserted
  draft=target.locator('#prompt-textarea').inner_text()
  assert ' '.join(draft.split())=='已有草稿 追加提示词',repr(draft)
  assert target.evaluate('sendCount')==0
  assert target.evaluate('filesSeen')==[{'name':'设定.md','size':3}]
  assert target.evaluate('!document.querySelector("#promptchain-tweaks-style")&&!document.documentElement.classList.contains("promptchain-no-autoscroll")')
  target.evaluate('()=>{document.querySelectorAll(".attached").forEach(el=>el.remove());document.querySelector("#prompt-textarea").textContent="";filesSeen=[]}')
  passed('manual prompt: append to the existing draft, attach the real file, do not send or change scrolling')
  assert tab_message('PC_ACQUIRE')['result']['acquired']
  assert tab_message('PC_ACQUIRE')['result']['acquired']
  blocked=tab_message('INJECT_PROMPT',{'content':'不得插入','attachments':[],'expectedHref':target.url})
  assert not blocked['result']['ok'],blocked
  assert target.locator('#prompt-textarea').inner_text()==''
  tab_message('PC_RELEASE')
  passed('content lock: repeated supervisor acquisition works and blocks native manual insertion')
  page.get_by_role('button',name='运行流程 原版流程测试',exact=True).click()
  page.wait_for_timeout(600)
  if 'workflow.html' not in page.url:
   print('START FAILED',page.locator('body').inner_text(),flush=True)
   print('STATE',page.evaluate('async()=>chrome.storage.local.get(["pfRun","pfLibrary"])'),flush=True)
   raise AssertionError('native Run did not open the monitor')
  page.wait_for_url('**/workflow.html?monitor=1')
  target.wait_for_function('sendCount===2',timeout=45000)
  wait_value('async()=>((await chrome.storage.local.get("pfRun")).pfRun.status==="completed")',timeout=15000)
  assert target.evaluate('filesSeen')==[{'name':'设定.md','size':3}]*2
  assert target.locator('[data-message-author-role="user"]').count()==2
  assert ' '.join(target.locator('[data-message-author-role="user"]').first.locator('.whitespace-pre-wrap').inner_text().split())==' '.join(raw.split())
  assert tab_message('PC_ACQUIRE')['result']['acquired']
  tab_message('PC_RELEASE')
  passed('fixture execution in loaded Edge extension: supervisor sends one file per step, waits for replies, releases lock; not live ChatGPT')
  main();page.get_by_role('button',name='删除流程 原版流程测试',exact=True).click()
  page.get_by_role('alertdialog').get_by_role('button',name='删除',exact=True).click()
  wait_value('async()=>((await chrome.storage.local.get("langqueue_chains")).langqueue_chains.items.length===0&&(await chrome.storage.local.get("pfTrash")).pfTrash?.length===1)')
  main()
  if page.locator('.chain-card').count() or not page.get_by_text('还没有流程',exact=True).count():
   print('DELETE STATE',page.evaluate('async()=>chrome.storage.local.get(["pfLibrary","pfTrash","langqueue_chains"])'),flush=True)
   print('DELETE BODY',page.locator('body').inner_text(),flush=True)
   raise AssertionError('deleted flow reappeared after reload')
  page.get_by_text('还没有流程',exact=True).wait_for()
  page.goto(base+'workflow.html?trash=1')
  page.get_by_role('button',name='恢复',exact=True).click()
  wait_value('async()=>((await chrome.storage.local.get("langqueue_chains")).langqueue_chains.items[0]?.steps.length===2)')
  main();page.get_by_text('原版流程测试',exact=True).wait_for()
  passed('native deletion: saved to trash, no resurrection on reload, restore includes attachment bytes')
  page.get_by_role('button',name='删除流程 原版流程测试',exact=True).click()
  page.get_by_role('alertdialog').get_by_role('button',name='删除',exact=True).click()
  wait_value('async()=>((await chrome.storage.local.get("pfTrash")).pfTrash?.length===1)')
  page.goto(base+'workflow.html?trash=1')
  page.get_by_role('button',name='永久删除',exact=True).wait_for()
  page.screenshot(path=str(OUT/'prompt-chain-trash.png'))
  page.once('dialog',lambda dialog:dialog.dismiss())
  page.get_by_role('button',name='永久删除',exact=True).click()
  assert page.locator('.trash-row').count()==1
  file_id=page.evaluate('async()=>((await chrome.storage.local.get("pfTrash")).pfTrash[0].flow.steps[0].attachment.id)')
  page.once('dialog',lambda dialog:dialog.accept())
  page.get_by_role('button',name='永久删除',exact=True).click()
  page.wait_for_function('()=>document.querySelectorAll(".trash-row").length===0')
  wait_value('async(id)=>!(await PromptFlowStore.getFile(id))',file_id)
  passed('trash icons: restore, cancel permanent deletion, confirm deletion, unused attachment cleanup')
  bulk=page.evaluate('''async()=>{
   const S=PromptFlowStore,shared=await S.saveFile(new File(['shared'],'保留.md',{type:'text/markdown'})),orphan=await S.saveFile(new File(['orphan'],'清理.md',{type:'text/markdown'}));
   await S.saveFlow({id:'bulk-live',title:'仍在库中的流程',steps:[{attachment:shared}]});
   for(const [id,ref] of [['bulk-one',shared],['bulk-two',orphan]]){await S.saveFlow({id,title:id,steps:[{attachment:ref}]});await S.trashFlow(id);}
   return {shared:shared.id,orphan:orphan.id};
  }''')
  page.reload();page.get_by_role('button',name='清空最近删除',exact=True).wait_for()
  page.once('dialog',lambda dialog:dialog.dismiss());page.get_by_role('button',name='清空最近删除',exact=True).click()
  assert page.locator('.trash-row').count()==2
  page.once('dialog',lambda dialog:dialog.accept());page.get_by_role('button',name='清空最近删除',exact=True).click()
  page.wait_for_function('()=>document.querySelectorAll(".trash-row").length===0')
  assert page.get_by_role('button',name='清空最近删除',exact=True).is_disabled()
  wait_value('async ids=>!!(await PromptFlowStore.getFile(ids.shared))&&!(await PromptFlowStore.getFile(ids.orphan))',bulk)
  assert page.evaluate('async()=>((await PromptFlowStore.readLibrary()).flows.some(flow=>flow.id==="bulk-live"))')
  assert page.locator('#refresh-tabs').count()==0
  assert page.get_by_role('button',name='刷新连接',exact=True).count()==1
  page.screenshot(path=str(OUT/'prompt-chain-trash-cleared.png'))
  passed('clear trash: one confirmation for all current entries, cancellation keeps them, active library and shared files survive, orphan files cleaned; one refresh button')
  private=OUT/'如何让AI写出我想要的感觉.promptflow.json'
  if private.exists():
   main();settings();import_json(json.loads(private.read_text(encoding='utf-8')))
   wait_value('async()=>((await chrome.storage.local.get("langqueue_chains")).langqueue_chains.items.some(c=>c.steps.length===20))',timeout=30000)
   record=page.evaluate('async()=>((await chrome.storage.local.get("langqueue_chains")).langqueue_chains.items.find(c=>c.steps.length===20))')
   assert sum(len(step['attachments']) for step in record['steps'])==14
   assert not any(a['id'].startswith('pc-missing:') for s in record['steps'] for a in s['attachments'])
   main();page.locator('.chain-card').first.wait_for()
   page.screenshot(path=str(OUT/'prompt-chain-native-writing-library.png'))
   passed('private bundle: 20 original steps, 14 real attachments, native library round-trip')
  assert not errors,errors
  context.close()
(OUT/'extension-test-report.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
