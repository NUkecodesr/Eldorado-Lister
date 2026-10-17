// Roblox account launcher: opens a stock account's Roblox client (in the private
// server when one is set) from its saved .ROBLOSECURITY cookie, so its in-game
// delivery script can pick up jobs. Cookies are encrypted with Electron safeStorage
// (Windows DPAPI) and never sent to the renderer.
const { shell, safeStorage, BrowserWindow, session } = require('electron');
const { spawn, execFile } = require('child_process');
const EventEmitter = require('events');

const SAB_PLACE_ID = 109983668079237;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function encryptCookie(cookie) {
  const v = String(cookie || '').trim().replace(/^\.ROBLOSECURITY=/, '').replace(/;.*$/, '');
  if (!v) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption (DPAPI) not available');
  return safeStorage.encryptString(v).toString('base64');
}
function decryptCookie(enc) {
  if (!enc) return null;
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return null; }
}

// fetch with the account cookie; retries once with the x-csrf-token Roblox hands back on 403.
async function rbx(cookie, url, { method = 'GET', body, headers = {} } = {}) {
  let csrf = '';
  for (let i = 0; i < 2; i++) {
    const r = await fetch(url, {
      method,
      headers: { Cookie: `.ROBLOSECURITY=${cookie}`, 'User-Agent': UA, Referer: 'https://www.roblox.com/', Origin: 'https://www.roblox.com', 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const next = r.headers.get('x-csrf-token');
    if (r.status === 403 && next && !csrf) { csrf = next; continue; }
    return r;
  }
  throw new Error('csrf retry failed');
}

async function whoAmI(cookie) {
  const r = await rbx(cookie, 'https://users.roblox.com/v1/users/authenticated');
  if (r.status === 401) throw new Error('Cookie invalid or expired');
  if (!r.ok) throw new Error('Roblox HTTP ' + r.status);
  return r.json(); // { id, name, displayName }
}

async function authTicket(cookie) {
  const r = await rbx(cookie, 'https://auth.roblox.com/v1/authentication-ticket', { method: 'POST', body: {}, headers: { RBXAuthenticationNegotiation: '1' } });
  const t = r.headers.get('rbx-authentication-ticket');
  if (!t) throw new Error(r.status === 401 ? 'Cookie invalid or expired' : 'No auth ticket (HTTP ' + r.status + ')');
  return t;
}

// Accepts a classic ?privateServerLinkCode= link, a share link (?code=..&type=Server) or a bare share code.
const NO_PS = 'No private server link set: Zotac never launches an account into a public server. Add your private server link in Roblox Accounts > Account Settings.';

// share link -> link code: the same link always resolves the same, so it is looked up once per 30 min
const psCache = new Map();
async function resolvePrivateServer(link, cookie) {
  const s = String(link || '').trim();
  if (!s) return null;
  const hit = psCache.get(s);
  if (hit && Date.now() - hit.at < 30 * 60000) return hit.ps;
  const ps = await resolvePrivateServerNow(s, cookie);
  if (ps) psCache.set(s, { ps, at: Date.now() });
  return ps;
}
async function resolvePrivateServerNow(s, cookie) {
  const classic = s.match(/privateServerLinkCode=([\w-]+)/i);
  if (classic) {
    const place = s.match(/games\/(\d+)/);
    return { placeId: place ? Number(place[1]) : SAB_PLACE_ID, linkCode: classic[1] };
  }
  const share = s.match(/[?&]code=([\w-]+)/i);
  const code = share ? share[1] : (/^[\w-]{16,}$/.test(s) ? s : null);
  if (!code) throw new Error('Unrecognised private server link');
  const r = await rbx(cookie, 'https://apis.roblox.com/sharelinks/v1/resolve-link', { method: 'POST', body: { linkId: code, linkType: 'Server' } });
  if (!r.ok) throw new Error('Share link resolve HTTP ' + r.status);
  const j = await r.json();
  const d = j.privateServerInviteData;
  if (!d || !d.linkCode) throw new Error('Share link has no private server (' + (d && d.status || 'unknown') + ')');
  return { placeId: Number(d.placeId) || SAB_PLACE_ID, linkCode: d.linkCode };
}

function launchUri(ticket, placeId, linkCode) {
  const bt = String(Math.floor(1e11 + Math.random() * 9e11));
  const pl = linkCode
    ? `https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestPrivateGame&browserTrackerId=${bt}&placeId=${placeId}&linkCode=${linkCode}&isPlayTogetherGame=false`
    : `https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestGame&browserTrackerId=${bt}&placeId=${placeId}&isPlayTogetherGame=false`;
  return `roblox-player:1+launchmode:play+gameinfo:${ticket}+launchtime:${Date.now()}+placelauncherurl:${encodeURIComponent(pl)}+browsertrackerid:${bt}+robloxLocale:en_us+gameLocale:en_us+channel:+LaunchExp:InApp`;
}

// PIDs of running Roblox player processes (Windows tasklist, CSV)
function robloxPids() {
  return new Promise(res => execFile('tasklist', ['/FI', 'IMAGENAME eq RobloxPlayerBeta.exe', '/FO', 'CSV', '/NH'], { windowsHide: true }, (err, out) => {
    if (err) return res([]);
    res(String(out).split(/\r?\n/).map(l => (l.match(/^"RobloxPlayerBeta\.exe","(\d+)"/) || [])[1]).filter(Boolean).map(Number));
  }));
}

// pid -> command line of running Roblox players (the launch URI carries our browsertrackerid)
function robloxCmdlines() {
  return new Promise(res => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='RobloxPlayerBeta.exe'\" | ForEach-Object { [string]$_.ProcessId + '|' + $_.CommandLine }"],
  { windowsHide: true, timeout: 10000 }, (err, out) => {
    if (err) return res([]);
    res(String(out).split(/\r?\n/).map(l => { const i = l.indexOf('|'); return i > 0 ? { pid: Number(l.slice(0, i)), cmd: l.slice(i + 1) } : null; }).filter(x => x && x.pid));
  }));
}

class Launcher extends EventEmitter {
  constructor({ store, delivery }) {
    super();
    this.store = store; this.delivery = delivery;
    this.lastLaunch = {};   // accountId -> ts
    this.holder = null;     // multi-instance mutex holder process
    this.pids = {};         // accountId -> Roblox process Zotac launched for it
    this.mode = {};         // accountId -> 'script' | 'legit' (how Zotac last opened it)
    this.legit = null;      // LegitRoblox (set by main)
    // a waiting delivery job whose account dropped out of the game (client closed, kicked)
    // gets its account launched again; checked every 20s, launch cooldown still applies
    this.sweep = setInterval(() => {
      for (const j of this.store.get('jobs')) if (j.status === 'pending' && Date.now() - j.createdAt > 15000) this.onJob(j);
      this.checkLegitClean().catch(() => {});
    }, 20000);
    this.attachWarned = {};  // accountId -> launch time already warned about
    this.closing = {};       // accountId -> ts: closed on purpose (by Zotac or by its agent)
    // a game Zotac opened that crashed, was closed, froze or sits on Roblox's error screen while a
    // delivery job needs it: ended and opened again (checked every 5 s)
    this.watch = setInterval(() => this.checkCrashes().catch(e => this.log('warn', 'crash check: ' + e.message)), 5000);
  }
  get cfg() { return this.store.get('settings').launcher; }
  log(level, msg) { this.emit('log', this.store.log(level, '[Launcher] ' + msg)); }
  acct(id) { return this.store.get('accounts').find(a => a.id === id); }

  async setCookie(id, cookie) {
    const a = this.acct(id);
    if (!a) throw new Error('Account not found');
    if (!cookie) { delete a.cookieEnc; this.store.save(); return { cleared: true }; }
    const raw = String(cookie).trim().replace(/^\.ROBLOSECURITY=/, '').replace(/;.*$/, '');
    const me = await whoAmI(raw);
    if (a.username && me.name.toLowerCase() !== a.username.toLowerCase()) throw new Error(`That cookie is for ${me.name}, not ${a.username}`);
    a.cookieEnc = encryptCookie(raw);
    a.username = a.username || me.name; a.robloxUserId = me.id; a.displayName = me.displayName;
    this.store.save();
    this.log('info', `Cookie saved for ${me.name}`);
    return { username: me.name, id: me.id };
  }

  // Opens the real roblox.com login in a throwaway in-memory session. The user signs in
  // (captcha / 2-step included); as soon as roblox.com sets .ROBLOSECURITY it is captured,
  // checked, encrypted and saved, and the window closes. accountId given = refresh that
  // account's cookie (must be the same Roblox user); otherwise the account is found/created.
  loginBrowser(accountId, parent) {
    const target = accountId ? this.acct(accountId) : null;
    if (accountId && !target) return Promise.reject(new Error('Account not found'));
    const part = 'zotac-rbx-login-' + Date.now();          // no "persist:" = never written to disk
    const ses = session.fromPartition(part);
    const win = new BrowserWindow({ width: 520, height: 760, parent, modal: false, title: 'Roblox login' + (target ? ' — ' + target.username : ''), autoHideMenuBar: true, webPreferences: { partition: part, contextIsolation: true, sandbox: true } });
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err, val) => {
        if (done) return; done = true;
        clearInterval(timer);
        ses.cookies.removeAllListeners('changed');
        if (!win.isDestroyed()) win.close();
        ses.clearStorageData().catch(() => {});
        err ? reject(err) : resolve(val);
      };
      const check = async () => {
        if (done) return;
        try {
          const [c] = await ses.cookies.get({ name: '.ROBLOSECURITY' });
          if (!c || !c.value) return;
          const me = await whoAmI(c.value);
          if (target && me.name.toLowerCase() !== target.username.toLowerCase()) {
            finish(new Error(`You logged in as ${me.name}, but this account is ${target.username}`)); return;
          }
          const list = this.store.get('accounts');
          let a = target || list.find(x => x.username && x.username.toLowerCase() === me.name.toLowerCase());
          if (!a) { a = { id: require('./store').rid(6), username: me.name, note: '', createdAt: Date.now() }; list.push(a); }
          a.cookieEnc = encryptCookie(c.value);
          a.robloxUserId = me.id; a.displayName = me.displayName; a.username = a.username || me.name;
          this.store.save();
          this.log('info', `Browser login: cookie saved for ${me.name}`);
          finish(null, { id: a.id, username: me.name, created: !target });
        } catch (e) { if (/invalid or expired/i.test(e.message)) return; finish(e); }
      };
      ses.cookies.on('changed', (_e, cookie, _cause, removed) => { if (!removed && cookie.name === '.ROBLOSECURITY') check(); });
      const timer = setInterval(check, 1500);
      win.on('closed', () => finish(new Error('Login window closed')));
      win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\/([\w-]+\.)*roblox\.com\//.test(url)) win.loadURL(url); return { action: 'deny' }; });
      win.loadURL('https://www.roblox.com/login', { userAgent: UA });
    });
  }

  // Online = its delivery script polled for jobs, or the scanner sent a heartbeat, recently.
  isOnline(a) {
    const name = String(a.username || '').toLowerCase();
    const poll = Object.entries(this.delivery.lastAgentPoll || {}).find(([k]) => k.toLowerCase() === name);
    const t = Math.max(poll ? poll[1] : 0, (this.delivery.lastSeen || {})[name] || 0);
    return !!t && Date.now() - t < 75000;
  }

  status() {
    return this.store.get('accounts').map(a => ({ id: a.id, hasCookie: !!a.cookieEnc, online: this.isOnline(a), lastLaunch: this.lastLaunch[a.id] || null }));
  }

  // Keeps Roblox's single-instance mutex owned so several clients can run at once.
  ensureMultiInstance() {
    if (!this.cfg.multiInstance || (this.holder && this.holder.exitCode === null)) return;
    const ps = "$m = New-Object System.Threading.Mutex($true, 'ROBLOX_singletonMutex'); while ($true) { Start-Sleep -Seconds 3600 }";
    try {
      this.holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true, stdio: 'ignore' });
      this.holder.on('exit', () => { this.holder = null; });
    } catch (e) { this.log('warn', 'Multi-instance holder failed: ' + e.message); }
  }
  resetMultiInstance() {
    if (this.holder) { try { this.holder.kill(); } catch { /* gone */ } this.holder = null; }
    this.ensureMultiInstance();
    return true;
  }
  // closed on purpose from here on (no crash relaunch for it)
  markClosing(username) {
    const a = this.store.get('accounts').find(x => String(x.username).toLowerCase() === String(username).toLowerCase());
    if (a) this.closing[a.id] = Date.now();
    return a;
  }
  // the account's script reported Roblox's error screen (kicked / disconnected): end that game, the
  // crash check then relaunches it when a job needs it
  async clientError(username, message) {
    const a = this.store.get('accounts').find(x => String(x.username).toLowerCase() === String(username).toLowerCase());
    if (!a || !this.pids[a.id] || (this.closing[a.id] && Date.now() - this.closing[a.id] < 30000)) return;
    this.log('warn', `${a.username}: Roblox error screen (${String(message).slice(0, 120)})`);
    this.errored = this.errored || {};
    this.errored[a.id] = String(message).slice(0, 120);
    return this.checkCrashes();
  }
  async checkCrashes() {
    const ids = Object.keys(this.pids);
    if (!ids.length || this.checking) return;
    this.checking = true;
    try {
      let list = await robloxPids();
      // tasklist can come back empty for a moment: an empty list while games are expected is asked again
      if (!list.length) { await new Promise(r => setTimeout(r, 1500)); list = await robloxPids(); }
      const alive = new Set(list);
      this.missing = this.missing || {};
      for (const id of ids) {
        const pid = this.pids[id];
        const a = this.acct(id);
        if (!a || !pid) { delete this.pids[id]; continue; }
        if (this.closing[id] && Date.now() - this.closing[id] < 30000) { if (!alive.has(pid)) delete this.pids[id]; continue; }
        // gone only when missing on two checks in a row (5 s apart), never on one odd process list
        if (!alive.has(pid)) { this.missing[id] = (this.missing[id] || 0) + 1; if (this.missing[id] < 2) continue; }
        else delete this.missing[id];
        const name = String(a.username || '').toLowerCase();
        const poll = Object.entries(this.delivery.lastAgentPoll || {}).find(([k]) => k.toLowerCase() === name);
        const heard = Math.max(poll ? poll[1] : 0, (this.delivery.lastSeen || {})[name] || 0);
        let why = null;
        if (!alive.has(pid)) why = 'crashed or was closed';
        else if (this.errored && this.errored[id]) why = 'showed an error (' + this.errored[id] + ')';
        // a SCRIPT game whose agent talked before but went quiet for a minute: frozen
        else if (this.mode[id] === 'script' && heard && heard > (this.lastLaunch[id] || 0) && Date.now() - heard > 60000) why = 'froze (no heartbeat for 60 s)';
        if (!why) continue;
        if (this.errored) delete this.errored[id];
        const needed = this.delivery.needsAccount ? this.delivery.needsAccount(id) : false;
        // no delivery needs that game: a gone one is forgotten, a running one is left alone
        if (!needed) {
          if (!alive.has(pid)) { delete this.pids[id]; this.log('info', `${a.username}: Roblox ${why} - no delivery needs it, not reopened`); }
          continue;
        }
        if (alive.has(pid)) await new Promise(res => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => res()));
        delete this.pids[id]; delete this.missing[id];
        this.log('warn', `${a.username}: Roblox ${why} - opening it again`);
        this.emit('crashed', { id, username: a.username, legit: this.mode[id] === 'legit', why });
      }
    } finally { this.checking = false; }
  }

  // the agent finished: fully close the Roblox process Zotac launched for that account (only that one)
  async closeGame(username) {
    const a = this.store.get('accounts').find(x => String(x.username).toLowerCase() === String(username).toLowerCase());
    if (a) this.closing[a.id] = Date.now();
    const pid = a && this.pids[a.id];
    if (!pid) { this.log('warn', `${username}: no Roblox process known (not launched by Zotac) — left open`); return false; }
    if (!(await robloxPids()).includes(pid)) { delete this.pids[a.id]; return false; }
    await new Promise(res => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => res()));
    delete this.pids[a.id];
    this.log('info', `${username}: Roblox closed after delivery (process ${pid})`);
    return true;
  }

  // a game Zotac opened Legit must never run Zotac's scripts: if one of them talks to Zotac
  // (heartbeat / job poll after that launch), the executor attached itself to the real client
  async checkLegitClean() {
    const ids = Object.keys(this.mode).filter(id => this.mode[id] === 'legit' && this.pids[id]);
    if (!ids.length) return;
    const alive = await robloxPids();
    for (const id of ids) {
      const a = this.acct(id);
      if (!a || !alive.includes(this.pids[id]) || this.attachWarned[id] === this.lastLaunch[id]) continue;
      const name = String(a.username || '').toLowerCase();
      const poll = Object.entries(this.delivery.lastAgentPoll || {}).find(([k]) => k.toLowerCase() === name);
      const t = Math.max(poll ? poll[1] : 0, (this.delivery.lastSeen || {})[name] || 0);
      if (t > (this.lastLaunch[id] || 0) + 5000) {
        this.attachWarned[id] = this.lastLaunch[id];
        const msg = `@${a.username} was opened Legit (real Roblox), but Zotac's script is running in it: your executor attached itself to that game. Turn off its auto-attach / auto-inject so Legit accounts stay clean`;
        this.log('warn', msg);
        this.emit('launchBlocked', { reason: msg });
      }
    }
  }

  stop() { clearInterval(this.sweep); clearInterval(this.watch); if (this.holder) try { this.holder.kill(); } catch { /* gone */ } }

  // legit = open real Roblox from Zotac's own clean install (no executor, so no Zotac scripts in it)
  // one launch per account at a time: two jobs (or a job and the sweep) asking at the same moment
  // used to open the account twice, and the second login kicks the first
  launch(id, opts = {}) {
    this.inFlight = this.inFlight || {};
    if (this.inFlight[id]) return Promise.resolve({ skipped: 'launching' });
    const p = this.launchNow(id, opts).finally(() => { delete this.inFlight[id]; });
    this.inFlight[id] = p;
    return p;
  }
  async launchNow(id, { force = false, legit = false } = {}) {
    const a = this.acct(id);
    if (!a) throw new Error('Account not found');
    const cookie = decryptCookie(a.cookieEnc);
    if (!cookie) throw new Error(`No cookie saved for ${a.username} (Roblox Accounts > edit > Cookie)`);
    // never into a public server: other players could steal or trade-snipe the stock
    if (!String(this.cfg.privateServer || '').trim()) { const e = new Error(NO_PS); e.code = 'NO_PS'; throw e; }
    if (!force && this.isOnline(a)) return { skipped: 'already online' };
    // a legit game sends no heartbeat: "already open" = the process Zotac started for it still runs
    if (!force && this.pids[id] && (await robloxPids()).includes(this.pids[id])) return { skipped: 'already running' };
    const cool = (this.cfg.cooldownSec || 120) * 1000;
    // cooldown only while the game Zotac launched is still running (loading); if it already closed, launch again now
    if (!force && this.lastLaunch[id] && Date.now() - this.lastLaunch[id] < cool) {
      const pid = this.pids[id];
      const alive = pid ? (await robloxPids()).includes(pid) : Date.now() - this.lastLaunch[id] < 30000;
      if (alive) return { skipped: 'launched recently' };
    }

    // the clean client is installed / updated BEFORE the login ticket is made (tickets expire fast)
    let exe = this.cfg.exePath || null;
    if (legit) {
      if (!this.legit) throw new Error('Legit Roblox is not available in this build');
      exe = await this.legit.ensure();
    }
    this.ensureMultiInstance();
    const ps = await resolvePrivateServer(this.cfg.privateServer, cookie);
    if (!ps) { const e = new Error(NO_PS); e.code = 'NO_PS'; throw e; }
    const ticket = await authTicket(cookie);
    const uri = launchUri(ticket, ps ? ps.placeId : SAB_PLACE_ID, ps && ps.linkCode);
    const before = new Set(await robloxPids());
    if (exe) spawn(exe, [uri], { detached: true, stdio: 'ignore' }).unref();
    else await shell.openExternal(uri);
    this.lastLaunch[id] = Date.now();
    // remember which Roblox process is this account's: the one whose command line carries this
    // launch's browsertrackerid (two accounts launched together otherwise both took the newest
    // process, and closing one could kill the other). Fallback: a new process no account has yet.
    const bt = (uri.match(/browsertrackerid:(\d+)/) || [])[1];
    (async () => {
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1500));
        const procs = await robloxCmdlines();
        const mine = bt && procs.find(p => p.cmd.includes('browsertrackerid:' + bt) || p.cmd.includes('browserTrackerId=' + bt) || p.cmd.includes('-b ' + bt));
        const taken = new Set(Object.entries(this.pids).filter(([k]) => k !== id).map(([, v]) => v));
        const pid = mine ? mine.pid : (i >= 6 ? (procs.map(p => p.pid).filter(p => !before.has(p) && !taken.has(p)).pop() || null) : null);
        if (pid) { this.pids[id] = pid; this.log('info', `${a.username}: Roblox process ${pid}${mine ? '' : ' (guessed)'}`); return; }
      }
    })();
    this.mode[id] = legit ? 'legit' : 'script';
    delete this.closing[id];
    if (this.missing) delete this.missing[id];
    this.log('info', `Launched ${a.username} into the private server${legit ? ' (Legit: real Roblox, no executor)' : ''}`);
    this.emit('launched', { id, username: a.username });
    return { launched: true, privateServer: !!ps };
  }

  // Delivery hook: a new job for an account whose script is not running -> launch it.
  async onJob(job) {
    if (!this.cfg.autoLaunch || job.status !== 'pending' || !job.accountId) return;
    const a = this.acct(job.accountId);
    if (!a || !a.cookieEnc || this.isOnline(a)) return;
    // an account in Legit mode is never opened with the executor, not even for a delivery
    if (a.legit && !job.legit) { this.emit('launchBlocked', { job, reason: `@${a.username} is in Legit mode: Zotac never opens it with the executor` }); return; }
    try {
      const r = await this.launch(a.id, { legit: !!job.legit });
      if (r.launched) this.log('info', `Auto-launched ${a.username} for order ${job.orderId}`);
    } catch (e) {
      this.log('error', `Auto-launch ${a.username}: ${e.message}`);
      if (e.code === 'NO_PS') this.emit('launchBlocked', { job, reason: e.message });
    }
  }
}

module.exports = { Launcher, encryptCookie, decryptCookie, resolvePrivateServer, launchUri };
