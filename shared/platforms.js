(function (root) {
  const names = {chatgpt: 'ChatGPT', gemini: 'Gemini', deepseek: 'DeepSeek'};
  const hosts = new Map([['chatgpt.com', 'chatgpt'], ['chat.openai.com', 'chatgpt'], ['gemini.google.com', 'gemini'], ['chat.deepseek.com', 'deepseek']]);
  function providerFor(value) {try {const url = new URL(value); return url.protocol === 'https:' ? hosts.get(url.hostname) || null : null;} catch {return null;}}
  function temporaryScope(value) {
    try {const match = /^(\/(?:g\/[^/]+\/)?)c\/([^/]+)\/?$/.exec(new URL(value).pathname); return match && /^local-chatgpt:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(decodeURIComponent(match[2])) ? match[1] : '';} catch {return '';}
  }
  function route(value) {
    const provider = providerFor(value); if (!provider) return null;
    const url = new URL(value), path = url.pathname.replace(/\/$/, '');
    if (provider === 'chatgpt') {
      // A project page (/g/g-p-…/project) owns the same composer as a new chat.
      // Its conversations live under the shared /g/g-p-…/ scope, so a flow may
      // start there and then resolve into /g/g-p-…/c/<id>.
      const project = /^(\/g\/[^/]+)\/project$/.exec(path);
      if (project) return {provider, origin: url.origin, scope: project[1] + '/', id: ''};
      const match = /^(\/(?:g\/[^/]+\/)?)(?:c|uc)\/([^/]+)$/.exec(path);
      if (match) return {provider, origin: url.origin, scope: match[1], id: temporaryScope(value) ? '' : match[2]};
      if (path === '' || /^\/g\/[^/]+$/.test(path)) return {provider, origin: url.origin, scope: path ? path + '/' : '/', id: ''};
    }
    if (provider === 'gemini') {
      const match = /^(\/(?:u\/\d+\/)?(?:app|gem\/[^/]+))(?:\/([^/]+))?$/.exec(path);
      if (match) return {provider, origin: url.origin, scope: match[1], id: match[2] || ''};
    }
    if (provider === 'deepseek') {
      const match = /^\/(?:a\/)?chat\/s\/([^/]+)$/.exec(path), query = url.searchParams.get('chat_session_id');
      if (match || ['', '/a/chat', '/chat'].includes(path)) return {provider, origin: url.origin, scope: '/chat', id: match?.[1] || query || ''};
    }
    return null;
  }
  function sameChat(expected, actual, allowNew = false) {
    try {
      const a = route(expected), b = route(actual);
      if (!a || !b || a.origin !== b.origin || a.scope !== b.scope) return false;
      if (a.id || b.id) return a.id === b.id || !!(allowNew && !a.id && b.id);
      return new URL(expected).pathname.replace(/\/$/,'') === new URL(actual).pathname.replace(/\/$/,'') || !!(allowNew && temporaryScope(actual));
    } catch {return false;}
  }
  const api = {names, providerFor, route, sameChat, temporaryScope, conversationPath: value => !!route(value)?.id, chatPage: value => !!route(value)};
  root.PromptChainPlatforms = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
