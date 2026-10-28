const {test}=require('node:test');
const assert=require('node:assert/strict');
const Match=require('../shared/file-match.js');
function file(name,text='text'){return{kind:'file',async getFile(){return new File([text],name,{type:'text/plain'});}};}
function dir(name,entries,permission='granted'){return{name,kind:'directory',async queryPermission(){return permission;},async *entries(){for(const entry of entries)yield entry;}};}
const store={async saveFile(f){return{id:f.name,name:f.name,size:f.size,mimeType:f.type};}};
test('导出展示格式只在与本地原文件完整核对一致时转为附件，并使用文件名',async()=>{
  const raw='**---**\n**name:&#x20;**_example_\n**---**\n\n**# 定义**\n\n正文。',original='---\nname: example\n---\n\n# 定义\n\n正文。';
  const flow={steps:[{text:raw}]};await Match.match(flow,dir('prompts',[['02-example.md',file('02-example.md',original)]]),store);
  assert.equal(flow.steps[0].text,'');assert.equal(flow.steps[0].title,'02-example.md');assert.equal(flow.steps[0].sourceText,raw);
  const changed={steps:[{text:raw}]};await Match.match(changed,dir('prompts',[['02-example.md',file('02-example.md',original+'本地新增。')]]),store);
  assert.equal(changed.steps[0].text,raw);assert.equal(changed.steps[0].attachment,undefined);
});
test('递归匹配目录，只读取需要的文件，重复步骤复用附件',async()=>{
  const flow={steps:[{missingAttachment:{name:'a.md'}},{missingAttachment:{name:'a.md'}},{missingAttachment:{name:'b.txt'}}]};
  const root=dir('prompts',[['sub',dir('sub',[['a.md',file('a.md')]])],['b.txt',file('b.txt')],['unused.txt',{kind:'file',getFile(){throw Error('must not read');}}]]);
  const report=await Match.match(flow,root,store);
  assert.equal(report.matched,3);assert.equal(report.remaining,0);assert.equal(flow.steps[0].attachment.id,flow.steps[1].attachment.id);
});
test('同名文件不擅自选择，权限失效时不读取目录',async()=>{
  const flow={steps:[{missingAttachment:{name:'a.md'}}]},root=dir('root',[['one',dir('one',[['a.md',file('a.md')]])],['two',dir('two',[['a.md',file('a.md')]])]]);
  const report=await Match.match(flow,root,store);assert.deepEqual(report.ambiguous,['a.md']);assert.equal(report.matched,0);assert.ok(flow.steps[0].missingAttachment);
  const denied=dir('root',[],'prompt');denied.entries=()=>{throw Error('must not scan');};
  const permission=await Match.match(flow,denied,store);assert.equal(permission.permissionRequired,true);
});
test('目录权限失效后复用原附件缓存，不弹出授权或再次保存',async()=>{
  const flow={steps:[{missingAttachment:{name:'a.md'}}]},ref={id:'cached',name:'a.md',size:4,mimeType:'text/plain'};
  const root=dir('root',[],'prompt');root.entries=()=>{throw Error('不得读取失效目录');};root.requestPermission=()=>{throw Error('不得反复授权');};
  const report=await Match.match(flow,root,{async sourceFiles(){return[{path:'a.md',name:'a.md',ref}];},async saveFile(){throw Error('应复用已有缓存');}});
  assert.equal(report.matched,1);assert.equal(report.remaining,0);assert.equal(flow.steps[0].attachment.id,'cached');assert.equal(flow.steps[0].missingAttachment,null);
});
