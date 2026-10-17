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
  'with from friend add added join joining wait waiting sorry bro bruh lol lmao fast slow good great nice cool sure np gg').split(/\s+/));

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
      await this.say(d, 'greetingKnownUser', { username: user.name });
      await this.proposeUsername(d, user.name, user);
    } else {
      await this.say(d, 'greeting');
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

  // Two delivery modes (Auto Delivery → Delivery Mode), fixed per order when its delivery starts:
  //  security: "Security Mode Only". An account in SCRIPT mode is the mother. Each stock account
  //            holding pets of the order is opened with real Roblox (Legit, no executor) in the
  //            private server, one at a time; the mother steals its pets in game, brings them home,
  //            then does ONE trade to the buyer. Only the mother runs Zotac's scripts.
  //  single:   "Single Mode + Security on multi-account". All pets on one account that can run the
  //            script (SCRIPT mode): that account trades the buyer straight away (faster, no steal).
  //            Pets on several accounts, or on a Legit one: Security, as above.
  modeOf(d) { return (d && d.mode) || (this.cfg.mode === 'security' ? 'security' : 'single'); }
  // Single mode: the one account holding every pet of the order, when it can trade by itself
  directAccount(d) {
    const owners = [...new Set(this.store.get('pets').filter(p => d.petIds.includes(p.id) && !p.delivered).map(p => p.accountId))];
    if (owners.length !== 1 || !owners[0]) return null;
    const a = this.store.get('accounts').find(x => x.id === owners[0]);
    return a && !a.legit ? a.id : null;
  }

  async startDelivery(d) {
    d.state = 'delivering'; d.step = 0; d.confirmedAt = Date.now();
    d.mode = this.modeOf(d);
    await this.say(d, 'deliveryStarting');
    if (this.cfg.recordProof) this.emit('proof', { action: 'start', orderId: d.orderId });
    const direct = d.mode === 'single' ? this.directAccount(d) : null;
    if (!direct) {
      if (d.mode === 'single') { d.securityFallback = true; this.log('info', `Order ${d.orderId}: Single mode, pets on ${d.accounts.length > 1 ? 'several accounts' : 'a Legit account'} — Security (mother) for this order`); }
      return this.startSecurity(d);
    }
    d.accounts = [direct];
    this.queueNext(d);
  }

  accountOnline(id) {
    const a = this.store.get('accounts').find(x => x.id === id);
    if (!a) return 0;
    const n = String(a.username || '').toLowerCase();
    const poll = Object.entries(this.lastAgentPoll).find(([k]) => k.toLowerCase() === n);
    return Date.now() - Math.max(poll ? poll[1] : 0, this.lastSeen[n] || 0) < 75000 ? 1 : 0;
  }

  // --- Security mode ---------------------------------------------------------
  // The mother is chosen by state, never by name: an account in SCRIPT mode that can run (game
  // open, or a saved cookie so Zotac can launch it); then most of the order's pets (fewest steals),
  // game already open, fewest failed jobs in the last 2 h, least recently used as mother.
  pickMother(d) {
    const pets = this.store.get('pets').filter(p => d.petIds.includes(p.id) && !p.delivered);
    const jobs = this.store.get('jobs');
    const since = Date.now() - 2 * 3600e3;
    const lastMother = id => Math.max(0, ...Object.values(this.map).filter(x => x && x !== d && x.mother === id).map(x => x.createdAt || 0));
    const score = a => [pets.filter(p => p.accountId === a.id).length, this.accountOnline(a.id),
      -jobs.filter(j => j.accountId === a.id && j.status === 'failed' && (j.finishedAt || 0) > since).length, -lastMother(a.id)];
    const cands = this.store.get('accounts').filter(a => !a.legit && a.username && (a.cookieEnc || this.accountOnline(a.id)));
    cands.sort((x, y) => { const p = score(x), q = score(y); for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return q[i] - p[i]; return 0; });
    return cands.length ? cands[0].id : null;
  }

  async startSecurity(d) {
    const accts = this.store.get('accounts');
    d.mother = d.mother || this.pickMother(d);
    const mother = accts.find(a => a.id === d.mother);
    if (!mother) return this.needsYou(d, 'Security mode needs an account in SCRIPT mode with a saved cookie to be the mother, and there is none (Roblox Accounts → SCRIPT)');
    d.origAccounts = d.origAccounts || [...d.accounts];
    d.steal = d.steal || {};
    const petsOf = id => this.store.get('pets').filter(p => d.petIds.includes(p.id) && !p.delivered && p.accountId === id).length;
    d.feeders = d.feeders || d.accounts.filter(id => id !== d.mother && petsOf(id) > 0).sort((x, y) => petsOf(y) - petsOf(x));
    // a stock account Zotac can't open (no cookie) and that isn't in game: nobody can steal from it
    const stuck = d.feeders.map(id => accts.find(a => a.id === id) || { id }).filter(a => !a.cookieEnc && !this.accountOnline(a.id));
    if (stuck.length) return this.needsYou(d, `Security mode: ${stuck.map(a => '@' + (a.username || '?')).join(', ')} has no saved cookie, so Zotac can't open it for the mother — add the cookie or deliver by hand`);
    const uname = id => '@' + ((accts.find(a => a.id === id) || {}).username || '?');
    if (d.feeders.length) {
      this.log('info', `Order ${d.orderId}: Security mode — mother @${mother.username} takes the pets from ${d.feeders.map(uname).join(', ')}`);
      if (d.accounts.length > 1) await this.say(d, 'gathering', { mother: mother.username });
    }
    this.store.save(); this.emit('update', d);
    this.nextSteal(d);
  }

  // stock accounts one at a time: the next one is only opened after the previous steal ended and
  // its game closed, so at most 2 games are open (mother + one stock account). All done = the
  // mother trades the buyer.
  nextSteal(d) {
    if (!d || d.state !== 'delivering' || !d.feeders) return;
    const g = d.steal || (d.steal = {});
    if (d.feeders.some(id => g[id] && !g[id].done)) return;
    const next = d.feeders.find(id => !g[id]);
    if (next) return this.queueSteal(d, next);
    // every pet still to deliver must be on the mother now (a pet with no account, or one a steal
    // never moved, would otherwise count as delivered)
    const off = this.store.get('pets').filter(p => d.petIds.includes(p.id) && !p.delivered && p.accountId !== d.mother);
    if (off.length) return this.needsYou(d, `${off.length} pet(s) of this order are not on the mother (${off.map(p => p.name + (p.accountId ? '' : ', no account')).join('; ')}) — deliver by hand`);
    d.accounts = [d.mother]; d.step = 0; d.attempts = 0;
    this.store.save();
    this.queueNext(d);
  }

  queueSteal(d, feederId) {
    const accts = this.store.get('accounts');
    const feeder = accts.find(a => a.id === feederId) || {};
    const mother = accts.find(a => a.id === d.mother) || {};
    const pets = this.store.get('pets').filter(p => d.petIds.includes(p.id) && !p.delivered && p.accountId === feederId);
    const g = d.steal[feederId] = d.steal[feederId] || { tries: 0, done: false };
    if (!pets.length) {
      // nothing left on that account: fine only if its pets really moved (or were delivered)
      const missing = d.petIds.filter(id => !this.store.get('pets').some(p => p.id === id));
      if (missing.length) return this.needsYou(d, `${missing.length} pet(s) of this order are no longer in Zotac's pet list (removed by a rescan or by hand) — deliver by hand`);
      g.done = true; return this.nextSteal(d);
    }
    g.tries++;
    const job = {
      id: rid(6), kind: 'steal', orderId: d.orderId, accountId: mother.id, account: mother.username || null,
      fromAccountId: feeder.id, fromUsername: feeder.username || null, fromUserId: feeder.robloxUserId || null, fromDisplayName: feeder.displayName || null,
      pets: pets.map(p => ({ id: p.id, uuid: p.uuid || null, name: p.name, mutation: p.mutation, gen: p.gen, traits: p.traits || [] })),
      status: 'pending', createdAt: Date.now(), attempt: g.tries - 1, closeWhenIdle: false
    };
    g.jobId = job.id;
    this.store.get('jobs').push(job);
    d.jobs.push(job.id);
    this.store.save();
    this.emit('job', job);
  }

  // the stock account of a running steal is opened with real Roblox and closed again once it is
  // no longer needed. Hooks set by main (launcher); none in tests.
  openHost(j) {
    if (!this.hosts) return;
    Promise.resolve().then(() => this.hosts.open(j.fromAccountId, j)).catch(e => {
      this.log('warn', `Job ${j.id}: could not open @${j.fromUsername} with real Roblox: ${e.message}`);
      if (j.status === 'running') this.jobResult(j.id, false, `could not open @${j.fromUsername} with real Roblox: ${e.message}`);
    });
  }
  async closeHost(accountId) {
    if (!this.hosts || !accountId) return;
    // another steal still waits for that account: left open
    if (this.store.get('jobs').some(x => x.kind === 'steal' && x.fromAccountId === accountId && ['pending', 'running'].includes(x.status))) return;
    try { await this.hosts.close(accountId); } catch (e) { this.log('warn', `closing the stock account's game: ${e.message}`); }
  }

  // result of a steal. Done = the mother's agent saw the pets land in its own base: they are the
  // mother's now, also when the order ended meanwhile (rule 9: a trade that happened is booked).
  // pets of a steal that are in the mother's base now: off the stock account, onto the mother,
  // in the ledger. Only pets still booked on the stock account move (a repeat report changes nothing).
  bookSteal(j, ids) {
    const d = this.map[j.orderId];
    const pets = this.store.get('pets').filter(p => ids.includes(p.id) && j.pets.some(x => x.id === p.id) && p.accountId === j.fromAccountId);
    if (!pets.length) return 0;
    for (const p of pets) { p.gatheredFrom = p.accountId; p.accountId = j.accountId; }
    this.record('gather', { orderId: j.orderId, from: j.fromUsername, to: j.account, pets, jobId: j.id, sim: !!(d && d.sim), note: 'stolen in game by the mother (Security mode)' });
    this.log('info', `Order ${j.orderId}: ${pets.length} pet(s) taken from @${j.fromUsername}, now on @${j.account}`);
    this.emit('petsChanged');
    this.store.save();
    return pets.length;
  }

  async stealResult(j, ok, reason, moved = []) {
    const d = this.map[j.orderId];
    if (moved.length) this.bookSteal(j, moved);
    const g = d && d.steal && d.steal[j.fromAccountId];
    const current = !!(g && g.jobId === j.id && d.state === 'delivering');
    if (ok || !current || g.tries >= 3) await this.closeHost(j.fromAccountId);
    if (!current) return;   // an old try or an ended order: booked above, nothing more
    if (ok) { g.done = true; this.store.save(); return this.nextSteal(d); }
    this.log('warn', `Order ${d.orderId}: steal from @${j.fromUsername} failed (${reason}), try ${g.tries}`);
    if (g.tries >= 3) return this.needsYou(d, `the mother @${j.account} could not take the pets from @${j.fromUsername} (3 tries, last: ${reason || 'unknown'}) — deliver by hand`);
    this.store.save();
    // the stock account's game stays open for the next try
    setTimeout(() => { if (d.state === 'delivering' && !g.done && g.jobId === j.id) this.queueSteal(d, j.fromAccountId); }, 10000);
  }

  // pending jobs of the order are dropped; running ones are asked to stop (agents obey before a
  // trade window opens; a trade already open finishes and is still booked)
  stopJobs(d, reason) {
    for (const j of this.store.get('jobs')) {
      if (j.orderId !== d.orderId) continue;
      if (j.status === 'pending') { j.status = 'cancelled'; j.reason = reason; j.finishedAt = Date.now(); this.emit('job', j); }
      else if (j.status === 'running') j.cancelRequested = true;
    }
    this.store.save();
  }

  // the order ended without delivering some pets (cancelled here or on Eldorado): they are stock
  // again, back on their offer when they had one (Listings / the repricer clean up offers that
  // no longer exist)
  releasePets(orderId) {
    let n = 0;
    for (const p of this.store.get('pets')) {
      if (p.orderId !== orderId || p.delivered) continue;
      p.status = p.offerId ? 'listed' : 'available';
      p.orderId = null; p.soldAt = null; p.soldPrice = null;
      n++;
    }
    if (n) { this.log('info', `Order ${orderId}: ${n} undelivered pet(s) back in stock`); this.emit('petsChanged'); this.store.save(); }
    return n;
  }

  // Eldorado shows the order cancelled/refunded (buyer, support or seller): stop and restock
  orderCancelledRemote(orderId) {
    const d = this.map[orderId];
    if (d && !['done', 'cancelled'].includes(d.state)) {
      this.stopJobs(d, 'order cancelled on Eldorado');
      d.state = 'cancelled'; d.finishedAt = Date.now(); d.failReason = d.failReason || 'cancelled on Eldorado';
      if (this.cfg.recordProof) this.emit('proof', { action: 'stop', orderId });
      this.emit('update', d);
    }
    return this.releasePets(orderId);
  }

  // Zotac can't go on by itself (bookkeeping problem, not a failed trade): the order is never
  // cancelled for this, the seller gets pinged and the buyer told someone will deliver by hand
  async needsYou(d, reason) {
    if (['done', 'cancelled', 'manual'].includes(d.state)) return;
    d.state = 'manual'; d.failReason = reason; d.finishedAt = Date.now();
    this.stopJobs(d, 'needs the seller');
    this.log('warn', `Order ${d.orderId}: ${reason}`);
    await this.say(d, 'manualFallback');
    if (this.cfg.recordProof) this.emit('proof', { action: 'stop', orderId: d.orderId });
    this.report(d, 'manual', reason);
    this.store.save(); this.emit('update', d);
  }

  // in-game event from a running job. buyer_cancelled: the agent sends the trade again by itself;
  // the buyer is told, and the job's run timer restarts so the re-offer isn't cut off
  async jobEvent(id, body = {}) {
    const j = this.store.get('jobs').find(x => x.id === id);
    if (!j || j.status !== 'running') return false;
    if (body.event === 'buyer_cancelled') {
      j.startedAt = Date.now(); j.reoffers = (j.reoffers || 0) + 1;
      this.store.save(); this.emit('job', j);
      const d = this.map[j.orderId];
      this.log('warn', `Job ${id}: @${j.buyerUsername} cancelled the trade (${body.reason || '?'}) — sending it again`);
      if (d) await this.say(d, 'buyerCancelled', { round: body.round || j.reoffers });
    }
    return true;
  }

  // permanent memory of pets that left a base: stolen by the mother, delivered to a buyer, or (from
  // importPets) gone without Zotac trading them. Kept even after the pets list forgets them.
  record(kind, { orderId = null, from = null, to = null, toUserId = null, pets = [], jobId = null, sim = false, note = null } = {}) {
    const list = this.store.get('trades') || this.store.set('trades', []);
    const e = { id: rid(6), t: Date.now(), kind, orderId, sim: !!sim, from, to, toUserId, jobId, note, proofs: [],
      pets: pets.map(p => ({ id: p.id, name: p.name, mutation: p.mutation || 'None', gen: Number(p.gen) || 0, traits: p.traits || [] })) };
    list.push(e);
    if (list.length > 5000) list.splice(0, list.length - 5000);
    this.store.save(); this.emit('trade', e);
    return e;
  }

  // the agent asks whether its job is still wanted: anything but running (stopped, timed out) = stop
  jobStatus(id) { const j = this.store.get('jobs').find(x => x.id === id); return !j ? 'gone' : j.cancelRequested ? 'cancelled' : j.status; }

  queueNext(d) {
    if (d.state !== 'delivering') return;
    if (!d.accounts.length) return this.needsYou(d, "the order's pets have no Roblox account in Zotac — deliver by hand");
    const accounts = d.accounts;
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
      // nothing on this account: fine only when the order's other pets are delivered or wait on a
      // later account; a pet with no account is never "already delivered"
      const later = new Set(accounts.slice(d.step + 1));
      const stray = this.store.get('pets').filter(p => d.petIds.includes(p.id) && !p.delivered && !later.has(p.accountId));
      if (stray.length) return this.needsYou(d, `${stray.length} pet(s) of this order are not on @${acct.username || '?'} (${stray.map(p => p.name).join(', ')}) — deliver by hand`);
      this.log('info', `Order ${d.orderId}: ${accounts.length > 1 ? 'this account\'s pets were' : 'everything was'} already delivered — skipping`);
      d.step++;
      return this.queueNext(d);
    }
    // Legit = real Roblox without the executor: no delivery script can run in it
    if (acct.legit) return this.needsYou(d, `@${acct.username} is in Legit mode (real Roblox, no scripts), so it can't trade the buyer`);
    const job = {
      id: rid(6), kind: 'deliver', orderId: d.orderId, accountId, account: acct.username || null,
      buyerUsername: d.username, buyerUserId: d.robloxId, gathered: !!d.mother,
      pets: pets.map(p => ({ id: p.id, uuid: p.uuid || null, name: p.name, mutation: p.mutation, gen: p.gen, traits: p.traits || [] })),
      status: 'pending', createdAt: Date.now(), attempt: d.attempts,
      closeWhenIdle: (this.store.get('settings').launcher || {}).closeAfterDelivery !== false
    };
    this.store.get('jobs').push(job);
    d.jobs.push(job.id);
    this.store.save();
    this.emit('job', job);
  }

  // --- agent API -------------------------------------------------------
  nextJob(account) {
    this.lastAgentPoll[account || '*'] = Date.now();
    const jobs = this.store.get('jobs');
    const j = account ? jobs.find(x => x.status === 'pending' && x.account && x.account.toLowerCase() === String(account).toLowerCase()) : null;
    if (!j) return null;
    j.status = 'running'; j.startedAt = Date.now();
    this.store.save(); this.emit('job', j);
    // the mother is in game and waits for the stock account: open it now (real Roblox)
    if (j.kind === 'steal') this.openHost(j);
    return j;
  }

  async jobResult(id, ok, reason, extra = {}) {
    const j = this.store.get('jobs').find(x => x.id === id);
    if (!j) return false;
    // steal: pets that landed in the mother's base (all of them when done, else what the agent says)
    const moved = j.kind !== 'steal' ? [] : ok ? j.pets.map(p => p.id) : (Array.isArray(extra && extra.moved) ? extra.moved.map(String) : []);
    if (!['running', 'pending'].includes(j.status)) {
      // a steal Zotac already ended (timeout, stop) still moved pets: booked anyway (rule 9)
      if (moved.length) this.bookSteal(j, moved);
      return false;
    }
    j.status = ok ? 'done' : 'failed'; j.finishedAt = Date.now(); j.reason = reason || null;
    this.store.save(); this.emit('job', j);
    if (j.kind === 'steal') { await this.stealResult(j, ok, reason, moved); return true; }   // stock -> mother, not a delivery
    const d = this.map[j.orderId];
    // a pet really left for a buyer (agent checked the base): remembered for good, test trades too
    if (ok) {
      // off that account's inventory right away (test deliveries have no order but the pet is gone too)
      for (const p of this.store.get('pets')) if (j.pets.some(x => x.id === p.id)) { p.delivered = true; p.tradedTo = j.buyerUsername || null; p.tradedAt = Date.now(); if (p.status !== 'sold') { p.status = 'sold'; p.soldAt = p.soldAt || Date.now(); } }
      this.emit('petsChanged');
    }
    if (ok) this.record('delivered', { orderId: j.orderId, from: j.account, to: j.buyerUsername, toUserId: j.buyerUserId, pets: j.pets, jobId: j.id, sim: (d && d.sim) || !!j.test, note: j.test ? 'test delivery' : (j.gathered ? 'gathered order' : null) });
    if (!d) return true;
    if (d.state !== 'delivering') { this.log('info', `Job ${j.id} ${ok ? 'done' : 'failed'} after order ${d.orderId} ended (${d.state}) — nothing more sent`); this.store.save(); return true; }
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
    const mother = d.mother ? uname(d.mother) : null;
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
      accounts.length ? '📤 ' + accounts.map(a => '@' + a).join(', ') + (gatheredFrom.length ? ' (taken from ' + gatheredFrom.map(a => '@' + a).join(', ') + ')' : '') : null, (d.attempts || 0) > (outcome === 'done' ? 0 : 1) ? `🔁 ${(d.attempts || 0) + (outcome === 'done' ? 1 : 0)} tries` : null].filter(Boolean);
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
    this.stopJobs(d, 'order finished');
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
    this.stopJobs(d, 'order failed');
    if (this.cfg.cancelOnFail !== false) {
      d.state = 'cancelled';
      this.releasePets(d.orderId);
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
    // a steal: up to 240s for the stock account to join + 60s for its base, then per pet the walk
    // there, a locked base, the steal and the walk home (the agent gives up on each by itself)
    const stealLimit = j => Math.max(limit, (420 + 300 * ((j.pets || []).length || 1)) * 1000);
    const jobs = this.store.get('jobs');
    const now = Date.now();
    const acc = j => String(j.account || '').toLowerCase();
    for (const j of jobs) {
      if (j.status === 'pending') {
        // queued behind another job of the same account: that agent is busy trading, not missing
        if (jobs.some(x => x !== j && x.status === 'running' && acc(x) === acc(j))) continue;
        let since = j.createdAt;
        for (const x of jobs) if (x !== j && acc(x) === acc(j) && x.finishedAt) since = Math.max(since, x.finishedAt);
        if (now - since > limit) {
          this.jobResult(j.id, false, `the delivery script never connected from @${j.account || 'the stock account'}: Roblox may have opened, but zotac_delivery.lua did not run (add your executor's autoexec folder on the Auto Delivery page, or execute the script)`);
        }
      } else if (j.status === 'running' && now - (j.startedAt || j.createdAt) > (j.kind === 'steal' ? stealLimit(j) : runLimit)) {
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
    if (action === 'done') {
      // delivered by hand: the pets are gone from the stock accounts
      for (const p of this.store.get('pets')) if (d.petIds.includes(p.id) && !p.delivered) { p.delivered = true; p.tradedTo = d.username || null; p.tradedAt = Date.now(); if (p.status !== 'sold') { p.status = 'sold'; p.soldAt = p.soldAt || Date.now(); } }
      const left = this.store.get('pets').filter(p => d.petIds.includes(p.id));
      if (left.length) this.record('delivered', { orderId, to: d.username, pets: left, sim: d.sim, note: 'marked done by hand' });
      this.emit('petsChanged');
      d.step = d.accounts.length || 1; return this.finish(d);
    }
    if (action === 'cancel') {
      // stops Zotac only: the Eldorado order is not cancelled and the buyer is not messaged
      this.stopJobs(d, 'stopped by the seller');
      d.state = 'cancelled'; d.finishedAt = Date.now(); d.failReason = d.failReason || 'stopped by the seller';
      this.releasePets(orderId);
      if (this.cfg.recordProof) this.emit('proof', { action: 'stop', orderId });
      this.store.save(); this.emit('update', d); return;
    }
    if (action === 'say') { await this.eld.sendOrderMessage(orderId, String(arg)); d.log.push({ t: Date.now(), out: String(arg) }); this.store.save(); this.emit('update', d); return; }
    if (action === 'resend') return this.say(d, arg);
    throw new Error('Unknown action ' + action);
  }

  // Orders page "Start auto delivery" for an order the watcher did not start (e.g. Auto Delivery
  // was off). Pets: the ones already booked to this order at the sale, else the offer's listed
  // pets for the bought quantity, matched exactly like a new sale. Never the whole offer's stock.
  async startFromOrder(o) {
    if (!o || !o.id) throw new Error('No order');
    if (this.map[o.id]) throw new Error('This order already has a delivery (Auto Delivery → activity)');
    const qty = Math.max(1, Number(o.quantity) || 1);
    const all = this.store.get('pets');
    let pets = all.filter(p => p.orderId === o.id && !p.delivered);
    if (!pets.length) {
      if (!o.offerId) throw new Error('This order has no offer id: pick the pets by hand');
      pets = pickFewestAccounts(all.filter(p => p.offerId === o.offerId && p.status === 'listed' && !p.delivered), qty);
      for (const p of pets) Object.assign(p, { status: 'sold', soldAt: Date.now(), orderId: o.id });
      this.store.save(); this.emit('petsChanged');
    }
    const d = await this.onSale({ id: o.id, buyer: o.buyer, title: o.title, price: o.price, quantity: qty, conversationId: o.conversationId }, pets.slice(0, qty));
    return { started: !!d || !!this.map[o.id], pets: Math.min(pets.length, qty), quantity: qty };
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
      pets: [{ id: pet.id, uuid: pet.uuid || null, name: pet.name, mutation: pet.mutation, gen: pet.gen, traits: pet.traits || [] }],
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
