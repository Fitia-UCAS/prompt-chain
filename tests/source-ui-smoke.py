from pathlib import Path
from tempfile import TemporaryDirectory
import json,time
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
EDGE=next(path for path in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if path.exists())
results=[]
with TemporaryDirectory(prefix='pc-source-ui-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'],viewport={'width':460,'height':850})
  worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
  base='/'.join(worker.url.split('/')[:3])+'/'
  page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
  def fresh():
   page.goto(base+'sidepanel.html');page.get_by_role('button',name='新建流程',exact=True).click();page.get_by_role('button',name='导入聊天',exact=True).wait_for()
  def upload(label,name,text):
   with page.expect_file_chooser() as chooser:page.get_by_role('button',name=label,exact=True).click()
   chooser.value.set_files({'name':name,'mimeType':'text/plain','buffer':text.encode()})
  def saved(title):
   page.wait_for_function('async title=>((await chrome.storage.local.get("pfLibrary")).pfLibrary?.flows.some(flow=>flow.title===title))',arg=title)
   page.wait_for_function('async title=>((await chrome.storage.local.get("langqueue_chains")).langqueue_chains?.items.some(flow=>flow.title===title))',arg=title)
  fresh()
  labels=['导入聊天','导入 Skill','导入 Prompts','导入 Markdown']
  assert page.locator('#creation-sources button').all_text_contents()==labels
  assert page.locator('#creation-sources button svg').count()==4
  raw='---\nname: source-example\n---\n\n# 示例\n\n保留 **原文**。'
  upload('导入 Markdown','source-example.md',raw);saved('source-example')
  assert page.locator('[data-field="text"]').input_value()==raw
  page.get_by_role('button',name='‹ 流程库',exact=True).click()
  row=page.locator('.chain-card');row.wait_for()
  page.wait_for_function('()=>document.querySelectorAll(".chain-card button").length===4')
  actions=row.get_by_role('button').evaluate_all('(els)=>els.map(el=>el.getAttribute("aria-label"))')
  assert [label.split(' ')[0] for label in actions]==['运行流程','停止流程','编辑流程','删除流程'],actions
  assert row.get_by_role('button',name='停止流程 source-example',exact=True).is_disabled()
  row.get_by_role('button',name='编辑流程 source-example',exact=True).click()
  page.locator('#steps').get_by_text('第 1 步 · 保留 原文。',exact=True).wait_for()
  assert page.locator('#source-picker').count()==0
  results.append('Markdown upload preserves raw text; native actions are run/stop/edit/delete; only one full editor')
  fresh()
  upload('导入 Prompts','prompts.json',json.dumps({'prompts':[{'title':'保留甲','content':'甲提示词。'},{'title':'排除乙','content':'乙提示词。'}]},ensure_ascii=False))
  page.wait_for_function('()=>document.querySelectorAll("#steps>details").length===2');saved('prompts')
  unwanted=page.locator('#steps>details').nth(1);unwanted.locator(':scope>summary').click();unwanted.get_by_role('button',name='删除本步',exact=True).click()
  assert page.locator('#steps>details').count()==1
  assert page.locator('[data-field="text"]').input_value()=='甲提示词。'
  results.append('Prompts JSON opens the same step cards, unwanted steps can be removed, and no alternate checkbox list is created')
  fresh()
  page.evaluate('''async()=>{
   const root=await navigator.storage.getDirectory(),skills=await root.getDirectoryHandle('skills',{create:true}),one=await skills.getDirectoryHandle('one',{create:true});
   const file=await one.getFileHandle('SKILL.md',{create:true}),writer=await file.createWritable();await writer.write('---\\nname: one\\n---\\n\\n技能原文。');await writer.close();window.showDirectoryPicker=async()=>skills;
  }''')
  page.get_by_role('button',name='导入 Skill',exact=True).click();saved('one')
  assert page.locator('[data-field="text"]').input_value()=='---\nname: one\n---\n\n技能原文。'
  results.append('Skill directory import reads SKILL.md and retains frontmatter and full text')
  fresh()
  upload('导入聊天','chat.md','# 聊天导入\n\n---\n\n## User 1\n\n第一条用户消息。\n\n---\n\n## ChatGPT 1\n\n助手回复。\n\n---\n\n## User 2\n\n第二条用户消息。')
  saved('聊天导入');assert page.locator('#steps>details').count()==2
  assert page.locator('[data-field="text"]').all_text_contents()==['第一条用户消息。','第二条用户消息。']
  results.append('chat file imports user rounds in original order through the new creation entry')
  page.evaluate('''async()=>{
   const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle('prompts',{create:true}),file=await directory.getFileHandle('cached.md',{create:true}),writer=await file.createWritable();await writer.write('第一版附件');await writer.close();window.showDirectoryPicker=async()=>directory;
  }''')
  page.get_by_role('button',name='选择附件目录',exact=True).click()
  page.wait_for_function('async()=>((await PromptFlowStore.sourceFiles()).some(file=>file.name==="cached.md"))')
  cache=page.evaluate('''async()=>{
   const directory=await PromptFlowStore.getDirectory(),original=(await PromptFlowStore.sourceFiles()).find(file=>file.name==='cached.md'),flow={steps:[{missingAttachment:{name:'cached.md'}}]};
   const report=await PromptFlowFileMatch.match(flow,{queryPermission:async()=>'prompt',requestPermission(){throw Error('不应该请求授权')},entries(){throw Error('不应该读取失效句柄')}},PromptFlowStore);
   const updated=await PromptFlowStore.cacheSourceFile('cached.md',new File(['第二版附件'],'cached.md',{type:(await original.getFile()).type}));
   return{report,first:await(await original.getFile()).text(),matchedId:flow.steps[0].attachment.id,oldId:original.ref.id,newId:updated.id,directory:directory.name};
  }''')
  assert cache['report']['matched']==1 and cache['first']=='第一版附件' and cache['matchedId']==cache['oldId'] and cache['newId']!=cache['oldId'],cache
  page.reload();page.locator('#creation-sources').wait_for(state='visible')
  assert page.evaluate('async()=>((await PromptFlowStore.getDirectory()).name)')=='prompts'
  assert page.evaluate('async()=>await(await((await PromptFlowStore.sourceFiles()).find(file=>file.name==="cached.md")).getFile()).text()')=='第二版附件'
  results.append('actual IndexedDB: cached directory survives reload, revoked handle uses bytes without reauthorization, updates retain old flow bytes')
  page.screenshot(path=str(OUT/'prompt-chain-imports-verified.png'))
  assert not errors,errors
  context.close()
(OUT/'source-ui-report.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False,indent=2))
