// Every Eldorado API call runs inside a hidden window on the eldorado.gg origin,
// so session cookies, the __Host-XSRF-TOKEN header and Cloudflare clearance all
// behave exactly like the real site. Nothing is sent anywhere else.
const { BrowserWindow, session } = require('electron');
const path = require('path');
const EventEmitter = require('events');

const PARTITION = 'persist:eldorado';
const ORIGIN = 'https://www.eldorado.gg';
const BRIDGE_URL = ORIGIN + '/robots.txt';

// Runs in the page. Must be self-contained (serialised with toString()).
async function pageFetch(a) {
  const getCookie = n => {
    const row = document.cookie.split('; ').find(x => x.startsWith(n + '='));
    return row ? decodeURIComponent(row.slice(n.length + 1)) : '';
  };
  let xsrf = getCookie('__Host-XSRF-TOKEN');
  if (!xsrf) {
    xsrf = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    document.cookie = '__Host-XSRF-TOKEN=' + xsrf + '; path=/; secure; samesite=lax; max-age=31622400';
  }
  const url = new URL('/api/' + a.path.replace(/^\/?(api\/)?/, ''), location.origin);
  for (const [k, v] of Object.entries(a.query || {})) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach(x => url.searchParams.append(k, x));
    else url.searchParams.set(k, v);
  }
  const headers = { 'X-XSRF-Token': xsrf, Accept: 'application/json, text/plain, */*' };
  let body;
  if (a.form) {
    body = new FormData();
    for (const [k, v] of Object.entries(a.form)) {
      if (v && typeof v === 'object' && v.base64) {
        const bin = atob(v.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        body.append(k, new Blob([bytes], { type: v.type || 'image/png' }), v.filename || 'image.png');
      } else body.append(k, v);
    }
  } else if (a.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(a.body);
  }
  try {
    const r = await fetch(url.toString(), { method: a.method || 'GET', headers, body, credentials: 'include' });
    const text = await r.text();
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch { /* html or plain */ }
    return { status: r.status, ok: r.ok, data, cf: r.status === 403 && /Just a moment|cf-chl/i.test(text) };
  } catch (e) {
    return { status: 0, ok: false, data: String(e && e.message || e) };
  }
}

class Bridge extends EventEmitter {
  constructor() {
    super();
    this.win = null;
    this.ready = null;
    this.state = 'disconnected';   // disconnected | connecting | connected | error
    this.lastOk = 0;
    this.queue = Promise.resolve();
  }

  get session() { return session.fromPartition(PARTITION); }

  start() {
    if (this.win && !this.win.isDestroyed()) return this.ready;
    this.setState('connecting');
    this.win = new BrowserWindow({
      show: false,
      width: 400, height: 300,
      webPreferences: {
        partition: PARTITION,
        preload: path.join(__dirname, '..', '..', 'bridge-preload.js'),
        contextIsolation: true,
        backgroundThrottling: false
      }
    });
    this.win.webContents.setAudioMuted(true);
    this.ready = new Promise(resolve => {
      this.win.webContents.once('did-finish-load', () => resolve());
      this.win.webContents.once('did-fail-load', () => resolve());
    });
    this.win.loadURL(BRIDGE_URL).catch(() => {});
    this.win.on('closed', () => { this.win = null; this.setState('disconnected'); });
    return this.ready;
  }

  async reload() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    await this.start();
  }

  setState(s) { if (this.state !== s) { this.state = s; this.emit('state', s); } }

  async exec(code) {
    await this.start();
    return this.win.webContents.executeJavaScript(code, true);
  }

  // Raw request. Retries once after refreshing auth tokens on 401.
  async request(method, p, opts = {}) {
    await this.start();
    const args = { method, path: p, query: opts.query, body: opts.body, form: opts.form };
    const exec = () => this.win.webContents.executeJavaScript(`(${pageFetch.toString()})(${JSON.stringify(args)})`, true);
    const run = () => Promise.race([exec(), new Promise(res => setTimeout(() => res({ ok: false, status: 0, data: 'Eldorado did not answer in 30 s' }), 30000))]);
    let res = await run();
    if (res.status === 401 && !opts.noRefresh) {
      const ref = await this.win.webContents.executeJavaScript(
        `(${pageFetch.toString()})(${JSON.stringify({ method: 'POST', path: 'authentication/refreshTokens' })})`, true);
      if (ref.ok) res = await run();
    }
    if (res.ok) { this.lastOk = Date.now(); this.setState('connected'); }
    else if (res.status === 0 || res.cf) this.setState('error');
    this.emit('request', { method, path: p, status: res.status });
    return res;
  }

  // Throws on non-2xx so callers can use try/catch.
  async call(method, p, opts) {
    const r = await this.request(method, p, opts);
    if (!r.ok) {
      const msg = typeof r.data === 'object' && r.data
        ? (r.data.message || (r.data.messages && r.data.messages.join('; ')) || r.data.title || JSON.stringify(r.data).slice(0, 300))
        : String(r.data || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 200);
      const err = new Error(`${method} ${p} → ${r.status}${r.cf ? ' (Cloudflare challenge — use Login via Browser)' : ''}: ${msg}`);
      err.status = r.status; err.data = r.data;
      throw err;
    }
    return r.data;
  }

  get(p, query) { return this.call('GET', p, { query }); }
  post(p, body, query) { return this.call('POST', p, { body, query }); }
  put(p, body, query) { return this.call('PUT', p, { body, query }); }
  del(p, query) { return this.call('DELETE', p, { query }); }
  upload(p, form) { return this.call('POST', p, { form }); }

  // --- cookies ---------------------------------------------------------
  async setCookies(list) {
    const ses = this.session;
    let n = 0;
    for (const c of list) {
      if (!c || !c.name) continue;
      const hostOnly = c.name.startsWith('__Host-') || !c.domain || c.hostOnly;
      const details = {
        url: ORIGIN,
        name: c.name,
        value: String(c.value ?? ''),
        path: c.name.startsWith('__Host-') ? '/' : (c.path || '/'),
        secure: c.secure !== false || c.name.startsWith('__'),
        httpOnly: !!c.httpOnly,
        expirationDate: c.expirationDate || Math.floor(Date.now() / 1000) + 30 * 86400
      };
      if (!hostOnly) details.domain = c.domain;
      const ss = String(c.sameSite || '').toLowerCase();
      if (ss === 'lax' || ss === 'strict') details.sameSite = ss;
      else if (ss === 'no_restriction' || ss === 'none') details.sameSite = 'no_restriction';
      try { await ses.cookies.set(details); n++; } catch { /* skip invalid */ }
    }
    await ses.cookies.flushStore();
    await this.reload();
    return n;
  }

  async setCookieString(str) {
    const list = String(str).split(/;\s*/).map(pair => {
      const i = pair.indexOf('=');
      return i > 0 ? { name: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim(), domain: '.eldorado.gg' } : null;
    }).filter(Boolean);
    return this.setCookies(list);
  }

  async logout() {
    try { await this.request('POST', 'authentication/logout', { noRefresh: true }); } catch { /* ignore */ }
    await this.session.clearStorageData();
    await this.reload();
  }
}

module.exports = { Bridge, PARTITION, ORIGIN };
