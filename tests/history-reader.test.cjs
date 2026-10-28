const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../content/history-reader.js'),'utf8');
function harness(payload,status=200){
  const calls=[],location={href:'https://chatgpt.com/c/current'};
  const context=vm.createContext({URL,location,Date,AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{calls.push({url,authorization:options.headers?.authorization});return{ok:url==='/api/auth/session'||status===200,status:url==='/api/auth/session'?200:status,async json(){return url==='/api/auth/session'?{accessToken:'fixture-token'}:payload;}}}});
  vm.runInContext(script,context);return{calls,read:()=>context.PromptChainHistory.read(location.href)};
}
test('原文兜底只读取 current_node 当前分支，保留附件名称，不返回登录凭据',async()=>{
  const h=harness({conversation_id:'current',current_node:'answer',mapping:{root:{parent:null},user:{parent:'root',message:{id:'u1',author:{role:'user'},content:{parts:[]},metadata:{attachments:[{name:'原文件.md'}]},status:'finished_successfully'}},answer:{parent:'user',message:{id:'a1',author:{role:'assistant'},channel:'final',content:{parts:['已收到']},status:'finished_successfully'}},other:{parent:'root',message:{id:'wrong',author:{role:'assistant'},content:{parts:['其他分支']}}}}});
  const result=await h.read();assert.equal(result.messages.length,2);assert.equal(result.messages[0].filesText,'原文件.md');assert.equal(result.messages[1].id,'a1');
  assert.equal(h.calls[1].authorization,'Bearer fixture-token');assert.equal(JSON.stringify(result).includes('fixture-token'),false);
  await h.read();assert.equal(h.calls.length,2);
});
test('原文分支不匹配拒绝读取；限流时不反复请求',async()=>{
  const wrong=harness({conversation_id:'other',current_node:'root',mapping:{root:{parent:null}}});await assert.rejects(wrong.read(),/分支/);
  const limited=harness(null,429);await assert.rejects(limited.read(),/限流/);await assert.rejects(limited.read(),/暂不可用/);assert.equal(limited.calls.length,2);
});
