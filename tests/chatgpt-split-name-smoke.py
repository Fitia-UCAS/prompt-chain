"""End-to-end repro of the 0.5.9 ChatGPT upload failure with a real extension load.

The composer card here is deliberately unlike the earlier fixtures:
  * the file name is split across two block nodes (stem + extension), no literal ellipsis
  * no aria-label/title carries the file name
  * the card is appended ~300ms after the page's busy signal clears, and busy lasts ~11s

0.5.9 fails this page twice over: its name rule never matches, and its 8s timeout is
measured from upload start, so it throws on the first sample after busy clears.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import time
import sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / '.cache' / 'prompt-flow'
EDGE = next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
NAME = '02-anadiplosis-information-linkage.md'
HTML = '''<!doctype html><html><head><meta charset="utf-8"></head><body><main id="thread"></main>
<form id="composer" onsubmit="return false">
<input id="files" type="file" aria-label="Attach files" multiple>
<div id="spinner" aria-busy="true" hidden>uploading</div>
<div id="prompt-textarea" contenteditable="true" role="textbox" style="min-height:80px;border:1px solid;min-width:280px"></div>
<button type="button" data-testid="send-button" aria-label="Send prompt">send</button>
</form>
<script>
window.sendCount=0;window.filesSeen=[];window.cards=[];
const form=document.getElementById('composer'),editor=document.getElementById('prompt-textarea'),thread=document.getElementById('thread'),spinner=document.getElementById('spinner');
document.getElementById('files').addEventListener('change',event=>{
  const file=event.target.files[0];if(!file)return;
  window.filesSeen.push({name:file.name,size:file.size});
  const parts=file.name.match(/^(.*)(\\.[^.]+)$/)||[file.name,file.name,''];
  event.target.value='';
  spinner.hidden=false;
  setTimeout(()=>{
    spinner.hidden=true;
    setTimeout(()=>{
      const card=document.createElement('div');card.setAttribute('data-testid','attachment-preview');card.setAttribute('data-full',file.name);
      const stem=document.createElement('div');stem.textContent=parts[1];
      const extension=document.createElement('div');extension.textContent=parts[2];
      card.append(stem,extension);form.insertBefore(card,editor);window.cards.push(card);
    },300);
  },11000);
});
document.querySelector('[data-testid=send-button]').onclick=()=>{
  const text=editor.innerText.trim();const names=window.cards.map(card=>card.getAttribute('data-full'));
  window.sendCount++;
  const turn=document.createElement('article');turn.setAttribute('data-testid','conversation-turn-'+(window.sendCount*2));
  const user=document.createElement('div');user.setAttribute('data-message-author-role','user');user.setAttribute('data-message-id','u'+window.sendCount);
  const body=document.createElement('div');body.className='whitespace-pre-wrap';body.textContent=[text,...names].filter(Boolean).join('\\n');user.append(body);turn.append(user);thread.append(turn);
  for(const card of window.cards)card.remove();window.cards=[];editor.textContent='';
  const answer=document.createElement('article');answer.setAttribute('data-testid','conversation-turn-'+(window.sendCount*2+1));
  answer.innerHTML='<div data-message-author-role="assistant" data-message-id="a'+window.sendCount+'"><div class="markdown">已收到 '+window.sendCount+'</div></div>';thread.append(answer);
};
window.chrome={runtime:{onMessage:{addListener(){}},async sendMessage(message){if(message.type==='PF_FILE_CHUNK')return{ok:true,chunk:btoa('abc')};return{ok:true}}}};
</script></body></html>'''

with TemporaryDirectory(prefix='pc-chatgpt-split-', dir=str(OUT)) as profile:
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(profile, executable_path=str(EDGE), headless=True,
            args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            base = '/'.join(worker.url.split('/')[:3]) + '/'
            target = context.new_page()
            target.route('https://chatgpt.com/**', lambda route: route.fulfill(status=200, content_type='text/html', body=HTML))
            target.goto('https://chatgpt.com/c/split-name')
            flow = worker.evaluate("""async()=>{const attachment=await PromptFlowStore.saveFile(new File(['abc'],'%s',{type:'text/markdown'}));const flow=PromptFlowModel.flow({title:'ChatGPT split-name upload',steps:[{text:'First'},{attachment},{text:'Last'}]});await PromptFlowStore.saveFlow(flow);return flow}""" % NAME)
            panel = context.new_page()
            panel.goto(base + 'workflow.html?flow=' + flow['id'])
            panel.locator('#target option').nth(1).wait_for(state='attached')
            panel.locator('#target').select_option(index=1)
            panel.locator('#run').click()
            deadline = time.monotonic() + 60
            run = None
            while time.monotonic() < deadline:
                run = worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
                if run and run['status'] in ('completed', 'paused', 'cancelled'):
                    break
                panel.wait_for_timeout(200)
            if not run:
                print('notice:', panel.locator('#notice').inner_text(), flush=True)
                print('console:', panel.evaluate('()=>window.__errors||[]'), flush=True)
                raise SystemExit('flow did not start')
            diagnostic = panel.evaluate('()=>chrome.runtime.sendMessage({type:"PF_DIAGNOSTIC"})')['diagnostic']
            report = {'environment': 'loaded extension, isolated Edge with a local split-name composer; not a live account',
                      'status': run['status'], 'reason': run.get('reason'), 'sends': target.evaluate('sendCount'),
                      'filesSeen': target.evaluate('filesSeen'), 'upload': diagnostic.get('upload'),
                      'logs': [entry['text'] for entry in run['logs']]}
            (OUT / 'chatgpt-split-name-report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
            print(json.dumps(report, indent=2, ensure_ascii=False), flush=True)
            assert run['status'] == 'completed', report
            assert target.evaluate('sendCount') == 3, report
            assert len(target.evaluate('filesSeen')) == 1, report
        finally:
            context.close()
