"""Attachment identity regressions on the real content scripts.

Each case runs the actual shared/model.js, content/supervisor-engine.js and
content/bridge.js in a local page with controlled RPC. Sending is observed by a
click counter; the probe cancels after the assertion window, so a trailing
OPERATION_CANCELLED is the probe cleanup, not a product failure.

Covered:
  * resume/reuse with a matching full-name card and no in-memory attempt
  * resume with an unreadable/truncated card (identity unknown, must not send)
  * explicit extension conflict both before and after the file selection
  * ambiguous cards, title-only names, zero-width characters, wrapper roots
  * ordinary page text that merely contains the file name
"""
from pathlib import Path
import json
import subprocess
import sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / '.cache' / 'prompt-flow'
EDGE = next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
NAME = '02-anadiplosis-information-linkage.md'

HTML = '''<html><body><main id="thread"></main><div id="shell"><form id="composer"><input id="files" type="file" multiple><div id="cards"></div><div id="prompt-textarea" contenteditable="true" style="width:300px;height:60px"></div><button type="button" data-testid="send-button">Send</button></form></div></body></html>'''
SETUP = """() => {
  window.sendCount=0;window.bridgeReceive=null;
  window.rpcCalls=[];
  window.chrome={runtime:{onMessage:{addListener(fn){window.bridgeReceive=fn;},removeListener(){}},async sendMessage(m){window.rpcCalls.push({type:m.type,displayName:m.displayName||'',fileId:m.fileId||''});if(m.type==='PF_FILE_CHUNK')return{ok:true,chunk:btoa('abc')};return{ok:true};}}};
  window.PromptChainMessages={version:8,read:()=>({messages:[]}),role:()=>'',texts:()=>[]};
  document.querySelector('button').onclick=()=>window.sendCount++;
}"""


def card(html):
    return f"""() => {{const node=document.createElement('div');node.dataset.testid='attachment-preview';node.innerHTML={json.dumps(html)};document.getElementById({json.dumps('cards')}).append(node);}}"""


CASES = {
    'reuse-full-name': {
        'card': '<span>02-anadiplosis-information-linkage.md</span><button aria-label="Remove file">x</button>',
        'reuse': True,
        'expect': {'sends': 1, 'identity': 'match', 'selection': 'unknown', 'error_prefix': None},
    },
    'reuse-truncated-unknown': {
        'card': '<div>02-anadiplosis-info…</div><button aria-label="Remove file">x</button>',
        'reuse': True,
        'expect': {'sends': 0, 'identity': 'unknown', 'selection': 'unknown', 'error_prefix': 'ATTACHMENT_IDENTITY_UNKNOWN'},
    },
    'reuse-wrong-extension': {
        'card': '<span>02-anadiplosis-information-linkage</span><span>.txt</span><button aria-label="Remove file">x</button>',
        'reuse': True,
        'expect': {'sends': 0, 'identity': 'mismatch', 'selection': 'unknown', 'error_prefix': 'ATTACHMENT_CONFLICT'},
    },
    'reuse-ambiguous-cards': {
        'card': '<div><span>02-anadiplosis-information-linkage.md</span><button aria-label="Remove file">x</button></div><div><span>other-file.md</span><button aria-label="Remove file">x</button></div>',
        'reuse': True,
        'expect': {'sends': 0, 'identity': 'mismatch', 'selection': 'unknown', 'error_prefix': 'ATTACHMENT_CONFLICT'},
    },
    'reuse-title-only': {
        'card': '<span title="02-anadiplosis-information-linkage.md">Markdown</span><button aria-label="Remove file">x</button>',
        'reuse': True,
        'expect': {'sends': 1, 'identity': 'match', 'selection': 'unknown', 'error_prefix': None},
    },
    'reuse-zero-width-name': {
        'card': '<span>02-anadiplosis\u200b-information-linkage.md</span><button aria-label="Remove file">x</button>',
        'reuse': True,
        'expect': {'sends': 1, 'identity': 'match', 'selection': 'unknown', 'error_prefix': None},
    },
    'wrong-extension-after-selection': {
        'card': None,
        'change_card': '<span>02-anadiplosis-information-linkage</span><span>.txt</span><button aria-label="Remove file">x</button>',
        'reuse': False,
        'expect': {'sends': 0, 'identity': 'mismatch', 'selection': 'confirmed', 'error_prefix': 'UPLOAD_ATTACHMENT_MISMATCH'},
    },
    'counter-rename-after-selection': {
        'card': None,
        'change_card': '<span aria-label="02-anadiplosis-information-linkage(9).md">02-anadiplosis-information-linkage(9).md</span><button aria-label="Remove file">x</button>',
        'reuse': False,
        'expect': {'sends': 1, 'identity': 'match', 'selection': 'confirmed', 'error_prefix': None, 'diag_step': 2, 'diag_id': 'identity-op', 'display_alias': '02-anadiplosis-information-linkage(9).md'},
        'followup_text': True,
    },
    'counter-rename-reuse-without-alias': {
        'card': '<span>02-anadiplosis-information-linkage(9).md</span><button aria-label="Remove file">x</button>',
        'reuse': True,
        'expect': {'sends': 0, 'identity': 'unknown', 'selection': 'unknown', 'error_prefix': 'ATTACHMENT_IDENTITY_UNKNOWN'},
    },
    'counter-rename-reuse-with-recorded-alias': {
        'card': '<span>02-anadiplosis-information-linkage(9).md</span><button aria-label="Remove file">x</button>',
        'reuse': True,
        'aliases': ['02-anadiplosis-information-linkage(9).md'],
        'expect': {'sends': 1, 'identity': 'match', 'selection': 'unknown', 'error_prefix': None},
    },
    'original-name-with-counter': {
        'name': 'report(9).md',
        'card': '<span>report(9).md</span><button aria-label="Remove file">x</button>',
        'reuse': True,
        'expect': {'sends': 1, 'identity': 'match', 'selection': 'unknown', 'error_prefix': None},
    },
    'distinct-short-name-reuse': {
        'card': '<span>02-anadiplosis.md</span><button aria-label="Remove file">x</button>',
        'reuse': True,
        'expect': {'sends': 0, 'identity': 'mismatch', 'selection': 'unknown', 'error_prefix': 'ATTACHMENT_CONFLICT'},
    },
    'plain-text-not-card': {
        'card': '<p id="not-a-card">02-anadiplosis-information-linkage.md</p>',
        'card_marker': False,
        'reuse': False,
        'wait': 9800,
        'expect': {'sends': 0, 'identity': 'none', 'selection': 'confirmed', 'error_prefix': 'UPLOAD_PREVIEW_NOT_RECOGNIZED'},
    },
}

report = {'environment': 'isolated Edge, local page, actual content scripts; not a live account', 'cases': {}}
failed = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=str(EDGE), headless=True)
        for label, spec in CASES.items():
            page = browser.new_page()
            page.route('https://chatgpt.com/**', lambda route: route.fulfill(status=200, content_type='text/html', body=HTML))
            page.goto('https://chatgpt.com/c/identity-fixture')
            page.evaluate(SETUP)
            for source in ['shared/platforms.js', 'shared/model.js', 'content/supervisor-engine.js', 'content/bridge.js']:
                page.add_script_tag(content=(ROOT / source).read_text(encoding='utf-8'))
            if spec.get('card'):
                page.evaluate(card(spec['card']))
                if spec.get('card_marker') is False:
                    page.evaluate("() => {document.querySelector('[data-testid=attachment-preview]').removeAttribute('data-testid');}")
            if spec.get('change_card'):
                page.evaluate(f"""() => {{
                  const make = () => {{const node=document.createElement('div');node.dataset.testid='attachment-preview';node.innerHTML={json.dumps(spec['change_card'])};document.getElementById('cards').append(node);}};
                  document.getElementById('files').addEventListener('change', make);
                }}""")
            page.evaluate("""payload => {window.bridgeReceive({type:'PF_SEND',operation:{id:'identity-op',runId:'identity-run',step:2,url:location.href,text:'',reuseAttachment:payload.reuse,attachmentAliases:payload.aliases,attachment:{id:'file1',name:payload.name,size:3,mimeType:'text/markdown'}}},{},r=>window.result=r)}""", {'reuse': spec['reuse'], 'aliases': spec.get('aliases', []), 'name': spec.get('name', NAME)})
            page.wait_for_timeout(spec.get('wait', 2400))
            if not page.evaluate('!!window.result'):
                page.evaluate("() => window.bridgeReceive({type:'PF_CANCEL'},{},()=>{})")
                page.wait_for_timeout(600)
            if spec.get('followup_text'):
                page.evaluate("() => window.bridgeReceive({type:'PF_SEND',operation:{id:'text-op',runId:'identity-run',step:3,url:location.href,text:'next'}},{},r=>window.result2=r)")
                page.wait_for_timeout(700)
                page.evaluate("() => window.bridgeReceive({type:'PF_CANCEL'},{},()=>{})")
                page.wait_for_timeout(300)
            observed = page.evaluate("() => ({sends:window.sendCount,result:window.result,upload:PromptChainFileUI.uploadDiagnostic(),attachReady:window.rpcCalls.filter(call=>call.type==='PF_ATTACHMENT_READY')})")
            upload = observed.get('upload') or {}
            identity = (upload.get('identity') or {}).get('state')
            selection = (upload.get('selection') or {}).get('state')
            error = (observed.get('result') or {}).get('error') or ''
            report['cases'][label] = {'sends': observed['sends'], 'error': error, 'identity': identity, 'selection': selection, 'upload': upload, 'attachReady': observed.get('attachReady')}
            expect = spec['expect']
            problems = []
            if observed['sends'] != expect['sends']:
                problems.append(f"sends {observed['sends']} != {expect['sends']}")
            if expect['error_prefix']:
                if not error.startswith(expect['error_prefix']):
                    problems.append(f"error {error!r} does not start with {expect['error_prefix']}")
            elif error and not error.startswith('OPERATION_CANCELLED'):
                problems.append(f"unexpected error {error!r}")
            if identity != expect['identity']:
                problems.append(f"identity {identity!r} != {expect['identity']!r}")
            if selection != expect['selection']:
                problems.append(f"selection {selection!r} != {expect['selection']!r}")
            if expect.get('display_alias'):
                sent=[call.get('displayName') for call in observed.get('attachReady') or []]
                if sent[-1]!=expect['display_alias']:
                    problems.append(f"PF_ATTACHMENT_READY displayName {sent!r} != {expect['display_alias']!r}")
            if expect.get('diag_step') is not None:
                operation=upload.get('operation') or {}
                if operation.get('step')!=expect['diag_step'] or operation.get('id')!=expect['diag_id']:
                    problems.append(f"diagnostic operation {operation!r} != step {expect['diag_step']}")
            if problems:
                failed.append((label, problems))
            page.close()
        browser.close()
finally:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'chatgpt-attachment-identity-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

for label, result in report['cases'].items():
    print(label, json.dumps({key: result[key] for key in ('sends', 'identity', 'selection', 'error')}, ensure_ascii=False))
if failed:
    print('FAILED', json.dumps(failed, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(1)
