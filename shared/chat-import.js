(function (root) {
  'use strict';
  const M = root.PromptFlowModel;
  const guessMime = name => /\.md$/i.test(name) ? 'text/markdown' : /\.(txt|log)$/i.test(name) ? 'text/plain' : /\.json$/i.test(name) ? 'application/json' : 'application/octet-stream';
  function fences(lines) {
    const outside = []; let marker = '', length = 0;
    for (let i = 0; i < lines.length; i++) {
      outside[i] = !marker;
      const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
      if (!match) continue;
      if (!marker) {marker = match[1][0]; length = match[1].length;}
      else if (match[1][0] === marker && match[1].length >= length && !match[2].trim()) marker = '';
    }
    return outside;
  }
  function label(value) {return value.replace(/^\[([\s\S]+)\]\((?:<[^>]+>|[^)]+)\)$/, '$1').replace(/\\([\[\]\\])/g, '$1');}
  function attachmentLine(line) {
    const match = /^- (File|Image)(?:\s*·\s*|:\s*)(.+)$/.exec(line);
    if (!match) return null;
    const facts = match[2].split(' · '), name = label(facts.shift().trim());
    return {name, mimeType: facts.find(f => /^[\w.+-]+\/[\w.+-]+$/.test(f)) || guessMime(name), resourceId: /See resource:([^\s·]+)/.exec(line)?.[1] || '', text: null};
  }
  function readFence(lines, start) {
    const match = /^ {0,3}(`{3,}|~{3,})([^\s]*)\s*$/.exec(lines[start] || '');
    if (!match) return null;
    const marker = match[1][0], length = match[1].length;
    for (let i = start + 1; i < lines.length; i++) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[i]);
      if (close && close[1][0] === marker && close[1].length >= length) return {text: lines.slice(start + 1, i).join('\n'), language: match[2], end: i + 1};
    }
    throw new Error('导出记录里的代码块不完整，请重新导出');
  }
  function parseUser(body, tier) {
    const lines = body.split('\n'); let pos = 0;
    const blank = () => {while (pos < lines.length && !lines[pos].trim()) pos++;}; blank();
    if (tier !== 'minimal' && /^\*(?:\d{4}-\d\d-\d\d|ID |Parent |Model |hidden message|.*branch).*\*$/.test(lines[pos] || '')) {pos++; blank();}
    const attachments = [];
    if (lines[pos] === '### Attachments') {pos++; blank();}
    while (pos < lines.length) {
      const attachment = attachmentLine(lines[pos]); if (!attachment) break;
      attachments.push(attachment); pos++; blank();
    }
    while (pos < lines.length && attachments.length) {
      const name = /^\*\*(.+)\*\*$/.exec(lines[pos] || '');
      const attachment = name && attachments.find(a => a.name === label(name[1]) && a.text === null);
      if (!attachment) break;
      let fenceAt = pos + 1; while (!lines[fenceAt]?.trim() && fenceAt < lines.length) fenceAt++;
      const fenced = readFence(lines, fenceAt); if (!fenced) break;
      attachment.text = fenced.text; pos = fenced.end; blank();
    }
    let text = lines.slice(pos).join('\n').trim();
    if (tier !== 'minimal' && /^(?:<think>|### Tool call)/.test(text)) {
      const extraLines = text.split('\n'), outside = fences(extraLines);
      const answer = extraLines.findIndex((line, index) => outside[index] && line === '### Answer');
      text = answer < 0 ? '' : extraLines.slice(answer + 1).join('\n').trim();
    }
    return {text, attachments};
  }
  function parseResources(lines) {
    const outside = fences(lines), resources = new Map();
    for (let i = 0; i < lines.length; i++) {
      const heading = outside[i] && /^### (R\S+) · (.+)$/.exec(lines[i]); if (!heading) continue;
      let end = i + 1;
      while (end < lines.length && !(outside[end] && /^### /.test(lines[end]))) end++;
      const block = lines.slice(i + 1, end), mimeType = block.find(l => l.startsWith('- Type: '))?.slice(8) || guessMime(heading[2]);
      const size = Number(/^- Size: (\d+) bytes/m.exec(block.join('\n'))?.[1]);
      const fenceAt = block.findIndex(l => /^`{3,}base64\s*$/.test(l));
      if (fenceAt < 0) continue;
      const resource = readFence(block, fenceAt);
      const checksum = /- Checksum: (\S+) (\S+)/.exec(block.join('\n'));
      if (resources.has(heading[1])) throw new Error('资源附录出现重复编号');
      resources.set(heading[1], {name: heading[2], mimeType, size, dataBase64: resource.text.replace(/\s/g, ''), checksum: checksum ? {algorithm: checksum[1], hex: checksum[2]} : null});
    }
    return resources;
  }
  function parse(source) {
    const text = String(source).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), lines = text.split('\n'), outside = fences(lines);
    const title = /^# (.+)$/m.exec(text)?.[1] || '导入的聊天流程';
    const tierName = /\*\*Generator:\*\*[^\n]+\((Minimal|Full|Detailed)\)/.exec(text)?.[1];
    const tier = tierName?.toLowerCase() || (/^## Resource appendix$/m.test(text) ? 'detailed' : /^\*\*Source:/m.test(text) ? 'full' : 'minimal');
    const sections = []; let appendix = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (!outside[i]) continue;
      if (lines[i] === '## Resource appendix') {appendix = i; break;}
      const match = /^## (User|ChatGPT|Gemini|DeepSeek|Assistant) (\d+)\s*$/.exec(lines[i]) || /^## (System|Tool|Artifact|Unknown)\s*$/.exec(lines[i]);
      if (!match) continue;
      let previous = i - 1; while (previous >= 0 && !lines[previous].trim()) previous--;
      if (sections.length && lines[previous] !== '---') continue;
      sections.push({role: match[1] === 'User' ? 'user' : ['ChatGPT','Gemini','DeepSeek','Assistant'].includes(match[1]) ? 'assistant' : 'other', turn: Number(match[2]) || 0, start: i});
    }
    if (!sections.some(s => s.role === 'user')) throw new Error('没有找到 exporter 的 User 轮次，请选择极简、完整或详尽模式导出的 Markdown');
    const resources = parseResources(lines.slice(appendix)), turns = [], notes = [];
    let current = null, previousTurn = 0;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i], end = Math.min(sections[i + 1]?.start ?? appendix, appendix);
      const body = lines.slice(section.start + 1, end).join('\n').trim().replace(/\n\n---\s*$/, '').trim();
      if (section.role === 'user') {
        if (section.turn <= previousTurn) notes.push(`User ${section.turn} 的编号重复或回退，请核对导入边界`);
        previousTurn = section.turn;
        current = {...parseUser(body, tier), turn: section.turn, referenceReply: ''}; turns.push(current);
      } else if (section.role === 'assistant' && current) current.referenceReply += (current.referenceReply ? '\n\n' : '') + body;
    }
    const steps = [];
    for (const turn of turns) {
      const common = {sourceTurn: `User ${turn.turn}`, referenceReply: turn.referenceReply};
      if (!turn.attachments.length) {if (turn.text) steps.push({...common, title:M.firstSentence(turn.text), autoTitle:true, text: turn.text}); continue;}
      steps.push({...common,title:M.firstSentence(turn.text,turn.attachments[0]?.name),autoTitle:true,text:turn.text,missingAttachments:turn.attachments,missingAttachment:turn.attachments[0],importAttachments:turn.attachments,importAttachment:turn.attachments[0]});
    }
    return {title, tier, turns, steps, resources, notes};
  }
  async function materialize(parsed, store) {
    const steps = [];
    for (const raw of parsed.steps) {
      const value = {...raw}, attachments = value.importAttachments || (value.importAttachment?[value.importAttachment]:[]);
      value.attachments=[];value.missingAttachments=[];
      for(const attachment of attachments){
        let file=null;
        if(attachment.text!==null)file=new File([attachment.text],attachment.name,{type:attachment.mimeType});
        else if(attachment.resourceId&&parsed.resources.has(attachment.resourceId)){
          const resource=parsed.resources.get(attachment.resourceId);
          const bytes=Uint8Array.from(atob(resource.dataBase64),c=>c.charCodeAt(0));
          if(bytes.length!==resource.size)throw new Error(`资源大小校验失败：${resource.name}`);
          if(resource.checksum){
            if(resource.checksum.algorithm.toUpperCase().replace(/-/g,'')!=='SHA256')throw new Error('暂不支持此附件校验算法');
            const digest=await crypto.subtle.digest('SHA-256',bytes),hex=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
            if(hex.toLowerCase()!==resource.checksum.hex.toLowerCase())throw new Error(`资源校验和不符：${resource.name}`);
          }
          file=new File([bytes],attachment.name,{type:attachment.mimeType});
        }
        if(file)value.attachments.push(await store.saveFile(file));else value.missingAttachments.push({name:attachment.name,mimeType:attachment.mimeType});
      }
      steps.push(M.step(value));
    }
    return M.flow({title: parsed.title, steps, importNotes: parsed.notes});
  }
  root.PromptFlowChatImport = {parse, materialize, guessMime};
  if (typeof module !== 'undefined') module.exports = root.PromptFlowChatImport;
})(globalThis);
