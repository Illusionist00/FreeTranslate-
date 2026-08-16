(() => {
  if (window.__FT_YTHOOK__) return;
  window.__FT_YTHOOK__ = true;

  const SUB_RE = /(^|\/)(api\/timedtext|timedtext)(\?|$)/i;

  function isSubtitleUrl(url) {
    return typeof url === 'string' && SUB_RE.test(url);
  }

  function extractPayload(xhr) {
    try {
      if (xhr.responseText) return xhr.responseText;
      if (typeof xhr.response === 'string') return xhr.response;
      if (xhr.response) return JSON.stringify(xhr.response);
    } catch (e) {}
    return null;
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
      try {
        this.addEventListener('loadend', () => {
          try {
            if (this.status === 200) {
              const payload = extractPayload(this);
              if (payload) window.postMessage({ __ft: 'sub-track', url, text: payload }, '*');
            }
          } catch (e) {}
        });
      } catch (e) {}
    }
    return origSend.apply(this, arguments);
  };

  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function(input, init) {
      const url = typeof input === 'string' ? input : (input && (input.url || input.href)) || '';
      if (isSubtitleUrl(url)) {
        const p = origFetch.apply(this, arguments);
        p.then(res => {
          try {
            res.clone().text().then(t => {
              if (t) window.postMessage({ __ft: 'sub-track', url, text: t }, '*');
            }).catch(() => {});
          } catch (e) {}
        }).catch(() => {});
        return p;
      }
      return origFetch.apply(this, arguments);
    };
  }
})();
