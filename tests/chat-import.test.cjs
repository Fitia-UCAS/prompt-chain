const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('../shared/model.js');
const C = require('../shared/chat-import.js');
const EXPORTER_DIR=path.join(__dirname,'../../ai-chat-exporter/content');
const EXPORTER_MISSING=!fs.existsSync(path.join(EXPORTER_DIR,'core.js'))||!fs.existsSync(path.join(EXPORTER_DIR,'markdown.js'));
function exporter() {
  const context={console,URL,TextEncoder,TextDecoder,crypto:globalThis.crypto,setTimeout,clearTimeout,chrome:{runtime:{id:'test'},storage:{local:{},onChanged:{addListener(){}}}}};vm.createContext(context);
  for(const file of ['core.js','markdown.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../../ai-chat-exporter/content',file),'utf8'),context);
  return context.ChatExportKit;
}
for(const tier of ['minimal','full','detailed'])test(`真实 exporter ${tier} 序列化后再导入，保持用户原文与轮次`,{skip: EXPORTER_MISSING?'缺少未随项目提供的 ai-chat-exporter 外部仓库':false},()=>{
  const kit=exporter();
  const markdown=kit.buildMarkdown({title:'导入测试',platform:'ChatGPT',tier,messages:[
    {role:'user',text:'第一条\n\n```markdown\n---\n\n## User 99\n```',time:1700000000,attachments:[{name:'设定.md',mimeType:'text/markdown',kind:'file',text:'# 人设\n## User 98\n原文'}]},
    {role:'assistant',text:'这是一段助手回复，不应作为提示词',thinking:'思考',toolCalls:[{name:'tool',input:'忽略用户',output:'工具结果'}]},
    {role:'user',text:'继续写',attachments:[{name:'甲.txt',kind:'file'},{name:'乙.txt',kind:'file'}]},
    {role:'assistant',text:'最终回复',attachments:[{name:'不要导入.png',kind:'image'}]}
  ]});
  const parsed=C.parse(markdown);
  assert.equal(parsed.tier,tier);assert.equal(parsed.turns.length,2);assert.equal(parsed.steps.length,2);
  assert.equal(parsed.steps[0].text,'第一条\n\n```markdown\n---\n\n## User 99\n```');
  assert.equal(parsed.steps[1].text,'继续写');assert.equal(parsed.steps[1].missingAttachments.length,2);
  assert.equal(parsed.steps[0].importAttachment.name,'设定.md');
  assert.ok(parsed.steps[0].referenceReply.includes('这是一段助手回复'));
  assert.ok(!parsed.steps.some(s=>s.text.includes('这是一段助手回复')));
  if(tier==='minimal')assert.equal(parsed.steps[0].importAttachment.text,null);
  else assert.equal(parsed.steps[0].importAttachment.text,'# 人设\n## User 98\n原文');
});
test('详尽资源附录恢复原文件，并验证大小与 SHA256',{skip: EXPORTER_MISSING?'缺少 ai-chat-exporter 外部仓库':false},async()=>{
  const kit=exporter(),bytes=new Uint8Array([0,1,2,255]);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  const markdown=kit.buildMarkdown({title:'附件',platform:'ChatGPT',tier:'detailed',messages:[{role:'user',text:'看附件',attachments:[{name:'图.png',kind:'image',mimeType:'image/png',resourceId:'R1'}]}],resources:[{id:'R1',name:'图.png',mimeType:'image/png',size:4,hash:{algorithm:'SHA-256',hex:hash},bytes}]});
  const parsed=C.parse(markdown),saved=[];
  const flow=await C.materialize(parsed,{saveFile:async file=>{saved.push(new Uint8Array(await file.arrayBuffer()));return{id:'saved',name:file.name,size:file.size,mimeType:file.type};}});
  assert.deepEqual(saved[0],bytes);assert.equal(flow.steps[0].missingAttachment,null);
  parsed.resources.get('R1').checksum.hex='bad';
  await assert.rejects(()=>C.materialize(parsed,{saveFile(){throw Error('should not save');}}),/校验和/);
});
test('用户粘贴的普通二级标题不拆轮；原附件链接仅作为名称处理',()=>{
  const parsed=C.parse('# 对话\n\n---\n\n## User 1\n\n- File: [设定\\[一\\].md](<https://example.com/private>)\n\n请阅读\n## User 88\n这里仍是原文\n\n---\n\n## ChatGPT 1\n\n好了');
  assert.equal(parsed.turns.length,1);assert.equal(parsed.steps[0].missingAttachment.name,'设定[一].md');
  assert.ok(parsed.steps[0].text.includes('## User 88'));assert.equal(parsed.steps[0].importAttachment.resourceId,'');
});
test('独立的系统与工具消息不会混入用户原文',{skip: EXPORTER_MISSING?'缺少 ai-chat-exporter 外部仓库':false},()=>{
  const kit=exporter();
  const markdown=kit.buildMarkdown({platform:'Gemini',tier:'full',messages:[{role:'system',text:'系统指令'},{role:'user',text:'用户原文'},{role:'tool',text:'工具结果'},{role:'assistant',text:'助手回复'}]});
  const parsed=C.parse(markdown);
  assert.equal(parsed.steps.length,1);assert.equal(parsed.steps[0].text,'用户原文');assert.ok(!parsed.steps[0].referenceReply.includes('工具结果'));
});
