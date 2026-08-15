(() => {
  if (window.__FT_SUBS__) return;
  window.__FT_SUBS__ = true;

  const DEFAULTS = { targetLang: 'zh-CN', engine: 'google', subtitleEnabled: true };
  let settings = { ...DEFAULTS };
  const tCache = new Map();

  chrome.storage.sync.get(DEFAULTS, s => { settings = { ...DEFAULTS, ...s }; });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'sync') return;
    for (const k of Object.keys(DEFAULTS)) {
      if (ch[k]) settings[k] = ch[k].newValue;
    }
  });

  const style = document.createElement('style');
  style.textContent = '.ft-sub { color: #ffe97a !important; }';
  document.documentElement.appendChild(style);

  function sendTranslate(texts) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: 'translate', texts, to: settings.targetLang, engine: settings.engine }, resp => {
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
          if (resp && resp.ok) resolve(resp.translations);
          else reject(new Error(resp && resp.error ? resp.error : 'translate failed'));
        });
      } catch (e) { reject(e); }
    });
  }

  async function translateCached(text) {
    const key = settings.engine + '|' + settings.targetLang + '|' + text;
    if (tCache.has(key)) return tCache.get(key);
    try {
      const tr = await sendTranslate([text]);
      const v = (tr && tr[0]) || '';
      if (tCache.size > 800) tCache.delete(tCache.keys().next().value);
      tCache.set(key, v);
      return v;
    } catch (e) {
      return null;
    }
  }

  function processSegments() {
    if (!settings.subtitleEnabled) return;
    const segs = document.querySelectorAll('.ytp-caption-segment:not([data-ft-sub])');
    for (const seg of segs) {
      seg.setAttribute('data-ft-sub', '1');
      const text = (seg.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      translateCached(text).then(tr => {
        if (!tr || !seg.isConnected) return;
        if (seg.querySelector('.ft-sub')) return;
        const br = document.createElement('br');
        const span = document.createElement('span');
        span.className = 'ft-sub';
        span.textContent = tr;
        seg.appendChild(br);
        seg.appendChild(span);
      });
    }
  }

  let timer = null;
  const mo = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(processSegments, 250);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setInterval(processSegments, 3000);
  processSegments();
})();
