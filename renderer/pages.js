// LISTING + MARKET pages.
const PAGES = {};
const DELIVERY_TIMES = ['Instant', 'Minute20', 'Hour1', 'Hour2', 'Hour3', 'Hour5', 'Hour8', 'Hour12', 'Day1', 'Day2', 'Day3'];
const GEN_BUCKETS = [['', 'Any'], ['0-99999-ks', '1-999.99 K/s'], ['1-2499-ms', '1-24.99 M/s'], ['25-4999-ms', '25-49.99 M/s'], ['50-9999-ms', '50-99.99 M/s'], ['100-24999-ms', '100-249.99 M/s'], ['250-49999-ms', '250-499.99 M/s'], ['500-74999-ms', '500-749.99 M/s'], ['750-99999-ms', '750-999.99 M/s'], ['1-499-bs', '1-4.99 B/s'], ['5-999-bs', '5-9.99 B/s'], ['10-1999-bs', '10-19.99 B/s'], ['20-plus-bs', '20+ B/s']];
const offerUrl = o => `https://www.eldorado.gg/${o.gameSeoAlias || S.settings.game.seoAlias}/oi/${o.id}`;
const offerImg = o => {
  const m = o.mainOfferImage || {};
  const f = m.largeImage || m.originalSizeImage || m.smallImage;
  return f ? `https://assetsdelivery.eldorado.gg/v7/_offers-v2_/${f}?w=480&q=90` : null;
};
const acctName = id => (S.accounts.find(a => a.id === id) || {}).username || '—';
const mutPill = m => !m || /^none$/i.test(m) ? h('span', { class: 'muted' }, 'None') : h('span', { class: 'pill gold' }, m);
const statusPill = s => h('span', { class: 'pill ' + ({ available: 'info', listed: 'gold', sold: 'good' }[s] || '') }, s || '—');

function sel(options, value, onchange, attrs = {}) {
  return h('select', { ...attrs, onchange: e => onchange(e.target.value) }, options.map(o => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: v, selected: String(v) === String(value) ? true : null }, l);
  }));
}
function num(value, onchange, attrs = {}) { return h('input', { type: 'number', value, step: 'any', style: { width: '100px' }, ...attrs, onchange: e => onchange(e.target.value === '' ? '' : Number(e.target.value)) }); }
function txt(value, onchange, attrs = {}) { return h('input', { type: 'text', value: value ?? '', ...attrs, onchange: e => onchange(e.target.value) }); }
async function saveSettings(patch) { S.settings = await M.call('settings:set', patch); }

// ---- shared look helpers (x* prefix; used by the restyled pages) ----------
const xLs = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
};
function xCopy(text, msg = 'Copied') {
  const done = () => toast(msg, 'good', 1800);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(String(text)).then(done, () => toast('Copy failed', 'error'));
  else { const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch { toast('Copy failed', 'error'); } ta.remove(); }
}
function xHead(letter, title, sub, ...right) {
  return h('div', { class: 'x-head' },
    h('div', { class: 'x-badge' }, letter),
    h('div', { class: 'x-head-t' }, h('h1', null, title), sub ? h('p', null, sub) : null),
    h('div', { class: 'grow' }), h('div', { class: 'row x-head-r' }, right));
}
function xTile(label, value, cls = '', sub = null, iconEl = null) {
  return h('div', { class: 'x-tile ' + cls }, iconEl ? h('div', { class: 'x-tile-ic' }, iconEl) : null,
    h('div', { class: 'x-tile-b' }, h('div', { class: 'x-tile-k' }, label), h('div', { class: 'x-tile-v' }, value), sub ? h('div', { class: 'x-tile-s' }, sub) : null));
}
function xPills(options, value, onchange) {
  return h('div', { class: 'x-pills' }, options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('button', { class: 'x-pill' + (v === value ? ' on' : ''), onclick: () => onchange(v) }, l); }));
}
const xMutColor = m => { const k = String(m || 'none').toLowerCase().replace(/\s+/g, '-'); const p = MUTATION_COLORS[k]; return k === 'none' ? null : (k === 'rainbow' ? '#ff6ad5' : p ? p[0] : '#f2b631'); };
const xRarity = name => { const i = (S.items || []).find(x => x.name && String(x.name).toLowerCase() === String(name || '').toLowerCase()); return i && i.rarity || ''; };
const xInitials = n => String(n || '?').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase();
function xAvatar(pet, size = 34) {
  const c = xMutColor(pet.mutation) || RARITY_COLORS[pet.rarity || xRarity(pet.name)] || '#8d806b';
  return h('div', { class: 'x-ava', style: { width: size + 'px', height: size + 'px', background: `linear-gradient(135deg, ${c}55, #15110c)`, borderColor: c + '88', fontSize: Math.round(size * .36) + 'px' } }, xInitials(pet.name));
}
// order picture (the listing image) with the initials tile as fallback
function xOrderAva(o, size = 34) {
  const f = o && o.image;
  if (!f) return xAvatar({ name: String(o && o.title || '?').split('|')[0] }, size);
  const src = /^https?:/.test(f) ? f : `https://assetsdelivery.eldorado.gg/v7/_offers-v2_/${f}?w=${size * 3}&q=85`;
  return h('div', { class: 'x-ava x-ava-img', style: { width: size + 'px', height: size + 'px' } },
    h('img', { src, alt: '', loading: 'lazy', onerror: e => e.target.replaceWith(document.createTextNode(xInitials(String(o.title || '?').split('|')[0]))) }));
}
// the generated listing card of a pet, as a small clickable picture in its row
const CARD_THUMBS = {};
function xCardThumb(p, onclick) {
  const key = p.id + ':' + (p.imageAt || 0);
  const src = CARD_THUMBS[key];
  if (src === undefined) {
    CARD_THUMBS[key] = null;
    M.call('art:cardThumb', p.id).then(u => { CARD_THUMBS[key] = u || false; if (u && S.page === 'autolist') soft(); }).catch(() => { CARD_THUMBS[key] = false; });
  }
  return src ? h('img', { class: 'x-althumb', src, alt: '', title: 'Generated card (click to preview)', onclick })
    : h('span', { class: 'x-althumb ph', title: 'Card image generated' }, '▣');
}
// the brainrot's own picture (wiki / game art) until a card is generated; fetched in batches
const PET_THUMB_WANT = new Set();
let petThumbTimer = null;
function xPetThumb(p, onclick) {
  const src = ART_THUMBS.pets[p.name];
  if (src) return h('img', { class: 'x-althumb pet', src, alt: '', title: p.name + ' (no card yet: Generate Images)', onclick });
  if (src === undefined && !ART_THUMBS.asked.has('p:' + p.name)) {
    ART_THUMBS.asked.add('p:' + p.name); PET_THUMB_WANT.add(p.name);
    clearTimeout(petThumbTimer);
    petThumbTimer = setTimeout(() => {
      const pets = [...PET_THUMB_WANT]; PET_THUMB_WANT.clear();
      M.call('art:thumbs', { pets }).then(r => {
        for (const [n, v] of Object.entries(r.pets || {})) ART_THUMBS.pets[n] = v || null;
        if (S.page === 'autolist') soft();
      }).catch(() => {});
    }, 50);
  }
  return h('span', { class: 'x-althumb ph', title: 'No card yet: Generate Images' }, '·');
}
// ---- Auto Scan window: pick logged-in accounts, batch size, Start; live progress + log ----
const AS = { st: null, sel: null, draw: null };
async function openAutoScan() {
  if (!AS.st) AS.st = await M.call('autoscan:state');
  const accts = S.accounts.filter(a => a.hasCookie);
  if (!AS.sel) AS.sel = new Set((AS.st.ids || accts.map(a => a.id)).filter(id => accts.some(a => a.id === id)));
  const bg = h('div', { class: 'modal-bg', onmousedown: e => { if (e.target === bg) close(); } });
  const close = () => { AS.draw = null; bg.remove(); };
  let batch = AS.st.batch || 3;
  const body = h('div', { class: 'modal as-modal' });
  bg.append(body);
  $('#modal-root').append(bg);
  const draw = () => {
    // never rebuild while you are typing in the batch box (it would lose what you typed)
    if (document.activeElement && body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') { clearTimeout(AS.later); AS.later = setTimeout(draw, 600); return; }
    const st = AS.st || {};
    const pct = st.total ? Math.round((st.done + st.failed) / st.total * 100) : 0;
    body.textContent = '';
    body.append(
      h('div', { class: 'as-head' }, h('div', { class: 'as-ico' }, '⌕'), h('div', { class: 'grow' }, h('b', null, 'Auto Scan'), h('small', null, 'Scans every logged-in account in batches and imports automatically')),
        h('button', { class: 'as-x', onclick: close }, '✕')),
      h('div', { class: 'as-row' }, h('span', null, 'Accounts per batch'),
        h('input', { type: 'number', min: '1', max: '10', value: batch, disabled: st.running, oninput: e => { batch = Math.max(1, Math.min(10, Number(e.target.value) || 1)); } }),
        h('div', { class: 'grow' }),
        st.running ? h('button', { class: 'btn danger', onclick: () => M.call('autoscan:stop') }, '■ Stop')
          : h('button', { class: 'btn primary', onclick: async () => { AS.st = await run(() => M.call('autoscan:start', { ids: [...AS.sel], batch })) || AS.st; draw(); } }, '▶ Start')),
      h('div', { class: 'as-sel' }, h('span', null, 'ACCOUNTS TO SCAN ', h('b', null, `${AS.sel.size}/${accts.length}`)), h('div', { class: 'grow' }),
        h('a', { href: '#', onclick: e => { e.preventDefault(); accts.forEach(a => AS.sel.add(a.id)); draw(); } }, 'All'), ' · ',
        h('a', { href: '#', onclick: e => { e.preventDefault(); AS.sel.clear(); draw(); } }, 'None')),
      accts.length ? h('div', { class: 'as-chips' }, accts.map(a => h('button', { class: 'as-chip' + (AS.sel.has(a.id) ? ' on' : '') + ((st.current || []).includes(a.username) ? ' busy' : ''), disabled: st.running, onclick: () => { AS.sel.has(a.id) ? AS.sel.delete(a.id) : AS.sel.add(a.id); draw(); } },
        h('span', { class: 'dot' }), '@' + a.username)))
        : h('div', { class: 'muted' }, 'No logged-in accounts: add a cookie or use browser login on Roblox Accounts.'),
      h('div', { class: 'as-sel' }, h('span', null, st.running ? `Scanning… ${st.done + st.failed}/${st.total}` + ((st.current || []).length ? ' · ' + st.current.map(u => '@' + u).join(', ') : '') : (st.total ? `Done: ${st.done} scanned, ${st.failed} failed` : 'Idle')), h('div', { class: 'grow' }),
        h('a', { href: '#', onclick: async e => { e.preventDefault(); await M.call('autoscan:clear'); } }, 'Clear log')),
      h('div', { class: 'as-bar' }, h('i', { style: { width: pct + '%' } })),
      h('div', { class: 'as-card' }, h('div', { class: 'as-sel' }, h('span', null, '‹› EXECUTOR SCRIPT (AUTOEXEC)'), h('div', { class: 'grow' }),
          h('button', { class: 'btn sm', onclick: async () => xCopy(await M.call('scanner:autoexecScript'), 'Scanner script copied') }, '⎘ Copy script')),
        h('small', { class: 'muted' }, 'Zotac puts this scanner (and the delivery script) into your executor\'s autoexec by itself (Synapse Z, AppData executors, and the folders added on Auto Delivery). Each opened account scans its base, Zotac imports it and closes that Roblox.')),
      h('div', { class: 'as-log' }, (st.log || []).length ? st.log.slice().reverse().map(l => h('div', { class: 'l-' + l.level }, `${new Date(l.t).toLocaleTimeString()}  ${l.msg}`))
        : h('div', { class: 'muted' }, 'No runs yet — set the batch size and press Start.')));
  };
  AS.draw = draw;
  draw();
}
function xDot(m) { const c = xMutColor(m); return h('span', { class: 'x-mut' }, h('i', { style: { background: c || '#4b4233' } }), m && !/^none$/i.test(m) ? m : h('span', { class: 'muted' }, 'None')); }
function xJsonCount(text) {
  try {
    const j = JSON.parse(text); if (Array.isArray(j)) return j.length;
    if (j && typeof j === 'object') { const src = j.accounts || j.pets || j.items || j; if (Array.isArray(src)) return src.reduce((a, x) => a + (x && Array.isArray(x.pets) ? x.pets.length : 1), 0); return Object.values(src).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0); }
  } catch { /* not json yet */ }
  return 0;
}

// ============================== AUTO LIST =================================
const DT_LABEL = { Instant: 'Instant', Minute20: '20 min', Hour1: '1 h', Hour2: '2 h', Hour3: '3 h', Hour5: '5 h', Hour8: '8 h', Hour12: '12 h', Day1: '1 day', Day2: '2 days', Day3: '3 days' };
const dtLabel = v => DT_LABEL[v] || v;
const AL_VARS = ['name', 'rarity', 'mutation', 'gen', 'traits', 'emoji'];
const AL_EMOJIS = ['🔥', '⚡', '💎', '👑', '⭐', '✨', '🌈', '💰', '🚀', '✅', '🎁', '🧠', '💥', '🍀', '❄️', '🌙', '☀️', '💜', '💛', '❤️', '🖤', '🤍', '🏆', '📦', '⏱️', '🔒', '🛒', '🎯', '🦄', '🐱'];
const AL = { selected: new Set(), filter: { account: '', status: 'available', q: '' }, log: [], json: '', open: false, sort: 'gen', dir: -1, fold: xLs.get('zotac.alFold', {}), lastKey: 'title', dtOpen: false, limit: 200 };

// renderer copy of sab.fillTemplate (main) so rows show the live title
function xFill(tpl, p) {
  const al = S.settings.autolist || {};
  const mut = p.mutation && !/^(none|normal)$/i.test(p.mutation) ? p.mutation : '';
  const acct = acctName(p.accountId);
  const vars = { name: p.name || '', mutation: mut, mutationTag: mut ? `[${mut}] ` : '', gen: formatGen(p.gen), genRaw: String(p.gen || 0), traits: (p.traits || []).join(', '), rarity: p.rarity || xRarity(p.name), emoji: al.emoji ?? '🔥', account: acct === '—' ? '' : acct, price: p.price != null ? Number(p.price).toFixed(2) : '' };
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m))
    .replace(/ {2,}/g, ' ').replace(/^ +| +$/gm, '')
    .replace(/([ \t]*\|)+[ \t]*$/gm, '').replace(/^[ \t]*\|[ \t]*/gm, '').trim();
}
// pets Zotac can deliver: their account is logged in (saved cookie)
const xDeliverable = p => { const a = S.accounts.find(x => x.id === p.accountId); return !!(a && a.hasCookie); };
const xSpecial = () => new Set(((S.settings.autolist || {}).specialTraits || []).map(x => String(x).toLowerCase()));
const xIsReview = (p, set) => (p.traits || []).some(t => set.has(String(t).toLowerCase()));
function xMutBlock(m) {
  const k = String(m || 'none').toLowerCase().replace(/\s+/g, '-');
  const none = k === 'none' || k === 'normal';
  const pic = !none && ART_THUMBS.mutations[m];
  const pal = MUTATION_COLORS[k];
  const bg = k === 'rainbow' ? 'linear-gradient(135deg, #ff4d4d, #ffe44d, #3fcf72, #4fa3f7, #a66bff)'
    : none ? 'linear-gradient(135deg, #f1f1f4, #8b8b93)' : pal ? `linear-gradient(135deg, ${pal[0]}, ${pal[1]})` : 'linear-gradient(135deg, #f2b631, #6b4a06)';
  return h('span', { class: 'x-mblk', title: none ? 'No mutation' : m }, pic ? h('img', { src: pic, alt: m }) : h('i', { style: { background: bg } }));
}
// close the delivery-time dropdown / emoji picker when clicking elsewhere
document.addEventListener('mousedown', e => {
  if (AL.dtOpen && !e.target.closest('.x-msel-wrap')) { AL.dtOpen = false; if (S.page === 'autolist') render(); }
  if (!e.target.closest('.x-emo-wrap')) document.querySelectorAll('.x-emo.on').forEach(x => x.classList.remove('on'));
});

PAGES.autolist = async root => {
  const s = S.settings; const al = s.autolist; const rules = s.rules;
  const q = AL.filter.q.toLowerCase();
  const pets = S.pets.filter(p =>
    (!AL.filter.account || p.accountId === AL.filter.account) &&
    (AL.filter.status === 'all' || p.status === AL.filter.status) &&
    (!q || `${p.name} ${p.mutation} ${(p.traits || []).join(' ')} ${p.title || ''}`.toLowerCase().includes(q)))
    .sort((a, b) => AL.sort === 'name' ? AL.dir * String(a.name).localeCompare(String(b.name)) || (b.gen - a.gen) : AL.dir * ((a.gen || 0) - (b.gen || 0)));
  for (const id of [...AL.selected]) if (!S.pets.some(p => p.id === id)) AL.selected.delete(id);
  const prog = S.listerProgress || {};
  const special = xSpecial();
  const review = pets.filter(p => xIsReview(p, special));
  const ready = pets.filter(p => !xIsReview(p, special));
  // trait + mutation icons load in the background (pet pictures are not needed here)
  loadThumbs(pets, { pictures: false }).then(got => { if (got && S.page === 'autolist') soft(); });

  const importJson = async (text) => {
    if (!text) return;
    let json; try { json = JSON.parse(text); } catch (e) { return toast('Invalid JSON: ' + e.message, 'error'); }
    const target = await new Promise(res => {
      const s2 = sel([['', 'Use account names from the JSON'], ...S.accounts.map(a => [a.id, a.username])], '', v => { s2._v = v; });
      modal('Import pets', h('div', null, h('label', { class: 'f' }, 'Assign to account', s2), h('p', { class: 'muted' }, 'Accepts scanner exports (arrays of pets, {accounts:{name:[pets]}}) and Eldorado offer JSON.')), [
        { label: t('cancel'), fn: () => res(undefined) }, { label: t('import'), cls: 'primary', fn: () => res(s2._v || '') }]);
    });
    if (target === undefined) return;
    const r = await run(() => M.call('pets:import', json, target || null));
    if (r) { toast(`Imported ${r.added} pets (until the app restarts)`, 'good'); AL.json = ''; await refreshData(); render(); }
  };

  const addPet = () => {
    const f = { name: '', mutation: 'None', gen: '', traits: '', accountId: AL.filter.account || (S.accounts[0] || {}).id || '', cost: '' };
    const items = h('datalist', { id: 'dl-items' }, (S.items || []).map(i => h('option', { value: i.name })));
    modal('Add pet', h('div', { class: 'grid g2' },
      items,
      h('label', { class: 'f' }, 'Brainrot', txt('', v => f.name = v, { list: 'dl-items' })),
      h('label', { class: 'f' }, 'Mutation', sel(['None', ...mutationNames()], 'None', v => f.mutation = v)),
      h('label', { class: 'f' }, 'Gen/s (e.g. 62.5M)', txt('', v => f.gen = v)),
      h('label', { class: 'f' }, 'Traits (comma separated)', txt('', v => f.traits = v)),
      h('label', { class: 'f' }, 'Account', sel([['', '—'], ...S.accounts.map(a => [a.id, a.username])], f.accountId, v => f.accountId = v)),
      h('label', { class: 'f' }, 'Cost ($, optional)', txt('', v => f.cost = v))), [
      { label: t('cancel') },
      { label: t('add'), cls: 'primary', fn: async () => { if (!f.name) { toast('Name required', 'error'); return false; } await run(() => M.call('pets:add', { ...f, traits: f.traits.split(',').map(x => x.trim()).filter(Boolean), cost: Number(f.cost) || 0, accountId: f.accountId || null })); await refreshData(); render(); } }]);
  };

  const previewImage = async pet => {
    if (pet.imagePath) {
      const saved = await M.call('art:card', pet.id).catch(() => null);
      if (saved) return modal('Card — ' + pet.name, h('div', null, h('img', { src: saved, style: { width: '100%', borderRadius: '10px' } }), h('small', { class: 'muted' }, 'Saved by Generate Images · this is what Auto List uploads')), [{ label: t('close') }]);
    }
    const item = (S.items || []).find(i => i.name.toLowerCase() === pet.name.toLowerCase());
    const url = await renderListingImage({ pet, rarity: item && item.rarity, ...(await M.call('art:for', pet).catch(() => ({}))), shopName: al.shopName || '', recolor: al.recolorByMutation !== false });
    modal('Image preview — ' + pet.name, h('img', { src: url, style: { width: '100%', borderRadius: '10px' } }), [{ label: t('close') }]);
  };

  const showComps = async pet => {
    const r = await run(() => M.call('price:smart', pet.id)); if (!r) return;
    modal(`Smart price — ${pet.name} ${formatGen(pet.gen)}`, h('div', null,
      h('p', null, h('b', { style: { fontSize: '20px', color: 'var(--gold)' } }, money(r.price)), '  ', h('span', { class: 'muted' }, r.basis)),
      table(r.comps, [
        { label: 'Seller', render: c => c.seller + (c.verified ? ' ✓' : '') },
        { label: 'Gen', render: c => formatGen(c.gen) }, { label: 'Mut', render: c => c.mutation || '—' },
        { label: 'Delivery', render: c => dtLabel(c.delivery) }, { label: 'Feedback', num: true, render: c => c.feedback != null ? c.feedback.toFixed(1) + '%' : '—' },
        { label: 'Ratings', num: true, k: 'ratings' }, { label: 'Price', num: true, render: c => money(c.price) }], { empty: 'No competitor offers pass your Listing Rules.', maxHeight: '360px' })),
      [{ label: 'Use this price', cls: 'primary', fn: async () => { await M.call('pets:update', [pet.id], { price: r.price, priceBasis: r.basis }); await refreshData(); render(); } }, { label: t('close') }]);
  };

  const markSold = async p => { const pr = await promptBox('Mark as sold (sold outside Zotac)', `Sale price $${p.offerId ? ' — the Eldorado offer stays live, delete it there if needed' : ''}`, p.price || ''); if (pr === null) return; await M.call('pets:markSold', [p.id], pr); AL.selected.delete(p.id); await refreshData(); render(); };
  const delPet = async p => { if (!await confirmBox(`Delete ${p.name} from the app? (Eldorado offers are not touched)`)) return; await M.call('pets:delete', [p.id]); AL.selected.delete(p.id); await refreshData(); render(); };
  // open our Searcher prefilled with this brainrot and run the search
  const searchEldorado = p => searchSimilar(p);

  // ---- scanner script panel: read-only, always the bundled scanner with this install's port +
  // token (an edited copy did nothing for autoexec and kept an old token after a token change) ----
  const scriptArea = h('textarea', { class: 'x-script mono', spellcheck: 'false', readonly: true, placeholder: 'Loading the scanner…' });
  M.call('scanner:script').then(s => { scriptArea.value = s; }).catch(() => { scriptArea.value = '-- could not load the scanner script'; });
  const jsonArea = h('textarea', { class: 'x-json mono', placeholder: 'Paste JSON from Zotac Lister Scanner here...', spellcheck: 'false' });
  jsonArea.value = AL.json;
  const countEl = h('span', { class: 'x-count' }, String(xJsonCount(AL.json)));
  jsonArea.addEventListener('input', () => { AL.json = jsonArea.value; countEl.textContent = String(xJsonCount(AL.json)); });

  const scriptPanel = h('section', { class: 'x-panel' },
    h('div', { class: 'x-ptitle' }, h('span', { class: 'x-glyph' }, '</>'), 'PLOT SCANNER SCRIPT', h('div', { class: 'grow' }),
      h('small', { class: 'muted', style: { fontWeight: 400, letterSpacing: 0 } }, 'Auto Scanner'), sw((S.settings.scanner || {}).autoexec !== false, v => toggleAutoexec('scanner', v))),
    h('p', { class: 'x-ptext' }, 'Zotac already puts the scanner in your executor\'s autoexec, so every account it opens scans ', h('b', null, 'its own base'), ' and keeps it synced every 30 s. Copy it only to run it by hand (this copy shows an in-game window and also puts the JSON on your clipboard, to paste below if Zotac was closed).'),
    h('div', { class: 'x-code' }, scriptArea,
      h('div', { class: 'row x-code-btns' },
        h('button', { class: 'btn sm', onclick: () => { if (!scriptArea.value.trim()) return toast('Nothing to copy yet', 'error'); xCopy(scriptArea.value, 'Script copied'); } }, 'Copy'))),
    h('div', { class: 'x-steps' },
      h('span', null, h('i', null, '1'), h('b', null, 'Join'), ' Steal a Brainrot'), h('em', null),
      h('span', null, h('i', null, '2'), h('b', null, 'Execute'), ' the script on each account'), h('em', null),
      h('span', null, h('i', null, '3'), h('b', null, 'Pets appear'), ' below (or paste the JSON)')));

  const inputPanel = h('section', { class: 'x-panel' },
    h('div', { class: 'x-ptitle' }, h('span', { class: 'x-glyph' }, '⬇'), 'SCANNER JSON INPUT', countEl),
    jsonArea,
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn sm', onclick: async () => { const tx = await readFileText(); if (tx) { AL.json = tx; render(); } } }, '▤ Load File'),
      h('button', { class: 'btn sm', onclick: async () => { try { AL.json = await navigator.clipboard.readText(); render(); } catch { toast('Clipboard not available — paste with Ctrl+V', 'error'); } } }, '⎘ Paste'),
      h('button', { class: 'btn sm primary', onclick: () => { if (!AL.json.trim()) return toast('Paste the scanner JSON first', 'error'); importJson(AL.json); } }, '✓ Parse & Edit'),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn sm ghost', onclick: addPet }, '+ Pet')));

  // ---- selection bar ----
  const allChecked = pets.length && pets.every(p => AL.selected.has(p.id));
  const selBar = h('div', { class: 'x-selbar' },
    h('input', { type: 'checkbox', checked: allChecked, onchange: e => { pets.forEach(p => e.target.checked ? AL.selected.add(p.id) : AL.selected.delete(p.id)); render(); } }),
    h('span', null, `${AL.selected.size} selected of ${pets.length} pets`),
    h('div', { class: 'grow' }),
    pets.some(p => p.status === 'available') ? h('button', { class: 'btn sm ghost danger', title: 'Delete every pet that is not listed or sold', onclick: async () => {
      const ids = pets.filter(p => p.status === 'available').map(p => p.id);
      if (!await confirmBox(`Clear the ${ids.length} unlisted pets shown here from the app? (listed and sold pets stay, Eldorado is not touched)`)) return;
      await M.call('pets:delete', ids); AL.selected.clear(); await refreshData(); render();
    } }, 'Clear unlisted') : null,
    AL.selected.size ? [
      h('button', { class: 'btn sm ghost', title: 'For listed pets whose Eldorado offer is gone', onclick: async () => {
        const ids = [...AL.selected].filter(id => { const p = S.pets.find(x => x.id === id); return p && p.status === 'listed'; });
        if (!ids.length) return toast('Only listed pets can be reset (sold ones belong to an order)', 'error');
        if (!await confirmBox(`Put ${ids.length} listed pet(s) back to available? Their Eldorado offer is NOT deleted: only do this when the offer is already gone.`)) return;
        await M.call('pets:update', ids, { status: 'available', offerId: null }); await refreshData(); render(); } }, 'Reset to available'),
      h('button', { class: 'btn sm ghost danger', onclick: async () => { const ids = [...AL.selected]; if (!await confirmBox(`Delete ${ids.length} pets from the app? (Eldorado offers are not touched)`)) return; await M.call('pets:delete', ids); AL.selected.clear(); await refreshData(); render(); } }, t('delete'))] : null);

  // collapsible card (open state remembered per card)
  const alCard = (key, glyph, title, ...body) => {
    const open = AL.fold[key] !== false;
    return h('section', { class: 'x-panel x-alcard' + (open ? '' : ' shut') },
      h('div', { class: 'x-ptitle x-alhead', onclick: () => { AL.fold[key] = !open; xLs.set('zotac.alFold', AL.fold); render(); } },
        h('span', { class: 'x-glyph' }, glyph), title, h('div', { class: 'grow' }), h('span', { class: 'x-caret' }, open ? '⌄' : '›')),
      open ? body : null);
  };
  const live = pets.filter(p => p.status === 'available');   // bulk Quick Fill / Price / Generate: not-yet-listed pets only
  const selIds = () => [...AL.selected];

  // ---- QUICK FILL ----
  const titleEls = [];   // rows that follow the live template
  const qt = h('input', { type: 'text', class: 'x-qt', value: al.titleTemplate || '', placeholder: '{mutation} {name} | {gen}', spellcheck: 'false' });
  const qd = h('textarea', { class: 'x-qd', value: al.descriptionTemplate || '', spellcheck: 'false' });
  let saveT = null;
  const saveTpl = () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => saveSettings({ autolist: { titleTemplate: qt.value, descriptionTemplate: qd.value } }), 350);
    for (const [el, p] of titleEls) el.textContent = xFill(qt.value, p);
  };
  qt.addEventListener('focus', () => { AL.lastKey = 'title'; });
  qd.addEventListener('focus', () => { AL.lastKey = 'desc'; });
  qt.addEventListener('input', saveTpl); qd.addEventListener('input', saveTpl);
  const insertAt = text => {
    const el = AL.lastKey === 'desc' ? qd : qt;
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    el.value = el.value.slice(0, a) + text + el.value.slice(b);
    el.focus(); el.setSelectionRange(a + text.length, a + text.length); saveTpl();
  };
  const keep = e => e.preventDefault();   // chips must not steal the caret
  const emoPop = h('div', { class: 'x-emo' }, AL_EMOJIS.map(em => h('button', { onmousedown: keep, onclick: () => insertAt(em) }, em)));
  const qDel = sel(DELIVERY_TIMES.filter(x => x !== 'Instant').map(v => [v, dtLabel(v)]), al.deliveryTime, v => saveSettings({ autolist: { deliveryTime: v } }));
  const qp = h('input', { type: 'number', step: '0.01', min: '0', placeholder: '—' });
  const applyQuick = async ids => {
    if (!ids.length) return toast('Select pets first', 'error');
    clearTimeout(saveT);
    await saveSettings({ autolist: { titleTemplate: qt.value, descriptionTemplate: qd.value, deliveryTime: qDel.value } });
    const tpl = { title: qt.value, description: qd.value, deliveryTime: qDel.value };
    if (qp.value !== '') tpl.price = Number(qp.value);
    await run(() => M.call('pets:quickFill', ids, tpl)); await refreshData(); render(); toast(`Quick Fill applied to ${ids.length} pets`, 'good');
  };
  const quickFill = alCard('quick', '▣', 'QUICK FILL',
    h('div', { class: 'x-qf' },
      h('div', { class: 'x-qmain' },
        h('div', { class: 'x-lbl' }, 'TITLE TEMPLATE'), qt,
        h('div', { class: 'x-vars' }, h('small', null, 'Variables:'),
          AL_VARS.map(v => h('button', { class: 'x-var', onmousedown: keep, onclick: () => insertAt(`{${v}}`) }, `{${v}}`)),
          h('span', { class: 'x-emo-wrap' }, h('button', { class: 'x-var x-emob', onmousedown: keep, onclick: () => emoPop.classList.toggle('on') }, '✎ Emojis'), emoPop)),
        h('div', { class: 'x-lbl' }, 'DESCRIPTION'), qd),
      h('div', { class: 'x-qside' },
        h('div', { class: 'x-lbl' }, 'DELIVERY'), qDel,
        h('div', { class: 'x-lbl' }, 'PRICE ($)'), qp,
        h('button', { class: 'btn', title: 'Apply to the selected pets', onclick: () => applyQuick(selIds()) }, 'Selected'),
        h('button', { class: 'btn primary', onclick: () => applyQuick(live.map(p => p.id)) }, 'Apply to All'),
        h('button', { class: 'btn', onclick: async () => {
          const name = await promptBox('Save template', 'Template name'); if (!name) return;
          await run(() => M.call('templates:save', { name, title: qt.value, description: qd.value, price: qp.value === '' ? null : Number(qp.value), deliveryTime: qDel.value }), 'Template saved'); await refreshData();
        } }, '💾 Save Template'))));

  // ---- BULK AUTO PRICE ----
  const priceRun = async list => {
    const todo = list.filter(p => !xIsReview(p, special) && p.status !== 'sold');
    const skipped = list.length - todo.length;
    if (!todo.length) return toast(list.length ? 'Nothing to price (manual-review pets are skipped)' : 'Select pets first', 'error');
    toast(`Pricing ${todo.length} pets…`);
    let ok = 0, fail = 0, firstErr = '';
    for (const p of todo) {
      try {
        const r = await M.call('price:smart', p.id);
        if (r && r.price) { await M.call('pets:update', [p.id], { price: r.price, priceBasis: r.basis, priceLocked: false }); ok++; }
        else { fail++; firstErr = firstErr || (r && r.basis) || 'no price'; await M.call('pets:update', [p.id], { priceBasis: (r && r.basis) || 'no price' }); }   // reason stays on the row
      } catch (e) { fail++; firstErr = firstErr || e.message; }
    }
    await refreshData(); render();
    toast(`Priced ${ok}` + (fail ? ` · ${fail} failed (${firstErr})` : '') + (skipped ? ` · ${skipped} skipped (manual review)` : ''), fail ? 'error' : 'good', 7000);
  };
  const byMs = al.genTolMode === 'ms';
  const bulkPrice = alCard('price', '$', 'BULK AUTO PRICE',
    h('div', { class: 'x-bulk' },
      h('label', { class: 'x-fld' }, h('span', { class: 'x-lbl' }, 'UNDERCUT'),
        h('span', { class: 'x-money' }, '$', h('input', { type: 'number', step: '0.01', min: '0', value: al.undercut ?? 0.01, onchange: e => saveSettings({ autolist: { undercut: Number(e.target.value) || 0 } }) }))),
      h('label', { class: 'x-fld' }, h('span', { class: 'x-lbl' }, 'GENERATION TOLERANCE'),
        h('span', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } },
          h('input', { type: 'number', step: 'any', min: '0', class: 'x-tol', value: byMs ? (al.genToleranceMs ?? 0) : (al.genTolerancePct ?? 15), onchange: e => saveSettings({ autolist: byMs ? { genToleranceMs: Number(e.target.value) || 0 } : { genTolerancePct: Number(e.target.value) || 0 } }) }),
          sel([['ms', 'Exact M/s'], ['pct', '± %']], byMs ? 'ms' : 'pct', v => saveSettings({ autolist: { genTolMode: v } }).then(render)))),
      h('button', { class: 'btn', onclick: () => priceRun(pets.filter(p => AL.selected.has(p.id))) }, 'Price Selected'),
      h('button', { class: 'btn primary', onclick: () => priceRun(live) }, 'Price All')));

  // ---- LISTING RULES ----
  const dts = Array.isArray(rules.deliveryTimes) ? rules.deliveryTimes : [];
  const setDts = async list => { await saveSettings({ rules: { deliveryTimes: DELIVERY_TIMES.filter(x => list.includes(x)) } }); render(); };
  const words = (Array.isArray(rules.ignoreTitleWords) ? rules.ignoreTitleWords : String(rules.ignoreTitleWords || '').split(',')).map(x => String(x).trim()).filter(Boolean);
  const setWords = async list => { await saveSettings({ rules: { ignoreTitleWords: [...new Set(list)].join(',') } }); render(); };
  const wordIn = h('input', { type: 'text', placeholder: 'e.g. bundle, x10, cheap...' });
  const addWords = () => { const add = wordIn.value.split(',').map(x => x.trim().toLowerCase()).filter(Boolean); if (add.length) setWords([...words, ...add]); };
  wordIn.addEventListener('keydown', e => { if (e.key === 'Enter') addWords(); });
  const dtSel = h('div', { class: 'x-msel-wrap' },
    h('div', { class: 'x-msel' + (AL.dtOpen ? ' on' : ''), onclick: () => { AL.dtOpen = !AL.dtOpen; render(); } },
      h('span', null, dts.length ? dts.map(dtLabel).join(', ') : h('span', { class: 'muted' }, `Any up to ${dtLabel(rules.maxDeliveryTime || 'Hour1')}`)), h('span', { class: 'x-caret' }, '⌄')),
    AL.dtOpen ? h('div', { class: 'x-mdrop' }, DELIVERY_TIMES.map(v => h('div', { class: 'x-mopt' + (dts.includes(v) ? ' on' : ''), onclick: () => setDts(dts.includes(v) ? dts.filter(x => x !== v) : [...dts, v]) },
      h('span', { class: 'x-mck' }, dts.includes(v) ? '✓' : ''), dtLabel(v)))) : null);
  const listingRules = alCard('rules', '⚙', 'LISTING RULES',
    h('div', { class: 'x-rules' },
      h('div', { class: 'x-rrow' },
        h('div', { class: 'x-fld grow' }, h('span', { class: 'x-lbl' }, 'DELIVERY TIME'), dtSel,
          dts.length ? h('div', { class: 'x-chips' }, dts.map(v => h('span', { class: 'x-dchip' }, dtLabel(v), h('b', { title: 'Remove', onclick: () => setDts(dts.filter(x => x !== v)) }, '×')))) : null),
        h('label', { class: 'x-fld' }, h('span', { class: 'x-lbl' }, 'MIN REVIEWS'), num(rules.minRatings, v => saveSettings({ rules: { minRatings: v === '' ? 0 : v } }), { style: { width: '70px' } })),
        h('label', { class: 'x-fld' }, h('span', { class: 'x-lbl' }, 'MIN RATING (%)'), num(rules.minFeedback, v => saveSettings({ rules: { minFeedback: v === '' ? 0 : v } }), { style: { width: '70px' } }))),
      h('div', { class: 'x-rsec' },
        h('div', { class: 'x-lbl' }, h('span', { class: 'x-dot' }), 'BLOCKED TITLE WORDS'),
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, wordIn, h('button', { class: 'btn sm', onclick: addWords }, 'Add')),
        words.length ? h('div', { class: 'x-chips' }, words.map(w => h('span', { class: 'x-wchip' }, w, h('b', { title: 'Remove', onclick: () => setWords(words.filter(x => x !== w)) }, '×')))) : null),
      h('div', { class: 'x-rsec' },
        h('div', { class: 'x-lbl' }, '★ SPECIAL TRAITS — MANUAL REVIEW'),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: () => manageSpecial() }, `☆ Manage traits (${(al.specialTraits || []).length})`),
          h('small', { class: 'muted' }, 'pets with a special trait go to a review section and are skipped by Auto Price')))));

  // ---- GENERATE IMAGES ----
  const genRun = async ids => {
    if (!ids.length) return toast('Select pets first', 'error');
    toast(`Generating ${ids.length} images…`);
    const r = await run(() => M.call('pets:generateImages', ids)); if (!r) return;
    await refreshData(); render();
    toast(`${r.ok} cards saved` + (r.failed ? ` · ${r.failed} failed (${r.errors[0]})` : ''), r.failed ? 'error' : 'good', 7000);
  };
  const genImages = alCard('images', '▨', 'GENERATE IMAGES',
    h('div', { class: 'x-bulk' },
      h('button', { class: 'btn', onclick: () => genRun(selIds().filter(id => live.some(p => p.id === id))) }, 'Generate Selected'),
      h('button', { class: 'btn primary', onclick: () => genRun(live.map(p => p.id)) }, 'Generate All'),
      h('label', { class: 'x-chk' }, h('input', { type: 'checkbox', checked: al.recolorByMutation !== false, onchange: e => saveSettings({ autolist: { recolorByMutation: e.target.checked } }) }), 'Recolor pet by mutation')));

  // ---- pet list ----
  const sortBtn = (key, label) => h('button', { class: 'x-chip' + (AL.sort === key ? ' on' : ''), onclick: () => { if (AL.sort === key) AL.dir = -AL.dir; else { AL.sort = key; AL.dir = key === 'name' ? 1 : -1; } render(); } },
    label, AL.sort === key ? (AL.dir > 0 ? ' ↑' : ' ↓') : '');
  const sortBar = h('div', { class: 'x-sortbar' },
    h('span', { class: 'x-lbl' }, 'SORT'), sortBtn('name', 'Name'), sortBtn('gen', 'Generation'),
    h('div', { class: 'grow' }),
    S.accounts.length > 1 ? sel([['', 'All accounts'], ...S.accounts.map(a => [a.id, a.username])], AL.filter.account, v => { AL.filter.account = v; render(); }) : null,
    sel([['available', 'Available'], ['listed', 'Listed'], ['sold', 'Sold'], ['all', 'All']], AL.filter.status, v => { AL.filter.status = v; render(); }),
    h('input', { type: 'search', class: 'x-psearch', placeholder: '⌕  Search pet...', value: AL.filter.q, oninput: e => { AL.filter.q = e.target.value; clearTimeout(AL.qt); AL.qt = setTimeout(render, 250); } }));

  const priceCell = p => {
    const el = h('span', { class: 'x-alprice' + (p.priceLocked ? ' lock' : ''), title: (p.priceBasis ? p.priceBasis + ' · ' : '') + 'click to edit', onclick: () => {
      const inp = h('input', { type: 'number', step: '0.01', min: '0', value: p.price ?? '', class: 'x-alpin' });
      let esc = false;
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { esc = true; inp.blur(); } });
      inp.addEventListener('blur', async () => {
        if (!esc && String(inp.value) !== String(p.price ?? '')) { await M.call('pets:update', [p.id], { price: inp.value === '' ? null : Number(inp.value), priceLocked: inp.value !== '' }); await refreshData(); }
        render();
      });
      el.replaceWith(inp); inp.focus(); inp.select();
    } }, p.price ? money(p.price) : (p.priceBasis === 'unknown item' ? 'not on Eldorado' : money(0)));
    if (!p.price && p.priceBasis === 'unknown item') el.classList.add('x-noeld');
    return el;
  };
  const row = (p, rev) => {
    const tEl = h('span', { class: 'x-alt' }, p.title || xFill(al.titleTemplate, p));
    if (!p.title) titleEls.push([tEl, p]);
    const traits = p.traits || [];
    return h('div', { class: 'x-alrow' + (rev ? ' rev' : '') + (AL.selected.has(p.id) ? ' sel' : '') },
      h('input', { type: 'checkbox', checked: AL.selected.has(p.id), onchange: e => { e.target.checked ? AL.selected.add(p.id) : AL.selected.delete(p.id); render(); } }),
      p.imagePath ? xCardThumb(p, () => previewImage(p)) : xPetThumb(p, () => previewImage(p)),
      h('div', { class: 'x-alname', title: p.title ? 'Fixed title (Quick Fill)' : 'Title from the template' }, tEl,
        p.status !== 'available' ? statusPill(p.status) : null,
        null),
      h('div', { class: 'x-alact' },
        h('button', { title: 'Smart price & competitors', onclick: () => showComps(p) }, '$'),
        h('button', { title: 'Preview image', onclick: () => previewImage(p) }, 'Img'),
        p.offerId ? h('button', { title: 'Open offer', onclick: () => M.call('open:external', offerUrl({ id: p.offerId })) }, '↗') : null,
        p.status !== 'sold' ? h('button', { title: 'Mark as sold (sold outside Zotac)', onclick: () => markSold(p) }, '✓') : null),
      rev ? h('span', { class: 'x-review' }, 'REVIEW') : null,
      xMutBlock(p.mutation),
      traits.length ? h('span', { class: 'x-trp' }, traits.slice(0, 8).map(tr => ART_THUMBS.traits[tr] ? h('img', { src: ART_THUMBS.traits[tr], title: tr, alt: tr }) : h('em', { title: tr }, String(tr).slice(0, 3)))) : null,
      h('span', { class: 'x-alown', title: 'Owner account' }, acctName(p.accountId)),
      h('button', { class: 'x-srch', onclick: () => searchEldorado(p) }, 'Search on Eldorado'),
      priceCell(p),
      h('button', { class: 'x-aldel', title: 'Delete from the app', onclick: () => delPet(p) }, '✕'));
  };
  const lim = AL.limit;
  const list = pets.length ? h('div', { class: 'x-allist' },
    review.length ? [
      h('div', { class: 'x-sec rev' }, h('b', null, '★ MANUAL REVIEW'), h('small', null, `(${review.length})`), h('div', { class: 'grow' }), h('small', { class: 'x-sec-r' }, 'priced manually · skipped by Auto Price')),
      h('div', { class: 'x-secbody rev' }, review.slice(0, lim).map(p => row(p, true)))] : null,
    h('div', { class: 'x-sec' }, h('b', null, 'READY TO LIST'), h('small', null, `(${ready.length})`)),
    h('div', { class: 'x-secbody' }, ready.slice(0, lim).map(p => row(p, false))),
    review.length > lim || ready.length > lim ? h('div', { style: { textAlign: 'center', margin: '10px' } }, h('button', { class: 'btn sm', onclick: () => { AL.limit += 200; render(); } }, 'Show more')) : null)
    : h('div', { class: 'x-empty' }, h('div', { class: 'x-empty-ic' }, '▤'), h('div', null, S.pets.length ? 'No pets match the filter.' : 'Paste a JSON and click import'));

  const startBtn = S.listerRunning
    ? h('button', { class: 'btn danger', onclick: () => M.call('autolist:stop') }, 'Stop')
    : h('button', { class: 'btn primary', onclick: async () => {
      const chosen = [...AL.selected].map(id => S.pets.find(p => p.id === id)).filter(p => p && p.status === 'available');
      const ids = chosen.filter(xDeliverable).map(p => p.id);
      if (chosen.length > ids.length) toast(`${chosen.length - ids.length} pet(s) skipped: their account is not logged in, so Zotac could not deliver them`, 'error', 8000);
      if (!ids.length) return toast('Select available pets of logged-in accounts to list', 'error');
      if (!S.me) return toast('Log in to Eldorado first (Account page)', 'error');
      const ok = await confirmAutoList(ids); if (!ok) return;
      await run(() => M.call('autolist:start', ids, { prices: ok.prices })); S.listerRunning = true; render();
    } }, `Start Auto List (${AL.selected.size})`);

  root.append(
    xHead('A', 'Auto List', null, startBtn),
    scriptPanel, inputPanel,
    selBar, quickFill, bulkPrice, listingRules, genImages,
    prog.total ? h('div', { class: 'card', style: { marginBottom: '12px' } },
      h('h3', null, 'Progress ', h('small', null, `${prog.done}/${prog.total} · ${prog.ok} ok · ${prog.failed} failed ${prog.current ? '· now: ' + prog.current : ''}`)),
      h('div', { class: 'progress' }, h('div', { style: { width: (100 * prog.done / Math.max(1, prog.total)) + '%' } }))) : null,
    sortBar, list,
    h('details', { class: 'x-fold', open: AL.open ? true : null, ontoggle: e => { AL.open = e.target.open; } },
      h('summary', null, 'Auto List settings · Activity'),
      h('div', { class: 'grid g2', style: { marginTop: '12px' } },
        h('div', { class: 'card' }, h('h3', null, 'Auto List settings'),
          h('div', { class: 'grid g2' },
            h('label', { class: 'f' }, 'Price mode', sel([['auto', 'Smart Auto Price'], ['fixed', 'Fixed price']], al.priceMode, v => saveSettings({ autolist: { priceMode: v } }).then(render))),
            al.priceMode === 'fixed' ? h('label', { class: 'f' }, 'Fixed price $', num(al.fixedPrice, v => saveSettings({ autolist: { fixedPrice: v } }))) : h('label', { class: 'f' }, 'No-comps $ per M/s', num(al.fallbackPerMillion, v => saveSettings({ autolist: { fallbackPerMillion: v } }))),
            h('label', { class: 'f' }, 'Min price $', num(al.minPrice, v => saveSettings({ autolist: { minPrice: v } }))),
            h('label', { class: 'f' }, 'Max price $', num(al.maxPrice, v => saveSettings({ autolist: { maxPrice: v } }))),
            h('label', { class: 'f' }, 'Delay between listings (s)', num(al.delaySec, v => saveSettings({ autolist: { delaySec: v } }))),
            h('label', { class: 'f' }, '{emoji} variable', txt(al.emoji ?? '🔥', v => saveSettings({ autolist: { emoji: v } }), { style: { width: '100px' } }))),
          setting('Automatic image generation', 'Render a card when a pet has no generated image', sw(al.generateImage, v => saveSettings({ autolist: { generateImage: v } }))),
          setting('Stock detection', 'Same pet already listed → +1 quantity', sw(al.stockDetection, v => saveSettings({ autolist: { stockDetection: v } }))),
          setting('Ignore my own offers', 'Listing Rules: skip my offers when pricing', sw(rules.ignoreOwn, v => saveSettings({ rules: { ignoreOwn: v } }))),
          setting('Pet art folder', al.imageFolder || 'Optional: PNGs named after the brainrot', h('button', { class: 'btn sm', onclick: async () => { const f = await M.call('dialog:folder'); if (f !== null) { await saveSettings({ autolist: { imageFolder: f } }); render(); } } }, 'Choose'))),
        h('div', { class: 'card' }, h('h3', null, 'Activity'),
          h('div', { class: 'log', id: 'al-log' }, (S.logs || []).filter(l => /\[AutoList\]/.test(l.msg)).slice(-80).map(l => h('div', { class: 'l-' + l.level }, `${new Date(l.t).toLocaleTimeString()}  ${l.msg.replace('[AutoList] ', '')}`)))))));
  const lg = $('#al-log'); if (lg) lg.scrollTop = lg.scrollHeight;
};

// "Special traits — manual review": grid of every trait (Eldorado list + the ones your pets
// have), click to flag/unflag; saved right away
async function manageSpecial() {
  const attrDef = (S.attrs || []).find(a => a.id === S.settings.game.traitsAttr);
  const cur = () => (S.settings.autolist || {}).specialTraits || [];
  const seen = new Map();
  for (const n of [...(attrDef ? attrDef.selectValues.map(v => v.name) : []), ...S.pets.flatMap(p => p.traits || []), ...cur()]) {
    const k = String(n || '').trim(); if (k && !seen.has(k.toLowerCase())) seen.set(k.toLowerCase(), k);
  }
  const names = [...seen.values()].sort((a, b) => a.localeCompare(b));
  // every trait still without an icon is asked for again (icons may have arrived since)
  const want = names.filter(n => !ART_THUMBS.traits[n]);
  if (want.length) {
    try { const r = await M.call('art:thumbs', { traits: want }); for (const [k, v] of Object.entries(r.traits || {})) if (v) ART_THUMBS.traits[k] = v; } catch { /* text tiles */ }
  }
  const has = n => cur().some(x => String(x).toLowerCase() === n.toLowerCase());
  const search = h('input', { type: 'search', placeholder: 'Search trait...', class: 'x-trsearch' });
  const grid = h('div', { class: 'x-trgrid' });
  const draw = () => {
    grid.textContent = '';
    const q = search.value.trim().toLowerCase();
    const shown = names.filter(n => !q || n.toLowerCase().includes(q));
    if (!shown.length) grid.appendChild(h('div', { class: 'muted', style: { gridColumn: '1 / -1', padding: '20px', textAlign: 'center' } }, names.length ? 'No trait matches.' : 'No traits known yet (log in to Eldorado or import pets).'));
    for (const n of shown) {
      const pic = ART_THUMBS.traits[n];
      grid.appendChild(h('button', { class: 'x-trc' + (has(n) ? ' on' : ''), title: n, onclick: async () => {
        const next = has(n) ? cur().filter(x => String(x).toLowerCase() !== n.toLowerCase()) : [...cur(), n];
        await saveSettings({ autolist: { specialTraits: next } }); draw(); render();
      } },
        h('span', { class: 'x-trck' }, '✓'),
        pic ? h('img', { src: pic, alt: n }) : h('span', { class: 'x-trtx' }, n.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '?'),
        h('small', null, n)));
    }
  };
  search.addEventListener('input', draw);
  draw();
  modal('Special traits — manual review', h('div', { class: 'x-trmodal' },
    h('div', { class: 'row', style: { marginBottom: '10px', flexWrap: 'nowrap' } },
      h('small', { class: 'muted' }, 'click to flag/unflag · flagged pets go to a review section and are skipped by Auto Price'), h('div', { class: 'grow' }), search),
    grid), [{ label: t('close'), cls: 'primary' }]);
  setTimeout(() => search.focus(), 50);
}

function mutationNames() {
  const a = (S.attrs || []).find(x => x.id === S.settings.game.mutationAttr);
  return a ? a.selectValues.map(v => v.name).filter(n => n !== 'None') : ['Gold', 'Diamond', 'Rainbow', 'Lava', 'Galaxy', 'Candy', 'Bloodrot', 'Cyber', 'Cursed', 'Divine', 'Radioactive', 'Yin-Yang', 'Phantom', 'Crystal', 'Eclipse'];
}

// ============================== LISTINGS ==================================
const LS = { state: 'Active', data: null, loading: false, q: '', pct: 10, dir: '-', err: null, at: 0, seq: 0 };
PAGES.listings = async root => {
  const rp = S.settings.repricer;
  const blocked = rp.blockedTraits || [];
  const load = async () => {
    const seq = ++LS.seq;
    LS.loading = true; render();
    const states = ['Active', 'Paused', 'Closed'];
    const res = await Promise.allSettled(states.map(st => M.call('eld:myOffers', st)));
    if (seq !== LS.seq) return;   // a newer Refresh took over
    const d = {}, errs = [];
    states.forEach((st, i) => {
      if (res[i].status === 'fulfilled') d[st] = res[i].value || [];
      else { d[st] = (LS.data && LS.data[st]) || []; errs.push(`${st === 'Closed' ? 'Closed' : st}: ${(res[i].reason && res[i].reason.message) || 'failed'}`); }
    });
    LS.data = d; LS.err = errs.length ? errs.join('\n') : null; LS.at = Date.now();
    LS.loading = false; render();
  };
  if (S.me && !LS.loading && (!LS.data || (LS.err && Date.now() - LS.at > 15000))) load();
  const D = LS.data || { Active: [], Paused: [], Closed: [] };
  const act = async (o, a, arg, quiet) => { await run(() => M.call('eld:offerAction', o.id, a, arg), quiet ? null : `${a} ok`); if (!quiet) load(); };
  const attr = (o, re) => { const a = (o.attributes || []).find(x => re.test(x.id)); return a ? (a.type === 'Numeric' ? a.value : a.value && a.value.name) : null; };
  const priceOf = o => Number((o.pricePerUnit || {}).amount) || 0;
  const hasBlocked = o => { if (!blocked.length) return false; const hay = (JSON.stringify(o.attributes || []) + ' ' + (o.offerTitle || '')).toLowerCase(); return blocked.some(b => hay.includes(String(b).toLowerCase())); };
  const rows = (LS.state === 'All' ? [...D.Active, ...D.Paused, ...D.Closed] : (D[LS.state] || [])).filter(o => !LS.q || String(o.offerTitle || '').toLowerCase().includes(LS.q.toLowerCase()));
  const offline = [...D.Active, ...D.Paused, ...D.Closed].filter(o => /offline|inactive/i.test(o.offerState || '')).length;
  const totalListed = D.Active.reduce((a, o) => a + priceOf(o) * (o.quantity || 1), 0);

  const bulk = async (list, fn, label) => {
    if (!list.length) return toast('Nothing to do', 'info');
    if (!await confirmBox(`${label} ${list.length} offers?`)) return;
    toast(`${label}… (${list.length})`);
    for (const o of list) await fn(o);
    toast(`${label} done`, 'good'); load();
  };
  const manageTraits = async () => {
    const attrDef = (S.attrs || []).find(a => a.id === S.settings.game.traitsAttr);
    const names = attrDef ? attrDef.selectValues.map(v => v.name) : [];
    const pick = new Set(blocked);
    const extra = h('input', { type: 'text', placeholder: 'Add a trait name…' });
    const want = names.filter(n => !ART_THUMBS.traits[n]);
    if (want.length) { try { const r = await M.call('art:thumbs', { traits: want }); for (const [k, v] of Object.entries(r.traits || {})) if (v) ART_THUMBS.traits[k] = v; } catch { /* names only */ } }
    const box = h('div', { class: 'x-traitbox' }, names.map(n => h('label', { class: 'chk' },
      h('input', { type: 'checkbox', checked: pick.has(n), onchange: e => e.target.checked ? pick.add(n) : pick.delete(n) }),
      ART_THUMBS.traits[n] ? h('img', { class: 'x-tbicon', src: ART_THUMBS.traits[n], alt: '' }) : h('span', { class: 'x-tbicon ph' }),
      n)));
    modal('Blocked traits', h('div', null, h('p', { class: 'muted' }, 'Offers containing a blocked trait are skipped by "Auto Price All" on this page.'), names.length ? box : h('p', { class: 'muted' }, 'Trait list not loaded yet (log in first). Add names manually:'), h('div', { class: 'row', style: { marginTop: '8px' } }, extra)), [
      { label: t('cancel') },
      { label: t('save'), cls: 'primary', fn: async () => { if (extra.value.trim()) pick.add(extra.value.trim()); await saveSettings({ repricer: { blockedTraits: [...pick] } }); render(); } }]);
  };

  const card = o => {
    const img = offerImg(o);
    const st = o.offerState || LS.state;
    const stCls = /pause/i.test(st) ? 'warn' : /expir|clos/i.test(st) ? 'bad' : 'good';
    const gen = attr(o, /numeric/);
    return h('div', { class: 'x-lcard' },
      h('div', { class: 'x-limg' }, img ? h('img', { src: img, loading: 'lazy', onerror: e => e.target.remove() }) : null,
        h('span', { class: 'x-status ' + stCls }, String(st).toUpperCase()),
        (S.settings.repricer.scope === 'chosen') ? (() => {
          const on = (S.settings.repricer.offerIds || []).includes(o.id);
          return h('button', { class: 'x-autotag' + (on ? ' on' : ''), title: on ? 'Auto repriced — click to exclude' : 'Not auto repriced — click to include', onclick: async e => {
            e.stopPropagation();
            const ids = new Set(S.settings.repricer.offerIds || []);
            on ? ids.delete(o.id) : ids.add(o.id);
            await saveSettings({ repricer: { offerIds: [...ids] } }); render();
          } }, on ? '✓ AUTO' : 'AUTO');
        })() : null,
        h('span', { class: 'x-lprice' }, money(priceOf(o)))),
      h('div', { class: 'x-lbody' },
        h('div', { class: 'x-ltitle', title: o.offerTitle }, o.offerTitle || '—'),
        h('div', { class: 'x-lsub' }, [o.quantity > 1 ? '×' + o.quantity : null, gen ? formatGen(gen) : null, attr(o, /mutation/)].filter(Boolean).join(' · '))),
      h('div', { class: 'x-lact' },
        /pause/i.test(st) ? h('button', { title: 'Resume', onclick: () => act(o, 'resume') }, '▶') : h('button', { title: 'Pause', onclick: () => act(o, 'pause') }, '❚❚'),
        h('button', { title: 'Reprice', onclick: () => M.call('repricer:run', [o.id]).then(r => { toast(`Repricer: ${r.changed} changed`); load(); }) }, '%'),
        h('button', { title: 'Edit price', onclick: async () => { const v = await promptBox('Edit price', 'New price $', priceOf(o)); if (v !== null && v !== '' && Number(v) > 0) act(o, 'price', Number(v)); } }, '$'),
        h('button', { title: 'Open on Eldorado', onclick: () => M.call('open:external', offerUrl(o)) }, '↗'),
        h('button', { class: 'del', title: 'Delete', onclick: async () => { if (await confirmBox(`Delete offer "${o.offerTitle}"?`)) act(o, 'delete'); } }, '✕')));
  };

  root.append(
    xHead('L', 'My Listings', 'Manage your active listings',
      h('button', { class: 'btn sm', onclick: () => bulk(D.Active, o => act(o, 'pause', undefined, true), 'Pause') }, '❚❚ Pause All'),
      h('button', { class: 'btn sm', onclick: () => bulk(D.Paused, o => act(o, 'resume', undefined, true), 'Resume') }, '▶ Resume All'),
      h('span', { class: 'x-adj' },
        sel([['-', '−'], ['+', '+']], LS.dir, v => LS.dir = v),
        h('input', { type: 'number', value: LS.pct, min: '0', step: '1', onchange: e => LS.pct = Number(e.target.value) || 0 }), '%',
        h('button', { class: 'btn sm', onclick: () => { const f = 1 + (LS.dir === '+' ? 1 : -1) * LS.pct / 100; bulk(D.Active, o => act(o, 'price', Math.max(0.01, Math.round(priceOf(o) * f * 100) / 100), true), `${LS.dir}${LS.pct}% on`); } }, '% All')),
      sel([['Active', 'Active'], ['Paused', 'Paused'], ['Closed', 'Closed'], ['All', 'All']], LS.state, v => { LS.state = v; render(); }),
      h('button', { class: 'btn sm', onclick: load }, LS.loading ? 'Loading…' : t('refresh')),
      h('button', { class: 'btn sm danger', onclick: () => bulk(rows, o => act(o, 'delete', undefined, true), 'Delete') }, 'Delete All')),
    !S.me ? h('div', { class: 'card empty' }, 'Log in on the Account page to see your listings.') : h('div', null,
      h('div', { class: 'x-tiles x-t6' },
        xTile('ACTIVE', String(D.Active.length), 'x-green'), xTile('PAUSED', String(D.Paused.length), 'x-yellow'),
        xTile('CLOSED', String(D.Closed.length), 'x-red'), xTile('OFFLINE', String(offline), 'x-grey'),
        xTile('TOTAL LISTED', money(totalListed), 'x-green'), xTile('LIQUID (-15%)', money(totalListed * 0.85), 'x-purple')),
      h('div', { class: 'x-bar' },
        h('span', { class: 'x-bar-k' }, 'AUTO-REPRICER'), sw(rp.enabled, v => saveSettings({ repricer: { enabled: v } })),
        h('span', { class: 'x-bar-f' }, 'Reprice: ', sel([['all', 'All listings'], ['chosen', `Only chosen (${(rp.offerIds || []).length})`]], rp.scope || 'all', v => saveSettings({ repricer: { scope: v } }).then(render))),
        h('span', { class: 'x-bar-f' }, 'Interval: ', num(rp.intervalMin, v => saveSettings({ repricer: { intervalMin: v } }), { style: { width: '56px' } }), ' min'),
        h('span', { class: 'x-bar-f' }, 'Undercut: $', num(rp.undercut, v => saveSettings({ repricer: { undercut: v } }), { style: { width: '66px' } })),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn sm primary', onclick: async () => {
          const ids = D.Active.filter(o => !hasBlocked(o)).map(o => o.id);
          toast(`Repricing ${ids.length} offers…`);
          const r = await run(() => M.call('repricer:run', ids)); if (r) toast(`Checked ${r.checked}, changed ${r.changed}`, 'good'); load();
        } }, '$ Auto Price All'),
        h('span', { class: 'x-bar-f' }, 'Raise up', sw(!rp.onlyIfBeaten, v => saveSettings({ repricer: { onlyIfBeaten: !v } })))),
      h('div', { class: 'x-bar x-bar2' },
        h('span', { class: 'x-bar-k' }, 'REPRICER · BLOCKED TRAITS'),
        h('button', { class: 'btn sm', onclick: manageTraits }, `Manage traits (${blocked.length})`),
        h('small', { class: 'muted' }, 'pets with a blocked trait won\'t be repriced'),
        h('div', { class: 'grow' }), h('small', { class: 'muted' }, 'Last run: ' + ago(S.info && S.info.repricerLast))),
      LS.err ? h('div', { class: 'card x-lerr' }, h('b', null, 'Some listings could not be loaded'), h('pre', null, LS.err),
        h('button', { class: 'btn sm', onclick: load }, 'Try again')) : null,
      h('input', { class: 'x-search', type: 'search', placeholder: 'Search…', value: LS.q, oninput: e => { LS.q = e.target.value; clearTimeout(LS.qt); LS.qt = setTimeout(render, 250); } }),
      rows.length ? h('div', { class: 'x-lgrid' }, rows.map(card)) : h('div', { class: 'x-empty' }, LS.loading || !LS.data ? 'Loading…' : 'No offers in this state.'),
      LS.at ? h('small', { class: 'muted' }, 'Updated ' + ago(LS.at)) : null,
      h('details', { class: 'x-fold' }, h('summary', null, 'Repricer settings & log'),
        h('div', { class: 'card', style: { marginTop: '10px' } },
          h('div', { class: 'grid g2' }, h('label', { class: 'f' }, 'Floor (% of first price)', num(rp.floorPct, v => saveSettings({ repricer: { floorPct: v } })))),
          h('div', { class: 'log', style: { marginTop: '10px' } }, (S.logs || []).filter(l => /\[Repricer\]/.test(l.msg)).slice(-40).map(l => h('div', { class: 'l-' + l.level }, `${new Date(l.t).toLocaleTimeString()} ${l.msg.replace('[Repricer] ', '')}`)))))));
};

// ============================== TEMPLATES =================================
// Two tabs: the Image Editor (drag-and-drop layout used by the image generator, stored in
// settings.imageTemplates / settings.activeImageTemplate) and the text presets for Quick Fill.
const IE = { tab: 'image', sel: 'pet', pet: '', mut: 'None', art: {}, artP: {}, saveT: null };
const ieClone = o => JSON.parse(JSON.stringify(o));
const ieRid = () => 'it' + Math.random().toString(36).slice(2, 10);
const ieFmt = v => String(Math.round(Number(v) * 10) / 10);
const IE_GUIDE = { shop: 'SHOP', gen: 'M/S', name: 'NAME', traits: 'TRAITS', pet: 'PET' };
const IE_SAMPLE = { name: 'Grabatron', mutation: 'None', gen: 78.1e6, traits: ['Taco'] };

PAGES.templates = async root => {
  const tabs = xPills([['image', 'Image Editor'], ['text', 'Text Templates']], IE.tab, v => { IE.tab = v; render(); });
  if (IE.tab === 'text') return textTemplatesTab(root, tabs);
  return imageEditorTab(root, tabs);
};

function textTemplatesTab(root, tabs) {
  const edit = (tp = {}) => {
    const f = { ...tp };
    modal(tp.id ? 'Edit template' : 'New template', h('div', { class: 'grid' },
      h('label', { class: 'f' }, 'Name', txt(f.name, v => f.name = v)),
      h('label', { class: 'f' }, 'Title', txt(f.title, v => f.title = v, { placeholder: '{name} {mutationTag}| {gen}' })),
      h('label', { class: 'f' }, 'Description', h('textarea', { value: f.description || '', style: { minHeight: '140px' }, onchange: e => f.description = e.target.value })),
      h('label', { class: 'f' }, 'Price (optional)', num(f.price ?? '', v => f.price = v)),
      h('small', { class: 'muted' }, 'Variables: {name} {mutation} {mutationTag} {gen} {genRaw} {traits} {rarity} {account}')), [
      { label: t('cancel') },
      { label: t('save'), cls: 'primary', fn: async () => { if (!f.name) { toast('Name required', 'error'); return false; } await M.call('templates:save', f); await refreshData(); render(); } }]);
  };
  const sample = { name: 'Grabatron', mutation: 'Gold', gen: 78.1e6, traits: ['Taco', 'Fire'], rarity: 'Secret' };
  const fill = tpl => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => ({ name: sample.name, mutation: sample.mutation, mutationTag: `[${sample.mutation}] `, gen: formatGen(sample.gen), genRaw: sample.gen, traits: sample.traits.join(', '), rarity: sample.rarity, account: 'alt1' }[k] ?? m));
  root.append(pageHead('templates', tabs, h('button', { class: 'btn primary', onclick: () => edit() }, '+ Template')),
    S.templates.length ? h('div', { class: 'grid g3' }, S.templates.map(tp => h('div', { class: 'card' },
      h('h3', null, tp.name, tp.price ? h('span', { class: 'pill gold' }, money(tp.price)) : null),
      h('div', { class: 'pet-name' }, fill(tp.title)),
      h('pre', { style: { whiteSpace: 'pre-wrap', color: 'var(--ink2)', fontFamily: 'inherit', maxHeight: '140px', overflow: 'auto' } }, fill(tp.description)),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => edit(tp) }, t('edit')), h('button', { class: 'btn sm danger', onclick: async () => { await M.call('templates:delete', tp.id); await refreshData(); render(); } }, t('delete')))))) :
      h('div', { class: 'card empty' }, 'No templates yet. Create one and use it from Quick Fill on Auto List.'));
}

function imageEditorTab(root, tabs) {
  const userList = () => (S.settings.imageTemplates || []).filter(x => x && x.id);
  let tpl = activeImageTemplate();
  const isUser = () => userList().some(x => x.id === tpl.id);
  const uniqName = (base, list = userList()) => { let n = base, i = 2; while (n === 'Default' || list.some(x => x.name === n)) n = `${base} ${i++}`; return n; };
  const withTpl = () => { const list = userList().map(x => (x.id === tpl.id ? ieClone(tpl) : x)); if (!list.some(x => x.id === tpl.id)) list.push(ieClone(tpl)); return list; };
  const saveNow = () => saveSettings({ imageTemplates: withTpl(), activeImageTemplate: tpl.id }).catch(e => toast(e.message, 'error'));
  const flush = async () => { if (IE.saveT) { clearTimeout(IE.saveT); IE.saveT = null; if (isUser()) await saveNow(); } };
  const commit = () => {
    S.settings.imageTemplates = withTpl(); S.settings.activeImageTemplate = tpl.id;
    clearTimeout(IE.saveT); IE.saveT = setTimeout(() => { IE.saveT = null; saveNow(); }, 300);
  };
  // Default is built in: the first edit makes an editable copy and switches to it
  const ensureEditable = () => {
    if (isUser()) return;
    tpl = { ...ieClone(tpl), id: ieRid(), name: uniqName('Custom') };
    S.settings.imageTemplates = withTpl(); S.settings.activeImageTemplate = tpl.id;
    toast(`Default is built-in — your edits are saved as "${tpl.name}"`, 'info', 5000);
    fillBar();
  };
  const edit = (fn, { props = false, layers = true } = {}) => { ensureEditable(); fn(tpl.layers); commit(); draw(); if (layers) fillLayers(); if (props) fillProps(); };

  // ---- preview pet + its game art -----------------------------------------
  const petNames = [...new Set(S.pets.map(p => p.name).filter(Boolean))];
  if (!IE.pet) IE.pet = petNames[0] || IE_SAMPLE.name;
  const findPet = n => S.pets.find(x => String(x.name).toLowerCase() === String(n).toLowerCase());
  const previewPet = () => {
    const p = findPet(IE.pet) || { ...IE_SAMPLE, name: IE.pet || IE_SAMPLE.name };
    return { name: p.name, gen: p.gen, traits: p.traits || [], rarity: p.rarity, mutation: IE.mut || 'None' };
  };
  const artKey = p => [p.name, p.mutation, (p.traits || []).join(',')].join('|');
  const getArt = pet => {
    const k = artKey(pet);
    if (!IE.artP[k]) IE.artP[k] = M.call('art:for', pet).catch(() => ({})).then(a => { IE.art[k] = a || {}; return IE.art[k]; });
    return IE.artP[k];
  };
  const previewOpts = (art) => {
    const pet = previewPet(), al = S.settings.autolist || {};
    const k = artKey(pet);
    if (!art && !IE.art[k]) getArt(pet).then(() => draw());
    return { pet, rarity: pet.rarity || xRarity(pet.name), ...(art || IE.art[k] || {}), shopName: al.shopName || '', recolor: al.recolorByMutation !== false, template: tpl };
  };

  // ---- canvas -------------------------------------------------------------
  const cv = h('canvas', { width: 600, height: 600, class: 'ie-cv' });
  const guides = h('div', { class: 'ie-guides' });
  const select = k => { IE.sel = k; fillLayers(); fillProps(); paintGuides(); };
  const stage = h('div', { class: 'ie-stage', onmousedown: e => { if (e.target === stage || e.target === guides || e.target === cv) select('bg'); } }, cv, guides);
  let boxes = {}, drawing = false, again = false;
  const draw = async () => {
    if (drawing) { again = true; return; }
    drawing = true;
    try {
      const r = await renderCardCanvas(previewOpts());
      const g = cv.getContext('2d'); g.clearRect(0, 0, 600, 600); g.drawImage(r.canvas, 0, 0);
      boxes = r.boxes; paintGuides(); paintHints();
    } catch (e) { console.error(e); } finally { drawing = false; if (again) { again = false; draw(); } }
  };
  const paintGuides = () => {
    guides.textContent = '';
    tpl.order.forEach((k, i) => {
      const b = boxes[k]; if (k === 'bg' || !b || !tpl.layers[k].visible) return;
      const P = 4, pc = v => (v / 6) + '%';
      guides.appendChild(h('div', {
        class: 'ie-guide' + (IE.sel === k ? ' on' : '') + (b.empty ? ' empty' : ''), title: IMG_LAYER_LABEL[k] + ' — drag to move',
        style: { left: pc(b.x - P), top: pc(b.y - P), width: pc(b.w + 2 * P), height: pc(b.h + 2 * P), zIndex: String(20 - i) },
        onmousedown: e => startDrag(e, k)
      }, h('span', null, IE_GUIDE[k] + (b.empty ? ' (no shop name)' : ''))));
    });
  };
  const startDrag = (e, k) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    if (IE.sel !== k) select(k);
    const r = stage.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, ox = tpl.layers[k].x, oy = tpl.layers[k].y;
    let moved = false, raf = 0;
    const snap = v => { v = Math.min(100, Math.max(0, v)); return Math.abs(v - 50) < 0.8 ? 50 : Math.round(v * 10) / 10; };
    const mv = ev => {
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 3) return;
      if (!moved) { moved = true; ensureEditable(); }
      tpl.layers[k].x = snap(ox + (ev.clientX - sx) / r.width * 100);
      tpl.layers[k].y = snap(oy + (ev.clientY - sy) / r.height * 100);
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); syncXY(); });
    };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); if (moved) { commit(); fillProps(); } };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  };

  // ---- layers panel -------------------------------------------------------
  const layersBox = h('div', { class: 'ie-layers' });
  const hintEls = {};
  const move = (k, d) => {
    ensureEditable();
    const o = tpl.order, i = o.indexOf(k), j = i + d;
    if (j < 0 || j >= o.length - 1) return;   // bg stays last
    [o[i], o[j]] = [o[j], o[i]]; commit(); fillLayers(); draw();
  };
  const fillLayers = () => {
    layersBox.textContent = '';
    tpl.order.forEach((k, i) => {
      const L = tpl.layers[k], movable = k !== 'bg';
      hintEls[k] = h('small', { class: 'ie-hint' });
      layersBox.appendChild(h('div', { class: 'ie-layer' + (IE.sel === k ? ' on' : '') + (L.visible ? '' : ' off'), onclick: () => select(k) },
        h('button', { class: 'ie-eye' + (L.visible ? ' vis' : ''), title: L.visible ? 'Visible — click to hide' : 'Hidden — click to show', onclick: e => { e.stopPropagation(); edit(l => { l[k].visible = !l[k].visible; }); } }),
        h('div', { class: 'ie-lmain' }, h('span', { class: 'ie-lname' }, IMG_LAYER_LABEL[k]), hintEls[k]),
        movable ? h('button', { class: 'ie-mv', title: 'Bring forward', disabled: i === 0, onclick: e => { e.stopPropagation(); move(k, -1); } }, '▲') : null,
        movable ? h('button', { class: 'ie-mv', title: 'Send backward', disabled: i >= tpl.order.length - 2, onclick: e => { e.stopPropagation(); move(k, 1); } }, '▼') : null));
    });
    paintHints();
  };
  const paintHints = () => {
    for (const k of IMG_LAYERS) {
      const el = hintEls[k], b = boxes[k], L = tpl.layers[k]; if (!el) continue;
      el.textContent = k === 'bg' ? '600×600' : b ? `${Math.round(b.w)}×${Math.round(b.h)} · ${ieFmt(L.x)},${ieFmt(L.y)}` : `${ieFmt(L.x)},${ieFmt(L.y)}`;
    }
  };

  // ---- properties panel ---------------------------------------------------
  const propsBox = h('div', { class: 'ie-panel ie-props' });
  let xyRefs = {};
  const syncXY = () => { const L = tpl.layers[IE.sel]; if (xyRefs.x) xyRefs.x.value = ieFmt(L.x); if (xyRefs.y) xyRefs.y.value = ieFmt(L.y); };
  const fillProps = () => {
    const k = IE.sel, L = tpl.layers[k];
    propsBox.textContent = ''; xyRefs = {};
    const row = (label, ...ctrl) => h('div', { class: 'ie-row' }, h('span', null, label), ...ctrl);
    const numIn = (key, min, max) => h('input', {
      type: 'number', class: 'ie-num', value: ieFmt(L[key]), min, max, step: 0.1,
      onchange: e => { const v = Number(e.target.value); if (e.target.value === '' || !isFinite(v)) return; edit(l => { l[k][key] = Math.min(max, Math.max(min, v)); }); }
    });
    const range = (label, key, min, max, step = 1) => {
      const val = h('b', { class: 'ie-val' }, ieFmt(L[key]));
      return row(label, h('input', { type: 'range', min, max, step, value: L[key], oninput: e => { val.textContent = ieFmt(e.target.value); edit(l => { l[k][key] = Number(e.target.value); }); } }), val);
    };
    const toggle = (label, key) => row(label, sw(L[key], v => edit(l => { l[k][key] = v; })));
    const color = (label, key) => row(label, h('input', { type: 'color', value: L[key], oninput: e => edit(l => { l[k][key] = e.target.value; }) }));
    propsBox.append(h('div', { class: 'ie-ptitle' }, IMG_LAYER_LABEL[k].toUpperCase()));
    if (k !== 'bg') {
      xyRefs.x = numIn('x', 0, 100); xyRefs.y = numIn('y', 0, 100);
      propsBox.append(row('X %', xyRefs.x), row('Y %', xyRefs.y));
    }
    if (k === 'pet') {
      propsBox.append(range('Max width %', 'w', 10, 100, 0.5), range('Max height %', 'h', 10, 100, 0.5));
    } else if (k === 'traits') {
      propsBox.append(range('Icon size', 'size', 20, 140), range('Gap', 'gap', 0, 60), toggle('Mutation block', 'mutation'));
    } else if (k === 'shop' || k === 'gen' || k === 'name') {
      if (k === 'shop') {
        const al = S.settings.autolist || {};
        propsBox.append(row('Shop name', h('input', { type: 'text', value: al.shopName || '', placeholder: 'e.g. Zotac Shop', onchange: async e => { await saveSettings({ autolist: { shopName: e.target.value.trim() } }); draw(); } })));
      }
      propsBox.append(range('Font size', 'size', 8, 120));
      if (k === 'gen') propsBox.append(toggle('Gold gradient', 'gradient'));
      propsBox.append(color('Colour', 'color'), toggle('Stroke', 'stroke'), toggle('Uppercase', 'upper'));
      if (k === 'shop') propsBox.append(h('small', { class: 'ie-note' }, 'Only drawn when a shop name is set.'));
    } else if (k === 'bg') {
      const al = S.settings.autolist || {};
      propsBox.append(row('Mode', sel([['dark', 'Dark (default)'], ['glow', 'Mutation colour glow'], ['solid', 'Solid colour'], ['image', 'Custom image']], L.mode, v => edit(l => { l.bg.mode = v; }, { props: true }))));
      if (L.mode === 'solid') propsBox.append(color('Colour', 'color'));
      if (L.mode === 'image') {
        const pick = () => {
          const inp = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
          inp.onchange = () => {
            const f = inp.files[0]; inp.remove(); if (!f) return;
            const fr = new FileReader();
            fr.onload = async () => {
              const img = await loadImg(fr.result); if (!img) return toast('Could not read that image', 'error');
              // store a 600x600 cover crop, not the original file, to keep settings small
              const c = document.createElement('canvas'); c.width = c.height = 600;
              const r = Math.max(600 / img.width, 600 / img.height);
              c.getContext('2d').drawImage(img, (600 - img.width * r) / 2, (600 - img.height * r) / 2, img.width * r, img.height * r);
              edit(l => { l.bg.image = c.toDataURL('image/jpeg', 0.9); }, { props: true });
            };
            fr.readAsDataURL(f);
          };
          document.body.appendChild(inp); inp.click();
        };
        propsBox.append(L.image ? h('img', { class: 'ie-bgthumb', src: L.image }) : h('small', { class: 'ie-note' }, 'No image chosen — the dark background is used.'),
          h('div', { class: 'row', style: { margin: '6px 0 10px' } }, h('button', { class: 'btn sm', onclick: pick }, L.image ? 'Change image…' : 'Choose image…'),
            L.image ? h('button', { class: 'btn sm danger', onclick: () => edit(l => { l.bg.image = ''; }, { props: true }) }, 'Remove') : null));
      }
      propsBox.append(row('Recolor pet by mutation', sw(al.recolorByMutation !== false, async v => { await saveSettings({ autolist: { recolorByMutation: v } }); draw(); })),
        h('small', { class: 'ie-note' }, 'Tints the pet picture with the mutation colours (shared with Auto List).'));
    }
    if (k !== 'bg') propsBox.append(h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn sm', onclick: () => edit(l => { l[k].x = 50; }, { props: true }) }, 'Center')));
  };

  // ---- toolbar ------------------------------------------------------------
  const bar = h('div', { class: 'ie-bar' });
  const fillBar = () => {
    bar.textContent = '';
    bar.append(
      sel([['default', 'Default'], ...userList().map(x => [x.id, x.name])], tpl.id, async v => { await flush(); await saveSettings({ activeImageTemplate: v }); render(); }, { class: 'ie-tsel' }),
      h('button', { class: 'btn sm', onclick: async () => {
        const name = await promptBox('New image template', 'Name', uniqName('Template ' + (userList().length + 1))); if (name === null) return;
        await flush();
        const nt = { ...normImageTemplate(DEFAULT_IMAGE_TEMPLATE), id: ieRid(), name: uniqName(name.trim() || 'Template') };
        await saveSettings({ imageTemplates: [...userList(), nt], activeImageTemplate: nt.id }); render();
      } }, '+ New'),
      h('button', { class: 'btn sm', onclick: async () => {
        if (!isUser()) return toast('Default is built-in and can\'t be renamed — use + New', 'info');
        const name = await promptBox('Rename template', 'Name', tpl.name); if (name === null || !name.trim()) return;
        tpl.name = uniqName(name.trim(), userList().filter(x => x.id !== tpl.id)); commit(); await flush(); render();
      } }, 'Rename'),
      h('button', { class: 'btn sm danger', onclick: async () => {
        if (!isUser()) return toast('Default is built-in and can\'t be deleted', 'info');
        if (!(await confirmBox(`Delete image template "${tpl.name}"? Generated images go back to Default.`))) return;
        clearTimeout(IE.saveT); IE.saveT = null;
        await saveSettings({ imageTemplates: userList().filter(x => x.id !== tpl.id), activeImageTemplate: 'default' }); render();
      } }, 'Delete'),
      h('button', { class: 'btn sm', onclick: () => {
        if (!isUser()) return toast('Default already uses the default layout', 'info');
        const d = normImageTemplate(DEFAULT_IMAGE_TEMPLATE); tpl.layers = d.layers; tpl.order = d.order;
        commit(); fillLayers(); fillProps(); draw(); toast('Layout reset', 'good', 1800);
      } }, 'Reset layout'),
      h('button', { class: 'btn sm', onclick: () => {
        const slug = tpl.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'template';
        download(`zotac-image-template-${slug}.json`, JSON.stringify({ zotacImageTemplate: 1, name: tpl.name, order: tpl.order, layers: tpl.layers }, null, 2));
      } }, 'Export'),
      h('button', { class: 'btn sm', onclick: async () => {
        const text = await readFileText('.json'); if (!text) return;
        let j; try { j = JSON.parse(text); } catch { return toast('That file isn\'t valid JSON', 'error'); }
        const arr = (Array.isArray(j) ? j : [j]).filter(x => x && typeof x === 'object' && x.layers && typeof x.layers === 'object');
        if (!arr.length) return toast('No image template found in that file', 'error');
        await flush();
        const list = userList().slice(); let last = null;
        for (const x of arr) { const nt = normImageTemplate(x); nt.id = ieRid(); nt.name = uniqName(String(x.name || 'Imported').slice(0, 40), list); list.push(nt); last = nt; }
        await saveSettings({ imageTemplates: list, activeImageTemplate: last.id });
        toast(`Imported ${arr.length} template${arr.length > 1 ? 's' : ''}`, 'good'); render();
      } }, 'Import'));
  };

  // ---- canvas toolbar -----------------------------------------------------
  const mutOpts = ['None', ...mutationNames()];
  const mutSel = sel(mutOpts, IE.mut, v => { IE.mut = v; draw(); }, { class: 'ie-mut', title: 'Preview a mutation' });
  const search = h('input', {
    type: 'search', class: 'ie-search', placeholder: 'Search pet…', list: 'ie-pets', value: IE.pet,
    onchange: e => {
      IE.pet = e.target.value.trim() || petNames[0] || IE_SAMPLE.name;
      const p = findPet(IE.pet);
      if (p) { const m = mutOpts.find(o => o.toLowerCase() === String(p.mutation || 'none').toLowerCase()); IE.mut = m || 'None'; mutSel.value = IE.mut; }
      draw();
    }
  });
  const previewBtn = h('button', { class: 'btn sm primary', onclick: async () => {
    const url = await run(async () => renderListingImage(previewOpts(await getArt(previewPet()))));
    if (url) modal(`Preview — ${tpl.name}`, h('div', null, h('img', { src: url, class: 'ie-prev-img' }), h('small', { class: 'muted' }, 'The real 600×600 image the generator makes with this template.')), [{ label: t('close') }]);
  } }, 'Preview');

  root.append(
    h('div', { class: 'ie-head' },
      h('div', null, h('h1', null, 'Image Editor'), h('p', null, 'Drag-and-drop template for the image generator — the selected template is used for every generated image.')),
      h('div', { class: 'grow' }), tabs),
    bar,
    h('div', { class: 'ie-grid' },
      h('div', { class: 'ie-panel' }, h('div', { class: 'ie-ptitle' }, 'LAYERS'), h('small', { class: 'ie-tip' }, 'Click to select · top renders in FRONT'), layersBox),
      h('div', { class: 'ie-panel ie-center' },
        h('div', { class: 'ie-ctop' }, h('div', { class: 'ie-ptitle' }, 'CANVAS'), search, h('datalist', { id: 'ie-pets' }, petNames.map(n => h('option', { value: n }))), mutSel, previewBtn),
        stage,
        h('small', { class: 'ie-foot' }, 'Drag elements to position · dashed guides don\'t appear in the final image · Preview shows the real result')),
      propsBox));
  fillBar(); fillLayers(); fillProps(); draw();
}

// ============================== CONFIRM AUTO-LIST ==========================
// Review window before publishing: prices any unpriced pets first (same pricer the run
// uses), groups identical pets the way stock detection does (one listing, ×quantity) and
// shows listed value, the 15% Eldorado fee and what you receive. Resolves true to list.
function confirmAutoList(ids) {
  return new Promise(async resolve => {
    const pets = ids.map(id => S.pets.find(p => p.id === id)).filter(Boolean);
    const al = S.settings.autolist || {};
    const special = (al.specialTraits || []).map(t => String(t).toLowerCase());
    const prices = {};
    let done = false;
    const body = h('div', { class: 'x-cf' });
    // resolves with the prices shown, so the run lists exactly these (no second pricing pass)
    const listBtn = h('button', { class: 'btn primary x-cf-go', disabled: true, onclick: () => { done = true; close(); resolve({ prices: { ...prices } }); } }, '…');
    const close = modal('', body, []);
    const root = body.closest('.modal');
    if (root) { root.classList.add('x-cf-modal'); const t = root.querySelector('h2'); if (t) t.remove(); const a = root.querySelector('.actions'); if (a) a.remove(); }
    const bg = root && root.parentElement;
    if (bg) new MutationObserver((_, o) => { if (!bg.isConnected) { o.disconnect(); if (!done) resolve(false); } }).observe(document.body, { childList: true, subtree: true });

    const draw = (status) => {
      // one row per listing, grouped exactly like the run (name, mutation, gen/s, traits)
      const groups = new Map();
      for (const p of pets) {
        const nk = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const k = [nk(p.name), nk(p.mutation || 'None'), Math.round(Number(p.gen) || 0), (p.traits || []).map(nk).sort().join(',')].join('|');
        if (!groups.has(k)) groups.set(k, { p, n: 0, price: null });
        const g = groups.get(k); g.n++;
        const pr = prices[p.id];
        if (pr != null && (g.price == null || pr < g.price)) g.price = pr;
      }
      const rows = [...groups.values()].sort((a, b) => (b.price || 0) * b.n - (a.price || 0) * a.n);
      const value = rows.reduce((s, g) => s + (g.price || 0) * g.n, 0);
      const fee = value * 0.15;
      const unpriced = pets.filter(p => !(prices[p.id] > 0)).length;
      const listable = pets.length - unpriced;
      body.textContent = '';
      body.append(
        h('div', { class: 'x-cf-head' }, h('h2', null, h('span', { class: 'x-cf-tag' }, '🏷'), 'Confirm Auto-List'),
          h('p', null, 'Review before publishing to Eldorado — this creates real listings.')),
        h('div', { class: 'x-cf-tiles' },
          h('div', { class: 'x-cf-tile' }, h('b', { class: 'gold' }, String(pets.length)), h('small', null, 'PETS')),
          h('div', { class: 'x-cf-tile' }, h('b', null, money(value)), h('small', null, 'LISTED VALUE')),
          h('div', { class: 'x-cf-tile good' }, h('b', null, money(value - fee)), h('small', null, 'YOU RECEIVE'))),
        h('div', { class: 'x-cf-fee' }, h('span', null, 'Eldorado fee · 15%'), h('b', null, '-' + money(fee))),
        h('div', { class: 'x-cf-lh' }, h('span', null, `${rows.length} LISTINGS`), h('span', null, 'SUBTOTAL')),
        h('div', { class: 'x-cf-list' }, rows.map(g => {
          const mut = g.p.mutation && !/^(none|normal)$/i.test(g.p.mutation) ? g.p.mutation : null;
          const review = special.length && (g.p.traits || []).some(t => special.includes(String(t).toLowerCase()));
          return h('div', { class: 'x-cf-row' + (g.price ? '' : ' nop') },
            h('b', { class: 'x-cf-name' }, g.p.name),
            mut ? (() => { const c = xMutColor(mut) || '#f2b631'; return h('span', { class: 'x-cf-mut', style: { color: c, background: c + '2e', border: '1px solid ' + c + '66' } }, mut); })() : h('span'),
            h('span', { class: 'x-cf-gen' }, formatGen(g.p.gen)),
            h('span', { class: 'x-cf-qty' }, '×' + g.n),
            h('b', { class: 'x-cf-sub' }, g.price ? money(g.price * g.n) : (review ? 'set price' : (status === 'pricing' ? '…' : 'no price'))));
        })),
        status === 'pricing' ? h('div', { class: 'x-cf-note' }, `Pricing… ${Object.keys(prices).length}/${pets.length}`) :
          unpriced ? h('div', { class: 'x-cf-note warn' }, `${unpriced} pet(s) have no price and will be skipped.`) : '',
        h('div', { class: 'x-cf-btns' }, h('button', { class: 'btn x-cf-cancel', onclick: () => close() }, 'Cancel'), listBtn));
      listBtn.disabled = status === 'pricing' || !listable;
      listBtn.textContent = status === 'pricing' ? 'Pricing…' : `✓ List ${listable} pets`;
    };

    // prices: locked/manual ones as they are, the rest from the live market (like the run)
    draw('pricing');
    for (const p of pets) {
      const review = special.length && (p.traits || []).some(t => special.includes(String(t).toLowerCase()));
      if (p.price > 0 && (p.priceLocked || review || al.priceMode !== 'auto')) prices[p.id] = p.price;
      else if (review) prices[p.id] = null;
      else if (al.priceMode === 'fixed') prices[p.id] = al.fixedPrice;
      else {
        try { const r = await M.call('price:smart', p.id); prices[p.id] = r && r.price ? r.price : null; if (r && r.price) M.call('pets:update', [p.id], { price: r.price, priceBasis: r.basis }); }
        catch { prices[p.id] = null; }
      }
      if (!bg || !bg.isConnected) return;   // cancelled while pricing
      draw('pricing');
    }
    draw('ready');
  });
}

// ============================== ROBLOX ACCOUNTS ===========================
// pictures for the pet cards (wiki / game art, shrunk and cached by main)
const ART_THUMBS = { pets: {}, traits: {}, mutations: {}, asked: new Set() };
// pictures:false skips the (slow) pet pictures, e.g. Auto List only needs trait/mutation icons.
// Resolves true when something new was fetched.
async function loadThumbs(pets, { pictures = true } = {}) {
  const want = { pets: [], traits: [], mutations: [] };
  for (const p of pets) {
    if (pictures && !ART_THUMBS.asked.has('p:' + p.name)) { ART_THUMBS.asked.add('p:' + p.name); want.pets.push(p.name); }
    for (const t of p.traits || []) if (!ART_THUMBS.asked.has('t:' + t)) { ART_THUMBS.asked.add('t:' + t); want.traits.push(t); }
    const m = p.mutation && !/^(none|normal)$/i.test(p.mutation) ? p.mutation : null;
    if (m && !ART_THUMBS.asked.has('m:' + m)) { ART_THUMBS.asked.add('m:' + m); want.mutations.push(m); }
  }
  if (!want.pets.length && !want.traits.length && !want.mutations.length) return false;
  try {
    const r = await M.call('art:thumbs', want);
    Object.assign(ART_THUMBS.pets, r.pets); Object.assign(ART_THUMBS.traits, r.traits); Object.assign(ART_THUMBS.mutations, r.mutations || {});
    // nothing yet (still downloading / not scanned): ask again on the next render
    for (const [k, v] of Object.entries(r.pets || {})) if (!v) ART_THUMBS.asked.delete('p:' + k);
    for (const [k, v] of Object.entries(r.traits || {})) if (!v) ART_THUMBS.asked.delete('t:' + k);
    for (const [k, v] of Object.entries(r.mutations || {})) if (!v) ART_THUMBS.asked.delete('m:' + k);
    return [...Object.values(r.pets || {}), ...Object.values(r.traits || {}), ...Object.values(r.mutations || {})].some(Boolean);
  } catch { return false; /* cards fall back to initials */ }
}
const XRANGES = [['', 'All ranges'], ['0-1e6', '< 1M/s'], ['1e6-1e7', '1M – 10M/s'], ['1e7-1e8', '10M – 100M/s'], ['1e8-1e9', '100M – 1B/s'], ['1e9-1e15', '1B+/s']];
const RA = { filter: { account: '', q: '', mutation: '', min: '', max: '', range: '' }, view: 'account', tab: 'accounts', sort: 'desc', stock: false, org: 'name', open: null, limit: 60, showEmpty: false };
PAGES.accounts = async root => {
  const f = RA.filter;
  const LST = {}; try { for (const x of await M.call('launcher:status')) LST[x.id] = x; } catch { /* old backend */ }
  const launch = async (a, force) => {
    const r = await run(() => M.call('accounts:launch', a.id, force));
    if (!r) return;
    if (r.skipped === 'already online') return toast(`${a.username} is already in game`, 'info');
    if (r.skipped) { if (await confirmBox(`${a.username}: ${r.skipped}. Launch it again?`)) return launch(a, true); return; }
    toast(`Launching ${a.username} into your private server`, 'good');
  };
  if (RA.open === null) RA.open = new Set();
  const [rLo, rHi] = f.range ? f.range.split('-').map(Number) : [0, 0];
  const minG = Math.max(parseGen(f.min), rLo || 0), maxG = f.max ? parseGen(f.max) : 0, hiG = rHi || 0;
  const live = S.pets.filter(p => p.status !== 'sold');
  const petOk = p => (!f.q || p.name.toLowerCase().includes(f.q.toLowerCase()))
    && (!f.mutation || String(p.mutation).toLowerCase() === f.mutation.toLowerCase())
    && (!minG || p.gen >= minG) && (!maxG || p.gen <= maxG) && (!hiG || p.gen < hiG);
  const petsFiltered = live.filter(petOk);
  await loadThumbs(petsFiltered);
  const sortPets = list => [...list].sort((a, b) => RA.sort === 'asc' ? a.gen - b.gen : b.gen - a.gen);
  const petFilterOn = !!(f.q || f.mutation || f.min || f.max || f.range);

  let accts = S.accounts.filter(a => !f.account || a.username.toLowerCase().includes(f.account.toLowerCase()));
  const countOf = a => live.filter(p => p.accountId === a.id).length;
  // every logged-in account (saved cookie) shows, also with no stock left; the rest via Show others
  const shownAcct = a => a.hasCookie;
  const emptyCount = accts.filter(a => !shownAcct(a)).length;
  if (!RA.showEmpty && !f.account) accts = accts.filter(shownAcct);
  if (RA.org === 'pets') accts = [...accts].sort((a, b) => countOf(b) - countOf(a));
  else if (RA.org === 'free') accts = [...accts].sort((a, b) => countOf(a) - countOf(b));
  else accts = [...accts].sort((a, b) => a.username.localeCompare(b.username));

  const editAcct = (a = {}) => {
    const x = { ...a };
    modal(a.id ? 'Edit account' : 'Add Roblox account', h('div', { class: 'grid' },
      h('label', { class: 'f' }, 'Roblox username', txt(x.username, v => x.username = v)),
      h('label', { class: 'f' }, 'Note', txt(x.note, v => x.note = v)),
      h('div', { class: 'row' }, h('button', { class: 'btn sm primary', onclick: async () => {
        const r = await run(() => M.call('accounts:loginBrowser', a.id || null));
        if (r) { toast(`Logged in as ${r.username} — cookie saved`, 'good'); $('#modal-root').textContent = ''; await refreshData(); render(); }
      } }, a.id ? 'Login via Browser (refresh cookie)' : 'Login via Browser'), h('small', { class: 'muted' }, 'Sign in on roblox.com; the cookie is captured automatically.')),
      h('label', { class: 'f' }, 'Or paste the cookie (.ROBLOSECURITY) — used by Start / auto-launch for delivery',
        h('input', { type: 'password', placeholder: a.hasCookie ? 'saved ✓ — paste a new one to replace' : '_|WARNING:-DO-NOT-SHARE-THIS…', onchange: e => x.cookie = e.target.value.trim() })),
      h('small', { class: 'muted' }, 'Stored encrypted on this PC only (Windows DPAPI). Never shown again or sent anywhere except roblox.com.'),
      a.hasCookie ? h('label', { class: 'row' }, h('input', { type: 'checkbox', onchange: e => x.clearCookie = e.target.checked }), ' Remove saved cookie') : null), [
      { label: t('cancel') },
      { label: t('save'), cls: 'primary', fn: async () => {
        if (!x.username && !x.cookie) return false;
        const { cookie, clearCookie, ...acct } = x;
        const saved = acct.username ? await run(() => M.call('accounts:save', acct)) : await run(() => M.call('accounts:save', { ...acct, username: '' }));
        if (!saved) return false;
        if (cookie) { const r = await run(() => M.call('accounts:setCookie', saved.id, cookie)); if (r) toast(`Cookie saved for ${r.username}`, 'good'); }
        else if (clearCookie) await run(() => M.call('accounts:setCookie', saved.id, ''), 'Cookie removed');
        await refreshData(); render();
      } }]);
  };
  const addExpense = async () => {
    const label = await promptBox('Add expense', 'What was it?'); if (!label) return;
    const amount = Number(await promptBox('Add expense', 'Amount $')); if (!amount) return;
    await M.call('expenses:save', { label, amount, date: new Date().toISOString() }); await refreshData(); render();
  };
  const markSold = async p => { const pr = await promptBox('Mark as sold (sold outside Zotac)', `Sale price $${p.offerId ? ' — the Eldorado offer stays live, delete it there if needed' : ''}`, p.price || ''); if (pr === null) return; await M.call('pets:markSold', [p.id], pr); await refreshData(); render(); };

  // group identical pets when "Stock" is on
  const stack = list => {
    if (!RA.stock) return list.map(p => ({ p, n: 1 }));
    const m = new Map();
    for (const p of list) { const k = p.name + '|' + p.mutation; if (m.has(k)) m.get(k).n++; else m.set(k, { p, n: 1 }); }
    return [...m.values()];
  };
  const petCard = ({ p, n }) => {
    const rar = p.rarity || xRarity(p.name);
    const gc = xMutColor(p.mutation) || RARITY_COLORS[rar] || '#cfd4dc';
    const pic = ART_THUMBS.pets[p.name];
    return h('div', { class: 'x-pcard', style: { '--gc': gc } },
      h('div', { class: 'x-pimg' }, h('div', { class: 'x-part', style: { background: `radial-gradient(circle at 50% 40%, ${gc}44, transparent 70%)` } },
          pic ? h('img', { class: 'x-ppic', src: pic, alt: p.name }) : xInitials(p.name)),
        n > 1 ? h('span', { class: 'x-pn' }, '×' + n) : null,
        p.status === 'listed' ? h('span', { class: 'x-plisted' }, 'LISTED') : null,
        (p.traits || []).length ? h('div', { class: 'x-ptr' }, (p.traits || []).slice(0, 6).map(tr => ART_THUMBS.traits[tr]
          ? h('img', { class: 'x-ptri', src: ART_THUMBS.traits[tr], title: tr, alt: tr })
          : h('span', { title: tr }, String(tr).slice(0, 2)))) : null),
      h('div', { class: 'x-pname', title: p.name }, p.name),
      h('div', { class: 'x-pgen' }, formatGen(p.gen)),
      h('div', { class: 'x-pmut' }, xDot(p.mutation)),
      h('button', { class: 'x-sold', onclick: () => markSold(p) }, 'Mark as Sold'));
  };
  const grid = (list, limitKey) => {
    const items = stack(sortPets(list));
    const lim = RA.limit * (RA['m' + limitKey] || 1);
    return h('div', null, h('div', { class: 'x-pgrid' }, items.slice(0, lim).map(petCard)),
      items.length > lim ? h('div', { style: { textAlign: 'center', margin: '10px' } }, h('button', { class: 'btn sm', onclick: () => { RA['m' + limitKey] = (RA['m' + limitKey] || 1) + 1; render(); } }, `Show more (${items.length - lim} left)`)) : null);
  };

  const startAcct = async a => {
    const ids = live.filter(p => p.accountId === a.id && p.status === 'available').map(p => p.id);
    if (!ids.length) return toast('No available pets on this account', 'error');
    if (!S.me) return toast('Log in to Eldorado first (Account page)', 'error');
    if (!a.hasCookie) return toast(`${a.username} is not logged in: Zotac could not deliver its pets`, 'error');
    const ok = await confirmAutoList(ids); if (!ok) return;
    await run(() => M.call('autolist:start', ids, { prices: ok.prices })); S.listerRunning = true; toast('Auto List started', 'good');
  };
  const accountRow = a => {
    const mine = live.filter(p => p.accountId === a.id);
    const shown = petsFiltered.filter(p => p.accountId === a.id);
    const open = RA.open.has(a.id);
    return h('div', { class: 'x-arow' },
      h('div', { class: 'x-ahead', onclick: () => { open ? RA.open.delete(a.id) : RA.open.add(a.id); render(); } },
        h('span', { class: 'x-drag' }, '⠿'),
        a.avatar ? h('img', { class: 'x-aava', src: a.avatar }) : h('div', { class: 'x-aava ph' }, a.username[0] ? a.username[0].toUpperCase() : '?'),
        h('span', { class: 'x-on' + ((LST[a.id] || {}).online ? ' on' : ''), title: (LST[a.id] || {}).online ? 'Delivery script online' : 'Not in game' }),
        h('b', null, '@' + a.username), h('small', { class: 'muted' }, a.robloxUserId ? 'ID: ' + a.robloxUserId : (a.note || '')),
        h('div', { class: 'grow' }),
        // pet count only: each base has its own slot cap (seen 19-24), the game shows it in the trade window
        h('span', { class: 'x-slot' }, h('i'), `${mine.length} pets`),
        h('button', { class: 'x-ib', title: 'Copy username', onclick: e => { e.stopPropagation(); xCopy(a.username, 'Username copied'); } }, '⎘'),
        h('button', { class: 'x-ab', title: 'List this account\'s available pets on Eldorado', onclick: e => { e.stopPropagation(); startAcct(a); } }, 'List'),
        h('button', { class: 'x-ab start', title: a.hasCookie ? 'Launch Roblox on this account (private server)' : 'Add the account cookie first (✎)', disabled: !a.hasCookie, onclick: e => { e.stopPropagation(); launch(a); } }, '▶ Start'),
        h('button', { class: 'x-ib', title: 'Edit', onclick: e => { e.stopPropagation(); editAcct(a); } }, '✎'),
        h('button', { class: 'x-ib del', title: 'Remove account', onclick: async e => { e.stopPropagation(); if (await confirmBox(`Remove ${a.username} from Zotac? Its unlisted pets go with it. (Not possible while it has listed pets or sold pets not delivered yet.)`)) { if (await run(() => M.call('accounts:delete', a.id))) { await refreshData(); render(); } } } }, '🗑'),
        h('span', { class: 'x-caret' }, open ? '▴' : '▾')),
      open ? (shown.length ? grid(shown, a.id) : h('div', { class: 'x-empty sm' }, mine.length ? 'No pets match the filters.' : 'No pets on this account yet.')) : null);
  };

  // ---- Account Settings tab (money + account management) ----
  const settingsTab = () => {
    const gross = S.sales.filter(s => !/cancel|refund/i.test(s.state || '')).reduce((a, s) => a + (Number(s.price) || 0), 0), fee = gross * 0.15;
    const expenses = S.pets.reduce((a, p) => a + (Number(p.cost) || 0), 0) + S.expenses.reduce((a, e) => a + (Number(e.amount) || 0), 0);
    const net = gross - fee - expenses;
    const L = S.settings.launcher || {};
    const setL = patch => saveSettings({ launcher: patch });
    const launcherCard = h('div', { class: 'x-panel', style: { marginBottom: '12px' } },
      h('div', { class: 'x-ptitle' }, h('span', { class: 'x-glyph' }, '▶'), 'ACCOUNT LAUNCHER'),
      h('p', { class: 'x-ptext' }, 'Start opens Roblox on that account from its saved cookie. With auto-launch on, a delivery job for an account whose script is offline launches it automatically. Put the delivery script in your executor\'s autoexec so it runs on join.'),
      !String(L.privateServer || '').trim() ? h('div', { class: 'card', style: { borderColor: 'rgba(240, 82, 82, .5)', color: 'var(--bad)', margin: '8px 0' } },
        '⚠ No private server link: Zotac will not launch any account (it never sends a stock account into a public server). Paste your private server link below.') : null,
      h('div', { class: 'grid g2' },
        h('label', { class: 'f' }, 'Private server link (share link or ?privateServerLinkCode= link)', h('input', { type: 'password', value: L.privateServer || '', placeholder: 'https://www.roblox.com/share?code=…&type=Server', onchange: e => setL({ privateServer: e.target.value.trim() }) })),
        h('label', { class: 'f' }, 'Roblox executable (empty = default Roblox / Bloxstrap handler)', txt(L.exePath, v => setL({ exePath: v.trim() }), { placeholder: 'C:\\…\\RobloxPlayerBeta.exe' }))),
      setting('Auto-launch for delivery', 'Launch the stock account when an order needs it and its script is not online', sw(L.autoLaunch !== false, v => setL({ autoLaunch: v }))),
      setting('Multi-instance', 'Hold Roblox\'s single-instance lock so several accounts can run together', sw(L.multiInstance !== false, v => setL({ multiInstance: v }))),
      setting('Close game after delivery', 'The stock account\'s Roblox closes 15s after its last delivery; it is launched again for the next order', sw(L.closeAfterDelivery !== false, v => setL({ closeAfterDelivery: v }))),
      setting('Relaunch cooldown (s)', 'Do not relaunch the same account within this time', num(L.cooldownSec || 120, v => setL({ cooldownSec: Number(v) || 120 }))));
    return h('div', null, launcherCard,
      h('div', { class: 'x-tiles' }, xTile('GROSS REVENUE', money(gross), 'x-green'), xTile('REVENUE -15%', money(gross - fee)),
        h('div', { class: 'x-tile x-red' }, h('div', { class: 'x-tile-b' }, h('div', { class: 'x-tile-k' }, 'EXPENSES'), h('div', { class: 'x-tile-v' }, money(expenses)), h('div', { class: 'x-tile-s' }, h('a', { href: '#', onclick: e => { e.preventDefault(); addExpense(); } }, '+ add expense')))),
        xTile('NET PROFIT', money(net), net >= 0 ? 'x-green' : 'x-red')),
      h('div', { class: 'x-agrid' }, S.accounts.map(a => {
        const ap = S.pets.filter(p => p.accountId === a.id);
        return h('div', { class: 'x-panel' }, h('div', { class: 'user-card' }, a.avatar ? h('img', { src: a.avatar }) : h('div', { class: 'ph' }),
          h('div', { class: 'grow' }, h('b', null, a.username), h('small', null, a.note || (a.robloxUserId ? 'ID ' + a.robloxUserId : ''))),
          h('button', { class: 'btn sm ghost', onclick: () => editAcct(a) }, '✎')),
          h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'pill' }, `${ap.filter(p => p.status !== 'sold').length} pets`), h('span', { class: 'pill gold' }, `${ap.filter(p => p.status === 'listed').length} listed`), h('span', { class: 'pill good' }, `${ap.filter(p => p.status === 'sold').length} sold`)));
      })),
      S.accounts.length ? null : h('div', { class: 'x-empty' }, 'No accounts yet. Import a JSON or add one.'));
  };

  const body = RA.tab === 'settings' ? settingsTab() : h('div', null,
    h('div', { class: 'x-filters' },
      h('input', { type: 'search', placeholder: 'Username...', value: f.account, onchange: e => { f.account = e.target.value; render(); } }),
      h('input', { type: 'search', placeholder: 'Pet name...', value: f.q, onchange: e => { f.q = e.target.value; render(); } }),
      h('input', { type: 'text', placeholder: 'M/s Min', value: f.min, style: { width: '90px' }, onchange: e => { f.min = e.target.value; render(); } }),
      h('input', { type: 'text', placeholder: 'M/s Max', value: f.max, style: { width: '90px' }, onchange: e => { f.max = e.target.value; render(); } }),
      sel([['', 'All mutations'], ['None', 'None'], ...mutationNames().map(m => [m, m])], f.mutation, v => { f.mutation = v; render(); }),
      sel(XRANGES, f.range, v => { f.range = v; render(); })),
    h('div', { class: 'x-viewbar' },
      h('div', { class: 'x-seg' }, h('button', { class: RA.view === 'all' ? 'on' : '', onclick: () => { RA.view = 'all'; render(); } }, 'All Pets'), h('button', { class: RA.view === 'account' ? 'on' : '', onclick: () => { RA.view = 'account'; render(); } }, 'By Account')),
      RA.view === 'account' ? [
        h('button', { class: 'x-chip' + (RA.sort === 'asc' ? ' on' : ''), onclick: () => { RA.sort = 'asc'; render(); } }, '↑ Ascending'),
        h('button', { class: 'x-chip' + (RA.sort === 'desc' ? ' on' : ''), onclick: () => { RA.sort = 'desc'; render(); } }, '↓ Descending'),
        h('button', { class: 'x-chip' + (RA.stock ? ' on' : ''), onclick: () => { RA.stock = !RA.stock; render(); } }, '◈ Stock'),
        h('button', { class: 'x-chip', onclick: () => { RA.open = new Set(); render(); } }, '⊟ Collapse'),
        h('button', { class: 'x-chip', onclick: () => { RA.open = new Set(S.accounts.map(a => a.id)); render(); } }, '⊞ Expand'),
        emptyCount ? h('button', { class: 'x-chip' + (RA.showEmpty ? ' on' : ''), title: 'Accounts that are not logged in (no saved cookie)', onclick: () => { RA.showEmpty = !RA.showEmpty; render(); } }, RA.showEmpty ? `Hide others (${emptyCount})` : `Show others (${emptyCount})`) : null] : null),
    RA.view === 'all'
      ? (petsFiltered.length ? grid(petsFiltered, 'all') : h('div', { class: 'x-empty' }, 'No pets match.'))
      : (accts.length ? accts.filter(a => !petFilterOn || petsFiltered.some(p => p.accountId === a.id)).map(accountRow) : h('div', { class: 'x-empty' }, S.accounts.length ? 'No logged-in account yet. Log in an account (✎ → cookie or browser login), or use Show others.' : 'No accounts yet. Import a JSON or add one.')),
    (RA.view === 'account' && petsFiltered.some(p => !p.accountId)) ? h('div', { class: 'x-arow' }, h('div', { class: 'x-ahead' }, h('b', null, 'Unassigned'), h('small', { class: 'muted' }, 'pets without an account')), grid(petsFiltered.filter(p => !p.accountId), 'un')) : null);

  root.append(
    h('div', { class: 'x-head x-head-acc' },
      h('div', { class: 'x-head-t' }, h('h1', null, 'Roblox Accounts'), h('p', null, `${petsFiltered.length} of ${live.length} pets · ${S.accounts.length} account(s)`)),
      h('div', { class: 'grow' }),
      h('div', { class: 'row x-head-r' },
        h('button', { class: 'btn sm primary', onclick: async () => { const txt2 = await readFileText(); if (!txt2) return; const r = await run(() => M.call('accounts:import', txt2)); if (r) { toast(`Imported ${r.accounts} accounts, ${r.pets} pets`, 'good'); await refreshData(); render(); } } }, '⬆ Import JSON'),
        h('button', { class: 'btn sm', onclick: async () => xCopy(await M.call('accounts:export'), 'All accounts copied') }, '⎘ Copy All'),
        h('button', { class: 'btn sm', onclick: () => { RA.org = RA.org === 'name' ? 'pets' : RA.org === 'pets' ? 'free' : 'name'; toast('Sorted by ' + ({ name: 'name', pets: 'most pets', free: 'fewest pets' }[RA.org]), 'info', 2200); render(); } }, '⠿ Organize'),
        h('div', { class: 'row x-asw', title: 'zotac_scanner.lua in your executor autoexec: every account Zotac opens scans its base' }, h('small', { class: 'muted' }, 'Auto Scanner'), sw((S.settings.scanner || {}).autoexec !== false, v => toggleAutoexec('scanner', v))),
        h('button', { class: 'btn sm primary', onclick: () => { if ((S.settings.scanner || {}).autoexec === false) return toast('Turn on Auto Scanner first: without it opened accounts never scan', 'error', 7000); openAutoScan(); } }, '⌕ Auto Scan'),
        h('button', { class: 'btn sm', title: 'Launch every account that has a cookie and is not in game', onclick: async () => { const n = S.accounts.filter(a => a.hasCookie).length; if (!n) return toast('No logged-in accounts', 'error'); if (!await confirmBox(`Open Roblox on all ${n} logged-in accounts (4 s apart, accounts already in game are skipped)?`)) return; toast('Launching accounts…', 'info'); const r = await run(() => M.call('accounts:launchAll')); if (r) toast(r.map(x => `${x.username}: ${x.error || x.skipped || 'launched'}`).join(' · ') || 'No accounts with cookies', 'good', 9000); } }, '▶ Launch All'),
        h('button', { class: 'btn sm', title: 'Restart the multi-instance helper (when a new client closes the old one)', onclick: () => run(() => M.call('launcher:fix'), 'Launcher reset') }, '⟳ Fix Launch'),
        h('button', { class: 'btn sm primary', title: 'Sign in to a stock account on roblox.com; the account and its cookie are added', onclick: async () => { const r = await run(() => M.call('accounts:loginBrowser', null)); if (r) { toast(`${r.created ? 'Added' : 'Updated'} @${r.username} — cookie saved`, 'good'); await refreshData(); render(); } } }, '⎆ Browser Login'),
        h('button', { class: 'btn sm primary', onclick: () => editAcct() }, '+ Account'),
        h('button', { class: 'btn sm danger', onclick: () => { Object.assign(RA.filter, { account: '', q: '', mutation: '', min: '', max: '', range: '' }); render(); } }, 'Clear'))),
    h('div', { class: 'x-tabs' }, h('button', { class: RA.tab === 'accounts' ? 'on' : '', onclick: () => { RA.tab = 'accounts'; render(); } }, 'Roblox Accounts'), h('button', { class: RA.tab === 'settings' ? 'on' : '', onclick: () => { RA.tab = 'settings'; render(); } }, 'Account Settings')),
    body);
};

// ============================== SALES HISTORY =============================
const SH = { name: '', gen: '', owner: '', value: '', from: '', to: '' };
PAGES.sales = async root => {
  const csv = () => {
    const rows = [['date', 'title', 'buyer', 'price', 'state', 'source', 'orderId'], ...S.sales.map(s => [s.date, s.title, s.buyer, s.price, s.state || '', s.source, s.orderId || ''])];
    download('zotac-sales.csv', rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  };
  const muts = mutationNames();
  const rowOf = s => {
    const pet = (s.petIds || []).map(id => S.pets.find(p => p.id === id)).find(Boolean);
    const [head, tail] = String(s.title || '').split('|');
    let name = (pet && pet.name) || head.trim(), mutation = pet ? pet.mutation : 'None';
    if (!pet) { const m = muts.find(x => new RegExp('^' + x.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s', 'i').test(name + ' ')); if (m) { mutation = m; name = name.slice(m.length).trim(); } }
    const gm = (tail || String(s.title || '')).match(/([\d.]+\s*[kmbt]?)\s*\/s/i);
    const gen = pet ? pet.gen : gm ? parseGen(gm[1]) : 0;
    const owner = pet && pet.accountId ? acctName(pet.accountId) : '';
    const ts = new Date(s.date).getTime() || (pet && pet.soldAt) || 0;
    return { s, name, mutation, gen, owner, ts, value: Number(s.price) || 0 };
  };
  const all = S.sales.map(rowOf).sort((a, b) => b.ts - a.ts);
  const numbered = all.map((r, i) => ({ ...r, n: all.length - i }));
  const from = SH.from ? new Date(SH.from).getTime() : 0, to = SH.to ? new Date(SH.to).getTime() + 86400000 : 0;
  const minGen = parseGen(SH.gen), minVal = Number(SH.value) || 0;
  const rows = numbered.filter(r => (!SH.name || (r.name + ' ' + r.mutation).toLowerCase().includes(SH.name.toLowerCase()))
    && (!minGen || r.gen >= minGen) && (!SH.owner || (r.owner || r.s.buyer || '').toLowerCase().includes(SH.owner.toLowerCase()))
    && (!minVal || r.value >= minVal) && (!from || r.ts >= from) && (!to || r.ts < to));
  const gross = S.sales.filter(s => !/cancel|refund/i.test(s.state || '')).reduce((a, s) => a + (Number(s.price) || 0), 0), fee = gross * 0.15;
  const expenses = S.pets.reduce((a, p) => a + (Number(p.cost) || 0), 0) + S.expenses.reduce((a, e) => a + (Number(e.amount) || 0), 0);
  const net = gross - fee - expenses;
  const dt = ts => { if (!ts) return '—'; const d = new Date(ts); const p2 = n => String(n).padStart(2, '0'); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}, ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  const flt = (label, key, ph, type = 'text') => h('label', { class: 'x-fl' }, h('span', null, label), h('input', { type, placeholder: ph, value: SH[key], onchange: e => { SH[key] = e.target.value; render(); } }));

  root.append(
    h('div', { class: 'x-head x-head-acc' }, h('div', { class: 'x-head-t' }, h('h1', null, 'Sales History'), h('p', null, `${S.sales.length} sales`)), h('div', { class: 'grow' }),
      h('div', { class: 'row x-head-r' },
        h('button', { class: 'btn sm', onclick: csv }, 'Export CSV'),
        h('button', { class: 'btn sm primary', onclick: async () => {
          const title = await promptBox('Manual sale', 'What did you sell?'); if (!title) return;
          const price = Number(await promptBox('Manual sale', 'Price $')); if (!price) return;
          await M.call('sales:save', { title, price, buyer: '', date: new Date().toISOString(), source: 'manual', petIds: [] }); await refreshData(); render();
        } }, '+ Sale'))),
    h('div', { class: 'x-tiles' },
      xTile('GROSS REVENUE', '$ ' + gross.toFixed(2), 'x-plain'), xTile('REVENUE -15%', '$ ' + (gross - fee).toFixed(2), 'x-plain'),
      h('div', { class: 'x-tile x-plain' }, h('div', { class: 'x-tile-b' }, h('div', { class: 'x-tile-k' }, 'EXPENSES ', h('a', { href: '#', title: 'Add expense', onclick: async e => { e.preventDefault(); const label = await promptBox('Add expense', 'What was it?'); if (!label) return; const amount = Number(await promptBox('Add expense', 'Amount $')); if (!amount) return; await M.call('expenses:save', { label, amount, date: new Date().toISOString() }); await refreshData(); render(); } }, '+')), h('div', { class: 'x-tile-v red' }, '$ ' + expenses.toFixed(2)))),
      h('div', { class: 'x-tile x-plain' }, h('div', { class: 'x-tile-b' }, h('div', { class: 'x-tile-k' }, 'NET PROFIT'), h('div', { class: 'x-tile-v ' + (net >= 0 ? 'green' : 'red') }, (net >= 0 ? '+ $ ' : '- $ ') + Math.abs(net).toFixed(2)), h('div', { class: 'x-tile-s' }, gross ? (net / gross * 100).toFixed(1) + '%' : '0%')))),
    h('div', { class: 'x-filters x-sfilters' }, flt('BRAINROT', 'name', 'Name...'), flt('GEN', 'gen', 'Generation...'), flt('OWNER', 'owner', 'Name...'), flt('VALUE', 'value', 'Value...'), flt('FROM', 'from', '', 'date'), flt('TO', 'to', '', 'date')),
    h('div', { class: 'x-twrap' }, rows.length ? h('table', { class: 'x-table' },
      h('thead', null, h('tr', null, ['#', 'BRAINROT', 'MUTATION', 'GEN', 'OWNER', 'SOLD AT'].map(c => h('th', null, c)), h('th', { class: 'num' }, 'VALUE'), h('th', { class: 'num' }, 'ACTIONS'))),
      h('tbody', null, rows.slice(0, 500).map(r => h('tr', null,
        h('td', { class: 'muted mono' }, '#' + r.n),
        h('td', null, h('div', { class: 'x-bn' }, xAvatar({ name: r.name, mutation: r.mutation }, 26), h('b', null, r.name || '—'), r.s.quantity > 1 ? h('span', { class: 'x-q' }, '×' + r.s.quantity) : null)),
        h('td', null, xDot(r.mutation)),
        h('td', { class: 'x-gen' }, r.gen ? formatGen(r.gen) : '—'),
        h('td', { class: 'ink2' }, r.owner || (r.s.buyer ? h('span', { class: 'muted' }, r.s.buyer) : '—')),
        h('td', { class: 'mono' }, dt(r.ts)),
        h('td', { class: 'num x-val' }, '$ ' + r.value.toFixed(2)),
        h('td', { class: 'num' }, h('button', { class: 'x-delb', title: 'Delete sale', onclick: async () => { if (await confirmBox('Delete this sale record?')) { await M.call('sales:delete', r.s.id); await refreshData(); render(); } } }, '✕')))))
    ) : h('div', { class: 'x-empty' }, 'No sales yet. New Eldorado orders are recorded automatically while the app runs.')),
    rows.length > 500 ? h('div', { class: 'muted', style: { textAlign: 'center', padding: '8px' } }, `Showing newest 500 of ${rows.length}. Use the filters to narrow down.`) : null);
};

// ============================== SEARCHER ==================================
// "Search on Eldorado" from a pet: same brainrot AND same mutation, cheapest first; every other
// filter is cleared so an old one can not hide the results
async function searchSimilar(p) {
  const nk = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const mAttr = (S.attrs || []).find(a => a.id === S.settings.game.mutationAttr);
  const want = p.mutation && !/^normal$/i.test(p.mutation) ? p.mutation : 'None';
  const hit = mAttr && mAttr.selectValues.find(v => nk(v.name) === nk(want) || nk(v.id) === nk(want));
  SR.q = { ...SR.q, name: p.name, mutation: hit ? hit.id : (nk(want) === 'none' ? 'none' : nk(want)), genBucket: '', trait: '', minPrice: '', maxPrice: '', deliveryTime: '', search: '', sort: 'priceAsc', page: 1 };
  SR.res = null; SR.loading = true; go('searcher');
  SR.res = await run(() => M.call('eld:search', { ...SR.q, pageSize: 30 })); SR.loading = false; render();
}
const SR = { q: { name: '', mutation: '', genBucket: '', trait: '', minPrice: '', maxPrice: '', deliveryTime: '', sort: 'priceAsc', search: '', page: 1 }, res: null, loading: false };
PAGES.searcher = async root => {
  const q = SR.q;
  const go = async (page = 1) => { q.page = page; SR.loading = true; render(); SR.res = await run(() => M.call('eld:search', { ...q, pageSize: 30 })); SR.loading = false; render(); };
  const traitsAttr = (S.attrs || []).find(a => a.id === S.settings.game.traitsAttr);
  const rows = SR.res ? (SR.res.results || []) : [];
  root.append(pageHead('searcher'),
    h('datalist', { id: 'dl-items2' }, (S.items || []).map(i => h('option', { value: i.name }))),
    h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'row' },
      h('input', { type: 'text', placeholder: 'Brainrot', list: 'dl-items2', value: q.name, onchange: e => q.name = e.target.value }),
      sel([['', 'Any mutation'], ...((S.attrs || []).find(a => a.id === S.settings.game.mutationAttr) || { selectValues: [] }).selectValues.map(v => [v.id, v.name])], q.mutation, v => q.mutation = v),
      sel(GEN_BUCKETS, q.genBucket, v => q.genBucket = v),
      sel([['', 'Any trait'], ...(traitsAttr ? traitsAttr.selectValues.map(v => [v.id, v.name]) : [])], q.trait, v => q.trait = v),
      h('input', { type: 'number', placeholder: 'min $', value: q.minPrice, style: { width: '80px' }, onchange: e => q.minPrice = e.target.value }),
      h('input', { type: 'number', placeholder: 'max $', value: q.maxPrice, style: { width: '80px' }, onchange: e => q.maxPrice = e.target.value }),
      sel([['', 'Any delivery'], ...DELIVERY_TIMES.map(x => [x, x])], q.deliveryTime, v => q.deliveryTime = v),
      sel([['priceAsc', 'Price ↑'], ['priceDesc', 'Price ↓'], ['', 'Recommended']], q.sort, v => q.sort = v),
      h('input', { type: 'search', placeholder: 'Text search', value: q.search, onchange: e => q.search = e.target.value }),
      h('button', { class: 'btn primary', onclick: () => go(1) }, SR.loading ? 'Searching…' : t('search')))),
    SR.res ? h('div', { class: 'row', style: { marginBottom: '8px' } }, h('span', { class: 'muted' }, `${SR.res.recordCount ?? rows.length} results · page ${SR.res.pageIndex}/${SR.res.totalPages || 1}`),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn sm', disabled: q.page <= 1, onclick: () => go(q.page - 1) }, '‹ Prev'),
      h('button', { class: 'btn sm', disabled: SR.res.totalPages && q.page >= SR.res.totalPages, onclick: () => go(q.page + 1) }, 'Next ›')) : null,
    table(rows, [
      { label: '', render: r => offerImg(r.offer) ? h('img', { class: 'thumb', src: offerImg(r.offer) }) : h('div', { class: 'thumb' }) },
      { label: t('title'), render: r => h('div', null, h('div', { class: 'pet-name' }, r.offer.offerTitle), h('small', { class: 'muted' }, (r.offer.tradeEnvironmentValues || []).map(e => e.value).join(' › '))) },
      { label: t('mutation'), render: r => mutPill(((r.offer.attributes || []).find(a => /mutation/.test(a.id)) || { value: {} }).value?.name) },
      { label: t('gen'), num: true, render: r => { const a = (r.offer.attributes || []).find(x => x.type === 'Numeric'); return a ? formatGen(a.value) : '—'; } },
      { label: 'Seller', render: r => h('div', null, r.user ? r.user.username : '—', r.user && r.user.isVerifiedSeller ? h('span', { class: 'pill good', style: { marginLeft: '6px' } }, '✓') : null) },
      { label: 'Feedback', num: true, render: r => r.userOrderInfo && r.userOrderInfo.feedbackScore != null ? `${r.userOrderInfo.feedbackScore.toFixed(1)}% (${r.userOrderInfo.ratingCount})` : '—' },
      { label: 'Delivery', render: r => r.offer.guaranteedDeliveryTime },
      { label: t('qty'), num: true, render: r => r.offer.quantity },
      { label: t('price'), num: true, render: r => h('b', { style: { color: 'var(--gold)' } }, money((r.offer.pricePerUnitInUSD || r.offer.pricePerUnit).amount)) },
      { label: '', render: r => h('button', { class: 'btn sm', onclick: () => M.call('open:external', offerUrl(r.offer)) }, '↗') }
    ], { empty: SR.loading ? 'Searching…' : 'Set filters and search.', maxHeight: 'calc(100vh - 290px)' }));
};

// ============================== ORDERS ====================================
const XSTATE = {
  completed: s => /complet|receiv/i.test(s), delivered: s => /^delivered/i.test(s),
  pending: s => /pending|created|process|waiting/i.test(s), canceled: s => /cancel|refund/i.test(s), disputed: s => /disput/i.test(s)
};
const xStatePill = s => {
  const lbl = String(s || '—').replace(/([a-z])([A-Z])/g, '$1 $2');
  const cls = XSTATE.canceled(s) ? 'bad' : XSTATE.disputed(s) ? 'bad' : XSTATE.completed(s) ? 'good' : XSTATE.delivered(s) ? 'info' : XSTATE.pending(s) ? 'warn' : '';
  return h('span', { class: 'x-st ' + cls }, lbl.toUpperCase());
};
const xRatingPos = o => o.rating && !/neg|bad|-/i.test(JSON.stringify(o.rating));
const OR = { page: 1, state: '', data: null, loading: false, filter: 'all', q: '' };
PAGES.orders = async root => {
  const load = async () => { OR.loading = true; render(); OR.data = await run(() => M.call('eld:orders', { page: OR.page, pageSize: 50 })); OR.loading = false; render(); };
  if (!OR.data && !OR.loading && S.me) load();
  const all = OR.data ? OR.data.rows : [];
  const detail = async o => {
    const full = await run(() => M.call('eld:order', o.id));
    modal('Order ' + o.id, h('div', null,
      h('div', { class: 'kv' }, h('div', null, 'Title'), h('div', null, o.title), h('div', null, 'State'), h('div', null, stateBadge(o.state)), h('div', null, 'Buyer'), h('div', null, o.buyer || '—'), h('div', null, 'Price'), h('div', null, money(o.price)), h('div', null, 'Date'), h('div', null, fmtDate(o.date))),
      h('div', { class: 'row', style: { margin: '14px 0' } },
        h('button', { class: 'btn', onclick: async () => { const m = await promptBox('Message buyer', 'Message', '', true); if (m) run(() => M.call('eld:message', o.id, m), 'Sent'); } }, 'Message buyer'),
        h('button', { class: 'btn', onclick: () => { CH.orderId = o.id; go('chat'); } }, 'Open chat'),
        /pending/i.test(o.state) ? h('button', { class: 'btn primary', onclick: async () => { if (await confirmBox('Mark this order as delivered?')) run(() => M.call('eld:deliver', o.id), 'Marked delivered'); } }, 'Mark delivered') : null,
        S.settings.delivery.enabled ? h('button', { class: 'btn', onclick: async () => {
          if (!await confirmBox(`Start auto delivery for this order (×${o.quantity || 1})? Zotac uses the pets booked to it, or ${o.quantity || 1} listed pet(s) of its offer.`)) return;
          const r = await run(() => M.call('delivery:startFromOrder', { id: o.id, buyer: o.buyer, title: o.title, price: o.price, quantity: o.quantity, offerId: o.offerId, conversationId: o.conversationId }));
          if (r) toast(r.pets < r.quantity ? `Only ${r.pets} of ${r.quantity} pets found: the order waits for you (Auto Delivery)` : 'Delivery flow started', r.pets < r.quantity ? 'error' : 'good', 8000);
        } }, 'Start auto delivery') : null),
      jsonDetails('Raw order data', full || o.raw)), [{ label: t('close') }]);
  };
  const okState = s => !XSTATE.canceled(s) && !XSTATE.pending(s);
  const revenue = all.filter(o => okState(o.state)).reduce((a, o) => a + (Number(o.earnings ?? o.price) || 0), 0);
  const completed = all.filter(o => XSTATE.completed(o.state)).length;
  const rated = all.filter(o => o.rating), pos = rated.filter(xRatingPos).length;
  const posPct = rated.length ? Math.round(pos / rated.length * 100) : 100;
  const filt = { all: () => true, completed: o => XSTATE.completed(o.state), delivered: o => XSTATE.delivered(o.state), pending: o => XSTATE.pending(o.state), canceled: o => XSTATE.canceled(o.state) }[OR.filter] || (() => true);
  const rows = all.filter(o => filt(o) && (!OR.q || `${o.buyer} ${o.title} ${o.id}`.toLowerCase().includes(OR.q.toLowerCase())));
  const ratingTxt = o => !o.rating ? '—' : typeof o.rating === 'object' ? (o.rating.rating || o.rating.type || 'Rated') : String(o.rating);

  root.append(
    h('div', { class: 'x-head' }, h('div', { class: 'x-badge' }, '🛒'), h('div', { class: 'x-head-t' }, h('h1', null, 'Orders'), h('p', null, 'Sold orders on Eldorado')), h('div', { class: 'grow' }),
      h('div', { class: 'row x-head-r' }, h('button', { class: 'btn sm ghost', onclick: load }, OR.loading ? 'Loading…' : '↻ Refresh'))),
    !S.me ? h('div', { class: 'card empty' }, 'Log in on the Account page to see orders.') : h('div', null,
      h('div', { class: 'x-tiles' },
        xTile('REVENUE', money(revenue), 'x-plain', null, h('span', null, '$')), xTile('ORDERS', String(OR.data && OR.data.total || all.length), 'x-plain', null, h('span', null, '🛒')),
        xTile('COMPLETED', String(completed), 'x-plain', null, h('span', null, '✓')), xTile('POSITIVE', posPct + '%', 'x-plain', null, h('span', null, '★'))),
      h('div', { class: 'x-viewbar' },
        xPills([['all', 'All'], ['completed', 'Completed'], ['delivered', 'Delivered'], ['pending', 'Pending'], ['canceled', 'Canceled']], OR.filter, v => { OR.filter = v; render(); }),
        h('div', { class: 'grow' }),
        h('input', { class: 'x-search sm', type: 'search', placeholder: 'Search buyer or item...', value: OR.q, oninput: e => { OR.q = e.target.value; clearTimeout(OR.qt); OR.qt = setTimeout(render, 250); } })),
      h('div', { class: 'x-ohead' }, h('span', null, 'ORDER'), h('span', null, 'BUYER'), h('span', { class: 'r' }, 'AMOUNT'), h('span', null, 'STATUS'), h('span', null, 'RATING'), h('span', { class: 'r' }, 'ACTION')),
      rows.length ? rows.map(o => h('div', { class: 'x-orow' },
        h('div', { class: 'x-oi' }, xOrderAva(o, 34), h('div', { class: 'x-ot' }, h('b', null, o.title || '—'), h('small', { class: 'muted mono' }, '#' + String(o.id || '').slice(0, 8)))),
        h('div', { class: 'x-ob' }, h('b', null, o.buyer || '—'), h('small', { class: 'muted' }, ago(o.date))),
        h('div', { class: 'x-oa' }, money(o.price)),
        h('div', null, xStatePill(o.state)),
        h('div', { class: 'x-or' }, o.rating ? h('span', { class: xRatingPos(o) ? 'pos' : 'neg' }, '★ ' + ratingTxt(o)) : '—'),
        h('div', { class: 'r' }, h('button', { class: 'btn sm', onclick: () => detail(o) }, '⧉ Open')))) : h('div', { class: 'x-empty' }, OR.loading ? 'Loading…' : 'No orders.'),
      h('div', { class: 'row', style: { marginTop: '10px' } }, h('div', { class: 'grow' }),
        h('button', { class: 'btn sm', disabled: OR.page <= 1, onclick: () => { OR.page--; OR.data = null; render(); } }, '‹ Prev'), h('span', { class: 'muted' }, 'Page ' + OR.page),
        h('button', { class: 'btn sm', disabled: OR.data && OR.data.pages && OR.page >= OR.data.pages, onclick: () => { OR.page++; OR.data = null; render(); } }, 'Next ›'))));
};

// ============================== CHAT ======================================
const CH = { orderId: null, orders: null, filter: 'all', q: '', live: false, dl: null, edit: false, hist: {}, rbx: {} };
// loads (once per order, or again on Refresh) the full Eldorado chat of an order
function chLoadHistory(orderId, force) {
  const cur = CH.hist[orderId];
  if (!orderId || (cur && !force && (cur.loading || cur.msgs || Date.now() - cur.at < 15000))) return;
  CH.hist[orderId] = { loading: true, at: Date.now(), msgs: cur && cur.msgs };
  const order = (CH.orders || []).find(o => o.id === orderId);
  M.call('chat:history', orderId, order && order.conversationId)
    .then(r => { CH.hist[orderId] = { msgs: r.messages, conversationId: r.conversationId, at: Date.now() }; })
    .catch(e => { CH.hist[orderId] = { err: String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), at: Date.now(), msgs: cur && cur.msgs }; })
    .finally(() => { if (S.page === 'chat' && CH.orderId === orderId) render(); });
}
PAGES.chat = async root => {
  if (!S.me) { root.append(xHead('Ch', 'Chat', 'Open conversations on Eldorado'), h('div', { class: 'card empty' }, 'Log in on the Account page to use chat.')); return; }
  const loadOrders = () => { CH.orders = CH.orders || []; M.call('eld:orders', { page: 1, pageSize: 40 }).then(r => { CH.orders = r.rows; render(); }).catch(() => {}); };
  const loadDl = () => M.call('delivery:list').then(r => { CH.dl = r.deliveries || []; render(); }).catch(() => { CH.dl = CH.dl || []; });
  if (!CH.orders) loadOrders();
  if (!CH.dl) { CH.dl = []; loadDl(); }
  const list = (CH.orders || []).filter(o => {
    const f = CH.filter;
    return (f === 'all' || (f === 'active' && XSTATE.pending(o.state)) || (f === 'delivered' && XSTATE.delivered(o.state)) || (f === 'completed' && XSTATE.completed(o.state)) || (f === 'canceled' && XSTATE.canceled(o.state)) || (f === 'disputed' && XSTATE.disputed(o.state)))
      && (!CH.q || `${o.buyer} ${o.title}`.toLowerCase().includes(CH.q.toLowerCase()));
  });
  if (!CH.orderId && list.length) CH.orderId = list[0].id;
  const cur = (CH.orders || []).find(o => o.id === CH.orderId);
  const d = (CH.dl || []).find(x => x.orderId === CH.orderId);
  const url = CH.orderId ? `https://www.eldorado.gg/order/${CH.orderId}` : 'https://www.eldorado.gg/dashboard/orders/sold';
  const am = S.settings.autoMessage || {};
  const hm = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  // messages: the order's Eldorado chat history, plus anything newer that arrived live (and the
  // bot's own log when the chat could not be read)
  if (CH.orderId) chLoadHistory(CH.orderId);
  if (CH.orderId && !(d && d.username) && !(cur && cur.robloxUsername) && !(CH.orderId in CH.rbx)) {
    const id = CH.orderId; CH.rbx[id] = undefined;
    M.call('chat:buyerRoblox', id).then(v => { CH.rbx[id] = v || null; if (S.page === 'chat' && CH.orderId === id) render(); }).catch(() => { CH.rbx[id] = null; });
  }
  const rbxName = (d && d.username) || (cur && cur.robloxUsername) || CH.rbx[CH.orderId] || null;
  const hist = CH.hist[CH.orderId] || {};
  const convId = hist.conversationId || (d && d.conversationId);
  let msgs = (hist.msgs || []).map(m => ({ id: m.id, t: m.ts, mine: m.isByMe, sys: m.system, text: m.body }));
  const seen = new Set(msgs.map(m => m.id));
  const lastT = msgs.length ? msgs[msgs.length - 1].t : 0;
  for (const m of S.talkLog || []) {
    if (seen.has(m.id) || !((convId && m.conversationId === convId) || (m.custom && m.custom.orderId === CH.orderId))) continue;
    if (m.ts >= lastT) msgs.push({ id: m.id, t: m.ts, mine: m.isByMe, text: m.body });
  }
  if (!hist.msgs && d && d.log && d.log.length) msgs = d.log.filter(l => l.out || l.in || l.err).map(l => ({ t: l.t, mine: !!l.out, err: !!l.err, text: l.out || l.in || l.err }));

  const send = async () => {
    const inp = $('#ch-input'); const text = inp && inp.value.trim(); if (!text || !CH.orderId) return;
    inp.value = '';
    let ok = true; try { await M.call('eld:message', CH.orderId, text); } catch (e) { ok = false; toast(e.message, 'error'); }
    if (ok) { if (d) d.log = [...(d.log || []), { t: Date.now(), out: text }]; else CH.dl = [...CH.dl, { orderId: CH.orderId, log: [{ t: Date.now(), out: text }] }]; setTimeout(() => chLoadHistory(CH.orderId, true), 1500); render(); }
  };
  const thread = !cur && !CH.orderId ? h('div', { class: 'x-empty' }, 'Select a conversation') : h('div', { class: 'x-thread' },
    h('div', { class: 'x-thead' },
      cur ? xOrderAva(cur, 36) : null,
      h('div', { class: 'grow' }, h('b', null, cur ? (cur.buyer || 'Unknown buyer') : 'Order ' + CH.orderId),
        h('small', { class: 'muted' }, cur ? `${cur.title || 'Order'}   ·   #${String(CH.orderId).slice(0, 18)}` : '')),
      cur ? xStatePill(cur.state) : null),
    h('div', { class: 'x-tuser' }, h('span', { class: 'muted' }, 'Roblox username: '), h('b', null, rbxName ? '@' + rbxName : CH.rbx[CH.orderId] === undefined && !(d && d.username) ? 'loading…' : '—'),
      h('div', { class: 'grow' }),
      rbxName ? h('button', { class: 'btn sm ghost', onclick: () => xCopy(rbxName, 'Username copied') }, '⎘ Copy') : null,
      h('button', { class: 'btn sm ghost', onclick: () => { CH.live = !CH.live; render(); } }, CH.live ? '← Bubbles' : 'Eldorado view')),
    CH.live ? (() => { const wv = document.createElement('webview'); wv.setAttribute('partition', 'persist:eldorado'); wv.setAttribute('src', url); wv.setAttribute('allowpopups', ''); wv.className = 'x-wv'; return wv; })()
      : h('div', { class: 'x-msgs', id: 'ch-msgs' },
        hist.err ? h('div', { class: 'x-sys' }, h('div', null, 'Could not load the chat: ' + hist.err), h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: () => chLoadHistory(CH.orderId, true) }, 'Try again'), ' ',
          h('button', { class: 'btn sm ghost', style: { marginTop: '6px' }, onclick: () => { CH.live = true; render(); } }, 'Eldorado view')) : null,
        msgs.length ? msgs.map(m => m.err ? h('div', { class: 'x-sys' }, 'Send failed: ' + m.text) : m.sys ? h('div', { class: 'x-sys' }, h('div', null, m.text)) : h('div', { class: 'x-msg ' + (m.mine ? 'mine' : 'theirs') },
          !m.mine ? h('div', { class: 'x-mava' }, (cur && cur.buyer || 'B')[0].toUpperCase()) : null,
          h('div', { class: 'x-bub' }, !m.mine ? h('small', { class: 'x-who' }, cur && cur.buyer || 'Buyer') : null, h('div', null, m.text), h('small', { class: 'x-mt' }, hm(m.t)))))
          : h('div', { class: 'x-empty sm' }, hist.loading ? 'Loading chat…' : hist.err ? '' : 'No messages in this chat yet.'),
        cur ? h('div', { class: 'x-sys' }, h('div', null, 'Order status: ' + String(cur.state).replace(/([a-z])([A-Z])/g, '$1 $2'))) : null),
    h('div', { class: 'x-compose' },
      h('input', { id: 'ch-input', type: 'text', placeholder: 'Type a message...', onkeydown: e => { if (e.key === 'Enter') send(); } }),
      h('button', { class: 'x-send', title: 'Send', onclick: send }, '➤')));

  root.append(
    h('div', { class: 'x-head' }, h('div', { class: 'x-badge' }, 'Ch'), h('div', { class: 'x-head-t' }, h('h1', null, 'Chat'), h('p', null, 'Open conversations on Eldorado')), h('div', { class: 'grow' }),
      h('div', { class: 'row x-head-r' }, h('button', { class: 'btn sm ghost', onclick: () => { CH.orders = null; CH.dl = null; if (CH.orderId) { delete CH.rbx[CH.orderId]; chLoadHistory(CH.orderId, true); } render(); } }, '↻ Refresh'), h('button', { class: 'btn sm', onclick: () => M.call('open:external', url) }, '✎ Eldorado'))),
    xPills([['all', 'All'], ['active', 'Active'], ['delivered', 'Delivered'], ['completed', 'Completed'], ['canceled', 'Canceled'], ['disputed', 'Disputed']], CH.filter, v => { CH.filter = v; render(); }),
    h('div', { class: 'x-bar x-am' }, h('span', { class: 'x-bar-k' }, '⚡ AUTO-MESSAGE'),
      h('small', { class: 'muted grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, S.settings.delivery && S.settings.delivery.enabled ? 'not sent while Auto Delivery is on (it greets the buyer itself)' : (CH.edit ? '' : am.text)),
      h('button', { class: 'btn sm ghost', onclick: () => { CH.edit = !CH.edit; render(); } }, CH.edit ? 'Close' : 'Edit text'),
      sw(!!am.enabled, v => saveSettings({ autoMessage: { enabled: v } }))),
    CH.edit ? h('div', { class: 'x-panel' }, h('textarea', { value: am.text || '', onchange: e => saveSettings({ autoMessage: { text: e.target.value } }) }), h('small', { class: 'muted' }, 'Variables: {buyer} {item} {orderId}. Sent once to each new order while the app runs, only when Auto Delivery is off.')) : null,
    h('div', { class: 'x-chat' },
      h('div', { class: 'x-clist' },
        h('input', { type: 'search', placeholder: 'Search by buyer name...', value: CH.q, oninput: e => { CH.q = e.target.value; clearTimeout(CH.qt); CH.qt = setTimeout(render, 250); } }),
        h('div', { class: 'x-cscroll' }, list.length ? list.map(o => h('div', { class: 'x-citem' + (CH.orderId === o.id ? ' on' : ''), onclick: () => { CH.orderId = o.id; CH.live = false; render(); } },
          xOrderAva(o, 34),
          h('div', { class: 'x-cm' }, h('div', { class: 'x-cl1' }, h('b', null, o.buyer || '—'), h('small', { class: 'muted' }, ago(o.date))), h('small', { class: 'muted x-ctt' }, o.title || ''), h('div', { class: 'x-cl3' }, h('b', { class: 'x-cp' }, money(o.price)), xStatePill(o.state))))) : h('div', { class: 'x-empty sm' }, CH.orders && !CH.orders.length ? 'No orders yet.' : 'Nothing matches.'))),
      thread));
  const ms = $('#ch-msgs'); if (ms) ms.scrollTop = ms.scrollHeight;
};
