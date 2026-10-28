from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import base64
import json
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / '.cache' / 'prompt-flow'
OUT.mkdir(parents=True, exist_ok=True)
EDGE = next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())

MOCK_CHROME = r'''(() => {
const values=JSON.parse(sessionStorage.getItem('pf-test-state')||'{}'), listeners=[],replyListeners=[];globalThis.__replyListeners=replyListeners;
const event={addListener(){}};
const copy=v=>v===undefined?undefined:structuredClone(v);
const local={
 async get(keys){if(typeof keys==='string')return{[keys]:copy(values[keys])};return copy(values);},
 async set(patch){const changes={};for(const[k,v]of Object.entries(patch)){changes[k]={oldValue:copy(values[k]),newValue:copy(v)};values[k]=copy(v);}sessionStorage.setItem('pf-test-state',JSON.stringify(values));for(const fn of listeners)fn(changes,'local');}
};
globalThis.__mockValues=values;
globalThis.chrome={storage:{local,onChanged:{addListener(fn){listeners.push(fn)}}},
 runtime:{onMessage:{addListener(fn){replyListeners.push(fn)}},async sendMessage(m){
  if(m.type==='PF_START'){const run={id:'run-test',flow:m.flow,tabId:4,tabTitle:'本地夹具',targetUrl:'https://chatgpt.com/c/local-test',status:'running',phase:'waiting',index:0,repeated:0,logs:[],lastReply:''};await local.set({pfRun:run});return{ok:true,run};}
  if(m.type==='PF_PAUSE'){await local.set({pfRun:{...values.pfRun,status:'paused',reason:'已手动暂停'}});return{ok:true};}
  if(m.type==='PF_STOP'){await local.set({pfRun:{...values.pfRun,status:'cancelled',reason:'已停止流程'}});return{ok:true};}
  if(m.type==='PF_DIAGNOSTIC')return{ok:true,diagnostic:{phase:values.pfRun.phase,generating:false}};
  return{ok:true};}},
 tabs:{async query(){await new Promise(resolve=>setTimeout(resolve,50));return[{id:4,active:true,title:'本地夹具',url:'https://chatgpt.com/c/local-test'}]},async sendMessage(){return{ok:true,snapshot:{hasComposer:true}}},async update(){},onActivated:event,onUpdated:event}
};
})();'''

HTML = '''<!doctype html><html><head><meta charset="utf-8"></head><body><main><article data-testid="conversation-turn-1"><div data-message-author-role="assistant" data-message-id="a1"><div class="markdown">旧回复</div></div></article></main>
<form data-chatgpt-composer onsubmit="return false"><input type="file" aria-label="Attach files"><div id="prompt-textarea" contenteditable="true" role="textbox" style="min-height:80px;border:1px solid"> </div><button type="button" data-testid="send-button" aria-label="Send prompt">发送</button></form>
<script>
window.sendCount=0;window.filesSeen=[];const form=document.querySelector('form'),editor=document.querySelector('#prompt-textarea');editor.textContent='';
document.querySelector('input[type=file]').addEventListener('change',event=>{for(const f of event.target.files){window.filesSeen.push({name:f.name,size:f.size});const node=document.createElement('div');node.className='attached';node.setAttribute('aria-busy','true');node.innerHTML='<span></span><button type="button">移除</button>';node.querySelector('span').textContent=f.name;node.querySelector('span').setAttribute('aria-label',f.name);node.querySelector('button').setAttribute('aria-label','Remove '+f.name);form.append(node);setTimeout(()=>node.removeAttribute('aria-busy'),300);}});
document.querySelector('[data-testid=send-button]').onclick=()=>{
window.sendCount++;const user=document.createElement('article');user.setAttribute('data-testid','conversation-turn-'+(window.sendCount*2));
const node=document.createElement('div');node.setAttribute('data-message-author-role','user');node.setAttribute('data-message-id','u'+window.sendCount);const text=document.createElement('div');text.className='whitespace-pre-wrap';text.textContent=editor.innerText;node.append(text);user.append(node);
for(const chip of form.querySelectorAll('.attached')){const name=document.createElement('span');name.textContent=chip.querySelector('span').textContent;user.append(name);chip.remove();}
document.querySelector('main').append(user);editor.textContent='';const answer=document.createElement('article');answer.setAttribute('data-testid','conversation-turn-'+(window.sendCount*2+1));answer.innerHTML='<div data-message-author-role="assistant" data-message-id="a'+(window.sendCount+1)+'"><div class="markdown">已收到</div></div>';document.querySelector('main').append(answer);
};
window.__listeners=[];window.chrome={runtime:{onMessage:{addListener(fn){window.__listeners.push(fn)}},async sendMessage(m){if(m.type==='PF_FILE_CHUNK')return{ok:true,chunk:btoa('abc')};return{ok:true}}}};
window.bridgeMessage=m=>new Promise(resolve=>{for(const fn of window.__listeners)fn(m,{},resolve)});
</script></body></html>'''

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
results = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=str(EDGE), headless=True)
        context = browser.new_context(viewport={'width':390,'height':850}, color_scheme='light')
        page = context.new_page()
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.add_init_script(MOCK_CHROME)
        page.goto(f'http://127.0.0.1:{server.server_port}/workflow.html?standalone=1')
        page.get_by_role('heading',name='还没有流程').wait_for()
        assert page.locator('#home').inner_text()=='Prompt Chain'
        assert page.locator('#home img').evaluate('(img)=>img.complete && img.naturalWidth===48')
        assert page.locator('#home').bounding_box()['height']<=40
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(OUT/'prompt-flow-empty.png'))
        results.append('empty UI: responsive and no horizontal overflow')
        markdown='# 测试开场\n\n---\n\n## User 1\n\n### Attachments\n\n- File · 设定.md · text/markdown\n\n请阅读附件\n\n---\n\n## ChatGPT 1\n\n读完了，不应重发\n\n---\n\n## User 2\n\n继续写正文\n\n---\n\n## ChatGPT 2\n\n好的\n'
        page.locator('#chat-file').set_input_files({'name':'test-export.md','mimeType':'text/markdown','buffer':markdown.encode()})
        page.locator('#editor-view').wait_for(state='visible')
        page.wait_for_function("document.querySelectorAll('#steps>.step').length===2")
        assert page.locator('#flow-description,#step-count,#delay,#batch-files,[data-action="duplicate"],[data-action="add-files"]').count()==0
        assert page.get_by_role('button',name='＋ 添加一步',exact=True).count()==1
        before=page.locator('#steps').bounding_box()['y']
        page.get_by_role('button',name='关闭提示',exact=True).click()
        assert abs(page.locator('#steps').bounding_box()['y']-before)<0.5
        page.evaluate("notice('已保存',true)")
        assert abs(page.locator('#steps').bounding_box()['y']-before)<0.5
        page.wait_for_function("document.querySelector('#notice').hidden",timeout=7000)
        assert abs(page.locator('#steps').bounding_box()['y']-before)<0.5
        page.evaluate("notice('请回到流程锁定的原对话')")
        page.wait_for_function("document.querySelector('#notice').hidden",timeout=7000)
        assert abs(page.locator('#steps').bounding_box()['y']-before)<0.5
        results.append('notifications: success and warning auto-dismiss; manual close and dismissal cause no layout shift')
        assert page.locator('.missing-files').is_visible()
        assert page.locator('#steps>.step').first.evaluate('(el)=>el.open')
        with page.expect_file_chooser() as chooser:
            page.get_by_role('button',name='替换附件',exact=True).click()
        chooser.value.set_files({'name':'设定.md','mimeType':'text/markdown','buffer':'# 人设\n测试'.encode()})
        page.wait_for_function("document.querySelector('#missing-files').hidden")
        text = page.locator('#steps .attachment').first.inner_text()
        assert 'KB' in text, repr(text)
        results.append('chat import: user turns only; missing attachment resolved into IndexedDB')
        page.locator('#steps>.step').last.locator('summary').first.click()
        page.get_by_role('button',name='删除本步').last.click()
        page.wait_for_function("document.querySelectorAll('#steps>.step').length===1")
        page.get_by_role('button',name='撤销',exact=True).click()
        page.wait_for_function("document.querySelectorAll('#steps>.step').length===2")
        page.get_by_role('button',name='复制本步',exact=True).first.click()
        page.wait_for_function("document.querySelectorAll('#steps>.step').length===3")
        for index in range(3):
            assert page.locator('.step-summary-text strong').nth(index).inner_text().startswith(f'第 {index+1} 步 ·')
        page.locator('#steps>.step').nth(1).locator('summary').first.click()
        page.locator('#steps>.step').nth(1).get_by_role('button',name='删除本步',exact=True).click()
        page.wait_for_function("document.querySelectorAll('#steps>.step').length===2")
        page.locator('#steps>.step').last.locator('summary').first.click()
        page.locator('#steps>.step').last.get_by_role('checkbox',name='启用本步').uncheck()
        assert 'skipped' in page.locator('#steps>.step').last.get_attribute('class')
        page.get_by_role('button',name='保存流程',exact=True).click()
        page.wait_for_function("Object.values(__mockValues.pfLibrary.flows)[0].steps[1].enabled===false")
        page.screenshot(path=str(OUT/'prompt-flow-editor.png'))
        results.append('step editor: delete, undo, skip and persistence')
        page.get_by_role('button',name='开始执行').click()
        page.locator('#monitor-view').wait_for(state='visible')
        page.wait_for_function("document.querySelector('#step-progress-count').textContent==='1 / 2'")
        assert page.locator('#run-strip').count()==0
        assert page.locator('#monitor-summary').count()==0
        headers=page.locator('#monitor-view .monitor-panel>summary')
        assert headers.count()==3
        assert len({header.bounding_box()['height'] for header in headers.all()})==1
        for name in ['step','reply','log']:
            panel=page.locator(f'#{name}-console')
            assert panel.evaluate('(el)=>el.open')
            assert panel.locator(':scope>summary>.panel-chevron').count()==1
            assert panel.locator(':scope>.panel-content').count()==1
        assert page.locator('.monitor-actions').count()==0
        assert page.locator('#step-tools button:visible').count()==2
        assert page.locator('#step-console>summary #pause svg').count()==1
        assert page.locator('#step-console>summary #stop svg').count()==1
        page.locator('#step-console>summary').click()
        assert not page.locator('#step-console').evaluate('(el)=>el.open')
        page.locator('#step-console>summary').click()
        page.locator('#reply-console>summary').click()
        assert not page.locator('#reply-console').evaluate('(el)=>el.open')
        page.locator('#reply-console>summary').click()
        assert page.locator('#reply-title').inner_text()=='ChatGPT'
        page.evaluate("()=>{for(const fn of __replyListeners)fn({type:'PF_REPLY_VIEW',view:{runId:'run-test',index:0,text:'本轮待核对的回答'}})}")
        assert page.locator('#last-reply').inner_text()=='本轮待核对的回答'
        page.evaluate("()=>{for(const fn of __replyListeners)fn({type:'PF_REPLY_VIEW',view:{runId:'another-run',index:0,text:'旧回答不能出现'}})}")
        assert page.locator('#last-reply').inner_text()=='本轮待核对的回答'
        page.evaluate("async()=>chrome.storage.local.set({pfRun:{...__mockValues.pfRun,targetUrl:'https://gemini.google.com/app/test',phase:'ready',lastReply:'旧版已读回答'}})")
        assert page.locator('#reply-title').inner_text()=='Gemini'
        assert page.locator('#last-reply').inner_text()=='本轮待核对的回答'
        page.evaluate("async()=>chrome.storage.local.set({pfRun:{...__mockValues.pfRun,targetUrl:'https://chatgpt.com/c/local-test',phase:'waiting'}})")
        results.append('verification panel: platform name, only current reply, rejects another run and retains one transient reply between steps')
        results.append('monitor panels: same header, body and collapse controls; no duplicate status card')
        visible=page.locator('#monitor-steps').evaluate('(el)=>{const box=el.getBoundingClientRect();return [...el.children].filter(row=>{const r=row.getBoundingClientRect();return Math.min(r.bottom,box.bottom)-Math.max(r.top,box.top)>3}).length}')
        assert visible==1,visible
        assert page.locator('#previous-progress,#next-progress').count()==0
        page.locator('#monitor-steps').evaluate('(el)=>el.scrollBy({top:44})')
        page.wait_for_function("document.querySelector('#monitor-steps').scrollTop>40")
        assert page.locator('#step-progress-count').inner_text()=='1 / 2'
        assert page.evaluate('__mockValues.pfRun.index')==0
        page.evaluate("async()=>chrome.storage.local.set({pfRun:{...__mockValues.pfRun,phase:'waiting'}})")
        page.wait_for_timeout(100)
        assert page.locator('#step-progress-count').inner_text()=='1 / 2'
        page.locator('#monitor-steps').evaluate('(el)=>el.scrollBy({top:-44})')
        page.wait_for_function("document.querySelector('#monitor-steps').scrollTop<1")
        page.evaluate("async()=>chrome.storage.local.set({pfRun:{...__mockValues.pfRun,index:1}})")
        page.wait_for_function("document.querySelector('#step-progress-count').textContent==='2 / 2'")
        page.goto(f'http://127.0.0.1:{server.server_port}/workflow.html?standalone=1&monitor=1')
        page.locator('#monitor-view').wait_for(state='visible')
        page.wait_for_function("document.querySelector('#step-progress-count').textContent==='2 / 2'")
        page.evaluate("async()=>chrome.storage.local.set({pfRun:{...__mockValues.pfRun,index:0}})")
        page.wait_for_function("document.querySelector('#step-progress-count').textContent==='1 / 2'")
        results.append('single progress view: one visible step, scroll browsing without arrow buttons, follows execution, no duplicate top strip')
        page.get_by_role('button',name='暂停',exact=True).click()
        page.get_by_role('button',name='恢复执行',exact=True).wait_for(state='visible')
        assert page.locator('#step-console').evaluate('(el)=>el.open')
        assert page.locator('#step-tools button:visible').count()==2
        assert not errors,errors
        results.append('monitor UI: pause and resume controls')
        assert page.locator('#log-console').evaluate('(el)=>el.open')
        assert page.locator('#log-count').count()==0
        page.evaluate("async()=>chrome.storage.local.set({pfRun:{...__mockValues.pfRun,logs:Array.from({length:60},(_,i)=>({at:i+1,text:'日志 '+i,tone:'info'}))}})")
        page.wait_for_function("document.querySelectorAll('#logs .log-row').length===60")
        console_height=page.locator('#log-console').bounding_box()['height']
        page.locator('#logs').evaluate('(el)=>el.scrollTop=120')
        anchor=page.locator('#logs').evaluate('(el)=>{const edge=el.getBoundingClientRect().top;const row=[...el.children].find(n=>n.getBoundingClientRect().bottom>edge);return{key:row.dataset.logKey,top:row.getBoundingClientRect().top}}')
        page.evaluate("async()=>chrome.storage.local.set({pfRun:{...__mockValues.pfRun,logs:[...__mockValues.pfRun.logs,{at:100,text:'新日志',tone:'info'}]}})")
        page.wait_for_function("document.querySelectorAll('#logs .log-row').length===61")
        assert page.locator('#log-console').bounding_box()['height']==console_height
        after=page.locator('#logs').evaluate('(el,key)=>[...el.children].find(n=>n.dataset.logKey===key).getBoundingClientRect().top',anchor['key'])
        assert abs(after-anchor['top'])<1,(after,anchor)
        page.evaluate("Object.defineProperty(navigator,'clipboard',{value:{async writeText(text){window.copiedLogs=text}},configurable:true})")
        page.get_by_role('button',name='复制执行日志',exact=True).click()
        page.wait_for_function("window.copiedLogs?.includes('新日志')&&window.copiedLogs?.includes('日志 0')")
        assert page.evaluate("copiedLogs.includes('Diagnostics')&&copiedLogs.includes('\"generating\": false')")
        assert page.locator('#log-console').evaluate('(el)=>el.open')
        assert page.evaluate("copiedLogs.indexOf('日志 0')<copiedLogs.indexOf('新日志')")
        page.screenshot(path=str(OUT/'prompt-chain-run-console.png'))
        page.locator('#log-console>summary').click()
        assert not page.locator('#log-console').evaluate('(el)=>el.open')
        results.append('run console: open by default, copy full chronological logs without toggling, bounded scroll preserves old entries')
        assert page.locator('#run-strip').count()==0
        page.locator('#stop').click()
        page.wait_for_function("!document.querySelector('#stop').hidden&&document.querySelector('#stop').disabled&&!document.querySelector('#resume').hidden")
        assert page.locator('.monitor-step.current').count()==0
        assert page.evaluate('__mockValues.pfRun.status')=='cancelled'
        page.reload()
        assert page.locator('#run-strip').count()==0
        assert page.evaluate('__mockValues.pfRun.flow.steps.length')==2
        results.append('stopped flow: no stale active progress or duplicated strip after reload; execution record remains')
        directory_page=context.new_page()
        directory_page.add_init_script(MOCK_CHROME)
        directory_page.goto(f'http://127.0.0.1:{server.server_port}/workflow.html?standalone=1')
        directory_page.get_by_role('heading',name='还没有流程').wait_for()
        directory_page.evaluate('''async()=>{
          const root=await navigator.storage.getDirectory(),folder=await root.getDirectoryHandle('prompts',{create:true});
          const handle=await folder.getFileHandle('设定.md',{create:true}),writer=await handle.createWritable();
          await writer.write('# 设定\\n目录中的文件');await writer.close();await PromptFlowStore.saveDirectory(folder);
        }''')
        directory_page.reload()
        directory_page.get_by_role('heading',name='还没有流程').wait_for()
        directory_page.locator('#chat-file').set_input_files({'name':'自动匹配.md','mimeType':'text/markdown','buffer':markdown.encode()})
        directory_page.locator('#editor-view').wait_for(state='visible')
        directory_page.wait_for_function("document.querySelectorAll('#steps>.step').length===2 && document.querySelector('#missing-files').hidden")
        assert directory_page.locator('#directory-name').inner_text()=='prompts'
        assert directory_page.evaluate('__mockValues.pfLibrary.flows[0].steps[0].attachment.name')=='设定.md'
        results.append('directory binding: handle persists in IndexedDB and next import auto-matches files')
        private_bundle=OUT/'如何让AI写出我想要的感觉.promptflow.json'
        if private_bundle.exists():
            preview=context.new_page()
            preview.add_init_script(MOCK_CHROME)
            preview.goto(f'http://127.0.0.1:{server.server_port}/workflow.html?standalone=1')
            preview.locator('#backup-file').set_input_files(str(private_bundle))
            preview.wait_for_function("document.querySelectorAll('#steps>.step').length===20",timeout=30000)
            assert preview.locator('#missing-files').is_hidden()
            assert preview.evaluate("__mockValues.pfLibrary.flows[0].steps.filter(s=>s.attachment).length")==14
            preview.screenshot(path=str(OUT/'prompt-flow-writing-chain.png'))
            preview.get_by_role('button',name='‹ 流程库',exact=True).click()
            preview.locator('#library-view').wait_for(state='visible')
            preview.screenshot(path=str(OUT/'prompt-flow-library.png'))
            results.append('private bundle: 20 ordered steps and 14 restored attachments')
            preview.locator('#search').fill('02-anadiplosis-information-linkage.md')
            assert preview.locator('#flow-list .flow-card').count()==1
            preview.locator('#search').fill('')
            preview.get_by_title('删除流程',exact=True).click()
            preview.wait_for_function("__mockValues.pfLibrary.flows.length===0")
            preview.get_by_role('button',name='撤销',exact=True).click()
            preview.wait_for_function("__mockValues.pfLibrary.flows.length===1")
            preview.get_by_title('删除流程',exact=True).click()
            preview.get_by_role('button',name='关闭提示',exact=True).click()
            preview.locator('#menu-toggle').click()
            preview.get_by_role('button',name='最近删除',exact=True).click()
            preview.locator('#trash-view').wait_for(state='visible')
            preview.get_by_role('button',name='恢复',exact=True).click()
            preview.wait_for_function("__mockValues.pfLibrary.flows.length===1 && __mockValues.pfTrash.length===0")
            preview.get_by_role('button',name='‹ 流程库',exact=True).click()
            preview.locator('#menu-toggle').click()
            with preview.expect_download() as download:
                preview.get_by_role('button',name='导出全部流程',exact=True).click()
            exported=json.loads(Path(download.value.path()).read_text(encoding='utf-8'))
            assert len(exported['flows'])==1 and len(exported['files'])==14
            results.append('flow management: body search, delete, undo, trash restore, full backup with 14 attachments')
        fixture=context.new_page()
        fixture.route('https://chatgpt.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML))
        fixture.goto('https://chatgpt.com/c/local-test')
        for file in ['vendor/marked/marked.min.js','shared/platforms.js','shared/model.js','content/message-reader.js','content/supervisor-engine.js','content/bridge.js']:
            fixture.add_script_tag(path=str(ROOT/file))
        operation={'id':'op1','runId':'r1','url':'https://chatgpt.com/c/local-test','text':'请阅读附件','attachment':{'id':'f1','name':'设定.md','size':3,'mimeType':'text/markdown'},'baselineUserKey':'','baselineAssistantKey':'m:a1'}
        result=fixture.evaluate('(operation)=>bridgeMessage({type:"PF_SEND",operation})',operation)
        assert result['ok'],result
        assert fixture.evaluate('sendCount')==1
        assert fixture.evaluate('filesSeen')==[{'name':'设定.md','size':3}]
        assert result['snapshot']['lastRole']=='assistant'
        results.append('bridge: real File/DataTransfer upload, one send, fast reply without stop button')
        operation.update(id='op2',baselineUserKey=result['snapshot']['lastUser']['key'],baselineAssistantKey=result['snapshot']['assistant']['key'])
        fixture.evaluate('(operation)=>{window.pendingResult=bridgeMessage({type:"PF_SEND",operation});}',operation)
        fixture.locator('form .attached').wait_for()
        fixture.evaluate('bridgeMessage({type:"PF_CANCEL"})')
        result=fixture.evaluate('pendingResult')
        assert not result['ok'] and not result['attempted'],result
        assert fixture.evaluate('sendCount')==1
        results.append('bridge: cancelling during upload prevents sending')
        browser.close()
finally:
    server.shutdown()
(OUT/'browser-test-report.json').write_text(json.dumps({'passed':results},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':results,'screenshots':str(OUT)},ensure_ascii=False,indent=2))
