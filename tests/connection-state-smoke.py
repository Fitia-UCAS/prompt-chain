"""Side-panel connection state: bound conversation, deleted conversation, closed tab, reopen.

Loads the real extension. The page is a local ChatGPT fixture served for every
chatgpt.com URL, so navigating to "/" simulates deleting the conversation in the
site (the tab survives, the conversation does not).

Checks the header light, the target selector, the run entry point and that the
diagnostics still copy after the tab is gone.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / '.cache' / 'prompt-flow'
EDGE = next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
URL = 'https://chatgpt.com/c/conn-fixture'
HTML = '''<!doctype html><html><head><meta charset="utf-8"></head><body><main id="thread"></main>
<form id="composer" onsubmit="return false"><div id="prompt-textarea" contenteditable="true" role="textbox" style="min-height:60px;border:1px solid;min-width:280px"></div><button type="button" data-testid="send-button" aria-label="Send prompt">send</button></form>
<script>
window.sendCount=0;
const thread=document.getElementById('thread'),editor=document.getElementById('prompt-textarea');
document.querySelector('[data-testid=send-button]').onclick=()=>{
  const text=editor.innerText.trim();if(!text)return;window.sendCount++;
  const turn=document.createElement('article');turn.setAttribute('data-testid','conversation-turn-'+(window.sendCount*2));
  const user=document.createElement('div');user.setAttribute('data-message-author-role','user');user.setAttribute('data-message-id','u'+window.sendCount);
  const body=document.createElement('div');body.className='whitespace-pre-wrap';body.textContent=text;user.append(body);turn.append(user);thread.append(turn);
  const answer=document.createElement('article');answer.setAttribute('data-testid','conversation-turn-'+(window.sendCount*2+1));
  answer.innerHTML='<div data-message-author-role="assistant" data-message-id="a'+window.sendCount+'"><div class="markdown">回答 '+window.sendCount+'</div></div>';thread.append(answer);
  editor.textContent='';
};
window.chrome={runtime:{onMessage:{addListener(){}},async sendMessage(message){return{ok:true};}}};
</script></body></html>'''

checks = []
report = {'environment': 'loaded extension, isolated Edge, local ChatGPT fixture; not a live account', 'checks': checks}

with TemporaryDirectory(prefix='pc-conn-', dir=str(OUT)) as profile:
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(profile, executable_path=str(EDGE), headless=True,
            args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            base = '/'.join(worker.url.split('/')[:3]) + '/'
            target = context.new_page()
            target.route('https://chatgpt.com/**', lambda route: route.fulfill(status=200, content_type='text/html', body=HTML))
            target.goto(URL)
            flow = worker.evaluate("""async()=>{const flow=PromptFlowModel.flow({title:'Connection state',steps:[{text:'First'},{text:'Second'}]});await PromptFlowStore.saveFlow(flow);return flow}""")
            panel = context.new_page()
            panel.goto(base + 'workflow.html?flow=' + flow['id'])
            panel.locator('#target option').nth(1).wait_for(state='attached')
            panel.locator('#target').select_option(index=1)
            panel.evaluate('()=>{window.__notice="";const node=document.getElementById("notice");new MutationObserver(()=>{window.__notice=node.innerText}).observe(node,{childList:true,subtree:true,characterData:true});}')
            panel.locator('#run').click()
            try:
                target.wait_for_function('sendCount===1', timeout=20000)
            except Exception:
                print('NOTICE', panel.locator('#notice').inner_text(), flush=True)
                print('RUN', json.dumps(worker.evaluate('async()=>(await chrome.storage.local.get("pfRun")).pfRun'), ensure_ascii=False)[:1200], flush=True)
                print('SEND', target.evaluate('sendCount'), 'COMPOSER', target.evaluate('!!document.getElementById("prompt-textarea")'), flush=True)
                raise
            panel.locator('#pause').click()
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                run = worker.evaluate('async()=>(await chrome.storage.local.get("pfRun")).pfRun')
                if run['status'] == 'paused':
                    break
                panel.wait_for_timeout(100)
            assert run['status'] == 'paused', run
            run_tab = run['tabId']
            assert panel.locator('#connection').evaluate('node=>node.classList.contains("connected")'), 'light should be green for the bound conversation'
            checks.append('Bound conversation: header light is green')

            other = context.new_page()
            other.route('https://chatgpt.com/**', lambda route: route.fulfill(status=200, content_type='text/html', body=HTML))
            other.goto('https://chatgpt.com/')
            other.bring_to_front()
            panel.wait_for_timeout(900)
            assert panel.locator('#connection').evaluate('node=>node.classList.contains("connected")'), 'switching tabs must not drop the bound target'
            assert panel.evaluate('()=>Number(document.getElementById("target").value)') == run_tab, 'target selector must stay on the bound tab'
            checks.append('Switching to another tab keeps the bound target and stays green')

            target.bring_to_front()
            target.goto('https://chatgpt.com/')
            panel.wait_for_timeout(1200)
            assert not panel.locator('#connection').evaluate('node=>node.classList.contains("connected")'), 'light must go off after the conversation disappears'
            before = worker.evaluate('async()=>(await chrome.storage.local.get("pfRun")).pfRun.index')
            panel.locator('#resume').click()
            panel.wait_for_timeout(600)
            notice = panel.locator('#notice').inner_text()
            assert '原对话' in notice or '对话锁定' in notice or 'TARGET' in notice, notice
            assert worker.evaluate('async()=>(await chrome.storage.local.get("pfRun")).pfRun.status') == 'paused'
            assert worker.evaluate('async()=>(await chrome.storage.local.get("pfRun")).pfRun.index') == before
            checks.append('Conversation deleted in the site: light off, resume refused, no step advanced')

            logs_before = worker.evaluate('async()=>(await chrome.storage.local.get("pfRun")).pfRun.logs.length')
            target.close()
            panel.wait_for_timeout(900)
            assert not panel.locator('#connection').evaluate('node=>node.classList.contains("connected")'), 'light must go off after the tab is closed'
            diagnostics = panel.evaluate('async()=>await chrome.runtime.sendMessage({type:"PF_DIAGNOSTIC"})')
            assert diagnostics['ok'] and diagnostics['diagnostic']['dom'] == 'unavailable', diagnostics
            assert str(run_tab) in str(diagnostics['diagnostic']['tab']['id'])
            assert diagnostics['diagnostic']['snapshotError'].startswith('TARGET_TAB_CLOSED'), diagnostics['diagnostic']
            assert worker.evaluate('async()=>(await chrome.storage.local.get("pfRun")).pfRun.logs.length') >= logs_before
            panel.evaluate('()=>{window.__copied="";navigator.clipboard.writeText=async text=>{window.__copied=String(text)};}')
            panel.locator('#copy-logs').click()
            panel.wait_for_timeout(600)
            copied = panel.evaluate('()=>window.__copied')
            assert 'Diagnostics' in copied and 'TARGET_TAB_CLOSED' in copied, copied[:400]
            checks.append('Tab closed: light off, diagnostics copyable with snapshot unavailable and the original error')

            reopened = context.new_page()
            reopened.route('https://chatgpt.com/**', lambda route: route.fulfill(status=200, content_type='text/html', body=HTML))
            reopened.goto(URL)
            reopened.bring_to_front()
            deadline = time.monotonic() + 8
            connected = False
            while time.monotonic() < deadline:
                connected = panel.locator('#connection').evaluate('node=>node.classList.contains("connected")')
                if connected:
                    break
                panel.wait_for_timeout(150)
            assert connected, 'reopening the bound conversation should restore the green light'
            reopen_id = worker.evaluate("""async()=>{const tabs=await chrome.tabs.query({});return tabs.find(tab=>tab.url==='%s').id}""" % URL)
            assert panel.evaluate('()=>Number(document.getElementById("target").value)') == reopen_id
            checks.append('Reopening the same conversation: light back on and target follows the new tab')
        finally:
            context.close()

(OUT / 'connection-state-report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
print(json.dumps(report, indent=2, ensure_ascii=False))
