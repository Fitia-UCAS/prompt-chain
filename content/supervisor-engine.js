(() => {
if (globalThis.PromptFlowSupervisor?.engineVersion===10) return;
const SETTLE_SAMPLE_MS=850;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=x=>String(x||'').replace(/\u00a0/g,' ').replace(/\r\n?/g,'\n').trim();
const rect=el=>{try{return el.getBoundingClientRect()}catch{return {width:0,height:0}}};
const rendered=el=>{if(!el||!el.isConnected)return false;const st=getComputedStyle(el),r=rect(el);return st.display!=='none'&&st.visibility!=='hidden'&&r.width>0&&r.height>0};
const R=PromptChainMessages;
const msgs=()=>R.read().messages.map(message=>message.node);
const messageRole=node=>R.role(node);
const lastAssistant=()=>msgs().filter(node=>messageRole(node)==='assistant').at(-1)||null;
const lastRole=()=>R.read().messages.at(-1)?.role||'';
const key=node=>R.read().messages.find(message=>message.node===node)?.key||'';
const text=node=>R.texts(node,messageRole(node))[0]||'';
function generationSignals(){
  const selectors=['[data-testid="stop-button"]','[data-testid="fruitjuice-stop-button"]','button[aria-label*="Stop" i]','button[aria-label*="停止"]','button[title*="Stop" i]','button[title*="停止"]','[role="button"][aria-label*="Stop" i]','[role="button"][aria-label*="停止"]','.send-button.stop'];
  return selectors.filter(selector=>[...document.querySelectorAll(selector)].some(rendered));
}
const generating=()=>generationSignals().length>0;
function assistantSignature(){const message=R.read().messages.filter(message=>message.role==='assistant').at(-1);return message?message.key+'|'+message.fingerprint:'';}

function composer(){
  const adapter=globalThis.PromptChainSiteAdapter;
  if(adapter&&adapter.id!=='chatgpt')return adapter.getInputElement();
  for(const q of ['#prompt-textarea','textarea#mobile-composer-prompt','textarea[data-testid="prompt-textarea"]','textarea[placeholder*="DeepSeek" i]','textarea:not([disabled]):not([readonly])','[contenteditable="true"][data-virtualkeyboard="true"]','div[contenteditable="true"][role="textbox"]','input-area-v2 [contenteditable="true"]']){
    const e=[...document.querySelectorAll(q)].find(rendered);
    if(e)return e;
  }
  return null;
}
function ctext(c){return clean(c instanceof HTMLTextAreaElement?c.value:c?.innerText||c?.textContent)}
function fill(c,val){
  c.focus();
  if(c instanceof HTMLTextAreaElement){
    const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;
    set?set.call(c,val):c.value=val;
    c.dispatchEvent(new Event('input',{bubbles:true}));
    return;
  }
  const sel=window.getSelection(),r=document.createRange();
  r.selectNodeContents(c);sel.removeAllRanges();sel.addRange(r);
  try{document.execCommand('insertText',false,val)}catch{c.textContent=val}
  c.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:val}));
}
function sendBtn(c){
  const adapter=globalThis.PromptChainSiteAdapter;
  if(adapter&&adapter.id!=='chatgpt')return adapter.getSendButton(c);
  const root=c?.closest('form')||document;
  for(const q of [
    'button[data-testid="send-button"]',
    'button[data-testid="fruitjuice-send-button"]',
    'button#composer-submit-button',
    'button[aria-label="Send prompt"]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="发送"]'
  ]){
    const b=[...root.querySelectorAll(q)].find(x=>rendered(x)&&!x.disabled&&x.getAttribute('aria-disabled')!=='true');
    if(b)return b;
  }
  return null;
}

async function waitForSendArrow(c,timeout=3200){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    if(generating())return null;
    const b=sendBtn(c);
    if(b)return b;
    await sleep(120);
  }
  return null;
}

async function verifySent(){
  for(let i=0;i<20;i++){
    if(generating()||lastRole()==='user')return true;
    await sleep(160);
  }
  return false;
}

async function assistantReplySettled(){
  if(generating())return false;
  const sig1=assistantSignature();
  if(!sig1)return false;
  await sleep(SETTLE_SAMPLE_MS);
  if(generating())return false;
  const sig2=assistantSignature();
  return !!sig2&&sig1===sig2&&lastRole()==='assistant';
}


function scope(c=composer()) {
  if(PromptFlowModel.platforms.providerFor(location.href)==='chatgpt'&&c?.closest('form'))return c.closest('form');
  return c?.closest('form,input-area-v2,[data-testid="composer"]') || c?.parentElement?.parentElement || null;
}
const ATTACHMENT_EXCLUDED='[role="dialog"],[role="menu"],[role="listbox"],[role="tooltip"],nav,aside,article,[data-message-author-role]';
const INVISIBLE_CHARS=/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;
const DASH_CHARS=/[\u2010\u2011\u2012\u2013\u2014\u2212]/g;
const PICKER_LABEL=/^(?:attach|upload|add\s+(?:file|photo|attachment)|添加|上传|选择文件)/i;
const nameNorm=value=>PromptFlowModel.echoNorm(String(value||'').replace(INVISIBLE_CHARS,'').replace(DASH_CHARS,'-'));
// ChatGPT may replace characters that are unsafe in a filename (：，、) with an
// underscore or strip them, so a sanitised display name still identifies the file.
const LOOSE_PUNCT=/[\s:：,，、;；·・_—–\-()（）\[\]【】<>《》"'“”‘’]/g;
const looseName=value=>nameNorm(value).replace(LOOSE_PUNCT,'');
function nodePath(node){
  const parts=[];
  for(let el=node,i=0;el&&el.tagName&&el!==document.body&&i<4;el=el.parentElement,i++){
    const id=el.getAttribute?.('data-testid');
    parts.unshift(el.tagName.toLowerCase()+(id?'['+String(id).slice(0,48)+']':''));
  }
  return parts.join('>');
}
function attachmentRoots(c=composer()){
  const form=scope(c);if(!form)return[];
  const adapter=globalThis.PromptChainSiteAdapter;
  if(adapter&&adapter.id!=='chatgpt')return[{root:form,kind:'adapter'}];
  const roots=[{root:form,kind:'form'}];
  let node=form;
  for(let depth=1;depth<=3;depth++){
    const parent=node.parentElement;
    if(!parent||parent===document.body||parent===document.documentElement||parent.tagName==='MAIN')break;
    if(parent.querySelector('article,[data-message-author-role]'))break;
    if(parent.querySelectorAll('form').length>1)break;
    roots.push({root:parent,kind:'wrapper-'+depth});
    node=parent;
  }
  return roots;
}
function nameSpec(ref){
  const full=nameNorm(ref?.name||'');if(!full)return null;
  const dot=full.lastIndexOf('.');
  const hasExtension=dot>2&&/^\.[a-z0-9]{1,8}$/i.test(full.slice(dot));
  return{full,stem:hasExtension?full.slice(0,dot):full,ext:hasExtension?full.slice(dot).toLowerCase():''};
}
function fileParts(value){
  const match=/(\.[a-z0-9]{1,8})$/i.exec(value||'');
  return match?{ext:match[1].toLowerCase(),stem:value.slice(0,match.index)}:{ext:'',stem:value||''};
}
function filteredSeeds(root){
  let hidden=0,excluded=0,blockedBy='';
  for(const node of root.querySelectorAll('[data-testid*="attachment" i],[data-testid*="file" i]')){
    const blocker=node.closest(ATTACHMENT_EXCLUDED);
    if(blocker){excluded++;if(!blockedBy)blockedBy=blocker.tagName.toLowerCase()+(blocker.getAttribute?.('role')?'[role='+blocker.getAttribute('role')+']':'');}
    else if(!rendered(node))hidden++;
  }
  return{hidden,excluded,blockedBy};
}
function attachmentSeeds(root){
  if(!root||!root.querySelectorAll)return[];
  const seeds=[];
  for(const node of root.querySelectorAll('[data-testid*="attachment" i],[data-testid*="file" i],[data-testid="composer-file"]')){
    if(!rendered(node)||node.closest(ATTACHMENT_EXCLUDED))continue;
    const label=(node.getAttribute('aria-label')||'')+' '+(node.getAttribute('title')||'')+' '+clean(node.textContent);
    if(node.tagName==='INPUT'||node.tagName==='BUTTON'&&PICKER_LABEL.test(label)||node.getAttribute('role')==='button'&&PICKER_LABEL.test(label))continue;
    seeds.push(node);
  }
  for(const button of root.querySelectorAll('button,[role="button"]')){
    if(!rendered(button)||button.closest(ATTACHMENT_EXCLUDED))continue;
    const label=(button.getAttribute('aria-label')||'')+' '+(button.getAttribute('title')||'');
    if(!/(?:^|\b)(?:remove|delete)\b|移除|删除/i.test(label))continue;
    seeds.push(button);
  }
  // Some builds mark the remove control as hover-only and give cards no testid,
  // so only the hovered attachment is discoverable through those two passes.
  // Fall back to the deepest element that still carries a filename, which keeps
  // every card of a row visible to the scanner.
  for(const node of root.querySelectorAll('span,div,a,p,strong,li')){
    if(!rendered(node)||node.closest(ATTACHMENT_EXCLUDED))continue;
    if(node.isContentEditable||node.closest('[contenteditable="true"]'))continue;
    const text=nameNorm(cardText(node));
    if(!nameCarrier(text,node))continue;
    seeds.push(node);
  }
  return seeds;
}
function nameCarrier(text,node){
  if(text.length<4||text.length>160||!KNOWN_EXTENSION.test(text))return false;
  for(const child of node.children){
    const value=nameNorm(cardText(child));
    if(value.length>=4&&value.length<text.length&&KNOWN_EXTENSION.test(value))return false;
  }
  return true;
}
function cardText(card){
  const clone=card.cloneNode(true);
  clone.querySelectorAll('button,[role="button"],svg,img[aria-hidden="true"]').forEach(node=>node.remove());
  return clone.textContent;
}
function nameSources(card){
  const values=[],push=(value,source)=>{
    const text=nameNorm(value);
    if(text.length<2||text.length>500)return;
    if(values.some(item=>item.text===text&&item.source===source))return;
    values.push({source,text});
  };
  push(cardText(card),'text');
  const nodes=[card,...[...card.querySelectorAll('[aria-label],[title],[alt],[data-filename],[download]')].slice(0,30)];
  for(const node of nodes)for(const attribute of ['aria-label','title','alt','data-filename','download']){
    const value=node.getAttribute?.(attribute);if(value)push(value,attribute);
  }
  return values.slice(0,12);
}
function judgeName(value,spec){
  const text=nameNorm(value);if(text.length<4)return null;
  const parts=fileParts(text),prefix=text.replace(/(?:…|\.{3})+$/u,'').trim();
  const stripped=text.replace(/(?:…|\.{3})/g,'').trim(),cut=fileParts(stripped);
  if(text===spec.full||text.includes(spec.full))return{state:'match',strength:'strong',reason:'full-name'};
  const looseText=looseName(text),looseFull=looseName(spec.full);
  if(looseText&&looseText===looseFull)return{state:'match',strength:'strong',reason:'sanitised-full-name'};
  if(parts.ext&&parts.ext!==spec.ext&&parts.stem.length>=6&&(spec.stem.startsWith(parts.stem)||parts.stem.startsWith(spec.stem)))return{state:'mismatch',strength:'strong',reason:'extension-conflict'};
  if(parts.ext&&parts.ext===spec.ext&&parts.stem===spec.stem)return{state:'match',strength:'strong',reason:'name-and-extension'};
  const counter=parts.ext===spec.ext?/^(.+?)\s*\((\d{1,3})\)$/.exec(parts.stem):null;
  if(counter&&counter[1].trim()===spec.stem)return{state:'match',strength:'weak',reason:'display-counter',alias:text};
  if(stripped!==text&&cut.ext&&cut.ext===spec.ext&&cut.stem.length>=6&&spec.stem.startsWith(cut.stem))return{state:'match',strength:'weak',reason:'truncated-name-and-extension'};
  if(stripped!==text&&cut.ext&&cut.ext!==spec.ext&&cut.stem.length>=6&&(spec.stem.startsWith(cut.stem)||cut.stem.startsWith(spec.stem)))return{state:'mismatch',strength:'strong',reason:'extension-conflict'};
  if(text===spec.stem)return{state:'match',strength:'weak',reason:'stem-only'};
  if(prefix!==text&&prefix.length>=6&&spec.full.startsWith(prefix))return{state:'match',strength:'weak',reason:'truncated-prefix'};
  if(text.length>=6&&spec.full.startsWith(text))return{state:'match',strength:'weak',reason:'name-prefix'};
  if(looseText.length>=8&&spec.stem.length>=6&&looseFull.startsWith(looseText))return{state:'match',strength:'weak',reason:'sanitised-prefix'};
  if(parts.ext)return{state:'mismatch',strength:'weak',reason:'other-file-name'};
  if(spec.stem.length>=6&&text.length>=6&&spec.stem.startsWith(text))return{state:'match',strength:'weak',reason:'stem-prefix'};
  return null;
}
const KNOWN_EXTENSION=/\.(?:pdf|txt|md|markdown|docx?|csv|xlsx?|pptx?|json|zip|png|jpe?g|webp|gif|svg|html?|js|ts|py)\b/i;
function fileTokens(text){
  const found=[],re=/[^\s<>"'`，。；、,:;()（）\[\]]+\.[a-z0-9]{1,8}/gi;let match;
  while((match=re.exec(text||''))){
    const token=nameNorm(match[0]).replace(/[.,;:]+$/,'');
    if(KNOWN_EXTENSION.test(token)&&found.length<6)found.push(token);
  }
  return found;
}
function tokenIsOurs(token,spec){
  const text=nameNorm(token);
  if(text===spec.full||text.endsWith(spec.full))return true;
  if(looseName(text)===looseName(spec.full))return true;
  const stripped=text.replace(/(?:…|\.{3})/g,'').trim(),cut=fileParts(stripped);
  if(cut.ext!==spec.ext)return false;
  if(cut.stem===spec.stem)return true;
  const counter=/^(.+?)\s*\((\d{1,3})\)$/.exec(cut.stem);
  if(counter&&counter[1].trim()===spec.stem)return true;
  return text!==stripped&&cut.stem.length>=6&&spec.stem.startsWith(cut.stem);
}
function foreignFiles(card,spec){
  const seen=new Set(),others=[];
  for(const item of nameSources(card)){
    for(const token of fileTokens(item.text)){
      if(seen.has(token))continue;
      seen.add(token);
      if(tokenIsOurs(token,spec))continue;
      if(!others.includes(token))others.push(token);
    }
  }
  return others;
}
function judgeCard(card,spec){
  const sources=nameSources(card).map(item=>{
    const verdict=judgeName(item.text,spec),parts=fileParts(item.text);
    return{source:item.source,text:item.text.slice(0,120),length:item.text.length,extension:parts.ext,verdict:verdict?.state||'none',reason:verdict?.reason||'',strength:verdict?.strength||'',alias:verdict?.alias||''};
  });
  const strong=sources.find(item=>item.verdict==='match'&&item.strength==='strong');
  const strongConflict=sources.find(item=>item.verdict==='mismatch'&&item.strength==='strong');
  const weak=sources.find(item=>item.verdict==='match'&&item.strength==='weak');
  const conflict=sources.find(item=>item.verdict==='mismatch');
  const primary=strong||strongConflict||weak||conflict;
  const others=foreignFiles(card,spec);
  if(others.length)return{node:card,state:'mismatch',strength:'strong',reason:'other-file-in-card',sources,foreign:others.slice(0,3),alias:''};
  return{node:card,state:primary?.verdict||'unknown',strength:primary?.strength||'none',reason:primary?.reason||'name-not-readable',sources,alias:primary?.alias||''};
}
function cardForSeed(seed,root,control){
  const readable=node=>{
    const text=nameNorm(cardText(node));
    return text.length>=6&&(!!fileParts(text).ext||text.length>=10);
  };
  if(!control&&readable(seed))return seed;
  let node=seed.parentElement;
  for(let i=0;i<3&&node&&node!==root;i++,node=node.parentElement)if(readable(node))return node;
  return control?seed.parentElement||seed:seed;
}
function markersOutside(roots){
  if(typeof document==='undefined'||!document.querySelectorAll)return null;
  const found=[];
  for(const node of document.querySelectorAll('[data-testid*="attachment" i],[data-testid*="file" i]')){
    if(roots.some(entry=>entry.root.contains(node)))continue;
    if(node.closest(ATTACHMENT_EXCLUDED)||!rendered(node))continue;
    found.push({path:nodePath(node),testid:node.getAttribute?.('data-testid')||''});
    if(found.length>=3)break;
  }
  return found.length?{count:found.length,samples:found}:null;
}
function scanAttachment(c,ref){
  const spec=nameSpec(ref),roots=attachmentRoots(c);
  const report={state:'none',strength:'none',reason:'no-root',root:null,kind:'none',cards:[],roots:[],nodes:[]};
  if(!spec||!roots.length)return report;
  const all=[];
  for(const entry of roots){
    const seeds=attachmentSeeds(entry.root),cards=[];
    for(const seed of seeds){
      const label=(seed.getAttribute('aria-label')||'')+' '+(seed.getAttribute('title')||'');
      const control=seed.tagName==='BUTTON'||seed.getAttribute('role')==='button'||/(?:remove|delete|移除|删除)/i.test(label);
      const card=cardForSeed(seed,entry.root,control);
      if(!card||cards.some(item=>item.node===card||card.contains(item.node)))continue;
      const replaced=cards.find(item=>item.node.contains(card));
      if(replaced)cards.splice(cards.indexOf(replaced),1);
      cards.push({...judgeCard(card,spec),kind:entry.kind});
    }
    report.roots.push({kind:entry.kind,tag:entry.root.tagName,testid:entry.root.getAttribute?.('data-testid')||'',role:entry.root.getAttribute?.('role')||'',path:nodePath(entry.root),seeds:seeds.length,cards:cards.length,filtered:filteredSeeds(entry.root)});
    for(const card of cards)if(!all.some(item=>item.node===card.node))all.push(card);
  }
  report.cards=all.slice(0,6).map(card=>({kind:card.kind,tag:card.node.tagName,testid:card.node.getAttribute?.('data-testid')||'',role:card.node.getAttribute?.('role')||'',state:card.state,strength:card.strength,reason:card.reason,alias:card.alias||'',sources:card.sources.slice(0,6)}));
  if(!all.length)report.outside=markersOutside(roots);
  report.nodes=all.map(card=>card.node);
  const strongMatch=all.find(card=>card.state==='match'&&card.strength==='strong');
  const conflict=all.find(card=>card.state==='mismatch');
  const weakMatch=all.find(card=>card.state==='match');
  const winner=all.length>1?{state:'mismatch',strength:'strong',reason:'ambiguous-cards',kind:all[0].kind}:(strongMatch||conflict||weakMatch||all[0]);
  if(winner){
    report.state=winner.state;report.strength=winner.strength;report.reason=winner.reason;report.alias=winner.alias||'';
    report.root=roots.find(entry=>entry.kind===winner.kind)?.root||roots[0].root;
    report.kind=winner.kind;
  }else if(!all.length){
    report.reason='no-structural-candidate';
  }
  return report;
}
// A set scan maps each visible card to exactly one expected file; the legacy
// single-file scanner deliberately rejects multiple cards and is unchanged.
function scanAttachmentSet(c,refs){
  const roots=attachmentRoots(c),all=[];
  for(const entry of roots){
    const cards=[];
    for(const seed of attachmentSeeds(entry.root)){
      const label=(seed.getAttribute('aria-label')||'')+' '+(seed.getAttribute('title')||'');
      const control=seed.tagName==='BUTTON'||seed.getAttribute('role')==='button'||/(?:remove|delete|移除|删除)/i.test(label);
      const node=cardForSeed(seed,entry.root,control);
      if(!node||cards.some(other=>other===node||node.contains(other)))continue;
      const replaced=cards.find(other=>other.contains(node));if(replaced)cards.splice(cards.indexOf(replaced),1);
      cards.push(node);
    }
    // Wrapper-level scans may rediscover the same preview under a larger ancestor.
    // Keep the smallest actual card instead of counting its parent as an extra file.
    for(const node of cards){
      if(all.some(item=>item===node||node.contains(item)))continue;
      for(let i=all.length-1;i>=0;i--)if(all[i].contains(node))all.splice(i,1);
      all.push(node);
    }
  }
  const judgements=all.map(node=>refs.map(ref=>judgeCard(node,nameSpec(ref))));
  const assigned=new Set(),files=refs.map((ref,refIndex)=>{
    const hits=all.map((node,index)=>({node,index,judgement:judgements[index][refIndex]})).filter(entry=>entry.judgement.state==='match');
    // A row wrapper and the name element below it must count as one card, not two.
    const innermost=hits.filter(hit=>!hits.some(other=>other!==hit&&hit.node.contains(other.node)));
    const strong=innermost.filter(hit=>hit.judgement.strength==='strong');
    const chosen=strong.length===1?strong[0]:innermost.length===1?innermost[0]:null;
    if(chosen)assigned.add(chosen.index);
    return {id:ref.id,name:ref.name,size:ref.size,state:!innermost.length?'missing':chosen?'match':'ambiguous',strength:chosen?.judgement.strength||'none',alias:chosen?.judgement.alias||'',index:chosen?.index??-1,hits:innermost.length};
  });
  const occupied=new Set(),collisions=[];
  for(const item of files)if(item.index>=0){if(occupied.has(item.index))collisions.push(item.name);occupied.add(item.index);}
  // Only cards that match no expected file are extras; a duplicate wrapper for one
  // of our own files must not abort the batch.
  const extras=all.map((node,index)=>index).filter(index=>!assigned.has(index)&&!judgements[index].some(item=>item.state==='match'));
  const state=collisions.length||files.some(item=>item.state==='ambiguous')||extras.length?'conflict':files.some(item=>item.state!=='match')?'missing':'match';
  const extraTexts=extras.slice(0,3).map(index=>clean(cardText(all[index])).slice(0,80));
  return {state,files,cardCount:all.length,extras:extras.length,extraTexts,collisions,roots:roots.map(item=>({kind:item.kind,tag:item.root.tagName})),nodes:all};
}
function attachmentCardCount(root){
  if(!root||!root.querySelectorAll)return null;
  const seeds=attachmentSeeds(root);
  return seeds.length||null;
}
// Diagnostic only: shows which elements carry a filename when the scanner cannot
// map them to the expected attachment set.
function attachmentNameSample(c=composer(),limit=4){
  const samples=[];
  for(const entry of attachmentRoots(c)){
    for(const node of entry.root.querySelectorAll('span,div,a,p,strong,li')){
      if(samples.length>=limit)return samples;
      if(!rendered(node)||node.closest(ATTACHMENT_EXCLUDED))continue;
      if(node.isContentEditable||node.closest('[contenteditable="true"]'))continue;
      const text=nameNorm(cardText(node));
      if(!nameCarrier(text,node))continue;
      samples.push({path:nodePath(node),text:text.slice(0,80),html:node.outerHTML.slice(0,300)});
    }
  }
  return samples;
}
function describe(root) {
  return root ? [root.innerText || '', ...[...root.querySelectorAll('span,div')].filter(node=>!node.children.length).map(node=>node.textContent||''), ...Array.from(root.querySelectorAll('[aria-label],[title],[alt]')).map(n => (n.getAttribute('aria-label') || '')+' '+(n.getAttribute('title') || '')+' '+(n.getAttribute('alt') || ''))].join('\n') : '';
}
function snapshot() {
  const scan=R.read(),all=scan.messages,user=all.filter(message=>message.role==='user').at(-1),assistant=all.filter(message=>message.role==='assistant').at(-1);
  const assistantText=assistant?.text||'';
  const alerts=[...document.querySelectorAll('main [role="alert"]')].filter(rendered).map(node=>clean(node.innerText)).join('\n');
  const errorText=assistantText+'\n'+alerts;
  const error=/(?:something went wrong|error generating|network error|conversation.*limit|unable to load conversation|出现(?:了)?错误|生成.*出错|已达到.*(?:上限|限制)|达到.*对话.*上限|请求过于频繁|消息.*限额|you.ve reached.*limit)/i.test(errorText)?clean(errorText).slice(-650):'';
  const c=composer(),signals=generationSignals();
  return {url:location.href,engineVersion:10,provider:PromptFlowModel.platforms.providerFor(location.href),hasComposer:!!c,draft:c?ctext(c):'',generating:signals.length>0,generationSignals:signals,generationStrategy:'visible-stop-buttons',lastRole:all.at(-1)?.role||'',
    lastUser:user?{key:user.key,text:user.text,variants:user.variants,fingerprint:user.fingerprint,folded:user.folded,filesText:describe(user.root)+'\n'+(user.files||[]).join('\n'),imageCount:[...user.root.querySelectorAll('img')].filter(image=>rendered(image)&&rect(image).width>=60&&rect(image).height>=60).length}:null,
    assistant:assistant?{key:assistant.key,text:assistantText,signature:assistant.key+'|'+assistant.fingerprint}:null,upload:globalThis.PromptChainSiteAdapter?.uploadDiagnostic?.()||globalThis.PromptChainFileUI?.uploadDiagnostic?.()||null,
    messages:all.slice(-200).map(({key,role,fingerprint})=>({key,role,fingerprint})),reader:{version:R.version,strategy:scan.strategy,probe:scan.probe,count:all.length,users:all.filter(message=>message.role==='user').length,assistants:all.filter(message=>message.role==='assistant').length},error};
}

globalThis.PromptFlowSupervisor=Object.assign(globalThis.PromptFlowSupervisor||{},{msgs,messageRole,key,text,composer,ctext,fill,sendBtn,generating,assistantReplySettled,snapshot,scope,describe,rendered,sleep,readerVersion:7,engineVersion:10,attachmentRoots,attachmentSeeds,scanAttachment,scanAttachmentSet,attachmentCardCount,attachmentNameSample});
})();
