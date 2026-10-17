// Auto Delivery: buyer chat flow (TalkJS listener in the bridge) + job queue for
// an external delivery agent (in-game script) that performs the Trade Machine trade.
const EventEmitter = require('events');
const { rid } = require('./store');
const { robloxUser, robloxAvatar, discord, pickFewestAccounts } = require('./services');
const sab = require('./sab');

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
    const text = this.fill(key, { buyer: d.buyer || '', username: d.username || '', accounts: d.accounts.length, orderId: d.orderId, quantity: d.quantity || d.petIds.length || 1, ...vars });
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
    const quantity = Math.max(1, Number(order.quantity) || pets.length || 1);
    const d = this.map[order.id] = {
      orderId: order.id, buyer: order.buyer, title: order.title, conversationId: null, price: order.price != null ? Number(order.price) : null,
      state: 'awaitUsername', username: null, robloxId: null, quantity,
      petIds: pets.map(p => p.id), accounts, step: 0, attempts: 0, jobs: [], log: [], createdAt: Date.now(),
      sim: !!order.sim
    };
    // Bought more than Zotac can match to pets (offer quantity raised outside Zotac, pets removed,
    // offer not listed by Zotac): never trade fewer than were paid for and never let the empty
    // job fail into an automatic cancel. The seller gets pinged and finishes it by hand.
    if (pets.length < quantity) {
      const reason = pets.length
        ? `buyer bought ×${quantity} but only ${pets.length} matching pet(s) are tracked for this offer`
        : `no tracked pets match this offer (bought ×${quantity})`;
      d.state = 'manual'; d.failReason = reason; d.finishedAt = Date.now();
      this.log('warn', `Order ${order.id}: ${reason} — needs you`);
      this.store.save();
      if (!d.sim) d.conversationId = await this.conversationOf(order.id, order.conversationId);
      await this.say(d, 'manualFallback');
      this.report(d, 'manual', reason);
      this.emit('update', d);
      return d;
    }
    if (d.sim) {   // simulated buyer chat: everything stays inside Zotac
      d.conversationId = order.id;
      this.store.save();
      await this.say(d, 'greeting');
      await this.multiNote(d);
      this.emit('update', d);
      return d;
    }
    this.store.save();
    this.ensureTalk();
    d.conversationId = await this.conversationOf(order.id, order.conversationId);
    // Buyers usually type their Roblox username at checkout: then they are only asked to confirm
    // it; otherwise the normal greeting asks them for it.
    let preset = null;
    try { const v = await this.eld.deliveryDetail(order.id, 'RobloxUsername'); if (v && typeof v === 'string') preset = v.trim(); } catch { /* buyer will type it */ }
    const user = preset ? await this.lookupUser(preset) : null;
    if (user) {
      const text = (this.cfg.steps || {}).greetingKnownUser ? null : `Hi ${d.buyer || ''}! Thanks for your order.\n\nYou entered ${user.name} as your Roblox username at checkout. Make sure you are online in Steal a Brainrot.`;
      if (text) await this.sayText(d, text); else await this.say(d, 'greetingKnownUser', { username: user.name });
      await this.multiNote(d);
      await this.proposeUsername(d, user.name, user);
    } else {
      await this.say(d, 'greeting');
      await this.multiNote(d);
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

  // pets of one order on several accounts: gathered onto one "mother" account first (one trade
  // for the buyer) unless Gather is switched off; the old one-trade-per-account flow is the fallback
  gathers(d) { return d.accounts.length > 1 && this.cfg.consolidate !== false && !d.noGather; }
  async multiNote(d) { if (d.accounts.length > 1 && !this.gathers(d)) await this.say(d, 'multiAccount'); }

  async startDelivery(d) {
    d.state = 'delivering'; d.step = 0; d.confirmedAt = Date.now();
    await this.say(d, 'deliveryStarting');
    if (this.cfg.recordProof) this.emit('proof', { action: 'start', orderId: d.orderId });
    if (this.gathers(d)) return this.startGather(d);
    this.queueNext(d);
  }

  // --- gather onto a mother account ----------------------------------------
  // Mother = the account holding most of the order's pets (fewest transfers); ties go to an
  // account whose game is already open, then one with a cookie (Zotac can launch it).
  pickMother(d) {
    const pets = this.store.get('pets').filter(p => d.petIds.includes(p.id) && !p.delivered);
    const accts = this.store.get('accounts');
    const online = id => { const a = accts.find(x => x.id === id); if (!a) return false; const n = String(a.username || '').toLowerCase();
      const poll = Object.entries(this.lastAgentPoll).find(([k]) => k.toLowerCase() === n); return Date.now() - Math.max(poll ? poll[1] : 0, this.lastSeen[n] || 0) < 75000; };
    const score = id => [pets.filter(p => p.accountId === id).length, online(id) ? 1 : 0, (accts.find(a => a.id === id) || {}).cookieEnc ? 1 : 0];
    return [...d.accounts].sort((a, b) => { const x = score(a), y = score(b); return (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]); })[0];
  }

  async startGather(d) {
    const accts = this.store.get('accounts');
    d.mother = d.mother || this.pickMother(d);
    d.origAccounts = d.origAccounts || [...d.accounts];
    const mother = accts.find(a => a.id === d.mother) || {};
    if (!mother.username) { this.log('warn', `Order ${d.orderId}: mother account unknown — one trade per account instead`); return this.gatherFallback(d, 'mother account has no username'); }
    d.gather = d.gather || {};
    const feeders = d.accounts.filter(id => id !== d.mother);
    this.log('info', `Order ${d.orderId}: gathering ×${d.quantity || d.petIds.length} onto @${mother.username} from ${feeders.map(id => '@' + ((accts.find(a => a.id === id) || {}).username || '?')).join(', ')}`);
    await this.say(d, 'gathering', { mother: mother.username });
    for (const f of feeders) this.queueTransfer(d, f);
    this.store.save(); this.emit('update', d);
  }

  // one feeder -> mother hop = a pair of jobs: the feeder's agent sends the trade (pets added,
  // READY, ACCEPT, checks they left its base, then closes its game), the mother's agent accepts
  // the incoming request, checks the offer, READY, ACCEPT, checks they arrived.
  queueTransfer(d, feederId) {
    const accts = this.store.get('accounts');
    const feeder = accts.find(a => a.id === feederId) || {};
    const mother = accts.find(a => a.id === d.mother) || {};
    const pets = this.store.get('pets').filter(p => d.petIds.includes(p.id) && !p.delivered && p.accountId === feederId);
    const g = d.gather[feederId] = d.gather[feederId] || { tries: 0, done: false };
    if (!pets.length) {
      // nothing left on the feeder: fine only if its pets really moved (or were delivered)
      const missing = d.petIds.filter(id => !this.store.get('pets').some(p => p.id === id));
      if (missing.length) return this.needsYou(d, `${missing.length} pet(s) of this order are no longer in Zotac's pet list (removed by a rescan or by hand) — deliver by hand`);
      g.done = true; return this.gatherCheck(d);
    }
    g.tries++;
    const list = pets.map(p => ({ id: p.id, name: p.name, mutation: p.mutation, gen: p.gen, traits: p.traits || [] }));
    const base = { orderId: d.orderId, status: 'pending', createdAt: Date.now(), attempt: g.tries - 1, pets: list, pair: feederId };
    const receive = { ...base, id: rid(6), kind: 'receive', accountId: mother.id, account: mother.username || null,
      fromUsername: feeder.username, fromUserId: feeder.robloxUserId || null, fromDisplayName: feeder.displayName || null, closeWhenIdle: false };
    const transfer = { ...base, id: rid(6), kind: 'transfer', accountId: feeder.id, account: feeder.username || null,
      buyerUsername: mother.username, buyerUserId: mother.robloxUserId || null, inviteTimeout: 240, closeWhenIdle: true };
    transfer.receiveId = receive.id;
    g.receiveId = receive.id; g.transferId = transfer.id;
    g.ids = [...(g.ids || []), receive.id, transfer.id];
    this.store.get('jobs').push(receive, transfer);
    d.jobs.push(receive.id, transfer.id);
    this.store.save();
    this.emit('job', receive); this.emit('job', transfer);
  }

  // result of a transfer/receive job. Either side seeing the pets move is proof enough (the
  // feeder saw them leave, or the mother saw them arrive); the other side's result is then ignored.
  async pairResult(j, ok, reason) {
    const d = this.map[j.orderId];
    if (!d || !d.gather) return;
    const g = d.gather[j.pair];
    if (!g || g.done || !(g.ids || []).includes(j.id)) return;
    const jobs = this.store.get('jobs');
    if (ok) {
      // any try's success counts (a late "done" from an earlier try still means the pets moved)
      g.done = true;
      for (const p of this.store.get('pets')) if (j.pets.some(x => x.id === p.id)) { p.gatheredFrom = p.accountId; p.accountId = d.mother; }
      // the other side still pending never started: drop it. Running = it is in the same trade and
      // reports done/failed on its own (its result no longer changes anything)
      for (const x of jobs) if (g.ids.includes(x.id) && x.id !== j.id && x.status === 'pending') {
        x.status = 'cancelled'; x.reason = 'transfer already confirmed by job ' + j.id; x.finishedAt = Date.now(); this.emit('job', x);
      }
      this.log('info', `Order ${d.orderId}: ${j.pets.length} pet(s) now on @${(this.store.get('accounts').find(a => a.id === d.mother) || {}).username}`);
      this.emit('petsChanged');
      this.store.save();
      return this.gatherCheck(d);
    }
    if (j.id !== g.receiveId && j.id !== g.transferId) return;   // an old try failing late changes nothing
    const other = jobs.find(x => x.id === (j.id === g.receiveId ? g.transferId : g.receiveId));
    // the other side never started: drop it. Still running: ask it to stop (agents only honour that
    // BEFORE a trade window opens) and decide when it reports, so a trade in progress is never doubled.
    if (other && other.status === 'pending') {
      other.status = 'cancelled'; other.reason = 'other side failed: ' + (reason || 'unknown'); other.finishedAt = Date.now(); this.emit('job', other);
    } else if (other && other.status === 'running') {
      other.cancelRequested = true; this.store.save();
      this.log('warn', `Order ${d.orderId}: ${j.kind} side failed (${reason}); waiting for the ${other.kind} side to stop`);
      return;
    }
    this.log('warn', `Order ${d.orderId}: transfer from @${j.kind === 'transfer' ? j.account : j.fromUsername} failed (${reason}), try ${g.tries}`);
    if (g.tries >= 3) return this.gatherFallback(d, reason);
    this.store.save();
    setTimeout(() => { if (d.state === 'delivering' && !g.done && !d.noGather) this.queueTransfer(d, j.pair); }, 10000);
  }

  gatherCheck(d) {
    if (d.state !== 'delivering' || d.noGather) return;
    if (Object.entries(d.gather || {}).some(([id, g]) => id !== d.mother && !g.done)) return;
    if (d.accounts.some(id => id !== d.mother && !(d.gather || {})[id])) return;
    d.accounts = [d.mother]; d.step = 0; d.attempts = 0;
    this.store.save();
    this.queueNext(d);
  }

  // gathering did not work: give up on it for this order and trade from each account instead
  async gatherFallback(d, reason) {
    d.noGather = true; d.gatherFailReason = reason || 'unknown';
    for (const j of this.store.get('jobs')) if (j.orderId === d.orderId && j.pair && j.status === 'pending') { j.status = 'cancelled'; j.reason = 'gather given up'; j.finishedAt = Date.now(); this.emit('job', j); }
    const owners = [...new Set(this.store.get('pets').filter(p => d.petIds.includes(p.id) && !p.delivered).map(p => p.accountId).filter(Boolean))];
    d.accounts = owners.length ? owners : d.accounts; d.step = 0; d.attempts = 0;
    this.log('warn', `Order ${d.orderId}: gathering failed (${reason}) — one trade per account`);
    await this.say(d, 'multiAccount');
    this.store.save();
    this.queueNext(d);
  }

  // Zotac can't go on by itself (bookkeeping problem, not a failed trade): the order is never
  // cancelled for this, the seller gets pinged and the buyer told someone will deliver by hand
  async needsYou(d, reason) {
    if (['done', 'cancelled', 'manual'].includes(d.state)) return;
    d.state = 'manual'; d.failReason = reason; d.finishedAt = Date.now();
    for (const j of this.store.get('jobs')) if (j.orderId === d.orderId && j.status === 'pending') { j.status = 'cancelled'; j.reason = 'needs the seller'; j.finishedAt = Date.now(); this.emit('job', j); }
    this.log('warn', `Order ${d.orderId}: ${reason}`);
    await this.say(d, 'manualFallback');
    if (this.cfg.recordProof) this.emit('proof', { action: 'stop', orderId: d.orderId });
    this.report(d, 'manual', reason);
    this.store.save(); this.emit('update', d);
  }

  // agent asks whether its job is still wanted (a cancelled pair side stops waiting)
  jobStatus(id) { const j = this.store.get('jobs').find(x => x.id === id); return !j ? 'gone' : j.cancelRequested ? 'cancelled' : j.status; }

  queueNext(d) {
    const accounts = d.accounts.length ? d.accounts : [null];
    if (d.step >= accounts.length) return this.finish(d);
    const accountId = accounts[d.step];
    const acct = this.store.get('accounts').find(a => a.id === accountId) || {};
    // pets already delivered (by this or another order) are never traded again
    const pets = this.store.get('pets').filter(p => d.petIds.includes(p.id) && !p.delivered && (accountId === null || p.accountId === accountId));
    // a pet of this order that no longer exists in Zotac was NOT delivered: stop for the seller
    // (this used to count as "already delivered" and finish the order without a trade)
    const missing = d.petIds.filter(id => !this.store.get('pets').some(p => p.id === id));
    if (missing.length) return this.needsYou(d, `${missing.length} pet(s) of this order are no longer in Zotac's pet list (removed by a rescan or by hand) — deliver by hand`);
    if (!pets.length && d.petIds.length) {
      this.log('info', `Order ${d.orderId}: ${accounts.length > 1 ? 'this account\'s pets were' : 'everything was'} already delivered — skipping`);
      d.step++;
      return this.queueNext(d);
    }
    const job = {
      id: rid(6), kind: 'deliver', orderId: d.orderId, accountId, account: acct.username || null,
      buyerUsername: d.username, buyerUserId: d.robloxId, gathered: !!d.mother && !d.noGather,
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
    // a transfer is only handed to the feeder once the mother's agent is waiting for it
    const ready = x => x.kind !== 'transfer' || (jobs.find(y => y.id === x.receiveId) || {}).status === 'running';
    const j = jobs.find(x => x.status === 'pending' && (!account || !x.account || x.account.toLowerCase() === String(account).toLowerCase()) && ready(x));
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
    if (j.pair) { await this.pairResult(j, ok, reason); return true; }   // feeder -> mother hop, not a delivery
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
    const pets = d.samplePets || this.store.get('pets').filter(p => d.petIds.includes(p.id));
    const fmtGen = n => { n = Number(n) || 0; for (const [v, u] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (n >= v) return +(n / v).toFixed(2) + u + '/s'; return n + '/s'; };
    const MUT = { gold: '🟨', diamond: '💎', rainbow: '🌈', lava: '🌋', bloodrot: '🩸', celestial: '🌌', candy: '🍬', galaxy: '🌌', yinyang: '☯️', radioactive: '☢️', cursed: '😈', none: '🧊', normal: '🧊' };
    const mutEmoji = m => MUT[String(m || 'none').toLowerCase().replace(/[^a-z]/g, '')] || '🔷';
    const uname = id => (this.store.get('accounts').find(a => a.id === id) || {}).username;
    const mother = d.mother && !d.noGather ? uname(d.mother) : null;
    const accounts = d.sampleAccounts || (mother ? [mother] : [...new Set(pets.map(p => uname(p.gatheredFrom || p.accountId)).filter(Boolean))]);
    const gatheredFrom = mother ? [...new Set((d.origAccounts || []).filter(id => id !== d.mother).map(uname).filter(Boolean))] : [];
    const price = d.price != null ? d.price : pets.reduce((s, p) => s + (Number(p.price) || 0), 0);
    const secs = Math.max(0, Math.round(((d.finishedAt || Date.now()) - (d.createdAt || Date.now())) / 1000));
    const dur = secs >= 60 ? Math.floor(secs / 60) + 'm ' + (secs % 60) + 's' : secs + 's';
    const style = { done: ['🟢 DELIVERED', 0x22c55e], cancelled: ['🟠 CANCELLED', 0xf59e0b], failed: ['🔴 FAILED', 0xef4444], manual: ['🔴 FAILED · NEEDS YOU', 0xef4444] }[outcome] || ['⚪ ' + String(outcome).toUpperCase(), 0x888888];

    const petLines = pets.length ? pets.map(p => {
      const mut = p.mutation && !/^(none|normal)$/i.test(p.mutation) ? p.mutation : '';
      return `${mutEmoji(p.mutation)} **${p.name}**\n-# ${[fmtGen(p.gen), mut, (p.traits || []).join(', ')].filter(Boolean).join(' · ')}`;
    }).join('\n') : `📦 **${d.title || 'Order'}**`;
    const qty = Math.max(1, d.quantity || pets.length || 1);
    const lines = [
      `## ${style[0]}${d.sim ? '  ·  TEST' : ''}`,
      petLines,
      '',
      `🟡 **$${Number(price || 0).toFixed(2)}**　📦 **×${qty}**　⏱️ **${dur}**`
    ];
    if (reason && outcome !== 'done') lines.push('', `⚠️ **Reason** — ${String(reason).slice(0, 400)}`);
    const who = [d.buyer ? '👤 ' + d.buyer : null, d.username ? (d.robloxId ? `🎮 [@${d.username}](https://www.roblox.com/users/${d.robloxId}/profile)` : '🎮 @' + d.username) : null,
      accounts.length ? '📤 ' + accounts.map(a => '@' + a).join(', ') + (gatheredFrom.length ? ' (gathered from ' + gatheredFrom.map(a => '@' + a).join(', ') + ')' : '') : null, (d.attempts || 0) > (outcome === 'done' ? 0 : 1) ? `🔁 ${(d.attempts || 0) + (outcome === 'done' ? 1 : 0)} tries` : null].filter(Boolean);
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
    return discord(this.store, {
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
    const pairLimit = Math.max(limit, 600000);  // mother waits up to 300s for the request + the trade
    const jobs = this.store.get('jobs');
    const now = Date.now();
    const acc = j => String(j.account || '').toLowerCase();
    for (const j of jobs) {
      if (j.status === 'pending') {
        // queued behind another job of the same account: that agent is busy trading, not missing
        if (jobs.some(x => x !== j && x.status === 'running' && acc(x) === acc(j))) continue;
        let since = j.createdAt;
        for (const x of jobs) if (x !== j && acc(x) === acc(j) && x.finishedAt) since = Math.max(since, x.finishedAt);
        // a transfer is held until the mother waits for it (the receive job times out on its own)
        if (j.kind === 'transfer') { const r = jobs.find(y => y.id === j.receiveId); if (!r || r.status === 'pending') continue; since = Math.max(since, r.startedAt || 0); }
        if (now - since > limit) {
          this.jobResult(j.id, false, `the delivery script never connected from @${j.account || 'the stock account'}: Roblox may have opened, but zotac_delivery.lua did not run (add your executor's autoexec folder on the Auto Delivery page, or execute the script)`);
        }
      } else if (j.status === 'running' && now - (j.startedAt || j.createdAt) > (j.pair ? pairLimit : runLimit)) {
        this.jobResult(j.id, false, 'timeout');
      }
    }
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
  // quantity > picked pets: identical pets (same name, mutation, gen/s, traits) from any account
  // are added, as a real quantity-N sale of one offer would match them
  async simulate(petIds, buyer, quantity) {
    let pets = this.store.get('pets').filter(p => petIds.includes(p.id));
    if (!pets.length) throw new Error('Pick a pet');
    const want = Math.max(1, Number(quantity) || pets.length);
    if (want > pets.length) {
      const key = sab.petKey(pets[0]);
      const spare = this.store.get('pets').filter(p => !pets.includes(p) && p.status !== 'sold' && !p.delivered && sab.petKey(p) === key);
      pets = pets.concat(pickFewestAccounts(spare, want - pets.length, pets[0].accountId));
      if (pets.length < want) throw new Error(`Only ${pets.length} identical ${pets[0].name} found`);
    }
    const id = 'SIM-' + rid(6);
    return this.onSale({ id, sim: true, quantity: pets.length, buyer: buyer || 'TestBuyer', title: pets.length > 1 && pets.every(p => p.name === pets[0].name) ? pets[0].name + ' ×' + pets.length : pets.map(p => p.name).join(', ') }, pets);
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
