"""The built-in self-test chain ships with the extension.

Opening the side panel on a fresh profile must seed one chain that covers a plain
prompt, a single attachment, three attachments and a two-file comparison, with the
real .md fixtures kept in tests/fixtures/self-test. Reopening must not duplicate it.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import json
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
OUT.mkdir(parents=True,exist_ok=True)
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
FIXTURES=ROOT/'tests'/'fixtures'/'self-test'
CHAIN='内置自检 · 提示词与附件'

report={'suite':'self-test-chain','entry':'extension side panel','environment':'loaded extension in isolated Edge, fresh profile'}
with TemporaryDirectory(prefix='pc-selftest-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
  try:
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker',timeout=15000)
   base='/'.join(worker.url.split('/')[:3])+'/'
   page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
   page.goto(base+'sidepanel.html')
   page.wait_for_timeout(2000)
   page.get_by_text(CHAIN,exact=False).first.wait_for(timeout=10000)
   read='''async()=>{
     const stored=(await chrome.storage.local.get(['langqueue_chains','pcSelfTestSeeded']));
     const chains=(stored.langqueue_chains||{}).items||[];
     const chain=chains.find(item=>item.id==='selftest-reading-check');
     const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('langqueue_attachments',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
     const ids=(chain?chain.steps:[]).flatMap(step=>(step.attachments||[]).map(ref=>ref.id));
     const saved=await new Promise((resolve,reject)=>{const tx=db.transaction('attachments','readonly');const request=tx.objectStore('attachments').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
     db.close();
     return {seeded:stored.pcSelfTestSeeded,chains:chains.length,
       chain:chain?{title:chain.title,steps:chain.steps.map(step=>({text:(step.content||'').slice(0,20),files:(step.attachments||[]).map(ref=>ref.name)}))}:null,
       savedFiles:saved.map(file=>file.name),savedIds:saved.map(file=>file.id),refIds:ids};
   }'''
   first=page.evaluate(read)
   chain=first['chain']
   assert chain,first
   assert chain['title']==CHAIN,chain
   assert len(chain['steps'])==6,[step['files'] for step in chain['steps']]
   files=[step['files'] for step in chain['steps']]
   assert files[0]==[] and files[1]==['01-阅读范围.md'],files
   assert files[2]==['02-甲-清单.md','03-乙-清单.md','04-丙-清单.md'],files
   assert files[3]==['05-对照-规范.md','06-对照-旧稿.md'],files
   assert files[4]==[] and files[5]==[],files
   assert sorted(first['savedFiles'])==sorted(['01-阅读范围.md','02-甲-清单.md','03-乙-清单.md','04-丙-清单.md','05-对照-规范.md','06-对照-旧稿.md']),first['savedFiles']
   assert sorted(first['savedIds'])==sorted(first['refIds']),(first['savedIds'],first['refIds'])
   page.reload();page.wait_for_timeout(1500)
   second=page.evaluate(read)
   assert second['seeded']==1,second
   assert second['chains']==1,second
   assert len(second['chain']['steps'])==6,second
   for name in ('01-阅读范围.md','06-对照-旧稿.md'):
    assert (FIXTURES/name).is_file(),name
   assert not errors,errors
   report.update({'ok':True,'checks':['fresh profile seeds 6 steps: text / 1 file / 3 files / 2 files / text / text','attachments are written to langqueue_attachments by reference','reopening keeps one chain and does not re-seed'],'files':first['savedFiles']})
  finally:
   context.close()
(OUT/'self-test-chain-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
