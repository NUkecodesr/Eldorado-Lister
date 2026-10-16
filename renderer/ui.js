// Tiny DOM helpers shared by all pages.
const M = window.zotac;

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const $ = (sel, root = document) => root.querySelector(sel);
const money = n => (n === null || n === undefined || isNaN(n) ? '—' : '$' + Number(n).toFixed(2));
const fmtDate = d => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleString(); };
const fmtShort = d => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleDateString(); };
const ago = ts => { if (!ts) return 'never'; const s = Math.round((Date.now() - new Date(ts)) / 1000); if (s < 60) return s + 's ago'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago'; return Math.round(s / 86400) + 'd ago'; };

function formatGen(n) {
  n = Number(n) || 0;
  const f = (x, u) => `${+(x).toFixed(x >= 100 ? 1 : 2)}${u}/s`;
  if (n >= 1e12) return f(n / 1e12, 'T'); if (n >= 1e9) return f(n / 1e9, 'B'); if (n >= 1e6) return f(n / 1e6, 'M'); if (n >= 1e3) return f(n / 1e3, 'K');
  return n + '/s';
}
function parseGen(v) {
  if (typeof v === 'number') return v;
  const m = String(v || '').replace(/[$,\s]/g, '').replace(/\/s$/i, '').match(/^(\d+(?:\.\d+)?)([kmbt])?/i);
  if (!m) return 0;
  return parseFloat(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[(m[2] || '').toLowerCase()] || 1);
}

function toast(msg, type = 'info', ms = 4200) {
  const el = h('div', { class: 'toast ' + type }, msg);
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

async function run(fn, okMsg) {
  try { const v = await fn(); if (okMsg) toast(okMsg, 'good'); return v; }
  catch (e) { toast(e.message, 'error', 7000); console.error(e); return undefined; }
}

function modal(title, body, actions = []) {
  const root = $('#modal-root');
  const close = () => bg.remove();
  const bg = h('div', { class: 'modal-bg', onmousedown: e => { if (e.target === bg) close(); } },
    h('div', { class: 'modal' }, h('h2', null, title), body,
      h('div', { class: 'actions' }, actions.map(a => h('button', { class: 'btn ' + (a.cls || ''), onclick: async () => { const r = await a.fn?.(); if (r !== false) close(); } }, a.label)))));
  root.appendChild(bg);
  return close;
}

function confirmBox(text) {
  return new Promise(res => modal('Confirm', h('p', null, text), [
    { label: t('cancel'), fn: () => res(false) },
    { label: 'OK', cls: 'primary', fn: () => res(true) }
  ]));
}

function promptBox(title, label, value = '', multiline = false) {
  return new Promise(res => {
    const inp = multiline ? h('textarea', { style: { minHeight: '160px' } }) : h('input', { type: 'text', style: { width: '100%' } });
    inp.value = value;
    modal(title, h('label', { class: 'f' }, label, inp), [
      { label: t('cancel'), fn: () => res(null) },
      { label: 'OK', cls: 'primary', fn: () => res(inp.value) }
    ]);
    setTimeout(() => inp.focus(), 50);
  });
}

function pageHead(key, ...right) {
  return h('div', { class: 'page-head' },
    h('div', null, h('h1', null, t(key)), h('p', null, t(key + '.sub'))),
    h('div', { class: 'row' }, right));
}

function stat(k, v, s, cls = '') { return h('div', { class: 'stat ' + cls }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), s ? h('div', { class: 's' }, s) : null); }

function sw(checked, onchange) {
  const inp = h('input', { type: 'checkbox', checked, onchange: e => onchange(e.target.checked) });
  return h('label', { class: 'switch' }, inp, h('span'));
}

function setting(title, sub, control) {
  return h('div', { class: 'setting' }, h('div', null, h('b', null, title), sub ? h('small', null, sub) : null), control);
}

// Generic table. cols: [{k, label, num, render(row)}]
function table(rows, cols, opts = {}) {
  if (!rows || !rows.length) return h('div', { class: 'tbl-wrap' }, h('div', { class: 'empty' }, opts.empty || 'Nothing here yet.'));
  return h('div', { class: 'tbl-wrap', style: opts.maxHeight ? { maxHeight: opts.maxHeight } : null },
    h('table', null,
      h('thead', null, h('tr', null, cols.map(c => h('th', { class: c.num ? 'num' : '' }, c.label)))),
      h('tbody', null, rows.map(r => h('tr', { class: opts.rowClass ? opts.rowClass(r) : '', onclick: opts.onRow ? () => opts.onRow(r) : null },
        cols.map(c => h('td', { class: c.num ? 'num' : '' }, c.render ? c.render(r) : (r[c.k] ?? '—'))))))));
}

// For API responses whose exact shape is unknown: render the first record list generically.
function autoTable(data, opts = {}) {
  const rows = Array.isArray(data) ? data : (data && (data.results || data.items || data.transactions || data.records || Object.values(data).find(v => Array.isArray(v)))) || [];
  if (!rows.length) return h('div', { class: 'tbl-wrap' }, h('div', { class: 'empty' }, opts.empty || 'No records.'));
  const keys = [];
  for (const r of rows.slice(0, 20)) for (const [k, v] of Object.entries(r)) {
    if (keys.includes(k) || keys.length >= (opts.maxCols || 8)) continue;
    if (v === null || typeof v !== 'object' || (v && 'amount' in v)) keys.push(k);
  }
  const cell = v => v && typeof v === 'object' && 'amount' in v ? money(v.amount) : (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? fmtDate(v) : (v === null || v === undefined ? '—' : String(v)));
  return table(rows, keys.map(k => ({ label: k.replace(/([A-Z])/g, ' $1'), render: r => cell(r[k]), num: rows.some(r => typeof r[k] === 'number' || (r[k] && r[k].amount !== undefined)) })), opts);
}

function jsonDetails(label, obj) {
  return h('details', null, h('summary', null, label), h('pre', { class: 'json' }, JSON.stringify(obj, null, 2)));
}

function stateBadge(state) {
  const s = String(state || '');
  const cls = /disput/i.test(s) ? 'bad' : /cancel|refund/i.test(s) ? 'warn' : /pending/i.test(s) ? 'info' : /deliver|receiv|complet|done|success/i.test(s) ? 'good' : '';
  return h('span', { class: 'pill ' + cls }, s.replace(/([a-z])([A-Z])/g, '$1 $2') || '—');
}

function readFileText(accept = '.json') {
  return new Promise(res => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    inp.onchange = () => { const f = inp.files[0]; if (!f) return res(null); const r = new FileReader(); r.onload = () => res(r.result); r.readAsText(f); };
    document.body.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
  });
}

function download(name, text, type = 'application/json') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.appendChild(a); a.click(); a.remove();
}

const ICONS = {
  autolist: 'M4 6h16M4 12h10M4 18h7', listings: 'M3 12l9-9 9 9-9 9zM12 8v.01', templates: 'M6 3h9l4 4v14H6zM14 3v5h5', accounts: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  server: 'M3 10l9-6 9 6v10H3zM8 20v-6h8v6M12 4v4', sales: 'M4 20V10M10 20V4M16 20v-7M22 20H2', searcher: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5', orders: 'M3 4h2l2 12h11l2-8H7M9 20a1 1 0 100-2 1 1 0 000 2zM18 20a1 1 0 100-2 1 1 0 000 2z',
  chat: 'M4 5h16v11H8l-4 4z', account: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0', wallet: 'M3 7h18v12H3zM3 7l2-3h12l2 3M16 13h2', analytics: 'M4 20V12M10 20V6M16 20v-9M22 20H2',
  reviews: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z', notifications: 'M6 16V11a6 6 0 1112 0v5l2 2H4zM10 21h4', delivery: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z',
  proof: 'M3 6h13v12H3zM16 10l5-3v10l-5-3', admin: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1-2-2V4h-4v2L9 7 7 6 5 10l2 1v2l-2 1 2 4 2-1 2 2v2h4v-2l2-2 2 1 2-4-2-1z'
};
function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', ICONS[name] || ''); svg.appendChild(p);
  return svg;
}

// Single-series bar chart with hover tooltip. data: [{label, value}]
function barChart(data, { height = 220, fmt = v => v, color = '#f2b631' } = {}) {
  const wrap = h('div', { class: 'chart' });
  const c = h('canvas', { style: { width: '100%', height: height + 'px', display: 'block' } });
  const tip = h('div', { class: 'tip' });
  wrap.append(c, tip);
  const bars = [];
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth || 600, H = height;
    c.width = W * dpr; c.height = H * dpr;
    const g = c.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
    const padL = 48, padB = 22, padT = 8;
    const max = Math.max(1e-9, ...data.map(d => d.value));
    const step = niceStep(max);
    const top = Math.ceil(max / step) * step || 1;
    g.font = '11px Segoe UI'; g.fillStyle = '#7d725f'; g.strokeStyle = '#2c251b'; g.lineWidth = 1;
    for (let v = 0; v <= top + 1e-9; v += step) {
      const y = H - padB - (v / top) * (H - padB - padT);
      g.beginPath(); g.moveTo(padL, Math.round(y) + .5); g.lineTo(W, Math.round(y) + .5); g.stroke();
      g.fillText(fmt(v), 4, y + 4);
    }
    const n = data.length; const bw = (W - padL) / Math.max(n, 1);
    bars.length = 0;
    data.forEach((d, i) => {
      const bh = (d.value / top) * (H - padB - padT);
      const x = padL + i * bw + 1, w = Math.max(2, bw - 2), y = H - padB - bh;
      g.fillStyle = color;
      roundTop(g, x, y, w, bh, Math.min(4, w / 2));
      bars.push({ x, w, y, d });
      if (n <= 16 || i % Math.ceil(n / 12) === 0) { g.fillStyle = '#7d725f'; g.fillText(d.label, x, H - 6); }
    });
  };
  c.addEventListener('mousemove', e => {
    const r = c.getBoundingClientRect(); const x = e.clientX - r.left;
    const b = bars.find(b => x >= b.x - 1 && x <= b.x + b.w + 1);
    if (!b) { tip.style.display = 'none'; return; }
    tip.style.display = 'block'; tip.style.left = (b.x + b.w / 2) + 'px'; tip.style.top = Math.max(16, b.y) + 'px';
    tip.textContent = `${b.d.label}: ${fmt(b.d.value)}`;
  });
  c.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  requestAnimationFrame(draw);
  new ResizeObserver(draw).observe(c);
  return wrap;
}
function niceStep(max) { const raw = max / 4; const p = Math.pow(10, Math.floor(Math.log10(raw))); const n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function roundTop(g, x, y, w, hgt, r) {
  if (hgt <= 0) return;
  r = Math.min(r, hgt);
  g.beginPath(); g.moveTo(x, y + hgt); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + hgt); g.closePath(); g.fill();
}
