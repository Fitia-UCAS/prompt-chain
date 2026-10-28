(function (root) {
  'use strict';
  let dbPromise;
  let libraryQueue=Promise.resolve();
  let sourceQueue=Promise.resolve();
  const queueLibrary=action=>{const result=libraryQueue.then(action);libraryQueue=result.catch(()=>{});return result;};
  const queueSource=action=>{const execute=()=>root.navigator?.locks?root.navigator.locks.request('prompt-chain-source-cache',action):action();const result=sourceQueue.then(execute);sourceQueue=result.catch(()=>{});return result;};
  function database() {
    return dbPromise ||= new Promise((resolve, reject) => {
      const request = indexedDB.open('prompt-flow-files', 2);
      request.onupgradeneeded = () => {
        for (const name of ['files', 'settings']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, {keyPath: 'id'});
      };
      request.onsuccess = () => {request.result.onversionchange = () => {request.result.close(); dbPromise = null;}; resolve(request.result);};
      request.onerror = () => {dbPromise = null; reject(request.error);};
    });
  }
  async function transaction(mode, action, name = 'files') {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode), request = action(tx.objectStore(name));
      let result;
      request.onsuccess = () => {result = request.result;};
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('无法保存附件'));
    });
  }
  async function saveFile(file, fileId = crypto.randomUUID()) {
    const ref = PromptFlowModel.fileRef({id: fileId, name: file.name, size: file.size, mimeType: file.type});
    const bytes = await file.arrayBuffer();
    await transaction('readwrite', store => store.put({...ref, bytes}));
    return ref;
  }
  const getFile = fileId => transaction('readonly', store => store.get(fileId));
  const getDirectory = () => transaction('readonly', store => store.get('source-directory'), 'settings');
  function saveDirectory(handle){return queueSource(async()=>{
    const previous=await getDirectory();let same=false;try{same=!!previous?.handle&&await previous.handle.isSameEntry(handle);}catch{}
    const value={id:'source-directory',name:handle.name,handle,cacheId:same&&previous.cacheId?previous.cacheId:crypto.randomUUID()};
    await transaction('readwrite',store=>store.put(value),'settings');return value;
  });}
  async function sourceIndex(){
    let directory=await getDirectory();if(!directory)return null;
    if(!directory.cacheId){directory={...directory,cacheId:crypto.randomUUID(),legacyCache:true};await transaction('readwrite',store=>store.put(directory),'settings');}
    const id='source-cache:'+directory.cacheId;
    return await transaction('readonly',store=>store.get(id),'settings')||{id,entries:[],legacyCache:!!directory.legacyCache};
  }
  function cacheSourceFile(path,file){
    return queueSource(async()=>{
      const index=await sourceIndex();if(!index)return saveFile(file);
      const old=index.entries.find(entry=>entry.path===path),bytes=await file.arrayBuffer(),saved=old?await getFile(old.ref.id):null;
      if(saved&&saved.name===file.name&&saved.size===file.size&&saved.mimeType===(file.type||'application/octet-stream')){
        const hashes=await Promise.all([crypto.subtle.digest('SHA-256',bytes),crypto.subtle.digest('SHA-256',saved.bytes)]);
        if(new Uint8Array(hashes[0]).every((value,index)=>value===new Uint8Array(hashes[1])[index]))return old.ref;
      }
      const ref=await saveFile({name:file.name,type:file.type,size:file.size,arrayBuffer:async()=>bytes},'source-'+crypto.randomUUID());
      index.entries=[...index.entries.filter(entry=>entry.path!==path),{path,ref}];
      await transaction('readwrite',store=>store.put(index),'settings');return ref;
    });
  }
  function sourceFiles(bootstrap=true){return queueSource(async()=>{
    const index=await sourceIndex();if(!index)return[];
    if(bootstrap&&index.legacyCache&&!index.entries.length){
      const stored=await transaction('readonly',store=>store.getAll()),seen=new Set();
      for(const file of stored){
        if(!file.bytes||file.bytes.byteLength!==file.size)continue;
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',file.bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
        const key=file.name+'|'+digest;if(seen.has(key))continue;seen.add(key);
        index.entries.push({path:'@saved/'+digest+'/'+file.name,ref:PromptFlowModel.fileRef(file)});
      }
      if(index.entries.length)await transaction('readwrite',store=>store.put(index),'settings');
    }
    return index.entries.map(entry=>({...entry,name:entry.ref.name,getFile:async()=>{const saved=await getFile(entry.ref.id);if(!saved||saved.size!==saved.bytes?.byteLength)throw new Error('附件缓存缺失：'+entry.ref.name);return new File([saved.bytes],saved.name,{type:saved.mimeType});}}));
  });}
  function base64(bytes) {
    const data = new Uint8Array(bytes); let text = '';
    for (let i = 0; i < data.length; i += 32768) text += String.fromCharCode(...data.subarray(i, i + 32768));
    return btoa(text);
  }
  function decode(text) {const raw = atob(text); return Uint8Array.from(raw, c => c.charCodeAt(0));}
  async function readLibrary() {return (await chrome.storage.local.get('pfLibrary')).pfLibrary || {flows: [], selectedId: ''};}
  function saveFlow(input) {
    const value=PromptFlowModel.flow(input);
    return queueLibrary(async()=>{
      const library=await readLibrary();
      library.flows=[value,...library.flows.filter(f=>f.id!==value.id)];library.selectedId=value.id;
      await chrome.storage.local.set({pfLibrary:library});return value;
    });
  }
  const readTrash=async()=>(await chrome.storage.local.get('pfTrash')).pfTrash||[];
  function trashFlow(id) {
    return queueLibrary(async()=>{
      const library=await readLibrary(),trash=await readTrash(),flow=library.flows.find(f=>f.id===id);
      if(!flow)throw new Error('找不到该流程');
      library.flows=library.flows.filter(f=>f.id!==id);
      if(library.selectedId===id)library.selectedId=library.flows[0]?.id||'';
      await chrome.storage.local.set({pfLibrary:library,pfTrash:[{flow,deletedAt:Date.now()},...trash.filter(item=>item.flow.id!==id)]});return flow;
    });
  }
  function restoreFlow(id) {
    return queueLibrary(async()=>{
      const library=await readLibrary(),trash=await readTrash(),item=trash.find(item=>item.flow.id===id);
      if(!item)throw new Error('找不到已删除的流程');
      library.flows=[item.flow,...library.flows.filter(f=>f.id!==id)];library.selectedId=id;
      await chrome.storage.local.set({pfLibrary:library,pfTrash:trash.filter(item=>item.flow.id!==id)});return item.flow;
    });
  }
  function deleteTrashedFlow(id) {
    return deleteTrashedFlows([id]).then(count=>{if(!count)throw new Error('找不到已删除的流程');});
  }
  function deleteTrashedFlows(ids) {
    const selectedIds=new Set(ids);
    return queueLibrary(async()=>{
      const library=await readLibrary(),trash=await readTrash(),selected=trash.filter(item=>selectedIds.has(item.flow.id));
      if(!selected.length)return 0;
      const remaining=trash.filter(item=>!selectedIds.has(item.flow.id)),run=(await chrome.storage.local.get('pfRun')).pfRun;
      const retained=[...library.flows,...remaining.map(item=>item.flow),...(PromptFlowModel.ACTIVE.has(run?.status)?[run.flow]:[])];
      const used=new Set(retained.flatMap(flow=>flow.steps.flatMap(step=>(step.attachments|| (step.attachment?[step.attachment]:[])).map(ref=>ref.id))));
      const attachments=new Set(selected.flatMap(item=>item.flow.steps.flatMap(step=>(step.attachments|| (step.attachment?[step.attachment]:[])).map(ref=>ref.id))));
      if(attachments.size)for(const entry of await sourceFiles(false))used.add(entry.ref.id);
      await chrome.storage.local.set({pfTrash:remaining});
      for(const fileId of attachments)if(!used.has(fileId))await transaction('readwrite',store=>store.delete(fileId));
      return selected.length;
    });
  }
  async function exportFlows(flows) {
    const refs=[...new Map(flows.flatMap(flow=>flow.steps.flatMap(s=>(s.attachments|| (s.attachment?[s.attachment]:[])).map(ref=>[ref.id,ref])))).values()];
    const files = [];
    for (const ref of refs) {
      const file = await getFile(ref.id); if (!file) throw new Error(`找不到附件：${ref.name}`);
      files.push({...ref, dataBase64: base64(file.bytes)});
    }
    return {format: 'prompt-flow', version: 1, exportedAt: Date.now(), flows, files};
  }
  const exportFlow=input=>exportFlows([PromptFlowModel.flow(input)]);
  async function exportLibrary(){await libraryQueue;return exportFlows((await readLibrary()).flows.map(PromptFlowModel.flow));}
  async function importBundle(bundle,options={}) {
    if (bundle?.format !== 'prompt-flow' || bundle.version !== 1 || !Array.isArray(bundle.flows) || !Array.isArray(bundle.files)) throw new Error('请选择 Prompt Chain 流程备份');
    const refs = new Map(), staged = [], flows = bundle.flows.map(PromptFlowModel.flow);
    for (const entry of bundle.files) {
      const ref = PromptFlowModel.fileRef(entry);
      if (refs.has(ref.id)) throw new Error('备份里有重复附件编号');
      if (typeof entry.dataBase64 !== 'string') throw new Error('附件编码无效');
      const bytes = decode(entry.dataBase64);
      if (bytes.byteLength !== ref.size) throw new Error(`附件大小不符：${ref.name}`);
      const newRef = {...ref, id: crypto.randomUUID()}; refs.set(ref.id, newRef);
      staged.push({...newRef, bytes: bytes.buffer});
    }
    for (const f of flows) {
      f.id = crypto.randomUUID();
      for (const s of f.steps) {s.id = crypto.randomUUID();s.attachments=s.attachments.map(old=>{
        const ref=refs.get(old.id);
        if(!ref||ref.name!==old.name||ref.size!==old.size||ref.mimeType!==old.mimeType)throw new Error(`备份缺少完整附件：${old.name}`);
        return {...ref};
      });s.attachment=s.attachments[0]||null;}
    }
    for (const file of staged) await transaction('readwrite', store => store.put(file));
    if(options.materializeOnly)return flows;
    for (const f of flows.reverse()) await saveFlow(f);
    return flows.length;
  }
  root.PromptFlowStore = {saveFile, getFile, getDirectory, saveDirectory,cacheSourceFile,sourceFiles, base64, decode, readLibrary, readTrash, saveFlow, trashFlow, restoreFlow, deleteTrashedFlow, deleteTrashedFlows, exportFlow, exportLibrary, importBundle};
})(globalThis);
