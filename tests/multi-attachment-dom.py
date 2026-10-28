"""Cross-platform local Chromium DOM fixture for the real ChatGPT attachment-set scanner.
No remote account access or live message sends occur.
"""
from pathlib import Path
import json
import shutil
import sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
NAMES = [f'参考文件{i}.txt' for i in range(1, 6)]
EXE = next((str(p) for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists()), None) or shutil.which('chromium') or shutil.which('google-chrome')

def html(names):
    cards = ''.join(f'<div data-testid="attachment-preview" class="attach"><span>{name}</span><button aria-label="Remove file">x</button></div>' for name in names)
    return f'''<!doctype html><html><body><main><article>历史回答</article></main>
<div id="composer-shell"><form id="composer-form" data-chatgpt-composer onsubmit="return false">
<input type="file" multiple><div class="attachments">{cards}</div>
<div id="prompt-textarea" contenteditable="true" role="textbox"> </div>
<button data-testid="send-button" type="button" aria-label="Send">发送</button>
</form></div></body></html>'''


FIXTURES = {
    'five_names': (NAMES, 'match'),
    'missing_name': (NAMES[:2]+NAMES[3:], 'missing'),
    'extra_name': (NAMES+['外来的文件.txt'], 'conflict'),
    'duplicate_preview': (NAMES+[NAMES[1]], 'conflict'),
    'counter_alias': (NAMES[:1]+['参考文件2 (9).txt']+NAMES[2:], 'match'),
    'wrong_extension': (NAMES[:2]+['参考文件3.md']+NAMES[3:], 'conflict'),
}

results={}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=EXE,headless=True) if EXE else p.chromium.launch(headless=True)
    for label,(names,expected) in FIXTURES.items():
        page=browser.new_page()
        page.set_content(html(names))
        page.add_script_tag(content=(ROOT/'shared/platforms.js').read_text(encoding='utf-8'))
        page.add_script_tag(content=(ROOT/'shared/model.js').read_text(encoding='utf-8'))
        page.evaluate("window.PromptChainMessages={read:()=>({messages:[]})};PromptFlowModel.platforms.providerFor=()=> 'chatgpt'")
        page.add_script_tag(content=(ROOT/'content/supervisor-engine.js').read_text(encoding='utf-8'))
        result=page.evaluate('''names => {
          const refs=names.map((name,i)=>({id:'f'+i,name,size:3,mimeType:'text/plain'}));
          const scan=PromptFlowSupervisor.scanAttachmentSet(PromptFlowSupervisor.composer(),refs);
          return {state:scan.state,cardCount:scan.cardCount,extras:scan.extras,files:scan.files.map(item=>({name:item.name,state:item.state,alias:item.alias})),collisions:scan.collisions};
        }''',NAMES)
        results[label]={'expected':expected,'observed':result}
        page.close()
    browser.close()
failed=[name for name,row in results.items() if row['observed']['state']!=row['expected']]
print(json.dumps({'status':'PASS' if not failed else 'FAIL','cases':results},ensure_ascii=False,indent=2))
if failed:
    print('FAILED:',','.join(failed),file=sys.stderr)
    sys.exit(1)
