(function(root){
 const levels={info:'INFO',success:'INFO',warn:'WARNING',error:'ERROR'};
 const known={'已手动暂停':'Paused by user','目标页已离开锁定对话':'Target tab changed conversation','网页仍显示停止生成按钮':'Response is still streaming','尚未识别到本轮新回答':'Waiting for a new assistant reply','本轮回答正文仍为空':'Assistant reply is empty','请回到流程锁定的原对话':'Return to the conversation bound to this flow','网页未连接，请刷新目标聊天页面后恢复':'Page disconnected; refresh the target page before resuming','没有找到 DeepSeek 附件区域':'DeepSeek composer attachment area was not found','未找到接收这些附件的唯一 DeepSeek 上传入口':'A unique DeepSeek file input was not found'};
 const english={
  USER_PAUSED:'Paused by user',
  ATTACHMENT_OPERATION_FAILED:'Attachment operation failed; the original page message is in Diagnostics',
  PAGE_CONNECTION_FAILED:'The page connection could not be used; the original error is in Diagnostics',
  DRAFT_CONFLICT:'The composer still holds a draft or attachment',
  CONVERSATION_CHANGED:'The page is no longer the conversation bound to this flow',
  LOGIN_REQUIRED:'The page requires sign-in',
  TARGET_TAB_CLOSED:'The bound tab was closed',
  TARGET_TAB_UNAVAILABLE:'The bound tab could not be read',
  TARGET_CONVERSATION_LOST:'The bound conversation is no longer open in its tab',
  WEB_NOT_CONNECTED:'The page did not answer the extension',
  UPLOAD_REJECTED:'The page rejected the attachment upload',
  UPLOAD_ATTACHMENT_MISMATCH:'The composer shows a different attachment; nothing was sent',
  UPLOAD_ATTACHMENT_UNIDENTIFIED:'An attachment card is present but its identity could not be confirmed; nothing was sent',
  UPLOAD_PREVIEW_NOT_RECOGNIZED:'No attachment card was observed in the composer search scope',
  ATTACHMENT_CONFLICT:'The composer already contains an attachment that is not part of this step',
  ATTACHMENT_IDENTITY_UNKNOWN:'An attachment is present but its identity could not be confirmed'
 };
 const hints=[[/附件|上传|文件/,'ATTACHMENT_OPERATION_FAILED'],[/连接|页面|标签页/,'PAGE_CONNECTION_FAILED'],[/草稿/,'DRAFT_CONFLICT'],[/对话/,'CONVERSATION_CHANGED'],[/登录|注册/,'LOGIN_REQUIRED']];
 const chinese=value=>/[\u3400-\u9fff]/.test(String(value||''));
 function classify(value){
  const error=value instanceof Error?value:null;
  const raw=String(error?error.message:value??'').trim();
  const match=/^([A-Z][A-Z0-9_]+):\s*([\s\S]*)$/.exec(raw);
  const hint=hints.find(([pattern])=>pattern.test(raw));
  const code=(error&&error.code)||match?.[1]||hint?.[1]||'EXTENSION_ERROR';
  return{code,detail:match?match[2]:raw,cause:error?.cause?String(error.cause.message||error.cause):'',chinese:chinese(raw)};
 }
 function reason(text){
  const value=String(text??'').trim();
  if(known[value])return known[value];
  if(value.startsWith('无法确认附件上传完成：'))return'UPLOAD_TIMEOUT: Attachment upload could not be confirmed: '+value.slice('无法确认附件上传完成：'.length);
  const info=classify(text);
  if(info.code!=='EXTENSION_ERROR'&&english[info.code])return info.code+': '+english[info.code];
  if(/^[A-Z][A-Z0-9_]+:/.test(value)){
   if(/[A-Za-z]/.test(info.detail))return value;
   return info.code+': '+(english[info.code]||'Operation failed')+' (page message in Diagnostics)';
  }
  if(chinese(value))return info.code+': '+(english[info.code]||'Operation failed')+' (original page message in Diagnostics)';
  return value;
 }
 function record(at,text,tone='info',logger='prompt_chain.runner'){return{at,text:String(text),tone,level:levels[tone]||'INFO',logger};}
 function message(text){
  text=String(text||'');let match;
  if(text.startsWith('Paused: '))return'Paused: '+reason(text.slice(8));
  if(text.startsWith('Resume check failed: '))return'Resume check failed: '+reason(text.slice(21));
  if(/^(?:已)?锁定对话：/.test(text))return'Conversation locked: '+(/DeepSeek/i.test(text)?'DeepSeek':/Gemini/i.test(text)?'Gemini':'ChatGPT');
  if(match=/^(?:准备执行|准备)第\s*(\d+)\s*步/.exec(text))return'Preparing step '+match[1];
  if(match=/^(?:已)?发送第\s*(\d+)\s*步/.exec(text))return'Sending step '+match[1];
  if(match=/^第\s*(\d+)\s*步完成/.exec(text))return'Completed step '+match[1];
  return({'已停止流程':'Flow stopped','流程已恢复':'Flow resumed','全部步骤执行完成':'Flow completed'}[text]||text.replace(/^准备上传：/,'Uploading attachment: '));
 }
 function format(entry){return`> [${entry.level||levels[entry.tone]||'INFO'}] ${message(entry.text)}`;}
 root.PromptChainLogging={record,format,reason,classify};
 if(typeof module!=='undefined')module.exports=root.PromptChainLogging;
})(globalThis);
