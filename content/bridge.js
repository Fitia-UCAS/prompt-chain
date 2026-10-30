(() => {
  'use strict';
  if (globalThis.__PROMPT_FLOW_BRIDGE__) return;
  globalThis.__PROMPT_FLOW_BRIDGE__ = true;
  const E = PromptFlowSupervisor, M = PromptFlowModel, documentId = crypto.randomUUID();
  let lastUploadState=null,chatUploadAttempt=null;
  let active = null, disposed = false, timer = null, interval = null, observer = null;
  const snapshot = () => ({...E.snapshot(), bridgeVersion:2, documentId, operation: active ? {id: active.id, attempted: active.attempted} : null});
  // A card per file can arrive with long gaps and no busy marker in between, so
  // "nothing changed for this long" is the only reliable stall signal. The site
  // may also keep a card spinning for a long time; a spinner means the file was
  // already accepted, so it never counts towards the stall window.
  const UPLOAD_STALL_MS=60000;
  const UPLOAD_BUDGET_MS=180000;
  const invalidated = error => /extension context invalidated/i.test(error?.message || String(error));
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer); clearInterval(interval); observer?.disconnect();
    if (active) {
      active.cancelled = true;
      if (active.onInput) document.removeEventListener('input', active.onInput, true);
      active = null;
    }
    try {chrome.runtime.onMessage.removeListener?.(receive);} catch {}
  }
  async function rpc(message) {
    if (disposed) throw new Error('EXTENSION_RELOADED: Refresh the current page to reconnect');
    try {return await chrome.runtime.sendMessage(message);}
    catch (error) {if (invalidated(error)) dispose(); throw error;}
  }
  function guard(op, allowNewChat = false) {
    if (disposed) throw new Error('EXTENSION_RELOADED: Refresh the current page to reconnect');
    if (active !== op || op.cancelled) throw new Error('OPERATION_CANCELLED: Flow is no longer running');
    if (!M.sameChat(op.url, location.href, allowNewChat && op.attempted)) throw new Error('CONVERSATION_CHANGED: Target tab changed conversation');
    if (op.edited) throw new Error('DRAFT_CHANGED: Manual input interrupted the operation');
  }
  function uploadInput(c,ref) {
    const form=E.scope(c),image=ref.mimeType.startsWith('image/'),extension='.'+ref.name.split('.').at(-1).toLowerCase();
    const accepts=input=>{const types=input.accept.toLowerCase().split(',').map(value=>value.trim()).filter(Boolean);return!types.length||types.some(type=>type==='*/*'||type===extension||type===ref.mimeType.toLowerCase()||(type.endsWith('/*')&&ref.mimeType.toLowerCase().startsWith(type.slice(0,-1))));};
    for(const scope of [form,document]){
      const candidates=[...(scope?.querySelectorAll('input[type="file"]')||[])].filter(input=>!input.disabled&&!input.hasAttribute('capture')&&accepts(input));
      const score=input=>(image&&input.id==='octane-mobile-composer-photos-input'?4:!image&&input.id==='octane-mobile-composer-files-input'?4:input.accept?2:1);
      candidates.sort((a,b)=>score(b)-score(a));if(candidates.length===1||candidates.length>1&&score(candidates[0])>score(candidates[1]))return candidates[0];
      if(candidates.length>1)return null;
    }
    return null;
  }
  function attachmentsPresent(form) {
    if(!form)return false;
    if([...form.querySelectorAll('[data-testid="attachment-preview"],[data-testid="remove-attachment"]')].some(E.rendered))return true;
    return [...form.querySelectorAll('button[aria-label]')].some(button=>{
      if(!E.rendered(button))return false;const label=button.getAttribute('aria-label')||'';
      return /^(?:Remove(?:\s+(?:file|attachment|image)\b|$)|(?:移除|删除)(?:附件|文件|图片))/i.test(label)||(/(?:Remove|移除|删除)/i.test(label)&&/\.(?:pdf|txt|md|markdown|docx?|csv|xlsx?|png|jpe?g|webp|gif)\b/i.test(label));
    });
  }
  function uploadBusy(form) {
    if(!form)return false;
    // Global signals first, then attachment-scoped ones: a pulsing skeleton inside
    // a file card means that file is still being processed, while an unrelated
    // pulse elsewhere in the composer must not block sending forever.
    const selectors=['[aria-busy="true"]','[role="progressbar"]','[aria-label*="Uploading" i]','[aria-label*="上传中"]','[class*="animate-spin"]','[data-testid*="attachment" i] [class*="animate-pulse"]','[data-testid*="attachment" i] [data-testid*="progress" i]'].join(',');
    return [...form.querySelectorAll(selectors)].some(E.rendered);
  }
  function uploadError(form) {
    const auth=[...document.querySelectorAll('[role="dialog"]')].find(dialog=>E.rendered(dialog)&&/登录|注册|log in|sign in/i.test(dialog.innerText));
    if(auth)return'网页要求登录，附件上传已暂停';
    return [...form.querySelectorAll('[role="alert"]')].filter(E.rendered).map(n => n.innerText).find(t => /error|failed|失败|无法|限制|不支持/i.test(t));
  }
  globalThis.PromptChainFileUI={uploadInput,attachmentsPresent,uploadBusy,uploadError,uploadDiagnostic:()=>lastUploadState};
  function legacyNameNodes(root,ref){
    const name=M.echoNorm(ref.name);
    return [...(root?.querySelectorAll('span,div,a')||[])].filter(node=>{
      if(node.children.length||!E.rendered(node))return false;
      const text=M.echoNorm(node.textContent),prefix=text.replace(/(?:…|\.{3})$/u,'').trim();
      return prefix!==text&&prefix.length>=12&&name.startsWith(prefix);
    });
  }
  const selectionOf=attempt=>attempt?(attempt.assigned===true?'confirmed':attempt.changed===true?'rejected':'unknown'):'unknown';
  // Diagnostic only: the markup of the elements that carry a filename, so a
  // failed set scan can be explained without DevTools.
  const attachmentSamples=()=>{try{return E.attachmentNameSample?E.attachmentNameSample():null;}catch{return null;}};  const aliasList=op=>(op.attachmentAliases||[]).map(name=>M.echoNorm(name)).filter(Boolean);
  function evidenceOf(scan,selection,aliases){
    if(!scan)return{identity:'none',weak:false,selection};
    if(scan.state!=='match')return{identity:scan.state,weak:false,selection};
    if(scan.strength==='strong')return{identity:'match',weak:false,selection};
    const recorded=!!scan.alias&&(aliases||[]).includes(M.echoNorm(scan.alias));
    if(recorded)return{identity:'match',weak:true,selection,alias:scan.alias,recorded:true};
    return{identity:selection==='confirmed'?'match':'unknown',weak:true,selection,alias:scan.alias||''};
  }
  function describeScan(scan){
    if(!scan)return'no scan';
    const card=scan.cards&&scan.cards[0];
    return 'identity='+scan.state+'/'+(scan.strength||'none')+', reason='+(scan.reason||'unknown')+', roots='+(scan.roots||[]).map(entry=>entry.kind+':'+entry.seeds+'seeds/'+entry.cards+'cards/'+((entry.filtered&&entry.filtered.hidden)||0)+'hidden/'+((entry.filtered&&entry.filtered.excluded)||0)+'excluded'+(entry.filtered&&entry.filtered.blockedBy?'('+entry.filtered.blockedBy+')':'')).join('|')+(card?', first='+card.tag+(card.testid?'['+card.testid+']':'')+', sources='+card.sources.map(item=>item.source+':'+item.verdict+'/'+item.reason).join('|'):'');
  }
  function operationOf(op){
    return{id:op.id,runId:op.runId,step:op.step??null};
  }
  function buildDiagnostic(op,{stage,scan,busy,timeline,attempt,quiet,sendReady,waitingFor,decision,previous,observedNames}){
    const now=Date.now(),selection=selectionOf(attempt),evidence=scan?evidenceOf(scan,selection,aliasList(op)):null;
    const legacy=scan?.root?legacyNameNodes(scan.root,op.attachment||{name:''}).length:0;
    const state={
      v:3,stage,operation:operationOf(op),sampledAt:now,elapsedMs:now-(timeline?.startedAt||now),
      expected:{name:op.attachment?.name||'',size:op.attachment?.size||0,mimeType:op.attachment?.mimeType||''},
      attachmentAliases:aliasList(op),observedNames:observedNames||[],
      selection:{state:selection,recovered:!!attempt?.recovered,assigned:attempt?.assigned??null,rejected:attempt?.changed??null},
      identity:evidence?{state:evidence.identity,strength:scan.strength,reason:scan.reason,weakMatch:evidence.weak,evidence:evidence.selection,alias:scan.alias||'',recordedAlias:!!evidence.recorded}:{state:'none',reason:'no-scan'},
      roots:scan?.roots||[],cards:scan?.cards||[],outside:scan?.outside||null,
      nameMatched:evidence?.identity==='match',previewMatched:evidence?.identity==='match',
      matchMode:evidence?.identity==='match'?(scan.strength==='strong'?'strong-match':(scan.alias?'display-alias':'matched-prefix')):'unmatched',
      cardCount:scan?scan.cards.length:null,
      previewCount:legacy,previewCountMeaning:'truncated-filename-leaf nodes (legacy rule)',
      scopeTag:scan?.root?.tagName||null,scopeTestId:scan?.root?.getAttribute?.('data-testid')||'',scopeKind:scan?.kind||'none',
      busy:!!busy,busySamples:timeline?.busySamples||0,quietMs:quiet?now-quiet:0,sendReady:sendReady??null,reused:!!op.reuseAttachment,
      busyClearedMs:timeline?.busyClearedAt?now-timeline.busyClearedAt:0,
      observationMs:timeline?.observedSince?now-timeline.observedSince:0,
      observationTimeoutMs:UPLOAD_STALL_MS,
      timeline:timeline?{...timeline}:null,
      previousOperation:previous||op.previousUpload||null,
      waitingFor:waitingFor||stage
    };
    if(decision)state.decision=decision;
    return state;
  }
  async function restoreFile(ref, op) {
    const bytes = new Uint8Array(ref.size); let offset = 0;
    while (offset < ref.size) {
      guard(op);
      const r = await rpc({type: 'PF_FILE_CHUNK', runId: op.runId, operationId: op.id, fileId: ref.id, offset});
      if (!r?.ok) throw new Error(r?.error || 'FILE_UNAVAILABLE: Attachment data could not be read');
      const part = atob(r.chunk);
      if (!part.length || offset + part.length > bytes.length) throw new Error('FILE_INCOMPLETE: Attachment bytes are incomplete');
      for (let i = 0; i < part.length; i++) bytes[offset + i] = part.charCodeAt(i);
      offset += part.length;
    }
    return new File([bytes], ref.name, {type: ref.mimeType});
  }
  const selectedFile=(input,ref)=>input?.files?.length===1&&input.files[0].name===ref.name&&input.files[0].size===ref.size;
  async function upload(ref, op) {
    const adapter=globalThis.PromptChainSiteAdapter;
    if(adapter&&adapter.id!=='chatgpt'){
      const file=await restoreFile(ref,op);guard(op);
      const result=await adapter.attachFiles([file]);guard(op);
      if(!result?.ok)throw new Error(result?.error||'UPLOAD_REJECTED: Attachment upload failed');
      const uploaded=await adapter.waitForUploadsComplete({files:[file],timeoutMs:120000,pollMs:250,guard:()=>guard(op)});guard(op);
      if(!uploaded)throw new Error('UPLOAD_TIMEOUT: Attachment upload could not be confirmed: '+ref.name);
      return;
    }
    const c = E.composer(), form = E.scope(c), input = uploadInput(c,ref);
    if (!form || !input) throw new Error('UPLOAD_INPUT_NOT_UNIQUE: A unique attachment input was not found');
    const timeline={startedAt:Date.now(),busyFirstAt:0,busyLastAt:0,busyClearedAt:0,observedSince:0,firstCardAt:0,firstMatchAt:0,sendReadyAt:0};
    const reuse=!!op.reuseAttachment&&!!chatUploadAttempt&&chatUploadAttempt.fileId===ref.id;
    const attempt=reuse?chatUploadAttempt:{fileId:ref.id,form,assigned:false,changed:false};
    if(!attempt.names)attempt.names=[];
    const before=new Set((E.scanAttachment(c,ref).nodes)||[]);
    chatUploadAttempt=attempt;
    if(!reuse){
      const onChange=()=>{if(selectedFile(input,ref))attempt.assigned=true;else attempt.changed=true;};
      input.addEventListener('change',onChange,true);op.removeFileListener=()=>input.removeEventListener('change',onChange,true);
      const file = await restoreFile(ref, op); guard(op);
      const transfer = new DataTransfer(); transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new Event('change', {bubbles: true}));
    }
    let quiet = 0, busySamples = 0;
    while (Date.now() - timeline.startedAt < UPLOAD_BUDGET_MS) {
      await E.sleep(250); guard(op);
      const current=E.composer();
      if(!form.isConnected||!current||E.scope(current)!==form)throw new Error('UPLOAD_COMPOSER_CHANGED: Attachment composer was replaced; reconnect before resuming');
      if(E.ctext(current))throw new Error('UPLOAD_DRAFT_CHANGED: Draft text changed while uploading');
      const scan=E.scanAttachment(current,ref);
      const error = uploadError(scan.root||form); if (error) throw new Error('UPLOAD_REJECTED: '+error);
      const selection=selectionOf(attempt),evidence=evidenceOf(scan,selection,aliasList(op));
      const fresh=(scan.nodes||[]).filter(node=>!before.has(node));
      const matched=evidence.identity==='match'&&(reuse||fresh.length>0);
      const busy=uploadBusy(form)||(scan.kind!=='form'&&uploadBusy(scan.root||form)),sendReady=!!E.sendBtn(current),now=Date.now();
      const observed=(scan.cards[0]?.sources||[]).find(item=>item.source==='text')?.text||scan.alias||'';
      if(observed&&attempt.names.at(-1)?.name!==observed&&attempt.names.length<4)attempt.names.push({at:now,name:observed.slice(0,120)});
      if(scan.alias&&evidence.identity==='match'){
        attempt.displayName=scan.alias;
        op.attachmentAliases=[...new Set([...(op.attachmentAliases||[]),scan.alias])].slice(-4);
      }
      if(busy){
        busySamples++;timeline.busySamples=busySamples;timeline.busyLastAt=now;if(!timeline.busyFirstAt)timeline.busyFirstAt=now;
        timeline.busyClearedAt=0;timeline.observedSince=0;
      }else if(busySamples){
        if(!timeline.busyClearedAt){timeline.busyClearedAt=now;timeline.observedSince=now;}
      }else if(!timeline.observedSince)timeline.observedSince=now;
      // A card that appears or changes identity is progress even when the page
      // exposes no busy signal, so the stall window restarts from that sample.
      const cardState=evidence.identity+'|'+scan.strength+'|'+observed+'|'+(scan.cards.length||0);
      if(cardState!==timeline.cardState){timeline.cardState=cardState;if(!busy)timeline.observedSince=now;}
      if(scan.cards.length&&!timeline.firstCardAt)timeline.firstCardAt=now;
      if(matched&&!timeline.firstMatchAt)timeline.firstMatchAt=now;
      if(sendReady&&!timeline.sendReadyAt)timeline.sendReadyAt=now;
      const waitingFor=busy?'attachment still processing':matched?(sendReady?'upload stability check':'send button not ready'):evidence.identity==='mismatch'?'attachment identity conflict':evidence.identity==='unknown'?'attachment identity unresolved':'attachment preview name not recognized';
      lastUploadState=buildDiagnostic(op,{stage:'observing',scan,busy,timeline,attempt,quiet,sendReady,waitingFor,observedNames:attempt.names});
      if(evidence.identity==='mismatch')throw new Error('UPLOAD_ATTACHMENT_MISMATCH: The composer shows a different attachment; nothing was sent ('+describeScan(scan)+')');
      if (matched && !busy && sendReady) {
        quiet ||= now; if (now - quiet >= 850){lastUploadState.waitingFor='ready';op.displayName=attempt.displayName||'';lastUploadState.alias=attempt.displayName||'';return current;}
      } else quiet = 0;
      if(!matched&&!busy){
        if(now-timeline.observedSince>UPLOAD_STALL_MS){
          const detail='observed '+String(now-timeline.observedSince)+'ms '+(busySamples?'after processing signal cleared':'from upload start (no busy signal observed)')+', '+describeScan(scan);
          if(evidence.identity==='unknown'||scan.cards.length)throw new Error('UPLOAD_ATTACHMENT_UNIDENTIFIED: An attachment card is present but its identity could not be confirmed; nothing was sent ('+detail+')');
          throw new Error('UPLOAD_PREVIEW_NOT_RECOGNIZED: No attachment card was observed in the composer search scope ('+detail+')');
        }
      }
      if(matched&&!busy&&!sendReady&&now-timeline.startedAt>10000)throw new Error('SEND_BUTTON_UNAVAILABLE: Attachment is present, but send is unavailable');
    }
    throw new Error('UPLOAD_TIMEOUT: Attachment upload could not be confirmed');
  }
  async function uploadMany(refs,op){
    const adapter=globalThis.PromptChainSiteAdapter;
    const startedAt=Date.now(),operation=operationOf(op);
    const snapshotDiagnostic=(stage,scan,waitingFor,selection,busy=false,reason='')=>{
      const files=refs.map((ref,index)=>({id:ref.id,name:ref.name,size:ref.size,mimeType:ref.mimeType,
        selection:selection[index]||'unknown',card:scan?.files?.[index]?.state||'missing',
        strength:scan?.files?.[index]?.strength||'none',hits:scan?.files?.[index]?.hits??null,alias:scan?.files?.[index]?.alias||'',busy,reason:reason||''}));
      lastUploadState={v:4,stage,operation,sampledAt:Date.now(),elapsedMs:Date.now()-startedAt,
        fileCount:refs.length,expected:refs.map(ref=>({id:ref.id,name:ref.name,size:ref.size})),files,
        cardCount:scan?.cardCount??null,extras:scan?.extras??null,conflicts:scan?.collisions||[],
        busy,waitingFor,reason,selectionCount:selection.filter(value=>value==='confirmed').length};
      return lastUploadState;
    };
    const selection=refs.map(()=>'unknown');
    const c=E.composer(),form=E.scope(c);
    if(!form||!c)throw new Error('COMPOSER_NOT_READY: Attachment composer was not found');
    // Duplicate names cannot be independently attributed to the intended file.
    const names=new Set();for(const ref of refs){if(names.has(ref.name))throw new Error('UPLOAD_DUPLICATE_FILENAME: '+ref.name);names.add(ref.name);}
    if(adapter&&adapter.id!=='chatgpt'){
      const files=[];
      for(const ref of refs){try{files.push(await restoreFile(ref,op));}catch(error){throw new Error('FILE_UNAVAILABLE: '+ref.name+': '+error.message);}}
      guard(op);
      const batch=await adapter.attachFiles(files);guard(op);
      if(!batch?.ok){
        const fallback=/MULTIPLE|multi.?select|多选|multiple/i.test(batch?.error||'');
        if(!fallback)throw new Error(batch?.error||'UPLOAD_REJECTED: '+adapter.id);
        // Only fall back when the adapter explicitly rejected multiple selection.
        for(let i=0;i<files.length;i++){
          const one=await adapter.attachFiles([files[i]]);guard(op);
          if(!one?.ok)throw new Error('UPLOAD_REJECTED: '+refs[i].name+': '+(one.error||adapter.id));
          const ready=await adapter.waitForUploadsComplete({files:[files[i]],timeoutMs:120000,pollMs:250,guard:()=>guard(op)});guard(op);
          if(!ready)throw new Error('UPLOAD_TIMEOUT: '+refs[i].name);
          selection[i]='confirmed';
          snapshotDiagnostic('observing',null,'checking previously uploaded files',selection);
        }
        const verdict=adapter.verifyAttachments?.(files);
        if(!verdict||(typeof verdict==='object'&&!verdict.ok))throw new Error('UPLOAD_SET_INCOMPLETE: '+adapter.id+' cannot confirm the full attachment set'+(verdict?.missing?': '+verdict.missing:''));
      }else{
        selection.fill('confirmed');
        snapshotDiagnostic('observing',null,'waiting for all attachment cards',selection);
        const ready=await adapter.waitForUploadsComplete({files,timeoutMs:120000,pollMs:250,guard:()=>guard(op)});guard(op);
        if(!ready)throw new Error('UPLOAD_TIMEOUT: '+adapter.id+' did not confirm all '+refs.length+' attachments');
      }
      const verdict=adapter.verifyAttachments?.(files);
      if(verdict===false||(typeof verdict==='object'&&!verdict.ok))throw new Error('UPLOAD_SET_INCOMPLETE: '+adapter.id+' missing '+(verdict?.missing||'attachment'));
      for(const ref of refs){const alias=verdict?.aliases?.[ref.name];if(alias)op.attachmentAliasMap={...(op.attachmentAliasMap||{}),[ref.id]:[alias]};}
      snapshotDiagnostic('ready',null,'ready',selection);
      return c;
    }
    const inputList=refs.map(ref=>uploadInput(c,ref));
    if(inputList.some(input=>!input))throw new Error('UPLOAD_INPUT_NOT_UNIQUE: A unique input was not found for every attachment');
    const before=E.scanAttachmentSet(c,refs);
    snapshotDiagnostic('preflight',before,'checking existing cards',selection);
    if(op.reuseAttachments&&before.cardCount){
      if(before.state!=='match')throw new Error('UPLOAD_SET_INCOMPLETE: Cannot reuse incomplete attachment set; missing: '+before.files.filter(item=>item.state!=='match').map(item=>item.name).join('、'));
      selection.fill('confirmed');
      snapshotDiagnostic('ready',before,'ready (reused)',selection);
      for(const item of before.files)if(item.alias)op.attachmentAliasMap={...(op.attachmentAliasMap||{}),[item.id]:[item.alias]};
      return c;
    }
    if(before.cardCount)throw new Error('ATTACHMENT_CONFLICT: Composer already contains attachments; none were sent');
    const unified=inputList.every(input=>input===inputList[0]);
    const batch=unified&&!!inputList[0].multiple;
    // The input change event, not DataTransfer assignment alone, establishes file selection.
    async function assign(input,indices){
      const files=[];for(const i of indices)files.push(await restoreFile(refs[i],op));
      guard(op);
      const selected=()=>[...input.files].length===files.length&&files.every((file,index)=>input.files[index].name===file.name&&input.files[index].size===file.size);
      const onChange=()=>{for(const i of indices)selection[i]=selected()?'confirmed':'rejected';};
      input.addEventListener('change',onChange,true);
      try{
        const data=new DataTransfer();files.forEach(file=>data.items.add(file));input.files=data.files;
        input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
      }finally{input.removeEventListener('change',onChange,true);}
      if(indices.some(i=>selection[i]!=='confirmed'))throw new Error('UPLOAD_SELECTION_REJECTED: '+indices.map(i=>refs[i].name).join('、'));
    }
    if(batch)await assign(inputList[0],refs.map((_,index)=>index));
    else{
      for(let i=0;i<refs.length;i++){
        await assign(inputList[i],[i]);
        // Let the website accept the previous attachment before the next selection.
        const stop=Date.now()+UPLOAD_BUDGET_MS;
        while(Date.now()<stop){
          await E.sleep(250);guard(op);
          if(E.composer()!==c||!form.isConnected||E.ctext(c))throw new Error('UPLOAD_COMPOSER_CHANGED: Draft or composer changed');
          const scan=E.scanAttachmentSet(c,refs),error=uploadError(form);
          snapshotDiagnostic('observing',scan,'waiting for '+refs[i].name,selection,uploadBusy(form));
          if(error)throw new Error('UPLOAD_REJECTED: '+refs[i].name+': '+error);
          if(scan.state==='conflict')throw new Error('UPLOAD_ATTACHMENT_MISMATCH: Unexpected or ambiguous attachment card');
          if(scan.files[i].state==='match'&&!uploadBusy(form))break;
        }
        if(lastUploadState.files[i].card!=='match')throw new Error('UPLOAD_PREVIEW_NOT_RECOGNIZED: '+refs[i].name);
      }
    }
    const STALL_MS=UPLOAD_STALL_MS;
    let quiet=0,observed=0,progress='';
    // Files are processed one at a time and each card only appears when its own
    // upload finishes; a change in the confirmed set therefore restarts the stall
    // window instead of the whole batch failing after a fixed 8 seconds.
    while(Date.now()-startedAt<UPLOAD_BUDGET_MS){
      await E.sleep(250);guard(op);
      if(E.composer()!==c||!form.isConnected||E.ctext(c))throw new Error('UPLOAD_COMPOSER_CHANGED: Draft or composer changed');
      const scan=E.scanAttachmentSet(c,refs),error=uploadError(form);
      const busy=uploadBusy(form),sendReady=!!E.sendBtn(c);
      const confirmed=scan.files.filter(item=>item.state==='match').length;
      const waitingFor=scan.state==='match'?(busy?'processing':sendReady?'upload stability':'send button'):(busy?'attachment still processing ':'waiting for attachment cards ')+confirmed+'/'+refs.length;
      snapshotDiagnostic('observing',scan,waitingFor,selection,busy);
      if(error)throw new Error('UPLOAD_REJECTED: '+error);
      // While a file is visibly processing, an extra/unreadable card is expected
      // (its name is not rendered yet); only judge the set once processing stops.
      if(scan.state==='conflict'&&!busy)throw new Error('UPLOAD_ATTACHMENT_MISMATCH: Unexpected or duplicate attachment card; no message sent');
      const state=scan.files.map(item=>item.state).join(',');
      if(state!==progress){progress=state;observed=Date.now();}
      if(scan.state==='match'&&!busy&&sendReady&&selection.every(value=>value==='confirmed')){
        quiet||=Date.now();if(Date.now()-quiet>=850){
          snapshotDiagnostic('ready',scan,'ready',selection);
          for(const item of scan.files)if(item.alias)op.attachmentAliasMap={...(op.attachmentAliasMap||{}),[item.id]:[item.alias]};
          return c;
        }
      }else quiet=0;
      if(!busy){
        observed||=Date.now();
        if(scan.state!=='match'&&Date.now()-observed>STALL_MS){
          const detail=scan.files.filter(item=>item.state!=='match').map(item=>item.name).join('、');
          if(lastUploadState)lastUploadState.nameSamples=attachmentSamples();
          throw new Error('UPLOAD_SET_INCOMPLETE: Missing: '+detail+' ('+confirmed+'/'+refs.length+' confirmed, '+Math.round((Date.now()-observed)/1000)+'s without a new card)');
        }
      }else observed=0;
    }
    throw new Error('UPLOAD_TIMEOUT: The complete attachment set was not confirmed');
  }
  async function execute(op) {
    let initialComposer;
    const onInput = event => {if (event.isTrusted && !op.writing && (initialComposer?.contains(event.target)||E.composer()?.contains(event.target))) op.edited = true;};
    try {
      guard(op); const initial = snapshot(); initialComposer = E.composer();
      if (!initialComposer || initial.generating) throw new Error('COMPOSER_NOT_READY: Wait for the current response to finish');
      const attachRoots=E.attachmentRoots(initialComposer).map(entry=>entry.root);
      const refs=Array.isArray(op.attachments)?op.attachments:(op.attachment?[op.attachment]:[]);
      const reported=refs.length===1?E.scanAttachment(initialComposer,refs[0]):null;
      const setBefore=refs.length>1?E.scanAttachmentSet(initialComposer,refs):null;
      // For a multi-file step the set scan decides whether the composer is empty,
      // reused as-is, or blocked; hover-only remove buttons make attachmentsPresent
      // unreliable there.
      const existing=refs.length>1?!!setBefore.cardCount:(attachRoots.some(root=>attachmentsPresent(root))||!!reported?.cards?.length);
      const prior=op.reuseAttachment&&op.attachment?(chatUploadAttempt&&chatUploadAttempt.fileId===op.attachment.id?chatUploadAttempt:{fileId:op.attachment.id,form:E.scope(initialComposer),assigned:null,changed:null,recovered:true}):null;
      op.previousUpload=lastUploadState?{operation:lastUploadState.operation||null,stage:lastUploadState.stage||null,elapsedMs:lastUploadState.elapsedMs||0,sampledAt:lastUploadState.sampledAt||0}:null;
      if(op.attachment)lastUploadState=buildDiagnostic(op,{stage:'preflight',scan:reported,timeline:{startedAt:Date.now()},attempt:prior,previous:op.previousUpload,observedNames:prior?.names});
      if(initial.draft)throw new Error('DRAFT_NOT_EMPTY: Save or clear the existing draft before running');
      if(refs.length>1&&existing){
        if(!op.reuseAttachments||setBefore.state!=='match')throw new Error('ATTACHMENT_CONFLICT: An incomplete or unrecognized attachment set is already in the composer; no message sent');
      }
      if(refs.length<=1&&existing){
        const evidence=reported?evidenceOf(reported,selectionOf(prior),aliasList(op)):{identity:'none'};
        const block=(code,summary)=>{lastUploadState.stage='preflight-blocked';lastUploadState.decision={code,detail:describeScan(reported)};throw new Error(code+': '+summary+' ('+describeScan(reported)+')');};
        if(!op.attachment||!op.reuseAttachment)block('ATTACHMENT_CONFLICT','The composer already contains an attachment that is not part of this step');
        if(evidence.identity==='mismatch')block('ATTACHMENT_CONFLICT','The composer contains a different attachment');
        if(evidence.identity!=='match')block('ATTACHMENT_IDENTITY_UNKNOWN','An attachment is present but its identity could not be confirmed');
        if(reported.alias)prior.displayName=reported.alias;
        chatUploadAttempt=prior;
      }
      document.addEventListener('input', onInput, true);
      op.onInput = onInput;
      if (refs.length) {
        await rpc({type: 'PF_PHASE', runId: op.runId, operationId: op.id, phase: 'uploading'});
        const uploadedComposer=refs.length>1?await uploadMany(refs,op):await upload(refs[0],op);
        if(uploadedComposer)initialComposer=uploadedComposer;
        for(const ref of refs){
          const name=refs.length===1?op.displayName||'':(op.attachmentAliasMap?.[ref.id]||[])[0]||'';
          const uploaded=await rpc({type:'PF_ATTACHMENT_READY',runId:op.runId,operationId:op.id,fileId:ref.id,displayName:name});
          if(!uploaded?.ok)throw new Error(uploaded?.error||'UPLOAD_AUTHORIZATION_EXPIRED: '+ref.name);
        }
        op.attachmentUploaded=true;
      }
      guard(op);
      const c = E.composer(); if (!c || c !== initialComposer || E.ctext(c)) throw new Error('DRAFT_CHANGED: Composer changed before sending');
      if (op.text) {op.writing = true; try {E.fill(c, op.text);} finally {op.writing = false;}}
      const started = Date.now(); let button;
      while (Date.now() - started < 10000) {
        guard(op); button = E.sendBtn(c);
        if (button) break;
        await E.sleep(200);
      }
      if (!button) throw new Error('SEND_BUTTON_UNAVAILABLE: Content remains in the composer');
      const auth = await rpc({type: 'PF_AUTHORIZE_SEND', runId: op.runId, operationId: op.id});
      if (!auth?.ok) throw new Error('OPERATION_CANCELLED: Content remains in the composer');
      guard(op);
      if (E.composer() !== c || M.echoNorm(E.ctext(c)) !== M.echoNorm(op.text) || E.generating()) throw new Error('PAGE_CHANGED: The page changed before sending');
      op.attempted = true;
      button.click();
      const sentAt = Date.now();
      while (Date.now() - sentAt < 15000) {
        await E.sleep(200); guard(op, true);
        const result = snapshot();
        if (M.receipt(result, op) && !result.draft){
          if(op.attachment)lastUploadState.waitingFor='ready';
          return {ok: true, snapshot: result, upload: op.attachment ? lastUploadState : undefined};
        }
      }
      throw new Error('SEND_RECEIPT_UNCONFIRMED: Send was attempted, but the user message could not be matched'+(op.attachment?' (attachment: '+op.attachment.name+')':'')+'. No message was resent.');
    } catch (error) {
      return {ok: false, attempted: op.attempted, error: error.message, snapshot: snapshot(), upload: op.attachment?lastUploadState:undefined};
    } finally {op.removeFileListener?.();document.removeEventListener('input', onInput, true); if (active === op) active = null;}
  }
  function reply(respond, value) {
    if (disposed) return;
    try {respond(value);} catch (error) {if (invalidated(error)) dispose();}
  }
  function receive(message, _sender, respond) {
    if (disposed) return;
    if (message?.type === 'PF_STATUS') {reply(respond, {ok: true, snapshot: snapshot()}); return;}
    if (message?.type === 'PF_CANCEL') {if (active) active.cancelled = true; reply(respond, {ok: true}); return;}
    if (message?.type === 'PF_SEND') {
      if (active) {reply(respond, {ok: false, error: 'OPERATION_BUSY: The previous operation is still active'}); return;}
      const op = {...message.operation, cancelled: false, attempted: false, edited: false}; active = op;
      execute(op).then(result => reply(respond, result)).catch(error => reply(respond, {ok: false, attempted: op.attempted, error: error.message})); return true;
    }
  }
  chrome.runtime.onMessage.addListener(receive);
  const beat = () => {if (!disposed) rpc({type: 'PF_HEARTBEAT'}).catch(() => {});};
  observer = new MutationObserver(() => {if (!disposed && !timer) timer = setTimeout(() => {timer = null; beat();}, 800);});
  observer.observe(document.documentElement, {childList: true, subtree: true, characterData: true});
  interval = setInterval(beat, 2500);
})();
