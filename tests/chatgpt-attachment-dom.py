"""Check the ChatGPT attachment identity scanner against DOM shapes the 0.5.9 rules could not see.

Each page runs the real shared/platforms.js, shared/model.js and content/supervisor-engine.js.
The scanner must report match / mismatch / unknown / none with the reason, not just a count.
"""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json
import threading
import sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / '.cache' / 'prompt-flow'
EDGE = next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
NAME = '02-anadiplosis-information-linkage.md'

def page(card, wrapper=False, extra=''):
    inner_card = '' if wrapper else card
    form = f'''<form data-chatgpt-composer onsubmit="return false">
      <input type="file" aria-label="Attach files" multiple>
      {inner_card}
      <div id="prompt-textarea" contenteditable="true" role="textbox" style="min-height:80px"></div>
      <button type="button" data-testid="send-button" aria-label="Send prompt">send</button>
    </form>'''
    body = f'<div id="composer-shell">{card}{form}</div>' if wrapper else form
    return f'''<!doctype html><html><head><meta charset="utf-8"></head><body>
<main><article data-testid="conversation-turn-1"><div data-message-author-role="assistant"><div>旧回复</div></div></article></main>
{body}{extra}
<script src="/shared/platforms.js"></script><script src="/shared/model.js"></script>
<script>window.PromptChainMessages={{read:()=>({{messages:[]}})}};</script>
<script src="/content/supervisor-engine.js"></script>
</body></html>'''

CARDS = {
    # 名称被拆成两个块级节点，扩展名单独成行
    'split-block': ('<div class="attached" data-testid="attachment-preview"><div>02-anadiplosis-information-linkage</div><div>.md</div><button type="button" aria-label="Remove file">x</button></div>', 'match'),
    # 名称只在 title 属性里
    'attr-only': ('<div class="attached" data-testid="attachment-preview" title="02-anadiplosis-information-linkage.md"><span>Markdown</span><button type="button" aria-label="Remove file">x</button></div>', 'match'),
    # 文本节点是完整名，视觉上被 CSS 截断
    'css-truncate': ('<div class="attached" data-testid="attachment-preview"><span style="display:inline-block;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">02-anadiplosis-information-linkage.md</span><button type="button" aria-label="Remove file">x</button></div>', 'match'),
    # 字面省略号，名称与扩展名分开
    'ellipsis-split': ('<div class="attached" data-testid="attachment-preview"><span>02-anadiplosis-info…</span><span>.md</span><button type="button" aria-label="Remove file">x</button></div>', 'match'),
    # 站点为重复文件追加 (9)，仅在同词干同扩展名时可作为显示名
    'counter-name': ('<div class="attached" data-testid="attachment-preview"><span>02-anadiplosis-information-linkage(9).md</span><button type="button" aria-label="Remove file">x</button></div>', 'match'),
    'counter-name-wrong-extension': ('<div class="attached" data-testid="attachment-preview"><span>02-anadiplosis-information-linkage(9).txt</span><button type="button" aria-label="Remove file">x</button></div>', 'mismatch'),
    'counter-on-other-file': ('<div class="attached" data-testid="attachment-preview"><span>another-file(9).md</span><button type="button" aria-label="Remove file">x</button></div>', 'mismatch'),
    # 同词干但扩展名明确冲突
    'wrong-extension': ('<div class="attached" data-testid="attachment-preview"><span>02-anadiplosis-information-linkage</span><span>.txt</span><button type="button" aria-label="Remove file">x</button></div>', 'mismatch'),
    # 卡片内同时出现另一个文件名
    'two-names': ('<div class="attached" data-testid="attachment-preview"><span>02-anadiplosis-information-linkage.md</span><span>other-file.md</span><button type="button" aria-label="Remove file">x</button></div>', 'mismatch'),
    # 零宽字符
    'zero-width': ('<div class="attached" data-testid="attachment-preview"><span>02-anadiplosis\u200b-information-linkage.md</span><button type="button" aria-label="Remove file">x</button></div>', 'match'),
    # 完全无关的文件
    'unrelated': ('<div class="attached" data-testid="attachment-preview"><span>other-file.md</span><button type="button" aria-label="Remove file">x</button></div>', 'mismatch'),
    # 没有结构标记的普通文字
    'plain-text': ('<p>02-anadiplosis-information-linkage.md</p>', 'none'),
}

def serve(route, html):
    if route.request.resource_type == 'document':
        route.fulfill(status=200, content_type='text/html', body=html)
        return
    relative = route.request.url.split('chatgpt.com', 1)[-1].split('?')[0].lstrip('/')
    target = ROOT / relative
    if target.is_file():
        route.fulfill(status=200, content_type='application/javascript', body=target.read_bytes())
    else:
        route.fulfill(status=404, body='')


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
report = {'environment': 'headless Edge loading the extension content scripts; local DOM, not a live account', 'cases': {}}
probe = '''name => {
  const S = PromptFlowSupervisor, c = S.composer();
  if (!c) return {error: 'composer missing'};
  const scan = S.scanAttachment(c, {name, mimeType: 'text/markdown'});
  const legacy = root => [...root.querySelectorAll('span,div,a')].filter(node => {
    if (node.children.length || !S.rendered(node)) return false;
    const text = PromptFlowModel.echoNorm(node.textContent), prefix = text.replace(/(?:…|\\.{3})$/u, '').trim();
    return prefix !== text && prefix.length >= 12 && PromptFlowModel.echoNorm(name).startsWith(prefix);
  }).length;
  return {state: scan.state, strength: scan.strength, reason: scan.reason, kind: scan.kind,
    roots: scan.roots.map(entry => ({kind: entry.kind, seeds: entry.seeds, cards: entry.cards})),
    cards: scan.cards.map(entry => ({tag: entry.tag, testid: entry.testid, state: entry.state, reason: entry.reason, sources: entry.sources.map(source => source.source + ':' + source.verdict)})),
    legacyRule: scan.root ? legacy(scan.root) : null};
}'''
failed = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=str(EDGE), headless=True)
        for kind, (card_html, expected) in CARDS.items():
            for wrapper in (False, True):
                key = kind + ('-outside-form' if wrapper else '')
                page_obj = browser.new_page()
                page_obj.route('https://chatgpt.com/**', lambda route, _request, card_html=card_html, wrapper=wrapper: serve(route, page(card_html, wrapper)))
                page_obj.goto('https://chatgpt.com/c/matcher')
                result = page_obj.evaluate(probe, NAME)
                report['cases'][key] = result
                page_obj.close()
                if result.get('state') != expected:
                    failed.append((key, expected, result))
        page_obj = browser.new_page()
        page_obj.route('https://chatgpt.com/**', lambda route, _request: serve(route, page('', False, '<article><div data-message-author-role="user"><span>02-anadiplosis-information-linkage.md</span></div></article>')))
        page_obj.goto('https://chatgpt.com/c/matcher')
        result = page_obj.evaluate(probe, NAME)
        report['cases']['message-list'] = result
        page_obj.close()
        if result.get('state') != 'none':
            failed.append(('message-list', 'none', result))
        browser.close()
finally:
    server.shutdown()

(OUT / 'chatgpt-attachment-dom-report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
print(json.dumps(report, indent=2, ensure_ascii=False))
if failed:
    print('FAILED', [(key, expected, result.get('state'), result.get('reason')) for key, expected, result in failed], file=sys.stderr)
    raise SystemExit(1)
