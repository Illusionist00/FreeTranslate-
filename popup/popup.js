const DEFAULTS = {
  targetLang: 'zh-CN',
  engine: 'google',
  subtitleEnabled: true,
  autoSites: [],
  neverSites: []
};

const $ = id => document.getElementById(id);
const status = $('status');

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

async function getTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0];
}

async function sendToTab(type, payload) {
  const tab = await getTab();
  if (!tab || !tab.id) return null;
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tab.id, { type, ...(payload || {}) }, resp => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(resp || null);
    });
  });
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}

async function refresh() {
  const settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  $('lang-label').textContent = settings.targetLang;
  $('engine-label').textContent = settings.engine === 'bing' ? 'Bing' : 'Google';
  $('chk-subtitle').checked = !!settings.subtitleEnabled;

  const tab = await getTab();
  const host = tab && tab.url ? hostOf(tab.url) : '';
  const st = await sendToTab('getPageState');

  if (!st) {
    const url = (tab && tab.url) || '';
    if (/^(chrome|edge|about|chrome-extension|devtools|opera):/.test(url) || url.startsWith('https://chrome.google.com/webstore') || url.startsWith('https://microsoftedge.microsoft.com/addons')) {
      status.textContent = '浏览器内置页不支持翻译';
    } else if (url.startsWith('file://')) {
      status.textContent = '本地文件：请在扩展详情中开启「允许访问文件网址」后刷新页面';
    } else {
      status.textContent = '脚本未注入，请刷新页面后重试（扩展刚更新时需刷新标签页）';
    }
    return;
  }

  $('chk-always').checked = (settings.autoSites || []).some(p => matchSite(p, host));
  $('chk-never').checked = (settings.neverSites || []).some(p => matchSite(p, host));

  if (st.pageState === 'translating') status.textContent = '翻译中…';
  else if (st.pageState === 'translated') status.textContent = '已翻译 · ' + host;
  else if (st.pageState === 'error') status.textContent = '翻译出错，请重试';
  else status.textContent = '未翻译 · ' + host;

  $('mode-select').value = st.mode || 'original';
}

$('btn-translate').addEventListener('click', async () => {
  await sendToTab('translatePage');
  status.textContent = '翻译中…';
  setTimeout(refresh, 600);
});

$('btn-restore').addEventListener('click', async () => {
  await sendToTab('restorePage');
  setTimeout(refresh, 200);
});

$('mode-select').addEventListener('change', async e => {
  await sendToTab('setMode', { mode: e.target.value });
  setTimeout(refresh, 200);
});

async function toggleSite(kind, checked) {
  const settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  const tab = await getTab();
  const host = hostOf(tab && tab.url ? tab.url : '');
  if (!host) return;
  const list = new Set(settings[kind] || []);
  if (checked) list.add(host);
  else list.delete(host);
  settings[kind] = Array.from(list);
  await chrome.storage.sync.set({ [kind]: settings[kind] });
  if (kind === 'autoSites' && checked) await sendToTab('translatePage');
}

$('chk-always').addEventListener('change', e => toggleSite('autoSites', e.target.checked));
$('chk-never').addEventListener('change', e => toggleSite('neverSites', e.target.checked));
$('chk-subtitle').addEventListener('change', async e => {
  await chrome.storage.sync.set({ subtitleEnabled: e.target.checked });
});

$('open-options').addEventListener('click', e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

refresh();
