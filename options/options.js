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

const LANGS = [
  ['zh-CN', '简体中文'], ['zh-TW', '繁体中文'], ['en', '英语'], ['ja', '日语'],
  ['ko', '韩语'], ['fr', '法语'], ['de', '德语'], ['es', '西班牙语'],
  ['ru', '俄语'], ['pt', '葡萄牙语'], ['it', '意大利语'], ['ar', '阿拉伯语'],
  ['hi', '印地语'], ['th', '泰语'], ['vi', '越南语'], ['id', '印尼语'],
  ['tr', '土耳其语'], ['nl', '荷兰语'], ['pl', '波兰语'], ['uk', '乌克兰语'],
  ['fa', '波斯语'], ['he', '希伯来语'], ['sv', '瑞典语'], ['da', '丹麦语'],
  ['fi', '芬兰语'], ['no', '挪威语'], ['cs', '捷克语'], ['el', '希腊语'],
  ['hu', '匈牙利语'], ['ro', '罗马尼亚语'], ['bg', '保加利亚语'], ['ms', '马来语'],
  ['fil', '菲律宾语'], ['bn', '孟加拉语'], ['ur', '乌尔都语'], ['ta', '泰米尔语']
];

const $ = id => document.getElementById(id);

async function load() {
  const s = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  const sel = $('targetLang');
  sel.textContent = '';
  for (const [code, name] of LANGS) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = name + ' (' + code + ')';
    if (code === s.targetLang) opt.selected = true;
    sel.appendChild(opt);
  }
  document.querySelector(`input[name="engine"][value="${s.engine}"]`).checked = true;
  $('chk-title').checked = !!s.translateTitle;
  $('chk-hover').checked = !!s.hoverEnabled;
  $('hoverKey').value = s.hoverKey || 'Ctrl';
  $('chk-selection').checked = !!s.selectionEnabled;
  $('chk-input').checked = !!s.inputTripleSpace;
  $('chk-subtitle').checked = !!s.subtitleEnabled;
  $('chk-ball').checked = s.showFloatBall !== false;
  $('autoSites').value = (s.autoSites || []).join('\n');
  $('neverSites').value = (s.neverSites || []).join('\n');
}

async function save() {
  const data = {
    targetLang: $('targetLang').value,
    engine: document.querySelector('input[name="engine"]:checked').value,
    translateTitle: $('chk-title').checked,
    hoverEnabled: $('chk-hover').checked,
    hoverKey: $('hoverKey').value,
    selectionEnabled: $('chk-selection').checked,
    inputTripleSpace: $('chk-input').checked,
    subtitleEnabled: $('chk-subtitle').checked,
    showFloatBall: $('chk-ball').checked,
    autoSites: $('autoSites').value.split('\n').map(s => s.trim()).filter(Boolean),
    neverSites: $('neverSites').value.split('\n').map(s => s.trim()).filter(Boolean)
  };
  await chrome.storage.sync.set(data);
  const st = $('save-status');
  st.textContent = '已保存';
  setTimeout(() => { st.textContent = ''; }, 1500);
}

$('btn-save').addEventListener('click', save);
$('btn-clear-cache').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'clearCache' });
  const st = $('save-status');
  st.textContent = '缓存已清空';
  setTimeout(() => { st.textContent = ''; }, 1500);
});

load();
