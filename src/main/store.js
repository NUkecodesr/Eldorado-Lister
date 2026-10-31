// Local JSON persistence. Everything lives in userData/zotac-data.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rid = (n = 12) => crypto.randomBytes(n).toString('hex');

const DEFAULT_DELIVERY_STEPS = {
  greeting: 'Hi {buyer}! Thanks for your order.\n\nTo complete your delivery via the Trade Machine in Steal a Brainrot, please send your in-game username and make sure you are online.',
  greetingKnownUser: 'Hi {buyer}! Thanks for your order.\n\nYou entered {username} as your Roblox username at checkout. Make sure you are online in Steal a Brainrot.',
  multiAccount: 'Your order has pets across {accounts} different accounts. Delivery will be done sequentially — please wait!',
  confirmUsername: 'Please *confirm* if this is your correct in-game username: {username}\n\nReply with:\n1 - Yes\n2 - No',
  invalidReply: 'Please reply with 1 (Yes) or 2 (No) to confirm your username.',
  usernameRejected: 'No problem! Please send your correct in-game username and make sure you are online.',
  usernameNotFound: "We couldn't find a Roblox account with that username. Please double-check and send it again.",
  deliveryStarting: 'Confirmation received.\nYour order will be delivered in the next few seconds via trade machine. Please remain online.',
  deliveryAccountStep: 'Sending part {step}/{accounts} from account {account}. Please accept the trade.',
  gathering: 'Your {quantity} brainrots are on {accounts} of our accounts. We are moving them onto one account so you get everything in a single trade. This takes a few minutes, please stay online.',
  deliverySuccess: 'Delivered! Please check your inventory and mark the order as received. Thanks for buying!',
  deliveryFailed: "The trade didn't go through ({reason}). We'll retry shortly — please stay online.",
  buyerCancelled: 'It looks like the trade was cancelled. Sending it again now, please accept it in Steal a Brainrot.',
  buyerOffline: 'Your trade is ready, but @{username} is offline in Steal a Brainrot. Please join the game now: we send the trade as soon as you are online.',
  manualFallback: 'Automatic delivery is unavailable right now. A seller will contact you shortly to deliver manually.',
  orderCancelled: 'Your order has been cancelled after {attempts} delivery attempts were unsuccessful ({reason}). Eldorado will refund you. Please contact support if you believe this is a mistake.',
  usernameReminder: "Hi! We still need your Roblox username to deliver your order. Please send it here — the order is cancelled if we don't hear from you within {minutes} minutes.",
  buyerKeptCancelling: "The trade was cancelled {count} times, so we've stopped the delivery and cancelled this order. Eldorado will refund you. Feel free to order again when you're ready to accept the trade!",
  buyerNoShow: "We tried to send your trade for {minutes} minutes, but you were offline in Steal a Brainrot or didn't accept it. We've cancelled this order and Eldorado will refund you. Feel free to order again when you're online!",
  buyerNoUsername: "We didn't receive your Roblox username within {minutes} minutes, so we've cancelled this order. Eldorado will refund you. Feel free to order again!",
  outOfStock:"Sorry! {item} is no longer in stock, so we can't deliver it. Your order has been cancelled and Eldorado will refund you. Sorry for the trouble!"
};

const DEFAULT_TITLE = '{mutation} {name} | {gen}';
const DEFAULT_DESCRIPTION = 'HOW TO RECEIVE:\n1. After purchase, send me your Roblox username\n2. A trade request will be sent. Be online in Steal a Brainrot.\n3. Accept the trade and the brainrot is yours! Fast delivery! Message me if any issues.\n\nWHAT YOU WILL RECEIVE:\n{mutation} {name} | {gen} | {traits}';
// earlier defaults: replaced by the new ones on load unless the user edited them
const OLD_TITLES = ['{name} {mutationTag}| {gen} 🔥 FAST DELIVERY'];
const OLD_DESCRIPTIONS = ['{name}\nMutation: {mutation}\nGeneration: {gen}\nTraits: {traits}\n\nDelivered via Trade Machine. Stay online after buying!'];

const DEFAULTS = {
  settings: {
    webhookUrl: '',
    webhookPing: '',
    notifySales: true,
    notifyDisputes: true,
    notifyMessages: false,
    notifyDelivery: true,          // main webhook also gets the Auto Delivery cards
    deliveryWebhookUrl: '',        // optional second webhook that only gets the Auto Delivery cards
    deliveryWebhookPing: '',
    autoMessage: { enabled: false, text: 'Hi {buyer}! Thanks for buying {item}. Please send your Roblox username and stay online — delivery is coming right up.' },
    autoUpdate: { enabled: true, repo: 'NUkecodesr/Eldorado-Lister', installedSha: '' },
    pollSec: 45,
    game: {
      gameId: '259',
      category: 'CustomItem',
      seoAlias: 'steal-a-brainrot-brainrots',
      msAttr: 'steal-a-brainrot-ms',
      msNumericAttr: 'steal-a-brainrot-ms-numeric',
      mutationAttr: 'steal-a-brainrot-mutations',
      traitsAttr: 'sab-traits-multi',
      itemTypeValue: 'Brainrot'
    },
    autolist: {
      delaySec: 8,
      deliveryTime: 'Minute20',
      titleTemplate: DEFAULT_TITLE,
      descriptionTemplate: DEFAULT_DESCRIPTION,
      emoji: '🔥',
      specialTraits: [],          // pets with one of these traits go to Manual Review and skip Auto Price
      recolorByMutation: true,    // tint the pet picture on generated cards with the mutation colours
      genTolMode: 'pct',          // 'pct' = genTolerancePct (± %), 'ms' = genToleranceMs (± M/s, 0 = exact)
      genToleranceMs: 0,
      priceMode: 'auto',
      fixedPrice: 5,
      undercut: 0.01,
      minPrice: 0.5,
      maxPrice: 5000,
      genTolerancePct: 15,
      fallbackPerMillion: 0.05,
      noCompsMode: 'review',      // fewer than minComps similar listings: 'review' = Manual Review, 'estimate' = gen-scaled / $ per M/s guess
      minComps: 1,
      generateImage: true,
      imageFolder: '',
      stockDetection: true
    },
    // deliveryTimes: competitor offers must use one of these (empty = fall back to maxDeliveryTime)
    rules: { maxDeliveryTime: 'Hour1', deliveryTimes: ['Instant', 'Minute20', 'Hour1'], minFeedback: 95, minRatings: 5, ignoreOwn: true, ignoreTitleWords: '', lowballPct: 40 },
    repricer: { enabled: true, intervalMin: 20, undercut: 0.01, floorPct: 70, maxDropPct: 15, onlyIfBeaten: false, scope: 'all', offerIds: [] },
    scanner: { autoexec: true },   // Auto Scanner: zotac_scanner.lua in autoexec (Roblox Accounts switch)
    delivery: { enabled: false, markDelivered: true, recordProof: false, cancelOnFail: true, cancelOnUnavailable: true, closeOnFail: true, giveUpOnBuyer: true, keepFailedProof: false, proofKeepDays: 0, buyerCancelLimit: 3, buyerNoShowMin: 8, usernameWaitMin: 30, mode: 'single', agentTimeoutSec: 240, steps: DEFAULT_DELIVERY_STEPS },
    launcher: { autoLaunch: true, privateServer: '', exePath: '', multiInstance: true, cooldownSec: 120, closeAfterDelivery: true },
    extensionToken: rid(8),
    agentToken: rid(8),
    localPort: 47321,
    imageTemplates: [],           // Image Editor templates: { id, name, layers: { shop, gen, name, traits, pet, bg }, order[] }
    activeImageTemplate: 'default' // 'default' = the built-in classic card
  },
  accounts: [],          // { id, username, robloxUserId, note }
  pets: [],              // { id, accountId, name, mutation, gen, traits[], rarity, cost, status, offerId, price, title, description, soldPrice, soldAt, orderId }
  templates: [],         // { id, name, title, description, price }
  expenses: [],          // { id, label, amount, date }
  sales: [],             // { id, orderId, title, price, buyer, date, petIds[], source }
  deliveries: {},        // orderId -> conversation state
  jobs: [],              // agent jobs
  trades: [],            // permanent ledger: every pet Zotac traded away or saw disappear (newest last)
  seen: { orders: {}, notifications: {}, disputes: {}, autoMessaged: {} },
  art: { pets: {}, traits: {}, mutations: {} },   // Roblox asset ids from the scanner: name -> id
  logs: []
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'zotac-data.json');
    this.data = structuredClone(DEFAULTS);
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = deepMerge(this.data, raw);
    } catch { /* first run */ }
    const al = this.data.settings.autolist;
    if (OLD_TITLES.includes(al.titleTemplate)) al.titleTemplate = DEFAULT_TITLE;
    if (OLD_DESCRIPTIONS.includes(al.descriptionTemplate)) al.descriptionTemplate = DEFAULT_DESCRIPTION;
    this.timer = null;
    this.dirtySince = 0;   // first unsaved change; 0 = nothing to write
  }
  get(key) { return key ? this.data[key] : this.data; }
  set(key, val) { this.data[key] = val; this.save(); return val; }
  patchSettings(p) { this.data.settings = deepMerge(this.data.settings, p); this.save(); return this.data.settings; }
  // debounced, but never more than 2 s behind: a steady stream of log lines used to push the
  // write back forever, so a crash lost everything since the stream started
  save() {
    clearTimeout(this.timer);
    if (!this.dirtySince) this.dirtySince = Date.now();
    this.timer = setTimeout(() => this.flush(), Date.now() - this.dirtySince > 2000 ? 0 : 300);
  }
  flush() {
    clearTimeout(this.timer);
    this.dirtySince = 0;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
  // write pending changes only (a second instance that quits at once must not overwrite the file)
  flushIfDirty() { if (this.dirtySince) this.flush(); }
  log(level, msg, extra) {
    const entry = { t: Date.now(), level, msg: String(msg), extra: extra === undefined ? undefined : safe(extra) };
    this.data.logs.push(entry);
    // trimmed in batches: one splice per 100 lines instead of shifting 1500 entries on every line
    if (this.data.logs.length > 1600) this.data.logs.splice(0, this.data.logs.length - 1500);
    this.save();
    return entry;
  }
  reset() { const keep = this.data.settings; this.data = structuredClone(DEFAULTS); this.data.settings = keep; this.save(); }
}

function safe(v) {
  if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && isFinite(v))) return v;   // primitives need no round trip
  try { return JSON.parse(JSON.stringify(v)); } catch { return String(v); } }

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over === undefined ? base : over;
  if (base && typeof base === 'object' && over && typeof over === 'object') {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
    return out;
  }
  return over === undefined ? base : over;
}

module.exports = { Store, rid, DEFAULT_DELIVERY_STEPS };
