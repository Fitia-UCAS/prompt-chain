"""Basic four-step flow per provider, driven through the loaded extension UI.

Steps: short text -> Markdown -> PNG -> final text. Attachments are generated for
this run with a unique marker, and the synthetic page answers with that marker.
Verification reads the page DOM directly (user/assistant turns, attachment names)
instead of trusting extension logs or the production reader alone.

Entry point is the workflow page Run button. The flow is created through extension
storage, not the import UI; this is reported as such.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import argparse
import base64
import json
import os
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT.parent / '.cache' / 'prompt-flow'
EDGE = next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=')

HTML = '''<!doctype html><meta charset="utf-8"><style>button,[role=button]{min-width:40px;min-height:30px;display:inline-block}textarea,[contenteditable=true]{width:400px;min-height:40px}uploader-file-preview,gem-attachment{display:block}</style><main></main><input-area-v2><form onsubmit="return false"><input type="file" multiple><div id="input" contenteditable="true" role="textbox"></div><button type="button" data-testid="send-button" aria-label="Send message">发送</button></form></input-area-v2><script>
window.sent=[];window.filesSeen=[];window.delivered=[];window.marker='marker-missing';
const provider=location.hostname.includes('chatgpt')?'chatgpt':location.hostname.includes('gemini')?'gemini':'deepseek';
const gem=provider==='gemini',form=document.querySelector('form'),main=document.querySelector('main');
if(provider==='deepseek'){const old=document.querySelector('#input'),input=document.createElement('textarea');input.id='input';input.placeholder='Message DeepSeek';old.replaceWith(input)}
const input=document.querySelector('#input'),text=()=>gem?input.innerText:(input.value===undefined?input.innerText:input.value);
document.querySelector('input[type=file]').onchange=event=>{for(const file of event.target.files){
 filesSeen.push({name:file.name,size:file.size,type:file.type});
 const node=document.createElement(gem?'uploader-file-preview':'div');node.className='attachment';
 if(provider==='chatgpt'){node.setAttribute('data-testid','attachment-preview')}
 const label='file-'+filesSeen.length;
 node.innerHTML='<div class="file-preview-container" aria-describedby="'+label+'"></div><span id="'+label+'">'+file.name+'</span><gem-attachment><span class="gem-attachment-text">'+file.name+'</span><span class="gem-attachment-extension-label">md</span></gem-attachment><button aria-label="Remove file '+file.name+'">移除</button>';
 form.append(node);
}};
document.querySelector('[data-testid=send-button]').onclick=()=>{
 const raw=text();const names=[...form.querySelectorAll('.attachment')].map(node=>node.querySelector('span').textContent);
 sent.push(raw);delivered.push({text:raw,names});if(provider==='deepseek')input.value='';else input.textContent='';
 const turn=document.createElement('article');turn.setAttribute('data-testid','conversation-turn-'+(sent.length*2-1));
 if(provider==='chatgpt'){
   const user=document.createElement('div');user.setAttribute('data-message-author-role','user');user.setAttribute('data-message-id','u'+sent.length);
   const body=document.createElement('div');body.className='whitespace-pre-wrap';body.textContent=[raw,...names].filter(Boolean).join('\\n');user.append(body);turn.append(user);
 }else if(gem){
   const user=document.createElement('user-query');user.dataset.messageId='q'+sent.length;const body=document.createElement('div');body.className='query-text';body.textContent=[raw,...names].filter(Boolean).join('\\n');user.append(body);turn.className='';turn.append(user);
 }else{
   const user=document.createElement('div');user.className='ds-message';user.setAttribute('data-virtual-list-item-key','q'+sent.length);
   const body=document.createElement('div');body.className='ds-collapsible-text';body.textContent=[raw,...names].filter(Boolean).join('\\n');user.append(body);turn.className='';turn.append(user);
 }
 main.append(turn);
 for(const node of form.querySelectorAll('.attachment'))node.remove();
 if(!/\\/(?:app|chat\\/s|a\\/chat\\/s|c)\\/[^/]+/.test(location.pathname))history.pushState({},'',provider==='chatgpt'?'/c/created-by-basic-flow':gem?'/app/created-by-basic-flow':'/a/chat/s/created-by-basic-flow');
 const stop=document.createElement('button');stop.setAttribute('aria-label','Stop response');form.append(stop);
 window.completeAnswer=()=>{stop.remove();
   const answer=document.createElement('article');answer.setAttribute('data-testid','conversation-turn-'+(sent.length*2));
   if(provider==='chatgpt'){
     answer.innerHTML='<div data-message-author-role="assistant" data-message-id="a'+sent.length+'"><div class="markdown">已读取标记 '+window.marker+' #'+sent.length+'</div></div>';
   }else if(gem){
     answer.innerHTML='<model-response><message-content><div class="markdown">已读取标记 '+window.marker+' #'+sent.length+'</div></message-content></model-response>';
   }else{
     answer.innerHTML='<div class="ds-message"><div class="ds-assistant-message-main-content"><div class="ds-markdown">已读取标记 '+window.marker+' #'+sent.length+'</div></div></div>';
   }
   main.append(answer);
 };
 setTimeout(window.completeAnswer,500);
};
</script>'''

parser = argparse.ArgumentParser()
parser.add_argument('--provider', required=True, choices=['chatgpt', 'gemini', 'deepseek'])
parser.add_argument('--out', default=str(DEFAULT_OUT))
parser.add_argument('--marker', default='')
parser.add_argument('--live', action='store_true')
parser.add_argument('--profile', default='')
parser.add_argument('--allow-send', action='store_true')
parser.add_argument('--max-messages', type=int, default=4)
args = parser.parse_args()
LIVE = args.live
if LIVE:
    if not args.profile:
        print('NEEDS_USER: pass --profile <dedicated edge profile prepared with verify.mjs setup>'); raise SystemExit(3)
    if not args.allow_send:
        print('NEEDS_USER: live sends require --allow-send and a dedicated test conversation'); raise SystemExit(3)
    if args.max_messages < 4:
        print('BLOCKED: live basic flow needs at least 4 messages'); raise SystemExit(4)
    default_profile = str(Path(os.environ.get('LOCALAPPDATA', '')) / 'Microsoft' / 'Edge' / 'User Data')
    if Path(args.profile).resolve() == Path(default_profile).resolve() or str(Path(args.profile).resolve()).lower().startswith(default_profile.lower() + os.sep):
        print('BLOCKED: refusing to use the everyday Edge profile; use a dedicated test profile'); raise SystemExit(4)
OUT = Path(args.out)
OUT.mkdir(parents=True, exist_ok=True)
MARKER = args.marker or ('PC-' + str(int(time.time() * 1000)))
MD_NAME = f'pc-{MARKER}-doc.md'
PNG_NAME = f'pc-{MARKER}-image.png'
START = {'chatgpt': 'https://chatgpt.com/c/basic-flow', 'gemini': 'https://gemini.google.com/app?dest=create', 'deepseek': 'https://chat.deepseek.com/'}[args.provider]
TEXT_ONE = f'请读取附件并回答标记 {MARKER}'
TEXT_TWO = f'最后确认标记 {MARKER}'

report = {'suite': 'basic-flow', 'provider': args.provider, 'marker': MARKER, 'live': bool(LIVE), 'profile': args.profile if LIVE else '', 'environment': ('loaded extension, dedicated live profile, real site' if LIVE else 'loaded extension, isolated Edge, synthetic page; not a live account'), 'entry': 'workflow page Run button; flow created via extension storage'}
try:
    with TemporaryDirectory(prefix=f'pc-basic-{args.provider}-', dir=str(OUT)) as temp_profile:
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(args.profile if LIVE else temp_profile, executable_path=str(EDGE), headless=not LIVE,
                args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
            try:
                worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
                base = '/'.join(worker.url.split('/')[:3]) + '/'
                target = context.new_page()
                if not LIVE:
                    target.route('https://**/*', lambda route: route.fulfill(status=200, content_type='text/html', body=HTML))
                target.goto(START)
                if LIVE:
                    deadline_ready = time.monotonic() + 30
                    ready = False
                    while time.monotonic() < deadline_ready:
                        ready = target.evaluate('()=>!!(globalThis.PromptFlowSupervisor&&PromptFlowSupervisor.composer&&PromptFlowSupervisor.composer())')
                        if ready:
                            break
                        target.wait_for_timeout(300)
                    if not ready:
                        target.screenshot(path=str(OUT / f'basic-{args.provider}-needs-user.png'), full_page=True)
                        report.update({'ok': False, 'status': 'NEEDS_USER', 'reason': 'composer not found; sign in to the dedicated profile or wait for the page'})
                        print('NEEDS_USER: sign in to the dedicated profile and rerun', flush=True)
                        (OUT / f'basic-{args.provider}-report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
                        raise SystemExit(3)
                else:
                    target.evaluate('marker=>{window.marker=marker}', MARKER)
                target.wait_for_timeout(700)
                flow = worker.evaluate("""async payload=>{
                  const md=await PromptFlowStore.saveFile(new File([payload.marker],payload.mdName,{type:'text/markdown'}));
                  const png=await PromptFlowStore.saveFile(new File([new Uint8Array(payload.png)],payload.pngName,{type:'image/png'}));
                  const flow=PromptFlowModel.flow({title:'Basic flow '+payload.provider,steps:[{text:payload.textOne},{attachment:md},{attachment:png},{text:payload.textTwo}]});
                  await PromptFlowStore.saveFlow(flow);return flow;
                }""", {'marker': MARKER, 'mdName': MD_NAME, 'pngName': PNG_NAME, 'png': list(PNG), 'provider': args.provider, 'textOne': TEXT_ONE, 'textTwo': TEXT_TWO})
                panel = context.new_page()
                panel.goto(base + 'workflow.html?flow=' + flow['id'])
                panel.locator('#target option').nth(1).wait_for(state='attached')
                panel.locator('#target').select_option(index=1)
                panel.locator('#run').click()

                deadline = time.monotonic() + 90
                run = None
                while time.monotonic() < deadline:
                    run = worker.evaluate('async()=>(await chrome.storage.local.get("pfRun")).pfRun')
                    if run and run['status'] in ('completed', 'paused', 'cancelled'):
                        break
                    panel.wait_for_timeout(150)

                page_check = target.evaluate("""()=>{
                  const provider=location.hostname.includes('chatgpt')?'chatgpt':location.hostname.includes('gemini')?'gemini':'deepseek';
                  const users=provider==='chatgpt'?[...document.querySelectorAll('[data-message-author-role=user]')]:provider==='gemini'?[...document.querySelectorAll('user-query')]:[...document.querySelectorAll('.ds-message')].filter(node=>node.querySelector('.ds-collapsible-text'));
                  const answers=provider==='chatgpt'?[...document.querySelectorAll('[data-message-author-role=assistant]')]:provider==='gemini'?[...document.querySelectorAll('model-response')]:[...document.querySelectorAll('.ds-assistant-message-main-content')];
                  return {users:users.map(node=>node.innerText),userCount:users.length,answers:answers.map(node=>node.innerText),lastAnswer:(answers.at(-1)?.innerText||''),sent:window.sent,delivered:window.delivered,filesSeen:window.filesSeen,marker:window.marker};
                }""")
                diagnostic = panel.evaluate('()=>chrome.runtime.sendMessage({type:"PF_DIAGNOSTIC"})')['diagnostic']
                report.update({
                    'status': run['status'] if run else None, 'reason': (run or {}).get('reason'),
                    'plannedSteps': 4, 'sends': len(page_check['sent']), 'userCount': page_check['userCount'],
                    'filesSeen': page_check['filesSeen'], 'delivered': page_check['delivered'],
                    'lastAnswer': page_check['lastAnswer'],
                    'markerInLastAnswer': MARKER in page_check['lastAnswer'],
                    'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S'),
                    'dom': diagnostic.get('dom'), 'lastAttachmentUpload': diagnostic.get('lastAttachmentUpload'),
                    'logs': [entry['text'] for entry in (run or {}).get('logs', [])],
                })
                ok = (run and run['status'] == 'completed' and page_check['userCount'] == 4
                      and (LIVE or (len(page_check['sent']) == 4 and [item['names'] for item in page_check['delivered']] == [[], [MD_NAME], [PNG_NAME], []] and MARKER in page_check['lastAnswer'])))
                if LIVE:
                    report['liveChecks'] = {'userCount': page_check['userCount'], 'lastAnswer': page_check['lastAnswer'][:400], 'markerInLastAnswer': MARKER in page_check['lastAnswer']}
                report['ok'] = bool(ok)
                if not ok:
                    target.screenshot(path=str(OUT / f'basic-{args.provider}-failure.png'), full_page=True)
                    panel.screenshot(path=str(OUT / f'basic-{args.provider}-panel.png'), full_page=True)
            finally:
                context.close()
except Exception as error:
    report.update({'ok': False, 'error': str(error)})
finally:
    (OUT / f'basic-{args.provider}-report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({key: report.get(key) for key in ('suite', 'provider', 'status', 'sends', 'userCount', 'markerInLastAnswer', 'ok', 'error') if key in report}, ensure_ascii=False), flush=True)

if not report.get('ok'):
    raise SystemExit(1)
