from pathlib import Path
import json,re,sys
from native_transport import patch_popup,patch_adapter
from native_prompt_sources import patch_prompt_editor
from provider_scope import patch_platform_assets

root=Path(__file__).resolve().parents[1]
source=Path(sys.argv[1])
for folder in ['assets','images']:
 (root/folder).mkdir(exist_ok=True)
 for p in (source/folder).iterdir():
  if p.is_file():(root/folder/p.name).write_bytes(p.read_bytes())
for size in [16,32,48,128]:(root/'images'/f'icon{size}.png').write_bytes((root/'icons'/f'icon{size}.png').read_bytes())
# Keep native upstream attachment storage aligned with Prompt Chain's no-extension-limit rule.
# Browser quota and each destination site remain authoritative, not a hardcoded 25 MiB cap.
native_storage=root/'assets'/'storage.js'
old_storage=native_storage.read_text(encoding='utf-8')
if '26214400' in old_storage:
 native_storage.write_text(old_storage.replace('26214400','Number.MAX_SAFE_INTEGER'),encoding='utf-8')
translations={
'LangQueue':'Prompt Chain','LangQueue logo':'Prompt Chain','Search':'搜索','Send':'发送','Settings':'设置','Workflow':'流程','Delete?':'确认删除？','This cannot be undone.':'删除后无法恢复。','Delete':'删除','Cancel':'取消','Insert':'插入','Open ChatGPT, Gemini, or Claude':'打开 ChatGPT、Gemini 或 Claude','Untitled':'未命名','Edit':'编辑','Delete prompt?':'删除提示词？','Deleting…':'正在删除…',"Couldn't delete the prompt.":'删除提示词失败。','Open ChatGPT, Gemini, or Claude first.':'请先打开 ChatGPT、Gemini 或 Claude。',"Couldn't insert the prompt.":'无法插入提示词。','Your prompt may have been sent. Check the chat before you try again.':'消息可能已经发送，请先核对对话。',"Couldn't send the prompt.":'发送失败。','No steps provided':'没有执行步骤','Send the first message and let the chat load, then run the chain.':'请先发送第一条消息，再运行流程。',"LangQueue couldn't load on that page. Try again, or reload it.":'页面连接失败，请刷新后重试。','Your draft changed. Run the chain again.':'草稿已变化，请重新启动流程。','You switched chats. Open the one you want and run the chain again.':'目标对话已切换，请重新启动流程。','Chain cancelled.':'流程已取消。','Finish or cancel the queue first.':'请先完成或取消当前队列。',"Couldn't start the chain.":'无法启动流程。','Search prompts':'搜索提示词','Sort prompts':'排序','Recent':'最近使用','Most used':'使用最多','Reset':'重置','Clear search and sort':'清除搜索和排序','Could not load settings.':'无法读取设置。','Saving':'正在保存','Saved':'已保存','Save failed':'保存失败','Exported to Downloads':'已导出到下载文件夹','Export failed':'导出失败','Nothing imported':'没有导入内容','Import failed':'导入失败','Back':'返回','Retry':'重试','Attachments':'附件','Prevent auto-scroll on submit':'发送时不自动滚动','Insert mode':'插入方式','Overwrite':'覆盖','Append':'追加','Export library':'导出提示词库','Exporting…':'正在导出…','Export':'导出','Include files in export':'包含附件原文件','Import library':'导入提示词库','Overwrites matching items.':'同名记录将被更新。','Importing…':'正在导入…','Import':'导入','Import skills or Markdown':'导入技能或 Markdown','Open':'打开','Loading…':'正在加载…','Saving…':'正在保存…','Save':'保存',"Couldn't add that file.":'无法添加该附件。','Chain saved. Reopen the popup to refresh.':'流程已保存。',"Couldn't save the chain.":'保存流程失败。','Edit chain':'编辑流程','New chain':'新建流程','Close':'关闭','Title':'名称','Chain title':'流程名称','Steps':'步骤','Prompt':'提示词','Add attachment':'添加附件','Move up':'上移','Move down':'下移','Remove':'移除',' Add step':' 添加步骤','Add a title and fill in every step':'请填写名称和每一步内容','No chat':'未连接','Chain complete':'流程已完成','Chain stopped. See the chat tab for why.':'流程已停止，请检查目标对话。','Chain cancelled':'流程已取消','Checking':'正在连接','No chat open':'未打开对话','Prompts':'提示词','No prompts yet':'还没有提示词',' New prompt':' 新建提示词','No matches':'没有匹配项','Chains':'提示词序列','No chains yet':'还没有流程','Chain has no steps':'流程没有步骤','Chain started':'流程已启动','Starting…':'正在启动…','Run':'运行','Loading':'正在加载',' prompts':' 条提示词',' uses':' 次使用',' file':' 个附件',' step':' 步','Exporting':'正在导出',' New chain':' 新建流程','Delete chain?':'删除流程？',"Couldn't delete the chain.":'删除流程失败。',' and ':' 和 ','Title is required.':'请填写名称。','Title must be at least 3 characters.':'名称至少需要 3 个字符。','Add text or a file.':'请添加文字或附件。',"Couldn't save the prompt.":'保存提示词失败。','Edit prompt':'编辑提示词','New prompt':'新建提示词','Add files':'添加附件','Dismiss':'关闭'
}
translations.update({'Clear search':'清除搜索','Chain saved. ':'流程已保存。','Failed to load prompts/stats':'无法读取提示词和使用记录'})
translations.update({
'Hide':'收起','Show':'展开','Ready':'就绪','Waiting':'等待中','Uploading':'正在上传','Sending':'正在发送','Responding':'正在回答','Stopped':'已停止','Cancelled':'已取消','Starting':'正在启动','Done':'已完成','Chain':'流程','Queue':'队列','Sent':'已发送','Cancelling…':'正在取消…',
'Edit shortcut':'编辑提示词','New shortcut':'新建提示词','Shortcut name':'提示词名称','Delete shortcut':'删除提示词','Create new shortcut':'新建提示词','Name required.':'请填写名称。','Instructions required.':'请填写提示词内容。','Instructions':'提示词','Failed to save.':'保存失败。','Failed to delete.':'删除失败。','Usage could not be saved.':'无法保存使用记录。','LangQueue execution':'Prompt Chain 执行状态',
'Cancel queue':'取消队列','Cancel chain':'取消流程','Files may still be attached in the chat box.':'聊天框中可能仍有附件。','Send the first message and let the chat load, then try again.':'请先发送第一条消息，再运行流程。','This belongs to another chat. Go back to it to retry.':'请回到该流程原来的对话后重试。','Clear your draft from the chat box, then retry.':'请先清空草稿，再重试。',"Couldn't find the chat box.":'找不到聊天输入框。','Send failed.':'发送失败。','This may have been sent. Check the chat before you send it again.':'消息可能已经发送，请先核对对话。','The chat was still busy after 30 minutes.':'等待对话空闲已超过 30 分钟。',"The response didn't finish within 30 minutes.":'回答超过 30 分钟仍未完成。','No response started. This may have been sent, so check the chat.':'没有检测到回答，请先核对消息是否已发送。',"Couldn't confirm the upload. Check the files in the chat box.":'无法确认上传，请检查输入框中的附件。','Upload failed.':'上传失败。','Something went wrong.':'执行失败。','Remove the files from the chat box, then remove this item and queue it again.':'请清除输入框中的附件，移除此项后重新加入队列。','may have been sent':'可能已经发送','The last prompt may have been sent.':'上一条提示词可能已经发送。','Remove this to continue':'移除此项后继续',
'You switched chats. Pick the prompt again.':'对话已切换，请重新选择提示词。','Your draft changed. Pick the prompt again.':'草稿已变化，请重新选择提示词。',"LangQueue couldn't load. Try again, or reload this page.":'连接失败，请重试或刷新页面。','Your draft changed. Press Enter again to queue it.':'草稿已变化，请再次按 Enter 加入队列。','Still cancelling. Try again in a moment.':'正在取消，请稍后重试。','No prompt text or attachments were provided.':'没有提示词文字或附件。','Your draft changed. Try again.':'草稿已变化，请重试。','COMPOSER_CHANGED: the chat input changed. Check your draft before retrying.':'COMPOSER_CHANGED: 输入框已变化，请先核对草稿。','COMPOSER_CHANGED: save or clear your draft, then retry.':'COMPOSER_CHANGED: 请保存或清空草稿后重试。','A response started before this was sent. Check the chat, then retry.':'发送前模型已开始回答，请检查对话后重试。','SEND_UNCERTAIN: the prompt may have been sent.':'SEND_UNCERTAIN: 提示词可能已经发送。','This prompt has no text to insert. If it only has files, turn on Attachments in Settings.':'这条提示词只有附件，请在设置中开启附件。','A queue or chain is running. Wait for it or cancel it first.':'已有队列或流程在运行，请等待完成或先取消。','You switched chats, so nothing was inserted.':'对话已切换，未插入内容。','The chat box reloaded, so nothing was inserted. Try again.':'输入框已重新加载，请重试。','Your draft changed, so nothing was inserted. Try again.':'草稿已变化，未插入内容。','Wait for the response to finish, then send.':'请等待当前回答完成。',"Couldn't find the chat box. Open a chat and try again.":'请先打开对话，再重试。',"A file didn't upload. Check the files in the chat box, then try again.":'附件上传失败，请检查输入框。',"Couldn't confirm the upload. Check the files in the chat box, then try again.":'无法确认附件上传，请检查输入框。',"Couldn't press Send. Your prompt is in the chat box.":'未能点击发送，提示词保留在输入框中。','You switched chats before the prompt was sent.':'发送前对话已切换。','The chat box changed before the prompt was sent. Check it, then send it yourself.':'发送前输入框已变化，请核对后手动发送。','A file saved with this prompt is missing. Add it to the prompt again.':'提示词缺少附件，请重新添加。','Failed to set files on upload input.':'无法添加附件。',
'Title is required.':'请填写名称。','That name is already taken.':'此名称已存在。','Untitled chain':'未命名流程','Failed to open attachments database':'无法打开附件数据库','Invalid attachment payload.':'附件数据无效。','Attachment is empty.':'附件为空。','Attachment exceeds 25 MB limit.':'附件超过 25 MB。','Unsupported file type.':'不支持此附件类型。','IndexedDB request failed':'本地数据库读取失败','Attachment transaction aborted':'附件保存中断','Invalid attachment list in backup.':'备份中的附件列表无效。','Invalid attachment record in backup.':'备份中的附件记录无效。','Invalid or duplicate attachment record in backup.':'备份中的附件记录无效或重复。','Backup attachment exceeds 25 MB limit.':'备份中的附件超过 25 MB。','Invalid base64 for attachment: ':'附件编码无效：','Attachment size does not match its contents: ':'附件大小与内容不符：','Invalid attachment kind: ':'附件类型无效：','Attachment MIME type must use its canonical lowercase form: ':'附件 MIME 类型格式无效：','Attachment kind does not match its MIME type: ':'附件类型与 MIME 类型不符：','Invalid attachment references in backup.':'备份中的附件引用无效。','Invalid attachment kind in backup.':'备份中的附件类型无效。','Invalid backup. Expected a JSON object.':'备份格式无效，请选择 JSON 文件。','Invalid backup. Expected prompts or chains.':'备份缺少提示词或流程。','Unsupported backup version. Export a supported backup from LangQueue.':'不支持此备份版本，请重新导出。','Invalid prompt in backup.':'备份中的提示词无效。','Invalid chain in backup.':'备份中的流程无效。','Invalid chain step in backup.':'备份中的流程步骤无效。','Stored prompt library is invalid. Export your existing data before importing.':'提示词库数据无效，请先导出现有数据。','Unsupported stored prompt schema.':'不支持当前提示词库格式。','Stored prompt library is invalid.':'提示词库数据无效。','Stored prompt library contains invalid or duplicate records.':'提示词库有无效或重复记录。','Stored chain library is invalid.':'流程库数据无效。','Unsupported stored chain schema.':'不支持当前流程库格式。','Stored chain library contains invalid records.':'流程库有无效记录。','Stored chain contains an invalid step.':'流程中有无效步骤。','Attachment metadata does not match its file: ':'附件信息与原文件不符：','The response is missing. Reload the extension and try again.':'扩展没有响应，请重新加载后重试。','LangQueue was updated. Reload this page to keep using it.':'Prompt Chain 已更新，请刷新页面。'
})

def translate(s):
 def replace(m):
  try:value=json.loads(m.group())
  except:return m.group()
  return json.dumps(translations.get(value,value),ensure_ascii=False)
 s=re.sub(r'"(?:[^"\\]|\\.)*"',replace,s)
 return s
p=root/'assets/native-panel.js'
s=p.read_text(encoding='utf-8')
s=s.replace('async function Ye(o,i){','async function Ye(o,i,chainId){').replace('await Ye(r.steps)','await Ye(r.steps,void 0,r.id)').replace('{steps:o,expectedHref:m.url,insertionModeOverride:i}','{steps:o,expectedHref:m.url,insertionModeOverride:i,chainId}')
s=s.replace('onBlur:()=>{!p.current&&P===a.id&&N(null)}','onBlur:()=>{}')
s=s.replace('f.every(a=>a.content.trim().length>0)','f.every(a=>a.content.trim().length>0||a.attachments.length>0)')
s=s.replace('a.content.trim().length===0||P===a.id','(!a.content.trim()&&!a.attachments.length)||P===a.id')
s=s.replace('children:a.content})})','children:globalThis.PromptChainStepTitle?.(a,n)??a.content})})')
s=s.replace('className:"chain-card",children:', 'className:"chain-card","data-chain-id":r.id,children:')
s=s.replace('children:n===r.id?"Starting…":"Run"', 'children:n===r.id?e.jsx("span",{className:"pc-spinning",children:"◌"}):e.jsx("svg",{viewBox:"0 0 24 24",width:14,height:14,"aria-hidden":true,children:e.jsx("path",{d:"m8 5 11 7-11 7V5Z",fill:"currentColor"})})')
s=s.replace('children:"Edit"})','children:e.jsx(Ue,{size:14})})').replace('children:"Delete"})','children:e.jsx(de,{size:14})})')
s=s.replace('window.close()','void 0').replace('Reopen the popup to refresh.','').replace('langqueue-backup-','prompt-chain-backup-')
s=s.replace('`Run chain ${r.title}`','`运行流程 ${r.title}`').replace('`Edit chain ${r.title}`','`编辑流程 ${r.title}`').replace('`Delete chain ${r.title}`','`删除流程 ${r.title}`').replace('`Sending step ${u+1}/${h}`','`正在发送第 ${u+1}/${h} 步`').replace('`"${I.title}" will be permanently deleted.`','`确定删除「${I.title}」？`')
start=s.index('function Je(');end=s.index('async function pe(',start);search=s[start:end]
search=search.replace('function f(){b(""),v("recent"),l({query:"",sort:"recent"})}','function f(){b(""),S(""),l({query:"",sort:p}),j.current?.focus()}')
search=search.replace('pl-9 pr-3 text-xs','pl-9 pr-9 text-xs')
search=search.replace('placeholder:"Search","aria-label":"Search prompts"})]})','placeholder:"Search","aria-label":"Search prompts"}),w?e.jsx("button",{className:"pc-clear-search",onClick:f,"aria-label":"Clear search",children:e.jsx(re,{size:14})}):null]})')
search=search.replace(',e.jsx("button",{className:"icon-button h-10 w-10",onClick:f,title:"Reset","aria-label":"Clear search and sort",children:e.jsx(re,{size:14})})','')
s=s[:start]+search+s[end:]
s=translate(s).replace('?"":"s"','?"":""')
start=s.index('function Xe(');start=s.index('return e.jsxs("div",{className:"popup-shell"',start);end=s.index('const Ze=2;',start)
s=s[:start]+'return e.jsx(globalThis.PromptChainSettingsView,{e,React:t,settings:i,change:G,back:$,exportLibrary:K,importFile:W,importRef:I,ready:f,loading:P,saving:T,exporting:C,importing:w,error:D,retry:z,dismissError:()=>_(null),status:y,save:V,feedback:p,dismissFeedback:()=>v(null)})}'+s[end:]
p.write_text(s,encoding='utf-8')
p=root/'assets/storage.js';s=p.read_text(encoding='utf-8')
s=translate(s)
s=s.replace('async function Ot(){return await I(tt)??{}}async function Dt(t){await x(tt,t)}','function pcSettings(t={}){const{multimodalEnabled,insertionMode,exportIncludeBinaries,tweaks,...settings}=t;return settings}async function Ot(){return pcSettings(await I(tt)??{})}async function Dt(t){await x(tt,pcSettings(t))}')
start=s.index('async function Ft(');end=s.index('function _(',start)
s=s[:start]+'async function Ft(){const[e,o]=await Promise.all([Pt(),qt()]),n={version:3,exportedAt:Date.now(),prompts:e.prompts,chains:o.chains},r=new Set;for(const a of n.prompts)for(const s of a.attachments)r.add(s.id);for(const a of n.chains)for(const s of a.steps)for(const c of s.attachments)r.add(c.id);n.attachments=await It(Array.from(r));if(n.attachments.length!==r.size)throw new Error("部分附件原文件缺失，请先匹配附件再导出。");return n}'+s[end:]
s=s.replace('me=u(Yt)', 'me=async t=>{const data=typeof t==="string"?JSON.parse(t):t;if(data?.format==="prompt-flow"&&globalThis.PromptChainImportOwn)return globalThis.PromptChainImportOwn(data);return u(Yt)(t)}')
s=s.replace('async function Lt(t){const e=await V(),o=e.items.filter(n=>n.id!==t);await at({...e,items:o}),await C().catch(()=>{})}','async function Lt(t){const e=await V(),o=e.items.filter(n=>n.id!==t);await at({...e,items:o}),await C().catch(()=>{});await globalThis.PromptChainNativeDeleted?.(t)}')
p.write_text(s,encoding='utf-8')
p=root/'assets/native-panel.js';s=p.read_text(encoding='utf-8')
s=s.replace('await Oe(I.id)','await globalThis.PromptChainBeforeDelete?.(I);await Oe(I.id)').replace('`Step ${n+1} prompt`','`第 ${n+1} 步提示词`').replace('`Remove attachment ${c.name}`','`移除附件 ${c.name}`')
for english,chinese in [('Insert','插入'),('Edit','编辑'),('Delete','删除'),('Send','发送')]:s=s.replace('`'+english+' ${i.title||"prompt"}`','`'+chinese+' ${i.title||"提示词"}`')
s=s.replace('`Imported ${te.join(" 和 ")}`','`已导入 ${te.join(" 和 ")}`');p.write_text(s,encoding='utf-8')
p=root/'assets/site-runtime.js';s=p.read_text(encoding='utf-8').replace('langqueue-','promptchain-').replace('lq-','pc-');p.write_text(s,encoding='utf-8')
onboard={'Files could not be read':'无法读取文件','No Markdown or text files found':'没有找到 Markdown 或文本文件','Import failed':'导入失败','LangQueue':'Prompt Chain','Import prompts':'导入提示词','Set up your library':'设置提示词库','Reusable prompts for ChatGPT, Claude, and Gemini.':'在 ChatGPT、Claude 和 Gemini 中复用提示词。','Import skills or files':'导入技能或文件','Pick a skills folder like ':'选择技能目录，例如 ',' or ':' 或 ',', or Markdown files. Each ':'，或选择 Markdown 文件。每个 ',' becomes one prompt.':' 会成为一条提示词。','Press ':'按 ',' in the picker to show hidden folders.':' 可在文件选择器中显示隐藏目录。','Reading…':'正在读取…','Choose folder':'选择文件夹',' Choose files':' 选择文件','Write a prompt':'编写提示词',' New prompt':' 新建提示词','Select all':'全选','Select none':'全不选','Left out: ':'已跳过：','Importing…':'正在导入…','Cancel':'取消','Duplicate titles are skipped.':'跳过重复名称。','Imported ':'已导入 ',' prompt':' 条提示词',' file':' 个文件',' found':'',' skipped as duplicates.':' 条重复记录已跳过。',' opens the library':' 打开提示词库',' in a chat inserts a prompt':' 在聊天框中插入提示词','Stored locally in Chrome':'保存在本机'}
translations.update(onboard)
p=root/'assets/onboarding.js';s=translate(p.read_text(encoding='utf-8'))
for english,chinese in onboard.items():s=s.replace(json.dumps(english,ensure_ascii=False),json.dumps(chinese,ensure_ascii=False))
s=s.replace('`Import ${C} prompt${C===1?"":"s"}`','`导入 ${C} 条提示词`').replace('`${p.support} skill support file${p.support===1?"":"s"}`','`${p.support} 个技能附属文件`').replace('`${p.unsupported} hidden or unsupported file${p.unsupported===1?"":"s"}`','`${p.unsupported} 个隐藏或不支持的文件`').replace('`${p.empty} empty`','`${p.empty} 个空文件`').replace('?"":"s"','?"":""')
s=s.replace('Saved "','已保存「').replace('". Type $ in a chat to insert it.','」。在聊天框输入 $ 即可插入。');p.write_text(s,encoding='utf-8')
p=root/'assets/ui-vendor.js';s=p.read_text(encoding='utf-8')
start=s.index('function rd(');end=s.index('const Oa=',start)
s=s[:start]+'function rd({size:S=20,className:z,ariaLabel:m="Prompt Chain"}){return U.jsx("img",{src:chrome.runtime.getURL("icons/logo.svg"),width:S,height:S,className:z,alt:m})}'+s[end:]
start=s.index('function ud(');s=patch_prompt_editor(s[:start]+translate(s[start:]));p.write_text(s,encoding='utf-8')
p=root/'assets/rpc.js';s=p.read_text(encoding='utf-8')
old='async function u(e,t,n){return s(await chrome.tabs.sendMessage(e,{type:t,payload:n}))}'
new='async function u(e,t,n){if(t==="RUN_CHAIN"&&globalThis.location?.protocol==="chrome-extension:"&&["https://chatgpt.com/","https://chat.openai.com/"].some(prefix=>(n?.expectedHref||"").startsWith(prefix))){const r=await chrome.runtime.sendMessage({type:"PC_RUN_NATIVE",tabId:e,payload:n});if(!r?.ok)throw new Error(r?.error||"无法启动流程");location.href=chrome.runtime.getURL("workflow.html?monitor=1");return{ok:true}}return s(await chrome.tabs.sendMessage(e,{type:t,payload:n}))}'
if old not in s:raise RuntimeError('Upstream transport changed')
s=s.replace(old,new);p.write_text(s,encoding='utf-8')
p=root/'assets/rpc.js';p.write_text(translate(p.read_text(encoding='utf-8')),encoding='utf-8')
p=root/'assets/site-runtime.js';s=p.read_text(encoding='utf-8')
s=s.replace('const B={COMPAT_CHECK:', 'const B={PC_ACQUIRE:async()=>({acquired:h.getOwner()==="supervisor"||h.tryAcquire("supervisor")}),PC_RELEASE:async()=>{if(h.getOwner()==="supervisor")h.release();return{}},COMPAT_CHECK:',1)
old='!w.isRunning()&&w.run(c.steps,n,"overwrite")'
new='!w.isRunning()&&(t.id==="chatgpt"?chrome.runtime.sendMessage({type:"PC_RUN_NATIVE",payload:{steps:c.steps,chainId:c.id,expectedHref:P()}}).then(r=>{if(!r?.ok)C.showMessage(r?.error||"无法启动流程")}):w.run(c.steps,n,"overwrite"))'
if old not in s:raise RuntimeError('Upstream chain picker changed')
s=s.replace(old,new)
start=s.index('const ie="promptchain-tweaks-style"');end=s.index('function Qe(t)',start);s=s[:start]+s[end:]
s=s.replace('$e(n),','').replace('g.insertionMode||"overwrite"','"append"').replace('n.insertionMode||"overwrite"','"append"')
s=s.replace('n.multimodalEnabled===!1?[]:c.attachments||[]','c.attachments||[]').replace('n.multimodalEnabled===!1?[]:E','E').replace('g.multimodalEnabled===!1?{...h[v],attachments:[]}:h[v]','h[v]')
s=s.replace('c.attachments||[],"overwrite",!1,A','c.attachments||[],"append",!1,A').replace('w.run(c.steps,n,"overwrite")','w.run(c.steps,n,"append")')
p.write_text(s,encoding='utf-8')
p=root/'assets/site-runtime.js';s=p.read_text(encoding='utf-8');split=s.index('class oe{');head=translate(s[:split])
for before,after in [('>LangQueue<','>Prompt Chain<'),('>Hide<','>收起<'),('>Retry<','>重试<'),('>Cancel queue<','>取消队列<'),('>Cancel chain<','>取消流程<'),('>Dismiss<','>关闭<'),('>Create new shortcut<','>新建提示词<'),('>Edit</span>','>编辑</span>')]:head=head.replace(before,after)
head=head.replace('Remove queued prompt: ','移除排队提示词：').replace(': the prompt may have been sent.',': 提示词可能已经发送。');p.write_text(head+s[split:],encoding='utf-8')
p=root/'assets/native-api.js';s=p.read_text(encoding='utf-8')
s=re.sub(r'chrome\.runtime\.onInstalled\.addListener\(t=>\{t\.reason===.*?\}\);const _=', 'const _=',s,count=1)
p.write_text(s,encoding='utf-8')
if not (root/'onboarding.html').exists():raise RuntimeError('Missing maintained onboarding.html')

p=root/'assets/native-panel.js';p.write_text(patch_popup(p.read_text(encoding='utf-8')),encoding='utf-8')
p=root/'assets/site-runtime.js';p.write_text(patch_adapter(p.read_text(encoding='utf-8')),encoding='utf-8')
patch_platform_assets(root)

# Upstream ships -webkit-* only. Add the standard properties so the copied
# build keeps the editor free of vendorPrefix diagnostics; every replacement is
# a no-op when the pattern is absent or already patched.
def patch_css_compat():
 fixes={
  'assets/onboarding.css':[('-webkit-line-clamp:2}','-webkit-line-clamp:2;line-clamp:2}')],
  'assets/ui.css':[
   ('input:where([type=submit]){-webkit-appearance:button;','input:where([type=submit]){-webkit-appearance:button;appearance:button;'),
   ('[type=search]{-webkit-appearance:textfield;','[type=search]{-webkit-appearance:textfield;appearance:textfield;'),
   ('object{display:block;vertical-align:middle}','object{display:block}'),
   ('-webkit-box-orient:vertical;-webkit-line-clamp:2}','-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2}'),
  ],
 }
 for name,pairs in fixes.items():
  p=root/name
  if not p.exists():raise RuntimeError('Missing '+name)
  s=p.read_text(encoding='utf-8')
  for old,new in pairs:
   if old in s and new not in s:s=s.replace(old,new)
  p.write_text(s,encoding='utf-8')
patch_css_compat()
