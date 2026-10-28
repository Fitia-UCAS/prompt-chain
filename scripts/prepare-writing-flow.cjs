const fs = require('node:fs');
const path = require('node:path');
require('../shared/model.js');
const C = require('../shared/chat-import.js');
const M = globalThis.PromptFlowModel;
const Match=require('../shared/file-match.js');
const [project, destination] = process.argv.slice(2);
if (!project || !destination) throw new Error('Usage: node prepare-writing-flow.cjs <novel-project> <output-directory>');
const source = path.join(project, 'prompts', '如何让ChatGPT写出我想要的感觉.md');
const parsed = C.parse(fs.readFileSync(source,'utf8'));
const candidates = [];
function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const item of fs.readdirSync(directory,{withFileTypes:true})) {
    const full = path.join(directory,item.name);
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory()) walk(full); else if(item.isFile()) candidates.push(full);
  }
}
for(const folder of ['prompts','settings','plots'])walk(path.join(project,folder));
candidates.push(path.join(project,'修仙界没有病娇.txt'));
const files = [], mapping = new Map(), missing = [];
const steps = parsed.steps.map(raw=>{
  const value={...raw}, ref=value.importAttachment;
  if(!ref&&Match.sourceHint(value.text)){
    const hint=Match.sourceHint(value.text),stem=name=>name.replace(/\.(md|markdown|txt)$/i,'').replace(/^\d+[-_. ]+/,'');
    const matches=candidates.filter(file=>stem(path.basename(file))===stem(hint)&&Match.sourceText(fs.readFileSync(file,'utf8'))===Match.sourceText(value.text));
    if(matches.length===1){const full=matches[0],bytes=fs.readFileSync(full),stored=M.fileRef({id:M.id(),name:path.basename(full),size:bytes.length,mimeType:'text/markdown'});files.push({...stored,dataBase64:bytes.toString('base64')});mapping.set(full,stored);value.sourceText=value.text;value.text='';value.attachment=stored;value.autoTitle=true;value.title=stored.name;}
  }
  if(ref){
    const matches=candidates.filter(file=>path.basename(file)===ref.name);
    if(matches.length!==1){missing.push(ref.name);return M.step(value);}
    const full=matches[0];
    if(!mapping.has(full)){
      const bytes=fs.readFileSync(full),stored=M.fileRef({id:M.id(),name:ref.name,size:bytes.length,mimeType:ref.mimeType});
      files.push({...stored,dataBase64:bytes.toString('base64')});mapping.set(full,stored);
    }
    value.attachment=mapping.get(full);value.missingAttachment=null;
  }
  return M.step(value);
});
const flow=M.flow({title:'如何让 AI 写出我想要的感觉',steps});
fs.mkdirSync(destination,{recursive:true});
const bundle={format:'prompt-flow',version:1,exportedAt:Date.now(),flows:[flow],files};
const output=path.join(destination,'如何让AI写出我想要的感觉.promptflow.json');
fs.writeFileSync(output,JSON.stringify(bundle));
const table=['# 写作开场流程','',`从原记录的 ${parsed.turns.length} 轮用户消息整理为 ${steps.length} 步；${files.length} 个附件已打包。`,'',
  '| 步骤 | 原轮次 | 名称 | 发送方式 |','|---|---|---|---|',
  ...steps.map((s,i)=>`| ${i+1} | ${s.sourceTurn} | ${s.attachment?.name||s.title.replace(/^第 \d+ 轮 · /,'').replace(/\|/g,'／')} | ${s.attachment?'原文件附件':'原文提示词'} |`),
  '','未加入：05 压缩版、06 纠错词，以及其他未在本次聊天中使用的写作风格提示词。','',
  '同轮多个附件按原附件列表顺序拆步，原消息文字保留在该组第一步。最后的反思与重写也保留，可编辑、跳过或删除。','',
  '这份 JSON 内含小说、角色设定和参考作品的原文件，仅供你在本机导入使用。插件安装包不包含这些内容。',
  ...(missing.length?['','未找到的附件：',...missing.map(name=>'- '+name)]:[])
].join('\n');
fs.writeFileSync(path.join(destination,'写作开场-步骤清单.md'),table);
console.log(JSON.stringify({output,turns:parsed.turns.length,steps:steps.length,files:files.length,missing,bytes:fs.statSync(output).size},null,2));
