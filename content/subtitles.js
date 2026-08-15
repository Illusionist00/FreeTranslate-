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
  style.textContent = '.ft-sub-overlay { position: absolute; left: 0; right: 0; text-align: center; color: #ffe97a; font-family: "YouTube Noto", Roboto, Arial, sans-serif; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9); pointer-events: none; z-index: 25; white-space: normal; line-height: 1.35; display: none; }';
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

  let overlay = null;
  let lastTickText = '';
  let shownSource = '';
  let stabTimer = null;

  function getContainer() {
    return document.querySelector('.ytp-caption-window-container');
  }

  function getVisibleSegments() {
    const out = [];
    const segs = document.querySelectorAll('.ytp-caption-segment');
    for (const s of segs) {
      const r = s.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(s);
    }
    return out;
  }

  function getVisibleText() {
    return getVisibleSegments()
      .map(s => (s.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ');
  }

  function ensureOverlay() {
    const container = getContainer();
    if (!container) return null;
    if (overlay && overlay.parentElement === container) return overlay;
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.className = 'ft-sub-overlay';
    container.appendChild(overlay);
    return overlay;
  }

  function showOverlay(text, segs) {
    const o = ensureOverlay();
    if (!o) return;
    o.textContent = text;
    const c = o.parentElement.getBoundingClientRect();
    let maxBottom = c.top;
    for (const s of segs) {
      const r = s.getBoundingClientRect();
      if (r.bottom > maxBottom) maxBottom = r.bottom;
    }
    o.style.top = Math.max(0, maxBottom - c.top + 6) + 'px';
    if (segs.length) {
      const fs = parseFloat(getComputedStyle(segs[0]).fontSize);
      if (fs) o.style.fontSize = (fs * 0.9) + 'px';
    }
    o.style.display = 'block';
  }

  function hideOverlay() {
    if (overlay) overlay.style.display = 'none';
  }

  function tick() {
    if (!settings.subtitleEnabled) { hideOverlay(); return; }
    const segs = getVisibleSegments();
    const text = getVisibleText();
    if (!text) {
      hideOverlay();
      lastTickText = '';
      shownSource = '';
      clearTimeout(stabTimer);
      return;
    }
    if (text !== lastTickText) {
      lastTickText = text;
      clearTimeout(stabTimer);
      stabTimer = setTimeout(tick, 350);
      return;
    }
    if (text !== shownSource) {
      translateCached(text).then(tr => {
        if (!tr || !settings.subtitleEnabled) return;
        if (text !== getVisibleText()) return;
        showOverlay(tr, getVisibleSegments());
        shownSource = text;
      });
    }
  }

  let moTimer = null;
  const mo = new MutationObserver(() => {
    clearTimeout(moTimer);
    moTimer = setTimeout(tick, 120);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setInterval(tick, 800);
  tick();
})();
