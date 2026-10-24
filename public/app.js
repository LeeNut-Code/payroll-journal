/* 工资手账 · client logic
   state is the single source of truth; paint() is the only writer of derived
   values; render*() rebuilds DOM on structural change only. */

const KEY = 'payroll-journal-v1';
const MOODS = ['😴', '😌', '😄', '🤩', '😤', '🥲', '😭', '🤑'];
const MOOD_NAMES = ['累瘫', '平静', '开心', '超棒', '心累', '想哭', '破防', '暴富'];
const THEME_COLORS = {
  cream: '#e8956b',
  sakura: '#e88ba6',
  retro: '#c05a3e',
  mint: '#4fa88a',
};
const THEMES = Object.keys(THEME_COLORS);
const THEME_LABELS = { cream: '奶油', sakura: '樱花', retro: '复古', mint: '薄荷' };
const THEME_BY_LABEL = { 奶油: 'cream', 樱花: 'sakura', 复古: 'retro', 薄荷: 'mint' };
const SETTING_KEYS = new Map([
  ['公积金比例', 'fundRate'],
  ['公积金', 'fundRate'],
  ['fundrate', 'fundRate'],
  ['专项附加扣除', 'special'],
  ['special', 'special'],
  ['生活开销', 'cost'],
  ['cost', 'cost'],
  ['储蓄目标', 'goal'],
  ['goal', 'goal'],
  ['心情', 'mood'],
  ['mood', 'mood'],
  ['纸张配色', 'theme'],
  ['配色', 'theme'],
  ['theme', 'theme'],
]);
const TAX_BRACKETS = [
  [3000, 0.03, 0],
  [12000, 0.1, 210],
  [25000, 0.2, 1410],
  [35000, 0.25, 2660],
  [55000, 0.3, 4410],
  [80000, 0.35, 7160],
  [Infinity, 0.45, 15160],
];

const $ = (selector, root = document) => root.querySelector(selector);

const defaults = () => ({
  items: [
    { name: '底薪', amount: 12000 },
    { name: '绩效', amount: 2500 },
    { name: '餐补', amount: 600 },
    { name: '交通补贴', amount: 400 },
  ],
  fundRate: 12,
  special: 0,
  cost: 4000,
  goal: 3000,
  mood: 0,
  notes: '',
  theme: 'cream',
});

const clampNum = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const money = (value) => `¥${Math.round(value).toLocaleString('zh-CN')}`;
const pct = (ratio) => `${(ratio * 100).toFixed(1)}%`;

function merge(raw) {
  const base = defaults();
  if (!raw || typeof raw !== 'object') return base;

  const items =
    Array.isArray(raw.items) && raw.items.length
      ? raw.items.slice(0, 12).map((item) => ({
          name: String(item && item.name != null ? item.name : '').slice(0, 20),
          amount: clampNum(item && item.amount, 0, 1e7, 0),
        }))
      : base.items;

  return {
    items,
    fundRate: clampNum(raw.fundRate, 5, 12, base.fundRate),
    special: clampNum(raw.special, 0, 1e7, base.special),
    cost: clampNum(raw.cost, 0, 1e7, base.cost),
    goal: clampNum(raw.goal, 0, 1e7, base.goal),
    mood: clampNum(raw.mood, 0, MOODS.length - 1, 0),
    notes: String(raw.notes == null ? '' : raw.notes).slice(0, 500),
    theme: THEMES.includes(raw.theme) ? raw.theme : base.theme,
  };
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw) state = merge(raw);
  } catch {
    /* corrupt storage: keep defaults */
  }
}

function save() {
  if (readOnly) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota: the journal still works in-memory */
  }
}

function calcMonthly(s) {
  const gross = s.items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const fee = gross > 0 ? gross * (0.105 + s.fundRate / 100) + 3 : 0;
  const taxable = Math.max(0, gross - fee - 5000 - s.special);
  const bracket = TAX_BRACKETS.find(([cap]) => taxable <= cap);
  const tax = Math.max(0, taxable * bracket[1] - bracket[2]);
  const net = gross - fee - tax;
  return {
    gross,
    fee,
    tax,
    taxable,
    net,
    burden: gross > 0 ? tax / gross : 0,
    saveable: Math.max(0, net - s.cost),
  };
}

/* ---------- state ---------- */

const sharedMatch = location.pathname.match(/^\/s\/([0-9A-Za-z]{4,12})\/?$/);
const isNew = new URLSearchParams(location.search).get('new') === '1';

let state = defaults();
let readOnly = false;
let toastTimer = 0;

if (!isNew) load();

/* ---------- elements ---------- */

const itemsEl = $('#items');
const addItemBtn = $('#addItem');
const notesEl = $('#notes');
const noteCountEl = $('#noteCount');
const moodsEl = $('#moods');
const resetBtn = $('#resetBtn');
const shareBtn = $('#shareBtn');
const shareDialog = $('#shareDialog');
const shareCodeEl = $('#shareCode');
const shareLinkEl = $('#shareLink');
const toastEl = $('#toast');

/* ---------- renderers ---------- */

function renderItems() {
  itemsEl.replaceChildren();

  state.items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'item';

    const idx = document.createElement('span');
    idx.className = 'item-idx';
    idx.textContent = String(index + 1).padStart(2, '0');

    const name = document.createElement('input');
    name.className = 'item-name';
    name.type = 'text';
    name.maxLength = 20;
    name.value = item.name;
    name.placeholder = '条目名称';
    name.setAttribute('aria-label', `第 ${index + 1} 条名称`);
    name.disabled = readOnly;

    const amountWrap = document.createElement('label');
    amountWrap.className = 'item-amt';
    const yen = document.createElement('span');
    yen.textContent = '¥';
    const amount = document.createElement('input');
    amount.className = 'item-amount';
    amount.type = 'number';
    amount.min = '0';
    amount.max = '10000000';
    amount.step = '100';
    amount.inputMode = 'decimal';
    amount.value = String(item.amount);
    amount.setAttribute('aria-label', `第 ${index + 1} 条金额`);
    amount.disabled = readOnly;
    amountWrap.append(yen, amount);

    const del = document.createElement('button');
    del.className = 'item-del';
    del.type = 'button';
    del.textContent = '✕';
    del.title = '删除这一条';
    del.setAttribute('aria-label', `删除第 ${index + 1} 条`);
    del.hidden = readOnly;

    name.addEventListener('input', () => {
      state.items[index].name = name.value.slice(0, 20);
      save();
    });

    amount.addEventListener('input', () => {
      state.items[index].amount = clampNum(amount.value, 0, 1e7, 0);
      paint();
      save();
    });

    del.addEventListener('click', () => {
      if (state.items.length <= 1) {
        toast('至少留一条工资条目');
        return;
      }
      state.items.splice(index, 1);
      renderItems();
      paint();
      save();
    });

    row.append(idx, name, amountWrap, del);
    itemsEl.appendChild(row);
  });
}

function renderMoods() {
  moodsEl.replaceChildren();
  MOODS.forEach((emoji, index) => {
    const button = document.createElement('button');
    button.className = 'mood';
    button.type = 'button';
    button.textContent = emoji;
    button.title = MOOD_NAMES[index];
    button.setAttribute('aria-label', MOOD_NAMES[index]);
    button.setAttribute('aria-pressed', String(state.mood === index));
    button.disabled = readOnly;
    if (state.mood === index) button.classList.add('is-on');

    button.addEventListener('click', () => {
      state.mood = index;
      renderMoods();
      save();
    });

    moodsEl.appendChild(button);
  });
}

function setSliderValues() {
  const values = {
    fundRate: state.fundRate,
    special: state.special,
    cost: state.cost,
    goal: state.goal,
  };
  Object.entries(values).forEach(([id, value]) => {
    document.getElementById(id).value = String(value);
  });
}

/* ---------- paint: derived values only ---------- */

function paint() {
  const m = calcMonthly(state);
  const monthlySave = Math.round(m.saveable);

  $('#net').textContent = money(m.net);
  $('#chipGross').textContent = money(m.gross);
  $('#chipFee').textContent = money(m.fee);
  $('#chipTax').textContent = money(m.tax);
  $('#chipRate').textContent = pct(m.burden);
  $('#netNote').textContent = `税负率 ${pct(m.burden)} · 扣掉开销还能存 ${money(monthlySave)}`;

  $('#fundRateOut').textContent = `${state.fundRate}%`;
  $('#specialOut').textContent = money(state.special);
  $('#costOut').textContent = money(state.cost);
  $('#goalOut').textContent = money(state.goal);

  const total = Math.max(m.gross, 1);
  $('#barNet').style.width = `${((m.net / total) * 100).toFixed(2)}%`;
  $('#barFee').style.width = `${((m.fee / total) * 100).toFixed(2)}%`;
  $('#barTax').style.width = `${((m.tax / total) * 100).toFixed(2)}%`;

  const ratio = state.goal > 0 ? m.saveable / state.goal : m.saveable > 0 ? 1 : 0;
  $('#jarFill').style.height = `${Math.min(100, Math.max(0, ratio * 100)).toFixed(1)}%`;
  $('#jarSaving').textContent = money(monthlySave);
  $('#jarGoal').textContent =
    state.goal > 0
      ? `目标 ${money(state.goal)} · 达成 ${Math.round(ratio * 100)}%`
      : `目标还没设 · 每月可存 ${money(monthlySave)}`;

  noteCountEl.textContent = `${state.notes.length} / 500`;
}

/* ---------- theme / read-only ---------- */

function applyTheme(theme) {
  const next = THEMES.includes(theme) ? theme : 'cream';
  document.documentElement.dataset.theme = next;
  document.querySelectorAll('.theme').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.theme === next));
  });
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLORS[next];
}

function applyReadOnly() {
  document.body.classList.toggle('is-readonly', readOnly);
  addItemBtn.hidden = readOnly;
  resetBtn.hidden = readOnly;
  $('#importBtn').hidden = readOnly;
  ['fundRate', 'special', 'cost', 'goal'].forEach((id) => {
    document.getElementById(id).disabled = readOnly;
  });
  notesEl.readOnly = readOnly;
  moodsEl.querySelectorAll('.mood').forEach((button) => {
    button.disabled = readOnly;
  });
}

function renderAll() {
  applyTheme(state.theme);
  renderItems();
  renderMoods();
  setSliderValues();
  notesEl.value = state.notes;
  paint();
  applyReadOnly();
}

/* ---------- toast + clipboard ---------- */

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('is-on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('is-on'), 2600);
}

async function copyText(text, doneMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(doneMessage);
    return;
  } catch {
    /* fall through to the legacy path */
  }
  const helper = document.createElement('textarea');
  helper.value = text;
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  document.body.appendChild(helper);
  helper.select();
  try {
    document.execCommand('copy');
    toast(doneMessage);
  } catch {
    toast('复制失败，请手动选择文字');
  }
  helper.remove();
}

/* ---------- share ---------- */

function stampMonth() {
  const now = new Date();
  return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function summaryText() {
  const m = calcMonthly(state);
  const lines = [
    `【工资手账 · ${stampMonth()}】`,
    `税前 ${money(m.gross)}｜五险一金 ${money(m.fee)}｜个税 ${money(m.tax)}`,
    `到手 ${money(m.net)}｜税负率 ${pct(m.burden)}`,
    `本月还能存 ${money(m.saveable)}（目标 ${money(state.goal)}）`,
  ];
  if (state.notes.trim()) lines.push('', `手账旁白：${state.notes.trim()}`);
  lines.push('', '—— 用手账贴纸风记工资');
  return lines.join('\n');
}

async function publish() {
  if (!navigator.onLine) {
    toast('现在离线了，连上网再分享吧');
    return;
  }

  const label = shareBtn.textContent;
  shareBtn.disabled = true;
  shareBtn.textContent = '打包中…';

  try {
    const response = await fetch('/api/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.code) throw new Error(data.error || 'share_failed');

    shareCodeEl.textContent = data.code;
    shareLinkEl.value = `${location.origin}${data.path}`;
    shareDialog.showModal();
  } catch {
    toast('分享没成功，稍后再试一次');
  } finally {
    shareBtn.disabled = false;
    shareBtn.textContent = label;
  }
}

async function openShared(code) {
  try {
    const response = await fetch(`/api/share/${encodeURIComponent(code)}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error('not_found');
    const data = await response.json();
    state = merge(data.state);
    readOnly = true;
    $('#sharedCode').textContent = code;
    $('#sharedBanner').hidden = false;
    renderAll();
    toast('打开了一页朋友分享的手账');
  } catch {
    toast('这页手账不存在或已过期，先看看你自己的吧');
  }
}

/* ---------- CSV import / export ---------- */

const csvCell = (value) => {
  const text = String(value == null ? '' : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function buildCsv() {
  const rows = [['类型', '名称', '值']];
  state.items.forEach((item) => {
    rows.push(['条目', item.name, String(Math.round(item.amount))]);
  });
  rows.push(['设置', '公积金比例', String(state.fundRate)]);
  rows.push(['设置', '专项附加扣除', String(state.special)]);
  rows.push(['设置', '生活开销', String(state.cost)]);
  rows.push(['设置', '储蓄目标', String(state.goal)]);
  rows.push(['设置', '心情（0-7）', String(state.mood)]);
  rows.push(['设置', '纸张配色', THEME_LABELS[state.theme]]);
  rows.push(['备注', '手账旁白', state.notes]);
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function parseCsv(text) {
  const source = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

function settingKey(name) {
  const key = String(name || '').trim();
  if (SETTING_KEYS.has(key)) return SETTING_KEYS.get(key);
  const lower = key.toLowerCase();
  if (SETTING_KEYS.has(lower)) return SETTING_KEYS.get(lower);
  if (key.startsWith('心情')) return 'mood';
  if (key.startsWith('纸张') || key.startsWith('配色')) return 'theme';
  return null;
}

function importCsvText(text) {
  const rows = parseCsv(text);
  const base = defaults();
  const next = { ...base, items: base.items.slice() };
  const items = [];
  let hasItems = false;
  let hasSettings = false;
  let notes = null;

  for (const cells of rows) {
    const type = String(cells[0] || '').trim();
    if (!type || type === '类型') continue;
    const name = String(cells[1] || '').trim();
    const value = String(cells.length >= 3 ? cells[2] : '').trim();

    if (type === '条目') {
      hasItems = true;
      if (items.length < 12) {
        items.push({
          name: name.slice(0, 20) || `条目 ${items.length + 1}`,
          amount: clampNum(value, 0, 1e7, 0),
        });
      }
      continue;
    }

    if (type === '备注') {
      notes = value.slice(0, 500);
      hasSettings = true;
      continue;
    }

    const key = settingKey(name);
    if (!key) continue;
    hasSettings = true;

    if (key === 'theme') {
      const theme = THEME_BY_LABEL[value] || (THEMES.includes(value) ? value : null);
      if (theme) next.theme = theme;
    } else if (key === 'mood') {
      next.mood = clampNum(value, 0, MOODS.length - 1, next.mood);
    } else if (key === 'fundRate') {
      next.fundRate = clampNum(value, 5, 12, next.fundRate);
    } else {
      next[key] = clampNum(value, 0, 1e7, next[key]);
    }
  }

  if (hasItems && items.length) next.items = items;
  if (notes != null) next.notes = notes;
  if (!hasItems && !hasSettings) return { ok: false };

  return { ok: true, state: next, count: items.length };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportCsv() {
  const csv = buildCsv();
  downloadBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `工资手账-${stampMonth()}.csv`);
  toast('CSV 已导出，可以用表格软件打开');
}

/* ---------- PDF: draw the journal page, then wrap the JPEG in a minimal PDF ---------- */

function readPalette() {
  const css = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    paper: pick('--paper', '#fdf7ec'),
    ink: pick('--ink', '#4a3f35'),
    soft: pick('--ink-soft', '#8b7d6b'),
    accent: pick('--accent', '#e8956b'),
    accent2: pick('--accent2', '#7fa8a0'),
    tape: pick('--tape', '#e9c46a'),
    line: pick('--line', '#e8dfcf'),
    hl: pick('--hl', '#ffe8a3'),
  };
}

function buildPdf(jpeg, width, height) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;

  const push = (data) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };

  push('%PDF-1.4\n');
  offsets[1] = length;
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  offsets[2] = length;
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  offsets[3] = length;
  push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n'
  );
  offsets[4] = length;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
  );
  push(jpeg);
  push('\nendstream\nendobj\n');

  const content = 'q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n';
  offsets[5] = length;
  push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

  const xrefOffset = length;
  push(`xref\n0 6\n0000000000 65535 f \n`);
  for (let index = 1; index <= 5; index += 1) {
    push(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let position = 0;
  chunks.forEach((chunk) => {
    out.set(chunk, position);
    position += chunk.length;
  });
  return out;
}

function drawJournalCanvas() {
  const palette = readPalette();
  const W = 1240;
  const H = 1754;
  const HAND = '"LXGW WenKai","Kaiti SC",KaiTi,"Comic Sans MS","Segoe Print",cursive,sans-serif';
  const UI = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
  const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const font = (size, family = HAND, weight = 400) => {
    ctx.font = `${weight} ${size}px ${family}`;
  };

  const text = (value, x, y, options = {}) => {
    const {
      size = 24,
      family = HAND,
      weight = 400,
      color = palette.ink,
      align = 'left',
      alpha = 1,
    } = options;
    ctx.save();
    ctx.globalAlpha = alpha;
    font(size, family, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(value), x, y);
    ctx.restore();
  };

  const dashed = (x1, y1, x2, y2, color = palette.line, width = 1.5, dash = [8, 7]) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  };

  const fit = (value, maxWidth) => {
    let str = String(value);
    if (ctx.measureText(str).width <= maxWidth) return str;
    while (str.length && ctx.measureText(`${str}…`).width > maxWidth) str = str.slice(0, -1);
    return `${str}…`;
  };

  const sectionTitle = (number, label, x, y) => {
    ctx.save();
    ctx.fillStyle = palette.ink;
    ctx.beginPath();
    ctx.roundRect(x, y - 24, 38, 27, 4);
    ctx.fill();
    ctx.restore();
    text(number, x + 19, y - 5, { size: 15, family: UI, weight: 700, color: palette.paper, align: 'center' });
    text(label, x + 52, y, { size: 31, weight: 700 });
  };

  // paper + ruled lines
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.strokeStyle = palette.line;
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = 1.5;
  for (let lineY = 84; lineY < H - 40; lineY += 42) {
    ctx.beginPath();
    ctx.moveTo(0, lineY);
    ctx.lineTo(W, lineY);
    ctx.stroke();
  }
  ctx.restore();

  // washi tape
  const tape = (x, y, w, h, angle, color) => {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(angle);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#ffffff';
    for (let stripe = -w / 2; stripe < w / 2; stripe += 14) {
      ctx.fillRect(stripe, -h / 2, 4, h);
    }
    ctx.restore();
  };
  tape(82, 56, 148, 36, -0.1, palette.tape);
  tape(W - 232, 60, 148, 36, 0.08, palette.accent);

  // header
  text('PAYROLL JOURNAL · 月度手账', 90, 128, { size: 19, family: UI, color: palette.soft });

  font(64, HAND, 700);
  const mineWidth = ctx.measureText('我的').width;
  const titleWidth = ctx.measureText('工资手账').width;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = palette.hl;
  ctx.fillRect(90 + mineWidth - 6, 175, titleWidth + 12, 34);
  ctx.restore();
  text('我的工资手账', 90, 205, { size: 64, weight: 700 });
  text('把每一笔工资，贴成看得见的生活。', 90, 246, { size: 23, family: UI, color: palette.soft });

  ctx.save();
  ctx.translate(W - 200, 165);
  ctx.rotate(0.06);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 3;
  ctx.setLineDash([9, 7]);
  ctx.strokeRect(-104, -50, 208, 100);
  ctx.setLineDash([]);
  text('NO. 10', 0, -18, { size: 14, family: UI, color: palette.soft, align: 'center' });
  text(stampMonth(), 0, 18, { size: 34, color: palette.accent, align: 'center' });
  text('MONTHLY PAY', 0, 38, { size: 13, family: UI, color: palette.soft, align: 'center' });
  ctx.restore();

  dashed(90, 288, W - 90, 288, palette.line, 1.5, [9, 7]);

  const m = calcMonthly(state);
  const monthlySave = Math.round(m.saveable);

  // left column: items
  const LX = 90;
  let leftY = 330;
  sectionTitle('01', '工资条目', LX, leftY);
  text('逐项填写，合计会变成税前工资。', LX, leftY + 30, { size: 18, family: UI, color: palette.soft });

  const rowTop = leftY + 52;
  state.items.forEach((item, index) => {
    const y = rowTop + index * 48;
    text(String(index + 1).padStart(2, '0'), LX, y + 29, { size: 16, family: UI, color: palette.soft });
    font(26, HAND);
    text(fit(item.name || '未命名', 350), LX + 34, y + 30, { size: 26 });
    text(money(item.amount), 625, y + 30, { size: 26, align: 'right' });
    dashed(LX + 34, y + 41, 625, y + 41, palette.line, 1.5, [6, 6]);
  });

  let leftEnd = rowTop + state.items.length * 48;

  // settings
  let settingsY = leftEnd + 30;
  sectionTitle('02', '五险一金与扣除', LX, settingsY);
  const settings = [
    ['公积金比例', `${state.fundRate}%`],
    ['专项附加扣除', money(state.special)],
    ['生活开销', money(state.cost)],
    ['储蓄目标', money(state.goal)],
  ];
  settings.forEach(([label, value], index) => {
    const x = LX + (index % 2) * 278;
    const y = settingsY + 50 + Math.floor(index / 2) * 60;
    text(label, x, y, { size: 17, family: UI, color: palette.soft });
    text(value, x + 246, y + 1, { size: 28, align: 'right' });
    dashed(x, y + 12, x + 246, y + 12, palette.line, 1.5, [6, 6]);
  });
  leftEnd = settingsY + 50 + 2 * 60;

  // right column: take home
  const RX = 650;
  const rightY = 330;
  text('TAKE HOME · 本月到手', RX, rightY, { size: 19, family: UI, color: palette.soft });
  font(86, HAND, 700);
  text(fit(money(m.net), 500), RX, rightY + 94, { size: 86, weight: 700 });
  text(`税负率 ${pct(m.burden)} · 扣掉开销还能存 ${money(monthlySave)}`, RX, rightY + 130, {
    size: 19,
    family: UI,
    color: palette.soft,
  });

  const chips = [
    ['税前', money(m.gross)],
    ['五险一金', money(m.fee)],
    ['个税', money(m.tax)],
    ['税负率', pct(m.burden)],
  ];
  const chipsTop = rightY + 162;
  chips.forEach(([label, value], index) => {
    const x = RX + (index % 2) * 258;
    const y = chipsTop + Math.floor(index / 2) * 100;
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = palette.accent;
    ctx.beginPath();
    ctx.roundRect(x + 6, y + 6, 236, 88, 6);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = palette.ink;
    ctx.globalAlpha = 0.92;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, 236, 88, 6);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    text(label, x + 16, y + 27, { size: 14, family: UI, color: palette.soft });
    text(value, x + 16, y + 66, { size: 29, weight: 600 });
  });

  // composition bar
  const barY = chipsTop + 212;
  const barWidth = 500;
  const total = Math.max(m.gross, 1);
  let barX = RX;
  [
    [m.net, palette.accent],
    [m.fee, palette.accent2],
    [m.tax, palette.soft],
  ].forEach(([value, color]) => {
    const width = Math.max(0, (value / total) * (barWidth - 8));
    ctx.fillStyle = color;
    ctx.fillRect(barX, barY, width, 20);
    barX += width + 4;
  });

  [
    ['到手', palette.accent],
    ['五险一金', palette.accent2],
    ['个税', palette.soft],
  ].forEach(([label, color], index) => {
    const x = RX + index * 155;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, barY + 30, 12, 12, 3);
    ctx.fill();
    text(label, x + 18, barY + 41, { size: 15, family: UI, color: palette.soft });
  });

  // savings jar
  const jarX = RX;
  const jarY = barY + 74;
  const jarW = 104;
  const jarH = 146;
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.roundRect(jarX + 7, jarY + 7, jarW, jarH, 10);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(jarX, jarY, jarW, jarH, 10);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  const jarRatio = state.goal > 0 ? Math.min(1, m.saveable / state.goal) : m.saveable > 0 ? 1 : 0;
  const fillHeight = (jarH - 8) * jarRatio;
  if (fillHeight > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(jarX + 3, jarY + 3, jarW - 6, jarH - 6, 8);
    ctx.clip();
    ctx.fillStyle = palette.accent2;
    ctx.fillRect(jarX + 3, jarY + jarH - 4 - fillHeight, jarW - 6, fillHeight);
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(jarX + 14, jarY + jarH - 4 - fillHeight, 9, fillHeight);
    ctx.restore();
  }

  ctx.save();
  ctx.fillStyle = palette.tape;
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(jarX + 9, jarY - 11, jarW - 18, 15, 4);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  const jarTextX = jarX + 134;
  text('SAVINGS JAR · 储蓄罐', jarTextX, jarY + 18, { size: 14, family: UI, color: palette.soft });
  text(money(monthlySave), jarTextX, jarY + 62, { size: 34, weight: 700 });
  text(
    state.goal > 0
      ? `目标 ${money(state.goal)} · 达成 ${Math.round((m.saveable / state.goal) * 100)}%`
      : `目标还没设 · 每月可存 ${money(monthlySave)}`,
    jarTextX,
    jarY + 92,
    { size: 16, family: UI, color: palette.soft }
  );

  // mood stickers
  const moodY = jarY + 194;
  text('今天的心情 · MOOD STICKER', RX, moodY, { size: 14, family: UI, color: palette.soft });
  MOODS.forEach((emoji, index) => {
    const x = RX + index * 62;
    const y = moodY + 18;
    const on = state.mood === index;
    ctx.save();
    ctx.globalAlpha = on ? 1 : 0.55;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = on ? palette.accent : palette.line;
    ctx.lineWidth = on ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, 50, 50, 8);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    text(emoji, x + 25, y + 37, {
      size: 30,
      family: EMOJI,
      align: 'center',
      alpha: on ? 1 : 0.4,
    });
  });
  const rightEnd = moodY + 78;

  // note
  const notesTop = Math.max(leftEnd, rightEnd) + 52;
  sectionTitle('03', '写给这个月的自己', LX, notesTop);
  const boxY = notesTop + 22;
  const boxH = H - boxY - 116;
  ctx.save();
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 2;
  ctx.setLineDash([9, 7]);
  ctx.beginPath();
  ctx.roundRect(LX, boxY, W - LX * 2, boxH, 8);
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = palette.line;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1.5;
  for (let lineY = boxY + 46; lineY < boxY + boxH - 12; lineY += 42) {
    ctx.beginPath();
    ctx.moveTo(LX + 16, lineY);
    ctx.lineTo(W - LX - 16, lineY);
    ctx.stroke();
  }
  ctx.restore();

  const noteFont = 23;
  const noteLead = 38;
  font(noteFont, HAND);
  const noteText = state.notes.trim() || '这一页还空着，留给下个月的自己。';
  const maxWidth = W - LX * 2 - 46;
  const lines = [];
  String(noteText).split('\n').forEach((paragraph) => {
    if (!paragraph) {
      lines.push('');
      return;
    }
    let current = '';
    for (const char of paragraph) {
      const next = current + char;
      if (ctx.measureText(next).width > maxWidth && current) {
        lines.push(current);
        current = char;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  });
  const maxLines = Math.max(1, Math.floor((boxH - 20) / noteLead));
  lines.slice(0, maxLines).forEach((line, index) => {
    let render = line;
    if (index === maxLines - 1 && lines.length > maxLines) {
      font(noteFont, HAND);
      render = fit(`${line}…`, maxWidth);
    }
    text(render, LX + 24, boxY + 38 + index * noteLead, {
      size: noteFont,
      color: state.notes.trim() ? palette.ink : palette.soft,
    });
  });

  // footer
  dashed(LX, H - 100, W - LX, H - 100, palette.line, 1.5, [8, 7]);
  text('按月度换算表估算，五险一金基数取税前工资，年终奖与调薪未计入。', W / 2, H - 68, {
    size: 14,
    family: UI,
    color: palette.soft,
    align: 'center',
  });
  text(`工资手账 · ${stampMonth()} · 数据只保存在你的浏览器里`, W / 2, H - 42, {
    size: 14,
    family: UI,
    color: palette.soft,
    align: 'center',
  });

  return canvas;
}

async function downloadPdf() {
  const button = $('#printBtn');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '生成中…';
  try {
    const canvas = drawJournalCanvas();
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('to_blob_failed'))), 'image/jpeg', 0.92);
    });
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    const pdf = buildPdf(jpeg, canvas.width, canvas.height);
    downloadBlob(new Blob([pdf], { type: 'application/pdf' }), `工资手账-${stampMonth()}.pdf`);
    toast('PDF 已下载');
  } catch {
    toast('PDF 生成失败，再试一次');
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

/* ---------- wire up ---------- */

document.querySelectorAll('.theme').forEach((button) => {
  button.addEventListener('click', () => {
    state.theme = button.dataset.theme;
    applyTheme(state.theme);
    save();
  });
});

addItemBtn.addEventListener('click', () => {
  if (state.items.length >= 12) {
    toast('最多 12 条，已经够用啦');
    return;
  }
  state.items.push({ name: '', amount: 0 });
  renderItems();
  paint();
  save();
  const names = itemsEl.querySelectorAll('.item-name');
  names[names.length - 1].focus();
});

['fundRate', 'special', 'cost', 'goal'].forEach((id) => {
  const input = document.getElementById(id);
  input.addEventListener('input', () => {
    state[id] = clampNum(input.value, Number(input.min), Number(input.max), 0);
    paint();
    save();
  });
});

notesEl.addEventListener('input', () => {
  state.notes = notesEl.value.slice(0, 500);
  noteCountEl.textContent = `${state.notes.length} / 500`;
  save();
});

shareBtn.addEventListener('click', publish);

$('#copyBtn').addEventListener('click', () => {
  copyText(summaryText(), '小结已复制，去发给朋友吧');
});

$('#printBtn').addEventListener('click', downloadPdf);

resetBtn.addEventListener('click', () => {
  if (!window.confirm('重新开始会清空这页手账，确定吗？')) return;
  state = defaults();
  readOnly = false;
  $('#sharedBanner').hidden = true;
  renderAll();
  save();
  toast('换了一页新手账');
});

$('#exportBtn').addEventListener('click', exportCsv);

const importFile = $('#importFile');
$('#importBtn').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files && importFile.files[0];
  importFile.value = '';
  if (!file) return;
  try {
    const result = importCsvText(await file.text());
    if (!result.ok) {
      toast('没看懂这个 CSV，请用导出的文件做模板');
      return;
    }
    state = result.state;
    readOnly = false;
    $('#sharedBanner').hidden = true;
    renderAll();
    save();
    toast(result.count ? `已导入 ${result.count} 条工资条目` : '手账设置已导入');
  } catch {
    toast('文件读取失败，再试一次');
  }
});

$('#copyLinkBtn').addEventListener('click', () => {
  if (!shareLinkEl.value) return;
  copyText(shareLinkEl.value, '链接已复制，发给朋友吧');
});

$('#forkBtn').addEventListener('click', () => {
  readOnly = false;
  history.replaceState({}, '', '/');
  $('#sharedBanner').hidden = true;
  renderAll();
  save();
  toast('已抄进你的手账');
});

/* ---------- service worker ---------- */

if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    $('#updateBanner').hidden = false;
  });

  $('#updateReload').addEventListener('click', () => {
    reloading = true;
    location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

window.addEventListener('offline', () => toast('离线了，手账还能改，分享稍后再说'));
window.addEventListener('online', () => toast('网络回来了'));

/* ---------- boot ---------- */

$('#stampMonth').textContent = stampMonth();
renderAll();

if (sharedMatch) openShared(sharedMatch[1].toUpperCase());
