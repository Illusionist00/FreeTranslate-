(() => {
  if (window.__FT_YTHOOK__) return;
  window.__FT_YTHOOK__ = true;

  const SUB_RE = /(^|\/)(api\/timedtext|timedtext)(\?|$)/i;
  let reqId = 0;
  const pending = new Map();

  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || e.data.__ft !== 'sub-res') return;
    const cb = pending.get(e.data.id);
    if (cb) {
      pending.delete(e.data.id);
      cb(e.data.text);
    }
  });

  function isSubtitleUrl(url) {
    return typeof url === 'string' && SUB_RE.test(url);
  }

  function requestTranslation(url) {
    const id = ++reqId;
    return new Promise(resolve => {
      pending.set(id, resolve);
      window.postMessage({ __ft: 'sub-req', id, url }, '*');
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve(null);
        }
      }, 8000);
    });
  }

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    try {
      this.__ftUrl = typeof url === 'string' ? url : (url && url.href) || '';
    } catch (e) {}
    return origOpen.apply(this, arguments);
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    const url = this.__ftUrl;
    if (isSubtitleUrl(url)) {
      const args = arguments;
      return requestTranslation(url).then(text => {
        if (text) {
          try {
            Object.defineProperty(this, 'responseText', { get: () => text, configurable: true });
            Object.defineProperty(this, 'response', { get: () => text, configurable: true });
          } catch (e) {}
        }
        return origSend.apply(this, args);
      });
    }
    return origSend.apply(this, arguments);
  };

  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function(input, init) {
      const url = typeof input === 'string' ? input : (input && (input.url || input.href)) || '';
      if (isSubtitleUrl(url)) {
        return requestTranslation(url).then(text => {
          if (text) {
            return new Response(text, {
              status: 200,
              statusText: 'OK',
              headers: { 'Content-Type': 'application/json' }
            });
          }
          return origFetch.apply(this, arguments);
        });
      }
      return origFetch.apply(this, arguments);
    };
  }
})();
