import {d as listChains,c as makeRef,s as saveChain} from './assets/storage.js';
import {Settings} from './native-settings.js';
import {PromptSources} from './native-prompt-sources.js';
import {connect,connection,target} from './native-connection.js';
const M=PromptFlowModel,S=PromptFlowStore;
const rpc=async(type,payload={})=>{const result=await chrome.runtime.sendMessage({type,...payload});if(!result?.ok)throw new Error(result?.error||'操作失败');return result;};
let chains=[],run=null,timer,toastTimer;
function toast(text){clearTimeout(toastTimer);let el=document.getElementById('pc-toast');if(!el){el=document.createElement('div');el.id='pc-toast';el.className='pc-toast';document.body.append(el);}el.replaceChildren(document.createTextNode(text));const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','关闭提示');close.onclick=()=>el.remove();el.append(close);toastTimer=setTimeout(()=>el.remove(),5000);}
const action=callback=>async()=>{try{await callback();}catch(error){if(error.name!=='AbortError')toast(error.message);}};
const flowId=chainId=>chainId.startsWith('pc-')?chainId.slice(3):'native-'+chainId;
// The self-test chain ships with the extension: prompts, one attachment, three
// attachments and a two-file comparison. It is seeded once, then treated like any
// other chain, so deleting it is final.
const SELF_TEST={id:'selftest-reading-check',source:'tests/fixtures/self-test/自检链条.md',title:'内置自检 · 提示词与附件'};
async function seedSelfTest(){
  if((await chrome.storage.local.get('pcSelfTestSeeded')).pcSelfTestSeeded)return;
  if((await listChains()).some(chain=>chain.id===SELF_TEST.id)){await chrome.storage.local.set({pcSelfTestSeeded:1});return;}
  const folder=SELF_TEST.source.replace(/[^/]+$/,'');
  const read=async name=>{
    try{const response=await fetch(chrome.runtime.getURL(folder+encodeURIComponent(name)));return response.ok?response:null;}catch{return null;}
  };
  const markdown=await read(SELF_TEST.source.slice(folder.length));
  if(!markdown)return;
  const parsed=PromptFlowChatImport.parse(await markdown.text());
  const pending=new Map(),steps=[];
  for(const step of parsed.steps){
    const attachments=[];
    for(const item of step.importAttachments||[]){
      const response=await read(item.name);
      if(!response)continue;
      const file=new File([await response.blob()],item.name,{type:item.mimeType||'text/markdown'});
      const ref=makeRef(file);
      pending.set(ref.id,file);
      attachments.push(ref);
    }
    steps.push({content:step.text||'',attachments});
  }
  if(!steps.length)return;
  await saveChain({id:SELF_TEST.id,title:SELF_TEST.title,description:'纯文本、单附件、多附件与对照检查；安装后自带，删除后不再重建。',steps},pending);
  await chrome.storage.local.set({pcSelfTestSeeded:1});
}
async function editFlow(chainId){const result=await rpc('PC_PREPARE',{payload:{chainId}});location.href=chrome.runtime.getURL('workflow.html?flow='+encodeURIComponent(result.flowId));}
// Shift+↑/↓ moves the card that was clicked last, then renumbers the list.
const PROMPT_SORT=(a,b)=>{
  const custom=(a.order??Number.MIN_SAFE_INTEGER)-(b.order??Number.MIN_SAFE_INTEGER);if(custom!==0)return custom;
  const used=(b.lastUsedAt??0)-(a.lastUsedAt??0);if(used!==0)return used;
  const edited=(b.updatedAt??0)-(a.updatedAt??0);if(edited!==0)return edited;
  return (b.createdAt??0)-(a.createdAt??0);
};
let activeTarget=null;
const cardOf=node=>node?.closest?.('.prompt-card,.chain-card')||null;
const identity=card=>card.matches('.chain-card')?{kind:'chain',id:card.dataset.chainId||''}:{kind:'prompt',id:card.dataset.promptId||''};
function findCard(target){
  if(!target?.id)return null;
  const selector=target.kind==='chain'?`.chain-card[data-chain-id="${CSS.escape(target.id)}"]`:`[data-prompt-id="${CSS.escape(target.id)}"]`;
  return document.querySelector(selector);
}
async function movePrompt(id,neighborId){
  const stored=(await chrome.storage.local.get('langqueue_prompts')).langqueue_prompts,items=stored?.promptsById;
  if(!items)return false;
  const order=Object.values(items).sort(PROMPT_SORT).map(item=>item.id);
  const from=order.indexOf(id),to=order.indexOf(neighborId);
  if(from<0||to<0)return false;
  order.splice(from,1);order.splice(to,0,id);
  order.forEach((key,index)=>{const item=items[key];if(item)item.order=index;});
  await chrome.storage.local.set({langqueue_prompts:{...stored,meta:{...stored.meta,updatedAt:Date.now()}}});
  return true;
}
async function moveChain(id,neighborId){
  const stored=(await chrome.storage.local.get('langqueue_chains')).langqueue_chains,items=stored?.items;
  if(!Array.isArray(items))return false;
  const from=items.findIndex(item=>item.id===id),to=items.findIndex(item=>item.id===neighborId);
  if(from<0||to<0)return false;
  const [item]=items.splice(from,1);items.splice(to,0,item);
  await chrome.storage.local.set({langqueue_chains:{...stored,version:2,updatedAt:Date.now(),items}});
  return true;
}
async function moveCard(card,direction){
  const target=identity(card);if(!target.id)return;
  const siblings=[...card.parentElement.children].filter(node=>node.matches('.prompt-card,.chain-card'));
  const neighbor=siblings[siblings.indexOf(card)+direction];
  if(!neighbor)return;
  const other=identity(neighbor);if(!other.id||other.kind!==target.kind)return;
  const moved=target.kind==='chain'?await moveChain(target.id,other.id):await movePrompt(target.id,other.id);
  if(!moved)return;
  activeTarget=target;
  await rpc('PC_PANEL_REFRESH').catch(()=>{});
}
function markSelected(){
  for(const node of document.querySelectorAll('[data-pc-selected]'))node.removeAttribute('data-pc-selected');
  const card=findCard(activeTarget);
  if(card)card.setAttribute('data-pc-selected','true');
}
function setupCardReorder(){
  const remember=node=>{const card=cardOf(node);if(!card)return;const found=identity(card);if(!found.id)return;activeTarget=found;markSelected();};
  document.addEventListener('pointerdown',event=>remember(event.target),true);
  document.addEventListener('focusin',event=>remember(event.target));
  document.addEventListener('keydown',event=>{
    if(!event.shiftKey||event.ctrlKey||event.metaKey||event.altKey)return;
    if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;
    if(event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
    const card=cardOf(document.activeElement)||findCard(activeTarget);
    if(!card)return;
    event.preventDefault();event.stopPropagation();
    moveCard(card,event.key==='ArrowUp'?-1:1).catch(error=>toast(error.message));
  },true);
}
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
  markSelected();
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
  await rpc('PC_MIGRATE').catch(error=>toast(error.message));await seedSelfTest().catch(()=>{});setupCardReorder();await refresh();
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['title','data-ready']});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.langqueue_chains||changes.pfRun))refresh().catch(()=>{});});
  const reconnect=()=>connect().then(schedule).catch(()=>{});
  chrome.tabs.onActivated.addListener(reconnect);chrome.tabs.onUpdated.addListener(reconnect);setInterval(reconnect,2500);
}
