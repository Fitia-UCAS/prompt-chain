(function (root) {
  'use strict';
  const MAX_FILE_BYTES = Number.MAX_SAFE_INTEGER; // No extension-side file size limit; the website decides.
  const ACTIVE = new Set(['running', 'paused']);
  const id = () => crypto.randomUUID();
  const norm = value => String(value || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
  const echoNorm = value => norm(value).replace(/\s+/g, ' ');
  const int = (value, fallback, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(0, Math.floor(Number(value)))) : fallback;
  function firstSentence(text, filename = '') {
    const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
      const names = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
      if (code[0] !== '#') return names[code.toLowerCase()] || entity;
      const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2),16) : Number(code.slice(1));
      return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '';
    });
    const lines = String(text || '').replace(/\r\n?/g,'\n').split('\n');
    for (const raw of lines) {
      const line = decode(raw).trim().replace(/^\*\*|\*\*$/g,'').trim();
      if (!line || /^[-*_]{3,}$/.test(line) || /^#{1,6}\s/.test(line) || /^(?:name|description|tags|version)\s*:/i.test(line.replace(/\*\*/g,'')) || /^(`{3,}|~{3,})/.test(line)) continue;
      const plain = line.replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/\*\*|__/g,'').replace(/^[_*>`]+\s*|[_*`]+$/g,'').replace(/\\([~*_`])/g,'$1').trim();
      if (!plain) continue;
      return (plain.match(/^.*?(?:[。！？!?；;：:]|\.(?=\s|$))(?:[」』”"])?/)?.[0] || plain).slice(0,180);
    }
    return filename || '提示词';
  }
  function fileRef(value) {
    if (!value) return null;
    if (!value.id || !value.name || !Number.isSafeInteger(value.size) || value.size < 1) throw new Error('附件资料无效（编号、名称或大小）');
    return {id: String(value.id), name: String(value.name), size: value.size, mimeType: String(value.mimeType || 'application/octet-stream')};
  }
  function step(value = {}) {
    const text = String(value.text ?? value.content ?? '');
    if (text.length > 500000) throw new Error('单步文字过长，请改用附件');
    const attachments = (Array.isArray(value.attachments) ? value.attachments : value.attachment ? [value.attachment] : []).filter(Boolean).map(fileRef);
    const attachment = attachments[0] || null; // Legacy reader compatibility.
    const missingAttachments = (Array.isArray(value.missingAttachments) ? value.missingAttachments : value.missingAttachment ? [value.missingAttachment] : []).filter(v=>v?.name).map(v=>({name:String(v.name),mimeType:String(v.mimeType||'')}));
    const automatic = value.autoTitle ?? (!!value.sourceTurn || !value.title);
    return {
      id: value.id || id(), title: automatic ? firstSentence(text, attachment?.name || missingAttachments[0]?.name) : String(value.title || '提示词').replace(/^第\s*\d+\s*[轮步]\s*·\s*/, '').slice(0, 180), autoTitle:automatic, text, attachment, attachments,
      enabled: value.enabled !== false, sourceTurn: String(value.sourceTurn || ''), sourceText:String(value.sourceText||'').slice(0,500000), referenceReply: String(value.referenceReply || '').slice(0, 12000),
      missingAttachment: missingAttachments[0] || null, missingAttachments,
      repeat: {count: int(value.repeat?.count, 0, 100), until: String(value.repeat?.until || '').slice(0, 200), text: String(value.repeat?.text || '继续'), max: int(value.repeat?.max, 20, 100) || 20}
    };
  }
  function flow(value = {}) {
    if (!Array.isArray(value.steps) || value.steps.length > 300) throw new Error('流程需要有效的步骤列表，最多 300 步');
    return {id: value.id || id(), title: String(value.title || '未命名流程').slice(0, 180), description: String(value.description || '').slice(0, 2000),
      steps: value.steps.map(step), importNotes: Array.isArray(value.importNotes) ? value.importNotes.map(String).slice(0, 50) : [], createdAt: value.createdAt || Date.now(), updatedAt: Date.now()};
  }
  function validateFlow(value) {
    const f = flow(value);
    f.steps = f.steps.filter(s => s.enabled);
    if (!f.steps.length) throw new Error('先添加至少一个步骤');
    f.steps.forEach((s, i) => {
      if (s.missingAttachments.length) throw new Error(`第 ${i + 1} 步缺少附件：${s.missingAttachments.map(ref=>ref.name).join('、')}`);
      if (!s.text.trim() && !s.attachments.length) throw new Error(`第 ${i + 1} 步没有文字或附件`);
      const names=new Set();for(const ref of s.attachments){if(names.has(ref.name))throw new Error(`第 ${i+1} 步附件同名，无法安全识别：${ref.name}`);names.add(ref.name);}
    });
    return f;
  }
  const platforms = root.PromptChainPlatforms || (typeof require === 'function' ? require('./platforms.js') : null);
  const allowedUrl = value => !!platforms.providerFor(value);
  const conversationPath = platforms.conversationPath;
  const temporaryConversation = value => !!platforms.temporaryScope(value);
  const sameChat = platforms.sameChat;
  const comparison=value=>norm(value).normalize('NFKC').replace(/[\p{Cf}\u00AD\uFE0E\uFE0F]/gu,'');
  function semanticText(value){
    const text=comparison(value).replace(/[\t\u00a0 ]+/g,' ').replace(/ *\n */g,'\n');
    return text.replace(/([^\n])\n+(?=([^\n]))/g,(line,before,after)=>before+(/[,.;:!?，。；：！？]/u.test(before)||(/[\u2e80-\u9fff]/u.test(before)&&/[\u2e80-\u9fff]/u.test(after))?'':' ')).trim();
  }
  function fingerprint(value){let hash=2166136261;for(const c of semanticText(value)){hash=Math.imul(hash^c.codePointAt(0),16777619);}return(hash>>>0).toString(36);}
  const projected=new Map();
  function deliveryTexts(value){
    const raw=String(value||'');if(projected.has(raw))return projected.get(raw);
    const names={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',hellip:'…'};
    const decode=text=>String(text||'').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(all,code)=>{if(code[0]!=='#')return names[code.toLowerCase()]??all;const n=code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):Number(code.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):all;});
    function walk(tokens){return(tokens||[]).map(token=>{
      if(token.type==='space'||token.type==='br')return'\n';
      if(token.type==='hr')return'';
      if(token.type==='code')return'\n'+token.text+'\n';
      if(token.type==='codespan')return token.text;
      if(token.type==='image')return'['+decode(token.text||'图片')+']';
      if(token.type==='list')return'\n'+token.items.map(item=>walk(item.tokens)).join('\n')+'\n';
      if(token.type==='table')return'\n'+[token.header,...token.rows].map(row=>row.map(cell=>walk(cell.tokens)).join(' ')).join('\n')+'\n';
      if(token.type==='html')return decode(token.text.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi,'\n').replace(/<[^>]*>/g,''));
      const text=token.tokens?walk(token.tokens):decode(token.text);
      return /^(paragraph|heading|blockquote)$/.test(token.type)?'\n'+text+'\n':text;
    }).join('');}
    let plain=raw;try{if(root.marked?.lexer)plain=walk(root.marked.lexer(raw));}catch{}
    const result=[...new Set([raw,plain].flatMap(text=>[semanticText(text),comparison(text).replace(/\s+/g,' ').trim()]).filter(Boolean))];projected.set(raw,result);if(projected.size>8)projected.delete(projected.keys().next().value);return result;
  }
  function deliveryWindow(snapshot,pending){
    if(!Array.isArray(pending.baselineMessages))return {ok:true};
    if(!pending.attemptedAt&&!pending.attempted)return {ok:false};
    const messages=snapshot.messages||[],before=pending.baselineMessages,userIndex=messages.findIndex(message=>message.key===snapshot.lastUser?.key);
    // A refreshed page may render only part of the history; report that so the
    // caller can fall back to the exact text of the newest user message.
    if(userIndex<0)return {ok:false,anchorMissing:true};
    if(!before.length)return {ok:messages.slice(0,userIndex+1).filter(message=>message.role==='user').length===1};
    if(before.some(message=>message.key===snapshot.lastUser.key))return {ok:false};
    const same=(a,b)=>a.role===b.role&&(a.key===b.key||[a.fingerprint,...(a.fingerprintAliases||[])].some(hash=>hash&&[b.fingerprint,...(b.fingerprintAliases||[])].includes(hash)));
    const anchor=before.at(-1),byKey=messages.findIndex(message=>message.role===anchor.role&&message.key===anchor.key);
    let anchors=byKey>=0?[byKey]:messages.map((message,index)=>same(anchor,message)?index:-1).filter(index=>index>=0);
    const ordinal=/^dom:(user|assistant):([a-z0-9]+):(\d+)$/.exec(anchor.key||'');
    if(byKey<0&&ordinal&&ordinal[1]===anchor.role&&ordinal[2]===anchor.fingerprint)anchors=anchors[Number(ordinal[3])-1]===undefined?[]:[anchors[Number(ordinal[3])-1]];
    if(anchors.length>1)anchors=anchors.filter(index=>{const context=before.slice(-Math.min(8,index+1,before.length));return context.length>=2&&context.every((message,offset)=>same(message,messages[index-context.length+1+offset]));});
    if(anchors.length!==1||userIndex<=anchors[0])return {ok:false,anchorMissing:anchors.length===0};
    return {ok:messages.slice(anchors[0]+1).filter(message=>message.role==='user').length===1};
  }
  function receiptText(snapshot, pending) {
    if (!pending.text) return {matched: true, mode: 'attachment-only'};
    const gemini = platforms.providerFor(snapshot.url || pending.url) === 'gemini';
    const layout = text => gemini ? text.replace(/\s*([《》「」『』【】〔〕〈〉—–])\s*/gu, '$1').replace(/([\u2e80-\u9fff])\s*([,:;!?])\s*/gu, '$1$2').replace(/([\u2e80-\u9fff])\s+(?=[\u2e80-\u9fff])/gu, '$1') : text;
    const expected = deliveryTexts(pending.text).map(layout);
    const seen = (snapshot.lastUser?.variants || [snapshot.lastUser?.text]).flatMap(text => [semanticText(text), comparison(text).replace(/\s+/g, ' ').trim()]).map(layout);
    const exact = expected.some(text => seen.includes(text));
    let commonPrefixLength = 0, matchedPrefixLength = 0;
    for (const text of seen) for (const full of expected) {
      const prefix = text.replace(/(?:…|\.{3})$/u, '').trim(); let length = 0;
      while (length < prefix.length && length < full.length && prefix[length] === full[length]) length++;
      commonPrefixLength = Math.max(commonPrefixLength, length);
      if (prefix.length >= 80 && full.length > prefix.length && length === prefix.length) matchedPrefixLength = Math.max(matchedPrefixLength, length);
    }
    const folded = snapshot.lastUser?.folded && (pending.attemptedAt || pending.attempted) && Array.isArray(pending.baselineMessages) && matchedPrefixLength >= 80;
    return {matched: exact || !!folded, mode: exact ? gemini ? 'gemini-layout' : 'exact' : folded ? 'folded-prefix' : 'mismatch', expectedLengths: expected.map(text => text.length), observedLengths: seen.map(text => text.length), commonPrefixLength, matchedPrefixLength};
  }
  function hasFileName(haystack,filename){
    const text=echoNorm(haystack),name=echoNorm(filename);
    if(!name)return false;
    const bad=ch=>!!ch&&/[\p{L}\p{N}_.\-]/u.test(ch);
    for(let from=0;;){
      const index=text.indexOf(name,from);
      if(index<0)return false;
      const before=index?text[index-1]:'',after=text[index+name.length]||'';
      if(!bad(before)&&!bad(after))return true;
      from=index+1;
    }
  }
  function receipt(snapshot, pending) {
    if(!Array.isArray(pending.baselineMessages)&&(pending.attemptedAt||pending.attempted)&&snapshot.messages){
      const anchor=snapshot.messages.find(message=>message.key===pending.baselineAssistantKey);
      if(anchor)pending={...pending,baselineMessages:[anchor]};
      else if(!pending.baselineUserKey&&!pending.baselineAssistantKey&&pending.url&&allowedUrl(pending.url)&&!conversationPath(pending.url))pending={...pending,baselineMessages:[]};
    }
    const user = snapshot?.lastUser;
    if (!user || user.key === pending.baselineUserKey) return false;
    const window=deliveryWindow(snapshot,pending),text=receiptText(snapshot,pending);
    // When a refreshed page renders only part of the history the baseline anchor
    // is gone. The newest user message still proves delivery if its text matches
    // and the user explicitly resumed after being asked to check the conversation.
    if(!window.ok&&!(window.anchorMissing&&text.matched&&pending.userConfirmed))return false;
    if(!text.matched)return false;
    const refs=pending.attachments?.length?pending.attachments:(pending.attachment?[pending.attachment]:[]);
    const aliases=pending.attachmentAliasMap||{};
    for(const ref of refs){
      const candidates=[ref.name,...(aliases[ref.id]||[]),...(refs.length===1?(pending.attachmentAliases||[]):[])].map(echoNorm).filter(Boolean);
      if(candidates.some(name=>hasFileName(user.filesText,name)))continue;
      // Images with unnamed previews retain the legacy single-image fallback only.
      if(refs.length!==1||!ref.mimeType?.startsWith('image/')||!pending.attachmentUploaded||!(pending.attemptedAt||pending.attempted)||user.imageCount!==1)return false;
    }
    return true;
  }
  function replyDecision(run, snapshot, now = Date.now()) {
    if (snapshot.error) return {type: 'pause', reason: snapshot.error};
    if (!sameChat(run.targetUrl, snapshot.url)) return {type: 'pause', reason: '目标页已离开锁定对话'};
    if (run.delivery?!receipt(snapshot,run.delivery):snapshot.lastUser?.key!==run.sentUserKey) return {type: 'pause', reason: '对话中出现了其他用户消息，请核对后恢复'};
    if (snapshot.generating) return {type:'wait',reason:'网页仍显示停止生成按钮',signature:'',since:0};
    if (snapshot.lastRole !== 'assistant' || !snapshot.assistant?.key) return {type:'wait',reason:'尚未识别到本轮新回答',signature:'',since:0};
    if (!norm(snapshot.assistant.text)) return {type:'wait',reason:'本轮回答正文仍为空',signature:'',since:0};
    if (snapshot.assistant.key === run.beforeAssistantKey) return {type:'wait',reason:'当前识别到的仍是发送前的旧回答',signature:'',since:0};
    const signature = snapshot.assistant.signature;
    if (signature !== run.quietSignature) return {type: 'wait', reason:'等待回答内容保持稳定', signature, since: now};
    const due = run.quietSince + 800;
    if (now < due) return {type: 'wait', reason:'等待回答内容保持稳定', signature, since: run.quietSince, due};
    const s = run.flow.steps[run.index], repeat = s.repeat;
    if (repeat.until && !snapshot.assistant.text.includes(repeat.until)) {
      return run.repeated >= repeat.max ? {type: 'pause', reason: `已续作 ${repeat.max} 次，仍未出现完成标记：${repeat.until}`} : {type: 'repeat', text: repeat.text};
    }
    if (!repeat.until && run.repeated < repeat.count) return {type: 'repeat', text: repeat.text};
    return {type: 'next'};
  }
  const api = {MAX_FILE_BYTES, ACTIVE, id, norm, echoNorm, semanticText, fingerprint, deliveryTexts, firstSentence, step, flow, fileRef, validateFlow, platforms, allowedUrl, conversationPath, temporaryConversation, sameChat, receiptText, receipt, replyDecision};
  root.PromptFlowModel = Object.assign(root.PromptFlowModel||{},api);
  if (typeof module !== 'undefined') module.exports = root.PromptFlowModel;
})(globalThis);
