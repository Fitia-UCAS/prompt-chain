"""Prepare a dedicated Edge profile for live verification (manual sign-in only).

Opens ChatGPT, Gemini and DeepSeek in a separate profile, waits for the operator to
sign in, then records a readiness marker. It never touches the everyday Edge profile,
never copies cookies and never fills login forms.
"""
from pathlib import Path
import argparse
import json
import os
import sys
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
EDGE = next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
SITES = ['https://chatgpt.com/', 'https://gemini.google.com/app', 'https://chat.deepseek.com/']

parser = argparse.ArgumentParser()
parser.add_argument('--profile', required=True)
parser.add_argument('--timeout', type=int, default=300)
args = parser.parse_args()

profile = Path(args.profile).expanduser().resolve()
default_profile = Path(os.environ.get('LOCALAPPDATA', '')) / 'Microsoft' / 'Edge' / 'User Data'
if str(profile).lower() == str(default_profile.resolve()).lower() or str(profile).lower().startswith(str(default_profile.resolve()).lower() + os.sep):
    print('BLOCKED: refusing to use the everyday Edge profile; pass a dedicated directory')
    raise SystemExit(4)
profile.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(str(profile), executable_path=str(EDGE), headless=False,
        args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
    try:
        pages = []
        for site in SITES:
            page = context.new_page()
            page.goto(site)
            pages.append(page)
        print('Sign in to ChatGPT, Gemini and DeepSeek in the opened Edge window.')
        print(f'Profile: {profile}')
        if sys.stdin.isatty():
            try:
                input('Press Enter when all three are signed in... ')
            except EOFError:
                time.sleep(5)
        else:
            time.sleep(min(args.timeout, 60))
        (profile / '.pc-setup.json').write_text(json.dumps({'preparedAt': time.strftime('%Y-%m-%dT%H:%M:%S'), 'sites': SITES}, ensure_ascii=False, indent=2), encoding='utf-8')
        print('PASS: profile marked as prepared')
    finally:
        context.close()
