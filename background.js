const DEFAULTS = {
  targetLang: 'zh-CN',
  engine: 'google',
  hoverEnabled: true,
  hoverKey: 'Ctrl',
  selectionEnabled: true,
  inputTripleSpace: true,
  subtitleEnabled: true,
  translateTitle: true,
  autoSites: [],
  neverSites: [],
  showFloatBall: true
};

const cache = new Map();
const CACHE_MAX = 3000;

function cacheKey(engine, to, text) {
  return engine + '|' + to + '|' + text;
}

function cacheGet(key) {
  if (!cache.has(key)) return null;
  const v = cache.get(key);
  cache.delete(key);
  cache.set(key, v);
  return v;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
}

const BATCH_MAX_ITEMS = 40;
const BATCH_MAX_CHARS = 3800;

async function googleBatch(texts, to) {
  try {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
      encodeURIComponent(to) + '&dt=t&q=' + encodeURIComponent(texts.join('\n'));
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    let full = '';
    if (Array.isArray(data) && Array.isArray(data[0])) {
      for (const seg of data[0]) {
        if (seg && seg[0]) full += seg[0];
      }
    }
    const parts = full.split('\n');
    while (parts.length > texts.length && parts[parts.length - 1] === '') parts.pop();
    if (parts.length === texts.length) return parts;
    return null;
  } catch (e) {
    return null;
  }
}

async function googleSingle(text, to) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
    encodeURIComponent(to) + '&dt=t&q=' + encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw new Error('google http ' + res.status);
  const data = await res.json();
  let full = '';
  if (Array.isArray(data) && Array.isArray(data[0])) {
    for (const seg of data[0]) {
      if (seg && seg[0]) full += seg[0];
    }
  }
  return full;
}

async function googleTranslate(texts, to) {
  const out = new Array(texts.length).fill('');
  const pending = [];
  for (let i = 0; i < texts.length; i++) {
    const key = cacheKey('google', to, texts[i]);
    const hit = cacheGet(key);
    if (hit != null) { out[i] = hit; continue; }
    pending.push({ i, text: texts[i] });
  }
  if (!pending.length) return out;

  const chunks = [];
  let cur = [];
  let curLen = 0;
  for (const p of pending) {
    if (cur.length >= BATCH_MAX_ITEMS || (cur.length && curLen + p.text.length > BATCH_MAX_CHARS)) {
      chunks.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(p);
    curLen += p.text.length;
  }
  if (cur.length) chunks.push(cur);

  let ci = 0;
  const worker = async () => {
    while (ci < chunks.length) {
      const chunk = chunks[ci++];
      const batchRes = await googleBatch(chunk.map(p => p.text), to);
      if (batchRes) {
        chunk.forEach((p, j) => {
          out[p.i] = batchRes[j] || '';
          cacheSet(cacheKey('google', to, p.text), out[p.i]);
        });
      } else {
        for (const p of chunk) {
          try {
            const tr = await googleSingle(p.text, to);
            out[p.i] = tr;
            cacheSet(cacheKey('google', to, p.text), tr);
          } catch (e) {
            out[p.i] = '';
          }
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  return out;
}

let bingCreds = null;

async function getBingCreds() {
  if (bingCreds && Date.now() - bingCreds.at < 10 * 60 * 1000) return bingCreds;
  const res = await fetch('https://www.bing.com/translator', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' }
  });
  if (!res.ok) throw new Error('bing page http ' + res.status);
  const html = await res.text();
  const ig = html.match(/IG:"([^"]+)"/);
  const iid = html.match(/data-iid="([^"]+)"/);
  const helper = html.match(/params_AbusePreventionHelper\s*=\s*\[([^\]]+)\]/);
  if (!ig || !iid || !helper) throw new Error('bing creds parse failed');
  const parts = helper[1].split(',').map(s => s.trim().replace(/"/g, ''));
  bingCreds = { ig: ig[1], iid: iid[1], key: parts[0], token: parts[1], at: Date.now() };
  return bingCreds;
}

async function bingTranslate(texts, to) {
  const c = await getBingCreds();
  const out = new Array(texts.length).fill('');
  let ci = 0;
  const worker = async () => {
    while (ci < texts.length) {
      const i = ci++;
      const text = texts[i];
      const key = cacheKey('bing', to, text);
      const hit = cacheGet(key);
      if (hit != null) { out[i] = hit; continue; }
      try {
        const url = 'https://www.bing.com/ttranslatev3?fromLang=auto-detect&to=' + encodeURIComponent(to) +
          '&text=' + encodeURIComponent(text) +
          '&token=' + encodeURIComponent(c.token) + '&key=' + encodeURIComponent(c.key);
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' }
        });
        if (!res.ok) throw new Error('bing http ' + res.status);
        const data = await res.json();
        const tr = (data && data[0] && data[0].translations && data[0].translations[0]) ? data[0].translations[0].text : '';
        cacheSet(key, tr);
        out[i] = tr;
      } catch (e) {
        out[i] = '';
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out;
}

async function handleTranslate(msg) {
  const engine = msg.engine === 'bing' ? 'bing' : 'google';
  const to = msg.to || 'zh-CN';
  const texts = (msg.texts || []).filter(t => typeof t === 'string' && t.trim());
  if (!texts.length) return { ok: true, translations: [] };
  try {
    const translations = await (engine === 'bing' ? bingTranslate : googleTranslate)(texts, to);
    return { ok: true, translations, engine };
  } catch (e) {
    if (engine === 'bing') {
      bingCreds = null;
      try {
        const translations = await googleTranslate(texts, to);
        return { ok: true, translations, engine: 'google' };
      } catch (e2) {
        return { ok: false, error: String(e2 && e2.message || e2) };
      }
    }
    return { ok: false, error: String(e && e.message || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'translate') {
    handleTranslate(msg).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'clearCache') {
    cache.clear();
    bingCreds = null;
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ft-translate-selection',
    title: '翻译选中文字',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'ft-translate-selection' || !info.selectionText) return;
  const s = await chrome.storage.sync.get(DEFAULTS);
  const r = await handleTranslate({ engine: s.engine, to: s.targetLang, texts: [info.selectionText.trim()] });
  if (r.ok && r.translations[0]) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/48.png',
      title: info.selectionText.slice(0, 60),
      message: r.translations[0]
    });
  }
});

chrome.commands.onCommand.addListener(async (cmd) => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'cmd', cmd });
  } catch (e) {}
});
