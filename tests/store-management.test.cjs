const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
test('流程可删除恢复、批量清空只删除已确认项，备份与并发保存不丢正常记录',async()=>{
  const values={},context=vm.createContext({crypto:globalThis.crypto,URL,Date,btoa,atob,chrome:{storage:{local:{
    async get(key){return{[key]:structuredClone(values[key])};},async set(patch){Object.assign(values,structuredClone(patch));}
  }}}});
  for(const file of ['shared/platforms.js','shared/model.js','shared/store.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  const S=context.PromptFlowStore;
  await Promise.all([S.saveFlow({id:'one',title:'甲',steps:[{text:'原文甲'}]}),S.saveFlow({id:'two',title:'乙',steps:[{text:'原文乙'}]})]);
  assert.equal((await S.readLibrary()).flows.length,2);
  await S.trashFlow('one');
  assert.equal((await S.readLibrary()).flows.length,1);assert.equal((await S.readTrash())[0].flow.steps[0].text,'原文甲');
  const backup=await S.exportLibrary();assert.equal(backup.flows.length,1);assert.equal(backup.flows[0].id,'two');
  await S.restoreFlow('one');
  assert.equal((await S.readLibrary()).flows.length,2);assert.equal((await S.readTrash()).length,0);
  assert.equal((await S.exportLibrary()).flows.length,2);
  await S.trashFlow('one');await S.deleteTrashedFlow('one');
  assert.equal((await S.readTrash()).length,0);
  assert.equal((await S.readLibrary()).flows[0].id,'two');
  await assert.rejects(S.restoreFlow('one'),/找不到/);
  for(const id of ['three','four','five'])await S.saveFlow({id,steps:[{text:id}]});
  await S.trashFlow('three');await S.trashFlow('four');const selected=(await S.readTrash()).map(item=>item.flow.id);
  await S.trashFlow('five');
  assert.equal(await S.deleteTrashedFlows(selected),2);
  assert.deepEqual(Array.from((await S.readTrash()).map(item=>item.flow.id)),['five']);
  assert.equal((await S.readLibrary()).flows[0].id,'two');
  assert.equal(await S.deleteTrashedFlows(selected),0);
  await S.restoreFlow('five');assert.equal((await S.readTrash()).length,0);
});
