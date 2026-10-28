from pathlib import Path
from tempfile import TemporaryDirectory
import ast,json,time,sys
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
OUT.mkdir(parents=True,exist_ok=True)
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
tree=ast.parse((ROOT/'tests'/'browser-smoke.py').read_text(encoding='utf-8'))
HTML=next(ast.literal_eval(node.value) for node in tree.body if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='HTML' for t in node.targets))
HTML=HTML.replace('window.sendCount++;',"window.sendCount++;if(window.sendCount===1)setTimeout(()=>history.pushState({},'','/c/delayed-route'),600);")
HTML=HTML.replace("window.sendCount=0;","document.querySelector('main').replaceChildren();window.sendCount=0;")
HTML=HTML.replace("window.sendCount=0;","document.querySelector('form').insertAdjacentHTML('beforeend','<button type=\"button\" aria-label=\"网页搜索，点击移除\">网页搜索</button>');window.sendCount=0;")
HTML=HTML.replace("window.sendCount=0;","document.querySelector('main').insertAdjacentHTML('beforeend','<div role=\"status\" aria-busy=\"true\" data-is-streaming=\"true\">其他组件仍在加载</div>');window.sendCount=0;")
temporary='--temporary' in sys.argv
initial='https://chatgpt.com/c/local-chatgpt%3A81d88ea4-6ec3-4c2c-9041-d2eb5a55329d' if temporary else 'https://chatgpt.com/'
results=[]
with TemporaryDirectory(prefix='pc-new-chat-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
  worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker',timeout=15000)
  base='/'.join(worker.url.split('/')[:3])+'/'
  page=context.new_page();page.goto(base+'workflow.html')
  target=context.new_page();errors=[];target.on('pageerror',lambda error:errors.append(str(error)))
  target.route('https://chatgpt.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML))
  target.goto(initial)
  tab_id=page.evaluate('async url=>{const tabs=await chrome.tabs.query({url});return tabs[0].id}',initial)
  deadline=time.monotonic()+15
  while time.monotonic()<deadline:
   ready=page.evaluate('async id=>{try{return(await chrome.tabs.sendMessage(id,{type:"COMPAT_CHECK",payload:{}}))?.result?.ready&& (await chrome.tabs.sendMessage(id,{type:"PF_STATUS"}))?.ok}catch{return false}}',tab_id)
   if ready:break
   page.wait_for_timeout(100)
  assert ready
  worker.evaluate("()=>{globalThis.routeTrace=[];chrome.storage.onChanged.addListener(changes=>{const r=changes.pfRun?.newValue;if(r)routeTrace.push({phase:r.phase,status:r.status,url:r.targetUrl,allowNewChat:r.allowNewChat})})}")
  started=page.evaluate('''async tabId=>{
   const attachment=await PromptFlowStore.saveFile(new File(['abc'],'第二步.md',{type:'text/markdown'}));
   return chrome.runtime.sendMessage({type:'PF_START',tabId,flow:{title:'新聊天地址延迟更新',delaySeconds:0,steps:[{text:'消息一'},{text:'',attachment}]}});
  }''',tab_id)
  assert started['ok'],started
  other=context.new_page();other.route('https://chatgpt.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body='<main>Other conversation</main>'));other.goto('https://chatgpt.com/c/unrelated');page.bring_to_front()
  deadline=time.monotonic()+25
  while time.monotonic()<deadline:
   run=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
   assert run['status']!='paused',run
   if run['status']=='completed':break
   page.wait_for_timeout(100)
  assert run['status']=='completed',run
  assert run['targetUrl']=='https://chatgpt.com/c/delayed-route',run
  assert not run['allowNewChat']
  result=page.evaluate('async()=>chrome.runtime.sendMessage({type:"PF_DIAGNOSTIC"})')
  assert result['ok'],result
  assert result['diagnostic']['phase']=='completed',result
  assert result['diagnostic']['generationStrategy']=='visible-stop-buttons',result
  assert result['diagnostic']['version']==json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))['version']
  assert target.evaluate('sendCount')==2
  assert target.evaluate('filesSeen')==[{'name':'第二步.md','size':3}]
  trace=worker.evaluate('routeTrace')
  assert any(item['phase']=='waiting' and item['url']==initial for item in trace),trace
  assert not any(item['status']=='paused' for item in trace),trace
  assert not errors,errors
  results.append('real extension: late new-chat URL binds once, unrelated busy status does not block replies, next attachment sends without duplicate first send')
  context.close()
(OUT/('temporary-chat-report.json' if temporary else 'new-chat-report.json')).write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False,indent=2))
