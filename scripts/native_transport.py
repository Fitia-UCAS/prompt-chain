def patch_popup(s):
 old='function Z(){return new Promise(o=>{chrome.tabs.query({active:!0,currentWindow:!0},i=>o(i[0]))})}'
 new='function Z(){return globalThis.PromptChainResolveTarget?globalThis.PromptChainResolveTarget():new Promise(o=>{chrome.tabs.query({active:!0,currentWindow:!0},i=>o(i[0]))})}'
 if old not in s and new not in s:raise RuntimeError('Upstream target resolver changed')
 return s.replace(old,new)

def patch_adapter(s):
 start=s.index('class Ye extends oe');end=s.index('function je()',start)
 body=s[start:end]
 for old,new in [
  ('getInputElement(){','getInputElement(){if(globalThis.PromptFlowSupervisor)return PromptFlowSupervisor.composer();'),
  ('isGenerating(){','isGenerating(){if(globalThis.PromptFlowSupervisor)return PromptFlowSupervisor.generating();'),
  ('getSendButton(n){','getSendButton(n){if(globalThis.PromptFlowSupervisor)return PromptFlowSupervisor.sendBtn(n||this.getInputElement());'),
  ('async attachFiles(n){','async attachFiles(n){if(globalThis.PromptChainNativeFiles)return PromptChainNativeFiles.attach(n);'),
  ('async waitForUploadsComplete(n){','async waitForUploadsComplete(n){if(globalThis.PromptChainNativeFiles)return PromptChainNativeFiles.wait(n);')]:
  if old not in body:raise RuntimeError('Upstream ChatGPT adapter changed: '+old)
  if new not in body:body=body.replace(old,new,1)
 return patch_chain_runner(s[:start]+body+s[end:])

def patch_chain_runner(s):
 statement='import {createChainRunner} from "../content/chain-runner.mjs";'
 if statement not in s:s=statement+'\n'+s
 start=s.index('function Ve(');end=s.index('function Qe(',start)
 s=s[:start]+'function Ve(t,n,e=re()){return createChainRunner({readUrl:P,publish:state=>{try{chrome.runtime.sendMessage({type:"CHAIN_PROGRESS",payload:state}).catch(()=>{})}catch{}}})}'+s[end:]
 return s
