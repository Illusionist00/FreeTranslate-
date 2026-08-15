(() => {
  if (window.__FT_TOOLS__) return;
  window.__FT_TOOLS__ = true;

  const DEFAULTS = {
    targetLang: 'zh-CN',
    engine: 'google',
    hoverEnabled: true,
    hoverKey: 'Ctrl',
    selectionEnabled: true,
    inputTripleSpace: true
  };

  let settings = { ...DEFAULTS };
  const tCache = new Map();

  chrome.storage.sync.get(DEFAULTS, s => { settings = { ...DEFAULTS, ...s }; });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'sync') return;
    for (const k of Object.keys(DEFAULTS)) {
      if (ch[k]) settings[k] = ch[k].newValue;
    }
  });

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
      if (tCache.size > 500) tCache.delete(tCache.keys().next().value);
      tCache.set(key, v);
      return v;
    } catch (e) {
      return null;
    }
  }

  let tipEl = null;
  function getTip() {
    if (tipEl && tipEl.isConnected) return tipEl;
    tipEl = document.createElement('div');
    tipEl.id = 'ft-tooltip';
    document.documentElement.appendChild(tipEl);
    return tipEl;
  }

  function showTip(x, y, original, translation) {
    const tip = getTip();
    tip.textContent = '';
    const o = document.createElement('div');
    o.className = 'ft-tip-orig';
    o.textContent = original;
    const t = document.createElement('div');
    t.className = 'ft-tip-trans';
    t.textContent = translation || '(翻译失败)';
    tip.append(o, t);
    tip.style.display = 'block';
    const pad = 14;
    let left = x + pad;
    let top = y + pad;
    const r = tip.getBoundingClientRect();
    if (left + r.width > window.innerWidth - 8) left = x - r.width - pad;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - pad;
    tip.style.left = Math.max(4, left) + 'px';
    tip.style.top = Math.max(4, top) + 'px';
  }

  function hideTip() {
    if (tipEl) tipEl.style.display = 'none';
  }

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') return ['text', 'search', 'email', 'url', 'tel'].includes(el.type || '');
    return false;
  }

  function modifierActive(e, key) {
    if (key === 'Ctrl') return e.ctrlKey;
    if (key === 'Alt') return e.altKey;
    if (key === 'Shift') return e.shiftKey;
    if (key === 'Meta') return e.metaKey;
    return true;
  }

  function wordAtPoint(x, y) {
    if (!document.caretRangeFromPoint) return null;
    const range = document.caretRangeFromPoint(x, y);
    if (!range || range.startContainer.nodeType !== 3) return null;
    const text = range.startContainer.nodeValue;
    if (!text) return null;
    let s = range.startOffset;
    let e = range.endOffset;
    const isWord = c => c ? /[\p{L}\p{N}'’-]/u.test(c) : false;
    while (s > 0 && isWord(text[s - 1])) s--;
    while (e < text.length && isWord(text[e])) e++;
    if (e <= s) return null;
    const word = text.slice(s, e).trim();
    if (!word) return null;
    if (word.length <= 30) return word;
    const ch = text.slice(Math.max(0, range.startOffset - 1), range.startOffset).trim();
    return ch || word.slice(0, 20);
  }

  let hoverTimer = null;
  let lastWord = null;

  document.addEventListener('mousemove', e => {
    if (!settings.hoverEnabled) { hideTip(); return; }
    const target = e.target;
    if (target && (target.id === 'ft-tooltip' || target.id === 'ft-sel-btn')) return;
    if (target && (isEditable(target) || (target.closest && target.closest('[contenteditable="true"],input,textarea,select')))) { hideTip(); return; }
    if (!modifierActive(e, settings.hoverKey)) { hideTip(); clearTimeout(hoverTimer); return; }
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(async () => {
      const word = wordAtPoint(e.clientX, e.clientY);
      if (!word || word === lastWord) { if (!word) hideTip(); return; }
      lastWord = word;
      const tr = await translateCached(word);
      if (tr == null) { hideTip(); return; }
      showTip(e.clientX, e.clientY, word, tr);
    }, 280);
  });

  document.addEventListener('keyup', e => {
    if (!modifierActive(e, settings.hoverKey)) { hideTip(); lastWord = null; }
  });
  document.addEventListener('mousedown', () => { hideTip(); lastWord = null; });
  window.addEventListener('scroll', () => hideTip(), true);

  let selBtn = null;
  let selTimer = null;
  let lastSelRect = null;

  function getSelBtn() {
    if (selBtn && selBtn.isConnected) return selBtn;
    selBtn = document.createElement('div');
    selBtn.id = 'ft-sel-btn';
    selBtn.textContent = '译';
    selBtn.style.display = 'none';
    selBtn.addEventListener('mousedown', e => e.stopPropagation());
    selBtn.addEventListener('click', async () => {
      const text = selBtn.dataset.selText || '';
      const rect = lastSelRect;
      selBtn.style.display = 'none';
      if (!text) return;
      const tr = await translateCached(text);
      if (tr == null) return;
      showTip(rect ? rect.right : window.innerWidth / 2, rect ? rect.bottom : 100, text, tr);
    });
    document.documentElement.appendChild(selBtn);
    return selBtn;
  }

  function checkSelection() {
    if (!settings.selectionEnabled) {
      if (selBtn) selBtn.style.display = 'none';
      return;
    }
    const sel = window.getSelection();
    const text = sel && sel.toString().trim();
    if (!text || text.length > 3000) {
      if (selBtn) selBtn.style.display = 'none';
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      if (selBtn) selBtn.style.display = 'none';
      return;
    }
    lastSelRect = rect;
    const btn = getSelBtn();
    btn.dataset.selText = text;
    btn.style.display = 'flex';
    btn.style.left = (window.scrollX + rect.right + 6) + 'px';
    btn.style.top = (window.scrollY + rect.bottom - 28) + 'px';
  }

  document.addEventListener('mouseup', () => setTimeout(checkSelection, 50));
  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(checkSelection, 250);
  });

  async function translateEditable(el) {
    const isInput = typeof el.value === 'string';
    const text = (isInput ? el.value : el.textContent || '').trim();
    if (!text) return;
    const tr = await translateCached(text);
    if (tr == null) { toast('翻译失败'); return; }
    if (isInput) {
      el.value = tr;
    } else {
      el.textContent = tr;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    toast('已翻译');
  }

  let toastTimer = null;
  function toast(text) {
    let t = document.getElementById('ft-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'ft-toast';
      document.documentElement.appendChild(t);
    }
    t.textContent = text;
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, 1600);
  }

  document.addEventListener('focusin', e => {
    const el = e.target;
    if (!isEditable(el) || el.dataset.ftInputBound) return;
    el.dataset.ftInputBound = '1';
    let presses = [];
    el.addEventListener('keydown', ev => {
      if (!settings.inputTripleSpace) return;
      if (ev.key === ' ' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        const now = Date.now();
        presses = presses.filter(t => now - t < 1500);
        presses.push(now);
        if (presses.length >= 3) {
          presses = [];
          ev.preventDefault();
          ev.stopPropagation();
          translateEditable(el);
        }
      } else {
        presses = [];
      }
    }, true);
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'cmd') return;
    if (msg.cmd === 'translate-input') {
      const el = document.activeElement;
      if (isEditable(el)) translateEditable(el);
      sendResponse({ ok: true });
    } else if (msg.cmd === 'toggle-hover') {
      settings.hoverEnabled = !settings.hoverEnabled;
      sendResponse({ ok: true, hoverEnabled: settings.hoverEnabled });
    }
  });
})();
