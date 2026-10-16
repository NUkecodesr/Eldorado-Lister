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
      const mOk = !m || (m.value && m.value.id) === mut;
      const bOk = !b || (b.value && b.value.id) === bucket;
      const nOk = !n || !pet.gen || Math.abs(Number(n.value) - pet.gen) / pet.gen < 0.02;
      return mOk && bOk && nOk;
    });
  }

  async start(petIds, opts = {}) {
    if (this.running) throw new Error('Auto List already running');
    const settings = this.store.get('settings');
    const al = { ...settings.autolist, ...opts };
    const pets = this.store.get('pets').filter(p => petIds.includes(p.id));
    this.running = true; this.stopFlag = false;
    this.progress = { done: 0, total: pets.length, ok: 0, failed: 0, current: null };
    this.emit('progress', this.progress);
    let me = null; let myOffers = [];
    try { me = await this.eld.me(true); } catch (e) { this.log('error', 'Not logged in: ' + e.message); this.running = false; this.emit('progress', this.progress); throw e; }
    if (al.stockDetection) {
      try { myOffers = await this.eld.myOffersAll('Active'); } catch (e) { this.log('warn', 'Stock detection disabled (could not load my offers): ' + e.message); }
    }
    const accounts = this.store.get('accounts');
    for (const pet of pets) {
      if (this.stopFlag) break;
      this.progress.current = `${pet.name} ${pet.mutation || ''}`.trim();
      this.emit('progress', this.progress);
      try {
        const acct = accounts.find(a => a.id === pet.accountId);
        // 1. price
        let price = pet.price;
        let basis = 'manual';
        const special = (al.specialTraits || []).map(t => String(t).toLowerCase());
        const review = special.length && (pet.traits || []).some(t => special.includes(String(t).toLowerCase()));
        if (review && !(pet.price > 0)) throw new Error('Manual review (special trait): set a price first');
        if (review) basis = 'manual (special trait)';
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
          await this.eld.bumpQuantity(stock, 1);
          stock.quantity = (stock.quantity || 1) + 1;
          this.updatePet(pet.id, { status: 'listed', offerId: stock.id, price: stock.pricePerUnit ? stock.pricePerUnit.amount : price, listedAt: Date.now() });
          this.log('info', `Stock +1 → "${stock.offerTitle}" now qty ${stock.quantity}`);
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
          const payload = await this.eld.buildOfferPayload(pet, { title, description, price, deliveryTime: pet.deliveryTime || al.deliveryTime, image });
          const res = await this.eld.createOffer(payload);
          const offerId = (res && (res.id || res.offerId || (res.offer && res.offer.id))) || (typeof res === 'string' ? res : null);
          this.updatePet(pet.id, { status: 'listed', offerId, price, title, description, listedAt: Date.now() });
          this.log('info', `Listed ${title} @ $${price} (${basis})`);
          if (offerId) myOffers.push({ id: offerId, offerTitle: title, quantity: 1, tradeEnvironmentValues: [{ value: payload._item.name, id: payload._item.id }], attributes: [], pricePerUnit: { amount: price } });
        }
        this.progress.ok++;
      } catch (e) {
        this.progress.failed++;
        this.log('error', `${pet.name}: ${e.message}`, e.data);
      }
      this.progress.done++;
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
