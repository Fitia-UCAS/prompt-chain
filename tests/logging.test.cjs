const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../shared/logging.js');
test('控制台统一箭头、标准级别与消息，保留结构化时间，旧记录同样格式',()=>{
 assert.equal(L.format(L.record(0,'Preparing step 1/20')),'> [INFO] Preparing step 1/20');
 assert.equal(L.format(L.record(0,'Upload failed','error','prompt_chain.upload')),'> [ERROR] Upload failed');
 assert.equal(L.format({at:0,text:'Legacy failure',tone:'warn'}),'> [WARNING] Legacy failure');
 assert.equal(L.record(123,'test').at,123);
 assert.equal(L.record(0,'Done','success').level,'INFO');
 assert.match(L.format({at:0,text:'已锁定对话：DeepSeek - 探索未至之境，共 20 步'}),/Conversation locked: DeepSeek$/);
 assert.equal(L.format({at:0,text:'Paused: 无法确认附件上传完成：test.md',tone:'warn'}),'> [WARNING] Paused: UPLOAD_TIMEOUT: Attachment upload could not be confirmed: test.md');
 assert.equal(L.reason('SEND_RECEIPT_UNCONFIRMED: Attachment 设定.md was not matched'),'SEND_RECEIPT_UNCONFIRMED: Attachment 设定.md was not matched');
});

test('未知中文原因映射稳定错误码，原始原因与错误码保留在结构化输出',()=>{
  const L=require('../shared/logging.js');
  const error=Object.assign(new Error('附件恢复关联已经失效'),{code:'LINK_EXPIRED'});
  assert.deepEqual(L.classify(error),{code:'LINK_EXPIRED',detail:'附件恢复关联已经失效',cause:'',chinese:true});
  assert.match(L.reason(error),/^LINK_EXPIRED: /);
  assert.match(L.reason('附件恢复关联已经失效'),/^ATTACHMENT_OPERATION_FAILED: /);
  assert.match(L.reason('UPLOAD_REJECTED: 文件上传失败'),/^UPLOAD_REJECTED: /);
  assert.equal(L.reason('SEND_RECEIPT_UNCONFIRMED: Attachment 设定.md was not matched'),'SEND_RECEIPT_UNCONFIRMED: Attachment 设定.md was not matched');
  const cause=Object.assign(new Error('http 500'),{code:'HTTP_500'});
  const wrapped=Object.assign(new Error('WEB_NOT_CONNECTED: The page did not answer the extension'),{code:'WEB_NOT_CONNECTED',cause});
  const info=L.classify(wrapped);
  assert.equal(info.code,'WEB_NOT_CONNECTED');
  assert.equal(info.cause,'http 500');
});
