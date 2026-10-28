(() => {
  const M=PromptFlowModel,S=PromptFlowStore,N=PromptChainUpstreamStorage;
  let db;
  const nativeDB=()=>db ||= new Promise((resolve,reject)=>{const r=indexedDB.open('langqueue_attachments',1);r.onupgradeneeded=()=>r.result.createObjectStore('attachments',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  async function readFile(id){const database=await nativeDB();return new Promise((resolve,reject)=>{const r=database.transaction('attachments','readonly').objectStore('attachments').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  const fileLike=record=>({name:record.name,type:record.mimeType,size:record.size,arrayBuffer:async()=>record.bytes});
  const nativeId=flow=>flow.id.startsWith('native-')?flow.id.slice(7):'pc-'+flow.id;
  async function syncFlow(input){
    const flow=M.flow(input),pending=new Map(),steps=[];
    for(const step of flow.steps){
      const attachments=[];
      for(const ref of step.attachments||(step.attachment?[step.attachment]:[])){
        const file=await S.getFile(ref.id);if(!file)throw new Error('找不到附件：'+ref.name);
        const id='pc_'+file.id;
        attachments.push({id,name:file.name,mimeType:file.mimeType,size:file.size,kind:file.mimeType.startsWith('image/')?'image':'file',createdAt:Date.now()});
        pending.set(id,fileLike(file));
      }
      for(const ref of step.missingAttachments||(step.missingAttachment?[step.missingAttachment]:[]))attachments.push({id:'pc-missing:'+ref.name,name:ref.name,mimeType:ref.mimeType||'application/octet-stream',size:1,kind:'file',createdAt:Date.now()});
      steps.push({content:step.text,attachments});
    }
    await N.s({id:nativeId(flow),title:flow.title,description:flow.description,steps,createdAt:flow.createdAt,updatedAt:Date.now()},pending);
    return nativeId(flow);
  }
  async function attachment(ref){
    if(ref.id.startsWith('pc-missing:'))return{missingAttachment:{name:ref.name,mimeType:ref.mimeType}};
    if(ref.id.startsWith('pc_')){const local=await S.getFile(ref.id.slice(3));if(local&&local.name===ref.name&&local.size===ref.size)return{attachment:M.fileRef(local)};}
    const file=await readFile(ref.id);if(!file) return{missingAttachment:{name:ref.name,mimeType:ref.mimeType}};
    return{attachment:await S.saveFile(fileLike(file),'native_'+ref.id)};
  }
  async function toFlow(payload){
    const chains=await N.d(),chain=chains.find(c=>c.id===payload.chainId)||chains.find(c=>JSON.stringify(c.steps)===JSON.stringify(payload.steps));
    if(!chain)throw new Error('请先保存流程，再启动');
    const id=chain.id.startsWith('pc-')?chain.id.slice(3):'native-'+chain.id;
    const previous=(await S.readLibrary()).flows.find(f=>f.id===id),steps=[],consumed=new Set();
    for(const step of chain.steps){
      const attachments=[],missingAttachments=[];
      for(const ref of step.attachments||[]){const converted=await attachment(ref);if(converted.attachment)attachments.push(converted.attachment);else if(converted.missingAttachment)missingAttachments.push(converted.missingAttachment);}
      const old=previous?.steps.find((item,index)=>{if(consumed.has(index))return false;const names=(item.attachments||[]).map(v=>v.name).concat((item.missingAttachments||[]).map(v=>v.name));const other=(step.attachments||[]).map(v=>v.name);if(item.text===step.content&&JSON.stringify(names)===JSON.stringify(other)){consumed.add(index);return true;}return false;});
      steps.push(M.step({...old,id:old?.id||M.id(),text:step.content,attachments,missingAttachments,autoTitle:old?.autoTitle??true}));
    }
    const flow=M.flow({...previous,id,title:chain.title,steps,createdAt:previous?.createdAt||chain.createdAt});await S.saveFlow(flow);return flow;
  }
  async function migrate(){
    await N.n(await N.g());
    const stored=await chrome.storage.local.get('langqueue_prompts');
    if(!stored.langqueue_prompts)await chrome.storage.local.set({langqueue_prompts:{meta:{schemaVersion:3,createdAt:Date.now(),updatedAt:Date.now()},promptsById:{}}});
    const chains=await N.d(),existing=new Map(chains.map(c=>[c.id,c]));let count=0;
    for(const flow of (await S.readLibrary()).flows){const chain=existing.get(nativeId(flow));if(!chain||(!chain.steps.length&&flow.steps.length)){await syncFlow(flow);count++;}}
    return count;
  }
  globalThis.PromptChainNative={syncFlow,toFlow,migrate,nativeId};
  chrome.runtime.onMessage.addListener((message,sender)=>{
    if(message?.type==='OPEN_PROMPT_EDITOR'&&sender.tab?.id)chrome.sidePanel.open({tabId:sender.tab.id}).catch(()=>{});
  });
})();
