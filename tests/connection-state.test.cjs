const {test, before} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const ROOT = path.join(__dirname, '..');
let connect, connection, target, model;

before(async () => {
  globalThis.PromptFlowModel = require(path.join(ROOT, 'shared/model.js'));
  model = globalThis.PromptFlowModel;
  ({connect, connection, target} = await import(pathToFileURL(path.join(ROOT, 'native-connection.js')).href));
});

function harness({run = null, tabs = [], snapshots = {}} = {}) {
  globalThis.chrome = {
    storage: {local: {get: async () => ({pfRun: run})}},
    tabs: {
      query: async () => tabs,
      sendMessage: async id => {
        const snapshot = snapshots[id];
        if (!snapshot) throw new Error('Could not establish connection. Receiving end does not exist.');
        return {ok: true, snapshot};
      },
    },
    runtime: {sendMessage: async () => ({ok: true, snapshot: Object.values(snapshots)[0]})},
  };
}

test('活动流程只认可绑定对话：删除对话回首页后绿灯必须熄灭', async () => {
  const bound = {id: 4, url: 'https://chatgpt.com/c/locked', active: true};
  harness({run: {status: 'paused', tabId: 4, targetUrl: bound.url}, tabs: [bound], snapshots: {4: {url: 'https://chatgpt.com/', hasComposer: true}}});
  const state = await connect();
  assert.equal(state.ready, false);
  assert.equal(state.tab.id, 4);
  await assert.rejects(() => connect(true), /^Error: (TARGET_CONVERSATION_LOST|TARGET_TAB_CLOSED)/);
});

test('绑定对话仍打开时保持绿灯，切换窗口不影响绑定', async () => {
  const bound = {id: 4, url: 'https://chatgpt.com/c/locked', active: false};
  const other = {id: 8, url: 'https://chatgpt.com/', active: true};
  harness({run: {status: 'running', tabId: 4, targetUrl: bound.url}, tabs: [other, bound], snapshots: {4: {url: bound.url, hasComposer: true}, 8: {url: other.url, hasComposer: true}}});
  const state = await connect();
  assert.equal(state.ready, true);
  assert.equal(state.tab.id, 4);
});

test('绑定标签页关闭后不再回退到首页等可用页面', async () => {
  harness({run: {status: 'paused', tabId: 4, targetUrl: 'https://chatgpt.com/c/locked'}, tabs: [{id: 8, url: 'https://chatgpt.com/', active: true}], snapshots: {8: {url: 'https://chatgpt.com/', hasComposer: true}}});
  assert.equal(await target(), null);
  const state = await connect();
  assert.equal(state.ready, false);
  assert.equal(state.tab, null);
  await assert.rejects(() => connect(true), /^Error: TARGET_TAB_CLOSED/);
});

test('没有活动流程时选用当前可用聊天页', async () => {
  harness({run: {status: 'completed', tabId: 4, targetUrl: 'https://chatgpt.com/c/old'}, tabs: [{id: 8, url: 'https://chatgpt.com/', active: true}], snapshots: {8: {url: 'https://chatgpt.com/', hasComposer: true}}});
  const state = await connect();
  assert.equal(state.ready, true);
  assert.equal(state.tab.id, 8);
});

test('项目页同样显示绿灯，并保留项目范围', async () => {
  const project = {id: 6, url: 'https://chatgpt.com/g/g-p-6ac6367e6468819195855069f223562b/project', active: true};
  const inside = {id: 7, url: 'https://chatgpt.com/g/g-p-6ac6367e6468819195855069f223562b/c/one', active: true};
  harness({tabs: [project], snapshots: {6: {url: project.url, hasComposer: true}}});
  const state = await connect();
  assert.equal(state.ready, true);
  assert.equal(state.tab.id, 6);
  harness({tabs: [inside], snapshots: {7: {url: inside.url, hasComposer: true}}});
  const conversation = await connect();
  assert.equal(conversation.ready, true);
  assert.equal(conversation.tab.id, 7);
});
