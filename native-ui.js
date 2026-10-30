import {d as listChains} from './assets/storage.js';
import {Settings} from './native-settings.js';
import {PromptSources} from './native-prompt-sources.js';
import {connect,connection,target} from './native-connection.js';
const M=PromptFlowModel,S=PromptFlowStore;
const rpc=async(type,payload={})=>{const result=await chrome.runtime.sendMessage({type,...payload});if(!result?.ok)throw new Error(result?.error||'操作失败');return result;};
let chains=[],run=null,timer,toastTimer;
function toast(text){clearTimeout(toastTimer);let el=document.getElementById('pc-toast');if(!el){el=document.createElement('div');el.id='pc-toast';el.className='pc-toast';document.body.append(el);}el.replaceChildren(document.createTextNode(text));const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','关闭提示');close.onclick=()=>el.remove();el.append(close);toastTimer=setTimeout(()=>el.remove(),5000);}
const action=callback=>async()=>{try{await callback();}catch(error){if(error.name!=='AbortError')toast(error.message);}};
const flowId=chainId=>chainId.startsWith('pc-')?chainId.slice(3):'native-'+chainId;
async function editFlow(chainId){const result=await rpc('PC_PREPARE',{payload:{chainId}});location.href=chrome.runtime.getURL('workflow.html?flow='+encodeURIComponent(result.flowId));}
async function refresh(){chains=await listChains();run=(await chrome.storage.local.get('pfRun')).pfRun||null;await connect();schedule();}
function patch(){
  const exporting=[...document.querySelectorAll('.popup-footer button')].find(button=>button.textContent.trim()==='导出'),exportSvg=exporting?.querySelector('svg');
  if(exportSvg&&exportSvg.dataset.pcIcon!==PromptChainIcons.export){
    exportSvg.replaceChildren();
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',PromptChainIcons.export);
    exportSvg.append(path);exportSvg.dataset.pcIcon=PromptChainIcons.export;
  }
  const rows=[...document.querySelectorAll('.chain-card')];
  rows.forEach(row=>{
    const chain=chains.find(c=>c.id===row.dataset.chainId);if(!chain)return;
    row.querySelector('[data-pc-advanced]')?.remove();
    const tools=row.lastElementChild,buttons=[...tools.children].filter(el=>el.tagName==='BUTTON'&&!el.dataset.pcPause),[start,edit]=buttons;if(!start||!edit)return;
    let pause=tools.querySelector('[data-pc-pause]');
    if(!pause){pause=document.createElement('button');pause.className='compact-button pc-icon';pause.dataset.pcPause=chain.id;pause.setAttribute('aria-label','暂停流程 '+chain.title);pause.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+PromptChainIcons.pause+'"/></svg>';pause.onclick=action(async()=>{await rpc('PF_PAUSE');await refresh();});}
    if(pause.nextElementSibling!==edit)tools.insertBefore(pause,edit);
    const active=run&&M.ACTIVE.has(run.status),current=active&&run.flow.id===flowId(chain.id);
    start.disabled=active?!current:!connection().ready||!chain.steps.length;
    start.setAttribute('aria-label',(current?(run.status==='paused'?'恢复流程 ':'查看执行记录 '):'运行流程 ')+chain.title);
    pause.disabled=!current;pause.setAttribute('aria-label','停止流程 '+chain.title);
    if(pause.dataset.glyph!=='stop'){pause.dataset.glyph='stop';pause.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+PromptChainIcons.stop+'"/></svg>';}
    pause.onclick=action(async()=>{await rpc('PF_STOP');await refresh();});
  });
  for(const el of document.querySelectorAll('[title]'))el.removeAttribute('title');
  const header=document.querySelector('.popup-header .platform-status');
  document.getElementById('pc-run')?.remove();
  if(header){
    const ready=connection().ready;header.dataset.pcReady=String(ready);header.setAttribute('role','img');header.setAttribute('aria-label',ready?'已连接对话':'未连接对话');
    if(!document.getElementById('pc-refresh')){
      const button=document.createElement('button');button.id='pc-refresh';button.className='icon-button pc-icon';button.setAttribute('aria-label','刷新连接');
      button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+PromptChainIcons.refresh+'"/></svg>';
      button.onclick=action(async()=>{button.disabled=true;try{await connect(true);await refresh();}finally{button.disabled=false;}});
      header.after(button);
    }
    // Keep the gear for settings and give the DOM export its own icon, in both the
    // idle panel and the running monitor.
    const gear=document.querySelector('.popup-header button[aria-label="设置"]');
    if(gear&&!gear.dataset.pcDom){
      gear.dataset.pcDom='1';
      const button=document.createElement('button');
      button.id='pc-export-dom';button.className='icon-button pc-icon';button.setAttribute('aria-label','导出页面 DOM');
      button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5 4 12l5 7M15 5l5 7-5 7M13 4l-2 16"/></svg>';
      button.onclick=action(async()=>{const result=await rpc('PF_EXPORT_DOM');toast('已导出 '+result.filename);});
      gear.before(button);
    }
  }
}
function schedule(){if(!timer)timer=setTimeout(()=>{timer=null;patch();},80);}
export async function init(){
  globalThis.PromptChainPromptSources=PromptSources;
  globalThis.PromptChainResolveTarget=target;
  globalThis.PromptChainSettingsView=Settings;
  globalThis.PromptChainSettingsTools={openMonitor:()=>{location.href=chrome.runtime.getURL('workflow.html?monitor=1');},openTrash:()=>{location.href=chrome.runtime.getURL('workflow.html?trash=1');}};
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.textContent.trim()==='新建流程'){event.preventDefault();event.stopImmediatePropagation();location.href=chrome.runtime.getURL('workflow.html?new=1');return;}
    const row=button.closest('.chain-card');if(!row)return;const label=button.getAttribute('aria-label')||'';
    if(label.startsWith('编辑流程 ')){event.preventDefault();event.stopImmediatePropagation();action(()=>editFlow(row.dataset.chainId))();}
    if(['运行流程 ','恢复流程 ','查看执行记录 '].some(prefix=>label.startsWith(prefix))){event.preventDefault();event.stopImmediatePropagation();action(async()=>{
      const current=run&&M.ACTIVE.has(run.status)&&run.flow.id===flowId(row.dataset.chainId);
      if(current){location.href=chrome.runtime.getURL('workflow.html?monitor=1'+(run.status==='paused'?'&resume='+encodeURIComponent(run.id):''));return;}
      else{const selected=await target();if(!selected)throw new Error('请先打开 ChatGPT、Gemini 或 DeepSeek。');
        await rpc('PC_RUN_NATIVE',{tabId:selected.id,payload:{chainId:row.dataset.chainId,expectedHref:selected.url}});
      }
      location.href=chrome.runtime.getURL('workflow.html?monitor=1');
    })();}
  },true);
  globalThis.PromptChainNotify=toast;
  globalThis.PromptChainStepTitle=(step,index)=>'第 '+(index+1)+' 步 · '+M.firstSentence(step.content,step.attachments?.[0]?.name);
  globalThis.PromptChainBeforeDelete=async chain=>{
    const prepared=await rpc('PC_PREPARE',{payload:{chainId:chain.id}}),active=(await chrome.storage.local.get('pfRun')).pfRun;
    if(active?.flow.id===prepared.flowId&&M.ACTIVE.has(active.status))await rpc('PF_STOP');
  };
  globalThis.PromptChainNativeDeleted=async id=>{
    const flowId=id.startsWith('pc-')?id.slice(3):'native-'+id;
    if((await S.readLibrary()).flows.some(f=>f.id===flowId))await S.trashFlow(flowId);
  };
  globalThis.PromptChainImportOwn=async data=>{
    const before=new Set((await S.readLibrary()).flows.map(f=>f.id)),count=await S.importBundle(typeof data==='string'?JSON.parse(data):data);
    for(const flow of (await S.readLibrary()).flows)if(!before.has(flow.id))await rpc('PC_SYNC_FLOW',{flowId:flow.id});
    await refresh();return{chains:{imported:count,replaced:0,skipped:0,duplicated:0}};
  };
  await rpc('PC_MIGRATE').catch(error=>toast(error.message));await refresh();
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['title','data-ready']});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.langqueue_chains||changes.pfRun))refresh().catch(()=>{});});
  const reconnect=()=>connect().then(schedule).catch(()=>{});
  chrome.tabs.onActivated.addListener(reconnect);chrome.tabs.onUpdated.addListener(reconnect);setInterval(reconnect,2500);
}
