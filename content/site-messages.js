(() => {
  const M = PromptFlowModel;
  const selectors = {
    gemini: {user: 'user-query,.user-query-container,[data-test-id="user-query"]', assistant: 'model-response,[data-test-id="model-response"]'},
    deepseek: {user: '.ds-collapsible-text,.fbb737a4,[class*="user-message"]', assistant: '.ds-assistant-message-main-content,.ds-markdown'}
  };
  const config = () => selectors[M.platforms.providerFor(location.href)];
  const FILE_ROW='[data-virtual-list-item-key],.ds-message,[data-message-id],.ds-message-row,.message-row';
  function fileNames(node){
    const parts=[...node.querySelectorAll('span,div,[title],[aria-label]')].filter(element=>!element.closest('button,[role="button"],.ds-markdown,.ds-think-content')).flatMap(element=>[element.getAttribute('title'),element.getAttribute('aria-label'),!element.children.length?element.textContent:'']).map(value=>String(value||'').trim()).filter(Boolean);
    const typeLabel=/^(MD|TXT|PDF|DOCX?|PNG|JPE?G|WEBP)\s*(?:[\d.]+\s*(?:KB|MB|B))?$/i;
    const type=parts.map(part=>typeLabel.exec(part)).find(Boolean)?.[1]?.toLowerCase();
    if(!type)return[];
    return [...new Set(parts.filter(part=>part.length>2&&!typeLabel.test(part)&&!/…|\.{3}|^[\d.]+\s*(?:KB|MB|B)$/i.test(part)).map(part=>new RegExp('\\.'+type+'$','i').test(part)?part:part+'.'+type))];
  }
  function role(node) {const value = config(); return value && (node.matches(value.user) ? 'user' : node.matches(value.assistant) ? 'assistant' : '');}
  function texts(node, kind) {
    const provider = M.platforms.providerFor(location.href);
    const preferred = provider === 'gemini' ? kind === 'user' ? '.query-text,user-query-content' : 'message-content .markdown-main-panel,message-content .markdown,message-content' : kind === 'user' ? '.ds-collapsible-text,.fbb737a4' : '.ds-assistant-message-main-content,.ds-markdown';
    const body = node.querySelector(preferred) || node;
    const clone = body.cloneNode(true);
    clone.querySelectorAll('button,[role="button"],script,style,svg,.sr-only,[hidden],[aria-hidden="true"],.cdk-visually-hidden,[class*="screen-reader"],.ds-think-content,.ds-think-toggle,.thoughts-container,.thoughts-wrapper,model-thoughts,.sources-list,follow-up,message-actions,user-query-file-carousel').forEach(element => element.remove());
    function walk(element) {
      if (element.nodeType === 3) return element.textContent;
      if (element.nodeType !== 1) return '';
      if (element.tagName === 'BR') return '\n';
      const text = [...element.childNodes].map(walk).join('');
      return /^(P|DIV|SECTION|LI|PRE|H[1-6])$/.test(element.tagName) ? '\n' + text + '\n' : text;
    }
    const text = walk(clone).replace(/\r\n?/g, '\n').trim();
    const rendered = body.innerText?.replace(/\r\n?/g, '\n').trim();
    return [...new Set([text, ...(kind === 'user' && provider === 'gemini' && rendered ? [rendered] : [])])];
  }
  function read() {
    const value = config(), provider = M.platforms.providerFor(location.href), messages = [], occurrences = new Map();
    if (!value) return {messages, strategy: 'unsupported', probe: {}};
    const roots = [...document.querySelectorAll(value.user + ',' + value.assistant)].filter(node => !node.parentElement?.closest(role(node) === 'user' ? value.user : value.assistant) && !node.closest('form,input-area-v2,[role="dialog"],nav,aside'));
    const fileRows=new Set();
    if(provider==='deepseek')for(const node of document.querySelectorAll(FILE_ROW)){
      if(node.closest('form,input-area-v2,[role="dialog"],nav,aside,.ds-think-content,'+value.user+','+value.assistant)||node.querySelector('textarea,[contenteditable="true"],'+value.user+','+value.assistant)||roots.some(root=>node.contains(root))||!fileNames(node).length)continue;
      if([...fileRows].some(row=>row.contains(node)))continue;
      for(const row of fileRows)if(node.contains(row))fileRows.delete(row);
      fileRows.add(node);
    }
    roots.push(...fileRows);roots.sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
    for (const node of roots) {
      const kind = fileRows.has(node)?'user':role(node), variants = fileRows.has(node)?['']:texts(node, kind), text = variants[0];
      if (kind === 'assistant' && !text) continue;
      const root = provider === 'deepseek' ? node.closest('[data-virtual-list-item-key],.ds-message,[data-message-id]') || node : node;
      const native = root.getAttribute('data-message-id') || root.getAttribute('data-virtual-list-item-key') || node.getAttribute('data-response-id') || '';
      const files=fileRows.has(node)?fileNames(node):[];
      const fingerprint = M.fingerprint(kind + '\n' + text+(files.length?'\n'+files.join('\n'):'')), ordinal = (occurrences.get(fingerprint) || 0) + 1;
      occurrences.set(fingerprint, ordinal);
      const key = native ? 'm:' + provider + ':' + native + ':' + kind : 'dom:' + kind + ':' + fingerprint + ':' + ordinal;
      const folded = !!root.querySelector('[aria-expanded="false"],[data-collapsed="true"],[data-expanded="false"]') || [...root.querySelectorAll('button,[role="button"]')].some(button => /展开|显示更多|Show more|Read more|Expand/i.test([button.textContent,button.getAttribute('aria-label')].join(' ')));
      messages.push({node, root, role: kind, text, variants, key, fingerprint, folded,files});
    }
    return {messages, strategy: provider + '-containers', probe: {users: messages.filter(item => item.role === 'user').length, answers: messages.filter(item => item.role === 'assistant').length, attachmentOnlyUsers:fileRows.size}};
  }
  globalThis.PromptChainSiteMessages = {read, role, texts};
})();
