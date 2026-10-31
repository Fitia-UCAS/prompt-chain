"""Regression for 2026-10-31: ChatGPT thinking UI must never be an answer.

Run: python tests/chatgpt-thinking-regression-smoke.py
Runs the real message reader/supervisor on a synthetic DOM reflecting the
uploaded diagnostic's user-only turn and hidden reasoning MarkdownRoot.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BROWSERS = [Path('/usr/bin/chromium'), Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')]
BROWSER = next(p for p in BROWSERS if p.exists())

HTML = '''<!doctype html><html><head><meta charset="utf-8"><style>
main{min-height:200px}button{width:70px;height:36px}form{margin-top:20px}
</style></head><body>
<main id="conversation">
  <div data-turn-key="old-turn">
    <h4 class="sr-only" data-conversation-role="user">你说：<span>You</span></h4>
    <div class="bg-user-message">这份文件只发一次。</div>
    <h4 class="sr-only" data-conversation-role="assistant">ChatGPT 说：<span>ChatGPT</span></h4>
    <div class="MarkdownRoot-answer"><p>已完整读取附件。</p></div>
    <div aria-hidden="true"><span class="min-w-0"><div class="MarkdownRoot-hidden">读取并逐行检查文件内容</div></span></div>
  </div>
  <div data-turn-key="new-turn">
    <h4 class="sr-only" data-conversation-role="user">你说：<span>You</span></h4>
    <div class="bg-user-message">这三份是并列的材料，请分别读完。</div>
    <div role="status">正在思考</div>
    <div class="MarkdownRoot-reasoning" data-testid="reasoning-in-progress">提炼共同字词</div>
    <div aria-hidden="true"><span class="min-w-0"><div class="MarkdownRoot-hidden">提炼共同字词</div></span></div>
    <button id="skip">跳过</button>
  </div>
</main>
<form data-chatgpt-composer><div contenteditable="true" role="textbox" style="width:200px;height:35px"></div>
<button id="stop" type="button" aria-label="停止">停止</button></form>
</body></html>'''

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=str(BROWSER), headless=True, args=['--no-sandbox'])
    page = browser.new_page()
    page.goto('about:blank')
    page.set_content(HTML)
    for src in ['shared/platforms.js', 'shared/model.js']:
        page.add_script_tag(path=str(ROOT / src))
    # This test uses an isolated offline page, but exercises ChatGPT's reader.
    page.evaluate("PromptFlowModel.platforms.providerFor=()=> 'chatgpt'")
    for src in ['content/message-reader.js', 'content/supervisor-engine.js']:
        page.add_script_tag(path=str(ROOT / src))
    snap = page.evaluate('PromptFlowSupervisor.snapshot()')
    assert snap['reader']['assistants'] == 1 and snap['reader']['users'] == 2, snap
    assert snap['lastRole'] == 'user' and snap['assistant']['text'] == '已完整读取附件。', snap
    assert snap['generating'], snap
    page.evaluate("document.querySelector('#stop').remove()")
    snap = page.evaluate('PromptFlowSupervisor.snapshot()')
    assert snap['generating'] and 'thinking-skip-control' in snap['generationSignals'], snap
    page.evaluate("document.querySelector('#skip').remove()")
    snap = page.evaluate('PromptFlowSupervisor.snapshot()')
    assert not snap['generating'] and snap['lastRole'] == 'user', snap
    # Some builds leave the thinking content visible and unmarked after final appears.
    page.evaluate("document.querySelector('[data-testid=reasoning-in-progress]').removeAttribute('data-testid')")
    page.evaluate('''() => {const turn=document.querySelector('[data-turn-key="new-turn"]');
      turn.insertAdjacentHTML('beforeend', '<h4 class="sr-only" data-conversation-role="assistant">ChatGPT 说：<span>ChatGPT</span></h4><div class="MarkdownRoot-final"><p>材料乙提到银杉。</p></div>');
    }''')
    snap = page.evaluate('PromptFlowSupervisor.snapshot()')
    assert snap['lastRole'] == 'assistant' and snap['assistant']['text'] == '材料乙提到银杉。', snap
    assert snap['reader']['assistants'] == 2 and snap['reader']['users'] == 2, snap
    assert '提炼共同字词' not in snap['assistant']['text'], snap
    print('PASS: hidden and live thinking excluded; wait while skip visible; final assistant answer read after it appears')
    browser.close()
