// Background services: Discord webhook, repricer, order/notification watcher, Roblox lookups.
const EventEmitter = require('events');
const { smartPrice } = require('./pricing');
const { round2 } = require('./eldorado');
const { rid } = require('./store');

// --- Discord ------------------------------------------------------------
async function discord(store, { title, description, color = 0xf5b301, fields = [], ping = false, thumbnail }) {
  const s = store.get('settings');
  if (!s.webhookUrl) return false;
  const body = {
    username: 'Zotac Lister',
    content: ping && s.webhookPing ? (/^\d+$/.test(s.webhookPing) ? `<@${s.webhookPing}>` : s.webhookPing) : undefined,
    embeds: [{ title, description, color, fields, thumbnail: thumbnail ? { url: thumbnail } : undefined, timestamp: new Date().toISOString(), footer: { text: 'Zotac Lister' } }]
  };
  try {
    const r = await fetch(s.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.ok;
  } catch (e) { store.log('warn', 'Discord webhook failed: ' + e.message); return false; }
}

// --- Roblox -------------------------------------------------------------
async function robloxUser(username) {
  const name = String(username || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return null;
  const r = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [name], excludeBannedUsers: true })
  });
  if (!r.ok) throw new Error('Roblox lookup HTTP ' + r.status);
  const j = await r.json();
  return (j.data && j.data[0]) || null;   // { id, name, displayName }
}
async function robloxAvatar(userId) {
  try {
    const r = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`);
    const j = await r.json();
    return j.data && j.data[0] && j.data[0].imageUrl;
  } catch { return null; }
}

// --- Repricer -----------------------------------------------------------
class Repricer extends EventEmitter {
  constructor({ store, eld }) { super(); this.store = store; this.eld = eld; this.timer = null; this.busy = false; this.lastRun = 0; }
  log(level, msg) { this.emit('log', this.store.log(level, '[Repricer] ' + msg)); }
  schedule() {
    clearTimeout(this.timer);
    const r = this.store.get('settings').repricer;
    if (!r.enabled) return;
    this.timer = setTimeout(() => this.run().finally(() => this.schedule()), Math.max(5, r.intervalMin) * 60000);
  }
  async run(onlyIds) {
    if (this.busy) return { skipped: true };
    this.busy = true;
    const settings = this.store.get('settings');
    const rp = settings.repricer;
    const out = { checked: 0, changed: 0 };
    try {
      const me = await this.eld.me();
      const offers = await this.eld.myOffersAll('Active');
      const pets = this.store.get('pets');
      const chosen = rp.scope === 'chosen' ? new Set(rp.offerIds || []) : null;
      for (const o of offers) {
        if (onlyIds && !onlyIds.includes(o.id)) continue;
        if (!onlyIds && chosen && !chosen.has(o.id)) continue;   // only the listings picked for auto repricing
        const env = o.tradeEnvironmentValues || [];
        const attrs = o.attributes || [];
        const num = attrs.find(a => a.type === 'Numeric');
        const mut = attrs.find(a => a.id === settings.game.mutationAttr);
        const pet = pets.find(p => p.offerId === o.id) || {
          name: (env[env.length - 1] || {}).value,
          mutation: mut && mut.value ? mut.value.name : 'None',
          gen: num ? Number(num.value) : 0, traits: []
        };
        const current = (o.pricePerUnit || {}).amount;
        const tmp = { ...settings, autolist: { ...settings.autolist, undercut: rp.undercut } };
        const sp = await smartPrice(this.eld, pet, tmp, me.id || me.userId);
        out.checked++;
        if (!sp.price || !current) continue;
        const base = pet.basePrice || current;
        const floor = Math.max(settings.autolist.minPrice || 0, base * (rp.floorPct || 0) / 100);
        let target = Math.max(floor, sp.price);
        target = round2(target);
        const beaten = sp.comps.some(c => c.price < current);
        if (Math.abs(target - current) < 0.01) continue;
        if (rp.onlyIfBeaten && !beaten && target < current) continue;
        if (rp.onlyIfBeaten && target > current) continue;
        await this.eld.setPrice(o.id, target);
        if (pet.id) { pet.price = target; pet.basePrice = pet.basePrice || current; }
        out.changed++;
        this.log('info', `${o.offerTitle}: $${current} → $${target} (${sp.basis})`);
        await new Promise(r => setTimeout(r, 1500));
      }
      this.store.save();
    } catch (e) { this.log('error', e.message); out.error = e.message; }
    this.busy = false; this.lastRun = Date.now();
    this.emit('done', out);
    return out;
  }
}

// --- Order / notification watcher --------------------------------------
class Watcher extends EventEmitter {
  constructor({ store, eld }) { super(); this.store = store; this.eld = eld; this.timer = null; this.seeded = false; this.lastPoll = 0; this.errors = 0; }
  start() { this.stop(); this.tick(); }
  stop() { clearTimeout(this.timer); }
  async tick() {
    try { await this.poll(); this.errors = 0; } catch (e) { this.errors++; if (this.errors < 3 || this.errors % 20 === 0) this.store.log('warn', '[Watcher] ' + e.message); }
    const sec = Math.max(15, this.store.get('settings').pollSec || 45);
    this.timer = setTimeout(() => this.tick(), sec * 1000);
  }
  async poll() {
    const seen = this.store.get('seen');
    const firstEver = !seen.seeded;
    const { rows } = await this.eld.soldOrders({ page: 1, pageSize: 30 });
    this.lastPoll = Date.now();
    this.emit('orders', rows);
    for (const o of rows) {
      if (!o.id) continue;
      if (!seen.orders[o.id]) {
        seen.orders[o.id] = Date.now();
        if (!firstEver) await this.onNewSale(o);
      }
      if (/disput/i.test(o.state) && !seen.disputes[o.id]) {
        seen.disputes[o.id] = Date.now();
        if (!firstEver) await this.onDispute(o);
      }
      this.syncSaleState(o);
    }
    try {
      const notifs = await this.eld.notifications(true);
      let fresh = 0;
      for (const n of notifs) {
        if (!n.id || seen.notifications[n.id]) continue;
        seen.notifications[n.id] = Date.now();
        if (!firstEver) {
          fresh++;
          this.emit('notification', n);
          if (this.store.get('settings').notifyMessages && /message|chat/i.test(n.type + n.title)) {
            discord(this.store, { title: '💬 ' + n.title, description: n.body || '' });
          }
        }
      }
      this.emit('unread', notifs.length, fresh);
    } catch { /* notifications optional */ }
    // trim seen maps
    for (const k of ['orders', 'notifications', 'disputes', 'autoMessaged']) {
      const ent = Object.entries(seen[k]);
      if (ent.length > 3000) seen[k] = Object.fromEntries(ent.sort((a, b) => b[1] - a[1]).slice(0, 2000));
    }
    seen.seeded = true;
    this.store.save();
  }

  // Match a sale to listed pets (by offerId) and record it.
  async onNewSale(o) {
    const pets = this.store.get('pets');
    const matched = pets.filter(p => p.offerId && p.offerId === o.offerId && p.status === 'listed').slice(0, o.quantity || 1);
    for (const p of matched) Object.assign(p, { status: 'sold', soldPrice: o.price ? round2(o.price / (o.quantity || 1)) : p.price, soldAt: Date.now(), orderId: o.id });
    const sale = { id: rid(6), orderId: o.id, title: o.title, price: o.price, buyer: o.buyer, date: o.date || new Date().toISOString(), petIds: matched.map(p => p.id), state: o.state, source: 'eldorado' };
    this.store.get('sales').unshift(sale);
    this.store.save();
    this.store.log('info', `[Sale] ${o.title} — $${o.price} to ${o.buyer || 'buyer'}`);
    this.emit('sale', { order: o, pets: matched });
    const s = this.store.get('settings');
    if (s.notifySales) {
      discord(this.store, {
        title: '💰 New sale!', color: 0x22c55e, ping: true,
        description: `**${o.title || 'Order'}**`,
        fields: [
          { name: 'Price', value: o.price != null ? `$${o.price}` : '?', inline: true },
          { name: 'Qty', value: String(o.quantity || 1), inline: true },
          { name: 'Buyer', value: o.buyer || '?', inline: true },
          { name: 'Accounts', value: [...new Set(matched.map(p => (this.store.get('accounts').find(a => a.id === p.accountId) || {}).username).filter(Boolean))].join(', ') || '—', inline: false },
          { name: 'Order', value: o.id, inline: false }
        ]
      });
    }
    if (s.autoMessage.enabled && !s.delivery.enabled && !this.store.get('seen').autoMessaged[o.id]) {
      try {
        const text = s.autoMessage.text.replace(/\{buyer\}/g, o.buyer || '').replace(/\{item\}/g, o.title || '').replace(/\{orderId\}/g, o.id);
        await this.eld.sendOrderMessage(o.id, text);
        this.store.get('seen').autoMessaged[o.id] = Date.now();
        this.store.log('info', `[AutoMessage] sent to order ${o.id}`);
      } catch (e) { this.store.log('error', '[AutoMessage] ' + e.message); }
    }
  }

  async onDispute(o) {
    this.store.log('warn', `[Dispute] ${o.title} (${o.id})`);
    this.emit('dispute', o);
    if (this.store.get('settings').notifyDisputes) {
      discord(this.store, { title: '⚠️ Dispute opened', color: 0xef4444, ping: true, description: `**${o.title}**\nBuyer: ${o.buyer || '?'}\nOrder: ${o.id}` });
    }
  }

  syncSaleState(o) {
    const sale = this.store.get('sales').find(s => s.orderId === o.id);
    if (sale && sale.state !== o.state) { sale.state = o.state; this.store.save(); }
  }
}

module.exports = { discord, robloxUser, robloxAvatar, Repricer, Watcher };
