const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const BRIDGE = process.env.BRIDGE_FILE || path.join(ROOT, 'content/bridge.js');

function harness() {
  let now = 0, busy = true, present = false, clicks = 0;
  const sleeps = [], messageListeners = new Set(), inputListeners = new Set();
  const card = {node: {}};
  const input = {accept: '', disabled: false, multiple: true, files: null, hasAttribute: () => false,
    addEventListener: (type, fn) => inputListeners.add(fn), removeEventListener: (type, fn) => inputListeners.delete(fn),
    dispatchEvent: () => {for (const fn of [...inputListeners]) fn({target: input}); return true;}};
  const form = {tagName: 'FORM', isConnected: true, getAttribute: () => '',
    querySelectorAll: selector => selector.includes('input[type="file"]') ? [input]
      : selector.includes('aria-busy') ? (busy ? [{isConnected: true}] : []) : []};
  const composer = {isConnected: true, contains: () => true};
  const sendButton = {click() {clicks++;}, getAttribute: () => null};
  const chrome = {runtime: {onMessage: {addListener: fn => messageListeners.add(fn), removeListener: fn => messageListeners.delete(fn)},
    sendMessage(message) {
      if (message.type === 'PF_FILE_CHUNK') return Promise.resolve({ok: true, chunk: Buffer.from('abc').toString('base64')});
      return Promise.resolve({ok: true});
    }}};
  const supervisor = {
    snapshot: () => ({draft: '', generating: false, url: 'https://chatgpt.com/c/upload'}),
    composer: () => composer, scope: () => form, ctext: () => '', rendered: () => true, generating: () => false,
    sendBtn: () => sendButton, describe: () => '', sleep: ms => new Promise(resolve => sleeps.push({at: now + ms, resolve})),
    attachmentRoots: () => [{root: form, kind: 'form'}],
    scanAttachment: () => present
      ? {state: 'match', strength: 'weak', reason: 'truncated-prefix', root: form, kind: 'form', nodes: [card.node],
         cards: [{tag: 'DIV', testid: 'attachment-preview', state: 'match', strength: 'weak', reason: 'truncated-prefix',
                  sources: [{source: 'text', verdict: 'match', reason: 'truncated-prefix', strength: 'weak', text: '02-anadiplosis-info…', length: 20, extension: ''}]}],
         roots: [{kind: 'form', tag: 'FORM', testid: '', role: '', path: 'form', seeds: 1, cards: 1}]}
      : {state: 'none', strength: 'none', reason: 'no-structural-candidate', root: form, kind: 'form', nodes: [], cards: [], roots: [{kind: 'form', tag: 'FORM', testid: '', role: '', path: 'form', seeds: 0, cards: 0}]},
    attachmentCardCount: () => present ? 1 : null
  };
  const model = {sameChat: () => true, echoNorm: value => String(value || '').replace(/\s+/g, ' ').trim(), receipt: () => true, fingerprint: () => 'f'};
  class Clock extends Date {static now() {return now;}}
  const context = vm.createContext({
    chrome, crypto: globalThis.crypto, console, URL, atob, File, Blob, Event, TextEncoder, TextDecoder,
    location: {href: 'https://chatgpt.com/c/upload'},
    document: {documentElement: {}, addEventListener() {}, removeEventListener() {}, querySelectorAll: () => []},
    PromptFlowModel: model, PromptFlowSupervisor: supervisor,
    DataTransfer: class {constructor() {this.items = {add: file => {this.files = [file];}}; this.files = [];}},
    MutationObserver: class {observe() {} disconnect() {}}, Date: Clock,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {}
  });
  vm.runInContext(fs.readFileSync(BRIDGE, 'utf8'), context);
  const result = new Promise(resolve => {
    const receive = [...messageListeners][0];
    receive({type: 'PF_SEND', operation: {id: 'op', runId: 'run', url: 'https://chatgpt.com/c/upload', text: '',
      attachment: {id: 'file', name: '02-anadiplosis-information-linkage.md', size: 3, mimeType: 'text/markdown'}}}, {}, resolve);
  });
  async function flush(){for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));}
  async function advance(ms) {
    const target = now + ms;
    await flush();
    while (true) {
      if (!sleeps.length) {await flush(); if (!sleeps.length) break;}
      const next = sleeps[0];
      if (next.at > target) break;
      sleeps.shift(); now = next.at; next.resolve(); await flush();
    }
    if (target > now) now = target;
    await flush();
  }
  return {advance, get clicks() {return clicks;}, setBusy(value) {busy = value;}, setPresent(value) {present = value;}, get now() {return now;},
    result, diagnostic: () => context.PromptChainFileUI.uploadDiagnostic()};
}

test('上传忙碌持续超过八秒后，卡片在忙碌结束之后才渲染时仍能确认，而不是立刻报未知预览', async () => {
  const h = harness();
  let settled = false, outcome;
  h.result.then(value => {settled = true; outcome = value;});
  await h.advance(11250);
  assert.ok(h.diagnostic(), 'upload loop should have sampled');
  assert.equal(h.diagnostic().previewMatched, false);
  h.setBusy(false);
  await h.advance(250);
  assert.equal(h.diagnostic().waitingFor, 'attachment preview name not recognized');
  h.setPresent(true);
  for (let step = 0; step < 40 && !settled; step++) await h.advance(250);
  assert.equal(settled, true, 'upload should settle');
  assert.equal(outcome.ok, true, outcome.error);
  assert.equal(h.clicks, 1);
  assert.equal(h.diagnostic().previewMatched, true);
  assert.equal(h.diagnostic().v, 3);
  assert.ok(h.diagnostic().busySamples >= 40, 'busy samples should be recorded');
});

test('上传处理结束后等待完整个窗口仍无卡片才报错，并说明范围与候选数量', async () => {
  const h = harness();
  let settled = false, outcome;
  h.result.then(value => {settled = true; outcome = value;});
  await h.advance(11250);
  h.setBusy(false);
  await h.advance(250);
  for (let step = 0; step < 140 && !settled; step++) await h.advance(250);
  assert.equal(settled, true, 'upload should settle');
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /^UPLOAD_PREVIEW_NOT_RECOGNIZED:/);
  assert.match(outcome.error, /observed \d+ms after processing signal cleared/);
  assert.match(outcome.error, /identity=none\/none/);
  assert.match(outcome.error, /no-structural-candidate/);
  assert.equal(h.clicks, 0);
});
