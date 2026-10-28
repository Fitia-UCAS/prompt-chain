const {test, before} = require('node:test');
const assert = require('node:assert/strict');
const M = require('../shared/model.js');
let createConnection, createScheduler;
before(async () => {
  ({createConnection} = await import('../background/connection.mjs'));
  ({createScheduler} = await import('../background/scheduler.mjs'));
});

for (const provider of ['gemini', 'deepseek']) {
  test(`${provider} 重连会修复缺失脚本，输入框不可用则明确失败`, async () => {
    let ready = false, injects = 0, sends = 0;
    const url = provider === 'gemini' ? 'https://gemini.google.com/app?dest=create' : 'https://chat.deepseek.com/';
    const chrome = {tabs: {async get() {return {id: 2, url};}, async sendMessage(_id, message) {if(message.type==='PF_STATUS')return{ok:true,snapshot:{url,hasComposer:true,engineVersion:10,reader:{version:7,users:0,assistants:0}}};sends++; return {ok: true, result: {ready}};}},
      scripting: {async executeScript() {injects++; ready = true;}}};
    const connection = createConnection({chrome, model: M, runs: {getRun: async()=>null}, sleep: async () => {}});
    assert.equal((await connection.connect(2)).hasComposer, true);
    assert.equal(injects, 1); assert.equal(sends, 2);
    await connection.connect(2); assert.equal(injects, 1);
    ready = false; chrome.scripting.executeScript = async () => {injects++;};
    await assert.rejects(connection.connect(2), /尚未找到聊天输入框/);
  });
}

test('调度串行化执行，重复采样合并，失败后仍能执行后续任务', async () => {
  let release, ticks = 0; const order = [];
  const scheduler = createScheduler({tick: async () => {ticks++;}, timers: {clearTimeout() {}}});
  const first = scheduler.enqueue(async () => {order.push('first'); await new Promise(resolve => {release = resolve;});});
  const failed = scheduler.enqueue(() => {order.push('failed'); throw new Error('test');});
  const rejected = assert.rejects(failed, /test/);
  scheduler.requestTick(); scheduler.requestTick();
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(order, ['first']);
  release(); await first; await rejected; await scheduler.idle();
  assert.deepEqual(order, ['first', 'failed']); assert.equal(ticks, 1);
  scheduler.dispose(); scheduler.requestTick(); await scheduler.idle(); assert.equal(ticks, 1);
});

for (const [start, formal, other] of [
  ['https://chatgpt.com/', 'https://chatgpt.com/c/first', 'https://chatgpt.com/c/other'],
  ['https://gemini.google.com/app?dest=create', 'https://gemini.google.com/app/first', 'https://gemini.google.com/app/other'],
  ['https://chat.deepseek.com/', 'https://chat.deepseek.com/a/chat/s/first', 'https://chat.deepseek.com/a/chat/s/other']
]) {
  test(`${start} 支持新对话绑定，已绑定对话不跟随其他会话`, () => {
    assert.equal(M.platforms.chatPage(start), true);
    assert.equal(M.sameChat(start, formal), false);
    assert.equal(M.sameChat(start, formal, true), true);
    assert.equal(M.sameChat(formal, other, true), false);
  });
}

test('平台范围与圆桌会议一致，移除 Claude；DeepSeek 查询参数中的会话 ID 不能串线', () => {
  assert.deepEqual(Object.keys(M.platforms.names), ['chatgpt', 'gemini', 'deepseek']);
  assert.equal(M.allowedUrl('https://claude.ai/new'), false);
  assert.equal(M.allowedUrl('https://chat.deepseek.com.evil.example/'), false);
  assert.equal(M.sameChat('https://chat.deepseek.com/?chat_session_id=one', 'https://chat.deepseek.com/a/chat/s/one'), true);
  assert.equal(M.sameChat('https://chat.deepseek.com/?chat_session_id=one', 'https://chat.deepseek.com/?chat_session_id=two', true), false);
});

test('Gemini 空白新聊天保留旧正式网址，送达后仅绑定一次新 ID；旧会话和其他用户不放行',()=>{
 const old='https://gemini.google.com/app/old?dest=create',url='https://gemini.google.com/app/new?dest=create';
 const operation={url:old,text:'本轮消息',baselineMessages:[],attemptedAt:1};
 const snap={url,lastUser:{key:'u',text:'本轮消息'},messages:[{key:'u',role:'user'}]};
 const connection=createConnection({chrome:{},model:M,runs:{}});
 const run={index:0,targetUrl:old,allowNewChat:false,delivery:operation};
 assert.equal(connection.matchTarget(run,snap),true);assert.equal(run.targetUrl,url);
 assert.equal(connection.matchTarget(run,{...snap,url:'https://gemini.google.com/app/another?dest=create'}),false);
 for(const change of [{index:1},{bindingFinalized:true},{delivery:{...operation,baselineMessages:[{key:'before',role:'user'}]}},{delivery:{...operation,text:'不同消息'}},{delivery:{...operation,attemptedAt:0}}]){
  assert.equal(connection.matchTarget({index:0,targetUrl:old,allowNewChat:false,delivery:operation,...change},snap),false);
 }
 assert.equal(connection.matchTarget({index:0,targetUrl:old,delivery:operation},{...snap,url:'https://gemini.google.com/u/1/app/new?dest=create'}),false);
});
