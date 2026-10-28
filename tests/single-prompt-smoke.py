from pathlib import Path
from tempfile import TemporaryDirectory
import ast,json,time,sys
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
tree=ast.parse((ROOT/'tests/browser-smoke.py').read_text(encoding='utf-8'))
HTML=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='HTML' for t in n.targets))
HTML=HTML.replace('<form data-chatgpt-composer','<form').replace('<input type="file" aria-label="Attach files">','<input type="file" id="octane-mobile-composer-files-input" accept=".txt,.md" multiple>')
HTML=HTML.replace('<div id="prompt-textarea" contenteditable="true" role="textbox" style="min-height:80px;border:1px solid"> </div>','<textarea id="mobile-composer-prompt" style="min-height:80px"></textarea>')
HTML=HTML.replace('data-testid="send-button" aria-label="Send prompt"','aria-label="发送消息"').replace('[data-testid=send-button]','[aria-label=发送消息]')
HTML=HTML.replace('#prompt-textarea','#mobile-composer-prompt').replace('editor.textContent','editor.value').replace('editor.innerText','editor.value')
if '--truncated' in sys.argv:
 HTML=HTML.replace("node.querySelector('span').textContent=f.name;node.querySelector('span').setAttribute('aria-label',f.name);", "node.querySelector('span').textContent=f.name.slice(0,20)+'...';")
 HTML=HTML.replace("'Remove '+f.name", "'Remove file'")
 HTML=HTML.replace("form.append(node);setTimeout", "form.append(node);event.target.value='';setTimeout")
 HTML=HTML.replace("name.textContent=chip.querySelector('span').textContent", "name.textContent=filesSeen.at(-1).name")
results=[]
with TemporaryDirectory(prefix='pc-single-prompt-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'],viewport={'width':460,'height':850})
  worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
  base='/'.join(worker.url.split('/')[:3])+'/'
  target=context.new_page();target.route('https://chatgpt.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML));target.goto('https://chatgpt.com/c/single-prompt')
  page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
  page.goto(base+'sidepanel.html');page.get_by_role('button',name='新建提示词',exact=True).last.wait_for()
  sentinel={'id':'previous-record','status':'completed','flow':{'id':'previous','steps':[]},'logs':[]}
  worker.evaluate('value=>chrome.storage.local.set({pfRun:value})',sentinel)
  page.get_by_role('button',name='新建提示词',exact=True).last.click()
  dialog=page.get_by_role('dialog');dialog.get_by_label('名称',exact=True).fill('独立提示词发送测试');dialog.get_by_label('提示词',exact=True).fill('追加正文')
  with page.expect_file_chooser() as chooser:dialog.get_by_role('button',name='添加附件',exact=True).click()
  chooser.value.set_files({'name':('02-anadiplosis-information-linkage.md' if '--truncated' in sys.argv else '独立附件.md'),'mimeType':'text/markdown','buffer':b'abc'})
  dialog.get_by_text(('02-anadiplosis-information-linkage.md' if '--truncated' in sys.argv else '独立附件.md'),exact=True).wait_for();dialog.get_by_role('button',name='保存',exact=True).click()
  target.locator('#mobile-composer-prompt').fill('已有草稿')
  page.get_by_role('button',name='刷新连接',exact=True).click()
  page.locator('.platform-status[data-pc-ready="true"]').wait_for()
  assert target.evaluate('sendCount')==0
  send=page.get_by_role('button',name='发送 独立提示词发送测试',exact=True);send.wait_for();send.click()
  target.wait_for_function('sendCount===1',timeout=15000)
  page.wait_for_timeout(900)
  assert target.evaluate('sendCount')==1
  assert target.locator('[data-message-author-role=user] .whitespace-pre-wrap').inner_text().split()==['已有草稿','追加正文']
  assert target.evaluate('filesSeen')==[{'name':('02-anadiplosis-information-linkage.md' if '--truncated' in sys.argv else '独立附件.md'),'size':3}]
  assert worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')==sentinel
  assert 'sidepanel.html' in page.url
  page.get_by_role('button',name='刷新连接',exact=True).click();page.wait_for_timeout(500)
  assert target.evaluate('sendCount')==1
  assert page.locator('#pc-run').count()==0
  assert not errors,errors
  page.screenshot(path=str(OUT/'single-prompt-verified.png'))
  results.append('Loaded extension UI: one manual send on a mobile textarea and Chinese send button, append draft plus real attachment bytes, existing chain record unchanged; fixture, not live ChatGPT')
  results.append('Refresh reconnects the selected tab without a page reload or another send; header shows only light, refresh and settings')
  context.close()
(OUT/('single-prompt-truncated-report.json' if '--truncated' in sys.argv else 'single-prompt-report.json')).write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False,indent=2))
