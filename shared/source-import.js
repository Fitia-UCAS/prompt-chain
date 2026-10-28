(function(root){
  const M=root.PromptFlowModel;
  function list(value){if(Array.isArray(value))return value;if(value?.promptsById)return Object.values(value.promptsById);if(Array.isArray(value?.items))return value.items;return value&&typeof value==='object'?Object.values(value).filter(item=>item&&typeof item==='object'&&('content'in item||'steps'in item)):[];}
  async function json(data,store){
    if(data?.format==='prompt-flow')return(await store.importBundle(data,{materializeOnly:true})).map(flow=>({title:flow.title,steps:flow.steps}));
    const files=new Map();
    for(const entry of list(data?.attachments||data?.files)){
      if(typeof entry.dataBase64!=='string')continue;
      const bytes=store.decode(entry.dataBase64);if(entry.size!==undefined&&entry.size!==bytes.byteLength)throw new Error('附件大小不符：'+entry.name);
      const ref=await store.saveFile(new File([bytes],entry.name,{type:entry.mimeType||entry.type||'application/octet-stream'}));files.set(String(entry.id),ref);
    }
    async function steps(record){
      const text=String(record.content??record.text??record.prompt??''),refs=record.attachments||[];
      if(!refs.length)return text.trim()?[M.step({text,autoTitle:true})]:[];
      const attachments=[],missingAttachments=[];
      for(const item of refs){
        const source=typeof item==='string'?{name:item}:item;
        let ref=files.get(String(source.id));
        if(!ref&&source.id){const saved=await store.getFile?.(source.id)||await store.getFile?.(String(source.id).replace(/^pc_/,''));if(saved)ref=M.fileRef(saved);}
        if(ref)attachments.push(ref);else missingAttachments.push({name:source.name||source.filename||'附件',mimeType:source.mimeType});
      }
      return [M.step({text,attachments,missingAttachments,autoTitle:true})];
    }
    const items=[];
    for(const prompt of Array.isArray(data)?data:list(data?.prompts||data?.promptsById)){const content=await steps(prompt);if(content.length)items.push({title:String(prompt.title||prompt.name||M.firstSentence(content[0].text)),steps:content});}
    for(const chain of list(data?.chains||data?.flows)){const content=[];for(const entry of chain.steps||[])content.push(...await steps(entry));if(content.length)items.push({title:String(chain.title||chain.name||'提示词序列'),steps:content});}
    if(!items.length&&data&&('content'in data||'prompt'in data||'text'in data)){const content=await steps(data);if(content.length)items.push({title:String(data.title||data.name||M.firstSentence(content[0].text)),steps:content});}
    if(!items.length)throw new Error('文件中没有可导入的提示词或序列');return items;
  }
  async function files(input,store){
    const items=[];
    for(const file of input){if(file.size>150*1024*1024)throw new Error('导入文件超过 150 MB');const text=await file.text();if(/\.json$/i.test(file.name))items.push(...await json(JSON.parse(text),store));else if(text.trim())items.push({title:file.name.replace(/\.[^.]+$/,''),steps:[M.step({text,autoTitle:true})]});}
    return items;
  }
  async function skills(handle){
    const found=[];let visited=0;
    async function walk(directory,path='',depth=0){
      if(depth>20)throw new Error('目录层级过深');
      for await(const[name,entry]of directory.entries()){
        if(++visited>50000)throw new Error('目录文件过多');
        if(entry.kind==='directory'){if(!name.startsWith('.')&&name!=='node_modules')await walk(entry,path+name+'/',depth+1);}
        else if(/^SKILL\.md$/i.test(name)){const file=await entry.getFile();const text=await file.text();if(text.trim())found.push({path:path+name,title:path.split('/').filter(Boolean).at(-1)||directory.name,steps:[M.step({text,autoTitle:true})]});}
      }
    }
    await walk(handle);found.sort((a,b)=>a.path.localeCompare(b.path,undefined,{numeric:true}));if(!found.length)throw new Error('所选目录没有 SKILL.md');return found;
  }
  root.PromptChainSources={json,files,skills};if(typeof module!=='undefined')module.exports=root.PromptChainSources;
})(globalThis);
