// Captures live page state for support: the composer markup (attachment cards),
// the message reader's view, and the conversation API response. The report is
// downloaded as text and never includes the conversation body.
export function createDomExport({chrome, clock = Date}) {
  // The injected function is serialised without its closure, so every constant
  // must live inside it.
  async function pageCapture() {
    const CAP = 300000;
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
    const names = [];
    if (form) {
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
    }
    const buttons = form ? [...form.querySelectorAll('button,[role="button"]')].slice(0, 40).map(node => ({
      label: [node.getAttribute('aria-label'), node.getAttribute('title')].filter(Boolean).join(' | '),
      testid: node.getAttribute('data-testid') || '', rendered: rendered(node),
      html: node.outerHTML.slice(0, 300)
    })) : [];
    const roleCounts = {};
    for (const node of document.querySelectorAll('[data-message-author-role]')) {
      const role = node.getAttribute('data-message-author-role');
      roleCounts[role] = (roleCounts[role] || 0) + 1;
    }
    // Structure only: tag + testid + role attributes, no conversation text.
    const skeleton = (root, limit) => [...(root ? root.querySelectorAll('*') : [])].slice(0, limit).map(node =>
      node.tagName.toLowerCase() +
      (node.getAttribute('data-testid') ? '[' + node.getAttribute('data-testid') + ']' : '') +
      (node.getAttribute('data-message-author-role') ? '{' + node.getAttribute('data-message-author-role') + '}' : '') +
      (node.getAttribute('role') ? '(' + node.getAttribute('role') + ')' : '')
    ).join(' ');
    const mainNode = document.querySelector('main');
    const readers = {
      roleCounts,
      turns: document.querySelectorAll('[data-testid^="conversation-turn"]').length,
      articles: document.querySelectorAll('article').length,
      messageIds: document.querySelectorAll('[data-message-id]').length,
      mainElements: document.querySelectorAll('main').length,
      mainText: ((document.querySelector('main') || document.body).innerText || '').length,
      skeleton: skeleton(mainNode, 140),
      lastMessages: [...document.querySelectorAll('[data-message-author-role]')].slice(-4).map(node => ({
        role: node.getAttribute('data-message-author-role'), key: node.getAttribute('data-message-id') || '',
        text: (node.innerText || '').trim().slice(0, 120), html: node.outerHTML.slice(0, 900)
      }))
    };
    const history = {};
    try {
      const session = await fetch('/api/auth/session', {credentials: 'include', cache: 'no-store'});
      const sessionBody = await session.json().catch(() => null);
      const token = sessionBody?.accessToken || '';
      history.session = {status: session.status, token: !!token};
      const match = /\/c\/([^/]+)\/?$/.exec(location.pathname);
      if (!match) history.error = 'no conversation id in the URL';
      else {
        for (const withToken of [true, false]) {
          const response = await fetch('/backend-api/conversation/' + encodeURIComponent(match[1]), {
            credentials: 'include', cache: 'no-store', headers: withToken && token ? {authorization: 'Bearer ' + token} : {}
          });
          const body = await response.text();
          if (withToken) {history.status = response.status; history.ok = response.ok; history.bodyHead = body.slice(0, 200);}
          else {history.withoutToken = {status: response.status, bodyHead: body.slice(0, 120)};}
        }
      }
    } catch (error) {history.error = String((error && error.message) || error);}
    return {url: location.href, title: document.title, formPath: form ? path(form) : '',
      form: form ? form.outerHTML.slice(0, CAP) : '', names, buttons, readers, history};
  }
  function render(value) {
    const lines = ['Prompt Chain DOM diagnostic', 'at: ' + new Date(clock.now()).toISOString(),
      'url: ' + (value.url || ''), 'title: ' + (value.title || ''), 'scope: ' + (value.formPath || ''), '',
      '=== MESSAGE READER ===', JSON.stringify(value.readers || null, null, 1),
      '', '=== CONVERSATION API ===', JSON.stringify(value.history || null, null, 1),
      '', '=== FILENAME ELEMENTS ==='];
    for (const item of value.names || []) lines.push(JSON.stringify(item));
    lines.push('', '=== BUTTONS ===');
    for (const item of value.buttons || []) lines.push(JSON.stringify(item));
    lines.push('', '=== COMPOSER HTML ===', value.form || '');
    return lines.join('\n');
  }
  async function download(tabId) {
    const tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : null;
    if (!tab) throw new Error('TARGET_TAB_UNAVAILABLE: 目标标签页不可用');
    let injected = null;
    try {
      [injected] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: pageCapture});
    } catch (error) {
      throw new Error('DOM_CAPTURE_FAILED: ' + String((error && error.message) || error));
    }
    const value = injected?.result;
    if (!value) throw new Error('DOM_CAPTURE_FAILED: 页面没有返回内容');
    if (value.error) throw new Error('DOM_CAPTURE_FAILED: ' + value.error);
    const text = render(value);
    const stamp = new Date(clock.now()).toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const filename = 'prompt-chain-dom-' + stamp + '.txt';
    await chrome.downloads.download({url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(text), filename, saveAs: false});
    return {filename};
  }
  return {download, render};
}
