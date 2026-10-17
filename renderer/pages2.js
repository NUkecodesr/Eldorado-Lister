// ACCOUNT + SYSTEM pages.
const pickNum = (obj, keys) => {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object' && typeof v.amount === 'number') return v.amount;
  }
  // nested search one level down
  for (const v of Object.values(obj)) if (v && typeof v === 'object' && !Array.isArray(v)) { const r = pickNumShallow(v, keys); if (r !== null) return r; }
  return null;
};
const pickNumShallow = (o, keys) => { for (const k of keys) { const v = o[k]; if (typeof v === 'number') return v; if (v && typeof v.amount === 'number') return v.amount; } return null; };
const avatarUrl = me => {
  if (me && me === S.me && S.mePic) return S.mePic;
  const any = eldPicture(me); if (any) return any;
  const p = me && (me.picture || me.profilePicture);
  const f = p && (p.mediumPicture || p.smallPicture || p.largePicture);
  return f ? (/^https?:/.test(f) ? f : `https://assetsdelivery.eldorado.gg/v7/_profiles-v2_/${f}?w=80`) : null;
};

// ---- shared bits for the "original app" look (styles-b.css, classes mx-*) ----
const MXP = {
  hash: 'M5 9h14M5 15h14M10 4L8 20M16 4l-2 16', crown: 'M3 8l4 4 5-7 5 7 4-4-2 11H5z', cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0zM12 17v4', bell: 'M6 16V11a6 6 0 1112 0v5l2 2H4zM10 21h4', check: 'M5 12l5 5 9-10', x: 'M6 6l12 12M18 6L6 18',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z', thumb: 'M7 11v9H3v-9zM7 11l4-8c2 0 3 1 3 3l-1 4h6c1 0 2 1 2 2l-2 7c-.3 1-1 1.5-2 1.5H7',
  truck: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z', play: 'M8 5v14l11-7z', folder: 'M3 6h6l2 2h10v11H3z',
  code: 'M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14', user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0', clip: 'M9 4h6v3H9zM6 5h3M15 5h3v16H6V5', pulse: 'M3 12h4l3-8 4 16 3-8h4',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2', hook: 'M12 3a5 5 0 00-5 5v3l-2 3h14l-2-3V8a5 5 0 00-5-5zM10 18a2 2 0 004 0', speaker: 'M4 9h4l5-4v14l-5-4H4zM17 9a4 4 0 010 6',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', key: 'M14 10a4 4 0 11-3 3l-7 7v-3h3v-3h3l1-1', refresh: 'M20 12a8 8 0 10-3 6.2M20 5v6h-6',
  people: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 11a3 3 0 100-6M21 20a6 6 0 00-4-5.6', layers: 'M12 3l9 5-9 5-9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5', wallet: 'M3 7h18v12H3zM3 7l2-3h12l2 3M16 13h2', warn: 'M12 4l9 16H3zM12 10v4M12 17v.01'
};
function mxSvg(name, size) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', MXP[name] || (typeof ICONS !== 'undefined' && ICONS[name]) || ''); svg.appendChild(p);
  return svg;
}
const mxIco = (name, cls = '') => h('span', { class: 'mx-ico ' + cls }, mxSvg(name));
const amt = v => typeof v === 'number' ? v : (v && typeof v === 'object' && !Array.isArray(v) && typeof v.amount === 'number' ? v.amount : (typeof v === 'string' && v.trim() !== '' && !isNaN(parseFloat(v)) ? parseFloat(v) : null));
// first value whose key matches `re` (searches nested objects, depth-limited)
function mxFind(obj, re, depth = 4) {
  if (!obj || typeof obj !== 'object' || depth < 0) return null;
  for (const [k, v] of Object.entries(obj)) if (re.test(k) && v !== null && v !== undefined && (typeof v !== 'object' || amt(v) !== null)) return v;
  for (const v of Object.values(obj)) if (v && typeof v === 'object' && !Array.isArray(v)) { const r = mxFind(v, re, depth - 1); if (r !== null) return r; }
  return null;
}
const prettyKey = s => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const mxDay = ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const mxTime = ts => new Date(ts).toLocaleTimeString('en-GB', { hour12: false });
const fmtBytes = n => n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

// page header with the gold bar / icon box; right = array of nodes
function mxHead(title, sub, right = [], ico) {
  return h('div', { class: 'mx-head' },
    h('div', { class: 'mx-head-l' }, ico ? mxIco(ico) : h('span', { class: 'mx-bar' }), h('div', null, h('h1', null, title), h('p', null, sub))),
    h('div', { class: 'row mx-head-r' }, right));
}
const mxTile = (ico, k, v, cls = '') => h('div', { class: 'mx-tile ' + cls }, mxIco(ico), h('div', null, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)));
const mxSec = label => h('div', { class: 'mx-sec' }, label);
// card with small icon + title (+ optional subtitle / right controls)
function mxCard(ico, title, sub, right, ...body) {
  return h('div', { class: 'mx-card' },
    h('div', { class: 'mx-card-h' }, ico ? (typeof ico === 'string' ? mxIco(ico) : ico) : null, h('div', { class: 'grow' }, h('b', null, title), sub ? h('small', null, sub) : null), right || null),
    ...body);
}
const mxPills = (opts, cur, on) => h('div', { class: 'mx-pills' }, opts.map(([k, label]) => h('button', { class: 'mx-pill' + (cur === k ? ' on' : ''), onclick: () => on(k) }, label)));
const mxEmpty = (ico, text) => h('div', { class: 'mx-empty' }, mxSvg(ico, 26), h('div', null, text));

// sale sound (local only): works from any page, plays when a sale event arrives
function playSaleSound(force) {
  if (!force && lsGet('zotac.sound.on', '1') !== '1') return;
  const vol = Math.min(1, Math.max(0, Number(lsGet('zotac.sound.vol', '20')) / 100));
  const data = lsGet('zotac.sound.data', '');
  if (data) {
    try {
      const [meta, b64] = data.split(',');
      const mime = (meta.match(/:(.*?);/) || [])[1] || 'audio/mpeg';
      const bin = atob(b64); const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([u8], { type: mime }));
      const a = new Audio(url); a.volume = vol; a.onended = () => URL.revokeObjectURL(url); a.play().catch(() => {});
      return;
    } catch { /* fall through to beep */ }
  }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[880, 0], [1320, .14]].forEach(([f, t0]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(.0001, ctx.currentTime + t0); g.gain.exponentialRampToValueAtTime(Math.max(.0002, vol * .6), ctx.currentTime + t0 + .02); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + t0 + .35);
      o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + t0); o.stop(ctx.currentTime + t0 + .4);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch { /* no audio */ }
}
try { M.on('sale', () => playSaleSound()); } catch { /* ignore */ }

// ============================== ACCOUNT ===================================
const AC = { dash: null, loading: false };
PAGES.account = async root => {
  const load = async () => { AC.loading = true; render(); AC.dash = (await run(() => M.call('eld:dashboard'))) || {}; AC.loading = false; render(); };
  if (S.me && !AC.dash && !AC.loading) load();
  const cfg = (S.settings && S.settings.delivery) || {};
  const d = AC.dash || {};
  const me = S.me ? (d.me || S.me) : null;
  const prof = d.profile || {};
  const info = prof.userOrderInfo || prof.orderInfo || prof;
  const name = (me && (me.username || me.userName)) || 'Not connected';
  const fb = !me ? null : info.feedbackScore ?? (d.reviewStats && (d.reviewStats.feedbackScore ?? d.reviewStats.positivePercentage));
  const ratings = !me ? null : info.ratingCount ?? (d.reviewStats && (d.reviewStats.ratingCount ?? d.reviewStats.total));
  const rawId = me && (me.id || me.userId);
  const uid = rawId ? (String(rawId).length > 12 ? String(rawId).slice(0, 8) + '…' : String(rawId)) : '—';

  const loginBrowser = async () => { const m = await run(() => M.call('auth:loginBrowser')); if (m) { toast('Logged in as ' + m.username, 'good'); await refreshMe(); AC.dash = null; render(); } };
  const cookie = async () => { const c = await promptBox('Manual cookie', 'Cookie string (name=value; name2=value2)', '', true); if (!c) return; const r = await run(() => M.call('auth:cookie', c)); if (r) { toast(`Cookies set (${r.set}). Logged in as ${r.me.username}`, 'good'); await refreshMe(); AC.dash = null; render(); } };
  const extension = () => modal('Zotac Extension', h('div', null,
    h('p', { class: 'ink2' }, '100% local cookie sync from Chrome. Load the unpacked extension (Chrome › Extensions › Developer mode › Load unpacked), log in on eldorado.gg in Chrome and keep Zotac open. It pairs with Zotac by itself and keeps it logged in (on browser start, whenever your Eldorado login changes, and every 10 minutes). After updating the extension files, click its reload button in chrome://extensions.'),
    h('div', { class: 'kv' }, h('div', null, 'Port'), h('div', { class: 'mono' }, '127.0.0.1:' + S.settings.localPort), h('div', null, 'Token'), h('div', { class: 'mono' }, S.settings.extensionToken)),
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: () => M.call('open:path', S.info.extensionPath) }, 'Open extension folder'),
      h('button', { class: 'btn', onclick: () => { navigator.clipboard.writeText(S.settings.extensionToken); toast('Token copied', 'good'); } }, 'Copy token'))), [{ label: t('close') }]);

  const av = me && avatarUrl(me);
  const profileCard = h('div', { class: 'mx-card mx-profile' },
    h('div', { class: 'mx-prof-top' },
      av ? h('img', { class: 'mx-avatar', src: av }) : h('div', { class: 'mx-avatar ph' }, (name[0] || '?').toUpperCase()),
      h('div', { class: 'grow' },
        h('div', { class: 'row', style: { gap: '10px' } }, h('h2', null, name),
          cfg.enabled ? h('span', { class: 'mx-badge good' }, mxSvg('truck', 11), 'AUTO DELIVERY') : h('span', { class: 'mx-badge' }, 'MANUAL')),
        me ? h('div', { class: 'mx-sub' }, '@' + String(name).toLowerCase(), me.email ? ['  ·  ', h('span', { class: 'x-private', title: 'hover to show' }, me.email)] : '') : h('div', { class: 'mx-sub' }, 'Connect your Eldorado account below')),
      me ? h('button', { class: 'btn sm', onclick: () => M.call('open:external', `https://www.eldorado.gg/users/${me.username}`) }, 'Public profile ↗') : null),
    h('div', { class: 'mx-tiles' },
      mxTile('hash', 'USER ID', uid),
      mxTile('star', 'FEEDBACK', fb != null ? Number(fb).toFixed(1) + '%' : '—', 'gold'),
      mxTile('people', 'RATINGS', ratings != null ? String(ratings) : '—')));

  const sessionRow = h('div', { class: 'mx-session' }, h('span', { class: 'lbl' }, 'SESSION'),
    me ? h('button', { class: 'btn sm', onclick: load }, AC.loading ? 'Loading…' : t('refresh')) : null,
    h('button', { class: 'btn sm', onclick: loginBrowser }, me ? 'Re-login via Browser' : 'Login via Browser'),
    h('button', { class: 'btn sm', onclick: cookie }, 'Manual Cookie'),
    h('button', { class: 'btn sm', onclick: extension }, mxSvg('plug', 12), 'Extension'),
    me ? h('div', { class: 'grow' }) : null,
    me ? h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox('Log out of Eldorado in Zotac?')) { await M.call('auth:logout'); S.me = null; AC.dash = null; render(); renderFooter(); } } }, t('logout')) : null);

  if (!me) {
    root.append(h('div', { class: 'mx-narrow' }, mxHead('Account', 'Your Eldorado profile, balance & session'), profileCard,
      h('div', { class: 'mx-card mx-notconn' }, mxIco('plug', 'big'), h('b', null, 'Not connected to Eldorado'), h('small', null, 'Choose a connection method below — browser login, Chrome extension or manual cookie.')),
      sessionRow));
    return;
  }
  const balance = pickNum(d.wallet, ['balance', 'availableBalance', 'currentBalance', 'withdrawableBalance', 'totalBalance']);
  const pending = typeof d.pending === 'number' ? d.pending : pickNum(d.pending, ['amount', 'sum', 'pendingOrdersSum', 'total']);
  const activeOffers = d.offerStates ? (d.offerStates.active ?? d.offerStates.Active ?? pickNum(d.offerStates, ['active', 'Active'])) : null;
  const orderStates = d.orderStates || {};
  const ordersTotal = typeof orderStates === 'object' ? Object.values(orderStates).filter(v => typeof v === 'number').reduce((a, b) => a + b, 0) : null;
  root.append(h('div', { class: 'mx-narrow wide' }, mxHead('Account', 'Your Eldorado profile, balance & session'), profileCard,
    h('div', { class: 'grid g4', style: { marginBottom: '14px' } },
      stat('Balance', money(balance), 'available', 'gold'),
      stat('Pending Sales', money(pending), 'awaiting completion'),
      stat('Active Listings', activeOffers != null ? String(activeOffers) : '—', S.settings.game.seoAlias),
      stat('Orders', ordersTotal != null ? String(ordersTotal) : '—', Object.entries(orderStates).filter(([, v]) => typeof v === 'number' && v).map(([k, v]) => `${k}: ${v}`).join(' · ').slice(0, 80))),
    mxCard('pulse', 'Connection', 'Bridge, watcher and chat listener', h('span', { class: 'pill ' + (S.bridge === 'connected' ? 'good' : 'bad') }, h('span', { class: 'dot' }), S.bridge === 'connected' ? 'Online' : S.bridge),
      h('div', { class: 'kv', style: { marginTop: '10px' } },
        h('div', null, 'Bridge'), h('div', null, S.bridge),
        h('div', null, 'Last API success'), h('div', null, ago(S.info.lastOk)),
        h('div', null, 'Order watcher'), h('div', null, 'last poll ' + ago(S.info.watcherLast)),
        h('div', null, 'Chat listener'), h('div', null, S.info.talk + (S.info.talkError ? ' — ' + S.info.talkError : '')),
        h('div', null, 'Extension / agent port'), h('div', { class: 'mono' }, '127.0.0.1:' + S.settings.localPort))),
    sessionRow,
    jsonDetails('Raw dashboard data', d)));
};

// ============================== WALLET ====================================
const WL = { data: null, orders: null, loading: false };
PAGES.wallet = async root => {
  const load = async () => {
    WL.loading = true; render();
    const [w, o] = await Promise.all([run(() => M.call('eld:wallet')), run(() => M.call('eld:orders', { page: 1, pageSize: 50 }))]);
    WL.data = w || {}; WL.orders = o ? o.rows : []; WL.loading = false; render();
  };
  if (S.me && !WL.data && !WL.loading) load();
  const refreshBtn = h('button', { class: 'btn sm', onclick: load }, mxSvg('refresh', 12), WL.loading ? 'Loading…' : t('refresh'));
  if (!S.me) { root.append(mxHead('Wallet', 'Balance & transaction history'), h('div', { class: 'card empty' }, 'Log in on the Account page.')); return; }
  const p = (WL.data && WL.data.payment) || {};
  const balance = pickNum(p, ['balance', 'availableBalance', 'currentBalance', 'withdrawableBalance']);
  const pend = WL.data ? (typeof WL.data.pending === 'number' ? WL.data.pending : pickNum(WL.data.pending, ['amount', 'sum', 'total'])) : null;
  const txs = Object.values(p).find(v => Array.isArray(v)) || [];
  const orders = WL.orders || [];
  const completed = orders.filter(o => /receiv|complet/i.test(o.state));
  const delivered = orders.filter(o => /deliver/i.test(o.state) && !/receiv|complet/i.test(o.state));
  const canceled = orders.filter(o => /cancel|refund|disput/i.test(o.state));
  const sum = list => list.reduce((a, o) => a + (o.earnings ?? o.price ?? 0), 0);

  let rows = txs.map(x => ({
    date: x.createdDate || x.date || x.created || x.createdAt || x.transactionDate,
    change: amt(x.balanceChange) ?? amt(x.amount) ?? amt(x.change) ?? amt(x.sum) ?? amt(mxFind(x, /amount|change|sum/i)),
    orderId: x.orderId || x.referenceId || x.reference || x.id || '',
    desc: x.description || x.title || x.reason || prettyKey(x.type || x.transactionType) || '',
    raw: x
  }));
  let fallback = false;
  if (!rows.length && orders.length) {
    fallback = true;
    rows = orders.map(o => ({ date: o.date, change: /cancel|refund|disput/i.test(o.state) ? null : (o.earnings ?? o.price), orderId: o.id, desc: /cancel|refund|disput/i.test(o.state) ? 'Order ' + prettyKey(o.state).toLowerCase() + '.' : 'You successfully sold Order.', raw: o }));
  }
  const view = r => modal('Transaction', h('div', null,
    h('div', { class: 'kv' }, h('div', null, 'Date'), h('div', null, fmtDate(r.date)), h('div', null, 'Balance change'), h('div', null, r.change == null ? '—' : (r.change >= 0 ? '+' : '−') + money(Math.abs(r.change))), h('div', null, 'Order ID'), h('div', { class: 'mono' }, r.orderId || '—'), h('div', null, 'Description'), h('div', null, r.desc || '—')),
    h('pre', { class: 'json', style: { marginTop: '12px' } }, JSON.stringify(r.raw, null, 2))),
    [{ label: t('close') }, r.orderId && orders.some(o => o.id === r.orderId) ? { label: 'Open order chat', cls: 'primary', fn: () => { CH.orderId = r.orderId; go('chat'); } } : null].filter(Boolean));
  const cols = [
    { label: 'DATE CREATED', render: r => fmtDate(r.date) },
    { label: 'BALANCE CHANGE', render: r => r.change == null ? h('span', { class: 'muted' }, '—') : h('b', { class: r.change >= 0 ? 'mx-pos' : 'mx-neg' }, (r.change >= 0 ? '+' : '−') + money(Math.abs(r.change))) },
    { label: 'ORDER ID', render: r => h('span', { class: 'mono muted' }, r.orderId || '—') },
    { label: 'DESCRIPTION', render: r => r.desc || h('span', { class: 'muted' }, '—') },
    { label: '', render: r => h('div', { style: { textAlign: 'right' } }, h('button', { class: 'btn sm', onclick: () => view(r) }, 'View')) }
  ];
  root.append(mxHead('Wallet', 'Balance & transaction history', [refreshBtn, h('button', { class: 'btn sm', onclick: () => M.call('open:external', 'https://www.eldorado.gg/dashboard/wallet') }, 'Withdraw on Eldorado ↗')]),
    h('div', { class: 'mx-tiles3' },
      h('div', { class: 'mx-stat hl' }, h('div', { class: 'k' }, 'BALANCE'), h('div', { class: 'v gold' }, money(balance))),
      h('div', { class: 'mx-stat' }, h('div', { class: 'k' }, 'PENDING SALES'), h('div', { class: 'v' }, money(pend)), h('div', { class: 's' }, 'Funds from pending orders')),
      h('div', { class: 'mx-stat' }, h('div', { class: 'k' }, 'COMPLETED SALES'), h('div', { class: 'v' }, String(completed.length)), h('div', { class: 's' }, money(sum(completed)) + ' (last 50)')),
      h('div', { class: 'mx-stat' }, h('div', { class: 'k' }, 'DELIVERED'), h('div', { class: 'v' }, String(delivered.length))),
      h('div', { class: 'mx-stat' }, h('div', { class: 'k' }, 'CANCELED ORDERS'), h('div', { class: 'v' }, String(canceled.length)))),
    h('h3', { class: 'mx-h3' }, 'Transaction History', fallback ? h('small', null, 'wallet returned no transaction list — showing your 50 latest orders') : null),
    table(rows, cols, { empty: WL.loading ? 'Loading…' : 'No transactions yet.', maxHeight: 'calc(100vh - 400px)' }),
    h('div', { style: { marginTop: '10px' } }, jsonDetails('Raw wallet data', WL.data)));
};

// ============================== ANALYTICS =================================
PAGES.analytics = async root => {
  const days = 30;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); buckets.push({ key: d.toDateString(), label: `${d.getMonth() + 1}/${d.getDate()}`, value: 0, count: 0 }); }
  const okSales = S.sales.filter(s => !/cancel|refund/i.test(s.state || ''));
  for (const s of okSales) { const k = new Date(s.date).toDateString(); const b = buckets.find(x => x.key === k); if (b) { b.value += Number(s.price) || 0; b.count++; } }
  const rev30 = buckets.reduce((a, b) => a + b.value, 0);
  const cnt30 = buckets.reduce((a, b) => a + b.count, 0);
  const listed = S.pets.filter(p => p.status === 'listed').length;
  const sold = S.pets.filter(p => p.status === 'sold');
  const avgDays = sold.filter(p => p.listedAt && p.soldAt).map(p => (p.soldAt - p.listedAt) / 864e5);
  const byPet = {};
  for (const s of okSales) { const k = (s.title || '').split('|')[0].trim().slice(0, 40) || '—'; byPet[k] = byPet[k] || { name: k, n: 0, rev: 0 }; byPet[k].n++; byPet[k].rev += Number(s.price) || 0; }
  const top = Object.values(byPet).sort((a, b) => b.rev - a.rev).slice(0, 10);
  const byMut = {};
  for (const p of sold) { const k = p.mutation || 'None'; byMut[k] = (byMut[k] || 0) + (p.soldPrice || 0); }
  const invValue = S.pets.filter(p => p.status !== 'sold').reduce((a, p) => a + (Number(p.price) || 0), 0);
  root.append(pageHead('analytics', h('span', { class: 'muted' }, 'Updates live as sales come in')),
    h('div', { class: 'grid g4', style: { marginBottom: '14px' } },
      stat('Revenue (30d)', money(rev30), `${cnt30} sales`, 'gold'),
      stat('Net after fee (30d)', money(rev30 * 0.85), '−15% Eldorado', 'good'),
      stat('Avg sale', money(cnt30 ? rev30 / cnt30 : 0)),
      stat('Avg time to sell', avgDays.length ? (avgDays.reduce((a, b) => a + b, 0) / avgDays.length).toFixed(1) + ' d' : '—', `${listed} listed now`)),
    h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h3', null, 'Daily revenue ', h('small', null, 'last 30 days')), barChart(buckets, { fmt: v => '$' + (v >= 100 ? Math.round(v) : v.toFixed(2)) })),
    h('div', { class: 'grid g2' },
      h('div', { class: 'card' }, h('h3', null, 'Top sellers'), table(top, [{ label: 'Item', k: 'name' }, { label: 'Sales', num: true, k: 'n' }, { label: 'Revenue', num: true, render: r => money(r.rev) }], { empty: 'No sales yet.' })),
      h('div', { class: 'card' }, h('h3', null, 'Inventory'),
        h('div', { class: 'kv' },
          h('div', null, 'Pets tracked'), h('div', null, String(S.pets.length)),
          h('div', null, 'Available'), h('div', null, String(S.pets.filter(p => p.status === 'available').length)),
          h('div', null, 'Listed'), h('div', null, String(listed)),
          h('div', null, 'Sold'), h('div', null, String(sold.length)),
          h('div', null, 'Unsold value (at set price)'), h('div', null, money(invValue)),
          h('div', null, 'Accounts'), h('div', null, String(S.accounts.length))),
        h('h3', { style: { marginTop: '16px' } }, 'Revenue by mutation'),
        table(Object.entries(byMut).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, v })), [{ label: 'Mutation', render: r => mutPill(r.k) }, { label: 'Revenue', num: true, render: r => money(r.v) }], { empty: 'No sold pets yet.' }))));
};

// ============================== REVIEWS ===================================
const RV = { data: null, rows: [], loading: false, page: 1, more: false, filter: 'all', cursor: null };
const rvPos = r => /pos|good|thumbsup|true/i.test(String(r.rating ?? r.ratingType ?? r.isPositive ?? r.type ?? ''));
const rvTags = r => {
  const a = r.tags || r.reviewTags || r.feedbackTags || r.ratingTags || r.badges || r.labels || r.reasons || [];
  return (Array.isArray(a) ? a : []).map(x => typeof x === 'string' ? x : (x && (x.name || x.title || x.label || x.text || x.value))).filter(Boolean).map(prettyKey);
};
PAGES.reviews = async root => {
  const fetchPage = async p => {
    RV.loading = true; render();
    const d = await run(() => M.call('eld:reviews', p === 1 ? null : RV.cursor));
    RV.loading = false;
    if (p === 1) { RV.data = d || { rows: [], error: 'Could not load reviews' }; RV.rows = (d && d.rows) || []; }
    else if (d) { RV.rows = RV.rows.concat(d.rows || []); if (d.stats) RV.data.stats = d.stats; }
    if (d) { RV.page = p; RV.cursor = d.cursor || null; RV.more = !!d.cursor; }
    render();
  };
  if (S.me && !RV.data && !RV.loading) fetchPage(1);
  if (!S.me) { root.append(mxHead('Reviews', 'Ratings & feedback from buyers', [], 'star'), h('div', { class: 'card empty' }, 'Log in on the Account page.')); return; }
  const st = (RV.data && RV.data.stats) || {};
  const rows = RV.rows;
  const shown = rows.filter(r => RV.filter === 'all' || (RV.filter === 'pos') === rvPos(r));
  const posN = st.positiveCount ?? st.positive ?? (rows.length ? rows.filter(rvPos).length : null);
  const negN = st.negativeCount ?? st.negative ?? (rows.length ? rows.filter(r => !rvPos(r)).length : null);
  root.append(h('div', null, mxHead('Reviews', 'Ratings & feedback from buyers', [
    st.feedbackScore != null ? h('span', { class: 'pill gold' }, 'Feedback ' + Number(st.feedbackScore).toFixed(2) + '%') : null,
    h('button', { class: 'btn sm', onclick: () => fetchPage(1) }, mxSvg('refresh', 12), RV.loading ? 'Loading…' : t('refresh'))], 'star'),
  h('div', { class: 'mx-strip' },
    h('div', null, h('div', { class: 'k' }, 'POSITIVE'), h('div', { class: 'v gold' }, posN != null ? String(posN) : '—')),
    h('div', null, h('div', { class: 'k' }, 'NEGATIVE'), h('div', { class: 'v bad' }, negN != null ? String(negN) : '—')),
    h('div', null, h('div', { class: 'k' }, 'TOTAL'), h('div', { class: 'v' }, String(st.ratingCount ?? st.total ?? rows.length)))),
  mxPills([['all', 'All'], ['pos', 'Positive'], ['neg', 'Negative']], RV.filter, k => { RV.filter = k; render(); }),
  shown.length ? h('div', { class: 'mx-list' }, shown.map(r => {
    const pos = rvPos(r); const tags = rvTags(r);
    const price = amt(r.orderAmount ?? r.amount ?? r.price ?? r.orderPrice ?? r.totalPrice) ?? amt(mxFind(r, /^(order)?(price|amount|total)/i));
    const date = r.createdDate || r.date || r.reviewDate;
    const text = r.comment || r.review || r.text || r.description;
    return h('div', { class: 'mx-rev' + (pos ? '' : ' neg') },
      h('div', { class: 'row', style: { flexWrap: 'nowrap', alignItems: 'flex-start' } },
        h('div', { class: 'grow' },
          h('div', { class: 'who' }, r.buyerUsername || (r.buyer && r.buyer.username) || r.reviewerUsername || r.username || 'Buyer'),
          h('div', { class: 'meta' }, date ? new Date(date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '—', price != null ? ' · ' + money(price) : '', r.offerTitle ? ' · ' + r.offerTitle : ''),
          tags.length ? h('div', { class: 'mx-tags' }, tags.map(x => h('span', null, x))) : null,
          text ? h('div', { class: 'quote' }, '“' + text + '”') : null),
        h('span', { class: 'mx-badge ' + (pos ? 'good' : 'bad') }, mxSvg(pos ? 'thumb' : 'x', 11), pos ? 'Positive' : 'Negative')));
  })) : h('div', null, h('div', { class: 'card empty' }, RV.loading ? 'Loading…' : (RV.data && RV.data.error) || 'No reviews.'), RV.data && RV.data.raw ? jsonDetails('Raw', RV.data.raw) : null),
  RV.more ? h('div', { class: 'mx-more' }, h('button', { class: 'btn', onclick: () => fetchPage(RV.page + 1) }, 'Load more')) : null));
};

// ============================== NOTIFICATIONS =============================
const WH = { kind: 'delivered', dkind: 'delivered' };
const NT = { list: null, orders: null, page: 1, more: false, unreadOnly: false, loading: false, shown: 15 };
const ntKind = n => { const s = `${n.type} ${n.title} ${n.body}`; return /cancel|refund|reject|declin|dispute|fail/i.test(s) ? 'bad' : /complet|deliver|receiv|sold|paid|releas|success|new order/i.test(s) ? 'good' : 'info'; };
const ntBuyer = n => {
  const b = mxFind(n.raw, /buyer/i);
  if (typeof b === 'string') return b;
  const m = /(?:buyer|by|from)[: ]+@?([\w.-]+)/i.exec(n.body || '');
  return m ? m[1] : '';
};
const ntAmount = n => {
  const v = mxFind(n.raw, /^(price|amount|totalprice|orderamount|sellerearnings|earnings|totalamount)$/i);
  if (amt(v) !== null) return amt(v);
  const m = /\$\s?([\d,]+(?:\.\d+)?)/.exec(`${n.title} ${n.body}`);
  return m ? parseFloat(m[1].replace(/,/g, '')) : null;
};
// Like Meowl's: one row per sold order showing what happened to it last (Received, Delivered,
// Canceled...), the buyer, when, and the amount; newest first, 20 at a time.
PAGES.notifications = async root => {
  const load = async more => {
    NT.loading = true; render();
    const page = more ? NT.page + 1 : 1;
    const r = await run(() => M.call('eld:orders', { page, pageSize: 20 }));
    NT.loading = false;
    if (r) {
      const rows = r.rows || [];
      NT.orders = more ? [...(NT.orders || []), ...rows.filter(o => !(NT.orders || []).some(x => x.id === o.id))] : rows;
      NT.page = page; NT.more = rows.length >= 20 && (!r.pages || page < r.pages);
    } else if (!more) NT.orders = NT.orders || [];
    render();
  };
  if (S.me && !NT.orders && !NT.loading) load(false);
  const head = right => mxHead('Notifications', 'What happened to your orders, newest first.', right, 'bell');
  if (!S.me) { root.append(head([]), h('div', { class: 'card empty' }, 'Log in on the Account page.')); return; }
  const ok = S.bridge === 'connected';
  const when = o => { const st = o.raw && o.raw.state; return (st && typeof st === 'object' && (st.updatedDate || st.date || st.createdDate)) || o.raw && (o.raw.updatedDate || o.raw.lastUpdatedDate) || o.date; };
  const label = s => String(s || 'Order').replace(/([a-z])([A-Z])/g, '$1 $2');
  const icon = o => XSTATE.canceled(o.state) ? h('div', { class: 'nic bad' }, mxSvg('x', 16))
    : XSTATE.disputed(o.state) ? h('div', { class: 'nic bad' }, '!')
    : h('div', { class: 'nic box' }, h('span', { class: 'nbox' }));
  const list = (NT.orders || []).slice().sort((a, b) => new Date(when(b)) - new Date(when(a)));
  root.append(h('div', null, head([
    h('button', { class: 'btn sm', onclick: () => load(false) }, mxSvg('refresh', 12), NT.loading ? 'Loading…' : t('refresh')),
    S.unread ? h('a', { class: 'mx-link', href: '#', onclick: async e => { e.preventDefault(); await run(() => M.call('eld:markAllRead'), 'All marked as read'); S.unread = 0; renderFooter(); renderNav(); } }, 'Mark all as read') : null]),
  h('div', { class: 'mx-status ' + (ok ? 'on' : 'off') }, h('span', { class: 'dot' }), ok ? 'Connected' : S.bridge),
  list.length ? h('div', { class: 'mx-nlist' }, list.map(o => h('div', { class: 'mx-nrow', title: o.title || '', onclick: () => { CH.orderId = o.id; go('chat'); } },
    icon(o),
    h('div', { class: 'grow' },
      h('div', { class: 't1' }, h('b', null, label(o.state)), h('span', { class: 'muted' }, ago(when(o)))),
      h('div', { class: 't2' }, 'Buyer: ', h('b', null, o.buyer || '—'))),
    o.price != null ? h('div', { class: 'amt' }, money(o.price)) : null)))
    : h('div', { class: 'card empty' }, NT.loading ? 'Loading…' : 'No orders yet.'),
  NT.more ? h('div', { class: 'mx-more' }, h('button', { class: 'btn', disabled: NT.loading, onclick: () => load(true) }, NT.loading ? 'Loading…' : 'Load more')) : null));
};

// ============================== AUTO DELIVERY =============================
const DV = { data: null, tab: 'activity', hist: 'all', clearedAt: 0 };
const STEP_META = [
  ['STEP 1 - GREETING', 'Order received, asking the buyer for their username', 'gold', [
    ['greeting', 'Greeting', 'new order without a Roblox username: asks for it', '{buyer} {orderId}'],
    ['greetingKnownUser', 'Greeting (username given at checkout)', 'the buyer is only asked to confirm it', '{buyer} {username}']]],
  ['STEP 2 - USERNAME CHECK', "Validating and confirming the buyer's Roblox username", 'purple', [
    ['confirmUsername', 'Username confirmation', 'Yes/No prompt', '{username}'],
    ['invalidReply', 'Invalid confirmation reply', 'buyer typed something other than 1 or 2', ''],
    ['usernameRejected', 'Username rejected', 'buyer replied "No", asks again', ''],
    ['usernameNotFound', 'Username not found', 'no Roblox account with that name', '']]],
  ['STEP 3 - DELIVERY', 'Trade machine flow — sending the trade and handling retries', 'gold', [
    ['deliveryStarting', 'Delivery starting', 'username confirmed, launching delivery', '{username}'],
    ['gathering', 'Gathering onto one account', 'pets on several accounts: the mother takes them first (Security)', '{quantity} {accounts} {mother}'],
    ['buyerCancelled', 'Buyer cancelled the trade', 'the trade is sent again at once (up to 2 more times)', '{round}'],
    ['buyerOffline', 'Buyer offline', 'the trade is ready but the buyer is not online in the game (waits 3 min)', '{username}'],
    ['deliveryFailed', 'Delivery failed (retrying)', 'agent reported a failed trade', '{reason}'],
    ['deliverySuccess', 'Delivery success', 'all trades done', '{username}'],
    ['manualFallback', 'Manual fallback', 'when Zotac needs you: 3 failures with cancelling off, or pets it can not match', ''],
    ['orderCancelled', 'Order cancelled', 'after 3 failures: the order is cancelled and refunded', '{reason} {attempts}'],
    ['usernameReminder', 'Username reminder', 'no username / confirmation yet, halfway to the limit', '{minutes}'],
    ['buyerKeptCancelling', 'Given up: buyer kept cancelling', 'the buyer cancelled the trade too many times: cancelled and refunded', '{count}'],
    ['buyerNoShow', 'Given up: buyer offline / no accept', 'the buyer stayed offline or never accepted the trade: cancelled and refunded', '{minutes}'],
    ['buyerNoUsername', 'Given up: no username', 'no Roblox username within the limit: cancelled and refunded', '{minutes}'],
    ['outOfStock', 'Out of stock (cancelled)', 'the brainrot is not there (not tracked, gone from the base, or missing in game twice): cancelled and refunded', '{item} {reason}']]]
];
const TUTORIAL = {
  setup: [
    ['Connect Eldorado', ['Open ', ['Account'], ' and log in with the browser, a manual cookie or the Zotac extension. Auto Delivery needs a live Eldorado session to read orders and chat with buyers.']],
    ['Add your Roblox accounts', ['In ', ['Roblox Accounts'], ' log in every ', ['stock account'], ' (cookie or browser login) and set your private server. Zotac opens them by itself and the scanner syncs their pets.']],
    ['List your pets', ['Use ', ['Auto List'], ' so each Eldorado offer is linked to a pet. When an order arrives, Zotac matches the offer to the listed pets it has to deliver.']],
    ['Delivery script', ['Zotac installs ', ['zotac_delivery.lua'], ' in your executor\'s autoexec (see the Autoexec card), so it runs in every account Zotac opens. Other executors: add their autoexec folder there.']],
    ['Review your messages', ['Open the ', ['Automatic Messages'], ' tab and adjust the greeting, confirmation and failure texts that the buyer receives.']],
    ['Turn Auto Delivery on', ['Flip the switch at the ', ['top-right'], ' of this page. The dot turns green when it is enabled. Keep the app running.']]
  ],
  how: [
    ['A buyer pays', ['the order enters the ', ['Delivery Queue'], ' and Zotac greets them in the order chat.']],
    ['The buyer sends their Roblox username', ['Zotac looks it up and asks them to confirm with 1 (yes) or 2 (no).']],
    ['Delivery mode', [['Security Mode Only'], ': one SCRIPT account (the mother) takes the pets in game from the stock accounts, opened with real Roblox one at a time (max 2 games open), then does one trade to the buyer. ', ['Single Mode'], ': an order on one SCRIPT account is traded straight from it; anything else uses Security.']],
    ['A trade job is created', ['the account is opened if needed and its script sends the trade to the buyer. If the buyer cancels, it is sent again.']],
    ['Done', ['when the script reports success, Zotac tells the buyer, optionally marks the order as delivered and records the trade on video. After 3 failed tries the order is ', ['cancelled'], ' on Eldorado (or left to you if that is switched off).']]
  ]
};
const richText = parts => parts.map(p => Array.isArray(p) ? h('b', null, p[0]) : p);

// ---------- order simulator ----------
// A fake Eldorado order: the bot's messages are the real Automatic Messages flow, you type the
// buyer's replies, and after the buyer confirms the real delivery job is queued (the in-game
// trade, launch and agent are all real). Nothing is sent to Eldorado or Discord.
async function openOrderSimulator() {
  if (!(S.settings.delivery || {}).enabled && !await confirmBox('Auto Delivery is off, so zotac_delivery.lua is not in autoexec and the in-game trade at the end will not run. Simulate anyway (chat only)?')) return;
  const avail = S.pets.filter(p => p.status !== 'sold' && !p.delivered);   // delivered pets left the base
  if (!avail.length) return toast('No pets to sell', 'error');
  const petSel = h('select', null, avail.map(p => h('option', { value: p.id }, `${p.name}${p.mutation && p.mutation !== 'None' ? ' · ' + p.mutation : ''} · ${formatGen(p.gen)} · @${(S.accounts.find(a => a.id === p.accountId) || {}).username || '?'}`)));
  const buyerIn = h('input', { type: 'text', value: 'EldoradoBuyer', placeholder: 'Eldorado buyer name' });
  // quantity: how many identical copies (same name, mutation, gen/s, traits) the buyer bought;
  // copies on other accounts are delivered like a real order (Security: the mother takes them first)
  const nk = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const sameKey = p => [nk(p.name), nk(p.mutation || 'None'), Math.round(Number(p.gen) || 0), (p.traits || []).map(nk).sort().join(',')].join('|');
  const qtyIn = h('input', { type: 'number', min: 1, value: 1, style: { width: '80px' } });
  const qtyHint = h('small', { class: 'muted' });
  const showQty = () => {
    const pet = avail.find(p => p.id === petSel.value);
    const same = pet ? avail.filter(p => sameKey(p) === sameKey(pet)) : [];
    const accts = [...new Set(same.map(p => (S.accounts.find(a => a.id === p.accountId) || {}).username || '?'))];
    qtyIn.max = Math.max(1, same.length);
    qtyHint.textContent = `${same.length} identical in stock${accts.length > 1 ? ' on ' + accts.map(a => '@' + a).join(', ') + ' (the mother takes them first)' : ''}`;
  };
  petSel.addEventListener('change', showQty); showQty();
  const start = await new Promise(res => modal('Simulate an order', h('div', { class: 'grid' },
    h('p', { class: 'muted' }, 'Runs the whole buyer chat inside Zotac. The in-game trade at the end is REAL.'),
    h('label', { class: 'f' }, 'Pet the buyer "bought"', petSel),
    h('label', { class: 'f' }, 'Quantity', h('div', { class: 'row' }, qtyIn, qtyHint)),
    h('label', { class: 'f' }, 'Eldorado buyer name (chat label only)', buyerIn)),
    [{ label: t('cancel'), fn: () => res(null) }, { label: 'Start chat', cls: 'primary', fn: () => res({ petId: petSel.value, buyer: buyerIn.value.trim() || 'Buyer', quantity: Math.max(1, Number(qtyIn.value) || 1) }) }]));
  if (!start) return;
  let d;
  try { d = await M.call('delivery:simulate', [start.petId], start.buyer, start.quantity); } catch (e) { return toast(e.message, 'error'); }
  if (!d) return toast('Simulator could not start', 'error');
  const orderId = d.orderId;

  const msgs = h('div', { class: 'sim-msgs' });
  const status = h('div', { class: 'sim-status' });
  const input = h('input', { type: 'text', placeholder: 'Type as the buyer…', class: 'sim-in' });
  const send = async text => { text = String(text || input.value).trim(); if (!text) return; input.value = ''; await M.call('delivery:simSay', orderId, text); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  const quick = h('div', { class: 'sim-quick' },
    h('button', { class: 'btn sm', onclick: async () => { const u = await promptBox('Buyer', 'Roblox username the buyer sends', ''); if (u) send(u); } }, 'Send username…'),
    h('button', { class: 'btn sm', onclick: () => send('1') }, '1 (yes)'),
    h('button', { class: 'btn sm', onclick: () => send('2') }, '2 (no)'));
  const draw = async () => {
    const cur = await M.call('delivery:simState', orderId);
    if (!cur) return;
    msgs.textContent = '';
    for (const m of cur.log || []) {
      if (m.in !== undefined) msgs.append(h('div', { class: 'sim-b in' }, h('small', null, cur.buyer), m.in));
      else if (m.out !== undefined) msgs.append(h('div', { class: 'sim-b out' }, h('small', null, 'You (auto)'),
        m.image ? h('div', { class: 'sim-pfp' }, h('img', { src: m.image, alt: '' }), h('span', null, '@' + (cur.username || ''))) : null, m.out));
      else if (m.err) msgs.append(h('div', { class: 'sim-b err' }, m.err));
    }
    msgs.scrollTop = msgs.scrollHeight;
    let job = '';
    try {
      const jobs = (await M.call('delivery:jobs')).filter(j => j.orderId === orderId);
      const j = jobs[jobs.length - 1];
      // live jobs of the order (Security mode: the mother's steal, then the buyer trade)
      const live = jobs.filter(x => ['pending', 'running'].includes(x.status));
      const show = live.length ? live : (j ? [j] : []);
      const one = x => `${x.kind === 'steal' ? 'steal' : 'trade'} ${x.status}` +
        (x.kind === 'steal' ? ` (@${x.account} takes from @${x.fromUsername})` : x.account ? ` (@${x.account} → @${x.buyerUsername})` : '') + (x.reason ? ' — ' + x.reason : '');
      if (show.length) job = ' · ' + show.map(one).join(' · ');
    } catch { /* jobs not loaded */ }
    status.textContent = `Order ${orderId} · ${cur.state}${cur.username ? ' · Roblox @' + cur.username : ''}${job}`;
  };
  const off = M.on('delivery:update', u => { if (u && u.orderId === orderId) draw(); });
  const offJob = M.on('delivery:job', j => { if (j && j.orderId === orderId) draw(); });
  const timer = setInterval(draw, 3000);
  const closeSim = modal('Simulated order — ' + d.title, h('div', { class: 'sim' }, status, msgs, quick, h('div', { class: 'row' }, input, h('button', { class: 'btn primary', onclick: () => send() }, 'Send'))),
    [{ label: 'Cancel order', cls: 'danger', fn: async () => { await M.call('delivery:manual', orderId, 'cancel'); } }, { label: t('close') }]);
  const bg = $('#modal-root').lastElementChild;
  const stop = () => { clearInterval(timer); off(); offJob(); };
  new MutationObserver((_, o) => { if (!bg.isConnected) { o.disconnect(); stop(); } }).observe($('#modal-root'), { childList: true });
  void closeSim;
  draw(); setTimeout(() => input.focus(), 50);
}

// ============================== SERVER SCAN ===============================
// What the scanner script sees in its Roblox server: every base with its owner and pets.
const SV = { scans: null, job: '', view: 'bases', q: '', hideMine: false, open: new Set() };
PAGES.server = async root => {
  if (!SV.scans) SV.scans = await M.call('server:scans');
  const scans = SV.scans || [];
  const scan = scans.find(x => x.jobId === SV.job) || scans[0];
  const head = xHead('S', 'Server Scan', t('server.sub'),
    scans.length > 1 ? sel(scans.map(x => [x.jobId, `${x.by} · ${(x.bases || []).length} bases · ${ago(x.receivedAt)}`]), scan && scan.jobId, v => { SV.job = v; render(); }) : null,
    h('button', { class: 'btn sm', onclick: async () => { SV.scans = await M.call('server:scans'); render(); } }, t('refresh')));
  if (!scan) {
    root.append(head, h('div', { class: 'card empty' },
      h('b', null, 'No server scan yet'),
      h('p', { class: 'muted' }, 'Open an account with Zotac (the scanner runs from autoexec) or run the scanner from Auto List in a Steal a Brainrot server. Besides your own base it reports every base in the server, every 30 seconds.')));
    return;
  }
  const q = SV.q.toLowerCase();
  const bases = (scan.bases || []).filter(b => !(SV.hideMine && b.mine));
  const match = (b, p) => !q || String(p.name).toLowerCase().includes(q) || String(b.owner || '').toLowerCase().includes(q) || String(b.displayName || '').toLowerCase().includes(q)
    || String(p.mutation || '').toLowerCase().includes(q) || (p.traits || []).some(tr => String(tr).toLowerCase().includes(q));
  const allPets = [];
  for (const b of bases) for (const p of b.pets || []) if (match(b, p)) allPets.push({ ...p, base: b });
  allPets.sort((a, b) => (b.gen || 0) - (a.gen || 0));

  // pictures and icons, fetched once and cached
  const want = { pets: [...new Set(allPets.map(p => p.name))].filter(n => !(n in ART_THUMBS.pets) && !ART_THUMBS.asked.has('p:' + n)).slice(0, 40),
    traits: [...new Set(allPets.flatMap(p => p.traits || []))].filter(n => !ART_THUMBS.traits[n] && !ART_THUMBS.asked.has('t:' + n)),
    mutations: [...new Set(allPets.map(p => p.mutation).filter(m => m && !/^(none|normal)$/i.test(m)))].filter(n => !ART_THUMBS.mutations[n] && !ART_THUMBS.asked.has('m:' + n)) };
  if (want.pets.length || want.traits.length || want.mutations.length) {
    want.pets.forEach(n => ART_THUMBS.asked.add('p:' + n)); want.traits.forEach(n => ART_THUMBS.asked.add('t:' + n)); want.mutations.forEach(n => ART_THUMBS.asked.add('m:' + n));
    M.call('art:thumbs', want).then(r => {
      for (const k of ['pets', 'traits', 'mutations']) for (const [n, v] of Object.entries(r[k] || {})) ART_THUMBS[k][n] = v;
      if (S.page === 'server') soft();
    }).catch(() => {});
  }

  const petPic = p => ART_THUMBS.pets[p.name] ? h('img', { src: ART_THUMBS.pets[p.name], alt: '' }) : h('span', { class: 'sv-ph' }, xInitials(p.name));
  const traitsEl = p => (p.traits || []).length ? h('span', { class: 'x-trp' }, p.traits.slice(0, 8).map(tr => ART_THUMBS.traits[tr] ? h('img', { src: ART_THUMBS.traits[tr], title: tr, alt: tr }) : h('em', { title: tr }, String(tr).slice(0, 3)))) : null;
  const who = b => b.owner ? (b.displayName && b.displayName !== b.owner ? `${b.displayName} (@${b.owner})` : '@' + b.owner) : 'Unknown owner';
  const petRow = (p, showOwner) => h('div', { class: 'sv-pet' },
    h('div', { class: 'sv-pic' }, petPic(p)),
    h('div', { class: 'sv-pn' }, h('b', null, p.name), h('small', null, [p.rarity, showOwner ? who(p.base) : null].filter(Boolean).join(' · '))),
    xMutBlock(p.mutation), traitsEl(p),
    h('span', { class: 'sv-gen' }, formatGen(p.gen || 0)),
    h('button', { class: 'x-srch', onclick: () => searchSimilar(p) }, 'Search on Eldorado'));

  const totalPets = (scan.bases || []).reduce((n, b) => n + (b.pets || []).length, 0);
  const best = allPets[0];
  root.append(head,
    h('div', { class: 'x-tiles' },
      xTile('BASES', String((scan.bases || []).length), 'x-green', `${scan.players || '?'} players`),
      xTile('PETS', String(totalPets), 'x-purple'),
      xTile('BEST PET', best ? formatGen(best.gen || 0) : '—', 'x-yellow', best ? best.name : null),
      xTile('SCANNED', ago(scan.receivedAt), 'x-grey', 'by @' + scan.by)),
    h('div', { class: 'row sv-bar' },
      xPills([['bases', 'By base'], ['pets', 'All pets']], SV.view, v => { SV.view = v; render(); }),
      h('input', { class: 'x-search', type: 'search', placeholder: 'Search pet, owner, mutation, trait…', value: SV.q, style: { flex: '1', margin: 0 },
        oninput: e => { SV.q = e.target.value; clearTimeout(SV.qt); SV.qt = setTimeout(render, 250); } }),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: SV.hideMine, onchange: e => { SV.hideMine = e.target.checked; render(); } }), 'Hide my base')),
    SV.view === 'pets'
      ? (allPets.length ? h('div', { class: 'sv-list' }, allPets.slice(0, 300).map(p => petRow(p, true))) : h('div', { class: 'x-empty' }, 'No pets match.'))
      : h('div', { class: 'sv-bases' }, bases.filter(b => !q || (b.pets || []).some(p => match(b, p)) || match(b, {})).map(b => {
          const pets = (b.pets || []).filter(p => match(b, p) || match(b, {}));
          const open = SV.open.has(b.plot) || !!q;
          return h('div', { class: 'card sv-base' + (b.mine ? ' mine' : '') },
            h('div', { class: 'sv-bh', onclick: () => { open ? SV.open.delete(b.plot) : SV.open.add(b.plot); render(); } },
              h('b', null, who(b)), b.mine ? h('span', { class: 'pill gold' }, 'YOU') : null,
              h('span', { class: 'muted' }, `${(b.pets || []).length} pets · ${formatGen(b.totalGen || 0)} total`),
              h('div', { class: 'grow' }),
              (b.pets || [])[0] ? h('small', { class: 'muted' }, 'best: ' + b.pets[0].name + ' ' + formatGen(b.pets[0].gen || 0)) : null,
              h('span', { class: 'sv-caret' }, open ? '▾' : '▸')),
            open ? h('div', { class: 'sv-list' }, pets.length ? pets.map(p => petRow({ ...p, base: b }, false)) : h('div', { class: 'muted' }, 'No pets in this base.')) : null);
        })));
};

PAGES.delivery = async root => {
  const cfg = S.settings.delivery;
  if (!DV.data) { DV.data = { deliveries: [], jobs: [] }; M.call('delivery:list').then(r => { DV.data = r; if (S.page === 'delivery') render(); }); }
  const dels = DV.data.deliveries || [], jobs = DV.data.jobs || [];
  const queue = dels.filter(d => !['done', 'cancelled'].includes(d.state));
  const stats = {
    queue: queue.filter(d => d.state !== 'manual').length,
    trading: dels.filter(d => d.state === 'delivering').length,
    done: dels.filter(d => d.state === 'done').length,
    failed: dels.filter(d => d.state === 'manual' || (d.state === 'cancelled' && d.failReason && !/stopped by the seller|cancelled on Eldorado/.test(d.failReason))).length
  };
  const reload = async () => { DV.data = await M.call('delivery:list'); render(); };
  const online = !!S.info.agentOnline;

  // ---------- header ----------
  const head = h('div', { class: 'mx-head' },
    h('div', { class: 'mx-head-l' }, h('span', { class: 'mx-bar' }), h('div', null, h('h1', null, 'Auto Delivery'), h('p', null, 'Automatic deliveries via Roblox Trade Machine'))),
    h('div', { class: 'row mx-head-r' },
      h('span', { class: 'pill ' + (S.info.talk === 'on' ? 'good' : S.info.talk === 'error' ? 'bad' : '') }, h('span', { class: 'dot' }), 'Chat ' + S.info.talk),
      h('span', { class: 'pill ' + (online ? 'good' : ''), title: 'A delivery script is connected from a game' }, h('span', { class: 'dot' }), online ? 'Script connected' : 'Script offline'),
      h('button', { class: 'btn sm', title: 'Run a fake order through the buyer chat + real trade', onclick: () => openOrderSimulator() }, '🧪 Simulate order'),
      h('button', { class: 'btn sm', onclick: async () => { const ok = await run(() => M.call('delivery:talk')); toast(ok ? 'Chat listener connected' : 'Chat listener failed', ok ? 'good' : 'error'); M.call('app:info').then(i => { S.info = i; render(); }); } }, 'Reconnect chat'),
      h('span', { class: 'mx-led ' + (cfg.enabled ? 'on' : '') }),
      sw(cfg.enabled, v => toggleAutoexec('delivery', v))));
  const tabs = h('div', { class: 'mx-tabs' }, [['activity', 'Activity'], ['messages', 'Messages'], ['tutorial', 'Tutorial']].map(([k, l]) => h('button', { class: 'mx-tab' + (DV.tab === k ? ' on' : ''), onclick: () => { DV.tab = k; render(); } }, l)));

  // ---------- messages ----------
  const steps = { ...cfg.steps };
  let n = 0;
  const messages = h('div', null, STEP_META.map(([title, sub, color, items]) => [
    h('div', { class: 'section-band ' + (color === 'gold' ? 'gold' : '') }, h('div', null, h('b', null, title), h('small', null, sub))),
    items.map(([key, label, hint, vars]) => {
      n++;
      return h('div', { class: 'step-box' },
        h('div', { class: 'step-label' }, h('span', { class: 'step-num' }, String(n)), h('span', null, label), h('span', { class: 'muted' }, '· ' + hint), vars ? h('span', { class: 'var' }, vars) : null),
        h('textarea', { value: steps[key] || '', onchange: e => { steps[key] = e.target.value; saveSettings({ delivery: { steps: { [key]: e.target.value } } }); } }));
    })
  ]));

  // ---------- tutorial ----------
  const tut = h('div', { class: 'mx-card' },
    h('div', { class: 'mx-card-h' }, h('div', { class: 'grow' }, h('b', null, 'Auto Delivery Tutorial'), h('small', null, 'How to set up and run automatic delivery'))),
    h('p', { class: 'ink2' }, h('b', { class: 'gold' }, 'Auto Delivery'), ' trades the purchased pets to your buyers automatically, with no manual trading. Set it up once below, then keep the app running.'),
    h('div', { class: 'mx-tut-h' }, 'SETUP'),
    TUTORIAL.setup.map(([title, body], i) => h('div', { class: 'mx-step' }, h('span', { class: 'num' }, String(i + 1)), h('div', null, h('b', null, title), h('div', { class: 'ink2' }, richText(body))))),
    h('div', { class: 'mx-tut-h' }, 'HOW IT WORKS'),
    TUTORIAL.how.map(([title, body], i) => h('div', { class: 'mx-step sm' }, h('span', { class: 'num' }, String(i + 1)), h('div', null, h('b', null, title), ' — ', h('span', { class: 'ink2' }, richText(body))))));

  // ---------- activity ----------
  if (!DV.lst || Date.now() - DV.lstAt > 10000) { DV.lstAt = Date.now(); M.call('launcher:status').then(l => { DV.lst = Object.fromEntries((l || []).map(x => [x.id, x])); if (S.page === 'delivery') soft(); }).catch(() => {}); }
  if (DV.autoexec === undefined) { DV.autoexec = null; M.call('agent:autoexecStatus').then(r => { DV.autoexec = r || []; if (S.page === 'delivery') soft(); }).catch(() => { DV.autoexec = []; }); }
  // the bundled delivery agent with this install's port + token (read-only: autoexec always uses
  // the bundled file, an edited copy here did nothing)
  const scriptBox = h('textarea', { class: 'mx-code', spellcheck: 'false', readonly: true, value: '-- loading delivery script…' });
  M.call('scanner:script', 'delivery').then(s => { scriptBox.value = s; }).catch(() => { scriptBox.value = '-- could not load the delivery script'; });

  const rowActions = d => h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
    d.state === 'awaitConfirm' || d.state === 'awaitUsername' ? h('button', { class: 'btn sm', onclick: async () => { const u = await promptBox('Set username', 'Roblox username', d.username || ''); if (u) run(() => M.call('delivery:manual', d.orderId, 'setUsername', u)); } }, 'Set user') : null,
    d.state === 'awaitConfirm' ? h('button', { class: 'btn sm', onclick: () => run(() => M.call('delivery:manual', d.orderId, 'confirm')) }, 'Confirm') : null,
    h('button', { class: 'btn sm', onclick: async () => { const m = await promptBox('Message buyer', 'Message', '', true); if (m) run(() => M.call('delivery:manual', d.orderId, 'say', m), 'Sent'); } }, 'Msg'),
    !['done', 'cancelled'].includes(d.state) ? h('button', { class: 'btn sm', title: 'You delivered it yourself', onclick: async () => { if (await confirmBox('Mark this order delivered? The buyer is told "Delivered!"' + (d.sim ? '' : ', the Eldorado order is marked delivered') + ' and its pets come off your accounts.')) run(() => M.call('delivery:manual', d.orderId, 'done'), 'Marked done'); } }, 'Done') : null,
    !['done', 'cancelled'].includes(d.state) ? h('button', { class: 'btn sm danger', title: 'Stop (local only)', onclick: async () => { if (await confirmBox('Stop Zotac working on this order? Only Zotac stops: the Eldorado order is NOT cancelled and the buyer is not messaged. Its pets go back in stock.')) run(() => M.call('delivery:manual', d.orderId, 'cancel'), 'Stopped'); } }, '✕') : null,
    h('button', { class: 'btn sm ghost', onclick: () => convModal(d) }, 'Log'));
  // the order's chat log, and for an order that was not delivered what Zotac knew (debug report)
  const convModal = d => modal(d.debug ? 'Conversation · debug' : 'Conversation', h('div', null,
    d.debug ? h('div', { class: 'mx-debug' },
      h('div', { class: 'row' }, h('b', null, 'Why it was not delivered'), h('div', { class: 'grow' }),
        h('button', { class: 'btn sm', onclick: () => { navigator.clipboard.writeText([d.orderId, ...d.debug.lines].join('\n')); toast('Debug report copied', 'good'); } }, 'Copy')),
      d.debug.lines.map(l => h('div', { class: 'mono' }, l))) : null,
    h('div', { class: 'log', style: { maxHeight: '50vh' } }, d.log.map(l => h('div', { class: l.err ? 'l-error' : 'l-info' }, `${new Date(l.t).toLocaleTimeString()} ${l.in ? '◀ ' + l.in : l.out ? '▶ ' + l.out : '✕ ' + l.err}`)))), [{ label: t('close') }]);
  const thumb = d => h('div', { class: 'mx-dthumb' }, String(d.title || d.orderId || '?').trim()[0] || '?');
  // Single / Security: a popup says what the mode does and what it needs; orders already
  // delivering keep the mode they started with
  const mode = cfg.mode === 'security' ? 'security' : 'single';
  const scriptAccts = S.accounts.filter(a => a.hasCookie && !a.legit);
  const scriptOnline = scriptAccts.some(a => ((DV.lst || {})[a.id] || {}).online);
  const pickMode = k => {
    if (k === mode) return;
    const scriptAccts = S.accounts.filter(a => a.hasCookie && !a.legit);
    const body = k === 'security'
      ? h('div', null,
        h('p', null, 'Security Mode Only: one account in SCRIPT mode is the mother. For every order Zotac opens the stock accounts that hold its pets with real Roblox (Legit, no executor) in your private server, one at a time. The mother walks into their base, takes the pets with the game\'s own steal prompt, brings them home, then does ONE trade to the buyer.'),
        h('p', null, 'Only the mother ever runs Zotac\'s scripts. The trade to the buyer is the only part recorded on video.'),
        h('p', { class: scriptAccts.length ? 'muted' : 'mx-fail' }, scriptAccts.length
          ? `Mother candidates now (SCRIPT, logged in): ${scriptAccts.map(a => '@' + a.username).join(', ')}. Zotac picks the best one per order.`
          : 'No logged-in account is in SCRIPT mode yet: orders will stop for you until one is (Roblox Accounts → SCRIPT).'))
      : h('div', null,
        h('p', null, 'Single Mode + Security on multi-account: an order whose pets are all on one account in SCRIPT mode is traded straight from that account (faster, no steal).'),
        h('p', null, 'Pets on several accounts, or on an account in Legit mode: the order falls back to Security (the mother takes the pets, then one trade).'),
        h('p', { class: scriptAccts.length ? 'muted' : 'mx-fail' }, scriptAccts.length
          ? `SCRIPT accounts now: ${scriptAccts.map(a => '@' + a.username).join(', ')}.`
          : 'No logged-in account is in SCRIPT mode yet: orders will stop for you until one is (Roblox Accounts → SCRIPT).'));
    modal(k === 'security' ? 'Security Mode Only' : 'Single Mode', body, [
      { label: t('cancel') },
      { label: k === 'security' ? 'Use Security Mode Only' : 'Use Single Mode', cls: 'primary', fn: async () => { await saveSettings({ delivery: { mode: k } }); toast(`Auto Delivery: ${k === 'security' ? 'Security Mode Only' : 'Single Mode + Security on multi-account'}`, 'good'); render(); } }
    ]);
  };
  const stateCls = { done: 'good', manual: 'bad', delivering: 'gold', cancelled: '' };

  const logs = (S.logs || []).filter(l => /\[(Delivery|Proof|Agent|Launcher|Sale)\]/.test(l.msg) && l.t > DV.clearedAt).slice(-150);
  const hist = dels.filter(d => ['done', 'manual', 'cancelled'].includes(d.state)).sort((a, b) => (b.finishedAt || b.createdAt) - (a.finishedAt || a.createdAt))
    .filter(d => DV.hist === 'all' || (DV.hist === 'ok') === (d.state === 'done'));

  // Activity: count tiles; left column = how delivery works, right column = what it is doing now
  const tiles = h('div', { class: 'mx-tiles4' },
    [['IN QUEUE', stats.queue, 'cyan'], ['TRADING', stats.trading, 'gold'], ['COMPLETED', stats.done, 'good'], ['FAILED', stats.failed, 'bad']].map(([k, v, c]) => h('div', { class: 'mx-stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v ' + c }, String(v)))));
  // collapsible (closed by default, remembered); closed it shows what is switched on in one line
  const setOpen = lsGet('zotac.delivery.settingsOpen', '0') === '1';
  const toggleSet = () => { lsSet('zotac.delivery.settingsOpen', setOpen ? '0' : '1'); render(); };
  const onList = [cfg.markDelivered && 'Mark delivered', cfg.cancelOnFail !== false && 'Cancel on fail', cfg.cancelOnUnavailable !== false && 'Out-of-stock cancel',
    cfg.giveUpOnBuyer !== false && `Give up on buyer (${cfg.buyerCancelLimit || 3} cancels · ${cfg.buyerNoShowMin || 8} min offline · ${cfg.usernameWaitMin || 30} min no username)`,
    cfg.closeOnFail !== false && 'Close games on fail', cfg.recordProof && 'Record proof', `Script timeout ${cfg.agentTimeoutSec || 240} s`].filter(Boolean);
  const settingsCard = mxCard(mxIco('delivery', 'green'), 'Delivery Settings', setOpen ? 'How orders are delivered from your stock accounts' : onList.join(' · '),
    h('button', { class: 'btn sm ghost', title: setOpen ? 'Hide the settings' : 'Show the settings', onclick: e => { e.stopPropagation(); toggleSet(); } }, setOpen ? 'Hide ▴' : 'Show ▾'),
    !setOpen ? null : h('div', { class: 'mx-rows' },
        setting('Mark order delivered', 'Calls Eldorado "deliver" after all trades succeed', sw(cfg.markDelivered, v => saveSettings({ delivery: { markDelivered: v } }))),
        setting('Cancel order if delivery fails', 'After 3 failed attempts: tell the buyer why and cancel the order on Eldorado (refund). Off = manual fallback', sw(cfg.cancelOnFail !== false, v => saveSettings({ delivery: { cancelOnFail: v } }))),
        setting('Cancel when brainrots are unavailable', 'The ordered brainrot is not tracked, left the base in a rescan, or the game showed it missing twice: tell the buyer it is out of stock and cancel (refund). Never after a pet already reached the buyer. Off = manual fallback', sw(cfg.cancelOnUnavailable !== false, v => saveSettings({ delivery: { cancelOnUnavailable: v } }))),
        setting('Give up on the buyer', 'Cancel the order (refund) with a message saying why when the buyer keeps cancelling the trade, stays offline / never accepts it, or never sends a username. Off = keep retrying (3 tries), then the normal cancel', sw(cfg.giveUpOnBuyer !== false, v => saveSettings({ delivery: { giveUpOnBuyer: v } }))),
        cfg.giveUpOnBuyer !== false ? [
          setting('· Trade cancels allowed', 'The buyer cancelling or closing the trade this many times ends the order', num(cfg.buyerCancelLimit || 3, v => saveSettings({ delivery: { buyerCancelLimit: Math.max(1, Number(v) || 3) } }))),
          setting('· Offline / no accept (min)', 'Minutes the buyer may be offline, out of the server or ignore the trade request before the order ends (also after 3 failed tries)', num(cfg.buyerNoShowMin || 8, v => saveSettings({ delivery: { buyerNoShowMin: Math.max(1, Number(v) || 8) } }))),
          setting('· No username (min)', 'Minutes without the buyer\'s Roblox username or confirmation (a reminder goes out halfway); counted again from every buyer message', num(cfg.usernameWaitMin || 30, v => saveSettings({ delivery: { usernameWaitMin: Math.max(5, Number(v) || 30) } })))] : null,
        setting('Close games when a delivery fails', 'Closes every Roblox window Zotac opened for that order (the script account and the stock account) once it stops, unless another order needs it', sw(cfg.closeOnFail !== false, v => saveSettings({ delivery: { closeOnFail: v } }))),
        setting('Record video proof', 'Records the Roblox window during delivery (Video Proof page)', sw(cfg.recordProof, v => saveSettings({ delivery: { recordProof: v } }))),
        setting('Script connect timeout', 'Seconds a queued trade waits for the account\'s delivery script to connect (a running trade gets 7–10 min)', num(cfg.agentTimeoutSec, v => saveSettings({ delivery: { agentTimeoutSec: v } })))));
  { const hd = settingsCard.querySelector('.mx-card-h'); hd.classList.add('mx-fold-h'); hd.addEventListener('click', toggleSet); if (!setOpen) settingsCard.classList.add('folded'); }
  const modeCard = mxCard(mxIco('layers', 'green'), 'Delivery Mode', 'How orders are delivered in-game', null,
      h('div', { class: 'mx-modes' },
        h('button', { class: 'mx-modeopt' + (mode === 'security' ? ' on' : ''), onclick: () => pickMode('security') },
          h('b', null, 'Security Mode Only'),
          h('small', null, 'Mother steals every pet and delivers in ', h('b', null, 'one trade'), '. Works with any account setup.')),
        h('button', { class: 'mx-modeopt' + (mode === 'single' ? ' on' : ''), onclick: () => pickMode('single') },
          h('b', null, 'Single Mode ', h('span', { class: 'muted' }, '+ Security on multi-account')),
          h('small', null, h('b', null, 'Single-account'), ' orders deliver straight from the stock account (faster, no steal). ', h('b', null, 'Multi-account'), ' orders auto-fallback to Security.'))));
  // the mother candidates: accounts in SCRIPT mode (their script must be connected to trade)
  const scriptAcctCard = mxCard(mxIco('code', 'purple'), 'Script Account', 'Runs Zotac\'s scripts: the mother that steals and trades the buyer (SCRIPT mode on Roblox Accounts)',
      h('span', { class: 'mx-badge ' + (scriptOnline ? 'good' : '') }, scriptOnline ? 'CONNECTED' : 'NOT CONNECTED'),
      scriptAccts.length ? h('div', { class: 'mx-rows' }, scriptAccts.map(a => {
        const st = (DV.lst || {})[a.id] || {};
        return h('div', { class: 'mx-acct' },
          h('div', { class: 'av' }, (a.username || '?')[0].toUpperCase(), h('span', { class: 'led ' + (st.online ? 'on' : '') })),
          h('div', null, h('b', null, a.username), h('div', { class: 'muted', style: { fontSize: '11px' } }, st.online ? 'in game, script connected' : 'not in game — opened with the executor when an order needs it')));
      })) : h('div', { class: 'mx-empty' }, 'No logged-in account is in SCRIPT mode: set one to SCRIPT on Roblox Accounts (it becomes the mother).'));
  const autoexecCard = mxCard(mxIco('code'), 'Autoexec', 'The delivery script must run by itself when Roblox opens', h('span', { class: 'mx-badge ' + ((DV.autoexec || []).length ? 'good' : 'bad') }, (DV.autoexec || []).length ? 'INSTALLED' : 'NOT INSTALLED'),
      h('p', { class: 'ink2', style: { marginTop: 0 } }, 'Zotac copies zotac_delivery.lua into your executor\'s autoexec folder. Synapse Z and executors in AppData are found by themselves; for any other executor add its autoexec folder here. Without it Roblox opens but nothing trades.'),
      (DV.autoexec || []).length ? h('div', { class: 'mx-rows' }, DV.autoexec.map(f => h('div', { class: 'muted mono', style: { fontSize: '11px' } }, '✓ ' + f))) : h('div', { class: 'mx-empty' }, 'No executor autoexec folder found yet.'),
      h('div', { class: 'row', style: { marginTop: '8px' } },
        ...((cfg.autoexecDirs || []).map(dir => h('span', { class: 'mx-badge' }, dir.split(/[\\/]/).slice(-2).join('/'), h('a', { href: '#', style: { marginLeft: '6px' }, onclick: async e => { e.preventDefault(); await saveSettings({ delivery: { autoexecDirs: (cfg.autoexecDirs || []).filter(x => x !== dir) } }); DV.autoexec = await M.call('agent:syncAutoexec'); render(); } }, '✕')))),
        h('button', { class: 'btn sm', onclick: async () => {
          const dir = await run(() => M.call('dialog:folder')); if (!dir) return;
          if (!/autoexec/i.test(dir) && !await confirmBox(`"${dir}" is not called autoexec. Use it anyway?`)) return;
          await saveSettings({ delivery: { autoexecDirs: [...new Set([...(cfg.autoexecDirs || []), dir])] } });
          DV.autoexec = await run(() => M.call('agent:syncAutoexec')); render(); toast('Delivery script installed', 'good');
        } }, '+ Add autoexec folder')));
  const scriptCard = mxCard(mxIco('code'), 'Script', 'Only to run by hand: Zotac already installs it in autoexec', null,
    h('div', { class: 'mx-script' }, scriptBox, h('div', { class: 'col' }, h('button', { class: 'btn sm', onclick: () => { navigator.clipboard.writeText(scriptBox.value); toast('Script copied', 'good'); } }, 'Copy'))));
  const queueCard = mxCard(mxIco('clip', 'blue'), 'Delivery Queue', 'Pending trades awaiting execution',
      h('div', { class: 'row' }, h('span', { class: 'mx-count' }, queue.length + ' items'), h('button', { class: 'btn sm', onclick: reload }, mxSvg('refresh', 12))),
      queue.length ? h('div', { class: 'mx-dlist' }, queue.map(d => h('div', { class: 'mx-drow' }, thumb(d),
        h('div', { class: 'grow' }, h('div', { class: 'pet-name' }, d.title || d.orderId), h('small', { class: 'muted mono' }, d.orderId), h('small', { class: 'muted' }, ' · ' + (d.username || 'waiting for username…') + ' · ' + d.accounts.length + ' acct · ' + ago(d.createdAt))),
        h('span', { class: 'pill ' + (stateCls[d.state] || 'info') }, d.state), rowActions(d))))
        : mxEmpty('clip', 'No deliveries in queue'));
  const logCard = mxCard(mxIco('pulse', 'green'), 'Activity Log', 'Real-time delivery events', h('button', { class: 'btn sm', onclick: () => { DV.clearedAt = Date.now(); render(); } }, 'Clear'),
      h('div', { class: 'log mx-log', 'data-tail': true }, logs.length ? logs.map(l => h('div', { class: 'l-' + l.level }, `[${mxTime(l.t)}] ${l.msg.replace(/^\[(Delivery|Proof|Agent)\]\s*/, '')}`)) : h('span', { class: 'muted' }, 'No events yet.')));
  const histCard = mxCard(mxIco('clock', 'purple'), 'Delivery History', 'Completed and failed deliveries',
      h('div', { class: 'mx-pills sm' }, [['all', 'All'], ['ok', '✓'], ['bad', '✗']].map(([k, l]) => h('button', { class: 'mx-pill' + (DV.hist === k ? ' on' : ''), onclick: () => { DV.hist = k; render(); } }, l))),
      hist.length ? h('div', { class: 'mx-dlist scroll' }, hist.map(d => h('div', { class: 'mx-drow', onclick: () => convModal(d) }, thumb(d),
        h('div', { class: 'grow' }, h('div', null, h('b', null, d.title || d.orderId), ' ', h('small', { class: 'muted' }, (d.username || '') + '  ' + fmtDate(d.finishedAt || d.createdAt))),
          h('div', { class: d.state === 'done' ? 'mx-ok' : d.state === 'cancelled' ? 'muted' : 'mx-fail' }, d.state === 'done' ? '✓ Delivered' : d.state === 'cancelled' ? (d.failReason ? 'Cancelled — ' + d.failReason : 'Cancelled') : '✗ Needs you — ' + (d.failReason || 'manual')),
          d.debug ? h('small', { class: 'muted' }, 'Click for the debug report') : null))))
        : mxEmpty('clock', 'No history yet'));
  const activity = h('div', { class: 'mx-stack' },
    tiles,
    h('div', { class: 'mx-dcols' },
      h('div', { class: 'mx-stack' }, modeCard, settingsCard, scriptAcctCard, autoexecCard, scriptCard),
      h('div', { class: 'mx-stack' }, queueCard, logCard)),
    histCard,
    h('details', { class: 'mx-jobs' }, h('summary', null, 'Agent jobs & API'),
      table(jobs, [
        { label: 'Job', render: j => h('span', { class: 'mono' }, j.id) },
        { label: 'Kind', render: j => h('span', { class: 'pill' + (j.kind === 'steal' ? ' purple' : '') }, j.kind === 'steal' ? 'steal' : j.kind === 'scan' ? 'scan' : 'trade') },
        { label: 'Account', k: 'account' }, { label: 'To', render: j => j.kind === 'steal' ? 'from @' + (j.fromUsername || '?') : j.kind === 'scan' ? 'base of @' + (j.fromUsername || '?') : (j.buyerUsername || '—') },
        { label: 'Pets', render: j => j.pets.map(p => `${p.name}${p.mutation && p.mutation !== 'None' ? ' (' + p.mutation + ')' : ''}`).join(', ') },
        { label: 'Status', render: j => h('span', { class: 'pill ' + ({ done: 'good', failed: 'bad', running: 'gold', pending: 'info' }[j.status] || '') }, j.status) },
        { label: 'Reason', render: j => j.reason || '' }, { label: 'Created', render: j => ago(j.createdAt) }], { empty: 'No jobs.' }),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn sm', onclick: () => { navigator.clipboard.writeText(S.settings.agentToken); toast('Agent token copied', 'good'); } }, 'Copy token'),
        h('button', { class: 'btn sm', onclick: async () => { if (!await confirmBox('Make a new agent token? Scripts already running in game are rejected until those games are reopened (autoexec gets the new token by itself).')) return; await M.call('settings:regenToken', 'agentToken'); S.settings = await M.call('settings:get'); render(); } }, 'Rotate token'))));

  root.append(h('div', { class: 'mx-narrow wide' }, head, tabs, DV.tab === 'activity' ? activity : DV.tab === 'messages' ? messages : tut));
};

// ============================== AUTOEXEC SWITCHES ==========================
// Auto Delivery and Auto Scanner each put their script in every executor autoexec folder Zotac
// knows (Auto Delivery page > Autoexec card) when switched on, and remove it when switched off.
// Both ask first in a popup that names the folders; cancelling leaves everything as it was.
async function toggleAutoexec(kind, on) {
  const info = {
    delivery: { title: 'Auto Delivery', file: 'zotac_delivery.lua',
      on: 'Zotac answers every new order in the buyer chat and trades the pets from your stock accounts (opening them in your private server when needed).',
      off: 'New orders are no longer answered or delivered by Zotac. Orders already being delivered keep going.' },
    scanner: { title: 'Auto Scanner', file: 'zotac_scanner.lua',
      on: 'Every account Zotac opens scans its own base and keeps its pets synced every 30 s. Auto Scan needs this.',
      off: 'Opened accounts no longer scan their base: pet lists stop updating and Auto Scan can not run.' }
  }[kind];
  let plan = null;
  try { plan = await M.call('autoexec:plan', kind); } catch (e) { toast(e.message, 'error'); return render(); }
  const dirs = plan.dirs || [];
  const body = h('div', { class: 'grid' },
    h('p', null, on ? info.on : info.off),
    h('div', { class: 'x-panel', style: { padding: '10px 12px' } },
      h('b', null, (on ? 'Adds ' : 'Removes ') + info.file + (on ? ' to' : ' from') + ':'),
      dirs.length ? dirs.map(d => h('div', { class: 'mono muted', style: { fontSize: '11px', marginTop: '4px' } }, (plan.present.includes(d) ? '● ' : '○ ') + d))
        : h('div', { class: 'muted', style: { marginTop: '4px' } }, plan.test ? 'test copy: autoexec is never touched' : 'no executor autoexec folder found — add yours on Auto Delivery > Autoexec')),
    h('small', { class: 'muted' }, on ? 'Roblox games that are already open get it the next time they start.' : 'Roblox games that are already open keep running their copy until they close.'));
  const go = await new Promise(res => modal((on ? 'Turn on ' : 'Turn off ') + info.title + '?', body, [
    { label: t('cancel'), fn: () => res(false) },
    { label: on ? 'Turn on' : 'Turn off', cls: on ? 'primary' : 'danger', fn: () => res(true) }]));
  if (!go) return render();   // the switch goes back to how it was
  const r = await run(() => M.call('autoexec:set', kind, on));
  if (r) {
    S.settings = r.settings;
    if (kind === 'delivery') { DV.autoexec = undefined; }
    const n = on ? r.installed.length : r.removed.length;
    toast(on ? `${info.title} on — ${info.file} in ${n} autoexec folder${n === 1 ? '' : 's'}` : `${info.title} off — ${info.file} removed from ${n} folder${n === 1 ? '' : 's'}`,
      on && !n ? 'error' : 'good', 7000);
  }
  render();
}

// ============================== VIDEO PROOF ===============================
const VP = { list: null, rec: null, recOrder: null, started: 0, deliv: null, sel: null, q: '', status: 'all', play: false, dir: '' };
// Recorder per Roblox window (key = order|account): normally one clip, the trade to the buyer
// (an order split over accounts that could not be gathered gets one per buyer trade). Every frame
// goes through a canvas that stamps order, account, what is happening and the local time onto the
// video, so a clip shows on its own when and what was traded. Each clip gets a .json sidecar and is
// linked to the order's entries in the trade ledger.
const RECS = new Map();
let recQueue = Promise.resolve();   // main points getDisplayMedia at one window per call: one at a time
const STAMP = 36;
function startProof(orderId, account, label) {
  const key = (orderId || 'manual') + '|' + (account || '');
  const cur = RECS.get(key);
  if (cur) { if (label) cur.label = label; cur.stopAfter = false; return recQueue; }
  RECS.set(key, { pending: true, orderId: orderId || 'manual', account: account || null, label: label || '' });
  recQueue = recQueue.then(() => openRec(key)).catch(() => {});
  if (S.page === 'proof') render();
  return recQueue;
}
async function openRec(key) {
  const r = RECS.get(key);
  if (!r) return;
  try {
    const target = await M.call('proof:target', r.orderId, r.account).catch(() => null);
    const src = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
    const v = document.createElement('video'); v.muted = true; v.srcObject = src;
    await v.play();
    const vw = v.videoWidth || 1280, vh = v.videoHeight || 720;
    const W = Math.min(1280, vw) & ~1, H = Math.round(W * vh / vw) & ~1;
    const c = document.createElement('canvas'); c.width = W; c.height = H + STAMP;
    const g = c.getContext('2d');
    const started = Date.now();
    const draw = () => {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, STAMP);
      try { g.drawImage(v, 0, STAMP, W, H); } catch { /* frame not ready */ }
      const secs = Math.round((Date.now() - started) / 1000);
      g.fillStyle = '#a594ff'; g.font = '700 15px Segoe UI'; g.textBaseline = 'middle';
      g.fillText('ZOTAC PROOF', 10, STAMP / 2);
      g.fillStyle = '#fff'; g.font = '13px Segoe UI';
      const who = r.account ? '@' + r.account : 'screen';
      g.fillText(`${r.orderId}  ·  ${who}  ·  ${r.label || ''}`.slice(0, 140), 120, STAMP / 2);
      const clock = new Date().toLocaleString() + '  +' + Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
      g.textAlign = 'right'; g.fillText(clock, W - 10, STAMP / 2); g.textAlign = 'left';
    };
    draw();
    const tick = setInterval(draw, 1000 / 30);
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 2_000_000 });
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      clearInterval(tick); clearTimeout(r.cap);
      src.getTracks().forEach(tr => tr.stop());
      const buf = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();
      let bin = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      try {
        const kept = await M.call('proof:save', r.orderId, btoa(bin), { account: r.account, labels: r.labels, startedAt: started, endedAt: Date.now(), window: target && target.hwnd ? 'account window' : 'first Roblox window / screen' });
        if (kept) toast('Proof video saved' + (r.account ? ' (@' + r.account + ')' : ''), 'good');
        else toast('Clip not kept: the delivery did not go through', 'info');
      } catch (e) { toast('Saving proof failed: ' + e.message, 'error'); }
      RECS.delete(key); VP.list = null; VP.deliv = null;   // reload both, or a new clip shows as unlinked
      if (S.page === 'proof') render();
    };
    src.getVideoTracks()[0].onended = () => stopProofKey(key);   // the Roblox window closed
    Object.assign(r, { pending: false, rec, started, labels: [r.label].filter(Boolean) });
    r.cap = setTimeout(() => stopProofKey(key), 15 * 60 * 1000);
    rec.start(1000);
    if (r.stopAfter) stopProofKey(key, 3000);
    if (S.page === 'proof') render();
  } catch (e) {
    RECS.delete(key);
    toast('Recording failed: ' + e.message, 'error');
  }
}
function proofLabel(orderId, account, label) {
  const r = RECS.get((orderId || 'manual') + '|' + (account || ''));
  if (r && label && r.label !== label) { r.label = label; (r.labels || (r.labels = [])).push(label); }
}
function stopProofKey(key, delay = 0) {
  setTimeout(() => {
    const r = RECS.get(key);
    if (!r) return;
    if (r.pending) { r.stopAfter = true; return; }
    if (r.rec && r.rec.state !== 'inactive') r.rec.stop();
  }, delay);
}
// no order = stop everything (the Video Proof page's Stop button)
function stopProof(orderId, account, delay = 0) {
  for (const [k, r] of RECS) if ((!orderId || r.orderId === orderId) && (account === undefined || r.account === account)) stopProofKey(k, delay);
}
// Deleting a clip that is loaded in the player used to fail without a word: the <video> keeps the
// file open and Windows refuses to delete it. The player lets go of it first; a clip that still
// can't be deleted is reported (the others are deleted anyway). Returns how many were deleted.
async function deleteClips(names) {
  if (VP.player && names.some(n => decodeURI(VP.player.dataset.src || '').endsWith('/' + n))) {
    VP.player.pause(); VP.player.removeAttribute('src'); VP.player.load(); VP.player = null;
  }
  let n = 0; const errs = [];
  for (const name of names) {
    try { await M.call('proof:delete', name); n++; } catch (e) { errs.push(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  }
  if (errs.length) throw new Error(`${n} deleted, ${errs.length} failed: ${errs[0]}`);
  return n;
}
PAGES.proof = async root => {
  if (!VP.list) { VP.list = []; M.call('proof:list').then(l => { VP.list = l; if (S.page === 'proof') render(); }); }
  if (!VP.deliv) { VP.deliv = {}; M.call('delivery:list').then(r => { VP.deliv = Object.fromEntries((r.deliveries || []).map(d => [d.orderId, d])); if (S.page === 'proof') render(); }); }
  if (!VP.dir) { VP.dir = ' '; M.call('proof:dir').then(d => { VP.dir = d; if (S.page === 'proof') render(); }); }
  const files = VP.list;
  const orderOf = f => f.name.replace(/(__[\w]+)?-\d{10,}\.webm$/, '');
  const info = f => {
    const o = orderOf(f), d = VP.deliv[o];
    const buyer = d ? (d.username || d.title || o) : o;
    if (d) {
      if (d.state === 'done') return { st: 'ok', label: 'OK', cls: 'good', buyer };
      if (d.state === 'manual') return { st: 'failed', label: 'FAILED', cls: 'bad', buyer };
      if (d.state === 'cancelled') return { st: 'failed', label: 'CANCELLED', cls: 'bad', buyer };
      return { st: 'other', label: 'IN PROGRESS', cls: 'gold', buyer };
    }
    return { st: 'other', label: o === 'manual' ? 'MANUAL' : 'UNLINKED', cls: '', buyer };
  };
  const all = files.map(f => ({ f, ...info(f) }));
  const okN = all.filter(x => x.st === 'ok').length, badN = all.filter(x => x.st === 'failed').length;
  const total = files.reduce((a, f) => a + f.size, 0);
  const q = VP.q.trim().toLowerCase();
  const shown = all.filter(x => (VP.status === 'all' || x.st === VP.status) && (!q || `${x.buyer} ${x.f.name} ${x.label} ${fmtShort(x.f.date)}`.toLowerCase().includes(q)));
  const cur = all.find(x => x.f.name === VP.sel);
  const dir = VP.dir.trim();

  // one player element per clip, kept across the page's live refreshes: a new <video> every 5 s
  // stopped playback after a few seconds and threw away the scrub position
  let video = null;
  if (cur) {
    const src = 'file:///' + cur.f.path.replace(/\\/g, '/');
    if (!VP.player || VP.player.dataset.src !== src) {
      VP.player = h('video', { class: 'mx-video', controls: true, autoplay: VP.play, preload: 'auto', src });
      VP.player.dataset.src = src;
    }
    video = VP.player;
  } else VP.player = null;
  VP.play = false;
  const icon = x => h('div', { class: 'pic ' + (x.st === 'ok' ? 'good' : x.st === 'failed' ? 'bad' : '') }, mxSvg(x.st === 'ok' ? 'check' : x.st === 'failed' ? 'x' : 'play', 14));

  root.append(h('div', { class: 'mx-narrow wide' },
    mxHead('Video Proof Gallery', 'Automatic delivery recordings with buyer search', [
      h('div', { class: 'mx-mini' }, h('span', null, 'TOTAL'), h('b', null, String(files.length))),
      h('div', { class: 'mx-mini' }, h('span', null, 'SUCCESS'), h('b', { class: 'good' }, String(okN))),
      h('div', { class: 'mx-mini' }, h('span', null, 'FAILED'), h('b', { class: 'bad' }, String(badN))),
      h('div', { class: 'mx-mini' }, h('span', null, 'STORAGE'), h('b', null, fmtBytes(total)))], 'play'),
    h('div', { class: 'row mx-filters' },
      h('input', { type: 'search', class: 'grow', placeholder: 'Search by buyer, date or status…', value: VP.q, onchange: e => { VP.q = e.target.value; render(); } }),
      sel([['all', 'All statuses'], ['ok', 'OK'], ['failed', 'Failed'], ['other', 'Other']], VP.status, v => { VP.status = v; render(); }),
      RECS.size ? h('button', { class: 'btn danger', onclick: () => stopProof() }, `Stop recording (${[...RECS.values()].map(r => r.account ? '@' + r.account : r.orderId).join(', ')})`) : h('button', { class: 'btn', onclick: () => startProof('manual', null, 'manual recording') }, 'Record now'),
      badN ? h('button', { class: 'btn danger', title: 'Clips of cancelled / failed deliveries', onclick: async () => {
        const bad = all.filter(x => x.st === 'failed');
        if (!await confirmBox(`Delete ${bad.length} clip(s) of deliveries that did not go through (${fmtBytes(bad.reduce((a, x) => a + x.f.size, 0))})? Successful clips stay.`)) return;
        const n = await run(() => deleteClips(bad.map(x => x.f.name)));
        if (bad.some(x => x.f.name === VP.sel)) VP.sel = null;
        VP.list = null; render();
        if (n) toast(`Deleted ${n} clip(s)`, 'good');
      } }, `Delete failed (${badN})`) : null,
      h('button', { class: 'btn', onclick: () => M.call('open:path', dir) }, mxSvg('folder', 13), 'Folder'),
      h('button', { class: 'btn primary', onclick: () => { VP.list = null; VP.deliv = null; render(); } }, mxSvg('refresh', 13), 'Refresh')),
    h('div', { class: 'mx-folder' }, mxSvg('folder', 13), h('span', { class: 'muted' }, 'Saving to: '), h('span', { class: 'mono grow' }, dir, ' (default)'),
      h('span', { class: 'muted', title: 'Clips older than this are deleted by themselves (checked every hour). 0 = keep forever' }, 'Delete after (days)'),
      num((S.settings.delivery || {}).proofKeepDays || 0, async v => {
        const days = Math.max(0, Math.round(Number(v) || 0));
        await saveSettings({ delivery: { proofKeepDays: days } });
        if (days) {
          const old = (VP.list || []).filter(f => f.date < Date.now() - days * 86400000);
          if (old.length && VP.player && old.some(f => decodeURI(VP.player.dataset.src || '').endsWith('/' + f.name))) { VP.player.pause(); VP.player.removeAttribute('src'); VP.player.load(); VP.player = null; VP.sel = null; }
          const n = await run(() => M.call('proof:cleanup'));
          toast(n ? `Deleted ${n} clip(s) older than ${days} day(s)` : `Clips older than ${days} day(s) are deleted automatically`, 'good');
        } else toast('Clips are kept forever', 'info');
        VP.list = null; render();
      }, { style: { width: '64px' }, min: '0', title: '0 = keep forever' }),
      h('span', { class: 'muted', title: 'Off: a clip of a cancelled / failed delivery is not saved' }, 'Keep failed clips'), sw(!!(S.settings.delivery || {}).keepFailedProof, v => saveSettings({ delivery: { keepFailedProof: v } }).then(render)),
      h('span', { class: 'muted' }, 'Record buyer trades'), sw(!!(S.settings.delivery || {}).recordProof, v => saveSettings({ delivery: { recordProof: v } }).then(render))),
    h('div', { class: 'mx-vsplit' },
      h('div', { class: 'mx-vlist' },
        h('div', { class: 'mx-vlist-h' }, h('span', null, `${shown.length} videos`), h('span', { class: 'muted' }, 'Click to play')),
        shown.length ? h('div', { class: 'items' }, shown.map(x => h('div', { class: 'mx-vitem' + (x.f.name === VP.sel ? ' on' : ''), onclick: () => { VP.sel = x.f.name; VP.play = true; render(); } },
          icon(x), h('div', { class: 'grow' }, h('b', null, x.buyer), h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, h('span', { class: 'pill ' + x.cls }, x.label), h('small', { class: 'muted' }, fmtBytes(x.f.size) + ' · ' + ago(x.f.date))))))) : h('div', { class: 'empty' }, VP.list.length ? 'No videos match.' : 'No recordings yet.')),
      h('div', { class: 'mx-vplayer' },
        cur ? [
          h('div', { class: 'mx-vplayer-h' },
            h('div', { class: 'grow' }, h('b', null, `${cur.buyer} - ${fmtDate(cur.f.date)}`), h('div', { class: 'row', style: { gap: '8px', marginTop: '3px' } }, h('span', { class: 'pill ' + cur.cls }, cur.label), h('small', { class: 'muted' }, fmtBytes(cur.f.size)), h('small', { class: 'mono muted' }, cur.f.name))),
            h('button', { class: 'btn sm', onclick: () => M.call('open:path', dir) }, 'Reveal'),
            h('button', { class: 'btn sm danger', onclick: async () => {
              if (!await confirmBox('Delete ' + cur.f.name + '?')) return;
              const ok = await run(() => deleteClips([cur.f.name]));
              if (ok) { VP.sel = null; toast('Video deleted', 'good'); }
              VP.list = null; render();
            } }, 'Delete')),
          video] : mxEmpty('play', 'Select a video to play')))));
};

// ============================== SETTINGS ==================================
const UP = { info: null };
PAGES.settings = async root => {
  const s = S.settings; const g = s.game;
  const urlIn = txt(s.webhookUrl, v => saveSettings({ webhookUrl: v.trim() }), { placeholder: 'https://discord.com/api/webhooks/…', type: 'password' });
  const pingIn = txt(s.webhookPing, v => saveSettings({ webhookPing: v.trim() }), { placeholder: 'user ID, <@&role> or @everyone' });
  const audioName = lsGet('zotac.sound.name', '');
  const vol = Number(lsGet('zotac.sound.vol', '20'));
  const volLbl = h('span', { class: 'muted' }, 'Volume ' + vol + '%');
  const chk = (label, val, fn) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: val, onchange: e => fn(e.target.checked) }), label);
  const pickAudio = () => {
    const inp = h('input', { type: 'file', accept: 'audio/*', style: { display: 'none' } });
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      if (f.size > 3 * 1048576) return toast('Audio file too large (max 3 MB)', 'error');
      const r = new FileReader();
      r.onload = () => { if (lsSet('zotac.sound.data', r.result) && lsSet('zotac.sound.name', f.name)) { toast('Sale sound set: ' + f.name, 'good'); render(); } else toast('Could not store the audio file', 'error'); };
      r.readAsDataURL(f);
    };
    document.body.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
  };

  root.append(h('div', { class: 'mx-narrow wide' }, mxHead('Settings', 'Webhook, sounds, auto message, updates and game config.', [], 'settings'),
    mxSec('NOTIFICATIONS'),
    h('div', { class: 'grid g2' },
      mxCard('hook', 'Discord Webhook', 'Receive Discord notifications when a sale or dispute happens.', null,
        h('label', { class: 'f' }, 'Webhook URL', urlIn),
        h('label', { class: 'f', style: { marginTop: '8px' } }, 'Ping', pingIn),
        h('div', { class: 'row', style: { margin: '12px 0' } },
          chk('Send new-sale card', s.notifySales, v => saveSettings({ notifySales: v })),
          chk('Send dispute card', s.notifyDisputes, v => saveSettings({ notifyDisputes: v })),
          chk('Forward chat notifications', s.notifyMessages, v => saveSettings({ notifyMessages: v })),
          chk('Send auto delivery cards', s.notifyDelivery !== false, v => saveSettings({ notifyDelivery: v }))),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: async () => { await run(() => saveSettings({ webhookUrl: urlIn.value.trim(), webhookPing: pingIn.value.trim() }), 'Saved'); } }, 'Save'),
          h('button', { class: 'btn', onclick: async () => { await saveSettings({ webhookUrl: urlIn.value.trim(), webhookPing: pingIn.value.trim() }); run(() => M.call('webhook:test'), 'Test sent'); } }, 'Test')),
        h('div', { class: 'row', style: { marginTop: '8px' } },
          h('span', { class: 'muted' }, 'Preview a card:'),
          (() => { const pick = sel([['delivered', 'Delivery: delivered'], ['cancelled', 'Delivery: cancelled'], ['failed', 'Delivery: failed / needs you'], ['sale', 'New sale'], ['dispute', 'Dispute opened'], ['chat', 'Chat message'], ['autolist', 'Auto List finished'], ['plain', 'Plain test']], WH.kind, v => { WH.kind = v; }); return pick; })(),
          h('button', { class: 'btn', onclick: async () => {
            await saveSettings({ webhookUrl: urlIn.value.trim(), webhookPing: pingIn.value.trim() });
            const ok = await run(() => M.call('webhook:testCard', WH.kind));
            if (ok !== undefined) toast(ok === false ? 'Discord refused the webhook (check the URL)' : 'Sample card sent (marked TEST, no ping)', ok === false ? 'error' : 'good');
          } }, 'Send sample'))),
      (() => {
        // a second webhook that only gets the Auto Delivery cards (delivered / cancelled / failed)
        const dUrl = txt(s.deliveryWebhookUrl, v => saveSettings({ deliveryWebhookUrl: v.trim() }), { placeholder: 'https://discord.com/api/webhooks/…', type: 'password' });
        const dPing = txt(s.deliveryWebhookPing, v => saveSettings({ deliveryWebhookPing: v.trim() }), { placeholder: 'user ID, <@&role> or @everyone' });
        const save = () => saveSettings({ deliveryWebhookUrl: dUrl.value.trim(), deliveryWebhookPing: dPing.value.trim() });
        return mxCard('hook', 'Auto Delivery Webhook', 'Only the Auto Delivery cards: delivered, cancelled, failed / needs you. Nothing else.', null,
          h('label', { class: 'f' }, 'Webhook URL', dUrl),
          h('label', { class: 'f', style: { marginTop: '8px' } }, 'Ping (on cancelled / failed)', dPing),
          h('div', { class: 'row', style: { marginTop: '12px' } },
            h('button', { class: 'btn primary', onclick: () => run(save, 'Saved') }, 'Save'),
            sel([['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['failed', 'Failed / needs you']], WH.dkind, v => { WH.dkind = v; }),
            h('button', { class: 'btn', onclick: async () => {
              await save();
              const ok = await run(() => M.call('webhook:testCard', WH.dkind, 'delivery'));
              if (ok !== undefined) toast(ok === false ? 'Discord refused the webhook (check the URL)' : 'Sample card sent (marked TEST, no ping)', ok === false ? 'error' : 'good');
            } }, 'Send sample')),
          h('small', { class: 'muted', style: { display: 'block', marginTop: '8px' } }, 'Uncheck "Send auto delivery cards" on the Discord Webhook card to keep them out of the main channel.'));
      })(),
      mxCard('speaker', 'Sale Sound', 'Play a custom sound on this computer whenever a sale comes in.', null,
        chk('Enable sale sound', lsGet('zotac.sound.on', '1') === '1', v => lsSet('zotac.sound.on', v ? '1' : '0')),
        h('div', { class: 'row', style: { margin: '10px 0', flexWrap: 'nowrap' } }, h('span', { class: 'ink2' }, 'Audio file'),
          h('input', { type: 'text', class: 'grow', readonly: true, value: audioName || 'Default chime', style: { cursor: 'default' } }),
          h('button', { class: 'btn sm', onclick: pickAudio }, 'Choose…'),
          audioName ? h('button', { class: 'btn sm ghost', onclick: () => { lsSet('zotac.sound.data', ''); lsSet('zotac.sound.name', ''); render(); } }, 'Reset') : null),
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, volLbl,
          h('input', { type: 'range', min: 0, max: 100, value: vol, class: 'mx-range grow', oninput: e => { volLbl.textContent = 'Volume ' + e.target.value + '%'; lsSet('zotac.sound.vol', e.target.value); } })),
        h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: () => playSaleSound(true) }, 'Test')))),
    mxSec('AUTOMATION'),
    h('div', { class: 'grid g2' },
      mxCard('chat', 'Auto Message', 'Greets buyers on new orders', null,
        setting('Send automatic message to buyer', 'Skipped when Auto Delivery is on — it has its own greeting', sw(s.autoMessage.enabled, v => saveSettings({ autoMessage: { enabled: v } }))),
        h('label', { class: 'f' }, 'Message ({buyer} {item} {orderId})', h('textarea', { value: s.autoMessage.text, style: { minHeight: '110px' }, onchange: e => saveSettings({ autoMessage: { text: e.target.value } }) })),
        h('label', { class: 'f', style: { marginTop: '8px' } }, 'Order poll interval (s)', num(s.pollSec, v => saveSettings({ pollSec: v })))),
      mxCard('settings', 'Custom Game Config', 'Eldorado ids — defaults are Steal a Brainrot', null,
        h('div', { class: 'grid g2' },
          h('label', { class: 'f' }, 'Game ID', txt(g.gameId, v => saveSettings({ game: { gameId: v.trim() } }))),
          h('label', { class: 'f' }, 'Category', txt(g.category, v => saveSettings({ game: { category: v.trim() } }))),
          h('label', { class: 'f' }, 'SEO alias', txt(g.seoAlias, v => saveSettings({ game: { seoAlias: v.trim() } }))),
          h('label', { class: 'f' }, 'Item type value', txt(g.itemTypeValue, v => saveSettings({ game: { itemTypeValue: v.trim() } }))),
          h('label', { class: 'f' }, 'Gen bucket attribute', txt(g.msAttr, v => saveSettings({ game: { msAttr: v.trim() } }))),
          h('label', { class: 'f' }, 'Gen numeric attribute', txt(g.msNumericAttr, v => saveSettings({ game: { msNumericAttr: v.trim() } }))),
          h('label', { class: 'f' }, 'Mutation attribute', txt(g.mutationAttr, v => saveSettings({ game: { mutationAttr: v.trim() } }))),
          h('label', { class: 'f' }, 'Traits attribute', txt(g.traitsAttr, v => saveSettings({ game: { traitsAttr: v.trim() } })))),
        h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn', onclick: async () => { const l = await run(() => M.call('eld:reloadLibrary')); if (l) { S.items = l; const a = await M.call('eld:attrs'); S.attrs = a.attrs; toast(`Loaded ${l.length} items`, 'good'); } } }, 'Reload game data')))),
    mxSec('SYSTEM'),
    h('div', { class: 'grid g2' },
      mxCard('refresh', 'Updates', 'Current version v' + (S.info.version || ''), null,
        setting('Update automatically', 'Checks GitHub on start and installs new versions, then restarts', sw(s.autoUpdate.enabled, v => saveSettings({ autoUpdate: { enabled: v } }))),
        h('label', { class: 'f' }, 'GitHub repo (owner/name or link)', txt(s.autoUpdate.repo, v => { UP.info = null; saveSettings({ autoUpdate: { repo: v.trim() } }).then(render); }, { placeholder: 'NUkecodesr/Eldorado-Lister' })),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', { class: 'btn primary', onclick: async () => { UP.info = await run(() => M.call('update:check')); render(); } }, 'Check for Updates'),
          UP.info && UP.info.newer ? h('button', { class: 'btn primary', disabled: UP.busy, onclick: async () => {
            UP.busy = true; render();
            const r = await run(() => M.call('update:install', UP.info));
            UP.busy = false;
            if (r && r.restarting) toast('Updated, restarting…', 'good', 6000); else render();
          } }, UP.busy ? 'Updating…' : `Install ${UP.info.latest}`) : null,
          h('span', { class: 'muted' }, UP.info ? (UP.info.error || (UP.info.newer ? `New version ${UP.info.latest}${UP.info.notes ? ': ' + UP.info.notes.split('\n')[0].slice(0, 60) : ''}` : `Up to date (${UP.info.current}) · ${UP.info.repo}`)) : ''))),
      mxCard('plug', 'Zotac Extension & local port', 'Chrome cookie sync and the delivery agent', null,
        h('div', { class: 'kv' }, h('div', null, 'Port'), h('div', { class: 'mono' }, String(s.localPort)), h('div', null, 'Extension token'), h('div', { class: 'mono' }, s.extensionToken), h('div', null, 'Agent token'), h('div', { class: 'mono' }, s.agentToken)),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', { class: 'btn', onclick: () => M.call('open:path', S.info.extensionPath) }, 'Open extension folder'),
          h('button', { class: 'btn', onclick: async () => { await M.call('settings:regenToken', 'extensionToken'); S.settings = await M.call('settings:get'); render(); } }, 'New extension token')),
        h('small', { class: 'muted' }, 'Chrome › Extensions › Developer mode › Load unpacked › pick the folder.')),
      mxCard('folder', 'Data', 'Backup, restore or reset local data', null,
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => run(() => M.call('data:export'), 'Backup saved') }, 'Backup all data'),
          h('button', { class: 'btn', onclick: async () => { if (!await confirmBox('Restore a backup? Everything in it replaces what Zotac has now, settings and tokens included.')) return; if (await run(() => M.call('data:import'))) { S.settings = await M.call('settings:get'); await refreshData(); toast('Restored', 'good'); render(); } } }, 'Restore backup'),
          h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Delete ALL pets, accounts (with their saved Roblox cookies), sales, deliveries, the trade log, templates, expenses and logs? Only settings are kept.')) { await M.call('data:reset'); await refreshData(); render(); } } }, 'Reset data')),
        h('small', { class: 'muted', style: { display: 'block', marginTop: '8px' } }, 'Data folder: ' + (S.info.userData || ''))), settingsLogs())));
};

// every log line Zotac keeps (Launcher, Sale, Scanner, Watcher, Updates... not only delivery)
const SL = { area: 'all', level: 'all' };
function settingsLogs() {
  const areas = [...new Set((S.logs || []).map(l => (l.msg.match(/^\[([^\]]+)\]/) || [])[1]).filter(Boolean))].sort();
  const rows = (S.logs || []).filter(l => (SL.level === 'all' || l.level === SL.level) && (SL.area === 'all' || l.msg.startsWith('[' + SL.area + ']'))).slice(-300).reverse();
  return mxCard('pulse', 'Logs', 'Everything Zotac logged lately, newest first', h('button', { class: 'btn sm', onclick: async () => { S.logs = await M.call('logs:get'); render(); } }, 'Refresh'),
    h('div', { class: 'row', style: { marginBottom: '8px' } },
      sel([['all', 'All areas'], ...areas.map(a => [a, a])], SL.area, v => { SL.area = v; render(); }),
      sel([['all', 'All levels'], ['info', 'Info'], ['warn', 'Warnings'], ['error', 'Errors']], SL.level, v => { SL.level = v; render(); })),
    h('div', { class: 'log', 'data-head': true, style: { maxHeight: '360px' } }, rows.length ? rows.map(l => h('div', { class: 'l-' + l.level }, new Date(l.t).toLocaleString() + '  ' + l.msg)) : h('span', { class: 'muted' }, 'No log lines.')));
}
