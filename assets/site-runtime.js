import {wrapGeminiUpload} from "../content/gemini-upload.mjs";
import {createDeepSeekAdapter} from "../content/deepseek-adapter.mjs";
import {createChainRunner} from "../content/chain-runner.mjs";
import{c as G,l as ge}from"./rpc.js";const be=/\$([^\s]*)$/,ye=/[\u200B-\u200D\u2060\uFEFF]/g,xe=new Set([" "," ",`
`]);function ae(t){const n=be.exec(t);if(!n||typeof n.index!="number"||/^\d/.test(n[1]??""))return null;const e=n.index,r=t.slice(0,e);if(r.length===0)return{query:n[1]??"",shortcutIndex:e};if(r.replace(ye,"").length===0)return{query:n[1]??"",shortcutIndex:e};const a=r[r.length-1];return xe.has(a)?{query:n[1]??"",shortcutIndex:e}:null}function Ee(t){return t.getAttribute("contenteditable")==="true"}function we(t){if(!t)return null;if(t instanceof HTMLTextAreaElement){const n=t.selectionStart??0,e=(t.value||"").slice(0,n),r=ae(e);if(!r)return null;const o=t.getBoundingClientRect();return{kind:"textarea",input:t,query:r.query,start:r.shortcutIndex,end:n,rect:o}}if(t instanceof HTMLElement&&Ee(t)){const n=window.getSelection();if(!n||n.rangeCount===0)return null;const e=n.getRangeAt(0);if(!e.collapsed||!t.contains(e.startContainer))return null;const r=e.cloneRange();r.selectNodeContents(t),r.setEnd(e.endContainer,e.endOffset);const o=r.cloneContents();o.querySelectorAll("br").forEach(p=>p.replaceWith(`
`)),o.querySelectorAll("p, div, li").forEach(p=>p.before(`
`));const a=o.textContent||"",l=ae(a);if(!l)return null;const i=e.cloneRange();i.selectNodeContents(t),i.setStart(e.endContainer,e.endOffset);const s=i.toString(),d=e.getBoundingClientRect().width?e.getBoundingClientRect():t.getBoundingClientRect();return{kind:"contenteditable",input:t,query:l.query,shortcutIndex:l.shortcutIndex,textBefore:a,textAfter:s,rect:d}}return null}function Ae(t){return/[\r\n\t]/.test(t)||/ {2,}/.test(t)?"insertFromPaste":"insertText"}function Ce(t,n,e){try{const r=new InputEvent("beforeinput",{bubbles:!0,cancelable:!0,data:n,inputType:e});t.dispatchEvent(r)}catch{}}function ve(t,n,e){try{const r=new InputEvent("input",{bubbles:!0,data:n,inputType:e});t.dispatchEvent(r)}catch{t.dispatchEvent(new Event("input",{bubbles:!0}))}}function ce(t,n){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set?.call(t,n),t.dispatchEvent(new Event("input",{bubbles:!0})),t.focus()}function ue(t,n){t.focus();const e=Ae(n);Ce(t,n,e);const r=window.getSelection(),o=document.createRange();o.selectNodeContents(t),o.deleteContents(),o.insertNode(Se(n));const a=document.createRange();a.selectNodeContents(t),a.collapse(!1),r?.removeAllRanges(),r?.addRange(a),ve(t,n,e)}function Se(t){const n=document.createDocumentFragment();for(const e of t.split(/\r\n|\r|\n/)){const r=document.createElement("p");r.appendChild(e?document.createTextNode(e):document.createElement("br")),n.appendChild(r)}return n}function U(t){if(!t)return"";if(t instanceof HTMLTextAreaElement)return t.value||"";const n=Array.from(t.children);return n.length&&t.childNodes.length===n.length&&n.every(e=>e.tagName==="P")?n.map(e=>{const r=e.innerText||"";return e.lastChild?.nodeName==="BR"&&r.endsWith(`
`)?r.slice(0,-1):r}).join(`
`):t.innerText||""}function X(t,n){return t.replace(/\s+/g," ").trim()===n.replace(/\s+/g," ").trim()}function Y(t,n){t instanceof HTMLTextAreaElement?ce(t,n):ue(t,n)}function de(t,n){if(t instanceof HTMLTextAreaElement){const e=t.value||"",r=e?`${e}
${n}`:n;ce(t,r);const o=r.length;try{t.setSelectionRange(o,o)}catch{}}else{const e=U(t);ue(t,e?`${e}
${n}`:n)}}function R(t){const n=t;return n?n.offsetParent!==null?!0:n.getClientRects().length>0:!1}function Z(t){return t?R(t)&&!t.disabled:!1}function fe(t){if(!t||!(t instanceof HTMLButtonElement)||t.disabled)return!1;const n=t.getAttribute("aria-disabled");return n&&n.toLowerCase()==="true"?!1:R(t)}function W(t){return!(!t||!(t instanceof HTMLInputElement)||t.type!=="file"||t.disabled)}function ee(t,n){if(!t)return null;const e=t.closest("form")||t.parentElement;if(e&&e!==document.body&&e!==document.documentElement){const o=n.length?Array.from(e.querySelectorAll(n.join(", "))):[];if(o.length)return o.length===1&&W(o[0])?o[0]:null;const a=Array.from(e.querySelectorAll('input[type="file"]'));if(a.length)return a.length===1&&W(a[0])?a[0]:null}const r=n.length?Array.from(document.querySelectorAll(n.join(", "))):[];return r.length===1&&W(r[0])?r[0]:null}function te(t,n){try{const e=new DataTransfer;return n.forEach(r=>e.items.add(r)),t.files=e.files,t.dispatchEvent(new Event("input",{bubbles:!0})),t.dispatchEvent(new Event("change",{bubbles:!0})),{ok:!0}}catch(e){return{ok:!1,error:e instanceof Error?e.message:"无法添加附件。"}}}function ne(t,n){const e=t.closest("form");let r=e||t.parentElement;for(;r&&r!==document.body&&r!==document.documentElement;){if(!e&&Array.from(r.querySelectorAll('textarea, [contenteditable="true"]')).some(i=>i!==t&&!t.contains(i)&&!(i.getAttribute("class")?.split(/\s+/).includes("ql-clipboard")&&i.getAttribute("tabindex")==="-1")&&R(i)))return null;const o=Array.from(r.querySelectorAll(n.join(", "))),a=o.filter(l=>fe(l)&&!/\bstop\b/i.test(l.getAttribute("aria-label")||"")&&l.getAttribute("data-testid")!=="stop-button"&&!l.getAttribute("class")?.split(/\s+/).includes("stop"));if(a.length>1)return null;if(a.length===1)return a[0];if(e||o.length)return null;r=r.parentElement}return null}async function Te(){return G("GET_SETTINGS",void 0)}async function ke(t,n){return G("PROMPT_SEARCH",{query:t,limit:n})}async function Ie(t,n){return G("CHAIN_SEARCH",{query:t,limit:n})}async function Ne(t,n){try{await G("LOG_USAGE",{promptId:t,platform:n})}catch(e){throw new Error(e instanceof Error?e.message:"无法保存使用记录。")}}async function qe(t,n,e,r){try{return await G("PROMPT_UPDATE",{id:t,title:n,content:e,attachments:r}),!0}catch(o){throw o instanceof Error?o:new Error("保存失败。")}}async function Me(t){try{return await G("PROMPT_DELETE",{id:t}),!0}catch{return!1}}async function Re(t,n,e){try{return await G("PROMPT_CREATE",{title:t,content:n,attachments:e}),!0}catch(r){throw r instanceof Error?r:new Error("保存失败。")}}async function pe(t){if(!Array.isArray(t)||t.length===0)return[];const n=[];for(const e of t){let r=0;const o=[];let a=0,l=!1;for(;!l;){const s=await G("ATTACHMENT_GET_CHUNK",{id:e.id,offset:r,length:65536});o.push(s.chunkBase64),r=s.nextOffset,a=s.totalBytes,l=s.done}const i=De(o,a);n.push(new File([i],e.name,{type:e.mimeType}))}return n}function De(t,n){const e=new Uint8Array(Math.max(0,n));let r=0;for(const o of t){if(!o)continue;const a=atob(o);for(let l=0;l<a.length&&!(r>=e.length);l+=1)e[r]=a.charCodeAt(l),r+=1}return e.buffer.slice(0,r)}function re(){let t=null,n=0;const e=new Set;return{tryAcquire(r){return t||r!=="queue"&&n>0?!1:(t=r,!0)},release(){t=null;for(const r of e)r()},setQueuePending(r){n=r},getOwner(){return t},isBusy(){return t!==null||n>0},subscribe(r){return e.add(r),()=>{e.delete(r)}}}}function P(){return globalThis.location?.href??""}function j(t=P()){if(!t)return!1;const{hostname:n,pathname:e}=new URL(t);return/(^|\.)chatgpt\.com$/.test(n)||/(^|\.)chat\.openai\.com$/.test(n)?/^\/(?:g\/[^/]+\/)?c\/(?!local-chatgpt(?::|%3A))[^/]+\/?$/i.test(e):/(^|\.)chat\.deepseek\.com$/.test(n)?/^\/(?:a\/)?chat\/s\/[^/]+\/?$/.test(e):/(^|\.)gemini\.google\.com$/.test(n)?/^\/(?:u\/\d+\/)?(?:app|gem\/[^/]+)\/[^/]+\/?$/.test(e):!1}function H(t,n){if(t.throwIfAborted(),P()!==n)throw new Error("CONVERSATION_CHANGED");if(!j(n))throw new Error("CONVERSATION_REQUIRED")}async function $(t,n){n.throwIfAborted(),await new Promise((e,r)=>{const o=setTimeout(()=>{n.removeEventListener("abort",a),e()},t);function a(){clearTimeout(o),r(n.reason)}n.addEventListener("abort",a,{once:!0})})}async function he(t,n,e,r,o,a=new AbortController().signal,l={timeoutMs:5e3,pollMs:200}){const i=Date.now();function s(){if(a.throwIfAborted(),P()!==r)throw new Error("CONVERSATION_CHANGED");if(!n.isConnected||t.getInputElement()!==n)throw new Error("COMPOSER_CHANGED: 输入框已变化，请先核对草稿。");if(!X(U(n),e))throw new Error("COMPOSER_CHANGED: 请保存或清空草稿后重试。");if(t.isGenerating())throw new Error("发送前模型已开始回答，请检查对话后重试。")}for(;;){if(await $(l.pollMs,a),s(),t.getSendButton(n)){s(),o();let d;try{d=t.clickSend(n)}catch{throw new Error("SEND_UNCERTAIN: 提示词可能已经发送。")}if(!d)throw new Error("SEND_FAILED");return}if(Date.now()-i>=l.timeoutMs)throw new Error("SEND_FAILED")}}async function me(t,n,e,r,o,a,l,i={timeoutMs:12e4,startTimeoutMs:15e3,pollMs:200},s,d=P()){H(o,d);const p=U(n()||t.getInputElement());if(a("waiting"),s!==void 0&&p!==""&&!X(p,s))throw new Error("COMPOSER_CHANGED: 请保存或清空草稿后重试。");let m=Date.now();for(;t.isGenerating()||!Z(t.getInputElement());){if(H(o,d),Date.now()-m>=i.timeoutMs)throw new Error("MODEL_IDLE_TIMEOUT");await $(i.pollMs,o)}if(H(o,d),e.attachments?.length){a("uploading");const w=await pe(e.attachments);H(o,d);const C=await t.attachFiles(w);if(!C.ok)throw new Error(C.error||"ATTACHMENT_UPLOAD_FAILED");const S=await t.waitForUploadsComplete({timeoutMs:12e4,pollMs:i.pollMs,files:w});if(H(o,d),!S)throw new Error("ATTACHMENT_UPLOAD_TIMEOUT")}H(o,d);const f=n()||t.getInputElement();if(!f)throw new Error("INPUT_NOT_FOUND");const h=U(f);if(h!==p||s!==void 0&&h!==""&&!X(h,s))throw new Error("COMPOSER_CHANGED: 请保存或清空草稿后重试。");r==="append"?de(f,e.content):Y(f,e.content);const g=(r==="append"&&h?`${h}
${e.content}`:e.content).replace(/\r\n|\r/g,`
`);for(H(o,d),a("sending"),await he(t,f,g,d,l,o,{timeoutMs:Math.min(5e3,i.startTimeoutMs),pollMs:i.pollMs}),a("awaiting_response"),m=Date.now();!t.isGenerating();){if(H(o,d),Date.now()-m>=i.startTimeoutMs)throw new Error("GENERATION_START_TIMEOUT");await $(i.pollMs,o)}for(m=Date.now();t.isGenerating()||!Z(t.getInputElement());){if(H(o,d),Date.now()-m>=i.timeoutMs)throw new Error("RESPONSE_TIMEOUT");await $(i.pollMs,o)}H(o,d)}async function se(t,n,e,r,o,a,l){if(!e.trim()&&r.length===0)return{ok:!1,sendAttempted:!1,reason:"这条提示词只有附件，请在设置中开启附件。"};if(!n.tryAcquire("manual"))return{ok:!1,sendAttempted:!1,reason:"已有队列或流程在运行，请等待完成或先取消。"};let i=null,s=!1,d=!1;function p(){s=!0}try{let m=function(){if(P()!==l)throw new Error("对话已切换，未插入内容。");if(!f.isConnected||t.getInputElement()!==f)throw new Error("输入框已重新加载，请重试。");if(s||U(f)!==h)throw new Error("草稿已变化，未插入内容。");if(a&&t.isGenerating())throw new Error("请等待当前回答完成。")};if(i=t.getInputElement(),!i)throw new Error("请先打开对话，再重试。");const f=i,h=U(i);if(m(),i.addEventListener("input",p),r.length){const g=await pe(r);m();const w=await t.attachFiles(g);if(!w.ok)throw new Error(w.error||"附件上传失败，请检查输入框。");const C=await t.waitForUploadsComplete({timeoutMs:12e4,pollMs:250,files:g});if(m(),!C)throw new Error("无法确认附件上传，请检查输入框。")}if(m(),i.removeEventListener("input",p),o==="append"?e&&de(i,e):Y(i,e),a){const w=(o==="append"?e?h?`${h}
${e}`:e:h:e).replace(/\r\n|\r/g,`
`);await he(t,i,w,l,()=>{d=!0})}return{ok:!0,sendAttempted:d}}catch(m){if(m instanceof Error&&m.message==="SEND_FAILED")return{ok:!1,sendAttempted:!1,reason:"未能点击发送，提示词保留在输入框中。"};const f=m instanceof Error?m.message:"",h=f.startsWith("CONVERSATION_CHANGED")?"发送前对话已切换。":f.startsWith("COMPOSER_CHANGED")?"发送前输入框已变化，请核对后手动发送。":f==="ATTACHMENT_NOT_FOUND"?"提示词缺少附件，请重新添加。":f||"无法插入提示词。";return{ok:!1,sendAttempted:d,reason:h}}finally{i?.removeEventListener("input",p),n.release()}}const Le=`/*
Reset all inherited properties.
*/
:host {
  all: initial;
  color-scheme: light;
}

/* 
Darker backdrop behind the prompt editor.
*/
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(28, 39, 44, 0.28);
  backdrop-filter: blur(2px);
  z-index: 2147483647;
  display: none;
  align-items: center;
  justify-content: center;
}

/* 
Prompt editor dialog, which contains the shortcut name and prompt contents.
*/
.dialog {
  width: min(1080px, 92vw);
  max-height: 85vh;
  background: #ffffff;
  border-radius: 6px;
  overflow: hidden;
  color: #1c272c;
  border: 1px solid #bcc7ca;
  box-shadow: 0 16px 40px rgba(28, 39, 44, 0.18);
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-synthesis: none;
}

/* 
Prompt editor dialog as well as all contained elements (descendents).
*/
.dialog, .dialog * {
  box-sizing: border-box;
}

/* 
Top bar of the prompt editor (title + close button).
*/
.header {
  padding: 15px 18px 13px 18px;
  border-bottom: 1px solid #d9dfe1;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/*
Title/label for the prompt editor.
*/
.title {
  font-size: 18px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: #1c272c;
}

/*
Close button for the prompt editor ('X' char).
*/
.close {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  background: #ffffff;
  border: 1px solid #cfd6d8;
  color: #46555c;
  cursor: pointer;
  font-size: 22px;
}

/*
Text box for prompt instructions.
*/
.textarea {
  field-sizing: content;
  min-height: 300px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.close:hover,
.close:focus-visible {
  background: #edf2f3;
  border-color: #9eb1b8;
  color: #426c7a;
}

/*
Body section containing form fields. overflow-y and min-height: 0
allow this flex child to scroll when the prompt editor hits max-height.
*/
.body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  min-height: 0;
}

/*
Shared styles for the name input and instructions textarea.
*/
.input,
.textarea {
  width: 100%;
  border-radius: 4px;
  border: 1px solid #cfd6d8;
  background: #ffffff;
  color: #1c272c;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 14px;
  outline: none;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}

.input::placeholder,
.textarea::placeholder {
  color: #879297;
}

.error {
  font-size: 12px;
  color: #be123c;
  min-height: 16px;
}

.footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 18px;
  border-top: 1px solid #d9dfe1;
}

/*
Base button styles shared by Cancel and Save.
*/
.btn {
  border-radius: 4px;
  min-height: 40px;
  padding: 8px 14px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 650;
  border: 1px solid #cfd6d8;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
}

.btn:focus-visible,
.close:focus-visible,
.delete:focus-visible {
  outline: 2px solid #527d8c;
  outline-offset: 2px;
}

.btn-secondary {
  background: #ffffff;
  color: #1c272c;
}

.btn-primary {
  background: #527d8c;
  border-color: #527d8c;
  color: #f7fafb;
  box-shadow: 0 1px 2px rgba(20, 32, 37, 0.12);
}

.btn-secondary:hover:not(:disabled),
.btn-secondary:focus-visible:not(:disabled) {
  background: #edf2f3;
  border-color: #9eb1b8;
}

.btn-primary:hover:not(:disabled),
.btn-primary:focus-visible:not(:disabled) {
  background: #426c7a;
  border-color: #426c7a;
  box-shadow: 0 2px 4px rgba(20, 32, 37, 0.14);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/*
Square delete button with trash icon.
*/
.delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-right: auto;
  border-radius: 4px;
  border: 1px solid #cfd6d8;
  background: #ffffff;
  color: #be123c;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
}

.delete svg {
  width: 16px;
  height: 16px;
}

.delete:hover:not(:disabled),
.delete:focus-visible:not(:disabled) {
  background: #edf2f3;
  border-color: #9eb1b8;
  color: #9f1239;
}

.delete:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.input:hover,
.textarea:hover {
  border-color: #9eb1b8;
}

.input:focus,
.textarea:focus {
  border-color: #527d8c;
  box-shadow: 0 0 0 2px rgba(82, 125, 140, 0.14);
}

.dialog ::selection {
  color: #ffffff;
  background: #527d8c;
}
`,_e=`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path fill="currentColor" d="M9 3h6l1.5 2H20v2H4V5h3.5L9 3zm-2 6h2v10H7V9zm4 0h2v10h-2V9zm4 0h2v10h-2V9z"/>
</svg>
`;function Oe(t){const n=document.createElement("div");n.setAttribute("data-promptchain-prompt-editor","true");const e=n.attachShadow({mode:"closed"}),r=new CSSStyleSheet;r.replaceSync(Le);const o=document.createElement("div");o.className="backdrop";const a=document.createElement("div");a.className="dialog",a.setAttribute("role","dialog"),a.setAttribute("aria-modal","true"),a.setAttribute("aria-labelledby","prompt-editor-title");const l=document.createElement("div");l.className="header";const i=document.createElement("div");i.className="title",i.id="prompt-editor-title",i.textContent="编辑提示词";const s=document.createElement("button");s.className="close",s.type="button",s.setAttribute("aria-label","关闭"),s.innerHTML="&times;",l.append(i,s);const d=document.createElement("div");d.className="body";const p=document.createElement("input");p.className="input",p.id="shortcut-name",p.placeholder="提示词名称",p.setAttribute("aria-label","提示词名称");const m=document.createElement("textarea");m.className="textarea",m.id="shortcut-instructions",m.placeholder="提示词",m.setAttribute("aria-label","提示词");const f=document.createElement("div");f.className="error",f.setAttribute("role","alert"),d.append(p,m,f);const h=document.createElement("div");h.className="footer";const g=document.createElement("button");g.className="delete",g.type="button",g.setAttribute("aria-label","删除提示词"),g.innerHTML=_e;const w=document.createElement("button");w.className="btn btn-secondary",w.textContent="取消";const C=document.createElement("button");C.className="btn btn-primary",C.textContent="保存",C.title=navigator.userAgent.toLowerCase().includes("mac")?"⌘ + Enter":"Ctrl + Enter",h.append(g,w,C),a.append(l,d,h),o.append(a),e.append(o),e.adoptedStyleSheets=[r],document.documentElement.append(n);let S,v=!1,b=!1,y=!1,u=null;function T(x){y=x,C.disabled=x,w.disabled=x,g.disabled=x,s.disabled=x,p.disabled=x,m.disabled=x,a.setAttribute("aria-busy",String(x))}function k(x){f.textContent=x}function I(){k("")}function N(x){u=document.activeElement,S=x.id,v=(x.attachmentCount??0)>0,i.textContent=S?"编辑提示词":"新建提示词",p.value=x.title||"",m.value=x.content||"",I(),g.style.display=S?"inline-flex":"none",o.style.display="flex",b=!0,setTimeout(()=>p.focus(),0)}function q(){y||(o.style.display="none",b=!1,t.onClose?.(),u&&setTimeout(()=>u?.focus(),0))}async function V(){if(y)return;const x=p.value.trim(),c=m.value,E=c.trim();if(!x){k("请填写名称。"),p.focus();return}if(!E&&!v){k("请填写提示词内容。"),m.focus();return}I(),T(!0);try{await t.onSave({id:S,title:x,content:c})?(T(!1),q()):k("保存失败。")}catch(A){const M=A instanceof Error?A.message:"保存失败。";k(M)}finally{T(!1)}}async function O(){if(!(y||!S)){T(!0);try{await t.onDelete(S)?(T(!1),q()):k("删除失败。")}catch(x){const c=x instanceof Error?x.message:"删除失败。";k(c)}finally{T(!1)}}}function B(x){if(x.isTrusted&&b){if(x.key==="Tab"){const c=Array.from(a.querySelectorAll("button:not(:disabled), input:not(:disabled), textarea:not(:disabled)")).filter(M=>M.getClientRects().length>0),E=c[0],A=c[c.length-1];if(!E||!A){x.preventDefault();return}x.shiftKey&&(e.activeElement===E||!e.activeElement)?(x.preventDefault(),A.focus()):!x.shiftKey&&(e.activeElement===A||!e.activeElement)&&(x.preventDefault(),E.focus())}x.key==="Escape"&&(x.preventDefault(),q()),x.key==="Enter"&&(x.metaKey||x.ctrlKey)&&(x.preventDefault(),V())}}return s.addEventListener("click",x=>{x.isTrusted&&q()}),w.addEventListener("click",x=>{x.isTrusted&&q()}),C.addEventListener("click",x=>{x.isTrusted&&V()}),g.addEventListener("click",x=>{x.isTrusted&&O()}),o.addEventListener("mousedown",x=>{x.isTrusted&&x.target===o&&q()}),document.addEventListener("keydown",B,!0),{open:N,close:q,isOpen:()=>b}}const Q=6,Pe=`
  :host {
    all: initial;
    --pc-shell: #f2f4f3;
    --pc-surface: #ffffff;
    --pc-text: #1c272c;
    --pc-text-soft: #46555c;
    --pc-text-muted: #6f7c82;
    --pc-line: #cfd6d8;
    --pc-accent: #527d8c;
    --pc-accent-hover: #426c7a;
    --pc-accent-text: #f7fafb;
  }
  .pc-shortcut-suggestions {
    position: fixed;
    z-index: 2147483647;
    min-width: 300px;
    max-width: 420px;
    overflow: hidden;
    border: 1px solid var(--pc-line);
    border-radius: 6px;
    color: var(--pc-text);
    background: var(--pc-shell);
    box-shadow: 0 16px 40px rgba(28, 39, 44, 0.18), 0 1px 3px rgba(20, 32, 37, 0.1);
    color-scheme: light;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .pc-shortcut-suggestions,
  .pc-shortcut-suggestions * {
    box-sizing: border-box;
  }
  .pc-header {
    padding: 10px 12px 9px;
    border-bottom: 1px solid #d9dfe1;
    color: var(--pc-text-muted);
    background: #fbfcfc;
    font-size: 11px;
    font-weight: 600;
  }
  .pc-create {
    display: flex;
    width: calc(100% - 16px);
    align-items: center;
    gap: 6px;
    margin: 8px 8px 2px;
    padding: 8px 10px;
    border: 1px solid var(--pc-line);
    border-radius: 4px;
    color: var(--pc-text-soft);
    background: var(--pc-surface);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 140ms ease, color 140ms ease, background 140ms ease;
  }
  .pc-create:hover {
    border-color: #9eb1b8;
    color: var(--pc-accent-hover);
    background: #edf2f3;
  }
  .pc-create:focus-visible,
  .pc-edit:focus-visible {
    outline: 2px solid var(--pc-accent);
    outline-offset: 2px;
  }
  .pc-create svg {
    width: 14px;
    height: 14px;
    flex: 0 0 auto;
  }
  .pc-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 6px 8px 8px;
    overflow-y: auto;
    list-style: none;
    overscroll-behavior: contain;
    scrollbar-color: rgba(95, 110, 117, 0.3) transparent;
    scrollbar-width: thin;
  }
  .pc-item {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 10px;
    border: 1px solid transparent;
    border-left: 3px solid transparent;
    border-radius: 5px;
    background: var(--pc-surface);
    box-shadow: 0 1px 2px rgba(20, 32, 37, 0.06);
    cursor: pointer;
    transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
  }
  .pc-item:hover {
    border-color: #d9dfe1;
    border-left-color: #9eb1b8;
    background: #f8f9f9;
  }
  .pc-item.active {
    border-color: #b8c8ce;
    border-left-color: var(--pc-accent);
    background: #eef3f5;
    box-shadow: 0 2px 5px rgba(20, 32, 37, 0.08);
  }
  .pc-title {
    overflow: hidden;
    color: var(--pc-text);
    font-size: 12.5px;
    font-weight: 650;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pc-edit {
    position: relative;
    display: inline-flex;
    height: 24px;
    width: 24px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--pc-line);
    border-radius: 3px;
    color: var(--pc-text-muted);
    background: var(--pc-surface);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: border-color 140ms ease, color 140ms ease, background 140ms ease;
  }
  .pc-edit:hover {
    border-color: var(--pc-accent);
    color: var(--pc-accent-text);
    background: var(--pc-accent);
  }
  .pc-edit svg {
    width: 14px;
    height: 14px;
    display: block;
  }
  .pc-edit .pc-tooltip {
    position: absolute;
    top: -28px;
    right: 0;
    padding: 3px 6px;
    border: 1px solid var(--pc-text);
    border-radius: 4px;
    color: var(--pc-accent-text);
    background: var(--pc-text);
    box-shadow: 0 3px 8px rgba(20, 32, 37, 0.16);
    font-size: 11px;
    white-space: nowrap;
    opacity: 0;
    transform: translateY(4px);
    pointer-events: none;
    transition: opacity 120ms ease, transform 120ms ease;
  }
  .pc-edit:hover .pc-tooltip {
    opacity: 1;
    transform: translateY(0);
  }
  .pc-empty {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: center;
    padding: 10px 12px;
    border: 1px dashed #b8c8ce;
    border-radius: 5px;
    color: var(--pc-text-muted);
    background: var(--pc-surface);
    font-size: 12px;
  }
`;function Ue(t){const n=document.createElement("div");n.setAttribute("data-promptchain-shortcut-suggestions","true");const e=n.attachShadow({mode:"closed"}),r=document.createElement("style");r.textContent=Pe;const o=document.createElement("div");o.className="pc-shortcut-suggestions",o.style.display="none";const a=document.createElement("div");a.className="pc-header";const l=document.createElement("button");l.className="pc-create",l.type="button",l.setAttribute("aria-label","新建提示词"),l.dataset.action="create",l.innerHTML=`
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M11 5h2v14h-2zM5 11h14v2H5z"/>
    </svg>
    <span>新建提示词</span>
  `,l.addEventListener("click",b=>{b.isTrusted&&t.onCreate()});const i=document.createElement("ul");i.className="pc-list",o.appendChild(a),o.appendChild(l),o.appendChild(i),e.appendChild(r),e.appendChild(o),document.documentElement.appendChild(n);const s={items:[],selectedIndex:0};function d(){if(i.style.maxHeight="",i.style.overflowY=s.items.length>Q?"auto":"hidden",s.items.length<=Q)return;const b=Array.from(i.querySelectorAll("li"));if(!b.length)return;const y=Math.min(Q,b.length),u=window.getComputedStyle(i),T=parseFloat(u.rowGap||u.gap||"0"),k=parseFloat(u.paddingTop||"0"),I=parseFloat(u.paddingBottom||"0");let N=k+I;for(let q=0;q<y;q+=1)N+=b[q].getBoundingClientRect().height,q<y-1&&(N+=T);i.style.maxHeight=`${Math.ceil(N)}px`}function p(){if(i.innerHTML="",s.items.length===0){const b=document.createElement("li");b.className="pc-empty",b.textContent="没有匹配项",i.appendChild(b),d();return}s.items.forEach((b,y)=>{const u=document.createElement("li");u.className=`pc-item${y===s.selectedIndex?" active":""}`,u.dataset.index=String(y);const T=document.createElement("div"),k=document.createElement("div");k.className="pc-title",k.textContent=b.title||"未命名",T.appendChild(k);function I(){s.selectedIndex=y,t.onSelect(b)}if(u.addEventListener("mousedown",N=>{!N.isTrusted||N.button!==0||N.target?.closest('button[data-action="edit"]')||I()}),u.addEventListener("click",N=>{N.isTrusted&&I()}),u.appendChild(T),b.kind==="prompt"){const N=document.createElement("button");N.className="pc-edit",N.setAttribute("aria-label","编辑"),N.dataset.action="edit",N.innerHTML=`
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm2.92 2.33H5v-.92l8.06-8.06.92.92L5.92 19.58zM20.71 6.04a1.003 1.003 0 0 0 0-1.42l-1.34-1.34a1.003 1.003 0 0 0-1.42 0l-1.02 1.02 2.75 2.75 1.03-1.01z"/>
          </svg>
          <span class="pc-tooltip">编辑</span>
        `,N.addEventListener("click",q=>{q.isTrusted&&(q.stopPropagation(),s.selectedIndex=y,t.onEdit(b))}),N.addEventListener("mousedown",q=>{q.isTrusted&&q.stopPropagation()}),u.appendChild(N)}i.appendChild(u)}),d(),s.items.length>Q&&i.querySelector("li.active")?.scrollIntoView({block:"nearest"})}function m(b,y,u){s.items=y,s.selectedIndex=Math.min(s.selectedIndex,Math.max(0,y.length-1)),a.textContent=u,a.style.display=u?"block":"none",o.style.display="block",o.style.visibility="hidden",i.scrollTop=0,p(),o.style.left=`${Math.max(8,b.x)}px`,o.style.top="0px";const T=o.getBoundingClientRect().height,k=b.top-T-8,I=k>=8?k:b.bottom+8;o.style.top=`${Math.max(8,I)}px`,o.style.visibility="visible"}function f(){o.style.display="none",s.items=[],s.selectedIndex=0,t.onClose()}function h(){return o.style.display!=="none"}function g(b){const y=b.composedPath?b.composedPath():[];if(y.length>0)return y.includes(n);const u=b.target;return!!(u&&n.contains(u))}function w(b){return b?b===n||n.contains(b)||e.contains(b)?!0:(b.getRootNode?b.getRootNode():null)===e:!1}function C(b){if(!s.items.length)return;const y=s.items.length-1;s.selectedIndex=Math.max(0,Math.min(y,s.selectedIndex+b)),p()}function S(){const b=s.items[s.selectedIndex];b&&t.onSelect(b)}function v(){return s.items[s.selectedIndex]}return{show:m,hide:f,isOpen:h,isEventInside:g,isNodeInside:w,moveSelection:C,selectCurrent:S,getSelected:v}}function He(t,n,e=re()){const r=[];let o=!1,a=0,l="idle",i=null,s=null;const d=new Set;function p(){return{status:l,running:o,items:r.map(y=>({...y})),error:i,canRetry:!o&&l==="failed"&&!!r.length&&!r[0].sent&&!r[0].attachmentAttempted&&r[0].href===P()}}function m(){e.setQueuePending(r.length);for(const y of d)y(p())}async function f(){if(!(o||!r.length||l==="failed"||l==="cancelled")){if(!e.tryAcquire("queue")){l="waiting",m();return}o=!0,s=new AbortController;try{for(;r.length;){const y=r[0];await me(t,n,y,"overwrite",s.signal,u=>{l=u,u==="uploading"&&(y.attachmentAttempted=!0),u==="sending"&&(y.preparedContent=y.content),m()},()=>{y.sent=!0},{timeoutMs:18e5,startTimeoutMs:15e3,pollMs:200},y.preparedContent,y.href),r.shift(),m()}l="idle"}catch(y){const u=y instanceof Error&&y.message==="CONVERSATION_CHANGED";l=s.signal.aborted&&!u?"cancelled":"failed",i=u?"CONVERSATION_CHANGED":s.signal.aborted?"QUEUE_CANCELLED":y instanceof Error?y.message:"EXECUTION_FAILED",i==="SEND_FAILED"&&r[0]&&(r[0].sent=!1),s.signal.aborted&&!u&&!r[0]?.sent&&r.shift()?.attachmentAttempted&&(i="QUEUE_CANCELLED_ATTACHMENTS")}finally{o=!1,s=null,m(),e.release()}}}function h(y){return j()?s?.signal.aborted?!1:(r.push({...y,id:crypto.randomUUID(),sent:!1,attachmentAttempted:!1,preparedContent:"",href:P()}),(l==="cancelled"||l==="failed")&&r.length===1&&(l="idle",i=null),m(),f(),!0):(i="CONVERSATION_REQUIRED",o||(l="failed"),m(),!1)}function g(y){const u=r.findIndex(T=>T.id===y);u<0||o&&u===0||(r.splice(u,1),(!r.length||u===0)&&(l="idle",i=null),m(),f())}function w(){p().canRetry&&(l="idle",i=null,f())}function C(){a+=1,s?.abort(),o?r.splice(1):r.splice(0),l="cancelled",i="QUEUE_CANCELLED",m()}function S(){a+=1,s?.abort(new Error("CONVERSATION_CHANGED")),r.length&&(l="failed",i="CONVERSATION_CHANGED"),m()}function v(){o||r.length||(i=null,l="idle",m())}function b(y){return d.add(y),y(p()),()=>{d.delete(y)}}return e.subscribe(()=>{f()}),{enqueue:h,flush:f,size:()=>r.length,getSnapshot:p,getCancellationVersion:()=>a,subscribe:b,remove:g,retry:w,cancel:C,stopForNavigation:S,clearError:v}}const Fe=':host{all:initial;position:fixed;top:20px;right:20px;z-index:2147483646;color-scheme:light}:host([hidden]){display:none}*{box-sizing:border-box}[hidden]{display:none!important}section{width:340px;max-width:calc(100vw - 40px);max-height:calc(100vh - 40px);overflow:auto;border:1px solid #bcc7ca;border-radius:6px;background:#f2f4f3;color:#1c272c;box-shadow:0 16px 40px #1c272c2e;font:12.5px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-synthesis:none;scrollbar-color:rgba(95,110,117,.3) transparent;scrollbar-width:thin}header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 10px 11px 14px;border-bottom:1px solid #d9dfe1;background:#fbfcfc}.title{font-size:13px;font-weight:650;letter-spacing:-.01em}.body{display:flex;flex-direction:column;gap:10px;padding:12px 14px 14px}p{margin:0}.status{display:flex;align-items:center;gap:7px;min-height:24px;color:#6f7c82;font-size:9.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase}.count{color:#1c272c;letter-spacing:0}.state{display:inline-flex;align-items:center;gap:6px;margin-left:auto;padding:3px 8px;border:1px solid #cfd6d8;border-radius:4px;color:#46555c;background:#fff;font-size:10.5px;letter-spacing:0;text-transform:none}.state:before{content:"";width:6px;height:6px;border-radius:999px;background:#879297}.state[data-tone=active]{color:#426c7a;border-color:#b8c8ce;background:#eef3f5}.state[data-tone=active]:before{background:#527d8c}.state[data-tone=done]{color:#3f6954;border-color:#b5c9be;background:#eef4f0}.state[data-tone=done]:before{background:#4f7662}.state[data-tone=error]{color:#be123c;border-color:#fda4af;background:#fff1f2}.state[data-tone=error]:before{background:#be123c}.message{padding:8px 10px;border:1px solid #cfd6d8;border-radius:4px;color:#46555c;background:#fff;font-size:11.5px;line-height:1.5;overflow-wrap:anywhere}.message[data-tone=error]{color:#be123c;border-color:#fda4af;background:#fff1f2}ol{display:flex;flex-direction:column;gap:6px;list-style:none;padding:0;margin:0;max-height:240px;overflow-y:auto;scrollbar-color:rgba(95,110,117,.3) transparent;scrollbar-width:thin}li{display:grid;grid-template-columns:minmax(0,1fr) auto;-moz-column-gap:8px;column-gap:8px;align-items:start;flex:0 0 auto;padding:8px 6px 8px 10px;border:1px solid #cfd6d8;border-left-width:3px;border-radius:5px;background:#fff;box-shadow:0 1px 2px #1420250f}li[data-current=true]{border-left-color:#527d8c}li p{padding-top:2px;white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.sent{grid-column:1;margin-top:3px;color:#6f7c82;font-size:10.5px;font-weight:500}button{font:inherit;cursor:pointer}button:focus-visible{outline:2px solid #527d8c;outline-offset:2px}.toggle{padding:3px 6px;border:0;border-radius:3px;color:#6f7c82;background:transparent;font-size:10.5px;font-weight:600;transition:color .14s ease,background .14s ease}.toggle:hover{color:#1c272c;background:#edf2f3}.remove{display:grid;grid-column:2;grid-row:1;width:24px;height:24px;place-items:center;padding:0;border:0;border-radius:3px;color:#6f7c82;background:transparent;font-size:15px;line-height:1;transition:color .14s ease,background .14s ease}.remove:hover{color:#1c272c;background:#edf2f3}.actions{display:flex;flex-wrap:wrap;gap:8px}.actions button{padding:7px 11px;border:1px solid #cfd6d8;border-radius:4px;color:#46555c;background:#fff;font-size:11px;font-weight:600;transition:border-color .14s ease,color .14s ease,background .14s ease}.actions button:hover{border-color:#9eb1b8;color:#426c7a;background:#edf2f3}.actions .retry{border-color:#527d8c;color:#f7fafb;background:#527d8c}.actions .retry:hover{border-color:#426c7a;color:#f7fafb;background:#426c7a}button:disabled{opacity:.45;cursor:default}.remove:disabled:hover{color:#6f7c82;background:transparent}@media(prefers-reduced-motion:reduce){button{transition:none}}';function Be(t,n){const e=document.createElement("div");e.id="promptchain-execution";const r=e.attachShadow({mode:"closed"}),o=document.createElement("style");o.textContent=Fe,r.append(o);const a=document.createElement("section");a.setAttribute("aria-label","Prompt Chain 执行状态"),a.innerHTML='<header><span class="title">Prompt Chain</span><button type="button" class="toggle" aria-expanded="true">收起</button></header><div class="body"><div class="status" role="status" aria-live="polite"><span class="kind"></span><span class="count"></span><span class="state"></span></div><p class="message" role="alert"></p><ol></ol><div class="actions"><button type="button" class="retry">重试</button><button type="button" class="cancel">取消队列</button><button type="button" class="cancel-chain">取消流程</button><button type="button" class="dismiss">关闭</button></div></div>',r.append(a),document.documentElement.append(e);const l=a.querySelector(".status"),i=a.querySelector(".kind"),s=a.querySelector(".count"),d=a.querySelector(".state"),p=a.querySelector(".message"),m=a.querySelector("ol"),f=a.querySelector(".retry"),h=a.querySelector(".cancel"),g=a.querySelector(".cancel-chain"),w=a.querySelector(".dismiss"),C=a.querySelector(".toggle"),S=a.querySelector(".body");let v="";function b(){const u=t.getSnapshot(),T=u.error==="QUEUE_CANCELLED"&&!u.items.length?null:u.error,k=n.getSnapshot(),I=k.totalSteps&&k.error!=="CHAIN_CANCELLED"?k:null,N=n.isRunning(),q={idle:"就绪",waiting:"等待中",uploading:"正在上传",sending:"正在发送",awaiting_response:"正在回答",failed:"已停止",cancelled:"已取消",starting:"正在启动",delayed:"等待中",completed:"已完成",error:"已停止"},V={QUEUE_CANCELLED:"",CHAIN_CANCELLED:"",QUEUE_CANCELLED_ATTACHMENTS:"聊天框中可能仍有附件。",CONVERSATION_REQUIRED:"请先发送第一条消息，再运行流程。",CONVERSATION_CHANGED:"请回到该流程原来的对话后重试。",COMPOSER_CHANGED:"请先清空草稿，再重试。",COMPOSER_BUSY:"请先完成或取消当前队列。",INPUT_NOT_FOUND:"找不到聊天输入框。",SEND_FAILED:"发送失败。",SEND_UNCERTAIN:"消息可能已经发送，请先核对对话。",MODEL_IDLE_TIMEOUT:"等待对话空闲已超过 30 分钟。",RESPONSE_TIMEOUT:"回答超过 30 分钟仍未完成。",GENERATION_START_TIMEOUT:"没有检测到回答，请先核对消息是否已发送。",ATTACHMENT_UPLOAD_TIMEOUT:"无法确认上传，请检查输入框中的附件。",ATTACHMENT_UPLOAD_FAILED:"上传失败。",ATTACHMENT_NOT_FOUND:"提示词缺少附件，请重新添加。",EXECUTION_FAILED:"执行失败。"};e.hidden=!u.items.length&&!v&&!I&&!T;const O=N&&I?{kind:"流程",count:`${I.stepIndex+1} / ${I.totalSteps}`,state:I.status}:u.items.length?{kind:"队列",count:String(u.items.length),state:u.status}:T?{kind:"队列",count:"",state:u.status}:I?{kind:"流程",count:"",state:I.status}:null;l.hidden=!O,i.textContent=O?.kind??"",s.textContent=O?.count??"",d.textContent=O?q[O.state]||O.state:"",d.dataset.tone=O?O.state==="failed"||O.state==="error"?"error":O.state==="completed"?"done":["starting","uploading","sending","awaiting_response"].includes(O.state)?"active":"":"";const B=T||(u.items.length?void 0:I?.error),x=B?.split(/[: ]/,1)[0],c=B?V[x||""]??B.replaceAll("_"," "):"",E=u.items[0]?.attachmentAttempted&&!u.items[0].sent&&u.status==="failed"?"请清除输入框中的附件，移除此项后重新加入队列。":B?.includes("可能已经发送")&&!c.includes("可能已经发送")?"上一条提示词可能已经发送。":"";p.textContent=v||[c,E].filter(Boolean).join(" "),p.dataset.tone=!v&&(u.status==="failed"||I?.status==="error")?"error":"",p.hidden=!p.textContent,m.replaceChildren();for(const A of u.items){const M=document.createElement("li");M.dataset.current=String(u.running&&A.id===u.items[0]?.id);const _=document.createElement("p");if(_.textContent=A.content||"附件",_.title=A.content,M.append(_),A.sent){const L=document.createElement("span");L.className="sent",L.textContent=u.running?"已发送":"移除此项后继续",M.append(L)}const D=document.createElement("button");D.type="button",D.className="remove",D.textContent="×",D.disabled=u.running&&A.id===u.items[0]?.id,D.setAttribute("aria-label",`移除排队提示词：${A.content.slice(0,80)}`),D.addEventListener("click",L=>{L.isTrusted&&t.remove(A.id)}),M.append(D),m.append(M)}m.hidden=!u.items.length,f.hidden=!u.canRetry,h.hidden=!u.items.length,g.hidden=!N,w.hidden=u.items.length>0||N}f.addEventListener("click",u=>{u.isTrusted&&(v="",t.retry())}),h.addEventListener("click",u=>{u.isTrusted&&(v="",t.cancel())}),g.addEventListener("click",u=>{u.isTrusted&&(v="正在取消…",n.cancel(),b())}),w.addEventListener("click",u=>{u.isTrusted&&(v="",t.clearError(),e.hidden=!0)}),C.addEventListener("click",u=>{u.isTrusted&&(S.hidden=!S.hidden,C.textContent=S.hidden?"展开":"收起",C.setAttribute("aria-expanded",String(!S.hidden)))}),t.subscribe(b),n.subscribe(u=>{["completed","error","cancelled"].includes(u.status)&&(v=""),b()});function y(u){v=u,S.hidden=!1,C.textContent="收起",C.setAttribute("aria-expanded","true"),b()}return{showMessage:y}}const Ge=1500;function Ve(t,n,e=re()){return createChainRunner({readUrl:P,publish:state=>{try{chrome.runtime.sendMessage({type:"CHAIN_PROGRESS",payload:state}).catch(()=>{})}catch{}}})}function Qe(t){return t==="chatgpt"||t==="deepseek"||t==="gemini"?t:"other"}function We(t){globalThis.PromptChainSiteAdapter=t;let n={},e=!1,r=null,o=0,a=!1,l=!1,i=null,s=0,d=!1,p=P();const m=Oe({onSave:async c=>c.id?qe(c.id,c.title,c.content):Re(c.title,c.content),onDelete:async c=>Me(c)}),f=Ue({onSelect:c=>{const E=c.kind==="chain"?w.getCancellationVersion():null;(async()=>{const A=P(),M=t.getInputElement(),_=M?U(M):null;if(!await v()||E!==null&&E!==w.getCancellationVersion())return;if(A!==P()){C.showMessage("对话已切换，请重新选择提示词。");return}const D=t.getInputElement();if(!D||D!==M||U(D)!==_){C.showMessage("草稿已变化，请重新选择提示词。");return}if(c.kind==="prompt"){const L=await se(t,h,c.content,c.attachments||[],"append",!1,A);if(!L.ok){C.showMessage(L.reason||"无法插入提示词。");return}f.hide(),Ne(c.id,Qe(t.id)).catch(()=>{});return}f.hide(),!w.isRunning()&&chrome.runtime.sendMessage({type:"PC_RUN_NATIVE",payload:{steps:c.steps,chainId:c.id,expectedHref:P()}}).then(r=>{if(!r?.ok)C.showMessage(r?.error||"无法启动流程")})})()},onEdit:c=>{f.hide(),c.kind==="prompt"&&m.open({id:c.id,title:c.title,content:c.content,attachmentCount:c.attachments.length})},onCreate:()=>{f.hide(),m.open({title:"",content:""})},onClose:()=>{s+=1}}),h=re(),g=He(t,()=>t.getInputElement(),h),w=Ve(t,()=>t.getInputElement(),h),C=Be(g,w);function S(){const c=P();c!==p&&(p=c,g.stopForNavigation(),w.stopForNavigation(),f.hide(),s+=1);const E=t.getInputElement();E!==i&&(i=E,E&&!d&&(d=!0,chrome.runtime.sendMessage({type:"TEXTAREA_READY"})))}function v(){if(e)return Promise.resolve(!0);if(r)return r;const c=o;return r=(async()=>{try{const E=await Te();return c!==o?e:(n=E,e=!0,a&&C.showMessage(""),a=!1,!0)}catch{return c===o&&(e=!1,a=!0,C.showMessage("连接失败，请重试或刷新页面。")),!1}finally{c===o&&(r=null)}})(),r}function b(c){return{x:c.left,top:c.top,bottom:c.bottom}}async function y(){const c=i||t.getInputElement();if(!c){s+=1,f.hide();return}const E=we(c);if(!E){s+=1,f.hide();return}const A=E.query||"",M=++s;try{const[_,D]=await Promise.all([ke(A),Ie(A)]);if(M!==s)return;const L=[..._.map(F=>({kind:"prompt",id:F.id,title:F.title,content:F.content,attachments:F.attachments||[]})),...D.map(F=>({kind:"chain",id:F.id,title:F.title,steps:F.steps}))],K=A?`$${A}`:"";f.show(b(E.rect),L,K),l&&C.showMessage(""),l=!1}catch{if(M!==s)return;f.hide(),l=!0,C.showMessage("连接失败，请重试或刷新页面。")}}function u(c){const E=c.target;if(!E)return null;const A=i||t.getInputElement();return A&&(E===A||A instanceof HTMLElement&&A.contains(E))?A:null}function T(c){if(c.isTrusted){if(f.isOpen()&&!c.isComposing&&c.keyCode!==229&&!c.shiftKey&&!c.metaKey&&!c.ctrlKey&&!c.altKey){if(c.key==="ArrowDown"){f.moveSelection(1),c.preventDefault(),c.stopImmediatePropagation();return}if(c.key==="ArrowUp"){f.moveSelection(-1),c.preventDefault(),c.stopImmediatePropagation();return}if((c.key==="Tab"||c.key==="Enter")&&f.getSelected()){f.selectCurrent(),c.preventDefault(),c.stopImmediatePropagation();return}if(c.key==="Escape"){f.hide(),c.preventDefault(),c.stopImmediatePropagation();return}c.key==="Enter"&&f.hide()}if(c.key==="Enter"&&!c.shiftKey&&!c.isComposing){const E=u(c);if(!E||!t.isGenerating())return;const A=U(E);if(!A.trim())return;c.preventDefault();const M=P(),_=g.getCancellationVersion();v().then(D=>{if(D&&_===g.getCancellationVersion()){if(P()!==M||t.getInputElement()!==E||U(E)!==A){C.showMessage("草稿已变化，请再次按 Enter 加入队列。");return}Y(E,""),g.enqueue({content:A})||(Y(E,A),C.showMessage(g.getSnapshot().error==="CONVERSATION_REQUIRED"?"请先发送第一条消息，再运行流程。":"正在取消，请稍后重试。"))}})}}}function k(c){!c.isTrusted||!u(c)||y()}function I(){S()}function N(c){if(!c.isTrusted||!f.isOpen())return;const E=i||t.getInputElement(),A=c.target;E instanceof HTMLElement&&A&&E.contains(A)||f.isEventInside(c)||f.hide()}function q(){const c=i||t.getInputElement();if(!c)return!1;const E=document.activeElement;return E?!!(E===c||c instanceof HTMLElement&&c.contains(E)):!1}function V(c){if(!f.isOpen())return;const E=c.relatedTarget;f.isNodeInside(E)||setTimeout(()=>{if(!f.isOpen()||q())return;const A=document.activeElement;f.isNodeInside(A)||f.hide()},0)}async function O({content:c,attachments:E=[],expectedHref:A},M){if(!c&&E.length===0)return{ok:!1,sendAttempted:!1,reason:"没有提示词文字或附件。"};const _=t.getInputElement(),D=_?U(_):null;if(!await v())return{ok:!1,sendAttempted:!1,reason:"页面连接失败，请刷新后重试。"};const L=t.getInputElement();if(L!==_||L&&U(L)!==D)return{ok:!1,sendAttempted:!1,reason:"草稿已变化，请重试。"};const K="append",F=!c||c.endsWith(`
`)?c||"":c+`
`;return se(t,h,F,E,K,M,A)}const B={PC_ACQUIRE:async()=>({acquired:h.getOwner()==="supervisor"||h.tryAcquire("supervisor")}),PC_RELEASE:async()=>{if(h.getOwner()==="supervisor")h.release();return{}},COMPAT_CHECK:async()=>({ready:!!t.getInputElement()}),INJECT_PROMPT:c=>O(c,!1),INSERT_AND_SEND_PROMPT:c=>O(c,!0),RUN_CHAIN:async({steps:c,expectedHref:E})=>{const r=await chrome.runtime.sendMessage({type:"PC_RUN_NATIVE",payload:{steps:c,expectedHref:E}});return r?.ok?{ok:true}:{ok:false,reason:r?.error||"无法启动流程"}},CANCEL_CHAIN:async()=>{w.cancel()}};new MutationObserver(()=>S()).observe(document.documentElement,{childList:!0,subtree:!0}),window.addEventListener("popstate",S),window.addEventListener("hashchange",S),document.addEventListener("input",k,!0),document.addEventListener("keydown",T,!0),document.addEventListener("focusin",I,!0),document.addEventListener("focusout",V,!0),document.addEventListener("mousedown",N,!0),chrome.runtime.onMessage.addListener(ge(B)),chrome.storage.onChanged.addListener((c,E)=>{E==="local"&&c.langqueue_settings&&(o+=1,e=!1,r=null,v())}),S(),v()}class oe{async waitForIdle(n){const e=n?.timeoutMs??18e5,r=n?.pollMs??500,o=Date.now();for(;Date.now()-o<e;){const a=this.getInputElement();if(!this.isGenerating()&&Z(a))return!0;await new Promise(l=>setTimeout(l,r))}return!1}}function z(t){return t.replace(/\(\d+\)(?=\.[^.]*$|$)/,"")}class Ye extends oe{id="chatgpt";uploadAttempt=null;matchesAdapterDomain(){return/chatgpt\.com|chat\.openai\.com/.test(window.location.hostname)}getInputElement(){if(globalThis.PromptFlowSupervisor)return PromptFlowSupervisor.composer();const n=['div[contenteditable="true"][role="textbox"]','div[contenteditable="true"][data-testid*="prompt" i]','div[contenteditable="true"]'];for(const i of n){const d=Array.from(document.querySelectorAll(i)).find(p=>R(p));if(d)return d}const e=document.getElementById("prompt-textarea");if(e&&e.tagName==="TEXTAREA"&&R(e))return e;const o=Array.from(document.querySelectorAll('form textarea:not([readonly]):not([disabled]):not([class*="fallbackTextarea"])')).find(i=>i.tagName==="TEXTAREA"&&R(i));if(o)return o;const l=Array.from(document.querySelectorAll("textarea")).find(i=>i.tagName==="TEXTAREA"&&R(i));return l||null}isGenerating(){if(globalThis.PromptFlowSupervisor)return PromptFlowSupervisor.generating();const n=e=>Array.from(document.querySelectorAll(e)).some(R);return!!(n('button[data-testid="stop-button"]')||n('button[aria-label="Stop streaming"]')||n(".streaming-animation")||this.getInputElement()?.closest("form")?.querySelector('button[aria-label="Stop"]')||n('[role="status"][aria-busy="true"], [data-talvt-turn-state="in_progress"]'))}getSendButton(n){if(globalThis.PromptFlowSupervisor)return PromptFlowSupervisor.sendBtn(n||this.getInputElement());const e=n||this.getInputElement();return e?ne(e,["button#composer-submit-button","button.composer-submit-btn",'button[data-testid="send-button"]','button[aria-label="Send message"]','button[aria-label="Send"]']):null}clickSend(n){const e=this.getSendButton(n);if(!e)return!1;try{return e.click(),!0}catch{throw new Error("This may have been sent. Check the chat before you send it again.")}}async attachFiles(n){if(globalThis.PromptChainNativeFiles)return PromptChainNativeFiles.attach(n);if(this.uploadAttempt=null,!Array.isArray(n)||n.length===0)return{ok:!0};const e=this.getInputElement(),r=ee(e,['input[type="file"][aria-label="Attach files"]']);if(!r)return{ok:!1,error:"Couldn't find where to upload files on this page. Attach them yourself."};const o=e?.closest("form[data-chatgpt-composer]");if(!e||!o)return{ok:!1,error:"Can't confirm uploads on this page. Attach the files yourself."};const a=new Map;for(const i of o.querySelectorAll('button[aria-label^="Remove "]')){const s=z(i.getAttribute("aria-label").slice(7));a.set(s,(a.get(s)||0)+1)}this.uploadAttempt={input:e,form:o,href:location.href,files:[...n],counts:a};const l=te(r,n);return l.ok||(this.uploadAttempt=null),l}async waitForUploadsComplete(n){if(globalThis.PromptChainNativeFiles)return PromptChainNativeFiles.wait(n);const e=this.uploadAttempt,r=n?.files;if(!e||!r?.length||r.length!==e.files.length||r.some((l,i)=>l!==e.files[i]))return!1;const o=new Map(e.counts);for(const l of r){const i=z(l.name);o.set(i,(o.get(i)||0)+1)}const a=Date.now();for(;Date.now()-a<(n?.timeoutMs??6e4);){if(this.uploadAttempt!==e||location.href!==e.href||!e.form.isConnected||!e.input.isConnected||this.getInputElement()!==e.input||e.input.closest("form[data-chatgpt-composer]")!==e.form)return this.uploadAttempt===e&&(this.uploadAttempt=null),!1;const l=new Map;for(const s of e.form.querySelectorAll('button[aria-label^="Remove "]')){const d=s.parentElement;if(!d?.getClientRects().length)continue;const p=s.getAttribute("aria-label").slice(7),m=[d,...d.querySelectorAll("[aria-label]")].some(g=>g.getAttribute("aria-label")===p&&g.getClientRects().length>0),f=Array.from(d.querySelectorAll("img")).every(g=>g.complete&&g.naturalWidth>0&&g.naturalHeight>0);if(!m||!f)continue;const h=z(p);l.set(h,(l.get(h)||0)+1)}const i=Array.from(e.form.querySelectorAll('[aria-busy="true"], [aria-label*="Uploading" i], [class*="animate-spin"], [class*="upload" i][class*="progress" i]')).some(s=>s.getClientRects().length>0);if(r.every(s=>(l.get(z(s.name))||0)>=o.get(z(s.name)))&&!i&&this.getSendButton(e.input))return this.uploadAttempt=null,!0;await new Promise(s=>setTimeout(s,n?.pollMs??200))}return this.uploadAttempt===e&&(this.uploadAttempt=null),!1}}function je(){return new Ye}function Xe(){return createDeepSeekAdapter()}class Ze extends oe{id="gemini";uploadAttempt=null;matchesAdapterDomain(){return/gemini\.google\.com/.test(window.location.hostname)}getInputElement(){const e=Array.from(document.querySelectorAll('div[contenteditable="true"]')).filter(a=>R(a));if(e.length===1)return e[0];if(e.length>1){const a=["gemini","prompt","message","chat"],l=e.find(i=>{const s=(i.getAttribute("aria-label")||"").toLowerCase();return a.some(d=>s.includes(d))});if(l)return l}return Array.from(document.querySelectorAll("textarea")).find(a=>R(a))??null}isGenerating(){return!!(document.querySelector('button[aria-label="Stop response"]')||document.querySelector(".send-button.stop"))}getSendButton(n){const e=n||this.getInputElement();return e?ne(e,['button[aria-label="Send message"]',"button.send-button"]):null}clickSend(n){const e=this.getSendButton(n);if(!e)return!1;try{return e.click(),!0}catch{throw new Error("This may have been sent. Check the chat before you send it again.")}}async attachFiles(n){if(!Array.isArray(n)||n.length===0)return{ok:!0};this.uploadAttempt=null;const e=this.getInputElement(),r=ee(e,[]),o={ok:!1,error:"Couldn't find where to upload files on this page. Attach them yourself."},a=e?.closest("input-area-v2");if(!e||a?.localName!=="input-area-v2")return o;if(r)return this.assignUploadFiles(r,n,e,a);if((e.closest("form")||e.parentElement)?.querySelectorAll('input[type="file"]').length)return o;const i=a.querySelectorAll('button[aria-label="Upload & tools"][aria-haspopup="menu"]');if(i.length!==1||!fe(i[0]))return o;const s=i[0],d=location.href;if(!e.isConnected||!a.isConnected)return o;let p=!1;if(s.getAttribute("aria-expanded")!=="true"){if(Array.from(document.querySelectorAll('[role="menu"]')).some(R))return o;if(document.visibilityState==="hidden")return{ok:!1,error:"Gemini uploads need this tab on screen. Show the tab, then retry."};s.click(),p=!0}const m=Date.now();for(;Date.now()-m<1500;){if(location.href!==d||!e.isConnected||this.getInputElement()!==e||e.closest("input-area-v2")!==a||!s.isConnected)return o;const f=Array.from(document.querySelectorAll('[role="menu"]')).filter(R),h=f.filter(w=>w.getAttribute("aria-label")==="Menu options"),g=f.filter(w=>w.getAttribute("aria-label")==="Upload file options");if(f.some(w=>!h.includes(w)&&!g.includes(w))||h.length>1||g.length>1)return o;if(h.length===1&&g.length===1){if(!h[0].contains(g[0])||s.getAttribute("aria-expanded")!=="true")return o;const w=g[0].querySelectorAll('images-files-uploader > input.hidden-file-input[type="file"]');if(w.length>1)return o;if(w.length===1)return W(w[0])?this.assignUploadFiles(w[0],n,e,a):o}await new Promise(w=>setTimeout(w,50))}return p&&s.getAttribute("aria-expanded")==="true"&&s.click(),o}assignUploadFiles(n,e,r,o){if(!r.isConnected||!o.isConnected||this.getInputElement()!==r)return{ok:!1,error:"The chat box changed before the upload started. Try again."};const a=new Map;for(const i of o.querySelectorAll("uploader-file-preview")){const s=this.getUploadFilename(i);if(!s)return{ok:!1,error:"A file in the chat box is still uploading. Wait for it or remove it, then try again."};a.set(s,(a.get(s)||0)+1)}this.uploadAttempt={composer:r,area:o,href:location.href,files:[...e],counts:a};const l=te(n,e);return l.ok||(this.uploadAttempt=null),l}getUploadFilename(n){const r=(n.querySelector(".file-preview-container[aria-describedby]")?.getAttribute("aria-describedby")?.split(/\s+/)||[]).map(o=>document.getElementById(o)?.textContent?.trim()).filter(o=>!!o);return r.length===1?r[0]:null}async waitForUploadsComplete(n){const e=this.uploadAttempt,r=n?.files;if(!e||!r?.length||r.length!==e.files.length||r.some((l,i)=>l!==e.files[i]))return!1;const o=new Map(e.counts);for(const l of r)o.set(l.name,(o.get(l.name)||0)+1);const a=Date.now();for(;Date.now()-a<(n?.timeoutMs??6e4);){n?.guard?.();if(this.uploadAttempt!==e||location.href!==e.href||!e.composer.isConnected||!e.area.isConnected||this.getInputElement()!==e.composer||e.composer.closest("input-area-v2")!==e.area)return this.uploadAttempt===e&&(this.uploadAttempt=null),!1;if(Array.from(e.area.querySelectorAll('.gem-attachment-loading-error, gem-icon[fonticonname="error"]')).some(R))return this.uploadAttempt=null,!1;const i=new Map;for(const d of e.area.querySelectorAll("uploader-file-preview")){if(!R(d))continue;const p=this.getUploadFilename(d);if(!p)continue;const m=Array.from(d.querySelectorAll("gem-attachment .gem-attachment-text")).some(R)&&Array.from(d.querySelectorAll("gem-attachment .gem-attachment-extension-label")).some(R),f=Array.from(d.querySelectorAll('gem-media-attachment img.gem-attachment-style-img[alt="attachment"]')).some(h=>R(h)&&h.complete&&h.naturalWidth>0&&h.naturalHeight>0);(m||f)&&i.set(p,(i.get(p)||0)+1)}const s=Array.from(e.area.querySelectorAll('[aria-busy="true"], [aria-label*="Uploading" i], [class*="upload" i][class*="progress" i], [role="progressbar"], .gem-attachment-loading, mat-spinner, mat-progress-spinner')).some(R);if(r.every(d=>(i.get(d.name)||0)>=o.get(d.name))&&!s&&this.getSendButton(e.composer))return this.uploadAttempt=null,!0;await new Promise(d=>setTimeout(d,n?.pollMs??200))}return this.uploadAttempt===e&&(this.uploadAttempt=null),!1}}function Je(){return wrapGeminiUpload(new Ze)}const le="__langqueue_content_script__";function et(){if(window[le])return;window[le]=!0;const n=[je(),Xe(),Je()].find(e=>e.matchesAdapterDomain());n&&We(n)}et();
