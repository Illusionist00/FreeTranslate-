(() => {
  if (window.__FT_MAIN__) return;
  window.__FT_MAIN__ = true;

  const DEFAULTS = {
    targetLang: 'zh-CN',
    engine: 'google',
    translateTitle: true,
    autoSites: [],
    neverSites: [],
    showFloatBall: true,
    hoverEnabled: true,
    selectionEnabled: true,
    inputTripleSpace: true,
    subtitleEnabled: true
  };

  const PANEL_LANGS = [
    ['zh-CN', '简体中文'], ['zh-TW', '繁体中文'], ['en', '英语'], ['ja', '日语'],
    ['ko', '韩语'], ['fr', '法语'], ['de', '德语'], ['es', '西班牙语'],
    ['ru', '俄语'], ['pt', '葡萄牙语'], ['it', '意大利语'], ['ar', '阿拉伯语'],
    ['th', '泰语'], ['vi', '越南语']
  ];

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'KBD', 'TEXTAREA', 'SVG', 'MATH', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS', 'AUDIO', 'VIDEO', 'INPUT', 'DATALIST', 'TEMPLATE', 'METER', 'PROGRESS']);
  const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'DD', 'DT', 'FIGCAPTION', 'BLOCKQUOTE', 'CAPTION', 'SUMMARY', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'MAIN', 'HEADER', 'FOOTER', 'SPAN', 'LABEL', 'A', 'BUTTON', 'OPTION']);
  const CONTAINER_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE', 'NAV']);
  const INTERACTIVE_TAGS = new Set(['BUTTON', 'A', 'LABEL', 'OPTION', 'TH', 'TD', 'SUMMARY', 'CAPTION', 'FIGCAPTION']);

  const MAX_BLOCKS = 500;
  const MAX_DYNAMIC = 800;

  let settings = { ...DEFAULTS };
  let mode = 'original';
  let pageState = 'idle';
  let dynamicCount = 0;
  let titleTranslated = false;
  let originalTitle = null;
  let hoverEnabled = true;
  const host = location.hostname;

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

  async function translateTextsConcurrent(texts) {
    const results = new Array(texts.length);
    const refs = new Map();
    const unique = [];
    for (const t of texts) {
      if (!refs.has(t)) { refs.set(t, []); unique.push(t); }
    }
    texts.forEach((t, i) => refs.get(t).push(i));
    const chunkSize = 40;
    let cursor = 0;
    const worker = async () => {
      while (cursor < unique.length) {
        const i = cursor;
        cursor += chunkSize;
        const slice = unique.slice(i, i + chunkSize);
        let tr;
        try {
          tr = await sendTranslate(slice);
        } catch (e) {
          tr = slice.map(() => null);
        }
        slice.forEach((t, j) => {
          const v = (tr && tr[j]) || '';
          for (const pos of refs.get(t)) results[pos] = v;
        });
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    return results;
  }

  function isSkipped(el) {
    if (!el || el.nodeType !== 1) return true;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    if (el.closest('[data-ft-orig],[data-ft-trans],[data-ft-pending],[translate="no"],.notranslate,code,pre,kbd,textarea,input,[data-ft-ignore]')) return true;
    return false;
  }

  function findBlock(el) {
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement) {
      const tag = cur.tagName;
      if (BLOCK_TAGS.has(tag)) {
        if (CONTAINER_TAGS.has(tag)) {
          const hasBlockChild = cur.querySelector('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,table,div,section,article');
          if (hasBlockChild) { cur = cur.parentElement; continue; }
        }
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  function getText(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isTranslateWorthy(text, minLen) {
    const limit = minLen || 4;
    if (text.length < limit) return false;
    if (!/[a-zA-Z\u00C0-\u024F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(text)) return false;
    if (/^[\d\s\W]+$/.test(text)) return false;
    if ((settings.targetLang || '').startsWith('zh')) {
      const cjk = (text.match(/[\u4E00-\u9FFF\u3040-\u30FF]/g) || []).length;
      if (cjk / text.length > 0.5) return false;
    }
    return true;
  }

  function collectBlocks(root) {
    const blocks = new Set();
    const roots = [root || document.body];
    while (roots.length) {
      const r = roots.pop();
      if (!r || (r.nodeType !== 1 && r.nodeType !== 11)) continue;
      const walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.nodeValue;
        if (!text || !text.trim()) continue;
        const parent = node.parentElement;
        if (!parent || isSkipped(parent)) continue;
        let block = findBlock(parent);
        if (!block || isSkipped(block)) continue;
        const btn = block.closest('button');
        if (btn && block !== btn) {
          block = btn;
          if (isSkipped(block)) continue;
        }
        blocks.add(block);
        if (blocks.size > MAX_BLOCKS) return Array.from(blocks).filter(b => isTranslateWorthy(getText(b), INTERACTIVE_TAGS.has(b.tagName) ? 2 : 4));
      }
      r.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) roots.push(el.shadowRoot);
      });
    }
    return Array.from(blocks).filter(b => isTranslateWorthy(getText(b), INTERACTIVE_TAGS.has(b.tagName) ? 2 : 4));
  }

  function isBlockDisplay(disp) {
    return disp === 'block' || disp === 'flex' || disp === 'grid' || disp === 'list-item' ||
      disp === 'table' || disp === 'inline-flex' || disp === 'inline-grid' ||
      disp === 'table-row' || disp === 'table-cell';
  }

  function hasBlockChildren(el) {
    for (const c of el.children) {
      if (isBlockDisplay(getComputedStyle(c).display)) return true;
    }
    return false;
  }

  function isClipped(cs) {
    return cs.overflow === 'hidden' || cs.overflow === 'clip' ||
      cs.overflowX === 'hidden' || cs.overflowX === 'clip' ||
      cs.overflowY === 'hidden' || cs.overflowY === 'clip' ||
      cs.textOverflow === 'ellipsis';
  }

  function choosePlacement(el) {
    const tag = el.tagName;
    const text = getText(el);
    if (tag === 'OPTION') return 'replace';
    const cs = getComputedStyle(el);
    if (isClipped(cs) && cs.whiteSpace === 'nowrap') return 'skip';
    if (INTERACTIVE_TAGS.has(tag) && tag !== 'TH' && tag !== 'TD' && text.length <= 60) return 'right';
    if ((tag === 'TH' || tag === 'TD') && text.length <= 40) return 'right';
    if (cs.display === 'inline' || cs.display === 'inline-block') return 'right';
    const parent = el.parentElement;
    if (parent) {
      const ps = getComputedStyle(parent);
      if ((ps.display === 'flex' || ps.display === 'inline-flex') && ps.flexDirection !== 'column') {
        return 'right';
      }
    }
    if (isClipped(cs)) {
      if (parent) {
        const ps = getComputedStyle(parent);
        if (ps.display === 'grid' || ps.display === 'inline-grid' ||
            ps.display === 'flex' || ps.display === 'inline-flex') {
          return 'skip';
        }
      }
      return 'sibling';
    }
    return 'below';
  }

  function updateOptionTexts() {
    document.querySelectorAll('[data-ft-opt-orig]').forEach(el => {
      const orig = el.dataset.ftOptOrig;
      const trans = el.dataset.ftOptTrans || '';
      if (mode === 'original') el.textContent = orig;
      else if (mode === 'only') el.textContent = trans;
      else el.textContent = orig + ' / ' + trans;
    });
  }

  function applyTranslations(blocks, translations) {
    for (let i = 0; i < blocks.length; i++) {
      const el = blocks[i];
      const tr = translations[i];
      if (!el || !el.isConnected) continue;
      el.removeAttribute('data-ft-pending');
      if (tr == null || !tr) continue;
      if (el.hasAttribute('data-ft-orig')) continue;
      if (hasBlockChildren(el)) continue;
      const placement = choosePlacement(el);
      if (placement === 'skip') continue;
      el.setAttribute('data-ft-orig', '1');
      if (placement === 'replace') {
        el.dataset.ftOptOrig = getText(el);
        el.dataset.ftOptTrans = tr;
        el.textContent = getText(el) + ' / ' + tr;
        continue;
      }
      const wrap = document.createElement('span');
      wrap.className = 'ft-orig-text';
      while (el.firstChild) wrap.appendChild(el.firstChild);
      el.appendChild(wrap);
      if (placement === 'right') {
        const t = document.createElement('span');
        t.className = 'ft-trans-inline';
        t.textContent = tr;
        el.appendChild(t);
        el.setAttribute('data-ft-pos', 'right');
      } else if (placement === 'sibling') {
        const t = document.createElement('div');
        t.className = 'ft-trans-block';
        t.setAttribute('data-ft-trans-sib', '1');
        t.textContent = tr;
        el.insertAdjacentElement('afterend', t);
        el.setAttribute('data-ft-pos', 'sibling');
      } else {
        const t = document.createElement('div');
        t.className = 'ft-trans-block';
        t.textContent = tr;
        el.appendChild(t);
        el.setAttribute('data-ft-pos', 'below');
      }
    }
  }

  function matchSite(pattern, h) {
    const p = String(pattern || '').trim().toLowerCase();
    if (!p) return false;
    if (p === h) return true;
    if (p.includes('*')) {
      const re = new RegExp('^' + p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      return re.test(h);
    }
    return h === p || h.endsWith('.' + p);
  }

  function autoSitesMatched() {
    return (settings.autoSites || []).some(p => matchSite(p, host));
  }

  function neverMatched() {
    return (settings.neverSites || []).some(p => matchSite(p, host));
  }

  function saveSiteState() {
    chrome.storage.local.get('siteStates', ({ siteStates }) => {
      siteStates = siteStates || {};
      siteStates[host] = { mode, at: Date.now() };
      chrome.storage.local.set({ siteStates });
    });
  }

  function collectPlaceholders(root) {
    const out = [];
    const els = (root || document.body).querySelectorAll('input[placeholder], textarea[placeholder]');
    for (const el of els) {
      if (el.dataset.ftPh) continue;
      const ph = (el.getAttribute('placeholder') || '').trim();
      if (ph.length < 2) continue;
      if (!/[a-zA-Z\u00C0-\u024F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(ph)) continue;
      if ((settings.targetLang || '').startsWith('zh')) {
        const cjk = (ph.match(/[\u4E00-\u9FFF\u3040-\u30FF]/g) || []).length;
        if (cjk / ph.length > 0.5) continue;
      }
      out.push(el);
      if (out.length >= 50) break;
    }
    return out;
  }

  async function translatePlaceholders(root) {
    const els = collectPlaceholders(root);
    if (!els.length) return;
    const phs = els.map(el => (el.getAttribute('placeholder') || '').trim());
    const trs = await translateTextsConcurrent(phs);
    els.forEach((el, i) => {
      if (!trs[i]) return;
      el.dataset.ftPhOrig = el.getAttribute('placeholder');
      el.setAttribute('placeholder', trs[i]);
      el.dataset.ftPh = '1';
    });
  }

  function splitVisible(blocks) {
    const vh = window.innerHeight;
    const visible = [];
    const rest = [];
    for (const el of blocks) {
      const r = el.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) visible.push(el);
      else rest.push(el);
    }
    return { visible, rest };
  }

  async function translatePage() {
    if (pageState === 'translating') return;
    pageState = 'translating';
    updateBallState();
    const blocks = collectBlocks(document.body);
    if (!blocks.length) {
      pageState = 'translated';
      document.body.setAttribute('data-ft-mode', 'bilingual');
      mode = 'bilingual';
      saveSiteState();
      return;
    }
    try {
      document.body.setAttribute('data-ft-mode', 'bilingual');
      const { visible, rest } = splitVisible(blocks);
      rest.forEach(el => { el.dataset.ftPending = '1'; });
      if (visible.length) {
        const tr = await translateTextsConcurrent(visible.map(getText));
        applyTranslations(visible, tr);
      }
      mode = 'bilingual';
      pageState = 'translated';
      saveSiteState();
      updateBallState();
      if (settings.translateTitle) translateTitle();
      translatePlaceholders(document.body).catch(() => {});
      if (rest.length) {
        translateTextsConcurrent(rest.map(getText))
          .then(tr => applyTranslations(rest, tr))
          .catch(() => {});
      }
    } catch (e) {
      pageState = 'error';
      console.error('[FreeTranslate] page translation failed:', e);
    }
  }

  function restorePage() {
    document.querySelectorAll('[data-ft-orig]').forEach(n => {
      const trans = n.querySelector(':scope > .ft-trans-block, :scope > .ft-trans-inline');
      if (trans) trans.remove();
      const wrap = n.querySelector(':scope > .ft-orig-text');
      if (wrap) {
        while (wrap.firstChild) n.insertBefore(wrap.firstChild, wrap);
        wrap.remove();
      }
      n.removeAttribute('data-ft-orig');
      n.removeAttribute('data-ft-pos');
    });
    document.querySelectorAll('[data-ft-trans-sib]').forEach(n => n.remove());
    document.querySelectorAll('[data-ft-pending]').forEach(n => n.removeAttribute('data-ft-pending'));
    document.querySelectorAll('[data-ft-opt-orig]').forEach(n => {
      n.textContent = n.dataset.ftOptOrig;
      delete n.dataset.ftOptOrig;
      delete n.dataset.ftOptTrans;
    });
    document.querySelectorAll('[data-ft-ph]').forEach(n => {
      if (n.dataset.ftPhOrig !== undefined) n.setAttribute('placeholder', n.dataset.ftPhOrig);
      delete n.dataset.ftPhOrig;
      delete n.dataset.ftPh;
    });
    document.body.removeAttribute('data-ft-mode');
    if (titleTranslated && originalTitle) {
      document.title = originalTitle;
      titleTranslated = false;
      originalTitle = null;
    }
    mode = 'original';
    pageState = 'idle';
    saveSiteState();
    updateBallState();
  }

  function setMode(m) {
    mode = m;
    if (m === 'original') {
      document.body.setAttribute('data-ft-mode', 'original');
      pageState = 'idle';
    } else {
      document.body.setAttribute('data-ft-mode', m);
      pageState = 'translated';
    }
    updateOptionTexts();
    saveSiteState();
    updateBallState();
  }

  function translateTitle() {
    if (titleTranslated) return;
    sendTranslate([document.title])
      .then(([tr]) => {
        if (tr) {
          originalTitle = document.title;
          document.title = tr;
          titleTranslated = true;
        }
      })
      .catch(() => {});
  }

  let dynamicBusy = false;

  async function processDynamic() {
    if (mode === 'original' || pageState !== 'translated' || dynamicBusy) return;
    if (dynamicCount >= MAX_DYNAMIC) return;
    dynamicBusy = true;
    try {
      const blocks = collectBlocks(document.body);
      if (blocks.length) {
        dynamicCount += blocks.length;
        blocks.forEach(el => { el.dataset.ftPending = '1'; });
        const translations = await translateTextsConcurrent(blocks.map(getText));
        applyTranslations(blocks, translations);
      }
      translatePlaceholders(document.body).catch(() => {});
    } finally {
      dynamicBusy = false;
    }
  }

  function observeMutations() {
    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(processDynamic, 600);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(schedule, 1500);
  }

  async function init() {
    document.documentElement.setAttribute('data-ft-ext', chrome.runtime.getManifest().version);
    const s = await chrome.storage.sync.get(DEFAULTS);
    settings = { ...DEFAULTS, ...s };
    hoverEnabled = settings.hoverEnabled !== false;
    if (settings.showFloatBall !== false) createBall();
    if (neverMatched()) return;
    const { siteStates } = await chrome.storage.local.get('siteStates');
    const st = siteStates && siteStates[host];
    if (st && st.mode === 'bilingual') {
      mode = 'bilingual';
      document.body.setAttribute('data-ft-mode', 'bilingual');
    }
    observeMutations();
    const shouldAuto = autoSitesMatched() && (!st || st.mode !== 'bilingual');
    if (shouldAuto) setTimeout(() => translatePage(), 600);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'getPageState') {
      sendResponse({ ok: true, mode, pageState, host, isNever: neverMatched() });
      return;
    }
    if (msg.type === 'translatePage') { translatePage(); sendResponse({ ok: true }); return; }
    if (msg.type === 'restorePage') { restorePage(); sendResponse({ ok: true }); return; }
    if (msg.type === 'setMode') { setMode(msg.mode); sendResponse({ ok: true }); return; }
    if (msg.type === 'cmd') {
      if (msg.cmd === 'toggle-translate-page') { if (mode === 'original') translatePage(); else restorePage(); }
      if (msg.cmd === 'toggle-only-translation') {
        if (mode === 'only') setMode('bilingual');
        else if (mode === 'bilingual') setMode('only');
        else translatePage();
      }
      sendResponse({ ok: true });
      return;
    }
  });

  let ball = null;
  let ballChip = null;
  let ballPanel = null;
  let ballDrag = null;
  let chipTimer = null;
  let langSelEl = null;
  const segBtns = [];
  const panelChecks = {};

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function hideChip() {
    clearTimeout(chipTimer);
    if (ballChip) ballChip.style.display = 'none';
  }

  function positionChip() {
    if (!ball || !ballChip) return;
    const r = ball.getBoundingClientRect();
    ballChip.style.top = (r.top + r.height / 2 - ballChip.offsetHeight / 2) + 'px';
    ballChip.style.right = (window.innerWidth - r.left + 8) + 'px';
  }

  function showChip() {
    if (ballPanel && ballPanel.style.display === 'block') return;
    if (!ballChip) {
      ballChip = document.createElement('div');
      ballChip.id = 'ft-ball-chip';
      ballChip.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg><span>控制面板</span>';
      document.documentElement.appendChild(ballChip);
      ballChip.addEventListener('mouseenter', () => clearTimeout(chipTimer));
      ballChip.addEventListener('mouseleave', () => { chipTimer = setTimeout(hideChip, 250); });
      ballChip.addEventListener('click', e => {
        e.stopPropagation();
        openPanel();
      });
    }
    positionChip();
    ballChip.style.display = 'flex';
  }

  function closePanel() {
    if (ballPanel) ballPanel.style.display = 'none';
  }

  function openPanel() {
    hideChip();
    if (!ballPanel) buildPanel();
    refreshPanel();
    const r = ball.getBoundingClientRect();
    ballPanel.style.display = 'block';
    ballPanel.style.right = (window.innerWidth - r.left + 10) + 'px';
    ballPanel.style.top = clamp(r.top, 8, window.innerHeight - ballPanel.offsetHeight - 8) + 'px';
  }

  function buildPanel() {
    ballPanel = document.createElement('div');
    ballPanel.id = 'ft-ball-panel';

    const head = document.createElement('div');
    head.className = 'ft-panel-head';
    const title = document.createElement('span');
    title.textContent = '控制面板';
    const close = document.createElement('span');
    close.className = 'ft-panel-close';
    close.textContent = '×';
    close.addEventListener('click', closePanel);
    head.append(title, close);
    ballPanel.appendChild(head);

    const secMode = document.createElement('div');
    secMode.className = 'ft-panel-sec';
    const modeLabel = document.createElement('div');
    modeLabel.className = 'ft-panel-label';
    modeLabel.textContent = '显示模式';
    secMode.appendChild(modeLabel);
    const seg = document.createElement('div');
    seg.className = 'ft-seg';
    for (const [v, label] of [['bilingual', '双语'], ['only', '仅译文'], ['original', '原文']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.mode = v;
      b.addEventListener('click', () => {
        setMode(v);
        refreshPanel();
      });
      seg.appendChild(b);
      segBtns.push(b);
    }
    secMode.appendChild(seg);
    ballPanel.appendChild(secMode);

    const secLang = document.createElement('div');
    secLang.className = 'ft-panel-sec';
    const langLabel = document.createElement('div');
    langLabel.className = 'ft-panel-label';
    langLabel.textContent = '目标语言';
    secLang.appendChild(langLabel);
    langSelEl = document.createElement('select');
    for (const [code, name] of PANEL_LANGS) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = name;
      langSelEl.appendChild(opt);
    }
    const more = document.createElement('option');
    more.value = '__more__';
    more.textContent = '更多语言…';
    langSelEl.appendChild(more);
    langSelEl.addEventListener('change', () => {
      if (langSelEl.value === '__more__') {
        chrome.runtime.sendMessage({ type: 'openOptions' });
        langSelEl.value = settings.targetLang;
        return;
      }
      settings.targetLang = langSelEl.value;
      chrome.storage.sync.set({ targetLang: langSelEl.value });
    });
    secLang.appendChild(langSelEl);
    const hint = document.createElement('div');
    hint.className = 'ft-panel-hint';
    hint.textContent = '修改后需重新翻译当前页面生效';
    secLang.appendChild(hint);
    ballPanel.appendChild(secLang);

    const secToggles = document.createElement('div');
    secToggles.className = 'ft-panel-sec';
    const tLabel = document.createElement('div');
    tLabel.className = 'ft-panel-label';
    tLabel.textContent = '功能开关';
    secToggles.appendChild(tLabel);
    for (const [key, label] of [['hoverEnabled', '悬停翻译'], ['selectionEnabled', '划词翻译'], ['inputTripleSpace', '输入框翻译']]) {
      const row = document.createElement('label');
      row.className = 'ft-panel-toggle';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => {
        const data = {};
        data[key] = cb.checked;
        chrome.storage.sync.set(data);
        if (key === 'hoverEnabled') hoverEnabled = cb.checked;
      });
      row.append(cb, document.createTextNode(label));
      secToggles.appendChild(row);
      panelChecks[key] = cb;
    }
    ballPanel.appendChild(secToggles);

    const foot = document.createElement('div');
    foot.className = 'ft-panel-foot';
    const optBtn = document.createElement('button');
    optBtn.textContent = '完整设置';
    optBtn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'openOptions' }));
    foot.appendChild(optBtn);
    ballPanel.appendChild(foot);

    document.documentElement.appendChild(ballPanel);
  }

  function refreshPanel() {
    if (!ballPanel) return;
    for (const b of segBtns) b.classList.toggle('active', b.dataset.mode === mode);
    if (langSelEl && settings.targetLang) langSelEl.value = settings.targetLang;
    chrome.storage.sync.get(DEFAULTS, s => {
      const cur = { ...DEFAULTS, ...s };
      for (const k of Object.keys(panelChecks)) panelChecks[k].checked = !!cur[k];
    });
  }

  function toggleTranslate() {
    if (pageState === 'translating') return;
    if (mode === 'original') translatePage();
    else restorePage();
  }

  function updateBallState() {
    if (!ball) return;
    if (pageState === 'translating') {
      ball.classList.add('ft-ball-loading');
      ball.classList.remove('ft-ball-done');
      ball.textContent = '译';
    } else if (mode !== 'original') {
      ball.classList.remove('ft-ball-loading');
      ball.classList.add('ft-ball-done');
      ball.textContent = '原';
      ball.title = 'FreeTranslate - 点击恢复原文';
    } else {
      ball.classList.remove('ft-ball-loading', 'ft-ball-done');
      ball.textContent = '译';
      ball.title = 'FreeTranslate - 点击翻译本页';
    }
  }

  function createBall() {
    if (ball) return;
    ball = document.createElement('div');
    ball.id = 'ft-ball';
    ball.textContent = '译';
    ball.title = 'FreeTranslate';
    document.documentElement.appendChild(ball);

    chrome.storage.local.get('ballY', ({ ballY }) => {
      if (typeof ballY === 'number') {
        ball.style.top = clamp(ballY, 8, window.innerHeight - 46) + 'px';
      }
    });

    ball.addEventListener('pointerdown', e => {
      ballDrag = { sy: e.clientY, oy: ball.offsetTop, moved: false };
      try { ball.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    ball.addEventListener('pointermove', e => {
      if (!ballDrag) return;
      const dy = e.clientY - ballDrag.sy;
      if (Math.abs(dy) > 4) ballDrag.moved = true;
      if (ballDrag.moved) {
        ball.style.top = clamp(ballDrag.oy + dy, 8, window.innerHeight - ball.offsetHeight - 8) + 'px';
        hideChip();
      }
    });
    ball.addEventListener('pointerup', e => {
      if (!ballDrag) return;
      if (!ballDrag.moved) {
        toggleTranslate();
        updateBallState();
      } else {
        hideChip();
      }
      chrome.storage.local.set({ ballY: ball.offsetTop });
      ballDrag = null;
    });
    ball.addEventListener('pointercancel', () => { ballDrag = null; });

    ball.addEventListener('mouseenter', () => {
      clearTimeout(chipTimer);
      chipTimer = setTimeout(showChip, 250);
    });
    ball.addEventListener('mouseleave', () => {
      chipTimer = setTimeout(hideChip, 300);
    });

    document.addEventListener('mousedown', e => {
      const onPanel = ballPanel && ballPanel.style.display === 'block' && ballPanel.contains(e.target);
      const onChip = ballChip && ballChip.contains(e.target);
      if (!onPanel && !onChip && !ball.contains(e.target)) {
        closePanel();
        hideChip();
      }
    }, true);

    window.addEventListener('resize', () => {
      if (ball) {
        ball.style.top = clamp(ball.offsetTop, 8, window.innerHeight - 46) + 'px';
      }
      closePanel();
      hideChip();
    });
  }

  window.__FT__ = { translatePage, restorePage, setMode, getState: () => ({ mode, pageState, host }) };

  init();
})();
