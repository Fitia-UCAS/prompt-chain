from pathlib import Path


def patch_platform_assets(root):
    root=Path(root)
    p=root/'assets/site-runtime.js';s=p.read_text(encoding='utf-8')
    statement='import {createDeepSeekAdapter} from "../content/deepseek-adapter.mjs";'
    if statement not in s:s=statement+'\n'+s
    statement='import {wrapGeminiUpload} from "../content/gemini-upload.mjs";'
    if statement not in s:s=statement+'\n'+s
    s=s.replace('function Je(){return new Ze}','function Je(){return wrapGeminiUpload(new Ze)}')
    start=s.find('class Ke extends oe');end=s.find('class Ze extends oe',start)
    if start>=0:s=s[:start]+'function Xe(){return createDeepSeekAdapter()}'+s[end:]
    s=s.replace('function We(t){','function We(t){globalThis.PromptChainSiteAdapter=t;',1) if 'globalThis.PromptChainSiteAdapter=t' not in s else s
    s=s.replace('t==="claude"','t==="deepseek"')
    s=s.replace('function H(t,n){t.throwIfAborted();if(typeof n==="object"){n.assert();return}if(P()!==n)throw new Error("CONVERSATION_CHANGED");if(!j(n))throw new Error("CONVERSATION_REQUIRED")}', 'function H(t,n){if(t.throwIfAborted(),P()!==n)throw new Error("CONVERSATION_CHANGED");if(!j(n))throw new Error("CONVERSATION_REQUIRED")}')
    s=s.replace('a.throwIfAborted();if(typeof r==="object")r.assert();else if(P()!==r)throw new Error("CONVERSATION_CHANGED");', 'if(a.throwIfAborted(),P()!==r)throw new Error("CONVERSATION_CHANGED");')
    old='/(^|\\.)claude\\.ai$/.test(n)?/^\\/chat\\/[^/]+\\/?$/.test(e)'
    new='/(^|\\.)chat\\.deepseek\\.com$/.test(n)?/^\\/(?:a\\/)?chat\\/s\\/[^/]+\\/?$/.test(e)'
    s=s.replace(old,new)
    old='!w.isRunning()&&(t.id==="chatgpt"?chrome.runtime.sendMessage({type:"PC_RUN_NATIVE",payload:{steps:c.steps,chainId:c.id,expectedHref:P()}}).then(r=>{if(!r?.ok)C.showMessage(r?.error||"无法启动流程")}):w.run(c.steps,n,"append"))'
    new='!w.isRunning()&&chrome.runtime.sendMessage({type:"PC_RUN_NATIVE",payload:{steps:c.steps,chainId:c.id,expectedHref:P()}}).then(r=>{if(!r?.ok)C.showMessage(r?.error||"无法启动流程")})'
    s=s.replace(old,new)
    start=s.index('RUN_CHAIN:async(');end=s.index(',CANCEL_CHAIN:',start)
    s=s[:start]+'RUN_CHAIN:async({steps:c,expectedHref:E})=>{const r=await chrome.runtime.sendMessage({type:"PC_RUN_NATIVE",payload:{steps:c,expectedHref:E}});return r?.ok?{ok:true}:{ok:false,reason:r?.error||"无法启动流程"}}'+s[end:]
    start=s.index('class Ze extends oe');end=s.index('function Je()',start)
    body=s[start:end]
    needle='for(;Date.now()-a<(n?.timeoutMs??6e4);){'
    body=body.replace(needle,needle+'n?.guard?.();') if 'n?.guard?.();' not in body else body
    s=s[:start]+body+s[end:];p.write_text(s,encoding='utf-8')
    p=root/'assets/native-panel.js';s=p.read_text(encoding='utf-8')
    s=s.replace('claude\\.ai','chat\\.deepseek\\.com').replace('"claude"','"deepseek"').replace('claude:"Claude"','deepseek:"DeepSeek"').replace('ChatGPT、Gemini 或 Claude','ChatGPT、Gemini 或 DeepSeek')
    p.write_text(s,encoding='utf-8')
    p=root/'assets/onboarding.js';s=p.read_text(encoding='utf-8').replace('在 ChatGPT、Claude 和 Gemini 中复用提示词。','在 ChatGPT、Gemini 和 DeepSeek 中复用提示词。').replace('~/.claude/skills','~/prompts');p.write_text(s,encoding='utf-8')
    p=root/'assets/rpc.js';s=p.read_text(encoding='utf-8')
    s=s.replace('["https://chatgpt.com/","https://chat.openai.com/"]','["https://chatgpt.com/","https://chat.openai.com/","https://gemini.google.com/","https://chat.deepseek.com/"]')
    p.write_text(s,encoding='utf-8')
