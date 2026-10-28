const visible = element => !!element?.isConnected && !element.hidden && getComputedStyle(element).visibility !== 'hidden' && element.getClientRects().length > 0;
const enabled = element => visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();

export function createDeepSeekAdapter() {
  let upload = null,lastUploadState=null;
  function getInputElement() {
    for (const selector of ['textarea[placeholder*="DeepSeek" i]', 'form textarea:not([disabled]):not([readonly])', 'textarea:not([aria-hidden="true"]):not([tabindex="-1"])', '[contenteditable="true"][role="textbox"]']) {
      const input = [...document.querySelectorAll(selector)].find(element => enabled(element) && !element.readOnly);
      if (input) return input;
    }
    return null;
  }
  const scope = input => {
    if(input?.closest('form'))return input.closest('form');
    let root=input?.closest('.ds-textarea')?.parentElement||input?.parentElement?.parentElement;
    for(let count=0;root?.parentElement&&count<3;count++){
      const parent=root.parentElement;
      if(parent.matches('body,html,main')||parent.querySelectorAll('textarea,[contenteditable="true"]').length!==1||parent.querySelector('[data-virtual-list-item-key],.ds-assistant-message-main-content'))break;
      root=parent;
    }
    return root;
  };
  function nameCount(root,file){
    const text=normalize(description(root)),full=normalize(file.name),dot=file.name.lastIndexOf('.'),stem=normalize(dot>0?file.name.slice(0,dot):file.name),extension=dot>0?file.name.slice(dot+1).toLowerCase():'';
    const exact=text.split(full).length-1;
    if(exact||!extension)return exact;
    const tokens=text.toLowerCase().split(/[^a-z0-9]+/);
    return /^[a-z0-9]+$/.test(extension)&&tokens.some(token=>token===extension||new RegExp('^'+extension+'\\d').test(token))?text.split(stem).length-1:0;
  }
  const uploadBusy=root=>[...root.querySelectorAll('[role="progressbar"],[aria-busy="true"],[aria-label*="uploading" i],[aria-label*="上传中"],.ds-loading')].some(visible);
  const readyAttachment=input=>upload?.ready&&upload.input===input&&upload.url===location.href&&upload.root.isConnected&&!uploadBusy(upload.root)&&upload.files.every(file=>nameCount(upload.root,file)>upload.beforeCounts.get(file.name));
  function isGenerating() {
    return [...document.querySelectorAll('button[aria-label*="Stop" i],button[aria-label*="停止"],[role="button"][aria-label*="Stop" i],[role="button"][aria-label*="停止"],[data-testid*="stop" i]')].some(visible);
  }
  function getSendButton(input = getInputElement()) {
    if (!input || isGenerating()) return null;
    const root = scope(input);
    const candidates = [...(root?.querySelectorAll('button,[role="button"]') || [])].filter(element => enabled(element) && !/stop|停止|remove|移除|删除/i.test([element.getAttribute('aria-label'), element.title, element.textContent].join(' ')));
    const buttons = candidates.filter(element => element.type === 'submit' || /发送|\bsend\b/i.test([element.getAttribute('aria-label'), element.title, element.textContent].join(' ')) || /^(send|send-button|send-message)$/.test(element.getAttribute('data-testid')||''));
    if (buttons.length === 1) return buttons[0];
    if (buttons.length > 1) return null;
    if (normalize('value' in input ? input.value : input.innerText)||readyAttachment(input)) return {click() {
      input.focus();
      upload=null;
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true}));
    }};
    return null;
  }
  function clickSend(input) {const button = getSendButton(input); if (!button) return false; button.click(); return true;}
  function description(root) {return [root.innerText || '', ...[...root.querySelectorAll('span,div')].filter(node=>!node.children.length).map(node=>node.textContent||''), ...root.querySelectorAll('[aria-label],[title],[alt]')].map(element => typeof element === 'string' ? element : [element.getAttribute('aria-label'), element.title, element.getAttribute('alt')].join(' ')).join('\n');}
  async function attachFiles(files) {
    if (!files.length) return {ok: true};
    const input = getInputElement(), root = scope(input);
    if (!root) return {ok: false, error: 'COMPOSER_NOT_FOUND: DeepSeek attachment area was not found'};
    const accepts = element => files.every(file => {
      const types = element.accept.toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      return !types.length || types.some(type => type === '*/*' || type === '.' + file.name.split('.').at(-1).toLowerCase() || type === file.type || type.endsWith('/*') && file.type.startsWith(type.slice(0, -1)));
    });
    let choices = [...root.querySelectorAll('input[type="file"]')];
    if (!choices.length) choices = [...document.querySelectorAll('input[type="file"]')];
    choices = choices.filter(element => !element.disabled && !element.hasAttribute('capture') && accepts(element));
    if (choices.length === 1 && files.length > 1 && !choices[0].multiple) return {ok:false,error:'UPLOAD_MULTIPLE_UNSUPPORTED: DeepSeek file input requires single selections'};
    if (choices.length !== 1) return {ok: false, error: 'UPLOAD_INPUT_NOT_UNIQUE: A unique DeepSeek file input was not found'};
    upload = {input, root, files, url: location.href, beforeCounts:new Map(files.map(file=>[file.name,nameCount(root,file)])),startedAt:Date.now()};lastUploadState=null;
    const transfer = new DataTransfer(); files.forEach(file => transfer.items.add(file));
    choices[0].files = transfer.files;
    choices[0].dispatchEvent(new Event('input', {bubbles: true}));
    choices[0].dispatchEvent(new Event('change', {bubbles: true}));
    return {ok: true};
  }
  async function waitForUploadsComplete(options) {
    const current = upload, start = Date.now(); let quiet = 0;
    if (!current || options.files.length !== current.files.length || options.files.some((file, index) => file !== current.files[index])) return false;
    while (Date.now() - start < (options.timeoutMs || 120000)) {
      options.guard?.();
      if (upload !== current || location.href !== current.url || getInputElement() !== current.input || !current.root.isConnected) return false;
      const alerts = [...current.root.querySelectorAll('[role="alert"]')].filter(visible).map(element => element.innerText).join('\n');
      if (/failed|error|失败|无法|不支持|限制/i.test(alerts)) throw new Error('UPLOAD_REJECTED: DeepSeek reported an attachment error');
      const named = current.files.every(file => nameCount(current.root,file)>current.beforeCounts.get(file.name));
      const busy = uploadBusy(current.root);
      lastUploadState={elapsedMs:Date.now()-start,fileCount:current.files.length,scopeConnected:current.root.isConnected,composerUnchanged:getInputElement()===current.input,nameMatched:named,busy,quietMs:quiet?Date.now()-quiet:0,sendReady:!!getSendButton(current.input),waitingFor:!named?'attachment preview name not recognized':busy?'attachment still processing':'upload stability check'};
      if(!named&&!busy&&Date.now()-start>8000)throw new Error('UPLOAD_PREVIEW_NOT_RECOGNIZED: Attachment name was not found in the composer');
      if (named && !busy) {
        quiet ||= Date.now();
        if (Date.now() - quiet >= 850) {current.ready=true;if(getSendButton(current.input)){lastUploadState={...lastUploadState,sendReady:true,waitingFor:'ready'};return true;}}
      } else {quiet = 0;current.ready=false;}
      await sleep(options.pollMs || 250);
    }
    upload = null; return false;
  }
  function verifyAttachments(files){const input=getInputElement(),root=scope(input);return!!root&&files.every(file=>nameCount(root,file)>0);}
  return {id: 'deepseek',uploadDiagnostic:()=>lastUploadState, matchesAdapterDomain: () => location.hostname === 'chat.deepseek.com', getInputElement, getSendButton, clickSend, isGenerating, attachFiles, waitForUploadsComplete,verifyAttachments};
}
