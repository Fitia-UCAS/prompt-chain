def patch_prompt_editor(source):
    original='U.jsxs("button",{type:"button",className:"compact-button inline-flex items-center gap-1.5",onClick:()=>{O.current||(xe.current=H.current,q.current?.click())},disabled:ze,children:[U.jsx(Gf,{size:12}),"添加附件"]})'
    hook='U.jsx(globalThis.PromptChainPromptSources,{e:U,React:J,disabled:ze,attach:()=>{O.current||(xe.current=H.current,q.current?.click())},setBusy:he,session:()=>H.current,readDraft:()=>({title:re,content:et,attachments:ye,pendingFiles:new Map(K.current)}),apply:M=>{if(O.current)return;for(const V of M.files)K.current.set(V.ref.id,V.file);Z(M.title);Ye(M.content);Le(V=>[...V,...M.files.map(ge=>ge.ref)]);de(null)}})'
    previous=hook.replace(';de(null)','')
    replacement='globalThis.PromptChainPromptSources?'+hook+':'+original
    if replacement in source:return source
    if previous in source:source=source.replace(previous,replacement,1)
    elif source.count(original)==1:source=source.replace(original,replacement,1)
    else:raise RuntimeError('Prompt editor attachment toolbar changed')
    start=source.index('function ud(');end=source.index('function od(',start)
    part=source[start:end].replace('className:"space-y-4 p-4"','className:"space-y-4 p-4 pc-prompt-body"',1)
    return source[:start]+part+source[end:]
