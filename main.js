const { app, BrowserWindow, ipcMain, shell, session, desktopCapturer, dialog, nativeImage, net } = require('electron');
const path = require('path');
const fs = require('fs');

const { Store, rid, DEFAULT_DELIVERY_STEPS } = require('./src/main/store');
const { Bridge, PARTITION, ORIGIN } = require('./src/main/bridge');
const { Eldorado, listOf } = require('./src/main/eldorado');
const sab = require('./src/main/sab');
const { smartPrice } = require('./src/main/pricing');
const { AutoLister } = require('./src/main/autolist');
const { Repricer, Watcher, discord, robloxUser, robloxAvatar } = require('./src/main/services');
const { Delivery } = require('./src/main/delivery');
const { startLocalServer } = require('./src/main/localserver');
const { checkUpdate, installUpdate } = require('./src/main/updater');
const { Launcher, decryptCookie } = require('./src/main/launcher');
const { Art } = require('./src/main/art');
const { Wiki } = require('./src/main/wiki');

const SMOKE = process.argv.includes('--smoke');

// One-time move from the old app name: %APPDATA%\Meowl Lister -> %APPDATA%\Zotac Lister. The whole
// folder moves (data file, art cache, and Chromium's Local State that holds the safeStorage key,
// so saved Roblox cookies still decrypt). Must run before anything opens the new folder.
if (!SMOKE) {
  try {
    const oldDir = path.join(app.getPath('appData'), 'Meowl Lister');
    const newDir = app.getPath('userData');
    if (fs.existsSync(oldDir) && oldDir !== newDir) {
      if (!fs.existsSync(newDir)) fs.renameSync(oldDir, newDir);
      else if (!fs.existsSync(path.join(newDir, 'zotac-data.json'))) fs.cpSync(oldDir, newDir, { recursive: true, force: true });
    }
    const oldFile = path.join(newDir, 'meowl-data.json'), newFile = path.join(newDir, 'zotac-data.json');
    if (fs.existsSync(oldFile) && !fs.existsSync(newFile)) fs.renameSync(oldFile, newFile);
  } catch (e) { console.error('data folder migration failed:', e.message); }
}
if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();

let win = null;
let store, bridge, eld, lister, repricer, watcher, delivery, launcher, art, wiki;
const proofDir = () => { const d = path.join(app.getPath('userData'), 'proofs'); fs.mkdirSync(d, { recursive: true }); return d; };

const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
// latest scan per Roblox server (job id), newest 5 kept, in memory only
const serverScans = {};
function saveServerScan(d) {
  const id = String(d.jobId || d.by || 'server');
  serverScans[id] = { ...d, jobId: id, receivedAt: Date.now() };
  const ids = Object.keys(serverScans).sort((a, b) => serverScans[b].receivedAt - serverScans[a].receivedAt);
  for (const old of ids.slice(5)) delete serverScans[old];
  send('server:scan', { jobId: id });
}
// Roblox profile pictures for every account: user ids from usernames, then headshots, both in
// batches (one request each for up to 100 accounts). Refreshed daily; new accounts right away.
let avatarTimer = null;
function refreshAvatarsSoon(ms = 1500) { clearTimeout(avatarTimer); avatarTimer = setTimeout(() => refreshAvatars().catch(e => store.log('warn', '[Avatars] ' + e.message)), ms); }
async function refreshAvatars() {
  const accts = store.get('accounts');
  const stale = accts.filter(a => a.username && (!a.avatar || Date.now() - (a.avatarAt || 0) > 24 * 3600e3));
  if (!stale.length) return;
  const needId = stale.filter(a => !a.robloxUserId).slice(0, 100);
  if (needId.length) {
    const r = await fetch('https://users.roblox.com/v1/usernames/users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: needId.map(a => a.username), excludeBannedUsers: false }), signal: AbortSignal.timeout(20000) });
    if (r.ok) for (const u of (await r.json()).data || []) {
      const a = needId.find(x => x.username.toLowerCase() === String(u.requestedUsername || u.name).toLowerCase());
      if (a) { a.robloxUserId = u.id; a.displayName = a.displayName || u.displayName; }
    }
  }
  const withId = stale.filter(a => a.robloxUserId).slice(0, 100);
  if (!withId.length) return store.save();
  const r = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${withId.map(a => a.robloxUserId).join(',')}&size=150x150&format=Png&isCircular=false`, { signal: AbortSignal.timeout(20000) });
  if (r.ok) for (const t of (await r.json()).data || []) {
    const a = withId.find(x => String(x.robloxUserId) === String(t.targetId));
    if (a && t.imageUrl && t.state === 'Completed') { a.avatar = t.imageUrl; a.avatarAt = Date.now(); }
  }
  store.save(); send('pets:changed');
}
const updateHooks = {
  log: msg => store.log('info', msg),
  onDone: sha => { if (sha) store.patchSettings({ autoUpdate: { installedSha: sha } }); }
};

// --- renderer round-trip (image generation runs on a canvas in the UI) ------
const pending = new Map();
function rendererCall(name, payload, timeout = 20000) {
  return new Promise((resolve, reject) => {
    if (!win || win.isDestroyed()) return reject(new Error('UI not available'));
    const id = rid(6);
    const t = setTimeout(() => { pending.delete(id); reject(new Error(name + ' timed out')); }, timeout);
    pending.set(id, { resolve, reject, t });
    win.webContents.send('rcall', { id, name, payload });
  });
}
ipcMain.on('rcall:result', (_e, { id, ok, value, error }) => {
  const p = pending.get(id); if (!p) return;
  clearTimeout(p.t); pending.delete(id);
  ok ? p.resolve(value) : p.reject(new Error(error));
});

function localPetImage(folder, name) {
  if (!folder) return null;
  try {
    const want = sab.norm(name);
    const f = fs.readdirSync(folder).find(x => /\.(png|jpe?g|webp)$/i.test(x) && sab.norm(x.replace(/\.[^.]+$/, '')) === want);
    if (!f) return null;
    const ext = f.split('.').pop().toLowerCase().replace('jpg', 'jpeg');
    return `data:image/${ext};base64,` + fs.readFileSync(path.join(folder, f)).toString('base64');
  } catch { return null; }
}

// Pet art: your image folder first, else the picture taken from the game (scanner art ids).
async function artFor(pet, imageFolder) {
  // image folder > the wiki's picture > the game's own picture / 3D model render
  const petArt = localPetImage(imageFolder, pet.name) || await wiki.picture(pet.name) || await art.petPicture(pet.name, pet.mutation);
  const traitArt = await Promise.all((pet.traits || []).slice(0, 6).map(async t => ({ name: t, url: await art.dataUrl('traits', t) })));
  const mut = pet.mutation && !/^(none|normal)$/i.test(pet.mutation) ? pet.mutation : null;
  const mutationArt = mut ? { name: mut, url: await art.dataUrl('mutations', mut) } : null;
  return { art: petArt, traitArt, mutationArt };
}
async function renderImage({ pet, rarity, imageFolder }) {
  const a = await artFor(pet, imageFolder);
  const al = store.get('settings').autolist || {};
  const dataUrl = await rendererCall('renderImage', { pet, rarity, ...a, shopName: al.shopName || '', recolor: al.recolorByMutation !== false });
  return dataUrl ? String(dataUrl).split(',')[1] : null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 680,
    frame: false, backgroundColor: '#0d0b08', show: !SMOKE,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, webviewTag: true, sandbox: false, backgroundThrottling: false }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}

// Screen recording for Video Proof: prefer a Roblox window, else primary screen.
function setupCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    const pick = sources.find(s => /roblox/i.test(s.name)) || sources.find(s => s.id.startsWith('screen')) || sources[0];
    cb({ video: pick });
  });
}

function wire() {
  store = new Store(app.getPath('userData'));
  // pets pasted as JSON on Auto List are for this session only: drop the ones still unlisted
  // (listed / sold ones stay, Auto Delivery needs them to match orders)
  { const before = store.get('pets').length; store.set('pets', store.get('pets').filter(p => !(p.status === 'available' && (p.session || (!p.accountId && !p.manual))))); if (store.get('pets').length !== before) store.save(); }
  // and the accounts such a paste created, once nothing points at them (no pets, cookie or note)
  { const used = new Set(store.get('pets').map(p => p.accountId)); const before = store.get('accounts').length;
    store.set('accounts', store.get('accounts').filter(a => !(a.session && !used.has(a.id) && !a.cookieEnc && !a.note)));
    if (store.get('accounts').length !== before) store.save(); }
  // backfill new step templates for older data files
  store.data.settings.delivery.steps = { ...DEFAULT_DELIVERY_STEPS, ...store.data.settings.delivery.steps };
  art = new Art({
    store, dir: path.join(app.getPath('userData'), 'art'),
    getCookie: () => { const a = store.get('accounts').find(x => x.cookieEnc); return a ? decryptCookie(a.cookieEnc) : null; },
    render: payload => rendererCall('renderModel', payload, 90000)
  });
  wiki = new Wiki({ dir: path.join(app.getPath('userData'), 'art'), log: (lvl, msg) => store.log(lvl, msg), bundled: path.join(__dirname, 'assets', 'wiki-map.json'),
    // Chromium's network stack first (system proxy / certificates like a browser), Node's as fallback
    fetch: async (url, opts) => { if (net.fetch) { try { return await net.fetch(url, opts); } catch { /* fall back */ } } return fetch(url, opts); } });
  bridge = new Bridge();
  eld = new Eldorado(bridge, store);
  lister = new AutoLister({ store, eld, renderImage });
  repricer = new Repricer({ store, eld });
  watcher = new Watcher({ store, eld });
  delivery = new Delivery({ store, eld, bridge });
  launcher = new Launcher({ store, delivery });
  launcher.on('launched', () => send('launcher:changed'));
  delivery.on('job', j => launcher.onJob(j));

  bridge.on('state', s => send('bridge:state', s));
  for (const em of [lister, repricer, delivery, launcher]) em.on('log', e => send('log', e));
  lister.on('progress', p => send('autolist:progress', p));
  lister.on('pets', () => send('pets:changed'));
  lister.on('finished', p => discord(store, { title: '📦 Auto List finished', description: `${p.ok} listed, ${p.failed} failed` }));
  repricer.on('done', r => send('repricer:done', r));
  watcher.on('sale', ({ order, pets }) => { send('sale', order); send('pets:changed'); delivery.onSale(order, pets); });
  watcher.on('dispute', o => send('dispute', o));
  watcher.on('notification', n => send('notification', n));
  watcher.on('unread', (n) => send('unread', n));
  watcher.on('orders', rows => send('orders', rows));
  delivery.on('update', d => send('delivery:update', d));
  delivery.on('job', j => send('delivery:job', j));
  delivery.on('petsChanged', () => send('pets:changed'));
  delivery.on('message', m => send('talk:message', m));
  // public picture URL of a brainrot (SAB wiki) for Discord cards
  delivery.petImageUrl = async name => ((await wiki.index()) || {})[sab.norm(name)] || null;
  delivery.on('proof', p => send('proof', p));
  ipcMain.on('bridge:event', (_e, { type, payload }) => { if (type === 'talk:message') delivery.onMessage(payload); });

  try { syncAutoexec(); } catch (e) { store.log('warn', '[Autoexec] ' + e.message); }
  startLocalServer({ store, bridge, delivery, onServerScan: saveServerScan, onAgentClosing: acc => launcher.closeGame(acc), importScan: data => { const r = importPets(data, null, { replace: true }); refreshAvatarsSoon(); store.log('info', `[Scanner] ${data && data.username}: ${r.added} pets synced`); return r; }, onCookies: () => { send('auth:changed'); afterLogin(); } });
}

async function afterLogin() {
  try {
    await eld.me(true);
    send('auth:changed');
    watcher.start();
    repricer.schedule();
    if (store.get('settings').delivery.enabled) delivery.ensureTalk();
  } catch { /* not logged in yet */ }
}

// Import pets from any supported JSON. replace=true (plot scanner sync) first drops the
// account's still-available pets, so a rescan does not duplicate them.
function importPets(json, accountId, { replace = false } = {}) {
  const raw = typeof json === 'string' ? JSON.parse(json) : json;
  if (raw && raw.art) art.remember(raw.art);
  const accounts = store.get('accounts');
  const fixed = accounts.find(a => a.id === accountId);
  const items = sab.normalizePetImport(raw, fixed ? fixed.username : '');
  const added = [];
  let removed = 0;
  if (replace) {
    const names = new Set(items.map(it => String(it.account || (fixed && fixed.username) || '').toLowerCase()).filter(Boolean));
    if (!items.length && raw && raw.username) names.add(String(raw.username).toLowerCase());
    const ids = new Set(accounts.filter(a => names.has(a.username.toLowerCase())).map(a => a.id));
    const before = store.get('pets').length;
    // a scan that could not read traits must not wipe the traits we already know
    if (raw && raw.traitsKnown === false) {
      const old = {};
      for (const p of store.get('pets')) if (ids.has(p.accountId) && (p.traits || []).length) (old[sab.norm(p.name) + '|' + sab.norm(p.mutation)] ||= []).push(p.traits);
      for (const it of items) {
        const q = old[sab.norm(it.name) + '|' + sab.norm(it.mutation || 'None')];
        if ((!it.traits || !it.traits.length) && q && q.length) it.traits = q.shift();
      }
    }
    store.set('pets', store.get('pets').filter(p => !(ids.has(p.accountId) && p.status === 'available')));
    removed = before - store.get('pets').length;
  }
  // Pets of this account that are already listed: a rescan must not re-add them.
  const listedLeft = replace ? store.get('pets').filter(p => p.status === 'listed') : [];
  for (const it of items) {
    let acct = fixed;
    if (!acct && it.account) {
      acct = accounts.find(a => a.username.toLowerCase() === String(it.account).toLowerCase());
      if (!acct) { acct = { id: rid(6), username: String(it.account), note: '', createdAt: Date.now() }; accounts.push(acct); }
      if (raw && raw.userId && String(raw.username || '').toLowerCase() === acct.username.toLowerCase()) acct.robloxUserId = raw.userId;
    }
    if (replace && acct) {
      const i = listedLeft.findIndex(p => p.accountId === acct.id && sab.norm(p.name) === sab.norm(it.name) && sab.norm(p.mutation) === sab.norm(it.mutation || 'None'));
      if (i >= 0) { listedLeft.splice(i, 1); continue; }
    }
    const pet = { id: rid(6), accountId: acct ? acct.id : null, name: it.name, mutation: it.mutation || 'None', gen: it.gen || 0, traits: it.traits || [], rarity: it.rarity || '', cost: it.cost || 0, status: it.offerId ? 'listed' : 'available', offerId: it.offerId || null, price: it.price || null, createdAt: Date.now() };
    store.get('pets').push(pet); added.push(pet);
  }
  store.save(); send('pets:changed');
  return { added: added.length, removed, accounts: accounts.length };
}

function scannerScript(which = 'scanner') {
  const s = store.get('settings');
  const file = path.join(__dirname, 'scanner', which === 'delivery' ? 'zotac_delivery.lua' : 'zotac_scanner.lua');
  return fs.readFileSync(file, 'utf8')
    .replace('local ZOTAC_PORT  = 47321', `local ZOTAC_PORT  = ${s.localPort || 47321}`)
    .replace('local ZOTAC_TOKEN = "PASTE_AGENT_TOKEN"', `local ZOTAC_TOKEN = "${s.agentToken}"`);
}

// Delivery agent in the executor's autoexec, so it starts by itself in every Roblox client the
// executor attaches to (Zotac launches + closes stock accounts per order). Synapse Z always gets
// it; Volt / Real only keep an existing copy current. Rewritten on every start and token change,
// so autoexec never runs a stale version or an old token.
function syncAutoexec() {
  const base = process.env.LOCALAPPDATA || '';
  const targets = [
    { dir: path.join(base, 'Synapse Z', 'autoexec'), always: true },
    { dir: path.join(base, 'Volt', 'autoexec'), always: false },
    { dir: path.join(base, 'Real', 'autoexec'), always: false }
  ];
  const script = scannerScript('delivery');
  const done = [];
  for (const t of targets) {
    const f = path.join(t.dir, 'zotac_delivery.lua');
    try { const old = path.join(t.dir, 'meowl_delivery.lua'); if (fs.existsSync(old)) { fs.unlinkSync(old); if (!fs.existsSync(f)) fs.writeFileSync(f, ''); } } catch { /* in use */ }
    try {
      if (!fs.existsSync(t.dir) || (!t.always && !fs.existsSync(f))) continue;
      if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === script) { done.push(f); continue; }
      fs.writeFileSync(f, script);
      done.push(f);
    } catch (e) { store.log('warn', `[Autoexec] ${f}: ${e.message}`); }
  }
  if (done.length) store.log('info', '[Autoexec] delivery agent installed: ' + done.join(', '));
  return done;
}

// --- IPC ------------------------------------------------------------------
function handle(ch, fn) {
  ipcMain.handle(ch, async (_e, ...args) => {
    try { return { ok: true, value: await fn(...args) }; }
    catch (e) { return { ok: false, error: e.message, status: e.status, data: e.data }; }
  });
}

function ipc() {
  handle('app:info', async () => ({
    version: app.getVersion(), bridge: bridge.state, lastOk: bridge.lastOk, talk: delivery.talkState, talkError: delivery.talkError,
    agentOnline: delivery.agentOnline(), userData: app.getPath('userData'), lister: lister.progress, listerRunning: lister.running,
    repricerLast: repricer.lastRun, watcherLast: watcher.lastPoll,
    extensionPath: fs.existsSync(path.join(__dirname, 'extension')) ? path.join(__dirname, 'extension') : path.join(process.resourcesPath, 'extension')
  }));
  handle('win', a => { if (!win) return; if (a === 'min') win.minimize(); else if (a === 'max') win.isMaximized() ? win.unmaximize() : win.maximize(); else if (a === 'close') win.close(); });
  handle('open:external', url => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
  handle('open:path', p => shell.openPath(p));

  // auth
  handle('auth:loginBrowser', () => new Promise(resolve => {
    const w = new BrowserWindow({ width: 520, height: 760, parent: win, modal: false, title: 'Login to Eldorado', autoHideMenuBar: true, webPreferences: { partition: PARTITION } });
    w.loadURL(ORIGIN + '/sell/place-offer');
    let done = false;
    const check = async () => {
      if (done || w.isDestroyed()) return;
      const u = w.webContents.getURL();
      if (u.startsWith(ORIGIN) && !/auth-callback/.test(u)) {
        await bridge.reload();
        try { const me = await eld.me(true); if (me && (me.id || me.username)) { done = true; w.close(); await afterLogin(); resolve(me); } } catch { /* keep waiting */ }
      }
    };
    w.webContents.on('did-navigate', check);
    w.webContents.on('did-navigate-in-page', check);
    w.on('closed', async () => { if (!done) { await bridge.reload(); try { resolve(await eld.me(true)); afterLogin(); } catch { resolve(null); } } });
  }));
  handle('auth:cookie', async str => { const n = await bridge.setCookieString(str); const me = await eld.me(true); afterLogin(); return { set: n, me }; });
  handle('auth:logout', async () => { watcher.stop(); await bridge.logout(); eld.cache.me = null; return true; });
  handle('auth:me', () => eld.me(true));

  // eldorado
  handle('eld:dashboard', () => eld.dashboard());
  handle('eld:wallet', () => eld.wallet());
  handle('eld:orders', q => eld.soldOrders(q || {}));
  handle('eld:order', id => eld.order(id));
  handle('eld:deliver', id => eld.deliverOrder(id));
  handle('eld:notifications', unread => eld.notifications(unread));
  handle('eld:markRead', id => eld.markRead(id));
  handle('eld:markAllRead', () => eld.markAllRead());
  handle('eld:reviews', p => eld.reviews(p));
  handle('eld:search', q => eld.searchMarket(q));
  handle('eld:myOffers', st => eld.myOffersAll(st));
  handle('eld:offerAction', async (id, action, arg) => {
    if (action === 'pause') return eld.pauseOffer(id);
    if (action === 'resume') return eld.resumeOffer(id);
    if (action === 'delete') { const r = await eld.deleteOffer(id); for (const p of store.get('pets')) if (p.offerId === id && p.status === 'listed') { p.status = 'available'; p.offerId = null; } store.save(); send('pets:changed'); return r; }
    if (action === 'price') return eld.setPrice(id, arg);
    throw new Error('bad action');
  });
  handle('eld:items', () => eld.itemList());
  handle('eld:attrs', async () => { await eld.library(); return { attrs: eld.cache.attrs, game: store.get('settings').game }; });
  handle('eld:reloadLibrary', () => eld.library(true).then(() => eld.itemList()));
  handle('eld:raw', (method, p, body, query) => bridge.request(method, p, { body, query }));
  handle('eld:message', (orderId, text) => eld.sendOrderMessage(orderId, text));
  handle('chat:history', (orderId, conversationId) => delivery.history(orderId, conversationId));
  handle('chat:buyerRoblox', async orderId => { try { const v = await eld.deliveryDetail(orderId); return typeof v === 'string' ? v : (v && (v.value || v.username)) || null; } catch { return null; } });
  handle('eld:profile', u => eld.publicProfile(u));

  // pricing
  handle('price:smart', async petOrId => {
    const pet = typeof petOrId === 'string' ? store.get('pets').find(p => p.id === petOrId) : petOrId;
    let myId = null; try { const me = await eld.me(); myId = me.id || me.userId; } catch { /* logged out is fine */ }
    return smartPrice(eld, pet, store.get('settings'), myId);
  });

  // pets
  handle('pets:list', () => store.get('pets'));
  handle('server:scans', () => Object.values(serverScans).sort((a, b) => b.receivedAt - a.receivedAt));
  handle('pets:import', (json, accountId) => {
    const before = new Set(store.get('pets').map(p => p.id));
    const beforeAcc = new Set(store.get('accounts').map(a => a.id));
    const r = importPets(json, accountId);
    for (const p of store.get('pets')) if (!before.has(p.id)) p.session = true;
    // accounts a paste created (often other players' bases) go away with their pets
    for (const a of store.get('accounts')) if (!beforeAcc.has(a.id)) a.session = true;
    refreshAvatarsSoon();
    store.save();
    return r;
  });
  handle('scanner:script', which => scannerScript(which));
  handle('art:for', pet => artFor(pet, (store.get('settings').autolist || {}).imageFolder));
  // card thumbnails: { pets: {name: dataUrl}, traits: {name: dataUrl}, mutations: {...} },
  // shrunk once with nativeImage and cached in userData/art/thumbs
  handle('art:thumbs', async ({ pets = [], traits = [], mutations = [] } = {}) => {
    const dir = path.join(app.getPath('userData'), 'art', 'thumbs');
    fs.mkdirSync(dir, { recursive: true });
    const thumb = async (kind, name, size, source) => {
      const f = path.join(dir, kind + '-' + sab.norm(name) + '-' + size + '.png');
      if (fs.existsSync(f)) return 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
      const url = await source().catch(() => null);
      if (!url) return null;
      let img = nativeImage.createFromDataURL(url);
      if (img.isEmpty()) return null;
      const { width, height } = img.getSize();
      if (Math.max(width, height) > size) img = img.resize(width >= height ? { width: size, quality: 'best' } : { height: size, quality: 'best' });
      const png = img.toPNG();
      fs.writeFileSync(f, png);
      return 'data:image/png;base64,' + png.toString('base64');
    };
    const out = { pets: {}, traits: {}, mutations: {} };
    await Promise.all([
      ...[...new Set(pets)].map(async n => { out.pets[n] = await thumb('pet', n, 220, async () => localPetImage((store.get('settings').autolist || {}).imageFolder, n) || await wiki.picture(n) || await art.petPicture(n, 'None')); }),
      ...[...new Set(traits)].map(async n => { out.traits[n] = await thumb('trait', n, 48, () => art.dataUrl('traits', n)); }),
      ...[...new Set(mutations)].map(async n => { out.mutations[n] = await thumb('mut', n, 48, () => art.dataUrl('mutations', n)); })
    ]);
    return out;
  });
  handle('art:status', () => art.status());
  // the card saved by "Generate Images" for a pet, as a data URL (null when missing)
  // small preview of a pet's generated card for the Auto List rows
  handle('art:cardThumb', id => {
    const p = store.get('pets').find(x => x.id === id);
    if (!p || !p.imagePath || !fs.existsSync(p.imagePath)) return null;
    let img = nativeImage.createFromPath(p.imagePath);
    if (img.isEmpty()) return null;
    img = img.resize({ width: 112, quality: 'best' });
    return 'data:image/png;base64,' + img.toPNG().toString('base64');
  });
  handle('art:card', id => {
    const p = store.get('pets').find(x => x.id === id);
    if (!p || !p.imagePath || !fs.existsSync(p.imagePath)) return null;
    return 'data:image/png;base64,' + fs.readFileSync(p.imagePath).toString('base64');
  });
  handle('pets:add', p => { const pet = { id: rid(6), status: 'available', mutation: 'None', traits: [], cost: 0, createdAt: Date.now(), manual: true, ...p, gen: sab.parseGen(p.gen) }; store.get('pets').push(pet); store.save(); send('pets:changed'); return pet; });
  handle('pets:update', (ids, patch) => {
    const set = new Set([].concat(ids));
    for (const p of store.get('pets')) if (set.has(p.id)) { Object.assign(p, patch); if (patch.gen !== undefined) p.gen = sab.parseGen(patch.gen); if (patch.status === 'sold' && !p.soldAt) p.soldAt = Date.now(); }
    store.save(); send('pets:changed'); return true;
  });
  handle('pets:delete', ids => { const set = new Set(ids); store.set('pets', store.get('pets').filter(p => !set.has(p.id))); send('pets:changed'); return true; });
  handle('pets:quickFill', (ids, tpl) => {
    const al = store.get('settings').autolist;
    const accounts = store.get('accounts');
    for (const p of store.get('pets')) {
      if (!ids.includes(p.id)) continue;
      const acct = accounts.find(a => a.id === p.accountId);
      const vars = { account: acct && acct.username, emoji: al.emoji };
      if (tpl.title !== undefined) p.title = tpl.title ? sab.fillTemplate(tpl.title, p, vars) : '';
      if (tpl.description !== undefined) p.description = tpl.description ? sab.fillTemplate(tpl.description, p, vars) : '';
      if (tpl.deliveryTime) p.deliveryTime = tpl.deliveryTime;
      if (tpl.price !== undefined && tpl.price !== '' && tpl.price !== null) { p.price = Number(tpl.price); p.priceLocked = true; }
      if (tpl.clearPrice) { p.price = null; p.priceLocked = false; }
    }
    void al; store.save(); send('pets:changed'); return true;
  });
  // "Generate Images": render each pet's listing card once and keep it in userData/art/cards;
  // Auto List uploads the saved card instead of rendering again
  handle('pets:generateImages', async ids => {
    const dir = path.join(app.getPath('userData'), 'art', 'cards');
    fs.mkdirSync(dir, { recursive: true });
    const al = store.get('settings').autolist || {};
    let idx = null; try { idx = await eld.itemIndex(); } catch { /* rarity is optional */ }
    const out = { ok: 0, failed: 0, errors: [] };
    for (const p of store.get('pets').filter(x => ids.includes(x.id))) {
      try {
        const item = idx ? sab.findItem(idx, p.name) : null;
        const b64 = await renderImage({ pet: p, rarity: (item && item.rarity) || p.rarity, imageFolder: al.imageFolder });
        if (!b64) throw new Error('empty image');
        const f = path.join(dir, String(p.id).replace(/[^\w-]/g, '') + '.png');
        fs.writeFileSync(f, Buffer.from(b64, 'base64'));
        p.imagePath = f; p.imageAt = Date.now(); out.ok++;
        send('pets:changed');
      } catch (e) { out.failed++; out.errors.push(`${p.name}: ${e.message}`); }
    }
    store.save(); send('pets:changed'); return out;
  });
  handle('pets:markSold', (ids, price) => {
    for (const p of store.get('pets')) if (ids.includes(p.id)) {
      p.status = 'sold'; p.soldAt = Date.now(); p.soldPrice = price != null && price !== '' ? Number(price) : (p.soldPrice || p.price || 0);
      store.get('sales').unshift({ id: rid(6), orderId: null, title: `${p.name} ${p.mutation !== 'None' ? p.mutation : ''}`.trim(), price: p.soldPrice, buyer: '', date: new Date().toISOString(), petIds: [p.id], source: 'manual' });
    }
    store.save(); send('pets:changed'); return true;
  });

  // accounts
  const publicAccount = ({ cookieEnc, ...a }) => ({ ...a, hasCookie: !!cookieEnc });
  handle('accounts:list', () => store.get('accounts').map(publicAccount));
  handle('accounts:setCookie', (id, cookie) => launcher.setCookie(id, cookie));
  handle('accounts:loginBrowser', async id => { const r = await launcher.loginBrowser(id || null, win); send('pets:changed'); return r; });
  handle('accounts:launch', (id, force) => launcher.launch(id, { force: !!force }));
  handle('accounts:launchAll', async () => { const out = []; for (const a of store.get('accounts').filter(x => x.cookieEnc)) { try { out.push({ username: a.username, ...(await launcher.launch(a.id)) }); } catch (e) { out.push({ username: a.username, error: e.message }); } await new Promise(r => setTimeout(r, 4000)); } return out; });
  handle('launcher:status', () => launcher.status());
  handle('launcher:fix', () => launcher.resetMultiInstance());
  handle('accounts:save', async a => {
    const list = store.get('accounts');
    let acct = list.find(x => x.id === a.id);
    if (!acct) { acct = { id: rid(6), createdAt: Date.now() }; list.push(acct); }
    const { cookieEnc, hasCookie, ...clean } = a; void cookieEnc; void hasCookie;
    Object.assign(acct, clean, { id: acct.id });
    if (acct.username && !acct.robloxUserId) {
      try { const u = await robloxUser(acct.username); if (u) { acct.robloxUserId = u.id; acct.displayName = u.displayName; acct.avatar = await robloxAvatar(u.id); } } catch { /* offline */ }
    }
    store.save(); return publicAccount(acct);
  });
  handle('accounts:delete', (id, withPets) => {
    store.set('accounts', store.get('accounts').filter(a => a.id !== id));
    if (withPets) store.set('pets', store.get('pets').filter(p => p.accountId !== id));
    else for (const p of store.get('pets')) if (p.accountId === id) p.accountId = null;
    store.save(); send('pets:changed'); return true;
  });
  handle('accounts:export', () => JSON.stringify({ format: 'zotac-accounts', version: 1, accounts: store.get('accounts').map(a => ({ ...publicAccount(a), pets: store.get('pets').filter(p => p.accountId === a.id) })) }, null, 2));
  handle('accounts:import', json => {
    const j = typeof json === 'string' ? JSON.parse(json) : json;
    const src = Array.isArray(j) ? j : j.accounts || [];
    let na = 0, np = 0;
    for (const a of src) {
      const list = store.get('accounts');
      let acct = list.find(x => x.username && a.username && x.username.toLowerCase() === a.username.toLowerCase());
      if (!acct) { acct = { id: rid(6), username: a.username || a.name || 'account', note: a.note || '', robloxUserId: a.robloxUserId || null, avatar: a.avatar || null, createdAt: Date.now() }; list.push(acct); na++; }
      for (const p of a.pets || []) { store.get('pets').push({ ...p, id: rid(6), accountId: acct.id, gen: sab.parseGen(p.gen) }); np++; }
    }
    store.save(); send('pets:changed'); return { accounts: na, pets: np };
  });

  // simple collections
  for (const key of ['templates', 'expenses', 'sales']) {
    handle(`${key}:list`, () => store.get(key));
    handle(`${key}:save`, item => {
      const list = store.get(key);
      const ex = item.id && list.find(x => x.id === item.id);
      if (ex) Object.assign(ex, item); else list.unshift({ ...item, id: rid(6), createdAt: Date.now() });
      store.save(); return true;
    });
    handle(`${key}:delete`, id => { store.set(key, store.get(key).filter(x => x.id !== id)); return true; });
  }

  // automation
  handle('autolist:start', (ids, opts) => { lister.start(ids, opts).catch(() => {}); return true; });
  handle('autolist:stop', () => lister.stop());
  handle('repricer:run', ids => repricer.run(ids));
  handle('delivery:list', () => ({ deliveries: Object.values(store.get('deliveries')).sort((a, b) => b.createdAt - a.createdAt), jobs: store.get('jobs').slice(-100).reverse() }));
  handle('delivery:manual', (orderId, action, arg) => delivery.manual(orderId, action, arg));
  handle('delivery:testJob', (petId, buyer) => delivery.testJob(petId, buyer));
  handle('delivery:simulate', (petIds, buyer) => delivery.simulate(petIds, buyer));
  handle('delivery:simSay', (orderId, text) => delivery.simSay(orderId, text));
  handle('delivery:simState', orderId => delivery.simState(orderId));
  handle('delivery:cancelJob', id => delivery.cancelJob(id));
  handle('agent:syncAutoexec', () => syncAutoexec());
  // diagnostics: raw Eldorado answers for the image upload (no listing is created)
  handle('eld:testUpload', async b64 => bridge.request('POST', 'files/me/Offer', { form: { image: { base64: b64, filename: 'test.png', type: 'image/png' } } }));
  handle('delivery:jobs', () => store.get('jobs').slice(-20));
  handle('delivery:talk', () => { delivery.talkState = 'off'; return delivery.ensureTalk(); });
  handle('roblox:user', u => robloxUser(u));

  // settings / data
  handle('settings:get', () => store.get('settings'));
  handle('settings:set', patch => {
    const s = store.patchSettings(patch);
    if (patch.repricer) repricer.schedule();
    if (patch.game) { eld.cache.library = null; }
    if (patch.delivery && patch.delivery.enabled) delivery.ensureTalk();
    return s;
  });
  handle('settings:regenToken', which => { const s = store.get('settings'); s[which] = rid(8); store.save(); if (which === 'agentToken') syncAutoexec(); return s[which]; });
  handle('webhook:test', () => discord(store, { title: '🐾 Zotac Lister test', description: 'Webhook works!', ping: true }));
  handle('logs:get', () => store.get('logs').slice(-600));
  handle('logs:clear', () => { store.set('logs', []); return true; });
  handle('data:export', async () => {
    const r = await dialog.showSaveDialog(win, { defaultPath: `zotac-backup-${new Date().toISOString().slice(0, 10)}.json` });
    if (r.canceled) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(store.get(), null, 1));
    return r.filePath;
  });
  handle('data:import', async () => {
    const r = await dialog.showOpenDialog(win, { filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled) return null;
    const j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    for (const k of Object.keys(j)) if (k in store.data) store.data[k] = j[k];
    store.save(); send('pets:changed'); return true;
  });
  handle('data:reset', () => { store.reset(); send('pets:changed'); return true; });
  handle('dialog:folder', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
  handle('update:check', () => { const u = store.get('settings').autoUpdate; return checkUpdate(u.repo, u.installedSha); });
  handle('update:install', info => installUpdate(info, updateHooks));

  // video proof
  handle('proof:save', (orderId, b64) => {
    const f = path.join(proofDir(), `${String(orderId || 'manual').replace(/[^\w-]/g, '')}-${Date.now()}.webm`);
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    store.log('info', '[Proof] saved ' + path.basename(f));
    return f;
  });
  handle('proof:list', () => fs.readdirSync(proofDir()).filter(f => f.endsWith('.webm')).map(f => {
    const st = fs.statSync(path.join(proofDir(), f));
    return { name: f, path: path.join(proofDir(), f), size: st.size, date: st.mtimeMs };
  }).sort((a, b) => b.date - a.date));
  handle('proof:delete', f => { const p = path.join(proofDir(), path.basename(f)); fs.unlinkSync(p); return true; });
  handle('proof:dir', () => proofDir());
}

// --- smoke test (no visible window) -----------------------------------------
async function smoke() {
  const out = { steps: [] };
  const step = async (name, fn) => { try { const v = await fn(); out.steps.push({ name, ok: true, v }); } catch (e) { out.steps.push({ name, ok: false, err: e.message }); } };
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await step('renderer pages', () => win.webContents.executeJavaScript('window.__smoke && window.__smoke()', true));
  await step('library', async () => { const l = await eld.itemList(); return l.length + ' items, attrs=' + (eld.cache.attrs || []).map(a => a.id).join(','); });
  await step('find Grabatron', async () => sab.findItem(await eld.itemIndex(), 'grabatron'));
  await step('market search', async () => { const r = await eld.searchMarket({ name: 'Grabatron', sort: 'priceAsc', pageSize: 5 }); return listOf(r).length + ' / ' + r.recordCount; });
  if (process.env.ZOTAC_PRICE_TEST) await step('price test', async () => {
    const out = [];
    for (const p of JSON.parse(process.env.ZOTAC_PRICE_TEST)) {
      try { const r = await smartPrice(eld, p, store.get('settings'), null); out.push(`${p.name} ${p.mutation}: ${r.price} (${r.basis}, ${r.comps.length} comps)`); }
      catch (e) { out.push(`${p.name} ${p.mutation}: ERROR ${e.message}`); }
    }
    return out;
  });
  await step('smartPrice', async () => { const r = await smartPrice(eld, { name: 'Grabatron', mutation: 'None', gen: 62.5e6 }, store.get('settings'), null); return { price: r.price, basis: r.basis, comps: r.comps.length }; });
  await step('payload', async () => { const p = await eld.buildOfferPayload({ name: 'Grabatron', mutation: 'Gold', gen: 78.1e6, traits: ['Taco', 'Fire'] }, { title: 't', description: 'd', price: 9.99, deliveryTime: 'Minute20' }); delete p._item; return p; });
  await step('image render', async () => { const b = await renderImage({ pet: { name: 'Grabatron', mutation: 'Gold', gen: 78.1e6, traits: ['Taco'], price: 9.99 }, rarity: 'Secret' }); fs.writeFileSync(path.join(app.getPath('temp'), 'zotac-smoke.png'), Buffer.from(b, 'base64')); return b.length + ' b64 chars'; });
  await step('generate card', async () => {
    const r = await win.webContents.executeJavaScript("M.call('pets:add', { name: 'Grabatron', mutation: 'Gold', gen: '78.1M', traits: ['Taco'] }).then(p => M.call('pets:generateImages', [p.id]).then(r => M.call('pets:list').then(l => { const x = l.find(q => q.id === p.id); return M.call('pets:delete', [p.id]).then(() => ({ ...r, imagePath: x && x.imagePath })); })))", true);
    if (!r.ok || !r.imagePath || !fs.existsSync(r.imagePath)) throw new Error('card not saved: ' + JSON.stringify(r));
    fs.copyFileSync(r.imagePath, path.join(app.getPath('temp'), 'zotac-smoke-card.png'));
    return r.imagePath;
  });
  await step('game art render', async () => {
    art.remember({ pets: { Meowl: '80231998122393' }, traits: { Taco: '83113056007315' } });
    const b = await renderImage({ pet: { name: 'Meowl', mutation: 'Eclipse', gen: 1.4e9, traits: ['Taco', 'Fire', 'Bubblegum'] }, rarity: 'OG' });
    fs.writeFileSync(path.join(app.getPath('temp'), 'zotac-smoke-art.png'), Buffer.from(b, 'base64'));
    return art.status();
  });
  await step('3d model render', async () => {
    const parts = [
      { cls: 'Part', shape: 'Block', size: [2, 3, 1], cf: [0, 1.5, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], color: 'f2b631', transparency: 0 },
      { cls: 'Part', shape: 'Ball', size: [2, 2, 2], cf: [0, 4, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], color: 'ff8fd0', transparency: 0 },
      { cls: 'Part', shape: 'Cylinder', size: [3, 0.6, 0.6], cf: [0, 2.2, -0.6, 1, 0, 0, 0, 1, 0, 0, 0, 1], color: '4fa3f7', transparency: 0 }];
    const url = await rendererCall('renderModel', { parts, meshes: {}, textures: {} }, 30000);
    fs.writeFileSync(path.join(app.getPath('temp'), 'zotac-smoke-3d.png'), Buffer.from(url.split(',')[1], 'base64'));
    return url.length + ' chars';
  });
  await step('card thumbnails', () => win.webContents.executeJavaScript(
    "M.call('art:thumbs', { pets: ['Rubrikiko', 'Garama and Madundung'], traits: ['Taco'] }).then(r => Object.entries(r.pets).map(([k, v]) => k + ':' + (v ? Math.round(v.length / 1024) + 'KB' : 'none')).join(', '))", true));
  await step('import parse', () => sab.normalizePetImport({ accounts: { alt1: [{ Name: 'Grabatron', Mutation: 'Gold', Gen: '78.1M/s', Traits: 'Taco, Fire' }] } }).length);
  await step('logged in?', async () => { try { const m = await eld.me(true); return m.username; } catch (e) { return 'no: ' + e.message.slice(0, 80); } });
  await step('local server', async () => (await fetch(`http://127.0.0.1:${store.get('settings').localPort}/ping`)).json());
  console.log('SMOKE_RESULT ' + JSON.stringify(out, null, 1));
  app.exit(out.steps.every(s => s.ok) ? 0 : 1);
}

app.whenReady().then(async () => {
  if (SMOKE) app.setPath('userData', path.join(app.getPath('temp'), 'zotac-smoke-data'));
  wire();
  ipc();
  setupCapture();
  createWindow();
  if (store.get('settings').bridgeUserAgent) bridge.setUserAgent(store.get('settings').bridgeUserAgent);
  bridge.start().then(afterLogin);
  if (SMOKE) return smoke();
  const s = store.get('settings');
  refreshAvatarsSoon(5000);
  setInterval(() => refreshAvatarsSoon(0), 6 * 3600e3);
  if (s.autoUpdate.enabled) {
    // "Update automatically": a newer version is installed right away and the app restarts
    setTimeout(async () => {
      try {
        const u = await checkUpdate(s.autoUpdate.repo, s.autoUpdate.installedSha);
        if (u.error) return store.log('warn', '[Update] ' + u.error);
        if (!u.newer) return;
        send('update:available', u);
        if (u.mode === 'source' || (u.mode === 'release' && u.asset)) { store.log('info', `[Update] installing ${u.latest}`); await installUpdate(u, updateHooks); }
      } catch (e) { store.log('warn', '[Update] ' + e.message); }
    }, 8000);
  }
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { try { store.flush(); } catch { /* ignore */ } try { launcher && launcher.stop(); } catch { /* ignore */ } app.quit(); });
