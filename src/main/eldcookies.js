// Keeps the Roblox cookies of Eldorado's built-in auto delivery fresh: every Roblox account the
// seller linked on eldorado.gg (Dashboard > Automated delivery) whose username matches a Zotac
// account with a saved cookie gets Zotac's current cookie, the same request the "Update cookie"
// dialog on eldorado.gg sends. Never links a new account: linking stays the seller's choice.
// A cookie is only sent again when it changed (a short hash of what was sent is kept, never the
// cookie itself), or when forced from the Roblox Accounts page.
const crypto = require('crypto');
const { decryptCookie } = require('./launcher');

const EVERY = 30 * 60000;
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const lc = s => String(s || '').trim().toLowerCase();

class EldCookieSync {
  constructor({ store, eld, onChange }) {
    this.store = store;
    this.eld = eld;
    this.onChange = onChange || (() => {});
    this.running = null;
    this.timer = null;
    this.soon = null;
  }

  data() {
    let d = this.store.get('eldCookieSync');
    if (!d) { d = { hashes: {}, last: null }; this.store.set('eldCookieSync', d); }
    d.hashes = d.hashes || {};
    return d;
  }

  enabled() { return ((this.store.get('settings').eldAuto || {}).cookieSync) !== false; }

  log(level, msg) { this.store.log(level, '[EldCookies] ' + msg); }

  start() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.sync().catch(() => {}), EVERY);
    this.later(30000);
  }

  // a cookie changed in Zotac: send it shortly (several saves in a row become one sync)
  later(ms = 5000) {
    clearTimeout(this.soon);
    this.soon = setTimeout(() => this.sync().catch(() => {}), ms);
  }

  state() { return { enabled: this.enabled(), running: !!this.running, last: this.data().last }; }

  sync({ force = false } = {}) {
    if (this.running) return this.running;
    this.running = this.run(force).finally(() => { this.running = null; this.onChange(this.state()); });
    this.onChange(this.state());
    return this.running;
  }

  async run(force) {
    const out = { at: Date.now(), updated: [], unchanged: [], failed: [], notInZotac: [], error: null };
    const d = this.data();
    if (!force && !this.enabled()) return out;
    try {
      const linked = await this.eld.robloxAccounts();
      if (!linked.length) { d.last = out; this.store.save(); return out; }
      const games = await this.eld.robloxSupportedGames().catch(() => []);
      const psLink = String((this.store.get('settings').launcher || {}).privateServer || '').trim();
      const accounts = this.store.get('accounts').filter(a => a.cookieEnc && a.username);
      for (const l of linked) {
        const name = l.robloxUsername || String(l.id);
        const a = accounts.find(x => lc(x.username) === lc(l.robloxUsername));
        if (!a) { out.notInZotac.push(name); continue; }
        let cookie;
        try { cookie = decryptCookie(a.cookieEnc); } catch { cookie = null; }
        if (!cookie) { out.failed.push(`${name}: Zotac could not read its saved cookie`); continue; }
        const h = hash(cookie);
        if (!force && d.hashes[l.id] === h) { out.unchanged.push(name); continue; }
        // same rule as Eldorado's dialog: the private server link goes along only where the game takes one
        const ps = ((games.find(g => String(g.gameId) === String(l.gameId)) || {}).privateServerSettings) || {};
        if (ps.isRequired && !psLink) { out.failed.push(`${name}: Eldorado needs a private server link (Roblox Accounts → private server)`); continue; }
        try {
          await this.eld.updateRobloxCookie(l.id, cookie, ps.isSupported && psLink ? psLink : undefined);
          d.hashes[l.id] = h;
          out.updated.push(name);
        } catch (e) {
          out.failed.push(`${name}: ${String(e.message || e).replace(/^PUT \S+ → /, '')}`);
        }
      }
    } catch (e) {
      out.error = e.message;
    }
    d.last = out;
    this.store.save();
    if (out.error) this.log('warn', 'could not reach Eldorado: ' + out.error);
    if (out.updated.length) this.log('info', `cookie updated on Eldorado auto delivery: ${out.updated.join(', ')}`);
    for (const f of out.failed) this.log('error', f);
    return out;
  }
}

module.exports = { EldCookieSync };
