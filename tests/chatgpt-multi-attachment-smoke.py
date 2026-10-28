"""Five-step consecutive attachments with one pause/resume, plus persisted diagnostics.

Flow: text -> A -> B -> C -> text. Each upload is renamed by the page to `name(9).md`.
Pauses during step 3's upload. Verifies the run completes, the attachments are sent
once each and in order, and the last attachment diagnostic is actually persisted with
its runId/operationId/step and survives the target tab closing.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / '.cache' / 'prompt-flow'
EDGE = next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
NAMES = ['02-anadiplosis-information-linkage.md', '03-anadiplosis-information-linkage-examples.md', '06-anadiplosis-information-linkage-other-prompt.md']
DISPLAYS = [name.replace('.md', '(9).md') for name in NAMES]

HTML = '''<!doctype html><html><head><meta charset="utf-8"></head><body><main id="thread"></main>
<form id="composer" onsubmit="return false">
<input id="files" type="file" aria-label="Attach files" multiple>
<div id="spinner" aria-busy="true" hidden>uploading</div>
<div id="cards"></div>
<div id="prompt-textarea" contenteditable="true" role="textbox" style="min-height:80px;border:1px solid;min-width:280px"></div>
<button type="button" data-testid="send-button" aria-label="Send prompt">send</button>
</form>
<script>
window.sendCount=0;window.filesSeen=[];window.displayName='';window.cards=[];window.delivered=[];
const form=document.getElementById('composer'),editor=document.getElementById('prompt-textarea'),thread=document.getElementById('thread'),spinner=document.getElementById('spinner');
document.getElementById('files').addEventListener('change',event=>{
  const file=event.target.files[0];if(!file)return;
  window.filesSeen.push({name:file.name,size:file.size});
  const display=file.name.replace(/(\\.[^.]+)$/,'(9)$1');window.displayName=display;
  event.target.value='';
  spinner.hidden=false;
  setTimeout(()=>{
    spinner.hidden=true;
    setTimeout(()=>{
      const card=document.createElement('div');card.setAttribute('data-testid','attachment-preview');card.setAttribute('data-full',display);
      const name=document.createElement('span');name.textContent=display;
      const remove=document.createElement('button');remove.setAttribute('aria-label','Remove file');remove.textContent='x';
      card.append(name,remove);form.insertBefore(card,editor);window.cards=[card];
    },120);
  },700);
});
document.querySelector('[data-testid=send-button]').onclick=()=>{
  const text=editor.innerText.trim();const names=window.cards.map(card=>card.getAttribute('data-full'));
  window.sendCount++;window.delivered.push({text,names});
  const turn=document.createElement('article');turn.setAttribute('data-testid','conversation-turn-'+(window.sendCount*2));
  const user=document.createElement('div');user.setAttribute('data-message-author-role','user');user.setAttribute('data-message-id','u'+window.sendCount);
  const body=document.createElement('div');body.className='whitespace-pre-wrap';body.textContent=[text,...names].filter(Boolean).join('\\n');user.append(body);turn.append(user);thread.append(turn);
  for(const card of window.cards)card.remove();window.cards=[];editor.textContent='';
  const answer=document.createElement('article');answer.setAttribute('data-testid','conversation-turn-'+(window.sendCount*2+1));
  answer.innerHTML='<div data-message-author-role="assistant" data-message-id="a'+window.sendCount+'"><div class="markdown">已收到 '+window.sendCount+'</div></div>';thread.append(answer);
};
window.chrome={runtime:{onMessage:{addListener(){}},async sendMessage(message){if(message.type==='PF_FILE_CHUNK')return{ok:true,chunk:btoa('abc')};return{ok:true};}}};
</script></body></html>'''

with TemporaryDirectory(prefix='pc-multi-attachment-', dir=str(OUT)) as profile:
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(profile, executable_path=str(EDGE), headless=True,
            args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            base = '/'.join(worker.url.split('/')[:3]) + '/'
            target = context.new_page()
            target.route('https://chatgpt.com/**', lambda route: route.fulfill(status=200, content_type='text/html', body=HTML))
            target.goto('https://chatgpt.com/c/multi-attachment')
            flow = worker.evaluate("""async(names)=>{const refs=[];for(const name of names)refs.push(await PromptFlowStore.saveFile(new File(['abc'],name,{type:'text/markdown'})));const flow=PromptFlowModel.flow({title:'Five-step consecutive upload',steps:[{text:'First'},...refs.map(attachment=>({attachment})),{text:'Last'}]});await PromptFlowStore.saveFlow(flow);return flow}""", NAMES)
            panel = context.new_page()
            panel.goto(base + 'workflow.html?flow=' + flow['id'])
            panel.locator('#target option').nth(1).wait_for(state='attached')
            panel.locator('#target').select_option(index=1)
            panel.locator('#run').click()

            deadline = time.monotonic() + 90
            run = None
            paused_once = False
            paused_state = None
            while time.monotonic() < deadline:
                run = worker.evaluate('async()=>(await chrome.storage.local.get("pfRun")).pfRun')
                if run and run['status'] == 'running' and run['phase'] == 'uploading' and run['index'] == 2 and not paused_once and target.evaluate('filesSeen.length') == 2:
                    panel.locator('#pause').click()
                    pause_deadline = time.monotonic() + 8
                    state = None
                    while time.monotonic() < pause_deadline:
                        state = worker.evaluate('async()=>{const run=(await chrome.storage.local.get("pfRun")).pfRun;const response=await chrome.tabs.sendMessage(run.tabId,{type:"PF_STATUS"});return {status:run.status,operation:response.snapshot.operation}}')
                        if state['status'] == 'paused' and not state['operation']:
                            break
                        panel.wait_for_timeout(100)
                    assert state['status'] == 'paused' and not state['operation'], state
                    paused_once = True
                    paused_state = worker.evaluate('async()=>(await chrome.storage.local.get("pfRun")).pfRun')
                    panel.locator('#resume').click()
                    panel.wait_for_timeout(400)
                    continue
                if run and run['status'] in ('completed', 'paused', 'cancelled'):
                    break
                panel.wait_for_timeout(150)

            diagnostic = panel.evaluate('()=>chrome.runtime.sendMessage({type:"PF_DIAGNOSTIC"})')['diagnostic']
            upload = diagnostic.get('upload') or {}
            persisted = run.get('lastAttachmentUpload') or {}
            report = {
                'environment': 'loaded extension, isolated Edge, local page renaming uploads; not a live account',
                'status': run['status'], 'reason': run.get('reason'), 'pausedOnce': paused_once,
                'pausedDuringStep': ((paused_state or {}).get('index', -1) + 1) if paused_state else None,
                'plannedSteps': len(flow['steps']),
                'sends': target.evaluate('sendCount'), 'filesSeen': target.evaluate('filesSeen'),
                'delivered': target.evaluate('window.delivered||[]'),
                'uploadStep': (upload.get('operation') or {}).get('step'), 'uploadMatchMode': upload.get('matchMode'), 'uploadAlias': upload.get('alias'),
                'persisted': {'operation': persisted.get('operation'), 'matchMode': persisted.get('matchMode'), 'alias': persisted.get('alias'), 'stage': persisted.get('stage'), 'persistedAt': persisted.get('persistedAt')},
                'logs': [entry['text'] for entry in run['logs']],
            }

            logs_before = len(run['logs'])
            target.close()
            panel.wait_for_timeout(900)
            after = panel.evaluate('()=>chrome.runtime.sendMessage({type:"PF_DIAGNOSTIC"})')['diagnostic']
            panel.evaluate('()=>{window.__copied="";navigator.clipboard.writeText=async text=>{window.__copied=String(text)};}')
            panel.locator('#copy-logs').click()
            panel.wait_for_timeout(500)
            copied = panel.evaluate('()=>window.__copied')
            report['afterClose'] = {
                'dom': after.get('dom'),
                'snapshotError': after.get('snapshotError'),
                'persistedStep': (after.get('lastAttachmentUpload') or {}).get('operation', {}).get('step'),
                'persistedMatchMode': (after.get('lastAttachmentUpload') or {}).get('matchMode'),
                'copyHasPersisted': 'display-alias' in copied,
                'logsKept': len(worker.evaluate('async()=>(await chrome.storage.local.get("pfRun")).pfRun.logs')) >= logs_before,
            }
            (OUT / 'chatgpt-multi-attachment-report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
            print(json.dumps(report, indent=2, ensure_ascii=False), flush=True)

            assert run['status'] == 'completed', report
            assert report['sends'] == 5, report
            assert len(report['filesSeen']) == 3, report
            assert paused_once, report
            assert [item['names'] for item in report['delivered']] == [[], [DISPLAYS[0]], [DISPLAYS[1]], [DISPLAYS[2]], []], report
            assert report['uploadStep'] == 4 and report['uploadMatchMode'] == 'display-alias', report
            assert report['persisted']['operation']['step'] == 4, report
            assert report['persisted']['operation']['runId'] == run['id'], report
            assert report['persisted']['matchMode'] == 'display-alias', report
            assert report['persisted']['alias'] == DISPLAYS[2], report
            assert report['persisted']['stage'] in ('observing', 'ready'), report
            assert report['afterClose']['dom'] == 'unavailable', report
            assert report['afterClose']['snapshotError'].startswith('TARGET_TAB_CLOSED'), report
            assert report['afterClose']['persistedStep'] == 4, report
            assert report['afterClose']['persistedMatchMode'] == 'display-alias', report
            assert report['afterClose']['copyHasPersisted'], report
            assert report['afterClose']['logsKept'], report
        finally:
            context.close()
