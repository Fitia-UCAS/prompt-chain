(() => {
  let attempt=null;
  const images=root=>[...root.querySelectorAll('img')].filter(image=>PromptFlowSupervisor.rendered(image)&&image.width>=40&&image.height>=40).length;
  const describe=(scan)=>'identity='+scan.state+'/'+(scan.strength||'none')+', reason='+(scan.reason||'unknown')+', cards='+(scan.cards?.length??scan.cardCount??0);
  globalThis.PromptChainNativeFiles={
    async attach(files){
      const E=PromptFlowSupervisor,U=PromptChainFileUI,c=E.composer(),form=E.scope(c);
      if(!files.length)return{ok:true};
      const inputs=files.map(file=>U.uploadInput(c,{name:file.name,mimeType:file.type||'application/octet-stream'}));
      if(!form||inputs.some(input=>!input))return{ok:false,error:'UPLOAD_INPUT_NOT_UNIQUE: 无法定位全部附件输入框'};
      attempt?.cleanup?.();
      const assigned=files.map(()=>false),changed=files.map(()=>false);
      attempt={c,form,files,url:location.href,images:images(form),assigned:false,changed:false,selected:assigned,rejected:changed};
      const current=attempt,cleanup=[];
      const unified=inputs.every(input=>input===inputs[0]),batch=unified&&!!inputs[0].multiple;
      const groups=batch?[files.map((_,i)=>i)]:files.map((_,i)=>[i]);
      for(const indices of groups){
        const input=inputs[indices[0]],chosen=indices.map(i=>files[i]);
        const onChange=()=>{
          const selected=[...input.files],valid=selected.length===chosen.length&&selected.every((file,i)=>file.name===chosen[i].name&&file.size===chosen[i].size);
          for(const i of indices){assigned[i]=valid;changed[i]=!valid;}
        };
        input.addEventListener('change',onChange,true);cleanup.push(()=>input.removeEventListener('change',onChange,true));
        const transfer=new DataTransfer();chosen.forEach(file=>transfer.items.add(file));input.files=transfer.files;
        input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
        input.removeEventListener('change',onChange,true);
        if(!batch&&files.length>1){
          // Wait until this particular file has a stable preview before replacing
          // the input selection with the next file.
          const ref=chosen[0],expected=files.slice(0,indices[0]+1).map((file,i)=>({id:String(i),name:file.name,size:file.size,mimeType:file.type}));
          const start=Date.now();let confirmed=false;
          while(Date.now()-start<120000){
            await E.sleep(250);
            if(attempt!==current||location.href!==current.url||E.composer()!==c||!form.isConnected)
              return{ok:false,error:'UPLOAD_COMPOSER_CHANGED: 附件输入框已变化'};
            const scan=E.scanAttachmentSet(c,expected),error=U.uploadError(form);
            if(error)return{ok:false,error:'UPLOAD_REJECTED: '+ref.name+': '+error};
            if(scan.state==='conflict')return{ok:false,error:'UPLOAD_ATTACHMENT_MISMATCH: '+ref.name};
            if(scan.state==='match'&&!U.uploadBusy(form)){confirmed=true;break;}
          }
          if(!confirmed)return{ok:false,error:'UPLOAD_TIMEOUT: '+ref.name};
        }
      }
      attempt.cleanup=()=>cleanup.forEach(fn=>fn());
      current.assigned=assigned.every(Boolean);current.changed=changed.some(Boolean);
      if(!current.assigned)return{ok:false,error:'UPLOAD_SELECTION_REJECTED: 某些附件未被接收'};
      return{ok:true};
    },
    async wait(options){
      const E=PromptFlowSupervisor,U=PromptChainFileUI,a=attempt;if(!a||options.files?.some((file,i)=>file!==a.files[i]))return false;
      let quiet=0,busySamples=0,observedSince=0;const start=Date.now();
      try{while(Date.now()-start<(options.timeoutMs||120000)){
        await E.sleep(options.pollMs||250);
        if(attempt!==a||location.href!==a.url||E.composer()!==a.c||!a.form.isConnected)return false;
        const multi=a.files.length>1,scan=multi?E.scanAttachmentSet(a.c,a.files.map((file,i)=>({id:String(i),name:file.name,size:file.size,mimeType:file.type}))):E.scanAttachment(a.c,a.files[0]),root=scan.root||a.form;
        const error=U.uploadError(root);if(error){attempt=null;throw new Error(error);}
        const selection=a.assigned===true?'confirmed':a.changed===true?'rejected':'unknown';
        const matched=multi?scan.state==='match'&&a.assigned:scan.state==='match'&&(scan.strength==='strong'||selection==='confirmed');
        if(multi&&scan.state==='conflict')throw new Error('UPLOAD_ATTACHMENT_MISMATCH: 附件集合包含未识别或冲突卡片');
        const image=!multi&&a.files[0].type.startsWith('image/')&&images(root)===a.images+1;
        const busy=U.uploadBusy(a.form)||(scan.kind!=='form'&&U.uploadBusy(root)),now=Date.now();
        if(busy){busySamples++;observedSince=0;}
        else if(!observedSince)observedSince=now;
        if((image||matched)&&!busy&&E.sendBtn(a.c)){quiet||=now;if(now-quiet>=850){attempt=null;return true;}}else quiet=0;
        if(!(matched||image)&&!busy&&now-observedSince>8000){
          const detail='observed '+String(now-observedSince)+'ms '+(busySamples?'after processing signal cleared':'from upload start (no busy signal observed)')+', '+describe(scan);
          if(scan.state==='mismatch'||scan.state==='conflict')throw new Error('UPLOAD_ATTACHMENT_MISMATCH: The composer shows a different attachment; nothing was sent ('+detail+')');
          if(scan.cards?.length||scan.cardCount)throw new Error('UPLOAD_ATTACHMENT_UNIDENTIFIED: An attachment card is present but its identity could not be confirmed; nothing was sent ('+detail+')');
          throw new Error('UPLOAD_PREVIEW_NOT_RECOGNIZED: No attachment card was observed in the composer search scope ('+detail+')');
        }
      }
      attempt=null;return false;}finally{a.cleanup?.();}
    }
  };
})();
