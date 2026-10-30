(() => {
  if(globalThis.PromptChainHistory)return;
  let auth={value:'',until:0},cached=null,pending=null,blockedUntil=0;
  async function read(expectedUrl){
    const url=new URL(location.href),id=/(?:^|\/)c\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    if(!id||url.origin!==new URL(expectedUrl).origin||url.pathname!==new URL(expectedUrl).pathname)throw new Error('对话地址已变化');
    if(cached?.id===id&&Date.now()-cached.at<1000)return cached.value;
    if(pending?.id===id)return pending.promise;
    if(Date.now()<blockedUntil)throw new Error('对话原文读取暂不可用，请稍后恢复');
    const promise=(async()=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
      try{
        async function token(){
          if(auth.value&&Date.now()<auth.until)return auth.value;
          const response=await fetch('/api/auth/session',{credentials:'include',cache:'no-store',signal:controller.signal});
          if(!response.ok)throw new Error('无法读取当前登录状态（'+response.status+'）');
          const data=await response.json();auth={value:data.accessToken||'',until:Date.now()+300000};return auth.value;
        }
        async function request(){const value=await token();return fetch('/backend-api/conversation/'+encodeURIComponent(id),{credentials:'include',cache:'no-store',headers:value?{authorization:'Bearer '+value}:{},signal:controller.signal});}
        let response=await request();
        if(response.status===401){auth={value:'',until:0};response=await request();}
        if(response.status===429){blockedUntil=Date.now()+600000;throw new Error('对话原文读取被限流，请稍后恢复');}
        if(!response.ok)throw new Error('无法读取当前对话原文（'+response.status+'）');
        const raw=await response.json(),data=raw.mapping?raw:raw.data;
        if(!data?.mapping?.[data.current_node]||(data.conversation_id&&data.conversation_id!==id))throw new Error('无法确认当前对话分支');
        const chain=[],seen=new Set();let nodeId=data.current_node;
        while(nodeId&&data.mapping[nodeId]&&!seen.has(nodeId)){seen.add(nodeId);chain.push([nodeId,data.mapping[nodeId]]);nodeId=data.mapping[nodeId].parent;}
        const messages=[];
        for(const [key,node]of chain.reverse()){
          const message=node.message,role=message?.author?.role,metadata=message?.metadata||{};
          if(!['user','assistant'].includes(role)||metadata.is_visually_hidden_from_conversation||metadata.is_user_system_message)continue;
          if(role==='assistant'&&((message.channel&&message.channel!=='final')||(message.recipient&&message.recipient!=='all')))continue;
          const content=message.content||{},parts=Array.isArray(content.parts)?content.parts:[];
          const text=typeof content.text==='string'?content.text:parts.map(part=>typeof part==='string'?part:part?.text||part?.content||'').filter(part=>typeof part==='string'&&part).join('\n\n');
          const attached=Array.isArray(metadata.attachments)?metadata.attachments:Object.values(metadata.attachments||{});
          const names=[...attached,...parts.filter(part=>part&&typeof part==='object')].map(file=>file.name||file.filename||file.file_name||file.fileName||file.title||'').filter(Boolean);
          if(!text&&!(role==='user'&&names.length))continue;
          messages.push({id:String(message.id||key),role,text,filesText:names.join('\n'),complete:message.status==='finished_successfully'||message.end_turn===true});
        }
        if(url.pathname!==new URL(location.href).pathname)throw new Error('读取时对话地址已变化');
        const value={url:location.href,messages};cached={id,at:Date.now(),value};return value;
      }catch(error){blockedUntil=Math.max(blockedUntil,Date.now()+3000);throw error;}finally{clearTimeout(timer);}
    })();
    pending={id,promise};try{return await promise;}finally{if(pending?.promise===promise)pending=null;}
  }
  globalThis.PromptChainHistory={read};
})();
