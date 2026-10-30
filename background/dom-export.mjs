// Captures the ChatGPT/DeepSeek composer markup from the live tab so attachment
// cards can be inspected without DevTools. The report is downloaded as a text file
// and never includes conversation messages.
export function createDomExport({chrome, clock = Date}) {
  const CAP = 300000;
  function pageCapture() {
    const rendered = node => {
      try {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      } catch {return false;}
    };
    const path = node => {
      const list = [];
      for (let i = 0; i < 16 && node && node.nodeType === 1 && node !== document.body; i++, node = node.parentElement) {
        const testid = node.getAttribute('data-testid'), cls = (node.getAttribute('class') || '').split(/\s+/).filter(Boolean)[0];
        list.unshift(node.tagName.toLowerCase() + (testid ? '[' + testid + ']' : '') + (cls ? '.' + cls : ''));
      }
      return list.join(' > ');
    };
    const forms = [...document.querySelectorAll('form')];
    const form = forms.find(node => node.querySelector('[contenteditable="true"],textarea')) || forms[0] || null;
    if (!form) return {error: 'COMPOSER_NOT_FOUND'};
    const names = [];
    for (const node of form.querySelectorAll('span,div,a,p,strong,li')) {
      const text = (node.textContent || '').trim();
      if (text.length < 4 || text.length > 120 || !/\.[a-z0-9]{1,8}$/i.test(text)) continue;
      names.push({
        tag: node.tagName.toLowerCase(), testid: node.getAttribute('data-testid') || '',
        cls: (node.getAttribute('class') || '').slice(0, 200), rendered: rendered(node),
        path: path(node), text: text.slice(0, 120), html: node.outerHTML.slice(0, 800)
      });
      if (names.length >= 10) break;
    }
    const buttons = [...form.querySelectorAll('button,[role="button"]')].slice(0, 40).map(node => ({
      label: [node.getAttribute('aria-label'), node.getAttribute('title')].filter(Boolean).join(' | '),
      testid: node.getAttribute('data-testid') || '', rendered: rendered(node),
      html: node.outerHTML.slice(0, 300)
    }));
    return {url: location.href, title: document.title, formPath: path(form), form: form.outerHTML.slice(0, CAP), names, buttons};
  }
  function render(value) {
    const lines = ['Prompt Chain DOM diagnostic', 'at: ' + new Date(clock.now()).toISOString(),
      'url: ' + (value.url || ''), 'title: ' + (value.title || ''), 'scope: ' + (value.formPath || ''), '',
      '=== FILENAME ELEMENTS ==='];
    for (const item of value.names || []) lines.push(JSON.stringify(item));
    lines.push('', '=== BUTTONS ===');
    for (const item of value.buttons || []) lines.push(JSON.stringify(item));
    lines.push('', '=== COMPOSER HTML ===', value.form || '');
    return lines.join('\n');
  }
  async function download(tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error('TARGET_TAB_UNAVAILABLE: 目标标签页不可用');
    const [injected] = await chrome.scripting.executeScript({target: {tabId}, func: pageCapture});
    const value = injected?.result;
    if (!value || value.error) throw new Error('DOM_CAPTURE_FAILED: ' + (value?.error || '页面没有返回内容'));
    const text = render(value);
    const stamp = new Date(clock.now()).toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const filename = 'prompt-chain-dom-' + stamp + '.txt';
    await chrome.downloads.download({url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(text), filename, saveAs: false});
    return {filename};
  }
  return {download, render};
}
