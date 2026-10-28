"""Twenty-step mixed flow through the real extension side panel.

Steps alternate text and attachments: T1, A1, T2, A2, ... T10, A10.
The page renames every uploaded file by inserting `(9)` before the extension, and one
attachment's original name already carries `(2)`. The flow is paused once during the
fifth upload and resumed. Verifies planned vs delivered steps, selection counts,
ordering, duplicate prevention, final status and the persisted attachment diagnostic.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / '.cache' / 'prompt-flow'
EDGE = next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())

ATTACHMENTS = [
    '01-alpha.md', '02-beta.md', '03-gamma(2).md', '04-delta.md', '05-epsilon.md',
    '06-zeta.md', '07-eta.md', '08-theta.md', '09-iota.md', '10-kappa.md',
]
DISPLAYS = [name.replace('.md', '(9).md') for name in ATTACHMENTS]
TEXTS = [f'Text step {index}' for index in range(1, 11)]
STEPS = []
for index in range(10):
    STEPS.append({'text': TEXTS[index]})
    STEPS.append({'attachment': index})
assert len(STEPS) == 20
LAST_ATTACHMENT_STEP = 20
PAUSE_ATTACHMENT = 5

HTML = '''<!doctype html><html><head><meta charset="utf-8"></head><body><main id="thread"></main>
<form id="composer" onsubmit="return false">
<input id="files" type="file" aria-label="Attach files" multiple>
<div id="spinner" aria-busy="true" hidden>uploading</div>
<div id="cards"></div>
<div id="prompt-textarea" contenteditable="true" role="textbox" style="min-height:80px;border:1px solid;min-width:280px"></div>
<button type="button" data-testid="send-button" aria-label="Send prompt">send</button>
</form>
<script>
window.sendCount=0;window.filesSeen=[];window.delivered=[];window.cards=[];
const form=document.getElementById('composer'),editor=document.getElementById('prompt-textarea'),thread=document.getElementById('thread'),spinner=document.getElementById('spinner');
document.getElementById('files').addEventListener('change',event=>{
  const file=event.target.files[0];if(!file)return;
  window.filesSeen.push({name:file.name,size:file.size});
  const display=file.name.replace(/(\\.[^.]+)$/,'(9)$1');
  event.target.value='';
  spinner.hidden=false;
  setTimeout(()=>{
    spinner.hidden=true;
    setTimeout(()=>{
      const card=document.createElement('div');card.setAttribute('data-testid','attachment-preview');card.setAttribute('data-full',display);
      const name=document.createElement('span');name.textContent=display;
      const remove=document.createElement('button');remove.setAttribute('aria-label','Remove file');remove.textContent='x';
      card.append(name,remove);form.insertBefore(card,editor);window.cards=[card];
    },80);
  },400);
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

with TemporaryDirectory(prefix='pc-20-step-', dir=str(OUT)) as profile:
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(profile, executable_path=str(EDGE), headless=True,
            args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            base = '/'.join(worker.url.split('/')[:3]) + '/'
            target = context.new_page()
            target.route('https://chatgpt.com/**', lambda route: route.fulfill(status=200, content_type='text/html', body=HTML))
            target.goto('https://chatgpt.com/c/twenty-step')
            flow = worker.evaluate("""async(payload)=>{const refs=[];for(const name of payload.names)refs.push(await PromptFlowStore.saveFile(new File(['abc'],name,{type:'text/markdown'})));const steps=payload.steps.map(step=>('attachment' in step)?{attachment:refs[step.attachment]}:{text:step.text});const flow=PromptFlowModel.flow({title:'Twenty-step mixed flow',steps});await PromptFlowStore.saveFlow(flow);return flow}""", {'names': ATTACHMENTS, 'steps': STEPS})
            panel = context.new_page()
            panel.goto(base + 'workflow.html?flow=' + flow['id'])
            panel.locator('#target option').nth(1).wait_for(state='attached')
            panel.locator('#target').select_option(index=1)
            panel.locator('#run').click()

            deadline = time.monotonic() + 240
            run = None
            paused_once = False
            pause_step = None
            while time.monotonic() < deadline:
                run = worker.evaluate('async()=>(await chrome.storage.local.get("pfRun")).pfRun')
                if run and run['status'] == 'running' and run['phase'] == 'uploading' and not paused_once and target.evaluate('filesSeen.length') == PAUSE_ATTACHMENT:
                    panel.locator('#pause').click()
                    pause_deadline = time.monotonic() + 10
                    state = None
                    while time.monotonic() < pause_deadline:
                        state = worker.evaluate('async()=>{const run=(await chrome.storage.local.get("pfRun")).pfRun;const response=await chrome.tabs.sendMessage(run.tabId,{type:"PF_STATUS"});return {status:run.status,operation:response.snapshot.operation}}')
                        if state['status'] == 'paused' and not state['operation']:
                            break
                        panel.wait_for_timeout(100)
                    assert state['status'] == 'paused' and not state['operation'], state
                    paused_once = True
                    pause_step = run['step'] if 'step' in run else run['index'] + 1
                    panel.locator('#resume').click()
                    panel.wait_for_timeout(400)
                    continue
                if run and run['status'] in ('completed', 'paused', 'cancelled'):
                    break
                panel.wait_for_timeout(150)

            diagnostic = panel.evaluate('()=>chrome.runtime.sendMessage({type:"PF_DIAGNOSTIC"})')['diagnostic']
            upload = diagnostic.get('upload') or {}
            persisted = run.get('lastAttachmentUpload') or {}
            delivered = target.evaluate('window.delivered||[]')
            attachment_names = [name for item in delivered for name in item['names']]
            report = {
                'environment': 'loaded extension, isolated Edge, local page renaming uploads; not a live account',
                'status': run['status'], 'reason': run.get('reason'),
                'plannedSteps': len(flow['steps']), 'runIndex': run.get('index'),
                'sends': target.evaluate('sendCount'), 'selectionCount': target.evaluate('filesSeen.length'),
                'filesSeen': target.evaluate('filesSeen'),
                'attachmentNames': attachment_names,
                'uniqueAttachmentNames': len(set(attachment_names)),
                'expectedAttachmentNames': DISPLAYS,
                'pausedOnce': paused_once, 'pauseStep': pause_step,
                'uploadStep': (upload.get('operation') or {}).get('step'),
                'uploadMatchMode': upload.get('matchMode'),
                'persisted': {'operation': persisted.get('operation'), 'matchMode': persisted.get('matchMode'), 'alias': persisted.get('alias'), 'stage': persisted.get('stage'), 'persistedAt': persisted.get('persistedAt')},
                'logs': [entry['text'] for entry in run['logs']],
            }
            (OUT / 'chatgpt-20-step-report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
            print(json.dumps({key: report[key] for key in ('status', 'plannedSteps', 'runIndex', 'sends', 'selectionCount', 'uniqueAttachmentNames', 'pausedOnce', 'pauseStep', 'uploadStep', 'uploadMatchMode', 'persisted')}, indent=2, ensure_ascii=False), flush=True)

            assert run['status'] == 'completed', report
            assert report['sends'] == 20, report
            assert report['selectionCount'] == 10, report
            assert attachment_names == DISPLAYS, report
            assert len(set(attachment_names)) == 10, report
            assert paused_once, report
            assert report['persisted']['operation']['step'] == LAST_ATTACHMENT_STEP, report
            assert report['persisted']['matchMode'] == 'display-alias', report
            assert report['persisted']['alias'] == DISPLAYS[-1], report
            assert report['persisted']['operation']['runId'] == run['id'], report
        finally:
            context.close()
