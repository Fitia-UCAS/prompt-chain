from pathlib import Path
import ast,json,subprocess
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
tree=ast.parse((ROOT/'tests/message-reader-smoke.py').read_text(encoding='utf-8'))
HTML=next(ast.literal_eval(node.value) for node in tree.body if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='HTML' for t in node.targets))
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=str(EDGE),headless=True);page=browser.new_page()
 page.route('https://chatgpt.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML));page.goto('https://chatgpt.com/c/upgrade')
 page.evaluate('''()=>{mode='bare';document.querySelector('main').innerHTML='<section><div data-user-message-bubble>历史问题</div></section><section><div class="markdown prose">历史回答</div></section>'}''')
 page.add_script_tag(path=str(ROOT/'vendor/marked/marked.min.js'))
 page.add_script_tag(path=str(ROOT/'shared/platforms.js'))
 for file in ['shared/model.js','content/message-reader.js','content/supervisor-engine.js','content/bridge.js']:
  old=subprocess.check_output(['git','show','06374e9:'+file],cwd=ROOT).decode('utf-8');page.add_script_tag(content=old)
 before=page.evaluate('PromptFlowSupervisor.snapshot()');assert before['reader']['assistants']==0,before
 page.evaluate('window.oldRefs=[PromptFlowModel,PromptChainMessages,PromptFlowSupervisor]')
 page.add_script_tag(path=str(ROOT/'shared/platforms.js'))
 for file in ['shared/model.js','content/message-reader.js','content/supervisor-engine.js']:page.add_script_tag(path=str(ROOT/file))
 after=page.evaluate('async()=> (await bridgeMessage({type:"PF_STATUS"})).snapshot')
 assert after['reader']['version']==7 and after['reader']['assistants']==1,after
 assert page.evaluate('oldRefs[0]===PromptFlowModel&&oldRefs[1]===PromptChainMessages&&oldRefs[2]===PromptFlowSupervisor&&__listeners.length===1')
 result=page.evaluate('''snapshot=>bridgeMessage({type:'PF_SEND',operation:{id:'upgrade-operation',runId:'upgrade-run',url:location.href,text:'升级后的下一条',baselineUserKey:snapshot.lastUser.key,baselineAssistantKey:snapshot.assistant.key,baselineMessages:snapshot.messages}})''',after)
 assert result['ok'] and page.evaluate('clicks')==1,result
 page.set_content('<form><textarea id="mobile-composer-prompt" placeholder="询问 ChatGPT"></textarea></form>')
 assert page.evaluate('PromptFlowSupervisor.snapshot().hasComposer')
 assert page.evaluate('PromptFlowSupervisor.composer().id')=='mobile-composer-prompt'
 browser.close()
print(json.dumps(['live reader upgrade: legacy bridge and object references retained; new DOM replies detected; one send listener and one click'],ensure_ascii=False))
