const {test} = require('node:test');
const assert = require('node:assert/strict');
globalThis.marked=require('../vendor/marked/marked.min.js');
const M = require('../shared/model.js');
const url = 'https://chatgpt.com/c/one';

test('Gemini 中文书名号和破折号换行只用于回执比较，折叠预览仍须对应本次唯一消息',()=>{
  const text='请按顺序完整阅读下面的材料，保留每个材料自己的边界。你将依次收到四个、五个或六个用于概念说明的文件：\n\n（1）《01-reference-concepts-start-prompt-with-notes》——本文件。\n（2）《02-reference-concepts》——概念定义，保留 foo bar 的英文词间空格。';
  const prefix=text.slice(0,text.indexOf('\n（2）')).replace('》——','》\n——');
  const pending={url:'https://gemini.google.com/app',text,attemptedAt:1,baselineUserKey:'',baselineMessages:[]};
  const snapshot={url:'https://gemini.google.com/app/new',lastUser:{key:'new-user',text:prefix,folded:true},messages:[{key:'new-user',role:'user'},{key:'new-answer',role:'assistant'}]};
  assert.equal(M.receipt(snapshot,pending),true);
  assert.equal(M.receiptText(snapshot,pending).mode,'folded-prefix');
  assert.ok(M.receiptText(snapshot,pending).matchedPrefixLength>=80);
  assert.equal(M.receipt({...snapshot,lastUser:{...snapshot.lastUser,folded:false}},pending),false);
  assert.equal(M.receipt({...snapshot,messages:[{key:'extra-user',role:'user'},...snapshot.messages]},pending),false);
  assert.equal(M.receipt({...snapshot,lastUser:{...snapshot.lastUser,text:prefix.slice(0,35)}},pending),false);
  const full=text.replaceAll('》——','》\n——');
  assert.equal(M.receipt({...snapshot,lastUser:{...snapshot.lastUser,text:full,folded:false}},pending),true);
  assert.equal(M.receipt({...snapshot,lastUser:{...snapshot.lastUser,text:full.replace('foo bar','foobar'),folded:false}},pending),false);
  assert.equal(M.receipt({...snapshot,url:'https://chatgpt.com/c/new',lastUser:{...snapshot.lastUser,text:full,folded:false}},pending),false);
  assert.equal(pending.text,text);
});
function fixtures() {
  const flow = M.flow({title:'fixture',delaySeconds:0,steps:[{text:'读文件'}]});
  const run = {flow,targetUrl:url,index:0,repeated:0,sentUserKey:'u2',beforeAssistantKey:'a1',quietSignature:'a2|done',quietSince:100};
  const snap = {url,lastRole:'assistant',generating:false,lastUser:{key:'u2'},assistant:{key:'a2',signature:'a2|done',text:'已读完'}};
  return {run,snap};
}
test('旧回复、停止按钮和内容变化均不能推进步骤',()=>{
  const {run,snap}=fixtures();
  assert.equal(M.replyDecision(run,{...snap,assistant:{...snap.assistant,key:'a1'}},3000).type,'wait');
  assert.equal(M.replyDecision(run,{...snap,generating:true},3000).type,'wait');
  assert.equal(M.replyDecision(run,{...snap,assistant:{...snap.assistant,signature:'changed'}},3000).since,3000);
  assert.equal(M.replyDecision(run,snap,800).type,'wait');
  assert.equal(M.replyDecision(run,snap,3000).type,'next');
  assert.equal(M.replyDecision(run,{...snap,assistant:{...snap.assistant,text:''}},3000).type,'wait');
});

test('确认正文稳定后直接推进，旧版额外等待值不再生效',()=>{
  const {run,snap}=fixtures();run.flow.delaySeconds=60;
  assert.equal(M.replyDecision(run,snap,1000).type,'next');
  assert.equal(Object.hasOwn(M.flow({delaySeconds:60,steps:[{text:'执行'}]}),'delaySeconds'),false);
});

test('消息核对支持 Markdown 展示、全角字符和换行重排，保留英文词间空格',()=>{
  const raw='# 文件要求\n\n1. **完整阅读**。\n2. 保持 foo bar。';
  const pending={text:raw,baselineUserKey:'old'};
  assert.equal(M.receipt({lastUser:{key:'new',text:'文件要求\n完整阅读。\n保持 foo bar。'}},pending),true);
  assert.equal(pending.text,raw);
  assert.equal(M.receipt({lastUser:{key:'new',text:'文件要求\n完整阅读。\n保持 foobar。'}},pending),false);
  assert.equal(M.receipt({lastUser:{key:'new',text:'ABC\u200b：请阅读。'}},{text:'ＡＢＣ：请阅读。'}),true);
  assert.equal(M.receipt({lastUser:{key:'new',text:'First sentence. Next sentence.'}},{text:'First sentence.\nNext sentence.'}),true);
});

test('折叠预览必须有足够正文、明确折叠标记和发送前消息位置，旧消息与其他新用户均不放行',()=>{
  const text='请完整阅读这份文件，并在阅读后如实报告进度。'.repeat(12);
  const before=[{key:'u0',role:'user',fingerprint:'old-user'},{key:'a0',role:'assistant',fingerprint:'old-answer'}];
  const pending={text,baselineUserKey:'u0',baselineAssistantKey:'a0',baselineMessages:before,attemptedAt:1};
  const user={key:'u1',text:text.slice(0,140)+'…',folded:true,filesText:''};
  const snapshot={lastUser:user,messages:[...before,{key:'u1',role:'user',fingerprint:'prefix'},{key:'a1',role:'assistant',fingerprint:'new-answer'}]};
  assert.equal(M.receipt(snapshot,pending),true);
  assert.equal(M.receipt({...snapshot,lastUser:{...user,folded:false}},pending),false);
  assert.equal(M.receipt({...snapshot,lastUser:{...user,text:text.slice(0,30)+'…'}},pending),false);
  assert.equal(M.receipt({...snapshot,messages:snapshot.messages.slice(2)},pending),false);
  assert.equal(M.receipt({...snapshot,messages:snapshot.messages.slice(2)}, {...pending,userConfirmed:true}),true,'用户核对后恢复可接受被截断的历史');
  assert.equal(M.receipt({...snapshot,messages:[...snapshot.messages,{key:'other',role:'user'}]},pending),false);
  assert.equal(M.receipt({...snapshot,lastUser:{...user,key:'u0'}},pending),false);
  assert.equal(M.receipt(snapshot,{...pending,attemptedAt:0}),false);
});
test('完成标记和次数控制续作；达到上限暂停',()=>{
  const {run,snap}=fixtures();run.flow.steps[0].repeat={until:'【完毕】',text:'继续',count:0,max:2};
  assert.equal(M.replyDecision(run,snap,3000).type,'repeat');
  run.repeated=2;assert.equal(M.replyDecision(run,snap,3000).type,'pause');
  snap.assistant.text='【完毕】';assert.equal(M.replyDecision(run,snap,3000).type,'next');
});

test('旧读取器只见到重复用户消息，补齐回答和原生 ID 后仍按原出现顺序核对',()=>{
  const fingerprint=M.fingerprint('user\n重复开场'),oldKey=n=>`dom:user:${fingerprint}:${n}`;
  const pending={text:'重复开场',baselineUserKey:oldKey(2),baselineMessages:[1,2].map(n=>({key:oldKey(n),role:'user',fingerprint})),attemptedAt:1};
  const messages=[1,2,3].flatMap(n=>[{key:'u'+n,role:'user',fingerprint},{key:'a'+n,role:'assistant',fingerprint:'answer'+n}]);
  const snapshot={lastUser:{key:'u3',text:'重复开场'},messages};
  assert.equal(M.receipt(snapshot,pending),true);
  assert.equal(M.receipt({...snapshot,lastUser:{key:'u2',text:'重复开场'},messages:messages.slice(0,4)},pending),false);
  assert.equal(M.receipt({...snapshot,messages:[...messages,{key:'u4',role:'user',fingerprint}]},pending),false);
});
test('人工插话、离开对话和错误停止推进',()=>{
  const {run,snap}=fixtures();
  assert.equal(M.replyDecision(run,{...snap,lastUser:{key:'manual'}},3000).type,'pause');
  assert.equal(M.replyDecision(run,{...snap,url:'https://chatgpt.com/c/two'},3000).type,'pause');
  assert.equal(M.replyDecision(run,{...snap,error:'network error'},3000).type,'pause');
});
test('新聊天只可首次升级到具体对话；不放行其他域名',()=>{
  assert.equal(M.sameChat('https://chatgpt.com/',url,true),true);
  assert.equal(M.sameChat('https://chatgpt.com/','https://chatgpt.com/uc/guest-one',true),true);
  assert.equal(M.sameChat('https://chatgpt.com/uc/guest-one','https://chatgpt.com/uc/guest-two',true),false);
  assert.equal(M.sameChat(url,'https://chatgpt.com/c/two',true),false);
  assert.equal(M.sameChat(url,'https://evil.example/c/one'),false);
});
test('ChatGPT 临时 local-chatgpt 地址可确认升级，正式对话和其他项目不会串线',()=>{
  const local='https://chatgpt.com/c/local-chatgpt%3A81d88ea4-6ec3-4c2c-9041-d2eb5a55329d';
  assert.equal(M.temporaryConversation(local),true);assert.equal(M.conversationPath(local),false);
  assert.equal(M.sameChat('https://chatgpt.com/',local,true),true);
  assert.equal(M.sameChat(local,url,true),true);assert.equal(M.sameChat(local,url),false);
  assert.equal(M.sameChat(local.replace('%3A',':'),url,true),true);
  assert.equal(M.sameChat(local,'https://chatgpt.com/g/other/c/one',true),false);
  assert.equal(M.sameChat(url,local,true),false);
});
test('ChatGPT 项目页可作为新聊天入口，并与项目内对话共用范围',()=>{
  const project='https://chatgpt.com/g/g-p-6ac6367e6468819195855069f223562b/project';
  const inside='https://chatgpt.com/g/g-p-6ac6367e6468819195855069f223562b/c/one';
  assert.equal(M.platforms.chatPage(project),true);
  assert.equal(M.conversationPath(project),false);
  assert.equal(M.sameChat(project,project),true);
  assert.equal(M.sameChat(project,project+'/',true),true);
  assert.equal(M.sameChat(project,inside),false);
  assert.equal(M.sameChat(project,inside,true),true);
  assert.equal(M.sameChat(project,'https://chatgpt.com/g/g-p-other/project',true),false);
  assert.equal(M.sameChat(project,'https://chatgpt.com/',true),false);
  assert.equal(M.sameChat('https://chatgpt.com/',project,true),false);
  assert.equal(M.sameChat('https://chatgpt.com/g/g-custom',project,true),false);
});
test('ChatGPT 项目对话地址带项目名后缀时仍与项目页同属一个范围',()=>{
  const project='https://chatgpt.com/g/g-p-6ac6367e6468819195855069f223562b/project';
  const slugged='https://chatgpt.com/g/g-p-6ac6367e6468819195855069f223562b-webnovel/c/6ae4de92-2a00-83e9-a0a7-887adb60d455';
  const plain='https://chatgpt.com/g/g-p-6ac6367e6468819195855069f223562b/c/6ae4de92-2a00-83e9-a0a7-887adb60d455';
  assert.equal(M.platforms.route(project).scope,M.platforms.route(slugged).scope);
  assert.equal(M.sameChat(project,slugged,true),true);
  assert.equal(M.sameChat(project,plain,true),true);
  assert.equal(M.sameChat(slugged,plain),true);
  assert.equal(M.sameChat(project,slugged),false,'需要 allowNewChat 才能从项目页升级到具体对话');
  assert.equal(M.sameChat(project,'https://chatgpt.com/g/g-p-6ac6367e6468819195855069f223562b9/c/one',true),false);
  assert.equal(M.sameChat('https://chatgpt.com/g/g-p-6ac6367e6468819195855069f223562b9/project',slugged,true),false);
});
test('送达必须是新用户消息并匹配原文与附件名',()=>{
  const pending={baselineUserKey:'u1',text:'请阅读',attachment:{name:'原文.md'}};
  const snapshot={lastUser:{key:'u2',text:'请阅读',filesText:'原文.md'}};
  assert.equal(M.receipt(snapshot,pending),true);
  assert.equal(M.receipt({...snapshot,lastUser:{...snapshot.lastUser,key:'u1'}},pending),false);
  assert.equal(M.receipt({...snapshot,lastUser:{...snapshot.lastUser,filesText:'其他.md'}},pending),false);
});
test('图片未显示文件名时，必须同时确认本轮上传、新消息正文和实际图片',()=>{
  const pending={baselineUserKey:'old',text:'读取图片',attachment:{name:'test.png',mimeType:'image/png'},attemptedAt:1,baselineMessages:[{key:'old-a',role:'assistant',fingerprint:'a'}],attachmentUploaded:true};
  const snapshot={lastUser:{key:'new-u',text:'读取图片',filesText:'上传的图片',imageCount:1},messages:[{key:'old-a',role:'assistant',fingerprint:'a'},{key:'new-u',role:'user',fingerprint:'u'}]};
  assert.equal(M.receipt(snapshot,pending),true);
  assert.equal(M.receipt(snapshot,{...pending,attachmentUploaded:false}),false);
  assert.equal(M.receipt({...snapshot,lastUser:{...snapshot.lastUser,imageCount:0}},pending),false);
  assert.equal(M.receipt({...snapshot,lastUser:{...snapshot.lastUser,text:'另一条消息'}},pending),false);
  assert.equal(M.receipt(snapshot,{...pending,attachment:{name:'test.txt',mimeType:'text/plain'}}),false);
});
test('跳过的轮次不执行，缺附件不允许静默发送；多附件可以同一步',()=>{
  const f=M.validateFlow({steps:[{text:'略过',enabled:false},{text:'执行'}]});
  assert.equal(f.steps.length,1);assert.equal(f.steps[0].text,'执行');
  assert.throws(()=>M.validateFlow({steps:[{text:'读',missingAttachment:{name:'失踪.md'}}]}),/失踪.md/);
  assert.equal(M.validateFlow({steps:[{text:'',attachments:[{id:'a',name:'a.txt',size:3},{id:'b',name:'b.txt',size:3}]}]}).steps[0].attachments.length,2);
});
test('标题取第一句话，跳过格式标记，原文保持不变',()=>{
  const raw='**---**\n**name:&#x20;**_anadiplosis-information-linkage_\n**---**\n\n**# 顶真、勾连、咬尾、联珠与信息咬合**\n\n信息咬合是一种局部承接手法，不是新的文风类型。相邻的句子应相承。';
  const step=M.step({sourceTurn:'User 2',title:'第 2 轮 · **---** **name:&#x20;**',text:raw});
  assert.equal(step.title,'信息咬合是一种局部承接手法，不是新的文风类型。');assert.equal(step.text,raw);
  assert.equal(M.firstSentence('', '原文.md'),'原文.md');
});

test('附件回执接受本操作记录的站点显示名，但不接受无关名称',()=>{
  const M=require('../shared/model.js');
  const snapshot={url:'https://chatgpt.com/c/x',lastUser:{key:'u1',text:'',filesText:'02-anadiplosis-information-linkage(9).md',imageCount:0},messages:[{key:'u1',role:'user',fingerprint:'f'}]};
  const pending={text:'',attemptedAt:1,baselineMessages:[],attachment:{name:'02-anadiplosis-information-linkage.md',mimeType:'text/markdown'}};
  assert.equal(M.receipt(snapshot,pending),false);
  assert.equal(M.receipt(snapshot,{...pending,attachmentAliases:['02-anadiplosis-information-linkage(9).md']}),true);
  assert.equal(M.receipt({...snapshot,lastUser:{...snapshot.lastUser,filesText:'another-file.md'}},{...pending,attachmentAliases:['02-anadiplosis-information-linkage(9).md']}),false);
});
