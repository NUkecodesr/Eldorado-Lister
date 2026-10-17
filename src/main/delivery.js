// Auto Delivery: buyer chat flow (TalkJS listener in the bridge) + job queue for
// an external delivery agent (in-game script) that performs the Trade Machine trade.
const EventEmitter = require('events');
const { rid } = require('./store');
const { robloxUser, robloxAvatar, discord } = require('./services');

const TALK_APP_ID = '49mLECOW';
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;

// Injected into the eldorado.gg bridge page.
async function startTalkInPage(cfg) {
  if (window.__zotacTalk) return 'already';
  if (!window.Talk) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.talkjs.com/talk.js';
      s.onload = res; s.onerror = () => rej(new Error('talk.js failed to load'));
      document.head.appendChild(s);
    });
  }
  await window.Talk.ready;
  const session = new window.Talk.Session({ appId: cfg.appId, me: new window.Talk.User(cfg.userId), token: cfg.token });
  session.onMessage(m => {
    const c = m.conversation || {};
    window.zotacBridge.emit('talk:message', {
      id: m.id, conversationId: c.id, custom: c.custom || null, subject: c.subject || null,
      senderId: m.senderId, isByMe: !!m.isByMe, body: m.body || m.text || '', type: m.type, ts: m.timestamp || Date.now()
    });
  });
  window.__zotacTalk = session;
  return 'ok';
}

// Injected into the eldorado.gg bridge page: sends a picture into a TalkJS conversation (the
// same kind of "<name>.png" attachment a seller can drop into Eldorado's chat).
async function sendImageInPage(cfg) {
  const s = window.__zotacTalk;
  if (!s) throw new Error('chat listener not connected');
  const bin = atob(cfg.b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/png' });
  if (typeof s.uploadImage !== 'function') throw new Error('TalkJS session has no uploadImage');
  const token = await s.uploadImage(blob, { filename: cfg.filename, width: cfg.width, height: cfg.height });
  // the classic session wraps a TalkJS core session (minified property name): find it by shape;
  // core conversations send file messages as content blocks
  const core = Object.values(s).find(v => v && typeof v.conversation === 'function' && typeof v.uploadImage === 'function');
  if (!core) throw new Error('TalkJS core session not found');
  await core.conversation(cfg.conversationId).send({ content: [{ type: 'file', fileToken: token }] });
  return 'sent';
}

// Injected into the eldorado.gg bridge page: the last messages of one TalkJS conversation, read
// through the core session (the classic session has no history call).
async function historyInPage(cfg) {
  const s = window.__zotacTalk;
  if (!s) throw new Error('chat listener not connected');
  let ref = null;
  try { ref = typeof s.conversation === 'function' ? s.conversation(cfg.conversationId) : null; } catch { ref = null; }
  if (!ref || typeof ref.subscribeMessages !== 'function') {
    const core = Object.values(s).find(v => v && typeof v.conversation === 'function' && typeof v.uploadImage === 'function');
    ref = core ? core.conversation(cfg.conversationId) : null;
  }
  if (!ref || typeof ref.subscribeMessages !== 'function') throw new Error('this TalkJS version cannot read history');
  const list = await new Promise((resolve, reject) => {
    let sub = null, done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); try { sub && sub.unsubscribe(); } catch { /* gone */ } fn(v); };
    const timer = setTimeout(() => finish(reject, new Error('TalkJS did not answer in 15 s')), 15000);
    sub = ref.subscribeMessages(msgs => { if (msgs) finish(resolve, msgs); });
    if (sub && sub.state && sub.state.type === 'error') finish(reject, new Error('no access to this conversation'));
  });
  const text = m => m.plaintext || (Array.isArray(m.content) ? m.content.map(b => b.text || (b.type === 'file' ? '[picture]' : '')).join(' ') : '') || '';
  return list.slice(0, 200).map(m => ({
    id: m.id, ts: m.createdAt, body: text(m), system: m.type === 'SystemMessage' || !m.sender,
    isByMe: !!(m.sender && String(m.sender.id) === String(cfg.userId)), sender: m.sender ? m.sender.name || m.sender.id : null
  })).reverse();
}

function decodeJwt(t) {
  try { return JSON.parse(Buffer.from(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return null; }
}

// everyday chat words a buyer writes around their username
const CHAT_WORDS = new Set(('hi hey hello yo sup ok okay yes no yeah yep nope thanks thank thx ty pls please plz my name is im i am ' +
  'the a an and or to of in on for it its this that just bought buy buying order ordered got get paid pay user username roblox rbx ' +
  'here there sent send trade trading accept accepted ready online offline now when what where how why can you me your mine ' +
  'brainrot pet item delivery deliver steal sab game account acc is was are will would should could did do does done have has ' +
  'with from friend add added join joining wait waiting sorry bro bruh lol lmao fast slow good great nice cool sure np gg rubrikiko').split(/\s+/));

class Delivery extends EventEmitter {
  constructor({ store, eld, bridge }) {
    super();
    this.store = store; this.eld = eld; this.bridge = bridge;
    this.talkState = 'off'; this.talkError = null;
    this.lastAgentPoll = {};      // account -> ts
    this.lastSeen = {};           // lowercased account -> ts of the last in-game heartbeat
    this.timer = setInterval(() => this.checkTimeouts(), 10000);
    bridge.on('state', s => { if (s === 'connecting') this.talkState = 'off'; });
  }

  get cfg() { return this.store.get('settings').delivery; }
  get map() { return this.store.get('deliveries'); }
  log(level, msg) { this.emit('log', this.store.log(level, '[Delivery] ' + msg)); }
  fill(key, vars) {
    const tpl = (this.cfg.steps || {})[key] || '';
    return tpl.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  }
  async say(d, key, vars = {}, image = null) {
    const text = this.fill(key, { buyer: d.buyer || '', username: d.username || '', accounts: d.accounts.length, orderId: d.orderId, ...vars });
    if (!text) return;
    if (d.sim) { d.log.push({ t: Date.now(), out: text, image }); this.store.save(); this.emit('update', d); return; }
    // Eldorado's quick-reply endpoint is text only: the picture is kept for Zotac's own chat view
    try { await this.eld.sendOrderMessage(d.orderId, text); d.log.push({ t: Date.now(), out: text, image }); }
    catch (e) { this.log('error', `send ${key} → ${d.orderId}: ${e.message}`); d.log.push({ t: Date.now(), err: e.message }); }
    this.store.save(); this.emit('update', d);
  }

  // posts a picture (by URL) into the order chat; failures are logged, never block the flow
  async sendPicture(d, url, filename) {
    try {
      if (!d.conversationId) throw new Error('no conversation id for this order yet');
      await this.ensureTalk();
      const r = await fetch(url);
      if (!r.ok) throw new Error('image HTTP ' + r.status);
      const b64 = Buffer.from(await r.arrayBuffer()).toString('base64');
      await this.bridge.exec(`(${sendImageInPage.toString()})(${JSON.stringify({ b64, filename, width: 420, height: 420, conversationId: d.conversationId })})`);
      d.log.push({ t: Date.now(), out: '[picture] ' + filename, image: url }); this.store.save(); this.emit('update', d);
    } catch (e) { this.log('warn', `picture to ${d.orderId}: ${e.message}`); }
  }

  // --- TalkJS ----------------------------------------------------------
  async ensureTalk() {
    if (this.talkState === 'on') return true;
    try {
      const auth = await this.eld.talkToken();
      const token = typeof auth === 'string' ? auth : (auth && (auth.token || auth.accessToken || auth.jwt || auth.talkJsToken));
      const payload = decodeJwt(token) || {};
      const me = await this.eld.me();
      const userId = (auth && (auth.userId || auth.talkJsUserId)) || payload.sub || payload.userId || me.id;
      if (!token || !userId) throw new Error('No TalkJS token from conversations/me/authorize');
      const r = await this.bridge.exec(`(${startTalkInPage.toString()})(${JSON.stringify({ appId: (auth && auth.appId) || TALK_APP_ID, userId, token })})`);
      this.talkState = 'on'; this.talkError = null; this.talkUserId = userId;
      this.log('info', 'Chat listener connected (' + r + ')');
      return true;
    } catch (e) {
      this.talkState = 'error'; this.talkError = e.message;
      this.log('error', 'Chat listener: ' + e.message);
      return false;
    }
  }

  // chat history of an order (oldest first), for the Chat page
  async conversationOf(orderId, hint) {
    const d = this.map[orderId];
    let id = hint || (d && d.conversationId) || null;
    if (!id) { try { const o = await this.eld.order(orderId); id = o && (o.talkJsConversationId || (o.order && o.order.talkJsConversationId)) || null; } catch { /* next */ } }
    if (!id) { try { const conv = await this.eld.orderConversation(orderId); id = typeof conv === 'string' ? conv : (conv && (conv.talkJsConversationId || conv.conversationId || conv.id)) || null; } catch { /* none */ } }
    if (d && id && d.conversationId !== id) { d.conversationId = id; this.store.save(); }
    return id;
  }

  async history(orderId, hint) {
    if (!await this.ensureTalk()) throw new Error('Chat not connected: ' + (this.talkError || 'unknown error'));
    const conversationId = await this.conversationOf(orderId, hint);
    if (!conversationId) throw new Error('Eldorado gave no chat for this order');
    const run = this.bridge.exec(`(${historyInPage.toString()})(${JSON.stringify({ conversationId, userId: this.talkUserId })})`);
    const msgs = await Promise.race([run, new Promise((_, rej) => setTimeout(() => rej(new Error('chat did not load in 20 s')), 20000))]);
    return { conversationId, messages: msgs || [] };
  }

  // --- flow ------------------------------------------------------------
  async onSale(order, pets) {
    if ((!this.cfg.enabled && !order.sim) || this.map[order.id]) return;
    const accounts = [...new Set(pets.map(p => p.accountId).filter(Boolean))];
    const d = this.map[order.id] = {
      orderId: order.id, buyer: order.buyer, title: order.title, conversationId: null, price: order.price != null ? Number(order.price) : null,
      state: 'awaitUsername', username: null, robloxId: null,
      petIds: pets.map(p => p.id), accounts, step: 0, attempts: 0, jobs: [], log: [], createdAt: Date.now(),
      sim: !!order.sim
    };
    if (d.sim) {   // simulated buyer chat: everything stays inside Zotac
      d.conversationId = order.id;
      this.store.save();
      await this.say(d, 'greeting');
      if (accounts.length > 1) await this.say(d, 'multiAccount');
      this.emit('update', d);
      return d;
    }
    this.store.save();
    this.ensureTalk();
    d.conversationId = await this.conversationOf(order.id, order.conversationId);
    if (!pets.length) this.log('warn', `Order ${order.id}: no listed pets matched offer — delivery will need manual pet selection`);
    // Buyers usually type their Roblox username at checkout: then they are only asked to confirm
    // it; otherwise the normal greeting asks them for it.
    let preset = null;
    try { const v = await this.eld.deliveryDetail(order.id, 'RobloxUsername'); if (v && typeof v === 'string') preset = v.trim(); } catch { /* buyer will type it */ }
    const user = preset ? await this.lookupUser(preset) : null;
    if (user) {
      const text = (this.cfg.steps || {}).greetingKnownUser ? null : `Hi ${d.buyer || ''}! Thanks for your order.\n\nYou entered ${user.name} as your Roblox username at checkout. Make sure you are online in Steal a Brainrot.`;
      if (text) await this.sayText(d, text); else await this.say(d, 'greetingKnownUser', { username: user.name });
      if (accounts.length > 1) await this.say(d, 'multiAccount');
      await this.proposeUsername(d, user.name, user);
    } else {
      await this.say(d, 'greeting');
      if (accounts.length > 1) await this.say(d, 'multiAccount');
    }
    this.emit('update', d);
  }

  // Picks the Roblox username out of a buyer message. Chat words ("hi i just bought it") must
  // never be taken as a username: common words are skipped, username-looking tokens win, each
  // candidate must exist on Roblox, and a long message without one gets asked again.
  async lookupUser(name) {
    const n = String(name || '').trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(n)) return null;
    try { return await robloxUser(n); } catch (e) { this.log('warn', 'Roblox lookup failed: ' + e.message); return { name: n, id: null }; }
  }

  // a ready-made message (not one of the editable steps)
  async sayText(d, text) {
    if (d.sim) { d.log.push({ t: Date.now(), out: text }); this.store.save(); this.emit('update', d); return; }
    try { await this.eld.sendOrderMessage(d.orderId, text); d.log.push({ t: Date.now(), out: text }); }
    catch (e) { this.log('error', `send → ${d.orderId}: ${e.message}`); d.log.push({ t: Date.now(), err: e.message }); }
    this.store.save(); this.emit('update', d);
  }

  async proposeUsername(d, raw, known) {
    if (known) return this.confirmUser(d, known);
    const words = String(raw).trim().split(/[\s,;:!?()"']+/).map(w => w.replace(/^@/, '').replace(/[.]+$/, '')).filter(Boolean);
    const tokens = words.filter(w => /^[A-Za-z0-9_]{3,20}$/.test(w) && !/^_|_$/.test(w));
    const score = w => (/\d/.test(w) ? 3 : 0) + (/_/.test(w) ? 2 : 0) + (/[a-z]/.test(w) && /[A-Z]/.test(w.slice(1)) ? 1 : 0) + (w.length >= 6 ? 1 : 0) - (CHAT_WORDS.has(w.toLowerCase()) ? 10 : 0);
    let cands = tokens.filter(w => score(w) > -5).sort((a, b) => score(b) - score(a));
    // a sentence with only plain words is chat, not a username (unless it is a single word)
    if (words.length > 2 && !cands.some(w => score(w) > 0)) cands = [];
    if (!cands.length) { await this.say(d, 'usernameNotFound'); return; }
    let user = null;
    for (const name of cands.slice(0, 3)) {
      try { user = await robloxUser(name); } catch (e) { this.log('warn', 'Roblox lookup failed: ' + e.message); user = { name, id: null }; }
      if (user) break;
    }
    if (!user) { await this.say(d, 'usernameNotFound'); return; }
    return this.confirmUser(d, user);
  }

  async confirmUser(d, user) {
    d.username = user.name; d.robloxId = user.id; d.state = 'awaitConfirm';
    d.avatar = user.id ? await robloxAvatar(user.id) : null;
    await this.say(d, 'confirmUsername', { username: user.name }, d.avatar);
    if (!d.sim && d.avatar) this.sendPicture(d, d.avatar.replace(/\/150\/150\//, '/420/420/'), user.name + '.png');
  }

  findByMessage(m) {
    const all = Object.values(this.map).filter(d => !['done', 'cancelled'].includes(d.state));
    let d = all.find(x => x.conversationId && x.conversationId === m.conversationId);
    if (d) return d;
    const ids = [...String(m.conversationId || '').matchAll(GUID), ...JSON.stringify(m.custom || {}).matchAll(GUID), ...String(m.subject || '').matchAll(GUID)].map(x => x[0].toLowerCase());
    d = all.find(x => ids.includes(String(x.orderId).toLowerCase()));
    if (d && !d.conversationId) d.conversationId = m.conversationId;
    return d;
  }

  async onMessage(m) {
    this.emit('message', m);
    if (m.isByMe) return;
    const d = this.findByMessage(m);
    if (!this.cfg.enabled && !(d && d.sim)) return;
    if (!d) return;
    const text = String(m.body || '').trim();
    d.log.push({ t: Date.now(), in: text });
    if (d.state === 'awaitUsername') return this.proposeUsername(d, text);
    if (d.state === 'awaitConfirm') {
      if (/^(1|y|yes|yeah|yep|confirm)\b/i.test(text)) return this.startDelivery(d);
      if (/^(2|n|no|nope)\b/i.test(text)) { d.state = 'awaitUsername'; d.username = null; return this.say(d, 'usernameRejected'); }
      return this.say(d, 'invalidReply');
    }
    this.store.save();
  }

  async startDelivery(d) {
    d.state = 'delivering'; d.step = 0; d.confirmedAt = Date.now();
    await this.say(d, 'deliveryStarting');
    if (this.cfg.recordProof) this.emit('proof', { action: 'start', orderId: d.orderId });
    this.queueNext(d);
  }

  queueNext(d) {
    const accounts = d.accounts.length ? d.accounts : [null];
    if (d.step >= accounts.length) return this.finish(d);
    const accountId = accounts[d.step];
    const acct = this.store.get('accounts').find(a => a.id === accountId) || {};
    // pets already delivered (by this or another order) are never traded again
    const pets = this.store.get('pets').filter(p => d.petIds.includes(p.id) && !p.delivered && (accountId === null || p.accountId === accountId));
    if (!pets.length && d.petIds.length) {
      this.log('info', `Order ${d.orderId}: ${accounts.length > 1 ? 'this account\'s pets were' : 'everything was'} already delivered — skipping`);
      d.step++;
      return this.queueNext(d);
    }
    const job = {
      id: rid(6), orderId: d.orderId, accountId, account: acct.username || null,
      buyerUsername: d.username, buyerUserId: d.robloxId,
      pets: pets.map(p => ({ id: p.id, name: p.name, mutation: p.mutation, gen: p.gen, traits: p.traits || [] })),
      status: 'pending', createdAt: Date.now(), attempt: d.attempts,
      closeWhenIdle: (this.store.get('settings').launcher || {}).closeAfterDelivery !== false
    };
    this.store.get('jobs').push(job);
    d.jobs.push(job.id);
    this.store.save();
    if (accounts.length > 1) this.say(d, 'deliveryAccountStep', { step: d.step + 1, account: acct.username || '?' });
    this.emit('job', job);
  }

  // --- agent API -------------------------------------------------------
  nextJob(account) {
    this.lastAgentPoll[account || '*'] = Date.now();
    const jobs = this.store.get('jobs');
    const j = jobs.find(x => x.status === 'pending' && (!account || !x.account || x.account.toLowerCase() === String(account).toLowerCase()));
    if (!j) return null;
    j.status = 'running'; j.startedAt = Date.now();
    this.store.save(); this.emit('job', j);
    return j;
  }

  async jobResult(id, ok, reason) {
    const j = this.store.get('jobs').find(x => x.id === id);
    if (!j || !['running', 'pending'].includes(j.status)) return false;
    j.status = ok ? 'done' : 'failed'; j.finishedAt = Date.now(); j.reason = reason || null;
    this.store.save(); this.emit('job', j);
    const d = this.map[j.orderId];
    if (!d) return true;
    if (ok) {
      // the pet really left the base (the agent checked): it is sold, no longer available
      for (const p of this.store.get('pets')) if (j.pets.some(x => x.id === p.id)) { p.delivered = true; if (p.status !== 'sold') { p.status = 'sold'; p.soldAt = p.soldAt || Date.now(); } }
      this.emit('petsChanged');
      // any other order still waiting to trade the same pet is now pointless: cancel its job
      for (const o of this.store.get('jobs')) {
        if (o.id !== j.id && o.status === 'pending' && o.pets.every(x => j.pets.some(y => y.id === x.id))) {
          o.status = 'cancelled'; o.reason = 'already delivered by job ' + j.id; o.finishedAt = Date.now(); this.emit('job', o);
        }
      }
      d.step++; d.attempts = 0;
      this.queueNext(d);
    } else {
      d.attempts++;
      this.log('warn', `Job ${id} failed (${reason}) attempt ${d.attempts}`);
      if (d.attempts >= 3) return this.fail(d, reason);
      await this.say(d, 'deliveryFailed', { reason: reason || 'trade failed' });
      setTimeout(() => this.queueNext(d), 15000);
    }
    return true;
  }

  // Discord card for a finished delivery (same layout as Meowl's sales channel): big status,
  // the pet with its picture, price · quantity · time, the reason when it failed, and a
  // running total for today in the footer.
  report(d, outcome, reason) { this.reportCard(d, outcome, reason).catch(e => this.log('warn', 'Discord card: ' + e.message)); }
  async reportCard(d, outcome, reason) {
    const pets = this.store.get('pets').filter(p => d.petIds.includes(p.id));
    const fmtGen = n => { n = Number(n) || 0; for (const [v, u] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (n >= v) return +(n / v).toFixed(2) + u + '/s'; return n + '/s'; };
    const MUT = { gold: '🟨', diamond: '💎', rainbow: '🌈', lava: '🌋', bloodrot: '🩸', celestial: '🌌', candy: '🍬', galaxy: '🌌', yinyang: '☯️', radioactive: '☢️', cursed: '😈', none: '🧊', normal: '🧊' };
    const mutEmoji = m => MUT[String(m || 'none').toLowerCase().replace(/[^a-z]/g, '')] || '🔷';
    const accounts = [...new Set(pets.map(p => (this.store.get('accounts').find(a => a.id === p.accountId) || {}).username).filter(Boolean))];
    const price = d.price != null ? d.price : pets.reduce((s, p) => s + (Number(p.price) || 0), 0);
    const secs = Math.max(0, Math.round(((d.finishedAt || Date.now()) - (d.createdAt || Date.now())) / 1000));
    const dur = secs >= 60 ? Math.floor(secs / 60) + 'm ' + (secs % 60) + 's' : secs + 's';
    const style = { done: ['🟢 DELIVERED', 0x22c55e], cancelled: ['🟠 CANCELLED', 0xf59e0b], failed: ['🔴 FAILED', 0xef4444], manual: ['🔴 FAILED · NEEDS YOU', 0xef4444] }[outcome] || ['⚪ ' + String(outcome).toUpperCase(), 0x888888];

    const petLines = pets.length ? pets.map(p => {
      const mut = p.mutation && !/^(none|normal)$/i.test(p.mutation) ? p.mutation : '';
      return `${mutEmoji(p.mutation)} **${p.name}**\n-# ${[fmtGen(p.gen), mut, (p.traits || []).join(', ')].filter(Boolean).join(' · ')}`;
    }).join('\n') : `📦 **${d.title || 'Order'}**`;
    const qty = Math.max(1, pets.length || 1);
    const lines = [
      `## ${style[0]}${d.sim ? '  ·  TEST' : ''}`,
      petLines,
      '',
      `🟡 **$${Number(price || 0).toFixed(2)}**　📦 **×${qty}**　⏱️ **${dur}**`
    ];
    if (reason && outcome !== 'done') lines.push('', `⚠️ **Reason** — ${String(reason).slice(0, 400)}`);
    const who = [d.buyer ? '👤 ' + d.buyer : null, d.username ? (d.robloxId ? `🎮 [@${d.username}](https://www.roblox.com/users/${d.robloxId}/profile)` : '🎮 @' + d.username) : null,
      accounts.length ? '📤 ' + accounts.map(a => '@' + a).join(', ') : null, (d.attempts || 0) > (outcome === 'done' ? 0 : 1) ? `🔁 ${(d.attempts || 0) + (outcome === 'done' ? 1 : 0)} tries` : null].filter(Boolean);
    lines.push('', '-# ' + [...who, '`' + d.orderId + '`'].join(' · '));

    // today's totals (local day): delivered, failed, money from delivered orders
    const start = new Date(); start.setHours(0, 0, 0, 0);
    let ok = 0, bad = 0, sum = 0;
    for (const x of Object.values(this.map)) {
      if (!x || !!x.sim !== !!d.sim || !x.finishedAt || x.finishedAt < start.getTime()) continue;
      if (x.state === 'done') { ok++; sum += Number(x.price) || 0; } else if (x.state === 'cancelled' || x.state === 'manual') bad++;
    }
    if (outcome === 'done' && d.state !== 'done') { ok++; sum += Number(price) || 0; }

    let thumb = null;
    try { if (pets[0] && this.petImageUrl) thumb = await this.petImageUrl(pets[0].name); } catch { /* no picture */ }
    discord(this.store, {
      username: 'Zotac Auto Delivery', color: style[1], ping: outcome !== 'done' && !d.sim,
      description: lines.join('\n').slice(0, 4000),
      thumbnail: thumb || d.avatar || undefined,
      footer: `Today: ${ok} ✅ · ${bad} ❌ · $${sum.toFixed(2)} · Zotac Lister`
    });
  }

  async finish(d) {
    d.state = 'done'; d.finishedAt = Date.now();
    await this.say(d, 'deliverySuccess');
    if (this.cfg.markDelivered && !d.sim) {
      try { await this.eld.deliverOrder(d.orderId); this.log('info', `Order ${d.orderId} marked delivered`); }
      catch (e) { this.log('error', `Mark delivered failed: ${e.message}`); }
    }
    if (this.cfg.recordProof) this.emit('proof', { action: 'stop', orderId: d.orderId });
    this.report(d, 'done');
    this.store.save(); this.emit('update', d);
  }

  // final failure: cancel the order (buyer told why, Eldorado refunds) unless switched off,
  // then the old manual fallback
  async fail(d, reason) {
    d.finishedAt = Date.now(); d.failReason = reason || 'unknown';
    for (const j of this.store.get('jobs')) if (j.orderId === d.orderId && j.status === 'pending') { j.status = 'cancelled'; j.reason = 'order failed'; }
    if (this.cfg.cancelOnFail !== false) {
      d.state = 'cancelled';
      await this.say(d, 'orderCancelled', { reason: reason || 'unknown', attempts: d.attempts || 3 });
      let how = 'cancelled';
      if (!d.sim) {
        try { await this.eld.cancelOrder(d.orderId, `Delivery failed: ${reason || 'unknown'}`); this.log('info', `Order ${d.orderId} cancelled on Eldorado`); }
        catch (e) { how = 'manual'; d.state = 'manual'; this.log('error', `Cancel order ${d.orderId} failed: ${e.message}`); reason = `${reason} — and the Eldorado cancel failed: ${e.message}`; }
      }
      if (this.cfg.recordProof) this.emit('proof', { action: 'stop', orderId: d.orderId });
      this.report(d, how, reason);
    } else {
      d.state = 'manual';
      await this.say(d, 'manualFallback');
      if (this.cfg.recordProof) this.emit('proof', { action: 'stop', orderId: d.orderId });
      this.report(d, 'manual', reason);
    }
    this.store.save(); this.emit('update', d);
  }

  checkTimeouts() {
    const limit = (this.cfg.agentTimeoutSec || 240) * 1000;
    const runLimit = Math.max(limit, 420000);   // agent waits up to 150s for the invite + 90s for accept
    for (const j of this.store.get('jobs')) {
      if ((j.status === 'pending' && Date.now() - j.createdAt > limit) || (j.status === 'running' && Date.now() - (j.startedAt || j.createdAt) > runLimit)) {
        this.jobResult(j.id, false, j.status === 'pending'
          ? `the delivery script never connected from @${j.account || 'the stock account'}: Roblox may have opened, but zotac_delivery.lua did not run (add your executor's autoexec folder on the Auto Delivery page, or execute the script)`
          : 'timeout');
      }
    }
    const jobs = this.store.get('jobs');
    if (jobs.length > 500) jobs.splice(0, jobs.length - 400);
  }

  // --- manual controls from the UI ---------------------------------------
  async manual(orderId, action, arg) {
    const d = this.map[orderId];
    if (!d) throw new Error('No delivery for order');
    if (action === 'confirm') return this.startDelivery(d);
    if (action === 'setUsername') return this.proposeUsername(d, arg);
    if (action === 'done') { d.step = d.accounts.length || 1; return this.finish(d); }
    if (action === 'cancel') { d.state = 'cancelled'; for (const j of this.store.get('jobs')) if (j.orderId === orderId && j.status === 'pending') j.status = 'cancelled'; this.store.save(); this.emit('update', d); return; }
    if (action === 'say') { await this.eld.sendOrderMessage(orderId, String(arg)); d.log.push({ t: Date.now(), out: String(arg) }); this.store.save(); this.emit('update', d); return; }
    if (action === 'resend') return this.say(d, arg);
    if (action === 'start') return this.onSale({ id: orderId, buyer: arg && arg.buyer, title: arg && arg.title }, this.store.get('pets').filter(p => (arg && arg.petIds || []).includes(p.id)));
    throw new Error('Unknown action ' + action);
  }

  // Test delivery: queues a real agent job for one pet to a Roblox username, with no Eldorado
  // order behind it (jobResult finds no delivery record, so nothing is messaged or marked).
  async testJob(petId, buyer) {
    const pet = this.store.get('pets').find(p => p.id === petId);
    if (!pet) throw new Error('Pet not found');
    const acct = this.store.get('accounts').find(a => a.id === pet.accountId);
    if (!acct) throw new Error('Pet has no account');
    const user = await robloxUser(String(buyer).trim());
    if (!user) throw new Error('Roblox user not found: ' + buyer);
    const job = {
      id: rid(6), orderId: 'TEST-' + rid(4), test: true, accountId: acct.id, account: acct.username,
      buyerUsername: user.name, buyerUserId: user.id,
      pets: [{ id: pet.id, name: pet.name, mutation: pet.mutation, gen: pet.gen, traits: pet.traits || [] }],
      status: 'pending', createdAt: Date.now(), attempt: 0
    };
    this.store.get('jobs').push(job);
    this.store.save();
    this.log('info', `Test delivery queued: ${pet.name} from @${acct.username} to @${user.name} (job ${job.id})`);
    this.emit('job', job);
    return job;
  }

  // Simulator: a fake Eldorado order for one or more pets; the buyer's side of the chat is
  // typed in Zotac's simulator window (simSay), the bot answers with the real flow.
  async simulate(petIds, buyer) {
    const pets = this.store.get('pets').filter(p => petIds.includes(p.id));
    if (!pets.length) throw new Error('Pick a pet');
    const id = 'SIM-' + rid(6);
    return this.onSale({ id, sim: true, buyer: buyer || 'TestBuyer', title: pets.map(p => p.name).join(', ') }, pets);
  }
  simSay(orderId, text) {
    return this.onMessage({ id: rid(6), conversationId: orderId, body: String(text || ''), isByMe: false, ts: Date.now() });
  }
  simState(orderId) { return this.map[orderId] || null; }
  cancelJob(id) {
    const j = this.store.get('jobs').find(x => x.id === id);
    if (!j || !['pending', 'running'].includes(j.status)) return false;
    j.status = 'cancelled'; j.finishedAt = Date.now(); this.store.save(); this.emit('job', j);
    return true;
  }

  agentOnline() {
    const last = Math.max(0, ...Object.values(this.lastAgentPoll));
    return Date.now() - last < 60000;
  }
}

module.exports = { Delivery, TALK_APP_ID, decodeJwt };
