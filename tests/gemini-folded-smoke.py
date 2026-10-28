from pathlib import Path
from tempfile import TemporaryDirectory
import ast, json, time, sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / '.cache' / 'prompt-flow'
EDGE = next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
tree = ast.parse((ROOT / 'tests/provider-new-chat-smoke.py').read_text(encoding='utf-8'))
HTML = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'HTML' for t in n.targets))
HTML = HTML.replace('<style>', '<style>[contenteditable=true]{white-space:pre-wrap}')
HTML = HTML.replace("body.textContent=raw;node.append(body);", "renderQuestion(body,raw);node.append(body);const toggle=document.createElement('button');toggle.type='button';toggle.setAttribute('aria-label','Expand text');toggle.textContent='⌄';toggle.onclick=()=>{expanded=!expanded;renderQuestion(body,raw)};node.append(toggle);")
HTML = HTML.replace('setTimeout(completeAnswer,1000)', 'setTimeout(completeAnswer,answerDelay)')
HTML = HTML.replace('window.sent=[];', '''window.expanded=false;window.previewOnly=true;window.answerDelay=1000;
window.renderQuestion=(body,raw)=>{
 const shown=previewOnly&&!expanded?raw.split('（2）')[0].trim():raw;
 body.replaceChildren();const text=document.createElement('span');text.textContent=shown.replace(/》——/g,'》\\n——');body.append(text);
 const hidden=document.createElement('span');hidden.className='cdk-visually-hidden';hidden.textContent='由辅助阅读器提供的标签';body.append(hidden);
};window.sent=[];''')
PROMPT = '请依次阅读以下测试材料，并在每份材料阅读完毕后回复。\n\n（1）《01-layout-confirmation-and-document-reading-start-prompt》——这是第一份材料。\n（2）《02-local-fixture》——接下来还有其他材料。\n' + '这是用于核对长消息折叠和换行的测试内容，请保留所有要求。' * 12
checks = []
with TemporaryDirectory(prefix='pc-gemini-folded-', dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context = p.chromium.launch_persistent_context(profile, executable_path=str(EDGE), headless=True, args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
  try:
   worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
   base = '/'.join(worker.url.split('/')[:3]) + '/'
   page = context.new_page()
   page.route('https://gemini.google.com/**', lambda route: route.fulfill(status=200, content_type='text/html', body=HTML))
   panel = context.new_page()
   def run_state():
    return worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
   def wait_state(status):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
     run = run_state()
     if run and run['status'] == status:
      return run
     if run and status == 'completed' and run['status'] == 'paused':
      raise AssertionError({'run': run, 'panelUrl': panel.url, 'panel': panel.locator('body').inner_text()})
     panel.wait_for_timeout(100)
    diagnostic = worker.evaluate('async()=>chrome.runtime.sendMessage({type:"PF_DIAGNOSTIC"})')
    raise AssertionError({'run': run, 'diagnostic': diagnostic, 'panel': panel.locator('body').inner_text()})
   def new_flow(attachment=False):
    return worker.evaluate('''async({prompt,attachment})=>{
      const file=attachment?await PromptFlowStore.saveFile(new File(['folded fixture markdown'],'folded.md',{type:'text/markdown'})):null;
      const flow=PromptFlowModel.flow({title:'Gemini 折叠验收',steps:[{text:prompt},file?{attachment:file}:{text:'下一条测试消息'},{text:'结束测试'}]});
      await PromptFlowStore.saveFlow(flow);await PromptChainNative.syncFlow(flow);return flow;
    }''', {'prompt': PROMPT, 'attachment': attachment})
   for preview in ([] if '--recovery-only' in sys.argv else [True, False]):
    page.goto('https://gemini.google.com/app/retained-old-id?dest=create')
    page.evaluate('''()=>{const send=document.querySelector('[aria-label="Send message"]'),original=send.onclick;send.onclick=()=>{original();if(sent.length===1)setTimeout(()=>history.pushState({},'','/app/new-formal-id?dest=create'),1200)}}''')
    page.wait_for_timeout(900)
    page.evaluate('preview=>{previewOnly=preview;answerDelay=2500}', preview)
    flow = new_flow(attachment=True)
    panel.goto(base + 'workflow.html?flow=' + flow['id'])
    panel.locator('#target option').nth(1).wait_for(state='attached')
    panel.locator('#target').select_option(index=1)
    panel.locator('#run').click()
    try:
     page.wait_for_function('sent.length===1', timeout=12000)
    except Exception:
     raise AssertionError({'run': run_state(), 'panel': panel.locator('body').inner_text(), 'page': page.locator('body').inner_text()})
    toggle = page.get_by_role('button', name='Expand text', exact=True).first
    toggle.click()
    toggle.click()
    try:
     panel.get_by_text('本轮回答完成 1',exact=True).wait_for(timeout=12000)
    except Exception:
     raise AssertionError({'run':run_state(),'panel':panel.locator('body').inner_text(),'sent':page.evaluate('sent.length')})
    run = wait_state('completed')
    assert page.evaluate('sent.length') == 3, run
    assert page.evaluate('prompt=>sent[0].replace(/\\s+/g," ").trim()===prompt.replace(/\\s+/g," ").trim()', PROMPT)
    assert run['flow']['steps'][0]['text'] == PROMPT
    assert page.evaluate('filesSeen.map(file=>file.name)') == ['folded.md']
    assert run['targetUrl'] == page.url
    checks.append(('Partial prefix' if preview else 'Full DOM') + ': folded/wrapped first message, hidden label and expand/collapse; Markdown next step sent once; all steps complete through extension editor')
    print(checks[-1], flush=True)
   page.goto('https://gemini.google.com/app/recover-existing?dest=create')
   page.wait_for_timeout(900)
   flow = new_flow()
   page.evaluate('''prompt=>{sent=[prompt];const node=document.createElement('user-query'),body=document.createElement('div');body.className='query-text';renderQuestion(body,prompt);node.append(body);const toggle=document.createElement('button');toggle.setAttribute('aria-label','Expand text');node.append(toggle);document.querySelector('main').append(node);const answer=document.createElement('model-response');answer.innerHTML='<message-content><div class="markdown">先前已经完成的回答</div></message-content>';document.querySelector('main').append(answer);}''', PROMPT)
   seeded = worker.evaluate('''async flow=>{
     const [tab]=await chrome.tabs.query({url:'https://gemini.google.com/app/recover-existing?dest=create'}),now=Date.now(),id=crypto.randomUUID();
     const run={id,flow,tabId:tab.id,targetUrl:'https://gemini.google.com/app/retained-old-id?dest=create',allowNewChat:false,status:'paused',phase:'waiting',index:0,repeated:0,startedAt:now-60000,reason:'目标页已离开锁定对话',logs:[{at:now-30000,text:'已发送第 1 步',tone:'info'}],sentUserKey:'legacy-user',beforeAssistantKey:'',sentAt:now-30000,delivery:{url:'https://gemini.google.com/app/retained-old-id?dest=create',text:flow.steps[0].text,baselineUserKey:'',baselineAssistantKey:'',baselineMessages:[],attemptedAt:now-29000}};
     await chrome.storage.local.set({pfRun:run});return run;
   }''', flow)
   panel.goto(base + 'sidepanel.html')
   panel.get_by_role('button', name='恢复流程 Gemini 折叠验收', exact=True).click()
   panel.wait_for_url('**/workflow.html?monitor=1')
   panel.get_by_text('Flow resumed', exact=False).wait_for()
   run = wait_state('completed')
   assert run['id'] == seeded['id'] and page.evaluate('sent.length') == 3, run
   assert page.evaluate('sent.filter(text=>text===sent[0]).length') == 1
   checks.append('Persisted paused send: library Resume enters monitor, accepts existing folded message and answer, adopts formal URL and continues without retransmission')
   print(checks[-1], flush=True)
   page.goto('https://gemini.google.com/app/recover-existing?dest=create')
   page.wait_for_timeout(900)
   worker.evaluate('async run=>{run.id=crypto.randomUUID();run.status="paused";run.phase="sending";run.targetUrl="https://gemini.google.com/app/recover-existing?dest=create";run.pending={...run.delivery,url:run.targetUrl,text:"另一条尚未核对的提示词"};delete run.delivery;await chrome.storage.local.set({pfRun:run})}', seeded)
   prompts=[]
   def dismiss(dialog):prompts.append(dialog.message);dialog.dismiss()
   panel.on('dialog',dismiss)
   panel.goto(base + 'sidepanel.html')
   panel.get_by_role('button', name='恢复流程 Gemini 折叠验收', exact=True).click()
   panel.wait_for_url('**/workflow.html?monitor=1')
   panel.wait_for_timeout(1000)
   assert len(prompts)==1 and '重新发送本步' in prompts[0],prompts
   panel.locator('#menu-toggle').click()
   assert panel.get_by_role('button', name='重试本步', exact=True).count()==0
   assert panel.locator('#resume').is_visible()
   panel.locator('#monitor-title').click()
   assert panel.locator('#menu').is_hidden()
   panel.locator('#menu-toggle').click()
   panel.keyboard.press('Escape')
   assert panel.locator('#menu').is_hidden()
   assert page.evaluate('sent.length') == 0
   panel.reload()
   assert 'resume=' not in panel.url
   assert page.evaluate('sent.length') == 0
   checks.append('Unmatched resume opens execution page with the same Run control for rechecking; no separate Retry menu; outside click and Escape dismiss menu; no resend or repeat resume after reload')
   print(checks[-1], flush=True)
   panel.remove_listener('dialog',dismiss)
   panel.wait_for_function("view==='monitor'&&!runCommandPending")
   panel.evaluate("window.confirm=()=>{window.retryConfirmed=true;return true}")
   panel.locator('#resume').click();panel.get_by_text('Retry requested by user',exact=False).wait_for();wait_state('completed')
   assert panel.evaluate('retryConfirmed')
   assert page.evaluate('sent.length')==3
   checks.append('The same Run arrow requests explicit confirmation before retrying an unreceived send; accepting retries once and completes')
   (OUT / 'gemini-folded-report.json').write_text(json.dumps({'version': worker.evaluate('chrome.runtime.getManifest().version'), 'environment': 'loaded extension, isolated Edge and synthetic Gemini DOM; not live Gemini account', 'checks': checks}, ensure_ascii=False, indent=2), encoding='utf-8')
  finally:
   context.close()
