const visible=element=>!!element?.isConnected&&!element.hidden&&getComputedStyle(element).visibility!=='hidden'&&element.getClientRects().length>0;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sameFiles=(a,b)=>a.length===b.length&&a.every((file,index)=>file.name===b[index].name&&file.size===b[index].size&&file.type===b[index].type&&file.lastModified===b[index].lastModified);
export function wrapGeminiUpload(adapter){
 const attach=adapter.attachFiles;
 adapter.attachFiles=async function(files){
  if(files.length>1){
   const inputs=[...document.querySelectorAll('input[type="file"]')].filter(input=>!input.disabled);
   if(inputs.length===1&&!inputs[0].multiple)return{ok:false,error:'UPLOAD_MULTIPLE_UNSUPPORTED: Gemini file picker does not allow multi-select'};
  }
  return attach.call(this,files);
 };
 adapter.verifyAttachments=function(files){
  const attempt=this.uploadAttempt,area=attempt?.area||this.lastUploadArea||this.getInputElement()?.closest('form')||document;
  const names=[...area.querySelectorAll('uploader-file-preview')].filter(visible).map(card=>this.getUploadFilename(card)).filter(Boolean);
  const matched=new Set();const aliases={};
  // Exact matches first; display counters can be accepted only for an unclaimed file.
  for(const file of files){const index=names.findIndex((name,i)=>!matched.has(i)&&name===file.name);if(index>=0)matched.add(index);}
  for(const file of files){
   if(names.some((name,i)=>matched.has(i)&&name===file.name))continue;
   const dot=file.name.lastIndexOf('.'),stem=dot>0?file.name.slice(0,dot):file.name,ext=dot>0?file.name.slice(dot):'';
   const hit=names.findIndex((name,index)=>{
    if(matched.has(index))return false;
    const prefix=stem+' (',suffix=')'+ext;
    return name.startsWith(prefix)&&name.endsWith(suffix)&&/^\d{1,3}$/.test(name.slice(prefix.length,name.length-suffix.length));
   });
   if(hit<0)return{ok:false,missing:file.name};matched.add(hit);aliases[file.name]=names[hit];
  }
  return{ok:true,aliases};
 };
 const assign=adapter.assignUploadFiles;
 adapter.assignUploadFiles=function(input,files,composer,area){
  this.uploadAttempt?.cleanup?.();
  const before=new Set(area.querySelectorAll('uploader-file-preview'));let assigned=false,changed=false;
  const onChange=()=>{if(sameFiles([...input.files],files))assigned=true;else changed=true;};
  input.addEventListener('change',onChange,true);
  const cleanup=()=>input.removeEventListener('change',onChange,true);
  const result=assign.call(this,input,files,composer,area);
  if(result.ok&&this.uploadAttempt)Object.assign(this.uploadAttempt,{before,assigned:()=>assigned&&!changed,cleanup});else cleanup();
  return result;
 };
 adapter.waitForUploadsComplete=async function(options){
  const attempt=this.uploadAttempt,files=options.files||[];let quiet=0;
  if(!attempt||files.length!==attempt.files.length||files.some((file,index)=>file!==attempt.files[index]))return false;
  try{
   this.lastUploadArea=attempt.area;
   const start=Date.now();
   while(Date.now()-start<(options.timeoutMs||120000)){
    options.guard?.();
    if(this.uploadAttempt!==attempt||location.href!==attempt.href||!attempt.area.isConnected||this.getInputElement()!==attempt.composer)return false;
    const area=attempt.area;
    const errors=[...area.querySelectorAll('.gem-attachment-loading-error,gem-icon[fonticonname="error"],[role="alert"]')].filter(visible);
    if(errors.some(node=>node.matches('.gem-attachment-loading-error,gem-icon[fonticonname="error"]')||/error|failed|失败|不支持|无法/i.test(node.textContent)))throw new Error('Gemini 附件上传失败');
    const cards=[...area.querySelectorAll('uploader-file-preview')].filter(visible),fresh=cards.filter(node=>!attempt.before.has(node));
    const counts=new Map;for(const card of cards){const name=this.getUploadFilename(card);if(name)counts.set(name,(counts.get(name)||0)+1);}
    const named=this.verifyAttachments(files).ok&&fresh.length>=files.length;
    const single=files.length===1&&attempt.assigned()&&fresh.length===1&&[...attempt.before].every(node=>area.contains(node))&&!!fresh[0].textContent.trim();
    const busy=[...area.querySelectorAll('[aria-busy="true"],[aria-label*="Uploading" i],[class*="upload" i][class*="progress" i],[role="progressbar"],.gem-attachment-loading,mat-spinner,mat-progress-spinner')].some(visible);
    const send=this.getSendButton(attempt.composer),ready=visible(send)&&!send.disabled&&send.getAttribute('aria-disabled')!=='true';
    if(attempt.assigned()&&(named||single)&&!busy&&ready){quiet||=Date.now();if(Date.now()-quiet>=850)return true;}else quiet=0;
    await sleep(options.pollMs||250);
   }
   return false;
  }finally{attempt.cleanup?.();if(this.uploadAttempt===attempt)this.uploadAttempt=null;}
 };
 return adapter;
}
