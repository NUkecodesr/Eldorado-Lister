// Eldorado.gg API surface (endpoints taken from the site's own JS bundle).
const sab = require('./sab');

const DELIVERY_ORDER = ['Instant', 'Minute20', 'Hour1', 'Hour2', 'Hour3', 'Hour5', 'Hour8', 'Hour12', 'Day1', 'Day2', 'Day3', 'Day5', 'Day7', 'Day10', 'Day14', 'Day28', 'Day45', 'Day60', 'Day80', 'Day100'];

// Pull the first array of records out of any paginated response shape.
function listOf(d) {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== 'object') return [];
  for (const k of ['results', 'items', 'records', 'data', 'orders', 'offers', 'transactions', 'notifications', 'reviews']) if (Array.isArray(d[k])) return d[k];
  for (const v of Object.values(d)) if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
  return [];
}

const amountOf = v => (v == null ? null : typeof v === 'number' ? v : typeof v === 'object' ? (v.amount ?? v.value ?? null) : Number(v) || null);

// Eldorado's order state is an object ({ state: 'Received', ... }) in the seller order lists
const stateOf = v => (v && typeof v === 'object' ? (v.state || v.name || v.value || '') : (v || ''));
// the buyer's Roblox username typed at checkout: deliveryDetails = [{ type: 'RobloxUsername', value }]
const robloxOf = o => {
  const f = Array.isArray(o && o.deliveryDetails) ? o.deliveryDetails.find(x => x && /roblox/i.test(x.type || x.name || '')) : null;
  return f && String(f.value || '').trim() || null;
};

function normalizeOrder(o) {
  const offer = o.orderOfferDetails || o.offer || o.offerDetails || o.orderOffer || {};
  const img = offer.mainOfferImage || o.mainOfferImage || null;
  return {
    id: o.id || o.orderId,
    state: stateOf(o.orderState) || stateOf(o.state) || stateOf(o.status) || '',
    title: o.offerTitle || offer.offerTitle || o.title || o.itemTitle || o.gameCategoryTitle || '',
    image: img ? (img.largeImage || img.smallImage || img.originalSizeImage || null) : null,
    robloxUsername: robloxOf(o),
    lastMessage: (o.conversationDetails && o.conversationDetails.message) || '',
    offerId: o.offerId || offer.offerId || offer.id || null,
    buyer: o.buyerUsername || (o.buyer && (o.buyer.username || o.buyer.name)) || o.buyerName || o.counterpartyUsername || '',
    buyerId: o.buyerId || (o.buyer && o.buyer.id) || null,
    quantity: o.purchaseQuantity || o.quantity || o.orderedQuantity || (offer.orderPricing && offer.orderPricing.quantity) || 1,
    price: amountOf(o.totalPrice) ?? amountOf(o.price) ?? amountOf(o.sellerEarnings) ?? amountOf(o.orderPrice) ?? amountOf(o.amount),
    earnings: amountOf(o.sellerEarnings) ?? amountOf(o.sellerPayout) ?? amountOf(o.netAmount),
    date: o.createdDate || o.orderDate || o.created || o.date || null,
    rating: o.rating || o.review || null,
    gameId: o.gameId || offer.gameId,
    conversationId: o.talkJsConversationId || o.conversationId || null,
    raw: o
  };
}

class Eldorado {
  constructor(bridge, store) {
    this.b = bridge;
    this.store = store;
    this.cache = { library: null, attrs: null, filters: null, itemIndex: null, me: null, at: 0 };
  }
  get game() { return this.store.get('settings').game; }

  // --- static game data ------------------------------------------------
  async library(force) {
    const g = this.game;
    if (!force && this.cache.library && this.cache.libGame === g.gameId) return this.cache.library;
    const [lib, attrs] = await Promise.all([
      this.b.get(`library/${g.gameId}/${g.category}`, { locale: 'en-US' }),
      this.b.get(`library/${g.gameId}/${g.category}/attributes/offers`, { locale: 'en-US' }).catch(() => [])
    ]);
    this.cache.library = lib; this.cache.attrs = attrs; this.cache.libGame = g.gameId;
    this.cache.itemIndex = sab.buildItemIndex(lib, g.itemTypeValue);
    return lib;
  }
  async attrMeta() { await this.library(); return this.cache.attrs || []; }
  async itemIndex() { await this.library(); return this.cache.itemIndex; }
  async itemList() {
    const idx = await this.itemIndex();
    return [...idx.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  attrValues(id) { return ((this.cache.attrs || []).find(a => a.id === id) || {}).selectValues || []; }

  // --- account ---------------------------------------------------------
  async me(force) {
    if (!force && this.cache.me && Date.now() - this.cache.at < 60000) return this.cache.me;
    const me = await this.b.get('users/me');
    this.cache.me = me; this.cache.at = Date.now();
    return me;
  }
  async publicProfile(username) { return this.b.get(`users/${encodeURIComponent(username)}/publicByUsername`); }
  async dashboard() {
    const me = await this.me(true);
    const userId = me.id || me.userId;
    const settled = await Promise.allSettled([
      this.b.get('userpayment/me'),
      this.b.get('orders/me/pendingOrdersSum'),
      this.b.get('v1/item-management/me/offers/state-count', { gameId: this.game.gameId, category: this.game.category }),
      this.b.get('orders/me/statesCount', { orderType: 'Sold' }),
      me.username ? this.publicProfile(me.username) : Promise.resolve(null),
      userId ? this.b.get(`orders/reviews/${userId}/stats`) : Promise.resolve(null),
      this.b.get('notifications/me/unread-count')
    ]);
    const v = i => (settled[i].status === 'fulfilled' ? settled[i].value : null);
    return { me, wallet: v(0), pending: v(1), offerStates: v(2), orderStates: v(3), profile: v(4), reviewStats: v(5), unread: v(6) };
  }

  // --- wallet ----------------------------------------------------------
  async wallet() {
    const settled = await Promise.allSettled([
      this.b.get('userpayment/me'),
      this.b.get('orders/me/pendingOrdersSum')
    ]);
    return { payment: settled[0].value || null, pending: settled[1].value || null, error: settled[0].reason && settled[0].reason.message };
  }

  // --- offers ----------------------------------------------------------
  async searchMarket(q = {}) {
    const g = this.game;
    const query = {
      gameId: g.gameId, category: g.category,
      pageIndex: q.page || 1, pageSize: q.pageSize || 24,
      tradeEnvironmentValue0: q.itemType || undefined,
      tradeEnvironmentValue1: q.rarity || undefined,
      tradeEnvironmentValue2: q.name || undefined,
      searchQuery: q.search || undefined,
      deliveryTime: q.deliveryTime || undefined,
      lowestPrice: q.minPrice || undefined,
      highestPrice: q.maxPrice || undefined,
      includeDeliveryMedians: true,
      useMinPurchasePrice: false
    };
    if (q.sort === 'priceAsc') { query.offerSortingCriterion = 'Price'; query.isAscending = true; }
    if (q.sort === 'priceDesc') { query.offerSortingCriterion = 'Price'; query.isAscending = false; }
    if (q.mutation) query[g.mutationAttr] = q.mutation;
    if (q.genBucket) query[g.msAttr] = q.genBucket;
    if (q.trait) query[g.traitsAttr] = q.trait;
    return this.b.get('v1/item-management/offers', query);
  }

  async myOffers({ state = 'Active', page = 1, pageSize = 50 } = {}) {   // Eldorado: PageSize max 50
    const g = this.game;
    return this.b.get('v1/item-management/me/offers/me/search', {
      gameId: g.gameId, category: g.category, offerState: state || undefined, pageIndex: page, pageSize
    });
  }
  async myOffersAll(state = 'Active') {
    const all = [];
    for (let page = 1; page <= 30; page++) {
      const r = await this.myOffers({ state, page, pageSize: 50 });
      const rows = listOf(r);
      all.push(...rows);
      const total = r && (r.totalPages || (r.recordCount && Math.ceil(r.recordCount / 50)));
      if (!rows.length || (total && page >= total) || rows.length < 50) break;
    }
    return all.map(x => x.offer || x);
  }
  offer(id) { return this.b.get(`v1/item-management/offers/${id}`); }
  pauseOffer(id) { return this.b.post(`v1/item-management/me/offers/${id}/pause`); }
  resumeOffer(id) { return this.b.post(`v1/item-management/me/offers/${id}/resume`); }
  deleteOffer(id) { return this.b.del(`v1/item-management/me/offers/${id}`); }
  setPrice(id, amount) { return this.b.put(`v1/item-management/me/offers/${id}/price`, { amount: round2(amount), currency: 'USD' }); }

  async uploadImage(base64, filename = 'offer.png') {
    const r = await this.b.upload('files/me/Offer', { image: { base64, filename, type: 'image/png' } });
    return normalizeImage(r);
  }

  // Build the create/update payload for one pet.
  async buildOfferPayload(pet, { title, description, price, deliveryTime, quantity = 1, image }) {
    const g = this.game;
    const idx = await this.itemIndex();
    const item = sab.findItem(idx, pet.name);
    if (!item) throw new Error(`"${pet.name}" not found in Eldorado item list (check spelling or Custom Game Config)`);
    const meta = await this.attrMeta();
    const offerAttributes = [];
    const has = id => meta.some(a => a.id === id);
    if (has(g.msAttr)) offerAttributes.push({ id: g.msAttr, type: 'Select', values: [sab.genBucket(pet.gen)] });
    if (has(g.mutationAttr)) offerAttributes.push({ id: g.mutationAttr, type: 'Select', values: [sab.mutationId(pet.mutation, this.attrValues(g.mutationAttr))] });
    if (has(g.msNumericAttr) && pet.gen > 0) offerAttributes.push({ id: g.msNumericAttr, type: 'Numeric', value: Math.round(pet.gen) });
    if (has(g.traitsAttr)) {
      const t = sab.traitIds(pet.traits, this.attrValues(g.traitsAttr));
      if (t.length) offerAttributes.push({ id: g.traitsAttr, type: 'Select', values: t });
    }
    return {
      augmentedGame: { gameId: g.gameId, category: g.category, tradeEnvironmentId: item.id, offerAttributes },
      details: {
        pricing: { quantity, pricePerUnit: { amount: round2(price), currency: 'USD' }, volumeDiscounts: [] },
        description: description || title,
        guaranteedDeliveryTime: deliveryTime || 'Minute20',
        offerTitle: String(title).slice(0, 160),
        mainOfferImage: image || undefined,
        offerImages: []
      },
      _item: item
    };
  }

  async createOffer(payload) {
    const body = { ...payload }; delete body._item;
    return this.b.post('v1/item-management/me/offers/item', body);
  }

  async updateOfferDetails(offerId, payload) {
    const body = { ...payload }; delete body._item;
    return this.b.put(`v1/item-management/me/offers/item/${offerId}/details`, body);
  }

  // Rebuild an existing offer with a new quantity (stock detection).
  async bumpQuantity(offerData, delta = 1) {
    const o = offerData.offer || offerData;
    const attrs = (o.attributes || []).map(a => a.type === 'Numeric'
      ? { id: a.id, type: 'Numeric', value: a.value }
      : { id: a.id, type: 'Select', values: (a.values || (a.value ? [a.value] : [])).map(v => v.id) });
    const env = o.tradeEnvironmentValues || [];
    const payload = {
      augmentedGame: { gameId: o.gameId, category: o.category, tradeEnvironmentId: (env[env.length - 1] || {}).id, offerAttributes: attrs },
      details: {
        pricing: { quantity: (o.quantity || 1) + delta, pricePerUnit: o.pricePerUnit, volumeDiscounts: o.volumeDiscounts || [] },
        description: o.description,
        guaranteedDeliveryTime: o.guaranteedDeliveryTime,
        offerTitle: o.offerTitle,
        mainOfferImage: o.mainOfferImage,
        offerImages: o.offerImages || []
      }
    };
    return this.updateOfferDetails(o.id, payload);
  }

  // --- orders ----------------------------------------------------------
  async soldOrders({ page = 1, pageSize = 25, state } = {}) {
    const r = await this.b.get('orders/me/seller/orders', { pageIndex: page, pageSize, orderState: state || undefined });
    return { total: r && (r.recordCount || r.totalCount), pages: r && r.totalPages, rows: listOf(r).map(normalizeOrder) };
  }
  order(id) { return this.b.get(`orders/me/${id}`); }
  deliverOrder(id) { return this.b.post(`orders/me/${id}/deliver`); }
  // seller cancel (Eldorado's own "Cancel order" button); the reason is shown to the buyer
  async cancelOrder(id, reason) {
    const text = String(reason || 'Delivery failed').slice(0, 450);
    try { return await this.b.post(`orders/me/${id}/cancel`, { cancellationReason: text, reason: text, message: text }); }
    catch (e) {
      if (e.status !== 400) throw e;
      return this.b.post(`orders/me/${id}/cancel`, text);   // older shape: the reason as the body
    }
  }
  // what the buyer typed at checkout; only the order detail endpoint carries deliveryDetails
  async deliveryDetail(orderId, field = 'RobloxUsername') {
    try {
      const o = await this.order(orderId);
      const list = Array.isArray(o && o.deliveryDetails) ? o.deliveryDetails : [];
      const f = list.find(x => x && (x.type === field || x.name === field));
      if (f && f.value) return String(f.value).trim();
      if (field === 'RobloxUsername') { const any = robloxOf(o); if (any) return any; }
    } catch { /* older endpoint below */ }
    const r = await this.b.get(`v1/orders/me/${orderId}/delivery-details/${field}`);
    return r && (r.value ?? r);
  }
  orderConversation(orderId) { return this.b.get(`v1/orders/me/${orderId}/conversation`); }
  sendOrderMessage(orderId, message) {
    return this.b.post(`v1/conversation-management/me/conversations/order/${orderId}/quick-reply`, { message });
  }
  talkToken() { return this.b.get('conversations/me/authorize'); }

  // --- reviews / notifications -----------------------------------------
  async reviews(page = 1) {
    const me = await this.me();
    const id = me.id || me.userId;
    const [list, stats] = await Promise.allSettled([
      this.b.get(`orders/reviews/${id}`, { pageIndex: page, pageSize: 20 }),
      this.b.get(`orders/reviews/${id}/stats`)
    ]);
    return { rows: list.status === 'fulfilled' ? listOf(list.value) : [], raw: list.value, stats: stats.value || null, error: list.reason && list.reason.message };
  }
  async notifications(unreadOnly, page = 1) {
    const r = await this.b.get('notifications/me', {
      notificationReadStatuses: unreadOnly ? ['IsUnread'] : ['IsUnread', 'IsRead'], pageIndex: page, pageSize: 30
    });
    return listOf(r).map(n => {
      const x = n.customNotification || n.notification || n;
      return {
        id: x.id, title: x.title || x.notificationType || x.type || 'Notification',
        body: x.message || x.body || x.text || x.description || '',
        read: (x.notificationReadStatus || x.readStatus) === 'IsRead',
        date: x.createdDate || x.date || x.created,
        orderId: (x.customNotificationData && x.customNotificationData.orderId) || (x.details && x.details.detailsId) || x.orderId || null,
        type: x.notificationType || x.type || '',
        raw: n
      };
    });
  }
  markRead(id) { return this.b.put(`notifications/me/${id}/markAsRead`); }
  markAllRead() { return this.b.put('notifications/me/markAllAsRead'); }
}

function normalizeImage(r) {
  if (!r) return undefined;
  if (typeof r === 'string') { const f = r.split('/').pop(); return { smallImage: f, largeImage: f, originalSizeImage: f }; }
  const base = s => (s ? String(s).split('?')[0].split('/').pop() : s);
  // current answer: { localPaths: ['/offerimages/<id>Small.png', '...Large.png', '...Original.png'] }
  if (Array.isArray(r.localPaths) && r.localPaths.length) {
    const pick = re => base(r.localPaths.find(x => re.test(x)) || r.localPaths[0]);
    return { smallImage: pick(/Small\.\w+$/i), largeImage: pick(/Large\.\w+$/i), originalSizeImage: pick(/Original\.\w+$/i) };
  }
  const src = r.image || r;
  const o = {
    smallImage: base(src.smallImage || src.small || src.smallImageName),
    largeImage: base(src.largeImage || src.large || src.largeImageName),
    originalSizeImage: base(src.originalSizeImage || src.original || src.originalImageName)
  };
  if (!o.smallImage && !o.largeImage) {
    const any = base(src.fileName || src.name || src.url || src.path);
    return any ? { smallImage: any, largeImage: any, originalSizeImage: any } : src;
  }
  return o;
}

const round2 = n => Math.round(Number(n) * 100) / 100;

module.exports = { Eldorado, listOf, normalizeOrder, DELIVERY_ORDER, round2 };
