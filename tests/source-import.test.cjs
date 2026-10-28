const {test}=require('node:test');
const assert=require('node:assert/strict');
globalThis.PromptFlowModel=require('../shared/model.js');
const Sources=require('../shared/source-import.js');
test('Prompts 导入同一步合并多附件，保留正文，恢复真实二进制',async()=>{
  const saved=[];const store={decode:text=>Buffer.from(text,'base64'),async saveFile(file){saved.push(await file.text());return{id:file.name,name:file.name,size:file.size,mimeType:file.type};}};
  const items=await Sources.json({prompts:[{title:'示例',content:'原文。',attachments:[{id:'f',name:'a.txt'},{name:'b.txt'}]}],attachments:[{id:'f',name:'a.txt',size:3,dataBase64:'YWJj'}]},store);
  assert.deepEqual(saved,['abc']);assert.equal(items[0].steps.length,1);assert.equal(items[0].steps[0].text,'原文。');assert.equal(items[0].steps[0].attachments[0].name,'a.txt');assert.equal(items[0].steps[0].missingAttachments[0].name,'b.txt');
});
test('自己的流程备份只还原待选内容，不提前重复导入库',async()=>{
  let options;const items=await Sources.json({format:'prompt-flow'}, {async importBundle(data,value){options=value;return[{title:'序列',steps:[{text:'完整原文'}]}];}});
  assert.equal(options.materializeOnly,true);assert.equal(items[0].steps[0].text,'完整原文');
});
test('Markdown 和 Skill 原文保持不变，技能目录按文件路径排列',async()=>{
  const raw='---\nname: example\n---\n\n# 标题\n\n保留 **正文**。';
  const files=await Sources.files([new File([raw],'example.md')],{});assert.equal(files[0].steps[0].text,raw);
  const file=text=>({kind:'file',async getFile(){return new File([text],'SKILL.md');}}),dir=(name,entries)=>({kind:'directory',name,async *entries(){yield* entries;}});
  const items=await Sources.skills(dir('skills',[['02-two',dir('02-two',[['SKILL.md',file('第二份')]])],['01-one',dir('01-one',[['SKILL.md',file(raw)]])],['other.md',file('忽略')]]));
  assert.deepEqual(items.map(item=>item.title),['01-one','02-two']);assert.equal(items[0].steps[0].text,raw);
});
