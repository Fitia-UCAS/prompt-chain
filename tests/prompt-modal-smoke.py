from pathlib import Path
from tempfile import TemporaryDirectory
import json,time
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
EDGE=next(path for path in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if path.exists())
results=[];measurements={}
with TemporaryDirectory(prefix='pc-prompt-modal-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'],viewport={'width':460,'height':850})
  worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
  base='/'.join(worker.url.split('/')[:3])+'/'
  page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
  def modal():
   page.goto(base+'sidepanel.html');page.get_by_role('button',name='新建提示词',exact=True).last.click()
   dialog=page.get_by_role('dialog');dialog.get_by_role('button',name='导入聊天',exact=True).wait_for();return dialog
  def upload(dialog,label,name,text):
   with page.expect_file_chooser() as chooser:dialog.get_by_role('button',name=label,exact=True).click()
   chooser.value.set_files({'name':name,'mimeType':'application/json' if name.endswith('.json') else 'text/plain','buffer':text.encode()})
  def saved(title):
   deadline=time.monotonic()+10
   while time.monotonic()<deadline:
    value=page.evaluate('async title=>Object.values((await chrome.storage.local.get("langqueue_prompts")).langqueue_prompts.promptsById).find(item=>item.title===title)',title)
    if value:return value
    page.wait_for_timeout(50)
   raise AssertionError('prompt not saved: '+title)
  def flow_named(title,count):
   deadline=time.monotonic()+5
   while time.monotonic()<deadline:
    flow=page.evaluate('async title=>((await chrome.storage.local.get("pfLibrary")).pfLibrary.flows.find(flow=>flow.title===title))',title)
    if flow and len(flow['steps'])==count:return flow
    page.wait_for_timeout(50)
   raise AssertionError('sequence not saved: '+title)
  dialog=modal()
  for label in ['导入聊天','导入 Skill','导入 Prompts','导入 Markdown']:
   assert dialog.get_by_role('button',name=label,exact=True).locator('svg').count()==1
  sizes=dialog.locator('.pc-source-button').evaluate_all('(els)=>els.map(el=>[el.offsetWidth,el.offsetHeight])')
  assert len(sizes)==6
  assert len(set(map(tuple,sizes)))==1 and sizes[0][1]==36,sizes
  measurements['460']=sizes
  page.screenshot(path=str(OUT/'prompt-chain-prompt-modal-imports.png'))
  results.append('requested New Prompt modal: four icon-and-text import buttons below the prompt, uniform dimensions')
  dialog.get_by_label('名称',exact=True).fill('保留已有草稿')
  dialog.get_by_label('提示词',exact=True).fill('原来的草稿。')
  upload(dialog,'添加附件','seed.txt','已有附件')
  raw='---\nname: modal-example\n---\n\n# 内容\n\n完整 **原文**。'
  upload(dialog,'导入 Markdown','modal-example.md',raw)
  dialog.get_by_label('提示词',exact=True).wait_for()
  page.wait_for_function('()=>document.querySelector("#prompt-content").value.includes("完整 **原文**。")')
  assert dialog.get_by_label('名称',exact=True).input_value()=='保留已有草稿'
  assert dialog.get_by_label('提示词',exact=True).input_value()=='原来的草稿。\n\n'+raw
  dialog.get_by_role('button',name='保存',exact=True).click();record=saved('保留已有草稿')
  assert record['attachments'][0]['name']=='seed.txt'
  results.append('Markdown import appends untouched source, preserves the draft title and pending attachment, saves through the original prompt editor')
  dialog=modal()
  data={'prompts':[{'title':'附件导入测试','content':'请读取这个附件。','attachments':[{'id':'file-one','name':'content.txt'}]}],'attachments':[{'id':'file-one','name':'content.txt','mimeType':'text/plain','size':3,'dataBase64':'YWJj'}]}
  upload(dialog,'导入 Prompts','prompt.json',json.dumps(data,ensure_ascii=False))
  page.wait_for_function('()=>document.querySelector("#prompt-title").value==="附件导入测试"')
  dialog.get_by_role('button',name='保存',exact=True).click();record=saved('附件导入测试')
  payload=page.evaluate('async id=>(await import(chrome.runtime.getURL("assets/storage.js"))).o(id,0)',record['attachments'][0]['id'])
  assert payload['chunkBase64']=='YWJj' and record['content']=='请读取这个附件。'
  results.append('Prompts import restores attachment bytes into the prompt attachment database; not merely a filename')
  dialog=modal()
  page.evaluate('''async()=>{const root=await navigator.storage.getDirectory(),folder=await root.getDirectoryHandle('modal-skill',{create:true}),file=await folder.getFileHandle('SKILL.md',{create:true}),writer=await file.createWritable();await writer.write('---\\nname: modal-skill\\n---\\n\\n技能完整原文。');await writer.close();window.showDirectoryPicker=async()=>folder;}''')
  dialog.get_by_role('button',name='导入 Skill',exact=True).click()
  page.wait_for_function('()=>document.querySelector("#prompt-content").value.includes("技能完整原文。")')
  assert dialog.get_by_label('提示词',exact=True).input_value()=='---\nname: modal-skill\n---\n\n技能完整原文。'
  dialog.get_by_role('button',name='保存',exact=True).click();saved('modal-skill')
  results.append('Skill import reads the chosen SKILL.md and saves its complete source from the requested modal')
  dialog=modal()
  upload(dialog,'导入聊天','two-turns.md','# 自动带出的聊天标题\n\n---\n\n## User 1\n\n第一步完整提示词。\n\n---\n\n## ChatGPT 1\n\n已收到。\n\n---\n\n## User 2\n\n第二步完整提示词。')
  page.wait_for_url('**/workflow.html?flow=*&imported=1');page.wait_for_function('()=>document.querySelectorAll("#steps>details").length===2')
  assert page.locator('#flow-title').input_value()=='自动带出的聊天标题'
  assert page.locator('#steps>details').first.evaluate('(el)=>el.open')
  assert page.locator('[data-field="text"]').first.input_value()=='第一步完整提示词。'
  assert page.locator('.pc-source-selection,#source-picker').count()==0
  page.screenshot(path=str(OUT/'prompt-chain-chat-import-cards.png'))
  results.append('chat import immediately opens the existing card editor with its actual title and first prompt visible; no blank single-prompt form or checkbox list')
  dialog=modal()
  dialog.get_by_label('名称',exact=True).fill('草稿与聊天序列')
  dialog.get_by_label('提示词',exact=True).fill('已有的开头。')
  upload(dialog,'添加附件','draft.txt','草稿附件')
  page.evaluate('''async()=>{const root=await navigator.storage.getDirectory(),folder=await root.getDirectoryHandle('modal-prompts',{create:true}),file=await folder.getFileHandle('reference.md',{create:true}),writer=await file.createWritable();await writer.write('本地参考原文');await writer.close();window.showDirectoryPicker=async()=>folder;}''')
  dialog.get_by_role('button',name='附件目录',exact=True).click()
  deadline=time.monotonic()+5
  while time.monotonic()<deadline:
   if page.evaluate('async()=>((await PromptFlowStore.sourceFiles()).some(file=>file.name==="reference.md"))'):break
   page.wait_for_timeout(50)
  else:raise AssertionError('folder button did not save its cache')
  chat='# 聊天原流程\n\n---\n\n## User 1\n\n第一轮。\n\n---\n\n## ChatGPT 1\n\n第一轮回复。\n\n---\n\n## User 2\n\n不要的第二轮。\n\n---\n\n## ChatGPT 2\n\n第二轮回复。\n\n---\n\n## User 3\n\n- File: [reference.md](<https://example.invalid/file>)\n\n第三轮读附件。'
  upload(dialog,'导入聊天','chat.md',chat)
  page.wait_for_url('**/workflow.html?flow=*&imported=1');page.wait_for_function('()=>document.querySelectorAll("#steps>details").length===4')
  unwanted=page.locator('#steps>details').nth(2);unwanted.locator(':scope>summary').click();unwanted.get_by_role('button',name='删除本步',exact=True).click()
  page.wait_for_function('()=>document.querySelectorAll("#steps>details").length===3')
  flow=flow_named('草稿与聊天序列',3)
  assert [step['text'] for step in flow['steps']]==['已有的开头。','第一轮。','第三轮读附件。'],flow
  assert [step['attachment']['name'] for step in flow['steps'] if step['attachment']]==['draft.txt','reference.md']
  assert not any(step['missingAttachment'] for step in flow['steps'])
  assert '第一轮回复。' in flow['steps'][1]['referenceReply']
  results.append('chat import creates ordered step cards, removes unwanted rounds there, keeps the existing draft/file and matches cached attachments')
  page.goto(base+'sidepanel.html');page.get_by_role('button',name='编辑 保留已有草稿',exact=True).click();dialog=page.get_by_role('dialog')
  upload(dialog,'导入 Prompts','two.json',json.dumps({'prompts':[{'title':'新增甲','content':'新增甲内容。'},{'title':'新增乙','content':'新增乙内容。'}]},ensure_ascii=False))
  page.wait_for_url('**/workflow.html?flow=*&imported=1');page.wait_for_function('()=>document.querySelectorAll("#steps>details").length===3')
  restored=flow_named('保留已有草稿',3)
  assert restored['steps'][0]['attachment']['name']=='seed.txt'
  original=page.evaluate('async id=>new TextDecoder().decode((await PromptFlowStore.getFile(id)).bytes)',restored['steps'][0]['attachment']['id']);assert original=='已有附件'
  results.append('editing an existing prompt and importing multiple items preserves its already-saved attachment bytes in the resulting sequence')
  dialog=modal();dialog.get_by_label('名称',exact=True).fill('取消仍保留草稿');dialog.get_by_label('提示词',exact=True).fill('保留这段文字。')
  with page.expect_file_chooser() as chooser:dialog.get_by_role('button',name='导入 Prompts',exact=True).click()
  chooser.value.set_files([])
  assert dialog.get_by_label('提示词',exact=True).input_value()=='保留这段文字。'
  for width,height in [(460,850),(380,620),(320,420)]:
   page.set_viewport_size({'width':width,'height':height});dialog.locator('.pc-prompt-body').evaluate('(el)=>el.scrollTop=el.scrollHeight')
   page.screenshot(path=str(OUT/f'prompt-chain-prompt-modal-{width}.png'))
   sizes=dialog.locator('.pc-source-button').evaluate_all('(els)=>els.map(el=>[el.offsetWidth,el.offsetHeight])');assert len(set(map(tuple,sizes)))==1 and sizes[0][1]==36,sizes;measurements[str(width)]=sizes
   for name in ['导入聊天','导入 Skill','导入 Prompts','导入 Markdown','添加附件','附件目录','保存']:
    button=dialog.get_by_role('button',name=name,exact=True);rect=button.bounding_box();assert rect and rect['y']>=0 and rect['y']+rect['height']<=height,(name,width,height,rect)
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=str(OUT/'prompt-chain-prompt-modal-small.png'))
  results.append('cancel file selection retains the draft; all six buttons have identical dimensions and remain reachable with Save at three viewport sizes')
  page.set_viewport_size({'width':1000,'height':800});page.goto(base+'onboarding.html')
  page.get_by_role('button',name='新建提示词',exact=True).click();dialog=page.get_by_role('dialog')
  for name in ['导入聊天','导入 Skill','导入 Prompts','导入 Markdown']:dialog.get_by_role('button',name=name,exact=True).wait_for()
  upload(dialog,'导入 Markdown','onboarding-modal.md','引导页导入原文。')
  page.wait_for_function('()=>document.querySelector("#prompt-content").value==="引导页导入原文。"')
  dialog.get_by_role('button',name='保存',exact=True).click();saved('onboarding-modal')
  results.append('onboarding uses the same New Prompt importer and can save imported content')
  assert not errors,errors
  context.close()
(OUT/'prompt-modal-report.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'prompt-modal-measurements.json').write_text(json.dumps(measurements,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False,indent=2))
