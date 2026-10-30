const {test, before} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname,'..');
const url='https://chatgpt.com/c/fixture';
let createBackground;
before(async () => {({createBackground} = await import('../background/runtime.mjs'));});
function harness(shared={},initial={}) {
  const events={},sends=[],deliveries=[];let now=10000;
  let snapshot={url,hasComposer:true,draft:'',generating:false,lastRole:'assistant',lastUser:{key:'old-u',text:'旧消息',filesText:''},assistant:{key:'old-a',text:'旧回答',signature:'old-a|旧回答'},documentId:'doc1',operation:null,...initial};
  const closedTabs=new Set(),extraTabs=[];
  const event=name=>({addListener(fn){events[name]=fn;}});
  const chrome={
    storage:{local:{async get(key){return{[key]:structuredClone(shared[key])}},async set(patch){Object.assign(shared,structuredClone(patch));}}},
    runtime:{onMessage:event('message'),onInstalled:event('installed'),getURL:p=>'chrome-extension://fixture/'+p},
    sidePanel:{async setPanelBehavior(){}},alarms:{onAlarm:event('alarm'),async create(){},async clear(){}},
    tabs:{onRemoved:event('removed'),onUpdated:event('updated'),async query(){return[{id:4,url:snapshot.url,title:'fixture',active:false},...extraTabs];},
      async get(id){if(closedTabs.has(id))throw new Error('No tab with id: '+id);return{id,url:snapshot.url,title:'fixture'}},
      async sendMessage(tabId,message){
        if(message.type==='PF_STATUS')return{ok:true,snapshot:structuredClone(snapshot)};
        if(message.type==='PF_CANCEL')return{ok:true};
        if(message.type==='PF_SEND'){sends.push(message.operation);return new Promise(resolve=>deliveries.push(resolve));}
      }},scripting:{async executeScript(){}}
  };
  class Clock extends Date {static now(){return now;}}
  const context=vm.createContext({console,chrome,crypto:globalThis.crypto,URL,Date:Clock,structuredClone,TextEncoder,TextDecoder,btoa,atob,setTimeout(){return 1;},clearTimeout(){}});
  context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(ROOT,file),'utf8'),context,{filename:file}));
  context.importScripts('vendor/marked/marked.min.js','shared/platforms.js','shared/model.js','shared/store.js');
  const background=createBackground({chrome,model:context.PromptFlowModel,store:context.PromptFlowStore,clock:Clock,timers:{setTimeout(){return 1;},clearTimeout(){}}});
  async function drain(){for(let i=0;i<4;i++){await background.scheduler.idle();await new Promise(resolve=>setImmediate(resolve));}}
  async function message(type,extra={},content=false){return new Promise(resolve=>events.message({type,...extra},content?{tab:{id:4},url}:{url:'chrome-extension://fixture/sidepanel.html'},resolve));}
  return {shared,sends,deliveries,drain,message,history:background.connection.historySnapshot,setSnapshot(next){snapshot={...snapshot,...next}},advance(ms){now+=ms},async beat(){await message('PF_HEARTBEAT',{},true);await drain();},
    closeTab(id){closedTabs.add(id);},openTab(tab){extraTabs.push(tab);}};
}

test('折叠后 DOM 停留在前一条文字，当前分支原文仍可确认新附件；未知插话和缺文件不能放行',async()=>{
  const h=harness();await h.drain();
  const before=[{key:'m:previous-user',role:'user',fingerprint:'previous'},{key:'m:previous-answer',role:'assistant',fingerprint:'answer'}];
  const operation={text:'',attachment:{name:'02-anadiplosis-information-linkage.md'},attachmentUploaded:true,attemptedAt:10000,baselineMessages:before};
  const dom={url,lastRole:'user',lastUser:{key:'dom:user:old:2',text:'你将依次收到四个文件。',variants:['你将依次收到四个文件。'],folded:true},messages:[],reader:{users:2,assistants:0}};
  const history={url,messages:[{id:'previous-user',role:'user',text:dom.lastUser.text,filesText:''},{id:'previous-answer',role:'assistant',text:'请上传文件',complete:true},{id:'new-user',role:'user',text:'',filesText:operation.attachment.name},{id:'new-answer',role:'assistant',text:'附件已完整阅读。',complete:true}]};
  const result=h.history(dom,history,operation);
  assert.equal(result.lastUser.key,'m:new-user');assert.equal(result.reader.domBehindHistory,true);assert.equal(result.assistant.text,'附件已完整阅读。');
  const unknown={...dom,lastUser:{...dom.lastUser,text:'这是手动插话',variants:['这是手动插话']}};
  assert.equal(h.history(unknown,history,operation).lastUser.key,dom.lastUser.key);
  const missing={...history,messages:history.messages.map(message=>message.id==='new-user'?{...message,filesText:'其他文件.md'}:message)};
  assert.equal(h.history(dom,missing,operation).lastUser.key,dom.lastUser.key);
  const extra={...history,messages:[...history.messages,{id:'another-user',role:'user',text:'其他消息',filesText:operation.attachment.name}]};
  assert.equal(h.history(dom,extra,operation).lastUser.key,dom.lastUser.key);
  assert.equal(h.history(dom,{...history,url:'https://chatgpt.com/c/other'},operation).lastUser.key,dom.lastUser.key);
  assert.equal(h.history(dom,history,null).lastUser.key,dom.lastUser.key);
});

async function deliveredNewChat() {
  const h=harness({}, {url:'https://chatgpt.com/',lastRole:'',lastUser:null,assistant:null,messages:[]});await h.drain();
  const started=await h.message('PF_START',{tabId:4,flow:{delaySeconds:0,steps:[{text:'消息一'},{text:'消息二'}]}});assert.equal(started.ok,true);await h.drain();
  const pending=h.shared.pfRun.pending;await h.message('PF_AUTHORIZE_SEND',{runId:pending.runId,operationId:pending.id},true);
  const snap={url:'https://chatgpt.com/',hasComposer:true,draft:'',generating:false,lastRole:'assistant',lastUser:{key:'u1',text:'消息一',filesText:''},assistant:{key:'a1',text:'新回答',signature:'a1|新回答'},messages:[{key:'u1',role:'user',fingerprint:'first-user'},{key:'a1',role:'assistant',fingerprint:'first-answer'}],documentId:'doc1',operation:null};
  h.setSnapshot(snap);h.deliveries[0]({ok:true,snapshot:snap});await h.drain();
  assert.equal(h.shared.pfRun.phase,'waiting');return{h,snap};
}

test('编辑器尚未就绪时只记一次等待并持续重试，就绪后自动开始',async()=>{
  const run={id:'ready-run',flow:{delaySeconds:0,steps:[{text:'消息一'}]},tabId:4,targetUrl:url,status:'running',phase:'ready',index:0,repeated:0,logs:[],reason:'',pending:null,allowNewChat:false};
  const h=harness({pfRun:run}, {hasComposer:false});await h.drain();
  assert.equal(h.sends.length,0);
  assert.equal(h.shared.pfRun.status,'running');
  await h.beat();await h.beat();
  assert.equal(h.sends.length,0);
  assert.equal(h.shared.pfRun.logs.filter(item=>item.text.startsWith('Waiting: the composer')).length,1);
  h.setSnapshot({hasComposer:true});await h.beat();await h.drain();
  assert.equal(h.sends.length,1);
  assert.equal(h.sends[0].text,'消息一');
  assert.ok(h.shared.pfRun.logs.some(item=>item.text==='Preparing step 1/1'));
});

test('清空日志只允许侧栏，不修改运行位置或发送意图',async()=>{
 const {h}=await deliveredNewChat(),before=structuredClone(h.shared.pfRun);
 assert.equal((await h.message('PF_CLEAR_LOGS',{},true)).ok,false);
 assert.equal((await h.message('PF_CLEAR_LOGS')).ok,true);
 const after=structuredClone(h.shared.pfRun);delete before.logs;delete after.logs;delete before.updatedAt;delete after.updatedAt;
 assert.deepEqual(after,before);assert.deepEqual(h.shared.pfRun.logs,[]);
});

test('只临时保留一份验证回答，下一回答到来前不闪空；不持久保存，旧版 lastReply 自动移除',async()=>{
  const {h}=await deliveredNewChat();h.shared.pfRun.lastReply='旧版已读回答';await h.beat();
  const current=await h.message('PF_CURRENT_REPLY');assert.equal(current.ok,true);assert.equal(current.view.text,'新回答');
  assert.equal(Object.hasOwn(h.shared.pfRun,'lastReply'),false);
  assert.equal((await h.message('PF_CURRENT_REPLY',{},true)).ok,false);
  h.advance(5000);await h.beat();
  const next=await h.message('PF_CURRENT_REPLY');assert.equal(next.view.text,'新回答');assert.equal(next.view.index,0);
  assert.equal(Object.hasOwn(h.shared.pfRun,'lastReply'),false);
  await h.message('PF_STOP');assert.equal((await h.message('PF_CURRENT_REPLY')).view.text,'');
});

test('新聊天先确认送达、随后生成正式网址，继续等待并执行下一步，只绑定一次',async()=>{
  const {h}=await deliveredNewChat();
  h.setSnapshot({url});await h.beat();
  assert.equal(h.shared.pfRun.status,'running');assert.equal(h.shared.pfRun.targetUrl,url);assert.equal(h.shared.pfRun.allowNewChat,false);assert.equal(h.sends.length,1);
  h.advance(5000);await h.beat();assert.equal(h.shared.pfRun.index,1);
  await h.beat();assert.equal(h.sends.length,2);assert.equal(h.sends[1].url,url);
  h.setSnapshot({url:'https://chatgpt.com/c/other'});await h.beat();assert.equal(h.shared.pfRun.status,'paused');assert.equal(h.sends.length,2);
});

test('项目页发起：确认送达后升级到带项目名后缀的对话地址，不暂停',async()=>{
  const project='https://chatgpt.com/g/g-p-6ac6367e6468819195855069f223562b/project';
  const conversation='https://chatgpt.com/g/g-p-6ac6367e6468819195855069f223562b-webnovel/c/6ae4de92-2a00-83e9-a0a7-887adb60d455';
  const h=harness({}, {url:project});await h.drain();
  const started=await h.message('PF_START',{tabId:4,flow:{delaySeconds:0,steps:[{text:'消息一'},{text:'消息二'}]}});
  assert.equal(started.ok,true);await h.drain();
  assert.equal(h.shared.pfRun.targetUrl,project);
  const pending=h.shared.pfRun.pending;
  await h.message('PF_AUTHORIZE_SEND',{runId:pending.runId,operationId:pending.id},true);
  const snap={url:conversation,hasComposer:true,draft:'',generating:false,lastRole:'assistant',lastUser:{key:'u1',text:'消息一',filesText:''},assistant:{key:'a1',text:'新回答',signature:'a1|新回答'},messages:[{key:'u1',role:'user',fingerprint:'first-user'},{key:'a1',role:'assistant',fingerprint:'first-answer'}],documentId:'doc1',operation:null};
  h.setSnapshot(snap);h.deliveries[0]({ok:true,snapshot:snap});await h.drain();
  assert.equal(h.shared.pfRun.status,'running');
  assert.equal(h.shared.pfRun.phase,'waiting');
  assert.equal(h.shared.pfRun.targetUrl,conversation);
  await h.beat();
  h.advance(5000);await h.beat();
  assert.equal(h.shared.pfRun.index,1,JSON.stringify({status:h.shared.pfRun.status,phase:h.shared.pfRun.phase,reason:h.shared.pfRun.reason,target:h.shared.pfRun.targetUrl}));
  await h.beat();assert.equal(h.sends.length,2);assert.equal(h.sends[1].url,conversation);
});

test('项目页发送后网址变成带项目名后缀的对话：恢复时接续该对话且不重发',async()=>{
  const project='https://chatgpt.com/g/g-p-6ac6367e6468819195855069f223562b/project';
  const conversation='https://chatgpt.com/g/g-p-6ac6367e6468819195855069f223562b-webnovel/c/6ae4de92-2a00-83e9-a0a7-887adb60d455';
  const h=harness({}, {url:project});await h.drain();
  await h.message('PF_START',{tabId:4,flow:{delaySeconds:0,steps:[{text:'消息一'},{text:'消息二'}]}});await h.drain();
  const pending=h.shared.pfRun.pending;
  await h.message('PF_AUTHORIZE_SEND',{runId:pending.runId,operationId:pending.id},true);
  // Reproduce the paused state an older build left behind: message delivered,
  // target still the project page.
  h.shared.pfRun.status='paused';h.shared.pfRun.reason='目标页已离开锁定对话';
  const snap={url:conversation,hasComposer:true,draft:'',generating:false,lastRole:'assistant',lastUser:{key:'u1',text:'消息一',filesText:''},assistant:{key:'a1',text:'新回答',signature:'a1|新回答'},messages:[{key:'u1',role:'user',fingerprint:'first-user'},{key:'a1',role:'assistant',fingerprint:'first-answer'}],documentId:'doc1',operation:null};
  const restarted=harness(h.shared,{...snap});await restarted.drain();
  const resumed=await restarted.message('PF_RESUME');assert.equal(resumed.ok,true);await restarted.drain();
  assert.equal(restarted.shared.pfRun.status,'running',restarted.shared.pfRun.reason);
  assert.equal(restarted.shared.pfRun.targetUrl,conversation);
  assert.equal(restarted.shared.pfRun.phase,'waiting');
  assert.equal(restarted.sends.length,0);
  await restarted.beat();restarted.advance(5000);await restarted.beat();
  assert.equal(restarted.shared.pfRun.index,1);
  await restarted.beat();
  assert.equal(restarted.sends.length,1);assert.equal(restarted.sends[0].text,'消息二');
});

test('旧版因新聊天网址变化而暂停的任务，重启后恢复等待，不重发第一条',async()=>{
  const {h,snap}=await deliveredNewChat();await h.message('PF_PAUSE');
  h.shared.pfRun.reason='目标页已离开锁定对话';
  const restarted=harness(h.shared,{...snap,url,documentId:'refreshed'});await restarted.drain();
  const result=await restarted.message('PF_RESUME');assert.equal(result.ok,true);await restarted.drain();
  assert.equal(restarted.shared.pfRun.targetUrl,url);assert.equal(restarted.shared.pfRun.phase,'waiting');assert.equal(restarted.sends.length,0);
  restarted.advance(5000);await restarted.beat();assert.equal(restarted.shared.pfRun.index,1);
  await restarted.beat();assert.equal(restarted.sends.length,1);assert.equal(restarted.sends[0].text,'消息二');
});
test('已确认发送至临时 local-chatgpt 地址后升级正式 ID，旧版暂停记录可恢复且不重发',async()=>{
  const {h,snap}=await deliveredNewChat(),local='https://chatgpt.com/c/local-chatgpt%3A81d88ea4-6ec3-4c2c-9041-d2eb5a55329d';
  h.shared.pfRun.targetUrl=local;h.shared.pfRun.allowNewChat=false;h.shared.pfRun.status='paused';h.shared.pfRun.reason='目标页已离开锁定对话';
  const restarted=harness(h.shared,{...snap,url,documentId:'same-bound-tab'});await restarted.drain();
  const resumed=await restarted.message('PF_RESUME');assert.equal(resumed.ok,true);await restarted.drain();
  assert.equal(restarted.shared.pfRun.targetUrl,url);assert.equal(restarted.shared.pfRun.tabId,4);assert.equal(restarted.sends.length,0);
  restarted.advance(5000);await restarted.beat();await restarted.beat();assert.equal(restarted.shared.pfRun.index,1);assert.equal(restarted.sends.length,1);assert.equal(restarted.sends[0].text,'消息二');
});

test('暂停较久后恢复仍核对已有回答，不因旧的等待计时立即再次暂停',async()=>{
  const {h}=await deliveredNewChat();await h.message('PF_PAUSE');h.advance(31*60*1000);h.setSnapshot({url});
  assert.equal((await h.message('PF_RESUME')).ok,true);await h.drain();assert.equal(h.shared.pfRun.status,'running');assert.equal(h.sends.length,1);
  h.advance(5000);await h.beat();assert.equal(h.shared.pfRun.index,1);assert.equal(h.sends.length,2);assert.equal(h.sends[1].text,'消息二');
});

test('新聊天网址变化也必须核对本轮消息，不能跟随其他对话',async()=>{
  const {h}=await deliveredNewChat();
  h.setSnapshot({url,lastUser:{key:'other',text:'其他问题',filesText:''},messages:[{key:'other',role:'user'}]});await h.beat();
  assert.equal(h.shared.pfRun.status,'paused');assert.equal(h.shared.pfRun.targetUrl,'https://chatgpt.com/');assert.equal(h.sends.length,1);
  const resumed=await h.message('PF_RESUME');assert.equal(resumed.ok,false);assert.equal(h.sends.length,1);
});

test('等待超过十五秒说明具体原因，重复采样不刷日志；复制诊断可读到检测状态',async()=>{
  const {h,snap}=await deliveredNewChat();h.setSnapshot({generating:true,generationSignals:['stop-button'],reader:{strategy:'speaker-labels',count:2}});
  h.advance(16000);await h.beat();await h.beat();
  const logs=h.shared.pfRun.logs.filter(item=>item.text.startsWith('Waiting:'));assert.equal(logs.length,1);assert.match(logs[0].text,/streaming/);
  const result=await h.message('PF_DIAGNOSTIC');assert.equal(result.ok,true);assert.equal(result.diagnostic.generating,true);assert.equal(result.diagnostic.assistant.characters,snap.assistant.text.length);assert.equal(result.diagnostic.user.receiptMatched,true);
  assert.equal((await h.message('PF_DIAGNOSTIC',{},true)).ok,false);
});
test('先持久保存发送意图；送达后仅等待新回答，快回复也可推进',async()=>{
  const h=harness();await h.drain();
  const started=await h.message('PF_START',{tabId:4,flow:{title:'fixture',delaySeconds:0,steps:[{text:'消息一'},{text:'消息二'}]}});assert.equal(started.ok,true);await h.drain();
  assert.equal(h.sends.length,1);assert.equal(h.shared.pfRun.pending.text,'消息一');
  const pending=h.shared.pfRun.pending;
  await h.message('PF_AUTHORIZE_SEND',{runId:pending.runId,operationId:pending.id},true);
  const snap={url,hasComposer:true,draft:'',generating:false,lastRole:'assistant',lastUser:{key:'u1',text:'消息一',filesText:''},assistant:{key:'a1',text:'新回答',signature:'a1|新回答'},documentId:'doc1',operation:null};
  h.setSnapshot(snap);h.deliveries[0]({ok:true,snapshot:snap});await h.drain();
  assert.equal(h.shared.pfRun.phase,'waiting');assert.equal(h.sends.length,1);
  await h.beat();h.advance(5000);await h.beat();assert.equal(h.shared.pfRun.index,1);
  await h.beat();assert.equal(h.sends.length,2);assert.equal(h.sends[1].text,'消息二');
});
test('发送结果不确定时暂停；服务线程重启和恢复不会自动重复点击',async()=>{
  const h=harness();await h.drain();await h.message('PF_START',{tabId:4,flow:{steps:[{text:'仅一次'}]}});await h.drain();
  const pending=h.shared.pfRun.pending;await h.message('PF_AUTHORIZE_SEND',{runId:pending.runId,operationId:pending.id},true);
  h.deliveries[0]({ok:false,attempted:true,error:'送达不确定'});await h.drain();
  assert.equal(h.shared.pfRun.status,'paused');assert.equal(h.sends.length,1);
  const restarted=harness(h.shared);await restarted.drain();const result=await restarted.message('PF_RESUME');
  assert.equal(result.ok,false);assert.match(result.error,/SEND_RECEIPT_UNCONFIRMED/);assert.equal(restarted.sends.length,0);
});
test('暂停后不授权点击，非目标标签页不能读取附件或授权发送',async()=>{
  const h=harness();await h.drain();await h.message('PF_START',{tabId:4,flow:{steps:[{text:'测试'}]}});await h.drain();
  const pending=h.shared.pfRun.pending;await h.message('PF_PAUSE');
  const denied=await h.message('PF_AUTHORIZE_SEND',{runId:pending.runId,operationId:pending.id},true);
  assert.equal(denied.ok,false);assert.equal(h.shared.pfRun.pending.attemptedAt,0);
  const external=await h.message('PF_FILE_CHUNK',{runId:pending.runId,operationId:pending.id,fileId:'other',offset:0});
  assert.equal(external.ok,false);assert.equal(h.sends.length,1);
});

test('旧版已暂停任务在新页面读取到本轮回复后恢复等待，不会重发第一步',async()=>{
  const h=harness();await h.drain();await h.message('PF_START',{tabId:4,flow:{delaySeconds:0,steps:[{text:'# 要求\n\n**完整阅读**，保留 foo bar。'}]}});await h.drain();
  const pending=h.shared.pfRun.pending;await h.message('PF_AUTHORIZE_SEND',{runId:pending.runId,operationId:pending.id},true);
  h.deliveries[0]({ok:false,attempted:true,error:'已发送，旧页面未能识别回执'});await h.drain();assert.equal(h.shared.pfRun.status,'paused');
  h.setSnapshot({lastUser:{key:'new-u',text:'要求\n完整阅读，保留 foo bar。',filesText:''},assistant:{key:'new-a',text:'已完整阅读。',signature:'new-a|done'},messages:[{key:'old-a',role:'assistant',fingerprint:'old'},{key:'new-u',role:'user',fingerprint:'user'},{key:'new-a',role:'assistant',fingerprint:'new'}]});
  const resumed=await h.message('PF_RESUME');assert.equal(resumed.ok,true);await h.drain();
  assert.equal(h.sends.length,1);assert.equal(h.shared.pfRun.phase,'waiting');
  h.advance(5000);await h.beat();assert.equal(h.shared.pfRun.status,'completed');assert.equal(h.sends.length,1);
});

test('同一运行入口先核对，空回执须明确重试；发现新内容即使重试也不重发',async()=>{
  const before=[{key:'old-u',role:'user',fingerprint:'u'},{key:'old-a',role:'assistant',fingerprint:'a'}];
  const h=harness({}, {messages:before});await h.drain();
  await h.message('PF_START',{tabId:4,flow:{steps:[{text:'仅一次'}]}});await h.drain();
  const pending=h.shared.pfRun.pending;await h.message('PF_AUTHORIZE_SEND',{runId:pending.runId,operationId:pending.id},true);
  h.deliveries[0]({ok:false,attempted:true,error:'SEND_RECEIPT_UNCONFIRMED: No receipt'});await h.drain();
  const first=await h.message('PF_RESUME');assert.match(first.error,/^RESEND_CONFIRMATION_REQUIRED:/);assert.equal(h.sends.length,1);
  const logs=h.shared.pfRun.logs.length;await h.message('PF_RESUME');assert.equal(h.shared.pfRun.logs.length,logs);
  h.setSnapshot({messages:[...before,{key:'unknown',role:'assistant',fingerprint:'new'}]});
  assert.match((await h.message('PF_RETRY')).error,/^SEND_RECEIPT_UNCONFIRMED:/);assert.equal(h.sends.length,1);
  h.setSnapshot({messages:before});assert.equal((await h.message('PF_RETRY')).ok,true);await h.drain();assert.equal(h.sends.length,2);
});

test('确认重试期间迟到的回执优先接续，不再次发送',async()=>{
  const before=[{key:'old-u',role:'user',fingerprint:'u'},{key:'old-a',role:'assistant',fingerprint:'a'}];
  const h=harness({}, {messages:before});await h.drain();
  await h.message('PF_START',{tabId:4,flow:{steps:[{text:'仅一次'}]}});await h.drain();
  const pending=h.shared.pfRun.pending;await h.message('PF_AUTHORIZE_SEND',{runId:pending.runId,operationId:pending.id},true);
  h.deliveries[0]({ok:false,attempted:true,error:'SEND_RECEIPT_UNCONFIRMED: No receipt'});await h.drain();
  assert.match((await h.message('PF_RESUME')).error,/^RESEND_CONFIRMATION_REQUIRED:/);
  h.setSnapshot({lastUser:{key:'new-u',text:'仅一次',filesText:''},assistant:{key:'new-a',text:'迟到的回答',signature:'new-a|done'},messages:[...before,{key:'new-u',role:'user',fingerprint:'new-u'},{key:'new-a',role:'assistant',fingerprint:'new-a'}]});
  assert.equal((await h.message('PF_RETRY')).ok,true);await h.drain();
  assert.equal(h.shared.pfRun.phase,'waiting');assert.equal(h.sends.length,1);
  h.advance(5000);await h.beat();assert.equal(h.shared.pfRun.status,'completed');assert.equal(h.sends.length,1);
});

function pausedRun(patch={}){
  return {id:'run-closed',flow:{title:'tab recovery',steps:[{text:'First'},{text:'Second'}]},tabId:4,targetUrl:url,tabTitle:'ChatGPT',
    status:'paused',phase:'ready',index:1,repeated:0,logs:[],reason:'已手动暂停',pending:null,...patch};
}

test('原标签页关闭后恢复给出独立原因，诊断仍可复制且标明快照不可用',async()=>{
  const h=harness({pfRun:pausedRun()});await h.drain();
  h.closeTab(4);await h.advance(1000);
  const resumed=await h.message('PF_RESUME');
  assert.equal(resumed.ok,false);
  assert.match(resumed.error,/^TARGET_TAB_CLOSED:/);
  assert.equal(h.shared.pfRun.status,'paused');
  assert.equal(h.shared.pfRun.tabId,4);
  assert.equal(h.shared.pfRun.logs.at(-1).text,'Resume check failed: TARGET_TAB_CLOSED: Reopen the conversation bound to this flow before resuming');
  assert.equal(h.shared.pfRun.logs.at(-1).level,'ERROR');
  const diagnostics=await h.message('PF_DIAGNOSTIC');
  assert.equal(diagnostics.ok,true);
  assert.equal(diagnostics.diagnostic.dom,'unavailable');
  assert.equal(diagnostics.diagnostic.tab.id,4);
  assert.equal(diagnostics.diagnostic.status,'paused');
  assert.equal(diagnostics.diagnostic.phase,'ready');
  assert.match(diagnostics.diagnostic.snapshotError,/^TARGET_TAB_CLOSED:/);
  const logs=await h.message('PF_DIAGNOSTIC');
  assert.equal(logs.diagnostic.step,2);
});

test('原对话在新标签页重新打开：恢复改绑该标签页，不重发已确认的步骤',async()=>{
  const h=harness({pfRun:pausedRun()});await h.drain();
  h.closeTab(4);
  h.openTab({id:9,url,title:'ChatGPT',active:true});
  const resumed=await h.message('PF_RESUME');
  assert.equal(resumed.ok,true,resumed.error);
  await h.drain();
  assert.equal(h.shared.pfRun.tabId,9);
  assert.equal(h.shared.pfRun.status,'running');
  assert.equal(h.sends.length,1);
  assert.equal(h.sends[0].text,'Second');
  assert.ok(h.shared.pfRun.logs.some(item=>item.text==='Rebound to reopened conversation (tab 9)'));
});

test('新开的其他对话不接管暂停流程，也不静默迁移目标',async()=>{
  const h=harness({pfRun:pausedRun()});await h.drain();
  h.closeTab(4);
  h.openTab({id:11,url:'https://chatgpt.com/c/another-conversation',title:'ChatGPT',active:true});
  h.openTab({id:12,url:'https://chatgpt.com/',title:'ChatGPT',active:false});
  const resumed=await h.message('PF_RESUME');
  assert.equal(resumed.ok,false);
  assert.match(resumed.error,/^TARGET_TAB_CLOSED:/);
  assert.equal(h.shared.pfRun.tabId,4);
  assert.equal(h.shared.pfRun.status,'paused');
  assert.equal(h.sends.length,0);
});

const ALIAS_ATTACHMENT={id:'f1',name:'02-anadiplosis-information-linkage.md',size:3,mimeType:'text/markdown'};
const ALIAS_DISPLAY='02-anadiplosis-information-linkage(9).md';

test('附件显示名只在同词干同扩展名时记录为别名',async()=>{
  const run={id:'run-alias',flow:{title:'alias',steps:[{text:'First'},{text:'',attachment:ALIAS_ATTACHMENT},{text:'Last'}]},tabId:4,targetUrl:url,status:'running',phase:'uploading',index:1,repeated:0,logs:[],pending:{id:'op1',runId:'run-alias',step:2,attachment:ALIAS_ATTACHMENT,attemptedAt:0,attachmentAliases:[],documentId:'doc1',createdAt:10000}};
  const h=harness({pfRun:run});await h.drain();
  await h.message('PF_ATTACHMENT_READY',{runId:'run-alias',operationId:'op1',fileId:'f1',displayName:ALIAS_DISPLAY},true);
  assert.deepEqual(h.shared.pfRun.pending.attachmentAliases,[ALIAS_DISPLAY]);
  assert.equal(h.shared.pfRun.pending.attachmentUploaded,true);
  await h.message('PF_ATTACHMENT_READY',{runId:'run-alias',operationId:'op1',fileId:'f1',displayName:'02-anadiplosis-information-linkage(9).txt'},true);
  await h.message('PF_ATTACHMENT_READY',{runId:'run-alias',operationId:'op1',fileId:'f1',displayName:'other-file.md'},true);
  assert.deepEqual(h.shared.pfRun.pending.attachmentAliases,[ALIAS_DISPLAY]);
});

test('恢复把已记录的显示名带进下一次发送，并保持复用',async()=>{
  const run={id:'run-alias',flow:{title:'alias',steps:[{text:'First'},{text:'',attachment:ALIAS_ATTACHMENT},{text:'Last'}]},tabId:4,targetUrl:url,status:'paused',phase:'uploading',index:1,repeated:0,logs:[],pending:{id:'op1',runId:'run-alias',step:2,attachment:ALIAS_ATTACHMENT,attemptedAt:0,attachmentAliases:[ALIAS_DISPLAY],documentId:'doc1',createdAt:10000}};
  const h=harness({pfRun:run});await h.drain();
  const resumed=await h.message('PF_RESUME');assert.equal(resumed.ok,true);await h.drain();
  assert.equal(h.sends.length,1);
  assert.equal(h.sends[0].reuseAttachment,true);
  assert.deepEqual([...h.sends[0].attachmentAliases],[ALIAS_DISPLAY]);
  assert.equal(h.shared.pfRun.resumeAttachmentId,undefined);
  assert.equal(h.shared.pfRun.resumeAttachmentAliases,undefined);
});

test('最后一次附件诊断不会被后续纯文字步骤覆盖',async()=>{
  const last={v:3,stage:'observing',operation:{id:'op2',runId:'run-history',step:2},identity:{state:'match'}};
  const run={id:'run-history',flow:{title:'history',steps:[{text:'First'},{text:'',attachment:ALIAS_ATTACHMENT},{text:'Last'}]},tabId:4,targetUrl:url,status:'running',phase:'ready',index:2,repeated:0,logs:[],lastAttachmentUpload:last};
  const h=harness({pfRun:run});await h.drain();
  await h.beat();
  assert.equal(h.sends.length,1,'the text step should be dispatched');
  const pending=h.sends[0];
  const answer={key:'a-new',role:'assistant',fingerprint:'a-new'};
  h.setSnapshot({lastRole:'assistant',lastUser:{key:'u-new',text:'Last',filesText:''},assistant:{key:'a-new',text:'回答',signature:'a-new|回答'},messages:[{key:'old-u',role:'user',fingerprint:'u'},{key:'a-new',role:'assistant',fingerprint:'a-new'}]});
  h.deliveries[0]({ok:true,snapshot:{...h.shared.pfRun.pending?{}:{},lastRole:'assistant',lastUser:{key:'u-new',text:'Last',filesText:''},assistant:{key:'a-new',text:'回答',signature:'a-new|回答'},messages:[{key:'old-u',role:'user',fingerprint:'u'},{key:'a-new',role:'assistant',fingerprint:'a-new'}],url,documentId:'doc1',hasComposer:true,draft:'',generating:false,operation:null}});
  h.advance(5000);await h.beat();
  const diagnostics=await h.message('PF_DIAGNOSTIC');
  assert.equal(diagnostics.diagnostic.lastAttachmentUpload.operation.step,2);
  assert.equal(diagnostics.diagnostic.lastAttachmentUpload.operation.id,'op2');
});

function attachmentRun(){
  return {id:'run-persist',flow:{title:'persist',steps:[{text:'First'},{text:'',attachment:ALIAS_ATTACHMENT},{text:'Last'}]},tabId:4,targetUrl:url,status:'running',phase:'ready',index:1,repeated:0,logs:[],pending:null};
}
function receiptSnapshot(upload){
  return {url,hasComposer:true,draft:'',generating:false,lastRole:'user',lastUser:{key:'u-new',text:'',filesText:ALIAS_DISPLAY},assistant:null,messages:[{key:'u-new',role:'user',fingerprint:'u-new'}],documentId:'doc1',operation:null,upload};
}

test('失败的附件结果会真实写入持久化诊断并关联操作',async()=>{
  const h=harness({pfRun:attachmentRun()});await h.drain();await h.beat();
  const pending=h.shared.pfRun.pending;assert.ok(pending);
  const upload={v:3,stage:'observing',operation:{id:pending.id,runId:'run-persist',step:2},sampledAt:500,matchMode:'unmatched',identity:{state:'none'}};
  h.deliveries[0]({ok:false,error:'UPLOAD_ATTACHMENT_UNIDENTIFIED: no identity',upload});await h.drain();
  assert.equal(h.shared.pfRun.status,'paused');
  const stored=h.shared.pfRun.lastAttachmentUpload;
  assert.equal(stored.operation.id,pending.id);
  assert.equal(stored.operation.step,2);
  assert.equal(stored.matchMode,'unmatched');
  assert.ok(stored.persistedAt>0);
});

test('心跳先采纳回执后，晚到的成功结果仍把就绪快照写入持久化诊断',async()=>{
  const h=harness({pfRun:attachmentRun()});await h.drain();await h.beat();
  const pending=h.shared.pfRun.pending;assert.ok(pending);
  await h.message('PF_ATTACHMENT_READY',{runId:pending.runId,operationId:pending.id,fileId:'f1',displayName:ALIAS_DISPLAY},true);
  await h.message('PF_AUTHORIZE_SEND',{runId:pending.runId,operationId:pending.id},true);await h.drain();
  const early={v:3,stage:'observing',operation:{id:pending.id,runId:'run-persist',step:2},sampledAt:1000,matchMode:'matched-prefix'};
  const ready={...early,sampledAt:1200,matchMode:'display-alias',alias:ALIAS_DISPLAY};
  h.setSnapshot(receiptSnapshot(early));h.advance(1000);await h.beat();await h.drain();
  assert.equal(h.shared.pfRun.pending,null,'heartbeat should adopt the receipt first');
  assert.equal(h.shared.pfRun.lastAttachmentUpload.sampledAt,1000);
  h.deliveries[0]({ok:true,snapshot:receiptSnapshot(ready),upload:ready});await h.drain();
  assert.equal(h.shared.pfRun.lastAttachmentUpload.sampledAt,1200);
  assert.equal(h.shared.pfRun.lastAttachmentUpload.matchMode,'display-alias');
  assert.equal(h.shared.pfRun.lastAttachmentUpload.alias,ALIAS_DISPLAY);
});

test('旧操作的晚到结果不能覆盖较新的附件诊断',async()=>{
  const h=harness({pfRun:attachmentRun()});await h.drain();await h.beat();
  const first=h.shared.pfRun.pending;
  await h.message('PF_ATTACHMENT_READY',{runId:first.runId,operationId:first.id,fileId:'f1',displayName:ALIAS_DISPLAY},true);
  await h.message('PF_AUTHORIZE_SEND',{runId:first.runId,operationId:first.id},true);await h.drain();
  const newer={v:3,stage:'observing',operation:{id:first.id,runId:'run-persist',step:2},sampledAt:2000,matchMode:'display-alias',alias:ALIAS_DISPLAY};
  h.deliveries[0]({ok:true,snapshot:receiptSnapshot(newer),upload:newer});await h.drain();
  assert.equal(h.shared.pfRun.lastAttachmentUpload.sampledAt,2000);
  h.deliveries[0]({ok:true,snapshot:receiptSnapshot(newer),upload:{...newer,operation:{...newer.operation,id:'op-old'},sampledAt:1500,matchMode:'unmatched'}});await h.drain();
  assert.equal(h.shared.pfRun.lastAttachmentUpload.sampledAt,2000);
  assert.equal(h.shared.pfRun.lastAttachmentUpload.matchMode,'display-alias');
  assert.equal(h.shared.pfRun.lastAttachmentUpload.operation.id,first.id);
});

test('单步五附件：后台逐一授权，任一附件尚未就绪都禁止点击发送',async()=>{
  const refs=Array.from({length:5},(_,index)=>({id:'batch-'+index,name:'第'+(index+1)+'份.txt',size:3,mimeType:'text/plain'}));
  const pending={id:'op-five',runId:'five-run',step:1,text:'读取五份附件',attachments:refs,attachment:refs[0],uploadedIds:[],attemptedAt:0,createdAt:10000};
  const run={id:'five-run',flow:{title:'五附件',steps:[{text:'读取五份附件',attachments:refs}]},tabId:4,targetUrl:url,status:'running',phase:'uploading',index:0,repeated:0,logs:[],pending};
  const h=harness();await h.drain();h.shared.pfRun=run;
  assert.equal(h.shared.pfRun.pending.attachments.length,5);
  const auth=()=>h.message('PF_AUTHORIZE_SEND',{runId:pending.runId,operationId:pending.id},true);
  assert.equal((await auth()).ok,false);
  for(const ref of refs.slice(0,-1)){
    const result=await h.message('PF_ATTACHMENT_READY',{runId:pending.runId,operationId:pending.id,fileId:ref.id},true);
    assert.equal(result.ok,true,result.error);
  }
  assert.equal((await auth()).ok,false);
  assert.equal(h.shared.pfRun.pending.attemptedAt,0);
  const ready=await h.message('PF_ATTACHMENT_READY',{runId:pending.runId,operationId:pending.id,fileId:refs.at(-1).id},true);
  assert.equal(ready.ok,true,ready.error);
  assert.equal((await auth()).ok,true);
  assert.ok(h.shared.pfRun.pending.attemptedAt);
  assert.equal(h.sends.length,0);
});
