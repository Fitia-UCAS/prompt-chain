import {providerFor} from '../shared/platforms.mjs';
import {reason as logReason} from '../shared/logging.mjs';

export function createConnection({chrome, model: M, runs, native, clock: Date = globalThis.Date, sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))}) {
  const {getRun} = runs;
  const closed = message => /No tab with id|Invalid tab ID|The tab was closed/i.test(message || '');
  function failure(code,message,cause){
    const error=new Error(code+': '+message);
    error.code=code;
    if(cause){error.cause=cause;error.originCode=cause.code||cause.name||'';}
    return error;
  }
  async function tabState(tabId){
    try{const tab=await chrome.tabs.get(tabId);return{tab,error:''};}
    catch(error){return{tab:null,error:closed(error?.message)?'TARGET_TAB_CLOSED: The bound tab no longer exists':error?.message||'TARGET_TAB_UNAVAILABLE: The bound tab could not be read'};}
  }
  async function status(tabId, inject = false) {
    const {tab:bound,error:tabError}=await tabState(tabId);
    if(!bound)throw new Error((tabError.startsWith('TARGET_TAB_CLOSED')?tabError:'TARGET_TAB_UNAVAILABLE: The bound tab could not be read')+' (tabId '+tabId+')');
    try {
      let response = await chrome.tabs.sendMessage(tabId, {type: 'PF_STATUS'});
      if (!response?.ok) throw failure('WEB_NOT_CONNECTED','The page did not answer the extension status request');
      if(response.snapshot.reader?.version!==7||response.snapshot.engineVersion!==10){
        const tab=await chrome.tabs.get(tabId);if(!M.allowedUrl(tab.url))throw new Error('目标页已离开支持的聊天网站');
        await chrome.scripting.executeScript({target:{tabId},files:['vendor/marked/marked.min.js','shared/platforms.js','shared/model.js','content/history-reader.js','content/site-messages.js','content/message-reader.js','content/supervisor-engine.js']});
        response=await chrome.tabs.sendMessage(tabId,{type:'PF_STATUS'});if(!response?.ok)throw new Error('读取器更新后未连接');
      }
      const snapshot=response.snapshot,run=await getRun(),operation=run?.tabId===tabId?(run.pending||run.delivery):null;
      if(M.platforms.providerFor(snapshot.url)==='chatgpt'&&M.conversationPath(snapshot.url)&&snapshot.reader&&(snapshot.reader.users===0||snapshot.reader.assistants===0||(snapshot.lastRole==='user'&&!snapshot.generating)||(operation&&!M.receipt(snapshot,operation)))){
        try{
          const result=await chrome.scripting.executeScript({target:{tabId},func:async url=>globalThis.PromptChainHistory.read(url),args:[snapshot.url]});
          if(result?.[0]?.result)return historySnapshot(snapshot,result[0].result,operation);
        }catch(error){snapshot.reader.historyError=error.message;}
      }
      return snapshot;
    } catch (error) {
      if (/^(?:TARGET_TAB_|WEB_)/.test(error.message || '')) throw error;
      if (!inject) throw failure('WEB_NOT_CONNECTED','The page did not answer the extension; refresh it before resuming',error);
      const tab = await chrome.tabs.get(tabId).catch(()=>{throw failure('TARGET_TAB_CLOSED','The bound tab no longer exists (tabId '+tabId+')',error);});
      if (!M.allowedUrl(tab.url)) throw failure('CONVERSATION_CHANGED','The target page left the supported chat sites',error);
      try{
        await chrome.scripting.executeScript({target: {tabId}, files: ['vendor/marked/marked.min.js', 'shared/platforms.js','shared/model.js','content/history-reader.js', 'content/site-messages.js','content/message-reader.js', 'content/supervisor-engine.js', 'content/bridge.js','content/native-files.js']});
      }catch(injectError){
        throw failure('WEB_INJECT_FAILED','The extension could not attach to the page',injectError);
      }
      return status(tabId);
    }
  }
  async function rebind(run){
    const bound=await tabState(run.tabId);
    const matches=tab=>!!tab&&M.allowedUrl(tab.url)&&M.sameChat(run.targetUrl,tab.url);
    if(matches(bound.tab))return{tab:bound.tab,rebound:false};
    if(!M.conversationPath(run.targetUrl))return{tab:null,rebound:false,error:bound.tab?'请回到流程锁定的原对话':'TARGET_TAB_CLOSED: The bound tab was closed before the conversation had a stable address'};
    const tabs=typeof chrome.tabs.query==='function'?await chrome.tabs.query({}).catch(()=>[]):[];
    const candidates=tabs.filter(tab=>tab.id!==run.tabId&&matches(tab));
    if(!candidates.length)return{tab:null,rebound:false,error:bound.tab?'请回到流程锁定的原对话':'TARGET_TAB_CLOSED: Reopen the conversation bound to this flow before resuming'};
    const tab=candidates.find(item=>item.active)||candidates[0];
    return{tab,rebound:true};
  }
  function historySnapshot(dom,history,operation){
    if(!M.sameChat(dom.url,history.url))return dom;
    const prefix=dom.lastUser?.folded?M.semanticText(dom.lastUser.text).replace(/(?:…|\.{3})$/u,'').trim():'';
    const messages=history.messages.map(message=>{
      const fingerprint=M.fingerprint(message.role+'\n'+message.text),fingerprintAliases=M.deliveryTexts(message.text).map(text=>M.fingerprint(message.role+'\n'+text));
      if(prefix.length>=80&&message.role==='user'&&M.deliveryTexts(message.text).some(text=>text.startsWith(prefix)))fingerprintAliases.push(dom.lastUser.fingerprint);
      return{...message,key:'m:'+message.id,fingerprint,fingerprintAliases};
    });
    const user=messages.filter(message=>message.role==='user').at(-1),assistant=messages.filter(message=>message.role==='assistant').at(-1);
    const candidate={...dom,lastRole:messages.at(-1)?.role||'',lastUser:user?{key:user.key,text:user.text,variants:[user.text],filesText:user.filesText}:null,
      assistant:assistant?{key:assistant.key,text:assistant.text,signature:assistant.key+'|'+assistant.fingerprint}:null,messages,
      generating:dom.generating||(messages.at(-1)?.role==='assistant'&&!assistant.complete),reader:{...dom.reader,source:'conversation-history',domUsers:dom.reader.users,domAssistants:dom.reader.assistants,users:messages.filter(message=>message.role==='user').length,assistants:messages.filter(message=>message.role==='assistant').length,count:messages.length}};
    const matchingDOM=message=>{
      if(!dom.lastUser)return false;
      if(dom.lastUser.key.startsWith('m:'))return dom.lastUser.key===message.key;
      const full=M.deliveryTexts(message.text),seen=(dom.lastUser.variants||[dom.lastUser.text]).flatMap(M.deliveryTexts);
      return full.some(text=>seen.includes(text))||(prefix.length>=80&&full.some(text=>text.startsWith(prefix)));
    };
    const baseline=operation?.baselineMessages||[];
    const knownPrevious=messages.some(message=>message.role==='user'&&matchingDOM(message)&&baseline.some(before=>before.role==='user'&&(before.key===message.key||[message.fingerprint,...message.fingerprintAliases].includes(before.fingerprint))));
    if(operation&&knownPrevious&&M.receipt(candidate,operation)){
      candidate.reader.domBehindHistory=true;return candidate;
    }
    if(dom.lastUser&&user){
      if(dom.lastUser.key.startsWith('m:')&&dom.lastUser.key!==user.key)return dom;
      const full=M.deliveryTexts(user.text),seen=(dom.lastUser.variants||[dom.lastUser.text]).flatMap(M.deliveryTexts);
      if((user.text||dom.lastUser.text)&&!full.some(text=>seen.includes(text))&&!(prefix.length>=80&&full.some(text=>text.startsWith(prefix))))return dom;
      const ordinal=/^dom:user:([a-z0-9]+):(\d+)$/.exec(dom.lastUser.key);
      if(ordinal&&messages.filter(message=>message.role==='user'&&[message.fingerprint,...message.fingerprintAliases].includes(ordinal[1])).length!==Number(ordinal[2]))return dom;
    }
    return candidate;
  }
  function matchTarget(run,snapshot) {
    if(M.sameChat(run.targetUrl,snapshot.url))return true;
    const operation=run.pending||run.delivery,a=M.platforms.route(run.targetUrl),b=M.platforms.route(snapshot.url);
    const emptyGemini=operation&&a?.provider==='gemini'&&b?.provider==='gemini'&&a.origin===b.origin&&a.scope===b.scope&&b.id&&run.index===0&&!run.bindingFinalized&&Array.isArray(operation.baselineMessages)&&operation.baselineMessages.length===0&&new URL(operation.url).searchParams.get('dest')==='create';
    if(emptyGemini&&operation.attemptedAt&&M.receipt(snapshot,operation)){
      run.targetUrl=snapshot.url;run.allowNewChat=false;run.bindingFinalized=true;return true;
    }
    if((!run.allowNewChat&&!M.temporaryConversation(run.targetUrl))||!M.sameChat(run.targetUrl,snapshot.url,true))return false;
    if(run.pending?.attemptedAt)return true;
    if(!run.delivery?.attemptedAt||!M.receipt(snapshot,run.delivery))return false;
    run.targetUrl=snapshot.url;run.allowNewChat=!M.conversationPath(snapshot.url);run.bindingFinalized=!run.allowNewChat;
    return true;
  }
  function diagnostic(run,snapshot,meta={}) {
    const s=snapshot||{},available=!!snapshot;
    const decision=available&&run.phase==='waiting'?M.replyDecision(run,s):null;
    const operation=run.pending||run.delivery;
    return{version:chrome.runtime.getManifest?.()?.version||'unknown',engineVersion:s.engineVersion,bridgeVersion:s.bridgeVersion||0,status:run.status,phase:run.phase,step:run.index+1,targetUrl:run.targetUrl,actualUrl:s.url,dom:available?'available':'unavailable',snapshotError:meta.error||'',tab:{id:run.tabId,title:run.tabTitle,open:!!meta.tabId},
      waitingFor:decision?.reason?logReason(decision.reason):decision?.type||run.phase,generating:s.generating,generationStrategy:s.generationStrategy||'legacy-reader',generationSignals:s.generationSignals||[],reader:s.reader,lastRole:s.lastRole,
      user:{key:s.lastUser?.key,sentKey:run.sentUserKey,receiptMatched:!!operation&&!!snapshot&&M.receipt(s,operation),textMatch:operation&&available?M.receiptText(s,operation):null,imageCount:s.lastUser?.imageCount},attachmentUploaded:!!operation?.attachmentUploaded,upload:s.upload||null,
      assistant:{key:s.assistant?.key,sameAsBefore:!!s.assistant?.key&&s.assistant.key===run.beforeAssistantKey,characters:s.assistant?.text?.length||0,signature:s.assistant?.signature},
      quietMilliseconds:run.quietSince?Date.now()-run.quietSince:0,waitingMilliseconds:run.sentAt?Date.now()-run.sentAt:0,lastFailure:run.lastFailure||null,snapshotCause:meta.cause||'',snapshotCauseCode:meta.causeCode||''};
  }
  async function connect(tabId) {
    const tab = await chrome.tabs.get(Number(tabId)), provider = providerFor(tab.url);
    if (!provider) throw new Error('请选择 ChatGPT、Gemini 或 DeepSeek 网页');
    if (native || provider !== 'chatgpt') {
      let result = await chrome.tabs.sendMessage(tab.id, {type: 'COMPAT_CHECK', payload: {}}).catch(() => null);
      if (!result?.ok || !result.result?.ready) {
        await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['assets/site-loader.js']});
        for (let attempt = 0; attempt < 10; attempt++) {
          await sleep(150);
          result = await chrome.tabs.sendMessage(tab.id, {type: 'COMPAT_CHECK', payload: {}}).catch(() => null);
          if (result?.ok && result.result?.ready) break;
        }
      }
      if (!result?.ok || !result.result?.ready) throw new Error('尚未找到聊天输入框，请等待网页加载完成后重试');
    }
    return status(tab.id, true);
  }
  return {status, connect, rebind, tabState, historySnapshot, matchTarget, diagnostic};
}
