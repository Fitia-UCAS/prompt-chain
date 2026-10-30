import {record} from '../shared/logging.mjs';
export function createRunStore({chrome, model: M, scheduler, clock: Date = globalThis.Date}) {
  let replyView = null;
  const {arm} = scheduler;
  const getRun = async () => {const run=(await chrome.storage.local.get('pfRun')).pfRun||null;if(run&&Object.hasOwn(run,'lastReply')){delete run.lastReply;await chrome.storage.local.set({pfRun:run});}return run;};
  function log(run, text, tone = 'info',logger='prompt_chain.runner') {run.logs = [...(run.logs || []), record(Date.now(),text,tone,logger)].slice(-250);}
  function verificationReply(run,snapshot){
    const current=M.ACTIVE.has(run.status)&&run.phase==='waiting'&&snapshot&&M.sameChat(run.targetUrl,snapshot.url)&&(run.delivery?M.receipt(snapshot,run.delivery):snapshot.lastUser?.key===run.sentUserKey)&&snapshot.lastRole==='assistant'&&snapshot.assistant?.key!==run.beforeAssistantKey;
    if(M.ACTIVE.has(run.status)&&replyView?.runId===run.id&&(!current||!snapshot.assistant?.text))return;
    const value={runId:run.id,index:run.index,text:current?(snapshot.assistant?.text||'').slice(-2400):''};
    if(replyView?.runId===value.runId&&replyView.index===value.index&&replyView.text===value.text)return;
    replyView=value;chrome.runtime.sendMessage?.({type:'PF_REPLY_VIEW',view:value})?.catch(()=>{});
  }
  async function save(run) {delete run.lastReply;if(!M.ACTIVE.has(run.status))verificationReply(run,null);run.updatedAt = Date.now(); await chrome.storage.local.set({pfRun: run}); arm(run); return run;}
  function currentReply(run) {
    const current = run && M.ACTIVE.has(run.status) && replyView?.runId === run.id;
    return current ? replyView : run ? {runId: run.id, index: run.index, text: ''} : null;
  }
  return {getRun, log, save, verificationReply, currentReply};
}
