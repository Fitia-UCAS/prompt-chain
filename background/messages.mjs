export function createMessageHandler({chrome, model: M, store: S, runs, connection, runner, native, upstream, domExport, clock: Date = globalThis.Date}) {
  const {getRun, log, save} = runs;
  const {status, diagnostic} = connection;
  const {start, resume, pause} = runner;
  const uiSender = sender => String(sender.url || '').startsWith(chrome.runtime.getURL(''));
  async function handle(message, sender) {
    if(message.type==='PF_CLEAR_LOGS'){
      if(!uiSender(sender))throw new Error('只能从侧边栏清空日志');
      const run=await getRun();if(run){run.logs=[];await save(run);}return{};
    }
    if(message.type==='PF_CURRENT_REPLY'){
      if(!uiSender(sender))throw new Error('只能从侧边栏读取当前验证回答');
      return {view: runs.currentReply(await getRun())};
    }
    if(message.type==='PF_EXPORT_DOM'){
      if(!uiSender(sender))throw new Error('只能从侧边栏导出页面诊断');
      const run=await getRun();
      let tabId=Number(message.tabId)||run?.tabId||0;
      if(!tabId){
        const tabs=await chrome.tabs.query({url:['https://chatgpt.com/*','https://chat.openai.com/*','https://gemini.google.com/*','https://chat.deepseek.com/*']});
        tabId=(tabs.find(tab=>tab.active)||tabs[0])?.id||0;
      }
      if(!tabId)throw new Error('先打开一个聊天页面再导出诊断');
      return domExport.download(tabId);
    }
    if(message.type==='PF_CONNECT'){
      if(!uiSender(sender))throw new Error('只能从侧边栏刷新连接');
      return {snapshot: await connection.connect(message.tabId)};
    }
    if(message.type==='PF_DIAGNOSTIC'){
      if(!uiSender(sender))throw new Error('只能从侧边栏读取诊断');
      const run=await getRun();
      if(!run)return{diagnostic:null};
      let snapshot=null,error='',cause='',causeCode='';
      try{snapshot=await status(run.tabId);}
      catch(failure){error=failure.message||'WEB_NOT_CONNECTED: Target page could not be read';cause=failure.cause?String(failure.cause.message||failure.cause):'';causeCode=failure.originCode||failure.cause?.code||'';}
      const state=await connection.tabState(run.tabId).catch(()=>({tab:null,error}));
      const result=diagnostic(run,snapshot,{error,cause,causeCode,tabId:state.tab?.id||null});
      result.lastAttachmentUpload=run.lastAttachmentUpload||null;
      return{diagnostic:result};
    }
    if(message.type==='PC_MIGRATE'){if(!uiSender(sender))throw new Error('只能在侧边栏迁移');return{count:await native.migrate()};}
    if(message.type==='PC_PANEL_REFRESH'){
      if(!uiSender(sender))throw new Error('只能在侧边栏刷新列表');
      // The panel does not watch chrome.storage; ask it to re-read through the
      // message it already handles.
      await Promise.resolve(chrome.runtime.sendMessage({type:'PROMPTS_IMPORTED'})).catch(()=>{});
      return{};
    }
    if(message.type==='PC_SYNC_FLOW'){
      if(!uiSender(sender))throw new Error('只能在侧边栏保存');
      const flow=(await S.readLibrary()).flows.find(f=>f.id===message.flowId);if(!flow)throw new Error('找不到流程');
      return{chainId:await native.syncFlow(flow)};
    }
    if(message.type==='PC_PREPARE'){if(!uiSender(sender))throw new Error('只能在侧边栏编辑');const flow=await native.toFlow(message.payload);return{flowId:flow.id};}
    if(message.type==='PC_DELETE_NATIVE'){
      if(!uiSender(sender))throw new Error('只能在侧边栏删除');
      const flow=(await S.readLibrary()).flows.find(f=>f.id===message.flowId);if(flow)await upstream.h(native.nativeId(flow));return{};
    }
    if(message.type==='PC_RUN_NATIVE'){
      const tabId=uiSender(sender)?Number(message.tabId):sender.tab?.id,tab=await chrome.tabs.get(tabId);
      if(!uiSender(sender)&&sender.tab?.id!==tabId)throw new Error('无法确定目标页面');
      if(!M.sameChat(message.payload.expectedHref,tab.url))throw new Error('对话已切换');
      const flow=await native.toFlow(message.payload);return{run:await start({flow,tabId})};
    }
    if(message.type==='PC_STOP_NATIVE'){
      const run=await getRun();
      if(!run||sender.tab?.id!==run.tabId||message.runId!==run.id)throw new Error('只能从当前流程的目标页停止');
      await runner.stop();return{};
    }
    if (['PF_START', 'PF_PAUSE', 'PF_RESUME', 'PF_RETRY', 'PF_STOP'].includes(message.type) && !uiSender(sender)) throw new Error('只能从 Prompt Chain 侧边栏操作流程');
    if (message.type === 'PF_START') return {run: await start(message)};
    if (message.type === 'PF_PAUSE') {const run = await getRun(); if (run?.status === 'running') await pause(run, '已手动暂停'); return {};}
    if (message.type === 'PF_RESUME' || message.type === 'PF_RETRY') {
      try{return {run:await resume(message.type==='PF_RETRY')};}
      catch(error){const run=await getRun();if(run?.status==='paused'){const text='Resume check failed: '+error.message;if(run.logs.at(-1)?.text!==text){log(run,text,error.message.startsWith('RESEND_CONFIRMATION_REQUIRED:')?'info':'error','prompt_chain.rpc');await save(run);}}throw error;}
    }
    if (message.type === 'PF_STOP') {
      await runner.stop(); return {};
    }
    const run = await getRun();
    if (sender.tab?.id !== run?.tabId || !M.ACTIVE.has(run?.status)) throw new Error('发送页面没有活动流程');
    if (message.runId !== run.id || message.operationId !== run.pending?.id) throw new Error('步骤已失效');
    if (message.type === 'PF_FILE_CHUNK') {
      if (run.status !== 'running' || !(run.pending.attachments||(run.pending.attachment?[run.pending.attachment]:[])).some(ref=>ref.id===message.fileId)) throw new Error('附件不属于当前步骤');
      const file = await S.getFile(message.fileId), offset = Number(message.offset);
      if (!file || !Number.isSafeInteger(offset) || offset < 0 || offset >= file.size) throw new Error('附件读取范围无效');
      return {chunk: S.base64(file.bytes.slice(offset, offset + 65536))};
    }
    if (message.type === 'PF_AUTHORIZE_SEND') {
      if (run.status !== 'running') throw new Error('流程已暂停');
      const refs=run.pending.attachments||(run.pending.attachment?[run.pending.attachment]:[]);
      if(refs.some(ref=>!run.pending.uploadedIds?.includes(ref.id))&&!(refs.length===1&&!run.pending.uploadedIds&&run.pending.attachmentUploaded))throw new Error('UPLOAD_SET_INCOMPLETE: 附件尚未全部核对，禁止发送');
      run.pending.attemptedAt = Date.now(); run.phase = 'sending'; await save(run); return {};
    }
    if(message.type==='PF_ATTACHMENT_READY'){
      const refs=run.pending.attachments||(run.pending.attachment?[run.pending.attachment]:[]);
      const ref=refs.find(item=>item.id===message.fileId);
      if(run.status!=='running'||!ref)throw new Error('附件不属于当前步骤');
      const display=typeof message.displayName==='string'?message.displayName.trim().slice(0,300):'';
      if(display){
        const name=ref.name,dot=name.lastIndexOf('.'),stem=dot>0?name.slice(0,dot):name,extension=dot>0?name.slice(dot):'';
        const alias=/^(.+?)\s*\((\d{1,3})\)(\.[^.]+)$/.exec(display);
        if(alias&&alias[1].trim()===stem&&alias[3]===extension){
          const map=run.pending.attachmentAliasMap||{};
          map[ref.id]=[...new Set([...(map[ref.id]||[]),display])].slice(-4);
          run.pending.attachmentAliasMap=map;
          if(refs.length===1)run.pending.attachmentAliases=map[ref.id];
        }
      }
      run.pending.uploadedIds=[...new Set([...(run.pending.uploadedIds||[]),ref.id])];
      run.pending.attachmentUploaded=run.pending.uploadedIds.length===refs.length;
      await save(run);return{};
    }
    if (message.type === 'PF_PHASE') {if (run.status === 'running') {run.phase = 'uploading'; await save(run);} return {};}
    throw new Error('未知操作');
  }
  return handle;
}
