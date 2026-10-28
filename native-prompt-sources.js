import {c as nativeRef,o as readChunk} from './assets/storage.js';

const M=PromptFlowModel,S=PromptFlowStore,Sources=PromptChainSources;
async function rpc(type,payload={}){const result=await chrome.runtime.sendMessage({type,...payload});if(!result?.ok)throw new Error(result?.error||'操作失败');return result;}
async function originalFile(ref,pending){
  if(pending.has(ref.id))return pending.get(ref.id);
  const parts=[];let offset=0;
  while(offset<ref.size){const part=await readChunk(ref.id,offset);if(!part||part.nextOffset<=offset)throw new Error('找不到附件：'+ref.name);parts.push(S.decode(part.chunkBase64));offset=part.nextOffset;}
  return new File(parts,ref.name,{type:ref.mimeType});
}
async function draftSteps(draft){
  if(!draft.content.trim()&&!draft.attachments.length)return[];
  if(!draft.attachments.length)return[M.step({text:draft.content})];
  const attachments=[];
  for(const ref of draft.attachments){const file=await originalFile(ref,draft.pendingFiles);attachments.push(await S.saveFile(file));}
  return[M.step({text:draft.content,attachments})];
}
export function PromptSources({e,React,disabled,attach,readDraft,apply,setBusy,session}){
  const [loading,load]=React.useState(false),[error,fail]=React.useState('');
  const chat=React.useRef(null),prompts=React.useRef(null),markdown=React.useRef(null),container=React.useRef(null),alive=React.useRef(true),busy=React.useRef(false);
  React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const glyph=name=>e.jsx('svg',{viewBox:'0 0 24 24','aria-hidden':true,children:e.jsx('path',{d:PromptChainIcons[name]})});
  async function perform(action){
    if(busy.current||disabled)return;const generation=session();busy.current=true;load(true);setBusy(true);fail('');
    const valid=()=>alive.current&&session()===generation;
    try{await action(valid);}catch(reason){if(valid()&&reason.name!=='AbortError')fail(reason.message);}finally{busy.current=false;if(valid()){load(false);setBusy(false);}}
  }
  async function finish(items,title,valid){
    if(!items.length)return;
    const steps=items.flatMap(item=>item.steps),draft=readDraft(),directory=await S.getDirectory();
    const flow=M.flow({title:draft.title.trim()||(items.length===1?items[0].title:title),steps});
    if(directory&&PromptFlowFileMatch.canMatch(flow))await PromptFlowFileMatch.match(flow,directory.handle,S);
    if(!valid())return;
    if(flow.steps.length===1&&!flow.steps[0].missingAttachments.length){
      const step=flow.steps[0],files=[];
      for(const ref of step.attachments){const saved=await S.getFile(ref.id);if(!saved)throw new Error('找不到附件：'+ref.name);const file=new File([saved.bytes],saved.name,{type:saved.mimeType});files.push({file,ref:nativeRef(file)});}
      if(valid()){apply({title:flow.title,content:[draft.content,step.text].filter(Boolean).join('\n\n'),files});requestAnimationFrame(()=>{const body=container.current?.closest('.pc-prompt-body');if(body)body.scrollTop=0;body?.querySelector('#prompt-title')?.focus();});}
      return;
    }
    flow.steps=[...await draftSteps(draft),...flow.steps];
    if(!valid())return;
    await S.saveFlow(flow);await rpc('PC_SYNC_FLOW',{flowId:flow.id});
    if(valid())location.href=chrome.runtime.getURL('workflow.html?flow='+encodeURIComponent(flow.id)+'&imported=1');
  }
  async function offer(items,title,valid){
    if(!valid())return;if(!items.length)throw new Error('没有可导入的提示词');
    return finish(items,title,valid);
  }
  function fileInput(ref,accept,kind){return e.jsx('input',{type:'file',ref,accept,multiple:kind!=='chat',hidden:true,'data-pc-source':kind,onChange:event=>{
    const files=[...event.target.files];event.target.value='';if(!files.length)return;
    perform(async valid=>{
      if(kind==='chat'){
        const parsed=PromptFlowChatImport.parse(await files[0].text()),flow=await PromptFlowChatImport.materialize(parsed,S);
        await offer([{title:flow.title,steps:flow.steps}],flow.title,valid);
      }else await offer(await Sources.files(files,S),files[0].name.replace(/\.[^.]+$/,''),valid);
    });
  }});}
  const button=(label,name,click)=>e.jsxs('button',{type:'button',className:'compact-button pc-source-button',disabled:disabled||loading,onClick:click,children:[glyph(name),e.jsx('span',{children:label})]});
  return e.jsxs('div',{className:'pc-prompt-sources',ref:container,children:[
    e.jsxs('div',{className:'pc-prompt-source-actions',children:[
      button('导入聊天','chat',()=>chat.current.click()),
      button('导入 Skill','skill',()=>perform(async valid=>{const directory=await showDirectoryPicker({id:'prompt-chain-skills',mode:'read'});await offer(await Sources.skills(directory),directory.name,valid);})),
      button('导入 Prompts','prompts',()=>prompts.current.click()),
      button('导入 Markdown','file',()=>markdown.current.click()),
      button('添加附件','attachment',attach),
      button('附件目录','folder',()=>perform(async valid=>{const directory=await showDirectoryPicker({id:'prompt-chain-source',mode:'read'});if(!valid())return;await S.saveDirectory(directory);await PromptFlowFileMatch.cacheDirectory(directory,S);} ))
    ]}),
    fileInput(chat,'.md,.markdown,.txt','chat'),fileInput(prompts,'.json,.md,.markdown,.txt','prompts'),fileInput(markdown,'.md,.markdown,.txt','markdown'),
    error?e.jsx('div',{className:'pc-source-error',role:'alert',children:error}):null
  ]});
}
