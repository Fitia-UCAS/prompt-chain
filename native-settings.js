export function Settings({e,React,back,exportLibrary,ready,exporting,error,retry,dismissError,status,feedback,dismissFeedback}){
  const tools=globalThis.PromptChainSettingsTools;
  const [domNote,setDomNote]=React.useState('');
  React.useEffect(()=>{if(!feedback)return;const timer=setTimeout(dismissFeedback,4500);return()=>clearTimeout(timer);},[feedback]);
  const icon=name=>e.jsx('svg',{viewBox:'0 0 24 24','aria-hidden':true,children:e.jsx('path',{d:PromptChainIcons[name]})});
  const control=(name,glyph,click,disabled=false)=>e.jsx('button',{type:'button',className:'icon-button pc-control','aria-label':name,onClick:click,disabled,children:icon(glyph)});
  const row=(name,element)=>e.jsxs('div',{className:'pc-setting-row',children:[e.jsx('span',{children:name}),element]},name);
  const action=(name,glyph,click,aria=name,disabled=false)=>row(name,control(aria,glyph,click,disabled));
  const group=(name,children)=>e.jsx('section',{className:'settings-panel','aria-label':name,children},name);
  const exportDom=async()=>{
    setDomNote('正在导出…');
    try{
      const result=await chrome.runtime.sendMessage({type:'PF_EXPORT_DOM'});
      if(!result?.ok)throw new Error(result?.error||'导出失败');
      setDomNote('已导出 '+result.filename+'（在下载目录）');
    }catch(failure){setDomNote(failure.message||'导出失败');}
  };
  const message=error||feedback;
  return e.jsxs('div',{className:'popup-shell pc-settings',children:[
    e.jsxs('header',{className:'popup-header pc-settings-header',children:[control('返回','back',back),e.jsx('div',{className:'popup-title',children:'设置'}),status?e.jsx('span',{className:'pc-save-status',role:'status',children:status}):null]}),
    message?e.jsxs('div',{className:'pc-settings-notice'+(error?' is-error':''),role:error?'alert':'status',children:[e.jsx('span',{children:message}),error?control('重试','restore',retry):null,control('关闭提示','close',error?dismissError:dismissFeedback)]}):null,
    e.jsxs('fieldset',{disabled:!ready,className:'contents',children:[
      e.jsxs('main',{className:'popup-scroll pc-settings-list',children:[
        group('导出',[action('导出提示词库','export',exportLibrary,'导出',exporting)]),
        group('记录',[
          action('执行记录','logs',tools.openMonitor),
          action('最近删除','trash',tools.openTrash)
        ]),
        group('诊断',[
          action('导出页面 DOM','dom',exportDom,'导出页面 DOM'),
          domNote?e.jsx('p',{className:'pc-setting-note',children:domNote}):null
        ]),
        e.jsx('p',{className:'pc-setting-note',children:'Prompt Chain '+(chrome.runtime.getManifest?.().version||'')})
      ]})
    ]})
  ]});
}
