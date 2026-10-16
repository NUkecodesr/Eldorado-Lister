// App shell: global state, navigation, event wiring and the image-render handler.
const S = {
  page: 'autolist', settings: null, info: {}, me: null, bridge: 'disconnected', unread: 0,
  pets: [], accounts: [], templates: [], expenses: [], sales: [], logs: [], talkLog: [],
  items: [], attrs: [], listerRunning: false, listerProgress: null
};

const NAV = [
  ['sec.listing', ['autolist', 'listings', 'templates', 'accounts', 'sales']],
  ['sec.market', ['searcher', 'server', 'orders', 'chat']],
  ['sec.account', ['account', 'wallet', 'analytics', 'reviews', 'notifications']],
  ['sec.system', ['delivery', 'proof', 'settings']]
];

async function refreshData() {
  const [pets, accounts, templates, expenses, sales, logs, info, settings] = await Promise.all([
    M.call('pets:list'), M.call('accounts:list'), M.call('templates:list'), M.call('expenses:list'), M.call('sales:list'),
    M.call('logs:get'), M.call('app:info'), M.call('settings:get')
  ]);
  Object.assign(S, { pets, accounts, templates, expenses, sales, logs, info, settings, listerRunning: info.listerRunning, bridge: info.bridge || S.bridge });
  if (info.lister && !S.listerProgress) S.listerProgress = info.lister;
}

async function refreshMe() {
  try { S.me = await M.call('auth:me'); } catch { S.me = null; }
  if (S.me) {
    try { const [items, lib] = await Promise.all([M.call('eld:items'), M.call('eld:attrs')]); S.items = items; S.attrs = lib.attrs || []; } catch { /* library loads lazily */ }
  }
  renderFooter();
}

function renderNav() {
  const nav = $('#nav'); nav.textContent = '';
  for (const [sec, pages] of NAV) {
    nav.appendChild(h('div', { class: 'nav-sec' }, t(sec)));
    for (const p of pages) {
      nav.appendChild(h('div', { class: 'nav-item' + (S.page === p ? ' active' : ''), 'data-page': p, onclick: () => go(p) },
        icon(p), h('span', null, t(p)),
        p === 'notifications' && S.unread ? h('span', { class: 'badge' }, String(S.unread)) : null));
    }
  }
}

function renderFooter() {
  const f = $('#side-footer'); if (!f) return;
  f.textContent = '';
  const on = S.bridge === 'connected';
  const me = S.me || {};
  const name = me.username || me.userName || '';
  const pic = me.profilePicture || me.avatar || me.avatarUrl;
  const rate = S.info.successRate !== undefined ? Number(S.info.successRate) : (on ? 100 : 0);
  f.append(
    h('div', { class: 'sf-user', onclick: () => go('account') },
      pic ? h('img', { src: /^https?:/.test(pic) ? pic : `https://assetsdelivery.eldorado.gg/v7/_profiles-v2_/${pic}` }) : h('div', { class: 'sf-ava' }, (name[0] || '?').toUpperCase()),
      h('div', { class: 'sf-who' }, h('b', null, name || t('notLogged')), me.email ? h('small', { class: 'x-private', title: 'hover to show' }, me.email) : null)),
    h('div', { class: 'sf-status ' + (on && S.me ? 'on' : 'off') },
      h('div', null, h('span', { class: 'dot' }), on && S.me ? t('online') : t('offline')),
      S.me ? h('small', null, t('shopVisible')) : null),
    h('div', { class: 'sf-conn' }, h('span', null, h('span', { class: 'dot ' + (on ? 'good' : 'bad') }), on ? t('connected') : t('disconnected')), h('b', null, rate.toFixed(1) + '%')),
    h('small', { class: 'sf-ver' }, 'v' + (S.info.version || '')));
}

let rendering = false, again = false;
async function render() {
  if (rendering) { again = true; return; }
  rendering = true;
  try {
    const main = $('#main'); const top = main.scrollTop;
    const root = h('div', { id: 'page' });
    // Pages pass `cond ? el : null` to append; native append would print "null".
    root.append = (...kids) => Element.prototype.append.apply(root, kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false));
    const fn = PAGES[S.page] || PAGES.autolist;
    try { await fn(root); } catch (e) { console.error(e); root.append(h('div', { class: 'card empty' }, 'Page error: ' + e.message)); }
    const old = $('#page'); old ? old.replaceWith(root) : main.appendChild(root);
    main.scrollTop = top;
  } finally { rendering = false; if (again) { again = false; render(); } }
}

function go(page) {
  if (!PAGES[page]) return;
  S.page = page;
  try { localStorage.setItem('zotac.page', page); } catch { /* ignore */ }
  renderNav(); render();
}

// Debounced re-render for high-frequency events; skips pages that are mid-typing.
let rt = null;
const soft = () => { clearTimeout(rt); rt = setTimeout(() => { const a = document.activeElement; if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return; render(); }, 250); };

// ---- live updates --------------------------------------------------------------------
// Every page keeps itself current without the Refresh button: data is fetched in the
// background and swapped in silently (no loading state, so nothing flickers), then the page
// is re-rendered unless you are typing. Local data refreshes every 5s; Eldorado data every 30s
// for the page you are on (paused while the window is minimised), and right away when a new
// order / sale / notification arrives.
const LIVE = {
  local: {
    autolist: () => refreshData(), accounts: () => refreshData(), sales: () => refreshData(), templates: () => refreshData(),
    delivery: async () => { DV.data = await M.call('delivery:list'); },
    proof: async () => { if (!VP.rec) VP.list = await M.call('proof:list'); },
    server: async () => { SV.scans = await M.call('server:scans'); }
  },
  remote: {
    listings: async () => {
      if (!LS.data || LS.loading) return;
      const states = ['Active', 'Paused', 'Expired'];
      const seq = LS.seq;
      const res = await Promise.all(states.map(st => M.call('eld:myOffers', st).catch(() => null)));
      if (seq !== LS.seq || LS.loading) return;   // a manual Refresh is running
      const d = {}; states.forEach((st, i) => d[st] = res[i] || LS.data[st] || []);
      LS.data = d; LS.at = Date.now();
      if (res.every(r => r)) LS.err = null;
    },
    orders: async () => { if (OR.data && !OR.loading) OR.data = await M.call('eld:orders', { page: OR.page, pageSize: 50 }); },
    wallet: async () => {
      if (!WL.data || WL.loading) return;
      const [w, o] = await Promise.all([M.call('eld:wallet'), M.call('eld:orders', { page: 1, pageSize: 50 })]);
      WL.data = w || WL.data; WL.orders = o ? o.rows : WL.orders;
    },
    account: async () => { if (AC.dash && !AC.loading) AC.dash = (await M.call('eld:dashboard')) || AC.dash; },
    notifications: async () => { if (NT.list && !NT.loading) NT.list = (await M.call('eld:notifications', NT.unreadOnly)) || NT.list; },
    reviews: async () => {
      if (!RV.data || RV.loading || RV.page !== 1) return;
      const d = await M.call('eld:reviews', 1);
      if (d) { RV.data = d; RV.rows = d.rows || []; }
    },
    chat: async () => { const r = await M.call('eld:orders', { page: 1, pageSize: 40 }); if (r) CH.orders = r.rows; }
  }
};
let liveBusy = false;
async function liveTick(kind, force) {
  const fn = (LIVE[kind] || {})[S.page];
  if (!fn || liveBusy) return;
  if (kind === 'remote' && (!S.me || (document.hidden && !force))) return;
  liveBusy = true;
  try { await fn(); soft(); } catch { /* next tick */ } finally { liveBusy = false; }
}
setInterval(() => liveTick('local'), 5000);
setInterval(() => liveTick('remote'), 30000);
// pages that show Eldorado data update at once when Eldorado tells us something changed
const liveNow = () => { liveTick('remote', true); refreshData().then(soft).catch(() => {}); };

function wire() {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { liveTick('local', true); liveTick('remote', true); } });
  document.querySelectorAll('[data-win]').forEach(b => b.addEventListener('click', () => M.call('win', b.dataset.win)));
  const reload = async () => { await refreshData(); soft(); };
  M.on('pets:changed', reload);
  M.on('bridge:state', s => { S.bridge = s; renderFooter(); soft(); });
  M.on('auth:changed', async () => { await refreshMe(); soft(); });
  M.on('log', e => { S.logs.push(e); if (S.logs.length > 1500) S.logs.shift(); const el = $('#al-log'); if (el && /\[AutoList\]/.test(e.msg)) { el.appendChild(h('div', { class: 'l-' + e.level }, `${new Date(e.t).toLocaleTimeString()}  ${e.msg}`)); el.scrollTop = el.scrollHeight; } });
  M.on('autolist:progress', p => { S.listerProgress = p; S.listerRunning = !!p && p.done < p.total; if (!S.listerRunning) refreshData().then(soft); else if (S.page === 'autolist') soft(); });
  M.on('repricer:done', () => { if (S.page === 'listings') soft(); });
  M.on('server:scan', () => { if (S.page === 'server') liveTick('local', true); });
  M.on('sale', o => { toast('Sale: ' + (o && (o.title || o.id) || 'new order'), 'good', 8000); liveNow(); });
  M.on('dispute', o => toast('Dispute opened on order ' + (o && o.id || ''), 'error', 10000));
  M.on('notification', () => { S.unread++; renderNav(); liveNow(); });
  M.on('unread', n => { S.unread = Number(n && n.count !== undefined ? n.count : n) || 0; renderNav(); });
  M.on('orders', () => liveNow());
  M.on('delivery:update', () => { if (S.page === 'delivery') soft(); });
  M.on('delivery:job', () => { if (S.page === 'delivery') soft(); });
  M.on('talk:message', m => { S.talkLog.push(m); if (S.talkLog.length > 100) S.talkLog.shift(); if (S.page === 'chat') soft(); });
  M.on('proof', () => { if (S.page === 'proof') soft(); });
  // Video proof: record the Roblox window while the in-game trade runs. Starts when the agent
  // picks the job up (the stock account's game is open by then, so its window is captured),
  // stops a few seconds after the job ends so the result is on the video.
  M.on('delivery:job', j => {
    if (!j || !S.settings.delivery || !S.settings.delivery.recordProof) return;
    if (j.status === 'running' && !VP.rec) startProof(j.orderId);
    else if (['done', 'failed', 'cancelled'].includes(j.status) && VP.rec && VP.recOrder === j.orderId) setTimeout(() => { if (VP.recOrder === j.orderId) stopProof(); }, 3000);
  });
  M.on('update:available', u => { UP.info = u; toast(`Update ${u.latest} available (Settings)`, 'info', 9000); if (S.page === 'settings') soft(); });
  M.onCall({ renderImage: p => renderListingImage(p), renderModel: p => renderModel3D(p) });
  setInterval(async () => { try { S.info = await M.call('app:info'); S.bridge = S.info.bridge || S.bridge; S.listerRunning = S.info.listerRunning; renderFooter(); } catch { /* ignore */ } }, 15000);
}

// Used by `electron . --smoke`: render every page and report failures.
window.__smoke = async () => {
  const bad = [];
  for (const name of Object.keys(PAGES)) {
    try { const root = h('div'); await PAGES[name](root); if (!root.childNodes.length) bad.push(name + ': empty'); } catch (e) { bad.push(name + ': ' + e.message); }
  }
  return bad.length ? Promise.reject(new Error(bad.join('; '))) : Object.keys(PAGES).length + ' pages ok';
};

(async () => {
  wire();
  try { await refreshData(); } catch (e) { console.error(e); S.settings = S.settings || {}; }
  await refreshMe();
  let p = 'autolist'; try { p = localStorage.getItem('zotac.page') || p; } catch { /* ignore */ }
  S.page = PAGES[p] ? p : 'autolist';
  renderNav(); renderFooter(); render();
})();
