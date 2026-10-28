const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');
const M=require('../shared/model.js');
const URL='https://chatgpt.com/c/attachment-fixture';
const refs=Array.from({length:5},(_,i)=>({id:'f'+i,name:`参考文件${i+1}.txt`,size:3,mimeType:'text/plain'}));

test('模型迁移、文件顺序、纯附件、多文件与无插件大小上限',()=>{
 const old=M.step({attachment:refs[0],text:''});assert.deepEqual(old.attachments,[refs[0]]);
 const modern=M.validateFlow({steps:[{text:'',attachments:refs}]});
 assert.equal(modern.steps.length,1);assert.deepEqual(modern.steps[0].attachments,refs);
 assert.equal(modern.steps[0].title,refs[0].name);
 assert.equal(M.fileRef({...refs[0],id:'large',size:26*1024*1024}).size,26*1024*1024);
 assert.throws(()=>M.validateFlow({steps:[{attachments:[refs[0],{...refs[0],id:'other',size:20}]}]}),/同名/);
 assert.throws(()=>M.validateFlow({steps:[{attachments:[refs[0]],missingAttachments:[{name:'缺失.txt'}]}]}),/缺失.txt/);
});

test('送达回执必须逐个核对五个附件，别名只在对应文件命中',()=>{
 const snap={url:URL,lastUser:{key:'new',text:'',filesText:refs.map(ref=>ref.name).join('\n')},messages:[{key:'new',role:'user'}]};
 const pending={text:'',attachments:refs,baselineMessages:[],attemptedAt:1,attachmentAliasMap:{}};
 assert.equal(M.receipt(snap,pending),true);
 for(const ref of refs)assert.equal(M.receipt({...snap,lastUser:{...snap.lastUser,filesText:refs.filter(other=>other!==ref).map(other=>other.name).join('\n')}},pending),false,ref.name);
 const renamed=refs[1].name.replace('.txt',' (9).txt');
 assert.equal(M.receipt({...snap,lastUser:{...snap.lastUser,filesText:refs.map((ref,i)=>i===1?renamed:ref.name).join('\n')}},{...pending,attachmentAliasMap:{[refs[1].id]:[renamed]}}),true);
 assert.equal(M.receipt({...snap,lastUser:{...snap.lastUser,filesText:refs.map((ref,i)=>i===1?renamed:ref.name).join('\n')}},pending),false);
 assert.equal(M.receipt({...snap,lastUser:{...snap.lastUser,filesText:refs.map((ref,i)=>i===0?ref.name+'.other':ref.name).join('\n')}},pending),false,'子串不可冒充附件原名');
});

function browser({provider='chatgpt',omit='',stranger='',reuse=false,multiple=true,rejectMulti=false}={}){
 let now=0,clicks=0,assignments=0;
 const observed=reuse?refs.map(ref=>ref.name):[],ready=[],selectedGroups=[];
 const addNames=(files)=>{for(const file of files)if(file.name!==omit&&!observed.includes(file.name))observed.push(file.name);if(stranger&&!observed.includes(stranger))observed.push(stranger);};
 const inputListeners=new Set();
 const input={accept:'',multiple,disabled:false,files:[],id:'octane-mobile-composer-files-input',hasAttribute:()=>false,
   addEventListener(t,cb){if(t==='change')inputListeners.add(cb);},removeEventListener(t,cb){inputListeners.delete(cb);},
   dispatchEvent(event){if(event.type==='change'){assignments++;selectedGroups.push([...this.files].map(f=>f.name));addNames([...this.files]);for(const listener of [...inputListeners])listener(event);}return true;}};
 const visibleNode={isConnected:true};
 const form={tagName:'FORM',isConnected:true,getAttribute:()=>'',querySelectorAll(selector){
   if(selector.includes('input[type="file"]'))return[input];
   if(selector.includes('[data-testid="attachment-preview"]'))return observed.map(()=>visibleNode);
   return [];
 }};
 const composer={isConnected:true,contains:()=>true,content:''};
 const messages=[];
 const button={click(){clicks++;composer.content='';}};
 const originalScan=(r)=>{
   const files=r.map(ref=>({id:ref.id,name:ref.name,size:ref.size,state:observed.includes(ref.name)?'match':'missing',strength:'strong',alias:''}));
   const extras=observed.filter(name=>!r.some(ref=>ref.name===name)).length;
   return{state:extras?'conflict':files.every(f=>f.state==='match')?'match':'missing',files,cardCount:observed.length,extras,collisions:[]};
 };
 const supervisor={
   snapshot(){return{url:URL,hasComposer:true,draft:composer.content,generating:false,lastUser:clicks?{key:'u',text:'',filesText:observed.join('\n')}:null,messages:[]};},
   composer:()=>composer,scope:()=>form,ctext:()=>composer.content,fill:(_c,t)=>{composer.content=t;},
   rendered:()=>true,generating:()=>false,sendBtn:()=>button,sleep:async ms=>{now+=ms;},
   attachmentRoots:()=>[{root:form,kind:'form'}],scanAttachmentSet:(_c,r)=>originalScan(r)
 };
 const adapter=provider==='chatgpt'?null:{id:provider,attachFiles:async files=>{
   if(rejectMulti&&files.length>1)return{ok:false,error:'UPLOAD_MULTIPLE_UNSUPPORTED: fixture'};
   assignments++;selectedGroups.push(files.map(file=>file.name));addNames(files);return{ok:true};
 },waitForUploadsComplete:async({files})=>files.every(file=>observed.includes(file.name)),verifyAttachments:files=>files.every(file=>observed.includes(file.name)),uploadDiagnostic:()=>null};
 const listeners=[];
 const chrome={runtime:{onMessage:{addListener(fn){listeners.push(fn);},removeListener(){}},sendMessage:async msg=>{
   if(msg.type==='PF_FILE_CHUNK')return{ok:true,chunk:Buffer.from('abc').toString('base64')};
   if(msg.type==='PF_ATTACHMENT_READY')ready.push(msg.fileId);
   return{ok:true};
 }}};
 const environment={chrome,crypto:globalThis.crypto,console,atob,Blob,File,Event,URL:globalThis.URL,
   location:{href:URL},document:{documentElement:{},querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}},
   PromptFlowSupervisor:supervisor,PromptFlowModel:{sameChat:()=>true,receipt:()=>true,echoNorm:v=>String(v||'').trim()},PromptChainSiteAdapter:adapter,
   DataTransfer:class {constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}},
   MutationObserver:class{observe(){}disconnect(){}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
   Date:class extends Date{static now(){return now;}}
 };
 vm.runInNewContext(readFileSync(join(__dirname,'../content/bridge.js'),'utf8'),environment);
 const op={id:'op',runId:'run',step:1,url:URL,text:'',attachment:refs[0],attachments:refs,
   reuseAttachments:reuse,attachmentAliasMap:{}};
 const result=new Promise(resolve=>listeners[0]({type:'PF_SEND',operation:op},{},resolve));
 return{result,get clicks(){return clicks;},get assignments(){return assignments;},get ready(){return ready;},get selectedGroups(){return selectedGroups;}};
}
for(const provider of ['chatgpt','gemini','deepseek']){
 test(`${provider} 五文件一条消息只发送一次`,async()=>{
   const h=browser({provider}),res=await h.result;
   assert.equal(res.ok,true,res.error);assert.equal(h.clicks,1);assert.deepEqual(h.ready,refs.map(ref=>ref.id));
   assert.equal(h.assignments,1);assert.deepEqual(Array.from(h.selectedGroups[0]),refs.map(ref=>ref.name));
 });
 test(`${provider} 缺失任意文件绝不发送部分附件`,async()=>{
   const h=browser({provider,omit:refs[3].name}),res=await h.result;
   assert.equal(res.ok,false);assert.equal(h.clicks,0);
 });
}
test('ChatGPT 上传卡片出现无关文件，整组终止',async()=>{
 const h=browser({stranger:'无关.txt'}),res=await h.result;assert.equal(res.ok,false);assert.match(res.error,/MISMATCH|CONFLICT/);assert.equal(h.clicks,0);
});
test('ChatGPT 恢复已齐全的五附件：不重选、不重复上传',async()=>{
 const h=browser({reuse:true}),res=await h.result;assert.equal(res.ok,true,res.error);assert.equal(h.assignments,0);assert.equal(h.clicks,1);assert.equal(h.ready.length,5);
});
test('ChatGPT 不支持多选输入时：逐个附加后仍只发一次',async()=>{
 const h=browser({multiple:false}),res=await h.result;assert.equal(res.ok,true,res.error);assert.equal(h.assignments,5);assert.equal(h.clicks,1);
});
for(const provider of ['gemini','deepseek'])test(`${provider} 输入不支持多选时逐个附加`,async()=>{
 const h=browser({provider,rejectMulti:true}),res=await h.result;assert.equal(res.ok,true,res.error);assert.equal(h.assignments,5);assert.equal(h.clicks,1);
});
