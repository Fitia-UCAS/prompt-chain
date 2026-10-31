(() => {
  if(globalThis.PromptChainMessages?.version===9)return;
  const M=PromptFlowModel;
  const ATTRS=['data-message-author-role','data-message-role','data-turn-role','data-author-role','data-conversation-role','data-turn','data-author','data-role'];
  const MARKED=ATTRS.map(name=>'['+name+']').join(',');
  const USER='[data-user-message-bubble],[data-user-message-copy],[data-testid="user-message"],[class*="bg-user-message"],[class*="user-message-bubble"]';
  const ASSISTANT='[data-assistant-markdown],[data-assistant-markdown-root],[data-markdown-copy-text],[data-testid="assistant-message"],[class*="MarkdownRoot"],[class*="markdown-root"],.markdown,.prose';
  const TURNS='article,[data-testid^="conversation-turn-"],[data-turn-id],[data-turn-key],[data-message-id]';
  const ANSWER_ACTIONS='button[data-testid="copy-turn-action-button"],button[data-testid="good-response-turn-action-button"],button[data-testid="bad-response-turn-action-button"]';
  // This build renders both languages inside the label: "你说：You", "ChatGPT 说：ChatGPT".
  const LABEL=/^(你说|ChatGPT\s*说|You\s+said|ChatGPT\s+said)\s*[：:]?\s*(?:You|ChatGPT)?\s*$/i;
  // A speaker label is UI, never a message: the current ChatGPT build puts one
  // inside (or next to) every message, and reading it as a message would hide
  // the answer behind the same turn key.
  const LABEL_PREFIX=/^(你说|ChatGPT\s*说|You\s+said|ChatGPT\s+said)\s*[：:]\s*(?:You|ChatGPT)?[ \t]*\n?/i;
  const HEADINGS='h1,h2,h3,h4,h5,h6,[role="heading"],[data-conversation-role],.sr-only';
  const UI='button,[role="button"],script,style,template,svg,.sr-only,[hidden],[aria-hidden="true"]';
  const clean=value=>String(value||'').replace(/\r\n?/g,'\n').trim();
  function declared(node){
    for(const name of ATTRS){const value=node?.getAttribute?.(name)?.toLowerCase();if(['user','human'].includes(value))return'user';if(['assistant','agent','chatgpt'].includes(value))return'assistant';}
    return'';
  }
  function labelRole(node){const match=M.semanticText(node.getAttribute?.('aria-label')||node.textContent).match(LABEL);return match?(/^(你说|You)/i.test(match[1])?'user':'assistant'):'';}
  function labels(node){
    const found=[...node.querySelectorAll(HEADINGS)].filter(label=>labelRole(label)&&!label.closest(USER+','+ASSISTANT+',pre,code'));
    return found.filter(label=>!found.some(other=>other!==label&&label.contains(other)));
  }
  function speaker(node){
    // Cheap shape check first: speaker labels are headings or role markers, and
    // scanning the text of every candidate on a long page is too expensive.
    if(!node?.matches?.('h1,h2,h3,h4,h5,h6,[role="heading"],[data-conversation-role],.sr-only'))return false;
    const text=M.semanticText(node.textContent||'').replace(/\s+/g,' ').trim();
    return text.length>0&&text.length<=24&&LABEL.test(text);
  }
  function speakerLabels(node){
    const found=[...node.querySelectorAll(HEADINGS)].filter(speaker);
    return found.filter(label=>!found.some(other=>other!==label&&label.contains(other)));
  }
  function stripLabel(value){return String(value||'').replace(LABEL_PREFIX,'');}
  // A turn holds both bodies; an answer nested inside a user bubble does not count.
  function bodies(node){
    const user=node.querySelector?.(USER)||null;
    const answer=[...(node.querySelectorAll?.(ASSISTANT)||[])].find(el=>!el.closest(USER))||null;
    return {user,answer};
  }
  function role(node){
    if(!node)return'';
    if(M.platforms.providerFor(location.href)!=='chatgpt')return globalThis.PromptChainSiteMessages?.role(node)||'';
    return declared(node)||(node.matches(USER)?'user':node.matches(ASSISTANT)?'assistant':'')
      ||declared(node.querySelector(MARKED))||(node.querySelector(USER)?'user':'')
      ||labelRole(labels(node)[0]||{textContent:''})||(node.querySelector(ASSISTANT+','+ANSWER_ACTIONS)||node.hasAttribute('data-message-id')?'assistant':'');
  }
  function body(node,kind){
    const preferred=kind==='user'?USER+',.whitespace-pre-wrap':ASSISTANT+',.markdown,.prose';
    return node.matches(preferred)?node:node.querySelector(preferred)||node;
  }
  function plain(node){
    const clone=node.cloneNode(true);
    clone.querySelectorAll('header').forEach(el=>{if(labels(el).length)el.remove();});
    clone.querySelectorAll(UI).forEach(el=>el.remove());
    clone.querySelectorAll(HEADINGS).forEach(el=>{if(labelRole(el)&&!el.closest(USER+','+ASSISTANT))el.remove();});
    function walk(el){
      if(el.nodeType===3)return el.textContent||'';
      if(el.nodeType!==1)return'';
      if(el.tagName==='BR')return'\n';
      if(el.tagName==='PRE')return'\n'+el.textContent+'\n';
      if(el.tagName==='IMG')return'['+(el.getAttribute('alt')||'图片')+']';
      const value=[...el.childNodes].map(walk).join('');
      return /^(P|DIV|SECTION|ARTICLE|BLOCKQUOTE|H[1-6]|LI|UL|OL|PRE|TR|TABLE)$/.test(el.tagName)?'\n'+value+'\n':value;
    }
    return stripLabel(clean(walk(clone))).trim();
  }
  function texts(node,kind){
    if(M.platforms.providerFor(location.href)!=='chatgpt')return globalThis.PromptChainSiteMessages?.texts(node,kind)||[];
    const content=body(node,kind),values=[plain(content)];
    for(const el of [content,...content.querySelectorAll('[data-markdown-copy-text]')]){
      const value=el.getAttribute('data-markdown-copy-text');
      if(value&&!/^(true|false|0|1)$/i.test(value))values.push(value);
    }
    return [...new Set(values.map(value=>stripLabel(clean(value)).trim()).filter(Boolean))];
  }
  // The nearest ancestor that actually holds this role's body. A speaker label is
  // only a marker: the answer often sits beside it, outside the label's wrapper.
  function labelRoot(label,kind){
    const selector=kind==='user'?USER+',.whitespace-pre-wrap':ASSISTANT;
    let fallback=null;
    for(let node=label.parentElement,depth=0;node&&depth<18;node=node.parentElement,depth++){
      if(node===document.body||node.matches('body,form,main,[role="dialog"]'))break;
      // A wrapper holding both bodies or two labels is a turn, never one message.
      const pair=bodies(node);
      if((pair.user&&pair.answer)||speakerLabels(node).length>1)break;
      const found=[...node.querySelectorAll(selector)].find(el=>el!==label&&!label.contains(el));
      if(found&&texts(found,kind).length)return node;
      if(texts(node,kind).length)fallback=node;
    }
    return fallback;
  }
  function messageRoot(node,main){
    const turn=node.closest(TURNS);
    // A turn may hold the user bubble and the answer together; the nearest role
    // wrapper is the message itself, so it must win over the whole turn.
    if(turn){
      const pair=bodies(turn),userBody=pair.user,answerBody=pair.answer;
      if(userBody&&answerBody){
        // Never hand back the whole turn: it would carry both roles and make the
        // user message and the answer share one key.
        const answer=node.closest(ASSISTANT),bubble=node.closest(USER);
        if(answer&&turn.contains(answer))return answer;
        if(bubble&&turn.contains(bubble))return bubble;
        return node;
      }
      for(let parent=node;parent&&parent!==turn.parentElement;parent=parent.parentElement){
        if(declared(parent))return parent;
      }
      if(turn.querySelectorAll(USER).length<=1)return turn;
    }
    for(let parent=node;parent&&parent!==main;parent=parent.parentElement){if(declared(parent))return parent;}
    const bubble=node.closest(USER);if(!bubble)return node;
    let result=bubble;
    for(let parent=bubble.parentElement,depth=0;parent&&depth<8;parent=parent.parentElement,depth++){
      if(parent===main||parent.matches('main,body,form')||parent.querySelectorAll(USER).length!==1)break;
      if([...parent.querySelectorAll(ASSISTANT)].some(answer=>!bubble.contains(answer)&&!answer.contains(bubble)&&!answer.closest(USER)))break;
      result=parent;
    }
    return result;
  }
  function scopes(){
    const found=[document];
    for(let index=0;index<found.length&&found.length<16;index++)for(const node of found[index].querySelectorAll('*')){
      if(node.shadowRoot&&!found.includes(node.shadowRoot))found.push(node.shadowRoot);
      if(node.tagName==='IFRAME'){try{if(node.contentDocument&&!found.includes(node.contentDocument))found.push(node.contentDocument);}catch{}}
      if(found.length>=16)break;
    }
    return found;
  }
  function actionRoot(button){
    let result=null;
    for(let node=button.parentElement,depth=0;node&&depth<12;node=node.parentElement,depth++){
      if(node.matches('main,body,form')||node.querySelector(USER)||node.querySelectorAll('button[data-testid="copy-turn-action-button"]').length>1)break;
      if(texts(node,'assistant')[0])result=node;
      if(node.matches(TURNS))break;
    }
    return result;
  }
  function composedPath(node){
    const path=[node];let root=node.getRootNode();
    while(true){let host=root.host;try{host||=root.defaultView?.frameElement;}catch{}if(!host)break;path.unshift(host);root=host.getRootNode();}
    return path;
  }
  function read(){
    if(M.platforms.providerFor(location.href)!=='chatgpt')return globalThis.PromptChainSiteMessages.read();
    const roots=new Map();let bodyFallback=false,headingCount=0;
    const allScopes=scopes();
    for(const main of allScopes){
    for(const node of main.querySelectorAll(TURNS+','+MARKED+','+USER+','+ASSISTANT)){
      if(node.closest('form,[data-testid="composer"],[role="dialog"],nav,aside,[role="navigation"]'))continue;
      if(speaker(node))continue;
      const candidate=messageRoot(node,main);
      if(speaker(candidate))continue;
      const pair=bodies(candidate);
      if(pair.user&&pair.answer)continue;
      if(candidate.matches(ASSISTANT)&&(candidate.querySelector(USER)||[...candidate.querySelectorAll(MARKED)].some(marked=>declared(marked)==='user')))continue;
      const kind=role(candidate);
      if(kind==='assistant'&&candidate.matches('.markdown,.prose'))bodyFallback=true;
      if(kind)roots.set(candidate,kind);
    }
    for(const heading of speakerLabels(main)){
      const kind=labelRole(heading),root=kind?labelRoot(heading,kind):null;headingCount++;
      if(root)roots.set(root,kind);
    }
    for(const button of main.querySelectorAll(ANSWER_ACTIONS)){const candidate=actionRoot(button);if(candidate){roots.set(candidate,'assistant');bodyFallback=true;}}
    }
    const ordered=[...roots.keys()].filter(node=>![...roots.keys()].some(parent=>parent!==node&&parent.contains(node)&&roots.get(parent)===roots.get(node)))
      .sort((a,b)=>{if(a===b)return 0;const left=composedPath(a),right=composedPath(b);let index=0;while(index<Math.min(left.length,right.length)&&left[index]===right[index])index++;if(index===left.length)return-1;if(index===right.length)return 1;return left[index].compareDocumentPosition(right[index])&Node.DOCUMENT_POSITION_FOLLOWING?-1:1;});
    const occurrences=new Map(),messages=[];
    for(const node of ordered){
      const kind=roots.get(node),variants=texts(node,kind),text=variants[0]||'';
      if(kind==='assistant'&&!text)continue;
      const fingerprint=M.fingerprint(kind+'\n'+text),occurrence=(occurrences.get(fingerprint)||0)+1;occurrences.set(fingerprint,occurrence);
      const testId=node.getAttribute('data-testid')||'';
      const turnKey=node.getAttribute('data-turn-key')||node.closest('[data-turn-key]')?.getAttribute('data-turn-key')||'';
      const native=node.getAttribute('data-message-id')||node.querySelector('[data-message-id]')?.getAttribute('data-message-id')||(kind==='assistant'?node.closest('[data-message-id]')?.getAttribute('data-message-id'):'')||node.getAttribute('data-turn-id')||node.getAttribute('data-turn-key')||(turnKey?turnKey+':'+kind:'')||(/^conversation-turn-.+/.test(testId)?testId:'');
      const key=native?'m:'+native:'dom:'+kind+':'+fingerprint+':'+occurrence;
      const folded=[...node.querySelectorAll('button,[role="button"]')].some(el=>[el.textContent,el.getAttribute('aria-label')].some(value=>/^(展开|展开更多|显示更多|显示全文|查看更多|Expand|Show more|Read more)(?:\s*(?:消息|内容|message|text))?$/i.test(clean(value))))||body(node,kind).getAttribute('data-collapsed')==='true';
      if(messages.some(message=>message.key===key))continue;
      messages.push({node,root:node,role:kind,key,text,variants,fingerprint,folded});
    }
    const selectors={users:USER,answers:ASSISTANT,messageIds:'[data-message-id]',turns:'[data-testid^="conversation-turn-"]',answerActions:ANSWER_ACTIONS};
    const probe={scopes:allScopes.length,mainElements:document.querySelectorAll('main').length};for(const [name,selector]of Object.entries(selectors))probe[name]=allScopes.reduce((count,scope)=>count+scope.querySelectorAll(selector).length,0);
    return{messages,strategy:headingCount?'speaker-labels':bodyFallback?'body-containers':'role-attributes',probe};
  }
  globalThis.PromptChainMessages=Object.assign(globalThis.PromptChainMessages||{},{read,role,texts,version:9});
})();
