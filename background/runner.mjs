import {RUN_ALARM} from './scheduler.mjs';
import {reason as logReason, classify as logClassify} from '../shared/logging.mjs';

export function createRunner({chrome, model: M, store: S, runs, connection, scheduler, native, fileMatch, clock: Date = globalThis.Date, sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))}) {
  const ALARM = RUN_ALARM;
  const {getRun, log, save, verificationReply} = runs;
  const {status, matchTarget, rebind, tabState} = connection;
  const {enqueue, arm, requestTick} = scheduler;
  async function pause(run, reason) {
    await releaseNative(run);
    const raw = reason instanceof Error ? reason : String(reason ?? '');
    const text = raw instanceof Error ? raw.message : raw;
    const info = text === '已手动暂停' ? {code:'USER_PAUSED',detail:text,cause:''} : logClassify(raw);
    run.status = 'paused'; run.reason = text;
    run.lastFailure = {code:info.code, detail:String(info.detail||'').slice(0,300), cause:String(info.cause||'').slice(0,300), stage:run.phase, module:'runner', tabId:run.tabId, at:Date.now()};
    log(run, `Paused: ${logReason(raw)}`, text === '已手动暂停' ? 'info' : /^[A-Z][A-Z0-9_]+:/.test(text) ? 'error' : 'warn'); await save(run);
    chrome.tabs.sendMessage(run.tabId, {type: 'PF_CANCEL'}).catch(() => {});
    return run;
  }
  async function acquireNative(run){
    if(!native)return;
    const response=await chrome.tabs.sendMessage(run.tabId,{type:'PC_ACQUIRE',payload:{}}).catch(()=>null);
    if(!response?.result?.acquired){
      const state=await tabState(run.tabId).catch(()=>({tab:null}));
      if(!state.tab)throw new Error('TARGET_TAB_CLOSED: The bound tab no longer exists (tabId '+run.tabId+')');
      throw new Error('页面有其他队列正在运行，或尚未刷新连接');
    }
    run.nativeLock=true;
  }
  async function releaseNative(run){
    if(!run.nativeLock)return;
    run.nativeLock=false;
    await chrome.tabs.sendMessage(run.tabId,{type:'PC_RELEASE',payload:{}}).catch(()=>{});
  }
  function adoptReceipt(run, snapshot) {
    const pending = run.pending;
    run.sentUserKey = snapshot.lastUser.key; run.beforeAssistantKey = pending.baselineAssistantKey;
    run.delivery={text:pending.text,attachment:pending.attachment,attachments:pending.attachments||(pending.attachment?[pending.attachment]:[]),attachmentAliases:pending.attachmentAliases||[],attachmentAliasMap:pending.attachmentAliasMap||{},attachmentUploaded:!!pending.attachmentUploaded,baselineUserKey:pending.baselineUserKey,baselineAssistantKey:pending.baselineAssistantKey,baselineMessages:pending.baselineMessages,attemptedAt:pending.attemptedAt||Date.now(),url:pending.url};
    run.targetUrl = snapshot.url; run.phase = 'waiting'; run.sentAt = Date.now();
    if(M.conversationPath(snapshot.url)){run.allowNewChat=false;if(!M.sameChat(pending.url,snapshot.url)||pending.baselineMessages?.length)run.bindingFinalized=true;}
    if (pending.isRepeat) run.repeated++;
    log(run, pending.isRepeat ? `Continuation ${run.repeated} sent` : `Sending step ${run.index + 1}/${run.flow.steps.length}`);
    run.pending = null; run.quietSignature = ''; run.quietSince = 0;run.waitDiagnostic='';
  }
  function persistAttachmentUpload(run,upload,operationId){
    const operation=upload?.operation;
    if(!operation?.id||operation.runId!==run.id)return false;
    if(operationId&&operation.id!==operationId)return false;
    const current=run.lastAttachmentUpload;
    if(current&&current.operation?.runId===run.id){
      if(current.operation.id===operation.id&&(current.sampledAt||0)>(upload.sampledAt||0))return false;
      if(current.operation.id!==operation.id&&(current.sampledAt||0)>=(upload.sampledAt||0))return false;
    }
    const bounded=boundedUpload(upload);
    if(!bounded)return false;
    bounded.persistedAt=Date.now();
    run.lastAttachmentUpload=bounded;
    return true;
  }
  async function acceptReceipt(run,snapshot){
    const operationId=run.pending?.id;
    persistAttachmentUpload(run,snapshot.upload,operationId);
    adoptReceipt(run,snapshot);await save(run);
    if(snapshot.reader?.source==='conversation-history'&&snapshot.operation?.id===operationId){
      await chrome.tabs.sendMessage(run.tabId,{type:'PF_CANCEL'}).catch(()=>{});
      for(let index=0;index<10;index++){const response=await chrome.tabs.sendMessage(run.tabId,{type:'PF_STATUS'}).catch(()=>null);if(!response?.snapshot?.operation)break;await sleep(100);}
    }
    return run;
  }
  function boundedUpload(upload){
    if(!upload||typeof upload!=='object')return null;
    try{
      const copy=JSON.parse(JSON.stringify(upload));
      if(Array.isArray(copy.cards))copy.cards=copy.cards.slice(0,6);
      if(Array.isArray(copy.observedNames))copy.observedNames=copy.observedNames.slice(-4);
      if(Array.isArray(copy.attachmentAliases))copy.attachmentAliases=copy.attachmentAliases.slice(-4);
      return copy;
    }catch{return null;}
  }
  async function onDelivery(runId, operationId, result) {
    const run = await getRun();
    if (!run || run.id !== runId) return;
    const persisted=persistAttachmentUpload(run,result?.upload,operationId);
    if (run.pending?.id !== operationId || run.status === 'cancelled') {if(persisted)await save(run);return;}
    if (result?.snapshot && matchTarget(run,result.snapshot) && M.receipt(result.snapshot, run.pending)) {
      await acceptReceipt(run, result.snapshot);return;
    }
    if(result?.attempted){const snapshot=await status(run.tabId).catch(()=>null);if(snapshot&&matchTarget(run,snapshot)&&M.receipt(snapshot,run.pending)){await acceptReceipt(run,snapshot);return;}}
    if (run.status === 'paused') {
      if(!/^OPERATION_(?:CANCELLED|BUSY)/.test(result?.error||''))run.reason = result?.error || run.reason;
      await save(run); return;
    }
    await pause(run, result?.error || '页面未确认发送结果，请核对对话后恢复');
  }
  async function dispatch(run, snapshot, repeatText) {
    await acquireNative(run);
    if (snapshot.generating || !snapshot.hasComposer) return;
    if (snapshot.draft) {await pause(run, '网页里有未发送草稿，请先保存或清空再恢复'); return;}
    const current = run.flow.steps[run.index], isRepeat = repeatText !== undefined;
    const pending = {
      id: M.id(), runId: run.id, url: run.targetUrl, text: isRepeat ? repeatText : current.text,
      step:run.index+1, attachment:isRepeat?null:current.attachment,
      attachments:isRepeat?[]:(current.attachments||(current.attachment?[current.attachment]:[])),
      attachmentAliases:!isRepeat?(run.resumeAttachmentAliases||[]):[],
      attachmentAliasMap:!isRepeat?(run.resumeAliasMap||{}):{},
      uploadedIds:[],
      reuseAttachment:!isRepeat&&!!current.attachment&&run.resumeAttachmentId===current.attachment.id,
      reuseAttachments:!isRepeat&&!!current.attachments?.length&&JSON.stringify(run.resumeAttachmentIds||[])===JSON.stringify(current.attachments.map(ref=>ref.id)),
      baselineUserKey: snapshot.lastUser?.key || '',
      baselineAssistantKey: snapshot.assistant?.key || '', baselineMessages:snapshot.messages?.slice(-40), documentId: snapshot.documentId, isRepeat, createdAt: Date.now(), attemptedAt: 0
    };
    delete run.resumeAttachmentId;delete run.resumeAttachmentAliases;delete run.resumeAttachmentIds;delete run.resumeAliasMap;run.pending = pending;run.uploadWaitReason=''; run.phase = pending.attachments.length ? 'uploading' : 'sending';
    log(run, pending.attachments.length ? `Uploading step ${run.index + 1}/${run.flow.steps.length}: ${pending.attachments.map(a=>a.name).join('、')}` : isRepeat ? 'Preparing continuation' : `Preparing step ${run.index + 1}/${run.flow.steps.length}`);
    await save(run);
    chrome.tabs.sendMessage(run.tabId, {type: 'PF_SEND', operation: pending}).then(
      result => enqueue(() => onDelivery(run.id, pending.id, result)),
      error => enqueue(() => onDelivery(run.id, pending.id, {ok: false, error: `网页连接中断：${error.message}`}))
    ).catch(() => {});
  }
  async function tick() {
    const run = await getRun(); if (!run || run.status !== 'running') return;
    try {
      const snapshot = await status(run.tabId);
      const target=run.targetUrl;
      if (!matchTarget(run,snapshot)) return pause(run, '目标页已离开锁定对话');
      verificationReply(run,snapshot);
      if(target!==run.targetUrl)await save(run);
      if (snapshot.error) return pause(run, snapshot.error);
      if (run.pending) {
        if((run.pending.attachments?.length||run.pending.attachment)&&!run.pending.attemptedAt&&snapshot.upload?.elapsedMs>3000&&snapshot.upload.waitingFor!=='ready'&&run.uploadWaitReason!==snapshot.upload.waitingFor){run.uploadWaitReason=snapshot.upload.waitingFor;log(run,'Upload pending: '+run.uploadWaitReason,'info','prompt_chain.upload');await save(run);}
        if (M.receipt(snapshot, run.pending)) return acceptReceipt(run,snapshot);
        if (snapshot.documentId !== run.pending.documentId) return pause(run, '页面已刷新，上一项操作尚未确认，请核对草稿和对话');
        if (snapshot.operation?.id === run.pending.id) {arm(run); return;}
        if (Date.now() - run.pending.createdAt > 20000) return pause(run, '发送过程已中断，尚未确认送达，请核对后恢复');
        arm(run); return;
      }
      if (run.phase === 'ready') {
        if (snapshot.generating) {arm(run); return;}
        return dispatch(run, snapshot);
      }
      if (Date.now() - run.sentAt > 30 * 60 * 1000) return pause(run, '等待回答已超过 30 分钟，已暂停');
      const decision = M.replyDecision(run, snapshot);
      if (decision.type === 'pause') return pause(run, decision.reason);
      if (decision.type === 'wait') {
        let changed=false;
        if(Date.now()-run.sentAt>=15000&&run.waitDiagnostic!==decision.reason){run.waitDiagnostic=decision.reason;log(run,'Waiting: '+logReason(decision.reason));changed=true;}
        if (run.quietSignature !== decision.signature || run.quietSince !== decision.since) {
          run.quietSignature = decision.signature; run.quietSince = decision.since;changed=true;
        }
        if(changed)await save(run);else arm(run);
        return;
      }
      if (decision.type === 'repeat') return dispatch(run, snapshot, decision.text);
      log(run, `Completed step ${run.index + 1}/${run.flow.steps.length}`, 'success');
      run.index++; run.repeated = 0; run.phase = 'ready'; run.quietSignature = ''; run.quietSince = 0;
      if (run.index >= run.flow.steps.length) {
        await releaseNative(run);
        run.status = 'completed'; run.phase = 'completed'; run.reason = '全部步骤执行完成';
        log(run, 'Flow completed', 'success'); await chrome.alarms.clear(ALARM);
      }
      await save(run);
      if(run.status==='running')return dispatch(run,snapshot);
    } catch (error) {await pause(run, error);}
  }
  async function start(message) {
    const previous = await getRun();
    if (previous && M.ACTIVE.has(previous.status)) throw new Error('先停止或完成当前流程');
    let input=M.flow(message.flow);
    if(fileMatch?.canMatch(input)){const directory=await S.getDirectory();if(directory){const report=await fileMatch.match(input,directory.handle,S);if(report.matched){await S.saveFlow(input);if(native)await native.syncFlow(input);}}}
    const flow = M.validateFlow(input), tab = await chrome.tabs.get(message.tabId);
    if (!M.allowedUrl(tab.url)) throw new Error('请选择 ChatGPT、Gemini 或 DeepSeek 对话页');
    for (const step of flow.steps) {
      for(const ref of step.attachments||(step.attachment?[step.attachment]:[])){const file=await S.getFile(ref.id);
        if(!file||file.size!==ref.size||file.name!==ref.name||file.bytes.byteLength!==file.size)throw new Error(`附件缺失或不完整：${ref.name}`);
      }
    }
    const snapshot = await status(tab.id, true);
    if (!snapshot.hasComposer) throw new Error('请先打开新聊天或具体对话');
    if (snapshot.draft) throw new Error('请先保存或清空网页里的草稿');
    const run = {id: M.id(), flow, tabId: tab.id, tabTitle: M.platforms.names[M.platforms.providerFor(tab.url)], targetUrl: snapshot.url, allowNewChat: !M.conversationPath(snapshot.url),
      status: 'running', phase: 'ready', index: 0, repeated: 0, logs: [], reason: '', pending: null, startedAt: Date.now()};
    log(run, `Conversation locked: ${M.platforms.names[M.platforms.providerFor(tab.url)]}`);
    await save(run); await chrome.alarms.create(ALARM, {periodInMinutes: 0.5}); requestTick(); return run;
  }
  async function resume(retry = false) {
    const run = await getRun(); if (!run || run.status !== 'paused') throw new Error('没有暂停的流程');
    let snapshot = null, closed = false;
    try { snapshot = await status(run.tabId, true); }
    catch (error) { if (!/^TARGET_TAB_/.test(error.message)) throw error; closed = true; }
    if (closed) {
      const target = await rebind(run);
      if (!target.tab) throw new Error(target.error || 'TARGET_TAB_CLOSED: Reopen the conversation bound to this flow before resuming');
      run.tabId = target.tab.id;
      run.tabTitle = M.platforms.names[M.platforms.providerFor(target.tab.url)] || run.tabTitle;
      log(run, `Rebound to reopened conversation (tab ${run.tabId})`);
      await save(run);
      snapshot = await status(run.tabId, true);
    } else if (!matchTarget(run, snapshot)) {
      const target = await rebind(run);
      if (target.tab && target.tab.id !== run.tabId) {
        run.tabId = target.tab.id;
        run.tabTitle = M.platforms.names[M.platforms.providerFor(target.tab.url)] || run.tabTitle;
        log(run, `Rebound to reopened conversation (tab ${run.tabId})`);
        await save(run);
        snapshot = await status(run.tabId, true);
      }
      if (!matchTarget(run, snapshot)) throw new Error('请回到流程锁定的原对话');
    }
    if (!matchTarget(run,snapshot)) throw new Error('请回到流程锁定的原对话');
    if (snapshot.operation) throw new Error('页面正在结束上一个操作，请稍后再恢复');
    if (run.pending && M.receipt(snapshot, run.pending)) {persistAttachmentUpload(run,snapshot.upload,run.pending.id);adoptReceipt(run, snapshot); retry = false;}
    else if (run.pending) {
      if (run.pending.attemptedAt) {
        const before=run.pending.baselineMessages;
        const recent=snapshot.messages||[];
        const unchanged=Array.isArray(before)&&JSON.stringify((before.length?recent.slice(-before.length):recent).map(({key,role,fingerprint})=>({key,role,fingerprint})))===JSON.stringify(before.map(({key,role,fingerprint})=>({key,role,fingerprint})));
        if(!unchanged||snapshot.generating)throw new Error('SEND_RECEIPT_UNCONFIRMED: New conversation content was found; delivery could not be matched. No message was resent.');
        if(!retry)throw new Error('RESEND_CONFIRMATION_REQUIRED: No new message was found. Confirm before resending this step.');
      }
      if (snapshot.draft || snapshot.generating) throw new Error('请先核对并清空残留草稿和附件，等待当前回答完成');
      if(!run.pending.attemptedAt&&(run.pending.attachments?.length||run.pending.attachment)){
        const refs=run.pending.attachments||(run.pending.attachment?[run.pending.attachment]:[]);
        run.resumeAttachmentIds=refs.map(ref=>ref.id);run.resumeAliasMap=run.pending.attachmentAliasMap||{};
        run.resumeAttachmentId=refs[0]?.id||null;run.resumeAttachmentAliases=run.pending.attachmentAliases||[];
      }
      run.phase = run.pending.isRepeat ? 'waiting' : 'ready';
      run.pending = null;
    }
    if (retry && run.phase === 'waiting') {
      if (snapshot.draft || snapshot.generating) throw new Error('请先清空草稿并等待当前回答完成');
      run.phase = 'ready'; run.repeated = 0;
    }
    if(run.phase==='waiting'){run.sentAt=Date.now();run.quietSignature='';run.quietSince=0;run.waitDiagnostic='';}
    run.status = 'running'; run.reason = ''; log(run, retry ? 'Retry requested by user' : 'Flow resumed');
    verificationReply(run,snapshot);
    await save(run); await chrome.alarms.create(ALARM, {periodInMinutes: 0.5}); requestTick(); return run;
  }
  async function stop() {
    const run = await getRun();
    if (run) {
      await releaseNative(run);
      run.status = 'cancelled'; run.reason = '已停止流程'; log(run, 'Flow stopped'); await save(run);
      chrome.tabs.sendMessage(run.tabId, {type: 'PF_CANCEL'}).catch(() => {});
    }
    await chrome.alarms.clear(ALARM);
  }
  return {start, resume, pause, stop, tick};
}
