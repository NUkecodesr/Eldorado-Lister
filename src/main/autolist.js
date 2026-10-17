// Auto List queue: price -> image -> create offer (or +1 qty on existing), with delay.
const EventEmitter = require('events');
const fs = require('fs');
const sab = require('./sab');
const { smartPrice } = require('./pricing');

class AutoLister extends EventEmitter {
  constructor({ store, eld, renderImage }) {
    super();
    this.store = store; this.eld = eld; this.renderImage = renderImage;
    this.running = false; this.stopFlag = false;
    this.progress = { done: 0, total: 0, ok: 0, failed: 0, current: null };
  }

  log(level, msg, extra) { const e = this.store.log(level, '[AutoList] ' + msg, extra); this.emit('log', e); }

  // Find an active offer of mine that matches this pet (same item, mutation, gen bucket).
  findStock(pet, myOffers) {
    const g = this.store.get('settings').game;
    const mut = sab.mutationId(pet.mutation, this.eld.attrValues(g.mutationAttr));
    const bucket = sab.genBucket(pet.gen);
    return myOffers.find(o => {
      const env = o.tradeEnvironmentValues || [];
      const name = (env[env.length - 1] || {}).value;
      if (sab.norm(name) !== sab.norm(pet.name)) return false;
      const attrs = o.attributes || [];
      const m = attrs.find(a => a.id === g.mutationAttr);
      const b = attrs.find(a => a.id === g.msAttr);
      const n = attrs.find(a => a.id === g.msNumericAttr);
      const t = attrs.find(a => a.id === g.traitsAttr);
      // exactly the same brainrot only: an offer without a mutation is a base one (it used to match
      // any mutation), without traits has none, and gen/s must be there and within 2%
      const v = m && m.value;
      const offerMut = !v || /^(none|normal|default|base)$/i.test(String(v.name || v.id || '')) ? 'none' : v.id;
      const mOk = offerMut === mut;   // mutationId gives 'none' for a base pet
      const bOk = !b || (b.value && b.value.id) === bucket;
      const nOk = pet.gen ? (!!n && Math.abs(Number(n.value) - pet.gen) / pet.gen < 0.02) : true;
      const offerTraits = t ? (t.values || (t.value ? [t.value] : [])).map(v => sab.norm(v.name || v)).sort().join(',') : '';
      const tOk = offerTraits === (pet.traits || []).map(sab.norm).sort().join(',');
      return mOk && bOk && nOk && tOk;
    });
  }

  // pets that are the exact same brainrot (name, mutation, gen/s, traits) become one offer
  static sameKey(p) { return sab.petKey(p); }

  async start(petIds, opts = {}) {
    if (this.running) throw new Error('Auto List already running');
    const settings = this.store.get('settings');
    const al = { ...settings.autolist, ...opts };
    let pets = this.store.get('pets').filter(p => petIds.includes(p.id));
    // two records with the same brainrot uuid are one pet in the game (left over from older imports):
    // the extra record goes, so it is never listed twice
    {
      const seen = new Map(), extra = new Set();
      for (const p of this.store.get('pets')) {
        if (!p.uuid || p.delivered) continue;
        const k = p.accountId + '|' + p.uuid;
        if (!seen.has(k)) { seen.set(k, p); continue; }
        // keep the one that is listed / sold (it belongs to an offer or order), else the first
        const keep = seen.get(k);
        const drop = (p.status !== 'available' && keep.status === 'available') ? keep : p;
        if (drop === keep) seen.set(k, p);
        if (drop.status === 'available' && !drop.orderId) extra.add(drop.id);
      }
      if (extra.size) {
        this.store.set('pets', this.store.get('pets').filter(p => !extra.has(p.id)));
        this.log('warn', `${extra.size} duplicate record(s) of the same brainrot (same uuid) removed before listing`);
        pets = pets.filter(p => !extra.has(p.id));
      }
    }
    this.running = true; this.stopFlag = false;
    this.progress = { done: 0, total: pets.length, ok: 0, failed: 0, current: null };
    this.emit('progress', this.progress);
    let me = null; let myOffers = [];
    try { me = await this.eld.me(true); } catch (e) { this.log('error', 'Not logged in: ' + e.message); this.running = false; this.emit('progress', this.progress); throw e; }
    if (al.stockDetection) {
      try { myOffers = await this.eld.myOffersAll('Active'); } catch (e) { this.log('warn', 'Stock detection disabled (could not load my offers): ' + e.message); }
    }
    const accounts = this.store.get('accounts');
    // identical pets are listed together as one offer with quantity = how many there are
    const groups = [];
    const byKey = new Map();
    for (const p of pets) {
      const k = AutoLister.sameKey(p);
      if (byKey.has(k)) byKey.get(k).push(p); else { const g = [p]; byKey.set(k, g); groups.push(g); }
    }
    for (const group of groups) {
      const pet = group[0];
      const qty = group.length;
      if (this.stopFlag) break;
      this.progress.current = `${pet.name} ${pet.mutation || ''}`.trim() + (qty > 1 ? ` ×${qty}` : '');
      this.emit('progress', this.progress);
      try {
        const acct = accounts.find(a => a.id === pet.accountId);
        // 1. price
        let price = pet.price;
        let basis = 'manual';
        const confirmed = opts.prices && Number(opts.prices[pet.id]) > 0 ? Number(opts.prices[pet.id]) : null;
        const special = (al.specialTraits || []).map(t => String(t).toLowerCase());
        const review = special.length && (pet.traits || []).some(t => special.includes(String(t).toLowerCase()));
        if (review && !(pet.price > 0)) throw new Error('Manual review (special trait): set a price first');
        if (review) basis = 'manual (special trait)';
        else if (confirmed) { price = confirmed; basis = 'confirmed'; }
        else if (!price || al.priceMode === 'auto' && !pet.priceLocked) {
          if (al.priceMode === 'fixed') { price = al.fixedPrice; basis = 'fixed'; }
          else {
            const sp = await smartPrice(this.eld, pet, this.store.get('settings'), me.id || me.userId);
            price = sp.price; basis = sp.basis;
          }
        }
        if (!price || price <= 0) throw new Error('No price');
        // 2. stock detection
        const stock = al.stockDetection ? this.findStock(pet, myOffers) : null;
        if (stock) {
          // the offer may already stand for some of these pets: Zotac lost track of a listed pet (its
          // record was reset) and it is listed again. Those are linked, not added: only pets beyond
          // what the offer already covers raise its quantity.
          const onOffer = this.store.get('pets').filter(p => p.offerId === stock.id && p.status === 'listed' && !p.delivered && !group.includes(p));
          const live = Math.max(1, Number(stock.quantity) || 1);
          const sameUuid = group.filter(p => p.uuid && onOffer.some(o => o.uuid === p.uuid)).length;
          const already = Math.min(qty, Math.max(sameUuid, live - onOffer.length));
          const add = qty - already;
          if (add > 0) { await this.eld.bumpQuantity(stock, add); stock.quantity = live + add; }
          for (const p of group) this.updatePet(p.id, { status: 'listed', offerId: stock.id, price: stock.pricePerUnit ? stock.pricePerUnit.amount : price, listedAt: Date.now() });
          this.log('info', add > 0
            ? `Stock +${add} → "${stock.offerTitle}" now qty ${stock.quantity}${already ? ` (${already} already on it, linked)` : ''}`
            : `"${stock.offerTitle}" already lists ${qty > 1 ? 'these pets' : 'this pet'} (qty ${live}) - linked, quantity unchanged`);
        } else {
          // 3. text
          const vars = { account: acct ? acct.username : '', emoji: al.emoji };
          const title = pet.title || sab.fillTemplate(al.titleTemplate, { ...pet, price }, vars);
          const description = pet.description || sab.fillTemplate(al.descriptionTemplate, { ...pet, price }, vars);
          // 4. image: the card saved by "Generate Images" first, else render one now
          let image;
          let card = null;
          try { if (pet.imagePath && fs.existsSync(pet.imagePath)) card = fs.readFileSync(pet.imagePath).toString('base64'); } catch { card = null; }
          if (card) {
            try { image = await this.eld.uploadImage(card, `${sab.slug(pet.name)}.png`); } catch (e) { this.log('warn', `Saved card upload failed for ${pet.name}: ${e.message}`); }
          } else if (al.generateImage && this.renderImage) {
            try {
              const idx = await this.eld.itemIndex();
              const item = sab.findItem(idx, pet.name);
              const b64 = await this.renderImage({ pet: { ...pet, price }, rarity: item && item.rarity, imageFolder: al.imageFolder });
              if (b64) image = await this.eld.uploadImage(b64, `${sab.slug(pet.name)}.png`);
            } catch (e) { this.log('warn', `Image skipped for ${pet.name}: ${e.message}`); }
          }
          const payload = await this.eld.buildOfferPayload(pet, { title, description, price, deliveryTime: pet.deliveryTime || al.deliveryTime, image, quantity: qty });
          const res = await this.eld.createOffer(payload);
          const offerId = (res && (res.id || res.offerId || (res.offer && res.offer.id))) || (typeof res === 'string' ? res : null);
          for (const p of group) this.updatePet(p.id, { status: 'listed', offerId, price, title, description, listedAt: Date.now() });
          this.log('info', `Listed ${title} @ $${price}${qty > 1 ? ` × ${qty} (quantity ${qty})` : ''} (${basis})`);
        }
        this.progress.ok += qty;
      } catch (e) {
        this.progress.failed += qty;
        this.log('error', `${pet.name}${qty > 1 ? ' ×' + qty : ''}: ${e.message}`, e.data);
      }
      this.progress.done += qty;
      this.emit('progress', this.progress);
      if (this.progress.done < pets.length && !this.stopFlag) await this.sleep((al.delaySec || 5) * 1000);
    }
    this.running = false; this.progress.current = null;
    this.emit('progress', this.progress);
    this.emit('finished', this.progress);
    return this.progress;
  }

  updatePet(id, patch) {
    const pets = this.store.get('pets');
    const p = pets.find(x => x.id === id);
    if (p) Object.assign(p, patch);
    this.store.save();
    this.emit('pets');
  }

  sleep(ms) {
    return new Promise(res => {
      const t0 = Date.now();
      const tick = () => (this.stopFlag || Date.now() - t0 >= ms ? res() : setTimeout(tick, 250));
      tick();
    });
  }
  stop() { this.stopFlag = true; }
}

module.exports = { AutoLister };
