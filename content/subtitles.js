(() => {
  if (window.__FT_SUBS__) return;
  window.__FT_SUBS__ = true;

  const DEFAULTS = {
    targetLang: 'zh-CN',
    engine: 'google',
    subtitleEnabled: true,
    subPosition: 'below',
    subScale: 'medium'
  };
  const SCALES = { small: 0.8, medium: 0.9, large: 1.0 };
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
  style.textContent = `
    .ft-sub-overlay { position: absolute; left: 0; right: 0; text-align: center; color: #ffe97a; font-family: "YouTube Noto", Roboto, Arial, sans-serif; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9); pointer-events: none; z-index: 25; white-space: normal; line-height: 1.35; display: none; }
    .ft-yt-btn { color: #fff !important; font-size: 18px; font-weight: 700; width: 46px; height: 100%; display: inline-flex !important; align-items: center; justify-content: center; line-height: 1; padding: 0 !important; margin: 0 !important; border: none; background: none; vertical-align: middle; }
    .ft-yt-btn.ft-sub-on { color: #3ea6ff !important; }
    .ytp-autohide .ft-yt-popup { display: none !important; }
    .ft-yt-popup { position: absolute; right: 16px; bottom: 56px; z-index: 72; width: 240px; display: none; padding: 10px 12px; background: rgba(28, 28, 28, 0.95); border-radius: 12px; color: #f1f1f1; font-family: Roboto, Arial, "Microsoft YaHei", sans-serif; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.5); }
    .ft-yt-row { display: flex; align-items: center; justify-content: space-between; padding: 7px 0; font-size: 14px; }
    .ft-yt-seg { display: flex; background: rgba(255, 255, 255, 0.12); border-radius: 6px; padding: 2px; }
    .ft-yt-seg button { border: none; background: none; padding: 4px 10px; border-radius: 5px; font-size: 12px; cursor: pointer; color: #ddd; }
    .ft-yt-seg button.ft-seg-active { background: rgba(255, 255, 255, 0.92); color: #0f0f0f; font-weight: 600; }
    .ft-yt-switch { position: relative; display: inline-block; width: 36px; height: 20px; }
    .ft-yt-switch input { display: none; }
    .ft-yt-switch-slider { position: absolute; inset: 0; background: rgba(255, 255, 255, 0.3); border-radius: 10px; cursor: pointer; transition: 0.2s; }
    .ft-yt-switch-slider::before { content: ""; position: absolute; width: 16px; height: 16px; left: 2px; top: 2px; background: #fff; border-radius: 50%; transition: 0.2s; }
    .ft-yt-switch input:checked + .ft-yt-switch-slider { background: #3ea6ff; }
    .ft-yt-switch input:checked + .ft-yt-switch-slider::before { transform: translateX(16px); }
  `;
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
  let ytBtn = null;
  let ytPopup = null;
  let nativeActive = false;

  function baseLang(code) {
    return String(code || '').toLowerCase().split('-')[0];
  }

  function langOf(url) {
    try {
      return (new URL(url).searchParams.get('lang') || '').toLowerCase();
    } catch (e) {
      return '';
    }
  }

  async function translateBatch(texts) {
    const out = new Array(texts.length).fill('');
    const CHUNK = 40;
    let ci = 0;
    const worker = async () => {
      while (ci < texts.length) {
        const i = ci;
        ci += CHUNK;
        const slice = texts.slice(i, i + CHUNK);
        try {
          const tr = await sendTranslate(slice);
          slice.forEach((t, j) => { out[i + j] = (tr && tr[j]) || ''; });
        } catch (e) {}
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));
    return out;
  }

  function replySubReq(id, text) {
    window.postMessage({ __ft: 'sub-res', id, text }, '*');
  }

  async function handleSubRequest(id, url) {
    try {
      const trackLang = langOf(url);
      if (trackLang && baseLang(trackLang) === baseLang(settings.targetLang)) {
        replySubReq(id, null);
        return;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error('http ' + res.status);
      const data = await res.json();
      if (!data || !Array.isArray(data.events)) throw new Error('not json3');
      const cues = [];
      data.events.forEach(ev => {
        const t = (ev.segs || []).map(s => s.utf8 || '').join('\n');
        if (t.trim()) cues.push(t);
      });
      if (!cues.length) throw new Error('no cues');
      const translations = await translateBatch(cues);
      let ti = 0;
      data.events.forEach(ev => {
        const t = (ev.segs || []).map(s => s.utf8 || '').join('\n');
        if (!t.trim()) return;
        const tr = translations[ti++];
        if (!tr) return;
        ev.segs = [{ utf8: settings.subPosition === 'above' ? tr + '\n' + t : t + '\n' + tr }];
      });
      nativeActive = true;
      hideOverlay();
      replySubReq(id, JSON.stringify(data));
    } catch (e) {
      replySubReq(id, null);
    }
  }

  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || e.data.__ft !== 'sub-req') return;
    handleSubRequest(e.data.id, e.data.url);
  });

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
    if (segs.length) {
      const fs = parseFloat(getComputedStyle(segs[0]).fontSize);
      if (fs) o.style.fontSize = (fs * (SCALES[settings.subScale] || 0.9)) + 'px';
    }
    o.style.display = 'block';
    const c = o.parentElement.getBoundingClientRect();
    let maxBottom = c.top;
    let minTop = Infinity;
    for (const s of segs) {
      const r = s.getBoundingClientRect();
      if (r.bottom > maxBottom) maxBottom = r.bottom;
      if (r.top < minTop) minTop = r.top;
    }
    if (settings.subPosition === 'above') {
      const h = o.offsetHeight || 24;
      o.style.top = (minTop - c.top - h - 6) + 'px';
    } else {
      o.style.top = Math.max(0, maxBottom - c.top + 6) + 'px';
    }
  }

  function hideOverlay() {
    if (overlay) overlay.style.display = 'none';
  }

  function tick() {
    ensureButton();
    if (nativeActive) return;
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

  function updateBtnState() {
    if (!ytBtn) return;
    ytBtn.classList.toggle('ft-sub-on', !!settings.subtitleEnabled);
    ytBtn.title = settings.subtitleEnabled ? 'FreeTranslate 字幕翻译：开' : 'FreeTranslate 字幕翻译：关';
  }

  function ensureButton() {
    try {
      if (ytBtn && ytBtn.isConnected) { updateBtnState(); return; }
      const controls = document.querySelector('.ytp-right-controls');
      if (!controls) return;
      ytBtn = document.createElement('button');
      ytBtn.className = 'ytp-button ft-yt-btn';
      ytBtn.textContent = '译';
      ytBtn.setAttribute('aria-label', 'FreeTranslate 字幕翻译');
      ytBtn.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        togglePopup();
      });
      const leftCluster = controls.querySelector('.ytp-right-controls-left');
      if (leftCluster) {
        const settingsBtn = leftCluster.querySelector('.ytp-settings-button');
        if (settingsBtn) leftCluster.insertBefore(ytBtn, settingsBtn);
        else leftCluster.appendChild(ytBtn);
      } else {
        controls.appendChild(ytBtn);
      }
      updateBtnState();
    } catch (e) {}
  }

  function buildPopup() {
    const player = document.querySelector('.html5-video-player');
    if (!player || (ytPopup && ytPopup.isConnected)) return;
    ytPopup = document.createElement('div');
    ytPopup.className = 'ft-yt-popup';
    ytPopup.addEventListener('mousedown', e => e.stopPropagation());
    ytPopup.addEventListener('click', e => e.stopPropagation());

    const mkRow = () => {
      const d = document.createElement('div');
      d.className = 'ft-yt-row';
      return d;
    };

    const row1 = mkRow();
    const lbl1 = document.createElement('span');
    lbl1.textContent = '字幕翻译';
    const sw = document.createElement('label');
    sw.className = 'ft-yt-switch';
    const swInput = document.createElement('input');
    swInput.type = 'checkbox';
    swInput.addEventListener('change', () => {
      settings.subtitleEnabled = swInput.checked;
      chrome.storage.sync.set({ subtitleEnabled: swInput.checked });
      updateBtnState();
      if (!swInput.checked) hideOverlay();
    });
    const swSlider = document.createElement('span');
    swSlider.className = 'ft-yt-switch-slider';
    sw.append(swInput, swSlider);
    row1.append(lbl1, sw);
    ytPopup.appendChild(row1);

    const row2 = mkRow();
    const lbl2 = document.createElement('span');
    lbl2.textContent = '译文位置';
    const seg2 = document.createElement('div');
    seg2.className = 'ft-yt-seg';
    for (const [v, label] of [['below', '下方'], ['above', '上方']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.pos = v;
      b.addEventListener('click', () => {
        settings.subPosition = v;
        chrome.storage.sync.set({ subPosition: v });
        refreshPopup();
      });
      seg2.appendChild(b);
    }
    row2.append(lbl2, seg2);
    ytPopup.appendChild(row2);

    const row3 = mkRow();
    const lbl3 = document.createElement('span');
    lbl3.textContent = '译文字号';
    const seg3 = document.createElement('div');
    seg3.className = 'ft-yt-seg';
    for (const [v, label] of [['small', '小'], ['medium', '中'], ['large', '大']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.scale = v;
      b.addEventListener('click', () => {
        settings.subScale = v;
        chrome.storage.sync.set({ subScale: v });
        refreshPopup();
      });
      seg3.appendChild(b);
    }
    row3.append(lbl3, seg3);
    ytPopup.appendChild(row3);

    player.appendChild(ytPopup);
  }

  function refreshPopup() {
    if (!ytPopup) return;
    const input = ytPopup.querySelector('input[type=checkbox]');
    if (input) input.checked = settings.subtitleEnabled;
    ytPopup.querySelectorAll('[data-pos]').forEach(b => b.classList.toggle('ft-seg-active', b.dataset.pos === settings.subPosition));
    ytPopup.querySelectorAll('[data-scale]').forEach(b => b.classList.toggle('ft-seg-active', b.dataset.scale === settings.subScale));
  }

  function togglePopup() {
    buildPopup();
    if (!ytPopup) return;
    if (ytPopup.style.display === 'block') {
      ytPopup.style.display = 'none';
      return;
    }
    refreshPopup();
    ytPopup.style.display = 'block';
  }

  document.addEventListener('mousedown', e => {
    if (ytPopup && ytPopup.style.display === 'block' &&
        !ytPopup.contains(e.target) && !(ytBtn && ytBtn.contains(e.target))) {
      ytPopup.style.display = 'none';
    }
  }, true);

  let moTimer = null;
  const mo = new MutationObserver(() => {
    clearTimeout(moTimer);
    moTimer = setTimeout(tick, 120);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setInterval(tick, 800);
  tick();
})();
