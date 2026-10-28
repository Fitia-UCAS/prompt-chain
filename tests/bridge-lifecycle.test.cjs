const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../content/bridge.js'), 'utf8');
const drain = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const listeners = new Set(), inputs = new Set(), timers = new Map(), calls = [], sleeps = [];
  let nextId = 0, mode = 'normal', authorize, clicks = 0, disconnected = false;
  const composer = {contains: () => true}, form = {querySelectorAll: () => []};
  const chrome = {runtime: {
    onMessage: {addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn)},
    sendMessage(message) {
      calls.push(message.type);
      if (mode === 'sync') throw new Error('Extension context invalidated.');
      if (mode === 'async') return Promise.reject(new Error('Extension context invalidated.'));
      if (mode === 'transient') return Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));
      if (message.type === 'PF_AUTHORIZE_SEND') return new Promise(resolve => {authorize = resolve;});
      return Promise.resolve({ok: true});
    }
  }};
  const context = vm.createContext({
    chrome, crypto: globalThis.crypto, location: {href: 'https://chatgpt.com/c/test'},
    document: {documentElement: {}, addEventListener: (_, fn) => inputs.add(fn), removeEventListener: (_, fn) => inputs.delete(fn)},
    PromptFlowModel: {sameChat: () => true, echoNorm: value => value, receipt: () => false},
    PromptFlowSupervisor: {
      snapshot: () => ({draft: '', generating: false}), composer: () => composer, scope: () => form,
      attachmentRoots: () => [{root: form, kind: 'form'}], attachmentCardCount: () => null,
      scanAttachment: () => ({state: 'none', strength: 'none', reason: 'no-structural-candidate', root: form, kind: 'form', nodes: [], cards: [], roots: [{kind: 'form', tag: 'FORM', testid: '', role: '', path: 'form', seeds: 0, cards: 0}]}),
      describe: () => '', ctext: () => '', rendered: () => true, sendBtn: () => ({click() {clicks++;}}), generating: () => false,
      sleep: () => new Promise(resolve => sleeps.push(resolve))
    },
    MutationObserver: class {constructor(fn) {context.mutate = fn;} observe() {} disconnect() {disconnected = true;}},
    setTimeout(fn) {const id = ++nextId; timers.set(id, {fn, repeat: false}); return id;},
    setInterval(fn) {const id = ++nextId; timers.set(id, {fn, repeat: true}); return id;},
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id)
  });
  vm.runInContext(source, context);
  return {
    context, calls, listeners, inputs, timers,
    setMode(value) {mode = value;},
    get clicks() {return clicks;}, get disconnected() {return disconnected;},
    mutate() {context.mutate();},
    async beat() {for (const timer of [...timers.values()]) if (timer.repeat) timer.fn(); await drain();},
    send(respond = () => {}) {return [...listeners][0]({type: 'PF_SEND', operation: {id: 'op', url: context.location.href, text: ''}}, {}, respond);},
    async authorize() {authorize({ok: true}); await drain();},
    async wake() {for (const resolve of sleeps.splice(0)) resolve(); await drain();}
  };
}

for (const mode of ['sync', 'async']) {
  test(`失效通信 ${mode}：移除心跳、待执行通知、观察器与监听，不再发消息`, async () => {
    const h = harness(); h.mutate(); assert.equal(h.timers.size, 2);
    h.setMode(mode); await h.beat();
    assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
    assert.equal(h.listeners.size, 0); assert.equal(h.disconnected, true);
    h.mutate(); await h.beat(); assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
  });
}

test('暂时没有接收端不会销毁连接，后续心跳可以恢复', async () => {
  const h = harness(); h.setMode('transient'); await h.beat();
  assert.equal(h.listeners.size, 1); assert.equal(h.disconnected, false);
  h.setMode('normal'); await h.beat(); assert.equal(h.calls.length, 2);
});

test('授权发送等待期间重载：立即移除输入监听，迟到授权不能触发点击', async () => {
  const h = harness(); h.send(); assert.equal(h.inputs.size, 1);
  h.setMode('sync'); await h.beat(); assert.equal(h.inputs.size, 0);
  await h.authorize(); assert.equal(h.clicks, 0); assert.equal(h.listeners.size, 0);
});

test('点击后等待回执期间重载：结束等待，不重发，不调用失效响应通道', async () => {
  const h = harness(); let responses = 0;
  h.send(() => {responses++; throw new Error('Extension context invalidated.');});
  await h.authorize(); assert.equal(h.clicks, 1);
  h.setMode('async'); await h.beat(); await h.wake();
  assert.equal(h.clicks, 1); assert.equal(responses, 0); assert.equal(h.inputs.size, 0);
});

test('重复注入只注册一个监听；失效响应回调也会清理', () => {
  const h = harness(); vm.runInContext(source, h.context); assert.equal(h.listeners.size, 1);
  [...h.listeners][0]({type: 'PF_STATUS'}, {}, () => {throw new Error('Extension context invalidated.');});
  assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0);
});
