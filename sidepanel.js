'use strict';
const M = PromptFlowModel, S = PromptFlowStore, C = PromptFlowChatImport;
const $ = id => document.getElementById(id);
const nativeHost=location.pathname.endsWith('/workflow.html')&&!new URLSearchParams(location.search).has('standalone');
const hasContent=flow=>flow?.steps.some(step=>step.text.trim()||step.attachments?.length||step.missingAttachments?.length);
const syncNative=async()=>{if(nativeHost&&hasContent(editor))await rpc('PC_SYNC_FLOW',{flowId:editor.id});};
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=name=>`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PromptChainIcons[name]}"/></svg>`;
let library = {flows: []}, editor = null, runState = null, view = 'library', creationMode=false, attachmentStepId = null, saveTimer, saveSerial = Promise.resolve(), noticeTimer, sourceDirectory = null, trash=[];
let currentReply=null,replyRequest=0,runCommandPending=false;
const rpc = async (type, payload = {}) => {const response = await chrome.runtime.sendMessage({type, ...payload}); if (!response?.ok) throw new Error(response?.error || '操作未完成'); return response;};
function notice(text, success = false, undo) {
  clearTimeout(noticeTimer);
  const el = $('notice'), body = document.createElement('span'); body.className='notice-body'; body.textContent=text;
  el.hidden = false; el.classList.toggle('success', success); el.replaceChildren(body);
  if (undo) {const button = document.createElement('button'); button.className = 'text-button'; button.textContent = '撤销'; button.onclick = undo; body.append(button);}
  const close = document.createElement('button'); close.className='notice-close'; close.textContent='×'; close.setAttribute('aria-label','关闭提示'); close.onclick=()=>{clearTimeout(noticeTimer);el.hidden=true;}; el.append(close);
  noticeTimer=setTimeout(()=>{el.hidden=true;},4500);
}
const UI_ERRORS = [
  [/^TARGET_TAB_CLOSED: /, '原标签页已关闭：重新打开流程锁定的原对话后再恢复'],
  [/^TARGET_TAB_UNAVAILABLE: /, '无法读取原标签页：请确认标签页仍打开后再恢复'],
  [/^TARGET_CONVERSATION_LOST: /, '流程锁定的原对话已不在当前页面：请重新打开该对话'],
  [/^WEB_NOT_CONNECTED: /, '网页未连接：请刷新目标聊天页面后恢复'],
  [/^WEB_INJECT_FAILED: /, '无法连接到网页：请刷新目标聊天页面后重试']
];
const task = action => async event => {try {await action(event);} catch (error) {const known=UI_ERRORS.find(([pattern])=>pattern.test(error.message));notice(known?known[1]:error.message);}};
function switchView(next) {
  view = next;
  for (const name of ['library', 'editor', 'monitor','trash','settings']) {$(name + '-view').hidden = name !== next;}
  $('library-actions').hidden = next !== 'library'; $('editor-actions').hidden = next !== 'editor'; $('monitor-footer').hidden = next !== 'monitor';
  $('main').scrollTop = 0;
  if(next==='monitor'){displayRun(true);syncReply();}
  else{$('last-reply').textContent='';currentReply=null;}
}
async function syncReply(){const request=++replyRequest;try{const result=await rpc('PF_CURRENT_REPLY');if(request===replyRequest&&result.view?.runId===runState?.id&&result.view.index<=runState.index){currentReply=result.view;if(view==='monitor')displayRun();}}catch{}}
function displayLibrary() {
  const query = $('search').value.trim().toLowerCase();
  const flows = library.flows.filter(f => [f.title,f.description,...f.steps.flatMap(s=>[s.title,s.text,...(s.attachments||[]).map(a=>a.name),...(s.missingAttachments||[]).map(a=>a.name)])].filter(Boolean).join(' ').toLowerCase().includes(query));
  flows.sort($('sort').value === 'name' ? (a,b) => a.title.localeCompare(b.title, 'zh-CN') : (a,b) => b.updatedAt - a.updatedAt);
  $('empty-state').hidden = library.flows.length > 0; $('flow-count').textContent = library.flows.length;
  $('no-results').hidden = !!flows.length || !library.flows.length;
  $('flow-list').innerHTML = flows.map(f => `<div class="flow-card"><button class="flow-open" data-flow="${h(f.id)}"><span class="flow-icon">▤</span><span class="flow-info"><strong>${h(f.title)}</strong>${f.description?`<p>${h(f.description)}</p>`:''}<span class="flow-meta"><span>${f.steps.filter(s=>s.enabled!==false).length} 步</span><span>${f.steps.reduce((n,s)=>n+(s.attachments?.length||0)+(s.missingAttachments?.length||0),0)} 个附件</span><span>${new Date(f.updatedAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}</span></span></span></button><button class="flow-delete" data-flow-delete="${h(f.id)}" aria-label="删除流程 ${h(f.title)}" title="删除流程"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button></div>`).join('');
}
function displayTrash(){
  $('trash-empty').hidden=!!trash.length;
  $('empty-trash').disabled=!trash.length;
  $('trash-list').innerHTML=trash.map(item=>`<div class="trash-row"><span><strong>${h(item.flow.title)}</strong><small>${new Date(item.deletedAt).toLocaleString('zh-CN',{hour12:false})}</small></span><div class="trash-actions"><button class="icon-button" data-restore-flow="${h(item.flow.id)}" aria-label="恢复"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10h8M3 10V2m0 8 4-4a8 8 0 1 1-2 9"/></svg></button><button class="icon-button danger" data-purge-flow="${h(item.flow.id)}" aria-label="永久删除"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button></div></div>`).join('');
}
async function deleteFlow(id){
  if(!id)return;
  if(editor?.id===id)await persist();
  await saveSerial;
  if(runState?.flow.id===id&&M.ACTIVE.has(runState.status))await rpc('PF_STOP');
  if(nativeHost)await rpc('PC_DELETE_NATIVE',{flowId:id});
  const removed=await S.trashFlow(id);
  if(editor?.id===id){clearTimeout(saveTimer);editor=null;}
  library=await S.readLibrary();trash=await S.readTrash();switchView('library');displayLibrary();displayTrash();
  notice(`已删除 ${removed.title}`,true,task(()=>restoreDeleted(id)));
}
async function restoreDeleted(id){await S.restoreFlow(id);if(nativeHost)await rpc('PC_SYNC_FLOW',{flowId:id});library=await S.readLibrary();trash=await S.readTrash();displayLibrary();displayTrash();notice('已恢复流程',true);}
async function purgeDeleted(id){const item=trash.find(item=>item.flow.id===id);if(!item||!confirm(`永久删除「${item.flow.title}」？此操作无法撤销。`))return;await S.deleteTrashedFlow(id);trash=await S.readTrash();displayTrash();notice('已永久删除',true);}
async function emptyTrash(){
  const ids=trash.map(item=>item.flow.id);if(!ids.length||!confirm(`永久删除最近删除中的全部 ${ids.length} 个流程？此操作无法撤销。`))return;
  $('empty-trash').disabled=true;
  try{await S.deleteTrashedFlows(ids);notice('已清空最近删除',true);}
  finally{trash=await S.readTrash();displayTrash();}
}
function locked() {return editor && runState?.flow.id === editor.id && M.ACTIVE.has(runState.status);}
function displayMissingFiles() {
  if (!editor) return;
  const missing = editor.steps.reduce((n,s)=>n+(s.enabled?(s.missingAttachments?.length||0):0),0);
  $('missing-files').hidden = !missing; $('missing-count').textContent = `${missing} 个附件待匹配`;
}
function stepHTML(s, index) {
  const refs = [...(s.attachments||[]).map((ref,index)=>({...ref,index})),...(s.missingAttachments||[]).map((ref,index)=>({...ref,index,missing:true}))], disabled = locked() ? ' disabled' : '';
  return `<details class="step${s.enabled?'':' skipped'}" data-step="${h(s.id)}"${editor.steps.length===1?' open':''}>
    <summary><span class="step-num">${String(index+1).padStart(2,'0')}</span><span class="step-summary-text"><strong>第 ${index+1} 步 · ${h(s.title)}</strong><small>${h([refs.length?refs.length+' 个附件':'文字',s.enabled?'':'已跳过'].filter(Boolean).join(' · '))}</small></span><span class="step-chevron">⌄</span></summary>
    <div class="step-body"><div class="step-actions"><label class="step-enable"><input type="checkbox" data-field="enabled"${s.enabled?' checked':''}${disabled}>启用本步</label><div class="step-tools"><button data-step-action="up" aria-label="上移本步"${disabled}>${icon('up')}</button><button data-step-action="down" aria-label="下移本步"${disabled}>${icon('down')}</button><button data-step-action="duplicate" aria-label="复制本步"${disabled}>${icon('copy')}</button><button data-step-action="delete" class="danger" aria-label="删除本步"${disabled}>${icon('trash')}</button></div></div>
    <label class="step-label">名称</label><input type="text" data-field="title" value="${h(s.title)}"${disabled}>
    <label class="step-label">提示词</label><textarea data-field="text" placeholder="提示词"${disabled}>${h(s.text)}</textarea>
    ${refs.map(ref=>`<div class="attachment${ref.missing?' missing':''}"><span>${icon('file')}</span><span class="file-name">${h(ref.name)}<small>${ref.missing?'需要选择本地原文件':`${(ref.size/1024).toFixed(1)} KB`}</small></span><button data-step-action="remove-file" data-file-index="${ref.index}" data-file-missing="${!!ref.missing}" aria-label="移除附件 ${h(ref.name)}"${disabled}>${icon('close')}</button></div>`).join('')}
    <button class="attach-button" data-step-action="attach"${disabled}>${icon('attachment')} 添加附件</button>
    ${s.referenceReply?`<details class="reference"><summary>原回复</summary><pre>${h(s.referenceReply)}</pre></details>`:''}</div></details>`;
}
function displaySteps() {
  if (!editor) return;
  const open = new Set([...$('steps').querySelectorAll('details.step[open]')].map(node=>node.dataset.step));
  $('steps').innerHTML = editor.steps.map(stepHTML).join('');
  for (const node of $('steps').children) if (open.has(node.dataset.step)) node.open = true;
  displayMissingFiles();
}
function displayEditor() {
  if (!editor) return;
  $('creation-sources').hidden=!creationMode;
  $('flow-title').value = editor.title; $('flow-title').disabled = !!locked();
  $('run').disabled = !!(runState && M.ACTIVE.has(runState.status));
  $('directory-name').textContent = sourceDirectory ? sourceDirectory.name : '选择附件目录';
  displaySteps();
}
async function persist(announce = false) {
  clearTimeout(saveTimer); if (!editor||(creationMode&&!hasContent(editor))) return;
  const snapshot = M.flow(editor);
  const saving = saveSerial.then(() => S.saveFlow(snapshot)); saveSerial = saving.catch(() => {});
  await saving; library = await S.readLibrary(); displayLibrary();
  if (announce) notice('已保存', true);
}
const autosave = () => {clearTimeout(saveTimer); saveTimer = setTimeout(() => persist().catch(error=>notice(error.message)), 400);};
async function openFlow(id, autoMatch = true) {
  if (view === 'editor') await persist();
  creationMode=false;
  editor = M.flow(library.flows.find(f=>f.id===id)); switchView('editor'); displayEditor();
  if (autoMatch && sourceDirectory && PromptFlowFileMatch.canMatch(editor)) {
    try {const report=await matchSource(editor);if(report.matched){displaySteps();await persist();}}
    catch(error){notice(error.message);}
  }
}
async function newFlow() {if (view === 'editor') await persist();creationMode=true; editor = M.flow({title:'新流程',steps:[M.step()]}); switchView('editor'); displayEditor(); $('flow-title').focus();}
function displayRun(followCurrent=false) {
  const r = runState;
  $('target').disabled=!!(r&&M.ACTIVE.has(r.status));
  if (!r) return;
  const done = r.status === 'completed' ? r.flow.steps.length : r.index;
  $('monitor-title').textContent = r.flow.title;
  $('pause').hidden = r.status !== 'running';$('resume').hidden=r.status==='running';
  $('resume').setAttribute('aria-label',r.status==='paused'?'恢复执行':'运行流程');$('resume').disabled=runCommandPending;
  $('stop').hidden=false;$('stop').disabled=!M.ACTIVE.has(r.status)||runCommandPending;
  const steps=$('monitor-steps'),follow=followCurrent||steps.dataset.run!==r.id||Number(steps.dataset.current)!==r.index;
  const rows=r.flow.steps.map((s,i)=>`<div role="listitem" class="monitor-step ${i<done?'done':i===r.index&&M.ACTIVE.has(r.status)?'current':''}"><span>${i<done?'✓':String(i+1).padStart(2,'0')}</span><span>${h(s.title)}</span></div>`).join('');
  if(steps._markup!==rows){const scroll=steps.scrollTop;steps.innerHTML=rows;steps._markup=rows;steps.scrollTop=scroll;}
  steps.dataset.run=r.id;steps.dataset.current=r.index;
  requestAnimationFrame(()=>{if(follow)steps.scrollTop=Math.min(r.index,r.flow.steps.length-1)*44;displayProgressPosition();});
  const logs=$('logs'),html=r.logs.map(item=>`<div class="log-row ${h(item.tone)}" data-log-key="${h(item.at+'|'+M.fingerprint(item.text))}">${h(PromptChainLogging.format(item))}</div>`).join('');
  $('copy-logs').disabled=!r.logs.length;
  $('clear-logs').disabled=!r.logs.length;
  if(logs._markup!==html){
    const atBottom=logs.scrollHeight-logs.scrollTop-logs.clientHeight<=4,edge=logs.getBoundingClientRect().top,anchor=[...logs.children].find(node=>node.getBoundingClientRect().bottom>edge);
    const anchorKey=anchor?.dataset.logKey,top=anchor?.getBoundingClientRect().top;
    logs.innerHTML=html;logs._markup=html;
    if(atBottom)logs.scrollTop=logs.scrollHeight;
    else{const next=[...logs.children].find(node=>node.dataset.logKey===anchorKey);if(next)logs.scrollTop+=next.getBoundingClientRect().top-top;}
  }
  const provider=M.platforms.names[M.platforms.providerFor(r.targetUrl)]||'';
  $('reply-title').textContent=provider;
  const reading=M.ACTIVE.has(r.status);
  if(!reading||currentReply?.runId!==r.id||currentReply.index>r.index)currentReply=null;
  $('last-reply').textContent=currentReply?.text?.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g,'\n\n')||'';
  $('run').disabled = M.ACTIVE.has(r.status);
}
function displayProgressPosition(){
  const steps=$('monitor-steps'),total=steps.children.length,index=Math.max(0,Math.min(total-1,runState?.index||0));
  $('step-progress-count').textContent=total?`${index+1} / ${total}`:'0 / 0';
}
async function refreshTabs() {
  const selected = $('target').value;
  const tabs = (await chrome.tabs.query({})).filter(t=>M.platforms.chatPage(t.url));
  $('target').innerHTML = '<option value="">选择目标对话</option>'+tabs.map(t=>`<option value="${t.id}">${h(M.platforms.names[M.platforms.providerFor(t.url)])}</option>`).join('');
  const activeRun = runState&&M.ACTIVE.has(runState.status) ? runState : null;
  const chosen = activeRun
    ? tabs.find(t=>t.id===activeRun.tabId) || tabs.find(t=>M.sameChat(activeRun.targetUrl,t.url))
    : tabs.find(t=>String(t.id)===selected) || tabs.find(t=>t.active) || tabs.find(t=>t.id===runState?.tabId);
  $('target').value = chosen ? String(chosen.id) : '';
  await updateConnection();
}
let connectionSeq=0;
function paintConnection(connected){
  $('connection').classList.toggle('connected',connected);
  $('connection').setAttribute('aria-label',connected?'已连接对话':'未连接对话');
}
async function updateConnection() {
  const seq = ++connectionSeq;
  const activeRun = runState&&M.ACTIVE.has(runState.status) ? runState : null;
  let tabId = activeRun ? activeRun.tabId : Number($('target').value);
  if (activeRun && tabId && !await chrome.tabs.get(tabId).catch(()=>null)) {
    const tabs = (await chrome.tabs.query({})).filter(t=>M.platforms.chatPage(t.url)&&M.sameChat(activeRun.targetUrl,t.url));
    if (seq !== connectionSeq) return;
    const reopened = tabs.find(t=>t.active) || tabs[0];
    tabId = reopened ? reopened.id : 0;
  }
  let connected = false;
  if (tabId) {
    const response = await chrome.tabs.sendMessage(tabId,{type:'PF_STATUS'}).catch(()=>null);
    if (seq !== connectionSeq) return;
    const snapshot = response?.snapshot;
    connected = !!snapshot?.hasComposer && (!activeRun || M.sameChat(activeRun.targetUrl,snapshot.url));
  }
  if (seq !== connectionSeq) return;
  paintConnection(connected);
}
async function importChat(file) {
  notice('正在解析聊天记录与附件…',true);
  const parsed = C.parse(await file.text()), value = await C.materialize(parsed,S);
  let matchError='';try{await matchSource(value);}catch(error){matchError=error.message;}
  if(creationMode&&editor){value.id=editor.id;if(hasContent(editor)){value.steps=[...editor.steps,...value.steps];if(editor.title!=='新流程')value.title=editor.title;}editor=M.flow(value);await persist();await syncNative();displayEditor();}
  else{await S.saveFlow(value); library = await S.readLibrary(); await openFlow(value.id,false);}
  displayLibrary();if($('steps').firstElementChild)$('steps').firstElementChild.open=true;
  const missing = value.steps.filter(s=>s.missingAttachment).length;
  notice(`已导入 ${value.steps.length} 步${missing?`，${missing} 个附件待匹配`:''}${matchError?`；${matchError}`:''}`,!missing);
}
async function matchSource(flow) {
  if (!sourceDirectory) return {matched:0,remaining:flow.steps.filter(s=>s.missingAttachment).length};
  return PromptFlowFileMatch.match(flow,sourceDirectory.handle,S);
}
async function matchFiles() {
  if (!editor) return;
  if (locked()) throw new Error('请先停止流程');
  if (!sourceDirectory) return bindFolder();
  const report = await matchSource(editor);
  displaySteps(); await persist();
  notice(`已匹配 ${report.matched} 个附件${report.ambiguous?.length?`，${report.ambiguous.length} 个文件同名`:''}`,!report.remaining);
}
async function bindFolder() {
  if (locked()) throw new Error('请先停止流程');
  if (!window.showDirectoryPicker) {$('folder-files').click(); return;}
  let handle;
  try {handle=await window.showDirectoryPicker({id:'prompt-chain-source',mode:'read'});} catch(error) {if(error.name==='AbortError')return;throw error;}
  sourceDirectory=await S.saveDirectory(handle);await PromptFlowFileMatch.cacheDirectory(handle,S);
  $('directory-name').textContent=handle.name;
  if (editor) await matchFiles(); else notice(`已选择 ${handle.name}`,true);
}
async function importSources(items,title){
  if(locked())throw new Error('请先停止流程');if(!editor)await newFlow();
  const selected=items;if(!selected.length)return;
  const steps=selected.flatMap(item=>item.steps);editor.steps=hasContent(editor)?[...editor.steps,...steps]:steps;
  if(editor.title==='新流程'||!editor.title.trim())editor.title=selected.length===1?selected[0].title:title;
  await matchSource(editor);displayEditor();if($('steps').firstElementChild)$('steps').firstElementChild.open=true;await persist();await syncNative();notice('已导入',true);
}
async function migrateLibrary() {
  const current=await S.readLibrary(); let changed=false;
  for (const flow of current.flows) {
    for (let i=0;i<flow.steps.length;i++) {
      const before=flow.steps[i], after=M.step(before);
      if (JSON.stringify(before)!==JSON.stringify(after)) {flow.steps[i]=after;changed=true;}
    }
    if (flow.description==='从 AI Chat Exporter 聊天记录导入') {flow.description='';changed=true;}
  }
  if(changed)await chrome.storage.local.set({pfLibrary:current});
  return current;
}
async function downloadFlow(all=false) {
  if (!all&&!editor) throw new Error('请先打开要导出的流程'); await persist();
  const bundle = all?await S.exportLibrary():await S.exportFlow(editor), blob = new Blob([JSON.stringify(bundle)],{type:'application/json'}), url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=(all?'Prompt-Chain-流程备份':editor.title).replace(/[<>:"/\\|?*]/g,'_')+'.promptflow.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),10000);
}
const actions = {
  new:newFlow, back:async()=>{await persist();await syncNative();if(nativeHost){location.href=chrome.runtime.getURL('sidepanel.html');return;}switchView('library');displayLibrary();},
  'import-chat':()=>{$('chat-file').click();}, 'import-backup':()=>{$('backup-file').click();}, export:()=>downloadFlow(),'export-all':()=>downloadFlow(true),
  monitor:async()=>{if(!runState)throw new Error('还没有执行记录');switchView('monitor');},
  'delete-flow':()=>deleteFlow(editor?.id),trash:async()=>{await persist();trash=await S.readTrash();switchView('trash');displayTrash();},
  'export-dom':async()=>{
    const tabId=Number($('target').value)||runState?.tabId||0;
    const result=await rpc('PF_EXPORT_DOM',tabId?{tabId}:{});
    notice(`已导出页面 DOM：${result.filename}`,true);
  },
  save:async()=>{await persist(true);await syncNative();},
  'add-step':async()=>{if(locked())throw new Error('请先停止流程再修改步骤'); editor.steps.push(M.step());displaySteps();await persist(); $('steps').lastElementChild.open=true;},
  'bind-folder':bindFolder,'match-files':matchFiles
};
document.addEventListener('click',task(async event=>{
  const deletion=event.target.closest('[data-flow-delete]');if(deletion){await deleteFlow(deletion.dataset.flowDelete);return;}
  const restoration=event.target.closest('[data-restore-flow]');if(restoration){await restoreDeleted(restoration.dataset.restoreFlow);return;}
  const purge=event.target.closest('[data-purge-flow]');if(purge){await purgeDeleted(purge.dataset.purgeFlow);return;}
  const action=event.target.closest('[data-action]'); if(action){await actions[action.dataset.action]?.();return;}
  const card=event.target.closest('[data-flow]');if(card){await openFlow(card.dataset.flow);return;}
  const button=event.target.closest('[data-step-action]');if(!button)return;
  if(locked())throw new Error('请先停止流程再修改步骤');
  const container=button.closest('[data-step]'),index=editor.steps.findIndex(s=>s.id===container.dataset.step),s=editor.steps[index];
  switch(button.dataset.stepAction){
    case 'up': if(index>0)[editor.steps[index-1],editor.steps[index]]=[s,editor.steps[index-1]];break;
    case 'down':if(index<editor.steps.length-1)[editor.steps[index+1],editor.steps[index]]=[s,editor.steps[index+1]];break;
    case 'duplicate':editor.steps.splice(index+1,0,M.step({...s,id:M.id()}));break;
    case 'delete':{
      const flowId=editor.id;editor.steps.splice(index,1);
      notice('已删除本步',true,task(async()=>{
        if(editor?.id===flowId){if(!editor.steps.some(step=>step.id===s.id))editor.steps.splice(Math.min(index,editor.steps.length),0,s);displaySteps();await persist();}
        else{await saveSerial;const saved=await S.readLibrary(),original=saved.flows.find(flow=>flow.id===flowId);if(!original)throw new Error('找不到原流程');if(!original.steps.some(step=>step.id===s.id))original.steps.splice(Math.min(index,original.steps.length),0,s);await S.saveFlow(original);library=await S.readLibrary();displayLibrary();}
        notice('已恢复该步骤',true);
      }));break;
    }
    case 'attach':attachmentStepId=s.id;$('step-file').click();return;
    case 'remove-file':{
      const fileIndex=Number(button.dataset.fileIndex),missing=button.dataset.fileMissing==='true';
      if(missing)s.missingAttachments.splice(fileIndex,1);else s.attachments.splice(fileIndex,1);
      s.attachment=s.attachments[0]||null;s.missingAttachment=s.missingAttachments[0]||null;break;
    }
  }
  displaySteps();await persist();
}));
$('steps').addEventListener('input',event=>{
  const field=event.target.dataset.field;if(!field||locked())return;
  const container=event.target.closest('[data-step]'),s=editor.steps.find(s=>s.id===container.dataset.step);
  s[field]=field==='enabled'?event.target.checked:event.target.value;
  if(field==='title')s.autoTitle=false;
  if(field==='text'&&s.autoTitle)s.title=M.firstSentence(s.text,s.attachments?.[0]?.name||s.missingAttachments?.[0]?.name);
  container.classList.toggle('skipped',!s.enabled);
  const index=editor.steps.indexOf(s),title=container.querySelector('.step-summary-text strong');title.textContent=`第 ${index+1} 步 · ${s.title}`;
  displayMissingFiles();autosave();
});
$('flow-title').addEventListener('input',()=>{if(!editor||locked())return;editor.title=$('flow-title').value;autosave();});
$('search').addEventListener('input',displayLibrary);$('sort').addEventListener('change',displayLibrary);
$('home').onclick=task(actions.back);$('export-dom').innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PromptChainIcons.dom}"/></svg>`;
$('export-dom').onclick=task(async()=>{await actions['export-dom']();});
$('menu-toggle').onclick=()=>switchView('settings');
$('settings-view').querySelectorAll('.settings-row .icon-button').forEach(button=>button.innerHTML=icon({'export-all':'export',monitor:'logs',trash:'trash','export-dom':'dom'}[button.dataset.action]||'file'));
// Any stray child that is not part of the header spec is removed, so both
// surfaces always expose exactly the same controls.
const HEADER_IDS=new Set(['home','connection','refresh-connection','export-dom','menu-toggle']);
const cleanHeader=()=>{const header=document.querySelector('.app-header');if(!header)return;for(const node of [...header.children])if(!HEADER_IDS.has(node.id))node.remove();};
cleanHeader();new MutationObserver(cleanHeader).observe(document.querySelector('.app-header'),{childList:true});
$('empty-trash').onclick=task(emptyTrash);
$('target').onchange=task(updateConnection);
$('refresh-connection').onclick=task(async()=>{await refreshTabs();const tabId=Number($('target').value);if(tabId)await rpc('PF_CONNECT',{tabId});await updateConnection();});
$('chat-file').onchange=task(async event=>{const file=event.target.files[0];event.target.value='';if(file)await importChat(file);});
$('source-chat').onclick=()=>$('chat-file').click();
$('source-prompts').onclick=()=>$('prompts-file').click();$('source-markdown').onclick=()=>$('markdown-file').click();
$('source-skill').onclick=task(async()=>{const handle=await showDirectoryPicker({id:'prompt-chain-skills',mode:'read'});await importSources(await PromptChainSources.skills(handle),handle.name);});
for(const id of ['prompts-file','markdown-file'])$(id).onchange=task(async event=>{const files=[...event.target.files];event.target.value='';if(files.length)await importSources(await PromptChainSources.files(files,S),files[0].name.replace(/\.[^.]+$/,''));});
for(const button of document.querySelectorAll('[data-source-icon]'))button.insertAdjacentHTML('afterbegin',`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PromptChainIcons[button.dataset.sourceIcon]}"/></svg>`);
$('backup-file').onchange=task(async event=>{const file=event.target.files[0];event.target.value='';if(!file)return;notice('正在导入流程与附件…',true);const count=await S.importBundle(JSON.parse(await file.text()));library=await S.readLibrary();displayLibrary();if(library.selectedId)await openFlow(library.selectedId);else switchView('library');notice(`已导入 ${count} 个流程`,true);});
$('step-file').multiple=true;
$('step-file').onchange=task(async event=>{const files=[...event.target.files];event.target.value='';if(!files.length)return;const s=editor.steps.find(s=>s.id===attachmentStepId);if(!s)return;
  // Store all files before modifying the editor so a quota error leaves the saved step intact.
  const refs=[];for(const file of files){try{refs.push(await S.saveFile(file));}catch(error){throw new Error(`保存附件 ${file.name} 失败：${error.message}`);}}
  s.attachments=[...(s.attachments||[]),...refs];s.attachment=s.attachments[0]||null;displaySteps();await persist();
});
$('folder-files').onchange=task(async event=>{
  const files=[...event.target.files];event.target.value='';let count=0;
  for(const s of editor.steps){
    const remaining=[];
    for(const ref of s.missingAttachments||[]){const matches=files.filter(f=>f.name===ref.name);if(matches.length!==1){remaining.push(ref);continue;}s.attachments.push(await S.saveFile(matches[0]));count++;}
    s.missingAttachments=remaining;s.attachment=s.attachments[0]||null;s.missingAttachment=remaining[0]||null;
  }
  displaySteps();await persist();notice(`已匹配 ${count} 个附件`,true);
});
$('run').onclick=task(async()=>{await persist();const tabId=Number($('target').value);if(!tabId)throw new Error('先选择目标对话');const response=await rpc('PF_START',{flow:editor,tabId});runState=response.run;switchView('monitor');$('notice').hidden=true;});
$('monitor-steps').onscroll=displayProgressPosition;
let stepWheelUntil=0;
$('monitor-steps').addEventListener('wheel',event=>{if(!event.deltaY||event.ctrlKey)return;event.preventDefault();event.stopPropagation();const now=performance.now();if(now<stepWheelUntil)return;stepWheelUntil=now+120;const list=$('monitor-steps'),height=list.firstElementChild?.offsetHeight||44,index=Math.round(list.scrollTop/height);list.scrollTop=Math.max(0,Math.min(list.children.length-1,index+Math.sign(event.deltaY)))*height;},{passive:false});
$('step-console').addEventListener('toggle',()=>{if($('step-console').open)displayRun(true);});
$('copy-logs').innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PromptChainIcons.copy}"/></svg>`;
$('clear-logs').innerHTML=icon('trash');
$('clear-logs').onclick=task(async event=>{event.preventDefault();event.stopPropagation();await rpc('PF_CLEAR_LOGS');});
for(const [id,icon]of [['pause','pause'],['resume','play'],['stop','stop']])$(id).innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PromptChainIcons[icon]}"/></svg>`;
$('step-tools').addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});
async function copyText(text){
  try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return;}}catch(error){}
  // The async clipboard API rejects with "Document is not focused" when focus is on
  // the chat page. A selection copy inside the panel still works, so fall back to it
  // instead of failing silently.
  const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');
  area.style.cssText='position:fixed;top:-1000px;left:-1000px;width:1px;height:1px;opacity:0';
  document.body.append(area);
  try{area.select();area.setSelectionRange(0,area.value.length);if(!document.execCommand('copy'))throw new Error('复制失败：请先点击面板内部，再重新复制');}
  finally{area.remove();}
}
$('copy-logs').onclick=task(async event=>{
  event.preventDefault();event.stopPropagation();if(!runState)return;
  const lines=[runState.flow.title,...runState.logs.map(PromptChainLogging.format)];
  try{const result=await rpc('PF_DIAGNOSTIC');if(result.diagnostic)lines.push('\nDiagnostics',JSON.stringify(result.diagnostic,null,2));}catch(error){lines.push('\nDiagnostics: '+PromptChainLogging.reason(error.message));}
  await copyText(lines.join('\n'));
  notice('已复制日志与诊断信息',true);
});
async function resumeRun(){if(runCommandPending)return;const button=$('resume');runCommandPending=true;button.disabled=true;button.setAttribute('aria-busy','true');button.innerHTML=icon('refresh');try{let result;if(runState?.status==='paused'){try{result=await rpc('PF_RESUME');}catch(error){if(!error.message.startsWith('RESEND_CONFIRMATION_REQUIRED:'))throw error;if(!confirm('尚未发现本步的新消息。确认网页没有发送成功，并重新发送本步？'))return;result=await rpc('PF_RETRY');}}else{const tabId=Number($('target').value);if(!tabId)throw new Error('先选择目标对话');const saved=(await S.readLibrary()).flows.find(flow=>flow.id===runState.flow.id);result=await rpc('PF_START',{flow:saved||runState.flow,tabId});}runState=result.run||runState;await refreshTabs();displayRun(true);$('notice').hidden=true;}finally{runCommandPending=false;button.disabled=false;button.removeAttribute('aria-busy');button.innerHTML=icon('play');displayRun();}}
$('pause').onclick=task(()=>rpc('PF_PAUSE'));$('resume').onclick=task(resumeRun);
$('stop').onclick=task(()=>rpc('PF_STOP'));
$('open-target').onclick=task(async()=>{if(!runState)return;try{await chrome.tabs.update(runState.tabId,{active:true});}catch{throw new Error('目标标签页已关闭，请重新打开原对话后恢复');}});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local')return;
  if(changes.pfRun){const wasLocked=locked();runState=changes.pfRun.newValue;displayRun();updateConnection().catch(()=>{});if(view==='monitor'&&runState?.phase==='waiting')syncReply();if(view==='editor'&&wasLocked!==locked())displayEditor();}
  if(changes.pfLibrary){library=changes.pfLibrary.newValue;displayLibrary();}
  if(changes.pfTrash){trash=changes.pfTrash.newValue||[];displayTrash();}
});
chrome.runtime.onMessage.addListener(message=>{if(message?.type==='PF_REPLY_VIEW'&&runState&&message.view?.runId===runState.id&&message.view.index<=runState.index){replyRequest++;currentReply=message.view;if(view==='monitor')displayRun();}});
chrome.tabs.onActivated.addListener(()=>refreshTabs().catch(()=>{}));
chrome.tabs.onRemoved.addListener(id=>{if(runState&&id===runState.tabId){connectionSeq++;paintConnection(false);}refreshTabs().catch(()=>{});});
chrome.tabs.onUpdated.addListener((id,info)=>{if(id===runState?.tabId&&info.url){connectionSeq++;paintConnection(false);}if(info.status==='complete'||info.url)refreshTabs().catch(()=>{});});
(async()=>{library=await migrateLibrary();sourceDirectory=await S.getDirectory()||null;runState=(await chrome.storage.local.get('pfRun')).pfRun||null;displayLibrary();displayRun();await refreshTabs();const query=new URLSearchParams(location.search),resumeId=query.get('resume');if(resumeId){query.delete('resume');history.replaceState(null,'',location.pathname+'?'+query);}if(query.has('new'))await newFlow();else if(query.has('monitor')&&runState){switchView('monitor');if(resumeId===runState.id&&runState.status==='paused')await resumeRun();}else if(query.has('trash')){trash=await S.readTrash();displayTrash();switchView('trash');}else if(query.get('flow')){await openFlow(query.get('flow'));if(query.has('imported')&&$('steps').firstElementChild)$('steps').firstElementChild.open=true;}})().catch(error=>notice(error.message));
