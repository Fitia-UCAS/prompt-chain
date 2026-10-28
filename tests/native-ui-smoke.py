from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
import threading,json
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'.cache'/'prompt-flow'
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
MOCK=r'''(()=>{
const values={langqueue_prompts:{meta:{schemaVersion:3,createdAt:Date.now(),updatedAt:Date.now()},promptsById:{}},langqueue_chains:{version:2,updatedAt:Date.now(),items:[]}},events=new Set(),messages=new Set();
const clone=v=>v===undefined?undefined:structuredClone(v),event={addListener(){},removeListener(){}};
globalThis.__nativeValues=values;
const local={get(keys,callback){const result={};if(typeof keys==='string')keys=[keys];for(const key of keys||Object.keys(values))result[key]=clone(values[key]);callback?.(result);return Promise.resolve(result);},set(patch,callback){const changes={};for(const[key,value]of Object.entries(patch)){changes[key]={oldValue:clone(values[key]),newValue:clone(value)};values[key]=clone(value);}for(const fn of events)fn(changes,'local');callback?.();return Promise.resolve();},remove(keys,callback){for(const key of keys)delete values[key];callback?.();return Promise.resolve();}};
globalThis.chrome={storage:{local,onChanged:{addListener(fn){events.add(fn)},removeListener(fn){events.delete(fn)}}},runtime:{getURL:path=>location.origin+'/'+path,lastError:undefined,onMessage:{addListener(fn){messages.add(fn)},removeListener(fn){messages.delete(fn)}},sendMessage(message,callback){let result=message.type.startsWith('PC_')||message.type.startsWith('PF_')?{ok:true,count:0}:{ok:true,result:{}};callback?.(result);return Promise.resolve(result);}},tabs:{query(query,callback){const list=[{id:5,active:true,url:'https://chatgpt.com/c/native-fixture',title:'ChatGPT'}];callback?.(list);return Promise.resolve(list);},sendMessage(){return Promise.resolve({ok:true,result:{ready:true},snapshot:{url:'https://chatgpt.com/c/native-fixture',hasComposer:true}});},create(){return Promise.resolve({id:6})},onActivated:event,onUpdated:event},downloads:{download(options,callback){globalThis.__download=options;callback?.(1);}}};
})();'''
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
results=[]
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=str(EDGE),headless=True)
  context=browser.new_context(viewport={'width':460,'height':850},color_scheme='light')
  page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.add_init_script(MOCK)
  page.goto(f'http://127.0.0.1:{server.server_port}/sidepanel.html')
  page.get_by_text('还没有提示词',exact=True).wait_for()
  assert page.get_by_text('Prompt Chain',exact=True).count()==1
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=str(OUT/'prompt-chain-native-empty.png'))
  page.locator('.platform-status[data-pc-ready="true"]').wait_for()
  assert page.locator('.platform-status').inner_text()=='ChatGPT' or page.locator('.platform-status').inner_text()==''
  assert page.locator('.platform-status').evaluate('(el)=>[...el.children].filter(n=>getComputedStyle(n).display!=="none").length===1')
  assert page.locator('#pc-refresh').evaluate('(el)=>el.previousElementSibling.classList.contains("platform-status")&&el.nextElementSibling.getAttribute("aria-label")==="设置"')
  results.append('native layout: original structure, P logo, Chinese text, responsive sidebar')
  page.get_by_role('button',name='新建提示词',exact=True).last.click()
  dialog=page.get_by_role('dialog');dialog.get_by_label('名称',exact=True).fill('测试提示词');dialog.get_by_label('提示词',exact=True).fill('请保留我的原文。')
  dialog.get_by_role('button',name='保存',exact=True).click()
  page.wait_for_function('Object.keys(__nativeValues.langqueue_prompts.promptsById).length===1')
  results.append('prompt library: original create/save/edit controls')
  assert page.get_by_role('button',name='清除搜索',exact=True).count()==0
  page.get_by_role('combobox',name='排序',exact=True).select_option('alpha')
  page.get_by_role('textbox',name='搜索提示词',exact=True).fill('测试')
  page.get_by_role('button',name='清除搜索',exact=True).click()
  assert page.get_by_role('textbox',name='搜索提示词',exact=True).input_value()==''
  assert page.get_by_role('combobox',name='排序',exact=True).input_value()=='alpha'
  assert page.get_by_role('button',name='清除搜索',exact=True).count()==0
  results.append('search: clear appears inside a populated input and does not reset sort or prompts')
  page.wait_for_function('()=>document.querySelector(".popup-footer button svg path")?.getAttribute("d")==="M12 16V3m-4 4 4-4 4 4M4 16v5h16v-5"')
  page.get_by_role('button',name='设置',exact=True).click()
  page.get_by_text('导出提示词库',exact=True).wait_for()
  assert page.get_by_role('button',name='导入聊天记录',exact=True).count()==0
  assert page.get_by_text('同名记录将被更新。',exact=True).count()==0
  sizes=page.locator('.pc-settings-list .pc-control').evaluate_all('(els)=>els.map(el=>[el.getBoundingClientRect().width,el.getBoundingClientRect().height])')
  assert all(size==[32,32] for size in sizes),sizes
  heights=page.locator('.pc-setting-row').evaluate_all('(els)=>els.map(el=>el.getBoundingClientRect().height)')
  assert len(set(heights))==1,heights
  assert page.get_by_role('button',name='保存',exact=True).count()==0
  assert page.get_by_role('radio').count()==0
  assert page.get_by_role('switch').count()==0
  for name in ['附件','插入方式','发送时不自动滚动','包含附件原文件']:
   assert page.get_by_text(name,exact=True).count()==0
  assert page.locator('.pc-settings-list>.settings-panel').count()==2
  assert page.locator('.pc-settings-list>.settings-panel').first.locator('.pc-setting-row').count()==1
  assert page.get_by_role('button',name='导出',exact=True).locator('path').get_attribute('d').startswith('M12 16V3')
  page.screenshot(path=str(OUT/'prompt-chain-native-settings.png'))
  assert not errors,errors
  results.append('settings: only export and record tools; source imports live in sequence creation')
  for width,height in [(460,850),(380,620),(320,420)]:
   page.set_viewport_size({'width':width,'height':height})
   page.locator('.pc-settings-list').evaluate('(el)=>el.scrollTop=el.scrollHeight')
   last=page.get_by_role('button',name='最近删除',exact=True)
   bounds=last.bounding_box();scroll=page.locator('.pc-settings-list').bounding_box()
   assert bounds['y']+bounds['height']<=scroll['y']+scroll['height'],(width,height,bounds,scroll)
   assert last.evaluate('(el)=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
   assert scroll['y']+scroll['height']<=height+1
  page.screenshot(path=str(OUT/'prompt-chain-settings-small.png'))
  results.append('settings scrolling: no redundant Save footer; final action visible and clickable at three viewport sizes')
  page.set_viewport_size({'width':460,'height':850})
  page.get_by_role('button',name='返回',exact=True).click()
  page.get_by_role('button',name='新建流程',exact=True).click()
  page.wait_for_url('**/workflow.html?new=1')
  for label in ['导入聊天','导入 Skill','导入 Prompts','导入 Markdown']:
   button=page.get_by_role('button',name=label,exact=True);button.wait_for();assert button.locator('svg').count()==1
  sizes=page.locator('#creation-sources button').evaluate_all('(els)=>els.map(el=>[el.offsetWidth,el.offsetHeight])')
  assert len(set(map(tuple,sizes)))==1,sizes
  page.screenshot(path=str(OUT/'prompt-chain-create-imports.png'))
  assert not errors,errors
  results.append('new sequence: four equally sized icon-and-text import controls, unified step editor')
  browser.close()
finally:server.shutdown()
(OUT/'native-ui-report.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False,indent=2))
