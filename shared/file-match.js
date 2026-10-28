(function(root) {
  'use strict';
  function sourceText(text){return String(text||'').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim().replace(/^\*\*---\*\*$/gm,'---').replace(/^\*\*name:(?:&#x20;|\s)*\*\*_([^\n]+)_$/gm,'name: $1').replace(/^\*\*(#{1,6} [^\n]+)\*\*$/gm,'$1');}
  function sourceHint(text){return /^---\nname:\s*([^\n]+)\n---(?:\n|$)/.exec(sourceText(text))?.[1]?.trim()||'';}
  const missingOf=step=>step.missingAttachments||(step.missingAttachment?[step.missingAttachment]:[]);
  const attachmentsOf=step=>step.attachments||(step.attachment?[step.attachment]:[]);
  const canMatch=flow=>flow.steps.some(s=>missingOf(s).length||(!attachmentsOf(s).length&&sourceHint(s.text)));
  async function granted(directory){try{return!!directory&&await directory.queryPermission({mode:'read'})==='granted';}catch{return false;}}
  async function walk(handle,visit,path='',depth=0,state={visited:0}){
    if(depth>20)throw new Error('目录层级过深');
    for await(const[name,entry]of handle.entries()){
      if(++state.visited>50000)throw new Error('目录文件过多，请选择更小的目录');
      if(entry.kind==='directory'){if(!name.startsWith('.')&&name!=='node_modules')await walk(entry,visit,path+name+'/',depth+1,state);}
      else await visit({name,path:path+name,getFile:()=>entry.getFile()});
    }
  }
  async function cacheDirectory(directory,store){
    if(!await granted(directory)||!store.cacheSourceFile)return{cached:0};let cached=0;
    await walk(directory,async entry=>{if(!/\.(?:md|markdown|txt|json|pdf|docx|csv|xlsx|png|jpe?g|webp|gif)$/i.test(entry.name))return;const file=await entry.getFile();if(file.size>0){await store.cacheSourceFile(entry.path,file);cached++;}});
    return{cached};
  }
  async function match(flow, directory, store) {
    const missing = flow.steps.filter(s => missingOf(s).length), wanted = new Set(missing.flatMap(s=>missingOf(s).map(ref=>ref.name)));
    const inline=flow.steps.filter(s=>!attachmentsOf(s).length&&!missingOf(s).length&&sourceHint(s.text)),candidates=[];
    const stem=name=>name.replace(/\.(?:md|markdown|txt)$/i,'').replace(/^\d+[-_. ]+/,'').toLowerCase();
    const found = new Map();
    if (!missing.length&&!inline.length) return {matched:0, remaining:0, ambiguous:[]};
    const collect=entry=>{const name=entry.name;if(wanted.has(name)){const list=found.get(name)||[];list.push(entry);found.set(name,list);}if(/\.(?:md|markdown|txt)$/i.test(name)&&inline.some(s=>stem(name)===stem(sourceHint(s.text))))candidates.push(entry);};
    const live=await granted(directory);
    if(live)await walk(directory,collect);else{const cached=await store.sourceFiles?.()||[];for(const entry of cached)collect(entry);if(!cached.length)return{matched:0,remaining:missing.reduce((n,s)=>n+missingOf(s).length,0),ambiguous:[],permissionRequired:!!directory};}
    const save=async entry=>entry.ref||(store.cacheSourceFile?store.cacheSourceFile(entry.path,await entry.getFile()):store.saveFile(await entry.getFile()));
    const saved = new Map(), ambiguous = []; let matched = 0;
    for(const s of missing){
      const remaining=[];
      for(const ref of missingOf(s)){
        const matches=found.get(ref.name)||[];
        if(matches.length>1){if(!ambiguous.includes(ref.name))ambiguous.push(ref.name);remaining.push(ref);continue;}
        if(matches.length!==1){remaining.push(ref);continue;}
        if(!saved.has(ref.name))saved.set(ref.name,await save(matches[0]));
        s.attachments=[...(s.attachments||[]),{...saved.get(ref.name)}];matched++;
      }
      s.missingAttachments=remaining;s.missingAttachment=remaining[0]||null;s.attachment=s.attachments?.[0]||null;
    }
    let converted=0;
    for(const s of inline){
      const matches=[];
      for(const candidate of candidates.filter(c=>stem(c.name)===stem(sourceHint(s.text)))){const file=await candidate.getFile();if(sourceText(await file.text())===sourceText(s.text))matches.push(candidate);}
      if(matches.length>1){ambiguous.push(sourceHint(s.text));continue;}if(matches.length!==1)continue;
      s.sourceText=s.text;s.attachment=await save(matches[0]);s.attachments=[s.attachment];s.text='';s.title=s.attachment.name;s.autoTitle=true;converted++;matched++;
    }
    return {matched,remaining:missing.reduce((n,s)=>n+missingOf(s).length,0),ambiguous};
  }
  root.PromptFlowFileMatch = {match,canMatch,sourceText,sourceHint,cacheDirectory};
  if (typeof module !== 'undefined') module.exports = root.PromptFlowFileMatch;
})(globalThis);
