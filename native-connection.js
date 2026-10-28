import {providerFor} from './shared/platforms.mjs';
const supported=url=>!!providerFor(url);
let tab=null,ready=false,sequence=0;
export async function target(){
  const run=(await chrome.storage.local.get('pfRun')).pfRun;
  const tabs=(await chrome.tabs.query({})).filter(item=>supported(item.url));
  if(run&&PromptFlowModel.ACTIVE.has(run.status))return tabs.find(item=>item.id===run.tabId)||tabs.find(item=>PromptFlowModel.sameChat(run.targetUrl,item.url))||null;
  const active=(await chrome.tabs.query({active:true,currentWindow:true})).find(item=>supported(item.url));
  return active||tabs.find(item=>item.id===tab?.id)||tabs[0]||null;
}
export async function connect(repair=false){
  const request=++sequence,next=await target();let ok=false;
  const run=(await chrome.storage.local.get('pfRun')).pfRun;
  const expected=run&&PromptFlowModel.ACTIVE.has(run.status)?run.targetUrl:'';
  if(repair&&!next){if(request===sequence){tab=null;ready=false;}throw new Error(expected?'TARGET_TAB_CLOSED: The tab bound to this flow was closed':'请先打开 ChatGPT、Gemini 或 DeepSeek 对话页');}
  if(next)try{
    const response=repair?await chrome.runtime.sendMessage({type:'PF_CONNECT',tabId:next.id}):await chrome.tabs.sendMessage(next.id,{type:'PF_STATUS'});
    const snapshot=response?.snapshot;
    ok=!!(response?.ok&&snapshot?.hasComposer&&PromptFlowModel.sameChat(next.url,snapshot.url,true)&&(!expected||PromptFlowModel.sameChat(expected,snapshot.url)));
    if(repair&&!ok)throw new Error(response?.error||(expected&&snapshot&&!PromptFlowModel.sameChat(expected,snapshot.url)?'TARGET_CONVERSATION_LOST: The bound conversation is no longer open':'尚未连接到聊天输入框'));
  }catch(error){if(repair){if(request===sequence){tab=next;ready=false;}throw error;}}
  if(request===sequence){tab=next;ready=ok;}
  return{tab,ready};
}
export const connection=()=>({tab,ready});
